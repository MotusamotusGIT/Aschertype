// notifications.js — single notification abstraction (classic script).
// Android/Capacitor: native permission + native scheduled local notifications.
// Web/Electron: unchanged (renderer.js keeps its Notification API + in-app toast path).
(function () {
  const REMINDER_WINDOW_DAYS = 60;
  const MAX_SCHEDULED = 200;
  const ASKED_KEY = 'nativeNotifPermissionAsked';

  function isNative() {
    try { return !!(window.Capacitor && window.Capacitor.isNativePlatform && window.Capacitor.isNativePlatform()); }
    catch (e) { return false; }
  }
  function plugin() {
    return (window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.LocalNotifications) || null;
  }
  function normalize(display) { return display === 'granted' ? 'granted' : display === 'denied' ? 'denied' : 'default'; }

  // Stable positive int32 id per logical reminder (FNV-1a) => rescheduling replaces, never duplicates.
  function stableId(key) {
    let h = 0x811c9dc5;
    for (let i = 0; i < key.length; i++) { h ^= key.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; }
    return (h & 0x7fffffff) || 1;
  }

  async function getPermission() {
    const p = plugin();
    if (!isNative() || !p) return null; // caller falls back to Notification API
    try { return normalize((await p.checkPermissions()).display); } catch (e) { return 'default'; }
  }

  // Requests only when the OS can still show the dialog; never re-prompts after denial.
  async function requestPermission() {
    const p = plugin();
    if (!isNative() || !p) return null;
    const current = await getPermission();
    if (current === 'granted' || current === 'denied') return current;
    try { localStorage.setItem(ASKED_KEY, 'true'); } catch (e) {}
    try { return normalize((await p.requestPermissions()).display); } catch (e) { return 'denied'; }
  }
  function alreadyAsked() { try { return localStorage.getItem(ASKED_KEY) === 'true'; } catch (e) { return false; } }

  // Build the desired reminder set from app data. Pure; exported for tests.
  function buildReminders(events, todos, now) {
    const out = [];
    const limit = now.getTime() + REMINDER_WINDOW_DAYS * 86400000;
    const at = (date, time) => {
      if (!date || !time) return null;
      const [y, m, d] = date.split('-').map(Number);
      const [hh, mm] = time.split(':').map(Number);
      if ([y, m, d, hh, mm].some(Number.isNaN)) return null;
      return new Date(y, m - 1, d, hh, mm, 0, 0);
    };
    const push = (key, when, title, body) => {
      if (!when || when.getTime() <= now.getTime() || when.getTime() > limit) return; // skip past/far
      out.push({ id: stableId(key), key, at: when, title, body });
    };
    (events || []).forEach((ev) => {
      const start = at(ev.date, ev.time);
      if (!start) return;
      push(`event-start:${ev.id}`, start, 'Starting now', ev.title || '');
      push(`event-soon:${ev.id}`, new Date(start.getTime() - 5 * 60000), 'Coming up in 5 minutes', ev.title || '');
    });
    (todos || []).forEach((t) => {
      if (t.done || !t.due || !t.reminderTime) return;
      push(`task:${t.id}`, at(t.due, t.reminderTime), 'Task due today', t.text || '');
    });
    out.sort((a, b) => a.at - b.at);
    return out.slice(0, MAX_SCHEDULED);
  }

  // ---- Server push (FCM). Lets reminders created on ANY device notify this
  // phone even when the app is closed. When push is registered it is the only
  // delivery path on this device, so local scheduling is turned off (no dupes).
  const PUSH_KEY = 'nativePushRegistered';
  function pushPlugin() {
    return (window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.PushNotifications) || null;
  }
  function pushActive() { try { return localStorage.getItem(PUSH_KEY) === 'true'; } catch (e) { return false; } }
  function setPushActive(v) { try { localStorage.setItem(PUSH_KEY, v ? 'true' : 'false'); } catch (e) {} }
  function deviceTimezone() { try { return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'; } catch (e) { return 'UTC'; } }

  let pushListenersAttached = false;
  let lastToken = null;
  async function saveToken(token) {
    if (!token || typeof supabaseClient === 'undefined' || !supabaseClient) return false;
    try {
      const { data, error } = await supabaseClient.rpc('register_push_token', { p_token: token, p_timezone: deviceTimezone() });
      if (error || data !== true) { setPushActive(false); return false; }
      lastToken = token; setPushActive(true); window.dispatchEvent(new Event('mosstask:pushregistered')); return true;
    } catch (e) { return false; }
  }
  // Call when signed in + notifications enabled + permission granted. Safe to repeat
  // (also refreshes the timezone after travel).
  async function registerPush() {
    const p = pushPlugin();
    if (!isNative() || !p || (await getPermission()) !== 'granted') return false;
    if (!pushListenersAttached) {
      pushListenersAttached = true;
      p.addListener('registration', (t) => saveToken(t && t.value));
      p.addListener('registrationError', (e) => { console.warn('[Push] registration error:', e && e.error); setPushActive(false); });
      // FCM does not draw a notification while the app is in the foreground.
      p.addListener('pushNotificationReceived', (m) => {
        window.dispatchEvent(new CustomEvent('mosstask:push', { detail: { title: m.title || '', body: m.body || '' } }));
      });
      try { await p.createChannel({ id: 'reminders', name: 'Reminders', importance: 4, visibility: 1 }); } catch (e) {}
    }
    try { await p.register(); } catch (e) { return false; }
    return true;
  }
  async function unregisterPush() {
    setPushActive(false);
    try {
      if (lastToken && typeof supabaseClient !== 'undefined' && supabaseClient) {
        await supabaseClient.rpc('unregister_push_token', { p_token: lastToken });
      }
    } catch (e) {}
    const p = pushPlugin();
    if (p) { try { await p.unregister(); } catch (e) {} }
  }

  let syncChain = Promise.resolve();
  // Reconcile OS-scheduled notifications with current data: cancel stale, (re)schedule desired.
  function sync(events, todos, enabled) {
    syncChain = syncChain.then(() => doSync(events, todos, enabled)).catch((e) => console.warn('[Notify] sync failed:', e && e.message));
    return syncChain;
  }
  async function doSync(events, todos, enabled) {
    const p = plugin();
    if (!isNative() || !p) return;
    const perm = await getPermission();
    // Push is the single delivery path when registered; otherwise fall back to local scheduling.
    const desired = (enabled && perm === 'granted' && !pushActive()) ? buildReminders(events, todos, new Date()) : [];
    const pending = ((await p.getPending()).notifications || []);
    const desiredIds = new Set(desired.map((r) => r.id));
    const stale = pending.filter((n) => !desiredIds.has(n.id)).map((n) => ({ id: n.id }));
    if (stale.length) await p.cancel({ notifications: stale });
    if (desired.length) {
      await p.schedule({
        notifications: desired.map((r) => ({
          id: r.id, title: r.title, body: r.body,
          schedule: { at: r.at, allowWhileIdle: true },
        })),
      });
    }
  }

  // True when the OS is delivering reminders, so the in-app 30s poller must not double-fire.
  let nativeDelivers = false;
  async function refreshDeliveryState() { nativeDelivers = isNative() && !!plugin() && (await getPermission()) === 'granted'; return nativeDelivers; }
  // While push is active the in-app poller must also stay quiet (the server sends it).
  const handles = () => nativeDelivers || (isNative() && pushActive());

  window.MossNotify = {
    isNative, getPermission, requestPermission, alreadyAsked, sync, buildReminders, stableId,
    refreshDeliveryState, handlesReminders: handles, registerPush, unregisterPush, pushActive,
  };
})();