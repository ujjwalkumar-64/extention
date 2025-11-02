document.addEventListener("DOMContentLoaded", async () => {
    const backendUrl = document.getElementById("backendUrl");
    const apiToken = document.getElementById("apiToken");
    const saveBtn = document.getElementById("save");
    const testBtn = document.getElementById("test");
    const status = document.getElementById("status");

    const st = await chrome.storage.sync.get({
        backendUrl: "https://pagegenie-backend.onrender.com",
        apiToken: ""
    });
    backendUrl.value = st.backendUrl || "http://localhost:8098";
    apiToken.value = st.apiToken || "";

    saveBtn.addEventListener("click", async () => {
        await chrome.storage.sync.set({
            backendUrl: backendUrl.value.trim(),
            apiToken: apiToken.value.trim()
        });
        status.textContent = "Saved";
        status.className = "ok";
        setTimeout(() => (status.textContent = ""), 1500);
    });

    testBtn.addEventListener("click", async () => {
        status.textContent = "Testing...";
        status.className = "";
        try {
            const url = new URL("/api/health", backendUrl.value.trim()).toString();
            const res = await fetch(url, {
                headers: apiToken.value ? { Authorization: `Bearer ${apiToken.value}` } : {}
            });
            if (!res.ok) throw new Error("HTTP " + res.status);
            status.textContent = "OK";
            status.className = "ok";
        } catch (e) {
            status.textContent = "Failed: " + (e?.message || e);
            status.className = "err";
        }
    });
});