// B-roll tab: motion-graphic overlays made with Remotion (src/main/broll.js, broll/ in the code folder).
// Make: pick an effect, set its fields (the preview still redraws as you type, over the playhead frame), render and
// place it over a subtitle or at the playhead. Editing a placed clip loads its values here; "Update clip" re-renders it
// and swaps the media under the clip, so it keeps its place.
// Auto: suggest B-roll from the subtitles (numbers, "comment X", days, typing, quotes, steps), tick, place ticked.
// Placed: the B-roll on this timeline, with Edit / Remove and the id Claude's adjust_broll takes.
// Watch in "Resolve timeline" (default): no preview in the panel. Place puts a half-size draft on the timeline and
// opens it for editing; every settings change re-renders that clip in place (debounced, one render at a time, the
// newest values win), so it is watched in Resolve's viewer. Finalize re-renders it at full size.

const brUI = { effects: [], common: [], sel: null, values: {}, editing: null, frame: null, busy: false, ready: false,
    suggestions: [], placed: [], previewSeq: 0, strip: null, edited: new Set(), viewMode: null };
const BR_TABS = ['make', 'auto', 'placed', 'collage'];
// Colour-box trace (<data>/_app/broll-trace.log): what a click on a B-roll colour box led to, to find picker trouble.
function brTrace(msg) { try { window.sa.brollTrace(msg); } catch (e) { /* ignore */ } }
window.addEventListener('blur', () => { if (state.tab === 'broll') brTrace('window blur (colorPicking=' + !!state.colorPicking + ')'); });
window.addEventListener('focus', () => { if (state.tab === 'broll') brTrace('window focus (colorPicking=' + !!state.colorPicking + ')'); });

// Make / Auto / Placed (bound in initBrollTab with bindTabGroup, js/ui/tabs.js).
function brSubTab(t) {
    if (brUI.tabs) brUI.tabs.show(t);
}

function brBusy(on) {
    brUI.busy = on;
    $('brPlace').disabled = on; $('brPlaceNew').disabled = on; $('brPlaceTicked').disabled = on || !brUI.suggestions.some(s => s.on);
    $('brSuggest').disabled = on; $('brSyncAll').disabled = on; $('brFinalizeAll').disabled = on;
    $('brCancel').classList.toggle('hidden', !on);
    if (!on) $('brBar').style.width = '0';
}
