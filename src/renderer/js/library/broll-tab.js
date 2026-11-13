// B-roll tab: motion-graphic overlays made with Remotion (src/main/broll.js, broll/ in the code folder).
// Make: pick an effect, set its fields (the preview still redraws as you type, over the playhead frame), render and
// place it over a subtitle or at the playhead. Editing a placed clip loads its values here; "Update clip" re-renders it
// and swaps the media under the clip, so it keeps its place.
// Auto: suggest B-roll from the subtitles (numbers, "comment X", days, typing, quotes, steps), tick, place ticked.
// Placed: the B-roll on this timeline, with Edit / Remove and the id Claude's adjust_broll takes.
// Watch in "Resolve timeline" (default): no preview in the panel. Place puts a half-size draft on the timeline and
// opens it for editing; every settings change re-renders that clip in place (debounced, one render at a time, the
// newest values win), so it is watched in Resolve's viewer. Finalize re-renders it at full size.

const brUI = { effects: [], common: [], sel: null, values: {}, editing: null, frame: null, busy: false, ready: false,
    suggestions: [], placed: [], previewSeq: 0, strip: null };
const BR_TABS = ['make', 'auto', 'placed'];
// Colour-box trace (<data>/_app/broll-trace.log): what a click on a B-roll colour box led to, to find picker trouble.
function brTrace(msg) { try { window.sa.brollTrace(msg); } catch (e) { /* ignore */ } }
window.addEventListener('blur', () => { if (state.tab === 'broll') brTrace('window blur (colorPicking=' + !!state.colorPicking + ')'); });
window.addEventListener('focus', () => { if (state.tab === 'broll') brTrace('window focus (colorPicking=' + !!state.colorPicking + ')'); });

function brEl(tag, attrs, kids) {
    const el = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs || {})) {
        if (v === undefined || v === null || v === false) continue;
        if (k === 'class') el.className = v;
        else if (k === 'text') el.textContent = v;
        else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
        else el.setAttribute(k, v === true ? '' : v);
    }
    for (const c of [].concat(kids || [])) if (c !== null && c !== undefined && c !== false) el.append(c.nodeType ? c : String(c));
    return el;
}

function brSubTab(t) {
    const wrap = $('brWrap');
    if (!wrap || !BR_TABS.includes(t)) return;
    wrap.dataset.br = t;
    wrap.querySelectorAll('.presets-tab[data-br]').forEach((b) => {
        const on = b.dataset.br === t;
        b.classList.toggle('on', on);
        b.setAttribute('aria-selected', on ? 'true' : 'false');
    });
    try { localStorage.setItem('brTab', t); } catch (e) { /* ignore */ }
    if (t === 'placed') brLoadPlaced();
}

function brStatus(text, kind, id) {
    const el = $(id || 'brStatus');
    if (!el) return;
    el.textContent = text || '';
    el.className = 'status' + (kind ? ' ' + kind : '');
}

function brBusy(on) {
    brUI.busy = on;
    $('brPlace').disabled = on; $('brPlaceNew').disabled = on; $('brPlaceTicked').disabled = on || !brUI.suggestions.some(s => s.on);
    $('brSuggest').disabled = on; $('brSyncAll').disabled = on; $('brFinalizeAll').disabled = on;
    $('brCancel').classList.toggle('hidden', !on);
    if (!on) $('brBar').style.width = '0';
}

// ------------------------------------------------------------------ effects and fields

async function brLoadEffects() {
    const r = await window.sa.brollEffects();
    if (!r || r.error) { brSetup(r && r.error ? r.error : 'Could not read the B-roll effects'); return false; }
    brUI.effects = r.effects; brUI.common = r.common;
    const miss = [];
    if (!r.ready.node) miss.push('Node.js 18+ (nodejs.org, or brew install node)');
    if (!r.ready.project) miss.push('the renderer packages: in Terminal, cd "' + r.ready.dir + '" && npm install');
    brSetup(miss.length ? 'B-roll needs ' + miss.join(' and ') + '.' : '');
    brRenderEffects();
    brRenderAllow();
    let last = null;
    try { last = localStorage.getItem('brEffect'); } catch (e) { /* ignore */ }
    brPick(brUI.effects.find(e => e.id === last) ? last : (brUI.effects[0] && brUI.effects[0].id), null);
    return true;
}

function brSetup(msg) {
    const el = $('brSetup');
    el.textContent = msg || '';
    el.classList.toggle('hidden', !msg);
}

function brRenderEffects() {
    const box = $('brEffects');
    box.textContent = '';
    const missing = [];
    for (const e of brUI.effects) {
        const img = brEl('img', { class: 'br-effect-img', alt: e.name, src: e.thumb || undefined });
        if (!e.thumb) missing.push({ e, img });
        box.append(brEl('button', { type: 'button', class: 'br-effect' + (brUI.sel === e.id ? ' on' : ''), 'data-id': e.id, title: e.description,
            onclick: () => brPick(e.id, null) }, [
            brEl('div', { class: 'br-effect-thumb' }, [img]),
            brEl('span', { class: 'br-effect-name', text: e.name }),
            brEl('span', { class: 'br-effect-desc', text: e.description })
        ]));
    }
    if (missing.length) {
        (async () => {
            for (const { e, img } of missing) {
                try {
                    const r = await window.sa.brollPreview({ effect: e.id, props: { ...e.defaults, x: 0.5, y: 0.5 }, width: 1280, height: 720, at: 0.65, maxDim: 360 });
                    if (r && r.dataUrl) { e.thumb = r.dataUrl; img.src = r.dataUrl; }
                } catch (err) { /* ignore */ }
            }
        })();
    }
}

// Selects an effect; values = a placed clip's props (editing) or the last values used, then the defaults.
function brPick(id, values) {
    const e = brUI.effects.find(x => x.id === id);
    if (!e) return;
    brUI.sel = id;
    try { localStorage.setItem('brEffect', id); } catch (err) { /* ignore */ }
    brUI.values = { ...e.defaults, ...(e.last || {}), ...(values || {}) };
    $('brEffects').querySelectorAll('.br-effect').forEach(b => b.classList.toggle('on', b.dataset.id === id));
    const prev = $('brPreview'), tip = $('brPreviewTip');
    if (prev) prev.title = e.description || '';
    if (tip) tip.textContent = e.description || '';
    brRenderFields($('brFields'), e.fields);
    brRenderFields($('brCommon'), brUI.common);
    brSyncRangeBar();
    const fm = $('brFromSubMsg'); if (fm) fm.classList.add('hidden');
    if (!values && $('brFromSub') && $('brFromSub').checked) { brFillFromSub(); return; }
    brPreviewSoon(true);
}

// In start / In length / Out / Lands at are set by the Place section's range bar, not as settings fields.
const BR_RANGE_KEYS = new Set(['enter', 'exit', 'delay', 'settle', 'fitIn']);

function brRenderFields(box, fields) {
    box.textContent = '';
    const checks = [];
    for (const f of fields) {
        if (BR_RANGE_KEYS.has(f.key)) continue;   // timing lives on the Place range bar
        const v = brUI.values[f.key];
        let input;
        const set = (val) => { brUI.values[f.key] = val; brPreviewSoon(); };
        if (f.type === 'bool') {
            input = brEl('input', { type: 'checkbox' });
            input.checked = !!v;
            input.addEventListener('change', () => set(input.checked));
            checks.push(brEl('label', { class: 'br-check', title: f.help }, [input, brEl('span', { text: f.label })]));
            continue;
        }
        if (f.type === 'number') {
            input = brEl('input', { type: 'number', step: f.step, min: f.min, max: f.max });
            input.value = v;
            input.addEventListener('input', () => { const n = Number(input.value); if (Number.isFinite(n)) set(n); });
        } else if (f.type === 'color') {
            // the panel's colour box: a click opens the macOS Colors panel (design/color-fields.js), live as you pick
            input = brEl('input', { type: 'color', 'data-key': f.key });
            input.value = v || '#ffffff';
            input.addEventListener('input', () => { brTrace('input ' + f.key + ' ' + input.value); set(input.value); });
            input.addEventListener('change', () => brTrace('change ' + f.key + ' ' + input.value));
            input.addEventListener('click', () => brTrace('click ' + f.key + ' from ' + input.value), true);
            box.append(brEl('label', { class: 'cut-f br-color', title: f.help }, [brEl('span', { text: f.label }), input]));
            continue;
        } else if (f.type === 'list') {
            input = brEl('textarea', { rows: Math.min(6, Math.max(2, (v || []).length)), placeholder: 'one per line' });
            input.value = (v || []).join('\n');
            input.addEventListener('input', () => set(input.value.split('\n').map(s => s.trim()).filter(Boolean)));
        } else {
            input = brEl('input', { type: 'text' });
            input.value = v === undefined ? '' : v;
            input.addEventListener('input', () => set(input.value));
        }
        box.append(brEl('label', { class: 'cut-f' + (f.type === 'list' ? ' br-wide' : ''), title: f.help }, [brEl('span', { text: f.label }), input]));
    }
    if (checks.length) box.append(brEl('div', { class: 'br-checks-row' }, checks));
    try { attachHexFields(); } catch (e) { /* the boxes still open the picker */ }
}

// "Fill from subtitle at playhead": the words of the subtitle there go into this effect's text fields (main/broll.js
// brollFromPlayhead, the same reading Auto uses); colours, header and layout keep their values.
let brFillSeq = 0;
async function brFillFromSub() {
    if (!brUI.sel) return;
    const seq = ++brFillSeq;
    const msg = $('brFromSubMsg');
    const r = await window.sa.brollFromPlayhead({ effect: brUI.sel });
    if (seq !== brFillSeq) return;
    msg.classList.remove('hidden');
    if (!r || r.error) { msg.textContent = (r && r.error) || 'No subtitle at the playhead'; msg.dataset.kind = ''; return; }
    const e = brUI.effects.find(x => x.id === brUI.sel);
    if (!e) return;
    brUI.values = { ...brUI.values, ...r.props };
    brRenderFields($('brFields'), e.fields);
    msg.textContent = 'From #' + r.subtitle.index + ': “' + r.subtitle.text + '”';
    msg.dataset.kind = 'ok';
    // place it on that subtitle too, unless the user picked marks or the playhead
    if ($('brWhere').value === 'num') $('brSub').value = r.subtitle.index;
    brPreviewSoon(true);
    brLiveSoon();
}

// ------------------------------------------------------------------ preview

function brFieldEdited(now) {
    if (brView() === 'timeline' && brUI.editing) brLiveSoon(now);
    else brPreviewSoon(now);
}

// The preview: a still at the Moment (drawn small, at the panel's size), then a strip of ~24 frames over the whole
// clip in one pass. Once the strip is in, the Moment slider only swaps pictures (no render); any settings change starts
// a new still + strip.
let brPreviewTimer = null;
// Seconds only counts where it is shown: "At the playhead", or while editing a placed clip (its length).
function brSecVal() { return $('brSecWrap').classList.contains('hidden') ? 0 : (Number($('brSec').value) || 0); }
function brKey() { return JSON.stringify([brUI.sel, brUI.values, brSecVal()]); }

function brPreviewSoon(now) {
    if (brView() === 'timeline') { brLiveSoon(); return; }
    clearTimeout(brPreviewTimer);
    brPreviewTimer = setTimeout(brPreview, now ? 0 : 300);
}

function brShow(url, w, h) {
    const box = $('brPreview');
    if (w && h) box.style.aspectRatio = w + ' / ' + h;
    $('brPreviewImg').src = url;
    $('brPreviewMsg').classList.add('hidden');
}

// Moment slider: the nearest strip frame when the strip matches the settings, else a quick still.
function brMoment() {
    const st = brUI.strip;
    if (st && st.key === brKey() && st.frames.length) {
        const at = Number($('brAt').value);
        let best = st.frames[0];
        for (const f of st.frames) if (Math.abs(f.at - at) < Math.abs(best.at - at)) best = f;
        brShow(best.url, st.width, st.height);
        return;
    }
    clearTimeout(brPreviewTimer);
    brPreviewTimer = setTimeout(() => brPreview(true), 120);
}

async function brPreview(stillOnly) {
    if (!brUI.sel) return;
    const seq = ++brUI.previewSeq;
    const key = brKey();
    const msg = $('brPreviewMsg');
    msg.textContent = 'Drawing…'; msg.classList.remove('hidden');
    const sec = brSecVal() || undefined;
    const r = await window.sa.brollPreview({ effect: brUI.sel, props: brUI.values, at: Number($('brAt').value), seconds: sec, maxDim: 720 });
    if (seq !== brUI.previewSeq) return;     // a newer change is already drawing
    if (!r || r.error) { msg.textContent = (r && r.error) || 'No preview'; return; }
    brShow(r.dataUrl, r.width, r.height);
    if (stillOnly || (brUI.strip && brUI.strip.key === key)) return;
    // the scrub strip for these settings, in the background
    const st = await window.sa.brollStrip({ effect: brUI.sel, props: brUI.values, seconds: sec, count: 24, maxDim: 560 });
    if (!st || st.error || key !== brKey()) return;
    brUI.strip = { key, width: st.width, height: st.height, frames: st.frames };
}

async function brLoadFrame() {
    const r = await window.sa.brollFrame();
    if (!r || r.error) return;
    brUI.frame = r;
    if (r.subtitle && !$('brSub').value) $('brSub').placeholder = '#' + r.subtitle.index;
    brApplyBg();
}

function brApplyBg() {
    const box = $('brPreview'), bg = $('brBg').value;
    box.dataset.bg = bg;
    box.style.backgroundImage = bg === 'frame' && brUI.frame && brUI.frame.img ? 'url("' + brUI.frame.img + '")' : '';
    if (brUI.frame) box.style.aspectRatio = brUI.frame.width + ' / ' + brUI.frame.height;
}

// ------------------------------------------------------------------ place / update

function brWhere() {
    const w = $('brWhere').value;
    const o = { effect: brUI.sel, props: { ...brUI.values }, usePrefs: false };
    const sec = brSecVal(), tr = Number($('brTrack').value);
    if (sec > 0) o.seconds = sec;
    if (tr > 0) o.track = tr;
    if ($('brLand').checked) o.landOnWord = true;
    if ($('brDraft').checked) o.draft = true;
    const ext = $('brExtWrap').classList.contains('hidden') ? 0 : Number($('brExtend').value);
    if (ext > 0) o.extend = ext;
    if (w === 'marks') o.marks = true;
    else if (w === 'sub') o.subtitle = brUI.detected ? brUI.detected.index : 'playhead';   // the one shown under "Goes on"
    else if (w === 'num') { const n = Number($('brSub').value); if (!(n > 0)) throw new Error('Type the subtitle number'); o.subtitle = n; }
    return o;
}

async function brPlace(asNew) {
    if (brUI.busy || !brUI.sel) return;
    let o;
    try { o = brWhere(); } catch (e) { brStatus(e.message, 'bad'); return; }
    const live = brView() === 'timeline';
    brBusy(true);
    await brLiveIdle();                            // a live update still rendering finishes first
    const finalize = live && brUI.editing && !asNew;
    brStatus(finalize ? 'Finalizing at full size…' : brUI.editing && !asNew ? 'Re-rendering…' : live ? 'Rendering a draft for the timeline…' : 'Rendering…', '');
    let r;
    if (brUI.editing && !asNew) {
        const ch = { id: brUI.editing.id, effect: brUI.sel, props: o.props, landOnWord: !!o.landOnWord };
        // editing: Seconds sets the length, only when it was changed (a rounded read-back would re-place the clip)
        if (o.seconds && $('brSec').value !== brUI.liveSec) ch.seconds = o.seconds;
        ch.draft = live ? false : !!o.draft;       // timeline view: the button is Finalize; panel view: the Draft box decides
        r = await window.sa.brollAdjust(ch);
    } else {
        if (live) o.draft = true;
        r = await window.sa.brollPlace(o);
    }
    brBusy(false);
    if (!r || r.error) { brStatus((r && r.error) || 'Failed', 'bad'); return; }
    if (r.landed) brStatus($('brStatus').textContent + ' · lands on “' + r.landed.word + '”' + (r.landed.source === 'speech' ? '' : ' (estimated)'), 'ok');
    if (finalize) brEdit(null);                    // done: full size on the timeline
    else if (live || (brUI.editing && !asNew)) brEdit(r);   // a new timeline draft opens for live editing; an update stays in edit mode
    brLoadPlaced();
}

// ------------------------------------------------------------------ live: the edited clip re-renders on the timeline

function brView() { return ($('brView') && $('brView').value) || 'timeline'; }
let brLiveTimer = null;
function brLiveSoon(now) {
    if (!brUI.editing || brView() !== 'timeline') return;
    clearTimeout(brLiveTimer);
    brLiveTimer = setTimeout(brLiveRun, now ? 0 : 350);
}

async function brLiveRun() {
    const rec = brUI.editing;
    if (!rec || brView() !== 'timeline' || brUI.busy) return;
    if (brUI.liveRunning) { brUI.livePending = true; return; }
    const key = brKey();
    if (key === brUI.liveKey) return;
    brUI.liveRunning = true;
    let done;
    brUI.liveDone = new Promise(res => { done = res; });
    brLiveNote('Updating the clip on the timeline…', true);
    const ch = { id: rec.id, effect: brUI.sel, props: { ...brUI.values }, draft: true, live: true };
    const secChanged = $('brSec').value !== brUI.liveSec && brSecVal() > 0;
    if (secChanged) ch.seconds = brSecVal();
    let r;
    try { r = await window.sa.brollAdjust(ch); } catch (e) { r = { error: String(e.message || e) }; }
    brUI.liveRunning = false;
    done();
    if (brUI.editing && brUI.editing.id === rec.id) {
        if (!r || r.error) brLiveNote('Could not update: ' + ((r && r.error) || 'failed'), true);
        else {
            brUI.liveKey = key;
            if (secChanged) brUI.liveSec = $('brSec').value;
            brUI.editing = r;
            brEditTag();
            brLiveNote('Updated on the timeline' + (r.seconds ? ' (' + r.seconds + ' s)' : '') + '. Changes re-render it there; Finalize when it looks right.');
        }
    }
    if (brUI.livePending) { brUI.livePending = false; brLiveRun(); }
}

function brLiveIdle() { clearTimeout(brLiveTimer); brUI.livePending = false; return brUI.liveRunning ? brUI.liveDone : Promise.resolve(); }

function brLiveNote(text, busy) {
    const el = $('brLiveNote');
    if (!el) return;
    el.textContent = text || '';
    el.classList.toggle('hidden', !text);
    el.classList.toggle('busy', !!busy);
}

// The buttons and texts for the view (timeline / panel) and edit state.
function brButtons() {
    const on = !!brUI.editing, live = brView() === 'timeline';
    $('brMake').dataset.view = live ? 'timeline' : 'panel';
    $('brPlace').textContent = on ? (live ? 'Finalize (full size)' : 'Update clip') : (live ? 'Place on timeline' : 'Render & place');
    $('brPlace').title = live ? (on ? 'Re-render this clip at full size, in place, and stop editing it' : 'Place a half-size draft; then every change re-renders it on the timeline') : '';
    $('brPlaceNew').classList.toggle('hidden', !on);
    $('brStopEdit').classList.toggle('hidden', !on);
    $('brSettingsSub').textContent = live ? (on ? 'changes re-render the clip on the timeline' : 'Place it, then watch it in Resolve') : 'the preview redraws as you type';
    if (!on || !live) brLiveNote('');
    else if ($('brLiveNote').classList.contains('hidden')) brLiveNote('Editing on the timeline (half-size draft). Changes re-render it there; Finalize when it looks right.');
}

function brEditTag() {
    const rec = brUI.editing, tag = $('brEditing');
    tag.classList.toggle('hidden', !rec);
    tag.textContent = rec ? 'editing ' + rec.name + (rec.subtitle ? ' on #' + rec.subtitle.index : '') + ' · ' + rec.id + (rec.draft ? ' · draft' : '') : '';
}

function brEdit(rec) {
    clearTimeout(brLiveTimer); brUI.livePending = false;
    brUI.editing = rec || null;
    const on = !!rec;
    brEditTag();
    brLiveNote('');
    brButtons();
    brWhereChanged();
    if (on) {
        brPick(rec.effect, rec.props);
        $('brSec').value = rec.frames && rec.fps ? (rec.frames / rec.fps).toFixed(1) : '';
        $('brDraft').checked = !!rec.draft;
        brUI.liveSec = $('brSec').value;
        brUI.liveKey = brKey();                     // what is on the timeline now: only a change re-renders
    } else {
        $('brSec').value = '';
        brUI.liveSec = '';
    }
}

// ------------------------------------------------------------------ auto

function brRenderAllow() {
    const box = $('brAllow');
    box.textContent = '';
    let off = [];
    try { off = JSON.parse(localStorage.getItem('brAllowOff') || '[]'); } catch (e) { /* ignore */ }
    for (const e of brUI.effects) {
        const cb = brEl('input', { type: 'checkbox', 'data-id': e.id });
        cb.checked = !off.includes(e.id);
        cb.addEventListener('change', () => {
            const o = [...box.querySelectorAll('input')].filter(i => !i.checked).map(i => i.dataset.id);
            try { localStorage.setItem('brAllowOff', JSON.stringify(o)); } catch (err) { /* ignore */ }
        });
        box.append(brEl('label', { class: 'br-chip' }, [cb, brEl('span', { text: e.name })]));
    }
}

function brPropsLine(p) {
    return Object.entries(p || {}).map(([k, v]) => k + ': ' + (Array.isArray(v) ? v.join(', ') : v)).join(' · ');
}

async function brSuggest() {
    if (brUI.busy) return;
    const effects = [...$('brAllow').querySelectorAll('input')].filter(i => i.checked).map(i => i.dataset.id);
    brStatus('Reading the subtitles…', '', 'brAutoStatus');
    const r = await window.sa.brollSuggest({ max: Number($('brMax').value) || 8, minGap: Number($('brGap').value), effects,
        from: Number($('brFrom').value) || undefined, to: Number($('brTo').value) || undefined, marks: $('brAutoMarks').checked });
    if (!r || r.error) { brStatus((r && r.error) || 'Failed', 'bad', 'brAutoStatus'); return; }
    brUI.suggestions = r.suggestions.map(s => ({ ...s, on: true }));
    brRenderSuggestions();
    brStatus(r.suggestions.length ? r.suggestions.length + ' suggestions from ' + r.subtitles + ' subtitles. Untick any you do not want, or Edit one first.'
        : 'Nothing in ' + r.subtitles + ' subtitles matched. Use Make for a hand-picked line.', r.suggestions.length ? 'ok' : '', 'brAutoStatus');
}

function brRenderSuggestions() {
    const box = $('brSuggestions');
    box.textContent = '';
    for (const s of brUI.suggestions) {
        const cb = brEl('input', { type: 'checkbox' });
        cb.checked = s.on;
        cb.addEventListener('change', () => { s.on = cb.checked; $('brPlaceTicked').disabled = brUI.busy || !brUI.suggestions.some(x => x.on); });
        const sel = brEl('select', { class: 'br-sel' }, brUI.effects.map(e => { const o = brEl('option', { value: e.id, text: e.name }); if (e.id === s.effect) o.selected = true; return o; }));
        sel.addEventListener('change', () => { s.effect = sel.value; s.props = {}; s.name = sel.selectedOptions[0].textContent; });
        box.append(brEl('div', { class: 'br-item' }, [
            cb,
            brEl('span', { class: 'br-num', text: '#' + s.subtitle }),
            brEl('div', { class: 'br-item-main' }, [brEl('div', { class: 'br-item-text', text: s.text }), brEl('div', { class: 'br-item-props', text: brPropsLine(s.props) + ' — ' + s.why })]),
            sel,
            brEl('button', { class: 'ghost', text: 'Edit', title: 'Open in Make with this subtitle', onclick: () => {
                brEdit(null);
                brPick(s.effect, s.props);
                $('brWhere').value = 'num'; $('brSub').value = s.subtitle; brWhereChanged();
                brSubTab('make');
            } })
        ]));
    }
    $('brPlaceTicked').disabled = brUI.busy || !brUI.suggestions.some(s => s.on);
}

async function brPlaceTicked() {
    const land = $('brLand').checked;
    const ext = Number($('brExtend').value) > 0 ? Number($('brExtend').value) : undefined;
    const draft = $('brDraft').checked || undefined;
    const list = brUI.suggestions.filter(s => s.on).map(s => ({ effect: s.effect, props: s.props, subtitle: s.subtitle, landOnWord: land || undefined, extend: ext, draft }));
    if (!list.length || brUI.busy) return;
    brBusy(true);
    brStatus('Placing ' + list.length + '…', '', 'brAutoStatus');
    const r = await window.sa.brollPlaceMany(list);
    brBusy(false);
    if (!r || r.error) { brStatus((r && r.error) || 'Failed', 'bad', 'brAutoStatus'); return; }
    const ok = r.filter(x => x.ok).length, bad = r.filter(x => !x.ok);
    brStatus(ok + ' placed' + (bad.length ? ', ' + bad.length + ' failed: ' + bad.map(b => '#' + b.subtitle + ' ' + b.error).join('; ') : ''), bad.length ? 'bad' : 'ok', 'brAutoStatus');
    for (const s of brUI.suggestions) if (s.on && r.some(x => x.ok && x.subtitle && x.subtitle.index === s.subtitle)) s.on = false;
    brUI.suggestions = brUI.suggestions.filter(s => !r.some(x => x.ok && x.subtitle && x.subtitle.index === s.subtitle));
    brRenderSuggestions();
    brLoadPlaced();
}

// ------------------------------------------------------------------ placed

async function brLoadPlaced() {
    const r = await window.sa.brollList({});
    if (!r || r.error) return;
    brUI.placed = r.placed;
    $('brPlacedCount').textContent = r.placed.length ? String(r.placed.length) : '';
    const drafts = r.drafts || 0;
    $('brFinalizeAll').classList.toggle('hidden', !drafts);
    $('brFinalizeAll').textContent = drafts > 1 ? 'Finalize ' + drafts + ' drafts' : 'Finalize draft';
    const dn = $('brDraftNote');
    dn.classList.toggle('hidden', !drafts);
    dn.textContent = drafts ? drafts + (drafts > 1 ? ' clips are' : ' clip is') + ' a half-size draft (orange on the timeline). Finalize before you export.' : '';
    const box = $('brPlacedList');
    box.textContent = '';
    if (!r.placed.length) { box.append(brEl('div', { class: 'cr-sub', text: 'No B-roll placed on ' + (r.timeline || 'this timeline') + ' yet.' })); return; }
    for (const p of r.placed) {
        const sec = p.fps ? (p.frames / p.fps).toFixed(1) + ' s' : '';
        box.append(brEl('div', { class: 'br-item' + (p.onTimeline === false ? ' gone' : '') }, [
            brEl('span', { class: 'br-num', text: p.subtitle ? '#' + p.subtitle.index : '·' }),
            brEl('div', { class: 'br-item-main' }, [
                brEl('div', { class: 'br-item-text' }, [p.draft ? brEl('span', { class: 'br-draft', text: 'draft' }) : null,
                    p.name + ' · ' + (p.track || '') + ' · ' + sec + (p.onTimeline === false ? ' · not on the timeline' : '')]),
                brEl('div', { class: 'br-item-props', text: brPropsLine(p.props) })
            ]),
            brEl('button', { class: 'ghost br-id', text: p.id, title: 'Copy the id (for Claude: adjust_broll ' + p.id + ' …)', onclick: () => { try { navigator.clipboard.writeText(p.id); } catch (e) { /* ignore */ } } }),
            p.draft ? brEl('button', { class: 'ghost', text: 'Finalize', disabled: p.onTimeline === false, title: 'Re-render at full size, in place', onclick: () => brFinalize({ id: p.id }) }) : null,
            brEl('button', { class: 'ghost', text: 'Sync', disabled: p.onTimeline === false, title: 'Re-time it so the animation lands as its key word is spoken', onclick: () => brSync({ id: p.id }) }),
            brEl('button', { class: 'ghost', text: 'Edit', disabled: p.onTimeline === false, onclick: () => { brEdit(p); brSubTab('make'); } }),
            brEl('button', { class: 'ghost', text: '×', title: 'Remove from the timeline', onclick: async () => {
                const x = await window.sa.brollRemove({ id: p.id });
                if (brUI.editing && brUI.editing.id === p.id) brEdit(null);
                if (x && x.error) brStatus(x.error, 'bad');
                brLoadPlaced();
            } })
        ]));
    }
}

// Sync to words: one clip ({ id }) or every one on the timeline ({ all: true }).
async function brSync(o) {
    if (brUI.busy) return;
    brBusy(true);
    brStatus(o.all ? 'Syncing every B-roll to its word…' : 'Syncing to the word…', '', 'brPlacedStatus');
    const r = await window.sa.brollSync(o);
    brBusy(false);
    if (!r || r.error) { brStatus((r && r.error) || 'Failed', 'bad', 'brPlacedStatus'); return; }
    const ok = r.results.filter(x => x.ok), bad = r.results.filter(x => !x.ok);
    const words = ok.map(x => '“' + x.word + '”' + (x.source === 'speech' ? '' : '*')).join(', ');
    brStatus((ok.length ? ok.length + ' synced' + (words ? ': ' + words : '') : '') + (bad.length ? (ok.length ? '; ' : '') + bad.length + ' failed: ' + bad.map(b => b.error).join('; ') : '')
        + (r.note ? ' — * ' + r.note : ''), bad.length ? 'bad' : 'ok', 'brPlacedStatus');
    brLoadPlaced();
}

// Finalize: drafts re-rendered at full size under the same clip (one { id } or { all: true }).
async function brFinalize(o) {
    if (brUI.busy) return;
    brBusy(true);
    brStatus(o.all ? 'Finalizing the drafts at full size…' : 'Finalizing at full size…', '', 'brPlacedStatus');
    const r = await window.sa.brollFinalize(o);
    brBusy(false);
    if (!r || r.error) { brStatus((r && r.error) || 'Failed', 'bad', 'brPlacedStatus'); return; }
    const bad = r.results.filter(x => !x.ok);
    brStatus(r.note || (r.finalized + ' finalized' + (bad.length ? ', ' + bad.length + ' failed: ' + bad.map(b => b.error).join('; ') : '')), bad.length ? 'bad' : 'ok', 'brPlacedStatus');
    if (brUI.editing && r.results.some(x => x.ok && x.id === brUI.editing.id)) brUI.editing.draft = undefined;
    brLoadPlaced();
}

// ------------------------------------------------------------------ wiring

// Only the fields this "Where" uses: the detected subtitle (under the playhead), the number (Subtitle number…),
// Seconds (At the playhead, or the length while editing a clip), Extend by (subtitle / marks ranges). Track always.
// (Where stays while editing: it is used by Place as new.)
function brWhereChanged() {
    const w = $('brWhere').value, editing = !!brUI.editing;
    $('brDetWrap').classList.toggle('hidden', w !== 'sub');
    $('brSubWrap').classList.toggle('hidden', w !== 'num');
    $('brSecWrap').classList.toggle('hidden', !(w === 'playhead' || editing));
    $('brEnterWrap').classList.remove('hidden');
    brSyncRangeBar();
    $('brExtWrap').classList.toggle('hidden', w === 'playhead');
    try { localStorage.setItem('brWhere', w); } catch (e) { /* ignore */ }
    brShowDetected();
}

// "Subtitle under the playhead": the panel's own poll (state.live) already knows it, so this follows the playhead
// without asking Resolve again.
function brShowDetected() {
    const L = state.live, s = L && L.ok ? L.subtitle : null;
    const key = s ? s.index + '|' + s.text : (L && L.ok ? 'none' : 'off');
    if (brUI.lastSubKey !== key) {
        brUI.lastSubKey = key;
        brUI.detected = s ? { index: s.index, text: s.text, start: s.start, end: s.end } : null;
        // word timings set by hand belong to one subtitle: a new one starts from its own speech
        if (!brUI.editing && brUI.values && brUI.values._manual) { delete brUI.values._times; delete brUI.values._ends; delete brUI.values._manual; brLandNoteText(); }
        if (!brUI.editing && $('brSec')) {
            const fps = (L && L.fps) || 30;
            $('brSec').placeholder = (s && s.end > s.start) ? ((s.end - s.start) / fps).toFixed(1) : "effect's";
        }
        if (s && $('brFromSub') && $('brFromSub').checked && state.tab === 'broll') brFillFromSub();
        brSyncRangeBar();
    }
    const box = $('brDetected');
    if (!box || $('brDetWrap').classList.contains('hidden')) return;
    if (box.dataset.key === key) return;
    box.dataset.key = key;
    box.textContent = '';
    box.classList.toggle('none', !s);
    if (s) {
        const t = String(s.text || '').replace(/\s+/g, ' ').trim();
        box.append(brEl('b', { text: '#' + s.index }), t);
        box.title = '#' + s.index + ': ' + t;
    } else {
        box.textContent = L && L.ok ? 'No subtitle here: the next one after the playhead' : 'Not connected to Resolve';
        box.title = '';
    }
}

// The clip length in frames (last frame index): the placed clip while editing, else Seconds, else the subtitle under
// the playhead (+ Extend by), else the effect's own length.
function brRangeLen() {
    const rec = brUI.editing;
    if (rec && Number(rec.frames) > 2) return Number(rec.frames) - 1;
    const fps = (state.live && state.live.fps) || 30;
    let f = brSecVal() * fps;
    const d = brUI.detected, w = $('brWhere') && $('brWhere').value;
    if (!(f > 0) && w === 'sub' && d && d.end > d.start) f = (d.end - d.start) + (Number($('brExtend') && $('brExtend').value) || 0) * fps;
    if (!(f > 0)) { const e = brUI.effects.find(x => x.id === brUI.sel); f = ((e && e.seconds) || 2.5) * fps; }
    return Math.max(3, Math.round(f) - 1);
}

// The animation In window: left head = where it starts (delay), right head = where it has landed (delay + enter).
function brInWindow(L) {
    const s0 = Math.max(0, Math.min(L - 1, Math.round(Number(brUI.values.delay ?? 0))));
    const len = Math.max(1, Math.min(L - s0, Math.round(Number(brUI.values.enter ?? 10))));
    return { s: s0, e: s0 + len };   // the frame range bar's { s, e }
}

function brSyncRangeBar() { if (brUI.range) brUI.range.paint(); }

// The playhead relative to the clip start: the placed clip while editing, else the subtitle it will go on ("Subtitle
// under the playhead"). "At the playhead" starts the clip at the playhead itself, so it is always frame 0.
function brPlayheadIn() {
    const L = state.live, rec = brUI.editing, d = brUI.detected, w = $('brWhere') && $('brWhere').value;
    if (!L || !L.ok || !Number.isFinite(Number(L.frame))) return null;
    const start = rec ? Number(rec.start) : w === 'sub' && d ? Number(d.start) : w === 'playhead' ? Number(L.frame) : NaN;
    if (!Number.isFinite(start)) return null;
    const rel = Math.round(Number(L.frame)) - Math.round(start);
    return rel >= 0 && rel <= brRangeLen() ? rel : null;
}

// The Place section's animation In bar (js/components/frame-range.js).
function brInitRangeBar() {
    const mount = $('brRangeMount');
    if (!mount) return;
    const dflt = () => { const e = brUI.effects.find(x => x.id === brUI.sel), d = (e && e.defaults) || {}; return { s: d.delay ?? 0, e: (d.delay ?? 0) + (d.enter ?? 10) }; };
    brUI.range = frameRangeBar({
        title: 'Animation In: left head = where it starts, right head = where it has landed (the gap is its length). Drag between them to move it. Snaps to the red Resolve playhead (P). Double-click: default',
        last: brRangeLen,
        get: () => brInWindow(brRangeLen()),
        change: (s, e, final) => {
            brUI.values.delay = s;
            brUI.values.enter = e - s;
            brUI.values.fitIn = true;                                   // the build lands on the right head
            if (Number(brUI.values.settle) > 0) brUI.values.settle = 0;   // the bar now decides where the In lands
            if (final) brFieldEdited(true);
        },
        read: (s, e, L) => 'In <b>' + s + '</b> f → <b>' + e + '</b> f · length <b>' + (e - s) + '</b> f <span class="fxr-len">/ ' + (L + 1) + ' f</span>',
        playhead: brPlayheadIn,
        lane: brLane,
        laneEdit: brLaneEdit,
        laneReset: brLaneReset,
        dflt
    });
    const note = brEl('div', { id: 'brLandNote', class: 'br-land-note hidden', text: 'Land on the spoken word sets the animation: each word comes in as it is spoken. Untick it to time the In here.' });
    mount.replaceWith(brUI.range.el, note);
    brLandSync();
}

// The word lane under the In bar: the subtitle as one block; with Land on the spoken word, one block per word as it
// will be timed (from the main process: the transcription if there is one, else estimated), the key word marked.
function brLane() {
    const L = brRangeLen(), rec = brUI.editing, w = $('brWhere') && $('brWhere').value, d = brUI.detected;
    const sub = rec ? rec.subtitle : (w === 'sub' && d ? d : null);
    if (!sub) return null;
    if (!($('brLand') && $('brLand').checked)) {
        const t = String(sub.text || '').replace(/\s+/g, ' ').trim();
        return t ? { segs: [{ s: 0, e: L, label: t, title: '#' + sub.index + ' “' + t + '” · 0–' + L + ' f' }] } : null;
    }
    const q = rec ? { id: rec.id } : { subtitle: sub.index };
    const key = JSON.stringify([brUI.sel, q, brUI.values]);
    if (key !== brUI.laneKey && !brUI.laneBusy && brUI.sel) {
        brUI.laneBusy = true;
        setTimeout(async () => {
            let r = null;
            try { r = await window.sa.brollWordLane({ effect: brUI.sel, props: brUI.values, ...q }); } catch (e) { r = null; }
            brUI.laneKey = key;
            brUI.laneData = r && !r.error && Array.isArray(r.segs) ? r : null;
            brUI.laneBusy = false;
            brSyncRangeBar();
        }, 250);
    }
    const r = brUI.laneData;
    if (!r || !r.segs.length) return null;
    const est = r.source === 'estimate' ? ' (estimated: no transcription yet)' : '';
    return { editable: !!r.editable, segs: r.segs.map(g => ({ ...g, title: '“' + g.label + '” · ' + g.s + '–' + g.e + ' f' + (g.key ? ' · lands here' : '') + est })) };
}

// A word block was dragged in the lane: every word's in / end go into the clip's props (_times / _ends) and are kept
// (_manual) until Sync to words or a double-click on the lane re-times them from the speech.
function brLaneEdit(i, s, e, final) {
    const r = brUI.laneData;
    if (!r || !r.segs[i]) return;
    r.segs[i] = { ...r.segs[i], s, e };
    brUI.values._times = r.segs.map(g => g.s);
    brUI.values._ends = r.segs.map(g => g.e);
    brUI.values._manual = true;
    brUI.laneKey = JSON.stringify([brUI.sel, brUI.editing ? { id: brUI.editing.id } : { subtitle: (brUI.detected || {}).index }, brUI.values]);
    brLandNoteText();
    if (final) brFieldEdited(true);
}

function brLaneReset() {
    delete brUI.values._times; delete brUI.values._ends; delete brUI.values._manual;
    brUI.laneKey = null;
    brLandNoteText();
    brFieldEdited(true);
}

function brLandNoteText() {
    const n = $('brLandNote');
    if (n) n.textContent = brUI.values && brUI.values._manual
        ? 'Word timings set by hand: strawberry = a word\'s in, matcha = its end. Double-click the words to re-time them from the speech.'
        : 'Land on the spoken word sets the animation: each word comes in as it is spoken. Drag a word\'s strawberry in or matcha end to adjust it.';
}

// Land on the spoken word decides the timing (word by word, or the build landing on the key word), so the In bar is
// muted under it, with a note.
function brLandSync() {
    const on = !!($('brLand') && $('brLand').checked);
    if (brUI.range) {
        brUI.range.el.classList.toggle('fxr-off', on);
        const bar = brUI.range.el.querySelector('.fxr-bar');
        if (bar) bar.tabIndex = on ? -1 : 0;
        brUI.range.el.title = on ? 'Set by Land on the spoken word' : '';
    }
    const n = $('brLandNote'); if (n) n.classList.toggle('hidden', !on);
    brLandNoteText();
    brUI.laneKey = null;
    if (brUI.range) brUI.range.paint();
}

function initBrollTab() {
    $('brWrap').querySelectorAll('.presets-tab[data-br]').forEach(b => b.addEventListener('click', () => brSubTab(b.dataset.br)));
    $('brPlace').addEventListener('click', () => brPlace(false));
    $('brPlaceNew').addEventListener('click', () => brPlace(true));
    $('brStopEdit').addEventListener('click', () => brEdit(null));
    $('brCancel').addEventListener('click', () => window.sa.brollCancel());
    try { $('brFromSub').checked = localStorage.getItem('brFromSub') === '1'; } catch (e) { /* ignore */ }
    $('brFromSub').addEventListener('change', () => {
        try { localStorage.setItem('brFromSub', $('brFromSub').checked ? '1' : '0'); } catch (e) { /* ignore */ }
        if ($('brFromSub').checked) brFillFromSub();
    });
    $('brReset').addEventListener('click', () => { const e = brUI.effects.find(x => x.id === brUI.sel); if (e) { brUI.values = { ...e.defaults }; brPick(e.id, e.defaults); } });
    $('brAt').addEventListener('input', brMoment);
    $('brSec').addEventListener('input', () => { brSyncRangeBar(); brFieldEdited(); });
    $('brExtend').addEventListener('input', brSyncRangeBar);
    brInitRangeBar();
    try { const v = localStorage.getItem('brView'); if (v === 'panel' || v === 'timeline') $('brView').value = v; } catch (e) { /* ignore */ }
    $('brView').addEventListener('change', () => {
        try { localStorage.setItem('brView', brView()); } catch (e) { /* ignore */ }
        brButtons();
        if (brView() === 'panel') { if ($('brBg').value === 'frame') brLoadFrame(); brPreviewSoon(true); }
    });
    brButtons();
    $('brBg').addEventListener('change', () => { try { localStorage.setItem('brBg', $('brBg').value); } catch (e) { /* ignore */ } if ($('brBg').value === 'frame') brLoadFrame(); else brApplyBg(); });
    $('brWhere').addEventListener('change', brWhereChanged);
    $('brSuggest').addEventListener('click', brSuggest);
    $('brPlaceTicked').addEventListener('click', brPlaceTicked);
    $('brRefresh').addEventListener('click', brLoadPlaced);
    $('brSyncAll').addEventListener('click', () => brSync({ all: true }));
    $('brFinalizeAll').addEventListener('click', () => brFinalize({ all: true }));
    try { $('brDraft').checked = localStorage.getItem('brDraft') === '1'; } catch (e) { /* ignore */ }
    $('brDraft').addEventListener('change', () => { try { localStorage.setItem('brDraft', $('brDraft').checked ? '1' : '0'); } catch (e) { /* ignore */ } });
    try { $('brLand').checked = localStorage.getItem('brLand') === '1'; } catch (e) { /* ignore */ }
    $('brLand').addEventListener('change', () => { try { localStorage.setItem('brLand', $('brLand').checked ? '1' : '0'); } catch (e) { /* ignore */ } brLandSync(); });
    brLandSync();
    $('brOpenFolder').addEventListener('click', () => window.sa.brollOpen({}));
    try { const bg = localStorage.getItem('brBg'); if (bg) $('brBg').value = bg; } catch (e) { /* ignore */ }
    try { const w = localStorage.getItem('brWhere'); if (w && $('brWhere').querySelector('option[value="' + w + '"]')) $('brWhere').value = w; } catch (e) { /* ignore */ }
    brWhereChanged();
    setInterval(() => { if (state.tab === 'broll') brShowDetected(); }, 300);
    window.sa.onBrollProgress((d) => {
        if (!d) return;
        if (d.phase === 'render') { $('brBar').style.width = Math.round((d.p || 0) * 100) + '%'; brStatus(d.text + (d.p ? ' ' + Math.round(d.p * 100) + '%' : ''), ''); }
        else if (d.phase === 'place') brStatus(d.text, '');
        else if (d.phase === 'done') { brStatus(d.text, 'ok'); $('brBar').style.width = '0'; if (d.placed && brUI.ready) brLoadPlaced(); }
        else if (d.phase === 'error') brStatus(d.text, 'bad');
    });
    let t = 'make';
    try { t = localStorage.getItem('brTab') || 'make'; } catch (e) { /* ignore */ }
    brSubTab(t);
}

// The tab was opened: effects once, the playhead frame and the placed list every time.
async function brollTabShown() {
    if (!brUI.ready) { brUI.ready = await brLoadEffects(); }
    if (brView() === 'panel') { if ($('brBg').value === 'frame') brLoadFrame(); else brApplyBg(); }
    brLoadPlaced();
}
