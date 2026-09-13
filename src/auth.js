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

// ----- Simple Client-Side Rate Limiter -----
const rateLimitMap = new Map();

function isRateLimited(actionKey, limit = 5, windowMs = 60000) {
  const now = Date.now();
  const history = (rateLimitMap.get(actionKey) || []).filter(timestamp => now - timestamp < windowMs);
  if (history.length >= limit) {
    rateLimitMap.set(actionKey, history);
    return true;
  }
  history.push(now);
  rateLimitMap.set(actionKey, history);
  return false;
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

loginForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  showAuthError(''); showAuthNotice('');

  if (isRateLimited('login', 5, 60000)) {
    showAuthError('Too many sign-in attempts. Please wait 1 minute before trying again.');
    return;
  }

  const email = document.getElementById('login-email').value.trim();
  const password = document.getElementById('login-password').value;
  const forgetSession = document.getElementById('login-forget-session').checked;

  if (!supabaseReady) {
    showAuthError('Accounts are not set up yet on this deployment. Use "Continue without an account" below.');
    return;
  }

  const submitBtn = loginForm.querySelector('.auth-submit');
  setButtonBusy(submitBtn, 'Signing in…');

  // Handle transient session vs long-term session persistence
  if (forgetSession) {
    sessionStorage.setItem('aschertypeTransientSession', 'true');
  } else {
    sessionStorage.removeItem('aschertypeTransientSession');
  }

  const { data, error } = await supabaseClient.auth.signInWithPassword({ email, password });
  clearButtonBusy(submitBtn);

  if (error) { showAuthError(error.message); return; }

  currentUser = data.user;
  isGuest = false;
  sessionStorage.removeItem('aschertypeGuest');
  hideAuthScreen();
  window.initApp(currentUser);
});

registerForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  showAuthError(''); showAuthNotice('');

  if (isRateLimited('register', 3, 60000)) {
    showAuthError('Too many account creation attempts. Please try again later.');
    return;
  }

  const email = document.getElementById('register-email').value.trim();
  const password = document.getElementById('register-password').value;
  const confirm = document.getElementById('register-confirm').value;

  if (password.length < 8) { showAuthError('Password must be at least 8 characters.'); return; }
  if (password !== confirm) { showAuthError('Passwords do not match.'); return; }

  if (!supabaseReady) {
    showAuthError('Accounts are not set up yet on this deployment. Use "Continue without an account" below.');
    return;
  }

  const submitBtn = registerForm.querySelector('.auth-submit');
  setButtonBusy(submitBtn, 'Creating account…');
  const { data, error } = await supabaseClient.auth.signUp({ email, password });
  clearButtonBusy(submitBtn);

  if (error) { showAuthError(error.message); return; }

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

  if (isRateLimited('forgot_password', 3, 60000)) {
    showAuthError('Too many password reset requests. Please wait a minute.');
    return;
  }

  const email = document.getElementById('login-email').value.trim();
  if (!email) { showAuthError('Enter your email above first, then click "Forgot password?" again.'); return; }
  if (!supabaseReady) { showAuthError('Accounts are not set up yet on this deployment.'); return; }

  const { error } = await supabaseClient.auth.resetPasswordForEmail(email);
  if (error) { showAuthError(error.message); return; }
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
  sessionStorage.removeItem('aschertypeTransientSession');
  location.reload();
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

  // Check if session was marked as single-session/transient
  if (sessionStorage.getItem('aschertypeTransientSession') === 'true') {
    window.addEventListener('beforeunload', async () => {
      await supabaseClient.auth.signOut();
    });
  }

  try {
    const { data } = await supabaseClient.auth.getSession();
    if (data && data.session) {
      currentUser = data.session.user;
      hideAuthScreen();
      window.initApp(currentUser);
    } else {
      showAuthScreen();
    }
  } catch (err) {
    console.error('[Supabase] Session check failed:', err);
    showAuthScreen();
  }
}

if (supabaseReady) {
  supabaseClient.auth.onAuthStateChange((event) => {
    if (event === 'SIGNED_OUT') location.reload();
  });
}

resolveInitialAuthState();