import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'jsdom',
    globals: true,
    include: ['tests/**/*.test.js'],
    setupFiles: ['./tests/setup.js'],

    // Fail fast in CI instead of hanging on a stuck test.
    testTimeout: 10000,
    hookTimeout: 10000,

    coverage: {
      provider: 'v8',
      reporter: ['text', 'html', 'lcov'], // lcov for CI/Codecov ingestion
      include: ['src/**/*.js'],
      exclude: [
        'src/loader.js',  // thin script-tag bootstrapper, no logic to test
        'src/sw.js',      // service worker — needs its own SW test harness, not jsdom
        'src/confirm.js', // trivial hash-parsing + DOM text swap, low risk
        // auth.js and db.js are intentionally NOT excluded — they're the
        // highest-risk code in the app (auth flow, rate limiting, RLS-
        // dependent data access) and are directly covered by
        // rate-limit-integration.test.js, session-recovery.test.js, and
        // realtime.test.js. Excluding them would hide exactly the
        // coverage that matters most.
      ],
      thresholds: {
        // Global floor — CI fails if overall coverage drops below this.
        lines: 75,
        functions: 75,
        branches: 70,
        statements: 75,
        // Per-file floor for the highest-risk modules — a single
        // under-tested auth/db file can't hide behind a healthy average
        // elsewhere in src/.
        'src/auth.js': {
          lines: 80,
          functions: 80,
          branches: 75,
          statements: 80,
        },
        'src/db.js': {
          lines: 70,
          functions: 70,
          branches: 60,
          statements: 70,
        },
        'src/utils.js': {
          lines: 85,
          functions: 85,
          branches: 80,
          statements: 85,
        },
      },
    },
  },
});