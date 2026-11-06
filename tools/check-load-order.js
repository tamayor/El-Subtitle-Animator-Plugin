// The panel scripts are classic scripts sharing one global scope, loaded in index.html order. Inside one file a function
// can be called before its declaration (hoisting); across files it cannot. This walks everything that runs while the
// scripts load (top-level statements, IIFEs and the functions they call) and reports any use of a name that is only
// declared by a later script.  Run: npm run check
const { scriptOrder, parse, topLevelNames } = require('./renderer-scripts');

const order = scriptOrder();
const files = order.map((f, i) => ({ f, i, ast: parse(f) }));
const declaredIn = {};
const fnBody = {};
for (const F of files) {
    for (const name of topLevelNames(F.ast)) declaredIn[name] = F.i;
    for (const n of F.ast.body) {
        if (n.type === 'FunctionDeclaration') fnBody[n.id.name] = n.body;
        if (n.type === 'VariableDeclaration') {
            for (const d of n.declarations) if (d.init && /Function/.test(d.init.type)) fnBody[d.id.name] = d.init.body;
        }
    }
}

const isFn = (n) => n && /^(FunctionExpression|ArrowFunctionExpression|FunctionDeclaration)$/.test(n.type);
// Identifiers evaluated right away in `node` (bodies of functions that are not invoked on the spot are skipped).
function immediateRefs(node) {
    const out = [];
    (function walk(n, parent, key) {
        if (!n || typeof n.type !== 'string') return;
        if (isFn(n) && !(parent && parent.type === 'CallExpression' && key === 'callee')) return;
        if (n.type === 'Identifier') {
            const isProp = parent && ((parent.type === 'MemberExpression' && key === 'property' && !parent.computed) ||
                (parent.type === 'Property' && key === 'key' && !parent.computed));
            if (!isProp) out.push(n.name);
            return;
        }
        for (const k of Object.keys(n)) {
            if (k === 'loc') continue;
            const c = n[k];
            if (Array.isArray(c)) c.forEach(x => walk(x, n, k));
            else if (c && typeof c.type === 'string') walk(c, n, k);
        }
    })(node, null, null);
    return out;
}

let problems = 0;
for (const F of files) {
    const visited = new Set();
    const stack = F.ast.body.filter(n => n.type !== 'FunctionDeclaration').map(n => ({ node: n, via: 'line ' + n.loc.start.line }));
    while (stack.length) {
        const { node, via } = stack.pop();
        for (const name of immediateRefs(node)) {
            if (!(name in declaredIn)) continue;
            if (declaredIn[name] > F.i) {
                problems++;
                console.error(`${F.f}: '${name}' is used while loading (${via}) but declared later, in ${order[declaredIn[name]]}`);
            } else if (fnBody[name] && !visited.has(name)) {
                visited.add(name);
                stack.push({ node: fnBody[name], via: via + ' -> ' + name + '()' });
            }
        }
    }
}
if (problems) { console.error(problems + ' load-order problem(s). Reorder the <script> tags in src/renderer/index.html.'); process.exit(1); }
console.log('Load order OK (' + order.length + ' scripts).');
