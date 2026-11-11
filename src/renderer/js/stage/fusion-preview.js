// Real Fusion preview of the live subtitle: when to (re)render and which render the stage shows.

// ---------------------------------------------------------------- real Fusion preview with the live subtitle
// Renders the preset in Fusion with the subtitle's own text (only the text changes, every node and keyframe stays as
// the preset was built), then the stage plays those real first-3-seconds frames.
const subPv = { key: null, timer: 0, running: false, failed: new Map(), done: new Set() };
const designTouched = new Set();   // presets whose text design was edited in this session
function normSub(t) { return String(t || '').replace(/\r\n/g, '\n').trim(); }
function currentSubText() {
    return (($('subText') && $('subText').value.trim()) || (state.live && state.live.subtitle && state.live.subtitle.text) || '');
}
// Stable fingerprint of a text design (sorted keys, no derived animation data), to tell whether frames match it.
function designKeyOf(td) {
    const norm = (v) => {
        if (Array.isArray(v)) return v.map(norm);
        if (v && typeof v === 'object') {
            const o = {};
            for (const k of Object.keys(v).sort()) {
                if (k === 'animSpec' || k === 'selectedElement' || v[k] === undefined) continue;
                o[k] = norm(v[k]);
            }
            return o;
        }
        return typeof v === 'number' ? Math.round(v * 1e5) / 1e5 : v;
    };
    try { return JSON.stringify(norm(td || null)); } catch (e) { return ''; }
}
function previewMatchesText(a, text) {
    const want = normSub(text);
    if (!want) return true;   // no subtitle: any real render is fine
    return !!(a && a.preview && typeof a.preview.text === 'string' && normSub(a.preview.text) === want);
}
function stageRendering(S, a) {
    if (S === 'U' && state.use && a && state.use.id === a.id && state.use.rendering) return true;
    return !!(a && window.SAThumbs && SAThumbs.isBusy && SAThumbs.isBusy(a.id));
}
// Use tab: the one-time render (subtitle text and/or override design) stands in for the preset's own frames.
function useView(a) {
    const u = state.use;
    if (!a || !u || u.id !== a.id || !u.tempPreview) return a;
    if (!normSub(currentSubText())) return a;   // no (enabled) subtitle and nothing typed: the preset as saved
    const t = u.tempPreview;
    if (!u._viewCache || u._viewCache.t !== t || u._viewCache.a !== a) {
        u._viewCache = { t, a, v: Object.assign({}, a, { preview: t.preview, previewFiles: t.previewFiles, previewWhite: t.previewWhite || null }) };
    }
    const v = u._viewCache.v;
    // A new render takes over only once all its frames are loaded and keyed; until then the last one keeps playing,
    // so the viewer never blinks or shows a half-loaded animation.
    if (window.SAThumbs && SAThumbs.ready && !SAThumbs.ready(v)) return (u._shown && u._shown.id === a.id && SAThumbs.ready(u._shown)) ? u._shown : a;
    u._shown = v;
    return v;
}
// Preset cards show the subtitle too. The selected preset's card mirrors the viewer (subtitle + Use tab changes);
// the other cards get a render of the subtitle with their saved design, made one at a time in the background once
// the subtitle and the playhead have settled. These never replace a preset's saved default preview.
const subCards = new Map();      // preset id -> { text, temp }
// Light cards: a card that is neither selected nor under the pointer plays only the first LIGHT_FRAMES frames of its
// sample render (a short GIF-like loop that then holds), so the Use tab decodes and keys 10 frames per card instead of
// about 80. Hovering a card plays its full sample frames and, with Auto render on, renders it with the current
// subtitle in Resolve (see hover handling below). The selected preset's card keeps mirroring the viewer.
const LIGHT_FRAMES = 10;
const lightViews = new Map();    // preset id -> { stamp, n, view }
const cardHover = { id: null, timer: 0 };
function lightView(a) {
    if (!a || !a.preview || !a.previewFiles || a.previewFiles.length <= LIGHT_FRAMES) return a;
    const stamp = a.preview.stamp || 0, n = a.previewFiles.length;
    const hit = lightViews.get(a.id);
    if (hit && hit.stamp === stamp && hit.n === n && hit.src === a) return hit.view;
    // Frames spread evenly over the capture (first, ..., last) rather than the first ten in a row: the first frames
    // of many presets hold no text yet (the words fly in later), and the loop ends on the animation's final look.
    const idx = Array.from({ length: LIGHT_FRAMES }, (_, i) => Math.round(i * (n - 1) / (LIGHT_FRAMES - 1)));
    const pick = (arr) => (Array.isArray(arr) && arr.length === n) ? idx.map(i => arr[i]) : null;
    const preview = Object.assign({}, a.preview, { count: LIGHT_FRAMES, map: undefined });       // each chosen frame loads its own file
    const view = Object.assign({}, a, { preview, previewFiles: pick(a.previewFiles), previewWhite: pick(a.previewWhite) });
    lightViews.set(a.id, { stamp, n, src: a, view });
    return view;
}
function cardView(a) {
    if (!a) return a;
    const want = normSub(currentSubText());
    if (state.use && state.use.id === a.id) {
        const v = useView(a);
        if (v !== a) return v;
        return a;
    }
    const hovered = cardHover.id === a.id;
    const c = subCards.get(a.id);
    if (hovered && want && c && c.text === want && c.temp) {
        if (!c.view) c.view = Object.assign({}, a, { preview: c.temp.preview, previewFiles: c.temp.previewFiles, previewWhite: c.temp.previewWhite || null });
        if (!window.SAThumbs || !SAThumbs.ready || SAThumbs.ready(c.view)) return c.view;
    }
    return hovered ? a : lightView(a);
}
// Pointer over a preset card: that card plays its full frames at once; after a short dwell (not a pass-over) the
// preset is rendered with the current subtitle in Resolve, once per subtitle text, when Auto render is on.
function setCardHover(id) {
    if (cardHover.id === id) return;
    cardHover.id = id;
    clearTimeout(cardHover.timer); cardHover.timer = 0;
    if (!id) return;
    cardHover.timer = setTimeout(() => { cardHover.timer = 0; hoverRender(id).catch(() => { /* a convenience */ }); }, 350);
}
async function hoverRender(id) {
    if (cardHover.id !== id || state.autoRender === false || state.idle || state.tab !== 'apply') return;
    const want = normSub(currentSubText());
    if (!want || !state.live || !state.live.ok || !window.sa || !window.sa.makePreview) return;
    const a = libEntry(id);
    if (!a || a.missing || (state.use && state.use.id === id)) return;
    const c = subCards.get(id);
    if (c && c.text === want && c.temp) return;
    if (subPv.hoverRunning) return;
    const u = state.use;
    if (state.busy || state.drag || state.stageDrag || state.preview || (u && (u._timer || u.rendering)) || subPv.running) return;
    if (window.SAThumbs && SAThumbs.isBusy && state.lib.animations.some(x => SAThumbs.isBusy(x.id))) return;
    subPv.hoverRunning = true;
    if (window.SAThumbs && SAThumbs.markBusy) SAThumbs.markBusy(id, true);
    let res;
    try { res = await window.sa.makePreview(id, want, null, '', 'sub', boxRenderList(a, a, want, true)); } catch (e) { res = { error: String(e && e.message || e) }; }
    if (window.SAThumbs && SAThumbs.markBusy) SAThumbs.markBusy(id, false);
    subPv.hoverRunning = false;
    if (res && res.temp && !res.error) subCards.set(id, { text: want, temp: res.temp });
}
document.addEventListener('mouseover', (e) => {
    const card = e.target && e.target.closest ? e.target.closest('#animGrid .card') : null;
    setCardHover(card ? (card.dataset.id || null) : null);
});
document.addEventListener('mouseleave', () => setCardHover(null));
(function () {
    let lastSub = '', subSince = 0, lastFrame = null, frameSince = 0, running = false;
    const failed = new Set();
    // Cards keep their default look (sample text). Only the selected preset is rendered, by the viewer below.
    const RENDER_ALL_CARDS_WITH_SUBTITLE = false;
    setInterval(async () => {
        try {
            if (!RENDER_ALL_CARDS_WITH_SUBTITLE) return;
            const want = normSub(currentSubText());
            const now = Date.now();
            if (want !== lastSub) { lastSub = want; subSince = now; }
            const fr = state.live && state.live.frame;
            if (fr !== lastFrame) { lastFrame = fr; frameSince = now; }
            if (running || !want || state.tab !== 'apply' || !state.live || !state.live.ok) return;
            if (now - subSince < 1500 || now - frameSince < 1500) return;               // still scrubbing / typing
            const u = state.use;
            if (state.busy || state.drag || state.stageDrag || state.preview || (u && (u._timer || u.rendering)) || (subPv && subPv.running)) return;
            if (window.SAThumbs && SAThumbs.isBusy && state.lib.animations.some(x => SAThumbs.isBusy(x.id))) return;
            const next = state.lib.animations.find(x => !x.missing && !(u && u.id === x.id) && passesTagFilter(x, 'use')
                && !failed.has(x.id + '\u0000' + want) && !(subCards.get(x.id) && subCards.get(x.id).text === want));
            if (!next) return;
            running = true;
            if (window.SAThumbs && SAThumbs.markBusy) SAThumbs.markBusy(next.id, true);
            let res;
            try { res = await window.sa.makePreview(next.id, want, null, '', 'sub', boxRenderList(next, next, want, true)); } catch (e) { res = { error: String(e && e.message || e) }; }
            if (window.SAThumbs && SAThumbs.markBusy) SAThumbs.markBusy(next.id, false);
            running = false;
            if (res && res.error) { if (!/busy/i.test(res.error)) failed.add(next.id + '\u0000' + want); return; }
            if (res && res.temp) subCards.set(next.id, { text: want, temp: res.temp });
        } catch (e) { running = false; }
    }, 700);
})();

// How many pixels the viewer really shows the timeline frame at (Retina included): renders are made at that size,
// not bigger, which is what keeps them quick. Rounded up so small layout changes reuse the same size.
function stageDim(S) {
    const cv = $('stage' + S);
    const vp = cv && cv._viewport;
    if (!vp) return 0;
    const px = Math.max(vp.vw, vp.vh) * Math.max(1, Math.min(2, cv._zoom || 1));
    return Math.ceil(px / 128) * 128;
}

// Several Text+: each box's own text / position / Text Design is part of what has to be rendered.
function boxOverrides(m, a) {
    return !!(window.SABoxes && SABoxes.hasOverrides && SABoxes.hasOverrides(m, a, currentSubText()));
}
function boxRenderKey(m, a) {
    return (window.SABoxes && SABoxes.renderKey) ? SABoxes.renderKey(m, a, currentSubText()) : '';
}
function boxRenderList(m, a, sub, withText) {
    if (!window.SABoxes || !m || !a) return null;
    const ns = SABoxes.nodesOf(a);
    if (ns.length < 2 && !ns.some(n => n.kind === 'multitext')) return null;
    try { return JSON.parse(JSON.stringify(SABoxes.payload(m, a, sub, withText))); } catch (e) { return null; }
}

// A quick low-resolution draft of the Use tab render arrives first; the full-size render replaces it when done.
if (window.sa && window.sa.onPreviewDraft) window.sa.onPreviewDraft((d) => {
    const u = state.use;
    if (!u || !d || !d.temp || u.id !== d.id || !u.rendering || u.renderReq !== d.key) return;
    u.tempPreview = d.temp;
    redrawStages();
});

// Use tab: one render per change of subtitle text, override design or text box, into a temporary preview only.
// manual: the Render button. With Auto render off nothing else starts a render (every change would otherwise cost
// Resolve a render of about 75 frames); a render already asked for still finishes.
function ensureUsePreview(a, manual) {
    if (state.idle || state.colorPicking) return;      // no Fusion render while the colour picker is open
    if (state.autoRender === false && !manual) return;
    const u = state.use;
    if (!a || a.missing || !u || u.id !== a.id || !window.sa || !window.sa.makePreview) return;
    const want = normSub(currentSubText());
    const rev = u.designRev || 0;
    const bkey = boxRenderKey(u, a);
    const skey = textStylePreviewKey();      // Use tab Text Style: the forced font / colour is part of the render
    if (!want) return;      // no enabled subtitle at the playhead and nothing typed: nothing to render (the saved preview shows)
    const reqKey = want + '\u0000' + rev + '\u0000' + bkey + '\u0000' + skey;
    if (u.renderReq === reqKey || u.rendering) return;
    if (u._timerKey === reqKey && u._timer) return;
    clearTimeout(u._timer);
    u._timerKey = reqKey;
    const frame0 = state.live && state.live.frame;
    u._timer = setTimeout(async () => {
        u._timer = 0; u._timerKey = null;
        const playheadMoved = !!(state.live && state.live.frame !== frame0) && !state.livePrev && !(state.scrub && state.scrub.U && state.scrub.U.on);
        if (state.use !== u || playheadMoved || state.busy || state.drag || state.stageDrag || state.preview
            || normSub(currentSubText()) !== want || (u.designRev || 0) !== rev || boxRenderKey(u, a) !== bkey || textStylePreviewKey() !== skey || state.tab !== 'apply') {
            // not now: try again shortly instead of waiting for the next redraw (which may never come)
            setTimeout(() => { if (state.use === u && !u.rendering) ensureUsePreview(a, manual); }, 600);
            return;
        }
        u.renderReq = reqKey;
        u.rendering = true;
        u.renderStart = Date.now();
        redrawStages();
        let res;
        const look = textStyleLook(a, false);
        const design = textStyleDesign(cloneTextDesign(u.textDesign), look);
        const blist = textStyleBoxList(boxRenderList(u, a, currentSubText(), true), a, look, u.textDesign);
        try { res = await window.sa.makePreview(a.id, want || null, design, '', true, blist, { maxDim: stageDim('U'), draftKey: reqKey }); } catch (e) { res = { error: String(e && e.message || e) }; }
        u.rendering = false;
        if (res && res.error) {
            if (/busy/i.test(res.error)) {
                u.renderReq = null;      // try again shortly: a single change (e.g. from the macOS colour panel) gives no later redraw, so one is scheduled
                setTimeout(() => { if (state.use === u && !u.rendering) redrawStages(); }, 700);
            }
            else { u._renderFailed = reqKey; setStatus(res.error, 'bad'); }
            redrawStages();
            return;
        }
        if (state.use === u && res && res.temp) { u.tempPreview = res.temp; u._viewCache = null; }
        setStatus('Preview ready.', 'ok');
        redrawStages();
    }, 250);
}
function syncStageOverlay(S, on) {
    const box = $('stageBox' + S);
    if (!box) return;
    let o = box.querySelector(':scope > .render-ov');
    if (on && !o && window.SAThumbs && SAThumbs.renderOverlay) {
        // While the last render keeps playing, only a small "Updating" pill shows in the corner; the full overlay
        // is kept for the very first render, when there is nothing to show yet.
        o = SAThumbs.renderOverlay(true);
        o.classList.add('quiet');
        o.querySelector('.render-lbl').textContent = 'Updating…';
        box.appendChild(o);
        o._delay = setTimeout(() => o.classList.add('shown'), 250);   // quick renders never flash it at all
    } else if (!on && o) { clearTimeout(o._delay); o.remove(); }
}
// One render per change: a preset is re-rendered only when the subtitle text changes or you edit its design
// (each edit bumps its design revision). Once a (text, revision) pair has been rendered it is never rendered again,
// whatever the reloaded library looks like afterwards, so it can never loop.
const designRev = new Map();      // preset id -> number of design edits this session
const lastRendered = new Map();   // preset id -> 'text|revision' last rendered successfully
// Create tab: renders the preset's default preview with its sample text when its default design is edited.
function ensureRealPreview(a, m) {
    if (state.idle || state.colorPicking) return;      // no Fusion render while the colour picker is open
    if (!a || a.missing || !window.sa || !window.sa.makePreview) return;
    const want = '';
    const rev = designRev.get(a.id) || 0;
    const reqKey = want + '\u0000' + rev;
    if (lastRendered.get(a.id) === reqKey) return;                                    // already rendered once
    if (rev === 0 && a.preview && previewMatchesText(a, want)) return;                // untouched design, frames fit
    const key = a.id + '\u0000' + reqKey;
    if (subPv.running || subPv.failed.has(key)) return;
    if (subPv.key === key && subPv.timer) return;
    clearTimeout(subPv.timer);
    subPv.key = key;
    const frame0 = state.live && state.live.frame;
    subPv.timer = setTimeout(async () => {
        subPv.timer = 0;
        // Wait while Resolve is playing / scrubbing, the panel is busy, or the design is still being changed.
        const cur = state.tab === 'apply' ? selected() : libEntry(state.createId);
        const curM = (state.tab === 'apply' && state.use) ? state.use : cur;
        if ((state.live && state.live.frame !== frame0) || state.busy || state.drag || state.stageDrag || state.preview
            || !cur || cur.id !== a.id
            || (designRev.get(a.id) || 0) !== rev) { subPv.key = null; return; }
        const td = (curM && curM.textDesign) || cur.textDesign || null;
        subPv.running = true;
        lastRendered.set(a.id, reqKey);       // claim it now so nothing can queue the same render again
        if (window.SAThumbs && SAThumbs.markBusy) SAThumbs.markBusy(a.id, true);
        let res;
        try { res = await window.sa.makePreview(a.id, want || null, td ? cloneTextDesign(td) : null, designKeyOf(td), false, boxRenderList(curM || cur, cur, '', false), { maxDim: Math.max(stageDim('C'), 1280) }); } catch (e) { res = { error: String(e && e.message || e) }; }
        subPv.running = false;
        subPv.key = null;
        if (window.SAThumbs && SAThumbs.markBusy) SAThumbs.markBusy(a.id, false);
        if (res && res.error) {
            if (lastRendered.get(a.id) === reqKey) lastRendered.delete(a.id);
            if (!/busy/i.test(res.error)) { subPv.failed.set(key, res.error); setStatus(res.error, 'bad'); }
            return;
        }
        if (res && res.lib) { state.lib = res.lib; syncUse(false); }
        setStatus('Preview ready.', 'ok');
        renderAll();
        redrawStages();
    }, 250);
}

// Presets with no preview (never rendered, or their frames were deleted) get one rendered in the background: one at
// a time, only while the panel is idle and Resolve is connected, and a preset that fails is not retried this session.
(function () {
    const failed = new Set();
    let running = false;
    setInterval(async () => {
        try {
            if (running || state.idle || state.autoRender === false || !window.sa || !window.sa.makePreview) return;
            if (!state.live || !state.live.ok || !state.lib || !state.lib.animations) return;
            const u = state.use;
            if (state.busy || state.drag || state.stageDrag || state.preview || state.livePrev
                || (u && (u._timer || u.rendering)) || (subPv && subPv.running)) return;
            if (window.SAThumbs && SAThumbs.isBusy && state.lib.animations.some(x => SAThumbs.isBusy(x.id))) return;
            const next = state.lib.animations.find(x => !x.missing && !x.preview && !failed.has(x.id));
            if (!next) return;
            running = true;
            if (window.SAThumbs && SAThumbs.markBusy) SAThumbs.markBusy(next.id, true);
            const td = next.textDesign || null;
            let res;
            try { res = await window.sa.makePreview(next.id, null, td ? cloneTextDesign(td) : null, designKeyOf(td), false, boxRenderList(next, next, '', false), { maxDim: 720 }); } catch (e) { res = { error: String(e && e.message || e) }; }
            if (window.SAThumbs && SAThumbs.markBusy) SAThumbs.markBusy(next.id, false);
            running = false;
            if (res && res.error) { if (!/busy/i.test(res.error)) failed.add(next.id); return; }
            if (res && res.lib) { state.lib = res.lib; syncUse(false); renderAll(); redrawStages(); }
        } catch (e) { running = false; }
    }, 2000);
})();
