// Collage B-roll, the pure part: shared by the B-roll tab's Collage pane (src/main/collage.js) and the command-line
// renderer (broll/collage/render-collage.mjs). A collage project is a folder per timeline holding shots.json (the
// beats, in timeline frames from the timeline's first frame), transcript.json (word timings), assets/ (the pictures in
// use), candidates/<beat>/ (pictures found on Wikimedia Commons) and render/ (the clips, plan.json, captions.srt).

// What a beat shows (broll/src/collage/CollageTrack.tsx). talking-head draws nothing but its title overlay; clip plays a
// video in a photo card.
const VISUALS = ['talking-head', 'photo', 'stack', 'clip', 'medallion', 'document', 'title'];
// Beats that need pictures: how many at least (a medallion draws an illustration when it has none).
const PICTURE_VISUALS = { photo: 1, stack: 2, clip: 1, document: 1, medallion: 0 };

// The clips a project renders: one per run of back-to-back B-roll beats (a talking-head beat ends a run) and one per
// talking-head beat with a title overlay. -> [{ role: 'broll' | 'title', from, to, beats: [id] }]
function segmentsOf(beats) {
    const segs = [];
    let run = null;
    const list = [...(beats || [])].filter(b => b && Array.isArray(b.frames)).sort((x, y) => x.frames[0] - y.frames[0]);
    for (const b of list) {
        const [a, e] = b.frames;
        if (b.visual === 'talking-head') {
            if (run) { segs.push(run); run = null; }
            if ((b.overlays || []).some(o => o && o.type === 'title')) segs.push({ role: 'title', from: a, to: e, beats: [b.id] });
            continue;
        }
        if (run && a <= run.to + 1) { run.to = Math.max(run.to, e); run.beats.push(b.id); } else { if (run) segs.push(run); run = { role: 'broll', from: a, to: e, beats: [b.id] }; }
    }
    if (run) segs.push(run);
    return segs;
}

// The caption chunks, as broll/src/collage/Captions.tsx draws them: a break after punctuation, at a pause longer than
// 8 frames, at maxWords or at maxChars. A chunk ends at the next one's start or 10 frames after its last word.
function captionChunks(words, cfg) {
    const c = { maxWords: 3, maxChars: 18, ...(cfg || {}) };
    const out = [];
    let cur = [];
    const len = (ws) => ws.map(w => w.w).join(' ').length;
    for (const w of words || []) {
        if (cur.length && (cur.length >= c.maxWords || w.start - cur[cur.length - 1].end > 8 || len([...cur, w]) > c.maxChars)) { out.push(cur); cur = []; }
        cur.push(w);
        if (/[.,?!;:]$/.test(w.w)) { out.push(cur); cur = []; }
    }
    if (cur.length) out.push(cur);
    return out.map((ws, i) => ({ words: ws, start: ws[0].start, end: Math.min(out[i + 1] ? out[i + 1][0].start : Infinity, ws[ws.length - 1].end + 10) }));
}

function srtOf(words, fps, cfg) {
    const tc = (f) => {
        const ms = Math.max(0, Math.round(f / fps * 1000));
        const z = (v, l = 2) => String(v).padStart(l, '0');
        return z(Math.floor(ms / 3600000)) + ':' + z(Math.floor(ms / 60000) % 60) + ':' + z(Math.floor(ms / 1000) % 60) + ',' + z(ms % 1000, 3);
    };
    return captionChunks((words || []).map(w => ({ w: w.w, start: Math.round(w.start), end: Math.round(w.end) })), cfg)
        .map((c, i) => (i + 1) + '\n' + tc(c.start) + ' --> ' + tc(c.end) + '\n' + c.words.map(w => w.w).join(' ') + '\n').join('\n');
}

// A new render never overwrites a clip Resolve may have open: once render/ has clips, the next set is -v<n+1>.
function nextSuffix(names) {
    let top = 0;
    for (const n of names || []) {
        const m = /^(?:broll|title|captions)(?:-\d{5}-\d{5})?(?:-v(\d+))?\.mov$/.exec(n);
        if (m) top = Math.max(top, m[1] ? Number(m[1]) : 1);
    }
    return top ? '-v' + (top + 1) : '';
}

function clipFile(role, from, to, suffix) {
    const p = (n) => String(Math.round(n)).padStart(5, '0');
    return role === 'captions' ? 'captions' + (suffix || '') + '.mov' : role + '-' + p(from) + '-' + p(to) + (suffix || '') + '.mov';
}

// A starting plan: one talking-head beat per subtitle, in frames from the timeline's first frame. A pause shorter than
// `holdGap` frames joins the beats (a B-roll run then holds through it instead of flashing the speaker).
function beatsFromSubtitles(subs, tlStart, holdGap) {
    const list = [...(subs || [])].filter(s => s && s.end > s.start).sort((a, b) => a.start - b.start);
    const gap = Number.isFinite(holdGap) ? holdGap : 45;
    return list.map((s, i) => {
        const a = Math.round(s.start - tlStart);
        let e = Math.round(s.end - tlStart);
        const next = list[i + 1];
        if (next && next.start - s.end <= gap) e = Math.round(next.start - tlStart);
        return {
            id: 'b' + String(i + 1).padStart(2, '0'), frames: [a, Math.max(a + 1, e)], line: String(s.text || '').replace(/\s+/g, ' ').trim(),
            visual: 'talking-head', brief: [], assets: [], overlays: [], drift: 'push-in'
        };
    });
}

// Word timings estimated from the subtitles when there is no transcription: each subtitle's frames shared out by the
// words' lengths. -> [{ w, start, end }] in frames from the timeline's first frame.
function wordsFromSubtitles(subs, tlStart) {
    const out = [];
    for (const s of [...(subs || [])].sort((a, b) => a.start - b.start)) {
        const ws = String(s.text || '').split(/\s+/).filter(Boolean);
        if (!ws.length || !(s.end > s.start)) continue;
        const total = ws.reduce((n, w) => n + w.length + 1, 0);
        let at = s.start - tlStart;
        const per = (s.end - s.start) / total;
        for (const w of ws) {
            const d = (w.length + 1) * per;
            out.push({ w, start: Math.round(at * 100) / 100, end: Math.round((at + d) * 100) / 100 });
            at += d;
        }
    }
    return out;
}

// A beat keeps its pictures and its clip when its visual changes; each visual uses its own kind (a clip beat the
// videos, every other one the pictures), so switching back and forth loses nothing.
const isVideoName = (n) => /\.(mp4|webm|mov)$/i.test(String(n || ''));
function assetsFor(b) {
    const all = (b && b.assets) || [];
    return b && b.visual === 'clip' ? all.filter(isVideoName) : all.filter(n => !isVideoName(n));
}

// -> { need, have, missing } for a beat's pictures (its clip, for a clip beat).
function pictureNeed(b) {
    const need = (b && PICTURE_VISUALS[b.visual]) || 0;
    const have = assetsFor(b).length;
    return { need, have, missing: Math.max(0, need - have) };
}

// Width and height from a PNG, JPEG or WebP file's header (no ffprobe in Electron's PATH). -> { w, h } or null.
function imageSize(buf) {
    if (!buf || buf.length < 30) return null;
    if (buf[0] === 0x89 && buf.toString('ascii', 1, 4) === 'PNG') return { w: buf.readUInt32BE(16), h: buf.readUInt32BE(20) };
    if (buf.toString('ascii', 0, 4) === 'RIFF' && buf.toString('ascii', 8, 12) === 'WEBP') {
        const kind = buf.toString('ascii', 12, 16);
        if (kind === 'VP8X') return { w: 1 + buf.readUIntLE(24, 3), h: 1 + buf.readUIntLE(27, 3) };
        if (kind === 'VP8 ') return { w: buf.readUInt16LE(26) & 0x3fff, h: buf.readUInt16LE(28) & 0x3fff };
        if (kind === 'VP8L') { const b = buf.readUInt32LE(21); return { w: 1 + (b & 0x3fff), h: 1 + ((b >> 14) & 0x3fff) }; }
        return null;
    }
    if (buf[0] === 0xff && buf[1] === 0xd8) {
        let i = 2;
        while (i + 9 < buf.length) {
            if (buf[i] !== 0xff) { i++; continue; }
            const m = buf[i + 1];
            if (m === 0xd8 || m === 0x01 || (m >= 0xd0 && m <= 0xd7)) { i += 2; continue; }
            const len = buf.readUInt16BE(i + 2);
            if (m >= 0xc0 && m <= 0xcf && m !== 0xc4 && m !== 0xc8 && m !== 0xcc) return { w: buf.readUInt16BE(i + 7), h: buf.readUInt16BE(i + 5) };
            i += 2 + len;
        }
    }
    return null;
}

// credits.csv: quoted cells, "" for a quote, line breaks inside quotes.
function parseCsv(text) {
    const rows = [];
    let row = [], cell = '', q = false;
    const s = String(text || '');
    for (let i = 0; i < s.length; i++) {
        const ch = s[i];
        if (q) {
            if (ch === '"' && s[i + 1] === '"') { cell += '"'; i++; } else if (ch === '"') q = false; else cell += ch;
        } else if (ch === '"') q = true;
        else if (ch === ',') { row.push(cell); cell = ''; } else if (ch === '\n' || ch === '\r') {
            if (ch === '\r' && s[i + 1] === '\n') i++;
            row.push(cell); rows.push(row); row = []; cell = '';
        } else cell += ch;
    }
    if (cell !== '' || row.length) { row.push(cell); rows.push(row); }
    return rows.filter(r => r.length > 1 || r[0] !== '');
}
function csvLine(cells) {
    return cells.map(c => { const v = c === undefined || c === null ? '' : String(c); return /[",\n\r]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v; }).join(',');
}

const CREDIT_HEAD = ['beat_id', 'asset', 'title', 'creator', 'date', 'license', 'license_url', 'source_page', 'original_size', 'attribution'];

// credits.csv with a row for a picked Commons picture. A picture already credited keeps its row and gains the beat
// ("b02;b04").
function withCredit(text, beat, asset, c) {
    const rows = parseCsv(text);
    const head = rows.length ? rows[0] : CREDIT_HEAD;
    const had = rows.slice(1).find(r => r[1] === asset);
    if (had) {
        const ids = String(had[0] || '').split(';').filter(Boolean);
        if (!ids.includes(beat)) had[0] = [...ids, beat].join(';');
        return rows.map(csvLine).join('\n') + '\n';
    }
    const body = rows.slice(1);
    const title = String((c && c.title) || asset).replace(/^File:/, '');
    const creator = (c && c.creator) || '';
    const lic = (c && c.license) || '';
    const cells = {
        beat_id: beat, asset, title, creator, date: (c && c.date) || '', license: lic, license_url: (c && c.licenseUrl) || '',
        source_page: (c && c.page) || '', original_size: c && c.width ? c.width + 'x' + c.height : '',
        attribution: title + (creator ? ' by ' + creator : '') + (lic ? ', ' + lic : '') + ', via ' + ((c && c.source) || 'Wikimedia Commons')
    };
    body.push(head.map(k => cells[k] !== undefined ? cells[k] : ''));
    return [head, ...body].map(csvLine).join('\n') + '\n';
}
function withoutCredit(text, asset) {
    const rows = parseCsv(text);
    if (!rows.length) return String(text || '');
    return [rows[0], ...rows.slice(1).filter(r => r[1] !== asset)].map(csvLine).join('\n') + '\n';
}

// The sizes the collage needs for its pictures and clips: a clip's from assets/clips.json (written when it was picked),
// a picture's from its file header (readHead(name) -> Buffer or null).
function assetMetaOf(beats, readHead, clips) {
    const out = {};
    for (const b of beats || []) for (const n of (b && b.assets) || []) {
        if (out[n]) continue;
        const c = clips && clips[n];
        const s = c && c.w && c.h ? { w: c.w, h: c.h } : imageSize(readHead(n));
        if (s) out[n] = s;
    }
    return out;
}

// A clip beat's in-point (seconds), kept inside the clip: the beat's length (and half a second) must still fit.
function clampClipStart(v, duration, beatFrames, fps) {
    const want = Math.max(0, Number(v) || 0);
    if (!(duration > 0)) return Math.round(want * 10) / 10;
    const room = Math.max(0, duration - beatFrames / (fps || 30) - 0.5);
    return Math.round(Math.min(want, room) * 10) / 10;
}

// Sound cues for a collage, in frames from the timeline's first frame (the moments CollageTrack.tsx animates):
//   whoosh  a card, clip or medallion coming in (it leads by `lead` frames so the swoosh peaks as the card lands)
//   hit     a title card (on the backdrop, or over the speaker)
//   pop     each further card of a photo stack (they enter 9 frames apart)
//   click   a date tag or name label popping on
//   marker  a callout circle being drawn, a document's highlighter
// Cues closer than `minGap` frames keep the stronger one (hit > whoosh > pop > marker > click). Each cue's `len` ends at
// its own moment (a per-kind cap) and before the next cue, so the sounds never run into each other or past the beat.
const SFX_RANK = { hit: 5, whoosh: 4, pop: 3, marker: 2, click: 1 };
const SFX_CAP = { hit: 40, whoosh: 30, pop: 14, marker: 30, click: 12 };    // frames at 30 fps
function sfxCuesOf(beats, opts) {
    const o = opts || {};
    const fps = o.fps || 30, k = fps / 30, lead = Math.round(3 * k), minGap = Math.round((o.minGap || 6) * k);
    const raw = [];
    const add = (frame, kind, beat) => { if (frame >= 0) raw.push({ frame: Math.round(frame), kind, beat }); };
    const list = [...(beats || [])].filter(b => b && Array.isArray(b.frames)).sort((x, y) => x.frames[0] - y.frames[0]);
    list.forEach((b, i) => {
        const [a, e] = b.frames;
        const ov = b.overlays || [];
        if (b.visual === 'talking-head') {
            for (const t of ov.filter(x => x && x.type === 'title')) add(a + (t.at ?? 10), 'hit', b.id);
            return;
        }
        const prev = list[i - 1];
        // a card that follows straight on from another card still whooshes; a title card hits instead
        if (b.visual === 'title') { const t = ov.find(x => x && x.type === 'title'); add(a + ((t && t.at) ?? 2), 'hit', b.id); } else add(a - (prev && prev.visual !== 'talking-head' ? 0 : lead), 'whoosh', b.id);
        if (b.visual === 'stack') { const n = Math.min(4, assetsFor(b).length); for (let j = 1; j < n; j++) add(a + j * 9, 'pop', b.id); }
        if (b.visual === 'document') add(a + (b.highlightAt ?? 16), 'marker', b.id);
        for (const x of ov) {
            if (!x || x.type === 'title') continue;
            const at = x.at ?? (x.type === 'date' ? 8 : x.type === 'label' ? 12 : 16);
            if (a + at < e) add(a + at, x.type === 'date' || x.type === 'label' ? 'click' : 'marker', b.id);
        }
    });
    raw.sort((x, y) => x.frame - y.frame || SFX_RANK[y.kind] - SFX_RANK[x.kind]);
    const kept = [];
    for (const c of raw) {
        const last = kept[kept.length - 1];
        if (last && c.frame - last.frame < minGap) { if (SFX_RANK[c.kind] > SFX_RANK[last.kind]) kept[kept.length - 1] = c; continue; }
        kept.push(c);
    }
    return kept.map((c, i) => {
        const next = kept[i + 1];
        const len = Math.max(2, Math.min(Math.round(SFX_CAP[c.kind] * k), next ? next.frame - c.frame : Infinity));
        return { ...c, len };
    });
}

// A timeline name as a folder name.
function safeName(name) {
    return String(name || 'timeline').replace(/[/\\:*?"<>|]+/g, '-').replace(/\s+/g, ' ').trim().slice(0, 120) || 'timeline';
}

// The asset name a picked candidate gets: <candidates folder>-<NN>.<ext> ("b03-01.jpg").
function candidateAsset(dirName, file) {
    const m = /^(\d+)(\.\w+)$/.exec(String(file || ''));
    return m ? dirName + '-' + m[1] + m[2].toLowerCase() : dirName + '-' + String(file || '');
}

// ------------------------------------------------------------------ auto plan (the Auto-fill button, MCP collage_auto)

// Words that never make a picture search.
const STOP = new Set(('a an the and or but so if then than that this these those there here it its is are was were be been being am do does ' +
    'did doing done have has had having i you he she we they me him her us them my your his our their mine yours what which who whom whose ' +
    'when where why how all any both each few more most other some such no nor not only own same too very can will just should could would ' +
    'might must shall may of in on at by for with about against between into through during before after above below to from up down out ' +
    'off over under again further once also really actually basically literally like get got gets getting gonna wanna kind sort thing things ' +
    'stuff way lot lots yeah yes okay ok well right know knew think thought mean means said say says saying going go goes went gone make makes ' +
    'made one two because even still much many every never always something anything nothing everything someone anyone everyone else ' +
    'maybe probably pretty quite rather enough ever already now today then soon back just let lets look looks want wants need needs ' +
    'come comes came take takes took give gives gave keep keeps put tell told see seen saw use used using try tried while until since ' +
    'though although whether either neither instead around away first last next new old good bad big little great best better worse ' +
    'dont doesnt didnt isnt arent wasnt werent wont cant couldnt wouldnt shouldnt im youre were theyre thats theres heres whats ive youve ' +
    'weve theyve ill youll hell shell well theyll id youd hed shed wed theyd mr mrs ms dr except nobody somebody anybody ' +
    'everybody whatever whenever wherever however therefore called calls really whole part parts kinds ways times reason reasons ' +
    'without within along across behind beyond upon onto toward towards versus via per everywhere anywhere nowhere somewhere').split(/\s+/));
// -ing words that are not actions.
const NOT_ACTION = new Set(['something', 'anything', 'nothing', 'everything', 'thing', 'things', 'morning', 'evening', 'during', 'being', 'string', 'king', 'ring', 'spring', 'wing', 'ceiling', 'building', 'clothing', 'feeling', 'meaning', 'interesting', 'amazing', 'according']);
const YEAR = /^(1[0-9]{3}|20[0-9]{2})(s)?$/;

// The words of a subtitle line that can be searched: years, names (capitalised runs: "Jacques Cousteau") and content
// words (no stop words, at least 4 letters), in order. -> { years, names, words, actions }
function lineKeywords(line) {
    const toks = String(line || '').split(/\s+/).filter(Boolean);
    const years = [], names = [], words = [], actions = [];
    let run = [], sentenceStart = true;
    const endRun = () => {
        // a lone capitalised word at the start of a sentence is just the sentence's first word
        if (run.length > 1 || (run.length === 1 && !run[0].first)) names.push(run.map(r => r.w).join(' '));
        run = [];
    };
    for (const raw of toks) {
        const w = raw.replace(/^[^\p{L}\p{N}$]+|[^\p{L}\p{N}%]+$/gu, '');
        const bare = w.toLowerCase().replace(/[’']/g, '');
        const first = sentenceStart;
        sentenceStart = /[.!?:]["”’)]*$/.test(raw);
        if (!w) { endRun(); continue; }
        const y = YEAR.exec(w);
        if (y) { endRun(); if (!years.includes(w)) years.push(w); continue; }
        if (/^\p{Lu}/u.test(w) && bare !== 'i' && !STOP.has(bare) && w.length > 1) {
            run.push({ w, first });
            if (/[,;]["”’)]*$/.test(raw) || sentenceStart) endRun();
        } else endRun();
        if (STOP.has(bare) || bare.length < 4 || /^\d+$/.test(bare)) continue;
        if (!words.includes(bare)) words.push(bare);
        if (/ing$/.test(bare) && bare.length > 5 && !NOT_ACTION.has(bare) && !actions.includes(bare)) actions.push(bare);
    }
    endRun();
    return { years, names: [...new Set(names)], words, actions };
}

// A beat nobody has set up yet: still the talking head Start project made, with nothing searched, picked or laid over.
function untouchedBeat(b) {
    return !!b && (b.visual || 'talking-head') === 'talking-head' && !(b.queries && b.queries.length) && !(b.assets && b.assets.length) &&
        !(b.overlays && b.overlays.length) && !(b.brief && b.brief.length);
}

// What an untouched beat would show, from its line: { visual, queries, overlays, score } (score 0 = nothing to show).
// Years make a photo with a date tag, a name a photo with a name label, two names a photo stack, an action
// a video clip (only with a stock site, opts.video: Commons has few clips), anything else a photo of its two longest
// content words (verb-like -ed / -ly / -ing words last).
function beatIdea(line, opts) {
    const k = lineKeywords(line);
    // longest first, words that read like verbs or adverbs (-ed, -ly, -ing) last
    const verbish = (w) => /(ed|ly|ing)$/.test(w) ? 1 : 0;
    const byLen = [...k.words].sort((x, y) => verbish(x) - verbish(y) || y.length - x.length);
    const score = k.years.length * 3 + Math.min(2, k.names.length) * 2 + Math.min(3, k.words.length);
    const year = k.years[0] || '';
    const overlays = [];
    if (year) overlays.push({ type: 'date', text: year });
    let visual = 'photo', queries;
    if (k.names.length >= 2) {
        visual = 'stack';
        queries = k.names.slice(0, 3).map(n => (year ? n + ' ' + year.replace(/s$/, '') : n));
    } else if (k.names.length === 1) {
        const n = k.names[0];
        queries = [year ? n + ' ' + year.replace(/s$/, '') : n, n];
        if (!year && n.includes(' ')) overlays.push({ type: 'label', text: n.toUpperCase() });
    } else if (opts && opts.video && k.actions.length && !year) {
        visual = 'clip';
        const noun = byLen.find(w => !k.actions.includes(w));
        queries = [noun ? k.actions[0] + ' ' + noun : k.actions[0], k.actions[0]];
    } else {
        const top = byLen.slice(0, 2);
        queries = [top.join(' '), top[0] || ''];
        if (year) queries = queries.filter(Boolean).map(q => q + ' ' + year.replace(/s$/, ''));
    }
    queries = [...new Set(queries.map(q => q.trim()).filter(Boolean))];
    return { visual, queries, overlays, score: queries.length ? score : 0 };
}

// Auto-fill: which untouched beats get B-roll, and what each shows. The first beat stays on the speaker; a beat
// shorter than minSec does too; at most maxRun B-roll beats in a row; B-roll covers at most `coverage` of the
// untouched beats' time, the strongest lines (years, names, most content words) first. Beats someone already set up
// count toward the runs but are never changed.
// -> { beats: the whole list (thoughts joined, B-roll beats set up), planned: [ids that got B-roll] }
function autoPlanBeats(beats, opts) {
    const o = { fps: 30, coverage: 0.5, minSec: 1.2, maxRun: 2, minScore: 2, ...(opts || {}) };
    const list = groupThoughts(beats, o);
    const len = (b) => b.frames[1] - b.frames[0];
    const free = list.filter(untouchedBeat);
    const budget = free.reduce((n, b) => n + len(b), 0) * Math.max(0, Math.min(1, o.coverage));
    const isB = new Map(list.map(b => [b.id, !untouchedBeat(b) && (b.visual || 'talking-head') !== 'talking-head']));
    const ideas = new Map();
    for (const [i, b] of list.entries()) {
        if (!untouchedBeat(b) || i === 0 || len(b) < o.minSec * o.fps) continue;
        const idea = beatIdea(b.line, o);
        if (idea.score >= o.minScore) ideas.set(b.id, idea);
    }
    const runWith = (id) => {
        const i = list.findIndex(b => b.id === id);
        let n = 1;
        for (let j = i - 1; j >= 0 && isB.get(list[j].id); j--) n++;
        for (let j = i + 1; j < list.length && isB.get(list[j].id); j++) n++;
        return n;
    };
    let used = 0;
    const order = [...ideas.entries()].sort((x, y) => y[1].score - x[1].score || list.findIndex(b => b.id === x[0]) - list.findIndex(b => b.id === y[0]));
    for (const [id] of order) {
        const b = list.find(x => x.id === id);
        if (used + len(b) > budget) continue;
        isB.set(id, true);
        if (runWith(id) > o.maxRun) { isB.set(id, false); continue; }
        used += len(b);
    }
    const planned = [];
    const out = list.map(b => {
        if (!(ideas.has(b.id) && isB.get(b.id))) return b;
        planned.push(b.id);
        const { visual, queries, overlays } = ideas.get(b.id);
        return { ...b, visual, queries, overlays };
    });
    return { beats: out, planned };
}

// Start project makes one beat per subtitle, and subtitles are often a second-long piece of a sentence ("It looks
// like a" / "harmless neighborhood" / "greeting."): a picture per piece would flash by. Runs of untouched beats are
// joined into thoughts: up to the end of a sentence, at least minThought s (default 2.5), never past maxThought s
// (default 5). A beat someone set up stays as it is and ends the run. The joined beat keeps the first one's id.
function groupThoughts(beats, opts) {
    const o = { fps: 30, minThought: 2.5, maxThought: 5, ...(opts || {}) };
    const list = [...(beats || [])].filter(b => b && Array.isArray(b.frames)).sort((x, y) => x.frames[0] - y.frames[0]);
    const out = [];
    let cur = null;
    const close = () => { if (cur) out.push(cur); cur = null; };
    for (const b of list) {
        if (!untouchedBeat(b)) { close(); out.push(b); continue; }
        if (cur && (b.frames[0] > cur.frames[1] + o.fps || b.frames[1] - cur.frames[0] > o.maxThought * o.fps)) close();
        if (!cur) cur = { ...b, frames: [...b.frames] };
        else { cur.frames[1] = Math.max(cur.frames[1], b.frames[1]); cur.line = (cur.line + ' ' + (b.line || '')).trim(); }
        const sec = (cur.frames[1] - cur.frames[0]) / o.fps;
        if (/[.!?]["”’)]*$/.test(String(cur.line || '').trim()) ? sec >= o.minThought * 0.6 : sec >= o.minThought) close();
    }
    close();
    return out;
}

// The candidates Auto-fill picks for a beat: in the search's order (a picture several searches found comes first), not
// one another beat already uses (by title), the clip for a clip beat, up to 3 for a stack, else as many as it needs.
// -> [candidate file]
function autoPicks(candidates, visual, usedTitles) {
    const bare = (t) => String(t || '').replace(/^File:/, '');
    const used = new Set((usedTitles || []).map(bare));
    const want = visual === 'stack' ? 3 : (PICTURE_VISUALS[visual] || 1);
    const pool = (candidates || []).filter(c => c && c.file && (visual === 'clip' ? !!c.video : !c.video));
    const fresh = pool.filter(c => !used.has(bare(c.title)));
    const pick = fresh.length >= Math.min(want, pool.length) ? fresh : pool;
    return pick.slice(0, want).map(c => c.file);
}

// ------------------------------------------------------------------ evidence (a real post or tarpaulin on a document beat)

// Words on a poster that say nothing about who or where: kept sharp. Filipino greetings too.
const GENERIC = new Set(('happy fiesta barangay brgy sitio purok greetings greeting from merry christmas new year maligayang pasko bagong taon ' +
    'mabuhay salamat congratulations congrats graduates graduation mayor vice governor councilor kagawad captain kapitan congressman ' +
    'senator president hon honorable atty engr dr vote for me january february march april may june july august september october ' +
    'november december').split(/\s+/));
const normWord = (w) => String(w || '').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '');
const pad = ([x, y, w, h], px, py) => {
    const a = Math.max(0, x - px), b = Math.max(0, y - py);
    return [a, b, Math.min(1, x + w + px) - a, Math.min(1, y + h + py) - b].map(v => Math.round(v * 10000) / 10000);
};
const union = (rs) => {
    const x0 = Math.min(...rs.map(r => r[0])), y0 = Math.min(...rs.map(r => r[1]));
    const x1 = Math.max(...rs.map(r => r[0] + r[2])), y1 = Math.max(...rs.map(r => r[1] + r[3]));
    return [x0, y0, x1 - x0, y1 - y0];
};
const overlap = (a, b) => Math.max(0, Math.min(a[0] + a[2], b[0] + b[2]) - Math.max(a[0], b[0])) * Math.max(0, Math.min(a[1] + a[3], b[1] + b[3]) - Math.max(a[1], b[1]));

// Where the camera zooms: the biggest highlight and the ones right next to it (the two lines of one banner, not every
// banner on a street photo), with room around them, at least 25% of the picture each way. null = none.
function zoomFor(highlights) {
    if (!highlights || !highlights.length) return null;
    const big = [...highlights].sort((a, b) => b[2] * b[3] - a[2] * a[3])[0];
    const near = highlights.filter(r => Math.abs((r[1] + r[3] / 2) - (big[1] + big[3] / 2)) <= big[3] * 2.2 &&
        Math.abs((r[0] + r[2] / 2) - (big[0] + big[2] / 2)) <= Math.max(big[2], r[2]));
    const u = pad(union(near), 0.05, 0.05);
    const w = Math.max(0.25, u[2]), h = Math.max(0.25, u[3]);
    const cx = u[0] + u[2] / 2, cy = u[1] + u[3] / 2;
    const x = Math.min(1 - w, Math.max(0, cx - w / 2)), y = Math.min(1 - h, Math.max(0, cy - h / 2));
    return [x, y, w, h].map(v => Math.round(v * 10000) / 10000);
}

// From a vision-scan.swift result: highlight the words the speaker says (runs of them, a line at a time, up to 3),
// zoom onto them, and suggest blurs (used only when the beat's Blur switch is on) for what identifies someone or
// somewhere: every face, and each text line with a word that is
// neither common English (opts.common, a Set of lower-case words) nor GENERIC, nor said in the line (a place or person
// name, a hashtag or handle). Words in opts.keep stay sharp, words in opts.blur are always blurred.
// -> { highlights: [rect], blurs: [rect], zoom: rect | null, found: { said: [text], blurred: [text] } }
function evidencePlan(scan, opts) {
    const o = opts || {};
    const common = o.common || new Set();
    const lineWords = String(o.line || '').split(/\s+/).map(normWord).filter(Boolean);
    const said = new Set(lineWords.filter(w => w.length > 1 && !STOP.has(w)));      // a run starts on one of these
    const saidAll = new Set(lineWords);                                               // and carries on through these
    const keep = new Set((o.keep || []).map(normWord)), blurWords = new Set((o.blur || []).map(normWord));
    const highlights = [], blurs = [], found = { said: [], blurred: [] };
    for (const ln of (scan && scan.lines) || []) {
        const words = (ln.words && ln.words.length ? ln.words : [{ text: ln.text, box: ln.box }]).filter(w => w && w.box);
        // runs of said words: one that matters starts it, any word of the line carries it on ("VOTE FOR ME")
        let run = [];
        const flush = () => {
            while (run.length && !saidAll.has(normWord(run[run.length - 1].text))) run.pop();
            if (run.length && highlights.length < 3) { highlights.push(pad(union(run.map(w => w.box)), 0.004, 0.006)); found.said.push(run.map(w => w.text).join(' ')); }
            run = [];
        };
        for (const w of words) {
            const n = normWord(w.text);
            if (said.has(n) || (run.length && saidAll.has(n))) run.push(w);
            else flush();
        }
        flush();
        const identifying = words.some(w => {
            const n = normWord(w.text);
            if (!n || keep.has(n) || said.has(n)) return false;
            if (blurWords.has(n) || /^[#@]/.test(w.text)) return true;
            return n.length > 2 && !/^\d+$/.test(n) && !common.has(n) && !GENERIC.has(n);
        });
        if (identifying && !highlights.some(h => overlap(h, ln.box) > 0.5 * ln.box[2] * ln.box[3])) {
            blurs.push(pad(ln.box, 0.012, 0.012));
            found.blurred.push(ln.text);
        }
    }
    for (const f of (scan && scan.faces) || []) blurs.push(pad(f, f[2] * 0.25, f[3] * 0.35));
    return { highlights, blurs, zoom: zoomFor(highlights), found };
}

// The beats as the renderer gets them: a document's blurs are the found ones while its Blur switch is on, plus the
// boxes drawn by hand.
function renderBeats(beats) {
    return (beats || []).map(b => (b && b.visual === 'document' ? { ...b, blurs: [...(b.blurOn ? b.blurAuto || [] : []), ...(b.blurBoxes || [])] } : b));
}

// The export list is at the end: VISUALS / PICTURE_VISUALS are consts.
module.exports = {
    VISUALS, PICTURE_VISUALS, segmentsOf, captionChunks, srtOf, nextSuffix, clipFile, beatsFromSubtitles,
    wordsFromSubtitles, pictureNeed, imageSize, parseCsv, csvLine, withCredit, withoutCredit, safeName, candidateAsset,
    assetMetaOf, clampClipStart, assetsFor, isVideoName, sfxCuesOf, lineKeywords, untouchedBeat, beatIdea, autoPlanBeats, groupThoughts, autoPicks,
    evidencePlan, zoomFor, renderBeats
};
