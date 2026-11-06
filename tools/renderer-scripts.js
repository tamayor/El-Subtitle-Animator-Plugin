// Shared by eslint.config.mjs and check-load-order.js: the panel's scripts in the order index.html loads them, and the
// global names each one declares (all panel scripts share one global scope).
const fs = require('fs');
const path = require('path');
const acorn = require('acorn');

const RENDERER_DIR = path.join(__dirname, '..', 'src', 'renderer');

function scriptOrder() {
    const html = fs.readFileSync(path.join(RENDERER_DIR, 'index.html'), 'utf8');
    return [...html.matchAll(/<script src="\.\/(js\/[^"]+)"/g)].map(m => m[1]);
}

function parse(file) {
    return acorn.parse(fs.readFileSync(path.join(RENDERER_DIR, file), 'utf8'), { ecmaVersion: 'latest', locations: true });
}

function topLevelNames(ast) {
    const names = [];
    for (const n of ast.body) {
        if (n.type === 'FunctionDeclaration') names.push(n.id.name);
        else if (n.type === 'VariableDeclaration') for (const d of n.declarations) if (d.id.type === 'Identifier') names.push(d.id.name);
    }
    return names;
}

module.exports = { RENDERER_DIR, scriptOrder, parse, topLevelNames };
