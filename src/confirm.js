// ===== Email confirmation result page =====

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

  // `handoffToken` is captured from the URL before anything clears it.
  // After the SDK has established a session from the hash, we send the
  // access_token + refresh_token to the handoff row so the waiting PC can
  // adopt the same session without a password grant (which is what was
  // failing with 400 because hCaptcha is required for password grants).
  async function notifyConfirmedSession(mode, code, handoffToken) {
    console.log('[Confirm] notifyConfirmedSession start', { mode, hasCode: !!code, hasHandoff: !!handoffToken });
    if (typeof window.supabase === 'undefined' || typeof SUPABASE_URL !== 'string' || SUPABASE_URL.indexOf('YOUR-PROJECT-REF') !== -1) {
      console.warn('[Confirm] Supabase SDK or config missing — bailing out');
      return;
    }
    try {
      const client = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
        auth: { detectSessionInUrl: false, persistSession: false, flowType: mode === 'implicit' ? 'implicit' : 'pkce' },
      });

      let session = null;

      if (mode === 'implicit') {
        // Read tokens straight from the hash. Firefox's bounce-tracker
        // protection can purge Supabase's storage, so we can't rely on
        // detectSessionInUrl having persisted anything.
        const hash = parseHash(window.location.hash);
        if (hash.access_token && hash.refresh_token) {
          const { data, error } = await client.auth.setSession({
            access_token: hash.access_token,
            refresh_token: hash.refresh_token,
          });
          if (!error && data && data.session) session = data.session;
          console.log('[Confirm] setSession from hash:', session ? 'OK' : (error && error.message));
        }
      } else if (mode === 'pkce' && code) {
        const { data, error } = await client.auth.exchangeCodeForSession(code);
        if (!error && data && data.session) session = data.session;
        console.log('[Confirm] exchangeCodeForSession:', session ? 'OK' : (error && error.message));
      }

      // Fallback: if for any reason setSession failed, try getSession briefly.
      if (!session) {
        for (let attempt = 0; attempt < 30; attempt++) {
          const { data } = await client.auth.getSession();
          if (data && data.session) { session = data.session; break; }
          await new Promise((r) => setTimeout(r, 150));
        }
      }
      console.log('[Confirm] session after wait:', session ? 'GOT IT' : 'NONE');
      if (!session) return;

      if (handoffToken && typeof client.rpc === 'function') {
        const at = session.access_token;
        const rt = session.refresh_token;
        for (let attempt = 0; attempt < 5; attempt++) {
          const { data, error } = await client.rpc('complete_email_confirmation_handoff_with_session', {
            p_token: handoffToken,
            p_access_token: at,
            p_refresh_token: rt,
          });
          console.log('[Confirm] complete_email_confirmation_handoff_with_session attempt', attempt, { data, error: error && error.message });
          if (!error && data === true) break;
          await new Promise((r) => setTimeout(r, 200));
        }
      } else {
        console.log('[Confirm] no handoffToken to send');
      }

      const signal = JSON.stringify({ at: Date.now() });
      try { localStorage.setItem('aschertypeEmailConfirmed', signal); } catch (e) { /* Firefox may block */ }
      if (typeof BroadcastChannel !== 'undefined') {
        const channel = new BroadcastChannel('aschertype-auth');
        channel.postMessage({ type: 'email-confirmed' });
        channel.close();
      }
    } catch (err) {
      console.warn('[Confirm] Could not hand session to the app tab:', err && err.message);
    }
  }

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
      text = errDesc;
    }

    showErr(title, text);
    history.replaceState(null, '', window.location.pathname);
    return;
  }

  const isRecovery = hashParams.type === 'recovery' || params.get('type') === 'recovery';
  if (isRecovery) {
    if (typeof window.supabase === 'undefined' || typeof SUPABASE_URL !== 'string' || SUPABASE_URL.indexOf('YOUR-PROJECT-REF') !== -1) {
      showErr('Can\'t process this link', 'This deployment isn\'t connected to an account backend, so passwords can\'t be reset here.');
      return;
    }
    const recoveryClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      auth: { detectSessionInUrl: true, persistSession: false, flowType: hashParams.access_token ? 'implicit' : 'pkce' },
    });
    setTimeout(() => showResetForm(recoveryClient), 50);
    return;
  }

  if (hashParams.access_token) {
    const handoffToken = params.get('handoff');
    console.log('[Confirm] success branch, handoffToken =', handoffToken);
    notifyConfirmedSession('implicit', undefined, handoffToken).finally(() => {
      history.replaceState(null, '', window.location.pathname);
    });
    showOk(
      'Email confirmed',
      'You\'re all set. Return to the Aschertype tab and we will finish signing you in.'
    );
    return;
  }

  if (params.get('code')) {
    const code = params.get('code');
    const handoffToken = params.get('handoff');
    console.log('[Confirm] pkce branch, handoffToken =', handoffToken);
    notifyConfirmedSession('pkce', code, handoffToken).finally(() => {
      history.replaceState(null, '', window.location.pathname);
    });
    showOk(
      'Email confirmed',
      'You\'re all set. Return to the Aschertype tab and we will finish signing you in.'
    );
    return;
  }

  console.log('[Confirm] no params — neutral branch');
  showNeutral(
    'Aschertype',
    'This page confirms your email after you click the link we send. If you just signed up, check your inbox for the confirmation email.'
  );
})();