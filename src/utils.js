// src/utils.js — full file
// ===== Shared pure helpers =====
// Extracted from auth.js and db.js so tests can import them without
// booting the whole app. Loaded as a classic <script>, so everything
// lives in global scope and auth.js / db.js call these directly.

// ----- Email sanity check -----
function isPlausibleEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

// ----- Rate limiter -----
const RL_KEY = 'aschertypeRateLimits';

function loadRateLimitState() {
  try { return JSON.parse(localStorage.getItem(RL_KEY) || '{}'); }
  catch (err) { return {}; }
}
function saveRateLimitState(state) {
  try { localStorage.setItem(RL_KEY, JSON.stringify(state)); } catch (err) { /* ignore */ }
}
function pruneHistory(history, windowMs) {
  const now = Date.now();
  return history.filter((ts) => now - ts < windowMs);
}
function checkRateLimit(actionKey, limit, windowMs) {
  const state = loadRateLimitState();
  const entry = state[actionKey] || { history: [], failStreak: 0, lockUntil: 0 };
  const now = Date.now();
  if (entry.lockUntil && now < entry.lockUntil) {
    return { limited: true, waitMs: entry.lockUntil - now };
  }
  entry.history = pruneHistory(entry.history, windowMs);
  if (entry.history.length >= limit) {
    return { limited: true, waitMs: windowMs - (now - entry.history[0]) };
  }
  return { limited: false, waitMs: 0 };
}
function recordAttempt(actionKey, windowMs) {
  const state = loadRateLimitState();
  const entry = state[actionKey] || { history: [], failStreak: 0, lockUntil: 0 };
  entry.history = pruneHistory(entry.history, windowMs);
  entry.history.push(Date.now());
  state[actionKey] = entry;
  saveRateLimitState(state);
}
function recordFailure(actionKey) {
  const state = loadRateLimitState();
  const entry = state[actionKey] || { history: [], failStreak: 0, lockUntil: 0 };
  entry.failStreak = (entry.failStreak || 0) + 1;
  if (entry.failStreak >= 3) {
    const backoffSec = Math.min(30 * Math.pow(2, entry.failStreak - 3), 600);
    entry.lockUntil = Date.now() + backoffSec * 1000;
  }
  state[actionKey] = entry;
  saveRateLimitState(state);
}
function recordSuccess(actionKey) {
  const state = loadRateLimitState();
  state[actionKey] = { history: [], failStreak: 0, lockUntil: 0 };
  saveRateLimitState(state);
}
function formatWait(ms) {
  const s = Math.ceil(ms / 1000);
  if (s < 60) return `${s} second${s === 1 ? '' : 's'}`;
  return `${Math.ceil(s / 60)} minute${Math.ceil(s / 60) === 1 ? '' : 's'}`;
}

// ----- Remember-session preference -----
const REMEMBER_KEY = 'aschertypeRememberSession';

function getRememberPreference() {
  const v = localStorage.getItem(REMEMBER_KEY);
  return v === null ? true : v === 'true';
}
function setRememberPreference(remember) {
  localStorage.setItem(REMEMBER_KEY, remember ? 'true' : 'false');
}

const rememberAwareStorage = {
  getItem(key) {
    try {
      const store = getRememberPreference() ? localStorage : sessionStorage;
      const val = store.getItem(key);
      if (val !== null) return val;
      const other = getRememberPreference() ? sessionStorage : localStorage;
      return other.getItem(key);
    } catch (err) { return null; }
  },
  setItem(key, value) {
    try {
      const store = getRememberPreference() ? localStorage : sessionStorage;
      store.setItem(key, value);
    } catch (err) { /* ignore */ }
  },
  removeItem(key) {
    try { localStorage.removeItem(key); } catch (err) { /* ignore */ }
    try { sessionStorage.removeItem(key); } catch (err) { /* ignore */ }
  },
};

// ----- Expose helpers on window for classic scripts + tests -----
if (typeof window !== 'undefined') {
  window.isPlausibleEmail = isPlausibleEmail;
  window.formatWait = formatWait;
  window.checkRateLimit = checkRateLimit;
  window.recordAttempt = recordAttempt;
  window.recordFailure = recordFailure;
  window.recordSuccess = recordSuccess;
  window.loadRateLimitState = loadRateLimitState;
  window.getRememberPreference = getRememberPreference;
  window.setRememberPreference = setRememberPreference;
  window.rememberAwareStorage = rememberAwareStorage;
}

// ----- Dual-mode export for tests -----
if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    isPlausibleEmail,
    formatWait,
    checkRateLimit,
    recordAttempt,
    recordFailure,
    recordSuccess,
    loadRateLimitState,
    getRememberPreference,
    setRememberPreference,
    rememberAwareStorage,
  };
}