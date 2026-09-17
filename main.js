const { app, BrowserWindow, shell, crashReporter } = require('electron');
const path = require('path');

// ===== Crash reporting =====
// Must start before app.whenReady() so renderers created later are covered.
// Point submitURL at your endpoint (Sentry, mini-breakpad-server, BugSplat).
// If you don't have one yet, comment this out — an invalid submitURL is
// harmless but noisy.
crashReporter.start({
  submitURL: 'https://your-crash-endpoint.example.com',
  uploadToServer: true,
  compress: true,
  globalExtra: { _companyName: 'Aschertype' },
});

// ===== Navigation and window guards =====
// Applied to every WebContents the app ever creates. Without these, a
// malicious link in a task title or a compromised dependency could
// navigate the main window to an attacker-controlled page that inherits
// the renderer's privileges.
app.on('web-contents-created', (_event, contents) => {
  contents.on('will-navigate', (event, navigationUrl) => {
    const parsed = new URL(navigationUrl);
    // Allow: file:// (local app), https://*.supabase.co (auth + sync).
    // Block: everything else.
    const allowed =
      parsed.protocol === 'file:' ||
      parsed.origin.endsWith('.supabase.co');
    if (!allowed) {
      event.preventDefault();
      // Open external links in the system browser instead.
      if (parsed.protocol === 'http:' || parsed.protocol === 'https:') {
        shell.openExternal(navigationUrl);
      }
    }
  });

  // window.open() / target="_blank" -> open externally, never in-app.
  contents.setWindowOpenHandler(({ url }) => {
    const parsed = new URL(url);
    if (parsed.protocol === 'http:' || parsed.protocol === 'https:') {
      shell.openExternal(url);
    }
    return { action: 'deny' };
  });
});

// ===== Content Security Policy via response headers =====
// A <meta> CSP can't restrict the initial document, and some directives
// behave differently when delivered this way. Set it as a real header.
app.on('session-created', (session) => {
  session.webRequest.onHeadersReceived((details, callback) => {
    callback({
      responseHeaders: {
        ...details.responseHeaders,
        'Content-Security-Policy': [
          "default-src 'self' file:;",
          "img-src 'self' file: data: blob: https://aschertype.vercel.app;",
          "style-src 'self' 'unsafe-inline';",
          "script-src 'self' https://cdn.jsdelivr.net https://unpkg.com;",
          "connect-src 'self' https://api.quotable.io https://*.supabase.co wss://*.supabase.co;",
          "font-src 'self';",
          "manifest-src 'self';",
          "worker-src 'self' blob:;",
          "base-uri 'self';",
          "form-action 'self';",
          "object-src 'none';",
        ].join(' '),
      },
    });
  });
});

// ===== Window creation =====
function createWindow() {
  const win = new BrowserWindow({
    title: 'Aschertype',
    width: 980,
    height: 680,
    minWidth: 380,
    minHeight: 520,
    resizable: true,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
      // No preload yet. When you add one, point it here:
      // preload: path.join(__dirname, 'preload.js'),
    },
  });

  win.loadFile(path.join(__dirname, 'src', 'index.html'));
}

app.whenReady().then(() => {
  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});