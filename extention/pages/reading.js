(async function () {
    const $ = (id) => document.getElementById(id);

    const els = {
        authNote: $("authNote"),
        status: $("status"),
        profile: $("profile"),
        notesList: $("notesList"),
        suggList: $("suggList"),
        quizList: $("quizList"),
    };

    function setStatus(msg, cls = "") {
        els.status.textContent = msg || "";
        els.status.className = "status " + (cls || "");
    }
    function setAuthNote(msg, cls = "") {
        if (!msg) {
            els.authNote.style.display = "none";
            els.authNote.textContent = "";
            els.authNote.className = "status";
            return;
        }
        els.authNote.style.display = "";
        els.authNote.textContent = msg;
        els.authNote.className = "status " + (cls || "");
    }

    // Tab switching
    document.querySelectorAll(".tab").forEach((btn) => {
        btn.addEventListener("click", () => {
            document.querySelectorAll(".tab").forEach((b) => b.classList.remove("active"));
            btn.classList.add("active");
            const tab = btn.getAttribute("data-tab");
            document.querySelectorAll(".panel").forEach((p) => p.classList.remove("active"));
            document.getElementById(tab)?.classList.add("active");
        });
    });

    const { backendUrl, apiToken } = await chrome.storage.sync.get({
        backendUrl: "http://localhost:8098",
        apiToken: ""
    });

    if (!backendUrl) {
        setAuthNote("Backend URL missing. Open Options to set it.", "warn");
        setStatus("Stopped.", "warn");
        return;
    }
    if (!apiToken) {
        setAuthNote("You are not logged in. Open the PageGenie popup to log in.", "warn");
        // continue; endpoints that require auth may fail
    }

    function esc(s) { return String(s || "").replace(/[&<>"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;'}[c])); }
    function escAttr(s) { return esc(s).replace(/"/g, "&quot;"); }
    function safeParseJson(s) {
        if (!s) return null;
        if (typeof s === "object") return s;
        try { return JSON.parse(s); } catch { return null; }
    }

    async function get(path) {
        const res = await fetch(new URL(path, backendUrl), {
            headers: apiToken ? { Authorization: `Bearer ${apiToken}` } : {}
        });
        if (res.status === 401) {
            setAuthNote("Unauthorized. Please log in again from the PageGenie popup.", "err");
        }
        if (!res.ok) throw new Error(`${path} -> ${res.status}`);
        return res.json();
    }

    // Helpers
    function makeBtn(text, handler, cls = "") {
        const b = document.createElement("button");
        b.className = "pg-btn " + cls;
        b.textContent = text;
        b.addEventListener("click", handler);
        return b;
    }
    async function copyToClipboard(s) {
        try {
            await navigator.clipboard.writeText(s || "");
            setStatus("Copied to clipboard", "ok");
            setTimeout(() => setStatus(""), 900);
        } catch (e) {
            setStatus("Copy failed: " + (e?.message || String(e)), "err");
        }
    }

    function renderNotes(items) {
        els.notesList.innerHTML = "";
        if (!Array.isArray(items) || !items.length) {
            els.notesList.innerHTML = `<div class="item"><div class="sub">No notes yet.</div></div>`;
            return;
        }

        items.slice(0, 50).forEach(n => {
            const cats = safeParseJson(n.categoriesJson);
            const it = document.createElement("div");
            it.className = "item";

            const row = document.createElement("div");
            row.className = "row";

            const title = document.createElement("div");
            title.className = "title";
            const topic = cats?.topic || (n.content || "").slice(0, 60) + ((n.content || "").length > 60 ? "…" : "");
            const src = n.sourceUrl || "#";
            title.innerHTML = `<a class="link" href="${escAttr(src)}" target="_blank">${esc(topic)}</a>`;

            const sub = document.createElement("div");
            sub.className = "sub";
            const dt = n.createdAt || n.updatedAt || n.ts || Date.now();
            sub.textContent = new Date(dt).toLocaleString();

            const actions = document.createElement("div");
            actions.className = "actions";
            actions.append(
                makeBtn("Copy", () => copyToClipboard(n.content || cats?.summary || "")),
                ...(src && src !== "#" ? [makeBtn("Open", () => window.open(src, "_blank"))] : [])
            );

            row.append(title, sub, actions);

            const content = document.createElement("div");
            content.className = "sub";
            content.style.marginTop = "6px";
            content.textContent = cats?.summary || n.content || "";

            it.append(row, content);
            els.notesList.appendChild(it);
        });
    }

    // UPDATED: Suggestions now mirror Notes UI (title link + timestamp + actions + content)
    function renderSuggestions(items) {
        els.suggList.innerHTML = "";
        if (!Array.isArray(items) || !items.length) {
            els.suggList.innerHTML = `<div class="item"><div class="sub">No suggestions yet.</div></div>`;
            return;
        }

        items.forEach(s => {
            const it = document.createElement("div");
            it.className = "item";

            const row = document.createElement("div");
            row.className = "row";

            // Title + link (prefer explicit title, fallback to URL)
            const linkUrl = s.suggestedUrl || s.url || "#";
            const ttl = s.title || s.suggestedUrl || s.url || "Suggestion";

            const title = document.createElement("div");
            title.className = "title";
            title.innerHTML = linkUrl && linkUrl !== "#"
                ? `<a class="link" href="${escAttr(linkUrl)}" target="_blank">${esc(ttl)}</a>`
                : esc(ttl);

            // Timestamp (createdAt/updatedAt/ts)
            const sub = document.createElement("div");
            sub.className = "sub";
            const dt = s.createdAt || s.updatedAt || s.ts || Date.now();
            sub.textContent = new Date(dt).toLocaleString();

            // Actions (Copy/Open)
            const actions = document.createElement("div");
            actions.className = "actions";
            const contentText = s.reason || s.summary || s.excerpt || s.description || "";
            actions.append(
                makeBtn("Copy", () => copyToClipboard(contentText)),
                ...(linkUrl && linkUrl !== "#" ? [makeBtn("Open", () => window.open(linkUrl, "_blank"))] : [])
            );

            row.append(title, sub, actions);

            // Content/Reason snippet below, like Notes summary
            const content = document.createElement("div");
            content.className = "sub";
            content.style.marginTop = "6px";
            content.textContent = contentText;

            it.append(row, content);
            els.suggList.appendChild(it);
        });
    }

    function renderQuizzes(items) {
        els.quizList.innerHTML = "";
        if (!Array.isArray(items) || !items.length) {
            els.quizList.innerHTML = `<div class="item"><div class="sub">No attempts yet.</div></div>`;
            return;
        }

        items.forEach(a => {
            const total = a.questionsCount ?? a.totalQuestions ?? "?";
            const it = document.createElement("div");
            it.className = "item";

            const row = document.createElement("div");
            row.className = "row";

            const left = document.createElement("div");
            left.innerHTML = `
        <span class="badge">${esc(String(a.score ?? "?"))}/${esc(String(total))}</span>
        <span class="title">${esc(a.articleTitle || a.title || "Quiz")}</span>
      `;

            const sub = document.createElement("div");
            sub.className = "sub";
            const dt = a.createdAt || a.submittedAt || Date.now();
            sub.textContent = new Date(dt).toLocaleString();

            const actions = document.createElement("div");
            actions.className = "actions";
            // If you store quizId on attempts, you could open the quiz viewer here:
            // actions.append(makeBtn("Open", () => window.open(chrome.runtime.getURL(`quiz/quiz.html?id=${encodeURIComponent(a.quizId || "")}`), "_blank")));

            row.append(left, sub, actions);
            it.append(row);
            els.quizList.appendChild(it);
        });
    }

    try {
        setStatus("Loading your library…");

        // Use the same endpoints and shapes as your earlier working version
        const [me, attempts, notes, suggestions] = await Promise.allSettled([
            get("/api/v1/auth/me"),
            get("/api/v1/quiz/attempts/recent"),
            get("/api/notes"),
            get("/api/v1/reading/recent"),
        ]);

        // Profile
        if (me.status === "fulfilled" && me.value) {
            const fullName = me.value.fullName || me.value.name || "";
            const username = me.value.username || me.value.user || "";
            els.profile.innerHTML = `
        <div><strong>${esc(fullName || username || "User")}</strong> ${username ? `<span class="sub">@${esc(username)}</span>` : ""}</div>
      `;
        } else {
            els.profile.innerHTML = `<div class="sub">Failed to load profile.</div>`;
        }

        // Quizzes
        if (attempts.status === "fulfilled" && Array.isArray(attempts.value)) {
            renderQuizzes(attempts.value);
        } else {
            renderQuizzes([]);
        }

        // Notes
        if (notes.status === "fulfilled" && Array.isArray(notes.value)) {
            renderNotes(notes.value);
        } else {
            renderNotes([]);
        }

        // Suggestions (now same UI structure as Notes)
        if (suggestions.status === "fulfilled" && Array.isArray(suggestions.value)) {
            renderSuggestions(suggestions.value);
        } else {
            renderSuggestions([]);
        }

        setStatus("Loaded", "ok");
        setTimeout(() => setStatus(""), 1200);
    } catch (e) {
        console.error(e);
        setAuthNote("Error loading data. Check you are logged in.", "err");
        setStatus("Failed", "err");
    }
})();