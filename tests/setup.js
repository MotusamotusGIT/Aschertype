// tests/setup.js
// jsdom doesn't implement matchMedia or serviceWorker; app code touches
// both defensively but the test env should at least not throw.
if (!window.matchMedia) {
  window.matchMedia = () => ({
    matches: false,
    addEventListener: () => {},
    removeEventListener: () => {},
  });
}
if (!navigator.serviceWorker) {
  navigator.serviceWorker = { register: () => Promise.resolve() };
}

// Clear state between tests so they don't bleed into each other.
beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
  document.body.innerHTML = '';
});