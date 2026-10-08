'use strict';
const assert = require('node:assert/strict');
const required = ['test (22, node-red-contrib-debug-file)', 'test (24, node-red-contrib-debug-file)', 'audit', 'workflow-and-secrets', 'codeql'];
function checkRuns(checks) {
  assert(Number.isInteger(checks.total_count) && checks.total_count <= 100, 'Too many or invalid checks; inspect pagination before release');
  for (const name of required) {
    const latest = checks.check_runs.filter(c => c.name === name).sort((a,b) => b.id-a.id)[0];
    assert(latest && latest.app?.slug === 'github-actions' && latest.status === 'completed' && latest.conclusion === 'success', `Mandatory release check not passed: ${name}`);
  }
}
function artifactHash(pkg, hash) {
  if (pkg.name === 'node-red-contrib-debug-file' && pkg.version === '0.2.0') {
    assert.equal(hash, 'd08bdbaa1156cc2bb3445408376c0b669658cf7491a46c24a3a94a1a513b4c5f', 'Authorized v0.2.0 artifact hash must remain unchanged');
  }
}
module.exports = {required, checkRuns, artifactHash};
