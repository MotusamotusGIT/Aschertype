// src/loader.js
// Loads the self-hosted Supabase SDK and app scripts in order.
// No CDN — the SDK is vendored in ./vendor/supabase.min.js.
(function boot() {
  // Scripts with no top-level dependency on each other load in parallel.
  // db.js and renderer.js both need vendor+config+utils but not each other.
  // auth.js needs db.js (reads supabaseReady/supabaseClient at top level)
  // and renderer.js (window.initApp), so it loads last.
  const STAGE_1 = ['./vendor/supabase.min.js', './supabase-config.js', './ai-config.js', './utils.js', './ai-bridge.js', './i18n.js'];
  const STAGE_2 = ['./db.js', './renderer.js'];
  const STAGE_3 = ['./auth.js'];

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

  function loadStage(srcs) {
    return Promise.all(srcs.map((src) => loadScript(src, 10000)));
  }

  async function loadAppScripts() {
    await loadStage(STAGE_1);
    await loadStage(STAGE_2);
    await loadStage(STAGE_3);
  }

  loadAppScripts().catch((err) => {
    console.error('[Boot] Failed to load app scripts:', err);
  });
})();