# Audit boundaries and temporary runtime risk acceptance

Accepted by Deluka-BE through the explicit audit-separation task on 2026-10-08;
owner: Deluka-BE. Review weekly and expire on 2026-11-08 (UTC). Expiration
blocks release until the owner reviews upstream fixes and explicitly renews or
removes acceptance. The machine-readable scope is docs/dev-runtime-risk.json.

The private root lockfile installs Mocha, Node-RED and its test helper only for
mock/local integration tests. Five affected packages are inside the immutable
npm@11.21.0 bundle shipped by @node-red/registry: brace-expansion 5.0.9,
http-cache-semantics 4.2.0, undici 6.28.0, ip-address 10.5.0, and
postcss-selector-parser 7.1.4. npm audit fix cannot replace files within that
bundle; update Node-RED/registry to an upstream fixed bundle when available.
Do not patch installed files, override audit output, or disable dependency scans.

This accepts the documented denial-of-service, cache disclosure, response
splitting and address-classification risks only in the ephemeral test runtime.
CI tests use local fixtures, no production credentials, no exposed Node-RED
editor or palette installation. PR workflows have read-only permissions and no
secrets. Do not use this harness for deployment, packaging or publication.
Node-RED is a consumer-provided peer runtime, not shipped in our tarball; this
acceptance makes no safety claim about users' separately installed runtimes.

Full development audit JSON and GitHub summary retain every finding. Findings
are non-blocking in that report; audit execution/registry/schema errors block.
A separate mandatory actionable gate rejects any new package, path, advisory,
version, severity escalation or loss of dev-only bundled isolation. Accepted
findings are never removed from the report. Full dependency signature validation
remains mandatory, including development dependencies.

Production audit installs the actual allowlisted tarball into a fresh temporary
consumer project with scripts disabled and dev dependencies omitted. It audits
all installed production/optional dependencies at every severity, without any
risk exceptions. The package's historical devDependency ranges are metadata,
not consumer-installed dependencies. verify-pack checks every file byte against
source; audit evidence records the artifact SHA256. For v0.2.0 the existing
six-file artifact and SHA256 must remain unchanged.

Release tools use Node builtins and external Node/npm, git, gh and tar commands;
they never import the root test runtime. tools/release-tooling declares the
separate private build dependency graph; its complete audit (including future
dev/build dependencies) blocks on every finding. Import-boundary tests reject
external runtime imports; any new build dependency must be declared there and
retain strict audit/signature gates. Node/npm are runner tooling supplied by
setup-node, independently of Node-RED's nested bundled npm. Workflow actions
are SHA-pinned; actionlint and gitleaks downloads have verified SHA256. Production
and build graphs with registry dependencies must pass signature checks.

CI runs the full report, actionable gate, production and tooling audits every
Monday at 06:19 UTC and on pushes/PRs. Evidence is retained as Actions artifacts
and summaries. Deluka-BE reviews these weekly alongside Dependabot alerts,
checks upstream Node-RED/registry releases, and removes acceptance once fixed.
An unavailable scanner, new finding, invalid signature or expired acceptance
blocks mandatory gates. Scheduled runs are observable in Actions; failure must
be triaged by the owner. No npm publication is authorized by this change.
