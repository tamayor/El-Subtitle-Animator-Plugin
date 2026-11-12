// The Create tab's "Create using this" section: the Text+ and MultiText boilerplates (src/main/boilerplates.js), and the
// pop-up manual that explains how to animate one and save it.

const BOILER_MANUAL = [
    {
        id: 'start', label: 'Quick start',
        blocks: [
            { p: 'The Create tab has two sub-tabs. ScratchPad hands out boilerplates (this manual). SelfServe is for a clip you select in your own timeline, or a file you drop in.' },
            { p: 'A boilerplate is a ready preset with the right structure (Inspector controls, timing slider, row and box controls) but no real animation yet. You only animate it; the app keeps it consistent with your other presets.' },
            { h: 'Five steps' },
            {
                ol: [
                    'Work on a scratch timeline, not your working one. Park the playhead where the clip should start.',
                    'Create tab > ScratchPad > pick Text+ or MultiText > Put on timeline. A 3 second title clip lands at the playhead on the first free layer above V1 (never V1). If Resolve says it cannot insert it, wait 3 seconds and click again (it has to scan the new template).',
                    'Click the clip. On the Edit page, Inspector > Title: change the text, font, colour and size. Use Open in Fusion Page (right-click the clip) to animate it: the next tabs say where.',
                    'Play it back. Make sure the animation finishes inside the clip and nothing is blank at the start, middle or end.',
                    'Back in the app, open the SelfServe tab: keep the clip selected in Resolve, then step 2 "From timeline". A looping preview shows. Give it a name (step 1), add a sound if you like (step 3), then Save to library.'
                ]
            },
            { h: 'After saving' },
            {
                ul: [
                    'Library tab: set tags, the preset\'s sound (MultiText: one sound per row) and its default position.',
                    'Renaming a preset renames its Resolve title too ("Text+ <name>" / "MultiText <name>"). Revert puts back the file you saved first.',
                    'Delete the boilerplate clip from the scratch timeline when you are done: the library keeps your copy.',
                    'Use as file skips the timeline: it opens SelfServe with the boilerplate file chosen, so you can save it as it is and adjust it later.'
                ]
            }
        ]
    },
    {
        id: 'text', label: 'Text+',
        blocks: [
            { p: 'One block of text that fades in letter by letter. The tools inside, in the Fusion page:' },
            {
                ul: [
                    'Template: the text itself. Font, size, colour, position and the style of the whole line live here. Animation Frames (Inspector > Text) sets how long the whole animation takes.',
                    'Follower1: the per-letter animation. Order sets how the text is split (letters, words, lines) and Delay sets how long each piece waits for the one before it.',
                    'Follower1Opacity1: a spline holding the fade-in (0 at frame 0, 1 at frame 12). Open the Spline editor to reshape it.',
                    'AnimTime: the retiming that makes Animation Frames work. Leave it alone.',
                    'MediaOut1: the output. Leave it alone.'
                ]
            },
            { h: 'To animate it' },
            {
                ol: [
                    'Select Follower1. Tick the transform you want under Select Transform: Size, Offset, Rotation, Softness.',
                    'Move the playhead to the first frame, set the starting value (for example Size 0, Offset 0.05 down), and add a keyframe (the diamond).',
                    'Move to the frame where the word should be settled (about 10 to 20 frames later), set the final value, and add a keyframe.',
                    'Ease it in the Spline editor: drag the handles so it slows down at the end.',
                    'Changing the text later does not break anything: the animation follows every letter.'
                ]
            },
            { p: 'Keep the whole animation within the first one to two seconds; the clip then holds the finished text until it ends.' }
        ]
    },
    {
        id: 'multi', label: 'MultiText',
        blocks: [
            { p: 'Three rows of text (Upper, Emphasis, Lower) with a highlight box behind the emphasised word. The tools, in the Fusion page:' },
            {
                ul: [
                    'Template (MultiText): the three texts (Text 1 Upper, Text 2 Emphasis, Text 3 Lower), their fonts and sizes, and every Inspector control.',
                    'UpperFollower, EmphasisFollower, LowerFollower: one animation per row. They are set up as a soft fade and rise that starts at that row\'s start frame.',
                    'Highlight and HighlightMerge: the box behind the emphasis word.',
                    'Seg1 / Seg2 / Seg3 Start and End (on Template): when each row starts and ends its animation. The timing bar in the Use tab moves these.'
                ]
            },
            { h: 'To animate it' },
            {
                ol: [
                    'Select a row\'s Follower and change what it does: the Opacity, Word Size X / Y and Word Offset inputs are expressions that follow that row\'s start frame. Replace the expression (or keyframe the input) with your own motion.',
                    'To change when a row starts, change Seg1Start / Seg2Start / Seg3Start rather than the keyframes: the sounds, the timing bar and the box follow those numbers.',
                    'The box: Highlight Color, Box Width / Height / X / Y and Accent Opacity are in the Inspector and in the app\'s Clip controls. Accent Opacity 0 hides the box.',
                    'Rows: Row Gap, Gap Mode, Equal Gaps, All / Upper / Emphasis / Lower X and Y, and Justify are in Clip controls. Equal Gaps keeps the space above and below the emphasis the same.'
                ]
            },
            { p: 'Your fonts, text colour and emphasis colour from the Prompt tab rules are applied when the preset is placed, so you do not need to colour the boilerplate.' }
        ]
    },
    {
        id: 'selfserve', label: 'SelfServe',
        blocks: [
            { p: 'SelfServe saves an animation you already have: a clip you select in your own timeline, or a Fusion file. It is also where a boilerplate is saved after you animate it.' },
            { h: 'From a clip in your timeline' },
            {
                ol: [
                    'In Resolve, click the title clip once so it is selected (a clip that is only under the playhead does not count).',
                    'Step 2: click From timeline. The app reads the clip\'s animation and shows a looping preview. Click it again to take a different clip.',
                    'Step 1: give it a name. Step 3 (optional): drop a sound file for it.',
                    'Save to library. It then appears in the Use tab and the Library tab.'
                ]
            },
            { h: 'From a file' },
            {
                ul: [
                    'Drop a Fusion .comp or .setting file on the Fusion file tile (or click it to browse), then name it and save.',
                    'The app expands the file\'s tools and adds the timing slider; it does not add Row or Box controls or build MultiText layers. Start from a boilerplate if you need those.'
                ]
            }
        ]
    },
    {
        id: 'rules', label: 'Rules & fixes',
        blocks: [
            { h: 'Keep these' },
            {
                ul: [
                    'Keep the tool names (Template, Follower1, AnimTime, MediaOut1, UpperFollower, Highlight...). The app finds the parts by name.',
                    'Do not delete the Animation Frames or Seg controls on Template: the timing bar and the sounds use them.',
                    'Keep the preset made of Fusion\'s own tools. A Resolve FX / OFX node makes the Inspector empty. For Glitch, Wiggle, Stop Motion and Transform use Effect Preset in the Use tab instead.',
                    'Never import a Fusion comp over a clip you want to keep. Always start from Put on timeline.',
                    'Test on a scratch timeline, never your working one.'
                ]
            },
            { h: 'If something looks wrong' },
            {
                ul: [
                    'Nothing happens on Put on timeline: a Preview in Resolve is probably running (click Apply or Remove on it), or the app is still busy placing. Wait a moment and try again.',
                    '"Resolve would not insert": the new template was not scanned yet. Wait 3 seconds and click again.',
                    'The Inspector shows only a folded "Text+" header: the clip is not a template clip. Delete it and use Put on timeline again, or run Repair from Claude Code.',
                    'The clip is blank: scrub to its first frame and check Animation Frames is 0 or the length you want, and that the first keyframe is on frame 0.',
                    'SelfServe > From timeline says to select a clip: click the clip on the timeline first (it must be selected, not just under the playhead).',
                    'The two Boilerplate titles also show in Resolve\'s Effects > Titles > Subtitle Animator, so you can drag them in yourself.'
                ]
            }
        ]
    }
];

function boilerEl(tag, cls, text) {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    return e;
}

function boilerBlocks(parent, blocks) {
    for (const b of blocks) {
        if (b.h) parent.appendChild(boilerEl('div', 'bm-h', b.h));
        if (b.p) parent.appendChild(boilerEl('p', 'bm-p', b.p));
        for (const key of ['ol', 'ul']) {
            if (!b[key]) continue;
            const list = boilerEl(key, 'bm-list');
            for (const t of b[key]) list.appendChild(boilerEl('li', '', t));
            parent.appendChild(list);
        }
    }
}

function closeBoilerManual() {
    const m = $('boilerManual');
    if (!m) return;
    m.remove();
    document.removeEventListener('keydown', boilerManualKey, true);
}
function boilerManualKey(e) { if (e.key === 'Escape') { e.stopPropagation(); closeBoilerManual(); } }

function openBoilerManual(startTab) {
    closeBoilerManual();
    const wrap = boilerEl('div', 'bm-wrap');
    wrap.id = 'boilerManual';
    wrap.setAttribute('role', 'dialog');
    wrap.setAttribute('aria-modal', 'true');
    wrap.setAttribute('aria-label', 'Create using this: user manual');
    wrap.addEventListener('mousedown', (e) => { if (e.target === wrap) closeBoilerManual(); });

    const card = boilerEl('div', 'bm-card');
    const head = boilerEl('div', 'bm-head');
    head.appendChild(boilerEl('span', 'bm-title', 'Create using this: user manual'));
    const x = boilerEl('button', 'ghost bm-x', '✕');
    x.type = 'button'; x.title = 'Close (Esc)'; x.setAttribute('aria-label', 'Close');
    x.addEventListener('click', closeBoilerManual);
    head.appendChild(x);

    const tabs = boilerEl('div', 'bm-tabs');
    const body = boilerEl('div', 'bm-body');
    const show = (id) => {
        const sec = BOILER_MANUAL.find(s => s.id === id) || BOILER_MANUAL[0];
        tabs.querySelectorAll('button').forEach(b => b.classList.toggle('on', b.dataset.id === sec.id));
        body.textContent = '';
        boilerBlocks(body, sec.blocks);
        body.scrollTop = 0;
    };
    for (const s of BOILER_MANUAL) {
        const b = boilerEl('button', 'bm-tab', s.label);
        b.type = 'button'; b.dataset.id = s.id;
        b.addEventListener('click', () => show(s.id));
        tabs.appendChild(b);
    }
    card.append(head, tabs, body);
    wrap.appendChild(card);
    document.body.appendChild(wrap);
    document.addEventListener('keydown', boilerManualKey, true);
    show(startTab);
    x.focus();
}

function boilerStatus(msg, kind) {
    const el = $('boilerStatus');
    if (!el) return;
    el.textContent = msg || '';
    el.className = 'status boiler-status' + (kind ? ' ' + kind : '');
}

async function boilerInsert(id, btn) {
    if (btn.classList.contains('busy')) return;
    btn.classList.add('busy'); btn.disabled = true;
    boilerStatus('Putting the boilerplate on the timeline…');
    let res;
    try { res = await window.sa.insertBoilerplate(id); } catch (e) { res = { error: String(e && e.message || e) }; }
    btn.classList.remove('busy'); btn.disabled = false;
    if (!res || res.error) { boilerStatus((res && res.error) || 'Could not put it on the timeline', 'bad'); return; }
    boilerStatus('On ' + res.track + ' at the playhead. Select it, animate it, then open SelfServe and use "From timeline" in step 2. (? Manual explains how)', 'ok');
}

async function boilerUseFile(id) {
    let list = [];
    try { list = await window.sa.boilerplateList(); } catch (e) { list = []; }
    const b = (list || []).find(x => x.id === id);
    if (!b) { boilerStatus('Could not find the boilerplate file', 'bad'); return; }
    const d = state.draft;
    d.animPath = b.path; d.fromSelection = false;
    clearTimelineDraft();
    renderCreate();
    showCreateTab('selfserve');
    boilerStatus(b.title + ' is chosen as the text animation (step 2 in SelfServe). Name it and save.', 'ok');
}

function initBoilerplates() {
    const choices = $('boilerChoices');
    if (!choices) return;
    choices.addEventListener('click', (e) => {
        const btn = e.target.closest && e.target.closest('button[data-act]');
        const tile = e.target.closest && e.target.closest('.boiler-tile');
        if (!btn || !tile) return;
        if (btn.dataset.act === 'insert') boilerInsert(tile.dataset.boiler, btn);
        else boilerUseFile(tile.dataset.boiler);
    });
    const next = $('boilerNext');
    if (next) next.addEventListener('click', () => showCreateTab('selfserve'));
    const manual = $('boilerManualBtn');
    if (manual) manual.addEventListener('click', () => openBoilerManual('start'));
}
