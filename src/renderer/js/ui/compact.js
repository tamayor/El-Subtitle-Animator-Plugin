// Compact mode: a denser panel for small windows (css/compact.css does the styling).
// It switches on by itself when the window is narrower than COMPACT_W or shorter than COMPACT_H.
// localStorage 'sa.compact' = 'on' | 'off' forces it either way ('auto' or unset = by window size).
// In compact mode the tabs move into the header row, so header + tabs take one line instead of three.

const COMPACT_W = 520, COMPACT_H = 700;
let expandTarget = null;   // while the window animates open: its final content size

function compactPref() {
    try { return localStorage.getItem('sa.compact') || 'auto'; } catch (e) { return 'auto'; }
}

function isCompact() { return document.body.classList.contains('compact'); }

function applyCompact() {
    const pref = compactPref();
    const collapsed = document.body.classList.contains('win-collapsed');   // collapsed bar = the compact one-row header
    const vw = expandTarget ? expandTarget.width : window.innerWidth, vh = expandTarget ? expandTarget.height : window.innerHeight;
    const on = collapsed || pref === 'on' || (pref !== 'off' && (vw < COMPACT_W || vh < COMPACT_H));
    const was = isCompact();
    document.body.classList.toggle('compact', on);
    // tabs: inside the header row when compact, under the header otherwise
    const header = document.querySelector('header'), nav = document.querySelector('nav.tabs');
    if (header && nav) {
        if (on && nav.parentNode !== header) header.insertBefore(nav, header.querySelector('.header-bar'));
        else if (!on && nav.parentNode === header) header.after(nav);
    }
    if (was !== on) {
        if (typeof dockRefresh === 'function') dockRefresh();
        if (typeof setDockHeight === 'function' && typeof dockStoredHeight === 'function') setDockHeight(dockStoredHeight(), false);
    }
}

function setCompactPref(v) {
    try { localStorage.setItem('sa.compact', v); } catch (e) { /* ignore */ }
    applyCompact();
}

// Auto-collapse (src/main/window.js does the window side): out of focus, the window shrinks to the header bar; hovering
// it opens it again. The header button switches it on/off (saved as sa.autoCollapse, on by default).
function autoCollapseOn() {
    try { return localStorage.getItem('sa.autoCollapse') !== '0'; } catch (e) { return true; }
}
function syncAutoCollapse(on) {
    const btn = $('autoCollapse');
    if (btn) {
        btn.classList.toggle('on', on);
        btn.setAttribute('aria-pressed', on ? 'true' : 'false');
        btn.title = on
            ? 'Auto-collapse is on: when you click away from the panel it shrinks to this bar; hover it to open it again (click to turn off)'
            : 'Auto-collapse is off: click so the panel shrinks to this bar when you click away from it';
    }
    if (window.sa && window.sa.setAutoCollapse) window.sa.setAutoCollapse(on);
}
// The collapsed bar: a Claude-style status line - a turning glyph and editing words that change every few seconds,
// each letter bouncing in, a shimmer running through them. Runs only while collapsed.
const TICKER_WORDS = ['Animating', 'Keyframing', 'Editing', 'Keying', 'Manipulating', 'Compositing', 'Rendering',
    'Kerning', 'Tracking', 'Captioning', 'Subtitling', 'Easing', 'Bouncing', 'Popping', 'Wiggling', 'Glitching',
    'Trimming', 'Scrubbing', 'Syncing', 'Retiming', 'Grading', 'Masking', 'Fusing', 'Highlighting', 'Typesetting'];
const TICKER_GLYPHS = ['·', '✢', '✳', '✶', '✻', '✽', '✻', '✶', '✳', '✢'];
const ticker = { spin: null, word: null, n: 0, g: 0, last: '' };
function tickerWord(text) {
    const el = document.querySelector('#collapsedTicker .ct-word');
    if (!el) return;
    el.textContent = '';
    [...(text + '…')].forEach((ch, i) => {
        const s = document.createElement('span');
        s.textContent = ch;
        s.style.setProperty('--i', i);
        el.appendChild(s);
    });
}
function tickerNext() {
    let w;
    if (ticker.n++ === 0) w = 'El Subtitle Animator';
    else do { w = TICKER_WORDS[Math.floor(Math.random() * TICKER_WORDS.length)]; } while (w === ticker.last);
    ticker.last = w;
    tickerWord(w);
}
function tickerStart() {
    if (ticker.word) return;
    const spin = document.querySelector('#collapsedTicker .ct-spin');
    ticker.n = 0;
    tickerNext();
    ticker.word = setInterval(tickerNext, 2600);
    ticker.spin = setInterval(() => { if (spin) spin.textContent = TICKER_GLYPHS[ticker.g++ % TICKER_GLYPHS.length]; }, 110);
}
function tickerStop() {
    clearInterval(ticker.word); clearInterval(ticker.spin);
    ticker.word = ticker.spin = null;
}

function initAutoCollapse() {
    if (window.sa && window.sa.onCollapsed) {
        // phases from src/main/window.js: collapsing -> collapsed (bar lands), expanding -> expanded
        window.sa.onCollapsed((phase, size) => {
            const b = document.body;
            clearTimeout(initAutoCollapse.landTimer);
            if (phase === 'collapsing' || phase === true) {
                b.classList.remove('win-expanding', 'win-landed');
                b.classList.add('win-collapsed');
                tickerStart();
            } else if (phase === 'collapsed') {
                b.classList.add('win-landed');
                initAutoCollapse.landTimer = setTimeout(() => b.classList.remove('win-landed'), 500);
            } else if (phase === 'expanding') {
                // the layout is picked for the size the window is heading to, so it doesn't flip mid-animation
                expandTarget = size && size.width && size.height ? size : null;
                tickerStop();
                b.classList.remove('win-collapsed', 'win-landed');
                b.classList.add('win-expanding');
            } else {
                expandTarget = null;
                tickerStop();
                b.classList.remove('win-collapsed', 'win-landed');
                // let the content's spring (0.48 s + footer delay) finish before the animation class goes
                initAutoCollapse.landTimer = setTimeout(() => b.classList.remove('win-expanding'), 200);
            }
            applyCompact();
        });
    }
    const btn = $('autoCollapse');
    if (btn) {
        btn.addEventListener('click', () => {
            const on = !autoCollapseOn();
            try { localStorage.setItem('sa.autoCollapse', on ? '1' : '0'); } catch (e) { /* ignore */ }
            syncAutoCollapse(on);
        });
    }
    syncAutoCollapse(autoCollapseOn());
}

let compactRaf = 0;
window.addEventListener('resize', () => {
    cancelAnimationFrame(compactRaf);
    compactRaf = requestAnimationFrame(applyCompact);
});
function initCompact() { applyCompact(); initAutoCollapse(); }
if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', initCompact);
else initCompact();
