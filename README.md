# PageGenie — On‑device reading copilot with automatic sources

PageGenie turns any web page into a research‑ready, readable summary with citations. It runs on‑device first using Chrome’s built‑in AI Task APIs for speed and privacy, then falls back to cloud only when needed—adding source links automatically when the model doesn’t provide them.

## Problem we’re solving

Reading and researching on the web is noisy and time‑consuming:
- You often need quick summaries, simple explanations, translations, trustworthy references, and notes—without jumping between apps or leaking content.
- Citations are inconsistent across sites. When they’re missing, you have to search manually.
- Many AI tools require copy‑paste into a cloud service; users want privacy‑preserving, on‑device help that still scales when needed.

PageGenie solves this by:
- Performing Summarize/Explain/Translate/Proofread/Rewrite/Write inline on any page with on‑device AI when available.
- Falling back to cloud AI safely with clear messaging, retries, and structured output.
- Automatically adding external references via web search when the model didn’t return citations.
- Providing a personal Library (Hub) that collects your saved notes, curated suggestions, and quizzes for later study.

## APIs used

- Google Chrome AI Task APIs (on‑device; built into Chrome)
    - Summarizer
    - Translator
    - Proofreader
    - Rewriter
    - Writer
    - Prompt API (fallback within Chrome for generic prompts)
- Google AI (Gemini) — cloud fallback for actions that aren’t available on‑device or on restricted pages
- Google Custom Search JSON API (Programmable Search / CSE) — “Find sources” to attach 3–5 deduped references with short reasons
- Chrome Extensions Platform APIs
    - storage.sync (settings persistence: mode/persona/theme/targetLang/citeSources)
    - runtime messaging (content ↔ background ↔ page bridge)
    - contextMenus and commands (hotkeys, right‑click actions)
    - tabs/scripting (Reader open, page bridge injection)

## Highlights

- On‑device first (Chrome AI Task APIs) with privacy and speed
- Cloud fallback with resilience: retries/backoff, friendly progress, structured results
- Automatic sources: Google CSE adds references when citations are missing
- Reader page for PDFs with the same “Summary/Explanation + References” styling
- Concept drift analysis: compare selected text against your notes
- Quiz from selection
- Library (Hub): see your saved Notes, curated Suggestions, and generated Quizzes in one place
- Clear UX: “Used: On‑device/Cloud”, “Why cloud?” tooltip, empty‑state hint, light/dark themes
- Theming, Floating Action Button (FAB), keyboard shortcuts, and onboarding for first‑time users

## On‑device vs Cloud (how it decides)

- Modes
    - Auto (default): Try on‑device first → fall back to cloud if unavailable.
    - Offline‑only: Use on‑device only; never call cloud or web search (manual “Find sources” still works).
    - Online‑only: Skip on‑device; use cloud for maximum compatibility.

- When we use cloud (common reasons shown under “Why cloud?” in the footer)
    - On‑device runtime not ready (first‑run, model download not finished, or API unavailable on this page).
    - The requested action isn’t supported on‑device (or needs structured citations not provided by the device task).
    - Restricted context (certain chrome:// or store pages) or iframe sandboxing prevents on‑device APIs.
    - Explicit user choice (Online‑only mode).
    - Large selections are trimmed for cloud; on‑device path runs first and does not upload text if it succeeds.

- Data handling
    - On‑device: Runs locally; content isn’t sent to a server.
    - Cloud: Sends only the operation payload (selection text plus minimal metadata like persona/language). We show “Used: Cloud” and provide “Why cloud?” details for transparency.

- Visual indicators
    - Footer microcopy in panels:
        - Tip: On‑device when available; falls back to cloud. Used: On‑device/Cloud
        - “Why cloud?” tooltip explains the reason for cloud routing.

## Quick start

1) Requirements
- Chrome (stable) with built‑in Chrome AI Task APIs
- Java 17+, Maven (for backend)
- Google APIs:
    - Gemini API key (GOOGLE_API_KEY)
    - Google Custom Search JSON API key (GOOGLE_CSE_API_KEY) and Search Engine CX (GOOGLE_CSE_CX)

2) Backend setup (Spring Boot)
```bash
# From the server project root
export GOOGLE_API_KEY=your_gemini_key
export GOOGLE_CSE_API_KEY=your_cse_key
export GOOGLE_CSE_CX=your_cse_cx
./mvnw spring-boot:run
# Backend serves at http://localhost:8080
```

3) Load the extension
- chrome://extensions → Enable Developer mode
- Load Unpacked → select the extension folder
- In extension details, enable “Allow access to file URLs” (for Reader/PDFs)

4) Try it
- Open an article, select a paragraph:
    - Summarize → shows “Used: On‑device” where available
    - Explain → heading “Explanation”
    - If no citations, PageGenie auto‑finds sources via CSE and appends “— found by search”
    - “Find sources” action returns a References‑only panel

## Features

- Summarize/Explain: structured bullets + “References” block
- Translate: inline overlay or panel
- Proofread/Rewrite/Writer: fast on‑device edits
- Concept drift analysis: key claim, agreement, drift
- Quiz from selection: quick comprehension check
- Reader page: PDF and long‑form reading with consistent styling

### Theming
- Theme options: System, Light, Dark (popup → Settings → Theme)
- Respects OS “prefers‑color‑scheme” when set to System
- Reader and inline panels adapt to the selected theme

### Floating Action Button (FAB)
- Optional quick‑access button on pages (popup → Settings → “Floating button”)
- Keyboard nudging:
    - Arrow keys: move the FAB position when focused
    - ESC: closes an open panel, or blurs focus from the FAB
- Works alongside the selection toolbar

### Keyboard shortcuts
- Alt+Shift+S → Summarize
- Alt+Shift+E → Explain
- Alt+Shift+R → Rewrite
- Alt+Shift+T → Translate
- Customize at chrome://extensions/shortcuts

### Onboarding
- First‑time users see a “Finish setup” banner with a 60‑second tour (popup or hub)
- Walkthrough covers: selection, toolbar, keyboard shortcuts, settings, and the Library

### Popup (login, signup, settings)
- Auth: Login/Signup flows (optional)
- Settings: Mode (Auto/Offline‑only/Online‑only), Theme, Persona (General/Student/Researcher/Editor), Target Language, “Cite sources”
- Quick links: Open Reader (Reading Mode), Open Hub (Library)

### References and footer tip
- When structured results are shown, panels include:
    - “References” (from the page or “— found by search” via CSE)
    - Footer: Tip: On‑device when available; falls back to cloud. Used: On‑device/Cloud
        - “Why cloud?” tooltip explains when/why the cloud path was used

### Library (Hub)
- Notes: save any selection with source URL and timestamp
- Suggestions: curated follow‑up reading related to your saved notes
- Quizzes: browse and resume quizzes generated from selections
- Open from the popup via “Open Hub” (pages/reading.html)

## Configuration

Environment variables (backend):
- GOOGLE_API_KEY: Gemini key for cloud fallback
- GOOGLE_CSE_API_KEY: Google Custom Search JSON API key
- GOOGLE_CSE_CX: Custom Search Engine ID (set to “Search the entire web”)

Optional:
- SERVER_PORT (Spring), CORS if hosting separately

Chrome extension:
- The popup controls:
    - Mode, Show toolbar on selection, Floating button
    - Target language, Theme, Persona
    - Cite sources (persisted), which:
        - Asks the model for citations when possible
        - Auto‑adds sources via CSE when the model returns none (unless Offline‑only)

## Troubleshooting

- Cloud 503/429 (overloaded/rate‑limited)
    - UI shows “Cloud busy • retrying…” with backoff
    - Final friendly message if exhausted
- CSE 403 “unregistered callers”
    - Ensure Google “Custom Search JSON API” is enabled
    - Use a server‑side API key (no HTTP referrer restrictions); optionally restrict by server IP
    - Check GOOGLE_CSE_API_KEY/GOOGLE_CSE_CX are set in the backend
- No citations appear
    - Ensure “Cite sources” is enabled in popup
    - Auto search is disabled in Offline‑only mode (manual “Find sources” still works)
- On‑device unavailable
    - Certain pages (chrome://, Chrome Web Store) restrict on‑device APIs
    - Use the Reader or rely on cloud fallback

## Development

- Content scripts implement selection toolbar, FAB, UI panels, AI routing, and note saving
- Page bridge connects content to Chrome Task APIs and reports readiness/progress
- Backend provides:
    - /api/v1/ai (Gemini structured/plain)
    - /api/v1/sources/find (Google CSE for references)
    - /api/notes (store selections as notes)
    - /api/v1/reading/suggest (curated links)
    - /api/v1/quiz/generate-from-text (quiz)
- Robust JSON parsing for structured outputs (fenced/quoted/noisy JSON supported)
- Error handling propagates upstream HTTP status to the UI

## Security and privacy

- On‑device by default (Auto/Offline‑only)
- Cloud only when needed; transparent “Used: …” footer
- Notes and quizzes are tied to your local environment/backend session; core reading tasks don’t require server state

## License

MIT 