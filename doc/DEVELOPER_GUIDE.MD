# Developer Guide

This document describes the project architecture, important code paths, message contracts, configuration, and developer workflows.

> Note: PDF integration is intentionally not documented here and should be added once the feature is stabilized.

## Architecture Overview

The extension is composed of:

- Content script (`content/content.js`)
    - Manages selection toolbar and UI overlays
    - Routes AI requests to on‑device page bridge or to the backend
    - Persists actions (notes, logs, suggestions, quizzes) through the background
- Page Bridge (`content/pageBridge.js`)
    - Injected into the page context (not the isolated content world)
    - Talks to on‑device AI:
        - Task‑specific local APIs: `Translator`, `Summarizer`, `Proofreader`, `Rewriter`, `Writer`
        - Prompt API: `window.ai.createTextSession` (fallback)
    - Normalizes outputs to plain strings
    - Communicates back to the content script via `window.postMessage`
- Background Service Worker (`background.js`)
    - MV3 service worker
    - Context menus and safe chrome.tabs messaging
    - Bridges cloud/backend calls (`/api/v1/ai`, `/api/notes`, etc.)
    - Auth helpers (signup/login/logout), token storage/expiry handling
- UI Pages
    - Options/popup/quiz pages as applicable (check repository)
- Assets (icons, CSS)

Data flow at a glance:

1) User selects text → content.js shows toolbar.
2) User picks an action → content.js sends a page message to `pageBridge.js` (on‑device first).
3) If on‑device path fails or in online‑only mode → content.js sends a request to the backend via background.js (`PAGEGENIE_PERSIST`).
4) Results are displayed (overlay bubble, replacement, or panel).

## Message Contracts

Between content.js and pageBridge.js (window.postMessage):
- Request: `PAGEGENIE_AI_REQUEST` `{ id, operation, text, targetLang }`
- Response: `PAGEGENIE_AI_RESPONSE` `{ type, id, ok, result | error }`
- Progress: `PAGEGENIE_AI_PROGRESS` `{ type, id, message }`
- Ping: `PAGEGENIE_AI_PING` → `PAGEGENIE_AI_READY { ready: boolean }`
- Prewarm: `PAGEGENIE_AI_PREWARM` `{ want: [...] }`

Between content/background (chrome.runtime messages):
- `PAGEGENIE_PERSIST` → background fetches backend endpoint and returns `{ ok, data | error }`
- `PAGEGENIE_LOADING` (start/set/success/error/close) for toasts
- `PAGEGENIE_TOAST` message
- Auth:
    - `PAGEGENIE_AUTH_SIGNUP`, `PAGEGENIE_AUTH_LOGIN`, `PAGEGENIE_AUTH_LOGOUT`
- Quiz:
    - `PAGEGENIE_OPEN_QUIZ` (opens quiz UI)
- Concept drift:
    - `PAGEGENIE_COMPARE_CONCEPT`

## Project Structure (typical)

```
extention/
├─ content/
│  ├─ content.js           # UI and routing in the content world
│  └─ pageBridge.js        # On‑device AI bridge injected into the page
├─ background.js           # MV3 service worker
├─ options/                # Options UI (if present)
├─ popup/                  # Popup UI (if present)
├─ quiz/                   # Quiz UI (if present)
├─ icons/                  # Extension icons
├─ manifest.json           # Chrome extension manifest (MV3)
└─ README.md / DEVELOPER_GUIDE.md
```

Note: Actual structure may vary; adjust this guide to your repository layout.

## On‑device AI Paths (Preferred)

`pageBridge.js` attempts to use task‑specific local APIs and the Prompt API:

- Translator:
    - `Translator.create({ sourceLanguage, targetLanguage, monitor })`
    - `translator.translate(text)`
    - Verbose progress (1–100%)
- Summarizer:
    - `Summarizer.availability()` → `Summarizer.create(opts)` → `summarize(text, { context })`
- Proofreader:
    - `Proofreader.create({ expectedInputLanguages, monitor })` → `proofread(input)` returns corrected string
- Rewriter:
    - `Rewriter.create(opts)` → `rewrite(input, { context })`
- Writer:
    - `Writer.availability()` → `Writer.create(opts)` → `writer.write(promptString, { context })`
- Prompt fallback:
    - `window.ai.createTextSession()` → `session.prompt(prompt)`

Outputs are normalized with `ensureText()` before being returned to content.js.

## Backend (Optional, for cloud fallback)

Default base URL: `http://localhost:8098`

Common endpoints used by content/background:
- AI generic: `POST /api/v1/ai` `{ text, action, targetLang }`
- Notes: `POST /api/notes` (persists saved selection)
- Curated reading: `POST /api/v1/reading/suggest` `{ baseUrl, baseSummary }`
- Quiz:
    - `POST /api/v1/quiz/generate-from-text` (from selection text)
    - `POST /api/v1/quiz/generate` (from URL)
- Concept drift analysis: `POST /api/v1/ai/compare-concept`
- Auth:
    - `POST /api/v1/auth/signup`
    - `POST /api/v1/auth/login` (returns `Authorization: Bearer <token>`)

The background service worker caches token/expiry in `chrome.storage.sync` and refreshes/removes on `401`.

### Quick Backend Start (if present in this repo)
- Java 17+ and Maven/Gradle
- Run the Spring Boot application (e.g., `./mvnw spring-boot:run`)
- Confirm it listens on `http://localhost:8098`

## Settings & Storage

Stored in `chrome.storage.sync`:
- `mode`: `"auto" | "offline-only" | "online-only"`
- `showToolbarOnSelection`: `boolean`
- `targetLang`: language code
- `backendUrl`: string
- `apiToken`: string (Bearer token)
- `tokenExp`: number (ms since epoch)

## Developer Workflow

1. Load the extension unpacked from repo root (`chrome://extensions` → Load unpacked).
2. Toggle modes via options (Auto / Offline‑only / Online‑only).
3. Use DevTools:
    - Content script logs: web page DevTools console
    - Background logs: `chrome://extensions` → “Service Worker” inspection
4. After file changes:
    - Click “Reload” on your extension in `chrome://extensions`
    - Refresh the test page

## Coding Guidelines

- Use clear message types and keep request/response payloads minimal.
- Normalize all AI outputs to plain text before inserting into the page.
- Avoid using `chrome.*` from the page bridge (it runs in page context).
- Prefer safe messaging helpers in background (guard invalid tab IDs).
- Keep progress updates throttled to avoid UI jank.

## Testing Checklist

- Selection toolbar appears on highlight; hides when selection collapses.
- Actions:
    - Summarize / Explain / Rewrite / Translate — via on‑device when available
    - Quick‑Fix actions perform expected DOM edits/bubbles
    - “Save” shows categories bubble and (optional) suggestions panel
- Modes:
    - Auto: on‑device first; fallback to backend when needed
    - Offline‑only: never sends content to backend; errors if on‑device unavailable
    - Online‑only: always uses backend
- Auth:
    - Signup/Login/Logout flows update token and handle expiry
- Edge cases:
    - Very long inputs (ensure trimming for on‑device as configured)
    - iframes and selection changes
    - Background reloads (extension context invalidated → refresh page)

## Release

- Update icons, name, version in `manifest.json`
- Verify permissions are as minimal as possible
- Zip the extension directory and upload to the Chrome Web Store (if applicable)

## Security & Privacy

- Offline‑only mode ensures text never leaves the device
- Use HTTPS for backend
- Store tokens in `chrome.storage.sync`; clear on logout or 401

## Pending

- PDF integration and documentation will be added once stable
- Additional performance optimizations and telemetry (optional)