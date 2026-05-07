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
        sources.push(src.split("?")[0]);
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

function loadFlipperModuleHarness() {
    // What: Load flipper compile logic with minimal runtime dependencies.
    // Why: Regression checks should exercise the production integration path.
    const pin = {
        elements: {
            registry: {},
            register: function register(type, mod) {
                this.registry[type] = mod;
            },
            getStateKey: function getStateKey(el) {
                return (el.type || "element") + ":" + (el.id || "anonymous");
            },
            getState: function getState(world, el, defaults) {
                const key = this.getStateKey(el);
                world.elementState = world.elementState || {};
                if (!world.elementState[key]) world.elementState[key] = Object.assign({}, defaults || {});
                return world.elementState[key];
            },
            peekState: function peekState(world, el) {
                if (!world || !world.elementState) return null;
                return world.elementState[this.getStateKey(el)] || null;
            }
        },
        render: { makeGlow: function makeGlow() {} }
    };
    const ctx = { window: { Pin: pin } };
    ctx.Pin = ctx.window.Pin;
    vm.createContext(ctx);
    vm.runInContext(read("app/elements/flipper.js"), ctx, { filename: "app/elements/flipper.js" });
    return ctx.window.Pin;
}

function loadAssistantModule(storage, injectedFetch) {
    const ctx = {
        window: { Pin: {}, localStorage: storage },
        localStorage: storage,
        fetch: injectedFetch,
        console: console
    };
    ctx.Pin = ctx.window.Pin;
    vm.createContext(ctx);
    vm.runInContext(read("app/editor/assistant.js"), ctx, { filename: "app/editor/assistant.js" });
    return ctx.window.Pin.editorAssistant;
}

function loadHighScoreModule(storage) {
    const ctx = {
        window: { Pin: {}, localStorage: storage },
        localStorage: storage,
        console: console
    };
    ctx.Pin = ctx.window.Pin;
    vm.createContext(ctx);
    vm.runInContext(read("app/highScores.js"), ctx, { filename: "app/highScores.js" });
    return ctx.window.Pin.highScores;
}

function memoryStorage() {
    const data = {};
    return {
        getItem: function getItem(key) {
            return Object.prototype.hasOwnProperty.call(data, key) ? data[key] : null;
        },
        setItem: function setItem(key, value) {
            data[key] = String(value);
        }
    };
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
    assert(sources.indexOf("app/logic/page.js") > sources.indexOf("app/editor/editor.js"), "logic scripts should load before app bootstrap");
    assert(sources.indexOf("app/main.js") === sources.length - 1, "app/main.js should remain the final bootstrap script");
}

function testDefaultTableNormalizesAndValidates() {
    const tableApi = loadTableModule();
    const table = tableApi.normalizeTable(JSON.parse(read("tables/DefTable.json")));
    const validation = tableApi.validateTable(table);

    assert.strictEqual(validation.ok, true, "tables/DefTable.json should normalize into a structurally valid table");
    assert.strictEqual(typeof table.rules.balls, "number", "default table should have a runtime ball count");
    table.rulesEngine = { switchMap: [], sequenceRules: [], triggers: [], variables: [], logicGraphs: {} };
    const withRules = tableApi.validateTable(table);
    assert.strictEqual(withRules.ok, true, "rulesEngine should be accepted when structurally valid");
}

function testDrainWithoutTroughIsPlayable() {
    const tableApi = loadTableModule();
    const table = tableApi.normalizeTable(JSON.parse(read("tables/ABC.json")));
    const issues = tableApi.validatePlayability(table);
    const troughWarning = issues.find(function find(issue) {
        return /No trough element/.test(issue.message || "");
    });

    assert.strictEqual(troughWarning, undefined, "a table with a drain should not warn that serving is limited only because it has no trough");
}

function testFlipperAngleStaysWithinAuthoredBounds() {
    // What: Run rapid press/release transitions through production flipper compile.
    // Why: Angle should never leave the authored motion interval.
    const pin = loadFlipperModuleHarness();
    const compile = pin.elements.registry.flipper.compile;
    const table = { playfield: { width: 500, height: 880 } };

    function runCase(flipper, controlsAtTick) {
        const world = {
            table: table,
            controls: { left: false, right: false },
            elementState: {},
            lastPhysicsDt: 1 / 120
        };
        const minAngle = Math.min(flipper.restAngle, flipper.activeAngle);
        const maxAngle = Math.max(flipper.restAngle, flipper.activeAngle);
        for (let tick = 0; tick < 300; tick++) {
            const controls = controlsAtTick(tick);
            world.controls.left = !!controls.left;
            world.controls.right = !!controls.right;
            compile(flipper, table, world);
            const state = world.elementState["flipper:" + flipper.id];
            assert(state && typeof state.angle === "number", "flipper state should include angle");
            assert(state.angle >= minAngle - 1e-9, "flipper angle should not go below min bound");
            assert(state.angle <= maxAngle + 1e-9, "flipper angle should not go above max bound");
        }
    }

    runCase({
        id: "lf",
        type: "flipper",
        side: "left",
        control: "left",
        pivot: { x: 135, y: 685 },
        length: 95,
        restAngle: 0.55,
        activeAngle: -0.55,
        flipSpeed: 24,
        flipAccel: 220,
        returnSpeed: 18,
        returnAccel: 160
    }, function controlsAtTick(tick) {
        const phase = tick % 7;
        return { left: phase < 2 || phase === 4 };
    });

    runCase({
        id: "rf",
        type: "flipper",
        side: "right",
        control: "right",
        pivot: { x: 365, y: 685 },
        length: 95,
        restAngle: Math.PI - 0.55,
        activeAngle: Math.PI + 0.55,
        flipSpeed: 24,
        flipAccel: 220,
        returnSpeed: 18,
        returnAccel: 160
    }, function controlsAtTick(tick) {
        const phase = tick % 9;
        return { right: phase === 0 || phase === 1 || phase === 5 };
    });
}

function testFeatureSchemaNormalizesAndValidates() {
    const tableApi = loadTableModule();
    const table = tableApi.normalizeTable({ version: 1, name: "Feature Test", playfield: {}, rules: {}, elements: [] });
    assert(Array.isArray(table.features), "normalizeTable should always provide a features array");

    table.features = [
        { id: "lhs_bonus", name: "Left Bonus", description: "Left side bonus flow.", goal: "Light and collect.", objects: ["a"], states: ["s1"], rules: ["A1"], lamps: ["l1"] }
    ];
    const validation = tableApi.validateTable(table);
    assert.strictEqual(validation.ok, true, "features metadata should validate when structurally correct");
}

function testBundledTableImagePathsExist() {
    const tableFiles = fs.readdirSync(path.join(root, "tables"))
        .filter(function keep(name) { return /\.json$/i.test(name); });
    tableFiles.forEach(function each(fileName) {
        const table = JSON.parse(read(path.join("tables", fileName)));
        const layers = Array.isArray(table.images) ? table.images : [];
        layers.forEach(function eachLayer(layer, index) {
            if (!layer || typeof layer.src !== "string") return;
            const src = layer.src.trim();
            if (!src || src.indexOf("tables/") !== 0) return;
            const relative = src.replace(/^tables\//, "");
            const resolved = path.join(root, "tables", relative);
            assert(fs.existsSync(resolved), "Missing bundled image for " + fileName + " images[" + index + "]: " + src);
        });
    });
}

function testExplicitTableRequestDoesNotSilentlyFallback() {
    const mainSource = read("app/main.js");
    assert(/hasExplicitTableRequest/.test(mainSource), "main bootstrap should track explicit table requests");
    assert(/fromLocal = hasExplicitTableRequest \? null/.test(mainSource), "explicit table requests should skip local autosave fallback");
    assert(/showBootError\(/.test(mainSource), "main bootstrap should surface explicit table load failures");
}

function testEditorCarriesTableAssetBaseIntoRendering() {
    const editorSource = read("app/editor/editor.js");
    assert(/tableAssetBaseHref/.test(editorSource), "editor should support tableAssetBaseHref option");
    assert(/tableAssetBaseHref:\s*tableAssetBaseHref/.test(editorSource), "editor render world should include tableAssetBaseHref");
}

function testHighScoresAreTableScopedSortedAndCapped() {
    const highScores = loadHighScoreModule(memoryStorage());
    const alpha = { name: "Alpha Table", rules: { highScoreKey: "pinball.generic.highscore" } };
    const beta = { name: "Beta Table", rules: { highScoreKey: "pinball.generic.highscore" } };

    assert.notStrictEqual(highScores.keyForTable(alpha), highScores.keyForTable(beta), "generic default highScoreKey should fall back to table name");
    assert.strictEqual(highScores.load(alpha).length, 0, "empty table should start with no high scores");

    highScores.add(alpha, "aaa", 100);
    highScores.add(alpha, "bbb", 600);
    highScores.add(alpha, "ccc", 300);
    highScores.add(alpha, "ddd", 500);
    highScores.add(alpha, "eee", 200);
    highScores.add(alpha, "fff", 400);

    const entries = highScores.load(alpha);
    assert.strictEqual(entries.length, 5, "leaderboard should keep top five entries");
    assert.strictEqual(entries.map(function scores(row) { return row.score; }).join(","), "600,500,400,300,200", "leaderboard should sort descending");
    assert.strictEqual(highScores.load(beta).length, 0, "different named tables should not share scores");
    assert.strictEqual(highScores.qualifies(alpha, 200), false, "equal bottom score should not qualify");
    assert.strictEqual(highScores.qualifies(alpha, 201), true, "score above bottom score should qualify");
}

function testHighScoresUseExplicitKeyAndThreeInitials() {
    const highScores = loadHighScoreModule(memoryStorage());
    const first = { name: "First Name", rules: { highScoreKey: "Shared Key" } };
    const second = { name: "Second Name", rules: { highScoreKey: "Shared Key" } };

    assert.strictEqual(highScores.keyForTable(first), highScores.keyForTable(second), "custom highScoreKey should override table name");
    assert.strictEqual(highScores.normalizeInitials(" a-b4 "), "AB4", "initials should uppercase and strip punctuation");
    highScores.add(first, "xy", 900);
    assert.strictEqual(highScores.load(first).length, 0, "scores with fewer than three initials should not save");
    highScores.add(first, "xy9", 900);
    assert.strictEqual(highScores.load(second)[0].initials, "XY9", "shared explicit key should load saved initials");
}

function testAssistantProviderSettingsPersist() {
    const storage = memoryStorage();
    const assistantApi = loadAssistantModule(storage);
    const first = assistantApi.create();
    first.setSettings({
        providerLabel: "Local",
        baseUrl: "http://localhost:1234/v1",
        model: "test-model",
        apiKey: "secret",
        maxSteps: 7
    });

    const second = assistantApi.create();
    const settings = second.getState().settings;
    assert.strictEqual(settings.providerLabel, "Local", "assistant provider label should persist");
    assert.strictEqual(settings.baseUrl, "http://localhost:1234/v1", "assistant base URL should persist");
    assert.strictEqual(settings.model, "test-model", "assistant model should persist");
    assert.strictEqual(settings.apiKey, "secret", "assistant API key should persist");
    assert.strictEqual(settings.maxSteps, 7, "assistant max steps should persist");
}

function testAssistantProviderConnectionAndModelFeedback() {
    const storage = memoryStorage();
    const mockFetch = function mockFetch() {
        return Promise.resolve({
            ok: true,
            json: function json() {
                return Promise.resolve({ data: [{ id: "from-provider-1" }, { id: "from-provider-2" }] });
            }
        });
    };
    const assistantApi = loadAssistantModule(storage, mockFetch);
    const runtime = assistantApi.create();
    runtime.setSettings({
        providerLabel: "Local",
        baseUrl: "http://localhost:1234/v1",
        model: "test-model",
        apiKey: "secret",
        maxSteps: 7
    });

    return runtime.testConnection().then(function afterTest() {
        const afterConnection = runtime.getState();
        assert.strictEqual(afterConnection.connectionStatus, "Configuration valid (static mode)", "test connection should produce a visible success status");
        return runtime.loadModels().then(function afterLoad(models) {
            assert(Array.isArray(models), "loadModels should resolve with an array");
            assert.strictEqual(models.length, 3, "configured model plus provider models should be listed");
            assert.strictEqual(models[0].id, "test-model", "configured model should be first when absent from provider list");
            assert.strictEqual(models[1].id, "from-provider-1", "first provider model should be listed");
            assert.strictEqual(models[2].id, "from-provider-2", "second provider model should be listed");
            const afterLoadState = runtime.getState();
            assert.strictEqual(afterLoadState.connectionStatus, "Models loaded", "load models should produce a visible success status");
            assert.strictEqual(afterLoadState.busy, false, "assistant should not remain busy after provider actions");
        });
    });
}

function testAssistantConnectionRequiresBaseUrlAndApiKeyOnly() {
    const storage = memoryStorage();
    const assistantApi = loadAssistantModule(storage);
    const runtime = assistantApi.create();
    runtime.setSettings({
        providerLabel: "Local",
        baseUrl: "http://localhost:1234/v1",
        model: "",
        apiKey: "secret",
        maxSteps: 4
    });
    return runtime.testConnection().then(function afterTest() {
        const state = runtime.getState();
        assert.strictEqual(state.connectionStatus, "Configuration valid (static mode)", "model should not be required for static connection check");
    });
}

function testAssistantLoadModelsRequiresProviderSettings() {
    const storage = memoryStorage();
    const assistantApi = loadAssistantModule(storage, function unusedFetch() {
        throw new Error("fetch should not be called when settings are missing");
    });
    const runtime = assistantApi.create();
    runtime.setSettings({
        providerLabel: "Local",
        baseUrl: "",
        model: "",
        apiKey: "",
        maxSteps: 4
    });
    return runtime.loadModels().then(function afterLoad(models) {
        assert(Array.isArray(models), "loadModels should resolve with an array when settings are missing");
        assert.strictEqual(models.length, 0, "missing provider settings should not produce model options");
        const state = runtime.getState();
        assert.strictEqual(state.connectionStatus, "Missing required provider settings: baseUrl, apiKey", "missing settings should be explicit in status");
    });
}

function loadLogicModules() {
    const ctx = { window: { Pin: {} }, console: console };
    ctx.Pin = ctx.window.Pin;
    vm.createContext(ctx);
    vm.runInContext(read("app/table.js"), ctx, { filename: "app/table.js" });
    vm.runInContext(read("app/logic/logicTypes.js"), ctx, { filename: "app/logic/logicTypes.js" });
    vm.runInContext(read("app/logic/expressions.js"), ctx, { filename: "app/logic/expressions.js" });
    vm.runInContext(read("app/logic/validate.js"), ctx, { filename: "app/logic/validate.js" });
    vm.runInContext(read("app/logic/simulate.js"), ctx, { filename: "app/logic/simulate.js" });
    vm.runInContext(read("app/logic/compile.js"), ctx, { filename: "app/logic/compile.js" });
    return ctx.window.Pin;
}

function testAssistantChatUsesProviderPath() {
    const storage = memoryStorage();
    const assistantApi = loadAssistantModule(storage, function mockFetch() {
        return Promise.resolve({
            ok: true,
            json: function json() {
                return Promise.resolve({
                    choices: [{
                        message: {
                            content: JSON.stringify({
                                logicDocPatch: {
                                    logicVersion: 1,
                                    switchRegistry: [{ id: "dt_left", sourceElementId: "dt_left", kind: "switch" }],
                                    stateTable: [{ id: "dt_left_lit", type: "bool", initial: false, volatile: true }],
                                    computedState: [],
                                    lampBindings: [{ lampId: "dt_left", expr: "dt_left_lit" }],
                                    actionRules: [{ id: "A_LIGHT_DT_LEFT", trigger: "dt_left", condition: "!dt_left_lit", effects: [{ type: "set", target: "dt_left_lit", value: true }], enabled: true }],
                                    resetRules: []
                                }
                            })
                        }
                    }]
                });
            }
        });
    });
    const table = {
        version: 1,
        name: "Chat Path",
        playfield: {},
        rules: {},
        elements: [
            { id: "dt_left", type: "dropTarget", name: "DT Left" }
        ],
        rulesEngine: { logicGraphs: { logicDocument: { logicVersion: 1, switchRegistry: [], stateTable: [], computedState: [], lampBindings: [], actionRules: [], resetRules: [] } } }
    };
    const runtime = assistantApi.create({
        getTable: function getTable() { return table; },
        getSelected: function getSelected() { return null; },
        previewPatch: function previewPatch() { return { ok: true, issuesCount: 0 }; },
        applyPatch: function applyPatch() { return { ok: true }; },
        refresh: function refresh() {}
    });
    runtime.setSettings({
        providerLabel: "Local",
        baseUrl: "http://localhost:1234/v1",
        model: "test-model",
        apiKey: "secret",
        maxSteps: 4
    });
    runtime.setDraft("just provide logic to light up targets when they are hit");
    return runtime.send().then(function done() {
        const state = runtime.getState();
        assert(state.lastPatch && state.lastPatch.logicDocPatch, "chat should store provider-produced logicDocPatch");
        const rules = state.lastPatch.logicDocPatch.actionRules || [];
        const lamps = state.lastPatch.logicDocPatch.lampBindings || [];
        assert(rules.some(function some(rule) { return rule && rule.trigger === "dt_left"; }), "chat/provider patch should include hit rule for drop target");
        assert(lamps.some(function some(binding) { return binding && binding.lampId === "dt_left"; }), "chat/provider patch should include lamp binding for drop target");
    });
}

function testAgenticBypassesShortcutAndRequiresProvider() {
    const storage = memoryStorage();
    const assistantApi = loadAssistantModule(storage, function noFetch() {
        throw new Error("fetch should not be called");
    });
    const table = {
        version: 1,
        name: "Agentic",
        playfield: {},
        rules: {},
        elements: [{ id: "dt_left", type: "dropTarget", name: "DT Left" }],
        rulesEngine: { logicGraphs: { logicDocument: { logicVersion: 1, switchRegistry: [], stateTable: [], computedState: [], lampBindings: [], actionRules: [], resetRules: [] } } }
    };
    const runtime = assistantApi.create({
        getTable: function getTable() { return table; },
        getSelected: function getSelected() { return null; },
        previewPatch: function previewPatch() { return { ok: true, issuesCount: 0 }; },
        applyPatch: function applyPatch() { return { ok: true }; },
        refresh: function refresh() {}
    });
    runtime.setAgenticDraft("light targets when hit");
    return runtime.runAgentic().then(function done() {
        const state = runtime.getState();
        assert.strictEqual(!!state.agenticPendingPatch, false, "agentic should not use deterministic shortcut patch");
        assert(state.error && /Missing required provider settings/.test(state.error), "agentic should use provider path and fail without provider settings");
    });
}

function testAssistantRepairsPatchAcrossAttempts() {
    const storage = memoryStorage();
    let call = 0;
    const assistantApi = loadAssistantModule(storage, function mockFetch() {
        call += 1;
        if (call === 1) {
            return Promise.resolve({
                ok: true,
                json: function json() {
                    return Promise.resolve({
                        choices: [{ message: { content: JSON.stringify({ logicDocPatch: { actionRules: [] } }) } }]
                    });
                }
            });
        }
        return Promise.resolve({
            ok: true,
            json: function json() {
                return Promise.resolve({
                    choices: [{
                        message: {
                            content: JSON.stringify({
                                logicDocPatch: {
                                    logicVersion: 1,
                                    switchRegistry: [{ id: "dt_left", sourceElementId: "dt_left", kind: "switch" }],
                                    stateTable: [{ id: "dt_left_lit", type: "bool", initial: false, volatile: true }],
                                    computedState: [],
                                    lampBindings: [{ lampId: "dt_left", expr: "dt_left_lit" }],
                                    actionRules: [{ id: "A_LIGHT_DT_LEFT", trigger: "dt_left", condition: "!dt_left_lit", effects: [{ type: "set", target: "dt_left_lit", value: true }], enabled: true }],
                                    resetRules: []
                                }
                            })
                        }
                    }]
                });
            }
        });
    });
    const table = {
        version: 1,
        name: "Repair Loop",
        playfield: {},
        rules: {},
        elements: [{ id: "dt_left", type: "dropTarget", name: "DT Left" }],
        rulesEngine: { logicGraphs: { logicDocument: { logicVersion: 1, switchRegistry: [], stateTable: [], computedState: [], lampBindings: [], actionRules: [], resetRules: [] } } }
    };
    const runtime = assistantApi.create({
        getTable: function getTable() { return table; },
        getSelected: function getSelected() { return null; },
        previewPatch: function previewPatch(patch) {
            const rows = patch && patch.logicDocPatch && patch.logicDocPatch.actionRules;
            if (!Array.isArray(rows) || !rows.length) {
                return { ok: false, issuesCount: 1, issues: [{ severity: "error", message: "actionRules missing" }], error: "missing action rules" };
            }
            return { ok: true, issuesCount: 0, issues: [] };
        },
        applyPatch: function applyPatch() { return { ok: true }; },
        refresh: function refresh() {}
    });
    runtime.setSettings({
        providerLabel: "Local",
        baseUrl: "http://localhost:1234/v1",
        model: "test-model",
        apiKey: "secret",
        maxSteps: 3
    });
    runtime.setDraft("wire target to light on hit");
    return runtime.send().then(function done() {
        const state = runtime.getState();
        assert.strictEqual(call >= 2, true, "assistant should retry when preview fails");
        assert(state.lastPatch && state.lastPatch.logicDocPatch, "assistant should end with valid logic patch");
        assert.strictEqual(state.error, "", "assistant should clear error after successful repair");
    });
}

function testAssistantRepairsContractValidationFailures() {
    const storage = memoryStorage();
    let call = 0;
    const assistantApi = loadAssistantModule(storage, function mockFetch() {
        call += 1;
        if (call === 1) {
            return Promise.resolve({
                ok: true,
                json: function json() {
                    return Promise.resolve({
                        choices: [{ message: { content: JSON.stringify({ badKey: true }) } }]
                    });
                }
            });
        }
        return Promise.resolve({
            ok: true,
            json: function json() {
                return Promise.resolve({
                    choices: [{
                        message: {
                            content: JSON.stringify({
                                logicDocPatch: {
                                    logicVersion: 1,
                                    switchRegistry: [{ id: "dt_left", sourceElementId: "dt_left", kind: "switch" }],
                                    stateTable: [{ id: "dt_left_lit", type: "bool", initial: false, volatile: true }],
                                    computedState: [],
                                    lampBindings: [{ lampId: "dt_left", expr: "dt_left_lit" }],
                                    actionRules: [{ id: "A_LIGHT_DT_LEFT", trigger: "dt_left", condition: "!dt_left_lit", effects: [{ type: "set", target: "dt_left_lit", value: true }], enabled: true }],
                                    resetRules: []
                                }
                            })
                        }
                    }]
                });
            }
        });
    });
    const table = {
        version: 1,
        name: "Contract Repair",
        playfield: {},
        rules: {},
        elements: [{ id: "dt_left", type: "dropTarget", name: "DT Left" }],
        rulesEngine: { logicGraphs: { logicDocument: { logicVersion: 1, switchRegistry: [], stateTable: [], computedState: [], lampBindings: [], actionRules: [], resetRules: [] } } }
    };
    const runtime = assistantApi.create({
        getTable: function getTable() { return table; },
        getSelected: function getSelected() { return null; },
        previewPatch: function previewPatch() { return { ok: true, issuesCount: 0, issues: [] }; },
        applyPatch: function applyPatch() { return { ok: true }; },
        refresh: function refresh() {}
    });
    runtime.setSettings({
        providerLabel: "Local",
        baseUrl: "http://localhost:1234/v1",
        model: "test-model",
        apiKey: "secret",
        maxSteps: 3
    });
    runtime.setDraft("wire target to light on hit");
    return runtime.send().then(function done() {
        const state = runtime.getState();
        assert.strictEqual(call >= 2, true, "assistant should retry after contract validation failure");
        assert(state.lastPatch && state.lastPatch.logicDocPatch, "assistant should recover with valid contract patch");
    });
}

function testAssistantReportsExhaustedContractIssues() {
    const storage = memoryStorage();
    const assistantApi = loadAssistantModule(storage, function mockFetch() {
        return Promise.resolve({
            ok: true,
            json: function json() {
                return Promise.resolve({
                    choices: [{ message: { content: JSON.stringify({ badKey: true }) } }]
                });
            }
        });
    });
    const runtime = assistantApi.create({
        getTable: function getTable() { return { version: 1, name: "Contract Exhausted", playfield: {}, rules: {}, elements: [] }; },
        getSelected: function getSelected() { return null; },
        previewPatch: function previewPatch() { return { ok: true, issuesCount: 0, issues: [] }; },
        applyPatch: function applyPatch() { return { ok: true }; },
        refresh: function refresh() {}
    });
    runtime.setSettings({
        providerLabel: "Local",
        baseUrl: "http://localhost:1234/v1",
        model: "test-model",
        apiKey: "secret",
        maxSteps: 1
    });
    runtime.setAgenticDraft("Create invalid patch forever.");
    return runtime.runAgentic().then(function done() {
        const state = runtime.getState();
        assert(/Last contract issues/.test(state.error), "agentic final error should say contract issues were the blocker");
        assert(/Unsupported patch key: badKey/.test(state.error), "agentic final error should expose exact contract issue");
    });
}

function testAssistantRepairsInvalidFeaturePatchShape() {
    const storage = memoryStorage();
    let call = 0;
    const assistantApi = loadAssistantModule(storage, function mockFetch() {
        call += 1;
        if (call === 1) {
            return Promise.resolve({
                ok: true,
                json: function json() {
                    return Promise.resolve({
                        choices: [{ message: { content: JSON.stringify({ addFeatures: [{ id: "lhs_bonus", name: 42, states: ["lhs_ready"] }] }) } }]
                    });
                }
            });
        }
        return Promise.resolve({
            ok: true,
            json: function json() {
                return Promise.resolve({
                    choices: [{ message: { content: JSON.stringify({ addFeatures: [{ id: "lhs_bonus", name: "Left Bonus", description: "Left target bank collect flow.", goal: "Light then collect.", objects: ["dt_left"], states: ["lhs_ready"], rules: ["A_LHS_COLLECT"], lamps: ["lhs_arrow"] }] }) } }]
                });
            }
        });
    });
    const table = {
        version: 1,
        name: "Feature Repair",
        playfield: {},
        rules: {},
        elements: [{ id: "dt_left", type: "dropTarget", name: "DT Left" }, { id: "lhs_arrow", type: "arrowLight", name: "LHS Arrow" }],
        features: [],
        rulesEngine: { logicGraphs: { logicDocument: { logicVersion: 1, switchRegistry: [], stateTable: [], computedState: [], lampBindings: [], actionRules: [], resetRules: [] } } }
    };
    const runtime = assistantApi.create({
        getTable: function getTable() { return table; },
        getSelected: function getSelected() { return null; },
        previewPatch: function previewPatch() { return { ok: true, issuesCount: 0, issues: [] }; },
        applyPatch: function applyPatch() { return { ok: true }; },
        refresh: function refresh() {}
    });
    runtime.setSettings({
        providerLabel: "Local",
        baseUrl: "http://localhost:1234/v1",
        model: "test-model",
        apiKey: "secret",
        maxSteps: 3
    });
    runtime.setDraft("Create a feature for left bonus progression.");
    return runtime.send().then(function done() {
        const state = runtime.getState();
        assert.strictEqual(call >= 2, true, "assistant should retry after invalid feature patch shape");
        assert(state.lastPatch && Array.isArray(state.lastPatch.addFeatures), "assistant should recover with valid addFeatures payload");
        assert.strictEqual(state.lastPatch.addFeatures[0].name, "Left Bonus", "repaired feature patch should carry valid string fields");
    });
}

function testLogicDocRoundTripUsesCurrentSchema() {
    const pin = loadLogicModules();
    const table = pin.table.createEmptyTable();
    table.features = [{ id: "lhs_bonus", name: "Left Bonus", states: ["lhs_ready"], rules: ["A_LHS_COLLECT"] }];
    const logicDoc = {
        logicVersion: 1,
        switchRegistry: [{ id: "lhs_lane", sourceElementId: "lane_lhs", kind: "switch" }],
        stateTable: [{ id: "lhs_ready", type: "bool", initial: false, volatile: true }],
        computedState: [{ id: "mega_ready", type: "bool", expr: "lhs_ready" }],
        lampBindings: [{ lampId: "lhs_arrow", expr: "lhs_ready" }],
        actionRules: [{ id: "A_LHS_COLLECT", trigger: "lhs_lane", condition: "lhs_ready", effects: [{ type: "score", value: 3000 }], enabled: true }],
        resetRules: [{ id: "R_DRAIN", trigger: "drain", scope: "volatile", resets: ["lhs_ready"] }]
    };
    const compiled = pin.logicCompile.applyToTable(table, logicDoc);
    const extracted = pin.logicCompile.extractFromTable(compiled);
    assert.strictEqual(extracted.logicVersion, 1, "logic version should be preserved through compile/extract");
    assert.strictEqual(Array.isArray(extracted.switchRegistry), true, "switch registry should remain in current schema");
    assert.strictEqual(Array.isArray(extracted.stateTable), true, "state table should remain in current schema");
    assert.strictEqual(Array.isArray(extracted.computedState), true, "computed state should remain in current schema");
    assert.strictEqual(Array.isArray(extracted.lampBindings), true, "lamp bindings should remain in current schema");
    assert.strictEqual(Array.isArray(extracted.actionRules), true, "action rules should remain in current schema");
    assert.strictEqual(Array.isArray(extracted.resetRules), true, "reset rules should remain in current schema");
    assert.strictEqual(Array.isArray(compiled.features), true, "table features should survive logic compile");
    assert.strictEqual(compiled.features[0].id, "lhs_bonus", "feature metadata should remain intact");
}

function testTimerSwitchValidationAndSimulation() {
    const pin = loadLogicModules();
    const doc = {
        logicVersion: 1,
        switchRegistry: [
            { id: "timer_1s", sourceElementId: "timer_1s", kind: "timer", intervalMs: 1000 }
        ],
        stateTable: [
            { id: "ticks", type: "int", initial: 0, volatile: true }
        ],
        computedState: [],
        lampBindings: [],
        actionRules: [
            { id: "A_TICK", trigger: "timer_1s", condition: "", effects: [{ type: "add", target: "ticks", value: 1 }], enabled: true }
        ],
        resetRules: []
    };
    const validation = pin.logicValidate.validateDocument(doc, { switchCandidates: [], lampCandidates: [] });
    assert.strictEqual(validation.ok, true, "timer switches should validate without physical source element candidates");

    const runtime = pin.logicSim.createRuntime(doc);
    pin.logicSim.advanceTime(runtime, 0.4);
    assert.strictEqual(runtime.values.ticks, 0, "timer should not fire before interval");
    pin.logicSim.advanceTime(runtime, 0.7);
    assert.strictEqual(runtime.values.ticks, 1, "timer should fire once after 1s accumulated");
    pin.logicSim.advanceTime(runtime, 2.2);
    assert.strictEqual(runtime.values.ticks, 3, "timer should fire repeatedly for larger elapsed windows");
}

Promise.resolve()
    .then(function run() { testIndexScriptsExistAndOrderCoreBeforeMain(); })
    .then(function run() { testDefaultTableNormalizesAndValidates(); })
    .then(function run() { testDrainWithoutTroughIsPlayable(); })
    .then(function run() { testFlipperAngleStaysWithinAuthoredBounds(); })
    .then(function run() { testFeatureSchemaNormalizesAndValidates(); })
    .then(function run() { testBundledTableImagePathsExist(); })
    .then(function run() { testExplicitTableRequestDoesNotSilentlyFallback(); })
    .then(function run() { testEditorCarriesTableAssetBaseIntoRendering(); })
    .then(function run() { testHighScoresAreTableScopedSortedAndCapped(); })
    .then(function run() { testHighScoresUseExplicitKeyAndThreeInitials(); })
    .then(function run() { testAssistantProviderSettingsPersist(); })
    .then(function run() { return testAssistantProviderConnectionAndModelFeedback(); })
    .then(function run() { return testAssistantConnectionRequiresBaseUrlAndApiKeyOnly(); })
    .then(function run() { return testAssistantLoadModelsRequiresProviderSettings(); })
    .then(function run() { return testAssistantChatUsesProviderPath(); })
    .then(function run() { return testAgenticBypassesShortcutAndRequiresProvider(); })
    .then(function run() { return testAssistantRepairsPatchAcrossAttempts(); })
    .then(function run() { return testAssistantRepairsContractValidationFailures(); })
    .then(function run() { return testAssistantReportsExhaustedContractIssues(); })
    .then(function run() { return testAssistantRepairsInvalidFeaturePatchShape(); })
    .then(function run() { testLogicDocRoundTripUsesCurrentSchema(); })
    .then(function run() { testTimerSwitchValidationAndSimulation(); })
    .then(function done() {
        console.log("smoke tests ok");
    })
    .catch(function fail(err) {
        console.error(err);
        process.exitCode = 1;
    });
