 'use strict';
const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const cp = require('node:child_process');
const tool = path.join(__dirname, 'prepare-publish.cjs');
const sha = 'a'.repeat(40);
function fixture() {
  return {
    pkg: {name:'node-red-contrib-fixture',version:'1.0.0',repository:{url:'git+https://github.com/owner/repo.git'}},
    env: {protection_rules:[{type:'required_reviewers',reviewers:[{type:'User'}]}],deployment_branch_policy:{custom_branch_policies:true}},
    policies:{branch_policies:[{name:'v*',type:'tag'}]},
    protection:{enforce_admins:{enabled:true},required_pull_request_reviews:{required_approving_review_count:1},required_status_checks:{strict:true,checks:['test (22)','test (24)','audit','workflow-and-secrets','codeql','dependency-review'].map(context=>({context,app_id:15368}))}},
    rule:{id:1,target:'tag',enforcement:'active',bypass_actors:[],conditions:{ref_name:{include:['refs/tags/v*']}},rules:[{type:'update'},{type:'deletion'}]},
    release:{tag_name:'v1.0.0',draft:false,prerelease:false,assets:[{name:'node-red-contrib-fixture-1.0.0.tgz'}]},
    status:200, metadata:{maintainers:[{name:'verified-owner'}],versions:{}},sha,remote:sha
  };
}
const cases = [
  ['valid protected release passes', null, 0],
  ['missing required reviewer', f => { f.env.protection_rules=[]; }, 1],
  ['branch deployment policy rejected', f => { f.policies.branch_policies=[{name:'main',type:'branch'}]; }, 1],
  ['tag bypass actor rejected', f => { f.rule.bypass_actors=[{actor_id:1}]; }, 1],
  ['missing security check rejected', f => { f.protection.required_status_checks.checks=[{context:'test (22)',app_id:15368}]; }, 1],
  ['moved remote tag rejected', f => { f.remote='b'.repeat(40); }, 1],
  ['non-main ancestor rejected', f => { f.notAncestor=true; }, 1],
  ['missing provenance metadata rejected', f => { delete f.pkg.repository; }, 1],
  ['lifecycle publish script rejected', f => { f.pkg.scripts={prepublishOnly:'echo unsafe'}; }, 1],
  ['draft GitHub release rejected', f => { f.release.draft=true; }, 1],
  ['registry auth failure rejected', f => { f.status=401; }, 1],
  ['registry missing package rejected', f => { f.status=404; }, 1],
  ['registry network failure rejected', f => { f.networkError=true; }, 1],
  ['unverified owner rejected', f => { f.metadata.maintainers=[{name:'someone-else'}]; }, 1],
  ['published version rejected', f => { f.metadata.versions['1.0.0']={}; }, 1],
  ['missing archive rejected', f => { f.release.assets=[]; }, 1]
];
for (const [name, change, expected] of cases) test(name, () => {
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'publish-preflight-test-'));
  try {
    const f=fixture(); if(change) change(f);
    fs.mkdirSync(path.join(dir,'bin'));
    fs.writeFileSync(path.join(dir,'fixture.json'),JSON.stringify(f));
    fs.writeFileSync(path.join(dir,'package.json'),JSON.stringify(f.pkg));
    fs.writeFileSync(path.join(dir,'fetch.cjs'), `const f=require(process.env.FIXTURE);global.fetch=async()=>{if(f.networkError)throw Error('fixture network failure');return {status:f.status,json:async()=>f.metadata}};`);
    const stub = `#!/usr/bin/env node
const fs=require('node:fs');const path=require('node:path');const f=require(process.env.FIXTURE);const a=process.argv.slice(2);let out='';
if(path.basename(process.argv[1])==='git') {
 if(a[0]==='ls-remote')out=f.remote+'\\trefs/tags/v1.0.0';
 else if(a[0]==='rev-parse')out=f.sha;
 else if(a[0]==='merge-base'&&f.notAncestor)process.exit(1);
} else if(a[0]==='api') {
 const route=a[1];let v;
 if(route.endsWith('/deployment-branch-policies'))v=f.policies;
 else if(route.endsWith('/environments/npm-publish'))v=f.env;
 else if(route.endsWith('/branches/main/protection'))v=f.protection;
 else if(route.endsWith('/rulesets/1'))v=f.rule;
 else if(route.endsWith('/rulesets'))v=[f.rule];
 else if(route.includes('/releases/tags/'))v=f.release;
 else process.exit(1);
 out=JSON.stringify(v);
} else if(a[0]==='release'&&a[1]==='download') {
 const dir=a[a.indexOf('--dir')+1];fs.writeFileSync(path.join(dir,a[a.indexOf('--pattern')+1]),'fixture');
} else process.exit(1);
process.stdout.write(out.replace('\\t','\t'));
`;
    for(const command of ['gh','git']) fs.writeFileSync(path.join(dir,'bin',command),stub,{mode:0o755});
    const result=cp.spawnSync(process.execPath,[tool],{cwd:dir,encoding:'utf8',env:{...process.env,
      PATH:`${path.join(dir,'bin')}:${process.env.PATH}`,FIXTURE:path.join(dir,'fixture.json'),NODE_OPTIONS:`--require=${path.join(dir,'fetch.cjs')}`,
      GITHUB_REPOSITORY:'owner/repo',GITHUB_REF:'refs/tags/v1.0.0',GITHUB_SHA:sha,GITHUB_ENV:path.join(dir,'output.env'),RELEASE_TAG:'v1.0.0',CONFIRM_PACKAGE:'node-red-contrib-fixture',EXPECTED_NPM_OWNER:'verified-owner'
    }});
    assert.equal(result.status,expected,result.stderr);
    if(expected) assert(!fs.existsSync(path.join(dir,'output.env')), 'Failed preflight must not prepare an artifact');
    else {
      const archive=fs.readFileSync(path.join(dir,'output.env'),'utf8').trim().split('=')[1];
      fs.rmSync(path.dirname(archive),{recursive:true,force:true});
    }
  } finally {fs.rmSync(dir,{recursive:true,force:true});}
});
