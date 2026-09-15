// ===== Boot loader =====
// Loads the Supabase SDK with a fallback mirror (jsdelivr sometimes
// times out or gets blocked by network/ad-blockers — see the 408 in
// the console), THEN loads the app's own scripts in the exact order
// they always ran in. This has to be a real .js file rather than an
// inline <script> block because the page's CSP has no 'unsafe-inline'
// on script-src, so an inline script would just get silently blocked.
(function boot() {
  const SUPABASE_SDK_MIRRORS = [
    'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/dist/umd/supabase.min.js',
    'https://unpkg.com/@supabase/supabase-js@2/dist/umd/supabase.min.js',
  ];
  const APP_SCRIPTS = ['./supabase-config.js', './utils.js', './db.js', './renderer.js', './auth.js'];

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

  // Try each Supabase mirror in turn. A failure here is not fatal —
  // db.js already falls back to local-only mode when window.supabase
  // never shows up — this just gives real accounts a second chance
  // before we give up.
  async function loadSupabaseSdk() {
    for (const url of SUPABASE_SDK_MIRRORS) {
      try {
        await loadScript(url, 8000);
        if (typeof window.supabase !== 'undefined') return true;
      } catch (err) {
        console.warn('[Supabase] Mirror failed, trying next:', url, err.message);
      }
    }
    console.warn('[Supabase] All CDN mirrors failed — continuing in local-only mode.');
    return false;
  }

  async function loadAppScripts() {
    for (const src of APP_SCRIPTS) {
      await loadScript(src);
    }
  }

  loadSupabaseSdk()
    .catch(() => false)
    .then(loadAppScripts)
    .catch((err) => console.error('[Boot] Failed to load app scripts:', err));
})();