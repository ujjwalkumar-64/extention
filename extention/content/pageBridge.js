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

    // Normalize any API output to plain string
    function cleanProofreadText(s) {
        // Strip common debug prefixes the local API may add
        return String(s || "").replace(/^\s*(PROOFREAD(?:_TEXT)?|CORRECTED(?:_TEXT)?)\s*:\s*/i, "").trim();
    }

    function ensureText(out) {
        if (out == null) return "";
        if (typeof out === "string") return cleanProofreadText(out);

        if (typeof out === "object") {
            // Prefer the corrected fields first
            if (typeof out.correctedText === "string") return cleanProofreadText(out.correctedText);
            if (typeof out.correctedInput === "string") return cleanProofreadText(out.correctedInput);
            if (typeof out.text === "string") return cleanProofreadText(out.text);
            if (typeof out.result === "string") return cleanProofreadText(out.result);
            if (typeof out.output === "string") return cleanProofreadText(out.output);
            if (Array.isArray(out.choices) && typeof out.choices[0]?.text === "string") {
                return cleanProofreadText(out.choices[0].text);
            }
            if (Array.isArray(out.candidates)) {
                const parts = out.candidates[0]?.content?.parts;
                if (Array.isArray(parts)) {
                    const s = parts.map(p => (typeof p?.text === "string" ? p.text : "")).join("\n").trim();
                    if (s) return cleanProofreadText(s);
                }
            }
            try { return cleanProofreadText(JSON.stringify(out)); } catch { return cleanProofreadText(String(out)); }
        }

        return cleanProofreadText(String(out));
    }

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
                if (typeof window.ai.canCreateTextSession === "function") {
                    const status = await window.ai.canCreateTextSession();
                    if (status === "no") throw new Error("On-device AI not supported on this device");
                }
                const sess = await withTimeout(
                    window.ai.createTextSession({ temperature: 0.2 }),
                    30000,
                    "On-device model creation timed out"
                );
                if (!sess || typeof sess.prompt !== "function") {
                    throw new Error("Prompt API session not available");
                }
                return sess;
            } catch (e) {
                // Allow retry on next call
                promptSessionPromise = null;
                throw e;
            }
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

    // Progress monitor: Translator verbose (1..100), others minimal (only 100%)
    function attachMonitor(id, m, opts = {}) {
        const verbose = !!opts.verbose; // true for Translator, false for others
        let lastPct = -1;

        function toPercent(e) {
            const loaded = (e?.loaded ?? e?.detail?.loaded ?? e?.progress ?? null);
            const total  = (e?.total  ?? e?.detail?.total  ?? null);

            let ratio = null;

            if (typeof loaded === "number" && typeof total === "number" && total > 0) {
                ratio = loaded / total;              // bytes -> ratio
            } else if (typeof loaded === "number" && loaded >= 0 && loaded <= 1) {
                ratio = loaded;                      // already ratio
            } else if (typeof e?.progress === "number" && e.progress >= 0 && e.progress <= 1) {
                ratio = e.progress;                  // already ratio
            }

            if (ratio == null) return null;
            return Math.max(0, Math.min(100, Math.floor(ratio * 100)));
        }

        try {
            m.addEventListener("downloadprogress", (e) => {
                const pct = toPercent(e);
                if (pct == null) return;

                if (verbose) {
                    if (pct > lastPct) {
                        lastPct = pct;
                        pingProgress(id, `Downloading model ${pct}%`);
                    }
                } else {
                    if (pct >= 100 && lastPct < 100) {
                        lastPct = 100;
                        pingProgress(id, `Downloading model 100%`);
                    }
                }
            });

            m.addEventListener("statechange", () => {
                if (verbose) {
                    pingProgress(id, `State: ${m?.state || "unknown"}`);
                } else {
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

        try {
            translator = await tryCreate(nvl(srcLang, "auto"), target);
        } catch (e1) {
            try {
                translator = await tryCreate("en", target);
            } catch (e2) {
                try {
                    translator = await withTimeout(
                        window.Translator.create({
                            targetLanguage: target,
                            monitor: (m) => attachMonitor(id, m, { verbose: true })
                        }),
                        45000,
                        "Translator creation timed out"
                    );
                } catch (e3) {
                    throw e2;
                }
            }
        }

        const out = await withTimeout(
            translator.translate(text),
            30000,
            "Translator timed out"
        );
        return ensureText(out);
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
            const r = await withTimeout(S.summarize(text), 20000, "Summarizer timed out");
            return ensureText(r);
        }
        if (isFn(S.create)) {
            const inst = await withTimeout(S.create({ monitor: mkMonitor(id) }), 30000, "Summarizer creation timed out");
            if (isFn(inst.summarize)) {
                const r = await withTimeout(inst.summarize(text), 20000, "Summarizer timed out");
                return ensureText(r);
            }
            if (isFn(inst.generate)) {
                const r = await withTimeout(inst.generate({ task: "summarize", text }), 20000, "Summarizer timed out");
                return ensureText(r);
            }
        }
        throw new Error("Summarizer API shape not supported");
    }

    // Proofreader API
    function hasProofreader() {
        const P = window.Proofreader;
        return !!(P && (isFn(P.create) || isFn(P.proofread)));
    }
    // Replace your existing callProofreader with this version
    async function callProofreader(id, text) {
        const P = window.Proofreader;
        if (!P) throw new Error("Proofreader API not available");
        pingProgress(id, "Using Proofreader API");

        if (typeof P.proofread === "function") {
            const r = await withTimeout(P.proofread(text), 20000, "Proofreader timed out");
            return ensureText(r);
        }
        if (typeof P.create === "function") {
            const inst = await withTimeout(P.create({ monitor: mkMonitor(id) }), 30000, "Proofreader creation timed out");
            if (typeof inst.proofread === "function") {
                const r = await withTimeout(inst.proofread(text), 20000, "Proofreader timed out");
                return ensureText(r);
            }
            if (typeof inst.generate === "function") {
                const r = await withTimeout(inst.generate({ task: "proofread", text }), 20000, "Proofreader timed out");
                return ensureText(r);
            }
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
            const r = await withTimeout(R.rewrite(text), 20000, "Rewriter timed out");
            return ensureText(r);
        }
        if (isFn(R.create)) {
            const inst = await withTimeout(R.create({ monitor: mkMonitor(id) }), 30000, "Rewriter creation timed out");
            if (isFn(inst.rewrite)) {
                const r = await withTimeout(inst.rewrite(text), 20000, "Rewriter timed out");
                return ensureText(r);
            }
            if (isFn(inst.generate)) {
                const r = await withTimeout(inst.generate({ task: "rewrite", text }), 20000, "Rewriter timed out");
                return ensureText(r);
            }
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
            const r = await withTimeout(W.write({ instruction: "Explain clearly for a general audience.", text }), 20000, "Writer timed out");
            return ensureText(r);
        }
        if (isFn(W.create)) {
            const inst = await withTimeout(W.create({ monitor: mkMonitor(id) }), 30000, "Writer creation timed out");
            if (isFn(inst.write)) {
                const r = await withTimeout(inst.write({ instruction: "Explain clearly for a general audience.", text }), 20000, "Writer timed out");
                return ensureText(r);
            }
            if (isFn(inst.generate)) {
                const r = await withTimeout(inst.generate({ task: "explain", text }), 20000, "Writer timed out");
                return ensureText(r);
            }
        }
        throw new Error("Writer API shape not supported");
    }

    async function callWriterGeneric(id, text) {
        const W = window.Writer;
        if (!W) throw new Error("Writer API not available");
        pingProgress(id, "Using Writer API (generic)");
        if (isFn(W.write)) {
            const r = await withTimeout(W.write({ instruction: "Process the text and return the best possible result.", text }), 20000, "Writer timed out");
            return ensureText(r);
        }
        if (isFn(W.create)) {
            const inst = await withTimeout(W.create({ monitor: mkMonitor(id) }), 30000, "Writer creation timed out");
            if (isFn(inst.write)) {
                const r = await withTimeout(inst.write({ instruction: "Process the text and return the best possible result.", text }), 20000, "Writer timed out");
                return ensureText(r);
            }
            if (isFn(inst.generate)) {
                const r = await withTimeout(inst.generate({ task: "generic", text }), 20000, "Writer timed out");
                return ensureText(r);
            }
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
                        pingProgress(id, "Using Prompt API (translate)");
                        const s = await getPromptSession();
                        output = ensureText(
                            await withTimeout(
                                s.prompt(buildPrompt("translate", text, targetLang)),
                                30000,
                                "Prompt translate timed out"
                            )
                        );
                    }
                    break;
                }

                case "summarize": {
                    try {
                        if (hasSummarizer()) {
                            output = await callSummarizer(id, text);
                        } else {
                            throw new Error("Summarizer not present");
                        }
                    } catch {
                        pingProgress(id, "Using Prompt API (summarize)");
                        const s = await getPromptSession();
                        output = ensureText(
                            await withTimeout(
                                s.prompt(buildPrompt("summarize", text)),
                                30000,
                                "Prompt summarize timed out"
                            )
                        );
                    }
                    break;
                }

                // In your main request handler's "proofread" case, ensure the Prompt fallback also cleans the text
                case "proofread": {
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
                        const r = await withTimeout(
                            s.prompt(buildPrompt("proofread", text)),
                            30000,
                            "Prompt proofread timed out"
                        );
                        output = ensureText(r);
                    }
                    break;
                }

                case "rewrite": {
                    try {
                        if (hasRewriter()) {
                            output = await callRewriter(id, text);
                        } else if (hasWriter()) {
                            pingProgress(id, "Using Writer API (rewrite)");
                            const W = window.Writer;
                            if (isFn(W?.write)) {
                                output = ensureText(
                                    await withTimeout(W.write({ instruction: "Rewrite to improve clarity and flow without changing meaning.", text }), 20000, "Writer timed out")
                                );
                            } else if (isFn(W?.create)) {
                                const inst = await withTimeout(W.create({ monitor: mkMonitor(id) }), 30000, "Writer creation timed out");
                                if (isFn(inst.write)) {
                                    output = ensureText(
                                        await withTimeout(inst.write({ instruction: "Rewrite to improve clarity and flow without changing meaning.", text }), 20000, "Writer timed out")
                                    );
                                } else if (isFn(inst.generate)) {
                                    output = ensureText(
                                        await withTimeout(inst.generate({ task: "rewrite", text }), 20000, "Writer timed out")
                                    );
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
                        output = ensureText(
                            await withTimeout(
                                s.prompt(buildPrompt("rewrite", text)),
                                30000,
                                "Prompt rewrite timed out"
                            )
                        );
                    }
                    break;
                }

                case "explain": {
                    try {
                        if (hasWriter()) {
                            output = await callWriterExplain(id, text);
                        } else {
                            throw new Error("Writer not present");
                        }
                    } catch {
                        pingProgress(id, "Using Prompt API (explain)");
                        const s = await getPromptSession();
                        output = ensureText(
                            await withTimeout(
                                s.prompt(buildPrompt("explain", text)),
                                30000,
                                "Prompt explain timed out"
                            )
                        );
                    }
                    break;
                }

                case "comment_code": {
                    pingProgress(id, "Using Prompt API (comment code)");
                    const s = await getPromptSession();
                    output = ensureText(
                        await withTimeout(
                            s.prompt(buildPrompt("comment_code", text)),
                            30000,
                            "Prompt comment_code timed out"
                        )
                    );
                    break;
                }

                default: {
                    let ok = false;
                    if (hasWriter()) {
                        try { output = await callWriterGeneric(id, text); ok = true; } catch {}
                    }
                    if (!ok) {
                        pingProgress(id, "Using Prompt API (generic)");
                        const s = await getPromptSession();
                        output = ensureText(
                            await withTimeout(
                                s.prompt(buildPrompt("generic", text)),
                                30000,
                                "Prompt generic timed out"
                            )
                        );
                    }
                }
            }

            response.ok = true;
            response.result = ensureText(output);
        } catch (e) {
            response.ok = false;
            response.error = e?.message || String(e);
        }

        try { window.postMessage(response, "*"); } catch {}
    });
})();