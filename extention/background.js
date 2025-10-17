// Background service worker (MV3)

function setupContextMenus() {
    chrome.contextMenus.removeAll(() => {
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
        chrome.contextMenus.create({
            id: "pagegenie-quiz-page",
            title: "PageGenie: Quiz Me (Entire Page)",
            contexts: ["page"]
        });
    });
}

chrome.runtime.onInstalled.addListener(setupContextMenus);
chrome.runtime.onStartup.addListener(setupContextMenus);

chrome.contextMenus.onClicked.addListener(async (info, tab) => {
    if (!tab || !tab.id) return;

    // Selection actions
    if (info.menuItemId === "pagegenie-summarize-selection") {
        return chrome.tabs.sendMessage(tab.id, { type: "PAGEGENIE_CONTEXT_ACTION", operation: "summarize" });
    }
    if (info.menuItemId === "pagegenie-explain-selection") {
        return chrome.tabs.sendMessage(tab.id, { type: "PAGEGENIE_CONTEXT_ACTION", operation: "explain" });
    }
    if (info.menuItemId === "pagegenie-translate-selection") {
        return chrome.tabs.sendMessage(tab.id, { type: "PAGEGENIE_CONTEXT_ACTION", operation: "translate" });
    }

    // Quiz action
    if (info.menuItemId === "pagegenie-quiz-page") {
        try {
            const pageUrl = tab.url || info.pageUrl;
            if (!pageUrl || !/^https?:\/\//i.test(pageUrl)) {
                return toast(tab.id, "Quiz Me works only on http/https pages.");
            }

            const { backendUrl, apiToken } = await chrome.storage.sync.get({
                backendUrl: "http://localhost:8098",
                apiToken: ""
            });

            if (!backendUrl) {
                return toast(tab.id, "Backend URL not set. Open Options and set http://localhost:8098");
            }

            if (!apiToken) {
                return toast(tab.id, "Please log in from the PageGenie popup first.");
            }

            // Generate quiz on backend
            const url = new URL("/api/v1/quiz/generate", backendUrl).toString();
            const res = await fetch(url, {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    "Authorization": `Bearer ${apiToken}`
                },
                body: JSON.stringify({ url: pageUrl }),
                credentials: "omit"
            });

            if (res.status === 401) {
                await chrome.storage.sync.set({ apiToken: "", tokenExp: 0 });
                return toast(tab.id, "Unauthorized. Please log in again from the PageGenie popup.");
            }
            if (!res.ok) {
                const t = await res.text().catch(() => "");
                throw new Error(`Quiz generation failed ${res.status}: ${t || res.statusText}`);
            }

            const data = await res.json().catch(() => ({}));
            const quizId = data.id;

            if (!quizId) {
                throw new Error("Backend did not return a quiz id.");
            }

            // Open extension's quiz UI (not backend /quiz/{id})
            const extUrl = chrome.runtime.getURL(`quiz/quiz.html?id=${encodeURIComponent(quizId)}&src=${encodeURIComponent(pageUrl)}`);
            await chrome.tabs.create({ url: extUrl });
            toast(tab.id, "Quiz created. Opening...");
        } catch (e) {
            console.error("Quiz error", e);
            toast(tab.id, e?.message || String(e));
        }
    }
});

// Centralized calls to backend used by content script (unchanged)
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
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
        return true;
    }

    if (msg?.type === "PAGEGENIE_AUTH_LOGIN") {
        (async () => {
            try {
                const { username, password, path } = msg;
                if (!username || !password) throw new Error("Username and password are required.");
                const { backendUrl } = await chrome.storage.sync.get({ backendUrl: "http://localhost:8098" });
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
                const expMs = getJwtExpMs(token) ?? (Date.now() + 15 * 60 * 1000);

                await chrome.storage.sync.set({ apiToken: token, tokenExp: expMs });
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
function toast(tabId, message) {
    try {
        chrome.tabs.sendMessage(tabId, { type: "PAGEGENIE_TOAST", message });
    } catch (e) {
        console.warn("Toast send failed", e);
    }
}
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