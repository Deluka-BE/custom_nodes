Bounded, secure JSONL debug logging for Node-RED.

- JSONL-only append logging with bounded serialization and queueing.
- Restrictive file permissions, symlink/hardlink rejection and payload redaction.
- Real Node-RED integration coverage; 21 baseline tests passed.

Original release source: f8d8a9f. All six tarball files match the migrated main package byte-for-byte. GitHub publication requires passing main CI, strict production and release-tooling audits, dependency signatures, source/package checks and the actionable development gate. The complete development audit remains visible under the temporary acceptance documented in docs/AUDIT.md.

SHA-256 (`node-red-contrib-debug-file-0.2.0.tgz`):
`d08bdbaa1156cc2bb3445408376c0b669658cf7491a46c24a3a94a1a513b4c5f`.

Install the attached tarball locally. npm v0.2.0 publication is pending verified
account ownership, explicit authorization, trusted publishing setup and security
gates. The existing npm name is already published at v0.1.0; no npm mutation
was performed for this GitHub release. See the packaged SECURITY.md for runtime limitations.
