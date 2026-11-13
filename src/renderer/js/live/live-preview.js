// "Preview in Resolve": keeping the real Text+ on the timeline in step with the panel.

// ---- Preview in Resolve: the real Text+ is on the timeline; the panel keeps it in step with Alignment / Text Design.
// consume: the clip is being placed for good (liveFinish), so it counts for the Text Style override share.
function liveReq(m, a, text, consume) {
    const p = state.livePrev;
    return textStyleApplyReq({
        animationId: a.id, text, start: p.start, end: p.end,
        textOffset: m.textOffset, sfxOffset: m.sfxOffset, sfxVolume: m.sfxVolume, tail: m.tail,
        textTrack: m.textTrack, sfxTrack: m.sfxTrack, useSfx: m.useSfx !== false, place: placeOptions(),
        linked: m.linked !== false,
        sfxPath: (p.sfxClip && p.sfxClip.sfxPath) || undefined, sfxCut: (p.sfxClip && p.sfxClip.sfxCut) || undefined,
        posX: Number(m.posX) || 0, posY: Number(m.posY) || 0,
        scale: Number(m.scale) || 1, rotation: Number(m.rotation) || 0,
        textDesign: m.textDesign || a.textDesign || null,
        sfxLayers: Array.isArray(m.sfxLayers) ? m.sfxLayers : undefined,
        boxList: window.SABoxes ? SABoxes.payload(m, a, text) : []
    }, a, !!consume);
}
function setLiveUI(on) {
    state.liveUI = !!on;
    if ($('adjustWrapU')) $('adjustWrapU').classList.remove('live-locked');
    setAdjustOpen(state.adjustOpen);
    refreshLiveBar();
}
// Labels of the Preview bar: it stays on screen after Apply and only "Remove preview" brings the player back.
function refreshLiveBar() {
    const bar = $('stageLiveU'); if (!bar) return;
    const btn = $('liveApplyU');
    const remBtn = $('liveRemoveU');
    const isLiveActive = !!(state.livePrev && state.livePrev.hasClip && !state.livePrev.removed);
    if (btn) {
        btn.textContent = isLiveActive ? 'Apply' : 'Start';
        btn.title = isLiveActive ? 'Apply this caption and advance straight to the next caption' : 'Start timeline preview for the selected text preset';
    }
    if (remBtn) {
        remBtn.textContent = 'Remove';
        remBtn.title = isLiveActive ? 'Stop preview and remove this preview clip from the timeline' : 'Remove';
        remBtn.classList.toggle('hidden', !isLiveActive);
    }
    const title = bar.querySelector('.stage-live-txt b');
    if (title) title.textContent = isLiveActive ? 'Previewing on Timeline' : 'Timeline Preview';
}
function exitLiveSession() {
    state.liveApplied = false;
    state.livePrev = null;
    setLiveUI(false);
    refreshLiveBar();
    liveCard('Previews and plays directly on DaVinci Resolve\'s timeline at the playhead.');
}
function liveCard(msg) {
    const s = document.querySelector('#stageLiveU .stage-live-txt span');
    if (s) s.textContent = msg;
}
// The sound for one caption: { sfxPath, sfxCut } cut to THAT caption's length (Estimate) or to the fixed length, with
// its fade, like Add to timeline. Remembered per caption length and sound settings, so moving between captions stays quick.
const liveSfxCache = new Map();
async function liveSfxFor(m, start, end) {
    if (!m || m.useSfx === false) return null;
    const span = { base: start, dur: Math.max(1, end - start) };
    const key = [origSfxPath(m) || currentSfxPath(m), span.dur, m.sfxTrimIn, m.sfxLen, sfxLenMode(m), m.sfxFade, m.textOffset, m.sfxOffset, m.tail, fpsNow()].join('|');
    if (liveSfxCache.has(key)) return liveSfxCache.get(key);
    let out = null;
    try { out = await buildFadedSfx(m, span); } catch (e) { out = null; }
    if (out) liveSfxCache.set(key, out);
    return out;
}
// The preview clip was deleted: return to start
function markRemoved(p) {
    state.livePrev = null;
    state.liveApplied = false;
    setLiveUI(false);
    liveCard('Previews and plays directly on DaVinci Resolve\'s timeline at the playhead.');
    setStatus('Preview clip removed.', '');
    refreshLiveBar();
}
async function previewAgain() {
    const p = state.livePrev, L = state.live, a = p ? libEntry(p.animId) : selected();
    if (!p || p.busy || state.busy) return;
    if (!L || !L.ok) { setStatus('Resolve is not reachable right now.', 'bad'); return; }
    p.removed = false;
    const curFrame = typeof L.frame === 'number' ? L.frame : 0;
    const s = (L.subtitle && curFrame >= L.subtitle.start && curFrame < L.subtitle.end) ? L.subtitle : null;
    const start = s ? s.start : curFrame;
    const dur = s ? Math.max(1, s.end - s.start) : Math.round((L.fps || 25) * 3);
    const end = start + dur;
    const defaultText = String(($('subText') && $('subText').value.trim()) || (s && s.text) || p.text || (a && a.sample) || 'Sample text').trim();
    await addLiveClip({ start, end, text: defaultText }, true);
    refreshLiveBar();
}
// The subtitle list is no longer sent with every poll (it was 20-60 KB five times a second); the poll carries a version
// number (subsVersion) and the list is asked for (app:subtitles) when that number changes.
const subsCache = { version: null, timeline: null, list: [] };
async function getAllSubtitles(force) {
    const L = state.live;
    if (!force && L && L.ok && subsCache.list.length && subsCache.version === L.subsVersion && subsCache.timeline === L.timeline) return subsCache.list;
    try {
        if (window.sa && window.sa.subtitles) {
            const res = await window.sa.subtitles(!!force);
            if (res && res.ok && Array.isArray(res.subtitles) && res.subtitles.length) {
                subsCache.version = res.version || (L && L.subsVersion) || null;
                subsCache.timeline = L && L.timeline;
                subsCache.list = res.subtitles;
                return res.subtitles;
            }
        }
    } catch (e) { }
    if (!force && subsCache.list.length) return subsCache.list;
    return [];
}

function findNextSubtitle(subs, curStart, curEnd) {
    if (!subs || !subs.length) return null;
    // the next ACTIVE subtitle: disabled ones (already animated, or a muted subtitle track) are skipped, and the list
    // is sorted by time (several subtitle tracks are listed track by track, so index + 1 is not "next")
    const after = subs.filter(s => s && s.enabled !== false && s.start > curStart).sort((x, y) => x.start - y.start);
    if (!after.length) return null;
    return after.find(s => s.start >= (curEnd - 2)) || after[0];
}

// Puts the preview clip on the timeline ({start, end, text}).
async function addLiveClip(sub, keepPlayhead) {
    const p = state.livePrev, a = libEntry(p.animId), m = state.use;
    if (!p || !a || !m) return;
    p.busy = true;
    p.start = sub.start; p.end = sub.end; p.subStart = sub.start;
    const txt = String(sub.text || ($('subText') && $('subText').value.trim()) || (a && a.sample) || 'Sample text').trim();
    p.text = txt;
    setStatus('Putting the Text+ on the timeline…');
    p.sfxClip = await liveSfxFor(m, sub.start, sub.end);
    const req = liveReq(m, a, p.text);
    const sentKey = JSON.stringify(req);
    const res = await window.sa.apply(Object.assign(req, { live: true, keepPlayhead: !!keepPlayhead }));
    p.busy = false;
    if (p.cancelled) {                                 // Remove was clicked while this clip was going in: take it off again
        if (res && res.ok) { try { await window.sa.liveRemove(); } catch (e) { /* ignore */ } }
        return;
    }
    if (state.livePrev !== p) return;                  // this preview was ended / replaced meanwhile
    if (res && res.ok) {
        p.hasClip = true;
        p.clipS = res.start; p.clipE = res.start + res.frames;
        p.key = sentKey;
        liveCard('The Text+ and sound are on the timeline. Click Apply to continue to next caption, or Remove to stop.');
        setStatus('Previewing in Resolve · V' + res.videoTrack, 'ok');
        state.liveBg.key = '';
    } else {
        p.hasClip = false; p.key = '';
        state.livePrev = null;
        setLiveUI(false);
        liveCard('Previews and plays directly on DaVinci Resolve\'s timeline at the playhead.');
        setStatus((res && res.error) || 'Could not put the preview on the timeline', 'bad');
    }
    refreshLiveBar();
}
async function switchLivePreset(a) {
    const p = state.livePrev, m = state.use;
    if (!p || !a || !m || p.busy || state.busy) return;
    p.busy = true;
    // let a running "is the clip still there" check finish first (it would otherwise look at a clip being replaced)
    for (let i = 0; i < 40 && p.checking; i++) await new Promise(r => setTimeout(r, 50));
    if (state.livePrev !== p) return;
    p.animId = a.id;
    // The old preview clip is taken off by main's apply, right before the new one goes in (one step, shortest gap).
    // It cannot be kept: a preset is a title template of its own, and a clip's comp cannot be swapped without
    // emptying Resolve's Inspector.
    p.hasClip = false;
    p.key = '';
    p.removed = false;
    refreshLiveBar();
    const L = state.live;
    const curFrame = (L && typeof L.frame === 'number') ? L.frame : (p.start || 0);
    const s = (L && L.ok && L.subtitle && curFrame >= L.subtitle.start && curFrame < L.subtitle.end) ? L.subtitle : null;
    const start = s ? s.start : curFrame;
    const dur = s ? Math.max(1, s.end - s.start) : (p.end && p.start ? (p.end - p.start) : Math.round(((L && L.fps) || 25) * 3));
    const end = start + dur;
    const text = String(($('subText') && $('subText').value.trim()) || (s && s.text) || p.text || (a && a.sample) || 'Sample text').trim();
    p.sfxClip = await liveSfxFor(m, start, end);
    p.busy = false;
    await addLiveClip({ start, end, text }, true);
    refreshLiveBar();
}
async function startLivePreview() {
    const a = selected(), m = state.use;
    if (!a || !m) {
        setStatus('Pick a text preset first.', 'bad');
        return;
    }
    if (state.busy) return;

    let L = state.live;
    try {
        const fresh = await window.sa.poll(false);
        if (fresh && fresh.ok) { state.live = fresh; L = fresh; }
    } catch (e) { }

    if (!L || !L.ok) {
        setStatus('Resolve is not connected. Open a project and timeline in Resolve.', 'bad');
        return;
    }

    if (state.livePrev && state.livePrev.hasClip && !state.livePrev.removed) {
        if (state.livePrev.animId !== a.id) {
            await switchLivePreset(a);
        }
        return;
    }

    state.liveApplied = false;
    state.livePrev = null;

    // Wherever the playhead is right now on the timeline:
    const curFrame = typeof L.frame === 'number' ? L.frame : 0;
    const s = (L.subtitle && curFrame >= L.subtitle.start && curFrame < L.subtitle.end) ? L.subtitle : null;
    const start = s ? s.start : curFrame;
    const dur = s ? Math.max(1, s.end - s.start) : Math.round((L.fps || 25) * 3);
    const end = start + dur;
    const defaultText = String(($('subText') && $('subText').value.trim()) || (s && s.text) || (a && a.sample) || 'Sample text').trim();

    state.livePrev = { animId: a.id, hasClip: false, busy: false, key: '', start, end, subStart: s ? s.start : null, text: defaultText, clipS: start, clipE: end };
    setLiveUI(true);
    liveCard('Putting the Text+ on the timeline…');
    const btn = $('liveApplyU');
    if (btn) btn.textContent = 'Generating…';
    try { window.sa.liveLoopOn(placeOptions().loopOn).catch(() => { }); } catch (e) { }

    await addLiveClip({ start, end, text: defaultText }, true);
    refreshLiveBar();
}
async function endLivePreview(keep) {
    const p = state.livePrev;
    if (!keep && p && p.busy) {
        // Remove while the preview is still being placed / updated: the clip lands after this click, so the session
        // is cancelled (addLiveClip removes its clip when it comes back) and main deletes whatever is there once idle.
        p.cancelled = true;
        exitLiveSession();
        try { window.sa.liveLoopRestore(); } catch (e) { /* ignore */ }
        setStatus('Removing the preview…');
        try { await window.sa.liveRemove(); } catch (e) { /* ignore */ }
        setStatus('Preview stopped and removed.', 'ok');
        return;
    }
    if (!p || p.busy) {
        exitLiveSession();
        return;
    }
    p.busy = true;
    const a = libEntry(p.animId) || selected(), m = state.use;
    let res = { ok: true };
    if (keep) {
        if (!p.hasClip) { p.busy = false; setStatus('There is no preview clip right now.', 'bad'); return; }
        state.busy = true; setStatus('Applying…');
        let sfxClip = null;
        try { sfxClip = await buildFadedSfx(m); } catch (e) { sfxClip = null; }
        res = await window.sa.liveFinish(Object.assign(liveReq(m, a, p.text, true), {
            sfxPath: (sfxClip && sfxClip.sfxPath) || undefined, sfxCut: (sfxClip && sfxClip.sfxCut) || undefined
        }));
        state.busy = false;
        if (p.cancelled) return;                       // Remove was clicked during Apply: do not go on to the next caption
    } else {
        // always: main also sweeps temporary clips the panel no longer knows about (hasClip can be false mid-switch)
        try { await window.sa.liveRemove(); } catch (e) { /* ignore */ }
    }
    if (keep && res && !res.ok && !res.gone) { p.busy = false; setStatus((res && res.error) || 'Could not apply', 'bad'); return; }

    // If Remove was clicked: stop preview session, delete clip, and return to Start
    if (!keep) {
        state.livePrev = null;
        state.liveApplied = false;
        setLiveUI(false);
        try { window.sa.liveLoopRestore(); } catch (e) { /* ignore */ }
        if (state.use) { state.use.renderReq = null; }
        state.liveBg.key = '';
        refreshLiveBg();
        liveCard('Previews and plays directly on DaVinci Resolve\'s timeline at the playhead.');
        setStatus('Preview stopped and removed.', 'ok');
        try { const r = await window.sa.getLib(); if (r && r.lib) { state.lib = r.lib; syncUse(false); renderAll(); } } catch (e) { /* ignore */ }
        redrawStages();
        refreshLiveBar();
        return;
    }

    // Apply was clicked: detect next caption and jump there to continue!
    const curStart = p.start;
    const curEnd = p.end;
    const subs = await getAllSubtitles(true);
    const nextSub = findNextSubtitle(subs, curStart, curEnd);

    if (nextSub) {
        // Jump playhead straight to next caption. main refuses a seek while it is still placing (state.applying),
        // so it is retried; the preview insert below also puts the playhead on the caption (keepPlayhead false).
        for (let i = 0; i < 12; i++) {
            let ok = false;
            try { ok = await window.sa.seek(nextSub.start); } catch (e) { ok = false; }
            if (ok) break;
            await new Promise(r => setTimeout(r, 150));
        }

        // Update UI text input if present
        if ($('subText') && nextSub.text) {
            $('subText').value = nextSub.text;
        }

        const nextText = String(nextSub.text || (a && a.sample) || 'Sample text').trim();
        p.start = nextSub.start;
        p.end = nextSub.end;
        p.subStart = nextSub.start;
        p.text = nextText;
        p.clipS = nextSub.start;
        p.clipE = nextSub.end;
        p.hasClip = false;
        p.key = '';
        p.busy = false;

        const capNum = nextSub.index ? `${nextSub.index}/${subs.length}` : 'next';
        liveCard(`Applied. Previewing caption (${capNum})…`);
        setStatus(`Applied · Jumped to next caption (${capNum})`, 'ok');

        // Immediately execute preview clip on this next caption!
        await addLiveClip({ start: nextSub.start, end: nextSub.end, text: nextText }, false);
        refreshLiveBar();
        return;
    }

    // Reached the end of captions or no more captions ahead:
    state.livePrev = null;
    state.liveApplied = false;
    setLiveUI(false);
    parkAfterPlace();
    try { window.sa.liveLoopRestore(); } catch (e) { /* ignore */ }
    if (state.use) { state.use.renderReq = null; }
    state.liveBg.key = '';
    refreshLiveBg();
    liveCard('Previews and plays directly on DaVinci Resolve\'s timeline at the playhead.');
    const parts = ['Applied on V' + res.videoTrack, res.frames + ' frames'];
    if (res.audioTrack) parts.push('sound on A' + res.audioTrack + (res.linked ? ' (linked)' : ''));
    parts.push('Reached last caption');
    setStatus(parts.join(' · ') + ' · ok', 'ok');
    try { const r = await window.sa.getLib(); if (r && r.lib) { state.lib = r.lib; syncUse(false); renderAll(); } } catch (e) { /* ignore */ }
    redrawStages();
    refreshLiveBar();
}
// Resolve has no "is playing" call, so playback is recognised by the playhead moving forward at about real-time
// speed on consecutive polls (a scrub or a jump does not look like that). While the timeline plays, Preview in
// Resolve ends at once: inserting clips would interrupt playback.
const playWatch = { f: null, t: 0, hits: 0, still: 0, playing: false, graceUntil: 0 };
// How long an edit in the panel has to rest before the preview clip is updated. Every update makes Resolve re-render
// the clip's whole comp, so pushing each keystroke (typing in the MultiText inputs changes the request every time)
// made Resolve lag while typing.
const LIVE_EDIT_REST_MS = 600;
function watchPlayback(L) {
    const p = state.livePrev;
    if (!p || p.busy || state.busy || !L || !L.ok || typeof L.frame !== 'number') { playWatch.f = null; playWatch.hits = 0; playWatch.playing = false; return; }
    const now = performance.now();
    if (playWatch.f !== null) {
        const dt = (now - playWatch.t) / 1000, df = L.frame - playWatch.f;
        const fps = L.fps || 25;
        const rate = dt > 0 ? df / (dt * fps) : 0;          // 1 = real time
        if (df > 0 && dt > 0.08 && dt < 1.2 && rate > 0.4 && rate < 4.5) { playWatch.hits++; if (playWatch.hits >= 2) playWatch.playing = true; }
        else if (df !== 0) { if (now > playWatch.graceUntil) { playWatch.hits = 0; playWatch.playing = false; } }       // a jump: the playhead was moved by hand
        else { playWatch.still++; if (playWatch.still >= 3) { playWatch.hits = 0; playWatch.playing = false; } }
    }
    if (L.frame !== playWatch.f) playWatch.still = 0;
    playWatch.f = L.frame; playWatch.t = now;
    // Loop: while it plays, the playhead is sent back to the In when it reaches the Out (Resolve's own Loop button
    // cannot be read or switched by a plugin, so this works whether or not it is on).
    if (playWatch.playing && p.hasClip && now > playWatch.graceUntil && L.frame >= p.clipE - 2 && L.frame <= p.clipE + Math.round((L.fps || 25) * 0.6)) {
        playWatch.graceUntil = now + 900;
        playWatch.f = null; playWatch.hits = 2; playWatch.playing = true; playWatch.still = 0;
        try { window.sa.seek(p.clipS); } catch (e) { /* ignore */ }
    }
}

function bindLivePreview() {
    document.addEventListener('click', (e) => {
        const t = e.target.closest && e.target.closest('#stageLiveBtnU, #liveRemoveU, #liveApplyU');
        if (!t) return;
        if (t.id === 'liveRemoveU') {
            endLivePreview(false);
        } else {
            if (state.livePrev && state.livePrev.hasClip && !state.livePrev.removed) {
                endLivePreview(true);
            } else {
                startLivePreview();
            }
        }
    });
    // The preview stays on while you play or scrub: edits made in the panel are pushed to the clip while it is there.
    setInterval(async () => {
        const p = state.livePrev;
        if (state.idle || !p || p.busy || state.busy) return;
        let m = state.use, a = libEntry(p.animId);
        if (m && m.id !== p.animId && libEntry(m.id)) {
            await switchLivePreset(libEntry(m.id));
            return;
        }
        if (!m || !a || m.id !== p.animId) { endLivePreview(false); return; }
        const L = state.live;
        if (!L || !L.ok) return;
        const f = L.frame;
        if (p.hasClip) {
            const tNow = Date.now();
            if (tNow - (p.aliveAt || 0) > 900) {
                p.aliveAt = tNow;
                const anim0 = p.animId;
                p.checking = true;                         // a preset click waits for this check (see switchLivePreset)
                let al = null;
                try { al = await window.sa.liveAlive(); } catch (e) { al = null; } finally { p.checking = false; }
                // a switch that started meanwhile replaced the clip: this answer is about the old one
                if (state.livePrev !== p || p.busy || !p.hasClip || p.animId !== anim0) return;
                if (al && al.alive === false && !al.none) { markRemoved(p); return; }
            }
            if ((f < p.clipS || f >= p.clipE) && !(f >= p.start && f < p.end)) {
                if (playWatch.playing) return;             // playing (looping) - the clip is only moved when the playhead is moved by hand
                if (playWatch.still < 2) return;           // still being dragged: wait until it rests
                const ns = L.subtitle;
                if (ns && f >= ns.start && f < ns.end && ns.start !== p.subStart) {
                    // another caption: the same Text+ and sound are moved onto it (much quicker than removing and inserting again)
                    p.start = ns.start; p.end = ns.end; p.subStart = ns.start;
                    p.text = String(ns.text || ($('subText') && $('subText').value.trim()) || (a && a.sample) || 'Sample text').trim();
                    p.busy = true;
                    p.sfxClip = await liveSfxFor(m, ns.start, ns.end);
                    const mres = await window.sa.liveUpdate(liveReq(m, a, p.text));
                    p.busy = false;
                    if (mres && mres.busy) { p.subStart = null; return; }
                    if (mres && mres.gone) { markRemoved(p); return; }
                    if (mres && !mres.ok) { p.subStart = null; setStatus(mres.error || 'Could not move the preview', 'bad'); return; }
                    if (mres && mres.frames) { p.clipS = mres.start; p.clipE = mres.start + mres.frames; }
                    p.key = JSON.stringify(liveReq(m, a, p.text));
                    setStatus('Preview moved to this subtitle' + (mres.warnings && mres.warnings.length ? ' · ' + mres.warnings.join(' ') : ''), 'ok');
                    return;
                }
                return;
            }
            if (!p.key) return;
            if (L.subtitle && L.subtitle.start === p.subStart) {
                const curSubVal = $('subText') ? $('subText').value.trim() : '';
                if (curSubVal) p.text = curSubVal;
            }
            const req = liveReq(m, a, p.text);
            const key = JSON.stringify(req);
            if (key === p.key) { p.pendKey = null; return; }
            // a change is pushed once it has stayed the same for LIVE_EDIT_REST_MS (not on every 250 ms tick while typing)
            const tEdit = Date.now();
            if (key !== p.pendKey) { p.pendKey = key; p.pendAt = tEdit; return; }
            if (tEdit - p.pendAt < LIVE_EDIT_REST_MS) return;
            p.pendKey = null;
            p.busy = true;
            const res = await window.sa.liveUpdate(req);
            p.busy = false;
            if (res && res.busy) return;                   // Resolve was busy: same change is tried again
            p.key = key;
            if (res && res.gone) { markRemoved(p); return; }
            if (res && !res.ok) { setStatus(res.error || 'Could not update the preview', 'bad'); return; }
            if (res && res.frames) { p.clipS = res.start; p.clipE = res.start + res.frames; }
            setStatus('Preview in Resolve updated' + (res.warnings && res.warnings.length ? ' · ' + res.warnings.join(' ') : ''), 'ok');
        } else {
            const s = L.subtitle;
            // only once the playhead has stopped moving (a clip is inserted at the playhead, so never while it is dragged)
            if (s && f >= s.start && f < s.end && !p.removed && !playWatch.playing && playWatch.still >= 3) {
                const defaultText = String(($('subText') && $('subText').value.trim()) || s.text || (a && a.sample) || 'Sample text').trim();
                await addLiveClip({ start: s.start, end: s.end, text: defaultText }, true);
            }
        }
    }, 250);
}
