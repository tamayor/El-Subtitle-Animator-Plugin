import globals from 'globals';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const { scriptOrder, parse, topLevelNames } = require('./tools/renderer-scripts.js');

// Panel scripts share one global scope: every top-level name of every panel script is a global for the others.
const panelGlobals = {};
for (const f of scriptOrder()) for (const name of topLevelNames(parse(f))) panelGlobals[name] = 'writable';
// Components publish themselves on window (see src/renderer/js/components).
for (const name of ['SABoxes', 'SAThumbs', 'SAPreview', 'SASounds', 'previewFrames']) panelGlobals[name] = 'readonly';

const rules = {
    'no-undef': 'error',
    'no-redeclare': 'error',
    'no-unused-vars': ['warn', { args: 'none', caughtErrors: 'none' }],
};

export default [
    { ignores: ['_archive/**', '_debug/**', 'node_modules/**'] },
    {
        files: ['main.js', 'src/main/**/*.js', 'src/preload.js', 'tools/**/*.js', 'mcp/**/*.js', 'test/**/*.js'],
        languageOptions: { ecmaVersion: 'latest', sourceType: 'commonjs', globals: { ...globals.node } },
        rules,
    },
    {
        files: ['src/renderer/js/**/*.js'],
        languageOptions: { ecmaVersion: 'latest', sourceType: 'script', globals: { ...globals.browser, ...panelGlobals } },
        rules: { ...rules, 'no-redeclare': ['error', { builtinGlobals: false }], 'no-unused-vars': ['warn', { args: 'none', caughtErrors: 'none', vars: 'local' }] },
    },
];
