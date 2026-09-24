// tests/setup.js
// jsdom doesn't implement matchMedia or serviceWorker. The app touches
// both defensively, but the test env should at least not throw when the
// code under test (or anything it imports) reaches for them.

if (typeof window.matchMedia !== 'function') {
  window.matchMedia = (query) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: () => {},      // legacy API
    removeListener: () => {},   // legacy API
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => false,
  });
}

if (!('serviceWorker' in navigator)) {
  Object.defineProperty(navigator, 'serviceWorker', {
    value: { register: () => Promise.resolve() },
    writable: true,
    configurable: true,
  });
}

// Fresh state between tests so nothing bleeds across `it` blocks.
// `globals: true` in vitest.config.js makes beforeEach available here.
beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
  document.body.innerHTML = '';
});

// auth.js's registration flow awaits checkPasswordPwned(password) — a real
// fetch() to api.pwnedpasswords.com — before calling supabaseClient.auth.signUp().
// Left un-stubbed, that's a genuine network round trip, which will never
// resolve within a test's fast flush()/setTimeout(0) helpers (and may just
// fail outright in a sandboxed/offline CI runner). Stub only that host so
// registration tests resolve on the microtask queue like everything else;
// any other fetch() call passes through untouched.
const _origFetch = globalThis.fetch;
beforeEach(() => {
  globalThis.fetch = vi.fn(async (url, ...rest) => {
    if (typeof url === 'string' && url.includes('pwnedpasswords.com')) {
      // Empty body = no matching suffix = "not pwned".
      return { ok: true, text: async () => '' };
    }
    if (typeof _origFetch === 'function') return _origFetch(url, ...rest);
    throw new Error(`fetch() not mocked for: ${url}`);
  });
});
afterEach(() => {
  globalThis.fetch = _origFetch;
});