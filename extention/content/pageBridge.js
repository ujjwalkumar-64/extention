// Runs in page context (not content script isolated world)
// Bridges on-device AI (e.g., Prompt API / Gemini Nano) via window.ai (experimental)
// Communicates with content script using postMessage

(function () {
    async function createSession() {
        if (!("ai" in window) || !window.ai?.canCreateTextSession) {
            throw new Error("On-device AI API unavailable");
        }
        // Options can be tuned (temperature, topK)
        const session = await window.ai.createTextSession?.({
            temperature: 0.2
        }) || await window.ai.createTextSession();
        if (!session?.prompt) {
            throw new Error("On-device AI session not available");
        }
        return session;
    }

    function buildPrompt(operation, text, targetLang) {
        switch (operation) {
            case "summarize":
                return `Summarize the following text concisely in bullet points. Return only the summary.\n\n---\n${text}\n---`;
            case "explain":
                return `Explain the following text for a general audience. Be clear and concise. Return only the explanation.\n\n---\n${text}\n---`;
            case "rewrite":
                return `Rewrite the following text to improve clarity and flow without changing meaning. Return only the rewritten text.\n\n---\n${text}\n---`;
            case "proofread":
                return `Proofread and correct grammar and spelling. Keep the original meaning and voice. Return only the corrected text.\n\n---\n${text}\n---`;
            case "translate":
                return `Translate the following text to ${targetLang || "en"}. Return only the translation.\n\n---\n${text}\n---`;
            case "comment_code":
                return `Add explanatory comments to this code using appropriate line comments (// or #) without changing functionality. Return the full commented code.\n\n---\n${text}\n---`;
            default:
                return `Process:\n${text}`;
        }
    }

    window.addEventListener("message", async (event) => {
        if (event.source !== window) return;
        const data = event.data;
        if (!data || data.type !== "PAGEGENIE_AI_REQUEST") return;

        const { id, operation, text, targetLang } = data;
        const response = { type: "PAGEGENIE_AI_RESPONSE", id, ok: false };

        try {
            const session = await createSession();
            const prompt = buildPrompt(operation, text, targetLang);
            const out = await session.prompt(prompt);
            response.ok = true;
            response.result = String(out || "");
        } catch (e) {
            response.ok = false;
            response.error = e?.message || String(e);
        }

        window.postMessage(response, "*");
    });
})();