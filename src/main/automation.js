// Automation for Claude (or any MCP client): a small HTTP server on 127.0.0.1 that the MCP script in mcp/el-sa-mcp.js
// talks to. Every placement goes through apply() (title templates, never a comp swap), with the editing rules from
// edit-rules.json (edit-rules.js) enforced here: allowed tags, a forced font, the video layer policy, the safe area
// and MultiText splits.
// The address and a random token are written to ~/.el-subtitle-animator/mcp-endpoint.json (readable by this user only).

module.exports = {
    startAutomation, stopAutomation,
    adjustHighlights: (args) => TOOLS.adjust_highlights(args),    // the panel's Prompt tab (ipc 'highlight:adjust')
    swapAudioIds        // per-row sounds placed again after a timing change (anim-timing.js): remove_placed still finds them
};

const fs = require('fs');
const http = require('http');
const os = require('os');
const path = require('path');
const crypto = require('crypto');

const state = require('./state');
const { ANIM_DIR, DATA_DIR } = require('./config');
const { apply } = require('./apply');
const { presetSfxName } = require('./sfx');
const { bridgeCall } = require('./fusion-bridge');
const { settleNow } = require('./settle');
const { nodesWithDesign, parseTextStyle } = require('./fusion-setting');
const { loadLib } = require('./library');
const { dlog } = require('./log');
const {
    RULES_FILE, ZONES, cleanHighlight, cleanRows, defaultRules, highlightReq, loadRules, rowsReq, saveRules, takeShare, withFillColor, withGradientFill
} = require('./edit-rules');
const { findItemsByIds, frameToTC, getProject, getSubtitles, setSubtitlesEnabled, timelineMeta } = require('./resolve');
const PERF = require('./perf');
const LAYOUT = require('./layout');
const STACK = require('./stack');
const REPAIR = require('./repair');
const { regroup } = require('./regroup');
const CUTTOOLS = require('./cut-tools');
const MEDIA = require('./media-analysis');

const ENDPOINT_DIR = path.join(os.homedir(), '.el-subtitle-animator');
const ENDPOINT_FILE = path.join(ENDPOINT_DIR, 'mcp-endpoint.json');
const LAYOUT_DIR = path.join(DATA_DIR, 'layouts');

let server = null;
let token = null;
const placed = [];      // clips placed through automation this session: { itemId, audioId, extraAudioIds, subtitle, presetId, preset, track }
function swapAudioIds(from, to) {
    for (const rec of placed) {
        const ids = rec.extraAudioIds || [];
        if (!ids.some(id => from.includes(id))) continue;
        rec.extraAudioIds = ids.filter(id => !from.includes(id)).concat(to);
    }
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
    if ((t.emoji + ' ' + t.name).toLowerCase() === k.toLowerCase()) return true;      // the panel's label, "🔥 Danger"
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
        sound: a.useSfx === false ? null : (presetSfxName(a) || lib.defaultSfx || null),
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
// look: the rules' forced { font, color, emphasis } (null = the preset's own design).
function boxListFor(a, nodes, text, parts, look, sizing) {
    if (!nodes.length || nodes[0].nested) return [];
    const L = look || {};
    const font = L.font || null;
    const lines = String(text || '').split(/\r?\n/);
    const isMT = nodes.some(n => n.kind === 'multitext');
    const mt = isMT ? mtTexts(nodes, parts) : {};
    const emLayer = isMT ? autoRoles(nodes.filter(n => n.kind === 'multitext')).emphasis : null;
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
            if (own || font || L.color) design = Object.assign({}, own || {}, font ? { font: font.font, style: font.style } : {});
            const grad = design && L.gradient ? withGradientFill(design, L.gradient, L.gradientColor) : null;
            if (grad) design = grad;
            else if (design && L.color) design = withFillColor(design, L.color);
            if (design) design = sizedDesign(design, sizing).design;
        }
        const out = {
            id: n.id, kind: n.kind, tool: n.tool, input: n.input, centerInput: n.centerInput, label: n.label,
            text: t, cx: null, cy: null, size: null, design
        };
        if (n.kind === 'multitext') {
            const em = (L.emphasis && n.layer === emLayer) ? L.emphasis : null;
            const f = (em && em.font) ? { font: em.font, style: em.style } : ((em && em.keepFont) ? null : font);
            if (f) { out.font = f.font; out.style = f.style; }
            // the emphasis colour is the highlight's background (box / pill behind the word) and the word keeps the
            // normal text colour; presets without a box get it on the word itself (fusion_bridge.set_highlight_bg)
            const c = ((em && em.keepColor) ? null : L.color) || null;
            if (c) out.color = c;
            if (em && em.color) out.bgColor = em.color;
        }
        return out;
    });
}

// The layout only applies to timelines of its own shape (a 9:16 social safe zone is not used on a 16:9 edit).
function layoutFor(layout, meta) {
    if (!layout || !meta || !meta.width || !meta.height) return layout || null;
    return Math.abs(meta.width / meta.height - layout.aspect) <= 0.02 ? layout : null;
}

// The text lines as they will render ({ text, size } top to bottom), for the layout fit. null = sizes unknown.
function estimateLines(nodes, isMT, text, parts, textDesign, textSize, maxSize) {
    if (isMT) {
        const layers = nodes.filter(n => n.kind === 'multitext' && !n.nested);
        if (!layers.length) return null;
        const texts = mtTexts(nodes, parts);
        const biggest = Math.max(...layers.map(n => Number(n.size) || 0.08)) * textSize;
        const k = maxSize && biggest > maxSize ? maxSize / biggest : 1;
        return layers.slice().sort((p, q) => (q.cy || 0) - (p.cy || 0))
            .filter(n => texts[n.layer])
            .flatMap(n => String(texts[n.layer]).split(/\r?\n/).map(t => ({ text: t, size: (Number(n.size) || 0.08) * textSize * k })));
    }
    const base = Number(textDesign && textDesign.size);
    if (!(base > 0)) return null;
    let size = base * textSize;
    if (maxSize && size > maxSize) size = maxSize;
    return String(text).split(/\r?\n/).map(t => ({ text: t, size }));
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
    const subs = await getSubtitles(tl, false);
    const s = subs.find(x => x.index === Number(n));
    if (!s) throw new Error('No subtitle #' + n + ' (the timeline has ' + subs.length + ')');
    return s;
}

async function waitFree(ms) {
    const until = Date.now() + ms;
    while (state.applying && Date.now() < until) await new Promise(r => setTimeout(r, 150));
    if (state.applying) throw new Error('The panel is busy placing a clip. Try again in a moment.');
    if (state.liveSession) throw new Error('A "Preview in Resolve" is running in the panel. Apply or cancel it first.');
}

// ------------------------------------------------------------------ tools

const TOOLS = {
    // News-article match cut of one word (match-cut.js), placed at the playhead. A run takes 1-4 minutes: this waits
    // up to `wait` seconds (default 150, under the MCP client's 180 s), then returns { running } - call again with
    // status: true to read the progress and the result.
    async match_cut(args) {
        args = args || {};
        const MC = require('./match-cut');
        if (args.status) return MC.matchCutStatus();
        if (args.cancel) return { cancelled: MC.matchCutCancel() };
        const j = await MC.matchCutStart(args);
        const waitMs = Math.max(0, Math.min(170, Number.isFinite(Number(args.wait)) ? Number(args.wait) : 150)) * 1000;
        const r = await Promise.race([j.promise, new Promise(res => setTimeout(() => res(null), waitMs))]);
        if (r) { if (!r.ok) throw new Error(r.error); return r; }
        return { running: true, progress: MC.matchCutStatus().progress, note: 'Still rendering. Call match_cut with status: true for the result.' };
    },
    // Cut tab (auto-cut.js): analyse the source track (nothing changes), then build: true makes the new "(cut)"
    // timeline. Omitted options use the Cut tab's last values.
    async auto_cut(args) {
        args = args || {};
        const C = require('./auto-cut');
        if (args.status) return C.cutStatus();
        if (args.cancel) return { cancelled: C.cutCancel() };
        await waitFree(20000);
        const opts = { ...args };
        delete opts.build;
        if (!args.build || args.reanalyse !== false) {
            const sum = await C.cutAnalyze(null, opts);
            if (sum && sum.needsEngine) throw new Error('The Cut engine (numpy) is not installed: open the Cut tab in the panel and press Install');
            if (!args.build) return { ...sum, note: 'Nothing changed yet. Call auto_cut with build: true (and ignore: [drop ids to keep]) to make the cut timeline.' };
        }
        return C.cutBuild(null, opts);
    },
    async status(args) {
        const { tl, meta } = await currentTimeline();
        const subs = await getSubtitles(tl, !!(args && args.refresh));
        const out = {
            timeline: await tl.GetName(), fps: meta.fps, width: meta.width, height: meta.height,
            videoTracks: await tl.GetTrackCount('video'), subtitles: subs.length,
            panelBusy: !!state.applying, previewRunning: !!state.liveSession,
            rulesFile: RULES_FILE, rules: loadRules(), placedThisSession: placed.length
        };
        if (PERF.perfEnabled()) out.perf = PERF.perfSummary(15);
        return out;
    },

    // Performance measuring (src/main/perf.js): { enable, reset, top, settings: { promiseApi, renderProcess, sampleRenderer } }.
    async perf(args) {
        const a = args || {};
        const patch = {};
        if (typeof a.enable === 'boolean') patch.enabled = a.enable;
        if (a.settings && typeof a.settings === 'object') Object.assign(patch, a.settings);
        if (Object.keys(patch).length) PERF.setPerf(patch);
        if (a.reset) PERF.perfReset();
        return PERF.perfSummary(Number(a.top) || 40);
    },

    // Blank-render check for the clips placed this session (or the given ids): the comp's output is rendered at two
    // frames (40% in and 2 before the end) and counted blank when nothing is drawn. Used to judge the wake settings.
    async verify_placed(args) {
        await waitFree(10000);
        await settleNow();
        const ids = Array.isArray(args && args.itemIds) && args.itemIds.length ? args.itemIds.map(String) : placed.map(p => p.itemId);
        const { tl } = await currentTimeline();
        const found = await findItemsByIds(tl, ids, 'video');
        const out = [];
        for (const id of ids) {
            const it = found.get(id);
            if (!it) { out.push({ itemId: id, error: 'not on the timeline' }); continue; }
            const dur = Number(await it.GetDuration()) || 0;
            const frames = [Math.max(0, Math.round(dur * 0.4)), Math.max(0, dur - 2)];
            const r = { itemId: id, name: await it.GetName(), frames: [] };
            for (const f of frames) {
                try { r.frames.push(Object.assign({ frame: f }, await bridgeCall('probe_render', { item: id, comp: null, frame: f }, 30000))); }
                catch (e) { r.frames.push({ frame: f, error: e.message }); }
            }
            r.blank = r.frames.some(x => x.nonEmpty === false);
            if (r.frames.some(x => x.skipped)) r.skipped = r.frames.find(x => x.skipped).skipped;
            out.push(r);
        }
        const checked = out.filter(x => !x.error && !x.skipped);
        const res = { total: ids.length, checked: checked.length, skipped: out.filter(x => x.skipped).length, blank: checked.filter(x => x.blank).length, clips: out };
        if (args && args.content) {     // also the composited frames through ffmpeg: black tails, static entrances
            const rc = await CUTTOOLS.checkRender({ itemIds: ids, step: args.step });
            res.content = { problems: rc.problems, clips: rc.clips.map(c => ({ itemId: c.itemId, name: c.name, ok: c.ok, flags: c.flags, error: c.error })) };
        }
        return res;
    },

    // Black or frozen frames in placed clips (or a frame range): Resolve's composited frames measured by ffmpeg.
    async check_render(args) { await waitFree(10000); await settleNow(); return CUTTOOLS.checkRender(args || {}); },

    // The media under a frame range (for the MCP script's own ffmpeg work): file, track and source mapping per clip.
    async timeline_media(args) { return CUTTOOLS.timelineMedia(args || {}); },

    async get_rules() { return Object.assign({ file: RULES_FILE }, loadRules()); },

    async set_rules(args) {
        const cur = loadRules();
        const next = Object.assign({}, cur, args || {});
        for (const k of ['track', 'position', 'multitext', 'text', 'highlight', 'rows']) if (args && args[k]) next[k] = Object.assign({}, cur[k], args[k]);
        if (args && args.font === null) next.font = null;
        if (args && args.emphasis && cur.emphasis) next.emphasis = Object.assign({}, cur.emphasis, args.emphasis);
        if (args && args.styleShare) next.styleShare = Object.assign({}, cur.styleShare, args.styleShare);
        if (args && args.kindStyle) next.kindStyle = Object.assign({}, cur.kindStyle, args.kindStyle);
        if (args && args.gradient) next.gradient = Object.assign({}, cur.gradient, args.gradient);
        if (args && args.styleExcept) next.styleExcept = Object.assign({}, cur.styleExcept, args.styleExcept);
        const saved = saveRules(next);
        const { unknown } = resolveTags(loadLib(), saved.allowedTags);
        return Object.assign({ saved: true }, saved, unknown.length ? { warning: 'No tag matches: ' + unknown.join(', ') } : {});
    },

    async get_layout() {
        const rules = loadRules();
        if (!rules.layout) return { layout: null, note: 'No layout. Give set_layout a reference PNG (transparent or white = safe area, black = off-limits, dashed lines = guides, boxes = zones).' };
        let frame = null;
        try { frame = (await currentTimeline()).meta; } catch (e) { /* no timeline: skip the aspect check */ }
        return Object.assign(LAYOUT.layoutSummary(rules.layout, frame), { fit: rules.layout.fit, appliesToThisTimeline: frame ? !!layoutFor(rules.layout, frame) : null });
    },

    // Reads a reference image into the rules' layout. Without image: renames / re-reads the current one. image: null clears it.
    async set_layout(args) {
        args = args || {};
        const rules = loadRules();
        if (args.image === null || args.clear) { rules.layout = null; saveRules(rules); return { cleared: true }; }
        if (args.image === 'default') {
            const def = LAYOUT.defaultLayout();
            if (!def) throw new Error('The built-in layout is missing from the plugin (src/main/layouts)');
            def.fit = Object.assign({}, args.fit || {});
            rules.layout = def;
            const saved = saveRules(rules).layout;
            return Object.assign({ saved: true, builtin: true, fit: saved.fit }, LAYOUT.layoutSummary(saved, null));
        }
        const platform = args.image ? LAYOUT.platformLayout(args.image) : null;
        if (platform) {     // "tiktok" / "reels" / "shorts": the app's own UI zones (layouts/<name>-9x16.json)
            platform.fit = Object.assign({}, args.fit || {});
            rules.layout = platform;
            const saved = saveRules(rules).layout;
            return Object.assign({ saved: true, builtin: true, platform: saved.platform, fit: saved.fit }, LAYOUT.layoutSummary(saved, null));
        }
        const cur = rules.layout;
        let src = args.image ? String(args.image).replace(/^~(?=\/)/, os.homedir()) : (cur && cur.source);
        if (!src) throw new Error('Give the path of the reference image (PNG)');
        if (!fs.existsSync(src)) throw new Error('No file at ' + src);
        if (args.image) {      // keep a copy next to the library so the layout survives the original being moved
            fs.mkdirSync(LAYOUT_DIR, { recursive: true });
            const dst = path.join(LAYOUT_DIR, path.basename(src));
            if (path.resolve(dst) !== path.resolve(src)) fs.copyFileSync(src, dst);
            src = dst;
        }
        const keep = (k) => (args[k] !== undefined ? args[k] : (!args.image && cur ? cur[k] : undefined));
        const opts = { guideNames: keep('guideNames'), verticalNames: keep('verticalNames'), zoneNames: keep('zoneNames') };
        const layout = LAYOUT.analyzeLayout(src, opts);
        Object.assign(layout, opts);
        layout.fit = Object.assign({}, (cur && cur.fit) || {}, args.fit || {});
        rules.layout = layout;
        const saved = saveRules(rules).layout;
        let frame = null;
        try { frame = (await currentTimeline()).meta; } catch (e) { /* no timeline */ }
        const sum = LAYOUT.layoutSummary(saved, frame);
        if (!saved.guides.length) sum.note = 'No guide lines found. Guides are dark lines (solid or dashed) across most of the safe width.';
        return Object.assign({ saved: true, fit: saved.fit }, sum);
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
        const subs = await getSubtitles(tl, !!(args && args.refresh));
        const from = Math.max(1, Number(args.from) || 1);
        const to = Math.min(subs.length, Number(args.to) || subs.length);
        const done = new Map(placed.map(p => [p.subtitle, p]));
        const want = String(args.color || '').trim().toLowerCase();
        const colorOk = s => !want || (want === 'any' ? !!s.color : String(s.color || '').toLowerCase() === want);
        const colors = {};
        subs.forEach(s => { if (s.color) colors[s.color] = (colors[s.color] || 0) + 1; });
        return {
            fps: meta.fps, total: subs.length, clipColors: colors,
            clipColorsFrom: subs.some(s => s.colorFrom) ? 'saved project file (Resolve\'s API returns no subtitle colours): save the project in Resolve to pick up colour changes' : undefined,
            active: subs.filter(s => s.enabled !== false).length,
            subtitles: subs.filter(s => s.index >= from && s.index <= to && colorOk(s) && (!args.activeOnly || s.enabled !== false)).map(s => ({
                index: s.index, text: s.text, start: s.start, end: s.end, frames: s.duration, enabled: s.enabled !== false,
                tc: frameToTC(s.start, meta), words: String(s.text || '').split(/\s+/).filter(Boolean).length,
                color: s.color || undefined,
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
        await settleNow();      // wakes still owed to freshly placed titles, so the grab shows the real render
        const r = await bridgeCall('live_frame', { frame, maxDim }, 20000);
        if (!r || !r.data) throw new Error('Resolve did not return a frame');
        const layout = layoutFor(loadRules().layout, meta);
        let image = r.data, drawn = false;
        if (layout && args.overlay !== false) {
            try { const o = LAYOUT.overlayFrame(r.data, layout); if (o) { image = o; drawn = true; } } catch (e) { dlog('[automation] overlay failed', e && e.message); }
        }
        return {
            image, mime: 'image/jpeg',
            note: 'Frame ' + frame + ' (' + frameToTC(frame, meta) + '), timeline ' + meta.width + 'x' + meta.height
                + '. Positions are x, y from 0 to 1 with 0,0 at the top-left.'
                + (drawn ? ' Layout drawn: red = outside the safe area, cyan lines = guides (' + layout.guides.map(g => g.name).join(', ')
                    + '), yellow boxes = zones (' + layout.zones.map(z => z.name).join(', ') + '). Text should sit fully outside the red and off the yellow boxes.' : '')
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
    },

    // Consecutive subtitles re-split into phrases by thought, each timed from its own words (see regroup.js).
    async regroup(args) {
        args = args || {};
        const { tl, meta } = await currentTimeline();
        const subs = await getSubtitles(tl, false);
        const want = (Array.isArray(args.subtitles) ? args.subtitles : []).map(Number);
        if (!want.length) throw new Error('Give the subtitle numbers to regroup');
        const picked = want.map(n => { const s = subs.find(x => x.index === n); if (!s) throw new Error('No subtitle #' + n); return s; });
        for (let i = 1; i < picked.length; i++) if (picked[i].index !== picked[i - 1].index + 1) throw new Error('The subtitles must be consecutive');
        let snap = null;
        if (args.snap !== false) {      // cuts between phrases onto the real pauses (and word gaps when transcribed)
            try {
                const media = await CUTTOOLS.timelineMedia({ startFrame: picked[0].start, endFrame: picked[picked.length - 1].end });
                const r = await MEDIA.analyseTimeline('pauses', media, { audioTrack: args.audioTrack });
                const seg = MEDIA.pickSegments('pauses', media, { audioTrack: args.audioTrack })[0];
                let words = null;
                if (seg) {
                    const m = MEDIA.sourceMapper(seg);
                    const w = MEDIA.cachedWords(seg.file, m.toFile(media.from), m.toFile(media.to));
                    if (w) words = w.map(x => ({ start: m.toFrame(x.start), end: m.toFrame(x.end) }));
                }
                snap = { pauses: r.pauses, words, maxShift: Math.round(meta.fps * 0.35) };
            } catch (e) { snap = { error: e.message }; }
        }
        const out = regroup(picked, args.phrases, snap && !snap.error ? snap : null);
        return {
            subtitles: picked.map(s => ({ index: s.index, text: s.text, start: s.start, end: s.end })),
            phrases: out.map(p => Object.assign(p, { tc: frameToTC(p.startFrame, meta) })),
            snap: snap ? (snap.error ? { error: snap.error } : { pauses: snap.pauses.length, wordTimings: !!snap.words, phrasesAdjusted: out.filter(p => p.snapped).length }) : null,
            next: 'Place each phrase with place: subtitle, text, startFrame and endFrame from here.'
        };
    },

    async list_placed() { return placed.slice(); },

    // Size / font / style / line spacing of placed clips, as the Inspector has them. One clip at a time through the
    // helper, which never reads a text input: an ad-hoc script doing GetInput("StyledText") over several comps has
    // frozen Resolve more than once (a follower-driven Text+ deadlocks the main thread).
    async inspect_placed(args) {
        args = args || {};
        await waitFree(10000);
        let ids = Array.isArray(args.itemIds) && args.itemIds.length ? args.itemIds.map(String) : null;
        if (!ids && Array.isArray(args.subtitles) && args.subtitles.length) {
            const want = new Set(args.subtitles.map(Number));
            ids = placed.filter(p => want.has(p.subtitle)).map(p => p.itemId);
        }
        if (!ids) ids = placed.map(p => p.itemId);
        ids = ids.slice(-40);
        const out = [];
        for (const id of ids) {
            const p = placed.find(x => x.itemId === id);
            const row = { itemId: id, subtitle: p ? p.subtitle : undefined, preset: p ? p.preset : undefined };
            try { row.tools = ((await bridgeCall('read_style', { item: id, comp: null }, 8000)) || {}).tools || []; }
            catch (e) { row.error = e.message; }
            out.push(row);
        }
        return { clips: out };
    },

    // Re-applies the highlight box values to every highlight clip already on the current timeline (or the given
    // itemIds / frame range): the panel's "Apply to placed" button and the adjust_highlights MCP tool.
    async adjust_highlights(args) {
        args = args || {};
        await waitFree(10000);
        const rules = loadRules();
        const h = cleanHighlight(Object.assign({}, rules.highlight, (args.highlight && typeof args.highlight === 'object') ? args.highlight : {}));
        if (args.save) saveRules(Object.assign({}, rules, { highlight: h }));
        const { tl } = await currentTimeline();
        const ids = Array.isArray(args.itemIds) && args.itemIds.length ? new Set(args.itemIds.map(String)) : null;
        const from = Number.isFinite(Number(args.fromFrame)) ? Number(args.fromFrame) : -Infinity;
        const to = Number.isFinite(Number(args.toFrame)) ? Number(args.toFrame) : Infinity;
        const out = [];
        state.applying = true;
        try {
            const nTracks = await tl.GetTrackCount('video');
            for (let t = 1; t <= nTracks; t++) {
                for (const it of (await tl.GetItemListInTrack('video', t)) || []) {
                    const id = String(await it.GetUniqueId());
                    if (ids && !ids.has(id)) continue;
                    const st = await it.GetStart();
                    if (st < from || st > to) continue;
                    if (!ids && !/multitext|highlight|pill|marker|underline/i.test(String(await it.GetName()))) continue;
                    let n = 0;
                    try { n = await it.GetFusionCompCount(); } catch (e) { n = 0; }
                    if (!n) continue;
                    try {
                        const r = await bridgeCall('highlight_box', Object.assign({ item: id }, h), 30000);
                        const hs = (r && r.highlights) || [];
                        if (hs.length) out.push({ itemId: id, track: 'V' + t, start: st, name: await it.GetName(), highlights: hs });
                    } catch (e) { out.push({ itemId: id, track: 'V' + t, start: st, error: e.message }); }
                }
            }
        } finally { state.applying = false; }
        return { values: h, saved: !!args.save, clips: out.length, results: out };
    },

    // The MultiText Row controls (gap / justify / link / per-row x y) on clips already on the timeline (all MultiText
    // clips, or itemIds / a frame range). save: true also stores gap / justify in the rules.
    async adjust_rows(args) {
        args = args || {};
        await waitFree(10000);
        const rules = loadRules();
        const req = rowsReq(rules.rows, args.rows) || {};
        if (args.save) saveRules(Object.assign({}, rules, { rows: cleanRows(Object.assign({}, rules.rows, args.rows || {})) }));
        const { tl } = await currentTimeline();
        const ids = Array.isArray(args.itemIds) && args.itemIds.length ? new Set(args.itemIds.map(String)) : null;
        const from = Number.isFinite(Number(args.fromFrame)) ? Number(args.fromFrame) : -Infinity;
        const to = Number.isFinite(Number(args.toFrame)) ? Number(args.toFrame) : Infinity;
        const out = [];
        state.applying = true;
        try {
            const nTracks = await tl.GetTrackCount('video');
            for (let t = 1; t <= nTracks; t++) {
                for (const it of (await tl.GetItemListInTrack('video', t)) || []) {
                    const id = String(await it.GetUniqueId());
                    if (ids && !ids.has(id)) continue;
                    const st = await it.GetStart();
                    if (st < from || st > to) continue;
                    let n = 0;
                    try { n = await it.GetFusionCompCount(); } catch (e) { n = 0; }
                    if (!n) continue;
                    try {
                        const r = await bridgeCall('multitext_rows', Object.assign({ item: id }, req), 30000);
                        if (r && r.hasControls) out.push({ itemId: id, track: 'V' + t, start: st, name: await it.GetName(), rows: r });
                    } catch (e) { if (ids) out.push({ itemId: id, track: 'V' + t, start: st, error: e.message }); }
                }
            }
        } finally { state.applying = false; }
        return { values: req, saved: !!args.save, clips: out.length, results: out };
    },

    // Clips with an empty Inspector (a preset imported onto a plain "Text+" / "MultiText") are rebuilt as title-template
    // clips with everything copied over (src/main/repair.js).
    async repair_inspector(args) { await waitFree(10000); return REPAIR.repairInspector(args || {}); },

    // The real rendered geometry of some lines (one temporary clip, measured from the frame, removed again).
    async measure_text(args) { return STACK.measureText(TOOLS, args); },

    // A group of consecutive subtitles as a stack, spaced from the real rendered text (see stack.js).
    async place_stack(args) { return STACK.placeStack(TOOLS, args); },

    // Big word behind the speaker (spotlight.js): make one for a subtitle / frame range, change or remove a placed one.
    async spotlight(args) {
        args = args || {};
        await waitFree(10000);
        const SP = require('./spotlight');
        const keys = Object.keys(SP.DEFAULTS);
        const settings = {};
        for (const k of keys) if (args[k] !== undefined) settings[k] = args[k];
        if (args.itemId) {
            if (args.remove) return await SP.spotRemove(null, args.itemId);
            return await SP.spotSet(null, args.itemId, settings);
        }
        let from = args.startFrame, to = args.endFrame;
        if ((from === undefined || to === undefined) && args.subtitle) {
            const sub = await subtitleAt(await currentTimeline(), args.subtitle);
            from = sub.start; to = sub.end - 1;
        }
        if (!Number.isFinite(Number(from)) || !Number.isFinite(Number(to))) throw new Error('Pass subtitle, or startFrame and endFrame');
        const r = await SP.spotRun(null, { from: Math.round(Number(from)), to: Math.round(Number(to)), frame: Math.round(Number(from)), settings });
        if (r && r.needInstall) throw new Error('The matting engine is not installed yet: open the panel, Use tab > Effect Preset > Spotlight > Install matting engine');
        return r;
    },

    // used by stack.js (not callable over HTTP: handle() only dispatches names without an underscore prefix)
    _timeline: currentTimeline,
    _subtitle: subtitleAt,

    // Removes a clip placed through automation with its main sound and every layered / per-row sound copy. The clips
    // are found by unique id, so they are removed wherever they were dragged to since.
    async remove_placed(args) {
        const id = String((args && args.itemId) || '');
        const i = placed.findIndex(p => p.itemId === id);
        if (i < 0) throw new Error('Only clips placed through automation this session can be removed (see list_placed).');
        await waitFree(10000);
        const { tl } = await currentTimeline();
        const rec = placed[i];
        const audioIds = [rec.audioId, ...(rec.extraAudioIds || [])].filter(Boolean);
        const vids = await findItemsByIds(tl, [rec.itemId], 'video');
        let auds = await findItemsByIds(tl, audioIds, 'audio');
        const found = [vids.get(rec.itemId), ...audioIds.map(id => auds.get(id))].filter(Boolean);
        // a Glass Blur caption's frost (ELSA Glass effects on the footage under it) goes with it
        let glassRemoved = 0;
        try { glassRemoved = ((await bridgeCall('glass_remove', { item: rec.itemId }, 15000)) || {}).removed || 0; } catch (e) { /* none */ }
        if (!found.length) { placed.splice(i, 1); return { removed: false, note: 'The clip is no longer on the timeline.', glassRemoved }; }
        let ok = await tl.DeleteClips(found, false);
        // a copy that survived the batch delete (Resolve sometimes skips linked clips) is deleted on its own
        try {
            auds = await findItemsByIds(tl, audioIds, 'audio');
            for (const aid of audioIds) { const it = auds.get(aid); if (it) ok = (await tl.DeleteClips([it], false)) && ok; }
        } catch (e) { /* ignore */ }
        const soundsRemoved = found.length - 1;
        if (ok) placed.splice(i, 1);
        // the subtitle clips this placement turned off come back on, unless another placed clip still covers them
        let restored = 0;
        if (ok) {
            const key = (s) => s.track + ':' + s.start;
            const still = new Set(placed.flatMap(p => (p.subtitlesDisabled || []).map(key)));
            for (const s of (rec.subtitlesDisabled || [])) {
                if (still.has(key(s))) continue;
                try { restored += (await setSubtitlesEnabled(tl, { start: s.start, end: s.end, track: s.track }, true)).length; } catch (e) { /* ignore */ }
            }
        }
        return { removed: !!ok, subtitle: rec.subtitle, preset: rec.preset, soundClipsRemoved: soundsRemoved, subtitleClipsReEnabled: restored, glassRemoved: glassRemoved || undefined };
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
        const fn = /^[a-z]/.test(String(body.tool || '')) ? TOOLS[body.tool] : null;      // _helpers are internal
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
            fs.writeFileSync(ENDPOINT_FILE, JSON.stringify({ port, token, pid: process.pid, dataDir: DATA_DIR, started: new Date().toISOString() }), { mode: 0o600 });
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
