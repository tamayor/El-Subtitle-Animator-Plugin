// Automation for Claude (or any MCP client): a small HTTP server on 127.0.0.1 that the MCP script in mcp/el-sa-mcp.js
// talks to. Every placement goes through apply() (title templates, never a comp swap), with the editing rules from
// edit-rules.json enforced here: allowed tags, a forced font, the video layer policy, the safe area and MultiText splits.
// The address and a random token are written to ~/.el-subtitle-animator/mcp-endpoint.json (readable by this user only).

module.exports = {
    startAutomation, stopAutomation
};

const fs = require('fs');
const http = require('http');
const os = require('os');
const path = require('path');
const crypto = require('crypto');

const state = require('./state');
const { ANIM_DIR, DATA_DIR } = require('./config');
const { apply } = require('./apply');
const { bridgeCall } = require('./fusion-bridge');
const { nodesWithDesign, parseTextStyle } = require('./fusion-setting');
const { loadLib } = require('./library');
const { dlog } = require('./log');
const { frameToTC, getProject, getSubtitles, timelineMeta } = require('./resolve');

const ENDPOINT_DIR = path.join(os.homedir(), '.el-subtitle-animator');
const ENDPOINT_FILE = path.join(ENDPOINT_DIR, 'mcp-endpoint.json');
const RULES_FILE = path.join(DATA_DIR, 'edit-rules.json');

let server = null;
let token = null;
const placed = [];      // clips placed through automation this session: { itemId, audioId, subtitle, presetId, preset, track }

// ------------------------------------------------------------------ editing rules

const ZONES = { top: 0.14, upper: 0.3, center: 0.5, lower: 0.7, bottom: 0.84 };

function defaultRules() {
    return {
        allowedTags: [],            // emoji, tag names or ids; empty = every preset may be used
        tagMatch: 'any',            // 'any': a preset needs one of the tags, 'all': every one of them
        font: null,                 // { font: 'Poppins', style: 'ExtraBold' } forces this font on every placed clip
        track: { mode: 'top', fixed: null },      // 'top' above all clips there, 'first-empty' lowest free layer, 'fixed' V<fixed>
        position: { defaultZone: null, safeTop: 0.08, safeBottom: 0.92, safeLeft: 0.05, safeRight: 0.95, avoidFaces: true },
        multitext: { emphasis: 'auto', uppercaseEmphasis: false },      // auto = Claude picks the words to emphasize
        // Inspector values: maxSize caps the text Size (MultiText: its biggest layer, the group shrinks together);
        // lineSpacing sets Line Spacing (MultiText: each layer's, and the gaps between layers scale with it). null = the preset's
        text: { maxSize: null, lineSpacing: null },
        sound: true,               // place the presets' sound effects
        notes: ''                   // free-text editing rules Claude reads before editing
    };
}

function cleanRules(r) {
    const d = defaultRules();
    r = (r && typeof r === 'object') ? r : {};
    const num = (v, lo, hi, def) => { const n = Number(v); return Number.isFinite(n) ? Math.max(lo, Math.min(hi, n)) : def; };
    const pos = Object.assign({}, d.position, r.position || {});
    const trk = Object.assign({}, d.track, r.track || {});
    const mt = Object.assign({}, d.multitext, r.multitext || {});
    const tx = Object.assign({}, d.text, r.text || {});
    const opt = (v, lo, hi) => (v === null || v === undefined || v === '') ? null : num(v, lo, hi, null);
    return {
        allowedTags: (Array.isArray(r.allowedTags) ? r.allowedTags : []).map(x => String(x).trim()).filter(Boolean).slice(0, 50),
        tagMatch: r.tagMatch === 'all' ? 'all' : 'any',
        font: (r.font && typeof r.font === 'object' && String(r.font.font || '').trim())
            ? { font: String(r.font.font).trim(), style: String(r.font.style || '').trim() || null }
            : null,
        track: {
            mode: ['top', 'first-empty', 'fixed'].includes(trk.mode) ? trk.mode : 'top',
            fixed: trk.fixed ? Math.max(2, Math.round(Number(trk.fixed)) || 2) : null
        },
        position: {
            defaultZone: (pos.defaultZone && ZONES[pos.defaultZone] !== undefined) ? pos.defaultZone : null,
            safeTop: num(pos.safeTop, 0, 0.5, d.position.safeTop),
            safeBottom: num(pos.safeBottom, 0.5, 1, d.position.safeBottom),
            safeLeft: num(pos.safeLeft, 0, 0.5, d.position.safeLeft),
            safeRight: num(pos.safeRight, 0.5, 1, d.position.safeRight),
            avoidFaces: pos.avoidFaces !== false
        },
        multitext: {
            emphasis: ['auto', 'last', 'first', 'center'].includes(mt.emphasis) ? mt.emphasis : 'auto',
            uppercaseEmphasis: !!mt.uppercaseEmphasis
        },
        text: { maxSize: opt(tx.maxSize, 0.01, 1), lineSpacing: opt(tx.lineSpacing, 0.3, 3) },
        sound: r.sound !== false,
        notes: String(r.notes || '').slice(0, 4000)
    };
}

function loadRules() {
    try { return cleanRules(JSON.parse(fs.readFileSync(RULES_FILE, 'utf8'))); } catch (e) { return defaultRules(); }
}

function saveRules(r) {
    const clean = cleanRules(r);
    const tmp = RULES_FILE + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(clean, null, 2));
    fs.renameSync(tmp, RULES_FILE);
    return clean;
}

// ------------------------------------------------------------------ tags and presets

const graphemes = (s) => Array.from(new Intl.Segmenter(undefined, { granularity: 'grapheme' }).segment(String(s || '').replace(/\s+/g, '')), x => x.segment);
const bare = (s) => s.replace(/️/g, '');      // "❤️" and "❤" are the same emoji

// A tag matches its id, its name, its whole emoji string or any one of its emoji.
function tagMatches(t, token) {
    const k = String(token).trim();
    if (!k) return false;
    if (t.id === k || t.name.toLowerCase() === k.toLowerCase()) return true;
    if (!t.emoji) return false;
    return bare(t.emoji) === bare(k) || graphemes(t.emoji).some(e => bare(e) === bare(k));
}

// Tag ids for a list of emoji / names / ids; tokens that match no tag are returned as unknown.
function resolveTags(lib, tokens) {
    const ids = [], unknown = [];
    for (const k of tokens || []) {
        const t = (lib.tags || []).find(x => tagMatches(x, k));
        if (t) ids.push(t.id); else unknown.push(k);
    }
    return { ids, unknown };
}

function passes(a, ids, match) {
    if (!ids.length) return true;
    const mine = Array.isArray(a.tags) ? a.tags : [];
    return match === 'all' ? ids.every(id => mine.includes(id)) : ids.some(id => mine.includes(id));
}

function presetInfo(lib, a) {
    const compPath = path.join(ANIM_DIR, a.file);
    const exists = fs.existsSync(compPath);
    const nodes = exists ? nodesWithDesign(compPath) : [];
    const td = parseTextStyle(exists ? compPath : null, a.textDesign) || {};
    const tags = (a.tags || []).map(id => (lib.tags || []).find(t => t.id === id)).filter(Boolean);
    return {
        id: a.id,
        name: a.name,
        tags: tags.map(t => (t.emoji ? t.emoji + ' ' : '') + t.name),
        multiText: nodes.some(n => n.kind === 'multitext'),
        textLayers: nodes.filter(n => !n.nested).map(n => n.kind === 'multitext' ? (n.layerName || ('Text ' + n.layer)) : n.label),
        font: td.font ? (td.font + (td.style ? ' ' + td.style : '')) : null,
        sound: a.useSfx === false ? null : (a.sfx || lib.defaultSfx || null),
        missing: !exists
    };
}

// ------------------------------------------------------------------ MultiText (same role guess as the panel's text-boxes.js)

function autoRoles(list) {
    const r = { upper: null, emphasis: null, lower: null };
    const used = new Set();
    const take = (role, re) => {
        if (r[role] !== null) return;
        const n = list.find(x => !used.has(x.layer) && re.test((x.layerName || '') + ' ' + (x.defaultText || '')));
        if (n) { r[role] = n.layer; used.add(n.layer); }
    };
    take('emphasis', /emphas|highlight|keyword|hero|\bmain\b|\bbig\b/i);
    take('upper', /upper|\btop\b|above/i);
    take('lower', /lower|bottom|below|under/i);
    const pick = (role, best) => {
        if (r[role] !== null) return;
        const p = list.filter(x => !used.has(x.layer));
        if (!p.length) return;
        const n = p.reduce((m, x) => best(x, m) ? x : m);
        r[role] = n.layer; used.add(n.layer);
    };
    pick('emphasis', (x, m) => (x.size || 0) > (m.size || 0) + 1e-6);
    pick('upper', (x, m) => x.cy > m.cy + 1e-6);
    pick('lower', (x, m) => x.cy < m.cy - 1e-6);
    return r;
}

function defaultSplit(text, how) {
    const w = String(text || '').replace(/\r?\n/g, ' ').split(/\s+/).filter(Boolean);
    const N = w.length;
    if (!N) return { upper: '', emphasis: '', lower: '' };
    const s = how === 'first' ? 0 : (how === 'center' ? Math.floor((N - 1) / 2) : N - 1);
    return { upper: w.slice(0, s).join(' '), emphasis: w[s], lower: w.slice(s + 1).join(' ') };
}

function mtTexts(nodes, parts) {
    const r = autoRoles(nodes.filter(n => n.kind === 'multitext'));
    const t = Object.assign({ upper: '', emphasis: '', lower: '' }, parts);
    const join = (x, y) => [x, y].filter(Boolean).join(' ');
    if (r.upper === null && t.upper) { if (r.lower !== null) t.lower = join(t.upper, t.lower); else if (r.emphasis !== null) t.emphasis = join(t.upper, t.emphasis); t.upper = ''; }
    if (r.lower === null && t.lower) { if (r.upper !== null) t.upper = join(t.upper, t.lower); else if (r.emphasis !== null) t.emphasis = join(t.emphasis, t.lower); t.lower = ''; }
    const byLayer = {};
    for (const role of ['upper', 'emphasis', 'lower']) if (r[role] !== null) byLayer[r[role]] = t[role];
    return byLayer;
}

// A Text+ design with the sizing applied: Size x textSize, capped at maxSize; Line Spacing set. capped: the cap was hit.
function sizedDesign(design, sizing) {
    const s = sizing || {};
    const out = Object.assign({}, design || {});
    let capped = false;
    if (Number(out.size) > 0) {
        let size = Number(out.size) * (s.textSize || 1);
        if (s.maxSize && size > s.maxSize) { size = s.maxSize; capped = true; }
        out.size = Math.round(size * 10000) / 10000;
    }
    if (s.lineSpacing) out.lineSpacing = s.lineSpacing;
    return { design: out, capped };
}

// What apply() sends to Fusion for each detected node (the main-process twin of SABoxes.payload).
// sizing: { textSize: multiplier on each Text+ node's own size, maxSize: Size cap, lineSpacing: Line Spacing } (see sizedDesign).
function boxListFor(a, nodes, text, parts, font, sizing) {
    if (!nodes.length || nodes[0].nested) return [];
    const lines = String(text || '').split(/\r?\n/);
    const mt = nodes.some(n => n.kind === 'multitext') ? mtTexts(nodes, parts) : {};
    const primary = (nodes.find(n => n.primary) || nodes.find(n => n.kind === 'textplus')) || null;
    const boxes = (a.boxes && typeof a.boxes === 'object') ? a.boxes : {};
    return nodes.map((n, i) => {
        const b = boxes[n.id] || { mode: i === 0 ? 'sub' : 'keep' };
        let t = null;
        if (n.kind === 'multitext') t = (n.layer in mt) ? mt[n.layer] : null;
        else if (b.mode === 'sub') t = text;
        else if (b.mode === 'l1') t = lines[0] || '';
        else if (b.mode === 'l2') t = lines[1] || '';
        else if (b.mode === 'l3') t = lines[2] || '';
        else if (b.mode === 'custom') t = b.text || '';
        let design = null;
        if (n.kind === 'textplus' && primary && n.id !== primary.id) {
            const own = b.design || n.design || null;
            if (own || font) design = Object.assign({}, own || {}, font ? { font: font.font, style: font.style } : {});
            if (design) design = sizedDesign(design, sizing).design;
        }
        const out = {
            id: n.id, kind: n.kind, tool: n.tool, input: n.input, centerInput: n.centerInput, label: n.label,
            text: t, cx: null, cy: null, size: null, design
        };
        if (n.kind === 'multitext' && font) { out.font = font.font; out.style = font.style; }
        return out;
    });
}

// ------------------------------------------------------------------ Resolve helpers

async function currentTimeline() {
    const project = await getProject();
    if (!project) throw new Error('Open a project in Resolve');
    const tl = await project.GetCurrentTimeline();
    if (!tl) throw new Error('Open a timeline in Resolve');
    return { project, tl, meta: await timelineMeta(tl, project) };
}

async function subtitleAt(tl, n) {
    const subs = await getSubtitles(tl, true);
    const s = subs.find(x => x.index === Number(n));
    if (!s) throw new Error('No subtitle #' + n + ' (the timeline has ' + subs.length + ')');
    return s;
}

async function findItem(tl, kind, id) {
    const n = (await tl.GetTrackCount(kind)) || 0;
    for (let t = 1; t <= n; t++) {
        for (const it of ((await tl.GetItemListInTrack(kind, t)) || [])) {
            try { if (String(await it.GetUniqueId()) === String(id)) return it; } catch (e) { /* ignore */ }
        }
    }
    return null;
}

async function waitFree(ms) {
    const until = Date.now() + ms;
    while (state.applying && Date.now() < until) await new Promise(r => setTimeout(r, 150));
    if (state.applying) throw new Error('The panel is busy placing a clip. Try again in a moment.');
    if (state.liveSession) throw new Error('A "Preview in Resolve" is running in the panel. Apply or cancel it first.');
}

// ------------------------------------------------------------------ tools

const TOOLS = {
    async status() {
        const { tl, meta } = await currentTimeline();
        const subs = await getSubtitles(tl, true);
        return {
            timeline: await tl.GetName(), fps: meta.fps, width: meta.width, height: meta.height,
            videoTracks: await tl.GetTrackCount('video'), subtitles: subs.length,
            panelBusy: !!state.applying, previewRunning: !!state.liveSession,
            rulesFile: RULES_FILE, rules: loadRules(), placedThisSession: placed.length
        };
    },

    async get_rules() { return Object.assign({ file: RULES_FILE }, loadRules()); },

    async set_rules(args) {
        const cur = loadRules();
        const next = Object.assign({}, cur, args || {});
        for (const k of ['track', 'position', 'multitext', 'text']) if (args && args[k]) next[k] = Object.assign({}, cur[k], args[k]);
        if (args && args.font === null) next.font = null;
        const saved = saveRules(next);
        const { unknown } = resolveTags(loadLib(), saved.allowedTags);
        return Object.assign({ saved: true }, saved, unknown.length ? { warning: 'No tag matches: ' + unknown.join(', ') } : {});
    },

    async reset_rules() { return Object.assign({ reset: true }, saveRules(defaultRules())); },

    async list_tags() {
        const lib = loadLib();
        return (lib.tags || []).map(t => ({
            id: t.id, emoji: t.emoji || null, name: t.name,
            presets: lib.animations.filter(a => (a.tags || []).includes(t.id)).length
        }));
    },

    // Presets, filtered by tags. With no tags given, the rules' allowed tags apply (all: true lists everything).
    async list_presets(args) {
        args = args || {};
        const lib = loadLib();
        const rules = loadRules();
        const tokens = Array.isArray(args.tags) ? args.tags : (args.all ? [] : rules.allowedTags);
        const match = args.match || (Array.isArray(args.tags) ? 'any' : rules.tagMatch);
        const { ids, unknown } = resolveTags(lib, tokens);
        if (tokens.length && !ids.length) throw new Error('No tag matches ' + tokens.join(', ') + '. Use list_tags to see them.');
        const out = lib.animations.filter(a => passes(a, ids, match)).map(a => presetInfo(lib, a));
        return { filter: tokens.length ? { tags: tokens, match } : 'all presets', unknownTags: unknown, presets: out };
    },

    async list_subtitles(args) {
        args = args || {};
        const { tl, meta } = await currentTimeline();
        const subs = await getSubtitles(tl, true);
        const from = Math.max(1, Number(args.from) || 1);
        const to = Math.min(subs.length, Number(args.to) || subs.length);
        const done = new Map(placed.map(p => [p.subtitle, p]));
        return {
            fps: meta.fps, total: subs.length,
            subtitles: subs.filter(s => s.index >= from && s.index <= to).map(s => ({
                index: s.index, text: s.text, start: s.start, end: s.end, frames: s.duration,
                tc: frameToTC(s.start, meta), words: String(s.text || '').split(/\s+/).filter(Boolean).length,
                placed: done.has(s.index) ? done.get(s.index).preset : undefined
            }))
        };
    },

    // The composited timeline frame (what the viewer shows), so faces and busy areas can be avoided.
    async get_frame(args) {
        args = args || {};
        const { tl, meta } = await currentTimeline();
        let frame = Number(args.frame);
        if (!Number.isFinite(frame)) {
            if (!args.subtitle) throw new Error('Give a subtitle number or a frame');
            const s = await subtitleAt(tl, args.subtitle);
            const at = args.at === 'start' ? 0 : (args.at === 'end' ? 0.9 : 0.5);
            frame = Math.round(s.start + (s.end - s.start) * at);
        }
        const maxDim = Math.max(256, Math.min(1280, Number(args.maxSize) || 768));
        const r = await bridgeCall('live_frame', { frame, maxDim }, 20000);
        if (!r || !r.data) throw new Error('Resolve did not return a frame');
        return {
            image: r.data, mime: 'image/jpeg',
            note: 'Frame ' + frame + ' (' + frameToTC(frame, meta) + '), timeline ' + meta.width + 'x' + meta.height
                + '. Positions are x, y from 0 to 1 with 0,0 at the top-left.'
        };
    },

    // Video layers and what sits on them over a subtitle (or a frame range).
    async get_tracks(args) {
        args = args || {};
        const { tl } = await currentTimeline();
        let s = Number(args.start), e = Number(args.end);
        if (args.subtitle) { const sub = await subtitleAt(tl, args.subtitle); s = sub.start; e = sub.end; }
        const n = (await tl.GetTrackCount('video')) || 0;
        const out = [];
        for (let t = 1; t <= n; t++) {
            const row = { track: 'V' + t, name: await tl.GetTrackName('video', t) };
            try { row.locked = !!(await tl.GetIsTrackLocked('video', t)); } catch (err) { /* ignore */ }
            try { row.enabled = (await tl.GetIsTrackEnabled('video', t)) !== false; } catch (err) { /* ignore */ }
            if (Number.isFinite(s) && Number.isFinite(e)) {
                row.clips = [];
                for (const it of ((await tl.GetItemListInTrack('video', t)) || [])) {
                    const a = await it.GetStart(), b = await it.GetEnd();
                    if (a < e && b > s) row.clips.push({ name: await it.GetName(), start: a, end: b });
                }
            }
            out.push(row);
        }
        return { range: Number.isFinite(s) ? { start: s, end: e } : null, tracks: out.reverse() };
    },

    // Places one preset on one subtitle, with the rules enforced.
    async place(args) {
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

        // font
        const font = rules.font || null;
        let textDesign = parseTextStyle(fs.existsSync(compPath) ? compPath : null, a.textDesign) || null;
        if (font) textDesign = Object.assign({}, textDesign || {}, { font: font.font }, font.style ? { style: font.style } : {});

        // text size: a multiplier on the preset's own Text+ Size, so long lines can be shrunk to fit the frame
        // (Edit-page scale zooms the whole rendered clip instead and can push the text out of frame)
        // maxSize / lineSpacing: this call's values, else the rules' (Inspector values; null = the preset's own)
        let textSize = Number(args.textSize);
        if (!Number.isFinite(textSize) || textSize <= 0) textSize = 1;
        textSize = Math.max(0.2, Math.min(3, textSize));
        const pick = (v, def, lo, hi) => { const n = Number(v); return (v !== undefined && v !== null && Number.isFinite(n) && n > 0) ? Math.max(lo, Math.min(hi, n)) : def; };
        const sizing = {
            textSize,
            maxSize: pick(args.maxSize, rules.text.maxSize, 0.01, 1),
            lineSpacing: pick(args.lineSpacing, rules.text.lineSpacing, 0.3, 3)
        };
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

        // position: x / y are where the text's centre goes (0..1, top-left origin), kept inside the safe area
        const P = rules.position;
        let x = Number(args.x), y = Number(args.y);
        const zone = args.zone || P.defaultZone;
        if (!Number.isFinite(y) && zone && ZONES[zone] !== undefined) y = ZONES[zone];
        let posX = Number(a.posX) || 0, posY = Number(a.posY) || 0;
        if (Number.isFinite(x) || Number.isFinite(y)) {
            const ref = nodes.filter(n => !n.nested);
            const cx = ref.length ? ref.reduce((s, n) => s + (n.cx || 0.5), 0) / ref.length : 0.5;
            const cy = ref.length ? ref.reduce((s, n) => s + (n.cy || 0.5), 0) / ref.length : 0.5;      // Fusion: y up
            if (!Number.isFinite(x)) x = cx;
            if (!Number.isFinite(y)) y = 1 - cy;
            const cx2 = Math.max(P.safeLeft, Math.min(P.safeRight, x));
            const cy2 = Math.max(P.safeTop, Math.min(P.safeBottom, y));
            if (cx2 !== x || cy2 !== y) notes.push('position kept inside the safe area');
            posX = Math.round((cx2 - cx) * meta.width);
            posY = Math.round(((1 - cy2) - cy) * meta.height);
            if (Math.abs(posX) <= 1) posX = 0;      // apply() reads |v| <= 1 as an old-style ratio
            if (Math.abs(posY) <= 1) posY = 0;
        }

        // video layer
        let textTrack = 0;
        const place = { firstEmpty: rules.track.mode === 'first-empty' };
        if (args.track) textTrack = Math.max(2, Math.round(Number(String(args.track).replace(/^v/i, ''))) || 0);
        else if (rules.track.mode === 'fixed' && rules.track.fixed) textTrack = rules.track.fixed;

        const req = {
            animationId: a.id, text, start: sub.start, end: sub.end,
            textOffset: a.textOffset || 0, sfxOffset: a.sfxOffset || 0, sfxVolume: a.sfxVolume, tail: a.tail || 0,
            textTrack, sfxTrack: a.sfxTrack || 0, place,
            useSfx: rules.sound && args.sound !== false && a.useSfx !== false,
            linked: a.linked !== false,
            posX, posY, scale: Number(args.scale) || Number(a.scale) || 1, rotation: Number(a.rotation) || 0,
            textDesign,
            boxList: boxListFor(a, nodes, text, parts, font, sizing),
            // the bridge sizes every MultiText layer together (sizes, boxes and the gaps between layers)
            multitext: (isMT && (textSize !== 1 || sizing.maxSize || sizing.lineSpacing)) ? sizing : null,
            keepPresetDefaults: true      // automated positions are not saved into the preset
        };
        if (args.dryRun) return { dryRun: true, preset: a.name, subtitle: sub.index, text, parts, request: Object.assign({}, req, { boxList: req.boxList.length + ' text layers' }), notes };

        state.lastPlacedAudioId = null;
        const res = await apply(null, req);
        if (!res || !res.ok) throw new Error((res && res.error) || 'Placement failed');
        const rec = { itemId: res.itemId, audioId: state.lastPlacedAudioId, subtitle: sub.index, presetId: a.id, preset: a.name, track: 'V' + res.videoTrack };
        placed.push(rec);
        dlog('[automation] placed', a.name, 'on subtitle', sub.index, 'V' + res.videoTrack);
        return {
            placed: true, itemId: res.itemId, preset: a.name, subtitle: sub.index, text, parts: parts || undefined,
            videoTrack: 'V' + res.videoTrack, audioTrack: res.audioTrack ? 'A' + res.audioTrack : null,
            start: res.start, frames: res.frames, position: { posX, posY },
            notes: notes.concat(res.trackNotes || []), warnings: res.warnings || []
        };
    },

    async list_placed() { return placed.slice(); },

    // Removes a clip placed through automation (and its main sound).
    async remove_placed(args) {
        const id = String((args && args.itemId) || '');
        const i = placed.findIndex(p => p.itemId === id);
        if (i < 0) throw new Error('Only clips placed through automation this session can be removed (see list_placed).');
        await waitFree(10000);
        const { tl } = await currentTimeline();
        const rec = placed[i];
        const items = [await findItem(tl, 'video', rec.itemId), rec.audioId ? await findItem(tl, 'audio', rec.audioId) : null].filter(Boolean);
        if (!items.length) { placed.splice(i, 1); return { removed: false, note: 'The clip is no longer on the timeline.' }; }
        const ok = await tl.DeleteClips(items, false);
        if (ok) placed.splice(i, 1);
        return { removed: !!ok, subtitle: rec.subtitle, preset: rec.preset };
    }
};

// ------------------------------------------------------------------ HTTP server

function send(res, code, body) {
    const s = JSON.stringify(body);
    res.writeHead(code, { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(s) });
    res.end(s);
}

function handle(req, res) {
    // Only local scripts with the token: no browser page (Origin) and no other host name (DNS rebinding).
    const host = String(req.headers.host || '');
    if (req.headers.origin || !/^(127\.0\.0\.1|localhost)(:\d+)?$/.test(host)) return send(res, 403, { ok: false, error: 'forbidden' });
    const got = String(req.headers['x-sa-token'] || '');
    if (!token || got.length !== token.length || !crypto.timingSafeEqual(Buffer.from(got), Buffer.from(token))) return send(res, 401, { ok: false, error: 'bad token' });
    if (req.method !== 'POST' || req.url !== '/call') return send(res, 404, { ok: false, error: 'not found' });
    let raw = '';
    req.on('data', (c) => { raw += c; if (raw.length > 1e6) req.destroy(); });
    req.on('end', async () => {
        let body;
        try { body = JSON.parse(raw || '{}'); } catch (e) { return send(res, 400, { ok: false, error: 'bad JSON' }); }
        const fn = TOOLS[body.tool];
        if (!fn) return send(res, 404, { ok: false, error: 'unknown tool ' + body.tool });
        try {
            send(res, 200, { ok: true, result: await fn(body.args || {}) });
        } catch (e) {
            send(res, 200, { ok: false, error: String(e && e.message || e) });
        }
    });
}

function startAutomation() {
    if (server) return;
    token = crypto.randomBytes(24).toString('hex');
    server = http.createServer(handle);
    server.on('error', (e) => dlog('[automation] server error', String(e && e.message || e)));
    server.listen(0, '127.0.0.1', () => {
        const { port } = server.address();
        try {
            fs.mkdirSync(ENDPOINT_DIR, { recursive: true, mode: 0o700 });
            fs.writeFileSync(ENDPOINT_FILE, JSON.stringify({ port, token, pid: process.pid, started: new Date().toISOString() }), { mode: 0o600 });
            fs.chmodSync(ENDPOINT_FILE, 0o600);
        } catch (e) { dlog('[automation] could not write endpoint', String(e && e.message || e)); }
        dlog('[automation] listening on 127.0.0.1:' + port);
    });
    server.unref();
}

function stopAutomation() {
    try { if (server) server.close(); } catch (e) { /* ignore */ }
    server = null;
    try {
        const cur = JSON.parse(fs.readFileSync(ENDPOINT_FILE, 'utf8'));
        if (cur && cur.pid === process.pid) fs.unlinkSync(ENDPOINT_FILE);
    } catch (e) { /* ignore */ }
}
