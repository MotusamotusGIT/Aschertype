// src/loader.js
// Loads the self-hosted Supabase SDK and app scripts in order.
// No CDN — the SDK is vendored in ./vendor/supabase.min.js.
(function boot() {
  const APP_SCRIPTS = [
    '../vendor/supabase.min.js',
    './supabase-config.js',
    './utils.js',
    './db.js',
    './renderer.js',
    './auth.js',
  ];

  function loadScript(src, timeoutMs) {
    return new Promise((resolve, reject) => {
      const el = document.createElement('script');
      el.src = src;
      let timer = null;
      if (timeoutMs) {
        timer = setTimeout(() => {
          el.remove();
          reject(new Error(`Timed out loading ${src}`));
        }, timeoutMs);
      }
      el.onload = () => { if (timer) clearTimeout(timer); resolve(src); };
      el.onerror = () => { if (timer) clearTimeout(timer); reject(new Error(`Failed to load ${src}`)); };
      document.body.appendChild(el);
    });
  }

  async function loadAppScripts() {
    for (const src of APP_SCRIPTS) {
      await loadScript(src, 10000);
    }
  }

  loadAppScripts().catch((err) => {
    console.error('[Boot] Failed to load app scripts:', err);
  });
})();