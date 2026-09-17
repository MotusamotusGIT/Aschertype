// tests/utils.test.js
import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  isPlausibleEmail,
  formatWait,
  checkRateLimit,
  recordAttempt,
  recordFailure,
  recordSuccess,
  loadRateLimitState,
  getRememberPreference,
  setRememberPreference,
  rememberAwareStorage,
} from '../src/utils.js';

/* ------------------------------------------------------------------ */
/* Email                                                                */
/* ------------------------------------------------------------------ */
describe('isPlausibleEmail', () => {
  it('accepts normal addresses', () => {
    expect(isPlausibleEmail('a@b.co')).toBe(true);
    expect(isPlausibleEmail('user.name+tag@example.org')).toBe(true);
    expect(isPlausibleEmail('USER@EXAMPLE.COM')).toBe(true);
  });

  it('rejects junk', () => {
    expect(isPlausibleEmail('')).toBe(false);
    expect(isPlausibleEmail('no-at-sign')).toBe(false);
    expect(isPlausibleEmail('a@b')).toBe(false);
    expect(isPlausibleEmail('a b@c.com')).toBe(false);
    expect(isPlausibleEmail('@example.com')).toBe(false);
    expect(isPlausibleEmail('user@')).toBe(false);
    expect(isPlausibleEmail('a@@b.com')).toBe(false);
  });
});

/* ------------------------------------------------------------------ */
/* formatWait                                                           */
/* ------------------------------------------------------------------ */
describe('formatWait', () => {
  it('formats seconds under a minute', () => {
    expect(formatWait(1000)).toBe('1 second');
    expect(formatWait(5000)).toBe('5 seconds');
    expect(formatWait(59000)).toBe('59 seconds');
  });

  it('rounds up to the next second', () => {
    expect(formatWait(1)).toBe('1 second');
    expect(formatWait(1500)).toBe('2 seconds');
  });

  it('formats minutes over 60s', () => {
    expect(formatWait(60000)).toBe('1 minute');
    expect(formatWait(120000)).toBe('2 minutes');
    expect(formatWait(90000)).toBe('2 minutes');
  });
});

/* ------------------------------------------------------------------ */
/* Rate limiter                                                         */
/* ------------------------------------------------------------------ */
describe('rate limiter', () => {
  it('allows attempts under the limit', () => {
    expect(checkRateLimit('login', 3, 60000).limited).toBe(false);
    recordAttempt('login', 60000);
    expect(checkRateLimit('login', 3, 60000).limited).toBe(false);
    recordAttempt('login', 60000);
    expect(checkRateLimit('login', 3, 60000).limited).toBe(false);
  });

  it('blocks when the limit is hit', () => {
    for (let i = 0; i < 3; i++) recordAttempt('login', 60000);
    const r = checkRateLimit('login', 3, 60000);
    expect(r.limited).toBe(true);
    expect(r.waitMs).toBeGreaterThan(0);
  });

  it('prunes old attempts outside the window', () => {
    vi.useFakeTimers();
    try {
      recordAttempt('login', 60000);
      recordAttempt('login', 60000);
      vi.advanceTimersByTime(61000);
      expect(checkRateLimit('login', 2, 60000).limited).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });

  it('locks after repeated failures with exponential backoff', () => {
    recordFailure('login');
    recordFailure('login');
    expect(checkRateLimit('login', 5, 60000).limited).toBe(false);
    recordFailure('login'); // 3rd failure triggers lock
    const r = checkRateLimit('login', 5, 60000);
    expect(r.limited).toBe(true);
    expect(r.waitMs).toBeGreaterThan(0);
  });

  it('backs off longer with each additional failure', () => {
    recordFailure('login');
    recordFailure('login');
    recordFailure('login'); // failStreak 3 → 30s
    const first = checkRateLimit('login', 5, 60000).waitMs;

    recordFailure('login'); // failStreak 4 → 60s
    const second = checkRateLimit('login', 5, 60000).waitMs;

    expect(second).toBeGreaterThan(first);
  });

  it('caps the backoff at 10 minutes', () => {
    // 3 → 30s, 4 → 60s, 5 → 120s, 6 → 240s, 7 → 480s, 8 → 600s (capped)
    for (let i = 0; i < 8; i++) recordFailure('login');
    const { waitMs } = checkRateLimit('login', 5, 60000);
    expect(waitMs).toBeLessThanOrEqual(600_000);
  });

  it('clears state on success', () => {
    recordAttempt('login', 60000);
    recordFailure('login');
    recordSuccess('login');
    expect(loadRateLimitState().login).toEqual({
      history: [],
      failStreak: 0,
      lockUntil: 0,
    });
  });

  it('treats different action keys independently', () => {
    for (let i = 0; i < 3; i++) recordAttempt('login', 60000);
    expect(checkRateLimit('login', 3, 60000).limited).toBe(true);
    expect(checkRateLimit('register', 3, 60000).limited).toBe(false);
  });
});

/* ------------------------------------------------------------------ */
/* Remember-session preference                                          */
/* ------------------------------------------------------------------ */
describe('remember preference', () => {
  it('defaults to true when unset', () => {
    expect(getRememberPreference()).toBe(true);
  });

  it('persists an explicit false', () => {
    setRememberPreference(false);
    expect(getRememberPreference()).toBe(false);
  });

  it('persists an explicit true', () => {
    setRememberPreference(true);
    expect(getRememberPreference()).toBe(true);
  });
});

/* ------------------------------------------------------------------ */
/* rememberAwareStorage                                                 */
/* ------------------------------------------------------------------ */
describe('rememberAwareStorage', () => {
  it('writes to localStorage when remember is on', () => {
    setRememberPreference(true);
    rememberAwareStorage.setItem('foo', 'bar');
    expect(localStorage.getItem('foo')).toBe('bar');
    expect(sessionStorage.getItem('foo')).toBe(null);
  });

  it('writes to sessionStorage when remember is off', () => {
    setRememberPreference(false);
    rememberAwareStorage.setItem('foo', 'bar');
    expect(sessionStorage.getItem('foo')).toBe('bar');
    expect(localStorage.getItem('foo')).toBe(null);
  });

  it('reads from the preferred storage first', () => {
    localStorage.setItem('foo', 'local');
    sessionStorage.setItem('foo', 'session');

    setRememberPreference(true);
    expect(rememberAwareStorage.getItem('foo')).toBe('local');

    setRememberPreference(false);
    expect(rememberAwareStorage.getItem('foo')).toBe('session');
  });

  it('falls back to the other storage when the preferred one is empty', () => {
    sessionStorage.setItem('foo', 'session-only');
    setRememberPreference(true);
    expect(rememberAwareStorage.getItem('foo')).toBe('session-only');

    localStorage.setItem('bar', 'local-only');
    setRememberPreference(false);
    expect(rememberAwareStorage.getItem('bar')).toBe('local-only');
  });

  it('returns null when the key exists in neither storage', () => {
    expect(rememberAwareStorage.getItem('missing')).toBe(null);
  });

  it('removeItem clears both storages', () => {
    localStorage.setItem('foo', 'a');
    sessionStorage.setItem('foo', 'b');
    rememberAwareStorage.removeItem('foo');
    expect(localStorage.getItem('foo')).toBe(null);
    expect(sessionStorage.getItem('foo')).toBe(null);
  });
});