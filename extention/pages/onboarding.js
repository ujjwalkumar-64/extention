(function () {
    const $ = (id) => document.getElementById(id);

    const fileAccessStatus = $("fileAccessStatus");
    const langStatus = $("langStatus");
    const sampleStatus = $("sampleStatus");

    const openExtensions = $("openExtensions");
    const checkFileAccessBtn = $("checkFileAccess");
    const copyExtensionId = $("copyExtensionId");
    const targetLang = $("targetLang");
    const saveLang = $("saveLang");
    const openSamplePdf = $("openSamplePdf");
    const done = $("done");
    const skip = $("skip");

    // Helpers
    function setStatus(el, ok, msgIfAny) {
        el.textContent = ok ? `Status: ✓ ${msgIfAny || "Ready"}` : `Status: ${msgIfAny || "not set"}`;
        el.style.color = ok ? "#22c55e" : "";
    }

    // STEP 1: File URL access
    async function checkFileAccess() {
        try {
            // chrome.extension.* is available in extension pages
            chrome.extension.isAllowedFileSchemeAccess?.((allowed) => {
                setStatus(fileAccessStatus, !!allowed, allowed ? "Allowed" : "Not allowed");
            });
        } catch {
            setStatus(fileAccessStatus, false, "Unknown");
        }
    }

    openExtensions?.addEventListener("click", async () => {
        try {
            await chrome.tabs.create({ url: "chrome://extensions/?id=" + chrome.runtime.id });
        } catch {
            alert("Couldn’t open chrome://extensions. Open it manually and enable “Allow access to file URLs”.");
        }
    });
    checkFileAccessBtn?.addEventListener("click", checkFileAccess);

    copyExtensionId?.addEventListener("click", async () => {
        try {
            await navigator.clipboard.writeText(chrome.runtime.id);
            copyExtensionId.textContent = "Copied!";
            setTimeout(() => (copyExtensionId.textContent = "Copy extension ID"), 1200);
        } catch {
            alert("Copy failed. Extension ID: " + chrome.runtime.id);
        }
    });

    // STEP 2: Target language
    async function syncLangStatus(savedValue) {
        const v = savedValue ?? (await chrome.storage.sync.get({ targetLang: "en" })).targetLang;
        targetLang.value = v || "en";
        const ok = !!v;
        setStatus(langStatus, ok, ok ? `Saved: ${v}` : "not saved");
    }
    saveLang?.addEventListener("click", async () => {
        try {
            await chrome.storage.sync.set({ targetLang: targetLang.value });
            await syncLangStatus(targetLang.value);
            saveLang.textContent = "Saved ✓";
            setTimeout(() => (saveLang.textContent = "Save language"), 1200);
        } catch {}
    });

    // STEP 3: Sample PDF
    async function syncSampleStatus() {
        try {
            const { onboardingSampleTried } = await chrome.storage.sync.get({ onboardingSampleTried: false });
            setStatus(sampleStatus, !!onboardingSampleTried, onboardingSampleTried ? "Tried" : "not tried");
        } catch {
            setStatus(sampleStatus, false, "not tried");
        }
    }
    openSamplePdf?.addEventListener("click", async () => {
        const sample = "https://arxiv.org/pdf/1706.03762.pdf";
        const readerUrl = chrome.runtime.getURL("pages/reader.html") + "?src=" + encodeURIComponent(sample) + "&ref=onboarding";
        await chrome.tabs.create({ url: readerUrl });
        // Mark as tried immediately; Reader can also reinforce this when it loads
        try { await chrome.storage.sync.set({ onboardingSampleTried: true }); } catch {}
        syncSampleStatus();
    });

    // Complete onboarding
    async function completeOnboarding(force = false) {
        // Consider onboarding complete if:
        // - targetLang is saved AND (file access is allowed OR user chooses to skip); sample is optional
        try {
            let langOk = false;
            const cfg = await chrome.storage.sync.get({ targetLang: "", onboardingSampleTried: false });
            langOk = !!cfg.targetLang;

            let fileOk = false;
            await new Promise((resolve) => {
                chrome.extension.isAllowedFileSchemeAccess?.((allowed) => {
                    fileOk = !!allowed;
                    resolve();
                });
                // Fallback resolve if API is missing
                setTimeout(resolve, 200);
            });

            if (!force && !langOk) {
                alert("Please save a target language first.");
                return;
            }

            await chrome.storage.sync.set({ onboardingCompleted: true });
            window.close();
        } catch {
            await chrome.storage.sync.set({ onboardingCompleted: true });
            window.close();
        }
    }

    done?.addEventListener("click", () => completeOnboarding(false));
    skip?.addEventListener("click", () => completeOnboarding(true));

    // Init
    (async function init() {
        await checkFileAccess();
        await syncLangStatus();
        await syncSampleStatus();
        // Re-check file access after a short delay (user might toggle and come back)
        setTimeout(checkFileAccess, 1500);
    })();
})();