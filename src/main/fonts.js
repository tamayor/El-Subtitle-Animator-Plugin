// System font discovery and copying the fonts a preset uses into the library.

module.exports = {
    copyFontsForSetting, listSystemFonts, syncAllPresetFonts, validFontStyle
};

const path = require('path');
const fs = require('fs');
const os = require('os');
const { execFile } = require('child_process');

const { ANIM_DIR, FONTS_DIR, OSASCRIPT, ensureDirs } = require('./config');
const { loadLib } = require('./library');
const { dlog } = require('./log');
const { bridgeCall } = require('./fusion-bridge');

// Every font family with the styles each one really has, as Text+ offers them in its Font and Style boxes. The list
// comes from Resolve's own font manager (exactly what Text+ shows, e.g. every named instance of a variable font);
// when Resolve cannot be reached, macOS's font manager stands in until Resolve answers. A Text+ shows
// "Font Not Found" when the style is not one of these.
let fontCache = null, fontStyleMap = {}, fontsFromResolve = false, fontsPending = null;
function listSystemFonts() {
    if (fontCache && fontsFromResolve) return Promise.resolve({ fonts: fontCache, styles: fontStyleMap, fromResolve: true });
    if (fontsPending) return fontsPending;
    fontsPending = (async () => {
        const mac = await listMacFonts();
        let res = null;
        try { res = await bridgeCall('fonts', {}, 15000); } catch (e) { dlog('fonts: Resolve list unavailable: ' + (e && e.message)); }
        if (res && typeof res === 'object' && Object.keys(res).length) {
            // Resolve's set of styles, in macOS's weight order where macOS knows the family (Resolve lists them A-Z).
            const styles = {};
            for (const fam of Object.keys(res)) {
                const rs = Array.from(new Set((res[fam] || []).filter(Boolean)));
                const macKey = Object.keys(mac.styles).find(k => k.toLowerCase() === fam.toLowerCase());
                const ordered = macKey ? mac.styles[macKey].filter(x => rs.some(r => r.toLowerCase() === x.toLowerCase())).map(x => rs.find(r => r.toLowerCase() === x.toLowerCase())) : [];
                styles[fam] = ordered.concat(rs.filter(r => !ordered.includes(r)));
            }
            fontStyleMap = styles;
            fontCache = Object.keys(styles).sort((a, b) => a.localeCompare(b));
            fontsFromResolve = true;
        } else if (!fontCache) {
            fontStyleMap = mac.styles;
            fontCache = mac.fonts;
        }
        fontsPending = null;
        return { fonts: fontCache || [], styles: fontStyleMap, fromResolve: fontsFromResolve };
    })();
    return fontsPending;
}
let macFontsCache = null;
function listMacFonts() {
    return new Promise((resolve) => {
        if (macFontsCache) return resolve(macFontsCache);
        if (process.platform !== 'darwin') return resolve({ fonts: [], styles: {} });
        const js = 'ObjC.import("AppKit"); const fm = $.NSFontManager.sharedFontManager; const out = {};' +
            'for (const f of ObjC.deepUnwrap(fm.availableFontFamilies)) { let st = []; try { st = (ObjC.deepUnwrap(fm.availableMembersOfFontFamily(f)) || []).map(m => String(m[1])); } catch (e) {} out[f] = st; }' +
            'JSON.stringify(out)';
        execFile(OSASCRIPT, ['-l', 'JavaScript', '-e', js], { timeout: 60000, maxBuffer: 32 * 1024 * 1024 }, (err, out) => {
            try {
                const map = JSON.parse(String(out || '').trim());
                const names = Object.keys(map).filter(x => x && !x.startsWith('.')).sort((a, b) => a.localeCompare(b));
                const styles = {};
                for (const n of names) styles[n] = Array.from(new Set((map[n] || []).filter(Boolean)));
                macFontsCache = { fonts: names, styles };
            } catch (e) { /* no macOS list this time */ }
            resolve(macFontsCache || { fonts: [], styles: {} });
        });
    });
}
const FONT_WEIGHT_NAME = /[-\s](thin|hairline|extra\s?light|ultra\s?light|light|regular|book|medium|semi\s?bold|demi\s?bold|bold|extra\s?bold|ultra\s?bold|heavy|black|italic|oblique)$/i;
// A style that exists for this font: the wanted one when it does, else Regular (or the first the font has).
function validFontStyle(font, wanted) {
    const key = Object.keys(fontStyleMap).find(k => k.toLowerCase() === String(font || '').toLowerCase());
    const list = key ? fontStyleMap[key] : null;
    if (!key) return wanted;
    // A font with no styles, or one whose family name already carries its weight (Larken-Black, Arial Black), is
    // listed by Resolve with the single style "Regular".
    if (!list || !list.length || (list.length <= 1 && FONT_WEIGHT_NAME.test(String(font)))) return 'Regular';
    const w = String(wanted || '').toLowerCase();
    const hit = list.find(x => x.toLowerCase() === w);
    if (hit) return hit;
    for (const n of ['regular', 'book', 'roman', 'normal', 'medium']) { const r = list.find(x => x.toLowerCase() === n); if (r) return r; }
    return list[0];
}

function resolveFontFiles(fontsList) {
    return new Promise((resolve) => {
        if (!Array.isArray(fontsList) || !fontsList.length) return resolve({});
        if (process.platform !== 'darwin') {
            const found = {};
            const dirs = process.platform === 'win32'
                ? [path.join(process.env.WINDIR || 'C:\\Windows', 'Fonts'), path.join(process.env.LOCALAPPDATA || '', 'Microsoft', 'Windows', 'Fonts')]
                : ['/usr/share/fonts', '/usr/local/share/fonts', path.join(os.homedir(), '.fonts'), path.join(os.homedir(), '.local/share/fonts')];
            for (const item of fontsList) {
                const fam = String(item.family || '').trim();
                if (!fam) continue;
                for (const d of dirs) {
                    if (!fs.existsSync(d)) continue;
                    try {
                        for (const f of fs.readdirSync(d)) {
                            if (f.toLowerCase().includes(fam.toLowerCase())) {
                                found[fam + '|' + (item.style || '')] = path.join(d, f);
                                break;
                            }
                        }
                    } catch (e) { /* ignore */ }
                    if (found[fam + '|' + (item.style || '')]) break;
                }
            }
            return resolve(found);
        }

        const js = `
ObjC.import("AppKit");
ObjC.import("CoreText");
(function() {
    const items = ${JSON.stringify(fontsList)};
    const fm = $.NSFontManager.sharedFontManager;
    const out = {};
    for (const it of items) {
        const family = it.family;
        const style = it.style || "";
        if (!family) continue;
        let postscript = null;
        let members = [];
        try { members = ObjC.deepUnwrap(fm.availableMembersOfFontFamily($(family))) || []; } catch (e) {}
        if (style && members.length) {
            const sLow = String(style).toLowerCase();
            for (const m of members) {
                if (String(m[1]).toLowerCase() === sLow) {
                    postscript = String(m[0]);
                    break;
                }
            }
        }
        if (!postscript && members.length) {
            postscript = String(members[0][0]);
        }
        if (!postscript) {
            postscript = family;
        }

        const nf = $.NSFont.fontWithNameSize($(postscript), 12);
        if (!nf || !nf.fontName) {
            const nfFam = $.NSFont.fontWithNameSize($(family), 12);
            if (nfFam && nfFam.fontName) postscript = family;
            else continue;
        }

        const ct = $.CTFontCreateWithName($(postscript), 12, null);
        if (!ct) continue;
        const url = $.CTFontCopyAttribute(ct, $.kCTFontURLAttribute);
        if (url && url.path) {
            out[family + "|" + style] = String(ObjC.unwrap(url.path));
        }
    }
    return JSON.stringify(out);
})();`;

        execFile(OSASCRIPT, ['-l', 'JavaScript', '-e', js], { timeout: 15000, maxBuffer: 16 * 1024 * 1024 }, (err, stdout) => {
            if (err || !stdout) return resolve({});
            try {
                const map = JSON.parse(String(stdout).trim());
                resolve(map || {});
            } catch (e) {
                resolve({});
            }
        });
    });
}

async function copyFontsForSetting(settingFilePath, textDesign) {
    try {
        ensureDirs();
        const fontsToCheck = [];
        const seen = new Set();
        const add = (fam, sty) => {
            if (!fam) return;
            const key = fam.trim() + '|' + (sty || 'Regular').trim();
            if (seen.has(key.toLowerCase())) return;
            seen.add(key.toLowerCase());
            fontsToCheck.push({ family: fam.trim(), style: (sty || 'Regular').trim() });
        };

        if (textDesign && textDesign.font) {
            add(textDesign.font, textDesign.style);
        }
        if (settingFilePath && fs.existsSync(settingFilePath)) {
            try {
                const raw = fs.readFileSync(settingFilePath, 'utf8');
                const fontMatches = [...raw.matchAll(/\bFont\s*=\s*Input\s*\{\s*Value\s*=\s*"([^"]+)"/g)].map(m => m[1]);
                const styleMatches = [...raw.matchAll(/\bStyle\s*=\s*Input\s*\{\s*Value\s*=\s*"([^"]+)"/g)].map(m => m[1]);
                for (let i = 0; i < fontMatches.length; i++) {
                    add(fontMatches[i], styleMatches[i] || 'Regular');
                }
            } catch (e) { /* ignore */ }
        }

        if (!fontsToCheck.length) return [];

        const map = await resolveFontFiles(fontsToCheck);
        const copied = [];
        for (const srcPath of Object.values(map)) {
            if (!srcPath || !fs.existsSync(srcPath)) continue;
            const destName = path.basename(srcPath);
            const destPath = path.join(FONTS_DIR, destName);
            try {
                if (!fs.existsSync(destPath)) {
                    fs.copyFileSync(srcPath, destPath);
                    dlog('[fonts] Saved font to fonts folder:', destName, 'from', srcPath);
                }
                copied.push(destName);
            } catch (e) {
                dlog('[fonts] Failed copying font:', srcPath, e.message);
            }
        }
        return copied;
    } catch (err) {
        dlog('[fonts] Error in copyFontsForSetting:', err.message);
        return [];
    }
}

async function syncAllPresetFonts() {
    try {
        ensureDirs();
        const lib = loadLib();
        const fontsToCheck = [];
        const seen = new Set();
        const add = (fam, sty) => {
            if (!fam) return;
            const key = fam.trim() + '|' + (sty || 'Regular').trim();
            if (seen.has(key.toLowerCase())) return;
            seen.add(key.toLowerCase());
            fontsToCheck.push({ family: fam.trim(), style: (sty || 'Regular').trim() });
        };

        for (const a of lib.animations) {
            if (a.textDesign && a.textDesign.font) {
                add(a.textDesign.font, a.textDesign.style);
            }
            if (a.file) {
                const fp = path.join(ANIM_DIR, a.file);
                if (fs.existsSync(fp)) {
                    try {
                        const raw = fs.readFileSync(fp, 'utf8');
                        const fontMatches = [...raw.matchAll(/\bFont\s*=\s*Input\s*\{\s*Value\s*=\s*"([^"]+)"/g)].map(m => m[1]);
                        const styleMatches = [...raw.matchAll(/\bStyle\s*=\s*Input\s*\{\s*Value\s*=\s*"([^"]+)"/g)].map(m => m[1]);
                        for (let i = 0; i < fontMatches.length; i++) {
                            add(fontMatches[i], styleMatches[i] || 'Regular');
                        }
                    } catch (e) { /* ignore */ }
                }
            }
        }

        if (fontsToCheck.length) {
            const map = await resolveFontFiles(fontsToCheck);
            for (const srcPath of Object.values(map)) {
                if (!srcPath || !fs.existsSync(srcPath)) continue;
                const destName = path.basename(srcPath);
                const destPath = path.join(FONTS_DIR, destName);
                try {
                    if (!fs.existsSync(destPath)) {
                        fs.copyFileSync(srcPath, destPath);
                        dlog('[fonts] Synced font:', destName);
                    }
                } catch (e) { /* ignore */ }
            }
        }
    } catch (e) { /* ignore */ }
}
