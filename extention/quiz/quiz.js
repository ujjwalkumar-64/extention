(function () {
    const qs = new URLSearchParams(location.search);
    const quizId = qs.get("id");
    const srcUrl = qs.get("src") || "";

    const quizEl = document.getElementById("quiz");
    const metaEl = document.getElementById("meta");
    const statusEl = document.getElementById("status");
    const submitBtn = document.getElementById("submit");
    const reloadBtn = document.getElementById("reload");

    let model = null; // { questions: [ {question, options[], correctIndex, explanation} ] }

    init();

    reloadBtn.addEventListener("click", () => loadQuiz(true));
    submitBtn.addEventListener("click", submitAnswers);

    async function init() {
        if (!quizId) {
            setStatus("Missing quiz id in URL.", true);
            submitBtn.disabled = true;
            return;
        }
        setStatus("Loading quiz...");
        await loadQuiz();
    }

    async function getAuth() {
        return new Promise((resolve) => {
            chrome.storage.sync.get(
                { backendUrl: "http://localhost:8098", apiToken: "" },
                resolve
            );
        });
    }

    async function loadQuiz(force = false) {
        try {
            const { backendUrl, apiToken } = await getAuth();
            if (!backendUrl) {
                setStatus("Backend URL not configured in Options.", true);
                return;
            }
            if (!apiToken) {
                setStatus("You are not logged in. Open the PageGenie popup and log in.", true);
                return;
            }
            const url = new URL(`/api/v1/quiz/${encodeURIComponent(quizId)}`, backendUrl).toString();
            const res = await fetch(url, {
                method: "GET",
                headers: { "Authorization": `Bearer ${apiToken}` },
                credentials: "omit"
            });
            if (res.status === 401) {
                setStatus("Unauthorized. Please log in again from the PageGenie popup.", true);
                return;
            }
            if (!res.ok) {
                const t = await res.text().catch(() => "");
                throw new Error(`Failed to load quiz ${res.status}: ${t || res.statusText}`);
            }
            const data = await res.json();
            // Expecting { questions: [...] }
            model = data;
            renderQuiz();
            const srcText = srcUrl ? `Source: ${srcUrl}` : "";
            metaEl.textContent = srcText;
            setStatus("Quiz loaded.");
        } catch (e) {
            setStatus(e.message || String(e), true);
        }
    }

    function renderQuiz() {
        quizEl.innerHTML = "";
        if (!model?.questions?.length) {
            quizEl.textContent = "No questions available.";
            submitBtn.disabled = true;
            return;
        }
        submitBtn.disabled = false;

        model.questions.forEach((q, qi) => {
            const card = document.createElement("div");
            card.className = "question";

            const qt = document.createElement("div");
            qt.className = "qtext";
            qt.textContent = `${qi + 1}. ${q.question}`;
            card.appendChild(qt);

            const opts = document.createElement("div");
            opts.className = "options";
            (q.options || []).forEach((opt, oi) => {
                const id = `q${qi}_o${oi}`;
                const label = document.createElement("label");
                const inp = document.createElement("input");
                inp.type = "radio";
                inp.name = `q${qi}`;
                inp.value = String(oi);
                inp.id = id;
                label.setAttribute("for", id);
                label.appendChild(inp);
                label.appendChild(document.createTextNode(opt));
                opts.appendChild(label);
            });
            card.appendChild(opts);

            const ex = document.createElement("div");
            ex.className = "explain";
            ex.style.display = "none";
            card.appendChild(ex);

            quizEl.appendChild(card);
        });
    }

    function collectAnswers() {
        const answers = [];
        model.questions.forEach((q, qi) => {
            const checked = document.querySelector(`input[name="q${qi}"]:checked`);
            answers.push(checked ? Number(checked.value) : -1);
        });
        return answers;
    }

    async function submitAnswers() {
        try {
            const answers = collectAnswers();
            if (!answers.length) return;

            submitBtn.disabled = true;
            setStatus("Submitting...");

            const { backendUrl, apiToken } = await getAuth();
            if (!backendUrl || !apiToken) {
                setStatus("Not authenticated or backend URL missing.", true);
                submitBtn.disabled = false;
                return;
            }

            const url = new URL(`/api/v1/quiz/${encodeURIComponent(quizId)}/submit`, backendUrl).toString();
            const res = await fetch(url, {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    "Authorization": `Bearer ${apiToken}`
                },
                body: JSON.stringify({ answers }),
                credentials: "omit"
            });

            if (res.status === 401) {
                setStatus("Unauthorized. Please log in again from the PageGenie popup.", true);
                submitBtn.disabled = false;
                return;
            }
            if (!res.ok) {
                const t = await res.text().catch(() => "");
                throw new Error(`Submit failed ${res.status}: ${t || res.statusText}`);
            }

            const { score } = await res.json();

            // Show per-question feedback using local model
            model.questions.forEach((q, qi) => {
                const selected = answers[qi];
                const correct = q.correctIndex;
                const card = quizEl.children[qi];
                const labels = card.querySelectorAll(".options label");
                labels.forEach((lbl, oi) => {
                    lbl.classList.remove("correct", "incorrect");
                    if (oi === correct) lbl.classList.add("correct");
                    else if (oi === selected && selected !== correct) lbl.classList.add("incorrect");
                });
                const ex = card.querySelector(".explain");
                ex.textContent = q.explanation ? `Explanation: ${q.explanation}` : "";
                ex.style.display = "block";
            });

            setStatus(`Score: ${score}/${model.questions.length}`);
            submitBtn.disabled = false;
        } catch (e) {
            setStatus(e.message || String(e), true);
            submitBtn.disabled = false;
        }
    }

    function setStatus(text, isError = false) {
        statusEl.textContent = text;
        statusEl.style.color = isError ? "#a00" : "#333";
    }
})();