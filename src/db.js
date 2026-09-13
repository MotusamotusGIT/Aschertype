// ===== Supabase client & data-access helpers =====
// If supabase-config.js still has the placeholder values (or the
// CDN script failed to load, e.g. no internet), the app falls back
// to local-only mode automatically — everything keeps working with
// localStorage, it just won't sync to an account.

let supabaseClient = null;
let supabaseReady = false;

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
    supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
    supabaseReady = true;
  } catch (err) {
    console.error('[Supabase] Failed to initialize client:', err);
  }
})();

// ----- Generic table helpers, each scoped to the signed-in user -----
async function dbFetchAll(table, userId) {
  if (!supabaseReady) return null;
  const { data, error } = await supabaseClient.from(table).select('*').eq('user_id', userId);
  if (error) { console.error(`[Supabase] fetch ${table} failed:`, error.message); return null; }
  return data;
}

async function dbUpsert(table, row) {
  if (!supabaseReady) return;
  const { error } = await supabaseClient.from(table).upsert(row);
  if (error) console.error(`[Supabase] upsert ${table} failed:`, error.message);
}

async function dbDelete(table, id, userId) {
  if (!supabaseReady) return;
  const { error } = await supabaseClient.from(table).delete().eq('id', id).eq('user_id', userId);
  if (error) console.error(`[Supabase] delete ${table} failed:`, error.message);
}

async function dbDeleteWhere(table, userId, matchExtra) {
  if (!supabaseReady) return;
  let query = supabaseClient.from(table).delete().eq('user_id', userId);
  Object.entries(matchExtra || {}).forEach(([key, value]) => { query = query.eq(key, value); });
  const { error } = await query;
  if (error) console.error(`[Supabase] bulk delete ${table} failed:`, error.message);
}