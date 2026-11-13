// Prompt tab builder: the keys it knows (MCP parameters, clip colours, placement fields) and the shared builder state.

// ---------------------------------------------------------------- settings builder
// The prompt text stays the single source of truth (it is what gets saved, copied and reset). The builder parses
// its "## SETTINGS" block into sections of KEY / value rows, and writes the block back after every edit:
//
//   SECTION TITLE                    a line with no indent
//     KEY:     value                 a row ("KEY → value" rows too, as in COLOUR ROLES)
//              note line             deeper-indented lines under a row are its note...
//              if <cond> → <then>    ...except "if ... → ..." lines, which are its conditions
//
// Everything after the SETTINGS block (BEFORE PLACING, RULES, REPORT) is edited as text below the builder.

const JOB_PROMPT_MODE_KEY = 'sa.jobPromptMode';
// Resolve's 16 clip colours, in the order of its Clip Color menu, with the swatch it draws (approximate).
const PB_CLIP_COLOURS = [
    ['Orange', '#eb6e01'], ['Apricot', '#ffa833'], ['Yellow', '#e2a906'], ['Lime', '#9fc615'], ['Olive', '#5f9909'],
    ['Green', '#448f65'], ['Teal', '#00ada5'], ['Navy', '#0e3f7a'], ['Blue', '#4a90d9'], ['Purple', '#9e58c3'],
    ['Violet', '#d04ddd'], ['Pink', '#f75baf'], ['Tan', '#b9af97'], ['Beige', '#c4a983'], ['Brown', '#99643a'],
    ['Chocolate', '#8c5a3f']
];
const PB_OTHER_COLOUR = 'any other colour';
const PB_COLOURS = PB_CLIP_COLOURS.map(c => c[0]).concat(PB_OTHER_COLOUR);

// "ORANGE" / "orange" -> its swatch, or null for "any other colour" and custom keys.
function pbColourHex(name) {
    const c = PB_CLIP_COLOURS.find(x => x[0].toLowerCase() === String(name || '').trim().toLowerCase());
    return c ? c[1] : null;
}

function pbColourDot(name) {
    const d = pbEl('span', 'pb-cdot');
    const hex = pbColourHex(name);
    if (hex) d.style.background = hex; else d.classList.add('none');
    return d;
}

// Colour-role key: a button with the colour's dot that opens every Resolve clip colour. Keys are written in upper
// case (ORANGE), like the rules refer to them; colours other roles already use are marked.
function pbColourKey(section, row) {
    const btn = pbEl('button', 'pb-ckey');
    const paint = () => {
        btn.innerHTML = '';
        btn.appendChild(pbColourDot(row.key));
        btn.appendChild(pbEl('span', 'pb-ckey-name', row.key || 'Pick a colour'));
        btn.appendChild(pbEl('span', 'pb-ckey-caret', '▾'));
    };
    paint();
    btn.title = 'Resolve clip colour this role applies to';
    btn.addEventListener('click', () => {
        openPop(btn, 'pop-menu pb-cpop', (el) => {
            const used = section.rows.filter(r => r !== row).map(r => r.key.trim().toLowerCase());
            const item = (name, upper) => {
                const it = pbEl('button', 'pop-item' + (row.key.trim().toLowerCase() === name.toLowerCase() ? ' on' : ''));
                it.appendChild(pbColourDot(name));
                it.appendChild(pbEl('span', 'pop-label', name));
                if (used.includes(name.toLowerCase())) it.appendChild(pbEl('span', 'pb-cused', 'in use'));
                it.addEventListener('click', () => { closePop(); row.key = upper ? name.toUpperCase() : name; paint(); pbChanged(); });
                el.appendChild(it);
            };
            el.appendChild(pbEl('div', 'pop-title', 'Resolve clip colours'));
            for (const [name] of PB_CLIP_COLOURS) item(name, true);
            el.appendChild(pbEl('div', 'pop-sep'));
            item(PB_OTHER_COLOUR, false);
        });
    });
    return btn;
}

// What the bottom "Add from MCP" menu offers, grouped by the MCP call the parameter feeds. Each entry lands as a row
// in `section` (made when missing). kind: text | enum | preset | tags. The prompt only describes these values;
// Claude passes them to the named call.
const PB_MCP_PARAMS = [
    { tool: 'set_rules', items: [
        { label: 'allowedTags: only presets with these tags', section: 'PRESETS', key: 'ALLOWED_TAGS', kind: 'tags', value: '', hint: 'Emoji, tag names or ids. Empty = all presets allowed.' },
        { label: 'tagMatch: any / all of the tags', section: 'PRESETS', key: 'TAG_MATCH', kind: 'enum', options: ['any', 'all'], value: 'any', hint: 'any: a preset needs at least one of the tags; all: every tag.' },
        { label: 'NORMAL: font + colour of the text', section: 'TEXT STYLE', key: 'NORMAL', kind: 'style', value: 'Poppins Bold, #ffffff', hint: 'Sets the rules\' font and color: the font and fill colour forced on the clips.' },
        { label: 'EMPHASIS: font + colour of the key word', section: 'TEXT STYLE', key: 'EMPHASIS', kind: 'style', value: 'Larken Black, #ffd400', hint: 'Sets the rules\' emphasis: the MultiText key-word layer\'s font and fill colour.' },
        { label: 'GRADIENT: recolour gradient fills', section: 'TEXT STYLE', key: 'GRADIENT', value: 'text colour (top 0.29) → #CF1D46 (bottom 1.0)', hint: 'Presets with a gradient text fill (Money Pop Up, $123,456) get this gradient instead of their own, even when they keep their own colour. "text colour" = the NORMAL colour; one colour = a plain fill. Claude passes it as set_rules gradient.' },
        { label: 'text.maxSize: largest text Size', section: 'SIZE (Inspector values)', key: 'SIZE_MAX', value: '0.162', hint: 'Largest Size, as the Inspector shows it.' },
        { label: 'text.lineSpacing: Line Spacing', section: 'SIZE (Inspector values)', key: 'LINE_SPACING', value: '0.7', hint: 'Line Spacing as the Inspector shows it (1 = normal).' },
        { label: 'track.mode: which video layer', section: 'POSITION (vertical 9:16)', key: 'TRACK_MODE', kind: 'enum', options: ['top', 'first-empty', 'fixed'], value: 'top', hint: 'Starts as the panel\'s Placement setting. top = above everything, first-empty = lowest free layer above V1, fixed = always one layer.' },
        { label: 'track.fixed: always this layer', section: 'POSITION (vertical 9:16)', key: 'TRACK_FIXED', value: 'V4', hint: 'Used with TRACK_MODE fixed.' },
        { label: 'Clip track: video layer range', section: 'POSITION (vertical 9:16)', key: 'CLIP_TRACK', kind: 'range', prefix: 'V', min: 2, value: 'V2–∞', hint: 'Linked with the panel\'s Placement "Clip track" range. Claude passes it as trackRange.' },
        { label: 'Audio track: sound effect tracks', section: 'POSITION (vertical 9:16)', key: 'AUDIO_TRACK', kind: 'audio', after: 'CLIP_TRACK', value: 'any free track', hint: 'Linked with the panel\'s Placement "Audio track": any free track, same as clip track, or A2–A4. Claude passes it as audioTrack.' },
        { label: 'position.defaultZone', section: 'POSITION (vertical 9:16)', key: 'DEFAULT_ZONE', kind: 'enum', options: ['top', 'upper', 'center', 'lower', 'bottom'], value: 'lower', hint: 'Where text goes when no x/y or guide is given.' },
        { label: 'position.avoidFaces', section: 'POSITION (vertical 9:16)', key: 'AVOID_FACES', kind: 'enum', options: ['yes', 'no'], value: 'yes', hint: 'Claude looks at each frame and keeps text off faces.' },
        { label: 'position.safeTop / Bottom / Left / Right', section: 'POSITION (vertical 9:16)', key: 'SAFE_MARGINS', value: 'top 0.1 · bottom 0.1 · left 0.05 · right 0.05', hint: 'Safe-area margins, 0..1 of the frame.' },
        { label: 'multitext.emphasis: which word', section: 'TEXT STYLE', key: 'EMPHASIS_PICK', kind: 'enum', options: ['auto', 'last', 'first', 'center'], value: 'auto', hint: 'Which word goes in the MultiText emphasis part when Claude does not choose.' },
        { label: 'multitext.uppercaseEmphasis', section: 'TEXT STYLE', key: 'UPPERCASE_EMPHASIS', kind: 'enum', options: ['yes', 'no'], value: 'no', hint: 'Upper-case the emphasised word(s).' },
        { label: 'highlight: box / pill size, position, auto-balance', section: 'TEXT STYLE', key: 'HIGHLIGHT_BOX', kind: 'highlight', value: 'auto · width 1.00 · height 1.00 · x 0.000 · y 0.000', hint: 'The box / pill behind the highlighted word. auto = even padding on every side; width / height multiply the box; x / y nudge it (Inspector Offset units). Claude passes it as set_rules highlight.' },
        { label: 'sound: place sound effects', section: 'TEXT STYLE', key: 'SOUND', kind: 'enum', options: ['on', 'off'], value: 'on', hint: 'Place the presets\' sound effects.' },
        { label: 'notes: free-text rule to remember', section: 'NOTES', key: 'NOTE', value: '', hint: 'Saved with the rules; Claude reads it on every job.' }
    ] },
    { tool: 'place', items: [
        { label: 'presetId: a new preset role', section: 'PRESETS', key: 'NEW_ROLE', kind: 'preset', value: '', hint: 'Pick presets (or tags) from your library for a role the rules can refer to.' },
        { label: 'x: horizontal centre', section: 'POSITION (vertical 9:16)', key: 'X', value: '0.5', hint: '0..1 of the frame width, where the text\'s centre goes.' },
        { label: 'y: vertical centre', section: 'POSITION (vertical 9:16)', key: 'Y', value: '0.7', hint: '0..1 of the frame height, 0 = top.' },
        { label: 'zone: preset area of the frame', section: 'POSITION (vertical 9:16)', key: 'ZONE', kind: 'enum', options: ['top', 'upper', 'center', 'lower', 'bottom'], value: 'lower', hint: 'Used when no x/y or guide is given.' },
        { label: 'guide: layout guide line', section: 'POSITION (vertical 9:16)', key: 'GUIDE', value: 'captions', hint: 'A guide name from the saved layout (get_layout).' },
        { label: 'align: on / below / above the guide', section: 'POSITION (vertical 9:16)', key: 'ALIGN', kind: 'enum', options: ['on', 'below', 'above'], value: 'below', hint: 'on = centred on the line; below/above = centred in the area next to it.' },
        { label: 'fit: fit into the layout', section: 'POSITION (vertical 9:16)', key: 'FIT', kind: 'enum', options: ['true', 'false'], value: 'false', hint: 'false = do not move or shrink the clip to fit the layout.' },
        { label: 'shrink: allow shrinking to fit', section: 'SIZE (Inspector values)', key: 'SHRINK', kind: 'enum', options: ['true', 'false'], value: 'false', hint: 'false = only move the clip, never reduce its size.' },
        { label: 'textSize: size multiplier', section: 'SIZE (Inspector values)', key: 'TEXT_SIZE', value: '1.0', hint: 'Multiplier on the preset\'s own size (0.66 = two thirds).' },
        { label: 'holdUntil: keep on screen until', section: 'STACKS', key: 'HOLD_UNTIL', value: 'the group\'s last subtitle', hint: 'Stacked captions: hold the text until a later subtitle ends.' },
        { label: 'keepPresetStyle: skip font/colour overrides', section: 'TEXT STYLE', key: 'KEEP_PRESET_STYLE', value: 'DANGER, MONEY', hint: 'Presets or roles that keep their own font and colours (Claude passes keepPresetStyle: true for them).' },
        { label: 'parts: MultiText split', section: 'TEXT STYLE', key: 'PARTS', value: 'upper = opening · emphasis = key word · lower = the rest', hint: 'How a subtitle splits into upper / emphasis / lower.' },
        { label: 'dryRun: only show the plan', section: 'JOB', key: 'DRY_RUN', kind: 'enum', options: ['no', 'yes'], value: 'no', hint: 'yes = Claude shows what it would place without placing.' }
    ] },
    { tool: 'place_stack', items: [
        { label: 'lineSpacing: gap between stacked lines', section: 'SIZE (Inspector values)', key: 'STACK_GAP', value: '1.0', hint: 'Gap between stacked lines, as a Line Spacing value.' },
        { label: 'y: centre of the stack', section: 'POSITION (vertical 9:16)', key: 'STACK_Y', value: 'band centre', hint: 'Where the middle of the whole group goes.' }
    ] },
    { tool: 'list_subtitles', items: [
        { label: 'color: a colour role', section: 'COLOUR ROLES', key: 'Orange', sep: '→', value: '', hint: 'What Claude does with subtitles of this clip colour.' },
        { label: 'from / to: subtitle range', section: 'JOB', key: 'SCOPE', value: 'indexes 1–60', hint: 'Which subtitles this job covers.' }
    ] },
    { tool: 'get_frame', items: [
        { label: 'at: which frame to check', section: 'JOB', key: 'CHECK_AT', kind: 'enum', options: ['end', 'middle', 'start'], value: 'end', hint: 'Frame Claude looks at to check each placed clip.' }
    ] },
    { tool: 'chop_srt', items: [
        { label: 'minWords / maxWords: words per block', section: 'SUBTITLE TRIMMING', key: 'WORDS_PER_BLOCK', kind: 'range', min: 1, value: '1–3', hint: 'Words per subtitle block when chopping an .srt. Works together with CHARS_PER_BLOCK.' },
        { label: 'minChars / maxChars: characters per block', section: 'SUBTITLE TRIMMING', key: 'CHARS_PER_BLOCK', kind: 'range', min: 1, value: '1–20', hint: 'Characters per block, spaces included. A block over this or WORDS_PER_BLOCK is cut smaller (e.g. 2 + 1 words).' }
    ] },
    { tool: 'custom', items: [
        { label: 'Text key', section: null, key: 'NEW_KEY', value: '', hint: 'A free key/value in the last section.' },
        { label: 'Preset list key', section: null, key: 'NEW_PRESETS', kind: 'preset', value: '', hint: 'A key whose value is picked from your preset library.' },
        { label: 'New section', newSection: true, hint: 'An empty section with its own Add key button.' }
    ] }
];

// Keys linked both ways with the panel's Placement drawer (Use tab): changing the drawer rewrites these rows, and
// editing a row (when you leave the box) sets the drawer, which also tells the MCP side.
const pbClipTrackOf = (o) => (o.rangeFrom || o.rangeTo) ? 'V' + (o.rangeFrom || 2) + '–' + (o.rangeTo ? 'V' + o.rangeTo : '∞') : 'V2–∞';
const PB_PLACEMENT = {
    CLIP_TRACK: pbClipTrackOf,
    TRACK_RANGE: pbClipTrackOf,
    AUDIO_TRACK: (o) => pbJoinAudio({ mode: o.audioMode, from: o.audioFrom, to: o.audioTo }),
    TRACK_MODE: (o) => (o.firstEmpty ? 'first-empty' : 'top')
};

function pbPlacementValue(key) {
    const f = PB_PLACEMENT[key];
    if (!f || typeof placeOptions !== 'function') return null;
    try { return f(placeOptions()); } catch (e) { return null; }
}

function pbSetPlaceField(id, prop, val) {
    const e = $(id);
    if (!e || e[prop] === val) return false;
    e[prop] = val;
    e.dispatchEvent(new Event('change'));   // the drawer saves, tells the main process and calls back here
    return true;
}

// A linked row was edited: put it into the Placement drawer.
function pbPushToPlacement(row) {
    const key = row.key.trim();
    if (!PB_PLACEMENT[key]) return;
    pb.pushing = true;   // the drawer calls back on every field; sync once at the end instead
    try { pbPushFields(row, key); } finally { pb.pushing = false; }
    promptPlacementChanged();
}

function pbPushFields(row, key) {
    if (key === 'AUDIO_TRACK') {
        const a = pbParseAudio(row.value);
        if (!a) { setPromptStatus('AUDIO_TRACK: write any free track, same as clip track, or a range like A2–A4.', 'bad'); return; }
        if (a.mode === 'own') {
            pbSetPlaceField('placeAudioTo', 'value', a.to ? String(a.to) : '');
            pbSetPlaceField('placeAudioFrom', 'value', String(a.from));
            pbSetPlaceField('placeAudioTo', 'value', a.to ? String(a.to) : '');
        }
        pbSetPlaceField('placeAudioMode', 'value', a.mode);
        setPromptStatus('Placement: audio on ' + pbJoinAudio(a) + '.', 'ok');
    } else if (key === 'CLIP_TRACK' || key === 'TRACK_RANGE') {
        const r = pbParseTrackRange(row.value);
        if (!r) { setPromptStatus(key + ': write it like V3–V6 (or V3–∞) to update Placement.', 'bad'); return; }
        // To first when it grows, so the drawer's "To ≥ From" fix-up doesn't fight the new From.
        pbSetPlaceField('placeRangeTo', 'value', r.to ? String(r.to) : '');
        pbSetPlaceField('placeRangeFrom', 'value', String(r.from));
        pbSetPlaceField('placeRangeTo', 'value', r.to ? String(r.to) : '');
        setPromptStatus('Placement: between V' + r.from + ' and ' + (r.to ? 'V' + r.to : '∞') + '.', 'ok');
    } else if (key === 'TRACK_MODE') {
        if (row.value === 'fixed') return;   // the drawer has no fixed mode; TRACK_FIXED / TRACK_RANGE say which layer
        pbSetPlaceField('placeFirstEmpty', 'checked', row.value === 'first-empty');
        setPromptStatus('Placement: ' + (row.value === 'first-empty' ? 'first empty layer' : 'top layer') + '.', 'ok');
    }
}

// The Placement drawer changed (or was just set up): linked rows take its values.
function promptPlacementChanged() {
    if (pb.pushing) return;
    const doc = pb.doc || parseJobPrompt(pb.full);
    if (!doc) return;
    let changed = false;
    for (const s of doc.sections) for (const r of s.rows) {
        const k = r.key.trim();
        const v = pbPlacementValue(k);
        if (v == null || r.value === v) continue;
        if (k === 'TRACK_MODE' && r.value === 'fixed') continue;
        // Same range written another way ("V3-V6") is left as typed.
        if ((k === 'CLIP_TRACK' || k === 'TRACK_RANGE') && JSON.stringify(pbParseTrackRange(r.value)) === JSON.stringify(pbParseTrackRange(v))) continue;
        if (k === 'AUDIO_TRACK' && JSON.stringify(pbParseAudio(r.value)) === JSON.stringify(pbParseAudio(v))) continue;
        r.value = v; changed = true;
    }
    if (!changed) return;
    pb.doc = doc;
    pb.full = serializeJobPrompt(doc);
    saveJobPrompt(pb.full);
    refreshPromptFlags();
    if (pb.mode === 'builder') { if (!$('promptBuilder').contains(document.activeElement)) renderPromptBuilder(true); }
    else if (document.activeElement !== $('promptText')) { $('promptText').value = pb.full; renderPromptHilite(); }
}

const PB_CATALOG = {};
for (const g of PB_MCP_PARAMS) for (const it of g.items) if (it.key && !PB_CATALOG[it.key]) PB_CATALOG[it.key] = it;

const pb = { doc: null, mode: 'builder', full: '', pushing: false };

// The kind of value editor a row gets.
// Keys of the built-in prompt that get a special editor without being MCP parameters.
const PB_KEY_KINDS = {
    WORDS_PER_LINE: { kind: 'range', min: 1 },
    TRACK_RANGE: PB_CATALOG.CLIP_TRACK          // the old name of CLIP_TRACK, still read in saved prompts
};

function pbKeySpec(key) { return PB_CATALOG[String(key).trim()] || PB_KEY_KINDS[String(key).trim()] || null; }

function pbRowKind(row, section) {
    const c = pbKeySpec(row.key);
    // A range row whose text can't be read as a range (e.g. "4–5 or so") stays a text box rather than losing words.
    if (c && c.kind === 'range' && String(row.value).trim() && !pbParseRange(row.value, c.min)) return 'text';
    if (c && c.kind === 'audio' && String(row.value).trim() && !pbParseAudio(row.value)) return 'text';
    if (c && c.kind === 'highlight' && String(row.value).trim() && !pbParseHighlight(row.value)) return 'text';
    if (c && c.kind) return c.kind;
    if (/^PRESETS\b/i.test(section.title) && row.sep === ':') return 'preset';
    return 'text';
}

// Library presets and tags, as the names a prompt uses ("Drop Pump (ML)", "❗❌⚠️ Danger").
function pbPresetNames() { return ((state.lib && state.lib.animations) || []).map(a => a.name); }
function pbTagNames() { return allTags().map(tagLabel); }
