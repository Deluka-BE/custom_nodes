# Migration verification and blockers

Original commits f8d8a9f and f273237 remain ancestors of main. All ten migrated package files (including source, tests and lockfile) match f273237 byte-for-byte. Version 0.2.0 and its six-file npm tarball are preserved. Shared docs/tools/workflows are adapted separately.

Local verification: 21 package tests passed on Node 22 and 24; 16 mocked publishing guard tests passed; syntax/whitespace, actionlint 1.7.12 and gitleaks 8.30.1 history/source scans passed. npm 11.16.0 verified 587 signatures and 88 attestations. System npm 9 cannot verify expired registry keys; do not disable verification. Production audit: zero vulnerabilities. Full development audit: 24 findings (1 low, 5 moderate, 18 high). CI keeps the full high-severity gate. Resolve findings in a reviewed dependency update and repeat validation before releasing; do not waive this gate.

Local artifact SHA-256: d08bdbaa1156cc2bb3445408376c0b669658cf7491a46c24a3a94a1a513b4c5f. It matches the original release archive checksum.

GitHub repository is public and empty; account reports ADMIN, but its current fine-grained credential cannot push contents (403) or access Actions variables (403). Attempts to configure workflow defaults, secret scanning/push protection, Dependabot alerts and immutable tag rules also returned 403. No settings changed. npm gates default to disabled when absent. Existing default SSH identities failed public-key authentication; system SSH configuration also has an owner/permissions error. No private keys were generated or inspected.

User action: authorize custom_nodes in local GitHub authentication with Contents and Workflows write permissions, Administration write, Actions/Variables access, Environments write and required security permissions, or use an appropriately authorized identity. Never share the token. Then push main without force, configure protections, resolve audit findings and confirm actual GitHub CI check names. One required PR approval needs a second trusted collaborator.

No tag was pushed and no GitHub release was created. After audits and CI pass, separately inspect remote refs/releases, create a new node-red-contrib-debug-file/v0.2.0 tag at the reviewed migration commit only if package bytes remain unchanged, push once, then use the guarded release helper with the verified archive. If package runtime/manifest bytes change, use a new version. npm publication and HAOS deployment remain outside authorization.
