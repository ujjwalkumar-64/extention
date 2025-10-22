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
        if (!msg) { statusEl && (statusEl.hidden = true, statusEl.textContent = "", statusEl.className = "pg-status"); return; }
        if (!statusEl) return;
        statusEl.hidden = false;
        statusEl.textContent = msg;
        statusEl.className = "pg-status " + cls;
    }

    async function getSync(keys) { return new Promise((resolve) => chrome.storage.sync.get(keys, resolve)); }
    async function setSync(obj) { return new Promise((resolve) => chrome.storage.sync.set(obj, resolve)); }

    function setSignedInUI({ name, username }) {
        if (authBadge) authBadge.textContent = "Signed in";
        if (authAnon) authAnon.hidden = true;
        if (authUser) authUser.hidden = false;
        const nm = name || username || "there";
        if (welcome) welcome.textContent = `Welcome, ${nm}!`;
    }
    function setSignedOutUI() {
        if (authBadge) authBadge.textContent = "Signed out";
        if (authAnon) authAnon.hidden = false;
        if (authUser) authUser.hidden = true;
        if (welcome) welcome.textContent = "Welcome!";
        setStatus("");
    }

    function applyTheme(theme) {
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
                citeSources: undefined,          // we’ll compute default if undefined
                citeSourcesManual: false,        // NEW: sticky manual override
                theme: "system",
                apiToken: "",
                tokenExp: 0,
                profileName: "",
                profileUsername: ""
            });

            if (modeSel) modeSel.value = cfg.mode || "auto";
            if (toggleSelection) toggleSelection.checked = !!cfg.showToolbarOnSelection;
            if (toggleFloatingButton) toggleFloatingButton.checked = !!cfg.showFloatingButton;
            if (targetLangSel) targetLangSel.value = cfg.targetLang || "en";
            if (personaPresetSel) personaPresetSel.value = cfg.persona || "general";

            if (themeSel) {
                themeSel.value = cfg.theme || "system";
                applyTheme(themeSel.value);
            }

            // Compute initial citeSources: use stored boolean if present; else persona default
            const persona = (personaPresetSel && personaPresetSel.value) || "general";
            const citeDefault = personaDefaultCite(persona);
            const citeIsBool = typeof cfg.citeSources === "boolean";
            const cite = citeIsBool ? cfg.citeSources : citeDefault;

            if (citeSourcesChk) citeSourcesChk.checked = !!cite;

            // If not previously set, persist default and mark as not-manual
            if (!citeIsBool) await setSync({ citeSources: cite, citeSourcesManual: false });

            // Auth UI
            const tokenValid = !!cfg.apiToken && (!cfg.tokenExp || Date.now() < Number(cfg.tokenExp));
            if (tokenValid) setSignedInUI({ name: cfg.profileName, username: cfg.profileUsername });
            else setSignedOutUI();

            await refreshOnboardingBanner();
        } catch (e) {
            setStatus(e?.message || String(e), "err");
        }
    }

    // Keep UI in sync if changed elsewhere (e.g., from another popup or page)
    chrome.storage.onChanged.addListener((changes, area) => {
        if (area !== "sync") return;
        if (changes.citeSources && citeSourcesChk) {
            citeSourcesChk.checked = !!changes.citeSources.newValue;
        }
    });

    // Settings events
    modeSel?.addEventListener("change", async () => {
        await setSync({ mode: modeSel.value });
        setStatus("Mode updated", "ok"); setTimeout(() => setStatus(""), 900);
    });
    toggleSelection?.addEventListener("change", async () => {
        await setSync({ showToolbarOnSelection: toggleSelection.checked });
        setStatus("Selection toolbar setting updated", "ok"); setTimeout(() => setStatus(""), 900);
    });
    toggleFloatingButton?.addEventListener("change", async () => {
        await setSync({ showFloatingButton: toggleFloatingButton.checked });
        setStatus(toggleFloatingButton.checked ? "Floating button enabled" : "Floating button disabled", "ok");
        setTimeout(() => setStatus(""), 900);
    });
    targetLangSel?.addEventListener("change", async () => {
        await setSync({ targetLang: targetLangSel.value });
        setStatus("Target language updated", "ok"); setTimeout(() => setStatus(""), 900);
    });

    themeSel?.addEventListener("change", async () => {
        await setSync({ theme: themeSel.value });
        applyTheme(themeSel.value);
        setStatus("Theme updated", "ok"); setTimeout(() => setStatus(""), 900);
    });

    // Only auto-reset citeSources on persona change if the user has NOT manually overridden it
    personaPresetSel?.addEventListener("change", async () => {
        const persona = personaPresetSel.value;
        const { citeSourcesManual } = await getSync({ citeSourcesManual: false });
        const updates = { persona };
        if (!citeSourcesManual) {
            const cite = personaDefaultCite(persona);
            if (citeSourcesChk) citeSourcesChk.checked = cite;
            updates.citeSources = cite;
        }
        await setSync(updates);
        setStatus("Persona preset updated", "ok"); setTimeout(() => setStatus(""), 900);
    });

    // When user toggles citations, mark it as manual override
    citeSourcesChk?.addEventListener("change", async () => {
        await setSync({ citeSources: citeSourcesChk.checked, citeSourcesManual: true });
        setStatus("Cite sources preference updated", "ok"); setTimeout(() => setStatus(""), 900);
    });

    // Auth events
    loginForm?.addEventListener("submit", async (e) => {
        e.preventDefault();
        setStatus("Signing in…"); if (loginBtn) loginBtn.disabled = true;
        try {
            const username = (loginUsername?.value || "").trim();
            const password = (loginPassword?.value || "").trim();
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
            if (signupWrap) signupWrap.hidden = true;
        } catch (e2) {
            setStatus(e2?.message || String(e2), "err");
        } finally { if (loginBtn) loginBtn.disabled = false; }
    });

    signupForm?.addEventListener("submit", async (e) => {
        e.preventDefault();
        setStatus("Creating account…"); if (signupBtn) signupBtn.disabled = true;
        try {
            const fullName = (signupFullName?.value || "").trim();
            const username = (signupUsername?.value || "").trim();
            const password = (signupPassword?.value || "").trim();
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
            if (loginResp?.ok) { setSignedInUI({ name: fullName, username }); setStatus("Account created and signed in", "ok"); if (signupWrap) signupWrap.hidden = true; }
            else setStatus("Account created. Please log in.", "ok");
        } catch (e2) { setStatus(e2?.message || String(e2), "err"); }
        finally { if (signupBtn) signupBtn.disabled = false; }
    });

    logoutBtn?.addEventListener("click", async () => {
        setStatus("Signing out…");
        try {
            const resp = await new Promise((resolve) => {
                chrome.runtime.sendMessage({ type: "PAGEGENIE_AUTH_LOGOUT" }, (r) => {
                    if (chrome.runtime.lastError) resolve({ ok: false, error: chrome.runtime.lastError.message }); else resolve(r);
                });
            });
            if (!resp?.ok) throw new Error(resp?.error || "Logout failed");
            setSignedOutUI(); if (signupWrap) signupWrap.hidden = false; setStatus("Signed out", "ok");
            setTimeout(() => setStatus(""), 900);
        } catch (e) { setStatus(e?.message || String(e), "err"); }
    });

    readingModeBtn?.addEventListener("click", async () => {
        try {
            await new Promise((resolve) => chrome.runtime.sendMessage({ type: "PAGEGENIE_OPEN_READER", op: "summarize_full" }, () => resolve()));
            setStatus("Opened Reading Mode", "ok"); setTimeout(() => setStatus(""), 1200);
        } catch { setStatus("Failed to open Reading Mode", "err"); }
    });

    openHubBtn?.addEventListener("click", () => {
        const url = chrome.runtime.getURL("pages/reading.html");
        window.open(url, "_blank");
    });

    const appEl = document.getElementById("app");
    const obBanner = document.createElement("div");
    Object.assign(obBanner.style, {
        display: "none",
        margin: "8px 0",
        padding: "8px 10px",
        borderRadius: "8px",
        border: "1px solid var(--border2, rgba(0,0,0,0.12))",
        background: "var(--surface, #171a21)",
        color: "var(--muted, #9aa3b2)",
        fontSize: "12px"
    });
    obBanner.innerHTML = `
    <strong>Finish setup</strong> — run a quick 60‑second tour for best results.
    <button id="openOnboarding" class="pg-btn" style="margin-left:8px">Start</button>
  `;
    appEl?.prepend(obBanner);

    async function refreshOnboardingBanner() {
        try {
            const { onboardingCompleted } = await chrome.storage.sync.get({ onboardingCompleted: true });
            obBanner.style.display = onboardingCompleted ? "none" : "block";
        } catch {
            obBanner.style.display = "none";
        }
    }

    document.addEventListener("click", (e) => {
        if (e.target && e.target.id === "openOnboarding") {
            chrome.runtime.sendMessage({ type: "PAGEGENIE_OPEN_ONBOARDING" });
        }
    });

    bootstrap();
})();