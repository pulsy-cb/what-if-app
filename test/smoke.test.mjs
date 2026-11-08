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
  fs.writeFileSync(path.join(dir, 'a.ts'), 'export const A = 1;\nexport const B = 2;\n');
  const registry = new ToolRegistry(fsTools);
  const ctx = { projectId: 'p', projectRoot: dir, dataRoot: dir, skillDir: null, log: () => {} };

  const bad = await registry.run('read_file', { nope: 1 }, ctx);
  assert.equal(bad.ok, false);
  assert.match(bad.summary, /invalid arguments/);

  const read = await registry.run('read_file', { path: 'a.ts' }, ctx);
  assert.equal(read.ok, true);
  assert.match(read.summary, /export const A/);

  const edit = await registry.run('edit_file', { path: 'a.ts', edits: [{ oldText: 'A = 1', newText: 'A = 42' }] }, ctx);
  assert.equal(edit.ok, true);
  assert.match(fs.readFileSync(path.join(dir, 'a.ts'), 'utf8'), /A = 42/);

  const ambiguous = await registry.run('edit_file', { path: 'a.ts', edits: [{ oldText: 'export const', newText: 'x' }] }, ctx);
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
    assert.match(err, /has no <Hero>/);
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
