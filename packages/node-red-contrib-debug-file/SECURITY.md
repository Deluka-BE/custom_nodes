# Security review for 0.2.3

Reviewed the JSONL-only write path, bounded serialization/queue, Node-RED editor,
and gateway v0.2.24 consumer contract. Tests cover final and parent symlinks,
hardlinks, nonregular files, permission tightening, restrictive umask, failure
recovery, Unicode/base64 truncation, escaping bounds, redaction and overflow.

Descriptor-relative Linux traversal prevents path substitution from redirecting
later operations through symlinks. File type/link-count/ownership checks precede
chmod and write. There is an unavoidable check-to-write interval in which a
privileged or same-user adversary could add a hardlink to the open inode.
Use directories controlled by the Node-RED user and deny other writers. Root
or same-process hostile code is outside this filesystem boundary. Existing
files are never granted new permissions. MCP write access is never configured;
use a separate read-only service identity or mount, especially if services
otherwise share a UID.

Value traversal and serialization are bounded, but upstream messages and
Node-RED sidebar encoding exist outside this queue's memory boundary. The queue
can retain up to roughly 128 MiB of escaped value text at the largest setting;
use the 64 KiB default or smaller limits on constrained hosts. JavaScript proxies
can execute traps; flow JavaScript and administrators are trusted. Disk growth
is unbounded without external retention. Writes are append-only and no retries
or durability guarantees are made. Regular filesystem writes can stall; no
unsafe retry or premature close is used after an ambiguous I/O outcome.

Readable naming is opt-in for new nodes; legacy hashed resources remain stable.
Filename basenames cannot contain separators, dots or NUL. Duplicate suffixes
use full node-ID SHA-256 digests and persist in flow configuration. Readable
appends verify every record of an existing destination, including after
external rotation. Empty pre-existing readable files fail closed. Legacy
append/tail behavior is unchanged.

Only the current target is opened; historical names and directory entries are
never scanned or mutated. Full ownership validation is cached in one per-node
stamp with device/inode, size, nanosecond mtime/ctime, link count, UID and mode.
Each append reopens with O_NOFOLLOW, rechecks file safety, and invalidates the
stamp on external changes. Validation checks metadata again before writing;
failed writes clear the cache. Own successful appends update it. This removes
quadratic historical reads for ordinary sequential logging, but alternating
dynamic targets and external writers can force rescans. Timestamp metadata is
not cryptographic authentication. Same-user or privileged concurrent writes
remain outside the boundary: there is no atomic validate-and-append primitive,
and concurrent same-size rewrites during our own write cannot be excluded.
Use administrator-controlled directories with no other writers. Logs still
require a full streaming scan on first append after restart, potentially delaying
large-log writes. No fsync, migration, cleanup or retention is provided.

Live toggle uses the native Debug permission `debug.write` on a Node-RED admin
POST route. Unknown states, absent nodes and other node types return 404.
Disabling blocks new events and drains accepted work; the deployed `active`
property determines restart behavior. No separate status storage is created.
Automated tests use temporary fixtures, fault injection and a local Node-RED
helper; they never write to HAOS or another external service.
