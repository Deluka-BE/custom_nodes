'use strict';
const {test} = require('node:test');
const assert = require('node:assert/strict');
const {required, checkRuns, artifactHash} = require('./release-gates.cjs');
function checks() {
  return {total_count:required.length, check_runs:required.map((name,id) => ({name,id,app:{slug:'github-actions'},status:'completed',conclusion:'success'}))};
}
test('all exact required checks must succeed', () => checkRuns(checks()));
for (const conclusion of ['failure','cancelled','skipped','neutral',null]) test(`release rejects ${conclusion} check`, () => {
  const c=checks(); c.check_runs[0].conclusion=conclusion; assert.throws(() => checkRuns(c));
});
test('missing or untrusted check cannot authorize release', () => {
  const c=checks(); c.check_runs.pop(); assert.throws(() => checkRuns(c));
  const d=checks(); d.check_runs[0].app.slug='external'; assert.throws(() => checkRuns(d));
});
test('new failed rerun supersedes older success', () => {
  const c=checks(); c.check_runs.push({...c.check_runs[0],id:100,conclusion:'failure'}); c.total_count++;
  assert.throws(() => checkRuns(c));
});
test('incomplete paginated checks fail closed', () => {
  const c=checks(); c.total_count=101; assert.throws(() => checkRuns(c));
});
test('v0.2.0 exact artifact is mandatory', () => {
  const pkg={name:'node-red-contrib-debug-file',version:'0.2.0'};
  artifactHash(pkg, 'd08bdbaa1156cc2bb3445408376c0b669658cf7491a46c24a3a94a1a513b4c5f');
  assert.throws(() => artifactHash(pkg, '0'.repeat(64)));
});
