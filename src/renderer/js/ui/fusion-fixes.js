// Header "Fusion" button: the Fusion fixes applied to placed titles (src/main/fusion-fixes.js). Every change is saved
// right away and sent to the Fusion helper.

(function () {
    const ROWS = [
        { title: 'Wake effects' },
        { key: 'wakeMode', label: 'Wake', type: 'select', options: [['all', 'All effects'], ['followers', 'Followers only'], ['off', 'Off']],
            hint: 'Toggles tools so Resolve renders fresh titles. "Followers only" is much lighter; "Off" skips every wake.' },
        { key: 'wakeOnInsert', label: 'Wake when text is set', type: 'bool', needsWake: true },
        { key: 'refreshAfterPlace', label: 'Refresh after placing', type: 'bool', hint: 'One more wake once the clip and its sounds are in.' },
        { key: 'retouchText', label: 'Re-write text on refresh', type: 'bool', hint: 'Fixes Follower text that renders blank.' },
        { sep: true },
        { title: 'Extra wakes when idle' },
        { key: 'settlePasses', label: 'Passes', type: 'num', min: 0, max: 6, step: 1, needsWake: true, hint: '0 = none. Fewer passes = less lag after placing many clips.' },
        { key: 'settleDelayMs', label: 'First after (ms)', type: 'num', min: 200, max: 20000, step: 100, needsWake: true },
        { key: 'settleGapMs', label: 'Between passes (ms)', type: 'num', min: 200, max: 20000, step: 100, needsWake: true },
        { key: 'settleBatch', label: 'Clips per step', type: 'num', min: 1, max: 50, step: 1, needsWake: true, hint: 'Smaller keeps the live preview responsive.' },
        { sep: true },
        { title: 'Timing fixes' },
        { key: 'fitFollowerDelay', label: 'Fit letter delay to short clips', type: 'bool', hint: 'Last word lands on the clip’s last frame instead of freezing.' },
        { key: 'fitSegments', label: 'Fit segments to short clips', type: 'bool' },
        { key: 'clipSliderMax', label: 'Sliders run to clip length', type: 'bool' }
    ];

    let fixes = null, defaults = null;

    async function save(patch, el) {
        try {
            const r = await window.sa.setFusionFixes(patch);
            if (r && !r.error) fixes = r;
            if (el) build(el);
            setStatus('Fusion fixes saved.', 'ok');
        } catch (e) { setStatus('Could not save the Fusion fixes: ' + String(e && e.message || e), 'bad'); }
    }

    function build(el) {
        el.innerHTML = '';
        const wakeOff = fixes.wakeMode === 'off';
        for (const r of ROWS) {
            if (r.sep) { const d = document.createElement('div'); d.className = 'fx-sep'; el.appendChild(d); continue; }
            if (r.title) { const t = document.createElement('div'); t.className = 'pop-title'; t.textContent = r.title; el.appendChild(t); continue; }
            const row = document.createElement('div');
            row.className = 'fx-row' + (r.needsWake && wakeOff ? ' off' : '');
            const id = 'fx_' + r.key;
            const lab = document.createElement('label');
            lab.htmlFor = id;
            lab.textContent = r.label + (fixes[r.key] !== defaults[r.key] ? ' •' : '');
            lab.title = 'Default: ' + (r.type === 'bool' ? (defaults[r.key] ? 'on' : 'off') : defaults[r.key]);
            if (r.hint) { const h = document.createElement('span'); h.className = 'fx-hint'; h.textContent = r.hint; lab.appendChild(h); }
            let inp;
            if (r.type === 'bool') {
                inp = document.createElement('input'); inp.type = 'checkbox'; inp.checked = !!fixes[r.key];
                inp.addEventListener('change', () => save({ [r.key]: inp.checked }, el));
            } else if (r.type === 'select') {
                inp = document.createElement('select');
                for (const [v, t] of r.options) { const o = document.createElement('option'); o.value = v; o.textContent = t; inp.appendChild(o); }
                inp.value = fixes[r.key];
                inp.addEventListener('change', () => save({ [r.key]: inp.value }, el));
            } else {
                inp = document.createElement('input'); inp.type = 'number';
                inp.min = r.min; inp.max = r.max; inp.step = r.step; inp.value = fixes[r.key];
                inp.addEventListener('change', () => save({ [r.key]: Number(inp.value) }, el));
            }
            inp.id = id;
            row.appendChild(lab); row.appendChild(inp);
            el.appendChild(row);
        }
        const act = document.createElement('div');
        act.className = 'fx-actions';
        const note = document.createElement('span');
        note.textContent = '• = changed. Applies to clips placed from now on.';
        const reset = document.createElement('button');
        reset.type = 'button'; reset.className = 'ghost'; reset.textContent = 'Defaults';
        reset.addEventListener('click', () => save({ reset: true }, el));
        act.appendChild(note); act.appendChild(reset);
        el.appendChild(act);
    }

    const btn = document.getElementById('fusionFixesBtn');
    if (!btn || !window.sa || !window.sa.getFusionFixes) return;
    btn.addEventListener('click', async () => {
        try {
            const r = await window.sa.getFusionFixes();
            fixes = r.fixes; defaults = r.defaults;
        } catch (e) { setStatus('Could not read the Fusion fixes.', 'bad'); return; }
        openPop(btn, 'pop-fixes', build);
    });
})();
