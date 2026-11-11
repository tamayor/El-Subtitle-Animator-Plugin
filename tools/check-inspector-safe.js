// Guards against the "empty Inspector" bug coming back.
//
// Resolve's Edit-page Inspector only shows a Fusion title's controls when Resolve built the title itself. Replacing the
// comp of a clip the user keeps (ImportFusionComp, LoadFusionCompByName, AddFusionComp, comp:Paste, tool:LoadSettings)
// leaves only a folded "Text+" header, even when the imported comp is the clip's own. So presets are placed as title
// templates (presetTitleFor in src/main/title-templates.js) and inserted with InsertFusionTitleIntoTimeline.
//
// This check fails when:
//   1. one of those calls appears without an "inspector-ok: <reason>" comment on the same line or the line above
//      (allowed only for clips the user never inspects, e.g. temporary preview-render clips, or a logged fallback);
//   2. apply.js no longer places presets through presetTitleFor, or no longer reconnects the output afterwards
//      (Resolve wires an inserted title's MediaOut to "Template", which skips any effects after the text).

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const SRC = path.join(ROOT, 'src');
const RISKY = /\b(ImportFusionComp|LoadFusionCompByName|AddFusionComp|LoadSettings)\s*\(|[.:]Paste\s*\(/;
const MARK = /inspector-ok:\s*\S/;

function files(dir) {
    const out = [];
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
        const p = path.join(dir, e.name);
        if (e.isDirectory()) out.push(...files(p));
        else if (/\.(js|py|lua)$/.test(e.name)) out.push(p);
    }
    return out;
}

const problems = [];
for (const f of files(SRC)) {
    const lines = fs.readFileSync(f, 'utf8').split('\n');
    lines.forEach((line, i) => {
        const code = line.replace(/\/\/.*$|#.*$/, '');      // a mention in a comment is fine
        if (!RISKY.test(code)) return;
        if (MARK.test(line) || (i > 0 && MARK.test(lines[i - 1]))) return;
        problems.push(path.relative(ROOT, f) + ':' + (i + 1) + '  ' + line.trim());
    });
}

const apply = fs.readFileSync(path.join(SRC, 'main', 'apply.js'), 'utf8');
if (!/presetTitleFor\s*\(/.test(apply)) problems.push('src/main/apply.js  no longer calls presetTitleFor(): presets must be inserted as title templates');
if (!/bridgeCall\(\s*'set_output'/.test(apply)) problems.push('src/main/apply.js  no longer reconnects the output (set_output): Resolve wires an inserted title to "Template", which drops wiggle / glitch / stop-motion effects');

if (problems.length) {
    console.error('Inspector check failed. These replace a clip\'s Fusion comp, which empties Resolve\'s Inspector for that clip:\n');
    for (const p of problems) console.error('  ' + p);
    console.error('\nInsert the preset as a title template instead (presetTitleFor in src/main/title-templates.js). If the clip is never');
    console.error('shown to the user, add a comment "// inspector-ok: <why>" on the line or the line above.');
    process.exit(1);
}
console.log('Inspector check OK.');
