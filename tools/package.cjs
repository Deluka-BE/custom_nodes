'use strict';
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const root = path.resolve(__dirname, '..');
const packages = JSON.parse(fs.readFileSync(path.join(root, 'packages.json')));
module.exports = function select(name = process.env.PACKAGE_NAME) {
  assert(Object.hasOwn(packages, name || ''), 'Unknown package');
  const entry = packages[name];
  assert.equal(entry.path, `packages/${name}`);
  assert.equal(entry.environment, `npm-${name}`);
  return {name, ...entry, root, directory:path.join(root, entry.path)};
};
