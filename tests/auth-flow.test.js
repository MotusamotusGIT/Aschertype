// tests/auth-flow.test.js
// Exercises auth.js against a mocked Supabase client.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = typeof __dirname !== 'undefined'
  ? __dirname
  : dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '..', 'src');

// ---- Supabase mock ----
const mockSignIn = vi.fn();
const mockSignUp = vi.fn();
const mockSignOut = vi.fn();
const mockGetSession = vi.fn().mockResolvedValue({ data: { session: null }, error: null });
const mockResetPassword = vi.fn();
const mockOnAuthStateChange = vi.fn(() => ({
  data: { subscription: { unsubscribe: vi.fn() } },
}));

function makeMockClient() {
  return {
    auth: {
      signInWithPassword: (...a) => mockSignIn(...a),
      signUp: (...a) => mockSignUp(...a),
      signOut: (...a) => mockSignOut(...a),
      getSession: (...a) => mockGetSession(...a),
      resetPasswordForEmail: (...a) => mockResetPassword(...a),
      onAuthStateChange: (...a) => mockOnAuthStateChange(...a),
    },
  };
}

function loadIndexHtml() {
  const raw = readFileSync(resolve(ROOT, 'index.html'), 'utf8');
  const bodyMatch = raw.match(/<body[^>]*>([\s\S]*)<\/body>/i);
  const body = (bodyMatch ? bodyMatch[1] : raw).replace(/<script[\s\S]*?<\/script>/gi, '');
  document.body.innerHTML = body;
}

function loadUtils() {
  const src = readFileSync(resolve(ROOT, 'utils.js'), 'utf8');
  const wrapped = `(function(){\n${src}\n})();`;
  // eslint-disable-next-line no-new-func
  new Function('window', 'localStorage', 'sessionStorage', wrapped)(
    window, window.localStorage, window.sessionStorage,
  );
}

function loadAuth() {
  const src = readFileSync(resolve(ROOT, 'auth.js'), 'utf8');
  const wrapped = `(function(){\n${src}\n})();`;
  // eslint-disable-next-line no-new-func
  new Function(
    'window', 'document', 'navigator', 'localStorage',
    'sessionStorage', 'location', 'Notification',
    wrapped,
  )(
    window, window.document, window.navigator, window.localStorage,
    window.sessionStorage, window.location, window.Notification,
  );
}

// IMPORTANT: does NOT clear localStorage — tests that seed rate-limit
// state need the seed to survive into mount. beforeEach clears it.
function mountAuth({ supabaseReady = true } = {}) {
  sessionStorage.clear();
  loadIndexHtml();

  window.initApp = vi.fn(async () => {});
  window.dismissLoading = vi.fn();
  window.supabaseClient = makeMockClient();
  window.supabaseReady = supabaseReady;

  loadUtils();
  loadAuth();
}

function fillLogin(email, password, forget = false) {
  document.getElementById('login-email').value = email;
  document.getElementById('login-password').value = password;
  document.getElementById('login-forget-session').checked = forget;
}
function submitLogin() {
  document.getElementById('login-form').dispatchEvent(
    new window.Event('submit', { bubbles: true, cancelable: true }),
  );
}
function fillRegister(email, password, confirm) {
  document.getElementById('register-email').value = email;
  document.getElementById('register-password').value = password;
  document.getElementById('register-confirm').value = confirm;
}
function submitRegister() {
  document.getElementById('register-form').dispatchEvent(
    new window.Event('submit', { bubbles: true, cancelable: true }),
  );
}
const flush = () => new Promise((r) => setTimeout(r, 0));
const flushTwice = () => new Promise((r) => setTimeout(r, 20));
function authErrorText() {
  const el = document.getElementById('auth-error');
  return el.style.display === 'none' ? '' : el.textContent;
}
function authNoticeText() {
  const el = document.getElementById('auth-notice');
  return el.style.display === 'none' ? '' : el.textContent;
}

/* ------------------------------------------------------------------ */

describe('auth flow — login', () => {
  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
    mockSignIn.mockReset();
    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});
  });
  afterEach(() => vi.restoreAllMocks());

  it('successful login calls initApp with the user', async () => {
    mockSignIn.mockResolvedValue({
      data: { user: { id: 'u1', email: 'a@b.co' }, session: { access_token: 'tok' } },
      error: null,
    });
    mountAuth();
    fillLogin('a@b.co', 'password123');
    submitLogin();
    await flush();

    expect(mockSignIn).toHaveBeenCalledWith({ email: 'a@b.co', password: 'password123' });
    expect(window.initApp).toHaveBeenCalledWith({ id: 'u1', email: 'a@b.co' });
  });

  it('successful login hides the auth screen', async () => {
    mockSignIn.mockResolvedValue({
      data: { user: { id: 'u1', email: 'a@b.co' }, session: { access_token: 'tok' } },
      error: null,
    });
    mountAuth();
    fillLogin('a@b.co', 'password123');
    submitLogin();
    await flush();
    expect(document.getElementById('auth-screen').classList.contains('hidden')).toBe(true);
  });

  it('wrong password shows the error and does not call initApp', async () => {
    mockSignIn.mockResolvedValue({
      data: { user: null, session: null },
      error: { message: 'Invalid login credentials' },
    });
    mountAuth();
    fillLogin('a@b.co', 'wrongpass');
    submitLogin();
    await flush();
    expect(authErrorText()).toMatch(/incorrect email or password/i);
    expect(window.initApp).not.toHaveBeenCalled();
  });

  it('wrong password records a failure in the rate limiter', async () => {
    mockSignIn.mockResolvedValue({
      data: { user: null, session: null },
      error: { message: 'Invalid login credentials' },
    });
    mountAuth();
    fillLogin('a@b.co', 'wrongpass');
    submitLogin();
    await flush();
    const state = JSON.parse(localStorage.getItem('aschertypeRateLimits') || '{}');
    expect(state.login?.failStreak).toBeGreaterThanOrEqual(1);
  });

  it('rejects malformed email before calling Supabase', async () => {
    mountAuth();
    fillLogin('not-an-email', 'password123');
    submitLogin();
    await flush();
    expect(mockSignIn).not.toHaveBeenCalled();
    expect(authErrorText()).toMatch(/valid email/i);
  });

  it('blocks when rate limit is hit', async () => {
    localStorage.setItem('aschertypeRateLimits', JSON.stringify({
      login: { history: [Date.now(), Date.now(), Date.now(), Date.now(), Date.now()], failStreak: 0, lockUntil: 0 },
    }));
    mountAuth();
    fillLogin('a@b.co', 'password123');
    submitLogin();
    await flush();
    expect(mockSignIn).not.toHaveBeenCalled();
    expect(authErrorText()).toMatch(/too many sign-in attempts/i);
  });

  it('clears the rate-limit state on success', async () => {
    localStorage.setItem('aschertypeRateLimits', JSON.stringify({
      login: { history: [Date.now()], failStreak: 1, lockUntil: 0 },
    }));
    mockSignIn.mockResolvedValue({
      data: { user: { id: 'u1', email: 'a@b.co' }, session: { access_token: 'tok' } },
      error: null,
    });
    mountAuth();
    fillLogin('a@b.co', 'password123');
    submitLogin();
    await flush();
    const state = JSON.parse(localStorage.getItem('aschertypeRateLimits') || '{}');
    expect(state.login?.failStreak || 0).toBe(0);
  });

  it('stores the "forget session" preference when checked', async () => {
    mockSignIn.mockResolvedValue({
      data: { user: { id: 'u1', email: 'a@b.co' }, session: { access_token: 'tok' } },
      error: null,
    });
    mountAuth();
    fillLogin('a@b.co', 'password123', true);
    submitLogin();
    await flush();
    expect(localStorage.getItem('aschertypeRememberSession')).toBe('false');
  });

  it('shows a specific error when Supabase is not configured', async () => {
    mountAuth({ supabaseReady: false });
    fillLogin('a@b.co', 'password123');
    submitLogin();
    await flush();
    expect(mockSignIn).not.toHaveBeenCalled();
    expect(authErrorText()).toMatch(/not set up/i);
  });
});

describe('auth flow — register', () => {
  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
    mockSignUp.mockReset();
    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});
  });
  afterEach(() => vi.restoreAllMocks());

  it('valid registration calls Supabase with email, password, and redirect', async () => {
    mockSignUp.mockResolvedValue({
      data: { user: { id: 'u2', email: 'new@b.co' }, session: null },
      error: null,
    });
    mountAuth();
    document.getElementById('auth-tab-register').click();
    fillRegister('new@b.co', 'password123', 'password123');
    submitRegister();
    await flush();
    expect(mockSignUp).toHaveBeenCalledWith({
      email: 'new@b.co',
      password: 'password123',
      options: { emailRedirectTo: expect.stringContaining('/confirm.html') },
    });
  });

  it('registration without a session shows the check-email notice', async () => {
    mockSignUp.mockResolvedValue({
      data: { user: { id: 'u2', email: 'new@b.co' }, session: null },
      error: null,
    });
    mountAuth();
    document.getElementById('auth-tab-register').click();
    fillRegister('new@b.co', 'password123', 'password123');
    submitRegister();
    await flush();
    expect(authNoticeText()).toMatch(/check your email/i);
    expect(window.initApp).not.toHaveBeenCalled();
  });

  it('registration with an immediate session calls initApp', async () => {
    mockSignUp.mockResolvedValue({
      data: { user: { id: 'u2', email: 'new@b.co' }, session: { access_token: 'tok' } },
      error: null,
    });
    mountAuth();
    document.getElementById('auth-tab-register').click();
    fillRegister('new@b.co', 'password123', 'password123');
    submitRegister();
    await flush();
    expect(window.initApp).toHaveBeenCalledWith({ id: 'u2', email: 'new@b.co' });
  });

  it('rejects a short password', async () => {
    mountAuth();
    document.getElementById('auth-tab-register').click();
    fillRegister('new@b.co', 'short', 'short');
    submitRegister();
    await flush();
    expect(mockSignUp).not.toHaveBeenCalled();
    expect(authErrorText()).toMatch(/at least 8/i);
  });

  it('rejects a password without letters', async () => {
    mountAuth();
    document.getElementById('auth-tab-register').click();
    fillRegister('new@b.co', '12345678', '12345678');
    submitRegister();
    await flush();
    expect(mockSignUp).not.toHaveBeenCalled();
    expect(authErrorText()).toMatch(/letters and numbers/i);
  });

  it('rejects a password without numbers', async () => {
    mountAuth();
    document.getElementById('auth-tab-register').click();
    fillRegister('new@b.co', 'passwordonly', 'passwordonly');
    submitRegister();
    await flush();
    expect(mockSignUp).not.toHaveBeenCalled();
  });

  it('rejects mismatched passwords', async () => {
    mountAuth();
    document.getElementById('auth-tab-register').click();
    fillRegister('new@b.co', 'password123', 'different456');
    submitRegister();
    await flush();
    expect(mockSignUp).not.toHaveBeenCalled();
    expect(authErrorText()).toMatch(/do not match/i);
  });

  it('surfaces a Supabase error on registration', async () => {
    mockSignUp.mockResolvedValue({
      data: { user: null, session: null },
      error: { message: 'User already registered' },
    });
    mountAuth();
    document.getElementById('auth-tab-register').click();
    fillRegister('new@b.co', 'password123', 'password123');
    submitRegister();
    await flush();
    expect(authErrorText()).toMatch(/already registered/i);
  });
});

describe('auth flow — guest', () => {
  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});
  });
  afterEach(() => vi.restoreAllMocks());

  it('guest link persists the flag and calls initApp(null)', async () => {
    mountAuth();
    document.getElementById('auth-guest-link').click();
    await flush();
    expect(localStorage.getItem('aschertypeGuest')).toBe('true');
    expect(sessionStorage.getItem('aschertypeGuest')).toBe('true');
    expect(window.initApp).toHaveBeenCalledWith(null);
  });

  it('guest link hides the auth screen', async () => {
    mountAuth();
    document.getElementById('auth-guest-link').click();
    await flush();
    expect(document.getElementById('auth-screen').classList.contains('hidden')).toBe(true);
  });
});

describe('auth flow — forgot password', () => {
  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
    mockResetPassword.mockReset();
    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});
  });
  afterEach(() => vi.restoreAllMocks());

  it('sends a reset email when an email is present', async () => {
    mockResetPassword.mockResolvedValue({ data: {}, error: null });
    mountAuth();
    document.getElementById('login-email').value = 'a@b.co';
    document.getElementById('forgot-password-btn').click();
    await flush();
    expect(mockResetPassword).toHaveBeenCalledWith(
      'a@b.co',
      expect.objectContaining({ redirectTo: expect.stringContaining('/confirm.html') }),
    );
    expect(authNoticeText()).toMatch(/reset link/i);
  });

  it('asks for an email first when the field is empty', async () => {
    mountAuth();
    document.getElementById('login-email').value = '';
    document.getElementById('forgot-password-btn').click();
    await flush();
    expect(mockResetPassword).not.toHaveBeenCalled();
    expect(authErrorText()).toMatch(/enter your email/i);
  });

  it('rejects a malformed email', async () => {
    mountAuth();
    document.getElementById('login-email').value = 'not-an-email';
    document.getElementById('forgot-password-btn').click();
    await flush();
    expect(mockResetPassword).not.toHaveBeenCalled();
    expect(authErrorText()).toMatch(/valid email/i);
  });

  it('always shows the neutral success message even on a Supabase error', async () => {
    mockResetPassword.mockResolvedValue({ data: null, error: { message: 'rate limit' } });
    mountAuth();
    document.getElementById('login-email').value = 'a@b.co';
    document.getElementById('forgot-password-btn').click();
    await flush();
    expect(authNoticeText()).toMatch(/reset link/i);
    expect(authErrorText()).toBe('');
  });
});

describe('auth flow — sign out', () => {
  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
    mockSignOut.mockReset();
    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});
  });
  afterEach(() => vi.restoreAllMocks());

  it('signOutAndReset clears the guest flag and calls signOut', async () => {
    mockSignOut.mockResolvedValue({ error: null });
    mountAuth();
    sessionStorage.setItem('aschertypeGuest', 'true');
    if (typeof window.signOutAndReset === 'function') {
      await window.signOutAndReset();
    }
    await flush();
    expect(mockSignOut).toHaveBeenCalled();
    expect(sessionStorage.getItem('aschertypeGuest')).toBe(null);
  });
});

describe('auth flow — initial state resolution', () => {
  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
    mockGetSession.mockReset();
    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});
  });
  afterEach(() => vi.restoreAllMocks());

  it('a valid session calls initApp with the user', async () => {
    mockGetSession.mockResolvedValue({
      data: { session: { user: { id: 'u1', email: 'a@b.co' } } },
      error: null,
    });
    mountAuth();
    await flushTwice();
    expect(window.initApp).toHaveBeenCalledWith({ id: 'u1', email: 'a@b.co' });
  });

  it('no session shows the auth screen and dismisses the loading overlay', async () => {
    mockGetSession.mockResolvedValue({ data: { session: null }, error: null });
    mountAuth();
    await flushTwice();
    expect(document.getElementById('auth-screen').classList.contains('hidden')).toBe(false);
    expect(window.dismissLoading).toHaveBeenCalled();
  });

  it('falls back to local-only mode when Supabase is not configured', async () => {
    mountAuth({ supabaseReady: false });
    await flush();
    expect(window.initApp).toHaveBeenCalledWith(null);
  });
});