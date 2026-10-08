const assert = require("assert");
const fs = require("fs").promises;
const path = require("path");
const os = require("os");
const helper = require("node-red-node-test-helper");
const debugFile = require("../nodes/debug-file");
describe("Node-RED runtime integration", function() {
    let dir;
    beforeEach(async function() { dir = await fs.mkdtemp(path.join(os.tmpdir(), "debug-runtime-")); });
    afterEach(async function() { await helper.unload(); await fs.rm(dir, { recursive: true, force: true }); });
    it("selects a nested property and appends a readable record", async function() {
        await new Promise(resolve => helper.load(debugFile, [{ id: "n1", type: "debug-file", directory: dir, complete: "nested.value", tosidebar: false }], resolve));
        const n = helper.getNode("n1"); await new Promise(resolve => { n.on("call:status", call => { if (call.args[0].text === "written") resolve(); }); n.receive({ nested: { value: "real runtime" } }); });
        const names = await fs.readdir(dir); assert.equal(names.length, 1); const r = JSON.parse(await fs.readFile(path.join(dir, names[0]), "utf8")); assert.equal(r.serializedValue, "real runtime");
    });
    it("evaluates JSONata with the real Node-RED utilities", async function() {
        await new Promise(resolve => helper.load(debugFile, [{ id: "n1", type: "debug-file", directory: dir, complete: "payload * 2", targetType: "jsonata", tosidebar: false }], resolve));
        const n = helper.getNode("n1"); await new Promise(resolve => { n.on("call:status", call => { if (call.args[0].text === "written") resolve(); }); n.receive({ payload: 4 }); });
        const [file] = await fs.readdir(dir); assert.equal(JSON.parse(await fs.readFile(path.join(dir, file), "utf8")).serializedValue, "8");
    });
});
