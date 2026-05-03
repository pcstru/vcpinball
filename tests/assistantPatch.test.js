// What: Editor assistant patch tests for element creation and rollback.
// Why: The assistant now needs to create new lamps and logic in one patch, and
// that path must stay atomic when later operations fail.
const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const root = path.resolve(__dirname, "..");

/*
 * Load the editor-side Pin modules needed for assistant patch application.
 * Why: these tests exercise the same in-browser patch path the design editor
 * uses, without needing a DOM or the full app bootstrap.
 */
function loadEditorPin() {
    const ctx = {
        console,
        window: { Pin: {} }
    };
    ctx.Pin = ctx.window.Pin;
    vm.createContext(ctx);
    [
        "app/editor/tools.js",
        "app/table.js",
        "app/ruleGraph.js",
        "app/rules.js",
        "app/editor/model.js",
        "app/editor/rulesLogic.js"
    ].forEach(function load(file) {
        vm.runInContext(fs.readFileSync(path.join(root, file), "utf8"), ctx, { filename: file });
    });
    return ctx.window.Pin;
}

/*
 * Create a minimal rules-logic harness around one mutable table.
 * Why: applyAssistantPatch expects the same state and callbacks the editor
 * provides, including undo tracking and rule-engine helpers.
 */
function createHarness(table) {
    const Pin = loadEditorPin();
    const state = {
        table: Pin.table.normalizeTable(table),
        undo: []
    };
    let nextRuleId = 1;
    const logic = Pin.editorRulesLogic.create({
        state: state,
        pushUndo: function pushUndo() {
            state.undo.push(Pin.editorTools.clone(state.table));
        },
        markTableDirty: function markTableDirty() {},
        refresh: function refresh() {},
        makeRuleId: function makeRuleId() {
            nextRuleId += 1;
            return "rule_" + nextRuleId;
        },
        normalizeInput: function normalizeInput(value) {
            return value;
        },
        ensureRulesEngine: function ensureRulesEngine() {
            return Pin.editorModel.ensureRulesEngine(state.table);
        },
        getLogicGraphs: function getLogicGraphs() {
            return Pin.editorModel.getLogicGraphs(state.table);
        },
        getSelectedGraph: function getSelectedGraph() {
            return null;
        },
        getSelectedGraphNode: function getSelectedGraphNode() {
            return null;
        },
        getSelected: function getSelected() {
            return null;
        },
        getElementById: function getElementById(id) {
            return (state.table.elements || []).find(function find(element) {
                return element && element.id === id;
            }) || null;
        },
        firstSwitchElementId: function firstSwitchElementId() {
            return "";
        },
        setSelectedId: function setSelectedId() {},
        setSelectedRuleId: function setSelectedRuleId() {},
        setSelectedLogicNode: function setSelectedLogicNode() {},
        setSelectedGraphId: function setSelectedGraphId() {},
        setSelectedGraphNodeId: function setSelectedGraphNodeId() {},
        getPendingEdgeSourceNodeId: function getPendingEdgeSourceNodeId() {
            return null;
        },
        setPendingEdgeSourceNodeId: function setPendingEdgeSourceNodeId() {},
        setInspectorTab: function setInspectorTab() {},
        getSelectedGraphId: function getSelectedGraphId() {
            return null;
        }
    });
    return { Pin: Pin, state: state, logic: logic };
}

/*
 * Build a small valid base table for assistant patch tests.
 * Why: the patch path should be tested against a real normalized table shape.
 */
function baseTable() {
    return {
        version: 1,
        name: "Assistant Patch Test",
        playfield: { width: 500, height: 880, gravity: 0.35, friction: 0.999, restitution: 0.55, maxSpeed: 24 },
        rules: { balls: 3, highScoreKey: "assistant.patch.test" },
        rulesEngine: { switchMap: [], sequenceRules: [], logicGraphs: [], triggers: [], variables: [] },
        launcher: { x: 439, y: 710, dir: { x: 0, y: -1 }, maxPower: 42 },
        elements: [
            { id: "laneA", type: "lane", x: 100, y: 100, w: 40, h: 20, score: 10 },
            { id: "laneB", type: "lane", x: 180, y: 100, w: 40, h: 20, score: 10 }
        ]
    };
}

/*
 * Assistant patches should be able to create lights and then reference them.
 * Why: the motivating workflow is "add lamps around the selected targets and
 * wire them into logic" in one reviewable patch.
 */
function testAddElementsSupportsLampAndLogicPatch() {
    const harness = createHarness(baseTable());
    const result = harness.logic.applyAssistantPatch({
        type: "assistantPatch",
        operations: [
            {
                op: "addElements",
                elements: [
                    { id: "lamp_lane_a", type: "light", x: 100, y: 130, radius: 9, lampId: "lamp_lane_a", color: "#ffee55" },
                    { id: "lamp_lane_b", type: "light", x: 180, y: 130, radius: 9, lampId: "lamp_lane_b", color: "#ffee55" }
                ]
            },
            {
                op: "addVariable",
                variable: { id: "ready", name: "Ready", properties: { value: false } }
            },
            {
                op: "addSequenceRule",
                rule: {
                    id: "lane_pair",
                    name: "Lane Pair",
                    enabled: true,
                    ordered: false,
                    steps: ["laneA", "laneB"],
                    stepLampIds: ["lamp_lane_a", "lamp_lane_b"],
                    conditions: [{ source: "variable", variableId: "ready", property: "value", operator: "falsy" }],
                    actions: [{ actionType: "setVariableProperty", variableId: "ready", property: "value", value: true }],
                    resetOnDrain: true,
                    resetOnComplete: true,
                    resetOnWrongOrder: false
                }
            }
        ]
    });

    assert.strictEqual(result.ok, true, "assistant patch should apply successfully");
    assert.strictEqual(harness.state.table.elements.length, 4, "new lamps should be added to the table");
    assert(harness.state.table.elements.some(function has(element) { return element.id === "lamp_lane_a"; }), "first lamp should exist");
    assert.strictEqual(harness.state.table.rulesEngine.variables.length, 1, "variable should be added");
    assert.strictEqual(harness.state.table.rulesEngine.sequenceRules.length, 1, "sequence rule should be added");
    assert.strictEqual(harness.state.table.rulesEngine.sequenceRules[0].stepLampIds[1], "lamp_lane_b", "rule should keep lamp references");
    assert.strictEqual((result.issues || []).length, 0, "valid addElements patch should not create rule validation issues");
}

/*
 * Assistant patches should roll back if a later operation fails.
 * Why: partial light creation would leave the editor state inconsistent and
 * make review/undo harder to reason about.
 */
function testAddElementsRollsBackWhenLaterOperationFails() {
    const harness = createHarness(baseTable());
    const before = JSON.stringify(harness.state.table);
    const result = harness.logic.applyAssistantPatch({
        type: "assistantPatch",
        operations: [
            {
                op: "addElements",
                elements: [
                    { id: "lamp_lane_a", type: "light", x: 100, y: 130, radius: 9, lampId: "lamp_lane_a", color: "#ffee55" }
                ]
            },
            {
                op: "patchElements",
                patches: [
                    { id: "missingElement", patch: { score: 20 } }
                ]
            }
        ]
    });

    assert.strictEqual(result.ok, false, "assistant patch should fail when a later operation is invalid");
    assert.strictEqual(JSON.stringify(harness.state.table), before, "table state should roll back to the original table");
    assert.strictEqual(harness.state.undo.length, 0, "failed patch should not leave an undo snapshot behind");
}

/*
 * Duplicate added ids should be rejected before any mutation is committed.
 * Why: assistant-generated batches must not silently create ambiguous ids.
 */
function testAddElementsRejectsDuplicateIds() {
    const harness = createHarness(baseTable());
    const result = harness.logic.applyAssistantPatch({
        type: "assistantPatch",
        operations: [
            {
                op: "addElements",
                elements: [
                    { id: "lamp_dup", type: "light", x: 100, y: 130, radius: 9, lampId: "lamp_dup" },
                    { id: "lamp_dup", type: "light", x: 120, y: 130, radius: 9, lampId: "lamp_dup_2" }
                ]
            }
        ]
    });

    assert.strictEqual(result.ok, false, "duplicate addElements ids should be rejected");
    assert.strictEqual(harness.state.table.elements.length, 2, "failed duplicate addElements patch should not add anything");
}

testAddElementsSupportsLampAndLogicPatch();
testAddElementsRollsBackWhenLaterOperationFails();
testAddElementsRejectsDuplicateIds();
console.log("assistant patch tests ok");
