 'use strict';
// Explicit, reusable admin setup. Continue independent features after API restrictions.
const assert = require('node:assert/strict');
const cp = require('node:child_process');
const [repo, reviewer] = process.argv.slice(2);
assert.match(repo || '', /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/);
assert.match(reviewer || '', /^[A-Za-z0-9-]+$/);
const get = route => JSON.parse(cp.execFileSync('gh',['api',route],{encoding:'utf8'}));
const info = get(`repos/${repo}`);
assert(info.permissions.admin, 'Repository admin permission required');
const id = get(`users/${reviewer}`).id;
let failed = false;
function apply(label, route, method, data) {
  const result = cp.spawnSync('gh', ['api', '--method', method, route, ...(data ? ['--input', '-'] : [])], {input:data ? JSON.stringify(data):undefined, encoding:'utf8'});
  if (result.status) { failed = true; console.error(`${label}: blocked (permissions/plan/policy); inspect GitHub settings`); }
  else console.log(`${label}: configured`);
}
const variables = get(`repos/${repo}/actions/variables`).variables;
if (variables.some(v => v.name === 'NPM_PUBLISH_ENABLED')) apply('Publishing disabled', `repos/${repo}/actions/variables/NPM_PUBLISH_ENABLED`, 'PATCH', {name:'NPM_PUBLISH_ENABLED', value:'false'});
else apply('Publishing disabled', `repos/${repo}/actions/variables`, 'POST', {name:'NPM_PUBLISH_ENABLED', value:'false'});
if (failed) throw new Error('Cannot disable publishing; stop setup');
apply('Read-only workflow defaults', `repos/${repo}/actions/permissions/workflow`, 'PUT', {default_workflow_permissions:'read', can_approve_pull_request_reviews:false});
apply('Main protection', `repos/${repo}/branches/main/protection`, 'PUT', {
  required_status_checks:{strict:true,checks:['test (22)','test (24)','audit','workflow-and-secrets','codeql','dependency-review'].map(context => ({context,app_id:15368}))},
  enforce_admins:true,
  required_pull_request_reviews:{dismiss_stale_reviews:true,require_code_owner_reviews:true,required_approving_review_count:1,require_last_push_approval:true},
  restrictions:null, required_linear_history:true, allow_force_pushes:false, allow_deletions:false, required_conversation_resolution:true
});
const existingTagRule = get(`repos/${repo}/rulesets`).find(r => r.name === 'Immutable release tags');
apply('Immutable release tags', `repos/${repo}/rulesets${existingTagRule ? '/' + existingTagRule.id : ''}`, existingTagRule ? 'PUT' : 'POST', {
  name:'Immutable release tags', target:'tag', enforcement:'active', bypass_actors:[],
  conditions:{ref_name:{include:['refs/tags/v*'],exclude:[]}}, rules:[{type:'update'},{type:'deletion'}]
});
apply('Approval environment', `repos/${repo}/environments/npm-publish`, 'PUT', {
  wait_timer:0, prevent_self_review:false, reviewers:[{type:'User',id}],
  deployment_branch_policy:{protected_branches:false,custom_branch_policies:true}
});
const branchPolicies = get(`repos/${repo}/environments/npm-publish/deployment-branch-policies`).branch_policies;
for (const policy of branchPolicies) apply('Remove old environment policy', `repos/${repo}/environments/npm-publish/deployment-branch-policies/${policy.id}`, 'DELETE');
apply('Release-tag-only deployments', `repos/${repo}/environments/npm-publish/deployment-branch-policies`, 'POST', {name:'v*',type:'tag'});
apply('Secret scanning and push protection', `repos/${repo}`, 'PATCH', {
  security_and_analysis:{secret_scanning:{status:'enabled'},secret_scanning_push_protection:{status:'enabled'}}
});
apply('Dependabot alerts', `repos/${repo}/vulnerability-alerts`, 'PUT');
if (failed) process.exitCode = 1;
