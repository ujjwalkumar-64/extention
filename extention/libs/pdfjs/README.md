# pdf.js (ESM) vendor files for PageGenie

As of pdf.js v4, the UMD builds are no longer provided. Use the ESM builds:

Required files (copy verbatim into your extension):
- `libs/pdfjs/pdf.min.mjs`
- `libs/pdfjs/pdf.worker.min.mjs`

How to obtain:
- npm (recommended):
    1) `npm i pdfjs-dist@latest`
    2) Copy:
        - `node_modules/pdfjs-dist/build/pdf.min.mjs`        → `libs/pdfjs/pdf.min.mjs`
        - `node_modules/pdfjs-dist/build/pdf.worker.min.mjs` → `libs/pdfjs/pdf.worker.min.mjs`

- GitHub Releases:
    - Download from https://github.com/mozilla/pdf.js/releases
    - Place the two ESM files as above.

Usage in MV3:
- Load the library with dynamic `import(chrome.runtime.getURL("libs/pdfjs/pdf.min.mjs"))`.
- Create a module Worker and assign it:
  ```js
  const workerUrl = chrome.runtime.getURL("libs/pdfjs/pdf.worker.min.mjs");
  const pdfjsLib = await import(chrome.runtime.getURL("libs/pdfjs/pdf.min.mjs"));
  pdfjsLib.GlobalWorkerOptions.workerPort = new Worker(workerUrl, { type: "module" });
  ```
- Do NOT use `workerSrc` with ESM; it’s ignored. Use `workerPort` with a module Worker.

Manifest:
- Ensure both `.mjs` files are listed in `web_accessible_resources` with `"use_dynamic_url": true`.

Local files:
- To read `file://` PDFs, enable “Allow access to file URLs” for this extension in `chrome://extensions`.

License:
- pdf.js is Apache-2.0. Keep LICENSE/NOTICE if redistributing binaries.