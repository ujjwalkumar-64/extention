// Content script: selection UI, AI operations, and DOM injection

(function init() {
    // Inject the page-bridge to access on-device AI APIs from page context
    injectPageBridge();

    // State from storage
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
    });

    document.addEventListener("mouseup", () => {
        // Defer to allow selectionchange to run first
        setTimeout(() => {
            const sel = document.getSelection();
            if (!sel || sel.isCollapsed) toolbar.hide();
        }, 50);
    });

    // Handle context menu relay
    chrome.runtime.onMessage.addListener((msg) => {
        if (msg?.type === "PAGEGENIE_CONTEXT_ACTION") {
            // Trigger operation based on current selection
            if (!lastRange || !lastSelectionText) return;
            if (msg.operation === "summarize") runSimpleOp("summarize");
            if (msg.operation === "explain") runSimpleOp("explain");
            if (msg.operation === "translate") runTranslationOverlay();
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

    async function runSimpleOp(op) {
        if (!lastSelectionText) return;
        try {
            const result = await runAI(op, lastSelectionText, settings.targetLang);
            showToast(opTitle(op) + " ready");
            // Optionally copy to clipboard or show small panel
            showResultPanel(result);
            // Persist
            persist("/api/ops/log", {
                type: op,
                source: location.href,
                input: lastSelectionText,
                output: result,
                ts: Date.now()
            });
        } catch (e) {
            showToast("AI error: " + e.message);
        }
    }

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
            showToast("AI error: " + e.message);
        }
    }

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
            showToast("AI error: " + e.message);
        }
    }

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
            const result = await runAI("comment_code", codeText, settings.targetLang);
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
            showToast("AI error: " + e.message);
        }
    }

    async function saveNote() {
        if (!lastSelectionText) return;
        const payload = {
            source: location.href,
            content: lastSelectionText,
            ts: Date.now()
        };
        const res = await persist("/api/notes", payload);
        showToast(res.ok ? "Note saved" : ("Save failed: " + (res.error || "")));
    }

    // AI Routing: offline → fallback online (or per settings)
    async function runAI(op, text, targetLang) {
        const tryOffline = settings.mode !== "online-only";
        const tryOnline = settings.mode !== "offline-only";

        if (tryOffline) {
            try {
                const res = await aiOnDevice(op, text, targetLang);
                if (res) return res;
            } catch (e) {
                // fall through
            }
        }
        if (!tryOnline) throw new Error("On-device AI unavailable.");

        const online = await aiOnline(op, text, targetLang);
        if (!online) throw new Error("Backend AI unavailable.");
        return online;
    }

    // On-device AI via bridge
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

    // Online via Spring Boot backend (updated to your /api/v1/ai + schema)
    async function aiOnline(operation, text, targetLang) {
        const action = opToAction(operation);
        if (!action) {
            throw new Error("Operation not supported by backend: " + operation);
        }

        const payload = {
            text,
            action,      // enum string expected by backend
            targetLang
        };

        const resp = await new Promise(resolve => {
            chrome.runtime.sendMessage(
                {
                    type: "PAGEGENIE_PERSIST",
                    endpoint: "/api/v1/ai",
                    payload
                },
                resolve
            );
        });

        if (!resp?.ok) throw new Error(resp?.error || "Backend AI request failed");

        const result = resp.data?.output;
        if (typeof result !== "string") {
            throw new Error("Invalid backend response");
        }
        return result;
    }

    function opToAction(op) {
        // Map content operations to backend enum values
        switch (op) {
            case "summarize":
            case "rewrite":
            case "explain":
            case "translate":
            case "proofread":
                return op; // identical strings in your Action enum
            default:
                return null; // unsupported by backend (e.g., "comment_code")
        }
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
        document.documentElement.appendChild(el);
        setTimeout(() => el.classList.add("show"), 10);
        setTimeout(() => {
            el.classList.remove("show");
            setTimeout(() => el.remove(), 300);
        }, 2000);
    }

    function showResultPanel(text) {
        const panel = document.createElement("div");
        panel.className = "pagegenie-result-panel";
        const pre = document.createElement("pre");
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

    function persist(endpoint, payload) {
        return new Promise(resolve => {
            chrome.runtime.sendMessage(
                {
                    type: "PAGEGENIE_PERSIST",
                    endpoint,
                    payload
                },
                resolve
            );
        });
    }

    // UI toolbar

    function createToolbar() {
        const root = document.createElement("div");
        root.className = "pagegenie-toolbar";
        root.style.display = "none";

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
                return sep;
            }
            const b = document.createElement("button");
            b.className = "pagegenie-btn";
            b.textContent = a.label;
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
            root.style.position = "absolute";
            root.style.top = (pos.top - 40) + "px";
            root.style.left = pos.left + "px";
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
})();