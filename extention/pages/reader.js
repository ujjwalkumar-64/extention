// Reader with on-device routing (task APIs -> Prompt) and cloud fallback,
// plus Quiz generation that mirrors content.js behavior (create quiz, open quiz UI by id, log op).
// Also keeps Target Language synced with Settings

import * as pdfjsLib from "../libs/pdfjs/pdf.min.mjs";

const statusEl = document.getElementById("status");
const outEl = document.getElementById("output");
const fallbackEl = document.getElementById("fallback");
const fileInput = document.getElementById("fileInput");
const urlInput = document.getElementById("urlInput");
const loadUrlBtn = document.getElementById("loadUrlBtn");
const dropzone = document.getElementById("dropzone");

const actionsEl = document.getElementById("actions");
const buttons = Array.from(document.querySelectorAll(".pg-act"));
const targetLangEl = document.getElementById("targetLang");

const resultSectionEl = document.getElementById("resultSection");
const resultEl = document.getElementById("result");
const copyBtn = document.getElementById("copyBtn");
const downloadBtn = document.getElementById("downloadBtn");
const clearBtn = document.getElementById("clearBtn");

// ---------- State ----------
let fullText = "";
let persona = "general";
let citeSources = false;
let mode = "auto";
let targetLangSetting = "en"; // always synced with Settings

const setStatus = (s, cls) => { statusEl.textContent = s; statusEl.className = "status " + (cls || ""); };
const show = (text) => { outEl.textContent = text; };
const showResult = () => { resultSectionEl.style.display = ""; };
const getTargetLang = () => (targetLangEl?.value?.trim() || targetLangSetting || "en");

// ---------- Throttled progress ----------
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
const postProgress = throttle((msg) => setStatus(msg), 80);
function pingProgress(_id, msg) { postProgress(msg); }

// ---------- ESM pdf.js worker ----------
const workerUrl = new URL("../libs/pdfjs/pdf.worker.min.mjs", import.meta.url);
pdfjsLib.GlobalWorkerOptions.workerPort = new Worker(workerUrl, { type: "module" });

// ---------- Helpers ----------
function withTimeout(promise, ms, message = "Timed out") {
    return new Promise((resolve, reject) => {
        const t = setTimeout(() => reject(new Error(message)), ms);
        promise.then(
            v => { clearTimeout(t); resolve(v); },
            e => { clearTimeout(t); reject(e); }
        );
    });
}
function toStringSafe(v) {
    if (v == null) return "";
    if (typeof v === "string") return v;
    try { if (typeof v === "object" && v.nodeType) return v.textContent || ""; } catch {}
    return String(v);
}
function cleanProofreadText(s) {
    return String(s || "").replace(/^\s*(PROOFREAD(?:_TEXT)?|CORRECTED(?:_TEXT)?)\s*:\s*/i, "").trim();
}
function ensureText(out) {
    if (out == null) return "";
    if (typeof out === "string") return cleanProofreadText(out);
    if (typeof out === "object") {
        if (typeof out.corrected === "string") return cleanProofreadText(out.corrected);
        if (typeof out.correctedText === "string") return cleanProofreadText(out.correctedText);
        if (typeof out.correctedInput === "string") return cleanProofreadText(out.correctedInput);
        if (typeof out.text === "string") return cleanProofreadText(out.text);
        if (typeof out.result === "string") return cleanProofreadText(out.result);
        if (typeof out.output === "string") return cleanProofreadText(out.output);
        if (Array.isArray(out.choices) && typeof out.choices[0]?.text === "string") return cleanProofreadText(out.choices[0].text);
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
function isWriterMisfire(s) {
    const msg = String(s || "");
    return /please provide the object/i.test(msg) || /\[object Object\]/.test(msg) || /not a valid object or instruction/i.test(msg);
}

// ---------- Persona ----------
function personaCtx(p, operation) {
    const x = String(p || "general").toLowerCase();
    if (operation === "summarize") {
        switch (x) {
            case "researcher": return "Summarize for a researcher: be precise, avoid hype, highlight evidence and key figures.";
            case "student":    return "Summarize for a student: simple language, key points, one short example if useful.";
            case "editor":     return "Summarize for an editor: very concise, clear, actionable takeaways.";
            default:           return "Summarize clearly for a general audience.";
        }
    } else if (operation === "explain") {
        switch (x) {
            case "researcher": return "Explain for a researcher: be precise, avoid hype, note assumptions and limitations.";
            case "student":    return "Explain for a student: simple language, step-by-step, one short example.";
            case "editor":     return "Explain for an editor: prioritize clarity and structure; remove jargon.";
            default:           return "Explain clearly for a general audience.";
        }
    }
    return "Be clear and concise.";
}

// ---------- PDF helpers ----------
function isChromePdfViewerUrl(url) {
    return typeof url === "string" &&
        url.startsWith("chrome-extension://mhjfbmdgcfjbbpaeojofohoefgiehjai/");
}
function looksLikePdfUrl(u) {
    return typeof u === "string" && /\.pdf($|[\?#])/i.test(u);
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

async function fetchArrayBuffer(srcUrl) {
    try {
        const res = await fetch(srcUrl, { credentials: "include" });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return await res.arrayBuffer();
    } catch {
        const r = await chrome.runtime.sendMessage({ type: "PAGEGENIE_FETCH_ARRAYBUFFER", url: srcUrl }).catch(() => null);
        if (r?.ok && r.base64) {
            const bin = atob(r.base64);
            const bytes = new Uint8Array(bin.length);
            for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
            return bytes.buffer;
        }
        throw new Error(r?.error || "Fetch failed");
    }
}

async function extractPdfTextFromArrayBuffer(ab) {
    const pdf = await pdfjsLib.getDocument({ data: ab }).promise;
    const parts = [];
    for (let i = 1; i <= pdf.numPages; i++) {
        try {
            const page = await pdf.getPage(i);
            const content = await page.getTextContent();
            const txt = (content.items || [])
                .map(it => typeof it.str === "string" ? it.str : "")
                .filter(Boolean)
                .join(" ")
                .replace(/\s+/g, " ")
                .trim();
            if (txt) parts.push(txt);
        } catch {}
    }
    return parts.join("\n\n");
}

function enableActions(enable) {
    actionsEl.style.display = enable ? "" : "none";
    buttons.forEach(b => b.disabled = !enable);
}

async function processArrayBuffer(ab) {
    try {
        setStatus("Parsing PDF…");
        fullText = await extractPdfTextFromArrayBuffer(ab);
        show(fullText.slice(0, 200000)); // preview
        setStatus("Parsed text shown. You can run actions now.", "ok");
        enableActions(true);
    } catch (e) {
        setStatus("Error: " + (e?.message || String(e)), "err");
        enableActions(false);
    }
}

async function processUrl(src) {
    try {
        if (!src) throw new Error("No URL provided");
        if (isChromePdfViewerUrl(src)) {
            const inner = extractPdfUrlFromViewer(src);
            if (!inner) throw new Error("Underlying PDF URL not found in viewer link.");
            src = inner;
        }
        if (src.startsWith("file://")) setStatus("Reading local file… (enable 'Allow access to file URLs' in chrome://extensions)", "warn");
        else setStatus("Fetching PDF…");
        const ab = await fetchArrayBuffer(src);
        await processArrayBuffer(ab);
    } catch (e) {
        setStatus("Error: " + (e?.message || String(e)), "err");
        enableActions(false);
    }
}

// ---------- Structured parsing + rendering ----------
function extractFirstJsonObject(text) {
    if (typeof text !== "string") return null;
    let s = text.trim();
    if (s.startsWith("```")) {
        const nl = s.indexOf("\n");
        if (nl !== -1) s = s.slice(nl + 1);
        const last = s.lastIndexOf("```");
        if (last !== -1) s = s.slice(0, last);
        s = s.trim();
    }
    try { return JSON.parse(s); } catch {}
    try { const once = JSON.parse(s); if (typeof once === "string") return JSON.parse(once); } catch {}
    const start = s.indexOf("{"); if (start === -1) return null;
    let brace = 0;
    for (let i = start; i < s.length; i++) {
        const ch = s[i];
        if (ch === "{") brace++;
        else if (ch === "}") { brace--; if (brace === 0) { try { return JSON.parse(s.slice(start, i + 1)); } catch {} break; } }
    }
    return null;
}

function normalizeStructured(obj) {
    if (!obj || typeof obj !== "object") return null;
    let bullets = Array.isArray(obj.bullets) ? obj.bullets : (Array.isArray(obj.points) ? obj.points : []);
    if (!Array.isArray(bullets)) bullets = [];
    let citations = Array.isArray(obj.citations) ? obj.citations : (Array.isArray(obj.references) ? obj.references : []);
    citations = (citations || []).map(c => {
        if (c && typeof c === "object") return { url: c.url || c.href || "", title: c.title || c.text || c.url || c.href || "Source", note: c.note || c.reason || "" };
        const s = String(c || ""); return { url: s.startsWith("http") ? s : "", title: s || "Source" };
    });
    if (!bullets.length) return null;
    return { bullets: bullets.map(x => String(x ?? "")).filter(Boolean), citations };
}

function renderStructuredIfAny(rawText, usedPath /* "device" | "cloud" | "" */) {
    const obj = normalizeStructured(extractFirstJsonObject(rawText));
    resultEl.innerHTML = "";

    if (!obj) {
        const pre = document.createElement("pre");
        pre.style.whiteSpace = "pre-wrap";
        pre.textContent = String(rawText ?? "");
        resultEl.appendChild(pre);
    } else {
        const h1 = document.createElement("div");
        h1.className = "pg-section-title";
        h1.textContent = "Summary";
        resultEl.appendChild(h1);

        const ul = document.createElement("ul");
        ul.className = "pg-summary-bullets";
        obj.bullets.forEach(b => {
            const li = document.createElement("li");
            li.textContent = b;
            ul.appendChild(li);
        });
        resultEl.appendChild(ul);

        if (obj.citations && obj.citations.length) {
            const box = document.createElement("div");
            box.className = "pg-references";

            const h2 = document.createElement("div");
            h2.className = "pg-section-title";
            h2.textContent = "References";
            box.appendChild(h2);

            const ol = document.createElement("ol");
            obj.citations.forEach((c) => {
                const li = document.createElement("li");
                if (c.url) {
                    const a = document.createElement("a");
                    a.href = c.url; a.target = "_blank"; a.rel = "noopener noreferrer";
                    a.textContent = c.title || c.url;
                    li.appendChild(a);
                } else {
                    li.textContent = c.title || "Source";
                }
                if (c.note) {
                    const span = document.createElement("span");
                    span.className = "pg-ref-note";
                    span.textContent = " — " + c.note;
                    li.appendChild(span);
                }
                ol.appendChild(li);
            });
            box.appendChild(ol);
            resultEl.appendChild(box);
        }
    }

    const footer = document.createElement("div");
    footer.className = "pg-footer-tip";
    footer.textContent = `Tip: On‑device when available; falls back to cloud. Used: ${usedPath === "device" ? "On‑device" : (usedPath === "cloud" ? "Cloud" : "Auto")}`;
    resultEl.appendChild(footer);
}

// ---------- On-device: task APIs + Prompt ----------
async function hasPrompt() {
    try { return !!(window.ai && typeof window.ai.createTextSession === "function"); } catch { return false; }
}
let promptSessionPromise = null;
async function getPromptSession() {
    if (!(window.ai && typeof window.ai.createTextSession === "function")) throw new Error("Prompt API unavailable");
    if (promptSessionPromise) return promptSessionPromise;
    promptSessionPromise = (async () => {
        try {
            if (typeof window.ai.canCreateTextSession === "function") {
                const status = await window.ai.canCreateTextSession();
                if (status === "no") throw new Error("On-device AI not supported on this device");
            }
            const sess = await withTimeout(window.ai.createTextSession({ temperature: 0.2 }), 30000, "On-device model creation timed out");
            if (!sess || typeof sess.prompt !== "function") throw new Error("Prompt API session not available");
            return sess;
        } catch (e) { promptSessionPromise = null; throw e; }
    })();
    return promptSessionPromise;
}

async function callTranslator(text, dst) {
    if (!window.Translator?.create) throw new Error("Translator API not available");
    const inst = await window.Translator.create({ sourceLanguage: "auto", targetLanguage: dst || "en" });
    const out = await withTimeout(inst.translate(text), 30000, "Translator timed out");
    return ensureText(out);
}
async function callSummarizerPersona(text, p) {
    if (!window.Summarizer?.create) throw new Error("Summarizer API not available");
    const s = await window.Summarizer.create({ type: "key-points", format: "markdown", length: "medium" });
    const out = await withTimeout(s.summarize(text, { context: personaCtx(p, "summarize") }), 20000, "Summarizer timed out");
    return ensureText(out);
}
async function callRewriter(text) {
    if (!window.Rewriter?.create) throw new Error("Rewriter API not available");
    const r = await window.Rewriter.create({ tone: "neutral", format: "plain-text", length: "medium" });
    const out = await withTimeout(r.rewrite(text, { context: "Improve clarity and flow without changing meaning." }), 20000, "Rewriter timed out");
    return ensureText(out);
}
async function callProofreader(text) {
    if (!window.Proofreader?.create) throw new Error("Proofreader API not available");
    const p = await window.Proofreader.create({ expectedInputLanguages: ["en"] });
    const out = await withTimeout(p.proofread(text), 20000, "Proofreader timed out");
    return ensureText(out);
}

// ---------- Cloud ----------
async function callBackendAi(action, text, targetLang, persona, citeSources, structured) {
    const resp = await chrome.runtime.sendMessage({
        type: "PAGEGENIE_PERSIST",
        endpoint: "/api/v1/ai",
        payload: { text, action, targetLang, persona, citeSources, structured }
    });
    if (!resp?.ok) throw new Error(resp?.error || "Backend error");
    const data = resp.data || {};
    const out = data.result || data.output || data?.data?.result || data?.data?.output || "";
    if (!out) throw new Error("Empty result from backend");
    return out;
}

// Quiz create -> open by id -> log (mirrors content.js)
async function createQuizAndOpen({ text, sourceUrl, title }) {
    // Step 1: create quiz
    setStatus("Generating quiz from document…");
    setStatus("Using cloud AI to generate quiz");
    const resp = await chrome.runtime.sendMessage({
        type: "PAGEGENIE_PERSIST",
        endpoint: "/api/v1/quiz/generate-from-text",
        payload: { text, sourceUrl, title }
    });
    if (!resp?.ok) throw new Error(resp?.error || "Quiz generation failed");
    const data = resp.data || {};
    const quizId = data.id ?? data.quizId ?? data?.data?.id ?? data?.data?.quizId;
    if (!quizId) throw new Error("Quiz ID missing in response");

    // Step 2: open quiz UI
    setStatus("Quiz ready", "ok");
    chrome.runtime.sendMessage({ type: "PAGEGENIE_OPEN_QUIZ", quizId }, () => {
        if (chrome.runtime.lastError) {
            try {
                window.open(chrome.runtime.getURL(`quiz/quiz.html?id=${encodeURIComponent(quizId)}`), "_blank");
            } catch {}
        }
    });

    // Step 3: log op (best-effort)
    try {
        await chrome.runtime.sendMessage({
            type: "PAGEGENIE_PERSIST",
            endpoint: "/api/ops/log",
            payload: {
                type: "quiz_from_reader",
                source: sourceUrl,
                input_len: text.length,
                output: String(quizId),
                strategy: "reader_full_doc",
                ts: Date.now()
            }
        });
    } catch {}
}

// ---------- Action runner ----------
async function runAction(action) {
    if (!fullText) { setStatus("No parsed text available. Load a PDF first.", "warn"); return; }
    const targetLang = getTargetLang();
    setStatus(`Running ${action}…`);
    if (action !== "quiz") { // quiz flow opens a new page; result pane not used
        resultSectionEl.style.display = "none";
        resultEl.textContent = "";
    }

    try {
        if (action === "quiz") {
            if (mode === "offline-only") throw new Error("Quiz generation requires cloud (disable Offline-only).");
            await createQuizAndOpen({
                text: fullText,
                sourceUrl: location.href,
                title: document.title?.slice(0, 120) || "Document"
            });
            return;
        }

        let usedPath = "";
        let output = "";

        // Try on-device (or Prompt) if allowed
        if (mode !== "online-only") {
            try {
                if (action === "summarize") {
                    output = await callSummarizerPersona(fullText, persona);
                } else if (action === "translate") {
                    output = await callTranslator(fullText, targetLang);
                } else if (action === "rewrite") {
                    output = await callRewriter(fullText);
                } else if (action === "proofread") {
                    output = await callProofreader(fullText);
                } else if (action === "explain") {
                    const sess = await getPromptSession(); // local Prompt
                    output = ensureText(await withTimeout(
                        sess.prompt(`${personaCtx(persona, "explain")}\n\n---\n${fullText}\n---`),
                        30000,
                        "Prompt explain timed out"
                    ));
                }
                usedPath = "device";
            } catch {
                // fall through to cloud
            }
        }

        // Cloud fallback
        if (!output) {
            if (mode === "offline-only") throw new Error("On-device AI unavailable for this action (Offline-only mode).");
            const structured = (action === "summarize" || action === "explain");
            output = await callBackendAi(action, fullText, targetLang, persona, citeSources, structured);
            usedPath = "cloud";
        }

        // Render
        if (action === "summarize" || action === "explain") {
            renderStructuredIfAny(output, usedPath);
        } else {
            resultEl.textContent = output;
        }
        showResult();
        setStatus("Done", "ok");
    } catch (e) {
        setStatus("Error: " + (e?.message || String(e)), "err");
    }
}

// ---------- Wire UI ----------
buttons.forEach(btn => {
    btn.addEventListener("click", () => {
        const action = btn.getAttribute("data-action");
        if (action) runAction(action);
    });
});

// Persist language selection + live-sync with Settings
targetLangEl?.addEventListener("change", async () => {
    try {
        targetLangSetting = targetLangEl.value;
        await chrome.storage.sync.set({ targetLang: targetLangSetting });
    } catch {}
});
chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== "sync") return;
    if (changes.targetLang) {
        targetLangSetting = changes.targetLang.newValue || "en";
        if (targetLangEl) targetLangEl.value = targetLangSetting;
    }
    if (changes.persona) persona = changes.persona.newValue || "general";
    if (changes.citeSources) citeSources = !!changes.citeSources.newValue;
    if (changes.mode) mode = changes.mode.newValue || "auto";
});

// Result utilities
copyBtn?.addEventListener("click", async () => {
    try {
        await navigator.clipboard.writeText(resultEl.textContent || "");
        setStatus("Copied result to clipboard", "ok");
    } catch (e) {
        setStatus("Copy failed: " + (e?.message || String(e)), "err");
    }
});
downloadBtn?.addEventListener("click", () => {
    const txt = resultEl.textContent || "";
    if (!txt) { setStatus("Nothing to download", "warn"); return; }
    const blob = new Blob([txt], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    const ts = new Date().toISOString().slice(0,19).replace(/[:T]/g,"-");
    a.href = url;
    a.download = `pagegenie-result-${ts}.txt`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
    setStatus("Downloaded result", "ok");
});
clearBtn?.addEventListener("click", () => {
    resultEl.textContent = "";
    resultSectionEl.style.display = "none";
    setStatus("Cleared result", "ok");
});

// Fallback UI
function enableFallbackUI() {
    if (!fallbackEl) return;
    fallbackEl.style.display = "";
    fileInput?.addEventListener("change", async (e) => {
        const f = e.target?.files?.[0];
        if (!f) return;
        try {
            setStatus("Reading selected PDF…");
            const ab = await f.arrayBuffer();
            await processArrayBuffer(ab);
        } catch (err) {
            setStatus("Error: " + (err?.message || String(err)), "err");
        }
    });
    loadUrlBtn?.addEventListener("click", () => {
        const url = (urlInput?.value || "").trim();
        if (!url) return setStatus("Enter a PDF URL first", "warn");
        processUrl(url);
    });
    dropzone?.addEventListener("dragover", (e) => { e.preventDefault(); dropzone.style.background = "#121521"; });
    dropzone?.addEventListener("dragleave", () => { dropzone.style.background = "transparent"; });
    dropzone?.addEventListener("drop", async (e) => {
        e.preventDefault();
        dropzone.style.background = "transparent";
        const f = e.dataTransfer?.files?.[0];
        if (!f) return;
        if (!/\.pdf$/i.test(f.name)) {
            setStatus("Only .pdf files are supported", "warn");
            return;
        }
        try {
            setStatus("Reading dropped PDF…");
            const ab = await f.arrayBuffer();
            await processArrayBuffer(ab);
        } catch (err) {
            setStatus("Error: " + (err?.message || String(err)), "err");
        }
    });
}

// ---------- Init ----------
(function init() {
    chrome.storage.sync.get({
        targetLang: "en",
        persona: "general",
        citeSources: false,
        mode: "auto"
    }, (cfg) => {
        targetLangSetting = cfg?.targetLang || "en";
        if (targetLangEl) targetLangEl.value = targetLangSetting;
        persona = cfg?.persona || "general";
        citeSources = !!cfg?.citeSources;
        mode = cfg?.mode || "auto";
    });

    const u = new URL(location.href);
    let src = u.searchParams.get("src") || "";

    if (!src) {
        setStatus("No PDF URL provided. Use one of the options below.", "warn");
        enableFallbackUI();
        enableActions(false);
        return;
    }

    if (isChromePdfViewerUrl(src)) {
        const inner = extractPdfUrlFromViewer(src);
        if (inner) src = inner;
        else {
            setStatus("Cannot read Chrome's built-in PDF viewer page. Underlying PDF URL not found. Use one of the options below.", "warn");
            enableFallbackUI();
            enableActions(false);
            return;
        }
    }

    processUrl(src);
})();