// The MCP `place` tool: one subtitle (or phrase) as an animated clip, with the editing rules enforced (allowed tags, forced
// look and its share, MultiText split, safe area / layout fit, track policy, sizes) and recorded for remove_placed.
// automation.js routes the HTTP call here; the planning maths is auto-plan.js, the session state auto-session.js.

module.exports = { place };

const fs = require('fs');
const path = require('path');

const state = require('./state');
const { ANIM_DIR } = require('./config');
const { apply } = require('./apply');
const { bridgeCall } = require('./fusion-bridge');
const { nodesWithDesign, parseTextStyle } = require('./fusion-setting');
const { loadLib } = require('./library');
const { dlog } = require('./log');
const { ZONES, highlightReq, loadRules, rowsReq, takeShare, withFillColor, withGradientFill } = require('./edit-rules');
const { getSubtitles } = require('./resolve');
const LAYOUT = require('./layout');
const { boxListFor, defaultSplit, estimateLines, layoutFor, passes, resolveTags, sizedDesign } = require('./auto-plan');
const { currentTimeline, placed, subtitleAt, waitFree } = require('./auto-session');

// Places one preset on one subtitle, with the rules enforced.
async function place(args) {
    args = args || {};
    const lib = loadLib();
    const rules = loadRules();
    const a = lib.animations.find(x => x.id === args.presetId) || lib.animations.find(x => x.name === args.presetId);
    if (!a) throw new Error('Unknown preset ' + args.presetId + '. Use list_presets.');
    const { ids } = resolveTags(lib, rules.allowedTags);
    if (rules.allowedTags.length && !passes(a, ids, rules.tagMatch)) {
        throw new Error('"' + a.name + '" is not allowed by the rules (allowed tags: ' + rules.allowedTags.join(' ') + ').');
    }
    await waitFree(10000);
    const { tl, meta } = await currentTimeline();
    const sub = await subtitleAt(tl, args.subtitle);
    const text = String(args.text || sub.text || '').trim();
    const compPath = path.join(ANIM_DIR, a.file);
    const nodes = fs.existsSync(compPath) ? nodesWithDesign(compPath) : [];
    const isMT = nodes.some(n => n.kind === 'multitext');
    const notes = [];

    // MultiText: the words to emphasize (Claude's pick, or the rules' default)
    let parts = null;
    if (isMT) {
        if (args.parts && typeof args.parts === 'object') parts = { upper: String(args.parts.upper || ''), emphasis: String(args.parts.emphasis || ''), lower: String(args.parts.lower || '') };
        else parts = defaultSplit(text, rules.multitext.emphasis === 'auto' ? 'last' : rules.multitext.emphasis);
        if (rules.multitext.uppercaseEmphasis) parts.emphasis = parts.emphasis.toUpperCase();
        const norm = (s) => s.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '');
        if (norm([parts.upper, parts.emphasis, parts.lower].join(' ')) !== norm(text)) notes.push('the MultiText parts do not spell the subtitle exactly');
    }

    // font and colour: the rules' overrides, unless this call keeps the preset's own look
    // styleShare: only that share of the clips gets the overrides, the rest keep the preset's default look
    const peek = !!(args.dryRun || args._measure);
    const share = rules.styleShare || {};
    const hasNormal = !!(rules.font || rules.color || (rules.kindStyle && (rules.kindStyle.textplus || rules.kindStyle.multitext)));
    const keepLook = args.keepPresetStyle === true;
    // styleExcept: presets with one of the listed tags keep their own font and / or colour
    const exceptFor = (x) => {
        if (!x) return null;
        const { ids } = resolveTags(lib, x.tags);
        return (ids.length && passes(a, ids, 'any')) ? x.keep : null;
    };
    const exN = exceptFor(rules.styleExcept && rules.styleExcept.normal);
    const exE = exceptFor(rules.styleExcept && rules.styleExcept.emphasis);
    if (exN) notes.push('text style: preset keeps its own ' + (exN === 'both' ? 'font and colour' : (exN === 'font' ? 'font' : 'colour')) + ' (tag exception)');
    if (exE && isMT) notes.push('emphasis: preset keeps its own ' + (exE === 'both' ? 'font and colour' : (exE === 'font' ? 'font' : 'colour')) + ' (tag exception)');
    const useNormal = !keepLook && exN !== 'both' && hasNormal && takeShare('normal', share.normal, peek);
    const useEm = !keepLook && exE !== 'both' && isMT && !!rules.emphasis && takeShare('emphasis', share.emphasis, peek);
    if (hasNormal && !keepLook && !useNormal) notes.push('text style: preset default (override share ' + share.normal + '%)');
    if (isMT && rules.emphasis && !keepLook && !useEm) notes.push('emphasis: preset default (override share ' + share.emphasis + '%)');
    // a pair for this kind of preset (Text+ / MultiText) beats the general font / color
    const ks = (rules.kindStyle && rules.kindStyle[isMT ? 'multitext' : 'textplus']) || null;
    const font = (useNormal && exN !== 'font') ? ((ks && ks.font) ? { font: ks.font, style: ks.style } : (rules.font || null)) : null;
    const normColor = (useNormal && exN !== 'color') ? ((ks && ks.color) || rules.color || null) : null;
    // the emphasis layer: its own override, minus what the exception keeps; an exception also stops the normal
    // font / colour from reaching the emphasis layer (keepFont / keepColor)
    let emLook = useEm ? Object.assign({}, rules.emphasis) : null;
    if (isMT && exE) {
        emLook = Object.assign({}, emLook || {});
        if (exE !== 'color') { emLook.font = null; emLook.style = null; emLook.keepFont = true; }
        if (exE !== 'font') { emLook.color = null; emLook.keepColor = true; }
    }
    // gradient fills: the rules' gradient recolour wins over the preset's own colours (exceptions, keepPresetStyle and
    // the override share included); its unset top takes the text style colour
    const gradRule = (rules.gradient && rules.gradient.enabled && !isMT) ? rules.gradient : null;
    const gradColor = gradRule ? (normColor || (ks && ks.color) || rules.color || null) : null;
    const look = (font || normColor || emLook || gradRule) ? { font, color: normColor, emphasis: emLook, gradient: gradRule, gradientColor: gradColor } : null;
    let textDesign = parseTextStyle(fs.existsSync(compPath) ? compPath : null, a.textDesign) || null;
    if (font) textDesign = Object.assign({}, textDesign || {}, { font: font.font }, font.style ? { style: font.style } : {});
    const gradDesign = gradRule ? withGradientFill(textDesign, gradRule, gradColor) : null;
    if (gradDesign) {
        textDesign = gradDesign;
        const e1 = gradDesign.elements.find(e => Number(e.index) === 1);
        notes.push('gradient fill: ' + e1.color + ' → ' + e1.color2 + ' (gradient rule)');
    } else if (look && look.color && !isMT) textDesign = withFillColor(textDesign, look.color);

    // text size: a multiplier on the preset's own Text+ Size, so long lines can be shrunk to fit the frame
    // (Edit-page scale zooms the whole rendered clip instead and can push the text out of frame)
    // maxSize / lineSpacing: this call's values, else the rules' (Inspector values; null = the preset's own)
    let textSize = Number(args.textSize);
    if (!Number.isFinite(textSize) || textSize <= 0) textSize = 1;
    textSize = Math.max(0.2, Math.min(3, textSize));
    const pick = (v, def, lo, hi) => { const n = Number(v); return (v !== undefined && v !== null && Number.isFinite(n) && n > 0) ? Math.max(lo, Math.min(hi, n)) : def; };
    const maxSize = pick(args.maxSize, rules.text.maxSize, 0.01, 1);
    const lineSpacing = pick(args.lineSpacing, rules.text.lineSpacing, 0.3, 3);

    // position: x / y are where the text's centre goes (0..1, top-left origin), kept inside the safe area
    const P = rules.position;
    const L = layoutFor(rules.layout, meta);
    if (rules.layout && !L) notes.push('layout not used: it is for ' + rules.layout.width + 'x' + rules.layout.height + ' timelines, this one is ' + meta.width + 'x' + meta.height);
    let x = Number(args.x), y = Number(args.y);
    let lockY = false, region = null;
    if (args.guide !== undefined && args.guide !== null && args.guide !== '') {
        if (!L) throw new Error(rules.layout ? 'The layout is for ' + rules.layout.width + 'x' + rules.layout.height + ' (vertical) timelines; this timeline is ' + meta.width + 'x' + meta.height + '. Use x / y or zone instead of guide.' : 'No layout: set one with set_layout before placing on a guide');
        const g = LAYOUT.findGuide(L, args.guide, 'h');
        if (!g) throw new Error('No horizontal guide "' + args.guide + '". Guides: ' + L.guides.filter(q => q.orient === 'h').map(q => q.name).join(', '));
        const align = args.align || 'on';
        if (align === 'on') { y = g.pos; lockY = true; }
        else {      // the area between this guide and the next one: the text stays between the two lines
            region = LAYOUT.guideRegion(L, g, align, Number.isFinite(x) ? x : 0.5);
            y = (region[0] + region[1]) / 2; lockY = true;
        }
    }
    if (args.guideX !== undefined && args.guideX !== null && args.guideX !== '') {
        const g = L && LAYOUT.findGuide(L, args.guideX, 'v');
        if (!g) throw new Error('No vertical guide "' + args.guideX + '"' + (L ? '. Guides: ' + L.guides.filter(q => q.orient === 'v').map(q => q.name).join(', ') : ' (no layout set)'));
        x = g.pos;
    }
    const zone = args.zone || P.defaultZone;
    if (!Number.isFinite(y) && zone && ZONES[zone] !== undefined) y = ZONES[zone];
    let posX = Number(a.posX) || 0, posY = Number(a.posY) || 0;
    const fitOn = !!(L && L.fit.enabled && args.fit !== false);
    if (Number.isFinite(x) || Number.isFinite(y) || fitOn) {
        const ref = nodes.filter(n => !n.nested);
        const cx = ref.length ? ref.reduce((s, n) => s + (n.cx || 0.5), 0) / ref.length : 0.5;
        const cy = ref.length ? ref.reduce((s, n) => s + (n.cy || 0.5), 0) / ref.length : 0.5;      // Fusion: y up
        // no x / y given: where the preset puts it now (apply() reads |pos| <= 1 as an old-style ratio)
        if (!Number.isFinite(x)) x = cx + (Math.abs(posX) > 1 ? posX / meta.width : 0);
        if (!Number.isFinite(y)) y = 1 - (cy + (Math.abs(posY) > 1 ? posY / meta.height : 0));
        let cx2, cy2;
        if (fitOn) {
            // the text's estimated size on screen, kept inside the layout's safe area and off its zones
            const est = estimateLines(nodes, isMT, text, parts, textDesign, textSize, maxSize);
            if (est) {
                const box = LAYOUT.estimateTextBox(est, meta.width, meta.height, lineSpacing || (textDesign && textDesign.lineSpacing) || 1, L.fit.widthFactor);
                const f = LAYOUT.fitBox(L, x, y, box.w, box.h, { pad: L.fit.pad, avoidZones: L.fit.avoidZones, lockY, region });
                cx2 = f.cx; cy2 = f.cy;
                notes.push(...f.notes);
                if (f.scale < 0.995) {
                    if (args.shrink === false) notes.push('the text is about ' + Math.round(100 / f.scale) + '% of the safe width here and will overflow');
                    else {
                        textSize = Math.max(0.2, Math.round(textSize * f.scale * 1000) / 1000);
                        notes.push('textSize reduced to ' + textSize + ' to fit the safe area' + (!/\n/.test(text) && text.split(/\s+/).length > 3 ? ' (a "\\n" line break would keep it bigger)' : ''));
                    }
                }
                if (Math.abs(cx2 - x) > 0.005 || Math.abs(cy2 - y) > 0.005) notes.push('moved to ' + cx2.toFixed(3) + ', ' + cy2.toFixed(3) + ' to stay inside the layout');
            } else notes.push('layout fit skipped: the preset has no readable text size');
        }
        if (cx2 === undefined) {
            if (L) { cx2 = x; cy2 = y; }      // the layout (not the rectangular safe margins) is the safe area
            else {
                cx2 = Math.max(P.safeLeft, Math.min(P.safeRight, x));
                cy2 = Math.max(P.safeTop, Math.min(P.safeBottom, y));
                if (cx2 !== x || cy2 !== y) notes.push('position kept inside the safe area');
            }
        }
        posX = Math.round((cx2 - cx) * meta.width);
        posY = Math.round(((1 - cy2) - cy) * meta.height);
        if (Math.abs(posX) <= 1) posX = 0;      // apply() reads |v| <= 1 as an old-style ratio
        if (Math.abs(posY) <= 1) posY = 0;
    }

    const sizing = { textSize, maxSize, lineSpacing };
    if (!isMT && (textSize !== 1 || sizing.maxSize || sizing.lineSpacing)) {
        if (textDesign && Number(textDesign.size) > 0) {
            const r = sizedDesign(textDesign, sizing);
            textDesign = r.design;
            if (r.capped) notes.push('text size capped at maxSize ' + sizing.maxSize);
        } else if (sizing.lineSpacing) {
            textDesign = Object.assign({}, textDesign || {}, { lineSpacing: sizing.lineSpacing });
            if (textSize !== 1 || sizing.maxSize) notes.push('textSize / maxSize ignored: the preset has no readable Text+ size');
        } else notes.push('textSize / maxSize ignored: the preset has no readable Text+ size');
    }

    // video layer
    let textTrack = 0;
    // the panel's Placement settings (locked / disabled handling, first empty, track range); the rules' range wins when set
    const pp = state.placePrefs || {};
    const tr = (args.trackRange && typeof args.trackRange === 'object' && (args.trackRange.from || args.trackRange.to)) ? args.trackRange
        : ((rules.track.from || rules.track.to) ? rules.track : null);      // prompt (this call) > rules > panel
    const place = {
        locked: !!pp.locked, disabledTrack: !!pp.disabledTrack, disabledClip: !!pp.disabledClip,
        firstEmpty: rules.track.mode === 'first-empty' || !!pp.firstEmpty,
        rangeFrom: tr ? (tr.from || null) : pp.rangeFrom,
        rangeTo: tr ? (tr.to || null) : pp.rangeTo,
        audioMode: pp.audioMode, audioFrom: pp.audioFrom, audioTo: pp.audioTo
    };
    // audioTrack from the prompt (this call) beats the panel's Placement "Audio track"
    const at = (args.audioTrack && typeof args.audioTrack === 'object') ? args.audioTrack : null;
    if (at && ['any', 'same', 'own'].includes(at.mode)) Object.assign(place, { audioMode: at.mode, audioFrom: at.from || null, audioTo: at.to || null });
    if (args.track) textTrack = Math.max(2, Math.round(Number(String(args.track).replace(/^v/i, ''))) || 0);
    else if (rules.track.mode === 'fixed' && rules.track.fixed) textTrack = rules.track.fixed;

    // a phrase regrouped by thought (see regroup): its own start / end frames instead of the subtitle's
    let clipStart = sub.start, clipEnd = sub.end;
    const hasStart = args.startFrame !== undefined && args.startFrame !== null;
    const hasEnd = args.endFrame !== undefined && args.endFrame !== null;
    if (hasStart || hasEnd) {
        if (args.holdUntil) throw new Error('Use either startFrame / endFrame or holdUntil, not both');
        if (hasStart) clipStart = Math.round(Number(args.startFrame));
        if (hasEnd) clipEnd = Math.round(Number(args.endFrame));
        if (!Number.isFinite(clipStart) || !Number.isFinite(clipEnd) || clipEnd <= clipStart) throw new Error('endFrame must come after startFrame');
        notes.push('timed as a regrouped phrase: frames ' + clipStart + '-' + clipEnd + ' (' + (clipEnd - clipStart) + ' frames)');
        if (clipEnd - clipStart < 12) notes.push('only ' + (clipEnd - clipStart) + ' frames on screen: the animation may not finish');
    }

    // hold the text on screen until a later subtitle ends (stacked consecutive captions); the sound is not extended
    let holdEnd = clipEnd, held = null;
    if (args.holdUntil) {
        const later = await subtitleAt(tl, args.holdUntil);
        if (later.end <= sub.end) throw new Error('holdUntil must be a later subtitle (subtitle ' + later.index + ' ends before ' + sub.index + ')');
        holdEnd = later.end; held = later.index;
        notes.push('text held until the end of subtitle ' + later.index + ' (frame ' + later.end + '); sound keeps subtitle ' + sub.index + '\'s length');
    }

    // the preset's outro tail (e.g. 12 frames on "Highlight Select" / "Glass Pill") runs past the words; it must not
    // run into the next words on screen (the next subtitle, or the rest of a subtitle this phrase ends inside)
    let tail = Number(a.tail) || 0;
    if (tail > 0) {
        try {
            const all = await getSubtitles(tl, false);
            let next = Infinity;
            for (const s of all) {
                if (s.start < holdEnd && s.end > holdEnd) { next = holdEnd; break; }
                if (s.start >= holdEnd && s.start < next) next = s.start;
            }
            if (next - holdEnd < tail) {
                const was = tail;
                tail = Math.max(0, next - holdEnd);
                notes.push('outro tail ' + was + ' → ' + tail + ' frames (the next words start at frame ' + next + ')');
            }
        } catch (e) { /* subtitles unreadable: keep the preset's tail */ }
    }

    const req = {
        animationId: a.id, text, start: clipStart, end: holdEnd, sfxEnd: held ? sub.end : undefined,
        textOffset: a.textOffset || 0, sfxOffset: a.sfxOffset || 0, sfxVolume: a.sfxVolume, tail,
        textTrack, sfxTrack: a.sfxTrack || 0, place,
        useSfx: rules.sound && args.sound !== false && a.useSfx !== false,
        linked: a.linked !== false,
        posX, posY, scale: Number(args.scale) || Number(a.scale) || 1, rotation: Number(a.rotation) || 0,
        textDesign,
        // this call's highlight values over the rules' (only fields given change)
        highlight: isMT ? highlightReq(Object.assign({}, rules.highlight, (args.highlight && typeof args.highlight === 'object') ? args.highlight : {})) : null,
        // the MultiText Row controls (gap between the rows, justify, per-row nudges): the rules' + this call's
        rows: isMT ? rowsReq(rules.rows, args.rows) : null,
        boxList: boxListFor(a, nodes, text, parts, look, sizing),
        // the bridge sizes every MultiText layer together (sizes, boxes and the gaps between layers)
        multitext: (isMT && (textSize !== 1 || sizing.maxSize || sizing.lineSpacing)) ? sizing : null,
        keepPresetDefaults: true,      // automated positions are not saved into the preset
        // once placed, the subtitle clip(s) under the phrase's own words are turned off (not a measuring clip,
        // not the held tail: later subtitles keep theirs until they are placed themselves)
        disableSubtitle: (args._measure || args.keepSubtitle) ? null : { start: clipStart, end: clipEnd, track: sub.track }
    };
    if (args.dryRun) return { dryRun: true, preset: a.name, subtitle: sub.index, text, parts, textSize, request: Object.assign({}, req, { boxList: req.boxList.length + ' text layers' }), notes };

    state.lastPlacedAudioId = null;
    const res = await apply(null, req);
    if (!res || !res.ok) throw new Error((res && res.error) || 'Placement failed');
    const rec = { itemId: res.itemId, audioId: state.lastPlacedAudioId, extraAudioIds: res.extraSfxIds || [], subtitle: sub.index, presetId: a.id, preset: a.name, track: 'V' + res.videoTrack, holdUntil: held || undefined, subtitlesDisabled: res.subtitlesDisabled || [] };
    placed.push(rec);
    dlog('[automation] placed', a.name, 'on subtitle', sub.index, 'V' + res.videoTrack);
    // effect presets (Glitch / Wiggle / Stop Motion) on the new clip, as Resolve effects (effect-presets.js)
    // each entry: 'Wiggle' or { id: 'Wiggle', strength: 0..100 } (strength left out = the effect's light default)
    const fxSpec = {}, fxParams = {};
    for (const x of (Array.isArray(args.effects) ? args.effects : [])) {
        if (typeof x === 'string') fxSpec[x] = null;
        else if (x && typeof x === 'object' && x.id) {
            fxSpec[String(x.id)] = Number.isFinite(Number(x.strength)) ? Number(x.strength) : null;
            if (x.params && typeof x.params === 'object') fxParams[String(x.id)] = x.params;
        }
    }
    const fxWant = Object.keys(fxSpec);
    const fxDone = [];
    if (fxWant.length && !args._measure) {
        const { ORDER } = require('./effect-presets');
        require('./effect-presets').installEffects();
        for (const id of ORDER.filter(k => fxWant.includes(k))) {
            try {
                // StopMotion's strength = its Frame Repeat (1..10, default 2): glitch / wiggle on the clip hold for it too
                const hold = fxWant.includes('StopMotion') ? (fxSpec.StopMotion !== null && fxSpec.StopMotion !== undefined ? fxSpec.StopMotion : 2) : null;
                const r = await bridgeCall('fx_set', { effect: id, on: true, items: [res.itemId], strength: fxSpec[id], hold, params: fxParams[id] || null }, 15000);
                if (r && r.inNodes && r.inNodes.length) notes.push('Effect ' + id + ' not added: already a node in the clip\'s Fusion graph');
                else if (r && !(r.failed && r.failed.length)) {
                    fxDone.push(id);
                    // the effect's own sound (Glitch), the same as turning it on in the panel
                    try {
                        const snd = await require('./effect-presets').syncEffectSfx(id, (r.clips || []).filter(c => String(c.id) === String(res.itemId)), new Set(), fxParams[id] || null);
                        if (snd && snd.ids && snd.ids.length) { rec.extraAudioIds = (rec.extraAudioIds || []).concat(snd.ids); notes.push('Effect ' + id + ': its sound placed'); }
                    } catch (e) { notes.push('Effect ' + id + ' sound: ' + e.message); }
                }
                else notes.push('Effect ' + id + ' could not be added');
            } catch (e) { notes.push('Effect ' + id + ' could not be added: ' + e.message); }
        }
        rec.effects = fxDone;
    }
    // the real Inspector values, read by the helper (sizes / fonts only): callers must not script the comp themselves
    let inspector;
    if (!args._measure) {
        try { inspector = ((await bridgeCall('read_style', { item: res.itemId, comp: null }, 8000)) || {}).tools; }
        catch (e) { inspector = undefined; }
    }
    return {
        inspector,
        placed: true, itemId: res.itemId, preset: a.name, subtitle: sub.index, text, parts: parts || undefined,
        effects: fxDone.length ? fxDone : undefined,
        videoTrack: 'V' + res.videoTrack, audioTrack: res.audioTrack ? 'A' + res.audioTrack : null,
        subtitleClipsDisabled: (res.subtitlesDisabled || []).map(s => s.text),
        start: res.start, frames: res.frames, holdUntil: held || undefined, position: { posX, posY }, textSize,
        notes: notes.concat(res.trackNotes || []), warnings: res.warnings || []
    };
}
