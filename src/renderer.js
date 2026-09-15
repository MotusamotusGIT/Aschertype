// ===== PWA =====
if ('serviceWorker' in navigator && (location.protocol === 'http:' || location.protocol === 'https:')) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./sw.js')
      .then((reg) => console.log('[PWA] SW registered:', reg.scope))
      .catch((err) => console.error('[PWA] SW failed:', err));
  });
}

// ===== Theme =====
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

// ===== Account section =====
const accountStatusEl = document.getElementById('account-status');
const accountSignoutBtn = document.getElementById('account-signout-btn');
const accountSwitchBtn = document.getElementById('account-switch-btn');

function renderAccountSection() {
  if (currentUser) {
    accountStatusEl.textContent = `Signed in as ${currentUser.email}. Your tasks, notes and events sync to your account.`;
    accountSignoutBtn.style.display = 'inline-block';
    accountSwitchBtn.style.display = 'none';
  } else if (isGuest) {
    if (supabaseReady) {
      accountStatusEl.textContent = "You're using Aschertype without an account. Data is stored on this device only.";
    } else if (typeof window.supabase === 'undefined') {
      accountStatusEl.textContent = "Couldn't reach the accounts service (check your connection) — data is stored on this device only.";
    } else {
      accountStatusEl.textContent = "Accounts aren't configured on this deployment yet — data is stored on this device only.";
    }
    accountSignoutBtn.style.display = 'none';
    accountSwitchBtn.style.display = supabaseReady ? 'inline-block' : 'none';
  } else {
    accountStatusEl.textContent = 'Checking account…';
    accountSignoutBtn.style.display = 'none';
    accountSwitchBtn.style.display = 'none';
  }
  renderProfileChip();
}
accountSignoutBtn.addEventListener('click', () => {
  if (typeof signOutAndReset === 'function') signOutAndReset();
});
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

// ===== Mobile sidebar =====
const sidebar = document.getElementById('sidebar');
const sidebarBackdrop = document.getElementById('sidebar-backdrop');
const menuToggle = document.getElementById('menu-toggle');
function openSidebar() { sidebar.classList.add('open'); sidebarBackdrop.classList.add('show'); }
function closeSidebar() { sidebar.classList.remove('open'); sidebarBackdrop.classList.remove('show'); }
menuToggle.addEventListener('click', () => {
  sidebar.classList.contains('open') ? closeSidebar() : openSidebar();
});
sidebarBackdrop.addEventListener('click', closeSidebar);

// ===== Profile state =====
let currentProfile = null;

function profileDisplayName() {
  if (currentProfile && currentProfile.display_name) return currentProfile.display_name;
  if (currentUser && currentUser.email) return currentUser.email.split('@')[0];
  return 'User';
}
function profileInitial() {
  const n = profileDisplayName();
  return (n.charAt(0) || 'U').toUpperCase();
}

function renderProfileChip() {
  const chip = document.getElementById('profile-chip');
  const mobileChip = document.getElementById('mobile-profile-chip');
  const avatar = document.getElementById('profile-avatar');
  const mobileAvatar = document.getElementById('mobile-profile-avatar');
  const name = document.getElementById('profile-name');

  if (currentUser || isGuest) {
    chip.classList.remove('hidden');
    mobileChip.style.display = 'flex';
    const initial = profileInitial();
    const disp = profileDisplayName();
    avatar.textContent = initial;
    mobileAvatar.textContent = initial;
    name.textContent = disp;
    chip.title = currentUser ? currentUser.email : 'Guest session';
  } else {
    chip.classList.add('hidden');
    mobileChip.style.display = 'none';
  }
}

async function loadProfile() {
  if (!currentUser || !supabaseReady) {
    currentProfile = currentUser ? { id: currentUser.id, email: currentUser.email, display_name: null } : null;
    renderProfileChip();
    return;
  }
  const p = await dbFetchMyProfile();
  currentProfile = p
    ? { id: p.id, email: p.email, display_name: p.display_name }
    : { id: currentUser.id, email: currentUser.email, display_name: null };
  renderProfileChip();
  renderProfilePopover();
}

// ===== Profile popover =====
const profileOverlay = document.getElementById('profile-overlay');
const profilePopover = document.getElementById('profile-popover');
const profilePopNameEdit = document.getElementById('profile-pop-name-edit');

// Track which chip was tapped so the desktop popover anchors to the
// right element. On mobile, CSS positions the popover under the
// mobile topbar and we skip JS positioning entirely.
let activeProfileAnchor = null;

function isMobileViewport() {
  return window.matchMedia('(max-width: 860px)').matches;
}

function positionProfilePopover() {
  // Mobile: CSS pins the popover under the mobile topbar. Clear any
  // inline top/right/left left over from a desktop session so the CSS
  // rule can take over.
  if (isMobileViewport()) {
    profilePopover.style.top = '';
    profilePopover.style.right = '';
    profilePopover.style.left = '';
    return;
  }

  // Desktop: anchor the popover under whichever chip is visible.
  // Prefer the one that was just clicked; fall back to the desktop
  // chip. If that chip has no size (i.e. it's hidden), bail so we
  // don't reposition to (0,0).
  const chip = activeProfileAnchor || document.getElementById('profile-chip');
  if (!chip) return;
  const rect = chip.getBoundingClientRect();
  if (!rect.width && !rect.height) return;

  const popRect = profilePopover.getBoundingClientRect();
  const top = Math.min(rect.bottom + 8, window.innerHeight - popRect.height - 12);
  const right = Math.max(12, window.innerWidth - rect.right);
  profilePopover.style.top = top + 'px';
  profilePopover.style.right = right + 'px';
  profilePopover.style.left = 'auto';
}

function openProfilePopover(anchorEl) {
  activeProfileAnchor = anchorEl || document.getElementById('profile-chip');
  profileOverlay.style.display = 'block';
  profilePopover.style.display = 'flex';
  renderProfilePopover();
  positionProfilePopover();
}
function closeProfilePopover() {
  profileOverlay.style.display = 'none';
  profilePopover.style.display = 'none';
  profilePopNameEdit.style.display = 'none';
}

function renderProfilePopover() {
  const avatar = document.getElementById('profile-pop-avatar');
  const nameEl = document.getElementById('profile-pop-name');
  const emailEl = document.getElementById('profile-pop-email');
  const editBtn = document.getElementById('profile-edit-name-btn');
  const signoutBtn = document.getElementById('profile-signout-btn');
  const signinBtn = document.getElementById('profile-signin-btn');

  avatar.textContent = profileInitial();
  nameEl.textContent = profileDisplayName();
  emailEl.textContent = currentUser ? currentUser.email : (isGuest ? 'Guest session — local only' : 'Not signed in');

  if (currentUser) {
    editBtn.style.display = 'block';
    signoutBtn.style.display = 'block';
    signinBtn.style.display = 'none';
  } else if (isGuest) {
    editBtn.style.display = 'none';
    signoutBtn.style.display = 'none';
    signinBtn.style.display = supabaseReady ? 'block' : 'none';
  } else {
    editBtn.style.display = 'none';
    signoutBtn.style.display = 'none';
    signinBtn.style.display = 'none';
  }
}

function bindProfileChip(el) {
  if (!el) return;
  el.addEventListener('click', (e) => {
    e.stopPropagation();
    if (profilePopover.style.display === 'flex') closeProfilePopover();
    else openProfilePopover(el);
  });
}
bindProfileChip(document.getElementById('profile-chip'));
bindProfileChip(document.getElementById('mobile-profile-chip'));

profileOverlay.addEventListener('click', closeProfilePopover);

document.getElementById('profile-settings-btn').addEventListener('click', () => {
  closeProfilePopover();
  setView('settings');
});
document.getElementById('profile-signout-btn').addEventListener('click', () => {
  closeProfilePopover();
  signOutAndReset();
});
document.getElementById('profile-signin-btn').addEventListener('click', () => {
  closeProfilePopover();
  sessionStorage.removeItem('aschertypeGuest');
  location.reload();
});

document.getElementById('profile-edit-name-btn').addEventListener('click', () => {
  const input = document.getElementById('profile-name-input');
  input.value = currentProfile && currentProfile.display_name ? currentProfile.display_name : '';
  profilePopNameEdit.style.display = 'flex';
  positionProfilePopover();
  setTimeout(() => input.focus(), 40);
});
document.getElementById('profile-name-cancel').addEventListener('click', () => {
  profilePopNameEdit.style.display = 'none';
});
document.getElementById('profile-name-save').addEventListener('click', async () => {
  if (!currentUser) return;
  const v = document.getElementById('profile-name-input').value.trim();
  const row = {
    id: currentUser.id,
    email: currentUser.email,
    display_name: v || null,
  };
  const { error } = await dbUpsertMyProfile(row);
  if (error) return;
  currentProfile = row;
  profilePopNameEdit.style.display = 'none';
  renderProfileChip();
  renderProfilePopover();
  showToast('permission');
});

// ===== Encouragement toasts =====
const ENCOURAGEMENT_KEY = 'encouragementEnabled';
function isEncouragementEnabled() {
  const v = localStorage.getItem(ENCOURAGEMENT_KEY);
  return v === null ? true : v === 'true';
}
function setEncouragementEnabled(on) { localStorage.setItem(ENCOURAGEMENT_KEY, on ? 'true' : 'false'); }

const ENCOURAGEMENT_MESSAGES = {
  add: [{ emoji: '📝', text: 'Added. One less thing to hold in your head.' }],
  complete: [{ emoji: '🎉', text: 'Done! Nice work.' }],
  note: [{ emoji: '🗒️', text: 'Saved — future you will thank you.' }],
  event: [{ emoji: '📅', text: "Added to your calendar. It's handled." }],
  pomodoro: [{ emoji: '🍅', text: 'Focus session complete — take a real break.' }],
  closeout: [{ emoji: '🌙', text: "That's a wrap." }],
  invite: [{ emoji: '🤝', text: "Invite sent. They'll see it in their notifications." }],
  permission: [{ emoji: '✅', text: 'Saved.' }],
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
  setTimeout(() => { el.classList.add('leaving'); setTimeout(() => el.remove(), 320); }, 3200);
}

window.onSyncError = function (table, action, message) {
  const el = document.createElement('div');
  el.className = 'toast notif';
  el.innerHTML = `<span class="toast-dot" style="background:var(--high)"></span><span><strong>Sync issue</strong><br>Couldn't ${action} ${table}: ${escapeHtml(message)}</span>`;
  toastContainer.appendChild(el);
  setTimeout(() => { el.classList.add('leaving'); setTimeout(() => el.remove(), 320); }, 5000);
};

document.getElementById('encouragement-enabled-input').addEventListener('change', (e) => {
  setEncouragementEnabled(e.target.checked);
});

// ===== System notifications =====
const NOTIF_ENABLED_KEY = 'notificationsEnabled';
function isNotifEnabled() {
  const v = localStorage.getItem(NOTIF_ENABLED_KEY);
  return v === null ? true : v === 'true';
}
function setNotifEnabled(on) { localStorage.setItem(NOTIF_ENABLED_KEY, on ? 'true' : 'false'); }

const notifPermissionHintEl = document.getElementById('notif-permission-hint');
function updateNotifPermissionHint() {
  if (!notifPermissionHintEl) return;
  if (!('Notification' in window)) { notifPermissionHintEl.textContent = 'Not supported here'; return; }
  if (Notification.permission === 'granted') notifPermissionHintEl.textContent = 'System alerts allowed';
  else if (Notification.permission === 'denied') notifPermissionHintEl.textContent = 'Blocked — using in-app alerts';
  else notifPermissionHintEl.textContent = "We'll ask when needed";
}

let audioCtx = null;
function unlockAudioContext() {
  if (audioCtx) return;
  try {
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (Ctx) audioCtx = new Ctx();
  } catch (err) { /* ignore */ }
}
function playNotificationSound() {
  if (!audioCtx) unlockAudioContext();
  if (!audioCtx) return;
  if (audioCtx.state === 'suspended') audioCtx.resume().catch(() => {});
  const now = audioCtx.currentTime;
  [660, 880].forEach((freq, i) => {
    const start = now + i * 0.13;
    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();
    osc.type = 'sine';
    osc.frequency.value = freq;
    gain.gain.setValueAtTime(0, start);
    gain.gain.linearRampToValueAtTime(0.22, start + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, start + 0.32);
    osc.connect(gain).connect(audioCtx.destination);
    osc.start(start);
    osc.stop(start + 0.34);
  });
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
  playNotificationSound();
  if ('Notification' in window && Notification.permission === 'granted') {
    try { new Notification(title, { body }); return; } catch (err) { /* fall through */ }
  }
  const el = document.createElement('div');
  el.className = 'toast notif';
  el.innerHTML = `<span class="toast-dot"></span><span><strong>${escapeHtml(title)}</strong><br>${escapeHtml(body)}</span>`;
  toastContainer.appendChild(el);
  setTimeout(() => { el.classList.add('leaving'); setTimeout(() => el.remove(), 320); }, 4200);
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

// ===== Tips bar =====
const LOCAL_TIPS = [
  'Write tomorrow\'s top 3 tasks tonight — it quiets the mind before sleep.',
  'A 4-7-8 breath can take the edge off a stressful moment.',
  'Batch small tasks together; context-switching is tiring.',
  'Standing up and stretching for 60 seconds every hour keeps focus sharper.',
  'Try the two-minute rule: if it takes under two minutes, do it now.',
  'A short walk outside resets attention better than scrolling.',
  'Single-tasking beats multitasking for focused work.',
  'Keep a "done" list next to your to-do list — good for morale.',
  'Drink water before more coffee; mild dehydration mimics fatigue.',
  'Progress, not perfection.',
  'Silence notifications during focus blocks.',
  'When overwhelmed, write everything down first, then sort.',
  'A tidy desk for the next morning makes starting easier.',
  'Take real breaks: stepping away restores focus.',
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

async function refreshTip() {
  if (!areTipsEnabled()) return;
  tipsTextEl.textContent = localTip();
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
    sendNotification(pomodoro.mode === 'work' ? 'Almost there' : 'Break ending soon',
      pomodoro.mode === 'work' ? 'One minute left in your focus session.' : 'One minute left in your break.');
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

// ===== State =====
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
const mainHeaderEl = viewTitle.closest('.main-header');
const clearBtn = document.getElementById('clear-completed');
const allTasksBtn = document.getElementById('all-tasks-btn');
const allChevron = document.getElementById('all-chevron');
const allSubnav = document.getElementById('all-subnav');
const navItems = document.querySelectorAll('.nav-item');

// ===== Task add toggle =====
const taskAddEl = document.getElementById('task-add');
const taskAddToggle = document.getElementById('task-add-toggle');
const taskAddCancel = document.getElementById('task-add-cancel');

function openTaskAdd() {
  taskAddEl.classList.add('open');
  taskAddToggle.hidden = true;
  form.hidden = false;
  setTimeout(() => input.focus(), 50);
}
function closeTaskAdd() {
  taskAddEl.classList.remove('open');
  form.hidden = true;
  taskAddToggle.hidden = false;
  input.value = '';
  descInput.value = '';
  dueInput.value = '';
  priorityInput.value = 'medium';
}
taskAddToggle.addEventListener('click', openTaskAdd);
taskAddCancel.addEventListener('click', closeTaskAdd);

// ===== Projects & collaborators =====
let projects = JSON.parse(localStorage.getItem('projects') || '[]');
let currentProjectId = null;
let projectMembers = [];
let notifications = [];

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
const projectPreviewTile = document.getElementById('project-preview-tile');
const projectModalSaveBtn = document.getElementById('project-modal-save-btn');
const projectModalCancelBtn = document.getElementById('project-modal-cancel-btn');
const projectModalCloseBtn = document.getElementById('project-modal-close-btn');

let editingProjectId = null;

function saveProjects() { localStorage.setItem('projects', JSON.stringify(projects)); }
function getProject(id) { return projects.find(p => String(p.id) === String(id)) || null; }

function membersForProject(projectId) {
  const pid = String(projectId);
  return projectMembers.filter(m => String(m.project_id) === pid);
}
function myMembership(projectId) {
  if (!currentUser) return null;
  const email = (currentUser.email || '').toLowerCase();
  return membersForProject(projectId).find(m =>
    m.status === 'accepted' &&
    (m.member_id === currentUser.id || (m.member_email || '').toLowerCase() === email)
  ) || null;
}
function isProjectOwner(projectId) {
  const p = getProject(projectId);
  return !!p && !!currentUser && p.userId === currentUser.id;
}
function canRenameProject(projectId) {
  if (isProjectOwner(projectId)) return true;
  const m = myMembership(projectId);
  return !!(m && m.can_rename_project);
}
function canAddTaskTo(projectId) {
  if (!projectId) return true;
  if (isProjectOwner(projectId)) return true;
  const m = myMembership(projectId);
  return !!(m && m.can_add_task);
}
function canRemoveTaskFrom(projectId) {
  if (!projectId) return true;
  if (isProjectOwner(projectId)) return true;
  const m = myMembership(projectId);
  return !!(m && m.can_remove_task);
}
function canRenameTaskIn(projectId) {
  if (!projectId) return true;
  if (isProjectOwner(projectId)) return true;
  const m = myMembership(projectId);
  return !!(m && m.can_rename_task);
}
function canToggleTaskIn(projectId) {
  if (!projectId) return true;
  return isProjectOwner(projectId) || !!myMembership(projectId);
}

let previewTileColor = null;
function updateProjectPreviewLetter() {
  const name = projectNameInput.value.trim();
  projectPreviewTile.textContent = name.charAt(0).toUpperCase() || '?';
}
projectNameInput.addEventListener('input', updateProjectPreviewLetter);

function openProjectModal(existingProject = null) {
  editingProjectId = existingProject ? existingProject.id : null;
  projectModalTitle.textContent = existingProject ? 'Rename project' : 'New project';
  projectNameInput.value = existingProject ? existingProject.name : '';
  previewTileColor = projectTileColor(existingProject || { id: 'preview-' + Date.now(), name: '' });
  projectPreviewTile.style.background = previewTileColor;
  updateProjectPreviewLetter();
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
      if (currentUser) dbUpdate('projects', p.id, { name });
    }
  } else {
    const p = { id: Date.now(), name, userId: currentUser ? currentUser.id : null };
    projects.push(p);
    saveProjects();
    if (currentUser) dbUpsert('projects', projectRemoteRow(p));
  }
  closeProjectModal();
  renderProjectNav();
  renderProjectSelect();
  if (currentView === 'project') { renderViewHeader(); renderTodos(); renderCollabPanel(); }
});

function deleteProject(id) {
  projects = projects.filter(p => String(p.id) !== String(id));
  let touched = [];
  todos.forEach(t => { if (String(t.projectId) === String(id)) { t.projectId = null; touched.push(t); } });
  saveProjects();
  saveTodos();
  if (currentUser) {
    touched.forEach(t => dbUpdate('todos', t.id, { project_id: null }));
    dbDelete('projects', id, currentUser.id);
  }
}
projectDeleteBtn.addEventListener('click', () => {
  if (!currentProjectId) return;
  const p = getProject(currentProjectId);
  if (!p) return;
  if (!confirm(`Delete "${p.name}"? Tasks in it will be kept but unassigned.`)) return;
  deleteProject(currentProjectId);
  setView('all');
});
projectRenameBtn.addEventListener('click', () => {
  const p = getProject(currentProjectId);
  if (p) openProjectModal(p);
});

const PROJECT_TILE_COLORS = ['#3c6350', '#8a6d3f', '#5b6f8c', '#7a5b7f', '#8c5b57', '#4f7a78', '#6b6b45', '#5c6b8a'];
function projectTileColor(p) {
  const key = String(p.id) + '|' + (p.name || '');
  let hash = 0;
  for (let i = 0; i < key.length; i++) hash = (hash * 31 + key.charCodeAt(i)) >>> 0;
  return PROJECT_TILE_COLORS[hash % PROJECT_TILE_COLORS.length];
}

function renderProjectNav() {
  projectNavListEl.innerHTML = '';
  projectEmptyHintEl.style.display = projects.length ? 'none' : 'block';
  projects.forEach(p => {
    const isOwned = isProjectOwner(p.id);
    const btn = document.createElement('button');
    btn.className = 'nav-item' + (currentView === 'project' && String(currentProjectId) === String(p.id) ? ' active' : '') + (isOwned ? '' : ' shared');
    btn.dataset.view = 'project';
    btn.dataset.projectId = p.id;

    const tile = document.createElement('span');
    tile.className = 'project-nav-tile' + (isOwned ? '' : ' shared-dot');
    tile.style.background = projectTileColor(p);
    tile.textContent = (p.name || '?').trim().charAt(0).toUpperCase() || '?';

    const label = document.createElement('span');
    label.className = 'nav-label';
    label.textContent = p.name;

    const count = document.createElement('span');
    count.className = 'nav-count';
    count.textContent = todos.filter(t => String(t.projectId) === String(p.id)).length;

    btn.append(tile, label, count);
    btn.addEventListener('click', () => { currentProjectId = p.id; setView('project'); });
    projectNavListEl.appendChild(btn);
  });
}

function renderProjectSelect() {
  if (!projectSelectEl) return;
  const prevValue = projectSelectEl.value;
  projectSelectEl.innerHTML = '<option value="">No project</option>';
  projects.forEach(p => {
    if (!canAddTaskTo(p.id)) return;
    const opt = document.createElement('option');
    opt.value = p.id;
    opt.textContent = p.name;
    projectSelectEl.appendChild(opt);
  });
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
  return {
    id: t.id,
    user_id: currentUser ? currentUser.id : null,
    text: t.text,
    desc: t.desc || '',
    done: t.done,
    due: t.due,
    priority: t.priority,
    project_id: t.projectId || null,
  };
}
function projectRemoteRow(p) {
  return { id: p.id, user_id: p.userId || (currentUser ? currentUser.id : null), name: p.name };
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
  else document.getElementById('task-view').style.display = 'block';
}

function setView(view) {
  const collabPanel = document.getElementById('project-collab-panel');
  const collabFab = document.getElementById('collab-fab');
  if (view !== 'project') {
    if (collabPanel) collabPanel.classList.remove('open');
    if (collabFab) collabFab.style.display = 'none';
  }
  closeTaskAdd();
  closePermPopover();

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
    updateTaskFormForView();
    renderCollabPanel();
  }
  renderProjectNav();
  closeSidebar();
}

allTasksBtn.addEventListener('click', (e) => {
  const isChevronClick = e.target === allChevron || allChevron.contains(e.target);
  const isOpen = allSubnav.classList.contains('open');
  allSubnav.classList.toggle('open', !isOpen);
  allChevron.classList.toggle('open', !isOpen);

  if (isChevronClick) return;
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
  else if (currentView === 'project') filtered = filtered.filter(t => String(t.projectId) === String(currentProjectId));
  const priorityRank = { high: 0, medium: 1, low: 2 };
  filtered.sort((a, b) => {
    if (a.done !== b.done) return a.done ? 1 : -1;
    if (priorityRank[a.priority] !== priorityRank[b.priority]) return priorityRank[a.priority] - priorityRank[b.priority];
    return (a.due || '9999').localeCompare(b.due || '9999');
  });
  return filtered;
}

const ICON_CALENDAR = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="18" rx="3"></rect><path d="M16 2v4M8 2v4M3 10h18"></path></svg>';
const ICON_FOLDER = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"></path></svg>';
const ICON_PEOPLE = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"></path><circle cx="9" cy="7" r="4"></circle><path d="M23 21v-2a4 4 0 0 0-3-3.87"></path><path d="M16 3.13a4 4 0 0 1 0 7.75"></path></svg>';
const ICON_PENCIL = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9"></path><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4Z"></path></svg>';
const ICON_TRASH = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"></path><path d="M10 11v6"></path><path d="M14 11v6"></path><path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"></path></svg>';
const ICON_SHIELD = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"></path><polyline points="9 12 11 14 15 10"></polyline></svg>';

function pillIcon(svgMarkup) {
  const span = document.createElement('span');
  span.className = 'pill-icon';
  span.innerHTML = svgMarkup;
  return span;
}

function renderTodos() {
  const filtered = getFilteredTodos();
  todoListEl.innerHTML = '';
  emptyState.style.display = filtered.length ? 'none' : 'block';
  const todayKey = todayStr();

  filtered.forEach(t => {
    const canToggle = canToggleTaskIn(t.projectId);
    const canRemove = canRemoveTaskFrom(t.projectId);
    const canRename = canRenameTaskIn(t.projectId);

    const card = document.createElement('div');
    card.className = `task-card priority-${t.priority}` + (t.done ? ' completed' : '');

    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    checkbox.className = 'task-check';
    checkbox.checked = t.done;
    checkbox.disabled = !canToggle;
    checkbox.addEventListener('change', () => {
      const wasDone = t.done;
      t.done = checkbox.checked;
      if (!wasDone && t.done) recordCompletion();
      saveTodos(); renderTodos(); renderCounts();
      if (currentUser) dbUpdate('todos', t.id, { done: t.done });
      if (t.done) showToast('complete');
    });

    const main = document.createElement('div');
    main.className = 'task-main';

    const titleRow = document.createElement('div');
    titleRow.className = 'task-title-row';
    if (t.priority === 'high' || t.priority === 'medium') {
      const dot = document.createElement('span');
      dot.className = `task-priority-dot priority-${t.priority}`;
      dot.title = t.priority === 'high' ? 'High priority' : 'Medium priority';
      titleRow.appendChild(dot);
    }
    const title = document.createElement('div');
    title.className = 'task-title';
    title.textContent = t.text;
    titleRow.appendChild(title);
    main.appendChild(titleRow);

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
      due.appendChild(pillIcon(ICON_CALENDAR));
      const dueText = document.createElement('span');
      dueText.textContent = t.due;
      due.appendChild(dueText);
      meta.appendChild(due);
    }
    if (t.projectId && currentView !== 'project') {
      const p = getProject(t.projectId);
      if (p) {
        const shared = !isProjectOwner(p.id);
        const tag = document.createElement('span');
        tag.className = 'task-pill project-tag' + (shared ? ' shared-tag' : '');
        tag.appendChild(pillIcon(shared ? ICON_PEOPLE : ICON_FOLDER));
        const tagText = document.createElement('span');
        tagText.textContent = p.name;
        tag.appendChild(tagText);
        tag.addEventListener('click', () => { currentProjectId = p.id; setView('project'); });
        meta.appendChild(tag);
      }
    }
    if (meta.children.length) main.appendChild(meta);

    const actions = document.createElement('div');
    actions.className = 'task-card-actions';

    if (canRename) {
      const pencil = document.createElement('button');
      pencil.type = 'button';
      pencil.className = 'task-icon-btn';
      pencil.title = 'Rename task';
      pencil.innerHTML = ICON_PENCIL;
      pencil.addEventListener('click', () => startInlineEdit(title, t));
      actions.appendChild(pencil);
    }
    if (canRemove) {
      const del = document.createElement('button');
      del.type = 'button';
      del.className = 'task-icon-btn delete-btn';
      del.title = 'Delete task';
      del.innerHTML = ICON_TRASH;
      del.addEventListener('click', () => {
        todos = todos.filter(x => x.id !== t.id);
        saveTodos(); renderTodos(); renderCounts(); renderProjectNav();
        if (currentUser) dbDelete('todos', t.id);
      });
      actions.appendChild(del);
    }

    card.append(checkbox, main, actions);
    todoListEl.appendChild(card);
  });
}

function startInlineEdit(titleEl, t) {
  const editInput = document.createElement('input');
  editInput.type = 'text';
  editInput.className = 'task-title-edit';
  editInput.value = t.text;
  titleEl.replaceWith(editInput);
  editInput.focus(); editInput.select();
  let done = false;
  const commit = () => {
    if (done) return;
    done = true;
    const v = editInput.value.trim();
    if (v && v !== t.text) {
      t.text = v;
      saveTodos();
      if (currentUser) dbUpdate('todos', t.id, { text: v });
    }
    renderTodos();
  };
  editInput.addEventListener('blur', commit);
  editInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); editInput.blur(); }
    if (e.key === 'Escape') { editInput.value = t.text; editInput.blur(); }
  });
}

function renderCounts() {
  document.getElementById('count-all').textContent = todos.length;
  document.getElementById('count-today').textContent = todos.filter(t => t.due === todayStr()).length;
  document.getElementById('count-active').textContent = todos.filter(t => !t.done).length;
  document.getElementById('count-completed').textContent = todos.filter(t => t.done).length;
  renderHomeSummary();
}

function renderViewHeader() {
  const titles = { all: 'Home', today: 'Today', active: 'Active', completed: 'Completed' };
  if (currentView === 'project') {
    const p = getProject(currentProjectId);
    viewTitle.textContent = p ? p.name : 'Project';
    projectHeaderActions.style.display = 'flex';
    const mayRename = canRenameProject(currentProjectId);
    projectRenameBtn.style.display = mayRename ? 'inline-flex' : 'none';
    projectDeleteBtn.style.display = isProjectOwner(currentProjectId) ? 'inline-flex' : 'none';
  } else {
    viewTitle.textContent = titles[currentView] || 'Tasks';
    projectHeaderActions.style.display = 'none';
  }
  if (currentView === 'all') {
    viewSubtitle.textContent = '';
    if (mainHeaderEl) mainHeaderEl.style.display = 'none';
  } else {
    const remaining = getFilteredTodos().filter(t => !t.done).length;
    viewSubtitle.textContent = `${remaining} remaining`;
    if (mainHeaderEl) mainHeaderEl.style.display = '';
  }
  renderHomeSummary();
}

const COMPLETION_LOG_KEY = 'aschertypeCompletionLog';
function loadCompletionLog() {
  try { return JSON.parse(localStorage.getItem(COMPLETION_LOG_KEY) || '[]'); }
  catch (err) { return []; }
}
function recordCompletion() {
  const cutoff = Date.now() - 30 * 24 * 60 * 60 * 1000;
  const log = loadCompletionLog().filter((ts) => ts > cutoff);
  log.push(Date.now());
  try { localStorage.setItem(COMPLETION_LOG_KEY, JSON.stringify(log)); } catch (err) { /* ignore */ }
}
function startOfWeek(date) {
  const d = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  const day = d.getDay();
  const diffToMonday = day === 0 ? 6 : day - 1;
  d.setDate(d.getDate() - diffToMonday);
  return d.getTime();
}
function completedThisWeekCount() {
  const weekStart = startOfWeek(new Date());
  return loadCompletionLog().filter((ts) => ts >= weekStart).length;
}
function homeGreeting() {
  const h = new Date().getHours();
  if (h < 5) return 'Still up';
  if (h < 12) return 'Good morning';
  if (h < 17) return 'Good afternoon';
  return 'Good evening';
}
function renderHomeSummary() {
  const homeSummary = document.getElementById('home-summary');
  if (!homeSummary) return;
  if (currentView !== 'all') { homeSummary.style.display = 'none'; return; }
  homeSummary.style.display = 'block';

  const dateLabel = new Date().toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' });
  document.getElementById('home-greeting').innerHTML =
    `${homeGreeting()}<span class="home-date">${dateLabel}</span>`;

  const todayKey = todayStr();
  document.getElementById('home-pulse-today').textContent =
    todos.filter((t) => t.due === todayKey && !t.done).length;
  document.getElementById('home-pulse-active').textContent =
    todos.filter((t) => !t.done).length;
  document.getElementById('home-pulse-week').textContent = completedThisWeekCount();
}

function updateTaskFormForView() {
  const canAdd = currentView !== 'project' ? true : canAddTaskTo(currentProjectId);
  document.getElementById('task-add').style.display = canAdd ? '' : 'none';
  if (!canAdd) closeTaskAdd();
}

form.addEventListener('submit', (e) => {
  e.preventDefault();
  const text = input.value.trim();
  if (!text) return;
  const projectId = projectSelectEl.value ? Number(projectSelectEl.value) : null;
  if (!canAddTaskTo(projectId)) return;
  const newTodo = {
    id: Date.now(), text, desc: descInput.value.trim(), done: false,
    due: dueInput.value || null, priority: priorityInput.value, projectId,
  };
  todos.push(newTodo);
  saveTodos();
  renderTodos(); renderCounts(); renderViewHeader(); renderProjectNav();
  if (currentUser) dbUpsert('todos', todoRemoteRow(newTodo));
  showToast('add');
  closeTaskAdd();
});

clearBtn.addEventListener('click', () => {
  todos = todos.filter(t => !t.done);
  saveTodos();
  renderTodos(); renderCounts(); renderViewHeader(); renderProjectNav();
  if (currentUser) dbDeleteWhere('todos', currentUser.id, { done: true });
});

// ===== Permissions popover =====
const permPopover = document.getElementById('perm-popover');
let permPopoverMember = null;

function isPermPopoverOpen() {
  return permPopover.style.display === 'flex';
}

function openPermPopover(member, anchorEl) {
  permPopoverMember = member;
  document.getElementById('perm-popover-email').textContent = member.member_email;
  permPopover.querySelectorAll('input[data-perm]').forEach(cb => {
    cb.checked = !!member[cb.dataset.perm];
    cb.disabled = false;
  });
  permPopover.style.display = 'flex';
  positionPermPopover(anchorEl);
}

function closePermPopover() {
  permPopover.style.display = 'none';
  permPopoverMember = null;
}

function positionPermPopover(anchorEl) {
  if (!anchorEl) return;
  const rect = anchorEl.getBoundingClientRect();
  const popRect = permPopover.getBoundingClientRect();
  let top = rect.bottom + 6;
  let left = rect.left + rect.width - popRect.width;
  if (top + popRect.height > window.innerHeight - 12) {
    top = rect.top - popRect.height - 6;
  }
  if (left < 12) left = 12;
  if (left + popRect.width > window.innerWidth - 12) {
    left = window.innerWidth - popRect.width - 12;
  }
  permPopover.style.top = top + 'px';
  permPopover.style.left = left + 'px';
}

permPopover.querySelectorAll('input[data-perm]').forEach(cb => {
  cb.addEventListener('change', async () => {
    if (!permPopoverMember) return;
    const key = cb.dataset.perm;
    const value = cb.checked;
    cb.disabled = true;
    const { error } = await dbUpdateProjectMember(permPopoverMember.id, { [key]: value });
    cb.disabled = false;
    if (error) { cb.checked = !value; return; }
    const local = projectMembers.find(m => String(m.id) === String(permPopoverMember.id));
    if (local) {
      local[key] = value;
      permPopoverMember = local;
    } else {
      permPopoverMember[key] = value;
    }
    renderCollabPanel();
    const newAnchor = document.querySelector(`.collab-member[data-member-id="${permPopoverMember.id}"] .collab-perm-btn`);
    if (newAnchor) positionPermPopover(newAnchor);
    showToast('permission');
  });
});

document.addEventListener('click', (e) => {
  if (!isPermPopoverOpen()) return;
  if (permPopover.contains(e.target)) return;
  if (e.target.closest('.collab-perm-btn')) return;
  closePermPopover();
});
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && isPermPopoverOpen()) closePermPopover();
});
window.addEventListener('resize', () => {
  if (isPermPopoverOpen()) closePermPopover();
});

// ===== Collaborator panel + FAB =====
const collabPanel = document.getElementById('project-collab-panel');
const collabBody = document.getElementById('collab-body');
const collabEmpty = document.getElementById('collab-empty');
const collabInviteBtn = document.getElementById('collab-invite-btn');
const collabBackdrop = document.getElementById('collab-backdrop');
const collabFab = document.getElementById('collab-fab');
const collabFabCount = document.getElementById('collab-fab-count');
const projectViewLayout = document.getElementById('project-view-layout');

function isNarrowLayout() {
  return window.matchMedia('(max-width: 1200px)').matches;
}

function updateCollabFabVisibility() {
  if (!collabFab) return;
  if (currentView !== 'project' || !currentProjectId || !currentUser || !isNarrowLayout()) {
    collabFab.style.display = 'none';
    return;
  }
  const members = membersForProject(currentProjectId).filter(m => m.status === 'accepted');
  const n = members.length + 1;
  collabFab.style.display = 'flex';
  if (n > 1) {
    collabFabCount.textContent = String(n);
    collabFabCount.style.display = 'flex';
  } else {
    collabFabCount.style.display = 'none';
  }
}

collabFab.addEventListener('click', () => {
  collabPanel.classList.add('open');
});
collabBackdrop.addEventListener('click', () => {
  collabPanel.classList.remove('open');
  closePermPopover();
});

function renderCollabPanel() {
  if (!collabPanel) return;
  if (currentView !== 'project' || !currentProjectId || !currentUser) {
    collabPanel.style.display = 'none';
    projectViewLayout.classList.remove('with-collab');
    updateCollabFabVisibility();
    closePermPopover();
    return;
  }
  const members = membersForProject(currentProjectId);
  const ownerIsMe = isProjectOwner(currentProjectId);
  const myMem = myMembership(currentProjectId);
  if (!members.length && !ownerIsMe && !myMem) {
    collabPanel.style.display = 'none';
    projectViewLayout.classList.remove('with-collab');
    updateCollabFabVisibility();
    closePermPopover();
    return;
  }

  collabPanel.style.display = '';
  projectViewLayout.classList.add('with-collab');
  collabInviteBtn.style.display = ownerIsMe ? 'flex' : 'none';

  collabBody.innerHTML = '';

  const ownerRow = document.createElement('div');
  ownerRow.className = 'collab-member owner';
  const ownerName = ownerIsMe ? profileDisplayName() + ' (you)' : 'Project owner';
  const ownerInitial = ownerIsMe ? profileInitial() : 'O';
  ownerRow.innerHTML = `
    <div class="collab-avatar owner-avatar">${escapeHtml(ownerInitial)}</div>
    <div class="collab-info">
      <div class="collab-email">${escapeHtml(ownerName)}</div>
      <div class="collab-role">Owner</div>
    </div>
  `;
  collabBody.appendChild(ownerRow);

  const accepted = members.filter(m => m.status === 'accepted');
  const pending = members.filter(m => m.status === 'pending');

  collabEmpty.style.display = members.length ? 'none' : 'block';

  accepted.forEach(m => collabBody.appendChild(buildMemberRow(m, ownerIsMe)));
  pending.forEach(m => collabBody.appendChild(buildMemberRow(m, ownerIsMe)));

  updateCollabFabVisibility();
}

function buildMemberRow(m, ownerIsMe) {
  const row = document.createElement('div');
  row.className = 'collab-member';
  row.dataset.memberId = m.id;
  const initial = (m.member_email || '?').charAt(0).toUpperCase();

  const avatar = document.createElement('div');
  avatar.className = 'collab-avatar';
  avatar.textContent = initial;

  const info = document.createElement('div');
  info.className = 'collab-info';

  const emailEl = document.createElement('div');
  emailEl.className = 'collab-email';
  emailEl.textContent = m.member_email;
  info.appendChild(emailEl);

  const roleEl = document.createElement('div');
  roleEl.className = 'collab-role';

  const perms = [];
  if (m.can_add_task) perms.push('add');
  if (m.can_rename_task) perms.push('rename');
  if (m.can_remove_task) perms.push('remove');
  if (m.can_rename_project) perms.push('rename project');

  if (m.status === 'pending') {
    roleEl.textContent = 'Pending';
  } else if (perms.length) {
    roleEl.textContent = 'Can ' + perms.join(', ');
  } else {
    roleEl.textContent = 'Check off only';
  }
  info.appendChild(roleEl);

  row.append(avatar, info);

  if (ownerIsMe) {
    const actions = document.createElement('div');
    actions.className = 'collab-actions';

    const permBtn = document.createElement('button');
    permBtn.type = 'button';
    permBtn.className = 'collab-action-btn collab-perm-btn';
    permBtn.title = 'Permissions';
    permBtn.setAttribute('aria-label', 'Permissions');
    permBtn.innerHTML = ICON_SHIELD;
    permBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      if (permPopoverMember && String(permPopoverMember.id) === String(m.id) && isPermPopoverOpen()) {
        closePermPopover();
      } else {
        openPermPopover(m, permBtn);
      }
    });

    const removeBtn = document.createElement('button');
    removeBtn.type = 'button';
    removeBtn.className = 'collab-action-btn danger';
    removeBtn.title = 'Remove collaborator';
    removeBtn.textContent = '×';
    removeBtn.addEventListener('click', () => removeMember(m));

    actions.append(permBtn, removeBtn);
    row.appendChild(actions);
  }

  return row;
}

async function removeMember(member) {
  if (!confirm(`Remove ${member.member_email} from this project?`)) return;
  closePermPopover();
  const { error } = await dbDeleteProjectMember(member.id);
  if (error) return;
  await refreshSharedData();
}
collabInviteBtn.addEventListener('click', () => openInviteModal());

// ===== Invite modal =====
const inviteOverlay = document.getElementById('invite-overlay');
const inviteEmailInput = document.getElementById('invite-email');
const inviteErrorEl = document.getElementById('invite-error');
const inviteSendBtn = document.getElementById('invite-send-btn');

function showInviteError(msg) {
  inviteErrorEl.textContent = msg;
  inviteErrorEl.style.display = msg ? 'block' : 'none';
}
function openInviteModal() {
  if (!currentUser || !supabaseReady) {
    alert('Sign in with an account to invite collaborators.');
    return;
  }
  if (!isProjectOwner(currentProjectId)) return;

  inviteEmailInput.value = '';
  inviteEmailInput.readOnly = false;
  document.getElementById('invite-can-add-task').checked = false;
  document.getElementById('invite-can-rename-task').checked = false;
  document.getElementById('invite-can-remove-task').checked = false;
  document.getElementById('invite-can-rename-project').checked = false;
  inviteSendBtn.textContent = 'Send invite';
  showInviteError('');
  inviteOverlay.style.display = 'flex';
  setTimeout(() => inviteEmailInput.focus(), 30);
}
function closeInviteModal() {
  inviteOverlay.style.display = 'none';
  showInviteError('');
}

document.getElementById('invite-close-btn').addEventListener('click', closeInviteModal);
document.getElementById('invite-cancel-btn').addEventListener('click', closeInviteModal);
inviteOverlay.addEventListener('click', (e) => { if (e.target === inviteOverlay) closeInviteModal(); });

inviteSendBtn.addEventListener('click', async () => {
  const email = inviteEmailInput.value.trim().toLowerCase();
  const perms = {
    can_add_task: document.getElementById('invite-can-add-task').checked,
    can_rename_task: document.getElementById('invite-can-rename-task').checked,
    can_remove_task: document.getElementById('invite-can-remove-task').checked,
    can_rename_project: document.getElementById('invite-can-rename-project').checked,
  };
  showInviteError('');
  if (!isPlausibleEmail(email)) { showInviteError('Enter a valid email address.'); return; }
  if (email === (currentUser.email || '').toLowerCase()) { showInviteError("That's your own email address."); return; }

  setButtonBusy(inviteSendBtn, 'Saving…');
  const row = {
    project_id: currentProjectId,
    owner_id: currentUser.id,
    member_email: email,
    status: 'pending',
    ...perms,
  };
  const { error } = await dbUpsertProjectMember(row);
  clearButtonBusy(inviteSendBtn);
  if (error) { showInviteError(error.message || 'Could not send invite.'); return; }
  showToast('invite');

  closeInviteModal();
  await refreshSharedData();
  await loadNotifications();
});

// ===== Notification inbox =====
const notifBell = document.getElementById('notif-bell');
const mobileNotifBell = document.getElementById('mobile-notif-bell');
const notifCountEl = document.getElementById('notif-count');
const mobileNotifCountEl = document.getElementById('mobile-notif-count');
const notifOverlay = document.getElementById('notif-overlay');
const notifListEl = document.getElementById('notif-list');

function renderNotifBadge() {
  if (!currentUser) {
    notifBell.classList.add('hidden');
    mobileNotifBell.style.display = 'none';
    return;
  }
  notifBell.classList.remove('hidden');
  mobileNotifBell.style.display = 'flex';
  const unread = notifications.filter(n => !n.read).length;
  const txt = unread > 9 ? '9+' : String(unread);
  if (unread > 0) {
    notifCountEl.textContent = txt; notifCountEl.style.display = 'flex';
    mobileNotifCountEl.textContent = txt; mobileNotifCountEl.style.display = 'flex';
  } else {
    notifCountEl.style.display = 'none';
    mobileNotifCountEl.style.display = 'none';
  }
}

function formatNotifTime(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  const diff = Date.now() - d.getTime();
  if (diff < 60000) return 'Just now';
  if (diff < 3600000) return Math.floor(diff / 60000) + 'm ago';
  if (diff < 86400000) return Math.floor(diff / 3600000) + 'h ago';
  if (diff < 604800000) return Math.floor(diff / 86400000) + 'd ago';
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

function renderNotifList() {
  if (!notifListEl) return;
  notifListEl.innerHTML = '';
  if (!currentUser) {
    notifListEl.innerHTML = '<div class="notif-empty">Sign in to receive notifications.</div>';
    return;
  }
  if (!notifications.length) {
    notifListEl.innerHTML = '<div class="notif-empty">You\'re all caught up.</div>';
    return;
  }
  notifications.forEach(n => {
    const item = document.createElement('div');
    item.className = 'notif-item' + (n.read ? '' : ' unread');

    const top = document.createElement('div');
    top.className = 'notif-item-top';
    const title = document.createElement('div');
    title.className = 'notif-item-title';
    title.textContent = n.title;
    top.appendChild(title);
    if (!n.read) {
      const dot = document.createElement('span');
      dot.className = 'notif-item-dot';
      top.appendChild(dot);
    }
    item.appendChild(top);

    if (n.body) {
      const body = document.createElement('div');
      body.className = 'notif-item-body';
      body.textContent = n.body;
      item.appendChild(body);
    }
    const time = document.createElement('div');
    time.className = 'notif-item-time';
    time.textContent = formatNotifTime(n.created_at);
    item.appendChild(time);

    if (n.type === 'invite' && n.member_row_id) {
      const member = projectMembers.find(m => String(m.id) === String(n.member_row_id));
      if (member && member.status === 'pending') {
        const actions = document.createElement('div');
        actions.className = 'notif-item-actions';
        const accept = document.createElement('button');
        accept.type = 'button';
        accept.className = 'btn primary small';
        accept.textContent = 'Accept';
        accept.addEventListener('click', (ev) => { ev.stopPropagation(); respondToInvite(n, member.id, true); });
        const decline = document.createElement('button');
        decline.type = 'button';
        decline.className = 'btn small';
        decline.textContent = 'Decline';
        decline.addEventListener('click', (ev) => { ev.stopPropagation(); respondToInvite(n, member.id, false); });
        actions.append(accept, decline);
        item.appendChild(actions);
      } else if (member) {
        const status = document.createElement('div');
        status.className = 'notif-item-status';
        status.textContent = member.status === 'accepted' ? 'Accepted' : 'Declined';
        item.appendChild(status);
      }
    }

    item.addEventListener('click', async () => {
      if (n.read) return;
      n.read = true;
      renderNotifBadge();
      item.classList.remove('unread');
      await dbMarkNotificationRead(n.id);
    });

    notifListEl.appendChild(item);
  });
}

async function respondToInvite(notif, memberRowId, accept) {
  const { error } = await dbRespondToInvite(memberRowId, accept);
  if (error) return;
  notif.read = true;
  await dbMarkNotificationRead(notif.id);
  await refreshSharedData();
  await loadNotifications();
  showToast(accept ? 'invite' : 'permission');
}

function openNotifModal() {
  notifOverlay.style.display = 'flex';
  renderNotifList();
  if (currentUser && supabaseReady) loadNotifications();
}
notifBell.addEventListener('click', openNotifModal);
mobileNotifBell.addEventListener('click', openNotifModal);
document.getElementById('notif-close-btn').addEventListener('click', () => { notifOverlay.style.display = 'none'; });
notifOverlay.addEventListener('click', (e) => { if (e.target === notifOverlay) notifOverlay.style.display = 'none'; });

document.getElementById('notif-mark-all-btn').addEventListener('click', async () => {
  const unread = notifications.filter(n => !n.read);
  for (const n of unread) { n.read = true; await dbMarkNotificationRead(n.id); }
  renderNotifBadge(); renderNotifList();
});

async function loadNotifications() {
  if (!supabaseReady || !currentUser) {
    notifications = [];
    renderNotifBadge();
    renderNotifList();
    return;
  }
  const data = await dbFetchNotifications();
  if (data) notifications = data;
  renderNotifBadge();
  renderNotifList();
}

// ===== Refresh shared data =====
async function refreshSharedData() {
  if (!supabaseReady || !currentUser) return;
  const [remoteProjects, remoteTodos, remoteMembers] = await Promise.all([
    dbFetchProjects(),
    dbFetchTodos(),
    dbFetchProjectMembers(),
  ]);
  if (remoteProjects) {
    projects = remoteProjects.map(p => ({ id: p.id, name: p.name, userId: p.user_id }));
    saveProjects();
  }
  if (remoteTodos) {
    todos = remoteTodos.map(t => ({
      id: t.id, text: t.text, desc: t.desc, done: t.done,
      due: t.due, priority: t.priority, projectId: t.project_id || null,
    }));
    saveTodos();
  }
  if (remoteMembers) projectMembers = remoteMembers;

  if (currentView === 'project' && currentProjectId && !getProject(currentProjectId)) {
    currentProjectId = null;
    currentView = 'all';
  }

  renderProjectNav();
  renderProjectSelect();
  renderTodos();
  renderCounts();
  renderViewHeader();
  updateTaskFormForView();
  renderCollabPanel();
}

setInterval(() => { if (currentUser && supabaseReady) refreshSharedData(); }, 60000);
setInterval(() => { if (currentUser && supabaseReady) loadNotifications(); }, 45000);
window.addEventListener('focus', () => {
  if (!currentUser || !supabaseReady) return;
  refreshSharedData();
  loadNotifications();
});

window.addEventListener('resize', () => {
  updateCollabFabVisibility();
  if (profilePopover.style.display === 'flex') positionProfilePopover();
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
    empty.textContent = 'Nothing scheduled.';
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
    id: Date.now(), title,
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

// ===== Closeout =====
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
  if (currentView === 'calendar') renderCalendar();
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
  if (!already && nowHM >= target && unfinishedForCloseout().length > 0) openCloseout();
}
setInterval(maybeAutoOpenCloseout, 60 * 1000);

// ===== Realtime: live sync across devices =====
let realtimeRenderTimer = null;
function debouncedSharedRender() {
  if (realtimeRenderTimer) clearTimeout(realtimeRenderTimer);
  realtimeRenderTimer = setTimeout(() => {
    realtimeRenderTimer = null;
    renderTodos();
    renderCounts();
    renderViewHeader();
    renderProjectNav();
    renderProjectSelect();
  }, 120);
}

function handleRealtimeTodo(payload) {
  const eventType = payload.eventType;
  const row = payload.new || payload.old;
  if (!row || row.id == null) return;

  if (eventType === 'DELETE') {
    const before = todos.length;
    todos = todos.filter(t => String(t.id) !== String(row.id));
    if (todos.length !== before) {
      saveTodos();
      debouncedSharedRender();
    }
    return;
  }

  const mapped = {
    id: row.id,
    text: row.text,
    desc: row.desc,
    done: row.done,
    due: row.due,
    priority: row.priority,
    projectId: row.project_id || null,
  };
  const idx = todos.findIndex(t => String(t.id) === String(mapped.id));
  if (idx >= 0) todos[idx] = mapped;
  else todos.push(mapped);
  saveTodos();
  debouncedSharedRender();
}

function handleRealtimeProject(payload) {
  const eventType = payload.eventType;
  const row = payload.new || payload.old;
  if (!row || row.id == null) return;

  if (eventType === 'DELETE') {
    const existed = projects.some(p => String(p.id) === String(row.id));
    projects = projects.filter(p => String(p.id) !== String(row.id));

    let touched = false;
    todos.forEach(t => {
      if (String(t.projectId) === String(row.id)) { t.projectId = null; touched = true; }
    });
    if (touched) saveTodos();
    saveProjects();

    if (String(currentProjectId) === String(row.id)) {
      currentProjectId = null;
      currentView = 'all';
      showView('all');
      updateTaskFormForView();
      renderViewHeader();
    }

    renderProjectNav();
    renderProjectSelect();
    renderCollabPanel();
    if (existed) debouncedSharedRender();

    setTimeout(refreshSharedData, 400);
    return;
  }

  const mapped = { id: row.id, name: row.name, userId: row.user_id };
  const idx = projects.findIndex(p => String(p.id) === String(mapped.id));
  if (idx >= 0) projects[idx] = mapped;
  else projects.push(mapped);
  saveProjects();
  renderProjectNav();
  renderProjectSelect();
  if (String(currentProjectId) === String(mapped.id)) {
    renderViewHeader();
  }
}

function handleRealtimeMember(payload) {
  const eventType = payload.eventType;
  const row = payload.new || payload.old;
  if (!row || row.id == null) return;

  const pid = row.project_id != null ? String(row.project_id) : null;

  if (eventType === 'DELETE') {
    projectMembers = projectMembers.filter(m => String(m.id) !== String(row.id));

    const mineById = row.member_id && currentUser && String(row.member_id) === String(currentUser.id);
    const mineByEmail = row.member_email && currentUser &&
      String(row.member_email).toLowerCase() === String(currentUser.email || '').toLowerCase();
    const wasMine = !!(mineById || mineByEmail);

    if (wasMine && pid) {
      const existed = projects.some(p => String(p.id) === pid);
      projects = projects.filter(p => String(p.id) !== pid);
      saveProjects();
      if (String(currentProjectId) === pid) {
        currentProjectId = null;
        currentView = 'all';
        showView('all');
        updateTaskFormForView();
        renderViewHeader();
      }
      if (existed) renderProjectNav();
      renderProjectSelect();
      debouncedSharedRender();
    }

    renderCollabPanel();
    renderProjectNav();

    if (!wasMine || !pid) {
      setTimeout(refreshSharedData, 400);
    }
    return;
  }

  const idx = projectMembers.findIndex(m => String(m.id) === String(row.id));
  if (idx >= 0) projectMembers[idx] = row;
  else projectMembers.push(row);

  const isMine =
    (row.member_id && currentUser && String(row.member_id) === String(currentUser.id)) ||
    (row.member_email && currentUser && String(row.member_email).toLowerCase() === String(currentUser.email || '').toLowerCase());

  if (isMine && row.status === 'accepted' && pid) {
    const haveProject = projects.some(p => String(p.id) === pid);
    if (!haveProject) {
      dbFetchProjects().then((data) => {
        if (!data) return;
        projects = data.map(p => ({ id: p.id, name: p.name, userId: p.user_id }));
        saveProjects();
        renderProjectNav();
        renderProjectSelect();
      });
    }
  }

  renderCollabPanel();
  renderProjectNav();
}

function handleRealtimeNotification(payload) {
  const eventType = payload.eventType;
  const row = payload.new || payload.old;
  if (!row || row.id == null) return;

  if (eventType === 'DELETE') {
    notifications = notifications.filter(n => String(n.id) !== String(row.id));
  } else {
    const idx = notifications.findIndex(n => String(n.id) === String(row.id));
    if (idx >= 0) {
      notifications[idx] = row;
    } else {
      notifications.unshift(row);
      if (notifications.length > 60) notifications.pop();
      playNotificationSound();
    }
  }
  renderNotifBadge();
  renderNotifList();
}

function handleRealtimeNote(payload) {
  const eventType = payload.eventType;
  const row = payload.new || payload.old;
  if (!row || row.id == null) return;

  if (row.user_id && currentUser && String(row.user_id) !== String(currentUser.id)) return;

  if (eventType === 'DELETE') {
    const before = notes.length;
    notes = notes.filter(n => String(n.id) !== String(row.id));
    if (notes.length !== before) {
      saveNotes();
      renderNotes();
    }
    return;
  }

  const mapped = {
    id: row.id,
    title: row.title,
    category: row.category,
    desc: row.desc || '',
    content: row.content || '',
    createdAt: row.created_at || new Date().toISOString(),
  };
  const idx = notes.findIndex(n => String(n.id) === String(mapped.id));
  if (idx >= 0) notes[idx] = mapped;
  else notes.push(mapped);
  saveNotes();
  renderNotes();
  if (mapped.category && !noteCategories.includes(mapped.category)) {
    noteCategories.push(mapped.category);
    saveNoteCategories();
    renderCategoryTabs();
    renderNoteCategorySelect();
  }
}

function handleRealtimeEvent(payload) {
  const eventType = payload.eventType;
  const row = payload.new || payload.old;
  if (!row || row.id == null) return;

  if (row.user_id && currentUser && String(row.user_id) !== String(currentUser.id)) return;

  if (eventType === 'DELETE') {
    const before = events.length;
    events = events.filter(e => String(e.id) !== String(row.id));
    if (events.length !== before) {
      saveEvents();
      renderCalendar();
      renderDayPanel();
    }
    return;
  }

  const mapped = {
    id: row.id,
    date: row.date,
    time: row.time,
    title: row.title,
    notes: row.notes || '',
  };
  const idx = events.findIndex(e => String(e.id) === String(mapped.id));
  if (idx >= 0) events[idx] = mapped;
  else events.push(mapped);
  saveEvents();
  renderCalendar();
  renderDayPanel();
}

function attachRealtimeSubscriptions() {
  if (!supabaseReady || !currentUser) return;
  setupRealtime({
    onTodo: handleRealtimeTodo,
    onProject: handleRealtimeProject,
    onMember: handleRealtimeMember,
    onNotification: handleRealtimeNotification,
    onNote: handleRealtimeNote,
    onEvent: handleRealtimeEvent,
  });
}

function detachRealtimeSubscriptions() {
  if (typeof teardownRealtime === 'function') teardownRealtime();
}

// ===== Loading screen (staged) =====
const loadingScreen = document.getElementById('loading-screen');
const loadingContinueBtn = document.getElementById('loading-continue');
const statusDotEl = document.getElementById('status-dot');
const statusTextEl = document.getElementById('status-text');

let loadingDismissed = false;
let loadingReady = false;

function setLoadingStage(text) {
  if (!statusTextEl) return;
  if (statusTextEl.textContent === text) return;
  statusTextEl.style.opacity = '0';
  setTimeout(() => {
    statusTextEl.textContent = text;
    statusTextEl.style.opacity = '1';
  }, 140);
}

function markLoadingReady() {
  if (loadingReady) return;
  loadingReady = true;
  setLoadingStage('Ready');
  loadingContinueBtn.classList.add('ready');
  // Auto-dismiss shortly after ready so the user doesn't have to tap.
  setTimeout(() => {
    if (!loadingDismissed) dismissLoading();
  }, 800);
}

function dismissLoading() {
  if (loadingDismissed) return;
  loadingDismissed = true;
  unlockAudioContext();
  loadingScreen.classList.add('hidden');
}
// Exposed so auth.js can dismiss the loading overlay on the
// "no session -> show sign-in card" path, where window.initApp()
// never runs. Without this the overlay sits on top of the auth
// screen forever and the app looks stuck on "Connecting…".
window.dismissLoading = dismissLoading;
loadingScreen.addEventListener('click', dismissLoading);
loadingContinueBtn.addEventListener('click', (e) => { e.stopPropagation(); dismissLoading(); });

function updateConnectionStatus() {
  const online = typeof navigator !== 'undefined' ? navigator.onLine : true;
  statusDotEl.className = 'status-dot ' + (online ? 'online' : 'offline');
  return online;
}
updateConnectionStatus();
window.addEventListener('online', updateConnectionStatus);
window.addEventListener('offline', updateConnectionStatus);

// ===== Welcome modal (first login only) =====
const WELCOME_KEY = 'aschertypeWelcomeSeen';
const welcomeOverlay = document.getElementById('welcome-overlay');
const welcomeDismissBtn = document.getElementById('welcome-dismiss-btn');

function maybeShowWelcome() {
  if (!welcomeOverlay) return;
  if (localStorage.getItem(WELCOME_KEY) === 'true') return;
  setTimeout(() => {
    welcomeOverlay.style.display = 'flex';
  }, 900);
}
function dismissWelcome() {
  try { localStorage.setItem(WELCOME_KEY, 'true'); } catch (err) { /* ignore */ }
  welcomeOverlay.style.display = 'none';
}
if (welcomeDismissBtn) welcomeDismissBtn.addEventListener('click', dismissWelcome);
if (welcomeOverlay) {
  welcomeOverlay.addEventListener('click', (e) => {
    if (e.target === welcomeOverlay) dismissWelcome();
  });
}

// ===== Tips intro modal (first time the tips bar is shown) =====
const TIPS_INTRO_KEY = 'aschertypeTipsIntroSeen';
const tipsIntroOverlay = document.getElementById('tips-intro-overlay');
const tipsIntroDismissBtn = document.getElementById('tips-intro-dismiss-btn');

function maybeShowTipsIntro() {
  if (!tipsIntroOverlay) return;
  if (!areTipsEnabled()) return;
  if (localStorage.getItem(TIPS_INTRO_KEY) === 'true') return;
  if (welcomeOverlay && welcomeOverlay.style.display === 'flex') return;
  tipsIntroOverlay.style.display = 'flex';
}
function dismissTipsIntro() {
  try { localStorage.setItem(TIPS_INTRO_KEY, 'true'); } catch (err) { /* ignore */ }
  tipsIntroOverlay.style.display = 'none';
}
if (tipsIntroDismissBtn) tipsIntroDismissBtn.addEventListener('click', dismissTipsIntro);
if (tipsIntroOverlay) {
  tipsIntroOverlay.addEventListener('click', (e) => {
    if (e.target === tipsIntroOverlay) dismissTipsIntro();
  });
}

// ===== Startup =====
window.initApp = async function initApp(user) {
  currentUser = user || null;

  setLoadingStage(supabaseReady ? 'Loading your data…' : 'Starting locally…');

  if (currentUser) {
    const [remoteTodos, remoteNotes, remoteEvents, remoteProjects, remoteMembers, remoteNotifs] = await Promise.all([
      dbFetchTodos(),
      dbFetchAll('notes', currentUser.id),
      dbFetchAll('events', currentUser.id),
      dbFetchProjects(),
      dbFetchProjectMembers(),
      dbFetchNotifications(),
    ]);

    if (remoteProjects) {
      projects = remoteProjects.map(p => ({ id: p.id, name: p.name, userId: p.user_id }));
      saveProjects();
    }
    if (remoteTodos) {
      todos = remoteTodos.map(t => ({
        id: t.id, text: t.text, desc: t.desc, done: t.done,
        due: t.due, priority: t.priority, projectId: t.project_id || null,
      }));
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
    if (remoteMembers) projectMembers = remoteMembers;
    if (remoteNotifs) notifications = remoteNotifs;
  } else {
    projectMembers = [];
    notifications = [];
    currentProfile = currentUser ? { id: currentUser.id, email: currentUser.email, display_name: null } : null;
  }

  await loadProfile();

  applyTheme(getTheme());
  renderSettingsUI();
  renderProjectNav();
  renderProjectSelect();
  renderTodos();
  renderCounts();
  renderViewHeader();
  updateTaskFormForView();
  renderCollabPanel();
  updateCollabFabVisibility();
  renderNotifBadge();
  renderNotifList();
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
  attachRealtimeSubscriptions();

  markLoadingReady();

  // After the loading overlay fades, show the welcome modal (first time only),
  // then the tips intro modal (first time tips are shown).
  maybeShowWelcome();

  let waited = 0;
  const tipsCheck = setInterval(() => {
    waited += 400;
    const welcomeOpen = welcomeOverlay && welcomeOverlay.style.display === 'flex';
    if (!welcomeOpen) {
      clearInterval(tipsCheck);
      maybeShowTipsIntro();
    } else if (waited > 20000) {
      clearInterval(tipsCheck);
    }
  }, 400);
};