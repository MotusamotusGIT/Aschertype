// ===== Auth screen (login / register / guest) =====

let currentUser = null;
let isGuest = false;

const GUEST_KEY = 'aschertypeGuest';
function hasGuestSession() {
  try {
    return localStorage.getItem(GUEST_KEY) === 'true' || sessionStorage.getItem(GUEST_KEY) === 'true';
  } catch (err) {
    return false;
  }
}
function setGuestSession() {
  try { localStorage.setItem(GUEST_KEY, 'true'); } catch (err) {}
  try { sessionStorage.setItem(GUEST_KEY, 'true'); } catch (err) {}
}
function clearGuestSession() {
  try { localStorage.removeItem(GUEST_KEY); } catch (err) {}
  try { sessionStorage.removeItem(GUEST_KEY); } catch (err) {}
}

let loginCaptchaToken = null;
let registerCaptchaToken = null;

window.onLoginCaptcha = function (token) { loginCaptchaToken = token; };
window.onRegisterCaptcha = function (token) { registerCaptchaToken = token; };

function resetCaptcha(widgetIndex) {
  if (typeof window.hcaptcha !== 'undefined') {
    try { window.hcaptcha.reset(widgetIndex); } catch (err) {}
  }
}

// ---- SHA-1 over UTF-8, synchronous ---------------------------------------
// We compute SHA-1 in plain JS instead of crypto.subtle because
// crypto.subtle.digest() is async: awaiting it on the register form's
// critical path made the submit handler finish on a macrotask, so
// callers that expect the full handler chain to settle within a single
// microtask flush would race it (and could leak a still-pending handler
// into the next test). Same privacy guarantee as before — only the first
// 5 hex chars of the hash ever leave the browser — but nothing awaits it.
function sha1Hex(input) {
  // UTF-8 encode
  const bytes = [];
  for (let i = 0; i < input.length; i++) {
    let c = input.charCodeAt(i);
    if (c < 0x80) {
      bytes.push(c);
    } else if (c < 0x800) {
      bytes.push(0xc0 | (c >> 6), 0x80 | (c & 0x3f));
    } else if (c < 0xd800 || c >= 0xe000) {
      bytes.push(0xe0 | (c >> 12), 0x80 | ((c >> 6) & 0x3f), 0x80 | (c & 0x3f));
    } else {
      i++;
      c = 0x10000 + (((c & 0x3ff) << 10) | (input.charCodeAt(i) & 0x3ff));
      bytes.push(
        0xf0 | (c >> 18),
        0x80 | ((c >> 12) & 0x3f),
        0x80 | ((c >> 6) & 0x3f),
        0x80 | (c & 0x3f),
      );
    }
  }

  // Pad: 0x80, zeros, then 64-bit big-endian bit length
  const bitLen = bytes.length * 8;
  bytes.push(0x80);
  while ((bytes.length % 64) !== 56) bytes.push(0);
  const hi = Math.floor(bitLen / 0x100000000);
  const lo = bitLen >>> 0;
  bytes.push((hi >>> 24) & 0xff, (hi >>> 16) & 0xff, (hi >>> 8) & 0xff, hi & 0xff);
  bytes.push((lo >>> 24) & 0xff, (lo >>> 16) & 0xff, (lo >>> 8) & 0xff, lo & 0xff);

  let h0 = 0x67452301, h1 = 0xefcdab89, h2 = 0x98badcfe,
      h3 = 0x10325476, h4 = 0xc3d2e1f0;
  const rotl = (n, s) => ((n << s) | (n >>> (32 - s))) >>> 0;

  for (let i = 0; i < bytes.length; i += 64) {
    const w = new Uint32Array(80);
    for (let j = 0; j < 16; j++) {
      w[j] = (bytes[i + j * 4] << 24)
           | (bytes[i + j * 4 + 1] << 16)
           | (bytes[i + j * 4 + 2] << 8)
           |  bytes[i + j * 4 + 3];
    }
    for (let j = 16; j < 80; j++) {
      w[j] = rotl(w[j - 3] ^ w[j - 8] ^ w[j - 14] ^ w[j - 16], 1);
    }
    let a = h0, b = h1, c = h2, d = h3, e = h4;
    for (let j = 0; j < 80; j++) {
      let f, k;
      if (j < 20)      { f = (b & c) | ((~b) & d); k = 0x5a827999; }
      else if (j < 40) { f = b ^ c ^ d;            k = 0x6ed9eba1; }
      else if (j < 60) { f = (b & c) | (b & d) | (c & d); k = 0x8f1bbcdc; }
      else             { f = b ^ c ^ d;            k = 0xca62c1d6; }
      const temp = (rotl(a, 5) + f + e + k + w[j]) >>> 0;
      e = d; d = c; c = rotl(b, 30); b = a; a = temp;
    }
    h0 = (h0 + a) >>> 0;
    h1 = (h1 + b) >>> 0;
    h2 = (h2 + c) >>> 0;
    h3 = (h3 + d) >>> 0;
    h4 = (h4 + e) >>> 0;
  }

  const hex8 = (n) => (n >>> 0).toString(16).padStart(8, '0');
  return (hex8(h0) + hex8(h1) + hex8(h2) + hex8(h3) + hex8(h4)).toUpperCase();
}

// ---- HIBP k-anonymity password breach check -------------------------------
// Sends only the first 5 hex chars of the SHA-1 hash to HIBP's range API;
// compares the remaining 35 chars locally. Fails open on any error so a
// network/CSP failure never blocks signup.
async function checkPasswordPwned(password) {
  try {
    const hashHex = sha1Hex(password);
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
const confirmationActionsEl = document.getElementById('auth-confirmation-actions');
const resendConfirmationBtn = document.getElementById('resend-confirmation-btn');
const confirmationPanel = document.getElementById('confirmation-panel');
const confirmationEmailEl = document.getElementById('confirmation-email');
const confirmationResendBtn = document.getElementById('confirmation-resend-btn');
const confirmationBackBtn = document.getElementById('confirmation-back-btn');
const confirmationStatusEl = document.getElementById('confirmation-status');
const authGuestLink = document.getElementById('auth-guest-link');
const forgotPasswordBtn = document.getElementById('forgot-password-btn');
let pendingConfirmationEmail = '';

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
function showConfirmationActions(show) {
  if (confirmationActionsEl) confirmationActionsEl.style.display = show ? 'block' : 'none';
}
function showConfirmationWaiting(email) {
  pendingConfirmationEmail = email;
  beginConfirmationWait(email);
  if (confirmationEmailEl) confirmationEmailEl.textContent = email;
  loginForm.style.display = 'none';
  registerForm.style.display = 'none';
  document.querySelector('.auth-tabs').style.display = 'none';
  document.querySelector('.auth-divider').style.display = 'none';
  authGuestLink.style.display = 'none';
  if (confirmationPanel) confirmationPanel.style.display = 'flex';
}
function hideConfirmationWaiting() {
  if (confirmationPanel) confirmationPanel.style.display = 'none';
  document.querySelector('.auth-tabs').style.display = 'flex';
  document.querySelector('.auth-divider').style.display = 'flex';
  authGuestLink.style.display = '';
}
function setAuthTab(tab) {
  const isLogin = tab === 'login';
  authTabLogin.classList.toggle('active', isLogin);
  authTabRegister.classList.toggle('active', !isLogin);
  loginForm.style.display = isLogin ? 'flex' : 'none';
  registerForm.style.display = isLogin ? 'none' : 'flex';
  showAuthError('');
  showAuthNotice('');
  showConfirmationActions(false);
  hideConfirmationWaiting();
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

// hCaptcha's api.js (~60KB, plus its own iframe/network round-trip) used to
// load eagerly on every page load, even for guest/auto-login sessions that
// never touch the auth screen. Load it lazily, only once the auth screen is
// actually shown. Its default (implicit) mode auto-scans the DOM for
// `.h-captcha` elements and renders them itself once it finishes loading.
let hcaptchaScriptPromise = null;
function loadHcaptchaScript() {
  if (hcaptchaScriptPromise) return hcaptchaScriptPromise;
  hcaptchaScriptPromise = new Promise((resolve, reject) => {
    if (typeof window.hcaptcha !== 'undefined') { resolve(); return; }
    const s = document.createElement('script');
    s.src = 'https://hcaptcha.com/1/api.js';
    s.async = true;
    s.defer = true;
    s.onload = resolve;
    s.onerror = reject;
    document.head.appendChild(s);
  });
  return hcaptchaScriptPromise;
}

function showAuthScreen() {
  dismissLoadingOverlay();
  authScreen.classList.remove('hidden');
  loadHcaptchaScript().catch((err) => console.warn('[Auth] hCaptcha failed to load:', err));
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
  if (!supabaseReady) {
    showAuthError('Accounts are not set up yet on this deployment. Use "Continue without an account" below.');
    return;
  }

  const submitBtn = loginForm.querySelector('.auth-submit');
  setButtonBusy(submitBtn, 'Signing in…');
  recordAttempt('login', 60000);
  setRememberPreference(!forgetSession);

  try {
    const payload = { email, password };
    if (loginCaptchaToken) payload.options = { captchaToken: loginCaptchaToken };
    const { data, error } = await supabaseClient.auth.signInWithPassword(payload);

    if (error) {
      recordFailure('login');
      showAuthError(friendlyAuthError(error, 'Incorrect email or password.'));
      return;
    }

    recordSuccess('login');
    currentUser = data.user;
    isGuest = false;
    clearGuestSession();
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

    const payload = {
      email,
      password,
      options: {
        emailRedirectTo: `${window.location.origin}/confirm.html`,
      },
    };
    if (registerCaptchaToken) payload.options.captchaToken = registerCaptchaToken;
    const { data, error } = await supabaseClient.auth.signUp(payload);

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
      clearGuestSession();
      hideAuthScreen();
      window.initApp(currentUser);
    } else {
      showConfirmationWaiting(email);
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

async function resendConfirmation(email, button, statusEl) {
    if (!isPlausibleEmail(email)) {
      showAuthError('Enter the email you used to create your account.');
      return false;
    }

    const rl = checkRateLimit('resend_confirmation', 3, 60000);
    if (rl.limited) {
      showAuthError(`Too many requests. Please wait ${formatWait(rl.waitMs)}.`);
      return false;
    }

    button.disabled = true;
    try {
      recordAttempt('resend_confirmation', 60000);
      const { error } = await supabaseClient.auth.resend({
        type: 'signup',
        email,
        options: { emailRedirectTo: `${window.location.origin}/confirm.html` },
      });
      if (error) {
        showAuthError('Could not resend the confirmation email. Please try again shortly.');
        return false;
      }
      showAuthError('');
      const message = 'Confirmation email sent again. Check your inbox and spam folder.';
      if (statusEl) { statusEl.textContent = message; statusEl.style.display = 'block'; }
      else showAuthNotice(message);
      return true;
    } catch (err) {
      showAuthError('Could not resend the confirmation email. Please try again shortly.');
      return false;
    } finally {
      button.disabled = false;
    }
}
if (resendConfirmationBtn) resendConfirmationBtn.addEventListener('click', () => resendConfirmation(
  pendingConfirmationEmail || document.getElementById('login-email').value.trim(), resendConfirmationBtn, null,
));
if (confirmationResendBtn) confirmationResendBtn.addEventListener('click', () => resendConfirmation(
  pendingConfirmationEmail, confirmationResendBtn, confirmationStatusEl,
));
if (confirmationBackBtn) confirmationBackBtn.addEventListener('click', () => {
  hideConfirmationWaiting();
  setAuthTab('register');
});

let waitingForConfirmation = false;
function beginConfirmationWait(email) {
  waitingForConfirmation = true;
  pendingConfirmationEmail = email;
}
async function completeConfirmedSession() {
  if (!waitingForConfirmation || !supabaseReady) return;
  try {
    const { data, error } = await supabaseClient.auth.getSession();
    if (error || !data.session) return;
    waitingForConfirmation = false;
    currentUser = data.session.user;
    isGuest = false;
    clearGuestSession();
    hideAuthScreen();
    window.initApp(currentUser);
  } catch (err) { /* confirmation can be retried by the next signal */ }
}
function listenForConfirmation() {
  const onSignal = () => completeConfirmedSession();
  window.addEventListener('storage', (event) => {
    if (event.key === 'aschertypeEmailConfirmed') onSignal();
  });
  if (typeof BroadcastChannel !== 'undefined') {
    const channel = new BroadcastChannel('aschertype-auth');
    channel.addEventListener('message', (event) => {
      if (event.data && event.data.type === 'email-confirmed') onSignal();
    });
  }
}
listenForConfirmation();

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
    setGuestSession();
    hideAuthScreen();
    window.initApp(null);
  });
}

async function signOutAndReset() {
  if (supabaseReady) {
    try { await supabaseClient.auth.signOut(); } catch (err) {}
  }
  clearGuestSession();
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
  if (hasGuestSession()) {
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
  if (hasGuestSession()) {
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