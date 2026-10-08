# Reusable Deluka-BE Node-RED publishing foundation

## Current authorization and release boundary

Only creation of the public GitHub repository and GitHub release v0.2.0 is
currently authorized. npm publication is NOT authorized or configured.
The immutable v0.2.0 tag belongs at f8d8a9f; foundation changes belong on main.
The existing archive has SHA-256:
`d08bdbaa1156cc2bb3445408376c0b669658cf7491a46c24a3a94a1a513b4c5f`.
All six archive files were verified byte-for-byte against that commit.

The public npm name already exists at 0.1.0 with maintainer `deluka`.
Local npm authentication was absent. Matching a similar GitHub username is
not proof of npm ownership. Never overwrite, transfer, deprecate, or unpublish
that package without separate verified authorization.

## Copy this foundation to another node

Copy `.github/workflows/`, `.github/dependabot.yml`, `.github/CODEOWNERS`, and
`tools/` from the reviewed foundation commit. These files are the reusable
template; no installed skill is required. Change CODEOWNERS to trusted maintainers.
Use the target repository's authoritative main branch and review its guardrails.
Keep tools, docs, tests, dependencies, and CI files excluded from npm packaging.
Adapt the explicit allowlist in verify-pack.cjs for deliberate additional assets
such as examples, locales or icons. Do not broaden it to include arbitrary files. Future tags must contain these
workflows/tools; the publishing workflow is intentionally not a workflow_call
wrapper because npm must trust the exact workflow filename in each repository.

The Node-RED package must have a meaningful description, license, `node-red`
keyword, and a `node-red.nodes` mapping to runtime JS with paired editor HTML.
Use a suitable `node-red-contrib-*` name (scoped names need separate namespace
ownership checks), document requirements in engines, and include README/LICENSE.
See https://nodered.org/docs/creating-nodes/packaging .
For a FUTURE release, add these manifest fields, substituting the real repository:

```json
{
  "repository": {
    "type": "git",
    "url": "git+https://github.com/Deluka-BE/PACKAGE.git"
  },
  "homepage": "https://github.com/Deluka-BE/PACKAGE#readme",
  "bugs": { "url": "https://github.com/Deluka-BE/PACKAGE/issues" },
  "publishConfig": { "access": "public", "registry": "https://registry.npmjs.org" }
}
```

Do not retroactively add this to v0.2.0: provenance requires matching repository
metadata, and immutable release source/assets cannot be rewritten. Choose a new
version with separate release authorization after configuration is complete.

CI runs tests on Node 22 and 24 plus 16 mocked publishing guard tests, JS syntax and conservative whitespace checks,
pack allowlist and byte verification, full high/critical dependency audit,
registry signature verification, actionlint, redacted gitleaks history/source
scanning, CodeQL and PR dependency review. Install scripts are disabled.
No formatter is imposed on the existing source; future projects can add their
chosen formatter/linter to CI. Node 18 is declared by the historical package
but is end-of-life; this foundation validates supported 22/24. Reassess supported
engines and Node-RED peer/runtime versions for future releases.

Refresh dependencies through reviewed PRs. The baseline development tree had
35 findings (one critical); compatible lockfile updates reduced this to 24 (18 high), but do
not waive the remaining audit failures. Production dependencies had no findings.
Modern npm 11.16.0 verified 587 registry signatures and 88 attestations.
Local npm 9 fails on an expired registry key; do not disable verification.
Pinned actions and downloaded tool SHA-256 hashes must be reviewed together;
Dependabot updates action/dependency pins, while binary pins need manual updates.
Never run untrusted PR code with publish credentials or pull_request_target.

## Secure npm account setup (user action)

1. Sign in to npmjs.com yourself and verify ownership of `deluka` and the
   existing package, or select a new available name/owned scope. Verify your
   email and use a unique password plus a hardware security key/passkey 2FA.
   Save recovery codes privately; never send tokens or codes to an agent.
2. Use current Node/npm (OIDC needs npm >=11.5.1 and Node >=22.14.0).
   If local verification is needed, use interactive `npm login`, then `npm whoami`
   and `npm owner ls PACKAGE` against the public registry. Never cat npmrc,
   print config/auth environment, or commit login material. The detected local
   npm 9.2.0 is too old for trusted publishing.
3. In the existing package's npm settings, configure GitHub trusted publisher:
   owner `Deluka-BE`, repository `node-red-contrib-debug-file`, filename
   `publish.yml`, environment `npm-publish`. Match case exactly. Permit direct
   publishing only if explicitly authorized; do not grant dist-tag management
   unless needed. Require 2FA for settings/manual publishing, disallow token
   publishing where supported, and review/revoke old tokens yourself.
4. A new package requires separate bootstrap authorization after ownership/name
   verification. The workflow fails closed for missing packages; no automatic
   bootstrap or token fallback is provided. Use npm's supported first-package
   process interactively, then configure trusted publishing.
5. Configure GitHub protections below, verify them, then set repository variable
   `NPM_OWNER` to the verified npm maintainer. Leave `NPM_PUBLISH_ENABLED` unset
   until ownership, trusted publishing, audits, and publication authorization
   are all complete. There must be no NPM_TOKEN/NODE_AUTH_TOKEN secrets.

Reference: https://docs.npmjs.com/trusted-publishers/ . Trusted publishing uses
GitHub-hosted runners and automatically supports provenance for public packages
from public repositories. Validation runs in a read-only job without OIDC permission. Only the approved
publish job requests an OIDC token, and it installs no project dependencies.
This workflow requests provenance explicitly and
never uses a static npm token or automatic mutation retry.

## GitHub protection setup

Run `node tools/configure-github.cjs OWNER/REPO REVIEWER_LOGIN` only with repository
admin authorization. It leaves publishing disabled. Inspect the results in
Settings: API/plan restrictions must be reported rather than ignored.
The script configures read-only default workflow permissions, PR/check protected
main, immutable v* tags without bypass actors, environment approval and release-tag-only
deployments, secret scanning/push protection, and Dependabot vulnerability alerts.

One PR approval requires another trusted collaborator; an owner cannot approve
their own PR. The environment requires an explicit reviewer approval but allows
self-review for a solo maintainer. Add a second trusted reviewer and enable
prevent_self_review for independent separation of duties. No admin bypass is
provided for main or tag immutability. Required checks are bound to the verified GitHub Actions app (15368) so other
writers cannot satisfy them with arbitrary status updates. Status names must be confirmed
against real CI runs before enforcing them on an existing busy repository.

Public-repository protections are normally available, but account plan,
permissions, organization policy, and Advanced Security settings can restrict
features. Never silently substitute unprotected publishing. The publish preflight
also verifies reviewer protection and the no-bypass immutable tag rule at runtime.

## Release and publication procedure

1. Get explicit authorization for the particular release/version. Ensure clean
   main, correct metadata/version and lockfile, tests and every security check
   green. Confirm npm owner/scope and absence of the exact version via successful
   registry response. Network or auth errors never mean a name/version is free.
2. Pack with `npm pack --ignore-scripts`, verify allowlist and bytes, test the
   packed artifact in a temporary Node-RED fixture, record SHA-256. Create a new
   tag once, push main and tag without force, and confirm remote commit identity.
3. Create the GitHub release with `node tools/release-github.cjs OWNER/REPO TAG ARCHIVE NOTES`
   and the verified archive/checksum asset. Download assets again and verify hash.
   Never use `--clobber`, delete/recreate a release, or move an existing tag.
4. After separate npm publication authorization and setup, enable the repository
   variable and dispatch `Publish npm (explicit approval)` from the release tag with exact
   tag and package name. A reviewer approves the npm-publish environment after reviewing the tag commit.
   Dispatch on the tag keeps OIDC/provenance source identity equal to the release
   commit; the workflow rejects dispatch from main. The v0.2.0 baseline has no
   publishing workflow, so it cannot be dispatched for npm publication. Preflight
   rejects missing/reused versions, draft releases, non-main ancestry, missing
   repository metadata, absent owner, unsafe lifecycle scripts or tag protection.
   The packed contents must match the corresponding GitHub release archive.
5. Verify npm name/version, integrity, provenance and clean-user-dir Node-RED
   install. Submit to https://flows.nodered.org/add/node after npm publication.
   Disable the publishing variable after use when releases are infrequent.
   If publishing ends ambiguously, inspect the registry/provenance before any
   further attempt. Never automatically retry an npm mutation.

## Recovery when GitHub creation is blocked

The current gh credential returned 403 / Resource not accessible by personal
access token for repository creation. The user must create the empty public repo
or update local GitHub auth themselves with repository creation/admin, content
write, and workflow permissions; do not send credentials. Then:

```sh
git push -u origin main
git push origin v0.2.0
node tools/configure-github.cjs Deluka-BE/node-red-contrib-debug-file Deluka-BE
node tools/release-github.cjs Deluka-BE/node-red-contrib-debug-file v0.2.0 \
  node-red-contrib-debug-file-0.2.0.tgz docs/RELEASE-0.2.0.md
```

Before running recovery commands, check repository/tag/release state. Stop if
an existing remote tag or release conflicts; do not overwrite it.
