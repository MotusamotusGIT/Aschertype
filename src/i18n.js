(function () {
  const LANG_KEY = 'language';
  let dict = null;

  function getLanguage() {
    try { return localStorage.getItem(LANG_KEY) || 'en'; } catch (err) { return 'en'; }
  }
  function setLanguage(lang) {
    try { localStorage.setItem(LANG_KEY, lang); } catch (err) {}
  }

  function getLocale() {
    return getLanguage() === 'id' ? 'id-ID' : 'en-US';
  }

  function t(key, fallback) {
    const lang = getLanguage();
    const table = (dict && (dict[lang] || dict.en)) || {};
    return table[key] || (dict && dict.en && dict.en[key]) || fallback || key;
  }

  function applyStatic() {
    document.querySelectorAll('[data-i18n]').forEach((el) => {
      el.textContent = t(el.getAttribute('data-i18n'));
    });
    document.querySelectorAll('[data-i18n-html]').forEach((el) => {
      el.innerHTML = t(el.getAttribute('data-i18n-html'));
    });
    document.querySelectorAll('[data-i18n-placeholder]').forEach((el) => {
      el.placeholder = t(el.getAttribute('data-i18n-placeholder'));
    });
    document.querySelectorAll('[data-i18n-title]').forEach((el) => {
      el.title = t(el.getAttribute('data-i18n-title'));
    });
    const select = document.getElementById('language-select');
    if (select) select.value = getLanguage();
  }

  async function loadDict() {
    try {
      const res = await fetch('./language.json');
      dict = await res.json();
    } catch (err) {
      console.warn('[i18n] Failed to load language.json:', err.message);
      dict = { en: {} };
    }
  }

  async function applyLanguage(lang) {
    if (lang) setLanguage(lang);
    if (!dict) await loadDict();
    applyStatic();
    if (typeof window.onLanguageChange === 'function') window.onLanguageChange();
  }

  window.I18N = { t, getLanguage, setLanguage, getLocale, applyLanguage };

  loadDict().then(applyStatic);

  function bindLanguageSelect() {
    const select = document.getElementById('language-select');
    if (select) {
      select.value = getLanguage();
      select.addEventListener('change', (e) => applyLanguage(e.target.value));
    }
  }

  // i18n.js is fetched dynamically by loader.js, so by the time this file
  // executes, DOMContentLoaded may have already fired on the main document.
  // Bind immediately if the DOM is already ready; only wait for the event
  // if parsing is still in progress.
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', bindLanguageSelect);
  } else {
    bindLanguageSelect();
  }
})();