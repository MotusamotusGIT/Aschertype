// utils.js — full replacement

// src/utils.js
// Classic script — attaches everything to window. No ESM exports.

function isPlausibleEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

async function checkPasswordPwned(password) {
  try {
    const encoder = new TextEncoder();
    const data = encoder.encode(password);
    const hashBuffer = await crypto.subtle.digest('SHA-1', data);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    const hashHex = hashArray.map((b) => b.toString(16).padStart(2, '0')).join('').toUpperCase();
    const prefix = hashHex.slice(0, 5);
    const suffix = hashHex.slice(5);

    const res = await fetch(`https://api.pwnedpasswords.com/range/${prefix}`, {
      headers: { 'Add-Padding': 'true' },
    });
    if (!res.ok) return { checked: false, pwned: false, count: 0 };

    const text = await res.text();
    const lines = text.split('\n');
    for (const line of lines) {
      const [lineSuffix, countStr] = line.trim().split(':');
      if (lineSuffix === suffix) {
        return { checked: true, pwned: true, count: parseInt(countStr, 10) || 0 };
      }
    }
    return { checked: true, pwned: false, count: 0 };
  } catch (err) {
    console.warn('[PwnedCheck] Check failed, allowing submission:', err.message);
    return { checked: false, pwned: false, count: 0 };
  }
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

const pendingWrites = new Set();

const electronSecureStorage = {
  getItem(key) {
    if (!secureCacheHydrated) return null;
    if (!getRememberPreference()) return null;
    const value = secureCache.get(key);
    return value === undefined ? null : value;
  },
  setItem(key, value) {
    if (!getRememberPreference()) {
      secureCache.set(key, value);
      return;
    }
    secureCache.set(key, value);
    if (typeof window !== 'undefined' && window.electronAPI && window.electronAPI.secureStore) {
      const p = window.electronAPI.secureStore.set(key, value)
        .catch((err) => console.error('[secure-store] persist failed:', err))
        .finally(() => pendingWrites.delete(p));
      pendingWrites.add(p);
    }
  },
  removeItem(key) {
    secureCache.delete(key);
    if (typeof window !== 'undefined' && window.electronAPI && window.electronAPI.secureStore) {
      const p = window.electronAPI.secureStore.remove(key)
        .catch((err) => console.error('[secure-store] remove failed:', err))
        .finally(() => pendingWrites.delete(p));
      pendingWrites.add(p);
    }
  },
};

async function flushSecureWrites() {
  await Promise.allSettled([...pendingWrites]);
}

if (typeof window !== 'undefined') {
  window.isPlausibleEmail = isPlausibleEmail;
  window.checkPasswordPwned = checkPasswordPwned;
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
  window.flushSecureWrites = flushSecureWrites;

  if (window.electronAPI && window.electronAPI.onFlushRequest) {
    window.electronAPI.onFlushRequest(async () => {
      await flushSecureWrites();
      window.electronAPI.flushComplete();
    });
  }
}