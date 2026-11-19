import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { execFile, execFileSync, spawn } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

const SCRIPT_ORIG =
  "En 2019, dans un magasin de Miami, un client nommé Paul avait trouvé une astuce pour payer moins cher. " +
  "Il a décollé le code-barres d'un jouet à neuf dollars et l'a collé sur une console Sony à quatre cents dollars avant de passer à la caisse automatique. " +
  "Il est sorti sans que l'alarme sonne et a recommencé trois fois dans la même semaine. " +
  "Sony a retracé le numéro de série dès qu'il s'est connecté chez lui. La police a suivi l'adresse du compte et l'a arrêté devant sa porte. Chaque voleur finit par payer.";

const SCRIPT_V1 =
  "Dans un magasin de Miami, Paul décolle le code-barres d'un jouet à neuf dollars et le colle sur une console Sony à quatre cents dollars devant la caisse automatique. " +
  "S'il se fait prendre au portique, il part directement en garde à vue. " +
  "Il sort pourtant sans que l'alarme sonne et recommence trois fois dans la même semaine. " +
  "Sony retrace le numéro de série dès qu'il branche la console chez lui. [tense] La police suit l'adresse du compte et lui passe les menottes sur le palier.";

const SCRIPT_V2 =
  SCRIPT_V1.replace('sur le palier.', "sur le palier, sous les yeux de tout l'immeuble.");

function makeCardV1() {
  return {
    verdict: 'fix',
    opening: {
      sentence:
        "Dans un magasin de Miami, Paul décolle le code-barres d'un jouet à neuf dollars et le colle sur une console Sony à quatre cents dollars devant la caisse automatique.",
    },
    payoff: {
      sentence: "La police suit l'adresse du compte et lui passe les menottes sur le palier.",
    },
    changes: [
      {
        before: 'En 2019, dans un magasin de Miami, un client nommé Paul avait trouvé une astuce pour payer moins cher.',
        after: "Dans un magasin de Miami, Paul décolle le code-barres d'un jouet à neuf dollars",
        rule: 1,
      },
      {
        before: 'Chaque voleur finit par payer.',
        after: 'lui passe les menottes sur le palier.',
        rule: 5,
      },
    ],
    removed: ['2019'],
  };
}

function makeCardV2() {
  const c = makeCardV1();
  return {
    ...c,
    payoff: {
      sentence: "La police suit l'adresse du compte et lui passe les menottes sur le palier, sous les yeux de tout l'immeuble.",
    },
    changes: [
      c.changes[0],
      {
        before: 'Chaque voleur finit par payer.',
        after: "lui passe les menottes sur le palier, sous les yeux de tout l'immeuble.",
        rule: 5,
      },
    ],
  };
}

function makeScriptEp(scriptText = SCRIPT_ORIG, slug = 'ep-reg') {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'whatif-reg-script-'));
  const epDir = path.join(root, 'src', 'episodes', slug);
  const outDir = path.join(root, 'out', slug);
  fs.mkdirSync(epDir, { recursive: true });
  fs.mkdirSync(outDir, { recursive: true });
  const setScript = (text) => {
    fs.writeFileSync(
      path.join(epDir, 'episode.json'),
      JSON.stringify(
        {
          id: 'EpReg',
          slug,
          lang: 'fr',
          source: { provider: 'nouveau', videoId: 'vid-reg-1', words: SCRIPT_ORIG.split(/\s+/).length },
          script: [{ text }],
        },
        null,
        2,
      ),
    );
  };
  setScript(scriptText);
  fs.writeFileSync(path.join(outDir, 'source.fr.md'), SCRIPT_ORIG + '\n');
  const setCard = (card) => fs.writeFileSync(path.join(outDir, 'script-card.json'), JSON.stringify(card, null, 2));
  return { root, slug, epDir, outDir, setScript, setCard };
}

test('Issue 1: mandatory submission token/sig on verdicts AND failures/timeouts, V1/V2 concurrency isolation, fail-closed on missing sig, and V1 failures never trigger V2 fallback', async () => {
  const { runScriptStep, recordScriptReview, recordScriptReviewFailure, readScriptState, scriptGate, packSubmittedSig } = await import('../dist/tools/script-check.js');
  const { reviewScript } = await import('../dist/orchestrator/reviewer.js');
  const { callMcpTool, listMcpTools } = await import('../dist/mcp/service.js');
  const { Db } = await import('../dist/orchestrator/db.js');
  const { Bus } = await import('../dist/orchestrator/bus.js');
  const { loadConfig } = await import('../dist/orchestrator/config.js');
  const { defaultRegistry } = await import('../dist/tools/index.js');

  // 1a. MCP tool schema requires explicit `sig`
  const registry = defaultRegistry();
  const toolSpec = listMcpTools(registry).find((t) => t.name === 'whatif_save_script_review');
  assert.ok(Array.isArray(toolSpec?.inputSchema?.required) && toolSpec.inputSchema.required.includes('sig'), 'MCP schema must require sig');

  // 1b. packSubmittedSig is fail-closed when Submitted-Sig header is absent or duplicated
  const p = makeScriptEp(SCRIPT_V1);
  try {
    p.setCard(makeCardV1());
    const step = runScriptStep(p.root, p.slug);
    assert.equal(step.needsReview, true);
    const rawPack = fs.readFileSync(path.join(p.outDir, 'script-pack.md'), 'utf8');
    const token = packSubmittedSig(rawPack);
    assert.equal(token, step.state.submittedSig);
    assert.match(token, /^[0-9a-f]{12}:[0-9a-f]{12}$/, 'each submission receives a unique <sig>:<nonce> token');

    const strippedPack = rawPack.replace(/^Submitted-Sig:.*\n?/m, '');
    assert.equal(packSubmittedSig(strippedPack), null, 'pack without Submitted-Sig header must fail closed');
    const dupPack = `Submitted-Sig: ${token}\n${rawPack}`;
    assert.equal(packSubmittedSig(dupPack), null, 'ambiguous pack with multiple Submitted-Sig headers must fail closed');

    // Missing sig in recordScriptReview & recordScriptReviewFailure: fail-closed, never approves, never increments counters
    const noSigPass = recordScriptReview(p.root, p.slug, { pass: true, sameStory: true, sig: '', issues: [] });
    assert.equal(noSigPass.state.status, 'review', 'missing sig must not approve');
    assert.equal(noSigPass.state.refused, 0);
    assert.ok(scriptGate(p.root, p.slug));

    const noSigUndef = recordScriptReview(p.root, p.slug, { pass: false, sameStory: true, issues: [{ problem: 'x' }] });
    assert.equal(noSigUndef.state.status, 'review', 'undefined sig must not count a refusal');
    assert.equal(noSigUndef.state.refused, 0);

    const noSigFail1 = recordScriptReviewFailure(p.root, p.slug, 'timeout', '');
    const noSigFail2 = recordScriptReviewFailure(p.root, p.slug, 'timeout', undefined);
    assert.equal(noSigFail1.state.reviewFailures, 0, 'empty sig must not count a review failure');
    assert.equal(noSigFail2.state.reviewFailures, 0, 'undefined sig must not count a review failure');
    assert.equal(noSigFail2.state.status, 'review', 'missing sig on failures must never trigger fallback auto-approval');
    assert.ok(scriptGate(p.root, p.slug));
  } finally {
    fs.rmSync(p.root, { recursive: true, force: true });
  }

  // 1c. Concurrency V1 / V2 over MCP: after V2 is submitted AND read via whatif_read_file, V1 (with or without sig)
  //     must NEVER approve V2, NEVER count a refusal on V2, and NEVER clobber V2's pending review
  const mcpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'whatif-reg-mcp-v1v2-'));
  const db = new Db(path.join(mcpDir, 'app.db'));
  try {
    const slug = 'mcp-v1v2';
    const projRoot = path.join(mcpDir, 'projects', slug);
    fs.mkdirSync(path.join(projRoot, 'src', 'episodes', slug), { recursive: true });
    fs.mkdirSync(path.join(projRoot, 'out', slug), { recursive: true });
    fs.writeFileSync(path.join(projRoot, 'out', slug, 'source.fr.md'), SCRIPT_ORIG + '\n');
    db.createProject(slug, slug, projRoot);
    const deps = {
      db,
      bus: new Bus(),
      config: { ...loadConfig(), dataRoot: mcpDir, projectsDir: path.join(mcpDir, 'projects'), skillDir: path.resolve('../what-if-animation') },
      registry,
    };
    const writeEp = (text) =>
      callMcpTool(deps, 'whatif_write_file', {
        episode: slug,
        path: `src/episodes/${slug}/episode.json`,
        content: JSON.stringify(
          { id: 'McpV1V2', slug, lang: 'fr', source: { provider: 'nouveau', videoId: 'vid-v1v2', words: SCRIPT_ORIG.split(/\s+/).length }, script: [{ text }] },
          null,
          2,
        ),
      });

    // Submit V1 and read V1 pack (Reviewer 1)
    await writeEp(SCRIPT_V1);
    await callMcpTool(deps, 'whatif_write_file', { episode: slug, path: `out/${slug}/script-card.json`, content: JSON.stringify(makeCardV1()) });
    assert.equal((await callMcpTool(deps, 'whatif_run', { episode: slug, step: 'script' })).ok, true);
    const readV1 = await callMcpTool(deps, 'whatif_read_file', { episode: slug, path: `out/${slug}/script-pack.md` });
    assert.equal(readV1.ok, true);
    const sigV1 = packSubmittedSig(fs.readFileSync(path.join(projRoot, 'out', slug, 'script-pack.md'), 'utf8'));
    assert.ok(sigV1);

    // Submit V2 and read V2 pack (Reviewer 2) while Reviewer 1 is still running!
    await writeEp(SCRIPT_V2);
    await callMcpTool(deps, 'whatif_write_file', { episode: slug, path: `out/${slug}/script-card.json`, content: JSON.stringify(makeCardV2()) });
    assert.equal((await callMcpTool(deps, 'whatif_run', { episode: slug, step: 'script' })).ok, true);
    const readV2 = await callMcpTool(deps, 'whatif_read_file', { episode: slug, path: `out/${slug}/script-pack.md` });
    assert.equal(readV2.ok, true);
    const sigV2 = packSubmittedSig(fs.readFileSync(path.join(projRoot, 'out', slug, 'script-pack.md'), 'utf8'));
    assert.ok(sigV2 && sigV2 !== sigV1);

    // Attack 1: Reviewer 1 calls whatif_save_script_review WITHOUT sig AFTER V2 pack was read!
    // (Previously lastReadScriptPackSig had been overwritten with V2's sig and approved V2!)
    const v1NoSig = await callMcpTool(deps, 'whatif_save_script_review', {
      episode: slug,
      pass: true,
      sameStory: true,
      issues: [],
    });
    assert.equal(v1NoSig.ok, false, 'omitting sig after V2 consultation must NEVER approve V2');
    assert.equal(readScriptState(projRoot, slug)?.status, 'review');
    assert.ok(scriptGate(projRoot, slug));

    // Attack 2: Reviewer 1 sends approval with sigV1
    const v1Pass = await callMcpTool(deps, 'whatif_save_script_review', {
      episode: slug,
      pass: true,
      sameStory: true,
      sig: sigV1,
      issues: [],
    });
    assert.equal(v1Pass.ok, false, 'V1 token must NEVER approve V2');
    assert.equal(readScriptState(projRoot, slug)?.status, 'review');

    // Attack 3: Reviewer 1 sends refusal with sigV1 -> must NOT increment V2's refused counter!
    const v1Refuse = await callMcpTool(deps, 'whatif_save_script_review', {
      episode: slug,
      pass: false,
      sameStory: false,
      sig: sigV1,
      issues: [{ rule: 'histoire', problem: 'stale V1 issue' }],
    });
    assert.equal(v1Refuse.ok, false);
    assert.equal(readScriptState(projRoot, slug)?.refused, 0, 'stale V1 refusal must not count against V2');
    assert.equal(readScriptState(projRoot, slug)?.status, 'review', 'V2 must remain open for Reviewer 2');

    // Attack 4: Reviewer 1 times out twice with sigV1 -> must NOT increment V2's reviewFailures or trigger fallback!
    recordScriptReviewFailure(projRoot, slug, 'timeout V1 #1', sigV1);
    recordScriptReviewFailure(projRoot, slug, 'timeout V1 #2', sigV1);
    assert.equal(readScriptState(projRoot, slug)?.reviewFailures, 0, 'V1 timeouts must not count against V2');
    assert.equal(readScriptState(projRoot, slug)?.status, 'review', 'V1 timeouts must not fallback-approve V2');
    assert.ok(scriptGate(projRoot, slug));

    // Legitimate Reviewer 2 now submits its verdict with sigV2 -> V2 is cleanly approved!
    const v2Ok = await callMcpTool(deps, 'whatif_save_script_review', {
      episode: slug,
      pass: true,
      sameStory: true,
      sig: sigV2,
      issues: [],
    });
    assert.equal(v2Ok.ok, true, v2Ok.summary);
    assert.equal(readScriptState(projRoot, slug)?.status, 'approved');
    assert.equal(scriptGate(projRoot, slug), null);
  } finally {
    db.close();
    fs.rmSync(mcpDir, { recursive: true, force: true });
  }

  // 1d. Concurrent reviewScript (orchestrator/reviewer.ts:1167-1180) AND sequential V1 failures -> V2:
  //     V1 errors/timeouts/non-JSON must NEVER trigger V2's fallback!
  const conc = makeScriptEp(SCRIPT_V1);
  try {
    conc.setCard(makeCardV1());
    const s1 = runScriptStep(conc.root, conc.slug);
    assert.equal(s1.needsReview, true);

    // Concurrent V1 reviewScript in flight while V2 is submitted: V1 throws an error, then another V1 returns non-JSON
    let swappedToV2 = false;
    const slowFailingV1Provider = {
      model: 'v1-timeout',
      label: 'v1-timeout',
      async chat() {
        if (!swappedToV2) {
          swappedToV2 = true;
          conc.setScript(SCRIPT_V2);
          conc.setCard(makeCardV2());
          const s2 = runScriptStep(conc.root, conc.slug);
          assert.equal(s2.needsReview, true);
        }
        throw new Error('504 gateway timeout on V1');
      },
    };
    await reviewScript(slowFailingV1Provider, conc.root, conc.slug);
    const stAfterV1Err = readScriptState(conc.root, conc.slug);
    assert.equal(stAfterV1Err.status, 'review', 'in-flight V1 error after V2 submission must leave V2 in review');
    assert.equal(stAfterV1Err.reviewFailures, 0, 'in-flight V1 error must NEVER increment V2 reviewFailures');
    assert.ok(scriptGate(conc.root, conc.slug));
  } finally {
    fs.rmSync(conc.root, { recursive: true, force: true });
  }

  // Sequential V1 failures (1 or 2 failures on V1) followed by editing to V2: V2 must start with reviewFailures=0 and require review!
  const seq = makeScriptEp(SCRIPT_V1);
  try {
    seq.setCard(makeCardV1());
    runScriptStep(seq.root, seq.slug);
    const brokenProvider = {
      model: 'broken-llm',
      label: 'broken-llm',
      async chat() {
        return { text: 'not valid json at all', toolCalls: [] };
      },
    };
    await reviewScript(brokenProvider, seq.root, seq.slug);
    assert.equal(readScriptState(seq.root, seq.slug)?.reviewFailures, 1);
    await reviewScript(brokenProvider, seq.root, seq.slug);
    assert.equal(readScriptState(seq.root, seq.slug)?.status, 'approved', '2 failures on V1 fallback-approve V1');
    assert.equal(readScriptState(seq.root, seq.slug)?.reviewer, 'skipped');

    // Now author edits script to V2 and runs step "script": V1's 2 failures MUST NOT auto-approve V2!
    seq.setScript(SCRIPT_V2);
    seq.setCard(makeCardV2());
    const v2Step = runScriptStep(seq.root, seq.slug);
    assert.equal(v2Step.needsReview, true, 'V2 must require Reviewer even after V1 hit maxReviewFailures');
    assert.equal(v2Step.state.status, 'review');
    assert.equal(v2Step.state.reviewFailures, 0, 'V2 reviewFailures must reset to 0');
    assert.ok(scriptGate(seq.root, seq.slug), 'voice gate must close again for V2');

    // Also verify V1 -> V2 -> V1 (same text resubmitted): old token from first V1 submission cannot approve second V1 submission
    const firstV1 = makeScriptEp(SCRIPT_V1);
    try {
      firstV1.setCard(makeCardV1());
      const subA = runScriptStep(firstV1.root, firstV1.slug);
      const tokenA = subA.state.submittedSig;
      firstV1.setScript(SCRIPT_V2);
      firstV1.setCard(makeCardV2());
      runScriptStep(firstV1.root, firstV1.slug);
      firstV1.setScript(SCRIPT_V1);
      firstV1.setCard(makeCardV1());
      const subB = runScriptStep(firstV1.root, firstV1.slug);
      const tokenB = subB.state.submittedSig;
      assert.notEqual(tokenA, tokenB, 'resubmitting identical text after V2 produces a fresh token');
      const staleApprove = recordScriptReview(firstV1.root, firstV1.slug, { pass: true, sameStory: true, sig: tokenA, issues: [] });
      assert.equal(staleApprove.state.status, 'review', 'consumed/superseded V1 token must not approve resubmitted V1');
    } finally {
      fs.rmSync(firstV1.root, { recursive: true, force: true });
    }

    // 1e. CRITICAL: V1 APPROVED -> V2 SUBMITTED (or blocked/approved) -> RETURN TO V1:
    //     Stale `script-review.json` holding V1's old `pass: true` MUST NEVER auto-reapprove V1 without a new verdict bound to the new V1 token!
    const bounce = makeScriptEp(SCRIPT_V1);
    try {
      bounce.setCard(makeCardV1());
      const v1Sub1 = runScriptStep(bounce.root, bounce.slug);
      assert.equal(v1Sub1.needsReview, true);
      const tokenV1Old = v1Sub1.state.submittedSig;

      const v1Approved = recordScriptReview(bounce.root, bounce.slug, {
        pass: true,
        sameStory: true,
        sig: tokenV1Old,
        issues: [],
        model: 'reviewer-v1',
      });
      assert.equal(v1Approved.state.status, 'approved');
      assert.equal(v1Approved.state.submittedSig, tokenV1Old);
      assert.equal(scriptGate(bounce.root, bounce.slug), null);
      assert.equal(fs.existsSync(path.join(bounce.outDir, 'source.fit.md')), true);

      // Submit V2 (script-review.json on disk STILL contains V1's pass:true record!)
      bounce.setScript(SCRIPT_V2);
      bounce.setCard(makeCardV2());
      const v2Sub = runScriptStep(bounce.root, bounce.slug);
      assert.equal(v2Sub.needsReview, true);
      assert.equal(v2Sub.state.status, 'review');
      assert.equal(fs.existsSync(path.join(bounce.outDir, 'source.fit.md')), false, 'superseded V1 source.fit.md must be cleared');
      assert.ok(scriptGate(bounce.root, bounce.slug));

      // Return to V1 without any new verdict
      bounce.setScript(SCRIPT_V1);
      bounce.setCard(makeCardV1());
      assert.ok(scriptGate(bounce.root, bounce.slug), 'returning to V1 after V2 submission must keep voice gate closed');

      const v1ReturnStep = runScriptStep(bounce.root, bounce.slug);
      assert.equal(v1ReturnStep.needsReview, true, 'returned V1 MUST require a fresh Reviewer read instead of auto-approving from old script-review.json');
      assert.equal(v1ReturnStep.state.status, 'review');
      const tokenV1New = v1ReturnStep.state.submittedSig;
      assert.notEqual(tokenV1New, tokenV1Old);
      assert.equal(fs.existsSync(path.join(bounce.outDir, 'source.fit.md')), false);
      assert.ok(scriptGate(bounce.root, bounce.slug), 'voice gate must stay closed until new V1 submission is reviewed');

      // Re-running step "script" again on returned V1 while review is still pending must ALSO stay in review (never approve from old script-review.json)
      const v1ReturnAgain = runScriptStep(bounce.root, bounce.slug);
      assert.equal(v1ReturnAgain.needsReview, true);
      assert.equal(v1ReturnAgain.state.status, 'review');
      const tokenV1Latest = v1ReturnAgain.state.submittedSig;
      assert.ok(scriptGate(bounce.root, bounce.slug));

      // Old V1 token from the first approval must be rejected
      const replayOldToken = recordScriptReview(bounce.root, bounce.slug, {
        pass: true,
        sameStory: true,
        sig: tokenV1Old,
        issues: [],
      });
      assert.equal(replayOldToken.state.status, 'review');
      assert.ok(scriptGate(bounce.root, bounce.slug));

      // Fresh verdict bound to the active current token approves V1 again
      const freshApprove = recordScriptReview(bounce.root, bounce.slug, {
        pass: true,
        sameStory: true,
        sig: tokenV1Latest,
        issues: [],
        model: 'reviewer-v1-fresh',
      });
      assert.equal(freshApprove.state.status, 'approved');
      assert.equal(freshApprove.state.submittedSig, tokenV1Latest);
      assert.equal(scriptGate(bounce.root, bounce.slug), null);
    } finally {
      fs.rmSync(bounce.root, { recursive: true, force: true });
    }
  } finally {
    fs.rmSync(seq.root, { recursive: true, force: true });
  }
});

test('Issue 4: pass:false without boolean sameStory is an incomplete verdict that never counts as a complete refusal or exhausts attempts', async () => {
  const { runScriptStep, recordScriptReview, readScriptState, scriptGate } = await import('../dist/tools/script-check.js');
  const { reviewScript } = await import('../dist/orchestrator/reviewer.js');
  const { callMcpTool } = await import('../dist/mcp/service.js');
  const { Db } = await import('../dist/orchestrator/db.js');
  const { Bus } = await import('../dist/orchestrator/bus.js');
  const { loadConfig } = await import('../dist/orchestrator/config.js');
  const { defaultRegistry } = await import('../dist/tools/index.js');

  // 4a. Direct recordScriptReview & reviewScript: repeated pass:false without sameStory never increments refused, never discards, never approves
  const a = makeScriptEp(SCRIPT_V1);
  try {
    a.setCard(makeCardV1());
    const step = runScriptStep(a.root, a.slug);
    const sig = step.state.submittedSig;

    for (let i = 0; i < 4; i++) {
      const rec = recordScriptReview(a.root, a.slug, {
        pass: false,
        sig,
        issues: [{ rule: 'ouverture', problem: 'ouverture faible' }],
      });
      assert.equal(rec.state.status, 'review', `attempt ${i + 1}: pass:false without sameStory must keep status=review`);
      assert.equal(rec.state.refused, 0, `attempt ${i + 1}: pass:false without sameStory must NOT increment refused`);
      assert.equal(rec.state.reviewFailures, 0, `attempt ${i + 1}: must NOT increment reviewFailures either`);
      assert.ok(scriptGate(a.root, a.slug));
    }

    // LLM reviewScript returning {"pass": false, "issues": [...]} without sameStory 3 times in a row
    const incompleteRefusalProvider = {
      model: 'incomplete-refusal',
      label: 'incomplete-refusal',
      async chat() {
        return { text: '{"pass": false, "issues": [{"rule": "chute", "problem": "morale"}]}', toolCalls: [] };
      },
    };
    for (let i = 0; i < 3; i++) {
      await reviewScript(incompleteRefusalProvider, a.root, a.slug);
      const st = readScriptState(a.root, a.slug);
      assert.equal(st.status, 'review', 'incomplete LLM refusal must not discard or block');
      assert.equal(st.refused, 0, 'incomplete LLM refusal must not exhaust attempts');
      assert.equal(st.reviewFailures, 0, 'incomplete LLM refusal must not trigger fallback approval');
    }

    // Now a complete refusal WITH explicit boolean sameStory: true counts as refusal #1 (not #2 / discarded!)
    const realRefusal = recordScriptReview(a.root, a.slug, {
      pass: false,
      sameStory: true,
      sig,
      issues: [{ rule: 'chute', problem: 'morale finale' }],
    });
    assert.equal(realRefusal.state.status, 'blocked', 'first complete refusal leaves 1 remaining attempt instead of discarding');
    assert.equal(realRefusal.state.refused, 1);
  } finally {
    fs.rmSync(a.root, { recursive: true, force: true });
  }

  // 4b. MCP whatif_save_script_review with pass:false and missing sameStory
  const mcpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'whatif-reg-mcp4-'));
  const db = new Db(path.join(mcpDir, 'app.db'));
  try {
    const slug = 'mcp-passfalse';
    const projRoot = path.join(mcpDir, 'projects', slug);
    fs.mkdirSync(path.join(projRoot, 'src', 'episodes', slug), { recursive: true });
    fs.mkdirSync(path.join(projRoot, 'out', slug), { recursive: true });
    fs.writeFileSync(path.join(projRoot, 'out', slug, 'source.fr.md'), SCRIPT_ORIG + '\n');
    fs.writeFileSync(
      path.join(projRoot, 'src', 'episodes', slug, 'episode.json'),
      JSON.stringify({ id: 'McpPf', slug, lang: 'fr', source: { provider: 'nouveau', videoId: 'vid-pf', words: SCRIPT_ORIG.split(/\s+/).length }, script: [{ text: SCRIPT_V1 }] }),
    );
    fs.writeFileSync(path.join(projRoot, 'out', slug, 'script-card.json'), JSON.stringify(makeCardV1()));
    db.createProject(slug, slug, projRoot);
    const deps = { db, bus: new Bus(), config: { ...loadConfig(), dataRoot: mcpDir, projectsDir: path.join(mcpDir, 'projects') }, registry: defaultRegistry() };
    const st = runScriptStep(projRoot, slug);
    const sig = st.state.submittedSig;

    for (let i = 0; i < 3; i++) {
      const res = await callMcpTool(deps, 'whatif_save_script_review', {
        episode: slug,
        pass: false,
        sig,
        issues: [{ problem: 'sans sameStory' }],
      });
      assert.equal(res.ok, false);
      assert.equal(readScriptState(projRoot, slug)?.refused, 0, 'MCP pass:false without sameStory must not burn attempts');
      assert.equal(readScriptState(projRoot, slug)?.status, 'review');
    }
  } finally {
    db.close();
    fs.rmSync(mcpDir, { recursive: true, force: true });
  }
});

test('Issue 2: voice_fish.py blocks unproven textless server TTS even when local source script is identical, rejects partial ASR, marks ASR estimates explicitly, and fails closed when certainty is required', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'whatif-reg-voice-'));
  let srv;
  try {
    fs.mkdirSync(path.join(dir, 'src', 'episodes'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'package.json'), '{"name":"test-voice"}');

    const sampleMp3 = path.join(dir, 'sample.mp3');
    execFileSync(
      'ffmpeg',
      ['-y', '-v', 'error', '-f', 'lavfi', '-i', 'sine=frequency=280:duration=1.6', '-ar', '44100', '-ac', '1', sampleMp3],
      { stdio: 'pipe' },
    );
    const mp3Bytes = fs.readFileSync(sampleMp3);

    const origProposal = "Il prend la boîte bleue sur l'étagère du fond et sort sans bruit.";
    const editedScript = "Il arrache l'étiquette jaune du carton devant le vigile de l'entrée.";
    // Minor 1-word ASR difference (12/13 = 92.3% match, < 100%) to test partial-estimate signaling vs fail-closed
    const nearMatchAsr = "Il prend la boîte bleue dans l'étagère du fond et sort sans bruit.";
    // Truncated partial ASR (first 6 words out of 13 = 46% coverage) -> must be rejected!
    const truncatedAsr = 'Il prend la boîte bleue sur';

    let ttsCheckPayload = {
      exists: true,
      file_exists: true,
      id: 42,
      path: '/downloads/tts/old_textless_hugo.mp3',
      voice: 'elevenlabs:3Tp5mYhT9wrfnry9pzvV', // Hugo (matches male narrator of origProposal), NO `text` field!
      duration_seconds: 1.6,
    };
    let transcribeMode = 'full_orig'; // 'full_orig' | 'near_orig' | 'truncated' | 'segment_only' | 'new_words' | 'error'
    const elevenCalls = [];

    const wordsPayload = (sentence) => {
      const toks = sentence.split(/\s+/).filter(Boolean);
      const step = 1.4 / toks.length;
      return {
        transcript: [
          {
            start: 0.05,
            end: 1.5,
            text: sentence,
            words: toks.map((w, i) => ({
              word: w,
              start: Number((0.05 + i * step).toFixed(3)),
              end: Number((0.05 + (i + 0.85) * step).toFixed(3)),
            })),
          },
        ],
      };
    };

    srv = http.createServer((req, res) => {
      const u = req.url || '';
      if (req.method === 'GET' && u.startsWith('/api/videos/vid-up')) {
        if (u.includes('/transcript/check')) {
          res.writeHead(200, { 'content-type': 'application/json' });
          res.end(JSON.stringify({ exists: true, file_exists: true }));
          return;
        }
        if (u.endsWith('/tts/check')) {
          res.writeHead(200, { 'content-type': 'application/json' });
          res.end(JSON.stringify(ttsCheckPayload));
          return;
        }
        if (u.endsWith('/translations')) {
          res.writeHead(200, { 'content-type': 'application/json' });
          res.end(
            JSON.stringify({
              proposals: [
                {
                  id: 101,
                  is_selected: true,
                  prompt_type: 'hook',
                  model_name: 'test',
                  title: 'Le rayon',
                  translation: origProposal,
                },
              ],
            }),
          );
          return;
        }
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ id: 'vid-up', title: 'Le rayon', duration_seconds: 20 }));
        return;
      }
      if (req.method === 'POST' && u.includes('/translations/101/select')) {
        req.resume();
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ ok: true }));
        return;
      }
      if (req.method === 'POST' && u.endsWith('/tts/elevenlabs')) {
        let body = '';
        req.on('data', (c) => (body += c));
        req.on('end', () => {
          elevenCalls.push(JSON.parse(body || '{}'));
          res.writeHead(200, { 'content-type': 'application/json' });
          res.end(JSON.stringify({ id: 202, audioPath: '/downloads/tts/fresh_generated.mp3' }));
        });
        return;
      }
      if (req.method === 'POST' && u.includes('/tts/transcribe')) {
        req.resume();
        req.on('end', () => {
          if (transcribeMode === 'error') {
            res.writeHead(500, { 'content-type': 'application/json' });
            res.end(JSON.stringify({ detail: 'ASR down' }));
            return;
          }
          res.writeHead(200, { 'content-type': 'application/json' });
          if (transcribeMode === 'truncated') {
            res.end(JSON.stringify(wordsPayload(truncatedAsr)));
          } else if (transcribeMode === 'segment_only') {
            res.end(JSON.stringify({ transcript: [{ start: 0.05, end: 1.5, text: origProposal }] }));
          } else if (transcribeMode === 'near_orig') {
            res.end(JSON.stringify(wordsPayload(nearMatchAsr)));
          } else if (transcribeMode === 'new_words') {
            res.end(JSON.stringify(wordsPayload(editedScript)));
          } else {
            res.end(JSON.stringify(wordsPayload(origProposal)));
          }
        });
        return;
      }
      if (req.method === 'GET' && u.startsWith('/downloads/tts/')) {
        res.writeHead(200, { 'content-type': 'audio/mpeg' });
        res.end(mp3Bytes);
        return;
      }
      req.resume();
      res.writeHead(404);
      res.end('not found');
    });
    await new Promise((r) => srv.listen(0, '127.0.0.1', r));
    const env = { ...process.env, WHATIF_NOUVEAU_URL: `http://127.0.0.1:${srv.address().port}` };

    // 2a. Server TTS WITHOUT associated text (`chk.text` absent) while `episode.json.script` == `source.fr.md` == `script.orig.md`:
    //     Identical local source script does NOT prove the old server audio matches! Must block reuse & regenerate!
    const slugTextless = 'tts-textless-identical-src';
    const epDirTl = path.join(dir, 'src', 'episodes', slugTextless);
    fs.mkdirSync(epDirTl, { recursive: true });
    fs.writeFileSync(
      path.join(epDirTl, 'episode.json'),
      JSON.stringify({ id: 'TlId', slug: slugTextless, aspect: '9:16', source: { provider: 'nouveau', videoId: 'vid-up' }, script: [], shots: [] }),
    );
    await execFileAsync('python3', [path.resolve('pipeline/source_import.py'), slugTextless, '--video', 'vid-up', '--apply'], { cwd: dir, env });
    fs.writeFileSync(path.join(dir, 'out', slugTextless, 'script.orig.md'), origProposal + '\n');
    const textlessRun = await execFileAsync('python3', [path.resolve('pipeline/voice_fish.py'), slugTextless], { cwd: dir, env });
    assert.equal(elevenCalls.length, 1, 'must NOT reuse textless server TTS even when local source script is identical');
    const metaTl = JSON.parse(fs.readFileSync(path.join(dir, 'out', slugTextless, 'voice_meta.json'), 'utf8'));
    assert.equal(metaTl.skippedServerAudio?.status, 'unprovable');
    assert.equal(metaTl.audioPath, '/downloads/tts/fresh_generated.mp3');
    assert.match(textlessRun.stdout, /unprovable.*identical local source baseline is not proof/i);

    // 2b. Server TTS WITH matching declared `text` AND 100% Deepgram word-level ASR:
    //     Honest classification (`correspondence: 'declared_text_and_asr'`, `wordGuarantee: 'declared_association_and_asr_only'`, `integralWordsGuaranteed: false`)
    transcribeMode = 'full_orig';
    const slugExactTts = 'tts-with-exact-sig';
    const epDirEx = path.join(dir, 'src', 'episodes', slugExactTts);
    fs.mkdirSync(epDirEx, { recursive: true });
    fs.writeFileSync(
      path.join(epDirEx, 'episode.json'),
      JSON.stringify({
        id: 'ExTts',
        slug: slugExactTts,
        aspect: '9:16',
        voice: { voiceId: '3Tp5mYhT9wrfnry9pzvV', locked: true },
        source: { provider: 'nouveau', videoId: 'vid-up' },
        script: [{ text: origProposal }],
        shots: [],
      }),
    );
    ttsCheckPayload = {
      exists: true,
      file_exists: true,
      id: 55,
      path: '/downloads/tts/proven_hugo.mp3',
      voice: 'elevenlabs:3Tp5mYhT9wrfnry9pzvV',
      text: origProposal,
      duration_seconds: 1.6,
    };
    const exRun = await execFileAsync('python3', [path.resolve('pipeline/voice_fish.py'), slugExactTts], { cwd: dir, env });
    assert.equal(elevenCalls.length, 1, 'server TTS carrying matching declared text is reused and validated via ASR');
    const metaEx = JSON.parse(fs.readFileSync(path.join(dir, 'out', slugExactTts, 'voice_meta.json'), 'utf8'));
    assert.equal(metaEx.correspondence, 'declared_text_and_asr');
    assert.equal(metaEx.textAssociation, 'server_declared_text');
    assert.equal(metaEx.asrValidated, true);
    assert.equal(metaEx.exactMatch, true);
    assert.equal(metaEx.wordGuarantee, 'declared_association_and_asr_only');
    assert.equal(metaEx.integralWordsGuaranteed, false, 'must NEVER claim integral guarantee of spoken words');
    const exRes = JSON.parse(exRun.stdout.split('\n').find((l) => l.startsWith('RESULT_JSON:')).slice('RESULT_JSON:'.length));
    assert.equal(exRes.correspondence, 'declared_text_and_asr');
    assert.equal(exRes.wordGuarantee, 'declared_association_and_asr_only');
    assert.equal(exRes.integralWordsGuaranteed, false);

    // 2b-bis. Server TTS (or fresh TTS) WITH matching declared text when ASR is UNAVAILABLE (`error`) or PARTIAL (`near_orig`):
    //         Simple declared text / TTS request NEVER affirms word certainty (`exactMatch: false`), and `--require-exact` fails closed!
    transcribeMode = 'error';
    const slugNoAsrDef = 'tts-declared-no-asr-default';
    fs.mkdirSync(path.join(dir, 'src', 'episodes', slugNoAsrDef), { recursive: true });
    fs.writeFileSync(
      path.join(dir, 'src', 'episodes', slugNoAsrDef, 'episode.json'),
      JSON.stringify({
        id: 'NoAsrDef',
        slug: slugNoAsrDef,
        aspect: '9:16',
        voice: { voiceId: '3Tp5mYhT9wrfnry9pzvV', locked: true },
        source: { provider: 'nouveau', videoId: 'vid-up' },
        script: [{ text: origProposal }],
        shots: [],
      }),
    );
    const noAsrDefRun = await execFileAsync('python3', [path.resolve('pipeline/voice_fish.py'), slugNoAsrDef], { cwd: dir, env });
    const noAsrDefRes = JSON.parse(noAsrDefRun.stdout.split('\n').find((l) => l.startsWith('RESULT_JSON:')).slice('RESULT_JSON:'.length));
    assert.equal(noAsrDefRes.exactMatch, false, 'declared server text without ASR validation must NEVER claim exactMatch=true');
    assert.equal(noAsrDefRes.asrValidated, false);
    assert.equal(noAsrDefRes.correspondence, 'declared_text_unvalidated_no_asr');
    assert.equal(noAsrDefRes.integralWordsGuaranteed, false);
    assert.ok(noAsrDefRes.estimationWarning);

    // Same server TTS with matching declared text + `--require-exact` while ASR is unavailable -> MUST FAIL CLOSED (exit 4)!
    const slugNoAsrStrict = 'tts-declared-no-asr-strict';
    fs.mkdirSync(path.join(dir, 'src', 'episodes', slugNoAsrStrict), { recursive: true });
    fs.writeFileSync(
      path.join(dir, 'src', 'episodes', slugNoAsrStrict, 'episode.json'),
      JSON.stringify({
        id: 'NoAsrSt',
        slug: slugNoAsrStrict,
        aspect: '9:16',
        voice: { voiceId: '3Tp5mYhT9wrfnry9pzvV', locked: true },
        source: { provider: 'nouveau', videoId: 'vid-up' },
        script: [{ text: origProposal }],
        shots: [],
      }),
    );
    const noAsrStrictErr = await execFileAsync('python3', [path.resolve('pipeline/voice_fish.py'), slugNoAsrStrict, '--require-exact'], { cwd: dir, env }).catch((e) => e);
    assert.equal(noAsrStrictErr.code, 4, '--require-exact must fail closed when ASR is unavailable even if server TTS has matching text');
    assert.equal(fs.existsSync(path.join(dir, 'public', slugNoAsrStrict, 'voice.wav')), false);
    const noAsrStrictRes = JSON.parse(String(noAsrStrictErr.stdout || '').split('\n').find((l) => l.startsWith('RESULT_JSON:')).slice('RESULT_JSON:'.length));
    assert.equal(noAsrStrictRes.ok, false);
    assert.equal(noAsrStrictRes.exactMatch, false);
    assert.equal(noAsrStrictRes.correspondence, 'declared_text_unvalidated_no_asr');

    // Freshly generated TTS (`--force`) + `--require-exact` while ASR is unavailable -> ALSO fails closed (TTS input alone never proves spoken words)!
    const freshNoAsrErr = await execFileAsync(
      'python3',
      [path.resolve('pipeline/voice_fish.py'), slugNoAsrStrict, '--force', '--require-exact'],
      { cwd: dir, env },
    ).catch((e) => e);
    assert.equal(freshNoAsrErr.code, 4, 'fresh TTS without ASR validation must also fail closed under --require-exact');
    assert.equal(fs.existsSync(path.join(dir, 'public', slugNoAsrStrict, 'voice.wav')), false);

    // 2b-ter. LEGACY CACHE (`exactMatch` absent in `voice_meta.json`, or legacy `exact_text_sig` without `asrValidated`):
    //         - Non-strict mode: never defaults `exactMatch` to `true` (`exactMatch: false`, `correspondence: 'legacy_unverified_cache'`)
    //         - `--require-exact`: REJECTS the legacy cache and fails closed when ASR is unavailable!
    const slugLegacyCache = 'tts-legacy-cache';
    fs.mkdirSync(path.join(dir, 'src', 'episodes', slugLegacyCache), { recursive: true });
    fs.writeFileSync(
      path.join(dir, 'src', 'episodes', slugLegacyCache, 'episode.json'),
      JSON.stringify({
        id: 'LegCache',
        slug: slugLegacyCache,
        aspect: '9:16',
        voice: { voiceId: '3Tp5mYhT9wrfnry9pzvV', locked: true, tempo: 1.3 },
        source: { provider: 'nouveau', videoId: 'vid-up' },
        script: [{ text: origProposal }],
        shots: [],
      }),
    );
    transcribeMode = 'full_orig';
    await execFileAsync('python3', [path.resolve('pipeline/voice_fish.py'), slugLegacyCache], { cwd: dir, env });
    const legacyMetaPath = path.join(dir, 'out', slugLegacyCache, 'voice_meta.json');
    const fullMeta = JSON.parse(fs.readFileSync(legacyMetaPath, 'utf8'));
    // Strip exactMatch / asrValidated / correspondence to simulate an older pre-audit cache on disk
    const strippedLegacyMeta = {
      sig: fullMeta.sig,
      text_sig: fullMeta.text_sig,
      raw_text_sig: fullMeta.raw_text_sig,
      lang: fullMeta.lang,
      provider: fullMeta.provider,
      modelId: fullMeta.modelId,
      voiceId: fullMeta.voiceId,
      videoId: fullMeta.videoId,
      audioPath: fullMeta.audioPath,
      asr: 'deepgram',
      words: fullMeta.words,
    };
    fs.writeFileSync(legacyMetaPath, JSON.stringify(strippedLegacyMeta, null, 2));

    // Non-strict run reuses local files without API calls, but honestly reports exactMatch=false
    transcribeMode = 'error';
    const legDefaultRun = await execFileAsync('python3', [path.resolve('pipeline/voice_fish.py'), slugLegacyCache], { cwd: dir, env });
    const legDefaultRes = JSON.parse(legDefaultRun.stdout.split('\n').find((l) => l.startsWith('RESULT_JSON:')).slice('RESULT_JSON:'.length));
    assert.equal(legDefaultRes.exactMatch, false, 'legacy cache without exactMatch must never report exactMatch=true');
    assert.equal(legDefaultRes.correspondence, 'legacy_unverified_cache');
    assert.equal(legDefaultRes.integralWordsGuaranteed, false);

    // Strict `--require-exact` run MUST reject the legacy cache (where exactMatch is absent) and fail closed when ASR is unavailable!
    const legStrictErr = await execFileAsync('python3', [path.resolve('pipeline/voice_fish.py'), slugLegacyCache, '--require-exact'], { cwd: dir, env }).catch((e) => e);
    assert.equal(legStrictErr.code, 4, '--require-exact must NEVER accept a legacy cache with exactMatch absent');
    assert.match(String(legStrictErr.stdout || ''), /rejecting local cache under --require-exact/i);
    const legStrictRes = JSON.parse(String(legStrictErr.stdout || '').split('\n').find((l) => l.startsWith('RESULT_JSON:')).slice('RESULT_JSON:'.length));
    assert.equal(legStrictRes.ok, false);
    assert.equal(legStrictRes.exactMatch, false);

    // Also test legacy cache carrying old `exactMatch: true, correspondence: "exact_text_sig"` without `asrValidated`: rejected too!
    fs.writeFileSync(legacyMetaPath, JSON.stringify({ ...strippedLegacyMeta, exactMatch: true, correspondence: 'exact_text_sig' }, null, 2));
    const oldClaimStrictErr = await execFileAsync('python3', [path.resolve('pipeline/voice_fish.py'), slugLegacyCache, '--require-exact'], { cwd: dir, env }).catch((e) => e);
    assert.equal(oldClaimStrictErr.code, 4, '--require-exact must reject unvalidated exact_text_sig cache entries');

    // 2c. Truncated partial ASR (46% words) AND segment-only ASR (no word timings) on `upload`:
    //     - Default mode: blocks upload reuse and regenerates
    //     - Strict `--require-exact` mode (without `--force` or `--voice`): STOPS (`exit 4`) WITHOUT unauthorized TTS regeneration!
    ttsCheckPayload = { exists: true, file_exists: true, id: 77, path: '/downloads/tts/upload_trunc.mp3', voice: 'upload', duration_seconds: 1.6 };
    for (const [mode, slugSub, expectedStatus] of [
      ['truncated', 'up-truncated', 'partial_asr'],
      ['segment_only', 'up-seg-only', 'unprovable'],
    ]) {
      transcribeMode = mode;
      const epDirSub = path.join(dir, 'src', 'episodes', slugSub);
      fs.mkdirSync(epDirSub, { recursive: true });
      fs.writeFileSync(
        path.join(epDirSub, 'episode.json'),
        JSON.stringify({ id: 'Sub', slug: slugSub, aspect: '9:16', source: { provider: 'nouveau', videoId: 'vid-up' }, script: [{ text: origProposal }], shots: [] }),
      );
      const beforeCalls = elevenCalls.length;
      await execFileAsync('python3', [path.resolve('pipeline/voice_fish.py'), slugSub], { cwd: dir, env });
      assert.equal(elevenCalls.length, beforeCalls + 1, `mode=${mode} in default mode blocks upload reuse and regenerates`);
      const mSub = JSON.parse(fs.readFileSync(path.join(dir, 'out', slugSub, 'voice_meta.json'), 'utf8'));
      assert.equal(mSub.skippedServerAudio?.status, expectedStatus);
    }

    // Strict `--require-exact` on `:8005` `upload` when ASR is UNAVAILABLE (`error`), `segment_only`, OR `truncated` (uncertain ASR):
    // MUST STOP (exit 4, ok:false) and MUST NOT call ElevenLabs without explicit `--force` or `--voice`!
    for (const [mode, slugStrictUp, expectedStatus] of [
      ['error', 'up-strict-asr-down', 'unprovable'],
      ['segment_only', 'up-strict-seg-only', 'unprovable'],
      ['truncated', 'up-strict-partial', 'partial_asr'],
    ]) {
      transcribeMode = mode;
      const epDirSu = path.join(dir, 'src', 'episodes', slugStrictUp);
      fs.mkdirSync(epDirSu, { recursive: true });
      fs.writeFileSync(
        path.join(epDirSu, 'episode.json'),
        JSON.stringify({ id: 'Su', slug: slugStrictUp, aspect: '9:16', source: { provider: 'nouveau', videoId: 'vid-up' }, script: [{ text: origProposal }], shots: [] }),
      );
      const callsBeforeSu = elevenCalls.length;
      const suErr = await execFileAsync('python3', [path.resolve('pipeline/voice_fish.py'), slugStrictUp, '--require-exact'], { cwd: dir, env }).catch((e) => e);
      assert.equal(suErr.code, 4, `strict mode + upload + ASR=${mode} must stop with exit 4`);
      assert.equal(elevenCalls.length, callsBeforeSu, `strict mode + upload + ASR=${mode} must NEVER trigger unauthorized TTS regeneration`);
      assert.equal(fs.existsSync(path.join(dir, 'public', slugStrictUp, 'voice.wav')), false);
      const suRes = JSON.parse(String(suErr.stdout || '').split('\n').find((l) => l.startsWith('RESULT_JSON:')).slice('RESULT_JSON:'.length));
      assert.equal(suRes.ok, false);
      assert.equal(suRes.exactMatch, false);
      assert.equal(suRes.skippedServerAudio?.status, expectedStatus);
    }

    // 2d. Near-match ASR (92% words, no associated server text) on `upload`:
    //     - In default mode: reused ONLY with explicit estimation warning (`exactMatch: false`, `correspondence: 'asr_partial_estimate'`)
    //     - With `--require-exact` (or `WHATIF_VOICE_REQUIRE_EXACT=1`): FAILS CLOSED (exit code != 0, `ok: false`, no voice.wav written, no TTS overwrite)!
    transcribeMode = 'near_orig';
    const slugEst = 'up-estimated';
    const epDirEst = path.join(dir, 'src', 'episodes', slugEst);
    fs.mkdirSync(epDirEst, { recursive: true });
    fs.writeFileSync(
      path.join(epDirEst, 'episode.json'),
      JSON.stringify({ id: 'UpEst', slug: slugEst, aspect: '9:16', source: { provider: 'nouveau', videoId: 'vid-up' }, script: [{ text: origProposal }], shots: [] }),
    );
    const beforeEst = elevenCalls.length;
    const estRun = await execFileAsync('python3', [path.resolve('pipeline/voice_fish.py'), slugEst], { cwd: dir, env });
    assert.equal(elevenCalls.length, beforeEst, 'default mode reuses high-coverage upload');
    assert.match(estRun.stdout, /ASR ESTIMATE \(not exact identity/i, 'stdout must explicitly flag ASR estimation');
    const resLine = estRun.stdout.split('\n').find((l) => l.startsWith('RESULT_JSON:'));
    const estRes = JSON.parse(resLine.slice('RESULT_JSON:'.length));
    assert.equal(estRes.exactMatch, false, 'ASR correspondence must NEVER claim exactMatch=true');
    assert.equal(estRes.correspondence, 'asr_partial_estimate');
    assert.ok(estRes.estimationWarning, 'RESULT_JSON must carry explicit estimationWarning');

    // Now require certainty (`--require-exact`) on a fresh episode with the same textless upload (even at 100% ASR words!)
    transcribeMode = 'full_orig';
    const slugStrict = 'up-strict-exact';
    const epDirStrict = path.join(dir, 'src', 'episodes', slugStrict);
    fs.mkdirSync(epDirStrict, { recursive: true });
    fs.writeFileSync(
      path.join(epDirStrict, 'episode.json'),
      JSON.stringify({ id: 'UpStrict', slug: slugStrict, aspect: '9:16', source: { provider: 'nouveau', videoId: 'vid-up' }, script: [{ text: origProposal }], shots: [] }),
    );
    const beforeStrict = elevenCalls.length;
    const strictErr = await execFileAsync('python3', [path.resolve('pipeline/voice_fish.py'), slugStrict, '--require-exact'], { cwd: dir, env }).catch((e) => e);
    assert.equal(strictErr.code, 4, '--require-exact must fail closed with exit code 4 when upload has no exact text signature');
    assert.equal(elevenCalls.length, beforeStrict, '--require-exact must not silently overwrite upload with synthetic TTS');
    assert.equal(fs.existsSync(path.join(dir, 'public', slugStrict, 'voice.wav')), false, 'voice.wav must not be written on fail-closed');
    const strictJsonLine = String(strictErr.stdout || '').split('\n').find((l) => l.startsWith('RESULT_JSON:'));
    const strictRes = JSON.parse(strictJsonLine.slice('RESULT_JSON:'.length));
    assert.equal(strictRes.ok, false);
    assert.equal(strictRes.exactMatch, false);
    assert.equal(strictRes.skippedServerAudio?.status, 'unverified_estimate');
  } finally {
    if (srv) await new Promise((r) => srv.close(r));
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('Issue 3: opening verification relies on cryptographic source+timeline+file signatures (never 2s mtime), blocks stale metadata & missing images, marks unproven captures unverified, and validates real renders', async () => {
  const { readOpeningStatus, reviewEpisodeBoard } = await import('../dist/orchestrator/reviewer.js');
  const { callMcpTool } = await import('../dist/mcp/service.js');
  const { Db } = await import('../dist/orchestrator/db.js');
  const { Bus } = await import('../dist/orchestrator/bus.js');
  const { loadConfig } = await import('../dist/orchestrator/config.js');
  const { defaultRegistry } = await import('../dist/tools/index.js');

  // 3a. Unproven PNGs without manifest.json: marked unverified (verified: false, exactFrames: []), never validated as exact
  const unprovDir = fs.mkdtempSync(path.join(os.tmpdir(), 'whatif-reg-open-unprov-'));
  try {
    const slug = 'unprov-open';
    const epDir = path.join(unprovDir, 'src', 'episodes', slug);
    const outDir = path.join(unprovDir, 'out', slug);
    fs.mkdirSync(path.join(epDir, 'shots'), { recursive: true });
    fs.mkdirSync(path.join(outDir, 'board'), { recursive: true });
    fs.mkdirSync(path.join(outDir, 'opening'), { recursive: true });
    execFileSync(
      'python3',
      [
        '-c',
        `
from pathlib import Path
from PIL import Image
out = Path(${JSON.stringify(outDir)})
Image.new("RGB", (540, 960), (220, 40, 180)).save(out / "board" / "S1.png")
for name in ("f0000.png", "f0030.png", "f0060.png"):
    Image.new("RGB", (540, 960), (180, 160, 120)).save(out / "opening" / name)
`,
      ],
      { stdio: 'pipe' },
    );
    const tlObj = {
      fps: 30,
      total: 90,
      segments: [{ shot: 'S1', a: 0, b: 90, t0: 0, t1: 90 }],
      shots: [{ id: 'S1', first: 0, len: 90, key: 18, size: 'insert' }],
    };
    fs.writeFileSync(path.join(epDir, 'timeline.json'), JSON.stringify(tlObj));
    fs.writeFileSync(
      path.join(epDir, 'episode.json'),
      JSON.stringify({
        id: 'UnprovOpen',
        slug,
        aspect: '9:16',
        lang: 'fr',
        opening: { type: 'objet', why: 'boîte', sentence: 'Il ouvre la boîte.' },
        script: [{ text: 'Il ouvre la boîte.' }],
        shots: [{ id: 'S1', size: 'insert', set: 'shop', note: 'Boîte' }],
      }),
    );
    fs.writeFileSync(path.join(epDir, 'DIRECTOR.md'), '# Réalisation\nPlan insert.\n');
    fs.writeFileSync(path.join(epDir, 'shared.tsx'), 'export const SHOP = {};\n');
    fs.writeFileSync(path.join(epDir, 'shots', 'S1.tsx'), 'export const S1 = () => <g />;\n');
    fs.writeFileSync(path.join(epDir, 'shots.tsx'), "export { S1 } from './shots/S1';\n");
    fs.writeFileSync(path.join(epDir, 'index.tsx'), 'export const ep = defineEpisode("UnprovOpen", { timeline, shots: { S1 } });\n');

    execFileSync('python3', [path.resolve('pipeline/board_sheets.py'), unprovDir, slug], { stdio: 'pipe' });
    const meta = JSON.parse(fs.readFileSync(path.join(outDir, 'sheets', 'opening.json'), 'utf8'));
    assert.equal(meta.verified, false, 'PNGs without render manifest must NOT be marked verified');
    assert.deepEqual(meta.exactFrames, [], 'PNGs without render manifest must NOT be listed in exactFrames');
    assert.deepEqual(meta.unverifiedFrames, [0, 30, 60]);
    const st = readOpeningStatus(unprovDir, slug, tlObj);
    assert.equal(st.verified, false);
    assert.deepEqual(st.exact, []);
  } finally {
    fs.rmSync(unprovDir, { recursive: true, force: true });
  }

  // 3b. REAL pipeline render -> cryptographic manifest.json + opening.json -> then test:
  //     (i) modified shot source WITHOUT new render + misleading mtimes (future PNGs/metadata, backdated TSX),
  //     (ii) modified timeline.json WITHOUT new render + misleading mtimes,
  //     (iii) deleted opening image (f0030.png) while opening.json & opening.jpg remain on disk!
  const skillDir = path.resolve('../what-if-animation');
  const existingNm = [
    path.join(skillDir, 'studio', 'node_modules'),
    ...(() => {
      try {
        const pd = path.resolve('data/projects');
        return fs.readdirSync(pd).map((d) => path.join(pd, d, 'node_modules'));
      } catch {
        return [];
      }
    })(),
  ].find((c) => fs.existsSync(path.join(c, '@remotion', 'renderer')) && fs.existsSync(path.join(c, 'react-dom')));
  assert.ok(existingNm, 'expected local @remotion/renderer node_modules for real pipeline test');

  const realDir = fs.mkdtempSync(path.join(os.tmpdir(), 'whatif-reg-real-open-'));
  const prevRenderEnv = process.env.WHATIF_RENDER;
  process.env.WHATIF_RENDER = 'local';
  const db = new Db(path.join(realDir, 'app.db'));
  try {
    const slug = 'real-open';
    const projRoot = path.join(realDir, 'projects', slug);
    const registry = defaultRegistry();
    const ctx = {
      projectId: slug,
      projectRoot: projRoot,
      dataRoot: realDir,
      skillDir,
      log: () => {},
      signal: new AbortController().signal,
    };

    const created = await registry.run('whatif_new', { episode: slug, aspect: '9:16', force: true }, ctx);
    assert.equal(created.ok, true, created.summary);
    db.createProject(slug, slug, projRoot);
    if (!fs.existsSync(path.join(projRoot, 'node_modules'))) {
      fs.symlinkSync(existingNm, path.join(projRoot, 'node_modules'), 'junction');
    }

    const epDir = path.join(projRoot, 'src', 'episodes', slug);
    const pubDir = path.join(projRoot, 'public', slug);
    const outDir = path.join(projRoot, 'out', slug);
    fs.mkdirSync(pubDir, { recursive: true });
    execFileSync(
      'ffmpeg',
      ['-y', '-v', 'error', '-f', 'lavfi', '-i', 'sine=frequency=240:duration=4.2', '-ar', '44100', '-ac', '1', path.join(pubDir, 'voice.wav')],
      { stdio: 'pipe' },
    );

    const words = [
      { w: 'Paul', p: '', s: 0.05, e: 0.35 },
      { w: 'arrache', p: '', s: 0.35, e: 0.8 },
      { w: 'le', p: '', s: 0.8, e: 1.0 },
      { w: 'ticket', p: '.', s: 1.0, e: 1.4 },
      { w: 'Le', p: '', s: 1.55, e: 1.75 },
      { w: 'vigile', p: '', s: 1.75, e: 2.15 },
      { w: 'tourne', p: '', s: 2.15, e: 2.45 },
      { w: 'la', p: '', s: 2.55, e: 2.75 },
      { w: 'tête', p: '.', s: 2.75, e: 3.15 },
      { w: 'Trop', p: '', s: 3.3, e: 3.6 },
      { w: 'tard', p: '.', s: 3.6, e: 3.95 },
    ];
    fs.writeFileSync(path.join(epDir, 'words.json'), JSON.stringify(words, null, 2));
    fs.writeFileSync(
      path.join(epDir, 'episode.json'),
      JSON.stringify(
        {
          id: 'RealOpen',
          slug,
          aspect: '9:16',
          lang: 'fr',
          defaultSet: 'office',
          opening: { type: 'objet', why: 'arrache le ticket', sentence: 'Paul arrache le ticket.' },
          script: [
            { beat: '1', text: 'Paul arrache le ticket.' },
            { beat: '2', text: 'Et si tu pouvais changer chaque prix ?' },
            { beat: '3', text: 'Le vigile tourne la tête de trois degrés par seconde.' },
            { beat: '4', text: 'Trop tard ?' },
          ],
          science: [{ claim: '3 degrés/s', working: '3 * 10 = 30 degrés', source: 'Optique 2020' }],
          shots: [
            { id: 'S1', size: 'insert', set: 'office', key: 18, note: 'Ticket arraché' },
            { id: 'S2', size: 'insert', set: 'office', key: 12, note: 'Badge vert du portique' },
            { id: 'S3', size: 'close', set: 'office', key: 12, note: 'Paul regarde le portique' },
            { id: 'S4', size: 'medium', set: 'office', key: 12, note: 'Le vigile avance' },
          ],
          edit: [
            { shot: 'S1', at: 'f:0' },
            { shot: 'S2', at: 'f:45' },
            { shot: 'S3', at: 'f:75' },
            { shot: 'S4', at: 'f:98' },
          ],
          fx: [],
        },
        null,
        2,
      ),
    );
    const baseTimeline = {
      slug,
      title: 'REAL OPEN',
      fps: 30,
      total: 120,
      segments: [
        { shot: 'S1', a: 0, b: 45, t0: 0, t1: 45, line: 'Paul arrache le ticket.' },
        { shot: 'S2', a: 45, b: 75, t0: 0, t1: 30, line: 'Le vigile tourne' },
        { shot: 'S3', a: 75, b: 98, t0: 0, t1: 23, line: 'la tête.' },
        { shot: 'S4', a: 98, b: 120, t0: 0, t1: 22, line: 'Trop tard.' },
      ],
      shots: [
        { id: 'S1', size: 'insert', key: 18, len: 45, first: 0 },
        { id: 'S2', size: 'insert', key: 12, len: 30, first: 45 },
        { id: 'S3', size: 'close', key: 12, len: 23, first: 75 },
        { id: 'S4', size: 'medium', key: 12, len: 22, first: 98 },
      ],
      fx: [],
      audio: { voice: `${slug}/voice.wav`, voiceVol: 1 },
    };
    fs.writeFileSync(path.join(epDir, 'timeline.json'), JSON.stringify(baseTimeline, null, 2));
    fs.writeFileSync(
      path.join(epDir, 'DIRECTOR.md'),
      '# Réalisation & Mise en Scène\n' +
        '1. Architecture : bureau et portique en profondeur (#1030E0, #E8D018, #E02020, #18C840) avec table centrale et arrière-plan.\n' +
        '2. Casting : Paul (adulte, veste sombre) et le vigile (adulte, uniforme).\n' +
        '3. Découpage : S1 insert sur le ticket qui change d’état entre f:0 et f:30, S2 insert sur le voyant vert à f:60, S3 réaction de Paul, S4 vigile.\n',
    );
    fs.writeFileSync(
      path.join(epDir, 'shared.tsx'),
      `import React from 'react';
import { cast, place } from '../../engine';
export const ROOM = place('office');
export const PAUL = cast({ seed: 'paul', body: 'adult', kind: 'masc', hair: 'short', outfit: ['blazer:navy', 'pants:black'] });
export const GUARD = cast({ seed: 'guard', body: 'adult', kind: 'masc', hair: 'buzz', outfit: ['shirt:cream', 'pants:navy'] });
`,
    );

    const s1CodeOriginal = `export const S1: React.FC<ShotProps> = ({ t }) => {
  const fill = t < 10 ? '#1030E0' : t < 25 ? '#E8D018' : '#E02020';
  return (
    <g>
      <rect x={510} y={-260} width={900} height={1600} fill="#181626" />
      <rect x={590} y={40} width={740} height={1000} rx={24} fill={fill} stroke="#F6EFE3" strokeWidth={12} />
      <line x1={630} y1={540} x2={1290} y2={540} stroke="#0B0816" strokeWidth={14} />
    </g>
  );
};`;
    await registry.run('edit_shot', { episode: slug, id: 'S1', code: s1CodeOriginal }, ctx);
    await registry.run(
      'edit_shot',
      {
        episode: slug,
        id: 'S2',
        code: `export const S2: React.FC<ShotProps> = ({ t }) => (
  <g>
    <rect x={510} y={-260} width={900} height={1600} fill="#14201C" />
    <rect x={590} y={40} width={740} height={1000} rx={24} fill="#18C840" stroke="#F6EFE3" strokeWidth={12} />
    <circle cx={960} cy={820 + (t > 8 ? 20 : 0)} r={60} fill="#0B0816" />
  </g>
);`,
      },
      ctx,
    );
    await registry.run(
      'edit_shot',
      {
        episode: slug,
        id: 'S3',
        code: `export const S3 = shot({
  place: ROOM,
  cam: 'close',
  view: '3/4-left',
  people: [{ who: PAUL, at: { u: 0.5, w: 0.55 }, yaw: 0.35, act: 'point', face: 'worried', beats: [{ at: 8, act: 'hands-head', face: 'shock' }] }],
});`,
      },
      ctx,
    );
    await registry.run(
      'edit_shot',
      {
        episode: slug,
        id: 'S4',
        code: `export const S4 = shot({
  place: ROOM,
  cam: 'deep',
  view: 'reverse',
  people: [
    { who: GUARD, at: { u: 0.38, w: 0.88 }, yaw: 0.4, act: 'point', face: 'angry', beats: [{ at: 8, act: 'stop', face: 'furious' }] },
    { who: PAUL, at: { u: 0.66, w: 0.45 }, yaw: -0.4, act: 'cover-mouth', face: 'scared' },
  ],
});`,
      },
      ctx,
    );

    const stillsRes = await registry.run('whatif_run', { episode: slug, step: 'stills' }, ctx);
    assert.equal(stillsRes.ok, true, stillsRes.summary);
    const boardRes = await registry.run('whatif_run', { episode: slug, step: 'board' }, ctx);
    assert.equal(boardRes.ok, true, boardRes.summary);

    // Proven fresh state: manifest.json & opening.json carry matching timelineSig + sourcesSig, verified === true
    const cleanStatus = readOpeningStatus(projRoot, slug, baseTimeline);
    assert.equal(cleanStatus.verified, true);
    assert.equal(cleanStatus.stale, false);
    assert.deepEqual(cleanStatus.exact, [0, 30, 60]);

    const mcpDeps = {
      db,
      bus: new Bus(),
      config: { ...loadConfig(), dataRoot: realDir, projectsDir: path.join(realDir, 'projects'), skillDir },
      registry,
    };

    // (i) Modify S1.tsx WITHOUT a new render, AND set misleading mtimes:
    //     - Backdate S1.tsx 60s into the past
    //     - Push opening/*.png, manifest.json, opening.json, opening.jpg 60s into the future!
    const s1Path = path.join(epDir, 'shots', 'S1.tsx');
    const origS1Raw = fs.readFileSync(s1Path, 'utf8');
    fs.writeFileSync(s1Path, origS1Raw.replace('#1030E0', '#FF8800'));
    const past = new Date(Date.now() - 60_000);
    const future = new Date(Date.now() + 60_000);
    fs.utimesSync(s1Path, past, past);
    for (const f of [
      path.join(outDir, 'opening', 'f0000.png'),
      path.join(outDir, 'opening', 'f0030.png'),
      path.join(outDir, 'opening', 'f0060.png'),
      path.join(outDir, 'opening', 'manifest.json'),
      path.join(outDir, 'sheets', 'opening.json'),
      path.join(outDir, 'sheets', 'opening.jpg'),
    ]) {
      fs.utimesSync(f, future, future);
    }

    // Even BEFORE re-running board_sheets.py (stale opening.json on disk + misleading future mtime!):
    const staleSrcStatus = readOpeningStatus(projRoot, slug, baseTimeline);
    assert.equal(staleSrcStatus.verified, false, 'modified source must invalidate opening verification regardless of mtime');
    assert.equal(staleSrcStatus.stale, true);
    assert.equal(staleSrcStatus.hasSheet, false, 'stale opening.jpg must not be exposed as current');
    assert.deepEqual(staleSrcStatus.exact, []);

    // Both reviewEpisodeBoard and MCP whatif_save_review({ pass: true }) MUST block validation when opening is stale!
    const blockedBoardRev = await reviewEpisodeBoard(
      {
        model: 'vision-real',
        label: 'vision-real',
        async chat() {
          return { text: '{"pass": true, "summary": "Tout semble bon.", "issues": []}', toolCalls: [] };
        },
      },
      projRoot,
      slug,
    );
    assert.equal(blockedBoardRev.pass, false, 'reviewEpisodeBoard must block pass:true when sources changed without re-rendering');
    assert.equal(blockedBoardRev.openingFrames?.verified, false);
    assert.equal(blockedBoardRev.openingFrames?.stale, true);

    const blockedMcpSave = await callMcpTool(mcpDeps, 'whatif_save_review', {
      episode: slug,
      pass: true,
      summary: 'Ouverture validée.',
      issues: [],
      mode: 'global',
      round: 5,
      maxRounds: 2,
    });
    assert.equal(blockedMcpSave.data.pass, false, 'MCP whatif_save_review must block pass:true on stale opening metadata');
    assert.equal(blockedMcpSave.data.blocking, true, 'stale opening must remain blocking even at round >= maxRounds');

    // Re-running board_sheets.py (still without re-rendering stills, with future mtime on f*.png!) also detects signature mismatch and removes opening.jpg!
    execFileSync('python3', [path.resolve('pipeline/board_sheets.py'), projRoot, slug], { stdio: 'pipe' });
    assert.equal(fs.existsSync(path.join(outDir, 'sheets', 'opening.jpg')), false, 'board_sheets.py must remove stale opening.jpg on source signature mismatch');
    const staleSheetMeta = JSON.parse(fs.readFileSync(path.join(outDir, 'sheets', 'opening.json'), 'utf8'));
    assert.equal(staleSheetMeta.verified, false);
    assert.deepEqual(staleSheetMeta.exactFrames, []);
    assert.deepEqual(staleSheetMeta.staleFrames, [0, 30, 60]);

    // Restore S1.tsx and rebuild board -> verified again!
    fs.writeFileSync(s1Path, origS1Raw);
    execFileSync('python3', [path.resolve('pipeline/board_sheets.py'), projRoot, slug], { stdio: 'pipe' });
    assert.equal(readOpeningStatus(projRoot, slug, baseTimeline).verified, true);

    // (ii) Modify timeline.json WITHOUT a new render + future mtime on opening artifacts -> must also be detected stale!
    const modifiedTl = { ...baseTimeline, segments: [{ ...baseTimeline.segments[0], b: 35 }, { ...baseTimeline.segments[1], a: 35 }] };
    fs.writeFileSync(path.join(epDir, 'timeline.json'), JSON.stringify(modifiedTl, null, 2));
    fs.utimesSync(path.join(epDir, 'timeline.json'), past, past);
    const staleTlStatus = readOpeningStatus(projRoot, slug, modifiedTl);
    assert.equal(staleTlStatus.verified, false, 'modified timeline.json must invalidate opening verification regardless of mtime');
    assert.equal(staleTlStatus.stale, true);

    // Restore timeline.json -> verified again
    fs.writeFileSync(path.join(epDir, 'timeline.json'), JSON.stringify(baseTimeline, null, 2));
    assert.equal(readOpeningStatus(projRoot, slug, baseTimeline).verified, true);

    // (iii) Delete an opening image (`f0030.png`) AFTER `opening.json` and `opening.jpg` were generated:
    //       stale `opening.json` still claims exactFrames=[0,30,60], readOpeningStatus & save_review must catch missing image!
    fs.unlinkSync(path.join(outDir, 'opening', 'f0030.png'));
    const missingImgStatus = readOpeningStatus(projRoot, slug, baseTimeline);
    assert.equal(missingImgStatus.verified, false, 'deleted f0030.png must invalidate opening.json');
    assert.equal(missingImgStatus.stale, true);
    assert.equal(missingImgStatus.hasSheet, false);
    assert.equal(missingImgStatus.reason, 'missing_or_corrupted_opening_image');

    const blockedMissingImg = await callMcpTool(mcpDeps, 'whatif_save_review', {
      episode: slug,
      pass: true,
      summary: 'Validé.',
      issues: [],
      mode: 'global',
    });
    assert.equal(blockedMissingImg.data.pass, false, 'missing opening image must block validation');
    assert.equal(blockedMissingImg.data.blocking, true);

    // (iv) CRITICAL: Mutation DURING `render_run.mjs` execution (NOT after!):
    //      First restore a clean verified render so `out/<slug>/opening/manifest.json` exists on disk,
    //      then spawn `render_run.mjs` and mutate `shots/S1.tsx` (and then `timeline.json`) LIVE while `render_run.mjs`
    //      is rendering stills (after bundling finished, before opening frames/manifest complete).
    //      `render_run.mjs` MUST detect `preBundleSigs !== postRenderSigs`, ERASE `manifest.json`, and exit non-zero (`ok: false`)!
    const cleanRerender = await registry.run('whatif_run', { episode: slug, step: 'stills' }, ctx);
    assert.equal(cleanRerender.ok, true, cleanRerender.summary);
    const cleanBoard2 = await registry.run('whatif_run', { episode: slug, step: 'board' }, ctx);
    assert.equal(cleanBoard2.ok, true, cleanBoard2.summary);
    const manifestPath = path.join(outDir, 'opening', 'manifest.json');
    assert.equal(fs.existsSync(manifestPath), true, 'precondition: manifest.json exists before mid-render mutation test');
    assert.equal(readOpeningStatus(projRoot, slug, baseTimeline).verified, true);

    const runRenderMutatingMidFlight = (mutateFn) =>
      new Promise((resolve) => {
        const child = spawn(
          'node',
          [path.resolve('pipeline/render_run.mjs'), '--mode', 'stills', '--slug', slug, '--scale', '0.5'],
          { cwd: projRoot, stdio: ['ignore', 'pipe', 'pipe'] },
        );
        let stdout = '';
        let stderr = '';
        let lineBuf = '';
        let mutatedDuringRender = false;
        let resultAfterMutation = false;

        child.stdout.on('data', (chunk) => {
          const text = chunk.toString('utf8');
          stdout += text;
          lineBuf += text;
          let nl;
          while ((nl = lineBuf.indexOf('\n')) >= 0) {
            const line = lineBuf.slice(0, nl).trim();
            lineBuf = lineBuf.slice(nl + 1);
            if (!mutatedDuringRender && line.startsWith('PROGRESS_JSON:')) {
              const prog = JSON.parse(line.slice('PROGRESS_JSON:'.length));
              // Mutate right after bundling finishes / first still starts rendering — strictly DURING the active render!
              if (prog.stage === 'stills' && prog.done >= 1) {
                mutateFn();
                mutatedDuringRender = true;
              }
            } else if (mutatedDuringRender && line.startsWith('RESULT_JSON:')) {
              resultAfterMutation = true;
            }
          }
        });
        child.stderr.on('data', (chunk) => {
          stderr += chunk.toString('utf8');
        });
        child.on('close', (code) => {
          const resLine = stdout
            .split('\n')
            .map((l) => l.trim())
            .filter((l) => l.startsWith('RESULT_JSON:'))
            .pop();
          const payload = resLine ? JSON.parse(resLine.slice('RESULT_JSON:'.length)) : null;
          resolve({ code, stdout, stderr, payload, mutatedDuringRender, resultAfterMutation });
        });
      });

    // Mid-render mutation #1: mutate `shots/S1.tsx` while stills are actively rendering
    const midSrcRun = await runRenderMutatingMidFlight(() => {
      fs.writeFileSync(s1Path, origS1Raw.replace('#1030E0', '#00CCAA'));
    });
    assert.equal(midSrcRun.mutatedDuringRender, true, 'mutation must occur while render_run.mjs is actively rendering');
    assert.equal(midSrcRun.resultAfterMutation, true, 'RESULT_JSON must be emitted after mid-render mutation');
    assert.equal(midSrcRun.code, 1, 'render_run.mjs must exit with code 1 when sources mutate during render');
    assert.equal(midSrcRun.payload?.ok, false);
    assert.equal(midSrcRun.payload?.reason, 'inputs_mutated_during_render');
    assert.equal(fs.existsSync(manifestPath), false, 'manifest.json MUST be erased/refused when sources mutated during render');
    const afterMidSrcStatus = readOpeningStatus(projRoot, slug, baseTimeline);
    assert.equal(afterMidSrcStatus.verified, false, 'old bundled images must NEVER remain verified against mutated S1.tsx');

    // Restore S1.tsx, run clean render to recreate valid manifest.json, then test mid-render mutation #2 (`timeline.json`)
    fs.writeFileSync(s1Path, origS1Raw);
    assert.equal((await registry.run('whatif_run', { episode: slug, step: 'stills' }, ctx)).ok, true);
    assert.equal(fs.existsSync(manifestPath), true);

    const midTlRun = await runRenderMutatingMidFlight(() => {
      fs.writeFileSync(path.join(epDir, 'timeline.json'), JSON.stringify(modifiedTl, null, 2));
    });
    assert.equal(midTlRun.mutatedDuringRender, true);
    assert.equal(midTlRun.resultAfterMutation, true);
    assert.equal(midTlRun.code, 1, 'render_run.mjs must exit with code 1 when timeline.json mutates during render');
    assert.equal(midTlRun.payload?.ok, false);
    assert.equal(midTlRun.payload?.reason, 'inputs_mutated_during_render');
    assert.equal(fs.existsSync(manifestPath), false, 'manifest.json MUST be erased/refused when timeline.json mutated during render');
    assert.equal(readOpeningStatus(projRoot, slug, modifiedTl).verified, false);
  } finally {
    db.close();
    if (prevRenderEnv === undefined) delete process.env.WHATIF_RENDER;
    else process.env.WHATIF_RENDER = prevRenderEnv;
    fs.rmSync(realDir, { recursive: true, force: true });
  }
});
