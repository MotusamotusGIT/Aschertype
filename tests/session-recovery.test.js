// tests/session-recovery.test.js
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mountAuthOnly, flushAsync, makeMockSupabaseClient } from './helpers/boot.js';

const mockGetSession = vi.fn();
const mockSignOut = vi.fn();

function mount(opts = {}) {
  return mountAuthOnly({
    supabaseClient: makeMockSupabaseClient({
      auth: {
        getSession: (...a) => mockGetSession(...a),
        signOut: (...a) => mockSignOut(...a),
      },
    }),
    ...opts,
  });
}

const flushLong = () => flushAsync(2000);

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
    mount();
    await flushAsync();
    expect(document.getElementById('auth-screen').classList.contains('hidden')).toBe(false);
  });

  it('retries once when getSession throws a network error', async () => {
    mockGetSession
      .mockRejectedValueOnce(new Error('Network down'))
      .mockResolvedValueOnce({
        data: { session: { user: { id: 'u1', email: 'a@b.co' } } },
        error: null,
      });
    mount();
    await flushLong();
    expect(mockGetSession.mock.calls.length).toBeGreaterThanOrEqual(2);
    expect(window.initApp).toHaveBeenCalled();
  });

  it('shows auth screen when both session check attempts fail', async () => {
    mockGetSession
      .mockRejectedValueOnce(new Error('Network down'))
      .mockRejectedValueOnce(new Error('Still down'));
    mount();
    await flushLong();
    expect(document.getElementById('auth-screen').classList.contains('hidden')).toBe(false);
  });

  it('a null session shows the auth screen and dismisses loading', async () => {
    mockGetSession.mockResolvedValue({ data: { session: null }, error: null });
    mount();
    await flushAsync();
    expect(document.getElementById('auth-screen').classList.contains('hidden')).toBe(false);
    expect(window.dismissLoading).toHaveBeenCalled();
  });

  it('a valid session calls initApp and never shows the auth screen', async () => {
    mockGetSession.mockResolvedValue({
      data: { session: { user: { id: 'u1', email: 'a@b.co' } } },
      error: null,
    });
    mount();
    await flushAsync();
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
    // Set the flag first, then mount WITH it preserved so
    // resolveInitialAuthState sees it at boot time — this is the actual
    // short-circuit path, not an after-the-fact assertion.
    sessionStorage.setItem('aschertypeGuest', 'true');
    mount({ preserveSession: true });
    await flushAsync();

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
    mount();
    sessionStorage.setItem('aschertypeGuest', 'true');
    if (typeof window.signOutAndReset === 'function') {
      await expect(window.signOutAndReset()).resolves.not.toThrow();
    }
    expect(sessionStorage.getItem('aschertypeGuest')).toBe(null);
  });
});