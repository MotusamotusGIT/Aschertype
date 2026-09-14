// ===== Supabase client & data-access helpers =====
// If supabase-config.js still has the placeholder values (or the
// CDN script failed to load, e.g. no internet), the app falls back
// to local-only mode automatically — everything keeps working with
// localStorage, it just won't sync to an account.

let supabaseClient = null;
let supabaseReady = false;

// ----- Remember-me aware storage adapter -----
// Previously "forget session" was implemented by writing the session to
// localStorage like every other login, then trying to sign out on
// `beforeunload`. That event is unreliable on mobile: browsers and PWAs
// routinely suspend/kill the page (backgrounding, swipe-to-close, OS
// memory pressure) without ever firing it, so the sign-out never ran.
// That's what caused the reported mobile bug: the login screen would
// reappear (or a session would linger) inconsistently depending on how
// the app happened to be closed.
//
// The fix is to decide storage *before* the token is ever written: if
// "remember me" is on, the session lives in localStorage (survives
// closing/reopening the app); if off, it lives in sessionStorage
// (cleared automatically when that browsing session ends — no timing
// races, no reliance on an event that mobile browsers may never fire).
// The preference flag itself always lives in localStorage so we know
// which backing store to read the next time the app launches.
const REMEMBER_KEY = 'aschertypeRememberSession';

function getRememberPreference() {
  const v = localStorage.getItem(REMEMBER_KEY);
  return v === null ? true : v === 'true'; // default: remember
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
      // Fall back to the other store once, so a live session is never
      // lost just because the preference changed mid-session.
      const other = getRememberPreference() ? sessionStorage : localStorage;
      return other.getItem(key);
    } catch (err) {
      return null;
    }
  },
  setItem(key, value) {
    try {
      const store = getRememberPreference() ? localStorage : sessionStorage;
      store.setItem(key, value);
    } catch (err) { /* storage unavailable (private mode etc.) — ignore */ }
  },
  removeItem(key) {
    try { localStorage.removeItem(key); } catch (err) { /* ignore */ }
    try { sessionStorage.removeItem(key); } catch (err) { /* ignore */ }
  },
};

(function initSupabaseClient() {
  const configured =
    typeof SUPABASE_URL === 'string' &&
    typeof SUPABASE_ANON_KEY === 'string' &&
    SUPABASE_URL.indexOf('YOUR-PROJECT-REF') === -1 &&
    SUPABASE_ANON_KEY.indexOf('YOUR-ANON-PUBLIC-KEY') === -1;

  if (!configured) {
    console.warn('[Supabase] Not configured yet — running in local-only mode. Fill in supabase-config.js to enable accounts.');
    return;
  }
  if (typeof window.supabase === 'undefined') {
    console.warn('[Supabase] Client library did not load — running in local-only mode.');
    return;
  }
  try {
    supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        storage: rememberAwareStorage,
      },
    });
    supabaseReady = true;
  } catch (err) {
    console.error('[Supabase] Failed to initialize client:', err);
  }
})();

// ----- Generic table helpers, each scoped to the signed-in user -----
function reportSyncError(table, action, message) {
  console.error(`[Supabase] ${action} ${table} failed:`, message);
  if (typeof window !== 'undefined' && typeof window.onSyncError === 'function') {
    window.onSyncError(table, action, message);
  }
}

async function dbFetchAll(table, userId) {
  if (!supabaseReady) return null;
  const { data, error } = await supabaseClient.from(table).select('*').eq('user_id', userId);
  if (error) { reportSyncError(table, 'load', error.message); return null; }
  return data;
}

async function dbUpsert(table, row) {
  if (!supabaseReady) return;
  const { error } = await supabaseClient.from(table).upsert(row);
  if (error) reportSyncError(table, 'save', error.message);
}

async function dbDelete(table, id, userId) {
  if (!supabaseReady) return;
  const { error } = await supabaseClient.from(table).delete().eq('id', id).eq('user_id', userId);
  if (error) reportSyncError(table, 'delete', error.message);
}

async function dbDeleteWhere(table, userId, matchExtra) {
  if (!supabaseReady) return;
  let query = supabaseClient.from(table).delete().eq('user_id', userId);
  Object.entries(matchExtra || {}).forEach(([key, value]) => { query = query.eq(key, value); });
  const { error } = await query;
  if (error) reportSyncError(table, 'bulk delete', error.message);
}