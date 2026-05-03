// What: Focused runtime tests for the Agentic assistant loop controls.
// Why: Auto-apply must be gated by preview results and pending-batch controls
// must behave predictably for approval/rejection workflows.
const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const root = path.resolve(__dirname, "..");

function makeTable() {
    return {
        version: 1,
        name: "Agentic Test",
        playfield: { width: 500, height: 880, gravity: 0.35, friction: 0.999, restitution: 0.55, maxSpeed: 24 },
        rules: { balls: 3, highScoreKey: "assistant.agentic.test" },
        rulesEngine: { switchMap: [], sequenceRules: [], logicGraphs: [], triggers: [], variables: [] },
        elements: []
    };
}

function loadAssistant(fetchImpl) {
    const localStorageState = {};
    const ctx = {
        console: console,
        window: { Pin: {} },
        localStorage: {
            getItem: function getItem(key) { return Object.prototype.hasOwnProperty.call(localStorageState, key) ? localStorageState[key] : null; },
            setItem: function setItem(key, value) { localStorageState[key] = String(value); }
        },
        fetch: fetchImpl
    };
    vm.createContext(ctx);
    vm.runInContext(fs.readFileSync(path.join(root, "app/editor/assistant.js"), "utf8"), ctx, { filename: "app/editor/assistant.js" });
    return ctx.window.Pin.editorAssistant;
}

function makeFetch(chatContents) {
    const queue = chatContents.slice();
    return async function fetch(url) {
        if (url === "TBSpec.MD") {
            return { ok: true, text: async function text() { return "skill"; } };
        }
        if (String(url).indexOf("/chat/completions") >= 0) {
            const next = queue.shift();
            if (!next) throw new Error("No queued chat response left.");
            return {
                ok: true,
                json: async function json() {
                    return {
                        choices: [
                            { message: { content: next } }
                        ]
                    };
                }
            };
        }
        throw new Error("Unexpected fetch URL: " + url);
    };
}

function createRuntime(config) {
    const applyCalls = [];
    const previewCalls = [];
    const table = makeTable();
    const assistantApi = loadAssistant(makeFetch(config.chatContents || []));
    const runtime = assistantApi.create({
        getTable: function getTable() { return table; },
        getSelected: function getSelected() { return null; },
        getSelectedRule: function getSelectedRule() { return null; },
        getSelectedGraph: function getSelectedGraph() { return null; },
        getSelectedLogicNode: function getSelectedLogicNode() { return null; },
        getActiveTab: function getActiveTab() { return "assistant"; },
        getValidationIssues: function getValidationIssues() { return []; },
        applyPatch: function applyPatch(patch) {
            applyCalls.push(patch);
            return config.applyResult || { ok: true, issues: [] };
        },
        previewPatch: function previewPatch(patch) {
            previewCalls.push(patch);
            if (typeof config.previewResult === "function") return config.previewResult(patch);
            return config.previewResult || { ok: true, issues: [] };
        },
        refresh: function refresh() {}
    });
    runtime.setSettings({
        baseUrl: "http://127.0.0.1:1234/v1",
        model: "test-model",
        maxSteps: 1
    });
    return {
        runtime: runtime,
        applyCalls: applyCalls,
        previewCalls: previewCalls
    };
}

function patchResponse(message) {
    return JSON.stringify({
        message: message || "Patch ready.",
        patch: {
            type: "assistantPatch",
            operations: [
                { op: "addVariable", variable: { id: "v1", name: "V1", properties: { value: false } } }
            ]
        }
    });
}

async function testAutoApplyBlockedWhenPreviewHasIssues() {
    const harness = createRuntime({
        chatContents: ["notes", patchResponse("preview issues")],
        previewResult: { ok: true, issues: [{ message: "issue" }] },
        applyResult: { ok: true, issues: [] }
    });
    harness.runtime.setAgenticMode({ fullyAuto: true, approveEachChange: false });
    harness.runtime.setAgenticDraft("run task");
    await harness.runtime.runAgentic();
    const state = harness.runtime.getState();
    assert.strictEqual(harness.previewCalls.length, 1, "preview should run once");
    assert.strictEqual(harness.applyCalls.length, 0, "apply should be blocked in strict auto mode");
    assert(state.agenticPendingPatch, "pending patch should be parked for manual decision");
    assert.strictEqual(state.agenticBatches.length, 1, "one batch should be recorded");
    assert.strictEqual(state.agenticBatches[0].status, "pending_manual_apply", "batch should require manual apply");
    assert(String(state.agenticBatches[0].error || "").indexOf("Auto-apply blocked") >= 0, "batch should explain auto-apply block");
}

async function testAutoApplyProceedsWhenPreviewIsClean() {
    const harness = createRuntime({
        chatContents: ["notes", patchResponse("clean preview")],
        previewResult: { ok: true, issues: [] },
        applyResult: { ok: true, issues: [] }
    });
    harness.runtime.setAgenticMode({ fullyAuto: true, approveEachChange: false });
    harness.runtime.setAgenticDraft("run task");
    await harness.runtime.runAgentic();
    const state = harness.runtime.getState();
    assert.strictEqual(harness.previewCalls.length, 1, "preview should run once");
    assert.strictEqual(harness.applyCalls.length, 1, "apply should run in strict auto mode when preview is clean");
    assert.strictEqual(state.agenticPendingPatch, null, "no pending patch should remain");
    assert.strictEqual(state.agenticBatches.length, 1, "one batch should be recorded");
    assert.strictEqual(state.agenticBatches[0].status, "applied", "batch should be applied");
}

async function testRejectPendingPatchMarksBatchRejected() {
    const harness = createRuntime({
        chatContents: ["notes", patchResponse("manual mode")],
        previewResult: { ok: true, issues: [] },
        applyResult: { ok: true, issues: [] }
    });
    harness.runtime.setAgenticMode({ fullyAuto: false, approveEachChange: false });
    harness.runtime.setAgenticDraft("run task");
    await harness.runtime.runAgentic();
    const before = harness.runtime.getState();
    assert(before.agenticPendingPatch, "manual mode should park patch");
    assert.strictEqual(before.agenticBatches[0].status, "pending_manual_apply", "batch should start pending");
    const rejectResult = harness.runtime.rejectAgenticPendingPatch();
    const after = harness.runtime.getState();
    assert.strictEqual(rejectResult.ok, true, "reject action should succeed");
    assert.strictEqual(after.agenticPendingPatch, null, "pending patch should clear after reject");
    assert.strictEqual(after.agenticBatches[0].status, "rejected", "batch status should be rejected");
}

async function testAutoApplyBlockedWhenPreviewFails() {
    const harness = createRuntime({
        chatContents: ["notes", patchResponse("preview fails")],
        previewResult: { ok: false, message: "preview broke" },
        applyResult: { ok: true, issues: [] }
    });
    harness.runtime.setAgenticMode({ fullyAuto: true, approveEachChange: false });
    harness.runtime.setAgenticDraft("run task");
    await harness.runtime.runAgentic();
    const state = harness.runtime.getState();
    assert.strictEqual(harness.previewCalls.length, 1, "preview should run once");
    assert.strictEqual(harness.applyCalls.length, 0, "apply should be blocked when preview fails");
    assert.strictEqual(state.agenticBatches.length, 1, "one batch should be recorded");
    assert.strictEqual(state.agenticBatches[0].status, "pending_manual_apply", "failed preview should park batch");
    assert(String(state.agenticBatches[0].error || "").indexOf("Auto-apply blocked") >= 0, "batch should report preview block reason");
}

async function testApplyPendingUpdatesExistingBatch() {
    const harness = createRuntime({
        chatContents: ["notes", patchResponse("manual then apply")],
        previewResult: { ok: true, issues: [] },
        applyResult: { ok: true, issues: [] }
    });
    harness.runtime.setAgenticMode({ fullyAuto: false, approveEachChange: false });
    harness.runtime.setAgenticDraft("run task");
    await harness.runtime.runAgentic();
    const before = harness.runtime.getState();
    assert.strictEqual(before.agenticBatches.length, 1, "manual mode should create one pending batch");
    assert.strictEqual(before.agenticBatches[0].status, "pending_manual_apply", "batch should start pending");
    const applyResult = harness.runtime.applyAgenticPendingPatch();
    const after = harness.runtime.getState();
    assert.strictEqual(applyResult.ok, true, "manual apply should succeed");
    assert.strictEqual(harness.applyCalls.length, 1, "apply should run once");
    assert.strictEqual(after.agenticBatches.length, 1, "apply should update existing batch, not duplicate");
    assert.strictEqual(after.agenticBatches[0].status, "applied", "batch should transition to applied");
}

(async function run() {
    await testAutoApplyBlockedWhenPreviewHasIssues();
    await testAutoApplyProceedsWhenPreviewIsClean();
    await testRejectPendingPatchMarksBatchRejected();
    await testAutoApplyBlockedWhenPreviewFails();
    await testApplyPendingUpdatesExistingBatch();
    console.log("assistant agentic tests ok");
})().catch(function onError(err) {
    console.error(err && err.stack ? err.stack : err);
    process.exit(1);
});
