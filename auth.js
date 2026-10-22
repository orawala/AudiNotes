(() => {
  const $ = (id) => document.getElementById(id);
  const config = window.AUDIONOTES_CONFIG || {};
  const configReady = config.supabaseUrl && config.supabasePublishableKey &&
    !config.supabaseUrl.includes("PASTE_") && !config.supabasePublishableKey.includes("PASTE_");
  let supabaseClient = null;
  let mode = "login";
  let user = null;

  function showError(message) {
    const el = $("authError");
    el.textContent = message;
    el.classList.remove("hidden");
  }
  function clearError() {
    $("authError").textContent = "";
    $("authError").classList.add("hidden");
  }
  function setMode(nextMode) {
    mode = nextMode;
    clearError();
    const signup = mode === "signup";
    $("authTitle").innerHTML = signup ? 'Create your account<span class="title-period">.</span>' : 'Welcome back<span class="title-period">.</span>';
    $("authEyebrow").textContent = signup ? "START YOUR PRIVATE WORKSPACE" : "YOUR PERSONAL WORKSPACE";
    $("authIntro").textContent = signup ? "A place to keep your notes and recordings together." : "Sign in to pick up where your thoughts left off.";
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
    window.dispatchEvent(new CustomEvent("audionotes-auth-changed", {detail:{user, client:supabaseClient}}));
  }
  async function init() {
    if (!configReady || !window.supabase?.createClient) {
      $("authIntro").textContent = "Add your Supabase Project URL and publishable key in config.js to connect your account.";
      showError("Supabase is not configured yet. Open config.js and replace both placeholder values.");
      $("authSubmit").disabled = true;
      return;
    }
    supabaseClient = window.supabase.createClient(config.supabaseUrl, config.supabasePublishableKey, {
      auth: { persistSession:true, autoRefreshToken:true, detectSessionInUrl:true }
    });
    const {data, error} = await supabaseClient.auth.getSession();
    if(error) showError(error.message);
    setSignedIn(data?.session?.user || null);
    supabaseClient.auth.onAuthStateChange((_event, session) => setSignedIn(session?.user || null));
  }
  $("authForm").addEventListener("submit", async (event) => {
    event.preventDefault(); clearError();
    if(!supabaseClient) { showError("Supabase is not configured. Check config.js."); return; }
    const email = $("authEmail").value.trim();
    const password = $("authPassword").value;
    const submit = $("authSubmit");
    submit.disabled = true; submit.textContent = mode==="signup" ? "Creating account…" : "Signing in…";
    try {
      if(mode==="signup") {
      const {data, error} = await supabaseClient.auth.signUp({
        email,
        password,
        options: {
          emailRedirectTo: window.location.origin + window.location.pathname
        }
      });        
      if(error) throw error;
        if(data.session) {
          setSignedIn(data.session.user);
        } else {
          showError("Account created. Check your email for a confirmation link, then return here to sign in.");
        }
      } else {
        const {data, error} = await supabaseClient.auth.signInWithPassword({email,password});
        if(error) throw error;
        setSignedIn(data.user);
      }
    } catch(error) {
      showError(error.message || "Authentication failed. Please try again.");
    } finally {
      submit.disabled = false; submit.textContent = mode==="signup" ? "Create account" : "Sign in";
    }
  });
  $("authSwitchBtn").addEventListener("click",()=>setMode(mode==="login"?"signup":"login"));
  $("accountButton").addEventListener("click",()=> $("accountMenu").classList.toggle("hidden"));
  $("logoutBtn").addEventListener("click",async()=>{
    if(!supabaseClient) return;
    const {error}=await supabaseClient.auth.signOut();
    if(error) showError(error.message);
    else { $("accountMenu").classList.add("hidden"); setSignedIn(null); }
  });
  document.addEventListener("click",(e)=>{
    if(!e.target.closest("#accountMenu")&&!e.target.closest("#accountButton")) $("accountMenu").classList.add("hidden");
  });
  window.AudiNotesAuth = {
    getClient:()=>supabaseClient,
    getUser:()=>user,
    isConfigured:()=>!!supabaseClient
  };
  setMode("login");
  init();
})();