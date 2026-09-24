// ===== PWA =====
if ('serviceWorker' in navigator && (location.protocol === 'http:' || location.protocol === 'https:')) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./sw.js')
      .then((reg) => console.log('[PWA] SW registered:', reg.scope))
      .catch((err) => console.error('[PWA] SW failed:', err));
  });
}

// ===== Safe localStorage helpers =====
function safeGetItem(key) {
  try { return localStorage.getItem(key); }
  catch (err) { return null; }
}

function safeParse(key, fallback) {
  const raw = safeGetItem(key);
  if (raw === null) return fallback;
  try {
    const parsed = JSON.parse(raw);
    if (parsed === null || parsed === undefined) return fallback;
    return parsed;
  } catch (err) {
    console.warn(`[Aschertype] Corrupted localStorage key "${key}", clearing it.`, err);
    try { localStorage.removeItem(key); } catch (e) { /* ignore */ }
    return fallback;
  }
}

function safeSetItem(key, value) {
  try {
    localStorage.setItem(key, value);
    return true;
  } catch (err) {
    console.warn(`[Aschertype] Could not write "${key}" to localStorage.`, err);
    return false;
  }
}

function safeRemoveItem(key) {
  try { localStorage.removeItem(key); } catch (err) { /* ignore */ }
}

// ===== Theme =====
const THEME_KEY = 'theme';
function getTheme() {
  const stored = safeGetItem(THEME_KEY);
  if (stored === 'light' || stored === 'dark') return stored;
  return (window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches) ? 'dark' : 'light';
}
function applyTheme(mode) {
  document.documentElement.setAttribute('data-theme', mode === 'dark' ? 'dark' : 'light');
  safeSetItem(THEME_KEY, mode);
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
  localStorage.removeItem('aschertypeGuest');
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

let activeProfileAnchor = null;

function isMobileViewport() {
  return window.matchMedia('(max-width: 860px)').matches;
}

function positionProfilePopover() {
  if (isMobileViewport()) {
    profilePopover.style.top = '';
    profilePopover.style.right = '';
    profilePopover.style.left = '';
    return;
  }
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
  localStorage.removeItem('aschertypeGuest');
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
  const v = safeGetItem(ENCOURAGEMENT_KEY);
  return v === null ? true : v === 'true';
}
function setEncouragementEnabled(on) { safeSetItem(ENCOURAGEMENT_KEY, on ? 'true' : 'false'); }

const ENCOURAGEMENT_MESSAGES = {
  add: [{ emoji: '📝', text: 'Added. One less thing to hold in your head.' }],
  complete: [{ emoji: '🎉', text: 'Done! Nice work.' }],
  note: [{ emoji: '🗒️', text: 'Saved — future you will thank you.' }],
  event: [{ emoji: '📅', text: "Added to your calendar. It's handled." }],
  pomodoro: [{ emoji: '🍅', text: 'Focus session complete — take a real break.' }],
  taskDeleted: [{ emoji: '🗑️', text: 'Task deleted.' }],
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

function showSimpleToast({ emoji = 'ℹ️', text, actionLabel, onAction, duration = 3200 } = {}) {
  if (!text) return;
  const el = document.createElement('div');
  el.className = 'toast';
  el.innerHTML = `<span class="toast-emoji">${emoji}</span><span class="toast-text">${escapeHtml(text)}</span>`;
  if (actionLabel && typeof onAction === 'function') {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'toast-action-btn';
    btn.textContent = actionLabel;
    let used = false;
    btn.addEventListener('click', () => {
      if (used) return;
      used = true;
      onAction();
      el.classList.add('leaving');
      setTimeout(() => el.remove(), 320);
    });
    el.appendChild(btn);
  }
  toastContainer.appendChild(el);
  const timer = setTimeout(() => { el.classList.add('leaving'); setTimeout(() => el.remove(), 320); }, duration);
  el.addEventListener('mouseenter', () => clearTimeout(timer));
}

function showUndoToast(text, undoFn) {
  showSimpleToast({ emoji: '🗑️', text, actionLabel: 'Undo', onAction: undoFn, duration: 5500 });
}

// ===== Generic confirm modal =====
const confirmModalOverlay = document.getElementById('confirm-modal-overlay');
const confirmModalTitleEl = document.getElementById('confirm-modal-title');
const confirmModalMessageEl = document.getElementById('confirm-modal-message');
const confirmModalConfirmBtn = document.getElementById('confirm-modal-confirm');
const confirmModalCancelBtn = document.getElementById('confirm-modal-cancel');
let pendingConfirmAction = null;

function openConfirmModal({ title = 'Are you sure?', message = '', confirmLabel = 'Confirm', danger = true, onConfirm } = {}) {
  confirmModalTitleEl.textContent = title;
  confirmModalMessageEl.textContent = message;
  confirmModalConfirmBtn.textContent = confirmLabel;
  confirmModalConfirmBtn.classList.toggle('danger', danger);
  pendingConfirmAction = typeof onConfirm === 'function' ? onConfirm : null;
  confirmModalOverlay.style.display = 'flex';
}
function closeConfirmModal() {
  confirmModalOverlay.style.display = 'none';
  pendingConfirmAction = null;
}
confirmModalCancelBtn.addEventListener('click', closeConfirmModal);
confirmModalOverlay.addEventListener('click', (e) => { if (e.target === confirmModalOverlay) closeConfirmModal(); });
confirmModalConfirmBtn.addEventListener('click', () => {
  const fn = pendingConfirmAction;
  closeConfirmModal();
  if (fn) fn();
});

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
  const v = safeGetItem(NOTIF_ENABLED_KEY);
  return v === null ? true : v === 'true';
}
function setNotifEnabled(on) { safeSetItem(NOTIF_ENABLED_KEY, on ? 'true' : 'false'); }

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
const LOCAL_TIPS = {
  en: [
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
  ],
  id: [
    'Tulis 3 tugas utama besok malam ini — pikiran jadi lebih tenang sebelum tidur.',
    'Napas 4-7-8 bisa meredakan momen yang membuat stres.',
    'Kelompokkan tugas kecil bersamaan; gonta-ganti fokus itu melelahkan.',
    'Berdiri dan meregangkan tubuh 60 detik tiap jam menjaga fokus tetap tajam.',
    'Coba aturan dua menit: jika kurang dari dua menit, kerjakan sekarang.',
    'Jalan kaki sebentar di luar lebih menyegarkan fokus daripada scroll HP.',
    'Fokus pada satu tugas lebih efektif daripada multitasking.',
    'Buat daftar "selesai" di samping daftar tugas — bagus untuk semangat.',
    'Minum air sebelum menambah kopi; dehidrasi ringan mirip rasa lelah.',
    'Progres, bukan kesempurnaan.',
    'Bisukan notifikasi saat sesi fokus berlangsung.',
    'Saat kewalahan, tulis semuanya dulu, baru urutkan.',
    'Meja yang rapi untuk esok pagi membuat mulai kerja lebih mudah.',
    'Ambil istirahat sungguhan: menjauh sejenak memulihkan fokus.',
  ],
};
let lastTipIndex = -1;
function localTip() {
  const lang = window.I18N ? window.I18N.getLanguage() : 'en';
  const list = LOCAL_TIPS[lang] || LOCAL_TIPS.en;
  let i = Math.floor(Math.random() * list.length);
  if (list.length > 1) { while (i === lastTipIndex) i = Math.floor(Math.random() * list.length); }
  lastTipIndex = i;
  return list[i];
}

const TIPS_KEY = 'tipsEnabled';
function areTipsEnabled() {
  const v = safeGetItem(TIPS_KEY);
  return v === null ? true : v === 'true';
}
function setTipsEnabled(on) {
  safeSetItem(TIPS_KEY, on ? 'true' : 'false');
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
  task: safeGetItem('pomodoroTask') || '',
  taskId: (() => { const v = safeGetItem('pomodoroTaskId'); return v ? Number(v) : null; })(),
  workMin: parseInt(safeGetItem('pomodoroWorkMin')) || 25,
  breakMin: parseInt(safeGetItem('pomodoroBreakMin')) || 5,
  mode: 'work', remaining: 0, running: false,
  sessions: parseInt(safeGetItem('pomodoroSessions')) || 0,
};
pomodoro.remaining = pomodoro.workMin * 60;
let pomodoroInterval = null;
let pomodoroUnflushedSec = 0;

const pomodoroStackCurrentText = document.getElementById('pomodoro-stack-current-text');
const pomodoroStackNextText = document.getElementById('pomodoro-stack-next-text');
const pomodoroStackCurrentCard = document.getElementById('pomodoro-stack-current');
const pomodoroStackNextCard = document.getElementById('pomodoro-stack-next');
const pomodoroMarkDoneBtn = document.getElementById('pomodoro-mark-done');
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
function formatDuration(sec) {
  sec = Math.max(0, Math.round(sec || 0));
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  if (h > 0) return m > 0 ? `${h}h ${m}m` : `${h}h`;
  if (m > 0) return `${m}m`;
  return `${sec}s`;
}

function pomodoroTaskLabel(t) {
  if (!t) return '';
  const proj = t.projectId ? getProject(t.projectId) : null;
  return proj ? `${proj.name}: ${t.text}` : t.text;
}

function pomodoroQueueOrder() {
  const priorityRank = { high: 0, medium: 1, low: 2 };
  return todos.filter((t) => !t.done).sort((a, b) => {
    if (priorityRank[a.priority] !== priorityRank[b.priority]) return priorityRank[a.priority] - priorityRank[b.priority];
    return (a.due || '9999').localeCompare(b.due || '9999');
  });
}

function refreshPomodoroQueue() {
  const queue = pomodoroQueueOrder();
  let idx = queue.findIndex((t) => t.id === pomodoro.taskId);
  if (idx === -1) {
    idx = 0;
    const t = queue[0] || null;
    pomodoro.taskId = t ? t.id : null;
    pomodoro.task = t ? t.text : '';
  }
  const nextTask = idx !== -1 ? queue[idx + 1] : null;
  return { current: queue[idx] || null, next: nextTask || null };
}

function renderPomodoro() {
  const translate = (key, fallback) => window.I18N ? window.I18N.t(key, fallback) : fallback;
  pomodoroTimerEl.textContent = formatTime(pomodoro.remaining);
  pomodoroModeLabel.textContent = pomodoro.mode === 'work'
    ? translate('pomodoro.mode.focus', 'Focus session')
    : translate('pomodoro.breakTime', 'Break time');
  pomodoroSessionsEl.textContent = pomodoro.sessions;
  pomodoroStartBtn.disabled = pomodoro.running;
  pomodoroPauseBtn.disabled = !pomodoro.running;
  pomodoroWorkInput.value = pomodoro.workMin;
  pomodoroBreakInput.value = pomodoro.breakMin;

  const { current, next } = refreshPomodoroQueue();
  if (pomodoroStackCurrentText) {
    pomodoroStackCurrentText.textContent = current
      ? pomodoroTaskLabel(current)
      : translate('pomodoro.task.placeholder', 'What are you working on?');
    pomodoroStackCurrentText.classList.toggle('placeholder', !current);
  }
  if (pomodoroStackNextText) {
    pomodoroStackNextText.textContent = next
      ? pomodoroTaskLabel(next)
      : translate('pomodoro.task.upNext', 'Nothing queued next');
    pomodoroStackNextText.classList.toggle('placeholder', !next);
  }
  if (pomodoroMarkDoneBtn) pomodoroMarkDoneBtn.disabled = !current;
}

const pomodoroQueueBtn = document.getElementById('pomodoro-queue-btn');
const pomodoroQueueOverlay = document.getElementById('pomodoro-queue-overlay');
const pomodoroQueueListEl = document.getElementById('pomodoro-queue-list');
const pomodoroQueueCloseBtn = document.getElementById('pomodoro-queue-close');
const pomodoroQueueCloseXBtn = document.getElementById('pomodoro-queue-close-x');

function renderPomodoroQueueList() {
  if (!pomodoroQueueListEl) return;
  const queue = pomodoroQueueOrder();
  pomodoroQueueListEl.innerHTML = '';
  if (!queue.length) {
    const empty = document.createElement('div');
    empty.className = 'pomodoro-queue-empty';
    empty.textContent = 'No open tasks. Add one to start a focus session.';
    pomodoroQueueListEl.appendChild(empty);
    return;
  }
  queue.forEach((t) => {
    const isCurrent = t.id === pomodoro.taskId;
    const row = document.createElement('button');
    row.type = 'button';
    row.className = 'pomodoro-queue-item' + (isCurrent ? ' is-current' : '');
    const label = document.createElement('span');
    label.className = 'pomodoro-queue-item-text';
    label.textContent = pomodoroTaskLabel(t);
    row.appendChild(label);
    if (isCurrent) {
      const badge = document.createElement('span');
      badge.className = 'pomodoro-queue-current-badge';
      badge.textContent = 'Current';
      row.appendChild(badge);
    }
    row.addEventListener('click', () => {
      if (!isCurrent) {
        setPomodoroActiveTask(t.id);
        renderPomodoroQueueList();
        renderPomodoro();
      }
    });
    pomodoroQueueListEl.appendChild(row);
  });
}

function openPomodoroQueue() {
  refreshPomodoroQueue();
  renderPomodoroQueueList();
  pomodoroQueueOverlay.style.display = 'flex';
}
function closePomodoroQueue() { pomodoroQueueOverlay.style.display = 'none'; }

if (pomodoroQueueBtn) pomodoroQueueBtn.addEventListener('click', openPomodoroQueue);
if (pomodoroQueueCloseBtn) pomodoroQueueCloseBtn.addEventListener('click', closePomodoroQueue);
if (pomodoroQueueCloseXBtn) pomodoroQueueCloseXBtn.addEventListener('click', closePomodoroQueue);
if (pomodoroQueueOverlay) pomodoroQueueOverlay.addEventListener('click', (e) => { if (e.target === pomodoroQueueOverlay) closePomodoroQueue(); });

function flushPomodoroTime() {
  if (!pomodoro.taskId || pomodoroUnflushedSec <= 0) { pomodoroUnflushedSec = 0; return; }
  const t = todos.find((x) => x.id === pomodoro.taskId);
  if (t) {
    t.timeSpentSec = (t.timeSpentSec || 0) + pomodoroUnflushedSec;
    saveTodos();
    if (currentUser) dbUpdate('todos', t.id, { time_spent_sec: t.timeSpentSec });
  }
  pomodoroUnflushedSec = 0;
}

function setPomodoroActiveTask(taskId) {
  flushPomodoroTime();
  const t = taskId ? todos.find((x) => x.id === Number(taskId)) : null;
  pomodoro.taskId = t ? t.id : null;
  pomodoro.task = t ? t.text : '';
  safeSetItem('pomodoroTaskId', pomodoro.taskId || '');
  safeSetItem('pomodoroTask', pomodoro.task);
  renderPomodoro();
}

let pomodoroWarned = false;
function tickPomodoro() {
  pomodoro.remaining--;
  if (pomodoro.mode === 'work' && pomodoro.taskId) {
    pomodoroUnflushedSec++;
    if (pomodoroUnflushedSec >= 20) flushPomodoroTime();
  }
  if (pomodoro.remaining === 60 && !pomodoroWarned) {
    pomodoroWarned = true;
    sendNotification(pomodoro.mode === 'work' ? 'Almost there' : 'Break ending soon',
      pomodoro.mode === 'work' ? 'One minute left in your focus session.' : 'One minute left in your break.');
  }
  if (pomodoro.remaining <= 0) {
    flushPomodoroTime();
    clearInterval(pomodoroInterval); pomodoroInterval = null; pomodoro.running = false;
    pomodoroWarned = false;
    if (pomodoro.mode === 'work') {
      pomodoro.sessions++;
      safeSetItem('pomodoroSessions', pomodoro.sessions);
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
  flushPomodoroTime();
  clearInterval(pomodoroInterval); pomodoroInterval = null; pomodoro.running = false;
  setFocusMode(false); renderPomodoro();
});
pomodoroResetBtn.addEventListener('click', () => {
  flushPomodoroTime();
  clearInterval(pomodoroInterval); pomodoroInterval = null; pomodoro.running = false;
  pomodoroWarned = false;
  pomodoro.mode = 'work'; pomodoro.remaining = pomodoro.workMin * 60;
  setFocusMode(false); renderPomodoro();
});
if (pomodoroMarkDoneBtn) {
  pomodoroMarkDoneBtn.addEventListener('click', () => {
    if (!pomodoro.taskId || pomodoroMarkDoneBtn.disabled) return;
    pomodoroMarkDoneBtn.disabled = true;
    flushPomodoroTime();
    const t = todos.find((x) => x.id === pomodoro.taskId);
    if (t && !t.done) {
      t.done = true;
      recordCompletion();
      saveTodos(); renderTodos(); renderCounts(); renderViewHeader(); renderProjectNav();
      if (typeof renderHomeSummary === 'function') renderHomeSummary();
      if (currentUser) dbUpdate('todos', t.id, { done: true, time_spent_sec: t.timeSpentSec || 0 });
      if (typeof showToast === 'function') showToast('pomodoro');
      pomodoroTimerEl.title = `"${t.text}" done — ${formatDuration(t.timeSpentSec || 0)} tracked.`;
    }
    animatePomodoroAdvance();
  });
}

function animatePomodoroAdvance() {
  const queue = pomodoroQueueOrder();
  const nextTask = queue[0] || null;

  if (!pomodoroStackCurrentCard || !pomodoroStackNextCard) {
    pomodoro.taskId = nextTask ? nextTask.id : null;
    pomodoro.task = nextTask ? nextTask.text : '';
    safeSetItem('pomodoroTaskId', pomodoro.taskId || '');
    safeSetItem('pomodoroTask', pomodoro.task);
    renderPomodoro();
    return;
  }

  pomodoroStackCurrentCard.classList.add('leaving');
  pomodoroStackNextCard.classList.add('promoting');

  setTimeout(() => {
    pomodoro.taskId = nextTask ? nextTask.id : null;
    pomodoro.task = nextTask ? nextTask.text : '';
    safeSetItem('pomodoroTaskId', pomodoro.taskId || '');
    safeSetItem('pomodoroTask', pomodoro.task);
    renderPomodoro();
    pomodoroStackCurrentCard.classList.remove('leaving');
    pomodoroStackNextCard.classList.remove('promoting');
  }, 380);
}
pomodoroWorkInput.addEventListener('change', (e) => {
  const v = Math.min(Math.max(parseInt(e.target.value) || 25, 1), 120);
  pomodoro.workMin = v; safeSetItem('pomodoroWorkMin', v);
  if (!pomodoro.running && pomodoro.mode === 'work') { pomodoro.remaining = v * 60; renderPomodoro(); }
});
pomodoroBreakInput.addEventListener('change', (e) => {
  const v = Math.min(Math.max(parseInt(e.target.value) || 5, 1), 60);
  pomodoro.breakMin = v; safeSetItem('pomodoroBreakMin', v);
  if (!pomodoro.running && pomodoro.mode === 'break') { pomodoro.remaining = v * 60; renderPomodoro(); }
});
window.addEventListener('beforeunload', flushPomodoroTime);


// ===== State =====
let todos = safeParse('todos', []);
let taskCategories = safeParse('taskCategories', []);
let currentView = 'all';

const form = document.getElementById('todo-form');
const input = document.getElementById('todo-input');
const descInput = document.getElementById('desc-input');
const dueInput = document.getElementById('due-input');
const priorityInput = document.getElementById('priority-input');
const todoCategorySelect = document.getElementById('todo-category-select');
const todoAddCategoryBtn = document.getElementById('todo-add-category-btn');
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
  todoCategorySelect.value = '';
}
taskAddToggle.addEventListener('click', openTaskAdd);
taskAddCancel.addEventListener('click', closeTaskAdd);

// ===== Task categories =====
function saveTaskCategories() { safeSetItem('taskCategories', JSON.stringify(taskCategories)); }
function renderTaskCategorySelects(selectedForAdd, selectedForDetail) {
  [todoCategorySelect, taskDetailCategory].forEach((sel, idx) => {
    if (!sel) return;
    const keep = idx === 0 ? (selectedForAdd !== undefined ? selectedForAdd : sel.value) : (selectedForDetail !== undefined ? selectedForDetail : sel.value);
    sel.innerHTML = '<option value="">No category</option>';
    taskCategories.forEach(cat => {
      const opt = document.createElement('option');
      opt.value = cat;
      opt.textContent = cat;
      sel.appendChild(opt);
    });
    sel.value = taskCategories.includes(keep) ? keep : '';
  });
}

// ===== Add-category modal =====
const categoryModalOverlay = document.getElementById('category-modal-overlay');
const categoryModalInput = document.getElementById('category-modal-input');
const categoryModalError = document.getElementById('category-modal-error');
const categoryModalCancel = document.getElementById('category-modal-cancel');
const categoryModalSave = document.getElementById('category-modal-save');
let categoryModalTargetSelect = null;

function openCategoryModal(targetSelect) {
  categoryModalTargetSelect = targetSelect || null;
  categoryModalInput.value = '';
  categoryModalError.style.display = 'none';
  categoryModalOverlay.style.display = 'flex';
  requestAnimationFrame(() => categoryModalInput.focus());
}
function closeCategoryModal() {
  categoryModalOverlay.style.display = 'none';
  categoryModalTargetSelect = null;
}
function commitCategoryModal() {
  const trimmed = categoryModalInput.value.trim();
  if (!trimmed) {
    categoryModalError.textContent = 'Enter a category name.';
    categoryModalError.style.display = 'block';
    categoryModalInput.focus();
    return;
  }
  const exists = taskCategories.some(c => c.toLowerCase() === trimmed.toLowerCase());
  if (!exists) { taskCategories.push(trimmed); saveTaskCategories(); }
  const finalValue = exists ? taskCategories.find(c => c.toLowerCase() === trimmed.toLowerCase()) : trimmed;
  renderTaskCategorySelects();
  if (categoryModalTargetSelect) categoryModalTargetSelect.value = finalValue;
  closeCategoryModal();
}
categoryModalSave.addEventListener('click', commitCategoryModal);
categoryModalCancel.addEventListener('click', closeCategoryModal);
categoryModalOverlay.addEventListener('click', (e) => { if (e.target === categoryModalOverlay) closeCategoryModal(); });
categoryModalInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') { e.preventDefault(); commitCategoryModal(); }
  else if (e.key === 'Escape') { e.preventDefault(); closeCategoryModal(); }
});
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && categoryModalOverlay.style.display === 'flex') closeCategoryModal();
});

function addTaskCategory(targetSelect) {
  openCategoryModal(targetSelect);
}
todoAddCategoryBtn.addEventListener('click', () => addTaskCategory(todoCategorySelect));

// ===== Projects & collaborators =====
let projects = safeParse('projects', []);
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

function saveProjects() { safeSetItem('projects', JSON.stringify(projects)); }
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
  if (!p) return false;
  if (!currentUser) return !p.userId;
  return p.userId === currentUser.id;
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

// ===== Project announcements =====
let projectAnnouncements = safeParse('projectAnnouncements', {});
function saveProjectAnnouncements() { safeSetItem('projectAnnouncements', JSON.stringify(projectAnnouncements)); }
function getProjectAnnouncement(projectId) {
  const p = getProject(projectId);
  if (p && p.announcement) return p.announcement;
  return projectAnnouncements[String(projectId)] || '';
}
function setProjectAnnouncement(projectId, text) {
  const p = getProject(projectId);
  if (!p) return;
  const key = String(projectId);
  p.announcement = text || '';
  p.announcementUpdatedAt = text ? new Date().toISOString() : null;
  saveProjects();
  if (projectAnnouncements[key] !== undefined) { delete projectAnnouncements[key]; saveProjectAnnouncements(); }
  if (currentUser) dbUpsert('projects', projectRemoteRow(p));
}

const projectAnnouncementEl = document.getElementById('project-announcement');
const projectAnnouncementTextEl = document.getElementById('project-announcement-text');
const projectAnnouncementActionsEl = document.getElementById('project-announcement-actions');
const projectAnnouncementEditBtn = document.getElementById('project-announcement-edit-btn');
const projectAnnouncementClearBtn = document.getElementById('project-announcement-clear-btn');
const projectAnnouncementAddToggle = document.getElementById('project-announcement-add-toggle');
const projectAnnouncementForm = document.getElementById('project-announcement-form');
const projectAnnouncementInputEl = document.getElementById('project-announcement-input');
const projectAnnouncementCancelBtn = document.getElementById('project-announcement-cancel-btn');
let announcementEditing = false;

function formatAnnouncementText(text) {
  let safe = escapeHtml(text);
  safe = safe.replace(/\*\*([^\n*]+?)\*\*/g, '<strong>$1</strong>');
  safe = safe.replace(/(^|[^*])\*([^\n*]+?)\*(?!\*)/g, '$1<em>$2</em>');
  safe = safe.replace(/(^|[^_])_([^\n_]+?)_(?!_)/g, '$1<em>$2</em>');
  safe = safe.replace(/~~([^\n~]+?)~~/g, '<del>$1</del>');
  safe = safe.replace(/`([^\n`]+?)`/g, '<code>$1</code>');
  return safe;
}

const ANNOUNCEMENT_FORMAT_MARKERS = { bold: '**', italic: '*', strike: '~~', code: '`' };
document.querySelectorAll('.announcement-format-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    const marker = ANNOUNCEMENT_FORMAT_MARKERS[btn.dataset.format];
    if (!marker || !projectAnnouncementInputEl) return;
    const el = projectAnnouncementInputEl;
    const start = el.selectionStart ?? el.value.length;
    const end = el.selectionEnd ?? el.value.length;
    const selected = el.value.slice(start, end);
    const before = el.value.slice(0, start);
    const after = el.value.slice(end);
    const newValue = `${before}${marker}${selected}${marker}${after}`;
    if (newValue.length > 500) return;
    el.value = newValue;
    el.focus();
    const cursor = selected ? end + marker.length * 2 : start + marker.length;
    el.setSelectionRange(cursor, cursor);
  });
});

function openAnnouncementForm() {
  if (!currentProjectId || !isProjectOwner(currentProjectId)) return;
  announcementEditing = true;
  projectAnnouncementInputEl.value = getProjectAnnouncement(currentProjectId);
  renderProjectAnnouncement();
  setTimeout(() => projectAnnouncementInputEl.focus(), 30);
}
function closeAnnouncementForm() {
  announcementEditing = false;
  renderProjectAnnouncement();
}

function renderProjectAnnouncement() {
  if (!projectAnnouncementEl || !projectAnnouncementAddToggle || !projectAnnouncementForm) return;
  if (currentView !== 'project' || !currentProjectId) {
    projectAnnouncementEl.style.display = 'none';
    projectAnnouncementAddToggle.hidden = true;
    projectAnnouncementForm.hidden = true;
    announcementEditing = false;
    return;
  }
  const isOwner = isProjectOwner(currentProjectId);
  const text = getProjectAnnouncement(currentProjectId);

  if (isOwner && announcementEditing) {
    projectAnnouncementEl.style.display = 'none';
    projectAnnouncementAddToggle.hidden = true;
    projectAnnouncementForm.hidden = false;
    return;
  }
  projectAnnouncementForm.hidden = true;

  if (text) {
    projectAnnouncementEl.style.display = 'flex';
    projectAnnouncementAddToggle.hidden = true;
    projectAnnouncementTextEl.innerHTML = formatAnnouncementText(text);
    projectAnnouncementActionsEl.style.display = isOwner ? 'flex' : 'none';
    if (projectAnnouncementEditBtn) projectAnnouncementEditBtn.style.display = isOwner ? 'inline-flex' : 'none';
    if (projectAnnouncementClearBtn) projectAnnouncementClearBtn.style.display = isOwner ? 'inline-flex' : 'none';
  } else {
    projectAnnouncementEl.style.display = 'none';
    projectAnnouncementAddToggle.hidden = !isOwner;
  }
}

if (projectAnnouncementAddToggle) projectAnnouncementAddToggle.addEventListener('click', openAnnouncementForm);
if (projectAnnouncementEditBtn) projectAnnouncementEditBtn.addEventListener('click', openAnnouncementForm);
if (projectAnnouncementCancelBtn) projectAnnouncementCancelBtn.addEventListener('click', closeAnnouncementForm);
if (projectAnnouncementForm) {
  projectAnnouncementForm.addEventListener('submit', (e) => {
    e.preventDefault();
    if (!currentProjectId || !isProjectOwner(currentProjectId)) return;
    const val = projectAnnouncementInputEl.value.trim().slice(0, 500);
    setProjectAnnouncement(currentProjectId, val);
    announcementEditing = false;
    renderProjectAnnouncement();
  });
}
if (projectAnnouncementClearBtn) {
  projectAnnouncementClearBtn.addEventListener('click', () => {
    if (!currentProjectId || !isProjectOwner(currentProjectId)) return;
    setProjectAnnouncement(currentProjectId, '');
    renderProjectAnnouncement();
  });
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
  setProjectAnnouncement(id, '');
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
    btn.className = 'nav-item project-item' + (currentView === 'project' && String(currentProjectId) === String(p.id) ? ' active' : '') + (isOwned ? '' : ' shared');
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

// ===== Date helpers — LOCAL TIME =====
function todayStr() {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}
function tomorrowStr() {
  const d = new Date();
  d.setDate(d.getDate() + 1);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}
function saveTodos() { safeSetItem('todos', JSON.stringify(todos)); }
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
    time_spent_sec: t.timeSpentSec || 0,
  };
}
function projectRemoteRow(p) {
  return {
    id: p.id,
    user_id: p.userId || (currentUser ? currentUser.id : null),
    name: p.name,
    announcement: p.announcement || null,
    announcement_updated_at: p.announcementUpdatedAt || null,
  };
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
  if (view === 'pomodoro') renderPomodoro();
  if (view === 'calendar') { renderCalendar(); renderDayPanel(); }
  if (view === 'notes') { renderCategoryTabs(); renderNoteCategorySelect(); renderNotes(); }
  if (['all', 'today', 'active', 'completed', 'project'].includes(view)) {
    renderProjectSelect();
    renderTodos();
    renderViewHeader();
    updateTaskFormForView();
    renderCollabPanel();
  }
  renderHomeSummary();
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

// ===== Task list sort mode & category filter =====
let taskSortMode = 'default';
let taskCategoryFilterValue = '';

function getFilteredTodos() {
  let filtered = [...todos];
  if (currentView === 'today') filtered = filtered.filter(t => t.due === todayStr());
  else if (currentView === 'active') filtered = filtered.filter(t => !t.done);
  else if (currentView === 'completed') filtered = filtered.filter(t => t.done);
  else if (currentView === 'project') filtered = filtered.filter(t => String(t.projectId) === String(currentProjectId));
  if (taskCategoryFilterValue) filtered = filtered.filter(t => (t.category || '') === taskCategoryFilterValue);
  if (taskSortMode === 'oldest') {
    filtered.sort((a, b) => a.id - b.id);
  } else if (taskSortMode === 'newest') {
    filtered.sort((a, b) => b.id - a.id);
  } else {
    const priorityRank = { high: 0, medium: 1, low: 2 };
    filtered.sort((a, b) => {
      if (a.done !== b.done) return a.done ? 1 : -1;
      if (priorityRank[a.priority] !== priorityRank[b.priority]) return priorityRank[a.priority] - priorityRank[b.priority];
      return (a.due || '9999').localeCompare(b.due || '9999');
    });
  }
  return filtered;
}

const taskSortBtn = document.getElementById('task-sort-btn');
const taskSortMenu = document.getElementById('task-sort-menu');
const taskCategoryBtn = document.getElementById('task-category-btn');
const taskCategoryMenu = document.getElementById('task-category-menu');
const TASK_SORT_LABELS = { default: 'Sort: Default', oldest: 'Sort: Oldest first', newest: 'Sort: Newest first' };

function closeTaskToolbarMenus() {
  if (taskSortMenu) taskSortMenu.classList.remove('open');
  if (taskCategoryMenu) taskCategoryMenu.classList.remove('open');
}
function toggleTaskToolbarMenu(menu) {
  const isOpen = menu.classList.contains('open');
  closeTaskToolbarMenus();
  if (!isOpen) menu.classList.add('open');
}
if (taskSortBtn && taskSortMenu) {
  taskSortBtn.addEventListener('click', (e) => { e.stopPropagation(); toggleTaskToolbarMenu(taskSortMenu); });
}
if (taskCategoryBtn && taskCategoryMenu) {
  taskCategoryBtn.addEventListener('click', (e) => { e.stopPropagation(); toggleTaskToolbarMenu(taskCategoryMenu); });
}
document.addEventListener('click', closeTaskToolbarMenus);
document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeTaskToolbarMenus(); });

function renderTaskSortMenu() {
  if (!taskSortMenu) return;
  taskSortMenu.querySelectorAll('.task-toolbar-menu-item').forEach(item => {
    item.classList.toggle('active', item.dataset.value === taskSortMode);
  });
  if (taskSortBtn) {
    taskSortBtn.classList.toggle('active', taskSortMode !== 'default');
    taskSortBtn.title = TASK_SORT_LABELS[taskSortMode] || 'Sort tasks';
  }
}
if (taskSortMenu) {
  taskSortMenu.addEventListener('click', (e) => {
    const item = e.target.closest('.task-toolbar-menu-item');
    if (!item) return;
    taskSortMode = item.dataset.value;
    closeTaskToolbarMenus();
    renderTodos();
  });
}

function renderTaskCategoryFilterOptions() {
  if (!taskCategoryMenu) return;
  const keep = taskCategoryFilterValue;
  const scoped = currentView === 'project'
    ? todos.filter(t => String(t.projectId) === String(currentProjectId))
    : todos;
  const cats = [...new Set(scoped.map(t => t.category).filter(Boolean))].sort((a, b) => a.localeCompare(b));
  taskCategoryFilterValue = cats.includes(keep) ? keep : '';

  taskCategoryMenu.innerHTML = '';
  const allItem = document.createElement('button');
  allItem.type = 'button';
  allItem.className = 'task-toolbar-menu-item' + (taskCategoryFilterValue === '' ? ' active' : '');
  allItem.dataset.value = '';
  allItem.textContent = 'All categories';
  taskCategoryMenu.appendChild(allItem);
  cats.forEach(cat => {
    const item = document.createElement('button');
    item.type = 'button';
    item.className = 'task-toolbar-menu-item' + (cat === taskCategoryFilterValue ? ' active' : '');
    item.dataset.value = cat;
    item.textContent = cat;
    taskCategoryMenu.appendChild(item);
  });

  if (taskCategoryBtn) {
    taskCategoryBtn.classList.toggle('active', !!taskCategoryFilterValue);
    taskCategoryBtn.title = taskCategoryFilterValue ? `Category: ${taskCategoryFilterValue}` : 'Filter by category';
  }
}
if (taskCategoryMenu) {
  taskCategoryMenu.addEventListener('click', (e) => {
    const item = e.target.closest('.task-toolbar-menu-item');
    if (!item) return;
    taskCategoryFilterValue = item.dataset.value;
    closeTaskToolbarMenus();
    renderTodos();
  });
}

const ICON_CALENDAR = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="18" rx="3"></rect><path d="M16 2v4M8 2v4M3 10h18"></path></svg>';
const ICON_FOLDER = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"></path></svg>';
const ICON_PEOPLE = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"></path><circle cx="9" cy="7" r="4"></circle><path d="M23 21v-2a4 4 0 0 0-3-3.87"></path><path d="M16 3.13a4 4 0 0 1 0 7.75"></path></svg>';
const ICON_PENCIL = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9"></path><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4Z"></path></svg>';
const ICON_TRASH = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"></path><path d="M10 11v6"></path><path d="M14 11v6"></path><path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"></path></svg>';
const ICON_SHIELD = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"></path><polyline points="9 12 11 14 15 10"></polyline></svg>';
const ICON_FLAG = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 22V4"></path><path d="M4 4h13l-2.5 4L17 12H4"></path></svg>';

function pillIcon(svgMarkup) {
  const span = document.createElement('span');
  span.className = 'pill-icon';
  span.innerHTML = svgMarkup;
  return span;
}

function renderTodos() {
  renderTaskSortMenu();
  renderTaskCategoryFilterOptions();
  const filtered = getFilteredTodos();
  todoListEl.innerHTML = '';
  emptyState.style.display = filtered.length ? 'none' : 'block';
  const todayKey = todayStr();
  const frag = document.createDocumentFragment();

  filtered.forEach(t => {
    const canToggle = canToggleTaskIn(t.projectId);
    const canRemove = canRemoveTaskFrom(t.projectId);
    const canRename = canRenameTaskIn(t.projectId);

    const card = document.createElement('div');
    card.className = `task-card priority-${t.priority}` + (t.done ? ' completed' : '');
    card.draggable = window.innerWidth > 760;
    card.addEventListener('dragstart', (e) => {
      e.dataTransfer.setData('text/plain', String(t.id));
      e.dataTransfer.effectAllowed = 'move';
      card.classList.add('dragging');
      showDragDropzones();
    });
    card.addEventListener('dragend', () => {
      card.classList.remove('dragging');
      hideDragDropzones();
    });
    card.addEventListener('click', (e) => {
      if (e.target.closest('.task-check, .task-card-actions, .task-title-edit')) return;
      openTaskDetail(t.id);
    });

    const top = document.createElement('div');
    top.className = 'task-card-top';

    const main = document.createElement('div');
    main.className = 'task-main';
    const title = document.createElement('div');
    title.className = 'task-title';
    title.textContent = t.text;
    main.appendChild(title);
    top.appendChild(main);

    const headerRight = document.createElement('div');
    headerRight.className = 'task-card-header-right';

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
      del.addEventListener('click', (e) => {
        e.stopPropagation();
        performDeleteTask(t);
      });
      actions.appendChild(del);
    }
    headerRight.appendChild(actions);
    top.appendChild(headerRight);

    card.append(top);

    if (t.desc) {
      const desc = document.createElement('div');
      desc.className = 'task-desc';
      desc.textContent = t.desc;
      card.appendChild(desc);
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
        tag.addEventListener('click', (e) => { e.stopPropagation(); currentProjectId = p.id; setView('project'); });
        meta.appendChild(tag);
      }
    }
    if (t.done && t.timeSpentSec > 0) {
      const timePill = document.createElement('span');
      timePill.className = 'task-pill';
      timePill.title = 'Time tracked in Pomodoro';
      timePill.textContent = `⏱ ${formatDuration(t.timeSpentSec)}`;
      meta.appendChild(timePill);
    }
    if (t.category) {
      const cat = document.createElement('span');
      cat.className = 'task-card-category';
      cat.textContent = t.category;
      meta.appendChild(cat);
    }
    if (meta.children.length) card.appendChild(meta);

    const footer = document.createElement('div');
    footer.className = 'task-card-progress-row';

    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    checkbox.className = 'task-check';
    checkbox.checked = t.done;
    checkbox.disabled = !canToggle;
    checkbox.title = t.priority === 'high' ? 'High priority' : t.priority === 'medium' ? 'Medium priority' : 'Low priority';
    checkbox.addEventListener('change', () => {
      const wasDone = t.done;
      t.done = checkbox.checked;
      if (!wasDone && t.done) recordCompletion();
      saveTodos(); renderTodos(); renderCounts();
      if (currentUser) dbUpdate('todos', t.id, { done: t.done });
      if (t.done) showToast('complete');
    });

    const spacer = document.createElement('span');
    spacer.style.flex = '1';

    const flag = document.createElement('span');
    flag.className = 'task-priority-flag priority-' + t.priority;
    flag.title = t.priority === 'high' ? 'High priority' : t.priority === 'medium' ? 'Medium priority' : 'Low priority';
    flag.innerHTML = ICON_FLAG;

    footer.append(checkbox, spacer, flag);
    card.appendChild(footer);

    frag.appendChild(card);
  });
  todoListEl.appendChild(frag);
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

// ===== Task detail side panel =====
const taskDetailOverlay = document.getElementById('task-detail-overlay');
const taskDetailCheck = document.getElementById('task-detail-check');
const taskDetailTitle = document.getElementById('task-detail-title');
const taskDetailDesc = document.getElementById('task-detail-desc');
const taskDetailDue = document.getElementById('task-detail-due');
const taskDetailPriority = document.getElementById('task-detail-priority');
const taskDetailProject = document.getElementById('task-detail-project');
const taskDetailCategory = document.getElementById('task-detail-category');
const taskDetailAddCategoryBtn = document.getElementById('task-detail-add-category-btn');
const taskDetailClose = document.getElementById('task-detail-close');
const taskDetailSaveBtn = document.getElementById('task-detail-save-btn');
const taskDetailDeleteBtn = document.getElementById('task-detail-delete-btn');
let activeDetailTaskId = null;

function fillTaskDetailProjectOptions(selectedId) {
  taskDetailProject.innerHTML = '<option value="">No project</option>';
  projects.forEach(p => {
    const opt = document.createElement('option');
    opt.value = p.id;
    opt.textContent = p.name;
    taskDetailProject.appendChild(opt);
  });
  taskDetailProject.value = selectedId != null ? String(selectedId) : '';
}

function openTaskDetail(taskId) {
  const t = todos.find(x => x.id === taskId);
  if (!t) return;
  activeDetailTaskId = taskId;
  const canToggle = canToggleTaskIn(t.projectId);
  const canRename = canRenameTaskIn(t.projectId);
  const canRemove = canRemoveTaskFrom(t.projectId);

  taskDetailCheck.checked = t.done;
  taskDetailCheck.disabled = !canToggle;
  taskDetailTitle.value = t.text;
  taskDetailTitle.disabled = !canRename;
  taskDetailTitle.classList.toggle('completed', t.done);
  taskDetailDesc.value = t.desc || '';
  taskDetailDesc.disabled = !canRename;
  taskDetailDue.value = t.due || '';
  taskDetailDue.disabled = !canRename;
  taskDetailPriority.value = t.priority || 'medium';
  taskDetailPriority.disabled = !canRename;
  fillTaskDetailProjectOptions(t.projectId);
  taskDetailProject.disabled = !canRename;
  renderTaskCategorySelects(undefined, t.category || '');
  taskDetailCategory.disabled = !canRename;
  taskDetailAddCategoryBtn.style.display = canRename ? '' : 'none';
  taskDetailDeleteBtn.style.display = canRemove ? '' : 'none';
  taskDetailSaveBtn.style.display = canRename ? '' : 'none';

  const timeField = document.getElementById('task-detail-time-field');
  const timeEl = document.getElementById('task-detail-time');
  if (timeField && timeEl) {
    if (t.timeSpentSec > 0) {
      timeEl.textContent = formatDuration(t.timeSpentSec);
      timeField.style.display = '';
    } else {
      timeField.style.display = 'none';
    }
  }

  taskDetailOverlay.classList.add('open');
}

function closeTaskDetail() {
  taskDetailOverlay.classList.remove('open');
  activeDetailTaskId = null;
}

taskDetailClose.addEventListener('click', closeTaskDetail);
taskDetailOverlay.addEventListener('click', (e) => { if (e.target === taskDetailOverlay) closeTaskDetail(); });
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && taskDetailOverlay.classList.contains('open')) closeTaskDetail();
});

taskDetailCheck.addEventListener('change', () => {
  const t = todos.find(x => x.id === activeDetailTaskId);
  if (!t) return;
  const wasDone = t.done;
  t.done = taskDetailCheck.checked;
  if (!wasDone && t.done) recordCompletion();
  taskDetailTitle.classList.toggle('completed', t.done);
  saveTodos(); renderTodos(); renderCounts();
  if (currentUser) dbUpdate('todos', t.id, { done: t.done });
});

taskDetailAddCategoryBtn.addEventListener('click', () => addTaskCategory(taskDetailCategory));

taskDetailSaveBtn.addEventListener('click', () => {
  const t = todos.find(x => x.id === activeDetailTaskId);
  if (!t) return;
  const newText = taskDetailTitle.value.trim();
  if (newText) t.text = newText;
  t.desc = taskDetailDesc.value.trim();
  t.due = taskDetailDue.value || null;
  t.priority = taskDetailPriority.value;
  t.projectId = taskDetailProject.value || null;
  t.category = taskDetailCategory.value || null;
  saveTodos(); renderTodos(); renderCounts(); renderProjectNav();
  if (currentUser) dbUpdate('todos', t.id, { text: t.text, desc: t.desc, due: t.due, priority: t.priority, projectId: t.projectId });
  closeTaskDetail();
});

taskDetailDeleteBtn.addEventListener('click', () => {
  if (!activeDetailTaskId) return;
  const t = todos.find(x => x.id === activeDetailTaskId);
  if (!t) return;
  performDeleteTask(t);
  closeTaskDetail();
});

// ===== Drag a task onto Pomodoro or Trash =====
const dragDropzones = document.createElement('div');
dragDropzones.id = 'drag-dropzones';
dragDropzones.className = 'drag-dropzones';
dragDropzones.innerHTML = `
  <div class="drag-dropzone" id="dropzone-pomodoro" data-zone="pomodoro">
    <span class="drag-dropzone-icon">🍅</span>
    <span class="drag-dropzone-label">Focus in Pomodoro</span>
  </div>
  <div class="drag-dropzone danger" id="dropzone-trash" data-zone="trash">
    <span class="drag-dropzone-icon">${ICON_TRASH}</span>
    <span class="drag-dropzone-label">Delete</span>
  </div>
`;
document.body.appendChild(dragDropzones);
const dropzonePomodoroEl = document.getElementById('dropzone-pomodoro');
const dropzoneTrashEl = document.getElementById('dropzone-trash');

function showDragDropzones() { dragDropzones.classList.add('show'); }
function hideDragDropzones() {
  dragDropzones.classList.remove('show');
  dropzonePomodoroEl.classList.remove('drop-target', 'zone-invalid');
  dropzoneTrashEl.classList.remove('drop-target');
}

function performDeleteTask(t) {
  const idx = todos.findIndex(x => x.id === t.id);
  if (idx === -1) return;
  const removed = todos[idx];
  todos.splice(idx, 1);
  saveTodos(); renderTodos(); renderCounts(); renderProjectNav();
  if (currentUser) dbDelete('todos', removed.id);
  showUndoToast(`"${removed.text}" deleted.`, () => {
    const reinsertAt = Math.min(idx, todos.length);
    todos.splice(reinsertAt, 0, removed);
    saveTodos(); renderTodos(); renderCounts(); renderProjectNav();
    if (currentUser) dbUpsert('todos', todoRemoteRow(removed));
  });
}

function confirmAndDeleteTask(t) {
  if (!t || !canRemoveTaskFrom(t.projectId)) return;
  openConfirmModal({
    title: 'Delete this task?',
    message: `"${t.text}" will be moved to trash. You can undo it right after.`,
    confirmLabel: 'Delete',
    danger: true,
    onConfirm: () => performDeleteTask(t),
  });
}

function deleteTaskById(id) {
  const t = todos.find(x => x.id === id);
  if (!t || !canRemoveTaskFrom(t.projectId)) return false;
  confirmAndDeleteTask(t);
  return true;
}

[dropzonePomodoroEl, dropzoneTrashEl].forEach((zone) => {
  zone.addEventListener('dragenter', (e) => { e.preventDefault(); zone.classList.add('drop-target'); });
  zone.addEventListener('dragover', (e) => { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; });
  zone.addEventListener('dragleave', () => zone.classList.remove('drop-target'));
  zone.addEventListener('drop', (e) => {
    e.preventDefault();
    zone.classList.remove('drop-target');
    const idRaw = e.dataTransfer.getData('text/plain');
    if (!idRaw) return;
    const t = todos.find(x => String(x.id) === idRaw);
    if (!t) return;
    if (zone.dataset.zone === 'pomodoro') sendTaskToPomodoro(t);
    else confirmAndDeleteTask(t);
  });
});

function sendTaskToPomodoro(t) {
  if (!t || t.done) {
    showSimpleToast({ emoji: '🚫', text: 'Completed tasks can\'t be sent to Pomodoro.' });
    return;
  }
  setPomodoroActiveTask(t.id);
  setView('pomodoro');
  renderPomodoro();
  showToast('pomodoro');
}

(function setupTouchDragToDropzones() {
  const LONG_PRESS_MS = 260;
  const MOVE_CANCEL_PX = 10;
  let pressTimer = null;
  let dragging = false;
  let startX = 0, startY = 0;
  let ghost = null;
  let activeTask = null;
  let activeCard = null;

  function cleanup() {
    clearTimeout(pressTimer);
    pressTimer = null;
    dragging = false;
    activeTask = null;
    if (activeCard) activeCard.classList.remove('touch-dragging');
    activeCard = null;
    if (ghost) { ghost.remove(); ghost = null; }
    hideDragDropzones();
  }

  function startDrag(card, touch) {
    dragging = true;
    activeCard = card;
    card.classList.add('touch-dragging');
    ghost = document.createElement('div');
    ghost.className = 'touch-drag-ghost';
    ghost.textContent = activeTask.text;
    document.body.appendChild(ghost);
    positionGhost(touch);
    showDragDropzones();
    if (navigator.vibrate) navigator.vibrate(12);
  }

  function positionGhost(touch) {
    if (!ghost) return;
    ghost.style.left = touch.clientX + 'px';
    ghost.style.top = touch.clientY + 'px';
  }

  const HIT_PAD = 16;
  function zoneUnderTouch(touch) {
    for (const zone of [dropzonePomodoroEl, dropzoneTrashEl]) {
      const r = zone.getBoundingClientRect();
      if (
        touch.clientX >= r.left - HIT_PAD && touch.clientX <= r.right + HIT_PAD &&
        touch.clientY >= r.top - HIT_PAD && touch.clientY <= r.bottom + HIT_PAD
      ) return zone;
    }
    const hit = document.elementFromPoint(touch.clientX, touch.clientY);
    const hitZone = hit ? hit.closest('.drag-dropzone') : null;
    if (hitZone === dropzonePomodoroEl || hitZone === dropzoneTrashEl) return hitZone;
    return null;
  }

  todoListEl.addEventListener('touchstart', (e) => {
    if (window.innerWidth > 760) return;
    const card = e.target.closest('.task-card');
    if (!card || e.target.closest('.task-check, .task-card-actions, .task-title-edit')) return;
    const filtered = getFilteredTodos();
    const idx = Array.from(todoListEl.children).indexOf(card);
    activeTask = filtered[idx];
    if (!activeTask) return;
    const touch = e.touches[0];
    startX = touch.clientX; startY = touch.clientY;
    pressTimer = setTimeout(() => startDrag(card, touch), LONG_PRESS_MS);
  }, { passive: true });

  todoListEl.addEventListener('touchmove', (e) => {
    const touch = e.touches[0];
    if (!dragging) {
      if (pressTimer && (Math.abs(touch.clientX - startX) > MOVE_CANCEL_PX || Math.abs(touch.clientY - startY) > MOVE_CANCEL_PX)) {
        cleanup();
      }
      return;
    }
    e.preventDefault();
    positionGhost(touch);
    const hoverZone = zoneUnderTouch(touch);
    [dropzonePomodoroEl, dropzoneTrashEl].forEach((z) => z.classList.toggle('drop-target', z === hoverZone));
    const pomodoroInvalid = !!(activeTask && activeTask.done);
    dropzonePomodoroEl.classList.toggle('zone-invalid', pomodoroInvalid);
    if (ghost) ghost.classList.toggle('ghost-over-invalid', hoverZone === dropzonePomodoroEl && pomodoroInvalid);
  }, { passive: false });

  todoListEl.addEventListener('touchend', (e) => {
    if (dragging) {
      const touch = e.changedTouches[0];
      const zone = zoneUnderTouch(touch);
      if (zone && activeTask) {
        if (zone.dataset.zone === 'pomodoro') sendTaskToPomodoro(activeTask);
        else confirmAndDeleteTask(activeTask);
      }
    }
    cleanup();
  });

  todoListEl.addEventListener('touchcancel', cleanup);
})();

function renderCounts() {
  document.getElementById('count-all').textContent = todos.length;
  document.getElementById('count-today').textContent = todos.filter(t => t.due === todayStr()).length;
  document.getElementById('count-active').textContent = todos.filter(t => !t.done).length;
  document.getElementById('count-completed').textContent = todos.filter(t => t.done).length;
  renderHomeSummary();
}

function renderViewHeader() {
  const taskViewEl = document.getElementById('task-view');
  if (taskViewEl) taskViewEl.classList.toggle('is-home', currentView === 'all');
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
  renderProjectAnnouncement();
  renderHomeSummary();
}

const COMPLETION_LOG_KEY = 'aschertypeCompletionLog';
function loadCompletionLog() {
  return safeParse(COMPLETION_LOG_KEY, []);
}
function recordCompletion() {
  const cutoff = Date.now() - 30 * 24 * 60 * 60 * 1000;
  const log = loadCompletionLog().filter((ts) => ts > cutoff);
  log.push(Date.now());
  safeSetItem(COMPLETION_LOG_KEY, JSON.stringify(log));
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
  const key = h < 5 ? 'home.summary.greeting.night'
    : h < 12 ? 'home.summary.greeting.morning'
    : h < 17 ? 'home.summary.greeting.afternoon'
    : 'home.summary.greeting.evening';
  const fallback = { 'home.summary.greeting.night': 'Still up', 'home.summary.greeting.morning': 'Good morning', 'home.summary.greeting.afternoon': 'Good afternoon', 'home.summary.greeting.evening': 'Good evening' }[key];
  return window.I18N ? window.I18N.t(key, fallback) : fallback;
}
const homeSummaryEl = document.getElementById('home-summary');
const homeGreetingEl = document.getElementById('home-greeting');
const homePulseTodayEl = document.getElementById('home-pulse-today');
const homePulseActiveEl = document.getElementById('home-pulse-active');
const homePulseWeekEl = document.getElementById('home-pulse-week');
const homeWidgetsEl = document.getElementById('home-widgets');

function renderHomeSummary() {
  if (!homeSummaryEl) return;
  if (currentView !== 'all') {
    homeSummaryEl.style.display = 'none';
    renderHomeFocus();
    homeWidgetsEl.style.display = 'none';
    return;
  }
  homeSummaryEl.style.display = 'block';

  const dateLabel = new Date().toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' });
  homeGreetingEl.innerHTML = `${homeGreeting()}<span class="home-date">${dateLabel}</span>`;

  const todayKey = todayStr();
  homePulseTodayEl.textContent = todos.filter((t) => t.due === todayKey && !t.done).length;
  homePulseActiveEl.textContent = todos.filter((t) => !t.done).length;
  homePulseWeekEl.textContent = completedThisWeekCount();

  renderHomeFocus();
  renderHomeProgress();
  renderHomeMiniCal();
  homeWidgetsEl.style.display = 'flex';
}

function renderHomeFocus() {
  const el = document.getElementById('home-focus');
  if (!el) return;
  if (currentView !== 'all') { el.style.display = 'none'; return; }

  const todayKey = todayStr();
  const items = todos
    .filter((t) => !t.done && t.due && t.due <= todayKey)
    .sort((a, b) => (a.due || '').localeCompare(b.due || ''));

  el.innerHTML = '';
  el.style.display = 'flex';

  const tr = (key, fallback) => (window.I18N ? window.I18N.t(key, fallback) : fallback);

  if (!items.length) {
    el.classList.add('is-empty');
    const calm = document.createElement('p');
    calm.className = 'home-focus-empty-text';
    calm.textContent = tr('home.focus.empty', 'Nothing due or overdue right now — you\u2019re clear.');
    el.appendChild(calm);
    return;
  }
  el.classList.remove('is-empty');

  const label = document.createElement('span');
  label.className = 'home-focus-label';
  label.textContent = tr('home.focus.label', 'Focus');
  el.appendChild(label);

  const list = document.createElement('div');
  list.className = 'home-focus-list';
  items.slice(0, 5).forEach((t) => {
    const row = document.createElement('div');
    row.className = 'home-focus-item' + (t.due < todayKey ? ' is-overdue' : '');

    const cb = document.createElement('input');
    cb.type = 'checkbox';
    cb.className = 'task-check';
    cb.title = 'Mark done';
    cb.addEventListener('change', () => {
      t.done = true;
      recordCompletion();
      saveTodos(); renderTodos(); renderCounts();
      if (currentUser) dbUpdate('todos', t.id, { done: true });
      showToast('complete');
    });

    const title = document.createElement('span');
    title.className = 'home-focus-title';
    title.textContent = t.text;

    const due = document.createElement('span');
    due.className = 'home-focus-due';
    due.textContent = tr(t.due === todayKey ? 'home.focus.dueToday' : 'home.focus.dueOverdue', t.due === todayKey ? 'Today' : 'Overdue');

    row.append(cb, title, due);
    list.appendChild(row);
  });
  el.appendChild(list);

  if (items.length > 5) {
    const more = document.createElement('span');
    more.className = 'home-focus-more';
    more.textContent = tr('home.focus.more', '+{n} more').replace('{n}', items.length - 5);
    el.appendChild(more);
  }
}

function renderHomeProgress() {
  const el = document.getElementById('home-progress');
  if (!el) return;
  el.innerHTML = '';

  const title = document.createElement('div');
  title.className = 'home-widget-title';
  title.textContent = window.I18N ? window.I18N.t('widget.thisWeek', 'This week') : 'This week';
  el.appendChild(title);

  const log = loadCompletionLog();
  const weekStart = startOfWeek(new Date());
  const dayMs = 24 * 60 * 60 * 1000;
  const todayIdx = Math.min(6, Math.floor((Date.now() - weekStart) / dayMs));
  const dayLabels = ['M', 'T', 'W', 'T', 'F', 'S', 'S'];

  const row = document.createElement('div');
  row.className = 'home-progress-row';
  for (let i = 0; i < 7; i++) {
    const dayStart = weekStart + i * dayMs;
    const dayEnd = dayStart + dayMs;
    const count = log.filter((ts) => ts >= dayStart && ts < dayEnd).length;

    const dot = document.createElement('div');
    dot.className = 'home-progress-dot' + (count > 0 ? ' is-filled' : '') + (i === todayIdx ? ' is-today' : '');
    dot.title = `${dayLabels[i]}: ${count} done`;
    const num = document.createElement('span');
    num.textContent = dayLabels[i];
    dot.appendChild(num);
    row.appendChild(dot);
  }
  el.appendChild(row);

  const total = completedThisWeekCount();
  const caption = document.createElement('p');
  caption.className = 'home-widget-caption';
  caption.textContent = total > 0
    ? (window.I18N
        ? window.I18N.t(total === 1 ? 'widget.thisWeek.captionCount_one' : 'widget.thisWeek.captionCount_other', '{n} tasks done so far — nice pace.').replace('{n}', total)
        : `${total} task${total === 1 ? '' : 's'} done so far — nice pace.`)
    : (window.I18N ? window.I18N.t('widget.thisWeek.captionEmpty', 'A quiet week so far — that\u2019s okay.') : 'A quiet week so far — that\u2019s okay.');
  el.appendChild(caption);
}

function renderHomeMiniCal() {
  const el = document.getElementById('home-minical');
  if (!el) return;
  el.innerHTML = '';

  const title = document.createElement('div');
  title.className = 'home-widget-title';
  title.textContent = window.I18N ? window.I18N.t('widget.next7days', 'Next 7 days') : 'Next 7 days';
  el.appendChild(title);

  const row = document.createElement('div');
  row.className = 'home-minical-row';

  const base = new Date();
  for (let i = 0; i < 7; i++) {
    const d = new Date(base.getFullYear(), base.getMonth(), base.getDate() + i);
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    const key = `${y}-${m}-${day}`;

    const hasEvent = events.some((e) => e.date === key);
    const hasDue = todos.some((t) => t.due === key && !t.done);

    const cell = document.createElement('button');
    cell.type = 'button';
    cell.className = 'home-minical-cell' + (i === 0 ? ' is-today' : '');
    cell.title = d.toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' });

    const dow = document.createElement('span');
    dow.className = 'home-minical-dow';
    dow.textContent = d.toLocaleDateString(undefined, { weekday: 'short' }).slice(0, 2);
    const num = document.createElement('span');
    num.className = 'home-minical-num';
    num.textContent = d.getDate();
    cell.append(dow, num);

    if (hasEvent || hasDue) {
      const dot = document.createElement('span');
      dot.className = 'home-minical-dot';
      dot.innerHTML = '<svg viewBox="0 0 24 24" fill="currentColor" stroke="none"><path d="M12 2a6 6 0 0 0-6 6v3.586l-1.707 1.707A1 1 0 0 0 5 15h14a1 1 0 0 0 .707-1.707L18 11.586V8a6 6 0 0 0-6-6z"></path><path d="M9.5 17a2.5 2.5 0 0 0 5 0z"></path></svg>';
      cell.appendChild(dot);
    }
    cell.addEventListener('click', () => setView('calendar'));
    row.appendChild(cell);
  }
  el.appendChild(row);
}

window.onLanguageChange = function () {
  renderHomeSummary();
  if (typeof refreshTip === 'function') refreshTip();
};

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
    category: todoCategorySelect.value || null,
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
    const localCategoryById = new Map(todos.map(t => [String(t.id), t.category || null]));
    todos = remoteTodos.map(t => ({
      id: t.id, text: t.text, desc: t.desc, done: t.done,
      due: t.due, priority: t.priority, projectId: t.project_id || null,
      category: localCategoryById.get(String(t.id)) || null,
      timeSpentSec: t.time_spent_sec || 0,
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
let events = safeParse('events', []);
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

function saveEvents() { safeSetItem('events', JSON.stringify(events)); }
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
      dot.innerHTML = '<svg viewBox="0 0 24 24" fill="currentColor" stroke="none"><path d="M12 2a6 6 0 0 0-6 6v3.586l-1.707 1.707A1 1 0 0 0 5 15h14a1 1 0 0 0 .707-1.707L18 11.586V8a6 6 0 0 0-6-6z"></path><path d="M9.5 17a2.5 2.5 0 0 0 5 0z"></path></svg>';
      dotRow.appendChild(dot);
    }
    cell.appendChild(dotRow);

    const hasDue = todos.some((t) => !t.done && t.due === key);
    if (hasDue) {
      const marker = document.createElement('div');
      marker.className = 'day-due-marker';
      marker.title = 'Task due';
      cell.appendChild(marker);
    }

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
    const icon = document.createElement('div');
    icon.className = 'event-icon';
    icon.innerHTML = '<svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><circle cx="12" cy="12" r="8.25" stroke="currentColor" stroke-width="1.6"/><path d="M12 7.5v4.5l3 2" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>';
    const main = document.createElement('div');
    main.className = 'event-row-main';
    const time = document.createElement('div');
    time.className = 'event-time';
    time.textContent = ev.time || 'All day';
    const title = document.createElement('div');
    title.className = 'event-title';
    title.textContent = ev.title;
    main.append(time, title);
    if (ev.notes) {
      const notesRow = document.createElement('div');
      notesRow.className = 'event-notes';
      const notesIcon = document.createElement('span');
      notesIcon.className = 'event-notes-icon';
      notesIcon.innerHTML = '<svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M5 4.5h14v11l-4 4H5v-15Z" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/><path d="M9 9h6M9 13h4" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>';
      const notesText = document.createElement('span');
      notesText.textContent = ev.notes;
      notesRow.append(notesIcon, notesText);
      main.appendChild(notesRow);
    }
    row.append(icon, main);
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
let notes = safeParse('notes', []);
let noteCategories = safeParse('noteCategories', null) || ['General'];
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

function saveNotes() { safeSetItem('notes', JSON.stringify(notes)); }
function saveNoteCategories() { safeSetItem('noteCategories', JSON.stringify(noteCategories)); }
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

function getCloseoutTime() { return safeGetItem(CLOSEOUT_TIME_KEY) || DEFAULT_CLOSEOUT_TIME; }
function isCloseoutEnabled() {
  const v = safeGetItem(CLOSEOUT_ENABLED_KEY);
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
  safeSetItem(CLOSEOUT_LAST_SHOWN_KEY, todayStr());
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
  safeSetItem(CLOSEOUT_TIME_KEY, e.target.value || DEFAULT_CLOSEOUT_TIME);
});
document.getElementById('closeout-enabled-input').addEventListener('change', (e) => {
  safeSetItem(CLOSEOUT_ENABLED_KEY, e.target.checked ? 'true' : 'false');
});

function maybeAutoOpenCloseout() {
  if (!isCloseoutEnabled()) return;
  if (closeoutOverlay.style.display === 'flex') return;
  const now = new Date();
  const nowHM = `${pad2(now.getHours())}:${pad2(now.getMinutes())}`;
  const target = getCloseoutTime();
  const already = safeGetItem(CLOSEOUT_LAST_SHOWN_KEY) === todayStr();
  if (!already && nowHM >= target && unfinishedForCloseout().length > 0) openCloseout();
}
setInterval(maybeAutoOpenCloseout, 60 * 1000);

// ===== Realtime =====
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

// ===== Loading screen =====
const loadingScreen = document.getElementById('loading-screen');
const statusDotEl = document.getElementById('status-dot');
const statusTextEl = document.getElementById('status-text');

const LOADING_READY_PHRASES = [
  'Ready to go',
  "Let's start the day",
  'All set',
  'Ready when you are',
  "Let's get things done",
  'Warming up',
  'Almost there',
  'Good to go',
  'Here we go',
  'Everything is ready',
];
function pickLoadingPhrase() {
  return LOADING_READY_PHRASES[Math.floor(Math.random() * LOADING_READY_PHRASES.length)];
}

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
  setLoadingStage(pickLoadingPhrase());
  setTimeout(() => {
    if (!loadingDismissed) dismissLoading();
  }, 1100);
}

function dismissLoading() {
  if (loadingDismissed) return;
  loadingDismissed = true;
  unlockAudioContext();
  loadingScreen.classList.add('hidden');
}
window.dismissLoading = dismissLoading;
loadingScreen.addEventListener('click', dismissLoading);

function updateConnectionStatus() {
  const online = typeof navigator !== 'undefined' ? navigator.onLine : true;
  statusDotEl.className = 'status-dot ' + (online ? 'online' : 'offline');
  return online;
}
updateConnectionStatus();
window.addEventListener('online', updateConnectionStatus);
window.addEventListener('offline', updateConnectionStatus);

// ===== Welcome modal =====
const WELCOME_KEY = 'aschertypeWelcomeSeen';
const welcomeOverlay = document.getElementById('welcome-overlay');
const welcomeDismissBtn = document.getElementById('welcome-dismiss-btn');

function maybeShowWelcome() {
  if (!welcomeOverlay) return;
  if (safeGetItem(WELCOME_KEY) === 'true') return;
  const welcomeSub = document.getElementById('welcome-sub');
  const dataTitle = document.getElementById('welcome-data-title');
  const dataDesc = document.getElementById('welcome-data-desc');
  const signedIn = typeof currentUser !== 'undefined' && currentUser;
  const translate = (key, fallback) => window.I18N ? window.I18N.t(key, fallback) : fallback;
  if (welcomeSub) welcomeSub.textContent = translate(
    signedIn ? 'welcome.quickSub' : 'welcome.quickSubGuest',
    signedIn ? 'A quick look at the parts that help you plan your day.' : 'A quick look at the parts that help you plan your day. No account required.',
  );
  if (dataTitle) dataTitle.textContent = translate(
    signedIn ? 'welcome.data.syncTitle' : 'welcome.data.localTitle',
    signedIn ? 'Sync when you want' : 'Your data stays local',
  );
  if (dataDesc) dataDesc.textContent = translate(
    signedIn ? 'welcome.data.syncDesc' : 'welcome.data.localDesc',
    signedIn ? 'Your tasks, dates, and notes sync to your account across devices.' : 'Your work is saved on this device. Create an account later if you want sync.',
  );
  setTimeout(() => {
    welcomeOverlay.style.display = 'flex';
  }, 900);
}
function dismissWelcome() {
  safeSetItem(WELCOME_KEY, 'true');
  welcomeOverlay.style.display = 'none';
}
if (welcomeDismissBtn) welcomeDismissBtn.addEventListener('click', dismissWelcome);
if (welcomeOverlay) {
  welcomeOverlay.addEventListener('click', (e) => {
    if (e.target === welcomeOverlay) dismissWelcome();
  });
}

// ===== Tips intro modal =====
const TIPS_INTRO_KEY = 'aschertypeTipsIntroSeen';
const tipsIntroOverlay = document.getElementById('tips-intro-overlay');
const tipsIntroDismissBtn = document.getElementById('tips-intro-dismiss-btn');

function maybeShowTipsIntro() {
  if (!tipsIntroOverlay) return;
  if (!areTipsEnabled()) return;
  if (safeGetItem(TIPS_INTRO_KEY) === 'true') return;
  if (welcomeOverlay && welcomeOverlay.style.display === 'flex') return;
  tipsIntroOverlay.style.display = 'flex';
}
function dismissTipsIntro() {
  safeSetItem(TIPS_INTRO_KEY, 'true');
  tipsIntroOverlay.style.display = 'none';
}
if (tipsIntroDismissBtn) tipsIntroDismissBtn.addEventListener('click', dismissTipsIntro);
if (tipsIntroOverlay) {
  tipsIntroOverlay.addEventListener('click', (e) => {
    if (e.target === tipsIntroOverlay) dismissTipsIntro();
  });
}

// ===== Modal focus trap =====
(function setupModalFocusTrap() {
  const FOCUSABLE = 'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';
  let lastFocused = null;
  let activeOverlay = null;

  function isVisible(el) {
    return el.offsetParent !== null || el.style.display === 'flex' || el.style.display === 'block';
  }

  function trapKeydown(e) {
    if (!activeOverlay) return;
    if (e.key === 'Tab') {
      const focusables = Array.from(activeOverlay.querySelectorAll(FOCUSABLE)).filter(isVisible);
      if (!focusables.length) return;
      const first = focusables[0];
      const last = focusables[focusables.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault(); last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault(); first.focus();
      }
    }
  }

  function activate(overlay) {
    if (activeOverlay === overlay) return;
    activeOverlay = overlay;
    lastFocused = document.activeElement;
    const focusables = Array.from(overlay.querySelectorAll(FOCUSABLE)).filter(isVisible);
    if (focusables.length) setTimeout(() => focusables[0].focus(), 0);
    document.addEventListener('keydown', trapKeydown, true);
  }
  function deactivate(overlay) {
    if (activeOverlay !== overlay) return;
    activeOverlay = null;
    document.removeEventListener('keydown', trapKeydown, true);
    if (lastFocused && typeof lastFocused.focus === 'function') lastFocused.focus();
  }

  const overlaySelectors = [
    '#closeout-overlay', '#project-modal-overlay', '#invite-overlay', '#notif-overlay',
    '#welcome-overlay', '#tips-intro-overlay', '#category-modal-overlay', '#task-detail-overlay',
  ];
  overlaySelectors.forEach((sel) => {
    const el = document.querySelector(sel);
    if (!el) return;
    const observer = new MutationObserver(() => {
      const open = el.classList.contains('open') || isVisible(el);
      if (open) activate(el); else deactivate(el);
    });
    observer.observe(el, { attributes: true, attributeFilter: ['style', 'class'] });
  });
})();

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
      const localCategoryById = new Map(todos.map(t => [String(t.id), t.category || null]));
      todos = remoteTodos.map(t => ({
        id: t.id, text: t.text, desc: t.desc, done: t.done,
        due: t.due, priority: t.priority, projectId: t.project_id || null,
        category: localCategoryById.get(String(t.id)) || null,
        timeSpentSec: t.time_spent_sec || 0,
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
  renderTaskCategorySelects();
  tipsBarEl.style.display = areTipsEnabled() ? 'flex' : 'none';
  refreshTip();

  // Hide AI surfaces — AI removed
  document.querySelectorAll('.nav-item[data-view="assistant"]').forEach((el) => {
    el.style.display = 'none';
  });
  const homeAiWidget = document.querySelector('.home-widget-ai');
  if (homeAiWidget) homeAiWidget.style.display = 'none';
  const magicBtn = document.getElementById('todo-magic-btn');
  if (magicBtn) magicBtn.style.display = 'none';

  const deferRenderHiddenViews = () => {
    renderPomodoro();
    renderCalendar();
    renderDayPanel();
    renderCategoryTabs();
    renderNoteCategorySelect();
    renderNotes();
  };
  if ('requestIdleCallback' in window) {
    requestIdleCallback(deferRenderHiddenViews, { timeout: 2000 });
  } else {
    setTimeout(deferRenderHiddenViews, 200);
  }

  setTimeout(maybeAutoOpenCloseout, 4000);
  requestNotifPermissionIfNeeded();
  checkEventNotifications();
  attachRealtimeSubscriptions();

  markLoadingReady();

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