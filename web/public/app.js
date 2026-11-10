// What If studio — front-end. No framework, no build step: served as-is by the orchestrator.

const S = {
  token: localStorage.getItem('whatif.token') || '',
  presets: {},
  projects: [],
  project: null,
  threads: [],
  thread: null,
  running: false,
  startedAt: null,
  elapsedMs: 0,
  timerInterval: null,
  es: null,
  lastSeq: 0,
  live: null,
};

function fmtClock(ms) {
  const totalSec = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  const pad = (n) => String(n).padStart(2, '0');
  return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${pad(m)}:${pad(s)}`;
}

function fmtDuration(ms) {
  if (!ms || ms < 500) return '';
  const totalSec = Math.max(1, Math.round(ms / 1000));
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  if (h > 0) return `${h}h ${m}m ${s}s`;
  if (m > 0) return `${m}m ${s}s`;
  return `${s}s`;
}

const $ = (sel) => document.querySelector(sel);

function el(tag, props = {}, ...kids) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (v === undefined || v === null || v === false) continue;
    if (k === 'class') node.className = v;
    else if (k === 'text') node.textContent = v;
    else if (k === 'html') node.innerHTML = v;
    else if (k.startsWith('on')) node.addEventListener(k.slice(2).toLowerCase(), v);
    else if (k === 'dataset') Object.assign(node.dataset, v);
    else node.setAttribute(k, v === true ? '' : v);
  }
  for (const kid of kids.flat()) {
    if (kid === null || kid === undefined || kid === false) continue;
    node.append(kid instanceof Node ? kid : document.createTextNode(String(kid)));
  }
  return node;
}

function esc(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

/** Tiny markdown: fenced code, inline code, bold, headings. Everything else stays literal. */
function md(src) {
  const out = [];
  const parts = String(src ?? '').split(/```/);
  parts.forEach((part, i) => {
    if (i % 2 === 1) {
      const body = part.replace(/^[a-zA-Z0-9]*\n/, '');
      out.push(`<pre>${esc(body.trimEnd())}</pre>`);
      return;
    }
    let html = esc(part);
    html = html.replace(/`([^`]+)`/g, (_, c) => `<code>${c}</code>`);
    html = html.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
    html = html.replace(/^(#{1,3}) (.*)$/gm, (_, h, t) => `<b>${t}</b>`);
    html = html.replace(/(https?:\/\/[^\s<)]+)/g, '<a href="$1" target="_blank" rel="noreferrer">$1</a>');
    out.push(html);
  });
  return out.join('');
}

async function api(path, opts = {}) {
  const url = new URL(path, location.origin);
  if (S.token) url.searchParams.set('token', S.token);
  const res = await fetch(url, {
    ...opts,
    headers: {
      'content-type': 'application/json',
      ...(S.token ? { 'x-whatif-token': S.token } : {}),
      ...(opts.headers || {}),
    },
  });
  if (!res.ok) {
    let msg = `${res.status} ${res.statusText}`;
    try {
      const body = await res.json();
      if (body.error) msg = body.error;
    } catch {}
    throw new Error(msg);
  }
  return res.status === 204 ? null : res.json();
}

function fileUrl(rel) {
  const url = new URL('/api/file', location.origin);
  url.searchParams.set('project', S.project?.id ?? '');
  url.searchParams.set('path', rel);
  if (S.token) url.searchParams.set('token', S.token);
  return url.toString();
}

// ------------------------------------------------------------------ rendering
const messagesBox = () => $('#messages');

function scrollDown() {
  const box = messagesBox();
  box.scrollTop = box.scrollHeight;
}

function bubble(role, text) {
  return el('div', { class: `msg ${role}` }, el('div', { class: 'bubble', html: md(text) }));
}

function artifactsRow(artifacts) {
  if (!artifacts?.length) return null;
  const row = el('div', { class: 'artifacts' });
  for (const a of artifacts) {
    const url = fileUrl(a.path);
    if (a.kind === 'image') {
      row.append(el('a', { href: url, target: '_blank' }, el('img', { src: url, alt: a.path, title: a.path })));
    } else if (a.kind === 'video') {
      row.append(el('video', { src: url, controls: true, preload: 'metadata' }));
    } else {
      row.append(el('a', { href: url, target: '_blank', text: a.path }));
    }
  }
  return row;
}

function toolCard({ name, ok, summary, artifacts, credits, durationMs, input, pending }) {
  const state = pending ? 'running' : ok ? 'ok' : 'fail';
  const card = el('details', { class: `tool ${state}`, dataset: { tool: name } });
  const head = el(
    'summary',
    {},
    el('span', { class: 'name', text: name }),
    el('span', { class: 'status', text: pending ? 'en cours' : ok ? 'ok' : 'échec' }),
    el(
      'span',
      { class: 'meta' },
      credits ? el('span', { text: `${credits} cr` }) : null,
      durationMs ? el('span', { text: `${(durationMs / 1000).toFixed(1)} s` }) : null,
    ),
  );
  card.append(head);
  if (input !== undefined) card.append(el('pre', { text: `args: ${JSON.stringify(input, null, 1)}` }));
  if (summary) card.append(el('pre', { text: summary }));
  const arts = artifactsRow(artifacts);
  if (arts) card.append(arts);
  return card;
}

function renderMessage(m) {
  const box = messagesBox();
  const payload = m.payload || null;
  if (m.role === 'tool') {
    box.append(
      toolCard({
        name: payload?.name ?? 'tool',
        ok: payload?.ok !== false,
        summary: String(m.content ?? '').replace(/^(ok|ERROR)\n/, ''),
        artifacts: payload?.artifacts ?? [],
        credits: payload?.credits ?? 0,
      }),
    );
    return;
  }
  if (m.role === 'assistant') {
    const node = bubble('assistant', m.content || '…');
    box.append(node);
    if (payload?.toolCalls?.length) {
      const line = el('div', { class: 'think', text: `→ ${payload.toolCalls.map((c) => c.name).join(', ')}` });
      box.append(line);
    }
    return;
  }
  box.append(bubble('user', m.content));
}

function renderEmpty() {
  const head = S.project
    ? el('p', { text: `Projet « ${S.project.name} » ouvert, aucun fil de discussion.` })
    : el('p', { text: 'Aucun projet ouvert.' });
  messagesBox().append(
    el(
      'div',
      { class: 'empty' },
      head,
      el('p', { html: S.project ? 'Crée un fil avec <code>+</code> dans la colonne « Fils », puis demande par exemple&nbsp;:' : 'Crée un projet avec <code>+</code> dans la colonne « Projets », puis demande par exemple&nbsp;:' }),
      el('p', { html: '<em>« Nouvel épisode “pause-everyone” : le monde se met en pause quand tu appuies sur espace. Va jusqu’à la fin (mp4 final). »</em>' }),
    ),
  );
}

// ------------------------------------------------------------------ sidebar
function renderSidebar() {
  const projects = $('#projects');
  projects.replaceChildren();
  for (const p of S.projects) {
    const durLabel = p.running
      ? `⏱ ${fmtClock(Date.now() - (p.startedAt || Date.now()))}`
      : p.elapsedMs > 0
        ? `⏱ ${fmtDuration(p.elapsedMs)}`
        : '';
    const subText = durLabel ? `${p.id} · ${durLabel}` : p.id;
    const li = el(
      'li',
      {
        class: S.project?.id === p.id ? 'active' : '',
        onclick: () => selectProject(p),
        title: p.root,
      },
      p.running ? `● ${p.name}` : p.name,
      el('span', { class: 'sub', text: subText }),
    );
    projects.append(li);
  }
  const threads = $('#threads');
  threads.replaceChildren();
  for (const t of S.threads) {
    const label = t.title || '(nouveau fil)';
    threads.append(
      el('li', {
        class: S.thread?.id === t.id ? 'active' : '',
        text: t.running || (S.thread?.id === t.id && S.running) ? `● ${label}` : label,
        onclick: () => selectThread(t),
      }),
    );
  }
}

async function loadProjects() {
  S.projects = await api('/api/projects');
  if (S.project) {
    const updated = S.projects.find((p) => p.id === S.project.id);
    if (updated) {
      S.project = updated;
      if (!S.running && updated.elapsedMs) S.elapsedMs = updated.elapsedMs;
    }
  }
  renderSidebar();
}

async function selectProject(project) {
  S.project = project;
  S.elapsedMs = project.elapsedMs || 0;
  S.startedAt = project.startedAt || null;
  S.threads = await api(`/api/threads?projectId=${encodeURIComponent(project.id)}`);
  S.thread = null;
  detach();
  messagesBox().replaceChildren();
  renderSidebar();
  loadDeliverables();
  $('#credits').textContent = `${project.credits ?? 0} cr`;
  updateRunningUI();
  if (S.threads.length) await selectThread(S.threads[0]);
  else renderEmpty();
}

// The final mp4, the board and the loudness report: what you want to look at after a reload,
// and what the chat scrolls away from.
async function loadDeliverables() {
  const box = $('#deliverables');
  if (!S.project || !box) return;
  box.replaceChildren();
  box.hidden = true;
  let files = [];
  try {
    ({ files } = await api(`/api/projects/${encodeURIComponent(S.project.id)}/artifacts`));
  } catch {
    return;
  }
  const fileUrl = (p) => new URL(`/api/file?project=${encodeURIComponent(S.project.id)}&path=${encodeURIComponent(p)}`, location.origin);
  const finals = files.filter((f) => /-final\.mp4$/.test(f.name)).slice(0, 2);
  const videos = finals.length ? finals : files.filter((f) => f.name.endsWith('.mp4')).slice(0, 1);
  const boards = files.filter((f) => /(storyboard|board\/S\d+|stills)/i.test(f.path) && /\.(jpg|png)$/i.test(f.name)).slice(0, 2);
  const report = files.find((f) => f.name === 'report.json');
  for (const v of videos) {
    box.append(el('div', { class: 'deliverable' },
      el('video', { src: fileUrl(v.path).toString(), controls: true, preload: 'metadata' }),
      el('a', { href: fileUrl(v.path).toString(), target: '_blank', text: `${v.name} · ${(v.size / 1048576).toFixed(1)} Mo` })));
  }
  for (const b of boards) {
    box.append(el('div', { class: 'deliverable' },
      el('a', { href: fileUrl(b.path).toString(), target: '_blank' }, el('img', { src: fileUrl(b.path).toString(), alt: b.name })),
      el('span', { class: 'tag', text: 'planche' })));
  }
  if (report) {
    const url = fileUrl(report.path);
    api(`/api/file?project=${encodeURIComponent(S.project.id)}&path=${encodeURIComponent(report.path)}`)
      .then((r) => {
        const agentSec = r.agent_total_seconds || r.agent_elapsed_seconds || (S.elapsedMs ? S.elapsedMs / 1000 : 0);
        const agentTxt = agentSec ? ` · ⏱ agent ${fmtDuration(agentSec * 1000)}` : '';
        const txt = `−${Math.abs(r.lufs ?? 0).toFixed(1)} LUFS · ${(r.true_peak_dbtp ?? 0).toFixed(1)} dBTP · ${(r.seconds ?? 0).toFixed(1)} s${agentTxt}`;
        box.append(el('div', { class: 'deliverable' }, el('span', { class: 'tag', text: 'master' }), el('span', { class: 'tag', text: txt }),
          el('a', { href: url.toString(), target: '_blank', text: 'report.json' })));
      })
      .catch(() => {});
  }
  box.hidden = box.children.length === 0;
}

function detach() {
  if (S.es) {
    S.es.close();
    S.es = null;
  }
  S.lastSeq = 0;
}

async function selectThread(thread) {
  S.thread = thread;
  renderSidebar();
  // the run may be blocked on an approval that this page never saw (reload, other tab)
  try {
    const pending = await api(`/api/approvals?thread=${encodeURIComponent(thread.id)}`);
    $('#approvals').replaceChildren();
    for (const a of pending) showApproval(a);
  } catch {
    /* older server: no route */
  }
  detach();
  messagesBox().replaceChildren();
  const data = await api(`/api/threads/${thread.id}/messages`);
  for (const m of data.messages) renderMessage(m);
  S.running = data.running;
  S.startedAt = data.startedAt || (data.running ? Date.now() : null);
  if (typeof data.elapsedMs === 'number' && data.elapsedMs > 0) S.elapsedMs = data.elapsedMs;
  updateRunningUI();
  for (const a of data.pending ?? []) showApproval({ id: a.id, tool: a.tool, input: JSON.parse(a.input) });
  scrollDown();
  connect(thread.id);
}

function connect(threadId) {
  const url = new URL(`/api/threads/${threadId}/events`, location.origin);
  if (S.token) url.searchParams.set('token', S.token);
  const es = new EventSource(url);
  S.es = es;
  const on = (type, fn) => es.addEventListener(type, (e) => {
    let data = {};
    try {
      data = JSON.parse(e.data);
    } catch {}
    if (e.lastEventId) {
      const seq = Number(e.lastEventId);
      if (seq && seq <= S.lastSeq && type !== 'hello') return;
      if (seq > S.lastSeq) S.lastSeq = seq;
    }
    fn(data);
  });
  on('user_message', (d) => {
    messagesBox().append(bubble('user', d.text));
    scrollDown();
  });
  on('assistant_delta', (d) => {
    if (!S.live) {
      S.live = el('div', { class: 'msg assistant' }, el('div', { class: 'bubble' }));
      messagesBox().append(S.live);
    }
    const bubbleBox = S.live.querySelector('.bubble');
    bubbleBox.textContent += d.text;
    scrollDown();
  });
  on('assistant_message', (d) => {
    if (S.live) {
      S.live.querySelector('.bubble').innerHTML = md(d.text || '…');
      if (d.toolCalls?.length) {
        messagesBox().append(el('div', { class: 'think', text: `→ ${d.toolCalls.map((c) => c.name).join(', ')}` }));
      }
      S.live = null;
    } else {
      renderMessage({ role: 'assistant', content: d.text, payload: { toolCalls: d.toolCalls } });
    }
    scrollDown();
  });
  on('tool_call', (d) => {
    if (S.live) S.live = null;
    const stepLabel = d.input?.step ? ` (${d.input.step})` : d.input?.path ? ` (${d.input.path})` : '';
    const card = toolCard({ name: `${d.name}${stepLabel}`, pending: true, input: d.input });
    card.id = `tool-${d.id}`;
    card.open = d.name === 'whatif_run';
    const liveLog = el('pre', { class: 'live-log muted small', text: 'démarrage…' });
    card.append(liveLog);
    messagesBox().append(card);
    scrollDown();
  });
  on('log', (d) => {
    const runningCards = messagesBox().querySelectorAll('details.tool.running');
    const last = runningCards[runningCards.length - 1];
    if (!last || !d?.line) return;
    let liveLog = last.querySelector('.live-log');
    if (!liveLog) {
      liveLog = el('pre', { class: 'live-log muted small' });
      last.append(liveLog);
    }
    const prev = liveLog.textContent === 'démarrage…' ? [] : liveLog.textContent.split('\n').filter(Boolean);
    prev.push(String(d.line));
    liveLog.textContent = prev.slice(-14).join('\n');
    const statusSpan = last.querySelector('summary .status');
    if (statusSpan) statusSpan.textContent = `en cours · ${String(d.line).slice(0, 56)}`;
    scrollDown();
  });
  on('tool_result', (d) => {
    const old = document.getElementById(`tool-${d.id}`);
    const stepLabel = d.input?.step ? ` (${d.input.step})` : '';
    const card = toolCard({ ...d, name: `${d.name}${stepLabel}`, pending: false });
    card.open = !d.ok || Boolean(d.artifacts?.length);
    if (old) old.replaceWith(card);
    else messagesBox().append(card);
    if (d.artifacts?.length) loadDeliverables();
    scrollDown();
  });
  on('approval_request', (d) => showApproval(d));
  on('approval_decided', (d) => {
    document.querySelectorAll(`[data-approval="${d.id}"]`).forEach((n) => {
      n.querySelector('.status-text').textContent = d.decision === 'approved' ? 'approuvé' : 'refusé';
      n.querySelectorAll('button').forEach((b) => (b.disabled = true));
    });
  });
  on('error', (d) => messagesBox().append(el('div', { class: 'think', text: `Erreur : ${d.message}` })));
  on('turn_start', (d) => {
    S.running = true;
    S.startedAt = d.startedAt || Date.now();
    updateRunningUI();
    loadProjects();
    $('#model').textContent = `${d.model}`;
  });
  on('turn_end', (d) => {
    const runDur = d?.elapsedMs || (S.startedAt ? Date.now() - S.startedAt : 0);
    S.running = false;
    S.startedAt = null;
    S.live = null;
    if (d?.totalProjectMs) S.elapsedMs = d.totalProjectMs;
    else if (runDur > 0) S.elapsedMs = (S.elapsedMs || 0) + runDur;
    updateRunningUI();
    loadDeliverables();
    loadProjects();
    scrollDown();
  });
  on('hello', (d) => {
    S.running = Boolean(d.running);
    if (d.running) S.startedAt = d.startedAt || S.startedAt || Date.now();
    if (typeof d.elapsedMs === 'number' && d.elapsedMs > 0) S.elapsedMs = d.elapsedMs;
    updateRunningUI();
  });
}

// ------------------------------------------------------------------ approvals
function showApproval({ id, tool, input }) {
  const box = $('#approvals');
  const node = el(
    'div',
    { class: 'approval', dataset: { approval: id } },
    el('div', {}, el('b', { text: `Autoriser ${tool} ?` }), el('span', { class: 'status-text muted', text: 'en attente' })),
    el('pre', { class: 'muted small', text: JSON.stringify(input, null, 1) }),
    el(
      'div',
      { class: 'row' },
      el('button', {
        class: 'primary',
        text: 'Autoriser',
        onclick: () => decide(id, true),
      }),
      el('button', { class: 'ghost danger', text: 'Refuser', onclick: () => decide(id, false) }),
    ),
  );
  box.append(node);
}

async function decide(id, approve) {
  try {
    await api(`/api/approvals/${id}`, { method: 'POST', body: JSON.stringify({ approve }) });
  } catch (e) {
    alert(String(e));
  }
}

// ------------------------------------------------------------------ sending
function renderTimerChip() {
  const chip = $('#timer');
  if (!chip) return;
  if (S.running) {
    const liveMs = (S.elapsedMs || 0) + Math.max(0, Date.now() - (S.startedAt || Date.now()));
    chip.hidden = false;
    chip.className = 'chip timer-running';
    chip.textContent = `⏱ ${fmtClock(liveMs)}`;
    chip.title = 'Temps écoulé sur ce projet (en cours)';
  } else if (S.elapsedMs > 0) {
    chip.hidden = false;
    chip.className = 'chip timer-done';
    chip.textContent = `✓ Terminé en ${fmtDuration(S.elapsedMs)}`;
    chip.title = `Temps total pris par l'agent sur le projet ${S.project?.name || ''}`;
  } else {
    chip.hidden = true;
  }
}

function updateRunningUI() {
  $('#stop').hidden = !S.running;
  $('#send').disabled = !S.running ? false : true;
  if (S.running) {
    if (!S.startedAt) S.startedAt = Date.now();
    if (!S.timerInterval) {
      S.timerInterval = setInterval(() => {
        renderTimerChip();
        renderSidebar();
      }, 1000);
    }
  } else if (S.timerInterval) {
    clearInterval(S.timerInterval);
    S.timerInterval = null;
  }
  renderTimerChip();
  const perThread = S.thread ? ` · ${S.thread.title || 'fil'}` : '';
  document.title = `${S.running ? '● ' : ''}What If${perThread}`;
}

$('#composer').addEventListener('submit', async (e) => {
  e.preventDefault();
  if (!S.thread) {
    alert('Choisis ou crée un fil à gauche.');
    return;
  }
  const input = $('#input');
  const text = input.value.trim();
  if (!text) return;
  input.value = '';
  try {
    const res = await api(`/api/threads/${S.thread.id}/messages`, { method: 'POST', body: JSON.stringify({ text }) });
    S.running = true;
    S.startedAt = res?.startedAt || Date.now();
    updateRunningUI();
  } catch (err) {
    alert(String(err));
  }
});

$('#input').addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault();
    $('#composer').requestSubmit();
  }
});

$('#stop').addEventListener('click', async () => {
  if (!S.thread) return;
  await api(`/api/threads/${S.thread.id}/stop`, { method: 'POST', body: '{}' }).catch(() => {});
});

const slugify = (s) =>
  String(s)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48);

// A video id is the normal starting point, so the dialog asks for it and then hands the work to the agent
// instead of running the pipeline from the browser.
function kickoffMessage({ episode, video, aspect }) {
  if (!video) return null;
  const fmt = aspect === '9:16' ? '9:16 vertical (1080×1920)' : '16:9 paysage (1920×1080)';
  return [
    `Nouvel épisode « ${episode} » (format ${fmt}) à partir de la vidéo nouveau ${video}. Fais tout, du début à la fin, sans me demander de validation.`,
    `1. whatif_run {step:"source", args:["--pick","hook","--apply"]} : récupère la proposition de traduction française du serveur :8005 dans out/${episode}/source.fr.md et l'applique directement dans episode.json.script. IMPORTANT : NE RACCOURCIS PAS et NE RÉÉCRIS PAS la traduction du serveur :8005 (un projet peut durer de 20s à plusieurs minutes ; garde l'intégralité du texte traduit dans episode.json.script, règle simplement "defaultSet" selon le lieu de l'histoire et conserve "aspect": "${aspect || '16:9'}").`,
    `2. Enchaîne voice (si le serveur :8005 a déjà un audio pour cette vidéo, voice le récupère automatiquement sans en régénérer un nouveau — n'ajoute pas --force), puis shotlist et plan.`,
    `3. Avant de coder shots.tsx, écris une vraie note de réalisation et mise en scène dans src/episodes/${episode}/DIRECTOR.md : (a) Le décor du lieu de l'histoire en 3 couches de profondeur (arrière-plan, mobilier du plan moyen, premier plan) : pars d'un lieu du catalogue quand il correspond (place(), que tu adaptes à l'histoire), sinon compose-le pièce par pièce ; une table ou un bureau seulement si l'histoire en a besoin. (b) Casting et costumes (cast()). (c) Découpage plan par plan : varie les tailles et les angles, personnages de trois-quarts, de profil ou de dos (yaw), champs/contrechamps face à face, amorces floues, groupes étagés en profondeur ; chorégraphie précise des mains/bras quand un personnage prend, tient ou pose un objet (aucun accessoire ne doit flotter loin des mains).`,
    `4. Écris shots.tsx et index.tsx en suivant fidèlement DIRECTOR.md, lance stills et board, regarde les planches de contact (out/${episode}/sheets/) avec view_image, passe la checklist du guide du réalisateur plan par plan et corrige seulement les plans qui échouent.`,
    `5. Puis sfx, render et master jusqu'au mp4 final en ${fmt}, et résume-moi le résultat (durée, orientation, LUFS, fichiers).`,
  ].join('\n');
}

function openNewProject() {
  if (location.hash === '#nouveau') location.hash = '';
  $('#np-name').value = '';
  $('#np-episode').value = '';
  $('#np-episode').dataset.touched = '';
  $('#np-video').value = '';
  if ($('#np-aspect')) $('#np-aspect').value = '16:9';
  $('#np-kick').checked = true;
  $('#new-project-dialog').showModal();
}

// deep link: /#nouveau opens the dialog (also how the headless screenshot test reaches it)
if (location.hash === '#nouveau') setTimeout(openNewProject, 300);

$('#new-project').addEventListener('click', openNewProject);

// keep the episode slug in sync with the project name until it is typed by hand
$('#np-name').addEventListener('input', (e) => {
  const ep = $('#np-episode');
  if (!ep.dataset.touched) ep.value = slugify(e.target.value);
});
$('#np-episode').addEventListener('input', (e) => {
  e.target.dataset.touched = '1';
});

$('#np-create').addEventListener('click', async (e) => {
  e.preventDefault();
  const name = $('#np-name').value.trim();
  const episode = slugify($('#np-episode').value.trim() || name);
  const video = $('#np-video').value.trim();
  const aspect = ($('#np-aspect')?.value || '16:9').trim();
  if (!name) return;
  const dialog = $('#new-project-dialog');
  const button = $('#np-create');
  button.disabled = true;
  button.textContent = 'Création…';
  try {
    const body = { name, id: slugify(name), ...(episode ? { episode } : {}), ...(video ? { video } : {}), aspect };
    const { project, tool } = await api('/api/projects', { method: 'POST', body: JSON.stringify(body) });
    dialog.close();
    await loadProjects();
    await selectProject(project);
    const thread = await api('/api/threads', { method: 'POST', body: JSON.stringify({ projectId: project.id, title: episode || 'Premier fil' }) });
    S.threads = [thread, ...S.threads];
    await selectThread(thread);
    if (tool && !tool.ok) messagesBox().append(el('div', { class: 'think', text: `Scaffold : ${tool.summary}` }));
    const kick = $('#np-kick').checked ? kickoffMessage({ episode, video, aspect }) : null;
    if (kick) {
      const res = await api(`/api/threads/${thread.id}/messages`, { method: 'POST', body: JSON.stringify({ text: kick }) });
      S.running = true;
      S.elapsedMs = 0;
      S.startedAt = res?.startedAt || Date.now();
      updateRunningUI();
    }
  } catch (err) {
    alert(String(err));
  } finally {
    button.disabled = false;
    button.textContent = 'Créer';
  }
});

$('#new-project-dialog').addEventListener('click', (e) => {
  if (e.target.id === 'new-project-dialog') e.target.close(); // click on the backdrop
});

$('#new-thread').addEventListener('click', async () => {
  if (!S.project) return;
  const thread = await api('/api/threads', { method: 'POST', body: JSON.stringify({ projectId: S.project.id }) });
  S.threads = [thread, ...S.threads];
  await selectThread(thread);
});

// ------------------------------------------------------------------ settings
async function openSettings() {
  const s = await api('/api/settings');
  S.presets = s.presets;
  const select = $('#s-provider');
  select.replaceChildren();
  for (const [key, preset] of Object.entries(s.presets)) {
    select.append(el('option', { value: key, text: `${key} — ${preset.model || '(clé requise)'}` }));
  }
  select.value = s.provider;
  $('#s-baseurl').value = s.baseURL || '';
  $('#s-model').value = s.model || '';
  $('#s-key').value = '';
  $('#s-key').placeholder = s.hasKey ? '(clé enregistrée)' : 'sk-…';
  $('#s-token').value = S.token;
  $('#s-skill').textContent = `skill : ${s.skillDir || 'introuvable (WHATIF_SKILL_DIR)'}`;
  $('#settings').showModal();
}

$('#s-provider').addEventListener('change', () => {
  const preset = S.presets[$('#s-provider').value];
  if (preset) {
    $('#s-baseurl').value = preset.baseURL;
    $('#s-model').value = preset.model;
  }
});

$('#settings-btn').addEventListener('click', openSettings);

$('#s-save').addEventListener('click', async (e) => {
  e.preventDefault();
  const token = $('#s-token').value.trim();
  S.token = token;
  localStorage.setItem('whatif.token', token);
  await api('/api/settings', {
    method: 'POST',
    body: JSON.stringify({
      provider: $('#s-provider').value,
      baseURL: $('#s-baseurl').value,
      model: $('#s-model').value,
      apiKey: $('#s-key').value,
    }),
  });
  $('#settings').close();
  const s = await api('/api/settings');
  $('#model').textContent = `${s.provider} · ${s.model}`;
});

// ------------------------------------------------------------------ boot
(async function boot() {
  try {
    const s = await api('/api/settings');
    $('#model').textContent = `${s.provider} · ${s.model}`;
    if (!s.skillDir) $('#model').title = 'WHATIF_SKILL_DIR introuvable : le scaffold et les scripts ne marcheront pas';
    await loadProjects();
    if (S.projects.length) await selectProject(S.projects[0]);
    else renderEmpty();
  } catch (e) {
    messagesBox().append(el('div', { class: 'think', text: `Connexion impossible : ${e.message}. Si le serveur exige un token, ouvre ⚙.` }));
  }
  updateRunningUI();
})();
