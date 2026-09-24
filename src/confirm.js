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
  const resetForm = document.getElementById('reset-form');
  const resetPasswordInput = document.getElementById('reset-password');
  const resetPasswordConfirmInput = document.getElementById('reset-password-confirm');
  const resetErrorEl = document.getElementById('reset-error');
  const resetSubmitBtn = document.getElementById('reset-submit-btn');

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

  // `handoffToken` is passed in explicitly (captured from the URL before
  // anything clears it) instead of being re-read from `window.location`
  // after an await — the previous version read it *after* `history.
  // replaceState` had already stripped the query string, so it was always
  // null and the waiting desktop tab never learned the email was confirmed.
  //
  // We also retry the `complete_*` RPC a few times: the Supabase SDK's
  // `detectSessionInUrl` parse is asynchronous, so the very first call can
  // land before `auth.uid()` is available server-side.
  async function notifyConfirmedSession(mode, code, handoffToken) {
    if (typeof window.supabase === 'undefined' || typeof SUPABASE_URL !== 'string' || SUPABASE_URL.indexOf('YOUR-PROJECT-REF') !== -1) return;
    try {
      const client = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
        auth: { detectSessionInUrl: mode === 'implicit', persistSession: true, flowType: mode === 'implicit' ? 'implicit' : 'pkce' },
      });
      if (mode === 'pkce' && code) await client.auth.exchangeCodeForSession(code);

      // Wait until the SDK has actually established a session before we
      // try the handoff RPC — the first `getSession()` call can return
      // null if the hash parse hasn't finished yet.
      let session = null;
      for (let attempt = 0; attempt < 10; attempt++) {
        const { data } = await client.auth.getSession();
        if (data && data.session) { session = data.session; break; }
        await new Promise((r) => setTimeout(r, 150));
      }
      if (!session) return;

      if (handoffToken && typeof client.rpc === 'function') {
        // Retry up to 5 times over ~1s. `auth.uid()` on the server is
        // derived from the Authorization header; the SDK attaches it
        // as soon as the session exists, but giving it a beat avoids
        // the rare "called before the token was attached" case.
        for (let attempt = 0; attempt < 5; attempt++) {
          const { data, error } = await client.rpc('complete_email_confirmation_handoff', { p_token: handoffToken });
          if (!error && data === true) break;
          await new Promise((r) => setTimeout(r, 200));
        }
      }

      const signal = JSON.stringify({ at: Date.now() });
      localStorage.setItem('aschertypeEmailConfirmed', signal);
      if (typeof BroadcastChannel !== 'undefined') {
        const channel = new BroadcastChannel('aschertype-auth');
        channel.postMessage({ type: 'email-confirmed' });
        channel.close();
      }
    } catch (err) {
      console.warn('[Confirm] Could not hand session to the app tab:', err.message);
    }
  }

  // Shows the "set a new password" form instead of the usual ok/err panel.
  // Used for the password-recovery link, which needs one more step (typing
  // a new password) rather than just landing the user back in the app.
  function showResetForm(recoveryClient) {
    spinnerEl.style.display = 'none';
    iconOk.style.display = 'none';
    iconErr.style.display = 'none';
    titleEl.textContent = 'Choose a new password';
    textEl.textContent = 'Enter a new password for your Aschertype account.';
    document.title = 'Reset password — Aschertype';
    resetForm.style.display = 'flex';

    resetForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      resetErrorEl.style.display = 'none';

      const pw = resetPasswordInput.value;
      const confirmPw = resetPasswordConfirmInput.value;
      if (pw.length < 8) {
        resetErrorEl.textContent = 'Password must be at least 8 characters.';
        resetErrorEl.style.display = 'block';
        return;
      }
      if (!/[a-zA-Z]/.test(pw) || !/[0-9]/.test(pw)) {
        resetErrorEl.textContent = 'Use a mix of letters and numbers for a stronger password.';
        resetErrorEl.style.display = 'block';
        return;
      }
      if (pw !== confirmPw) {
        resetErrorEl.textContent = 'Passwords do not match.';
        resetErrorEl.style.display = 'block';
        return;
      }

      resetSubmitBtn.disabled = true;
      const originalText = resetSubmitBtn.textContent;
      resetSubmitBtn.textContent = 'Saving…';

      try {
        const { error } = await recoveryClient.auth.updateUser({ password: pw });
        if (error) {
          resetErrorEl.textContent = error.message || 'Could not update your password. Try the reset link again.';
          resetErrorEl.style.display = 'block';
          return;
        }
        // Recovery tokens are single-use; sign this temporary session out so
        // the reset link can't be replayed, and clean the tokens off the URL.
        try { await recoveryClient.auth.signOut(); } catch (err) { /* ignore */ }
        history.replaceState(null, '', window.location.pathname);
        resetForm.style.display = 'none';
        showOk('Password updated', 'Your password has been changed. Sign in with your new password.');
      } catch (err) {
        resetErrorEl.textContent = 'Something went wrong. Please try the reset link again.';
        resetErrorEl.style.display = 'block';
      } finally {
        resetSubmitBtn.disabled = false;
        resetSubmitBtn.textContent = originalText;
      }
    }, { once: true });
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
    let text = 'The link has already been used, has expired, or was cut off by your email provider. Try signing in — if your account is confirmed, it will just work. Otherwise, request a fresh link.';

    if (errCode === 'otp_expired') {
      title = 'This link has expired';
      text = 'Confirmation and reset links are time-limited. Request a fresh one, or try signing in — if your email was already confirmed, you don\'t need a new link.';
    } else if (errCode === 'access_denied') {
      title = 'That link didn\'t work';
      text = 'The link couldn\'t be verified. It may have already been used, or your email client may have shortened it.';
    } else if (errDesc) {
      // Fall back to Supabase's own description if we have one.
      text = errDesc;
    }

    showErr(title, text);
    // Clean the URL so a reload doesn't re-trigger a stale error state.
    history.replaceState(null, '', window.location.pathname);
    return;
  }

  // --- Password recovery branch ---------------------------------------
  // Supabase sends type=recovery for a "forgot password" link. We need our
  // own client here (detectSessionInUrl: true) so it consumes the token
  // straight from the URL and gives us a session to call updateUser with —
  // separate from the main app's client, which intentionally never reads
  // the URL (see db.js).
  const isRecovery = hashParams.type === 'recovery' || params.get('type') === 'recovery';
  if (isRecovery) {
    if (typeof window.supabase === 'undefined' || typeof SUPABASE_URL !== 'string' || SUPABASE_URL.indexOf('YOUR-PROJECT-REF') !== -1) {
      showErr('Can\'t process this link', 'This deployment isn\'t connected to an account backend, so passwords can\'t be reset here.');
      return;
    }
    const recoveryClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      auth: { detectSessionInUrl: true, persistSession: false, flowType: hashParams.access_token ? 'implicit' : 'pkce' },
    });
    // Give the client a tick to parse the hash/query and establish the
    // recovery session before we show the form.
    setTimeout(() => showResetForm(recoveryClient), 50);
    return;
  }

  // --- Success branch: an access_token in the hash means confirmed ----
  // IMPORTANT: capture `handoff` from the URL *now*, before any async work,
  // because the SDK will consume the hash and we'll clear the query string
  // once everything has settled.
  if (hashParams.access_token) {
    const handoffToken = params.get('handoff');
    // Clear the URL only *after* the SDK has consumed the hash and the
    // handoff RPC has finished — otherwise `getSession()` and the `handoff`
    // query param can both disappear before they're read, and the waiting
    // desktop tab never sees the confirmation.
    notifyConfirmedSession('implicit', undefined, handoffToken).finally(() => {
      history.replaceState(null, '', window.location.pathname);
    });
    showOk(
      'Email confirmed',
      'You\'re all set. Return to the Aschertype tab and we will finish signing you in.'
    );
    return;
  }

  // --- PKCE branch (future-proofing; not used by default) ------------
  if (params.get('code')) {
    const code = params.get('code');
    const handoffToken = params.get('handoff');
    notifyConfirmedSession('pkce', code, handoffToken).finally(() => {
      history.replaceState(null, '', window.location.pathname);
    });
    showOk(
      'Email confirmed',
      'You\'re all set. Return to the Aschertype tab and we will finish signing you in.'
    );
    return;
  }

  // --- Nothing to work with — probably a direct visit ----------------
  showNeutral(
    'Aschertype',
    'This page confirms your email after you click the link we send. If you just signed up, check your inbox for the confirmation email.'
  );
})();