# PageGenie Privacy Policy

Effective date: 2025-10-31

This Privacy Policy explains how PageGenie (the "Extension", "we", "us", or "our") collects, uses, discloses, retains, and protects information when you install and use the PageGenie browser extension. PageGenie is an on‑device reading copilot that summarizes and explains selected text on web pages and PDFs, and optionally finds external references and saves notes or quizzes when you request those actions.

Please read this Privacy Policy carefully. By installing or using PageGenie you agree to the collection and use of information in accordance with this policy.

If you have questions, need help, or want to request deletion of data, contact us:
- GitHub / Support: https://github.com/ujjwalkumar-64
- Email (optional): ujjwal3064@gmail.com

---

## 1. Summary — privacy-first by design

- On‑device first: PageGenie attempts to perform inference (summaries, explanations, translations, proofreads, rewrites) locally inside your browser using Chrome AI Task APIs whenever available. When the on‑device path is used, your selected text is processed locally and is not sent to our servers.
- Cloud fallback only by consent/need: If on‑device is unavailable, unsupported, or you choose an Online mode, PageGenie will send the minimal required data to our backend for cloud inference or to run searches for references. The UI shows a clear footer (Used: On‑device / Cloud) and a “Why cloud?” reason before sending.
- Save explicitly: PageGenie only stores selected page content (Notes) or sends your selection for processing when you explicitly request it (e.g., Save Note, Generate Quiz, Find Sources). The extension does not continuously scan or collect pages in the background.

---

## 2. Data we may collect

We list categories below and explain when/why they are collected. Most features work without any server-side data collection.

A. Personally Identifiable Information (PII)
- What: Email address, profile name, account identifier, and minimal profile metadata.
- When: Only if you create an account or sign in to optional backend features (Library sync, cross-device notes).
- Why: To enable persisted personal Library, sync, and account recovery.
- How stored: Securely in our backend (hashed passwords, access-controlled DB) if you opt-in.

B. Authentication information
- What: Credentials (username/password) or auth tokens.
- When: Only if you create a backend account or authenticate.
- How stored: Passwords are never stored in plaintext; use secure hashing. Tokens may be stored temporarily in browser storage (chrome.storage) for session use.

C. Website content (selected text, page URL, title)
- What: The text you select on a page, the page URL and title.
- When:
    - Processed locally for on‑device inference (never leaves the device).
    - Sent to our backend only when you request a cloud operation (cloud fallback) or explicitly save a Note or use Find Sources/Quiz generation.
- Why: To generate summaries, explanations, translations, find references, or store Notes/Quizzes.
- Retention: If saved as Note/Quiz, retained until you delete it or delete your account (see Retention & Deletion).

D. Usage & diagnostic data (telemetry)
- What: Optional aggregated performance metrics, error logs, retry counts, latency, and non-identifying environment info (browser version, extension version).
- When: Only if you opt in to telemetry. Telemetry does not include selected text or PII.
- Why: To improve reliability and performance.
- Retention: Aggregated and retained for troubleshooting (default example: 30 days), unless you opt out.

E. Network & basic metadata
- What: IP addresses, timestamps, request metadata (standard server logs) — collected by servers when you make cloud requests.
- Why: Operational reasons (rate limiting, abuse prevention, diagnostics).
- Retention: Short-lived logs (example retention: 30 days).

F. Other categories not collected
- We do NOT collect health data, financial/payment information, keystrokes, continuous user activity logging (mouse/scroll/keystrokes), or full browsing history, except for:
    - The page URL/title associated with a Note that you explicitly save.

---

## 3. How we use the data

- Provide features: Generate inference outputs (summaries, explanations) via on‑device or cloud, find sources via server-side search, and store Notes/Quizzes when requested.
- Account management: Authenticate and associate saved Library items with your account when you sign up.
- Performance & reliability: Analyze optional telemetry and server logs to improve the product.
- Abuse prevention and security: Rate limiting, investigating errors, and preventing misuse.

We do not use collected data for advertising, profiling for targeted ads, or unrelated secondary uses.

---

## 4. Sharing & third‑party services

- Service providers: We may share data with third‑party providers that process data on our behalf (for example, cloud AI providers like Google AI (Gemini) or Google Custom Search) when you use cloud fallback or source-finding. Those providers process the data only to fulfill the requested operation and under contractual constraints.
- API keys and sensitive credentials: API keys for cloud services (Gemini, CSE) are stored and used server‑side only. The client extension does not embed production API keys.
- No sale: We do not sell or transfer user data for commercial purposes.
- Legal: We may disclose minimal data when legally required (valid subpoena, legal process), but only the minimum necessary.

---

## 5. On‑device vs Cloud — transparency & controls

- On‑device default: In Auto or Offline-only mode, PageGenie prefers local processing. Use Offline-only to prevent any cloud requests (auto-Find Sources disabled; manual Find Sources still requires explicit action).
- Cloud usage indicator: Panels display “Used: On‑device” or “Used: Cloud” and provide a “Why cloud?” tooltip explaining the reason (runtime not ready, operation unsupported, explicit Online-only, large selection trimmed, etc.).
- Consent: Cloud calls that send selected text occur only when:
    - On‑device is unavailable and the operation falls back to cloud (Auto mode), OR
    - You explicitly select an Online-only mode, OR
    - You explicitly choose actions that require server-side processing (Find Sources, Save Note to backend, Generate Quiz).
- Settings: You can control Mode (Auto / Offline-only / Online-only), citeSources toggle, telemetry opt-in, and storage/sync preferences from the popup settings.

---

## 6. Retention & deletion

- Preferences stored in browser (chrome.storage): persisted until you change or clear them.
- Notes & Quizzes stored server‑side: retained until you delete them or request account deletion.
- Server logs and telemetry: short-lived (example 30 days). Adjust retention to your deployment policy.
- Deletion requests: If you want your account or server-side data deleted, contact us at the support link. We will verify ownership and delete associated server-side data within a reasonable timeframe (e.g., 30 days).
- Local data: You can clear local extension storage via extension settings or browser extension manager.

---

## 7. Security

- Transport: All server communications use HTTPS (TLS).
- Data minimization: We send only the minimal payload required for cloud processing (selected text, persona, target language, source URL).
- Server-side controls: API keys and secrets are stored server-side; production API keys are never exposed to the client.
- Storage & access: Apply standard access controls on the backend (least privilege). Passwords must be hashed using strong algorithms; tokens short-lived.
- Breach notification: If a security incident affects personal data, we will follow applicable breach notification laws and inform users promptly.

---

## 8. Children & age restrictions

- The Extension is not directed to children under the age of 13 (or applicable minimum age in your jurisdiction). We do not knowingly collect personal information from children. If you learn we have collected such information without parental consent, contact us and we will delete it.

---

## 9. International transfers & legal bases

- If your backend or cloud providers operate in other countries, your data may be transferred internationally. We will apply appropriate safeguards (e.g., standard contractual clauses) where required.
- Legal bases (e.g., GDPR) for processing cloud-handled data include:
    - Consent: when you opt in or explicitly request a cloud operation.
    - Contractual/Performance: to provide the service you requested (saving notes, generating quizzes).
    - Legitimate interest: for security, abuse prevention, and debugging (balanced against user rights).
- Users subject to EU GDPR or other regional law: you have rights of access, rectification, erasure, portability, restriction, and objection. To exercise rights, contact us via the support link and we will respond within applicable timelines.

---

## 10. Analytics & telemetry

- Optional and anonymized: Any telemetry is strictly optional (opt-in) and does not include selected text or PII.
- Purpose: Improve extension reliability and performance, e.g., model download success rates, latency, retry counts.

---

## 11. Opt-out & settings

- Offline-only mode: prevents any cloud calls (on-device only) and disables auto-Find Sources.
- Telemetry: opt-out toggles in the popup settings.
- Account/library: You can delete individual notes or request account deletion.
- Clearing local extension data: Use your browser extension manager or the extension's settings.

---

## 12. Changes to this policy

We may update this Privacy Policy from time to time. When we make material changes we will update the "Effective date" and, where appropriate, notify users via the extension UI or the project repo. Your continued use after changes constitutes acceptance of the updated policy.

---

## 13. Contact & data requests

For privacy questions, data access, deletion, or other requests:
- GitHub / Support: https://github.com/ujjwalkumar-64 (open an Issue labeled "privacy" or contact through the repo)
- Email : ujjwalkumar3064@gmail.com

Include proof of identity or account ownership when requesting deletion or export of server-side data.

---

## 14. Short public disclosure (one-line)
"PageGenie processes selected text locally when possible. If you request cloud processing or save a note, minimal data (selected text + page URL and optional persona/language) is sent to our backend. We do not sell your data."

---

## 15. Developer notes (for reviewers / deployers)
- Keep production API keys server-side and out of the client bundle.
- Limit host permissions in the manifest to your backend origin(s); avoid `<all_urls>`.
- Ensure you implement data deletion endpoints or clear instructions for judges/reviewers to request deletion.
- If you publish, place this policy on the extension's item detail page and link from the extension popup or settings.
