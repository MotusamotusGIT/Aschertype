// ===== Auth screen (login / register / guest) =====
// Supabase Auth handles password hashing, storage, and session
// tokens entirely server-side — this file only ever sends email +
// password over HTTPS to Supabase and reacts to the result.

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

// ----- Rate limiter -----
// Persisted in localStorage (not a plain in-memory Map) so a page
// refresh — trivial for anyone to do — can't reset the counters. This
// is still a client-side speed bump, not real protection (a determined
// attacker calls the API directly), so Supabase's own server-side rate
// limits are the actual backstop; this just keeps a normal user from
// hammering the button and slows down casual credential-stuffing from
// this UI. Failed attempts use exponential backoff on top of the
// rolling window so repeated failures get progressively slower.
const RL_KEY = 'aschertypeRateLimits';

function loadRateLimitState() {
  try { return JSON.parse(localStorage.getItem(RL_KEY) || '{}'); }
  catch (err) { return {}; }
}
function saveRateLimitState(state) {
  try { localStorage.setItem(RL_KEY, JSON.stringify(state)); } catch (err) { /* ignore */ }
}
function pruneHistory(history, windowMs) {
  const now = Date.now();
  return history.filter((ts) => now - ts < windowMs);
}
// Returns { limited: bool, waitMs: number } — call recordAttempt() only
// once you actually proceed with the action.
function checkRateLimit(actionKey, limit, windowMs) {
  const state = loadRateLimitState();
  const entry = state[actionKey] || { history: [], failStreak: 0, lockUntil: 0 };
  const now = Date.now();
  if (entry.lockUntil && now < entry.lockUntil) {
    return { limited: true, waitMs: entry.lockUntil - now };
  }
  entry.history = pruneHistory(entry.history, windowMs);
  if (entry.history.length >= limit) {
    return { limited: true, waitMs: windowMs - (now - entry.history[0]) };
  }
  return { limited: false, waitMs: 0 };
}
function recordAttempt(actionKey, windowMs) {
  const state = loadRateLimitState();
  const entry = state[actionKey] || { history: [], failStreak: 0, lockUntil: 0 };
  entry.history = pruneHistory(entry.history, windowMs);
  entry.history.push(Date.now());
  state[actionKey] = entry;
  saveRateLimitState(state);
}
// Exponential backoff lockout on consecutive failures (30s, 60s, 120s...
// capped at 10 min), separate from the rolling-window limit above.
function recordFailure(actionKey) {
  const state = loadRateLimitState();
  const entry = state[actionKey] || { history: [], failStreak: 0, lockUntil: 0 };
  entry.failStreak = (entry.failStreak || 0) + 1;
  if (entry.failStreak >= 3) {
    const backoffSec = Math.min(30 * Math.pow(2, entry.failStreak - 3), 600);
    entry.lockUntil = Date.now() + backoffSec * 1000;
  }
  state[actionKey] = entry;
  saveRateLimitState(state);
}
function recordSuccess(actionKey) {
  const state = loadRateLimitState();
  state[actionKey] = { history: [], failStreak: 0, lockUntil: 0 };
  saveRateLimitState(state);
}
function formatWait(ms) {
  const s = Math.ceil(ms / 1000);
  if (s < 60) return `${s} second${s === 1 ? '' : 's'}`;
  return `${Math.ceil(s / 60)} minute${Math.ceil(s / 60) === 1 ? '' : 's'}`;
}

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
function showAuthScreen() { authScreen.classList.remove('hidden'); }

function setButtonBusy(btn, busyText) {
  btn.dataset.originalText = btn.dataset.originalText || btn.textContent;
  btn.disabled = true;
  btn.textContent = busyText;
}
function clearButtonBusy(btn) {
  btn.disabled = false;
  if (btn.dataset.originalText) btn.textContent = btn.dataset.originalText;
}

// A very simple, deliberately non-strict format check — real validation
// (does this address exist, is it verified) is Supabase's job. This just
// stops obviously-malformed input from wasting a rate-limited attempt.
function isPlausibleEmail(email) { return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email); }

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

  // Decide where the session token will live BEFORE signing in, so the
  // Supabase client's storage adapter writes it to the right place from
  // the very first token write. See db.js for why this replaces the old
  // beforeunload-based "forget session" approach.
  setRememberPreference(!forgetSession);

  const { data, error } = await supabaseClient.auth.signInWithPassword({ email, password });
  clearButtonBusy(submitBtn);

  if (error) {
    recordFailure('login');
    // Generic message: don't reveal whether the email exists at all.
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
  // New accounts should default to "remembered" like a normal sign-in.
  setRememberPreference(true);
  const { data, error } = await supabaseClient.auth.signUp({ email, password });
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
  const { error } = await supabaseClient.auth.resetPasswordForEmail(email);
  // Same message whether or not the account exists — don't leak that.
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

// ----- Initial auth state on load -----
// getSession() reads the persisted token synchronously from storage,
// but supabase-js may also need a network round-trip to refresh it if
// it's close to expiry. On a phone that's just woken up (or has a slow
// / momentarily-absent connection), that refresh call can fail even
// though a perfectly good session is sitting in storage — the old code
// treated ANY error here as "not logged in" and showed the login
// screen, which is the mobile bug that was reported. Now we only force
// a re-login when Supabase says the session/credentials are actually
// invalid; a transient network failure falls back to trusting the
// locally stored session and retries in the background.
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
    // One retry after a short delay covers "phone just woke up, wifi
    // isn't back yet" without leaving the user stuck on a spinner.
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

resolveInitialAuthState();