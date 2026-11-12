// Cut tab "Analyse media" (src/main/cut-tools.js, src/main/media-analysis.js): speech pauses, shot changes with
// brightness, the beat grid, word timings and the render check, over the whole timeline or a timecode range.
// Results are drawn over the range's waveform (js/library/cut-tools-view.js) and listed with timecodes; a click on
// either moves Resolve's playhead. Add markers is optional (markers named "ELSA ...").

const ctUI = { busy: false, ready: false, result: null, kind: null, results: {}, rangeKey: '' };   // results: the last result of each kind for this range
const CT_KIND = { pauses: 'Pauses', cuts: 'Shot changes', beats: 'Beats', words: 'Words', render: 'Render check' };
const CT_MAX_ROWS = 300;

function initCutTools() {
    if (!window.sa || !window.sa.cutToolsRun) return;
    const au = $('ctAudio');
    const auto = document.createElement('option'); auto.value = ''; auto.textContent = 'Auto'; au.appendChild(auto);
    for (let i = 1; i <= 8; i++) { const o = document.createElement('option'); o.value = i; o.textContent = 'A' + i; au.appendChild(o); }
    $('ctRange').addEventListener('change', ctRangeShown);
    for (const b of document.querySelectorAll('#ctSection .ct-run')) b.addEventListener('click', () => ctRun(b.dataset.kind));
    $('ctCancel').addEventListener('click', () => window.sa.cutToolsCancel());
    $('ctMark').addEventListener('click', () => ctMarkers(false));
    $('ctClear').addEventListener('click', () => ctMarkers(true));
    $('ctCopy').addEventListener('click', ctCopy);
    $('ctDelete').addEventListener('click', ctDeletePauses);
    ctvInit();
    window.sa.onCutToolsProgress(ctProgress);
    ctRangeShown();
}

async function cutToolsShown() {
    if (!window.sa || !window.sa.cutToolsStatus || ctUI.ready) return;
    const r = await window.sa.cutToolsStatus();
    if (!r || r.error) return;
    ctUI.ready = true;
    ctEngineNote(r);
    if (r.running) ctBusy(true);
}

function ctEngineNote(r) {
    const el = $('ctEngine');
    el.innerHTML = '';
    const lines = [];
    if (!r.ffmpeg) lines.push('ffmpeg is not installed, so nothing here can measure. In Terminal: brew install ffmpeg');
    if (r.ffmpeg && !(r.engines || []).length) lines.push('Words needs a local speech engine (none installed). Install sets up mlx-whisper for this plugin; the model (about 1.6 GB) downloads the first time Words runs.');
    el.classList.toggle('hidden', !lines.length);
    if (!lines.length) return;
    const t = document.createElement('span'); t.textContent = lines.join(' '); el.appendChild(t);
    if (r.ffmpeg && !(r.engines || []).length) {
        const b = document.createElement('button'); b.textContent = 'Install speech engine';
        b.addEventListener('click', async () => {
            b.disabled = true; ctStatus('Installing the speech engine (a few minutes)…');
            const x = await window.sa.cutToolsInstall({});
            b.disabled = false;
            if (!x || x.error) { ctStatus((x && x.error) || 'Install failed', 'bad'); return; }
            ctStatus('Installed ' + x.installed + '.', 'ok');
            ctEngineNote(await window.sa.cutToolsStatus());
        });
        el.appendChild(b);
    }
}

function ctRangeShown() {
    const tc = $('ctRange').value === 'tc';
    for (const el of document.querySelectorAll('#ctSection .ct-tcf')) el.classList.toggle('hidden', !tc);
}

function ctArgs() {
    const a = {};
    if ($('ctRange').value === 'tc') {
        if ($('ctFrom').value.trim()) a.startTC = $('ctFrom').value.trim();
        if ($('ctTo').value.trim()) a.endTC = $('ctTo').value.trim();
    }
    if ($('ctAudio').value) a.audioTrack = Number($('ctAudio').value);
    return a;
}

function ctStatus(text, kind) {
    const el = $('ctStatus'); el.textContent = text || ''; el.className = 'status' + (kind ? ' ' + kind : '');
}

function ctBusy(on) {
    ctUI.busy = on;
    for (const b of document.querySelectorAll('#ctSection .ct-run')) b.disabled = on;
    $('ctCancel').classList.toggle('hidden', !on);
    $('ctBarWrap').classList.toggle('hidden', !on);
    if (!on) { $('ctMsg').textContent = ''; $('ctBar').style.width = '0'; }
}

function ctProgress(p) {
    if (!p || !ctUI.busy) return;
    $('ctMsg').textContent = (CT_KIND[p.kind] || p.kind || '') + (p.label ? ': ' + p.label : '') + (p.total ? ' (' + p.done + ' / ' + p.total + ')' : '');
    $('ctBar').style.width = (p.total ? Math.round(100 * p.done / p.total) : 0) + '%';
}

async function ctRun(kind) {
    if (ctUI.busy) return;
    ctBusy(true); ctStatus('');
    const t0 = Date.now();
    let r;
    try {
        r = kind === 'render' ? await window.sa.cutToolsCheck(ctArgs()) : await window.sa.cutToolsRun(Object.assign({ kind }, ctArgs()));
    } finally { ctBusy(false); }
    if (!r || r.error) { ctStatus((r && r.error) || 'Failed', 'bad'); return; }
    const rk = JSON.stringify([$('ctRange').value, $('ctFrom').value, $('ctTo').value, r.timeline || '']);
    const old = ctUI.results[Object.keys(ctUI.results).find(k => k !== 'render')];
    if (kind !== 'render' && (rk !== ctUI.rangeKey || (old && (old.from !== r.from || old.to !== r.to)))) { ctUI.results = {}; ctUI.rangeKey = rk; }     // another range or timeline: a new picture
    ctUI.result = r; ctUI.kind = kind; ctUI.results[kind] = r;
    ctvSetRange(kind, r);
    ctShow(kind, r);
    ctvLoadWave(kind, true);          // the sound as it is now (the timeline may have changed since the last run)
    ctStatus(CT_KIND[kind] + ' done in ' + ((Date.now() - t0) / 1000).toFixed(1) + ' s.', 'ok');
}

// Rows of [timecode, text, css class] per kind.
function ctRowsFor(kind, r) {
    const sec = (frames) => (r.fps ? frames / r.fps : 0);
    if (kind === 'pauses') return ctvPauses(r).map(p => [p.tc, sec(p.frames).toFixed(2) + ' s pause', sec(p.frames) >= Math.max(0.7, ctvMinPause() * 1.5) ? 'long' : '', p.start]);
    if (kind === 'cuts') return (r.shots || []).map(s => [s.tc, sec(s.frames).toFixed(1) + ' s shot' + (s.meanLuma !== null ? ' · brightness ' + s.meanLuma : '') + (s.bright ? ' · light B-roll: white text will not read' : s.dark ? ' · dark' : ''), s.bright ? 'bright' : '', s.start]);
    if (kind === 'beats') return (r.beats || []).map((b, i) => [b.tc, 'beat ' + (i + 1) + (b.supported ? '' : ' (grid only, no hit)'), b.supported ? '' : 'dim', b.frame]);
    if (kind === 'words') return (r.words || []).map(w => [w.tc, w.w, '', w.start]);
    if (kind === 'render') {
        const rows = [];
        for (const c of r.clips || []) {
            if (c.error) { rows.push([c.tcIn || '', c.name + ': ' + c.error, 'bad']); continue; }
            if (!c.flags || !c.flags.length) rows.push([c.tcIn, c.name + ': no black or frozen frames', 'ok']);
            for (const f of c.flags || []) rows.push([f.tc, f.note, f.kind === 'frozen' ? 'dim' : 'bad', c.from + f.from]);
        }
        return rows;
    }
    return [];
}

function ctShow(kind, r) {
    $('ctResult').classList.remove('hidden');
    $('ctNum3').classList.add('done');
    for (const b of document.querySelectorAll('#ctSection .ct-run')) b.classList.toggle('on', b.dataset.kind === kind);
    let head = '';
    if (kind === 'pauses') head = ctvPauses(r).length + ' pauses to strip (' + (ctvPauses(r).reduce((t, p) => t + p.frames, 0) / r.fps).toFixed(1) + ' s) in ' + r.range + ' · threshold ' + ctvSilence(r).toFixed(1) + ' dB';
    else if (kind === 'cuts') head = (r.cuts || []).length + ' cuts, ' + (r.shots || []).length + ' shots in ' + r.range + ' · ' + (r.shots || []).filter(s => s.bright).length + ' light B-roll';
    else if (kind === 'beats') head = r.tempoBpm ? r.tempoBpm + ' BPM · ' + (r.beats || []).length + ' beats in ' + r.range : 'No steady beat in ' + r.range;
    else if (kind === 'words') head = (r.words || []).length + ' words in ' + r.range + ((r.clips || [])[0] && r.clips[0].engine ? ' · ' + r.clips[0].engine + (r.clips[0].cached ? ' (cached)' : '') : '');
    else if (kind === 'render') head = r.checked + ' checked · ' + (r.problems ? r.problems + ' with a problem' : 'no problems');
    $('ctHeadline').textContent = CT_KIND[kind] + ': ' + head;
    const warn = $('ctWarn'); warn.innerHTML = '';
    for (const w of r.warnings || []) { const d = document.createElement('div'); d.textContent = w; warn.appendChild(d); }
    const rows = ctRowsFor(kind, r);
    const box = $('ctRows'); box.innerHTML = '';
    box.classList.toggle('ct-transcript', kind === 'words');
    if (kind === 'words') ctTranscript(box, r.words || []);
    for (const [tc, text, cls, frame] of (kind === 'words' ? [] : rows.slice(0, CT_MAX_ROWS))) {
        const d = document.createElement('div'); d.className = 'ct-row' + (cls ? ' ' + cls : '');
        if (frame !== undefined) { d.classList.add('go'); d.title = 'Move the playhead here'; d.addEventListener('click', () => ctvGoto(Math.round(frame), true)); }
        const a = document.createElement('span'); a.className = 'ct-tc'; a.textContent = tc || '';
        const b = document.createElement('span'); b.className = 'ct-text'; b.textContent = text;
        d.append(a, b); box.appendChild(d);
    }
    if (kind !== 'words' && rows.length > CT_MAX_ROWS) { const d = document.createElement('div'); d.className = 'ct-row dim'; d.textContent = '… ' + (rows.length - CT_MAX_ROWS) + ' more (Copy has them all)'; box.appendChild(d); }
    if (!ctv.wave && !ctv.waveKey && !ctv.waveBusy) ctvLoadWave(kind);
    $('ctMark').disabled = kind === 'words' || !rows.length;
    $('ctDelWrap').classList.toggle('hidden', kind !== 'pauses');
    ctvDraw();
}

// Words as running text, a sentence per line. The word being said is highlighted and kept in the middle of the box
// during playback (ctWordsFollow, from the playhead tick in js/library/cut-tools-view.js); a click on a word moves the
// playhead there. Scrolling the box yourself pauses the auto scroll for 4 s.
const ctWords = { list: [], spans: [], on: -1, userAt: 0, autoAt: 0 };
function ctTranscript(box, words) {
    ctWords.list = words; ctWords.spans = []; ctWords.on = -1;
    let p = document.createElement('p');
    box.appendChild(p);
    words.forEach((w, i) => {
        const s = document.createElement('span');
        s.className = 'ct-w'; s.textContent = w.w; s.title = w.tc + ' · click to move the playhead here';
        s.addEventListener('click', () => ctvGoto(Math.round(w.start), false));
        p.append(s, ' ');
        ctWords.spans.push(s);
        if (/[.?!…]["')\]]*$/.test(w.w) && i < words.length - 1) { p = document.createElement('p'); box.appendChild(p); }
    });
    if (!box.dataset.wordsInit) {
        box.dataset.wordsInit = '1';
        box.addEventListener('scroll', () => { if (Date.now() - ctWords.autoAt > 250) ctWords.userAt = Date.now(); }, { passive: true });
    }
}

// The word at timeline frame f: the last one that started by then (still "on" in the short gap after it).
function ctWordsFollow(f) {
    const L = ctWords.list;
    if (ctUI.kind !== 'words' || !L.length || f === null) return;
    let lo = 0, hi = L.length - 1, k = -1;
    while (lo <= hi) { const m = (lo + hi) >> 1; if (L[m].start <= f + 0.5) { k = m; lo = m + 1; } else hi = m - 1; }
    if (k >= 0 && f > L[k].end + 12) k = -1;                     // half a second after the word ended: none
    if (k === ctWords.on) return;
    const old = ctWords.spans[ctWords.on];
    if (old) old.classList.remove('on');
    ctWords.spans.forEach((s, i) => s.classList.toggle('said', k >= 0 && i < k));
    ctWords.on = k;
    const s = ctWords.spans[k];
    if (!s) return;
    s.classList.add('on');
    const box = $('ctRows');
    if (Date.now() - ctWords.userAt < 4000) return;
    const target = s.offsetTop - box.offsetTop - box.clientHeight / 2 + s.offsetHeight / 2;
    ctWords.autoAt = Date.now();
    box.scrollTo({ top: Math.max(0, target), behavior: Math.abs(box.scrollTop - target) > box.clientHeight * 2 ? 'auto' : 'smooth' });
}

// Markers: long pauses, every cut (bright shots in yellow), beats, render problems.
function ctMarks(kind, r) {
    if (kind === 'pauses') return ctvPauses(r).map(p => ({ frame: Math.round(p.start), frames: Math.max(1, Math.round(p.end) - Math.round(p.start)), name: 'pause', note: (p.frames / r.fps).toFixed(2) + ' s' }));
    if (kind === 'cuts') return (r.shots || []).map(s => ({ frame: s.start, name: s.bright ? 'light B-roll' : 'shot', color: s.bright ? 'bright' : 'cuts', note: 'brightness ' + s.meanLuma }));
    if (kind === 'beats') return (r.beats || []).filter(b => b.supported).map(b => ({ frame: b.frame, name: 'beat' }));
    if (kind === 'render') {
        const out = [];
        for (const c of r.clips || []) for (const f of c.flags || []) if (f.kind !== 'frozen') out.push({ frame: c.from + f.from, frames: Math.max(1, f.frames), name: f.kind, note: f.note });
        return out;
    }
    return [];
}

async function ctMarkers(clear) {
    if (!ctUI.result && !clear) return;
    const kind = ctUI.kind;
    const r = await window.sa.cutToolsMarkers(clear ? { clear: true, all: true } : { kind, marks: ctMarks(kind, ctUI.result), clear: true });
    if (!r || r.error) { ctStatus((r && r.error) || 'Markers failed', 'bad'); return; }
    // pause markers follow the settings from now on (ctMarkFollow), until they are cleared or the range changes
    ctUI.marked = clear ? null : (kind === 'pauses' ? { key: ctUI.rangeKey, result: ctUI.result } : null);
    ctStatus(clear ? (r.left > 0 ? 'Removed ' + r.removed + ' markers; ' + r.left + ' would not go (delete them in Resolve).' : r.removed ? 'Removed ' + r.removed + ' markers.' : 'No markers of this plugin on the timeline.') : 'Added ' + r.added + ' markers' + (r.removed ? ' (replaced ' + r.removed + ')' : '') + '.', 'ok');
}

// The pause markers on the timeline follow the shading: a change of Threshold / Pre head / Post tail / Minimum to strip
// puts them where the shaded pauses now are (half a second after the last change, so a drag is one update).
let ctFollowT = null;
function ctMarkFollow() {
    const m = ctUI.marked;
    if (!m || ctUI.kind !== 'pauses' || m.key !== ctUI.rangeKey || m.result !== ctUI.result) return;
    clearTimeout(ctFollowT);
    ctFollowT = setTimeout(async () => {
        if (ctUI.busy || ctUI.marked !== m) return;
        const r = await window.sa.cutToolsMarkers({ kind: 'pauses', marks: ctMarks('pauses', ctUI.result), clear: true });
        if (!r || r.error) { ctStatus((r && r.error) || 'Markers not updated', 'bad'); return; }
        ctStatus('Markers moved with the settings: ' + r.added + ' pause markers on the timeline.', 'ok');
    }, 500);
}

// Pauses: the marked ones go. A new timeline is made without them (and opened); the markers are cleared.
async function ctDeletePauses() {
    if (ctUI.busy || !window.sa.cutToolsDeletePauses) return;
    ctBusy(true); ctStatus('Taking the marked pauses out…');
    let r;
    try { r = await window.sa.cutToolsDeletePauses({ leave: 0 }   /* Pre head / Post tail already left in the markers */); } catch (e) { r = { error: String(e && e.message || e).replace(/^Error invoking remote method '[^']+': (Error: )?/, '') }; } finally { ctBusy(false); }
    if (!r || r.error) { ctStatus((r && r.error) || 'Could not delete the pauses', 'bad'); return; }
    // the picture showed the old timeline: start again on the new one
    ctUI.results = {}; ctUI.result = null; ctUI.kind = null; ctUI.marked = null; ctv.range = null; ctv.wave = null; ctv.waveKey = '';
    $('ctResult').classList.add('hidden');
    $('ctNum3').classList.remove('done');
    ctStatus(r.pauses + ' pauses deleted (' + r.cutSeconds.toFixed(1) + ' s): new timeline “' + r.timeline + '” is open, ' + r.source + ' is unchanged' +
        (r.cleared ? ', its ' + r.cleared + ' pause markers cleared' : '') + (r.others ? '. Only V1 and its sound were carried over: ' + r.others + ' clip(s) on other tracks were not' : '') + '.', 'ok');
}

function ctCopy() {
    if (!ctUI.result) return;
    const text = [$('ctHeadline').textContent].concat(ctRowsFor(ctUI.kind, ctUI.result).map(r => r[0] + '\t' + r[1])).join('\n');
    try { navigator.clipboard.writeText(text); ctStatus('Copied.', 'ok'); } catch (e) { ctStatus('Could not copy', 'bad'); }
}
