// Rendering preset previews straight from Fusion (frame capture), the one-time preview cache and
// temporary preview clips.

module.exports = {
    captureFromSelection, capturePreview, exportSelectedClip, frameList, makePreview, previewData, prunePreviews, scanClip
};

const path = require('path');
const fs = require('fs');

const state = require('./state');
const {
    ANIM_DIR, CANCEL_FLAG, PREV_CACHE_DIR, PREV_CACHE_MAX, PREV_DIR, SAMPLE_TEXTS, ensureDirs
} = require('./config');
const { bridgeCall } = require('./fusion-bridge');
const { designForFusion, detectNodes, expandToolsInFile, fusionBoxes, parseTextStyle } = require('./fusion-setting');
const { libForUI, loadLib, saveLib, uniqueName } = require('./library');
const { regAdd, regDel, sweepTempClips } = require('./live-preview');
const { dlog } = require('./log');
const { compressPngTree } = require('./png-compress');

const PREV_MAX_DIM = 720;
const {
    directPlaceTitle, fitDuration, insertTitleAtEnd, inspectorSafeComp, isTitleClipName, pickTrack,
    titleKindFor
} = require('./placement');
const { getProject, timelineMeta } = require('./resolve');
const { findSelectedFusionItem } = require('./selection');

// Grabs real 25fps or 30fps frames from a clip on the timeline so the panel can preview the animation in a 3-second loop.
// text: the exact text the frames were rendered with ('' = sample text, null = whatever the captured clip held).
let previewBgNext = null;
let lastCaptureStats = null;   // background the next captured preview was rendered on ('black' | 'white')
function clearCancel() { try { fs.rmSync(CANCEL_FLAG, { force: true }); } catch (e) { /* ignore */ } }
function frameList(dir, prefix, info) {
    const n = info.count;
    const map = Array.isArray(info.map) && info.map.length === n ? info.map : null;
    return Array.from({ length: n }, (_, i) => path.join(dir, prefix + String(map && prefix === 'w' ? map[i] : i).padStart(2, '0') + '.png'));
}

// opts: { maxDim, hold, matteBg } - maxDim is the viewer's real pixel size (no point rendering more than the screen
// shows), hold is the preset's Stop Motion frame repeat, matteBg the preview background node used for the white pass.
async function capturePreview(animId, itemId, text, designKey, tempDir, opts) {
    opts = opts || {};
    let meta = opts.meta;
    if (!meta) {
        const project = await getProject();
        const tl = project && await project.GetCurrentTimeline();
        meta = tl ? await timelineMeta(tl) : { fps: 25 };
    }
    const fps = Math.round(meta.fps || 25);
    const targetCount = Math.round(fps * 3);
    const dir = tempDir || path.join(PREV_DIR, animId);
    fs.rmSync(dir, { recursive: true, force: true });
    fs.mkdirSync(dir, { recursive: true });
    // Viewer previews are taken at the timeline's own resolution (1:1 with what Resolve renders); the small
    // background card renders stay light.
    const fullDim = Math.max(meta.width || 1920, meta.height || 1080);
    const want = Number(opts.maxDim) > 0 ? Math.round(Number(opts.maxDim)) : Math.min(fullDim, 1440);
    // Previews never need full HD: the long side is capped at PREV_MAX_DIM (smaller files, quicker renders).
    const maxDim = (tempDir && /__sub$/.test(tempDir)) ? 400 : Math.max(480, Math.min(fullDim, want, PREV_MAX_DIM));
    const t0 = Date.now();
    const res = await bridgeCall('capture', {
        item: itemId, comp: opts.comp || null, count: targetCount, step: 1, maxDim, outDir: dir,
        unique: true, hold: Number(opts.hold) || 1, matteBg: opts.matteBg || null, cancelPath: CANCEL_FLAG
    }, 240000);
    lastCaptureStats = { ms: Date.now() - t0, maxDim, unique: res && res.unique, matte: !!(res && res.matte), hold: Number(opts.hold) || 1 };
    const count = (res && typeof res.count === 'number') ? res.count : ((res && res.frames) ? res.frames.length : 0);
    if (!count) throw new Error('No frames came back');
    if (res && res.frames && res.frames.length) {
        res.frames.forEach((b64, i) => fs.writeFileSync(path.join(dir, 'p' + String(i).padStart(2, '0') + '.png'), Buffer.from(b64, 'base64')));
    }
    // Resolve writes the PNGs uncompressed; they are shrunk losslessly in the background, same file names.
    setTimeout(() => { compressPngTree(dir).then(() => compressPngTree(PREV_CACHE_DIR)); }, 1500);
    const info = { count, step: res.step || 1, fps: res.fps || fps, stamp: Date.now(), text: (typeof text === 'string') ? text : null, designKey: (typeof designKey === 'string') ? designKey : null, bg: previewBgNext || 'black' };
    if (res && Array.isArray(res.map) && res.map.length === count) info.map = res.map;
    if (res && res.matte) info.matte = true;      // p = on black, w = on white: the panel works out the real alpha
    try { const pa = loadLib().animations.find(x => x.id === animId); if (pa && titleKindFor(path.join(ANIM_DIR, pa.file)) === 'multitext') info.sample = 'mt-n'; } catch (e) { /* ignore */ }
    previewBgNext = null;
    if (tempDir) {
        return { preview: info, previewFiles: frameList(dir, 'p', info), previewWhite: info.matte ? frameList(dir, 'w', info) : null };
    }
    const lib = loadLib();
    const a = lib.animations.find(x => x.id === animId);
    if (a) { a.preview = info; saveLib(lib); }
    return true;
}

async function captureFromSelection(event, animId) {
    const item = await findSelectedFusionItem();
    if (!item) return { error: 'Select the Text+ clip on your timeline first' };
    await capturePreview(animId, String(await item.GetUniqueId()));
    return { lib: libForUI() };
}

// Exports the Fusion animation of the Text+ clip selected on the timeline into the library folder.
async function exportSelectedClip(label) {
    const project = await getProject();
    const tl = project && await project.GetCurrentTimeline();
    if (!tl) throw new Error('Open a timeline in Resolve');
    const sel = (await tl.GetSelectedClips()) || [];
    let pick = null;
    for (const c of sel) {
        if ((await c.GetFusionCompCount()) > 0 && isTitleClipName(await c.GetName())) { pick = c; break; }
    }
    if (!pick) for (const c of sel) { if ((await c.GetFusionCompCount()) > 0) { pick = c; break; } }
    if (!pick) throw new Error('Select an animated Text+ clip on the timeline first, then save');
    const file = uniqueName(ANIM_DIR, label + '.comp');
    ensureDirs();
    const compCount = Math.max(1, (await pick.GetFusionCompCount()) || 1);
    const ok = await pick.ExportFusionComp(path.join(ANIM_DIR, file), compCount);
    if (!ok || !fs.existsSync(path.join(ANIM_DIR, file))) throw new Error('Resolve could not export that clip\'s animation');
    expandToolsInFile(path.join(ANIM_DIR, file));
    let clipProps = null;
    try {
        if (typeof pick.GetProperties === 'function') {
            clipProps = await pick.GetProperties();
        }
    } catch (e) { /* ignore */ }
    return { file, itemId: String(await pick.GetUniqueId()), props: clipProps };
}

// The captured preview frames as base64, so the panel can read their pixels (to crop and key them) without any
// cross-origin limits on local files.
function previewData(event, id) {
    const lib = loadLib();
    const a = lib.animations.find(x => x.id === id);
    if (!a || !a.preview) return { frames: [] };
    const dir = path.join(PREV_DIR, id);
    const frames = [];
    for (let i = 0; i < a.preview.count; i++) {
        const f = path.join(dir, 'p' + String(i).padStart(2, '0') + '.png');
        if (fs.existsSync(f)) frames.push(fs.readFileSync(f).toString('base64'));
    }
    return { frames };
}

async function makePreview(event, animId, customText, design, designKey, temp, boxList, opts) {
    const t0 = Date.now();
    // A change you just made wins over a render that is still running: that render stops between two frames and
    // the panel asks again a moment later. Background card renders never cancel anything.
    if (state.applying && temp !== 'sub' && previewRunning && (previewRunning.temp === 'sub' || previewRunning.id === animId)) {
        try { fs.writeFileSync(CANCEL_FLAG, '1'); } catch (e) { /* ignore */ }
    }
    if (!state.applying) previewRunning = { id: animId, temp };
    const r = await makePreviewInner(event, animId, customText, design, designKey, temp, boxList, opts);
    if (r && !/busy/i.test(String(r.error || ''))) previewRunning = null;
    const ms = Date.now() - t0, cap = lastCaptureStats;
    // The log is written after the answer goes back, so it never slows the preview down.
    setTimeout(() => {
        try {
            const lib = loadLib();
            const a = lib.animations.find(x => x.id === animId);
            const compPath = a ? path.join(ANIM_DIR, a.file) : null;
            dlog('makePreview', { id: animId, name: a && a.name, temp: temp || false, text: customText || null, ms, error: r && r.error, capture: cap,
                boxes: Array.isArray(boxList) ? boxList.map(b => ({ id: b.id, text: b.text, design: b.design ? designForFusion(compPath, b.design, b.tool) : null })) : null,
                sent: compPath ? designForFusion(compPath, (design && typeof design === 'object') ? design : (a.textDesign || null)) : null });
        } catch (e) { dlog('makePreview log failed', String(e)); }
    }, 50);
    return r;
}

// Preview frames come back from Resolve on black. Text that is (nearly) all dark - e.g. black words with no bright
// outline - would vanish into that black and look like an empty, frozen render, so it is rendered on white instead.
function previewBackground(compPath, design, boxList) {
    try {
        const td = parseTextStyle(compPath, design || null);
        for (const b of (Array.isArray(boxList) ? boxList : [])) {
            if (b && b.design && Array.isArray(b.design.elements)) td.elements = td.elements.concat(b.design.elements);
        }
        const lum = (hex) => {
            const h = String(hex || '#ffffff').replace('#', '');
            const c = (k) => parseInt(h.substr(k * 2, 2), 16) / 255;
            return 0.2126 * c(0) + 0.7152 * c(1) + 0.0722 * c(2);
        };
        const shown = td.elements.filter(e => e && e.enabled && Number(e.opacity ?? 1) > 0.05 && e.alpha !== 0);
        if (!shown.length) return 'black';
        return shown.some(e => lum(e.color) > 0.3 || (Number(e.type) === 2 && lum(e.color2) > 0.3)) ? 'black' : 'white';
    } catch (e) { return 'black'; }
}
function previewCacheKey(animId, anim, compPath, customText, design, boxList, temp, opts, meta) {
    let st = null;
    try { const x = fs.statSync(compPath); st = [x.mtimeMs, x.size]; } catch (e) { return null; }
    const h = require('crypto').createHash('sha1');
    h.update(JSON.stringify([animId, anim.file, st, customText || null, design || null, anim.textDesign || null, boxList || null,
        String(temp), opts && opts.maxDim || 0, meta.fps, meta.width, meta.height, 2]));
    return h.digest('hex').slice(0, 24);
}
function linkOrCopy(src, dst) {
    try { fs.rmSync(dst, { force: true }); } catch (e) { /* ignore */ }
    try { fs.linkSync(src, dst); } catch (e) { fs.copyFileSync(src, dst); }
}
function previewCacheGet(key, animId, temp) {
    if (!key) return null;
    try {
        const cdir = path.join(PREV_CACHE_DIR, key);
        const info = JSON.parse(fs.readFileSync(path.join(cdir, 'info.json'), 'utf8'));
        const first = path.join(cdir, 'p00.png'), lastF = path.join(cdir, 'p' + String(info.count - 1).padStart(2, '0') + '.png');
        if (!fs.existsSync(first) || !fs.existsSync(lastF)) return null;
        const dir = path.join(PREV_DIR, animId + (temp === 'sub' ? '__sub' : '__use'));
        fs.rmSync(dir, { recursive: true, force: true });
        fs.mkdirSync(dir, { recursive: true });
        for (const f of fs.readdirSync(cdir)) if (/^[pw]\d+\.png$/.test(f)) linkOrCopy(path.join(cdir, f), path.join(dir, f));
        if (info.matte && !fs.existsSync(path.join(dir, 'w00.png'))) return null;
        info.stamp = Date.now();
        try { const now = new Date(); fs.utimesSync(cdir, now, now); } catch (e) { /* ignore */ }
        return { preview: info, previewFiles: frameList(dir, 'p', info), previewWhite: info.matte ? frameList(dir, 'w', info) : null };
    } catch (e) { return null; }
}
function previewCachePut(key, t) {
    if (!key || !t || !t.preview || !t.previewFiles || !t.previewFiles.length) return;
    try {
        const cdir = path.join(PREV_CACHE_DIR, key);
        fs.rmSync(cdir, { recursive: true, force: true });
        fs.mkdirSync(cdir, { recursive: true });
        const dir = path.dirname(t.previewFiles[0]);
        for (const f of fs.readdirSync(dir)) if (/^[pw]\d+\.png$/.test(f)) linkOrCopy(path.join(dir, f), path.join(cdir, f));
        fs.writeFileSync(path.join(cdir, 'info.json'), JSON.stringify(t.preview));
        const all = fs.readdirSync(PREV_CACHE_DIR).map(n => ({ n, t: fs.statSync(path.join(PREV_CACHE_DIR, n)).mtimeMs })).sort((a, b) => b.t - a.t);
        for (const o of all.slice(PREV_CACHE_MAX)) fs.rmSync(path.join(PREV_CACHE_DIR, o.n), { recursive: true, force: true });
    } catch (e) { /* the cache is only a shortcut */ }
}

// Expired previews are cleared from time to time. A preset's own preview folder (previews/<id>) is never touched.
// Folders of presets that no longer exist go at once; the temporary renders (<id>__use / __sub / __draft, __draft)
// are rebuilt on demand, so they go once untouched for PREV_TEMP_MAX_AGE_DAYS; _cache entries after PREV_CACHE_MAX_AGE_DAYS.
const PREV_TEMP_MAX_AGE_DAYS = 1;
const PREV_CACHE_MAX_AGE_DAYS = 14;
function prunePreviews() {
    let removed = 0;
    const rm = p => { try { fs.rmSync(p, { recursive: true, force: true }); removed++; } catch (e) { /* ignore */ } };
    const age = p => { try { return Date.now() - fs.statSync(p).mtimeMs; } catch (e) { return 0; } };
    try {
        if (!fs.existsSync(PREV_DIR)) return 0;
        const ids = new Set(loadLib().animations.map(a => a.id));
        if (!ids.size) return 0;   // an unreadable library must never wipe every preview
        const tempAge = PREV_TEMP_MAX_AGE_DAYS * 86400000;
        for (const n of fs.readdirSync(PREV_DIR)) {
            const full = path.join(PREV_DIR, n);
            if (n === path.basename(PREV_CACHE_DIR)) continue;
            try { if (!fs.statSync(full).isDirectory()) continue; } catch (e) { continue; }
            const m = /^(.*?)(__(?:use|sub|draft))$/.exec(n);
            const base = m ? m[1] : n;
            if (base && !ids.has(base)) { rm(full); continue; }          // preset deleted
            if (m && age(full) > tempAge) rm(full);                       // stale temporary render
        }
        if (fs.existsSync(PREV_CACHE_DIR)) {
            const cacheAge = PREV_CACHE_MAX_AGE_DAYS * 86400000;
            for (const n of fs.readdirSync(PREV_CACHE_DIR)) {
                const full = path.join(PREV_CACHE_DIR, n);
                if (age(full) > cacheAge) rm(full);
            }
        }
    } catch (e) { /* next run */ }
    if (removed) dlog('prunePreviews', { removed });
    // Previews captured before compression existed (or while the app was closed mid-way) are shrunk too.
    compressPngTree(PREV_DIR).then(r => { if (r.count) dlog('compressPreviews', r); });
    return removed;
}

// Deletes preview Text+ clips that are still on the timeline: the render clip itself (by id), and any Text+ that
// starts at or after the old end of the timeline (only the app puts clips there). Returns true when nothing is left.
async function removePreviewLeftovers(tl, endBefore, itemId) {
    for (let attempt = 0; attempt < 2; attempt++) {
        const stray = [];
        const tracks = (await tl.GetTrackCount('video')) || 0;
        for (let t = 1; t <= tracks; t++) {
            for (const it of ((await tl.GetItemListInTrack('video', t)) || [])) {
                try {
                    const id = String(await it.GetUniqueId());
                    const isMine = itemId && id === String(itemId);
                    const pastEnd = endBefore != null && (await it.GetStart()) >= endBefore && isTitleClipName(await it.GetName());
                    if (isMine || pastEnd) stray.push(it);
                } catch (e) { /* ignore */ }
            }
        }
        if (!stray.length) return true;
        try { await tl.DeleteClips(stray, false); } catch (e) { /* retried once */ }
    }
    return false;
}

let previewRunning = null;
async function makePreviewInner(event, animId, customText, design, designKey, temp, boxList, opts) {
    if (state.applying) { dlog('[render] refused: Resolve busy (another step is running)'); return { error: 'Resolve is busy. Try again in a moment.' }; }
    const tRender = Date.now();
    dlog('[render] start', animId, 'temp=' + String(temp));
    state.applying = true;
    clearCancel();
    lastCaptureStats = null;
    let tl = null, item = null, origTC = null, leftover = false, endBefore = null, itemId = null, ckey = null;
    try {
        const lib = loadLib();
        const anim = lib.animations.find(a => a.id === animId);
        if (!anim) throw new Error('Preset not found');
        const compPath = path.join(ANIM_DIR, anim.file);
        if (!fs.existsSync(compPath)) throw new Error('This preset’s Fusion file is missing');
        const project = await getProject();
        tl = project && await project.GetCurrentTimeline();
        if (!tl) throw new Error('Open a timeline in Resolve');
        const meta = await timelineMeta(tl);
        if (temp) {
            ckey = previewCacheKey(animId, anim, compPath, customText, design, boxList, temp, opts, meta);
            const hit = previewCacheGet(ckey, animId, temp);
            if (hit) { lastCaptureStats = { ms: 0, cached: true }; return { ok: true, temp: hit }; }
        }
        await sweepTempClips(tl);
        origTC = await tl.GetCurrentTimecode();
        endBefore = await tl.GetEndFrame();
        // The render clip goes past the old end of the timeline on a free layer, straight from the template when there is
        // one (no playhead move, no ripple). Otherwise the title is inserted at the end of V1 as before.
        const renderLen = Math.round(meta.fps * 3);
        try {
            const rt = await pickTrack(tl, 'video', 0, endBefore, endBefore + renderLen, 2, []);
            item = await directPlaceTitle(tl, project, rt, endBefore, renderLen, titleKindFor(compPath));
        } catch (e) { item = null; }
        if (item) {
            try { itemId = String(await item.GetUniqueId()); regAdd(itemId); } catch (e) { /* ignore */ }
        } else {
            const ins = await insertTitleAtEnd(tl, meta, endBefore, titleKindFor(compPath));
            if (ins.error) { try { await tl.SetCurrentTimecode(origTC); } catch (e) { /* ignore */ } throw new Error(ins.error); }
            item = ins.item;
            try { if (item) { itemId = String(await item.GetUniqueId()); regAdd(itemId); } } catch (e) { /* ignore */ }
            // The playhead is only needed for the insert itself: put it straight back, so it is away for a split second
            // instead of for the whole render (the frames are exported from the clip, not from the playhead).
            try { await tl.SetCurrentTimecode(origTC); } catch (e) { /* restored again below */ }
            if (!item) throw new Error('Resolve would not insert a Text+ title. Open the Edit page and try again.');
            await fitDuration(item, renderLen);
        }
        itemId = String(await item.GetUniqueId());

        const before = (await item.GetFusionCompNameList()) || [];
        // inspector-ok: temporary render clip for the preset card, deleted right after its frames are taken
        await item.ImportFusionComp(inspectorSafeComp(compPath));
        const after = (await item.GetFusionCompNameList()) || [];
        const added = after.find(n => !before.includes(n));
        let compName = null;
        if (added) {
            await item.LoadFusionCompByName(added);      // inspector-ok: temporary render clip
            compName = added;
            for (const n of before) { try { await item.DeleteFusionCompByName(n); } catch (e) { /* ignore */ } }
        }
        if (!compName) { const names = (await item.GetFusionCompNameList()) || []; compName = names[names.length - 1]; }

        const textDesign = designForFusion(compPath, (design && typeof design === 'object') ? design : (anim.textDesign || null));
        const nodes = detectNodes(compPath).filter(n => !n.nested);
        const sampleText = (customText && typeof customText === 'string' && customText.trim()) ? customText.trim() : null;
        if (nodes.length) {
            // Every Text+ gets its own text (subtitle, one line, custom text or the preset's own), its own position
            // and its own Text Design, exactly as it will be on the timeline. The saved preview (not temp) keeps
            // sample texts, but still shows each Text+'s own design.
            const given = Array.isArray(boxList) ? boxList : [];
            const multi = nodes.length > 1;
            const boxes = nodes.map((n, i) => {
                const g = given.find(x => x && x.id === n.id) || null;
                const fallback = n.kind === 'multitext' ? ('Sample ' + (n.layerName || ('Text ' + (n.layer || (i + 1))))) : (sampleText || SAMPLE_TEXTS[i % SAMPLE_TEXTS.length]);
                let text = fallback;
                if (temp && g) {
                    if (n.kind === 'multitext' && typeof g.text === 'string') text = g.text;      // an empty part stays empty
                    else if (typeof g.text === 'string' && g.text.trim()) text = g.text;
                    else if (g.text === null) text = null;      // "Keep preset's text"
                }
                return {
                    id: n.id, kind: n.kind, tool: n.tool, input: n.input, centerInput: n.centerInput, label: n.label, text,
                    cx: (multi && g && typeof g.cx === 'number') ? g.cx : null,
                    cy: (multi && g && typeof g.cy === 'number') ? g.cy : null,
                    size: (multi && g && typeof g.size === 'number') ? g.size : null,
                    design: (g && g.design && typeof g.design === 'object') ? g.design : null,
                    // a forced font / colour per MultiText layer (Use tab Text Style), one-time renders only
                    font: (temp && g && g.font) ? g.font : null, style: (temp && g && g.font) ? (g.style || null) : null,
                    color: (temp && g && g.color) ? g.color : null, bgColor: (temp && g && g.bgColor) ? g.bgColor : null
                };
            });
            await bridgeCall('set_boxes', { item: itemId, comp: compName, boxes: fusionBoxes(compPath, boxes), textDesign });
        } else {
            await bridgeCall('set_text', { item: itemId, comp: compName, text: sampleText || SAMPLE_TEXTS[0], textDesign });
        }
        try {
            await bridgeCall('refresh', { item: itemId, comp: compName });
        } catch (e) { /* only a safety refresh */ }
        // Every preview is rendered on black and then on white. Together they give each pixel's real colour and
        // transparency, so dark text, light text, gradients and soft shadows all show exactly, whatever their colour.
        // The black/white choice below is only the backdrop of the small preset cards.
        let bg = previewBackground(compPath, (design && typeof design === 'object') ? design : (anim.textDesign || null), boxList);
        let matteBg = null;
        try { const r = await bridgeCall('preview_bg', { item: itemId, comp: compName, color: [0, 0, 0] }); if (r && r.ok && r.bg) matteBg = r.bg; } catch (e) { matteBg = null; }
        if (!matteBg && bg === 'white') {
            try { const r = await bridgeCall('preview_bg', { item: itemId, comp: compName, color: [1, 1, 1] }); if (!r || !r.ok) bg = 'black'; } catch (e) { bg = 'black'; }
        }
        previewBgNext = matteBg ? bg : bg;
        const spec = parseTextStyle(compPath, null).animSpec || {};
        const copts = { comp: compName, matteBg, meta, maxDim: opts && opts.maxDim, hold: spec.frameRepeatVar ? 1 : (spec.frameRepeat || 1) };
        if (temp) {
            // Big viewer: a small, quick version goes to the panel first (about a tenth of the pixels), then the
            // full-size one replaces it.
            if (temp === true && opts && opts.draftKey && Number(opts.maxDim) >= 800 && event && event.sender) {
                const keepBg = previewBgNext;
                try {
                    const dt = await capturePreview(animId, itemId, sampleText || '', designKey, path.join(PREV_DIR, animId + '__draft'), Object.assign({}, copts, { maxDim: 480 }));
                    if (!event.sender.isDestroyed()) event.sender.send('preview:draft', { key: opts.draftKey, id: animId, temp: dt });
                } catch (e) {
                    if (/cancelled/i.test(String(e && e.message || e))) throw e;     // a draft is optional; anything else is ignored
                }
                previewBgNext = keepBg;
            }
            const t = await capturePreview(animId, itemId, sampleText || '', designKey, path.join(PREV_DIR, animId + (temp === 'sub' ? '__sub' : '__use')), copts);
            previewCachePut(ckey, t);
            return { ok: true, temp: t };
        }
        await capturePreview(animId, itemId, sampleText || '', designKey, null, copts);
        return { ok: true, lib: libForUI() };
    } catch (e) {
        const msg = String(e && e.message || e);
        return { error: /cancelled/i.test(msg) ? 'Resolve is busy (replaced by a newer change).' : msg };
    } finally {
        dlog('[render] end', animId, (Date.now() - tRender) + ' ms');
        clearCancel();
        try { if (item) { const ok = await tl.DeleteClips([item], false); if (!ok) leftover = true; } } catch (e) { leftover = true; }
        // Make sure the render clip is really gone: whatever this render (or an interrupted earlier one) left at the
        // end of the timeline is found again and deleted.
        try { if (tl && item && await removePreviewLeftovers(tl, endBefore, itemId)) leftover = false; } catch (e) { /* ignore */ }
        if (!leftover && itemId) regDel(itemId);
        try { if (tl && origTC) await tl.SetCurrentTimecode(origTC); } catch (e) { /* ignore */ }
        state.applying = false;
        if (leftover) console.error('Preview clip could not be removed from the timeline');
    }
}

// Reads the Text+ / template nodes of the clip selected on the timeline, as Fusion really has them.
async function scanClip() {
    const item = await findSelectedFusionItem();
    if (!item) return { error: 'Select the Text+ clip on your timeline first' };
    const names = (await item.GetFusionCompNameList()) || [];
    const res = await bridgeCall('scan', { item: String(await item.GetUniqueId()), comp: names[names.length - 1] || null });
    return { ok: true, nodes: res.nodes || [], clipName: String(await item.GetName()) };
}
