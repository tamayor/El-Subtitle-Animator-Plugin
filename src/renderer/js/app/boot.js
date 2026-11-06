// Start-up. Loaded last, so every panel script and component (window.SABoxes / SAThumbs / SAPreview / SASounds) is
// defined; deferred scripts run before DOMContentLoaded, which is when the panel starts.
if (document.readyState === 'loading' || document.readyState === 'interactive') {
    window.addEventListener('DOMContentLoaded', initApp);
} else {
    initApp();
}

window.addEventListener('beforeunload', () => { window.sa.cleanup(); });
