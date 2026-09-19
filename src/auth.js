// ===== Auth screen (login / register / guest) =====

let currentUser = null;
let isGuest = false;

let loginCaptchaToken = null;
let registerCaptchaToken = null;

window.onLoginCaptcha = function (token) { loginCaptchaToken = token; };
window.onRegisterCaptcha = function (token) { registerCaptchaToken = token; };

function resetCaptcha(widgetIndex) {
  if (typeof window.hcaptcha !== 'undefined') {
    try { window.hcaptcha.reset(widgetIndex); } catch (err) {}
  }
}

// ---- HIBP k-anonymity password breach check -------------------------------
// Sends only the first 5 hex chars of the SHA-1 hash to HIBP's range API;
// compares the remaining 35 chars locally. Fails open on any error so a
// network/CSP failure never blocks signup.
async function checkPasswordPwned(password) {
  try {
    const enc = new TextEncoder().encode(password);
    const hashBuf = await crypto.subtle.digest('SHA-1', enc);
    const hashHex = [...new Uint8Array(hashBuf)]
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('')
      .toUpperCase();
    const prefix = hashHex.slice(0, 5);
    const suffix = hashHex.slice(5);

    const res = await fetch(`https://api.pwnedpasswords.com/range/${prefix}`, {
      method: 'GET',
    });
    if (!res.ok) return { checked: false, pwned: false, count: 0 };

    const text = await res.text();
    for (const line of text.split('\n')) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      const [hashSuffix, countStr] = trimmed.split(':');
      if (hashSuffix === suffix) {
        const count = parseInt(countStr, 10) || 0;
        return { checked: true, pwned: true, count };
      }
    }
    return { checked: true, pwned: false, count: 0 };
  } catch (err) {
    console.warn('[Auth] Password breach check skipped:', err && err.message);
    return { checked: false, pwned: false, count: 0 };
  }
}
// ---------------------------------------------------------------------------

const authScreen = document.getElementById('auth-screen');
const authTabLogin = document.getElementById('auth-tab-login');
const authTabRegister = document.getElementById('auth-tab-register');
const loginForm = document.getElementById('login-form');
const registerForm = document.getElementById('register-form');
const authErrorEl = document.getElementById('auth-error');
const authNoticeEl = document.getElementById('auth-notice');
const authGuestLink = document.getElementById('auth-guest-link');
const forgotPasswordBtn = document.getElementById('forgot-password-btn');

document.querySelectorAll('.password-toggle').forEach((btn) => {
  btn.addEventListener('mousedown', (e) => { e.preventDefault(); });
  btn.addEventListener('click', (e) => {
    e.preventDefault();
    e.stopPropagation();
    const field = btn.closest('.password-field');
    if (!field) return;
    const input = field.querySelector('input');
    if (!input) return;
    const isShowing = input.type === 'text';
    input.type = isShowing ? 'password' : 'text';
    field.classList.toggle('showing', !isShowing);
    btn.setAttribute('aria-label', isShowing ? 'Show password' : 'Hide password');
    btn.setAttribute('aria-pressed', String(!isShowing));
  });
});

function showAuthError(msg) {
  if (!authErrorEl) return;
  authErrorEl.textContent = msg || '';
  authErrorEl.style.display = msg ? 'block' : 'none';
}
function showAuthNotice(msg) {
  if (!authNoticeEl) return;
  authNoticeEl.textContent = msg || '';
  authNoticeEl.style.display = msg ? 'block' : 'none';
}
function setAuthTab(tab) {
  const isLogin = tab === 'login';
  authTabLogin.classList.toggle('active', isLogin);
  authTabRegister.classList.toggle('active', !isLogin);
  loginForm.style.display = isLogin ? 'flex' : 'none';
  registerForm.style.display = isLogin ? 'none' : 'flex';
  showAuthError('');
  showAuthNotice('');
}
authTabLogin.addEventListener('click', () => setAuthTab('login'));
authTabRegister.addEventListener('click', () => setAuthTab('register'));

function hideAuthScreen() { authScreen.classList.add('hidden'); }

function dismissLoadingOverlay() {
  if (typeof window.dismissLoading === 'function') {
    window.dismissLoading();
    return;
  }
  const el = document.getElementById('loading-screen');
  if (el) el.classList.add('hidden');
}
function showAuthScreen() {
  dismissLoadingOverlay();
  authScreen.classList.remove('hidden');
}

function setButtonBusy(btn, busyText) {
  if (!btn) return;
  btn.dataset.originalText = btn.dataset.originalText || btn.textContent;
  btn.disabled = true;
  btn.textContent = busyText;
}
function clearButtonBusy(btn) {
  if (!btn) return;
  btn.disabled = false;
  if (btn.dataset.originalText) btn.textContent = btn.dataset.originalText;
}

// Map a raw Supabase auth error into a helpful user-facing message.
function friendlyAuthError(error, fallback) {
  const raw = ((error && (error.message || error.error_description || error.msg)) || '').toString();
  const msg = raw.toLowerCase();

  if (!raw) return fallback;
  if (msg.includes('captcha')) return 'Captcha check failed — please try again.';
  if (msg.includes('already registered') || msg.includes('already exists')) {
    return 'That email is already registered. Try signing in instead.';
  }
  if (msg.includes('rate limit') || msg.includes('too many')) {
    return 'Too many attempts. Please wait a few minutes and try again.';
  }
  if (msg.includes('email not confirmed') || msg.includes('not confirmed')) {
    return 'Please confirm your email first — check your inbox for the link.';
  }
  if (msg.includes('invalid login') || msg.includes('invalid credentials')) {
    return 'Incorrect email or password.';
  }
  if (msg.includes('weak password') || msg.includes('password should be')) {
    return 'That password is too weak. Please choose a stronger one.';
  }
  if (msg.includes('signups not allowed') || msg.includes('signup is disabled')) {
    return 'New signups are currently disabled on this deployment.';
  }
  return raw || fallback;
}

// -------- Login ------------------------------------------------------------
loginForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  showAuthError('');
  showAuthNotice('');

  const rl = checkRateLimit('login', 5, 60000);
  if (rl.limited) {
    showAuthError(`Too many sign-in attempts. Please wait ${formatWait(rl.waitMs)} before trying again.`);
    return;
  }

  const email = document.getElementById('login-email').value.trim();
  const password = document.getElementById('login-password').value;
  const forgetSession = document.getElementById('login-forget-session').checked;

  if (!isPlausibleEmail(email)) { showAuthError('Enter a valid email address.'); return; }
  if (!loginCaptchaToken) { showAuthError('Please complete the captcha.'); return; }
  if (!supabaseReady) {
    showAuthError('Accounts are not set up yet on this deployment. Use "Continue without an account" below.');
    return;
  }

  const submitBtn = loginForm.querySelector('.auth-submit');
  setButtonBusy(submitBtn, 'Signing in…');
  recordAttempt('login', 60000);
  setRememberPreference(!forgetSession);

  try {
    const { data, error } = await supabaseClient.auth.signInWithPassword({
      email,
      password,
      options: { captchaToken: loginCaptchaToken },
    });

    if (error) {
      recordFailure('login');
      showAuthError(friendlyAuthError(error, 'Incorrect email or password.'));
      return;
    }

    recordSuccess('login');
    currentUser = data.user;
    isGuest = false;
    sessionStorage.removeItem('aschertypeGuest');
    hideAuthScreen();
    window.initApp(currentUser);
  } catch (err) {
    console.error('[Auth] Sign-in threw:', err);
    recordFailure('login');
    showAuthError('Something went wrong signing in. Please try again.');
  } finally {
    clearButtonBusy(submitBtn);
    resetCaptcha();
    loginCaptchaToken = null;
  }
});

// -------- Register ---------------------------------------------------------
registerForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  showAuthError('');
  showAuthNotice('');

  const rl = checkRateLimit('register', 3, 60000);
  if (rl.limited) {
    showAuthError(`Too many account creation attempts. Please wait ${formatWait(rl.waitMs)}.`);
    return;
  }

  const email = document.getElementById('register-email').value.trim();
  const password = document.getElementById('register-password').value;
  const confirm = document.getElementById('register-confirm').value;

  if (!isPlausibleEmail(email)) { showAuthError('Enter a valid email address.'); return; }
  if (password.length < 8) { showAuthError('Password must be at least 8 characters.'); return; }
  if (!/[a-zA-Z]/.test(password) || !/[0-9]/.test(password)) {
    showAuthError('Use a mix of letters and numbers for a stronger password.');
    return;
  }
  if (password !== confirm) { showAuthError('Passwords do not match.'); return; }
  if (!registerCaptchaToken) { showAuthError('Please complete the captcha.'); return; }
  if (!supabaseReady) {
    showAuthError('Accounts are not set up yet on this deployment. Use "Continue without an account" below.');
    return;
  }

  const submitBtn = registerForm.querySelector('.auth-submit');
  setButtonBusy(submitBtn, 'Checking password…');

  try {
    const pwnedResult = await checkPasswordPwned(password);
    if (pwnedResult.checked && pwnedResult.pwned) {
      showAuthError(
        `That password has appeared in ${pwnedResult.count.toLocaleString()} known data breaches. Please choose a different one.`
      );
      return; // finally block will un-busy the button
    }

    setButtonBusy(submitBtn, 'Creating account…');
    recordAttempt('register', 60000);
    setRememberPreference(true);

    const { data, error } = await supabaseClient.auth.signUp({
      email,
      password,
      options: {
        emailRedirectTo: `${window.location.origin}/confirm.html`,
        captchaToken: registerCaptchaToken,
      },
    });

    if (error) {
      recordFailure('register');
      console.error('[Auth] Sign-up error:', error);
      showAuthError(friendlyAuthError(error, 'Could not create your account.'));
      return;
    }

    recordSuccess('register');
    if (data.session) {
      currentUser = data.user;
      isGuest = false;
      sessionStorage.removeItem('aschertypeGuest');
      hideAuthScreen();
      window.initApp(currentUser);
    } else {
      setAuthTab('login');
      showAuthNotice('Account created — check your email to confirm it, then sign in.');
    }
  } catch (err) {
    console.error('[Auth] Sign-up threw:', err);
    recordFailure('register');
    showAuthError('Something went wrong creating your account. Please try again.');
  } finally {
    clearButtonBusy(submitBtn);
    resetCaptcha();
    registerCaptchaToken = null;
  }
});

// -------- Forgot password --------------------------------------------------
if (forgotPasswordBtn) {
  forgotPasswordBtn.addEventListener('click', async () => {
    showAuthError('');
    showAuthNotice('');

    const rl = checkRateLimit('forgot_password', 3, 60000);
    if (rl.limited) {
      showAuthError(`Too many password reset requests. Please wait ${formatWait(rl.waitMs)}.`);
      return;
    }

    const email = document.getElementById('login-email').value.trim();
    if (!email) { showAuthError('Enter your email above first, then click "Forgot password?" again.'); return; }
    if (!isPlausibleEmail(email)) { showAuthError('Enter a valid email address.'); return; }
    if (!supabaseReady) { showAuthError('Accounts are not set up yet on this deployment.'); return; }

    recordAttempt('forgot_password', 60000);
    try {
      const { error } = await supabaseClient.auth.resetPasswordForEmail(email, {
        redirectTo: `${window.location.origin}/confirm.html`,
      });
      if (error) console.error('[Auth] Password reset request failed:', error.message);
    } catch (err) {
      console.error('[Auth] Password reset threw:', err);
    }
    showAuthNotice('If that email has an account, a reset link is on its way.');
  });
}

// -------- Guest ------------------------------------------------------------
if (authGuestLink) {
  authGuestLink.addEventListener('click', (e) => {
    e.preventDefault();
    isGuest = true;
    currentUser = null;
    sessionStorage.setItem('aschertypeGuest', 'true');
    hideAuthScreen();
    window.initApp(null);
  });
}

async function signOutAndReset() {
  if (supabaseReady) {
    try { await supabaseClient.auth.signOut(); } catch (err) {}
  }
  sessionStorage.removeItem('aschertypeGuest');
  location.reload();
}

function isAuthInvalidError(error) {
  if (!error) return false;
  const msg = (error.message || '').toLowerCase();
  return msg.includes('refresh_token') || msg.includes('invalid') || msg.includes('not found') || msg.includes('expired');
}

async function resolveInitialAuthState() {
  // Guest check FIRST, before any await — guarantees getSession is
  // never called when the guest flag is set, even across test reloads.
  if (sessionStorage.getItem('aschertypeGuest') === 'true') {
    isGuest = true;
    hideAuthScreen();
    window.initApp(null);
    return;
  }

  if (!supabaseReady) {
    isGuest = true;
    hideAuthScreen();
    window.initApp(null);
    return;
  }

  if (window.secureStorageReady && typeof window.secureStorageReady.then === 'function') {
    try { await window.secureStorageReady; } catch (err) {}
  }

  // Re-check the guest flag after the await — it may have been set
  // while we were waiting on hydration.
  if (sessionStorage.getItem('aschertypeGuest') === 'true') {
    isGuest = true;
    hideAuthScreen();
    window.initApp(null);
    return;
  }

  try {
    const { data, error } = await supabaseClient.auth.getSession();
    if (error && isAuthInvalidError(error)) {
      showAuthScreen();
      return;
    }
    if (data && data.session) {
      currentUser = data.session.user;
      hideAuthScreen();
      window.initApp(currentUser);
    } else {
      showAuthScreen();
    }
  } catch (err) {
    console.warn('[Supabase] Session check hit a network error — retrying once:', err && err.message);
    setTimeout(async () => {
      try {
        const { data, error } = await supabaseClient.auth.getSession();
        if (!error && data && data.session) {
          currentUser = data.session.user;
          hideAuthScreen();
          window.initApp(currentUser);
          return;
        }
      } catch (err2) {}
      showAuthScreen();
    }, 1500);
  }
}

if (supabaseReady) {
  supabaseClient.auth.onAuthStateChange((event) => {
    if (event === 'SIGNED_OUT') location.reload();
  });
}

function whenRendererReady(fn) {
  if (typeof window.initApp === 'function') { fn(); return; }
  window.addEventListener('load', () => {
    if (typeof window.initApp === 'function') fn();
    else console.error('[Auth] renderer.js never defined window.initApp — app cannot start.');
  }, { once: true });
}

window.signOutAndReset = signOutAndReset;

whenRendererReady(() => {
  resolveInitialAuthState();
});