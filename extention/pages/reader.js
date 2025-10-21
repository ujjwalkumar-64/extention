// Reader with static ESM import (CSP-safe), Language dropdown, and improved Result UI
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

const setStatus = (s, cls) => { statusEl.textContent = s; statusEl.className = cls || ""; };
const show = (text) => { outEl.textContent = text; };
const showResult = (text) => { resultSectionEl.style.display = ""; resultEl.textContent = text; };

let fullText = ""; // keeps full parsed text for action bar
let persona = "general";
let citeSources = false;

// Configure pdf.js worker (ESM build: use module Worker via workerPort)
const workerUrl = new URL("../libs/pdfjs/pdf.worker.min.mjs", import.meta.url);
pdfjsLib.GlobalWorkerOptions.workerPort = new Worker(workerUrl, { type: "module" });

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
        if (src.startsWith("file://")) {
            setStatus("Reading local file… (enable 'Allow access to file URLs' in chrome://extensions)", "warn");
        } else {
            setStatus("Fetching PDF…");
        }
        const ab = await fetchArrayBuffer(src);
        await processArrayBuffer(ab);
    } catch (e) {
        setStatus("Error: " + (e?.message || String(e)), "err");
        enableActions(false);
    }
}

function tryParseStructuredResult(text) {
    try {
        const obj = JSON.parse(text);
        if (obj && Array.isArray(obj.bullets) && Array.isArray(obj.citations)) return obj;
    } catch {}
    return null;
}
function renderStructuredResult({ bullets = [], citations = [] } = {}) {
    resultSectionEl.style.display = "";
    const lines = [];
    if (bullets.length) {
        lines.push("Summary:");
        bullets.forEach((b, i) => lines.push(`- ${b}`));
        lines.push("");
    }
    if (citations.length) {
        lines.push("References:");
        citations.forEach((c, i) => lines.push(`${i + 1}. ${c.title || c.url || "Source"}${c.url ? ` (${c.url})` : ""}${c.note ? ` — ${c.note}` : ""}`));
    }
    resultEl.textContent = lines.join("\n");
}

// Backend action via background (central auth + error handling)
async function runAction(action) {
    if (!fullText) { setStatus("No parsed text available. Load a PDF first.", "warn"); return; }
    const targetLang = (targetLangEl?.value || "en").trim();
    setStatus(`Running ${action}…`);
    resultSectionEl.style.display = "none";
    resultEl.textContent = "";

    try {
        const structured = (action === "summarize" || action === "explain");
        const resp = await chrome.runtime.sendMessage({
            type: "PAGEGENIE_PERSIST",
            endpoint: "/api/v1/ai",
            payload: { text: fullText, action, targetLang, persona, citeSources, structured } // NEW
        });

        if (!resp?.ok) throw new Error(resp?.error || "Backend error");
        const data = resp.data || {};
        const out = data.result || data.output || data?.data?.result || data?.data?.output || "";
        if (!out) throw new Error("Empty result from backend");

        const s = tryParseStructuredResult(out);
        if (s) renderStructuredResult(s);
        else { resultSectionEl.style.display = ""; resultEl.textContent = out; }

        setStatus("Done", "ok");
    } catch (e) {
        setStatus("Error: " + (e?.message || String(e)), "err");
    }
}

// Wire action buttons
buttons.forEach(btn => {
    btn.addEventListener("click", () => {
        const action = btn.getAttribute("data-action");
        if (action) runAction(action);
    });
});

// Persist the language selection to sync storage
targetLangEl?.addEventListener("change", async () => {
    try { await chrome.storage.sync.set({ targetLang: targetLangEl.value }); } catch {}
});

// Copy / Download / Clear for Result
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

// Fallback UI: file picker, URL loader, drag & drop
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

(async function main() {
    // Load default targetLang from settings if available
    try {
        const cfg = await chrome.storage.sync.get({ targetLang: "en" });
        if (cfg?.targetLang && targetLangEl) targetLangEl.value = cfg.targetLang;
        persona = cfg?.persona || "general";
        citeSources = !!cfg?.citeSources;
    } catch {}

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

    await processUrl(src);
})();