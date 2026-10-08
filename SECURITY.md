# Security review for 0.2.0

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
