document.addEventListener("DOMContentLoaded", async () => {
    const modeSel = document.getElementById("mode");
    const toolbarChk = document.getElementById("toolbar");
    const langSel = document.getElementById("lang");

    const usernameEl = document.getElementById("username");
    const passwordEl = document.getElementById("password");
    const loginBtn = document.getElementById("login");
    const logoutBtn = document.getElementById("logout");
    const authStatus = document.getElementById("authStatus");

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

    function renderAuthStatus() {
        const now = Date.now();
        if (st.apiToken && st.tokenExp && now < st.tokenExp) {
            const mins = Math.max(0, Math.round((st.tokenExp - now) / 60000));
            authStatus.textContent = `Logged in. Token expires in ~${mins} min.`;
            authStatus.className = "hint status-ok";
        } else if (st.backendUrl) {
            authStatus.textContent = "Not logged in.";
            authStatus.className = "hint";
        } else {
            authStatus.textContent = "Set backend URL in Options first.";
            authStatus.className = "hint status-err";
        }
    }
    renderAuthStatus();

    loginBtn.addEventListener("click", async () => {
        const username = usernameEl.value.trim();
        const password = passwordEl.value;
        if (!username || !password) {
            authStatus.textContent = "Enter username and password.";
            authStatus.className = "hint status-err";
            return;
        }

        authStatus.textContent = "Logging in...";
        authStatus.className = "hint";

        chrome.runtime.sendMessage(
            { type: "PAGEGENIE_AUTH_LOGIN", username, password },
            async (resp) => {
                if (resp?.ok) {
                    const { token, exp } = resp;
                    st.apiToken = token;
                    st.tokenExp = exp || 0;
                    // Clear password input for safety
                    passwordEl.value = "";
                    renderAuthStatus();
                } else {
                    authStatus.textContent = "Login failed: " + (resp?.error || "unknown error");
                    authStatus.className = "hint status-err";
                }
            }
        );
    });

    logoutBtn.addEventListener("click", async () => {
        chrome.runtime.sendMessage({ type: "PAGEGENIE_AUTH_LOGOUT" }, async (resp) => {
            if (resp?.ok) {
                st.apiToken = "";
                st.tokenExp = 0;
                renderAuthStatus();
            }
        });
    });

    // Keep status in sync if storage changes elsewhere
    chrome.storage.onChanged.addListener((changes, area) => {
        if (area !== "sync") return;
        if (changes.apiToken) st.apiToken = changes.apiToken.newValue;
        if (changes.tokenExp) st.tokenExp = changes.tokenExp.newValue;
        if (changes.backendUrl) st.backendUrl = changes.backendUrl.newValue;
        renderAuthStatus();
    });
});