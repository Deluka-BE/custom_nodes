const assert = require("assert");
const fs = require("fs").promises;
const os = require("os");
const path = require("path");
const vm = require("vm");
const runtimeSettings = require("@node-red/runtime/lib/settings");

describe("Editor package version", function() {
    it("derives the display from changed metadata in a standalone deployed package", async function() {
        const root = await fs.mkdtemp(path.join(os.tmpdir(), "debug-version-"));
        try {
            const source = path.join(__dirname, "..");
            const html = await fs.readFile(path.join(source, "nodes/debug-file.html"), "utf8");
            assert.match(html, /id="debug-file-version"><\/span>/);
            const script = html.match(/<script type="text\/javascript">([\s\S]*?)<\/script>/)[1];
            const metadata = JSON.parse(await fs.readFile(path.join(source, "package.json"), "utf8"));
            for (const version of ["9.8.7-test.1", "10.20.30-test.2"]) {
                const deployed = path.join(root, version);
                await fs.mkdir(path.join(deployed, "nodes"), { recursive: true });
                await fs.copyFile(path.join(source, "nodes/debug-file.js"), path.join(deployed, "nodes/debug-file.js"));
                await fs.writeFile(path.join(deployed, "package.json"), JSON.stringify({ ...metadata, version }));
                let exported;
                // Use Node-RED's real settings validation/export, including its required node prefix.
                runtimeSettings.init({});
                require(path.join(deployed, "nodes/debug-file.js"))({ httpAdmin: { post() {} }, auth: { needsPermission() {} }, nodes: {
                    registerType(type, constructor, options) {
                        runtimeSettings.registerNodeSettings(type, options.settings);
                        exported = runtimeSettings.exportNodeSettings({});
                    }
                } });
                assert.equal(exported.debugFileVersion, version);
                let editor, displayed;
                // Browser editor context: no require, process, or filesystem access.
                vm.runInNewContext(script, {
                    RED: { settings: exported, nodes: { registerType(type, definition) { editor = definition; } },
                        validators: { typedInput() { return () => true; } } },
                    $(selector) { return {
                        text(value) { assert.equal(selector, "#debug-file-version"); displayed = value; },
                        val() {}, typedInput() {}
                    }; }
                });
                editor.oneditprepare.call({ id: "n1", name: "Example" });
                assert.equal(displayed, version);
            }
        } finally {
            runtimeSettings.init({});
            await fs.rm(root, { recursive: true, force: true });
        }
    });
});
