// What: Smoke checks for the eval-agent patch/evaluation pipeline.
// Why: Dataset generation loops rely on the same contract and evaluator output.
const assert = require("assert");
const path = require("path");

const evalAgent = require(path.resolve(__dirname, "..", "tools", "eval-agent.js"));

const pin = evalAgent.loadPinRuntime();

{
    const bad = evalAgent.validatePatchContract({ badKey: true });
    assert.strictEqual(bad.ok, false, "contract should reject unsupported keys");
    assert(bad.issues.some(function some(issue) { return /Unsupported patch key/.test(issue); }), "contract should name unsupported key");
}

{
    const table = pin.table.createEmptyTable();
    const patch = {
        patchElements: [{
            id: "lf",
            patch: { length: 102 }
        }]
    };
    const result = evalAgent.evaluatePatch(pin, table, patch, {});
    assert.strictEqual(typeof result.accepted, "boolean", "evaluatePatch should return accepted flag");
    assert(Array.isArray(result.contractIssues), "evaluatePatch should return contract issues array");
    assert(result.evalReport && typeof result.evalReport === "object", "evaluatePatch should return eval report for valid patch");
    assert.strictEqual(result.evalReport.tableName, "Untitled Table", "evaluatePatch should preserve normalized table identity");
}

console.log("eval-agent smoke ok");
