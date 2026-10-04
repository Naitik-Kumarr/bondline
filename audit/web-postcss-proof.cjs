// Local dependency proof only. The target is this script's own non-secret marker under audit/.
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const postcss = require('../node_modules/next/node_modules/postcss');
const area = path.join(__dirname, 'web-postcss-proof');
const cssDir = path.join(area, 'css');
fs.mkdirSync(cssDir, { recursive: true });
const markerPath = path.join(area, 'outside.map');
fs.writeFileSync(markerPath, JSON.stringify({ version: 3, sources: ['audit-marker'],
  sourcesContent: ['AUDIT_NON_SECRET_MARKER'], names: [], mappings: '' }));
const css = 'a { color: red; } /*# sourceMappingURL=../outside.map */';
const root = postcss.parse(css, { from: path.join(cssDir, 'input.css') });
const traversed = root.source.input.map?.text.includes('AUDIT_NON_SECRET_MARKER') === true;
console.log(JSON.stringify({ postcssVersion: require('../node_modules/next/node_modules/postcss/package.json').version,
  cssDirectory: cssDir, markerOutsideCSSDirectory: markerPath, loadedOutsideMarker: traversed }, null, 2));
assert.equal(traversed, false, 'FAIL: installed PostCSS followed sourceMappingURL traversal outside CSS folder');
