const assert = require("assert");
const fs = require("fs-extra");
const os = require("os");
const path = require("path");
const helper = require("node-red-node-test-helper");
const debugFile = require("../nodes/debug-file.js");

describe("debug-file", function () {
    const dir = path.join(os.tmpdir(), "node-red-contrib-debug-file-test");
    afterEach(async function () { await helper.unload(); await fs.remove(dir); });

    it("appends the selected value using the node name as filename", function (done) {
        const flow = [{ id: "n1", type: "debug-file", name: "Temperature", directory: dir, directoryType: "str", appendNewline: true, createDir: true, overwriteFile: false, encoding: "utf8", tosidebar: false }];
        helper.load(debugFile, flow, () => {
            const node = helper.getNode("n1");
            node.receive({ payload: 23.5 });
            setTimeout(async () => {
                assert.strictEqual(await fs.readFile(path.join(dir, "Temperature.log"), "utf8"), `23.5${os.EOL}`);
                done();
            }, 100);
        });
    });

    it("overwrites an existing file", function (done) {
        const file = path.join(dir, "Logger.log");
        fs.ensureDirSync(dir); fs.writeFileSync(file, "old");
        const flow = [{ id: "n1", type: "debug-file", name: "Logger", directory: dir, directoryType: "str", overwriteFile: true, encoding: "utf8", tosidebar: false }];
        helper.load(debugFile, flow, () => {
            helper.getNode("n1").receive({ payload: "new" });
            setTimeout(async () => { assert.strictEqual(await fs.readFile(file, "utf8"), "new"); done(); }, 100);
        });
    });
});
