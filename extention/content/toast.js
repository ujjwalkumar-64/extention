// Lightweight toast listener so background can display status/errors on any page

(function () {
    chrome.runtime.onMessage.addListener((msg) => {
        if (msg?.type === "PAGEGENIE_TOAST" && msg.message) {
            showToast(msg.message);
        }
    });

    function showToast(message) {
        const el = document.createElement("div");
        el.className = "pagegenie-toast";
        el.textContent = message;
        Object.assign(el.style, {
            position: "fixed",
            left: "20px",
            bottom: "20px",
            background: "rgba(30,30,30,0.95)",
            color: "#fff",
            padding: "10px 14px",
            borderRadius: "8px",
            opacity: "0",
            transform: "translateY(10px)",
            transition: "all .25s ease",
            zIndex: "2147483647",
            pointerEvents: "none",
            fontFamily: "system-ui, -apple-system, Segoe UI, Roboto, sans-serif"
        });
        document.documentElement.appendChild(el);
        requestAnimationFrame(() => (el.style.opacity = "1", el.style.transform = "translateY(0)"));
        setTimeout(() => {
            el.style.opacity = "0";
            el.style.transform = "translateY(10px)";
            setTimeout(() => el.remove(), 300);
        }, 2200);
    }
})();