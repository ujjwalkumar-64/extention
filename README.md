# PageGenie Browser Extension

PageGenie is a Chrome/Edge (Manifest V3) extension that brings AI-powered reading and writing tools directly to any web page. It prefers fast, private, on‑device AI when available and seamlessly falls back to your configured backend when needed.

> Note: PDF integration and documentation are intentionally excluded for now. They will be added once the feature is finalized.

## Key Features

- Selection toolbar on any web page:
  - Summarize, Explain, Rewrite, Translate, Save
  - Quick Fixes: Replace with Proofread, Translation Overlay, Insert Code Comments
- On‑device AI first:
  - Uses available local task APIs (Translator, Summarizer, Proofreader, Rewriter, Writer) and the Prompt API (`window.ai`) when present
  - Falls back to your backend for cloud processing
- Smooth UX:
  - Progress and status toasts
  - Non‑intrusive in‑page result panels and overlays
- Notes and Reading:
  - Save a note from your selection
  - Shows categories and curated reading suggestions panel
- “Quiz Me” from selection or whole page (cloud)
- Privacy‑aware:
  - Offline‑only mode to strictly keep text on device
  - Auto mode selects on‑device first and falls back only if needed

## Requirements

- Chrome/Edge (latest) with Manifest V3 support
- Optional backend API (Spring Boot) if you want cloud fallback and advanced features:
  - Base URL (default): `http://localhost:8098`
  - Endpoints (see Developer Guide for details)
- Optional on‑device AI support on your system:
  - If `window.ai` or local task APIs are available, the extension will use them automatically

## Install (Load Unpacked)

1. Clone or download this repository.
2. Open Chrome and navigate to `chrome://extensions/`.
3. Enable “Developer mode” (top‑right).
4. Click “Load unpacked” and select the repo’s root directory.
5. Confirm the extension is enabled.

## Configuration

- Click the extension’s options to set:
  - Backend URL (default `http://localhost:8098`)
  - Sign up or log in to obtain and store an API token
- The extension stores user settings in `chrome.storage.sync`, including:
  - `mode`: `"auto" | "offline-only" | "online-only"`
  - `showToolbarOnSelection`: `boolean`
  - `targetLang`: language code for translation

## Usage

- Select text on any web page to reveal the toolbar.
- Click an action (Summarize, Explain, Rewrite, Translate, Save).
- For Quick‑Fix:
  - Replace with Proofread (replaces selection)
  - Translation Overlay (bubble near the selection)
  - Insert Code Comments (for nearby code block)
- Context menu (right‑click) also provides key actions.
- “Quiz Me”:
  - Generates a quiz (cloud) from selection or full page content and opens the quiz UI.
- Modes:
  - Auto: prefer on‑device AI, fallback to backend on timeout/unavailable.
  - Offline‑only: never send content to backend; errors if on‑device is not available.
  - Online‑only: always use backend.

## Troubleshooting

- “On‑device AI unavailable”:
  - Your system may not support `window.ai` or task APIs; use Online‑only mode or configure your backend.
- “Extension context invalidated”:
  - This can happen after extension reload; refresh the page to re‑inject scripts.
- Backend 401 Unauthorized:
  - Token may have expired; log in again via the extension’s options.
- No toolbar on selection:
  - Check settings: `showToolbarOnSelection` is enabled.
  - Some sites may isolate content in iframes; make sure content scripts are allowed on the page.

## Roadmap

- PDF support (documentation and UX polish will be added once the feature is stable)
- Additional local task API support and improved fallbacks
- More editor integrations for “Insert Code Comments”

## License

MIT

## Acknowledgments

- Browser on‑device AI APIs and task‑specific local APIs
- Spring Boot backend for cloud AI and data services
