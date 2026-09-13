// ===== PWA: service worker registration (skip inside Electron / file://) =====
if ('serviceWorker' in navigator && (location.protocol === 'http:' || location.protocol === 'https:')) {
  window.addEventListener('load', () => {
    navigator.serviceWorker
      .register('./sw.js')
      .then((reg) => console.log('[PWA] SW registered:', reg.scope))
      .catch((err) => console.error('[PWA] SW failed:', err));
  });
}

// ===== Theme (light / dark only — no custom colors) =====
const THEME_KEY = 'theme';
function getTheme() {
  const stored = localStorage.getItem(THEME_KEY);
  if (stored === 'light' || stored === 'dark') return stored;
  return (window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches) ? 'dark' : 'light';
}
function applyTheme(mode) {
  document.documentElement.setAttribute('data-theme', mode === 'dark' ? 'dark' : 'light');
  localStorage.setItem(THEME_KEY, mode);
  const lightBtn = document.getElementById('theme-light-btn');
  const darkBtn = document.getElementById('theme-dark-btn');
  if (lightBtn && darkBtn) {
    lightBtn.classList.toggle('active', mode !== 'dark');
    darkBtn.classList.toggle('active', mode === 'dark');
  }
}
document.getElementById('theme-light-btn').addEventListener('click', () => applyTheme('light'));
document.getElementById('theme-dark-btn').addEventListener('click', () => applyTheme('dark'));

function renderSettingsUI() {
  applyTheme(getTheme());
  document.getElementById('closeout-time-input').value = getCloseoutTime();
  document.getElementById('closeout-enabled-input').checked = isCloseoutEnabled();
  document.getElementById('tips-enabled-input').checked = areTipsEnabled();
  document.getElementById('encouragement-enabled-input').checked = isEncouragementEnabled();
  document.getElementById('notifications-enabled-input').checked = isNotifEnabled();
  updateNotifPermissionHint();
  renderAccountSection();
}

// ===== Account section (Settings) =====
const accountStatusEl = document.getElementById('account-status');
const accountSignoutBtn = document.getElementById('account-signout-btn');
const accountSwitchBtn = document.getElementById('account-switch-btn');

function renderAccountSection() {
  if (currentUser) {
    accountStatusEl.textContent = `Signed in as ${currentUser.email}. Your tasks, notes and events sync to your account.`;
    accountSignoutBtn.style.display = 'inline-block';
    accountSwitchBtn.style.display = 'none';
  } else if (isGuest) {
    accountStatusEl.textContent = supabaseReady
      ? "You're using Aschertype without an account. Data is stored on this device only."
      : "Accounts aren't configured on this deployment yet — data is stored on this device only.";
    accountSignoutBtn.style.display = 'none';
    accountSwitchBtn.style.display = supabaseReady ? 'inline-block' : 'none';
  } else {
    accountStatusEl.textContent = 'Checking account…';
    accountSignoutBtn.style.display = 'none';
    accountSwitchBtn.style.display = 'none';
  }
}
accountSignoutBtn.addEventListener('click', signOutAndReset);
accountSwitchBtn.addEventListener('click', () => {
  sessionStorage.removeItem('aschertypeGuest');
  location.reload();
});

// ===== Focus mode =====
let savedTheme = null;
function setFocusMode(on) {
  const root = document.documentElement;
  if (on) {
    if (!document.body.classList.contains('focus-mode')) {
      savedTheme = {
        bg: root.style.getPropertyValue('--bg'), panel: root.style.getPropertyValue('--panel'),
        card: root.style.getPropertyValue('--card'), border: root.style.getPropertyValue('--border'),
        ink: root.style.getPropertyValue('--ink'), inkLight: root.style.getPropertyValue('--ink-light'),
        accentSoft: root.style.getPropertyValue('--accent-soft'),
      };
    }
    document.body.classList.add('focus-mode');
    root.style.setProperty('--bg', '#121212');
    root.style.setProperty('--panel', '#161616');
    root.style.setProperty('--card', '#1c1c1c');
    root.style.setProperty('--border', '#2a2a2a');
    root.style.setProperty('--ink', '#f5f5f5');
    root.style.setProperty('--ink-light', '#a0a0a0');
    root.style.setProperty('--accent-soft', 'rgba(255,255,255,0.08)');
  } else {
    document.body.classList.remove('focus-mode');
    if (savedTheme) {
      root.style.setProperty('--bg', savedTheme.bg);
      root.style.setProperty('--panel', savedTheme.panel);
      root.style.setProperty('--card', savedTheme.card);
      root.style.setProperty('--border', savedTheme.border);
      root.style.setProperty('--ink', savedTheme.ink);
      root.style.setProperty('--ink-light', savedTheme.inkLight);
      root.style.setProperty('--accent-soft', savedTheme.accentSoft);
    }
  }
}

// ===== Mobile sidebar toggle =====
const sidebar = document.getElementById('sidebar');
const sidebarBackdrop = document.getElementById('sidebar-backdrop');
const menuToggle = document.getElementById('menu-toggle');
function openSidebar() { sidebar.classList.add('open'); sidebarBackdrop.classList.add('show'); }
function closeSidebar() { sidebar.classList.remove('open'); sidebarBackdrop.classList.remove('show'); }
menuToggle.addEventListener('click', () => {
  sidebar.classList.contains('open') ? closeSidebar() : openSidebar();
});
sidebarBackdrop.addEventListener('click', closeSidebar);

// ===== Encouragement toasts =====
const ENCOURAGEMENT_KEY = 'encouragementEnabled';
function isEncouragementEnabled() {
  const v = localStorage.getItem(ENCOURAGEMENT_KEY);
  return v === null ? true : v === 'true';
}
function setEncouragementEnabled(on) { localStorage.setItem(ENCOURAGEMENT_KEY, on ? 'true' : 'false'); }

const ENCOURAGEMENT_MESSAGES = {
  add: [
    { emoji: '📝', text: 'Added. One less thing to hold in your head.' },
    { emoji: '✨', text: "Nice — that's on the list now, not just in your mind." },
    { emoji: '🌱', text: 'Small step logged. That counts.' },
    { emoji: '👍', text: "Got it. You're staying ahead of it." },
  ],
  complete: [
    { emoji: '🎉', text: 'Done! Nice work.' },
    { emoji: '✅', text: 'Checked off — that feels good, right?' },
    { emoji: '💪', text: "One more finished. You're on a roll." },
    { emoji: '🙌', text: 'Nicely done. Onto the next.' },
  ],
  note: [
    { emoji: '🗒️', text: 'Saved — future you will thank you.' },
    { emoji: '💡', text: 'Good thought, safely stored.' },
  ],
  event: [
    { emoji: '📅', text: "Added to your calendar. It's handled." },
    { emoji: '🕒', text: "Saved. One less date to remember." },
  ],
  pomodoro: [
    { emoji: '🍅', text: 'Focus session complete — take a real break.' },
    { emoji: '🌤️', text: "That's a solid stretch of deep work. Well done." },
  ],
  closeout: [
    { emoji: '🌙', text: "That's a wrap. Whatever's left will keep till tomorrow." },
    { emoji: '🕯️', text: 'Closeout done — go rest, you earned it.' },
  ],
};
function pickRandom(arr) { return arr[Math.floor(Math.random() * arr.length)]; }

const toastContainer = document.getElementById('toast-container');
function showToast(category) {
  if (!isEncouragementEnabled()) return;
  const pool = ENCOURAGEMENT_MESSAGES[category] || ENCOURAGEMENT_MESSAGES.add;
  const msg = pickRandom(pool);
  const el = document.createElement('div');
  el.className = 'toast';
  el.innerHTML = `<span class="toast-emoji">${msg.emoji}</span><span>${escapeHtml(msg.text)}</span>`;
  toastContainer.appendChild(el);
  setTimeout(() => {
    el.classList.add('leaving');
    setTimeout(() => el.remove(), 320);
  }, 3200);
}
document.getElementById('encouragement-enabled-input').addEventListener('change', (e) => {
  setEncouragementEnabled(e.target.checked);
});

// ===== Notifications (events & pomodoro) =====
const NOTIF_ENABLED_KEY = 'notificationsEnabled';
function isNotifEnabled() {
  const v = localStorage.getItem(NOTIF_ENABLED_KEY);
  return v === null ? true : v === 'true';
}
function setNotifEnabled(on) { localStorage.setItem(NOTIF_ENABLED_KEY, on ? 'true' : 'false'); }

const notifPermissionHintEl = document.getElementById('notif-permission-hint');
function updateNotifPermissionHint() {
  if (!notifPermissionHintEl) return;
  if (!('Notification' in window)) { notifPermissionHintEl.textContent = 'Not supported here — in-app alerts will show instead'; return; }
  if (Notification.permission === 'granted') notifPermissionHintEl.textContent = 'System alerts allowed';
  else if (Notification.permission === 'denied') notifPermissionHintEl.textContent = 'Blocked — using in-app alerts instead';
  else notifPermissionHintEl.textContent = "We'll ask permission when needed";
}
function requestNotifPermissionIfNeeded() {
  if (!isNotifEnabled()) return;
  if ('Notification' in window && Notification.permission === 'default') {
    Notification.requestPermission().then(updateNotifPermissionHint);
  } else {
    updateNotifPermissionHint();
  }
}
function sendNotification(title, body) {
  if (!isNotifEnabled()) return;
  if ('Notification' in window && Notification.permission === 'granted') {
    try { new Notification(title, { body }); return; } catch (err) { /* fall through to in-app */ }
  }
  const el = document.createElement('div');
  el.className = 'toast notif';
  el.innerHTML = `<span class="toast-dot"></span><span><strong>${escapeHtml(title)}</strong><br>${escapeHtml(body)}</span>`;
  toastContainer.appendChild(el);
  setTimeout(() => {
    el.classList.add('leaving');
    setTimeout(() => el.remove(), 320);
  }, 4200);
}
document.getElementById('notifications-enabled-input').addEventListener('change', (e) => {
  setNotifEnabled(e.target.checked);
  if (e.target.checked) requestNotifPermissionIfNeeded();
  updateNotifPermissionHint();
});

let notifiedEventKeys = new Set();
let notifiedEventDay = todayStr();
function checkEventNotifications() {
  if (!isNotifEnabled()) return;
  if (notifiedEventDay !== todayStr()) { notifiedEventKeys.clear(); notifiedEventDay = todayStr(); }
  const now = new Date();
  const nowHM = `${pad2(now.getHours())}:${pad2(now.getMinutes())}`;
  const soon = new Date(now.getTime() + 5 * 60000);
  const soonHM = `${pad2(soon.getHours())}:${pad2(soon.getMinutes())}`;
  const today = todayStr();
  events.forEach(ev => {
    if (ev.date !== today || !ev.time) return;
    const soonKey = `soon:${ev.id}`;
    const startKey = `start:${ev.id}`;
    if (ev.time === soonHM && !notifiedEventKeys.has(soonKey)) {
      notifiedEventKeys.add(soonKey);
      sendNotification('Coming up in 5 minutes', ev.title);
    }
    if (ev.time === nowHM && !notifiedEventKeys.has(startKey)) {
      notifiedEventKeys.add(startKey);
      sendNotification('Starting now', ev.title);
    }
  });
}
setInterval(checkEventNotifications, 30 * 1000);

// ===== Tips & tricks bar =====
const LOCAL_TIPS = [
  'Write tomorrow\'s top 3 tasks tonight — it quiets the mind before sleep.',
  'A 4-7-8 breath (inhale 4, hold 7, exhale 8) can take the edge off a stressful moment.',
  'Batch small tasks together; context-switching is more tiring than the tasks themselves.',
  'Standing up and stretching for 60 seconds every hour keeps focus sharper for longer.',
  'Try the two-minute rule: if it takes under two minutes, do it now instead of listing it.',
  'A short walk outside resets attention better than scrolling during a break.',
  'Naming what you\'re feeling ("I\'m anxious about X") tends to lower its intensity.',
  'Single-tasking beats multitasking for both speed and quality on focused work.',
  'Keep a "done" list next to your to-do list — it\'s good for morale on hard days.',
  'Drink a glass of water before reaching for more coffee; mild dehydration mimics fatigue.',
  'Progress, not perfection — a rough draft finished beats a perfect draft postponed.',
  'Silence notifications during focus blocks; even a glance costs several minutes to recover from.',
  'When overwhelmed, write everything down first, then sort — it moves the load out of your head.',
  'A tidy desk for the next morning makes it easier to start work with a clear head.',
  'Take real breaks: stepping away from the screen restores focus better than switching tabs.',
];
let lastTipIndex = -1;
function localTip() {
  let i = Math.floor(Math.random() * LOCAL_TIPS.length);
  if (LOCAL_TIPS.length > 1) { while (i === lastTipIndex) i = Math.floor(Math.random() * LOCAL_TIPS.length); }
  lastTipIndex = i;
  return LOCAL_TIPS[i];
}

const TIPS_KEY = 'tipsEnabled';
function areTipsEnabled() {
  const v = localStorage.getItem(TIPS_KEY);
  return v === null ? true : v === 'true';
}
function setTipsEnabled(on) {
  localStorage.setItem(TIPS_KEY, on ? 'true' : 'false');
  document.getElementById('tips-bar').style.display = on ? 'flex' : 'none';
}

const tipsTextEl = document.getElementById('tips-text');
const tipsBarEl = document.getElementById('tips-bar');

async function fetchOnlineTip() {
  if (typeof navigator !== 'undefined' && navigator.onLine === false) return null;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 3500);
  try {
    const res = await fetch('https://api.quotable.io/random?tags=inspirational|wisdom', { signal: controller.signal });
    clearTimeout(timeout);
    if (!res.ok) return null;
    const data = await res.json();
    if (data && data.content) return `${data.content}${data.author ? ' — ' + data.author : ''}`;
    return null;
  } catch (err) {
    clearTimeout(timeout);
    return null;
  }
}

async function refreshTip() {
  if (!areTipsEnabled()) return;
  tipsTextEl.textContent = 'Finding a tip…';
  const online = await fetchOnlineTip();
  tipsTextEl.textContent = online || localTip();
}
document.getElementById('tips-refresh-btn').addEventListener('click', refreshTip);
document.getElementById('tips-enabled-input').addEventListener('change', (e) => {
  setTipsEnabled(e.target.checked);
  if (e.target.checked) refreshTip();
});

// ===== Pomodoro =====
const pomodoro = {
  task: localStorage.getItem('pomodoroTask') || '',
  workMin: parseInt(localStorage.getItem('pomodoroWorkMin')) || 25,
  breakMin: parseInt(localStorage.getItem('pomodoroBreakMin')) || 5,
  mode: 'work', remaining: 0, running: false,
  sessions: parseInt(localStorage.getItem('pomodoroSessions')) || 0,
};
pomodoro.remaining = pomodoro.workMin * 60;
let pomodoroInterval = null;

const pomodoroTaskInput = document.getElementById('pomodoro-task');
const pomodoroTimerEl = document.getElementById('pomodoro-timer');
const pomodoroModeLabel = document.getElementById('pomodoro-mode-label');
const pomodoroStartBtn = document.getElementById('pomodoro-start');
const pomodoroPauseBtn = document.getElementById('pomodoro-pause');
const pomodoroResetBtn = document.getElementById('pomodoro-reset');
const pomodoroWorkInput = document.getElementById('pomodoro-work-min');
const pomodoroBreakInput = document.getElementById('pomodoro-break-min');
const pomodoroSessionsEl = document.getElementById('pomodoro-sessions');

function formatTime(sec) {
  const m = Math.floor(sec / 60).toString().padStart(2, '0');
  const s = Math.floor(sec % 60).toString().padStart(2, '0');
  return `${m}:${s}`;
}
function renderPomodoro() {
  pomodoroTimerEl.textContent = formatTime(pomodoro.remaining);
  pomodoroModeLabel.textContent = pomodoro.mode === 'work' ? 'Focus session' : 'Break time';
  pomodoroSessionsEl.textContent = pomodoro.sessions;
  pomodoroStartBtn.disabled = pomodoro.running;
  pomodoroPauseBtn.disabled = !pomodoro.running;
  pomodoroWorkInput.value = pomodoro.workMin;
  pomodoroBreakInput.value = pomodoro.breakMin;
  pomodoroTaskInput.value = pomodoro.task;
}
let pomodoroWarned = false;
function tickPomodoro() {
  pomodoro.remaining--;
  if (pomodoro.remaining === 60 && !pomodoroWarned) {
    pomodoroWarned = true;
    sendNotification(
      pomodoro.mode === 'work' ? 'Almost there' : 'Break ending soon',
      pomodoro.mode === 'work' ? 'One minute left in your focus session.' : 'One minute left in your break.'
    );
  }
  if (pomodoro.remaining <= 0) {
    clearInterval(pomodoroInterval); pomodoroInterval = null; pomodoro.running = false;
    pomodoroWarned = false;
    if (pomodoro.mode === 'work') {
      pomodoro.sessions++;
      localStorage.setItem('pomodoroSessions', pomodoro.sessions);
      pomodoro.mode = 'break'; pomodoro.remaining = pomodoro.breakMin * 60;
      sendNotification('Focus session complete', `Nice work. Time for a ${pomodoro.breakMin}-minute break.`);
      showToast('pomodoro');
    } else {
      pomodoro.mode = 'work'; pomodoro.remaining = pomodoro.workMin * 60;
      sendNotification("Break's over", 'Ready for another focus session whenever you are.');
    }
    setFocusMode(false); renderPomodoro();
    return;
  }
  pomodoroTimerEl.textContent = formatTime(pomodoro.remaining);
}
pomodoroStartBtn.addEventListener('click', () => {
  if (pomodoro.running) return;
  pomodoro.running = true;
  pomodoroInterval = setInterval(tickPomodoro, 1000);
  if (pomodoro.mode === 'work') setFocusMode(true);
  renderPomodoro();
});
pomodoroPauseBtn.addEventListener('click', () => {
  if (!pomodoro.running) return;
  clearInterval(pomodoroInterval); pomodoroInterval = null; pomodoro.running = false;
  setFocusMode(false); renderPomodoro();
});
pomodoroResetBtn.addEventListener('click', () => {
  clearInterval(pomodoroInterval); pomodoroInterval = null; pomodoro.running = false;
  pomodoroWarned = false;
  pomodoro.mode = 'work'; pomodoro.remaining = pomodoro.workMin * 60;
  setFocusMode(false); renderPomodoro();
});
pomodoroTaskInput.addEventListener('input', (e) => {
  pomodoro.task = e.target.value;
  localStorage.setItem('pomodoroTask', pomodoro.task);
});
pomodoroWorkInput.addEventListener('change', (e) => {
  const v = Math.min(Math.max(parseInt(e.target.value) || 25, 1), 120);
  pomodoro.workMin = v; localStorage.setItem('pomodoroWorkMin', v);
  if (!pomodoro.running && pomodoro.mode === 'work') { pomodoro.remaining = v * 60; renderPomodoro(); }
});
pomodoroBreakInput.addEventListener('change', (e) => {
  const v = Math.min(Math.max(parseInt(e.target.value) || 5, 1), 60);
  pomodoro.breakMin = v; localStorage.setItem('pomodoroBreakMin', v);
  if (!pomodoro.running && pomodoro.mode === 'break') { pomodoro.remaining = v * 60; renderPomodoro(); }
});

// ===== Task state =====
let todos = JSON.parse(localStorage.getItem('todos') || '[]');
let currentView = 'all';

const form = document.getElementById('todo-form');
const input = document.getElementById('todo-input');
const descInput = document.getElementById('desc-input');
const dueInput = document.getElementById('due-input');
const priorityInput = document.getElementById('priority-input');
const todoListEl = document.getElementById('todo-list');
const emptyState = document.getElementById('empty-state');
const viewTitle = document.getElementById('view-title');
const viewSubtitle = document.getElementById('view-subtitle');
const clearBtn = document.getElementById('clear-completed');
const allTasksBtn = document.getElementById('all-tasks-btn');
const allChevron = document.getElementById('all-chevron');
const allSubnav = document.getElementById('all-subnav');
const navItems = document.querySelectorAll('.nav-item');

// ===== Projects =====
// A project just groups todos together (todo.projectId -> project.id).
// Kept deliberately simple: no nesting, no per-project settings.
let projects = JSON.parse(localStorage.getItem('projects') || '[]');
let currentProjectId = null; // set when currentView === 'project'

const projectNavListEl = document.getElementById('project-nav-list');
const projectEmptyHintEl = document.getElementById('project-empty-hint');
const addProjectBtn = document.getElementById('add-project-btn');
const projectSelectEl = document.getElementById('todo-project-select');
const projectHeaderActions = document.getElementById('project-header-actions');
const projectRenameBtn = document.getElementById('project-rename-btn');
const projectDeleteBtn = document.getElementById('project-delete-btn');

const projectModalOverlay = document.getElementById('project-modal-overlay');
const projectModalTitle = document.getElementById('project-modal-title');
const projectNameInput = document.getElementById('project-name-input');
const projectModalSaveBtn = document.getElementById('project-modal-save-btn');
const projectModalCancelBtn = document.getElementById('project-modal-cancel-btn');
const projectModalCloseBtn = document.getElementById('project-modal-close-btn');

let editingProjectId = null; // non-null => modal is renaming, not creating

function saveProjects() { localStorage.setItem('projects', JSON.stringify(projects)); }
function getProject(id) { return projects.find(p => p.id === id) || null; }

function openProjectModal(existingProject = null) {
  editingProjectId = existingProject ? existingProject.id : null;
  projectModalTitle.textContent = existingProject ? 'Rename project' : 'New project';
  projectNameInput.value = existingProject ? existingProject.name : '';
  projectModalOverlay.style.display = 'flex';
  setTimeout(() => projectNameInput.focus(), 30);
}
function closeProjectModal() { projectModalOverlay.style.display = 'none'; editingProjectId = null; }

addProjectBtn.addEventListener('click', () => openProjectModal());
projectModalCancelBtn.addEventListener('click', closeProjectModal);
projectModalCloseBtn.addEventListener('click', closeProjectModal);
projectModalOverlay.addEventListener('click', (e) => { if (e.target === projectModalOverlay) closeProjectModal(); });

projectModalSaveBtn.addEventListener('click', () => {
  const name = projectNameInput.value.trim();
  if (!name) { projectNameInput.focus(); return; }
  if (editingProjectId) {
    const p = getProject(editingProjectId);
    if (p) {
      p.name = name;
      saveProjects();
      if (currentUser) dbUpsert('projects', projectRemoteRow(p));
    }
  } else {
    const p = { id: Date.now(), name };
    projects.push(p);
    saveProjects();
    if (currentUser) dbUpsert('projects', projectRemoteRow(p));
  }
  closeProjectModal();
  renderProjectNav();
  renderProjectSelect();
  if (currentView === 'project') { renderViewHeader(); renderTodos(); }
});

function deleteProject(id) {
  projects = projects.filter(p => p.id !== id);
  // Unassign (not delete) any tasks that belonged to this project.
  let touched = [];
  todos.forEach(t => { if (t.projectId === id) { t.projectId = null; touched.push(t); } });
  saveProjects();
  saveTodos();
  if (currentUser) {
    dbDelete('projects', id, currentUser.id);
    touched.forEach(t => dbUpsert('todos', todoRemoteRow(t)));
  }
}
projectDeleteBtn.addEventListener('click', () => {
  if (!currentProjectId) return;
  const p = getProject(currentProjectId);
  if (!p) return;
  if (!confirm(`Delete "${p.name}"? Tasks in it will be kept but unassigned from the project.`)) return;
  deleteProject(currentProjectId);
  setView('all');
});
projectRenameBtn.addEventListener('click', () => {
  const p = getProject(currentProjectId);
  if (p) openProjectModal(p);
});

function renderProjectNav() {
  projectNavListEl.innerHTML = '';
  projectEmptyHintEl.style.display = projects.length ? 'none' : 'block';
  projects.forEach(p => {
    const btn = document.createElement('button');
    btn.className = 'nav-item' + (currentView === 'project' && currentProjectId === p.id ? ' active' : '');
    btn.dataset.view = 'project';
    btn.dataset.projectId = p.id;
    const dot = document.createElement('span');
    dot.className = 'project-nav-dot';
    const label = document.createElement('span');
    label.className = 'nav-label';
    label.textContent = p.name;
    const count = document.createElement('span');
    count.className = 'nav-count';
    count.textContent = todos.filter(t => t.projectId === p.id).length;
    btn.append(dot, label, count);
    btn.addEventListener('click', () => { currentProjectId = p.id; setView('project'); });
    projectNavListEl.appendChild(btn);
  });
}
function renderProjectSelect() {
  if (!projectSelectEl) return;
  const prevValue = projectSelectEl.value;
  projectSelectEl.innerHTML = '<option value="">No project</option>';
  projects.forEach(p => {
    const opt = document.createElement('option');
    opt.value = p.id;
    opt.textContent = p.name;
    projectSelectEl.appendChild(opt);
  });
  // Pre-select the project currently being viewed, so adding a task
  // from inside a project drops it straight into that project.
  if (currentView === 'project' && currentProjectId && getProject(currentProjectId)) {
    projectSelectEl.value = String(currentProjectId);
  } else if (projects.some(p => String(p.id) === prevValue)) {
    projectSelectEl.value = prevValue;
  }
}

function saveTodos() { localStorage.setItem('todos', JSON.stringify(todos)); }
function todayStr() { return new Date().toISOString().slice(0, 10); }
function tomorrowStr() {
  const d = new Date();
  d.setDate(d.getDate() + 1);
  return d.toISOString().slice(0, 10);
}
function escapeHtml(str) {
  const d = document.createElement('div');
  d.textContent = str;
  return d.innerHTML;
}

function todoRemoteRow(t) {
  return { id: t.id, user_id: currentUser.id, text: t.text, desc: t.desc || '', done: t.done, due: t.due, priority: t.priority, project_id: t.projectId || null };
}
function projectRemoteRow(p) {
  return { id: p.id, user_id: currentUser.id, name: p.name };
}

function showView(view) {
  document.getElementById('task-view').style.display = 'none';
  document.getElementById('pomodoro-view').style.display = 'none';
  document.getElementById('calendar-view').style.display = 'none';
  document.getElementById('notes-view').style.display = 'none';
  document.getElementById('settings-view').style.display = 'none';
  if (view === 'pomodoro') document.getElementById('pomodoro-view').style.display = 'block';
  else if (view === 'settings') document.getElementById('settings-view').style.display = 'block';
  else if (view === 'calendar') document.getElementById('calendar-view').style.display = 'block';
  else if (view === 'notes') document.getElementById('notes-view').style.display = 'block';
  else document.getElementById('task-view').style.display = 'block'; // 'all' | 'today' | 'active' | 'completed' | 'project'
}

function setView(view) {
  currentView = view;
  if (view !== 'project') currentProjectId = null;
  navItems.forEach(b => b.classList.toggle('active', b.dataset.view === view));
  allTasksBtn.classList.toggle('active', ['all', 'today', 'active', 'completed'].includes(view));
  showView(view);
  if (view === 'settings') renderSettingsUI();
  if (view === 'calendar') { renderCalendar(); renderDayPanel(); }
  if (view === 'notes') renderNotes();
  if (['all', 'today', 'active', 'completed', 'project'].includes(view)) {
    renderProjectSelect();
    renderTodos();
    renderViewHeader();
  }
  renderProjectNav();
  closeSidebar();
}

allTasksBtn.addEventListener('click', () => {
  const isOpen = allSubnav.classList.contains('open');
  allSubnav.classList.toggle('open', !isOpen);
  allChevron.classList.toggle('open', !isOpen);
  setView('all');
});
navItems.forEach(btn => {
  if (btn.id === 'all-tasks-btn') return;
  btn.addEventListener('click', () => setView(btn.dataset.view));
});

function getFilteredTodos() {
  let filtered = [...todos];
  if (currentView === 'today') filtered = filtered.filter(t => t.due === todayStr());
  else if (currentView === 'active') filtered = filtered.filter(t => !t.done);
  else if (currentView === 'completed') filtered = filtered.filter(t => t.done);
  else if (currentView === 'project') filtered = filtered.filter(t => t.projectId === currentProjectId);
  const priorityRank = { high: 0, medium: 1, low: 2 };
  filtered.sort((a, b) => {
    if (a.done !== b.done) return a.done ? 1 : -1;
    if (priorityRank[a.priority] !== priorityRank[b.priority]) return priorityRank[a.priority] - priorityRank[b.priority];
    return (a.due || '9999').localeCompare(b.due || '9999');
  });
  return filtered;
}
function renderTodos() {
  const filtered = getFilteredTodos();
  todoListEl.innerHTML = '';
  emptyState.style.display = filtered.length ? 'none' : 'block';
  const todayKey = todayStr();

  filtered.forEach(t => {
    const card = document.createElement('div');
    card.className = `task-card priority-${t.priority}` + (t.done ? ' completed' : '');

    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    checkbox.className = 'task-check';
    checkbox.checked = t.done;
    checkbox.setAttribute('aria-label', t.done ? 'Mark task as not done' : 'Mark task as done');
    checkbox.addEventListener('change', () => {
      t.done = checkbox.checked;
      saveTodos(); renderTodos(); renderCounts();
      if (currentUser) dbUpsert('todos', todoRemoteRow(t));
      if (t.done) showToast('complete');
    });

    const main = document.createElement('div');
    main.className = 'task-main';

    const title = document.createElement('div');
    title.className = 'task-title';
    title.textContent = t.text;
    main.appendChild(title);

    if (t.desc) {
      const desc = document.createElement('div');
      desc.className = 'task-desc';
      desc.textContent = t.desc;
      main.appendChild(desc);
    }

    const meta = document.createElement('div');
    meta.className = 'task-meta';

    if (t.due) {
      const overdue = !t.done && t.due < todayKey;
      const isToday = t.due === todayKey;
      const due = document.createElement('span');
      due.className = 'task-pill' + (overdue ? ' due-overdue' : '') + (isToday ? ' due-today' : '');
      due.textContent = (overdue ? '⚠ ' : '📅 ') + t.due;
      meta.appendChild(due);
    }
    if (t.priority === 'high' || t.priority === 'medium') {
      const pr = document.createElement('span');
      pr.className = `task-pill priority-tag priority-${t.priority}`;
      pr.textContent = t.priority === 'high' ? 'High priority' : 'Medium';
      meta.appendChild(pr);
    }
    if (t.projectId && currentView !== 'project') {
      const p = getProject(t.projectId);
      if (p) {
        const tag = document.createElement('span');
        tag.className = 'task-pill project-tag';
        tag.textContent = p.name;
        tag.title = 'Go to project';
        tag.addEventListener('click', () => { currentProjectId = p.id; setView('project'); });
        meta.appendChild(tag);
      }
    }
    if (meta.children.length) main.appendChild(meta);

    const actions = document.createElement('div');
    actions.className = 'task-card-actions';
    const del = document.createElement('button');
    del.className = 'delete-btn';
    del.setAttribute('aria-label', 'Delete task');
    del.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"></path><path d="M10 11v6"></path><path d="M14 11v6"></path><path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"></path></svg>';
    del.addEventListener('click', () => {
      todos = todos.filter(x => x.id !== t.id);
      saveTodos(); renderTodos(); renderCounts(); renderProjectNav();
      if (currentUser) dbDelete('todos', t.id, currentUser.id);
    });
    actions.appendChild(del);

    card.append(checkbox, main, actions);
    todoListEl.appendChild(card);
  });
}
function renderCounts() {
  document.getElementById('count-all').textContent = todos.length;
  document.getElementById('count-today').textContent = todos.filter(t => t.due === todayStr()).length;
  document.getElementById('count-active').textContent = todos.filter(t => !t.done).length;
  document.getElementById('count-completed').textContent = todos.filter(t => t.done).length;
}
function renderViewHeader() {
  const titles = { all: 'All Tasks', today: 'Today', active: 'Active', completed: 'Completed' };
  if (currentView === 'project') {
    const p = getProject(currentProjectId);
    viewTitle.textContent = p ? p.name : 'Project';
    projectHeaderActions.style.display = 'flex';
  } else {
    viewTitle.textContent = titles[currentView] || 'Tasks';
    projectHeaderActions.style.display = 'none';
  }
  const remaining = getFilteredTodos().filter(t => !t.done).length;
  viewSubtitle.textContent = `${remaining} remaining`;
}
form.addEventListener('submit', (e) => {
  e.preventDefault();
  const text = input.value.trim();
  if (!text) return;
  const projectId = projectSelectEl.value ? Number(projectSelectEl.value) : null;
  const newTodo = { id: Date.now(), text, desc: descInput.value.trim(), done: false, due: dueInput.value || null, priority: priorityInput.value, projectId };
  todos.push(newTodo);
  input.value = ''; descInput.value = ''; dueInput.value = '';
  saveTodos();
  renderTodos(); renderCounts(); renderViewHeader(); renderProjectNav();
  if (currentUser) dbUpsert('todos', todoRemoteRow(newTodo));
  showToast('add');
  input.focus();
});
clearBtn.addEventListener('click', () => {
  todos = todos.filter(t => !t.done);
  saveTodos();
  renderTodos(); renderCounts(); renderViewHeader(); renderProjectNav();
  if (currentUser) dbDeleteWhere('todos', currentUser.id, { done: true });
});

// ===== Calendar =====
let events = JSON.parse(localStorage.getItem('events') || '[]');
let calViewDate = new Date();
calViewDate.setDate(1);
let selectedDateKey = todayStr();
let editingEventId = null;

const calGrid = document.getElementById('calendar-grid');
const calMonthLabel = document.getElementById('cal-month-label');
const calPrevBtn = document.getElementById('cal-prev');
const calNextBtn = document.getElementById('cal-next');
const calTodayBtn = document.getElementById('cal-today-btn');
const dayPanelHeaderList = document.getElementById('day-panel-header-list');
const dayPanelDate = document.getElementById('day-panel-date');
const dayPanelSub = document.getElementById('day-panel-sub');
const dayPanelList = document.getElementById('day-panel-list');
const dayPanelAddBtn = document.getElementById('day-panel-add');
const dayPanelForm = document.getElementById('day-panel-form');
const eventFormTitle = document.getElementById('event-form-title');
const eventTimeInput = document.getElementById('event-time-input');
const eventTitleInput = document.getElementById('event-title-input');
const eventNotesInput = document.getElementById('event-notes-input');
const eventSaveBtn = document.getElementById('event-save-btn');
const eventBackBtn = document.getElementById('event-back-btn');
const eventDeleteBtn = document.getElementById('event-delete-btn');

function saveEvents() { localStorage.setItem('events', JSON.stringify(events)); }
function pad2(n) { return n.toString().padStart(2, '0'); }
function dateKey(y, m, d) { return `${y}-${pad2(m + 1)}-${pad2(d)}`; }
function eventsForDate(dateStr) {
  return events.filter(e => e.date === dateStr).sort((a, b) => (a.time || '99:99').localeCompare(b.time || '99:99'));
}
function formatDateLong(dateStr) {
  const [y, m, d] = dateStr.split('-').map(Number);
  return new Date(y, m - 1, d).toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' });
}
function eventRemoteRow(ev) {
  return { id: ev.id, user_id: currentUser.id, date: ev.date, time: ev.time, title: ev.title, notes: ev.notes || '' };
}

function renderCalendar() {
  const year = calViewDate.getFullYear();
  const month = calViewDate.getMonth();
  calMonthLabel.textContent = calViewDate.toLocaleDateString(undefined, { month: 'long', year: 'numeric' });
  const firstWeekday = new Date(year, month, 1).getDay();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const daysInPrevMonth = new Date(year, month, 0).getDate();
  const totalCells = Math.ceil((firstWeekday + daysInMonth) / 7) * 7;
  const todayKey = todayStr();

  calGrid.innerHTML = '';
  for (let i = 0; i < totalCells; i++) {
    const cell = document.createElement('div');
    let cellDate, outside = false;
    if (i < firstWeekday) { cellDate = new Date(year, month - 1, daysInPrevMonth - firstWeekday + i + 1); outside = true; }
    else if (i >= firstWeekday + daysInMonth) { cellDate = new Date(year, month + 1, i - (firstWeekday + daysInMonth) + 1); outside = true; }
    else { cellDate = new Date(year, month, i - firstWeekday + 1); }
    const key = dateKey(cellDate.getFullYear(), cellDate.getMonth(), cellDate.getDate());
    cell.className = 'day-cell' + (outside ? ' outside' : '') + (key === todayKey ? ' today' : '') + (key === selectedDateKey ? ' selected' : '');

    const num = document.createElement('div');
    num.className = 'day-number';
    num.textContent = cellDate.getDate();
    cell.appendChild(num);

    const count = eventsForDate(key).length;
    const dotRow = document.createElement('div');
    dotRow.className = 'day-dot-row';
    for (let d = 0; d < Math.min(count, 3); d++) {
      const dot = document.createElement('span');
      dot.className = 'day-dot';
      dotRow.appendChild(dot);
    }
    cell.appendChild(dotRow);

    cell.addEventListener('click', () => {
      selectedDateKey = key;
      showDayPanelList();
      renderCalendar();
      renderDayPanel();
    });
    calGrid.appendChild(cell);
  }
}

function showDayPanelList() {
  dayPanelHeaderList.style.display = 'flex';
  dayPanelList.style.display = 'flex';
  dayPanelForm.style.display = 'none';
}
function showDayPanelForm() {
  dayPanelHeaderList.style.display = 'none';
  dayPanelList.style.display = 'none';
  dayPanelForm.style.display = 'flex';
}

function renderDayPanel() {
  dayPanelDate.textContent = formatDateLong(selectedDateKey);
  const dayEvents = eventsForDate(selectedDateKey);
  dayPanelSub.textContent = dayEvents.length ? `${dayEvents.length} event${dayEvents.length > 1 ? 's' : ''}` : 'No events yet';

  dayPanelList.innerHTML = '';
  if (!dayEvents.length) {
    const empty = document.createElement('div');
    empty.className = 'day-panel-empty';
    empty.textContent = 'Nothing scheduled. Add an event to get started.';
    dayPanelList.appendChild(empty);
    return;
  }
  dayEvents.forEach(ev => {
    const row = document.createElement('div');
    row.className = 'event-row';
    const time = document.createElement('span');
    time.className = 'event-time';
    time.textContent = ev.time || 'All day';
    const main = document.createElement('div');
    main.className = 'event-row-main';
    const title = document.createElement('div');
    title.className = 'event-title';
    title.textContent = ev.title;
    main.appendChild(title);
    if (ev.notes) {
      const notes = document.createElement('div');
      notes.className = 'event-notes';
      notes.textContent = ev.notes;
      main.appendChild(notes);
    }
    row.append(time, main);
    row.addEventListener('click', () => openEventForm(ev));
    dayPanelList.appendChild(row);
  });
}

function openEventForm(existingEvent = null) {
  editingEventId = existingEvent ? existingEvent.id : null;
  eventFormTitle.textContent = existingEvent ? 'Edit Event' : `Add Event · ${formatDateLong(selectedDateKey)}`;
  eventTimeInput.value = existingEvent ? (existingEvent.time || '') : '';
  eventTitleInput.value = existingEvent ? existingEvent.title : '';
  eventNotesInput.value = existingEvent ? (existingEvent.notes || '') : '';
  eventDeleteBtn.style.display = existingEvent ? 'inline-block' : 'none';
  showDayPanelForm();
  eventTitleInput.focus();
}

calPrevBtn.addEventListener('click', () => { calViewDate.setMonth(calViewDate.getMonth() - 1); renderCalendar(); });
calNextBtn.addEventListener('click', () => { calViewDate.setMonth(calViewDate.getMonth() + 1); renderCalendar(); });
calTodayBtn.addEventListener('click', () => {
  calViewDate = new Date(); calViewDate.setDate(1);
  selectedDateKey = todayStr();
  renderCalendar(); renderDayPanel();
});
dayPanelAddBtn.addEventListener('click', () => openEventForm());
eventBackBtn.addEventListener('click', () => { showDayPanelList(); renderDayPanel(); });

eventSaveBtn.addEventListener('click', () => {
  const title = eventTitleInput.value.trim();
  if (!title) return;
  let savedEvent;
  if (editingEventId) {
    const ev = events.find(e => e.id === editingEventId);
    if (ev) { ev.time = eventTimeInput.value || null; ev.title = title; ev.notes = eventNotesInput.value.trim(); savedEvent = ev; }
  } else {
    savedEvent = { id: Date.now(), date: selectedDateKey, time: eventTimeInput.value || null, title, notes: eventNotesInput.value.trim() };
    events.push(savedEvent);
    showToast('event');
  }
  saveEvents();
  if (currentUser && savedEvent) dbUpsert('events', eventRemoteRow(savedEvent));
  showDayPanelList();
  renderCalendar();
  renderDayPanel();
});
eventDeleteBtn.addEventListener('click', () => {
  if (!editingEventId) return;
  const deletedId = editingEventId;
  events = events.filter(e => e.id !== deletedId);
  saveEvents();
  if (currentUser) dbDelete('events', deletedId, currentUser.id);
  showDayPanelList();
  renderCalendar();
  renderDayPanel();
});

// ===== Notes =====
let notes = JSON.parse(localStorage.getItem('notes') || '[]');
let noteCategories = JSON.parse(localStorage.getItem('noteCategories') || 'null') || ['General'];
let activeCategory = 'All';

const categoryTabsEl = document.getElementById('category-tabs');
const addCategoryBtn = document.getElementById('add-category-btn');
const noteForm = document.getElementById('note-form');
const noteTitleInput = document.getElementById('note-title-input');
const noteCategorySelect = document.getElementById('note-category-select');
const noteDescInput = document.getElementById('note-desc-input');
const noteContentInput = document.getElementById('note-content-input');
const notesListEl = document.getElementById('notes-list');
const notesEmptyState = document.getElementById('notes-empty-state');

function saveNotes() { localStorage.setItem('notes', JSON.stringify(notes)); }
function saveNoteCategories() { localStorage.setItem('noteCategories', JSON.stringify(noteCategories)); }
function noteRemoteRow(n) {
  return { id: n.id, user_id: currentUser.id, title: n.title, category: n.category, desc: n.desc || '', content: n.content || '', created_at: n.createdAt };
}

function renderCategoryTabs() {
  categoryTabsEl.innerHTML = '';
  const all = ['All', ...noteCategories];
  all.forEach(cat => {
    const btn = document.createElement('button');
    btn.className = 'category-tab' + (cat === activeCategory ? ' active' : '');
    btn.textContent = cat;
    btn.addEventListener('click', () => { activeCategory = cat; renderCategoryTabs(); renderNotes(); });
    categoryTabsEl.appendChild(btn);
  });
}
function renderNoteCategorySelect() {
  noteCategorySelect.innerHTML = '';
  noteCategories.forEach(cat => {
    const opt = document.createElement('option');
    opt.value = cat;
    opt.textContent = cat;
    noteCategorySelect.appendChild(opt);
  });
}
addCategoryBtn.addEventListener('click', () => {
  const name = prompt('New category name:');
  if (!name || !name.trim()) return;
  if (noteCategories.includes(name.trim())) return;
  noteCategories.push(name.trim());
  saveNoteCategories();
  renderCategoryTabs(); renderNoteCategorySelect();
});

function formatCreatedAt(iso) {
  const d = new Date(iso);
  return d.toLocaleString(undefined, { month: 'short', day: 'numeric', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}

function renderNotes() {
  const filtered = activeCategory === 'All' ? notes : notes.filter(n => n.category === activeCategory);
  const sorted = [...filtered].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  notesListEl.innerHTML = '';
  notesEmptyState.style.display = sorted.length ? 'none' : 'block';

  sorted.forEach(n => {
    const card = document.createElement('div');
    card.className = 'note-card';

    const top = document.createElement('div');
    top.className = 'note-card-top';
    const title = document.createElement('div');
    title.className = 'note-card-title';
    title.textContent = n.title;
    const cat = document.createElement('span');
    cat.className = 'note-card-category';
    cat.textContent = n.category;
    top.append(title, cat);
    card.appendChild(top);

    if (n.desc) {
      const desc = document.createElement('div');
      desc.className = 'note-card-desc';
      desc.textContent = n.desc;
      card.appendChild(desc);
    }
    if (n.content) {
      const content = document.createElement('div');
      content.className = 'note-card-content';
      content.textContent = n.content;
      card.appendChild(content);
    }

    const footer = document.createElement('div');
    footer.className = 'note-card-footer';
    const time = document.createElement('span');
    time.className = 'note-card-time';
    time.textContent = `Created ${formatCreatedAt(n.createdAt)}`;
    const del = document.createElement('button');
    del.className = 'delete-btn';
    del.textContent = 'x';
    del.addEventListener('click', () => {
      notes = notes.filter(x => x.id !== n.id);
      saveNotes(); renderNotes();
      if (currentUser) dbDelete('notes', n.id, currentUser.id);
    });
    footer.append(time, del);
    card.appendChild(footer);

    notesListEl.appendChild(card);
  });
}

noteForm.addEventListener('submit', (e) => {
  e.preventDefault();
  const title = noteTitleInput.value.trim();
  if (!title) return;
  const newNote = {
    id: Date.now(),
    title,
    category: noteCategorySelect.value || noteCategories[0] || 'General',
    desc: noteDescInput.value.trim(),
    content: noteContentInput.value.trim(),
    createdAt: new Date().toISOString(),
  };
  notes.push(newNote);
  noteTitleInput.value = ''; noteDescInput.value = ''; noteContentInput.value = '';
  saveNotes();
  renderNotes();
  if (currentUser) dbUpsert('notes', noteRemoteRow(newNote));
  showToast('note');
  noteTitleInput.focus();
});

// ===== Smart Rollover Triage (End-of-Day Closeout) =====
const CLOSEOUT_TIME_KEY = 'closeoutTime';
const CLOSEOUT_ENABLED_KEY = 'closeoutEnabled';
const CLOSEOUT_LAST_SHOWN_KEY = 'closeoutLastShown';
const DEFAULT_CLOSEOUT_TIME = '17:00';

function getCloseoutTime() { return localStorage.getItem(CLOSEOUT_TIME_KEY) || DEFAULT_CLOSEOUT_TIME; }
function isCloseoutEnabled() {
  const v = localStorage.getItem(CLOSEOUT_ENABLED_KEY);
  return v === null ? true : v === 'true';
}

const closeoutOverlay = document.getElementById('closeout-overlay');
const closeoutList = document.getElementById('closeout-list');
const closeoutEmpty = document.getElementById('closeout-empty');
const closeoutCloseBtn = document.getElementById('closeout-close-btn');
const closeoutMoveAllBtn = document.getElementById('closeout-move-all-btn');
const closeoutDoneBtn = document.getElementById('closeout-done-btn');
const closeoutBtn = document.getElementById('closeout-btn');

function unfinishedForCloseout() {
  const today = todayStr();
  return todos.filter(t => !t.done && (!t.due || t.due <= today));
}

function openCloseout() {
  const pending = unfinishedForCloseout();
  closeoutList.innerHTML = '';
  closeoutEmpty.style.display = pending.length ? 'none' : 'block';
  pending.forEach(t => {
    const row = document.createElement('div');
    row.className = 'closeout-item';
    row.dataset.id = t.id;
    const title = document.createElement('div');
    title.className = 'closeout-item-title';
    title.textContent = t.text;
    const actions = document.createElement('div');
    actions.className = 'closeout-item-actions';
    const moveBtn = document.createElement('button');
    moveBtn.textContent = 'Move to tomorrow';
    moveBtn.addEventListener('click', () => {
      t.due = tomorrowStr();
      saveTodos();
      if (currentUser) dbUpsert('todos', todoRemoteRow(t));
      row.classList.add('resolved');
      moveBtn.disabled = true; keepBtn.disabled = true;
    });
    const keepBtn = document.createElement('button');
    keepBtn.textContent = 'Keep as is';
    keepBtn.addEventListener('click', () => {
      row.classList.add('resolved');
      moveBtn.disabled = true; keepBtn.disabled = true;
    });
    actions.append(moveBtn, keepBtn);
    row.append(title, actions);
    closeoutList.appendChild(row);
  });
  closeoutOverlay.style.display = 'flex';
  localStorage.setItem(CLOSEOUT_LAST_SHOWN_KEY, todayStr());
}
function closeCloseout() {
  closeoutOverlay.style.display = 'none';
  renderTodos(); renderCounts(); renderViewHeader();
  if (currentView === 'calendar') { renderCalendar(); }
}
closeoutCloseBtn.addEventListener('click', closeCloseout);
closeoutDoneBtn.addEventListener('click', () => { closeCloseout(); showToast('closeout'); });
closeoutMoveAllBtn.addEventListener('click', () => {
  const tmrw = tomorrowStr();
  const moved = unfinishedForCloseout();
  moved.forEach(t => { t.due = tmrw; });
  saveTodos();
  if (currentUser) moved.forEach(t => dbUpsert('todos', todoRemoteRow(t)));
  closeoutList.querySelectorAll('.closeout-item').forEach(row => {
    row.classList.add('resolved');
    row.querySelectorAll('button').forEach(b => b.disabled = true);
  });
});
closeoutBtn.addEventListener('click', openCloseout);

document.getElementById('closeout-time-input').addEventListener('change', (e) => {
  localStorage.setItem(CLOSEOUT_TIME_KEY, e.target.value || DEFAULT_CLOSEOUT_TIME);
});
document.getElementById('closeout-enabled-input').addEventListener('change', (e) => {
  localStorage.setItem(CLOSEOUT_ENABLED_KEY, e.target.checked ? 'true' : 'false');
});

function maybeAutoOpenCloseout() {
  if (!isCloseoutEnabled()) return;
  if (closeoutOverlay.style.display === 'flex') return;
  const now = new Date();
  const nowHM = `${pad2(now.getHours())}:${pad2(now.getMinutes())}`;
  const target = getCloseoutTime();
  const already = localStorage.getItem(CLOSEOUT_LAST_SHOWN_KEY) === todayStr();
  if (!already && nowHM >= target && unfinishedForCloseout().length > 0) {
    openCloseout();
  }
}
setInterval(maybeAutoOpenCloseout, 60 * 1000);

// ===== App startup (called by auth.js once sign-in/guest state is known) =====
window.initApp = async function initApp(user) {
  currentUser = user || null;

  if (currentUser) {
    const [remoteTodos, remoteNotes, remoteEvents, remoteProjects] = await Promise.all([
      dbFetchAll('todos', currentUser.id),
      dbFetchAll('notes', currentUser.id),
      dbFetchAll('events', currentUser.id),
      dbFetchAll('projects', currentUser.id),
    ]);
    if (remoteProjects) {
      projects = remoteProjects.map(p => ({ id: p.id, name: p.name }));
      saveProjects();
    }
    if (remoteTodos) {
      todos = remoteTodos.map(t => ({ id: t.id, text: t.text, desc: t.desc, done: t.done, due: t.due, priority: t.priority, projectId: t.project_id || null }));
      saveTodos();
    }
    if (remoteNotes) {
      notes = remoteNotes.map(n => ({ id: n.id, title: n.title, category: n.category, desc: n.desc, content: n.content, createdAt: n.created_at }));
      saveNotes();
    }
    if (remoteEvents) {
      events = remoteEvents.map(ev => ({ id: ev.id, date: ev.date, time: ev.time, title: ev.title, notes: ev.notes }));
      saveEvents();
    }
  }

  applyTheme(getTheme());
  renderSettingsUI();
  renderProjectNav();
  renderProjectSelect();
  renderTodos();
  renderCounts();
  renderViewHeader();
  renderPomodoro();
  renderCalendar();
  renderDayPanel();
  renderCategoryTabs();
  renderNoteCategorySelect();
  renderNotes();
  tipsBarEl.style.display = areTipsEnabled() ? 'flex' : 'none';
  refreshTip();
  setTimeout(maybeAutoOpenCloseout, 4000);
  requestNotifPermissionIfNeeded();
  checkEventNotifications();
};

// ===== Loading screen =====
// This is just a start screen now: click anywhere (or the button) to enter the app.
const loadingScreen = document.getElementById('loading-screen');
const loadingContinueBtn = document.getElementById('loading-continue');
const statusDotEl = document.getElementById('status-dot');
const statusTextEl = document.getElementById('status-text');

let loadingDismissed = false;
function dismissLoading() {
  if (loadingDismissed) return;
  loadingDismissed = true;
  loadingScreen.classList.add('hidden');
}
loadingScreen.addEventListener('click', dismissLoading);
loadingContinueBtn.addEventListener('click', (e) => { e.stopPropagation(); dismissLoading(); });

// Connectivity check. navigator.onLine reflects whether the OS/network
// interface reports a connection — it doesn't depend on any one external
// site, so a single third-party outage (expired cert, downtime, etc.)
// can't make this wrongly report "offline" while you're actually online.
function updateConnectionStatus() {
  const online = typeof navigator !== 'undefined' ? navigator.onLine : true;
  statusDotEl.className = 'status-dot ' + (online ? 'online' : 'offline');
  statusTextEl.textContent = online ? 'Online' : 'Offline';
  return online;
}
updateConnectionStatus();
window.addEventListener('online', updateConnectionStatus);
window.addEventListener('offline', updateConnectionStatus);