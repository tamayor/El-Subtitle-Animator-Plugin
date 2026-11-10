// HTML templates of the shared panel blocks (alignment, config, text design, save bar, preview).

// Small line icons for the alignment toolbar (they inherit the button's colour).
const ICONS = {
    play: '<svg viewBox="0 0 16 16" aria-hidden="true"><path fill="currentColor" d="M5 2.9v10.2c0 .5.55.8.97.54l7.9-5.1a.64.64 0 0 0 0-1.08l-7.9-5.1A.64.64 0 0 0 5 2.9z"/></svg>',
    pause: '<svg viewBox="0 0 16 16" aria-hidden="true"><rect x="3.6" y="2.6" width="3.1" height="10.8" rx="1" fill="currentColor"/><rect x="9.3" y="2.6" width="3.1" height="10.8" rx="1" fill="currentColor"/></svg>',
    loop: '<svg viewBox="0 0 16 16" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M2.6 8V7.2A2.7 2.7 0 0 1 5.3 4.5h7.1"/><path d="m10.4 2.3 2.3 2.2-2.3 2.2"/><path d="M13.4 8v.8a2.7 2.7 0 0 1-2.7 2.7H3.6"/><path d="m5.6 13.7-2.3-2.2 2.3-2.2"/></svg>',
    scrub: '<svg viewBox="0 0 16 16" aria-hidden="true"><path fill="currentColor" d="M5.2 2.4h5.6a.5.5 0 0 1 .4.8L8.4 6.6a.5.5 0 0 1-.8 0L4.8 3.2a.5.5 0 0 1 .4-.8z"/><path d="M8 6v7.6" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" fill="none"/><path d="M3.4 9.3 1.8 10.9l1.6 1.6M12.6 9.3l1.6 1.6-1.6 1.6" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round" fill="none"/></svg>'
};

const ALIGN_HTML = (S) => `
<div class="row between">
    <span class="aln-title">
        ${S === 'U' ? '<span class="label">Alignment timeline</span>' : ''}
        <span class="aln-play">
            <button type="button" id="alnPlay${S}" class="ghost aln-btn" title="Play once with its sound (click again to pause)">${ICONS.play}</button>
            <button type="button" id="alnMode${S}" class="ghost aln-btn" title="Loop the animation with its sound">${ICONS.loop}</button>
            <button type="button" id="alnScrub${S}" class="ghost aln-btn aln-scrub" title="Scrub the preview frame by frame to line the sound up with the text">${ICONS.scrub}</button>
        </span>
    </span>
    ${S === 'C' ? '' : `<button type="button" id="sndAdd${S}" class="ghost aln-btn" title="Add another sound (or drop a sound file on the timeline)">+ Sound</button>`}
</div>
<div id="scrubBox${S}" class="scrub-box hidden">
    <div class="scrub-view"><canvas id="scrubCv${S}"></canvas><div id="scrubMsg${S}" class="scrub-msg"></div><button type="button" id="scrubLoop${S}" class="sm-btn scrub-loop" title="Play the real 3 seconds of the animation (rendered in Resolve with your settings) on repeat">Loop 3s</button><button type="button" id="scrubAuto${S}" class="sm-btn scrub-auto hidden" title="Auto: every change of subtitle, text or design is rendered in Resolve right away (about 75 frames each time). Off: nothing is rendered until you press Render, which keeps Resolve free while you step through captions">Auto render</button><button type="button" id="scrubRender${S}" class="sm-btn scrub-render hidden" title="Render the selected preset with this subtitle in Resolve now">Render</button></div>
    <div id="scrubInfo${S}" class="scrub-info"></div>
</div>
<div id="tl${S}" class="tl"></div>
<div class="hint">${S === 'U' ? 'Click a bar to edit it below. Drag a bar to move it, its edges to trim it, and the line on a sound up / down for its volume. Click the ruler to move the Resolve playhead, or switch on scrubbing to step through the preview frame by frame.' : 'Click a bar to edit it. Drag to move it, drag its edges to trim, drag the line for volume.'}</div>
${S === 'C' ? `<div class="pc-addrow"><button type="button" id="sndAddC" class="ghost aln-btn" title="Add another sound (or drop a sound file on the timeline)">+ Sound</button></div>` : ''}
<div id="sndCard${S}" class="snd-card"></div>
${S === 'U' ? '<div class="row"><button id="resetU" class="ghost">Reset to this item\'s default</button></div>' : ''}`;

const CONFIG_HTML = () => `
<div class="pc-orig">
    <div class="hint pc-orig-hint">Every preset keeps a pristine copy of its files. Revert to it any time, or replace the original with something new.</div>
    <div class="pc-list">
        <div class="pc-item">
            <div class="pc-item-top">
                <span class="pc-ico">⚙</span>
                <div class="pc-text">
                    <div class="pc-cap">Text template</div>
                    <div id="cfgSettingOrigFile" class="pc-val" title="Preserved original in presets/original/">—</div>
                </div>
                <button type="button" id="cfgSettingRevert" class="ghost pc-revert" title="Revert .settings and design back to the original">↺ Revert</button>
            </div>
            <div id="cfgSettingDrop" class="pc-item-actions drop-target" title="Drop a .setting or .comp file or folder here to overwrite the original">
                <span class="pc-act-label">Overwrite original with</span>
                <button type="button" id="cfgSettingFromTimeline" class="pc-chip" title="Export the selected Text+ clip on the Resolve timeline">🎞 Timeline</button>
                <button type="button" id="cfgSettingFromCurrent" class="pc-chip" title="Use this preset's current settings">💾 Current</button>
                <button type="button" id="cfgSettingPick" class="pc-chip" title="Pick a .setting / .comp file or folder (or drop one on this row)">📁 File…</button>
            </div>
            <input type="file" id="cfgSettingFileInput" accept=".setting,.comp" style="display:none">
        </div>
        <div class="pc-item">
            <div class="pc-item-top">
                <span class="pc-ico">♪</span>
                <div class="pc-text">
                    <div class="pc-cap">Sound effect</div>
                    <div id="cfgAudioOrigFile" class="pc-val" title="Original sound file in sounds/original/">—</div>
                </div>
                <button type="button" id="cfgAudioRevert" class="ghost pc-revert" title="Revert the audio back to the original sound">↺ Revert</button>
            </div>
            <div id="cfgAudioDrop" class="pc-item-actions drop-target" title="Drop an audio file or folder here to overwrite the original">
                <span class="pc-act-label">Overwrite original with</span>
                <button type="button" id="cfgAudioFromTimeline" class="pc-chip" title="Use the selected audio clip on the Resolve timeline">🎞 Timeline</button>
                <button type="button" id="cfgAudioFromCurrent" class="pc-chip" title="Use the current sound">💾 Current</button>
                <button type="button" id="cfgAudioPick" class="pc-chip" title="Pick an audio file or folder (or drop one on this row)">📁 File…</button>
                <span class="cfg-orig-picker-wrap">
                    <button type="button" id="cfgAudioOrigBtn" class="pc-chip" title="Choose from your stored original sounds">Library ▾</button>
                    <div id="cfgAudioOrigDropdown" class="sfx-orig-dropdown hidden"></div>
                </span>
            </div>
            <input type="file" id="cfgAudioFileInput" accept="audio/*,.wav,.mp3,.aif,.aiff,.m4a,.flac,.ogg" style="display:none">
        </div>
    </div>
</div>
`;

// ---- Resolve Inspector-style building blocks (label | control | value box)
const TEXT_DESIGN_HTML = (S) => `
<div class="td-panel">
    <div class="td-header">
        <span class="label">Text &amp; Shading Design</span>
        <span class="meta">${S === 'U' ? 'On-the-go override' : 'Default design'}</span>
    </div>

    <div id="tdTarget${S}" class="td-target hidden"></div>

    <div id="tdTabs${S}" class="td-tabs" role="tablist">
        <button type="button" class="td-tab on" data-tab="text">Text</button>
        <button type="button" class="td-tab" data-tab="shading">Shading Elements</button>
        <button type="button" class="td-tab" data-tab="layout">Layout</button>
    </div>

    <div class="td-pane" data-pane="text">
    <div class="row two">
        <div class="ctl">
            <label title="Double-click to reset to default (Poppins)">Font</label>
            <input id="tdFont${S}" type="text" placeholder="Search fonts…" data-default="Poppins" autocomplete="off" spellcheck="false">
        </div>
        <div class="ctl">
            <label title="Double-click to reset to default (Bold)">Style</label>
            <select id="tdStyle${S}" data-default="Bold">
                ${STYLE_OPTIONS.map(st => `<option value="${st}">${st}</option>`).join('')}
            </select>
        </div>
    </div>
    <div class="row td-color-size">
        <label class="color-pick" title="Primary text fill color (Element 1) · Double-click to reset to #ffffff">
            <span>Color</span>
            <input id="tdColor${S}" type="color" value="#ffffff" data-default="#ffffff">
        </label>
        <div class="ctl grow">
            <label title="Double-click to reset to default (0.080)">Size <span class="val" id="vTdSize${S}">0.080</span></label>
            <input id="tdSize${S}" type="range" min="0.02" max="0.40" step="0.002" value="0.08" data-default="0.08">
        </div>
    </div>
    <div class="row two">
        <div class="ctl">
            <label title="Double-click to reset to default (1.00)">Tracking <span class="val" id="vTdTrack${S}">1.00</span></label>
            <input id="tdTrack${S}" type="range" min="0.50" max="2.00" step="0.01" value="1.00" data-default="1.00">
        </div>
        <div class="ctl">
            <label title="Double-click to reset to default (1.00)">Line Spacing <span class="val" id="vTdLine${S}">1.00</span></label>
            <input id="tdLine${S}" type="range" min="0.50" max="2.00" step="0.01" value="1.00" data-default="1.00">
        </div>
    </div>
    <div class="td-textplus">
    <div class="td-line">
        <span class="td-lbl">V Anchor</span>
        <div class="td-btns" id="tdVAncBtns${S}"><button type="button" class="td-ibtn" data-anchor="v" data-val="-1" title="Top"><svg viewBox="0 0 16 16" width="14" height="14"><path d="M2 2h12M2 14h12" stroke="currentColor" stroke-width="1" opacity=".35"/><rect x="5" y="2" width="6" height="3" rx=".5" fill="currentColor"/></svg></button><button type="button" class="td-ibtn" data-anchor="v" data-val="0" title="Center"><svg viewBox="0 0 16 16" width="14" height="14"><path d="M2 2h12M2 14h12" stroke="currentColor" stroke-width="1" opacity=".35"/><rect x="5" y="7" width="6" height="3" rx=".5" fill="currentColor"/></svg></button><button type="button" class="td-ibtn" data-anchor="v" data-val="1" title="Bottom"><svg viewBox="0 0 16 16" width="14" height="14"><path d="M2 2h12M2 14h12" stroke="currentColor" stroke-width="1" opacity=".35"/><rect x="5" y="12" width="6" height="3" rx=".5" fill="currentColor"/></svg></button></div>
        <div class="td-slwrap">
            <input id="tdVAnc${S}" type="range" min="-1" max="1" step="0.01" value="0" data-default="0" title="Double-click to reset to default (0)">
            <div class="td-sllbl"><span>Top</span><span>Bottom</span></div>
        </div>
    </div>
    <div class="td-line">
        <span class="td-lbl">V Justify</span>
        <div class="td-slwrap full">
            <input id="tdVJust${S}" type="range" min="0" max="1" step="0.01" value="0" data-default="0" title="Double-click to reset to default (0)">
        </div>
        <span class="val td-num" id="vTdVJust${S}">0.00</span>
    </div>
    <div class="td-line">
        <span class="td-lbl">H Anchor</span>
        <div class="td-btns" id="tdHAncBtns${S}"><button type="button" class="td-ibtn" data-anchor="h" data-val="-1" title="Left"><svg viewBox="0 0 16 16" width="14" height="14"><path d="M2 2v12M14 2v12" stroke="currentColor" stroke-width="1" opacity=".35"/><rect x="3" y="6" width="4" height="4" rx=".5" fill="currentColor"/></svg></button><button type="button" class="td-ibtn" data-anchor="h" data-val="0" title="Center"><svg viewBox="0 0 16 16" width="14" height="14"><path d="M2 2v12M14 2v12" stroke="currentColor" stroke-width="1" opacity=".35"/><rect x="6" y="6" width="4" height="4" rx=".5" fill="currentColor"/></svg></button><button type="button" class="td-ibtn" data-anchor="h" data-val="1" title="Right"><svg viewBox="0 0 16 16" width="14" height="14"><path d="M2 2v12M14 2v12" stroke="currentColor" stroke-width="1" opacity=".35"/><rect x="9" y="6" width="4" height="4" rx=".5" fill="currentColor"/></svg></button></div>
        <div class="td-slwrap">
            <input id="tdHAnc${S}" type="range" min="-1" max="1" step="0.01" value="0" data-default="0" title="Double-click to reset to default (0)">
            <div class="td-sllbl"><span>Left</span><span>Right</span></div>
        </div>
    </div>
    <div class="td-line">
        <span class="td-lbl">H Justify</span>
        <div class="td-slwrap full">
            <input id="tdHJust${S}" type="range" min="0" max="1" step="0.01" value="0" data-default="0" title="Double-click to reset to default (0)">
        </div>
        <span class="val td-num" id="vTdHJust${S}">0.00</span>
    </div>
    <div class="td-line">
        <span class="td-lbl">Direction</span>
        <select id="tdDir${S}" class="td-sel" data-default="0"><option value="0">Automatic</option><option value="1">Horizontal</option><option value="2">Reversed Horizontal</option><option value="3">Vertical</option><option value="4">Reversed Vertical</option></select>
    </div>
    <div class="td-line">
        <span class="td-lbl">Line Direction</span>
        <select id="tdLDir${S}" class="td-sel" data-default="0"><option value="0">Automatic</option><option value="1">Top Down</option><option value="2">Bottom Up</option></select>
    </div>
    <div class="td-line">
        <span class="td-lbl">Emphasis</span>
        <div class="td-btns">
            <button type="button" class="td-ibtn" id="tdStrike${S}" title="Strikeout"><svg viewBox="0 0 16 16" width="14" height="14"><text x="3" y="12" font-size="11" font-weight="700" fill="currentColor">S</text><path d="M1 8h14" stroke="currentColor" stroke-width="1.3"/></svg></button>
            <button type="button" class="td-ibtn" id="tdUnder${S}" title="Underline"><svg viewBox="0 0 16 16" width="14" height="14"><text x="3.5" y="11" font-size="11" font-weight="700" fill="currentColor">U</text><path d="M2 14h12" stroke="currentColor" stroke-width="1.3"/></svg></button>
        </div>
    </div>
    </div>

    </div>

    <div class="td-pane hidden" data-pane="layout">
    <div class="td-layout">
        <div class="xform-grid-row">
            <label class="xform-lbl" for="lyType${S}" title="Double-click to reset to default (Point)">Type</label>
            <select id="lyType${S}" class="ly-select" data-default="0">
                <option value="0">Point</option>
                <option value="1">Frame</option>
                <option value="2">Circle</option>
                <option value="3">Path</option>
            </select>
        </div>
        <div class="xform-grid-row">
            <label class="xform-lbl" title="Where the text sits (same as dragging it on the preview). Double-click to reset to 0.5 / 0.5">Center</label>
            <div class="xform-num-cell"><span class="xform-axis">X</span><input id="lyCx${S}" type="number" class="rv-num xform-num" step="0.001" value="0.5" data-default="0.5"></div>
            <div class="xform-num-cell"><span class="xform-axis">Y</span><input id="lyCy${S}" type="number" class="rv-num xform-num" step="0.001" value="0.5" data-default="0.5"></div>
        </div>
        <div class="xform-grid-row">
            <label class="xform-lbl" for="lyCzN${S}" title="Double-click to reset to default (0.0)">Center Z</label>
            <div class="xform-slider-cell"><input id="lyCz${S}" type="range" class="rv-slider" min="-1" max="1" step="0.01" value="0" data-default="0"></div>
            <div class="xform-num-cell"><input id="lyCzN${S}" type="number" class="rv-num xform-num" step="0.01" value="0" data-default="0"></div>
        </div>
        <div class="xform-grid-row">
            <label class="xform-lbl" title="Double-click to reset to 0.5 / 0.5">Pivot</label>
            <div class="xform-num-cell"><span class="xform-axis">X</span><input id="lyPx${S}" type="number" class="rv-num xform-num" step="0.001" value="0.5" data-default="0.5"></div>
            <div class="xform-num-cell"><span class="xform-axis">Y</span><input id="lyPy${S}" type="number" class="rv-num xform-num" step="0.001" value="0.5" data-default="0.5"></div>
        </div>
        <div class="xform-grid-row">
            <label class="xform-lbl" for="lyPzN${S}" title="Double-click to reset to default (0.0)">Pivot Z</label>
            <div class="xform-slider-cell"><input id="lyPz${S}" type="range" class="rv-slider" min="-1" max="1" step="0.01" value="0" data-default="0"></div>
            <div class="xform-num-cell"><input id="lyPzN${S}" type="number" class="rv-num xform-num" step="0.01" value="0" data-default="0"></div>
        </div>
        <div class="xform-grid-row">
            <label class="xform-lbl" for="lySizeN${S}" title="Double-click to reset to default (1.0)">Size</label>
            <div class="xform-slider-cell"><input id="lySize${S}" type="range" class="rv-slider" min="0" max="5" step="0.01" value="1" data-default="1"></div>
            <div class="xform-num-cell"><input id="lySizeN${S}" type="number" class="rv-num xform-num" min="0" step="0.01" value="1" data-default="1"></div>
        </div>
        <div class="xform-grid-row">
            <label class="xform-lbl" for="lyPerspN${S}" title="Double-click to reset to default (1.0)">Perspective</label>
            <div class="xform-slider-cell"><input id="lyPersp${S}" type="range" class="rv-slider" min="0" max="5" step="0.01" value="1" data-default="1"></div>
            <div class="xform-num-cell"><input id="lyPerspN${S}" type="number" class="rv-num xform-num" min="0" step="0.01" value="1" data-default="1"></div>
        </div>
    </div>

    </div>

    <div class="td-pane hidden" data-pane="shading">
    <div class="sh-row">
        <span class="sh-lbl">Select Element</span>
        <div id="shSel${S}" class="sh-tabs">
            ${[1, 2, 3, 4, 5, 6, 7, 8].map(i => `<button type="button" class="sh-tab" data-idx="${i}">${i}</button>`).join('')}
        </div>
    </div>
    <div class="row between sh-name-row">
        <input id="shName${S}" type="text" class="sh-name" placeholder="Element name">
        <label class="check"><input id="shEnabled${S}" type="checkbox"> Enabled</label>
    </div>

    <div id="shProps${S}" class="sh-props">
        <div class="sh-row">
            <span class="sh-lbl">Appearance</span>
            <div id="shShape${S}" class="sh-shapes">
                <button type="button" class="sh-shape" data-shape="0" title="Text Fill"><b>A</b></button>
                <button type="button" class="sh-shape" data-shape="1" title="Text Outline">
                    <svg viewBox="0 0 16 16" width="13" height="13" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 13.5 8 2.5l5 11M4.8 9.5h6.4"/></svg>
                </button>
                <button type="button" class="sh-shape" data-shape="2" title="Border Fill (Box)"><span class="ico-box-fill"></span></button>
                <button type="button" class="sh-shape" data-shape="3" title="Border Outline"><span class="ico-box-out"></span></button>
            </div>
        </div>
        <div class="rv-row">
            <label class="rv-lbl" title="Double-click to reset to default (Solid)">Type</label>
            <div id="shType${S}" class="rv-seg">
                <button type="button" class="rv-seg-btn on" data-type="0">Solid</button>
                <button type="button" class="rv-seg-btn" data-type="2">Gradient</button>
            </div>
            <span class="rv-kf-space" title="Keyframe">
                <svg class="rv-kf" viewBox="0 0 10 10" width="8" height="8"><polygon points="5,1 9,5 5,9 1,5" fill="none" stroke="currentColor" stroke-width="1.2"/></svg>
            </span>
        </div>

        <!-- Solid Color & Opacity (Alpha) Section -->
        <div id="shSolidWrap${S}" class="rv-color-group">
            <div class="rv-row">
                <label class="rv-lbl" for="shColor${S}" title="Click to choose color">Color</label>
                <div class="rv-color-ctl">
                    <button type="button" class="rv-disclosure open" id="shColorToggle${S}" title="Toggle RGBA controls">
                        <svg viewBox="0 0 10 10" width="8" height="8" fill="currentColor"><path d="M2.5 1.5 L7.5 5 L2.5 8.5 Z"/></svg>
                    </button>
                    <div class="rv-swatch-box" id="shSwatchBox${S}" title="Click to choose color">
                        <div class="rv-swatch-fill" id="shSwatchFill${S}"></div>
                        <input id="shColor${S}" type="color" value="#ffffff" data-default="#ffffff" class="rv-native-color">
                    </div>
                    <input id="shHex${S}" type="text" class="hex-input" maxlength="7" spellcheck="false" placeholder="#ffffff" value="#ffffff" title="Hex color code">
                    <button type="button" class="rv-eyedropper-btn" id="shDropBtn${S}" title="Pick screen color">
                        <svg viewBox="0 0 16 16" width="13" height="13" fill="currentColor">
                            <path d="M13.354.646a1.207 1.207 0 0 0-1.708 0L8.5 3.793l-.646-.647a.5.5 0 1 0-.708.708L8.293 5l-7.147 7.146A.5.5 0 0 0 1 12.5v2a.5.5 0 0 0 .5.5h2a.5.5 0 0 0 .354-.146L11 7.707l1.146 1.147a.5.5 0 0 0 .708-.708l-.647-.646 3.147-3.146a1.207 1.207 0 0 0 0-1.708l-2-2zM2 12.707l7-7L10.293 7l-7 7H2v-1.293z"/>
                        </svg>
                    </button>
                </div>
                <span class="rv-kf-space">
                    <svg class="rv-kf" viewBox="0 0 10 10" width="8" height="8"><polygon points="5,1 9,5 5,9 1,5" fill="none" stroke="currentColor" stroke-width="1.2"/></svg>
                </span>
            </div>

            <div id="shSolidSliders${S}">
                <div class="rv-row">
                    <label class="rv-lbl rv-sub-lbl" for="shRN${S}" title="Double-click to reset to 1.0">Red</label>
                    <div class="rv-slider-track-wrap">
                        <span class="rv-dot rv-dot-r"></span>
                        <input id="shR${S}" type="range" class="rv-slider rv-r" min="0" max="1" step="0.001" value="1" data-default="1.0">
                    </div>
                    <div class="rv-num-cell">
                        <input id="shRN${S}" type="number" class="rv-num" min="0" max="1" step="0.01" value="1.0" data-default="1.0">
                    </div>
                    <span class="rv-kf-space">
                        <svg class="rv-kf" viewBox="0 0 10 10" width="8" height="8"><polygon points="5,1 9,5 5,9 1,5" fill="none" stroke="currentColor" stroke-width="1.2"/></svg>
                    </span>
                </div>
                <div class="rv-row">
                    <label class="rv-lbl rv-sub-lbl" for="shGN${S}" title="Double-click to reset to 1.0">Green</label>
                    <div class="rv-slider-track-wrap">
                        <span class="rv-dot rv-dot-g"></span>
                        <input id="shG${S}" type="range" class="rv-slider rv-g" min="0" max="1" step="0.001" value="1" data-default="1.0">
                    </div>
                    <div class="rv-num-cell">
                        <input id="shGN${S}" type="number" class="rv-num" min="0" max="1" step="0.01" value="1.0" data-default="1.0">
                    </div>
                    <span class="rv-kf-space">
                        <svg class="rv-kf" viewBox="0 0 10 10" width="8" height="8"><polygon points="5,1 9,5 5,9 1,5" fill="none" stroke="currentColor" stroke-width="1.2"/></svg>
                    </span>
                </div>
                <div class="rv-row">
                    <label class="rv-lbl rv-sub-lbl" for="shBN${S}" title="Double-click to reset to 1.0">Blue</label>
                    <div class="rv-slider-track-wrap">
                        <span class="rv-dot rv-dot-b"></span>
                        <input id="shB${S}" type="range" class="rv-slider rv-b" min="0" max="1" step="0.001" value="1" data-default="1.0">
                    </div>
                    <div class="rv-num-cell">
                        <input id="shBN${S}" type="number" class="rv-num" min="0" max="1" step="0.01" value="1.0" data-default="1.0">
                    </div>
                    <span class="rv-kf-space">
                        <svg class="rv-kf" viewBox="0 0 10 10" width="8" height="8"><polygon points="5,1 9,5 5,9 1,5" fill="none" stroke="currentColor" stroke-width="1.2"/></svg>
                    </span>
                </div>
                <div class="rv-row">
                    <label class="rv-lbl rv-sub-lbl" for="vShOpacity${S}" title="Double-click to reset to 1.00">Alpha</label>
                    <div class="rv-slider-track-wrap">
                        <span class="rv-dot rv-dot-a"></span>
                        <input id="shOpacity${S}" type="range" class="rv-slider rv-a" min="0" max="1" step="0.01" value="1" data-default="1.00">
                    </div>
                    <div class="rv-num-cell">
                        <input id="vShOpacity${S}" type="number" class="rv-num" min="0" max="1" step="0.01" value="1.0" data-default="1.00">
                    </div>
                    <span class="rv-kf-space">
                        <svg class="rv-kf" viewBox="0 0 10 10" width="8" height="8"><polygon points="5,1 9,5 5,9 1,5" fill="none" stroke="currentColor" stroke-width="1.2"/></svg>
                    </span>
                </div>
            </div>
        </div>

        <!-- Gradient Section -->
        <div id="shGradWrap${S}" class="rv-color-group hidden">
            <div class="rv-row">
                <label class="rv-lbl">Shading Gradient</label>
                <div class="rv-spacer"></div>
                <span class="rv-kf-space">
                    <svg class="rv-kf" viewBox="0 0 10 10" width="8" height="8"><polygon points="5,1 9,5 5,9 1,5" fill="none" stroke="currentColor" stroke-width="1.2"/></svg>
                </span>
            </div>

            <div class="rv-grad-bar-wrap">
                <div class="rv-grad-bar" id="shGradBar${S}"></div>
                <div class="rv-grad-stops" id="shGradStops${S}">
                    <div class="rv-grad-stop sel" data-stop="0" id="shStop0${S}" style="left: 0%;" title="Start Color (0.0)">
                        <svg viewBox="0 0 10 10" width="10" height="10"><polygon points="5,0 10,10 0,10" fill="currentColor"/></svg>
                    </div>
                    <div class="rv-grad-stop" data-stop="1" id="shStop1${S}" style="left: 100%;" title="End Color (1.0)">
                        <svg viewBox="0 0 10 10" width="10" height="10"><polygon points="5,0 10,10 0,10" fill="currentColor"/></svg>
                    </div>
                </div>
            </div>

            <div class="rv-row rv-offset-row">
                <div class="rv-spacer"></div>
                <div class="rv-num-cell">
                    <input id="shStopOffset${S}" type="number" class="rv-num" min="0" max="1" step="0.01" value="0.0" readonly title="Stop Offset">
                </div>
            </div>

            <div class="rv-row">
                <label class="rv-lbl" id="shStopLbl${S}">Start Color</label>
                <div class="rv-color-ctl">
                    <button type="button" class="rv-disclosure open" id="shGradColorToggle${S}">
                        <svg viewBox="0 0 10 10" width="8" height="8" fill="currentColor"><path d="M2.5 1.5 L7.5 5 L2.5 8.5 Z"/></svg>
                    </button>
                    <div class="rv-swatch-box" id="shGradSwatchBox${S}" title="Click to choose stop color">
                        <div class="rv-swatch-fill" id="shGradSwatchFill${S}"></div>
                        <input id="shGradColorInput${S}" type="color" value="#ffffff" class="rv-native-color">
                    </div>
                    <input id="shGradHex${S}" type="text" class="hex-input" maxlength="7" spellcheck="false" placeholder="#ffffff" value="#ffffff" title="Hex color code for active stop">
                    <button type="button" class="rv-eyedropper-btn" id="shGradDropBtn${S}" title="Pick screen color">
                        <svg viewBox="0 0 16 16" width="13" height="13" fill="currentColor">
                            <path d="M13.354.646a1.207 1.207 0 0 0-1.708 0L8.5 3.793l-.646-.647a.5.5 0 1 0-.708.708L8.293 5l-7.147 7.146A.5.5 0 0 0 1 12.5v2a.5.5 0 0 0 .5.5h2a.5.5 0 0 0 .354-.146L11 7.707l1.146 1.147a.5.5 0 0 0 .708-.708l-.647-.646 3.147-3.146a1.207 1.207 0 0 0 0-1.708l-2-2zM2 12.707l7-7L10.293 7l-7 7H2v-1.293z"/>
                        </svg>
                    </button>
                    <input id="shColor2${S}" type="color" value="#f07b8e" data-default="#f07b8e" class="hidden">
                </div>
            </div>

            <div id="shGradSliders${S}">
                <div class="rv-row">
                    <label class="rv-lbl rv-sub-lbl" for="shGradRN${S}" title="Double-click to reset to 1.0">Red</label>
                    <div class="rv-slider-track-wrap">
                        <span class="rv-dot rv-dot-r"></span>
                        <input id="shGradR${S}" type="range" class="rv-slider rv-r" min="0" max="1" step="0.001" value="1" data-default="1.0">
                    </div>
                    <div class="rv-num-cell">
                        <input id="shGradRN${S}" type="number" class="rv-num" min="0" max="1" step="0.01" value="1.0" data-default="1.0">
                    </div>
                </div>
                <div class="rv-row">
                    <label class="rv-lbl rv-sub-lbl" for="shGradGN${S}" title="Double-click to reset to 1.0">Green</label>
                    <div class="rv-slider-track-wrap">
                        <span class="rv-dot rv-dot-g"></span>
                        <input id="shGradG${S}" type="range" class="rv-slider rv-g" min="0" max="1" step="0.001" value="1" data-default="1.0">
                    </div>
                    <div class="rv-num-cell">
                        <input id="shGradGN${S}" type="number" class="rv-num" min="0" max="1" step="0.01" value="1.0" data-default="1.0">
                    </div>
                </div>
                <div class="rv-row">
                    <label class="rv-lbl rv-sub-lbl" for="shGradBN${S}" title="Double-click to reset to 1.0">Blue</label>
                    <div class="rv-slider-track-wrap">
                        <span class="rv-dot rv-dot-b"></span>
                        <input id="shGradB${S}" type="range" class="rv-slider rv-b" min="0" max="1" step="0.001" value="1" data-default="1.0">
                    </div>
                    <div class="rv-num-cell">
                        <input id="shGradBN${S}" type="number" class="rv-num" min="0" max="1" step="0.01" value="1.0" data-default="1.0">
                    </div>
                </div>
                <div class="rv-row">
                    <label class="rv-lbl rv-sub-lbl" for="shGradAN${S}" title="Double-click to reset to 1.0">Alpha</label>
                    <div class="rv-slider-track-wrap">
                        <span class="rv-dot rv-dot-a"></span>
                        <input id="shGradA${S}" type="range" class="rv-slider rv-a" min="0" max="1" step="0.01" value="1" data-default="1.0">
                    </div>
                    <div class="rv-num-cell">
                        <input id="shGradAN${S}" type="number" class="rv-num" min="0" max="1" step="0.01" value="1.0" data-default="1.0">
                    </div>
                </div>
            </div>

            <div class="rv-row">
                <label class="rv-lbl" for="shMapAngleN${S}" title="Double-click to reset to default (0.0)">Mapping Angle</label>
                <div class="rv-slider-track-wrap">
                    <input id="shMapAngle${S}" type="range" class="rv-slider" min="-180" max="180" step="1" value="0" data-default="0">
                </div>
                <div class="rv-num-cell">
                    <input id="shMapAngleN${S}" type="number" class="rv-num" min="-180" max="180" step="0.1" value="0.0" data-default="0.0">
                </div>
                <span class="rv-kf-space">
                    <svg class="rv-kf" viewBox="0 0 10 10" width="8" height="8"><polygon points="5,1 9,5 5,9 1,5" fill="none" stroke="currentColor" stroke-width="1.2"/></svg>
                </span>
            </div>

            <div class="rv-row">
                <label class="rv-lbl" for="shMapSizeN${S}" title="Double-click to reset to default (1.00)">Mapping Size</label>
                <div class="rv-slider-track-wrap">
                    <input id="shMapSize${S}" type="range" class="rv-slider" min="0.1" max="5" step="0.01" value="1" data-default="1.00">
                </div>
                <div class="rv-num-cell">
                    <input id="shMapSizeN${S}" type="number" class="rv-num" min="0.1" max="10" step="0.01" value="1.0" data-default="1.00">
                </div>
                <span class="rv-kf-space">
                    <svg class="rv-kf" viewBox="0 0 10 10" width="8" height="8"><polygon points="5,1 9,5 5,9 1,5" fill="none" stroke="currentColor" stroke-width="1.2"/></svg>
                </span>
            </div>

            <div class="rv-row">
                <label class="rv-lbl" for="shMapAspectN${S}" title="Double-click to reset to default (1.00)">Mapping Aspect</label>
                <div class="rv-slider-track-wrap">
                    <input id="shMapAspect${S}" type="range" class="rv-slider" min="0.1" max="5" step="0.01" value="1" data-default="1.00">
                </div>
                <div class="rv-num-cell">
                    <input id="shMapAspectN${S}" type="number" class="rv-num" min="0.1" max="10" step="0.01" value="1.0" data-default="1.00">
                </div>
                <span class="rv-kf-space">
                    <svg class="rv-kf" viewBox="0 0 10 10" width="8" height="8"><polygon points="5,1 9,5 5,9 1,5" fill="none" stroke="currentColor" stroke-width="1.2"/></svg>
                </span>
            </div>

            <div class="rv-row">
                <label class="rv-lbl" for="shMapLevel${S}">Mapping Level</label>
                <select id="shMapLevel${S}" class="rv-select" data-default="3">
                    <option value="3">Character</option>
                    <option value="2">Word</option>
                    <option value="1">Line</option>
                    <option value="0">Text</option>
                </select>
                <span class="rv-kf-space">
                    <svg class="rv-kf" viewBox="0 0 10 10" width="8" height="8"><polygon points="5,1 9,5 5,9 1,5" fill="none" stroke="currentColor" stroke-width="1.2"/></svg>
                </span>
            </div>
        </div>
        <div id="shThickWrap${S}" class="ctl">
            <label title="Double-click to reset to default (0.020)">Thickness <span class="val" id="vShThickness${S}">0.020</span></label>
            <input id="shThickness${S}" type="range" min="0" max="0.15" step="0.002" value="0.02" data-default="0.020">
        </div>
        <div id="shBorderWrap${S}" class="sh-border-box">
            <div class="ctl">
                <label>Level</label>
                <select id="shLevel${S}" data-default="3">
                    <option value="0">Text</option>
                    <option value="1">Line</option>
                    <option value="2">Word</option>
                    <option value="3">Character</option>
                </select>
            </div>
            <div class="ctl">
                <label title="Double-click to reset to default (0.000)">Extend Horizontal <span class="val" id="vShExtendH${S}">0.000</span></label>
                <input id="shExtendH${S}" type="range" min="-0.2" max="1.0" step="0.005" value="0" data-default="0.000">
            </div>
            <div class="ctl">
                <label title="Double-click to reset to default (0.000)">Extend Vertical <span class="val" id="vShExtendV${S}">0.000</span></label>
                <input id="shExtendV${S}" type="range" min="-0.2" max="1.0" step="0.005" value="0" data-default="0.000">
            </div>
            <div class="ctl">
                <label title="Double-click to reset to default (0.000)">Round <span class="val" id="vShRound${S}">0.000</span></label>
                <input id="shRound${S}" type="range" min="0" max="1.0" step="0.005" value="0" data-default="0.000">
            </div>
        </div>
        <div class="row nums sh-soft-row">
            <label title="Double-click to reset to default (0)">Softness <input id="shSoftness${S}" type="number" min="0" max="30" step="0.5" value="0" data-default="0"></label>
            <label title="Double-click to reset to default (0)">Offset X <input id="shOffsetX${S}" type="number" min="-1" max="1" step="0.01" value="0" data-default="0"></label>
            <label title="Double-click to reset to default (0)">Offset Y <input id="shOffsetY${S}" type="number" min="-1" max="1" step="0.01" value="0" data-default="0"></label>
        </div>
    </div>
    </div>
</div>`;

const SAVE_BAR_HTML = (S) => `
<div id="tdSaveBar${S}" class="td-save-bar hidden">
    <div class="row td-save-row-top">
        <button type="button" id="tdUpdateLatest${S}" class="td-btn-upd" title="Update this preset and the latest Text+ subtitle clip on your timeline">Update latest</button>
        ${S === 'C' ? '' : `<button type="button" id="tdRevertOrig${S}" class="ghost sm-btn td-btn-revert" title="Revert this preset to its original .settings, text design, alignment, and sound">↺ Revert to original</button>`}
    </div>
    <div class="td-save-row-bottom">
        <span class="sh-lbl td-ver-lbl">New version</span>
        <div class="row td-ver-input-row">
            <input id="tdVarName${S}" type="text" class="sh-name" placeholder="Name v2">
            <button type="button" id="tdSaveVar${S}" class="td-btn-new" title="Save this alignment, Text+ design, and sound as a new preset in your library">+ Create v2</button>
        </div>
    </div>
</div>`;

const ADJUST_HTML = ALIGN_HTML;

const PREVIEW_HTML = (S) => `
<div id="stageMsg${S}" class="stagemsg"></div>
${S === 'C' ? `<div class="row actions"><button id="prevCapC" class="ghost" title="Takes new preview frames from the Text+ selected on your timeline">Update preview</button></div>` : ''}`;
