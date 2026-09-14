// ===== Email confirmation result page =====
// Supabase redirects here after a user clicks the link in their
// confirmation email. Depending on how the link was crafted and what
// state the project is in, the result can arrive in several forms:
//
//   1. Implicit flow (default for the JS SDK):
//        #access_token=...&type=signup
//      Success — no error in the hash.
//
//   2. Error case:
//        #error=access_denied&error_code=otp_expired&error_description=...
//      The link was already used, expired, or invalid.
//
//   3. PKCE flow (if you enable it later):
//        ?code=...
//      We don't currently enable PKCE, but handling it means the page
//      still does something sensible if you switch later.
//
//   4. No params at all — someone navigated here directly, or the
//      browser stripped the fragment. We can't confirm anything, so
//      we show a neutral "open the app" state.

(function () {
  const markEl = document.getElementById('confirm-mark');
  const spinnerEl = document.getElementById('confirm-spinner');
  const iconOk = document.getElementById('confirm-icon-ok');
  const iconErr = document.getElementById('confirm-icon-err');
  const titleEl = document.getElementById('confirm-title');
  const textEl = document.getElementById('confirm-text');
  const actionsEl = document.getElementById('confirm-actions');
  const primaryLink = document.getElementById('confirm-primary');
  const secondaryLink = document.getElementById('confirm-secondary');

  function showOk(title, text) {
    spinnerEl.style.display = 'none';
    iconOk.style.display = 'block';
    iconErr.style.display = 'none';
    markEl.classList.add('ok');
    markEl.classList.remove('err');
    titleEl.textContent = title;
    textEl.textContent = text;
    primaryLink.textContent = 'Sign in to Aschertype';
    primaryLink.href = './index.html';
    secondaryLink.textContent = 'Back to home';
    secondaryLink.href = './index.html';
    actionsEl.style.display = 'flex';
    document.title = 'Email confirmed — Aschertype';
  }

  function showErr(title, text) {
    spinnerEl.style.display = 'none';
    iconOk.style.display = 'none';
    iconErr.style.display = 'block';
    markEl.classList.add('err');
    markEl.classList.remove('ok');
    titleEl.textContent = title;
    textEl.textContent = text;
    primaryLink.textContent = 'Back to sign in';
    primaryLink.href = './index.html';
    secondaryLink.textContent = 'Need a new link? Sign up again';
    secondaryLink.href = './index.html';
    actionsEl.style.display = 'flex';
    document.title = 'Confirmation failed — Aschertype';
  }

  function showNeutral(title, text) {
    spinnerEl.style.display = 'none';
    iconOk.style.display = 'none';
    iconErr.style.display = 'none';
    titleEl.textContent = title;
    textEl.textContent = text;
    primaryLink.textContent = 'Open Aschertype';
    primaryLink.href = './index.html';
    secondaryLink.textContent = 'Back to home';
    secondaryLink.href = './index.html';
    actionsEl.style.display = 'flex';
    document.title = 'Aschertype';
  }

  function parseHash(hash) {
    const out = {};
    if (!hash || hash.length < 2) return out;
    hash.slice(1).split('&').forEach((pair) => {
      const eq = pair.indexOf('=');
      if (eq === -1) return;
      const k = decodeURIComponent(pair.slice(0, eq));
      const v = decodeURIComponent(pair.slice(eq + 1).replace(/\+/g, ' '));
      out[k] = v;
    });
    return out;
  }

  const params = new URLSearchParams(window.location.search);
  const hashParams = parseHash(window.location.hash);

  // --- Error branch first — errors win if both are present ----------
  const hashError = hashParams.error || hashParams.error_code;
  const queryError = params.get('error') || params.get('error_code');
  const errCode = hashParams.error_code || params.get('error_code') || '';
  const errDesc = hashParams.error_description || params.get('error_description') || '';

  if (hashError || queryError) {
    let title = 'This link isn\'t valid anymore';
    let text = 'The confirmation link has already been used, has expired, or was cut off by your email provider. Try signing in — if your account is confirmed, it will just work. Otherwise, sign up again to get a fresh link.';

    if (errCode === 'otp_expired') {
      title = 'This link has expired';
      text = 'Confirmation links are time-limited. Sign up again to get a fresh one, or try signing in — if your email was already confirmed, you don\'t need a new link.';
    } else if (errCode === 'access_denied') {
      title = 'That link didn\'t work';
      text = 'The confirmation link couldn\'t be verified. It may have already been used, or your email client may have shortened it.';
    } else if (errDesc) {
      // Fall back to Supabase's own description if we have one.
      text = errDesc;
    }

    showErr(title, text);
    // Clean the URL so a reload doesn't re-trigger a stale error state.
    history.replaceState(null, '', window.location.pathname);
    return;
  }

  // --- Success branch: an access_token in the hash means confirmed ----
  if (hashParams.access_token) {
    showOk(
      'Email confirmed',
      'You\'re all set. Sign in to start using Aschertype.'
    );
    // Clean the URL. The token was already consumed by the SDK during
    // the initial load on index.html; here we just don't want it
    // sitting in the address bar or browser history.
    history.replaceState(null, '', window.location.pathname);
    return;
  }

  // --- PKCE branch (future-proofing; not used by default) ------------
  if (params.get('code')) {
    showOk(
      'Email confirmed',
      'You\'re all set. Sign in to start using Aschertype.'
    );
    history.replaceState(null, '', window.location.pathname);
    return;
  }

  // --- Nothing to work with — probably a direct visit ----------------
  showNeutral(
    'Aschertype',
    'This page confirms your email after you click the link we send. If you just signed up, check your inbox for the confirmation email.'
  );
})();