# Custom Node-RED nodes

Packages are maintained independently under `packages/`; shared validation and release tools live under `tools/`, with guidance under `docs/`.

| Package | Version | Path |
| --- | --- | --- |
| node-red-contrib-debug-file | 0.2.0 | [Package documentation](packages/node-red-contrib-debug-file/README.md) |

Source history includes original commits f8d8a9f and f273237. Migration preserves every v0.2.0 tarball byte, including security fixes, and retains the original tests. Development dependencies are pinned separately in the private root manifest and lockfile. No npm or HAOS deployment is enabled.

Register future packages in `packages.json`, add their CI/audit matrix entries and Dependabot paths, then add an explicit publish input choice and protected per-package environment. Tags use `PACKAGE/vX.Y.Z`; versions, assets and approval environments are independent. See [publishing](docs/PUBLISHING.md).
