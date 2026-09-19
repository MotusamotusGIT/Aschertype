// tests/main.security.test.js
import { describe, it, expect, vi, beforeEach } from 'vitest';
import Module from 'node:module';
import { createRequire } from 'node:module';

// main.js uses require('electron'), not import. vi.mock() only intercepts
// ESM imports, so we patch Module._load directly to intercept require().

const mockLoadFile = vi.fn();
const mockOn = vi.fn();
const mockShellOpenExternal = vi.fn();
const mockCrashReporterStart = vi.fn();
const mockBrowserWindow = vi.fn(function () {
  this.loadFile = mockLoadFile;
});

const electronMock = {
  app: {
    whenReady: () => Promise.resolve(),
    on: mockOn,
    quit: () => {},
  },
  BrowserWindow: mockBrowserWindow,
  shell: { openExternal: mockShellOpenExternal },
  crashReporter: { start: mockCrashReporterStart },
};

const originalLoad = Module._load;
Module._load = function (request) {
  if (request === 'electron') return electronMock;
  return originalLoad.apply(this, arguments);
};

const require = createRequire(import.meta.url);
const MAIN_PATH = require.resolve('../main.js');

const flush = () => new Promise((r) => setTimeout(r, 0));

/**
 * Load main.js fresh and return the handler registered for the given
 * app-level event. Call this after `require('../main.js')`.
 */
function getAppHandler(eventName) {
  const call = mockOn.mock.calls.find(([e]) => e === eventName);
  return call ? call[1] : null;
}

/**
 * Fake WebContents with just the methods main.js touches.
 * Returns the object plus spies on the registered handlers.
 */
function makeFakeContents() {
  const handlers = {};
  return {
    contents: {
      on: (event, fn) => { handlers[event] = fn; },
      setWindowOpenHandler: (fn) => { handlers.windowOpen = fn; },
    },
    handlers,
  };
}

/**
 * Fake Electron session with a fake webRequest.
 * Returns the session plus a spy on the callback that main.js passes
 * to onHeadersReceived.
 */
function makeFakeSession() {
  const captured = { onHeadersReceived: null };
  return {
    session: {
      webRequest: {
        onHeadersReceived: (fn) => { captured.onHeadersReceived = fn; },
      },
    },
    captured,
  };
}

describe('main process security — window creation', () => {
  beforeEach(() => {
    delete require.cache[MAIN_PATH];
    mockLoadFile.mockClear();
    mockOn.mockClear();
    mockShellOpenExternal.mockClear();
    mockCrashReporterStart.mockClear();
    mockBrowserWindow.mockClear();
  });

  it('creates BrowserWindow with sandbox, contextIsolation, no nodeIntegration', async () => {
    require('../main.js');
    await flush();

    expect(mockBrowserWindow).toHaveBeenCalled();
    const opts = mockBrowserWindow.mock.calls[0][0];
    expect(opts.webPreferences.sandbox).toBe(true);
    expect(opts.webPreferences.contextIsolation).toBe(true);
    expect(opts.webPreferences.nodeIntegration).toBe(false);
    expect(opts.webPreferences.webSecurity).toBe(true);
  });

  it('starts the crash reporter', () => {
    require('../main.js');
    expect(mockCrashReporterStart).toHaveBeenCalled();
    const opts = mockCrashReporterStart.mock.calls[0][0];
    expect(opts.submitURL).toBeTruthy();
    expect(opts.uploadToServer).toBe(true);
  });

  it('registers a web-contents-created handler', () => {
    require('../main.js');
    const calls = mockOn.mock.calls.filter(([e]) => e === 'web-contents-created');
    expect(calls.length).toBe(1);
  });

  it('registers a session-created handler for CSP', () => {
    require('../main.js');
    const calls = mockOn.mock.calls.filter(([e]) => e === 'session-created');
    expect(calls.length).toBe(1);
  });

  it('loads index.html from src/', async () => {
    require('../main.js');
    await flush();

    expect(mockLoadFile).toHaveBeenCalled();
    const loadPath = mockLoadFile.mock.calls[0][0];
    expect(loadPath).toMatch(/src[\\/]index\.html$/);
  });
});

describe('main process security — navigation guards', () => {
  beforeEach(() => {
    delete require.cache[MAIN_PATH];
    mockLoadFile.mockClear();
    mockOn.mockClear();
    mockShellOpenExternal.mockClear();
    mockCrashReporterStart.mockClear();
    mockBrowserWindow.mockClear();
  });

  it('will-navigate: allows file:// URLs', () => {
    require('../main.js');
    const onWebContents = getAppHandler('web-contents-created');
    const { contents, handlers } = makeFakeContents();
    onWebContents({}, contents);

    const event = { preventDefault: vi.fn() };
    handlers['will-navigate'](event, 'file:///home/user/app/src/index.html');

    expect(event.preventDefault).not.toHaveBeenCalled();
    expect(mockShellOpenExternal).not.toHaveBeenCalled();
  });

  it('will-navigate: allows https://*.supabase.co URLs', () => {
    require('../main.js');
    const onWebContents = getAppHandler('web-contents-created');
    const { contents, handlers } = makeFakeContents();
    onWebContents({}, contents);

    const event = { preventDefault: vi.fn() };
    handlers['will-navigate'](event, 'https://tjjzeetbsxnkrgoiagbf.supabase.co/auth/v1/callback');

    expect(event.preventDefault).not.toHaveBeenCalled();
    expect(mockShellOpenExternal).not.toHaveBeenCalled();
  });

  it('will-navigate: blocks https://evil.com and opens it externally', () => {
    require('../main.js');
    const onWebContents = getAppHandler('web-contents-created');
    const { contents, handlers } = makeFakeContents();
    onWebContents({}, contents);

    const event = { preventDefault: vi.fn() };
    handlers['will-navigate'](event, 'https://evil.com/phish');

    expect(event.preventDefault).toHaveBeenCalled();
    expect(mockShellOpenExternal).toHaveBeenCalledWith('https://evil.com/phish');
  });

  it('will-navigate: blocks javascript: URLs without opening externally', () => {
    require('../main.js');
    const onWebContents = getAppHandler('web-contents-created');
    const { contents, handlers } = makeFakeContents();
    onWebContents({}, contents);

    const event = { preventDefault: vi.fn() };
    handlers['will-navigate'](event, 'javascript:alert(1)');

    expect(event.preventDefault).toHaveBeenCalled();
    // javascript: is not http(s), so we must NOT hand it to the OS shell.
    expect(mockShellOpenExternal).not.toHaveBeenCalled();
  });

  it('setWindowOpenHandler: denies and opens https externally', () => {
    require('../main.js');
    const onWebContents = getAppHandler('web-contents-created');
    const { contents, handlers } = makeFakeContents();
    onWebContents({}, contents);

    const result = handlers.windowOpen({ url: 'https://docs.example.com/help' });

    expect(result).toEqual({ action: 'deny' });
    expect(mockShellOpenExternal).toHaveBeenCalledWith('https://docs.example.com/help');
  });

  it('setWindowOpenHandler: denies javascript: without opening externally', () => {
    require('../main.js');
    const onWebContents = getAppHandler('web-contents-created');
    const { contents, handlers } = makeFakeContents();
    onWebContents({}, contents);

    const result = handlers.windowOpen({ url: 'javascript:alert(1)' });

    expect(result).toEqual({ action: 'deny' });
    expect(mockShellOpenExternal).not.toHaveBeenCalled();
  });
});

describe('main process security — CSP header', () => {
  beforeEach(() => {
    delete require.cache[MAIN_PATH];
    mockLoadFile.mockClear();
    mockOn.mockClear();
    mockShellOpenExternal.mockClear();
    mockCrashReporterStart.mockClear();
    mockBrowserWindow.mockClear();
  });

  it('injects Content-Security-Policy on our own file:// responses', () => {
    require('../main.js');
    const onSession = getAppHandler('session-created');
    const { session, captured } = makeFakeSession();
    onSession(session);

    expect(captured.onHeadersReceived).not.toBeNull();

    const callback = vi.fn();
    captured.onHeadersReceived(
      { url: 'file:///home/user/app/src/index.html', responseHeaders: {} },
      callback,
    );

    expect(callback).toHaveBeenCalledTimes(1);
    const arg = callback.mock.calls[0][0];
    const csp = arg.responseHeaders['Content-Security-Policy'];
    expect(csp).toBeDefined();

    // main.js writes the CSP as a single joined string. Electron accepts
    // either a string or an array of strings, so we accept both here.
    const cspText = Array.isArray(csp) ? csp.join(' ') : csp;

    // Substring checks — no regex escaping to get wrong.
    expect(cspText).toContain("default-src 'self' file:");
    expect(cspText).toContain("object-src 'none'");
    expect(cspText).toContain("connect-src 'self'");
    expect(cspText).toContain('https://*.supabase.co');
    expect(cspText).toContain('wss://*.supabase.co');
    expect(cspText).toContain("script-src 'self'");

    // The auth flow requires hCaptcha (script + frame) and the HIBP
    // breach-check API — regressing either of these silently breaks
    // sign-in/sign-up in the shipped desktop build.
    expect(cspText).toContain('https://hcaptcha.com');
    expect(cspText).toContain('https://*.hcaptcha.com');
    expect(cspText).toContain('https://api.pwnedpasswords.com');
    expect(cspText).toMatch(/frame-src[^;]*hcaptcha\.com/);
  });

  it('preserves existing response headers on our own file:// responses', () => {
    require('../main.js');
    const onSession = getAppHandler('session-created');
    const { session, captured } = makeFakeSession();
    onSession(session);

    const callback = vi.fn();
    captured.onHeadersReceived(
      { url: 'file:///home/user/app/src/index.html', responseHeaders: { 'X-Custom': ['keep-me'] } },
      callback,
    );

    const arg = callback.mock.calls[0][0];
    expect(arg.responseHeaders['X-Custom']).toEqual(['keep-me']);
    expect(arg.responseHeaders['Content-Security-Policy']).toBeDefined();
  });

  it('does NOT override CSP on third-party responses (e.g. hCaptcha\'s own iframe)', () => {
    require('../main.js');
    const onSession = getAppHandler('session-created');
    const { session, captured } = makeFakeSession();
    onSession(session);

    const callback = vi.fn();
    const thirdPartyHeaders = {
      'Content-Security-Policy': ["default-src 'self' https://hcaptcha.com"],
      'X-Frame-Options': ['SAMEORIGIN'],
    };
    captured.onHeadersReceived(
      { url: 'https://hcaptcha.com/1/api.js', responseHeaders: thirdPartyHeaders },
      callback,
    );

    expect(callback).toHaveBeenCalledTimes(1);
    const arg = callback.mock.calls[0][0];
    // Headers must pass through untouched — our CSP must not clobber
    // hCaptcha's own security headers.
    expect(arg.responseHeaders).toBe(thirdPartyHeaders);
    expect(arg.responseHeaders['Content-Security-Policy']).toEqual(
      ["default-src 'self' https://hcaptcha.com"],
    );
  });

  it('does NOT override CSP on Supabase API responses', () => {
    require('../main.js');
    const onSession = getAppHandler('session-created');
    const { session, captured } = makeFakeSession();
    onSession(session);

    const callback = vi.fn();
    captured.onHeadersReceived(
      { url: 'https://tjjzeetbsxnkrgoiagbf.supabase.co/rest/v1/todos', responseHeaders: {} },
      callback,
    );

    const arg = callback.mock.calls[0][0];
    expect(arg.responseHeaders['Content-Security-Policy']).toBeUndefined();
  });
});