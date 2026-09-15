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
} from '../src/utils.js';

describe('isPlausibleEmail', () => {
  it('accepts normal addresses', () => {
    expect(isPlausibleEmail('a@b.co')).toBe(true);
    expect(isPlausibleEmail('user.name+tag@example.org')).toBe(true);
  });

  it('rejects junk', () => {
    expect(isPlausibleEmail('')).toBe(false);
    expect(isPlausibleEmail('no-at-sign')).toBe(false);
    expect(isPlausibleEmail('a@b')).toBe(false);
    expect(isPlausibleEmail('a b@c.com')).toBe(false);
  });
});

describe('formatWait', () => {
  it('formats seconds under a minute', () => {
    expect(formatWait(1000)).toBe('1 second');
    expect(formatWait(5000)).toBe('5 seconds');
  });

  it('formats minutes over 60s', () => {
    expect(formatWait(60000)).toBe('1 minute');
    expect(formatWait(120000)).toBe('2 minutes');
  });
});

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
    recordAttempt('login', 60000);
    recordAttempt('login', 60000);
    vi.advanceTimersByTime(61000);
    expect(checkRateLimit('login', 2, 60000).limited).toBe(false);
    vi.useRealTimers();
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

  it('clears state on success', () => {
    recordAttempt('login', 60000);
    recordFailure('login');
    recordSuccess('login');
    expect(loadRateLimitState().login).toEqual({ history: [], failStreak: 0, lockUntil: 0 });
  });
});