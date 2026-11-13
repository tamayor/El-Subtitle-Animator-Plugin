// B-roll tab: placing / updating on the timeline, and live re-render of the clip being edited.

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
