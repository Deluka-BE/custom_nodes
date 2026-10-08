module.exports = function (RED) {
    "use strict";

    const fs = require("fs-extra");
    const os = require("os");
    const path = require("path");
    const iconv = require("iconv-lite");
    const util = require("util");

    function serialise(value) {
        if (Buffer.isBuffer(value)) { return value; }
        if (typeof value === "string") { return value; }
        if (value === undefined) { return "undefined"; }
        if (typeof value === "bigint") { return value.toString(); }
        try { return JSON.stringify(value); }
        catch (err) { return util.inspect(value, { depth: 10 }); }
    }

    function encode(value, encoding) {
        if (Buffer.isBuffer(value) && encoding === "none") { return value; }
        return encoding === "none" ? Buffer.from(value) : iconv.encode(value, encoding);
    }

    function DebugFileNode(config) {
        RED.nodes.createNode(this, config);
        const node = this;
        node.name = config.name || "";
        node.complete = (config.complete || "payload").toString();
        node.targetType = config.targetType || "msg";
        node.tosidebar = config.tosidebar !== false;
        node.console = config.console === true || config.console === "true";
        node.fileEnabled = config.fileEnabled !== false;
        node.directory = config.directory || "";
        node.directoryType = config.directoryType || "str";
        node.appendNewline = config.appendNewline === true || config.appendNewline === "true";
        node.createDir = config.createDir === true || config.createDir === "true";
        node.overwriteFile = config.overwriteFile === true || config.overwriteFile === "true";
        node.encoding = config.encoding || "none";
        node.queue = [];
        node.closing = false;

        function selectedValue(msg, done) {
            if (node.targetType === "jsonata") {
                let expression;
                try { expression = RED.util.prepareJSONataExpression(node.complete, node); }
                catch (err) { done(err); return; }
                RED.util.evaluateJSONataExpression(expression, msg, done);
                return;
            }
            if (node.complete === "true") { done(null, msg, "complete msg object"); return; }
            try { done(null, RED.util.getMessageProperty(msg, node.complete), node.complete); }
            catch (err) { done(null, undefined, node.complete); }
        }

        function getFilename(msg, done) {
            RED.util.evaluateNodeProperty(node.directory, node.directoryType, node, msg, (err, directory) => {
                if (err) { done(err); return; }
                directory = directory == null ? "" : String(directory);
                const safeName = (node.name || "debug").trim().replace(/[<>:"/\\|?*\x00-\x1F]/g, "_").replace(/[. ]+$/g, "") || "debug";
                const filename = path.join(directory, `${safeName}.log`);
                done(null, filename);
            });
        }

        function publishDebug(msg, value, property) {
            if (!node.tosidebar) { return; }
            const debugMsg = { id: node.id, z: node.z, _alias: node._alias, path: node._flow && node._flow.path, name: node.name, topic: msg.topic, property, msg: value };
            RED.comms.publish("debug", RED.util.encodeObject(debugMsg, { maxLength: RED.settings.debugMaxLength || 1000 }));
        }

        function write(event, callback) {
            const { msg, value } = event;
            getFilename(msg, (filenameError, filename) => {
                if (filenameError) { node.error(filenameError, msg); callback(); return; }
                const fullFilename = RED.settings.fileWorkingDirectory && !path.isAbsolute(filename)
                    ? path.resolve(path.join(RED.settings.fileWorkingDirectory, filename)) : filename;
                const data = serialise(value);
                const withNewline = node.appendNewline && !Buffer.isBuffer(data) ? data + os.EOL : data;
                let buffer;
                try { buffer = encode(withNewline, node.encoding === "setbymsg" ? (msg.encoding || "none") : node.encoding); }
                catch (err) { node.error(err, msg); callback(); return; }
                // writeFile deliberately does not make missing parent directories. That
                // preserves the meaning of the "Create directory" checkbox.
                const save = () => fs.writeFile(fullFilename, buffer, { flag: node.overwriteFile ? "w" : "a" })
                    .then(() => callback())
                    .catch(err => { node.error(err, msg); callback(); });
                if (node.createDir) {
                    fs.ensureDir(path.dirname(fullFilename)).then(save).catch(err => { node.error(err, msg); callback(); });
                } else { save(); }
            });
        }

        function processQueue() {
            const event = node.queue[0];
            if (!event) { if (node.closing && node.closeDone) { node.closeDone(); } return; }
            write(event, () => { event.done(); node.queue.shift(); processQueue(); });
        }

        node.on("input", (msg, send, done) => {
            selectedValue(msg, (err, value, property) => {
                if (err) { node.error(err, msg); done(); return; }
                if (node.console) { node.log(typeof value === "string" ? value : util.inspect(value, { depth: 10 })); }
                publishDebug(msg, value, property);
                if (!node.fileEnabled) { done(); return; }
                node.queue.push({ msg, value, done });
                if (node.queue.length === 1) { processQueue(); }
            });
        });
        node.on("close", done => {
            node.closing = true;
            node.closeDone = done;
            if (node.queue.length === 0) { done(); }
        });
    }

    RED.nodes.registerType("debug-file", DebugFileNode);
};
