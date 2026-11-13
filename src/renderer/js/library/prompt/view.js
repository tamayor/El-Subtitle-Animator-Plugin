// Prompt tab: the highlighted text view, Copy, and Builder / Text mode.

// ---------------------------------------------------------------- highlighting
// Keys and headings bold, values coloured, comments dimmed. Line based, so it survives any edit the user makes.
function escPrompt(s) {
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

// Inside a value: "(comment)" and "→ note" parts dimmed, the rest coloured.
function hlPromptValue(v) {
    const e = escPrompt(v);
    return '<span class="pr-val">' + e
        .replace(/\([^()]*\)/g, m => '</span><span class="pr-cm">' + m + '</span><span class="pr-val">')
        .replace(/(→|—)\s[^(]*$/, m => '</span><span class="pr-cm">' + m + '</span><span class="pr-val">') + '</span>';
}

// Inside rule text: SETTINGS names (SIZE_MIN, LINE_SPACING_LONG, DEFAULT ...) stand out.
function hlPromptRefs(t) {
    return escPrompt(t).replace(/\b([A-Z][A-Z0-9_]{2,}(?:–[A-Z][A-Z0-9_]{2,})?)\b/g, '<span class="pr-ref">$1</span>');
}

function hlPromptLine(line) {
    if (!line.trim()) return '';
    let m;
    if (/^\s*#/.test(line)) return '<span class="pr-h">' + escPrompt(line) + '</span>';
    // "  KEY:   value"  (keys are upper-case words / underscores, may end with a parenthesised note)
    if ((m = line.match(/^(\s*)([A-Z][A-Z0-9_]*(?:\s*\([^)]*\))?):(\s*)(.*)$/))) {
        return escPrompt(m[1]) + '<span class="pr-key">' + escPrompt(m[2] + ':') + '</span>' + escPrompt(m[3]) + hlPromptValue(m[4]);
    }
    // "  ORANGE → vibe presets"  and  "  Risk, problem ... → DANGER"
    if ((m = line.match(/^(\s*)(.*?)(\s*→\s*)(.*)$/))) {
        const left = /^[A-Z][A-Z0-9_ ]*$/.test(m[2].trim()) ? '<span class="pr-key">' + escPrompt(m[2]) + '</span>' : hlPromptRefs(m[2]);
        return escPrompt(m[1]) + left + '<span class="pr-cm">' + escPrompt(m[3]) + '</span>' + hlPromptValue(m[4]);
    }
    // Section labels: a line that is only upper-case words (optionally with a parenthesised note)
    if (/^[A-Z][A-Z0-9_ ]*(\s*\([^)]*\))?\s*$/.test(line)) return '<span class="pr-sec">' + escPrompt(line) + '</span>';
    // Rule sub-headings: "Vibe (ORANGE)", "Stacks (VIOLET)", numbered steps
    if (/^[A-Z][a-z].*\([A-Z][A-Z, ]*\)\s*$/.test(line) || /^\d+\.\s/.test(line)) return '<span class="pr-key">' + hlPromptRefs(line) + '</span>';
    return hlPromptRefs(line);
}

function renderPromptHilite() {
    const ta = $('promptText'), pre = $('promptHilite');
    if (!ta || !pre) return;
    // A trailing newline needs a visible last line so the heights match.
    pre.innerHTML = ta.value.split('\n').map(hlPromptLine).join('\n') + (ta.value.endsWith('\n') ? ' ' : '');
    pre.scrollTop = ta.scrollTop; pre.scrollLeft = ta.scrollLeft;
}

async function copyJobPrompt() {
    const text = pb.full;
    let ok = false;
    try { if (navigator.clipboard && navigator.clipboard.writeText) { await navigator.clipboard.writeText(text); ok = true; } } catch (e) { ok = false; }
    if (!ok) {
        // Fallback: put the whole prompt in a hidden text box and use the old copy command.
        try {
            const t = document.createElement('textarea');
            t.value = text; t.style.position = 'fixed'; t.style.opacity = '0';
            document.body.appendChild(t); t.select(); ok = document.execCommand('copy'); t.remove();
        } catch (e) { ok = false; }
    }
    setPromptStatus(ok ? 'Copied. Paste it into Claude.' : 'Could not copy. Switch to Text, select it and press Cmd+C.', ok ? 'ok' : 'bad');
}

// "edited" shows while the text differs from the default Reset would restore; "Restore built-in" only when a user
// default exists.
function refreshPromptFlags() {
    const ed = $('promptEdited'); if (ed) ed.classList.toggle('hidden', pb.full === effectiveJobPromptDefault());
    const bi = $('promptBuiltIn'); if (bi) bi.classList.toggle('hidden', !userJobPromptDefault());
}

// Builder: the SETTINGS block as rows, the text box holds only the rules after it. Text: the whole prompt as text.
function applyPromptMode() {
    const builder = pb.mode === 'builder';
    $('promptModeBuilder').classList.toggle('on', builder);
    $('promptModeText').classList.toggle('on', !builder);
    $('promptBuilderWrap').classList.toggle('hidden', !builder);
    $('tabPrompt').classList.toggle('pr-mode-text', !builder);
    $('promptRulesLabel').classList.toggle('hidden', !builder);
    const ta = $('promptText');
    pb.doc = null;
    if (builder) {
        renderPromptBuilder(false);
        ta.value = pb.doc ? pb.doc.post : '';
        ta.disabled = !pb.doc;
    } else {
        ta.disabled = false;
        ta.value = pb.full;
    }
    renderPromptHilite();
    refreshPromptFlags();
}

function setJobPromptText(text) {
    pb.full = text;
    saveJobPrompt(text);
    applyPromptMode();
}
