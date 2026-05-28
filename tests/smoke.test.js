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

function localAssetUrls(html) {
    const urls = [];
    html.replace(/<(?:script|link)\b[^>]*(?:src|href)="([^"]+)"/g, function collect(_, url) {
        if (/^(app|lib)\//.test(url)) urls.push(url);
        return "";
    });
    return urls;
}

function loadTableModule() {
    const ctx = { window: { Pin: {} } };
    ctx.Pin = ctx.window.Pin;
    vm.createContext(ctx);
    vm.runInContext(read("app/table.js"), ctx, { filename: "app/table.js" });
    return ctx.window.Pin.table;
}

function loadTableCatalog() {
    // What: Load the static table selector manifest in isolation.
    // Why: bundled table discovery is explicit, so broken catalog entries should
    // fail smoke checks before the browser tries to render selector cards.
    const ctx = { window: { Pin: {} } };
    ctx.Pin = ctx.window.Pin;
    vm.createContext(ctx);
    vm.runInContext(read("app/tableCatalog.js"), ctx, { filename: "app/tableCatalog.js" });
    return ctx.window.Pin.tableCatalog;
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

function loadSpinnerModuleHarness() {
    // What: Load spinner compile logic with minimal runtime dependencies.
    // Why: spinner blades should score and animate without acting as solid walls.
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
            peekState: function peekState() { return null; }
        },
        events: { emit: function emit() {} }
    };
    const ctx = { window: { Pin: pin }, performance: { now: function now() { return 0; } } };
    ctx.Pin = ctx.window.Pin;
    vm.createContext(ctx);
    vm.runInContext(read("app/elements/spinner.js"), ctx, { filename: "app/elements/spinner.js" });
    return ctx.window.Pin;
}

function loadGateModuleHarness() {
    // What: Load gate compile logic with minimal runtime dependencies.
    // Why: gate direction modes must be regression-tested outside the browser.
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
            peekState: function peekState() { return null; }
        },
        events: { emit: function emit() {} },
        render: { makeGlow: function makeGlow() {} }
    };
    const ctx = { window: { Pin: pin } };
    ctx.Pin = ctx.window.Pin;
    vm.createContext(ctx);
    vm.runInContext(read("app/elements/gate.js"), ctx, { filename: "app/elements/gate.js" });
    return ctx.window.Pin;
}

function loadEditorHitTestHarness() {
    // What: Load editor hit-test helpers with only the tool methods they need.
    // Why: Gate handle math should be regression-tested without a browser canvas.
    const pin = {
        editorTools: {
            worldToScreen: function worldToScreen(point) { return point; }
        }
    };
    const ctx = { window: { Pin: pin } };
    ctx.Pin = ctx.window.Pin;
    vm.createContext(ctx);
    vm.runInContext(read("app/editor/hitTest.js"), ctx, { filename: "app/editor/hitTest.js" });
    return ctx.window.Pin.editorHitTest;
}

function loadElementRegistryHarness() {
    // What: Load the element registry with tiny fake modules.
    // Why: Runtime split behavior should be testable without a browser canvas.
    const pin = {
        elements: {
            registry: {},
            register: function register(type, mod) {
                this.registry[type] = mod;
            }
        }
    };
    const ctx = { window: { Pin: pin } };
    ctx.Pin = ctx.window.Pin;
    vm.createContext(ctx);
    vm.runInContext(read("app/elements/index.js"), ctx, { filename: "app/elements/index.js" });
    ["path", "light", "dropTarget", "kicker", "flipper", "launcher"].forEach(function each(type) {
        pin.elements.registry[type] = {
            compile: function compile(el) {
                return { segments: [{ x1: 0, y1: 0, x2: 1, y2: 1, elementType: el.type }] };
            },
            draw: function draw() {}
        };
    });
    return pin;
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
    vm.runInContext(read("app/editor/model.js"), ctx, { filename: "app/editor/model.js" });
    vm.runInContext(read("app/editor/assistantTools.js"), ctx, { filename: "app/editor/assistantTools.js" });
    vm.runInContext(read("app/editor/assistant.js"), ctx, { filename: "app/editor/assistant.js" });
    return ctx.window.Pin.editorAssistant;
}

function loadAssistantToolsModule() {
    const ctx = { window: { Pin: {} } };
    ctx.Pin = ctx.window.Pin;
    vm.createContext(ctx);
    vm.runInContext(read("app/editor/model.js"), ctx, { filename: "app/editor/model.js" });
    vm.runInContext(read("app/editor/assistantTools.js"), ctx, { filename: "app/editor/assistantTools.js" });
    return ctx.window.Pin.editorAssistantTools;
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

function loadPerformanceModule() {
    // What: Load performance helpers in an isolated VM context.
    // Why: Adaptive quality behavior should be regression-tested without DOM setup.
    const ctx = { window: { Pin: {} } };
    ctx.Pin = ctx.window.Pin;
    vm.createContext(ctx);
    vm.runInContext(read("app/performance.js"), ctx, { filename: "app/performance.js" });
    return ctx.window.Pin.performance;
}

function loadRenderModuleHarness() {
    // What: Load render helpers without constructing browser DOM objects.
    // Why: runtime visual effects should be testable outside a canvas.
    const ctx = { window: { Pin: {} } };
    ctx.Pin = ctx.window.Pin;
    vm.createContext(ctx);
    vm.runInContext(read("app/render.js"), ctx, { filename: "app/render.js" });
    return ctx.window.Pin.render;
}

function loadPhysicsModuleHarness(pin) {
    // What: Load physics against a supplied Pin object.
    // Why: collision side effects can be checked with small fake render hooks.
    const ctx = { window: { Pin: pin } };
    ctx.Pin = ctx.window.Pin;
    vm.createContext(ctx);
    vm.runInContext(read("app/physics.js"), ctx, { filename: "app/physics.js" });
    return ctx.window.Pin.physics;
}

function loadStorageModuleHarness(storage) {
    // What: Load storage helpers against a fake localStorage implementation.
    // Why: browser-memory wipe behavior should be checked without a browser.
    const ctx = {
        window: { Pin: {}, localStorage: storage },
        localStorage: storage,
        Blob: function Blob() {},
        URL: { createObjectURL: function createObjectURL() { return ""; }, revokeObjectURL: function revokeObjectURL() {} },
        document: { createElement: function createElement() { return {}; } }
    };
    ctx.Pin = ctx.window.Pin;
    vm.createContext(ctx);
    vm.runInContext(read("app/storage.js"), ctx, { filename: "app/storage.js" });
    return ctx.window.Pin.storage;
}

function memoryStorage() {
    const data = {};
    return {
        get length() {
            return Object.keys(data).length;
        },
        key: function key(index) {
            return Object.keys(data)[index] || null;
        },
        getItem: function getItem(key) {
            return Object.prototype.hasOwnProperty.call(data, key) ? data[key] : null;
        },
        setItem: function setItem(key, value) {
            data[key] = String(value);
        },
        removeItem: function removeItem(key) {
            delete data[key];
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
    assert(sources.indexOf("app/tableCatalog.js") > sources.indexOf("app/storage.js"), "table catalog should load after storage helpers");
    assert(sources.indexOf("app/editor/assistantTools.js") > sources.indexOf("app/editor/model.js"), "assistant tools should load after editor model");
    assert(sources.indexOf("app/editor/assistant.js") > sources.indexOf("app/editor/assistantTools.js"), "assistant runtime should load after assistant tools");
    assert(sources.indexOf("app/performance.js") > sources.indexOf("app/logic/page.js"), "performance helpers should load after logic scripts");
    assert(sources.indexOf("app/performance.js") < sources.indexOf("app/main.js"), "performance helpers should load before app bootstrap");
    assert(sources.indexOf("app/main.js") > sources.indexOf("app/tableCatalog.js"), "table catalog should load before app bootstrap");
    assert(sources.indexOf("app/logic/page.js") > sources.indexOf("app/editor/editor.js"), "logic scripts should load before app bootstrap");
    assert(sources.indexOf("app/main.js") === sources.length - 1, "app/main.js should remain the final bootstrap script");
}

function testIndexLocalAssetsAreVersioned() {
    const html = read("index.html");
    const urls = localAssetUrls(html);

    assert(urls.length > 10, "index.html should expose versioned local assets");
    urls.forEach(function each(url) {
        assert(/\?v=/.test(url), "local browser asset should include cache-busting version: " + url);
    });
}

function testPhysicsLabLoadsEvalHarnessScripts() {
    // What: Verify the standalone physics lab entrypoint includes table eval dependencies.
    // Why: table validation in the lab needs catalog loading, full element registry, and the evaluator module.
    const html = read("physics-lab.html");
    const sources = scriptSources(html);
    assert(sources.indexOf("app/tableCatalog.js") >= 0, "physics-lab should load app/tableCatalog.js");
    assert(sources.indexOf("app/elements/launcher.js") >= 0, "physics-lab should load launcher element module");
    assert(sources.indexOf("app/elements/trough.js") >= 0, "physics-lab should load trough element module");
    assert(sources.indexOf("app/tableEval.js") >= 0, "physics-lab should load app/tableEval.js");
    assert(sources.indexOf("app/tableEval.js") < sources.indexOf("app/tuning/lab.js"), "table eval module should load before lab UI bootstrap");
}

function testTableEvalAccessibilityHeatmapIsRegistered() {
    const source = read("app/tableEval.js");
    assert(/id:\s*"accessibility_heatmap"/.test(source), "tableEval should register accessibility_heatmap check id");
    assert(/label:\s*"Accessibility Heatmap"/.test(source), "tableEval should expose accessibility heatmap label");
}

function testTableEvalAccessibilityHeatmapIgnoresGateColliders() {
    const source = read("app/tableEval.js");
    assert(/seg\s*&&\s*seg\.role\s*===\s*"gate"/.test(source), "accessibility heatmap should detect gate segments");
    assert(/ignoredGateHitCount/.test(source), "accessibility heatmap should track ignored gate contacts");
}

function testLabDiagnosticOverlayRendersHeatmap() {
    const source = read("app/tuning/lab.js");
    assert(/diagnostics\.heatmap/.test(source), "lab diagnostic overlay should consume heatmap diagnostics");
    assert(/fillRect\(col \* cellSize,\s*row \* cellSize,\s*cellSize,\s*cellSize\)/.test(source), "lab diagnostic overlay should draw heatmap cells");
}

function testTableEvalAccessibilityModeSupportsPhysics() {
    const source = read("app/tableEval.js");
    assert(/accessibilityRayMode/.test(source), "tableEval accessibility limits should parse accessibilityRayMode");
    assert(/const rayMode = requestedMode === "physics" \? "physics" : "geometric";/.test(source), "tableEval accessibility should support physics and geometric ray modes");
    assert(/for \(let p = 1; p < physicsTrace\.path\.length; p\+\+\)\s*\{\s*rasterizeSegmentToHeatmap\(physicsTrace\.path\[p - 1\], physicsTrace\.path\[p\]/.test(source), "physics mode heatmap should rasterize traced path segments, not only a straight endpoint segment");
    assert(/let nonGateCollisions = 0;/.test(source), "physics mode should track non-gate collisions separately");
    assert(/reason = "hit";/.test(source), "physics mode should terminate on first non-gate hit");
    assert(/const defaultMaxRays = rayMode === "physics" \? 320 : 5000;/.test(source), "physics mode should use a lower default ray budget than geometric mode");
}

function testLabEvalControlsExposeAccessibilityBreadthDepthAndMode() {
    const source = read("app/tuning/lab.js");
    assert(/Accessibility mode/.test(source), "lab eval controls should expose accessibility mode");
    assert(/Accessibility breadth/.test(source), "lab eval controls should expose accessibility breadth");
    assert(/Accessibility depth/.test(source), "lab eval controls should expose accessibility depth");
    assert(/Accessibility cell size/.test(source), "lab eval controls should expose accessibility heatmap resolution");
    assert(/Accessibility speed/.test(source), "lab eval controls should expose accessibility physics initial velocity");
    assert(/Accessibility max ticks/.test(source), "lab eval controls should expose physics resolution max ticks");
    assert(/Accessibility max contacts/.test(source), "lab eval controls should expose physics resolution max contacts");
    assert(/accessibilityRayMode:\s*state\.eval\.accessibilityRayMode/.test(source), "lab eval options should pass accessibility mode");
    assert(/accessibilityBranchRays:\s*state\.eval\.accessibilityBranchRays/.test(source), "lab eval options should pass accessibility breadth");
    assert(/accessibilityMaxDepth:\s*state\.eval\.accessibilityMaxDepth/.test(source), "lab eval options should pass accessibility depth");
    assert(/accessibilityCellSize:\s*state\.eval\.accessibilityCellSize/.test(source), "lab eval options should pass accessibility cell size");
    assert(/accessibilityRaySpeed:\s*state\.eval\.accessibilityRaySpeed/.test(source), "lab eval options should pass accessibility ray speed");
    assert(/accessibilityMaxTicks:\s*state\.eval\.accessibilityMaxTicks/.test(source), "lab eval options should pass accessibility physics max ticks");
    assert(/accessibilityMaxCollisions:\s*state\.eval\.accessibilityMaxCollisions/.test(source), "lab eval options should pass accessibility physics max contacts");
}

function testLabSupportsLiveAccessibilityProgressOverlay() {
    const source = read("app/tuning/lab.js");
    assert(/liveCheck:\s*null/.test(source), "lab eval state should include liveCheck for in-progress diagnostics");
    assert(/progress\.phase === "accessibility" && progress\.check/.test(source), "lab progress handler should accept accessibility partial checks");
    assert(/if \(state\.eval\.running && state\.eval\.liveCheck\) return state\.eval\.liveCheck;/.test(source), "overlay selection should prefer live check while evaluation is running");
}

function testTableEvalEmitsAccessibilityProgress() {
    const source = read("app/tableEval.js");
    assert(/phase:\s*"accessibility"/.test(source), "tableEval should emit accessibility progress phase");
    assert(/message:\s*"Accessibility rays "/.test(source), "tableEval should emit incremental accessibility progress messages");
    assert(/check:\s*\{\s*id:\s*"accessibility_heatmap"/.test(source), "tableEval accessibility progress should include a drawable check payload");
}

function testPhysicsLabSupportsDynamicPlayfieldSizing() {
    const labJs = read("app/tuning/lab.js");
    const labCss = read("app/tuning/lab.css");
    const harness = read("app/physicsHarness.js");
    assert(/function syncCanvasPlayfield\(/.test(labJs), "lab should define a playfield->canvas sync helper");
    assert(/canvas\.style\.aspectRatio = width \+ \" \/ \" \+ height/.test(labJs), "lab should apply dynamic aspect ratio from playfield dimensions");
    assert(/state\.sandbox\.playfield\.width/.test(labJs), "lab should store sandbox playfield width");
    assert(/state\.sandbox\.playfield\.height/.test(labJs), "lab should store sandbox playfield height");
    assert(/includeDefaultBounds:\s*includeDefaultSandboxBounds\(\)/.test(labJs), "lab sandbox simulation should disable default bounds when a table is loaded");
    assert(/playfield:\s*clone\(state\.sandbox\.playfield\)/.test(labJs), "sandbox simulation should receive authored playfield dimensions");
    assert(!/aspect-ratio:\s*500\s*\/\s*880/.test(labCss), "lab CSS should not hard-code 500/880 aspect ratio");
    assert(/function buildSandboxBounds\(playfield\)/.test(harness), "physics harness should build sandbox bounds from playfield dimensions");
    assert(/includeDefaultBounds !== false/.test(harness), "physics harness should support disabling default sandbox bounds");
    assert(/function buildSandboxDrain\(playfield\)/.test(harness), "physics harness should build sandbox drain from playfield dimensions");
}

function testEditorFlipperAnglesAreEditableInDegrees() {
    const source = read("app/editor/panels.js");
    assert(/rest angle\|active angle/.test(source), "editor angle field detection should include flipper label text");
    assert(/Number\(numberInput\.value\) \* Math\.PI \/ 180/.test(source), "editor angle inputs should convert degree entry back to radians");
}

function testTableCatalogRefsExistAndAreStaticJson() {
    const catalog = loadTableCatalog();
    assert(catalog && Array.isArray(catalog.tables), "table catalog should expose a tables array");
    assert(catalog.tables.length >= 3, "table catalog should include bundled tables");
    catalog.tables.forEach(function each(entry, index) {
        assert(entry && typeof entry.ref === "string", "catalog entry " + index + " should have a ref");
        assert(!/^[a-z][a-z0-9+.-]*:/i.test(entry.ref), "catalog ref should be app-relative: " + entry.ref);
        assert(entry.ref.indexOf("tables/") === 0, "catalog ref should point into tables/: " + entry.ref);
        assert(/\.json$/i.test(entry.ref), "catalog ref should point to JSON: " + entry.ref);
        assert(fs.existsSync(path.join(root, entry.ref)), "Missing catalog table: " + entry.ref);
    });
}

function testDefaultTableNormalizesAndValidates() {
    const tableApi = loadTableModule();
    const table = tableApi.normalizeTable(JSON.parse(read("tables/DefTable.json")));
    const validation = tableApi.validateTable(table);

    assert.strictEqual(validation.ok, true, "tables/DefTable.json should normalize into a structurally valid table");
    assert.strictEqual(typeof table.rules.balls, "number", "default table should have a runtime ball count");
    assert.strictEqual(typeof table.logicDocument, "object", "default table should expose a current logic document");
    assert(table.elements.filter(function filter(el) { return el.type === "gate"; }).every(function every(gate) {
        return typeof gate.swingAngle === "number";
    }), "gate normalization should expose a relative opening angle");
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

function testLauncherWidthClampsToBallSafeMinimum() {
    const tableApi = loadTableModule();
    const table = tableApi.normalizeTable({
        version: 1,
        name: "Narrow Launcher",
        playfield: { width: 500, height: 880, ballRadius: 16, gravity: 0.35, friction: 0.999, restitution: 0.55, maxSpeed: 24 },
        rules: { balls: 3 },
        elements: [
            { id: "launch", type: "launcher", x: 440, top: 200, bottom: 740, width: 16 }
        ]
    });
    const launcher = table.elements[0];
    assert.strictEqual(tableApi.safeLauncherWidth(table.playfield), 38, "safe launcher width should include ball diameter and clearance");
    assert.strictEqual(launcher.width, 38, "normalizeTable should clamp narrow launcher widths");
}

function testNarrowLauncherPlayabilityWarnsBeforeNormalize() {
    const tableApi = loadTableModule();
    const issues = tableApi.validatePlayability({
        version: 1,
        name: "Raw Narrow Launcher",
        playfield: { width: 500, height: 880, ballRadius: 14, gravity: 0.35, friction: 0.999, restitution: 0.55, maxSpeed: 24 },
        rules: { balls: 3, highScoreKey: "pinball.generic.highscore" },
        elements: [
            { id: "launch", type: "launcher", x: 440, top: 200, bottom: 740, width: 12 }
        ]
    });
    assert(issues.some(function some(issue) {
        return /narrower than the ball-safe minimum/.test(issue.message || "");
    }), "validatePlayability should warn about raw narrow launcher lanes");
}

function testTableRealTimeScaleDefaultsAndValidation() {
    const tableApi = loadTableModule();
    const normalized = tableApi.normalizeTable({
        version: 1,
        name: "Slow Mo Default",
        playfield: {},
        rules: { balls: 3 },
        elements: []
    });
    assert.strictEqual(normalized.playfield.realTimeScale, 1, "normalizeTable should default realTimeScale to 1");
    assert.strictEqual(tableApi.getFixedPhysicsDt(normalized.playfield), 1 / 120, "realTimeScale=1 should preserve the base fixed dt");

    const slowMo = tableApi.normalizeTable({
        version: 1,
        name: "Slow Mo Half",
        playfield: { realTimeScale: 0.5 },
        rules: { balls: 3 },
        elements: []
    });
    assert.strictEqual(tableApi.getFixedPhysicsDt(slowMo.playfield), 1 / 240, "realTimeScale=0.5 should halve fixed dt");

    const invalid = tableApi.validateTable({
        version: 1,
        name: "Invalid Scale",
        playfield: {
            width: 500,
            height: 880,
            ballRadius: 8,
            gravity: 0.35,
            friction: 0.999,
            restitution: 0.55,
            maxSpeed: 24,
            realTimeScale: 0
        },
        rules: { balls: 3, highScoreKey: "pinball.invalid" },
        elements: []
    });
    assert.strictEqual(invalid.ok, false, "non-positive realTimeScale should fail validation");

    assert(normalized.playfield.tilt && normalized.playfield.tilt.enabled === true, "normalizeTable should default tilt settings");
    assert.strictEqual(normalized.playfield.tilt.warningLimit, 3, "normalizeTable should default tilt warning limit");

    const invalidTilt = tableApi.validateTable({
        version: 1,
        name: "Invalid Tilt",
        playfield: {
            width: 500,
            height: 880,
            ballRadius: 8,
            gravity: 0.35,
            friction: 0.999,
            restitution: 0.55,
            maxSpeed: 24,
            realTimeScale: 1,
            tilt: { warningLimit: 0 }
        },
        rules: { balls: 3, highScoreKey: "pinball.invalid.tilt" },
        elements: []
    });
    assert.strictEqual(invalidTilt.ok, false, "tilt warningLimit below 1 should fail validation");
}

function testPhysicsTiltAppliesImpulseAndLocksOutUntilCleared() {
    const tableApi = loadTableModule();
    const pin = {
        table: tableApi,
        events: { emit: function emit() {} },
        render: {
            emitCollisionSparks: function emitCollisionSparks() {},
            emitBallTrail: function emitBallTrail() {},
            updateSparks: function updateSparks() {}
        }
    };
    const physics = loadPhysicsModuleHarness(pin);
    const world = {
        table: tableApi.normalizeTable({
            version: 1,
            name: "Tilt Test",
            playfield: {
                gravity: 0,
                friction: 1,
                restitution: 0.5,
                maxSpeed: 100,
                width: 300,
                height: 500,
                tilt: {
                    enabled: true,
                    impulseX: 1,
                    impulseY: -4,
                    cooldownSeconds: 0.25,
                    warningWindowSeconds: 2,
                    warningLimit: 3
                }
            },
            rules: { balls: 1, highScoreKey: "pinball.tilt.test" },
            elements: []
        }),
        balls: [{ x: 100, y: 100, vx: 0, vy: 0, radius: 8, level: 0 }],
        staticSegments: [],
        staticCircles: [],
        dynamicSegments: [],
        dynamicCircles: [],
        runtimeSensors: [],
        physicsTime: 1
    };

    assert.strictEqual(physics.applyTilt(world), true, "first tilt should apply");
    assert.strictEqual(world.balls[0].vx, 1, "tilt should apply configured x impulse");
    assert.strictEqual(world.balls[0].vy, -4, "tilt should apply configured y impulse");

    assert.strictEqual(physics.applyTilt(world), false, "cooldown should block immediate repeated tilt");
    world.physicsTime = 1.3;
    assert.strictEqual(physics.applyTilt(world), true, "tilt should apply after cooldown expires");
    world.physicsTime = 1.6;
    assert.strictEqual(physics.applyTilt(world), false, "third tilt in warning window should trigger lockout");
    assert(world.tiltState && world.tiltState.lockout, "warning limit should lock out controls");

    physics.clearTiltLockout(world);
    assert.strictEqual(world.tiltState.lockout, false, "clearTiltLockout should remove lockout");
    assert.strictEqual(world.tiltState.recentTimes.length, 0, "clearTiltLockout should clear warning history");
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

function testFlipperRoundedEndsUseRadialCollisionNormals() {
    // What: Exercise flipper cap contacts through the production physics path.
    // Why: pivot and tip end caps are rounded collision surfaces; treating them
    // as blade lift contacts lets balls pass through or ping away from elbows.
    const pin = loadFlipperModuleHarness();
    const physics = loadPhysicsModuleHarness(pin);
    const table = {
        playfield: { gravity: 0, friction: 1, restitution: 0.5, maxSpeed: 200, width: 320, height: 240 },
        elements: []
    };
    const flipper = {
        id: "lf",
        type: "flipper",
        side: "left",
        control: "left",
        pivot: { x: 100, y: 120 },
        length: 90,
        restAngle: 0,
        activeAngle: 0,
        thickness: 10,
        rootRadius: 14,
        tipRadius: 7,
        surfaceRestitution: 0.5,
        surfaceFriction: 0,
        strikeBoost: 0
    };

    function runCapCase(capName) {
        const world = {
            table: table,
            controls: { left: false, right: false },
            balls: [],
            elementState: {},
            staticSegments: [],
            staticCircles: [],
            dynamicCircles: [],
            runtimeSensors: [],
            lastPhysicsDt: 1 / 120
        };
        const runtime = pin.elements.registry.flipper.compile(flipper, table, world);
        world.dynamicSegments = runtime.segments;
        world.dynamicCircles = runtime.circles || [];
        const cap = world.dynamicCircles.find(function find(circle) {
            if (!circle || circle.sweepOnly) return false;
            return capName === "tip" ? /:tip$/.test(circle.hitKey || "") : /:pivot$/.test(circle.hitKey || "");
        });
        assert(cap, "expected compiled " + capName + " cap collider");
        const sign = capName === "tip" ? 1 : -1;
        const nx = sign;
        const ny = 0;
        world.balls = [{
            x: cap.x + nx * (cap.radius + 5 - 0.15),
            y: cap.y + ny * (cap.radius + 5 - 0.15),
            vx: -nx * 2,
            vy: 0,
            radius: 5,
            level: 0
        }];
        physics.stepWorld(world, 1 / 120);
        return world.balls[0];
    }

    const tipBall = runCapCase("tip");
    assert(tipBall.vx > 0.5, "tip cap should rebound a radial approach away from the tip");
    assert(Math.abs(tipBall.vy) < 0.1, "tip cap should not convert a lengthwise hit into a blade-lift ping");
    assert.strictEqual(tipBall.supportContact, undefined, "tip cap should not start persistent flipper support");

    const pivotBall = runCapCase("pivot");
    assert(pivotBall.vx < -0.5, "pivot cap should rebound a radial approach away from the elbow");
    assert(Math.abs(pivotBall.vy) < 0.1, "pivot cap should not convert an elbow hit into a blade-lift ping");

    function runMovingCapCase(capName) {
        const movingFlipper = Object.assign({}, flipper, {
            restAngle: 0.18,
            activeAngle: -0.18,
            flipSpeed: 24,
            flipAccel: 220,
            strikeBoost: 0.5
        });
        const world = {
            table: table,
            controls: { left: true, right: false },
            balls: [],
            elementState: { "flipper:lf": { angle: 0, angularVelocity: -18 } },
            staticSegments: [],
            staticCircles: [],
            dynamicCircles: [],
            runtimeSensors: [],
            lastPhysicsDt: 1 / 120
        };
        const runtime = pin.elements.registry.flipper.compile(movingFlipper, table, world);
        world.dynamicSegments = runtime.segments;
        world.dynamicCircles = runtime.circles || [];
        const segment = world.dynamicSegments[world.dynamicSegments.length - 1];
        const dx = segment.x2 - segment.x1;
        const dy = segment.y2 - segment.y1;
        const length = Math.sqrt(dx * dx + dy * dy) || 1;
        const ux = dx / length;
        const uy = dy / length;
        const sign = capName === "tip" ? 1 : -1;
        const nx = ux * sign;
        const ny = uy * sign;
        const cap = (world.dynamicCircles || []).find(function find(circle) {
            if (!circle || circle.sweepOnly) return false;
            return (capName === "tip" && /:tip$/.test(circle.hitKey || "")) ||
                (capName === "pivot" && /:pivot$/.test(circle.hitKey || ""));
        });
        const capX = cap ? cap.x : (capName === "tip" ? segment.x2 : segment.x1);
        const capY = cap ? cap.y : (capName === "tip" ? segment.y2 : segment.y1);
        const capRadius = cap && typeof cap.radius === "number" ? cap.radius : 7;
        world.balls = [{
            x: capX + nx * (capRadius + 5 + 2),
            y: capY + ny * (capRadius + 5 + 2),
            vx: -nx * 2,
            vy: -ny * 2,
            radius: 5,
            level: 0
        }];
        physics.stepWorld(world, 1 / 120);
        return { ball: world.balls[0], nx: nx, ny: ny };
    }

    ["tip", "pivot"].forEach(function each(capName) {
        const result = runMovingCapCase(capName);
        const radialSpeed = result.ball.vx * result.nx + result.ball.vy * result.ny;
        const capTangentSpeed = result.ball.vx * -result.ny + result.ball.vy * result.nx;
        assert(Number.isFinite(radialSpeed), "moving " + capName + " cap should produce finite radial velocity");
        assert(Number.isFinite(capTangentSpeed), "moving " + capName + " cap should produce finite tangential velocity");
        if (capName === "tip") {
            assert.strictEqual(result.ball.supportContact, undefined, "moving tip cap should not capture the ball as supported contact");
        }
    });
}

function testFlipperElbowReleaseDropsStaleSupportedContact() {
    // What: Reproduce an active elbow cradle, then release the flipper.
    // Why: supported contact must not reuse the old active surface velocity
    // after release; that stale velocity is the visible elbow ping.
    const pin = loadFlipperModuleHarness();
    const physics = loadPhysicsModuleHarness(pin);
    const table = {
        playfield: { gravity: 0, friction: 1, restitution: 0.5, maxSpeed: 200, width: 320, height: 260 },
        elements: []
    };
    const flipper = {
        id: "lf",
        type: "flipper",
        side: "left",
        control: "left",
        pivot: { x: 100, y: 160 },
        length: 95,
        restAngle: 0.55,
        activeAngle: -0.55,
        flipSpeed: 44,
        flipAccel: 220,
        returnSpeed: 18,
        returnAccel: 160,
        strikeBoost: 0.52,
        surfaceRestitution: 0.28,
        surfaceFriction: 0.08,
        thickness: 10
    };
    const contactT = 0.08;
    const tx = Math.cos(flipper.activeAngle);
    const ty = Math.sin(flipper.activeAngle);
    const nx = Math.sin(flipper.activeAngle);
    const ny = -Math.cos(flipper.activeAngle);
    const ball = {
        x: flipper.pivot.x + tx * flipper.length * contactT + nx * 15,
        y: flipper.pivot.y + ty * flipper.length * contactT + ny * 15,
        vx: 0,
        vy: 0,
        radius: 5,
        level: 0,
        supportContact: {
            kind: "flipper",
            hitKey: "flipper:lf:play",
            controlActive: true,
            tick: 0,
            supportRadius: 23,
            surfaceFriction: 0.08,
            surfaceVx: 18,
            surfaceVy: -22,
            tx: tx,
            ty: ty,
            nx: nx,
            ny: ny
        }
    };
    const world = {
        table: table,
        controls: { left: false, right: false },
        balls: [ball],
        elementState: { "flipper:lf": { angle: flipper.activeAngle, angularVelocity: 0, active: true, targetAngle: flipper.activeAngle } },
        staticSegments: [],
        staticCircles: [],
        dynamicCircles: [],
        runtimeSensors: [],
        lastPhysicsDt: 1 / 120,
        physicsTick: 1
    };

    {
        const runtime = pin.elements.registry.flipper.compile(flipper, table, world);
        world.dynamicSegments = runtime.segments;
        world.dynamicCircles = runtime.circles || [];
    }
    physics.stepWorld(world, 1 / 120);

    const speed = Math.sqrt(ball.vx * ball.vx + ball.vy * ball.vy);
    assert(speed < 2, "released elbow support should not reuse stale active flipper velocity");
    assert(!ball.supportContact || ball.supportContact.controlActive === false, "released flipper should drop stale active elbow support");
}

function testFlipperSupportedContactUsesCurrentBlade() {
    // What: Keep persistent flipper support tied to the current physical blade.
    // Why: sweep-only samples prevent tunneling, but using them for rolling
    // support creates stale contact frames that can drag balls near the tip.
    const pin = loadFlipperModuleHarness();
    const physics = loadPhysicsModuleHarness(pin);
    const table = {
        playfield: { gravity: 0, friction: 1, restitution: 0.5, maxSpeed: 200, width: 320, height: 260 },
        elements: []
    };
    const flipper = {
        id: "lf",
        type: "flipper",
        side: "left",
        control: "left",
        pivot: { x: 100, y: 130 },
        length: 100,
        restAngle: 0.55,
        activeAngle: -0.55,
        flipSpeed: 24,
        flipAccel: 220,
        returnSpeed: 18,
        returnAccel: 160,
        strikeBoost: 0.52,
        surfaceRestitution: 0.28,
        surfaceFriction: 0.08,
        thickness: 10
    };
    const world = {
        table: table,
        controls: { left: true, right: false },
        balls: [],
        elementState: { "flipper:lf": { angle: 0, angularVelocity: -10 } },
        staticSegments: [],
        staticCircles: [],
        dynamicCircles: [],
        runtimeSensors: [],
        lastPhysicsDt: 1 / 120,
        physicsTick: 10
    };

    {
        const runtime = pin.elements.registry.flipper.compile(flipper, table, world);
        world.dynamicSegments = runtime.segments;
        world.dynamicCircles = runtime.circles || [];
    }
    const currentBlade = (world.dynamicSegments || []).find(function find(segment) {
        return segment && !segment.sweepOnly && /:play$/.test(segment.hitKey || "");
    }) || world.dynamicSegments[world.dynamicSegments.length - 1];
    const angle = Math.atan2(currentBlade.y2 - currentBlade.y1, currentBlade.x2 - currentBlade.x1);
    const tx = Math.cos(angle);
    const ty = Math.sin(angle);
    const nx = Math.sin(angle);
    const ny = -Math.cos(angle);
    const contactT = 0.95;
    const contactRadius = 18;
    const contactSlop = 8;
    const ball = {
        x: currentBlade.x1 + (currentBlade.x2 - currentBlade.x1) * contactT + nx * (contactRadius + 1),
        y: currentBlade.y1 + (currentBlade.y2 - currentBlade.y1) * contactT + ny * (contactRadius + 1),
        vx: 0,
        vy: 0,
        radius: 8,
        level: 0,
        supportContact: {
            kind: "flipper",
            hitKey: currentBlade.hitKey || "flipper:lf:play",
            controlActive: true,
            tick: 0,
            supportRadius: contactRadius + contactSlop,
            contactRadius: contactRadius,
            contactSlop: contactSlop,
            surfaceFriction: 0.08,
            surfaceVx: 0,
            surfaceVy: 0,
            tx: tx,
            ty: ty,
            nx: nx,
            ny: ny
        }
    };
    world.balls = [ball];

    physics.stepWorld(world, 1 / 120);

    assert(ball.supportContact, "nearby supported contact should remain active inside contact slop");
    const tangentDot = (ball.supportContact.tx * tx) + (ball.supportContact.ty * ty);
    assert(Math.abs(tangentDot) > 0.995, "support tangent should align with the current blade axis");
}

function testFlipperSupportedContactPreservesOutwardSeparation() {
    // What: Let a ball peel away from a supported flipper contact.
    // Why: support friction may oppose sliding, but it must not erase outward
    // normal velocity or the contact becomes an adhesive grab near the tip.
    const pin = loadFlipperModuleHarness();
    const physics = loadPhysicsModuleHarness(pin);
    const table = {
        playfield: { gravity: 0, friction: 1, restitution: 0.5, maxSpeed: 200, width: 320, height: 260 },
        elements: []
    };
    const flipper = {
        id: "lf",
        type: "flipper",
        side: "left",
        control: "left",
        pivot: { x: 100, y: 130 },
        length: 100,
        restAngle: 0.55,
        activeAngle: -0.55,
        flipSpeed: 24,
        flipAccel: 220,
        returnSpeed: 18,
        returnAccel: 160,
        strikeBoost: 0.52,
        surfaceRestitution: 0.28,
        surfaceFriction: 0.08,
        thickness: 10
    };
    const world = {
        table: table,
        controls: { left: true, right: false },
        balls: [],
        elementState: { "flipper:lf": { angle: flipper.activeAngle, angularVelocity: 0 } },
        staticSegments: [],
        staticCircles: [],
        dynamicCircles: [],
        runtimeSensors: [],
        lastPhysicsDt: 1 / 120,
        physicsTick: 0
    };

    {
        const runtime = pin.elements.registry.flipper.compile(flipper, table, world);
        world.dynamicSegments = runtime.segments;
        world.dynamicCircles = runtime.circles || [];
    }
    const currentBlade = world.dynamicSegments[world.dynamicSegments.length - 1];
    const angle = Math.atan2(currentBlade.y2 - currentBlade.y1, currentBlade.x2 - currentBlade.x1);
    const tx = Math.cos(angle);
    const ty = Math.sin(angle);
    const nx = Math.sin(angle);
    const ny = -Math.cos(angle);
    const contactT = 0.92;
    const contactRadius = 18;
    const contactSlop = 8;
    const outwardSpeed = 0.3;
    const ball = {
        x: currentBlade.x1 + (currentBlade.x2 - currentBlade.x1) * contactT + nx * (contactRadius + 1),
        y: currentBlade.y1 + (currentBlade.y2 - currentBlade.y1) * contactT + ny * (contactRadius + 1),
        vx: nx * outwardSpeed,
        vy: ny * outwardSpeed,
        radius: 8,
        level: 0,
        supportContact: {
            kind: "flipper",
            hitKey: "flipper:lf:play",
            controlActive: true,
            tick: 0,
            supportRadius: contactRadius + contactSlop,
            contactRadius: contactRadius,
            contactSlop: contactSlop,
            surfaceFriction: 0.08,
            surfaceVx: 0,
            surfaceVy: 0,
            tx: tx,
            ty: ty,
            nx: nx,
            ny: ny
        }
    };
    world.balls = [ball];

    physics.stepWorld(world, 1 / 120);

    const outwardNormalSpeed = ball.vx * nx + ball.vy * ny;
    assert(outwardNormalSpeed > 0.2, "supported contact should preserve outward normal velocity");
}

function testFlipperRepeatedSameFrameContactStillResolves() {
    // What: Resolve a flipper hit even when the same hit key was already seen.
    // Why: flippers use onHit as their custom collision solver, so event
    // de-duping must not suppress a second same-frame physics response.
    const pin = loadFlipperModuleHarness();
    const physics = loadPhysicsModuleHarness(pin);
    const table = {
        playfield: { gravity: 0, friction: 1, restitution: 0.5, maxSpeed: 200, width: 320, height: 240 },
        elements: []
    };
    const flipper = {
        id: "lf",
        type: "flipper",
        side: "left",
        control: "left",
        pivot: { x: 100, y: 120 },
        length: 90,
        restAngle: 0,
        activeAngle: 0,
        thickness: 10,
        surfaceRestitution: 0.5,
        surfaceFriction: 0,
        strikeBoost: 0
    };
    const world = {
        table: table,
        controls: { left: false, right: false },
        balls: [],
        elementState: {},
        staticSegments: [],
        staticCircles: [],
        dynamicCircles: [],
        runtimeSensors: [],
        lastPhysicsDt: 1 / 120,
        physicsTick: 0
    };

    {
        const runtime = pin.elements.registry.flipper.compile(flipper, table, world);
        world.dynamicSegments = runtime.segments;
        world.dynamicCircles = runtime.circles || [];
    }
    const pivotCap = (world.dynamicCircles || []).find(function find(circle) {
        return circle && !circle.sweepOnly && /:pivot$/.test(circle.hitKey || "");
    });
    assert(pivotCap, "expected pivot cap collider");
    const nx = -1;
    const ny = 0;
    const ball = {
        x: pivotCap.x + nx * (pivotCap.radius + 5 - 0.15),
        y: pivotCap.y + ny * (pivotCap.radius + 5 - 0.15),
        vx: -nx * 1.8,
        vy: 0,
        radius: 5,
        level: 0,
        _hitFrame: {}
    };
    (world.dynamicSegments || []).forEach(function each(seg) {
        if (seg && seg.hitKey) ball._hitFrame[seg.hitKey] = 1;
    });
    (world.dynamicCircles || []).forEach(function each(circle) {
        if (circle && circle.hitKey) ball._hitFrame[circle.hitKey] = 1;
    });
    world.balls = [ball];
    const preNormal = ball.vx * nx + ball.vy * ny;
    physics.stepWorld(world, 1 / 120);
    const postNormal = ball.vx * nx + ball.vy * ny;
    assert(postNormal > preNormal + 0.15, "custom flipper response should still resolve repeated same-frame contact");
}

function testFlipperUndersideBlocksUpwardPassThrough() {
    // What: Hit a held flipper from below.
    // Why: finite-volume flipper geometry should block underside approach.
    const pin = loadFlipperModuleHarness();
    const physics = loadPhysicsModuleHarness(pin);
    const table = {
        playfield: { gravity: 0, friction: 1, restitution: 0.5, maxSpeed: 200, width: 320, height: 240 },
        elements: []
    };
    const flipper = {
        id: "lf",
        type: "flipper",
        side: "left",
        control: "left",
        pivot: { x: 100, y: 160 },
        length: 90,
        restAngle: 0,
        activeAngle: 0,
        rootRadius: 14,
        tipRadius: 7,
        strikeBoost: 0,
        surfaceRestitution: 0.12,
        surfaceFriction: 0
    };
    const world = {
        table: table,
        controls: { left: false, right: false },
        balls: [{ x: 145, y: 176, vx: 0, vy: -3.5, radius: 5, level: 0 }],
        elementState: {},
        staticSegments: [],
        staticCircles: [],
        dynamicSegments: [],
        dynamicCircles: [],
        runtimeSensors: [],
        lastPhysicsDt: 1 / 120
    };
    const runtime = pin.elements.registry.flipper.compile(flipper, table, world);
    world.dynamicSegments = runtime.segments;
    world.dynamicCircles = runtime.circles || [];
    const startY = world.balls[0].y;
    for (let i = 0; i < 8; i++) physics.stepWorld(world, 1 / 120);
    const ball = world.balls[0];
    assert(ball.vy > -1.8, "underside hit should reduce upward travel speed");
    assert(ball.y >= startY - 12, "ball should not pass through and continue upward across the blade");
}

function testFlipperRootAndTipRadiiAffectContactReach() {
    // What: Compare collisions for small and large tip radii.
    // Why: authored radii should materially change where the blade collides.
    const pin = loadFlipperModuleHarness();
    const physics = loadPhysicsModuleHarness(pin);
    const table = {
        playfield: { gravity: 0, friction: 1, restitution: 0.5, maxSpeed: 200, width: 340, height: 240 },
        elements: []
    };
    const baseFlipper = {
        id: "lf",
        type: "flipper",
        side: "left",
        control: "left",
        pivot: { x: 95, y: 130 },
        length: 90,
        restAngle: 0,
        activeAngle: 0,
        rootRadius: 14,
        strikeBoost: 0,
        surfaceRestitution: 0.08,
        surfaceFriction: 0
    };
    function runCase(tipRadius) {
        const flipper = Object.assign({}, baseFlipper, { tipRadius: tipRadius });
        const world = {
            table: table,
            controls: { left: false, right: false },
            balls: [{ x: 188, y: 128, vx: -2.4, vy: 0, radius: 5, level: 0 }],
            elementState: {},
            staticSegments: [],
            staticCircles: [],
            dynamicSegments: [],
            dynamicCircles: [],
            runtimeSensors: [],
            lastPhysicsDt: 1 / 120
        };
        const runtime = pin.elements.registry.flipper.compile(flipper, table, world);
        world.dynamicSegments = runtime.segments;
        world.dynamicCircles = runtime.circles || [];
        for (let i = 0; i < 5; i++) physics.stepWorld(world, 1 / 120);
        return world.balls[0].vx;
    }
    const initialVx = -2.4;
    const smallTipVx = runCase(3);
    const largeTipVx = runCase(16);
    const smallDelta = Math.abs(smallTipVx - initialVx);
    const largeDelta = Math.abs(largeTipVx - initialVx);
    assert(largeDelta > smallDelta + 0.35, "larger tip radius should produce materially stronger contact response");
}

function testSpinnerBladesDoNotBlockBall() {
    const pin = loadSpinnerModuleHarness();
    const spinner = {
        id: "spin",
        type: "spinner",
        x: 100,
        y: 100,
        radius: 30,
        angle: 0,
        damping: 0,
        score: 100
    };
    const world = {
        elementState: {},
        lastPhysicsDt: 1 / 120,
        physicsTick: 1
    };
    const runtime = pin.elements.registry.spinner.compile(spinner, {}, world);

    assert.strictEqual(runtime.segments.length, 2, "spinner should compile two blade hit surfaces");
    runtime.segments.forEach(function each(segment) {
        assert.strictEqual(segment.passThrough, true, "spinner blades should be pass-through contact surfaces");
        assert.strictEqual(segment.passThroughCooldown, 0.08, "spinner blades should debounce repeated pass-through substep hits");
        assert.strictEqual(segment.skipDefaultResolve, true, "spinner blades should not use wall-style collision resolution");
        assert(/^spinner:spin:/.test(segment.hitKey), "spinner blades should use stable spinner hit keys");
    });

    const ball = { vx: 80, vy: 40 };
    for (let i = 0; i < 8; i++) {
        runtime.segments[0].onHit(ball, { t: 1 }, world);
    }
    const state = world.elementState["spinner:spin"];
    assert(state.angularVelocity <= 24, "spinner angular velocity should be capped");
    assert(state.angularVelocity >= -24, "spinner angular velocity should be capped in reverse");
    assert(ball.vx > 0 && ball.vy > 0, "spinner hit should damp but not reverse or trap the ball");
}

function testSpinnerSweepContactDoesNotBlockBallTravel() {
    const pin = loadSpinnerModuleHarness();
    let spinnerHits = 0;
    let sparkHit = null;
    pin.events = {
        emit: function emit(world, event) {
            if (event && event.type === "switchClosed" && event.sourceId === "spin") spinnerHits += 1;
        }
    };
    pin.render = {
        emitCollisionSparks: function emitCollisionSparks(world, ball, hit) { sparkHit = hit; },
        emitBallTrail: function emitBallTrail() {},
        updateSparks: function updateSparks() {}
    };
    const physics = loadPhysicsModuleHarness(pin);
    const spinner = {
        id: "spin",
        type: "spinner",
        x: 100,
        y: 100,
        radius: 30,
        angle: 0,
        damping: 0,
        score: 100
    };
    const world = {
        table: {
            playfield: { gravity: 0, friction: 1, restitution: 0.5, maxSpeed: 200, width: 300, height: 240 },
            elements: []
        },
        balls: [{ x: 70, y: 100, vx: 100, vy: 0, radius: 4, level: 0 }],
        elementState: {},
        staticSegments: [],
        staticCircles: [],
        dynamicCircles: [],
        runtimeSensors: [],
        lastPhysicsDt: 1 / 120
    };
    world.dynamicSegments = pin.elements.registry.spinner.compile(spinner, world.table, world).segments;

    physics.stepWorld(world, 1 / 120);

    assert(spinnerHits > 0, "fast spinner crossings should still fire spinner switch hits");
    assert(world.balls[0].x > 100, "pass-through spinner contact should not stop swept ball travel");
    assert(world.balls[0].vx > 0 && world.balls[0].vx < 100, "spinner contact should damp without reversing ball velocity");
    assert(sparkHit && typeof sparkHit.cx === "number" && typeof sparkHit.cy === "number", "spinner sparks should receive concrete contact coordinates");
    assert(Math.abs(sparkHit.cx - 100) < 0.001 || Math.abs(sparkHit.cy - 100) < 0.001, "spinner spark coordinates should lie on a blade");
}

function testGateDirectionModesCanOpen() {
    const pin = loadGateModuleHarness();
    const compile = pin.elements.registry.gate.compile;
    const table = { playfield: { width: 500, height: 880 } };

    function run(direction, swingEndAngle, ballY) {
        const gate = {
            id: "gate_" + direction,
            type: "gate",
            x: 0,
            y: 0,
            length: 64,
            angle: 0,
            direction: direction,
            open: false,
            locked: false,
            swingStartAngle: 0,
            swingEndAngle: swingEndAngle,
            returnStrength: 0,
            returnDamping: 0
        };
        const world = {
            table: table,
            elementState: {},
            lastPhysicsDt: 1 / 120,
            physicsTick: 1
        };
        const runtime = compile(gate, table, world);
        const ball = { x: 32, y: ballY, vx: 0, vy: 10 };
        assert.strictEqual(runtime.segments[0].oneWay(ball, world), true, direction + " gate should allow its configured side");
        const state = world.elementState["gate:" + gate.id];
        assert(state && Math.abs(state.angle) > 0.001, direction + " gate should move when opened");
        return state.angle;
    }

    assert(run("forward", 0.85, -8) > 0, "forward gate should swing toward the visual arc endpoint");
    assert(run("reverse", -0.85, 8) < 0, "reverse gate should be the mirrored visual arc");
    assert(run("twoWay", 0.85, -8) > 0, "two-way gate should swing forward from one side");
    assert(run("twoWay", 0.85, 8) < 0, "two-way gate should swing reverse from the other side");

    const forcedOpenGate = {
        id: "gate_forced_reverse",
        type: "gate",
        x: 0,
        y: 0,
        length: 64,
        angle: 0,
        direction: "reverse",
        open: true,
        locked: false,
        swingStartAngle: 0,
        swingEndAngle: -0.85
    };
    const forcedWorld = { table: table, elementState: {}, lastPhysicsDt: 1 / 120 };
    compile(forcedOpenGate, table, forcedWorld);
    assert(forcedWorld.elementState["gate:gate_forced_reverse"].angle < 0, "forced-open reverse gate should use the mirrored visual arc endpoint");

    const authoredStartGate = {
        id: "gate_authored_start",
        type: "gate",
        x: 0,
        y: 0,
        length: 64,
        angle: 1.2,
        direction: "forward",
        open: true,
        locked: false,
        swingStartAngle: -0.2,
        swingAngle: 0.8,
        swingEndAngle: 2.8
    };
    const authoredWorld = { table: table, elementState: {}, lastPhysicsDt: 1 / 120 };
    const authoredRuntime = compile(authoredStartGate, table, authoredWorld);
    const authoredSegment = authoredRuntime.segments[0];
    const authoredAngle = Math.atan2(authoredSegment.y2 - authoredSegment.y1, authoredSegment.x2 - authoredSegment.x1);
    assert(Math.abs(authoredAngle - 0.6) < 0.001, "gate runtime should use swingStartAngle plus relative swingAngle, not stale angle/swingEndAngle");
}

function testGateSwingHandleUsesSmallSignedOpeningAngle() {
    // What: Drag the gate opening handle across the atan2 +/-pi seam.
    // Why: without normalizing the relative angle, a tiny edit turns the visual
    // arc from a wedge into an almost full-circle pacman.
    const hitTest = loadEditorHitTestHarness();
    const gate = {
        id: "gate_branch_cut",
        type: "gate",
        x: 0,
        y: 0,
        length: 64,
        angle: 3.05,
        swingStartAngle: 3.05,
        swingAngle: 0.12,
        swingEndAngle: 3.17,
        direction: "forward"
    };
    const endpointAngle = -3.05;

    hitTest.applyHandleDrag(gate, { kind: "swingEnd" }, {
        x: Math.cos(endpointAngle) * gate.length,
        y: Math.sin(endpointAngle) * gate.length
    }, { x: 0, y: 0 }, {});

    assert(Math.abs(gate.swingAngle - 0.1831853071795866) < 0.001, "gate swing handle should store the small seam-crossing opening angle");
    assert(Math.abs((gate.swingEndAngle - gate.swingStartAngle) - gate.swingAngle) < 0.001, "legacy swingEndAngle should stay derived from the relative opening angle");
}

function testRuntimeSplitKeepsOnlyPhysicsElementsDynamic() {
    // What: Verify static compile keeps stateful visual drawables while dynamic
    // physics only recompiles collider-producing mechanisms.
    // Why: This protects the render cache and the 120 Hz physics hot path.
    const pin = loadElementRegistryHarness();
    const table = {
        elements: [
            { id: "wall", type: "path" },
            { id: "lamp", type: "light" },
            { id: "target", type: "dropTarget" },
            { id: "kick", type: "kicker" },
            { id: "flip", type: "flipper" },
            { id: "launch", type: "launcher" }
        ]
    };
    const staticRuntime = pin.elements.compileElements(table, {}, { dynamic: false });
    assert(staticRuntime.drawables.some(function some(entry) { return entry.element.type === "light"; }), "lights should stay in static runtime drawables for dynamic drawing");
    assert(staticRuntime.drawables.some(function some(entry) { return entry.element.type === "dropTarget"; }), "lit targets should stay available for dynamic drawing");
    assert(staticRuntime.drawables.some(function some(entry) { return entry.element.type === "kicker"; }), "kicker pulse drawing should stay available");
    assert(!staticRuntime.drawables.some(function some(entry) { return entry.element.type === "flipper"; }), "flippers should not compile into the static runtime");

    const dynamicElements = pin.elements.filterElements(table, pin.elements.isDynamicPhysicsType);
    const dynamicRuntime = pin.elements.compileElements(table, {}, { static: false, dynamicPhysicsOnly: true, elements: dynamicElements });
    const dynamicTypes = Array.prototype.slice.call(dynamicRuntime.drawables).map(function map(entry) { return entry.element.type; }).sort();
    assert.deepStrictEqual(dynamicTypes, ["flipper", "launcher"], "dynamic physics compile should only include collider-producing dynamic elements");
    assert.strictEqual(pin.elements.isDynamicType("light"), true, "lights should remain dynamically drawn");
    assert.strictEqual(pin.elements.isDynamicType("dropTarget"), true, "lit targets should remain dynamically drawn");
    assert.strictEqual(pin.elements.isDynamicPhysicsType("light"), false, "lights should not recompile in physics ticks");
}

function runQualityControllerFrames(controller, frames, startNowMs) {
    // What: Feed synthetic frame samples into the adaptive quality controller.
    // Why: tests need deterministic timing scenarios for hysteresis behavior.
    let now = Number.isFinite(startNowMs) ? startNowMs : 0;
    let last = null;
    let output = { glowScale: 1, reducedEffects: false };
    let transitions = 0;
    frames.forEach(function each(frame) {
        const dt = frame.dt;
        now += dt * 1000;
        output = controller.sample({
            now: now,
            frameDt: dt,
            backlogSteps: frame.backlog
        });
        if (last) {
            if (output.reducedEffects !== last.reducedEffects) transitions += 1;
        }
        last = output;
    });
    return { output: output, now: now, transitions: transitions };
}

function testAdaptiveQualityControllerIgnoresSingleSpike() {
    const performanceApi = loadPerformanceModule();
    const controller = performanceApi.createAdaptiveQualityController();
    const frames = [];
    for (let i = 0; i < 100; i++) {
        frames.push({ dt: 1 / 60, backlog: 0.2 });
    }
    frames.push({ dt: 0.042, backlog: 2.4 });
    for (let i = 0; i < 90; i++) {
        frames.push({ dt: 1 / 60, backlog: 0.2 });
    }
    const result = runQualityControllerFrames(controller, frames);
    assert.strictEqual(result.output.reducedEffects, false, "single-frame pressure spikes should not degrade quality");
    assert.strictEqual(result.output.glowScale, 1, "single-frame pressure spikes should keep full glow scale");
    assert.strictEqual(result.output.pixelRatioScale, 1, "single-frame pressure spikes should keep full render resolution");
    assert.strictEqual(result.output.trailEnabled, true, "single-frame pressure spikes should keep trail effects");
}

function testAdaptiveQualityControllerDropsOnSustainedPressure() {
    const performanceApi = loadPerformanceModule();
    const controller = performanceApi.createAdaptiveQualityController();
    const frames = [];
    for (let i = 0; i < 220; i++) {
        frames.push({ dt: 1 / 28, backlog: 2.2 });
    }
    const result = runQualityControllerFrames(controller, frames);
    assert.strictEqual(result.output.reducedEffects, true, "sustained pressure should trigger reduced effects");
    assert.strictEqual(result.output.glowScale, 0.55, "sustained pressure should reduce glow scale");
    assert(result.output.pixelRatioScale < 1, "sustained pressure should reduce render resolution");
    assert(result.output.sparkLimit < 220, "sustained pressure should reduce spark budget");
    assert.strictEqual(result.output.trailEnabled, false, "sustained pressure should disable spark trails");
}

function testAdaptiveQualityControllerNeedsStableRecoveryWindow() {
    const performanceApi = loadPerformanceModule();
    const controller = performanceApi.createAdaptiveQualityController();
    const degraded = [];
    for (let i = 0; i < 220; i++) degraded.push({ dt: 1 / 28, backlog: 2.2 });
    const reduced = runQualityControllerFrames(controller, degraded);
    assert.strictEqual(reduced.output.reducedEffects, true, "precondition should enter reduced quality first");

    const stillReducedWindow = [];
    for (let i = 0; i < 90; i++) stillReducedWindow.push({ dt: 1 / 60, backlog: 0.2 });
    const stillReduced = runQualityControllerFrames(controller, stillReducedWindow, reduced.now);
    assert.strictEqual(stillReduced.output.reducedEffects, true, "quality should not recover before the stable recovery window");

    const recoveryWindow = [];
    for (let i = 0; i < 300; i++) recoveryWindow.push({ dt: 1 / 60, backlog: 0.2 });
    const recovered = runQualityControllerFrames(controller, recoveryWindow, stillReduced.now);
    assert.strictEqual(recovered.output.reducedEffects, false, "quality should recover after sustained stable performance");
    assert.strictEqual(recovered.output.glowScale, 1, "recovered quality should restore full glow scale");
    assert.strictEqual(recovered.output.pixelRatioScale, 1, "recovered quality should restore full render resolution");
    assert.strictEqual(recovered.output.sparkLimit, 220, "recovered quality should restore spark budget");
    assert.strictEqual(recovered.output.trailEnabled, true, "recovered quality should restore spark trails");
}

function testAdaptiveQualityControllerDoesNotOscillateOnBorderlineLoad() {
    const performanceApi = loadPerformanceModule();
    const controller = performanceApi.createAdaptiveQualityController();
    const frames = [];
    for (let i = 0; i < 600; i++) {
        frames.push({
            dt: i % 2 === 0 ? 1 / 60 : 0.024,
            backlog: i % 3 === 0 ? 0.95 : 0.55
        });
    }
    const result = runQualityControllerFrames(controller, frames);
    assert(result.transitions <= 2, "borderline load should not cause rapid quality oscillation");
}

function testPlayLoopSamplesQualityAfterPhysicsCatchup() {
    const source = read("app/main.js");
    const whileIndex = source.indexOf("while (accumulator >= fixedDt)");
    const sampleIndex = source.indexOf("qualityController.sample");
    const syncIndex = source.lastIndexOf("syncPlayCanvasResolution(qualityProfile.pixelRatioScale)");
    assert(whileIndex >= 0, "play loop should retain fixed-step physics catch-up");
    assert(sampleIndex > whileIndex, "quality sampling should use post-catch-up accumulator backlog");
    assert(syncIndex > sampleIndex, "play loop should apply backing-scale sync after quality sampling");
}

function testPlayLoopAppliesTableRealTimeScale() {
    const source = read("app/main.js");
    assert(source.indexOf("getFixedPhysicsDt") >= 0, "play loop should derive fixed dt from table timing");
    assert(source.indexOf("scaledFrameDt") >= 0, "play loop should scale frame dt by table real-time scale");
    assert(source.indexOf("accumulator + scaledFrameDt") >= 0, "play loop accumulator should consume scaled simulation time");
    assert(source.indexOf("AltLeft") >= 0 && source.indexOf("AltRight") >= 0, "play mode should map desktop tilt to Alt keys");
    assert(source.indexOf("devicemotion") >= 0, "play mode should support mobile motion tilt control");
}

function testSparkHelpersEmitAndExpireParticles() {
    const render = loadRenderModuleHarness();
    const world = { sparkParticles: [] };
    const ball = { x: 50, y: 80, vx: 30, vy: 0, radius: 8, z: 0 };

    for (let i = 0; i < 8; i++) render.emitBallTrail(world, ball, 1 / 120);
    assert(world.sparkParticles.length > 0, "moving balls should emit trail sparks");

    render.emitCollisionSparks(world, ball, { nx: -1, ny: 0, cx: 42, cy: 80, impactSpeed: 12 });
    assert(world.sparkParticles.length > 4, "collisions should emit spark bursts");

    render.updateSparks(world, 1);
    assert.strictEqual(world.sparkParticles.length, 0, "expired sparks should be removed");
}

function testReducedEffectsSuppressSparkEmission() {
    const render = loadRenderModuleHarness();
    const world = { sparkParticles: [] };
    const ball = { x: 50, y: 80, vx: 40, vy: 0, radius: 8, z: 0 };

    render.setQuality({ reducedEffects: true });
    render.emitBallTrail(world, ball, 1);
    render.emitCollisionSparks(world, ball, { nx: -1, ny: 0, impactSpeed: 20 });
    assert.strictEqual(world.sparkParticles.length, 0, "reduced effects should suppress new spark particles");
}

function testSparkLimitCanDisableParticlesWithoutReducedEffects() {
    const render = loadRenderModuleHarness();
    const world = { sparkParticles: [] };
    const ball = { x: 50, y: 80, vx: 40, vy: 0, radius: 8, z: 0 };

    render.setQuality({ reducedEffects: false, sparkLimit: 0, trailEnabled: true });
    render.emitBallTrail(world, ball, 1);
    render.emitCollisionSparks(world, ball, { nx: -1, ny: 0, impactSpeed: 20 });
    assert.strictEqual(world.sparkParticles.length, 0, "explicit spark limit should cap particle work at zero");
}

function testPhysicsCollisionsEmitSparkBurstsWithoutElementHitHandlers() {
    let bursts = 0;
    const pin = {
        render: {
            emitCollisionSparks: function emitCollisionSparks() { bursts += 1; },
            emitBallTrail: function emitBallTrail() {},
            updateSparks: function updateSparks() {}
        }
    };
    const physics = loadPhysicsModuleHarness(pin);
    const world = {
        table: {
            playfield: { gravity: 0, friction: 1, restitution: 1, maxSpeed: 100, width: 100, height: 100 },
            elements: []
        },
        balls: [{ x: 0, y: 0, vx: 20, vy: 0, radius: 1, level: 0 }],
        staticSegments: [{ x1: 1, y1: -10, x2: 1, y2: 10, thickness: 0, level: 0 }],
        staticCircles: [],
        dynamicSegments: [],
        dynamicCircles: [],
        runtimeSensors: []
    };

    physics.stepWorld(world, 1 / 120);
    assert(bursts > 0, "physics collisions should emit visual spark bursts even when no element onHit exists");
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

function testPlayControlsCanBeHiddenFromKeyboard() {
    const mainSource = read("app/main.js");
    const cssSource = read("app/editor/editor.css");
    assert(/KeyH/.test(mainSource), "play mode should handle H for hiding touch controls");
    assert(/setControlsHidden/.test(mainSource), "play mode should refit after hiding touch controls");
    assert(/mobile-play-controls\.is-hidden/.test(cssSource), "touch controls should have a hidden CSS state");
}

function testEditorLauncherWidthUsesSharedClamp() {
    const hitTestSource = read("app/editor/hitTest.js");
    const modelSource = read("app/editor/model.js");
    assert(/safeLauncherWidth/.test(hitTestSource), "launcher width drag should use shared safe launcher width");
    assert(/clampLauncherWidths/.test(modelSource), "editor launcher sync should clamp saved launcher widths");
}

function testEditorFlipperOpeningAngleHandleIsVisibleAndDraggable() {
    const hitTestSource = read("app/editor/hitTest.js");
    const editorSource = read("app/editor/editor.js");
    assert(/drawFlipperOpeningArc/.test(hitTestSource), "editor hit-test drawing should render a flipper opening arc");
    assert(/kind:\s*"activeAngle"/.test(hitTestSource), "editor hit-test should expose an active-angle flipper handle");
    assert(/handle\.kind === "activeAngle"/.test(hitTestSource), "flipper active-angle handle should be applied during drag");
    assert(/drag\.handle\.kind === "activeAngle"/.test(editorSource), "editor drag snapping should keep active-angle handle unsnapped");
}

function testEditorMultiSelectMoveContracts() {
    // What: Keep the designer multi-select implementation anchored to visible
    // element bounds and shared movement helpers.
    // Why: group selection should move authored objects together without adding
    // a second geometry model beside editor hit testing.
    const hitTest = loadEditorHitTestHarness();
    const hitTestSource = read("app/editor/hitTest.js");
    const editorSource = read("app/editor/editor.js");
    assert.strictEqual(typeof hitTest.getElementBounds, "function", "editor hit-test should expose element bounds for marquee selection");
    assert.strictEqual(typeof hitTest.elementIntersectsRect, "function", "editor hit-test should expose geometric marquee overlap checks");
    assert(/getElementBounds:\s*getElementBounds/.test(hitTestSource), "editor hit-test public API should export getElementBounds");
    assert(/elementIntersectsRect:\s*elementIntersectsRect/.test(hitTestSource), "editor hit-test public API should export elementIntersectsRect");
    assert(/selectedIds/.test(editorSource), "editor should track a group selection list");
    assert(/kind:\s*"marquee"/.test(editorSource), "blank canvas drag should start a marquee selection");
    assert(/groupIds/.test(editorSource), "dragging selected objects should carry group ids");
    assert(/getVisibleEditorElements\(\)\.forEach/.test(editorSource), "marquee selection should use visible editor elements");
    assert(/Pin\.editorHitTest\.elementIntersectsRect\(/.test(editorSource), "marquee selection should use geometry overlap, not bounds-only selection");
    assert(/Pin\.editorHitTest\.shiftElement\(element, dx, dy\)/.test(editorSource), "group drag should move elements through shared shiftElement");
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

function testStorageClearsOnlyPinLocalState() {
    const storage = memoryStorage();
    const pinStorage = loadStorageModuleHarness(storage);
    storage.setItem("pin.tables.autosave", "{}");
    storage.setItem("pin.assistant.settings", "{}");
    storage.setItem("other.app", "keep");

    const cleared = pinStorage.local.clearApp();

    assert.strictEqual(cleared, 2, "clearApp should report removed pin.* keys");
    assert.strictEqual(storage.getItem("pin.tables.autosave"), null, "clearApp should remove saved tables");
    assert.strictEqual(storage.getItem("pin.assistant.settings"), null, "clearApp should remove assistant settings");
    assert.strictEqual(storage.getItem("other.app"), "keep", "clearApp should leave unrelated keys alone");
}

function testLocalTableSaveAddsBrowseMetadata() {
    const storage = memoryStorage();
    const pinStorage = loadStorageModuleHarness(storage);
    const table = { version: 1, name: "Saved Copy", playfield: {}, rules: {}, elements: [] };

    pinStorage.local.save("slot1", table);
    const saved = pinStorage.local.load("slot1");

    assert.strictEqual(table.date, undefined, "local save should not mutate the live table object");
    assert.strictEqual(saved.tableVersion, "1", "local save should add display tableVersion metadata");
    assert(!Number.isNaN(Date.parse(saved.date)), "local save should add an ISO date for table browsing");
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
        assert.strictEqual(state.connectionStatus, "Missing required provider settings: baseUrl", "missing settings should be explicit in status");
    });
}

function testAssistantProviderUiAutosavesModelAndWarns() {
    /* What: Assert provider panel wires model edits to immediate persistence hook.
     * Why: Chat/Agentic should not lose model picks due to unsaved draft-only state.
     */
    const source = read("app/editor/panels.js");
    assert(/onAutoSaveAssistantModel/.test(source), "assistant provider panel should call model auto-save hook");
    assert(/item\.id != null \? item\.id : item\.value/.test(source), "assistant provider model picker should accept value-based option entries");
    assert(/provider settings persist in browser localStorage on this machine/i.test(source), "assistant provider panel should warn about browser localStorage persistence");
}

function testAssistantUiExposesLogFromAllSubtabs() {
    /* What: Verify assistant log access and inline run status are visible in all assistant subtabs.
     * Why: Operators need one consistent place to inspect runtime behavior regardless of current subtab.
     */
    const source = read("app/editor/panels.js");
    assert(/\(model\.assistantSubtab \|\| "chat"\) === "provider"[\s\S]*Show Log/.test(source), "provider subtab should expose Show Log action");
    assert(/\(model\.assistantSubtab \|\| "chat"\) === "agentic"[\s\S]*Show Log/.test(source), "agentic subtab should expose Show Log action");
    assert(/Run status:\s*"\s*\+\s*\(runStatus\.flow/.test(source), "assistant subtabs should show inline run status");
}

function testAiLabAutosavesModelAndWarns() {
    /* What: Assert AI-Lab persists model edits directly into shared assistant settings.
     * Why: Lab runs should reuse the selected model immediately across navigation.
     */
    const source = read("app/tuning/lab.js");
    assert(/function aiLabPersistModelOnly\(/.test(source), "ai-lab should define model-only persistence helper");
    assert(/aiModelSelect\.onchange[\s\S]*aiLabPersistModelOnly\(picked\)/.test(source), "ai-lab model dropdown should auto-save selected model");
    assert(/aiModelInput\.oninput[\s\S]*aiLabPersistModelOnly\(aiModelInput\.value\)/.test(source), "ai-lab model input should auto-save typed model");
    assert(/provider settings persist in browser localStorage on this machine/i.test(source), "ai-lab should warn about browser localStorage persistence");
}

function testAssistantRunPathsCommitDirtyProviderDraft() {
    /* What: Verify Chat/Agentic run actions commit pending provider draft changes.
     * Why: users should be able to set provider fields and run immediately without
     * requiring an explicit Provider Save click.
     */
    const source = read("app/editor/editor.js");
    assert(/onSendAssistantMessage[\s\S]*inspectorDrafts\["assistant:settings"\][\s\S]*assistantRuntime\.setSettings\(providerDraft\.draft\)/.test(source), "chat run should commit dirty provider draft");
    assert(/onRunAgentic[\s\S]*inspectorDrafts\["assistant:settings"\][\s\S]*assistantRuntime\.setSettings\(providerDraft\.draft\)/.test(source), "agentic run should commit dirty provider draft");
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

function loadTroughLogicHarness() {
    // What: Load trough, rules, events, and logic simulation together.
    // Why: Cobra bonus troughs must behave like physical switches for multiplier rules.
    const pin = {
        elements: {
            registry: {},
            register: function register(type, mod) {
                this.registry[type] = mod;
            }
        }
    };
    const ctx = { window: { Pin: pin }, console: console };
    ctx.Pin = ctx.window.Pin;
    vm.createContext(ctx);
    vm.runInContext(read("app/table.js"), ctx, { filename: "app/table.js" });
    vm.runInContext(read("app/rules.js"), ctx, { filename: "app/rules.js" });
    vm.runInContext(read("app/logic/logicTypes.js"), ctx, { filename: "app/logic/logicTypes.js" });
    vm.runInContext(read("app/logic/expressions.js"), ctx, { filename: "app/logic/expressions.js" });
    vm.runInContext(read("app/logic/simulate.js"), ctx, { filename: "app/logic/simulate.js" });
    vm.runInContext(read("app/logic/compile.js"), ctx, { filename: "app/logic/compile.js" });
    vm.runInContext(read("app/events.js"), ctx, { filename: "app/events.js" });
    vm.runInContext(read("app/elements/trough.js"), ctx, { filename: "app/elements/trough.js" });
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
        logicDocument: { logicVersion: 1, switchRegistry: [], stateTable: [], computedState: [], lampBindings: [], actionRules: [], resetRules: [] }
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
        assert(Array.isArray(state.logs) && state.logs.length > 0, "assistant should capture provider flow logs");
        const requestLog = state.logs.find(function find(row) { return row && row.kind === "provider_request"; });
        const responseLog = state.logs.find(function find(row) { return row && row.kind === "provider_response_raw"; });
        const previewLog = state.logs.find(function find(row) { return row && row.kind === "preview_result"; });
        assert(requestLog && requestLog.flow === "chat", "provider request log should include chat flow metadata");
        assert(requestLog && requestLog.phase === "provider", "provider request log should include provider phase");
        assert(requestLog && typeof requestLog.summary === "string" && requestLog.summary.length > 0, "provider request log should include human summary");
        assert(responseLog && responseLog.detail.indexOf("secret") < 0, "provider logs should redact API key values");
        assert(previewLog && previewLog.phase === "preview", "preview result should be logged with preview phase");
        assert(state.runStatus && typeof state.runStatus.summary === "string", "assistant state should expose inline run status");
        const rules = state.lastPatch.logicDocPatch.actionRules || [];
        const lamps = state.lastPatch.logicDocPatch.lampBindings || [];
        assert(rules.some(function some(rule) { return rule && rule.trigger === "dt_left"; }), "chat/provider patch should include hit rule for drop target");
        assert(lamps.some(function some(binding) { return binding && binding.lampId === "dt_left"; }), "chat/provider patch should include lamp binding for drop target");
    });
}

function testAssistantToolsRadialLayout() {
    const tools = loadAssistantToolsModule();
    const catalog = tools.describeTools();
    assert.strictEqual(Array.isArray(catalog), true, "assistant tools should expose a tool catalog");
    assert(catalog.some(function some(entry) { return entry && entry.name === "radialLayout"; }), "assistant tool catalog should describe radialLayout");
    const result = tools.runToolRequest({
        tool: "radialLayout",
        args: {
            elementType: "light",
            count: 12,
            radius: 90,
            center: { x: 200, y: 300 }
        }
    }, { table: { elements: [] }, selected: null });
    assert.strictEqual(result.ok, true, "radialLayout should succeed with explicit numeric args");
    assert.strictEqual(result.patch.addElements.length, 12, "radialLayout should generate the requested count");
    const first = result.patch.addElements[0];
    assert(Math.abs(first.x - 200) < 0.001, "first radial element should align on start angle x");
    assert(Math.abs(first.y - 210) < 0.001, "first radial element should align on start angle y");
}

function testAssistantExecutesToolRequestsBeforePatch() {
    const storage = memoryStorage();
    let call = 0;
    const requestBodies = [];
    const assistantApi = loadAssistantModule(storage, function mockFetch(endpoint, options) {
        call += 1;
        requestBodies.push(JSON.parse(options.body));
        if (call === 1) {
            return Promise.resolve({
                ok: true,
                json: function json() {
                    return Promise.resolve({
                        choices: [{
                            message: {
                                content: JSON.stringify({
                                    toolRequests: [{
                                        tool: "radialLayout",
                                        args: { elementType: "light", count: 12, radius: 60, centerElementId: "center_a" }
                                    }]
                                })
                            }
                        }]
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
                                addElements: [{
                                    id: "light_mock",
                                    type: "light",
                                    level: 0,
                                    x: 10,
                                    y: 20,
                                    radius: 8,
                                    lampId: "light_mock"
                                }]
                            })
                        }
                    }]
                });
            }
        });
    });
    const table = {
        version: 1,
        name: "Tool Flow",
        playfield: {},
        rules: {},
        elements: [{ id: "center_a", type: "bumper", x: 250, y: 400, radius: 20 }],
        logicDocument: { logicVersion: 1, switchRegistry: [], stateTable: [], computedState: [], lampBindings: [], actionRules: [], resetRules: [] }
    };
    const runtime = assistantApi.create({
        getTable: function getTable() { return table; },
        getSelected: function getSelected() { return table.elements[0]; },
        previewPatch: function previewPatch() { return { ok: true, issuesCount: 0, issues: [] }; },
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
    runtime.setDraft("Create 12 lights around selected bumper.");
    return runtime.send().then(function done() {
        const state = runtime.getState();
        assert.strictEqual(call, 2, "assistant should run a second provider pass after local tool execution");
        const firstPrompt = requestBodies[0].messages[1].content;
        assert(/Available local tools/.test(firstPrompt), "assistant prompt should advertise the local tool catalog");
        const secondPrompt = requestBodies[1].messages[1].content;
        assert(/Tool results from local deterministic functions/.test(secondPrompt), "second provider prompt should include tool results");
        assert(state.lastPatch && Array.isArray(state.lastPatch.addElements), "assistant should finish with a patch response");
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
        logicDocument: { logicVersion: 1, switchRegistry: [], stateTable: [], computedState: [], lampBindings: [], actionRules: [], resetRules: [] }
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
        logicDocument: { logicVersion: 1, switchRegistry: [], stateTable: [], computedState: [], lampBindings: [], actionRules: [], resetRules: [] }
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
        logicDocument: { logicVersion: 1, switchRegistry: [], stateTable: [], computedState: [], lampBindings: [], actionRules: [], resetRules: [] }
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
        logicDocument: { logicVersion: 1, switchRegistry: [], stateTable: [], computedState: [], lampBindings: [], actionRules: [], resetRules: [] }
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

function testLogicSimulationScoreEffectsAccumulate() {
    const pin = loadLogicModules();
    const doc = {
        logicVersion: 1,
        switchRegistry: [
            { id: "target_a", sourceElementId: "target_a", kind: "switch" },
            { id: "collect", sourceElementId: "collect", kind: "switch" }
        ],
        stateTable: [
            { id: "ready", type: "bool", initial: false, volatile: true }
        ],
        computedState: [],
        lampBindings: [],
        actionRules: [
            { id: "A_TARGET", trigger: "target_a", condition: "", effects: [{ type: "score", value: 250 }, { type: "set", target: "ready", value: true }], enabled: true },
            { id: "A_COLLECT", trigger: "collect", condition: "ready", effects: [{ type: "score", value: 1000 }], enabled: true }
        ],
        resetRules: []
    };
    const runtime = pin.logicSim.createRuntime(doc);
    pin.logicSim.fireSwitch(runtime, "target_a");
    assert.strictEqual(runtime.score, 250, "score effect should add target points");
    pin.logicSim.fireSwitch(runtime, "collect");
    assert.strictEqual(runtime.score, 1250, "later score effects should accumulate instead of replacing score");
}

function testCobraBonusTroughAdvancesScoreMultiplier() {
    // What: Simulate Cobra's Group A bonus trough capture through runtime events.
    // Why: multiplier rules are keyed to trough ids, so trough capture must close
    // the physical switch before any score overrides can apply to table objects.
    const pin = loadTroughLogicHarness();
    const table = pin.table.normalizeTable(JSON.parse(read("tables/Cobra.json")));
    const trough = table.elements.find(function find(el) { return el.id === "trough_ftgkei"; });
    const target = table.elements.find(function find(el) { return el.id === "dropTarget_5ydirb"; });
    const doc = pin.logicCompile.extractFromTable(table);
    const runtime = pin.logicSim.createRuntime(doc);
    runtime.values.a_bonus_ready = true;
    runtime.values.group_b_claim_lit = true;
    pin.logicSim.refreshDerived(runtime);
    const world = {
        table: table,
        events: [],
        logicRuntime: runtime,
        ruleState: { elementProperties: { trough_ftgkei: { active: true } } },
        score: 0,
        physicsTick: 1,
        physicsTime: 0,
        lastPhysicsDt: 1 / 120
    };
    const sensor = pin.elements.registry.trough.compile(trough).sensors[0];
    const ball = { x: trough.x, y: trough.y, vx: 4, vy: -3, radius: 5, level: 0 };

    sensor.onEnter(ball, world, sensor);

    assert(world.events.some(function some(event) {
        return event.type === "switchClosed" && event.sourceId === "trough_ftgkei";
    }), "Cobra bonus trough capture should close the trough switch");

    pin.events.processRules(world, 1 / 120);

    assert.strictEqual(runtime.values.score_multiplier, 2, "Cobra trough collect should advance multiplier from 1x to 2x");
    assert.strictEqual(pin.rules.resolveElementScore(world, target, target.score), 100, "Cobra target default score should resolve at 2x after multiplier collect");
}

Promise.resolve()
    .then(function run() { testIndexScriptsExistAndOrderCoreBeforeMain(); })
    .then(function run() { testIndexLocalAssetsAreVersioned(); })
    .then(function run() { testPhysicsLabLoadsEvalHarnessScripts(); })
    .then(function run() { testTableEvalAccessibilityHeatmapIsRegistered(); })
    .then(function run() { testTableEvalAccessibilityHeatmapIgnoresGateColliders(); })
    .then(function run() { testTableEvalAccessibilityModeSupportsPhysics(); })
    .then(function run() { testLabDiagnosticOverlayRendersHeatmap(); })
    .then(function run() { testLabEvalControlsExposeAccessibilityBreadthDepthAndMode(); })
    .then(function run() { testLabSupportsLiveAccessibilityProgressOverlay(); })
    .then(function run() { testTableEvalEmitsAccessibilityProgress(); })
    .then(function run() { testPhysicsLabSupportsDynamicPlayfieldSizing(); })
    .then(function run() { testEditorFlipperAnglesAreEditableInDegrees(); })
    .then(function run() { testTableCatalogRefsExistAndAreStaticJson(); })
    .then(function run() { testDefaultTableNormalizesAndValidates(); })
    .then(function run() { testDrainWithoutTroughIsPlayable(); })
    .then(function run() { testLauncherWidthClampsToBallSafeMinimum(); })
    .then(function run() { testNarrowLauncherPlayabilityWarnsBeforeNormalize(); })
    .then(function run() { testTableRealTimeScaleDefaultsAndValidation(); })
    .then(function run() { testPhysicsTiltAppliesImpulseAndLocksOutUntilCleared(); })
    .then(function run() { testFlipperAngleStaysWithinAuthoredBounds(); })
    .then(function run() { testFlipperRoundedEndsUseRadialCollisionNormals(); })
    .then(function run() { testFlipperElbowReleaseDropsStaleSupportedContact(); })
    .then(function run() { testFlipperSupportedContactUsesCurrentBlade(); })
    .then(function run() { testFlipperSupportedContactPreservesOutwardSeparation(); })
    .then(function run() { testFlipperRepeatedSameFrameContactStillResolves(); })
    .then(function run() { testFlipperUndersideBlocksUpwardPassThrough(); })
    .then(function run() { testFlipperRootAndTipRadiiAffectContactReach(); })
    .then(function run() { testSpinnerBladesDoNotBlockBall(); })
    .then(function run() { testSpinnerSweepContactDoesNotBlockBallTravel(); })
    .then(function run() { testGateDirectionModesCanOpen(); })
    .then(function run() { testGateSwingHandleUsesSmallSignedOpeningAngle(); })
    .then(function run() { testRuntimeSplitKeepsOnlyPhysicsElementsDynamic(); })
    .then(function run() { testAdaptiveQualityControllerIgnoresSingleSpike(); })
    .then(function run() { testAdaptiveQualityControllerDropsOnSustainedPressure(); })
    .then(function run() { testAdaptiveQualityControllerNeedsStableRecoveryWindow(); })
    .then(function run() { testAdaptiveQualityControllerDoesNotOscillateOnBorderlineLoad(); })
    .then(function run() { testPlayLoopSamplesQualityAfterPhysicsCatchup(); })
    .then(function run() { testPlayLoopAppliesTableRealTimeScale(); })
    .then(function run() { testSparkHelpersEmitAndExpireParticles(); })
    .then(function run() { testReducedEffectsSuppressSparkEmission(); })
    .then(function run() { testSparkLimitCanDisableParticlesWithoutReducedEffects(); })
    .then(function run() { testPhysicsCollisionsEmitSparkBurstsWithoutElementHitHandlers(); })
    .then(function run() { testFeatureSchemaNormalizesAndValidates(); })
    .then(function run() { testBundledTableImagePathsExist(); })
    .then(function run() { testExplicitTableRequestDoesNotSilentlyFallback(); })
    .then(function run() { testEditorCarriesTableAssetBaseIntoRendering(); })
    .then(function run() { testPlayControlsCanBeHiddenFromKeyboard(); })
    .then(function run() { testEditorLauncherWidthUsesSharedClamp(); })
    .then(function run() { testEditorFlipperOpeningAngleHandleIsVisibleAndDraggable(); })
    .then(function run() { testEditorMultiSelectMoveContracts(); })
    .then(function run() { testHighScoresAreTableScopedSortedAndCapped(); })
    .then(function run() { testHighScoresUseExplicitKeyAndThreeInitials(); })
    .then(function run() { testStorageClearsOnlyPinLocalState(); })
    .then(function run() { testLocalTableSaveAddsBrowseMetadata(); })
    .then(function run() { testAssistantProviderSettingsPersist(); })
    .then(function run() { testAssistantProviderUiAutosavesModelAndWarns(); })
    .then(function run() { testAssistantUiExposesLogFromAllSubtabs(); })
    .then(function run() { testAiLabAutosavesModelAndWarns(); })
    .then(function run() { testAssistantRunPathsCommitDirtyProviderDraft(); })
    .then(function run() { return testAssistantProviderConnectionAndModelFeedback(); })
    .then(function run() { return testAssistantConnectionRequiresBaseUrlAndApiKeyOnly(); })
    .then(function run() { return testAssistantLoadModelsRequiresProviderSettings(); })
    .then(function run() { return testAssistantChatUsesProviderPath(); })
    .then(function run() { testAssistantToolsRadialLayout(); })
    .then(function run() { return testAssistantExecutesToolRequestsBeforePatch(); })
    .then(function run() { return testAgenticBypassesShortcutAndRequiresProvider(); })
    .then(function run() { return testAssistantRepairsPatchAcrossAttempts(); })
    .then(function run() { return testAssistantRepairsContractValidationFailures(); })
    .then(function run() { return testAssistantReportsExhaustedContractIssues(); })
    .then(function run() { return testAssistantRepairsInvalidFeaturePatchShape(); })
    .then(function run() { testLogicDocRoundTripUsesCurrentSchema(); })
    .then(function run() { testTimerSwitchValidationAndSimulation(); })
    .then(function run() { testLogicSimulationScoreEffectsAccumulate(); })
    .then(function run() { testCobraBonusTroughAdvancesScoreMultiplier(); })
    .then(function done() {
        console.log("smoke tests ok");
    })
    .catch(function fail(err) {
        console.error(err);
        process.exitCode = 1;
    });
