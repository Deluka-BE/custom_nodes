'use strict';
// Dependency-free syntax and whitespace checks; preserve existing formatting.
const fs = require('node:fs');
const cp = require('node:child_process');
const files = cp.execFileSync('git', ['ls-files'], {encoding: 'utf8'}).trim().split('\n');
for (const file of files) {
  if (/\.(?:js|cjs)$/.test(file)) cp.execFileSync(process.execPath, ['--check', file], {stdio: 'inherit'});
  if (/\.(?:js|cjs|html|md|ya?ml)$/.test(file)) {
    const text = fs.readFileSync(file, 'utf8');
    if (/\r|[ \t]+$/m.test(text) || !text.endsWith('\n')) throw new Error(`Whitespace check failed: ${file}`);
  }
}
console.log('Syntax and whitespace checks passed');
