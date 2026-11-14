// B-roll tab > Collage: the collage-style explainer B-roll (src/main/collage.js, broll/collage/ in the code folder).
// 1 Project: the folder for this timeline. Auto-fill makes it (script, word timings, beats from the subtitles) and sets
//   every beat up in one run; the steps below are then for checking and swapping.
// 2 Beats: what each beat shows (talking head, photo, photo stack, video clip, medallion, document, title card), its search
//   words, the pictures found and picked, and its date / label / title overlays. Claude can plan the beats instead
//   (it writes shots.json); Reload shows its plan.
// 3 Render & place: a preview of the frame under the playhead, then the clips (ProRes 4444 with alpha) on the timeline:
//   B-roll and titles on one track, the word captions above. Placing again updates the clips already there.

const colUI = { data: null, open: new Set(), cands: new Map(), loading: false, busy: false };
const COL_VISUALS = { 'talking-head': 'Talking head', photo: 'Photo', stack: 'Photo stack', clip: 'Video clip', medallion: 'Medallion', document: 'Document', title: 'Title card' };
const COL_OVERLAYS = { date: 'Date', label: 'Label', title: 'Title', callout: 'Callout', highlight: 'Highlight' };
const COL_PICTURE_VISUALS = ['photo', 'stack', 'clip', 'document', 'medallion'];
// Stock sites searched besides Wikimedia Commons once their free API key is saved (Sources & API keys).
const COL_SITES = [
    { id: 'pexels', name: 'Pexels', keyPage: 'https://www.pexels.com/api/', note: 'Photos and videos, Pexels License (free to use, no credit needed)' },
    { id: 'pixabay', name: 'Pixabay', keyPage: 'https://pixabay.com/api/docs/', note: 'Photos and videos, Pixabay Content License (free to use, no credit needed)' }
];

function colSay(text, kind) { showStatus(text, kind, { target: 'colStatus' }); }

// Seconds from the timeline's first frame, "1:02.4".
function colTime(f) {
    const fps = (colUI.data && colUI.data.fps) || 30;
    const s = Math.max(0, f / fps);
    return Math.floor(s / 60) + ':' + (s % 60).toFixed(1).padStart(4, '0');
}

async function colCall(fn, arg) {
    let r;
    try { r = await fn(arg); } catch (e) { r = { error: String(e && e.message || e) }; }
    if (!r || r.error) throw new Error((r && r.error) || 'No answer from the plugin');
    return r;
}

// One action at a time: buttons off, Cancel on. The state it returns is kept and, unless `rowOnly` (a beat edit that
// updates its own row), shown in full.
async function colRun(label, fn, rowOnly) {
    if (colUI.busy) return null;
    colBusy(true);
    if (label) colSay(label, '');
    try {
        const r = await fn();
        if (r && r.beats) {
            colUI.data = r;
            if (rowOnly) { colRenderProject(); colRenderClips(); $('colFindAll').classList.toggle('hidden', !r.missingPictures); } else colRender();
        }
        return r;
    } catch (e) {
        colSay(String(e.message || e), 'bad');
        return null;
    } finally {
        colBusy(false);
    }
}

function colBusy(on) {
    colUI.busy = on;
    for (const id of ['colReset', 'colAutoStart', 'colAuto', 'colReload', 'colFindAll', 'colPreviewBtn', 'colRender', 'colPlaceOnly', 'colWords']) { const b = $(id); if (b) b.disabled = on; }
    document.querySelectorAll('#colBeats button, #colBeats select').forEach(b => { b.disabled = on; });
    $('colCancel').classList.toggle('hidden', !on);
    if (!on) $('colBar').style.width = '0';
}

async function colLoad() {
    if (colUI.loading || colUI.busy) return;
    colUI.loading = true;
    try {
        colUI.data = await colCall(window.sa.collageState);
        colRender();
    } catch (e) {
        colUI.data = null;
        colRender();
        colSay(String(e.message || e), 'bad');
    } finally {
        colUI.loading = false;
    }
}

// ------------------------------------------------------------------ 1 project

function colRender() {
    colRenderSources();
    colRenderProject();
    colRenderBeats();
    colRenderClips();
}

function colChip(text, kind, title) {
    return createEl('span', { class: 'col-chip' + (kind ? ' ' + kind : ''), text, title: title || undefined });
}

// The context field shows the project's saved one, never over what is being typed.
function colRenderContext() {
    const d = colUI.data, input = $('colContext');
    if (document.activeElement === input) return;
    if (d && d.hasPlan) input.value = d.context || '';
}

async function colSaveContext() {
    const d = colUI.data, v = $('colContext').value.trim();
    if (!d || !d.hasPlan || v === (d.context || '')) return;
    try { colUI.data = await colCall(window.sa.collageContext, { context: v }); } catch (e) { colSay(String(e.message || e), 'bad'); return; }
    const auto = colUI.data.beats.some(b => b.auto);
    colSay('Context saved' + (auto ? ': press Auto-fill to redo the beats it set up (the ones you changed stay).' : '.'), 'ok');
}

function colRenderProject() {
    colRenderContext();
    const d = colUI.data, box = $('colProject');
    $('colTimeline').textContent = d ? '“' + d.timeline + '”' : '';
    box.textContent = '';
    $('colStartBox').classList.toggle('hidden', !d || d.hasPlan);
    $('colOpen').disabled = !d;
    $('colReset').disabled = colUI.busy || !(d && d.hasPlan);
    if (!d) { box.append(colChip('Open a timeline in Resolve', 'warn')); return; }
    box.append(createEl('div', { class: 'col-path', text: d.dir, title: d.dir }));
    if (!d.hasPlan) return;
    const chips = createEl('div', { class: 'col-chips' });
    chips.append(colChip(d.script ? 'Script' : 'No script', d.script ? 'ok' : 'warn'));
    if (d.words) {
        const est = /^estimated/.test(d.words.engine);
        chips.append(colChip(d.words.count + ' words · ' + (d.words.engine || 'timed'), est ? 'warn' : 'ok',
            est ? 'Word timings are estimated from the subtitles, so the captions may drift. Use transcription times them from the speech.' : 'Word timings for the captions'));
        if (est) chips.append(createEl('button', { type: 'button', id: 'colWords', class: 'ghost col-chip-btn', text: 'Use transcription', onclick: colWords,
            title: 'Time the words from the speech (a first transcription can take a few minutes)' }));
    } else chips.append(colChip('No word timings', 'warn'));
    const broll = d.segments.filter(s => s.role === 'broll').length, titles = d.segments.filter(s => s.role === 'title').length;
    chips.append(colChip(d.beats.length + ' beats · ' + broll + ' B-roll clip' + (broll === 1 ? '' : 's') + (titles ? ' · ' + titles + ' title' + (titles === 1 ? '' : 's') : '')));
    chips.append(d.missingPictures ? colChip(d.missingPictures + ' picture' + (d.missingPictures === 1 ? '' : 's') + ' missing', 'warn') : colChip('Pictures picked', 'ok'));
    box.append(chips);
    for (const n of d.notes || []) box.append(createEl('div', { class: 'col-note', text: n }));
}

// Sources & API keys: Wikimedia Commons always; Pexels / Pixabay when their key is saved. The panel never gets a saved
// key back, only whether it is set and its last 4 characters.
function colRenderSources() {
    const box = $('colSources');
    if (!box || box.contains(document.activeElement)) return;      // not while a key is being typed
    const src = (colUI.data && colUI.data.sources) || colUI.sources || {};
    box.textContent = '';
    box.append(createEl('div', { class: 'col-src' }, [
        createEl('div', { class: 'col-src-name' }, [createEl('b', { text: 'Wikimedia Commons' }), createEl('span', { class: 'col-brief', text: 'Always searched: open licences only, credited in credits.csv' })]),
        colChip('On', 'ok')
    ]));
    for (const site of COL_SITES) {
        const st = src[site.id] || { set: false };
        const input = createEl('input', { type: 'password', autocomplete: 'off', spellcheck: 'false', 'aria-label': site.name + ' API key',
            placeholder: st.set ? 'Saved (' + st.hint + '): paste a new key to replace it' : 'Paste your ' + site.name + ' API key (optional)' });
        const save = async (v) => {
            try { colUI.sources = await colCall(window.sa.collageSources, { set: { [site.id]: v } }); } catch (e) { colSay(String(e.message || e), 'bad'); return; }
            if (colUI.data) colUI.data.sources = colUI.sources;
            input.value = '';
            input.blur();
            colRenderSources();
            colSay(v ? site.name + ' key saved: the next search includes ' + site.name + '.' : site.name + ' key removed.', 'ok');
        };
        input.addEventListener('change', () => { if (input.value.trim()) save(input.value.trim()); });
        input.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); if (input.value.trim()) save(input.value.trim()); } });
        const actions = [colChip(st.set ? 'On' : 'Off', st.set ? 'ok' : '')];
        if (st.set) actions.push(createEl('button', { type: 'button', class: 'ghost col-chip-btn', text: 'Remove', title: 'Forget the ' + site.name + ' key', onclick: () => save('') }));
        else actions.push(createEl('button', { type: 'button', class: 'ghost col-chip-btn', text: 'Get a free key', title: 'Open ' + site.keyPage, onclick: () => window.sa.collageOpen({ url: site.keyPage }) }));
        box.append(createEl('div', { class: 'col-src' }, [
            createEl('div', { class: 'col-src-name' }, [createEl('b', { text: site.name }), createEl('span', { class: 'col-brief', text: site.note })]),
            input,
            createEl('div', { class: 'col-src-act' }, actions)
        ]));
    }
}

// Reset: back to the empty project (the old files go to _old/ in the project folder; placed clips stay).
function colReset() {
    openConfirmPop($('colReset'), {
        title: 'Reset the collage?',
        message: 'Every beat, picture and the context are cleared, back to the empty start. The old files move to _old in the project folder; clips already on the timeline stay.',
        confirmText: 'Reset',
        onConfirm: async () => {
            const r = await colRun('Resetting…', () => colCall(window.sa.collageReset));
            if (!r) return;
            colUI.cands.clear();
            colUI.open.clear();
            $('colContext').value = '';
            colSay('Reset: empty again. Press Auto-fill to start over.', 'ok');
        }
    });
}

// Auto-fill: the whole beat set-up in one run (src/main/collage.js collageAuto); the beats it set up open so they can be
// checked before rendering.
async function colAuto() {
    const context = $('colContext').value.trim();
    const r = await colRun('Auto-filling the beats…', () => colCall(window.sa.collageAuto, { context }));
    if (!r || !r.auto) return;
    colUI.cands.clear();
    colUI.open.clear();
    const a = r.auto, n = Object.keys(a.picked).length;
    colSay(n ? n + ' beat' + (n === 1 ? '' : 's') + ' got pictures' + (a.empty.length ? ', ' + a.empty.length + ' left on the speaker (nothing found: ' + a.empty.join(', ') + ')' : '') +
        (a.redone ? ' (redone for “' + (a.context || 'no context') + '”)' : '') +
        '. Swap any picture by opening its beat, then Render and place.' + (a.notes.length ? ' ' + a.notes.join('; ') : '')
        : 'Nothing to fill: every beat is set up already, or no line had anything to search for.', n ? 'ok' : '');
}

async function colWords() {
    const r = await colRun('Timing the words from the speech…', () => colCall(window.sa.collageWords));
    if (r && r.words) colSay(r.words.count + ' words timed (' + r.words.engine + ').', 'ok');
}

// ------------------------------------------------------------------ 2 beats

function colRenderBeats() {
    const d = colUI.data, box = $('colBeats');
    box.textContent = '';
    const has = !!(d && d.hasPlan);
    $('colFindAll').classList.toggle('hidden', !has || !d.missingPictures);
    $('colAuto').classList.toggle('hidden', !has);
    $('colBeatsSub').textContent = has ? 'click a beat to set it up; the time moves Resolve\'s playhead there' : '';
    if (!has) {
        box.append(createEl('div', { class: 'empty col-empty', text: d ? 'No beats yet: press Auto-fill above.' : '' }));
        return;
    }
    for (const b of d.beats) box.append(colBeatRow(b));
}

function colReplaceBeat(b) {
    if (!b) return;
    const old = document.querySelector('#colBeats .col-beat[data-id="' + CSS.escape(b.id) + '"]');
    if (old) old.replaceWith(colBeatRow(b));
}

// Apply a beat change; the answer is the whole pane state with the beat.
async function colPatch(id, patch) {
    const r = await colRun('', () => colCall(window.sa.collageBeat, { id, patch }), true);
    if (!r) return;
    colReplaceBeat(r.beat);
    colSay('', '');
}

function colBeatRow(b) {
    const open = colUI.open.has(b.id);
    const picture = COL_PICTURE_VISUALS.includes(b.visual);
    const row = createEl('div', { class: 'col-beat kind-' + b.visual + (open ? ' open' : ''), 'data-id': b.id });

    const sel = createEl('select', { class: 'col-visual', 'aria-label': 'What beat ' + b.id + ' shows', onclick: (e) => e.stopPropagation(),
        onchange: () => colPatch(b.id, { visual: sel.value }) });
    for (const v of (colUI.data.visuals || Object.keys(COL_VISUALS))) sel.append(createEl('option', { value: v, text: COL_VISUALS[v] || v }));
    sel.value = b.visual;

    const thumbs = createEl('span', { class: 'col-thumbs' });
    for (const a of b.assets.slice(0, 3)) thumbs.append(createEl('img', { src: a.url || undefined, alt: a.name, title: a.name }));
    if (b.need.missing) thumbs.append(colChip('needs ' + b.need.missing + ' picture' + (b.need.missing === 1 ? '' : 's'), 'warn'));
    else if (b.visual === 'medallion' && !b.assets.length) thumbs.append(colChip(b.illustration ? 'drawn: ' + b.illustration : 'drawn', '', 'A medallion without a picture draws its illustration'));

    const head = createEl('div', { class: 'col-beat-head', onclick: () => colToggle(b.id) }, [
        createEl('button', { type: 'button', class: 'col-time', text: colTime(b.frames[0]), title: 'Move Resolve\'s playhead to ' + b.id + ' (' + colTime(b.frames[0]) + ' – ' + colTime(b.frames[1]) + ')',
            onclick: (e) => { e.stopPropagation(); window.sa.seek(colUI.data.tlStart + b.frames[0]); } }),
        createEl('span', { class: 'col-id', text: b.id }),
        createEl('span', { class: 'col-line', text: b.line, title: b.line }),
        thumbs,
        sel,
        createEl('span', { class: 'col-chev', text: '▸', 'aria-hidden': 'true' })
    ]);
    row.append(head);
    if (!open) return row;

    const body = createEl('div', { class: 'col-beat-body' });
    if (b.brief.length) body.append(createEl('div', { class: 'col-brief', text: 'Brief: ' + b.brief.join(' · ') }));
    if (b.note) body.append(createEl('div', { class: 'col-brief', text: b.note }));
    if (b.evidence) body.append(colEvidenceBlock(b));
    if (picture) body.append(colPicturesBlock(b));
    body.append(colOwnPictureBlock(b));
    colDropTarget(body, b.id);
    body.append(colOverlaysBlock(b));
    row.append(body);
    return row;
}

function colToggle(id) {
    if (colUI.open.has(id)) colUI.open.delete(id); else { colUI.open.add(id); colUI.lastOpen = id; }
    const b = colUI.data && colUI.data.beats.find(x => x.id === id);
    colReplaceBeat(b);
    if (colUI.open.has(id) && b && b.candidates && !colUI.cands.has(id)) colLoadCands(id);
}

// ------------------------------------------------------------------ your own picture, evidence (document beats)

// Choose a file, drop one (or a picture dragged from a browser), paste one (⌘V while the beat is open), or look on
// Google Images. The picture makes the beat a Document: the said words highlighted and zoomed; blurs off.
function colOwnPictureBlock(b) {
    const file = createEl('input', { type: 'file', accept: 'image/png,image/jpeg,image/webp', class: 'hidden' });
    file.addEventListener('change', () => { if (file.files[0]) colAddFile(b.id, file.files[0]); file.value = ''; });
    const ctx = (colUI.data && colUI.data.context) || '';
    const q = [(b.queries && b.queries[0]) || b.line, ctx].filter(Boolean).join(' ');
    // the paste box, like a chat input: click it, ⌘V; a picture dropped on it works too
    const paste = createEl('div', { class: 'col-paste', tabindex: '0', role: 'button', 'aria-label': 'Paste a picture for ' + b.id,
        title: 'Click, then ⌘V to paste a copied picture (or drop one here)' }, [
        createEl('span', { class: 'col-paste-icon', text: '⌘V', 'aria-hidden': 'true' }),
        createEl('span', { class: 'col-paste-text', text: 'Paste a picture here: copy it (right-click › Copy Image, or a screenshot with ⌃⇧⌘4), click here, press ⌘V' })
    ]);
    paste.addEventListener('click', (e) => { e.stopPropagation(); paste.focus(); });
    paste.addEventListener('paste', (e) => {
        e.preventDefault(); e.stopPropagation();
        const item = [...(e.clipboardData && e.clipboardData.items || [])].find(x => /^image\//.test(x.type));
        if (item) { colAddFile(b.id, item.getAsFile()); return; }
        const text = (e.clipboardData && e.clipboardData.getData('text/plain') || '').trim();
        if (/^https:\/\/\S+$/.test(text)) colAddPicture(b.id, { url: text });
        else colSay('Nothing to paste: copy a picture first (right-click it › Copy Image).', 'bad');
    });
    return createEl('div', { class: 'col-block col-own' }, [
        createEl('div', { class: 'col-label', text: 'Your picture' }),
        paste,
        createEl('div', { class: 'col-own-row' }, [
            createEl('button', { type: 'button', class: 'ghost', text: 'Choose file…', title: 'Use a picture from your computer on this beat', onclick: () => file.click() }),
            createEl('button', { type: 'button', class: 'ghost', text: 'Google Images ↗', title: 'Look for “' + q + '” on Google Images, copy a picture there, then paste it in the box above',
                onclick: () => window.sa.collageOpen({ url: 'https://www.google.com/search?tbm=isch&q=' + encodeURIComponent(q) }) }),
            file
        ])
    ]);
}

function colAddFile(beat, f) {
    if (!/^image\/(png|jpeg|webp)$/.test(f.type)) { colSay('Only PNG, JPEG or WebP pictures.', 'bad'); return; }
    const rd = new FileReader();
    rd.onload = () => colAddPicture(beat, { dataUrl: rd.result, name: f.name });
    rd.readAsDataURL(f);
}

async function colAddPicture(beat, o) {
    colUI.open.add(beat);
    const r = await colRun('Adding the picture to ' + beat + '…', () => colCall(window.sa.collageAddPicture, { beat, ...o }), true);
    if (r && r.beat) colReplaceBeat(r.beat);
}

// A beat's body takes dropped files and pictures dragged from a browser (their address).
function colDropTarget(el, beat) {
    el.addEventListener('dragover', (e) => { e.preventDefault(); el.classList.add('col-drop'); });
    el.addEventListener('dragleave', () => el.classList.remove('col-drop'));
    el.addEventListener('drop', (e) => {
        e.preventDefault();
        el.classList.remove('col-drop');
        const f = [...(e.dataTransfer.files || [])].find(x => /^image\//.test(x.type));
        if (f) { colAddFile(beat, f); return; }
        const html = e.dataTransfer.getData('text/html') || '';
        const src = (/<img[^>]+src="(https:[^"]+)"/i.exec(html) || [])[1] || (e.dataTransfer.getData('text/uri-list') || '').split('\n').find(u => /^https:/.test(u));
        if (src) colAddPicture(beat, { url: src.replace(/&amp;/g, '&') });
        else colSay('Drop a picture file, or a picture from a web page.', 'bad');
    });
}

// ⌘V while a beat is open: a copied picture goes onto the last beat opened.
function colPaste(e) {
    if (!colUI.lastOpen || !$('brCollage').offsetParent || /^(INPUT|TEXTAREA)$/.test((document.activeElement || {}).tagName || '')) return;
    const item = [...(e.clipboardData && e.clipboardData.items || [])].find(x => /^image\//.test(x.type));
    if (!item) return;
    e.preventDefault();
    colAddFile(colUI.lastOpen, item.getAsFile());
}

async function colEvidence(beat, patch) {
    const r = await colRun(patch.rescan ? 'Reading the picture again…' : '', () => colCall(window.sa.collageEvidence, { beat, ...patch }), true);
    if (r && r.beat) colReplaceBeat(r.beat);
    return r;
}

// Document beat: what gets highlighted and zoomed, the Blur switch (off unless turned on), box editing in the viewer.
function colEvidenceBlock(b) {
    const ev = b.evidence;
    const wrap = createEl('div', { class: 'col-block' });
    if (!b.assets.length) return wrap;
    const chips = createEl('div', { class: 'col-chips' });
    if (ev.error) chips.append(colChip('Scan failed: ' + ev.error, 'warn'));
    else if (!ev.scanned) chips.append(colChip('Not scanned yet', 'warn'));
    chips.append(ev.highlights.length ? colChip('Highlight: ' + (ev.said.length ? ev.said.join(' · ') : ev.highlights.length + ' box' + (ev.highlights.length === 1 ? '' : 'es')), 'ok')
        : colChip('No highlight: draw one in the viewer', ''));
    chips.append(colChip(ev.zoom ? 'Zooms in on it' : 'No zoom', ev.zoom ? 'ok' : ''));
    const sw = createEl('input', { type: 'checkbox', class: 'switch' });
    sw.checked = ev.blurOn;
    sw.addEventListener('change', () => colEvidence(b.id, { blur: sw.checked }));
    const n = ev.blurAuto.length;
    const blurRow = createEl('label', { class: 'inset-row', title: 'Blur the names, places, hashtags and faces found on this picture. Off by default; boxes you draw in the viewer are always blurred.' }, [
        createEl('span', { class: 'ir-text' }, [createEl('span', { text: 'Blur names & faces' }),
            createEl('span', { class: 'ir-sub', text: n ? n + ' found' + (ev.blurred.length ? ': ' + ev.blurred.slice(0, 4).join(', ') + (ev.blurred.length > 4 ? '…' : '') : '') : 'nothing found to blur' })]),
        sw
    ]);
    const strength = sliderRow({ label: 'Blur strength', min: 1, max: 100, value: ev.blurStrength, format: (v) => String(v),
        tip: 'How strong the blur is on this picture (50 = names unreadable, shapes kept; double-click for 50). The viewer shows it live.',
        onInput: (v) => colViewerStrength(b.id, v), onChange: (v) => colEvidence(b.id, { blurStrength: v }),
        onReset: () => { colEvidence(b.id, { blurStrength: 50 }); return 50; } });
    const used = b.assets[0];
    wrap.append(createEl('div', { class: 'col-label', text: 'Highlight, zoom & blur' }), chips,
        createEl('div', { class: 'inset-group col-ev-group' }, [blurRow, strength.el]),
        createEl('div', { class: 'col-own-row' }, [
            createEl('button', { type: 'button', class: 'ghost', text: 'Edit boxes…', title: 'Open the picture full size: drag to draw a blur box (a logo, one face), Shift-drag for a highlight, click a box to remove it',
                onclick: () => colView(b.id, 'used', used && used.name) }),
            createEl('button', { type: 'button', class: 'ghost', text: 'Scan again', title: 'Read the words and faces again (after the line changed)', onclick: () => colEvidence(b.id, { rescan: true }) }),
            ev.blurBoxes.length ? createEl('span', { class: 'col-brief', text: ev.blurBoxes.length + ' drawn blur box' + (ev.blurBoxes.length === 1 ? '' : 'es') }) : null
        ].filter(Boolean)));
    return wrap;
}

// Search words, the pictures in use and the candidates found on Commons.
function colPicturesBlock(b) {
    const wrap = createEl('div', { class: 'col-block' });
    const isClip = b.visual === 'clip';
    const q = createEl('textarea', { class: 'col-queries', rows: '2', spellcheck: 'false',
        placeholder: b.brief[0] ? 'e.g. ' + b.brief[0] : isClip ? 'What the clip should show, one search per line' : 'What to search for, one per line (Category:Name lists a Commons category)',
        title: 'One search per line. Wikimedia Commons (open licences only) and the stock sites with a saved key are searched. ' +
            (isClip ? 'Clips: at least 720 px and 3 s.' : 'Pictures: at least 1000 px. Category:Name lists that Commons category.') });
    q.value = b.queries.join('\n');
    q.addEventListener('change', () => colPatch(b.id, { queries: q.value.split('\n') }));
    const find = createEl('button', { type: 'button', class: 'ghost', text: b.candidates ? 'Search again' : isClip ? 'Find clips' : 'Find pictures',
        title: 'Search with these words (up to 8 results)', onclick: () => colFind([b.id], q.value) });
    wrap.append(createEl('div', { class: 'col-label', text: 'Search words' }), createEl('div', { class: 'col-search' }, [q, find]));

    if (b.assets.length) {
        const used = createEl('div', { class: 'col-pics used' });
        for (const a of b.assets) {
            used.append(createEl('div', { class: 'col-pic on', title: a.name + '\nDouble-click to see it full size', ondblclick: () => colView(b.id, 'used', a.name) }, [
                createEl('img', { src: a.url || undefined, alt: a.name }),
                a.video ? createEl('span', { class: 'col-pic-lic', text: '▶ ' + Math.round(a.duration) + ' s' }) : null,
                createEl('button', { type: 'button', class: 'col-pic-x', text: '×', title: 'Take ' + a.name + ' off this beat', 'aria-label': 'Remove ' + a.name,
                    onclick: () => colPick(b.id, { asset: a.name, on: false }) })
            ].filter(Boolean)));
        }
        wrap.append(createEl('div', { class: 'col-label', text: b.visual === 'stack' ? 'In use (the first is on top)' : 'In use' }), used);
        const clip = b.assets.find(a => a.video);
        if (clip) {
            const start = createEl('input', { type: 'number', min: '0', max: String(clip.max || 0), step: '0.5', value: String(b.clipStart || 0), 'aria-label': 'Clip start, seconds' });
            start.addEventListener('change', () => colPatch(b.id, { clipStart: Number(start.value) || 0 }));
            wrap.append(createEl('label', { class: 'col-clip-start', title: 'Where in the clip the beat starts playing (the beat is ' + ((b.frames[1] - b.frames[0]) / (colUI.data.fps || 30)).toFixed(1) + ' s; the clip ' + Math.round(clip.duration) + ' s)' }, [
                createEl('span', { text: 'Start the clip at' }), start, createEl('span', { class: 'col-brief', text: 's (up to ' + (clip.max || 0) + ')' })
            ]));
        }
    }
    const cands = colUI.cands.get(b.id);
    if (cands && cands.candidates.length) {
        const grid = createEl('div', { class: 'col-pics' });
        for (const c of cands.candidates) {
            const tip = c.title + (c.creator ? ' · ' + c.creator : '') + ' · ' + c.source + (c.license ? ' · ' + c.license : '') + (c.width ? ' · ' + c.width + '×' + c.height : '') +
                (c.video ? ' · ' + Math.round(c.duration) + ' s' : '') + (c.picked ? '\nIn use: click to take it off' : c.video ? '\nClick to use it (downloads the clip)' : '\nClick to use it');
            grid.append(createEl('div', { class: 'col-pic-wrap' }, [
                createEl('button', { type: 'button', class: 'col-pic' + (c.picked ? ' on' : ''), title: tip + '\nDouble-click to see it full size', 'aria-pressed': c.picked ? 'true' : 'false',
                    onclick: colClickOrView(() => colPick(b.id, { file: c.file, on: !c.picked, video: c.video }), () => colView(b.id, 'cands', c.file)) }, [
                    createEl('img', { src: c.url || undefined, alt: c.title, loading: 'lazy' }),
                    createEl('span', { class: 'col-pic-lic', text: (c.video ? '▶ ' + Math.round(c.duration) + ' s · ' : '') + (c.source === 'Wikimedia Commons' ? (c.license || '?') : c.source) })
                ]),
                c.page ? createEl('button', { type: 'button', class: 'col-pic-open', text: '↗', title: 'Open its page on ' + c.source + (c.video ? ' (watch it there)' : ''), 'aria-label': 'Open source page',
                    onclick: () => window.sa.collageOpen({ url: c.page }) }) : null
            ].filter(Boolean)));
        }
        const sources = [...new Set(cands.candidates.map(c => c.source))].join(', ');
        wrap.append(createEl('div', { class: 'col-label', text: (isClip ? 'Clips found' : 'Found') + ' on ' + sources + ' (' + cands.candidates.length + ')' }), grid);
    } else if (b.candidates && !cands) {
        wrap.append(createEl('div', { class: 'col-brief', text: 'Loading the pictures found…' }));
    }
    return wrap;
}

// A click that waits a moment to see whether it is a double-click: single() picks, view() opens the viewer. A click
// from the keyboard (detail 0) picks at once.
function colClickOrView(single, view) {
    let timer = null;
    return (e) => {
        e.stopPropagation();
        clearTimeout(timer);
        if (e.detail >= 2) { timer = null; view(); return; }
        if (e.detail === 0) { single(); return; }
        timer = setTimeout(() => { timer = null; single(); }, 260);
    };
}

// ------------------------------------------------------------------ full-size viewer

const colViewer = { el: null, beat: null, kind: null, items: [], i: 0 };

// The beat's pictures in the viewer: 'cands' (found: Use / Remove) or 'used' (in use: Remove), starting at `key`
// (a candidate file or an asset name).
function colViewItems(beatId, kind) {
    const b = colUI.data && colUI.data.beats.find(x => x.id === beatId);
    if (!b) return [];
    if (kind === 'used') return b.assets.map(a => ({ key: a.name, src: a.url, title: a.name, sub: a.video ? 'Video clip · ' + Math.round(a.duration) + ' s' : 'In use on ' + b.id, picked: true }));
    const c = colUI.cands.get(beatId);
    return ((c && c.candidates) || []).map(x => ({
        key: x.file, src: x.url, title: x.title, page: x.page, video: x.video, picked: x.picked,
        sub: [x.creator, x.license, x.source, x.width ? x.width + '×' + x.height : '', x.video ? Math.round(x.duration) + ' s video' : ''].filter(Boolean).join(' · ')
    }));
}

function colView(beatId, kind, key) {
    const items = colViewItems(beatId, kind);
    if (!items.length) return;
    Object.assign(colViewer, { beat: beatId, kind, items, i: Math.max(0, items.findIndex(x => x.key === key)) });
    if (!colViewer.el) colViewer.el = colViewerBuild();
    colViewer.el.classList.remove('hidden');
    colViewerShow();
    colViewer.el.focus();
}

function colViewerClose() { if (colViewer.el) colViewer.el.classList.add('hidden'); }

function colViewerStep(d) {
    const n = colViewer.items.length;
    if (n < 2) return;
    colViewer.i = (colViewer.i + d + n) % n;
    colViewerShow();
}

async function colViewerToggle() {
    const it = colViewer.items[colViewer.i];
    if (!it || colUI.busy) return;
    if (colViewer.kind === 'used') await colPick(colViewer.beat, { asset: it.key, on: false });
    else await colPick(colViewer.beat, { file: it.key, on: !it.picked, video: it.video });
    colViewer.items = colViewItems(colViewer.beat, colViewer.kind);
    if (!colViewer.items.length) { colViewerClose(); return; }
    colViewer.i = Math.min(colViewer.i, colViewer.items.length - 1);
    colViewerShow();
}

function colViewerBuild() {
    const btn = (cls, text, title, onclick) => createEl('button', { type: 'button', class: cls, text, title, 'aria-label': title, onclick: (e) => { e.stopPropagation(); onclick(); } });
    const el = createEl('div', { class: 'col-viewer hidden', tabindex: '-1', role: 'dialog', 'aria-modal': 'true', 'aria-label': 'Picture viewer',
        onclick: (e) => { if (e.target === el || e.target.classList.contains('col-viewer-stage')) colViewerClose(); } }, [
        createEl('div', { class: 'col-viewer-stage' }, [createEl('div', { class: 'col-viewer-frame' }, [createEl('img', { class: 'col-viewer-img', alt: '', draggable: 'false' }), createEl('div', { class: 'col-viewer-boxes' })])]),
        btn('col-viewer-nav prev', '‹', 'Previous (←)', () => colViewerStep(-1)),
        btn('col-viewer-nav next', '›', 'Next (→)', () => colViewerStep(1)),
        btn('col-viewer-x', '×', 'Close (Esc)', colViewerClose),
        createEl('div', { class: 'col-viewer-bar' }, [
            createEl('div', { class: 'col-viewer-text' }, [createEl('b', { class: 'col-viewer-title' }), createEl('span', { class: 'col-viewer-sub' })]),
            createEl('span', { class: 'col-viewer-count' }),
            createEl('span', { class: 'col-viewer-hint' }),
            btn('ghost col-viewer-blur', 'Blur: off', 'Blur the names, places, hashtags and faces found on this picture', () => colViewerBlur()),
            createEl('label', { class: 'col-viewer-strength', title: 'Blur strength (50 = names unreadable, shapes kept)' }, [
                createEl('span', { text: 'Strength' }),
                createEl('input', { type: 'range', min: '1', max: '100', class: 'col-viewer-range',
                    oninput: (e) => colViewerStrength(colViewer.beat, Number(e.target.value)),
                    onchange: (e) => colViewerSave({ blurStrength: Number(e.target.value) }) })
            ]),
            btn('ghost col-viewer-page', 'Source ↗', 'Open its page', () => { const it = colViewer.items[colViewer.i]; if (it && it.page) window.sa.collageOpen({ url: it.page }); }),
            btn('primary col-viewer-use', 'Use', 'Use it on this beat (Space)', colViewerToggle)
        ])
    ]);
    el.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') { e.preventDefault(); colViewerClose(); } else if (e.key === 'ArrowLeft') { e.preventDefault(); colViewerStep(-1); } else if (e.key === 'ArrowRight') { e.preventDefault(); colViewerStep(1); } else if (e.key === ' ') { e.preventDefault(); colViewerToggle(); }
    });
    colViewerDraw(el.querySelector('.col-viewer-frame'));
    document.body.append(el);
    return el;
}

// The beat whose boxes the viewer edits: a document beat's picture in use.
function colViewerEv() {
    if (colViewer.kind !== 'used' || colViewer.i !== 0) return null;
    const b = colUI.data && colUI.data.beats.find(x => x.id === colViewer.beat);
    return b && b.evidence ? b : null;
}

async function colViewerSave(patch) {
    const b = colViewerEv();
    if (!b) return;
    await colEvidence(b.id, patch);
    colViewer.items = colViewItems(colViewer.beat, colViewer.kind);
    colViewerShow();
}
function colViewerBlur() { const b = colViewerEv(); if (b) colViewerSave({ blur: !b.evidence.blurOn }); }

// Drag on the picture: a blur box (Shift: a highlight). Click a drawn box or a highlight to take it off.
function colViewerDraw(frame) {
    let start = null, ghost = null;
    const at = (e) => { const r = frame.getBoundingClientRect(); return [Math.min(1, Math.max(0, (e.clientX - r.left) / r.width)), Math.min(1, Math.max(0, (e.clientY - r.top) / r.height))]; };
    frame.addEventListener('pointerdown', (e) => {
        if (!colViewerEv() || e.button !== 0 || e.target.closest('.col-vbox')) return;
        e.preventDefault();
        start = { p: at(e), hl: e.shiftKey };
        ghost = createEl('div', { class: 'col-vbox ' + (start.hl ? 'hl' : 'blur') + ' drawing' });
        frame.querySelector('.col-viewer-boxes').append(ghost);
        frame.setPointerCapture(e.pointerId);
    });
    frame.addEventListener('pointermove', (e) => {
        if (!start) return;
        const [x, y] = at(e), [x0, y0] = start.p;
        Object.assign(ghost.style, { left: Math.min(x, x0) * 100 + '%', top: Math.min(y, y0) * 100 + '%', width: Math.abs(x - x0) * 100 + '%', height: Math.abs(y - y0) * 100 + '%' });
    });
    frame.addEventListener('pointerup', (e) => {
        if (!start) return;
        const [x, y] = at(e), [x0, y0] = start.p, hl = start.hl;
        start = null; ghost.remove(); ghost = null;
        const r = [Math.min(x, x0), Math.min(y, y0), Math.abs(x - x0), Math.abs(y - y0)];
        const b = colViewerEv();
        if (!b || r[2] < 0.01 || r[3] < 0.01) return;
        if (hl) colViewerSave({ highlights: [...b.evidence.highlights, r] }); else colViewerSave({ blurBoxes: [...b.evidence.blurBoxes, r] });
    });
}

// The blur the viewer shows: the render's blur (1/34 of an 860-wide card at strength 50) at the size on screen.
function colViewerBlurPx(strength) {
    const img = colViewer.el && colViewer.el.querySelector('.col-viewer-img');
    const w = (img && img.clientWidth) || 860;
    return Math.max(1, (w / 34) * (strength / 50));
}
function colViewerStrength(beat, v) {
    if (!colViewer.el || colViewer.el.classList.contains('hidden') || colViewer.beat !== beat) return;
    colViewer.el.querySelectorAll('.col-vbox.blur').forEach(x => { x.style.backdropFilter = 'blur(' + colViewerBlurPx(v) + 'px)'; });
}

// The boxes over the picture: highlights (yellow), drawn blurs (red, click to remove), found blurs (dashed, shown
// when Blur is on), the zoom (outline).
function colViewerBoxes() {
    const el = colViewer.el, layer = el.querySelector('.col-viewer-boxes');
    layer.textContent = '';
    const b = colViewerEv();
    el.classList.toggle('editing', !!b);
    el.querySelector('.col-viewer-blur').classList.toggle('hidden', !b);
    el.querySelector('.col-viewer-strength').classList.toggle('hidden', !b);
    if (b) el.querySelector('.col-viewer-range').value = String(b.evidence.blurStrength);
    el.querySelector('.col-viewer-hint').textContent = b ? 'Drag: blur box · Shift-drag: highlight · click a box to remove it' : '';
    if (!b) return;
    const ev = b.evidence;
    el.querySelector('.col-viewer-blur').textContent = 'Blur names & faces: ' + (ev.blurOn ? 'on' : 'off');
    const box = (r, cls, title, onclick) => layer.append(createEl('div', { class: 'col-vbox ' + cls, title,
        style: { left: r[0] * 100 + '%', top: r[1] * 100 + '%', width: r[2] * 100 + '%', height: r[3] * 100 + '%' },
        onpointerdown: (e) => e.stopPropagation(), onclick: onclick ? (e) => { e.stopPropagation(); onclick(); } : undefined }));
    if (ev.zoom) box(ev.zoom, 'zoom', 'Where the camera zooms in');
    if (ev.blurOn) ev.blurAuto.forEach(r => box(r, 'blur found', 'Found: blurred while “Blur names & faces” is on'));
    ev.blurBoxes.forEach((r, i) => box(r, 'blur', 'Blur box: click to remove', () => colViewerSave({ blurBoxes: ev.blurBoxes.filter((_, k) => k !== i) })));
    colViewerStrength(b.id, ev.blurStrength);
    ev.highlights.forEach((r, i) => box(r, 'hl', 'Highlight: click to remove', () => colViewerSave({ highlights: ev.highlights.filter((_, k) => k !== i) })));
}

function colViewerShow() {
    const el = colViewer.el, it = colViewer.items[colViewer.i];
    if (!el || !it) return;
    const img = el.querySelector('.col-viewer-img');
    if (it.src) img.src = it.src; else img.removeAttribute('src');
    img.alt = it.title;
    el.querySelector('.col-viewer-title').textContent = colViewer.beat + ' · ' + it.title;
    el.querySelector('.col-viewer-sub').textContent = it.sub || '';
    el.querySelector('.col-viewer-count').textContent = (colViewer.i + 1) + ' / ' + colViewer.items.length;
    el.querySelectorAll('.col-viewer-nav').forEach(n => n.classList.toggle('hidden', colViewer.items.length < 2));
    el.querySelector('.col-viewer-page').classList.toggle('hidden', !it.page);
    const use = el.querySelector('.col-viewer-use');
    use.textContent = it.picked ? 'Remove' : (it.video ? 'Use clip' : 'Use');
    use.className = (it.picked ? 'ghost' : 'primary') + ' col-viewer-use';
    colViewerBoxes();
}

async function colLoadCands(id) {
    try {
        const r = await colCall(window.sa.collageCandidates, { beat: id });
        colUI.cands.set(id, r);
    } catch (e) { colUI.cands.set(id, { candidates: [] }); colSay(String(e.message || e), 'bad'); }
    colReplaceBeat(colUI.data && colUI.data.beats.find(x => x.id === id));
}

async function colFind(ids, queriesText) {
    // the search words typed but not saved yet (the textarea saves on change) go with it
    if (ids && ids.length === 1 && queriesText !== undefined) {
        const b = colUI.data.beats.find(x => x.id === ids[0]);
        const typed = queriesText.split('\n').map(s => s.trim()).filter(Boolean);
        if (b && typed.join('\n') !== b.queries.join('\n')) {
            try { colUI.data = await colCall(window.sa.collageBeat, { id: b.id, patch: { queries: typed } }); } catch (e) { colSay(String(e.message || e), 'bad'); return; }
        }
    }
    const r = await colRun(ids ? 'Searching Wikimedia Commons…' : 'Searching Wikimedia Commons for every beat missing pictures…', () => colCall(window.sa.collageFind, ids ? { beats: ids } : {}));
    if (!r) return;
    for (const f of r.found || []) { colUI.cands.delete(f.beat); colUI.open.add(f.beat); }
    for (const f of r.found || []) await colLoadCands(f.beat);
}

async function colPick(id, o) {
    const r = await colRun(o.video && o.on ? 'Getting the clip (download and convert)…' : '', () => colCall(window.sa.collagePick, { beat: id, file: o.file, asset: o.asset, on: o.on }), true);
    if (!r) return;
    const cands = colUI.cands.get(id);
    if (cands && o.file) { const c = cands.candidates.find(x => x.file === o.file); if (c) c.picked = !!o.on; }
    if (cands && o.asset) await colLoadCands(id);
    colReplaceBeat(r.beat);
    if (o.video && cands) await colLoadCands(id);
    colSay(o.on ? (o.video ? 'Clip' : 'Picture') + ' added to ' + id + ' (credited in credits.csv).' : 'Taken off ' + id + '.', 'ok');
}

// Date / label / title overlays: edited in place, saved when a field is left.
function colOverlaysBlock(b) {
    const wrap = createEl('div', { class: 'col-block' });
    const list = b.overlays.map(o => ({ ...o }));
    const save = () => colPatch(b.id, { overlays: list });
    const rows = createEl('div', { class: 'col-overlays' });
    list.forEach((o, i) => {
        const text = createEl('input', { type: 'text', value: o.text || '', placeholder: COL_OVERLAYS[o.type] || o.type, 'aria-label': (COL_OVERLAYS[o.type] || o.type) + ' text' });
        text.addEventListener('change', () => { o.text = text.value; save(); });
        const kids = [createEl('span', { class: 'col-ov-type', text: COL_OVERLAYS[o.type] || o.type }), text];
        if (o.type === 'title') {
            const sub = createEl('input', { type: 'text', value: o.sub || '', placeholder: 'Second line', 'aria-label': 'Title second line' });
            sub.addEventListener('change', () => { o.sub = sub.value; save(); });
            kids.push(sub);
        }
        kids.push(createEl('button', { type: 'button', class: 'col-pic-x', text: '×', title: 'Remove this ' + (COL_OVERLAYS[o.type] || o.type).toLowerCase(), 'aria-label': 'Remove',
            onclick: () => { list.splice(i, 1); save(); } }));
        rows.append(createEl('div', { class: 'col-ov' }, kids));
    });
    const add = createEl('div', { class: 'col-ov-add' });
    const kinds = b.visual === 'talking-head' ? ['title'] : b.visual === 'title' ? ['title'] : ['date', 'label'];
    for (const k of kinds) {
        if (k === 'title' && list.some(o => o.type === 'title')) continue;
        add.append(createEl('button', { type: 'button', class: 'ghost', text: '+ ' + COL_OVERLAYS[k],
            title: k === 'title' ? 'A title card (name of the show, episode) over this beat' : k === 'date' ? 'A date tag on the picture (“1873”)' : 'A name label on the picture (“DIVING DRESS”)',
            onclick: () => { list.push(k === 'title' ? { type: 'title', text: '', sub: '' } : { type: k, text: '' }); save(); } }));
    }
    const label = b.visual === 'talking-head' ? 'Title over the speaker' : 'Overlays';
    if (!list.length && !add.childElementCount) return wrap;
    wrap.append(createEl('div', { class: 'col-label', text: label }), rows, add);
    return wrap;
}

// ------------------------------------------------------------------ 3 preview, render, place

function colRenderClips() {
    const d = colUI.data, box = $('colClips');
    $('colSfxSub').textContent = d && d.sfxCues ? d.sfxCues + ' sounds: whooshes, hits, pops and clicks on the cards' : 'Whooshes, hits, pops and clicks on the cards';
    box.textContent = '';
    const can = !!(d && d.hasPlan);
    $('colRender').disabled = colUI.busy || !can;
    $('colPreviewBtn').disabled = colUI.busy || !can;
    $('colPlaceOnly').disabled = colUI.busy || !(d && d.clips.length);
    $('colPlaceOnly').title = 'Place the clips already rendered (and the sound effects, when on), without rendering again';
    if (!d || !d.clips.length) { box.append(createEl('div', { class: 'col-brief', text: can ? 'Not rendered yet.' : '' })); return; }
    box.append(createEl('div', { class: 'col-label', text: 'Rendered' }));
    for (const c of d.clips) {
        const what = c.role === 'captions' ? 'Captions' : c.role === 'title' ? 'Title' : 'B-roll';
        box.append(createEl('div', { class: 'col-clip' + (c.exists ? '' : ' gone'), title: c.file + (c.exists ? '' : ' (file missing)') }, [
            createEl('b', { text: what }), ' ' + colTime(c.start) + ' – ' + colTime(c.start + c.frames), createEl('span', { class: 'col-clip-file', text: c.file })
        ]));
    }
}

async function colPreview() {
    const captions = $('colCaptions').checked;
    const box = $('colPreview');
    const [r, f] = await Promise.all([
        colRun('Drawing the frame under the playhead…', () => colCall(window.sa.collageStill, { captions })),
        window.sa.brollFrame().catch(() => null)
    ]);
    if (!r) return;
    box.style.aspectRatio = r.width + ' / ' + r.height;
    const set = (id, src) => { const img = $(id); if (src) img.src = src; else img.removeAttribute('src'); };
    set('colPrevFrame', f && f.img && !f.error ? f.img : null);
    set('colPrevTrack', r.track);
    set('colPrevCaps', r.captions);
    $('colPrevMsg').textContent = colTime(r.frame) + (r.beat ? ' · ' + r.beat : '') + (r.onBroll ? '' : ' · speaker');
    colSay('', '');
}

async function colRenderPlace(place) {
    const captions = $('colCaptions').checked, sfx = $('colSfx').checked;
    const r = await colRun(place ? 'Rendering…' : 'Placing…', () => colCall(place ? window.sa.collageRender : window.sa.collagePlace, { captions, sfx }));
    if (r && r.placed) colSay('Placed ' + r.placed.length + ' clip' + (r.placed.length === 1 ? '' : 's') + ' on ' + [...new Set(r.placed.map(x => x.track))].join(' + ') +
        (r.sfx && r.sfx.count ? ' · ' + r.sfx.count + ' sound' + (r.sfx.count === 1 ? '' : 's') + ' on ' + r.sfx.track : '') +
        (r.removed ? ' · ' + r.removed + ' old clip' + (r.removed === 1 ? '' : 's') + ' taken off' : '') + (r.notes && r.notes.length ? ' · ' + r.notes.join('; ') : ''), 'ok');
}

function initCollage() {
    $('colAutoStart').addEventListener('click', colAuto);
    $('colAuto').addEventListener('click', colAuto);
    $('colReset').addEventListener('click', colReset);
    document.addEventListener('paste', colPaste);
    $('colContext').addEventListener('change', colSaveContext);
    $('colContext').addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); $('colContext').blur(); } });
    $('colReload').addEventListener('click', () => { colUI.cands.clear(); colLoad(); });
    $('colOpen').addEventListener('click', () => window.sa.collageOpen());
    rememberDetails($('colSourcesBox'), 'sa.colSourcesOpen');
    window.sa.collageSources().then((r) => { if (r && !r.error) { colUI.sources = r; colRenderSources(); } }).catch(() => {});
    $('colFindAll').addEventListener('click', () => colFind(null));
    $('colPreviewBtn').addEventListener('click', colPreview);
    $('colRender').addEventListener('click', () => colRenderPlace(true));
    $('colPlaceOnly').addEventListener('click', () => colRenderPlace(false));
    $('colCancel').addEventListener('click', () => window.sa.collageCancel());
    $('colCaptions').checked = store.get('colCaptions') !== '0';
    $('colSfx').checked = store.get('colSfx') !== '0';
    $('colSfx').addEventListener('change', () => store.set('colSfx', $('colSfx').checked ? '1' : '0'));
    $('colCaptions').addEventListener('change', () => store.set('colCaptions', $('colCaptions').checked ? '1' : '0'));
    window.sa.onCollageProgress((d) => {
        if (!d || !colUI.busy) return;
        if (Number.isFinite(d.p)) $('colBar').style.width = Math.round(d.p * 100) + '%';
        if (d.phase === 'idle') return;
        colSay(d.text || '', d.phase === 'done' ? 'ok' : d.phase === 'error' ? 'bad' : '');
    });
    colRender();
}
