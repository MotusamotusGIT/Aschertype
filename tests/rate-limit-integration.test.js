// tests/rate-limit-integration.test.js
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = typeof __dirname !== 'undefined'
  ? __dirname
  : dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '..', 'src');

const mockSignIn = vi.fn();

function makeMockClient() {
  return {
    auth: {
      signInWithPassword: (...a) => mockSignIn(...a),
      signUp: vi.fn(async () => ({ data: { user: null, session: null }, error: null })),
      signOut: vi.fn(async () => ({ error: null })),
      resetPasswordForEmail: vi.fn(async () => ({ data: null, error: null })),
      getUser: vi.fn(async () => ({ data: { user: null }, error: null })),
      onAuthStateChange: vi.fn(() => ({
        data: { subscription: { unsubscribe: vi.fn() } },
      })),
      getSession: vi.fn(async () => ({ data: { session: null }, error: null })),
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

function mount() {
  sessionStorage.clear();
  loadIndexHtml();
  window.initApp = vi.fn(async () => {});
  window.dismissLoading = vi.fn();
  window.supabaseClient = makeMockClient();
  window.supabaseReady = true;
  loadUtils();
  loadAuth();
}

function submit(email, password) {
  document.getElementById('login-email').value = email;
  document.getElementById('login-password').value = password;
  document.getElementById('login-form').dispatchEvent(
    new window.Event('submit', { bubbles: true, cancelable: true }),
  );
}
const flush = () => new Promise((r) => setTimeout(r, 10));

describe('rate limit integration — login form', () => {
  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
    mockSignIn.mockReset();
    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});
  });
  afterEach(() => vi.restoreAllMocks());

  it('5 failed logins block the 6th before calling Supabase', async () => {
    mockSignIn.mockResolvedValue({
      data: { user: null, session: null },
      error: { message: 'Invalid login credentials' },
    });

    mount();
    for (let i = 0; i < 5; i++) {
      submit('a@b.co', 'wrongpass');
      await flush();
    }
    const callsBefore = mockSignIn.mock.calls.length;

    submit('a@b.co', 'wrongpass');
    await flush();

    expect(mockSignIn.mock.calls.length).toBe(callsBefore);
    const err = document.getElementById('auth-error');
    expect(err.textContent).toMatch(/too many|wait/i);
  });

  it('rate limit error mentions a wait time', async () => {
    mockSignIn.mockResolvedValue({
      data: { user: null, session: null },
      error: { message: 'Invalid login credentials' },
    });

    mount();
    for (let i = 0; i < 5; i++) {
      submit('a@b.co', 'wrongpass');
      await flush();
    }
    submit('a@b.co', 'wrongpass');
    await flush();
    const err = document.getElementById('auth-error').textContent;
    expect(err).toMatch(/(second|minute)/i);
  });

  it('a successful login after a few failures clears the rate limit', async () => {
    mockSignIn.mockResolvedValueOnce({
      data: { user: null, session: null },
      error: { message: 'Invalid login credentials' },
    });
    mockSignIn.mockResolvedValue({
      data: { user: { id: 'u1', email: 'a@b.co' }, session: { access_token: 't' } },
      error: null,
    });

    mount();
    submit('a@b.co', 'wrongpass');
    await flush();
    submit('a@b.co', 'password123');
    await flush();

    const state = JSON.parse(localStorage.getItem('aschertypeRateLimits') || '{}');
    expect(state.login?.failStreak || 0).toBe(0);
    expect(window.initApp).toHaveBeenCalled();
  });
});