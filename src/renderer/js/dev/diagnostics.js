// Diagnostics: what the viewer is showing, logged every 2 s.

// ---------------------------------------------------------------- diagnostics: what the viewer is showing, every 2 s
(function () {
    let paintInfo = null;
    const hook = setInterval(() => {
        if (!window.SABoxes || SABoxes._dbgHooked) return;
        const p = SABoxes.paint;
        SABoxes.paint = function (g, a, m, vp, gx, frameIdx) {
            const r = p.apply(this, arguments);
            paintInfo = { r, frameIdx, files: (a && a.previewFiles && a.previewFiles.length) || 0, f0: a && a.previewFiles && a.previewFiles[0] && a.previewFiles[0].split('/').slice(-2).join('/'), stamp: a && a.preview && a.preview.stamp };
            return r;
        };
        SABoxes._dbgHooked = true;
        clearInterval(hook);
    }, 200);
    setInterval(() => {
        try {
            if (!window.SA_DEBUG || !window.sa || !window.sa.dlog || state.tab !== 'apply') return;
            const a = selected(); const u = state.use;
            const v = (typeof useView === 'function' && a) ? useView(a) : a;
            let real = null, blank = null;
            try { real = SAThumbs.hasRealFrames(v); blank = SAThumbs.isBlank(v); } catch (e) { /* ignore */ }
            window.sa.dlog({
                tab: state.tab, id: a && a.id, sub: normSub(currentSubText()).slice(0, 30), rev: u && u.designRev, rendering: u && u.rendering,
                temp: !!(u && u.tempPreview), tempCount: u && u.tempPreview && u.tempPreview.preview && u.tempPreview.preview.count,
                usingTemp: !!(v && a && v !== a), real, blank, paint: paintInfo, previewLoop: !!state.preview, drag: !!state.drag, stageDrag: !!state.stageDrag
            });
            paintInfo = null;
        } catch (e) { try { window.sa.dlog('diag error', String(e && e.message || e)); } catch (e2) { /* ignore */ } }
    }, 2000);
})();
