// What If studio — front-end. No framework, no build step: served as-is by the orchestrator.

const S = {
  token: localStorage.getItem('whatif.token') || '',
  presets: {},
  projects: [],
  project: null,
  threads: [],
  thread: null,
  running: false,
  es: null,
  lastSeq: 0,
  live: null,
};

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
      el('p', { html: '<em>« Nouvel épisode “pause-everyone” : le monde se met en pause quand tu appuies sur espace. Écris le script, puis lance voice et plan. »</em>' }),
    ),
  );
}

// ------------------------------------------------------------------ sidebar
function renderSidebar() {
  const projects = $('#projects');
  projects.replaceChildren();
  for (const p of S.projects) {
    const li = el(
      'li',
      {
        class: S.project?.id === p.id ? 'active' : '',
        onclick: () => selectProject(p),
        title: p.root,
      },
      p.name,
      el('span', { class: 'sub', text: p.id }),
    );
    projects.append(li);
  }
  const threads = $('#threads');
  threads.replaceChildren();
  for (const t of S.threads) {
    threads.append(
      el('li', {
        class: S.thread?.id === t.id ? 'active' : '',
        text: t.title || '(nouveau fil)',
        onclick: () => selectThread(t),
      }),
    );
  }
}

async function loadProjects() {
  S.projects = await api('/api/projects');
  renderSidebar();
}

async function selectProject(project) {
  S.project = project;
  S.threads = await api(`/api/threads?projectId=${encodeURIComponent(project.id)}`);
  S.thread = null;
  detach();
  messagesBox().replaceChildren();
  renderSidebar();
  loadDeliverables();
  $('#credits').textContent = `${project.credits ?? 0} cr`;
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
        const txt = `−${Math.abs(r.lufs ?? 0).toFixed(1)} LUFS · ${(r.true_peak_dbtp ?? 0).toFixed(1)} dBTP · ${(r.seconds ?? 0).toFixed(1)} s`;
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
  detach();
  messagesBox().replaceChildren();
  const data = await api(`/api/threads/${thread.id}/messages`);
  for (const m of data.messages) renderMessage(m);
  S.running = data.running;
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
    const card = toolCard({ name: d.name, pending: true, input: d.input });
    card.id = `tool-${d.id}`;
    messagesBox().append(card);
    scrollDown();
  });
  on('tool_result', (d) => {
    const old = document.getElementById(`tool-${d.id}`);
    const card = toolCard({ ...d, pending: false });
    card.open = !d.ok;
    if (old) old.replaceWith(card);
    else messagesBox().append(card);
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
    updateRunningUI();
    $('#model').textContent = `${d.model}`;
  });
  on('turn_end', () => {
    S.running = false;
    S.live = null;
    updateRunningUI();
    scrollDown();
  });
  on('hello', (d) => {
    S.running = Boolean(d.running);
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
function updateRunningUI() {
  $('#stop').hidden = !S.running;
  $('#send').disabled = S.running;
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
    await api(`/api/threads/${S.thread.id}/messages`, { method: 'POST', body: JSON.stringify({ text }) });
    S.running = true;
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

$('#new-project').addEventListener('click', async () => {
  const name = prompt('Nom du projet ?');
  if (!name) return;
  const episode = prompt('Slug de l’épisode à créer (kebab-case, vide = projet vide) ?', 'pause-everyone');
  try {
    const body = { name, id: name, ...(episode ? { episode } : {}) };
    const { project, tool } = await api('/api/projects', { method: 'POST', body: JSON.stringify(body) });
    await loadProjects();
    await selectProject(project);
    const thread = await api('/api/threads', { method: 'POST', body: JSON.stringify({ projectId: project.id, title: 'Premier fil' }) });
    S.threads = [thread, ...S.threads];
    if (!tool?.ok && tool) messagesBox().append(el('div', { class: 'think', text: `Scaffold : ${tool.summary}` }));
    await selectThread(thread);
  } catch (err) {
    alert(String(err));
  }
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
