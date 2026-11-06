// Editor helpers: track selects, version names, finishing a save, variant buttons.

function fillTrackSelect(sel, prefix, value) {
    sel.textContent = '';
    const opts = [[0, prefix === 'A' ? 'Auto (free track)' : 'Auto (top layer)']];
    for (let i = 1; i <= 12; i++) opts.push([i, prefix + i]);
    for (const [v, t] of opts) {
        const o = document.createElement('option');
        o.value = v; o.textContent = t;
        if (Number(v) === Number(value)) o.selected = true;
        sel.appendChild(o);
    }
}

function nextVersionNameUI(baseName) {
    const stem = String(baseName || 'Animation').trim().replace(/\s+v\d+$/i, '');
    const taken = new Set((state.lib.animations || []).map(a => String(a.name || '').trim().toLowerCase()));
    let v = 2;
    while (taken.has((stem + ' v' + v).toLowerCase())) v++;
    return stem + ' v' + v;
}

// After Update / Create / Revert has saved, the editor closes: the Create tab's editor, or the Use tab's alignment panel.
function closeEditorAfterSave(S) {
    if (S === 'C') {
        state.createId = null;
        if ($('editor')) $('editor').classList.add('hidden');
        if ($('editorPark') && $('editor')) $('editorPark').appendChild($('editor'));
    } else if (typeof setAdjustOpen === 'function') {
        setAdjustOpen(false);
    }
}

// Closes the Update / Create bar for good and shows "<preset name> · Saved" for 3 seconds.
function finishSave(S, name, what) {
    state.createAdjusted = false;
    const bar = $('tdSaveBar' + S);
    if (bar) { bar.classList.add('hidden'); bar.classList.remove('dirty'); }
    document.querySelectorAll('.saved-toast').forEach(x => x.remove());
    const t = document.createElement('div');
    t.className = 'saved-toast';
    const n = document.createElement('b'); n.textContent = name || 'Preset';
    t.append(n, document.createTextNode(' · ' + (what || 'Saved')));
    document.body.appendChild(t);
    setTimeout(() => { t.classList.add('out'); setTimeout(() => t.remove(), 400); }, 3000);
}

function syncVarButtons(S, m) {
    const varIn = $('tdVarName' + S);
    const btnNew = $('tdSaveVar' + S);
    const btnUpd = $('tdUpdateLatest' + S);
    const bar = $('tdSaveBar' + S);
    if (!m) {
        if (bar) {
            bar.classList.add('hidden');
            bar.classList.remove('dirty');
        }
        return;
    }
    const autoName = nextVersionNameUI(m.name);
    if (varIn && document.activeElement !== varIn && varIn.dataset.forId !== m.id + ':' + m.name) {
        varIn.value = autoName;
        varIn.dataset.forId = m.id + ':' + m.name;
    }
    const chosen = (varIn && varIn.value.trim()) || autoName;
    if (btnNew) btnNew.textContent = '+ Create "' + chosen + '"';
    if (btnUpd) btnUpd.textContent = 'Update "' + (m.name || 'latest') + '"';
    const isAdjusted = !!(m.adjusted || m.dirty || m.designDirty || (S === 'C' && state.createAdjusted));
    if (bar) {
        bar.classList.toggle('hidden', !isAdjusted);
        bar.classList.toggle('dirty', isAdjusted);
    }
}
