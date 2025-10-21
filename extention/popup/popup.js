(function () {
    const $ = (id) => document.getElementById(id);
    const statusEl = $("status");

    const authBadge = $("authBadge");
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
    const toggleFloatingButton = $("toggleFloatingButton");
    const targetLangSel = $("targetLang");
    const themeSel = $("theme");

    const personaPresetSel = $("personaPreset");
    const citeSourcesChk = $("citeSources");

    function setStatus(msg, cls = "") {
        if (!msg) { statusEl.hidden = true; statusEl.textContent = ""; statusEl.className = "pg-status"; return; }
        statusEl.hidden = false;
        statusEl.textContent = msg;
        statusEl.className = "pg-status " + cls;
    }

    async function getSync(keys) { return new Promise((resolve) => chrome.storage.sync.get(keys, resolve)); }
    async function setSync(obj) { return new Promise((resolve) => chrome.storage.sync.set(obj, resolve)); }

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

    function applyTheme(theme) {
        // 'system' => respect prefers-color-scheme; default to dark vars; switch via data-theme for light only
        const prefersDark = window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches;
        const effective = theme === "system" ? (prefersDark ? "dark" : "light") : theme;
        if (effective === "light") document.documentElement.setAttribute("data-theme", "light");
        else document.documentElement.removeAttribute("data-theme");
    }
    window.matchMedia?.("(prefers-color-scheme: dark)")?.addEventListener?.("change", async () => {
        const cfg = await getSync({ theme: "system" });
        applyTheme(cfg.theme || "system");
    });

    function personaDefaultCite(persona) {
        switch (String(persona || "general")) {
            case "researcher": return true;
            case "student":
            case "editor":
            case "general":
            default: return false;
        }
    }

    async function bootstrap() {
        try {
            const cfg = await getSync({
                mode: "auto",
                showToolbarOnSelection: true,
                showFloatingButton: false,
                showFullPageConfirm: true,
                targetLang: "en",
                persona: "general",
                citeSources: undefined,
                theme: "system",
                apiToken: "",
                tokenExp: 0,
                profileName: "",
                profileUsername: ""
            });

            modeSel.value = cfg.mode || "auto";
            toggleSelection.checked = !!cfg.showToolbarOnSelection;
            toggleFloatingButton.checked = !!cfg.showFloatingButton;
            targetLangSel.value = cfg.targetLang || "en";
            personaPresetSel.value = cfg.persona || "general";

            themeSel.value = cfg.theme || "system";
            applyTheme(themeSel.value);

            const citeDefault = personaDefaultCite(personaPresetSel.value);
            const cite = (typeof cfg.citeSources === "boolean") ? cfg.citeSources : citeDefault;
            citeSourcesChk.checked = !!cite;
            if (typeof cfg.citeSources !== "boolean") await setSync({ citeSources: cite });

            const tokenValid = !!cfg.apiToken && (!cfg.tokenExp || Date.now() < Number(cfg.tokenExp));
            if (tokenValid) setSignedInUI({ name: cfg.profileName, username: cfg.profileUsername });
            else setSignedOutUI();
        } catch (e) {
            setStatus(e?.message || String(e), "err");
        }
    }

    // Settings events
    modeSel.addEventListener("change", async () => { await setSync({ mode: modeSel.value }); setStatus("Mode updated", "ok"); setTimeout(() => setStatus(""), 900); });
    toggleSelection.addEventListener("change", async () => { await setSync({ showToolbarOnSelection: toggleSelection.checked }); setStatus("Selection toolbar setting updated", "ok"); setTimeout(() => setStatus(""), 900); });
    toggleFloatingButton.addEventListener("change", async () => { await setSync({ showFloatingButton: toggleFloatingButton.checked }); setStatus(toggleFloatingButton.checked ? "Floating button enabled" : "Floating button disabled", "ok"); setTimeout(() => setStatus(""), 900); });
    targetLangSel.addEventListener("change", async () => { await setSync({ targetLang: targetLangSel.value }); setStatus("Target language updated", "ok"); setTimeout(() => setStatus(""), 900); });

    themeSel.addEventListener("change", async () => {
        await setSync({ theme: themeSel.value });
        applyTheme(themeSel.value);
        setStatus("Theme updated", "ok"); setTimeout(() => setStatus(""), 900);
    });

    personaPresetSel.addEventListener("change", async () => {
        const persona = personaPresetSel.value;
        const cite = personaDefaultCite(persona);
        citeSourcesChk.checked = cite;
        await setSync({ persona, citeSources: cite });
        setStatus("Persona preset updated", "ok"); setTimeout(() => setStatus(""), 900);
    });
    citeSourcesChk.addEventListener("change", async () => { await setSync({ citeSources: citeSourcesChk.checked }); setStatus("Cite sources preference updated", "ok"); setTimeout(() => setStatus(""), 900); });

    // Auth events (unchanged core)
    loginForm.addEventListener("submit", async (e) => {
        e.preventDefault();
        setStatus("Signing in…"); loginBtn.disabled = true;
        try {
            const username = (loginUsername.value || "").trim();
            const password = (loginPassword.value || "").trim();
            if (!username || !password) throw new Error("Username and password required");
            const resp = await new Promise((resolve) => {
                chrome.runtime.sendMessage({ type: "PAGEGENIE_AUTH_LOGIN", username, password }, (r) => {
                    if (chrome.runtime.lastError) resolve({ ok: false, error: chrome.runtime.lastError.message }); else resolve(r);
                });
            });
            if (!resp?.ok) throw new Error(resp?.error || "Login failed");
            await setSync({ profileUsername: username });
            const cfg = await getSync({ profileName: "", profileUsername: "" });
            setSignedInUI({ name: cfg.profileName, username: cfg.profileUsername });
            setStatus("Signed in", "ok");
            signupWrap.hidden = true;
        } catch (e2) {
            setStatus(e2?.message || String(e2), "err");
        } finally { loginBtn.disabled = false; }
    });

    signupForm.addEventListener("submit", async (e) => {
        e.preventDefault();
        setStatus("Creating account…"); signupBtn.disabled = true;
        try {
            const fullName = (signupFullName.value || "").trim();
            const username = (signupUsername.value || "").trim();
            const password = (signupPassword.value || "").trim();
            if (!fullName || !username || !password) throw new Error("All fields are required");
            const resp = await new Promise((resolve) => {
                chrome.runtime.sendMessage({ type: "PAGEGENIE_AUTH_SIGNUP", fullName, username, password }, (r) => {
                    if (chrome.runtime.lastError) resolve({ ok: false, error: chrome.runtime.lastError.message }); else resolve(r);
                });
            });
            if (!resp?.ok) throw new Error(resp?.error || "Signup failed");
            await setSync({ profileName: fullName, profileUsername: username });
            const loginResp = await new Promise((resolve) => {
                chrome.runtime.sendMessage({ type: "PAGEGENIE_AUTH_LOGIN", username, password }, (r) => {
                    if (chrome.runtime.lastError) resolve({ ok: false, error: chrome.runtime.lastError.message }); else resolve(r);
                });
            });
            if (loginResp?.ok) { setSignedInUI({ name: fullName, username }); setStatus("Account created and signed in", "ok"); signupWrap.hidden = true; }
            else setStatus("Account created. Please log in.", "ok");
        } catch (e2) { setStatus(e2?.message || String(e2), "err"); }
        finally { signupBtn.disabled = false; }
    });

    logoutBtn.addEventListener("click", async () => {
        setStatus("Signing out…");
        try {
            const resp = await new Promise((resolve) => {
                chrome.runtime.sendMessage({ type: "PAGEGENIE_AUTH_LOGOUT" }, (r) => {
                    if (chrome.runtime.lastError) resolve({ ok: false, error: chrome.runtime.lastError.message }); else resolve(r);
                });
            });
            if (!resp?.ok) throw new Error(resp?.error || "Logout failed");
            setSignedOutUI(); signupWrap.hidden = false; setStatus("Signed out", "ok");
            setTimeout(() => setStatus(""), 900);
        } catch (e) { setStatus(e?.message || String(e), "err"); }
    });

    readingModeBtn.addEventListener("click", async () => {
        try {
            await new Promise((resolve) => chrome.runtime.sendMessage({ type: "PAGEGENIE_OPEN_READER", op: "summarize_full" }, () => resolve()));
            setStatus("Opened Reading Mode", "ok"); setTimeout(() => setStatus(""), 1200);
        } catch { setStatus("Failed to open Reading Mode", "err"); }
    });

    openHubBtn.addEventListener("click", () => {
        const url = chrome.runtime.getURL("pages/reading.html");
        window.open(url, "_blank");
    });

    bootstrap();
})();