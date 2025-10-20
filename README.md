# PageGenie Browser Extension

PageGenie is a Chrome/Edge (Manifest V3) extension that brings AI‑powered reading and writing tools to any web page. It prefers fast, private, on‑device AI when available and seamlessly falls back to your configured backend.

## Extension description (features, APIs used, problem it solves)

PageGenie helps you understand, translate, and improve web content without leaving the page. It adds a selection toolbar and an optional floating button to run actions like Summarize, Explain, Rewrite, Translate, Proofread, Save Note, and Quiz Me. It also handles PDFs through a dedicated Reader page so you get the same workflow everywhere.

- Problem we’re solving:
    - Reading on the web is noisy, slow, and fragmented. You often need to summarize long articles, translate to your language, or rewrite/proofread text before sharing. Many tools break on PDFs or require copy/pasting into separate apps, creating privacy and workflow friction.
    - PageGenie solves this by keeping actions in‑page, preferring on‑device AI for privacy and speed, and providing a consistent experience for HTML and PDFs. It also lets you save notes, get curated suggestions, and generate quizzes to retain what you read.

- APIs and technologies used:
    - Chrome Extension APIs: storage, runtime messaging, tabs, scripting, contextMenus, webNavigation
    - On‑device AI:
        - Task APIs (when available): Translator, Summarizer, Writer, Proofreader, Rewriter
        - Prompt API: `window.ai.createTextSession` as a local fallback
    - Backend (optional, Spring Boot): REST endpoints such as `/api/v1/ai`, `/api/notes`, `/api/v1/reading/*`, `/api/v1/quiz/*`
    - PDF processing: pdf.js (ESM builds `pdf.min.mjs` and `pdf.worker.min.mjs`) with a module Worker
    - Messaging and data: `window.postMessage`, Fetch API, Web Workers (module worker)
    - Storage & state: `chrome.storage.sync` (modes, language, auth token, UI toggles)
    - CSP‑safe module loading: static ESM import for pdf.js and `worker-src 'self'`

## Highlights

- Selection toolbar: Summarize, Explain, Rewrite, Translate, Save, Quiz Me
- Quick Fixes: Replace with Proofread, Translation Overlay, Insert Code Comments
- Floating Action Button (FAB): optional always‑visible button that opens a vertical menu of actions
- Full‑page confirmation: ask before processing the entire page when there’s no selection (configurable)
- Reader page for PDFs:
    - Uses pdf.js ESM builds (pdf.min.mjs/pdf.worker.min.mjs) with static module import (CSP‑safe) and module worker
    - Fallback inputs if the original PDF URL can’t be resolved (Choose file / Drag & drop / Load URL)
    - Action Bar to run Summarize/Explain/Rewrite/Translate/Proofread on the parsed text
- Library page (pages/reading.html): Notes, Suggestions, and Quizzes in one place
- Popup UX:
    - Signed‑in view: Welcome {name/username}, Reading Mode, Open Library, Logout
    - Signed‑out view: Login + Signup
    - Settings: Mode, toolbar toggle, floating button toggle, ask‑before‑full‑page toggle, target language
- Robust background messaging and fallbacks (including background arrayBuffer fetch for PDFs)

## Requirements

- Chrome or Edge with Manifest V3 support
- Optional backend API (Spring Boot) for online mode:
    - Default base URL: `http://localhost:8098`
- For local PDF files:
    - Enable “Allow access to file URLs” for this extension in `chrome://extensions`

## Install (Load Unpacked)

1) Clone or download this repository.
2) Open `chrome://extensions` and enable Developer mode.
3) Click “Load unpacked” and select the repo root.
4) After local changes, click “Reload” on the extension and refresh your test page(s).

## Configuration (Popup)

- Mode:
    - Auto: prefer on‑device, fall back to backend when needed
    - Offline only: use on‑device only
    - Online only: always use backend
- Show toolbar on selection: on/off
- Show floating button (always‑visible): on/off
- Ask before processing full page (no selection): on/off
- Target language: dropdown (en, hi, es, fr, de, zh, ja, ko, pt, ru, ar, it, bn, pa, mr, te, ta, ur, gu)
- Backend URL and auth handled by the popup and background

## Usage

- Select text on any page to reveal the toolbar and run:
    - Summarize, Explain, Rewrite, Translate, Save, Quiz Me
    - Quick Fixes: Replace with Proofread, Translation Overlay, Insert Code Comments
- No selection? Actions fall back to the whole page. If “Ask before processing full page” is on, you’ll be prompted to confirm.
- Floating button (if enabled): click the 🧞 button (bottom‑right) to open the vertical action menu.
- Process Full Document:
    - On PDFs: opens the Reader page. If the viewer’s URL can’t be resolved, use the Reader’s fallback inputs.
    - On HTML: summarizes the entire page.
- Reader page (pages/reader.html):
    - Parses PDF text via pdf.js ESM with module worker
    - Action Bar for Summarize/Explain/Rewrite/Translate/Proofread via backend
    - Language dropdown, copy/download/clear result
- Library page (pages/reading.html):
    - Notes from `/api/notes`
    - Suggestions from `/api/v1/reading/recent`
    - Quiz attempts from `/api/v1/quiz/attempts/recent`

## On‑device vs Cloud

- On‑device (preferred when available):
    - Via pageBridge (content/pageBridge.js): uses Translator task API or `window.ai` Prompt API
    - No hard input cap (you may still want to chunk very large inputs for responsiveness)
- Cloud (backend):
    - Only cloud requests are capped (default ~20k characters) to protect latency and server limits
    - Full text remains on device if on‑device path is used

## Troubleshooting

- Chrome PDF viewer URL: If Reader shows “Cannot read Chrome’s built‑in PDF viewer…”, use the fallback (Choose file / Drag & drop / Load URL) or open the original `.pdf` link.
- Local files: enable “Allow access to file URLs”. Drag & drop works without fetch permissions.
- CSP blocks pdf.js dynamic import: Reader uses a static ESM import and module worker. Ensure extension pages CSP allows `worker-src 'self'` and `'wasm-unsafe-eval'`.
- “Extension context invalidated”: refresh the page after reloading the extension.
- On‑device translation:
    - pageBridge uses the Translator API first, then `window.ai` with chunking and formatting preservation. Ensure your environment exposes either API.

## Roadmap

- More on‑device task API support and optimizations
- Optional chunking/streaming for very large inputs in offline mode

## License

MIT