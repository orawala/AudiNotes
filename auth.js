(() => {
  const $ = (id) => document.getElementById(id);
  const config = window.AUDIONOTES_CONFIG || {};

  // FIXED: Properly validates key presence regardless of publishable key prefix format
  const configReady = Boolean(
    config.supabaseUrl &&
    config.supabasePublishableKey &&
    !config.supabaseUrl.includes("PASTE_") &&
    !config.supabasePublishableKey.includes("PASTE_") &&
    config.supabaseUrl.startsWith("http")
  );

  let mode = "login";
  let user = null;

  function showError(message) {
    const el = $("authError");
    if (!el) return;
    el.textContent = message;
    el.classList.remove("hidden");
  }

  function clearError() {
    const el = $("authError");
    if (!el) return;
    el.textContent = "";
    el.classList.add("hidden");
  }

  function setMode(nextMode) {
    mode = nextMode;
    clearError();
    const signup = mode === "signup";
    $("authTitle").innerHTML = signup ? 'Create your account<span class="title-period">.</span>' : 'Welcome back<span class="title-period">.</span>';
    $("authSubmit").textContent = signup ? "Create account" : "Sign in";
    $("authSwitchText").textContent = signup ? "Already have an account?" : "New to AudiNotes?";
    $("authSwitchBtn").textContent = signup ? "Sign in" : "Create an account";
    $("authPassword").autocomplete = signup ? "new-password" : "current-password";
  }

  function setSignedIn(nextUser) {
    user = nextUser || null;
    $("authScreen").classList.toggle("hidden", !!user);
    $("appShell").classList.toggle("auth-hidden", !user);
    $("accountEmail").textContent = user?.email || "";
    $("accountButton").textContent = user?.email?.slice(0,1).toUpperCase() || "A";
    $("accountMenu").classList.add("hidden");

    window.dispatchEvent(new CustomEvent("audionotes-auth-changed", {
      detail: { user, client: window.supabaseClient }
    }));
  }

  async function init() {
    if (!configReady || !window.supabase?.createClient) {
      showError("Supabase is not configured yet. Open config.js and check your URL and publishable key.");
      $("authSubmit").disabled = true;
      return;
    }

    // Initialize global Supabase client instance
    window.supabaseClient = window.supabase.createClient(config.supabaseUrl, config.supabasePublishableKey, {
      auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true }
    });

    const { data, error } = await window.supabaseClient.auth.getSession();
    if (error) showError(error.message);
    setSignedIn(data?.session?.user || null);

    window.supabaseClient.auth.onAuthStateChange((_event, session) => setSignedIn(session?.user || null));
  }

  $("authForm")?.addEventListener("submit", async (event) => {
    event.preventDefault(); 
    clearError();

    if (!window.supabaseClient) { 
      showError("Supabase is not configured. Check config.js."); 
      return; 
    }

    const email = $("authEmail").value.trim();
    const password = $("authPassword").value;
    const submit = $("authSubmit");

    submit.disabled = true; 
    submit.textContent = mode === "signup" ? "Creating account…" : "Signing in…";

    try {
      if (mode === "signup") {
        const { data, error } = await window.supabaseClient.auth.signUp({
          email,
          password,
          options: {
            emailRedirectTo: window.location.origin + window.location.pathname
          }
        });        
        if (error) throw error;

        if (data.session) {
          setSignedIn(data.session.user);
        } else {
          showError("Account created. Check your email for a confirmation link.");
        }
      } else {
        const { data, error } = await window.supabaseClient.auth.signInWithPassword({ email, password });
        if (error) throw error;
        setSignedIn(data.user);
      }
    } catch(error) {
      showError(error.message || "Authentication failed. Please try again.");
    } finally {
      submit.disabled = false; 
      submit.textContent = mode === "signup" ? "Create account" : "Sign in";
    }
  });

  $("authSwitchBtn")?.addEventListener("click", () => setMode(mode === "login" ? "signup" : "login"));
  $("accountButton")?.addEventListener("click", () => $("accountMenu").classList.toggle("hidden"));

  $("logoutBtn")?.addEventListener("click", async () => {
    if (!window.supabaseClient) return;
    const { error } = await window.supabaseClient.auth.signOut();
    if (error) showError(error.message);
    else { 
      $("accountMenu").classList.add("hidden"); 
      setSignedIn(null); 
    }
  });

  document.addEventListener("click", (e) => {
    if (!e.target.closest("#accountMenu") && !e.target.closest("#accountButton")) {
      $("accountMenu")?.classList.add("hidden");
    }
  });

  window.AudiNotesAuth = {
    getClient: () => window.supabaseClient,
    getUser: () => user,
    isConfigured: () => !!window.supabaseClient
  };

  setMode("login");
  init();
})();