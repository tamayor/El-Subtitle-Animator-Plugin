// The Create tab: timeline draft preview and renderCreate.

function setCreateStatus(msg, kind) {
    const el = $('createStatus');
    el.textContent = msg || '';
    el.className = 'status' + (kind ? ' ' + kind : '');
}

// Create tab: the builder, the default sound, the saved list, and the default settings of the clicked item.
// ---- Create tab: the Text+ taken from the timeline is kept as a snapshot and previewed (looping) under the button.
const draftPrev = { token: 0, imgs: [], i: 0, timer: 0, fps: 25 };
function draftPrevStop() { draftPrev.token++; if (draftPrev.timer) { clearTimeout(draftPrev.timer); draftPrev.timer = 0; } draftPrev.imgs = []; }
function draftPrevMsg(msg) { const m = $('draftPrevMsg'); if (m) m.textContent = msg || ''; }
function draftPrevHide() { draftPrevStop(); const b = $('draftPrev'); if (b) b.classList.add('hidden'); draftPrevMsg(''); }
// The part of the frame that holds the text (all frames together), so the preview shows just the animated text and not
// the empty rest of the video frame. null = could not tell (then the whole frame is shown).
function draftPrevBounds(imgs, whites) {
    try {
        const W = imgs[0].naturalWidth, H = imgs[0].naturalHeight;
        if (!W || !H) return null;
        const sc = Math.min(1, 256 / Math.max(W, H));
        const sw = Math.max(1, Math.round(W * sc)), sh = Math.max(1, Math.round(H * sc));
        const oc = document.createElement('canvas'); oc.width = sw; oc.height = sh;
        const g = oc.getContext('2d', { willReadFrequently: true });
        let x0 = sw, y0 = sh, x1 = -1, y1 = -1;
        const scan = (im, onWhite) => {
            if (!im || !im.naturalWidth) return;
            g.clearRect(0, 0, sw, sh);
            g.fillStyle = onWhite ? '#fff' : '#000'; g.fillRect(0, 0, sw, sh);
            g.drawImage(im, 0, 0, sw, sh);
            const d = g.getImageData(0, 0, sw, sh).data;
            for (let y = 0; y < sh; y++) {
                for (let x = 0, o = y * sw * 4; x < sw; x++, o += 4) {
                    const hit = onWhite ? (d[o] < 225 || d[o + 1] < 225 || d[o + 2] < 225) : (d[o] > 28 || d[o + 1] > 28 || d[o + 2] > 28);
                    if (hit) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
                }
            }
        };
        imgs.forEach((im) => scan(im, false));
        if (whites) whites.forEach((im) => scan(im, true));
        if (x1 < 0) return null;
        const bw = (x1 - x0 + 1) / sc, bh = (y1 - y0 + 1) / sc;
        const pad = Math.max(0.12 * Math.max(bw, bh), 0.03 * Math.max(W, H));
        const cx = Math.max(0, Math.floor(x0 / sc - pad)), cy = Math.max(0, Math.floor(y0 / sc - pad));
        const cx2 = Math.min(W, Math.ceil((x1 + 1) / sc + pad)), cy2 = Math.min(H, Math.ceil((y1 + 1) / sc + pad));
        if (cx2 - cx < 8 || cy2 - cy < 8) return null;
        return { x: cx, y: cy, w: cx2 - cx, h: cy2 - cy };
    } catch (e) { return null; }       // e.g. frames that cannot be read: show the whole frame
}
function draftPrevPlay(pv) {
    const box = $('draftPrev'), cv = $('draftPrevCanvas');
    if (!box || !cv || !pv || !pv.files || !pv.files.length) return;
    draftPrevStop();
    const token = draftPrev.token;
    draftPrev.fps = Math.max(1, Math.min(60, Number(pv.fps) || 25));
    const stamp = pv.stamp || Date.now();
    const load = (f) => new Promise((res) => { const im = new Image(); im.onload = im.onerror = () => res(im); im.src = fileUrl(f) + '?v=' + stamp; });
    draftPrevMsg('Rendering preview…');
    Promise.all(pv.files.map(load).concat((pv.white || []).map(load))).then((all) => {
        if (token !== draftPrev.token) return;
        draftPrevMsg('');
        const imgs = all.slice(0, pv.files.length).filter((im) => im.naturalWidth);
        const whites = all.slice(pv.files.length).filter((im) => im.naturalWidth);
        if (!imgs.length) { draftPrevMsg('The preview frames could not be loaded'); return; }
        draftPrev.imgs = imgs; draftPrev.i = 0;
        const W = imgs[0].naturalWidth, H = imgs[0].naturalHeight;
        const crop = draftPrevBounds(imgs, whites.length === imgs.length ? whites : null) || { x: 0, y: 0, w: W, h: H };
        cv.width = Math.round(crop.w); cv.height = Math.round(crop.h);
        const g = cv.getContext('2d');
        const step = () => {
            if (token !== draftPrev.token) return;
            if (state.tab !== 'create' || document.hidden || state.idle) { draftPrev.timer = setTimeout(step, 300); return; }
            const im = draftPrev.imgs[draftPrev.i % draftPrev.imgs.length];
            g.drawImage(im, crop.x, crop.y, crop.w, crop.h, 0, 0, cv.width, cv.height);
            draftPrev.i++;
            draftPrev.timer = setTimeout(step, 1000 / draftPrev.fps);
        };
        step();
    });
}
async function takeFromTimeline() {
    const btn = $('useSelected');
    if (btn.classList.contains('busy')) return;
    btn.classList.add('busy');
    const box = $('draftPrev');
    if (box) box.classList.remove('hidden');
    draftPrevStop();
    draftPrevMsg('Reading the Text+ from Resolve…');
    setCreateStatus('');
    let res;
    try { res = await window.sa.draftFromTimeline({ maxDim: 640 }); } catch (e) { res = { error: String(e && e.message || e) }; }
    btn.classList.remove('busy');
    if (!res || res.error || !res.path) {
        // keep whatever was chosen before; only report the problem
        if (!state.draft.fromTimeline) draftPrevHide(); else draftPrevMsg('');
        setCreateStatus((res && res.error) || 'Could not read the clip', 'bad');
        renderCreate();
        if (state.draft.fromTimeline && state.draft.preview) draftPrevPlay(state.draft.preview);
        return;
    }
    const d = state.draft;
    d.animPath = res.path; d.fromSelection = false; d.fromTimeline = true; d.clipProps = res.props || null; d.preview = res.preview || null;
    renderCreate();
    if (res.preview && res.preview.files && res.preview.files.length) { draftPrevMsg(''); draftPrevPlay(res.preview); }
    else { draftPrevMsg(res.previewError ? 'Saved, but the preview could not be rendered: ' + res.previewError : 'Saved, but there is no preview'); }
}
function clearTimelineDraft() { const d = state.draft; d.fromTimeline = false; d.clipProps = null; d.preview = null; draftPrevHide(); }

function renderCreate() {
    const d = state.draft;
    const pk = $('animPicked');
    pk.classList.toggle('hidden', !(d.animPath || d.fromSelection));
    pk.textContent = d.fromTimeline ? '✓ Text+ taken from the timeline - kept until you take another' : (d.fromSelection ? '✓ Text+ selected on the timeline (read when you save)' : (d.animPath ? '✓ ' + baseName(d.animPath) : ''));
    $('animDrop').classList.toggle('chosen', !!d.animPath && !d.fromTimeline);
    $('useSelected').classList.toggle('chosen', !!d.fromTimeline || !!d.fromSelection);
    $('newSfx').classList.toggle('chosen', !!d.sfxPath);
    if ($('crNum2')) $('crNum2').classList.toggle('done', !!(d.animPath || d.fromSelection));
    if ($('crNum3')) $('crNum3').classList.toggle('done', !!d.sfxPath);
    $('saveCombo').disabled = !(d.animPath || d.fromSelection) || $('useSelected').classList.contains('busy');
    $('saveCombo').title = $('saveCombo').disabled ? 'Pick a text animation first' : '';
    $('newSfxName').textContent = d.sfxPath ? baseName(d.sfxPath) : 'Drop a sound file here';
    $('newSfxPlay').style.visibility = d.sfxPath ? 'visible' : 'hidden';
    $('newSfxClear').style.visibility = d.sfxPath ? 'visible' : 'hidden';

    if (state.createId && !libEntry(state.createId)) state.createId = null;

    const list = $('libList');
    const ed = $('editor');
    renderTagFilter('lib', 'libFilter');
    const libShown = state.lib.animations.filter(a => passesTagFilter(a, 'lib'));
    const openId = libShown.some(a => a.id === state.createId) ? state.createId : null;
    // Rebuild the rows around the settings panel without moving it when it is already in place
    // (moving it would drop focus from whatever you are typing in it).
    for (const ch of Array.from(list.children)) if (ch !== ed) ch.remove();
    if (openId) { if (ed.parentNode !== list) list.appendChild(ed); }
    else if (ed.parentNode !== $('editorPark')) $('editorPark').appendChild(ed);
    const put = (el, beforeEditor) => { if (beforeEditor && ed.parentNode === list) list.insertBefore(el, ed); else list.appendChild(el); };
    if (!state.lib.animations.length) {
        const e = document.createElement('div'); e.className = 'hint'; e.textContent = 'Nothing saved yet.'; put(e, true);
    }
    if (state.lib.animations.length && !libShown.length) {
        const e = document.createElement('div'); e.className = 'hint'; e.textContent = 'No presets have the selected tags.'; put(e, true);
    }
    let beforeEditor = !!openId;
    for (const a of libShown) {
        const row = document.createElement('div');
        row.className = 'libitem' + (a.id === state.createId ? ' sel' : '');
        row.dataset.id = a.id;
        const t = document.createElement('div'); t.className = 't';
        const b = document.createElement('b'); b.textContent = a.name;
        const s = document.createElement('span');
        s.textContent = a.sfx ? '♪ ' + a.sfx : (state.lib.defaultSfx ? '♪ default sound' : 'no sound');
        t.append(b, s);
        const grip = document.createElement('span');
        grip.className = 'lib-grip'; grip.textContent = '⋮⋮'; grip.title = 'Drag to change the order';
        grip.addEventListener('mousedown', (e) => startLibDrag(e, row, a, list));
        grip.addEventListener('click', (e) => e.stopPropagation());
        row.appendChild(grip);
        const dots = tagDotsEl(a);
        if (dots) row.appendChild(dots);
        const more = document.createElement('button'); more.className = 'ghost more'; more.textContent = '⋯'; more.title = 'Tags and more';
        more.addEventListener('click', (e) => { e.stopPropagation(); openRowMenu(more, a); });
        row.append(t, more);
        row.addEventListener('click', () => {
            stopPreview();
            state.createAdjusted = false;
            a.adjusted = false;
            a.designDirty = false;
            state.createId = state.createId === a.id ? null : a.id;
            renderCreate();
            if (state.createId) {
                // bring the opened preset to the top so its settings are right there below it
                requestAnimationFrame(() => {
                    const r = list.querySelector('.libitem.sel');
                    if (r) r.scrollIntoView({ block: 'start', behavior: 'smooth' });
                });
            }
        });
        dropZone(row, async (p) => { if (takeLib(await window.sa.setAnimationSfx(a.id, p))) setCreateStatus('Sound changed for "' + a.name + '"', 'ok'); });
        put(row, beforeEditor);
        if (a.id === openId) beforeEditor = false;
    }

    const a = openId ? libEntry(openId) : null;
    $('editor').classList.toggle('hidden', !a);
    if (a) {
        if ($('editTitle')) $('editTitle').textContent = a.name;
        if (document.activeElement !== $('animName')) $('animName').value = a.name;
        fillAdjust(CTX.C);
        if (window.SABoxes) SABoxes.render('C');
        if (!state.preview) drawStage('C', a, null);
        setCreateFilesOpen(state.createFilesOpen !== false);
        setCreateAdjustOpen(state.createAdjustOpen !== false);
        setCreateTdOpen(!!state.createTdOpen);
        setCreateConfigOpen(!!state.createConfigOpen);
        renderConfigC();
        renderCreateSummary();
        renderTags();
    }
}
