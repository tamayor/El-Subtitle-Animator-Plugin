// Sounds: every sound of a preset (the main one and any extra ones) is one lane in the Alignment timeline and is
// edited with the same card. Click a bar to edit it; drag the bar to move it, its edges to trim it, and the
// horizontal line on it up / down to change its volume (like Resolve). Extra sounds are stored on the preset as
// a.sfxLayers = [{ id, file, orig, enabled, volume (dB), offset (frames), align, trimIn, len, link, track }]
// and placed next to the main sound by main.js. The main sound keeps its own fields (sfx, sfxOffset, ...).
// Runs after the panel scripts and uses their globals (state, libEntry, geometry, renderTimeline, play, dropZone, ...).
(function () {
    'use strict';
    const $ = (id) => document.getElementById(id);
    const sel = { U: 'main', C: 'main' };          // selected lane per panel: 'text' | 'main' | an extra sound's id
    const LANE_H = 56, LANE0 = 26;
    const VOL_MAX = 6, VOL_MIN = -30;
    const ANCHORS = [['start', 'Start of text'], ['end', 'End of text (ends there)'], ['after', 'After the text'], ['rows', 'Repeat per row \u2013 one copy at every row pop-in']];
    let saveTimer = 0;

    const num = (v, d) => { const n = Number(v); return isNaN(n) ? d : n; };
    const nameOf = (f) => String(f || '').replace(/\.[^.]+$/, '');
    const dbText = (v) => (v > 0 ? '+' : '') + Math.round(v * 10) / 10 + ' dB';
    const originals = () => (state.lib && state.lib.sfxOriginals) || [];
    const fileInfo = (f) => originals().find(o => o.file === f) || null;
    const pathOf = (f) => {
        if (!f) return null;
        return sfxPathFor(f);
    };
    const say = (ctx, msg, kind) => { try { if (ctx.s === 'C' && typeof setCreateStatus === 'function') setCreateStatus(msg, kind); else setStatus(msg, kind); } catch (e) { /* ignore */ } };

    function mk(tag, cls, text) {
        const el = document.createElement(tag);
        if (cls) el.className = cls;
        if (text !== undefined) el.textContent = text;
        return el;
    }
    const entryOf = (ctx) => { const m = ctx.model(); return m ? libEntry(m.id) : null; };
    // Use tab: the extra sounds belong to its one-time copy (so Reset can undo them); Library: to the saved preset
    const holderOf = (ctx) => (ctx.s === 'U' ? ctx.model() : entryOf(ctx));
    const layersOf = (ctx) => { const a = holderOf(ctx); return (a && Array.isArray(a.sfxLayers)) ? a.sfxLayers : []; };
    function persist(ctx) {
        if (ctx.s === 'U') { const um = ctx.model(); if (um) ctx.changed(um); return; }   // one-time edit: nothing is saved to the preset
        const a = entryOf(ctx); if (!a) return;
        const id = a.id, list = a.sfxLayers;
        clearTimeout(saveTimer);
        saveTimer = setTimeout(() => { try { window.sa.updateAnimation(id, { sfxLayers: list }); } catch (e) { /* ignore */ } }, 400);
    }
    // Length mode of an extra sound: 'clip' = follows the text clip's duration when placed (default), 'fixed' = the set
    // length (len 0 = the rest of the sound). Older sounds with a set length are fixed.
    const lenModeOf = (l) => (l.lenMode === 'fixed' || l.lenMode === 'clip') ? l.lenMode : (num(l.len, 0) > 0 ? 'fixed' : 'clip');
    // Length of a 'clip' sound: from its start to the text end ('start' anchor), else the text's own duration.
    const clipLen = (l, off, textS, textE, max) => clamp(Math.round(l.align === 'end' || l.align === 'after' ? textE - textS : textE - (textS + off)), 1, Math.max(1, max));
    const offsetFor = (align, start, len, textS, textE) => align === 'end' ? start + len - textE : (align === 'after' ? start - textE : start - textS);

    // ---------------------------------------------------------------- geometry of an extra sound (frames, relative to the subtitle start)
    function layerGeo(m, g, l) {
        const p = pathOf(l.file);
        let w = null;
        if (p) { w = state.waves.get(p); if (w === undefined) { loadWave(p); w = null; } }
        const full = Math.max(2, Math.round(((w && w.seconds) || 0.5) * g.fps));
        const tin = clamp(Math.round(num(l.trimIn, 0)), 0, Math.max(0, full - 2));
        const cap = Math.round(num(l.len, 0));
        const mode = lenModeOf(l);
        const off = Math.round(num(l.offset, 0));
        let len = full - tin;
        if (mode === 'clip') len = clipLen(l, off, g.textS, g.textE, full - tin);
        else if (cap > 0) len = Math.min(len, cap);
        len = Math.max(1, len);
        const start = l.align === 'end' ? g.textE - len + off : (l.align === 'after' ? g.textE + off : g.textS + off);
        // fade-out at its end (1 s unless changed), kept in both length modes
        const fade = clamp((l.fade === null || l.fade === undefined) ? Math.round(g.fps) : Math.round(num(l.fade, 0)), 0, len);
        return { full, tin, len, fade, fps: g.fps, start, end: start + len, wave: w, path: p, auto: mode === 'clip', mode, textS: g.textS, textE: g.textE };
    }

    // ---------------------------------------------------------------- one interface for every sound (main or extra)
    function mainHandle(ctx, m) {
        const S = ctx.s;
        const redraw = () => { ctx.changed(m); renderTimeline(ctx); if (S === 'U') renderUseSummary(); else renderCreateSummary(); };
        const done = (res, msg) => { if (takeLib(res)) say(ctx, msg, 'ok'); };
        return {
            kind: 'main', ctx, id: 'main', canEdit: S === 'C',
            get(f) {
                switch (f) {
                    case 'on': return m.useSfx !== false;
                    case 'volume': return num(m.sfxVolume, 0);
                    case 'start': return Math.round(num(m.sfxOffset, 0));
                    case 'mode': return sfxLenMode(m) === 'estimate' ? 'clip' : 'fixed';
                    case 'length': return geometry(m).sfxFrames;
                    case 'fade': return geometry(m).fadeFrames;
                    case 'track': return Number(m.sfxTrack) || 0;
                    case 'link': return m.linked !== false;
                }
            },
            set(f, v) {
                switch (f) {
                    case 'on': m.useSfx = !!v; redraw(); renderAnimations(); break;
                    case 'volume': { m.sfxVolume = v; ctx.changed(m); renderTimeline(ctx); triggerLiveSync(m, S); break; }
                    case 'start': m.sfxOffset = clamp(Math.round(v), -300, 300); redraw(); break;
                    case 'mode':
                        stopPreview();
                        if (v === 'clip') { m.sfxLen = null; m.sfxLenMode = 'estimate'; } else { m.sfxLen = geometry(m).sfxFrames; m.sfxLenMode = 'fixed'; }
                        ctx.changed(m); syncAttachedSfx(m); renderTimeline(ctx); break;
                    case 'length': {
                        const g = geometry(m);
                        m.sfxLen = clamp(Math.round(v), 2, Math.max(2, g.sfxFull - g.sfxTrimIn)); m.sfxLenMode = 'fixed';
                        ctx.changed(m); syncAttachedSfx(m); renderTimeline(ctx); break;
                    }
                    case 'fade': { const g = geometry(m); m.sfxFade = clamp(Math.round(v), 0, g.sfxFrames); ctx.changed(m); syncAttachedSfx(m); renderTimeline(ctx); break; }
                    case 'track': m.sfxTrack = Number(v); ctx.changed(m); break;
                    case 'link': m.linked = !!v; redraw(); break;
                }
            },
            name() {
                const a = libEntry(m.id);
                const orig = m.sfxOrig || (a && a.sfxOrig);
                const cur = m.sfxPath ? baseName(m.sfxPath) : (m.sfx || (a && a.sfx));
                const def = state.lib.defaultSfx ? state.lib.defaultSfx.file : null;
                if (orig && cur && cur !== orig) return orig + ' (trimmed)';
                if (orig || cur) return orig || cur;
                return def ? 'Default (' + def + ')' : 'No sound';
            },
            path() { return m.sfxPath || currentSfxPath(Object.assign({}, m, { useSfx: true })); },
            canRevert() { const a = libEntry(m.id); return !!(a && a.sfx && a.sfxOrig && a.sfx !== a.sfxOrig); },
            async choose(file) { const a = libEntry(m.id); if (!a) return; if (a.useSfx === false) await window.sa.updateAnimation(a.id, { useSfx: true }); done(await window.sa.setAnimationSfx(a.id, pathOf(file)), 'Sound changed.'); },
            async replace(p) { const a = libEntry(m.id); if (!a) return; if (a.useSfx === false) await window.sa.updateAnimation(a.id, { useSfx: true }); done(await window.sa.setAnimationSfx(a.id, p), 'Sound changed.'); },
            async useDefault() { const a = libEntry(m.id); if (!a) return; await window.sa.updateAnimation(a.id, { useSfx: true }); done(await window.sa.setAnimationSfx(a.id, null), 'Using the default sound.'); },
            async none() { const a = libEntry(m.id); if (!a) return; done(await window.sa.updateAnimation(a.id, { useSfx: false }), 'No sound for this preset.'); },
            async revert() { const a = libEntry(m.id); if (!a) return; done(await window.sa.revertAudio(a.id), 'Back to the original sound.'); },
            remove: null
        };
    }

    function layerHandle(ctx, m, l) {
        const geo = () => layerGeo(m, geometry(m), l);
        const save = () => { persist(ctx); renderTimeline(ctx); };
        const setFile = (file) => { l.file = file; l.orig = file; l.trimIn = 0; l.len = 0; l.lenMode = 'clip'; l.enabled = true; };
        return {
            kind: 'layer', ctx, id: l.id, canEdit: true,
            get(f) {
                switch (f) {
                    case 'on': return l.enabled !== false;
                    case 'volume': return num(l.volume, 0);
                    case 'start': return Math.round(num(l.offset, 0));
                    case 'mode': return lenModeOf(l);
                    case 'length': return geo().len;
                    case 'fade': return geo().fade;
                    case 'track': return Number(l.track) || 0;
                    case 'link': return !!l.link;
                    case 'anchor': return ANCHORS.some(x => x[0] === l.align) ? l.align : 'start';
                }
            },
            set(f, v) {
                switch (f) {
                    case 'on': l.enabled = !!v; break;
                    case 'volume': l.volume = v; break;
                    case 'start': l.offset = Math.round(v); break;
                    case 'mode': { const q = geo(); if (v === 'clip') { l.lenMode = 'clip'; l.len = 0; } else { l.lenMode = 'fixed'; l.len = q.len; } break; }
                    case 'length': { const q = geo(); l.len = clamp(Math.round(v), 1, Math.max(1, q.full - q.tin)); l.lenMode = 'fixed'; break; }
                    case 'fade': l.fade = Math.max(0, Math.round(v)); break;
                    case 'track': l.track = Number(v) || 0; break;
                    case 'link': l.link = !!v; break;
                    case 'anchor': { const q = geo(); l.align = v; l.offset = offsetFor(v, q.start, q.len, q.textS, q.textE); break; }
                }
                save();
            },
            name() { return l.file ? nameOf(l.file) + (fileInfo(l.file) ? '' : ' (missing)') : 'No sound'; },
            path() { return pathOf(l.file); },
            canRevert() { return !!(l.orig && (l.file !== l.orig || num(l.trimIn, 0) > 0 || lenModeOf(l) === 'fixed')); },
            async choose(file) { setFile(file); save(); renderCard(ctx, true); },
            async replace(p) {
                const res = await window.sa.addSfxOriginal(p);
                if (!res || res.error) { say(ctx, (res && res.error) || 'Could not add the sound', 'bad'); return; }
                if (res.lib) state.lib = res.lib;
                const cur = layersOf(ctx).find(x => x.id === l.id) || l;
                Object.assign(cur, { file: res.file, orig: res.file, trimIn: 0, len: 0, lenMode: 'clip', enabled: true });
                persist(ctx); renderTimeline(ctx); renderCard(ctx, true);
            },
            async useDefault() {
                const d = state.lib.defaultSfx;
                if (!d) { say(ctx, 'No default sound is set yet (Create tab).', 'bad'); return; }
                setFile(d.file); save(); renderCard(ctx, true);
            },
            async none() { l.enabled = false; save(); },
            async revert() { l.file = l.orig || l.file; l.trimIn = 0; l.len = 0; l.lenMode = 'clip'; save(); renderCard(ctx, true); },
            remove() {
                const list = layersOf(ctx), i = list.findIndex(x => x.id === l.id);
                if (i >= 0) list.splice(i, 1);
                sel[ctx.s] = 'main';
                persist(ctx); renderTimeline(ctx); renderCard(ctx, true);
            }
        };
    }

    function handle(ctx, id) {
        const m = ctx.model(); if (!m) return null;
        if (id === 'main') return mainHandle(ctx, m);
        const l = layersOf(ctx).find(x => x.id === id);
        return l ? layerHandle(ctx, m, l) : null;
    }

    // ---------------------------------------------------------------- adding
    async function addFromPath(ctx, p) {
        const a = entryOf(ctx);
        if (!a || !p) return;
        const res = await window.sa.addSfxOriginal(p);
        if (!res || res.error) { say(ctx, (res && res.error) || 'Could not add the sound', 'bad'); return; }
        if (res.lib) state.lib = res.lib;
        const cur = holderOf(ctx) || a;
        if (!Array.isArray(cur.sfxLayers)) cur.sfxLayers = [];
        const l = { id: 'l' + Date.now().toString(36) + Math.floor(Math.random() * 1e3), file: res.file, orig: res.file, enabled: true, volume: 0, offset: 0, align: 'start', trimIn: 0, len: 0, lenMode: 'clip', link: false, track: 0 };
        cur.sfxLayers.push(l);
        sel[ctx.s] = l.id;
        persist(ctx); renderTimeline(ctx);
    }
    async function addSound(ctx) {
        const p = await window.sa.pickFile('sfx');
        if (p && !p.error) addFromPath(ctx, p);
    }

    // ---------------------------------------------------------------- the shared pieces of UI
    // Replace… / Default / None / Revert for one sound. Used by the card below the timeline and by "Preset files".
    function pickerButtons(ctx, id, opts) {
        const only = opts && opts.only;
        const want = (k) => !only || only.indexOf(k) >= 0;
        const H = () => handle(ctx, id);
        const h0 = H();
        const wrap = mk('span', 'snd-btns');
        if (!h0 || !h0.canEdit) return wrap;
        const b = (text, title, fn) => { const x = mk('button', 'ghost sm-btn', text); x.type = 'button'; x.title = title; x.addEventListener('click', (e) => { e.stopPropagation(); const h = H(); if (h) fn(h, x); }); wrap.appendChild(x); return x; };
        const revert = (h, x) => {
            const go = () => h.revert();
            if (h.kind === 'main' && typeof openConfirmPop === 'function') openConfirmPop(x, { title: 'Revert audio to original sound?', message: 'Discard trimmed audio adjustments and go back to the original sound?', confirmText: 'Revert audio', danger: false, onConfirm: go });
            else go();
        };
        if (want('replace')) b('Replace…', 'Pick a sound file', async (h) => { const p = await window.sa.pickFile('sfx'); if (p && !p.error) h.replace(p); });
        if (want('default')) b('Default', 'Use the default sound effect', (h) => h.useDefault());
        if (want('none')) b('None', 'No sound here', (h) => h.none());
        if (want('revert') && h0.canRevert()) b('↺ Revert', 'Back to the original sound (undoes trimming)', revert);
        return wrap;
    }

    // A small "⋯" menu for one sound: the less-used actions (Default / None / Revert) without a row of buttons.
    function moreButton(ctx, id) {
        const h0 = handle(ctx, id);
        if (!h0 || !h0.canEdit || typeof openPop !== 'function') return document.createTextNode('');
        const btn = mk('button', 'ghost pc-more', '⋯'); btn.type = 'button'; btn.title = 'Replace or change the sound';
        btn.addEventListener('click', (e) => {
            e.stopPropagation();
            openPop(btn, 'pop-menu', (el) => {
                const H = () => handle(ctx, id);
                const item = (icon, text, fn, cls) => {
                    const it = mk('button', 'pop-item' + (cls ? ' ' + cls : ''));
                    it.type = 'button';
                    it.append(mk('span', 'pop-check', icon), mk('span', 'pop-label', text));
                    it.addEventListener('click', () => { closePop(); const h = H(); if (h) fn(h); });
                    el.appendChild(it);
                };
                item('⇄', 'Replace…', async (h) => { const p = await window.sa.pickFile('sfx'); if (p && !p.error) h.replace(p); });
                el.appendChild(mk('div', 'pop-sep'));
                item('♪', 'Use the default sound', (h) => h.useDefault());
                item('∅', 'No sound', (h) => h.none());
                const h = H();
                if (h && h.canRevert()) {
                    el.appendChild(mk('div', 'pop-sep'));
                    item('↺', 'Revert to original sound', (hh) => {
                        if (typeof openConfirmPop === 'function') openConfirmPop(btn, { title: 'Revert audio to original sound?', message: 'Discard trimmed audio adjustments and go back to the original sound?', confirmText: 'Revert audio', danger: false, onConfirm: () => hh.revert() });
                        else hh.revert();
                    });
                }
            });
        });
        return btn;
    }

    function numField(refs, label, unit, get, set, evt) {
        const l = mk('label', 'snd-num');
        const i = document.createElement('input');
        i.type = 'number'; i.step = '1';
        i.addEventListener(evt || 'input', () => set(num(i.value, 0)));
        i.addEventListener('dblclick', () => { i.value = '0'; set(0); });
        l.append(mk('span', '', label), i);
        if (unit) l.appendChild(mk('span', 'u', unit));
        refs.push(() => { if (document.activeElement !== i) i.value = String(get()); });
        return l;
    }
    function checkField(refs, label, title, get, set) {
        const l = mk('label', 'snd-check');
        if (title) l.title = title;
        const c = document.createElement('input'); c.type = 'checkbox';
        c.addEventListener('change', () => set(c.checked));
        l.append(c, mk('span', '', label));
        refs.push(() => { c.checked = !!get(); });
        return l;
    }
    // How long the sound is when placed: follow the text clip's duration (default) or keep the fixed length set here.
    function lenModeField(refs, get, set) {
        const s = document.createElement('select'); s.className = 'snd-lenmode';
        s.title = 'Follow the clip: the sound is cut (or extended up to its full length) to the text clip\'s duration when placed. Fixed length: always the length set here.';
        [['clip', 'Follow the clip'], ['fixed', 'Fixed length']].forEach(([v, t]) => { const o = document.createElement('option'); o.value = v; o.textContent = t; s.appendChild(o); });
        s.addEventListener('change', () => set(s.value));
        refs.push(() => { if (document.activeElement !== s) s.value = get(); });
        const l = mk('label', 'snd-num');
        l.append(mk('span', '', 'Sound length'), s);
        return l;
    }
    function trackField(refs, label, prefix, get, set) {
        const l = mk('label', 'snd-num');
        const s = document.createElement('select');
        fillTrackSelect(s, prefix, get());
        s.addEventListener('change', () => set(Number(s.value)));
        l.append(mk('span', '', label), s);
        refs.push(() => { if (document.activeElement !== s) s.value = String(get()); });
        return l;
    }

    function buildSoundCard(ctx, host, id) {
        const refs = host._refs = [];
        const H = () => handle(ctx, id);
        const h0 = H();
        const card = mk('div', 'snd-in');
        host.appendChild(card);

        // top row: on/off, preview, which sound
        const top = mk('div', 'snd-top');
        top.appendChild(checkField(refs, '', 'Use this sound', () => (H() || h0).get('on'), (v) => { const h = H(); if (h) h.set('on', v); }));
        const pl = mk('button', 'ghost sm-btn', '▶'); pl.type = 'button'; pl.title = 'Hear this sound';
        pl.addEventListener('click', () => { const h = H(); const p = h && h.path(); if (p) play(p, h.get('volume')); else say(ctx, 'No sound file set', 'bad'); });
        top.appendChild(pl);
        if (h0.canEdit) {
            const s = document.createElement('select'); s.className = 'snd-file'; s.title = 'Pick one of your stored sounds';
            const cur = h0.name();
            const o0 = document.createElement('option'); o0.value = ''; o0.textContent = cur; s.appendChild(o0);
            originals().forEach(o => { const op = document.createElement('option'); op.value = o.file; op.textContent = o.name || o.file; s.appendChild(op); });
            s.value = '';
            s.addEventListener('change', () => { const h = H(); if (h && s.value) h.choose(s.value); });
            top.appendChild(s);
        } else {
            const n = mk('span', 'snd-file grow', h0.name()); n.title = 'Edit the sound in Set Up';
            top.appendChild(n);
        }
        if (h0.remove) {
            const del = mk('button', 'ghost sm-btn snd-del', '✕'); del.type = 'button'; del.title = 'Remove this sound';
            del.addEventListener('click', () => { const h = H(); if (h) h.remove(); });
            top.appendChild(del);
        }
        card.appendChild(top);
        // the main sound's Replace / Default / None live in the Files row (and its ⋯ menu); extra sounds keep theirs here
        if (h0.canEdit && h0.kind !== 'main') card.appendChild(pickerButtons(ctx, id));

        // volume (also the line on the sound in the timeline)
        const vol = mk('div', 'snd-row');
        vol.appendChild(numField(refs, 'Volume', 'dB', () => (H() || h0).get('volume'), (v) => { const h = H(); if (h) h.set('volume', clamp(v, VOL_MIN, VOL_MAX)); }, 'change'));
        vol.appendChild(mk('span', 'hint snd-volhint', 'Or drag the line on the sound up / down'));
        card.appendChild(vol);

        // where it sits and how long
        const pos = mk('div', 'snd-row');
        if (h0.kind === 'layer') {
            const a = document.createElement('select'); a.className = 'snd-anchor'; a.title = 'What this sound lines up with. "Repeat per row": the sound is placed again at every row of a row-by-row preset (Kinetic Cloud): the copies follow the clip\'s Frames Per Row and Animation Frames, so their number and spacing come from the placed text, not from this timeline.';
            ANCHORS.forEach(([v, t]) => { const o = document.createElement('option'); o.value = v; o.textContent = t; a.appendChild(o); });
            a.addEventListener('change', () => { const h = H(); if (h) h.set('anchor', a.value); });
            refs.push(() => { const h = H(); if (h && document.activeElement !== a) a.value = h.get('anchor'); });
            pos.appendChild(a);
        }
        pos.appendChild(numField(refs, 'Offset', 'f', () => (H() || h0).get('start'), (v) => { const h = H(); if (h) h.set('start', v); }));
        pos.appendChild(numField(refs, 'Length', 'f', () => (H() || h0).get('length'), (v) => { const h = H(); if (h) h.set('length', Math.max(1, v)); }, 'change'));
        pos.appendChild(numField(refs, 'Fade out', 'f', () => (H() || h0).get('fade'), (v) => { const h = H(); if (h) h.set('fade', Math.max(0, v)); }, 'change'));
        pos.appendChild(lenModeField(refs, () => (H() || h0).get('mode'), (v) => { const h = H(); if (h) h.set('mode', v); }));
        card.appendChild(pos);
        if (h0.kind === 'layer') {
            // Repeat per row: say plainly what is placed, because the Alignment timeline can only show the first copy
            const rep = mk('div', 'hint snd-repeat', '\u21bb Repeats: one copy of this sound is placed at every row of the text as it pops in. ' +
                'The number of copies and their spacing are based on the placed clip (its rows, Frames Per Row and Animation Frames), ' +
                'not on this preview, which shows only the first copy. "Follow the clip" length = each copy ends when the next row starts. ' +
                'On presets without rows the sound plays once at the text start.');
            refs.push(() => { const h = H(); rep.style.display = (h && h.get('anchor') === 'rows') ? '' : 'none'; });
            card.appendChild(rep);
        }

        const misc = mk('div', 'snd-row');
        misc.appendChild(trackField(refs, 'Track', 'A', () => (H() || h0).get('track'), (v) => { const h = H(); if (h) h.set('track', v); }));
        misc.appendChild(checkField(refs, 'Link to text', 'Link this sound to the text clip so they move together in Resolve', () => (H() || h0).get('link'), (v) => { const h = H(); if (h) h.set('link', v); }));
        card.appendChild(misc);
    }

    function buildTextCard(ctx, host) {
        const refs = host._refs = [];
        const M = () => ctx.model();
        const card = mk('div', 'snd-in');
        host.appendChild(card);
        const top = mk('div', 'snd-top');
        top.appendChild(mk('strong', 'snd-file grow', 'Text'));
        card.appendChild(top);
        const redraw = () => { const m = M(); if (!m) return; ctx.changed(m); renderTimeline(ctx); if (ctx.s === 'U') renderUseSummary(); else renderCreateSummary(); };
        const row = mk('div', 'snd-row');
        row.appendChild(numField(refs, 'Start', 'f', () => num(M() && M().textOffset, 0), (v) => {
            const m = M(); if (!m) return;
            v = clamp(Math.round(v), -300, 300);
            if (m.linked === false) m.sfxOffset = clamp(m.sfxOffset - (v - m.textOffset), -300, 300);
            m.textOffset = v; redraw();
        }));
        row.appendChild(numField(refs, 'Ends', 'f', () => num(M() && M().tail, 0), (v) => { const m = M(); if (!m) return; m.tail = clamp(Math.round(v), -300, 300); redraw(); }));
        card.appendChild(row);
        const misc = mk('div', 'snd-row');
        misc.appendChild(trackField(refs, 'Track', 'V', () => num(M() && M().textTrack, 0), (v) => { const m = M(); if (m) { m.textTrack = v; ctx.changed(m); } }));
        card.appendChild(misc);
    }

    function renderCard(ctx, force) {
        const host = $('sndCard' + ctx.s);
        if (!host) return;
        const m = ctx.model();
        if (!m) { host.textContent = ''; host.dataset.key = ''; return; }
        const ids = ['main'].concat(layersOf(ctx).map(l => l.id));
        let id = sel[ctx.s];
        if (id !== 'text' && ids.indexOf(id) < 0) id = sel[ctx.s] = 'main';
        const h = id === 'text' ? null : handle(ctx, id);
        const key = [m.id, id, ids.join(','), h ? h.name() : '', h && h.canEdit ? 1 : 0, h && h.canRevert() ? 1 : 0, originals().length].join('|');
        if (force || host.dataset.key !== key || !host.firstChild) {
            host.dataset.key = key;
            host.textContent = '';
            if (id === 'text') buildTextCard(ctx, host); else if (h) buildSoundCard(ctx, host, id);
            if (!host._dz && typeof dropZone === 'function') {
                host._dz = true;
                dropZone(host, async (p) => { const hh = handle(ctx, sel[ctx.s]); if (hh && hh.canEdit) hh.replace(p); });
            }
        }
        (host._refs || []).forEach(fn => { try { fn(); } catch (e) { /* ignore */ } });
    }

    function markSel(ctx) {
        const box = $('tl' + ctx.s); if (!box) return;
        box.querySelectorAll('.bar[data-snd]').forEach(b => b.classList.toggle('sel', b.dataset.snd === sel[ctx.s]));
    }

    // Called after every timeline redraw.
    function sync(ctx, force) {
        const b = $('sndAdd' + ctx.s);
        if (b && !b._b) { b._b = true; b.addEventListener('click', () => addSound(ctx)); }
        renderCard(ctx, force);
        markSel(ctx);
    }

    function selectFor(ctx, kind, lid) {
        const id = lid ? lid : (kind.indexOf('text') === 0 ? 'text' : 'main');
        if (sel[ctx.s] === id) return;
        sel[ctx.s] = id;
        renderCard(ctx);
        markSel(ctx);
    }

    // ---------------------------------------------------------------- the timeline
    // The volume line: 0 dB sits a sixth down from the top; +6 dB is the top, -30 dB the bottom.
    const volFrac = (db) => (VOL_MAX - clamp(db, VOL_MIN, VOL_MAX)) / (VOL_MAX - VOL_MIN);
    function volLine(add, bar, db, begin, kind, lid, onStart) {
        const ln = add('vol-line', bar);
        ln.style.top = (volFrac(db) * 100) + '%';
        ln.title = 'Volume ' + dbText(db) + ' - drag up / down (double-click: 0 dB)';
        const tip = add('vol-tip', ln); tip.textContent = dbText(db);
        ln.addEventListener('pointerdown', begin(kind, lid));
        ln.addEventListener('pointerdown', () => { if (state.drag && state.drag.kind === kind && state.drag.lid === lid) { state.drag.bh = bar.clientHeight || 36; state.drag.v0 = db; if (onStart) onStart(); } });
        return ln;
    }

    function range(ctx, m, g) {
        let lo = null, hi = null;
        for (const l of layersOf(ctx)) {
            if (l.enabled === false || !l.file) continue;
            const q = layerGeo(m, g, l);
            lo = lo === null ? q.start : Math.min(lo, q.start);
            hi = hi === null ? q.end : Math.max(hi, q.end);
        }
        return lo === null ? null : { lo: lo - 12, hi: hi + 12 };
    }

    // Extra lanes (and their drag handlers) under the main sound's lane.
    function lanes(env) {
        const { ctx, m, g, box, add, X, ppf, begin, resets, top0 } = env;
        if (!box._dz && typeof dropZone === 'function') { box._dz = true; dropZone(box, (p) => addFromPath(ctx, p)); }
        layersOf(ctx).forEach((l, i) => {
            const lane = add('lane sfx');
            lane.style.top = (top0 + i * LANE_H) + 'px'; lane.style.height = LANE_H + 'px';
            add('tag', lane).textContent = 'Sound ' + (i + 2) + (l.align === 'rows' ? ' \u21bb per row' : '');
            const q = layerGeo(m, g, l);
            const on = l.enabled !== false && !!l.file;
            const vol = num(l.volume, 0);
            if (on && (q.tin > 0 || q.len < q.full)) {
                const gs = add('sfx-ghost', lane);
                gs.style.left = X(q.start - q.tin) + 'px'; gs.style.width = Math.max(6, q.full * ppf) + 'px';
                const gcv = document.createElement('canvas'); gs.appendChild(gcv);
                drawWave(gcv, q.wave, vol);
            }
            const bar = add('bar sfx' + (on ? '' : ' off'), lane);
            bar.dataset.snd = l.id;
            const w = Math.max(6, q.len * ppf);
            bar.style.left = X(q.start) + 'px'; bar.style.width = w + 'px';
            const cv = document.createElement('canvas'); bar.appendChild(cv);
            drawWave(cv, q.wave, vol, { from: q.tin / q.full, frac: q.len / q.full, fade: q.len ? q.fade / q.len : 0 });
            const nm = add('nm snd-nm', bar); nm.textContent = nameOf(l.file);
            const hl = add('handle l', bar), hr = add('handle r', bar);
            hl.title = 'Drag to trim or extend the start (double-click to restore)';
            hr.title = 'Drag to trim or extend the end (double-click: the rest of the sound)';
            const fh = add('fade-h', bar);
            fh.style.left = Math.max(0, Math.min(w - 10, (q.len - q.fade) * ppf - 5)) + 'px';
            fh.title = 'Drag to change the fade-out length (double-click: 1 s)';
            volLine(add, bar, vol, begin, 'lyrVol', l.id);
            const snap = () => ({ start: q.start, len: q.len, tin: q.tin, full: q.full, fade: q.fade, fps: q.fps, auto: q.auto, mode: q.mode, textS: q.textS, textE: q.textE, align: l.align });
            const cap = (kind, el) => {
                el.addEventListener('pointerdown', begin(kind, l.id));
                el.addEventListener('pointerdown', () => { if (state.drag && state.drag.kind === kind && state.drag.lid === l.id) state.drag.l0 = snap(); });
            };
            cap('lyr', bar); cap('lyrIn', hl); cap('lyrOut', hr); cap('lyrFade', fh);
            resets['lyrFade:' + l.id] = () => { l.fade = null; persist(ctx); };
            resets['lyrIn:' + l.id] = () => { apply(l, q.start - q.tin, q.auto ? 0 : q.len + q.tin, 0, snap(), true); };
            resets['lyrOut:' + l.id] = () => { l.len = 0; l.lenMode = 'clip'; persist(ctx); };
            resets['lyrVol:' + l.id] = () => { l.volume = 0; persist(ctx); };
            if (l.link && on) {
                const lk = add('link', box);
                lk.style.left = X(g.textS) + 'px'; lk.style.top = (top0 + i * LANE_H - 4) + 'px'; lk.style.height = '8px';
            }
        });
    }

    // Writes a new start / length / trim back as an offset from the sound's anchor.
    function apply(l, start, len, tin, q, lenGiven) {
        l.trimIn = tin;
        if (lenGiven) { l.len = len; l.lenMode = 'fixed'; }
        const useLen = lenModeOf(l) === 'clip' ? clipLen(l, 0, q.textS, q.textE, q.full - tin) : ((num(l.len, 0) > 0) ? l.len : (q.full - tin));
        l.offset = clamp(Math.round(offsetFor(q.align === 'end' || q.align === 'after' ? q.align : 'start', start, useLen, q.textS, q.textE)), -900, 900);
    }

    function drag(d, df, dy) {
        const ctx = d.ctx, l = layersOf(ctx).find(x => x.id === d.lid);
        if (!l) return;
        if (d.kind === 'lyrVol') {
            const bh = d.bh || 36;
            let v = Math.round((num(d.v0, 0) - dy / bh * (VOL_MAX - VOL_MIN)) * 2) / 2;
            if (Math.abs(v) <= 0.75) v = 0;
            l.volume = clamp(v, VOL_MIN, VOL_MAX);
            persist(ctx);
            return;
        }
        const q = d.l0; if (!q) return;
        if (d.kind === 'lyrFade') {
            let f = clamp(q.fade - df, 0, q.len);                // dragging the corner left makes the fade longer
            if (Math.abs(f - Math.round(q.fps)) <= 1) f = Math.round(q.fps);   // snap to 1 s
            l.fade = f;
            persist(ctx);
            return;
        }
        let start = q.start, len = q.len, tin = q.tin, lenGiven = false;
        if (d.kind === 'lyr') {
            start = q.start + df;
            if (Math.abs(start - q.textS) <= 1) start = q.textS;                       // snap to the text start
            else if (Math.abs(start + q.len - q.textE) <= 1) start = q.textE - q.len;  // or so it ends with the text
        } else if (d.kind === 'lyrIn') {
            const dd = clamp(df, -q.tin, q.len - 1);
            start = q.start + dd; tin = q.tin + dd; len = q.len - dd;
            lenGiven = !q.auto;
        } else if (d.kind === 'lyrOut') {
            len = clamp(q.len + df, 1, q.full - q.tin);
            if (Math.abs(q.start + len - q.textE) <= 1 && q.textE - q.start >= 1 && q.textE - q.start <= q.full - q.tin) len = q.textE - q.start;
            lenGiven = true;
        }
        apply(l, start, len, tin, q, lenGiven);
        persist(ctx);
    }

    // Every extra sound that is on, as { path, start, end, tin, volume (dB), fade (frames) } in timeline frames (used by scrubbing).
    function voices(ctx, m, g) {
        const out = [];
        for (const l of layersOf(ctx)) {
            if (l.enabled === false || !l.file) continue;
            const q = layerGeo(m, g, l);
            if (q.path) out.push({ path: q.path, start: q.start, end: q.end, tin: q.tin, volume: num(l.volume, 0), fade: q.fade });
        }
        return out;
    }

    window.SASounds = { sync, lanes, range, voices, selectFor, drag, handle, pickerButtons, moreButton, layersFor: layersOf, volLine, volFrac, LANE_H, LANE0 };
})();
