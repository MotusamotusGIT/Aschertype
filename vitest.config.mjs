import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'jsdom',
    globals: true,
    include: ['tests/**/*.test.js'],
    setupFiles: ['./tests/setup.js'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html'],
      include: ['src/**/*.js'],
      exclude: [
        'src/loader.js',
        'src/sw.js',
        'src/confirm.js',
        'src/auth.js',
        'src/db.js',
      ],
    },
  },
});