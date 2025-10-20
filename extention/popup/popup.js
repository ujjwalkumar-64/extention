(function () {
    const $ = (id) => document.getElementById(id);
    const authBadge = $("authBadge");
    const statusEl = $("status");

    const authAnon = $("authAnon");
    const authUser = $("authUser");
    const welcome = $("welcome");

    const loginForm = $("loginForm");
    const loginUsername = $("loginUsername");
    const loginPassword = $("loginPassword");
    const loginBtn = $("loginBtn");

    const signupWrap = $("signupWrap");
    const signupForm = $("signupForm");
    const signupFullName = $("signupFullName");
    const signupUsername = $("signupUsername");
    const signupPassword = $("signupPassword");
    const signupBtn = $("signupBtn");

    const logoutBtn = $("logoutBtn");
    const readingModeBtn = $("readingModeBtn");
    const openHubBtn = $("openHubBtn");

    const modeSel = $("mode");
    const toggleSelection = $("toggleSelection");
    const targetLangSel = $("targetLang");

    function setStatus(msg, cls = "") {
        if (!msg) { statusEl.hidden = true; statusEl.textContent = ""; statusEl.className = "pg-status"; return; }
        statusEl.hidden = false;
        statusEl.textContent = msg;
        statusEl.className = "pg-status " + cls;
    }

    async function getSync(keys) {
        return new Promise((resolve) => chrome.storage.sync.get(keys, resolve));
    }
    async function setSync(obj) {
        return new Promise((resolve) => chrome.storage.sync.set(obj, resolve));
    }

    function setSignedInUI({ name, username }) {
        authBadge.textContent = "Signed in";
        authAnon.hidden = true;
        authUser.hidden = false;
        const nm = name || username || "there";
        welcome.textContent = `Welcome, ${nm}!`;
    }
    function setSignedOutUI() {
        authBadge.textContent = "Signed out";
        authAnon.hidden = false;
        authUser.hidden = true;
        welcome.textContent = "Welcome!";
        setStatus("");
    }

    async function bootstrap() {
        try {
            const cfg = await getSync({
                mode: "auto",
                showToolbarOnSelection: true,
                targetLang: "en",
                apiToken: "",
                tokenExp: 0,
                profileName: "",
                profileUsername: ""
            });

            modeSel.value = cfg.mode || "auto";
            toggleSelection.checked = !!cfg.showToolbarOnSelection;
            targetLangSel.value = cfg.targetLang || "en";

            const tokenValid = !!cfg.apiToken && (!cfg.tokenExp || Date.now() < Number(cfg.tokenExp));
            if (tokenValid) {
                setSignedInUI({ name: cfg.profileName, username: cfg.profileUsername });
            } else {
                setSignedOutUI();
            }
        } catch (e) {
            setStatus(e?.message || String(e), "err");
        }
    }

    // Settings events
    modeSel.addEventListener("change", async () => {
        await setSync({ mode: modeSel.value });
        setStatus("Mode updated", "ok");
        setTimeout(() => setStatus(""), 900);
    });
    toggleSelection.addEventListener("change", async () => {
        await setSync({ showToolbarOnSelection: toggleSelection.checked });
        setStatus("Selection toolbar setting updated", "ok");
        setTimeout(() => setStatus(""), 900);
    });
    targetLangSel.addEventListener("change", async () => {
        await setSync({ targetLang: targetLangSel.value });
        setStatus("Target language updated", "ok");
        setTimeout(() => setStatus(""), 900);
    });

    // Log in
    loginForm.addEventListener("submit", async (e) => {
        e.preventDefault();
        setStatus("Signing in…");
        loginBtn.disabled = true;

        try {
            const username = (loginUsername.value || "").trim();
            const password = (loginPassword.value || "").trim();
            if (!username || !password) throw new Error("Username and password required");

            const resp = await new Promise((resolve) => {
                chrome.runtime.sendMessage(
                    { type: "PAGEGENIE_AUTH_LOGIN", username, password },
                    (r) => {
                        if (chrome.runtime.lastError) {
                            resolve({ ok: false, error: chrome.runtime.lastError.message });
                        } else {
                            resolve(r);
                        }
                    }
                );
            });

            if (!resp?.ok) throw new Error(resp?.error || "Login failed");
            await setSync({ profileUsername: username });
            const cfg = await getSync({ profileName: "", profileUsername: "" });
            setSignedInUI({ name: cfg.profileName, username: cfg.profileUsername });
            setStatus("Signed in", "ok");

            // Hide signup block after login
            signupWrap.hidden = true;
        } catch (e2) {
            setStatus(e2?.message || String(e2), "err");
        } finally {
            loginBtn.disabled = false;
        }
    });

    // Sign up
    signupForm.addEventListener("submit", async (e) => {
        e.preventDefault();
        setStatus("Creating account…");
        signupBtn.disabled = true;

        try {
            const fullName = (signupFullName.value || "").trim();
            const username = (signupUsername.value || "").trim();
            const password = (signupPassword.value || "").trim();
            if (!fullName || !username || !password) throw new Error("All fields are required");

            const resp = await new Promise((resolve) => {
                chrome.runtime.sendMessage(
                    { type: "PAGEGENIE_AUTH_SIGNUP", fullName, username, password },
                    (r) => {
                        if (chrome.runtime.lastError) {
                            resolve({ ok: false, error: chrome.runtime.lastError.message });
                        } else {
                            resolve(r);
                        }
                    }
                );
            });
            if (!resp?.ok) throw new Error(resp?.error || "Signup failed");

            // Persist profile name/username locally
            await setSync({ profileName: fullName, profileUsername: username });

            // Attempt auto-login
            const loginResp = await new Promise((resolve) => {
                chrome.runtime.sendMessage(
                    { type: "PAGEGENIE_AUTH_LOGIN", username, password },
                    (r) => {
                        if (chrome.runtime.lastError) {
                            resolve({ ok: false, error: chrome.runtime.lastError.message });
                        } else {
                            resolve(r);
                        }
                    }
                );
            });

            if (loginResp?.ok) {
                setSignedInUI({ name: fullName, username });
                setStatus("Account created and signed in", "ok");
                signupWrap.hidden = true;
            } else {
                setStatus("Account created. Please log in.", "ok");
            }
        } catch (e2) {
            setStatus(e2?.message || String(e2), "err");
        } finally {
            signupBtn.disabled = false;
        }
    });

    // Log out
    logoutBtn.addEventListener("click", async () => {
        setStatus("Signing out…");
        try {
            const resp = await new Promise((resolve) => {
                chrome.runtime.sendMessage({ type: "PAGEGENIE_AUTH_LOGOUT" }, (r) => {
                    if (chrome.runtime.lastError) {
                        resolve({ ok: false, error: chrome.runtime.lastError.message });
                    } else {
                        resolve(r);
                    }
                });
            });
            if (!resp?.ok) throw new Error(resp?.error || "Logout failed");
            setSignedOutUI();
            // Re-enable signup UI after logout
            signupWrap.hidden = false;
            setStatus("Signed out", "ok");
            setTimeout(() => setStatus(""), 900);
        } catch (e) {
            setStatus(e?.message || String(e), "err");
        }
    });

    // Open Reading Mode (PDF Reader page)
    readingModeBtn.addEventListener("click", async () => {
        try {
            await new Promise((resolve) => {
                chrome.runtime.sendMessage({ type: "PAGEGENIE_OPEN_READER", op: "summarize_full" }, () => resolve());
            });
            setStatus("Opened Reading Mode", "ok");
            setTimeout(() => setStatus(""), 1200);
        } catch {
            setStatus("Failed to open Reading Mode", "err");
        }
    });

    // Open Library (notes/suggestions/quizzes hub)
    openHubBtn.addEventListener("click", () => {
        const url = chrome.runtime.getURL("pages/reading.html");
        window.open(url, "_blank");
    });

    // Init
    bootstrap();
})();