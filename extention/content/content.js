// - Selection toolbar (Summarize, Explain, Rewrite, Translate, Save, Quiz Me, Proofread, Code Comments, Find sources)
// - Quick-Fix DOM Injection (Replace with Proofread, Translation Overlay, Insert Code Comments)
// - Offline (on-device) AI via pageBridge + Online fallback via Spring Boot (/api/v1/ai)
// - Save Note shows Categories bubble + Curated Reading side panel
// - Robust background messaging with "extension context invalidated" guard
// - Floating Action Button (FAB): always-visible button with vertical menu; toggle from popup (showFloatingButton)
// - Full-page confirmation before whole-page processing (showFullPageConfirm)
// - Cloud-only input limit (CLOUD_CHAR_LIMIT) for backend; no hard limit for on-device
// - Persona presets + Cite Sources flag passed to AI (persona, citeSources)
// - Structured results for summarize/explain: { bullets: [...], citations: [...] } with References rendering
// - Theme (system/light/dark) + consistent SVG iconography + subtle animations + accessibility (ARIA, keyboard nav)
// - Hotkeys handled via background commands: Summarize (Alt+Shift+S), Explain (Alt+Shift+E), Rewrite (Alt+Shift+R), Translate (Alt+Shift+T)
// - FIX: Multi-word selection reliability — show toolbar after mouseup to avoid one-word-only selection
// PATCH: Empty state hint + "Why cloud?" tooltip + shared References styling hooks ===

(function init() {
    injectPageBridge();

    function throttle(fn, ms = 120) {
        let last = 0, queued = null, timer = null;
        return (msg) => {
            const now = Date.now();
            const run = (v) => { last = Date.now(); queued = null; timer = null; try { fn(v); } catch {} };
            if (now - last >= ms) run(msg);
            else {
                queued = msg;
                if (!timer) timer = setTimeout(() => { if (queued != null) run(queued); }, ms - (now - last));
            }
        };
    }

    // Global settings
    let settings = {
        mode: "auto",              // "auto" | "offline-only" | "online-only"
        showToolbarOnSelection: true,
        showFloatingButton: false,
        showFullPageConfirm: true,
        targetLang: "en",
        theme: "system",           // "system" | "light" | "dark"
        persona: "general",        // "general" | "student" | "researcher" | "editor"
        citeSources: true
    };
    let __pg_last_render_op = "";

    // Track AI path for microcopy in result panels
    let __pg_last_ai_path = ""; // "device" | "cloud" | ""

    // System dark preference for theme auto mode
    const _pg_mql = window.matchMedia?.("(prefers-color-scheme: dark)") || null;

    // Load settings
    chrome.storage.sync.get(
        {
            mode: "auto",
            showToolbarOnSelection: true,
            showFloatingButton: false,
            showFullPageConfirm: true,
            targetLang: "en",
            theme: "system",
            persona: "general",
            citeSources: true
        },
        (s) => {
            settings = { ...settings, ...s };
            pgInjectStyles();
            pgApplyTheme();
            if (settings.mode === "offline-only") prewarmLikely();
            if (settings.showFloatingButton) ensureFloatingButton();
            if (settings.mode !== "online-only") {
                setTimeout(prewarmLikely, 200);
            }
        }
    );

    // React to settings changes
    chrome.storage.onChanged.addListener((changes, area) => {
        if (area !== "sync") return;
        if (changes.mode) settings.mode = changes.mode.newValue;
        if (changes.showToolbarOnSelection) settings.showToolbarOnSelection = changes.showToolbarOnSelection.newValue;
        if (changes.showFloatingButton) {
            settings.showFloatingButton = !!changes.showFloatingButton.newValue;
            if (settings.showFloatingButton) ensureFloatingButton(); else removeFloatingButton();
        }
        if (changes.showFullPageConfirm) settings.showFullPageConfirm = !!changes.showFullPageConfirm.newValue;
        if (changes.targetLang) {
            settings.targetLang = changes.targetLang.newValue;
            // re-prewarm language‑dependent tasks (ok to call; bridge caches instances)
            if (settings.mode !== "online-only") {
                // do not flip the __pg_prewarmed guard so we can re-send just for language updates
                try { prewarmAllApis(); } catch {}
            }
        }
        if (changes.persona) settings.persona = changes.persona.newValue;
        if (changes.citeSources) settings.citeSources = !!changes.citeSources.newValue;
        if (changes.theme) {
            settings.theme = changes.theme.newValue || "system";
            pgApplyTheme();
            try { __pg_toolbar_updateTheme?.(); } catch {}
        }
    });
    _pg_mql?.addEventListener?.("change", () => {
        if (settings.theme === "system") {
            pgApplyTheme();
            try { __pg_toolbar_updateTheme?.(); } catch {}
        }
    });

    function prewarmAllApis() {
        try {
            const want = [
                // Keep Prompt first so we always have a session for generic fallback
                { kind: "prompt" },
                // Language-aware task APIs
                { kind: "translator", opts: { targetLanguage: settings.targetLang || "en", sourceLanguage: "auto" } },
                { kind: "proofreader", opts: { expectedInputLanguages: [ (settings.targetLang || "en") ] } },
                // Style/structure tasks
                { kind: "summarizer", opts: { /* you can pass sharedContext/tone if your bridge supports it */ } },
                { kind: "rewriter",   opts: { tone: "neutral", format: "plain-text", length: "medium" } },
                { kind: "writer",     opts: { tone: "neutral", format: "plain-text", length: "medium" } },
            ];
            window.postMessage({ type: "PAGEGENIE_AI_PREWARM", id: "prewarm_all", want }, "*");
        } catch {}
    }

//  Mark the device as ready when we see any AI events from the bridge.
    window.addEventListener("message", (ev) => {
        try {
            const d = ev?.data;
            if (!d || typeof d !== "object") return;
            if (d.type === "PAGEGENIE_AI_READY" && d.ready) {
                __pg_deviceReady = true;
                return;
            }
            if (d.type === "PAGEGENIE_AI_PROGRESS" || d.type === "PAGEGENIE_AI_RESPONSE") {
                __pg_deviceReady = true;
            }
        } catch {}
    }, true);


    // Prewarm on-device
    let __pg_prewarmed = false;
    function prewarmLikely() {
        if (__pg_prewarmed) return;
        __pg_prewarmed = true;
        if (settings.mode === "online-only") return; // respect user choice
        prewarmAllApis();
    }

    // On-device readiness probe

    let __pg_deviceReady = false;

    function probeDeviceReady(timeoutMs = 800) {
        return new Promise((resolve) => {
            let settled = false;
            const finish = (ok) => { if (settled) return; settled = true; resolve(!!ok); };
            const handler = (ev) => {
                if (ev.source !== window) return;
                const d = ev.data;
                if (!d || d.type !== "PAGEGENIE_AI_READY") return;
                window.removeEventListener("message", handler, true);
                finish(!!d.ready);
            };
            window.addEventListener("message", handler, true);
            try { window.postMessage({ type: "PAGEGENIE_AI_PING" }, "*"); } catch {}
            setTimeout(() => {
                try { window.removeEventListener("message", handler, true); } catch {}
                finish(false);
            }, timeoutMs);
        });
    }

// Only cache TRUE; if probe fails, we retry next time.
    async function ensureOnDeviceReady({ retries = 2, timeout = 800, backoff = 300 } = {}) {
        if (__pg_deviceReady) return true;
        for (let attempt = 0; attempt <= retries; attempt++) {
            const ok = await probeDeviceReady(timeout + attempt * backoff);
            if (ok) { __pg_deviceReady = true; return true; }
        }
        return false;
    }

    // CLOUD LIMIT (backend only)
    const CLOUD_CHAR_LIMIT = 20000;
    function applyCloudLimit(text) {
        if (!text || text.length <= CLOUD_CHAR_LIMIT) return text;
        const suffix = `\n\n[truncated to ${CLOUD_CHAR_LIMIT.toLocaleString()} of ${text.length.toLocaleString()} chars for cloud processing]`;
        return text.slice(0, CLOUD_CHAR_LIMIT) + suffix;
    }

    // Selection toolbar
    const toolbar = createToolbar();
    let lastSelectionText = "";
    let lastRange = null;
    let lastAnchorPos = null;
    let lastAnchorPosViewport = null;

    // Multi-word selection reliability
    let __pg_isMouseDown = false;
    document.addEventListener("mousedown", (e) => {
        const inOwnUi =
            (window.__pg_toolbar_root && window.__pg_toolbar_root.contains(e.target)) ||
            (__pg_fab_root && __pg_fab_root.contains(e.target));
        if (inOwnUi) return;
        __pg_isMouseDown = true;
        toolbar.hide();
    }, true);

    document.addEventListener("mouseup", () => {
        __pg_isMouseDown = false;
        setTimeout(() => {
            if (!settings.showToolbarOnSelection) return;
            const selection = document.getSelection();
            if (!selection || selection.isCollapsed) { toolbar.hide(); return; }
            const text = selection.toString().trim();
            if (!text) { toolbar.hide(); return; }

            lastSelectionText = text;
            try { lastRange = selection.getRangeAt(0).cloneRange(); } catch { lastRange = null; }

            if (lastRange) {
                const rectPage = getRangeRect(lastRange);
                toolbar.show(rectPage);
                lastAnchorPos = { top: rectPage.top, left: rectPage.left };
                const rectViewport = getViewportRect(lastRange);
                lastAnchorPosViewport = { top: rectViewport.top, left: rectViewport.left };
            }

            if (settings.mode !== "online-only") prewarmLikely();
        }, 0);
    }, true);

    // Keyboard-based selection (Shift+Arrows)
    document.addEventListener("selectionchange", () => {
        if (__pg_isMouseDown) return;
        if (!settings.showToolbarOnSelection) { toolbar.hide(); return; }
        const selection = document.getSelection();
        if (!selection || selection.isCollapsed) { toolbar.hide(); return; }
        const text = selection.toString().trim();
        if (!text) { toolbar.hide(); return; }

        lastSelectionText = text;
        try { lastRange = selection.getRangeAt(0).cloneRange(); } catch { lastRange = null; }

        if (lastRange) {
            const rectPage = getRangeRect(lastRange);
            toolbar.show(rectPage);
            lastAnchorPos = { top: rectPage.top, left: rectPage.left };
            const rectViewport = getViewportRect(lastRange);
            lastAnchorPosViewport = { top: rectViewport.top, left: rectViewport.left };
        }

        if (settings.mode !== "online-only") prewarmLikely();
    });

    // Background messaging: hotkeys + context menu + loaders
    const __pg_loaders = new Map();
    chrome.runtime.onMessage.addListener((msg) => {
        // Hotkeys from background commands
        if (msg?.type === "PAGEGENIE_HOTKEY") {
            switch (msg.operation) {
                case "summarize": runSimpleOp("summarize"); break;
                case "explain": runSimpleOp("explain"); break;
                case "rewrite": runSimpleOp("rewrite"); break;
                case "translate": runTranslationOverlay(); break;
                default: break;
            }
            return;
        }

        // Context menu relay
        if (msg?.type === "PAGEGENIE_CONTEXT_ACTION") {
            if (msg.operation === "process_full") runFullDocSummarize();
            else {
                if (!lastRange || !lastSelectionText) return;
                if (msg.operation === "summarize") runSimpleOp("summarize");
                if (msg.operation === "explain") runSimpleOp("explain");
                if (msg.operation === "translate") runTranslationOverlay();
                if (msg.operation === "quick_comment") insertCodeComments();
            }
            return;
        }

        // Toast relay
        if (msg?.type === "PAGEGENIE_TOAST" && msg.message) {
            showToast(msg.message);
            return;
        }

        // Background-driven loader lifecycle
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
        if (msg.action === "set") loader.set(msg.message || "Working…");
        else if (msg.action === "success") { loader.success(msg.message || "Done"); __pg_loaders.delete(id); }
        else if (msg.action === "error") { loader.error(msg.message || "Error"); __pg_loaders.delete(id); }
        else if (msg.action === "close") { loader.close(); __pg_loaders.delete(id); }
    });

    // Toolbar bindings
    toolbar.on("summarize", () => runSimpleOp("summarize"));
    toolbar.on("explain", () => runSimpleOp("explain"));
    toolbar.on("rewrite", () => runSimpleOp("rewrite"));
    toolbar.on("translate", () => runTranslationOverlay());
    toolbar.on("save", () => saveNote());
    toolbar.on("compare_concept", () => compareConceptDrift());
    toolbar.on("quiz_selection", () => quizSelectedText());
    toolbar.on("quick_proof", () => replaceWithProofread());
    toolbar.on("quick_comment", () => insertCodeComments());
    toolbar.on("find_sources", () => runFindSources());

    // Unified active text resolver
    async function getActiveText({ fullDoc = false } = {}) {
        const sel = document.getSelection();
        const selected = sel && !sel.isCollapsed ? String(sel.toString() || "").trim() : "";
        if (selected) return { text: selected, strategy: "selection" };
        if (fullDoc) return { text: getWholePageText(), strategy: "full_html" };
        return { text: getWholePageText(), strategy: "full_html" };
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

    // PDF heuristic
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

    // Consent before full page
    async function ensureFullPageConsent(op, text, sourceHint = "whole page") {
        if (!settings.showFullPageConfirm) return true;
        const count = (text || "").length;
        return await confirmFullPageModal(op, count, sourceHint);
    }
    function confirmFullPageModal(op, charCount, sourceHint) {
        return new Promise((resolve) => {
            const root = document.createElement("div");
            Object.assign(root.style, {
                position: "fixed", inset: "0", background: "rgba(0,0,0,0.45)", zIndex: "2147483647",
                display: "flex", alignItems: "center", justifyContent: "center"
            });

            const c = pgColors();
            const card = document.createElement("div");
            Object.assign(card.style, {
                background: pgGetThemeMode()==="light" ? "#ffffff" : "#0f1115",
                color: c.text, border: `1px solid ${c.border}`,
                borderRadius: "10px", width: "min(520px, 90vw)", padding: "16px 18px", boxShadow: "0 12px 36px rgba(0,0,0,0.4)",
                fontFamily: "system-ui, -apple-system, Segoe UI, Roboto, sans-serif"
            });

            const title = document.createElement("div");
            title.textContent = "Process full page?";
            Object.assign(title.style, { fontWeight: "800", marginBottom: "6px" });

            const msg = document.createElement("div");
            msg.innerHTML = `You’re about to run <b>${escapeHtml(opTitle(op))}</b> on the ${escapeHtml(sourceHint)}.<br/>Estimated size: <b>${charCount.toLocaleString()}</b> characters.`;
            Object.assign(msg.style, { color: c.muted, fontSize: "13px", marginBottom: "10px" });

            const dontAskWrap = document.createElement("label");
            dontAskWrap.setAttribute("for", "pg-dontask");
            const cb = document.createElement("input"); cb.type = "checkbox"; cb.id = "pg-dontask";
            const txt = document.createElement("span"); txt.textContent = " Don’t ask again for full-page actions";
            dontAskWrap.append(cb, txt);
            Object.assign(dontAskWrap.style, { display: "inline-flex", alignItems: "center", gap: "6px", fontSize: "12px", color: c.muted });

            const row = document.createElement("div");
            Object.assign(row.style, { display: "flex", gap: "8px", justifyContent: "flex-end", marginTop: "12px" });

            const cancel = document.createElement("button");
            cancel.textContent = "Cancel";
            const proceed = document.createElement("button");
            proceed.textContent = "Process";

            [cancel, proceed].forEach((b, i) => {
                Object.assign(b.style, {
                    background: i ? "#155e75" : "#1b1b1b",
                    color: "#fff", border: "1px solid rgba(255,255,255,0.18)", padding: "6px 10px",
                    borderRadius: "8px", cursor: "pointer", fontSize: "13px"
                });
                b.onmouseenter = () => b.style.background = i ? "#1b6b85" : "#242424";
                b.onmouseleave = () => b.style.background = i ? "#155e75" : "#1b1b1b";
            });

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
        });
    }

    // Operations
    async function runFullDocSummarize() {
        __pg_last_render_op = "summarize";
        const loader = createLoadingToast("Processing full document");
        const throttledSet = throttle(loader.set.bind(loader), 120);
        try {
            if (looksLikePdfPage()) {
                throttledSet("Opening Reader for PDF…");
                chrome.runtime.sendMessage(
                    { type: "PAGEGENIE_OPEN_READER", op: "summarize_full", src: location.href },
                    () => {}
                );
                loader.success("Reader opened");
                return;
            }

            const active = await getActiveText({ fullDoc: true });
            if (!active.text) throw new Error("No text found in document");

            const ok = await ensureFullPageConsent("summarize", active.text, "whole page");
            if (!ok) { loader.set("Cancelled"); setTimeout(() => loader.close(), 600); return; }

            const resultText = await runAIWithCloudLimit("summarize", active.text, (stage) => throttledSet(`Summary • ${stage}`));
            loader.success("Summary ready");
            showResultPanel(resultText);
            persist("/api/ops/log", {
                type: "summarize_full_doc", source: location.href, input_len: active.text.length,
                output: resultText, strategy: active.strategy, ts: Date.now()
            });
        } catch (e) {
            loader.error("AI error: " + (e?.message || e));
        }
    }

    async function runSimpleOp(op) {
        __pg_last_render_op = op;
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
            const structured = tryParseStructuredResult(resultText);

            if (structured && Array.isArray(structured.bullets)) {
                // NEW: only auto-search when user prefers citations AND we are not in offline-only mode
                const wantAutoSearch = !!settings.citeSources && settings.mode !== "offline-only";

                if (wantAutoSearch && (!structured.citations || structured.citations.length === 0)) {
                    throttledSet(`${opTitle(op)} • Finding sources…`);
                    try {
                        const found = await __pg_fetchSearchCitationsFromBackend(active.text);
                        const merged = { bullets: structured.bullets, citations: found };
                        __pg_last_render_op = op;
                        loader.success(opTitle(op) + " ready");
                        showStructuredResultPanel(merged, { title: (op === "explain" ? "Explanation" : "Summary") });
                    } catch {
                        // Search failed; still render bullets
                        __pg_last_render_op = op;
                        loader.success(opTitle(op) + " ready");
                        showStructuredResultPanel(structured, { title: (op === "explain" ? "Explanation" : "Summary") });
                    }
                } else {
                    __pg_last_render_op = op;
                    loader.success(opTitle(op) + " ready");
                    showStructuredResultPanel(structured, { title: (op === "explain" ? "Explanation" : "Summary") });
                }
            } else {
                // Fallback: plain panel
                loader.success(opTitle(op) + " ready");
                showResultPanel(resultText);
            }

            persist("/api/ops/log", {
                type: op, source: location.href, input: active.text.slice(0, 2000),
                output: resultText, strategy: active.strategy, ts: Date.now()
            });
        } catch (e) {
            loader.error("AI error: " + (e?.message || e));
        }
    }
    async function replaceWithProofread() {
        const sel = document.getSelection();
        if (!sel || sel.isCollapsed || !lastRange || !lastSelectionText) {
            showToast("Select text to proofread");
            return;
        }
        const loader = createLoadingToast("Proofreading...");
        const throttledSet = throttle(loader.set.bind(loader), 120);
        try {
            const result = await runAIWithCloudLimit("proofread", lastSelectionText, (stage) => throttledSet(`Proofreading • ${stage}`));
            const clean = stripMarkdownCodeFences(toPlainText(result));
            replaceRangeWithText(lastRange, clean);
            loader.success("Replaced with proofread text");
            persist("/api/ops/log", {
                type: "quick_proofread_replace", source: location.href,
                input: lastSelectionText, output: clean, ts: Date.now()
            });
        } catch (e) {
            loader.error("AI error: " + (e?.message || e));
        }
    }

    async function runTranslationOverlay() {
        const loader = createLoadingToast("Translating...");
        const throttledSet = throttle(loader.set.bind(loader), 120);
        try {
            const active = await getActiveText({ fullDoc: false });
            if (!active.text) throw new Error("No text found to translate");

            if (active.strategy === "full_html") {
                const ok = await ensureFullPageConsent("translate", active.text, "whole page");
                if (!ok) { loader.set("Cancelled"); setTimeout(() => loader.close(), 600); return; }
            }

            const raw = await runAIWithCloudLimit("translate", active.text, (stage) => throttledSet(`Translating • ${stage}`));
            const result = toPlainText(raw);
            loader.success("Translation ready");

            if (active.strategy === "selection" && lastRange) showTranslationBubble(lastRange, result);
            else showResultPanel(result);

            persist("/api/ops/log", {
                type: "translation_overlay", source: location.href, input_len: active.text.length,
                output: result, targetLang: settings.targetLang, strategy: active.strategy, ts: Date.now()
            });
        } catch (e) {
            loader.error("AI error: " + (e?.message || e));
        }
    }

    async function insertCodeComments() {
        const codeEl = findNearestCodeBlock(getSelectionAnchorNode());
        if (!codeEl) { showToast("No code block detected"); return; }
        const codeText = getCodeText(codeEl);
        if (!codeText?.trim()) { showToast("Empty code block"); return; }

        const loader = createLoadingToast("Adding explainer comments...");
        const throttledSet = throttle(loader.set.bind(loader), 120);
        try {
            const raw = await runAIWithCloudLimit("comment_code", codeText, (stage) => throttledSet(`Adding comments • ${stage}`));
            const result = stripMarkdownCodeFences(toPlainText(raw));
            setCodeText(codeEl, result);
            loader.success("Comments inserted");
            persist("/api/ops/log", {
                type: "code_comment_injection", source: location.href,
                input: codeText, output: result, ts: Date.now()
            });
        } catch (e) {
            loader.error("AI error: " + (e?.message || e));
        }
    }

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

    async function compareConceptDrift() {
        const active = await getActiveText({ fullDoc: false });
        if (!active.text) { showToast("Select some text"); return; }
        const loader = createLoadingToast("Analyzing against your notes…");
        try {
            const resp = await sendCompareConcept(active.text, location.href);
            console.log(resp);
            if (!resp?.ok) throw new Error(resp?.error || "Compare failed");
            const data = resp.data || {};
            loader.success("Analysis ready");
            showComparePanel({
                keyClaim: data.key_claim || data.keyClaim || "",
                agreement: data.agreement || "",
                drift: data.drift_analysis || data.drift || ""
            });

            persist("/api/ops/log", {
                type: "analyze_concept_drift", source: location.href, input_len: active.text.length,
                output: JSON.stringify(data), strategy: active.strategy, ts: Date.now()
            });
        } catch (e) {
            console.log(e);
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
                type: "quiz_from_selection", source: location.href, input_len: active.text.length,
                output: String(quizId), strategy: active.strategy, ts: Date.now()
            });
        } catch (e) {
            loader.error(e?.message || String(e));
        }
    }

    // Retrieval: Find sources (backend search)
    async function runFindSources() {
        const loader = createLoadingToast("Finding sources…");
        const throttledSet = throttle(loader.set.bind(loader), 120);
        try {
            const active = await getActiveText({ fullDoc: false });
            if (!active.text) throw new Error("No text found to analyze");

            if (active.strategy === "full_html") {
                const ok = await ensureFullPageConsent("find_sources", active.text, "whole page");
                if (!ok) { loader.set("Cancelled"); setTimeout(() => loader.close(), 600); return; }
            }

            throttledSet("Querying search backend");
            const resp = await persist("/api/v1/sources/find", {
                text: active.text,
                sourceUrl: location.href,
                persona: settings.persona
            });

            if (!resp?.ok) throw new Error(resp?.error || "Search backend error");
            const data = resp.data || {};
            const items = Array.isArray(data.items) ? data.items : (Array.isArray(data) ? data : []);

            showStructuredResultPanel({
                bullets: [],
                citations: items.map(it => ({
                    url: it.url, title: it.title, note: (it.reason ? (it.reason + " — found by search") : "found by search")
                }))
            }, { title: "References" });
            loader.success("Sources ready");
        } catch (e) {
            loader.error("Error: " + (e?.message || e));
        }
    }

    async function __pg_fetchSearchCitationsFromBackend(sourceText) {
        const resp = await persist("/api/v1/sources/find", {
            text: sourceText,
            sourceUrl: location.href,
            persona: settings.persona,
            size: 5
        });
        if (!resp?.ok) return [];
        const raw = resp.data || {};
        const items = Array.isArray(raw.items) ? raw.items : (Array.isArray(raw) ? raw : []);
        return items.map(it => ({
            url: it.url,
            title: it.title,
            note: it.reason ? (it.reason + " — found by search") : "found by search"
        })).filter(c => c.url && c.title);
    }

    // AI routing with persona/citations + cloud-only trim + last path tracking
// Make sure your routing calls ensureOnDeviceReady per request:

    async function runAIWithCloudLimit(op, text, progressCb) {
        const onProgress = (m) => { try { progressCb?.(m); } catch {} };

        const userWantsOffline = (settings.mode !== "online-only");
        const userAllowsOnline = (settings.mode !== "offline-only");

        // Probe, but be tolerant
        const deviceAvailable = userWantsOffline ? await ensureOnDeviceReady() : false;

        // Primary on-device path when probe says OK
        if (userWantsOffline && deviceAvailable) {
            try {
                onProgress("Using on-device AI");
                const res = await aiOnDeviceWithPersona(op, text, settings.targetLang, settings.persona, settings.citeSources, onProgress);
                __pg_last_ai_path = "device";
                const plain = toPlainText(res);
                if (plain) return plain;
            } catch {
                // fall through to cloud/offline-only fallback
            }
        }

        // Offline-only fallback: try once even if probe failed, before erroring
        if (!userAllowsOnline) {
            try {
                onProgress(deviceAvailable ? "Using on-device AI" : "Trying on-device AI");
                const res = await aiOnDeviceWithPersona(op, text, settings.targetLang, settings.persona, settings.citeSources, onProgress);
                __pg_last_ai_path = "device";
                const plain = toPlainText(res);
                if (plain) return plain;
            } catch (e) {
                // Final error for offline-only
                throw new Error("On-device AI unavailable.");
            }
        }

        // Cloud path
        onProgress(deviceAvailable ? "Falling back to cloud AI" : "Using cloud AI");
        const trimmedForCloud = applyCloudLimit(text);
        const cloudRes = await aiOnlineWithPersona(op, trimmedForCloud, settings.targetLang, settings.persona, settings.citeSources, onProgress);
        __pg_last_ai_path = "cloud";
        return toPlainText(cloudRes);
    }


    // In aiOnDeviceWithPersona, bump the timeout a bit, especially for offline-only:
    function aiOnDeviceWithPersona(operation, text, targetLang, persona, citeSources, progressCb) {
        const onProgress = (typeof progressCb === "function") ? progressCb : () => {};
        return new Promise((resolve, reject) => {
            const id = "pg_" + Math.random().toString(36).slice(2);
            let finished = false;
            let timer; // define before cleanup to avoid TDZ in cleanup()
            const cleanup = () => {
                try { window.removeEventListener("message", resHandler, true); } catch {}
                try { window.removeEventListener("message", progHandler, true); } catch {}
                try { clearTimeout(timer); } catch {}
            };
            const resHandler = (ev) => {
                if (ev.source !== window) return;
                const d = ev.data;
                if (!d || d.type !== "PAGEGENIE_AI_RESPONSE" || d.id !== id) return;
                __pg_deviceReady = true;
                if (finished) return;
                finished = true;
                cleanup();
                if (d.ok) resolve(d.result);
                else reject(new Error(d.error || "On-device AI error"));
            };
            const progHandler = (ev) => {
                if (ev.source !== window) return;
                const d = ev.data;
                if (!d || d.type !== "PAGEGENIE_AI_PROGRESS" || d.id !== id) return;
                __pg_deviceReady = true;
                try { onProgress(String(d.message || "")); } catch {}
            };
            window.addEventListener("message", resHandler, true);
            window.addEventListener("message", progHandler, true);
            try {
                window.postMessage({ type: "PAGEGENIE_AI_REQUEST", id, operation, text, targetLang, persona, citeSources }, "*");
            } catch (e) {
                finished = true; cleanup(); reject(new Error("Failed to talk to page bridge")); return;
            }

            const isOfflineOnly = (settings?.mode === "offline-only");
            const timeoutMs = isOfflineOnly ? 30000 : 18000;
            timer = setTimeout(() => {
                if (finished) return;
                finished = true;
                cleanup();
                reject(new Error("On-device AI timeout"));
            }, timeoutMs);
        });
    }


    async function aiOnlineWithPersona(operation, text, targetLang, persona, citeSources, onProgress) {
        const action = opToAction(operation);
        if (!action) throw new Error("Operation not supported by backend: " + operation);
        const structured = (action === "summarize" || action === "explain");
        const payload = { text, action, targetLang, persona, citeSources: !!settings.citeSources, structured };

        const resp = await __pg_persistWithRetry("/api/v1/ai", payload, { retries: 2, baseDelay: 900, maxDelay: 4500, onProgress });
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
        if (typeof out === "object") {
            if (typeof out.text === "string") return out.text;
            if (typeof out.corrected === "string") return out.corrected;
            if (typeof out.correctedText === "string") return out.correctedText;
            if (typeof out.result === "string") return out.result;
            if (typeof out.output === "string") return out.output;
            if (Array.isArray(out.choices) && typeof out.choices[0]?.text === "string") return out.choices[0].text;
            if (Array.isArray(out.candidates)) {
                const parts = out.candidates[0]?.content?.parts;
                if (Array.isArray(parts)) {
                    const s = parts.map(p => typeof p?.text === "string" ? p.text : "").join("\n").trim();
                    if (s) return s;
                }
            }
            try { return JSON.stringify(out); } catch { return String(out); }
        }
        return String(out);
    }

    // Persist via background
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

    function showTranslationBubble(range, text) {
        const vp = getViewportRect(range);
        const c = pgColors();
        const bubble = document.createElement("div");
        bubble.className = "pagegenie-translation-bubble";
        bubble.textContent = text;
        Object.assign(bubble.style, {
            position: "fixed",
            top: Math.max(8, vp.top - 8) + "px",
            left: Math.max(8, vp.left) + "px",
            maxWidth: "40vw",
            zIndex: "2147483647",
            background: c.toastBg,
            color: "#fff",
            borderRadius: "8px",
            padding: "8px 10px",
            boxShadow: "0 8px 24px rgba(0,0,0,0.35)",
            border: `1px solid ${c.border}`
        });
        document.documentElement.appendChild(bubble);
        requestAnimationFrame(() => clampToViewport(bubble));
        const close = () => bubble.remove();
        bubble.addEventListener("click", close);
        setTimeout(() => {
            document.addEventListener("click", close, { once: true, capture: true });
        }, 0);
    }

    function getRangeRect(range) {
        const rects = range.getClientRects();
        const rect = rects[0] || range.getBoundingClientRect();
        return { top: (rect?.top || 0) + window.scrollY, left: (rect?.left || 0) + window.scrollX };
    }
    function getViewportRect(range) {
        const rects = range.getClientRects();
        const rect = rects[0] || range.getBoundingClientRect();
        return { top: rect?.top || 0, left: rect?.left || 0 };
    }
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
    function getCodeText(codeEl) { return codeEl.innerText ?? codeEl.textContent ?? ""; }
    function setCodeText(codeEl, text) { codeEl.textContent = text; }
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
            proofread: "Proofread",
            comment_code: "Code Comments"
        })[op] || op;
    }

    function showToast(message) {
        const el = document.createElement("div");
        const c = pgColors();
        el.className = "pg-toast";
        el.textContent = message;
        Object.assign(el.style, {
            position: "fixed",
            left: "20px",
            bottom: "20px",
            background: c.toastBg,
            color: "#fff",
            padding: "10px 14px",
            borderRadius: "8px",
            opacity: "0",
            transform: "translateY(8px)",
            transition: "all .25s ease",
            zIndex: "2147483647",
            pointerEvents: "none",
            border: `1px solid ${c.border}`,
            fontFamily: "system-ui, -apple-system, Segoe UI, Roboto, sans-serif"
        });
        document.documentElement.appendChild(el);
        setTimeout(() => { el.style.opacity = "1"; el.style.transform = "translateY(0)"; }, 10);
        setTimeout(() => {
            el.style.opacity = "0";
            el.style.transform = "translateY(8px)";
            setTimeout(() => el.remove(), 300);
        }, 2000);
    }

    // Extract the first balanced {...} JSON object from text
    function __pg_extractFirstJsonObject(text) {
        if (typeof text !== "string") return null;
        let s = text.trim();

        // Strip Markdown code fences if present
        // Handles ```json ... ``` and ``` ... ```
        if (s.startsWith("```")) {
            // remove first fence line
            const firstNewline = s.indexOf("\n");
            if (firstNewline !== -1) {
                const fenceHeader = s.slice(0, firstNewline).toLowerCase();
                // drop header (``` or ```json etc.)
                s = s.slice(firstNewline + 1);
            } else {
                // single line fence, drop it
                s = s.replace(/^```+/, "");
            }
            // remove trailing fence
            const lastFence = s.lastIndexOf("```");
            if (lastFence !== -1) s = s.slice(0, lastFence);
            s = s.trim();
        }

        // If the whole thing is JSON already, try parsing directly
        try {
            const parsed = JSON.parse(s);
            return parsed;
        } catch {}

        // Sometimes the model returns a quoted JSON string: "{ \"bullets\": ... }"
        // Parse once to get the inner string, then parse again
        try {
            const once = JSON.parse(s);
            if (typeof once === "string") {
                const twice = JSON.parse(once);
                return twice;
            }
        } catch {}

        // Fallback: find the first balanced {...} block and parse it
        const start = s.indexOf("{");
        if (start === -1) return null;

        let brace = 0;
        for (let i = start; i < s.length; i++) {
            const ch = s[i];
            if (ch === "{") brace++;
            else if (ch === "}") {
                brace--;
                if (brace === 0) {
                    const candidate = s.slice(start, i + 1);
                    try {
                        return JSON.parse(candidate);
                    } catch {}
                    break;
                }
            }
        }

        return null;
    }

// Normalize various schema shapes to { bullets: [], citations: [] }
    function __pg_normalizeStructured(obj) {
        if (!obj || typeof obj !== "object") return null;

        let bullets = [];
        let citations = [];

        if (Array.isArray(obj.bullets)) bullets = obj.bullets.map(x => String(x ?? "")).filter(Boolean);
        // Accept alternative key 'points'
        if (!bullets.length && Array.isArray(obj.points)) bullets = obj.points.map(x => String(x ?? "")).filter(Boolean);

        // Prefer 'citations', but accept 'references'
        if (Array.isArray(obj.citations)) citations = obj.citations;
        else if (Array.isArray(obj.references)) citations = obj.references;

        // Make sure citations are objects with url/title/note keys
        if (Array.isArray(citations)) {
            citations = citations.map(c => {
                if (c && typeof c === "object") {
                    return {
                        url: c.url || c.href || "",
                        title: c.title || c.text || c.url || c.href || "Source",
                        note: c.note || c.reason || ""
                    };
                }
                const s = String(c || "");
                return { url: s.startsWith("http") ? s : "", title: s || "Source" };
            });
        } else {
            citations = [];
        }

        // Require at least bullets array to consider it structured
        if (!Array.isArray(bullets)) bullets = [];
        if (!Array.isArray(citations)) citations = [];

        // If there are no bullets at all, treat as not structured
        if (bullets.length === 0) return null;

        return { bullets, citations };
    }

    // Structured results (bullets + references) and fallback panel with microcopy
    function tryParseStructuredResult(text) {
        if (typeof text !== "string") return null;

        // Fast path: clean parse
        let obj = null;

        // 1) Try direct/quoted/extract-first logic
        obj = __pg_extractFirstJsonObject(text);
        if (!obj) return null;

        // 2) Normalize to expected shape
        return __pg_normalizeStructured(obj); // null if not suitable
    }

    function showStructuredResultPanel({ bullets = [], citations = [] } = {}, opts = {}) {
        const panel = document.createElement("div");
        const c = pgColors();
        Object.assign(panel.style, {
            position: "fixed",
            right: "20px",
            bottom: "20px",
            width: "min(520px, 50vw)",
            maxHeight: "60vh",
            overflow: "auto",
            background: c.panelBg,
            color: c.text,
            border: `1px solid ${c.border}`,
            borderRadius: "8px",
            padding: "12px",
            zIndex: "2147483647",
            boxShadow: "0 8px 24px rgba(0,0,0,0.35)"
        });

        // NEW: choose heading based on op, unless explicitly overridden
        const friendlyTitle = (op) => {
            if (op === "explain") return "Explanation";
            if (op === "summarize") return "Summary";
            return "Summary";
        };
        const topTitle = opts.title || friendlyTitle(__pg_last_render_op);

        const sec = (title) => {
            const h = document.createElement("div");
            h.textContent = title;
            h.style.fontWeight = "700";
            h.style.margin = "6px 0";
            return h;
        };

        if (bullets.length) {
            panel.append(sec(topTitle)); // <— was "Summary"
            const ul = document.createElement("ul"); ul.style.marginTop = "4px";
            bullets.forEach(b => {
                const li = document.createElement("li");
                li.textContent = String(b || "");
                ul.appendChild(li);
            });
            panel.append(ul);
        }

        if (citations.length) {
            panel.append(sec("References"));
            const ol = document.createElement("ol"); ol.style.marginTop = "4px";
            citations.forEach(cit => {
                const li = document.createElement("li");
                if (cit.url) {
                    const a = document.createElement("a");
                    a.href = cit.url; a.target = "_blank"; a.rel = "noopener noreferrer";
                    a.textContent = cit.title || cit.url || "Source";
                    a.style.color = "#9fd3ff"; a.style.textDecoration = "none";
                    a.addEventListener("mouseover", () => a.style.textDecoration = "underline");
                    a.addEventListener("mouseout", () => a.style.textDecoration = "none");
                    li.appendChild(a);
                } else {
                    li.textContent = cit.title || "Source";
                }
                if (cit.note) {
                    const s = document.createElement("span");
                    s.textContent = " — " + cit.note;
                    s.style.color = c.muted; s.style.fontSize = "12px";
                    li.appendChild(s);
                }
                ol.appendChild(li);
            });
            panel.append(ol);
        }

        // ...existing footer/actions append code (unchanged)...
        __pg_makeCloudFooter?.(panel); // if you added the “Why cloud?” footer helper

        const actions = document.createElement("div");
        actions.style.textAlign = "right";
        actions.style.marginTop = "8px";
        const close = document.createElement("button");
        close.textContent = "Close";
        Object.assign(close.style, {
            background: "#222",
            color: "#fff",
            border: `1px solid ${c.border}`,
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

    function showResultPanel(text) {
        const s = tryParseStructuredResult(text);
        if (s) return showStructuredResultPanel(s);

        const panel = document.createElement("div");
        const c = pgColors();
        panel.className = "pagegenie-result-panel";
        Object.assign(panel.style, {
            position: "fixed",
            right: "20px",
            bottom: "20px",
            width: "min(520px, 50vw)",
            maxHeight: "50vh",
            overflow: "auto",
            background: c.panelBg,
            color: c.text,
            border: `1px solid ${c.border}`,
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

        const footerWrap = document.createElement("div");
        __pg_makeCloudFooter(footerWrap);


        const copyBtn = document.createElement("button");
        copyBtn.textContent = "Copy";
        const close = document.createElement("button");
        close.textContent = "Close";
        [copyBtn, close].forEach(b => {
            Object.assign(b.style, {
                background: "#222",
                color: "#fff",
                border: `1px solid ${c.border}`,
                padding: "4px 8px",
                borderRadius: "6px",
                cursor: "pointer",
                fontSize: "12px",
                marginRight: "6px"
            });
        });
        copyBtn.addEventListener("click", async () => {
            try { await navigator.clipboard.writeText(text); copyBtn.textContent = "Copied!"; setTimeout(() => (copyBtn.textContent = "Copy"), 800); } catch {}
        });
        close.addEventListener("click", () => panel.remove());

        const actions = document.createElement("div");
        actions.append(copyBtn, close);
        panel.append(pre, actions, footerWrap);
        document.documentElement.appendChild(panel);
    }

    // Categories & Suggestions UI
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
        const c = pgColors();
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
            background: c.toastBg,
            color: "#fff",
            border: `1px solid ${c.border}`,
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
        const c = pgColors();
        bubble.className = "pagegenie-categories-bubble";
        bubble.textContent = text || "Note saved";
        Object.assign(bubble.style, {
            position: "fixed",
            top: pos.top + "px",
            left: pos.left + "px",
            zIndex: "2147483647",
            background: c.toastBg,
            color: "#fff",
            border: `1px solid ${c.border}`,
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
        const c = pgColors();
        panel.className = "pagegenie-suggestions-panel";

        Object.assign(panel.style, {
            position: "fixed",
            right: "20px",
            bottom: "20px",
            width: "min(420px, 50vw)",
            maxHeight: "60vh",
            overflow: "auto",
            background: c.panelBg,
            color: c.text,
            border: `1px solid ${c.border}`,
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
            item.style.borderBottom = `1px solid ${pgGetThemeMode()==="light" ? "rgba(0,0,0,0.08)" : "rgba(255,255,255,0.08)"}`;

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
                r.style.color = pgColors().muted;
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
            border: `1px solid ${pgColors().border}`,
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

    function showComparePanel({ keyClaim = "", agreement = "", drift = "" } = {}) {
        // Create container
        const wrap = document.createElement("div");
        Object.assign(wrap.style, {
            position: "fixed",
            right: "20px",
            bottom: "20px",
            width: "min(520px, 50vw)",
            maxHeight: "60vh",
            overflow: "auto",
            background: "rgba(17,17,20,0.98)",
            color: "#e8eaf0",
            border: "1px solid rgba(255,255,255,0.14)",
            borderRadius: "10px",
            padding: "12px",
            zIndex: "2147483647",
            boxShadow: "0 8px 24px rgba(0,0,0,0.35)",
            fontFamily: "system-ui, -apple-system, Segoe UI, Roboto, sans-serif"
        });

        const title = document.createElement("div");
        title.textContent = "Concept drift analysis";
        Object.assign(title.style, { fontWeight: "700", marginBottom: "8px" });
        wrap.appendChild(title);

        const sec = (label, text) => {
            const s = document.createElement("div");
            const h = document.createElement("div");
            h.textContent = label;
            Object.assign(h.style, { fontWeight: "600", margin: "6px 0 2px 0", color: "#cfd6e6" });
            const p = document.createElement("div");
            p.textContent = String(text || "");
            Object.assign(p.style, { whiteSpace: "pre-wrap", lineHeight: "1.4" });
            s.append(h, p);
            return s;
        };

        wrap.appendChild(sec("Key claim", keyClaim));
        wrap.appendChild(sec("Agreement", agreement));
        wrap.appendChild(sec("Drift analysis", drift));

        const actions = document.createElement("div");
        Object.assign(actions.style, { marginTop: "10px", textAlign: "right" });
        const close = document.createElement("button");
        close.textContent = "Close";
        Object.assign(close.style, {
            background: "#222", color: "#fff", border: "1px solid rgba(255,255,255,0.18)",
            padding: "4px 8px", borderRadius: "6px", cursor: "pointer", fontSize: "12px"
        });
        close.addEventListener("click", () => wrap.remove());
        actions.appendChild(close);
        wrap.appendChild(actions);

        document.documentElement.appendChild(wrap);
    }

    /* Empty state nudge — shown once per page load (session) */
    (function __pg_empty_state_bootstrap() {
        if (sessionStorage.getItem("pg_empty_hint_shown") === "1") return;
        // Delay slightly so we don't show on pages that immediately trigger a selection
        setTimeout(() => {
            try {
                const sel = document.getSelection();
                if (sel && !sel.isCollapsed) return; // user already selecting
                const hint = document.createElement("div");
                Object.assign(hint.style, {
                    position: "fixed",
                    left: "20px",
                    bottom: "20px",
                    background: "rgba(26,26,26,0.92)",
                    color: "#fff",
                    padding: "10px 12px",
                    borderRadius: "10px",
                    border: "1px solid rgba(255,255,255,0.12)",
                    zIndex: "2147483647",
                    fontFamily: "system-ui, -apple-system, Segoe UI, Roboto, sans-serif",
                    boxShadow: "0 8px 24px rgba(0,0,0,0.35)",
                    opacity: "0",
                    transform: "translateY(8px)",
                    transition: "opacity .25s ease, transform .25s ease",
                    pointerEvents: "auto",
                    maxWidth: "60vw",
                });
                hint.textContent = "Tip: Try selecting a paragraph to get started.";
                document.documentElement.appendChild(hint);
                requestAnimationFrame(() => { hint.style.opacity = "1"; hint.style.transform = "translateY(0)"; });
                sessionStorage.setItem("pg_empty_hint_shown", "1");
                setTimeout(() => {
                    hint.style.opacity = "0";
                    hint.style.transform = "translateY(8px)";
                    setTimeout(() => { try { hint.remove(); } catch {} }, 280);
                }, 4000);
            } catch {}
        }, 800);
    })();

    /* Track if device models are downloading (to inform "Why cloud?" reasons) */
    let __pg_modelsDownloading = false;
// Wherever we receive on-device progress events, set this flag if we see "Downloading model".
    (function __pg_hook_progress_flag() {
        const orig = window.addEventListener;
        // We already add listeners in aiOnDeviceWithPersona; ensure we also set the flag in the progress handler there.
        // If you prefer explicit wiring, add: if (data.type==="PAGEGENIE_AI_PROGRESS" && /downloading model/i.test(data.message)) __pg_modelsDownloading = true;
    })();

    /* Reasons helper for "Why cloud?" tooltip */
    function __pg_getWhyCloudText() {
        const lines = [];
        try {
            // Mode
            if (settings?.mode === "online-only") lines.push("Mode is set to Online only.");
            // Restricted pages
            const href = location?.href || "";
            if (/^chrome:\/\//i.test(href) || /chromewebstore/i.test(href)) {
                lines.push("This page restricts on‑device APIs (chrome:// or Web Store).");
            }
            // Device readiness
            if (!__pg_deviceReady) lines.push("On‑device APIs not ready yet in this tab.");
            if (__pg_modelsDownloading) lines.push("On‑device model is still downloading.");
            // Fallback generic
            if (!lines.length) lines.push("On‑device path wasn’t available at that moment.");
        } catch {
            lines.push("On‑device path wasn’t available at that moment.");
        }
        lines.push("Tip: Set Mode to Auto or Offline only to prefer on‑device when available.");
        return lines.join("\n");
    }

    /* Small tooltip for inline info icons */
    function __pg_attachTooltip(anchorEl, text) {
        let tip = null;
        function show() {
            if (tip) return;
            tip = document.createElement("div");
            Object.assign(tip.style, {
                position: "fixed",
                zIndex: "2147483647",
                background: "rgba(20,20,20,0.96)",
                color: "#fff",
                border: "1px solid rgba(255,255,255,0.12)",
                borderRadius: "8px",
                padding: "8px 10px",
                boxShadow: "0 8px 24px rgba(0,0,0,0.35)",
                maxWidth: "320px",
                fontSize: "12px",
                whiteSpace: "pre-wrap",
            });
            tip.textContent = text;
            document.documentElement.appendChild(tip);
            const rect = anchorEl.getBoundingClientRect();
            tip.style.top = Math.max(8, rect.bottom + 6) + "px";
            tip.style.left = Math.max(8, Math.min(window.innerWidth - 8 - tip.offsetWidth, rect.left)) + "px";
        }
        function hide() {
            try { tip?.remove(); tip = null; } catch {}
        }
        anchorEl.addEventListener("mouseenter", show);
        anchorEl.addEventListener("mouseleave", hide);
        anchorEl.addEventListener("focus", show);
        anchorEl.addEventListener("blur", hide);
    }

    /* Inject a "Why cloud?" info icon into result footers (plain + structured) */
    function __pg_makeCloudFooter(containerEl) {
        try {
            const footer = document.createElement("div");
            footer.style.cssText = "margin-top:8px;font-size:11px;opacity:.85;display:flex;align-items:center;gap:6px;flex-wrap:wrap";
            const pathStr = __pg_last_ai_path === "device" ? "On‑device" : (__pg_last_ai_path === "cloud" ? "Cloud" : "Auto");
            const txt = document.createElement("span");
            txt.textContent = `Tip: On‑device when available; falls back to cloud. Used: ${pathStr}`;
            const info = document.createElement("button");
            info.type = "button";
            info.setAttribute("aria-label", "Why was cloud used?");
            info.style.cssText = "background:#222;color:#fff;border:1px solid rgba(255,255,255,0.18);border-radius:999px;padding:2px 6px;cursor:pointer;font-size:10px";
            info.textContent = "Why cloud?";
            __pg_attachTooltip(info, __pg_getWhyCloudText());
            footer.append(txt, info);
            containerEl.appendChild(footer);
        } catch {}
    }

    /* Hook the footer into existing panels — call this in showStructuredResultPanel and showResultPanel */

    // Theme utilities + animations + iconography
    function pgGetThemeMode() {
        if (settings?.theme === "light") return "light";
        if (settings?.theme === "dark") return "dark";
        const prefersDark = _pg_mql ? _pg_mql.matches : true;
        return prefersDark ? "dark" : "light";
    }
    function pgColors() {
        const mode = pgGetThemeMode();
        if (mode === "light") {
            return {
                text: "#ffffff",
                muted: "#4d5b78",
                bg: "rgb(253,0,174)",
                surface: "#05aee6",
                border: "rgba(0,0,0,0.14)",
                border2: "rgba(0,0,0,0.08)",
                focus: "#1d4ed8",
                accent: "#2563eb",
                panelBg: "#020202",
                toolbarBg: "rgba(20,21,24,0.97)", // keep dark bubble for contrast
                toastBg: "rgba(30,30,30,0.95)",
                btn: "#1f2937",
                btnHover: "#243041"
            };
        }
        return {
            text: "#e8eaf0",
            muted: "#9aa3b2",
            bg: "rgba(15,17,21,0.98)",
            surface: "#171a21",
            border: "rgba(255,255,255,0.14)",
            border2: "rgba(255,255,255,0.10)",
            focus: "#3b82f6",
            accent: "#5aa9ff",
            panelBg: "#121212",
            toolbarBg: "rgba(26,26,26,0.96)",
            toastBg: "rgba(20,20,20,0.96)",
            btn: "#2a2f3a",
            btnHover: "#343b48"
        };
    }
    function pgInjectStyles() {
        if (document.getElementById("pagegenie-a11y-anim")) return;
        const style = document.createElement("style");
        style.id = "pagegenie-a11y-anim";
        style.textContent = `
      .pg-focus:focus-visible { outline: 2px solid var(--pg-focus,#3b82f6); outline-offset: 2px; }
      .pg-anim-pop { transform: scale(0.98); opacity: 0; transition: transform .12s ease, opacity .12s ease; }
      .pg-anim-pop.pg-open { transform: scale(1); opacity: 1; }
      .pg-toast { transition: opacity .25s ease, transform .25s ease; }
      .pg-toast-show { opacity: 1 !important; transform: translateY(0) !important; }
      .pg-anim-fade { opacity: 0; transform: translateY(-4px); transition: opacity .12s ease, transform .12s ease; }
      .pg-anim-fade.pg-open { opacity: 1; transform: translateY(0); }
    `;
        document.documentElement.appendChild(style);
    }
    function pgApplyTheme() {
        const c = pgColors();
        const root = document.getElementById("pagegenie-fab");
        if (root) {
            root.style.setProperty("--pg-text", c.text);
            root.style.setProperty("--pg-muted", c.muted);
            root.style.setProperty("--pg-bg", c.bg);
            root.style.setProperty("--pg-surface", c.surface);
            root.style.setProperty("--pg-border", c.border);
            root.style.setProperty("--pg-focus", c.focus);
            root.style.setProperty("--pg-btn", c.btn);
            root.style.setProperty("--pg-btnh", c.btnHover);
        }
    }
    function iconSvg(name, size = 16) {
        const s = String(size);
        const props = `width="${s}" height="${s}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"`;
        switch (name) {
            case "genie": return `<svg ${props}><path d="M12 3c-4 0-7 3-7 7 0 1 .2 2 .7 3l-1.4 4.2a1 1 0 0 0 1.27 1.27L9.8 17.3A7 7 0 1 0 12 3z"/><circle cx="12" cy="10" r="2"/></svg>`;
            case "summarize": return `<svg ${props}><path d="M4 6h16M4 12h8M4 18h12"/></svg>`;
            case "explain": return `<svg ${props}><path d="M21 15v4a2 2 0 0 1-2 2H7l-4 3V5a2 2 0 0 1 2-2h10"/><path d="M17 3h4v4"/></svg>`;
            case "rewrite": return `<svg ${props}><path d="M3 17l6 6M3 17l12-12a2 2 0 0 1 3 3L6 20z"/></svg>`;
            case "translate": return `<svg ${props}><path d="M7 7h10M5 5l7 14M17 5L10 19M14 7l5 5"/></svg>`;
            case "document": return `<svg ${props}><path d="M14 2H6a2 2 0 0 0-2 2v16l4-4h10a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6"/></svg>`;
            case "save": return `<svg ${props}><path d="M5 21V3h10l4 4v14z"/><path d="M9 21v-8h6v8"/><path d="M9 3v4h6"/></svg>`;
            case "compare": return `<svg ${props}><path d="M10 4H6a2 2 0 0 0-2 2v12"/><path d="M14 20h4a2 2 0 0 0 2-2V6"/><path d="M8 12h8"/></svg>`;
            case "quiz": return `<svg ${props}><path d="M9 7a3 3 0 1 1 6 0c0 2-3 2-3 4"/><path d="M12 17h.01"/><rect x="3" y="3" width="18" height="18" rx="2"/></svg>`;
            case "proof": return `<svg ${props}><path d="M20 6L9 17l-5-5"/></svg>`;
            case "comment": return `<svg ${props}><path d="M21 15v4a2 2 0 0 1-2 2H7l-4 3V5a2 2 0 0 1 2-2h10"/><path d="M7 8h6M7 12h8"/></svg>`;
            default: return `<svg ${props}><circle cx="12" cy="12" r="10"/></svg>`;
        }
    }

    // FAB
    let __pg_fab_root = null;
    let __pg_fab_observer = null;

    function ensureFloatingButton() {
        try { if (window.top !== window.self) return; } catch {}
        if (__pg_fab_root && document.documentElement.contains(__pg_fab_root)) return;

        pgInjectStyles();
        const c = pgColors();

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
            pointerEvents: "none",
            "--pg-focus": c.focus
        });

        const menu = document.createElement("div");
        menu.id = "pagegenie-fab-menu";
        Object.assign(menu.style, {
            display: "none",
            flexDirection: "column",
            gap: "6px",
            paddingBottom: "4px",
            pointerEvents: "auto"
        });
        menu.setAttribute("role", "menu");
        menu.setAttribute("aria-label", "PageGenie actions");

        const btn = document.createElement("button");
        btn.id = "pagegenie-fab-btn";
        btn.title = "PageGenie";
        btn.setAttribute("aria-label", "Open PageGenie menu");
        btn.setAttribute("aria-expanded", "false");
        btn.className = "pg-focus";
        Object.assign(btn.style, {
            pointerEvents: "auto",
            width: "52px",
            height: "52px",
            borderRadius: "50%",
            border: `1px solid ${c.border2 || c.border}`,
            background: `linear-gradient(135deg, ${c.surface} 0%, ${pgGetThemeMode()==='light' ? '#e9eef7' : '#0f141c'} 100%)`,
            color: c.text,
            boxShadow: "0 10px 24px rgba(0,0,0,0.35)",
            cursor: "pointer",
            fontSize: "0"
        });
        btn.innerHTML = iconSvg("genie", 26);

        function mbtn(label, icon, onClick, shortcut) {
            const b = document.createElement("button");
            b.className = "pagegenie-fab-item pg-focus pg-anim-pop";
            b.setAttribute("role", "menuitem");
            b.setAttribute("tabindex", "-1");
            b.setAttribute("aria-label", label);
            b.title = shortcut ? `${label} (${shortcut})` : label;
            Object.assign(b.style, {
                background: c.btn,
                color: c.text,
                border: `1px solid ${c.border}`,
                padding: "8px 10px",
                borderRadius: "8px",
                cursor: "pointer",
                fontSize: "13px",
                minWidth: "220px",
                textAlign: "left",
                boxShadow: "0 8px 20px rgba(0,0,0,0.3)",
                display: "inline-flex",
                alignItems: "center",
                gap: "8px"
            });
            b.addEventListener("mouseenter", () => (b.style.background = c.btnHover));
            b.addEventListener("mouseleave", () => (b.style.background = c.btn));
            b.addEventListener("click", (e) => {
                e.preventDefault(); e.stopPropagation();
                try { onClick(); } catch {}
                toggleMenu(false);
                btn.focus();
            });
            b.addEventListener("keydown", (e) => {
                if (e.key === "Enter" || e.key === " ") { e.preventDefault(); b.click(); }
                if (e.key === "Escape") { e.preventDefault(); toggleMenu(false); btn.focus(); }
                if (e.key === "ArrowDown" || e.key === "ArrowUp") {
                    e.preventDefault();
                    const items = [...menu.querySelectorAll('[role="menuitem"]')];
                    const idx = items.indexOf(document.activeElement);
                    const next = e.key === "ArrowDown" ? (idx + 1) % items.length : (idx - 1 + items.length) % items.length;
                    items[next]?.focus();
                }
            });
            b.innerHTML = iconSvg(icon, 16) + `<span>${label}</span>`;
            return b;
        }

        const items = [
            ["✨ Summarize", "summarize", () => runSimpleOp("summarize"), "Alt+Shift+S"],
            ["💬 Explain", "explain", () => runSimpleOp("explain"), "Alt+Shift+E"],
            ["🪄 Rewrite", "rewrite", () => runSimpleOp("rewrite"), "Alt+Shift+R"],
            ["🌍 Translate", "translate", () => runTranslationOverlay(), "Alt+Shift+T"],
            ["📄 Process Full Document", "document", () => runFullDocSummarize()],
            ["📘 Save Note", "save", () => saveNote()],
            ["🔗 Analyze Concept Drift", "compare", () => compareConceptDrift()],
            ["🧠 Quiz Me", "quiz", () => quizSelectedText()],
            ["🔎 Find sources", "compare", () => runFindSources()]
        ];
        items.forEach(([label, icon, fn, shortcut]) => menu.append(mbtn(label, icon, fn, shortcut)));

        function toggleMenu(open) {
            const willOpen = open ?? menu.style.display === "none";
            if (willOpen) {
                menu.style.display = "flex";
                btn.setAttribute("aria-expanded", "true");
                requestAnimationFrame(() => menu.querySelectorAll(".pg-anim-pop").forEach(el => el.classList.add("pg-open")));
                const first = menu.querySelector('[role="menuitem"]');
                first?.focus();
            } else {
                menu.querySelectorAll(".pg-anim-pop").forEach(el => el.classList.remove("pg-open"));
                setTimeout(() => { menu.style.display = "none"; }, 100);
                btn.setAttribute("aria-expanded", "false");
            }
        }
        btn.addEventListener("click", (e) => { e.preventDefault(); e.stopPropagation(); toggleMenu(); });
        btn.addEventListener("keydown", (e) => { if (e.key === "ArrowDown") { e.preventDefault(); toggleMenu(true); } });

        function onDocClick(e) { if (menu.style.display === "flex" && !root.contains(e.target)) toggleMenu(false); }
        function onKeyDown(e) { if (menu.style.display === "flex" && e.key === "Escape") toggleMenu(false); }
        document.addEventListener("click", onDocClick, true);
        document.addEventListener("keydown", onKeyDown, true);

        root.append(menu, btn);
        document.documentElement.appendChild(root);
        __pg_fab_root = root;
        __pg_fab_root.__pg_cleanup = () => {
            document.removeEventListener("click", onDocClick, true);
            document.removeEventListener("keydown", onKeyDown, true);
        };

        // Keep-alive for SPA rewrites
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

        pgApplyTheme();
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
        }
    }

    // Selection toolbar (themed + icons + a11y + tooltips with hotkey hints)
    function createToolbar() {
        pgInjectStyles();
        const c = pgColors();

        const root = document.createElement("div");
        root.className = "pagegenie-toolbar pg-anim-fade";
        root.setAttribute("role", "toolbar");
        root.setAttribute("aria-label", "PageGenie selection actions");
        root.style.display = "none";

        Object.assign(root.style, {
            position: "absolute",
            zIndex: "2147483647",
            fontFamily: "system-ui, -apple-system, Segoe UI, Roboto, sans-serif",
            background: c.toolbarBg,
            color: c.text,
            padding: "6px 8px",
            borderRadius: "10px",
            boxShadow: "0 6px 18px rgba(0,0,0,0.25)",
            display: "flex",
            gap: "6px",
            alignItems: "center",
            border: `1px solid ${c.border}`,
            "--pg-focus": c.focus
        });

        function tbtn(id, label, iconName, shortcut) {
            const b = document.createElement("button");
            b.type = "button";
            b.className = "pagegenie-btn pg-focus";
            b.setAttribute("data-id", id);
            b.setAttribute("aria-label", label);
            b.title = shortcut ? `${label} (${shortcut})` : label;
            b.innerHTML = `${iconSvg(iconName, 16)} <span style="margin-left:6px">${label}</span>`;
            Object.assign(b.style, {
                background: c.btn,
                color: c.text,
                border: `1px solid ${c.border}`,
                padding: "4px 8px",
                borderRadius: "6px",
                fontSize: "12px",
                cursor: "pointer",
                display: "inline-flex",
                alignItems: "center",
                gap: "6px"
            });
            b.addEventListener("mouseenter", () => (b.style.background = c.btnHover));
            b.addEventListener("mouseleave", () => (b.style.background = c.btn));
            return b;
        }

        const actions = [
            { id: "summarize", label: "Summary", icon: "summarize", shortcut: "Alt+Shift+S" },
            { id: "explain", label: "Explain", icon: "explain", shortcut: "Alt+Shift+E" },
            { id: "rewrite", label: "Rewrite", icon: "rewrite", shortcut: "Alt+Shift+R" },
            { id: "translate", label: "Translate", icon: "translate", shortcut: "Alt+Shift+T" },
            { id: "save", label: "Save", icon: "save" },
            { id: "compare_concept", label: "Analyze", icon: "compare" },
            { id: "quiz_selection", label: "Quiz Me", icon: "quiz" },
            { id: "quick_proof", label: "Proofread", icon: "proof" },
            { id: "quick_comment", label: "Code Comments", icon: "comment" },
            { id: "find_sources", label: "Find sources", icon: "compare" }
        ];

        const handlers = {};
        const btns = actions.map(a => {
            const b = tbtn(a.id, a.label, a.icon, a.shortcut);
            b.addEventListener("click", (e) => { e.preventDefault(); e.stopPropagation(); handlers[a.id]?.(); });
            root.appendChild(b);
            return b;
        });

        // Keyboard nav within toolbar
        root.addEventListener("keydown", (e) => {
            const items = btns;
            const current = document.activeElement;
            const idx = items.indexOf(current);
            if (e.key === "ArrowRight") {
                e.preventDefault(); items[(idx + 1) % items.length]?.focus();
            } else if (e.key === "ArrowLeft") {
                e.preventDefault(); items[(idx - 1 + items.length) % items.length]?.focus();
            } else if (e.key === "Home") {
                e.preventDefault(); items[0]?.focus();
            } else if (e.key === "End") {
                e.preventDefault(); items[items.length - 1]?.focus();
            } else if (e.key === "Escape") {
                e.preventDefault(); hide();
            }
        });

        document.documentElement.appendChild(root);
        window.__pg_toolbar_root = root;

        // Live theme refresh
        window.__pg_toolbar_updateTheme = () => {
            const cc = pgColors();
            root.style.background = cc.toolbarBg;
            root.style.color = cc.text;
            root.style.border = `1px solid ${cc.border}`;
            root.style.setProperty("--pg-focus", cc.focus);
            root.querySelectorAll(".pagegenie-btn").forEach(b => {
                b.style.background = cc.btn;
                b.style.border = `1px solid ${cc.border}`;
                b.style.color = cc.text;
            });
        };

        function on(id, fn) { handlers[id] = fn; }
        function show(pos) {
            root.style.display = "flex";
            root.style.top = (pos.top - 44) + "px";
            root.style.left = pos.left + "px";
            root.classList.remove("pg-open");
            void root.offsetWidth;
            root.classList.add("pg-open");
            btns[0]?.focus();
            window.__pg_toolbar_updateTheme?.();
        }
        function hide() { root.style.display = "none"; root.classList.remove("pg-open"); }

        return { on, show, hide };
    }

    // Loading toast
    function createLoadingToast(initialMessage = "Loading…") {
        pgInjectStyles();
        const c = pgColors();

        const el = document.createElement("div");
        el.className = "pg-toast";
        const icon = document.createElement("span");
        icon.textContent = "⏳";
        icon.style.marginRight = "8px";
        const text = document.createElement("span");
        text.textContent = initialMessage;

        Object.assign(el.style, {
            position: "fixed",
            left: "20px",
            bottom: "20px",
            background: c.toastBg,
            color: "#fff",
            padding: "10px 12px",
            borderRadius: "10px",
            border: `1px solid ${c.border}`,
            zIndex: "2147483647",
            display: "flex",
            alignItems: "center",
            maxWidth: "60vw",
            fontFamily: "system-ui, -apple-system, Segoe UI, Roboto, sans-serif",
            boxShadow: "0 8px 24px rgba(0,0,0,0.35)",
            opacity: "0",
            transform: "translateY(8px)"
        });

        el.append(icon, text);
        document.documentElement.appendChild(el);
        setTimeout(() => el.classList.add("pg-toast-show"), 10);

        let dots = 0;
        const interval = setInterval(() => {
            dots = (dots + 1) % 4;
            const base = text.dataset.base || text.textContent.replace(/\.*$/, "");
            text.dataset.base = base;
            text.textContent = base + ".".repeat(dots);
        }, 400);

        function set(msg) { delete text.dataset.base; text.textContent = msg; }
        function success(msg = "Done") {
            clearInterval(interval);
            icon.textContent = "✅"; set(msg);
            el.style.background = "rgba(8, 80, 30, 0.96)";
            setTimeout(close, 900);
        }
        function error(msg = "Error") {
            clearInterval(interval);
            icon.textContent = "⚠️"; set(msg);
            el.style.background = "rgba(120, 20, 20, 0.96)";
            setTimeout(close, 1400);
        }
        function close() { try { el.remove(); } catch {} }
        return { set, success, error, close };
    }

    function escapeHtml(str) {
        return String(str).replace(/[&<>"']/g, s => ({ "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;" }[s]));
    }
    function escapeAttr(str) { return escapeHtml(str).replace(/"/g, "&quot;"); }

    // Safe pageBridge injector
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

    // === BEGIN: transient backend error handling with retries ===

// Jittered sleep
    function __pg_sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }
    function __pg_backoffDelay(attempt, base = 800, cap = 5000) {
        const exp = Math.min(cap, base * Math.pow(2, attempt));
        const jitter = Math.floor(exp * (0.25 + Math.random() * 0.5)); // 25–75% jitter
        return Math.min(cap, Math.max(base, jitter));
    }

// Normalize/clean backend error payloads (including your <EOL> shape)
    function __pg_parseBackendErr(resp) {
        // resp is what persist() returns: { ok, error, status?, data? }
        const rawStatus = Number(resp?.status || 0) || 0;
        const data = resp?.data || {};
        const rawCode = (data?.code || "").toString();
        let msg = (resp?.error || data?.message || "").toString();

        // Unescape line tokens produced by backend
        if (msg.includes("<EOL>")) msg = msg.replace(/<EOL>/g, "\n");

        // Best-effort HTTP code extraction from message (e.g., "503 Service Unavailable")
        let embedded = 0;
        const match = msg.match(/\b(429|500|502|503|504)\b/);
        if (match) embedded = Number(match[1]);

        // Fallback to UNAVAILABLE keyword
        const lowered = msg.toLowerCase();
        let inferred = 0;
        if (!rawStatus && !embedded) {
            if (lowered.includes("unavailable") || lowered.includes("overloaded")) inferred = 503;
            else if (lowered.includes("too many requests") || lowered.includes("rate limit")) inferred = 429;
        }

        const status = rawStatus || embedded || inferred || 0;
        const code = rawCode || ((lowered.includes("overloaded") || lowered.includes("unavailable")) ? "UNAVAILABLE" : (lowered.includes("too many requests") ? "RATE_LIMIT" : "server_error"));

        return { status, code, message: msg };
    }

    function __pg_isTransientBackendError(err) {
        const s = err.status;
        const m = (err.message || "").toLowerCase();
        const c = (err.code || "").toLowerCase();

        if ([429, 500, 502, 503, 504].includes(s)) return true;
        if (c === "server_error" || c === "unavailable" || c === "rate_limit") return true;
        if (m.includes("overloaded") || m.includes("unavailable") || m.includes("temporarily") || m.includes("timeout")) return true;
        if (m.includes("too many requests") || m.includes("rate limit")) return true;
        if (m.includes("econnreset") || m.includes("eai_again") || m.includes("network")) return true;

        return false;
    }

    function __pg_friendlyCloudError(err) {
        const s = err.status;
        const m = (err.message || "").toLowerCase();

        if (s === 429 || m.includes("too many requests") || m.includes("rate limit")) {
            return "Cloud is rate‑limiting right now. Please try again shortly.";
        }
        if (s === 503 || m.includes("overloaded") || m.includes("unavailable")) {
            return "Cloud model is overloaded. Please wait a moment and try again.";
        }
        if ([500, 502, 504].includes(s)) {
            return "Cloud temporarily unavailable. Please try again.";
        }
        return err.message || "Backend AI request failed";
    }

// Retry wrapper around persist()
    async function __pg_persistWithRetry(endpoint, payload, { retries = 2, baseDelay = 900, maxDelay = 4500, onProgress } = {}) {
        let lastErr = null;
        for (let attempt = 0; attempt <= retries; attempt++) {
            const resp = await persist(endpoint, payload);
            if (resp?.ok) return resp;

            const err = __pg_parseBackendErr(resp);
            lastErr = err;

            if (attempt < retries && __pg_isTransientBackendError(err)) {
                const wait = __pg_backoffDelay(attempt, baseDelay, maxDelay);
                try { onProgress?.(`Cloud busy • retrying in ${(wait / 1000).toFixed(1)}s (${attempt + 1}/${retries + 1})`); } catch {}
                await __pg_sleep(wait);
                continue;
            }
            break; // non-transient or out of retries
        }
        return { ok: false, error: __pg_friendlyCloudError(lastErr || {}), status: lastErr?.status || 0, data: { code: lastErr?.code || "server_error", message: lastErr?.message || "" } };
    }

    // Dev hooks
    window.__pg_showSuggestions = function(example) {
        const arr = normalizeSuggestionsShape(example);
        if (arr.length) showSuggestionsPanel(arr);
    };
    window.__pg_showCategories = function(obj) {
        try { showCategoriesBubbleWithFallback(obj); } catch (e) {}
    };
})();