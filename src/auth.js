// ===== Auth screen (login / register / guest) =====
// Supabase Auth handles password hashing, storage, and session
// tokens entirely server-side — this file only ever sends email +
// password over HTTPS to Supabase and reacts to the result.
//
// The rate limiter, isPlausibleEmail, formatWait, and remember-session
// helpers now live in utils.js (loaded before this file by loader.js).

let currentUser = null;
let isGuest = false;

const authScreen = document.getElementById('auth-screen');
const authTabLogin = document.getElementById('auth-tab-login');
const authTabRegister = document.getElementById('auth-tab-register');
const loginForm = document.getElementById('login-form');
const registerForm = document.getElementById('register-form');
const authErrorEl = document.getElementById('auth-error');
const authNoticeEl = document.getElementById('auth-notice');
const authGuestLink = document.getElementById('auth-guest-link');
const forgotPasswordBtn = document.getElementById('forgot-password-btn');

// ----- Password visibility toggle -----
document.querySelectorAll('.password-toggle').forEach((btn) => {
  btn.addEventListener('mousedown', (e) => {
    e.preventDefault();
  });
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
  authErrorEl.textContent = msg;
  authErrorEl.style.display = msg ? 'block' : 'none';
}
function showAuthNotice(msg) {
  authNoticeEl.textContent = msg;
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

// When we're about to reveal the auth card, the loading overlay MUST
// also come down — otherwise (because loading-screen has z-index 999
// and auth-screen has z-index 500) the auth card renders behind an
// overlay that never auto-dismisses, and the user gets stuck on
// "Connecting…" forever. This happens on the "no session" path,
// where window.initApp() never runs, so renderer's own
// markLoadingReady() / dismissLoading() never fire.
function dismissLoadingOverlay() {
  if (typeof window.dismissLoading === 'function') {
    window.dismissLoading();
    return;
  }
  const el = document.getElementById('loading-screen');
  if (el) el.classList.add('hidden');
  const btn = document.getElementById('loading-continue');
  if (btn) btn.classList.remove('ready');
}
function showAuthScreen() {
  dismissLoadingOverlay();
  authScreen.classList.remove('hidden');
}

function setButtonBusy(btn, busyText) {
  btn.dataset.originalText = btn.dataset.originalText || btn.textContent;
  btn.disabled = true;
  btn.textContent = busyText;
}
function clearButtonBusy(btn) {
  btn.disabled = false;
  if (btn.dataset.originalText) btn.textContent = btn.dataset.originalText;
}

loginForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  showAuthError(''); showAuthNotice('');

  const rl = checkRateLimit('login', 5, 60000);
  if (rl.limited) {
    showAuthError(`Too many sign-in attempts. Please wait ${formatWait(rl.waitMs)} before trying again.`);
    return;
  }

  const email = document.getElementById('login-email').value.trim();
  const password = document.getElementById('login-password').value;
  const forgetSession = document.getElementById('login-forget-session').checked;

  if (!isPlausibleEmail(email)) { showAuthError('Enter a valid email address.'); return; }

  if (!supabaseReady) {
    showAuthError('Accounts are not set up yet on this deployment. Use "Continue without an account" below.');
    return;
  }

  const submitBtn = loginForm.querySelector('.auth-submit');
  setButtonBusy(submitBtn, 'Signing in…');
  recordAttempt('login', 60000);

  setRememberPreference(!forgetSession);

  const { data, error } = await supabaseClient.auth.signInWithPassword({ email, password });
  clearButtonBusy(submitBtn);

  if (error) {
    recordFailure('login');
    showAuthError('Incorrect email or password.');
    return;
  }

  recordSuccess('login');
  currentUser = data.user;
  isGuest = false;
  sessionStorage.removeItem('aschertypeGuest');
  hideAuthScreen();
  window.initApp(currentUser);
});

registerForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  showAuthError(''); showAuthNotice('');

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

  if (!supabaseReady) {
    showAuthError('Accounts are not set up yet on this deployment. Use "Continue without an account" below.');
    return;
  }

  const submitBtn = registerForm.querySelector('.auth-submit');
  setButtonBusy(submitBtn, 'Creating account…');
  recordAttempt('register', 60000);
  setRememberPreference(true);
  const { data, error } = await supabaseClient.auth.signUp({
    email,
    password,
    options: {
      emailRedirectTo: `${window.location.origin}/confirm.html`,
    },
  });
  clearButtonBusy(submitBtn);

  if (error) { recordFailure('register'); showAuthError(error.message); return; }

  recordSuccess('register');
  if (data.session) {
    currentUser = data.user;
    isGuest = false;
    sessionStorage.removeItem('aschertypeGuest');
    hideAuthScreen();
    window.initApp(currentUser);
  } else {
    showAuthNotice('Account created — check your email to confirm it, then sign in.');
    setAuthTab('login');
  }
});

forgotPasswordBtn.addEventListener('click', async () => {
  showAuthError(''); showAuthNotice('');

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
  const { error } = await supabaseClient.auth.resetPasswordForEmail(email, {
    redirectTo: `${window.location.origin}/confirm.html`,
  });
  if (error) console.error('[Auth] Password reset request failed:', error.message);
  showAuthNotice('If that email has an account, a reset link is on its way.');
});

authGuestLink.addEventListener('click', (e) => {
  e.preventDefault();
  isGuest = true;
  currentUser = null;
  sessionStorage.setItem('aschertypeGuest', 'true');
  hideAuthScreen();
  window.initApp(null);
});

async function signOutAndReset() {
  if (supabaseReady) {
    try { await supabaseClient.auth.signOut(); } catch (err) { /* ignore */ }
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
      } catch (err2) { /* still offline — fall through */ }
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

whenRendererReady(() => {
  resolveInitialAuthState();
});