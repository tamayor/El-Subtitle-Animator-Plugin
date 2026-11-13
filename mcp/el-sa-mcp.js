#!/usr/bin/env node
// El Subtitle Animator MCP server (stdio, no dependencies).
// Lets Claude Code animate a Resolve timeline's subtitles with your presets, through the open plugin panel.
//
// Register once:
//   claude mcp add el-subtitle-animator -- node "/path/to/El Subtitle Animator Plugin/mcp/el-sa-mcp.js"
// The plugin panel must be open in Resolve: it writes its local address and token to
// ~/.el-subtitle-animator/mcp-endpoint.json when it starts (see src/main/automation.js).

'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');

const MEDIA = require('../src/main/media-analysis');
const LINES = require('../src/main/line-break');

const ENDPOINT_FILE = path.join(os.homedir(), '.el-subtitle-animator', 'mcp-endpoint.json');
const SERVER_INFO = { name: 'el-subtitle-animator', version: '1.0.0' };

const INSTRUCTIONS = `El Subtitle Animator turns a DaVinci Resolve timeline's subtitles into animated Text+/MultiText clips (with sound effects) from the user's preset library.

Workflow for editing a video:
1. Call get_rules first and follow them. The user's "notes" are their own editing rules. If the user states rules for this video (allowed emoji tags, font, text colour, emphasis font/colour, layer, placement, max text size, line spacing, highlight box auto-balance / width / height / x / y), save them with set_rules before placing anything. When the font/colour override should only apply to some presets, pass keepPresetStyle: true on place for the others.
2. list_presets returns only presets allowed by the rules' tags. Never use a preset outside that list.
3. list_subtitles, then plan. Read the subtitles as sentences, not as Resolve's cuts: a cut often falls mid-thought ("If this is the bar then it's" / "fine, but the bar is this."). Group the words by thought ("If this is the bar then" / "it's fine, but the bar is this."; "So yeah, watch this" / "shit man. Come on." -> "So yeah," / "watch this shit man." / "Come on."): never leave a word stranded from the phrase it belongs to. For such a run call regroup with the subtitle numbers and your phrases, then place each phrase with its text, subtitle, startFrame and endFrame. Plan which subtitles get an animation (not necessarily all of them; vary presets and avoid repeating the same one back to back), which preset fits each line (one-word / one-line / multi-line / money / emphasis presets by name and tag), and for MultiText presets which word(s) to emphasize (pass parts {upper, emphasis, lower} that together spell the subtitle).
4. Layout: if the user gives a safe-zone reference image, call set_layout with its path (look at the image yourself and pass the labels you read as guideNames top to bottom / zoneNames). A layout only applies to timelines of the same shape as its image (a 9:16 social safe zone is ignored on a 16:9 timeline; get_layout says appliesToThisTimeline). When it applies, place keeps every clip inside its safe area and off its zones (shrinking textSize if needed), and the user can say e.g. "centre the subtitle on the captions line" (guide: "captions") or "in the captions area" (guide: "captions", align: "below").
5. When rules.position.avoidFaces is true, call get_frame for the subtitle and look at it. Choose x/y (0..1, top-left origin = where the text's centre goes) so the text sits on empty space and never over a face, eyes or mouth, and stays inside the safe area. Check get_tracks if layer placement matters.
6. Call place for each subtitle (once placed, its subtitle clip is disabled so it does not show under the animation; remove_placed re-enables it). Long lines: pass text with a "\\n" line break, and if the text would run off the frame pass textSize (e.g. 0.66) rather than scale. After the first few, call get_frame (at: "end", when all words are in) to check the result, and use remove_placed to fix mistakes.
Measuring (ffmpeg, local): find_cuts before placing over B-roll (shots with bright: true are light cutaways where white text disappears: accent colour, empty top space, and split a caption that crosses a cut at the cut frame); find_beats when there is music (land pops and hits on supported beats); find_pauses / transcribe_words for exact phrase cuts (regroup snaps to pauses by itself); break_lines for a "\n" break that keeps phrases together. After placing short Pop / Drop / Glitch clips or when a render looks blank, run check_render on their itemIds (black tail, static entrance).
7. Report what you placed, where, and any warnings.
B-roll overlays (motion graphics over the footage, B-roll tab): list_broll for the effects and their fields; suggest_broll proposes subtitle -> effect pairs with props from the words (refine them, keep only the strong ones, at most about one every 4 s); broll_preview renders a still to look at first; place_broll renders at the timeline's size and places it (items: several in a row); adjust_broll changes a placed one by id ("bigger", "other number", "move left", "longer") without moving it; remove_broll deletes it. draft: true on place_broll renders half size (quick to check in Resolve's viewer); finalize_broll { all: true } brings drafts to full size before export. Put B-roll where the captions and faces are not (get_frame).
Keeping Resolve responsive: send place / place_stack / get_frame / remove_placed calls ONE AT A TIME (wait for each result; never several in one batch). Never read or change a placed clip's Fusion composition with a Resolve script (GetFusionCompByIndex, GetToolList, GetInput, SetInput): a script read of a follower-driven text freezes Resolve for good. The sizes and fonts actually applied are in place's "inspector" result and in inspect_placed; enabled subtitles are in list_subtitles (enabled / activeOnly).
Show the user your plan before placing more than about 10 clips.

Chopping an .srt file (no Resolve needed): read_srt returns the blocks and the chopping rules. Follow those rules, then call chop_srt with your corrected phrases. It cuts any phrase over the words/characters limits (SUBTITLE TRIMMING in the Prompt tab), works out the in-between timestamps and writes the new .srt.`;

// Words and characters per block. Both limits apply together. Defaults come from the SUBTITLE TRIMMING section of
// the Prompt tab's job prompt (<library>/job-prompt.md, found through the panel's endpoint file), else these.
const TRIM_DEFAULTS = { minWords: 1, maxWords: 3, minChars: 1, maxChars: 20 };

function jobPromptTrimming() {
    try {
        const ep = JSON.parse(fs.readFileSync(ENDPOINT_FILE, 'utf8'));
        if (!ep.dataDir) return {};
        const text = fs.readFileSync(path.join(ep.dataDir, 'job-prompt.md'), 'utf8');
        const range = (key) => {
            const m = new RegExp('^\\s*' + key + ':\\s*(\\d+)\\s*(?:(?:–|-|—|to)\\s*(\\d+|∞)?)?', 'mi').exec(text);
            if (!m) return null;
            const single = !/(–|-|—|to)/.test(m[0].slice(m[0].indexOf(':')));
            return { min: +m[1], max: single ? +m[1] : (m[2] && m[2] !== '∞' ? +m[2] : Infinity) };
        };
        const w = range('WORDS_PER_BLOCK'), c = range('CHARS_PER_BLOCK'), out = {};
        if (w) { out.minWords = w.min; out.maxWords = w.max; }
        if (c) { out.minChars = c.min; out.maxChars = c.max; }
        return out;
    } catch (e) { return {}; }
}

function trimLimits(args) {
    const lim = Object.assign({}, TRIM_DEFAULTS, jobPromptTrimming());
    for (const k of Object.keys(TRIM_DEFAULTS)) if (Number.isFinite(args && args[k])) lim[k] = args[k];
    lim.maxWords = Math.max(lim.maxWords, lim.minWords, 1);
    lim.maxChars = Math.max(lim.maxChars, lim.minChars, 1);
    return lim;
}

const fmtRange = (a, b) => a + '–' + (Number.isFinite(b) ? b : '∞');

function chopRules(lim) {
    return `CHOPPING SUBTITLES PROPERLY. Fix the spelling and wording of the .srt by these strict rules. The output stays in .srt format.

1. Transcription correction: fix ASR/transcription errors, misspellings, and technical and company names. Do NOT rewrite the speaker's thought structure, grammar or phrasing style. Keep their exact thoughts intact.
2. Contextual flow and grouping: chop or group the text by natural sentence flow, punctuation and spoken context. Keep related phrases together. Never split them awkwardly.
3. Length (SUBTITLE TRIMMING, both limits apply together):
   - Words per block: ${fmtRange(lim.minWords, lim.maxWords)}.
   - Characters per block (spaces included): ${fmtRange(lim.minChars, lim.maxChars)}.
   - A block that breaks either limit is cut smaller to meet both, e.g. 3 words that run past ${lim.maxChars} characters become 2 + 1 (or 1 + 2, whichever keeps the phrase together). A very long word keeps the line short rather than sharing it.
4. Currency: always put a currency symbol (e.g. $) before a number that means money ("13K dollars" -> "$13K").
5. Natural pauses: put breaks at natural spoken pauses, always within the single-line format.
6. Single line: exactly ONE line per block. No line breaks inside a block.
7. Highlight and key emphasis: a phrase, core metric or critical point that needs emphasis goes alone in its own block.
8. Artificial median timing cuts: split longer phrases into new, separate blocks with median timestamps between them. Example: "that they are spending about $13K per month" -> "that they are" / "spending about" / "$13K per month". (chop_srt works out the median timestamps.)
9. Semantic grouping and fillers:
   - Keep concepts together: never split a core metric, money value or time frame across two blocks ("$1K per month" stays in one block). When one runs past the limits, list its phrase number in the group's keep so chop_srt leaves it whole.
   - Isolate fillers: short fillers, rhetorical questions or transition words ("right?", "okay?", "yep") go alone in their own block, for a natural, dramatic pause.
   - Keeping a complete thought or related phrase together matters more than the minimum word count.
10. Prepositions and modifiers: keep prepositions and articles with the noun they introduce ("a surplus of" stays in one block).`;
}

const PROMPTS = [
    {
        name: 'chop_subtitles',
        description: 'Fix and chop an .srt subtitle file by the chopping rules (max 3 words, one line, money with $, fillers on their own, median timing cuts).',
        arguments: [
            { name: 'path', description: 'Path of the .srt file to chop', required: true },
            { name: 'outPath', description: 'Where to write the result (default: next to it, named "<name> chopped.srt")', required: false },
            { name: 'limits', description: 'Override the SUBTITLE TRIMMING limits, e.g. "words 1-2, chars 1-16"', required: false }
        ]
    }
];

function chopPromptText(args) {
    const p = (args && args.path) || '<ask the user for the .srt path>';
    const out = args && args.outPath ? ' Write it to ' + args.outPath + '.' : '';
    const lim = args && args.limits ? ' Use these limits (pass them to read_srt and chop_srt as minWords / maxWords / minChars / maxChars): ' + args.limits + '.' : '';
    return 'Chop the subtitle file ' + p + '.' + out + lim + '\n\n' +
        'Call read_srt with the path, read the whole transcript as sentences, then call chop_srt with every block covered once, in order. ' +
        'Each group lists its source block numbers and the corrected phrases that replace them. Fix any warnings it returns, then call it again. ' +
        'Finally, report the output path, the number of blocks before and after, the limits used, and the corrections you made (names, spellings, $).\n\n' +
        'read_srt returns the full rules with the SUBTITLE TRIMMING limits from the Prompt tab filled in.';
}

// The tools and their argument schemas live in src/main/tool-schemas.js (the plugin's HTTP server checks calls against them too).
const { TOOLS } = require('../src/main/tool-schemas');

const LOCAL_TOOLS = {
    read_srt: readSrtTool, chop_srt: chopSrtTool,
    find_pauses: (a) => mediaTool('pauses', a), find_cuts: (a) => mediaTool('cuts', a), find_beats: (a) => mediaTool('beats', a),
    transcribe_words: transcribeTool,
    break_lines: (a) => LINES.breakLines(a.text, { lines: a.lines, maxLines: a.maxLines, maxChars: a.maxChars })
};

// ------------------------------------------------------------------ media analysis (ffmpeg, in this process)

// A file (path) is measured directly; otherwise the panel says which clips are under the range and their source
// mapping (timeline_media), and the heavy work runs here, so a long scan never holds up Resolve's panel.
async function mediaTool(kind, args) {
    if (args.path) {
        const o = { start: args.start, duration: args.duration };
        if (kind === 'pauses') return Object.assign({ path: args.path, unit: 'seconds' }, await MEDIA.findPauses(args.path, Object.assign(o, { minPause: args.minPause, noiseDb: args.noiseDb })));
        if (kind === 'beats') return Object.assign({ path: args.path, unit: 'seconds' }, await MEDIA.findBeats(args.path, Object.assign(o, { minBpm: args.minBpm, maxBpm: args.maxBpm })));
        const c = await MEDIA.sceneCuts(args.path, Object.assign(o, { threshold: args.threshold }));
        const info = await MEDIA.probeMedia(args.path).catch(() => ({}));
        const from = args.start || 0, to = args.duration ? from + args.duration : (info.duration || (c.luma.length ? c.luma[c.luma.length - 1].t + 0.5 : from));
        return { path: args.path, unit: 'seconds', cuts: c.cuts.map(x => x.t), shots: MEDIA.shotsFromCuts(from, to, c.cuts.map(x => x.t), c.luma) };
    }
    const media = await callPlugin('timeline_media', pickRange(args));
    const res = await MEDIA.analyseTimeline(kind, media, args);
    return Object.assign({ unit: 'timeline frames', range: media.label, timeline: media.timeline }, res);
}

function pickRange(a) {
    const r = {};
    for (const k of ['subtitles', 'startFrame', 'endFrame']) if (a[k] !== undefined) r[k] = a[k];
    return r;
}

async function transcribeTool(args) {
    if (args.status) return MEDIA.asrStatus();
    let installed = null;
    if (args.install) installed = await MEDIA.installAsr(args.engine);
    if (args.path) {
        const w = await MEDIA.transcribeWords(args.path, { start: args.start, duration: args.duration, engine: args.engine, model: args.model, language: args.language });
        return { installed, unit: 'seconds', engine: w.engine, model: w.model, cached: w.cached, words: w.words };
    }
    const r = await mediaTool('words', args);
    return Object.assign({ installed }, r);
}

// ------------------------------------------------------------------ .srt chopping (local, no panel needed)

function srtTimeToMs(t) {
    const m = /(\d+):(\d{1,2}):(\d{1,2})[,.](\d{1,3})/.exec(t);
    if (!m) throw new Error('Bad .srt timestamp: ' + t);
    return ((+m[1] * 60 + +m[2]) * 60 + +m[3]) * 1000 + +m[4].padEnd(3, '0');
}

function msToSrtTime(ms) {
    ms = Math.max(0, Math.round(ms));
    const p = (n, w) => String(n).padStart(w, '0');
    return p(Math.floor(ms / 3600000), 2) + ':' + p(Math.floor(ms / 60000) % 60, 2) + ':' + p(Math.floor(ms / 1000) % 60, 2) + ',' + p(ms % 1000, 3);
}

function parseSrt(src) {
    const blocks = [];
    for (const chunk of src.replace(/^﻿/, '').replace(/\r\n?/g, '\n').split(/\n\s*\n/)) {
        const lines = chunk.split('\n').map(l => l.trim()).filter(Boolean);
        const ti = lines.findIndex(l => l.includes('-->'));
        if (ti < 0) continue;
        const [a, b] = lines[ti].split('-->');
        const text = lines.slice(ti + 1).join(' ').replace(/\s+/g, ' ').trim();
        blocks.push({ n: blocks.length + 1, startMs: srtTimeToMs(a), endMs: srtTimeToMs(b), text });
    }
    if (!blocks.length) throw new Error('No subtitle blocks found. Is this an .srt file?');
    return blocks;
}

const wordsOf = s => s.split(/\s+/).filter(Boolean);
const weightOf = w => Math.max(1, w.replace(/[^\p{L}\p{N}$%]/gu, '').length);

function readSrtTool(args) {
    const file = path.resolve(args.path);
    const blocks = parseSrt(fs.readFileSync(file, 'utf8'));
    const lim = trimLimits(args);
    return {
        path: file,
        blockCount: blocks.length,
        limits: limitsOut(lim),
        blocks: blocks.map(b => ({ n: b.n, start: msToSrtTime(b.startMs), end: msToSrtTime(b.endMs), words: wordsOf(b.text).length, text: b.text })),
        chopRules: chopRules(lim)
    };
}

const limitsOut = lim => ({ words: fmtRange(lim.minWords, lim.maxWords), chars: fmtRange(lim.minChars, lim.maxChars) });

// Words a block should not end on: articles, prepositions, possessives and joiners belong with what follows.
const NO_END = new Set(('a an the of to in on at by for from with about into onto over under per than as and or but so ' +
    'my your our their his her its this these those that which who if because').split(' '));
// Words that finish a number before them ("$13K per month", "5 years", "20 percent").
const UNIT_AFTER = /^(per|a|an|each|every|k|m|b|thousand|million|billion|grand|percent|%|dollars?|bucks|months?|years?|weeks?|days?|hours?|minutes?|seconds?)\b/i;
const bare = w => w.toLowerCase().replace(/^[^\p{L}\p{N}$]+|[^\p{L}\p{N}%]+$/gu, '');

// Cuts a phrase that breaks maxWords or maxChars into the fewest pieces that meet both, choosing the most natural
// breaks. A single word longer than maxChars stays on its own.
function splitToLimits(phrase, lim) {
    const ws = wordsOf(phrase);
    const fits = (i, j) => (j - i) <= lim.maxWords && (ws.slice(i, j).join(' ').length <= lim.maxChars || j - i === 1);
    if (fits(0, ws.length)) return [phrase];
    const breakCost = (k) => { // cost of a break between ws[k-1] and ws[k]
        const prev = ws[k - 1], next = ws[k];
        let c = 0;
        if (/[,.;:!?…]$/.test(prev)) c -= 4;
        if (NO_END.has(bare(prev))) c += 6;
        if (/[\d$]/.test(prev) && UNIT_AFTER.test(bare(next))) c += 20;
        if (/[\d$]/.test(next) && /^(\$|about|over|under|around|nearly|almost)$/.test(bare(prev))) c += 10;
        return c;
    };
    const pieceCost = (i, j) => {
        const len = ws.slice(i, j).join(' ').length;
        let c = 0;
        if (j - i < lim.minWords) c += 8;
        if (len < lim.minChars) c += 8;
        return c;
    };
    // best[j] = [pieces, cost, prevIndex] for ws[0..j), fewest pieces first, then lowest cost, then most even.
    const best = [[0, 0, -1, 0]];
    for (let j = 1; j <= ws.length; j++) {
        let b = null;
        for (let i = Math.max(0, j - lim.maxWords); i < j; i++) {
            if (!best[i] || !fits(i, j)) continue;
            const len = ws.slice(i, j).join(' ').length;
            const cand = [best[i][0] + 1, best[i][1] + pieceCost(i, j) + (i > 0 ? breakCost(i) : 0), i, best[i][3] + len * len];
            if (!b || cand[0] < b[0] || (cand[0] === b[0] && (cand[1] < b[1] || (cand[1] === b[1] && cand[3] < b[3])))) b = cand;
        }
        best[j] = b;
    }
    const out = [];
    for (let j = ws.length; j > 0; j = best[j][2]) out.unshift(ws.slice(best[j][2], j).join(' '));
    return out;
}

// Times each source word inside its own block by its length, then places every cut between phrases at the source
// word boundary nearest to the same share of the group's letters. Spelling fixes and "$13K" for "13K dollars"
// shift the share only slightly, so cuts still land on the right words.
function timeGroup(srcBlocks, phrases) {
    const words = [];
    for (const b of srcBlocks) {
        const ws = wordsOf(b.text);
        const total = ws.reduce((s, w) => s + weightOf(w), 0) || 1;
        let t = b.startMs;
        for (const w of ws) {
            const d = (b.endMs - b.startMs) * weightOf(w) / total;
            words.push({ t0: t, t1: t + d, w: weightOf(w) });
            t += d;
        }
    }
    const first = srcBlocks[0].startMs, last = srcBlocks[srcBlocks.length - 1].endMs;
    if (!words.length) words.push({ t0: first, t1: last, w: 1 });
    const srcTotal = words.reduce((s, w) => s + w.w, 0);
    const phraseW = phrases.map(p => wordsOf(p).reduce((s, w) => s + weightOf(w), 0) || 1);
    const phraseTotal = phraseW.reduce((s, w) => s + w, 0);

    // Boundary k sits after source word k-1 (k = 1..words.length-1). Pick the nearest one per cut, kept increasing.
    const cum = [0];
    for (const w of words) cum.push(cum[cum.length - 1] + w.w);
    const cuts = [];
    let acc = 0, minK = 1;
    for (let i = 0; i < phrases.length - 1; i++) {
        acc += phraseW[i];
        const target = acc / phraseTotal * srcTotal;
        let best = minK, bestD = Infinity;
        for (let k = minK; k < words.length; k++) {
            const d = Math.abs(cum[k] - target);
            if (d < bestD) { best = k; bestD = d; }
        }
        // Not enough source words for this many phrases: share the time out by letters instead.
        cuts.push(best < words.length && best >= minK ? { end: words[best - 1].t1, start: words[best].t0 } : null);
        minK = best + 1;
    }
    const out = [];
    let acc2 = 0;
    for (let i = 0; i < phrases.length; i++) {
        const fallbackAt = f => first + (last - first) * f;
        const s = i === 0 ? first : (cuts[i - 1] ? cuts[i - 1].start : fallbackAt(acc2 / phraseTotal));
        acc2 += phraseW[i];
        const e = i === phrases.length - 1 ? last : (cuts[i] ? cuts[i].end : fallbackAt(acc2 / phraseTotal));
        out.push({ startMs: s, endMs: Math.max(e, s + 1) });
    }
    return out;
}

async function chopSrtTool(args) {
    const src = path.resolve(args.path);
    const blocks = parseSrt(fs.readFileSync(src, 'utf8'));
    const groups = args.groups || [];
    if (!groups.length) throw new Error('groups is empty.');

    let next = 1;
    for (const [gi, g] of groups.entries()) {
        const where = 'Group ' + (gi + 1);
        if (!g.blocks.length || !g.phrases.length) throw new Error(where + ' needs blocks and phrases.');
        g.blocks.forEach((n, i) => {
            if (n !== next + i) throw new Error(where + ': expected block ' + (next + i) + ', got ' + n + '. Cover every block once, in order.');
        });
        next += g.blocks.length;
    }
    if (next - 1 !== blocks.length) throw new Error('Groups cover blocks 1-' + (next - 1) + ' but the file has ' + blocks.length + '.');

    const lim = trimLimits(args);
    const out = [], warnings = [], autoCut = [];
    for (const g of groups) {
        const keep = new Set(g.keep || []);
        const phrases = [];
        g.phrases.map(p => p.replace(/\s+/g, ' ').trim()).forEach((p, pi) => {
            if (!p) return;
            const pieces = keep.has(pi + 1) ? [p] : splitToLimits(p, lim);
            if (pieces.length > 1) autoCut.push('"' + p + '" -> ' + pieces.map(x => '"' + x + '"').join(' / '));
            phrases.push(...pieces);
        });
        const times = timeGroup(g.blocks.map(n => blocks[n - 1]), phrases);
        phrases.forEach((text, i) => {
            const n = out.length + 1;
            const wc = wordsOf(text).length;
            const dur = times[i].endMs - times[i].startMs;
            if (wc > lim.maxWords || text.length > lim.maxChars) {
                warnings.push('Block ' + n + ' "' + text + '" is over the limits (' + wc + ' words, ' + text.length + ' characters; max ' + lim.maxWords + ' / ' + lim.maxChars + ')' + (wc === 1 ? ': one long word.' : ', kept whole on purpose.'));
            }
            if (wc < lim.minWords || text.length < lim.minChars) {
                warnings.push('Block ' + n + ' "' + text + '" is under the minimum (' + wc + ' words, ' + text.length + ' characters; min ' + lim.minWords + ' / ' + lim.minChars + '). Fine for a filler, otherwise merge it.');
            }
            if (dur < 250) warnings.push('Block ' + n + ' "' + text + '" is only ' + Math.round(dur) + ' ms on screen. Merge it with a neighbour.');
            if (/\b\d[\d,.]*\s*(k|m|b|thousand|million|billion|grand)?\s*(dollars?|bucks|usd)\b/i.test(text) && !/\$/.test(text)) {
                warnings.push('Block ' + n + ' "' + text + '" looks like money without a $.');
            }
            out.push({ n, startMs: times[i].startMs, endMs: times[i].endMs, text });
        });
    }

    let snap = null;
    if (args.media) snap = await snapChopCuts(out, args, warnings);

    const dest = args.outPath ? path.resolve(args.outPath) : path.join(path.dirname(src), path.basename(src, path.extname(src)) + ' chopped.srt');
    if (dest === src && !args.overwrite) throw new Error('outPath is the source file. Pass overwrite: true to replace it, or choose another path.');
    fs.writeFileSync(dest, out.map(b => b.n + '\n' + msToSrtTime(b.startMs) + ' --> ' + msToSrtTime(b.endMs) + '\n' + b.text + '\n').join('\n'));

    return {
        written: dest,
        sourceBlocks: blocks.length,
        blocks: out.length,
        limits: limitsOut(lim),
        autoCut,
        warnings,
        snap,
        result: out.map(b => ({ n: b.n, start: msToSrtTime(b.startMs), end: msToSrtTime(b.endMs), text: b.text }))
    };
}

// Moves every cut between two back-to-back blocks onto the measured pause (or word gap) next to it.
async function snapChopCuts(out, args, warnings) {
    const off = Number(args.mediaOffset) || 0;
    const lim = Number.isFinite(args.maxShift) ? args.maxShift : 0.35;
    const from = out[0].startMs / 1000 + off, to = out[out.length - 1].endMs / 1000 + off;
    let p;
    try { p = await MEDIA.findPauses(args.media, { start: Math.max(0, from - 1), duration: to - from + 2 }); }
    catch (e) { warnings.push('Cuts not moved onto pauses: ' + e.message); return null; }
    if (p.quiet) warnings.push('The recording is very quiet (speech around ' + p.speechDb + ' dBFS): pauses may be wrong.');
    const words = MEDIA.cachedWords(args.media, from, to);
    let moved = 0, byWord = 0;
    for (let i = 0; i < out.length - 1; i++) {
        const a = out[i], b = out[i + 1];
        if (b.startMs - a.endMs > 40) continue;        // a gap in the source already
        const c = (a.endMs + b.startMs) / 2000 + off;
        const s = MEDIA.snapCuts([c], p.pauses, words, lim)[0];
        if (!s.by || s.to === c) continue;
        const ms = Math.round((s.to - off) * 1000);
        if (ms <= a.startMs + 120 || ms >= b.endMs - 120) continue;
        a.endMs = ms; b.startMs = ms;
        moved++; if (s.by === 'word') byWord++;
    }
    return { media: path.resolve(args.media), speechDb: p.speechDb, thresholdDb: p.thresholdDb, pauses: p.pauses.length, cutsMoved: moved, ontoWordGaps: byWord, wordTimings: !!words };
}

// ------------------------------------------------------------------ talking to the plugin

async function callPlugin(tool, args) {
    let ep;
    try { ep = JSON.parse(fs.readFileSync(ENDPOINT_FILE, 'utf8')); } catch (e) {
        throw new Error('El Subtitle Animator is not running. Open DaVinci Resolve and the panel (Workspace > Workflow Integrations > El Subtitle Animator).');
    }
    let res;
    try {
        res = await fetch('http://127.0.0.1:' + ep.port + '/call', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'x-sa-token': ep.token },
            body: JSON.stringify({ tool, args: args || {} }),
            signal: AbortSignal.timeout(180000)
        });
    } catch (e) {
        throw new Error('Could not reach the El Subtitle Animator panel. Is it open in Resolve? (' + (e && e.message || e) + ')');
    }
    const body = await res.json().catch(() => null);
    if (!body) throw new Error('The panel sent an unreadable answer (HTTP ' + res.status + ').');
    if (!body.ok) throw new Error(body.error || 'Failed');
    return body.result;
}

function toContent(result) {
    // Only a real frame (get_frame: base64 data + mime) is sent as an image. Other results can have an `image` field
    // that is not picture data (get_layout's "1080x1920" size), which MCP clients reject as invalid base64.
    if (result && typeof result.image === 'string' && result.mime) {
        return [{ type: 'image', data: result.image, mimeType: result.mime }, { type: 'text', text: result.note || '' }];
    }
    return [{ type: 'text', text: JSON.stringify(result, null, 2) }];
}

// ------------------------------------------------------------------ MCP over stdio (newline-delimited JSON-RPC)

function write(msg) { process.stdout.write(JSON.stringify(msg) + '\n'); }
function reply(id, result) { write({ jsonrpc: '2.0', id, result }); }
function fail(id, code, message) { write({ jsonrpc: '2.0', id, error: { code, message } }); }

async function onMessage(msg) {
    if (!msg || typeof msg !== 'object') return;
    const { id, method, params } = msg;
    const isRequest = id !== undefined && id !== null;
    try {
        switch (method) {
            case 'initialize':
                return reply(id, {
                    protocolVersion: (params && params.protocolVersion) || '2025-06-18',
                    capabilities: { tools: {}, prompts: {} },
                    serverInfo: SERVER_INFO,
                    instructions: INSTRUCTIONS
                });
            case 'ping': return reply(id, {});
            case 'tools/list': return reply(id, { tools: TOOLS });
            case 'prompts/list': return reply(id, { prompts: PROMPTS });
            case 'prompts/get': {
                if (!params || params.name !== 'chop_subtitles') return fail(id, -32602, 'Unknown prompt ' + (params && params.name));
                return reply(id, {
                    description: PROMPTS[0].description,
                    messages: [{ role: 'user', content: { type: 'text', text: chopPromptText(params.arguments) } }]
                });
            }
            case 'tools/call': {
                const name = params && params.name;
                if (!TOOLS.some(t => t.name === name)) return fail(id, -32602, 'Unknown tool ' + name);
                try {
                    const args = (params && params.arguments) || {};
                    const result = LOCAL_TOOLS[name] ? await LOCAL_TOOLS[name](args) : await callPlugin(name, args);
                    return reply(id, { content: toContent(result) });
                } catch (e) {
                    return reply(id, { content: [{ type: 'text', text: String(e && e.message || e) }], isError: true });
                }
            }
            default:
                if (isRequest) return fail(id, -32601, 'Method not found: ' + method);
        }
    } catch (e) {
        if (isRequest) fail(id, -32603, String(e && e.message || e));
    }
}

let buf = '';
let msgChain = Promise.resolve();
process.stdin.setEncoding('utf8');
process.stdin.on('data', (chunk) => {
    buf += chunk;
    let nl;
    while ((nl = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, nl).trim();
        buf = buf.slice(nl + 1);
        if (!line) continue;
        let msg;
        try { msg = JSON.parse(line); } catch (e) { fail(null, -32700, 'Parse error'); continue; }
        const list = Array.isArray(msg) ? msg : [msg];
        for (const m of list) msgChain = msgChain.then(() => onMessage(m));
    }
});
process.stdin.on('end', () => process.exit(0));
