// Runs in page context (NOT the content-script isolated world)
// Hardened on-device bridge that prefers task-specific local APIs
// (Translator, Proofreader, Summarizer, Rewriter, Writer) when available,
// falls back to Prompt API (window.ai.createTextSession), then lets the
// content script fall back to cloud/backend if none are available.
// Communicates with the content script using window.postMessage events:
// - PAGEGENIE_AI_PING     => replies with PAGEGENIE_AI_READY { ready: boolean }
// - PAGEGENIE_AI_PREWARM  => (optional) asks bridge to pre-create local sessions
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
    const NS_PREWARM = "PAGEGENIE_AI_PREWARM";

    // --------------- Utils ---------------

    // Throttle helper to avoid spamming UI (≈12 fps)
    function throttle(fn, ms) {
        let last = 0, queued = null, timer = null;
        return (...args) => {
            const now = Date.now();
            const run = () => { last = Date.now(); queued = null; timer = null; fn(...args); };
            if (now - last >= ms) {
                run();
            } else {
                queued = args;
                if (!timer) {
                    timer = setTimeout(() => {
                        if (queued) { fn(...queued); }
                        last = Date.now();
                        queued = null; timer = null;
                    }, ms - (now - last));
                }
            }
        };
    }

    const postProgress = throttle((payload) => {
        try { window.postMessage(payload, "*"); } catch {}
    }, 80);

    function pingProgress(id, msg) {
        postProgress({ type: NS_PROG, id, message: msg });
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
        // Strip common debug prefixes some local APIs may add
        return String(s || "").replace(/^\s*(PROOFREAD(?:_TEXT)?|CORRECTED(?:_TEXT)?)\s*:\s*/i, "").trim();
    }

    function ensureText(out) {
        if (out == null) return "";
        if (typeof out === "string") return cleanProofreadText(out);

        if (typeof out === "object") {
            // Prefer Proofreader doc fields first
            if (typeof out.corrected === "string") return cleanProofreadText(out.corrected);
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

    // Safer string coercion for inputs
    function toStringSafe(v) {
        if (v == null) return "";
        if (typeof v === "string") return v;
        try { if (typeof v === "object" && v.nodeType) return v.textContent || ""; } catch {}
        return String(v);
    }

    // Detect Writer “misfire” responses so we can fall back
    function isWriterMisfire(s) {
        const msg = String(s || "");
        return (
            /please provide the object/i.test(msg) ||
            /\[object Object\]/.test(msg) ||
            /not a valid object or instruction/i.test(msg)
        );
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
            case "summarize_full":
            case "process_full":
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

    // --------------- Caches (per-page) ---------------

    const translatorCache = new Map();  // key: `${src}|${dst}` -> instance
    const writerCache      = new Map(); // key: JSON.stringify(options)
    const rewriterCache    = new Map(); // key: JSON.stringify(options)
    const summarizerCache  = new Map(); // key: JSON.stringify(options)
    const proofreaderCache = new Map(); // key: JSON.stringify(options)

    function cacheGet(map, key) { return map.get(key); }
    function cacheSet(map, key, inst) { map.set(key, inst); return inst; }

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

    // Reuse progress for instances that emit 'downloadprogress' directly (Rewriter doc)
    function attachInstanceProgressMinimal(id, inst) {
        try {
            let done = false;
            inst.addEventListener?.("downloadprogress", (e) => {
                const loaded = (e?.loaded ?? e?.detail?.loaded ?? e?.progress ?? null);
                const total  = (e?.total  ?? e?.detail?.total  ?? null);
                let ratio = null;
                if (typeof loaded === "number" && typeof total === "number" && total > 0) ratio = loaded / total;
                else if (typeof loaded === "number" && loaded >= 0 && loaded <= 1) ratio = loaded;
                else if (typeof e?.progress === "number" && e.progress >= 0 && e.progress <= 1) ratio = e.progress;
                const pct = ratio == null ? null : Math.max(0, Math.min(100, Math.floor(ratio * 100)));
                if (pct != null && pct >= 100 && !done) {
                    done = true;
                    pingProgress(id, `Downloading model 100%`);
                }
            });
        } catch {}
    }

    // Cached Translator creation
    async function getTranslatorInstance(id, src, dst) {
        const key = `${src || "auto"}|${dst || "en"}`;
        const cached = cacheGet(translatorCache, key);
        if (cached) return cached;

        const inst = await withTimeout(
            window.Translator.create({
                sourceLanguage: src,
                targetLanguage: dst,
                monitor: (m) => attachMonitor(id, m, { verbose: true })
            }),
            45000,
            "Translator creation timed out"
        );
        return cacheSet(translatorCache, key, inst);
    }

    async function callTranslator(id, text, srcLang, dstLang) {
        if (!hasTranslator()) throw new Error("Translator API not available");
        pingProgress(id, "Using Translator API");

        const target = nvl(dstLang, "en");

        let translator;
        try {
            translator = await getTranslatorInstance(id, nvl(srcLang, "auto"), target);
        } catch (e1) {
            try {
                translator = await getTranslatorInstance(id, "en", target);
            } catch (e2) {
                translator = await getTranslatorInstance(id, undefined, target);
            }
        }

        const out = await withTimeout(
            translator.translate(text),
            30000,
            "Translator timed out"
        );
        return ensureText(out);
    }

    // ---------- Summarizer (doc-based) ----------
    async function summarizerAvailability() {
        try {
            if (!window.Summarizer?.availability) return "unknown";
            return await window.Summarizer.availability(); // "available" | "after-download" | "unavailable"
        } catch { return "unknown"; }
    }

    async function getSummarizer(id, options = {}) {
        if (!window.Summarizer?.create) throw new Error("Summarizer API not available");
        const avail = await summarizerAvailability();
        if (avail === "unavailable") throw new Error("Summarizer API unavailable");

        const baseOpts = {
            sharedContext: "Web page selection",
            type: "key-points",
            format: "markdown",
            length: "medium",
            monitor(m) { try { attachMonitor(id, m, { verbose: false }); } catch {} },
            ...options
        };
        const key = JSON.stringify(baseOpts);
        const cached = cacheGet(summarizerCache, key);
        if (cached) return cached;

        const inst = await withTimeout(
            window.Summarizer.create(baseOpts),
            45000,
            "Summarizer creation timed out"
        );
        return cacheSet(summarizerCache, key, inst);
    }

    async function callSummarizer(id, text) {
        if (!window.Summarizer) throw new Error("Summarizer API not available");
        pingProgress(id, "Using Summarizer API");
        const summarizer = await getSummarizer(id);
        const input = toStringSafe(text);
        const r = await withTimeout(
            summarizer.summarize(input, { context: "Summarize clearly for a general audience." }),
            20000,
            "Summarizer timed out"
        );
        return ensureText(r);
    }

    // ---------- Proofreader (doc-based) ----------
    async function proofreaderAvailability() {
        try {
            if (!window.Proofreader?.availability) return "unknown";
            const av = await (window.Proofreader.availability("downloadable"));
            // Normalize: true => available, false => unavailable; string passthrough
            if (av === true) return "available";
            if (av === false) return "unavailable";
            return String(av || "unknown");
        } catch { return "unknown"; }
    }

    async function getProofreader(id, options = {}) {
        if (!window.Proofreader?.create) throw new Error("Proofreader API not available");

        const avail = await proofreaderAvailability();
        if (avail === "unavailable") throw new Error("Proofreader API unavailable");

        const baseOpts = {
            expectedInputLanguages: ["en"],
            monitor(m) { try { attachMonitor(id, m, { verbose: false }); } catch {} },
            ...options
        };
        const key = JSON.stringify(baseOpts);
        const cached = cacheGet(proofreaderCache, key);
        if (cached) return cached;

        const inst = await withTimeout(
            window.Proofreader.create(baseOpts),
            45000,
            "Proofreader creation timed out"
        );
        return cacheSet(proofreaderCache, key, inst);
    }

    async function callProofreader(id, text) {
        if (!window.Proofreader) throw new Error("Proofreader API not available");
        pingProgress(id, "Using Proofreader API");
        const proofreader = await getProofreader(id);
        const input = toStringSafe(text);
        const r = await withTimeout(proofreader.proofread(input), 20000, "Proofreader timed out");
        // r.corrected is the fully corrected input per docs
        return ensureText(r);
    }

    // ---------- Rewriter (doc-based) ----------
    async function rewriterAvailability() {
        try {
            if (!window.Rewriter?.availability) return "unknown";
            return await window.Rewriter.availability(); // "available" | "after-download" | "unavailable"
        } catch { return "unknown"; }
    }

    async function getRewriter(id, options = {}) {
        if (!window.Rewriter?.create) throw new Error("Rewriter API not available");
        const avail = await rewriterAvailability();
        if (avail === "unavailable") throw new Error("Rewriter API unavailable");

        const baseOpts = {
            // sharedContext: optional, e.g., document.title
            tone: "neutral",
            format: "plain-text",
            length: "medium",
            ...options
        };
        const key = JSON.stringify(baseOpts);
        const cached = cacheGet(rewriterCache, key);
        if (cached) return cached;

        const inst = await withTimeout(
            window.Rewriter.create(baseOpts),
            45000,
            "Rewriter creation timed out"
        );
        // Doc: instance emits 'downloadprogress'
        attachInstanceProgressMinimal(id, inst);
        return cacheSet(rewriterCache, key, inst);
    }

    async function callRewriter(id, text) {
        if (!window.Rewriter) throw new Error("Rewriter API not available");
        pingProgress(id, "Using Rewriter API");
        const rewriter = await getRewriter(id);
        const input = toStringSafe(text);
        // Doc: rewrite(input, { context })
        const r = await withTimeout(
            rewriter.rewrite(input, { context: "Improve clarity and flow without changing meaning." }),
            20000,
            "Rewriter timed out"
        );
        return ensureText(r);
    }

    // ---------- Writer (doc-based) ----------
    async function writerAvailability() {
        try {
            if (!window.Writer?.availability) return "unknown";
            return await window.Writer.availability(); // "available" | "after-download" | "unavailable"
        } catch {
            return "unknown";
        }
    }

    async function getWriter(id, options = {}) {
        if (!window.Writer?.create) throw new Error("Writer API not available");

        const avail = await writerAvailability();
        if (avail === "unavailable") throw new Error("Writer API unavailable");

        const baseOpts = {
            tone: "neutral",
            format: "plain-text",
            length: "medium",
            ...options
        };
        const key = JSON.stringify(baseOpts);
        const cached = cacheGet(writerCache, key);
        if (cached) return cached;

        const created = await withTimeout(
            window.Writer.create(
                avail === "after-download"
                    ? { ...baseOpts, monitor(m) { try { attachMonitor(id, m, { verbose: false }); } catch {} } }
                    : baseOpts
            ),
            avail === "after-download" ? 45000 : 30000,
            "Writer creation timed out"
        );
        return cacheSet(writerCache, key, created);
    }

    async function callWriterExplain(id, text) {
        if (!window.Writer) throw new Error("Writer API not available");
        pingProgress(id, "Using Writer API (explain)");

        const writer = await getWriter(id, {
            tone: "neutral",
            format: "plain-text",
            length: "medium"
        });

        const input = toStringSafe(text);
        const prompt = `Explain the following text clearly for a general audience:\n\n${input}`;
        const ctx = { context: "General explanation" };

        const r = await withTimeout(writer.write(prompt, ctx), 20000, "Writer timed out");
        const s = ensureText(r);
        if (isWriterMisfire(s)) throw new Error("Writer misfire");
        return s;
    }

    async function callWriterGeneric(id, text) {
        if (!window.Writer) throw new Error("Writer API not available");
        pingProgress(id, "Using Writer API (generic)");

        const writer = await getWriter(id, {
            tone: "neutral",
            format: "plain-text",
            length: "medium"
        });

        const input = toStringSafe(text);
        const prompt = `Process the following text and return a concise, high-quality result:\n\n${input}`;
        const ctx = { context: "Generic transform" };

        const r = await withTimeout(writer.write(prompt, ctx), 20000, "Writer timed out");
        const s = ensureText(r);
        if (isWriterMisfire(s)) throw new Error("Writer misfire");
        return s;
    }

    // --------- PDF/full-document friendly map-reduce summarization ---------

    const CHUNK_MAX = 8000;     // characters per chunk (approx for on-device comfort)
    const CHUNK_OVERLAP = 200;  // characters overlap to preserve context across boundaries

    function splitIntoChunks(text, maxLen = CHUNK_MAX, overlap = CHUNK_OVERLAP) {
        const t = String(text || "");
        if (t.length <= maxLen) return [t];
        const chunks = [];
        let i = 0;
        while (i < t.length) {
            const end = Math.min(t.length, i + maxLen);
            const slice = t.slice(i, end);
            chunks.push(slice);
            if (end >= t.length) break;
            i = end - overlap; // move with overlap
            if (i < 0) i = 0;
        }
        return chunks;
    }

    // Use Summarizer if present; else Prompt; perform map (per chunk) then reduce (final)
    async function callSummarizeLarge(id, text) {
        const chunks = splitIntoChunks(text);
        if (chunks.length === 1) {
            // Single-chunk path: reuse normal summarize
            try {
                return await callSummarizer(id, chunks[0]);
            } catch {
                const s = await getPromptSession();
                return ensureText(await withTimeout(s.prompt(buildPrompt("summarize", chunks[0])), 30000, "Prompt summarize timed out"));
            }
        }

        pingProgress(id, `Large document detected • ${chunks.length} parts`);

        // Try Summarizer first
        let summaries = [];
        let used = "summarizer";
        try {
            const summarizer = await getSummarizer(id);
            for (let idx = 0; idx < chunks.length; idx++) {
                pingProgress(id, `Summarizing part ${idx + 1}/${chunks.length}`);
                const r = await withTimeout(
                    summarizer.summarize(chunks[idx], { context: "Summarize clearly for a general audience." }),
                    Math.max(30000, 12000 + chunks[idx].length), // adaptive
                    "Summarizer chunk timed out"
                );
                summaries.push(ensureText(r));
            }
        } catch {
            // Fallback to Prompt API
            used = "prompt";
            const s = await getPromptSession();
            summaries = [];
            for (let idx = 0; idx < chunks.length; idx++) {
                pingProgress(id, `Summarizing part ${idx + 1}/${chunks.length} (Prompt)`);
                const r = await withTimeout(
                    s.prompt(buildPrompt("summarize", chunks[idx])),
                    Math.max(30000, 12000 + chunks[idx].length),
                    "Prompt chunk timed out"
                );
                summaries.push(ensureText(r));
            }
        }

        // Reduce step: summarize the summaries
        const combined = summaries.map((p, i) => `Part ${i + 1}:\n${p}`).join("\n\n");
        pingProgress(id, "Combining parts into final summary");

        if (used === "summarizer") {
            try {
                const summarizer = await getSummarizer(id);
                const finalR = await withTimeout(
                    summarizer.summarize(combined, { context: "Combine the part summaries into one concise summary." }),
                    Math.max(30000, 8000 + combined.length),
                    "Summarizer reduce timed out"
                );
                return ensureText(finalR);
            } catch {
                // fall through to prompt
            }
        }

        const s = await getPromptSession();
        const final = await withTimeout(
            s.prompt(buildPrompt("summarize", combined)),
            Math.max(30000, 8000 + combined.length),
            "Prompt reduce timed out"
        );
        return ensureText(final);
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

        const writerAvail = await writerAvailability();
        const rewriterAvail = await rewriterAvailability();
        const summarizerAvail = await summarizerAvailability();
        const proofreaderAvail = await proofreaderAvailability();

        // "Ready" if ANY on-device path exists or is downloadable
        const ready =
            hasTranslator() ||
            rewriterAvail === "available" || rewriterAvail === "after-download" ||
            summarizerAvail === "available" || summarizerAvail === "after-download" ||
            proofreaderAvail === "available" || proofreaderAvail === "after-download" ||
            writerAvail === "available" || writerAvail === "after-download" ||
            (await hasPrompt());

        try { window.postMessage({ type: NS_READY, ready: !!ready }, "*"); } catch {}
    });

    // --------------- Prewarm Handler (optional) ---------------

    // Accepts: { type: NS_PREWARM, id?, want: [{ kind, opts? }, ...] }
    // kind ∈ "prompt"|"translator"|"writer"|"rewriter"|"summarizer"|"proofreader"
    window.addEventListener("message", async (event) => {
        if (event.source !== window) return;
        const data = event.data;
        if (!data || data.type !== NS_PREWARM) return;

        const id = data.id || "prewarm";
        const wants = Array.isArray(data.want) ? data.want : [];
        try {
            for (const w of wants) {
                try {
                    if (w.kind === "prompt") {
                        pingProgress(id, "Prewarming Prompt session…");
                        await getPromptSession();
                    } else if (w.kind === "translator") {
                        const dst = w.opts?.targetLanguage || "en";
                        const src = w.opts?.sourceLanguage ?? "auto";
                        pingProgress(id, `Prewarming Translator ${src}->${dst}…`);
                        await getTranslatorInstance(id, src, dst);
                    } else if (w.kind === "writer") {
                        pingProgress(id, "Prewarming Writer…");
                        await getWriter(id, w.opts || {});
                    } else if (w.kind === "rewriter") {
                        pingProgress(id, "Prewarming Rewriter…");
                        await getRewriter(id, w.opts || {});
                    } else if (w.kind === "summarizer") {
                        pingProgress(id, "Prewarming Summarizer…");
                        await getSummarizer(id, w.opts || {});
                    } else if (w.kind === "proofreader") {
                        pingProgress(id, "Prewarming Proofreader…");
                        await getProofreader(id, w.opts || {});
                    }
                } catch {}
            }
            pingProgress(id, "On-device prewarm complete");
        } catch {}
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
                        output = await callSummarizer(id, text);
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

                // New: full-document friendly summarization for PDFs/large texts
                case "summarize_full":
                case "process_full": {
                    output = await callSummarizeLarge(id, text);
                    break;
                }

                case "proofread": {
                    // Prefer Proofreader, then Rewriter/Writer, then Prompt
                    let ok = false;
                    try { output = await callProofreader(id, text); ok = true; } catch {}
                    if (!ok) {
                        try { pingProgress(id, "Using Rewriter API (proofread)"); output = await callRewriter(id, text); ok = true; } catch {}
                    }
                    if (!ok && (await writerAvailability()) !== "unavailable") {
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
                        output = await callRewriter(id, text);
                    } catch {
                        // Try Writer generic before Prompt
                        try {
                            if ((await writerAvailability()) !== "unavailable") {
                                pingProgress(id, "Using Writer API (rewrite)");
                                output = await callWriterGeneric(id, text);
                                break;
                            }
                        } catch {}
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
                        if ((await writerAvailability()) !== "unavailable") {
                            output = await callWriterExplain(id, text);
                        } else {
                            throw new Error("Writer not present");
                        }
                    } catch {
                        pingProgress(id, "Using Prompt API (explain)");
                        const s = await getPromptSession();
                        output = ensureText(
                            await withTimeout(
                                s.prompt(buildPrompt("explain", toStringSafe(text))),
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
                    if ((await writerAvailability()) !== "unavailable") {
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