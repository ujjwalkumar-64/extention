// - Selection toolbar (Summarize, Explain, Rewrite, Translate, Save)
// - Quick-Fix DOM Injection (Replace with Proofread, Translation Overlay, Insert Code Comments)
// - Offline (on-device) AI via pageBridge + Online fallback via Spring Boot (/api/v1/ai)
// - Save Note shows Categories bubble + Curated Reading side panel
// - Robust background messaging with "extension context invalidated" guard
// - Floating Action Button (FAB): always-visible button with vertical menu; toggle from popup (showFloatingButton)

(function init() {
    // Inject the page-bridge to access on-device AI APIs from page context (window.ai / Prompt API)
    injectPageBridge();

    // Simple throttle to avoid janky frequent UI updates (≈8–12 fps)
    function throttle(fn, ms = 120) {
        let last = 0, queued = null, timer = null;
        return (msg) => {
            const now = Date.now();
            const run = (v) => { last = Date.now(); queued = null; timer = null; try { fn(v); } catch {} };
            if (now - last >= ms) {
                run(msg);
            } else {
                queued = msg;
                if (!timer) {
                    timer = setTimeout(() => {
                        if (queued != null) run(queued);
                    }, ms - (now - last));
                }
            }
        };
    }

    // Prewarm local models just-in-time when user shows intent
    let __pg_prewarmed = false;
    function prewarmLikely() {
        if (__pg_prewarmed) return;
        __pg_prewarmed = true;
        try {
            const want = [
                { kind: "prompt" },
                { kind: "translator", opts: { targetLanguage: settings.targetLang || "en" } },
                { kind: "writer" }
            ];
            window.postMessage({ type: "PAGEGENIE_AI_PREWARM", id: "prewarm", want }, "*");
        } catch {}
    }

    // Trim large inputs for fast on-device operations (not for translate/proofread/code-comment)
    function trimForLocal(op, text, limit = 8000) {
        if (!text || typeof text !== "string") return text;
        if (op === "translate" || op === "proofread" || op === "comment_code") return text;
        if (text.length <= limit) return text;
        return text.slice(0, limit) + "\n\n[...trimmed for speed on device…]";
    }

    let onDeviceReady = null;
    async function ensureOnDeviceReady() {
        if (onDeviceReady !== null) return onDeviceReady;
        onDeviceReady = new Promise((resolve) => {
            // If content script cannot talk to page, assume false after timeout
            let done = false;
            const finish = (val) => { if (done) return; done = true; resolve(!!val); };
            const handler = (ev) => {
                if (ev.source !== window) return;
                const d = ev.data;
                if (!d || d.type !== "PAGEGENIE_AI_READY") return;
                window.removeEventListener("message", handler, true);
                finish(!!d.ready);
            };
            window.addEventListener("message", handler, true);
            try { window.postMessage({ type: "PAGEGENIE_AI_PING" }, "*"); } catch {}
            setTimeout(() => finish(false), 800); // quick probe timeout
        });
        return onDeviceReady;
    }

    let settings = {
        mode: "auto", // "auto" | "offline-only" | "online-only"
        showToolbarOnSelection: true,
        showFloatingButton: false,
        showFullPageConfirm: true,
        targetLang: "en"
    };

    chrome.storage.sync.get(
        { mode: "auto", showToolbarOnSelection: true, showFloatingButton: false, showFullPageConfirm: true, targetLang: "en" },
        s => {
            settings = { ...settings, ...s };

            // Safety: if storage returns a non-boolean (or missing), force default true
            if (typeof settings.showFullPageConfirm !== "boolean") {
                settings.showFullPageConfirm = true;
            }

            // If offline-only mode is enabled, try to prewarm as soon as possible
            if (settings.mode === "offline-only") {
                prewarmLikely();
            }
            if (settings.showFloatingButton) {
                ensureFloatingButton();
            }
        }
    );

    chrome.storage.onChanged.addListener((changes, area) => {
        if (area !== "sync") return;
        if (changes.mode) settings.mode = changes.mode.newValue;
        if (changes.showToolbarOnSelection) settings.showToolbarOnSelection = changes.showToolbarOnSelection.newValue;
        if (changes.showFloatingButton) {
            settings.showFloatingButton = !!changes.showFloatingButton.newValue;
            if (settings.showFloatingButton) ensureFloatingButton(); else removeFloatingButton();
        }
        if (changes.showFullPageConfirm) settings.showFullPageConfirm = !!changes.showFullPageConfirm.newValue; // NEW
        if (changes.targetLang) settings.targetLang = changes.targetLang.newValue;
    });

    // Selection toolbar
    const toolbar = createToolbar();
    let lastSelectionText = "";
    let lastRange = null;
    let lastAnchorPos = null;
    let lastAnchorPosViewport = null;
    const __pg_loaders = new Map();

    document.addEventListener("selectionchange", () => {
        if (!settings.showToolbarOnSelection) {
            toolbar.hide();
            return;
        }
        const selection = document.getSelection();
        if (!selection || selection.isCollapsed) { toolbar.hide(); return; }
        const text = selection.toString().trim();
        if (!text) { toolbar.hide(); return; }

        lastSelectionText = text;
        lastRange = selection.getRangeAt(0).cloneRange();

        // Absolute coords for toolbar
        const rectPage = getRangeRect(lastRange);
        toolbar.show(rectPage);
        lastAnchorPos = { top: rectPage.top, left: rectPage.left };

        // Viewport coords for bubbles
        const rectViewport = getViewportRect(lastRange);
        lastAnchorPosViewport = { top: rectViewport.top, left: rectViewport.left };

        // JIT prewarm once when user shows intent (unless online-only)
        if (settings.mode !== "online-only") prewarmLikely();
    });

    document.addEventListener("mouseup", () => {
        setTimeout(() => {
            const sel = document.getSelection();
            if (!sel || sel.isCollapsed) toolbar.hide();
        }, 50);
    });

    // Handle context menu relay and toasts from background + background-driven loaders
    chrome.runtime.onMessage.addListener((msg) => {
        if (msg?.type === "PAGEGENIE_CONTEXT_ACTION") {
            if (msg.operation === "process_full") runFullDocSummarize();
            else {
                if (!lastRange || !lastSelectionText) return;
                if (msg.operation === "summarize") runSimpleOp("summarize");
                if (msg.operation === "explain") runSimpleOp("explain");
                if (msg.operation === "translate") runTranslationOverlay();
                if (msg.operation === "quick_comment") insertCodeComments();
            }
        }
        if (msg?.type === "PAGEGENIE_TOAST" && msg.message) {
            showToast(msg.message);
        }
        if (msg?.type !== "PAGEGENIE_LOADING") return;

        const id = msg.requestId || "default";
        if (msg.action === "start") {
            try { __pg_loaders.get(id)?.close?.(); } catch {}
            const loader = createLoadingToast(msg.message || "Working…");
            __pg_loaders.set(id, loader);
            return;
        }

        const loader = __pg_loaders.get(id);
        if (!loader) return;

        if (msg.action === "set") {
            loader.set(msg.message || "Working…");
        } else if (msg.action === "success") {
            loader.success(msg.message || "Done");
            __pg_loaders.delete(id);
        } else if (msg.action === "error") {
            loader.error(msg.message || "Error");
            __pg_loaders.delete(id);
        } else if (msg.action === "close") {
            loader.close();
            __pg_loaders.delete(id);
        }
    });

    // Toolbar actions
    toolbar.on("summarize", () => runSimpleOp("summarize"));
    toolbar.on("explain", () => runSimpleOp("explain"));
    toolbar.on("rewrite", () => runSimpleOp("rewrite"));
    toolbar.on("translate", () => runTranslationOverlay());
    toolbar.on("save", () => saveNote());
    toolbar.on("compare_concept", () => compareConceptDrift());
    toolbar.on("quiz_selection", () => quizSelectedText());
    // Quick-Fix DOM Injection actions
    toolbar.on("quick_proof", () => replaceWithProofread());
    toolbar.on("quick_overlay", () => runTranslationOverlay());
    toolbar.on("quick_comment", () => insertCodeComments());

    // Unified active text resolver (no in-page PDF parsing anymore)
    async function getActiveText({ fullDoc = false } = {}) {
        // 1) Prefer DOM selection
        const sel = document.getSelection();
        const selected = sel && !sel.isCollapsed ? String(sel.toString() || "").trim() : "";
        if (selected) {
            return { text: selected, strategy: "selection" };
        }

        // 2) Full document requested: return HTML text only (PDF handled by Reader)
        if (fullDoc) {
            return { text: getWholePageText(), strategy: "full_html" };
        }

        // 3) Default: whole page text
        return { text: getWholePageText(), strategy: "full_html" };
    }

    // CLOUD LIMIT (applies only when sending to backend)
    const CLOUD_CHAR_LIMIT = 20000; // adjust as desired

    function applyCloudLimit(text) {
        if (!text || text.length <= CLOUD_CHAR_LIMIT) return text;
        const suffix = `\n\n[truncated to ${CLOUD_CHAR_LIMIT.toLocaleString()} of ${text.length.toLocaleString()} chars for cloud processing]`;
        return text.slice(0, CLOUD_CHAR_LIMIT) + suffix;
    }


    function getWholePageText() {
        const body = document.body;
        if (!body) return "";
        const walker = document.createTreeWalker(body, NodeFilter.SHOW_TEXT, {
            acceptNode: (n) => {
                if (!n.nodeValue) return NodeFilter.FILTER_REJECT;
                const parent = n.parentElement;
                if (!parent) return NodeFilter.FILTER_ACCEPT;
                const tag = parent.tagName;
                if (tag === "SCRIPT" || tag === "STYLE" || tag === "NOSCRIPT") return NodeFilter.FILTER_REJECT;
                const cs = getComputedStyle(parent);
                if (cs.display === "none" || cs.visibility === "hidden") return NodeFilter.FILTER_REJECT;
                return NodeFilter.FILTER_ACCEPT;
            }
        });
        let text = "", node;
        while ((node = walker.nextNode())) {
            const t = String(node.nodeValue || "").replace(/\s+/g, " ").trim();
            if (t) text += (text ? "\n" : "") + t;
        }
        return text;
    }


    // Helper: heuristic to decide “this tab looks like a PDF page”
    function looksLikePdfPage() {
        try { if (document.contentType === "application/pdf") return true; } catch {}
        const href = location?.href || "";
        if (/\.pdf($|\?)/i.test(href)) return true;
        if (document.querySelector('embed[type="application/pdf"], object[type="application/pdf"]')) return true;
        const params = new URLSearchParams(location.search || "");
        const fileParam = params.get("file") || params.get("src") || params.get("url");
        if (fileParam && /\.pdf($|\?)/i.test(decodeURIComponent(fileParam))) return true;
        return false;
    }

//   runFullDocSummarize — ask for consent if there’s no selection; do not pre-trim for device
    async function runFullDocSummarize() {
        const loader = createLoadingToast("Processing full document");
        const throttledSet = throttle(loader.set.bind(loader), 120);

        try {
            if (looksLikePdfPage()) {
                throttledSet("Opening Reader for PDF…");
                chrome.runtime.sendMessage({ type: "PAGEGENIE_OPEN_READER", op: "summarize_full", src: location.href }, () => {});
                loader.success("Reader opened");
                return;
            }

            const active = await getActiveText({ fullDoc: true });
            if (!active.text) throw new Error("No text found in document");

            // Confirm full page
            const ok = await ensureFullPageConsent("summarize", active.text, "whole page");
            if (!ok) { loader.set("Cancelled"); setTimeout(() => loader.close(), 600); return; }

            // No device pre-trim; enforce cloud limit only if we end up using cloud
            const resultText = await runAIWithCloudLimit("summarize", active.text, throttledSet);
            loader.success("Summary ready");
            showResultPanel(resultText);
            persist("/api/ops/log", {
                type: "summarize_full_doc", source: location.href, input_len: active.text.length, output: resultText, strategy: active.strategy, ts: Date.now()
            });
        } catch (e) {
            loader.error("AI error: " + (e?.message || e));
        }
    }


    //  runSimpleOp — if it falls back to full page (no selection), ask consent; no device pre-trim; cloud-only limit
    async function runSimpleOp(op) {
        const loader = createLoadingToast("Preparing " + opTitle(op));
        const throttledSet = throttle(loader.set.bind(loader), 120);
        try {
            const active = await getActiveText({ fullDoc: false });
            if (!active.text) throw new Error("No text found to process");

            if (active.strategy === "full_html") {
                const ok = await ensureFullPageConsent(op, active.text, "whole page");
                if (!ok) { loader.set("Cancelled"); setTimeout(() => loader.close(), 600); return; }
            }

            const resultText = await runAIWithCloudLimit(op, active.text, (stage) => throttledSet(`${opTitle(op)} • ${stage}`));
            loader.success(opTitle(op) + " ready");
            showResultPanel(resultText);
            persist("/api/ops/log", {
                type: op, source: location.href, input: active.text.slice(0, 2000), output: resultText, strategy: active.strategy, ts: Date.now()
            });
        } catch (e) {
            loader.error("AI error: " + (e?.message || e));
        }
    }


    // Quick-Fix: Replace selection with proofread text
    async function replaceWithProofread() {
        // Only possible when we have a DOM selection we can replace (not on PDF plugin)
        const sel = document.getSelection();
        if (!sel || sel.isCollapsed || !lastRange || !lastSelectionText) {
            showToast("Select text to proofread");
            return;
        }
        const loader = createLoadingToast("Proofreading...");
        const throttledSet = throttle(loader.set.bind(loader), 120);
        try {
            const raw = await runAI("proofread", lastSelectionText, settings.targetLang, (stage) => {
                throttledSet(`Proofreading • ${stage}`);
            });
            const result = stripMarkdownCodeFences(toPlainText(raw)); // ensure string, then strip fences if any
            replaceRangeWithText(lastRange, result);
            loader.success("Replaced with proofread text");
            persist("/api/ops/log", {
                type: "quick_proofread_replace",
                source: location.href,
                input: lastSelectionText,
                output: result,
                ts: Date.now()
            });
        } catch (e) {
            loader.error("AI error: " + (e?.message || e));
        }
    }

    // Quick-Fix: Translation overlay bubble
    async function runTranslationOverlay() {
        const loader = createLoadingToast("Translating...");
        const throttledSet = throttle(loader.set.bind(loader), 120);
        try {
            const active = await getActiveText({ fullDoc: false });
            if (!active.text) throw new Error("No text found to translate");

            // NEW: confirm when we're about to translate the entire page
            if (active.strategy === "full_html") {
                const ok = await ensureFullPageConsent("translate", active.text, "whole page");
                if (!ok) { loader.set("Cancelled"); setTimeout(() => loader.close(), 600); return; }
            }

            const raw = await runAIWithCloudLimit("translate", active.text, (stage) => {
                throttledSet(`Translating • ${stage}`);
            });
            const result = toPlainText(raw);
            loader.success("Translation ready");

            // If we had a selection range on HTML, show bubble; otherwise show panel
            if (active.strategy === "selection" && lastRange) {
                showTranslationBubble(lastRange, result);
            } else {
                showResultPanel(result);
            }

            persist("/api/ops/log", {
                type: "translation_overlay",
                source: location.href,
                input_len: active.text.length,
                output: result,
                targetLang: settings.targetLang,
                strategy: active.strategy,
                ts: Date.now()
            });
        } catch (e) {
            loader.error("AI error: " + (e?.message || e));
        }
    }
    // Quick-Fix: Insert code comments in nearest code block
    async function insertCodeComments() {
        const codeEl = findNearestCodeBlock(getSelectionAnchorNode());
        if (!codeEl) { showToast("No code block detected"); return; }
        const codeText = getCodeText(codeEl);
        if (!codeText?.trim()) { showToast("Empty code block"); return; }

        const loader = createLoadingToast("Adding explainer comments...");
        const throttledSet = throttle(loader.set.bind(loader), 120);
        try {
            const raw = await runAI("comment_code", codeText, settings.targetLang, (stage) => {
                throttledSet(`Adding comments • ${stage}`);
            });
            const result = stripMarkdownCodeFences(toPlainText(raw));
            setCodeText(codeEl, result);
            loader.success("Comments inserted");
            persist("/api/ops/log", {
                type: "code_comment_injection",
                source: location.href,
                input: codeText,
                output: result,
                ts: Date.now()
            });
        } catch (e) {
            loader.error("AI error: " + (e?.message || e));
        }
    }

    // Save note: persist to backend, show categories bubble, then curated reading panel
    async function saveNote() {
        const active = await getActiveText({ fullDoc: false });
        if (!active.text) return showToast("No text to save");
        const loader = createLoadingToast("Saving note...");
        try {
            const payload = { source: location.href, content: active.text, ts: Date.now() };
            const res = await persist("/api/notes", payload);
            if (!res?.ok) throw new Error(res?.error || "Save failed");

            const categories = safeParseJson(res.data?.categoriesJson);
            showCategoriesBubbleWithFallback(categories);
            loader.set("Fetching curated suggestions…");

            try {
                const suggestResp = await persist("/api/v1/reading/suggest", {
                    baseUrl: location.href,
                    baseSummary: categories?.summary || active.text.slice(0, 400)
                });
                if (suggestResp?.ok) {
                    const suggestions = normalizeSuggestionsShape(suggestResp.data);
                    if (suggestions.length) showSuggestionsPanel(suggestions);
                }
            } catch {}

            loader.success("Note saved");
        } catch (e) {
            loader.error(e?.message || String(e));
        }
    }

    // Analyze Concept Drift
    async function compareConceptDrift() {
        const active = await getActiveText({ fullDoc: false });
        if (!active.text) { showToast("Select some text"); return; }
        const loader = createLoadingToast("Analyzing against your notes…");
        try {
            const resp = await sendCompareConcept(active.text, location.href);
            if (!resp?.ok) throw new Error(resp?.error || "Compare failed");
            const data = resp.data || {};
            loader.success("Analysis ready");
            showComparePanel({
                keyClaim: data.key_claim || data.keyClaim || "",
                agreement: data.agreement || "",
                drift: data.drift_analysis || data.drift || ""
            });
            persist("/api/ops/log", {
                type: "analyze_concept_drift",
                source: location.href,
                input_len: active.text.length,
                output: JSON.stringify(data),
                strategy: active.strategy,
                ts: Date.now()
            });
        } catch (e) {
            loader.error(e?.message || e);
        }
    }

    function sendCompareConcept(selectionText, pageUrl) {
        return new Promise((resolve) => {
            if (!chrome?.runtime?.id) {
                return resolve({ ok: false, error: "Extension context invalidated. Refresh page and try again." });
            }
            chrome.runtime.sendMessage(
                { type: "PAGEGENIE_COMPARE_CONCEPT", selectionText, pageUrl },
                (resp) => {
                    if (chrome.runtime.lastError) {
                        return resolve({ ok: false, error: chrome.runtime.lastError.message || "Message failed" });
                    }
                    resolve(resp);
                }
            );
        });
    }

    // Quiz from selection
    async function quizSelectedText() {
        const active = await getActiveText({ fullDoc: false });
        if (!active.text) {
            showToast("Select some text to quiz");
            return;
        }
        const loader = createLoadingToast("Generating quiz from selection…");
        try {
            loader.set("Using cloud AI to generate quiz");
            const resp = await persist("/api/v1/quiz/generate-from-text", {
                text: active.text,
                sourceUrl: location.href,
                title: document.title?.slice(0, 120) || "Selection"
            });
            if (!resp?.ok) throw new Error(resp?.error || "Quiz generation failed");
            const data = resp.data || {};
            const quizId = data.id ?? data.quizId ?? data?.data?.id ?? data?.data?.quizId;
            if (!quizId) throw new Error("Quiz ID missing in response");

            loader.success("Quiz ready");
            chrome.runtime.sendMessage({ type: "PAGEGENIE_OPEN_QUIZ", quizId }, () => {
                if (chrome.runtime.lastError) {
                    try {
                        window.open(chrome.runtime.getURL(`quiz/quiz.html?id=${encodeURIComponent(quizId)}`), "_blank");
                    } catch {}
                }
            });

            persist("/api/ops/log", {
                type: "quiz_from_selection",
                source: location.href,
                input_len: active.text.length,
                output: String(quizId),
                strategy: active.strategy,
                ts: Date.now()
            });
        } catch (e) {
            loader.error(e?.message || String(e));
        }
    }

    //   Route that avoids device trimming and enforces cloud-only limit automatically
    async function runAIWithCloudLimit(op, text, progressCb) {
        const onProgress = (m) => { try { progressCb?.(m); } catch {} };

        // Try on-device first (no limit)
        const userWantsOffline = (settings.mode !== "online-only");
        const userAllowsOnline = (settings.mode !== "offline-only");
        const deviceAvailable = userWantsOffline ? await ensureOnDeviceReady() : false;

        if (userWantsOffline && deviceAvailable) {
            try {
                onProgress("Using on-device AI");
                const res = await aiOnDevice(op, text, settings.targetLang, onProgress);
                const plain = toPlainText(res);
                if (plain) return plain;
            } catch {
                // fall through to cloud
            }
        }

        if (!userAllowsOnline) {
            throw new Error("On-device AI unavailable.");
        }

        onProgress(deviceAvailable ? "Falling back to cloud AI" : "Using cloud AI");
        const trimmedForCloud = applyCloudLimit(text); // enforce cloud-only cap
        const cloudRes = await aiOnline(op, trimmedForCloud, settings.targetLang);
        return toPlainText(cloudRes);
    }

    // AI routing: offline → online (or per settings), with per-op availability
    async function runAI(op, text, targetLang, progressCb) {
        const onProgress = (typeof progressCb === "function") ? progressCb : () => {};
        const userWantsOffline = (settings.mode !== "online-only");
        const userAllowsOnline = (settings.mode !== "offline-only");

        // Detect if on-device APIs are present (any)
        const deviceAvailable = userWantsOffline ? await ensureOnDeviceReady() : false;

        if (userWantsOffline && deviceAvailable) {
            try {
                onProgress("Using on-device AI");
                const res = await aiOnDevice(op, text, targetLang, onProgress);
                if (res) return res;
            } catch {
                // fall through to cloud
            }
        }

        if (!userAllowsOnline) {
            // Strict offline-only and device unavailable → throw
            throw new Error("On-device AI unavailable.");
        }

        onProgress(deviceAvailable ? "Falling back to cloud AI" : "Using cloud AI");
        const online = await aiOnline(op, text, targetLang);
        if (!online) throw new Error("Backend AI unavailable.");
        return online;
    }

    // Safe pageBridge injector (content world; pageBridge must NOT call chrome.*)
    function injectPageBridge() {
        try {
            if (!chrome?.runtime?.getURL) return;
            const src = chrome.runtime.getURL("content/pageBridge.js");
            if (document.getElementById("pagegenie-bridge-script")) return;
            if (document.documentElement.querySelector(`script[src="${src}"]`)) return;
            const script = document.createElement("script");
            script.id = "pagegenie-bridge-script";
            script.src = src;
            script.type = "text/javascript";
            (document.head || document.documentElement).appendChild(script);
        } catch {}
    }

    // aiOnDevice with standard cleanup + progress forward
    function aiOnDevice(operation, text, targetLang, progressCb) {
        const onProgress = (typeof progressCb === "function") ? progressCb : () => {};
        return new Promise((resolve, reject) => {
            const id = "pg_" + Math.random().toString(36).slice(2);
            let finished = false;
            const cleanup = () => {
                window.removeEventListener("message", resHandler, true);
                window.removeEventListener("message", progHandler, true);
                clearTimeout(timer);
            };
            const resHandler = (ev) => {
                if (ev.source !== window) return;
                const data = ev.data;
                if (!data || data.type !== "PAGEGENIE_AI_RESPONSE" || data.id !== id) return;
                if (finished) return;
                finished = true;
                cleanup();
                if (data.ok) resolve(data.result);
                else reject(new Error(data.error || "On-device AI error"));
            };
            const progHandler = (ev) => {
                if (ev.source !== window) return;
                const data = ev.data;
                if (!data || data.type !== "PAGEGENIE_AI_PROGRESS" || data.id !== id) return;
                try { onProgress(`On-device • ${data.message}`); } catch {}
            };
            window.addEventListener("message", resHandler, true);
            window.addEventListener("message", progHandler, true);
            try {
                window.postMessage({ type: "PAGEGENIE_AI_REQUEST", id, operation, text, targetLang }, "*");
            } catch (e) {
                finished = true;
                cleanup();
                reject(new Error("Failed to talk to page bridge"));
                return;
            }
            // Faster fallback in Auto mode, longer in Offline-only
            const timeoutMs = (settings?.mode === "auto") ? 12000 : 20000;
            const timer = setTimeout(() => {
                if (finished) return;
                finished = true;
                cleanup();
                reject(new Error("On-device AI timeout"));
            }, timeoutMs);
        });
    }

    // Online AI via Spring Boot backend (/api/v1/ai)
    async function aiOnline(operation, text, targetLang) {
        const action = opToAction(operation);
        if (!action) {
            throw new Error("Operation not supported by backend: " + operation);
        }

        const payload = { text, action, targetLang };
        const resp = await persist("/api/v1/ai", payload);
        if (!resp?.ok) throw new Error(resp?.error || "Backend AI request failed");

        const result = extractAIResult(resp.data);
        if (!result) throw new Error("Invalid backend AI response");
        return result;
    }

    function opToAction(op) {
        switch (op) {
            case "summarize":
            case "rewrite":
            case "explain":
            case "translate":
            case "proofread":
            case "comment_code":
                return op;
            default:
                return null;
        }
    }

    function extractAIResult(data) {
        if (!data) return "";
        if (typeof data === "string") return data;
        if (typeof data.result === "string") return data.result;
        if (typeof data.output === "string") return data.output;
        if (data.data && typeof data.data.result === "string") return data.data.result;
        if (data.data && typeof data.data.output === "string") return data.data.output;
        return "";
    }

    function stripMarkdownCodeFences(s) {
        if (!s) return s;
        const fenceRegex = /^```[\w+-]*\s*\n([\s\S]*?)\n```$/m;
        const m = s.match(fenceRegex);
        if (m && m[1]) return m[1];
        if (s.startsWith("```") && s.endsWith("```")) {
            return s.replace(/^```[\w+-]*\s*\n?/, "").replace(/```$/, "");
        }
        return s;
    }

    function toPlainText(out) {
        if (out == null) return "";
        if (typeof out === "string") return out;

        // Common shapes from task APIs or LLMs
        if (typeof out === "object") {
            if (typeof out.text === "string") return out.text;
            if (typeof out.corrected === "string") return out.corrected;
            if (typeof out.correctedText === "string") return out.correctedText;
            if (typeof out.result === "string") return out.result;
            if (typeof out.output === "string") return out.output;
            if (Array.isArray(out.choices) && typeof out.choices[0]?.text === "string") {
                return out.choices[0].text;
            }
            if (Array.isArray(out.candidates)) {
                // Gemini-like { candidates: [{content:{parts:[{text:"..."}]}}] }
                const parts = out.candidates[0]?.content?.parts;
                if (Array.isArray(parts)) {
                    const s = parts.map(p => typeof p?.text === "string" ? p.text : "").join("\n").trim();
                    if (s) return s;
                }
            }
            // Fallback: stringify
            try { return JSON.stringify(out); } catch { return String(out); }
        }

        return String(out);
    }

    // Robust persist with invalidated-context and lastError handling
    function persist(endpoint, payload) {
        return new Promise(resolve => {
            try {
                if (!chrome?.runtime?.id) {
                    return resolve({ ok: false, error: "Extension context invalidated. Refresh page and try again." });
                }
                chrome.runtime.sendMessage(
                    { type: "PAGEGENIE_PERSIST", endpoint, payload },
                    (resp) => {
                        if (chrome.runtime.lastError) {
                            return resolve({ ok: false, error: chrome.runtime.lastError.message || "Message failed" });
                        }
                        if (typeof resp === "undefined") {
                            return resolve({ ok: false, error: "No response from background. Extension may have reloaded. Refresh page." });
                        }
                        resolve(resp);
                    }
                );
            } catch (e) {
                resolve({ ok: false, error: e?.message || String(e) });
            }
        });
    }

    // DOM helpers

    function replaceRangeWithText(range, replacement) {
        const textNode = document.createTextNode(replacement);
        range.deleteContents();
        range.insertNode(textNode);
        const sel = document.getSelection();
        sel.removeAllRanges();
        const newRange = document.createRange();
        newRange.setStart(textNode, 0);
        newRange.setEnd(textNode, textNode.nodeValue.length);
        sel.addRange(newRange);
        lastRange = newRange;
    }

    // Translation bubble (fixed + viewport coords)
    function showTranslationBubble(range, text) {
        const vp = getViewportRect(range);
        const bubble = document.createElement("div");
        bubble.className = "pagegenie-translation-bubble";
        bubble.textContent = text;
        Object.assign(bubble.style, {
            position: "fixed",
            top: Math.max(8, vp.top - 8) + "px",
            left: Math.max(8, vp.left) + "px",
            maxWidth: "40vw",
            zIndex: "2147483647",
            background: "rgba(20,20,20,0.96)",
            color: "#fff",
            borderRadius: "8px",
            padding: "8px 10px",
            boxShadow: "0 8px 24px rgba(0,0,0,0.35)"
        });
        document.documentElement.appendChild(bubble);
        requestAnimationFrame(() => clampToViewport(bubble));
        const close = () => bubble.remove();
        bubble.addEventListener("click", close);
        setTimeout(() => {
            document.addEventListener("click", close, { once: true, capture: true });
        }, 0);
    }

    // Returns PAGE coordinates (with scroll) — used by toolbar.show (position: absolute)
    function getRangeRect(range) {
        const rects = range.getClientRects();
        const rect = rects[0] || range.getBoundingClientRect();
        return {
            top: (rect?.top || 0) + window.scrollY,
            left: (rect?.left || 0) + window.scrollX
        };
    }

    // Viewport rect for fixed-position overlays (no scroll offsets)
    function getViewportRect(range) {
        const rects = range.getClientRects();
        const rect = rects[0] || range.getBoundingClientRect();
        return {
            top: rect?.top || 0,
            left: rect?.left || 0
        };
    }

    // Keep bubbles on-screen
    function clampToViewport(el) {
        try {
            const vw = window.innerWidth, vh = window.innerHeight;
            const bw = el.offsetWidth, bh = el.offsetHeight;
            const currentLeft = parseFloat(el.style.left || "0");
            const currentTop = parseFloat(el.style.top || "0");
            const left = Math.min(Math.max(8, currentLeft), Math.max(8, vw - bw - 8));
            const top = Math.min(Math.max(8, currentTop), Math.max(8, vh - bh - 8));
            el.style.left = left + "px";
            el.style.top = top + "px";
        } catch {}
    }

    function findNearestCodeBlock(node) {
        let el = node?.nodeType === Node.ELEMENT_NODE ? node : node?.parentElement;
        while (el && el !== document.body) {
            if (el.matches("pre code, code, pre")) return el.matches("pre code") ? el : (el.querySelector("code") || el);
            el = el.parentElement;
        }
        return null;
    }

    function getCodeText(codeEl) {
        return codeEl.innerText ?? codeEl.textContent ?? "";
    }

    function setCodeText(codeEl, text) {
        codeEl.textContent = text;
    }

    function getSelectionAnchorNode() {
        const sel = document.getSelection();
        if (!sel || sel.rangeCount === 0) return null;
        return sel.getRangeAt(0).startContainer;
    }

    function opTitle(op) {
        return ({
            summarize: "Summary",
            explain: "Explanation",
            rewrite: "Rewrite",
            translate: "Translation",
            proofread: "Proofread"
        })[op] || op;
    }

    function showToast(message) {
        const el = document.createElement("div");
        el.className = "pagegenie-toast";
        el.textContent = message;
        Object.assign(el.style, {
            position: "fixed",
            left: "20px",
            bottom: "20px",
            background: "rgba(30,30,30,0.95)",
            color: "#fff",
            padding: "10px 14px",
            borderRadius: "8px",
            opacity: "0",
            transform: "translateY(10px)",
            transition: "all .25s ease",
            zIndex: "2147483647",
            pointerEvents: "none",
            fontFamily: "system-ui, -apple-system, Segoe UI, Roboto, sans-serif"
        });
        document.documentElement.appendChild(el);
        setTimeout(() => el.style.opacity = "1", 10);
        setTimeout(() => {
            el.style.opacity = "0";
            el.style.transform = "translateY(10px)";
            setTimeout(() => el.remove(), 300);
        }, 2000);
    }

    function showResultPanel(text) {
        const panel = document.createElement("div");
        panel.className = "pagegenie-result-panel";
        Object.assign(panel.style, {
            position: "fixed",
            right: "20px",
            bottom: "20px",
            width: "min(520px, 50vw)",
            maxHeight: "50vh",
            overflow: "auto",
            background: "#121212",
            color: "#eee",
            border: "1px solid rgba(255,255,255,0.12)",
            borderRadius: "8px",
            padding: "12px",
            zIndex: "2147483647"
        });
        const pre = document.createElement("pre");
        Object.assign(pre.style, {
            whiteSpace: "pre-wrap",
            fontFamily: "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace",
            fontSize: "12px",
            margin: "0 0 8px 0"
        });
        pre.textContent = text;
        const copyBtn = document.createElement("button");
        copyBtn.textContent = "Copy";
        copyBtn.addEventListener("click", async () => {
            try {
                await navigator.clipboard.writeText(text);
                copyBtn.textContent = "Copied!";
                setTimeout(() => (copyBtn.textContent = "Copy"), 1000);
            } catch {}
        });
        const close = document.createElement("button");
        close.textContent = "Close";
        close.addEventListener("click", () => panel.remove());
        panel.append(pre, copyBtn, close);
        document.documentElement.appendChild(panel);
    }

    // Categories + Suggestions UI

    function safeParseJson(s) {
        if (!s) return null;
        if (typeof s === "object") return s;
        if (typeof s !== "string") return null;
        try { return JSON.parse(s); } catch {}
        const trimmed = s.trim();
        const looksQuoted = (trimmed.startsWith('"') && trimmed.endsWith('"')) || (trimmed.startsWith("'") && trimmed.endsWith("'"));
        if (looksQuoted) {
            try {
                const unquoted = JSON.parse(trimmed);
                if (typeof unquoted === "string") {
                    try { return JSON.parse(unquoted); } catch {}
                } else if (typeof unquoted === "object") {
                    return unquoted;
                }
            } catch {}
        }
        return null;
    }

    function normalizeSuggestionsShape(raw) {
        if (!raw) return [];
        if (Array.isArray(raw)) return raw;
        if (Array.isArray(raw.data)) return raw.data;
        if (Array.isArray(raw.items)) return raw.items;
        if (Array.isArray(raw.suggestions)) return raw.suggestions;
        if (typeof raw === "object" && (raw.suggestedUrl || raw.url)) return [raw];
        return [];
    }

    function showCategoriesBubbleWithFallback(categories) {
        if (!categories) { showMinimalBubble("Note saved"); return; }

        const range = (() => {
            const sel = document.getSelection();
            if (sel && sel.rangeCount) return sel.getRangeAt(0).cloneRange();
            return lastRange || null;
        })();

        const vp = range
            ? getViewportRect(range)
            : (lastAnchorPosViewport
                ? { top: lastAnchorPosViewport.top - 10, left: lastAnchorPosViewport.left }
                : { top: 20, left: 20 });

        const bubble = document.createElement("div");
        bubble.className = "pagegenie-categories-bubble";
        const topic = categories?.topic || "Note saved";
        const tags = Array.isArray(categories?.tags) ? categories.tags : [];
        const related = Array.isArray(categories?.relatedTo) ? categories.relatedTo : [];
        const summary = categories?.summary || "";

        bubble.innerHTML = `
    <div class="pgc-title">📘 ${escapeHtml(topic)}</div>
    ${ tags.length ? `<div class="pgc-row"><span class="pgc-label">Tags:</span> ${tags.map(t => `<span class="pgc-chip">${escapeHtml(t)}</span>`).join(" ")}</div>` : "" }
    ${ related.length ? `<div class="pgc-row"><span class="pgc-label">Related:</span> ${related.map(t => `<span class="pgc-chip subtle">${escapeHtml(t)}</span>`).join(" ")}</div>` : "" }
    ${ summary ? `<div class="pgc-summary">${escapeHtml(summary)}</div>` : "" }
    <div class="pgc-actions"><button class="pgc-close">Close</button></div>
  `;

        Object.assign(bubble.style, {
            position: "fixed",
            top: Math.max(8, vp.top) + "px",
            left: Math.max(8, vp.left) + "px",
            zIndex: "2147483647",
            background: "rgba(20,20,20,0.96)",
            color: "#fff",
            border: "1px solid rgba(255,255,255,0.12)",
            borderRadius: "10px",
            padding: "10px 12px",
            maxWidth: "min(420px, 60vw)",
            boxShadow: "0 8px 24px rgba(0,0,0,0.35)"
        });

        document.documentElement.appendChild(bubble);
        requestAnimationFrame(() => clampToViewport(bubble));

        bubble.querySelector(".pgc-close")?.addEventListener("click", () => bubble.remove());
        setTimeout(() => {
            const hide = (e) => {
                if (!bubble.contains(e.target)) {
                    bubble.remove();
                    document.removeEventListener("click", hide, true);
                }
            };
            document.addEventListener("click", hide, true);
        }, 0);
    }

    function showMinimalBubble(text) {
        const pos = lastAnchorPosViewport
            ? { top: Math.max(8, lastAnchorPosViewport.top - 10), left: Math.max(8, lastAnchorPosViewport.left) }
            : { top: window.innerHeight ? 20 : (window.scrollY + 20), left: window.innerWidth ? 20 : (window.scrollX + 20) };

        const bubble = document.createElement("div");
        bubble.className = "pagegenie-categories-bubble";
        bubble.textContent = text || "Note saved";
        Object.assign(bubble.style, {
            position: "fixed",
            top: pos.top + "px",
            left: pos.left + "px",
            zIndex: "2147483647",
            background: "rgba(20,20,20,0.96)",
            color: "#fff",
            border: "1px solid rgba(255,255,255,0.12)",
            borderRadius: "10px",
            padding: "10px 12px",
            boxShadow: "0 8px 24px rgba(0,0,0,0.35)"
        });
        document.documentElement.appendChild(bubble);
        requestAnimationFrame(() => clampToViewport(bubble));
        setTimeout(() => bubble.remove(), 2500);
    }

    function showSuggestionsPanel(suggestions) {
        if (!Array.isArray(suggestions) || !suggestions.length) return;

        const panel = document.createElement("div");
        panel.className = "pagegenie-suggestions-panel";

        Object.assign(panel.style, {
            position: "fixed",
            right: "20px",
            bottom: "20px",
            width: "min(420px, 50vw)",
            maxHeight: "60vh",
            overflow: "auto",
            background: "#111",
            color: "#eee",
            border: "1px solid rgba(255,255,255,0.12)",
            borderRadius: "10px",
            padding: "12px",
            zIndex: "2147483647",
            boxShadow: "0 8px 24px rgba(0,0,0,0.35)"
        });

        const header = document.createElement("div");
        header.textContent = "🧭 Curated Reading";
        header.style.fontWeight = "700";
        header.style.marginBottom = "8px";
        panel.appendChild(header);

        suggestions.slice(0, 3).forEach(s => {
            const href = s.suggestedUrl || s.url || "#";
            const title = s.title || href;
            const reason = s.reason || "";
            const item = document.createElement("div");
            item.style.padding = "8px 0";
            item.style.borderBottom = "1px solid rgba(255,255,255,0.08)";

            const a = document.createElement("a");
            a.href = href;
            a.target = "_blank";
            a.rel = "noopener noreferrer";
            a.textContent = title;
            a.style.color = "#9fd3ff";
            a.style.textDecoration = "none";
            a.addEventListener("mouseover", () => a.style.textDecoration = "underline");
            a.addEventListener("mouseout", () => a.style.textDecoration = "none");

            item.appendChild(a);

            if (reason) {
                const r = document.createElement("div");
                r.textContent = reason;
                r.style.color = "#bbb";
                r.style.fontSize = "12px";
                r.style.marginTop = "4px";
                item.appendChild(r);
            }

            panel.appendChild(item);
        });

        const actions = document.createElement("div");
        actions.style.textAlign = "right";
        actions.style.marginTop = "8px";
        const close = document.createElement("button");
        close.textContent = "Close";
        Object.assign(close.style, {
            background: "#222",
            color: "#fff",
            border: "1px solid rgba(255,255,255,0.18)",
            padding: "4px 8px",
            borderRadius: "6px",
            cursor: "pointer",
            fontSize: "12px"
        });
        close.addEventListener("click", () => panel.remove());
        actions.appendChild(close);
        panel.appendChild(actions);

        document.documentElement.appendChild(panel);
    }

    // Render a structured panel with headings
    function showComparePanel({ keyClaim, agreement, drift }) {
        const panel = document.createElement("div");
        panel.className = "pagegenie-result-panel";
        Object.assign(panel.style, {
            position: "fixed",
            right: "20px",
            bottom: "20px",
            width: "min(520px, 50vw)",
            maxHeight: "60vh",
            overflow: "auto",
            background: "#121212",
            color: "#eee",
            border: "1px solid rgba(255,255,255,0.12)",
            borderRadius: "8px",
            padding: "12px",
            zIndex: "2147483647"
        });

        const section = (title, text) => {
            const wrap = document.createElement("div");
            const h = document.createElement("div");
            const p = document.createElement("div");
            h.textContent = title;
            h.style.fontWeight = "700";
            h.style.margin = "6px 0 4px";
            p.textContent = text || "—";
            p.style.whiteSpace = "pre-wrap";
            wrap.appendChild(h);
            wrap.appendChild(p);
            return wrap;
        };

        const close = document.createElement("button");
        close.textContent = "Close";
        Object.assign(close.style, {
            marginTop: "8px",
            background: "#222",
            color: "#fff",
            border: "1px solid rgba(255,255,255,0.18)",
            padding: "4px 8px",
            borderRadius: "6px",
            cursor: "pointer",
            fontSize: "12px"
        });
        close.addEventListener("click", () => panel.remove());

        panel.append(
            section("Key Claim", keyClaim),
            section("Agreement", agreement),
            section("Concept Drift / Difference", drift),
            close
        );
        document.documentElement.appendChild(panel);
    }

    function escapeHtml(str) {
        return String(str).replace(/[&<>"']/g, s => ({ "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;" }[s]));
    }

    function escapeAttr(str) {
        return escapeHtml(str).replace(/"/g, "&quot;");
    }

    // UI toolbar
    function createToolbar() {
        const root = document.createElement("div");
        root.className = "pagegenie-toolbar";
        root.style.display = "none";

        Object.assign(root.style, {
            fontFamily: "system-ui, -apple-system, Segoe UI, Roboto, sans-serif",
            background: "rgba(26,26,26,0.95)",
            color: "#fff",
            padding: "6px 8px",
            borderRadius: "8px",
            boxShadow: "0 6px 18px rgba(0,0,0,0.25)",
            display: "flex",
            gap: "6px",
            alignItems: "center",
            zIndex: "2147483647",
            userSelect: "none",
            position: "absolute"
        });

        const actions = [
            { id: "summarize", label: "✨ Summary" },
            { id: "explain", label: "💬 Explain" },
            { id: "rewrite", label: "🪄 Rewrite" },
            { id: "translate", label: "🌍 Translate" },
            { id: "sep", label: "|" },
            { id: "save", label: "📘 Save" },
            { id: "compare_concept", label: "🔗 Analyze Concept Drift" },
            { id: "quiz_selection", label: "🧠 Quiz Me" },
            { id: "sep", label: "|" },
            { id: "quick_proof", label: "⚡ Replace with Proofread" },
            { id: "quick_comment", label: "⚡ Insert Code Comments" }
        ];

        const handlers = {};
        const btns = actions.map(a => {
            if (a.id === "sep") {
                const sep = document.createElement("span");
                sep.className = "pagegenie-sep";
                sep.textContent = a.label;
                sep.style.color = "rgba(255,255,255,0.45)";
                sep.style.padding = "0 4px";
                return sep;
            }
            const b = document.createElement("button");
            b.className = "pagegenie-btn";
            b.textContent = a.label;
            Object.assign(b.style, {
                background: "#2f2f2f",
                color: "#fff",
                border: "1px solid rgba(255,255,255,0.12)",
                padding: "4px 8px",
                borderRadius: "6px",
                fontSize: "12px",
                cursor: "pointer"
            });
            b.addEventListener("mouseover", () => (b.style.background = "#3a3a3a"));
            b.addEventListener("mouseout", () => (b.style.background = "#2f2f2f"));
            b.addEventListener("click", (e) => {
                e.preventDefault();
                e.stopPropagation();
                handlers[a.id]?.();
            });
            return b;
        });
        btns.forEach(b => root.appendChild(b));
        document.documentElement.appendChild(root);

        function on(id, fn) { handlers[id] = fn; }
        function show(pos) {
            root.style.display = "flex";
            root.style.top = (pos.top - 40) + "px";
            root.style.left = pos.left + "px";
            lastAnchorPos = { top: pos.top, left: pos.left };
        }
        function hide() { root.style.display = "none"; }

        return { on, show, hide };
    }

    // Persistent loading toast helper
    function createLoadingToast(initialMessage = "Loading…") {
        const el = document.createElement("div");
        el.className = "pagegenie-loading-toast";
        const icon = document.createElement("span");
        icon.textContent = "⏳";
        icon.style.marginRight = "8px";
        const text = document.createElement("span");
        text.textContent = initialMessage;

        Object.assign(el.style, {
            position: "fixed",
            left: "20px",
            bottom: "20px",
            background: "rgba(20,20,20,0.96)",
            color: "#fff",
            padding: "10px 12px",
            borderRadius: "10px",
            border: "1px solid rgba(255,255,255,0.12)",
            zIndex: "2147483647",
            display: "flex",
            alignItems: "center",
            maxWidth: "50vw",
            fontFamily: "system-ui, -apple-system, Segoe UI, Roboto, sans-serif",
            boxShadow: "0 8px 24px rgba(0,0,0,0.35)",
        });

        el.append(icon, text);
        document.documentElement.appendChild(el);

        let dots = 0;
        const interval = setInterval(() => {
            dots = (dots + 1) % 4;
            const base = text.dataset.base || text.textContent.replace(/\.*$/, "");
            text.dataset.base = base;
            text.textContent = base + ".".repeat(dots);
        }, 400);

        function set(msg) {
            delete text.dataset.base;
            text.textContent = msg;
        }
        function success(msg = "Done") {
            clearInterval(interval);
            icon.textContent = "✅";
            set(msg);
            el.style.background = "rgba(8, 80, 30, 0.96)";
            el.style.borderColor = "rgba(255,255,255,0.18)";
            setTimeout(close, 900);
        }
        function error(msg = "Error") {
            clearInterval(interval);
            icon.textContent = "⚠️";
            set(msg);
            el.style.background = "rgba(120, 20, 20, 0.96)";
            el.style.borderColor = "rgba(255,255,255,0.18)";
            setTimeout(close, 1400);
        }
        function close() {
            try { el.remove(); } catch {}
        }
        return { set, success, error, close };
    }

    // Floating Action Button (FAB) — always-visible toggleable menu (controlled by showFloatingButton)
    let __pg_fab_root = null;
    let __pg_fab_menu_open = false;
    let __pg_fab_observer = null;

    function ensureFloatingButton() {
        // Only in top frame to avoid duplicates
        try { if (window.top !== window.self) return; } catch {}

        if (__pg_fab_root && document.documentElement.contains(__pg_fab_root)) return;

        const root = document.createElement("div");
        root.id = "pagegenie-fab";
        Object.assign(root.style, {
            position: "fixed",
            right: "16px",
            bottom: "16px",
            zIndex: "2147483647",
            display: "flex",
            flexDirection: "column",
            alignItems: "flex-end",
            gap: "8px",
            pointerEvents: "none"
        });

        // Vertical menu container
        const menu = document.createElement("div");
        menu.id = "pagegenie-fab-menu";
        Object.assign(menu.style, {
            display: "none",
            flexDirection: "column",
            gap: "6px",
            paddingBottom: "4px",
            pointerEvents: "auto"
        });

        const btn = document.createElement("button");
        btn.id = "pagegenie-fab-btn";
        btn.title = "PageGenie";
        btn.setAttribute("aria-label", "PageGenie menu");
        Object.assign(btn.style, {
            pointerEvents: "auto",
            width: "52px",
            height: "52px",
            borderRadius: "50%",
            border: "1px solid rgba(255,255,255,0.18)",
            background: "linear-gradient(135deg, #1b1f2a 0%, #0f141c 100%)",
            color: "#fff",
            boxShadow: "0 10px 24px rgba(0,0,0,0.35)",
            cursor: "pointer",
            fontSize: "22px"
        });
        btn.textContent = "🧞";

        function mbtn(label, onClick) {
            const b = document.createElement("button");
            b.className = "pagegenie-fab-item";
            b.textContent = label;
            Object.assign(b.style, {
                background: "rgba(20,20,20,0.98)",
                color: "#fff",
                border: "1px solid rgba(255,255,255,0.14)",
                padding: "8px 10px",
                borderRadius: "8px",
                cursor: "pointer",
                fontSize: "13px",
                minWidth: "200px",
                textAlign: "left",
                boxShadow: "0 8px 20px rgba(0,0,0,0.3)"
            });
            b.addEventListener("mouseenter", () => (b.style.background = "rgba(28,28,28,0.98)"));
            b.addEventListener("mouseleave", () => (b.style.background = "rgba(20,20,20,0.98)"));
            b.addEventListener("click", (e) => {
                e.preventDefault();
                e.stopPropagation();
                try { onClick(); } catch {}
                toggleMenu(false);
            });
            return b;
        }

        // Build menu items (reusing the same handlers)
        menu.append(
            mbtn("✨ Summarize", () => runSimpleOp("summarize")),
            mbtn("💬 Explain", () => runSimpleOp("explain")),
            mbtn("🪄 Rewrite", () => runSimpleOp("rewrite")),
            mbtn("🌍 Translate", () => runTranslationOverlay()),
            mbtn("📄 Process Full Document", () => runFullDocSummarize()),
            mbtn("📘 Save Note", () => saveNote()),
            mbtn("🔗 Analyze Concept Drift", () => compareConceptDrift()),
            mbtn("🧠 Quiz Me", () => quizSelectedText()
            )
        )


        function toggleMenu(open) {
            __pg_fab_menu_open = open ?? !__pg_fab_menu_open;
            menu.style.display = __pg_fab_menu_open ? "flex" : "none";
        }
        btn.addEventListener("click", (e) => {
            e.preventDefault();
            e.stopPropagation();
            toggleMenu();
        });

        function onDocClick(e) {
            if (!__pg_fab_menu_open) return;
            if (!root.contains(e.target)) toggleMenu(false);
        }
        function onKeyDown(e) {
            if (__pg_fab_menu_open && e.key === "Escape") toggleMenu(false);
        }
        document.addEventListener("click", onDocClick, true);
        document.addEventListener("keydown", onKeyDown, true);

        root.append(menu, btn);
        document.documentElement.appendChild(root);

        __pg_fab_root = root;
        __pg_fab_root.__pg_cleanup = () => {
            document.removeEventListener("click", onDocClick, true);
            document.removeEventListener("keydown", onKeyDown, true);
        };

        // Keep-alive — if sites rewrite DOM, recreate FAB while enabled
        try {
            if (__pg_fab_observer) __pg_fab_observer.disconnect();
            __pg_fab_observer = new MutationObserver(() => {
                if (!settings.showFloatingButton) return;
                if (!document.documentElement.contains(__pg_fab_root)) {
                    __pg_fab_root = null;
                    ensureFloatingButton();
                }
            });
            __pg_fab_observer.observe(document.documentElement, { childList: true });
        } catch {}
    }

    function removeFloatingButton() {
        if (__pg_fab_observer) {
            try { __pg_fab_observer.disconnect(); } catch {}
            __pg_fab_observer = null;
        }
        if (__pg_fab_root) {
            try { __pg_fab_root.__pg_cleanup?.(); } catch {}
            try { __pg_fab_root.remove(); } catch {}
            __pg_fab_root = null;
            __pg_fab_menu_open = false;
        }
    }

    // Helper: confirm before full-page processing when there is no selection
    async function ensureFullPageConsent(op, text, sourceHint = "whole page") {
        if (!settings.showFullPageConfirm) return true;
        const count = (text || "").length;
        return await confirmFullPageModal(op, count, sourceHint);
    }

    // NEW: Minimal confirmation modal (returns Promise<boolean>)
    function confirmFullPageModal(op, charCount, sourceHint) {
        return new Promise((resolve) => {
            const root = document.createElement("div");
            Object.assign(root.style, {
                position: "fixed", inset: "0", background: "rgba(0,0,0,0.45)", zIndex: "2147483647",
                display: "flex", alignItems: "center", justifyContent: "center"
            });

            const card = document.createElement("div");
            Object.assign(card.style, {
                background: "#0f1115", color: "#e8eaf0", border: "1px solid rgba(255,255,255,0.12)",
                borderRadius: "10px", width: "min(520px, 90vw)", padding: "16px 18px", boxShadow: "0 12px 36px rgba(0,0,0,0.4)",
                fontFamily: "system-ui, -apple-system, Segoe UI, Roboto, sans-serif"
            });

            const title = document.createElement("div");
            title.textContent = "Process full page?";
            Object.assign(title.style, { fontWeight: "800", marginBottom: "6px" });

            const msg = document.createElement("div");
            msg.innerHTML = `You’re about to run <b>${escapeHtml(opTitle(op))}</b> on the ${escapeHtml(sourceHint)}.<br/>Estimated size: <b>${charCount.toLocaleString()}</b> characters.`;
            Object.assign(msg.style, { color: "#cbd5e1", fontSize: "13px", marginBottom: "10px" });

            const dontAskWrap = document.createElement("label");
            const cb = document.createElement("input"); cb.type = "checkbox"; cb.id = "pg-dontask";
            const txt = document.createElement("span"); txt.textContent = " Don’t ask again for full-page actions";
            dontAskWrap.append(cb, txt);
            Object.assign(dontAskWrap.style, { display: "inline-flex", alignItems: "center", gap: "6px", fontSize: "12px", color: "#9aa3b2" });

            const row = document.createElement("div");
            Object.assign(row.style, { display: "flex", gap: "8px", justifyContent: "flex-end", marginTop: "12px" });

            const cancel = document.createElement("button");
            cancel.textContent = "Cancel";
            styleBtn(cancel, "ghost");

            const proceed = document.createElement("button");
            proceed.textContent = "Process";
            styleBtn(proceed, "primary");

            cancel.onclick = () => { cleanup(false); };
            proceed.onclick = async () => {
                if (cb.checked) {
                    try { await chrome.storage.sync.set({ showFullPageConfirm: false }); settings.showFullPageConfirm = false; } catch {}
                }
                cleanup(true);
            };

            row.append(cancel, proceed);
            card.append(title, msg, dontAskWrap, row);
            root.append(card);
            document.documentElement.append(root);

            function cleanup(ok) {
                try { root.remove(); } catch {}
                resolve(!!ok);
            }
            function styleBtn(b, kind) {
                Object.assign(b.style, {
                    background: kind === "primary" ? "#155e75" : "#1b1b1b",
                    color: "#fff", border: "1px solid rgba(255,255,255,0.18)", padding: "6px 10px",
                    borderRadius: "8px", cursor: "pointer", fontSize: "13px"
                });
                b.onmouseenter = () => b.style.background = (kind === "primary" ? "#1b6b85" : "#242424");
                b.onmouseleave = () => b.style.background = (kind === "primary" ? "#155e75" : "#1b1b1b");
            }
        });
    }



    // Dev/test hooks
    window.__pg_showSuggestions = function(example) {
        const arr = normalizeSuggestionsShape(example);
        if (arr.length) showSuggestionsPanel(arr);
    };
    window.__pg_showCategories = function(obj) {
        try { showCategoriesBubbleWithFallback(obj); } catch (e) {}
    };
})();