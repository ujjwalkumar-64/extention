# PageGenie — On‑device reading copilot with automatic sources

Elevator pitch  
PageGenie turns any web page into a research‑ready, readable summary with citations. It runs on‑device first using Chrome’s built‑in AI Task APIs for speed and privacy, then falls back to cloud only when needed—adding source links automatically when the model doesn’t provide them.

Problem we’re solving  
Web reading and research is noisy and time‑consuming:
- You need quick summaries, clear explanations, translations, and trustworthy references—without copy‑pasting into separate tools or leaking content.
- Citations are inconsistent across sites. When they’re missing, manual search is tedious.
- Users want privacy‑preserving, on‑device help that still scales reliably when needed.

PageGenie solves this by:
- Performing Summarize/Explain/Translate/Proofread/Rewrite/Write inline on any page using on‑device Chrome AI when available.
- Falling back to cloud safely with clear status, retries/backoff, and structured output.
- Automatically adding external references via web search when the model didn’t return citations.
- Providing a Library (Hub) that collects saved notes, curated suggestions, and quizzes for later study.

APIs used
- Google Chrome AI Task APIs (on‑device; built into Chrome)
    - Summarizer, Translator, Proofreader, Rewriter, Writer
    - Prompt API (safety net within Chrome for generic prompts)
- Google AI (Gemini) — cloud fallback for actions not available on‑device or on restricted pages; returns structured outputs
- Google Custom Search JSON API (Programmable Search / CSE) — “Find sources” to attach 3–5 deduped references with short reasons
- Chrome Extensions Platform APIs — storage.sync, runtime messaging, contextMenus/commands (hotkeys), tabs/scripting (Reader/page bridge injection)

Tech stack
- Client (Chrome Extension)
    - JavaScript (ES2020+), HTML, CSS (vanilla, no large UI framework)
    - Content script UI: selection toolbar, floating action button (FAB), result panels, Reader integration
    - Popup UI: login/signup, settings (mode, theme, persona, target language, cite sources), links to Reader and Library
    - Background/service worker: hotkeys (chrome.commands), context menus, messaging, Reader launcher
    - State: chrome.storage.sync (persistent settings), window.postMessage bridge to page context
    - Accessibility: keyboard shortcuts; Arrow‑key FAB nudging; ESC to close panels; system/light/dark themes
- Backend
    - Java 17, Spring Boot (REST)
    - Endpoints: /api/v1/ai (Gemini), /api/v1/sources/find (Google CSE), /api/notes, /api/v1/reading/suggest, /api/v1/quiz/generate-from-text
    - HTTP: Spring RestClient; resiliency with retries/backoff for cloud calls
    - Logging: SLF4J; stateless services suitable for horizontal scaling
- External services
    - Google AI (Gemini) for cloud inference
    - Google Programmable Search (Custom Search JSON API) for references
- Build/dev
    - Maven for backend; Chrome “Load Unpacked” for the extension; environment via GOOGLE_API_KEY/GOOGLE_CSE_API_KEY/GOOGLE_CSE_CX

Key features and UX
- Actions: Summarize, Explain, Translate, Proofread, Rewrite, Write — inline on any page; PDF Reader mirrors the same UI
- Citations:
    - Preserve page citations when present
    - If missing, auto‑append “— found by search” sources via CSE (dedup by domain + normalized title; short “reason” notes)
    - User toggle “Cite sources” (persisted) controls both model requests and auto‑search
- Library (Hub): Notes (saved selections with source+timestamp), Suggestions (curated follow‑ups), Quizzes (generate from selection; resume later)
- Theming: System/Light/Dark; respects OS “prefers‑color‑scheme”; consistent styling across inline panels and Reader
- Floating Action Button (optional) + selection toolbar; keyboard‑nudgeable with Arrow keys; ESC closes panels
- Keyboard shortcuts: Alt+Shift+S (Summarize), Alt+Shift+E (Explain), Alt+Shift+R (Rewrite), Alt+Shift+T (Translate) — customizable at chrome://extensions/shortcuts
- Onboarding: First‑run “Finish setup” tour (selection → toolbar → shortcuts → settings → Library)
- Popup: Login/Signup; Settings for Mode (Auto/Offline‑only/Online‑only), Theme, Persona (General/Student/Researcher/Editor), Target language, and “Cite sources”; quick links to Reader and Library
- Panel footer tip: “Tip: On‑device when available; falls back to cloud. Used: On‑device/Cloud” with a “Why cloud?” tooltip that explains the routing reason

On‑device vs Cloud (routing)
- Modes:
    - Auto (default): Try on‑device first → fall back to cloud if unavailable
    - Offline‑only: Device only; never call cloud or auto web search (manual “Find sources” still works)
    - Online‑only: Cloud only; skip device probe
- Common cloud reasons (shown under “Why cloud?”): on‑device runtime not ready or unsupported on this page; operation requires cloud; explicit Online‑only; fallback after device timeout/error; large input trimmed for cloud only
- Transparency: The footer always shows “Used: On‑device/Cloud” and exposes a “Why cloud?” tooltip with the exact reason

Judging criteria

Functionality
- Scalable by design:
    - On‑device inference handles most tasks locally (zero server cost); cloud path is stateless and horizontally scalable
    - CSE responses are deduped and can be cached; structured UI rendering is consistent across pages and PDFs
- Effective API usage:
    - Broad, practical use of Chrome AI Task APIs with prewarm/readiness and structured rendering
    - Cloud fallback with retries/backoff and friendly progress states
    - Google CSE auto‑sources only when needed and user‑permitted
- Multi‑region / multi‑audience:
    - Target language selection; personas (General/Student/Researcher/Editor)
    - Region‑aware search hints and bias (e.g., gl=IN for Indian topics)

Purpose
- Meaningfully improves a common journey:
    - Inline summarize/explain/translate/proofread/rewrites without app‑switching
    - Trust via citations: preserved when present; automatically added when missing
- Unlocks previously impractical capability:
    - On‑device privacy + seamless fallback, structured outputs, and automatic web references in one consistent UI

Content
- Creative yet pragmatic:
    - Consistent “Summary/Explanation + References” panels across inline and Reader
    - Clear microcopy, themed UI (System/Light/Dark), accessible interactions (keyboard/FAB), and onboarding

User Experience
- Well executed and easy to use:
    - Selection toolbar and optional FAB for quick access
    - Keyboard shortcuts for power users; onboarding tour for first‑time success
    - Persistent settings and clear footer tip for transparency (“Used: On‑device/Cloud”, “Why cloud?”)

Technological Execution
- Strong showcase of Chrome’s on‑device AI:
    - Summarizer/Translator/Proofreader/Rewriter/Writer + Prompt fallback
    - Robust device→cloud routing with progress and retries
    - Automatic sources via Google CSE with dedupe and concise reasons

Demo flow (3–4 minutes)
1) Auto mode → select paragraph → Summarize → “Used: On‑device,” bullets, references if present
2) Explain → if citations missing, watch “Finding sources…” then appended “— found by search” references
3) Online‑only → Summarize → show cloud path with friendly progress/retries
4) Manual “Find sources” → References‑only panel
5) Save Note → open Library (Notes/Suggestions/Quizzes)

Setup for judges
- Chrome (stable) with Chrome AI Task APIs
- Backend env: GOOGLE_API_KEY, GOOGLE_CSE_API_KEY, GOOGLE_CSE_CX; run Spring Boot (http://localhost:8080)
- Load Unpacked extension; enable “Allow access to file URLs” (for Reader/PDFs)


Team/contact
- GitHub: [ujjwalkumar-64](https://github.com/ujjwalkumar-64)