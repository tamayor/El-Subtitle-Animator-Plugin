// Effect Preset > Match Cut (src/main/match-cut.js): a news-article match cut of one word, made at the playhead. Like
// Spotlight it makes its own clip, so the card's switch (or Make) starts a run instead of adding an effect to the
// selected clip; the switch shows on while it renders. Runs are saved in
// "<footage folder>/El Subtitle Animator MatchCut/<word>/". Used by effect-list.js (fxStateOf, fxFillCard, fxToggle).

const mcUI = { prefs: null, running: false, progress: null, last: null, loading: null };

function mcLine(p) { return p ? (p.text || 'Working…') : ''; }

// Overall progress: screenshots 0-55 %, reading text 55-75 %, lining up 75-95 %, encode / place to 100 %.
function mcFraction(p) {
    if (!p) return 0;
    const f = p.total ? Math.min(1, p.done / p.total) : 0;
    return { start: 0.02, shots: 0.02 + 0.53 * f, ocr: 0.55 + 0.2 * f, render: 0.75 + 0.2 * f, encode: 0.96, place: 0.98 }[p.phase] || 0;
}

function mcCard() { return document.querySelector('#fxGrid .fx-card[data-id="MatchCut"]'); }
// Rebuild the card's options (the signature in fxFillCard changes with the run state).
function mcRefreshCard() {
    const c = mcCard();
    if (!c || !c._fx) return;
    const e = fxUI.effects.find(x => x.id === 'MatchCut');
    if (e) fxFillCard(c, e);
}

async function mcEnsurePrefs() {
    if (mcUI.prefs) return mcUI.prefs;
    if (!mcUI.loading) {
        mcUI.loading = window.sa.matchCutDefaults().then(r => {
            mcUI.prefs = (r && r.prefs) || {};
            mcUI.defaults = (r && r.defaults) || {};
            if (r && r.status && r.status.running) { mcUI.running = true; mcUI.progress = r.status.progress; }
            return mcUI.prefs;
        }).catch(() => { mcUI.prefs = {}; return mcUI.prefs; });
    }
    return mcUI.loading;
}

async function mcRun() {
    if (mcUI.running) return;
    await mcEnsurePrefs();
    const word = String(mcUI.prefs.word || '').trim();
    if (!word) { setStatus('Article Text Match Cut: type the word to match on first.', 'bad'); fxShow('MatchCut', true); mcRefreshCard(); return; }
    mcUI.running = true; mcUI.last = null; mcUI.progress = { phase: 'start', text: 'Starting…' };
    mcRefreshCard();
    let r;
    try { r = await window.sa.matchCutRun({ ...mcUI.prefs, word }); } catch (err) { r = { error: String(err && err.message || err) }; }
    mcUI.running = false;
    if (r && r.error && !mcUI.last) { mcUI.last = { phase: 'error', text: r.error }; setStatus('Article Text Match Cut: ' + r.error, 'bad'); }
    mcRefreshCard();
}

function fxMatchCutOptions() {
    const d = document.createElement('div');
    d.className = 'fx-opts fx-mc-opts';
    for (const ev of ['click', 'mousedown', 'pointerdown']) d.addEventListener(ev, (x) => x.stopPropagation());
    if (!mcUI.prefs) { mcEnsurePrefs().then(mcRefreshCard); d.textContent = 'Loading…'; return d; }
    const p = mcUI.prefs, busy = mcUI.running;
    const note = (t, cls) => { const x = document.createElement('div'); x.className = 'fx-note' + (cls ? ' ' + cls : ''); x.textContent = t; d.appendChild(x); return x; };
    const row = (label, el, tip) => { const r = document.createElement('label'); r.className = 'fx-strength'; if (tip) r.title = tip; const c = document.createElement('span'); c.className = 'fx-strength-cap'; c.textContent = label; r.append(c, el); d.appendChild(r); return r; };
    const num = (k, min, max, step) => {
        const i = document.createElement('input'); i.type = 'number'; i.min = String(min); i.max = String(max); i.step = String(step); i.value = String(p[k]);
        i.className = 'fx-mc-num'; i.disabled = busy;
        if (mcUI.defaults && mcUI.defaults[k] !== undefined) i.dataset.default = String(mcUI.defaults[k]);
        i.addEventListener('change', () => { p[k] = Number(i.value); });
        return i;
    };
    const check = (k, label, tip) => {
        const l = document.createElement('label'); l.className = 'fx-check'; if (tip) l.title = tip;
        const cb = document.createElement('input'); cb.type = 'checkbox'; cb.checked = !!p[k]; cb.disabled = busy;
        cb.addEventListener('change', () => { p[k] = cb.checked; });
        l.append(cb, document.createTextNode(label)); return l;
    };

    note('Finds news articles that use the word, lines them up on it and places the clip at the playhead. Saved next to the El Subtitle Animator SFX folder.');

    // word + Make
    const wr = document.createElement('div'); wr.className = 'fx-opt-row';
    const w = document.createElement('input'); w.type = 'text'; w.placeholder = 'Word, e.g. AI'; w.maxLength = 60;
    w.value = p.word || ''; w.disabled = busy; w.style.flex = '1'; w.style.minWidth = '0';
    w.addEventListener('input', () => { p.word = w.value; });
    w.addEventListener('keydown', (ev) => { if (ev.key === 'Enter') { ev.preventDefault(); p.word = w.value; mcRun(); } });
    const go = document.createElement('button'); go.type = 'button'; go.className = 'btn small fx-track-btn';
    if (busy) {
        go.textContent = 'Cancel';
        go.addEventListener('click', () => window.sa.matchCutCancel());
    } else {
        go.textContent = 'Make';
        go.title = 'Make the match cut at the playhead (1-4 minutes)';
        go.addEventListener('click', () => { p.word = w.value; mcRun(); });
    }
    wr.append(w, go);
    d.appendChild(wr);

    // progress / last result
    if (busy || mcUI.last) {
        const bar = document.createElement('div'); bar.className = 'fx-mc-bar';
        const fill = document.createElement('i'); fill.style.width = Math.round(mcFraction(busy ? mcUI.progress : null) * 100) + '%';
        bar.appendChild(fill);
        if (busy) d.appendChild(bar);
        const m = note(busy ? mcLine(mcUI.progress) : mcLine(mcUI.last), 'fx-mc-msg' + (!busy && mcUI.last.phase === 'error' ? ' fx-mc-bad' : ''));
        if (!busy && mcUI.last.phase === 'done') {
            const open = document.createElement('button'); open.type = 'button'; open.className = 'btn small fx-track-btn'; open.textContent = 'Folder';
            open.title = 'Open the run’s folder (screenshots, report, MP4)';
            open.addEventListener('click', () => window.sa.matchCutOpen());
            m.appendChild(open);
        }
    }

    row('Articles', num('count', 2, 40, 1), 'How many articles to cut between');
    const sp = document.createElement('div'); sp.className = 'fx-opt-row';
    const cap = document.createElement('span'); cap.className = 'fx-strength-cap'; cap.textContent = 'Cut frames';
    cap.title = 'Frames per article: the cuts speed up from the first value to the second';
    const arrow = document.createElement('span'); arrow.className = 'meta'; arrow.textContent = '→';
    sp.append(cap, num('startFrames', 1, 30, 1), arrow, num('endFrames', 1, 30, 1));
    d.appendChild(sp);
    row('Hold last (s)', num('hold', 0, 10, 0.1), 'How long the last article stays on screen');

    const mr = document.createElement('div'); mr.className = 'fx-opt-row';
    const col = document.createElement('input'); col.type = 'color'; col.value = p.highlightColor || '#8ccf8e'; col.disabled = busy; col.title = 'Marker colour';
    col.addEventListener('input', () => { p.highlightColor = col.value; });
    mr.append(check('highlight', 'Marker', 'A highlighter mark behind the word'), col, check('sfx', 'Click per cut'), check('place', 'Place at playhead', 'Off: only render the MP4'));
    d.appendChild(mr);
    return d;
}

// Progress from the main process (also for runs started by Claude through the MCP tool match_cut).
if (window.sa && window.sa.onMatchCutProgress) {
    window.sa.onMatchCutProgress((p) => {
        if (p.phase === 'done' || p.phase === 'error') {
            mcUI.running = false; mcUI.last = p; mcUI.progress = null;
            setStatus('Article Text Match Cut “' + p.word + '”: ' + p.text, p.phase === 'done' ? 'ok' : 'bad');
            mcRefreshCard();
            return;
        }
        const was = mcUI.running;
        mcUI.running = true; mcUI.progress = p;
        setStatus('Article Text Match Cut “' + p.word + '”: ' + mcLine(p), '');
        const c = mcCard();
        const msg = c && c.querySelector('.fx-mc-msg'), fill = c && c.querySelector('.fx-mc-bar i');
        if (!was || !msg) { mcRefreshCard(); return; }
        msg.textContent = mcLine(p);
        if (fill) fill.style.width = Math.round(mcFraction(p) * 100) + '%';
    });
}
