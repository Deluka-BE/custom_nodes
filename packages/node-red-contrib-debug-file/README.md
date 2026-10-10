# node-red-contrib-debug-file

A Debug-style Node-RED node with one append-only UTF-8 JSONL file per node.
Version 0.2.0 replaces the proposed legacy/sidecar design. No existing flows
require migration. No plain `.log` file is created.

After 0.2.3 is published, install it through **Menu → Manage palette** or run
`npm install node-red-contrib-debug-file@0.2.3` in your Node-RED user directory,
then restart Node-RED. If publication is pending, install the release tarball
with `npm install /path/to/node-red-contrib-debug-file-0.2.3.tgz` instead.
No deployed flows or HAOS installation are changed by this repository.

## Configuration

The editor defaults to `/share/nodered-logs/`, creating missing directories.
Directory inputs support strings, message properties, JSONata and environment
variables. Relative paths resolve against Node-RED's file working directory
or its process directory. Directory configuration is trusted administrator
configuration, not a payload confinement boundary. Avoid message-controlled
paths for untrusted input.

New palette nodes receive the first available visible name: `debug_file_01`,
`debug_file_02`, etc. This scans editor nodes, including other node types; deleted
names can be reused. No counter is stored. Existing v0.2.2 nodes retain their
names and `debug-<full SHA-256 of node ID>.log.jsonl` filenames, including after
renames, without migrating or touching their existing logs.

New nodes use `<safe-name>.log.jsonl`. A trailing `.log.jsonl`, `.jsonl`, or
`.log` is removed before the extension is added. Characters outside ASCII
letters, digits, `_` and `-` become `_`; the basename is capped at 80 characters
and falls back to `debug_file` if empty. For a visible filename collision, the
new/renamed node receives `-<full SHA-256 of its node ID>` before the extension.
That suffix remains stable after subsequent renames. Copies with new IDs reset
identity metadata. Imports/configuration that bypass editor collision selection
fail closed on an occupied filename rather than merge another node's log.

Changing a readable node's visible name selects a new destination. Old files
are never migrated, merged, renamed or removed. The obsolete `filenameHistory`
field is absent from editor defaults and ignored by both editor and runtime,
including when present in imported legacy flows. Deploy alone does not touch files. Restart appends to the current
target, and returning to a previous name may append only to that node's valid
own history. Unrelated directory entries and archives are never inspected.
A name changed by sanitization, extension removal or truncation receives an
additional full SHA-256 digest of the original visible name, so distinct visible
names that sanitize to the same basename still select different targets.
Legacy nodes retain their documented ID-based behavior.

Existing readable targets are fully streamed and every JSONL record must carry
the current node ID. Empty, malformed, mixed or foreign targets fail closed,
as do symlinks, hardlinks and nonregular files. Valid unterminated final records
receive a separator without rewriting historical bytes. Both fixed and dynamic
directories use the same verified append path; no directory-wide scan occurs.

One in-memory verification stamp per node records device/inode, size, nanosecond
mtime/ctime, link count, UID and mode. Each append reopens the target and checks
these fields. Unchanged, previously verified history is not rescanned; successful
own writes advance the stamp. External changes, rotation, restart or switching
to another inode require full validation. Failed writes invalidate the stamp.
This bounds cache memory and makes ordinary sequential logging linear in bytes
written after one historical scan. Alternating dynamic targets or repeated
external modifications can still cause repeated full scans; this is the safety
tradeoff rather than trusting unverified bytes. Secure directories against other
writers: filesystem metadata is not a cryptographic ownership proof, and
validation and append cannot be atomic against hostile same-user writers.

`readableFilename`, `filenameOwner`, and `filenameSuffix` are
ordinary flow configuration properties managed by the editor. Keep them when
exporting/importing flows. There is no separate persistent state or custom global
runtime registry. Node IDs must remain unique, as required by Node-RED.
There are no encoding, overwrite, newline or legacy sidecar controls.

Select a message property, complete message (`complete: "true"`), or JSONata
expression. Sidebar and bounded runtime-console output are optional. There
is no output port. `fileEnabled: false` disables file output while preserving
sidebar/console output. The node's native-style button toggles `active` and takes
effect immediately without Deploy: disabled nodes reject new inputs with
`DEBUG_FILE_DISABLED`, while accepted selections, directory evaluations and
queued writes finish. Toggling does not rename, delete, or truncate logs. Like
native Debug, successful toggles mark the flow dirty and enter undo history;
**Deploy saves the toggle state for restart**. Restart before Deploy restores
the last deployed state. Button errors restore the editor's prior toggle state.
The admin POST `/debug-file/:id/:state` accepts `enable` or `disable`, verifies
the node type, and uses Node-RED `RED.auth.needsPermission("debug.write")`, as
native Debug does. Configure Node-RED admin authentication to restrict access;
this package does not alter authentication or permissions.

## JSONL contract

Compatible with the personal-mcp-gateway v0.2.24 log reader. Configure its
allowlisted source to the actual generated filename; keep the MCP mount and
service access read-only. This node does not configure or grant MCP write
permissions.

```json
{"timestamp":"2026-10-08T12:00:00.000Z","nodeId":"n1","flowId":"f1","nodeName":"Debug n1","messageId":"m1","selectedProperty":"payload","targetType":"msg","serializedValue":"23.5","valueFormat":"legacy-text","truncated":false,"redacted":false,"writeResult":{"status":"written","stage":"write","code":null}}
```

Each record is one JSON line terminated by LF. An existing nonempty file
without a trailing LF receives a separator before the next record; historical
concatenated or partial records are preserved, not repaired. Existing logs must
be readable and writable by the Node-RED user for the verified tail check. Timestamp is captured at input.
Primitive metadata is capped at 256 UTF-16 units; other metadata becomes null.
Text remains text; objects are serialized as bounded JSON text; undefined and
bigint become text. Buffers use base64 with `valueFormat: "base64"`.
Object traversal caps depth at 10 and visits at most 2048 entries, skips getters
and toJSON, and represents cycles as `[Circular]`. Truncation may leave object
JSON text incomplete; the outer JSONL record remains valid.

`jsonlMaxValueBytes` defaults to 65536; valid integers range from 1 to 1048576.
Invalid settings fall back to the default. Unicode prefixes preserve complete
code points; base64 prefixes preserve complete groups. Escaped value strings
are additionally capped at 1 MiB so records remain inside gateway line bounds.
`truncated` marks omitted data. `jsonlRedactValue` omits `serializedValue`
without traversing the value. Sidebar output is independent; metadata remains
potentially sensitive. Base64 and truncation are not redaction.

## Filesystem safety and errors

Linux with `/proc/self/fd`, O_NOFOLLOW and O_DIRECTORY is required; other
platforms fail closed. Every directory is opened without following symlinks
and held by descriptor while accessing its child. Final symlinks, hardlinks,
nonregular files and files owned by another user are rejected. New files use
0644 and newly created directories 0755, including with restrictive umask.
Existing directories are not chmodded. Existing verified file descriptors are
chmodded only to remove permissions (mode AND 0644), never to grant access.
Existing 0600 files remain 0600: an administrator must separately arrange MCP
read access if needed. Permissions are changed only through verified handles,
never arbitrary payload paths. No mode 0777 is used. Secure directory ownership
and a separate read-only MCP identity/mount remain administrator responsibilities.

At most 128 events are outstanding per node. Queued events retain bounded
records rather than original payloads. Overflow, selection, serialization,
path and I/O errors complete with sanitized errors for Node-RED Catch nodes
and set red status. Errors exclude paths and payloads. Subsequent events can
continue after ordinary append I/O failures. Ownership failures leave the destination unchanged; later events revalidate
changed targets. There are no automatic mutation retries.
Close drains accepted events. Asynchronous JSONata
selection may complete out of arrival order. There are no automatic retries.
A stored `written` record means its append completed, not fsync durability.
Failed appends are reported through Catch/status, since a failed destination
cannot reliably store a failure record. Crashes can leave partial lines;
the gateway skips malformed lines. No rotation or retention is provided.
Bound upstream input and configure retention externally. Hostile JavaScript
proxies can execute traps during selection/traversal; flow code is trusted.

## Development and release

From the package directory, run `npm test` and `npm pack --dry-run` before release.
From the monorepo root, run `PACKAGE_NAME=node-red-contrib-debug-file node tools/verify-pack.cjs`
to verify the tarball allowlist and exact packed bytes. Regression tests cover
legacy behavior, naming/copies, full-content ownership/restart, occupied and
corrupt destinations, cache invalidation, rotation, async draining,
editor history/error handling, the protected route registration and real
Node-RED admin-route integration. Native behavior was inspected in Node-RED
5.0.8's `@node-red/nodes/core/common/21-debug.js` and `.html`; tests use that
installed runtime. No live HAOS deployment is part of verification.
The staging review compares the entire available suite with Git baseline
`5cf4811` (v0.2.2), and with the staging files before this review:

| Suite | Git baseline | Staging before review | Staging after review |
| --- | ---: | ---: | ---: |
| JSONL/runtime unit tests | 22 | 39 | 42 |
| Editor naming/toggle | 0 | 4 | 6 |
| Editor package version | 1 | 1 | 1 |
| Real Node-RED integration | 2 | 3 | 3 |
| Total | 26 | 47 | 52 |

All baseline scenarios remain: JSONL metadata and line boundaries; legacy
identity/restart/rename; rotation; permissions and umask; final/parent symlinks,
hardlinks, FIFO and directory rejection; error recovery and path evaluation;
dynamic directories and JSONata; bounded Unicode, Buffer and object serialization;
redaction/sidebar independence; queue overflow and close draining; editor controls;
package version export; and real runtime selection/JSONata integration.
The staging additions retain readable naming, copies and collisions, rename/return,
no migration or deploy-time writes, full-history ownership, verification-cache
invalidation, dynamic target switching, external rotation/replacement, exclusive
creation races, live toggles, asynchronous draining and admin-route integration.

The earlier reported 48-test version is not present in the available Git history
or staging files, so the specific deletion responsible for 48 becoming 47 cannot
be established from this copy. No baseline test was deleted. This review replaces
only the obsolete editor history-accumulation scenario with a multiple-rename
collision/owner regression, retaining the behavior that still matters. The two
old filename-history assertions (on a copy rename and on repeated renames) are
removed because that field is no longer managed. New regressions exercise
malformed legacy history in editor and runtime, normalized editor collisions,
large own histories above 5 MiB with foreign records beyond that boundary, and
readable parent-symlink/FIFO/directory rejection without permission changes.
There is no total-history size cap; the existing per-record bound remains.

The review leaves runtime safety checks unchanged: descriptor-relative directory
traversal, no-follow/exclusive opens, regular-file/link-count/UID checks before
chmod or append, permission tightening, full node-ID ownership validation and
metadata-based cache invalidation. Existing same-user validation/append races
remain possible; no locking system is introduced. These tests verify scenarios,
not complete branch coverage or atomicity against concurrent hostile writers.

The monorepo provides guarded publication tooling; see
[the publishing guide](../../docs/PUBLISHING.md). Publish only a new
version after tests and review, with authenticated npm access; never overwrite
an existing release. The release requires no live external-service writes.
See SECURITY.md for the security review and remaining limits.
