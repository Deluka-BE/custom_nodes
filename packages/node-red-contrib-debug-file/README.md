# node-red-contrib-debug-file

A Debug-style Node-RED node with one append-only UTF-8 JSONL file per node.
Version 0.2.0 replaces the proposed legacy/sidecar design. No existing flows
require migration. No plain `.log` file is created.

After 0.2.2 is published, install it through **Menu → Manage palette** or run
`npm install node-red-contrib-debug-file@0.2.2` in your Node-RED user directory,
then restart Node-RED. If publication is pending, install the release tarball
with `npm install /path/to/node-red-contrib-debug-file-0.2.2.tgz` instead.
No deployed flows or HAOS installation are changed by this repository.

## Configuration

The editor defaults to `/share/nodered-logs/`, creating missing directories.
Directory inputs support strings, message properties, JSONata and environment
variables. Relative paths resolve against Node-RED's file working directory
or its process directory. Directory configuration is trusted administrator
configuration, not a payload confinement boundary. Avoid message-controlled
paths for untrusted input.

New nodes receive `Debug <node ID>` display names. Files are always named
`debug-<full SHA-256 of node ID>.log.jsonl`. Identical display names do not
collide; renaming a node preserves its file across restarts. Copying a node
with a new Node-RED ID creates a separate file. Node IDs must be unique, as
required by Node-RED. Extensions in display names never affect filenames.
Changing directories intentionally changes the destination. There are no
encoding, overwrite, newline or legacy sidecar controls.

Select a message property, complete message (`complete: "true"`), or JSONata
expression. Sidebar and bounded runtime-console output are optional. There
is no output port. `fileEnabled: false` disables file output.

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
continue after I/O failure. Close drains accepted events. Asynchronous JSONata
selection may complete out of arrival order. There are no automatic retries.
A stored `written` record means its append completed, not fsync durability.
Failed appends are reported through Catch/status, since a failed destination
cannot reliably store a failure record. Crashes can leave partial lines;
the gateway skips malformed lines. No rotation or retention is provided.
Bound upstream input and configure retention externally. Hostile JavaScript
proxies can execute traps during selection/traversal; flow code is trusted.

## Development and release

Run `npm test` and `npm pack --dry-run` before release. The monorepo provides guarded publication tooling; see
[the publishing guide](../../docs/PUBLISHING.md). Publish only a new
version after tests and review, with authenticated npm access; never overwrite
an existing release. The release requires no live external-service writes.
See SECURITY.md for the security review and remaining limits.
