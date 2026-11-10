// What If Studio — Slack-inspired frontend. Zero framework, zero build step.

const S = {
  token: localStorage.getItem('whatif.token') || '',
  theme: document.documentElement.dataset.theme || 'dark',
  search: '',
  showArchivedProjects: false,
  showArchivedThreads: false,
  deliverablesCollapsed: false,
  deliverablesCount: 0,
  presets: {},
  catalog: {
    codex: {
      label: 'codex (Abonnement ChatGPT)',
      agent: [
        { id: 'gpt-6.1-terra', label: 'GPT-6.1 Terra' },
        { id: 'gpt-6.1-sol', label: 'GPT-6.1 Sol' },
      ],
      reviewer: [
        { id: 'gpt-6.1-sol', label: 'GPT-6.1 Sol' },
        { id: 'gpt-6.1-terra', label: 'GPT-6.1 Terra' },
      ],
      defaultAgentModel: 'gpt-6.1-terra',
      defaultReviewerModel: 'gpt-6.1-sol',
    },
    agy: {
      label: 'agy (Google Antigravity)',
      agent: [
        { id: 'gemini-3.8-flash-medium', label: 'Gemini 3.8 Flash (Medium)' },
        { id: 'gemini-4-carbon-low', label: 'Gemini 4 Carbon (Low)' },
        { id: 'gemini-4-argon-low', label: 'Gemini 4 Argon (Low)' },
      ],
      reviewer: [
        { id: 'gemini-4-argon-medium', label: 'Gemini 4 Argon (Medium)' },
        { id: 'gemini-4-carbon-medium', label: 'Gemini 4 Carbon (Medium)' },
      ],
      defaultAgentModel: 'gemini-3.8-flash-medium',
      defaultReviewerModel: 'gemini-4-argon-medium',
    },
  },
  settings: null,
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
  lastMsgRole: null,
  lastMsgTs: 0,
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

function normSearch(s) {
  return String(s ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();
}

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
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m ${s}s`;
  return `${s}s`;
}

function fmtTime(iso) {
  if (!iso) {
    const now = new Date();
    return now.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
  }
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const today = new Date();
  const sameDay =
    d.getFullYear() === today.getFullYear() &&
    d.getMonth() === today.getMonth() &&
    d.getDate() === today.getDate();
  const hhmm = d.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
  if (sameDay) return hhmm;
  return `${d.toLocaleDateString('fr-FR', { day: '2-digit', month: 'short' })} ${hhmm}`;
}

/** Lightweight safe Markdown renderer for Slack-style messages. */
function md(src) {
  const out = [];
  const parts = String(src ?? '').split(/```/);
  parts.forEach((part, i) => {
    if (i % 2 === 1) {
      const body = part.replace(/^[a-zA-Z0-9_-]*\n/, '');
      out.push(`<pre>${esc(body.trimEnd())}</pre>`);
      return;
    }
    let html = esc(part);
    html = html.replace(/`([^`\n]+)`/g, (_, c) => `<code>${c}</code>`);
    html = html.replace(/\*\*([^*\n]+)\*\*/g, '<strong>$1</strong>');
    html = html.replace(/^(#{1,3}) (.*)$/gm, (_, _h, t) => `<h3>${t}</h3>`);
    html = html.replace(/(https?:\/\/[^\s<)]+)/g, '<a href="$1" target="_blank" rel="noreferrer">$1</a>');
    out.push(html);
  });
  return out.join('');
}

// ------------------------------------------------------------------ theme
function applyTheme(theme) {
  const next = theme === 'light' ? 'light' : 'dark';
  S.theme = next;
  document.documentElement.dataset.theme = next;
  localStorage.setItem('whatif.theme', next);
  const icon = $('#theme-icon');
  const label = $('#theme-label');
  const btn = $('#theme-toggle');
  if (next === 'light') {
    if (icon) icon.textContent = '🌙';
    if (label) label.textContent = 'Sombre';
    if (btn) btn.title = 'Passer au mode sombre';
  } else {
    if (icon) icon.textContent = '☀️';
    if (label) label.textContent = 'Clair';
    if (btn) btn.title = 'Passer au mode clair';
  }
  const sel = $('#s-theme');
  if (sel && sel.value !== next) sel.value = next;
}

applyTheme(S.theme);

$('#theme-toggle')?.addEventListener('click', () => {
  applyTheme(S.theme === 'dark' ? 'light' : 'dark');
});

// ------------------------------------------------------------------ mobile drawer
function closeMobileSidebar() {
  $('#sidebar')?.classList.remove('open');
  const bd = $('#sidebar-backdrop');
  if (bd) bd.hidden = true;
}

$('#mobile-menu-btn')?.addEventListener('click', () => {
  const sb = $('#sidebar');
  const bd = $('#sidebar-backdrop');
  const willOpen = !sb.classList.contains('open');
  sb.classList.toggle('open', willOpen);
  if (bd) bd.hidden = !willOpen;
});
$('#sidebar-backdrop')?.addEventListener('click', closeMobileSidebar);

// ------------------------------------------------------------------ lightbox
function openLightbox(src, caption = '') {
  const dlg = $('#lightbox');
  if (!dlg) return;
  $('#lightbox-img').src = src;
  $('#lightbox-img').alt = caption;
  $('#lightbox-caption').textContent = caption;
  $('#lightbox-open').href = src;
  dlg.showModal();
}

$('#lightbox-close')?.addEventListener('click', () => $('#lightbox')?.close());
$('#lightbox')?.addEventListener('click', (e) => {
  if (e.target.id === 'lightbox' || e.target.classList.contains('lightbox-stage')) {
    $('#lightbox').close();
  }
});

// ------------------------------------------------------------------ API
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

// ------------------------------------------------------------------ messages & tools
const messagesBox = () => $('#messages');

function scrollDown() {
  const box = messagesBox();
  box.scrollTop = box.scrollHeight;
}

function resetFeedGrouping() {
  S.lastMsgRole = null;
  S.lastMsgTs = 0;
}

function messageRow(role, text, createdAt) {
  const ts = createdAt ? Date.parse(createdAt) || Date.now() : Date.now();
  const timeStr = fmtTime(createdAt);
  const compact = S.lastMsgRole === role && ts - S.lastMsgTs < 5 * 60 * 1000;
  S.lastMsgRole = role;
  S.lastMsgTs = ts;

  const isUser = role === 'user';
  if (compact) {
    return el(
      'div',
      { class: `msg-row ${role} compact` },
      el('div', { class: 'msg-gutter', text: timeStr.slice(-5) }),
      el('div', { class: 'msg-main' }, el('div', { class: 'msg-body bubble', html: md(text) })),
    );
  }

  return el(
    'div',
    { class: `msg-row ${role}` },
    el('div', { class: 'msg-avatar', text: isUser ? 'VO' : 'WI' }),
    el(
      'div',
      { class: 'msg-main' },
      el(
        'div',
        { class: 'msg-header' },
        el('span', { class: 'msg-author', text: isUser ? 'Vous' : 'What If Studio' }),
        !isUser ? el('span', { class: 'msg-role-badge', text: 'Agent' }) : null,
        el('span', { class: 'msg-time', text: timeStr }),
      ),
      el('div', { class: 'msg-body bubble', html: md(text) }),
    ),
  );
}

function artifactsRow(artifacts) {
  if (!artifacts?.length) return null;
  const row = el('div', { class: 'artifacts' });
  for (const a of artifacts) {
    const url = fileUrl(a.path);
    if (a.kind === 'image') {
      row.append(
        el('img', {
          src: url,
          alt: a.path,
          title: `${a.path} (cliquer pour agrandir)`,
          onclick: (e) => {
            e.preventDefault();
            openLightbox(url, a.path);
          },
        }),
      );
    } else if (a.kind === 'video') {
      row.append(el('video', { src: url, controls: true, preload: 'metadata' }));
    } else {
      row.append(el('a', { class: 'artifact-file', href: url, target: '_blank', text: `📄 ${a.path}` }));
    }
  }
  return row;
}

function prettyToolName(rawName, input) {
  const step = input?.step ? ` · ${input.step}` : '';
  const target = input?.path ? ` · ${input.path}` : input?.episode ? ` · ${input.episode}` : '';
  if (rawName.startsWith('whatif_run')) return rawName.includes('(') ? rawName : `pipeline${step || target}`;
  if (rawName === 'whatif_new') return `scaffold${target}`;
  if (rawName === 'view_image') return `inspection visuelle${target}`;
  if (rawName === 'write_file') return `écriture${target}`;
  if (rawName === 'edit_file') return `édition${target}`;
  if (rawName === 'read_file') return `lecture${target}`;
  if (rawName === 'repo_map' || rawName === 'list_files') return `exploration${target}`;
  return `${rawName}${step || target}`;
}

function toolCard({ name, ok, summary, artifacts, credits, durationMs, input, pending }) {
  const state = pending ? 'running' : ok ? 'ok' : 'fail';
  const iconChar = pending ? '●' : ok ? '✓' : '✕';
  const statusLabel = pending ? 'en cours…' : ok ? 'terminé' : 'échec';
  const card = el('details', { class: `tool ${state}`, dataset: { tool: name } });
  const head = el(
    'summary',
    {},
    el('span', { class: 'tool-icon', text: iconChar }),
    el('span', { class: 'name', text: prettyToolName(name, input) }),
    el('span', { class: 'status', text: statusLabel }),
    el(
      'span',
      { class: 'meta' },
      credits ? el('span', { text: `${credits} cr` }) : null,
      durationMs ? el('span', { text: `${(durationMs / 1000).toFixed(1)}s` }) : null,
      el('span', { class: 'expand-hint', text: '▸' }),
    ),
  );
  card.append(head);
  if (input !== undefined) card.append(el('pre', { text: `args: ${JSON.stringify(input, null, 2)}` }));
  if (summary) card.append(el('pre', { text: summary }));
  const arts = artifactsRow(artifacts);
  if (arts) card.append(arts);
  return el('div', { class: 'tool-wrap' }, card);
}

function renderMessage(m) {
  const box = messagesBox();
  const payload = m.payload || null;
  if (m.role === 'tool') {
    box.append(
      toolCard({
        name: payload?.name ?? 'tool',
        input: payload?.input,
        ok: payload?.ok !== false,
        summary: String(m.content ?? '').replace(/^(ok|ERROR)\n/, ''),
        artifacts: payload?.artifacts ?? [],
        credits: payload?.credits ?? 0,
        durationMs: payload?.durationMs,
      }),
    );
    return;
  }
  if (m.role === 'assistant') {
    if (m.content && m.content.trim()) {
      box.append(messageRow('assistant', m.content, m.created_at));
    } else {
      // Ensure subsequent assistant replies keep their header if this turn was tool-only
      S.lastMsgRole = 'assistant';
      S.lastMsgTs = Date.now();
    }
    return;
  }
  box.append(messageRow('user', m.content, m.created_at));
}

function fillPrompt(text, autoSubmit = false) {
  const input = $('#input');
  if (!input) return;
  input.value = text;
  autoResizeInput();
  input.focus();
  if (autoSubmit && S.thread && !S.running) {
    $('#composer').requestSubmit();
  }
}

function renderChannelIntro(hasMessages) {
  if (!S.project) return;
  const box = messagesBox();
  const threadTitle = S.thread ? S.thread.title || 'Nouvelle conversation' : 'Aucune conversation active';
  const intro = el(
    'div',
    { class: 'channel-intro' },
    el('h2', {}, el('span', { class: 'muted', text: '#' }), S.project.name),
    el(
      'p',
      {
        text: S.thread
          ? `Conversation « ${threadTitle} » · Dossier ${S.project.id}`
          : `Aucune conversation active dans ce projet. Crée une nouvelle conversation avec « ＋ » à gauche.`,
      },
    ),
  );

  if (S.thread && !hasMessages) {
    intro.append(
      el(
        'div',
        { class: 'quick-prompts' },
        el(
          'button',
          {
            type: 'button',
            class: 'prompt-card',
            onclick: () => openNewProject(),
          },
          el('strong', { text: '🎬 Nouvel épisode (ID vidéo)' }),
          el('span', { text: 'Importer une source :8005, générer le storyboard et produire le MP4.' }),
        ),
        el(
          'button',
          {
            type: 'button',
            class: 'prompt-card',
            onclick: () =>
              fillPrompt(
                'Fais un point rapide sur ce projet : fichiers présents, étape atteinte du pipeline et ce qu’il manque pour livrer le MP4 final.',
              ),
          },
          el('strong', { text: '📊 État d’avancement' }),
          el('span', { text: 'Inspecter où en est le projet et ce qu’il reste à compléter.' }),
        ),
        el(
          'button',
          {
            type: 'button',
            class: 'prompt-card',
            onclick: () =>
              fillPrompt(
                'Génère ou régénère les stills et la planche de contact (board), inspecte chaque plan avec view_image et corrige les éventuels défauts.',
              ),
          },
          el('strong', { text: '🖼 Vérifier le storyboard' }),
          el('span', { text: 'Contrôler le cadrage, les regards et les décors plan par plan.' }),
        ),
        el(
          'button',
          {
            type: 'button',
            class: 'prompt-card',
            onclick: () =>
              fillPrompt('Relance le rendu vidéo (render) puis le mastering audio (master) jusqu’au MP4 final.'),
          },
          el('strong', { text: '🚀 Lancer rendu & master' }),
          el('span', { text: 'Finaliser la vidéo et vérifier la sonie (−14 LUFS).' }),
        ),
      ),
    );
  }
  box.append(intro);
}

function renderEmptyWorkspace() {
  const box = messagesBox();
  box.replaceChildren();
  resetFeedGrouping();
  if (!S.project) {
    box.append(
      el(
        'div',
        { class: 'empty-state' },
        el('h3', { text: 'Bienvenue dans What If Studio' }),
        el('p', { text: 'Crée ton premier projet avec le bouton « ＋ Nouveau » en haut à gauche pour démarrer un épisode.' }),
        el(
          'p',
          {},
          el('button', { type: 'button', class: 'primary', text: '＋ Créer un projet', onclick: openNewProject }),
        ),
      ),
    );
    return;
  }
  renderChannelIntro(false);
}

// ------------------------------------------------------------------ header & archive banners
function syncChannelHeader() {
  const projName = $('#ch-project-name');
  const sep = $('#ch-sep');
  const threadName = $('#ch-thread-name');
  const prefix = $('#ch-prefix');
  const badge = $('#ch-archived-badge');
  const archProjBtn = $('#archive-project-btn');
  const archThreadBtn = $('#archive-thread-btn');
  const projModelBtn = $('#project-model-btn');
  const projModelLabel = $('#project-model-label');
  const banner = $('#archived-banner');
  const bannerText = $('#archived-banner-text');
  const bannerRestore = $('#archived-banner-restore');
  const input = $('#input');

  if (!S.project) {
    projName.textContent = 'Aucun projet';
    sep.hidden = true;
    threadName.hidden = true;
    badge.hidden = true;
    archProjBtn.hidden = true;
    archThreadBtn.hidden = true;
    if (projModelBtn) projModelBtn.hidden = true;
    banner.hidden = true;
    if (input) input.placeholder = 'Crée ou sélectionne un projet…';
    return;
  }

  const projArchived = Boolean(S.project.archived_at);
  const threadArchived = Boolean(S.thread?.archived_at);
  prefix.textContent = projArchived ? '📦' : '#';
  projName.textContent = S.project.name;

  if (projModelBtn && projModelLabel) {
    const eff = S.project.effectiveModel || {
      provider: S.project.provider || S.settings?.provider || 'codex',
      model: S.project.model || S.settings?.model || '',
      reviewModel: S.project.review_model || S.settings?.reviewer?.model || '',
    };
    const hasCustom = Boolean(S.project.provider || S.project.model || S.project.review_provider || S.project.review_model);
    const shortModel = (m) => String(m || '').replace(/^gemini-(?:4-)?/, '').replace(/^gpt-6\.1-/, '');
    const revPart = eff.reviewModel ? ` · rev:${shortModel(eff.reviewModel)}` : '';
    projModelBtn.hidden = false;
    projModelBtn.classList.toggle('custom', hasCustom);
    projModelLabel.textContent = `${eff.provider}:${shortModel(eff.model)}${revPart}`;
    projModelBtn.title = hasCustom
      ? `Modèles dédiés à ce projet : Agent ${eff.provider}/${eff.model}${eff.reviewModel ? ` · Reviewer ${eff.reviewProvider || eff.provider}/${eff.reviewModel}` : ''} (cliquer pour modifier)`
      : `Défaut du Studio : Agent ${eff.provider}/${eff.model}${eff.reviewModel ? ` · Reviewer ${eff.reviewModel}` : ''} (cliquer pour personnaliser ce projet)`;
  }

  if (S.thread) {
    sep.hidden = false;
    threadName.hidden = false;
    threadName.textContent = S.thread.title || 'Nouvelle conversation';
  } else {
    sep.hidden = true;
    threadName.hidden = true;
  }

  badge.hidden = !(projArchived || threadArchived);
  if (input) {
    input.placeholder = S.thread
      ? `Envoyer un message dans #${S.project.name}…`
      : `Crée une conversation dans #${S.project.name} pour discuter…`;
  }

  // Header archive buttons
  archProjBtn.hidden = false;
  archProjBtn.textContent = projArchived ? '↩ Restaurer projet' : '📦 Archiver projet';
  archProjBtn.title = projArchived
    ? `Désarchiver le projet « ${S.project.name} »`
    : `Archiver le projet « ${S.project.name} » pour alléger la liste`;
  archProjBtn.onclick = () => toggleProjectArchive(S.project);

  if (S.thread) {
    archThreadBtn.hidden = false;
    archThreadBtn.textContent = threadArchived ? '↩ Restaurer fil' : '📦 Archiver fil';
    archThreadBtn.title = threadArchived
      ? 'Désarchiver cette conversation'
      : 'Archiver cette conversation';
    archThreadBtn.onclick = () => toggleThreadArchive(S.thread);
  } else {
    archThreadBtn.hidden = true;
  }

  // Contextual archived banner
  if (projArchived) {
    banner.hidden = false;
    bannerText.textContent = `Le projet « ${S.project.name} » est archivé. Il est masqué de la liste principale.`;
    bannerRestore.onclick = () => toggleProjectArchive(S.project);
  } else if (threadArchived && S.thread) {
    banner.hidden = false;
    bannerText.textContent = `Cette conversation (« ${S.thread.title || 'sans titre'} ») est archivée.`;
    bannerRestore.onclick = () => toggleThreadArchive(S.thread);
  } else {
    banner.hidden = true;
  }
}

// ------------------------------------------------------------------ sidebar & archiving
function sortedProjects(list) {
  return [...list].sort((a, b) => {
    if (Boolean(a.running) !== Boolean(b.running)) return b.running ? 1 : -1;
    const ta = Date.parse(a.lastActivityAt || a.created_at || '') || 0;
    const tb = Date.parse(b.lastActivityAt || b.created_at || '') || 0;
    return tb - ta;
  });
}

async function toggleProjectArchive(project, ev) {
  if (ev) ev.stopPropagation();
  const nextArchived = !project.archived_at;
  try {
    const updated = await api(`/api/projects/${encodeURIComponent(project.id)}`, {
      method: 'PATCH',
      body: JSON.stringify({ archived: nextArchived }),
    });
    S.projects = S.projects.map((p) => (p.id === updated.id ? updated : p));
    if (S.project?.id === updated.id) {
      S.project = updated;
      if (nextArchived) {
        // Jump cleanly to the next active project if available
        const nextActive = sortedProjects(S.projects).find((p) => !p.archived_at && p.id !== updated.id);
        if (nextActive) {
          await selectProject(nextActive);
          return;
        }
      }
    }
    renderSidebar();
    syncChannelHeader();
  } catch (err) {
    alert(String(err));
  }
}

async function toggleThreadArchive(thread, ev) {
  if (ev) ev.stopPropagation();
  const nextArchived = !thread.archived_at;
  try {
    const updated = await api(`/api/threads/${encodeURIComponent(thread.id)}`, {
      method: 'PATCH',
      body: JSON.stringify({ archived: nextArchived }),
    });
    S.threads = S.threads.map((t) => (t.id === updated.id ? updated : t));
    if (S.thread?.id === updated.id) {
      S.thread = updated;
      if (nextArchived) {
        const nextActive = S.threads.find((t) => !t.archived_at && t.id !== updated.id);
        if (nextActive) {
          await selectThread(nextActive);
          return;
        }
        detach();
        S.thread = null;
        renderEmptyWorkspace();
      }
    }
    renderSidebar();
    syncChannelHeader();
  } catch (err) {
    alert(String(err));
  }
}

function buildProjectItem(p) {
  const isArchived = Boolean(p.archived_at);
  const durLabel = p.running
    ? `⏱ ${fmtClock(Date.now() - (p.startedAt || Date.now()))}`
    : p.elapsedMs > 0
      ? fmtDuration(p.elapsedMs)
      : '';
  const metaParts = [];
  if (p.id !== slugify(p.name)) metaParts.push(p.id);
  if (p.provider || p.model) metaParts.push(`${p.provider || S.settings?.provider || ''}${p.model ? `:${p.model.replace(/^gemini-(?:4-)?|^gpt-6\.1-/, '')}` : ''}`);
  if (durLabel) metaParts.push(durLabel);

  return el(
    'li',
    {
      class: S.project?.id === p.id ? 'active' : '',
      onclick: () => {
        closeMobileSidebar();
        selectProject(p);
      },
      title: `${p.name} (${p.root})`,
    },
    el('span', {
      class: `item-prefix ${p.running ? 'running-dot' : ''}`,
      text: p.running ? '●' : isArchived ? '📦' : '#',
    }),
    el(
      'div',
      { class: 'item-body' },
      el('span', { class: 'item-title', text: p.name }),
      metaParts.length ? el('span', { class: 'item-meta', text: metaParts.join(' · ') }) : null,
    ),
    el('button', {
      type: 'button',
      class: 'item-action',
      title: isArchived ? 'Restaurer ce projet' : 'Archiver ce projet',
      text: isArchived ? '↩' : '📦',
      onclick: (e) => toggleProjectArchive(p, e),
    }),
  );
}

function buildThreadItem(t) {
  const isArchived = Boolean(t.archived_at);
  const isRun = t.running || (S.thread?.id === t.id && S.running);
  const label = t.title || 'Nouvelle conversation';
  return el(
    'li',
    {
      class: S.thread?.id === t.id ? 'active' : '',
      onclick: () => {
        closeMobileSidebar();
        selectThread(t);
      },
      title: label,
    },
    el('span', {
      class: `item-prefix ${isRun ? 'running-dot' : ''}`,
      text: isRun ? '●' : isArchived ? '📦' : '💬',
    }),
    el('div', { class: 'item-body' }, el('span', { class: 'item-title', text: label })),
    el('button', {
      type: 'button',
      class: 'item-action',
      title: isArchived ? 'Restaurer cette conversation' : 'Archiver cette conversation',
      text: isArchived ? '↩' : '📦',
      onclick: (e) => toggleThreadArchive(t, e),
    }),
  );
}

function renderSidebar() {
  const q = normSearch(S.search.trim());
  const ordered = sortedProjects(S.projects);
  const filteredProjects = q
    ? ordered.filter((p) => normSearch(`${p.name} ${p.id}`).includes(q))
    : ordered;

  const activeProjects = filteredProjects.filter((p) => !p.archived_at);
  const archivedProjects = filteredProjects.filter((p) => Boolean(p.archived_at));

  $('#projects-count').textContent = String(activeProjects.length);

  const projectsUl = $('#projects');
  projectsUl.replaceChildren();
  if (activeProjects.length === 0) {
    projectsUl.append(
      el('div', {
        class: 'sidebar-empty',
        text: q ? 'Aucun projet actif trouvé.' : 'Aucun projet actif.',
      }),
    );
  } else {
    for (const p of activeProjects) projectsUl.append(buildProjectItem(p));
  }

  const projToggle = $('#toggle-archived-projects');
  const archProjUl = $('#archived-projects');
  archProjUl.replaceChildren();
  if (archivedProjects.length > 0) {
    projToggle.hidden = false;
    $('#archived-projects-label').textContent = `Projets archivés (${archivedProjects.length})`;
    const showArch = S.showArchivedProjects || Boolean(q) || Boolean(S.project?.archived_at);
    projToggle.classList.toggle('open', showArch);
    archProjUl.hidden = !showArch;
    for (const p of archivedProjects) archProjUl.append(buildProjectItem(p));
  } else {
    projToggle.hidden = true;
    archProjUl.hidden = true;
  }

  // Threads of active project
  const projectMatchesSearch = S.project && q && normSearch(`${S.project.name} ${S.project.id}`).includes(q);
  const filteredThreads =
    q && !projectMatchesSearch
      ? S.threads.filter((t) => normSearch(t.title || 'nouvelle conversation').includes(q))
      : S.threads;

  const activeThreads = filteredThreads.filter((t) => !t.archived_at);
  const archivedThreads = filteredThreads.filter((t) => Boolean(t.archived_at));

  $('#threads-count').textContent = String(activeThreads.length);

  const threadsUl = $('#threads');
  threadsUl.replaceChildren();
  if (!S.project) {
    threadsUl.append(el('div', { class: 'sidebar-empty', text: 'Sélectionne un projet.' }));
  } else if (activeThreads.length === 0) {
    threadsUl.append(
      el('div', {
        class: 'sidebar-empty',
        text: q ? 'Aucune conversation trouvée.' : 'Aucune conversation active.',
      }),
    );
  } else {
    for (const t of activeThreads) threadsUl.append(buildThreadItem(t));
  }

  const threadToggle = $('#toggle-archived-threads');
  const archThreadUl = $('#archived-threads');
  archThreadUl.replaceChildren();
  if (S.project && archivedThreads.length > 0) {
    threadToggle.hidden = false;
    $('#archived-threads-label').textContent = `Conversations archivées (${archivedThreads.length})`;
    const showArchT = S.showArchivedThreads || (Boolean(q) && !projectMatchesSearch) || Boolean(S.thread?.archived_at);
    threadToggle.classList.toggle('open', showArchT);
    archThreadUl.hidden = !showArchT;
    for (const t of archivedThreads) archThreadUl.append(buildThreadItem(t));
  } else {
    threadToggle.hidden = true;
    archThreadUl.hidden = true;
  }
}

$('#toggle-archived-projects')?.addEventListener('click', () => {
  S.showArchivedProjects = !S.showArchivedProjects;
  renderSidebar();
});

$('#toggle-archived-threads')?.addEventListener('click', () => {
  S.showArchivedThreads = !S.showArchivedThreads;
  renderSidebar();
});

$('#sidebar-search')?.addEventListener('input', (e) => {
  S.search = e.target.value;
  renderSidebar();
});

$('#sidebar-search')?.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    e.target.value = '';
    S.search = '';
    renderSidebar();
    e.target.blur();
  }
});

document.addEventListener('keydown', (e) => {
  const tag = document.activeElement?.tagName;
  const inEditable = tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT';
  if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
    e.preventDefault();
    $('#sidebar-search')?.focus();
    $('#sidebar-search')?.select();
  } else if (e.key === '/' && !inEditable && !document.querySelector('dialog[open]')) {
    e.preventDefault();
    $('#sidebar-search')?.focus();
  }
});

// ------------------------------------------------------------------ loading projects & deliverables
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
  syncChannelHeader();
}

async function selectProject(project) {
  S.project = project;
  localStorage.setItem('whatif.lastProject', project.id);
  S.elapsedMs = project.elapsedMs || 0;
  S.startedAt = project.startedAt || null;
  S.threads = await api(`/api/threads?projectId=${encodeURIComponent(project.id)}`);
  S.thread = null;
  detach();
  messagesBox().replaceChildren();
  resetFeedGrouping();
  renderSidebar();
  syncChannelHeader();
  loadDeliverables();
  $('#credits').textContent = `${project.credits ?? 0} cr`;
  updateRunningUI();
  const preferredThread = S.threads.find((t) => !t.archived_at) || S.threads[0] || null;
  if (preferredThread) await selectThread(preferredThread);
  else renderEmptyWorkspace();
}

function syncDeliverablesVisibility() {
  const box = $('#deliverables');
  const btn = $('#deliverables-toggle');
  if (!box || !btn) return;
  if (S.deliverablesCount === 0) {
    box.hidden = true;
    btn.hidden = true;
    return;
  }
  btn.hidden = false;
  $('#deliverables-count').textContent = `${S.deliverablesCount} livrable${S.deliverablesCount > 1 ? 's' : ''}`;
  btn.classList.toggle('active', !S.deliverablesCollapsed);
  box.hidden = S.deliverablesCollapsed;
}

$('#deliverables-toggle')?.addEventListener('click', () => {
  S.deliverablesCollapsed = !S.deliverablesCollapsed;
  syncDeliverablesVisibility();
});

async function loadDeliverables() {
  const box = $('#deliverables');
  if (!S.project || !box) return;
  box.replaceChildren();
  S.deliverablesCount = 0;
  syncDeliverablesVisibility();

  let files = [];
  try {
    ({ files } = await api(`/api/projects/${encodeURIComponent(S.project.id)}/artifacts`));
  } catch {
    return;
  }
  const artifactUrl = (p) => {
    const u = new URL(`/api/file?project=${encodeURIComponent(S.project.id)}&path=${encodeURIComponent(p)}`, location.origin);
    if (S.token) u.searchParams.set('token', S.token);
    return u;
  };
  const finals = files.filter((f) => /-final\.mp4$/.test(f.name)).slice(0, 2);
  const videos = finals.length ? finals : files.filter((f) => f.name.endsWith('.mp4')).slice(0, 1);
  const boards = files.filter((f) => /(storyboard|sheets\/|board\/S\d+|stills)/i.test(f.path) && /\.(jpg|jpeg|png)$/i.test(f.name)).slice(0, 3);
  const report = files.find((f) => f.name === 'report.json');

  for (const v of videos) {
    const urlStr = artifactUrl(v.path).toString();
    box.append(
      el(
        'div',
        { class: 'deliverable' },
        el('video', { src: urlStr, controls: true, preload: 'metadata' }),
        el('a', { href: urlStr, target: '_blank', text: `🎬 ${v.name} · ${(v.size / 1048576).toFixed(1)} Mo` }),
      ),
    );
  }
  for (const b of boards) {
    const urlStr = artifactUrl(b.path).toString();
    box.append(
      el(
        'div',
        { class: 'deliverable' },
        el('img', {
          src: urlStr,
          alt: b.name,
          title: `${b.path} (cliquer pour agrandir)`,
          onclick: () => openLightbox(urlStr, b.path),
        }),
        el('span', { class: 'tag', text: `🖼 ${b.name}` }),
      ),
    );
  }
  if (report) {
    const url = artifactUrl(report.path);
    api(`/api/file?project=${encodeURIComponent(S.project.id)}&path=${encodeURIComponent(report.path)}`)
      .then((r) => {
        const agentSec = r.agent_total_seconds || r.agent_elapsed_seconds || (S.elapsedMs ? S.elapsedMs / 1000 : 0);
        const agentTxt = agentSec ? ` · ⏱ ${fmtDuration(agentSec * 1000)}` : '';
        const txt = `−${Math.abs(r.lufs ?? 0).toFixed(1)} LUFS · ${(r.true_peak_dbtp ?? 0).toFixed(1)} dBTP · ${(r.seconds ?? 0).toFixed(1)}s${agentTxt}`;
        box.append(
          el(
            'div',
            { class: 'deliverable master-card' },
            el('span', { class: 'master-title', text: '✓ Audio Master' }),
            el('span', { class: 'tag', text: txt }),
            el('a', { href: url.toString(), target: '_blank', text: 'report.json ↗' }),
          ),
        );
        S.deliverablesCount = box.children.length;
        syncDeliverablesVisibility();
      })
      .catch(() => {});
  }
  S.deliverablesCount = box.children.length;
  syncDeliverablesVisibility();
}

// ------------------------------------------------------------------ threads & SSE
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
  syncChannelHeader();
  try {
    const pending = await api(`/api/approvals?thread=${encodeURIComponent(thread.id)}`);
    $('#approvals').replaceChildren();
    for (const a of pending) showApproval(a);
  } catch {
    /* older server */
  }
  detach();
  messagesBox().replaceChildren();
  resetFeedGrouping();
  const data = await api(`/api/threads/${thread.id}/messages`);
  if (data.thread) {
    S.thread = { ...thread, ...data.thread };
    syncChannelHeader();
  }
  renderChannelIntro(data.messages.length > 0);
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
  const on = (type, fn) =>
    es.addEventListener(type, (e) => {
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
    // Remove quick prompts once conversation starts
    messagesBox().querySelector('.quick-prompts')?.remove();
    messagesBox().append(messageRow('user', d.text));
    if (S.thread && !S.thread.title) {
      S.thread.title = String(d.text || '').slice(0, 80);
      renderSidebar();
      syncChannelHeader();
    }
    scrollDown();
  });

  on('assistant_delta', (d) => {
    if (!S.live) {
      S.live = messageRow('assistant', '');
      messagesBox().append(S.live);
    }
    const bodyBox = S.live.querySelector('.bubble');
    bodyBox.textContent += d.text;
    scrollDown();
  });

  on('assistant_message', (d) => {
    if (S.live) {
      if (d.text && d.text.trim()) {
        S.live.querySelector('.bubble').innerHTML = md(d.text);
      } else {
        S.live.remove();
      }
      S.live = null;
    } else if (d.text && d.text.trim()) {
      renderMessage({ role: 'assistant', content: d.text, payload: { toolCalls: d.toolCalls } });
    }
    scrollDown();
  });

  on('tool_call', (d) => {
    if (S.live) S.live = null;
    const stepLabel = d.input?.step ? ` (${d.input.step})` : d.input?.path ? ` (${d.input.path})` : '';
    const wrap = toolCard({ name: `${d.name}${stepLabel}`, pending: true, input: d.input });
    const card = wrap.querySelector('details.tool');
    wrap.id = `tool-${d.id}`;
    if (card) {
      card.open = d.name === 'whatif_run';
      card.append(el('pre', { class: 'live-log muted small', text: 'démarrage…' }));
    }
    messagesBox().append(wrap);
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
    const wrap = toolCard({ ...d, name: `${d.name}${stepLabel}`, pending: false });
    const card = wrap.querySelector('details.tool');
    if (card) card.open = !d.ok || Boolean(d.artifacts?.length);
    if (old) old.replaceWith(wrap);
    else messagesBox().append(wrap);
    if (d.artifacts?.length) loadDeliverables();
    scrollDown();
  });

  on('approval_request', (d) => showApproval(d));
  on('approval_decided', (d) => {
    document.querySelectorAll(`[data-approval="${d.id}"]`).forEach((n) => {
      n.querySelector('.status-text').textContent = d.decision === 'approved' ? ' · approuvé' : ' · refusé';
      n.querySelectorAll('button').forEach((b) => (b.disabled = true));
    });
  });

  on('error', (d) => messagesBox().append(el('div', { class: 'think-row', text: `⚠ Erreur : ${d.message}` })));

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
    if (d.running) S.startedAt = d.startedAt || Date.now();
    if (typeof d.elapsedMs === 'number' && d.elapsedMs > 0) S.elapsedMs = d.elapsedMs;
    updateRunningUI();
  });
}

// ------------------------------------------------------------------ approvals
function showApproval({ id, tool, input }) {
  const box = $('#approvals');
  if (box.querySelector(`[data-approval="${id}"]`)) return;
  const node = el(
    'div',
    { class: 'approval', dataset: { approval: id } },
    el('div', {}, el('b', { text: `Autoriser ${tool} ?` }), el('span', { class: 'status-text muted', text: ' · en attente' })),
    el('pre', { class: 'muted small', text: JSON.stringify(input, null, 2) }),
    el(
      'div',
      { class: 'row' },
      el('button', {
        class: 'primary',
        text: 'Autoriser',
        onclick: () => decide(id, true),
      }),
      el('button', { class: 'danger-btn', text: 'Refuser', onclick: () => decide(id, false) }),
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

// ------------------------------------------------------------------ timer & composer
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
    chip.textContent = `✓ ${fmtDuration(S.elapsedMs)}`;
    chip.title = `Temps total pris par l'agent sur le projet ${S.project?.name || ''}`;
  } else {
    chip.hidden = true;
  }
}

function updateRunningUI() {
  $('#stop').hidden = !S.running;
  $('#send').disabled = S.running;
  const hint = $('#composer-hint');
  if (hint) {
    if (S.running) {
      hint.className = 'composer-hint running';
      hint.textContent = '● L’agent travaille sur cet épisode…';
    } else {
      hint.className = 'composer-hint';
      hint.innerHTML = '<kbd>Entrée</kbd> envoyer · <kbd>Maj+Entrée</kbd> nouvelle ligne';
    }
  }
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
  const perProj = S.project ? ` · #${S.project.name}` : '';
  document.title = `${S.running ? '● ' : ''}What If Studio${perProj}`;
}

function autoResizeInput() {
  const input = $('#input');
  if (!input) return;
  input.style.height = 'auto';
  input.style.height = `${Math.min(200, Math.max(46, input.scrollHeight))}px`;
}

$('#input').addEventListener('input', autoResizeInput);

$('#composer').addEventListener('submit', async (e) => {
  e.preventDefault();
  if (!S.project) {
    openNewProject();
    return;
  }
  if (!S.thread) {
    const thread = await api('/api/threads', { method: 'POST', body: JSON.stringify({ projectId: S.project.id }) });
    S.threads = [thread, ...S.threads];
    await selectThread(thread);
  }
  const input = $('#input');
  const text = input.value.trim();
  if (!text) return;
  input.value = '';
  autoResizeInput();
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

// ------------------------------------------------------------------ new project & kickoff
const slugify = (s) =>
  String(s)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48);

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

function populateProviderSelect(selectEl, presets, role = 'agent') {
  if (!selectEl) return;
  selectEl.replaceChildren();
  for (const [key, preset] of Object.entries(presets || {})) {
    const cat = S.catalog[key];
    let text;
    if (cat) {
      const defM = role === 'reviewer' ? cat.defaultReviewerModel : cat.defaultAgentModel;
      text = `${cat.label} — ${defM}`;
    } else {
      text = `${key} — ${preset.model || '(clé requise)'}`;
    }
    selectEl.append(el('option', { value: key, text }));
  }
}

function syncModelControl(provider, role, selectEl, inputEl, desiredValue) {
  const cat = S.catalog[provider];
  if (cat && selectEl) {
    const list = role === 'reviewer' ? cat.reviewer : cat.agent;
    const defVal = role === 'reviewer' ? cat.defaultReviewerModel : cat.defaultAgentModel;
    selectEl.replaceChildren();
    for (const opt of list) {
      selectEl.append(el('option', { value: opt.id, text: `${opt.label} (${opt.id})` }));
    }
    const val = (desiredValue || '').trim();
    const exists = list.some((o) => o.id === val);
    if (val && !exists) {
      selectEl.append(el('option', { value: val, text: `${val} (personnalisé)` }));
    }
    selectEl.value = val && (exists || val) ? val : defVal;
    selectEl.hidden = false;
    if (inputEl) {
      inputEl.hidden = true;
      inputEl.value = selectEl.value;
    }
    selectEl.onchange = () => {
      if (inputEl) inputEl.value = selectEl.value;
    };
  } else {
    if (selectEl) selectEl.hidden = true;
    if (inputEl) {
      inputEl.hidden = false;
      const preset = S.presets[provider];
      inputEl.value = desiredValue ?? preset?.model ?? '';
    }
  }
}

function readModelValue(provider, selectEl, inputEl) {
  if (S.catalog[provider] && selectEl && !selectEl.hidden) return selectEl.value.trim();
  return (inputEl?.value || '').trim();
}

function syncNewProjectModelFields() {
  const mode = $('#np-provider-mode')?.value || '';
  const grid = $('#np-models-grid');
  const agentSel = $('#np-agent-model');
  const revSel = $('#np-rev-model');
  if (!grid || !agentSel || !revSel) return;
  if (!mode || !S.catalog[mode]) {
    grid.hidden = true;
    return;
  }
  grid.hidden = false;
  const cat = S.catalog[mode];
  agentSel.replaceChildren(...cat.agent.map((o) => el('option', { value: o.id, text: `${o.label}` })));
  revSel.replaceChildren(...cat.reviewer.map((o) => el('option', { value: o.id, text: `${o.label}` })));
  agentSel.value = cat.defaultAgentModel;
  revSel.value = cat.defaultReviewerModel;
}

$('#np-provider-mode')?.addEventListener('change', syncNewProjectModelFields);

function openNewProject() {
  if (location.hash === '#nouveau') location.hash = '';
  $('#np-name').value = '';
  $('#np-episode').value = '';
  $('#np-episode').dataset.touched = '';
  $('#np-video').value = '';
  if ($('#np-aspect')) $('#np-aspect').value = '16:9';
  if ($('#np-provider-mode')) $('#np-provider-mode').value = '';
  syncNewProjectModelFields();
  $('#np-kick').checked = true;
  $('#new-project-dialog').showModal();
  setTimeout(() => $('#np-name')?.focus(), 40);
}

if (location.hash === '#nouveau') setTimeout(openNewProject, 300);

$('#new-project').addEventListener('click', openNewProject);

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
  const npProvider = ($('#np-provider-mode')?.value || '').trim();
  if (!name) return;
  const dialog = $('#new-project-dialog');
  const button = $('#np-create');
  button.disabled = true;
  button.textContent = 'Création…';
  try {
    const body = {
      name,
      id: slugify(name),
      ...(episode ? { episode } : {}),
      ...(video ? { video } : {}),
      aspect,
      ...(npProvider
        ? {
            provider: npProvider,
            model: $('#np-agent-model')?.value || '',
            reviewProvider: npProvider,
            reviewModel: $('#np-rev-model')?.value || '',
          }
        : {}),
    };
    const { project, tool } = await api('/api/projects', { method: 'POST', body: JSON.stringify(body) });
    dialog.close();
    await loadProjects();
    const enriched = S.projects.find((p) => p.id === project.id) || project;
    await selectProject(enriched);
    const thread = await api('/api/threads', {
      method: 'POST',
      body: JSON.stringify({ projectId: project.id, title: episode || 'Conversation principale' }),
    });
    S.threads = [thread, ...S.threads];
    await selectThread(thread);
    if (tool && !tool.ok) messagesBox().append(el('div', { class: 'think-row', text: `Scaffold : ${tool.summary}` }));
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
    button.textContent = 'Créer le projet';
  }
});

$('#new-project-dialog').addEventListener('click', (e) => {
  if (e.target.id === 'new-project-dialog') e.target.close();
});

$('#new-thread').addEventListener('click', async () => {
  if (!S.project) return;
  const thread = await api('/api/threads', { method: 'POST', body: JSON.stringify({ projectId: S.project.id }) });
  S.threads = [thread, ...S.threads];
  await selectThread(thread);
  $('#input')?.focus();
});

// ------------------------------------------------------------------ settings & per-project models
function formatModelSummary(s) {
  const rev = s.reviewer?.model ? ` · rev: ${s.reviewer.model}` : '';
  return `${s.provider} · ${s.model}${rev}`;
}

function syncSettingsApiKeyVisibility() {
  const p1 = $('#s-provider')?.value || '';
  const p2 = $('#s-rev-provider')?.value || '';
  const noApiNeeded = (p) => p === 'codex' || p === 'agy' || p === 'mock';
  const hideExtra = noApiNeeded(p1) && noApiNeeded(p2);
  if ($('#s-baseurl-wrap')) $('#s-baseurl-wrap').hidden = p1 === 'agy' || p1 === 'mock';
  if ($('#s-key-wrap')) $('#s-key-wrap').hidden = hideExtra;
}

async function openSettings() {
  const s = await api('/api/settings');
  S.settings = s;
  S.presets = s.presets || S.presets;
  if (s.catalog) S.catalog = s.catalog;

  const select = $('#s-provider');
  const revSelect = $('#s-rev-provider');
  populateProviderSelect(select, S.presets, 'agent');
  populateProviderSelect(revSelect, S.presets, 'reviewer');

  select.value = s.provider;
  const revProv = s.reviewer?.provider || s.provider;
  if (revSelect) revSelect.value = revProv;

  syncModelControl(s.provider, 'agent', $('#s-model-select'), $('#s-model'), s.model);
  syncModelControl(revProv, 'reviewer', $('#s-rev-model-select'), $('#s-rev-model'), s.reviewer?.model || '');

  if ($('#s-theme')) $('#s-theme').value = S.theme;
  $('#s-baseurl').value = s.baseURL || '';
  $('#s-key').value = '';
  $('#s-key').placeholder =
    s.provider === 'codex' || s.provider === 'agy' ? '(session OAuth locale — aucune clé requise)' : s.hasKey ? '(clé enregistrée)' : 'sk-…';
  $('#s-token').value = S.token;
  syncSettingsApiKeyVisibility();

  const codexStatus = $('#s-codex-status');
  if (codexStatus) {
    codexStatus.hidden = false;
    codexStatus.textContent = s.codexReady
      ? '✓ Codex prêt (~/.codex/auth.json) — choix : gpt-6.1-terra ou gpt-6.1-sol (Agent & Reviewer).'
      : 'Session Codex absente : lance « codex login » sur la machine hôte pour activer ton abonnement ChatGPT.';
  }
  const agyStatus = $('#s-agy-status');
  if (agyStatus) {
    agyStatus.hidden = false;
    agyStatus.textContent = s.agyReady
      ? '✓ Binaire Google Antigravity (agy) détecté — Agent : 3.8-flash-medium / carbon-low / argon-low · Reviewer : argon-medium / carbon-medium.'
      : 'Binaire agy non détecté dans le conteneur : vérifie ~/.local/bin/agy.';
  }
  $('#s-skill').textContent = `skill : ${s.skillDir || 'introuvable (WHATIF_SKILL_DIR)'}`;
  $('#settings').showModal();
}

$('#s-provider').addEventListener('change', () => {
  const key = $('#s-provider').value;
  const preset = S.presets[key];
  if (preset) $('#s-baseurl').value = preset.baseURL || '';
  syncModelControl(key, 'agent', $('#s-model-select'), $('#s-model'), S.catalog[key]?.defaultAgentModel || preset?.model || '');
  syncSettingsApiKeyVisibility();
});

$('#s-rev-provider')?.addEventListener('change', () => {
  const key = $('#s-rev-provider').value;
  const preset = S.presets[key];
  syncModelControl(key, 'reviewer', $('#s-rev-model-select'), $('#s-rev-model'), S.catalog[key]?.defaultReviewerModel || preset?.reviewModel || preset?.model || '');
  syncSettingsApiKeyVisibility();
});

$('#settings-btn').addEventListener('click', openSettings);
$('#model-btn')?.addEventListener('click', openSettings);

$('#settings').addEventListener('click', (e) => {
  if (e.target.id === 'settings') e.target.close();
});

$('#s-save').addEventListener('click', async (e) => {
  e.preventDefault();
  if ($('#s-theme')) applyTheme($('#s-theme').value);
  const token = $('#s-token').value.trim();
  S.token = token;
  localStorage.setItem('whatif.token', token);
  const prov = $('#s-provider').value;
  const revProv = $('#s-rev-provider')?.value || prov;
  const revPreset = S.presets[revProv];
  const agentModel = readModelValue(prov, $('#s-model-select'), $('#s-model'));
  const revModel = readModelValue(revProv, $('#s-rev-model-select'), $('#s-rev-model'));
  await api('/api/settings', {
    method: 'POST',
    body: JSON.stringify({
      provider: prov,
      baseURL: $('#s-baseurl').value,
      model: agentModel,
      reviewProvider: revProv,
      reviewBaseURL: revProv === prov ? $('#s-baseurl').value : revPreset?.baseURL || '',
      reviewModel: revModel,
      apiKey: $('#s-key').value,
    }),
  });
  $('#settings').close();
  const s = await api('/api/settings');
  S.settings = s;
  $('#model').textContent = formatModelSummary(s);
  await loadProjects();
});

// ---- Per-project model dialog
function syncProjectModelModeUI() {
  const isCustom = $('#pm-mode')?.value === 'custom';
  $('#pm-custom-fields')?.classList.toggle('disabled', !isCustom);
}

async function openProjectModelDialog() {
  if (!S.project) return;
  if (!S.settings || !Object.keys(S.presets || {}).length) {
    const s = await api('/api/settings');
    S.settings = s;
    S.presets = s.presets || {};
    if (s.catalog) S.catalog = s.catalog;
  }
  $('#pm-title').textContent = `Modèles du projet #${S.project.name}`;
  populateProviderSelect($('#pm-provider'), S.presets, 'agent');
  populateProviderSelect($('#pm-rev-provider'), S.presets, 'reviewer');

  const hasCustom = Boolean(S.project.provider || S.project.model || S.project.review_provider || S.project.review_model);
  $('#pm-mode').value = hasCustom ? 'custom' : 'inherit';

  const eff = S.project.effectiveModel || {};
  const prov = S.project.provider || eff.provider || S.settings?.provider || 'codex';
  const model = S.project.model || eff.model || S.settings?.model || '';
  const revProv = S.project.review_provider || eff.reviewProvider || S.settings?.reviewer?.provider || prov;
  const revModel = S.project.review_model || eff.reviewModel || S.settings?.reviewer?.model || '';

  $('#pm-provider').value = prov;
  $('#pm-rev-provider').value = revProv;
  syncModelControl(prov, 'agent', $('#pm-model-select'), $('#pm-model'), model);
  syncModelControl(revProv, 'reviewer', $('#pm-rev-model-select'), $('#pm-rev-model'), revModel);
  syncProjectModelModeUI();
  $('#project-model-dialog').showModal();
}

$('#pm-mode')?.addEventListener('change', syncProjectModelModeUI);
$('#pm-provider')?.addEventListener('change', () => {
  const key = $('#pm-provider').value;
  const preset = S.presets[key];
  syncModelControl(key, 'agent', $('#pm-model-select'), $('#pm-model'), S.catalog[key]?.defaultAgentModel || preset?.model || '');
});
$('#pm-rev-provider')?.addEventListener('change', () => {
  const key = $('#pm-rev-provider').value;
  const preset = S.presets[key];
  syncModelControl(key, 'reviewer', $('#pm-rev-model-select'), $('#pm-rev-model'), S.catalog[key]?.defaultReviewerModel || preset?.reviewModel || preset?.model || '');
});
$('#project-model-btn')?.addEventListener('click', openProjectModelDialog);
$('#project-model-dialog')?.addEventListener('click', (e) => {
  if (e.target.id === 'project-model-dialog') e.target.close();
});
$('#pm-save')?.addEventListener('click', async (e) => {
  e.preventDefault();
  if (!S.project) return;
  const isCustom = $('#pm-mode').value === 'custom';
  const prov = $('#pm-provider').value;
  const revProv = $('#pm-rev-provider').value;
  const patch = isCustom
    ? {
        provider: prov,
        model: readModelValue(prov, $('#pm-model-select'), $('#pm-model')),
        reviewProvider: revProv,
        reviewModel: readModelValue(revProv, $('#pm-rev-model-select'), $('#pm-rev-model')),
      }
    : { provider: null, model: null, reviewProvider: null, reviewModel: null };

  const updated = await api(`/api/projects/${encodeURIComponent(S.project.id)}`, {
    method: 'PATCH',
    body: JSON.stringify(patch),
  });
  S.projects = S.projects.map((p) => (p.id === updated.id ? updated : p));
  S.project = updated;
  $('#project-model-dialog').close();
  renderSidebar();
  syncChannelHeader();
});

// ------------------------------------------------------------------ boot
(async function boot() {
  try {
    const s = await api('/api/settings');
    S.settings = s;
    S.presets = s.presets || S.presets;
    if (s.catalog) S.catalog = s.catalog;
    $('#model').textContent = formatModelSummary(s);
    if (!s.skillDir) $('#model').title = 'WHATIF_SKILL_DIR introuvable : le scaffold et les scripts ne marcheront pas';
    await loadProjects();
    if (S.projects.length) {
      const savedId = localStorage.getItem('whatif.lastProject');
      const ordered = sortedProjects(S.projects);
      const initial =
        ordered.find((p) => p.id === savedId && !p.archived_at) ||
        ordered.find((p) => !p.archived_at) ||
        ordered[0];
      await selectProject(initial);
    } else {
      renderEmptyWorkspace();
    }
  } catch (e) {
    messagesBox().append(
      el('div', { class: 'think-row', text: `Connexion impossible : ${e.message}. Si le serveur exige un token, ouvre ⚙.` }),
    );
  }
  updateRunningUI();
})();
