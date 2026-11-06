// Debug log (enabled with SA_DEBUG=1), written to _debug/preview-log.txt.

module.exports = {
    dlog
};

const path = require('path');
const fs = require('fs');

const { DEBUG_LOG, DEBUG_ON } = require('./config');

let debugBytes = 0;
function dlog(...parts) {
    if (!DEBUG_ON) return;
    try {
        if (debugBytes === 0) {
            fs.mkdirSync(path.dirname(DEBUG_LOG), { recursive: true });
            try { debugBytes = fs.statSync(DEBUG_LOG).size; } catch (e) { debugBytes = 1; }
        }
        if (debugBytes > 1000000) { fs.writeFileSync(DEBUG_LOG, ''); debugBytes = 1; }
        const line = new Date().toISOString() + ' ' + parts.map(p => typeof p === 'string' ? p : JSON.stringify(p)).join(' ') + '\n';
        debugBytes += line.length;
        fs.appendFileSync(DEBUG_LOG, line);
    } catch (e) { /* ignore */ }
}
