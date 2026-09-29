// teamchat.js — lazy-loaded (renderer.js injects it the first time a Project's TeamChat tab opens).
// One bootstrap RPC (status + people + latest page), one realtime channel only while the chat is
// open, append-only rendering, text-only (textContent) message output.
(function () {
  const PAGE = 30;
  const MAX_LEN = 2000;
  const GROUP_MS = 5 * 60000;
  let gen = 0;
  let st = null;

  const $ = (id) => document.getElementById(id);
  const listEl = () => $('teamchat-list');
  const inputEl = () => $('teamchat-input');

  function uuid() {
    if (window.crypto && crypto.randomUUID) return crypto.randomUUID();
    const b = new Uint8Array(16); crypto.getRandomValues(b);
    b[6] = (b[6] & 0x0f) | 0x40; b[8] = (b[8] & 0x3f) | 0x80;
    const h = Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');
    return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
  }

  function setBanner(text) {
    const el = $('teamchat-banner'); if (!el) return;
    el.textContent = text || ''; el.hidden = !text;
  }
  function setNotice(text, actionLabel, onAction) {
    const el = $('teamchat-notice'); if (!el) return;
    el.textContent = '';
    if (!text) { el.hidden = true; return; }
    const p = document.createElement('p'); p.textContent = text; el.appendChild(p);
    if (actionLabel) {
      const b = document.createElement('button');
      b.type = 'button'; b.className = 'btn small primary'; b.textContent = actionLabel;
      b.addEventListener('click', onAction); el.appendChild(b);
    }
    el.hidden = false;
  }
  function setComposerEnabled(on) {
    const form = $('teamchat-form'); if (form) form.hidden = !on;
  }
  function showListMessage(text) {
    const l = listEl(); if (!l) return;
    l.textContent = '';
    const p = document.createElement('p'); p.className = 'teamchat-empty'; p.textContent = text; l.appendChild(p);
  }

  function nameOf(id) {
    if (currentUser && id === currentUser.id) return 'You';
    const p = st && st.people.get(id);
    if (!p) return 'Team member';
    return p.name;
  }
  function roleOf(id) {
    const p = st && st.people.get(id);
    if (!p) return '';
    return p.owner ? 'Owner' : (p.role || '');
  }
  function fmtTime(iso) {
    const d = new Date(iso); if (isNaN(d)) return '';
    const t = d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
    return d.toDateString() === new Date().toDateString() ? t : d.toLocaleDateString([], { month: 'short', day: 'numeric' }) + ' ' + t;
  }
  const ts = (m) => new Date(m.created_at).getTime();

  function buildNode(m, prev) {
    const own = currentUser && m.sender_id === currentUser.id;
    const head = !prev || prev.sender_id !== m.sender_id || ts(m) - ts(prev) > GROUP_MS;
    const node = document.createElement('div');
    node.className = 'tc-msg' + (own ? ' own' : '') + (head ? ' head' : '');
    node.dataset.id = m.id;

    if (head) {
      const meta = document.createElement('div'); meta.className = 'tc-meta';
      const nm = document.createElement('span'); nm.className = 'tc-name'; nm.textContent = nameOf(m.sender_id);
      meta.appendChild(nm);
      const role = roleOf(m.sender_id);
      if (role) { const r = document.createElement('span'); r.className = 'tc-role'; r.textContent = role; meta.appendChild(r); }
      const t = document.createElement('time'); t.className = 'tc-time'; t.dateTime = m.created_at; t.textContent = fmtTime(m.created_at);
      meta.appendChild(t);
      node.appendChild(meta);
    }

    const bubble = document.createElement('div'); bubble.className = 'tc-bubble';
    const text = document.createElement('span'); text.className = 'tc-text'; text.textContent = m.content; // never innerHTML
    bubble.appendChild(text);
    if (m.edited_at) { const e = document.createElement('span'); e.className = 'tc-edited'; e.textContent = ' (edited)'; bubble.appendChild(e); }
    node.appendChild(bubble);

    if (m._state === 'sending') {
      const s = document.createElement('div'); s.className = 'tc-status'; s.textContent = 'Sending…'; node.appendChild(s);
    } else if (m._state === 'failed') {
      const s = document.createElement('div'); s.className = 'tc-status failed';
      s.append('Not sent · ');
      const b = document.createElement('button'); b.type = 'button'; b.className = 'tc-link'; b.textContent = 'Retry';
      b.addEventListener('click', () => doInsert(m)); s.appendChild(b); node.appendChild(s);
    } else if (own || st.isOwner) {
      const a = document.createElement('div'); a.className = 'tc-actions';
      if (own) {
        const e = document.createElement('button'); e.type = 'button'; e.className = 'tc-link'; e.textContent = 'Edit';
        e.addEventListener('click', () => startEdit(m, node)); a.appendChild(e);
      }
      const d = document.createElement('button'); d.type = 'button'; d.className = 'tc-link'; d.textContent = 'Delete';
      d.addEventListener('click', () => removeMsg(m)); a.appendChild(d);
      node.appendChild(a);
    }
    return node;
  }

  function prevOf(m) { const i = st.messages.indexOf(m); return i > 0 ? st.messages[i - 1] : null; }
  function refreshNode(m) {
    if (!st) return;
    const old = listEl().querySelector(`[data-id="${CSS.escape(m.id)}"]`);
    if (old) old.replaceWith(buildNode(m, prevOf(m)));
  }
  function renderAll() {
    const l = listEl(); l.textContent = '';
    if (st.hasMore) {
      const b = document.createElement('button'); b.type = 'button'; b.className = 'tc-more'; b.id = 'teamchat-more';
      b.textContent = 'Load earlier messages'; b.addEventListener('click', loadOlder); l.appendChild(b);
    }
    if (!st.messages.length) { const p = document.createElement('p'); p.className = 'teamchat-empty'; p.textContent = 'No messages yet. Say hello to your team.'; l.appendChild(p); return; }
    const frag = document.createDocumentFragment();
    st.messages.forEach((m, i) => frag.appendChild(buildNode(m, i ? st.messages[i - 1] : null)));
    l.appendChild(frag);
  }
  function nearBottom() { const l = listEl(); return l.scrollHeight - l.scrollTop - l.clientHeight < 80; }
  function scrollBottom() { const l = listEl(); l.scrollTop = l.scrollHeight; }
  function appendMsg(m, force) {
    const l = listEl();
    const stick = force || nearBottom();
    const empty = l.querySelector('.teamchat-empty'); if (empty) empty.remove();
    l.appendChild(buildNode(m, st.messages.length > 1 ? st.messages[st.messages.length - 2] : null));
    if (stick) scrollBottom();
  }

  function normalize(r) {
    return { id: r.id, sender_id: r.sender_id, content: r.content, created_at: r.created_at, edited_at: r.edited_at || null, _state: 'sent' };
  }
  function addServerMsg(r) {
    if (!r || r.deleted_at) return;
    const ex = st.byId.get(r.id);
    if (ex) { // reconcile optimistic copy / duplicate realtime event
      ex.created_at = r.created_at; ex.content = r.content; ex.edited_at = r.edited_at || null; ex._state = 'sent';
      st.newestAt = r.created_at > (st.newestAt || '') ? r.created_at : st.newestAt;
      refreshNode(ex); return;
    }
    const m = normalize(r);
    st.byId.set(m.id, m); st.messages.push(m);
    if (!st.newestAt || m.created_at > st.newestAt) st.newestAt = m.created_at;
    if (!st.people.has(m.sender_id)) refreshPeople();
    appendMsg(m, currentUser && m.sender_id === currentUser.id);
  }

  async function refreshPeople() {
    const s = st; if (!s || Date.now() - s.peopleAt < 30000) return;
    s.peopleAt = Date.now();
    const { data } = await supabaseClient.rpc('teamchat_bootstrap', { p_project: s.projectId, p_limit: 1 });
    if (st !== s || !data || data.status !== 'ok') return;
    loadPeople(data.people);
    renderAll();
  }
  function loadPeople(arr) {
    st.people = new Map();
    (arr || []).forEach((p) => {
      st.people.set(p.id, { owner: !!p.owner, role: p.role || '', name: p.display_name || (p.email ? p.email.split('@')[0] : 'Team member') });
      if (p.owner && currentUser && p.id === currentUser.id) st.isOwner = true;
    });
  }

  // ----- realtime (only while the chat is open; one channel per open project)
  function subscribe() {
    const s = st, my = gen, pid = s.projectId;
    const f = { schema: 'public', table: 'project_messages', filter: 'project_id=eq.' + pid };
    s.channel = supabaseClient.channel('teamchat:' + pid)
      .on('postgres_changes', { event: 'INSERT', ...f }, (p) => { if (my === gen && st === s) addServerMsg(p.new); })
      .on('postgres_changes', { event: 'UPDATE', ...f }, (p) => { if (my === gen && st === s) onUpdate(p.new); })
      .subscribe((status) => {
        if (my !== gen || st !== s) return;
        if (status === 'SUBSCRIBED') { setBanner(navigator.onLine ? '' : "You're offline. TeamChat needs a connection."); if (s.wasDown) { s.wasDown = false; fillGap(); } }
        else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED') { s.wasDown = true; setBanner(navigator.onLine ? 'Reconnecting…' : "You're offline. TeamChat needs a connection."); }
      });
  }
  function onUpdate(r) {
    if (!r) return;
    const m = st.byId.get(r.id);
    if (r.deleted_at) {
      if (!m) return;
      st.messages.splice(st.messages.indexOf(m), 1); st.byId.delete(m.id); renderAll(); return;
    }
    if (m) { m.content = r.content; m.edited_at = r.edited_at || null; refreshNode(m); }
  }
  // After a dropped connection: fetch only what is newer than the last confirmed message.
  async function fillGap() {
    const s = st; if (!s || !s.newestAt) return;
    const { data, error } = await supabaseClient.from('project_messages')
      .select('id,sender_id,content,created_at,edited_at,deleted_at')
      .eq('project_id', s.projectId).gt('created_at', s.newestAt).order('created_at', { ascending: true }).limit(50);
    if (st !== s || error || !data) return;
    data.forEach(addServerMsg);
  }
  const onOffline = () => setBanner("You're offline. TeamChat needs a connection.");
  const onOnline = () => { setBanner(st && st.wasDown ? 'Reconnecting…' : ''); };

  // ----- history
  async function loadOlder() {
    const s = st; if (!s || s.loadingOlder || !s.hasMore || !s.oldestAt) return;
    s.loadingOlder = true;
    const l = listEl(), prevH = l.scrollHeight, prevTop = l.scrollTop;
    const { data, error } = await supabaseClient.from('project_messages')
      .select('id,sender_id,content,created_at,edited_at')
      .eq('project_id', s.projectId).is('deleted_at', null).lt('created_at', s.oldestAt)
      .order('created_at', { ascending: false }).limit(PAGE);
    s.loadingOlder = false;
    if (st !== s) return;
    if (error) { setBanner("Couldn't load earlier messages."); return; }
    s.hasMore = data.length === PAGE;
    if (data.length) {
      const older = data.reverse().filter((r) => !s.byId.has(r.id)).map(normalize);
      older.forEach((m) => s.byId.set(m.id, m));
      s.messages = older.concat(s.messages);
      s.oldestAt = data[0].created_at;
    }
    renderAll();
    l.scrollTop = prevTop + (l.scrollHeight - prevH);
  }

  // ----- sending / editing / deleting
  async function doInsert(m) {
    const s = st; if (!s) return;
    m._state = 'sending'; refreshNode(m);
    let ok = false;
    try {
      const { error } = await supabaseClient.from('project_messages').insert({ id: m.id, project_id: s.projectId, content: m.content });
      ok = !error || error.code === '23505'; // duplicate id == an earlier attempt already landed
    } catch (e) { ok = false; }
    if (st !== s) return;
    if (ok) { if (m._state !== 'sent') m._state = 'sent'; } else { m._state = 'failed'; }
    refreshNode(m);
  }
  function send() {
    if (!st || st.blocked) return;
    const input = inputEl(); const text = input.value.trim();
    if (!text || text.length > MAX_LEN) return;
    const m = { id: uuid(), sender_id: currentUser.id, content: text, created_at: new Date().toISOString(), edited_at: null, _state: 'sending' };
    st.byId.set(m.id, m); st.messages.push(m);
    appendMsg(m, true);
    input.value = ''; autosize();
    doInsert(m);
  }
  function startEdit(m, node) {
    const bubble = node.querySelector('.tc-bubble'); if (!bubble) return;
    const ta = document.createElement('textarea'); ta.className = 'tc-edit'; ta.value = m.content; ta.maxLength = MAX_LEN; ta.rows = 2;
    const row = document.createElement('div'); row.className = 'tc-edit-row';
    const save = document.createElement('button'); save.type = 'button'; save.className = 'btn small primary'; save.textContent = 'Save';
    const cancel = document.createElement('button'); cancel.type = 'button'; cancel.className = 'btn small'; cancel.textContent = 'Cancel';
    row.append(save, cancel);
    bubble.replaceWith(ta); ta.after(row); ta.focus();
    const done = () => refreshNode(m);
    cancel.addEventListener('click', done);
    ta.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') done();
      else if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); save.click(); }
    });
    save.addEventListener('click', async () => {
      const v = ta.value.trim(); if (!v || v === m.content) { done(); return; }
      save.disabled = true;
      const { error } = await supabaseClient.from('project_messages').update({ content: v }).eq('id', m.id);
      if (error) { save.disabled = false; setBanner("Couldn't save your edit. Check your connection."); return; }
      m.content = v; m.edited_at = new Date().toISOString(); done(); // realtime UPDATE will confirm
    });
  }
  async function removeMsg(m) {
    if (!confirm('Delete this message?')) return;
    const { error } = await supabaseClient.from('project_messages').update({ deleted_at: new Date().toISOString() }).eq('id', m.id);
    if (error) { setBanner("Couldn't delete the message. Check your connection."); return; }
    if (st && st.byId.has(m.id)) { st.messages.splice(st.messages.indexOf(m), 1); st.byId.delete(m.id); renderAll(); }
  }

  function autosize() { const t = inputEl(); if (!t) return; t.style.height = 'auto'; t.style.height = Math.min(t.scrollHeight, 140) + 'px'; }

  let wired = false;
  function wireOnce() {
    if (wired) return; wired = true;
    const form = $('teamchat-form'), input = inputEl();
    form.addEventListener('submit', (e) => { e.preventDefault(); send(); });
    input.addEventListener('input', autosize);
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); send(); }
    });
    listEl().addEventListener('scroll', () => { if (listEl().scrollTop < 40) loadOlder(); }, { passive: true });
  }

  async function open(projectId) {
    if (typeof currentUser === 'undefined' || !currentUser) {
      if (typeof window.openAuthFromGuest === 'function') window.openAuthFromGuest();
      return;
    }
    const pid = String(projectId);
    if (st && st.projectId === pid) return; // already active: never a second subscription
    close();
    wireOnce();
    const my = ++gen;
    st = { projectId: pid, channel: null, messages: [], byId: new Map(), people: new Map(), hasMore: false, oldestAt: null, newestAt: null, isOwner: false, wasDown: false, loadingOlder: false, blocked: true, peopleAt: Date.now() };
    const s = st;
    setNotice(''); setBanner(''); setComposerEnabled(false); showListMessage('Loading…');
    window.addEventListener('offline', onOffline); window.addEventListener('online', onOnline);
    let res;
    try { res = await supabaseClient.rpc('teamchat_bootstrap', { p_project: pid, p_limit: PAGE }); }
    catch (e) { res = { error: e }; }
    if (my !== gen || st !== s) return;
    if (res.error || !res.data) {
      showListMessage("Couldn't load TeamChat.");
      setNotice(navigator.onLine ? 'Something went wrong loading the conversation.' : "You're offline. TeamChat needs a connection.", 'Try again', () => { close(); open(projectId); });
      return;
    }
    const d = res.data;
    if (d.status === 'no_plan') {
      showListMessage('');
      setNotice('TeamChat is part of the Team plan.', 'See plans', () => { if (typeof openStore === 'function') openStore(); });
      return;
    }
    if (d.status !== 'ok') { showListMessage(''); setNotice("You don't have access to this project's TeamChat."); return; }
    loadPeople(d.people);
    const rows = (d.messages || []).slice().reverse(); // newest-first -> chronological
    rows.forEach((r) => { const m = normalize(r); s.byId.set(m.id, m); s.messages.push(m); });
    s.hasMore = rows.length === PAGE;
    if (rows.length) { s.oldestAt = rows[0].created_at; s.newestAt = rows[rows.length - 1].created_at; }
    s.blocked = false;
    setComposerEnabled(true);
    renderAll(); scrollBottom();
    subscribe();
  }

  function close() {
    gen++;
    if (st && st.channel && typeof supabaseClient !== 'undefined' && supabaseClient) {
      try { supabaseClient.removeChannel(st.channel); } catch (e) {}
    }
    st = null;
    window.removeEventListener('offline', onOffline); window.removeEventListener('online', onOnline);
    const l = listEl(); if (l) l.textContent = '';
    setBanner(''); setNotice('');
  }

  window.TeamChat = { open, close, isOpen: () => !!st };
})();