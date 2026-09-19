// tests/rate-limit-integration.test.js
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mountAuthOnly, submitLogin, flushAsync, makeMockSupabaseClient } from './helpers/boot.js';

const mockSignIn = vi.fn();

function mount() {
  return mountAuthOnly({
    supabaseClient: makeMockSupabaseClient({
      auth: { signInWithPassword: (...a) => mockSignIn(...a) },
    }),
  });
}

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
      submitLogin('a@b.co', 'wrongpass');
      await flushAsync(10);
    }
    const callsBefore = mockSignIn.mock.calls.length;

    submitLogin('a@b.co', 'wrongpass');
    await flushAsync(10);

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
      submitLogin('a@b.co', 'wrongpass');
      await flushAsync(10);
    }
    submitLogin('a@b.co', 'wrongpass');
    await flushAsync(10);
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
    submitLogin('a@b.co', 'wrongpass');
    await flushAsync(10);
    submitLogin('a@b.co', 'password123');
    await flushAsync(10);

    const state = JSON.parse(localStorage.getItem('aschertypeRateLimits') || '{}');
    expect(state.login?.failStreak || 0).toBe(0);
    expect(window.initApp).toHaveBeenCalled();
  });

  it('rate limit keys are independent per action (login failures don\'t block register)', async () => {
    mockSignIn.mockResolvedValue({
      data: { user: null, session: null },
      error: { message: 'Invalid login credentials' },
    });
    mount();
    for (let i = 0; i < 5; i++) {
      submitLogin('a@b.co', 'wrongpass');
      await flushAsync(10);
    }
    const state = JSON.parse(localStorage.getItem('aschertypeRateLimits') || '{}');
    expect(state.register).toBeUndefined();
  });
});