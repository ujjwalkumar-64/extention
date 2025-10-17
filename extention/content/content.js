// PageGenie content script
// - Selection toolbar (Summarize, Explain, Rewrite, Translate, Save)
// - Quick-Fix DOM Injection (Replace with Proofread, Translation Overlay, Insert Code Comments)
// - Offline (on-device) AI via pageBridge + Online fallback via Spring Boot (/api/v1/ai)
// - Save Note shows Categories bubble + Curated Reading side panel
// - Robust background messaging with "extension context invalidated" guard

(function init() {
    // Inject the page-bridge to access on-device AI APIs from page context (window.ai / Prompt API)
    injectPageBridge();

    // Settings state
    let settings = {
        mode: "auto", // "auto" | "offline-only" | "online-only"
        showToolbarOnSelection: true,
        targetLang: "en"
    };

    chrome.storage.sync.get(
        { mode: "auto", showToolbarOnSelection: true, targetLang: "en" },
        s => (settings = { ...settings, ...s })
    );

    chrome.storage.onChanged.addListener((changes, area) => {
        if (area === "sync") {
            if (changes.mode) settings.mode = changes.mode.newValue;
            if (changes.showToolbarOnSelection) settings.showToolbarOnSelection = changes.showToolbarOnSelection.newValue;
            if (changes.targetLang) settings.targetLang = changes.targetLang.newValue;
        }
    });

    // Selection toolbar
    const toolbar = createToolbar();
    let lastSelectionText = "";
    let lastRange = null;
    let lastAnchorPos = null; // fallback anchor for bubbles if selection collapses

    document.addEventListener("selectionchange", () => {
        if (!settings.showToolbarOnSelection) {
            toolbar.hide();
            return;
        }
        const selection = document.getSelection();
        if (!selection || selection.isCollapsed) {
            toolbar.hide();
            return;
        }
        const text = selection.toString().trim();
        if (!text) {
            toolbar.hide();
            return;
        }
        lastSelectionText = text;
        lastRange = selection.getRangeAt(0).cloneRange();
        const rect = getRangeRect(lastRange);
        toolbar.show(rect);
        lastAnchorPos = { top: rect.top, left: rect.left };
    });

    document.addEventListener("mouseup", () => {
        // Defer to allow selectionchange to run first
        setTimeout(() => {
            const sel = document.getSelection();
            if (!sel || sel.isCollapsed) toolbar.hide();
        }, 50);
    });

    // Handle context menu relay and toasts from background
    chrome.runtime.onMessage.addListener((msg) => {
        if (msg?.type === "PAGEGENIE_CONTEXT_ACTION") {
            if (!lastRange || !lastSelectionText) return;
            if (msg.operation === "summarize") runSimpleOp("summarize");
            if (msg.operation === "explain") runSimpleOp("explain");
            if (msg.operation === "translate") runTranslationOverlay();
            if (msg.operation === "quick_comment") insertCodeComments();
        }
        if (msg?.type === "PAGEGENIE_TOAST" && msg.message) {
            showToast(msg.message);
        }
    });

    // Toolbar actions
    toolbar.on("summarize", () => runSimpleOp("summarize"));
    toolbar.on("explain", () => runSimpleOp("explain"));
    toolbar.on("rewrite", () => runSimpleOp("rewrite"));
    toolbar.on("translate", () => runTranslationOverlay());
    toolbar.on("save", () => saveNote());
    // Quick-Fix DOM Injection actions
    toolbar.on("quick_proof", () => replaceWithProofread());
    toolbar.on("quick_overlay", () => runTranslationOverlay());
    toolbar.on("quick_comment", () => insertCodeComments());

    // Simple result operations (non-injection)
    async function runSimpleOp(op) {
        if (!lastSelectionText) return;
        try {
            const result = await runAI(op, lastSelectionText, settings.targetLang);
            showToast(opTitle(op) + " ready");
            showResultPanel(result);
            // Persist op log (optional)
            persist("/api/ops/log", {
                type: op,
                source: location.href,
                input: lastSelectionText,
                output: result,
                ts: Date.now()
            });
        } catch (e) {
            showToast("AI error: " + (e?.message || e));
        }
    }

    // Quick-Fix: Replace selection with proofread text
    async function replaceWithProofread() {
        if (!lastRange || !lastSelectionText) return;
        try {
            const result = await runAI("proofread", lastSelectionText, settings.targetLang);
            replaceRangeWithText(lastRange, result);
            showToast("Replaced with proofread text");
            persist("/api/ops/log", {
                type: "quick_proofread_replace",
                source: location.href,
                input: lastSelectionText,
                output: result,
                ts: Date.now()
            });
        } catch (e) {
            showToast("AI error: " + (e?.message || e));
        }
    }

    // Quick-Fix: Translation overlay bubble
    async function runTranslationOverlay() {
        if (!lastRange || !lastSelectionText) return;
        try {
            const result = await runAI("translate", lastSelectionText, settings.targetLang);
            showTranslationBubble(lastRange, result);
            showToast("Translation shown");
            persist("/api/ops/log", {
                type: "translation_overlay",
                source: location.href,
                input: lastSelectionText,
                output: result,
                targetLang: settings.targetLang,
                ts: Date.now()
            });
        } catch (e) {
            showToast("AI error: " + (e?.message || e));
        }
    }

    // Quick-Fix: Insert code comments in nearest code block
    async function insertCodeComments() {
        const codeEl = findNearestCodeBlock(getSelectionAnchorNode());
        if (!codeEl) {
            showToast("No code block detected");
            return;
        }
        const codeText = getCodeText(codeEl);
        if (!codeText?.trim()) {
            showToast("Empty code block");
            return;
        }
        try {
            const resultRaw = await runAI("comment_code", codeText, settings.targetLang);
            const result = stripMarkdownCodeFences(resultRaw);
            setCodeText(codeEl, result);
            showToast("Inserted explainer comments");
            persist("/api/ops/log", {
                type: "code_comment_injection",
                source: location.href,
                input: codeText,
                output: result,
                ts: Date.now()
            });
        } catch (e) {
            showToast("AI error: " + (e?.message || e));
        }
    }

    // Save note: persist to backend, show categories bubble, then curated reading panel
    async function saveNote() {
        if (!lastSelectionText) return;
        const payload = {
            source: location.href,
            content: lastSelectionText,
            ts: Date.now()
        };

        const res = await persist("/api/notes", payload);

        if (!res?.ok) {
            showToast(res?.error ? `Save failed: ${res.error}` : "Save failed");
            if (String(res?.error || "").toLowerCase().includes("extension context invalidated")) {
                showToast("Extension reloaded. Refresh this page and try again.");
            }
            return;
        }

        showToast("Note saved");

        // 1) Parse and show categories (topic/tags/related/summary)
        const categories = safeParseJson(res.data?.categoriesJson);
        try {
            showCategoriesBubbleWithFallback(categories);
        } catch {}

        // 2) Curated Reading List (optional; requires auth if backend protects it)
        try {
            const suggestResp = await persist("/api/v1/reading/suggest", {
                baseUrl: location.href,
                baseSummary: categories?.summary || lastSelectionText.slice(0, 400)
            });
            if (suggestResp?.ok) {
                const suggestions = normalizeSuggestionsShape(suggestResp.data);
                if (suggestions.length) showSuggestionsPanel(suggestions);
            }
        } catch {}
    }

    // AI routing: offline → online (or per settings)
    async function runAI(op, text, targetLang) {
        const tryOffline = settings.mode !== "online-only";
        const tryOnline = settings.mode !== "offline-only";

        if (tryOffline) {
            try {
                const res = await aiOnDevice(op, text, targetLang);
                if (res) return res;
            } catch (e) {
                // fall through to online
            }
        }
        if (!tryOnline) throw new Error("On-device AI unavailable.");

        const online = await aiOnline(op, text, targetLang);
        if (!online) throw new Error("Backend AI unavailable.");
        return online;
    }

    // On-device AI via page bridge (window.postMessage)
    function aiOnDevice(operation, text, targetLang) {
        return new Promise((resolve, reject) => {
            const id = "pg_" + Math.random().toString(36).slice(2);
            const handler = (ev) => {
                if (ev.source !== window) return;
                const data = ev.data;
                if (!data || data.type !== "PAGEGENIE_AI_RESPONSE" || data.id !== id) return;
                window.removeEventListener("message", handler);
                if (data.ok) resolve(data.result);
                else reject(new Error(data.error || "On-device AI error"));
            };
            window.addEventListener("message", handler);
            window.postMessage({
                type: "PAGEGENIE_AI_REQUEST",
                id,
                operation,
                text,
                targetLang
            }, "*");
            // 20s timeout
            setTimeout(() => {
                window.removeEventListener("message", handler);
                reject(new Error("On-device AI timeout"));
            }, 20000);
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

    // Map operations to backend enum values (now includes comment_code)
    function opToAction(op) {
        switch (op) {
            case "summarize":
            case "rewrite":
            case "explain":
            case "translate":
            case "proofread":
            case "comment_code": // enable online path for code comments
                return op;
            default:
                return null;
        }
    }

    // Accept multiple backend response shapes
    function extractAIResult(data) {
        if (!data) return "";
        if (typeof data === "string") return data;
        if (typeof data.result === "string") return data.result;
        if (typeof data.output === "string") return data.output;
        if (data.data && typeof data.data.result === "string") return data.data.result;
        if (data.data && typeof data.data.output === "string") return data.data.output;
        return "";
    }

    // Utility: strip Markdown code fences that models sometimes include
    function stripMarkdownCodeFences(s) {
        if (!s) return s;
        // Remove leading/trailing triple backticks with optional language
        // ```lang\n ... \n```
        const fenceRegex = /^```[\w+-]*\s*\n([\s\S]*?)\n```$/m;
        const m = s.match(fenceRegex);
        if (m && m[1]) return m[1];
        // Also handle inline single-fence cases
        if (s.startsWith("```") && s.endsWith("```")) {
            return s.replace(/^```[\w+-]*\s*\n?/, "").replace(/```$/, "");
        }
        return s;
    }

    // Robust persist with invalidated-context and lastError handling
    function persist(endpoint, payload) {
        return new Promise(resolve => {
            try {
                if (!chrome?.runtime?.id) {
                    return resolve({ ok: false, error: "Extension context invalidated. Refresh page and try again." });
                }
                chrome.runtime.sendMessage(
                    {
                        type: "PAGEGENIE_PERSIST",
                        endpoint,
                        payload
                    },
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
        // Reselect the replaced text
        const sel = document.getSelection();
        sel.removeAllRanges();
        const newRange = document.createRange();
        newRange.setStart(textNode, 0);
        newRange.setEnd(textNode, textNode.nodeValue.length);
        sel.addRange(newRange);
        lastRange = newRange;
    }

    function showTranslationBubble(range, text) {
        const rect = getRangeRect(range);
        const bubble = document.createElement("div");
        bubble.className = "pagegenie-translation-bubble";
        bubble.textContent = text;
        Object.assign(bubble.style, {
            position: "fixed",
            top: Math.max(8, rect.top - 8) + "px",
            left: Math.max(8, rect.left) + "px",
            maxWidth: "40vw",
            zIndex: "2147483647"
        });
        document.documentElement.appendChild(bubble);
        const close = () => bubble.remove();
        bubble.addEventListener("click", close);
        setTimeout(() => {
            document.addEventListener("click", close, { once: true, capture: true });
        }, 0);
    }

    function getRangeRect(range) {
        const rects = range.getClientRects();
        const rect = rects[0] || range.getBoundingClientRect();
        return {
            top: (rect?.top || 0) + window.scrollY,
            left: (rect?.left || 0) + window.scrollX
        };
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
        // Preserve text content (avoid innerHTML which may contain spans)
        return codeEl.innerText ?? codeEl.textContent ?? "";
    }

    function setCodeText(codeEl, text) {
        // Prefer textContent to keep highlighting libs from re-marking incorrectly
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

    // Robust JSON parser: handles plain objects, strings, and double-encoded JSON strings
    function safeParseJson(s) {
        if (!s) return null;
        if (typeof s === "object") return s;
        if (typeof s !== "string") return null;

        // Try direct parse
        try { return JSON.parse(s); } catch {}

        // Handle quoted/double-encoded JSON e.g. "\"{...}\""
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

    // Accept arrays, single object, or wrapped data/items/suggestions arrays
    function normalizeSuggestionsShape(raw) {
        if (!raw) return [];
        if (Array.isArray(raw)) return raw;
        if (Array.isArray(raw.data)) return raw.data;
        if (Array.isArray(raw.items)) return raw.items;
        if (Array.isArray(raw.suggestions)) return raw.suggestions;
        if (typeof raw === "object" && (raw.suggestedUrl || raw.url)) return [raw];
        return [];
    }

    // Show categories bubble even if selection range is gone (fallback to toolbar or viewport)
    function showCategoriesBubbleWithFallback(categories) {
        if (!categories) {
            showMinimalBubble("Note saved");
            return;
        }

        // Try the live selection range first
        const range = (() => {
            const sel = document.getSelection();
            if (sel && sel.rangeCount) return sel.getRangeAt(0).cloneRange();
            return lastRange || null;
        })();

        const rect = range ? getRangeRect(range) :
            lastAnchorPos ? { top: lastAnchorPos.top - 10, left: lastAnchorPos.left } :
                { top: window.scrollY + 20, left: window.scrollX + 20 };

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
            top: Math.max(8, rect.top) + "px",
            left: Math.max(8, rect.left) + "px",
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
        bubble.querySelector(".pgc-close")?.addEventListener("click", () => bubble.remove());
        // Auto-hide on outside click
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

    // Minimal fallback bubble if categories are missing
    function showMinimalBubble(text) {
        const bubble = document.createElement("div");
        bubble.className = "pagegenie-categories-bubble";
        bubble.textContent = text || "Note saved";
        Object.assign(bubble.style, {
            position: "fixed",
            top: (lastAnchorPos?.top ? Math.max(8, lastAnchorPos.top - 10) : window.scrollY + 20) + "px",
            left: (lastAnchorPos?.left ? Math.max(8, lastAnchorPos.left) : window.scrollX + 20) + "px",
            zIndex: "2147483647",
            background: "rgba(20,20,20,0.96)",
            color: "#fff",
            border: "1px solid rgba(255,255,255,0.12)",
            borderRadius: "10px",
            padding: "10px 12px",
            boxShadow: "0 8px 24px rgba(0,0,0,0.35)"
        });
        document.documentElement.appendChild(bubble);
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
            { id: "save", label: "📘 Save" },
            { id: "sep", label: "|" },
            { id: "quick_proof", label: "⚡ Replace with Proofread" },
            { id: "quick_overlay", label: "⚡ Translation Overlay" },
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

        function on(id, fn) {
            handlers[id] = fn;
        }
        function show(pos) {
            root.style.display = "flex";
            root.style.top = (pos.top - 40) + "px";
            root.style.left = pos.left + "px";
            // Remember last anchor position globally too
            lastAnchorPos = { top: pos.top, left: pos.left };
        }
        function hide() {
            root.style.display = "none";
        }

        return { on, show, hide };
    }

    function injectPageBridge() {
        const script = document.createElement("script");
        script.src = chrome.runtime.getURL("content/pageBridge.js");
        script.type = "text/javascript";
        // Make sure it's injected once
        if (!document.documentElement.querySelector(`script[src="${script.src}"]`)) {
            (document.head || document.documentElement).appendChild(script);
        }
    }

    // Dev/test hooks:
    // window.__pg_showSuggestions([{ suggestedUrl: "https://example.com", title: "Example", reason: "Why it matters" }])
    window.__pg_showSuggestions = function(example) {
        const arr = normalizeSuggestionsShape(example);
        if (arr.length) showSuggestionsPanel(arr);
    };
    // window.__pg_showCategories({ topic: "Topic", tags:["A","B"], relatedTo:["X"], summary:"..." })
    window.__pg_showCategories = function(obj) {
        try { showCategoriesBubbleWithFallback(obj); } catch (e) { /* ignore */ }
    };
})();