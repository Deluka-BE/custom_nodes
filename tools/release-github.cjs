 'use strict';
// Requires explicit release authorization. Never pushes refs or overwrites releases.
const assert = require('node:assert/strict');
const cp = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');
const [repo, tag, archiveArg, notes] = process.argv.slice(2);
assert.match(repo || '', /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/);
const selected = require('./package.cjs')();
assert.match(tag || '', new RegExp(`^${selected.name}/v[0-9]+\\.[0-9]+\\.[0-9]+$`));
const run = (cmd,args) => cp.execFileSync(cmd,args,{encoding:'utf8'}).trim();
JSON.parse(run('gh',['api',`repos/${repo}`])); // Fail on absent repo or inaccessible auth.
const commit = run('git',['rev-parse',`${tag}^{commit}`]);
const localTag = run('git',['rev-parse',tag]);
const remoteTag = run('git',['ls-remote',`git@github.com:${repo}.git`,`refs/tags/${tag}`]).split('\t')[0];
assert.equal(remoteTag,localTag,'Push and verify tag first; never move an existing tag');
assert.equal(run('git',['rev-parse','HEAD']), commit, 'Release exact validated checkout');
assert.equal(run('git',['status','--porcelain']), '', 'Release checkout must be clean');
run('git',['merge-base','--is-ancestor',commit,'origin/main']);
const checks = JSON.parse(run('gh',['api',`repos/${repo}/commits/${commit}/check-runs?per_page=100`]));
require('./release-gates.cjs').checkRuns(checks);
const pkg = JSON.parse(run('git',['show',`${commit}:${selected.path}/package.json`]));
assert.equal(tag,`${selected.name}/v${pkg.version}`);
const archive = path.resolve(archiveArg);
const filename = `${pkg.name.replace('@','').replace('/','-')}-${pkg.version}.tgz`;
assert.equal(path.basename(archive),filename);
const files = run('tar',['-tzf',archive]).split('\n');
const sourceFiles = run('git',['ls-tree','-r','--name-only',commit]).split('\n').filter(f => f.startsWith(selected.path + '/')).map(f => f.slice(selected.path.length + 1));
const expected = ['LICENSE','README.md','SECURITY.md','package.json',...sourceFiles.filter(f=>f.startsWith('nodes/'))];
assert.deepEqual(files.slice().sort(),expected.map(f=>`package/${f}`).sort());
for(const entry of files) {
  const bytes=cp.execFileSync('tar',['-xOzf',archive,entry]);
  assert.deepEqual(bytes,cp.execFileSync('git',['show',`${commit}:${selected.path}/${entry.slice(8)}`]),`Source mismatch: ${entry}`);
}
assert(fs.statSync(notes).isFile());
const hash = crypto.createHash('sha256').update(fs.readFileSync(archive)).digest('hex');
require('./release-gates.cjs').artifactHash(pkg, hash);
for (const mode of ['development','actionable','release']) cp.execFileSync(process.execPath, [path.join(__dirname,'audit.cjs'),mode], {stdio:'inherit', env:{...process.env,RELEASE_ARCHIVE:archive,EXPECTED_SHA256:hash}});
run('npm',['audit','signatures']);
const existing=cp.spawnSync('gh',['api',`repos/${repo}/releases/tags/${encodeURIComponent(tag)}`],{encoding:'utf8'});
assert(existing.status !== 0, 'Release already exists; inspect it, never overwrite');
assert(/HTTP 404/.test(existing.stderr),'Release absence not verified; stop on permissions/network errors');
const dir=fs.mkdtempSync(path.join(os.tmpdir(),'github-release-'));
try {
  const sums=path.join(dir,'SHA256SUMS');fs.writeFileSync(sums,`${hash}  ${filename}\n`);
  // One mutation only. An ambiguous failure requires manual remote inspection.
  run('gh',['release','create',tag,archive,sums,'--repo',repo,'--verify-tag','--target',commit,'--title',tag,'--notes-file',notes]);
  run('gh',['release','download',tag,'--repo',repo,'--dir',dir,'--pattern',filename]);
  const downloaded=crypto.createHash('sha256').update(fs.readFileSync(path.join(dir,filename))).digest('hex');
  assert.equal(downloaded,hash,'Uploaded asset integrity mismatch; do not replace automatically');
  const release=JSON.parse(run('gh',['api',`repos/${repo}/releases/tags/${encodeURIComponent(tag)}`]));
  assert.equal(release.tag_name,tag);assert(!release.draft);
  console.log(`Verified GitHub release ${release.html_url} at ${commit}; SHA-256 ${hash}`);
} finally {fs.rmSync(dir,{recursive:true,force:true});}
