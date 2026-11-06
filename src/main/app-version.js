// Reading and bumping the plugin version (package.json + manifest.xml).

module.exports = {
    getAppVersion, setAppVersion
};

const fs = require('fs');
const { app } = require('electron');

const { MANIFEST_XML, PACKAGE_JSON } = require('./config');

function getAppVersion() {
    try {
        const pkgPath = PACKAGE_JSON;
        if (fs.existsSync(pkgPath)) {
            const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
            if (pkg && pkg.version) return { version: String(pkg.version).trim() };
        }
    } catch (e) {
        console.warn('Failed reading package.json version:', e);
    }
    try {
        if (app && app.getVersion) {
            const v = app.getVersion();
            if (v && v !== '0.0.0') return { version: String(v).trim() };
        }
    } catch (e) {}
    return { version: '1.0.0' };
}

function setAppVersion(event, newVer) {
    if (!newVer || typeof newVer !== 'string') {
        return { error: 'Invalid version string' };
    }
    const cleanVer = newVer.trim().replace(/^v/i, '').trim();
    if (!cleanVer) return { error: 'Invalid version string' };

    const pkgPath = PACKAGE_JSON;
    try {
        let pkg = {};
        if (fs.existsSync(pkgPath)) {
            pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
        }
        pkg.version = cleanVer;
        fs.writeFileSync(pkgPath, JSON.stringify(pkg, null, 4) + '\n', 'utf8');
    } catch (e) {
        return { error: 'Failed to update package.json: ' + (e.message || e) };
    }

    const manifestPath = MANIFEST_XML;
    try {
        if (fs.existsSync(manifestPath)) {
            let xml = fs.readFileSync(manifestPath, 'utf8');
            if (/<Version>.*?<\/Version>/.test(xml)) {
                xml = xml.replace(/<Version>.*?<\/Version>/, `<Version>${cleanVer}</Version>`);
                fs.writeFileSync(manifestPath, xml, 'utf8');
            }
        }
    } catch (e) {
        console.warn('Failed to update manifest.xml:', e);
    }

    return { ok: true, version: cleanVer };
}
