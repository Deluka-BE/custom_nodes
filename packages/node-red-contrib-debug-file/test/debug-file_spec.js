const assert = require("assert");
const fs = require("fs").promises;
const os = require("os");
const path = require("path");
const crypto = require("crypto");
const EventEmitter = require("events");
const register = require("../nodes/debug-file");
const filename = id => `debug-${crypto.createHash("sha256").update(id).digest("hex")}.log.jsonl`;
describe("JSONL debug file", function() {
    let dir, Node, nodes, settings, published, route, permission;
    beforeEach(async function() {
        dir = await fs.mkdtemp(path.join(os.tmpdir(), "debug-jsonl-")); nodes = []; settings = {}; published = [];
        register({ settings, httpAdmin: { post(url, auth, handler) { route = handler; } }, auth: { needsPermission(p) { permission = p; return () => {}; } }, nodes: {
            getNode(id) { return nodes.find(n => n.id === id); },
            createNode(node, config) {
                Object.setPrototypeOf(Node.prototype, EventEmitter.prototype); EventEmitter.call(node);
                node.type = "debug-file"; node.id = config.id || "n1"; node.z = "flow1"; node.status = s => node.lastStatus = s;
                node.error = e => { node.lastError = e; }; node.log = s => { node.lastLog = s; };
            }, registerType(type, constructor) { Node = constructor; }
        }, util: {
            getMessageProperty(msg, prop) { return msg[prop]; },
            evaluateNodeProperty(v, type, node, msg, cb) { if (type === "delayed") { settings.directoryCallback = () => cb(null, v); return; } if (type === "bad") cb(new Error("secret")); else cb(null, type === "msg" ? msg[v] : v); },
            prepareJSONataExpression(v) { return v; }, evaluateJSONataExpression(v, msg, cb) { if (v === "delayed") settings.selectionCallback = () => cb(null, msg.payload); else cb(null, msg.payload * 2); },
            encodeObject(v) { return v; }
        }, comms: { publish(topic, v) { published.push(v); } } });
    });
    afterEach(async function() { for (const node of nodes) await new Promise(resolve => node.emit("close", resolve)); await fs.rm(dir, { recursive: true, force: true }); });
    function make(config = {}) { const n = new Node({ directory: dir, tosidebar: false, ...config }); nodes.push(n); return n; }
    function input(n, payload, extra = {}) { return new Promise(resolve => n.emit("input", { payload, _msgid: "m1", ...extra }, null, resolve)); }
    async function records(id = "n1", directory = dir) { return (await fs.readFile(path.join(directory, filename(id)), "utf8")).trim().split("\n").map(JSON.parse); }
    it("defaults to exactly one JSONL file and compatible metadata", async function() {
        const n = make(); assert.equal(await input(n, { a: 1 }), undefined);
        assert.deepEqual(await fs.readdir(dir), [filename("n1")]);
        const [r] = await records(); assert.equal(r.serializedValue, '{"a":1}'); assert.equal(r.nodeName, "Debug n1");
        assert.equal(new Date(r.timestamp).toISOString(), r.timestamp);
        assert.deepEqual(r.writeResult, { status: "written", stage: "write", code: null });
        assert.equal(r.nodeId, "n1"); assert.equal(r.flowId, "flow1"); assert.equal(r.messageId, "m1");
        assert.equal(r.truncated, false); assert.equal(r.redacted, false);
    });
    it("writes two consecutive messages as exactly two independently parseable LF-terminated lines", async function() {
        const n = make();
        assert.deepEqual(await Promise.all([input(n, { mac: "one" }), input(n, { mac: "two" })]), [undefined, undefined]);
        const text = await fs.readFile(path.join(dir, filename("n1")), "utf8");
        const lines = text.split("\n");
        assert.equal(lines.length, 3); assert.equal(lines.pop(), "");
        assert.deepEqual(lines.map(line => JSON.parse(JSON.parse(line).serializedValue)), [{ mac: "one" }, { mac: "two" }]);
    });
    it("separates an existing unterminated record without rewriting historical bytes", async function() {
        const f = path.join(dir, filename("n1"));
        const original = '{"mac":"old"}'; await fs.writeFile(f, original);
        const n = make(); await input(n, "new"); await input(n, "next");
        const text = await fs.readFile(f, "utf8");
        assert(text.startsWith(original + "\n"));
        const lines = text.split("\n"); assert.equal(lines.pop(), "");
        assert.equal(lines.length, 3); lines.forEach(line => JSON.parse(line));
    });
    it("reopens the destination after external rotation", async function() {
        const n = make(); await input(n, "before");
        const f = path.join(dir, filename("n1")); await fs.rename(f, f + ".1");
        await input(n, "after");
        assert.equal(JSON.parse(await fs.readFile(f + ".1", "utf8")).serializedValue, "before");
        assert.deepEqual((await records()).map(r => r.serializedValue), ["after"]);
    });
    it("keeps identity across restart and rename; equal names never collide or double extensions", async function() {
        await input(make({ name: "Same.log.jsonl" }), "one");
        await input(make({ name: "Same.log.jsonl", id: "n2" }), "two");
        await input(make({ name: "Renamed" }), "three");
        assert.equal((await fs.readdir(dir)).length, 2); assert.deepEqual((await records()).map(r => r.serializedValue), ["one", "three"]);
    });
    it("creates exact safe file/directory permissions despite restrictive umask", async function() {
        const previous = process.umask(0o077);
        try { await input(make({ directory: path.join(dir, "new", "nested") }), 1); }
        finally { process.umask(previous); }
        assert.equal((await fs.stat(path.join(dir, "new"))).mode & 0o777, 0o755);
        assert.equal((await fs.stat(path.join(dir, "new", "nested", filename("n1")))).mode & 0o777, 0o644);
    });
    it("only tightens existing verified files and never broadens restrictive modes", async function() {
        const f = path.join(dir, filename("n1")); await fs.writeFile(f, ""); await fs.chmod(f, 0o666);
        await input(make(), 1); assert.equal((await fs.stat(f)).mode & 0o777, 0o644);
        await fs.chmod(f, 0o600); await input(make(), 2); assert.equal((await fs.stat(f)).mode & 0o777, 0o600);
    });
    it("rejects final symlinks without writing or chmodding their target", async function() {
        const target = path.join(dir, "target"); await fs.writeFile(target, "untouched"); await fs.chmod(target, 0o600);
        await fs.symlink(target, path.join(dir, filename("n1")));
        assert(await input(make(), "secret")); assert.equal(await fs.readFile(target, "utf8"), "untouched"); assert.equal((await fs.stat(target)).mode & 0o777, 0o600);
    });
    it("rejects parent symlinks", async function() {
        await fs.mkdir(path.join(dir, "real")); await fs.symlink(path.join(dir, "real"), path.join(dir, "link"));
        assert(await input(make({ directory: path.join(dir, "link") }), 1)); assert.deepEqual(await fs.readdir(path.join(dir, "real")), []);
    });
    it("rejects hardlinks before chmod or append", async function() {
        const target = path.join(dir, "target"); await fs.writeFile(target, "safe"); await fs.chmod(target, 0o600);
        await fs.link(target, path.join(dir, filename("n1"))); assert(await input(make(), 1));
        assert.equal(await fs.readFile(target, "utf8"), "safe"); assert.equal((await fs.stat(target)).mode & 0o777, 0o600);
    });
    it("rejects FIFOs without hanging or chmodding", async function() {
        const fifo = path.join(dir, filename("n1"));
        require("child_process").execFileSync("mkfifo", ["-m", "600", fifo]);
        assert(await input(make(), 1)); assert.equal((await fs.stat(fifo)).mode & 0o777, 0o600);
    });
    it("rejects nonregular destinations", async function() {
        await fs.mkdir(path.join(dir, filename("n1"))); assert(await input(make(), 1));
    });
    it("reports safe errors and continues after failure", async function() {
        const missing = path.join(dir, "missing"); const n = make({ directory: missing, createDir: false });
        const err = await input(n, "private"); assert.equal(err.message, "DEBUG_FILE_ENOENT"); assert(!err.message.includes(dir));
        await fs.mkdir(missing); assert.equal(await input(n, 2), undefined); assert.equal((await records("n1", missing)).length, 1);
    });
    it("handles path evaluation failures and disabled output", async function() {
        assert.equal((await input(make({ directoryType: "bad" }), 1)).code, "DEBUG_FILE_DIRECTORY");
        await input(make({ fileEnabled: false }), 1); assert.deepEqual(await fs.readdir(dir), []);
    });
    it("resolves dynamic directories and JSONata selection", async function() {
        await input(make({ directory: "folder", directoryType: "msg", targetType: "jsonata" }), 3, { folder: dir });
        assert.equal((await records())[0].serializedValue, "6");
    });
    it("bounds unicode without splitting code points", async function() {
        await input(make({ jsonlMaxValueBytes: 5 }), "😀éx"); const [r] = await records(); assert.equal(r.serializedValue, "😀"); assert(r.truncated);
    });
    it("stores bounded decodable Buffer prefixes", async function() {
        await input(make({ jsonlMaxValueBytes: 4 }), Buffer.from([0, 1, 2, 3])); const [r] = await records();
        assert.equal(r.valueFormat, "base64"); assert.equal(r.serializedValue, "AAEC"); assert(r.truncated);
    });
    it("handles cycles, bigint, undefined and skips getters/toJSON", async function() {
        const v = { toJSON() { throw Error("should not call"); }, get secret() { throw Error("should not call"); } }; v.self = v;
        const n = make(); for (const item of [v, 12n, undefined]) assert.equal(await input(n, item), undefined);
        const r = await records(); assert(r[0].serializedValue.includes("[Circular]")); assert(r[0].serializedValue.includes("[Accessor]")); assert.equal(r[1].serializedValue, "12"); assert.equal(r[2].serializedValue, "undefined");
    });
    it("bounds object traversal, escaped lines, metadata and default invalid limits", async function() {
        const n = make({ jsonlMaxValueBytes: 1048576 }); await input(n, "\0".repeat(1048576), { _msgid: "x".repeat(1000) });
        const r = (await records())[0]; assert(r.truncated); assert.equal(r.messageId.length, 256);
        assert((await fs.stat(path.join(dir, filename("n1")))).size < 2 * 1048576 + 65536);
        await input(make({ id: "n2", jsonlMaxValueBytes: -1 }), "x".repeat(100000)); assert.equal((await records("n2"))[0].serializedValue.length, 65536);
        await input(make({ id: "n3" }), Array(100000).fill("x")); assert((await records("n3"))[0].truncated);
    });
    it("redacts without evaluating hostile payload and preserves sidebar independence", async function() {
        await input(make({ jsonlRedactValue: true, tosidebar: true }), new Proxy({}, { ownKeys() { throw Error("private"); } }));
        const [r] = await records(); assert(r.redacted); assert(!Object.hasOwn(r, "serializedValue")); assert.equal(published.length, 1);
    });
    it("caps outstanding events, drains on close, and reports overflow", async function() {
        const n = make(); const pending = Array.from({ length: 160 }, (_, i) => input(n, i));
        const closed = new Promise(resolve => n.emit("close", resolve)); const results = await Promise.all(pending); await closed;
        assert.equal(results.filter(Boolean).length, 32); assert(results.filter(Boolean).every(e => e.code === "DEBUG_FILE_QUEUE_FULL"));
        assert.equal((await records()).length, 128); assert.equal((await input(n, 1)).code, "DEBUG_FILE_CLOSING");
    });
    it("editor defaults and controls match the runtime", async function() {
        const vm = require("vm"); const html = await fs.readFile(path.join(__dirname, "../nodes/debug-file.html"), "utf8"); let editor; const a = { id: "a", type: "debug-file" }, b = { id: "b", type: "debug-file" };
        vm.runInNewContext(html.match(/<script type="text\/javascript">([\s\S]*?)<\/script>/)[1], { RED: { nodes: { eachNode(cb) { [a, b].filter(n => n.name).forEach(cb); }, registerType(t, v) { editor = v; } }, validators: { typedInput() { return () => true; } } } });
        assert.equal(editor.defaults.directory.value, "/share/nodered-logs/"); assert.equal(editor.defaults.createDir.value, true);
        editor.onadd.call(a); editor.onadd.call(b); assert.equal(a.name, "debug_file_01"); assert.equal(b.name, "debug_file_02");
        assert(!Object.hasOwn(editor.defaults, "jsonlEnabled")); assert(!Object.hasOwn(editor.defaults, "overwriteFile"));
    });
    function readable(name, extra = {}) { return make({ name, readableFilename: true, filenameOwner: "debug-file:n1", ...extra }); }
    function toggle(id, state) { let status; route({ params: { id, state } }, { sendStatus(code) { status = code; } }); return status; }
    it("creates a new target on rename, appends on restart and safely returns to an old name", async function() {
        await input(readable("alpha"), "before");
        const original = await fs.readFile(path.join(dir, "alpha.log.jsonl"));
        await input(readable("beta", { filenameHistory: ["alpha.log.jsonl"] }), "after");
        assert((await fs.readFile(path.join(dir, "alpha.log.jsonl"))).equals(original));
        await input(readable("beta"), "restart");
        assert.equal((await fs.readFile(path.join(dir, "beta.log.jsonl"), "utf8")).trim().split("\n").length, 2);
        await input(readable("alpha"), "return");
        assert((await fs.readFile(path.join(dir, "alpha.log.jsonl"))).subarray(0, original.length).equals(original));
        assert.deepEqual((await fs.readdir(dir)).sort(), ["alpha.log.jsonl", "beta.log.jsonl"]);
    });
    it("ignores corrupt, foreign and unsafe old history without directory scans or migration", async function() {
        await fs.writeFile(path.join(dir, "old.log.jsonl"), "corrupt");
        await fs.symlink("old.log.jsonl", path.join(dir, "alpha.log.jsonl"));
        const originals = { readdir: fs.readdir, link: fs.link, unlink: fs.unlink, rename: fs.rename };
        for (const key of Object.keys(originals)) fs[key] = async () => { throw Error("forbidden operation " + key); };
        try { assert.equal(await input(readable("beta", { filenameHistory: ["alpha.log.jsonl", "../invalid"] }), 2), undefined); }
        finally { Object.assign(fs, originals); }
        assert.equal(await fs.readFile(path.join(dir, "old.log.jsonl"), "utf8"), "corrupt");
    });
    it("keeps duplicate names isolated with stable suffixes and handles copies", async function() {
        await input(readable("same"), 1);
        await input(readable("same", { id: "n2", filenameOwner: "debug-file:n2", filenameSuffix: "id" }), 2);
        await input(readable("same", { id: "n2", filenameOwner: "debug-file:n2", filenameSuffix: "id" }), 3);
        assert.equal((await fs.readdir(dir)).length, 2);
        await input(readable("same", { id: "n3" }), 4);
        assert.equal((await fs.readdir(dir)).length, 3);
    });
    it("sanitizes names and prevents path traversal or extension duplication", async function() {
        await input(readable("../../nice.log.jsonl"), 1);
        assert.match((await fs.readdir(dir))[0], /^_nice-[a-f0-9]{64}\.log\.jsonl$/);
        assert.throws(() => readable("bad", { filenameSuffix: "../bad" }), /FILENAME/);
    });
    it("retains dynamic logging without migrating old files", async function() {
        await input(readable("alpha", { directory: "folder", directoryType: "msg" }), 1, { folder: dir });
        await input(readable("beta", { directory: "folder", directoryType: "msg" }), 2, { folder: dir });
        assert.deepEqual((await fs.readdir(dir)).sort(), ["alpha.log.jsonl", "beta.log.jsonl"]);
    });
    it("protects toggle route, rejects invalid/wrong nodes and drains accepted writes", async function() {
        const n = make(); const accepted = Array.from({ length: 20 }, (_, i) => input(n, i));
        assert.equal(permission, "debug.write"); assert.equal(toggle("n1", "disable"), 201);
        assert.equal((await input(n, "rejected")).code, "DEBUG_FILE_DISABLED");
        assert((await Promise.all(accepted)).every(v => !v)); assert.equal((await records()).length, 20);
        assert.equal(toggle("n1", "enable"), 200); assert.equal(await input(n, 21), undefined);
        assert.equal(toggle("missing", "enable"), 404); assert.equal(toggle("n1", "bad"), 404);
        n.type = "other"; assert.equal(toggle("n1", "disable"), 404);
        assert.equal((await input(make({ id: "off", active: false }), 1)).code, "DEBUG_FILE_DISABLED");
        assert.equal(await input(make({ id: "restart" }), 1), undefined);
    });

    it("deploy without a message leaves old logs and permissions untouched", async function() {
        await input(readable("alpha"), 1); await fs.chmod(path.join(dir, "alpha.log.jsonl"), 0o600);
        const n = readable("beta", { filenameHistory: ["alpha.log.jsonl"] });
        await new Promise(resolve => n.emit("close", resolve));
        assert.deepEqual(await fs.readdir(dir), ["alpha.log.jsonl"]);
        assert.equal((await fs.stat(path.join(dir, "alpha.log.jsonl"))).mode & 0o777, 0o600);
    });
    it("drains asynchronous selections and directory evaluations accepted before disable", async function() {
        const a = make({ complete: "delayed", targetType: "jsonata", tosidebar: true });
        const accepted = input(a, 1); toggle("n1", "disable");
        assert.equal((await input(a, 2)).code, "DEBUG_FILE_DISABLED");
        settings.selectionCallback(); assert.equal(await accepted, undefined); assert.equal(published.length, 1);
        const b = make({ id: "n2", directoryType: "delayed" }); const next = input(b, 3);
        toggle("n2", "disable"); settings.directoryCallback(); assert.equal(await next, undefined);
        assert.equal((await records("n2")).length, 1);
    });
    it("does not change logs when toggled and restart honors only deployed state", async function() {
        const n = make(); await input(n, 1); const before = await fs.readFile(path.join(dir, filename("n1")));
        toggle("n1", "disable"); assert.equal((await input(n, 2)).code, "DEBUG_FILE_DISABLED");
        assert((await fs.readFile(path.join(dir, filename("n1")))).equals(before));
        await input(make(), 3); assert.equal((await records()).length, 2);
        assert.equal((await input(make({ active: false }), 4)).code, "DEBUG_FILE_DISABLED");
    });
    it("preserves readable rotation and rejects foreign replacements", async function() {
        const n = readable("alpha"); await input(n, 1); const f = path.join(dir, "alpha.log.jsonl");
        await fs.rename(f, f + ".1"); await input(n, 2);
        assert.equal(JSON.parse(await fs.readFile(f, "utf8")).serializedValue, "2");
        await fs.writeFile(f, JSON.stringify({ nodeId: "other", serializedValue: "private" }) + "\n");
        const before = await fs.readFile(f); assert.equal((await input(n, 3)).code, "DEBUG_FILE_LOG_OWNERSHIP");
        assert((await fs.readFile(f)).equals(before));
    });
    it("validates multi-chunk own history once and preserves unterminated bytes", async function() {
        const original = Array.from({ length: 5000 }, (_, i) => JSON.stringify({ nodeId: "n1", value: "😀".repeat(20), i })).join("\n");
        const f = path.join(dir, "alpha.log.jsonl"); await fs.writeFile(f, original);
        const open = fs.open; let scans = 0;
        fs.open = async (...args) => {
            const h = await open(...args); const stream = h.createReadStream;
            h.createReadStream = function(...args) { scans++; return stream.apply(this, args); }; return h;
        };
        try {
            const n = readable("alpha", { directory: "folder", directoryType: "msg" });
            for (let i = 0; i < 30; i++) assert.equal(await input(n, i, { folder: dir }), undefined);
            assert.equal(scans, 1);
            await fs.appendFile(f, '{"nodeId":"n1"}\n');
            assert.equal(await input(n, 31, { folder: dir }), undefined); assert.equal(scans, 2);
            assert.equal(await input(readable("alpha"), 32), undefined); assert.equal(scans, 3);
        } finally { fs.open = open; }
        assert((await fs.readFile(f, "utf8")).startsWith(original + "\n"));
    });
    it("fails closed on foreign, mixed, corrupt, empty, symlink and hardlink current targets", async function() {
        const f = path.join(dir, "alpha.log.jsonl");
        for (const content of ['', '{"nodeId":"other"}\n', '{"nodeId":"n1"}\n{"nodeId":"other"}\n', '{"nodeId":"n1"}\ncorrupt']) {
            await fs.writeFile(f, content); assert(await input(readable("alpha"), 1));
            assert.equal(await fs.readFile(f, "utf8"), content);
        }
        await fs.unlink(f); const other = path.join(dir, "other"); await fs.writeFile(other, '{"nodeId":"n1"}\n');
        await fs.symlink(other, f); assert(await input(readable("alpha"), 1)); await fs.unlink(f);
        await fs.link(other, f); assert.equal((await input(readable("alpha"), 1)).code, "DEBUG_FILE_UNSAFE_LOG_FILE");
        assert.equal(await fs.readFile(other, "utf8"), '{"nodeId":"n1"}\n');
    });
    it("invalidates cached ownership on same-size rewrites and timestamp restoration", async function() {
        const n = readable("alpha"); await input(n, 1); const f = path.join(dir, "alpha.log.jsonl");
        const stat = await fs.stat(f); const content = (await fs.readFile(f, "utf8")).replace('"nodeId":"n1"', '"nodeId":"n2"');
        await fs.writeFile(f, content); await fs.utimes(f, stat.atime, stat.mtime);
        assert.equal((await input(n, 2)).code, "DEBUG_FILE_LOG_OWNERSHIP"); assert.equal(await fs.readFile(f, "utf8"), content);
    });
    it("different visible names with equal sanitized basenames select different targets", async function() {
        for (const name of ["a b", "a?b", "alpha", "alpha.log", "x".repeat(81), "x".repeat(80) + "y"]) {
            assert.equal(await input(readable(name), name), undefined);
        }
        assert.equal((await fs.readdir(dir)).length, 6);
    });
    it("checks cached targets again for hardlinks and symlink replacements", async function() {
        const n = readable("alpha"); assert.equal(await input(n, 1), undefined);
        const f = path.join(dir, "alpha.log.jsonl"), archive = path.join(dir, "archive");
        const before = await fs.readFile(f); await fs.link(f, archive);
        assert.equal((await input(n, 2)).code, "DEBUG_FILE_UNSAFE_LOG_FILE");
        assert((await fs.readFile(archive)).equals(before));
        await fs.unlink(f); await fs.symlink(archive, f);
        assert(await input(n, 3)); assert((await fs.readFile(archive)).equals(before));
    });
    it("revalidates alternating dynamic targets and refuses mixed history in either directory", async function() {
        const other = path.join(dir, "other"); await fs.mkdir(other);
        const n = readable("alpha", { directory: "folder", directoryType: "msg" });
        for (const folder of [dir, other, dir, other]) assert.equal(await input(n, 1, { folder }), undefined);
        const f = path.join(dir, "alpha.log.jsonl"); await fs.appendFile(f, '{"nodeId":"other"}\n');
        const before = await fs.readFile(f);
        assert.equal((await input(n, 2, { folder: dir })).code, "DEBUG_FILE_LOG_OWNERSHIP");
        assert((await fs.readFile(f)).equals(before));
        assert.equal(await input(n, 3, { folder: other }), undefined);
    });
    it("never overwrites a foreign destination created at the exclusive-open boundary", async function() {
        const open = fs.open; let injected = false;
        fs.open = async (target, flags, ...args) => {
            if (!injected && String(target).endsWith('/alpha.log.jsonl') && (flags & require('fs').constants.O_EXCL)) {
                injected = true; await fs.writeFile(path.join(dir, 'alpha.log.jsonl'), '{"nodeId":"foreign"}\n');
            }
            return open(target, flags, ...args);
        };
        try { assert.equal((await input(readable("alpha"), 1)).code, "DEBUG_FILE_LOG_OWNERSHIP"); }
        finally { fs.open = open; }
        assert.equal(await fs.readFile(path.join(dir, 'alpha.log.jsonl'), 'utf8'), '{"nodeId":"foreign"}\n');
    });

    it("ignores malformed legacy filenameHistory for both naming modes", async function() {
        for (const filenameHistory of [null, "invalid", 42, { unexpected: true }, ["../unsafe"]]) {
            assert.equal(await input(readable("legacy-field", { filenameHistory }), 1), undefined);
            assert.equal(await input(make({ filenameHistory }), 2), undefined);
        }
        assert.deepEqual((await fs.readdir(dir)).sort(), [filename("n1"), "legacy-field.log.jsonl"].sort());
        const own = (await fs.readFile(path.join(dir, "legacy-field.log.jsonl"), "utf8")).trim().split("\n");
        assert.equal(own.length, 5); own.forEach(line => assert.equal(JSON.parse(line).nodeId, "n1"));
    });
    it("streams own histories larger than 5 MiB and rejects foreign records beyond that boundary", async function() {
        const f = path.join(dir, "large.log.jsonl");
        const original = (JSON.stringify({ nodeId: "n1", value: "x".repeat(1024) }) + "\n").repeat(5200);
        assert(Buffer.byteLength(original) > 5 * 1024 * 1024);
        await fs.writeFile(f, original);
        const n = readable("large"); assert.equal(await input(n, "accepted"), undefined);
        assert((await fs.readFile(f, "utf8")).startsWith(original));
        await fs.appendFile(f, '{"nodeId":"foreign"}\n');
        const before = await fs.readFile(f);
        assert.equal((await input(n, "rejected")).code, "DEBUG_FILE_LOG_OWNERSHIP");
        assert((await fs.readFile(f)).equals(before));
    });
    it("rejects readable parent symlinks and nonregular targets without changing permissions", async function() {
        const real = path.join(dir, "real"), link = path.join(dir, "link");
        await fs.mkdir(real); await fs.symlink(real, link);
        assert(await input(readable("alpha", { directory: link }), 1));
        assert.deepEqual(await fs.readdir(real), []);
        const f = path.join(dir, "alpha.log.jsonl");
        require("child_process").execFileSync("mkfifo", ["-m", "600", f]);
        assert(await input(readable("alpha"), 1));
        assert.equal((await fs.stat(f)).mode & 0o777, 0o600);
        await fs.unlink(f); await fs.mkdir(f, { mode: 0o700 });
        assert(await input(readable("alpha"), 1));
        assert.equal((await fs.stat(f)).mode & 0o777, 0o700);
    });

});
