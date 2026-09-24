// main.js

// Give Electron/Chromium its own private temp directory instead of sharing
// the system /tmp. MUST run before `require('electron')` — Chromium's
// native side reads the temp dir during that call's own init, so setting
// TMPDIR any later than this has no effect.
if (process.platform === 'linux' && !process.env.TMPDIR) {
  const os = require('node:os');
  const nodePath = require('node:path');
  const fs = require('node:fs');
  const tmpDir = nodePath.join(os.homedir(), '.cache', 'aschertype-electron-tmp');
  try {
    fs.mkdirSync(tmpDir, { recursive: true });
    process.env.TMPDIR = tmpDir;
  } catch (err) {
    console.warn('[tmpdir] failed to set private TMPDIR, falling back to system /tmp:', err.message);
  }
}

const electron = require('electron');
const { app, BrowserWindow, shell, crashReporter } = electron;
const path = require('node:path');
const fsp = require('node:fs/promises');
const crypto = require('node:crypto');

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

// ===== Linux: bypass the sandbox entirely =====
// Ubuntu 24.04+ ships with kernel.apparmor_restrict_unprivileged_userns=1,
// which blocks Chromium's namespace sandbox. The failure happens inside the
// zygote process *before* any runtime probe could apply a flag, so we apply
// the flags unconditionally from the very start.
if (process.platform === 'linux') {
  app.commandLine.appendSwitch('no-sandbox');
  app.commandLine.appendSwitch('disable-gpu-sandbox');
  app.commandLine.appendSwitch('disable-setuid-sandbox');
  app.commandLine.appendSwitch('disable-dev-shm-usage');
  app.commandLine.appendSwitch('no-zygote');
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

function isTrustedSender(frame) {
  if (!frame || !frame.url) return false;
  return frame.url.startsWith('file://');
}

if (ipcMain && typeof ipcMain.handle === 'function') {
  ipcMain.handle('secure-store:get', async (event, key) => {
    if (!isTrustedSender(event.senderFrame)) return null;
    if (typeof key !== 'string' || !key || key.length > 256) return null;
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

  ipcMain.handle('secure-store:set', async (event, key, value) => {
    if (!isTrustedSender(event.senderFrame)) return false;
    if (typeof key !== 'string' || !key || key.length > 256) return false;
    if (typeof value !== 'string' || value.length > 256 * 1024) return false;
    if (!safeStorage || !safeStorage.isEncryptionAvailable()) return false;

    await ensureStoreDir();
    const file = path.join(getStoreDir(), keyToFilename(key));
    const encrypted = safeStorage.encryptString(value);
    const tmp = `${file}.tmp`;
    await fsp.writeFile(tmp, encrypted, { mode: 0o600 });
    await fsp.rename(tmp, file);
    return true;
  });

  ipcMain.handle('secure-store:remove', async (event, key) => {
    if (!isTrustedSender(event.senderFrame)) return false;
    if (typeof key !== 'string' || !key || key.length > 256) return false;

    const file = path.join(getStoreDir(), keyToFilename(key));
    try {
      await fsp.unlink(file);
      return true;
    } catch (err) {
      if (err.code === 'ENOENT') return true;
      return false;
    }
  });

  ipcMain.handle('secure-store:clear', async (event) => {
    if (!isTrustedSender(event.senderFrame)) return false;

    try {
      const files = await fsp.readdir(getStoreDir());
      await Promise.all(
        files.map((f) => fsp.unlink(path.join(getStoreDir(), f)).catch(() => { }))
      );
      return true;
    } catch (err) {
      if (err.code === 'ENOENT') return true;
      return false;
    }
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
    icon: path.join(__dirname, 'src', 'favicon.png'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
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

let quitting = false;

app.on('before-quit', (event) => {
  if (quitting) return;

  const win = mainWindow && !mainWindow.isDestroyed() ? mainWindow : BrowserWindow.getAllWindows()[0];
  if (!win || win.isDestroyed() || !ipcMain) {
    quitting = true;
    return;
  }

  event.preventDefault();
  quitting = true;

  const timeout = setTimeout(() => app.quit(), 2000);
  ipcMain.once('app:flush-complete', () => {
    clearTimeout(timeout);
    app.quit();
  });
  win.webContents.send('app:flush-secure-writes');
});