// Runs in page context (NOT the content-script isolated world)
// Hardened on-device bridge that prefers task-specific local APIs
// (Translator, Proofreader, Summarizer, Rewriter, Writer) when available,
// falls back to Prompt API (window.ai.createTextSession), then lets the
// content script fall back to cloud/backend if none are available.
//
// Communicates with the content script using window.postMessage events:
// - PAGEGENIE_AI_PING     => replies with PAGEGENIE_AI_READY { ready: boolean }
// - PAGEGENIE_AI_REQUEST  => replies with PAGEGENIE_AI_RESPONSE { ok, result|error, id }
// - Emits PAGEGENIE_AI_PROGRESS { id, message } for user-friendly loaders.
//
// IMPORTANT: Do NOT reference chrome.* APIs here. This file executes in page context.

(function () {
    if (window.__PAGEGENIE_BRIDGE_LOADED__) return;
    window.__PAGEGENIE_BRIDGE_LOADED__ = true;

    const NS_REQ   = "PAGEGENIE_AI_REQUEST";
    const NS_RES   = "PAGEGENIE_AI_RESPONSE";
    const NS_PROG  = "PAGEGENIE_AI_PROGRESS";
    const NS_PING  = "PAGEGENIE_AI_PING";
    const NS_READY = "PAGEGENIE_AI_READY";

    // --------------- Utils ---------------

    function pingProgress(id, msg) {
        try { window.postMessage({ type: NS_PROG, id, message: msg }, "*"); } catch {}
    }

    function withTimeout(promise, ms, message = "Timed out") {
        return new Promise((resolve, reject) => {
            const t = setTimeout(() => reject(new Error(message)), ms);
            promise.then(
                v => { clearTimeout(t); resolve(v); },
                e => { clearTimeout(t); reject(e); }
            );
        });
    }

    const isFn = (f) => typeof f === "function";
    const nvl = (a, b) => (a == null ? b : a);

    // --------------- Prompt API (fallback) ---------------

    let promptSessionPromise = null;

    async function hasPrompt() {
        try { return !!(window.ai && isFn(window.ai.createTextSession)); } catch { return false; }
    }

    async function getPromptSession() {
        if (!(window.ai && isFn(window.ai.createTextSession))) {
            throw new Error("Prompt API unavailable");
        }
        if (promptSessionPromise) return promptSessionPromise;

        promptSessionPromise = (async () => {
            try {
                if (isFn(window.ai.canCreateTextSession)) {
                    const status = await window.ai.canCreateTextSession();
                    if (status === "no") throw new Error("On-device AI not supported on this device");
                    // "after-download": createTextSession will fetch the model; just await it.
                }
            } catch {}
            const sess = await withTimeout(
                window.ai.createTextSession({ temperature: 0.2 }),
                30000,
                "On-device model creation timed out"
            );
            if (!sess || !isFn(sess.prompt)) {
                throw new Error("Prompt API session not available");
            }
            return sess;
        })();

        return promptSessionPromise;
    }

    function buildPrompt(operation, text, targetLang) {
        switch (operation) {
            case "summarize":
                return `Summarize the following text concisely in bullet points.\nReturn only the summary.\n\n---\n${text}\n---`;
            case "explain":
                return `Explain the following text for a general audience.\nBe clear and concise. Return only the explanation.\n\n---\n${text}\n---`;
            case "rewrite":
                return `Rewrite the following text to improve clarity and flow without changing meaning.\nReturn only the rewritten text.\n\n---\n${text}\n---`;
            case "proofread":
                return `Proofread and correct grammar and spelling.\nKeep the original meaning and voice. Return only the corrected text.\n\n---\n${text}\n---`;
            case "translate":
                return `Translate the following text to ${targetLang || "en"}.\nReturn only the translation (no notes or explanations).\n\n---\n${text}\n---`;
            case "comment_code":
                return `Add clear, explanatory comments to this code using appropriate line comment syntax for the language (e.g., //, #, --). Do not change behavior. Do not wrap in Markdown fences. Return only the full commented code.\n\n---\n${text}\n---`;
            default:
                return `Process the following and return only the result:\n\n---\n${text}\n---`;
        }
    }

    // --------------- Task-specific APIs (preferred) ---------------

    // Translator API:
    //   Translator.create({ sourceLanguage, targetLanguage, monitor }) -> instance
    //   instance.translate(text) -> Promise<string>
    function hasTranslator() {
        return !!(window.Translator && isFn(window.Translator.create));
    }

    function attachMonitor(id, m, opts = {}) {
        const verbose = !!opts.verbose; // true for Translator, false for others
        let lastPct = -1;

        function toPercent(e) {
            // Support multiple event shapes
            const loaded = (e?.loaded ?? e?.detail?.loaded ?? e?.progress ?? null);
            const total  = (e?.total  ?? e?.detail?.total  ?? null);

            let ratio = null;

            if (typeof loaded === "number" && typeof total === "number" && total > 0) {
                // Bytes case: use loaded/total
                ratio = loaded / total;
            } else if (typeof loaded === "number" && loaded >= 0 && loaded <= 1) {
                // Ratio case: 0..1 directly
                ratio = loaded;
            } else if (typeof e?.progress === "number" && e.progress >= 0 && e.progress <= 1) {
                // Some UAs might expose `progress` already normalized
                ratio = e.progress;
            }

            if (ratio == null) return null;
            // Monotonic integer steps 0..100
            return Math.max(0, Math.min(100, Math.floor(ratio * 100)));
        }

        try {
            m.addEventListener("downloadprogress", (e) => {
                const pct = toPercent(e);
                if (pct == null) return;

                if (verbose) {
                    // Emit 1,2,3,...,100 (only on change)
                    if (pct > lastPct) {
                        lastPct = pct;
                        pingProgress(id, `Downloading model ${pct}%`);
                    }
                } else {
                    // Minimal: only emit final 100%
                    if (pct >= 100 && lastPct < 100) {
                        lastPct = 100;
                        pingProgress(id, `Downloading model 100%`);
                    }
                }
            });

            m.addEventListener("statechange", () => {
                // For Translator we can forward state for extra transparency
                if (verbose) {
                    pingProgress(id, `State: ${m?.state || "unknown"}`);
                } else {
                    // Minimal: ensure we at least show completion
                    const st = String(m?.state || "").toLowerCase();
                    if ((st === "installed" || st === "ready") && lastPct < 100) {
                        lastPct = 100;
                        pingProgress(id, `Downloading model 100%`);
                    }
                }
            });
        } catch {
            // No-op if monitor object doesn't support events
        }
    }

    async function callTranslator(id, text, srcLang, dstLang) {
        if (!hasTranslator()) throw new Error("Translator API not available");
        pingProgress(id, "Using Translator API");

        // Try create with provided src/dst; if src is empty, try 'auto', then fallback to 'en'
        const tryCreate = async (src, dst) => {
            return await withTimeout(
                window.Translator.create({
                    sourceLanguage: src,
                    targetLanguage: dst,
                    monitor: (m) => attachMonitor(id, m, { verbose: true }) // VERBOSE for translation
                }),
                45000,
                "Translator creation timed out"
            );
        };

        let translator;
        const target = nvl(dstLang, "en");

        // Attempt auto-detect first
        try {
            translator = await tryCreate(nvl(srcLang, "auto"), target);
        } catch (e1) {
            // Fallback to explicit English source if auto-detect not supported
            try {
                translator = await tryCreate("en", target);
            } catch (e2) {
                // As a last resort, try passing only targetLanguage if the UA allows it
                try {
                    translator = await withTimeout(
                        window.Translator.create({
                            targetLanguage: target,
                            monitor: (m) => attachMonitor(id, m, { verbose: true }) // VERBOSE
                        }),
                        45000,
                        "Translator creation timed out"
                    );
                } catch (e3) {
                    throw e2; // propagate the more specific failure
                }
            }
        }

        const out = await withTimeout(
            translator.translate(text),
            30000,
            "Translator timed out"
        );
        return String(out ?? "");
    }

    // Summarizer API (best-effort shapes)
    function hasSummarizer() {
        const S = window.Summarizer;
        return !!(S && (isFn(S.create) || isFn(S.summarize)));
    }
    async function callSummarizer(id, text) {
        const S = window.Summarizer;
        if (!S) throw new Error("Summarizer API not available");
        pingProgress(id, "Using Summarizer API");
        if (isFn(S.summarize)) {
            return String(await withTimeout(S.summarize(text), 20000, "Summarizer timed out"));
        }
        if (isFn(S.create)) {
            const inst = await withTimeout(S.create({ monitor: mkMonitor(id) }), 30000, "Summarizer creation timed out");
            if (isFn(inst.summarize)) return String(await withTimeout(inst.summarize(text), 20000, "Summarizer timed out"));
            if (isFn(inst.generate)) return String(await withTimeout(inst.generate({ task: "summarize", text }), 20000, "Summarizer timed out"));
        }
        throw new Error("Summarizer API shape not supported");
    }

    // Proofreader API
    function hasProofreader() {
        const P = window.Proofreader;
        return !!(P && (isFn(P.create) || isFn(P.proofread)));
    }
    async function callProofreader(id, text) {
        const P = window.Proofreader;
        if (!P) throw new Error("Proofreader API not available");
        pingProgress(id, "Using Proofreader API");
        if (isFn(P.proofread)) {
            return String(await withTimeout(P.proofread(text), 20000, "Proofreader timed out"));
        }
        if (isFn(P.create)) {
            const inst = await withTimeout(P.create({ monitor: mkMonitor(id) }), 30000, "Proofreader creation timed out");
            if (isFn(inst.proofread)) return String(await withTimeout(inst.proofread(text), 20000, "Proofreader timed out"));
            if (isFn(inst.generate)) return String(await withTimeout(inst.generate({ task: "proofread", text }), 20000, "Proofreader timed out"));
        }
        throw new Error("Proofreader API shape not supported");
    }

    // Rewriter API
    function hasRewriter() {
        const R = window.Rewriter;
        return !!(R && (isFn(R.create) || isFn(R.rewrite)));
    }
    async function callRewriter(id, text) {
        const R = window.Rewriter;
        if (!R) throw new Error("Rewriter API not available");
        pingProgress(id, "Using Rewriter API");
        if (isFn(R.rewrite)) {
            return String(await withTimeout(R.rewrite(text), 20000, "Rewriter timed out"));
        }
        if (isFn(R.create)) {
            const inst = await withTimeout(R.create({ monitor: mkMonitor(id) }), 30000, "Rewriter creation timed out");
            if (isFn(inst.rewrite)) return String(await withTimeout(inst.rewrite(text), 20000, "Rewriter timed out"));
            if (isFn(inst.generate)) return String(await withTimeout(inst.generate({ task: "rewrite", text }), 20000, "Rewriter timed out"));
        }
        throw new Error("Rewriter API shape not supported");
    }

    // Writer API (used for explain, generic)
    function hasWriter() {
        const W = window.Writer;
        return !!(W && (isFn(W.create) || isFn(W.write)));
    }
    async function callWriterExplain(id, text) {
        const W = window.Writer;
        if (!W) throw new Error("Writer API not available");
        pingProgress(id, "Using Writer API (explain)");
        if (isFn(W.write)) {
            return String(await withTimeout(W.write({ instruction: "Explain clearly for a general audience.", text }), 20000, "Writer timed out"));
        }
        if (isFn(W.create)) {
            const inst = await withTimeout(W.create({ monitor: mkMonitor(id) }), 30000, "Writer creation timed out");
            if (isFn(inst.write)) return String(await withTimeout(inst.write({ instruction: "Explain clearly for a general audience.", text }), 20000, "Writer timed out"));
            if (isFn(inst.generate)) return String(await withTimeout(inst.generate({ task: "explain", text }), 20000, "Writer timed out"));
        }
        throw new Error("Writer API shape not supported");
    }

    async function callWriterGeneric(id, text) {
        const W = window.Writer;
        if (!W) throw new Error("Writer API not available");
        pingProgress(id, "Using Writer API (generic)");
        if (isFn(W.write)) {
            return String(await withTimeout(W.write({ instruction: "Process the text and return the best possible result.", text }), 20000, "Writer timed out"));
        }
        if (isFn(W.create)) {
            const inst = await withTimeout(W.create({ monitor: mkMonitor(id) }), 30000, "Writer creation timed out");
            if (isFn(inst.write)) return String(await withTimeout(inst.write({ instruction: "Process the text and return the best possible result.", text }), 20000, "Writer timed out"));
            if (isFn(inst.generate)) return String(await withTimeout(inst.generate({ task: "generic", text }), 20000, "Writer timed out"));
        }
        throw new Error("Writer API shape not supported");
    }

    // Minimal monitor factory for non-translation APIs (emit only 100%)
    function mkMonitor(id) {
        return (m) => attachMonitor(id, m, { verbose: false });
    }

    // --------------- Availability Ping ---------------

    window.addEventListener("message", async (event) => {
        if (event.source !== window) return;
        const data = event.data;
        if (!data || data.type !== NS_PING) return;

        // "Ready" if ANY on-device path exists for at least one op
        const ready =
            hasTranslator() ||
            hasSummarizer() ||
            hasProofreader() ||
            hasRewriter() ||
            hasWriter() ||
            (await hasPrompt());

        try { window.postMessage({ type: NS_READY, ready: !!ready }, "*"); } catch {}
    });

    // --------------- Main Request Handler ---------------

    window.addEventListener("message", async (event) => {
        if (event.source !== window) return;
        const data = event.data;
        if (!data || data.type !== NS_REQ) return;

        const { id, operation, text, targetLang } = data;
        const response = { type: NS_RES, id, ok: false };

        try {
            if (!text || typeof text !== "string" || !text.trim()) {
                throw new Error("No input text");
            }

            let output = null;

            switch (operation) {
                case "translate": {
                    // Prefer Translator API, then Prompt
                    try {
                        output = await callTranslator(id, text, /*src*/undefined, nvl(targetLang, "en"));
                    } catch {
                        // Prompt fallback
                        pingProgress(id, "Using Prompt API (translate)");
                        const s = await getPromptSession();
                        output = await withTimeout(
                            s.prompt(buildPrompt("translate", text, targetLang)),
                            30000,
                            "Prompt translate timed out"
                        );
                    }
                    break;
                }
                case "summarize": {
                    // Prefer Summarizer, then Prompt
                    try {
                        if (hasSummarizer()) {
                            output = await callSummarizer(id, text);
                        } else {
                            throw new Error("Summarizer not present");
                        }
                    } catch {
                        pingProgress(id, "Using Prompt API (summarize)");
                        const s = await getPromptSession();
                        output = await withTimeout(
                            s.prompt(buildPrompt("summarize", text)),
                            30000,
                            "Prompt summarize timed out"
                        );
                    }
                    break;
                }
                case "proofread": {
                    // Prefer Proofreader, then Rewriter/Writer, then Prompt
                    let ok = false;
                    if (hasProofreader()) {
                        try { output = await callProofreader(id, text); ok = true; } catch {}
                    }
                    if (!ok && hasRewriter()) {
                        try { pingProgress(id, "Using Rewriter API (proofread)"); output = await callRewriter(id, text); ok = true; } catch {}
                    }
                    if (!ok && hasWriter()) {
                        try { pingProgress(id, "Using Writer API (proofread)"); output = await callWriterGeneric(id, text); ok = true; } catch {}
                    }
                    if (!ok) {
                        pingProgress(id, "Using Prompt API (proofread)");
                        const s = await getPromptSession();
                        output = await withTimeout(
                            s.prompt(buildPrompt("proofread", text)),
                            30000,
                            "Prompt proofread timed out"
                        );
                    }
                    break;
                }
                case "rewrite": {
                    // Prefer Rewriter, then Writer, then Prompt
                    try {
                        if (hasRewriter()) {
                            output = await callRewriter(id, text);
                        } else if (hasWriter()) {
                            pingProgress(id, "Using Writer API (rewrite)");
                            const W = window.Writer;
                            if (isFn(W?.write)) {
                                output = String(await withTimeout(W.write({ instruction: "Rewrite to improve clarity and flow without changing meaning.", text }), 20000, "Writer timed out"));
                            } else if (isFn(W?.create)) {
                                const inst = await withTimeout(W.create({ monitor: mkMonitor(id) }), 30000, "Writer creation timed out");
                                if (isFn(inst.write)) {
                                    output = String(await withTimeout(inst.write({ instruction: "Rewrite to improve clarity and flow without changing meaning.", text }), 20000, "Writer timed out"));
                                } else if (isFn(inst.generate)) {
                                    output = String(await withTimeout(inst.generate({ task: "rewrite", text }), 20000, "Writer timed out"));
                                } else {
                                    throw new Error("Writer shape not supported");
                                }
                            } else {
                                throw new Error("Writer not present");
                            }
                        } else {
                            throw new Error("No rewriter/writer present");
                        }
                    } catch {
                        pingProgress(id, "Using Prompt API (rewrite)");
                        const s = await getPromptSession();
                        output = await withTimeout(
                            s.prompt(buildPrompt("rewrite", text)),
                            30000,
                            "Prompt rewrite timed out"
                        );
                    }
                    break;
                }
                case "explain": {
                    // Prefer Writer (explain), then Prompt
                    try {
                        if (hasWriter()) {
                            output = await callWriterExplain(id, text);
                        } else {
                            throw new Error("Writer not present");
                        }
                    } catch {
                        pingProgress(id, "Using Prompt API (explain)");
                        const s = await getPromptSession();
                        output = await withTimeout(
                            s.prompt(buildPrompt("explain", text)),
                            30000,
                            "Prompt explain timed out"
                        );
                    }
                    break;
                }
                case "comment_code": {
                    // Prompt only (no known task API)
                    pingProgress(id, "Using Prompt API (comment code)");
                    const s = await getPromptSession();
                    output = await withTimeout(
                        s.prompt(buildPrompt("comment_code", text)),
                        30000,
                        "Prompt comment_code timed out"
                    );
                    break;
                }
                default: {
                    // Unknown op: try Writer generic, then Prompt generic
                    let ok = false;
                    if (hasWriter()) {
                        try { output = await callWriterGeneric(id, text); ok = true; } catch {}
                    }
                    if (!ok) {
                        pingProgress(id, "Using Prompt API (generic)");
                        const s = await getPromptSession();
                        output = await withTimeout(
                            s.prompt(buildPrompt("generic", text)),
                            30000,
                            "Prompt generic timed out"
                        );
                    }
                }
            }

            response.ok = true;
            response.result = String(output ?? "");
        } catch (e) {
            response.ok = false;
            response.error = e?.message || String(e);
        }

        try { window.postMessage(response, "*"); } catch {}
    });
})();