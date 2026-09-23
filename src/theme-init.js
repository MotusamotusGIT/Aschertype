(function () {
  try {
    var stored = localStorage.getItem('theme');
    var mode = (stored === 'light' || stored === 'dark')
      ? stored
      : ((window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches) ? 'dark' : 'light');
    document.documentElement.setAttribute('data-theme', mode);
  } catch (err) { /* ignore — falls back to light */ }
})();