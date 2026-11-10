import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { loadConfig } from '../dist/orchestrator/config.js';
import { createApp } from '../dist/orchestrator/main.js';
import { ToolRegistry, fsTools, defaultRegistry } from '../dist/tools/index.js';

function tmpApp() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'whatif-'));
  const config = { ...loadConfig(), dataRoot: dir, dbPath: path.join(dir, 'app.db'), projectsDir: path.join(dir, 'projects') };
  return { dir, app: createApp(config) };
}

test('tools: schema validation and unique-match editing', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'whatif-tools-'));
  fs.mkdirSync(path.join(dir, 'src', 'episodes', 'e'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'src', 'episodes', 'e', 'a.ts'), 'export const A = 1;\nexport const B = 2;\n');
  const registry = new ToolRegistry(fsTools);
  const ctx = { projectId: 'p', projectRoot: dir, dataRoot: dir, skillDir: null, log: () => {} };

  const bad = await registry.run('read_file', { nope: 1 }, ctx);
  assert.equal(bad.ok, false);
  assert.match(bad.summary, /invalid arguments/);

  const read = await registry.run('read_file', { path: 'src/episodes/e/a.ts' }, ctx);
  assert.equal(read.ok, true);
  assert.match(read.summary, /export const A/);

  const edit = await registry.run('edit_file', { path: 'src/episodes/e/a.ts', edits: [{ oldText: 'A = 1', newText: 'A = 42' }] }, ctx);
  assert.equal(edit.ok, true);
  assert.match(fs.readFileSync(path.join(dir, 'src', 'episodes', 'e', 'a.ts'), 'utf8'), /A = 42/);

  const ambiguous = await registry.run('edit_file', { path: 'src/episodes/e/a.ts', edits: [{ oldText: 'export const', newText: 'x' }] }, ctx);
  assert.equal(ambiguous.ok, false);
  assert.match(ambiguous.summary, /not unique/);

  const escape = await registry.run('read_file', { path: '../../etc/passwd' }, ctx);
  assert.equal(escape.ok, false);
});

test('shell: allowlist refuses operators and unknown commands', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'whatif-shell-'));
  const registry = defaultRegistry();
  const ctx = { projectId: 'p', projectRoot: dir, dataRoot: dir, skillDir: null, log: () => {} };
  const { checkCommand } = await import('../dist/tools/shell-policy.js');
  assert.equal(checkCommand('ls -la').ok, true);
  assert.equal(checkCommand('npm install').ok, true);
  assert.equal(checkCommand('rm -rf /').ok, false);
  assert.equal(checkCommand('ls; rm -rf /').ok, false);
  assert.equal(checkCommand('git status').ok, true);
  assert.equal(registry.get('shell').policy, 'ask');
});

test('agent loop end-to-end over HTTP with the mock provider', async () => {
  const { dir, app } = tmpApp();
  app.db.setSetting('provider', 'mock');
  await new Promise((resolve) => app.server.listen(0, '127.0.0.1', resolve));
  const port = app.server.address().port;
  const base = `http://127.0.0.1:${port}`;
  try {
    const health = await (await fetch(`${base}/api/health`)).json();
    assert.equal(health.ok, true);

    const created = await (
      await fetch(`${base}/api/projects`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name: 'demo' }) })
    ).json();
    assert.equal(created.project.id, 'demo');

    const thread = await (
      await fetch(`${base}/api/threads`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ projectId: 'demo' }),
      })
    ).json();

    const posted = await fetch(`${base}/api/threads/${thread.id}/messages`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ text: 'fais un tour de reconnaissance' }),
    });
    assert.equal(posted.status, 202);

    let done = false;
    for (let i = 0; i < 100 && !done; i++) {
      await new Promise((r) => setTimeout(r, 100));
      const data = await (await fetch(`${base}/api/threads/${thread.id}/messages`)).json();
      const last = data.messages[data.messages.length - 1];
      if (last?.role === 'assistant' && /Terminé/.test(last.content)) done = true;
    }
    assert.equal(done, true, 'the mock agent should finish its script');

    const notes = path.join(dir, 'projects', 'demo', 'NOTES.md');
    assert.ok(fs.existsSync(notes), 'write_file should have created NOTES.md');
    assert.match(fs.readFileSync(notes, 'utf8'), /Agent notes/);

    const served = await fetch(`${base}/api/file?project=demo&path=NOTES.md`);
    assert.equal(served.status, 200);
    assert.match(await served.text(), /Agent notes/);

    const messages = await (await fetch(`${base}/api/threads/${thread.id}/messages`)).json();
    assert.ok(messages.messages.some((m) => m.role === 'tool' && m.payload?.name === 'repo_map'));
    assert.equal(typeof messages.elapsedMs, 'number');
    assert.ok(messages.elapsedMs >= 0);

    const projs = await (await fetch(`${base}/api/projects`)).json();
    const demoProj = projs.find((p) => p.id === 'demo');
    assert.ok(demoProj);
    assert.equal(typeof demoProj.elapsedMs, 'number');
  } finally {
    await app.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('approval gate blocks a run until the human answers', async () => {
  const { dir, app } = tmpApp();
  const thread = app.db.createThread((app.db.createProject('p2', 'p2', path.join(dir, 'p2'))).id, 'gate');
  const pending = app.approvals.request(thread.id, 'whatif_run', { step: 'voice' }, 5000);
  const row = app.db.pendingApprovals(thread.id)[0];
  assert.ok(row, 'an approval row must be pending');
  assert.equal(app.approvals.decide(row.id, true), true);
  assert.equal(await pending, 'approved');
  assert.equal(app.db.getApproval(row.id).status, 'approved');

  const denied = app.approvals.request(thread.id, 'shell', { command: 'ls' }, 5000);
  const row2 = app.db.pendingApprovals(thread.id)[0];
  app.approvals.decide(row2.id, false);
  assert.equal(await denied, 'denied');

  const timeout = await app.approvals.request(thread.id, 'shell', { command: 'ls' }, 30);
  assert.equal(timeout, 'timeout');
  await app.close();
  fs.rmSync(dir, { recursive: true, force: true });
});

test('whatif audits: episode formula/language and shots animation/framing checks', async () => {
  const { episodeAudit, shotsAudit } = await import('../dist/tools/whatif.js');
  const badFr = {
    title: ['WHAT IF YOU COULD', 'PLIE UNE FEUILLE ?'],
    script: [
      { beat: '1', text: 'Tu plies une feuille en deux dans ta chambre.' },
      { beat: '2', text: 'Tu la replies encore sur le bureau.' },
      { beat: '3', text: 'La pile dépasse déjà la table.' },
      { beat: '4', text: 'What if you could plier une feuille 42 fois ?' },
      { beat: '5', text: 'À 42 plis, elle atteint la Lune : 439 800 km.' },
    ],
    science: [{ claim: '42 plis = 439 800 km', working: '0.1mm * 2^42', source: 'exponentielle' }],
  };
  assert.match(episodeAudit(badFr, 'fold') ?? '', /mixes English/);

  const goodFr = {
    ...badFr,
    title: ['ET SI TU POUVAIS', 'PLIER UNE FEUILLE 42 FOIS ?'],
    script: badFr.script.map((b, i) => (i === 3 ? { beat: '4', text: 'Et si tu pouvais plier une feuille 42 fois ?' } : b)),
  };
  assert.equal(episodeAudit(goodFr, 'fold'), null);

  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'whatif-shots-'));
  try {
    const epDir = path.join(dir, 'src', 'episodes', 'fold');
    fs.mkdirSync(epDir, { recursive: true });
    fs.writeFileSync(path.join(epDir, 'index.tsx'), 'export const fold = defineEpisode("Fold", { timeline, shots: { S1, S2 } });\n');
    fs.writeFileSync(
      path.join(epDir, 'shots.tsx'),
      `export const S1 = ({ t, len }) => <g transform={camT(960, 540, 8.5)}><Study t={t} /><SchLabel x={640} y={500} t={t - 0.5} text="A" /><SchLabel x={650} y={600} t={t} text="B" /></g>;\n` +
        `export const S2 = ({ t, len }) => <g><Schematic t={t} /><SchLabel x={960} y={540} t={t - 90} text="C" /></g>;\n`,
    );
    const ep = { shots: [{ id: 'S1', set: 'study', size: 'medium' }, { id: 'S2', set: 'schematic', size: 'schematic' }] };
    const tl = { shots: [{ id: 'S1', len: 50 }, { id: 'S2', len: 50 }] };
    const err = shotsAudit(dir, 'fold', ep, tl) ?? '';
    assert.match(err, /has no character/);
    assert.match(err, /FRAMES at 30 fps/);
    assert.match(err, /x≈640–660/);
    assert.match(err, /schedules animation at frame\(s\) 90/);

    const { normalizeAspect, syncStudioAspect } = await import('../dist/tools/whatif.js');
    assert.equal(normalizeAspect('9:16'), '9:16');
    assert.equal(normalizeAspect('vertical'), '9:16');
    assert.equal(normalizeAspect('16:9'), '16:9');
    fs.writeFileSync(path.join(dir, 'PROJECT.md'), '# Project\n\n- aspect: 9:16 (1080x1920 vertical)\n');
    fs.writeFileSync(path.join(epDir, 'episode.json'), JSON.stringify({ id: 'Fold', slug: 'fold' }));
    fs.writeFileSync(
      path.join(dir, 'src', 'studio.config.ts'),
      `// For 16:9 landscape: width: 1920, height: 1080, aspect: '16:9'.\n// For 9:16 vertical: width: 1080, height: 1920, aspect: '9:16'.\nexport const STUDIO = {\n  width: 1920,\n  height: 1080,\n  aspect: '16:9' as '16:9' | '9:16',\n  fps: 30,\n};\n`,
    );
    assert.equal(syncStudioAspect(dir, 'fold'), '9:16');
    const cfgAfter = fs.readFileSync(path.join(dir, 'src', 'studio.config.ts'), 'utf8');
    const studioBlock = cfgAfter.split('export const STUDIO')[1] ?? '';
    assert.match(studioBlock, /width:\s*1080/);
    assert.match(studioBlock, /height:\s*1920/);
    assert.match(studioBlock, /aspect:\s*'9:16'/);

    // Source video translation fidelity check: reject shortened scripts, accept full scripts without science
    const shortenedSourceEp = {
      title: ['LE PIRE', 'RENDEZ-VOUS'],
      source: { provider: 'nouveau', videoId: '7685825400659774751', words: 288 },
      script: [{ text: 'Un court résumé de quinze mots qui raccourcit complètement la traduction du serveur.' }],
      science: [],
    };
    assert.match(episodeAudit(shortenedSourceEp, 'rdv') ?? '', /shortened or rewrote the :8005 translation proposal/);

    const fullWords = Array.from({ length: 240 }, (_, i) => `mot${i}`).join(' ');
    const fullSourceEp = {
      title: ['LE PIRE', 'RENDEZ-VOUS'],
      source: { provider: 'nouveau', videoId: '7685825400659774751', words: 288 },
      script: [{ text: fullWords }],
      science: [],
    };
    assert.equal(episodeAudit(fullSourceEp, 'rdv'), null);

    // Continuity & narrative checks in shotsAudit (DIRECTOR.md hex mismatch, dialogue schematic replacement, English banner)
    fs.writeFileSync(path.join(epDir, 'DIRECTOR.md'), 'Palette: murs #EFE3CC, canapé #7A8B6F, veste #3A86FF.');
    fs.writeFileSync(
      path.join(epDir, 'shots.tsx'),
      `export const S1 = ({ t, len }) => <g transform={camT(960, 540, 1.2)}><Study t={t} fill="#112233" /><Hero look={N} pose={poseAt(t, [{f:0,p:{}}])} /></g>;\n` +
        `export const S2 = ({ t, len }) => <g><Schematic t={t} /><SchLabel x={960} y={540} t={t} text="YOU PUT ITCHING POWDER" /></g>;\n`,
    );
    const epCont = {
      script: [{ text: 'Il me va parfaitement a-t-elle souri dans le salon.' }],
      shots: [
        { id: 'S1', set: 'study', size: 'wide', note: 'J ai versé la poudre' },
        { id: 'S2', set: 'study', size: 'insert', note: 'Il me va parfaitement a-t-elle souri' },
      ],
    };
    const errCont = shotsAudit(dir, 'fold', epCont, tl) ?? '';
    assert.match(errCont, /DIRECTOR\.md specifies colour palette/);
    assert.match(errCont, /replaces a character dialogue\/reaction/);
    assert.match(errCont, /untranslated English banner/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('context compaction: compacts old write_file payloads, drops orphan tool messages, and protects scripts/package.json', async () => {
  const { buildMessages, countScriptWords } = await import('../dist/orchestrator/context.js');
  const { checkCommand } = await import('../dist/tools/shell-policy.js');

  assert.equal(countScriptWords([{ text: '[excited] Bonjour <break/> le monde !' }]), 4);
  assert.equal(checkCommand('find . -name "*.ts" -delete').ok, false);
  assert.equal(checkCommand('cat /etc/passwd').ok, false);
  assert.equal(checkCommand('cat .env').ok, false);

  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'whatif-ctx-'));
  try {
    const registry = new ToolRegistry(fsTools);
    const ctx = { projectId: 'p', projectRoot: dir, dataRoot: dir, skillDir: null, log: () => {} };
    const blockedScript = await registry.run('write_file', { path: 'scripts/evil.py', content: 'print(1)' }, ctx);
    assert.equal(blockedScript.ok, false);
    assert.match(blockedScript.summary, /refused by security policy/);

    const blockedPkg = await registry.run('write_file', { path: 'package.json', content: '{}' }, ctx);
    assert.equal(blockedPkg.ok, false);

    const bigContent = Array.from({ length: 120 }, (_, i) => `export const line${i} = ${i};`).join('\n');
    const history = [
      {
        id: 1,
        thread_id: 't',
        role: 'assistant',
        content: 'writing shots batch 1',
        payload: JSON.stringify({ toolCalls: [{ id: 'c1', name: 'write_file', args: { path: 'src/episodes/ep/shots.tsx', content: bigContent } }] }),
        created_at: '',
      },
      {
        id: 2,
        thread_id: 't',
        role: 'tool',
        content: 'ok\ncreated shots.tsx',
        payload: JSON.stringify({ toolCallId: 'c1', name: 'write_file', ok: true }),
        created_at: '',
      },
      { id: 3, thread_id: 't', role: 'user', content: 'continue step 1', payload: null, created_at: '' },
      { id: 4, thread_id: 't', role: 'assistant', content: 'step 1 done', payload: null, created_at: '' },
      { id: 5, thread_id: 't', role: 'user', content: 'continue step 2', payload: null, created_at: '' },
      { id: 6, thread_id: 't', role: 'assistant', content: 'step 2 done', payload: null, created_at: '' },
    ];
    const msgs = buildMessages({ projectRoot: dir, history, maxChars: 90_000 });
    const oldAssistant = msgs.find((m) => m.role === 'assistant' && m.toolCalls?.length);
    assert.ok(oldAssistant, 'old assistant tool call should be present');
    assert.match(String(oldAssistant.toolCalls[0].args.content), /\[compacted:/);

    // Test episodePin: pins DIRECTOR.md, shared shots.tsx header, exported shots, and remaining shots
    const epDir = path.join(dir, 'src', 'episodes', 'ep');
    fs.mkdirSync(epDir, { recursive: true });
    fs.writeFileSync(
      path.join(epDir, 'episode.json'),
      JSON.stringify({
        id: 'Ep',
        slug: 'ep',
        title: ['TEST'],
        script: [{ text: 'Un deux trois quatre' }],
        shots: [
          { id: 'S1', size: 'wide', set: 'study', note: 'Un deux' },
          { id: 'S2', size: 'close', set: 'study', note: 'trois quatre' },
        ],
      }),
    );
    fs.writeFileSync(
      path.join(epDir, 'timeline.json'),
      JSON.stringify({
        slug: 'ep',
        total: 120,
        segments: [{ shot: 'S1', a: 0, b: 60 }, { shot: 'S2', a: 60, b: 120 }],
        shots: [{ id: 'S1', len: 60, size: 'wide' }, { id: 'S2', len: 60, size: 'close' }],
      }),
    );
    fs.writeFileSync(path.join(epDir, 'DIRECTOR.md'), '# Réalisation\nSalon crème #EFE3CC avec canapé vert #7A8B6F.');
    fs.writeFileSync(
      path.join(epDir, 'shots.tsx'),
      `import React from 'react';\nconst NARR = makeLook({ jacket: '#3A86FF' });\nexport const S1 = ({ t, len }) => <g />;\n`,
    );
    const msgsPinned = buildMessages({ projectRoot: dir, history, maxChars: 90_000 });
    const pinMsg = msgsPinned.find((m) => m.role === 'system' && m.content.startsWith('## Active episode continuity pin'));
    assert.ok(pinMsg, 'continuity pin system message should be present');
    assert.match(pinMsg.content, /Salon crème #EFE3CC/);
    assert.match(pinMsg.content, /const NARR = makeLook/);
    assert.match(pinMsg.content, /Remaining to export: S2/);

    // Test independent Reviewer (parseReviewJson, formatReviewFeedback, reviewEpisodeBoard)
    const { parseReviewJson, formatReviewFeedback, reviewEpisodeBoard } = await import('../dist/orchestrator/reviewer.js');
    const parsedFail = parseReviewJson(
      '```json\n{"pass":false,"summary":"Incohérence S2","issues":[{"shot":"S2","severity":"error","problem":"Panneau hors sujet","fix":"Mettre <Hero> en plan serré"}]}\n```',
      'gemini-2.5-flash',
      'ep',
    );
    assert.equal(parsedFail.pass, false);
    assert.equal(parsedFail.issues.length, 1);
    const fb = formatReviewFeedback(parsedFail, 'ep');
    assert.match(fb, /CORRECTIONS REQUISES/);
    assert.match(fb, /args: \["S2"\]/);

    const fakeReviewer = {
      label: 'review-mock',
      model: 'review-flash',
      async chat({ messages }) {
        assert.equal(messages.length, 2, 'reviewer must run in a clean 2-message context');
        return {
          text: JSON.stringify({ pass: true, summary: 'Tout est cohérent.', issues: [] }),
          toolCalls: [],
        };
      },
    };
    const report = await reviewEpisodeBoard(fakeReviewer, dir, 'ep');
    assert.equal(report.pass, true);
    assert.ok(fs.existsSync(path.join(dir, 'out', 'ep', 'review.json')), 'review.json should be saved');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('write policy: the agent writes in episodes, root notes and out/, never in the engine', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'whatif-write-'));
  const registry = new ToolRegistry(fsTools);
  const ctx = { projectId: 'p', projectRoot: dir, dataRoot: dir, skillDir: null, log: () => {} };
  const write = (p) => registry.run('write_file', { path: p, content: 'x' }, ctx);
  try {
    assert.equal((await write('src/episodes/crush/shots.tsx')).ok, true);
    assert.equal((await write('PROJECT.md')).ok, true);
    assert.equal((await write('out/probe.txt')).ok, true);
    for (const bad of ['src/engine/rig.tsx', 'src/exports/motiongrid.tsx', 'src/episode/shots.tsx', 'src/studio.config.ts', '.gitignore', 'package.json']) {
      const r = await write(bad);
      assert.equal(r.ok, false, `${bad} must be refused`);
    }
    process.env.WHATIF_ALLOW_ENGINE_WRITES = '1';
    assert.equal((await write('src/engine/rig.tsx')).ok, true, 'engine writes open only with the explicit switch');
    assert.equal((await write('package.json')).ok, false, 'the switch never opens the manifests');
  } finally {
    delete process.env.WHATIF_ALLOW_ENGINE_WRITES;
  }
});

test('shots audit: establishing shots may hold no character, zoom range is 0.6-4.5', async () => {
  const { shotsAudit } = await import('../dist/tools/whatif.js');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'whatif-estab-'));
  const epDir = path.join(dir, 'src', 'episodes', 'room');
  fs.mkdirSync(epDir, { recursive: true });
  fs.writeFileSync(path.join(epDir, 'index.tsx'), 'export const room = defineEpisode("Room", { timeline, shots: { S1, S2 } });\n');
  const shots = (z) =>
    `export const S1 = ({ t, len }) => <g transform={camT(960, 540, 1.0)}><Study t={t} />{kf(t, [[0, 1], [10, 2]])}</g>;\n` +
    `export const S2 = ({ t, len }) => <g transform={camT(960, 540, ${z})}><Hero look={N} pose={poseAt(t, [{ f: 0, p: {} }])} /></g>;\n`;
  const ep = (size) => ({ shots: [{ id: 'S1', set: 'study', size }, { id: 'S2', set: 'study', size: 'close' }] });
  const tl = { shots: [{ id: 'S1', len: 60 }, { id: 'S2', len: 60 }] };
  try {
    fs.writeFileSync(path.join(epDir, 'shots.tsx'), shots(4.0));
    const ok = shotsAudit(dir, 'room', ep('establishing'), tl) ?? '';
    assert.doesNotMatch(ok, /has no character/, 'an establishing shot needs no character');
    assert.doesNotMatch(ok, /zoom/, 'zoom 4.0 is a valid close-up');
    const plain = shotsAudit(dir, 'room', ep('wide'), tl) ?? '';
    assert.match(plain, /S1 .*has no character/, 'a plain wide still needs a character');
    fs.writeFileSync(path.join(epDir, 'shots.tsx'), shots(4.8));
    assert.match(shotsAudit(dir, 'room', ep('establishing'), tl) ?? '', /zoom to 4\.8|zoom to 4\.80/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('context: the director guide is injected and the engine digest exposes the Pose fields', async () => {
  const { buildMessages } = await import('../dist/orchestrator/context.js');
  const { engineDigest } = await import('../dist/orchestrator/engine-digest.js');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'whatif-ctx-'));
  try {
    fs.mkdirSync(path.join(dir, 'src', 'engine'), { recursive: true });
    fs.writeFileSync(
      path.join(dir, 'src', 'engine', 'rig.tsx'),
      `export type Limb = { a: number; b: number };\nexport type Pose = {\n  x: number;\n  yaw: number; // -1 profile left\n  armL: Limb;\n};\nexport type Other = { z: number };\n`,
    );
    const digest = engineDigest(dir);
    assert.match(digest, /type Pose = \{ x: number; yaw: number; armL: Limb; \}/);
    assert.match(digest, /type Limb = \{ a: number; b: number \}/);
    assert.match(digest, /types: Other/);
    assert.doesNotMatch(digest, /profile left/, 'comments are stripped');
    const sys = buildMessages({ projectRoot: dir, history: [], maxChars: 90_000 }).filter((m) => m.role === 'system');
    assert.ok(sys.some((m) => m.content.includes("Director's guide")), 'guide present in the system messages');
    assert.ok(sys.some((m) => m.content.includes('900/zoom')), 'guide states the 9:16 visible width');
    assert.ok(sys.some((m) => m.content.includes('seen from behind')), 'guide explains the yaw compass including the back view');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('db: project_runs gains a model column on an old database and records it', async () => {
  const { DatabaseSync } = await import('node:sqlite');
  const { Db } = await import('../dist/orchestrator/db.js');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'whatif-db-'));
  const dbPath = path.join(dir, 'old.db');
  const old = new DatabaseSync(dbPath);
  old.exec(
    `CREATE TABLE project_runs (id INTEGER PRIMARY KEY AUTOINCREMENT, project_id TEXT NOT NULL, thread_id TEXT NOT NULL, elapsed_ms INTEGER NOT NULL, steps INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL);` +
      `INSERT INTO project_runs (project_id, thread_id, elapsed_ms, steps, created_at) VALUES ('p', 't', 5, 1, 'x');`,
  );
  old.close();
  try {
    const db = new Db(dbPath);
    db.addRunDuration('p', 't', 10, 2, 'zai-org/GLM-5.3-Flash');
    const rows = db.raw.prepare('SELECT model FROM project_runs ORDER BY id').all();
    assert.deepEqual(rows.map((r) => r.model), [null, 'zai-org/GLM-5.3-Flash']);
    db.close();
    new Db(dbPath).close(); // reopening an already-migrated database is a no-op
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('image pick: re-rendered shots first, then contact sheets, then an even spread (never S1, S10, S11)', async () => {
  const { pickImages } = await import('../dist/orchestrator/image-pick.js');
  const stills = Array.from({ length: 36 }, (_, i) => `out/e/board/S${i + 1}.png`);
  const board = 'out/e/storyboard.jpg';
  const sheets = [1, 2, 3, 4, 5].map((n) => `out/e/sheets/sheet-0${n}.jpg`);

  assert.deepEqual(pickImages([...stills, board], ['S7', 'S3']), ['out/e/board/S7.png', 'out/e/board/S3.png'], 'asked shots, in the asked order');
  assert.deepEqual(pickImages([...stills, board, ...sheets]), sheets.slice(0, 3), 'sheets win over loose stills');
  const spread = pickImages([...stills, board]);
  assert.deepEqual(spread, ['out/e/board/S1.png', 'out/e/board/S19.png', 'out/e/board/S36.png'], 'even spread (indices 0, 18, 35), natural order, no storyboard strip');
  assert.deepEqual(pickImages(['out/e/board/S2.png', 'out/e/board/S10.png']), ['out/e/board/S2.png', 'out/e/board/S10.png'], 'few images: all, natural order');
});

test('reviewer: reads the contact sheets and the measured counts, not the tall strip', async () => {
  const { reviewEpisodeBoard, staticMetrics } = await import('../dist/orchestrator/reviewer.js');
  const shots =
    `export const S1 = ({ t }) => <g><Hero look={A} pose={{ yaw: 0.5 }} /></g>;\n` +
    `export const S2 = ({ t }) => <g><Hero look={A} pose={{}} /><Hero look={B} pose={{}} /><Hero look={C} pose={{}} /></g>;\n` +
    `export const S3 = ({ t }) => <g><Foreground blur={16}><Hero look={A} pose={tableSit(700)} /></Foreground></g>;\n`;
  assert.equal(
    staticMetrics(shots),
    "2/3 plans avec un personnage orienté (yaw >= 0,3, tableSit ou walkPose) · 1/3 plans avec amorce floue · 1 plans à 3 personnages ou plus · 3 plans avec personnages où rien ne change pendant le plan · 0 plans où l'unique action est idle",
  );

  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'whatif-rev-'));
  try {
    const epDir = path.join(dir, 'src', 'episodes', 'e');
    const outDir = path.join(dir, 'out', 'e');
    fs.mkdirSync(epDir, { recursive: true });
    fs.mkdirSync(path.join(outDir, 'sheets'), { recursive: true });
    fs.writeFileSync(path.join(epDir, 'shots.tsx'), shots);
    fs.writeFileSync(path.join(epDir, 'episode.json'), JSON.stringify({ aspect: '9:16', script: [{ text: 'Bonjour.' }], shots: [] }));
    fs.writeFileSync(path.join(outDir, 'storyboard.jpg'), 'strip');
    for (const n of [1, 2, 3, 4, 5, 6, 7, 8]) fs.writeFileSync(path.join(outDir, 'sheets', `sheet-0${n}.jpg`), `sheet${n}`);
    let seen;
    const provider = {
      model: 'fake',
      label: 'fake',
      chat: async (o) => {
        seen = o.messages;
        return { text: '{"pass":true,"summary":"ok","issues":[]}', toolCalls: [], finishReason: 'stop' };
      },
    };
    const report = await reviewEpisodeBoard(provider, dir, 'e');
    assert.equal(report.ok, true);
    const user = seen.find((m) => m.role === 'user');
    assert.equal(user.images.length, 6, 'at most 6 sheets');
    assert.equal(Buffer.from(user.images[0].data, 'base64').toString(), 'sheet1', 'sheets in natural order, not the strip');
    assert.match(user.content, /2\/3 plans avec un personnage orienté/);
    assert.match(user.content, /les 6 premières sur 8/);

    fs.rmSync(path.join(outDir, 'sheets'), { recursive: true });
    await reviewEpisodeBoard(provider, dir, 'e');
    assert.equal(seen.find((m) => m.role === 'user').images.length, 1, 'falls back to storyboard.jpg when there are no sheets');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('engine overlay: adds the template classroom and the character views, patches once, all or nothing per file', async () => {
  const { applyEngineOverlay, overlaySummary } = await import('../dist/tools/engine-overlay.js');
  const rigOf = (opts = {}) =>
    "import React from 'react';\n" +
    'export const turnWidth = (yaw: number) => 1 - 0.4 * Math.min(1, Math.abs(yaw));\n' +
    'export const limbSpread = (yaw: number) => 1 - 0.85 * Math.min(1, Math.abs(yaw));\n' +
    'const a = { x: -SHOULDER.x * sp + pose.yaw * 6 }; const b = { x: SHOULDER.x * sp + pose.yaw * 6 };\n' +
    'const t = `translate(${pose.yaw * 6} 0)`; const u = pose.yaw * 6;\n' +
    '<g>\n          {torso}\n' + (opts.noHead ? '' : '          {head}\n') + '          {children}\n</g>\n';
  const anchor = "      <polygon points={Q([[0, 1, 0], [1, 1, 0], [1, 1, 1], [0, 1, 1]])} fill={`url(#${id}F)`} />\n";
  const mk = (furnish, rig) => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'whatif-ovl-'));
    fs.mkdirSync(path.join(dir, 'src', 'engine', 'sets'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'src', 'engine', 'furnish.tsx'), furnish);
    fs.writeFileSync(path.join(dir, 'src', 'engine', 'rig.tsx'), rig);
    fs.writeFileSync(
      path.join(dir, 'src', 'engine', 'episode.tsx'),
      "import { AbsoluteFill } from 'remotion';\n" +
        '<svg width={1920} height={1080} viewBox="0 0 1920 1080" a /><svg width={1920} height={1080} viewBox="0 0 1920 1080" b /><svg width={1920} height={1080} viewBox="0 0 1920 1080" c />\n' +
        '<rect width="1920" height="1080" fill="url(#epVig)" /><rect width="1920" height="1080" filter="url(#epGrain)" />\n',
    );
    fs.writeFileSync(path.join(dir, 'src', 'engine', 'index.ts'), "export * from './rig';\nexport * from './furnish';\nexport * from './ui';\n");
    fs.writeFileSync(path.join(dir, 'src', 'engine', 'sets', 'classroom.tsx'), 'export const Classroom = () => null; // the old one\n');
    return dir;
  };
  const dir = mk(`const RoomShell = () => (\n    <g>\n${anchor}      {fl}\n    </g>\n);\n`, rigOf());
  const bare = mk('const RoomShell = () => null; // a copy without the anchor\n', 'export const Hero = () => null; // an old rig\n');
  const partial = mk('x\n', rigOf({ noHead: true }));
  const read = (d, rel) => fs.readFileSync(path.join(d, rel), 'utf8');
  try {
    const dry = applyEngineOverlay(dir, { dryRun: true });
    assert.ok(dry.added.includes('src/engine/pieces.tsx') && dry.added.includes('src/engine/views.tsx'));
    assert.ok(dry.replaced.includes('src/engine/sets/classroom.tsx'));
    assert.equal(fs.existsSync(path.join(dir, 'src', 'engine', 'views.tsx')), false, 'a dry run writes nothing');
    assert.match(overlaySummary(dry, false), /would be added/);

    const first = applyEngineOverlay(dir);
    assert.deepEqual(first.patched.sort(), ['src/engine/episode.tsx', 'src/engine/furnish.tsx', 'src/engine/index.ts', 'src/engine/rig.tsx']);
    const framed = read(dir, 'src/engine/episode.tsx');
    assert.equal(framed.split('viewBox={VIEW_BOX}').length - 1, 3, 'every svg of an older engine follows the 9:16 frame');
    assert.doesNotMatch(framed, /viewBox="0 0 1920 1080"|width="1920"/);
    assert.match(framed, /^import \{ AbsoluteFill \} from 'remotion';\nimport \{ STUDIO \} from '\.\.\/studio\.config';\n/);
    assert.match(read(dir, 'src/engine/sets/classroom.tsx'), /export const CLASS_DEFAULT/);
    assert.match(read(dir, 'src/engine/views.tsx'), /export const ViewHead/);
    assert.match(read(dir, 'src/engine/index.ts'), /export \* from '\.\/rig';\nexport \* from '\.\/views';\nexport \* from '\.\/furnish';\nexport \* from '\.\/shot';\nexport \* from '\.\/rooms';\nexport \* from '\.\/actions';\nexport \* from '\.\/cast';\nexport \* from '\.\/person';\nexport \* from '\.\/stage';\nexport \* from '\.\/pieces';\nexport \* from '\.\/ui';/);
    assert.match(read(dir, 'src/engine/stage.tsx'), /export const Stage\b/);
    assert.match(read(dir, 'src/engine/person.tsx'), /export const Person\b/);
    assert.match(read(dir, 'src/engine/index.ts'), /export \* from '\.\/person';/);
    const furnish = read(dir, 'src/engine/furnish.tsx');
    assert.equal(furnish.split('below the near plane').length, 2, 'the floor patch is inserted once');
    assert.ok(furnish.indexOf(anchor) < furnish.indexOf('below the near plane') && furnish.indexOf('below the near plane') < furnish.indexOf('{fl}'), 'inserted right after its anchor');
    const rig = read(dir, 'src/engine/rig.tsx');
    assert.match(rig, /^import React from 'react';\nimport \{ ViewHead, ViewTorso, foldYaw \} from '\.\/views';\n/);
    assert.match(rig, /<ViewTorso pose=\{pose\} L=\{L\} torso=\{torso\} \/>/);
    assert.match(rig, /<ViewHead pose=\{pose\} L=\{L\} head=\{head\} headGear=\{headGear\} \/>\n          \{children\}/);
    assert.match(rig, /turnWidth = \(yaw: number\) => 1 - 0\.4 \* Math\.min\(1, foldYaw\(yaw\)\)/);
    assert.equal(rig.split('Math.sign(pose.yaw) * foldYaw(pose.yaw) * 6').length - 1, 4, 'all 4 shoulder shifts follow the folded turn');
    assert.doesNotMatch(rig, /[^.]pose\.yaw \* 6/);

    const second = applyEngineOverlay(dir);
    assert.deepEqual([second.added, second.replaced, second.patched], [[], [], []], 'applying twice changes nothing');
    assert.equal(overlaySummary(second, true), 'engine overlay: already up to date');
    assert.equal(read(dir, 'src/engine/rig.tsx'), rig);

    const odd = applyEngineOverlay(bare);
    assert.ok(odd.skipped.some((x) => x.file === 'src/engine/furnish.tsx' && /anchor/.test(x.reason)), 'a patch without its anchor says so');
    assert.ok(odd.skipped.some((x) => x.file === 'src/engine/rig.tsx'));
    assert.equal(read(bare, 'src/engine/furnish.tsx'), 'const RoomShell = () => null; // a copy without the anchor\n', 'and changes nothing');

    const part = applyEngineOverlay(partial);
    assert.ok(part.skipped.some((x) => x.file === 'src/engine/rig.tsx' && /expected 1/.test(x.reason)));
    assert.equal(read(partial, 'src/engine/rig.tsx'), rigOf({ noHead: true }), 'one missing anchor: the whole rig patch is skipped, not half applied');

    const none = applyEngineOverlay(fs.mkdtempSync(path.join(os.tmpdir(), 'whatif-ovl-empty-')));
    assert.equal(none.skipped[0].file, 'src/engine');
  } finally {
    for (const d of [dir, bare, partial]) fs.rmSync(d, { recursive: true, force: true });
  }
});

test('engine overlay: whatif_sync_engine applies it without a mounted skill', async () => {
  const { defaultRegistry } = await import('../dist/tools/index.js');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'whatif-sync-'));
  fs.mkdirSync(path.join(dir, 'src', 'engine', 'sets'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'src', 'engine', 'index.ts'), "export * from './furnish';\n");
  fs.writeFileSync(path.join(dir, 'src', 'engine', 'furnish.tsx'), '// no anchor\n');
  const ctx = { projectId: 'p', projectRoot: dir, dataRoot: dir, skillDir: null, log: () => {} };
  try {
    const dry = await defaultRegistry().run('whatif_sync_engine', {}, ctx);
    assert.equal(dry.ok, true);
    assert.match(dry.summary, /no skill mounted.*would be added/);
    assert.equal(fs.existsSync(path.join(dir, 'src', 'engine', 'pieces.tsx')), false);
    const done = await defaultRegistry().run('whatif_sync_engine', { apply: true }, ctx);
    assert.equal(done.ok, true);
    assert.equal(fs.existsSync(path.join(dir, 'src', 'engine', 'pieces.tsx')), true);
    assert.match(fs.readFileSync(path.join(dir, 'src', 'engine', 'index.ts'), 'utf8'), /pieces/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('stage: the audit counts <Staged> as a character, checks ground positions, and the guide appears only with the engine', async () => {
  const { shotsAudit } = await import('../dist/tools/whatif.js');
  const { buildMessages } = await import('../dist/orchestrator/context.js');
  const { staticMetrics } = await import('../dist/orchestrator/reviewer.js');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'whatif-stage-'));
  const epDir = path.join(dir, 'src', 'episodes', 'room');
  fs.mkdirSync(epDir, { recursive: true });
  fs.writeFileSync(path.join(epDir, 'index.tsx'), 'export const room = defineEpisode("Room", { timeline, shots: { S1 } });\n');
  const shot = (w) => `export const S1 = ({ t, len }) => <Stage ground={G}><Staged at={{ u: 0.4, w: ${w} }} look={A} pose={poseAt(t, [{ f: 0, p: {} }])} /></Stage>;\n`;
  const ep = { shots: [{ id: 'S1', set: 'study', size: 'wide' }] };
  const tl = { shots: [{ id: 'S1', len: 60 }] };
  const hasGuide = () => buildMessages({ projectRoot: dir, history: [], maxChars: 90_000 }).some((m) => m.role === 'system' && m.content.includes('## Stage: place people'));
  try {
    fs.writeFileSync(path.join(epDir, 'shots.tsx'), shot(0.5));
    const ok = shotsAudit(dir, 'room', ep, tl) ?? '';
    assert.doesNotMatch(ok, /has no character/, 'a <Staged> is a character');
    fs.writeFileSync(path.join(epDir, 'shots.tsx'), 'export const S1 = ({ t, len }) => <g><Person look={A} body="teen" pose={poseAt(t, [{ f: 0, p: {} }])} /></g>;\n');
    assert.doesNotMatch(shotsAudit(dir, 'room', ep, tl) ?? '', /has no character/, 'a <Person> is a character');
    assert.doesNotMatch(ok, /places something at/);
    fs.writeFileSync(path.join(epDir, 'shots.tsx'), shot(1.4));
    assert.match(shotsAudit(dir, 'room', ep, tl) ?? '', /places something at u 0\.4, w 1\.4/);

    assert.equal(hasGuide(), false, 'no Stage guide for an engine without stage.tsx');
    fs.mkdirSync(path.join(dir, 'src', 'engine'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'src', 'engine', 'stage.tsx'), 'export const Stage = 1;\n');
    assert.equal(hasGuide(), true, 'guide present once the engine has it');

    const three = `export const S1 = () => <Stage focus={0.6}><Staged at={{ u: 0.1, w: 0.2 }} /><Staged at={{ u: 0.5, w: 0.2 }} /><Staged at={{ u: 0.9, w: 0.2 }} /></Stage>;\n`;
    assert.match(staticMetrics(three), /1\/1 plans avec amorce floue · 1 plans à 3 personnages/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('cast: a seed is reproducible, what is given wins, unknown names fail with the list', async () => {
  const ts = (await import('typescript')).default;
  const src = fs.readFileSync(new URL('../engine-overlay/files/src/engine/cast.ts', import.meta.url), 'utf8');
  const out = ts.transpileModule(src, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText;
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'whatif-cast-'));
  const file = path.join(dir, 'cast.mjs');
  fs.writeFileSync(file, out);
  try {
    const { cast, COLORS, HAIR_COLORS } = await import(file);
    assert.deepEqual(cast({ seed: 'lou', body: 'teen' }), cast({ seed: 'lou', body: 'teen' }), 'same seed, same character');
    const seen = new Set(['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'].map((seed) => JSON.stringify(cast({ seed }))));
    assert.equal(seen.size, 8, 'different seeds give different characters');

    const lou = cast({ seed: 'lou', hair: { style: 'braids', color: 'red' }, outfit: ['hoodie:rose', 'jeans', 'tie:navy', 'backpack:teal'], face: { eyes: 'wide', facial: 'beard' }, skin: 'deep', acc: ['glasses:square', 'earrings', 'headband:teal'] });
    assert.equal(lou.cast.hairStyle, 'braids');
    assert.equal(lou.hair, HAIR_COLORS.red);
    assert.equal(lou.extra, 'bald', 'hair.tsx draws a new style, the rig head stays bald');
    assert.equal(lou.jacket, COLORS.rose);
    assert.equal(lou.cast.legs.color, COLORS.denim, 'jeans are denim unless told otherwise');
    assert.equal(lou.cast.neck.id, 'tie');
    assert.equal(lou.cast.back.color, COLORS.teal);
    assert.deepEqual(lou.cast.eyeR, [9, 12]);
    assert.equal(lou.cast.face.facial, 'beard');
    assert.equal(lou.cast.eyewear, 'square');
    assert.equal(lou.cast.earrings, true);
    assert.equal(lou.cast.headband, COLORS.teal);
    assert.equal(cast({ seed: 'x', hair: 'spiky' }).extra, 'spiky', 'a rig hairstyle stays with the rig');
    assert.equal(cast({ seed: 'x', hair: 'hijab' }).cast.newHair, true);

    for (let i = 0; i < 20; i++) assert.equal(cast({ seed: `t${i}`, body: 'teen', kind: 'masc' }).cast.face.facial, 'none', 'no beard picked for a teen');

    assert.throws(() => cast({ outfit: ['toga'] }), /unknown garment "toga".*hoodie/);
    assert.throws(() => cast({ acc: ['crown'] }), /unknown accessory "crown"/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('shots audit: two characters cannot share a bare seed', async () => {
  const { shotsAudit } = await import('../dist/tools/whatif.js');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'whatif-seed-'));
  const epDir = path.join(dir, 'src', 'episodes', 'room');
  fs.mkdirSync(epDir, { recursive: true });
  fs.writeFileSync(path.join(epDir, 'index.tsx'), 'export const room = defineEpisode("Room", { timeline, shots: { S1 } });\n');
  const body = 'export const S1 = ({ t }) => <Staged at={{ u: 0.4, w: 0.5 }} look={A} pose={poseAt(t, [{ f: 0, p: {} }])} />;\n';
  const ep = { shots: [{ id: 'S1', set: 'study', size: 'wide' }] };
  const tl = { shots: [{ id: 'S1', len: 60 }] };
  try {
    fs.writeFileSync(path.join(epDir, 'shots.tsx'), `const A = cast({ seed: 'x' });\nconst B = cast({ seed: 'x' });\n${body}`);
    assert.match(shotsAudit(dir, 'room', ep, tl) ?? '', /used for two characters/);
    fs.writeFileSync(path.join(epDir, 'shots.tsx'), `const A = cast({ seed: 'x' });\nconst B = cast({ seed: 'y' });\n${body}`);
    assert.doesNotMatch(shotsAudit(dir, 'room', ep, tl) ?? '', /used for two characters/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('actions: clips go from their first pose to their last, the near arm gestures, unknown names list the known ones', async () => {
  const ts = (await import('typescript')).default;
  const src = fs.readFileSync(new URL('../engine-overlay/files/src/engine/actions.ts', import.meta.url), 'utf8');
  const out = ts.transpileModule(src, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText;
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'whatif-act-'));
  const file = path.join(dir, 'actions.mjs');
  fs.writeFileSync(file, out);
  try {
    const { act, clip, gesture, turnAt, CLIPS, GESTURES } = await import(file);
    assert.ok(CLIPS.length >= 10 && GESTURES.length >= 18);

    assert.equal(clip('stand-up', 0, { from: 0 }).legL.a, 78, 'stand-up starts seated');
    assert.equal(clip('stand-up', 100, { from: 0 }).legL.a, 5, 'and ends standing');
    assert.equal(clip('stand-up', 15, { from: 20 }).legL.a, 78, 'holds its first pose before it starts');
    assert.equal(clip('stand-up', 46, { from: 20 }).legL.a, 5, 'and counts its length from `from`');
    assert.equal(clip('stand-up', 26, { from: 20 }).legL.a, 78, 'still seated at the start of its anticipation');
    assert.equal(clip('sit-down', 100, { from: 0 }).legL.a, 78, 'sit-down ends seated');
    assert.ok(clip('jump', 14, { from: 0 }).lift > 40, 'a jump leaves the ground');
    assert.equal(clip('jump', 100, { from: 0 }).lift, 0, 'and lands');
    assert.ok(clip('slump', 100, { yaw: 1 }).tilt > 0 && clip('slump', 100, { yaw: -1 }).tilt < 0, 'leans the way it faces');
    assert.ok(clip('slump', 100, { yaw: 1 }).headTilt > 0 && clip('slump', 100, { yaw: -1 }).headTilt < 0, 'head tips the way it faces');
    assert.equal(clip('slump', 100, { yaw: 0 }).tilt, 0, 'no sideways lean face-on');
    assert.ok(clip('bow', 10, { dur: 10, yaw: 1 }).tilt !== clip('bow', 10, { dur: 40, yaw: 1 }).tilt, 'dur changes the timing');

    const right = gesture('point', 10, { yaw: 0.6 });
    const left = gesture('point', 10, { yaw: -0.6 });
    assert.equal(right.handR, 'point');
    assert.equal(left.handL, 'point', 'facing left the near arm is the other one');
    assert.deepEqual(left.armL, right.armR);
    assert.notDeepEqual(gesture('cross-arms', 0, { yaw: 1 }).armR, gesture('cross-arms', 0, { yaw: 0 }).armR, 'folded arms have a side-on shape');
    assert.ok(Math.abs(gesture('talk', 3, { amp: 1.5 }).armR.a - 48) > Math.abs(gesture('talk', 3, { amp: 1 }).armR.a - 48), 'amp widens a gesture');

    assert.deepEqual(turnAt(100, [[0, 0.5], [18, 2]]), { yaw: 2, blink: 0 });
    assert.equal(turnAt(20, [[0, 0.5], [18, 2]]).blink, 1, 'turns through a blink');
    assert.equal(turnAt(0, [[0, 0.5], [18, 2]]).yaw, 0.5);

    assert.equal(act('explain', 5).talk !== undefined, true, 'act resolves a gesture');
    assert.ok(act('walk', 5).legL, 'and a clip');
    assert.throws(() => act('moonwalk', 0), /unknown action "moonwalk".*explain.*stand-up/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('shot(): the audit sees its people and its motion, and a wrong name at the top of shots.tsx is reported', async () => {
  const { shotsAudit } = await import('../dist/tools/whatif.js');
  const { staticMetrics } = await import('../dist/orchestrator/reviewer.js');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'whatif-shot-'));
  const epDir = path.join(dir, 'src', 'episodes', 'room');
  fs.mkdirSync(epDir, { recursive: true });
  fs.writeFileSync(path.join(epDir, 'index.tsx'), 'export const room = defineEpisode("Room", { timeline, shots: { S1, S2, S3, S4 } });\n');
  const ids = ['S1', 'S2', 'S3', 'S4'];
  const ep = { shots: ids.map((id) => ({ id, set: 'room', size: 'wide' })) };
  const tl = { shots: ids.map((id) => ({ id, len: 60 })) };
  const write = (body) => fs.writeFileSync(path.join(epDir, 'shots.tsx'), ids.map((id) => `export const ${id} = shot({ place: ROOM, ${body} });\n`).join(''));
  const audit = () => shotsAudit(dir, 'room', ep, tl) ?? '';
  try {
    write(`cam: 'wide', people: [{ who: A, at: { u: 0.4, w: 0.5 }, yaw: 0.45, act: 'talk', beats: [{ at: 12, face: 'shock' }] }]`);
    assert.equal(audit(), '', 'a described shot with a moment passes as it is');
    write(`cam: 'wide', people: [{ who: A, at: { u: 0.4, w: 0.5 }, yaw: 0.45, act: 'talk' }]`);
    assert.match(audit(), /4\/4 shots with people change nothing while they play \(S1, S2, S3, S4\)/, 'a shot that only loops one action is refused');
    write(`cam: 'wide', duo: { a: { who: A, at: { u: 0.3, w: 0.5 } }, b: { who: B, at: { u: 0.6, w: 0.5 } }, action: 'hug' }`);
    assert.equal(audit(), '', 'so does a duo');
    write(`cam: 'wide', people: []`);
    assert.match(audit(), /S1 .*has no character/, 'an empty cast is no character');
    write(`cam: 'wide', people: [{ who: A, at: { u: 0.4, w: 0.5 } }]`);
    assert.doesNotMatch(audit(), /is static/, 'the default slow push-in is motion');
    write(`cam: 'wide', move: 'still', people: [{ who: A, at: { u: 0.4, w: 0.5 } }]`);
    assert.match(audit(), /S1 is static/, 'held camera and nobody acting is static');
    write(`cam: 'wide', people: [{ who: A, at: { u: 0.4, w: 1.6 }, act: 'talk' }]`);
    assert.match(audit(), /places something at u 0\.4, w 1\.6/, 'floor positions are checked inside shot() too');

    assert.match(staticMetrics(`export const S1 = shot({ people: [{ who: A, yaw: 0.5 }, { who: B }, { who: C }] });\n`), /1\/1 plans avec un personnage orienté.*1 plans à 3 personnages/);
    assert.match(staticMetrics(`export const S1 = () => <Stage><Staged yaw={-1} /></Stage>;\n`), /1\/1 plans avec un personnage orienté/);
    assert.match(staticMetrics(`export const S1 = shot({ focus: 0.6, people: [{ who: A }] });\n`), /1\/1 plans avec amorce floue/);

    // the crash test runs when the project has react-dom: a stand-in is enough to reach the module load
    const nm = path.join(dir, 'node_modules');
    for (const [name, body] of [['typescript', "module.exports = require(process.env.TS_PATH);"], ['react', 'module.exports = { createElement: () => null };'], ['react-dom', 'module.exports = {};'], ['react-dom/server', 'module.exports = { renderToStaticMarkup: () => "" };'], ['react/jsx-runtime', 'module.exports = { jsx: () => null, jsxs: () => null };']]) {
      fs.mkdirSync(path.join(nm, name), { recursive: true });
      fs.writeFileSync(path.join(nm, name, 'index.js'), body);
    }
    process.env.TS_PATH = path.resolve('node_modules/typescript');
    fs.writeFileSync(path.join(dir, 'package.json'), '{}');
    fs.writeFileSync(path.join(epDir, 'shots.tsx'), ids.map((id) => `export const ${id} = shot({ place: ROOM, people: [{ who: A, at: { u: 0.4, w: 0.5 }, act: 'talk' }] });\n`).join('').replace(/^/, `const ROOM = 1;\nconst A = (() => { throw new Error('cast: unknown garment "cape"'); })();\nconst shot = (x) => () => null;\n`));
    assert.match(audit(), /shots\.tsx crashes when it loads: cast: unknown garment "cape"/);
  } finally {
    delete process.env.TS_PATH;
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('reviewer: an unreadable answer is never a validation, a text-only model is still heard, a refusal holds the render back', async () => {
  const { reviewEpisodeBoard, formatReviewFeedback, clearReviewBlock } = await import('../dist/orchestrator/reviewer.js');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'whatif-rev2-'));
  const epDir = path.join(dir, 'src', 'episodes', 'e');
  const outDir = path.join(dir, 'out', 'e');
  fs.mkdirSync(epDir, { recursive: true });
  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(path.join(epDir, 'shots.tsx'), 'export const S1 = () => null;\n');
  fs.writeFileSync(path.join(epDir, 'episode.json'), JSON.stringify({ script: [{ text: 'Bonjour.' }], shots: [] }));
  fs.writeFileSync(path.join(outDir, 'storyboard.jpg'), 'strip');
  const replies = (list) => {
    const calls = [];
    return { calls, provider: { model: 'fake', label: 'fake', chat: async (o) => {
      calls.push(o.messages);
      const next = list.shift();
      if (next instanceof Error) throw next;
      return { text: next ?? '', toolCalls: [] };
    } } };
  };
  const refused = '{"pass":false,"summary":"non","issues":[{"shot":"S1","severity":"error","problem":"p","fix":"f"}]}';
  try {
    const twice = replies(['', 'toujours pas du json']);
    const unread = await reviewEpisodeBoard(twice.provider, dir, 'e');
    assert.equal(twice.calls.length, 2, 'asks a second time');
    assert.equal(unread.ok, false);
    const text = formatReviewFeedback(unread, 'e');
    assert.match(text, /NON VÉRIFIÉ/);
    assert.doesNotMatch(text, /VALIDÉ ✓/);
    assert.equal(unread.blocking, false);

    const second = replies(['', '{"pass":true,"summary":"ok","issues":[]}']);
    assert.equal((await reviewEpisodeBoard(second.provider, dir, 'e')).ok, true, 'the second answer counts');

    const textOnly = replies([new Error('400 image input not supported'), '{"pass":true,"summary":"ok","issues":[]}']);
    const code = await reviewEpisodeBoard(textOnly.provider, dir, 'e');
    assert.equal(code.sawImages, false);
    assert.ok(textOnly.calls[0][1].images?.length, 'first with the images');
    assert.equal(textOnly.calls[1][1].images, undefined, 'then without');
    assert.match(formatReviewFeedback(code, 'e'), /code seul/);

    const down = replies([new Error('503'), new Error('503')]);
    await assert.rejects(reviewEpisodeBoard(down.provider, dir, 'e'), /503/);

    const first = await reviewEpisodeBoard(replies([refused]).provider, dir, 'e');
    assert.equal(first.blocking, true, 'a refusal with rounds left holds the render');
    assert.equal(JSON.parse(fs.readFileSync(path.join(outDir, 'review.json'), 'utf8')).blocking, true);
    clearReviewBlock(dir, 'e');
    assert.equal(JSON.parse(fs.readFileSync(path.join(outDir, 'review.json'), 'utf8')).blocking, false);
    assert.equal((await reviewEpisodeBoard(replies([refused]).provider, dir, 'e', undefined, { final: true })).blocking, false, 'the last round never holds it');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('agent loop: the reviewer speaks after every tool result of the step, a refused board stops the render', async () => {
  const { runTurn } = await import('../dist/orchestrator/agent.js');
  const { Db } = await import('../dist/orchestrator/db.js');
  const { reviewRefusal } = await import('../dist/tools/whatif.js');
  const { clearReviewBlock } = await import('../dist/orchestrator/reviewer.js');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'whatif-loop-'));
  const root = path.join(dir, 'p');
  const epDir = path.join(root, 'src', 'episodes', 'e');
  fs.mkdirSync(epDir, { recursive: true });
  fs.mkdirSync(path.join(root, 'out', 'e'), { recursive: true });
  fs.writeFileSync(path.join(epDir, 'shots.tsx'), 'export const S1 = () => null;\n');
  fs.writeFileSync(path.join(epDir, 'episode.json'), JSON.stringify({ script: [{ text: 'Bonjour.' }], shots: [] }));
  fs.writeFileSync(path.join(root, 'out', 'e', 'storyboard.jpg'), 'strip');
  const db = new Db(path.join(dir, 'app.db'));
  const ok = (name) => ({ name, description: name, policy: 'auto', schema: { type: 'object' }, run: async () => ({ ok: true, summary: name }) });
  const registry = new ToolRegistry([{ ...ok('whatif_run'), policy: 'ask' }, ok('whatif_status'), ok('git')]);
  try {
    db.createProject('p', 'p', root);
    const th = db.createThread('p', 't');
    db.addMessage(th.id, 'user', 'go');
    let step = 0;
    const provider = { id: 'x', label: 'x', model: 'm', chat: async () => {
      step++;
      if (step === 1) return { text: '', toolCalls: [{ id: 'a', name: 'whatif_run', args: { episode: 'e', step: 'board' } }, { id: 'b', name: 'whatif_status', args: { episode: 'e' } }] };
      return { text: 'fini', toolCalls: [] };
    } };
    const reviewer = { model: 'r', label: 'r', chat: async () => ({ text: '{"pass":false,"summary":"non","issues":[{"shot":"S1","severity":"error","problem":"p","fix":"f"}]}', toolCalls: [] }) };
    const bus = { emit() {} };
    const config = { ...loadConfig(), maxSteps: 6, reviewMaxRounds: 2, approvalsMode: 'off', contextChars: 90_000 };
    await runTurn({ db, bus, config, registry, approvals: null, provider: () => provider, reviewProvider: () => reviewer }, th.id, new AbortController().signal);
    const rows = db.listMessages(th.id).map((m) => m.role);
    const firstTool = rows.indexOf('tool');
    assert.deepEqual(rows.slice(firstTool, firstTool + 3), ['tool', 'tool', 'user'], 'no user message between the two tool results');

    assert.equal(JSON.parse(fs.readFileSync(path.join(root, 'out', 'e', 'review.json'), 'utf8')).blocking, true);
    assert.match(reviewRefusal(root, 'e'), /independent reviewer refused this board[\s\S]*\[S1\] p/);
    clearReviewBlock(root, 'e');
    assert.equal(reviewRefusal(root, 'e'), null);
  } finally {
    db.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('modern prompt: a project with shot() is never told to draw with Hero and poseAt', async () => {
  const { buildMessages, modernSystemPrompt, SYSTEM_PROMPT } = await import('../dist/orchestrator/context.js');
  const modern = modernSystemPrompt();
  for (const legacy of ['makeLook', '<Hero', 'grabAt', 'tableSit', '<CustomRoom>', 'actPose']) assert.equal(modern.includes(legacy), false, `${legacy} left in the modern prompt`);
  assert.match(modern, /Write the shots with `shot\(/);
  for (const kept of ['whatif_run voice', 'Batching rule', 'Clock `t`', 'Framing.']) assert.ok(modern.includes(kept), `${kept} must stay`);
  assert.ok(SYSTEM_PROMPT.includes('makeLook'), 'older engines keep their instructions');

  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'whatif-prompt-'));
  const engine = path.join(dir, 'src', 'engine');
  fs.mkdirSync(engine, { recursive: true });
  const sys = () => buildMessages({ projectRoot: dir, history: [], maxChars: 90_000 }).map((m) => m.content).join('\n');
  try {
    assert.doesNotMatch(sys(), /## shot\(\): describe/);
    fs.writeFileSync(path.join(engine, 'shot.tsx'), 'export const shot = 1;\n');
    const text = sys();
    assert.match(text, /## shot\(\): describe/);
    assert.doesNotMatch(text, /Engine cheat sheet/, 'the Hero cheat sheet is gone');
    assert.match(text, /### Choosing the place/);
    assert.doesNotMatch(text, /### Choosing the set/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('rhythm: words land on frames, the pace follows the length, the reviewer sees still and long shots', async () => {
  const { timedChanges, paceTarget, paceProblem } = await import('../dist/tools/whatif.js');
  const { shotWordFrames } = await import('../dist/orchestrator/context.js');
  const { timingMetrics, formatReviewFeedback } = await import('../dist/orchestrator/reviewer.js');
  assert.equal(timedChanges(`export const S1 = shot({ people: [{ who: A, act: 'idle', face: 'happy' }] });`), 0);
  assert.equal(timedChanges(`export const S1 = shot({ people: [{ who: A, beats: [{ at: 12, act: 'startle' }] }] });`), 1);
  assert.equal(timedChanges(`export const S1 = shot({ beats: [{ at: 30, cam: 'close' }], people: [{ who: A, at: { u: 0.2, w: 0.4 }, face: [[0, 'happy'], [20, 'shock']] }] });`), 2, 'a floor position is not a moment; a camera beat and a later face are');

  assert.deepEqual([paceTarget(20).minCutsPerMin, paceTarget(89).minCutsPerMin, paceTarget(962).minCutsPerMin], [24, 20, 10]);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'whatif-pace-'));
  const ep = path.join(dir, 'src', 'episodes', 'e');
  fs.mkdirSync(ep, { recursive: true });
  try {
    const tl = (n, len) => ({ fps: 30, total: n * len, shots: Array.from({ length: n }, (_, i) => ({ id: `S${i + 1}`, len })), segments: Array.from({ length: n }, (_, i) => ({ shot: `S${i + 1}`, a: i * len, b: (i + 1) * len, t0: 0 })) });
    fs.writeFileSync(path.join(ep, 'timeline.json'), JSON.stringify(tl(36, 801)));
    assert.match(paceProblem(dir, 'e'), /PACE TOO SLOW for a long video .* 36 shots over 961\.2s/, 'the y-school case: 36 shots for 16 min');
    fs.writeFileSync(path.join(ep, 'timeline.json'), JSON.stringify(tl(214, 135)));
    assert.equal(paceProblem(dir, 'e'), null, '4.5 s shots pass for a long video');
    fs.writeFileSync(path.join(ep, 'timeline.json'), JSON.stringify(tl(28, 96)));
    assert.match(paceProblem(dir, 'e'), /short \(under 2\.5 min\)/, '3.2 s shots are too slow for a short now');

    fs.writeFileSync(path.join(ep, 'timeline.json'), JSON.stringify({ fps: 30, total: 120, shots: [{ id: 'S1', len: 60 }, { id: 'S2', len: 60 }], segments: [{ shot: 'S1', a: 0, b: 60, t0: 0 }, { shot: 'S2', a: 60, b: 120, t0: 0 }] }));
    fs.writeFileSync(path.join(ep, 'words.json'), JSON.stringify([{ w: "J'ai", s: 0 }, { w: 'soulevé,', s: 0.4 }, { w: 'Mes', s: 2.1 }, { w: 'ciseaux', s: 2.5 }]));
    assert.deepEqual(shotWordFrames(dir, 'e'), ["S1 (60f): J'ai@0 soulevé@12", 'S2 (60f): Mes@3 ciseaux@15'], 'frames are the shot\'s own clock, punctuation dropped');
    assert.deepEqual(shotWordFrames(dir, 'e', ['S2']), ['S2 (60f): Mes@3 ciseaux@15']);
    const report = { ok: true, pass: false, model: 'm', episode: 'e', summary: 's', issues: [{ shot: 'S2', severity: 'error', problem: 'p', fix: 'f' }], createdAt: '' };
    assert.match(formatReviewFeedback(report, 'e', shotWordFrames(dir, 'e', ['S2'])), /mot@image[\s\S]*S2 \(60f\): Mes@3 ciseaux@15/);
    assert.match(timingMetrics(tl(3, 300)), /médiane 10\.0 s, la plus longue 10\.0 s .* 3 plan\(s\) de plus de 6 s \(S1, S2, S3\)/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('edit_shot: one shot is replaced by its id, its neighbours and their comments stay', async () => {
  const { replaceShot } = await import('../dist/tools/fs.js');
  const src = "import x;\nexport const S1 = shot({ a: 1 });\n// S2 — gros plan\nexport const S2 = shot({ b: 2 });\n\nexport const S3 = () => null;\n";
  const two = replaceShot(src, 'S2', 'export const S2 = shot({ b: 9 });');
  assert.equal(two.replaced, true);
  assert.equal(two.text, "import x;\nexport const S1 = shot({ a: 1 });\n// S2 — gros plan\nexport const S2 = shot({ b: 9 });\n\nexport const S3 = () => null;\n");
  const one = replaceShot(src, 'S1', 'export const S1 = shot({ a: 7 });').text;
  assert.match(one, /S1 = shot\(\{ a: 7 \}\);\n+\/\/ S2 — gros plan\nexport const S2 = shot\(\{ b: 2 \}\)/, 'the comment of S2 stays above S2');
  assert.equal(replaceShot(src, 'S3', 'export const S3 = () => 1;').text.endsWith('export const S3 = () => 1;\n'), true, 'the last shot runs to the end');
  const added = replaceShot(src, 'S4', 'export const S4 = () => 4;');
  assert.equal(added.replaced, false);
  assert.match(added.text, /S3 = \(\) => null;\n\nexport const S4 = \(\) => 4;\n$/);
  const tool = fsTools.find((t) => t.name === 'edit_shot');
  assert.match(tool.validate({ episode: 'e', id: 'S2', code: 'const S2 = 1' }), /must start with `export const S2 =`/);
  assert.equal(tool.validate({ episode: 'e', id: 'S2', code: '// gros plan\nexport const S2 = shot({});' }), null);
});

test('agent loop: the same render failure twice stops the turn instead of retrying for hours', async () => {
  const { runTurn } = await import('../dist/orchestrator/agent.js');
  const { Db } = await import('../dist/orchestrator/db.js');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'whatif-stop-'));
  const db = new Db(path.join(dir, 'app.db'));
  let renders = 0;
  const registry = new ToolRegistry([
    { name: 'whatif_run', description: 'r', policy: 'ask', schema: { type: 'object' }, run: async (a) => (a.step === 'render' ? (renders++, { ok: false, summary: `$ modal_render.py\nexit 124 (timeout)\n[modal] sources: ${renders}0.5 MB` }) : { ok: true, summary: 'ok' }) },
    { name: 'read_file', description: 'r', policy: 'auto', schema: { type: 'object' }, run: async () => ({ ok: true, summary: 'ok' }) },
    { name: 'git', description: 'g', policy: 'auto', schema: { type: 'object' }, run: async () => ({ ok: true, summary: 'ok' }) },
  ]);
  try {
    fs.mkdirSync(path.join(dir, 'p'), { recursive: true });
    db.createProject('p', 'p', path.join(dir, 'p'));
    const th = db.createThread('p', 't');
    db.addMessage(th.id, 'user', 'go');
    let n = 0;
    const provider = { id: 'x', label: 'x', model: 'm', chat: async () => {
      n++;
      // render, a successful read in between (what fooled the old loop-breaker), render again, then render forever
      const name = n % 2 === 0 ? 'read_file' : 'whatif_run';
      return { text: '', toolCalls: [{ id: `c${n}`, name, args: name === 'read_file' ? { path: 'x' } : { episode: 'e', step: 'render' } }] };
    } };
    const config = { ...loadConfig(), maxSteps: 20, reviewMaxRounds: 0, approvalsMode: 'off', contextChars: 90_000 };
    await runTurn({ db, bus: { emit() {} }, config, registry, approvals: null, provider: () => provider, reviewProvider: () => null }, th.id, new AbortController().signal);
    assert.equal(renders, 2, 'stops after the second identical failure');
    const last = db.listMessages(th.id).at(-1);
    assert.match(last.content, /Arrêt : render échoue toujours pour la même raison \(timeout\)/);
  } finally {
    db.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('engine overlay: hidden files of the overlay folder are never copied into a project', async () => {
  const { applyEngineOverlay } = await import('../dist/tools/engine-overlay.js');
  const overlay = fs.mkdtempSync(path.join(os.tmpdir(), 'whatif-ovsrc-'));
  const project = fs.mkdtempSync(path.join(os.tmpdir(), 'whatif-ovdst-'));
  try {
    fs.mkdirSync(path.join(overlay, 'files', 'src', 'engine'), { recursive: true });
    fs.mkdirSync(path.join(project, 'src', 'engine'), { recursive: true });
    fs.writeFileSync(path.join(overlay, 'files', '.DS_Store'), 'x');
    fs.writeFileSync(path.join(overlay, 'files', 'src', 'engine', '.DS_Store'), 'x');
    fs.writeFileSync(path.join(overlay, 'files', 'src', 'engine', 'new.ts'), 'export const n = 1;\n');
    const r = applyEngineOverlay(project, { overlayDir: overlay });
    assert.deepEqual(r.added, ['src/engine/new.ts']);
    assert.equal(fs.existsSync(path.join(project, '.DS_Store')), false);
  } finally {
    fs.rmSync(overlay, { recursive: true, force: true });
    fs.rmSync(project, { recursive: true, force: true });
  }
});


test('character audit resolves bounded component delegation without trusting text or unused declarations', async () => {
  const { shotsAudit } = await import('../dist/tools/whatif.js');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'whatif-delegate-'));
  const epDir = path.join(dir, 'src', 'episodes', 'room');
  fs.mkdirSync(epDir, { recursive: true });
  fs.writeFileSync(path.join(epDir, 'index.tsx'), 'S1');
  const audit = (source) => {
    fs.writeFileSync(path.join(epDir, 'shots.tsx'), source);
    return shotsAudit(dir, 'room', { shots: [{ id: 'S1', size: 'medium' }] }, { shots: [{ id: 'S1', len: 60 }] }) ?? '';
  };
  try {
    assert.doesNotMatch(audit(`const Prim: React.FC<any> = p => <Staged {...p}/>; export const S1 = () => <Prim/>;`), /S1 .*has no character/);
    assert.doesNotMatch(audit(`function Inner() { return <Hero/>; } const Outer = () => <Inner/>; export function S1() { return <Outer/>; }`), /S1 .*has no character/);
    assert.match(audit(`export const S1 = () => { const unused = <Hero/>; return <g/>; };`), /S1 .*has no character/);
    assert.match(audit(`const Empty = () => <g/>; const Unused = () => <Hero/>; export const S1 = () => <Empty/>;`), /S1 .*has no character/);
    assert.match(audit(`// const Fake = () => <Hero/>;
 export const S1 = () => <g>{'<Hero/>'}</g>;`), /S1 .*has no character/);
    assert.match(audit(`const A = () => <B/>; const B = () => <A/>; export const S1 = () => <A/>;`), /character.*unknown|unknown.*character/i);
    assert.match(audit(`export const S1 = () => <Mystery/>;`), /character.*unknown|unknown.*character/i);
    const ids = ['S1','S2','S3'];
    fs.writeFileSync(path.join(epDir, 'index.tsx'), ids.join(' '));
    fs.writeFileSync(path.join(epDir, 'shots.tsx'), `const Prim = () => <Staged/>;\n` + ids.map(id => `export const ${id} = () => <Prim/>;`).join('\n'));
    assert.match(shotsAudit(dir, 'room', {shots: ids.map(id => ({id, size:'medium'}))}, {shots:ids.map(id => ({id, len:60}))}) ?? '', /shots with people change nothing/);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('real telephone-salon shots do not falsely lose delegated characters', async () => {
  const { shotsAudit } = await import('../dist/tools/whatif.js');
  const root = path.resolve('data/projects/telephone-salon-7609890127925513503');
  if (!fs.existsSync(root)) return;
  const src = path.join(root, 'src/episodes/telephone-salon');
  const episode = JSON.parse(fs.readFileSync(path.join(src, 'episode.json')));
  const timeline = JSON.parse(fs.readFileSync(path.join(src, 'timeline.json')));
  const result = shotsAudit(root, 'telephone-salon', episode, timeline) ?? '';
  for (const id of ['S9','S10','S12']) {
    const one = shotsAudit(root, 'telephone-salon', episode, { ...timeline, shots: timeline.shots.filter(s => s.id === id) }) ?? '';
    assert.doesNotMatch(one, new RegExp(`${id} .*has no character`));
  }
  assert.match(result, /S6 .*character presence unknown/);
  assert.match(result, /S19 .*character presence unknown/);
});
