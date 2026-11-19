import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

/**
 * The narration is read, corrected when it can be, read again by the Reviewer, and dropped when it cannot be saved,
 * BEFORE any voice credit or render is spent (Pulsy, 2026-11-19).
 *
 * Why: on 29 published videos, a first sentence that is a precise act kept 75.8 % of the viewers against 61.7 % for an
 * explanation, and the episodes that end on their payoff and can be followed by ear were watched 7 points above what
 * their length predicts, the others 13 points below. Until now the studio took the :8005 proposal as it came.
 *
 * This file holds what needs no model: the bounds of a correction, the honesty of the reading card, the state of the
 * episode's text. The judgment on the story is the agent's (the card) and the Reviewer's (`reviewScript`).
 */

export const SCRIPT_LIMITS = {
  /** a correction keeps the story: no less than 75 % of the original words (the bound `episodeAudit` already had)... */
  minRatio: 0.75,
  /** ...and no more than 110 %: it does not pad */
  maxRatio: 1.1,
  /** 98 % of the 1 082 tags of the real proposals have five words or fewer; a longer bracket is a sentence the voice skips */
  maxTagWords: 8,
  /** not refused, only reported to the Reviewer: the two best videos of the channel have sentences of 23 to 31 words */
  longSentenceWords: 35,
  /** refused twice by the Reviewer: the story is dropped */
  maxRounds: 2,
  /** the Reviewer did not answer twice (breakdown, timeout): the text goes on with the agent's reading only */
  maxReviewFailures: 2,
} as const;

export type ScriptVerdict = 'good' | 'fix' | 'discard';

export type ScriptCard = {
  verdict?: ScriptVerdict;
  opening?: { sentence?: string };
  payoff?: { sentence?: string };
  defects?: { rule?: number | string; quote?: string; where?: string; fix?: string }[];
  changes?: { before?: string; after?: string; rule?: number | string }[];
  removed?: string[];
  reason?: string;
};

export type ScriptStatus = 'review' | 'approved' | 'kept' | 'discarded' | 'blocked';

export type ScriptState = {
  sig: string;
  /** unique token (<scriptSig>:<nonce>) of the exact dossier written into out/<slug>/script-pack.md for the pending review */
  submittedSig?: string;
  /** script signature for which reviewFailures were counted (never carried across script versions V1 -> V2) */
  reviewFailureSig?: string;
  status: ScriptStatus;
  verdict?: ScriptVerdict;
  errors: string[];
  notes: string[];
  /** rounds the Reviewer refused, across every version of the text */
  refused: number;
  /** times the Reviewer gave no verdict at all on the current script version */
  reviewFailures: number;
  /** 'ok': read and accepted; 'skipped': not read (no Reviewer, or it broke down twice) */
  reviewer?: 'ok' | 'skipped';
  keptReason?: string;
  discardReason?: string;
  words?: { original: number; current: number };
  at: string;
};

export type ScriptReviewVerdict = {
  pass: boolean;
  sameStory?: boolean;
  /** mandatory Submitted-Sig token of the exact dossier read from out/<slug>/script-pack.md */
  sig: string;
  issues?: { rule?: string; quote?: string; problem?: string; fix?: string }[];
  model?: string;
};

const squash = (s: string): string => s.replace(/\s+/g, ' ').trim();

/** The text the voice says: acting tags and markup removed. */
export const stripTags = (text: string): string => squash(String(text ?? '').replace(/\[[^\]]*\]|<[^>]+>/g, ' '));

export const scriptTags = (text: string): string[] => [...String(text ?? '').matchAll(/\[([^\]]*)\]/g)].map((m) => squash(m[1] ?? ''));

export const flatScript = (episode: any): string =>
  squash((Array.isArray(episode?.script) ? episode.script : []).map((b: any) => String(b?.text ?? '')).join(' '));

export const scriptWordCount = (text: string): number => stripTags(text).split(' ').filter(Boolean).length;

export function scriptSentences(text: string): string[] {
  return stripTags(text)
    .split(/(?<=[.!?…])\s+/)
    .map((s) => s.trim())
    .filter((s) => /[\p{L}\p{N}]/u.test(s));
}

/** Tags are part of what is voiced: a text whose tags change is another text. */
export const scriptSig = (text: string): string => crypto.createHash('sha1').update(squash(String(text ?? ''))).digest('hex').slice(0, 12);

const NUMBER_WORDS = new Set(
  (
    'deux trois quatre cinq six sept huit neuf dix onze douze treize quatorze quinze seize vingt vingts trente quarante cinquante soixante cent cents mille million millions milliard milliards ' +
    'two three four five six seven eight nine ten eleven twelve thirteen fourteen fifteen sixteen seventeen eighteen nineteen twenty thirty forty fifty sixty seventy eighty ninety hundred thousand billion'
  ).split(' '),
);

const lower = (s: string): string => s.toLocaleLowerCase('fr');

/**
 * What a correction may not lose silently: the names and the numbers. A name is a capitalised word seen at least once
 * away from the start of a sentence (so "Mais", "Alors" at the head of a sentence are not names).
 */
export function keyFacts(text: string): { names: string[]; numbers: string[] } {
  const names = new Set<string>();
  const numbers = new Set<string>();
  for (const sentence of scriptSentences(text)) {
    const words = sentence.split(/\s+/).filter(Boolean);
    words.forEach((raw, i) => {
      const w = raw.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, '');
      if (!w) return;
      if (/^\d/.test(w)) numbers.add(w);
      for (const part of lower(w).split('-')) if (NUMBER_WORDS.has(part)) numbers.add(part);
      const bare = w.replace(/^(?:[ldjnmtsc]|qu)['’]/i, '');
      // the word before ends a clause or opens a quote: this capital is a sentence start inside the sentence, not a name
      const prev = words[i - 1] ?? '';
      const starts = i === 0 || /[.!?…:«»"“”(]$/.test(prev) || /^[«"“(]/.test(raw);
      if (!starts && /^\p{Lu}[\p{Ll}'’-]{2,}$/u.test(bare)) names.add(bare);
    });
  }
  // "Mais", "Elle", "Maman" also written without a capital somewhere in the text are words, not names
  const spoken = stripTags(text);
  return { names: [...names].filter((n) => !new RegExp(`(?<![\\p{L}\\p{N}])${lower(n)}(?![\\p{L}\\p{N}])`, 'u').test(spoken)), numbers: [...numbers] };
}

const hasWord = (haystack: string, word: string): boolean =>
  new RegExp(`(?<![\\p{L}\\p{N}])${word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?![\\p{L}\\p{N}])`, 'iu').test(haystack);

const includesLoose = (haystack: string, needle: string): boolean => {
  const spoken = stripTags(needle);
  return spoken ? lower(stripTags(haystack)).includes(lower(spoken)) : squash(haystack).includes(squash(needle));
};

/**
 * The bounds of a correction and the honesty of the card. No judgment on the story here.
 * `errors` refuse the text; `notes` go to the Reviewer.
 */
export function scriptCheckErrors(original: string, current: string, card: ScriptCard | null | undefined): { errors: string[]; notes: string[] } {
  const errors: string[] = [];
  const notes: string[] = [];
  const verdict = card?.verdict;
  if (!card || (verdict !== 'good' && verdict !== 'fix' && verdict !== 'discard')) {
    return { errors: ['the reading card is missing or has no verdict ("good", "fix" or "discard")'], notes };
  }
  if (verdict === 'discard') {
    if (!squash(String(card.reason ?? ''))) errors.push('verdict "discard" needs a "reason": what the story lacks (no payoff, no conflict, cannot be followed without the original pictures)');
    return { errors, notes };
  }

  const opening = squash(String(card.opening?.sentence ?? ''));
  const payoff = squash(String(card.payoff?.sentence ?? ''));
  if (!opening) errors.push('the card must quote the opening sentence ("opening.sentence")');
  else if (!includesLoose(current, opening)) errors.push(`the opening sentence quoted in the card is not in the script: "${opening.slice(0, 90)}"`);
  if (!payoff) errors.push('the card must quote the payoff sentence ("payoff.sentence"); a story with no payoff is a "discard"');
  else if (!includesLoose(current, payoff)) errors.push(`the payoff sentence quoted in the card is not in the script: "${payoff.slice(0, 90)}"`);

  const same = squash(current) === squash(original);
  const changes = Array.isArray(card.changes) ? card.changes : [];
  if (verdict === 'good' && !same) {
    errors.push('verdict "good" on a script that differs from the original: a changed text, tags included, is a "fix" with its list of "changes"');
  }
  if (verdict === 'fix') {
    if (same) errors.push('verdict "fix" but the script is still the original: apply the corrections to episode.json.script, or say "good"');
    if (!changes.length) errors.push('verdict "fix" needs the list of "changes" ({ before, after, rule })');
    changes.forEach((c, i) => {
      const before = squash(String(c?.before ?? ''));
      const after = squash(String(c?.after ?? ''));
      if (!before && !after) errors.push(`change ${i + 1} is empty`);
      if (before && !includesLoose(original, before)) errors.push(`change ${i + 1}: its "before" is not in the original text: "${before.slice(0, 80)}"`);
      if (after && !includesLoose(current, after)) errors.push(`change ${i + 1}: its "after" is not in the script, the change was declared and not made: "${after.slice(0, 80)}"`);
    });

    const ow = scriptWordCount(original);
    const cw = scriptWordCount(current);
    if (ow >= 40 && cw < Math.floor(ow * SCRIPT_LIMITS.minRatio)) {
      errors.push(`the corrected script has ${cw} words for ${ow} in the original: a correction keeps at least ${Math.round(SCRIPT_LIMITS.minRatio * 100)} % of the story`);
    }
    if (ow >= 40 && cw > Math.ceil(ow * SCRIPT_LIMITS.maxRatio)) {
      errors.push(`the corrected script has ${cw} words for ${ow} in the original: a correction does not pad (${Math.round(SCRIPT_LIMITS.maxRatio * 100)} % at most)`);
    }

    const removed = (Array.isArray(card.removed) ? card.removed : []).map((r) => lower(String(r)));
    const excused = (fact: string): boolean => removed.some((r) => hasWord(r, fact));
    const facts = keyFacts(original);
    const spoken = stripTags(current);
    const lostNames = facts.names.filter((n) => !hasWord(spoken, n) && !excused(n));
    const lostNumbers = facts.numbers.filter((n) => !hasWord(spoken, n) && !excused(n));
    if (lostNames.length) errors.push(`name(s) of the original no longer in the script and not declared in "removed": ${lostNames.join(', ')}`);
    if (lostNumbers.length) errors.push(`number(s) of the original no longer in the script and not declared in "removed": ${lostNumbers.join(', ')}`);
  }

  for (const tag of scriptTags(current)) {
    if (!tag) errors.push('an empty [] tag');
    else if (tag.split(' ').length > SCRIPT_LIMITS.maxTagWords) errors.push(`tag too long, the voice would skip a whole sentence: [${tag.slice(0, 70)}]`);
    else if (/[^\x20-\x7e]/.test(tag)) errors.push(`acting tags are short English cues, this one is not: [${tag}]`);
  }

  for (const s of scriptSentences(current)) {
    const n = s.split(' ').length;
    if (n > SCRIPT_LIMITS.longSentenceWords) notes.push(`a sentence of ${n} words, hard to say in one breath: "${s.slice(0, 80)}…"`);
  }
  return { errors, notes };
}

// ---------------------------------------------------------------- state on disk

const outDir = (projectRoot: string, slug: string): string => path.join(projectRoot, 'out', slug);
const readJson = (file: string): any => {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return null;
  }
};
const writeJson = (file: string, value: unknown): void => {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(value, null, 2) + '\n');
};

export const scriptFiles = (projectRoot: string, slug: string) => {
  const dir = outDir(projectRoot, slug);
  return {
    original: path.join(dir, 'script.orig.md'),
    source: path.join(dir, 'source.fr.md'),
    card: path.join(dir, 'script-card.json'),
    state: path.join(dir, 'script-check.json'),
    review: path.join(dir, 'script-review.json'),
    approved: path.join(dir, 'source.fit.md'),
    pack: path.join(dir, 'script-pack.md'),
  };
};

export const readScriptState = (projectRoot: string, slug: string): ScriptState | null => readJson(scriptFiles(projectRoot, slug).state);

function readEpisode(projectRoot: string, slug: string): any {
  return readJson(path.join(projectRoot, 'src', 'episodes', slug, 'episode.json'));
}

/** The original text, frozen the first time the step runs: the :8005 proposal when there is one, else the script as it was. */
export function scriptOriginal(projectRoot: string, slug: string, current: string): string {
  const f = scriptFiles(projectRoot, slug);
  if (fs.existsSync(f.original)) return squash(fs.readFileSync(f.original, 'utf8'));
  const text = fs.existsSync(f.source) ? squash(fs.readFileSync(f.source, 'utf8')) : current;
  fs.mkdirSync(path.dirname(f.original), { recursive: true });
  fs.writeFileSync(f.original, text + '\n');
  return text;
}

const save = (projectRoot: string, slug: string, state: ScriptState): ScriptState => {
  const f = scriptFiles(projectRoot, slug);
  if (state.status !== 'approved' && state.status !== 'kept') {
    fs.rmSync(f.approved, { force: true });
  }
  writeJson(f.state, state);
  return state;
};

const approve = (projectRoot: string, slug: string, state: ScriptState, current: string): ScriptState => {
  fs.writeFileSync(scriptFiles(projectRoot, slug).approved, current + '\n');
  return save(projectRoot, slug, state);
};

/**
 * True only when `state` is an active, non-superseded approval for `sig` whose submission token (`submittedSig`)
 * matches the current active dossier and (when Reviewer-approved) the exact verdict recorded in `script-review.json`.
 */
function hasActiveSubmissionApproval(state: ScriptState | null, review: any, sig: string): boolean {
  if (!state || state.sig !== sig) return false;
  if (state.status === 'kept') return true;
  if (state.status !== 'approved') return false;
  const activeToken = typeof state.submittedSig === 'string' && state.submittedSig.trim() ? state.submittedSig.trim() : null;
  if (!activeToken || submissionContentSig(activeToken) !== sig) return false;
  if (state.reviewer === 'skipped') return true;
  return Boolean(
    review &&
      review.sig === sig &&
      typeof review.submittedSig === 'string' &&
      review.submittedSig.trim() === activeToken &&
      review.pass === true &&
      review.sameStory === true &&
      !review.incomplete,
  );
}

export const SCRIPT_CONTRACT = [
  '1. The first sentence is a precise, abnormal ACT by a person, something one can draw. Not a rule of the world, a setting, a date or a moral.',
  '2. What the person risks appears within the first three sentences.',
  '3. One sentence, one fact that can be shown.',
  '4. The listener always knows who speaks: a line of dialogue sits next to a gesture or a name. No telegraphic style.',
  '5. The payoff comes within the last four sentences. After it: a gesture or a consequence. Never a moral, an explanation of what was just shown, or the opening sentence glued back on.',
  '6. Acting tags ([tense], [whispering]…) match what is said: no slow tag on the payoff.',
].join('\n');

export const SCRIPT_CARD_SHAPE =
  '{ "verdict": "good" | "fix" | "discard", "opening": { "sentence": "<the first sentence, quoted>" }, "payoff": { "sentence": "<the payoff, quoted>" }, ' +
  '"defects": [{ "rule": 1, "quote": "<sentence>", "where": "<where to correct>", "fix": "<how>" }], ' +
  '"changes": [{ "before": "<text of the original>", "after": "<text now in the script>", "rule": 1 }], "removed": ["<name or number dropped on purpose>"], "reason": "<for discard only>" }';

/** Unique submission token binding both the exact script hash and this specific review dossier submission. */
export const newSubmissionSig = (contentSig: string): string => `${contentSig}:${crypto.randomBytes(6).toString('hex')}`;

export const submissionContentSig = (tokenOrSig: string): string => String(tokenOrSig ?? '').trim().split(':')[0] ?? '';

/** What the Reviewer (a model, or a sub-agent over MCP) reads. */
export function scriptPack(
  original: string,
  current: string,
  card: ScriptCard | null,
  notes: string[],
  submittedSig = newSubmissionSig(scriptSig(current)),
): string {
  return [
    '# Script to review before the voice',
    '',
    `Submitted-Sig: ${submittedSig}`,
    '',
    '## Contract',
    SCRIPT_CONTRACT,
    '',
    '## Original text',
    original,
    '',
    '## Script proposed for the voice',
    current,
    '',
    '## Reading card of the author of the corrections',
    JSON.stringify(card ?? {}, null, 2),
    ...(notes.length ? ['', '## Measured', ...notes.map((n) => `- ${n}`)] : []),
    '',
  ].join('\n');
}

/** Extract and verify the mandatory `Submitted-Sig` token against the proposed script embedded in `script-pack.md` (fail-closed if missing or mismatched). */
export function packSubmittedSig(packText: string): string | null {
  const startMarker = '## Script proposed for the voice\n';
  const endMarker = '\n\n## Reading card of the author of the corrections';
  const a = packText.indexOf(startMarker);
  const b = a >= 0 ? packText.indexOf(endMarker, a + startMarker.length) : -1;
  if (a < 0 || b < 0) return null;
  const proposed = packText.slice(a + startMarker.length, b);
  const computed = scriptSig(proposed);
  const headerMatches = [...packText.matchAll(/^Submitted-Sig:\s*(\S+)\s*$/gm)];
  if (headerMatches.length !== 1) return null;
  const token = headerMatches[0]![1]!;
  if (!/^[0-9a-f]{12}(?::[0-9a-f]{8,32})?$/.test(token)) return null;
  if (submissionContentSig(token) !== computed) return null;
  return token;
}

export type ScriptStepResult = { ok: boolean; summary: string; state: ScriptState | null; needsReview: boolean };

const cardHelp = (slug: string): string =>
  `Read the script against the contract, then write out/${slug}/script-card.json:\n${SCRIPT_CARD_SHAPE}\n\nContract:\n${SCRIPT_CONTRACT}\n\n` +
  `"good": the text respects the contract, leave it untouched. "fix": correct episode.json.script wherever needed (any part of the text, acting tags included) ` +
  `without inventing a fact, changing the payoff, the narrator or the language, and list every change. "discard": the story has no payoff or cannot be saved. ` +
  `Then run whatif_run { step: "script" } again.`;

/**
 * The `script` step. Mechanical bounds first; then the Reviewer's verdict on this exact text decides.
 * `--keep "<reason>"` is the user's override: the text goes to the voice as it is.
 */
export function runScriptStep(projectRoot: string, slug: string, args: string[] = []): ScriptStepResult {
  const episode = readEpisode(projectRoot, slug);
  if (!episode) return { ok: false, summary: `no readable src/episodes/${slug}/episode.json`, state: null, needsReview: false };
  const current = flatScript(episode);
  if (!current) return { ok: false, summary: 'episode.json has no script yet: import it (step "source") or write it first', state: null, needsReview: false };
  const f = scriptFiles(projectRoot, slug);
  const original = scriptOriginal(projectRoot, slug, current);
  const sig = scriptSig(current);
  const prev = readScriptState(projectRoot, slug);
  const sameFailureScript = Boolean(prev && prev.sig === sig && prev.reviewFailureSig === sig);
  const reviewFailures = sameFailureScript ? (prev?.reviewFailures ?? 0) : 0;
  const base: Pick<ScriptState, 'sig' | 'refused' | 'reviewFailures' | 'reviewFailureSig' | 'at'> = {
    sig,
    refused: prev?.refused ?? 0,
    reviewFailures,
    ...(reviewFailures > 0 ? { reviewFailureSig: sig } : {}),
    at: new Date().toISOString(),
  };
  const words = { original: scriptWordCount(original), current: scriptWordCount(current) };

  const keepAt = args.indexOf('--keep');
  if (keepAt >= 0) {
    const reason = squash(args[keepAt + 1] ?? '') || 'kept by the user';
    const state = approve(projectRoot, slug, { ...base, status: 'kept', errors: [], notes: [], keptReason: reason, words }, current);
    return { ok: true, summary: `script kept as it is by the user (${reason}): the voice can run.`, state, needsReview: false };
  }

  const card: ScriptCard | null = readJson(f.card);
  if (!card) {
    const state = save(projectRoot, slug, { ...base, status: 'blocked', errors: ['no reading card yet'], notes: [], words });
    return { ok: false, summary: `The original text is frozen in out/${slug}/script.orig.md (${words.original} words). ${cardHelp(slug)}`, state, needsReview: false };
  }

  const { errors, notes } = scriptCheckErrors(original, current, card);
  if (errors.length) {
    const state = save(projectRoot, slug, { ...base, status: 'blocked', verdict: card.verdict, errors, notes, words });
    return {
      ok: false,
      summary: `script check: ${errors.length} problem(s) to correct before the Reviewer reads the text:\n${errors.map((e) => `- ${e}`).join('\n')}`,
      state,
      needsReview: false,
    };
  }

  if (card.verdict === 'discard') {
    const reason = squash(String(card.reason ?? ''));
    const state = save(projectRoot, slug, { ...base, status: 'discarded', verdict: 'discard', errors: [], notes, discardReason: reason, words });
    return {
      ok: false,
      summary:
        `STORY DISCARDED before the voice (no credit, no render spent): ${reason}\n` +
        `Tell the user; do not run "voice". Only the user can keep it anyway: whatif_run { step: "script", args: ["--keep", "<reason>"] }.`,
      state,
      needsReview: false,
    };
  }

  if (prev?.status === 'discarded' && prev.refused >= SCRIPT_LIMITS.maxRounds) {
    return {
      ok: false,
      summary: `STORY DISCARDED: the Reviewer refused the script ${prev.refused} times (${prev.discardReason ?? 'see out/' + slug + '/script-review.json'}). Only the user can keep it: args ["--keep", "<reason>"].`,
      state: prev,
      needsReview: false,
    };
  }

  const review = readJson(f.review);
  // Active approval MUST belong to the current non-superseded submission token (`prev.submittedSig` === `review.submittedSig`);
  // a historical `script-review.json` from V1 never auto-approves V1 again after V1 -> V2 -> return to V1.
  if (hasActiveSubmissionApproval(prev, review, sig)) {
    return { ok: true, summary: `script already ${prev!.status}: the voice can run.`, state: prev, needsReview: false };
  }
  const activePendingSig =
    prev && prev.sig === sig && typeof prev.submittedSig === 'string' && prev.submittedSig.trim() && submissionContentSig(prev.submittedSig) === sig
      ? prev.submittedSig.trim()
      : null;
  if (base.reviewFailures >= SCRIPT_LIMITS.maxReviewFailures && activePendingSig) {
    const state = approve(
      projectRoot,
      slug,
      { ...base, submittedSig: activePendingSig, status: 'approved', verdict: card.verdict, errors: [], notes, reviewer: 'skipped', words },
      current,
    );
    return {
      ok: true,
      summary: `script approved WITHOUT the Reviewer: it gave no verdict ${base.reviewFailures} times on this exact script. Only the agent's reading stands; this is written in out/${slug}/script-check.json. The voice can run.`,
      state,
      needsReview: false,
    };
  }

  const again = Boolean(
    activePendingSig &&
      review &&
      review.sig === sig &&
      typeof review.submittedSig === 'string' &&
      review.submittedSig.trim() === activePendingSig &&
      review.pass === false &&
      !review.incomplete,
  );
  if (again) {
    const state = save(projectRoot, slug, {
      ...base,
      submittedSig: activePendingSig!,
      status: 'blocked',
      verdict: card.verdict,
      errors: ['refused by the Reviewer on this exact text'],
      notes,
      words,
    });
    return {
      ok: false,
      summary: `script check passed, but the Reviewer refused this exact text: correct it (see out/${slug}/script-review.json) and run the step again.`,
      state,
      needsReview: false,
    };
  }

  const submittedSig = newSubmissionSig(sig);
  fs.writeFileSync(f.pack, scriptPack(original, current, card, notes, submittedSig));
  const state = save(projectRoot, slug, { ...base, submittedSig, status: 'review', verdict: card.verdict, errors: [], notes, words });
  return {
    ok: true,
    summary: `script check passed (${card.verdict}, ${words.current} words for ${words.original}). The Reviewer now reads out/${slug}/script-pack.md (Submitted-Sig: ${submittedSig}); the voice stays closed until it accepts.`,
    state,
    needsReview: true,
  };
}

/** The Reviewer's verdict on the submitted dossier. Accepted (with explicit sameStory: true and matching mandatory sig): approved at once. Refused twice: dropped. */
export function recordScriptReview(projectRoot: string, slug: string, verdict: ScriptReviewVerdict): { state: ScriptState; summary: string } {
  const episode = readEpisode(projectRoot, slug);
  const current = flatScript(episode);
  const currentSig = scriptSig(current);
  const f = scriptFiles(projectRoot, slug);
  const prev = readScriptState(projectRoot, slug);
  const issues = (Array.isArray(verdict.issues) ? verdict.issues : [])
    .filter((i) => i && squash(String(i.problem ?? '')))
    .slice(0, 8)
    .map((i) => ({ rule: String(i.rule ?? ''), quote: String(i.quote ?? ''), problem: String(i.problem ?? ''), fix: String(i.fix ?? '') }));

  if (!prev || prev.status !== 'review') {
    const state =
      prev ??
      save(projectRoot, slug, {
        sig: currentSig,
        status: 'blocked',
        errors: ['no script review is pending'],
        notes: [],
        refused: 0,
        reviewFailures: 0,
        at: new Date().toISOString(),
      });
    return {
      state,
      summary: `[REVIEWER — TEXTE] Non validé : aucun dossier en attente de relecture (état : ${prev?.status ?? 'none'}). Lance whatif_run { step: "script" } d'abord.`,
    };
  }

  let packSig: string | null = null;
  try {
    if (fs.existsSync(f.pack)) packSig = packSubmittedSig(fs.readFileSync(f.pack, 'utf8'));
  } catch {
    packSig = null;
  }
  const stateSubmittedSig = typeof prev.submittedSig === 'string' && prev.submittedSig.trim() ? prev.submittedSig.trim() : null;
  const verdictSig = typeof verdict.sig === 'string' && verdict.sig.trim() ? verdict.sig.trim() : null;

  // 1. Verify active dossier integrity on disk (script-pack.md <-> script-check.json <-> episode.json)
  if (
    !stateSubmittedSig ||
    !packSig ||
    packSig !== stateSubmittedSig ||
    submissionContentSig(packSig) !== currentSig ||
    prev.sig !== currentSig
  ) {
    const why =
      !stateSubmittedSig || !packSig || packSig !== stateSubmittedSig
        ? `dossier script-pack.md absent, sans Submitted-Sig valide, ou incohérent avec l'état soumis (${packSig ?? 'manquant'} vs ${stateSubmittedSig ?? 'manquant'})`
        : `le script a été modifié pendant la relecture (soumis ${submissionContentSig(packSig)}, actuel ${currentSig})`;
    const sameFailureScript = prev.reviewFailureSig === currentSig;
    const state = save(projectRoot, slug, {
      sig: currentSig,
      verdict: prev.verdict,
      status: 'blocked',
      errors: [`${why} — relance whatif_run { step: "script" } pour soumettre la version actuelle`],
      notes: prev.notes ?? [],
      refused: prev.refused ?? 0,
      reviewFailures: sameFailureScript ? (prev.reviewFailures ?? 0) : 0,
      ...(sameFailureScript && (prev.reviewFailures ?? 0) > 0 ? { reviewFailureSig: currentSig } : {}),
      words: prev.words,
      at: new Date().toISOString(),
    });
    return {
      state,
      summary: `[REVIEWER — TEXTE] Non validé : ${why}. Relance whatif_run { step: "script" } pour soumettre et faire relire le texte actuel.`,
    };
  }

  // 2. Fail-closed on missing or mismatched submission token: never approve V2, never count a refusal/failure on V2, and never clobber V2's pending review
  if (!verdictSig) {
    return {
      state: prev,
      summary: `[REVIEWER — TEXTE] Non validé : jeton/signature obligatoire "sig" (Submitted-Sig du dossier out/${slug}/script-pack.md) manquant.`,
    };
  }
  if (verdictSig !== packSig) {
    return {
      state: prev,
      summary: `[REVIEWER — TEXTE] Non validé : verdict associé au jeton ${verdictSig} rejeté car le dossier actif est ${packSig}.`,
    };
  }

  // 3. Require an explicit boolean fidelity verdict (`sameStory`) on EVERY verdict (including `pass: false`):
  //    an incomplete verdict (`pass: false` or `pass: true` without boolean `sameStory`) never approves and never counts as a complete refusal or burns attempts.
  if (typeof verdict.sameStory !== 'boolean') {
    writeJson(f.review, {
      sig: currentSig,
      submittedSig: packSig,
      pass: false,
      sameStory: null,
      incomplete: true,
      issues,
      round: prev.refused ?? 0,
      model: verdict.model ?? null,
      createdAt: new Date().toISOString(),
    });
    const state = save(projectRoot, slug, {
      ...prev,
      sig: currentSig,
      submittedSig: packSig,
      status: 'review',
      errors: ['missing explicit boolean sameStory fidelity verdict'],
      at: new Date().toISOString(),
    });
    return {
      state,
      summary:
        `[REVIEWER — TEXTE] Non validé (verdict incomplet) : le verdict de fidélité "sameStory" (true ou false) est obligatoire même lorsque "pass" vaut false, et ne compte pas comme refus complet. ` +
        `Rends un verdict complet incluant "sameStory": true | false et "sig": "${packSig}".`,
    };
  }

  const sameStory = verdict.sameStory;
  const pass = verdict.pass === true && sameStory === true;
  const refused = (prev.refused ?? 0) + (pass ? 0 : 1);
  writeJson(f.review, {
    sig: currentSig,
    submittedSig: packSig,
    pass,
    sameStory,
    issues,
    round: (prev.refused ?? 0) + 1,
    model: verdict.model ?? null,
    createdAt: new Date().toISOString(),
  });
  const sameFailureScript = prev.reviewFailureSig === currentSig;
  const failureCount = sameFailureScript ? (prev.reviewFailures ?? 0) : 0;
  const base: Omit<ScriptState, 'status'> = {
    sig: currentSig,
    submittedSig: packSig,
    verdict: prev.verdict,
    errors: [],
    notes: prev.notes ?? [],
    refused,
    reviewFailures: failureCount,
    ...(failureCount > 0 ? { reviewFailureSig: currentSig } : {}),
    words: prev.words,
    at: new Date().toISOString(),
  };
  const list = issues.map((i) => `- [${i.rule || 'contract'}] ${i.problem}${i.quote ? ` — "${i.quote.slice(0, 90)}"` : ''}${i.fix ? `\n  → ${i.fix}` : ''}`).join('\n');
  if (pass) {
    const state = approve(projectRoot, slug, { ...base, status: 'approved', reviewer: 'ok' }, current);
    return { state, summary: `[REVIEWER — TEXTE] Accepté : même histoire, contrat respecté. out/${slug}/source.fit.md est écrit, la voix peut être générée.` };
  }
  if (refused >= SCRIPT_LIMITS.maxRounds) {
    const reason = issues.map((i) => i.problem).join(' ; ').slice(0, 400) || 'refused by the Reviewer';
    const state = save(projectRoot, slug, { ...base, status: 'discarded', discardReason: reason });
    return {
      state,
      summary:
        `[REVIEWER — TEXTE] Refusé pour la ${refused}e fois : l'histoire est ÉCARTÉE avant la voix.\n${list}\n` +
        `Dis-le à l'utilisateur et ne lance pas "voice". Lui seul peut la garder : whatif_run { step: "script", args: ["--keep", "<raison>"] }.`,
    };
  }
  const state = save(projectRoot, slug, { ...base, status: 'blocked', errors: issues.map((i) => i.problem) });
  return {
    state,
    summary:
      `[REVIEWER — TEXTE] Refusé (tour ${refused} sur ${SCRIPT_LIMITS.maxRounds}). Corrige episode.json.script et out/${slug}/script-card.json, puis relance whatif_run { step: "script" } :\n${list}`,
  };
}

/**
 * The Reviewer gave no verdict (breakdown, timeout, unreadable answer) on a specific submitted dossier `sig`.
 * Fail-closed when `sig` is missing or belongs to a superseded dossier (e.g. V1 failing after V2 was submitted):
 * V1 failures never increment V2's counter and never trigger V2's fallback approval.
 */
export function recordScriptReviewFailure(
  projectRoot: string,
  slug: string,
  why: string,
  sig: string,
): { state: ScriptState | null; summary: string } {
  const prev = readScriptState(projectRoot, slug);
  if (!prev || prev.status !== 'review') {
    return { state: prev, summary: `[REVIEWER — TEXTE] Pas de verdict ignoré (${why}) : aucun dossier actif en attente.` };
  }
  const f = scriptFiles(projectRoot, slug);
  let packSig: string | null = null;
  try {
    if (fs.existsSync(f.pack)) packSig = packSubmittedSig(fs.readFileSync(f.pack, 'utf8'));
  } catch {
    packSig = null;
  }
  const stateSubmittedSig = typeof prev.submittedSig === 'string' && prev.submittedSig.trim() ? prev.submittedSig.trim() : null;
  const current = flatScript(readEpisode(projectRoot, slug));
  const currentSig = scriptSig(current);

  if (
    !stateSubmittedSig ||
    !packSig ||
    packSig !== stateSubmittedSig ||
    submissionContentSig(packSig) !== currentSig ||
    prev.sig !== currentSig
  ) {
    const sameFailureScript = prev.reviewFailureSig === currentSig;
    const failureCount = sameFailureScript ? (prev.reviewFailures ?? 0) : 0;
    const { submittedSig: _drop, ...restPrev } = prev;
    const state = save(projectRoot, slug, {
      ...restPrev,
      sig: currentSig,
      reviewFailures: failureCount,
      ...(failureCount > 0 ? { reviewFailureSig: currentSig } : { reviewFailureSig: undefined }),
      status: 'blocked',
      errors: [`le script ou le dossier a changé pendant la relecture (${stateSubmittedSig ?? 'manquant'} -> ${currentSig})`],
      at: new Date().toISOString(),
    });
    return { state, summary: `[REVIEWER — TEXTE] Le script a changé pendant la relecture : relance whatif_run { step: "script" }.` };
  }

  const failureSig = typeof sig === 'string' && sig.trim() ? sig.trim() : null;
  if (!failureSig) {
    return {
      state: prev,
      summary: `[REVIEWER — TEXTE] Échec/timeout non comptabilisé (${why}) : jeton/signature obligatoire "sig" manquant.`,
    };
  }
  if (failureSig !== packSig) {
    return {
      state: prev,
      summary: `[REVIEWER — TEXTE] Échec/timeout associé au jeton ${failureSig} ignoré car le dossier actif est ${packSig}.`,
    };
  }

  const prevFailures = prev.reviewFailureSig === currentSig ? (prev.reviewFailures ?? 0) : 0;
  const reviewFailures = prevFailures + 1;
  if (reviewFailures >= SCRIPT_LIMITS.maxReviewFailures) {
    const state = approve(
      projectRoot,
      slug,
      {
        ...prev,
        sig: currentSig,
        submittedSig: packSig,
        status: 'approved',
        reviewer: 'skipped',
        reviewFailures,
        reviewFailureSig: currentSig,
        at: new Date().toISOString(),
      },
      current,
    );
    return {
      state,
      summary: `[REVIEWER — TEXTE] Pas de verdict pour la ${reviewFailures}e fois (${why}) : le texte passe avec la seule lecture de l'agent, c'est noté dans out/${slug}/script-check.json. La voix peut être générée.`,
    };
  }
  const state = save(projectRoot, slug, { ...prev, reviewFailures, reviewFailureSig: currentSig, at: new Date().toISOString() });
  return { state, summary: `[REVIEWER — TEXTE] Pas de verdict (${why}). Relance whatif_run { step: "script" } pour une nouvelle relecture.` };
}

/** No Reviewer is configured at all: the agent's reading stands alone, and it is written down. */
export function approveWithoutReviewer(projectRoot: string, slug: string, why: string): { state: ScriptState | null; summary: string } {
  const prev = readScriptState(projectRoot, slug);
  if (!prev || prev.status !== 'review') return { state: prev, summary: '' };
  const f = scriptFiles(projectRoot, slug);
  let packSig: string | null = null;
  try {
    if (fs.existsSync(f.pack)) packSig = packSubmittedSig(fs.readFileSync(f.pack, 'utf8'));
  } catch {
    packSig = null;
  }
  const stateSubmittedSig = typeof prev.submittedSig === 'string' && prev.submittedSig.trim() ? prev.submittedSig.trim() : null;
  const current = flatScript(readEpisode(projectRoot, slug));
  const currentSig = scriptSig(current);
  if (
    !stateSubmittedSig ||
    !packSig ||
    packSig !== stateSubmittedSig ||
    submissionContentSig(packSig) !== currentSig ||
    prev.sig !== currentSig
  ) {
    const { submittedSig: _drop, ...restPrev } = prev;
    const state = save(projectRoot, slug, {
      ...restPrev,
      sig: currentSig,
      status: 'blocked',
      errors: [`le script a changé après la vérification (${stateSubmittedSig ?? 'manquant'} -> ${currentSig})`],
      at: new Date().toISOString(),
    });
    return { state, summary: `[REVIEWER — TEXTE] Le script a changé après la vérification : relance whatif_run { step: "script" }.` };
  }
  const state = approve(
    projectRoot,
    slug,
    { ...prev, sig: currentSig, submittedSig: packSig, status: 'approved', reviewer: 'skipped', at: new Date().toISOString() },
    current,
  );
  return { state, summary: `[REVIEWER — TEXTE] Pas de relecture (${why}) : le texte passe avec la seule lecture de l'agent, c'est noté dans out/${slug}/script-check.json. La voix peut être générée.` };
}

/**
 * The door in front of the voice: an episode that has no voice yet needs an approved (or kept) text.
 * An episode voiced before this step existed is left alone.
 */
export function scriptGate(projectRoot: string, slug: string): string | null {
  const state = readScriptState(projectRoot, slug);
  const voiced = fs.existsSync(path.join(projectRoot, 'public', slug, 'voice.wav'));
  if (!state && voiced) return null;
  const episode = readEpisode(projectRoot, slug);
  // The contract is the one of a told story (:8005 translations and custom texts). The standalone seven-beat "What If"
  // format ends on a question by design: it is not judged by it unless the step was run on purpose.
  if (!state && !episode?.source?.videoId) return null;
  const current = flatScript(episode);
  const sig = scriptSig(current);
  const review = readJson(scriptFiles(projectRoot, slug).review);
  if (hasActiveSubmissionApproval(state, review, sig)) return null;
  if (state?.status === 'discarded') {
    return `the story was discarded before the voice (${state.discardReason ?? 'see out/' + slug + '/script-check.json'}). Only the user can keep it: whatif_run { step: "script", args: ["--keep", "<reason>"] }`;
  }
  if (state && state.sig !== sig && (state.status === 'approved' || state.status === 'kept')) {
    return `the script changed after it was approved: run whatif_run { step: "script" } again before the voice`;
  }
  if (state && state.sig === sig && state.status === 'approved') {
    return `the script approval does not match an active reviewed submission: run whatif_run { step: "script" } again before the voice`;
  }
  return `the script has not been read and approved yet: run whatif_run { step: "script" } before the voice (it reads the text against the contract, corrects it when it can, and drops a story with no payoff before any credit is spent)`;
}
