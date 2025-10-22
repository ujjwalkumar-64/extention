# Developer Guide

This document covers the extension architecture, key modules, backend endpoints, and how to add features safely.

## Problem definition

Users need fast, trustworthy reading assistance without losing privacy:
- Summaries and explanations inline, not in another app
- Consistent, trustworthy citations—even when the original page lacks them
- Translations, proofreading, rewrites, and quick research actions that work on any page (and PDFs) with minimal friction
- A privacy‑first default (on‑device), with a resilient cloud path when needed
- A personal Library to organize saved notes, suggested readings, and quizzes

## APIs used (overview)

- Google Chrome AI Task APIs (on‑device; built into Chrome)
    - Summarizer, Translator, Proofreader, Rewriter, Writer
    - Prompt API (safety net within Chrome for generic prompts or map‑reduce fallbacks)
- Google AI (Gemini)
    - Cloud fallback for summarize/explain/etc. when on‑device is unavailable or restricted
    - Returns structured text the client robustly parses (bullets/citations)
- Google Custom Search JSON API (Programmable Search / CSE)
    - “Find sources” endpoint; dedup results by domain + normalized title
    - Subject‑aware query planning and short snippet “reason” strings
- Chrome Extensions APIs
    - storage.sync (persistent settings like `mode`, `persona`, `targetLang`, `citeSources`)
    - runtime messaging (content ↔ background ↔ page bridge)
    - contextMenus/commands (actions and hotkeys)
    - tabs/scripting (Reader open, page bridge injection)

## On‑device vs Cloud routing (details)

- Modes
    - Auto: device → cloud fallback.
    - Offline‑only: device only; block cloud and disable auto web search (manual “Find sources” still works).
    - Online‑only: cloud only; skip device probe/prewarm.

- Routing function (simplified)
  ```text
  ensureOnDeviceReady()
   ├─ if ready and mode != online-only → aiOnDeviceWithPersona()
   │   └─ if success → Done (Used: device)
   └─ if mode == offline-only → throw "On-device AI unavailable."
       else → aiOnlineWithPersona() (Used: cloud)
  ```

- “Why cloud?” reasons (provide these strings in your tooltip implementation)
    - Device runtime not ready (model not loaded or page restricted).
    - Operation not supported on device (structured citations needed, etc.).
    - Explicit Online‑only mode.
    - Fallback after device error/timeout.
    - Large input trimmed for cloud (device path tried first).

- Timeouts and progress
    - aiOnDeviceWithPersona(): longer timeout when Offline‑only (e.g., 30s) to allow initial model download.
    - Progress events forwarded from the page bridge; loader displays “Using on‑device AI,” “Downloading model…,” etc.
    - Cloud path shows “Using cloud AI” or “Falling back to cloud AI.”

- Footer microcopy (panels and Reader)
    - Always render:
        - Tip: On‑device when available; falls back to cloud. Used: On‑device/Cloud
        - “Why cloud?” tooltip that displays the reason string collected during routing.

## Architecture

- Content script (content/content.js)
    - Selection toolbar, Floating Action Button (FAB), panels
    - Settings loader and listeners (chrome.storage.sync)
    - AI routing: on‑device first → cloud fallback
    - Structured result parsing and rendering
    - Auto “Find sources” when citations are missing (gated by `settings.citeSources` and not in Offline‑only)
    - Save note via `/api/notes`; open quiz; open Reader

- Page bridge (injected page context)
    - Talks to Chrome AI Task APIs
    - Prewarm and readiness probe
    - Progress events forwarded to content (download state, etc.)

- Background/service worker
    - Handles hotkeys, context menu, Reader open, auth, quiz navigation
    - Receives chrome.commands and relays PAGEGENIE_HOTKEY to content

- Popup (popup/popup.js)
    - Auth: login/signup/logout (optional backend)
    - Settings: Mode, Theme, Persona, Target Language, “Cite sources”
    - “Open Hub” (Library) and “Reading Mode” (Reader) actions
    - Onboarding banner: “Finish setup” CTA for first‑time users

- Library (Hub) pages
    - pages/reading.html (hub shell) + related JS/CSS to display Notes, Suggestions, Quizzes

## Settings (chrome.storage.sync)

Keys used by content.js/popup.js:
- `mode`: "auto" | "offline-only" | "online-only"
- `showToolbarOnSelection`: boolean
- `showFloatingButton`: boolean
- `showFullPageConfirm`: boolean
- `targetLang`: "en" (or user’s choice)
- `theme`: "system" | "light" | "dark"
- `persona`: "general" | "student" | "researcher" | "editor"
- `citeSources`: boolean (controls model citation requests AND auto search)
- `citeSourcesManual`: boolean (popup only; marks user override so persona changes don’t auto-reset)
- Optional auth profile keys: `apiToken`, `tokenExp`, `profileName`, `profileUsername`

## Theming

- Stored in `theme` with values: system | light | dark
- Applies immediately in popup and content panels; respects `prefers-color-scheme` when `system`
- Content updates toolbar/panel colors via `pgApplyTheme()` and optional `__pg_toolbar_updateTheme`

## Floating Action Button (FAB)

- Controlled by `showFloatingButton` (popup toggle)
- Click to open actions; coexists with selection toolbar
- Keyboard:
    - When FAB is focused, Arrow keys nudge its position for accessibility
    - ESC closes any open panel or blurs FAB focus

## Keyboard shortcuts

Registered via chrome.commands and relayed to content:
- Alt+Shift+S → Summarize
- Alt+Shift+E → Explain
- Alt+Shift+R → Rewrite
- Alt+Shift+T → Translate

Users can customize at chrome://extensions/shortcuts. Background forwards:
- `{ type: "PAGEGENIE_HOTKEY", operation: "summarize" | "explain" | "rewrite" | "translate" }`

## Auto sources (Google CSE)

- Triggered after summarize/explain when bullets exist but citations are empty, and `settings.citeSources` is true and mode != Offline‑only.
- Backend `/api/v1/sources/find`:
    - Subject‑aware query planning with `-site:` exclusion first.
    - Dedup by domain + normalized title.
    - Returns 3–5 items `{ title, url, reason }` rendered as References with “— found by search”.

## Onboarding

- First‑run popup shows “Finish setup” banner with a Start button.
- Opens a short tour: selection → toolbar → shortcuts → settings → Library.
- Storage key `onboardingCompleted` hides the banner when done.

## Backend endpoints

- POST `/api/v1/ai`
    - Body: `{ text, action, targetLang, persona, citeSources, structured }`
    - Returns AI result (structured or plain); error mapping propagates upstream HTTP status.
- POST `/api/v1/sources/find`
    - Body: `{ text, sourceUrl, persona, size }`
    - Google CSE integration with progressive queries and dedupe.
- Library endpoints
    - POST `/api/notes` (save selection)
    - POST `/api/v1/reading/suggest` (curated links)
    - POST `/api/v1/quiz/generate-from-text` (quiz)

Environment:
- `GOOGLE_API_KEY` (Gemini)
- `GOOGLE_CSE_API_KEY`, `GOOGLE_CSE_CX` (Custom Search)
- Optional: server port/CORS

## Error handling and UX

- Retries/backoff: 2 retries (3 attempts), jittered delays
- Friendly messages:
    - 429/rate limit → “Cloud is rate‑limiting right now. Please try again shortly.”
    - 503/overloaded → “Cloud model is overloaded. Please wait a moment and try again.”
    - 403 for CSE → “Search API call was denied (missing or restricted API key)…”
- Loaders:
    - Always call `loader.success` after rendering (including after auto‑search)
    - Clear cancel flows for full‑page ops

## Development workflow

1) Start backend
```bash
export GOOGLE_API_KEY=...
export GOOGLE_CSE_API_KEY=...
export GOOGLE_CSE_CX=...
./mvnw spring-boot:run
```

2) Load extension
- chrome://extensions → Load Unpacked (this repo root or extension folder)
- Enable “Allow access to file URLs”

3) Iterate
- Edit content/content.js or popup/popup.js
- Reload extension and refresh page
- Use DevTools → Console + Network to verify:
    - PAGEGENIE_AI_* messages
    - /api/v1/ai and /api/v1/sources/find flows
    - Library calls: /api/notes, /api/v1/reading/suggest, /api/v1/quiz/generate-from-text

4) Manual QA
- Summarize/Explain with/without citations
- Offline‑only vs Online‑only
- “Find sources” manual action and auto append
- Concept drift and Quiz flows
- Reader for PDFs
- Save Note → open Hub → verify Notes/Suggestions/Quizzes render
- Onboarding banner appears on first run and can be launched via popup

## Adding a new operation

- Map the operation to an action in `opToAction` if cloud support needed
- Add toolbar binding (`toolbar.on("your_op", ...)`)
- Implement on‑device (Chrome Task API) or use Prompt fallback
- Ensure result rendering calls `loader.success` and uses structured parsing where applicable
- Log via `persist("/api/ops/log", {...})` for diagnostics

## Notes

- Some Chrome pages (chrome://, Web Store) restrict on‑device APIs. The Reader provides a workaround.
- Keep the `citeSources` toggle semantics consistent:
    - In content: gate auto search and model citation request
    - In popup: do not overwrite user choice after first manual toggle