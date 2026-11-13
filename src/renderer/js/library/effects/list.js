// Effect Preset cards: the card list (render, filter, toggle, tags, refresh while the selection changes).

function fxStrengthLabel(v, e) { return e && e.repeat ? Math.round(v) + ' fr' : (v <= 0 ? 'Off' : String(Math.round(v))); }

function fxTagsOf(e) {
    const t = (state.lib && state.lib.effectTags) || {};
    return Array.isArray(t[e.id]) ? t[e.id] : [];
}

// target clips that already have this effect as a node in their own Fusion graph (dragged in by hand): the panel does
// not add it on top (it would run twice)
function fxInNodes(id) { return fxUI.clips.filter(c => Array.isArray(c.inNodes) && c.inNodes.includes(id)); }

// "Glitch" on all of the target clips / some of them / none
function fxStateOf(id) {
    if (id === 'MatchCut') return mcUI.running ? 'on' : 'none';      // makes its own clip: "on" while it renders
    const n = fxUI.clips.length;
    if (!n) return 'none';
    const on = fxUI.clips.filter(c => c.effects && c.effects[id]).length;
    return on === n ? 'on' : (on ? 'some' : 'none');
}

// The cards are built once per shown list (search / tags / effects) and then updated in place, like the Clip controls:
// the switch, status, notes and Strength follow the selected clips; an Options block is rebuilt only when what it shows
// changed (its own values, or the clip it is for), keeping its open / closed state.
function renderEffects() {
    const grid = $('fxGrid');
    if (!grid || fxUI.sliding) return;      // never touch a slider being dragged
    renderTagFilter('fx', 'fxFilter');
    const q = fxUI.search.trim().toLowerCase();
    const shown = fxUI.effects.filter(e => {
        if (!passesTagFilter({ tags: fxTagsOf(e) }, 'fx')) return false;
        if (q && !(e.name.toLowerCase().includes(q) || (e.tags || []).some(t => t.includes(q)))) return false;
        return true;
    });
    const n = fxUI.effects.length;
    $('fxCount').textContent = n ? (shown.length !== n ? shown.length + ' of ' + n : n + ' effects') : '';
    const target = $('fxTarget');
    if (target) {
        const names = fxUI.clips.map(c => c.name || 'clip');
        const t = names.length
            ? 'Applies to: ' + (names.length > 3 ? names.slice(0, 3).join(', ') + ' +' + (names.length - 3) : names.join(', '))
            : 'Select a clip on the timeline (video, title or text preset)';
        const temp = fxUI.clips.some(c => c.temp);
        const t2 = temp ? 'Temporary preview text preset selected - effects are not allowed on it' : t;
        target.classList.toggle('fx-target-warn', temp);
        if (target.textContent !== t2) target.textContent = t2;
    }
    const layout = shown.map(e => e.id + ':' + fxTagsOf(e).join('.')).join(',') + '|' + (shown.length ? '' : q + '|' + n);
    if (grid.dataset.layout !== layout || !grid.querySelector('.fx-card') !== !shown.length) {
        grid.dataset.layout = layout;
        grid.textContent = '';
        if (!shown.length) {
            const d = document.createElement('div');
            d.className = 'empty';
            d.textContent = n ? (q ? 'No effect presets matching "' + fxUI.search.trim() + '".' : 'No effect presets have the selected tags.') : 'Loading effects…';
            grid.appendChild(d);
            return;
        }
        for (const e of shown) grid.appendChild(fxBuildCard(e));
    }
    for (const c of grid.querySelectorAll('.fx-card')) {
        const e = fxUI.effects.find(x => x.id === c.dataset.id);
        if (e) fxFillCard(c, e);
    }
}

// Each effect card shows only its switch and name until it is in use: its Strength slider and Options open when the
// effect is on or you click the card, and close again (the effect stays on) once the card scrolls out of view.
function fxIsShut(id, st) { return fxUI.show[id] === undefined ? st === 'none' : !fxUI.show[id]; }
function fxShow(id, open) {
    fxUI.show[id] = !!open;
    const c = document.querySelector('#fxGrid .fx-card[data-id="' + id + '"]');
    if (c) c.classList.toggle('fx-shut', !open);
}
let fxObserver = null;
function fxViewObserver() {
    if (!fxObserver) {
        fxObserver = new IntersectionObserver((entries) => {
            for (const en of entries) {
                const c = en.target;
                if (en.isIntersecting || !c.isConnected || c.classList.contains('fx-shut')) continue;
                if (c.contains(document.activeElement)) continue;      // being edited
                if (c.classList.contains('fx-on') || c.classList.contains('fx-some')) continue;      // an effect that is on keeps its options open
                fxShow(c.dataset.id, false);
            }
        }, { threshold: 0 });
    }
    return fxObserver;
}

// The parts of a card that never change; the rest is set by fxFillCard.
function fxBuildCard(e) {
    const c = document.createElement('div');
    c.className = 'card fx-card';
    c.dataset.id = e.id;
    const sw = document.createElement('span');
    sw.className = 'fx-switch';
    sw.setAttribute('role', 'switch');
    const nm = document.createElement('div');
    nm.className = 'nm'; nm.textContent = e.name;
    const sub = document.createElement('div');
    sub.className = 'sub';
    c.append(sw, nm, sub);
    let note = null;
    if ((e.noStrength || e.repeat) && !e.transform && !e.track) {
        note = document.createElement('div');
        note.className = 'fx-note';
        c.appendChild(note);
    }
    // Strength: 0 = no effect, default = a light, visible look
    const row = document.createElement('label');
    if (e.noStrength) row.style.display = 'none';
    row.className = 'fx-strength';
    const cap = document.createElement('span'); cap.className = 'fx-strength-cap'; cap.textContent = e.repeat ? 'Frame Repeat' : 'Strength';
    const rng = document.createElement('input');
    rng.type = 'range'; rng.min = e.repeat ? '1' : '0'; rng.max = e.repeat ? '10' : '100'; rng.step = '1';
    const val = document.createElement('span'); val.className = 'fx-strength-val';
    const live = () => fxStateOf(e.id) !== 'none';
    for (const ev of ['click', 'mousedown', 'pointerdown']) row.addEventListener(ev, (x) => x.stopPropagation());
    rng.addEventListener('pointerdown', () => { fxUI.sliding = true; });
    for (const ev of ['pointerup', 'pointercancel', 'blur']) rng.addEventListener(ev, () => { fxUI.sliding = false; });
    rng.addEventListener('input', () => {
        const v = Number(rng.value);
        val.textContent = fxStrengthLabel(v, e);
        fxRememberStrength(e, v);
        if (live()) fxSendStrength(e, v);
    });
    rng.addEventListener('change', () => { fxUI.sliding = false; if (live()) fxSendStrength(e, Number(rng.value), true); });
    rng.addEventListener('dblclick', () => {
        const d = Number(e.defaultStrength) || 25;
        rng.value = String(d); val.textContent = fxStrengthLabel(d, e); fxRememberStrength(e, d);
        if (live()) fxSendStrength(e, d, true);
    });
    row.append(cap, rng, val);
    c.appendChild(row);
    const optsAt = document.createElement('div');
    optsAt.className = 'fx-opts-slot';
    optsAt.style.display = 'contents';
    c.appendChild(optsAt);
    const dots = tagDotsEl({ tags: fxTagsOf(e) });
    if (dots) c.appendChild(dots);
    // the switch alone turns the effect on / off; clicking the rest of the card only opens / closes its options
    for (const ev of ['mousedown', 'pointerdown']) sw.addEventListener(ev, (x) => x.stopPropagation());
    sw.addEventListener('click', (x) => { x.stopPropagation(); if (fxStateOf(e.id) === 'none') fxShow(e.id, true); fxToggle(e); });
    c.addEventListener('click', () => fxShow(e.id, c.classList.contains('fx-shut')));
    fxViewObserver().observe(c);
    c.addEventListener('contextmenu', (ev) => { ev.preventDefault(); fxTagMenu(c, e); });
    c._fx = { sw, sub, note, row, rng, val, optsAt, optsSig: null };
    return c;
}

const fxPut = (el, prop, v) => { if (el[prop] !== v) el[prop] = v; };
function fxFillCard(c, e) {
    const f = c._fx;
    const st = fxStateOf(e.id);
    const cls = 'card fx-card' + (st === 'on' ? ' fx-on' : (st === 'some' ? ' fx-some' : '')) + (fxUI.pending[e.id] ? ' fx-pending' : '') + (fxIsShut(e.id, st) ? ' fx-shut' : '');
    fxPut(c, 'className', cls);
    const nodeClips = fxInNodes(e.id);
    // dragged in as a node AND switched on here (the node went in after): it runs twice - click the card to remove this one
    const twice = nodeClips.some(x => x.effects && x.effects[e.id]);
    let title = e.tip + (st === 'on' ? '\nUse the switch to remove it from the selected clip(s); click here to show / hide its options' : '\nUse the switch to add it to the selected clip(s); click here to show / hide its options');
    if (twice) title += '\nAlso a node in the clip\'s Fusion graph, so it runs twice: use the switch to remove the panel one';
    if (nodeClips.length) title += '\nAlready a node in the Fusion graph of: ' + nodeClips.map(x => x.name).join(', ') + ' (not added again there)';
    fxPut(c, 'title', title);
    const aria = st === 'on' ? 'true' : (st === 'some' ? 'mixed' : 'false');
    if (f.sw.getAttribute('aria-checked') !== aria) f.sw.setAttribute('aria-checked', aria);
    fxPut(f.sub, 'textContent', twice ? 'Twice!' : (st === 'on' ? 'On' : (st === 'some' ? 'Some' : (nodeClips.length ? 'In nodes' : ''))));
    f.sub.classList.toggle('fx-twice', twice);
    if (f.note) {
        // zoomed / panned clips get DaVinci's OFX Stop Motion, whose Frame Repeat only Resolve's Inspector can set
        const ofx = fxUI.clips.some(x => x.stopMotionKind === 'ofx');
        fxPut(f.note, 'textContent', e.repeat
            ? (ofx ? 'A zoomed / panned clip uses DaVinci\'s Stop Motion: set the same Frame Repeat in Resolve\'s Inspector → Effects'
                : 'Holds the finished look, glitch / wiggle included')
            : 'DaVinci\'s Stop Motion: set Frame Repeat in Resolve\'s Inspector → Effects');
    }
    fxPut(f.row, 'title', (e.repeat
        ? 'Frame Repeat: each picture (and the glitch / wiggle on it) is held this many frames. ' + (e.defaultStrength || 2) + ' = default'
        : 'Strength: 0 = no effect, ' + (e.defaultStrength || 25) + ' = default (light), 100 = strongest') +
        (st === 'none' ? '\nUsed when you add it' : ''));
    if (!f.rng.matches(':active')) {      // (a slider keeps the focus after use: only a press holds it)
        const v0 = fxStrengthShown(e);
        fxPut(f.rng, 'value', String(v0));
        fxPut(f.val, 'textContent', fxStrengthLabel(v0, e));
    }
    // Options: rebuilt only when what they show changed, and never while one of their fields is being typed in
    if (e.matchCut) {
        const sig = JSON.stringify([!!mcUI.prefs, mcUI.running, mcUI.last && [mcUI.last.phase, mcUI.last.text]]);
        const ae = document.activeElement;
        const typing = !!ae && f.optsAt.contains(ae) && ae.tagName === 'INPUT' && ['number', 'text', 'color'].includes(ae.type);
        if (sig !== f.optsSig && (!typing || !mcUI.running !== !f.optsAt.querySelector('.fx-mc-bar'))) {
            f.optsSig = sig;
            f.optsAt.textContent = '';
            f.optsAt.appendChild(fxMatchCutOptions());
        }
    }
    if (e.spot) {
        const clip = fxUI.clips.find(x => x.effects && x.effects[e.id]);
        const sig = JSON.stringify([st, clip ? [clip.id, clip.spot] : null, spotUI.running, spotUI.ready]);
        const ae = document.activeElement;
        const typing = !!ae && f.optsAt.contains(ae) && (ae.tagName === 'INPUT' || ae.tagName === 'SELECT');
        if (sig !== f.optsSig && !fxUI.sliding && !typing) {
            f.optsSig = sig;
            f.optsAt.textContent = '';
            f.optsAt.appendChild(fxSpotOptions(e, st, clip));
        }
    }
    if (e.track) {
        const clip = fxUI.clips.find(x => x.effects && x.effects[e.id]);
        const sig = JSON.stringify([fxParamsShown(e), st, clip ? [clip.id, clip.track] : null]);
        if (sig !== f.optsSig && !fxUI.sliding) {
            f.optsSig = sig;
            f.optsAt.textContent = '';
            f.optsAt.appendChild(fxTrackOptions(e, st, clip));
        }
    }
    if (e.glitch || e.transform) {
        const clip = e.transform ? (fxUI.clips.find(x => x.effects && x.effects[e.id] && Number(x.frames) > 0) || fxUI.clips.find(x => Number(x.frames) > 1)) : null;
        const sig = JSON.stringify([fxParamsShown(e), clip ? [clip.id, clip.frames, clip.start] : null]);
        const ae = document.activeElement;
        const typing = !!ae && f.optsAt.contains(ae) && ae.tagName === 'INPUT' && ['number', 'text', 'color'].includes(ae.type);
        if (sig !== f.optsSig && !typing) {
            f.optsSig = sig;
            f.optsAt.textContent = '';
            f.optsAt.appendChild(e.glitch ? fxGlitchOptions(e, st) : fxTransformOptions(e, st));
        }
    }
}

// Click: the card flips straight away (optimistic) and the change goes to Resolve on the fast lane; if Resolve refuses,
// the card flips back. Each effect has its own pending flag, so other cards stay clickable meanwhile.
async function fxToggle(e) {
    if (fxUI.pending[e.id]) return;
    // Spotlight makes its own clip at the playhead (no clip needs to be selected); off = remove the selected one
    if (e.spot) { fxSpotToggle(e); return; }
    // Match Cut makes its own clip at the playhead: the switch starts a run (or cancels the running one)
    if (e.matchCut) { if (mcUI.running) window.sa.matchCutCancel(); else { fxShow(e.id, true); mcRun(); } return; }
    if (!fxUI.clips.length) await fxRefresh(true);
    if (!fxUI.clips.length) { setStatus('Select a clip on the timeline first.', 'bad'); return; }
    // the Resolve preview clip is a temporary text preset: it is replaced / removed, so an effect on it would be lost
    if (fxUI.clips.some(c => c.temp)) {
        setStatus('Effects cannot be applied to a temporary preview text preset. Click Apply (or Remove) on the preview first, then select the placed clip.', 'bad');
        return;
    }
    const want = fxStateOf(e.id) !== 'on';
    // Track Subject is added by tracking: switching it on opens the Track sheet (draw the box, Track)
    if (e.track && want) { fxTrackOpen(e); return; }
    // every target clip already has it as a node in its own graph: nothing to add (it would run twice)
    if (want && fxInNodes(e.id).length === fxUI.clips.length) {
        setStatus(e.name + ' is already a node in ' + (fxUI.clips.length === 1 ? 'this clip\'s' : 'these clips\'') + ' Fusion graph - not added again.', 'bad');
        return;
    }
    const before = fxUI.clips;
    fxUI.clips = before.map(c => Object.assign({}, c, { effects: Object.assign({}, c.effects || {}, { [e.id]: want }) }));
    if (!want) for (const c of fxUI.clips) delete c.effects[e.id];
    fxUI.pending[e.id] = true;
    renderEffects();
    let r = null;
    // the Stop Motion Frame Repeat the clip's glitch / wiggle hold for (the bridge uses it only while Stop Motion is on)
    const sm = fxUI.effects.find(x => x.repeat);
    const hold = sm ? fxStrengthShown(sm) : null;
    try { r = await window.sa.fxSet(e.id, want, want && !e.noStrength ? fxNextStrength(e) : null, want && (e.glitch || e.transform) ? fxNextParams(e) : null, hold); } catch (err) { r = { error: String(err && err.message || err) }; }
    delete fxUI.pending[e.id];
    if (!r || r.busy || r.error) {
        fxUI.clips = before;
        setStatus(r && r.busy ? 'Busy placing - try again in a moment.' : ((r && r.error) || 'Could not change the effect'), 'bad');
    } else {
        if (Array.isArray(r.clips)) { fxUI.clips = r.clips; fxUI.sig = JSON.stringify(r.clips); }
        const n = fxUI.clips.length;
        if (r.failed && r.failed.length) setStatus(e.name + ' could not be changed on ' + r.failed.join(', '), 'bad');
        else if (r.inNodes && r.inNodes.length) setStatus(e.name + ' skipped on ' + r.inNodes.join(', ') + ': already a node in its Fusion graph.', 'bad');
        else setStatus(e.name + (r.on ? ' added to ' : ' removed from ') + n + ' clip' + (n === 1 ? '' : 's') + '.', 'ok');
    }
    renderEffects();
}

// Live strength while dragging (at most every 120 ms), and once more on release.
const fxStrengthSenders = new Map();    // effect id -> sender
function fxSendStrength(e, v, now) {
    let sender = fxStrengthSenders.get(e.id);
    if (!sender) {
        sender = createThrottledSender(async (val) => {
            let r = null;
            try { r = await window.sa.fxStrength(e.id, val); } catch (err) { r = { error: String(err && err.message || err) }; }
            fxTakeClips(r);
        }, { ms: 120, mode: 'debounce' });
        fxStrengthSenders.set(e.id, sender);
    }
    sender.push(v, now);
}

// right-click: the same tags as the text presets
function fxTagMenu(anchor, e) {
    openPop(anchor, 'pop-menu', (el) => {
        const head = document.createElement('div');
        head.className = 'pop-title'; head.textContent = 'Tags';
        el.appendChild(head);
        if (!allTags().length) {
            const x = document.createElement('div');
            x.className = 'pop-empty'; x.textContent = 'No tags yet (make them on the Library tab)';
            el.appendChild(x);
        }
        for (const t of allTags()) {
            const it = document.createElement('button');
            it.className = 'pop-item' + (fxTagsOf(e).includes(t.id) ? ' on' : '');
            const ck = document.createElement('span'); ck.className = 'pop-check'; ck.textContent = '✓';
            const n = document.createElement('span'); n.className = 'pop-label'; n.textContent = t.name;
            it.append(ck, tagMarkEl(t), n);
            it.addEventListener('click', async () => {
                const mine = fxTagsOf(e);
                const next = mine.includes(t.id) ? mine.filter(x => x !== t.id) : mine.concat(t.id);
                takeLib(await window.sa.fxSetTags(e.id, next));
                it.classList.toggle('on', next.includes(t.id));
            });
            el.appendChild(it);
        }
    });
}

// The effects on the selected clips, read while the Use tab is showing and the panel is not busy.
async function fxRefresh(force) {
    if (state.busy || (!force && Object.keys(fxUI.pending).length)) return;
    let r = null;
    try { r = await window.sa.fxGet(); } catch (e) { r = null; }
    if (!r || r.busy || r.error || !Array.isArray(r.clips)) return;
    if (!force && Object.keys(fxUI.pending).length) return;      // a toggle started meanwhile: its own answer wins
    const sig = JSON.stringify(r.clips);
    if (sig === fxUI.sig) return;
    fxUI.sig = sig;
    fxUI.clips = r.clips;
    renderEffects();
}
// The toggles follow the clips selected in Resolve (what is on them, added here or dragged in from Resolve's Effects),
// also while Resolve has the focus - that is where clips get selected. Paced like the Clip controls: 700 ms while the
// selection or its effects change, 1500 ms once nothing has changed for 3 s (fxGet backs off when Resolve is busy).
const fxPace = { sig: '', changedAt: 0 };
function fxPoll() {
    clearTimeout(fxUI.timer);
    const calm = Date.now() - fxPace.changedAt > 3000;
    fxUI.timer = setTimeout(async () => {
        if (!document.hidden && state.tab === 'apply' && !state.idle) {
            await fxRefresh();
            if (fxUI.sig !== fxPace.sig) { fxPace.sig = fxUI.sig; fxPace.changedAt = Date.now(); }
        }
        fxPoll();
    }, calm ? 1500 : 700);
}

async function initEffects() {
    try { const r = await window.sa.fxList(); fxUI.effects = (r && r.effects) || []; } catch (e) { fxUI.effects = []; }
    const input = $('fxSearch'), clear = $('fxSearchClear');
    if (input) {
        input.addEventListener('input', () => { fxUI.search = input.value; if (clear) clear.classList.toggle('hidden', !fxUI.search); renderEffects(); });
        input.addEventListener('keydown', (ev) => { if (ev.key === 'Escape') { input.value = ''; fxUI.search = ''; if (clear) clear.classList.add('hidden'); renderEffects(); } });
    }
    if (clear) clear.addEventListener('click', () => { if (input) { input.value = ''; input.focus(); } fxUI.search = ''; clear.classList.add('hidden'); renderEffects(); });
    window.addEventListener('focus', () => { if (state.tab === 'apply') fxRefresh(); });
    renderEffects();
    fxPoll();
}
