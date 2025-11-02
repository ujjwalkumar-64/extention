// Background service worker (MV3) — PDF-safe context menus and messaging

// ---------- Utils ----------

function arrayBufferToBase64(ab) {
    const bytes = new Uint8Array(ab);
    let bin = "";
    for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
    return btoa(bin);
}
function sendMessageToTab(tabId, message) {
    return new Promise((resolve) => {
        if (typeof tabId !== "number" || tabId < 0) {
            return resolve({ ok: false, error: "Invalid tabId" });
        }
        try {
            chrome.tabs.sendMessage(tabId, message, (resp) => {
                const err = chrome.runtime.lastError?.message;
                if (err) return resolve({ ok: false, error: err });
                resolve({ ok: true, data: resp });
            });
        } catch (e) {
            resolve({ ok: false, error: e?.message || String(e) });
        }
    });
}
function isChromePdfViewerUrl(url) {
    return typeof url === "string" &&
        url.startsWith("chrome-extension://mhjfbmdgcfjbbpaeojofohoefgiehjai/");
}
function looksLikePdfUrl(u) {
    if (!u || typeof u !== "string") return false;
    // Heuristics: .pdf anywhere (path or query), data URLs handled elsewhere
    return /\.pdf($|[\?#])/i.test(u);
}

function extractPdfUrlFromViewer(viewerUrl) {
    try {
        const u = new URL(viewerUrl);
        const keys = ["file", "src", "url", "pdf", "pdfurl", "doc"];
        const candidates = [];
        for (const k of keys) {
            const v = u.searchParams.get(k);
            if (v) candidates.push(v);
        }
        if (u.hash && u.hash.length > 1) {
            const h = new URLSearchParams(u.hash.slice(1));
            for (const k of keys) {
                const v = h.get(k);
                if (v) candidates.push(v);
            }
        }
        for (let cand of candidates) {
            try {
                const d1 = decodeURIComponent(cand);
                const d2 = decodeURIComponent(d1);
                cand = d2 || d1 || cand;
            } catch {}
            if (/^https?:\/\//i.test(cand) || /^file:\/\//i.test(cand) || looksLikePdfUrl(cand)) {
                return cand;
            }
        }
        return null;
    } catch {
        return null;
    }
}
async function openReaderPage(op, pdfUrl) {
    try {
        const base = `pages/reader.html?op=${encodeURIComponent(op || "summarize_full")}`;
        const target = pdfUrl
            ? chrome.runtime.getURL(`${base}&src=${encodeURIComponent(pdfUrl)}`)
            : chrome.runtime.getURL(base); // open without src to show fallback UI
        await chrome.tabs.create({ url: target, active: true });
    } catch (e) {
        console.warn("PAGEGENIE: failed to open reader page:", e?.message || e);
    }
}

// ---------- Track last PDF-like URL per tab ----------
const lastPdfUrlByTabId = new Map();

function rememberPdfUrl(tabId, url) {
    if (typeof tabId === "number" && tabId >= 0 && looksLikePdfUrl(url)) {
        lastPdfUrlByTabId.set(tabId, url);
    }
}

chrome.webNavigation.onCommitted.addListener((details) => {
    const { tabId, url } = details || {};
    if (typeof tabId !== "number" || tabId < 0 || !url) return;

    if (isChromePdfViewerUrl(url)) {
        const inner = extractPdfUrlFromViewer(url);
        if (inner) rememberPdfUrl(tabId, inner);
    } else if (looksLikePdfUrl(url)) {
        rememberPdfUrl(tabId, url);
    }
});

chrome.webNavigation.onHistoryStateUpdated?.addListener((details) => {
    const { tabId, url } = details || {};
    if (typeof tabId !== "number" || tabId < 0 || !url) return;
    if (isChromePdfViewerUrl(url)) {
        const inner = extractPdfUrlFromViewer(url);
        if (inner) rememberPdfUrl(tabId, inner);
    } else if (looksLikePdfUrl(url)) {
        rememberPdfUrl(tabId, url);
    }
});

chrome.tabs.onRemoved.addListener((tabId) => {
    lastPdfUrlByTabId.delete(tabId);
});
chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
    if (changeInfo.status === "loading" && tab?.url && looksLikePdfUrl(tab.url)) {
        rememberPdfUrl(tabId, tab.url);
    }
});

// ---------- Context menus ----------

function setupContextMenus() {
    chrome.contextMenus.removeAll(() => {
        try {
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
                id: "pagegenie-process-full",
                title: "PageGenie: Process Full Document",
                contexts: ["page", "selection", "frame"]
            });
            chrome.contextMenus.create({
                id: "pagegenie-quiz-page",
                title: "PageGenie: Quiz Me (Entire Page)",
                contexts: ["page","selection"]
            });
        } catch (e) {}
    });
}

chrome.runtime.onInstalled.addListener(setupContextMenus);
chrome.runtime.onStartup.addListener(setupContextMenus);


chrome.runtime.onInstalled.addListener(async (details) => {
    // Initialize onboarding flags on first install
    if (details.reason === "install") {
        try {
            await chrome.storage.sync.set({ onboardingCompleted: false, onboardingSampleTried: false });
        } catch {}
        const url = chrome.runtime.getURL("pages/onboarding.html");
        chrome.tabs.create({ url }).catch(() => {});
        return;
    }

    // Optional: surface onboarding on major updates if not completed yet
    if (details.reason === "update") {
        try {
            const cfg = await chrome.storage.sync.get({ onboardingCompleted: true });
            if (!cfg.onboardingCompleted) {
                // Nudge (don’t auto-open): show badge via popup or a notification if you like
            }
        } catch {}
    }
});

// ---------- Context click handling (PDF-aware) ----------

chrome.contextMenus.onClicked.addListener(async (info, tab) => {
    const tabId = (tab && typeof tab.id === "number") ? tab.id : -1;
    const url = tab?.url || info.pageUrl || "";
    const isViewer = isChromePdfViewerUrl(url);

    if (info.menuItemId === "pagegenie-summarize-selection") {
        if (isViewer) {
            const pdfUrl = extractPdfUrlFromViewer(url) || url;
            return openReaderPage("summarize_full", pdfUrl);
        }
        if (tabId >= 0) return sendMessageToTab(tabId, { type: "PAGEGENIE_CONTEXT_ACTION", operation: "summarize" });
        return;
    }

    if (info.menuItemId === "pagegenie-explain-selection") {
        if (isViewer) {
            const pdfUrl = extractPdfUrlFromViewer(url) || url;
            return openReaderPage("explain", pdfUrl);
        }
        if (tabId >= 0) return sendMessageToTab(tabId, { type: "PAGEGENIE_CONTEXT_ACTION", operation: "explain" });
        return;
    }

    if (info.menuItemId === "pagegenie-translate-selection") {
        if (isViewer) {
            const pdfUrl = extractPdfUrlFromViewer(url) || url;
            return openReaderPage("translate", pdfUrl);
        }
        if (tabId >= 0) return sendMessageToTab(tabId, { type: "PAGEGENIE_CONTEXT_ACTION", operation: "translate" });
        return;
    }

    if (info.menuItemId === "pagegenie-process-full") {
        if (isViewer) {
            const pdfUrl = extractPdfUrlFromViewer(url) || url;
            return openReaderPage("summarize_full", pdfUrl);
        }
        if (tabId >= 0) {
            return sendMessageToTab(tabId, { type: "PAGEGENIE_CONTEXT_ACTION", operation: "process_full" });
        }
        return;
    }

    if (info.menuItemId === "pagegenie-quiz-page") {
        if (tabId < 0) return;
        const requestId = "quiz_" + Date.now() + "_" + Math.random().toString(36).slice(2);

        await sendMessageToTab(tabId, {
            type: "PAGEGENIE_LOADING",
            action: "start",
            requestId,
            message: "Generating quiz from this page…"
        });

        try {
            const pageUrl = tab.url || info.pageUrl;
            if (!pageUrl || !/^https?:\/\//i.test(pageUrl)) {
                return toast(tabId, "Quiz Me works only on http/https pages.");
            }

            const { backendUrl, apiToken } = await chrome.storage.sync.get({
                backendUrl: "https://pagegenie-backend.onrender.com",
                apiToken: ""
            });

            if (!backendUrl) {
                return toast(tabId, "Backend URL not set. Open Options and set http://localhost:8098");
            }

            if (!apiToken) {
                return toast(tabId, "Please log in from the PageGenie popup first.");
            }

            await sendMessageToTab(tabId, {
                type: "PAGEGENIE_LOADING",
                action: "set",
                requestId,
                message: "Using cloud AI to generate quiz…"
            });

            const api = new URL("/api/v1/quiz/generate", backendUrl).toString();
            const res = await fetch(api, {
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
                return toast(tabId, "Unauthorized. Please log in again from the PageGenie popup.");
            }
            if (!res.ok) {
                const t = await res.text().catch(() => "");
                throw new Error(`Quiz generation failed ${res.status}: ${t || res.statusText}`);
            }

            const data = await res.json().catch(() => ({}));
            const quizId = data.id;
            if (!quizId) throw new Error("Backend did not return a quiz id.");

            await sendMessageToTab(tabId, {
                type: "PAGEGENIE_LOADING",
                action: "success",
                requestId,
                message: "Quiz ready"
            });

            const extUrl = chrome.runtime.getURL(`quiz/quiz.html?id=${encodeURIComponent(quizId)}&src=${encodeURIComponent(pageUrl)}`);
            await chrome.tabs.create({ url: extUrl });
        } catch (e) {
            await sendMessageToTab(tabId, {
                type: "PAGEGENIE_LOADING",
                action: "error",
                requestId,
                message: e?.message || String(e)
            });
        }
    }
});

// ---------- Messages from content script ----------

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (msg?.type === "PAGEGENIE_PERSIST") {
        (async () => {
            try {
                const { endpoint, payload } = msg;
                const { backendUrl, apiToken, tokenExp } = await chrome.storage.sync.get({
                    backendUrl: "https://pagegenie-backend.onrender.com",
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

    if (msg?.type === "PAGEGENIE_OPEN_QUIZ") {
        try {
            const quizId = msg.quizId;
            if (!quizId) throw new Error("quizId missing");
            const url = chrome.runtime.getURL(`quiz/quiz.html?id=${encodeURIComponent(quizId)}`);
            chrome.tabs.create({ url });
            sendResponse?.({ ok: true });
        } catch (e) {
            sendResponse?.({ ok: false, error: e?.message || String(e) });
        }
        return true;
    }

    if (msg?.type === "PAGEGENIE_AUTH_SIGNUP") {
        (async () => {
            try {
                const { username, password, fullName, path } = msg;
                if (!username || !password || !fullName) throw new Error("Full name, username and password are required.");
                const { backendUrl } = await chrome.storage.sync.get({ backendUrl: "https://pagegenie-backend.onrender.com" });
                if (!backendUrl) throw new Error("Backend URL not configured in Options.");
                const url = new URL(path || "/api/v1/auth/signup", backendUrl).toString();

                const res = await fetch(url, {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ username, password, fullName }),
                    credentials: "omit"
                });

                if (!res.ok && res.status !== 201) {
                    const body = await res.text().catch(() => "");
                    throw new Error(`Signup failed (${res.status}): ${body || res.statusText}`);
                }

                const authHeader = res.headers.get("Authorization") || res.headers.get("authorization");
                if (authHeader && authHeader.toLowerCase().startsWith("bearer ")) {
                    const token = authHeader.slice(7).trim();
                    const expMs = getJwtExpMs(token) ?? (Date.now() + 15 * 60 * 1000);
                    await chrome.storage.sync.set({ apiToken: token, tokenExp: expMs });
                }

                sendResponse({ ok: true });
            } catch (e) {
                sendResponse({ ok: false, error: e?.message || String(e) });
            }
        })();
        return true;
    }

    if (msg?.type === "PAGEGENIE_COMPARE_CONCEPT") {
        (async () => {
            try {
                const { selectionText, pageUrl } = msg;
                if (!selectionText) throw new Error("No selection text provided.");
                const { backendUrl, apiToken } = await chrome.storage.sync.get({
                    backendUrl: "https://pagegenie-backend.onrender.com",
                    apiToken: ""
                });
                if (!backendUrl) throw new Error("Backend URL not configured in Options.");
                if (!apiToken) throw new Error("Please log in from the PageGenie popup.");

                const url = new URL("/api/v1/ai/compare-concept", backendUrl).toString();
                const res = await fetch(url, {
                    method: "POST",
                    headers: {
                        "Content-Type": "application/json",
                        "Authorization": `Bearer ${apiToken}`
                    },
                    body: JSON.stringify({ selection_text: selectionText, page_url: pageUrl }),
                    credentials: "omit"
                });

                if (res.status === 401) {
                    await chrome.storage.sync.set({ apiToken: "", tokenExp: 0 });
                    throw new Error("Unauthorized. Please log in again.");
                }
                if (!res.ok) {
                    const t = await res.text().catch(() => "");
                    throw new Error(`Compare failed ${res.status}: ${t || res.statusText}`);
                }
                const data = await res.json().catch(() => ({}));
                console.log(data);
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
                const { backendUrl } = await chrome.storage.sync.get({ backendUrl: "https://pagegenie-backend.onrender.com" });
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

    if (msg?.type === "PAGEGENIE_FETCH_ARRAYBUFFER" && msg.url) {
        (async () => {
            try {
                const res = await fetch(msg.url, { credentials: "include", mode: "cors" });
                if (!res.ok) {
                    sendResponse({ ok: false, error: `HTTP ${res.status}` });
                    return;
                }
                const ab = await res.arrayBuffer();
                const base64 = arrayBufferToBase64(ab);
                sendResponse({ ok: true, base64 });
            } catch (e) {
                sendResponse({ ok: false, error: e?.message || String(e) });
            }
        })();
        return true;
    }
    if (msg?.type === "PAGEGENIE_OPEN_READER") {
        (async () => {
            try {
                const op = msg.op || "summarize_full";
                const base = `pages/reader.html?op=${encodeURIComponent(op)}`;
                const url = msg.src ? `${base}&src=${encodeURIComponent(msg.src)}` : base;
                await chrome.tabs.create({ url: chrome.runtime.getURL(url), active: true });
                sendResponse?.({ ok: true });
            } catch (e) {
                sendResponse?.({ ok: false, error: e?.message || String(e) });
            }
        })();
        return true; // async response
    }

    return false;
});

// Allow other parts (popup) to open onboarding on demand
chrome.runtime.onMessage.addListener((msg, _sender, _sendResponse) => {
    if (msg?.type === "PAGEGENIE_OPEN_ONBOARDING") {
        const url = chrome.runtime.getURL("pages/onboarding.html");
        chrome.tabs.create({ url }).catch(() => {});
    }
});

// Map commands -> ops understood by content script
const CMD_TO_OP = {
    "summarize-selection": "summarize",
    "explain-selection": "explain",
    "rewrite-selection": "rewrite",
    "translate-selection": "translate",

};

chrome.commands.onCommand.addListener(async (command) => {
    const op = CMD_TO_OP[command];
    if (!op) return;
    try {
        const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
        if (!tab?.id) return;
        await chrome.tabs.sendMessage(tab.id, {
            type: "PAGEGENIE_HOTKEY",
            operation: op
        });
    } catch {
        // No active tab or content script not injected on that page (e.g., chrome://)
    }
});

// ---------- Helpers ----------

function toast(tabId, message) {
    try {
        chrome.tabs.sendMessage(tabId, { type: "PAGEGENIE_TOAST", message }, () => {
            void chrome.runtime.lastError;
        });
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