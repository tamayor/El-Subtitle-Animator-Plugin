// Cut tab: a rough cut of the source track into a new "(cut)" timeline (src/main/auto-cut.js, src/python/auto_cut.py).
// Analyse shows the plan (before / after, a strip per clip, the retakes / stutters / fillers it would take out); each
// taken-out line can be unticked to keep it. Build makes the new timeline; the source timeline is never edited.
// Layout: the tab has two sub-tabs, Rough cut (steps 1 Source, 2 Pauses, 3 Take out, 4 Analyse, 5 Build) and Measure
// (js/library/cut-tools.js). Step 5 is locked until there is a plan; a setting changed after Analyse marks the plan stale
// (not the pause settings: those are applied in the panel, cutLive in js/library/cut-wave.js).

const cutUI = { prefs: null, styles: {}, plan: null, keep: new Set(), busy: false, ready: false,
    manual: {}, sel: 0 };      // your own cuts / keeps per clip id, and the clip the waveform shows (js/library/cut-wave.js)
const CUT_TABS = ['rough', 'measure'];
const CUT_PLAN_CHECKS = ['retakes', 'outtakes', 'stutters', 'fillers', 'transcribe'];   // these change the plan, the rest only Build
const CUT_DET = ['pauseDb', 'voiceDb'];            // silence detection (auto_cut.py): a new analysis
// Slider ranges of the number fields: [min, max, step]
const CUT_SLIDE = { maxPause: [0.1, 3, 0.01], pauseKeep: [0.04, 1.5, 0.01], sentenceKeep: [0.04, 1.5, 0.01], headLead: [0, 1, 0.01], tailKeep: [0, 3, 0.01],
    pauseDb: [4, 30, 1], voiceDb: [6, 45, 1] };

// A slider beside each number field, in step with it (typing and dragging the field still work).
function cutSliders() {
    for (const [k, [mn, mx, st]] of Object.entries(CUT_SLIDE)) {
        const num = $('cut_' + k);
        if (!num || num.previousElementSibling && num.previousElementSibling.type === 'range') continue;
        const r = document.createElement('input');
        r.type = 'range'; r.min = mn; r.max = mx; r.step = st; r.className = 'cut-slide'; r.id = 'cutR_' + k;
        r.addEventListener('input', () => { num.value = r.value; num.dispatchEvent(new Event('input')); });
        num.addEventListener('input', () => { r.value = num.value; });
        num.before(r);
        const row = document.createElement('span'); row.className = 'cut-slrow';
        r.before(row); row.append(r, num);
    }
}
function cutSlidersSync() { for (const k of Object.keys(CUT_SLIDE)) { const r = $('cutR_' + k); if (r) r.value = $('cut_' + k).value; } }

// Rough cut / Measure (bound in initCutTab with bindTabGroup, js/ui/tabs.js).
let cutTabs = null;
function cutSubTab(ct) {
    if (cutTabs) cutTabs.show(ct);
}

// The shown plan no longer matches the settings (Build would re-plan with the new ones): say so in step 4.
function cutStale() {
    if (!cutUI.plan) return;
    $('cutRough').classList.add('stale');
    $('cutNum4').classList.remove('done');
    if (!cutUI.busy && $('cutRun').parentNode === $('cutRunSlot4')) cutStatus('', '');
}

// Progress, Cancel and the status line sit under the step that is running: 4 (Analyse) or 5 (Build).
function cutRunTo(step) {
    const slot = $('cutRunSlot' + step), run = $('cutRun');
    if (slot && run && run.parentNode !== slot) slot.appendChild(run);
}
const CUT_NUMS = ['maxPause', 'pauseKeep', 'sentenceKeep', 'headLead', 'tailKeep'];
const CUT_CHECKS = ['retakes', 'outtakes', 'stutters', 'fillers', 'wordless', 'transcribe', 'level', 'copyTransform', 'markers', 'subtitles', 'open'];
const CUT_KIND = { retake: 'Retake', outtake: 'Outtake', stutter: 'Stutter', filler: 'Filler' };

function initCutTab() {
    const wrap = $('cutWrap');
    if (wrap) cutTabs = bindTabGroup(wrap, { key: 'cut', values: CUT_TABS, buttons: '.presets-tab[data-cut]', storageKey: 'cutTab' });
    if (!window.sa || !window.sa.cutDefaults) return;
    const tr = $('cutTrack');
    for (let i = 1; i <= 12; i++) { const o = document.createElement('option'); o.value = i; o.textContent = 'V' + i; tr.appendChild(o); }

    $('cutStyle').addEventListener('change', () => { cutUI.prefs.style = $('cutStyle').value; cutApplyStyle(); cutLive(); cutSave(); });
    for (const k of CUT_NUMS) {
        const set = () => {
            const v = Number($('cut_' + k).value);
            if (!Number.isFinite(v)) return;
            cutUI.prefs[k] = v;
            cutUI.prefs.style = 'custom'; $('cutStyle').value = 'custom';
            cutViz();
            cutLive();
            cutSave();
        };
        $('cut_' + k).addEventListener('input', set);
        $('cut_' + k).addEventListener('change', set);
    }
    cutVizInit();
    cutWaveInit();
    cutSliders();
    for (const k of CUT_DET) {
        $('cut_' + k).addEventListener('input', () => { const v = Number($('cut_' + k).value); if (!Number.isFinite(v)) return; cutUI.prefs[k] = v; cutStale(); cutSave(); });
    }
    for (const k of CUT_CHECKS) $('cut_' + k).addEventListener('change', () => { cutUI.prefs[k] = $('cut_' + k).checked; if (CUT_PLAN_CHECKS.includes(k)) cutStale(); else cutLive(); cutSave(); });
    for (const k of ['lufs', 'markPauses']) $('cut_' + k).addEventListener('change', () => { cutUI.prefs[k] = Number($('cut_' + k).value); cutSave(); });
    tr.addEventListener('change', () => { cutUI.prefs.track = Number(tr.value); cutStale(); cutSave(); });
    $('cutText').addEventListener('change', () => { cutUI.prefs.textSource = $('cutText').value; cutStale(); cutSave(); });
    $('cutScript').addEventListener('input', () => { cutUI.prefs.script = $('cutScript').value; cutScriptNote(); cutStale(); cutSave(); });

    $('cutAnalyze').addEventListener('click', () => cutAnalyze(false));
    $('cutBuild').addEventListener('click', cutBuild);
    $('cutCancel').addEventListener('click', () => window.sa.cutCancel());
    window.sa.onCutProgress(cutProgress);
}

async function cutTabShown() {
    if (cutUI.ready) return;
    const r = await window.sa.cutDefaults();
    if (!r || r.error) { cutStatus((r && r.error) || 'Could not open Cut', 'bad'); return; }
    cutUI.prefs = r.prefs; cutUI.styles = r.styles || {}; cutUI.ready = true;
    // Double-click a field's label = this default (color-fields.js bindDblClickReset).
    const def = r.defaults || {};
    for (const k of [...CUT_NUMS, ...CUT_DET, 'lufs', 'markPauses']) {
        if (def[k] === undefined) continue;
        for (const el of [$('cut_' + k), $('cutR_' + k)]) if (el) el.dataset.default = String(def[k]);
    }
    cutFill();
    if (r.plan) cutShow(r.plan);
    if (r.status && r.status.running) cutBusy(true, r.status.progress);
}

function cutFill() {
    const p = cutUI.prefs;
    $('cutTrack').value = String(p.track || 1);
    $('cutStyle').value = p.style || 'natural';
    $('cutText').value = p.textSource || 'transcription';
    for (const k of CUT_NUMS) $('cut_' + k).value = p[k];
    for (const k of CUT_DET) $('cut_' + k).value = p[k] === undefined ? (k === 'pauseDb' ? 20 : 18) : p[k];
    cutSlidersSync();
    for (const k of CUT_CHECKS) $('cut_' + k).checked = !!p[k];
    $('cut_lufs').value = p.lufs; $('cut_markPauses').value = p.markPauses;
    $('cutName').value = p.name || '';
    $('cutScript').value = p.script || '';
    if (p.script) $('cutScriptBox').open = true;
    if (p.style === 'custom') $('cutNumsBox').open = true;
    cutScriptNote();
    cutViz();
}

function cutScriptNote() {
    const n = String($('cutScript').value || '').split(/(?<=[.?!…])\s+|\n+/).filter(s => s.trim()).length;
    $('cutScriptNote').textContent = n ? n + ' line' + (n > 1 ? 's' : '') + ': only the last complete take of each is kept; Retakes / Outtakes are not needed' : '';
}

function cutApplyStyle() {
    const s = cutUI.styles[cutUI.prefs.style];
    if (s) { Object.assign(cutUI.prefs, s); for (const k of CUT_NUMS) $('cut_' + k).value = s[k]; cutSlidersSync(); }
    cutViz();
}

// ---------------------------------------------------------------- pause visualiser
// A sample clip, before and after, cut with the same rules as src/python/auto_cut.py: a gap up to "Shorten over" stays;
// a longer one keeps "Leave" (60 % after the words, 40 % before the next) or "After a sentence"; the clip keeps "Head"
// before its first word and "Tail" after its last. Drag a gap in the After row, or the Shorten-over bracket, to set it.
const CUT_SAMPLE = [
    { k: 'head', s: 0.7 }, { w: 'we grew up', s: 0.95 }, { k: 'short', s: 0.22 }, { w: 'in Penang', s: 0.85 },
    { k: 'pause', s: 1.3 }, { w: 'he sold bread.', s: 1.25 }, { k: 'sentence', s: 1.1 },
    { w: 'every day', s: 0.85 }, { k: 'tail', s: 0.9 }
];
let cutVizPx = 60;               // viewBox units per second of the last drawing
const CUT_GAP_KEY = { head: 'headLead', tail: 'tailKeep', pause: 'pauseKeep', sentence: 'sentenceKeep', short: 'maxPause' };

function cutGapAfter(seg, p) {
    if (seg.k === 'head') return Math.min(seg.s, p.headLead);
    if (seg.k === 'tail') return Math.min(seg.s, p.tailKeep);
    const keep = seg.k === 'sentence' ? p.sentenceKeep : p.pauseKeep;
    if (seg.s <= p.maxPause || seg.s <= keep + 0.04) return seg.s;
    return keep;
}

function cutViz() {
    const el = $('cutViz');
    const p = cutUI.prefs;
    if (!el || !p) return;
    const W = 640, L = 58, R = 12, total = CUT_SAMPLE.reduce((t, x) => t + x.s, 0);
    const px = (W - L - R) / total;
    const yB = 26, yA = 96, h = 24;
    const f2 = v => (Math.round(v * 100) / 100).toFixed(2);
    const esc = t => String(t).replace(/&/g, '&amp;').replace(/</g, '&lt;');
    const tip = t => `<title>${esc(t)}</title>`;
    const DRAG = ' Drag left / right to change it (Shift = finer).';
    let svg = '', x = L, xa = L, after = 0;
    let svgA = '';
    for (const seg of CUT_SAMPLE) {
        const w = seg.s * px;
        if (seg.w) {
            const t = tip('Speech: always kept as it is.');
            svg += `<g>${t}<rect class="cv-word" x="${x}" y="${yB}" width="${w}" height="${h}" rx="4"/>` +
                `<text class="cv-wt" x="${x + w / 2}" y="${yB + h / 2 + 4}">${seg.w}</text></g>`;
            svgA += `<g>${t}<rect class="cv-word" x="${xa}" y="${yA}" width="${w}" height="${h}" rx="4"/>` +
                `<text class="cv-wt" x="${xa + w / 2}" y="${yA + h / 2 + 4}">${seg.w}</text></g>`;
            x += w; xa += w; after += seg.s;
            continue;
        }
        const kept = cutGapAfter(seg, p), cut = seg.s - kept, wk = kept * px;
        const whole = cut < 0.001;
        // what happens to this gap, in words (Before and After share it)
        let what;
        if (seg.k === 'head') what = `Silence before the first word (${f2(seg.s)} s): Head keeps ${f2(kept)} s, ${f2(cut)} s removed.`;
        else if (seg.k === 'tail') what = `Silence after the last word (${f2(seg.s)} s): Tail keeps ${f2(kept)} s, ${f2(cut)} s removed.`;
        else {
            const label = seg.k === 'sentence' ? 'Pause after a sentence' : seg.k === 'short' ? 'Short pause' : 'Pause';
            const keepName = seg.k === 'sentence' ? `After a sentence (${f2(p.sentenceKeep)} s)` : `Leave (${f2(p.pauseKeep)} s)`;
            if (seg.s <= p.maxPause) what = `${label} (${f2(seg.s)} s): kept whole, it is not longer than Shorten over (${f2(p.maxPause)} s).`;
            else if (whole) what = `${label} (${f2(seg.s)} s): kept whole. It is longer than Shorten over (${f2(p.maxPause)} s), but ${keepName} would save almost nothing.`;
            else what = `${label} (${f2(seg.s)} s): longer than Shorten over (${f2(p.maxPause)} s), so it is shortened to ${keepName}; 60 % stays after the words, 40 % before the next ones. ${f2(cut)} s removed.`;
            if (seg.k === 'sentence') what += ' Needs words (Resolve transcription or subtitles) to know where a sentence ends; without them Leave is used.';
        }
        // Before: the part that goes is shaded; for a pause it is the middle (tail 60 % / lead 40 % stay)
        const keepL = seg.k === 'head' ? 0 : seg.k === 'tail' ? kept : kept * 0.6;
        svg += `<g>${tip(what)}<rect class="cv-gap" x="${x}" y="${yB}" width="${w}" height="${h}"/>`;
        if (!whole) {
            svg += `<rect class="cv-cut" x="${x + keepL * px}" y="${yB}" width="${cut * px}" height="${h}"/>` +
                `<text class="cv-ct" x="${x + (keepL + cut / 2) * px}" y="${yB + h / 2 + 4}">−${f2(cut)}</text>`;
        }
        svg += '</g>';
        if (seg.k === 'short') {
            svg += `<text class="cv-note" x="${x + w / 2}" y="${yB + h + 12}">${whole ? 'kept' : 'shortened'}</text>`;
        }
        if (seg.k === 'pause') {        // the Shorten-over bracket, from the pause's start
            const bw = Math.min(p.maxPause, 3) * px;
            svg += `<g class="cv-drag" data-k="maxPause">${tip(`Shorten over (${f2(p.maxPause)} s): a pause longer than this is shortened; shorter ones are left alone.` + DRAG)}` +
                `<path class="cv-br" d="M${x} ${yB - 4}v-6h${bw}v6"/>` +
                `<rect x="${x - 4}" y="${yB - 26}" width="${Math.max(bw, 120)}" height="24" fill="transparent"/>` +
                `<text class="cv-lab cv-start" x="${x}" y="${yB - 15}">shorten pauses over ${f2(p.maxPause)} s</text></g>`;
        }
        // After: the kept gap, draggable
        const key = CUT_GAP_KEY[seg.k];
        const name = { head: 'head', tail: 'tail', pause: 'leave', sentence: 'after sentence', short: '' }[seg.k];
        const drag = seg.k !== 'short';
        svgA += `<g class="${drag ? 'cv-drag' : ''}" data-k="${drag ? key : ''}">${tip(what + (drag ? DRAG : ''))}` +
            `<rect class="cv-gap cv-kept" x="${xa}" y="${yA}" width="${Math.max(wk, 2)}" height="${h}"/>` +
            `<rect x="${xa - 4}" y="${yA - 16}" width="${Math.max(wk, 2) + 8}" height="${h + 20}" fill="transparent"/>` +
            (name ? `<text class="cv-lab" x="${xa + wk / 2}" y="${seg.k === 'head' || seg.k === 'tail' ? yA + h + 12 : yA - 5}">${name} ${f2(kept)}</text>` : '') + '</g>';
        x += w; xa += wk; after += kept;
    }
    const saved = total - after;
    svg += `<g>${tip('A sample clip as recorded: green is speech, red is what the cut removes.')}` +
        `<text class="cv-row" x="4" y="${yB + h / 2 + 4}">Before</text><text class="cv-sec" x="4" y="${yB + h / 2 + 16}">${f2(total)} s</text></g>`;
    svgA += `<g>${tip(`The same clip after the cut: ${f2(after)} s, ${f2(saved)} s (${Math.round(saved / total * 100)} %) shorter. Your recording is cut with these same rules.`)}` +
        `<text class="cv-row" x="4" y="${yA + h / 2 + 4}">After</text><text class="cv-sec" x="4" y="${yA + h / 2 + 16}">${f2(after)} s</text></g>`;
    el.innerHTML = `<svg viewBox="0 0 ${W} 136" preserveAspectRatio="xMinYMid meet" role="img" aria-label="Pause settings, before and after">${svg}${svgA}</svg>`;
    cutVizPx = px;
}

// Drag on a gap (or the bracket): the value follows the pointer, 0.01 s steps; Shift = finer.
function cutVizInit() {
    let el = $('cutViz');
    if (!el && $('cutNums')) {          // older index.html without the container
        el = document.createElement('div'); el.id = 'cutViz'; el.className = 'cut-viz';
        el.title = 'Drag the gaps (or the Shorten-over bracket) to change the values';
        $('cutNums').before(el);
    }
    if (!el) return;
    let drag = null;
    el.addEventListener('pointerdown', (e) => {
        const g = e.target.closest('.cv-drag');
        if (!g || !g.dataset.k || !cutUI.prefs) return;
        e.preventDefault();
        el.setPointerCapture(e.pointerId);
        drag = { k: g.dataset.k, x: e.clientX, v: Number(cutUI.prefs[g.dataset.k]) || 0 };
        el.classList.add('dragging');
    });
    el.addEventListener('pointermove', (e) => {
        if (!drag) return;
        const svg = el.querySelector('svg');
        const scale = svg ? svg.getBoundingClientRect().width / 640 : 1;
        const pxPerS = Math.max(1, cutVizPx * scale);
        const dv = (e.clientX - drag.x) / pxPerS * (e.shiftKey ? 0.25 : 1);
        const lim = { maxPause: [0.1, 3], pauseKeep: [0.04, 1.3], sentenceKeep: [0.04, 1.1], headLead: [0, 0.7], tailKeep: [0, 0.9] }[drag.k];
        const v = Math.round(Math.min(lim[1], Math.max(lim[0], drag.v + dv)) * 100) / 100;
        if (v === cutUI.prefs[drag.k]) return;
        cutUI.prefs[drag.k] = v;
        $('cut_' + drag.k).value = v;
        cutSlidersSync();
        cutUI.prefs.style = 'custom'; $('cutStyle').value = 'custom';
        cutViz();
    });
    const end = () => { if (!drag) return; drag = null; el.classList.remove('dragging'); cutSave(); };
    el.addEventListener('pointerup', end);
    el.addEventListener('pointercancel', end);
}

let cutSaveT = null;
function cutSave() {
    clearTimeout(cutSaveT);
    cutSaveT = setTimeout(() => { window.sa.cutPrefs(cutUI.prefs).then(p => { if (p && !p.error) cutUI.prefs = p; }); }, 250);
}

function cutStatus(text, kind) {
    const el = $('cutStatus'); el.textContent = text || ''; el.className = 'status' + (kind ? ' ' + kind : '');
}

function cutBusy(on, p) {
    cutUI.busy = on;
    $('cutAnalyze').disabled = on; $('cutBuild').disabled = on;
    $('cutCancel').classList.toggle('hidden', !on);
    $('cutBarWrap').classList.toggle('hidden', !on);
    if (p) cutProgress(p);
}

function cutProgress(p) {
    if (!p) return;
    if (p.phase === 'build') cutRunTo(5);
    $('cutMsg').textContent = p.text || '';
    const f = p.total ? Math.min(1, (p.done || 0) / p.total) : 0;
    const v = { start: 0.04, transcribe: 0.15, audio: 0.2 + 0.6 * f, text: 0.85, build: 0.1 + 0.85 * f, install: 0.5 }[p.phase];
    if (v !== undefined) $('cutBar').style.width = Math.round(v * 100) + '%';
    if (p.phase === 'error') cutStatus(p.text, 'bad');
}

function cutFmt(s) { s = Math.max(0, Math.round(s)); return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0'); }

async function cutAnalyze(reuse) {
    if (cutUI.busy) return;
    cutStatus('', '');
    cutRunTo(4);
    cutBusy(true, { phase: 'start', text: 'Reading the timeline…' });
    const r = await window.sa.cutAnalyze({ ...cutUI.prefs, ignore: [...cutUI.keep], reuse: !!reuse });
    cutBusy(false);
    if (r && r.needsEngine) { cutEngineCard(r); return; }
    if (!r || r.error) { cutStatus((r && r.error) || 'The analysis stopped', 'bad'); return; }
    $('cutEngine').classList.add('hidden');
    $('cutMsg').textContent = '';
    cutShow(r);
    const wave = !$('cutWave').classList.contains('hidden');
    if (wave) $('cutWave').scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    cutStatus('Analysed ' + r.timeline + '. Nothing changed yet: check the ' + (wave ? 'waveform in step 2 and the ' : '') + 'list, then Build.', 'ok');
}

function cutEngineCard(r) {
    const el = $('cutEngine');
    el.innerHTML = '';
    el.classList.remove('hidden');
    const t = document.createElement('div');
    if (!r.ffmpeg) t.textContent = 'Cut needs ffmpeg. In Terminal: brew install ffmpeg — then Analyse again.';
    else t.textContent = 'Cut needs its listening engine (Python with numpy, about 40 MB). Install it once?';
    el.appendChild(t);
    if (r.ffmpeg && !r.python && r.canInstall) {
        const b = document.createElement('button'); b.className = 'primary'; b.textContent = 'Install';
        b.addEventListener('click', async () => {
            cutBusy(true, { phase: 'install', text: 'Installing…' });
            const x = await window.sa.cutInstall();
            cutBusy(false);
            if (x && x.error) { cutStatus(x.error, 'bad'); return; }
            el.classList.add('hidden');
            cutAnalyze(false);
        });
        el.appendChild(b);
    }
}

function cutShow(r) {
    cutUI.plan = r;
    cutUI.keep = new Set((r.drops || []).filter(d => d.ignored).map(d => d.id));
    const ids = new Set((r.clips || []).map(c => c.id));
    for (const id of Object.keys(cutUI.manual)) if (!ids.has(id)) delete cutUI.manual[id];      // edits of clips that are gone
    if (!(r.clips || [])[cutUI.sel] || !r.clips[cutUI.sel].wave) cutUI.sel = Math.max(0, (r.clips || []).findIndex(c => c.wave));
    $('cutResult').classList.remove('hidden');
    $('cutRough').classList.add('has-plan');
    $('cutRough').classList.remove('stale');
    $('cutNum4').classList.add('done');
    $('cutNum5').classList.remove('done');
    $('cutHeadline').textContent = r.headline || '';

    const pick = $('cwPick'); pick.innerHTML = '';
    const waves = (r.clips || []).filter(c => c.wave);
    for (const c of waves) { const o = document.createElement('option'); o.value = c.id; o.textContent = c.name; pick.appendChild(o); }
    pick.classList.toggle('hidden', waves.length < 2);
    $('cwName').classList.toggle('hidden', waves.length > 1);
    if (waves.length) $('cutNumsBox').open = true;          // the sample's draggable gaps are gone: the fields set the values

    const w = $('cutWarn'); w.innerHTML = '';
    for (const m of r.warn || []) { const d = document.createElement('div'); d.textContent = m; w.appendChild(d); }
    cutDropRows();
    cutLive();
}

// A row per clip: name, kept / removed strip, before → after. With several clips a click shows that clip's waveform.
function cutClipRows() {
    const r = cutUI.plan;
    const clips = $('cutClips'); clips.innerHTML = '';
    const many = (r.clips || []).filter(c => c.wave).length > 1;
    (r.clips || []).forEach((c, i) => {
        const row = document.createElement('div'); row.className = 'cut-clip' + (many && c.wave ? ' pick' : '') + (many && i === cutUI.sel ? ' on' : '');
        const name = document.createElement('span'); name.className = 'cut-clip-name'; name.textContent = c.name; name.title = c.name;
        const strip = document.createElement('span'); strip.className = 'cut-strip';
        const keeps = c.live ? c.live.keeps.map(([a, b]) => [a / c.dur, b / c.dur]) : (c.keeps || []);
        for (const [a, b] of keeps) {
            const k = document.createElement('i'); k.style.left = (a * 100) + '%'; k.style.width = Math.max(0.3, (b - a) * 100) + '%'; strip.appendChild(k);
        }
        const after = c.live ? c.live.after : c.after;
        const t = document.createElement('span'); t.className = 'cut-clip-t';
        t.textContent = c.whole ? cutFmt(c.before) + ' kept' : cutFmt(c.before) + ' → ' + cutFmt(after) + (c.lufs !== null && c.lufs !== undefined ? '  ' + c.lufs.toFixed(0) + ' LUFS' : '');
        row.append(name, strip, t);
        if (many && c.wave) { row.title = 'Show this clip’s waveform'; row.addEventListener('click', () => cutWaveGoto(c.id)); }
        clips.appendChild(row);
    });
    if ($('cwPick').options.length && r.clips[cutUI.sel]) $('cwPick').value = r.clips[cutUI.sel].id;
}

// The "Taken out" list: untick a line to keep it; the target button shows it on the waveform.
function cutDropRows() {
    const r = cutUI.plan;
    const drops = r.drops || [];
    $('cutDropsWrap').classList.toggle('hidden', !drops.length);
    const list = $('cutDrops'); list.innerHTML = '';
    for (const d of drops) {
        const row = document.createElement('label'); row.className = 'cut-drop';
        const cb = document.createElement('input'); cb.type = 'checkbox'; cb.checked = !cutUI.keep.has(d.id);
        cb.addEventListener('change', () => { if (cb.checked) cutUI.keep.delete(d.id); else cutUI.keep.add(d.id); row.classList.toggle('kept', !cb.checked); cutLive(); });
        const kind = document.createElement('span'); kind.className = 'cut-kind k-' + d.kind; kind.textContent = CUT_KIND[d.kind] || d.kind;
        const txt = document.createElement('span'); txt.className = 'cut-drop-t';
        txt.textContent = '“' + d.text + '”' + (d.of ? '  →  kept: “' + d.of + '”' : '');
        const secs = document.createElement('span'); secs.className = 'cut-drop-s'; secs.textContent = '−' + (d.secs || 0).toFixed(1) + ' s';
        txt.title = (d.clip || '') + ' at ' + cutFmt(d.at);
        row.append(cb, kind, txt, secs);
        if ((r.clips || []).some(c => c.id === d.src && c.wave)) {
            const go = document.createElement('button'); go.type = 'button'; go.className = 'ghost cut-drop-go'; go.textContent = '⌖'; go.title = 'Show it on the waveform';
            go.addEventListener('click', (e) => { e.preventDefault(); cutWaveGoto(d.src, (d.a + d.b) / 2); });
            row.appendChild(go);
        }
        row.classList.toggle('kept', cutUI.keep.has(d.id));
        list.appendChild(row);
    }
}

async function cutBuild() {
    if (cutUI.busy || !cutUI.plan) return;
    cutUI.prefs.name = $('cutName').value.trim();
    cutStatus('', '');
    cutRunTo(5);
    cutBusy(true, { phase: 'build', text: 'Building the cut…' });
    cwStop();
    const r = await window.sa.cutBuild({ ...cutUI.prefs, ignore: [...cutUI.keep], live: cutLivePieces() });
    cutBusy(false);
    if (!r || r.error) { cutStatus((r && r.error) || 'The build stopped', 'bad'); return; }
    $('cutMsg').textContent = '';
    $('cutNum5').classList.add('done');
    cutStatus(r.text, 'ok');
    setStatus('Cut: ' + r.text, 'ok');
}
