const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");
describe("Editor naming and live toggle", function() {
    let editor, visible, ajax, history, dirty, notices, field;
    beforeEach(function() {
        visible = []; ajax = []; history = []; dirty = []; notices = []; field = "";
        const html = fs.readFileSync(path.join(__dirname, "../nodes/debug-file.html"), "utf8");
        const $ = () => ({ val: () => field }); $.ajax = req => ajax.push(req);
        vm.runInNewContext(html.match(/<script type="text\/javascript">([\s\S]*?)<\/script>/)[1], { $, RED: {
            nodes: { registerType(t, v) { editor = v; }, eachNode(cb) { visible.forEach(cb); }, dirty(v) { dirty.push(v); } },
            validators: { typedInput() { return () => true; } }, history: { push(v) { history.push(v); } }, view: { redraw() {} }, notify(v) { notices.push(v); }
        } });
    });
    function add(id, options = {}) { const n = { id, type: "debug-file", name: "", ...options }; editor.onadd.call(n); visible.push(n); return n; }
    it("finds the first available visible name including nodes of other types", function() {
        visible.push({ name: "debug_file_01", type: "debug" }, { name: "debug_file_03" });
        assert.equal(add("one").name, "debug_file_02"); assert.equal(add("two").name, "debug_file_04");
        visible = []; assert.equal(add("new").name, "debug_file_01");
    });
    it("leaves named legacy nodes in legacy mode and tracks duplicate/copy identities", function() {
        const old = add("old", { name: "Legacy", readableFilename: false }); assert.equal(old.readableFilename, false);
        const a = add("one"); const b = add("two", { name: a.name, readableFilename: true, filenameOwner: "debug-file:one" });
        assert.equal(a.filenameSuffix, ""); assert.equal(b.filenameSuffix, "id"); assert.equal(b.filenameOwner, "debug-file:two");
        field = "Unique"; editor.oneditsave.call(b); assert.equal(b.filenameSuffix, "id");
        assert(!Object.hasOwn(b, "filenameHistory"));
    });
    it("keeps collision suffix and owner through several undeployed renames", function() {
        const a = add("one"), b = add("two"); field = b.name; editor.oneditsave.call(a);
        assert.equal(a.filenameSuffix, "id"); assert.equal(a.filenameOwner, "debug-file:one");
        a.name = field; field = "Third"; editor.oneditsave.call(a);
        assert.equal(a.filenameSuffix, "id"); assert.equal(a.filenameOwner, "debug-file:one");
        assert(!Object.hasOwn(a, "filenameHistory"));
    });
    it("omits history defaults and ignores malformed legacy history on add, copy and save", function() {
        assert(!Object.hasOwn(editor.defaults, "filenameHistory"));
        for (const legacy of [null, "invalid", 42, { unexpected: true }, ["../unsafe", "old.log.jsonl"]]) {
            const n = add("copy", { name: "Imported", readableFilename: true,
                filenameOwner: "debug-file:source", filenameHistory: legacy });
            field = "Renamed"; editor.oneditsave.call(n);
            assert.strictEqual(n.filenameHistory, legacy);
            assert.equal(n.filenameOwner, "debug-file:copy");
            assert.equal(n.filenameSuffix, "");
            visible = [];
        }
    });
    it("handles sanitized collisions, excludes legacy and other types and keeps existing owners", function() {
        const a = add("one", { name: "a b", readableFilename: true, filenameOwner: "debug-file:one" });
        const b = add("two", { name: "a?b", readableFilename: true });
        assert.equal(b.filenameSuffix, "id"); assert.equal(a.filenameOwner, "debug-file:one");
        assert(!a.filenameSuffix);
        visible = [{ id: "old", type: "debug-file", name: "Unique", readableFilename: false },
            { id: "other", type: "debug", name: "Unique", readableFilename: true }];
        const c = add("three", { name: "Unique", readableFilename: true });
        field = "Unique"; editor.oneditsave.call(c);
        assert.equal(c.filenameSuffix, ""); assert.equal(c.filenameOwner, "debug-file:three");
    });
    it("uses native-style POST, dirty/history success and failure rollback", function() {
        const n = add("one", { active: false }); editor.button.onclick.call(n);
        assert.equal(ajax[0].type, "POST"); assert.equal(ajax[0].url, "debug-file/one/disable");
        ajax[0].success(); assert.equal(dirty[0], true); assert.equal(history[0].changes.active, true);
        n.active = true; history[0].callback({ node: n }); assert.equal(ajax[1].url, "debug-file/one/enable");
        n.active = false; editor.button.onclick.call(n); ajax[2].error();
        assert.equal(n.active, true); assert.equal(history.length, 1); assert.equal(notices.length, 1);
    });
});
