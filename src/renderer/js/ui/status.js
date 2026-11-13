// Status lines and toasts for every tab, in one place.
//
//   showStatus(msg, kind, { target, clearAfter, fadeInCompact })
//       target       element id or element of a `.status` line (default 'status', the panel's main line)
//       kind         '' | 'ok' | 'bad' | 'busy'... (a class added next to `status`)
//       clearAfter   ms: clear the message after this long, if it is still the one shown
//       fadeInCompact  compact mode: fade the line after a few seconds (errors stay longer); full text in its tooltip
//   showToast(name, what)   the "<name> · <what>" snack bar at the bottom of the panel (3 s)
//
// The tab helpers below are what the features call: setStatus (main line), setCreateStatus (Create tab),
// setPromptStatus (Prompt tab, clears itself), brStatus (B-roll tab, any of its status lines).

function showStatus(msg, kind, opts) {
    const o = opts || {};
    const el = typeof o.target === 'object' && o.target ? o.target : $(o.target || 'status');
    if (!el) return;
    el.textContent = msg || '';
    el.className = 'status' + (kind ? ' ' + kind : '');
    if (o.fadeInCompact) {
        el.title = msg || '';
        clearTimeout(el._saFade);
        if (msg && document.body.classList.contains('compact')) {
            el._saFade = setTimeout(() => el.classList.add('faded'), kind === 'bad' ? 10000 : 4000);
        }
    }
    clearTimeout(el._saClear);
    if (msg && o.clearAfter > 0) {
        el._saClear = setTimeout(() => { if (el.textContent === msg) { el.textContent = ''; el.className = 'status'; } }, o.clearAfter);
    }
}

function showToast(name, what) {
    document.querySelectorAll('.saved-toast').forEach(x => x.remove());
    const t = createEl('div', 'saved-toast', [createEl('b', '', name || ''), ' · ' + (what || '')]);
    document.body.appendChild(t);
    setTimeout(() => { t.classList.add('out'); setTimeout(() => t.remove(), 400); }, 3000);
}

function setStatus(msg, kind) { showStatus(msg, kind, { fadeInCompact: true }); }
function setCreateStatus(msg, kind) { showStatus(msg, kind, { target: 'createStatus' }); }
function setPromptStatus(msg, kind) { showStatus(msg, kind, { target: 'promptStatus', clearAfter: 2500 }); }
function brStatus(text, kind, id) { showStatus(text, kind, { target: id || 'brStatus' }); }
