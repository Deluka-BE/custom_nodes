'use strict';
const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {actionable, validReport} = require('./audit-policy.cjs');
const policy = require('../docs/dev-runtime-risk.json');
const lock = require('../package-lock.json');
function report() {
  const vulnerabilities = Object.fromEntries(Object.entries(policy.findings).map(([name, f]) => [name, {
    severity:f.severity, nodes:[`${policy.npmPath}/node_modules/${name}`],
    via:f.advisories.map(source => ({source})), isDirect:false
  }]));
  return {auditReportVersion:2, vulnerabilities, metadata:{vulnerabilities:{total:5}}};
}
const now = new Date('2026-10-09');
test('accepted bundled runtime remains visible and passes actionable gate', () => {
  const r = report(); const before = JSON.stringify(r);
  actionable(r, lock, policy, now); assert.equal(JSON.stringify(r), before);
});
for (const [name, mutate] of [
  ['new dependency', r => {r.vulnerabilities.evil = {...r.vulnerabilities.undici}; r.metadata.vulnerabilities.total++;}],
  ['same name outside runtime', r => {r.vulnerabilities.undici.nodes.push('node_modules/undici');}],
  ['new advisory', r => {r.vulnerabilities.undici.via.push({source:99999999});}],
  ['severity escalation', r => {r.vulnerabilities.undici.severity='critical';}],
  ['direct finding', r => {r.vulnerabilities.undici.isDirect=true;}],
  ['transitive finding', r => {r.vulnerabilities.undici.via.push('other');}],
  ['registry failure', r => {r.error={code:'network'};}],
  ['incomplete report', r => {delete r.metadata;}],
  ['unknown report format', r => {r.auditReportVersion=3;}]
]) test(`${name} fails closed`, () => {
  const r=report(); mutate(r); assert.throws(() => actionable(r, lock, policy, now));
});
test('expiration blocks release', () => assert.throws(() => actionable(report(), lock, policy, new Date('2026-11-08'))));
test('upstream bundled version or dev isolation changes require review', () => {
  for (const mutate of [l => {l.packages[policy.npmPath].version='12.0.0';}, l => {l.packages[`${policy.npmPath}/node_modules/undici`].dev=false;}, l => {l.packages[`${policy.npmPath}/node_modules/undici`].inBundle=false;}]) {
    const l=structuredClone(lock); mutate(l); assert.throws(() => actionable(report(), l, policy, now));
  }
});
test('fixed findings can disappear without suppressing remaining findings', () => {
  const r=report(); delete r.vulnerabilities.undici; r.metadata.vulnerabilities.total--;
  actionable(r, lock, policy, now);
});
test('production report failure is not interpreted as zero findings', () => assert.throws(() => validReport({})));
test('release tools import only builtins or local release tools', () => {
  const root=path.join(__dirname, '..');
  for (const file of fs.readdirSync(__dirname).filter(f => f.endsWith('.cjs') && !f.endsWith('.test.cjs'))) {
    const source=fs.readFileSync(path.join(__dirname, file), 'utf8');
    for (const match of source.matchAll(/require\(['"]([^'"]+)['"]\)/g)) {
      assert(match[1].startsWith('node:') || match[1].startsWith('./') || /^\.\.\/(?:package(?:-lock)?\.json|packages\.json|docs\/dev-runtime-risk\.json)$/.test(match[1]), `Unexpected release tooling dependency in ${file}: ${match[1]}`);
    }
  }
  const pkg=JSON.parse(fs.readFileSync(path.join(root, 'package.json')));
  assert(!pkg.dependencies && !pkg.optionalDependencies && !pkg.scripts && pkg.private);
});
