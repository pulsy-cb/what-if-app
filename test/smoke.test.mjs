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
    "2/3 plans avec un personnage orienté (yaw >= 0,3, tableSit ou walkPose) · 1/3 plans avec amorce floue au premier plan (Foreground) · 0 autres avec seulement un flou de profondeur (pas une amorce) · 1 plans à 3 personnages ou plus · 3 plans avec personnages où rien ne change pendant le plan · 0 plans où l'unique action est idle",
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
    const seenCalls = [];
    const provider = {
      model: 'fake',
      label: 'fake',
      chat: async (o) => {
        seenCalls.push(o.messages);
        return { text: '{"pass":true,"summary":"ok","issues":[]}', toolCalls: [], finishReason: 'stop' };
      },
    };
    const report = await reviewEpisodeBoard(provider, dir, 'e');
    assert.equal(report.ok, true);
    assert.equal(seenCalls.length, 2, '8 sheets are audited in 2 batches (6 + 2) so zero sheets are dropped');
    const batch1User = seenCalls[0].find((m) => m.role === 'user');
    const batch2User = seenCalls[1].find((m) => m.role === 'user');
    assert.equal(batch1User.images.length, 6, 'batch 1 gets at most 6 sheets');
    assert.equal(batch2User.images.length, 2, 'batch 2 gets the remaining 2 sheets');
    assert.equal(Buffer.from(batch1User.images[0].data, 'base64').toString(), 'sheet1', 'sheets in natural order, not the strip');
    assert.equal(Buffer.from(batch2User.images[0].data, 'base64').toString(), 'sheet7', 'second batch starts at sheet 7');
    assert.match(batch1User.content, /2\/3 plans avec un personnage orienté/);
    assert.match(batch1User.content, /planches 1 à 6 sur 8/);
    assert.match(batch2User.content, /planches 7 à 8 sur 8/);

    fs.rmSync(path.join(outDir, 'sheets'), { recursive: true });
    seenCalls.length = 0;
    await reviewEpisodeBoard(provider, dir, 'e');
    assert.equal(seenCalls[0].find((m) => m.role === 'user').images.length, 1, 'falls back to storyboard.jpg when there are no sheets');
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
    assert.match(staticMetrics(three), /0\/1 plans avec amorce floue au premier plan \(Foreground\) · 1 autres avec seulement un flou de profondeur \(pas une amorce\) · 1 plans à 3 personnages/);
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
    write(`cam: 'wide', people: [{ who: A, at: { u: -0.3, w: 0.2 }, act: 'talk', beats: [{ at: 9, face: 'shock' }] }]`);
    assert.doesNotMatch(audit(), /places something at/, 'outdoor pieces line the far side from u -0.3 to 1.3');
    write(`cam: 'wide', people: [{ who: A, at: { u: -0.7, w: 0.2 }, act: 'talk', beats: [{ at: 9, face: 'shock' }] }]`);
    assert.match(audit(), /places something at u -0\.7/);
    write(`cam: 'wide', people: [{ who: A, at: { u: 0.4, w: 1.6 }, act: 'talk' }]`);
    assert.match(audit(), /places something at u 0\.4, w 1\.6/, 'floor positions are checked inside shot() too');

    assert.match(staticMetrics(`export const S1 = shot({ people: [{ who: A, yaw: 0.5 }, { who: B }, { who: C }] });\n`), /1\/1 plans avec un personnage orienté.*1 plans à 3 personnages/);
    assert.match(staticMetrics(`export const S1 = () => <Stage><Staged yaw={-1} /></Stage>;\n`), /1\/1 plans avec un personnage orienté/);
    assert.match(staticMetrics(`export const S1 = shot({ focus: 0.6, people: [{ who: A }] });\n`), /0\/1 plans avec amorce floue au premier plan \(Foreground\) · 1 autres avec seulement un flou de profondeur/);
    assert.match(staticMetrics(`export const S1 = shot({ foreground: 'plant', people: [{ who: A }] });\n`), /1\/1 plans avec amorce floue au premier plan \(Foreground\)/);

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

test('cast types: the channel heroine in one line, types that a story changes, eyes, stripes and dresses', async () => {
  const ts = (await import('typescript')).default;
  const src = fs.readFileSync(new URL('../engine-overlay/files/src/engine/cast.ts', import.meta.url), 'utf8');
  const out = ts.transpileModule(src, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText;
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'whatif-cast2-'));
  const file = path.join(dir, 'cast.mjs');
  fs.writeFileSync(file, out);
  try {
    const { cast, CAST_TYPES, EYE_COLORS, COLORS } = await import(file);
    const her = cast({ as: 'heroine', seed: 'her' });
    assert.equal(her.cast.hairStyle, 'braided-bun');
    assert.equal(her.cast.newHair, true, 'drawn by hair.tsx, the rig head stays bald');
    assert.deepEqual(her.cast.iris, [EYE_COLORS.blue, EYE_COLORS.green], 'one blue eye, one green');
    assert.equal(her.cast.face.marks, 'freckles');
    assert.equal(her.cast.legs.id, 'joggers');
    assert.equal(her.cast.legs.accent, COLORS.mustard, 'the yellow side stripe');
    assert.deepEqual(her.cast.print, { text: 'her', color: COLORS.coral });
    assert.deepEqual(cast({ as: 'heroine', seed: 'her' }), her, 'the same every time: she stays the same across episodes');

    const party = cast({ as: 'heroine', seed: 'her', outfit: ['dress:green', 'formal:white'], face: { brows: 'arched' } });
    assert.equal(party.cast.top.id, 'dress', 'what is given wins over the type');
    assert.equal(party.cast.legs.id, 'dress', 'a dress is also the skirt');
    assert.equal(party.cast.face.marks, 'freckles', 'face fields merge: the freckles stay');
    assert.equal(party.cast.face.brows, 'arched');
    assert.equal(party.cast.hairStyle, 'braided-bun');

    assert.equal(cast({ seed: 'x', eyes: 'hazel' }).cast.iris[0], EYE_COLORS.hazel);
    assert.equal(cast({ seed: 'x' }).cast.iris, undefined, 'no colour given: the plain dark eye of the style');
    assert.equal(cast({ seed: 'x', outfit: ['joggers:navy'] }).cast.legs.accent, COLORS.white, 'joggers keep a stripe by default');
    assert.equal(cast({ seed: 'x', outfit: ['jeans'] }).cast.legs.accent, undefined);
    assert.throws(() => cast({ as: 'pirate' }), /unknown type "pirate" \(known: heroine, mother/);
    for (const t of Object.keys(CAST_TYPES)) assert.doesNotThrow(() => cast({ as: t, seed: t }), `type ${t} builds`);
    assert.equal(cast({ as: 'police', seed: 'p' }).hair, '#1E2A44', 'a navy cap, not the seed\'s hair colour');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
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
    // Real phone close-ups delegate to a room with imported decor. Unknown imports
    // must not be assumed empty or used as proof of a character.
    assert.match(audit(`import { WallClock } from './engine'; const Room = () => <g><WallClock/></g>; const PhoneScreen = () => <g><rect/></g>; export const S1 = () => <g><Room/><PhoneScreen/></g>;`), /S1 .*character presence unknown/);
    assert.match(audit(`const Room = () => <g><rect/></g>; const PhoneScreen = () => <g><circle/><path/></g>; export const S1 = () => <g><Room/><PhoneScreen/></g>;`), /S1 .*has no character/);
    const ids = ['S1','S2','S3'];
    fs.writeFileSync(path.join(epDir, 'index.tsx'), ids.join(' '));
    fs.writeFileSync(path.join(epDir, 'shots.tsx'), `const Prim = () => <Staged/>;\n` + ids.map(id => `export const ${id} = () => <Prim/>;`).join('\n'));
    assert.match(shotsAudit(dir, 'room', {shots: ids.map(id => ({id, size:'medium'}))}, {shots:ids.map(id => ({id, len:60}))}) ?? '', /shots with people change nothing/);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('real telephone-salon shots do not falsely lose delegated characters', async () => {
  const { shotsAudit } = await import('../dist/tools/whatif.js');
  const root = path.resolve('test/fixtures/telephone-salon');
  const src = path.join(root, 'src/episodes/telephone-salon');
  const episode = JSON.parse(fs.readFileSync(path.join(src, 'episode.json'), 'utf8'));
  const timeline = JSON.parse(fs.readFileSync(path.join(src, 'timeline.json'), 'utf8'));
  const result = shotsAudit(root, 'telephone-salon', episode, timeline) ?? '';
  for (const id of ['S9','S10','S12']) {
    const one = shotsAudit(root, 'telephone-salon', episode, { ...timeline, shots: timeline.shots.filter(s => s.id === id) }) ?? '';
    assert.doesNotMatch(one, new RegExp(`${id} .*has no character`));
  }
  assert.match(result, /S6 .*character presence unknown/);
  assert.match(result, /S19 .*character presence unknown/);
});

test('vertical 9:16 pace: paceTarget and shotlist.py cut a 160s vertical episode at short rhythm (>= 20 cuts/min)', async () => {
  const { paceTarget } = await import('../dist/tools/whatif.js');
  const { execFileSync } = await import('node:child_process');
  assert.deepEqual(
    { minCutsPerMin: paceTarget(160, '9:16').minCutsPerMin, maxShotSec: paceTarget(160, '9:16').maxShotSec },
    { minCutsPerMin: 20, maxShotSec: 5 },
  );
  assert.deepEqual(
    { minCutsPerMin: paceTarget(160, '16:9').minCutsPerMin, maxShotSec: paceTarget(160, '16:9').maxShotSec },
    { minCutsPerMin: 10, maxShotSec: 9 },
  );

  // Build a 160-second synthetic French narration + words.json and verify shotlist.py cuts ~60+ shots in 9:16 vs ~35 in 16:9
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'whatif-shotlist916-'));
  try {
    const epDir = path.join(dir, 'src', 'episodes', 'vert');
    fs.mkdirSync(epDir, { recursive: true });
    const sentences = Array.from(
      { length: 40 },
      (_, i) => `Ensuite Léa regarde le téléphone posé sur la table numéro ${i + 1}, et Marc répond tout bas devant Luisa.`,
    );
    const words = [];
    let t = 0.2;
    for (const s of sentences) {
      const toks = s.split(/\s+/);
      for (const w of toks) {
        words.push({ w, s: Number(t.toFixed(3)), e: Number((t + 0.22).toFixed(3)) });
        t += 0.25;
      }
      t += 0.25; // clause pause around ~160s total
    }
    fs.writeFileSync(path.join(epDir, 'words.json'), JSON.stringify(words));
    const baseEp = {
      id: 'Vert',
      slug: 'vert',
      title: ['CE QUE J’AI VU', 'SUR SON TÉLÉPHONE'],
      defaultSet: 'salon',
      script: sentences.map((text, i) => ({ beat: `b${i + 1}`, text })),
      shots: [],
    };
    fs.writeFileSync(path.join(epDir, 'episode.json'), JSON.stringify({ ...baseEp, aspect: '9:16' }));
    execFileSync('python3', [path.resolve('pipeline/shotlist.py'), 'vert', '--project', dir], { stdio: 'pipe' });
    const ep916 = JSON.parse(fs.readFileSync(path.join(epDir, 'episode.json'), 'utf8'));
    assert.ok(ep916.shots.length >= 55, `expected >= 55 shots for 160s 9:16, got ${ep916.shots.length}`);

    fs.writeFileSync(path.join(epDir, 'episode.json'), JSON.stringify({ ...baseEp, aspect: '16:9' }));
    execFileSync('python3', [path.resolve('pipeline/shotlist.py'), 'vert', '--project', dir], { stdio: 'pipe' });
    const ep169 = JSON.parse(fs.readFileSync(path.join(epDir, 'episode.json'), 'utf8'));
    assert.ok(ep916.shots.length > ep169.shots.length + 12, `9:16 (${ep916.shots.length}) must cut faster than 16:9 (${ep169.shots.length})`);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('reviewer: keeps >25KB episode.json script, reads 9:16 from studio.config.ts, extracts cast/components and DIRECTOR size mismatches', async () => {
  const { summarizeShotsCode, reviewEpisodeBoard } = await import('../dist/orchestrator/reviewer.js');
  const code = [
    `const NARR = cast({ seed: 'narr' });`,
    `const MARC = cast({ seed: 'marc' });`,
    `const Prim = (p) => <Staged {...p} />;`,
    `export const S1 = ({ t }) => <Stage><Prim who={NARR} at={{ u: 0.4, w: 0.5 }} /></Stage>;`,
    `export const S2 = ({ t }) => <g><rect /></g>;`,
  ].join('\n');
  const summary = summarizeShotsCode(code);
  assert.match(summary, /### Composants du fichier[\s\S]*const Prim =/);
  assert.match(summary, /- S1 \(personnages cités : NARR\):/);
  assert.match(summary, /- S2 \(personnages cités : aucun\):/);

  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'whatif-bigrev-'));
  try {
    const epDir = path.join(dir, 'src', 'episodes', 'big');
    const outDir = path.join(dir, 'out', 'big');
    fs.mkdirSync(epDir, { recursive: true });
    fs.mkdirSync(outDir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'src', 'studio.config.ts'), `export const STUDIO = { width: 1080, height: 1920, aspect: '9:16' };\n`);
    // Build an episode.json > 28 KB without explicit aspect, plus a S6 size mismatch vs DIRECTOR.md
    const bigScript = Array.from({ length: 180 }, (_, i) => ({
      beat: `beat-${i + 1}`,
      text: `Phrase narrative numéro ${i + 1} avec un témoin unique PHRASE_FINALE_${i + 1} dans le salon de manucure.`,
    }));
    const epJson = JSON.stringify(
      {
        id: 'Big',
        slug: 'big',
        script: bigScript,
        shots: [
          { id: 'S1', size: 'wide', set: 'nails', note: 'ouverture' },
          { id: 'S6', size: 'insert', set: 'nails', note: 'reclassé en douce' },
        ],
      },
      null,
      2,
    );
    assert.ok(Buffer.byteLength(epJson) > 25_000, `episode.json should exceed 25 KB (got ${Buffer.byteLength(epJson)})`);
    fs.writeFileSync(path.join(epDir, 'episode.json'), epJson);
    fs.writeFileSync(
      path.join(epDir, 'DIRECTOR.md'),
      `# DIRECTOR\n\n| plan | cadrage | action |\n|---|---|---|\n| S1 | large | ouverture |\n| S6 | close | réaction visage de Léa |\n`,
    );
    fs.writeFileSync(path.join(epDir, 'shots.tsx'), code);
    fs.writeFileSync(path.join(outDir, 'storyboard.jpg'), 'fake');

    let capturedPrompt = '';
    const provider = {
      model: 'fake-rev',
      label: 'fake',
      chat: async ({ messages }) => {
        capturedPrompt = messages.find((m) => m.role === 'user')?.content ?? '';
        return { text: JSON.stringify({ pass: true, summary: 'OK', issues: [] }) };
      },
    };
    await reviewEpisodeBoard(provider, dir, 'big');
    assert.match(capturedPrompt, /orientation:\s*9:16/, 'falls back to studio.config.ts for 9:16');
    assert.match(capturedPrompt, /Phrase narrative numéro 1\b/, 'script is NOT dropped when episode.json > 25 KB');
    assert.match(capturedPrompt, /écarts de taille DIRECTOR\.md ↔ episode\.json \(1\) : S6 \(DIRECTOR\.md="close" vs episode\.json="insert"\)/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('suite-telephone-salon guards: boardStale, >50% hand-written shots, phoneShot, portraitFramingErrors & directorSizeMismatches', async () => {
  const { boardStale, shotsAudit, portraitFramingErrors, directorSizeMismatches } = await import('../dist/tools/whatif.js');
  const { defaultRegistry } = await import('../dist/tools/index.js');

  // 1. Real telephone-salon fixture: portraitFramingErrors catches 16:9 ceiling rect + zoom 1.0, and directorSizeMismatches catches S6 close -> insert
  const fixSrc = path.resolve('test/fixtures/telephone-salon/src/episodes/telephone-salon');
  const fixShots = fs.readFileSync(path.join(fixSrc, 'shots.tsx'), 'utf8');
  const fixDirMd = fs.readFileSync(path.join(fixSrc, 'DIRECTOR.md'), 'utf8');
  const fixEp = JSON.parse(fs.readFileSync(path.join(fixSrc, 'episode.json'), 'utf8'));
  assert.deepEqual(directorSizeMismatches(fixDirMd, fixEp), [], 'original 2b35574 DIRECTOR.md and episode.json match');
  const mutatedEp = {
    ...fixEp,
    shots: fixEp.shots.map((s) => (s.id === 'S6' ? { ...s, size: 'insert' } : s)),
  };
  assert.deepEqual(directorSizeMismatches(fixDirMd, mutatedEp), ['S6 (DIRECTOR.md="close" vs episode.json="insert")']);

  const fixFraming = portraitFramingErrors(fixShots, { S1: fixShots.slice(fixShots.indexOf('export const S1')) }, ['S1'], { S1: { size: 'wide' } });
  assert.ok(fixFraming.some((e) => /clamps its backdrop\/ceiling to y=0\.\.1080/.test(e)), 'catches y=0 width=1920 ceiling rect');
  assert.ok(fixFraming.some((e) => /S1 frames a 9:16 shot with a 16:9 wide zoom \(1 around y=620\)/.test(e)), 'catches zoom=1.0 at y=620');
  const reflFraming = portraitFramingErrors(`<g transform="translate(0 1080) scale(1 -1)"><rect /></g>`);
  assert.ok(reflFraming.some((e) => /flips a floor reflection around y=1080/.test(e)), 'catches translate(0 1080) scale(1 -1)');

  // 2. Hand-written shot rule (>50% character shots without shot() refused; inserts & phoneShot accepted) + boardStale + 9:16 e2e gate simulation
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'whatif-guards-'));
  try {
    const slug = 'salon916';
    const epDir = path.join(dir, 'src', 'episodes', slug);
    const outDir = path.join(dir, 'out', slug);
    const pubDir = path.join(dir, 'public', slug);
    fs.mkdirSync(path.join(dir, 'src', 'engine'), { recursive: true });
    fs.mkdirSync(epDir, { recursive: true });
    fs.mkdirSync(outDir, { recursive: true });
    fs.mkdirSync(pubDir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'src', 'engine', 'shot.tsx'), 'export const shot = () => () => null;\nexport const phoneShot = () => () => null;\n');

    const ids = ['S1', 'S2', 'S3', 'S4', 'S5', 'S6'];
    fs.writeFileSync(path.join(epDir, 'index.tsx'), `export const salon916 = defineEpisode("Salon", { timeline, shots: { ${ids.join(', ')} } });\n`);
    const tl6 = { fps: 30, total: 360, segments: ids.map((id, i) => ({ shot: id, a: i * 60, b: (i + 1) * 60 })), shots: ids.map((id) => ({ id, len: 60, key: 18 })) };
    const ep6Char = { aspect: '9:16', script: Array.from({ length: 4 }, (_, i) => ({ beat: `b${i}`, text: 'Un texte français complet et fluide dans le salon.' })), science: [{ claim: 'c', working: 'w', source: 's' }], shots: ids.map((id) => ({ id, size: 'medium', set: 'nails', note: 'scène' })) };

    // 4/6 character shots written by hand -> refused
    const fourByHand = [
      `export const S1 = shot({ place: R, cam: 'medium', people: [{ who: A, on: 'tech1', act: 'talk', beats: [{ at: 12, face: 'shock' }] }] });`,
      `export const S2 = shot({ place: R, cam: 'close', people: [{ who: A, on: 'tech1', act: 'talk', beats: [{ at: 12, face: 'happy' }] }] });`,
      ...['S3', 'S4', 'S5', 'S6'].map(
        (id) => `export const ${id} = ({ t }) => <Stage><Staged who={A} at={{ u: 0.4, w: 0.5 }} act="talk" face={faceAt(t, [[0, 'neutral'], [15, 'shock']])} /></Stage>;`,
      ),
    ].join('\n');
    fs.writeFileSync(path.join(epDir, 'shots.tsx'), fourByHand);
    assert.match(shotsAudit(dir, slug, ep6Char, tl6) ?? '', /4\/6 shots with people are written by hand instead of shot/);

    // Same 4 shots marked as "insert" (e.g. phoneShot / object inserts) -> accepted!
    const epWithInserts = {
      ...ep6Char,
      shots: ids.map((id, i) => ({ id, size: i >= 2 ? 'insert' : 'medium', set: 'nails', note: 'insert téléphone' })),
    };
    const withPhoneShots = [
      `export const S1 = shot({ place: R, cam: 'medium', people: [{ who: A, on: 'tech1', act: 'talk', beats: [{ at: 12, face: 'shock' }] }] });`,
      `export const S2 = shot({ place: R, cam: 'close', people: [{ who: A, on: 'tech1', act: 'talk', beats: [{ at: 12, face: 'happy' }] }] });`,
      `export const S3 = phoneShot({ contact: { name: 'Inconnu' }, messages: [{ from: 'them', text: 'Salut', at: 10 }] });`,
      `export const S4 = phoneShot({ lock: { time: '21:14' }, notify: { title: 'Chloé', text: 'Tu me manques', at: 12 } });`,
      `export const S5 = ({ t }) => <g transform={camPush(t, 60, 960, 540, 1.2, 1.3)}><rect x={800} y={400} width={320} height={200} /></g>;`,
      `export const S6 = ({ t }) => <g transform={camPush(t, 60, 960, 540, 1.2, 1.3)}><circle cx={960} cy={540} r={90} /></g>;`,
    ].join('\n');
    fs.writeFileSync(path.join(epDir, 'shots.tsx'), withPhoneShots + `\n// poseAt(t, []) act: 'talk' at: 10 at: 12 at: 15 at: 20\n`);
    assert.equal(shotsAudit(dir, slug, epWithInserts, tl6), null, 'phoneShot + insert shots pass shotsAudit cleanly');

    // boardStale check: storyboard older than shots.tsx blocks render; current storyboard passes
    const boardPath = path.join(outDir, 'storyboard.jpg');
    const shotsPath = path.join(epDir, 'shots.tsx');
    fs.writeFileSync(boardPath, 'jpg');
    const now = Date.now() / 1000;
    fs.utimesSync(boardPath, now - 20, now - 20);
    fs.utimesSync(shotsPath, now, now);
    assert.match(boardStale(dir, slug) ?? '', /shots\.tsx changed after the last board/);

    // End-to-end prerequisite simulation on a 160s 9:16 episode via whatif_run:
    // (a) 36 shots over 160s in 9:16 -> refused by vertical pace gate (needs >= 20 cuts/min)
    fs.writeFileSync(path.join(epDir, 'words.json'), JSON.stringify([{ w: 'un', s: 0, e: 0.5 }]));
    fs.writeFileSync(path.join(pubDir, 'voice.wav'), 'wav');
    fs.writeFileSync(path.join(epDir, 'DIRECTOR.md'), '# DIRECTOR\n'.padEnd(260, 'Mise en scène détaillée du salon de manucure en 9:16. '));
    const slowIds = Array.from({ length: 36 }, (_, i) => `S${i + 1}`);
    const slowSegs = slowIds.map((id, i) => ({ shot: id, a: Math.round((i * 4800) / 36), b: Math.round(((i + 1) * 4800) / 36) }));
    fs.writeFileSync(
      path.join(epDir, 'episode.json'),
      JSON.stringify({ ...ep6Char, shots: slowIds.map((id) => ({ id, size: 'medium', set: 'nails', note: 'action' })) }),
    );
    fs.writeFileSync(
      path.join(epDir, 'timeline.json'),
      JSON.stringify({ fps: 30, total: 4800, segments: slowSegs, shots: slowIds.map((id) => ({ id, len: 133, key: 18 })) }),
    );
    const ctx = { projectId: 'p', projectRoot: dir, dataRoot: dir, skillDir: dir, log: () => {} };
    const slowRes = await defaultRegistry().run('whatif_run', { episode: slug, step: 'stills' }, ctx);
    assert.equal(slowRes.ok, false);
    assert.match(slowRes.summary, /PACE TOO SLOW for a vertical short \(9:16, any length\)/);

    // (b) 60 shots over 160s passes pace, then stale board blocks render!
    const fastIds = Array.from({ length: 60 }, (_, i) => `S${i + 1}`);
    const fastSegs = fastIds.map((id, i) => ({ shot: id, a: i * 80, b: (i + 1) * 80 }));
    fs.writeFileSync(
      path.join(epDir, 'episode.json'),
      JSON.stringify({ ...ep6Char, shots: fastIds.map((id) => ({ id, size: 'medium', set: 'nails', note: 'action' })) }),
    );
    fs.writeFileSync(
      path.join(epDir, 'timeline.json'),
      JSON.stringify({ fps: 30, total: 4800, segments: fastSegs, shots: fastIds.map((id) => ({ id, len: 80, key: 18 })) }),
    );
    fs.writeFileSync(path.join(epDir, 'index.tsx'), `export const salon916 = defineEpisode("Salon", { timeline, shots: { ${fastIds.join(', ')} } });\n`);
    fs.writeFileSync(
      shotsPath,
      fastIds
        .map((id) => `export const ${id} = shot({ place: R, cam: 'medium', people: [{ who: A, on: 'tech1', act: 'talk', beats: [{ at: 12, face: 'shock' }] }] });`)
        .join('\n'),
    );
    fs.utimesSync(boardPath, now - 20, now - 20);
    fs.utimesSync(shotsPath, now + 5, now + 5);
    const staleRes = await defaultRegistry().run('whatif_run', { episode: slug, step: 'render' }, ctx);
    assert.equal(staleRes.ok, false);
    assert.match(staleRes.summary, /shots\.tsx changed after the last board/);
    fs.utimesSync(boardPath, now + 10, now + 10);
    assert.equal(boardStale(dir, slug), null, 'fresh storyboard clears boardStale');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('projects and threads archiving, renaming, and activity metadata over HTTP + SQLite migration', async () => {
  const { dir, app } = tmpApp();
  await new Promise((resolve) => app.server.listen(0, '127.0.0.1', resolve));
  const port = app.server.address().port;
  const base = `http://127.0.0.1:${port}`;
  try {
    const p1 = await (
      await fetch(`${base}/api/projects`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name: 'Ancien Projet' }),
      })
    ).json();
    const p2 = await (
      await fetch(`${base}/api/projects`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name: 'Projet Actif' }),
      })
    ).json();
    assert.equal(p1.project.archived_at, null);
    assert.equal(p2.project.archived_at, null);

    // Create two threads in p2
    const t1 = await (
      await fetch(`${base}/api/threads`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ projectId: p2.project.id, title: 'Brouillon initial' }),
      })
    ).json();
    const t2 = await (
      await fetch(`${base}/api/threads`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ projectId: p2.project.id, title: 'Conversation principale' }),
      })
    ).json();
    assert.equal(t1.archived_at, null);
    assert.equal(t2.archived_at, null);

    // Archive thread t1 and rename t2
    const t1Arch = await (
      await fetch(`${base}/api/threads/${t1.id}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ archived: true }),
      })
    ).json();
    assert.equal(typeof t1Arch.archived_at, 'string');

    const t2Ren = await (
      await fetch(`${base}/api/threads/${t2.id}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ title: ' Montage final ' }),
      })
    ).json();
    assert.equal(t2Ren.title, 'Montage final');

    // Archive project p1
    const p1Arch = await (
      await fetch(`${base}/api/projects/${p1.project.id}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ archived: true, name: 'Ancien Projet (V1)' }),
      })
    ).json();
    assert.equal(typeof p1Arch.archived_at, 'string');
    assert.equal(p1Arch.name, 'Ancien Projet (V1)');

    // Verify GET /api/projects reflects archive state and thread counts
    const list = await (await fetch(`${base}/api/projects`)).json();
    const gotP1 = list.find((p) => p.id === p1.project.id);
    const gotP2 = list.find((p) => p.id === p2.project.id);
    assert.ok(gotP1.archived_at);
    assert.equal(gotP2.archived_at, null);
    assert.equal(gotP2.threadCount, 1);
    assert.equal(gotP2.archivedThreadCount, 1);
    assert.equal(typeof gotP2.lastActivityAt, 'string');

    // Unarchive project p1 and thread t1
    const p1Restored = await (
      await fetch(`${base}/api/projects/${p1.project.id}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ archived: false }),
      })
    ).json();
    assert.equal(p1Restored.archived_at, null);

    const t1Restored = await (
      await fetch(`${base}/api/threads/${t1.id}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ archived: false }),
      })
    ).json();
    assert.equal(t1Restored.archived_at, null);

    // Verify static UI serves theme toggle & archive hooks
    const indexHtml = await (await fetch(`${base}/`)).text();
    assert.match(indexHtml, /theme-toggle/);
    assert.match(indexHtml, /toggle-archived-projects/);
  } finally {
    await app.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('loop-breaker: hashes full tool args (>240 chars) without false stops, and emits assistant message on real 5x identical loop', async () => {
  const { runTurn } = await import('../dist/orchestrator/agent.js');
  const { Db } = await import('../dist/orchestrator/db.js');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'whatif-loophash-'));
  const db = new Db(path.join(dir, 'app.db'));
  try {
    const pRoot = path.join(dir, 'p');
    fs.mkdirSync(path.join(pRoot, 'src', 'episodes', 'ep'), { recursive: true });
    fs.writeFileSync(
      path.join(pRoot, 'src', 'episodes', 'ep', 'shots.tsx'),
      'export const S1 = 1;\nconst place = STREET;\nexport const S2 = 2;\nconst place2 = STREET;\n',
    );
    const fsReg = new ToolRegistry(fsTools);
    const ctx = { projectId: 'p', projectRoot: pRoot, dataRoot: dir, skillDir: null, log: () => {} };
    const dup = await fsReg.run('edit_file', { path: 'src/episodes/ep/shots.tsx', edits: [{ oldText: 'STREET', newText: 'FRONT' }] }, ctx);
    assert.equal(dup.ok, false);
    assert.match(dup.summary, /matches at lines 2, 4/);
    assert.match(dup.summary, /prefer edit_shot/);

    db.createProject('p', 'p', pRoot);

    // Case 1: 6 failed calls that share a 300-char prefix in args, but differ at the end -> must NOT trigger 5x stop!
    const th1 = db.createThread('p', 't1');
    db.addMessage(th1.id, 'user', 'fix shots');
    let calls1 = 0;
    const longPrefix = 'A'.repeat(300);
    const reg1 = new ToolRegistry([
      {
        name: 'edit_file',
        description: 'e',
        policy: 'auto',
        schema: { type: 'object' },
        run: async (a) => (a.tail === 6 ? { ok: true, summary: 'ok' } : { ok: false, summary: 'oldText not found' }),
      },
      { name: 'git', description: 'g', policy: 'auto', schema: { type: 'object' }, run: async () => ({ ok: true, summary: 'ok' }) },
    ]);
    const prov1 = {
      id: 'x',
      label: 'x',
      model: 'm',
      chat: async () => {
        calls1++;
        if (calls1 <= 6) {
          return { text: '', toolCalls: [{ id: `c${calls1}`, name: 'edit_file', args: { prefix: longPrefix, tail: calls1 } }] };
        }
        return { text: 'Tout est corrigé.', toolCalls: [] };
      },
    };
    const config = { ...loadConfig(), maxSteps: 20, reviewMaxRounds: 0, approvalsMode: 'off', contextChars: 90_000 };
    await runTurn({ db, bus: { emit() {} }, config, registry: reg1, approvals: null, provider: () => prov1, reviewProvider: () => null }, th1.id, new AbortController().signal);
    assert.equal(calls1, 7, '6 distinct >240-char edit_file calls should not be killed at attempt 5');
    assert.equal(db.listMessages(th1.id).at(-1).content, 'Tout est corrigé.');

    // Case 2: 5 genuinely identical failing calls -> stops cleanly AND records an assistant message explaining why
    const th2 = db.createThread('p', 't2');
    db.addMessage(th2.id, 'user', 'loop');
    let calls2 = 0;
    const prov2 = {
      id: 'x',
      label: 'x',
      model: 'm',
      chat: async () => {
        calls2++;
        return { text: '', toolCalls: [{ id: `k${calls2}`, name: 'edit_file', args: { prefix: longPrefix, tail: 1 } }] };
      },
    };
    await runTurn({ db, bus: { emit() {} }, config, registry: reg1, approvals: null, provider: () => prov2, reviewProvider: () => null }, th2.id, new AbortController().signal);
    assert.equal(calls2, 5);
    const last2 = db.listMessages(th2.id).at(-1);
    assert.equal(last2.role, 'assistant');
    assert.match(last2.content, /Arrêt : l'outil "edit_file" a échoué 5 fois de suite/);
  } finally {
    db.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('codex provider: normalizes gpt 6.1 terra/sol, converts Responses payload + images/tools, and auto-refreshes OAuth on 401', async () => {
  const http = await import('node:http');
  const { codexProvider, normalizeCodexModel, toCodexResponsesPayload } = await import('../dist/orchestrator/providers/codex.js');
  const { Db } = await import('../dist/orchestrator/db.js');
  const { providerConfig, reviewProviderConfig } = await import('../dist/orchestrator/providers/index.js');

  assert.deepEqual(normalizeCodexModel('gpt 6.1 terra'), { model: 'gpt-6.1-terra', effort: 'medium' });
  assert.deepEqual(normalizeCodexModel('GPT 6.1 Sol:low'), { model: 'gpt-6.1-sol', effort: 'low' });

  const converted = toCodexResponsesPayload(
    [
      { role: 'system', content: 'System rule' },
      { role: 'user', content: 'Look at this', images: [{ mime: 'image/png', data: 'AAAA' }] },
      { role: 'assistant', content: 'Checking', toolCalls: [{ id: 'call_1', name: 'read_file', args: { path: 'a.ts' } }] },
      { role: 'tool', toolCallId: 'call_1', name: 'read_file', content: 'ok\n1| const x = 1;' },
    ],
    [{ type: 'function', function: { name: 'read_file', description: 'Read', parameters: { type: 'object' } } }],
    'gpt 6.1 terra',
  );
  assert.equal(converted.model, 'gpt-6.1-terra');
  assert.equal(converted.instructions, 'System rule');
  assert.equal(converted.tools[0].name, 'read_file');
  assert.equal(converted.input[0].content[1].type, 'input_image');
  assert.equal(converted.input[2].type, 'function_call');
  assert.equal(converted.input[3].type, 'function_call_output');

  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'whatif-codex-'));
  const authPath = path.join(dir, 'auth.json');
  fs.writeFileSync(
    authPath,
    JSON.stringify({
      auth_mode: 'chatgpt',
      tokens: { access_token: 'stale-token', refresh_token: 'ref-123', account_id: 'acc_42' },
    }),
  );

  let responsesHits = 0;
  let refreshHits = 0;
  const srv = http.createServer(async (req, res) => {
    if (req.url === '/oauth/token') {
      refreshHits++;
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ access_token: 'fresh-token', refresh_token: 'ref-456' }));
      return;
    }
    if (req.url === '/responses') {
      responsesHits++;
      if (req.headers.authorization === 'Bearer stale-token') {
        res.writeHead(401, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ error: 'expired' }));
        return;
      }
      assert.equal(req.headers.authorization, 'Bearer fresh-token');
      assert.equal(req.headers['chatgpt-account-id'], 'acc_42');
      res.writeHead(200, { 'content-type': 'text/event-stream' });
      res.write(`data: ${JSON.stringify({ type: 'response.output_text.delta', delta: 'Salut ' })}\n\n`);
      res.write(
        `data: ${JSON.stringify({
          type: 'response.output_item.done',
          item: { type: 'function_call', call_id: 'c_99', name: 'repo_map', arguments: '{"maxFiles":10}' },
        })}\n\n`,
      );
      res.write(`data: ${JSON.stringify({ type: 'response.completed', response: { status: 'completed' } })}\n\n`);
      res.end();
      return;
    }
    res.writeHead(404);
    res.end();
  });
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  const port = srv.address().port;
  const db = new Db(path.join(dir, 'app.db'));
  try {
    const prov = codexProvider({
      baseURL: `http://127.0.0.1:${port}`,
      oauthTokenUrl: `http://127.0.0.1:${port}/oauth/token`,
      authPath,
      model: 'gpt 6.1 terra',
    });
    let streamed = '';
    const out = await prov.chat({
      messages: [{ role: 'user', content: 'Go' }],
      tools: [],
      onText: (d) => (streamed += d),
    });
    assert.equal(refreshHits, 1, '401 triggers OAuth refresh');
    assert.equal(responsesHits, 2);
    assert.equal(streamed, 'Salut ');
    assert.equal(out.text, 'Salut ');
    assert.deepEqual(out.toolCalls, [{ id: 'c_99', name: 'repo_map', args: { maxFiles: 10 } }]);
    const savedAuth = JSON.parse(fs.readFileSync(authPath, 'utf8'));
    assert.equal(savedAuth.tokens.access_token, 'fresh-token');

    // Verify DB codex settings override differing .env provider cleanly
    db.setSetting('provider', 'codex');
    db.setSetting('model', 'gpt-6.1-terra');
    db.setSetting('reviewProvider', 'codex');
    db.setSetting('reviewModel', 'gpt-6.1-sol');
    assert.equal(providerConfig(db).provider, 'codex');
    assert.equal(providerConfig(db).model, 'gpt-6.1-terra');
    assert.equal(reviewProviderConfig(db).provider, 'codex');
    assert.equal(reviewProviderConfig(db).model, 'gpt-6.1-sol');
  } finally {
    db.close();
    await new Promise((r) => srv.close(r));
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('codex run fixes: precheck skips expensiveFails, delegated shot() helpers, phoneShot as insert & translucent 9:16 rect', async () => {
  const { shotsAudit, portraitFramingErrors } = await import('../dist/tools/whatif.js');
  const { Db } = await import('../dist/orchestrator/db.js');
  const { ToolRegistry } = await import('../dist/tools/index.js');
  const { runTurn } = await import('../dist/orchestrator/agent.js');
  const { loadConfig } = await import('../dist/orchestrator/config.js');

  // 1. Translucent 9:16 siren/lighting overlay is allowed; opaque 16:9 backdrop rect reports line number
  const translucentSrc = [
    `export const S1 = shot({`,
    `  place: SALON,`,
    `  extra: (t) => <rect x={0} y={0} width={1920} height={1080} fill="#3F6BD8" opacity={0.1 + 0.08 * Math.sin(t * 0.33)} />,`,
    `});`,
  ].join('\n');
  assert.deepEqual(portraitFramingErrors(translucentSrc, { S1: translucentSrc }, ['S1']), []);
  const opaqueSrc = ['const x = 1;', 'const y = 2;', '<rect x={0} y={0} width={1920} height={220} fill="#fff" />'].join('\n');
  const opaqueErrs = portraitFramingErrors(opaqueSrc);
  assert.equal(opaqueErrs.length, 1);
  assert.match(opaqueErrs[0], /\(line 3\).*clamps its backdrop\/ceiling to y=0\.\.1080/);

  // 2. Delegated local shot() helpers (EARLY/LATER) + phoneShot with size="close" pass shotsAudit
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'whatif-codex-fixes-'));
  const db = new Db(path.join(dir, 'app.db'));
  try {
    const slug = 'delegated';
    const epDir = path.join(dir, 'src', 'episodes', slug);
    fs.mkdirSync(path.join(dir, 'src', 'engine'), { recursive: true });
    fs.mkdirSync(epDir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'src', 'engine', 'shot.tsx'), 'export const shot = () => () => null;\nexport const phoneShot = () => () => null;\n');
    const ids = ['S1', 'S2', 'S3', 'S4', 'S5', 'S6'];
    fs.writeFileSync(path.join(epDir, 'index.tsx'), `export const delegated = defineEpisode("D", { timeline, shots: { ${ids.join(', ')} } });\n`);
    const tl = { fps: 30, total: 360, segments: ids.map((id, i) => ({ shot: id, a: i * 60, b: (i + 1) * 60 })), shots: ids.map((id) => ({ id, len: 60, key: 18 })) };
    const ep = {
      aspect: '9:16',
      script: Array.from({ length: 4 }, (_, i) => ({ beat: `b${i}`, text: 'Une histoire complète en français.' })),
      shots: ids.map((id) => ({ id, size: id === 'S5' ? 'close' : 'medium', set: 'bedroom', note: 'action' })),
    };
    const shotsCode = [
      `export const S1 = shot({ place: BED, cam: 'wide', people: [{ who: A, act: 'explain', beats: [{ at: 18, face: 'worried' }] }] });`,
      `export const S2 = shot({ place: BED, cam: 'medium', people: [{ who: B, act: 'think', beats: [{ at: 20, act: 'shrug' }] }] });`,
      `const EARLY = shot({ place: BED, cam: 'medium', people: [{ who: A, act: 'hold', face: 'happy' }] });`,
      `const LATER = shot({ place: BED, cam: 'medium', people: [{ who: A, act: 'hold', face: 'worried' }, { who: B, act: 'nod', face: 'happy' }] });`,
      `export const S3 = ({ t, ...props }) => (t < 32 ? <EARLY {...props} t={t} /> : <LATER {...props} t={t} />);`,
      `export const S4 = shot({ place: BED, cam: 'close', people: [{ who: A, act: 'idle', beats: [{ at: 12, act: 'slump', face: 'dizzy' }] }] });`,
      `export const S5 = phoneShot({ name: 'Cagnotte', back: BED, messages: [{ at: 4, text: 'Objectif atteint' }] });`,
      `export const S6 = shot({ place: BED, cam: 'medium', people: [{ who: B, act: 'question', beats: [{ at: 22, act: 'point' }] }] });`,
    ].join('\n');
    fs.writeFileSync(path.join(epDir, 'shots.tsx'), shotsCode);
    assert.equal(shotsAudit(dir, slug, ep, tl), null, 'delegated EARLY/LATER shot() and phoneShot(size=close) pass cleanly');

    // 3. runTurn: 4 local pre-flight rejections ("cannot run stills yet — ...") do NOT trip expensiveFails,
    //    whereas 3 real Modal runtime failures DO stop the turn.
    db.createProject('p', 'p', dir);
    const config = { ...loadConfig(), maxSteps: 20, reviewMaxRounds: 0, approvalsMode: 'off', contextChars: 90_000 };

    let preAttempts = 0;
    const regPre = new ToolRegistry([
      {
        name: 'whatif_run',
        description: 'w',
        policy: 'auto',
        schema: { type: 'object' },
        run: async () => {
          preAttempts++;
          if (preAttempts <= 4) {
            return { ok: false, summary: `whatif_run failed: cannot run stills yet — shots.tsx failed check #${preAttempts}` };
          }
          return { ok: true, summary: 'stills rendered' };
        },
      },
      { name: 'edit_shot', description: 'e', policy: 'auto', schema: { type: 'object' }, run: async () => ({ ok: true, summary: 'edited' }) },
      { name: 'git', description: 'g', policy: 'auto', schema: { type: 'object' }, run: async () => ({ ok: true, summary: 'ok' }) },
    ]);
    let turnStep = 0;
    const provPre = {
      id: 'codex',
      label: 'Codex',
      model: 'gpt-6.1-terra',
      chat: async () => {
        turnStep++;
        if (turnStep <= 9) {
          return turnStep % 2 === 1
            ? { text: '', toolCalls: [{ id: `w${turnStep}`, name: 'whatif_run', args: { step: 'stills', slug } }] }
            : { text: '', toolCalls: [{ id: `e${turnStep}`, name: 'edit_shot', args: { shot: `S${turnStep}` } }] };
        }
        return { text: 'Stills prêts !', toolCalls: [] };
      },
    };
    const thPre = db.createThread('p', 'precheck');
    db.addMessage(thPre.id, 'user', 'go');
    await runTurn({ db, bus: { emit() {} }, config, registry: regPre, approvals: null, provider: () => provPre, reviewProvider: () => null }, thPre.id, new AbortController().signal);
    assert.equal(preAttempts, 5, '4 local precheck rejections must not stop before attempt 5 succeeds');
    assert.equal(db.listMessages(thPre.id).at(-1).content, 'Stills prêts !');

    let modalAttempts = 0;
    const regModal = new ToolRegistry([
      {
        name: 'whatif_run',
        description: 'w',
        policy: 'auto',
        schema: { type: 'object' },
        run: async () => {
          modalAttempts++;
          return { ok: false, summary: 'whatif_run failed (exit 1): Modal container crashed with OOM' };
        },
      },
      { name: 'edit_shot', description: 'e', policy: 'auto', schema: { type: 'object' }, run: async () => ({ ok: true, summary: 'edited' }) },
      { name: 'git', description: 'g', policy: 'auto', schema: { type: 'object' }, run: async () => ({ ok: true, summary: 'ok' }) },
    ]);
    let mStep = 0;
    const provModal = {
      id: 'codex',
      label: 'Codex',
      model: 'gpt-6.1-terra',
      chat: async () => {
        mStep++;
        return mStep % 2 === 1
          ? { text: '', toolCalls: [{ id: `mw${mStep}`, name: 'whatif_run', args: { step: 'stills', slug } }] }
          : { text: '', toolCalls: [{ id: `me${mStep}`, name: 'edit_shot', args: { shot: `S${mStep}` } }] };
      },
    };
    const thModal = db.createThread('p', 'modalcrash');
    db.addMessage(thModal.id, 'user', 'go');
    await runTurn({ db, bus: { emit() {} }, config, registry: regModal, approvals: null, provider: () => provModal, reviewProvider: () => null }, thModal.id, new AbortController().signal);
    assert.equal(modalAttempts, 3, '3 real Modal runtime crashes still stop the turn');
    assert.match(db.listMessages(thModal.id).at(-1).content, /Arrêt : stills échoue toujours/);
  } finally {
    db.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('agy provider + per-project models: model catalog, mock agy CLI (tools, images & auth fast-fail), and isolated project overrides', async () => {
  const {
    PROVIDER_MODEL_CATALOG,
    agyProvider,
    normalizeAgyModel,
    providerConfig,
    reviewProviderConfig,
  } = await import('../dist/orchestrator/providers/index.js');
  const { createApp } = await import('../dist/orchestrator/main.js');
  const { loadConfig } = await import('../dist/orchestrator/config.js');

  // 1. Exact model normalization & catalog choices requested by user
  assert.equal(normalizeAgyModel('3.8 flash medium'), 'gemini-3.8-flash-medium');
  assert.equal(normalizeAgyModel('carbon low'), 'gemini-4-carbon-low');
  assert.equal(normalizeAgyModel('aragon low'), 'gemini-4-argon-low');
  assert.equal(normalizeAgyModel('aragon medium'), 'gemini-4-argon-medium');
  assert.equal(normalizeAgyModel('carbon medium'), 'gemini-4-carbon-medium');

  assert.deepEqual(
    PROVIDER_MODEL_CATALOG.agy.agent.map((m) => m.id),
    ['gemini-3.8-flash-medium', 'gemini-4-carbon-low', 'gemini-4-argon-low'],
  );
  assert.deepEqual(
    PROVIDER_MODEL_CATALOG.agy.reviewer.map((m) => m.id),
    ['gemini-4-argon-medium', 'gemini-4-carbon-medium'],
  );
  assert.deepEqual(
    PROVIDER_MODEL_CATALOG.codex.agent.map((m) => m.id),
    ['gpt-6.1-terra', 'gpt-6.1-sol'],
  );
  assert.deepEqual(
    PROVIDER_MODEL_CATALOG.codex.reviewer.map((m) => m.id),
    ['gpt-6.1-sol', 'gpt-6.1-terra'],
  );

  // 2. Mock agy binary: test structured tool calls, reviewer image streaming, and instant auth-prompt abort
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'whatif-agy-test-'));
  const fakeAgy = path.join(dir, 'fake-agy');
  fs.writeFileSync(
    fakeAgy,
    `#!/usr/bin/env node
const fs = require('node:fs');
const args = process.argv.slice(2);
const modelIdx = args.indexOf('--model');
const model = modelIdx >= 0 ? args[modelIdx + 1] : 'unknown';
const hasSchema = args.includes('--json-schema');
const printArg = args.find((a) => a.startsWith('--print=')) || '';
const prompt = printArg.slice('--print='.length);
if (process.env.FAKE_AGY_UNAUTH === '1') {
  process.stdout.write('Authentication required. Please visit the URL to log in:\\nhttps://accounts.google.com/...\\n');
  setTimeout(() => process.exit(1), 30000);
} else if (hasSchema) {
  const out = {
    event: 'result',
    result: {
      status: 'SUCCESS',
      response: JSON.stringify({ text: 'Plan prêt (' + model + ')', toolCalls: [{ name: 'whatif_run', argsJson: '{"step":"stills"}' }] }),
      structured_output: { text: 'Plan prêt (' + model + ')', toolCalls: [{ name: 'whatif_run', argsJson: '{"step":"stills"}' }] },
      usage: { total_tokens: 42 },
    },
  };
  process.stdout.write(JSON.stringify(out) + '\\n');
} else {
  const imgMatch = prompt.match(/attached_1\\.png/);
  const imgExists = imgMatch ? fs.existsSync(require('node:path').join(process.cwd(), 'attached_1.png')) : false;
  process.stdout.write(JSON.stringify({ event: 'step_update', step_update: { step_type: 'agent_response', text_delta: '{"pass":true,' } }) + '\\n');
  const finalJson = JSON.stringify({ pass: true, summary: 'Image vue=' + imgExists + ' via ' + model, issues: [] });
  process.stdout.write(JSON.stringify({ event: 'result', result: { status: 'SUCCESS', response: finalJson } }) + '\\n');
}
`,
    { mode: 0o755 },
  );

  const app = createApp({
    ...loadConfig(),
    dataRoot: dir,
    projectsDir: path.join(dir, 'projects'),
    dbPath: path.join(dir, 'app.db'),
    skillDir: null,
  });
  await new Promise((r) => app.server.listen(0, '127.0.0.1', r));
  const port = app.server.address().port;
  const base = `http://127.0.0.1:${port}`;

  try {
    // Agent call with tools
    const agentProv = agyProvider({ model: 'aragon low', agyBin: fakeAgy });
    assert.equal(agentProv.model, 'gemini-4-argon-low');
    const agentRes = await agentProv.chat({
      messages: [{ role: 'user', content: 'Lance stills' }],
      tools: [{ type: 'function', function: { name: 'whatif_run', description: 'run', parameters: { type: 'object' } } }],
    });
    assert.equal(agentRes.text, 'Plan prêt (gemini-4-argon-low)');
    assert.equal(agentRes.toolCalls.length, 1);
    assert.equal(agentRes.toolCalls[0].name, 'whatif_run');
    assert.deepEqual(agentRes.toolCalls[0].args, { step: 'stills' });

    // Reviewer call with image attachment and no tools
    const revProv = agyProvider({ model: 'carbon medium', agyBin: fakeAgy });
    let streamed = '';
    const revRes = await revProv.chat({
      messages: [{ role: 'user', content: 'Vérifie la planche', images: [{ mime: 'image/png', data: Buffer.from('PNGDATA').toString('base64') }] }],
      tools: [],
      onText: (d) => (streamed += d),
    });
    assert.ok(streamed.includes('{"pass":true,'));
    assert.match(revRes.text, /Image vue=true via gemini-4-carbon-medium/);

    // Fast fail (<1.5s, never waiting 30s) when agy asks for interactive login
    const unauthProv = agyProvider({ model: '3.8 flash medium', agyBin: fakeAgy, env: { FAKE_AGY_UNAUTH: '1' } });
    const t0 = Date.now();
    await assert.rejects(
      () => unauthProv.chat({ messages: [{ role: 'user', content: 'hi' }], tools: [] }),
      /Session Google Antigravity \(agy\) non connectée/,
    );
    assert.ok(Date.now() - t0 < 3000, 'kills unauthenticated agy prompt immediately without hanging');

    // 3. Per-project concurrent model configuration via HTTP API
    await fetch(`${base}/api/settings`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        provider: 'codex',
        model: 'gpt-6.1-terra',
        reviewProvider: 'codex',
        reviewModel: 'gpt-6.1-sol',
      }),
    });

    const pCodexRes = await fetch(`${base}/api/projects`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'Projet Codex' }),
    });
    const { project: pCodex } = await pCodexRes.json();
    assert.equal(pCodex.effectiveModel.provider, 'codex');
    assert.equal(pCodex.effectiveModel.model, 'gpt-6.1-terra');
    assert.equal(pCodex.effectiveModel.reviewModel, 'gpt-6.1-sol');

    const pAgyRes = await fetch(`${base}/api/projects`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        name: 'Projet AGY',
        provider: 'agy',
        model: 'gemini-4-carbon-low',
        reviewProvider: 'agy',
        reviewModel: 'gemini-4-argon-medium',
      }),
    });
    const { project: pAgy } = await pAgyRes.json();
    assert.equal(pAgy.effectiveModel.provider, 'agy');
    assert.equal(pAgy.effectiveModel.model, 'gemini-4-carbon-low');
    assert.equal(pAgy.effectiveModel.reviewProvider, 'agy');
    assert.equal(pAgy.effectiveModel.reviewModel, 'gemini-4-argon-medium');

    // Verify DB-level resolution stays isolated across both projects simultaneously
    assert.equal(providerConfig(app.db, app.db.getProject(pCodex.id)).provider, 'codex');
    assert.equal(providerConfig(app.db, app.db.getProject(pCodex.id)).model, 'gpt-6.1-terra');
    assert.equal(providerConfig(app.db, app.db.getProject(pAgy.id)).provider, 'agy');
    assert.equal(providerConfig(app.db, app.db.getProject(pAgy.id)).model, 'gemini-4-carbon-low');
    assert.equal(reviewProviderConfig(app.db, app.db.getProject(pAgy.id)).model, 'gemini-4-argon-medium');

    // Patching project back to null resets to global default
    const resetRes = await fetch(`${base}/api/projects/${pAgy.id}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ provider: null, model: null, reviewProvider: null, reviewModel: null }),
    });
    const resetProj = await resetRes.json();
    assert.equal(resetProj.effectiveModel.provider, 'codex');
    assert.equal(resetProj.effectiveModel.model, 'gpt-6.1-terra');
  } finally {
    await app.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('modular episode architecture: shared.tsx + shots/S<N>.tsx + auto-barrel + zero neighbor clobbering', async () => {
  const { ToolRegistry, fsTools } = await import('../dist/tools/index.js');
  const { replaceShot } = await import('../dist/tools/fs.js');
  const { shotsAudit, boardStale } = await import('../dist/tools/whatif.js');
  const { episodePin } = await import('../dist/orchestrator/context.js');

  // 1. Monolithic fallback: editing S10 must NEVER delete S11's local non-exported BEFORE_PULL/AFTER_PULL helpers!
  const monoWithHelpers = [
    `import { shot } from '../../engine';`,
    `export const S10 = shot({ place: R, cam: 'wide', people: [{ who: A, act: 'talk' }] });`,
    `// S11 — multi-phase pull`,
    `const BEFORE_PULL = shot({ place: R, cam: 'medium', people: [{ who: A, act: 'reach' }] });`,
    `const AFTER_PULL = shot({ place: R, cam: 'close', people: [{ who: A, act: 'shock' }] });`,
    `export const S11 = ({ t, ...p }) => (t < 30 ? <BEFORE_PULL {...p} t={t} /> : <AFTER_PULL {...p} t={t} />);`,
  ].join('\n') + '\n';
  const monoPatched = replaceShot(monoWithHelpers, 'S10', `export const S10 = shot({ place: R, cam: 'close', people: [{ who: A, act: 'nod' }] });`);
  assert.equal(monoPatched.replaced, true);
  assert.match(monoPatched.text, /const BEFORE_PULL = shot/, 'S11 helper BEFORE_PULL is preserved when S10 is replaced');
  assert.match(monoPatched.text, /const AFTER_PULL = shot/, 'S11 helper AFTER_PULL is preserved when S10 is replaced');
  assert.match(monoPatched.text, /\/\/ S11 — multi-phase pull/, 'S11 comment is preserved');

  // 2. Modular workflow: write shared.tsx (without `export` keywords) + write S1..S6 via edit_shot (without manual imports!)
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'whatif-modular-'));
  try {
    const slug = 'mod-ep';
    const epDir = path.join(dir, 'src', 'episodes', slug);
    const outDir = path.join(dir, 'out', slug);
    fs.mkdirSync(path.join(dir, 'src', 'engine'), { recursive: true });
    fs.mkdirSync(epDir, { recursive: true });
    fs.mkdirSync(outDir, { recursive: true });
    fs.writeFileSync(
      path.join(dir, 'src', 'engine', 'shot.tsx'),
      'export const shot = () => () => null;\nexport const phoneShot = () => () => null;\n',
    );
    fs.writeFileSync(
      path.join(epDir, 'index.tsx'),
      `import { defineEpisode, Timeline } from '../../engine';\nimport timeline from './timeline.json';\nimport { S1 } from './shots';\nexport const modEp = defineEpisode('ModEp', { timeline: timeline as Timeline, shots: { S1 } });\n`,
    );

    const ids = ['S1', 'S2', 'S3', 'S4', 'S5', 'S6'];
    const tl = {
      fps: 30,
      total: 360,
      segments: ids.map((id, i) => ({ shot: id, a: i * 60, b: (i + 1) * 60 })),
      shots: ids.map((id) => ({ id, len: 60, key: 18 })),
    };
    const ep = {
      id: 'ModEp',
      slug,
      aspect: '9:16',
      script: Array.from({ length: 4 }, (_, i) => ({ beat: `b${i}`, text: 'Une histoire complète en français.' })),
      shots: ids.map((id) => ({ id, size: id === 'S5' ? 'insert' : 'medium', set: 'salon', note: 'action' })),
    };
    fs.writeFileSync(path.join(epDir, 'timeline.json'), JSON.stringify(tl));
    fs.writeFileSync(path.join(epDir, 'episode.json'), JSON.stringify(ep));

    const reg = new ToolRegistry(fsTools);
    const ctx = { projectId: 'p', projectRoot: dir, dataRoot: dir, skillDir: null, log: () => {} };

    // Write shared.tsx WITHOUT `export` before const SALON / LEA / MARC — normalizeSharedEpisodeFile auto-exports them!
    const wShared = await reg.run(
      'write_file',
      {
        path: `src/episodes/${slug}/shared.tsx`,
        content: [
          `import React from 'react';`,
          `import { cast, place } from '../../engine';`,
          `const SALON = place('living-room', { mood: 'warm' });`,
          `const LEA = cast({ as: 'heroine', seed: 'lea' });`,
          `const MARC = cast({ seed: 'marc', body: 'adult' });`,
        ].join('\n'),
      },
      ctx,
    );
    assert.equal(wShared.ok, true);
    const sharedDisk = fs.readFileSync(path.join(epDir, 'shared.tsx'), 'utf8');
    assert.match(sharedDisk, /export const SALON =/);
    assert.match(sharedDisk, /export const LEA =/);
    assert.match(sharedDisk, /export const MARC =/);

    // Write S1..S4 first and check episodePin shows S5, S6 remaining
    await reg.run('edit_shot', { episode: slug, id: 'S1', code: `export const S1 = shot({ place: SALON, cam: 'wide', people: [{ who: LEA, act: 'talk', beats: [{ at: 15, face: 'worried' }] }] });` }, ctx);
    await reg.run('edit_shot', { episode: slug, id: 'S2', code: `export const S2 = shot({ place: SALON, cam: 'medium', people: [{ who: MARC, act: 'explain', beats: [{ at: 20, act: 'shrug' }] }] });` }, ctx);
    // S3 and S4 BOTH define a local helper named `PHASE_A` & `PHASE_B` — zero collision across separate files!
    await reg.run(
      'edit_shot',
      {
        episode: slug,
        id: 'S3',
        code: [
          `const PHASE_A = shot({ place: SALON, cam: 'medium', people: [{ who: LEA, act: 'reach', face: 'worried' }] });`,
          `const PHASE_B = shot({ place: SALON, cam: 'close', people: [{ who: LEA, act: 'hold', face: 'shock' }] });`,
          `export const S3 = ({ t, ...p }: ShotProps) => (t < 28 ? <PHASE_A {...p} t={t} /> : <PHASE_B {...p} t={t} />);`,
        ].join('\n'),
      },
      ctx,
    );
    await reg.run(
      'edit_shot',
      {
        episode: slug,
        id: 'S4',
        code: [
          `const PHASE_A = shot({ place: SALON, cam: 'medium', people: [{ who: MARC, act: 'idle', face: 'neutral' }] });`,
          `const PHASE_B = shot({ place: SALON, cam: 'close', people: [{ who: MARC, act: 'step-back', face: 'fear' }] });`,
          `export const S4 = ({ t, ...p }: ShotProps) => (t < 24 ? <PHASE_A {...p} t={t} /> : <PHASE_B {...p} t={t} />);`,
        ].join('\n'),
      },
      ctx,
    );

    const pinMid = episodePin(dir);
    assert.match(pinMid, /4\/6 exported in shots\/S\*\.tsx/);
    assert.match(pinMid, /Remaining to export: S5, S6/);
    assert.match(pinMid, /Shared header in shared\.tsx/);

    // Complete S5 and S6
    await reg.run('edit_shot', { episode: slug, id: 'S5', code: `export const S5 = phoneShot({ name: 'Message', back: SALON, messages: [{ at: 8, text: 'Où es-tu ?' }] });` }, ctx);
    await reg.run('edit_shot', { episode: slug, id: 'S6', code: `export const S6 = shot({ place: SALON, cam: 'close', people: [{ who: LEA, act: 'question', beats: [{ at: 18, face: 'angry' }] }] });` }, ctx);

    // Check auto-imports inside shots/S3.tsx, barrel shots.tsx, and auto-synced index.tsx
    const s3Disk = fs.readFileSync(path.join(epDir, 'shots', 'S3.tsx'), 'utf8');
    assert.match(s3Disk, /import React from 'react';/);
    assert.match(s3Disk, /from '\.\.\/\.\.\/\.\.\/engine'/);
    assert.match(s3Disk, /import \{[^}]*LEA[^}]*SALON[^}]*\} from '\.\.\/shared'/);

    const barrelDisk = fs.readFileSync(path.join(epDir, 'shots.tsx'), 'utf8');
    assert.match(barrelDisk, /export \* from '\.\/shared';/);
    for (const id of ids) assert.match(barrelDisk, new RegExp(`export \\{ ${id} \\} from '\\.\\/shots\\/${id}';`));

    const indexDisk = fs.readFileSync(path.join(epDir, 'index.tsx'), 'utf8');
    assert.match(indexDisk, /shots:\s*\{\s*S1, S2, S3, S4, S5, S6\s*\}/);

    // shotsAudit passes cleanly on the modular episode!
    assert.equal(shotsAudit(dir, slug, ep, tl), null, 'modular episode passes shotsAudit cleanly');

    // Editing S3 again via edit_shot leaves S4 untouched and triggers boardStale against an older storyboard.jpg
    const boardPath = path.join(outDir, 'storyboard.jpg');
    fs.writeFileSync(boardPath, 'jpg');
    const now = Date.now() / 1000;
    fs.utimesSync(boardPath, now - 30, now - 30);
    await reg.run('edit_shot', { episode: slug, id: 'S3', code: `export const S3 = shot({ place: SALON, cam: 'close', people: [{ who: LEA, act: 'cry', beats: [{ at: 14, face: 'sad' }] }] });` }, ctx);
    assert.match(fs.readFileSync(path.join(epDir, 'shots', 'S4.tsx'), 'utf8'), /MARC/, 'S4.tsx is completely untouched');
    assert.match(boardStale(dir, slug) ?? '', /changed after the last board/, 'boardStale detects updated shots/S3.tsx');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('two-mode reviewer: Round 1 audits 100% of 9 sheets (66 shots) & Round 2 runs high-res targeted delta review', async () => {
  const { reviewEpisodeBoard, formatReviewFeedback } = await import('../dist/orchestrator/reviewer.js');

  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'whatif-twomode-rev-'));
  try {
    const slug = 'marie66';
    const epDir = path.join(dir, 'src', 'episodes', slug);
    const shotsDir = path.join(epDir, 'shots');
    const outDir = path.join(dir, 'out', slug);
    const boardDir = path.join(outDir, 'board');
    const sheetsDir = path.join(outDir, 'sheets');
    fs.mkdirSync(shotsDir, { recursive: true });
    fs.mkdirSync(boardDir, { recursive: true });
    fs.mkdirSync(sheetsDir, { recursive: true });

    const allIds = Array.from({ length: 66 }, (_, i) => `S${i + 1}`);
    fs.writeFileSync(
      path.join(epDir, 'shared.tsx'),
      `export const SALON = place('living-room');\nexport const LEA = cast({ as: 'heroine', seed: 'lea' });\n`,
    );
    for (const id of allIds) {
      fs.writeFileSync(
        path.join(shotsDir, `${id}.tsx`),
        `export const ${id} = shot({ place: SALON, cam: 'medium', people: [{ who: LEA, act: 'talk', beats: [{ at: 24, face: 'shock' }] }] });\n`,
      );
      fs.writeFileSync(path.join(boardDir, `${id}.png`), `PNG_${id}`);
    }
    fs.writeFileSync(
      path.join(epDir, 'shots.tsx'),
      `export * from './shared';\n` + allIds.map((id) => `export { ${id} } from './shots/${id}';`).join('\n') + '\n',
    );
    for (let n = 1; n <= 9; n++) {
      fs.writeFileSync(path.join(sheetsDir, `sheet-0${n}.jpg`), `SHEET_${n}`);
    }
    fs.writeFileSync(
      path.join(epDir, 'episode.json'),
      JSON.stringify({
        aspect: '9:16',
        script: [{ text: 'Je regarde son téléphone sur la table basse.' }],
        shots: allIds.map((id) => ({ id, size: 'medium', set: 'salon', note: `Note ${id}` })),
      }),
    );
    fs.writeFileSync(
      path.join(epDir, 'timeline.json'),
      JSON.stringify({
        fps: 30,
        total: 66 * 60,
        segments: allIds.map((id, i) => ({ shot: id, a: i * 60, b: (i + 1) * 60 })),
        shots: allIds.map((id) => ({ id, len: 60, key: 18 })),
      }),
    );
    fs.writeFileSync(path.join(epDir, 'DIRECTOR.md'), '# DIRECTOR\nSalon chaleureux en 9:16.');

    // ── ROUND 1: Global Audit across 9 contact sheets (must inspect sheet-01..06 AND sheet-07..09!) ──
    const round1Calls = [];
    const round1Provider = {
      model: 'gpt-6.1-sol',
      label: 'Codex Reviewer',
      chat: async ({ messages }) => {
        round1Calls.push(messages);
        if (round1Calls.length === 1) {
          return {
            text: JSON.stringify({
              pass: false,
              summary: 'Défauts sur S3 et S11.',
              issues: [
                { shot: 'S3, S11', severity: 'error', problem: 'Cadrage trop large', fix: 'Passer cam en close' },
              ],
            }),
          };
        }
        return {
          text: JSON.stringify({
            pass: false,
            summary: 'Défaut sur S65 (planche 9).',
            issues: [
              { shot: 'S65', severity: 'error', problem: 'Téléphone absent de la main', fix: 'Ajouter handRProp' },
            ],
          }),
        };
      },
    };

    const r1 = await reviewEpisodeBoard(round1Provider, dir, slug);
    assert.equal(r1.mode, 'global');
    assert.equal(r1.round, 1);
    assert.equal(r1.batches, 2, '9 contact sheets run in 2 batches (6 + 3)');
    assert.equal(r1.pass, false);
    assert.equal(r1.blocking, true);
    assert.equal(round1Calls.length, 2);
    assert.equal(round1Calls[0][1].images.length, 6, 'lot 1 attaches sheets 1..6');
    assert.equal(round1Calls[1][1].images.length, 3, 'lot 2 attaches sheets 7..9');
    assert.match(round1Calls[0][1].content, /couvrant S1\.\.S48/);
    assert.match(round1Calls[1][1].content, /couvrant S49\.\.S66/);
    assert.match(round1Calls[1][1].content, /vignette à t=18f/);
    assert.equal(r1.issues.length, 2, 'merges issues from both batches including S65 on sheet 9');

    const fb1 = formatReviewFeedback(r1, slug);
    assert.match(fb1, /edit_shot/, 'recommends edit_shot instead of edit_file');
    assert.match(fb1, /args: \["S3","S11","S65"\]/, 'parses multi-shot "S3, S11" + "S65" cleanly');

    // ── ROUND 2: Targeted High-Resolution Delta Re-check (attaches ONLY full-res S3.png, S11.png, S65.png!) ──
    const round2Calls = [];
    const round2Provider = {
      model: 'gpt-6.1-sol',
      label: 'Codex Reviewer',
      chat: async ({ messages }) => {
        round2Calls.push(messages);
        return {
          text: JSON.stringify({ pass: true, summary: 'S3, S11 et S65 sont corrigés.', issues: [] }),
        };
      },
    };

    const r2 = await reviewEpisodeBoard(round2Provider, dir, slug);
    assert.equal(r2.mode, 'delta', 'Round 2 switches automatically to targeted delta mode');
    assert.equal(r2.round, 2);
    assert.deepEqual(r2.targetShots, ['S3', 'S11', 'S65']);
    assert.equal(r2.pass, true);
    assert.equal(r2.blocking, false);
    assert.equal(round2Calls.length, 1, '3 target stills fit in a single high-res delta call');

    const deltaSys = round2Calls[0][0].content;
    const deltaUser = round2Calls[0][1];
    assert.match(deltaSys, /CONTRE-VISITE CIBLÉE/);
    assert.equal(deltaUser.images.length, 3, 'attaches the 3 full-res PNG stills instead of 9 contact sheets');
    assert.deepEqual(
      deltaUser.images.map((im) => Buffer.from(im.data, 'base64').toString()),
      ['PNG_S3', 'PNG_S11', 'PNG_S65'],
    );
    assert.match(deltaUser.content, /Plans ciblés vérifiés : S3, S11, S65/);
    assert.match(deltaUser.content, /Cadrage trop large/);
    assert.match(deltaUser.content, /Téléphone absent de la main/);
    assert.match(deltaUser.content, /#### S65/);
    assert.doesNotMatch(deltaUser.content, /#### S20/, 'untouched shots are NOT re-audited in delta mode');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
