(async function () {
    const els = {
        authNote: document.getElementById("authNote"),
        profile: document.getElementById("profile"),
        quizzes: document.getElementById("quizzes"),
        notes: document.getElementById("notes"),
        suggestions: document.getElementById("suggestions"),
    };

    const { backendUrl, apiToken } = await chrome.storage.sync.get({
        backendUrl: "http://localhost:8098",
        apiToken: ""
    });

    if (!backendUrl) {
        els.authNote.innerHTML = 'Backend URL missing. Open Options to set it.';
        return;
    }
    if (!apiToken) {
        els.authNote.innerHTML = 'You are not logged in. Open the PageGenie popup to login.';
    }

    function h(text) {
        const div = document.createElement("div");
        div.textContent = text;
        return div;
    }

    async function get(path) {
        const res = await fetch(new URL(path, backendUrl), {
            headers: apiToken ? { Authorization: `Bearer ${apiToken}` } : {}
        });
        if (!res.ok) throw new Error(`${path} -> ${res.status}`);
        return res.json();
    }

    try {
        const [me, attempts, notes, suggestions] = await Promise.allSettled([
            get("/api/v1/auth/me"),
            get("/api/v1/quiz/attempts/recent"),
            get("/api/notes"),
            get("/api/v1/reading/recent"),
        ]);

        // Profile
        if (me.status === "fulfilled") {
            els.profile.innerHTML = `
        <div><strong>${esc(me.value.fullName || me.value.username)}</strong> <span class="muted">@${esc(me.value.username)}</span></div>
      `;
        } else {
            els.profile.innerHTML = `<div class="err">Failed to load profile</div>`;
        }

        // Quizzes
        els.quizzes.innerHTML = "";
        if (attempts.status === "fulfilled" && Array.isArray(attempts.value) && attempts.value.length) {
            attempts.value.forEach(a => {
                const total = a.questionsCount ?? a.totalQuestions ?? "?";
                const d = document.createElement("div");
                d.innerHTML = `
          <div>
            <span class="badge">${a.score}/${total}</span>
            ${esc(a.articleTitle || "Quiz")}
          </div>
          <div class="muted">${new Date(a.createdAt).toLocaleString()}</div>
        `;
                els.quizzes.appendChild(d);
            });
        } else {
            els.quizzes.appendChild(h("No attempts yet."));
        }

        // Notes
        els.notes.innerHTML = "";
        if (notes.status === "fulfilled" && Array.isArray(notes.value) && notes.value.length) {
            notes.value.slice(0, 10).forEach(n => {
                const cats = safeParseJson(n.categoriesJson);
                const row = document.createElement("div");
                row.innerHTML = `
          <div><a href="${escAttr(n.sourceUrl || '#')}" target="_blank">${esc(cats?.topic || (n.content || '').slice(0, 40) + '…')}</a></div>
          <div class="muted">${new Date(n.createdAt).toLocaleString()}</div>
        `;
                els.notes.appendChild(row);
            });
        } else {
            els.notes.appendChild(h("No notes yet."));
        }

        // Suggestions
        els.suggestions.innerHTML = "";
        if (suggestions.status === "fulfilled" && Array.isArray(suggestions.value) && suggestions.value.length) {
            suggestions.value.forEach(s => {
                const row = document.createElement("div");
                row.innerHTML = `
          <div><a href="${escAttr(s.suggestedUrl || s.url || '#')}" target="_blank">${esc(s.title || s.suggestedUrl || s.url)}</a></div>
          ${s.reason ? `<div class="muted">${esc(s.reason)}</div>` : ""}
        `;
                els.suggestions.appendChild(row);
            });
        } else {
            els.suggestions.appendChild(h("No suggestions yet."));
        }
    } catch (e) {
        console.error(e);
        els.authNote.innerHTML = 'Error loading data. Check you are logged in.';
    }

    function esc(s) { return String(s || "").replace(/[&<>"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c])); }
    function escAttr(s) { return esc(s).replace(/"/g, "&quot;"); }
    function safeParseJson(s) {
        if (!s) return null;
        if (typeof s === "object") return s;
        try { return JSON.parse(s); } catch { return null; }
    }
})();