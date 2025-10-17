console.log("[PageGenie] Content script loaded");

(function () {
    let bubble = null;
    let currentSelection = '';
    let overlay = null;
    let actionPanel = null;

    const ACTIONS = ["summarize", "rewrite", "explain", "translate", "proofread", "flashcard"];
    const LANGUAGES = [
        { code: 'en', name: 'English' },
        { code: 'es', name: 'Spanish' },
        { code: 'fr', name: 'French' },
        { code: 'de', name: 'German' },
        { code: 'it', name: 'Italian' },
        { code: 'zh', name: 'Chinese' },
        { code: 'ja', name: 'Japanese' },
        { code: 'hi', name: 'Hindi' }
    ];

    // Create floating bubble
    function createBubble() {
        if (!bubble) {
            bubble = document.createElement('div');
            bubble.id = 'pagegenie-bubble';
            Object.assign(bubble.style, {
                position: 'absolute',
                background: '#0b5cff',
                color: 'white',
                padding: '6px 8px',
                borderRadius: '8px',
                boxShadow: '0 4px 12px rgba(0,0,0,0.15)',
                zIndex: 2147483647,
                fontFamily: 'Arial, sans-serif',
                fontSize: '13px',
                cursor: 'pointer',
                display: 'none'
            });
            bubble.innerText = 'PageGenie';
            document.body.appendChild(bubble);
        }

        // Always attach click handler (re-attach safely)
        bubble.onclick = () => {
            console.log("[PageGenie] Bubble clicked. currentSelection:", currentSelection);
            if (!actionPanel && currentSelection) createActionPanel();
        };
    }



    function removeBubble() {
        if (bubble) { bubble.removeEventListener('click', onBubbleClick); bubble.remove(); bubble = null; }
        if (actionPanel) { actionPanel.remove(); actionPanel = null; }
    }

    function onBubbleClick() {
        if (!actionPanel) createActionPanel();
    }

    function createActionPanel() {
        actionPanel = document.createElement('div');
        Object.assign(actionPanel.style, {
            position: 'absolute',
            background: '#fff',
            border: '1px solid #ddd',
            borderRadius: '12px',
            padding: '10px',
            boxShadow: '0 8px 24px rgba(0,0,0,0.18)',
            zIndex: 2147483647,
            fontFamily: 'Arial, sans-serif',
            fontSize: '14px',
            minWidth: '180px'
        });

        const title = document.createElement('div');
        title.innerText = 'Choose Action';
        Object.assign(title.style, { fontWeight: '600', marginBottom: '8px', textAlign: 'center' });
        actionPanel.appendChild(title);

        ACTIONS.forEach(action => {
            const btn = document.createElement('button');
            btn.innerText = action;
            Object.assign(btn.style, {
                display: 'block',
                width: '100%',
                marginBottom: '6px',
                padding: '6px',
                cursor: 'pointer',
                background: '#f5f5f5',
                border: '1px solid #ccc',
                borderRadius: '8px',
                fontWeight: '500',
                transition: 'all 0.2s ease'
            });
            btn.addEventListener('mouseenter', () => { btn.style.background = '#0b5cff'; btn.style.color = '#fff'; });
            btn.addEventListener('mouseleave', () => { btn.style.background = '#f5f5f5'; btn.style.color = '#000'; });

            btn.addEventListener('click', () => {
                if (action === 'translate') {
                    const langContainer = document.createElement('div');
                    Object.assign(langContainer.style, { marginTop: '6px' });

                    const select = document.createElement('select');
                    LANGUAGES.forEach(lang => {
                        const option = document.createElement('option');
                        option.value = lang.code;
                        option.innerText = lang.name;
                        select.appendChild(option);
                    });
                    Object.assign(select.style, { width: '100%', padding: '6px', borderRadius: '6px', border: '1px solid #ccc' });

                    const submitBtn = document.createElement('button');
                    submitBtn.innerText = 'Translate';
                    Object.assign(submitBtn.style, {
                        width: '100%',
                        padding: '6px',
                        marginTop: '4px',
                        borderRadius: '6px',
                        border: 'none',
                        background: '#0b5cff',
                        color: '#fff',
                        cursor: 'pointer',
                        fontWeight: '600'
                    });

                    submitBtn.addEventListener('click', () => {
                        sendAIRequest(action, select.value);
                        actionPanel.remove();
                        actionPanel = null;
                    });

                    langContainer.appendChild(select);
                    langContainer.appendChild(submitBtn);
                    actionPanel.appendChild(langContainer);

                } else {
                    sendAIRequest(action);
                    actionPanel.remove();
                    actionPanel = null;
                }
            });

            actionPanel.appendChild(btn);
        });

        document.body.appendChild(actionPanel);
        const rect = bubble.getBoundingClientRect();
        actionPanel.style.left = rect.left + 'px';
        actionPanel.style.top = rect.bottom + 6 + 'px';
    }

    function showBubbleAt(x, y, text) {
        if (!bubble) createBubble();
        bubble.style.left = x + 'px';
        bubble.style.top = y + 'px';
        bubble.style.display = 'block';
        currentSelection = text;
    }

    function getSelectionRect() {
        const sel = window.getSelection();
        if (!sel || sel.rangeCount === 0) return null;
        const range = sel.getRangeAt(0).cloneRange();
        const rect = range.getBoundingClientRect();
        return (rect.width === 0 && rect.height === 0) ? null : rect;
    }

    document.addEventListener('mouseup', (e) => {
        const selection = window.getSelection().toString().trim();
        if (selection.length > 3) {
            const rect = getSelectionRect();
            const x = rect ? window.scrollX + rect.left : e.pageX + 5;
            const y = rect ? window.scrollY + rect.top - 36 : e.pageY - 36;
            showBubbleAt(x, y, selection);
        } else removeBubble();
    });

    document.addEventListener('mousedown', (e) => {
        if (bubble && !bubble.contains(e.target)) removeBubble();
    });

    function sendAIRequest(action, targetLang = 'en') {
        chrome.runtime.sendMessage({ type: 'OPEN_ACTION_PANEL', text: currentSelection, action, targetLang });
    }

    chrome.runtime.onMessage.addListener((msg) => {
        if (msg.type === 'DISPLAY_RESULT' && msg.result) showResultOverlay(msg.result);
        else if (msg.type === 'HIDE_RESULT') hideResultOverlay();
        else if (msg.type === 'TRY_LOCAL_AI') {
            (async () => {
                try {
                    if (window.ai?.createTextSession) {
                        const session = await window.ai.createTextSession();
                        const prompt = `Perform action: ${msg.action}\n\n${msg.text}`;
                        const resp = await session.prompt(prompt);
                        const resultText = typeof resp === 'string'
                            ? resp
                            : resp?.output || resp?.candidates?.[0]?.content?.parts?.[0]?.text || JSON.stringify(resp);
                        msg.sendResponse({ ok: true, result: resultText });
                    } else msg.sendResponse({ ok: false, error: 'no-local-ai' });
                } catch (e) {
                    msg.sendResponse({ ok: false, error: e.message });
                }
            })();
            return true;
        }
    });

    function showResultOverlay(text) {
        hideResultOverlay();
        overlay = document.createElement('div');
        Object.assign(overlay.style, {
            position: 'fixed',
            right: '20px',
            bottom: '20px',
            maxWidth: '420px',
            background: '#fff',
            color: '#111',
            borderRadius: '12px',
            boxShadow: '0 8px 24px rgba(0,0,0,0.18)',
            padding: '12px',
            zIndex: 2147483647,
            fontFamily: 'Arial, sans-serif',
            fontSize: '14px'
        });
        overlay.innerHTML = `
            <div style="font-weight:600;margin-bottom:6px">PageGenie</div>
            <div style="white-space:pre-wrap;margin-bottom:8px">${escapeHtml(text)}</div>
            <div style="display:flex;gap:8px;justify-content:flex-end">
                <button id="pg-copy" style="padding:6px 8px;border-radius:6px;border:1px solid #ddd;background:#f5f5f5;cursor:pointer">Copy</button>
                <button id="pg-save" style="padding:6px 8px;border-radius:6px;border:none;background:#0b5cff;color:white;cursor:pointer">Save</button>
            </div>
        `;
        document.body.appendChild(overlay);
        document.getElementById('pg-copy').addEventListener('click', () => navigator.clipboard.writeText(text));
        document.getElementById('pg-save').addEventListener('click', () => {
            chrome.runtime.sendMessage({ type: 'SAVE_NOTE', text, sourceUrl: location.href });
        });
    }

    function hideResultOverlay() { if (overlay) { overlay.remove(); overlay = null; } }

    function escapeHtml(unsafe) {
        return unsafe
            .replaceAll('&', '&amp;')
            .replaceAll('<', '&lt;')
            .replaceAll('>', '&gt;')
            .replaceAll('"', '&quot;')
            .replaceAll("'", '&#039;');
    }

})();
