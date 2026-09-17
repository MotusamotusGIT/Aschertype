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