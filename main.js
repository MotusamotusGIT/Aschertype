// main.js
const electron = require('electron');
const { app, BrowserWindow, shell, crashReporter } = electron;
const path = require('node:path');
const fsp = require('node:fs/promises');
const crypto = require('node:crypto');
const ai = require('./ai');

// ipcMain and safeStorage may be absent in the unit-test electron mock.
// Guard them so module load doesn't throw.
const ipcMain = electron.ipcMain;
const safeStorage = electron.safeStorage;

try {
  crashReporter.start({
    submitURL: 'https://aschertype.vercel.app/crash',
    uploadToServer: true,
  });
} catch (err) {
  console.warn('[crashReporter] failed:', err.message);
}

function getStoreDir() {
  return path.join(app.getPath('userData'), 'secure-store');
}

function keyToFilename(key) {
  const safe = key.replace(/[^a-zA-Z0-9._-]/g, '_');
  const hash = crypto.createHash('sha256').update(key).digest('hex').slice(0, 16);
  return `${safe.slice(0, 64)}.${hash}.bin`;
}

async function ensureStoreDir() {
  await fsp.mkdir(getStoreDir(), { recursive: true });
}

if (ipcMain && typeof ipcMain.handle === 'function') {
  ipcMain.handle('secure-store:get', async (_event, key) => {
    if (typeof key !== 'string' || !key) return null;
    if (!safeStorage || !safeStorage.isEncryptionAvailable()) return null;
    const file = path.join(getStoreDir(), keyToFilename(key));
    try {
      const encrypted = await fsp.readFile(file);
      return safeStorage.decryptString(encrypted);
    } catch (err) {
      if (err.code === 'ENOENT') return null;
      return null;
    }
  });

  ipcMain.handle('secure-store:set', async (_event, key, value) => {
    if (typeof key !== 'string' || !key) return false;
    if (typeof value !== 'string') return false;
    if (!safeStorage || !safeStorage.isEncryptionAvailable()) return false;
    await ensureStoreDir();
    const file = path.join(getStoreDir(), keyToFilename(key));
    const encrypted = safeStorage.encryptString(value);
    const tmp = `${file}.tmp`;
    await fsp.writeFile(tmp, encrypted, { mode: 0o600 });
    await fsp.rename(tmp, file);
    return true;
  });

  ipcMain.handle('secure-store:remove', async (_event, key) => {
    if (typeof key !== 'string' || !key) return false;
    const file = path.join(getStoreDir(), keyToFilename(key));
    try { await fsp.unlink(file); return true; }
    catch (err) { if (err.code === 'ENOENT') return true; return false; }
  });

  ipcMain.handle('secure-store:clear', async () => {
    try {
      const files = await fsp.readdir(getStoreDir());
      await Promise.all(files.map((f) => fsp.unlink(path.join(getStoreDir(), f)).catch(() => {})));
      return true;
    } catch (err) {
      if (err.code === 'ENOENT') return true;
      return false;
    }
  });

  // ===== AI =====
  ipcMain.handle('ai:health', async (_event, payload) => {
    return await ai.aiHealth((payload && payload.model) || undefined);
  });

  ipcMain.handle('ai:chat', async (_event, { messages, options, model }) => {
    try {
      const text = await ai.aiChat({ messages, options, model });
      return { ok: true, text };
    } catch (err) {
      return { ok: false, error: err.message || String(err) };
    }
  });

  ipcMain.handle('ai:chat-tools', async (_event, { messages, tools, options, requestId, model }) => {
    try {
      const { message, aborted } = await ai.aiChatTools({ messages, tools, options, requestId, model });
      return { ok: true, message, aborted: !!aborted };
    } catch (err) {
      return { ok: false, error: err.message || String(err) };
    }
  });

  ipcMain.handle('ai:parse-task', async (_event, { sentence }) => {
    try {
      return await ai.aiParseTask({ sentence });
    } catch (err) {
      return { ok: false, error: err.message || String(err) };
    }
  });

  ipcMain.handle('ai:abort', async (_event, { requestId }) => {
    return { ok: ai.aiAbort(requestId) };
  });

  ipcMain.handle('ai:chat-stream', async (event, { messages, options, model }) => {
    const requestId = ai.newRequestId();
    const sender = event.sender;

    (async () => {
      try {
        await ai.aiChatStream({
          messages,
          options,
          model,
          requestId,
          onChunk: (chunk) => {
            if (!sender.isDestroyed()) {
              sender.send('ai:chunk', { requestId, chunk });
            }
          },
        });
        if (!sender.isDestroyed()) {
          sender.send('ai:done', { requestId, done: true });
        }
      } catch (err) {
        if (!sender.isDestroyed()) {
          sender.send('ai:done', { requestId, done: true, error: err.message || String(err) });
        }
      }
    })();

    return { ok: true, requestId };
  });
}

let mainWindow = null;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 840,
    minWidth: 900,
    minHeight: 600,
    backgroundColor: '#111827',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
    },
  });
  mainWindow.loadFile(path.join(__dirname, 'src', 'index.html'));
}

const SUPABASE_HOST_RE = /^https:\/\/([a-z0-9-]+\.)?supabase\.co(\/|$)/i;

function isAllowedNavigation(url) {
  if (url.startsWith('file://')) return true;
  if (SUPABASE_HOST_RE.test(url)) return true;
  return false;
}
function isExternalSafe(url) {
  return url.startsWith('http://') || url.startsWith('https://');
}

app.on('web-contents-created', (_event, contents) => {
  contents.on('will-navigate', (event, url) => {
    if (isAllowedNavigation(url)) return;
    event.preventDefault();
    if (isExternalSafe(url)) shell.openExternal(url);
  });
  contents.setWindowOpenHandler(({ url }) => {
    if (isExternalSafe(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
});

const CSP_STRING = [
  "default-src 'self' file:",
  "img-src 'self' file: data: blob:",
  "style-src 'self' 'unsafe-inline'",
  "script-src 'self' https://hcaptcha.com https://*.hcaptcha.com",
  "connect-src 'self' https://*.supabase.co wss://*.supabase.co https://hcaptcha.com https://*.hcaptcha.com https://api.pwnedpasswords.com",
  "font-src 'self'",
  "worker-src 'self' blob:",
  "frame-src https://hcaptcha.com https://*.hcaptcha.com",
  "base-uri 'self'",
  "form-action 'self'",
  "object-src 'none'",
].join('; ');

app.on('session-created', (session) => {
  session.webRequest.onHeadersReceived((details, callback) => {
    // Only override CSP for our own app shell (file://) — leave
    // third-party responses (hCaptcha's own iframe/document, its
    // sub-resources, Supabase, etc.) to set their own headers.
    if (!details.url.startsWith('file://')) {
      callback({ responseHeaders: details.responseHeaders });
      return;
    }
    const responseHeaders = Object.assign({}, details.responseHeaders);
    responseHeaders['Content-Security-Policy'] = [CSP_STRING];
    callback({ responseHeaders });
  });
});

app.whenReady().then(() => {
  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});