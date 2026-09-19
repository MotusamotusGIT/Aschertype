// src/utils.js
// Classic script — attaches everything to window. No ESM exports.

function isPlausibleEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

const RL_KEY = 'aschertypeRateLimits';

function loadRateLimitState() {
  try { return JSON.parse(localStorage.getItem(RL_KEY) || '{}'); }
  catch (err) { return {}; }
}
function saveRateLimitState(state) {
  try { localStorage.setItem(RL_KEY, JSON.stringify(state)); } catch (err) {}
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
    } catch (err) {}
  },
  removeItem(key) {
    try { localStorage.removeItem(key); } catch (err) {}
    try { sessionStorage.removeItem(key); } catch (err) {}
  },
};

const SUPABASE_SESSION_KEY = 'sb-tjjzeetbsxnkrgoiagbf-auth-token';
const secureCache = new Map();
let secureCacheHydrated = false;
let secureStorageReadyResolve = null;
const secureStorageReady = new Promise((resolve) => { secureStorageReadyResolve = resolve; });

async function hydrateSecureCache(keys) {
  if (typeof window === 'undefined' || !window.electronAPI || !window.electronAPI.secureStore) {
    secureCacheHydrated = true;
    if (secureStorageReadyResolve) secureStorageReadyResolve();
    return;
  }
  await Promise.all(keys.map(async (key) => {
    const value = await window.electronAPI.secureStore.get(key);
    if (value !== null && value !== undefined) secureCache.set(key, value);
  }));
  secureCacheHydrated = true;
  if (secureStorageReadyResolve) secureStorageReadyResolve();
}

if (typeof window !== 'undefined') {
  hydrateSecureCache([SUPABASE_SESSION_KEY]);
}

const electronSecureStorage = {
  getItem(key) {
    if (!secureCacheHydrated) return null;
    const value = secureCache.get(key);
    return value === undefined ? null : value;
  },
  setItem(key, value) {
    secureCache.set(key, value);
    if (typeof window !== 'undefined' && window.electronAPI && window.electronAPI.secureStore) {
      window.electronAPI.secureStore.set(key, value).catch((err) => {
        console.error('[secure-store] persist failed:', err);
      });
    }
  },
  removeItem(key) {
    secureCache.delete(key);
    if (typeof window !== 'undefined' && window.electronAPI && window.electronAPI.secureStore) {
      window.electronAPI.secureStore.remove(key).catch((err) => {
        console.error('[secure-store] remove failed:', err);
      });
    }
  },
};

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
  window.electronSecureStorage = electronSecureStorage;
  window.secureStorageReady = secureStorageReady;
}