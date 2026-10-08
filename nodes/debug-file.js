"use strict";
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const C = fs.constants;
const fsp = fs.promises;
const MAX_QUEUE = 128;
function failure(code) { const err = new Error(code); err.code = code; return err; }
function metadata(value) {
    return ["string", "number", "boolean", "bigint"].includes(typeof value) ? String(value).slice(0, 256) : null;
}
function prefix(text, limit) {
    let end = 0, bytes = 0;
    while (end < text.length) {
        const cp = text.codePointAt(end), width = cp > 65535 ? 2 : 1;
        const size = cp <= 127 ? 1 : cp <= 2047 ? 2 : cp <= 65535 ? 3 : 4;
        if (bytes + size > limit) break;
        bytes += size; end += width;
    }
    return text.slice(0, end);
}
// Bounded traversal avoids toJSON/getters and caps depth, entries and strings.
function valueFields(value, limit, redacted) {
    const fields = { valueFormat: Buffer.isBuffer(value) ? "base64" : "legacy-text", truncated: false, redacted };
    if (redacted) return fields;
    let text;
    if (Buffer.isBuffer(value)) {
        const bytes = Math.min(value.length, Math.floor(limit / 4) * 3);
        text = value.subarray(0, bytes).toString("base64"); fields.truncated = bytes < value.length;
    } else if (typeof value === "string") { text = prefix(value, limit); fields.truncated = text.length < value.length; }
    else {
        let budget = limit, entries = 2048;
        const seen = new WeakSet();
        function visit(v, depth) {
            if (--entries < 0 || depth > 10 || budget <= 0) { fields.truncated = true; return "[Truncated]"; }
            if (typeof v === "string") { const s = prefix(v, budget); budget -= Buffer.byteLength(s); if (s.length < v.length) fields.truncated = true; return s; }
            if (v === null || typeof v === "number" || typeof v === "boolean") return v;
            if (typeof v === "function") return "[Function]";
            if (typeof v === "symbol") return "[Symbol]";
            if (typeof v !== "object") return String(v);
            if (seen.has(v)) return "[Circular]";
            seen.add(v);
            const result = Array.isArray(v) ? [] : Object.create(null);
            for (const key in v) {
                if (!Object.hasOwn(v, key)) continue;
                if (entries <= 0 || budget <= 0) { fields.truncated = true; break; }
                const desc = Object.getOwnPropertyDescriptor(v, key);
                const safeKey = prefix(key, Math.min(budget, 1024)); budget -= Buffer.byteLength(safeKey);
                if (safeKey !== key) fields.truncated = true;
                const item = desc && Object.hasOwn(desc, "value") ? visit(desc.value, depth + 1) : "[Accessor]";
                if (Array.isArray(result)) result.push(item); else result[safeKey] = item;
            }
            seen.delete(v); return result;
        }
        text = typeof value === "bigint" || value === undefined ? String(value) : JSON.stringify(visit(value, 0));
        const bounded = prefix(text, limit); if (bounded.length < text.length) fields.truncated = true; text = bounded;
    }
    // The gateway accepts lines up to 2 MiB + 64 KiB. Bound escaping too.
    if (Buffer.byteLength(JSON.stringify(text)) > 1048576) {
        let low = 0, high = Buffer.byteLength(text);
        while (low < high) { const mid = Math.ceil((low + high) / 2); if (Buffer.byteLength(JSON.stringify(prefix(text, mid))) <= 1048576) low = mid; else high = mid - 1; }
        text = prefix(text, low); fields.truncated = true;
    }
    fields.serializedValue = text; return fields;
}
// Linux descriptor-relative traversal pins every directory and rejects symlinks.
async function openDirectory(directory, create) {
    if (process.platform !== "linux" || !C.O_NOFOLLOW) throw failure("UNSUPPORTED_SAFE_OPEN");
    let handle = await fsp.open("/", C.O_RDONLY | C.O_DIRECTORY | C.O_NOFOLLOW);
    try {
        for (const part of path.resolve(directory).split(path.sep).filter(Boolean)) {
            const child = `/proc/self/fd/${handle.fd}/${part}`;
            let next;
            try { next = await fsp.open(child, C.O_RDONLY | C.O_DIRECTORY | C.O_NOFOLLOW); }
            catch (err) {
                if (err.code !== "ENOENT" || !create) throw err;
                let created = false;
                try { await fsp.mkdir(child, { mode: 0o755 }); created = true; } catch (mkdirError) { if (mkdirError.code !== "EEXIST") throw mkdirError; }
                next = await fsp.open(child, C.O_RDONLY | C.O_DIRECTORY | C.O_NOFOLLOW);
                if (created) await next.chmod(0o755);
            }
            await handle.close(); handle = next;
        }
        return handle;
    } catch (err) { await handle.close(); throw err; }
}
async function append(directory, filename, line, create) {
    const parent = await openDirectory(directory, create);
    let handle;
    try {
        const target = `/proc/self/fd/${parent.fd}/${filename}`;
        const flags = C.O_WRONLY | C.O_APPEND | C.O_NOFOLLOW | C.O_NONBLOCK;
        let created = false;
        try { handle = await fsp.open(target, flags | C.O_CREAT | C.O_EXCL, 0o644); created = true; }
        catch (err) { if (err.code !== "EEXIST") throw err; handle = await fsp.open(target, flags); }
        const stat = await handle.stat();
        if (!stat.isFile() || stat.nlink !== 1 || stat.uid !== process.getuid()) throw failure("UNSAFE_LOG_FILE");
        // Only this verified open inode is chmodded. Never grant permissions on an existing file.
        await handle.chmod(created ? 0o644 : (stat.mode & 0o644));
        await handle.writeFile(line, "utf8");
    } finally { if (handle) await handle.close(); await parent.close(); }
}
module.exports = function (RED) {
    function DebugFileNode(config) {
        RED.nodes.createNode(this, config);
        const node = this;
        node.name = config.name || `Debug ${node.id}`;
        node.complete = String(config.complete || "payload");
        node.targetType = config.targetType || "msg";
        const limit = Number(config.jsonlMaxValueBytes);
        const maxBytes = Number.isSafeInteger(limit) && limit >= 1 && limit <= 1048576 ? limit : 65536;
        const filename = `debug-${crypto.createHash("sha256").update(String(node.id)).digest("hex")}.log.jsonl`;
        const queue = [];
        let running = false, pending = 0, closing = false, closeDone;
        function report(err, done) {
            const safe = failure(`DEBUG_FILE_${/^[A-Z0-9_]+$/.test(err.code || "") ? err.code : "FAILED"}`);
            node.status({ fill: "red", shape: "ring", text: safe.code });
            done(safe);
        }
        function finishClose() { if (closing && !running && !pending && !queue.length && closeDone) { const cb = closeDone; closeDone = null; cb(); } }
        async function drain() {
            if (running) return;
            running = true;
            while (queue.length) {
                const event = queue.shift();
                try { await append(event.directory, filename, event.line, config.createDir !== false); node.status({ fill: "green", shape: "dot", text: "written" }); event.done(); }
                catch (err) { report(err, event.done); }
            }
            running = false; finishClose();
        }
        node.on("input", (msg, send, done) => {
            done = done || (err => { if (err) node.error(err); });
            if (closing) { report(failure("CLOSING"), done); return; }
            if (queue.length + pending + Number(running) >= MAX_QUEUE) { report(failure("QUEUE_FULL"), done); return; }
            pending++;
            const timestamp = new Date().toISOString();
            let settled = false;
            function selected(err, value) {
                if (settled) return; settled = true;
                if (err) { pending--; report(failure("SELECTION"), done); finishClose(); return; }
                try {
                    if (config.tosidebar !== false) RED.comms.publish("debug", RED.util.encodeObject({ id: node.id, z: node.z, name: node.name, topic: msg.topic, property: node.complete, msg: value }, { maxLength: RED.settings.debugMaxLength || 1000 }));
                    const fields = valueFields(value, maxBytes, config.jsonlRedactValue === true || config.jsonlRedactValue === "true");
                    if (config.console === true || config.console === "true") node.log(fields.serializedValue || "[Redacted]");
                    if (config.fileEnabled === false) { pending--; done(); finishClose(); return; }
                    const line = JSON.stringify({ timestamp, nodeId: metadata(node.id), flowId: metadata(node.z), nodeName: metadata(node.name), messageId: metadata(msg._msgid), selectedProperty: metadata(node.complete), targetType: metadata(node.targetType), ...fields, writeResult: { status: "written", stage: "write", code: null } }) + "\n";
                    RED.util.evaluateNodeProperty(config.directory === undefined ? "/share/nodered-logs/" : config.directory, config.directoryType || "str", node, msg, (pathError, directory) => {
                        pending--;
                        if (pathError || typeof directory !== "string" || !directory || directory.includes("\0")) { report(failure("DIRECTORY"), done); finishClose(); return; }
                        queue.push({ directory: path.resolve(RED.settings.fileWorkingDirectory || process.cwd(), directory), line, done });
                        drain();
                    });
                } catch (error) { pending--; report(failure("SERIALIZATION"), done); finishClose(); }
            }
            try {
                if (node.targetType === "jsonata") RED.util.evaluateJSONataExpression(RED.util.prepareJSONataExpression(node.complete, node), msg, selected);
                else selected(null, node.complete === "true" ? msg : RED.util.getMessageProperty(msg, node.complete));
            } catch (err) { selected(err); }
        });
        node.on("close", done => { closing = true; closeDone = done; finishClose(); });
    }
    RED.nodes.registerType("debug-file", DebugFileNode);
};
