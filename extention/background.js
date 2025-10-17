// Background service worker (MV3)

chrome.runtime.onInstalled.addListener(() => {
    chrome.contextMenus.create({
        id: "pagegenie-summarize-selection",
        title: "PageGenie: Summarize Selection",
        contexts: ["selection"]
    });
    chrome.contextMenus.create({
        id: "pagegenie-explain-selection",
        title: "PageGenie: Explain Selection",
        contexts: ["selection"]
    });
    chrome.contextMenus.create({
        id: "pagegenie-translate-selection",
        title: "PageGenie: Translate Selection",
        contexts: ["selection"]
    });
});

chrome.contextMenus.onClicked.addListener(async (info, tab) => {
    if (!tab?.id) return;
    const op =
        info.menuItemId === "pagegenie-summarize-selection" ? "summarize" :
            info.menuItemId === "pagegenie-explain-selection" ? "explain" :
                info.menuItemId === "pagegenie-translate-selection" ? "translate" :
                    null;
    if (!op) return;

    chrome.tabs.sendMessage(tab.id, { type: "PAGEGENIE_CONTEXT_ACTION", operation: op });
});

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    // Centralized persistence/AI calls to Spring Boot backend
    if (msg?.type === "PAGEGENIE_PERSIST") {
        (async () => {
            try {
                const { endpoint, payload } = msg;
                const { backendUrl, apiToken, tokenExp } = await chrome.storage.sync.get({
                    backendUrl: "http://localhost:8098",
                    apiToken: "",
                    tokenExp: 0
                });

                if (!backendUrl) throw new Error("Backend URL not configured in Options.");

                // Preempt expired token
                const now = Date.now();
                if (apiToken && tokenExp && now >= tokenExp) {
                    await chrome.storage.sync.set({ apiToken: "", tokenExp: 0 });
                }

                const res = await fetch(new URL(endpoint, backendUrl).toString(), {
                    method: "POST",
                    headers: {
                        "Content-Type": "application/json",
                        ...(apiToken ? { "Authorization": `Bearer ${apiToken}` } : {})
                    },
                    body: JSON.stringify(payload),
                    credentials: "omit"
                });

                if (res.status === 401) {
                    // Clear token and notify caller
                    await chrome.storage.sync.set({ apiToken: "", tokenExp: 0 });
                    throw new Error("Unauthorized. Please log in again.");
                }

                if (!res.ok) {
                    const text = await res.text().catch(() => "");
                    throw new Error(`Backend error ${res.status}: ${text || res.statusText}`);
                }

                const data = await res.json().catch(() => ({}));
                sendResponse({ ok: true, data });
            } catch (e) {
                sendResponse({ ok: false, error: e?.message || String(e) });
            }
        })();
        return true; // keep port open for async sendResponse
    }

    // Handle login: POST to /api/v1/auth/login and read Authorization header
    if (msg?.type === "PAGEGENIE_AUTH_LOGIN") {
        (async () => {
            try {
                const { username, password, path } = msg;
                if (!username || !password) throw new Error("Username and password are required.");
                const { backendUrl } = await chrome.storage.sync.get({ backendUrl: "http://localhost:8098" });
                if (!backendUrl) throw new Error("Backend URL not configured in Options.");

                const loginPath = path || "/api/v1/auth/login";
                const url = new URL(loginPath, backendUrl).toString();

                const res = await fetch(url, {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ username, password }),
                    credentials: "omit"
                });

                if (!res.ok) {
                    const body = await res.text().catch(() => "");
                    throw new Error(`Login failed (${res.status}): ${body || res.statusText}`);
                }

                const authHeader = res.headers.get("Authorization") || res.headers.get("authorization");
                if (!authHeader || !authHeader.toLowerCase().startsWith("bearer ")) {
                    throw new Error("Authorization header missing in response.");
                }

                const token = authHeader.slice(7).trim();
                const expMs = getJwtExpMs(token) ?? (Date.now() + 15 * 60 * 1000); // fallback 15min

                await chrome.storage.sync.set({
                    apiToken: token,
                    tokenExp: expMs
                });

                sendResponse({ ok: true, token, exp: expMs });
            } catch (e) {
                sendResponse({ ok: false, error: e?.message || String(e) });
            }
        })();
        return true;
    }

    if (msg?.type === "PAGEGENIE_AUTH_LOGOUT") {
        (async () => {
            await chrome.storage.sync.set({ apiToken: "", tokenExp: 0 });
            sendResponse({ ok: true });
        })();
        return true;
    }
});

// Helpers

function getJwtExpMs(token) {
    try {
        const parts = token.split(".");
        if (parts.length !== 3) return null;
        const payload = JSON.parse(atob(base64UrlToBase64(parts[1])));
        if (!payload?.exp) return null;
        return Number(payload.exp) * 1000;
    } catch {
        return null;
    }
}

function base64UrlToBase64(s) {
    s = s.replace(/-/g, "+").replace(/_/g, "/");
    const pad = s.length % 4;
    return pad ? s + "=".repeat(4 - pad) : s;
}