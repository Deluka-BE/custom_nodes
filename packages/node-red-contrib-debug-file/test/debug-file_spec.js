const assert = require("assert");
const fs = require("fs").promises;
const os = require("os");
const path = require("path");
const crypto = require("crypto");
const EventEmitter = require("events");
const register = require("../nodes/debug-file");
const filename = id => `debug-${crypto.createHash("sha256").update(id).digest("hex")}.log.jsonl`;
describe("JSONL debug file", function() {
    let dir, Node, nodes, settings, published;
    beforeEach(async function() {
        dir = await fs.mkdtemp(path.join(os.tmpdir(), "debug-jsonl-")); nodes = []; settings = {}; published = [];
        register({ settings, nodes: {
            createNode(node, config) {
                Object.setPrototypeOf(Node.prototype, EventEmitter.prototype); EventEmitter.call(node);
                node.id = config.id || "n1"; node.z = "flow1"; node.status = s => node.lastStatus = s;
                node.error = e => { node.lastError = e; }; node.log = s => { node.lastLog = s; };
            }, registerType(type, constructor) { Node = constructor; }
        }, util: {
            getMessageProperty(msg, prop) { return msg[prop]; },
            evaluateNodeProperty(v, type, node, msg, cb) { if (type === "bad") cb(new Error("secret")); else cb(null, type === "msg" ? msg[v] : v); },
            prepareJSONataExpression(v) { return v; }, evaluateJSONataExpression(v, msg, cb) { cb(null, msg.payload * 2); },
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
        const vm = require("vm"); const html = await fs.readFile(path.join(__dirname, "../nodes/debug-file.html"), "utf8"); let editor;
        vm.runInNewContext(html.match(/<script type="text\/javascript">([\s\S]*?)<\/script>/)[1], { RED: { nodes: { registerType(t, v) { editor = v; } }, validators: { typedInput() { return () => true; } } } });
        assert.equal(editor.defaults.directory.value, "/share/nodered-logs/"); assert.equal(editor.defaults.createDir.value, true);
        const a = { id: "a" }, b = { id: "b" }; editor.onadd.call(a); editor.onadd.call(b); assert.notEqual(a.name, b.name);
        assert(!Object.hasOwn(editor.defaults, "jsonlEnabled")); assert(!Object.hasOwn(editor.defaults, "overwriteFile"));
    });
});
