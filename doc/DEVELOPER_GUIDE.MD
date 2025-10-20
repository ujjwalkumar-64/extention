# Developer Guide

This document covers architecture, key flows, settings, message contracts, and implementation details (Reader, Library, FAB, full‑page consent, cloud‑only limit, on‑device translation).

## Extension description (for listings)

PageGenie augments web pages and PDFs with AI actions to reduce cognitive load, language friction, and context switching. It provides an in‑page toolbar and an optional floating button to Summarize, Explain, Rewrite, Translate, Proofread, Save Notes, and generate Quizzes. PDFs get a dedicated Reader with the same actions.

- Problem: Reading and transforming content requires copying text into separate apps, which is slow, privacy‑unfriendly, and breaks flow. PDFs often break tooling. PageGenie keeps actions on the page, prefers on‑device AI for privacy, and unifies HTML/PDF workflows.
- APIs used:
    - Chrome: storage, runtime, tabs, scripting, contextMenus, webNavigation
    - On‑device AI: Translator/Summarizer/Writer/Proofreader/Rewriter task APIs (when available), and `window.ai.createTextSession`
    - Backend: Spring Boot REST (`/api/v1/ai`, `/api/notes`, `/api/v1/reading/*`, `/api/v1/quiz/*`)
    - PDF: pdf.js ESM (`pdf.min.mjs`, `pdf.worker.min.mjs`) with module Worker
    - Messaging: `window.postMessage`, Web Workers, Fetch API
    - Storage: `chrome.storage.sync` for mode, toggles, language, auth

## Architecture

- background.js (MV3 service worker)
    - Context menus, open Reader/Library, background fetch for arrayBuffer, auth bridge
- content/content.js (content world)
    - Selection toolbar; Quick‑Fix injections; Floating Action Button (FAB)
    - Full‑page confirmation dialog when there’s no selection
    - AI routing (on‑device first via pageBridge, then backend)
    - Cloud‑only input cap and operation logging
- content/pageBridge.js (page context)
    - On‑device AI access:
        - Translator task API if available
        - Fallback to `window.ai` Prompt API
    - Robust translation: chunking + formatting preservation + progress events
- UI pages
    - pages/reader.html|js|css — PDF Reader (ESM pdf.js) with Action Bar
    - pages/reading.html|js|css — Library (Notes/Suggestions/Quizzes)
    - popup/* — Auth, settings, Reading Mode, Open Library

## Settings (chrome.storage.sync)

- mode: `"auto" | "offline-only" | "online-only"`
- showToolbarOnSelection: boolean
- showFloatingButton: boolean
- showFullPageConfirm: boolean
- targetLang: string
- backendUrl: string
- apiToken: string
- tokenExp: number (ms since epoch)
- profileName: string
- profileUsername: string

Recommended defaults:
```json
{
  "mode": "auto",
  "showToolbarOnSelection": true,
  "showFloatingButton": false,
  "showFullPageConfirm": true,
  "targetLang": "en"
}
```

## Full‑page confirmation

- `ensureFullPageConsent(op, text, sourceHint)` before whole‑page processing
- `confirmFullPageModal(...)` with “Don’t ask again” → persists `showFullPageConfirm=false`
- Used by:
    - `runFullDocSummarize` (non‑PDF HTML)
    - `runSimpleOp` when strategy is `"full_html"`
    - `runTranslationOverlay` when no selection (whole page)

## Cloud‑only input cap

- `CLOUD_CHAR_LIMIT` (~20k by default)
- `applyCloudLimit(text)` in `runAIWithCloudLimit` before backend calls only
- On‑device gets full text (no hard cap)

## Floating Action Button (FAB)

- `ensureFloatingButton` / `removeFloatingButton` and a `MutationObserver` keep‑alive so it survives SPA DOM rewrites
- Controlled by `showFloatingButton`
- Menu actions: summarize, explain, rewrite, translate, process full, save note, concept drift, quiz

## Reader (PDF)

- ESM pdf.js packaged under `libs/pdfjs/` and listed in `web_accessible_resources`
- Reader code:
  ```js
  import * as pdfjsLib from "../libs/pdfjs/pdf.min.mjs";
  pdfjsLib.GlobalWorkerOptions.workerPort = new Worker(
    new URL("../libs/pdfjs/pdf.worker.min.mjs", import.meta.url),
    { type: "module" }
  );
  ```
- Fallback UI (Choose file, Drag & drop, Load URL) when `src` is missing or viewer URL can’t be resolved
- Action Bar runs backend AI on parsed text; language dropdown; copy/download/clear

## Library (Hub)

- Fetches using `backendUrl` and `apiToken` from storage:
    - `GET /api/v1/auth/me` → profile
    - `GET /api/v1/quiz/attempts/recent` → attempts
    - `GET /api/notes` → notes
    - `GET /api/v1/reading/recent` → suggestions
- Suggestions UI mirrors notes (title link + timestamp + actions + content card)

## Popup

- Signed‑in: Welcome {name/username}, Reading Mode, Open Library, Logout (signup hidden)
- Signed‑out: Login + Signup
- Settings: mode, showToolbarOnSelection, showFloatingButton, showFullPageConfirm, targetLang

## On‑device translation (pageBridge)

- Prefer `Translator.create({ targetLanguage })` + `translator.translate(text)` with chunking
- Fallback `window.ai.createTextSession()` with formatting‑preserving prompt
- Progress events via `PAGEGENIE_AI_PROGRESS`

## AI routing & messaging

- content ↔ page (pageBridge) via postMessage:
    - `PAGEGENIE_AI_PING/READY`, `PAGEGENIE_AI_REQUEST/RESPONSE`, `PAGEGENIE_AI_PROGRESS`, `PAGEGENIE_AI_PREWARM`
- content ↔ background:
    - `PAGEGENIE_PERSIST` (backend), `PAGEGENIE_OPEN_READER`, `PAGEGENIE_OPEN_QUIZ`, auth messages

## Manifest & CSP

- `web_accessible_resources`: pages/*, libs/pdfjs/*.mjs, content/pageBridge.js
- CSP for extension pages:
    - `script-src 'self' 'wasm-unsafe-eval'; worker-src 'self'; object-src 'self'`
- Permissions:
    - `storage`, `activeTab`, `scripting`, `contextMenus`, `tabs`, `webNavigation`
- `host_permissions`: `<all_urls>`

## Testing checklist

- Toolbar appears/hides correctly; actions run with/without selection
- FAB shows, opens menu, survives SPA DOM rewrites; toggle works from popup
- Full‑page confirmation appears; “don’t ask again” persists
- Reader parses PDFs via ESM, shows Action Bar, handles fallback inputs
- Library loads profile/notes/suggestions/quizzes; empty states render
- On‑device translation works (Task API or `window.ai`); cloud fallback works with cap
- Local file PDFs work with “Allow access to file URLs”; drag & drop works

## Known limitations

- Restricted pages (Chrome Web Store, `chrome://*`, built‑in PDF viewer) block content scripts
- Some viewer tabs don’t expose original PDF URL; use Reader fallback inputs
- Backend routes may differ; adjust `pages/reading.js` accordingly