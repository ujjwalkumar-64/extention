document.addEventListener("DOMContentLoaded", async () => {
    const modeSel = document.getElementById("mode");
    const toolbarChk = document.getElementById("toolbar");
    const langSel = document.getElementById("lang");

    const usernameEl = document.getElementById("username");
    const passwordEl = document.getElementById("password");
    const fullNameEl = document.getElementById("fullName");
    const signupExtra = document.getElementById("signupExtra");

    const loginBtn = document.getElementById("login");
    const signupBtn = document.getElementById("signup");
    const toggleSignupBtn = document.getElementById("toggleSignup");
    const logoutBtn = document.getElementById("logout");
    const readingBtn = document.getElementById("readingMode");
    const authStatus = document.getElementById("authStatus");

    const profileBlock = document.getElementById("profileBlock");
    const whoEl = document.getElementById("who");

    const st = await chrome.storage.sync.get({
        mode: "auto",
        showToolbarOnSelection: true,
        targetLang: "en",
        apiToken: "",
        tokenExp: 0,
        backendUrl: ""
    });

    modeSel.value = st.mode;
    toolbarChk.checked = st.showToolbarOnSelection;
    langSel.value = st.targetLang;

    modeSel.addEventListener("change", () => chrome.storage.sync.set({ mode: modeSel.value }));
    toolbarChk.addEventListener("change", () => chrome.storage.sync.set({ showToolbarOnSelection: toolbarChk.checked }));
    langSel.addEventListener("change", () => chrome.storage.sync.set({ targetLang: langSel.value }));

    // UI helpers
    function setStatus(text, ok = null) {
        authStatus.textContent = text || "";
        authStatus.className = "hint " + (ok === true ? "status-ok" : ok === false ? "status-err" : "");
    }
    function showProfile(fullName, username) {
        whoEl.textContent = `${fullName || username} (@${username})`;
        profileBlock.classList.remove("hidden");
    }
    function hideProfile() {
        profileBlock.classList.add("hidden");
        whoEl.textContent = "";
    }
    function isLoggedIn() {
        const now = Date.now();
        return Boolean(st.apiToken && st.tokenExp && now < st.tokenExp);
    }

    async function refreshMe() {
        try {
            const { backendUrl, apiToken } = await chrome.storage.sync.get({
                backendUrl: "http://localhost:8098",
                apiToken: ""
            });
            if (!backendUrl || !apiToken) {
                hideProfile();
                renderAuthStatus();
                return;
            }
            const res = await fetch(new URL("/api/v1/auth/me", backendUrl).toString(), {
                headers: { "Authorization": `Bearer ${apiToken}` },
                credentials: "omit"
            });
            if (!res.ok) {
                if (res.status === 401) {
                    await chrome.storage.sync.set({ apiToken: "", tokenExp: 0 });
                    st.apiToken = "";
                    st.tokenExp = 0;
                }
                hideProfile();
                renderAuthStatus();
                return;
            }
            const me = await res.json();
            showProfile(me.fullName, me.username);
            renderAuthStatus();
        } catch {
            hideProfile();
            renderAuthStatus();
        }
    }

    function renderAuthStatus() {
        const now = Date.now();
        if (st.apiToken && st.tokenExp && now < st.tokenExp) {
            const mins = Math.max(0, Math.round((st.tokenExp - now) / 60000));
            setStatus(`Logged in. Token expires in ~${mins} min.`, true);
        } else if (st.backendUrl) {
            setStatus("Not logged in.");
        } else {
            setStatus("Set backend URL in Options first.", false);
        }
    }
    renderAuthStatus();

    // Toggle visibility of signup full name row
    toggleSignupBtn.addEventListener("click", () => {
        signupExtra.classList.toggle("hidden");
    });

    // Login
    loginBtn.addEventListener("click", async () => {
        const username = usernameEl.value.trim();
        const password = passwordEl.value;
        if (!username || !password) {
            setStatus("Enter username and password.", false);
            return;
        }
        setStatus("Logging in...");
        chrome.runtime.sendMessage(
            { type: "PAGEGENIE_AUTH_LOGIN", username, password },
            async (resp) => {
                if (chrome.runtime.lastError) {
                    setStatus("Login failed: " + chrome.runtime.lastError.message, false);
                    return;
                }
                if (resp?.ok) {
                    const { token, exp } = resp;
                    st.apiToken = token;
                    st.tokenExp = exp || 0;
                    passwordEl.value = "";
                    setStatus("Logged in.", true);
                    await refreshMe();
                } else {
                    setStatus("Login failed: " + (resp?.error || "unknown error"), false);
                }
            }
        );
    });

    // Signup
    signupBtn.addEventListener("click", async () => {
        const username = usernameEl.value.trim();
        const password = passwordEl.value;
        const fullName = fullNameEl.value.trim();
        if (!username || !password || !fullName) {
            setStatus("Full name, username, and password are required for signup.", false);
            return;
        }
        setStatus("Signing up...");
        chrome.runtime.sendMessage(
            { type: "PAGEGENIE_AUTH_SIGNUP", username, password, fullName },
            async (resp) => {
                if (chrome.runtime.lastError) {
                    setStatus("Signup failed: " + chrome.runtime.lastError.message, false);
                    return;
                }
                if (!resp?.ok) {
                    setStatus("Signup failed: " + (resp?.error || "unknown error"), false);
                    return;
                }
                // Auto-login after signup
                chrome.runtime.sendMessage(
                    { type: "PAGEGENIE_AUTH_LOGIN", username, password },
                    async (loginResp) => {
                        if (loginResp?.ok) {
                            st.apiToken = loginResp.token;
                            st.tokenExp = loginResp.exp || 0;
                            passwordEl.value = "";
                            setStatus("Signed up and logged in.", true);
                            signupExtra.classList.add("hidden");
                            await refreshMe();
                        } else {
                            setStatus("Account created. Please login.", true);
                        }
                    }
                );
            }
        );
    });

    // Logout
    logoutBtn.addEventListener("click", async () => {
        chrome.runtime.sendMessage({ type: "PAGEGENIE_AUTH_LOGOUT" }, async (resp) => {
            if (resp?.ok) {
                st.apiToken = "";
                st.tokenExp = 0;
                hideProfile();
                setStatus("Logged out.", true);
                renderAuthStatus();
            }
        });
    });

    // Reading Mode page
    readingBtn.addEventListener("click", () => {
        const url = chrome.runtime.getURL("reading/reading.html");
        chrome.tabs.create({ url });
    });

    // Keep status in sync if storage changes elsewhere
    chrome.storage.onChanged.addListener((changes, area) => {
        if (area !== "sync") return;
        if (changes.apiToken) st.apiToken = changes.apiToken.newValue;
        if (changes.tokenExp) st.tokenExp = changes.tokenExp.newValue;
        if (changes.backendUrl) st.backendUrl = changes.backendUrl.newValue;
        renderAuthStatus();
        // If token updated, refresh profile
        if (changes.apiToken || changes.tokenExp) {
            refreshMe();
        }
    });

    // If already logged in, load profile now
    if (isLoggedIn()) {
        refreshMe();
    } else {
        hideProfile();
    }
});