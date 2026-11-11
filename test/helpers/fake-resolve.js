// A small in-memory stand-in for the parts of the Resolve scripting API the plugin reads and writes:
// Resolve > ProjectManager > Project > Timeline > TimelineItem. Like the real API, a failing call returns null / false
// instead of throwing, and every object counts the calls made to it (`calls`), so a test can check how many round
// trips a function costs.

let nextId = 1;

function counted(obj) {
    obj.calls = {};
    for (const key of Object.keys(obj)) {
        const fn = obj[key];
        if (typeof fn !== 'function') continue;
        obj[key] = function (...args) { obj.calls[key] = (obj.calls[key] || 0) + 1; return fn.apply(obj, args); };
    }
    return obj;
}

// o: { name, start, end, enabled, id, rightOffset }
function makeItem(o) {
    const it = {
        name: o.name || '', start: o.start, end: o.end, enabled: o.enabled !== false,
        id: String(o.id || 'item-' + (nextId++)), rightOffset: o.rightOffset || 0, properties: {}
    };
    return counted(Object.assign(it, {
        GetName: () => it.name,
        GetStart: () => it.start,
        GetEnd: () => it.end,
        GetDuration: () => it.end - it.start,
        GetUniqueId: () => it.id,
        GetClipEnabled: () => it.enabled,
        SetClipEnabled: (v) => { it.enabled = !!v; return true; },
        GetClipColor: () => '',
        GetRightOffset: () => it.rightOffset,
        SetRightOffset: (v) => { it.end += it.rightOffset - v; it.rightOffset = v; return true; },
        SetProperties: (p) => { Object.assign(it.properties, p); return true; }
    }));
}

// tracks: { video: [[item, ...], ...], audio: [...], subtitle: [...] } (track 1 first). A track can also be given as
// { items: [...], locked: true, enabled: false }.
function makeTimeline(o) {
    o = o || {};
    const tl = { name: o.name || 'Timeline 1', settings: Object.assign({ timelineFrameRate: '25', timelineDropFrameTimecode: '0', timelineResolutionWidth: '1920', timelineResolutionHeight: '1080' }, o.settings || {}), startFrame: o.startFrame || 0, tracks: {} };
    for (const kind of ['video', 'audio', 'subtitle']) {
        tl.tracks[kind] = ((o.tracks && o.tracks[kind]) || []).map(t => Array.isArray(t) ? { items: t.map(makeItem), locked: false, enabled: true } : { items: (t.items || []).map(makeItem), locked: !!t.locked, enabled: t.enabled !== false });
    }
    const track = (kind, t) => (tl.tracks[kind] || [])[t - 1] || null;
    return counted(Object.assign(tl, {
        GetName: () => tl.name,
        GetStartFrame: () => tl.startFrame,
        GetSetting: (key) => (key in tl.settings ? tl.settings[key] : ''),
        GetTrackCount: (kind) => (tl.tracks[kind] || []).length,
        GetItemListInTrack: (kind, t) => { const tr = track(kind, t); return tr ? tr.items.slice() : null; },      // null for a track that does not exist, as Resolve does
        GetIsTrackLocked: (kind, t) => { const tr = track(kind, t); return tr ? tr.locked : false; },
        GetIsTrackEnabled: (kind, t) => { const tr = track(kind, t); return tr ? tr.enabled : false; },
        AddTrack: (kind) => { (tl.tracks[kind] = tl.tracks[kind] || []).push({ items: [], locked: false, enabled: true }); return true; }
    }));
}

function makeProject(o) {
    o = o || {};
    const project = { name: o.name || 'Project 1', timeline: o.timeline === undefined ? makeTimeline() : o.timeline, settings: o.settings || {} };
    return counted(Object.assign(project, {
        GetName: () => project.name,
        GetCurrentTimeline: () => project.timeline,
        GetSetting: (key) => (key in project.settings ? project.settings[key] : '')
    }));
}

// o: { project } (project null = no project open)
function makeResolve(o) {
    o = o || {};
    const project = o.project === undefined ? makeProject() : o.project;
    const pm = counted({ GetCurrentProject: () => project });
    return counted({ project, pm, GetProjectManager: () => pm });
}

module.exports = { makeItem, makeTimeline, makeProject, makeResolve };
