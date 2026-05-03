// What: Tests editor logic starter templates that create sequence rules.
// Why: the rules-first Logic UI now relies on templates for fast authoring, so
// template outputs must stay schema-valid and deterministic.
const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const root = path.resolve(__dirname, "..");

/*
 * Load editor modules into a VM context.
 * Why: this exercises the real rules-logic implementation without requiring DOM.
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
 * Build a minimal rules-logic harness.
 * Why: template helpers mutate table rules through the same callback surface as
 * the editor; tests should run that path directly.
 */
function createHarness(table, selectedId) {
    const Pin = loadEditorPin();
    const state = {
        table: Pin.table.normalizeTable(table),
        undo: []
    };
    const selection = { id: selectedId || "" };
    const logic = Pin.editorRulesLogic.create({
        state: state,
        pushUndo: function pushUndo() {
            state.undo.push(Pin.editorTools.clone(state.table));
        },
        markTableDirty: function markTableDirty() {},
        refresh: function refresh() {},
        makeRuleId: function makeRuleId() {
            return "rule_" + Math.random().toString(36).slice(2, 8);
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
            return (state.table.elements || []).find(function find(element) {
                return element && element.id === selection.id;
            }) || null;
        },
        getElementById: function getElementById(id) {
            return (state.table.elements || []).find(function find(element) {
                return element && element.id === id;
            }) || null;
        },
        firstSwitchElementId: function firstSwitchElementId() {
            const element = (state.table.elements || []).find(function find(item) {
                return item && item.id && ["lane", "scoreZone", "spinner", "gate", "valve", "drain", "launcher", "dropTarget", "bumper", "kicker", "trough"].indexOf(item.type) >= 0;
            });
            return element ? element.id : "";
        },
        setSelectedId: function setSelectedId() {},
        setSelectedRuleId: function setSelectedRuleId() {},
        setSelectedLogicNode: function setSelectedLogicNode() {},
        setSelectedGraphId: function setSelectedGraphId() {},
        getSelectedGraphId: function getSelectedGraphId() {
            return null;
        },
        setSelectedGraphNodeId: function setSelectedGraphNodeId() {},
        getPendingEdgeSourceNodeId: function getPendingEdgeSourceNodeId() {
            return null;
        },
        setPendingEdgeSourceNodeId: function setPendingEdgeSourceNodeId() {},
        setInspectorTab: function setInspectorTab() {}
    });
    return { logic: logic, state: state };
}

/*
 * Build a table with common switch and lamp objects for template coverage.
 * Why: template selection should prefer existing ids and not invent table objects.
 */
function baseTable() {
    return {
        version: 1,
        name: "Template Test",
        playfield: { width: 500, height: 880, gravity: 0.35, friction: 0.999, restitution: 0.55, maxSpeed: 24 },
        rules: { balls: 3, highScoreKey: "template.test" },
        rulesEngine: { switchMap: [], sequenceRules: [], logicGraphs: [], triggers: [], variables: [] },
        launcher: { x: 439, y: 710, dir: { x: 0, y: -1 }, maxPower: 42 },
        elements: [
            { id: "laneA", type: "lane", x: 120, y: 120, w: 40, h: 20, score: 10 },
            { id: "laneB", type: "lane", x: 200, y: 120, w: 40, h: 20, score: 10 },
            { id: "laneC", type: "lane", x: 280, y: 120, w: 40, h: 20, score: 10 },
            { id: "trough_main", type: "trough", x: 240, y: 760, radius: 24, holdSeconds: 0.25, reactivateDelay: 0.2, ejectPower: 9, ejectAngle: -1.57 },
            { id: "goLight", type: "arrowLight", x: 240, y: 560, w: 44, h: 20, angle: -1.57, lampId: "lamp_go", text: "GO", color: "#ffee55" },
            { id: "lampA", type: "light", x: 120, y: 150, radius: 8, lampId: "lamp_a", color: "#ffee55" },
            { id: "lampB", type: "light", x: 200, y: 150, radius: 8, lampId: "lamp_b", color: "#ffee55" },
            { id: "lampC", type: "light", x: 280, y: 150, radius: 8, lampId: "lamp_c", color: "#ffee55" }
        ]
    };
}

/*
 * Simple event template should produce exactly one score-awarding rule.
 * Why: this is the smallest quick-start path in the Rules-first workflow.
 */
function testSimpleEventTemplate() {
    const harness = createHarness(baseTable(), "laneB");
    harness.logic.addRuleTemplate("simpleEvent");
    const rules = harness.state.table.rulesEngine.sequenceRules;
    assert.strictEqual(rules.length, 1, "simple event should add one rule");
    assert.strictEqual(rules[0].name, "Simple Event", "simple event should use expected name");
    assert.strictEqual(JSON.stringify(rules[0].steps), JSON.stringify(["laneB"]), "simple event should prefer selected switch");
    assert.strictEqual(rules[0].awardPoints, 50, "simple event should use conservative starter points");
}

/*
 * Timed mode template should set up timer + variable driven lamp control.
 * Why: timer/variable/lamp integration is core to the new logic capabilities.
 */
function testTimedModeTemplate() {
    const harness = createHarness(baseTable(), "goLight");
    harness.logic.addRuleTemplate("timedMode");
    const rulesEngine = harness.state.table.rulesEngine;
    assert.strictEqual(rulesEngine.sequenceRules.length, 1, "timed mode should add one rule");
    assert.strictEqual(rulesEngine.variables.length, 1, "timed mode should add one variable");
    assert.strictEqual(rulesEngine.triggers.length, 1, "timed mode should add one trigger");
    assert.strictEqual(rulesEngine.triggers[0].switchId, "tick.mode.flash", "timed mode should use tick switch");
    const actions = rulesEngine.sequenceRules[0].actions || [];
    assert(actions.some(function has(action) { return action.actionType === "toggleVariableProperty"; }), "timed mode should toggle variable");
    assert(actions.some(function has(action) { return action.actionType === "setLampFromVariable"; }), "timed mode should drive lamp from variable");
}

/*
 * Collect bonus template should emit build + collect rules with a gate variable.
 * Why: this demonstrates multi-rule composition with conditions and reset actions.
 */
function testCollectBonusTemplate() {
    const harness = createHarness(baseTable(), "laneA");
    harness.logic.addRuleTemplate("collectBonus");
    const rulesEngine = harness.state.table.rulesEngine;
    assert.strictEqual(rulesEngine.sequenceRules.length, 2, "collect bonus should add two rules");
    assert.strictEqual(rulesEngine.variables.length, 1, "collect bonus should add one variable");
    const collectRule = rulesEngine.sequenceRules.find(function find(rule) { return rule.name === "Collect Bonus"; });
    assert(collectRule, "collect bonus rule should exist");
    assert.strictEqual(JSON.stringify(collectRule.steps), JSON.stringify(["trough_main"]), "collect bonus should collect on trough when available");
    assert((collectRule.conditions || []).some(function has(condition) {
        return condition && condition.source === "variable" && condition.operator === "truthy";
    }), "collect bonus should be gated by variable truthy condition");
    assert((collectRule.actions || []).some(function has(action) {
        return action && action.actionType === "setVariableProperty" && action.value === false;
    }), "collect bonus should clear ready variable when collected");
}

testSimpleEventTemplate();
testTimedModeTemplate();
testCollectBonusTemplate();
console.log("rules template tests ok");
