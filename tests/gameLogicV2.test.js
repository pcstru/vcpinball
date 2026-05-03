// What: Unit tests for TBGameLogic v2 source validation and compilation.
// Why: feature-authored logic must reliably compile to runtime rulesEngine data.
const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const root = path.resolve(__dirname, "..");

/*
 * What: Load runtime/compiler modules into a VM context.
 * Why: tests should execute the browser modules without DOM dependencies.
 */
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
        "app/gameLogicV2.js"
    ].forEach(function load(file) {
        vm.runInContext(fs.readFileSync(path.join(root, file), "utf8"), ctx, { filename: file });
    });
    return ctx.window.Pin;
}

function makeTable() {
    return {
        version: 1,
        name: "Game Logic Test",
        playfield: { width: 500, height: 880, gravity: 0.35, friction: 0.999, restitution: 0.55, maxSpeed: 24 },
        rules: { balls: 3, highScoreKey: "gamelogic.test" },
        rulesEngine: { switchMap: [], sequenceRules: [], logicGraphs: [], triggers: [], variables: [] },
        elements: [
            { id: "signal", type: "lane", score: 100 },
            { id: "context", type: "lane", score: 100 },
            { id: "priority", type: "lane", score: 100 },
            { id: "return_loop", type: "lane", score: 250 },
            { id: "drain_main", type: "drain" },
            { id: "lamp_signal", type: "light", lampId: "lamp_signal" },
            { id: "lamp_ai_assist", type: "light", lampId: "lamp_ai_assist" }
        ]
    };
}

function testCompileFeatureSet() {
    const Pin = loadPin();
    const source = {
        version: 2,
        shots: [
            { id: "signal", switches: ["signal"], lamps: ["lamp_signal"], baseScore: 100 },
            { id: "context", switches: ["context"], lamps: [], baseScore: 100 },
            { id: "priority", switches: ["priority"], lamps: [], baseScore: 100 }
        ],
        features: [
            {
                id: "intake_quality",
                type: "set",
                shots: ["signal", "context", "priority"],
                ordered: false,
                onComplete: { award: 2500, light: ["lamp_ai_assist"] },
                reset: "on_ball_drain"
            }
        ],
        modes: [],
        awards: [],
        resets: [{ onDrain: ["intake_quality"] }]
    };
    const result = Pin.gameLogicV2.compile(source, makeTable());
    assert.strictEqual(result.ok, true, "compile should succeed");
    const runtime = result.table.rulesEngine;
    const featureRule = runtime.sequenceRules.find(function find(rule) { return rule.id === "gl_feature_intake_quality"; });
    assert(featureRule, "compiled feature rule should exist");
    assert.strictEqual(featureRule.ordered, false, "set feature should retain unordered behavior");
    assert.strictEqual(featureRule.awardPoints, 2500, "feature rule should carry onComplete award");
    assert(featureRule.actions.some(function has(action) { return action.actionType === "setLamp" && action.lampId === "lamp_ai_assist"; }), "feature should light completion lamp");
}

function testCompileModeAndAward() {
    const Pin = loadPin();
    const source = {
        version: 2,
        shots: [
            { id: "signal", switches: ["signal"], baseScore: 100 },
            { id: "return_loop", switches: ["return_loop"], baseScore: 250 }
        ],
        features: [
            { id: "intake_set", type: "set", shots: ["signal"], ordered: true }
        ],
        modes: [
            {
                id: "assist_mode",
                startsWhen: "intake_set.complete",
                durationSeconds: 2,
                effects: [{ type: "scoreMultiplier", shot: "return_loop", multiplier: 3 }, { type: "flashLamp", lamp: "lamp_ai_assist" }]
            }
        ],
        awards: [
            {
                id: "return_collect",
                litWhen: "intake_set.complete",
                collectShot: "return_loop",
                award: 5000
            }
        ],
        resets: []
    };
    const result = Pin.gameLogicV2.compile(source, makeTable());
    assert.strictEqual(result.ok, true, "compile should succeed");
    const runtime = result.table.rulesEngine;
    assert(runtime.triggers.some(function has(trigger) { return trigger.switchId === "tick.gamelogic"; }), "mode compile should add runtime tick trigger");
    assert(runtime.sequenceRules.some(function has(rule) { return rule.id === "gl_mode_start_assist_mode"; }), "mode start rule should exist");
    assert(runtime.sequenceRules.some(function has(rule) { return rule.id === "gl_mode_end_assist_mode"; }), "mode end rule should exist");
    const awardRule = runtime.sequenceRules.find(function find(rule) { return rule.id === "gl_award_return_collect"; });
    assert(awardRule, "award collect rule should exist");
    assert.strictEqual(awardRule.awardPoints, 5000, "award points should compile");
}

function testValidateErrors() {
    const Pin = loadPin();
    const issues = Pin.gameLogicV2.validate({
        version: 2,
        shots: [{ id: "signal", switches: ["missing_switch"] }],
        features: [{ id: "set1", type: "set", shots: ["missing_shot"] }],
        modes: [{ id: "m1", startsWhen: "invalidExpr" }],
        awards: [],
        resets: []
    }, makeTable());
    assert(issues.some(function has(issue) { return issue.severity === "error"; }), "invalid source should produce errors");
}

testCompileFeatureSet();
testCompileModeAndAward();
testValidateErrors();
console.log("game logic v2 tests ok");
