if ('serviceWorker' in navigator) {
  const isElectron = navigator.userAgent.toLowerCase().includes('electron');
  if (isElectron) {
    // Electron ships the full app locally, so a Service Worker adds no
    // benefit here — it's only useful for the hosted web/PWA build. If one
    // was ever registered for this origin in a previous run (e.g. testing
    // in a browser, or an older build), leftover SW registrations/caches
    // can linger in Electron's on-disk profile and cause Chromium storage
    // errors ("Database IO error") on startup. Clean those up — but only
    // once, so we're not repeatedly hitting the disk (and re-triggering
    // that same error) on every launch once it's already clean.
    const SW_CLEANUP_KEY = 'electron-sw-cleanup-v1';
    let alreadyCleaned = false;
    try { alreadyCleaned = localStorage.getItem(SW_CLEANUP_KEY) === '1'; } catch (err) { /* ignore */ }
    if (!alreadyCleaned) {
      Promise.all([
        navigator.serviceWorker.getRegistrations()
          .then((regs) => Promise.all(regs.map((reg) => reg.unregister()))),
        (window.caches && caches.keys)
          ? caches.keys().then((keys) => Promise.all(keys.map((key) => caches.delete(key))))
          : Promise.resolve(),
      ])
        .then(() => { try { localStorage.setItem(SW_CLEANUP_KEY, '1'); } catch (err) { /* ignore */ } })
        .catch((err) => console.warn('[SW] Cleanup failed:', err));
    }
  } else if (location.protocol === 'http:' || location.protocol === 'https:') {
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('./sw.js')
        .then((reg) => console.log('[PWA] SW registered:', reg.scope))
        .catch((err) => console.error('[PWA] SW failed:', err));
    });
  }
}

const dateFormatterCache = new Map();
function appLocale() {
  return window.I18N && typeof window.I18N.getLocale === 'function' ? window.I18N.getLocale() : 'en-US';
}
function formatAppDate(date, options) {
  const locale = appLocale();
  const key = `${locale}:${JSON.stringify(options)}`;
  let formatter = dateFormatterCache.get(key);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat(locale, options);
    dateFormatterCache.set(key, formatter);
  }
  return formatter.format(date);
}

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
    console.warn(`[MossTask] Corrupted localStorage key "${key}", clearing it.`, err);
    try { localStorage.removeItem(key); } catch (e) {  }
    return fallback;
  }
}

function safeSetItem(key, value) {
  try {
    localStorage.setItem(key, value);
    return true;
  } catch (err) {
    console.warn(`[MossTask] Could not write "${key}" to localStorage.`, err);
    return false;
  }
}

function safeRemoveItem(key) {
  try { localStorage.removeItem(key); } catch (err) {  }
}

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
      accountStatusEl.textContent = "You're using MossTask without an account. Data is stored on this device only.";
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
  if (typeof window.openAuthFromGuest === 'function') window.openAuthFromGuest();
});

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

const sidebar = document.getElementById('sidebar');
const sidebarBackdrop = document.getElementById('sidebar-backdrop');
const menuToggle = document.getElementById('menu-toggle');
function openSidebar() { sidebar.classList.add('open'); sidebarBackdrop.classList.add('show'); }
function closeSidebar() { sidebar.classList.remove('open'); sidebarBackdrop.classList.remove('show'); }
menuToggle.addEventListener('click', () => {
  sidebar.classList.contains('open') ? closeSidebar() : openSidebar();
});
sidebarBackdrop.addEventListener('click', closeSidebar);

// ===== Desktop resizable sidebar (VS Code behaviour) =====
// While dragging the sidebar follows the cursor between MIN and MAX. Dragging further left keeps it at MIN until the
// cursor passes HIDE_AT, then it slides shut live (no waiting for mouse-up). Drag back past REOPEN_AT and it slides
// open again. The resizer stays reachable at the left edge while hidden so it can be dragged open, like a VS Code sash.
// Below the desktop breakpoint (<= 860px) the sidebar is the off-canvas mobile drawer and none of this applies.
const SIDEBAR_PREF_KEY = 'sidebarPrefs';
const SIDEBAR_MAX = 240, SIDEBAR_MIN = 184, SIDEBAR_KEY_STEP = 16;
const SIDEBAR_HIDE_AT = 120, SIDEBAR_REOPEN_AT = 136; // small gap = hysteresis, so it never flickers at the threshold
const desktopSidebarMQ = window.matchMedia('(min-width: 861px)');
const appEl = document.querySelector('.app');
const sidebarResizer = document.getElementById('sidebar-resizer');
const sidebarCollapseBtn = document.getElementById('sidebar-collapse-btn');
const sidebarExpandBtn = document.getElementById('sidebar-expand-btn');
const clampSidebarWidth = (w) => Math.min(SIDEBAR_MAX, Math.max(SIDEBAR_MIN, Math.round(w)));
const sidebarPrefs = (() => {
  const saved = safeParse(SIDEBAR_PREF_KEY, {});
  const w = Number(saved && saved.width);
  return { width: Number.isFinite(w) && w > 0 ? clampSidebarWidth(w) : SIDEBAR_MAX, collapsed: !!(saved && saved.collapsed === true) };
})();
function saveSidebarPrefs() { safeSetItem(SIDEBAR_PREF_KEY, JSON.stringify({ width: sidebarPrefs.width, collapsed: sidebarPrefs.collapsed })); }
function paintSidebar(width, collapsed) {
  appEl.style.setProperty('--sidebar-w', width + 'px');
  appEl.classList.toggle('sidebar-collapsed', collapsed);
  sidebar.inert = collapsed; // hidden sidebar must not be reachable by Tab / screen readers
}
function applySidebarState() {
  const collapsed = desktopSidebarMQ.matches && sidebarPrefs.collapsed;
  paintSidebar(sidebarPrefs.width, collapsed);
  sidebarExpandBtn.hidden = !collapsed;
  sidebarExpandBtn.setAttribute('aria-expanded', 'false');
  sidebarCollapseBtn.setAttribute('aria-expanded', String(!collapsed));
  sidebarResizer.setAttribute('aria-valuemin', '0');
  sidebarResizer.setAttribute('aria-valuemax', String(SIDEBAR_MAX));
  sidebarResizer.setAttribute('aria-valuenow', String(collapsed ? 0 : sidebarPrefs.width));
}
function setSidebarCollapsed(collapsed) {
  // Only move focus when it would otherwise be lost (it was inside the sidebar or on the expand button).
  const focusWasHere = sidebar.contains(document.activeElement) || document.activeElement === sidebarExpandBtn;
  sidebarPrefs.collapsed = collapsed;
  saveSidebarPrefs();
  applySidebarState();
  if (focusWasHere) (collapsed ? sidebarExpandBtn : sidebarCollapseBtn).focus();
  announce(collapsed ? 'Sidebar hidden.' : 'Sidebar shown.');
}
function toggleSidebar() {
  if (desktopSidebarMQ.matches) setSidebarCollapsed(!sidebarPrefs.collapsed);
  else sidebar.classList.contains('open') ? closeSidebar() : openSidebar();
}
sidebarCollapseBtn.addEventListener('click', () => setSidebarCollapsed(true));
sidebarExpandBtn.addEventListener('click', () => setSidebarCollapsed(false)); // restores the remembered width
document.addEventListener('keydown', (e) => { // Ctrl/Cmd+B, same as VS Code
  if (!(e.ctrlKey || e.metaKey) || e.altKey || e.shiftKey || String(e.key).toLowerCase() !== 'b') return;
  if (typeof tutorialActive !== 'undefined' && tutorialActive) return;
  if (e.target && e.target.isContentEditable) return;
  e.preventDefault();
  toggleSidebar();
});
sidebarResizer.addEventListener('pointerdown', (e) => {
  if (!desktopSidebarMQ.matches || e.button > 0) return;
  e.preventDefault();
  sidebarResizer.setPointerCapture(e.pointerId);
  document.body.classList.add('sidebar-resizing');
  appEl.classList.add('sidebar-resizing');
  const left = appEl.getBoundingClientRect().left;
  const startVisible = sidebarPrefs.collapsed ? 0 : sidebarPrefs.width;
  const grabOffset = (e.clientX - left) - startVisible; // keeps the edge under the cursor, no jump on grab
  let snapped = sidebarPrefs.collapsed, raw = startVisible, raf = 0;
  const paint = () => {
    raf = 0;
    if (!snapped && raw < SIDEBAR_HIDE_AT) snapped = true;
    else if (snapped && raw >= SIDEBAR_REOPEN_AT) snapped = false;
    paintSidebar(clampSidebarWidth(raw), snapped);
  };
  const move = (ev) => { raw = ev.clientX - left - grabOffset; if (!raf) raf = requestAnimationFrame(paint); };
  const end = () => {
    sidebarResizer.removeEventListener('pointermove', move);
    sidebarResizer.removeEventListener('pointerup', end);
    sidebarResizer.removeEventListener('pointercancel', end);
    if (raf) { cancelAnimationFrame(raf); paint(); }
    document.body.classList.remove('sidebar-resizing');
    appEl.classList.remove('sidebar-resizing');
    const changed = snapped !== sidebarPrefs.collapsed;
    sidebarPrefs.collapsed = snapped;
    if (!snapped) sidebarPrefs.width = clampSidebarWidth(raw); // when hidden, the last good width stays remembered
    saveSidebarPrefs(); applySidebarState();
    if (changed) announce(snapped ? 'Sidebar hidden.' : 'Sidebar shown.');
  };
  sidebarResizer.addEventListener('pointermove', move);
  sidebarResizer.addEventListener('pointerup', end);
  sidebarResizer.addEventListener('pointercancel', end);
});
sidebarResizer.addEventListener('keydown', (e) => {
  if (!desktopSidebarMQ.matches) return;
  if (sidebarPrefs.collapsed) {
    if (['ArrowRight', 'End', 'Enter', ' '].includes(e.key)) { e.preventDefault(); setSidebarCollapsed(false); }
    return;
  }
  let w = null;
  if (e.key === 'ArrowLeft') w = sidebarPrefs.width - SIDEBAR_KEY_STEP;
  else if (e.key === 'ArrowRight') w = sidebarPrefs.width + SIDEBAR_KEY_STEP;
  else if (e.key === 'End') w = SIDEBAR_MAX;
  else if (e.key === 'Home' || e.key === 'Enter') { e.preventDefault(); setSidebarCollapsed(true); return; }
  if (w === null) return;
  e.preventDefault();
  if (w < SIDEBAR_MIN) { setSidebarCollapsed(true); return; }
  sidebarPrefs.width = clampSidebarWidth(w);
  saveSidebarPrefs(); applySidebarState();
});
sidebarResizer.addEventListener('dblclick', () => { // VS Code: double-click the sash to reset (or reopen)
  const wasHidden = sidebarPrefs.collapsed;
  sidebarPrefs.width = SIDEBAR_MAX;
  sidebarPrefs.collapsed = false;
  saveSidebarPrefs(); applySidebarState();
  if (wasHidden) announce('Sidebar shown.');
});
const onSidebarBreakpoint = () => { if (desktopSidebarMQ.matches) closeSidebar(); applySidebarState(); };
if (desktopSidebarMQ.addEventListener) desktopSidebarMQ.addEventListener('change', onSidebarBreakpoint);
else if (desktopSidebarMQ.addListener) desktopSidebarMQ.addListener(onSidebarBreakpoint);
applySidebarState();

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
  if (typeof window.openAuthFromGuest === 'function') window.openAuthFromGuest();
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

const NOTIF_ENABLED_KEY = 'notificationsEnabled';
function isNotifEnabled() {
  const v = safeGetItem(NOTIF_ENABLED_KEY);
  return v === null ? true : v === 'true';
}
function setNotifEnabled(on) { safeSetItem(NOTIF_ENABLED_KEY, on ? 'true' : 'false'); }

const notifPermissionHintEl = document.getElementById('notif-permission-hint');
function updateNotifPermissionHint() {
  if (!notifPermissionHintEl) return;
  if (window.MossNotify && MossNotify.isNative()) {
    MossNotify.getPermission().then((p) => {
      notifPermissionHintEl.textContent = p === 'granted' ? 'System alerts allowed'
        : p === 'denied' ? 'Blocked in Android settings — using in-app alerts' : "We'll ask when needed";
    });
    return;
  }
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
  } catch (err) {  }
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

// Native: ask via Android's dialog only when the OS can still show it (never
// re-prompt after a denial); automatic startup ask happens at most once.
async function requestNativeNotifPermission(fromToggle) {
  const cur = await MossNotify.getPermission();
  if (cur === 'default' && (fromToggle || !MossNotify.alreadyAsked())) await MossNotify.requestPermission();
  const now = await MossNotify.getPermission();
  if (now === 'denied') {
    setNotifEnabled(false);
    const cb = document.getElementById('notifications-enabled-input');
    if (cb) cb.checked = false;
  }
  await MossNotify.refreshDeliveryState();
  if (now === 'granted' && isNotifEnabled() && currentUser) await MossNotify.registerPush();
  else if (!isNotifEnabled() || now === 'denied') MossNotify.unregisterPush();
  scheduleReminderSync();
  updateNotifPermissionHint();
}
window.addEventListener('mosstask:resume', () => {
  if (window.MossNotify && MossNotify.isNative() && currentUser && isNotifEnabled()) MossNotify.registerPush();
});
// Foreground push: Android doesn't show it, so surface it like other in-app alerts.
window.addEventListener('mosstask:pushregistered', () => { if (window.MossNotify) MossNotify.refreshDeliveryState().then(scheduleReminderSync); }); // drops local copies once push owns delivery
window.addEventListener('mosstask:push', (e) => sendNotification(e.detail.title, e.detail.body));
function requestNotifPermissionIfNeeded(fromToggle) {
  if (!isNotifEnabled()) return;
  if (window.MossNotify && MossNotify.isNative()) { requestNativeNotifPermission(!!fromToggle); return; }
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
    try { new Notification(title, { body }); return; } catch (err) {  }
  }
  const el = document.createElement('div');
  el.className = 'toast notif';
  el.innerHTML = `<span class="toast-dot"></span><span><strong>${escapeHtml(title)}</strong><br>${escapeHtml(body)}</span>`;
  toastContainer.appendChild(el);
  setTimeout(() => { el.classList.add('leaving'); setTimeout(() => el.remove(), 320); }, 4200);
}
document.getElementById('notifications-enabled-input').addEventListener('change', (e) => {
  setNotifEnabled(e.target.checked);
  if (e.target.checked) requestNotifPermissionIfNeeded(true);
  else scheduleReminderSync(); // cancels pending native notifications
  updateNotifPermissionHint();
});

// Native reminders: keep OS-scheduled notifications in step with tasks/events.
let reminderSyncTimer = null;
function scheduleReminderSync() {
  if (!window.MossNotify || !MossNotify.isNative()) return;
  clearTimeout(reminderSyncTimer);
  reminderSyncTimer = setTimeout(() => MossNotify.sync(events, todos, isNotifEnabled()), 300);
}

// Catch-up reminders: fire anything whose time has passed (within a grace
// window) and hasn't been shown, so sleep / throttled timers / a late app
// launch don't silently drop it. Runs often; each pass is a cheap compare.
const EVENT_GRACE_MS = 10 * 60000;
const TASK_GRACE_MS = 15 * 60000;
function hmToDate(dateStr, hm) {
  const [y, m, d] = dateStr.split('-').map(Number);
  const [hh, mm] = hm.split(':').map(Number);
  if ([y, m, d, hh, mm].some(Number.isNaN)) return null;
  return new Date(y, m - 1, d, hh, mm, 0, 0);
}

let notifiedEventKeys = new Set();
let notifiedEventDay = todayStr();
function checkEventNotifications() {
  if (!isNotifEnabled()) return;
  if (window.MossNotify && MossNotify.handlesReminders()) return; // OS delivers these on Android
  if (notifiedEventDay !== todayStr()) { notifiedEventKeys.clear(); notifiedEventDay = todayStr(); }
  const nowMs = Date.now();
  const today = todayStr();
  events.forEach(ev => {
    if (ev.date !== today || !ev.time) return;
    const start = hmToDate(ev.date, ev.time);
    if (!start) return;
    const startMs = start.getTime();
    const soonKey = `soon:${ev.id}`;
    const startKey = `start:${ev.id}`;
    // 5-minute warning: only while the event is still upcoming.
    if (nowMs >= startMs - 5 * 60000 && nowMs < startMs && !notifiedEventKeys.has(soonKey)) {
      notifiedEventKeys.add(soonKey);
      sendNotification('Coming up in 5 minutes', ev.title);
    }
    // Start: fire once, up to the grace window after (covers sleep/throttling).
    if (nowMs >= startMs && nowMs < startMs + EVENT_GRACE_MS && !notifiedEventKeys.has(startKey)) {
      notifiedEventKeys.add(startKey);
      notifiedEventKeys.add(soonKey); // don't show "in 5 min" after the fact
      sendNotification('Starting now', ev.title);
    }
  });
}

const taskDetailReminder = document.getElementById('task-detail-reminder');
let notifiedTaskKeys = new Set();
let notifiedTaskDay = todayStr();
function checkTaskReminders() {
  if (!isNotifEnabled()) return;
  if (window.MossNotify && MossNotify.handlesReminders()) return; // OS delivers these on Android
  if (notifiedTaskDay !== todayStr()) { notifiedTaskKeys.clear(); notifiedTaskDay = todayStr(); }
  const nowMs = Date.now();
  const today = todayStr();
  todos.forEach(t => {
    if (t.done || t.due !== today || !t.reminderTime) return;
    const at = hmToDate(t.due, t.reminderTime);
    if (!at) return;
    const key = `task:${t.id}`;
    if (nowMs >= at.getTime() && nowMs < at.getTime() + TASK_GRACE_MS && !notifiedTaskKeys.has(key)) {
      notifiedTaskKeys.add(key);
      sendNotification('Task due today', t.text);
    }
  });
}
function checkAllReminders() { checkEventNotifications(); checkTaskReminders(); }
setInterval(checkAllReminders, 10 * 1000);
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') checkAllReminders(); });
window.addEventListener('focus', checkAllReminders);

function nextOccurrenceDate(dueStr, recurrence) {
  const d = new Date(dueStr + 'T00:00:00');
  if (recurrence.freq === 'daily') d.setDate(d.getDate() + (recurrence.interval || 1));
  else if (recurrence.freq === 'weekly') d.setDate(d.getDate() + 7 * (recurrence.interval || 1));
  else if (recurrence.freq === 'monthly') d.setMonth(d.getMonth() + (recurrence.interval || 1));
  return dateKey(d.getFullYear(), d.getMonth(), d.getDate());
}
function handleRecurringCompletion(t) {
  if (!t.recurrence || !t.due) return;
  const nextDue = nextOccurrenceDate(t.due, t.recurrence);
  if (t.recurrence.until && nextDue > t.recurrence.until) return;
  const clone = {
    ...t,
    id: Date.now() + Math.random().toString(36).slice(2, 6),
    done: false,
    due: nextDue,
    subtasks: (t.subtasks || []).map(s => ({ ...s, done: false })),
  };
  todos.push(clone);
  saveTodos();
  if (currentUser) dbUpsert('todos', todoRemoteRow(clone));
}

document.addEventListener('keydown', (e) => {
  if (typeof tutorialActive !== 'undefined' && tutorialActive) return;
  const tag = (e.target.tagName || '').toLowerCase();
  const typing = tag === 'input' || tag === 'textarea' || e.target.isContentEditable;
  if (e.key === '?' && !typing) {
    e.preventDefault();
    openShortcuts();
    return;
  }
  if (typing) return;
  if (e.key === 'n' && !e.ctrlKey && !e.metaKey) {
    e.preventDefault();
    openTaskAdd();
  } else if (e.key === '/' && !e.ctrlKey && !e.metaKey) {
    e.preventDefault();
    openSearch();
  } else if ((e.key === 'k' || e.key === 'K') && (e.ctrlKey || e.metaKey)) {
    e.preventDefault();
    openSearch();
  } else if (e.key >= '1' && e.key <= '4' && (e.ctrlKey || e.metaKey)) {
    e.preventDefault();
    const views = ['all', 'active', 'calendar', 'notes'];
    setView(views[Number(e.key) - 1]);
  }
});

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

let projects = safeParse('projects', []);
let currentProjectId = null;
let projectMembers = [];
let notifications = [];

const addProjectBtn = document.getElementById('add-project-btn');
const addPersonalBtn = document.getElementById('add-personal-btn');
const projectSelectEl = document.getElementById('todo-project-select');
const projectHeaderActions = document.getElementById('project-header-actions');
const projectRenameBtn = document.getElementById('project-rename-btn');
const projectDeleteBtn = document.getElementById('project-delete-btn');
const projectMoreBtn = document.getElementById('project-more-btn');
const projectMoreMenu = document.getElementById('project-more-menu');
const projectMembersBtn = document.getElementById('project-members-btn');
const projectDescriptionAddBtn = document.getElementById('project-description-add');
const projectModalAnnouncementInput = document.getElementById('project-modal-announcement');
const projectAnnouncementFieldEl = document.getElementById('project-announcement-field');

const projectModalOverlay = document.getElementById('project-modal-overlay');
const projectModalTitle = document.getElementById('project-modal-title');
// Project text limits (80 / 500). Inputs enforce them via maxlength; saves validate instead of truncating.
const PROJECT_NAME_MAX = 80;
const PROJECT_DESCRIPTION_MAX = 500;
function projectTextError(kind, value) {
  const max = kind === 'title' ? PROJECT_NAME_MAX : PROJECT_DESCRIPTION_MAX;
  const len = [...value].length;
  if (len <= max) return '';
  return (kind === 'title' ? 'Project name' : 'Description') + ' is ' + (len - max) + ' character' + (len - max === 1 ? '' : 's') + ' over the ' + max + ' character limit.';
}
// Live "n / max" counter. Text (not colour) marks the limit; the counter is referenced by aria-describedby.
function bindCharCounter(field, counter, max) {
  if (!field || !counter) return () => {};
  const update = () => {
    const len = [...field.value].length;
    counter.textContent = len >= max ? len + ' / ' + max + ' (limit reached)' : len + ' / ' + max;
    counter.classList.toggle('near-limit', len >= max * 0.9);
  };
  field.addEventListener('input', update);
  update();
  return update;
}
// Polite status announcements for changes that have no toast of their own.
const srStatusEl = document.getElementById('sr-status');
function announce(msg) {
  if (!srStatusEl || !msg) return;
  srStatusEl.textContent = '';
  setTimeout(() => { srStatusEl.textContent = msg; }, 60);
}
const projectNameInput = document.getElementById('project-name-input');
const projectDescriptionInput = document.getElementById('project-description-input');
const projectPreviewTile = document.getElementById('project-preview-tile');
const projectModalSaveBtn = document.getElementById('project-modal-save-btn');
const projectModalCancelBtn = document.getElementById('project-modal-cancel-btn');
const projectModalCloseBtn = document.getElementById('project-modal-close-btn');
const projectModalUsageEl = document.getElementById('project-modal-usage');
const projectModalErrorEl = document.getElementById('project-modal-error');

let editingProjectId = null;

// Turns a raw Postgres trigger message (raise exception 'project_limit_reached: ...')
// into something a non-technical user understands. Falls back to the original
// message for anything unrecognized, so real errors aren't hidden.
function friendlyPlanError(message) {
  const m = String(message || '');
  if (m.includes('project_limit_reached')) {
    return "You've reached your plan's limit for collaborative projects. Personal projects are unlimited. Upgrade for more.";
  }
  if (m.includes('member_limit_reached')) {
    return "This project is at its member limit for the owner's plan. Upgrade to add more people.";
  }
  return message || 'Something went wrong. Please try again.';
}
function showProjectModalError(msg) {
  projectModalErrorEl.textContent = msg;
  projectModalErrorEl.style.display = msg ? 'block' : 'none';
}
async function refreshProjectModalUsage() {
  projectModalUsageEl.style.display = 'none';
  if (!currentUser || typeof dbFetchPlanUsage !== 'function') return;
  const usage = await dbFetchPlanUsage();
  if (!usage || usage.max_projects == null) return; // unlimited plan: no need to show a counter
  projectModalUsageEl.textContent = `${usage.owned_projects}/${usage.max_projects} collaborative projects used on your ${usage.plan} plan`;
  projectModalUsageEl.style.display = 'block';
}

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
function projectTypeOf(p) { return p && p.type === 'team' ? 'team' : 'personal'; }
function isTeamProject(projectId) { return projectTypeOf(getProject(projectId)) === 'team'; }
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
function canPinTask(t) {
  if (!t.projectId) return true;
  return isProjectOwner(t.projectId);
}
function canAssignTask(t) {
  return !!t.projectId && isTeamProject(t.projectId) && isProjectOwner(t.projectId);
}

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
  announce(text ? 'Announcement updated.' : 'Announcement cleared.');
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

function formatAnnouncementDate(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '';
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
}
function renderAnnouncementDate() {
  if (!projectAnnouncementTextEl) return;
  const p = getProject(currentProjectId);
  const label = p ? formatAnnouncementDate(p.announcementUpdatedAt) : '';
  let dateEl = projectAnnouncementTextEl.parentNode.querySelector('.project-announcement-date');
  if (!label) { if (dateEl) dateEl.remove(); return; }
  if (!dateEl) {
    dateEl = document.createElement('div');
    dateEl.className = 'project-announcement-date';
    projectAnnouncementTextEl.insertAdjacentElement('afterend', dateEl);
  }
  dateEl.textContent = label;
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
    renderAnnouncementDate();
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
const updateProjectNameCount = bindCharCounter(projectNameInput, document.getElementById('project-name-count'), PROJECT_NAME_MAX);
const updateProjectDescCount = bindCharCounter(projectDescriptionInput, document.getElementById('project-description-input-count'), PROJECT_DESCRIPTION_MAX);
[projectNameInput, projectDescriptionInput].forEach((n) => n.addEventListener('input', () => { n.removeAttribute('aria-invalid'); showProjectModalError(''); }));

let pendingProjectType = 'personal';
function openProjectModal(existingProject = null, type = 'personal') {
  showProjectModalError('');
  pendingProjectType = type === 'team' ? 'team' : 'personal';
  editingProjectId = existingProject ? existingProject.id : null;
  if (!existingProject && pendingProjectType === 'team') refreshProjectModalUsage(); else projectModalUsageEl.style.display = 'none';
  projectModalTitle.textContent = existingProject ? 'Edit project' : (pendingProjectType === 'personal' ? 'New personal project' : 'New project');
  projectNameInput.value = existingProject ? existingProject.name : '';
  projectDescriptionInput.value = existingProject ? (existingProject.description || '') : '';
  const canEditAnnouncement = !!existingProject && isProjectOwner(existingProject.id);
  projectAnnouncementFieldEl.style.display = canEditAnnouncement ? '' : 'none';
  projectModalAnnouncementInput.value = canEditAnnouncement ? (existingProject.announcement || '') : '';
  previewTileColor = projectTileColor(existingProject || { id: 'preview-' + Date.now(), name: '' });
  projectPreviewTile.style.background = previewTileColor;
  updateProjectPreviewLetter();
  updateProjectNameCount(); updateProjectDescCount();
  projectNameInput.removeAttribute('aria-invalid'); projectDescriptionInput.removeAttribute('aria-invalid');
  projectModalOverlay.style.display = 'flex';
  setTimeout(() => projectNameInput.focus(), 30);
}
function closeProjectModal() { projectModalOverlay.style.display = 'none'; editingProjectId = null; }

addPersonalBtn.addEventListener('click', () => openProjectModal(null, 'personal'));
const guestProjectOverlay = document.getElementById('guest-project-overlay');
function closeGuestProjectNotice() { guestProjectOverlay.style.display = 'none'; }
addProjectBtn.addEventListener('click', () => {
  if (currentUser) { openProjectModal(null, 'team'); return; }
  if (isGuest) guestProjectOverlay.style.display = 'flex'; // still loading session => do nothing, never treat as guest
});
document.getElementById('guest-project-close-btn').addEventListener('click', closeGuestProjectNotice);
document.getElementById('guest-project-cancel-btn').addEventListener('click', closeGuestProjectNotice);
guestProjectOverlay.addEventListener('click', (e) => { if (e.target === guestProjectOverlay) closeGuestProjectNotice(); });
function guestProjectAuth(tab) {
  closeGuestProjectNotice();
  if (!supabaseReady || typeof window.openAuthFromGuest !== 'function') return;
  try { sessionStorage.setItem('mosstaskResumeTeamProject', '1'); } catch (e) {}
  window.openAuthFromGuest(tab);
}
document.getElementById('guest-project-signin-btn').addEventListener('click', () => guestProjectAuth('login'));
document.getElementById('guest-project-signup-btn').addEventListener('click', () => guestProjectAuth('register'));
projectModalCancelBtn.addEventListener('click', closeProjectModal);
projectModalCloseBtn.addEventListener('click', closeProjectModal);
projectModalOverlay.addEventListener('click', (e) => { if (e.target === projectModalOverlay) closeProjectModal(); });

projectModalSaveBtn.addEventListener('click', async () => {
  const name = projectNameInput.value.trim();
  const description = projectDescriptionInput.value.trim();
  if (!name) {
    projectNameInput.setAttribute('aria-invalid', 'true');
    showProjectModalError('Give the project a name.');
    projectNameInput.focus(); return;
  }
  const modalLimitError = projectTextError('title', name) || projectTextError('description', description);
  if (modalLimitError) {
    const nameBad = !!projectTextError('title', name);
    (nameBad ? projectNameInput : projectDescriptionInput).setAttribute('aria-invalid', 'true');
    showProjectModalError(modalLimitError);
    (nameBad ? projectNameInput : projectDescriptionInput).focus(); return;
  }
  if (editingProjectId) {
    const p = getProject(editingProjectId);
    if (p) {
      const prev = { name: p.name, description: p.description || '' };
      const newAnnouncement = projectModalAnnouncementInput.value.trim().slice(0, 500);
      const announcementChanged = isProjectOwner(p.id) && newAnnouncement !== (p.announcement || '');
      p.name = name;
      p.description = description;
      if (currentUser) {
        setButtonBusy(projectModalSaveBtn, 'Saving…');
        const { error } = await dbUpdate('projects', p.id, { name, description: description || null });
        clearButtonBusy(projectModalSaveBtn);
        if (error) {
          p.name = prev.name; p.description = prev.description;      // keep the modal open with the user's input intact
          showProjectModalError("Couldn't save your changes. " + friendlyPlanError(error.message));
          return;
        }
      }
      saveProjects();
      if (announcementChanged) setProjectAnnouncement(p.id, newAnnouncement); // sets the real timestamp + syncs
    }
  } else {
    // Guests have no account, so nothing on the server can count their projects —
    // enforce the same limit as the Free tier locally. Signed-in users are
    // checked by the database trigger below (source of truth; can't be bypassed).
    const type = pendingProjectType;
    if (type === 'team' && (!currentUser || !supabaseReady)) { closeProjectModal(); return; } // defensive: guests never reach here
    const p = { id: Date.now(), name, description, userId: currentUser ? currentUser.id : null, type };
    if (currentUser) {
      setButtonBusy(projectModalSaveBtn, 'Saving…');
      const { error } = await dbUpsert('projects', projectRemoteRow(p));
      clearButtonBusy(projectModalSaveBtn);
      if (error) { showProjectModalError(friendlyPlanError(error.message)); return; } // don't add locally on failure
    }
    projects.push(p);
    saveProjects();
  }
  closeProjectModal();
  renderProjectNav();
  renderProjectSelect();
  if (currentView === 'project') { renderViewHeader(); renderTodos(); renderCollabPanel(); }
});

function deleteProject(id) {
  const removedProject = getProject(id);
  const removedAnnouncement = getProjectAnnouncement(id);
  projects = projects.filter(p => String(p.id) !== String(id));
  let touchedIds = [];
  todos.forEach(t => { if (String(t.projectId) === String(id)) { touchedIds.push(t.id); t.projectId = null; } });
  saveProjects();
  saveTodos();
  setProjectAnnouncement(id, '');
  if (currentUser) {
    touchedIds.forEach(tid => { const t = todos.find(x => x.id === tid); if (t) dbUpdate('todos', t.id, { project_id: null }); });
    dbDelete('projects', id, currentUser.id);
  }
  return { project: removedProject, announcement: removedAnnouncement, touchedIds };
}
projectDeleteBtn.addEventListener('click', () => {
  if (!currentProjectId) return;
  const p = getProject(currentProjectId);
  if (!p) return;
  openConfirmModal({
    title: `Delete "${p.name}"?`,
    message: "Tasks in it will be kept but unassigned. You can undo this right after.",
    confirmLabel: 'Delete',
    danger: true,
    onConfirm: () => {
      const removedId = p.id;
      const { project, announcement, touchedIds } = deleteProject(removedId);
      setView('all');
      showUndoToast(`"${project.name}" deleted.`, () => {
        projects.push(project);
        saveProjects();
        touchedIds.forEach(tid => { const t = todos.find(x => x.id === tid); if (t) t.projectId = removedId; });
        saveTodos();
        if (announcement) setProjectAnnouncement(removedId, announcement);
        if (currentUser) {
          dbUpsert('projects', projectRemoteRow(project));
          touchedIds.forEach(tid => { const t = todos.find(x => x.id === tid); if (t) dbUpdate('todos', t.id, { project_id: removedId }); });
        }
        currentProjectId = removedId;
        setView('project');
      });
    },
  });
});
function closeProjectMoreMenu() {
  projectMoreMenu.hidden = true;
  projectMoreBtn.setAttribute('aria-expanded', 'false');
}
projectMoreBtn.addEventListener('click', (e) => {
  e.stopPropagation();
  const open = projectMoreMenu.hidden;
  projectMoreMenu.hidden = !open;
  projectMoreBtn.setAttribute('aria-expanded', open ? 'true' : 'false');
});
document.addEventListener('click', (e) => { if (!projectMoreMenu.hidden && !e.target.closest('.project-more-wrap')) closeProjectMoreMenu(); });
document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !projectMoreMenu.hidden) { closeProjectMoreMenu(); projectMoreBtn.focus(); } });
projectDeleteBtn.addEventListener('click', closeProjectMoreMenu);
projectMembersBtn.addEventListener('click', () => { const c = document.getElementById('project-collab-panel'); if (c) c.classList.add('open'); });
// ===== Inline editing of project name / description (project header) =====
const projectIdentityTileEl = document.getElementById('project-identity-tile');
const projectTitleEditBtn = document.getElementById('project-title-edit-btn');
const projectTitleRowEl = document.getElementById('project-title-row');
const projectTitleForm = document.getElementById('project-title-form');
const projectTitleInput = document.getElementById('project-title-input');
const projectTitleSaveBtn = document.getElementById('project-title-save');
const projectTitleCancelBtn = document.getElementById('project-title-cancel');
const projectTitleErrorEl = document.getElementById('project-title-error');
const projectAboutEl = document.getElementById('project-about');
const projectAboutRowEl = document.getElementById('project-about-row');
const projectDescriptionEl = document.getElementById('project-description');
const projectDescriptionEditBtn = document.getElementById('project-description-edit-btn');
const projectDescriptionForm = document.getElementById('project-description-form');
const projectDescriptionInline = document.getElementById('project-description-inline');
const projectDescriptionSaveBtn = document.getElementById('project-description-save');
const projectDescriptionCancelBtn = document.getElementById('project-description-cancel');
const projectDescriptionErrorEl = document.getElementById('project-description-error');

// Only one field is edited at a time. `projectId` pins the edit to the project it started on.
let inlineEdit = { field: null, projectId: null, saving: false };

function setInlineError(field, msg) {
  const node = field === 'title' ? projectTitleErrorEl : projectDescriptionErrorEl;
  node.textContent = msg || '';
  node.hidden = !msg;
  const input = field === 'title' ? projectTitleInput : projectDescriptionInline;
  if (msg) input.setAttribute('aria-invalid', 'true'); else input.removeAttribute('aria-invalid');
}
function setInlineBusy(busy) {
  inlineEdit.saving = busy;
  [projectTitleInput, projectTitleSaveBtn, projectTitleCancelBtn,
   projectDescriptionInline, projectDescriptionSaveBtn, projectDescriptionCancelBtn]
    .forEach((n) => { if (n) n.disabled = busy; });
  projectDescriptionSaveBtn.textContent = busy ? 'Saving…' : 'Save';
  projectTitleForm.classList.toggle('is-saving', busy);
}
function openInlineEdit(field) {
  if (inlineEdit.saving || currentView !== 'project' || !currentProjectId) return;
  if (!canRenameProject(currentProjectId)) return;
  const p = getProject(currentProjectId);
  if (!p) return;
  inlineEdit = { field, projectId: p.id, saving: false };
  setInlineError('title', ''); setInlineError('description', '');
  if (field === 'title') projectTitleInput.value = p.name || '';
  else projectDescriptionInline.value = p.description || '';
  updateTitleCount(); updateDescCount();
  renderViewHeader();
  const focusEl = field === 'title' ? projectTitleInput : projectDescriptionInline;
  setTimeout(() => {
    focusEl.focus();
    if (field === 'title') focusEl.select();
    else focusEl.setSelectionRange(focusEl.value.length, focusEl.value.length);
  }, 0);
}
function closeInlineEdit(returnFocus) {
  const field = inlineEdit.field;
  inlineEdit = { field: null, projectId: null, saving: false };
  setInlineBusy(false);
  renderViewHeader();
  if (returnFocus && field) {
    const target = field === 'title'
      ? (projectTitleEditBtn.hidden ? null : projectTitleEditBtn)
      : (projectDescriptionEditBtn.hidden ? document.getElementById('project-description-add') : projectDescriptionEditBtn);
    if (target && target.offsetParent !== null) target.focus();
  }
}
async function commitInlineEdit(fromOutside) {
  if (inlineEdit.saving || !inlineEdit.field) return;
  const field = inlineEdit.field;
  const pid = inlineEdit.projectId;
  const p = getProject(pid);
  if (!p) { closeInlineEdit(false); return; }
  if (!canRenameProject(pid)) { setInlineError(field, "You don't have permission to edit this project."); return; }

  const prop = field === 'title' ? 'name' : 'description';
  const raw = field === 'title' ? projectTitleInput.value : projectDescriptionInline.value;
  const value = raw.trim();
  const limitError = projectTextError(field, value);
  if (limitError) { setInlineError(field, limitError); (field === 'title' ? projectTitleInput : projectDescriptionInline).focus(); return; }

  if (field === 'title' && !value) { setInlineError('title', 'Give the project a name.'); projectTitleInput.focus(); return; }
  if (value === (p[prop] || '')) { closeInlineEdit(!fromOutside); return; } // nothing changed

  setInlineError(field, '');
  setInlineBusy(true);
  if (currentUser) {
    const patch = field === 'title' ? { name: value } : { description: value || null };
    const { error } = await dbUpdateChecked('projects', pid, patch);
    if (error) {
      // Keep the form open with the user's text intact so nothing is lost.
      setInlineBusy(false);
      setInlineError(field, "Couldn't save. " + friendlyPlanError(error.message));
      (field === 'title' ? projectTitleInput : projectDescriptionInline).focus();
      return;
    }
  }
  // The object may have been replaced by a realtime update while we were saving.
  const fresh = getProject(pid);
  if (fresh) { fresh[prop] = value; saveProjects(); }
  inlineEdit = { field: null, projectId: null, saving: false };
  setInlineBusy(false);
  renderProjectNav();
  renderProjectSelect();
  renderViewHeader();
  renderTodos(); // task cards show the project name
  announce(field === 'title' ? 'Project name saved.' : 'Project description saved.');
  // Give focus back to the pencil only if nothing else took it (e.g. an outside click).
  if (document.activeElement === document.body || !document.activeElement) {
    const btn = field === 'title' ? projectTitleEditBtn : (projectDescriptionEditBtn.hidden ? projectDescriptionAddBtn : projectDescriptionEditBtn);
    if (btn && btn.offsetParent !== null) btn.focus();
  }
}

const updateTitleCount = bindCharCounter(projectTitleInput, document.getElementById('project-title-count'), PROJECT_NAME_MAX);
const updateDescCount = bindCharCounter(projectDescriptionInline, document.getElementById('project-description-count'), PROJECT_DESCRIPTION_MAX);
projectTitleEditBtn.addEventListener('click', () => openInlineEdit('title'));
projectDescriptionEditBtn.addEventListener('click', () => openInlineEdit('description'));
projectDescriptionAddBtn.addEventListener('click', () => openInlineEdit('description'));
projectTitleForm.addEventListener('submit', (e) => { e.preventDefault(); commitInlineEdit(); });
projectDescriptionForm.addEventListener('submit', (e) => { e.preventDefault(); commitInlineEdit(); });
projectTitleCancelBtn.addEventListener('click', () => closeInlineEdit(true));
projectDescriptionCancelBtn.addEventListener('click', () => closeInlineEdit(true));
projectTitleInput.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); if (!inlineEdit.saving) closeInlineEdit(true); }
});
projectDescriptionInline.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); if (!inlineEdit.saving) closeInlineEdit(true); }
  else if (e.key === 'Enter' && (e.ctrlKey || e.metaKey) && !e.isComposing) { e.preventDefault(); commitInlineEdit(); } // plain Enter = new line; Ctrl/Cmd+Enter or the Save button saves
});
// Clicking outside saves a valid change (least surprising: nothing typed is lost); an empty name just cancels.
document.addEventListener('pointerdown', (e) => {
  if (!inlineEdit.field || inlineEdit.saving) return;
  const form = inlineEdit.field === 'title' ? projectTitleForm : projectDescriptionForm;
  if (form.contains(e.target)) return;
  if (inlineEdit.field === 'title' && !projectTitleInput.value.trim()) { closeInlineEdit(false); return; }
  commitInlineEdit(true);
});
projectTitleInput.addEventListener('input', () => setInlineError('title', ''));
projectDescriptionInline.addEventListener('input', () => setInlineError('description', ''));

// "Edit project details" (in the ⋯ menu) opens the full modal: name, description and announcement.
projectRenameBtn.addEventListener('click', () => {
  closeProjectMoreMenu();
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

// ===== Personal / Projects hubs (replace the old sidebar project lists) =====
const RECENT_PROJECTS_KEY = 'recentProjectIds';
function getRecentProjectIds() {
  try { const v = JSON.parse(safeGetItem(RECENT_PROJECTS_KEY) || '[]'); return Array.isArray(v) ? v : []; }
  catch (e) { return []; }
}
function touchRecentProject(id) {
  if (!id) return;
  const list = [String(id)].concat(getRecentProjectIds().filter(x => String(x) !== String(id))).slice(0, 8);
  safeSetItem(RECENT_PROJECTS_KEY, JSON.stringify(list));
}
function myPendingInvites() {
  if (!currentUser) return [];
  const email = (currentUser.email || '').toLowerCase();
  return projectMembers.filter(m => m.status === 'pending' &&
    (m.member_id === currentUser.id || (m.member_email || '').toLowerCase() === email));
}
function hubSection(title, count) {
  const sec = document.createElement('section');
  sec.className = 'hub-section';
  const h = document.createElement('h2');
  h.className = 'hub-section-title';
  h.textContent = title;
  if (count != null) { const c = document.createElement('span'); c.textContent = count; h.appendChild(c); }
  sec.appendChild(h);
  return sec;
}
function hubEmpty(text) {
  const p = document.createElement('p'); p.className = 'hub-empty'; p.textContent = text; return p;
}
// ---- data helpers (reuse already-loaded state; no extra queries) ----
function projectStats(p) {
  const list = todos.filter(t => String(t.projectId) === String(p.id));
  const done = list.filter(t => t.done).length;
  return { total: list.length, done, open: list.length - done };
}
function projectMemberCount(p) {
  if (projectTypeOf(p) !== 'team') return 0;
  return membersForProject(p.id).filter(m => m.status === 'accepted').length + 1; // + owner
}
function el(tag, cls, text) {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text != null) n.textContent = text;
  return n;
}
function buildHubProjectRow(p) {
  const st = projectStats(p);
  const btn = el('button', 'hub-row hub-project');
  btn.type = 'button';
  const tile = el('span', 'project-nav-tile', (p.name || '?').trim().charAt(0).toUpperCase() || '?');
  tile.style.background = projectTileColor(p);
  const info = el('span', 'hub-row-info');
  const name = el('span', 'hub-row-name', p.name); name.title = p.name;
  info.appendChild(name);
  if (p.description) info.appendChild(el('span', 'hub-row-desc', p.description));
  const note = String(p.announcement || '').split('\n').map(x => x.trim()).find(Boolean);
  if (note) info.appendChild(el('span', 'hub-row-note', 'Announcement: ' + note));
  const bits = [`${st.open} open`];
  if (st.done) bits.push(`${st.done} completed`);
  const mc = projectMemberCount(p);
  if (mc > 1) bits.push(`${mc} members`);
  if (projectTypeOf(p) === 'team' && !isProjectOwner(p.id)) bits.push('Shared with you');
  info.appendChild(el('span', 'hub-row-meta', bits.join(' · ')));
  if (st.total) {
    const bar = el('span', 'hub-progress'); bar.setAttribute('role', 'progressbar');
    bar.setAttribute('aria-valuemin', '0'); bar.setAttribute('aria-valuemax', String(st.total)); bar.setAttribute('aria-valuenow', String(st.done));
    const fill = el('span', 'hub-progress-fill'); fill.style.width = Math.round(st.done / st.total * 100) + '%';
    bar.appendChild(fill); info.appendChild(bar);
  }
  btn.append(tile, info);
  btn.addEventListener('click', () => { currentProjectId = p.id; setView('project'); });
  return btn;
}
function hubList(list) {
  const wrap = el('div', 'hub-list');
  list.forEach(p => wrap.appendChild(buildHubProjectRow(p)));
  return wrap;
}
function recentProjectsFor(list) {
  const byId = new Map(list.map(p => [String(p.id), p]));
  return getRecentProjectIds().map(id => byId.get(String(id))).filter(Boolean).slice(0, 3);
}
function buildHubTaskRow(t, metaText) {
  const row = el('button', 'hub-row hub-task'); row.type = 'button';
  row.appendChild(el('span', 'hub-prio prio-' + (t.priority || 'medium')));
  const name = el('span', 'hub-row-name', t.text); name.title = t.text;
  row.appendChild(name);
  row.appendChild(el('span', 'hub-row-meta', metaText));
  row.addEventListener('click', () => openTaskDetail(t.id));
  return row;
}
const PRIO_RANK = { high: 0, medium: 1, low: 2 };
function byPriorityThenDue(a, b) {
  return (PRIO_RANK[a.priority] ?? 1) - (PRIO_RANK[b.priority] ?? 1) || (a.due || '9999').localeCompare(b.due || '9999');
}
function prioLabel(t) { return t.priority === 'high' ? 'High' : t.priority === 'low' ? 'Low' : 'Medium'; }
function dayLabelFor(dateStr) {
  if (dateStr === tomorrowStr()) return 'Tomorrow';
  const [y, m, d] = dateStr.split('-').map(Number);
  return formatAppDate(new Date(y, m - 1, d), { weekday: 'long', month: 'short', day: 'numeric' });
}

function renderPersonalHub() {
  const body = document.getElementById('personal-hub-body');
  if (!body) return;
  body.innerHTML = '';
  const personal = projects.filter(p => projectTypeOf(p) === 'personal');
  const ids = new Set(personal.map(p => String(p.id)));
  const mine = todos.filter(t => !t.done && (!t.projectId || ids.has(String(t.projectId))));
  const today = todayStr();
  const dueToday = mine.filter(t => t.due === today);
  const overdue = mine.filter(t => t.due && t.due < today);
  const sub = [`${mine.length} open`, `${dueToday.length} due today`];
  if (overdue.length) sub.push(`${overdue.length} overdue`);
  document.getElementById('personal-hub-sub').textContent = sub.join(' · ');

  // TODAY: due today, overdue, pinned (existing task data only)
  const attention = mine.filter(t => (t.due && t.due <= today) || t.pinned)
    .sort((a, b) => ((b.pinned ? 1 : 0) - (a.pinned ? 1 : 0)) || byPriorityThenDue(a, b));
  const tsec = hubSection('Today');
  if (!attention.length) tsec.appendChild(hubEmpty('Nothing due today.'));
  else {
    const wrap = el('div', 'task-list hub-today');
    attention.slice(0, 8).forEach(t => wrap.appendChild(buildTaskCard(t, today, { hub: true })));
    tsec.appendChild(wrap);
  }
  body.appendChild(tsec);

  // PERSONAL PROJECTS
  const psec = hubSection('Personal projects', personal.length || null);
  if (!personal.length) {
    psec.appendChild(hubEmpty('No personal projects yet.'));
    const b = el('button', 'btn ghost small hub-empty-action', '+ New project'); b.type = 'button';
    b.addEventListener('click', () => openProjectModal(null, 'personal'));
    psec.appendChild(b);
  } else {
    const recents = recentProjectsFor(personal).map(p => String(p.id));
    const ordered = personal.slice().sort((a, b) => {
      const ra = recents.indexOf(String(a.id)), rb = recents.indexOf(String(b.id));
      return (ra < 0 ? 99 : ra) - (rb < 0 ? 99 : rb) || String(a.name).localeCompare(String(b.name));
    });
    psec.appendChild(hubList(ordered));
  }
  body.appendChild(psec);

  // UP NEXT: after today, grouped by day, only if something exists
  const upcoming = mine.filter(t => t.due && t.due > today).sort((a, b) => a.due.localeCompare(b.due) || byPriorityThenDue(a, b)).slice(0, 6);
  if (upcoming.length) {
    const usec = hubSection('Up next');
    let lastDay = null;
    const wrap = el('div', 'hub-list');
    upcoming.forEach(t => {
      if (t.due !== lastDay) { wrap.appendChild(el('div', 'hub-day', dayLabelFor(t.due))); lastDay = t.due; }
      wrap.appendChild(buildHubTaskRow(t, prioLabel(t)));
    });
    usec.appendChild(wrap); body.appendChild(usec);
  }
  requestAnimationFrame(markTaskMetaOverflow);
  // No "Recent activity": personal data has no activity records, so nothing is shown rather than invented.
}

let projectsHubFilter = '';
let projectsHubSort = 'name';
function renderProjectsHub() {
  const body = document.getElementById('projects-hub-body');
  if (!body) return;
  const hadFocus = document.activeElement && document.activeElement.id === 'projects-hub-filter';
  body.innerHTML = '';
  const sub = document.getElementById('projects-hub-sub');
  if (!currentUser) {
    sub.textContent = '';
    body.appendChild(hubEmpty('Sign in to create projects and collaborate with others.'));
    return;
  }
  const team = projects.filter(p => projectTypeOf(p) === 'team');
  const invites = myPendingInvites();
  const ownedAll = team.filter(p => isProjectOwner(p.id));
  const sharedAll = team.filter(p => !isProjectOwner(p.id));
  sub.textContent = team.length ? `${ownedAll.length} yours · ${sharedAll.length} shared with you` : '';

  if (!team.length && !invites.length) {
    body.appendChild(hubEmpty('No projects yet. Create one to work with others.'));
    return;
  }

  if (team.length >= 5) {
    const bar = el('div', 'hub-tools');
    const input = el('input', 'hub-filter'); input.id = 'projects-hub-filter'; input.type = 'search';
    input.placeholder = 'Filter projects'; input.value = projectsHubFilter; input.setAttribute('aria-label', 'Filter projects');
    const sel = el('select', 'hub-sort'); sel.setAttribute('aria-label', 'Sort projects');
    [['name', 'Name'], ['open', 'Most open tasks']].forEach(([v, l]) => { const o = el('option', null, l); o.value = v; sel.appendChild(o); });
    sel.value = projectsHubSort;
    input.addEventListener('input', () => { projectsHubFilter = input.value; renderProjectsHub(); });
    sel.addEventListener('change', () => { projectsHubSort = sel.value; renderProjectsHub(); });
    bar.append(input, sel); body.appendChild(bar);
    if (hadFocus) setTimeout(() => { const f = document.getElementById('projects-hub-filter'); if (f) { f.focus(); f.setSelectionRange(f.value.length, f.value.length); } }, 0);
  }
  const q = projectsHubFilter.trim().toLowerCase();
  const prep = (list) => list.filter(p => !q || String(p.name).toLowerCase().includes(q)).sort((a, b) =>
    projectsHubSort === 'open' ? (projectStats(b).open - projectStats(a).open) || String(a.name).localeCompare(String(b.name))
                               : String(a.name).localeCompare(String(b.name)));

  const add = (title, list) => { if (!list.length) return; const sec = hubSection(title, list.length); sec.appendChild(hubList(list)); body.appendChild(sec); };
  add('Your projects', prep(ownedAll));
  add('Shared projects', prep(sharedAll));

  if (invites.length) {
    const sec = hubSection('Available projects', invites.length);
    const wrap = el('div', 'hub-list');
    invites.forEach(m => {
      const p = getProject(m.project_id);
      const row = el('div', 'hub-row hub-invite');
      const info = el('span', 'hub-row-info');
      info.appendChild(el('span', 'hub-row-name', p ? p.name : 'Project invitation'));
      info.appendChild(el('span', 'hub-row-meta', 'You were invited to collaborate'));
      const acts = el('span', 'hub-invite-actions');
      const notif = notifications.find(n => String(n.member_row_id) === String(m.id)) || null;
      const yes = el('button', 'btn primary small', 'Join'); yes.type = 'button';
      const no = el('button', 'btn ghost small', 'Decline'); no.type = 'button';
      yes.addEventListener('click', () => { yes.disabled = no.disabled = true; respondToInvite(notif, m.id, true); });
      no.addEventListener('click', () => { yes.disabled = no.disabled = true; respondToInvite(notif, m.id, false); });
      acts.append(yes, no); row.append(info, acts); wrap.appendChild(row);
    });
    sec.appendChild(wrap); body.appendChild(sec);
  }
  if (q && !body.querySelector('.hub-section')) body.appendChild(hubEmpty('No projects match your filter.'));
}

// Kept under its old name: it is called from many data-change paths. Now refreshes whichever hub is showing.
function renderProjectNav() {
  if (currentView === 'personal') renderPersonalHub();
  else if (currentView === 'projects') renderProjectsHub();
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
function saveTodos() { safeSetItem('todos', JSON.stringify(todos)); scheduleReminderSync(); }
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
    category: t.category || null,
    subtasks: t.subtasks || [],
    recurrence: t.recurrence || null,
    reminder_time: t.reminderTime || null,
    pinned: !!t.pinned,
    assignee_email: t.assigneeEmail || null,
  };
}
function projectRemoteRow(p) {
  return {
    id: p.id,
    user_id: p.userId || (currentUser ? currentUser.id : null),
    name: p.name,
    announcement: p.announcement || null,
    announcement_updated_at: p.announcementUpdatedAt || null,
    description: p.description || null,
    project_type: projectTypeOf(p),
  };
}

function showView(view) {
  document.getElementById('task-view').style.display = 'none';
  document.getElementById('pomodoro-view').style.display = 'none';
  document.getElementById('calendar-view').style.display = 'none';
  document.getElementById('notes-view').style.display = 'none';
  document.getElementById('settings-view').style.display = 'none';
  document.getElementById('personal-view').style.display = 'none';
  document.getElementById('projects-view').style.display = 'none';
  if (view === 'personal') document.getElementById('personal-view').style.display = 'block';
  else if (view === 'projects') document.getElementById('projects-view').style.display = 'block';
  else if (view === 'pomodoro') document.getElementById('pomodoro-view').style.display = 'block';
  else if (view === 'settings') document.getElementById('settings-view').style.display = 'block';
  else if (view === 'calendar') document.getElementById('calendar-view').style.display = 'block';
  else if (view === 'notes') document.getElementById('notes-view').style.display = 'block';
  else document.getElementById('task-view').style.display = 'block';
}

function setView(view) {
  const collabPanel = document.getElementById('project-collab-panel');
  if (view !== 'project') {
    if (collabPanel) collabPanel.classList.remove('open');
  }
  closeTaskAdd();
  closePermPopover();

  currentView = view;
  if (view !== 'project') currentProjectId = null;
  if (view === 'project') touchRecentProject(currentProjectId);
  // One active item: inside a project, highlight the hub it belongs to.
  const navKey = view === 'project' ? (isTeamProject(currentProjectId) ? 'projects' : 'personal') : view;
  navItems.forEach(b => { const on = b.dataset.view === navKey; b.classList.toggle('active', on); if (on) b.setAttribute('aria-current', 'page'); else b.removeAttribute('aria-current'); });
  allTasksBtn.classList.toggle('active', ['all', 'today', 'active', 'completed'].includes(view));
  showView(view);
  if (view === 'settings') renderSettingsUI();
  if (view === 'pomodoro') renderPomodoro();
  if (view === 'calendar') { refreshNowState(); renderCalendar(); renderDayPanel(); }
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

let taskSortMode = 'default';
let taskCategoryFilterValue = '';

function getFilteredTodos() {
  let filtered = [...todos];
  if (currentView === 'today') filtered = filtered.filter(t => t.due === todayStr());
  else if (currentView === 'active') filtered = filtered.filter(t => !t.done);
  else if (currentView === 'completed') filtered = filtered.filter(t => t.done);
  else if (currentView === 'project') filtered = filtered.filter(t => String(t.projectId) === String(currentProjectId));
  if (taskCategoryFilterValue) filtered = filtered.filter(t => (t.category || '') === taskCategoryFilterValue);
  if (taskSortMode === 'manual') {
    filtered.sort((a, b) => (b.pinned ? 1 : 0) - (a.pinned ? 1 : 0));
  } else if (taskSortMode === 'oldest') {
    filtered.sort((a, b) => {
      if (!!a.pinned !== !!b.pinned) return a.pinned ? -1 : 1;
      return a.id - b.id;
    });
  } else if (taskSortMode === 'newest') {
    filtered.sort((a, b) => {
      if (!!a.pinned !== !!b.pinned) return a.pinned ? -1 : 1;
      return b.id - a.id;
    });
  } else {
    const priorityRank = { high: 0, medium: 1, low: 2 };
    filtered.sort((a, b) => {
      if (!!a.pinned !== !!b.pinned) return a.pinned ? -1 : 1;
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
const TASK_SORT_LABELS = { default: 'Sort: Default', oldest: 'Sort: Oldest first', newest: 'Sort: Newest first', manual: 'Sort: Custom order' };

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

const ICON_CALENDAR = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><rect x="3" y="4" width="18" height="18" rx="3"></rect><path d="M16 2v4M8 2v4M3 10h18"></path></svg>';
const ICON_FOLDER = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"></path></svg>';
const ICON_PEOPLE = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"></path><circle cx="9" cy="7" r="4"></circle><path d="M23 21v-2a4 4 0 0 0-3-3.87"></path><path d="M16 3.13a4 4 0 0 1 0 7.75"></path></svg>';
const ICON_PENCIL = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><path d="M12 20h9"></path><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4Z"></path></svg>';
const ICON_TRASH = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"></path><path d="M10 11v6"></path><path d="M14 11v6"></path><path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"></path></svg>';
const ICON_SHIELD = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"></path><polyline points="9 12 11 14 15 10"></polyline></svg>';
const ICON_FLAG = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><path d="M4 22V4"></path><path d="M4 4h13l-2.5 4L17 12H4"></path></svg>';
const ICON_GRIP = '<svg viewBox="0 0 24 24" fill="currentColor" stroke="none" aria-hidden="true" focusable="false"><circle cx="9" cy="6" r="1.5"></circle><circle cx="15" cy="6" r="1.5"></circle><circle cx="9" cy="12" r="1.5"></circle><circle cx="15" cy="12" r="1.5"></circle><circle cx="9" cy="18" r="1.5"></circle><circle cx="15" cy="18" r="1.5"></circle></svg>';
const ICON_PIN = '<svg viewBox="0 0 24 24" fill="currentColor" stroke="none" aria-hidden="true" focusable="false"><path d="M16 3a1 1 0 0 1 1 1v6.29l2.55 3.4A1.5 1.5 0 0 1 18.35 16H13v5a1 1 0 1 1-2 0v-5H5.65a1.5 1.5 0 0 1-1.2-2.31L7 10.29V4a1 1 0 0 1 1-1zM9 5v5.62a1 1 0 0 1-.2.6L6.5 14h11l-2.3-2.78a1 1 0 0 1-.2-.6V5z"></path></svg>';

function truncateWords(str, maxLen) {
  if (!str) return '';
  if (str.length <= maxLen) return str;
  const cut = str.slice(0, maxLen);
  const lastSpace = cut.lastIndexOf(' ');
  const trimmed = lastSpace > Math.floor(maxLen * 0.4) ? cut.slice(0, lastSpace) : cut;
  return trimmed.replace(/[\s.,;:!?-]+$/, '') + '…';
}

function pillIcon(svgMarkup) {
  const span = document.createElement('span');
  span.className = 'pill-icon';
  span.innerHTML = svgMarkup;
  return span;
}

let taskMetaRowsNeedingOverflowCheck = [];
function markTaskMetaOverflow() {
  taskMetaRowsNeedingOverflowCheck.forEach(meta => {
    if (!meta.isConnected) return;
    meta.classList.toggle('has-overflow', meta.scrollWidth - meta.clientWidth > 2);
  });
  taskMetaRowsNeedingOverflowCheck = [];
}

function buildTaskCard(t, todayKey, opts) {
  opts = opts || {};
  const bulk = bulkSelectMode && !opts.hub;
    const canToggle = canToggleTaskIn(t.projectId);
    const canRemove = canRemoveTaskFrom(t.projectId);
    const canRename = canRenameTaskIn(t.projectId);

    const priorityLabel = t.priority === 'high' ? 'High priority' : t.priority === 'medium' ? 'Medium priority' : 'Low priority';

    const card = document.createElement('div');
    card.className = `task-card priority-${t.priority}` + (t.done ? ' completed' : '') + (t.pinned ? ' is-pinned' : '') + (bulk && bulkSelectedIds.has(t.id) ? ' bulk-selected' : '');
    card.setAttribute('role', 'group');
    card.setAttribute('aria-label', `${t.text}${t.priority !== 'low' ? ', ' + priorityLabel.toLowerCase() : ''}${t.due ? ', due ' + t.due : ''}`);
    card.draggable = !opts.hub && window.innerWidth > 760 && !bulk;
    card.addEventListener('dragstart', (e) => {
      e.dataTransfer.setData('text/plain', String(t.id));
      e.dataTransfer.effectAllowed = 'move';
      card.classList.add('dragging');
      showDragDropzones();
    });
    card.addEventListener('dragend', () => {
      card.classList.remove('dragging');
      hideDragDropzones();
      todoListEl.querySelectorAll('.drag-over-top, .drag-over-bottom').forEach(el => el.classList.remove('drag-over-top', 'drag-over-bottom'));
    });
    card.addEventListener('dragover', (e) => {
      if (bulk) return;
      e.preventDefault();
      const rect = card.getBoundingClientRect();
      const before = (e.clientY - rect.top) < rect.height / 2;
      card.classList.toggle('drag-over-top', before);
      card.classList.toggle('drag-over-bottom', !before);
    });
    card.addEventListener('dragleave', () => {
      card.classList.remove('drag-over-top', 'drag-over-bottom');
    });
    card.addEventListener('drop', (e) => {
      if (bulk) return;
      e.preventDefault();
      e.stopPropagation();
      const before = card.classList.contains('drag-over-top');
      card.classList.remove('drag-over-top', 'drag-over-bottom');
      const draggedId = e.dataTransfer.getData('text/plain');
      if (!draggedId || String(t.id) === draggedId) return;
      reorderTask(draggedId, t.id, before);
    });
    card.addEventListener('click', (e) => {
      if (bulk) {
        if (e.target.closest('.bulk-select-checkbox')) return;
        const cb = card.querySelector('.bulk-select-checkbox');
        if (cb) { cb.checked = !cb.checked; cb.dispatchEvent(new Event('change')); }
        return;
      }
      if (e.target.closest('.task-check, .task-card-actions, .task-title-edit')) return;
      openTaskDetail(t.id);
    });

    const handle = document.createElement('span');
    handle.className = 'task-drag-handle';
    handle.title = 'Drag to reorder';
    handle.setAttribute('aria-hidden', 'true');
    handle.innerHTML = ICON_GRIP;
    card.appendChild(handle);

    const content = document.createElement('div');
    content.className = 'task-card-content';

    const headline = document.createElement('div');
    headline.className = 'task-card-headline';

    const title = document.createElement('div');
    title.className = 'task-title';
    title.textContent = truncateWords(t.text, 25);
    if (!bulk) { // keyboard equivalent of clicking the card: focus the title, press Enter/Space to open details
      title.tabIndex = 0; title.setAttribute('role', 'button');
      title.addEventListener('keydown', (e) => { if ((e.key === 'Enter' || e.key === ' ') && e.target === title) { e.preventDefault(); openTaskDetail(t.id); } });
    }
    if (title.textContent !== t.text) title.title = t.text;
    headline.appendChild(title);

    const headlineRight = document.createElement('div');
    headlineRight.className = 'task-headline-right';

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
    headlineRight.appendChild(actions);

    if (t.pinned) {
      const pin = document.createElement('span');
      pin.className = 'task-pin-badge';
      pin.title = 'Pinned';
      pin.setAttribute('aria-label', 'Pinned task');
      pin.innerHTML = ICON_PIN;
      headlineRight.appendChild(pin);
    }

    const checkWrap = document.createElement('div');
    checkWrap.className = 'task-card-check-col';

    if (bulk) {
      const bulkCb = document.createElement('input');
      bulkCb.type = 'checkbox';
      bulkCb.className = 'task-check bulk-select-checkbox';
      bulkCb.checked = bulkSelectedIds.has(t.id);
      bulkCb.title = 'Select task';
      bulkCb.setAttribute('aria-label', 'Select task');
      bulkCb.addEventListener('change', () => {
        if (bulkCb.checked) bulkSelectedIds.add(t.id); else bulkSelectedIds.delete(t.id);
        card.classList.toggle('bulk-selected', bulkCb.checked);
        updateBulkBar();
      });
      checkWrap.appendChild(bulkCb);
    } else {
      const checkbox = document.createElement('input');
      checkbox.type = 'checkbox';
      checkbox.className = 'task-check';
      checkbox.checked = t.done;
      checkbox.disabled = !canToggle;
      checkbox.title = t.done ? 'Mark as not done' : 'Mark as done';
      checkbox.setAttribute('aria-label', t.done ? 'Mark task as not done' : 'Mark task as done');
      checkbox.addEventListener('change', () => {
        const wasDone = t.done;
        t.done = checkbox.checked;
        if (!wasDone && t.done) recordCompletion();
        saveTodos(); renderTodos(); renderCounts(); renderProjectNav();
        if (currentUser) dbUpdate('todos', t.id, { done: t.done });
        if (t.done) showToast('complete');
      });
      checkWrap.appendChild(checkbox);
    }
    headlineRight.appendChild(checkWrap);

    headline.appendChild(headlineRight);
    content.appendChild(headline);

    const desc = document.createElement('div');
    desc.className = 'task-desc';
    if (t.desc) {
      desc.textContent = truncateWords(t.desc, 35);
      if (desc.textContent !== t.desc) desc.title = t.desc;
    } else {
      desc.classList.add('task-desc-empty');
    }
    content.appendChild(desc);

    // Secondary tier: due date and (when it's not the default) priority.
    // These sit at full contrast, right after the description.
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
    if (!t.done && t.priority !== 'low') {
      const prio = document.createElement('span');
      prio.className = 'task-pill priority-tag priority-' + t.priority;
      prio.title = priorityLabel;
      prio.appendChild(pillIcon(ICON_FLAG));
      const prioText = document.createElement('span');
      prioText.textContent = t.priority === 'high' ? 'High' : 'Medium';
      prio.appendChild(prioText);
      meta.appendChild(prio);
    }

    // Tertiary tier: project, category, time and assignee. Same row, but
    // visually quieter so they don't compete with the due date/priority.
    if (t.projectId && currentView !== 'project') {
      const p = getProject(t.projectId);
      if (p) {
        const shared = !isProjectOwner(p.id);
        const tag = document.createElement('span');
        tag.className = 'task-pill tag-quiet project-tag' + (shared ? ' shared-tag' : '');
        tag.appendChild(pillIcon(shared ? ICON_PEOPLE : ICON_FOLDER));
        const tagText = document.createElement('span');
        tagText.textContent = truncateWords(p.name, 18);
        tag.title = p.name;
        tag.appendChild(tagText);
        tag.tabIndex = 0; tag.setAttribute('role', 'link');
        tag.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); e.stopPropagation(); currentProjectId = p.id; setView('project'); } });
        tag.addEventListener('click', (e) => { e.stopPropagation(); currentProjectId = p.id; setView('project'); });
        meta.appendChild(tag);
      }
    }
    if (t.category) {
      const cat = document.createElement('span');
      cat.className = 'task-pill tag-quiet task-card-category';
      cat.textContent = truncateWords(t.category, 18);
      cat.title = t.category;
      meta.appendChild(cat);
    }
    if (t.done && t.timeSpentSec > 0) {
      const timePill = document.createElement('span');
      timePill.className = 'task-pill tag-quiet';
      timePill.title = 'Time tracked in Pomodoro';
      timePill.textContent = `⏱ ${formatDuration(t.timeSpentSec)}`;
      meta.appendChild(timePill);
    }
    if (t.assigneeEmail) {
      const assignee = document.createElement('span');
      assignee.className = 'task-pill tag-quiet assignee-tag';
      assignee.title = 'Assigned to ' + t.assigneeEmail;
      assignee.appendChild(pillIcon(ICON_PEOPLE));
      const assigneeText = document.createElement('span');
      assigneeText.textContent = t.assigneeEmail.split('@')[0];
      assignee.appendChild(assigneeText);
      meta.appendChild(assignee);
    }
    if (meta.children.length) content.appendChild(meta);
    else meta.classList.add('task-meta-empty'), content.appendChild(meta);
    if (meta.children.length > 1) taskMetaRowsNeedingOverflowCheck.push(meta);

    const progress = subtaskProgress(t);
    if (progress) {
      const subtaskWrap = document.createElement('div');
      subtaskWrap.className = 'task-card-subtask-wrap';

      const pct = Math.round((progress.done / progress.total) * 100);
      const barWrap = document.createElement('div');
      barWrap.className = 'task-card-subtask-bar';
      barWrap.title = `${progress.done}/${progress.total} checklist items done`;
      const barFill = document.createElement('div');
      barFill.className = 'task-card-subtask-bar-fill' + (pct === 100 ? ' complete' : '');
      barFill.style.width = pct + '%';
      barWrap.appendChild(barFill);
      subtaskWrap.appendChild(barWrap);

      const barLabel = document.createElement('div');
      barLabel.className = 'task-card-subtask-count';
      barLabel.textContent = `${progress.done} / ${progress.total} completed`;
      subtaskWrap.appendChild(barLabel);

      content.appendChild(subtaskWrap);
    }

    card.appendChild(content);
  return card;
}

function renderTodos() {
  renderTaskSortMenu();
  renderTaskCategoryFilterOptions();
  todoListEl.classList.toggle('bulk-mode', bulkSelectMode);
  const filtered = getFilteredTodos();
  todoListEl.innerHTML = '';
  emptyState.style.display = filtered.length ? 'none' : 'block';
  const todayKey = todayStr();
  const frag = document.createDocumentFragment();
  taskMetaRowsNeedingOverflowCheck = [];

  filtered.forEach(t => { frag.appendChild(buildTaskCard(t, todayKey)); });
  todoListEl.appendChild(frag);
  requestAnimationFrame(markTaskMetaOverflow);
}
if (!window.__taskMetaResizeBound) {
  window.__taskMetaResizeBound = true;
  window.addEventListener('resize', () => {
    document.querySelectorAll('.task-meta').forEach(meta => {
      meta.classList.toggle('has-overflow', meta.scrollWidth - meta.clientWidth > 2);
    });
  });
}

function reorderTask(draggedIdRaw, targetId, before) {
  const draggedIdx = todos.findIndex(x => String(x.id) === String(draggedIdRaw));
  const targetIdx = todos.findIndex(x => x.id === targetId);
  if (draggedIdx === -1 || targetIdx === -1 || draggedIdx === targetIdx) return;
  const [moved] = todos.splice(draggedIdx, 1);
  let insertAt = todos.findIndex(x => x.id === targetId);
  if (insertAt === -1) insertAt = todos.length;
  if (!before) insertAt += 1;
  todos.splice(insertAt, 0, moved);
  taskSortMode = 'manual';
  saveTodos();
  renderTodos();
  renderTaskSortMenu();
}

function startInlineEdit(titleEl, t) {
  const editInput = document.createElement('input');
  editInput.type = 'text';
  editInput.className = 'task-title-edit';
  editInput.setAttribute('aria-label', 'Edit task title');
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
const taskDetailPinBtn = document.getElementById('task-detail-pin-btn');
const taskDetailAssigneeField = document.getElementById('task-detail-assignee-field');
const taskDetailAssignee = document.getElementById('task-detail-assignee');
const taskDetailSaveBtn = document.getElementById('task-detail-save-btn');
const taskDetailDeleteBtn = document.getElementById('task-detail-delete-btn');
let activeDetailTaskId = null;

function fillTaskDetailAssigneeOptions(t) {
  taskDetailAssignee.innerHTML = '<option value="">Unassigned</option>';
  if (!t.projectId || !isTeamProject(t.projectId)) return;
  const members = membersForProject(t.projectId).filter(m => m.status === 'accepted');
  members.forEach(m => {
    const opt = document.createElement('option');
    opt.value = m.member_email;
    const rn = roleNameForMember(m);
    opt.textContent = rn ? `${m.member_email} · ${rn}` : m.member_email;
    taskDetailAssignee.appendChild(opt);
  });
  taskDetailAssignee.value = members.some(m => m.member_email === t.assigneeEmail) ? t.assigneeEmail : '';
}

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

  const canPin = canPinTask(t);
  taskDetailPinBtn.classList.toggle('active', !!t.pinned);
  taskDetailPinBtn.setAttribute('aria-pressed', t.pinned ? 'true' : 'false');
  taskDetailPinBtn.title = t.pinned ? 'Unpin task' : 'Pin task';
  taskDetailPinBtn.disabled = !canPin;

  const canAssign = canAssignTask(t);
  if (t.projectId) {
    taskDetailAssigneeField.style.display = '';
    fillTaskDetailAssigneeOptions(t);
    taskDetailAssignee.disabled = !canAssign;
  } else {
    taskDetailAssigneeField.style.display = 'none';
  }

  taskDetailReminder.value = t.reminderTime || '';
  taskDetailReminder.disabled = !canRename;
  taskDetailRecurrence.value = t.recurrence ? t.recurrence.freq : '';
  taskDetailRecurrence.disabled = !canRename;

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

  renderSubtaskList(t);

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

taskDetailPinBtn.addEventListener('click', () => {
  const t = todos.find(x => x.id === activeDetailTaskId);
  if (!t || !canPinTask(t) || taskDetailPinBtn.disabled) return;
  t.pinned = !t.pinned;
  taskDetailPinBtn.classList.toggle('active', t.pinned);
  taskDetailPinBtn.setAttribute('aria-pressed', t.pinned ? 'true' : 'false');
  taskDetailPinBtn.title = t.pinned ? 'Unpin task' : 'Pin task';
  saveTodos(); renderTodos();
  if (currentUser) dbUpdate('todos', t.id, { pinned: t.pinned });
  showToast('permission');
});

taskDetailCheck.addEventListener('change', () => {
  const t = todos.find(x => x.id === activeDetailTaskId);
  if (!t) return;
  const wasDone = t.done;
  t.done = taskDetailCheck.checked;
  if (!wasDone && t.done) { recordCompletion(); handleRecurringCompletion(t); }
  taskDetailTitle.classList.toggle('completed', t.done);
  saveTodos(); renderTodos(); renderCounts();
  if (currentUser) dbUpdate('todos', t.id, { done: t.done });
});

const taskDetailRecurrence = document.getElementById('task-detail-recurrence');
taskDetailRecurrence.addEventListener('change', () => {
  const t = todos.find(x => x.id === activeDetailTaskId);
  if (!t) return;
  t.recurrence = taskDetailRecurrence.value ? { freq: taskDetailRecurrence.value, interval: 1, until: null } : null;
  if (currentUser) dbUpdate('todos', t.id, { recurrence: t.recurrence });
});

taskDetailAddCategoryBtn.addEventListener('click', () => addTaskCategory(taskDetailCategory));

const taskDetailSubtaskList = document.getElementById('task-detail-subtask-list');
const taskDetailSubtaskInput = document.getElementById('task-detail-subtask-input');
const taskDetailSubtaskAddBtn = document.getElementById('task-detail-subtask-add-btn');
const taskDetailSubtaskCount = document.getElementById('task-detail-subtask-count');
const taskDetailSubtaskProgress = document.getElementById('task-detail-subtask-progress');
const taskDetailSubtaskProgressFill = document.getElementById('task-detail-subtask-progress-fill');

function subtaskProgress(t) {
  const subs = t.subtasks || [];
  if (!subs.length) return null;
  const done = subs.filter(s => s.done).length;
  return { done, total: subs.length };
}

function persistSubtasks(t) {
  saveTodos();
  if (currentUser) dbUpdate('todos', t.id, { subtasks: t.subtasks });
}

function renderSubtaskList(t) {
  const progress = subtaskProgress(t);
  if (progress) {
    const pct = Math.round((progress.done / progress.total) * 100);
    taskDetailSubtaskProgress.style.display = '';
    taskDetailSubtaskProgressFill.style.width = pct + '%';
    taskDetailSubtaskProgressFill.classList.toggle('complete', pct === 100);
    taskDetailSubtaskCount.textContent = `${progress.done}/${progress.total}`;
  } else {
    taskDetailSubtaskProgress.style.display = 'none';
    taskDetailSubtaskCount.textContent = '';
  }

  taskDetailSubtaskList.innerHTML = '';
  const canEdit = canRenameTaskIn(t.projectId);
  (t.subtasks || []).forEach(s => {
    const row = document.createElement('div');
    row.className = 'task-detail-subtask-row' + (s.done ? ' completed' : '');

    const check = document.createElement('input');
    check.type = 'checkbox';
    check.checked = s.done;
    check.setAttribute('aria-label', 'Subtask done: ' + s.text);
    check.disabled = !canEdit;
    check.addEventListener('change', () => {
      s.done = check.checked;
      persistSubtasks(t);
      renderSubtaskList(t);
      renderTodos();
    });

    const label = document.createElement('span');
    label.className = 'task-detail-subtask-text';
    label.textContent = s.text;
    label.title = canEdit ? 'Click to rename' : '';
    if (canEdit) {
      label.tabIndex = 0; label.setAttribute('role', 'button');
      label.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); label.click(); } });
      label.addEventListener('click', () => {
        const editInput = document.createElement('input');
        editInput.type = 'text';
        editInput.className = 'task-detail-subtask-edit';
        editInput.setAttribute('aria-label', 'Edit subtask');
        editInput.value = s.text;
        label.replaceWith(editInput);
        editInput.focus(); editInput.select();
        const commit = () => {
          const v = editInput.value.trim();
          if (v) s.text = v;
          persistSubtasks(t);
          renderSubtaskList(t);
        };
        editInput.addEventListener('blur', commit);
        editInput.addEventListener('keydown', (e) => {
          if (e.key === 'Enter') { e.preventDefault(); editInput.blur(); }
          if (e.key === 'Escape') { editInput.value = s.text; editInput.blur(); }
        });
      });
    }

    row.append(check, label);

    if (canEdit) {
      const del = document.createElement('button');
      del.type = 'button';
      del.className = 'task-icon-btn delete-btn task-detail-subtask-remove';
      del.title = 'Remove item';
      del.innerHTML = ICON_TRASH;
      del.addEventListener('click', () => {
        t.subtasks = (t.subtasks || []).filter(x => x.id !== s.id);
        persistSubtasks(t);
        renderSubtaskList(t);
        renderTodos();
      });
      row.appendChild(del);
    }

    taskDetailSubtaskList.appendChild(row);
  });
}

function addSubtaskFromInput(t) {
  const text = taskDetailSubtaskInput.value.trim();
  if (!text) return;
  if (!t.subtasks) t.subtasks = [];
  t.subtasks.push({ id: Date.now() + Math.random().toString(36).slice(2, 6), text, done: false });
  taskDetailSubtaskInput.value = '';
  persistSubtasks(t);
  renderSubtaskList(t);
  renderTodos();
  taskDetailSubtaskInput.focus();
}

taskDetailSubtaskAddBtn.addEventListener('click', () => {
  const t = todos.find(x => x.id === activeDetailTaskId);
  if (t) addSubtaskFromInput(t);
});
taskDetailSubtaskInput.addEventListener('keydown', (e) => {
  if (e.key !== 'Enter') return;
  e.preventDefault();
  const t = todos.find(x => x.id === activeDetailTaskId);
  if (t) addSubtaskFromInput(t);
});

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
  t.reminderTime = taskDetailReminder.value || null;
  if (!t.projectId || !isTeamProject(t.projectId)) {
    t.assigneeEmail = null;
  } else if (canAssignTask(t)) {
    const chosen = taskDetailAssignee.value || null;
    const stillMember = chosen && membersForProject(t.projectId).some(m => m.status === 'accepted' && m.member_email === chosen);
    t.assigneeEmail = stillMember ? chosen : null;
  }
  saveTodos(); renderTodos(); renderCounts(); renderProjectNav();
  if (currentUser) dbUpdate('todos', t.id, { text: t.text, desc: t.desc, due: t.due, priority: t.priority, project_id: t.projectId, category: t.category || null, reminder_time: t.reminderTime, assignee_email: t.assigneeEmail });
  closeTaskDetail();
});

taskDetailDeleteBtn.addEventListener('click', () => {
  if (!activeDetailTaskId) return;
  const t = todos.find(x => x.id === activeDetailTaskId);
  if (!t) return;
  performDeleteTask(t);
  closeTaskDetail();
});

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
  announce('Task deleted.');
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
  if (!currentUser) renderNotifBadge();
  renderHomeSummary();
}

function renderViewHeader() {
  const taskViewEl = document.getElementById('task-view');
  if (taskViewEl) taskViewEl.classList.toggle('is-home', currentView === 'all');
  const titles = { all: 'Home', today: 'Today', active: 'Active', completed: 'Completed' };
  const inProject = currentView === 'project';
  const p = inProject ? getProject(currentProjectId) : null;

  // An edit in progress belongs to one project; drop it if the user navigated away or it vanished.
  if (inlineEdit.field && (!inProject || !p || String(inlineEdit.projectId) !== String(p.id) || !canRenameProject(p.id))) {
    inlineEdit = { field: null, projectId: null, saving: false };
    setInlineBusy(false);
  }
  const editingTitle = inlineEdit.field === 'title';
  const editingDesc = inlineEdit.field === 'description';

  if (inProject) {
    const mayEdit = !!p && canRenameProject(p.id);
    const isOwner = !!p && isProjectOwner(p.id);
    viewTitle.textContent = p ? p.name : 'Project';
    projectHeaderActions.style.display = 'flex';

    // Visual anchor: same coloured tile used in the sidebar / project list.
    if (p) {
      projectIdentityTileEl.textContent = (p.name || '?').trim().charAt(0).toUpperCase() || '?';
      projectIdentityTileEl.style.background = projectTileColor(p);
      projectIdentityTileEl.hidden = false;
    } else projectIdentityTileEl.hidden = true;

    // Title: display <-> inline form
    projectTitleRowEl.hidden = editingTitle;
    projectTitleForm.hidden = !editingTitle;
    projectTitleEditBtn.hidden = !mayEdit;

    // Description (About this project)
    const desc = p && p.description ? p.description : '';
    const showAbout = !!p && (desc || mayEdit || editingDesc);
    projectAboutEl.hidden = !showAbout;
    projectAboutRowEl.hidden = editingDesc;
    projectDescriptionForm.hidden = !editingDesc;
    projectDescriptionEl.textContent = desc;
    projectDescriptionEl.style.display = desc ? '' : 'none';
    projectDescriptionEditBtn.hidden = !(desc && mayEdit);
    // Empty state: only people who can edit see the "Add a description" prompt.
    projectDescriptionAddBtn.style.display = (!desc && mayEdit) ? '' : 'none';

    // ⋯ menu: only render it when it has something in it.
    projectRenameBtn.style.display = mayEdit ? 'block' : 'none';
    projectDeleteBtn.style.display = isOwner ? 'block' : 'none';
    projectMoreBtn.style.display = (mayEdit || isOwner) ? 'inline-flex' : 'none';
    projectMembersBtn.style.display = (currentUser && p && isTeamProject(p.id)) ? 'inline-flex' : 'none';
    if (!mayEdit && !isOwner) closeProjectMoreMenu();
  } else {
    viewTitle.textContent = titles[currentView] || 'Tasks';
    projectHeaderActions.style.display = 'none';
    projectIdentityTileEl.hidden = true;
    projectTitleRowEl.hidden = false;
    projectTitleForm.hidden = true;
    projectTitleEditBtn.hidden = true;
    projectAboutEl.hidden = true;
    projectDescriptionEl.textContent = '';
    projectDescriptionEl.style.display = 'none';
    projectDescriptionAddBtn.style.display = 'none';
  }
  if (taskViewEl) taskViewEl.classList.toggle('is-project', currentView === 'project');
  const tasksLabel = document.getElementById('project-tasks-label');
  if (tasksLabel) tasksLabel.style.display = currentView === 'project' ? '' : 'none';
  if (currentView === 'all') {
    viewSubtitle.textContent = '';
    if (mainHeaderEl) mainHeaderEl.style.display = 'none';
  } else {
    const remaining = getFilteredTodos().filter(t => !t.done).length;
    viewSubtitle.textContent = `${remaining} remaining`;
    if (currentView === 'project') {
      const pp = getProject(currentProjectId);
      const st = pp ? projectStats(pp) : null;
      if (st) viewSubtitle.textContent = `${st.open} open` + (st.done ? ` · ${st.done} completed` : '');
    }
    if (mainHeaderEl) mainHeaderEl.style.display = '';
  }
  renderProjectAnnouncement();
  renderHomeSummary();
}

const COMPLETION_LOG_KEY = 'mosstaskCompletionLog';
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

  const dateLabel = formatAppDate(new Date(), { weekday: 'long', month: 'long', day: 'numeric' });
  homeGreetingEl.innerHTML = `${homeGreeting()}<span class="home-date">${dateLabel}</span>`;

  const todayKey = todayStr();
  homePulseTodayEl.textContent = todos.filter((t) => t.due === todayKey && !t.done).length;
  homePulseActiveEl.textContent = todos.filter((t) => !t.done).length;
  homePulseWeekEl.textContent = completedThisWeekCount();

  renderHomeFocus();
  renderHomeProgress();
  renderHomeMiniCal();
  renderHomeStreak();
  reorderHomeWidgetsWithTipLast();
  homeWidgetsEl.style.display = 'flex';
}

function reorderHomeWidgetsWithTipLast() {
  if (!homeWidgetsEl || !tipsBarEl) return;
  if (!homeWidgetsEl.contains(tipsBarEl)) return;
  homeWidgetsEl.appendChild(tipsBarEl);
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
    cb.setAttribute('aria-label', 'Mark done: ' + t.text);
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
    cell.title = formatAppDate(d, { weekday: 'long', month: 'long', day: 'numeric' });

    const dow = document.createElement('span');
    dow.className = 'home-minical-dow';
    dow.textContent = formatAppDate(d, { weekday: 'short' }).slice(0, 2);
    const num = document.createElement('span');
    num.className = 'home-minical-num';
    num.textContent = d.getDate();
    cell.append(dow, num);

    if (hasEvent || hasDue) {
      const dot = document.createElement('span');
      dot.className = 'home-minical-dot';
      dot.innerHTML = '<svg viewBox="0 0 24 24" fill="currentColor" stroke="none" aria-hidden="true" focusable="false"><path d="M12 2a6 6 0 0 0-6 6v3.586l-1.707 1.707A1 1 0 0 0 5 15h14a1 1 0 0 0 .707-1.707L18 11.586V8a6 6 0 0 0-6-6z"></path><path d="M9.5 17a2.5 2.5 0 0 0 5 0z"></path></svg>';
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
  announce('Task added.');
  closeTaskAdd();
});

clearBtn.addEventListener('click', () => {
  const removed = todos.filter(t => t.done);
  if (!removed.length) return;
  todos = todos.filter(t => !t.done);
  saveTodos();
  renderTodos(); renderCounts(); renderViewHeader(); renderProjectNav();
  if (currentUser) dbDeleteWhere('todos', currentUser.id, { done: true });
  showUndoToast(`${removed.length} completed task${removed.length === 1 ? '' : 's'} cleared.`, () => {
    todos = todos.concat(removed);
    saveTodos();
    renderTodos(); renderCounts(); renderViewHeader(); renderProjectNav();
    if (currentUser) removed.forEach(t => dbUpsert('todos', todoRemoteRow(t)));
  });
});

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

const collabPanel = document.getElementById('project-collab-panel');
const collabBody = document.getElementById('collab-body');
const collabEmpty = document.getElementById('collab-empty');
const collabInviteBtn = document.getElementById('collab-invite-btn');
const collabBackdrop = document.getElementById('collab-backdrop');
const projectViewLayout = document.getElementById('project-view-layout');

function isNarrowLayout() {
  return window.matchMedia('(max-width: 1200px)').matches;
}

// Members live in the project header. This only keeps that button's label/tooltip in sync
// (the old floating button is gone).
function updateCollabFabVisibility() {
  if (!projectMembersBtn) return;
  if (currentView !== 'project' || !currentProjectId || !currentUser || !isTeamProject(currentProjectId)) return;
  const n = membersForProject(currentProjectId).filter(m => m.status === 'accepted').length + 1;
  const label = `View project members (${n})`;
  projectMembersBtn.setAttribute('aria-label', label);
  projectMembersBtn.title = label;
}

function closeCollabPanel() {
  collabPanel.classList.remove('open');
  closePermPopover();
}
document.getElementById('collab-close-btn')?.addEventListener('click', closeCollabPanel);
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && collabPanel.classList.contains('open') && !document.querySelector('.modal-overlay[style*="flex"]')) closeCollabPanel();
});
collabBackdrop.addEventListener('click', () => {
  collabPanel.classList.remove('open');
  closePermPopover();
});


// ===== Project roles =====
const projectRolesCache = new Map();   // projectId -> [{id, name}]
const projectRolesRequested = new Set();
async function ensureProjectRoles(projectId, force) {
  const key = String(projectId);
  if (!supabaseReady || !currentUser) return;
  if (!force && projectRolesRequested.has(key)) return;
  projectRolesRequested.add(key);
  const { data, error } = await supabaseClient.from('project_roles').select('id,name').eq('project_id', projectId).order('name');
  projectRolesCache.set(key, error ? [] : data);
}
function rolesFor(projectId) { return projectRolesCache.get(String(projectId)) || []; }
function roleNameForMember(m) {
  if (!m || !m.role_id) return '';
  const r = rolesFor(m.project_id).find(x => String(x.id) === String(m.role_id));
  return r ? r.name : '';
}
function roleErrorMessage(err) {
  const m = String((err && (err.message || err.code)) || '');
  if (m.includes('team_plan_required') || (err && err.code === '42501')) return 'Roles are part of the Team plan.';
  if (m.includes('role_limit_reached')) return 'This project has reached its role limit.';
  if (err && err.code === '23505') return 'A role with that name already exists in this project.';
  if (m.includes('forbidden')) return "You don't have permission to change that role.";
  return 'Could not save the role. Please try again.';
}
async function assignMemberRole(member, roleId) {
  const { error } = await supabaseClient.rpc('set_member_role', { p_member_id: String(member.id), p_role_id: roleId || null });
  if (error) { alert(roleErrorMessage(error)); return false; }
  member.role_id = roleId || null;
  return true;
}
async function createProjectRole(projectId, name) {
  const clean = String(name || '').trim().slice(0, 40);
  if (!clean) return null;
  const { data, error } = await supabaseClient.from('project_roles').insert({ project_id: projectId, name: clean }).select('id,name').single();
  if (error) { alert(roleErrorMessage(error)); return null; }
  const list = rolesFor(projectId).concat([data]).sort((a, b) => a.name.localeCompare(b.name));
  projectRolesCache.set(String(projectId), list);
  return data;
}
function renderRoleManager(projectId, ownerIsMe) {
  const box = document.getElementById('collab-roles');
  if (!box) return;
  if (!ownerIsMe || !currentUser) { box.style.display = 'none'; return; }
  box.style.display = '';
  const listEl = document.getElementById('collab-role-list');
  listEl.textContent = '';
  rolesFor(projectId).forEach(r => {
    const chip = document.createElement('span'); chip.className = 'collab-role-chip';
    const label = document.createElement('span'); label.textContent = r.name; chip.appendChild(label);
    const edit = document.createElement('button'); edit.type = 'button'; edit.title = 'Rename role'; edit.setAttribute('aria-label', 'Rename role ' + r.name); edit.textContent = '✎';
    edit.addEventListener('click', async () => {
      const n = (prompt('Rename role', r.name) || '').trim().slice(0, 40);
      if (!n || n === r.name) return;
      const { error } = await supabaseClient.from('project_roles').update({ name: n }).eq('id', r.id);
      if (error) { alert(roleErrorMessage(error)); return; }
      await ensureProjectRoles(projectId, true); renderCollabPanel();
    });
    const del = document.createElement('button'); del.type = 'button'; del.title = 'Delete role'; del.setAttribute('aria-label', 'Delete role ' + r.name); del.textContent = '×';
    del.addEventListener('click', async () => {
      if (!confirm(`Delete the role "${r.name}"? Members with this role stay in the project and become unassigned.`)) return;
      const { error } = await supabaseClient.from('project_roles').delete().eq('id', r.id);
      if (error) { alert(roleErrorMessage(error)); return; }
      projectMembers.forEach(m => { if (String(m.role_id) === String(r.id)) m.role_id = null; });
      await ensureProjectRoles(projectId, true); renderCollabPanel();
    });
    chip.append(edit, del); listEl.appendChild(chip);
  });
  const p = getProject(projectId);
  document.getElementById('collab-role-self').checked = !!(p && p.membersCanSetRole);
}
document.getElementById('collab-role-add').addEventListener('click', async () => {
  if (!currentProjectId || !isProjectOwner(currentProjectId) || !isTeamProject(currentProjectId)) return;
  const name = prompt('New role name (e.g. Backend, Documentation)');
  if (name && await createProjectRole(currentProjectId, name)) renderCollabPanel();
});
document.getElementById('collab-role-self').addEventListener('change', async (e) => {
  const p = getProject(currentProjectId);
  if (!p || !isProjectOwner(p.id) || !isTeamProject(p.id)) { e.target.checked = !!(p && p.membersCanSetRole); return; }
  p.membersCanSetRole = e.target.checked;
  saveProjects();
  await dbUpdate('projects', p.id, { members_can_set_role: p.membersCanSetRole });
  renderCollabPanel();
});

function renderCollabPanel() {
  if (!collabPanel) return;
  if (currentView !== 'project' || !currentProjectId || !currentUser || !isTeamProject(currentProjectId)) {
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
  if (!projectRolesRequested.has(String(currentProjectId))) {
    const pidAtCall = currentProjectId;
    ensureProjectRoles(pidAtCall).then(() => { if (String(currentProjectId) === String(pidAtCall)) renderCollabPanel(); });
  }
  renderRoleManager(currentProjectId, ownerIsMe);

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

  const roleName = roleNameForMember(m);
  if (roleName) { const tag = document.createElement('div'); tag.className = 'collab-role-tag'; tag.textContent = roleName; info.appendChild(tag); }
  const proj = getProject(m.project_id);
  const isSelf = !!(currentUser && m.status === 'accepted' &&
    (m.member_id === currentUser.id || (m.member_email || '').toLowerCase() === (currentUser.email || '').toLowerCase()));
  const canPickRole = m.status === 'accepted' && proj && isTeamProject(proj.id) && (ownerIsMe || (isSelf && proj.membersCanSetRole));
  if (canPickRole) {
    const sel = document.createElement('select'); sel.className = 'collab-role-select'; sel.setAttribute('aria-label', 'Role for ' + m.member_email);
    sel.add(new Option('No role', ''));
    rolesFor(m.project_id).forEach(r => sel.add(new Option(r.name, r.id)));
    if (ownerIsMe) sel.add(new Option('+ New role…', '__new'));
    sel.value = m.role_id || '';
    sel.addEventListener('change', async () => {
      let target = sel.value;
      if (target === '__new') {
        const created = await createProjectRole(m.project_id, prompt('New role name'));
        if (!created) { sel.value = m.role_id || ''; return; }
        target = created.id;
      }
      if (await assignMemberRole(m, target)) renderCollabPanel(); else sel.value = m.role_id || '';
    });
    info.appendChild(sel);
  }

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
  if (!isProjectOwner(currentProjectId) || !isTeamProject(currentProjectId)) return;

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
  if (!currentUser || !isProjectOwner(currentProjectId) || !isTeamProject(currentProjectId)) { showInviteError('Only Team Projects can have members.'); return; }
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
  if (error) { showInviteError(friendlyPlanError(error.message) || 'Could not send invite.'); return; }
  showToast('invite');

  closeInviteModal();
  await refreshSharedData();
  await loadNotifications();
});

const GUEST_NOTIF_READ_KEY = 'mosstaskGuestNotifRead';
function getGuestNotifReadIds() {
  return new Set(safeParse(GUEST_NOTIF_READ_KEY, []));
}
function markGuestNotifRead(id) {
  const ids = getGuestNotifReadIds();
  ids.add(id);
  safeSetItem(GUEST_NOTIF_READ_KEY, JSON.stringify(Array.from(ids)));
}
function markAllGuestNotifRead(ids) {
  const set = getGuestNotifReadIds();
  ids.forEach(id => set.add(id));
  safeSetItem(GUEST_NOTIF_READ_KEY, JSON.stringify(Array.from(set)));
}
function computeGuestNotifications() {
  const readIds = getGuestNotifReadIds();
  const todayKey = todayStr();
  const items = [];
  todos.forEach(t => {
    if (t.done || !t.due) return;
    if (t.due < todayKey) {
      const id = `overdue:${t.id}:${t.due}`;
      items.push({ id, title: 'Overdue task', body: t.text, created_at: new Date(t.due + 'T00:00:00').toISOString(), read: readIds.has(id) });
    } else if (t.due === todayKey) {
      const id = `due-today:${t.id}:${t.due}`;
      items.push({ id, title: 'Due today', body: t.text, created_at: new Date().toISOString(), read: readIds.has(id) });
    }
  });
  items.sort((a, b) => Number(a.read) - Number(b.read));
  return items;
}
function activeNotifications() {
  return currentUser ? notifications : computeGuestNotifications();
}

const notifBell = document.getElementById('notif-bell');
const mobileNotifBell = document.getElementById('mobile-notif-bell');
const notifCountEl = document.getElementById('notif-count');
const mobileNotifCountEl = document.getElementById('mobile-notif-count');
const notifOverlay = document.getElementById('notif-overlay');
const notifListEl = document.getElementById('notif-list');

function renderNotifBadge() {
  if (!currentUser && !isGuest) {
    notifBell.classList.add('hidden');
    mobileNotifBell.style.display = 'none';
    return;
  }
  notifBell.classList.remove('hidden');
  mobileNotifBell.style.display = 'flex';
  const unread = activeNotifications().filter(n => !n.read).length;
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
  return formatAppDate(d, { month: 'short', day: 'numeric' });
}

function renderNotifList() {
  if (!notifListEl) return;
  notifListEl.innerHTML = '';
  if (!currentUser && !isGuest) {
    notifListEl.innerHTML = '<div class="notif-empty">Sign in to receive notifications.</div>';
    return;
  }
  const list = activeNotifications();
  if (!list.length) {
    notifListEl.innerHTML = '<div class="notif-empty">You\'re all caught up.</div>';
    return;
  }
  list.forEach(n => {
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
      if (currentUser) await dbMarkNotificationRead(n.id);
      else markGuestNotifRead(n.id);
    });

    notifListEl.appendChild(item);
  });
}

async function respondToInvite(notif, memberRowId, accept) {
  const { error } = await dbRespondToInvite(memberRowId, accept);
  if (error) return;
  if (notif) { notif.read = true; await dbMarkNotificationRead(notif.id); }
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
  if (currentUser) {
    const unread = notifications.filter(n => !n.read);
    for (const n of unread) { n.read = true; await dbMarkNotificationRead(n.id); }
  } else if (isGuest) {
    markAllGuestNotifRead(computeGuestNotifications().map(n => n.id));
  }
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

async function refreshSharedData() {
  if (!supabaseReady || !currentUser) return;
  const [remoteProjects, remoteTodos, remoteMembers] = await Promise.all([
    dbFetchProjects(),
    dbFetchTodos(),
    dbFetchProjectMembers(),
  ]);
  if (remoteProjects) {
    projects = remoteProjects.map(p => ({ id: p.id, name: p.name, userId: p.user_id, type: p.project_type === 'team' ? 'team' : 'personal', membersCanSetRole: !!p.members_can_set_role, announcement: p.announcement || '', announcementUpdatedAt: p.announcement_updated_at || null, description: p.description || '' }));
    saveProjects();
  }
  if (remoteTodos) {
    const localCategoryById = new Map(todos.map(t => [String(t.id), t.category || null]));
    todos = remoteTodos.map(t => ({
      id: t.id, text: t.text, desc: t.desc, done: t.done,
      due: t.due, priority: t.priority, projectId: t.project_id || null,
      category: t.category != null ? t.category : (localCategoryById.get(String(t.id)) || null),
      timeSpentSec: t.time_spent_sec || 0,
      subtasks: t.subtasks || [],
      recurrence: t.recurrence || null,
      reminderTime: t.reminder_time || null,
      pinned: !!t.pinned,
      assigneeEmail: t.assignee_email || null,
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

let events = safeParse('events', []);
let calViewDate = new Date();
calViewDate.setDate(1);
let selectedDateKey = todayStr();
let editingEventId = null;

// "Now" is always read from the system clock; this only detects a changed
// day / timezone and re-renders what depends on it. Stored event data is never touched.
let lastNowKey = todayStr();
function tzSignature() {
  try { return `${Intl.DateTimeFormat().resolvedOptions().timeZone}|${new Date().getTimezoneOffset()}`; }
  catch (e) { return String(new Date().getTimezoneOffset()); }
}
let lastTzSig = tzSignature();
function refreshNowState() {
  const key = todayStr();
  const tz = tzSignature();
  if (key === lastNowKey && tz === lastTzSig) return false;
  const prev = lastNowKey;
  lastNowKey = key; lastTzSig = tz;
  if (selectedDateKey === prev) selectedDateKey = key;
  const viewing = `${calViewDate.getFullYear()}-${String(calViewDate.getMonth() + 1).padStart(2, '0')}`;
  if (prev.slice(0, 7) === viewing) { const [y, m] = key.split('-').map(Number); calViewDate = new Date(y, m - 1, 1); }
  try {
    renderCounts();
    if (currentView === 'calendar') { renderCalendar(); renderDayPanel(); }
    else if (currentView === 'all') renderHomeSummary();
  } catch (err) { console.warn('[Clock] re-render failed:', err && err.message); }
  scheduleReminderSync(); // absolute reminder times depend on the timezone
  return true;
}
let midnightTimer = null;
function armMidnightTimer() {
  clearTimeout(midnightTimer);
  const n = new Date();
  const next = new Date(n.getFullYear(), n.getMonth(), n.getDate() + 1, 0, 0, 1);
  midnightTimer = setTimeout(() => { refreshNowState(); armMidnightTimer(); }, Math.max(1000, next - n));
}
function onClockMayHaveChanged() { refreshNowState(); armMidnightTimer(); }
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') onClockMayHaveChanged(); });
window.addEventListener('mosstask:resume', onClockMayHaveChanged);
window.addEventListener('focus', onClockMayHaveChanged);
setInterval(refreshNowState, 60 * 1000); // cheap compare; catches manual clock/timezone changes
armMidnightTimer();

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

function saveEvents() { safeSetItem('events', JSON.stringify(events)); scheduleReminderSync(); }
function pad2(n) { return n.toString().padStart(2, '0'); }
function dateKey(y, m, d) { return `${y}-${pad2(m + 1)}-${pad2(d)}`; }
function eventsForDate(dateStr) {
  return events.filter(e => e.date === dateStr).sort((a, b) => (a.time || '99:99').localeCompare(b.time || '99:99'));
}
function formatDateLong(dateStr) {
  const [y, m, d] = dateStr.split('-').map(Number);
  return formatAppDate(new Date(y, m - 1, d), { weekday: 'long', month: 'long', day: 'numeric' });
}
function eventRemoteRow(ev) {
  return { id: ev.id, user_id: currentUser.id, date: ev.date, time: ev.time, title: ev.title, notes: ev.notes || '' };
}

function renderCalendar() {
  const year = calViewDate.getFullYear();
  const month = calViewDate.getMonth();
  calMonthLabel.textContent = formatAppDate(calViewDate, { month: 'long', year: 'numeric' });
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
      dot.innerHTML = '<svg viewBox="0 0 24 24" fill="currentColor" stroke="none" aria-hidden="true" focusable="false"><path d="M12 2a6 6 0 0 0-6 6v3.586l-1.707 1.707A1 1 0 0 0 5 15h14a1 1 0 0 0 .707-1.707L18 11.586V8a6 6 0 0 0-6-6z"></path><path d="M9.5 17a2.5 2.5 0 0 0 5 0z"></path></svg>';
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
    row.tabIndex = 0; row.setAttribute('role', 'button');
    row.addEventListener('keydown', (e) => { if ((e.key === 'Enter' || e.key === ' ') && e.target === row) { e.preventDefault(); row.click(); } });
    const icon = document.createElement('div');
    icon.className = 'event-icon';
    icon.innerHTML = '<svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true" focusable="false"><circle cx="12" cy="12" r="8.25" stroke="currentColor" stroke-width="1.6"/><path d="M12 7.5v4.5l3 2" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>';
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
      notesIcon.innerHTML = '<svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true" focusable="false"><path d="M5 4.5h14v11l-4 4H5v-15Z" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/><path d="M9 9h6M9 13h4" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>';
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

calPrevBtn.addEventListener('click', () => { refreshNowState(); calViewDate.setMonth(calViewDate.getMonth() - 1); renderCalendar(); });
calNextBtn.addEventListener('click', () => { refreshNowState(); calViewDate.setMonth(calViewDate.getMonth() + 1); renderCalendar(); });
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
  return formatAppDate(d, { month: 'short', day: 'numeric', year: 'numeric', hour: '2-digit', minute: '2-digit' });
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
    refreshHomeIfVisible();
  }, 120);
}
function refreshHomeIfVisible() {
  try { if (currentView === 'all') renderHomeSummary(); } catch (err) { /* widgets are non-critical */ }
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
    category: row.category || null,
    timeSpentSec: row.time_spent_sec || 0,
    subtasks: row.subtasks || [],
    recurrence: row.recurrence || null,
    reminderTime: row.reminder_time || null,
    pinned: !!row.pinned,
    assigneeEmail: row.assignee_email || null,
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

  const idx = projects.findIndex(p => String(p.id) === String(row.id));
  const prevP = idx >= 0 ? projects[idx] : {};
  const mapped = { ...prevP, id: row.id, name: row.name, userId: row.user_id,
    type: row.project_type ? (row.project_type === 'team' ? 'team' : 'personal') : projectTypeOf(prevP),
    membersCanSetRole: row.members_can_set_role != null ? !!row.members_can_set_role : !!prevP.membersCanSetRole,
    announcement: row.announcement != null ? row.announcement : (prevP.announcement || ''),
    announcementUpdatedAt: row.announcement != null ? (row.announcement_updated_at || null) : (prevP.announcementUpdatedAt || null),
    description: row.description != null ? row.description : (prevP.description || '') };
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
        projects = data.map(p => ({ id: p.id, name: p.name, userId: p.user_id, type: p.project_type === 'team' ? 'team' : 'personal', membersCanSetRole: !!p.members_can_set_role, announcement: p.announcement || '', announcementUpdatedAt: p.announcement_updated_at || null, description: p.description || '' }));
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
      refreshHomeIfVisible();
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
  refreshHomeIfVisible();
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

// ---- Keep everything fresh -------------------------------------------------
// Realtime pushes changes instantly, but the socket can silently drop (sleep,
// background, network change). So: reconnect on failure, and do a full refetch
// whenever the app returns, comes back online, or the channel reconnects.
let resyncing = false;
let lastResyncAt = 0;
async function resyncFromServer(force) {
  if (!supabaseReady || !currentUser || resyncing) return;
  if (!force && Date.now() - lastResyncAt < 5000) return; // throttle bursts of triggers
  resyncing = true;
  lastResyncAt = Date.now();
  try {
    const [remoteEvents, remoteNotes] = await Promise.all([
      dbFetchAll('events', currentUser.id),
      dbFetchAll('notes', currentUser.id),
    ]);
    await refreshSharedData(); // projects, todos, members (+ their renders)
    if (remoteEvents) {
      events = remoteEvents.map(ev => ({ id: ev.id, date: ev.date, time: ev.time, title: ev.title, notes: ev.notes }));
      saveEvents();
      if (currentView === 'calendar') { renderCalendar(); renderDayPanel(); }
    }
    if (remoteNotes) {
      notes = remoteNotes.map(n => ({ id: n.id, title: n.title, category: n.category, desc: n.desc, content: n.content, createdAt: n.created_at }));
      saveNotes();
      if (currentView === 'notes') renderNotes();
    }
    await loadNotifications();
    refreshHomeIfVisible();
  } catch (err) {
    console.warn('[Sync] resync failed:', err && err.message);
  } finally {
    resyncing = false;
  }
}

let realtimeRetryTimer = null;
let realtimeRetryMs = 3000;
let realtimeWasDown = false;
window.onRealtimeStatus = (status) => {
  if (status === 'SUBSCRIBED') {
    realtimeRetryMs = 3000;
    if (realtimeWasDown) { realtimeWasDown = false; resyncFromServer(true); } // catch up on what was missed
    return;
  }
  if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED') {
    realtimeWasDown = true;
    if (realtimeRetryTimer || !currentUser) return;
    realtimeRetryTimer = setTimeout(() => {
      realtimeRetryTimer = null;
      attachRealtimeSubscriptions();
    }, realtimeRetryMs);
    realtimeRetryMs = Math.min(realtimeRetryMs * 2, 60000); // back off
  }
};
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') resyncFromServer(false); });
window.addEventListener('mosstask:resume', () => resyncFromServer(false));
window.addEventListener('online', () => { attachRealtimeSubscriptions(); resyncFromServer(true); });
setInterval(() => { if (document.visibilityState === 'visible') resyncFromServer(false); }, 120 * 1000); // safety net

function detachRealtimeSubscriptions() {
  if (typeof teardownRealtime === 'function') teardownRealtime();
}

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
  }, 250);
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

const WELCOME_KEY = 'mosstaskWelcomeSeen';
let onboardingChainNext = null;
const welcomeOverlay = document.getElementById('welcome-overlay');
const welcomeDismissBtn = document.getElementById('welcome-dismiss-btn');
const showWelcomeBtn = document.getElementById('show-welcome-btn');

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
  if (onboardingChainNext) { const next = onboardingChainNext; onboardingChainNext = null; next(); }
}
if (welcomeDismissBtn) welcomeDismissBtn.addEventListener('click', dismissWelcome);
if (showWelcomeBtn) showWelcomeBtn.addEventListener('click', () => { runWelcomeGuideFlow({ forced: true }); });
if (welcomeOverlay) {
  welcomeOverlay.addEventListener('click', (e) => {
    if (e.target === welcomeOverlay) dismissWelcome();
  });
}

const TIPS_INTRO_KEY = 'mosstaskTipsIntroSeen';
let tipsChainNext = null;
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
  if (tipsChainNext) { const next = tipsChainNext; tipsChainNext = null; next(); }
}
if (tipsIntroDismissBtn) tipsIntroDismissBtn.addEventListener('click', dismissTipsIntro);
if (tipsIntroOverlay) {
  tipsIntroOverlay.addEventListener('click', (e) => {
    if (e.target === tipsIntroOverlay) dismissTipsIntro();
  });
}

const TUTORIAL_KEY = 'mosstaskTutorialSeen';
const tutorialOverlay = document.getElementById('tutorial-overlay');
const tutorialSpotlight = document.getElementById('tutorial-spotlight');
const tutorialTooltip = document.getElementById('tutorial-tooltip');
const tutorialTitleEl = document.getElementById('tutorial-title');
const tutorialDescEl = document.getElementById('tutorial-desc');
const tutorialDotsEl = document.getElementById('tutorial-dots');
const tutorialBackBtn = document.getElementById('tutorial-back-btn');
const tutorialNextBtn = document.getElementById('tutorial-next-btn');
const tutorialSkipBtn = document.getElementById('tutorial-skip-btn');

if (safeGetItem(WELCOME_KEY) === 'true' && safeGetItem(TUTORIAL_KEY) !== 'true') {
  safeSetItem(TUTORIAL_KEY, 'true');
}

const TUTORIAL_MOBILE_BREAKPOINT = 860;

const TUTORIAL_STEPS = [
  {
    id: 'home', view: 'all', inSidebar: true, selector: '#all-tasks-btn',
    title: 'Your Home view',
    desc: 'See today\u2019s tasks and quick stats at a glance. This is where you\u2019ll land each time.',
  },
  {
    id: 'dashboard', view: 'all', selector: '#home-summary',
    title: 'Your dashboard',
    desc: 'Your greeting, today\u2019s counts, and this week\u2019s progress live right here.',
  },
  {
    id: 'add-task', view: 'all', selector: '#task-add-toggle',
    title: 'Add a task',
    desc: 'Click here to add a task with a due date, priority, and category.',
  },
  {
    id: 'task-toolbar', view: 'all', selector: '#task-toolbar',
    title: 'Sort & filter',
    desc: 'Reorder your list or filter by category using these controls.',
  },
  {
    id: 'tools-nav', view: 'all', inSidebar: true, selector: '.nav-item[data-view="calendar"]',
    title: 'More tools',
    desc: 'Calendar, Notes, and Pomodoro live in this section of the sidebar.',
  },
  {
    id: 'calendar', view: 'calendar', selector: '.calendar-main',
    title: 'Plan with Calendar',
    desc: 'See events and due tasks laid out by day, and add new events straight from here.',
  },
  {
    id: 'notes', view: 'notes', selector: '.notes-toolbar',
    title: 'Capture ideas in Notes',
    desc: 'Jot down quick notes and keep them organized into categories.',
  },
  {
    id: 'pomodoro', view: 'pomodoro', selector: '.pomodoro-card',
    title: 'Focus with Pomodoro',
    desc: 'Run timed focus sessions and queue up the tasks you want to work through.',
  },
  {
    id: 'personal', view: 'all', inSidebar: true, selector: '#nav-personal-btn',
    title: 'Personal',
    desc: 'Personal opens your own workspace: what needs attention today, your personal projects, and what is coming up.',
  },
  {
    id: 'projects', view: 'all', inSidebar: true, selector: '#nav-projects-btn',
    title: 'Projects',
    desc: 'Projects opens the project hub, where you create, find and join shared projects. Pick one to open its workspace.',
  },
  {
    id: 'notif',
    getTarget: () => document.getElementById(window.innerWidth <= TUTORIAL_MOBILE_BREAKPOINT ? 'mobile-notif-bell' : 'notif-bell'),
    title: 'Stay notified',
    desc: 'Reminders about due tasks and updates show up here.',
  },
  {
    id: 'settings-nav', inSidebar: true, selector: '.nav-item[data-view="settings"]',
    title: 'Make it yours',
    desc: 'Adjust theme, notifications, and other preferences any time in Settings.',
  },
  {
    id: 'settings-theme', view: 'settings', selector: '#theme-toggle',
    title: 'Personalize the theme',
    desc: 'Switch between light and dark, or leave it following your device.',
  },
];

let tutorialActive = false;
let tutorialStep = -1;
let tutorialRunToken = 0;
let tutorialSidebarOpenedByUs = false;
let tutorialRafId = null;
let tutorialSettleTimer = null;

function tutorialIsVisible(el) {
  if (!el || !el.isConnected) return false;
  const style = window.getComputedStyle(el);
  if (style.display === 'none' || style.visibility === 'hidden') return false;
  if (el.offsetParent === null && style.position !== 'fixed' && style.position !== 'sticky') return false;
  const r = el.getBoundingClientRect();
  return r.width > 0 && r.height > 0;
}

function tutorialResolveTarget(step) {
  if (!step) return null;
  const el = typeof step.getTarget === 'function' ? step.getTarget() : document.querySelector(step.selector);
  return tutorialIsVisible(el) ? el : null;
}

function tutorialWaitForTarget(step, token, timeoutMs) {
  return new Promise((resolve) => {
    const deadline = performance.now() + (timeoutMs || 4000);
    let settled = false;
    let observer = null;
    let rafId = null;

    function cleanup() {
      if (observer) observer.disconnect();
      if (rafId) cancelAnimationFrame(rafId);
    }
    function finish(el) {
      if (settled) return;
      settled = true;
      cleanup();
      resolve(el);
    }
    function tick() {
      if (token !== tutorialRunToken || !tutorialActive) { finish(null); return; }
      const el = tutorialResolveTarget(step);
      if (el) { finish(el); return; }
      if (performance.now() >= deadline) { finish(null); return; }
      rafId = requestAnimationFrame(tick);
    }

    observer = new MutationObserver(() => {
      if (token !== tutorialRunToken || !tutorialActive) { finish(null); return; }
      const el = tutorialResolveTarget(step);
      if (el) finish(el);
    });
    observer.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['style', 'class', 'hidden'] });

    tick();
  });
}

function tutorialTrack(token) {
  if (token !== tutorialRunToken || !tutorialActive) return;
  const step = TUTORIAL_STEPS[tutorialStep];
  const el = tutorialResolveTarget(step);
  if (!el) {
    tutorialShowStep(tutorialStep);
    return;
  }

  const pad = 8;
  const r = el.getBoundingClientRect();
  const vw = window.innerWidth;
  const vh = window.innerHeight;

  const top = Math.max(0, r.top - pad);
  const left = Math.max(0, r.left - pad);
  const width = Math.min(r.width + pad * 2, vw - left);
  const height = Math.min(r.height + pad * 2, vh - top);
  tutorialSpotlight.style.top = top + 'px';
  tutorialSpotlight.style.left = left + 'px';
  tutorialSpotlight.style.width = Math.max(0, width) + 'px';
  tutorialSpotlight.style.height = Math.max(0, height) + 'px';

  const margin = 16;
  const tw = tutorialTooltip.offsetWidth || 280;
  const th = tutorialTooltip.offsetHeight || 140;

  let ttop = r.bottom + 16;
  if (ttop + th > vh - margin) {
    const above = r.top - 16 - th;
    ttop = above >= margin ? above : Math.max(margin, vh - th - margin);
  }
  ttop = Math.min(Math.max(ttop, margin), Math.max(margin, vh - th - margin));

  let tleft = r.left;
  tleft = Math.min(Math.max(tleft, margin), Math.max(margin, vw - tw - margin));

  tutorialTooltip.style.top = ttop + 'px';
  tutorialTooltip.style.left = tleft + 'px';

  tutorialRafId = requestAnimationFrame(() => tutorialTrack(token));
}

function tutorialRenderStepChrome(i) {
  const step = TUTORIAL_STEPS[i];
  tutorialTitleEl.textContent = step.title;
  tutorialDescEl.textContent = step.desc;
  tutorialDotsEl.innerHTML = '';
  TUTORIAL_STEPS.forEach((_, idx) => {
    const dot = document.createElement('span');
    if (idx === i) dot.className = 'active';
    tutorialDotsEl.appendChild(dot);
  });
  tutorialBackBtn.style.visibility = i === 0 ? 'hidden' : 'visible';
  tutorialNextBtn.textContent = i === TUTORIAL_STEPS.length - 1 ? 'Done' : 'Next';
}

async function tutorialShowStep(i) {
  const step = TUTORIAL_STEPS[i];
  if (!tutorialActive || !step) { tutorialEnd(); return; }

  const token = ++tutorialRunToken;
  tutorialStep = i;

  tutorialSpotlight.classList.add('is-loading');
  tutorialTooltip.classList.add('is-loading');
  if (tutorialRafId) { cancelAnimationFrame(tutorialRafId); tutorialRafId = null; }
  if (tutorialSettleTimer) { clearTimeout(tutorialSettleTimer); tutorialSettleTimer = null; }

  if (step.view && step.view !== currentView && typeof setView === 'function') {
    setView(step.view);
  }

  const needsSidebar = !!step.inSidebar && window.innerWidth <= TUTORIAL_MOBILE_BREAKPOINT;
  if (needsSidebar) {
    if (typeof openSidebar === 'function' && !sidebar.classList.contains('open')) {
      openSidebar();
      tutorialSidebarOpenedByUs = true;
    }
  } else if (tutorialSidebarOpenedByUs && typeof closeSidebar === 'function') {
    closeSidebar();
    tutorialSidebarOpenedByUs = false;
  }

  const el = await tutorialWaitForTarget(step, token);
  if (token !== tutorialRunToken || !tutorialActive) return;

  if (!el) {
    tutorialGoTo(i + 1);
    return;
  }

  tutorialRenderStepChrome(i);
  el.scrollIntoView({ block: 'center', inline: 'nearest', behavior: 'smooth' });

  tutorialSettleTimer = setTimeout(() => {
    if (token !== tutorialRunToken || !tutorialActive) return;
    tutorialSpotlight.classList.remove('is-loading');
    tutorialTooltip.classList.remove('is-loading');
    tutorialTrack(token);
  }, 260);
}

function tutorialGoTo(i) {
  if (!tutorialActive) return;
  if (i < 0) return;
  if (i >= TUTORIAL_STEPS.length) { tutorialEnd(); return; }
  tutorialShowStep(i);
}

function tutorialStart() {
  if (!tutorialOverlay) return;
  tutorialActive = true;
  tutorialStep = -1;
  tutorialSidebarOpenedByUs = false;
  tutorialOverlay.style.display = 'block';
  document.body.classList.add('tutorial-scroll-lock');
  tutorialGoTo(0);
}

function tutorialEnd() {
  safeSetItem(TUTORIAL_KEY, 'true');
  tutorialActive = false;
  tutorialRunToken += 1;
  tutorialOverlay.style.display = 'none';
  document.body.classList.remove('tutorial-scroll-lock');
  tutorialSpotlight.classList.remove('is-loading');
  tutorialTooltip.classList.remove('is-loading');
  if (tutorialRafId) cancelAnimationFrame(tutorialRafId);
  if (tutorialSettleTimer) clearTimeout(tutorialSettleTimer);
  tutorialRafId = null;
  tutorialSettleTimer = null;
  if (tutorialSidebarOpenedByUs && typeof closeSidebar === 'function') {
    closeSidebar();
    tutorialSidebarOpenedByUs = false;
  }
}

if (tutorialNextBtn) tutorialNextBtn.addEventListener('click', () => tutorialGoTo(tutorialStep + 1));
if (tutorialBackBtn) tutorialBackBtn.addEventListener('click', () => { if (tutorialStep > 0) tutorialGoTo(tutorialStep - 1); });
if (tutorialSkipBtn) tutorialSkipBtn.addEventListener('click', tutorialEnd);

// Keyboard access to the tutorial's own controls only — Escape/Arrow keys
// work while it's active, everything else stays swallowed by the overlay
// (see the keydown guard near the shortcut handler above).
document.addEventListener('keydown', (e) => {
  if (!tutorialActive) return;
  if (e.key === 'Escape') { e.preventDefault(); tutorialEnd(); }
  else if (e.key === 'ArrowRight' || e.key === 'Enter') { e.preventDefault(); tutorialGoTo(tutorialStep + 1); }
  else if (e.key === 'ArrowLeft') { e.preventDefault(); if (tutorialStep > 0) tutorialGoTo(tutorialStep - 1); }
}, true);

window.addEventListener('scroll', () => {
  if (tutorialActive && tutorialRafId == null && tutorialStep >= 0) tutorialTrack(tutorialRunToken);
}, true);
window.addEventListener('resize', () => {
  if (tutorialActive && tutorialRafId == null && tutorialStep >= 0) tutorialTrack(tutorialRunToken);
});

const showTutorialBtn = document.getElementById('show-tutorial-btn');
if (showTutorialBtn) {
  showTutorialBtn.addEventListener('click', () => {
    tutorialStep = -1;
    tutorialStart();
  });
}

function maybeStartTutorial() {
  if (!tutorialOverlay) return;
  if (safeGetItem(TUTORIAL_KEY) === 'true') return;
  tutorialStart();
}

function runWelcomeGuideFlow(opts) {
  const forced = !!(opts && opts.forced);
  const afterTips = () => { if (forced) tutorialStart(); else maybeStartTutorial(); };
  const afterWelcome = () => {
    if (!forced && areTipsEnabled() && safeGetItem(TIPS_INTRO_KEY) !== 'true') {
      tipsChainNext = afterTips;
      tipsIntroOverlay.style.display = 'flex';
    } else {
      afterTips();
    }
  };
  if (forced) {
    safeRemoveItem(WELCOME_KEY);
    safeRemoveItem(TUTORIAL_KEY);
  }
  if (safeGetItem(WELCOME_KEY) !== 'true') {
    onboardingChainNext = afterWelcome;
    maybeShowWelcome();
  } else {
    afterWelcome();
  }
}

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

const searchOverlay = document.getElementById('search-overlay');
const searchInput = document.getElementById('global-search-input');
const searchResultsEl = document.getElementById('search-results');
const searchEmptyEl = document.getElementById('search-empty');

function openSearch() {
  if (!searchOverlay) return;
  searchOverlay.style.display = 'flex';
  searchInput.value = '';
  renderSearchResults('');
  setTimeout(() => searchInput.focus(), 30);
}
function closeSearch() { if (searchOverlay) searchOverlay.style.display = 'none'; }

function renderSearchResults(query) {
  const q = query.trim().toLowerCase();
  searchResultsEl.innerHTML = '';
  searchEmptyEl.style.display = 'none';
  if (!q) return;

  const results = [];
  todos.forEach((t) => {
    if ((t.text || '').toLowerCase().includes(q) || (t.desc || '').toLowerCase().includes(q)) {
      results.push({ type: 'task', icon: '✓', title: t.text, sub: t.done ? 'Completed' : (t.due ? `Due ${t.due}` : 'Task'), data: t });
    }
  });
  notes.forEach((n) => {
    if ((n.title || '').toLowerCase().includes(q) || (n.content || '').toLowerCase().includes(q) || (n.desc || '').toLowerCase().includes(q)) {
      results.push({ type: 'note', icon: '🗒', title: n.title, sub: n.category || 'Note', data: n });
    }
  });
  events.forEach((ev) => {
    if ((ev.title || '').toLowerCase().includes(q) || (ev.notes || '').toLowerCase().includes(q)) {
      results.push({ type: 'event', icon: '📅', title: ev.title, sub: ev.date, data: ev });
    }
  });

  if (!results.length) { searchEmptyEl.style.display = 'block'; return; }

  results.slice(0, 40).forEach((r) => {
    const row = document.createElement('button');
    row.type = 'button';
    row.className = 'search-result-item';
    const icon = document.createElement('span');
    icon.className = 'search-result-icon';
    icon.textContent = r.icon;
    const info = document.createElement('span');
    info.className = 'search-result-info';
    const title = document.createElement('span');
    title.className = 'search-result-title';
    title.textContent = r.title;
    const sub = document.createElement('span');
    sub.className = 'search-result-sub';
    sub.textContent = r.sub;
    info.append(title, sub);
    row.append(icon, info);
    row.addEventListener('click', () => {
      closeSearch();
      if (r.type === 'task') {
        if (r.data.projectId) { currentProjectId = r.data.projectId; setView('project'); }
        else setView('all');
        openTaskDetail(r.data.id);
      } else if (r.type === 'note') {
        setView('notes');
      } else if (r.type === 'event') {
        selectedDateKey = r.data.date;
        setView('calendar');
        showDayPanelList();
        renderCalendar();
        renderDayPanel();
      }
    });
    searchResultsEl.appendChild(row);
  });
}
if (searchInput) searchInput.addEventListener('input', () => renderSearchResults(searchInput.value));
if (searchOverlay) searchOverlay.addEventListener('click', (e) => { if (e.target === searchOverlay) closeSearch(); });
document.getElementById('search-trigger-btn')?.addEventListener('click', openSearch);
document.getElementById('mobile-search-btn')?.addEventListener('click', openSearch);
document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && searchOverlay && searchOverlay.style.display === 'flex') closeSearch(); });

const shortcutsOverlay = document.getElementById('shortcuts-overlay');
function openShortcuts() { if (shortcutsOverlay) shortcutsOverlay.style.display = 'flex'; }
function closeShortcuts() { if (shortcutsOverlay) shortcutsOverlay.style.display = 'none'; }
document.getElementById('shortcuts-btn')?.addEventListener('click', openShortcuts);
document.getElementById('shortcuts-close-btn')?.addEventListener('click', closeShortcuts);
if (shortcutsOverlay) shortcutsOverlay.addEventListener('click', (e) => { if (e.target === shortcutsOverlay) closeShortcuts(); });
document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && shortcutsOverlay && shortcutsOverlay.style.display === 'flex') closeShortcuts(); });

// ---- Store / plans -----------------------------------------------------
// Fill in real Stripe Payment Link URLs once created in the Stripe dashboard
// (Product catalog > Payment links). client_reference_id lets the webhook
// know which MossTask account to upgrade; keep it on both links.
const STRIPE_PAYMENT_LINKS = {
  team: 'https://buy.stripe.com/REPLACE_WITH_TEAM_LINK',
};

const storeOverlay = document.getElementById('store-overlay');
const storeCurrentPlanSub = document.getElementById('store-current-plan-sub');
const storeSigninNotice = document.getElementById('store-signin-notice');
const storeUsageLine = document.getElementById('store-usage-line');
const planStatusHint = document.getElementById('plan-status-hint');

function openStore() {
  if (!storeOverlay) return;
  storeOverlay.style.display = 'flex';
  refreshStoreUI();
}
function closeStore() { if (storeOverlay) storeOverlay.style.display = 'none'; }

async function refreshStoreUI() {
  document.querySelectorAll('.store-tier-card').forEach((el) => el.classList.remove('is-current'));

  if (!currentUser || isGuest) {
    if (storeSigninNotice) storeSigninNotice.style.display = 'block';
    if (storeUsageLine) storeUsageLine.style.display = 'none';
    if (storeCurrentPlanSub) storeCurrentPlanSub.textContent = "You're using Guest mode.";
    if (planStatusHint) planStatusHint.textContent = 'Sign in to see your plan and usage.';
    return;
  }
  if (storeSigninNotice) storeSigninNotice.style.display = 'none';

  let usage = (typeof dbFetchPlanUsage === 'function') ? await dbFetchPlanUsage() : null;
  if (!usage) {
    // Fall back to the server-side profile; never assume Free.
    const prof = (typeof dbFetchMyProfile === 'function') ? await dbFetchMyProfile() : null;
    if (!prof) {
      if (storeCurrentPlanSub) storeCurrentPlanSub.textContent = "Couldn't load your plan.";
      if (planStatusHint) planStatusHint.textContent = "Couldn't load your plan.";
      return;
    }
    usage = { plan: prof.plan || 'free', max_projects: null, owned_projects: 0 };
  }

  const planLabel = usage.plan.charAt(0).toUpperCase() + usage.plan.slice(1);
  if (storeCurrentPlanSub) storeCurrentPlanSub.textContent = `You're on the ${planLabel} plan.`;
  if (planStatusHint) {
    planStatusHint.textContent = usage.max_projects != null
      ? `${planLabel} plan — ${usage.owned_projects}/${usage.max_projects} collaborative projects used`
      : `${planLabel} plan — unlimited collaborative projects`;
  }
  const card = document.querySelector(`.store-tier-card[data-plan="${usage.plan}"]`);
  if (card) card.classList.add('is-current');
  document.querySelectorAll('[data-plan-btn]').forEach((b) => {
    const p = b.getAttribute('data-plan-btn');
    if (p === usage.plan) { b.textContent = 'Current plan'; b.disabled = true; b.classList.remove('primary'); }
    else if (p === 'team') { b.textContent = 'Upgrade to Team'; b.disabled = false; b.classList.add('primary'); }
  });
  checkUpgradeConfirmed(usage.plan);

  if (storeUsageLine) {
    storeUsageLine.style.display = 'block';
    storeUsageLine.textContent = usage.max_projects != null
      ? `You've created ${usage.owned_projects} of ${usage.max_projects} collaborative projects allowed on your plan. Personal projects are unlimited.`
      : `You've created ${usage.owned_projects} collaborative projects. Your plan has no limit. Personal projects are unlimited.`;
  }
}

document.addEventListener('click', (e) => { if (e.target.closest && e.target.closest('#open-store-btn')) openStore(); });
// Shown once, only after the SERVER reports the Team plan (never on checkout click).
function checkUpgradeConfirmed(plan) {
  if (!currentUser || plan !== 'team') return;
  const k = 'mosstask:teamThanks:' + currentUser.id;
  try { if (localStorage.getItem(k)) return; localStorage.setItem(k, '1'); } catch (e) { return; }
  const el = document.getElementById('store-thanks');
  if (el) { el.style.display = 'block'; openStore(); }
}
document.getElementById('store-close-btn')?.addEventListener('click', closeStore);
if (storeOverlay) storeOverlay.addEventListener('click', (e) => { if (e.target === storeOverlay) closeStore(); });
document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && storeOverlay && storeOverlay.style.display === 'flex') closeStore(); });

document.querySelectorAll('[data-plan-btn]').forEach((btn) => {
  btn.addEventListener('click', () => {
    const plan = btn.getAttribute('data-plan-btn');
    if (plan === 'free') return; // disabled: nothing to do
    if (!currentUser || isGuest) { alert('Sign in first, then come back to upgrade.'); return; }
    const link = STRIPE_PAYMENT_LINKS[plan];
    if (!link || link.includes('REPLACE_WITH')) { alert('This plan link is not set up yet.'); return; }
    const url = new URL(link);
    url.searchParams.set('client_reference_id', currentUser.id);
    if (currentUser.email) url.searchParams.set('prefilled_email', currentUser.email);
    window.open(url.toString(), '_blank');
    // Wait for the webhook to actually flip profiles.plan before confirming anything.
    const poll = setInterval(async () => {
      const u = await dbFetchPlanUsage();
      if (u && u.plan === plan) { clearInterval(poll); refreshStoreUI(); }
    }, 5000);
    setTimeout(() => clearInterval(poll), 300000);
  });
});

function buildExportPayload() {
  return {
    app: 'MossTask',
    version: 1,
    exportedAt: new Date().toISOString(),
    todos, projects, notes, events,
    taskCategories, noteCategories,
    projectAnnouncements,
  };
}
document.getElementById('export-data-btn')?.addEventListener('click', () => {
  const blob = new Blob([JSON.stringify(buildExportPayload(), null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `mosstask-backup-${todayStr()}.json`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
  showSimpleToast({ emoji: '⬇️', text: 'Backup downloaded.' });
});

const importDataInput = document.getElementById('import-data-input');
document.getElementById('import-data-btn')?.addEventListener('click', () => importDataInput.click());
if (importDataInput) {
  importDataInput.addEventListener('change', () => {
    const file = importDataInput.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      let parsed = null;
      try { parsed = JSON.parse(reader.result); } catch (err) { parsed = null; }
      importDataInput.value = '';
      if (!parsed || typeof parsed !== 'object') {
        showSimpleToast({ emoji: '⚠️', text: "That file isn't a valid backup." });
        return;
      }
      openConfirmModal({
        title: 'Replace your data?',
        message: "Importing will replace your tasks, notes, events, categories and projects on this device with this file's contents. You'll want to be sure this is the backup you want.",
        confirmLabel: 'Import & replace',
        danger: true,
        onConfirm: () => applyImportedData(parsed),
      });
    };
    reader.readAsText(file);
  });
}

function applyImportedData(data) {
  todos = Array.isArray(data.todos) ? data.todos : [];
  projects = Array.isArray(data.projects) ? data.projects : [];
  notes = Array.isArray(data.notes) ? data.notes : [];
  events = Array.isArray(data.events) ? data.events : [];
  taskCategories = Array.isArray(data.taskCategories) ? data.taskCategories : [];
  noteCategories = Array.isArray(data.noteCategories) && data.noteCategories.length ? data.noteCategories : ['General'];
  projectAnnouncements = data.projectAnnouncements && typeof data.projectAnnouncements === 'object' ? data.projectAnnouncements : {};

  saveTodos(); saveProjects(); saveNotes(); saveEvents();
  saveTaskCategories(); saveNoteCategories(); saveProjectAnnouncements();

  if (currentUser) {
    todos.forEach((t) => dbUpsert('todos', todoRemoteRow(t)));
    projects.forEach((p) => dbUpsert('projects', projectRemoteRow(p)));
    notes.forEach((n) => dbUpsert('notes', noteRemoteRow(n)));
    events.forEach((ev) => dbUpsert('events', eventRemoteRow(ev)));
  }

  renderProjectNav(); renderProjectSelect();
  renderTodos(); renderCounts(); renderViewHeader();
  renderTaskCategorySelects();
  renderCategoryTabs(); renderNoteCategorySelect(); renderNotes();
  renderCalendar(); renderDayPanel();
  showSimpleToast({ emoji: '✅', text: 'Backup imported.' });
}

let bulkSelectMode = false;
let bulkSelectedIds = new Set();
const taskSelectToggleBtn = document.getElementById('task-select-toggle-btn');
const bulkActionBar = document.getElementById('bulk-action-bar');
const bulkCountEl = document.getElementById('bulk-count');
const bulkMoveSelect = document.getElementById('bulk-move-select');

function setBulkSelectMode(on) {
  bulkSelectMode = on;
  bulkSelectedIds.clear();
  if (taskSelectToggleBtn) taskSelectToggleBtn.classList.toggle('active', on);
  renderTodos();
  updateBulkBar();
}
if (taskSelectToggleBtn) taskSelectToggleBtn.addEventListener('click', () => setBulkSelectMode(!bulkSelectMode));

function updateBulkBar() {
  if (!bulkActionBar) return;
  if (bulkSelectMode && bulkSelectedIds.size > 0) {
    bulkActionBar.style.display = 'flex';
    bulkCountEl.textContent = `${bulkSelectedIds.size} selected`;
    const prevVal = bulkMoveSelect.value;
    bulkMoveSelect.innerHTML = '<option value="">Move to…</option><option value="__none__">No project</option>';
    projects.forEach((p) => {
      const opt = document.createElement('option');
      opt.value = p.id;
      opt.textContent = p.name;
      bulkMoveSelect.appendChild(opt);
    });
    bulkMoveSelect.value = prevVal && Array.from(bulkMoveSelect.options).some(o => o.value === prevVal) ? prevVal : '';
  } else {
    bulkActionBar.style.display = 'none';
  }
}

document.getElementById('bulk-cancel-btn')?.addEventListener('click', () => setBulkSelectMode(false));

document.getElementById('bulk-complete-btn')?.addEventListener('click', () => {
  let changed = false;
  bulkSelectedIds.forEach((id) => {
    const t = todos.find((x) => x.id === id);
    if (t && !t.done && canToggleTaskIn(t.projectId)) {
      t.done = true;
      recordCompletion();
      if (currentUser) dbUpdate('todos', t.id, { done: true });
      changed = true;
    }
  });
  if (changed) { saveTodos(); showToast('complete'); }
  setBulkSelectMode(false);
  renderCounts(); renderViewHeader(); renderProjectNav();
});

document.getElementById('bulk-delete-btn')?.addEventListener('click', () => {
  const ids = Array.from(bulkSelectedIds);
  if (!ids.length) return;
  openConfirmModal({
    title: `Delete ${ids.length} task${ids.length === 1 ? '' : 's'}?`,
    message: "They'll be removed from your list. This can't be undone from here.",
    confirmLabel: 'Delete',
    danger: true,
    onConfirm: () => {
      const removable = todos.filter((t) => ids.includes(t.id) && canRemoveTaskFrom(t.projectId));
      const removableIds = new Set(removable.map((t) => t.id));
      todos = todos.filter((t) => !removableIds.has(t.id));
      saveTodos();
      if (currentUser) removable.forEach((t) => dbDelete('todos', t.id));
      setBulkSelectMode(false);
      renderCounts(); renderViewHeader(); renderProjectNav();
      showToast('taskDeleted');
    },
  });
});

if (bulkMoveSelect) {
  bulkMoveSelect.addEventListener('change', () => {
    const val = bulkMoveSelect.value;
    if (!val) return;
    const projectId = val === '__none__' ? null : Number(val);
    bulkSelectedIds.forEach((id) => {
      const t = todos.find((x) => x.id === id);
      if (t && canRenameTaskIn(t.projectId)) {
        t.projectId = projectId;
        if (currentUser) dbUpdate('todos', t.id, { project_id: projectId });
      }
    });
    saveTodos();
    setBulkSelectMode(false);
    renderCounts(); renderViewHeader(); renderProjectNav(); renderProjectSelect();
    showToast('permission');
  });
}

function renderHomeStreak() {
  const el = document.getElementById('home-streak');
  if (!el) return;
  el.innerHTML = '';

  const title = document.createElement('div');
  title.className = 'home-widget-title';
  title.textContent = window.I18N ? window.I18N.t('widget.streak', 'Your streak') : 'Your streak';
  el.appendChild(title);

  const log = loadCompletionLog();
  const dayMs = 24 * 60 * 60 * 1000;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const totalDays = 70;

  const counts = new Map();
  log.forEach((ts) => {
    const d = new Date(ts);
    d.setHours(0, 0, 0, 0);
    const key = d.getTime();
    counts.set(key, (counts.get(key) || 0) + 1);
  });

  const startOffset = (counts.get(today.getTime()) || 0) > 0 ? 0 : 1;
  let streak = 0;
  for (let i = startOffset; i < totalDays; i++) {
    if ((counts.get(today.getTime() - i * dayMs) || 0) > 0) streak++;
    else break;
  }

  const gridWrap = document.createElement('div');
  gridWrap.className = 'home-streak-grid-wrap';

  const grid = document.createElement('div');
  grid.className = 'home-streak-grid';

  const tooltip = document.createElement('div');
  tooltip.className = 'home-streak-tooltip';
  tooltip.setAttribute('role', 'tooltip');
  tooltip.hidden = true;

  let pinnedCell = null;

  function tooltipText(key, count) {
    const dateLabel = formatAppDate(new Date(key), { month: 'short', day: 'numeric', year: 'numeric' });
    const countLabel = window.I18N
      ? window.I18N.t(count === 1 ? 'widget.streak.tasksDone_one' : 'widget.streak.tasksDone_other', '{n} tasks completed').replace('{n}', count)
      : `${count} task${count === 1 ? '' : 's'} completed`;
    return { dateLabel, countLabel };
  }

  function positionTooltip(cell) {
    tooltip.hidden = false;
    const wrapRect = gridWrap.getBoundingClientRect();
    const cellRect = cell.getBoundingClientRect();
    tooltip.style.left = '0px';
    tooltip.style.top = '-9999px';
    requestAnimationFrame(() => {
      const ttRect = tooltip.getBoundingClientRect();
      let left = (cellRect.left - wrapRect.left) + cellRect.width / 2 - ttRect.width / 2;
      left = Math.max(0, Math.min(left, wrapRect.width - ttRect.width));
      let top = (cellRect.top - wrapRect.top) - ttRect.height - 8;
      if (top < 0) top = (cellRect.bottom - wrapRect.top) + 8;
      tooltip.style.left = `${left}px`;
      tooltip.style.top = `${top}px`;
    });
  }

  function showTooltipFor(cell) {
    const key = Number(cell.dataset.key);
    const count = Number(cell.dataset.count);
    const { dateLabel, countLabel } = tooltipText(key, count);
    tooltip.innerHTML = '';
    const d = document.createElement('div');
    d.className = 'home-streak-tooltip-date';
    d.textContent = dateLabel;
    const c = document.createElement('div');
    c.className = 'home-streak-tooltip-count';
    c.textContent = countLabel;
    tooltip.append(d, c);
    positionTooltip(cell);
  }

  function hideTooltip() {
    tooltip.hidden = true;
    if (pinnedCell) pinnedCell.classList.remove('is-selected');
    pinnedCell = null;
  }

  for (let i = totalDays - 1; i >= 0; i--) {
    const key = today.getTime() - i * dayMs;
    const count = counts.get(key) || 0;
    const cell = document.createElement('button');
    cell.type = 'button';
    cell.className = 'home-streak-cell' + (count > 0 ? ' level-' + Math.min(4, count) : '');
    cell.dataset.key = String(key);
    cell.dataset.count = String(count);
    const { dateLabel, countLabel } = tooltipText(key, count);
    cell.setAttribute('aria-label', `${dateLabel}: ${countLabel}`);

    cell.addEventListener('mouseenter', () => { if (!pinnedCell) showTooltipFor(cell); });
    cell.addEventListener('mouseleave', () => { if (!pinnedCell) hideTooltip(); });
    cell.addEventListener('focus', () => showTooltipFor(cell));
    cell.addEventListener('blur', () => { if (!pinnedCell) hideTooltip(); });
    cell.addEventListener('click', (e) => {
      e.stopPropagation();
      if (pinnedCell === cell) { hideTooltip(); return; }
      if (pinnedCell) pinnedCell.classList.remove('is-selected');
      pinnedCell = cell;
      cell.classList.add('is-selected');
      showTooltipFor(cell);
    });

    grid.appendChild(cell);
  }

  gridWrap.append(grid, tooltip);
  el.appendChild(gridWrap);
  gridWrap._hideTooltip = hideTooltip;
  if (!window.__streakOutsideClickBound) {
    window.__streakOutsideClickBound = true;
    document.addEventListener('click', (e) => {
      const wrap = document.querySelector('.home-streak-grid-wrap');
      if (wrap && !wrap.contains(e.target) && wrap._hideTooltip) wrap._hideTooltip();
    });
  }

  const caption = document.createElement('p');
  caption.className = 'home-widget-caption';
  caption.textContent = streak > 0
    ? `${streak} day${streak === 1 ? '' : 's'} in a row \u2014 nice and steady.`
    : 'Complete a task today to start a new streak.';
  el.appendChild(caption);
}


// ===== Guest -> account data continuity =====
// Guest data lives in localStorage under LOCAL_DATA_KEYS (the same keys the signed-in cache uses).
// 'mosstaskLocalOwner' records whose data those keys currently hold: 'guest' or a user id.
// Rules: never delete guest data; upload is add-only (never overwrites remote rows); a ledger per
// user makes retries idempotent; a permanent guest backup is kept; local data is only replaced by
// remote data AFTER the migration is verified.
const LOCAL_DATA_KEYS = ['todos', 'projects', 'notes', 'events', 'taskCategories', 'noteCategories', 'projectAnnouncements'];
const LOCAL_OWNER_KEY = 'mosstaskLocalOwner';
const GUEST_BACKUP_KEY = 'mosstaskGuestBackup';

function readLocalWorld() {
  const w = {};
  LOCAL_DATA_KEYS.forEach(k => { const v = safeGetItem(k); if (v !== null && v !== undefined) w[k] = v; });
  return w;
}
function writeLocalWorld(w) {
  LOCAL_DATA_KEYS.forEach(k => {
    if (w && typeof w[k] === 'string') safeSetItem(k, w[k]);
    else { try { localStorage.removeItem(k); } catch (e) {} }
  });
}
function reloadInMemoryFromLocal() {
  todos = safeParse('todos', []);
  projects = safeParse('projects', []);
  notes = safeParse('notes', []);
  events = safeParse('events', []);
  taskCategories = safeParse('taskCategories', []);
  noteCategories = safeParse('noteCategories', null) || ['General'];
  projectAnnouncements = safeParse('projectAnnouncements', {});
}
function localWorldHasData() {
  return todos.length > 0 || projects.length > 0 || notes.length > 0 || events.length > 0;
}
function getMigrationLedger(uid) {
  const l = safeParse('mosstaskMigrated:' + uid, null) || {};
  ['projects', 'todos', 'notes', 'events', 'declined'].forEach(k => { if (!Array.isArray(l[k])) l[k] = []; });
  return l;
}
function saveMigrationLedger(uid, l) { safeSetItem('mosstaskMigrated:' + uid, JSON.stringify(l)); }

// Runs at the very start of initApp, before any render or remote load.
function prepareLocalStoreForSession(user) {
  let owner = safeGetItem(LOCAL_OWNER_KEY);
  if (!user) {
    // Guest session.
    if (owner && owner !== 'guest') {
      // Keys currently hold a signed-out account's cache. Keep a copy, then restore the guest world.
      safeSetItem('mosstaskAccountCache:' + owner, JSON.stringify(readLocalWorld()));
      const backup = safeParse(GUEST_BACKUP_KEY, null);
      writeLocalWorld(backup);
      reloadInMemoryFromLocal();
    }
    safeSetItem(LOCAL_OWNER_KEY, 'guest');
  }
  // Signed-in: nothing to swap here; migrateGuestDataIfNeeded handles owner === null/'guest'.
}

// Returns { ok, skipped }. ok=false => caller must NOT overwrite local data with remote data.
async function migrateGuestDataIfNeeded(user) {
  const owner = safeGetItem(LOCAL_OWNER_KEY);
  if (owner === user.id) return { ok: true };
  if (owner && owner !== 'guest') return { ok: true }; // local keys are another account's cache; existing behaviour (remote replaces it)
  if (!supabaseReady) return { ok: false };
  if (!localWorldHasData()) { safeSetItem(LOCAL_OWNER_KEY, user.id); return { ok: true }; }

  // Permanent safety copy of the guest world (kept even after a successful migration).
  safeSetItem(GUEST_BACKUP_KEY, JSON.stringify(readLocalWorld()));

  const ledger = getMigrationLedger(user.id);
  const [rp, rt, rn, re] = await Promise.all([
    dbFetchProjects(), dbFetchTodos(), dbFetchAll('notes', user.id), dbFetchAll('events', user.id),
  ]);
  if (!rp || !rt || !rn || !re) return { ok: false }; // offline/failed: keep local, retry next start

  const ids = (rows) => new Set(rows.map(r => String(r.id)));
  const remote = { projects: ids(rp), todos: ids(rt), notes: ids(rn), events: ids(re) };
  const mine = (rows) => rows.filter(r => r.user_id === user.id).length;
  const remoteHasData = mine(rp) + mine(rt) + rn.length + re.length > 0;

  const pending = (kind, list) => list.filter(x => {
    const id = String(x.id);
    return !remote[kind].has(id) && !ledger[kind].includes(id) && !ledger.declined.includes(kind + ':' + id);
  });
  const todo = {
    projects: pending('projects', projects),
    todos: pending('todos', todos),
    notes: pending('notes', notes),
    events: pending('events', events),
  };
  const total = todo.projects.length + todo.todos.length + todo.notes.length + todo.events.length;
  if (total === 0) { safeSetItem(LOCAL_OWNER_KEY, user.id); return { ok: true }; }

  // Existing account that already has data: never merge silently.
  if (remoteHasData && !ledger.started) {
    const add = confirm('This account already has data. Add your Guest Mode data to it?\n\nNothing in the account will be overwritten or deleted. Either way, your guest data stays saved on this device.');
    if (!add) {
      Object.keys(todo).forEach(k => todo[k].forEach(x => ledger.declined.push(k + ':' + String(x.id))));
      ledger.started = true; saveMigrationLedger(user.id, ledger);
      safeSetItem(LOCAL_OWNER_KEY, user.id);
      return { ok: true };
    }
  }
  ledger.started = true; saveMigrationLedger(user.id, ledger);

  // Guest projects become the account's Personal projects (no members, no assignees).
  const projRows = todo.projects.map(p => ({ ...projectRemoteRow({ ...p, userId: user.id, type: 'personal' }) }));
  const todoRows = todo.todos.map(t => todoRemoteRow({ ...t, assigneeEmail: null }));
  const noteRows = todo.notes.map(noteRemoteRow);
  const eventRows = todo.events.map(eventRemoteRow);

  const steps = [['projects', projRows], ['todos', todoRows], ['notes', noteRows], ['events', eventRows]];
  for (const [table, rows] of steps) {
    if (!rows.length) continue;
    const { error } = await dbUpsert(table, rows); // add-only: ids missing remotely (and not in ledger)
    if (error) { console.warn('[Migrate] upload failed:', table, error.message); return { ok: false, error }; }
  }

  // Verify every uploaded id is now visible before trusting the migration.
  const [vp, vt, vn, ve] = await Promise.all([
    dbFetchProjects(), dbFetchTodos(), dbFetchAll('notes', user.id), dbFetchAll('events', user.id),
  ]);
  if (!vp || !vt || !vn || !ve) return { ok: false };
  const seen = { projects: ids(vp), todos: ids(vt), notes: ids(vn), events: ids(ve) };
  for (const k of Object.keys(todo)) {
    if (todo[k].some(x => !seen[k].has(String(x.id)))) return { ok: false };
    todo[k].forEach(x => ledger[k].push(String(x.id)));
  }
  saveMigrationLedger(user.id, ledger);
  safeSetItem(LOCAL_OWNER_KEY, user.id);
  return { ok: true, migrated: total };
}

window.initApp = async function initApp(user) {
  currentUser = user || null;
  prepareLocalStoreForSession(currentUser);

  applyTheme(getTheme());
  renderSettingsUI();
  renderProjectNav();
  renderProjectSelect();
  renderTodos();
  renderCounts();
  renderViewHeader();
  updateTaskFormForView();
  renderTaskCategorySelects();
  tipsBarEl.style.display = areTipsEnabled() ? 'flex' : 'none';
  refreshTip();

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

  markLoadingReady();

  setLoadingStage(supabaseReady ? 'Syncing…' : 'Starting locally…');

  let migration = { ok: true };
  if (currentUser) {
    setLoadingStage('Bringing your data into your account…');
    try { migration = await migrateGuestDataIfNeeded(currentUser); }
    catch (e) { console.warn('[Migrate] threw:', e && e.message); migration = { ok: false }; }
    if (!migration.ok) showSimpleToast({ emoji: '⚠️', text: "Couldn't sync your guest data yet. It's safe on this device and will retry next time." });
  }

  if (currentUser) {
    let [remoteTodos, remoteNotes, remoteEvents, remoteProjects, remoteMembers, remoteNotifs] = await Promise.all([
      dbFetchTodos(),
      dbFetchAll('notes', currentUser.id),
      dbFetchAll('events', currentUser.id),
      dbFetchProjects(),
      dbFetchProjectMembers(),
      dbFetchNotifications(),
    ]);

    // Failed migration: keep local guest data untouched instead of replacing it with (empty) remote data.
    if (!migration.ok) { remoteProjects = remoteTodos = remoteNotes = remoteEvents = null; }
    if (remoteProjects) {
      projects = remoteProjects.map(p => ({ id: p.id, name: p.name, userId: p.user_id, type: p.project_type === 'team' ? 'team' : 'personal', membersCanSetRole: !!p.members_can_set_role, announcement: p.announcement || '', announcementUpdatedAt: p.announcement_updated_at || null, description: p.description || '' }));
      saveProjects();
    }
    if (remoteTodos) {
      const localCategoryById = new Map(todos.map(t => [String(t.id), t.category || null]));
      todos = remoteTodos.map(t => ({
        id: t.id, text: t.text, desc: t.desc, done: t.done,
        due: t.due, priority: t.priority, projectId: t.project_id || null,
        category: t.category != null ? t.category : (localCategoryById.get(String(t.id)) || null),
        timeSpentSec: t.time_spent_sec || 0,
        subtasks: t.subtasks || [],
        recurrence: t.recurrence || null,
        reminderTime: t.reminder_time || null,
        pinned: !!t.pinned,
        assigneeEmail: t.assignee_email || null,
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

    await loadProfile();

    renderProjectNav();
    renderProjectSelect();
    renderTodos();
    renderCounts();
    renderViewHeader();
    renderTaskCategorySelects();
    deferRenderHiddenViews();
  } else {
    projectMembers = [];
    notifications = [];
    currentProfile = null;
    await loadProfile();
  }

  renderCollabPanel();
  updateCollabFabVisibility();
  renderNotifBadge();
  renderNotifList();

  setTimeout(maybeAutoOpenCloseout, 4000);
  requestNotifPermissionIfNeeded();
  if (window.MossNotify) MossNotify.refreshDeliveryState().then(scheduleReminderSync);
  checkEventNotifications();
  attachRealtimeSubscriptions();

  runWelcomeGuideFlow({ forced: false });
  try {
    if (currentUser && sessionStorage.getItem('mosstaskResumeTeamProject') === '1') {
      sessionStorage.removeItem('mosstaskResumeTeamProject');
      setTimeout(() => openProjectModal(null, 'team'), 400);
    }
  } catch (e) {}
};