// Automation for Claude (or any MCP client): a small HTTP server on 127.0.0.1 that the MCP script in mcp/el-sa-mcp.js
// talks to. Every placement goes through apply() (title templates, never a comp swap), with the editing rules from
// edit-rules.json (edit-rules.js) enforced here: allowed tags, a forced font, the video layer policy, the safe area
// and MultiText splits.
// The address and a random token are written to ~/.el-subtitle-animator/mcp-endpoint.json (readable by this user only).

module.exports = {
    startAutomation, stopAutomation,
    adjustHighlights: (args) => TOOLS.adjust_highlights(args),    // the panel's Prompt tab (ipc 'highlight:adjust')
    swapAudioIds: (from, to) => swapAudioIds(from, to)    // per-row sounds placed again after a timing change (anim-timing.js): remove_placed still finds them (auto-session.js)
};

const fs = require('fs');
const http = require('http');
const os = require('os');
const path = require('path');
const crypto = require('crypto');

const state = require('./state');
const { DATA_DIR } = require('./config');
const { bridgeCall } = require('./fusion-bridge');
const { settleNow } = require('./settle');
const { loadLib } = require('./library');
const { dlog } = require('./log');
const {
    RULES_FILE, cleanHighlight, cleanRows, defaultRules, loadRules, rowsReq, saveRules
} = require('./edit-rules');
const { findItemsByIds, frameToTC, getSubtitles, setSubtitlesEnabled } = require('./resolve');
const PERF = require('./perf');
const LAYOUT = require('./layout');
const STACK = require('./stack');
const REPAIR = require('./repair');
const { regroup } = require('./regroup');
const CUTTOOLS = require('./cut-tools');
const MEDIA = require('./media-analysis');
const { layoutFor, passes, presetInfo, resolveTags } = require('./auto-plan');
const { place: placeTool } = require('./auto-place');
const { checkToolArgs } = require('./tool-schemas');
const { currentTimeline, placed, subtitleAt, swapAudioIds, waitFree } = require('./auto-session');

const ENDPOINT_DIR = path.join(os.homedir(), '.el-subtitle-animator');
const ENDPOINT_FILE = path.join(ENDPOINT_DIR, 'mcp-endpoint.json');
const LAYOUT_DIR = path.join(DATA_DIR, 'layouts');

let server = null;
let token = null;

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
    // B-roll tab (broll.js): Remotion overlays rendered at the timeline's size and frame rate, placed on a free video
    // track. Renders take a few seconds each; a batch waits up to `wait` seconds, then keeps going in the background.
    list_broll(args) {
        const B = require('./broll');
        if (args && args.placed) return B.brollList(null, args);
        return B.brollEffects();
    },
    async broll_preview(args) {
        const B = require('./broll');
        const r = await B.brollPreview(null, { ...(args || {}), props: B.brollVibeProps((args || {}).vibe, (args || {}).props), dataUrl: false });
        return { path: r.path, width: r.width, height: r.height, effect: r.effect, props: r.props, note: 'Look at the PNG at `path` (it has a transparent background).' };
    },
    async place_broll(args) {
        args = args || {};
        const B = require('./broll');
        await waitFree(20000);
        // vibe: the look of this placement (or of every item that has none of its own)
        if (!Array.isArray(args.items)) return B.brollPlace(null, { ...args, props: B.brollVibeProps(args.vibe, args.props) });
        const run = B.brollPlaceMany(null, args.items.map(it => ({ ...it, props: B.brollVibeProps(it && it.vibe !== undefined ? it.vibe : args.vibe, it && it.props) })));
        const waitMs = Math.max(0, Math.min(170, Number.isFinite(Number(args.wait)) ? Number(args.wait) : 150)) * 1000;
        const r = await Promise.race([run, new Promise(res => setTimeout(() => res(null), waitMs))]);
        if (r) return { results: r };
        return { running: true, status: B.brollStatus(), note: 'Still rendering in the background. Call list_broll { placed: true } to see what is placed.' };
    },
    async adjust_broll(args) {
        args = args || {};
        const B = require('./broll');
        await waitFree(20000);
        const o = { ...args, props: B.brollVibeProps(args.vibe, args.props) };
        if (args.all) return B.brollRestyle(null, o);
        if (!args.id) throw new Error('adjust_broll: id is required (or all: true to change every B-roll on this timeline)');
        return B.brollAdjust(null, o);
    },
    remove_broll(args) { return require('./broll').brollRemove(null, args || {}); },
    async finalize_broll(args) { await waitFree(20000); return require('./broll').brollFinalize(null, args || {}); },
    async sync_broll(args) { await waitFree(20000); return require('./broll').brollSync(null, args || {}); },
    suggest_broll(args) { return require('./broll').brollSuggest(null, args || {}); },
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

    place: (args) => placeTool(args),        // auto-place.js

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
            const { tl } = await currentTimeline();
            const sub = tl ? await subtitleAt(tl, args.subtitle) : null;
            if (!sub) throw new Error(`Subtitle not found: ${args.subtitle}`);
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
        const bad = checkToolArgs(body.tool, body.args || {});        // tool-schemas.js, the MCP script's own schemas
        if (bad) return send(res, 200, { ok: false, error: bad });
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
