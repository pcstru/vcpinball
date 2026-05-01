// What: Lightweight static smoke checks for the no-build browser entrypoint.
// Why: The app relies on manual script ordering, so missing files or broken
// default-table contracts should fail before deployment.
const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const root = path.resolve(__dirname, "..");

function read(relativePath) {
    return fs.readFileSync(path.join(root, relativePath), "utf8");
}

function scriptSources(html) {
    const sources = [];
    html.replace(/<script\s+src="([^"]+)"/g, function collect(_, src) {
        sources.push(src);
        return "";
    });
    return sources;
}

function loadTableModule() {
    const ctx = { window: { Pin: {} } };
    ctx.Pin = ctx.window.Pin;
    vm.createContext(ctx);
    vm.runInContext(read("app/table.js"), ctx, { filename: "app/table.js" });
    return ctx.window.Pin.table;
}

function testIndexScriptsExistAndOrderCoreBeforeMain() {
    const html = read("index.html");
    const sources = scriptSources(html);

    assert(sources.length > 10, "index.html should list the browser app scripts");
    sources.forEach(function each(src) {
        assert(fs.existsSync(path.join(root, src)), "Missing script from index.html: " + src);
    });

    assert(sources.indexOf("app/table.js") >= 0, "index.html should load app/table.js");
    assert(sources.indexOf("app/elements/index.js") > sources.indexOf("app/table.js"), "elements registry should load after table helpers");
    assert(sources.indexOf("app/main.js") === sources.length - 1, "app/main.js should remain the final bootstrap script");
}

function testDefaultTableNormalizesAndValidates() {
    const tableApi = loadTableModule();
    const table = tableApi.normalizeTable(JSON.parse(read("tables/DefTable.json")));
    const validation = tableApi.validateTable(table);

    assert.strictEqual(validation.ok, true, "tables/DefTable.json should normalize into a structurally valid table");
    assert.strictEqual(typeof table.rules.balls, "number", "default table should have a runtime ball count");
    assert(Array.isArray(table.rulesEngine.sequenceRules), "default table should have rule arrays after normalization");
}

testIndexScriptsExistAndOrderCoreBeforeMain();
testDefaultTableNormalizesAndValidates();
console.log("smoke tests ok");
