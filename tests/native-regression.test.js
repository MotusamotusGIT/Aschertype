// Run: node --test tests/native-regression.test.js
// Loads the REAL classic scripts (utils.js, notifications.js) and the real
// isAuthInvalidError from auth.js into a sandbox; nothing here is a stub of the logic under test.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const SRC = path.join(__dirname, '..', 'src');
const read = (f) => fs.readFileSync(path.join(SRC, f), 'utf8');

function memStore() {
  const m = new Map();
  return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k), _m: m };
}
function loadUtils(local, session) {
  const win = { crypto: {}, };
  const ctx = { window: win, localStorage: local, sessionStorage: session, console, TextEncoder, fetch: async () => ({}) };
  win.window = win;
  vm.createContext(ctx);
  vm.runInContext(read('utils.js') + '\n;globalThis.__u = window;', ctx);
  return ctx.window;
}

const KEY = 'sb-tjjzeetbsxnkrgoiagbf-auth-token';

test('A/C: session written by the client survives a "WebView recreation" (new page, same localStorage)', () => {
  const local = memStore(), session = memStore();
  const page1 = loadUtils(local, session);
  page1.electronSecureStorage.setItem(KEY, '{"refresh_token":"abc"}');
  const page2 = loadUtils(local, memStore()); // new page load: fresh JS heap + fresh sessionStorage
  assert.strictEqual(page2.electronSecureStorage.getItem(KEY), '{"refresh_token":"abc"}');
});

test('"forget session" keeps the session out of persistent storage', () => {
  const local = memStore(), session = memStore();
  const p = loadUtils(local, session);
  p.setRememberPreference(false);
  p.electronSecureStorage.setItem(KEY, 'tok');
  assert.strictEqual(local.getItem(KEY), null);
  const p2 = loadUtils(local, memStore());
  p2.setRememberPreference(false);
  assert.strictEqual(p2.electronSecureStorage.getItem(KEY), null);
});

test('E: logout (removeItem) actually clears the stored session', () => {
  const local = memStore(), session = memStore();
  const p = loadUtils(local, session);
  p.electronSecureStorage.setItem(KEY, 'tok');
  p.electronSecureStorage.removeItem(KEY);
  assert.strictEqual(local.getItem(KEY), null);
  assert.strictEqual(session.getItem(KEY), null);
});

test('Electron path still uses the secure store (not web storage)', () => {
  const local = memStore(), session = memStore();
  const sets = [];
  const win = { crypto: {}, electronAPI: { secureStore: { get: async () => null, set: async (k, v) => { sets.push([k, v]); }, remove: async () => {} } } };
  win.window = win;
  const ctx = { window: win, localStorage: local, sessionStorage: session, console, TextEncoder };
  vm.createContext(ctx);
  vm.runInContext(read('utils.js'), ctx);
  win.electronSecureStorage.setItem(KEY, 'tok');
  assert.deepStrictEqual(sets, [[KEY, 'tok']]);
  assert.strictEqual(local.getItem(KEY), null);
});

// ---- isAuthInvalidError (extracted verbatim from auth.js) ----
const fnSrc = read('auth.js').match(/function isAuthInvalidError\(error\) \{[\s\S]*?\n\}/)[0];
const isAuthInvalidError = new Function(`${fnSrc}; return isAuthInvalidError;`)();

test('G: rejected refresh token => login required', () => {
  assert.ok(isAuthInvalidError({ code: 'refresh_token_not_found', message: 'x' }));
  assert.ok(isAuthInvalidError({ message: 'Invalid Refresh Token: Already Used', status: 400 }));
});
test('network/transient errors are NOT treated as logged out', () => {
  assert.ok(!isAuthInvalidError({ name: 'AuthRetryableFetchError', message: 'Failed to fetch', status: 0 }));
  assert.ok(!isAuthInvalidError({ message: 'Failed to fetch' }));
  assert.ok(!isAuthInvalidError({ status: 503, message: 'unavailable' }));
});

// ---- Notifications ----
function loadNotify({ permission = 'granted', native = true } = {}) {
  const pending = new Map();
  const plugin = {
    _perm: permission, requests: 0,
    checkPermissions: async () => ({ display: plugin._perm }),
    requestPermissions: async () => { plugin.requests++; plugin._perm = 'granted'; return { display: 'granted' }; },
    getPending: async () => ({ notifications: [...pending.values()].map((n) => ({ id: n.id })) }),
    cancel: async ({ notifications }) => notifications.forEach((n) => pending.delete(n.id)),
    schedule: async ({ notifications }) => notifications.forEach((n) => pending.set(n.id, n)),
  };
  const win = { Capacitor: { isNativePlatform: () => native, Plugins: { LocalNotifications: plugin } } };
  win.window = win;
  const ctx = { window: win, localStorage: memStore(), console };
  vm.createContext(ctx);
  vm.runInContext(read('notifications.js'), ctx);
  return { N: win.MossNotify, plugin, pending };
}
const soon = (mins) => { const d = new Date(Date.now() + mins * 60000); const p = (n) => String(n).padStart(2, '0');
  return { date: `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`, time: `${p(d.getHours())}:${p(d.getMinutes())}` }; };

test('J: permission granted => reminders are scheduled', async () => {
  const { N, pending } = loadNotify();
  const t = soon(120);
  await N.sync([{ id: 'e1', title: 'Meet', ...t }], [], true);
  assert.strictEqual(pending.size, 2); // "soon" + "start"
});
test('I: permission denied => nothing scheduled; request is not repeated', async () => {
  const { N, pending, plugin } = loadNotify({ permission: 'denied' });
  await N.sync([{ id: 'e1', title: 'Meet', ...soon(120) }], [], true);
  assert.strictEqual(pending.size, 0);
  assert.strictEqual(await N.requestPermission(), 'denied');
  assert.strictEqual(plugin.requests, 0);
});
test('disabled toggle cancels everything pending', async () => {
  const { N, pending } = loadNotify();
  const ev = [{ id: 'e1', title: 'Meet', ...soon(120) }];
  await N.sync(ev, [], true); assert.ok(pending.size > 0);
  await N.sync(ev, [], false); assert.strictEqual(pending.size, 0);
});
test('K: editing a reminder time replaces, never duplicates', async () => {
  const { N, pending } = loadNotify();
  const todo = { id: 't1', text: 'Pay', done: false, ...(() => { const s = soon(120); return { due: s.date, reminderTime: s.time }; })() };
  await N.sync([], [todo], true); assert.strictEqual(pending.size, 1);
  const before = [...pending.keys()][0];
  const s2 = soon(180); todo.due = s2.date; todo.reminderTime = s2.time;
  await N.sync([], [todo], true);
  assert.strictEqual(pending.size, 1);
  assert.strictEqual([...pending.keys()][0], before); // same stable id
  await N.sync([], [todo], true); // "app restart" resync
  assert.strictEqual(pending.size, 1);
});
test('L: deleting or completing cancels the notification', async () => {
  const { N, pending } = loadNotify();
  const s = soon(120);
  const todo = { id: 't1', text: 'Pay', done: false, due: s.date, reminderTime: s.time };
  await N.sync([], [todo], true); assert.strictEqual(pending.size, 1);
  todo.done = true; await N.sync([], [todo], true); assert.strictEqual(pending.size, 0);
  todo.done = false; await N.sync([], [todo], true); assert.strictEqual(pending.size, 1);
  await N.sync([], [], true); assert.strictEqual(pending.size, 0);
});
test('past reminders are not scheduled', async () => {
  const { N, pending } = loadNotify();
  await N.sync([{ id: 'e1', title: 'Old', ...soon(-60) }], [], true);
  assert.strictEqual(pending.size, 0);
});
test('web/Electron: MossNotify is inert (existing Notification path unchanged)', async () => {
  const { N, pending } = loadNotify({ native: false });
  assert.strictEqual(await N.getPermission(), null);
  await N.sync([{ id: 'e1', title: 'x', ...soon(120) }], [], true);
  assert.strictEqual(pending.size, 0);
  assert.strictEqual(N.handlesReminders(), false);
});