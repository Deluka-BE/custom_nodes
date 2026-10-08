'use strict';
// Run outside npm scripts: release tools never load the development runtime.
const assert = require('node:assert/strict');
const cp = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const {validReport, actionable} = require('./audit-policy.cjs');
const root = path.resolve(__dirname, '..');
const out = path.join(root, 'audit-reports');
fs.mkdirSync(out, {recursive:true});
function run(args, cwd) {
  return cp.execFileSync('npm', args, {cwd, stdio:'inherit', env:{...process.env, NODE_PATH:''}});
}
function audit(name, cwd, extra = []) {
  const result = cp.spawnSync('npm', ['audit', '--json', '--audit-level=low', ...extra], {cwd, encoding:'utf8'});
  fs.writeFileSync(path.join(out, `${name}.json`), result.stdout || '{}');
  process.stdout.write(result.stdout || 'Audit produced no report\n');
  assert(!result.error && [0, 1].includes(result.status), 'Audit execution failed');
  const report = JSON.parse(result.stdout);
  validReport(report);
  return report;
}
const mode = process.argv[2];
if (mode === 'development') {
  const report = audit('development', root);
  const message = `Full development audit: ${report.metadata.vulnerabilities.total} affected packages (monitored report; see docs/AUDIT.md)`;
  console.log(message);
  if (process.env.GITHUB_STEP_SUMMARY) fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, `### Full development audit\n\n${message}\n\n\`\`\`json\n${JSON.stringify(report, null, 2)}\n\`\`\`\n`);
  if (report.metadata.vulnerabilities.total) console.log(`::warning::${message}`);
} else if (mode === 'actionable') {
  const manifest = require('../package.json');
  assert(manifest.private === true && !manifest.dependencies && !manifest.optionalDependencies && !manifest.scripts, 'Root must remain a private test-only harness');
  actionable(JSON.parse(fs.readFileSync(path.join(out, 'development.json'))), require('../package-lock.json'), require('../docs/dev-runtime-risk.json'));
  console.log('Actionable dependency gate passed; only reviewed test-runtime findings accepted');
} else if (mode === 'release') {
  const selected = require('./package.cjs')();
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'release-audit-'));
  try {
    const archive = process.env.RELEASE_ARCHIVE || (() => {
      const [pack] = JSON.parse(cp.execFileSync('npm', ['pack', '--ignore-scripts', '--json', '--pack-destination', dir], {cwd:selected.directory, encoding:'utf8'}));
      return path.join(dir, pack.filename);
    })();
    // Check every archive file against source before installing the actual artifact.
    cp.execFileSync(process.execPath, [path.join(__dirname, 'verify-pack.cjs')], {cwd:root, stdio:'inherit', env:{...process.env, RELEASE_ARCHIVE:archive}});
    const hash = crypto.createHash('sha256').update(fs.readFileSync(archive)).digest('hex');
    if (process.env.EXPECTED_SHA256) assert.equal(hash, process.env.EXPECTED_SHA256, 'Release hash changed');
    fs.writeFileSync(path.join(out, 'artifact.json'), JSON.stringify({sha256:hash, package:selected.name}) + '\n');
    fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({name:'production-artifact-audit', version:'1.0.0', private:true, dependencies:{[selected.name]:`file:${path.resolve(archive)}`}}));
    run(['install', '--ignore-scripts', '--omit=dev', '--no-audit', '--no-fund'], dir);
    assert.equal(audit('production', dir, ['--omit=dev']).metadata.vulnerabilities.total, 0, 'Production findings block release');
    const lock = JSON.parse(fs.readFileSync(path.join(dir, 'package-lock.json')));
    if (Object.values(lock.packages).some(p => /^https:/.test(p.resolved || ''))) run(['audit', 'signatures'], dir);
    else console.log('Production signature check: local artifact only; no registry dependencies');
    // Full tooling audit, including development/build dependencies: no omit or exceptions.
    const tooling = path.join(root, 'tools/release-tooling');
    run(['ci', '--ignore-scripts', '--no-audit', '--no-fund'], tooling);
    assert.equal(audit('release-tooling', tooling).metadata.vulnerabilities.total, 0, 'Release tooling findings block release');
    const toolsLock = JSON.parse(fs.readFileSync(path.join(tooling, 'package-lock.json')));
    if (Object.keys(toolsLock.packages).length > 1) run(['audit', 'signatures'], tooling);
    else console.log('Release tooling signature check: dependency-free Node builtins');
  } finally { fs.rmSync(dir, {recursive:true, force:true}); }
} else throw new Error('Use development, actionable or release');
