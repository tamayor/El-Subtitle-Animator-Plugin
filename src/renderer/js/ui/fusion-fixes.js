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
        { key: 'clipSliderMax', label: 'Sliders run to clip length', type: 'bool' },
        { sep: true },
        { title: 'Lighter variants (measure first)' },
        { key: 'refreshIfRecentWake', label: 'Skip refresh right after the insert wake', type: 'bool', hint: 'No second wake when the first ran under 200 ms before. Check with verify_placed that titles still render.' },
        { key: 'wakeLock', label: 'Wake inside a comp lock', type: 'bool', hint: 'One re-render per wake instead of one per toggled tool.' },
        { key: 'highlightProbeFrames', label: 'Highlight probe frames', type: 'num', min: 3, max: 9, step: 1, hint: '9 = every frame of the sweep (as before); 5 = coarse-to-fine, about half the renders.' }
    ];
    // Performance measuring (src/main/perf.js): a switch, the live summary and the sub-settings.
    const PERF_ROWS = [
        { key: 'enabled', label: 'Measure performance', type: 'bool', hint: 'Times every stage, Resolve call and Fusion helper request; log in _debug/perf-log.jsonl.' },
        { key: 'sampleRenderer', label: 'Panel self-timing', type: 'bool', hint: 'The panel reports its poll round trips and long tasks once a minute.' },
        { key: 'promiseApi', label: 'Resolve promise API', type: 'select', options: [['off', 'Off (blocking API)'], ['probe', 'Probe once, log'], ['on', 'On']], hint: 'Blackmagic’s non-blocking API. Probe first; "On" takes effect at the next connection.' },
        { key: 'renderProcess', label: 'Separate render helper', type: 'bool', hint: 'Preview renders and live frames go to a second Fusion helper, so they never hold up placements.' }
    ];

    let fixes = null, defaults = null, perf = null, perfDefaults = null;

    async function savePerf(patch, el) {
        try {
            const r = await window.sa.setPerf(patch);
            if (r && !r.error) perf = r;
            if (el) build(el);
            setStatus('Performance settings saved.', 'ok');
        } catch (e) { setStatus('Could not save the performance settings: ' + String(e && e.message || e), 'bad'); }
    }
    function perfLine(s) {
        const e = s.entries || [];
        const pick = (n) => e.find(x => x.name === n);
        const ap = pick('apply'), po = pick('poll');
        const parts = [s.resolveCallsPerSec + ' Resolve calls/s'];
        if (po) parts.push('poll ' + po.avgMs + ' ms');
        if (ap) parts.push('apply ' + ap.avgMs + ' ms × ' + ap.n);
        return parts.join(' · ') + (s.uptimeS ? ' · ' + Math.round(s.uptimeS / 60) + ' min' : '');
    }
    function perfText(s) {
        const lines = ['El Subtitle Animator perf summary ' + new Date().toISOString(), 'since ' + s.since + ' (' + s.uptimeS + ' s), Resolve calls/s ' + s.resolveCallsPerSec + ' (' + s.resolveCallsLastMinute + ' in the last minute)', 'log: ' + s.log, ''];
        lines.push(['name', 'n', 'total ms', 'avg ms', 'max ms', 'last ms'].join('\t'));
        for (const x of s.entries || []) lines.push([x.name, x.n, x.totalMs, x.avgMs, x.maxMs, x.lastMs].join('\t'));
        return lines.join('\n');
    }

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

        // ---- Performance
        if (perf) {
            const sep = document.createElement('div'); sep.className = 'fx-sep'; el.appendChild(sep);
            const t = document.createElement('div'); t.className = 'pop-title'; t.textContent = 'Performance'; el.appendChild(t);
            for (const r of PERF_ROWS) {
                const row = document.createElement('div');
                row.className = 'fx-row' + (r.key !== 'enabled' && !perf.enabled ? ' off' : '');
                const id = 'perf_' + r.key;
                const lab = document.createElement('label');
                lab.htmlFor = id;
                lab.textContent = r.label + (perf[r.key] !== perfDefaults[r.key] ? ' •' : '');
                if (r.hint) { const h = document.createElement('span'); h.className = 'fx-hint'; h.textContent = r.hint; lab.appendChild(h); }
                let inp;
                if (r.type === 'bool') {
                    inp = document.createElement('input'); inp.type = 'checkbox'; inp.checked = !!perf[r.key];
                    inp.addEventListener('change', () => savePerf({ [r.key]: inp.checked }, el));
                } else {
                    inp = document.createElement('select');
                    for (const [v, txt] of r.options) { const o = document.createElement('option'); o.value = v; o.textContent = txt; inp.appendChild(o); }
                    inp.value = perf[r.key];
                    inp.addEventListener('change', () => savePerf({ [r.key]: inp.value }, el));
                }
                inp.id = id;
                row.appendChild(lab); row.appendChild(inp);
                el.appendChild(row);
            }
            const pact = document.createElement('div');
            pact.className = 'fx-actions';
            const line = document.createElement('span');
            line.className = 'fx-hint';
            line.textContent = perf.enabled ? 'Reading…' : 'Off. Switch it on, work for a while, then copy the summary.';
            const copy = document.createElement('button');
            copy.type = 'button'; copy.className = 'ghost'; copy.textContent = 'Copy summary';
            copy.disabled = !perf.enabled;
            copy.addEventListener('click', async () => {
                try {
                    const s = await window.sa.perfSummary(0);
                    await navigator.clipboard.writeText(perfText(s));
                    setStatus('Performance summary copied (' + (s.entries || []).length + ' entries).', 'ok');
                } catch (e) { setStatus('Could not copy the summary: ' + String(e && e.message || e), 'bad'); }
            });
            const reset2 = document.createElement('button');
            reset2.type = 'button'; reset2.className = 'ghost'; reset2.textContent = 'Reset counters';
            reset2.disabled = !perf.enabled;
            reset2.addEventListener('click', async () => { try { await window.sa.perfReset(); build(el); } catch (e) { /* ignore */ } });
            pact.appendChild(line); pact.appendChild(copy); pact.appendChild(reset2);
            el.appendChild(pact);
            if (perf.enabled) window.sa.perfSummary(10).then(s => { if (line.isConnected) line.textContent = perfLine(s); }).catch(() => { /* ignore */ });
        }
    }

    const btn = document.getElementById('fusionFixesBtn');
    if (!btn || !window.sa || !window.sa.getFusionFixes) return;
    btn.addEventListener('click', async () => {
        try {
            const r = await window.sa.getFusionFixes();
            fixes = r.fixes; defaults = r.defaults;
        } catch (e) { setStatus('Could not read the Fusion fixes.', 'bad'); return; }
        try {
            if (window.sa.getPerf) { const p = await window.sa.getPerf(); perf = p && p.perf; perfDefaults = (p && p.defaults) || {}; }
        } catch (e) { perf = null; }
        openPop(btn, 'pop-fixes', build);
    });
})();
