// ===== Supabase client & data-access helpers =====
// getRememberPreference / setRememberPreference / rememberAwareStorage
// now live in utils.js (loaded before this file by loader.js).

let supabaseClient = null;
let supabaseReady = false;

(function initSupabaseClient() {
  const configured =
    typeof SUPABASE_URL === 'string' &&
    typeof SUPABASE_ANON_KEY === 'string' &&
    SUPABASE_URL.indexOf('YOUR-PROJECT-REF') === -1 &&
    SUPABASE_ANON_KEY.indexOf('YOUR-ANON-PUBLIC-KEY') === -1;

  if (!configured) return;
  if (typeof window.supabase === 'undefined') {
    console.warn('[Supabase] SDK did not load from the CDN — falling back to local-only mode.');
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

async function dbFetchAll(table, userId) {
  if (!supabaseReady) return null;
  const { data, error } = await supabaseClient.from(table).select('*').eq('user_id', userId);
  if (error) { reportSyncError(table, 'load', error.message); return null; }
  return data;
}

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

// ===== Realtime channel =====
let realtimeChannel = null;

function setupRealtime(handlers) {
  if (!supabaseReady || !supabaseClient) return null;
  teardownRealtime();

  const wrap = (name, fn) => (payload) => {
    try { if (typeof fn === 'function') fn(payload); }
    catch (err) { console.warn(`[Realtime] ${name} handler threw:`, err); }
  };

  realtimeChannel = supabaseClient
    .channel('aschertype-realtime')
    .on('postgres_changes',
        { event: '*', schema: 'public', table: 'todos' },
        wrap('todos', handlers.onTodo))
    .on('postgres_changes',
        { event: '*', schema: 'public', table: 'projects' },
        wrap('projects', handlers.onProject))
    .on('postgres_changes',
        { event: '*', schema: 'public', table: 'project_members' },
        wrap('project_members', handlers.onMember))
    .on('postgres_changes',
        { event: '*', schema: 'public', table: 'notifications' },
        wrap('notifications', handlers.onNotification))
    .on('postgres_changes',
        { event: '*', schema: 'public', table: 'notes' },
        wrap('notes', handlers.onNote))
    .on('postgres_changes',
        { event: '*', schema: 'public', table: 'events' },
        wrap('events', handlers.onEvent))
    .subscribe((status) => {
      if (status === 'SUBSCRIBED') console.log('[Realtime] connected');
      else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
        console.warn('[Realtime] subscription problem:', status);
      }
    });

  return realtimeChannel;
}

function teardownRealtime() {
  if (realtimeChannel && supabaseClient) {
    try { supabaseClient.removeChannel(realtimeChannel); } catch (e) { /* ignore */ }
  }
  realtimeChannel = null;
}