# node-red-contrib-debug-file

A Debug-style node that can show a selected message value in the Debug sidebar and write that same value to a log file. It has no output, so it can be attached to a flow exactly like the built-in Debug node.

## Features

- Debug sidebar and runtime-log output can remain enabled independently.
- The file name is automatically derived from the node name: `My debug` becomes `My debug.log`.
- A path can be static, `msg`, JSONata or an environment variable.
- Append or overwrite; optional newline and automatic directory creation.
- Same encoding set as the built-in Write File node, including `set by msg.encoding`.
- Serialises objects as JSON and preserves Buffers when encoding is `none`.

## Install

After publication to npm, open **Menu → Manage palette → Install**, search for `node-red-contrib-debug-file`, install it, then restart Node-RED if requested.

For a local preview, use **Manage palette → Install → upload** and select the packed `.tgz` file.

## Notes

This is a new `debug file` node. Node-RED does not allow an add-on to insert fields into the edit dialog of the built-in `debug` node safely, so the core node stays untouched.

The filename is sanitised on every platform and defaults to `debug.log` when the node has no name. For a separate file per logger, give each node a unique name.

## License

MIT
