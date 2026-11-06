// Connection to DaVinci Resolve, timeline metadata, timecode <-> frame conversion, subtitle track reading
// and timeline item lookups by id.

module.exports = {
    frameToTC, getProject, getSubtitles, listSubtitles, tcToFrame, timelineMeta
};

const WorkflowIntegration = require('./workflow-integration');

const state = require('./state');
const { PLUGIN_ID } = require('./config');

// ------------------------------------------------------------------ Resolve connection

async function getResolve() {
    if (state.resolveObj) return state.resolveObj;
    const ok = await WorkflowIntegration.Initialize(PLUGIN_ID);
    if (!ok) throw new Error('Could not connect to DaVinci Resolve (is this Resolve Studio?)');
    state.resolveObj = await WorkflowIntegration.GetResolve();
    if (!state.resolveObj) throw new Error('Could not get the Resolve object');
    state.hasSeenResolve = true;
    return state.resolveObj;
}

async function getProject() {
    const resolve = await getResolve();
    const pm = await resolve.GetProjectManager();
    return pm ? await pm.GetCurrentProject() : null;
}

// ------------------------------------------------------------------ timecode <-> frames
const pad = (n) => String(n).padStart(2, '0');

async function timelineMeta(tl, proj) {
    const [rate, dfs, w, h] = await Promise.all([
        tl.GetSetting('timelineFrameRate'), tl.GetSetting('timelineDropFrameTimecode'),
        tl.GetSetting('timelineResolutionWidth'), tl.GetSetting('timelineResolutionHeight')
    ]);
    const fps = parseFloat(rate) || 25;
    const df = String(dfs) === '1';
    let width = parseInt(w, 10);
    let height = parseInt(h, 10);
    if (!width || !height) {
        if (!proj) {
            try { proj = await getProject(); } catch (e) { /* ignore */ }
        }
        if (proj) {
            if (!width) {
                const pw = await proj.GetSetting('timelineResolutionWidth');
                width = parseInt(pw, 10);
            }
            if (!height) {
                const ph = await proj.GetSetting('timelineResolutionHeight');
                height = parseInt(ph, 10);
            }
        }
    }
    width = width || 1920;
    height = height || 1080;
    return { fps, nominal: Math.round(fps), df, width, height };
}

function tcToFrame(tc, meta) {
    const [h, m, s, f] = String(tc).split(/[:;]/).map(Number);
    const n = meta.nominal;
    let total = ((h * 60 + m) * 60 + s) * n + f;
    if (meta.df) {
        const drop = n <= 30 ? 2 : 4;
        const tm = h * 60 + m;
        total -= drop * (tm - Math.floor(tm / 10));
    }
    return total;
}

function frameToTC(frame, meta) {
    const n = meta.nominal;
    let f = Math.max(0, Math.round(frame));
    if (meta.df) {
        const drop = n <= 30 ? 2 : 4;
        const per10 = n * 600 - drop * 9;
        const perMin = n * 60 - drop;
        const d = Math.floor(f / per10);
        const m = f % per10;
        f += drop * 9 * d + (m > drop ? drop * Math.floor((m - drop) / perMin) : 0);
    }
    const ff = f % n;
    const ss = Math.floor(f / n) % 60;
    const mm = Math.floor(f / (n * 60)) % 60;
    const hh = Math.floor(f / (n * 3600));
    return pad(hh) + ':' + pad(mm) + ':' + pad(ss) + (meta.df ? ';' : ':') + pad(ff);
}

// ------------------------------------------------------------------ subtitles

async function getSubtitles(tl, force) {
    const key = await tl.GetName();
    if (!force && state.subCache.key === key && Date.now() - state.subCache.at < 2000) return state.subCache.list;
    const list = [];
    const tracks = (await tl.GetTrackCount('subtitle')) || 0;
    for (let t = 1; t <= tracks; t++) {
        const items = (await tl.GetItemListInTrack('subtitle', t)) || [];
        for (const it of items) {
            const start = await it.GetStart();
            const end = await it.GetEnd();
            let duration = (typeof it.GetDuration === 'function') ? await it.GetDuration() : 0;
            if (!duration || duration <= 0) duration = Math.max(1, end - start);
            list.push({ text: await it.GetName(), start, end, duration, track: t });
        }
    }
    list.sort((a, b) => a.start - b.start);
    list.forEach((item, i) => { item.index = i + 1; });
    state.subCache = { key, at: Date.now(), list };
    return list;
}

// The panel's subtitle list for the current timeline.
async function listSubtitles(event, force) {
    try {
        const project = await getProject();
        if (!project) return { ok: false, error: 'Open a project in Resolve' };
        const tl = await project.GetCurrentTimeline();
        if (!tl) return { ok: false, error: 'Open a timeline in Resolve' };
        const subs = await getSubtitles(tl, !!force);
        return { ok: true, subtitles: subs };
    } catch (err) {
        return { ok: false, error: String(err && err.message || err) };
    }
}
