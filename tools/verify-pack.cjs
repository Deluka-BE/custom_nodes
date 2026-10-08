 'use strict';
const assert = require('node:assert/strict');
const cp = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
if (process.env.PACKAGE_NAME) process.chdir(require('./package.cjs')().directory);
const pkg = JSON.parse(fs.readFileSync('package.json'));
assert.match(pkg.name, /^(?:@[a-z0-9-]+\/)?node-red-contrib-[a-z0-9-]+$/);
assert(pkg.keywords.includes('node-red'));
assert(pkg.license && pkg.description && pkg.engines.node);
assert(pkg['node-red'] && Object.keys(pkg['node-red'].nodes).length);
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'node-pack-'));
try {
  const [packed] = JSON.parse(cp.execFileSync('npm', ['pack', '--ignore-scripts', '--json', '--pack-destination', dir], {encoding:'utf8'}));
  assert.equal(packed.name, pkg.name); assert.equal(packed.version, pkg.version);
  const files = new Set(packed.files.map(f => f.path));
  const expected = new Set(['package.json', 'README.md', 'LICENSE', 'SECURITY.md']);
  function walk(root) {
    if (!fs.existsSync(root)) return;
    for (const e of fs.readdirSync(root, {withFileTypes:true})) {
      const file = `${root}/${e.name}`;
      assert(!e.isSymbolicLink(), 'No symlinks in package');
      if (e.isDirectory()) walk(file); else expected.add(file);
    }
  }
  walk('nodes');
  assert.deepEqual([...files].sort(), [...expected].sort(), 'Review explicit pack allowlist before adding files');
  for (const runtime of Object.values(pkg['node-red'].nodes)) {
    assert(files.has(runtime)); assert(files.has(runtime.replace(/\.js$/, '.html')));
  }
  const archive = path.join(dir, packed.filename);
  const released = process.env.RELEASE_ARCHIVE;
  if (released) {
    const entries = cp.execFileSync('tar', ['-tzf', released], {encoding:'utf8'}).trim().split('\n');
    assert.deepEqual(entries.sort(), [...files].map(f => `package/${f}`).sort(), 'Release archive file list differs');
  }
  for (const file of files) {
    const bytes = cp.execFileSync('tar', ['-xOzf', archive, `package/${file}`]);
    if (released) assert.deepEqual(bytes, cp.execFileSync('tar', ['-xOzf', released, `package/${file}`]), `GitHub release differs: ${file}`);
    assert.deepEqual(bytes, fs.readFileSync(file), `Packed bytes differ: ${file}`);
  }
  console.log(`Verified ${packed.filename}: ${files.size} allowlisted files, integrity ${packed.integrity}`);
} finally { fs.rmSync(dir, {recursive:true, force:true}); }
