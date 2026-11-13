// Text changes for job prompts saved by older versions of the panel (pure: text in, text out). prompt/tab.js runs
// them once per panel over the current prompt, the user's default and every saved prompt (migrate*).

// The note under HIGHLIGHT_BOX: what Claude does with the row.
const HIGHLIGHT_NOTE = 'the box / pill behind the key word → set_rules highlight { auto, width, height, x, y }';

const TRIMMING_SECTION = [
    'SUBTITLE TRIMMING',
    '  WORDS_PER_BLOCK: 1–3',
    '                   words per subtitle block when chopping an .srt (chop_srt minWords / maxWords)',
    '  CHARS_PER_BLOCK: 1–20',
    '                   characters per block, spaces included (chop_srt minChars / maxChars)',
    '                   both limits apply together: a block over either is cut smaller (e.g. 2 + 1 words)'
].join('\n');

function withTrimmingSection(text) {
    const lines = String(text || '').split('\n');
    const si = lines.findIndex(l => /^##\s+SETTINGS\b/i.test(l));
    if (si < 0 || /^SUBTITLE TRIMMING\b/im.test(text)) return text;
    let ei = lines.findIndex((l, i) => i > si && /^##\s/.test(l));
    if (ei < 0) ei = lines.length;
    let at = ei;
    while (at > si + 1 && !lines[at - 1].trim()) at--;
    lines.splice(at, 0, '', TRIMMING_SECTION, ...(at === ei && at < lines.length ? [''] : []));
    return lines.join('\n');
}

function withHighlightRow(text) {
    const lines = String(text || '').split('\n');
    const si = lines.findIndex(l => /^##\s+SETTINGS\b/i.test(l));
    if (si < 0 || /^\s+HIGHLIGHT_BOX\s*:/m.test(text)) return text;
    let ei = lines.findIndex((l, i) => i > si && /^##\s/.test(l));
    if (ei < 0) ei = lines.length;
    const ts = lines.findIndex((l, i) => i > si && i < ei && /^TEXT STYLE\b/.test(l));
    if (ts < 0) return text;
    let at = ts + 1, em = -1;
    for (; at < ei && /^\s/.test(lines[at]); at++) if (/^\s{1,3}EMPHASIS\s*:/.test(lines[at])) em = at;
    if (em >= 0) { at = em + 1; while (at < ei && /^\s{4,}\S/.test(lines[at])) at++; }
    else { while (at > ts + 1 && !lines[at - 1].trim()) at--; }
    lines.splice(at, 0, '  HIGHLIGHT_BOX: auto · width 1.00 · height 1.00 · x 0.000 · y 0.000', '            ' + HIGHLIGHT_NOTE);
    return lines.join('\n');
}
