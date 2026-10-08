'use strict';
const assert = require('node:assert/strict');
function validReport(report) {
  assert.equal(report.auditReportVersion, 2, 'Unsupported audit report');
  assert(!report.error, 'Audit service failure');
  assert(report.vulnerabilities && report.metadata?.vulnerabilities, 'Incomplete audit report');
  assert.equal(Object.keys(report.vulnerabilities).length, report.metadata.vulnerabilities.total);
}
function actionable(report, lock, policy, now = new Date()) {
  validReport(report);
  assert(now < new Date(`${policy.expiresOn}T00:00:00Z`), 'Runtime risk acceptance expired; review upstream fixes');
  assert.equal(lock.packages[policy.npmPath]?.version, policy.npmVersion, 'Bundled npm changed; review acceptance');
  assert.equal(lock.packages[policy.npmPath]?.dev, true);
  for (const [name, finding] of Object.entries(report.vulnerabilities)) {
    const accepted = policy.findings[name];
    assert(accepted, `Actionable or unaccepted finding: ${name}`);
    assert.equal(finding.severity, accepted.severity, `Severity changed: ${name}`);
    assert.deepEqual(finding.nodes, [`${policy.npmPath}/node_modules/${name}`], `Finding escaped test runtime: ${name}`);
    const entry = lock.packages[finding.nodes[0]];
    assert(entry?.dev && entry.inBundle, `Finding is not dev-only bundled: ${name}`);
    assert.equal(entry.version, accepted.version, `Version changed: ${name}`);
    assert(finding.via.every(v => typeof v === 'object' && Number.isInteger(v.source)), 'Unreviewed transitive advisory');
    const ids = finding.via.map(v => v.source);
    assert(ids.every(id => accepted.advisories.includes(id)), `New advisory: ${name}`);
    assert(!finding.isDirect, 'Direct dependency cannot be accepted');
  }
}
module.exports = {validReport, actionable};
