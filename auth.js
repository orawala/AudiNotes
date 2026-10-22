// Supabase Auth Integration
let currentAuthMode = 'signin'; // 'signin' or 'signup'

document.addEventListener('DOMContentLoaded', () => {
  const authForm = document.getElementById('authForm');
  const authTitle = document.getElementById('authTitle');
  const authIntro = document.getElementById('authIntro');
  const authSubmit = document.getElementById('authSubmit');
  const authSwitchBtn = document.getElementById('authSwitchBtn');
  const authSwitchText = document.getElementById('authSwitchText');
  const authError = document.getElementById('authError');
  const authScreen = document.getElementById('authScreen');
  const appShell = document.getElementById('appShell');
  const accountButton = document.getElementById('accountButton');
  const accountMenu = document.getElementById('accountMenu');
  const accountEmail = document.getElementById('accountEmail');
  const logoutBtn = document.getElementById('logoutBtn');

  // Toggle Auth Mode
  authSwitchBtn?.addEventListener('click', () => {
    authError.classList.add('hidden');
    if (currentAuthMode === 'signin') {
      currentAuthMode = 'signup';
      authTitle.innerHTML = 'Create account<span class="title-period">.</span>';
      authIntro.textContent = 'Start capturing your thoughts in seconds.';
      authSubmit.textContent = 'Create account';
      authSwitchText.textContent = 'Already have an account?';
      authSwitchBtn.textContent = 'Sign in';
    } else {
      currentAuthMode = 'signin';
      authTitle.innerHTML = 'Welcome back<span class="title-period">.</span>';
      authIntro.textContent = 'Sign in to pick up where your thoughts left off.';
      authSubmit.textContent = 'Sign in';
      authSwitchText.textContent = 'New to AudiNotes?';
      authSwitchBtn.textContent = 'Create an account';
    }
  });

  // Execute Authentication
  async function handleAuth(e) {
    if (e) e.preventDefault();
    authError.classList.add('hidden');

    const email = document.getElementById('authEmail').value.trim();
    const password = document.getElementById('authPassword').value.trim();

    if (!email || !password) {
      showAuthError('Please fill in all fields.');
      return;
    }

    authSubmit.disabled = true;
    authSubmit.textContent = 'Processing...';

    try {
      if (currentAuthMode === 'signup') {
        const { data, error } = await supabaseClient.auth.signUp({ email, password });
        if (error) throw error;
        
        if (data?.session) {
          showWorkspace(data.session.user);
        } else {
          showAuthError('Check your email for confirmation link or sign in.');
        }
      } else {
        const { data, error } = await supabaseClient.auth.signInWithPassword({ email, password });
        if (error) throw error;
        showWorkspace(data.session.user);
      }
    } catch (err) {
      showAuthError(err.message || 'Authentication failed');
    } finally {
      authSubmit.disabled = false;
      authSubmit.textContent = currentAuthMode === 'signup' ? 'Create account' : 'Sign in';
    }
  }

  authSubmit?.addEventListener('click', handleAuth);
  authForm?.addEventListener('submit', handleAuth);

  function showAuthError(msg) {
    authError.textContent = msg;
    authError.classList.remove('hidden');
  }

  function showWorkspace(user) {
    authScreen.classList.add('hidden');
    appShell.classList.remove('auth-hidden');
    if (accountEmail) accountEmail.textContent = user.email;
    if (accountButton) accountButton.textContent = user.email.charAt(0).toUpperCase();
    window.dispatchEvent(new Event('authReady'));
  }

  // Account Dropdown Toggle
  accountButton?.addEventListener('click', (e) => {
    e.stopPropagation();
    accountMenu.classList.toggle('hidden');
  });

  document.addEventListener('click', () => {
    accountMenu?.classList.add('hidden');
  });

  // Logout Handler
  logoutBtn?.addEventListener('click', async () => {
    await supabaseClient.auth.signOut();
    window.location.reload();
  });

  // Session Observer
  supabaseClient.auth.getSession().then(({ data: { session } }) => {
    if (session) {
      showWorkspace(session.user);
    } else {
      authScreen.classList.remove('hidden');
      appShell.classList.add('auth-hidden');
    }
  });
});