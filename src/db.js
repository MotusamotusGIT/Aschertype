// ===== Supabase client & data-access helpers =====
let supabaseClient = null;
let supabaseReady = false;

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

(function initSupabaseClient() {
  const configured =
    typeof SUPABASE_URL === 'string' &&
    typeof SUPABASE_ANON_KEY === 'string' &&
    SUPABASE_URL.indexOf('YOUR-PROJECT-REF') === -1 &&
    SUPABASE_ANON_KEY.indexOf('YOUR-ANON-PUBLIC-KEY') === -1;

  if (!configured) return;
  if (typeof window.supabase === 'undefined') {
    // Your SUPABASE_URL / SUPABASE_ANON_KEY look real, so this isn't a
    // config problem — the Supabase SDK script tag
    // (cdn.jsdelivr.net/npm/@supabase/supabase-js) just never loaded
    // before this ran. Usually offline testing, an ad/script blocker,
    // or a network hiccup. The app falls back to local-only mode
    // silently otherwise, which is why the "not configured" message
    // is misleading — nothing to fix in schema.sql for this.
    console.warn('[Supabase] SDK did not load from the CDN — falling back to local-only mode. Check your network connection or any script/ad blockers.');
    return;
  }

  try {
    supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      auth: { persistSession: true, autoRefreshToken: true, storage: rememberAwareStorage },
    });
    supabaseReady = true;
  } catch (err) {
    console.error('[Supabase] Failed to initialize client:', err);
  }
})();

function reportSyncError(table, action, message) {
  console.error(`[Supabase] ${action} ${table} failed:`, message);
  if (typeof window !== 'undefined' && typeof window.onSyncError === 'function') {
    window.onSyncError(table, action, message);
  }
}

// ----- Personal -----
async function dbFetchAll(table, userId) {
  if (!supabaseReady) return null;
  const { data, error } = await supabaseClient.from(table).select('*').eq('user_id', userId);
  if (error) { reportSyncError(table, 'load', error.message); return null; }
  return data;
}

// ----- Shared -----
async function dbFetchProjects() {
  if (!supabaseReady) return null;
  const { data, error } = await supabaseClient.from('projects').select('*').order('id', { ascending: true });
  if (error) { reportSyncError('projects', 'load', error.message); return null; }
  return data;
}

async function dbFetchTodos() {
  if (!supabaseReady) return null;
  const { data, error } = await supabaseClient.from('todos').select('*');
  if (error) { reportSyncError('todos', 'load', error.message); return null; }
  return data;
}

async function dbFetchProjectMembers() {
  if (!supabaseReady) return null;
  const { data, error } = await supabaseClient.from('project_members').select('*').order('created_at', { ascending: true });
  if (error) { reportSyncError('project_members', 'load', error.message); return null; }
  return data;
}

async function dbFetchNotifications() {
  if (!supabaseReady) return null;
  const { data, error } = await supabaseClient
    .from('notifications')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(60);
  if (error) { reportSyncError('notifications', 'load', error.message); return null; }
  return data;
}

async function dbMarkNotificationRead(id) {
  if (!supabaseReady) return;
  const { error } = await supabaseClient.from('notifications').update({ read: true }).eq('id', id);
  if (error) console.warn('[Notif] mark read failed:', error.message);
}

async function dbUpsertProjectMember(row) {
  if (!supabaseReady) return { error: { message: 'Not connected' } };
  const { error } = await supabaseClient
    .from('project_members')
    .upsert(row, { onConflict: 'project_id,member_email' });
  if (error) reportSyncError('project_members', 'invite', error.message);
  return { error };
}

async function dbUpdateProjectMember(id, patch) {
  if (!supabaseReady) return { error: { message: 'Not connected' } };
  const { error } = await supabaseClient.from('project_members').update(patch).eq('id', id);
  if (error) reportSyncError('project_members', 'update', error.message);
  return { error };
}

async function dbDeleteProjectMember(id) {
  if (!supabaseReady) return { error: { message: 'Not connected' } };
  const { error } = await supabaseClient.from('project_members').delete().eq('id', id);
  if (error) reportSyncError('project_members', 'remove', error.message);
  return { error };
}

async function dbRespondToInvite(memberRowId, accept) {
  if (!supabaseReady) return { error: { message: 'Not connected' } };
  const fn = accept ? 'accept_project_invite' : 'decline_project_invite';
  const { error } = await supabaseClient.rpc(fn, { p_member_id: memberRowId });
  if (error) reportSyncError('project_members', accept ? 'accept' : 'decline', error.message);
  return { error };
}

// ----- Profile -----
async function dbFetchMyProfile() {
  if (!supabaseReady) return null;
  const { data: { user } } = await supabaseClient.auth.getUser();
  if (!user) return null;
  const { data, error } = await supabaseClient.from('profiles').select('*').eq('id', user.id).maybeSingle();
  if (error) { reportSyncError('profiles', 'load', error.message); return null; }
  return data;
}

async function dbUpsertMyProfile(row) {
  if (!supabaseReady) return { error: { message: 'Not connected' } };
  const { error } = await supabaseClient.from('profiles').upsert(row);
  if (error) reportSyncError('profiles', 'save', error.message);
  return { error };
}

// ----- Generic writes -----
async function dbUpsert(table, row) {
  if (!supabaseReady) return;
  const { error } = await supabaseClient.from(table).upsert(row);
  if (error) reportSyncError(table, 'save', error.message);
}

async function dbUpdate(table, id, patch) {
  if (!supabaseReady) return;
  const { error } = await supabaseClient.from(table).update(patch).eq('id', id);
  if (error) reportSyncError(table, 'update', error.message);
}

async function dbDelete(table, id, userId) {
  if (!supabaseReady) return;
  let q = supabaseClient.from(table).delete().eq('id', id);
  if (userId) q = q.eq('user_id', userId);
  const { error } = await q;
  if (error) reportSyncError(table, 'delete', error.message);
}

async function dbDeleteWhere(table, userId, matchExtra) {
  if (!supabaseReady) return;
  let query = supabaseClient.from(table).delete().eq('user_id', userId);
  Object.entries(matchExtra || {}).forEach(([key, value]) => { query = query.eq(key, value); });
  const { error } = await query;
  if (error) reportSyncError(table, 'bulk delete', error.message);
}