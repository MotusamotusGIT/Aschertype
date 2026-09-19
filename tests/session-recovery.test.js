// tests/session-recovery.test.js
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = typeof __dirname !== 'undefined'
  ? __dirname
  : dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '..', 'src');

const mockGetSession = vi.fn();
const mockSignOut = vi.fn();

function makeMockClient() {
  return {
    auth: {
      getSession: (...a) => mockGetSession(...a),
      signOut: (...a) => mockSignOut(...a),
      signInWithPassword: vi.fn(async () => ({
        data: { user: null, session: null },
        error: { message: 'not used' },
      })),
      signUp: vi.fn(async () => ({
        data: { user: null, session: null },
        error: null,
      })),
      resetPasswordForEmail: vi.fn(async () => ({ data: null, error: null })),
      getUser: vi.fn(async () => ({ data: { user: null }, error: null })),
      onAuthStateChange: vi.fn(() => ({
        data: { subscription: { unsubscribe: vi.fn() } },
      })),
    },
  };
}

function loadIndexHtml() {
  const raw = readFileSync(resolve(ROOT, 'index.html'), 'utf8');
  const m = raw.match(/<body[^>]*>([\s\S]*)<\/body>/i);
  document.body.innerHTML = (m ? m[1] : raw).replace(/<script[\s\S]*?<\/script>/gi, '');
}

function loadUtils() {
  const src = readFileSync(resolve(ROOT, 'utils.js'), 'utf8');
  new Function('window', 'localStorage', 'sessionStorage', `(function(){${src}})();`)(
    window, window.localStorage, window.sessionStorage,
  );
}

function loadAuth() {
  const src = readFileSync(resolve(ROOT, 'auth.js'), 'utf8');
  new Function(
    'window', 'document', 'navigator', 'localStorage',
    'sessionStorage', 'location', 'Notification',
    `(function(){${src}})();`,
  )(
    window, window.document, window.navigator, window.localStorage,
    window.sessionStorage, window.location, window.Notification,
  );
}

function mountAuth() {
  sessionStorage.clear();
  loadIndexHtml();
  window.initApp = vi.fn(async () => {});
  window.dismissLoading = vi.fn();
  window.supabaseClient = makeMockClient();
  window.supabaseReady = true;
  loadUtils();
  loadAuth();
}

const flush = () => new Promise((r) => setTimeout(r, 30));
const flushLong = () => new Promise((r) => setTimeout(r, 2000));

describe('session recovery — getSession errors', () => {
  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
    mockGetSession.mockReset();
    mockSignOut.mockReset();
    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});
  });
  afterEach(() => vi.restoreAllMocks());

  it('shows auth screen when getSession returns an "invalid" error', async () => {
    mockGetSession.mockResolvedValue({
      data: { session: null },
      error: { message: 'Invalid refresh token' },
    });
    mountAuth();
    await flush();
    expect(document.getElementById('auth-screen').classList.contains('hidden')).toBe(false);
  });

  it('retries once when getSession throws a network error', async () => {
    mockGetSession
      .mockRejectedValueOnce(new Error('Network down'))
      .mockResolvedValueOnce({
        data: { session: { user: { id: 'u1', email: 'a@b.co' } } },
        error: null,
      });
    mountAuth();
    await flushLong();
    expect(mockGetSession.mock.calls.length).toBeGreaterThanOrEqual(2);
    expect(window.initApp).toHaveBeenCalled();
  });

  it('shows auth screen when both session check attempts fail', async () => {
    mockGetSession
      .mockRejectedValueOnce(new Error('Network down'))
      .mockRejectedValueOnce(new Error('Still down'));
    mountAuth();
    await flushLong();
    expect(document.getElementById('auth-screen').classList.contains('hidden')).toBe(false);
  });

  it('a null session shows the auth screen and dismisses loading', async () => {
    mockGetSession.mockResolvedValue({ data: { session: null }, error: null });
    mountAuth();
    await flush();
    expect(document.getElementById('auth-screen').classList.contains('hidden')).toBe(false);
    expect(window.dismissLoading).toHaveBeenCalled();
  });

  it('a valid session calls initApp and never shows the auth screen', async () => {
    mockGetSession.mockResolvedValue({
      data: { session: { user: { id: 'u1', email: 'a@b.co' } } },
      error: null,
    });
    mountAuth();
    await flush();
    expect(window.initApp).toHaveBeenCalledWith({ id: 'u1', email: 'a@b.co' });
    expect(document.getElementById('auth-screen').classList.contains('hidden')).toBe(true);
  });
});

describe('session recovery — guest and offline modes', () => {
  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
    mockGetSession.mockReset();
    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});
  });
  afterEach(() => vi.restoreAllMocks());

  it('the guest flag short-circuits the session check', async () => {
    // NOTE: set the flag AFTER mountAuth (which clears sessionStorage).
    mountAuth();
    sessionStorage.setItem('aschertypeGuest', 'true');
    // Auth already ran resolveInitialAuthState before we set the flag,
    // so we cannot assert "getSession was never called" here. Instead we
    // verify the flag path works when the flag is present at boot time.
    // Reset the DOM and re-run with the flag pre-set.
    document.body.innerHTML = '';
    window.initApp.mockClear();
    mockGetSession.mockClear();
    loadIndexHtml();
    window.supabaseClient = makeMockClient();
    window.supabaseReady = true;
    // sessionStorage still has the flag (loadIndexHtml doesn't clear it)
    loadAuth();
    await flush();
    expect(mockGetSession).not.toHaveBeenCalled();
    expect(window.initApp).toHaveBeenCalledWith(null);
  });
});

describe('session recovery — sign out is safe', () => {
  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
    mockSignOut.mockReset();
    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});
  });
  afterEach(() => vi.restoreAllMocks());

  it('sign out survives signOut() throwing', async () => {
    mockSignOut.mockRejectedValue(new Error('network'));
    mountAuth();
    sessionStorage.setItem('aschertypeGuest', 'true');
    if (typeof window.signOutAndReset === 'function') {
      await expect(window.signOutAndReset()).resolves.not.toThrow();
    }
    expect(sessionStorage.getItem('aschertypeGuest')).toBe(null);
  });
});