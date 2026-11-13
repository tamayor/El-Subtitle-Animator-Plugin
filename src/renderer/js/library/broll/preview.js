// B-roll tab: the preview (still / strip) and its background.

// ------------------------------------------------------------------ preview

function brFieldEdited(now) {
    if (brView() === 'timeline' && brUI.editing) brLiveSoon(now);
    else brPreviewSoon(now);
}

// The preview: a still at the Moment (drawn small, at the panel's size), then a strip of ~24 frames over the whole
// clip in one pass. Once the strip is in, the Moment slider only swaps pictures (no render); any settings change starts
// a new still + strip.
let brPreviewTimer = null;
// Seconds only counts where it is shown: "At the playhead", or while editing a placed clip (its length).
function brSecVal() { return $('brSecWrap').classList.contains('hidden') ? 0 : (Number($('brSec').value) || 0); }
function brKey() { return JSON.stringify([brUI.sel, brUI.values, brSecVal()]); }

function brPreviewSoon(now) {
    if (brView() === 'timeline') { brLiveSoon(); return; }
    clearTimeout(brPreviewTimer);
    brPreviewTimer = setTimeout(brPreview, now ? 0 : 300);
}

function brShow(url, w, h) {
    const box = $('brPreview');
    if (w && h) box.style.aspectRatio = w + ' / ' + h;
    $('brPreviewImg').src = url;
    $('brPreviewMsg').classList.add('hidden');
}

// Moment slider: the nearest strip frame when the strip matches the settings, else a quick still.
function brMoment() {
    const st = brUI.strip;
    if (st && st.key === brKey() && st.frames.length) {
        const at = Number($('brAt').value);
        let best = st.frames[0];
        for (const f of st.frames) if (Math.abs(f.at - at) < Math.abs(best.at - at)) best = f;
        brShow(best.url, st.width, st.height);
        return;
    }
    clearTimeout(brPreviewTimer);
    brPreviewTimer = setTimeout(() => brPreview(true), 120);
}

async function brPreview(stillOnly) {
    if (!brUI.sel) return;
    const seq = ++brUI.previewSeq;
    const key = brKey();
    const msg = $('brPreviewMsg');
    msg.textContent = 'Drawing…'; msg.classList.remove('hidden');
    const sec = brSecVal() || undefined;
    const r = await window.sa.brollPreview({ effect: brUI.sel, props: brUI.values, at: Number($('brAt').value), seconds: sec, maxDim: 720 });
    if (seq !== brUI.previewSeq) return;     // a newer change is already drawing
    if (!r || r.error) { msg.textContent = (r && r.error) || 'No preview'; return; }
    brShow(r.dataUrl, r.width, r.height);
    if (stillOnly || (brUI.strip && brUI.strip.key === key)) return;
    // the scrub strip for these settings, in the background
    const st = await window.sa.brollStrip({ effect: brUI.sel, props: brUI.values, seconds: sec, count: 24, maxDim: 560 });
    if (!st || st.error || key !== brKey()) return;
    brUI.strip = { key, width: st.width, height: st.height, frames: st.frames };
}

async function brLoadFrame() {
    const r = await window.sa.brollFrame();
    if (!r || r.error) return;
    brUI.frame = r;
    if (r.subtitle && !$('brSub').value) $('brSub').placeholder = '#' + r.subtitle.index;
    brApplyBg();
}

function brApplyBg() {
    const box = $('brPreview'), bg = $('brBg').value;
    box.dataset.bg = bg;
    box.style.backgroundImage = bg === 'frame' && brUI.frame && brUI.frame.img ? 'url("' + brUI.frame.img + '")' : '';
    if (brUI.frame) box.style.aspectRatio = brUI.frame.width + ' / ' + brUI.frame.height;
}
