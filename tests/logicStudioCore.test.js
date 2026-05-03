// What: Unit tests for standalone Logic Studio core helpers.
// Why: compile/validate/simulate logic must stay stable independent of UI code.
const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const root = path.resolve(__dirname, "..");

function loadPin() {
    const ctx = {
        console,
        window: { Pin: {} }
    };
    ctx.Pin = ctx.window.Pin;
    vm.createContext(ctx);
    [
        "app/table.js",
        "app/ruleGraph.js",
        "app/rules.js",
        "app/events.js",
        "app/logicStudio/core.js"
    ].forEach(function load(file) {
        vm.runInContext(fs.readFileSync(path.join(root, file), "utf8"), ctx, { filename: file });
    });
    return ctx.window.Pin;
}

function makeBaseTable() {
    return {
        version: 1,
        name: "Logic Studio Test",
        playfield: { width: 500, height: 880, gravity: 0.35, friction: 0.999, restitution: 0.55, maxSpeed: 24 },
        rules: { balls: 3, highScoreKey: "logic.studio.test" },
        rulesEngine: { switchMap: [], sequenceRules: [], logicGraphs: [], triggers: [], variables: [] },
        elements: [
            { id: "lane_a", type: "lane", x: 120, y: 100, w: 30, h: 18, score: 10 },
            { id: "drain_main", type: "drain", x: 250, y: 810, w: 80, h: 16 },
            { id: "lamp_flash", type: "light", x: 120, y: 130, radius: 8, lampId: "lamp_flash", color: "#ffee55" }
        ]
    };
}

function testCompileSyncsGraphs() {
    const Pin = loadPin();
    const table = makeBaseTable();
    table.rulesEngine.sequenceRules.push({
        id: "rule_lane",
        name: "Lane Rule",
        type: "sequence",
        enabled: true,
        ordered: true,
        steps: ["lane_a"],
        stepLampIds: [],
        conditions: [],
        actions: [],
        awardPoints: 50,
        awardEvent: "ruleAwarded",
        resetOnDrain: true,
        resetOnComplete: true,
        resetOnWrongOrder: false
    });
    const compiled = Pin.logicStudioCore.compileTable(table);
    assert(Array.isArray(compiled.rulesEngine.logicGraphs), "compile should keep logicGraphs array");
    assert(compiled.rulesEngine.logicGraphs.length >= 1, "compile should derive at least one graph from sequence rule");
    assert(compiled.rulesEngine.sequenceRules.length === 1, "compile should preserve sequence rules");
}

function testValidateCatchesDanglingEdge() {
    const Pin = loadPin();
    const table = makeBaseTable();
    table.rulesEngine.logicGraphs.push({
        id: "graph_bad",
        sourceRuleId: "rule_bad",
        name: "Bad",
        enabled: true,
        ordered: true,
        nodes: [{ id: "node_a", type: "start", x: 50, y: 50 }],
        edges: [{ id: "edge_a", from: "node_a", to: "missing_node" }]
    });
    const issues = Pin.logicStudioCore.validateLogic(table);
    assert(issues.some(function has(issue) {
        return issue.severity === "error" && String(issue.message || "").indexOf("unknown destination node") >= 0;
    }), "validation should report dangling graph edge targets");
}

function testSimulationTickTriggerAndVariableAction() {
    const Pin = loadPin();
    const table = makeBaseTable();
    table.rulesEngine.variables.push({ id: "flash", name: "Flash", properties: { value: false } });
    table.rulesEngine.triggers.push({
        id: "flash_timer",
        type: "interval",
        everySeconds: 1,
        switchId: "tick.flash",
        enabled: true
    });
    table.rulesEngine.sequenceRules.push({
        id: "rule_flash",
        name: "Flash Rule",
        type: "sequence",
        enabled: true,
        ordered: true,
        steps: ["tick.flash"],
        stepLampIds: [],
        conditions: [],
        actions: [
            { actionType: "toggleVariableProperty", variableId: "flash", property: "value" },
            { actionType: "setLampFromVariable", lampId: "lamp_flash", variableId: "flash", property: "value" }
        ],
        awardPoints: 0,
        awardEvent: "ruleAwarded",
        resetOnDrain: true,
        resetOnComplete: true,
        resetOnWrongOrder: false
    });
    const sim = Pin.logicStudioCore.createSimulationSession(table);
    sim.tick(1, 1);
    const snapshot = sim.snapshot();
    assert.strictEqual(snapshot.variables.flash.value, true, "timer tick should toggle variable to true");
    assert(snapshot.lamps.lamp_flash && snapshot.lamps.lamp_flash.on === true, "lamp should be set from variable after timer-driven action");
}

testCompileSyncsGraphs();
testValidateCatchesDanglingEdge();
testSimulationTickTriggerAndVariableAction();
console.log("logic studio core tests ok");
