/*
 * Visual physics tuning lab.
 * Why: provide deterministic scenario tuning plus a lightweight sandbox for
 * ad hoc wall and ball experiments on the same runtime path as the game.
 */
(function initPhysicsLab(Pin) {
    function create(tag, className, text) {
        const el = document.createElement(tag);
        if (className) el.className = className;
        if (text != null) el.textContent = text;
        return el;
    }

    function round(value, digits) {
        const factor = Math.pow(10, digits == null ? 3 : digits);
        return Math.round(value * factor) / factor;
    }

    function clone(value) {
        return JSON.parse(JSON.stringify(value));
    }

    function radToDeg(value) {
        return value * 180 / Math.PI;
    }

    function degToRad(value) {
        return value * Math.PI / 180;
    }

    function distance(a, b) {
        const dx = a.x - b.x;
        const dy = a.y - b.y;
        return Math.sqrt(dx * dx + dy * dy);
    }

    function normalizeAngle(angle) {
        while (angle > Math.PI) angle -= Math.PI * 2;
        while (angle < -Math.PI) angle += Math.PI * 2;
        return angle;
    }

    function scenarioById(id) {
        return Pin.physicsHarness.scenarios.find(function find(entry) { return entry.id === id; }) || Pin.physicsHarness.scenarios[0];
    }

    function initialInputs(scenario) {
        const out = {};
        scenario.params.forEach(function each(param) { out[param.key] = param.value; });
        return out;
    }

    /*
     * Normalize sandbox flipper tuning so older saved layouts still expose the
     * current material controls in the lab.
     * Why: the sandbox should stay aligned with the runtime defaults even when a
     * table fragment predates current surface-level tuning defaults.
     */
    function normalizeSandboxFlipper(element) {
        if (!element || element.type !== "flipper") return element;
        if (typeof element.strikeBoost !== "number") element.strikeBoost = 0.52;
        if (typeof element.surfaceRestitution !== "number") element.surfaceRestitution = 0.28;
        if (typeof element.surfaceFriction !== "number") element.surfaceFriction = 0.08;
        if (typeof element.rootRadius !== "number") {
            const thickness = typeof element.thickness === "number" ? element.thickness : 10;
            element.rootRadius = Math.max(8, thickness * 1.4);
        }
        if (typeof element.tipRadius !== "number") {
            const thickness = typeof element.thickness === "number" ? element.thickness : 10;
            element.tipRadius = Math.max(5, thickness * 0.7);
        }
        return element;
    }

    function metricEntries(sim) {
        const metrics = sim.getMetrics();
        const liveBall = metrics.ball || sim.ball;
        if (sim.id === "sandbox") {
            return [
                { label: "Tick", value: sim.tick },
                { label: "Walls", value: metrics.segmentCount || 0 },
                { label: "Flippers", value: metrics.flipperCount || 0 },
                { label: "Balls", value: metrics.ballCount || 0 },
                { label: "Ball X", value: liveBall ? round(liveBall.x, 2) : "-" },
                { label: "Ball Y", value: liveBall ? round(liveBall.y, 2) : "-" },
                { label: "Ball VX", value: liveBall ? round(liveBall.vx, 3) : "-" },
                { label: "Ball VY", value: liveBall ? round(liveBall.vy, 3) : "-" }
            ];
        }
        if (sim.id === "heldTrap") {
            return [
                { label: "Tick", value: sim.tick + " / " + sim.totalTicks },
                { label: "Tail Avg", value: round(metrics.tailAvg, 3) },
                { label: "Tail Max", value: round(metrics.tailMax, 3) },
                { label: "Early Roll", value: round(metrics.earlyRollDistance || 0, 2) },
                { label: "Total Roll", value: round(metrics.rollDistance || 0, 2) },
                { label: "Ball X", value: liveBall ? round(liveBall.x, 2) : "-" },
                { label: "Ball Y", value: liveBall ? round(liveBall.y, 2) : "-" }
            ];
        }
        if (sim.id === "movingCatch") {
            return [
                { label: "Tick", value: sim.tick + " / " + sim.totalTicks },
                { label: "Peak Upward VY", value: round(metrics.peakUpward, 3) },
                { label: "Tail Avg", value: round(metrics.tailAvg, 3) },
                { label: "Tail Max", value: round(metrics.tailMax, 3) },
                { label: "Ball X", value: liveBall ? round(liveBall.x, 2) : "-" },
                { label: "Ball Y", value: liveBall ? round(liveBall.y, 2) : "-" },
                { label: "Ball VY", value: liveBall ? round(liveBall.vy, 3) : "-" }
            ];
        }
        return [
            { label: "Tick", value: sim.tick + " / " + sim.totalTicks },
            { label: "Release Angle", value: metrics.angleAtRelease == null ? "-" : round(metrics.angleAtRelease, 3) },
            { label: "Release Velocity", value: metrics.velocityAtRelease == null ? "-" : round(metrics.velocityAtRelease, 3) },
            { label: "Carry Angle", value: metrics.firstCarryAngle == null ? "-" : round(metrics.firstCarryAngle, 3) },
            { label: "Carry Velocity", value: metrics.firstCarryVelocity == null ? "-" : round(metrics.firstCarryVelocity, 3) },
            { label: "Reverse Tick", value: metrics.reverseTick == null ? "-" : metrics.reverseTick },
            { label: "Re-Engage Tick", value: metrics.reengageReverseTick == null ? "-" : metrics.reengageReverseTick },
            { label: "Final Angle", value: metrics.finalAngle == null ? "-" : round(metrics.finalAngle, 3) }
        ];
    }

    function statusText(status) {
        return String(status || "warn").toUpperCase();
    }

    function groupChecksByCategory(checks) {
        const grouped = {};
        (checks || []).forEach(function each(check) {
            const key = check.category || "other";
            if (!grouped[key]) grouped[key] = [];
            grouped[key].push(check);
        });
        return grouped;
    }

    function createEvalPreviewWorld(table) {
        const staticRuntime = Pin.elements.compileElements(table, null, { dynamic: false });
        const dynamicElements = Pin.elements.filterElements ?
            Pin.elements.filterElements(table, Pin.elements.isDynamicPhysicsType) :
            (table.elements || []);
        const dynamicRuntime = Pin.elements.compileElements(table, null, {
            static: false,
            dynamicPhysicsOnly: true,
            elements: dynamicElements
        });
        return {
            table: table,
            balls: [],
            controls: { left: false, right: false },
            elementState: {},
            staticRuntime: staticRuntime,
            dynamicRuntime: dynamicRuntime,
            runtime: {
                segments: (staticRuntime.segments || []).concat(dynamicRuntime.segments || []),
                circles: (staticRuntime.circles || []).concat(dynamicRuntime.circles || []),
                ramps: (staticRuntime.ramps || []).concat(dynamicRuntime.ramps || []),
                sensors: (staticRuntime.sensors || []).concat(dynamicRuntime.sensors || []),
                drawables: (staticRuntime.drawables || []).concat(dynamicRuntime.drawables || [])
            }
        };
    }

    function clamp(value, min, max) {
        return Math.max(min, Math.min(max, value));
    }

    function mount() {
        const defaultPlayfield = Object.assign({
            gravity: 0.35,
            friction: 0.999,
            restitution: 0.55,
            maxSpeed: 24,
            ballRadius: 8
        }, (Pin.table && Pin.table.DEFAULT_PLAYFIELD) || {});
        const evalRunChecks = (Pin.tableEval && typeof Pin.tableEval.listChecks === "function")
            ? Pin.tableEval.listChecks()
            : [
                { id: "table_validation", label: "Table Schema Validation", category: "static" },
                { id: "playability_validation", label: "Playability Validation", category: "static" },
                { id: "ids_and_types", label: "Element IDs and Types", category: "static" },
                { id: "numeric_fields", label: "Numeric Field Validation", category: "static" },
                { id: "bounds", label: "Playfield Bounds", category: "static" },
                { id: "compilation", label: "Runtime Compilation", category: "static" },
                { id: "launcher_rays", label: "Launcher Reachability Rays", category: "stuck" },
                { id: "flipper_reachability", label: "Flipper Reachability Rays", category: "reachability" },
                { id: "target_to_flipper_reachability", label: "Target To Flipper Reachability", category: "reachability" },
                { id: "autoplay_heatmap", label: "Autoplay Heatmap", category: "autoplay" },
                { id: "reachability_todo", label: "Reachability TODO Reminder", category: "reachability" }
            ];
        const defaultEvalSelection = {};
        evalRunChecks.forEach(function each(check) {
            if (!check || typeof check.id !== "string") return;
            defaultEvalSelection[check.id] = true;
        });
        const root = document.getElementById("app");
        const state = {
            scenarioId: Pin.physicsHarness.scenarios[0].id,
            tuning: clone(Pin.physicsHarness.defaultTuning),
            inputs: initialInputs(Pin.physicsHarness.scenarios[0]),
            playing: true,
            sim: null,
            eval: {
                selectedRef: "",
                selectedTable: null,
                selectedName: "",
                loadError: "",
                report: null,
                selectedCheckIndex: -1,
                liveCheck: null,
                launchRayCount: 5,
                launchMaxCollisions: 400,
                launchMaxTicks: 10000,
                targetRayCount: 7,
                targetMaxBounces: 5,
                accessibilityRayMode: "geometric",
                accessibilityBranchRays: 16,
                accessibilityMaxDepth: 3,
                accessibilityCellSize: 32,
                accessibilityRaySpeed: 15,
                accessibilityMaxTicks: 420,
                accessibilityMaxCollisions: 1,
                autoplayBallCount: 5,
                autoplayMaxTicksPerBall: 12000,
                autoplayTargetingIntervalTicks: 8,
                autoplayPreferUnlitTargets: true,
                autoplayCellSize: 24,
                autoplayMinScore: 0,
                autoplayAimHorizonTicks: 48,
                autoplayAimPulseTicks: 3,
                autoplayAimCooldownTicks: 8,
                runChecks: evalRunChecks,
                selectedChecks: defaultEvalSelection,
                runId: 0,
                running: false
            },
            autoplay: {
                liveRunning: false,
                liveController: null,
                liveMode: "heuristic",
                liveSummary: "",
                liveStatus: "Idle",
                liveHeatmap: null,
                livePath: [],
                liveTrajectories: [],
                liveServeIndex: 0,
                liveWasInLaunchLane: true,
                liveSampleCounter: 0,
                neuralModel: null,
                neuralLastLoss: null,
                neuralSampleCount: 0,
                neuralEpochs: 4,
                neuralTrainingBalls: 10,
                neuralMaxSamples: 3000,
                neuralHiddenSize: 12,
                neuralLastDebug: null,
                training: {
                    collecting: false,
                    total: 0,
                    rawTotal: 0,
                    usedTotal: 0,
                    none: 0,
                    left: 0,
                    right: 0,
                    startedAt: 0,
                    samplesPerSec: 0,
                    liveSamples: [],
                    liveActionSamples: 0,
                    recentLiveSamples: [],
                    shotSamples: [],
                    recentShotSamples: [],
                    shotHitMap: {},
                    pendingShotAttempts: [],
                    successSampleCount: 0,
                    prevAutoControls: { left: false, right: false },
                    liveCollectEnabled: true
                }
            },
            aiLab: {
                prompt: "",
                running: false,
                providerChecking: false,
                providerLastCheckedMs: 0,
                modelsLoading: false,
                mode: "stepwise",
                autoEnabled: false,
                batchEnabled: false,
                maxAttempts: 6,
                stopOnFail: true,
                stopOnWarn: false,
                requireManualApply: true,
                attempts: [],
                selectedAttemptIndex: -1,
                pendingPatchedTable: null,
                checkpointTable: null,
                checkpointName: "",
                status: "Idle"
            },
            ui: {
                activeTab: "tune"
            },
            runtime: {
                metricRows: [],
                metricRowCount: 0,
                lastMetricsRefreshMs: 0,
                metricsRefreshIntervalMs: 100,
                dirty: true,
                perfEnabled: false,
                perfFrameMs: 0,
                perfRenderMs: 0,
                perfMetricsMs: 0
            },
            sandbox: {
                tool: "select",
                draftWall: null,
                draggingSpawn: false,
                selectedElementId: "",
                dragSelection: null,
                elements: [],
                baseTable: null,
                playfield: {
                    width: defaultPlayfield.width,
                    height: defaultPlayfield.height
                },
                physics: {
                    gravity: defaultPlayfield.gravity,
                    friction: defaultPlayfield.friction,
                    restitution: defaultPlayfield.restitution,
                    maxSpeed: defaultPlayfield.maxSpeed
                },
                spawn: {
                    x: 250,
                    y: 140,
                    radius: defaultPlayfield.ballRadius,
                    vx: 0,
                    vy: 0,
                    useLauncher: false
                },
                rayProbe: {
                    raysPerFlipper: 7,
                    spreadDeg: 16,
                    maxBounces: 5,
                    speed: 15,
                    traces: [],
                    origin: null,
                    envelopes: []
                },
                controls: { left: false, right: false, launch: false },
                launchHeldPrev: false
            }
        };

        const shell = create("div", "lab-shell");
        const left = create("aside", "lab-panel");
        const centerColumn = create("main", "lab-center");
        const topBar = create("div", "lab-topbar");
        const center = create("div", "lab-canvas-wrap");
        const right = create("aside", "lab-panel right");
        shell.appendChild(left);
        centerColumn.appendChild(topBar);
        centerColumn.appendChild(center);
        shell.appendChild(centerColumn);
        shell.appendChild(right);
        root.appendChild(shell);

        left.appendChild(create("h1", "", "Physics Lab"));
        left.appendChild(create("p", "small", "Desktop workflow: switch context tabs to keep controls shallow and reduce scrolling."));

        const tabRow = create("div", "lab-tabs");
        const tabTune = create("button", "active", "Tune");
        const tabSandbox = create("button", "", "Sandbox");
        const tabEval = create("button", "", "Eval");
        const tabBrain = create("button", "", "Brain");
        const tabAi = create("button", "", "AI-Lab");
        tabRow.appendChild(tabTune);
        tabRow.appendChild(tabSandbox);
        tabRow.appendChild(tabEval);
        tabRow.appendChild(tabBrain);
        tabRow.appendChild(tabAi);
        left.appendChild(tabRow);
        const tabBody = create("div", "lab-tab-body");
        left.appendChild(tabBody);
        const tunePanel = create("section", "lab-tab-panel active");
        const sandboxPanel = create("section", "lab-tab-panel");
        const evalPanel = create("section", "lab-tab-panel");
        const brainPanel = create("section", "lab-tab-panel");
        const aiPanel = create("section", "lab-tab-panel");
        tabBody.appendChild(tunePanel);
        tabBody.appendChild(sandboxPanel);
        tabBody.appendChild(evalPanel);
        tabBody.appendChild(brainPanel);
        tabBody.appendChild(aiPanel);

        const navRow = create("div", "lab-actions lab-top-nav");
        const navSelector = create("button", "", "Selector");
        const navPlay = create("button", "", "Play");
        const navDesign = create("button", "", "Design");
        const navLogic = create("button", "", "Logic");
        navRow.appendChild(navSelector);
        navRow.appendChild(navPlay);
        navRow.appendChild(navDesign);
        navRow.appendChild(navLogic);
        topBar.appendChild(navRow);
        const scenarioSelect = create("select", "lab-select");
        Pin.physicsHarness.scenarios.forEach(function each(entry) {
            const opt = document.createElement("option");
            opt.value = entry.id;
            opt.textContent = entry.name;
            scenarioSelect.appendChild(opt);
        });
        topBar.appendChild(scenarioSelect);

        const actionRow = create("div", "lab-actions lab-top-actions");
        const playPause = create("button", "", "Pause");
        const restart = create("button", "", "Restart");
        const step = create("button", "", "Step");
        const copy = create("button", "lab-copy", "Copy JSON");
        const perfToggle = create("button", "", "Perf Off");
        actionRow.appendChild(playPause);
        actionRow.appendChild(restart);
        actionRow.appendChild(step);
        actionRow.appendChild(copy);
        actionRow.appendChild(perfToggle);
        topBar.appendChild(actionRow);
        const perfText = create("div", "lab-perf", "Perf off");
        topBar.appendChild(perfText);

        const scenarioInfo = create("div", "lab-group");
        tunePanel.appendChild(scenarioInfo);
        const scenarioControls = create("div");
        tunePanel.appendChild(scenarioControls);
        const tuningControls = create("div");
        tunePanel.appendChild(tuningControls);
        const sandboxControls = create("div");
        sandboxPanel.appendChild(sandboxControls);

        const stage = create("div", "lab-stage");
        const canvas = create("canvas", "lab-canvas");
        canvas.width = 500;
        canvas.height = 880;
        stage.appendChild(canvas);
        center.appendChild(stage);
        const ctx = canvas.getContext("2d");

        function syncCanvasPlayfield(playfield) {
            const pf = playfield || {};
            const width = Number.isFinite(pf.width) && pf.width > 80 ? Math.round(pf.width) : 500;
            const height = Number.isFinite(pf.height) && pf.height > 120 ? Math.round(pf.height) : 880;
            if (canvas.width !== width) canvas.width = width;
            if (canvas.height !== height) canvas.height = height;
            canvas.style.aspectRatio = width + " / " + height;
        }

        right.appendChild(create("h2", "", "Metrics"));
        const metricsWrap = create("div", "lab-group");
        const runStateSummary = create("div", "lab-eval-summary");
        runStateSummary.textContent = "No simulation loaded.";
        metricsWrap.appendChild(runStateSummary);
        const metricList = create("div", "lab-metric-list");
        metricsWrap.appendChild(metricList);
        right.appendChild(metricsWrap);

        right.appendChild(create("h2", "", "Autoplay Brain"));
        const neuralWrap = create("div", "lab-group");
        const neuralStatus = create("div", "lab-eval-summary", "Neural policy: untrained.");
        const neuralMetrics = create("div", "lab-metric-list");
        const neuralTrainingStatus = create("div", "lab-eval-summary", "Training data: idle.");
        const neuralShotDetailStatus = create("div", "lab-eval-summary", "Shot outcomes: idle.");
        const neuralHitMapStatus = create("div", "lab-eval-summary", "Target hits: idle.");
        neuralWrap.appendChild(neuralStatus);
        neuralWrap.appendChild(neuralTrainingStatus);
        neuralWrap.appendChild(neuralShotDetailStatus);
        neuralWrap.appendChild(neuralHitMapStatus);
        neuralWrap.appendChild(neuralMetrics);
        right.appendChild(neuralWrap);

        right.appendChild(create("h2", "", "Export"));
        right.appendChild(create("p", "small", "This fragment is intended to be pasted back into discussion so the tuned values can be applied to a real flipper."));
        const exportBox = document.createElement("textarea");
        exportBox.className = "lab-export";
        right.appendChild(exportBox);

        right.appendChild(create("h2", "", "Evaluation Detail"));
        const evalDetailWrap = create("div", "lab-group");
        const evalCheckDetail = document.createElement("textarea");
        evalCheckDetail.className = "lab-export";
        evalCheckDetail.style.minHeight = "120px";
        evalCheckDetail.readOnly = true;
        const evalReport = document.createElement("textarea");
        evalReport.className = "lab-export";
        evalReport.style.minHeight = "220px";
        evalDetailWrap.appendChild(evalCheckDetail);
        evalDetailWrap.appendChild(evalReport);
        right.appendChild(evalDetailWrap);

        evalPanel.appendChild(create("h2", "", "Table Eval"));
        evalPanel.appendChild(create("p", "small", "Run baseline PASS / WARN / FAIL checks against bundled tables."));
        const evalWrap = create("div", "lab-group");
        const evalTableSelect = create("select", "lab-select");
        const evalManifestInfo = create("div", "small", "Manifest tables: 0");
        const evalActions = create("div", "lab-actions");
        const loadTableButton = create("button", "", "Load Table");
        const runSelectedEvalButton = create("button", "", "Run Selected");
        const runAllEvalButton = create("button", "", "Run All");
        const evalSelectionActions = create("div", "lab-actions");
        const evalSelectAllButton = create("button", "", "Select All");
        const evalClearAllButton = create("button", "", "Clear All");
        const evalSelectionSummary = create("div", "small", "");
        const evalRunChecksList = create("div", "lab-eval-run-list");
        evalActions.appendChild(loadTableButton);
        evalActions.appendChild(runSelectedEvalButton);
        evalActions.appendChild(runAllEvalButton);
        evalSelectionActions.appendChild(evalSelectAllButton);
        evalSelectionActions.appendChild(evalClearAllButton);
        const launchRayRow = create("label", "lab-inline-field");
        launchRayRow.textContent = "Rays per source";
        const launchRayInput = document.createElement("input");
        launchRayInput.type = "number";
        launchRayInput.min = "1";
        launchRayInput.max = "500";
        launchRayInput.step = "1";
        launchRayInput.value = String(state.eval.launchRayCount);
        launchRayInput.className = "lab-number";
        launchRayRow.appendChild(launchRayInput);
        const launchCollisionRow = create("label", "lab-inline-field");
        launchCollisionRow.textContent = "Max contacts";
        const launchCollisionInput = document.createElement("input");
        launchCollisionInput.type = "number";
        launchCollisionInput.min = "1";
        launchCollisionInput.max = "5000";
        launchCollisionInput.step = "25";
        launchCollisionInput.value = String(state.eval.launchMaxCollisions);
        launchCollisionInput.className = "lab-number";
        launchCollisionRow.appendChild(launchCollisionInput);
        const launchTickRow = create("label", "lab-inline-field");
        launchTickRow.textContent = "Max ticks";
        const launchTickInput = document.createElement("input");
        launchTickInput.type = "number";
        launchTickInput.min = "60";
        launchTickInput.max = "60000";
        launchTickInput.step = "100";
        launchTickInput.value = String(state.eval.launchMaxTicks);
        launchTickInput.className = "lab-number";
        launchTickRow.appendChild(launchTickInput);
        const targetRayRow = create("label", "lab-inline-field");
        targetRayRow.textContent = "Target rays/source";
        const targetRayInput = document.createElement("input");
        targetRayInput.type = "number";
        targetRayInput.min = "1";
        targetRayInput.max = "120";
        targetRayInput.step = "1";
        targetRayInput.value = String(state.eval.targetRayCount);
        targetRayInput.className = "lab-number";
        targetRayRow.appendChild(targetRayInput);
        const targetBounceRow = create("label", "lab-inline-field");
        targetBounceRow.textContent = "Target max bounces";
        const targetBounceInput = document.createElement("input");
        targetBounceInput.type = "number";
        targetBounceInput.min = "0";
        targetBounceInput.max = "60";
        targetBounceInput.step = "1";
        targetBounceInput.value = String(state.eval.targetMaxBounces);
        targetBounceInput.className = "lab-number";
        targetBounceRow.appendChild(targetBounceInput);
        const accessibilityModeRow = create("label", "lab-inline-field");
        accessibilityModeRow.textContent = "Accessibility mode";
        const accessibilityModeSelect = document.createElement("select");
        accessibilityModeSelect.className = "lab-number";
        ["geometric", "physics"].forEach(function each(mode) {
            const option = document.createElement("option");
            option.value = mode;
            option.textContent = mode;
            if (state.eval.accessibilityRayMode === mode) option.selected = true;
            accessibilityModeSelect.appendChild(option);
        });
        accessibilityModeRow.appendChild(accessibilityModeSelect);
        const accessibilityBreadthRow = create("label", "lab-inline-field");
        accessibilityBreadthRow.textContent = "Accessibility breadth";
        const accessibilityBreadthInput = document.createElement("input");
        accessibilityBreadthInput.type = "number";
        accessibilityBreadthInput.min = "1";
        accessibilityBreadthInput.max = "64";
        accessibilityBreadthInput.step = "1";
        accessibilityBreadthInput.value = String(state.eval.accessibilityBranchRays);
        accessibilityBreadthInput.className = "lab-number";
        accessibilityBreadthRow.appendChild(accessibilityBreadthInput);
        const accessibilityDepthRow = create("label", "lab-inline-field");
        accessibilityDepthRow.textContent = "Accessibility depth";
        const accessibilityDepthInput = document.createElement("input");
        accessibilityDepthInput.type = "number";
        accessibilityDepthInput.min = "0";
        accessibilityDepthInput.max = "8";
        accessibilityDepthInput.step = "1";
        accessibilityDepthInput.value = String(state.eval.accessibilityMaxDepth);
        accessibilityDepthInput.className = "lab-number";
        accessibilityDepthRow.appendChild(accessibilityDepthInput);
        const accessibilityResolutionRow = create("label", "lab-inline-field");
        accessibilityResolutionRow.textContent = "Accessibility cell size";
        const accessibilityResolutionInput = document.createElement("input");
        accessibilityResolutionInput.type = "number";
        accessibilityResolutionInput.min = "8";
        accessibilityResolutionInput.max = "128";
        accessibilityResolutionInput.step = "1";
        accessibilityResolutionInput.value = String(state.eval.accessibilityCellSize);
        accessibilityResolutionInput.className = "lab-number";
        accessibilityResolutionRow.appendChild(accessibilityResolutionInput);
        const accessibilitySpeedRow = create("label", "lab-inline-field");
        accessibilitySpeedRow.textContent = "Accessibility speed";
        const accessibilitySpeedInput = document.createElement("input");
        accessibilitySpeedInput.type = "number";
        accessibilitySpeedInput.min = "1";
        accessibilitySpeedInput.max = "60";
        accessibilitySpeedInput.step = "0.5";
        accessibilitySpeedInput.value = String(state.eval.accessibilityRaySpeed);
        accessibilitySpeedInput.className = "lab-number";
        accessibilitySpeedRow.appendChild(accessibilitySpeedInput);
        const accessibilityTicksRow = create("label", "lab-inline-field");
        accessibilityTicksRow.textContent = "Accessibility max ticks";
        const accessibilityTicksInput = document.createElement("input");
        accessibilityTicksInput.type = "number";
        accessibilityTicksInput.min = "60";
        accessibilityTicksInput.max = "20000";
        accessibilityTicksInput.step = "20";
        accessibilityTicksInput.value = String(state.eval.accessibilityMaxTicks);
        accessibilityTicksInput.className = "lab-number";
        accessibilityTicksRow.appendChild(accessibilityTicksInput);
        const accessibilityContactsRow = create("label", "lab-inline-field");
        accessibilityContactsRow.textContent = "Accessibility max contacts";
        const accessibilityContactsInput = document.createElement("input");
        accessibilityContactsInput.type = "number";
        accessibilityContactsInput.min = "1";
        accessibilityContactsInput.max = "5000";
        accessibilityContactsInput.step = "1";
        accessibilityContactsInput.value = String(state.eval.accessibilityMaxCollisions);
        accessibilityContactsInput.className = "lab-number";
        accessibilityContactsRow.appendChild(accessibilityContactsInput);
        const autoplayBallRow = create("label", "lab-inline-field");
        autoplayBallRow.textContent = "Autoplay balls";
        const autoplayBallInput = document.createElement("input");
        autoplayBallInput.type = "number";
        autoplayBallInput.min = "1";
        autoplayBallInput.max = "64";
        autoplayBallInput.step = "1";
        autoplayBallInput.value = String(state.eval.autoplayBallCount);
        autoplayBallInput.className = "lab-number";
        autoplayBallRow.appendChild(autoplayBallInput);
        const autoplayTickRow = create("label", "lab-inline-field");
        autoplayTickRow.textContent = "Autoplay max ticks/ball";
        const autoplayTickInput = document.createElement("input");
        autoplayTickInput.type = "number";
        autoplayTickInput.min = "120";
        autoplayTickInput.max = "120000";
        autoplayTickInput.step = "120";
        autoplayTickInput.value = String(state.eval.autoplayMaxTicksPerBall);
        autoplayTickInput.className = "lab-number";
        autoplayTickRow.appendChild(autoplayTickInput);
        const autoplayTargetIntervalRow = create("label", "lab-inline-field");
        autoplayTargetIntervalRow.textContent = "Autoplay target interval";
        const autoplayTargetIntervalInput = document.createElement("input");
        autoplayTargetIntervalInput.type = "number";
        autoplayTargetIntervalInput.min = "1";
        autoplayTargetIntervalInput.max = "120";
        autoplayTargetIntervalInput.step = "1";
        autoplayTargetIntervalInput.value = String(state.eval.autoplayTargetingIntervalTicks);
        autoplayTargetIntervalInput.className = "lab-number";
        autoplayTargetIntervalRow.appendChild(autoplayTargetIntervalInput);
        const autoplayCellSizeRow = create("label", "lab-inline-field");
        autoplayCellSizeRow.textContent = "Autoplay cell size";
        const autoplayCellSizeInput = document.createElement("input");
        autoplayCellSizeInput.type = "number";
        autoplayCellSizeInput.min = "8";
        autoplayCellSizeInput.max = "128";
        autoplayCellSizeInput.step = "1";
        autoplayCellSizeInput.value = String(state.eval.autoplayCellSize);
        autoplayCellSizeInput.className = "lab-number";
        autoplayCellSizeRow.appendChild(autoplayCellSizeInput);
        const autoplayMinScoreRow = create("label", "lab-inline-field");
        autoplayMinScoreRow.textContent = "Autoplay min score";
        const autoplayMinScoreInput = document.createElement("input");
        autoplayMinScoreInput.type = "number";
        autoplayMinScoreInput.min = "0";
        autoplayMinScoreInput.max = "1000000000";
        autoplayMinScoreInput.step = "100";
        autoplayMinScoreInput.value = String(state.eval.autoplayMinScore || 0);
        autoplayMinScoreInput.className = "lab-number";
        autoplayMinScoreRow.appendChild(autoplayMinScoreInput);
        const neuralTrainBallsRow = create("label", "lab-inline-field");
        neuralTrainBallsRow.textContent = "Neural train balls";
        const neuralTrainBallsInput = document.createElement("input");
        neuralTrainBallsInput.type = "number";
        neuralTrainBallsInput.min = "1";
        neuralTrainBallsInput.max = "64";
        neuralTrainBallsInput.step = "1";
        neuralTrainBallsInput.value = String(state.autoplay.neuralTrainingBalls);
        neuralTrainBallsInput.className = "lab-number";
        neuralTrainBallsRow.appendChild(neuralTrainBallsInput);
        const neuralTrainSamplesRow = create("label", "lab-inline-field");
        neuralTrainSamplesRow.textContent = "Neural max samples";
        const neuralTrainSamplesInput = document.createElement("input");
        neuralTrainSamplesInput.type = "number";
        neuralTrainSamplesInput.min = "200";
        neuralTrainSamplesInput.max = "20000";
        neuralTrainSamplesInput.step = "100";
        neuralTrainSamplesInput.value = String(state.autoplay.neuralMaxSamples);
        neuralTrainSamplesInput.className = "lab-number";
        neuralTrainSamplesRow.appendChild(neuralTrainSamplesInput);
        const neuralTrainEpochRow = create("label", "lab-inline-field");
        neuralTrainEpochRow.textContent = "Neural epochs";
        const neuralTrainEpochInput = document.createElement("input");
        neuralTrainEpochInput.type = "number";
        neuralTrainEpochInput.min = "1";
        neuralTrainEpochInput.max = "24";
        neuralTrainEpochInput.step = "1";
        neuralTrainEpochInput.value = String(state.autoplay.neuralEpochs);
        neuralTrainEpochInput.className = "lab-number";
        neuralTrainEpochRow.appendChild(neuralTrainEpochInput);
        const neuralHiddenSizeRow = create("label", "lab-inline-field");
        neuralHiddenSizeRow.textContent = "Neural hidden units";
        const neuralHiddenSizeInput = document.createElement("input");
        neuralHiddenSizeInput.type = "number";
        neuralHiddenSizeInput.min = "4";
        neuralHiddenSizeInput.max = "64";
        neuralHiddenSizeInput.step = "1";
        neuralHiddenSizeInput.value = String(state.autoplay.neuralHiddenSize);
        neuralHiddenSizeInput.className = "lab-number";
        neuralHiddenSizeRow.appendChild(neuralHiddenSizeInput);
        const autoplayLiveActions = create("div", "lab-actions");
        const autoplayLiveStartButton = create("button", "", "Heuristic Live");
        const autoplayNeuralStartButton = create("button", "", "Neural Live");
        const autoplayNeuralTrainButton = create("button", "", "Train Neural");
        const autoplayCompareButton = create("button", "", "Compare Runs");
        const autoplayCollectToggleButton = create("button", "active", "Collect Live On");
        const autoplayLiveStopButton = create("button", "", "Stop Live");
        autoplayLiveActions.appendChild(autoplayLiveStartButton);
        autoplayLiveActions.appendChild(autoplayNeuralStartButton);
        autoplayLiveActions.appendChild(autoplayNeuralTrainButton);
        autoplayLiveActions.appendChild(autoplayCompareButton);
        autoplayLiveActions.appendChild(autoplayCollectToggleButton);
        autoplayLiveActions.appendChild(autoplayLiveStopButton);
        const autoplayLiveStatus = create("div", "lab-eval-summary", "Autoplay live: idle.");
        const evalSummary = create("div", "lab-eval-summary", "No report yet.");
        const evalProgress = create("div", "lab-progress");
        const evalProgressFill = create("div", "lab-progress-fill");
        evalProgress.appendChild(evalProgressFill);
        const evalChecks = create("div", "lab-eval-checks lab-scroll-list");
        evalWrap.appendChild(evalTableSelect);
        evalWrap.appendChild(evalManifestInfo);
        evalWrap.appendChild(evalActions);
        evalWrap.appendChild(evalSelectionActions);
        evalWrap.appendChild(evalSelectionSummary);
        evalWrap.appendChild(evalRunChecksList);
        evalWrap.appendChild(launchRayRow);
        evalWrap.appendChild(launchCollisionRow);
        evalWrap.appendChild(launchTickRow);
        evalWrap.appendChild(targetRayRow);
        evalWrap.appendChild(targetBounceRow);
        evalWrap.appendChild(accessibilityModeRow);
        evalWrap.appendChild(accessibilityBreadthRow);
        evalWrap.appendChild(accessibilityDepthRow);
        evalWrap.appendChild(accessibilityResolutionRow);
        evalWrap.appendChild(accessibilitySpeedRow);
        evalWrap.appendChild(accessibilityTicksRow);
        evalWrap.appendChild(accessibilityContactsRow);
        evalWrap.appendChild(autoplayBallRow);
        evalWrap.appendChild(autoplayTickRow);
        evalWrap.appendChild(autoplayTargetIntervalRow);
        evalWrap.appendChild(autoplayCellSizeRow);
        evalWrap.appendChild(autoplayMinScoreRow);
        evalWrap.appendChild(neuralTrainBallsRow);
        evalWrap.appendChild(neuralTrainSamplesRow);
        evalWrap.appendChild(neuralTrainEpochRow);
        evalWrap.appendChild(neuralHiddenSizeRow);
        evalWrap.appendChild(autoplayLiveActions);
        evalWrap.appendChild(autoplayLiveStatus);
        evalWrap.appendChild(evalSummary);
        evalWrap.appendChild(evalProgress);
        evalWrap.appendChild(evalChecks);
        evalPanel.appendChild(evalWrap);

        aiPanel.appendChild(create("h2", "", "AI-Lab"));
        aiPanel.appendChild(create("p", "small", "Visibility-first patch loop using shared contract and evaluator runtime."));
        const aiWrap = create("div", "lab-group");
        const aiProviderLabelRow = create("label", "lab-inline-field");
        aiProviderLabelRow.textContent = "Provider label";
        const aiProviderLabelInput = document.createElement("input");
        aiProviderLabelInput.type = "text";
        aiProviderLabelInput.className = "lab-number";
        aiProviderLabelInput.placeholder = "OpenAI-compatible";
        aiProviderLabelRow.appendChild(aiProviderLabelInput);
        const aiBaseUrlRow = create("label", "lab-inline-field");
        aiBaseUrlRow.textContent = "Base URL";
        const aiBaseUrlInput = document.createElement("input");
        aiBaseUrlInput.type = "text";
        aiBaseUrlInput.className = "lab-number";
        aiBaseUrlInput.placeholder = "https://api.openai.com/v1";
        aiBaseUrlRow.appendChild(aiBaseUrlInput);
        const aiModelRow = create("label", "lab-inline-field");
        aiModelRow.textContent = "Model";
        const aiModelInput = document.createElement("input");
        aiModelInput.type = "text";
        aiModelInput.className = "lab-number";
        aiModelInput.placeholder = "gpt-4.1";
        aiModelRow.appendChild(aiModelInput);
        const aiModelPickRow = create("label", "lab-inline-field");
        aiModelPickRow.textContent = "Models";
        const aiModelSelect = document.createElement("select");
        aiModelSelect.className = "lab-select";
        const aiModelDefaultOpt = document.createElement("option");
        aiModelDefaultOpt.value = "";
        aiModelDefaultOpt.textContent = "(choose discovered model)";
        aiModelSelect.appendChild(aiModelDefaultOpt);
        aiModelPickRow.appendChild(aiModelSelect);
        const aiApiKeyRow = create("label", "lab-inline-field");
        aiApiKeyRow.textContent = "API key";
        const aiApiKeyInput = document.createElement("input");
        aiApiKeyInput.type = "password";
        aiApiKeyInput.className = "lab-number";
        aiApiKeyInput.placeholder = "sk-...";
        aiApiKeyRow.appendChild(aiApiKeyInput);
        const aiProviderSettingsRow = create("div", "lab-actions");
        const aiProviderSaveBtn = create("button", "", "Save Provider");
        const aiProviderClearBtn = create("button", "", "Clear Provider");
        const aiProviderModelsBtn = create("button", "", "Load Models");
        aiProviderSettingsRow.appendChild(aiProviderSaveBtn);
        aiProviderSettingsRow.appendChild(aiProviderClearBtn);
        aiProviderSettingsRow.appendChild(aiProviderModelsBtn);
        const aiPrompt = document.createElement("textarea");
        aiPrompt.className = "lab-export";
        aiPrompt.style.minHeight = "90px";
        aiPrompt.placeholder = "Describe the patch goal.";
        const aiProviderStatus = create("div", "lab-eval-summary", "Provider status: not checked.");
        const aiStatus = create("div", "lab-eval-summary", "Idle");
        const aiProviderRow = create("div", "lab-actions");
        const aiProviderRefreshBtn = create("button", "", "Check Provider");
        aiProviderRow.appendChild(aiProviderRefreshBtn);
        const aiGuardRow = create("div", "lab-actions");
        const aiStepBtn = create("button", "", "Run Step");
        const aiAutoBtn = create("button", "", "Auto Off");
        const aiBatchBtn = create("button", "", "Batch Off");
        aiGuardRow.appendChild(aiStepBtn);
        aiGuardRow.appendChild(aiAutoBtn);
        aiGuardRow.appendChild(aiBatchBtn);
        const aiApplyRow = create("div", "lab-actions");
        const aiApplyBtn = create("button", "", "Apply Approved");
        const aiRejectBtn = create("button", "", "Reject");
        const aiCheckpointBtn = create("button", "", "Checkpoint");
        const aiRollbackBtn = create("button", "", "Rollback");
        aiApplyRow.appendChild(aiApplyBtn);
        aiApplyRow.appendChild(aiRejectBtn);
        aiApplyRow.appendChild(aiCheckpointBtn);
        aiApplyRow.appendChild(aiRollbackBtn);
        const aiMaxAttemptsRow = create("label", "lab-inline-field");
        aiMaxAttemptsRow.textContent = "Max attempts";
        const aiMaxAttemptsInput = document.createElement("input");
        aiMaxAttemptsInput.type = "number";
        aiMaxAttemptsInput.min = "1";
        aiMaxAttemptsInput.max = "60";
        aiMaxAttemptsInput.step = "1";
        aiMaxAttemptsInput.value = String(state.aiLab.maxAttempts);
        aiMaxAttemptsInput.className = "lab-number";
        aiMaxAttemptsRow.appendChild(aiMaxAttemptsInput);
        const aiFlagRow = create("div", "lab-actions");
        const aiStopFailBtn = create("button", state.aiLab.stopOnFail ? "active" : "", "Stop On Fail");
        const aiStopWarnBtn = create("button", state.aiLab.stopOnWarn ? "active" : "", "Stop On Warn");
        const aiManualApplyBtn = create("button", state.aiLab.requireManualApply ? "active" : "", "Manual Apply");
        aiFlagRow.appendChild(aiStopFailBtn);
        aiFlagRow.appendChild(aiStopWarnBtn);
        aiFlagRow.appendChild(aiManualApplyBtn);
        const aiAttempts = create("div", "lab-eval-checks lab-scroll-list");
        aiWrap.appendChild(aiProviderLabelRow);
        aiWrap.appendChild(aiBaseUrlRow);
        aiWrap.appendChild(aiModelRow);
        aiWrap.appendChild(aiModelPickRow);
        aiWrap.appendChild(aiApiKeyRow);
        aiWrap.appendChild(aiProviderSettingsRow);
        aiWrap.appendChild(create("div", "lab-eval-summary", "Warning: provider settings persist in browser localStorage on this machine."));
        aiWrap.appendChild(aiPrompt);
        aiWrap.appendChild(aiProviderStatus);
        aiWrap.appendChild(aiProviderRow);
        aiWrap.appendChild(aiStatus);
        aiWrap.appendChild(aiGuardRow);
        aiWrap.appendChild(aiApplyRow);
        aiWrap.appendChild(aiMaxAttemptsRow);
        aiWrap.appendChild(aiFlagRow);
        aiWrap.appendChild(aiAttempts);
        aiPanel.appendChild(aiWrap);

        brainPanel.appendChild(create("h2", "", "Neural Brain"));
        brainPanel.appendChild(create("p", "small", "Live view of features, activations, output probabilities, and current control source."));
        const brainWrap = create("div", "lab-group");
        const brainRunStatus = create("div", "lab-eval-summary", "Brain: waiting for autoplay data.");
        const brainArchitectureStatus = create("div", "lab-eval-summary", "Architectures: 16->8->3 | 16->12->3 | 16->16->3 | 16->24->3");
        const brainActionStatus = create("div", "lab-eval-summary", "Action: none.");
        const brainWeightStatus = create("div", "lab-eval-summary", "Weights: no model loaded.");
        const brainCanvas = document.createElement("canvas");
        brainCanvas.className = "lab-brain-canvas";
        brainCanvas.width = 760;
        brainCanvas.height = 300;
        const brainRows = create("div", "lab-brain-rows");
        const brainFeatureRows = create("div", "lab-metric-list");
        const brainHiddenRows = create("div", "lab-metric-list");
        const brainOutputRows = create("div", "lab-metric-list");
        brainRows.appendChild(brainFeatureRows);
        brainRows.appendChild(brainHiddenRows);
        brainRows.appendChild(brainOutputRows);
        brainWrap.appendChild(brainRunStatus);
        brainWrap.appendChild(brainArchitectureStatus);
        brainWrap.appendChild(brainActionStatus);
        brainWrap.appendChild(brainWeightStatus);
        brainWrap.appendChild(brainCanvas);
        brainWrap.appendChild(brainRows);
        brainPanel.appendChild(brainWrap);

        right.appendChild(create("h2", "", "AI Attempt Detail"));
        const aiDetailWrap = create("div", "lab-group");
        const aiDetail = document.createElement("textarea");
        aiDetail.className = "lab-export";
        aiDetail.style.minHeight = "170px";
        aiDetailWrap.appendChild(aiDetail);
        right.appendChild(aiDetailWrap);

        function setActiveTab(nextTab) {
            state.ui.activeTab = nextTab;
            const active = {
                tune: nextTab === "tune",
                sandbox: nextTab === "sandbox",
                eval: nextTab === "eval",
                brain: nextTab === "brain",
                ai: nextTab === "ai"
            };
            tabTune.className = active.tune ? "active" : "";
            tabSandbox.className = active.sandbox ? "active" : "";
            tabEval.className = active.eval ? "active" : "";
            tabBrain.className = active.brain ? "active" : "";
            tabAi.className = active.ai ? "active" : "";
            tunePanel.className = "lab-tab-panel" + (active.tune ? " active" : "");
            sandboxPanel.className = "lab-tab-panel" + (active.sandbox ? " active" : "");
            evalPanel.className = "lab-tab-panel" + (active.eval ? " active" : "");
            brainPanel.className = "lab-tab-panel" + (active.brain ? " active" : "");
            aiPanel.className = "lab-tab-panel" + (active.ai ? " active" : "");
        }

        tabTune.onclick = function onTuneTabClick() { setActiveTab("tune"); };
        tabSandbox.onclick = function onSandboxTabClick() { setActiveTab("sandbox"); };
        tabEval.onclick = function onEvalTabClick() { setActiveTab("eval"); };
        tabBrain.onclick = function onBrainTabClick() { setActiveTab("brain"); };
        tabAi.onclick = function onAiTabClick() {
            setActiveTab("ai");
            aiLabRefreshProviderStatus(false);
            const now = Date.now();
            if (now - state.aiLab.providerLastCheckedMs > 60000) aiLabRefreshProviderStatus(true);
        };

        function setEvalStatus(message, level) {
            evalSummary.textContent = message;
            evalSummary.className = "lab-eval-summary" + (level ? " " + level : "");
            state.runtime.dirty = true;
        }

        function setEvalCheckDetail(check) {
            if (!check) {
                evalCheckDetail.value = "";
                return;
            }
            evalCheckDetail.value = JSON.stringify({
                id: check.id || "",
                category: check.category || "",
                status: check.status || "",
                message: check.message || "",
                objects: check.objects || [],
                diagnostics: check.diagnostics || null
            }, null, 2);
        }

        function setEvalProgress(done, total) {
            const pct = total > 0 ? Math.max(0, Math.min(100, (done / total) * 100)) : 0;
            evalProgressFill.style.width = pct.toFixed(1) + "%";
            evalProgress.className = "lab-progress" + (pct > 0 && pct < 100 ? " active" : "");
            state.runtime.dirty = true;
        }

        /* What: Collect currently checked evaluator test IDs.
         * Why: Run Selected needs a stable list of requested checks.
         */
        function selectedEvalRunCheckIds() {
            return (state.eval.runChecks || []).filter(function filter(check) {
                return check && typeof check.id === "string" && !!state.eval.selectedChecks[check.id];
            }).map(function map(check) {
                return check.id;
            });
        }

        function autoplayOptionsFromEvalState() {
            return {
                autoplayBallCount: state.eval.autoplayBallCount,
                autoplayMaxTicksPerBall: state.eval.autoplayMaxTicksPerBall,
                autoplayTargetingIntervalTicks: state.eval.autoplayTargetingIntervalTicks,
                autoplayPreferUnlitTargets: state.eval.autoplayPreferUnlitTargets,
                autoplayCellSize: state.eval.autoplayCellSize,
                autoplayMinScore: state.eval.autoplayMinScore,
                autoplayAimHorizonTicks: state.eval.autoplayAimHorizonTicks,
                autoplayAimPulseTicks: state.eval.autoplayAimPulseTicks,
                autoplayAimCooldownTicks: state.eval.autoplayAimCooldownTicks,
                targetingIntervalTicks: state.eval.autoplayTargetingIntervalTicks,
                preferUnlitTargets: state.eval.autoplayPreferUnlitTargets,
                cellSize: state.eval.autoplayCellSize,
                aimHorizonTicks: state.eval.autoplayAimHorizonTicks,
                aimPulseTicks: state.eval.autoplayAimPulseTicks,
                aimCooldownTicks: state.eval.autoplayAimCooldownTicks
            };
        }

        /* What: Compute lightweight weight stats for brain visibility panel.
         * Why: show whether training changed parameters without dumping full matrices.
         */
        function summarizeNeuralWeights(model) {
            const stats = {
                count: 0,
                min: Number.POSITIVE_INFINITY,
                max: Number.NEGATIVE_INFINITY,
                absSum: 0
            };
            function record(value) {
                if (!Number.isFinite(value)) return;
                stats.count += 1;
                if (value < stats.min) stats.min = value;
                if (value > stats.max) stats.max = value;
                stats.absSum += Math.abs(value);
            }
            if (model && Array.isArray(model.w1)) model.w1.forEach(function eachRow(row) { (row || []).forEach(record); });
            if (model && Array.isArray(model.w2)) model.w2.forEach(function eachRow(row) { (row || []).forEach(record); });
            if (model && Array.isArray(model.b1)) model.b1.forEach(record);
            if (model && Array.isArray(model.b2)) model.b2.forEach(record);
            if (!stats.count) return null;
            return {
                count: stats.count,
                min: stats.min,
                max: stats.max,
                meanAbs: stats.absSum / stats.count
            };
        }

        /* What: Draw a compact, readable neural flow graph for the Brain tab.
         * Why: make current model activity auditable while autoplay runs.
         */
        function drawBrainGraph(debug, model) {
            const ctxBrain = brainCanvas.getContext("2d");
            if (!ctxBrain) return;
            const width = brainCanvas.width;
            const height = brainCanvas.height;
            ctxBrain.clearRect(0, 0, width, height);
            ctxBrain.fillStyle = "#090f1b";
            ctxBrain.fillRect(0, 0, width, height);

            const featureValues = debug && Array.isArray(debug.features) ? debug.features : [];
            const hiddenValues = debug && Array.isArray(debug.hidden) ? debug.hidden : [];
            const outputs = debug && debug.outputs ? debug.outputs : { none: 0, left: 0, right: 0 };
            const inputCount = Math.max(1, Math.min(8, featureValues.length || 8));
            const hiddenCount = Math.max(1, Math.min(8, hiddenValues.length || ((model && model.hiddenSize) || 8)));
            const outputValues = [Number(outputs.none) || 0, Number(outputs.left) || 0, Number(outputs.right) || 0];
            const outputLabels = ["none", "left", "right"];
            const xInput = 120;
            const xHidden = Math.round(width * 0.5);
            const xOutput = width - 120;
            const radius = 12;

            function yAt(index, total) {
                const pad = 36;
                if (total <= 1) return Math.round(height * 0.5);
                return Math.round(pad + index * ((height - pad * 2) / (total - 1)));
            }
            function nodeColor(value, mode) {
                const v = clamp(Number(value) || 0, mode === "hidden" ? 0 : -1, 1);
                if (mode === "hidden") {
                    const intensity = Math.round(45 + v * 180);
                    return "rgb(" + intensity + "," + Math.min(255, intensity + 24) + ",255)";
                }
                const positive = Math.max(0, v);
                const negative = Math.max(0, -v);
                return "rgb(" + Math.round(90 + positive * 120) + "," + Math.round(90 + (1 - negative) * 80) + "," + Math.round(120 + positive * 90) + ")";
            }
            function drawNode(x, y, value, mode, label) {
                ctxBrain.beginPath();
                ctxBrain.arc(x, y, radius, 0, Math.PI * 2);
                ctxBrain.fillStyle = nodeColor(value, mode);
                ctxBrain.fill();
                ctxBrain.lineWidth = 1.2;
                ctxBrain.strokeStyle = "rgba(230, 240, 255, 0.72)";
                ctxBrain.stroke();
                ctxBrain.fillStyle = "rgba(230, 240, 255, 0.95)";
                ctxBrain.font = "11px Consolas, monospace";
                ctxBrain.textAlign = "center";
                ctxBrain.fillText(label, x, y - 16);
            }
            function drawLayerLinks(fromX, fromCount, toX, toCount, tone) {
                ctxBrain.strokeStyle = tone;
                ctxBrain.lineWidth = 1;
                for (let i = 0; i < fromCount; i++) {
                    const y1 = yAt(i, fromCount);
                    for (let j = 0; j < toCount; j++) {
                        const y2 = yAt(j, toCount);
                        ctxBrain.beginPath();
                        ctxBrain.moveTo(fromX + radius, y1);
                        ctxBrain.lineTo(toX - radius, y2);
                        ctxBrain.stroke();
                    }
                }
            }

            drawLayerLinks(xInput, inputCount, xHidden, hiddenCount, "rgba(116, 155, 233, 0.18)");
            drawLayerLinks(xHidden, hiddenCount, xOutput, 3, "rgba(106, 210, 170, 0.2)");

            for (let i = 0; i < inputCount; i++) {
                const val = Number(featureValues[i]) || 0;
                drawNode(xInput, yAt(i, inputCount), val, "input", "i" + i);
            }
            for (let h = 0; h < hiddenCount; h++) {
                const val = Number(hiddenValues[h]) || 0;
                drawNode(xHidden, yAt(h, hiddenCount), val, "hidden", "h" + h);
            }
            for (let o = 0; o < 3; o++) {
                drawNode(xOutput, yAt(o, 3), outputValues[o], "hidden", outputLabels[o]);
                ctxBrain.fillStyle = "rgba(230, 240, 255, 0.9)";
                ctxBrain.font = "11px Consolas, monospace";
                ctxBrain.textAlign = "left";
                ctxBrain.fillText(String(round(outputValues[o], 3)), xOutput + 22, yAt(o, 3) + 4);
            }

            ctxBrain.fillStyle = "rgba(160, 186, 235, 0.9)";
            ctxBrain.font = "12px Consolas, monospace";
            ctxBrain.textAlign = "center";
            ctxBrain.fillText("Input Features", xInput, 18);
            ctxBrain.fillText("Hidden Activations", xHidden, 18);
            ctxBrain.fillText("Output Probabilities", xOutput, 18);
        }

        /* What: Refresh Brain tab values/diagram from current autoplay telemetry.
         * Why: user requested auditable live visuals for model activity and data.
         */
        function refreshBrainPanel() {
            const debug = state.autoplay.neuralLastDebug || null;
            const model = state.autoplay.neuralModel || null;
            const featureNames = (debug && Array.isArray(debug.featureNames) && debug.featureNames.length)
                ? debug.featureNames
                : ((Pin.tableAutoplayLearning && Array.isArray(Pin.tableAutoplayLearning.featureNames)) ? Pin.tableAutoplayLearning.featureNames : []);
            const features = debug && Array.isArray(debug.features) ? debug.features : [];
            const hidden = debug && Array.isArray(debug.hidden) ? debug.hidden : [];
            const logits = debug && Array.isArray(debug.logits) ? debug.logits : [];
            const outputs = debug && debug.outputs ? debug.outputs : null;
            const stats = summarizeNeuralWeights(model);

            brainFeatureRows.innerHTML = "";
            brainHiddenRows.innerHTML = "";
            brainOutputRows.innerHTML = "";

            const modeText = state.autoplay.liveRunning ? (state.autoplay.liveMode + " live") : "idle";
            const modelText = model ? (model.inputSize + " -> " + model.hiddenSize + " -> 3") : "untrained";
            brainRunStatus.textContent = "Brain: " + modeText + " | model " + modelText + " | samples " + (state.autoplay.neuralSampleCount || 0);
            brainRunStatus.className = "lab-eval-summary" + (model ? " pass" : "");
            brainArchitectureStatus.textContent = "Architectures: 16->8->3 | 16->12->3 | 16->16->3 | 16->24->3 | selected hidden " + state.autoplay.neuralHiddenSize;
            brainActionStatus.textContent = debug
                ? ("Action " + (debug.action || "none") + " | source " + (debug.source || "model") + " | conf " + round(debug.confidence || 0, 3))
                : "Action: waiting for neural debug telemetry.";
            brainActionStatus.className = "lab-eval-summary" + (debug ? " pass" : " warn");
            brainWeightStatus.textContent = stats
                ? ("Weights: " + stats.count + " params | min " + round(stats.min, 4) + " | max " + round(stats.max, 4) + " | mean|w| " + round(stats.meanAbs, 4))
                : "Weights: no model loaded.";
            brainWeightStatus.className = "lab-eval-summary" + (stats ? " pass" : " warn");

            for (let i = 0; i < Math.min(8, features.length || featureNames.length); i++) {
                const name = featureNames[i] || ("f" + i);
                const value = Number(features[i]);
                brainFeatureRows.appendChild(create("div", "label", name));
                brainFeatureRows.appendChild(create("div", "value", Number.isFinite(value) ? String(round(value, 4)) : "-"));
            }
            for (let h = 0; h < Math.min(8, hidden.length || (model ? model.hiddenSize : 0)); h++) {
                const value = Number(hidden[h]);
                brainHiddenRows.appendChild(create("div", "label", "hidden_" + h));
                brainHiddenRows.appendChild(create("div", "value", Number.isFinite(value) ? String(round(value, 4)) : "-"));
            }
            const outputRows = [
                { name: "none", value: outputs ? outputs.none : null },
                { name: "left", value: outputs ? outputs.left : null },
                { name: "right", value: outputs ? outputs.right : null },
                { name: "logit_none", value: logits.length > 0 ? logits[0] : null },
                { name: "logit_left", value: logits.length > 1 ? logits[1] : null },
                { name: "logit_right", value: logits.length > 2 ? logits[2] : null }
            ];
            outputRows.forEach(function each(row) {
                brainOutputRows.appendChild(create("div", "label", row.name));
                brainOutputRows.appendChild(create("div", "value", Number.isFinite(row.value) ? String(round(row.value, 4)) : "-"));
            });

            drawBrainGraph(debug, model);
            if (state.ui.activeTab === "brain") state.runtime.dirty = true;
        }

        function refreshNeuralPanel() {
            neuralMetrics.innerHTML = "";
            const debug = state.autoplay.neuralLastDebug;
            const training = state.autoplay.training || {};
            const latestSample = training.recentLiveSamples && training.recentLiveSamples.length
                ? training.recentLiveSamples[training.recentLiveSamples.length - 1]
                : null;
            const latestShotSample = training.recentShotSamples && training.recentShotSamples.length
                ? training.recentShotSamples[training.recentShotSamples.length - 1]
                : null;
            const pendingShotAttempts = training.pendingShotAttempts || [];
            const recentShotSamples = training.recentShotSamples || [];
            const shotHitMap = training.shotHitMap || {};
            const rows = [
                { label: "Mode", value: state.autoplay.liveMode || "heuristic" },
                { label: "Samples", value: state.autoplay.neuralSampleCount || 0 },
                { label: "Loss", value: state.autoplay.neuralLastLoss == null ? "-" : round(state.autoplay.neuralLastLoss, 5) },
                { label: "Collect", value: training.collecting ? "yes" : "no" },
                { label: "Collected", value: (training.rawTotal || training.total || 0) + " raw / " + (training.usedTotal || 0) + " used" },
                { label: "N/L/R", value: (training.none || 0) + "/" + (training.left || 0) + "/" + (training.right || 0) },
                { label: "Live actions", value: training.liveActionSamples || 0 },
                { label: "Rate", value: training.samplesPerSec ? round(training.samplesPerSec, 1) + "/s" : "-" },
                { label: "Action", value: debug && debug.action ? debug.action : "-" },
                { label: "None", value: debug && debug.outputs ? round(debug.outputs.none, 3) : "-" },
                { label: "Left", value: debug && debug.outputs ? round(debug.outputs.left, 3) : "-" },
                { label: "Right", value: debug && debug.outputs ? round(debug.outputs.right, 3) : "-" },
                { label: "Confidence", value: debug && typeof debug.confidence === "number" ? round(debug.confidence, 3) : "-" },
                { label: "Out L/R/Launch", value: debug && debug.controls ? (Number(!!debug.controls.left) + "/" + Number(!!debug.controls.right) + "/" + Number(!!debug.controls.launch)) : "-" },
                { label: "Pulse L/R", value: debug ? ((debug.pulseLeft || 0) + "/" + (debug.pulseRight || 0)) : "-" },
                { label: "Cooldown", value: debug && Number.isFinite(debug.cooldown) ? debug.cooldown : "-" },
                { label: "Source", value: debug && debug.source ? debug.source : "-" },
                { label: "Model", value: debug && debug.model ? (debug.model.inputSize + " -> " + debug.model.hiddenSize + " -> 3") : "-" },
                { label: "Last sample", value: latestSample ? (latestSample.action + " bx " + round(latestSample.ballX, 3) + " by " + round(latestSample.ballY, 3) + " vy " + round(latestSample.vy, 3)) : "-" },
                { label: "Shot samples", value: (training.shotSamples && training.shotSamples.length) || 0 },
                { label: "Shot targets", value: training.shotHitMap ? Object.keys(training.shotHitMap).length : 0 },
                { label: "Shot L/R", value: (training.shotLeft || 0) + "/" + (training.shotRight || 0) },
                { label: "Success used", value: training.successSampleCount || 0 },
                { label: "Pending shots", value: pendingShotAttempts.length || 0 },
                { label: "Last shot", value: latestShotSample ? (latestShotSample.side + " -> " + latestShotSample.targetId + " @+" + latestShotSample.ticksAfterFlip) : "-" }
            ];
            rows.forEach(function each(row) {
                const key = create("div", "label", row.label);
                const val = create("div", "value", String(row.value));
                neuralMetrics.appendChild(key);
                neuralMetrics.appendChild(val);
            });
            const trained = !!state.autoplay.neuralModel;
            neuralStatus.textContent = trained
                ? "Neural policy ready. " + (state.autoplay.liveMode === "neural" ? "Live control active." : "Heuristic mode active.")
                : "Neural policy: untrained.";
            neuralStatus.className = "lab-eval-summary" + (trained ? " pass" : "");
            neuralTrainingStatus.textContent = training.collecting
                ? "Training data: collecting (" + (training.total || 0) + " samples)."
                : ("Training data: idle. live buffer " + ((training.liveSamples && training.liveSamples.length) || 0) + ".");
            neuralTrainingStatus.className = "lab-eval-summary" + (training.collecting ? " warn" : "");
            const recentShotText = recentShotSamples.slice(-5).map(function map(sample) {
                if (!sample) return "";
                return (sample.side || "?") + " -> " + (sample.targetId || "?") + " @+" + (sample.ticksAfterFlip || 0) + "t";
            }).filter(Boolean).join(" | ");
            neuralShotDetailStatus.textContent = recentShotSamples.length
                ? ("Recent shots (" + recentShotSamples.length + " kept): " + recentShotText)
                : "Recent shots: none yet.";
            neuralShotDetailStatus.className = "lab-eval-summary" + (recentShotSamples.length ? " pass" : "");
            const topHits = Object.keys(shotHitMap).map(function map(key) {
                return { key: key, count: shotHitMap[key] || 0 };
            }).sort(function sort(a, b) { return b.count - a.count; }).slice(0, 6);
            neuralHitMapStatus.textContent = topHits.length
                ? ("Target hit map: " + topHits.map(function map(entry) { return entry.key + ":" + entry.count; }).join(" | "))
                : "Target hit map: none yet.";
            neuralHitMapStatus.className = "lab-eval-summary" + (topHits.length ? " pass" : "");
            autoplayNeuralStartButton.disabled = !trained || state.eval.running || (state.autoplay.liveRunning && state.autoplay.liveMode === "neural");
            autoplayLiveStartButton.disabled = state.eval.running || (state.autoplay.liveRunning && state.autoplay.liveMode === "heuristic");
            autoplayCompareButton.disabled = !trained || state.eval.running;
            autoplayLiveStartButton.className = state.autoplay.liveMode === "heuristic" && state.autoplay.liveRunning ? "active" : "";
            autoplayNeuralStartButton.className = state.autoplay.liveMode === "neural" && state.autoplay.liveRunning ? "active" : "";
            refreshBrainPanel();
            state.runtime.dirty = true;
        }

        function pickTrainingActionFromControls(controls) {
            if (controls && controls.left && !controls.right) return "left";
            if (controls && controls.right && !controls.left) return "right";
            return "none";
        }

        function shotSourceTypeSet() {
            return {
                lane: true,
                dropTarget: true,
                trough: true,
                kicker: true,
                spinner: true,
                scoreZone: true,
                bumper: true
            };
        }

        function shotTargetLookup(table) {
            const out = {};
            const allowed = shotSourceTypeSet();
            const elements = table && Array.isArray(table.elements) ? table.elements : [];
            elements.forEach(function each(el) {
                if (!el || !el.id || !allowed[el.type]) return;
                out[String(el.id)] = {
                    id: String(el.id),
                    type: String(el.type || "")
                };
            });
            return out;
        }

        function recordShotAttempt(world, controls, target) {
            const training = state.autoplay.training;
            const prev = training.prevAutoControls || { left: false, right: false };
            const ball = world && world.balls && world.balls[0] ? world.balls[0] : null;
            if (!ball || !Pin.tableAutoplayLearning || typeof Pin.tableAutoplayLearning.extractFeatures !== "function") {
                training.prevAutoControls = { left: !!controls.left, right: !!controls.right };
                return;
            }
            const features = Pin.tableAutoplayLearning.extractFeatures(world, { target: target || null });
            const nowTick = Number(world.physicsTick) || 0;
            function appendAttempt(side) {
                training.pendingShotAttempts.push({
                    tick: nowTick,
                    side: side,
                    targetId: target && target.id ? String(target.id) : "",
                    targetType: target && target.type ? String(target.type) : "",
                    ballX: Number(ball.x) || 0,
                    ballY: Number(ball.y) || 0,
                    ballVx: Number(ball.vx) || 0,
                    ballVy: Number(ball.vy) || 0,
                    features: Array.isArray(features) ? features.slice(0) : []
                });
            }
            if (!!controls.left && !prev.left) appendAttempt("left");
            if (!!controls.right && !prev.right) appendAttempt("right");
            training.prevAutoControls = { left: !!controls.left, right: !!controls.right };
            const maxPending = 512;
            if (training.pendingShotAttempts.length > maxPending) {
                training.pendingShotAttempts.splice(0, training.pendingShotAttempts.length - maxPending);
            }
        }

        function attributeShotOutcomes(world, processedEvents) {
            const training = state.autoplay.training;
            const events = Array.isArray(processedEvents) ? processedEvents : [];
            if (!events.length) return;
            if (!training.shotTargetLookup) {
                training.shotTargetLookup = shotTargetLookup(world && world.table ? world.table : null);
            }
            const nowTick = Number(world.physicsTick) || 0;
            const minTicks = 12;
            const maxTicks = 180;
            training.pendingShotAttempts = (training.pendingShotAttempts || []).filter(function keep(attempt) {
                if (!attempt || !Number.isFinite(attempt.tick)) return false;
                return (nowTick - attempt.tick) <= maxTicks;
            });
            events.forEach(function each(event) {
                if (!event || event.type !== "switchClosed" || !event.sourceId) return;
                const sourceId = String(event.sourceId);
                const targetMeta = training.shotTargetLookup[sourceId];
                if (!targetMeta) return;
                let best = null;
                for (let i = training.pendingShotAttempts.length - 1; i >= 0; i--) {
                    const attempt = training.pendingShotAttempts[i];
                    const dt = nowTick - (attempt.tick || 0);
                    if (dt < minTicks || dt > maxTicks) continue;
                    best = attempt;
                    break;
                }
                if (!best) return;
                const sample = {
                    tick: nowTick,
                    side: best.side,
                    targetId: sourceId,
                    targetType: targetMeta.type || "",
                    intendedTargetId: best.targetId || "",
                    ticksAfterFlip: nowTick - (best.tick || 0),
                    secondsAfterFlip: (world.lastPhysicsDt || (1 / 120)) * (nowTick - (best.tick || 0)),
                    ballX: best.ballX,
                    ballY: best.ballY,
                    ballVx: best.ballVx,
                    ballVy: best.ballVy,
                    features: Array.isArray(best.features) ? best.features.slice(0) : []
                };
                training.shotSamples.push(sample);
                training.recentShotSamples.push(sample);
                training.shotHitMap[sourceId] = (training.shotHitMap[sourceId] || 0) + 1;
                if (training.recentShotSamples.length > 24) training.recentShotSamples.shift();
                if (training.shotSamples.length > 5000) training.shotSamples.splice(0, training.shotSamples.length - 5000);
            });
        }

        function rebalanceTrainingSamples(samples) {
            const all = Array.isArray(samples) ? samples.slice(0) : [];
            const left = all.filter(function filter(sample) { return sample && sample.action === "left"; });
            const right = all.filter(function filter(sample) { return sample && sample.action === "right"; });
            const none = all.filter(function filter(sample) { return sample && sample.action === "none"; });
            const flipTotal = left.length + right.length;
            if (!all.length || !flipTotal) return all;
            const maxNone = Math.max(120, flipTotal);
            const trimmedNone = none.slice(0, maxNone);
            const minority = Math.max(1, Math.min(left.length, right.length));
            const targetPerSide = Math.max(minority, Math.floor((left.length + right.length) / 2));
            const leftBalanced = [];
            const rightBalanced = [];
            for (let i = 0; i < targetPerSide; i++) {
                leftBalanced.push(left[i % left.length]);
                rightBalanced.push(right[i % right.length]);
            }
            return leftBalanced.concat(rightBalanced, trimmedNone);
        }

        function shotOutcomeSamplesToActionSamples(shotSamples) {
            const out = [];
            const shots = Array.isArray(shotSamples) ? shotSamples : [];
            shots.forEach(function each(sample) {
                if (!sample || !Array.isArray(sample.features)) return;
                const side = sample.side === "left" ? "left" : (sample.side === "right" ? "right" : "");
                if (!side) return;
                const ticks = Number(sample.ticksAfterFlip) || 0;
                // Favor cleaner, shorter-latency outcomes without exploding sample count.
                let weight = 1;
                if (ticks >= 12 && ticks <= 60) weight = 4;
                else if (ticks <= 100) weight = 3;
                else if (ticks <= 160) weight = 2;
                for (let i = 0; i < weight; i++) {
                    out.push({
                        features: sample.features.slice(0),
                        action: side
                    });
                }
            });
            return out;
        }

        function collectAutoplayTrainingSamples() {
            if (!Pin.tableAutoplayLearning || typeof Pin.tableAutoplayLearning.extractFeatures !== "function") return [];
            if (!Pin.tableAutoplay || typeof Pin.tableAutoplay.createController !== "function") return [];
            const maxSamples = clamp(Math.round(Number(state.autoplay.neuralMaxSamples) || 3000), 200, 20000);
            const trainingBalls = clamp(Math.round(Number(state.autoplay.neuralTrainingBalls) || 10), 1, 64);
            const maxTicks = clamp(Math.round(Number(state.eval.autoplayMaxTicksPerBall) || 12000), 120, 120000);
            const sandboxOptions = {
                includeDefaultBounds: includeDefaultSandboxBounds(),
                baseTable: state.sandbox.baseTable ? clone(state.sandbox.baseTable) : null,
                playfield: clone(state.sandbox.playfield),
                physics: clone(state.sandbox.physics),
                elements: clone(state.sandbox.elements),
                spawn: clone(state.sandbox.spawn)
            };
            const sim = Pin.physicsHarness.createSimulation("sandbox", { sandbox: sandboxOptions });
            const controller = Pin.tableAutoplay.createController(sim.world, autoplayOptionsFromEvalState());
            const samples = [];
            state.autoplay.training.collecting = true;
            state.autoplay.training.total = 0;
            state.autoplay.training.rawTotal = 0;
            state.autoplay.training.usedTotal = 0;
            state.autoplay.training.none = 0;
            state.autoplay.training.left = 0;
            state.autoplay.training.right = 0;
            state.autoplay.training.shotLeft = 0;
            state.autoplay.training.shotRight = 0;
            state.autoplay.training.successSampleCount = 0;
            state.autoplay.training.liveActionSamples = 0;
            state.autoplay.training.recentLiveSamples = [];
            state.autoplay.training.startedAt = Date.now();
            state.autoplay.training.samplesPerSec = 0;
            refreshNeuralPanel();
            let launchHeldPrev = false;
            let served = 0;
            let wasInLane = true;
            for (let tick = 0; tick < maxTicks * trainingBalls && samples.length < maxSamples; tick++) {
                const controls = controller.update();
                const target = controller.getTarget && typeof controller.getTarget === "function" ? controller.getTarget() : null;
                const features = Pin.tableAutoplayLearning.extractFeatures(sim.world, { target: target });
                const action = pickTrainingActionFromControls(controls);
                samples.push({ features: features, action: action });
                state.autoplay.training.total += 1;
                state.autoplay.training.rawTotal += 1;
                if (action === "left") state.autoplay.training.left += 1;
                else if (action === "right") state.autoplay.training.right += 1;
                else state.autoplay.training.none += 1;
                if (state.autoplay.training.total % 120 === 0) {
                    const elapsedMs = Math.max(1, Date.now() - state.autoplay.training.startedAt);
                    state.autoplay.training.samplesPerSec = (state.autoplay.training.total * 1000) / elapsedMs;
                    refreshNeuralPanel();
                }
                sim.world.controls.left = !!controls.left;
                sim.world.controls.right = !!controls.right;
                sim.world.launchCharging = !!controls.launch;
                if (launchHeldPrev && !controls.launch && Pin.physics && Pin.physics.releaseLauncher) Pin.physics.releaseLauncher(sim.world);
                launchHeldPrev = !!controls.launch;
                sim.step(1);
                const ball = sim.world.balls && sim.world.balls[0] ? sim.world.balls[0] : null;
                const inLane = ball ? !!ball.inLaunchLane : false;
                if (!inLane && wasInLane) served += 1;
                wasInLane = inLane;
                if (served >= trainingBalls) break;
            }
            state.autoplay.training.collecting = false;
            const elapsedMs = Math.max(1, Date.now() - state.autoplay.training.startedAt);
            state.autoplay.training.samplesPerSec = (state.autoplay.training.total * 1000) / elapsedMs;
            const balanced = rebalanceTrainingSamples(samples);
            state.autoplay.training.usedTotal = balanced.length;
            refreshNeuralPanel();
            return balanced;
        }

        function trainNeuralAutoplay() {
            if (!Pin.tableAutoplayLearning || typeof Pin.tableAutoplayLearning.createModel !== "function") {
                autoplayLiveStatus.textContent = "Neural training: runtime unavailable.";
                return;
            }
            let samples = [];
            if (state.autoplay.training.liveSamples && state.autoplay.training.liveSamples.length >= 120) {
                const maxSamples = clamp(Math.round(Number(state.autoplay.neuralMaxSamples) || 3000), 200, 20000);
                const live = state.autoplay.training.liveSamples.slice(-maxSamples);
                const liveFlip = live.filter(function filter(sample) { return sample.action !== "none"; });
                samples = rebalanceTrainingSamples(live);
                state.autoplay.training.rawTotal = live.length;
                state.autoplay.training.usedTotal = samples.length;
                state.autoplay.training.liveActionSamples = liveFlip.length;
            } else {
                samples = collectAutoplayTrainingSamples();
            }
            const shotSamplesRaw = (state.autoplay.training.shotSamples || []).slice(-5000);
            const shotActionSamples = shotOutcomeSamplesToActionSamples(shotSamplesRaw);
            state.autoplay.training.successSampleCount = shotActionSamples.length;
            state.autoplay.training.shotLeft = shotSamplesRaw.filter(function filter(sample) { return sample && sample.side === "left"; }).length;
            state.autoplay.training.shotRight = shotSamplesRaw.filter(function filter(sample) { return sample && sample.side === "right"; }).length;
            if (shotActionSamples.length) {
                samples = samples.concat(shotActionSamples);
                samples = rebalanceTrainingSamples(samples);
            }
            if (!samples.length) {
                autoplayLiveStatus.textContent = "Neural training: no samples collected.";
                return;
            }
            const model = Pin.tableAutoplayLearning.createModel(
                samples[0].features.length,
                clamp(Math.round(Number(state.autoplay.neuralHiddenSize) || 12), 4, 64)
            );
            const result = Pin.tableAutoplayLearning.trainModel(model, samples, {
                epochs: clamp(Math.round(Number(state.autoplay.neuralEpochs) || 4), 1, 24),
                learningRate: 0.05
            });
            const noneCount = samples.filter(function filter(sample) { return sample.action === "none"; }).length;
            const leftCount = samples.filter(function filter(sample) { return sample.action === "left"; }).length;
            const rightCount = samples.filter(function filter(sample) { return sample.action === "right"; }).length;
            state.autoplay.neuralModel = model;
            state.autoplay.neuralLastLoss = result.finalLoss;
            state.autoplay.neuralSampleCount = result.samples;
            saveNeuralModel();
            autoplayLiveStatus.textContent =
                "Neural training complete. raw " + (state.autoplay.training.rawTotal || result.samples) +
                " + success " + (state.autoplay.training.successSampleCount || 0) +
                " -> used " + result.samples + " (N/L/R " + noneCount + "/" + leftCount + "/" + rightCount + ") | loss " + round(result.finalLoss, 5);
            refreshNeuralPanel();
        }

        function compareControllerStats(mode) {
            if (!state.eval.selectedTable) return { score: 0, hits: 0, balls: 0 };
            const balls = clamp(Math.round(Number(state.autoplay.neuralTrainingBalls) || 10), 1, 64);
            const maxTicks = clamp(Math.round(Number(state.eval.autoplayMaxTicksPerBall) || 12000), 120, 120000);
            const sandboxOptions = {
                includeDefaultBounds: includeDefaultSandboxBounds(),
                baseTable: state.sandbox.baseTable ? clone(state.sandbox.baseTable) : null,
                playfield: clone(state.sandbox.playfield),
                physics: clone(state.sandbox.physics),
                elements: clone(state.sandbox.elements),
                spawn: clone(state.sandbox.spawn)
            };
            const sim = Pin.physicsHarness.createSimulation("sandbox", { sandbox: sandboxOptions });
            const controller = mode === "neural"
                ? Pin.tableAutoplayLearning.createController(sim.world, {
                    model: state.autoplay.neuralModel,
                    pulseTicks: state.eval.autoplayAimPulseTicks,
                    cooldownTicks: state.eval.autoplayAimCooldownTicks
                })
                : Pin.tableAutoplay.createController(sim.world, autoplayOptionsFromEvalState());
            const sources = (sim.world.table && sim.world.table.elements ? sim.world.table.elements : []).filter(function filter(el) {
                return el && (el.type === "lane" || el.type === "dropTarget" || el.type === "trough" || el.type === "kicker" || el.type === "spinner" || el.type === "scoreZone");
            });
            let launchHeldPrev = false;
            let score = 0;
            let hits = 0;
            let served = 0;
            let wasInLane = true;
            const hitCooldown = Object.create(null);
            for (let tick = 0; tick < maxTicks * balls; tick++) {
                const controls = controller.update();
                sim.world.controls.left = !!controls.left;
                sim.world.controls.right = !!controls.right;
                sim.world.launchCharging = !!controls.launch;
                if (launchHeldPrev && !controls.launch && Pin.physics && Pin.physics.releaseLauncher) Pin.physics.releaseLauncher(sim.world);
                launchHeldPrev = !!controls.launch;
                sim.step(1);
                score = Number(sim.world.score) || 0;
                const ball = sim.world.balls && sim.world.balls[0] ? sim.world.balls[0] : null;
                if (ball) {
                    sources.forEach(function each(el) {
                        if (!Number.isFinite(el.x) || !Number.isFinite(el.y)) return;
                        const dx = ball.x - el.x;
                        const dy = ball.y - el.y;
                        const d2 = dx * dx + dy * dy;
                        const key = String(el.id || "");
                        hitCooldown[key] = Math.max(0, (hitCooldown[key] || 0) - 1);
                        if (d2 <= (18 * 18) && hitCooldown[key] === 0) {
                            hits += 1;
                            hitCooldown[key] = 8;
                        }
                    });
                    const inLane = !!ball.inLaunchLane;
                    if (!inLane && wasInLane) served += 1;
                    wasInLane = inLane;
                }
                if (served >= balls) break;
            }
            return { score: score, hits: hits, balls: served || balls };
        }

        function runAutoplayCompare() {
            if (!state.eval.selectedTable) {
                autoplayLiveStatus.textContent = "Compare: load a table first.";
                return;
            }
            if (!state.autoplay.neuralModel) {
                autoplayLiveStatus.textContent = "Compare: train neural model first.";
                return;
            }
            const heuristic = compareControllerStats("heuristic");
            const neural = compareControllerStats("neural");
            const deltaScore = neural.score - heuristic.score;
            const deltaHits = neural.hits - heuristic.hits;
            autoplayLiveStatus.textContent =
                "Compare " + neural.balls + " balls | score H " + heuristic.score + " vs N " + neural.score + " (" + (deltaScore >= 0 ? "+" : "") + deltaScore + ")" +
                " | hits H " + heuristic.hits + " vs N " + neural.hits + " (" + (deltaHits >= 0 ? "+" : "") + deltaHits + ")";
            state.autoplay.neuralLastDebug = {
                action: "compare",
                confidence: 1,
                outputs: { none: 0, left: 0, right: 0 }
            };
            refreshNeuralPanel();
        }

        function createLiveAutoplayHeatmap() {
            const table = state.sim && state.sim.world ? state.sim.world.table : null;
            const playfield = table && table.playfield ? table.playfield : {};
            const width = Number.isFinite(playfield.width) && playfield.width > 0 ? playfield.width : 500;
            const height = Number.isFinite(playfield.height) && playfield.height > 0 ? playfield.height : 880;
            const cellSize = clamp(Math.round(Number(state.eval.autoplayCellSize) || 24), 8, 128);
            const cols = Math.max(1, Math.ceil(width / cellSize));
            const rows = Math.max(1, Math.ceil(height / cellSize));
            return {
                cols: cols,
                rows: rows,
                cellSize: cellSize,
                values: new Array(cols * rows).fill(0),
                max: 0
            };
        }

        function stampLiveAutoplayHeatmap(ball) {
            const heat = state.autoplay.liveHeatmap;
            if (!heat || !ball || !Number.isFinite(ball.x) || !Number.isFinite(ball.y)) return;
            const col = Math.max(0, Math.min(heat.cols - 1, Math.floor(ball.x / heat.cellSize)));
            const row = Math.max(0, Math.min(heat.rows - 1, Math.floor(ball.y / heat.cellSize)));
            const index = row * heat.cols + col;
            const next = (heat.values[index] || 0) + 1;
            heat.values[index] = next;
            if (next > heat.max) heat.max = next;
        }

        function stopLiveAutoplay() {
            state.autoplay.liveRunning = false;
            state.autoplay.liveController = null;
            state.autoplay.liveMode = "heuristic";
            state.autoplay.liveHeatmap = null;
            state.autoplay.livePath = [];
            state.autoplay.liveTrajectories = [];
            state.autoplay.liveServeIndex = 0;
            state.autoplay.liveWasInLaunchLane = true;
            state.autoplay.liveSampleCounter = 0;
            state.autoplay.training.pendingShotAttempts = [];
            state.autoplay.training.prevAutoControls = { left: false, right: false };
            state.eval.liveCheck = null;
            autoplayLiveStatus.textContent = "Autoplay live: stopped.";
            autoplayLiveStartButton.disabled = false;
            autoplayLiveStartButton.className = "";
            autoplayNeuralStartButton.className = "";
            autoplayNeuralStartButton.disabled = !state.autoplay.neuralModel;
            autoplayLiveStopButton.disabled = true;
            state.sandbox.controls.left = false;
            state.sandbox.controls.right = false;
            state.sandbox.controls.launch = false;
            state.runtime.dirty = true;
            refreshNeuralPanel();
        }

        function startLiveAutoplay(mode) {
            if (!state.eval.selectedTable) {
                autoplayLiveStatus.textContent = "Autoplay live: load a table first.";
                return;
            }
            if (state.scenarioId !== "sandbox" || !state.sim || !state.sim.world) {
                autoplayLiveStatus.textContent = "Autoplay live: switch to Sandbox first (no auto-switch).";
                return;
            }
            const nextMode = mode === "neural" ? "neural" : "heuristic";
            if (!Pin.tableAutoplay || typeof Pin.tableAutoplay.createController !== "function") {
                autoplayLiveStatus.textContent = "Autoplay live: runtime unavailable.";
                return;
            }
            if (nextMode === "neural") {
                if (!Pin.tableAutoplayLearning || typeof Pin.tableAutoplayLearning.createController !== "function") {
                    autoplayLiveStatus.textContent = "Neural live: runtime unavailable.";
                    return;
                }
                if (!state.autoplay.neuralModel) {
                    autoplayLiveStatus.textContent = "Neural live: train the model first.";
                    return;
                }
            }

            function buildLiveController() {
                if (nextMode === "neural") {
                    const fallbackController = Pin.tableAutoplay.createController(state.sim.world, autoplayOptionsFromEvalState());
                    return Pin.tableAutoplayLearning.createController(state.sim.world, {
                        model: state.autoplay.neuralModel,
                        pulseTicks: state.eval.autoplayAimPulseTicks,
                        cooldownTicks: state.eval.autoplayAimCooldownTicks,
                        minConfidence: 0.54,
                        minActionProbability: 0.22,
                        indecisiveGap: 0.1,
                        fallbackController: fallbackController,
                        targetProvider: function targetProvider() {
                            return fallbackController && typeof fallbackController.getTarget === "function"
                                ? fallbackController.getTarget()
                                : null;
                        }
                    });
                }
                return Pin.tableAutoplay.createController(state.sim.world, autoplayOptionsFromEvalState());
            }

            if (state.autoplay.liveRunning) {
                if (state.sim && state.sim.world) {
                    if (state.sandbox.launchHeldPrev && Pin.physics && Pin.physics.releaseLauncher) {
                        Pin.physics.releaseLauncher(state.sim.world);
                    }
                    state.sandbox.launchHeldPrev = false;
                    state.sandbox.controls.launch = false;
                    state.sim.world.launchCharging = false;
                }
                state.autoplay.liveController = buildLiveController();
                state.autoplay.liveMode = nextMode;
                autoplayLiveStatus.textContent = (nextMode === "neural" ? "Neural" : "Heuristic") + " live: controller switched.";
                autoplayLiveStartButton.className = nextMode === "heuristic" ? "active" : "";
                autoplayNeuralStartButton.className = nextMode === "neural" ? "active" : "";
                refreshNeuralPanel();
                return;
            }
            state.autoplay.liveController = buildLiveController();
            state.autoplay.liveRunning = true;
            state.autoplay.liveMode = nextMode;
            state.autoplay.liveHeatmap = createLiveAutoplayHeatmap();
            state.autoplay.livePath = [];
            state.autoplay.liveTrajectories = [];
            state.autoplay.liveServeIndex = 0;
            state.autoplay.liveWasInLaunchLane = true;
            state.autoplay.liveSampleCounter = 0;
            state.autoplay.training.pendingShotAttempts = [];
            state.autoplay.training.prevAutoControls = { left: false, right: false };
            autoplayLiveStatus.textContent = (nextMode === "neural" ? "Neural" : "Heuristic") + " live: running.";
            autoplayLiveStartButton.disabled = nextMode === "heuristic";
            autoplayNeuralStartButton.disabled = nextMode === "neural";
            autoplayLiveStartButton.className = nextMode === "heuristic" ? "active" : "";
            autoplayNeuralStartButton.className = nextMode === "neural" ? "active" : "";
            autoplayLiveStopButton.disabled = false;
            state.runtime.dirty = true;
            refreshNeuralPanel();
        }

        /* What: Keep eval-run controls consistent with selection/run state.
         * Why: disabling invalid actions avoids confusing no-op runs.
         */
        function updateEvalRunSelectionSummary() {
            const selectedCount = selectedEvalRunCheckIds().length;
            const totalCount = (state.eval.runChecks || []).length;
            evalSelectionSummary.textContent = "Selected checks: " + selectedCount + " / " + totalCount;
            runSelectedEvalButton.disabled = state.eval.running || selectedCount === 0;
            runAllEvalButton.disabled = state.eval.running;
            loadTableButton.disabled = state.eval.running;
            evalSelectAllButton.disabled = state.eval.running;
            evalClearAllButton.disabled = state.eval.running;
        }

        /* What: Render the eval checklist with one checkbox per test group.
         * Why: operators need direct control over individual vs batch runs.
         */
        function renderEvalRunChecksList() {
            evalRunChecksList.innerHTML = "";
            const checks = state.eval.runChecks || [];
            if (!checks.length) {
                evalRunChecksList.appendChild(create("div", "small", "No selectable checks were reported by evaluator."));
                updateEvalRunSelectionSummary();
                state.runtime.dirty = true;
                return;
            }
            checks.forEach(function each(check) {
                if (!check || typeof check.id !== "string") return;
                const row = create("label", "lab-eval-run-check");
                const box = document.createElement("input");
                box.type = "checkbox";
                box.checked = !!state.eval.selectedChecks[check.id];
                box.disabled = state.eval.running;
                box.onchange = function onEvalRunCheckChange() {
                    state.eval.selectedChecks[check.id] = !!box.checked;
                    updateEvalRunSelectionSummary();
                };
                const text = create("span", "", check.label || check.id);
                row.appendChild(box);
                row.appendChild(text);
                evalRunChecksList.appendChild(row);
            });
            updateEvalRunSelectionSummary();
            state.runtime.dirty = true;
        }

        /* What: Map a rendered report row back to evaluator check groups.
         * Why: row-level reruns need deterministic routing to the underlying
         * test family that produced the selected check result.
         */
        function evalCheckGroupsForCheck(check) {
            if (!check || typeof check.id !== "string") return [];
            const id = check.id;
            if (id === "table_object" || id === "validate_table" || id.indexOf("schema_issue_") === 0) return ["table_validation"];
            if (id === "playability_issues" || id.indexOf("playability_issue_") === 0) return ["playability_validation"];
            if (id === "element_ids_present" || id === "element_ids_unique" || id === "known_element_types" || id.indexOf("missing_type_") === 0) {
                return ["ids_and_types"];
            }
            if (
                id === "playfield_dimensions" ||
                id.indexOf("finite_") === 0 ||
                id.indexOf("anchor_finite_") === 0 ||
                id.indexOf("drain_size_") === 0 ||
                id.indexOf("launcher_shape_") === 0
            ) {
                return ["numeric_fields"];
            }
            if (id === "elements_near_playfield") return ["bounds"];
            if (
                id === "compile_runtime" ||
                id === "spawn_ball" ||
                id === "physics_numeric_stability" ||
                id === "physics_motion" ||
                id === "world_bounds" ||
                id === "drain_observed"
            ) {
                return ["compilation"];
            }
            if (id === "stuck_launcher_ray" || id === "launcher_velocity_spread") return ["launcher_rays"];
            if (id === "reachability_flipper_rays") return ["flipper_reachability"];
            if (id === "reachability_target_to_flipper") return ["target_to_flipper_reachability"];
            if (id === "autoplay_heatmap") return ["autoplay_heatmap"];
            if (id === "reachability_todo") return ["reachability_todo"];
            return [];
        }

        function renderEvalReport(report) {
            if (!report) {
                setEvalStatus("No report yet.");
                setEvalProgress(0, 0);
                evalChecks.innerHTML = "";
                evalReport.value = "";
                setEvalCheckDetail(null);
                state.eval.selectedCheckIndex = -1;
                updateEvalRunSelectionSummary();
                state.runtime.dirty = true;
                return;
            }
            const topClass = report.overall === "fail" ? "fail" : (report.overall === "warn" ? "warn" : "pass");
            setEvalStatus(
                statusText(report.overall) + " | pass " + report.summary.passed + " | warn " + report.summary.warnings + " | fail " + report.summary.failed,
                topClass
            );
            evalChecks.innerHTML = "";
            const grouped = groupChecksByCategory(report.checks);
            Object.keys(grouped).sort().forEach(function each(category) {
                const categoryTitle = create("h3", "", category);
                evalChecks.appendChild(categoryTitle);
                grouped[category].forEach(function eachCheck(check) {
                    const checkIndex = report.checks.indexOf(check);
                    const row = create("div", "lab-eval-check " + check.status);
                    row.tabIndex = 0;
                    if (state.eval.selectedCheckIndex === checkIndex) row.className += " selected";
                    const titleRow = create("div", "lab-eval-check-head");
                    titleRow.appendChild(create("strong", "", "[" + statusText(check.status) + "] " + check.id));
                    const runThisButton = create("button", "lab-eval-run-one", "Run This");
                    runThisButton.disabled = state.eval.running;
                    runThisButton.onclick = function onRunThisClick(event) {
                        event.preventDefault();
                        event.stopPropagation();
                        const groups = evalCheckGroupsForCheck(check);
                        if (!groups.length) {
                            setEvalStatus("No direct rerun mapping for check '" + check.id + "'. Use Run Selected/Run All.", "warn");
                            return;
                        }
                        runTableEvaluation(groups, "check " + check.id);
                    };
                    titleRow.appendChild(runThisButton);
                    row.appendChild(titleRow);
                    row.appendChild(create("div", "small", check.message || ""));
                    if (check.objects && check.objects.length) {
                        row.appendChild(create("div", "small", "Objects: " + check.objects.join(", ")));
                    }
                    row.onclick = function selectCheck() {
                        state.eval.selectedCheckIndex = checkIndex;
                        renderEvalReport(report);
                        render();
                    };
                    row.onkeydown = function onCheckKeyDown(event) {
                        if (event.key === "Enter" || event.key === " ") {
                            event.preventDefault();
                            state.eval.selectedCheckIndex = checkIndex;
                            renderEvalReport(report);
                            render();
                        }
                    };
                    evalChecks.appendChild(row);
                });
            });
            setEvalCheckDetail(state.eval.selectedCheckIndex >= 0 ? report.checks[state.eval.selectedCheckIndex] : null);
            evalReport.value = JSON.stringify(report, null, 2);
            updateEvalRunSelectionSummary();
            state.runtime.dirty = true;
        }

        function tableRefEntries() {
            if (!Pin.tableCatalog || !Array.isArray(Pin.tableCatalog.tables)) return [];
            const seen = Object.create(null);
            return Pin.tableCatalog.tables
                .map(function map(entry) { return entry && entry.ref ? normalizeTableRef(entry.ref) : ""; })
                .filter(function keep(ref) {
                    if (!ref) return false;
                    if (!/\.json$/i.test(ref)) return false;
                    const key = ref.toLowerCase();
                    if (seen[key]) return false;
                    seen[key] = true;
                    return true;
                })
                .sort(function sortRefs(a, b) {
                    return a.localeCompare(b, undefined, { sensitivity: "base" });
                });
        }

        function normalizeTableRef(rawRef) {
            if (!rawRef) return "";
            let ref = String(rawRef).trim();
            if (!/^[a-z][a-z0-9+.-]*:/i.test(ref) && ref[0] !== "/" && ref.indexOf("/") < 0) {
                ref = "tables/" + ref;
            }
            if (!/\.[a-z0-9]+$/i.test(ref)) ref += ".json";
            return ref;
        }

        function neuralModelStorageKey() {
            const tableRef = state.eval.selectedRef || state.eval.selectedName || "sandbox";
            return "pin.autoplay.neural." + String(tableRef).toLowerCase();
        }

        function saveNeuralModel() {
            if (!state.autoplay.neuralModel || !window.localStorage) return;
            try {
                window.localStorage.setItem(neuralModelStorageKey(), JSON.stringify({
                    model: state.autoplay.neuralModel,
                    trainedAt: Date.now()
                }));
            } catch (err) {
                console.warn("Neural model save failed:", err);
            }
        }

        function loadNeuralModel() {
            state.autoplay.neuralModel = null;
            state.autoplay.neuralLastLoss = null;
            state.autoplay.neuralSampleCount = 0;
            if (!window.localStorage) {
                refreshNeuralPanel();
                return;
            }
            try {
                const raw = window.localStorage.getItem(neuralModelStorageKey());
                if (!raw) {
                    refreshNeuralPanel();
                    return;
                }
                const parsed = JSON.parse(raw);
                const model = parsed && parsed.model ? parsed.model : null;
                const valid =
                    !!(model &&
                    Number.isFinite(model.inputSize) &&
                    Number.isFinite(model.hiddenSize) &&
                    model.inputSize >= 4 &&
                    model.inputSize <= 64 &&
                    model.hiddenSize >= 4 &&
                    model.hiddenSize <= 64 &&
                    Array.isArray(model.w1) &&
                    Array.isArray(model.w2) &&
                    Array.isArray(model.b1) &&
                    Array.isArray(model.b2) &&
                    model.w1.length === model.hiddenSize &&
                    model.b1.length === model.hiddenSize &&
                    model.w2.length === 3 &&
                    model.b2.length === 3 &&
                    model.w1.every(function everyRow(row) { return Array.isArray(row) && row.length === model.inputSize; }) &&
                    model.w2.every(function everyOut(row2) { return Array.isArray(row2) && row2.length === model.hiddenSize; }));
                if (!valid) {
                    window.localStorage.removeItem(neuralModelStorageKey());
                    refreshNeuralPanel();
                    return;
                }
                state.autoplay.neuralModel = model;
                state.autoplay.neuralHiddenSize = clamp(Math.round(Number(model.hiddenSize) || 12), 4, 64);
                neuralHiddenSizeInput.value = String(state.autoplay.neuralHiddenSize);
                refreshNeuralPanel();
            } catch (err) {
                console.warn("Neural model load failed:", err);
                refreshNeuralPanel();
            }
        }

        function buildTableSelect() {
            const refs = tableRefEntries();
            evalTableSelect.innerHTML = "";
            refs.forEach(function each(ref, idx) {
                const option = document.createElement("option");
                option.value = ref;
                option.textContent = ref;
                if (idx === 0) option.selected = true;
                evalTableSelect.appendChild(option);
            });
            evalManifestInfo.textContent = "Manifest tables: " + refs.length;
            state.eval.selectedRef = evalTableSelect.value || "";
            if (!refs.length) {
                setEvalStatus("No table refs found in app/tableCatalog.js.", "fail");
            }
        }

        function applyLoadedTableToSandbox(table) {
            if (!table || !table.playfield) return;
            const pf = table.playfield || {};
            const launcher = (table.elements || []).find(function find(el) {
                return el && el.type === "launcher";
            }) || null;
            const playfieldWidth = Number.isFinite(pf.width) && pf.width > 80 ? pf.width : defaultPlayfield.width;
            const playfieldHeight = Number.isFinite(pf.height) && pf.height > 120 ? pf.height : defaultPlayfield.height;

            state.sandbox.playfield.width = playfieldWidth;
            state.sandbox.playfield.height = playfieldHeight;

            state.sandbox.physics.gravity = typeof pf.gravity === "number" ? pf.gravity : state.sandbox.physics.gravity;
            state.sandbox.physics.friction = typeof pf.friction === "number" ? pf.friction : state.sandbox.physics.friction;
            state.sandbox.physics.restitution = typeof pf.restitution === "number" ? pf.restitution : state.sandbox.physics.restitution;
            state.sandbox.physics.maxSpeed = typeof pf.maxSpeed === "number" ? pf.maxSpeed : state.sandbox.physics.maxSpeed;

            state.sandbox.spawn.radius = typeof pf.ballRadius === "number" ? pf.ballRadius : state.sandbox.spawn.radius;
            if (launcher && typeof launcher.x === "number" && typeof launcher.top === "number" && typeof launcher.bottom === "number") {
                const laneY = launcher.bottom - 30;
                state.sandbox.spawn.x = launcher.x;
                state.sandbox.spawn.y = clamp(laneY, 40, playfieldHeight - 40);
                state.sandbox.spawn.useLauncher = true;
            } else {
                state.sandbox.spawn.useLauncher = false;
            }
            state.sandbox.spawn.vx = 0;
            state.sandbox.spawn.vy = 0;

            state.sandbox.elements = clone(table.elements || []).map(normalizeSandboxFlipper);
            state.sandbox.baseTable = clone(table);
            state.sandbox.selectedElementId = "";
            state.sandbox.dragSelection = null;
            state.sandbox.draftWall = null;
            state.sandbox.draggingSpawn = false;
            state.sandbox.controls.left = false;
            state.sandbox.controls.right = false;
            state.sandbox.controls.launch = false;
            state.sandbox.launchHeldPrev = false;
        }

        function loadEvalTable(ref) {
            const normalizedRef = normalizeTableRef(ref);
            if (!normalizedRef) {
                state.eval.loadError = "No table selected.";
                setEvalStatus(state.eval.loadError, "fail");
                return Promise.resolve(null);
            }
            if (location.protocol === "file:") {
                state.eval.loadError = "Table loading is unavailable from file://. Serve this page over HTTP.";
                setEvalStatus(state.eval.loadError, "fail");
                return Promise.resolve(null);
            }
            return fetch(normalizedRef, { cache: "no-store" })
                .then(function parseResponse(response) {
                    if (!response.ok) throw new Error("Failed to load " + normalizedRef);
                    return response.json();
                })
                .then(function loaded(json) {
                    state.eval.selectedRef = normalizedRef;
                    state.eval.selectedTable = Pin.table.normalizeTable(json);
                    state.eval.selectedName = state.eval.selectedTable.name || normalizedRef;
                    applyLoadedTableToSandbox(state.eval.selectedTable);
                    state.eval.loadError = "";
                    state.eval.report = null;
                    if (state.scenarioId === "sandbox") {
                        reloadControls();
                        rebuildSimulation();
                    }
                    loadNeuralModel();
                    setEvalStatus("Loaded " + state.eval.selectedName + ".", "pass");
                    renderEvalReport(null);
                    return state.eval.selectedTable;
                })
                .catch(function failed(err) {
                    state.eval.selectedTable = null;
                    state.eval.loadError = err && err.message ? err.message : "Unable to load table.";
                    setEvalStatus(state.eval.loadError, "fail");
                    return null;
                });
        }

        function finishTableEvaluation(report, runId) {
            if (runId !== state.eval.runId) return;
            state.eval.report = report;
            state.eval.running = false;
            state.eval.liveCheck = null;
            runSelectedEvalButton.textContent = "Run Selected";
            runAllEvalButton.textContent = "Run All";
            setEvalProgress(1, 1);
            const stuckIndex = report.checks.findIndex(function find(check) {
                return check && check.id === "stuck_launcher_ray";
            });
            state.eval.selectedCheckIndex = stuckIndex >= 0 ? stuckIndex : (report.checks.length ? 0 : -1);
            renderEvalReport(report);
            renderEvalRunChecksList();
            render();
            console.log("[tableEval]", report);
        }

        function runTableEvaluation(selectedCheckIds, runModeLabel) {
            if (!state.eval.selectedTable) {
                setEvalStatus("Load a table before running evaluation.", "warn");
                return;
            }
            if (state.eval.running) return;
            const hasSelectionArray = Array.isArray(selectedCheckIds);
            const selectedIds = hasSelectionArray ? selectedCheckIds.slice() : [];
            if (hasSelectionArray && !selectedIds.length) {
                setEvalStatus("Select at least one test checkbox before running selected evaluation.", "warn");
                return;
            }
            const runId = state.eval.runId + 1;
            state.eval.runId = runId;
            state.eval.running = true;
            runSelectedEvalButton.textContent = "Running...";
            runAllEvalButton.textContent = "Running...";
            evalChecks.innerHTML = "";
            evalReport.value = "";
            state.eval.liveCheck = null;
            setEvalProgress(0, 0);
            setEvalStatus("Starting evaluation (" + (runModeLabel || (hasSelectionArray ? "selected" : "all")) + ")...", "warn");
            updateEvalRunSelectionSummary();

            const options = {
                tableId: state.eval.selectedRef || state.eval.selectedName,
                launchRayCount: state.eval.launchRayCount,
                launchMaxCollisions: state.eval.launchMaxCollisions,
                launchMaxTicks: state.eval.launchMaxTicks,
                targetRayCount: state.eval.targetRayCount,
                targetMaxBounces: state.eval.targetMaxBounces,
                accessibilityRayMode: state.eval.accessibilityRayMode,
                accessibilityBranchRays: state.eval.accessibilityBranchRays,
                accessibilityMaxDepth: state.eval.accessibilityMaxDepth,
                accessibilityCellSize: state.eval.accessibilityCellSize,
                accessibilityRaySpeed: state.eval.accessibilityRaySpeed,
                accessibilityMaxTicks: state.eval.accessibilityMaxTicks,
                accessibilityMaxCollisions: state.eval.accessibilityMaxCollisions,
                autoplayBallCount: state.eval.autoplayBallCount,
                autoplayMaxTicksPerBall: state.eval.autoplayMaxTicksPerBall,
                autoplayTargetingIntervalTicks: state.eval.autoplayTargetingIntervalTicks,
                autoplayPreferUnlitTargets: state.eval.autoplayPreferUnlitTargets,
                autoplayCellSize: state.eval.autoplayCellSize,
                autoplayMinScore: state.eval.autoplayMinScore,
                autoplayAimHorizonTicks: state.eval.autoplayAimHorizonTicks,
                autoplayAimPulseTicks: state.eval.autoplayAimPulseTicks,
                autoplayAimCooldownTicks: state.eval.autoplayAimCooldownTicks,
                evalChecks: hasSelectionArray ? selectedIds : undefined,
                onProgress: function onProgress(progress) {
                    if (runId !== state.eval.runId) return;
                    if (progress && progress.phase === "accessibility" && progress.check) {
                        state.eval.liveCheck = progress.check;
                        state.runtime.dirty = true;
                        render();
                    }
                    setEvalProgress(progress.done || 0, progress.total || 0);
                    setEvalStatus(progress.message || "Evaluation running...", "warn");
                }
            };

            const evaluator = Pin.tableEval.evaluateTableAsync || function fallback(table, opts) {
                return Promise.resolve(Pin.tableEval.evaluateTable(table, opts));
            };
            evaluator(state.eval.selectedTable, options)
                .then(function complete(report) {
                    finishTableEvaluation(report, runId);
                })
                .catch(function failed(error) {
                    if (runId !== state.eval.runId) return;
                    state.eval.running = false;
                    state.eval.liveCheck = null;
                    runSelectedEvalButton.textContent = "Run Selected";
                    runAllEvalButton.textContent = "Run All";
                    setEvalProgress(0, 0);
                    setEvalStatus("Evaluation failed: " + (error && error.message ? error.message : "Unknown error"), "fail");
                    updateEvalRunSelectionSummary();
                });
        }

        function aiLabSettings() {
            if (typeof localStorage === "undefined") return {};
            try {
                const raw = localStorage.getItem("pin.assistant.settings");
                return raw ? JSON.parse(raw) : {};
            } catch (error) {
                return {};
            }
        }

        function aiLabWriteSettings(next) {
            if (typeof localStorage === "undefined") return false;
            try {
                localStorage.setItem("pin.assistant.settings", JSON.stringify(next || {}));
                return true;
            } catch (error) {
                return false;
            }
        }

        function aiLabPersistModelOnly(modelValue) {
            /* What: Persist only the selected model into shared assistant settings.
             * Why: AI-Lab and Designer execution read saved provider settings, so model
             *      picks should apply immediately without forcing Save for other fields.
             */
            const current = aiLabSettings();
            const next = Object.assign({}, current, {
                model: String(modelValue == null ? "" : modelValue).trim()
            });
            return aiLabWriteSettings(next);
        }

        function aiLabPopulateSettingsForm() {
            const settings = aiLabSettings();
            aiProviderLabelInput.value = String(settings.providerLabel || "");
            aiBaseUrlInput.value = String(settings.baseUrl || "");
            aiModelInput.value = String(settings.model || "");
            aiApiKeyInput.value = String(settings.apiKey || "");
            aiModelSelect.value = "";
            state.runtime.dirty = true;
        }

        function aiLabSetStatus(text, level) {
            state.aiLab.status = text || "";
            aiStatus.textContent = text || "";
            aiStatus.className = "lab-eval-summary" + (level ? " " + level : "");
            state.runtime.dirty = true;
        }

        function currentLabTableForNavigation() {
            const base = state.eval.selectedTable ? clone(state.eval.selectedTable) : { name: "Physics Lab Table", playfield: {}, elements: [] };
            base.playfield = base.playfield || {};
            base.playfield.width = state.sandbox.playfield.width;
            base.playfield.height = state.sandbox.playfield.height;
            base.playfield.gravity = state.sandbox.physics.gravity;
            base.playfield.friction = state.sandbox.physics.friction;
            base.playfield.restitution = state.sandbox.physics.restitution;
            base.playfield.maxSpeed = state.sandbox.physics.maxSpeed;
            base.playfield.ballRadius = state.sandbox.spawn.radius;
            base.elements = clone(state.sandbox.elements || []);
            return Pin.table.normalizeTable(base);
        }

        function persistTableForMainNavigation() {
            if (!Pin.storage || !Pin.storage.local || typeof Pin.storage.local.save !== "function") return false;
            try {
                const table = currentLabTableForNavigation();
                Pin.storage.local.save("autosave", table);
                return true;
            } catch (error) {
                return false;
            }
        }

        function openMainRoute(hashMode) {
            const saved = persistTableForMainNavigation();
            const next = new URL("index.html#" + hashMode, location.href);
            if (!saved) {
                setEvalStatus("Navigation warning: failed to persist autosave before route change.", "warn");
            }
            location.href = next.href;
        }

        /*
         * What: Consume one-shot design->physics-lab handoff table data.
         * Why: when moving from Designer to Sandbox, the current designer table
         * must win over any pre-existing lab state.
         */
        function consumeDesignerHandoff() {
            if (typeof localStorage === "undefined") return false;
            let raw = "";
            try {
                raw = localStorage.getItem("pin.physicsLab.handoff") || "";
            } catch (error) {
                return false;
            }
            if (!raw) return false;
            try {
                const parsed = JSON.parse(raw);
                if (!parsed || parsed.source !== "design" || !parsed.table || typeof parsed.table !== "object") {
                    localStorage.removeItem("pin.physicsLab.handoff");
                    return false;
                }
                const normalized = Pin.table.normalizeTable(parsed.table);
                state.eval.selectedRef = "design-handoff";
                state.eval.selectedTable = normalized;
                state.eval.selectedName = normalized.name || "Designer Handoff";
                applyLoadedTableToSandbox(normalized);
                state.scenarioId = "sandbox";
                scenarioSelect.value = "sandbox";
                setActiveTab("sandbox");
                setEvalStatus("Loaded table from Designer handoff.", "pass");
                localStorage.removeItem("pin.physicsLab.handoff");
                return true;
            } catch (error) {
                try { localStorage.removeItem("pin.physicsLab.handoff"); } catch (innerError) {}
                setEvalStatus("Designer handoff payload was invalid.", "warn");
                return false;
            }
        }

        function aiLabContract() {
            return Pin.aiLabContract || null;
        }

        /*
         * What: Read provider settings and report missing required fields.
         * Why: operators need deterministic config visibility before AI-Lab runs.
         */
        function aiLabProviderConfigStatus() {
            const settings = aiLabSettings();
            const providerLabel = String(settings.providerLabel || "provider").trim();
            const baseUrl = String(settings.baseUrl || "").trim();
            const apiKey = String(settings.apiKey || "").trim();
            const model = String(settings.model || "").trim();
            const missing = [];
            if (!baseUrl) missing.push("baseUrl");
            if (!apiKey) missing.push("apiKey");
            if (!model) missing.push("model");
            return {
                providerLabel: providerLabel || "provider",
                baseUrl: baseUrl,
                model: model,
                missing: missing,
                ready: missing.length === 0
            };
        }

        function aiLabSetProviderStatus(text, level) {
            aiProviderStatus.textContent = text || "";
            aiProviderStatus.className = "lab-eval-summary" + (level ? " " + level : "");
            state.runtime.dirty = true;
        }

        function aiLabModelsEndpoint(baseUrl) {
            const raw = String(baseUrl || "").trim();
            if (!raw) return "";
            if (/\/models\/?$/i.test(raw)) return raw.replace(/\/+$/, "");
            if (/\/chat\/completions\/?$/i.test(raw)) return raw.replace(/\/chat\/completions\/?$/i, "/models").replace(/\/+$/, "");
            return raw.replace(/\/+$/, "") + "/models";
        }

        function aiLabReadProviderDraft() {
            return {
                providerLabel: String(aiProviderLabelInput.value || "").trim(),
                baseUrl: String(aiBaseUrlInput.value || "").trim(),
                model: String(aiModelInput.value || "").trim(),
                apiKey: String(aiApiKeyInput.value || "").trim()
            };
        }

        function aiLabSetModelOptions(models) {
            aiModelSelect.innerHTML = "";
            const base = document.createElement("option");
            base.value = "";
            base.textContent = models && models.length ? "(choose discovered model)" : "(no models returned)";
            aiModelSelect.appendChild(base);
            (models || []).forEach(function eachModel(id) {
                const opt = document.createElement("option");
                opt.value = id;
                opt.textContent = id;
                aiModelSelect.appendChild(opt);
            });
            const current = String(aiModelInput.value || "").trim();
            if (current && (models || []).indexOf(current) >= 0) aiModelSelect.value = current;
            state.runtime.dirty = true;
        }

        function aiLabFetchModels() {
            const draft = aiLabReadProviderDraft();
            if (!draft.baseUrl || !draft.apiKey) {
                aiLabSetProviderStatus("Provider status: set Base URL and API key to load models.", "warn");
                aiLabSetModelOptions([]);
                return Promise.resolve([]);
            }
            if (state.aiLab.modelsLoading) return Promise.resolve([]);
            state.aiLab.modelsLoading = true;
            aiProviderModelsBtn.disabled = true;
            aiProviderModelsBtn.textContent = "Loading...";
            const endpoint = aiLabModelsEndpoint(draft.baseUrl);
            return fetch(endpoint, {
                method: "GET",
                headers: { Authorization: "Bearer " + draft.apiKey }
            }).then(function onResponse(response) {
                if (!response.ok) throw new Error("HTTP " + response.status);
                return response.json();
            }).then(function onJson(json) {
                const raw = Array.isArray(json && json.data) ? json.data : [];
                const models = raw
                    .map(function map(item) { return item && item.id ? String(item.id) : ""; })
                    .filter(Boolean)
                    .sort(function sortModels(a, b) { return a.localeCompare(b, undefined, { sensitivity: "base" }); });
                aiLabSetModelOptions(models);
                aiLabSetProviderStatus("Provider status: discovered " + models.length + " models.", "pass");
                return models;
            }).catch(function onError(error) {
                const msg = error && error.message ? error.message : "unknown error";
                aiLabSetModelOptions([]);
                aiLabSetProviderStatus("Provider status: failed to load models (" + msg + ").", "fail");
                return [];
            }).finally(function onFinally() {
                state.aiLab.modelsLoading = false;
                aiProviderModelsBtn.disabled = false;
                aiProviderModelsBtn.textContent = "Load Models";
            });
        }

        /*
         * What: Resolve provider status from config plus optional network probe.
         * Why: clear distinction between missing config and unreachable endpoint.
         */
        function aiLabRefreshProviderStatus(probeNetwork) {
            const cfg = aiLabProviderConfigStatus();
            if (!cfg.ready) {
                aiLabSetProviderStatus("Provider status: missing " + cfg.missing.join(", ") + ".", "fail");
                return Promise.resolve({ ok: false, reason: "missing_config", missing: cfg.missing });
            }
            if (!probeNetwork) {
                aiLabSetProviderStatus("Provider status: configured | " + cfg.providerLabel + " | " + cfg.model + ".", "pass");
                return Promise.resolve({ ok: true, reason: "configured_only" });
            }
            if (state.aiLab.providerChecking) return Promise.resolve({ ok: false, reason: "in_progress" });
            state.aiLab.providerChecking = true;
            aiProviderRefreshBtn.disabled = true;
            aiProviderRefreshBtn.textContent = "Checking...";
            aiLabSetProviderStatus("Provider status: probing " + cfg.providerLabel + " ...", "warn");

            const endpoint = aiLabModelsEndpoint(cfg.baseUrl);
            const controller = typeof AbortController !== "undefined" ? new AbortController() : null;
            const timeoutId = controller ? setTimeout(function onProbeTimeout() { controller.abort(); }, 8000) : null;
            return fetch(endpoint, {
                method: "GET",
                headers: { Authorization: "Bearer " + String(aiLabSettings().apiKey || "").trim() },
                signal: controller ? controller.signal : undefined
            }).then(function onResponse(response) {
                if (!response.ok) throw new Error("HTTP " + response.status);
                return response.json();
            }).then(function onJson(json) {
                const count = Array.isArray(json && json.data) ? json.data.length : 0;
                state.aiLab.providerLastCheckedMs = Date.now();
                aiLabSetProviderStatus(
                    "Provider status: reachable | " + cfg.providerLabel + " | model " + cfg.model + " | models " + count + ".",
                    "pass"
                );
                return { ok: true, reason: "reachable", models: count };
            }).catch(function onError(error) {
                const msg = error && error.message ? error.message : "unknown error";
                aiLabSetProviderStatus("Provider status: configured but unreachable (" + msg + ").", "fail");
                return { ok: false, reason: "unreachable", message: msg };
            }).finally(function onFinally() {
                if (timeoutId) clearTimeout(timeoutId);
                state.aiLab.providerChecking = false;
                aiProviderRefreshBtn.disabled = false;
                aiProviderRefreshBtn.textContent = "Check Provider";
            });
        }

        function aiLabParsePatch(text) {
            const raw = String(text || "").trim();
            if (!raw) return null;
            try { return JSON.parse(raw); } catch (error) {}
            const first = raw.indexOf("{");
            const last = raw.lastIndexOf("}");
            if (first >= 0 && last > first) {
                try { return JSON.parse(raw.slice(first, last + 1)); } catch (error) {}
            }
            return null;
        }

        function aiLabFailedChecks(report) {
            return ((report && report.checks) || []).filter(function filter(check) {
                return check && check.status === "fail";
            }).map(function map(check) {
                return { id: check.id, message: check.message };
            });
        }

        function renderAiAttempts() {
            aiAttempts.innerHTML = "";
            if (!state.aiLab.attempts.length) {
                aiAttempts.appendChild(create("div", "small", "No attempts yet."));
                aiDetail.value = "";
                state.runtime.dirty = true;
                return;
            }
            state.aiLab.attempts.forEach(function each(entry, index) {
                const row = create("div", "lab-eval-check " + (entry.accepted ? "pass" : "warn"));
                if (state.aiLab.selectedAttemptIndex === index) row.className += " selected";
                row.appendChild(create("strong", "", "#" + entry.attempt + " " + (entry.accepted ? "ACCEPTED" : "REJECTED")));
                row.appendChild(create("div", "small", entry.statusLine || ""));
                row.onclick = function selectAttempt() {
                    state.aiLab.selectedAttemptIndex = index;
                    aiDetail.value = JSON.stringify(entry, null, 2);
                    if (entry.evalReport) {
                        state.eval.report = entry.evalReport;
                        state.eval.selectedCheckIndex = 0;
                        renderEvalReport(entry.evalReport);
                    }
                    render();
                    renderAiAttempts();
                };
                aiAttempts.appendChild(row);
            });
            const selected = state.aiLab.attempts[state.aiLab.selectedAttemptIndex >= 0 ? state.aiLab.selectedAttemptIndex : 0];
            aiDetail.value = selected ? JSON.stringify(selected, null, 2) : "";
            state.runtime.dirty = true;
        }

        function aiLabRecordAttempt(result, patch, rawResponse, providerMeta) {
            const report = result && result.evalReport ? result.evalReport : null;
            const statusLine =
                "contract " + (result.contractIssues && result.contractIssues.length ? "fail" : "ok") +
                " | validation " + ((result.validationIssues || []).length ? "issues " + (result.validationIssues || []).length : "ok") +
                " | eval fail " + (report && report.summary ? report.summary.failed : 0);
            const entry = {
                attempt: state.aiLab.attempts.length + 1,
                accepted: !!result.accepted,
                statusLine: statusLine,
                contractVersion: result.contractVersion || 0,
                runtimeFingerprint: result.runtimeFingerprint || "",
                physicsContract: result.physicsContract || "",
                provider: providerMeta && providerMeta.provider || "",
                model: providerMeta && providerMeta.model || "",
                patch: patch || null,
                rawResponse: rawResponse || "",
                contractIssues: result.contractIssues || [],
                validationIssues: result.validationIssues || [],
                failedChecks: aiLabFailedChecks(report),
                evalReport: report
            };
            state.aiLab.attempts.push(entry);
            state.aiLab.selectedAttemptIndex = state.aiLab.attempts.length - 1;
            if (result.patchedTable) {
                state.aiLab.pendingPatchedTable = result.patchedTable;
                aiLabPreviewTable(result.patchedTable, entry.attempt, entry.accepted);
            }
            renderAiAttempts();
            return entry;
        }

        /*
         * What: Show the patched table immediately in sandbox for visual review.
         * Why: operator must see geometry/paths right away even when patch is not
         * yet accepted for apply.
         */
        function aiLabPreviewTable(patchedTable, attemptNumber, accepted) {
            if (!patchedTable) return;
            const normalized = Pin.table.normalizeTable(clone(patchedTable));
            applyLoadedTableToSandbox(normalized);
            state.scenarioId = "sandbox";
            scenarioSelect.value = "sandbox";
            setActiveTab("sandbox");
            reloadControls();
            rebuildSimulation();
            aiLabSetStatus(
                "Previewing attempt #" + attemptNumber + " in sandbox (" + (accepted ? "accepted" : "rejected") + ").",
                accepted ? "pass" : "warn"
            );
        }

        function aiLabApplyPending() {
            const selected = state.aiLab.attempts[state.aiLab.selectedAttemptIndex];
            if (!selected || !selected.accepted || !state.aiLab.pendingPatchedTable) {
                aiLabSetStatus("No approved pending patch to apply.", "warn");
                return;
            }
            state.eval.selectedTable = Pin.table.normalizeTable(clone(state.aiLab.pendingPatchedTable));
            state.eval.selectedName = state.eval.selectedTable.name || state.eval.selectedName || "AI-Lab Table";
            applyLoadedTableToSandbox(state.eval.selectedTable);
            state.scenarioId = "sandbox";
            scenarioSelect.value = "sandbox";
            setActiveTab("sandbox");
            reloadControls();
            rebuildSimulation();
            aiLabSetStatus("Applied attempt #" + selected.attempt + ".", "pass");
        }

        function aiLabRejectSelected() {
            const selected = state.aiLab.attempts[state.aiLab.selectedAttemptIndex];
            if (!selected) return;
            selected.accepted = false;
            selected.statusLine = "Rejected by operator | " + selected.statusLine;
            state.aiLab.pendingPatchedTable = null;
            renderAiAttempts();
            aiLabSetStatus("Rejected attempt #" + selected.attempt + ".", "warn");
        }

        function aiLabCheckpoint() {
            if (!state.eval.selectedTable) {
                aiLabSetStatus("Load a table before checkpoint.", "warn");
                return;
            }
            state.aiLab.checkpointTable = clone(state.eval.selectedTable);
            state.aiLab.checkpointName = state.eval.selectedName || "table";
            aiLabSetStatus("Checkpoint saved.", "pass");
        }

        function aiLabRollback() {
            if (!state.aiLab.checkpointTable) {
                aiLabSetStatus("No checkpoint available.", "warn");
                return;
            }
            state.eval.selectedTable = clone(state.aiLab.checkpointTable);
            state.eval.selectedName = state.aiLab.checkpointName || state.eval.selectedName;
            applyLoadedTableToSandbox(state.eval.selectedTable);
            state.scenarioId = "sandbox";
            scenarioSelect.value = "sandbox";
            reloadControls();
            rebuildSimulation();
            aiLabSetStatus("Rolled back to checkpoint.", "pass");
        }

        function aiLabNormalizeProviderBaseUrl(baseUrl) {
            const raw = String(baseUrl || "").trim();
            if (!raw) return "";
            return raw.replace(/^(\w+:\/\/)0\.0\.0\.0(?=[:/]|$)/i, "$1localhost");
        }

        function aiLabBuildPrompt(baseTask, feedback) {
            const report = state.eval.report || null;
            const failChecks = aiLabFailedChecks(report).slice(0, 16);
            const table = state.eval.selectedTable || {};
            const selectedId = state.aiLab.selectedElementId || "";
            const selected = selectedId && Array.isArray(table.elements)
                ? (table.elements.find(function find(el) { return el && el.id === selectedId; }) || null)
                : null;
            const logicDoc = table && table.logicDocument
                ? table.logicDocument
                : {
                    logicVersion: 1,
                    switchRegistry: [],
                    stateTable: [],
                    computedState: [],
                    lampBindings: [],
                    actionRules: [],
                    resetRules: []
                };
            const context = {
                tableName: state.eval.selectedName || "",
                summary: report && report.summary ? report.summary : null,
                failedChecks: failChecks,
                selected: selected ? { id: selected.id, type: selected.type, name: selected.name || selected.label || "" } : null,
                elements: Array.isArray(table.elements) ? table.elements.map(function map(el) {
                    return { id: el.id, type: el.type, name: el.name || el.label || el.text || "" };
                }) : [],
                logicDoc: logicDoc
            };
            const shared = Pin.aiPromptContract && typeof Pin.aiPromptContract.buildPatchPrompt === "function"
                ? Pin.aiPromptContract
                : null;
            if (shared) {
                return shared.buildPatchPrompt({
                    task: baseTask,
                    context: context,
                    repairNote: feedback ? ("Previous patch failed validation. Fix these issues and return a full corrected patch JSON.\n" + feedback) : ""
                });
            }
            return [
                "Return JSON patch only.",
                "Allowed keys: tablePatch, addElements, patchElements, removeElements, addFeatures, patchFeatures, removeFeatures, logicDocPatch.",
                "Task:",
                baseTask,
                "Context:",
                JSON.stringify(context),
                feedback ? ("Repair note:\n" + feedback) : ""
            ].join("\n");
        }

        function aiLabRequestPatch(prompt) {
            const settings = aiLabSettings();
            const baseUrl = aiLabNormalizeProviderBaseUrl(settings.baseUrl);
            const apiKey = String(settings.apiKey || "").trim();
            const model = String(settings.model || "").trim();
            if (!baseUrl || !model) {
                return Promise.reject(new Error("Missing provider settings in assistant config."));
            }
            const endpoint = /\/chat\/completions\/?$/i.test(baseUrl) ? baseUrl.replace(/\/+$/, "") : (baseUrl.replace(/\/+$/, "") + "/chat/completions");
            const headers = { "Content-Type": "application/json" };
            if (apiKey) headers.Authorization = "Bearer " + apiKey;
            return fetch(endpoint, {
                method: "POST",
                headers: headers,
                body: JSON.stringify({
                    model: model,
                    temperature: 0.1,
                    messages: [
                        { role: "system", content: "Generate safe structured patch JSON only." },
                        { role: "user", content: prompt }
                    ]
                })
            }).then(function parse(response) {
                if (!response.ok) throw new Error("Provider HTTP " + response.status);
                return response.json();
            }).then(function payload(json) {
                const content = json && json.choices && json.choices[0] && json.choices[0].message ? String(json.choices[0].message.content || "") : "";
                return { content: content, provider: String(settings.providerLabel || "provider"), model: model };
            });
        }

        function aiLabRunAttempt(feedback) {
            if (!state.eval.selectedTable) {
                aiLabSetStatus("Load a table first.", "warn");
                return Promise.resolve(null);
            }
            const task = aiPrompt.value.trim() || "Improve table validity while preserving playability.";
            const contract = aiLabContract();
            if (!contract || typeof contract.evaluatePatchAttempt !== "function") {
                aiLabSetStatus("AI-Lab contract runtime unavailable.", "fail");
                return Promise.resolve(null);
            }
            aiLabSetStatus("Requesting patch...", "warn");
            return aiLabRequestPatch(aiLabBuildPrompt(task, feedback)).then(function onPatch(response) {
                const patch = aiLabParsePatch(response.content);
                if (!patch) {
                    const result = {
                        accepted: false,
                        contractIssues: ["Model response was not valid JSON patch."],
                        validationIssues: [],
                        evalReport: null,
                        contractVersion: contract.contractVersion || 0,
                        runtimeFingerprint: contract.runtimeFingerprint ? contract.runtimeFingerprint() : "",
                        physicsContract: "Pin.physics.stepWorld",
                        patchedTable: null
                    };
                    aiLabRecordAttempt(result, null, response.content, { provider: response.provider, model: response.model });
                    aiLabSetStatus("Patch parse failed.", "fail");
                    return result;
                }
                const evalOptions = {
                    tableId: state.eval.selectedRef || state.eval.selectedName,
                    launchRayCount: state.eval.launchRayCount,
                    launchMaxCollisions: state.eval.launchMaxCollisions,
                    launchMaxTicks: state.eval.launchMaxTicks,
                    targetRayCount: state.eval.targetRayCount,
                    targetMaxBounces: state.eval.targetMaxBounces,
                    accessibilityRayMode: state.eval.accessibilityRayMode,
                    accessibilityBranchRays: state.eval.accessibilityBranchRays,
                    accessibilityMaxDepth: state.eval.accessibilityMaxDepth,
                    accessibilityCellSize: state.eval.accessibilityCellSize,
                    accessibilityRaySpeed: state.eval.accessibilityRaySpeed,
                    accessibilityMaxTicks: state.eval.accessibilityMaxTicks,
                    accessibilityMaxCollisions: state.eval.accessibilityMaxCollisions,
                    autoplayBallCount: state.eval.autoplayBallCount,
                    autoplayMaxTicksPerBall: state.eval.autoplayMaxTicksPerBall,
                    autoplayTargetingIntervalTicks: state.eval.autoplayTargetingIntervalTicks,
                    autoplayPreferUnlitTargets: state.eval.autoplayPreferUnlitTargets,
                    autoplayCellSize: state.eval.autoplayCellSize,
                    autoplayMinScore: state.eval.autoplayMinScore,
                    autoplayAimHorizonTicks: state.eval.autoplayAimHorizonTicks,
                    autoplayAimPulseTicks: state.eval.autoplayAimPulseTicks,
                    autoplayAimCooldownTicks: state.eval.autoplayAimCooldownTicks
                };
                const result = contract.evaluatePatchAttempt(state.eval.selectedTable, patch, evalOptions);
                aiLabRecordAttempt(result, patch, response.content, { provider: response.provider, model: response.model });
                aiLabSetStatus(result.accepted ? "Attempt accepted." : "Attempt rejected.", result.accepted ? "pass" : "warn");
                if (!state.aiLab.requireManualApply && result.accepted && result.patchedTable) aiLabApplyPending();
                return result;
            }).catch(function onError(error) {
                aiLabSetStatus("AI-Lab request failed: " + (error && error.message ? error.message : "Unknown error"), "fail");
                return null;
            });
        }

        function aiLabRunLoop() {
            if (state.aiLab.running) return;
            state.aiLab.running = true;
            let attempts = 0;
            let feedback = "";
            function next() {
                if (!state.aiLab.running) return Promise.resolve();
                if (attempts >= state.aiLab.maxAttempts) {
                    aiLabSetStatus("Stopped at max attempts.", "warn");
                    state.aiLab.running = false;
                    return Promise.resolve();
                }
                attempts += 1;
                return aiLabRunAttempt(feedback).then(function after(result) {
                    if (!result) {
                        state.aiLab.running = false;
                        return;
                    }
                    const hasWarn = !!(result.evalReport && result.evalReport.summary && result.evalReport.summary.warnings > 0);
                    const hasFail = !!(result.evalReport && result.evalReport.summary && result.evalReport.summary.failed > 0);
                    if (result.accepted && (!state.aiLab.stopOnWarn || !hasWarn)) {
                        state.aiLab.running = false;
                        return;
                    }
                    if (state.aiLab.stopOnFail && hasFail) {
                        aiLabSetStatus("Stopped on fail guardrail.", "warn");
                        state.aiLab.running = false;
                        return;
                    }
                    if (state.aiLab.stopOnWarn && hasWarn) {
                        aiLabSetStatus("Stopped on warn guardrail.", "warn");
                        state.aiLab.running = false;
                        return;
                    }
                    feedback =
                        "contract issues: " + JSON.stringify(result.contractIssues || []) + "\n" +
                        "validation issues: " + JSON.stringify((result.validationIssues || []).slice(0, 16)) + "\n" +
                        "failed checks: " + JSON.stringify(aiLabFailedChecks(result.evalReport).slice(0, 16));
                    if (!state.aiLab.autoEnabled && !state.aiLab.batchEnabled) {
                        state.aiLab.running = false;
                        return;
                    }
                    return next();
                });
            }
            return next().finally(function finish() {
                state.aiLab.running = false;
            });
        }

        function selectedEvalCheck() {
            if ((state.eval.running || state.autoplay.liveRunning) && state.eval.liveCheck) return state.eval.liveCheck;
            const report = state.eval.report;
            if (!report || !Array.isArray(report.checks)) return null;
            if (state.eval.selectedCheckIndex < 0 || state.eval.selectedCheckIndex >= report.checks.length) return null;
            return report.checks[state.eval.selectedCheckIndex] || null;
        }

        function drawDiagnosticOverlay(check) {
            if (!check) return;
            const diagnostics = check.diagnostics || {};
            const status = check.status || "warn";
            const palette = status === "fail" ?
                { stroke: "rgba(255, 88, 88, 0.95)", fill: "rgba(255, 88, 88, 0.14)" } :
                (status === "warn" ? { stroke: "rgba(255, 196, 86, 0.95)", fill: "rgba(255, 196, 86, 0.14)" } :
                    { stroke: "rgba(114, 215, 163, 0.95)", fill: "rgba(114, 215, 163, 0.14)" });

            ctx.save();
            ctx.strokeStyle = palette.stroke;
            ctx.fillStyle = palette.fill;
            ctx.lineWidth = 2;
            ctx.setLineDash([]);

            if (diagnostics.heatmap && Array.isArray(diagnostics.heatmap.values)) {
                const heat = diagnostics.heatmap;
                const cellSize = Number(heat.cellSize) || 0;
                const cols = Number(heat.cols) || 0;
                const rows = Number(heat.rows) || 0;
                if (cellSize > 0 && cols > 0 && rows > 0) {
                    let maxValue = 0;
                    heat.values.forEach(function each(value) {
                        const v = Number(value) || 0;
                        if (v > maxValue) maxValue = v;
                    });
                    if (maxValue > 0) {
                        for (let row = 0; row < rows; row++) {
                            for (let col = 0; col < cols; col++) {
                                const idx = row * cols + col;
                                const value = Number(heat.values[idx]) || 0;
                                if (value <= 0) continue;
                                const alpha = Math.min(0.5, 0.08 + (value / maxValue) * 0.42);
                                ctx.fillStyle = "rgba(84, 224, 160, " + alpha.toFixed(3) + ")";
                                ctx.fillRect(col * cellSize, row * cellSize, cellSize, cellSize);
                            }
                        }
                    }
                }
                ctx.fillStyle = palette.fill;
            }

            (diagnostics.segments || []).forEach(function each(seg) {
                if (!seg) return;
                ctx.strokeStyle = seg.color || palette.stroke;
                ctx.lineWidth = seg.lineWidth || 2;
                ctx.beginPath();
                ctx.moveTo(seg.x1, seg.y1);
                ctx.lineTo(seg.x2, seg.y2);
                ctx.stroke();
            });
            (diagnostics.rects || []).forEach(function each(rect) {
                if (!rect) return;
                ctx.fillRect(rect.x, rect.y, rect.w, rect.h);
                ctx.strokeRect(rect.x, rect.y, rect.w, rect.h);
            });
            (diagnostics.circles || []).forEach(function each(circle) {
                if (!circle) return;
                ctx.fillStyle = circle.fill || palette.fill;
                ctx.strokeStyle = circle.stroke || palette.stroke;
                ctx.lineWidth = circle.lineWidth || 2;
                ctx.beginPath();
                ctx.arc(circle.x, circle.y, circle.r || 8, 0, Math.PI * 2);
                ctx.fill();
                ctx.stroke();
            });
            (diagnostics.points || []).forEach(function each(point) {
                if (!point || typeof point.x !== "number" || typeof point.y !== "number") return;
                ctx.fillStyle = point.fill || palette.fill;
                ctx.strokeStyle = point.stroke || palette.stroke;
                ctx.beginPath();
                ctx.arc(point.x, point.y, 5, 0, Math.PI * 2);
                ctx.fill();
                ctx.stroke();
            });
            if (Array.isArray(diagnostics.trajectories) && diagnostics.trajectories.length) {
                diagnostics.trajectories.forEach(function eachTrajectory(entry, trajectoryIndex) {
                    const trajectory = entry && Array.isArray(entry.path) ? entry.path : [];
                    if (trajectory.length < 2) return;
                    const hue = (195 + trajectoryIndex * 28) % 360;
                    ctx.strokeStyle = "hsla(" + hue + ", 92%, 66%, 0.82)";
                    ctx.lineWidth = entry.status === "warn" ? 3 : 2;
                    ctx.beginPath();
                    trajectory.forEach(function each(sample, i) {
                        if (!sample) return;
                        if (i === 0) ctx.moveTo(sample.x, sample.y);
                        else ctx.lineTo(sample.x, sample.y);
                    });
                    ctx.stroke();
                    const first = trajectory[0];
                    const last = trajectory[trajectory.length - 1];
                    if (first) {
                        ctx.fillStyle = "hsla(" + hue + ", 92%, 70%, 0.95)";
                        ctx.beginPath();
                        ctx.arc(first.x, first.y, 3.5, 0, Math.PI * 2);
                        ctx.fill();
                    }
                    if (last) {
                        ctx.fillStyle = entry.status === "warn" ? "rgba(255, 196, 86, 0.98)" : "rgba(255, 230, 130, 0.88)";
                        ctx.beginPath();
                        ctx.arc(last.x, last.y, 4, 0, Math.PI * 2);
                        ctx.fill();
                    }
                });
            } else if (Array.isArray(diagnostics.trajectory) && diagnostics.trajectory.length > 1) {
                ctx.strokeStyle = "rgba(100, 205, 255, 0.9)";
                ctx.lineWidth = 2;
                ctx.beginPath();
                diagnostics.trajectory.forEach(function each(sample, i) {
                    if (!sample) return;
                    if (i === 0) ctx.moveTo(sample.x, sample.y);
                    else ctx.lineTo(sample.x, sample.y);
                });
                ctx.stroke();
                const first = diagnostics.trajectory[0];
                const last = diagnostics.trajectory[diagnostics.trajectory.length - 1];
                if (first) {
                    ctx.fillStyle = "rgba(110, 232, 255, 0.95)";
                    ctx.beginPath();
                    ctx.arc(first.x, first.y, 4, 0, Math.PI * 2);
                    ctx.fill();
                }
                if (last) {
                    ctx.fillStyle = "rgba(255, 210, 110, 0.95)";
                    ctx.beginPath();
                    ctx.arc(last.x, last.y, 4, 0, Math.PI * 2);
                    ctx.fill();
                }
            } else if (Array.isArray(diagnostics.trajectory) && diagnostics.trajectory.length === 1) {
                const only = diagnostics.trajectory[0];
                ctx.fillStyle = "rgba(110, 232, 255, 0.95)";
                ctx.beginPath();
                ctx.arc(only.x, only.y, 5, 0, Math.PI * 2);
                ctx.fill();
            }
            (diagnostics.labels || []).forEach(function each(label) {
                if (!label || typeof label.text !== "string") return;
                const x = typeof label.x === "number" ? label.x : 12;
                const y = typeof label.y === "number" ? label.y : 24;
                ctx.fillStyle = "rgba(8,10,16,0.8)";
                ctx.fillRect(x - 2, y - 12, Math.max(70, label.text.length * 7), 16);
                ctx.fillStyle = "#e7f1ff";
                ctx.font = '12px Arial';
                ctx.fillText(label.text, x, y);
            });

            const hasDrawable =
                (diagnostics.heatmap && diagnostics.heatmap.values && diagnostics.heatmap.values.length) ||
                (diagnostics.segments && diagnostics.segments.length) ||
                (diagnostics.rects && diagnostics.rects.length) ||
                (diagnostics.circles && diagnostics.circles.length) ||
                (diagnostics.points && diagnostics.points.length) ||
                (diagnostics.trajectories && diagnostics.trajectories.length) ||
                (diagnostics.trajectory && diagnostics.trajectory.length) ||
                (diagnostics.labels && diagnostics.labels.length);
            if (!hasDrawable) {
                ctx.fillStyle = "rgba(10, 14, 22, 0.84)";
                ctx.fillRect(16, 182, 270, 20);
                ctx.fillStyle = "#bfd3ff";
                ctx.font = '12px Arial';
                ctx.fillText("No drawable diagnostic for this check.", 24, 196);
            }
            ctx.restore();
        }

        function sandboxWallId() {
            return "sandboxWall_" + Math.random().toString(36).slice(2, 8);
        }

        function canvasPoint(event) {
            const rect = canvas.getBoundingClientRect();
            const scaleX = canvas.width / rect.width;
            const scaleY = canvas.height / rect.height;
            return {
                x: (event.clientX - rect.left) * scaleX,
                y: (event.clientY - rect.top) * scaleY
            };
        }

        /**
         * Decide when sandbox auto-generated boundary walls should be included.
         * Why: loaded authored tables already include their own walls, so adding
         * sandbox defaults creates an incorrect inner duplicate boundary.
         */
        function includeDefaultSandboxBounds() {
            return !state.eval.selectedTable;
        }

        function rebuildSandboxSimulation() {
            state.sandbox.elements.forEach(normalizeSandboxFlipper);
            syncCanvasPlayfield(state.sandbox.playfield);
            state.sim = Pin.physicsHarness.createSimulation("sandbox", {
                sandbox: {
                    includeDefaultBounds: includeDefaultSandboxBounds(),
                    baseTable: state.sandbox.baseTable ? clone(state.sandbox.baseTable) : null,
                    playfield: clone(state.sandbox.playfield),
                    physics: clone(state.sandbox.physics),
                    elements: clone(state.sandbox.elements),
                    spawn: clone(state.sandbox.spawn)
                }
            });
            state.sandbox.launchHeldPrev = false;
            if (state.autoplay.liveRunning) {
                if (state.autoplay.liveMode === "neural" && state.autoplay.neuralModel && Pin.tableAutoplayLearning && typeof Pin.tableAutoplayLearning.createController === "function") {
                    const fallbackController = Pin.tableAutoplay.createController(state.sim.world, autoplayOptionsFromEvalState());
                    state.autoplay.liveController = Pin.tableAutoplayLearning.createController(state.sim.world, {
                        model: state.autoplay.neuralModel,
                        pulseTicks: state.eval.autoplayAimPulseTicks,
                        cooldownTicks: state.eval.autoplayAimCooldownTicks,
                        minConfidence: 0.54,
                        minActionProbability: 0.22,
                        indecisiveGap: 0.1,
                        fallbackController: fallbackController,
                        targetProvider: function targetProvider() {
                            return fallbackController && typeof fallbackController.getTarget === "function"
                                ? fallbackController.getTarget()
                                : null;
                        }
                    });
                } else if (Pin.tableAutoplay && typeof Pin.tableAutoplay.createController === "function") {
                    state.autoplay.liveController = Pin.tableAutoplay.createController(state.sim.world, autoplayOptionsFromEvalState());
                }
            }
            applySandboxControlsToWorld();
            exportBox.value = JSON.stringify(state.sim.toFragment(), null, 2);
            render();
            refreshMetrics();
        }

        function applySandboxControlsToWorld() {
            if (!state.sim || !state.sim.world) return;
            const world = state.sim.world;
            world.controls.left = !!state.sandbox.controls.left;
            world.controls.right = !!state.sandbox.controls.right;
            world.launchCharging = !!state.sandbox.controls.launch;
            if (state.sandbox.launchHeldPrev && !state.sandbox.controls.launch && Pin.physics && Pin.physics.releaseLauncher) {
                Pin.physics.releaseLauncher(world);
            }
            state.sandbox.launchHeldPrev = !!state.sandbox.controls.launch;
        }

        function getSandboxElement(id) {
            return state.sandbox.elements.find(function find(element) {
                return element && element.id === id;
            }) || null;
        }

        function flipperRotateHandle(element) {
            if (!element || !element.pivot) return null;
            const angle = typeof element.restAngle === "number" ? element.restAngle : 0;
            const distanceOut = (element.length || 95) + 26;
            return {
                x: element.pivot.x + Math.cos(angle) * distanceOut,
                y: element.pivot.y + Math.sin(angle) * distanceOut
            };
        }

        function deleteSelectedSandboxElement() {
            const id = state.sandbox.selectedElementId;
            if (!id) return;
            const next = state.sandbox.elements.filter(function keep(element) {
                return !(element && element.id === id);
            });
            if (next.length === state.sandbox.elements.length) return;
            state.sandbox.elements = next;
            state.sandbox.selectedElementId = "";
            state.sandbox.dragSelection = null;
            rebuildSimulation();
            buildSandboxControls();
        }

        function lineDistance(point, a, b) {
            const dx = b.x - a.x;
            const dy = b.y - a.y;
            const lenSq = dx * dx + dy * dy;
            if (!lenSq) return distance(point, a);
            let t = ((point.x - a.x) * dx + (point.y - a.y) * dy) / lenSq;
            t = Math.max(0, Math.min(1, t));
            return distance(point, { x: a.x + dx * t, y: a.y + dy * t });
        }

        function pickSandboxElement(point) {
            const selected = getSandboxElement(state.sandbox.selectedElementId);
            if (selected && selected.type === "flipper") {
                const handle = flipperRotateHandle(selected);
                if (handle && distance(point, handle) <= 14) {
                    return { element: selected, mode: "rotate" };
                }
            }
            for (let i = state.sandbox.elements.length - 1; i >= 0; i--) {
                const element = state.sandbox.elements[i];
                if (!element) continue;
                if (element.type === "flipper" && element.pivot && distance(point, element.pivot) <= 22) {
                    return { element: element, mode: "pivot" };
                }
                if (element.type === "path" && element.anchors && element.anchors.length >= 2) {
                    if (lineDistance(point, element.anchors[0], element.anchors[1]) <= 10) return { element: element, mode: "path" };
                }
            }
            return null;
        }

        function buildSliderGroup(parent, title, rows, source, onPatch, clearParent) {
            if (clearParent !== false) parent.innerHTML = "";
            parent.appendChild(create("h2", "", title));
            const group = create("div", "lab-group");
            rows.forEach(function each(row) {
                const slider = create("div", "lab-slider");
                const leftCell = create("div");
                const label = create("label", "");
                const value = create("span", "value", String(source[row.key]));
                label.textContent = row.label;
                label.appendChild(value);
                const range = document.createElement("input");
                range.type = "range";
                range.min = row.min;
                range.max = row.max;
                range.step = row.step;
                range.value = source[row.key];
                const number = document.createElement("input");
                number.type = "number";
                number.className = "lab-number";
                number.min = row.min;
                number.max = row.max;
                number.step = row.step;
                number.value = source[row.key];
                function apply(nextValue) {
                    const numeric = Number(nextValue);
                    source[row.key] = numeric;
                    range.value = numeric;
                    number.value = numeric;
                    value.textContent = String(round(numeric, 3));
                    onPatch();
                }
                range.oninput = function onInput() { apply(range.value); };
                number.onchange = function onChange() { apply(number.value); };
                leftCell.appendChild(label);
                leftCell.appendChild(range);
                slider.appendChild(leftCell);
                slider.appendChild(number);
                group.appendChild(slider);
            });
            parent.appendChild(group);
        }

        function buildScenarioInfo(scenario) {
            scenarioInfo.innerHTML = "";
            scenarioInfo.appendChild(create("h3", "", scenario.name));
            scenarioInfo.appendChild(create("p", "small", scenario.description));
        }

        function rebuildSimulation() {
            if (state.scenarioId === "sandbox") {
                rebuildSandboxSimulation();
                return;
            }
            state.sim = Pin.physicsHarness.createSimulation(state.scenarioId, {
                tuning: state.tuning,
                inputs: state.inputs
            });
            exportBox.value = JSON.stringify(state.sim.toFragment(), null, 2);
            render();
            refreshMetrics();
        }

        function refreshMetrics() {
            const entries = metricEntries(state.sim);
            if (state.runtime.metricRowCount !== entries.length) {
                metricList.innerHTML = "";
                state.runtime.metricRows = [];
                entries.forEach(function each(entry) {
                    const labelEl = create("div", "label", entry.label);
                    const valueEl = create("div", "value", String(entry.value));
                    metricList.appendChild(labelEl);
                    metricList.appendChild(valueEl);
                    state.runtime.metricRows.push({ labelEl: labelEl, valueEl: valueEl });
                });
                state.runtime.metricRowCount = entries.length;
            } else {
                entries.forEach(function each(entry, index) {
                    const row = state.runtime.metricRows[index];
                    if (!row) return;
                    const nextLabel = String(entry.label);
                    const nextValue = String(entry.value);
                    if (row.labelEl.textContent !== nextLabel) row.labelEl.textContent = nextLabel;
                    if (row.valueEl.textContent !== nextValue) row.valueEl.textContent = nextValue;
                });
            }
            const runStateParts = [
                state.sim && state.sim.name ? state.sim.name : "Simulation",
                state.playing ? "Running" : "Paused",
                "Tick " + state.sim.tick + " / " + state.sim.totalTicks
            ];
            if (state.scenarioId === "sandbox") {
                runStateParts.push("Tool: " + state.sandbox.tool);
            }
            runStateSummary.textContent = runStateParts.join(" | ");
            exportBox.value = JSON.stringify(state.sim.toFragment(), null, 2);
            if (state.ui.activeTab === "brain" || state.autoplay.liveRunning || state.autoplay.training.collecting) {
                refreshBrainPanel();
            }
        }

        function render() {
            if (state.eval.selectedTable && state.scenarioId !== "sandbox") {
                try {
                    syncCanvasPlayfield(state.eval.selectedTable && state.eval.selectedTable.playfield);
                    const previewWorld = createEvalPreviewWorld(state.eval.selectedTable);
                    Pin.render.renderWorld(ctx, previewWorld, { showHud: false, showCabinet: true });
                } catch (error) {
                    if (state.sim && state.sim.world && state.sim.world.table) syncCanvasPlayfield(state.sim.world.table.playfield);
                    Pin.render.renderWorld(ctx, state.sim.world);
                }
            } else {
                if (state.sim && state.sim.world && state.sim.world.table) syncCanvasPlayfield(state.sim.world.table.playfield);
                Pin.render.renderWorld(ctx, state.sim.world);
            }
            if (state.scenarioId === "sandbox") {
                ctx.save();
                const showSandboxWallOverlay = !state.eval.selectedTable;
                const showLoadedTablePathOverlay = !!state.eval.selectedTable;
                if (showSandboxWallOverlay) {
                    ctx.strokeStyle = "rgba(124, 214, 255, 0.85)";
                    ctx.lineWidth = 2;
                    ctx.setLineDash([8, 6]);
                    state.sandbox.elements.forEach(function each(element) {
                        if (!element || !element.anchors || element.anchors.length < 2) return;
                        if (typeof element.id !== "string" || element.id.indexOf("sandboxWall_") !== 0) return;
                        ctx.beginPath();
                        ctx.moveTo(element.anchors[0].x, element.anchors[0].y);
                        ctx.lineTo(element.anchors[1].x, element.anchors[1].y);
                        ctx.stroke();
                    });
                }
                if (showLoadedTablePathOverlay) {
                    ctx.strokeStyle = "rgba(124, 214, 255, 0.95)";
                    ctx.lineWidth = 2;
                    ctx.setLineDash([]);
                    state.sandbox.elements.forEach(function each(element) {
                        if (!element || element.type !== "path" || !element.anchors || element.anchors.length < 2) return;
                        const segments = Pin.geometry.pathToSegments(element.anchors, !!element.closed, 1);
                        if (!segments.length) return;
                        ctx.beginPath();
                        segments.forEach(function eachSegment(segment) {
                            ctx.moveTo(segment.x1, segment.y1);
                            ctx.lineTo(segment.x2, segment.y2);
                        });
                        ctx.stroke();
                    });
                }
                const selected = getSandboxElement(state.sandbox.selectedElementId);
                if (selected) {
                    ctx.strokeStyle = "rgba(255, 232, 120, 0.98)";
                    ctx.lineWidth = 3;
                    if (selected.type === "path" && selected.anchors && selected.anchors.length >= 2) {
                        ctx.beginPath();
                        ctx.moveTo(selected.anchors[0].x, selected.anchors[0].y);
                        ctx.lineTo(selected.anchors[1].x, selected.anchors[1].y);
                        ctx.stroke();
                    } else if (selected.type === "flipper" && selected.pivot) {
                        ctx.beginPath();
                        ctx.arc(selected.pivot.x, selected.pivot.y, 14, 0, Math.PI * 2);
                        ctx.stroke();
                        const handle = flipperRotateHandle(selected);
                        if (handle) {
                            ctx.beginPath();
                            ctx.moveTo(selected.pivot.x, selected.pivot.y);
                            ctx.lineTo(handle.x, handle.y);
                            ctx.stroke();
                            ctx.fillStyle = "rgba(255, 122, 214, 0.96)";
                            ctx.beginPath();
                            ctx.arc(handle.x, handle.y, 8, 0, Math.PI * 2);
                            ctx.fill();
                            ctx.strokeStyle = "rgba(255, 122, 214, 0.98)";
                            ctx.stroke();
                        }
                    }
                }
                if (state.sandbox.draftWall) {
                    ctx.strokeStyle = "rgba(255, 214, 120, 0.95)";
                    ctx.beginPath();
                    ctx.moveTo(state.sandbox.draftWall.x1, state.sandbox.draftWall.y1);
                    ctx.lineTo(state.sandbox.draftWall.x2, state.sandbox.draftWall.y2);
                    ctx.stroke();
                }
                if (showSandboxWallOverlay) {
                    ctx.fillStyle = "rgba(255, 214, 120, 0.95)";
                    ctx.strokeStyle = "#201400";
                    ctx.lineWidth = 2;
                    ctx.beginPath();
                    ctx.arc(state.sandbox.spawn.x, state.sandbox.spawn.y, 8, 0, Math.PI * 2);
                    ctx.fill();
                    ctx.stroke();
                    ctx.beginPath();
                    ctx.moveTo(state.sandbox.spawn.x - 12, state.sandbox.spawn.y);
                    ctx.lineTo(state.sandbox.spawn.x + 12, state.sandbox.spawn.y);
                    ctx.moveTo(state.sandbox.spawn.x, state.sandbox.spawn.y - 12);
                    ctx.lineTo(state.sandbox.spawn.x, state.sandbox.spawn.y + 12);
                    ctx.stroke();
                }
                if (state.sandbox.rayProbe && Array.isArray(state.sandbox.rayProbe.traces) && state.sandbox.rayProbe.traces.length) {
                    state.sandbox.rayProbe.traces.forEach(function eachTrace(trace) {
                        if (!trace || !Array.isArray(trace.path) || trace.path.length < 2) return;
                        ctx.strokeStyle = trace.reached ? "rgba(115, 240, 166, 0.75)" : "rgba(255, 156, 108, 0.75)";
                        ctx.lineWidth = 2;
                        ctx.setLineDash([]);
                        ctx.beginPath();
                        trace.path.forEach(function eachPoint(point, index) {
                            if (!point) return;
                            if (index === 0) ctx.moveTo(point.x, point.y);
                            else ctx.lineTo(point.x, point.y);
                        });
                        ctx.stroke();
                    });
                    (state.sandbox.rayProbe.envelopes || []).forEach(function eachArc(arc) {
                        if (!arc) return;
                        const span = Math.atan2(Math.sin(arc.to - arc.from), Math.cos(arc.to - arc.from));
                        const steps = 24;
                        let prevOuter = null;
                        let prevInner = null;
                        ctx.strokeStyle = "rgba(255, 235, 128, 0.85)";
                        ctx.lineWidth = 1.5;
                        for (let i = 0; i <= steps; i++) {
                            const t = i / steps;
                            const a = arc.from + span * t;
                            const outer = { x: arc.x + Math.cos(a) * arc.maxR, y: arc.y + Math.sin(a) * arc.maxR };
                            const inner = { x: arc.x + Math.cos(a) * arc.minR, y: arc.y + Math.sin(a) * arc.minR };
                            if (prevOuter) {
                                ctx.beginPath();
                                ctx.moveTo(prevOuter.x, prevOuter.y);
                                ctx.lineTo(outer.x, outer.y);
                                ctx.stroke();
                            }
                            if (prevInner) {
                                ctx.beginPath();
                                ctx.moveTo(prevInner.x, prevInner.y);
                                ctx.lineTo(inner.x, inner.y);
                                ctx.stroke();
                            }
                            prevOuter = outer;
                            prevInner = inner;
                        }
                    });
                    if (state.sandbox.rayProbe.origin) {
                        ctx.fillStyle = "rgba(114, 232, 255, 0.95)";
                        ctx.beginPath();
                        ctx.arc(state.sandbox.rayProbe.origin.x, state.sandbox.rayProbe.origin.y, 5, 0, Math.PI * 2);
                        ctx.fill();
                    }
                }
                ctx.setLineDash([]);
                ctx.restore();
            }
            if (state.ui.activeTab === "eval" || state.autoplay.liveRunning) {
                drawDiagnosticOverlay(selectedEvalCheck());
            }
        }

        function setSandboxTool(nextTool) {
            state.sandbox.tool = nextTool;
            buildSandboxControls();
            render();
        }

        function countSandboxElements(type) {
            return state.sandbox.elements.filter(function filter(element) { return element && element.type === type; }).length;
        }

        function flippersForRayProbe() {
            return state.sandbox.elements.filter(function filter(element) {
                return element &&
                    element.type === "flipper" &&
                    element.pivot &&
                    Number.isFinite(element.pivot.x) &&
                    Number.isFinite(element.pivot.y) &&
                    Number.isFinite(element.length) &&
                    element.length > 0;
            });
        }

        function flipperArcEnvelope(element, table) {
            const playfield = (table && table.playfield) || {};
            const ballRadius = typeof playfield.ballRadius === "number" ? playfield.ballRadius : 8;
            const thickness = typeof element.thickness === "number" ? element.thickness : 10;
            const rest = typeof element.restAngle === "number" ? element.restAngle : 0;
            const active = typeof element.activeAngle === "number" ? element.activeAngle : rest;
            return {
                id: element.id || "flipper",
                x: element.pivot.x,
                y: element.pivot.y,
                minR: Math.max(6, thickness * 0.45),
                maxR: element.length + ballRadius + thickness,
                from: rest,
                to: active
            };
        }

        function angleInSweep(angle, fromAngle, toAngle) {
            const span = Math.atan2(Math.sin(toAngle - fromAngle), Math.cos(toAngle - fromAngle));
            const rel = Math.atan2(Math.sin(angle - fromAngle), Math.cos(angle - fromAngle));
            if (span >= 0) return rel >= -1e-6 && rel <= span + 1e-6;
            return rel <= 1e-6 && rel >= span - 1e-6;
        }

        function ballIntersectsArc(ball, arc) {
            const dx = ball.x - arc.x;
            const dy = ball.y - arc.y;
            const r = Math.sqrt(dx * dx + dy * dy);
            if (r < arc.minR || r > arc.maxR) return false;
            return angleInSweep(Math.atan2(dy, dx), arc.from, arc.to);
        }

        function spreadRadiansForRay(index, count, spreadDeg) {
            if (count <= 1 || spreadDeg <= 0) return 0;
            const t = index / (count - 1);
            return ((t * 2) - 1) * (spreadDeg * Math.PI / 180);
        }

        function runSandboxRayProbe(origin) {
            const flippers = flippersForRayProbe();
            if (!flippers.length) {
                state.sandbox.rayProbe.traces = [];
                state.sandbox.rayProbe.origin = origin;
                state.sandbox.rayProbe.envelopes = [];
                render();
                return;
            }
            const rays = Math.max(1, Math.min(120, Math.round(Number(state.sandbox.rayProbe.raysPerFlipper) || 7)));
            const spreadDeg = Math.max(0, Math.min(80, Number(state.sandbox.rayProbe.spreadDeg) || 0));
            const maxBounces = Math.max(0, Math.min(60, Math.round(Number(state.sandbox.rayProbe.maxBounces) || 0)));
            const speed = Math.max(1, Math.min(40, Number(state.sandbox.rayProbe.speed) || 15));
            const maxTicks = Math.max(60, Math.min(60000, Math.round(Number(state.eval.launchMaxTicks) || 10000)));
            const traces = [];
            const envelopes = [];

            flippers.forEach(function eachFlipper(flipper) {
                const probeSim = Pin.physicsHarness.createSimulation("sandbox", {
                    sandbox: {
                        includeDefaultBounds: includeDefaultSandboxBounds(),
                        playfield: clone(state.sandbox.playfield),
                        physics: clone(state.sandbox.physics),
                        elements: clone(state.sandbox.elements),
                        spawn: clone(state.sandbox.spawn)
                    }
                });
                const arc = flipperArcEnvelope(flipper, probeSim.world && probeSim.world.table);
                envelopes.push(arc);

                for (let i = 0; i < rays; i++) {
                    const sim = Pin.physicsHarness.createSimulation("sandbox", {
                        sandbox: {
                            includeDefaultBounds: includeDefaultSandboxBounds(),
                            playfield: clone(state.sandbox.playfield),
                            physics: clone(state.sandbox.physics),
                            elements: clone(state.sandbox.elements),
                            spawn: clone(state.sandbox.spawn)
                        }
                    });
                    const ballRadius = sim.world && sim.world.table && sim.world.table.playfield ?
                        (sim.world.table.playfield.ballRadius || 8) : 8;
                    const baseAngle = Math.atan2(flipper.pivot.y - origin.y, flipper.pivot.x - origin.x);
                    const angle = baseAngle + spreadRadiansForRay(i, rays, spreadDeg);
                    sim.world.physicsCollisionCount = 0;
                    sim.world.balls = [{
                        x: origin.x,
                        y: origin.y,
                        radius: ballRadius,
                        vx: Math.cos(angle) * speed,
                        vy: Math.sin(angle) * speed,
                        level: 0
                    }];
                    const path = [{ x: origin.x, y: origin.y }];
                    const visited = {};
                    let reached = false;
                    let reason = "";
                    for (let stepIndex = 0; stepIndex < maxTicks; stepIndex++) {
                        sim.step(1);
                        const ball = sim.world.balls[0];
                        if (!ball) { reason = "none"; break; }
                        if (!Number.isFinite(ball.x) || !Number.isFinite(ball.y) || !Number.isFinite(ball.vx) || !Number.isFinite(ball.vy)) { reason = "invalid"; break; }
                        if (stepIndex < 320 || stepIndex % 8 === 0) path.push({ x: ball.x, y: ball.y });
                        if (ballIntersectsArc(ball, arc)) { reached = true; reason = "hit_arc"; path.push({ x: ball.x, y: ball.y }); break; }
                        if ((sim.world.physicsCollisionCount || 0) > maxBounces) { reason = "bounces"; break; }
                        if (ball.drained) { reason = "drained"; break; }
                        const stateKey =
                            Math.round(ball.x / 8) + "|" +
                            Math.round(ball.y / 8) + "|" +
                            Math.round(ball.vx * 10) + "|" +
                            Math.round(ball.vy * 10);
                        visited[stateKey] = (visited[stateKey] || 0) + 1;
                        if (visited[stateKey] >= 6) { reason = "repeat"; break; }
                    }
                    traces.push({
                        flipperId: flipper.id || "flipper",
                        reached: reached,
                        reason: reason,
                        path: path
                    });
                }
            });

            state.sandbox.rayProbe.origin = { x: origin.x, y: origin.y };
            state.sandbox.rayProbe.traces = traces;
            state.sandbox.rayProbe.envelopes = envelopes;
            render();
        }

        function buildSandboxControls() {
            sandboxControls.innerHTML = "";
            if (state.scenarioId !== "sandbox") return;
            sandboxControls.appendChild(create("h2", "", "Sandbox Tools"));
            const toolRow = create("div", "lab-actions");
            [
                { key: "select", label: "Select / Move" },
                { key: "wall", label: "Draw Wall" },
                { key: "spawn", label: "Move Spawn" },
                { key: "rayProbe", label: "Ray Probe" },
                { key: "leftFlipper", label: "Add Left Flipper" },
                { key: "rightFlipper", label: "Add Right Flipper" }
            ].forEach(function each(def) {
                const button = create("button", state.sandbox.tool === def.key ? "active" : "", def.label);
                button.onclick = function chooseTool() { setSandboxTool(def.key); };
                toolRow.appendChild(button);
            });
            sandboxControls.appendChild(toolRow);
            appendSandboxActionButtons();
            const controlState = create("div", "lab-group");
            controlState.appendChild(create("h3", "", "Flipper Controls"));
            controlState.appendChild(create("p", "small", "Use Z/Left Arrow for left flipper, //Right Arrow for right flipper, and Space for launcher."));
            const controlRow = create("div", "lab-actions");
            const leftButton = create("button", state.sandbox.controls.left ? "active" : "", "Left Down");
            leftButton.onmousedown = function leftDown() { state.sandbox.controls.left = true; };
            leftButton.onmouseup = function leftUp() { state.sandbox.controls.left = false; };
            leftButton.onmouseleave = function leftLeave() { state.sandbox.controls.left = false; };
            const rightButton = create("button", state.sandbox.controls.right ? "active" : "", "Right Down");
            rightButton.onmousedown = function rightDown() { state.sandbox.controls.right = true; };
            rightButton.onmouseup = function rightUp() { state.sandbox.controls.right = false; };
            rightButton.onmouseleave = function rightLeave() { state.sandbox.controls.right = false; };
            const launchButton = create("button", state.sandbox.controls.launch ? "active" : "", "Launch Hold");
            launchButton.onmousedown = function launchDown() { state.sandbox.controls.launch = true; };
            launchButton.onmouseup = function launchUp() { state.sandbox.controls.launch = false; };
            launchButton.onmouseleave = function launchLeave() { state.sandbox.controls.launch = false; };
            controlRow.appendChild(leftButton);
            controlRow.appendChild(rightButton);
            controlRow.appendChild(launchButton);
            controlState.appendChild(controlRow);
            controlState.appendChild(create("p", "small", "Walls: " + countSandboxElements("path") + " | Flippers: " + countSandboxElements("flipper")));
            sandboxControls.appendChild(controlState);
            const physicsSection = create("div");
            sandboxControls.appendChild(physicsSection);
            buildSliderGroup(physicsSection, "Sandbox Physics", [
                { key: "gravity", label: "Gravity", min: 0, max: 1.2, step: 0.01 },
                { key: "friction", label: "Friction", min: 0.94, max: 1, step: 0.001 },
                { key: "restitution", label: "Restitution", min: 0, max: 1, step: 0.01 },
                { key: "maxSpeed", label: "Max Speed", min: 1, max: 40, step: 1 }
            ], state.sandbox.physics, rebuildSimulation);
            const spawnSection = create("div");
            sandboxControls.appendChild(spawnSection);
            buildSliderGroup(spawnSection, "Spawn Ball", [
                { key: "radius", label: "Radius", min: 4, max: 18, step: 1 },
                { key: "vx", label: "Initial VX", min: -12, max: 12, step: 0.1 },
                { key: "vy", label: "Initial VY", min: -12, max: 12, step: 0.1 }
            ], state.sandbox.spawn, rebuildSimulation);
            const rayProbeSection = create("div");
            sandboxControls.appendChild(rayProbeSection);
            buildSliderGroup(rayProbeSection, "Ray Probe", [
                { key: "raysPerFlipper", label: "Rays/Flipper", min: 1, max: 120, step: 1 },
                { key: "spreadDeg", label: "Spread Deg", min: 0, max: 80, step: 1 },
                { key: "maxBounces", label: "Max Bounces", min: 0, max: 60, step: 1 },
                { key: "speed", label: "Speed", min: 2, max: 30, step: 0.5 }
            ], state.sandbox.rayProbe, function patchRayProbe() { render(); }, false);
            const rayProbeActions = create("div", "lab-actions");
            const clearProbe = create("button", "", "Clear Rays");
            clearProbe.onclick = function clearRayProbe() {
                state.sandbox.rayProbe.traces = [];
                state.sandbox.rayProbe.origin = null;
                state.sandbox.rayProbe.envelopes = [];
                render();
            };
            rayProbeActions.appendChild(clearProbe);
            rayProbeSection.appendChild(rayProbeActions);
            const launcherSpawnRow = create("div", "lab-actions");
            const launcherSpawnButton = create("button", state.sandbox.spawn.useLauncher ? "active" : "", "Launcher Spawn");
            launcherSpawnButton.onclick = function toggleLauncherSpawn() {
                state.sandbox.spawn.useLauncher = !state.sandbox.spawn.useLauncher;
                rebuildSimulation();
                buildSandboxControls();
            };
            launcherSpawnRow.appendChild(launcherSpawnButton);
            spawnSection.appendChild(launcherSpawnRow);
            const selectedFlipper = getSandboxElement(state.sandbox.selectedElementId);
            if (selectedFlipper && selectedFlipper.type === "flipper") {
                const flipperSection = create("div");
                sandboxControls.appendChild(flipperSection);
                const angleDraft = {
                    restAngleDegrees: round(radToDeg(selectedFlipper.restAngle || 0), 2),
                    activeAngleDegrees: round(radToDeg(selectedFlipper.activeAngle || 0), 2)
                };
                buildSliderGroup(flipperSection, "Selected Flipper Angle", [
                    { key: "restAngleDegrees", label: "Rest Angle", min: -220, max: 220, step: 1 },
                    { key: "activeAngleDegrees", label: "Active Angle", min: -220, max: 220, step: 1 }
                ], angleDraft, function patchFlipperAngles() {
                    selectedFlipper.restAngle = degToRad(angleDraft.restAngleDegrees);
                    selectedFlipper.activeAngle = degToRad(angleDraft.activeAngleDegrees);
                    rebuildSimulation();
                });
                buildSliderGroup(flipperSection, "Selected Flipper", [
                    { key: "length", label: "Length", min: 40, max: 150, step: 1 },
                    { key: "flipSpeed", label: "Flip Speed", min: 4, max: 40, step: 1 },
                    { key: "flipAccel", label: "Flip Accel", min: 20, max: 600, step: 5 },
                    { key: "returnSpeed", label: "Return Speed", min: 4, max: 40, step: 1 },
                    { key: "returnAccel", label: "Return Accel", min: 20, max: 600, step: 5 },
                    { key: "rootRadius", label: "Root Radius", min: 4, max: 40, step: 0.5 },
                    { key: "tipRadius", label: "Tip Radius", min: 3, max: 30, step: 0.5 },
                    { key: "strikeBoost", label: "Strike Boost", min: 0, max: 6, step: 0.05 },
                    { key: "surfaceRestitution", label: "Surface Restitution", min: 0, max: 2, step: 0.01 },
                    { key: "surfaceFriction", label: "Surface Friction", min: 0, max: 4, step: 0.05 }
                ], selectedFlipper, rebuildSimulation);
                const selectedActions = create("div", "lab-actions");
                const deleteSelected = create("button", "", "Delete Selected");
                deleteSelected.onclick = deleteSelectedSandboxElement;
                selectedActions.appendChild(deleteSelected);
                sandboxControls.appendChild(selectedActions);
            } else {
                sandboxControls.appendChild(create("p", "small", "Select a flipper to tune its physics."));
            }
            sandboxControls.appendChild(create("p", "small", "Drag on the playfield to add a wall. Use Move Spawn to drag the drop position. Click to place flippers at a pivot point."));
        }

        function appendSandboxActionButtons() {
            const row = create("div", "lab-actions");
            const undoElement = create("button", "", "Undo Last");
            undoElement.onclick = function popElement() {
                state.sandbox.elements.pop();
                rebuildSimulation();
                buildSandboxControls();
            };
            const clearWalls = create("button", "", "Clear Walls");
            clearWalls.onclick = function clearWallsClick() {
                state.sandbox.elements = state.sandbox.elements.filter(function keep(element) {
                    return !(element && element.type === "path");
                });
                rebuildSimulation();
                buildSandboxControls();
            };
            const clearFlippers = create("button", "", "Clear Flippers");
            clearFlippers.onclick = function clearFlippersClick() {
                state.sandbox.elements = state.sandbox.elements.filter(function keep(element) {
                    return !(element && element.type === "flipper");
                });
                rebuildSimulation();
                buildSandboxControls();
            };
            const respawn = create("button", "", "Respawn Ball");
            respawn.onclick = function respawnBall() {
                rebuildSimulation();
            };
            const deleteSelected = create("button", "", "Delete Selected");
            deleteSelected.disabled = !state.sandbox.selectedElementId;
            deleteSelected.onclick = deleteSelectedSandboxElement;
            row.appendChild(undoElement);
            row.appendChild(clearWalls);
            row.appendChild(clearFlippers);
            row.appendChild(respawn);
            row.appendChild(deleteSelected);
            sandboxControls.appendChild(row);
        }

        function reloadControls() {
            const scenario = scenarioById(state.scenarioId);
            buildScenarioInfo(scenario);
            if (state.scenarioId === "sandbox") {
                scenarioControls.innerHTML = "";
                tuningControls.innerHTML = "";
                if (state.ui.activeTab === "tune") setActiveTab("sandbox");
            } else {
                buildSliderGroup(scenarioControls, "Scenario Inputs", scenario.params, state.inputs, rebuildSimulation);
                buildSliderGroup(tuningControls, "Flipper Tuning", Pin.physicsHarness.tuningFields, state.tuning, rebuildSimulation);
                if (state.ui.activeTab === "sandbox") setActiveTab("tune");
            }
            buildSandboxControls();
            state.runtime.dirty = true;
        }

        scenarioSelect.onchange = function onScenarioChange() {
            state.scenarioId = scenarioSelect.value;
            state.inputs = initialInputs(scenarioById(state.scenarioId));
            reloadControls();
            rebuildSimulation();
        };
        playPause.onclick = function togglePlay() {
            state.playing = !state.playing;
            playPause.textContent = state.playing ? "Pause" : "Play";
            state.runtime.dirty = true;
        };
        restart.onclick = function restartSimulation() {
            rebuildSimulation();
            state.playing = true;
            playPause.textContent = "Pause";
            state.runtime.dirty = true;
        };
        step.onclick = function singleStep() {
            if (state.scenarioId === "sandbox") {
                applySandboxControlsToWorld();
            }
            state.sim.step(1);
            render();
            refreshMetrics();
        };
        copy.onclick = function copyJson() {
            const text = JSON.stringify(state.sim.toFragment(), null, 2);
            exportBox.value = text;
            if (navigator.clipboard && navigator.clipboard.writeText) {
                navigator.clipboard.writeText(text);
            } else {
                exportBox.select();
                document.execCommand("copy");
            }
            state.runtime.dirty = true;
        };
        perfToggle.onclick = function togglePerf() {
            state.runtime.perfEnabled = !state.runtime.perfEnabled;
            perfToggle.textContent = state.runtime.perfEnabled ? "Perf On" : "Perf Off";
            perfToggle.className = state.runtime.perfEnabled ? "active" : "";
            perfText.textContent = state.runtime.perfEnabled ? perfText.textContent : "Perf off";
            state.runtime.dirty = true;
        };
        loadTableButton.onclick = function loadEvalTableClick() {
            loadEvalTable(evalTableSelect.value);
        };
        runSelectedEvalButton.onclick = function runSelectedEvalClick() {
            runTableEvaluation(selectedEvalRunCheckIds(), "selected");
        };
        runAllEvalButton.onclick = function runAllEvalClick() {
            runTableEvaluation(null, "all");
        };
        autoplayLiveStartButton.onclick = function autoplayLiveStart() {
            startLiveAutoplay("heuristic");
        };
        autoplayNeuralStartButton.onclick = function autoplayNeuralStart() {
            startLiveAutoplay("neural");
        };
        autoplayNeuralTrainButton.onclick = function autoplayNeuralTrain() {
            trainNeuralAutoplay();
        };
        autoplayCompareButton.onclick = function autoplayCompareRuns() {
            runAutoplayCompare();
        };
        autoplayCollectToggleButton.onclick = function toggleLiveCollect() {
            state.autoplay.training.liveCollectEnabled = !state.autoplay.training.liveCollectEnabled;
            autoplayCollectToggleButton.className = state.autoplay.training.liveCollectEnabled ? "active" : "";
            autoplayCollectToggleButton.textContent = state.autoplay.training.liveCollectEnabled ? "Collect Live On" : "Collect Live Off";
            refreshNeuralPanel();
        };
        autoplayLiveStopButton.onclick = function autoplayLiveStop() {
            stopLiveAutoplay();
        };
        autoplayLiveStopButton.disabled = true;
        autoplayNeuralStartButton.disabled = !state.autoplay.neuralModel;
        autoplayCompareButton.disabled = !state.autoplay.neuralModel;
        autoplayCollectToggleButton.className = state.autoplay.training.liveCollectEnabled ? "active" : "";
        autoplayCollectToggleButton.textContent = state.autoplay.training.liveCollectEnabled ? "Collect Live On" : "Collect Live Off";
        evalSelectAllButton.onclick = function selectAllEvalChecks() {
            (state.eval.runChecks || []).forEach(function each(check) {
                if (!check || typeof check.id !== "string") return;
                state.eval.selectedChecks[check.id] = true;
            });
            renderEvalRunChecksList();
        };
        evalClearAllButton.onclick = function clearAllEvalChecks() {
            (state.eval.runChecks || []).forEach(function each(check) {
                if (!check || typeof check.id !== "string") return;
                state.eval.selectedChecks[check.id] = false;
            });
            renderEvalRunChecksList();
        };
        aiStepBtn.onclick = function runAiStep() {
            state.aiLab.autoEnabled = false;
            state.aiLab.batchEnabled = false;
            aiAutoBtn.textContent = "Auto Off";
            aiBatchBtn.textContent = "Batch Off";
            aiLabRunLoop();
        };
        aiProviderRefreshBtn.onclick = function refreshAiProvider() {
            aiLabRefreshProviderStatus(true);
        };
        aiProviderModelsBtn.onclick = function loadAiModels() {
            aiLabFetchModels();
        };
        aiModelSelect.onchange = function onAiModelSelectChange() {
            const picked = String(aiModelSelect.value || "").trim();
            if (!picked) return;
            aiModelInput.value = picked;
            aiLabPersistModelOnly(picked);
            state.runtime.dirty = true;
        };
        aiModelInput.oninput = function onAiModelInputChange() {
            aiLabPersistModelOnly(aiModelInput.value);
        };
        aiBaseUrlInput.onchange = function onAiBaseUrlChange() {
            aiModelSelect.value = "";
            aiLabFetchModels();
        };
        aiProviderSaveBtn.onclick = function saveAiProvider() {
            const current = aiLabSettings();
            const next = Object.assign({}, current, {
                providerLabel: aiLabReadProviderDraft().providerLabel,
                baseUrl: aiLabReadProviderDraft().baseUrl,
                model: aiLabReadProviderDraft().model,
                apiKey: aiLabReadProviderDraft().apiKey
            });
            if (!aiLabWriteSettings(next)) {
                aiLabSetStatus("Failed to persist provider settings.", "fail");
                return;
            }
            aiLabSetStatus("Provider settings saved to local storage.", "pass");
            aiLabRefreshProviderStatus(false);
        };
        aiProviderClearBtn.onclick = function clearAiProvider() {
            const current = aiLabSettings();
            const next = Object.assign({}, current, {
                providerLabel: "",
                baseUrl: "",
                model: "",
                apiKey: ""
            });
            if (!aiLabWriteSettings(next)) {
                aiLabSetStatus("Failed to clear provider settings.", "fail");
                return;
            }
            aiLabPopulateSettingsForm();
            aiLabSetStatus("Provider settings cleared.", "warn");
            aiLabRefreshProviderStatus(false);
        };
        aiAutoBtn.onclick = function toggleAutoMode() {
            state.aiLab.autoEnabled = !state.aiLab.autoEnabled;
            if (state.aiLab.autoEnabled) state.aiLab.batchEnabled = false;
            aiAutoBtn.textContent = state.aiLab.autoEnabled ? "Auto On" : "Auto Off";
            aiBatchBtn.textContent = "Batch Off";
            aiLabSetStatus(state.aiLab.autoEnabled ? "Auto mode enabled." : "Auto mode disabled.", "warn");
            if (state.aiLab.autoEnabled) aiLabRunLoop();
        };
        aiBatchBtn.onclick = function toggleBatchMode() {
            state.aiLab.batchEnabled = !state.aiLab.batchEnabled;
            if (state.aiLab.batchEnabled) state.aiLab.autoEnabled = false;
            aiBatchBtn.textContent = state.aiLab.batchEnabled ? "Batch On" : "Batch Off";
            aiAutoBtn.textContent = "Auto Off";
            aiLabSetStatus(state.aiLab.batchEnabled ? "Batch mode enabled." : "Batch mode disabled.", "warn");
            if (state.aiLab.batchEnabled) aiLabRunLoop();
        };
        aiApplyBtn.onclick = function applyAiPending() {
            aiLabApplyPending();
        };
        aiRejectBtn.onclick = function rejectAiPending() {
            aiLabRejectSelected();
        };
        aiCheckpointBtn.onclick = function checkpointAiTable() {
            aiLabCheckpoint();
        };
        aiRollbackBtn.onclick = function rollbackAiTable() {
            aiLabRollback();
        };
        aiStopFailBtn.onclick = function toggleStopOnFail() {
            state.aiLab.stopOnFail = !state.aiLab.stopOnFail;
            aiStopFailBtn.className = state.aiLab.stopOnFail ? "active" : "";
        };
        aiStopWarnBtn.onclick = function toggleStopOnWarn() {
            state.aiLab.stopOnWarn = !state.aiLab.stopOnWarn;
            aiStopWarnBtn.className = state.aiLab.stopOnWarn ? "active" : "";
        };
        aiManualApplyBtn.onclick = function toggleManualApply() {
            state.aiLab.requireManualApply = !state.aiLab.requireManualApply;
            aiManualApplyBtn.className = state.aiLab.requireManualApply ? "active" : "";
        };
        aiMaxAttemptsInput.onchange = function onAiMaxAttemptsChange() {
            const next = Math.round(Number(aiMaxAttemptsInput.value));
            state.aiLab.maxAttempts = Number.isFinite(next) ? clamp(next, 1, 60) : 6;
            aiMaxAttemptsInput.value = String(state.aiLab.maxAttempts);
        };
        aiPrompt.oninput = function onAiPromptInput() {
            state.aiLab.prompt = aiPrompt.value;
        };
        navSelector.onclick = function openSelectorRoute() { openMainRoute("tables"); };
        navPlay.onclick = function openPlayRoute() { openMainRoute("play"); };
        navDesign.onclick = function openDesignRoute() { openMainRoute("design"); };
        navLogic.onclick = function openLogicRoute() { openMainRoute("logic"); };
        launchRayInput.onchange = function onLaunchRayCountChange() {
            const next = Math.round(Number(launchRayInput.value));
            state.eval.launchRayCount = Number.isFinite(next) ? clamp(next, 1, 500) : 5;
            launchRayInput.value = String(state.eval.launchRayCount);
            if (state.eval.report && selectedEvalRunCheckIds().length) runTableEvaluation(selectedEvalRunCheckIds(), "selected");
        };
        launchCollisionInput.onchange = function onLaunchCollisionLimitChange() {
            const next = Math.round(Number(launchCollisionInput.value));
            state.eval.launchMaxCollisions = Number.isFinite(next) ? clamp(next, 1, 5000) : 400;
            launchCollisionInput.value = String(state.eval.launchMaxCollisions);
            if (state.eval.report && selectedEvalRunCheckIds().length) runTableEvaluation(selectedEvalRunCheckIds(), "selected");
        };
        launchTickInput.onchange = function onLaunchTickLimitChange() {
            const next = Math.round(Number(launchTickInput.value));
            state.eval.launchMaxTicks = Number.isFinite(next) ? clamp(next, 60, 60000) : 10000;
            launchTickInput.value = String(state.eval.launchMaxTicks);
            if (state.eval.report && selectedEvalRunCheckIds().length) runTableEvaluation(selectedEvalRunCheckIds(), "selected");
        };
        targetRayInput.onchange = function onTargetRayCountChange() {
            const next = Math.round(Number(targetRayInput.value));
            state.eval.targetRayCount = Number.isFinite(next) ? clamp(next, 1, 120) : 7;
            targetRayInput.value = String(state.eval.targetRayCount);
            if (state.eval.report && selectedEvalRunCheckIds().length) runTableEvaluation(selectedEvalRunCheckIds(), "selected");
        };
        targetBounceInput.onchange = function onTargetBounceLimitChange() {
            const next = Math.round(Number(targetBounceInput.value));
            state.eval.targetMaxBounces = Number.isFinite(next) ? clamp(next, 0, 60) : 5;
            targetBounceInput.value = String(state.eval.targetMaxBounces);
            if (state.eval.report && selectedEvalRunCheckIds().length) runTableEvaluation(selectedEvalRunCheckIds(), "selected");
        };
        accessibilityModeSelect.onchange = function onAccessibilityModeChange() {
            const next = String(accessibilityModeSelect.value || "geometric").toLowerCase();
            state.eval.accessibilityRayMode = next === "physics" ? "physics" : "geometric";
            accessibilityModeSelect.value = state.eval.accessibilityRayMode;
            if (state.eval.report && selectedEvalRunCheckIds().length) runTableEvaluation(selectedEvalRunCheckIds(), "selected");
        };
        accessibilityBreadthInput.onchange = function onAccessibilityBreadthChange() {
            const next = Math.round(Number(accessibilityBreadthInput.value));
            state.eval.accessibilityBranchRays = Number.isFinite(next) ? clamp(next, 1, 64) : 16;
            accessibilityBreadthInput.value = String(state.eval.accessibilityBranchRays);
            if (state.eval.report && selectedEvalRunCheckIds().length) runTableEvaluation(selectedEvalRunCheckIds(), "selected");
        };
        accessibilityDepthInput.onchange = function onAccessibilityDepthChange() {
            const next = Math.round(Number(accessibilityDepthInput.value));
            state.eval.accessibilityMaxDepth = Number.isFinite(next) ? clamp(next, 0, 8) : 3;
            accessibilityDepthInput.value = String(state.eval.accessibilityMaxDepth);
            if (state.eval.report && selectedEvalRunCheckIds().length) runTableEvaluation(selectedEvalRunCheckIds(), "selected");
        };
        accessibilityResolutionInput.onchange = function onAccessibilityResolutionChange() {
            const next = Math.round(Number(accessibilityResolutionInput.value));
            state.eval.accessibilityCellSize = Number.isFinite(next) ? clamp(next, 8, 128) : 32;
            accessibilityResolutionInput.value = String(state.eval.accessibilityCellSize);
            if (state.eval.report && selectedEvalRunCheckIds().length) runTableEvaluation(selectedEvalRunCheckIds(), "selected");
        };
        accessibilitySpeedInput.onchange = function onAccessibilitySpeedChange() {
            const next = Number(accessibilitySpeedInput.value);
            state.eval.accessibilityRaySpeed = Number.isFinite(next) ? clamp(next, 1, 60) : 15;
            accessibilitySpeedInput.value = String(state.eval.accessibilityRaySpeed);
            if (state.eval.report && selectedEvalRunCheckIds().length) runTableEvaluation(selectedEvalRunCheckIds(), "selected");
        };
        accessibilityTicksInput.onchange = function onAccessibilityTicksChange() {
            const next = Math.round(Number(accessibilityTicksInput.value));
            state.eval.accessibilityMaxTicks = Number.isFinite(next) ? clamp(next, 60, 20000) : 420;
            accessibilityTicksInput.value = String(state.eval.accessibilityMaxTicks);
            if (state.eval.report && selectedEvalRunCheckIds().length) runTableEvaluation(selectedEvalRunCheckIds(), "selected");
        };
        accessibilityContactsInput.onchange = function onAccessibilityContactsChange() {
            const next = Math.round(Number(accessibilityContactsInput.value));
            state.eval.accessibilityMaxCollisions = Number.isFinite(next) ? clamp(next, 1, 5000) : 1;
            accessibilityContactsInput.value = String(state.eval.accessibilityMaxCollisions);
            if (state.eval.report && selectedEvalRunCheckIds().length) runTableEvaluation(selectedEvalRunCheckIds(), "selected");
        };
        autoplayBallInput.onchange = function onAutoplayBallCountChange() {
            const next = Math.round(Number(autoplayBallInput.value));
            state.eval.autoplayBallCount = Number.isFinite(next) ? clamp(next, 1, 64) : 5;
            autoplayBallInput.value = String(state.eval.autoplayBallCount);
        };
        autoplayTickInput.onchange = function onAutoplayTicksChange() {
            const next = Math.round(Number(autoplayTickInput.value));
            state.eval.autoplayMaxTicksPerBall = Number.isFinite(next) ? clamp(next, 120, 120000) : 12000;
            autoplayTickInput.value = String(state.eval.autoplayMaxTicksPerBall);
        };
        autoplayTargetIntervalInput.onchange = function onAutoplayTargetIntervalChange() {
            const next = Math.round(Number(autoplayTargetIntervalInput.value));
            state.eval.autoplayTargetingIntervalTicks = Number.isFinite(next) ? clamp(next, 1, 120) : 8;
            autoplayTargetIntervalInput.value = String(state.eval.autoplayTargetingIntervalTicks);
        };
        autoplayCellSizeInput.onchange = function onAutoplayCellSizeChange() {
            const next = Math.round(Number(autoplayCellSizeInput.value));
            state.eval.autoplayCellSize = Number.isFinite(next) ? clamp(next, 8, 128) : 24;
            autoplayCellSizeInput.value = String(state.eval.autoplayCellSize);
        };
        autoplayMinScoreInput.onchange = function onAutoplayMinScoreChange() {
            const next = Math.round(Number(autoplayMinScoreInput.value));
            state.eval.autoplayMinScore = Number.isFinite(next) ? clamp(next, 0, 1000000000) : 0;
            autoplayMinScoreInput.value = String(state.eval.autoplayMinScore);
        };
        neuralTrainBallsInput.onchange = function onNeuralTrainBallsChange() {
            const next = Math.round(Number(neuralTrainBallsInput.value));
            state.autoplay.neuralTrainingBalls = Number.isFinite(next) ? clamp(next, 1, 64) : 10;
            neuralTrainBallsInput.value = String(state.autoplay.neuralTrainingBalls);
        };
        neuralTrainSamplesInput.onchange = function onNeuralMaxSamplesChange() {
            const next = Math.round(Number(neuralTrainSamplesInput.value));
            state.autoplay.neuralMaxSamples = Number.isFinite(next) ? clamp(next, 200, 20000) : 3000;
            neuralTrainSamplesInput.value = String(state.autoplay.neuralMaxSamples);
        };
        neuralTrainEpochInput.onchange = function onNeuralEpochsChange() {
            const next = Math.round(Number(neuralTrainEpochInput.value));
            state.autoplay.neuralEpochs = Number.isFinite(next) ? clamp(next, 1, 24) : 4;
            neuralTrainEpochInput.value = String(state.autoplay.neuralEpochs);
        };
        neuralHiddenSizeInput.onchange = function onNeuralHiddenSizeChange() {
            const next = Math.round(Number(neuralHiddenSizeInput.value));
            state.autoplay.neuralHiddenSize = Number.isFinite(next) ? clamp(next, 4, 64) : 12;
            neuralHiddenSizeInput.value = String(state.autoplay.neuralHiddenSize);
            refreshBrainPanel();
        };
        evalTableSelect.onchange = function onEvalTableChange() {
            state.eval.selectedRef = evalTableSelect.value;
        };

        scenarioSelect.value = state.scenarioId;
        buildTableSelect();
        renderEvalRunChecksList();
        renderEvalReport(null);
        refreshNeuralPanel();
        renderAiAttempts();
        aiLabPopulateSettingsForm();
        aiLabRefreshProviderStatus(false);
        const handoffLoaded = consumeDesignerHandoff();
        const forceSandboxFromHash = /(^|[&#])sandbox($|[=&])/i.test(String(location.hash || ""));
        if (!handoffLoaded && forceSandboxFromHash) {
            state.scenarioId = "sandbox";
            scenarioSelect.value = "sandbox";
            setActiveTab("sandbox");
        } else if (!handoffLoaded) {
            setActiveTab(state.scenarioId === "sandbox" ? "sandbox" : "tune");
        }
        reloadControls();
        rebuildSimulation();

        function addSandboxFlipper(side, point) {
            state.sandbox.elements.push(normalizeSandboxFlipper(Pin.physicsHarness.createSandboxFlipper(side, point, state.tuning)));
            rebuildSimulation();
            buildSandboxControls();
        }

        canvas.onmousedown = function onMouseDown(event) {
            if (state.scenarioId !== "sandbox") return;
            const point = canvasPoint(event);
            if (state.sandbox.tool === "select") {
                const picked = pickSandboxElement(point);
                state.sandbox.selectedElementId = picked ? picked.element.id : "";
                if (picked) {
                    normalizeSandboxFlipper(picked.element);
                    if (picked.element.type === "flipper" && picked.mode === "rotate") {
                        state.sandbox.dragSelection = {
                            id: picked.element.id,
                            mode: "rotate",
                            sweep: normalizeAngle((picked.element.activeAngle || 0) - (picked.element.restAngle || 0))
                        };
                    } else if (picked.element.type === "flipper") {
                        state.sandbox.dragSelection = {
                            id: picked.element.id,
                            mode: "pivot",
                            offsetX: point.x - picked.element.pivot.x,
                            offsetY: point.y - picked.element.pivot.y
                        };
                    } else if (picked.element.type === "path" && picked.element.anchors && picked.element.anchors.length >= 2) {
                        state.sandbox.dragSelection = {
                            id: picked.element.id,
                            mode: "path",
                            startPoint: point,
                            anchors: clone(picked.element.anchors)
                        };
                    }
                } else {
                    state.sandbox.dragSelection = null;
                }
                buildSandboxControls();
                render();
                return;
            }
            if (state.sandbox.tool === "wall") {
                state.sandbox.draftWall = { x1: point.x, y1: point.y, x2: point.x, y2: point.y };
                render();
                return;
            }
            if (state.sandbox.tool === "spawn" && distance(point, state.sandbox.spawn) <= 18) {
                state.sandbox.draggingSpawn = true;
            }
        };
        canvas.onmousemove = function onMouseMove(event) {
            const point = canvasPoint(event);
            if (state.scenarioId !== "sandbox") return;
            if (state.sandbox.dragSelection) {
                const selected = getSandboxElement(state.sandbox.dragSelection.id);
                if (!selected) return;
                if (state.sandbox.dragSelection.mode === "pivot") {
                    selected.pivot.x = point.x - state.sandbox.dragSelection.offsetX;
                    selected.pivot.y = point.y - state.sandbox.dragSelection.offsetY;
                } else if (state.sandbox.dragSelection.mode === "rotate") {
                    const base = Math.atan2(point.y - selected.pivot.y, point.x - selected.pivot.x);
                    selected.restAngle = base;
                    selected.activeAngle = base + state.sandbox.dragSelection.sweep;
                } else if (state.sandbox.dragSelection.mode === "path") {
                    const dx = point.x - state.sandbox.dragSelection.startPoint.x;
                    const dy = point.y - state.sandbox.dragSelection.startPoint.y;
                    selected.anchors[0].x = state.sandbox.dragSelection.anchors[0].x + dx;
                    selected.anchors[0].y = state.sandbox.dragSelection.anchors[0].y + dy;
                    selected.anchors[1].x = state.sandbox.dragSelection.anchors[1].x + dx;
                    selected.anchors[1].y = state.sandbox.dragSelection.anchors[1].y + dy;
                }
                rebuildSimulation();
                return;
            }
            if (state.sandbox.draggingSpawn) {
                state.sandbox.spawn.x = point.x;
                state.sandbox.spawn.y = point.y;
                render();
                return;
            }
            if (!state.sandbox.draftWall) return;
            state.sandbox.draftWall.x2 = point.x;
            state.sandbox.draftWall.y2 = point.y;
            render();
        };
        canvas.onmouseup = function onMouseUp(event) {
            if (state.scenarioId !== "sandbox") return;
            const point = canvasPoint(event);
            if (state.sandbox.dragSelection) {
                state.sandbox.dragSelection = null;
                rebuildSimulation();
                buildSandboxControls();
                return;
            }
            if (state.sandbox.draggingSpawn) {
                state.sandbox.draggingSpawn = false;
                state.sandbox.spawn.x = point.x;
                state.sandbox.spawn.y = point.y;
                rebuildSimulation();
                return;
            }
            if (!state.sandbox.draftWall) return;
            const wall = state.sandbox.draftWall;
            state.sandbox.draftWall = null;
            const dx = wall.x2 - wall.x1;
            const dy = wall.y2 - wall.y1;
            if (Math.sqrt(dx * dx + dy * dy) >= 8) {
                state.sandbox.elements.push({
                    id: sandboxWallId(),
                    type: "path",
                    role: "wall",
                    thickness: 6,
                    anchors: [{ x: wall.x1, y: wall.y1 }, { x: wall.x2, y: wall.y2 }]
                });
                rebuildSimulation();
                buildSandboxControls();
            } else {
                render();
            }
        };
        canvas.onclick = function onCanvasClick(event) {
            if (state.scenarioId !== "sandbox") return;
            const point = canvasPoint(event);
            if (state.sandbox.tool === "leftFlipper") {
                addSandboxFlipper("left", point);
                state.sandbox.selectedElementId = state.sandbox.elements[state.sandbox.elements.length - 1].id;
                buildSandboxControls();
            } else if (state.sandbox.tool === "rightFlipper") {
                addSandboxFlipper("right", point);
                state.sandbox.selectedElementId = state.sandbox.elements[state.sandbox.elements.length - 1].id;
                buildSandboxControls();
            } else if (state.sandbox.tool === "rayProbe") {
                runSandboxRayProbe(point);
            }
        };
        canvas.onmouseleave = function onMouseLeave() {
            if (state.scenarioId === "sandbox") {
                state.sandbox.draggingSpawn = false;
                state.sandbox.dragSelection = null;
                if (state.sandbox.draftWall) render();
            }
        };

        window.addEventListener("keydown", function onKeyDown(event) {
            if (state.scenarioId !== "sandbox") return;
            const tag = event.target && event.target.tagName ? event.target.tagName.toLowerCase() : "";
            if (tag === "input" || tag === "textarea" || tag === "select") return;
            if (event.key === "z" || event.key === "Z" || event.key === "ArrowLeft") {
                state.sandbox.controls.left = true;
            }
            if (event.key === "/" || event.key === "ArrowRight") {
                state.sandbox.controls.right = true;
            }
            if (event.key === " " || event.code === "Space") {
                event.preventDefault();
                state.sandbox.controls.launch = true;
            }
            if (event.key === "Delete" || event.key === "Backspace") {
                event.preventDefault();
                deleteSelectedSandboxElement();
            }
        });
        window.addEventListener("keyup", function onKeyUp(event) {
            if (state.scenarioId !== "sandbox") return;
            if (event.key === "z" || event.key === "Z" || event.key === "ArrowLeft") {
                state.sandbox.controls.left = false;
            }
            if (event.key === "/" || event.key === "ArrowRight") {
                state.sandbox.controls.right = false;
            }
            if (event.key === " " || event.code === "Space") {
                event.preventDefault();
                state.sandbox.controls.launch = false;
            }
        });

        function frame() {
            if (document.hidden) {
                requestAnimationFrame(frame);
                return;
            }
            const frameStart = performance.now ? performance.now() : Date.now();
            let renderMs = 0;
            let metricsMs = 0;
                if (state.playing && !state.sim.done) {
                    if (state.scenarioId === "sandbox") {
                        if (state.autoplay.liveRunning && state.autoplay.liveController && state.sim && state.sim.world) {
                            const autoControls = state.autoplay.liveController.update();
                            const liveTarget = state.autoplay.liveController && typeof state.autoplay.liveController.getTarget === "function"
                                ? state.autoplay.liveController.getTarget()
                                : null;
                            if (state.autoplay.training.liveCollectEnabled) {
                                recordShotAttempt(state.sim.world, autoControls, liveTarget);
                            }
                            if (state.autoplay.liveMode === "heuristic" &&
                                state.autoplay.training.liveCollectEnabled &&
                                Pin.tableAutoplayLearning &&
                                typeof Pin.tableAutoplayLearning.extractFeatures === "function") {
                                const features = Pin.tableAutoplayLearning.extractFeatures(state.sim.world, { target: liveTarget });
                                const action = pickTrainingActionFromControls(autoControls);
                                const entry = { features: features, action: action };
                                state.autoplay.training.liveSamples.push(entry);
                                if (action !== "none") state.autoplay.training.liveActionSamples += 1;
                                if (features && features.length >= 4) {
                                    const preview = {
                                        action: action,
                                        ballX: features[0],
                                        ballY: features[1],
                                        vx: features[2],
                                        vy: features[3]
                                    };
                                    state.autoplay.training.recentLiveSamples.push(preview);
                                    if (state.autoplay.training.recentLiveSamples.length > 12) state.autoplay.training.recentLiveSamples.shift();
                                }
                                const maxLive = 20000;
                                if (state.autoplay.training.liveSamples.length > maxLive) {
                                    state.autoplay.training.liveSamples.splice(0, state.autoplay.training.liveSamples.length - maxLive);
                                }
                                if (state.autoplay.training.liveSamples.length % 120 === 0) {
                                    state.autoplay.training.rawTotal = state.autoplay.training.liveSamples.length;
                                    refreshNeuralPanel();
                                }
                            }
                            state.sandbox.controls.left = !!autoControls.left;
                            state.sandbox.controls.right = !!autoControls.right;
                            state.sandbox.controls.launch = !!autoControls.launch;
                            autoplayLiveStatus.textContent = "Autoplay live: running.";
                        }
                    applySandboxControlsToWorld();
                }
                state.sim.step(2);
                if (state.autoplay.liveRunning && state.autoplay.training.liveCollectEnabled && state.sim && state.sim.world) {
                    attributeShotOutcomes(state.sim.world, state.sim.world.lastProcessedEvents || []);
                }
                if (state.autoplay.liveRunning && state.sim && state.sim.world) {
                    const liveBall = state.sim.world.balls && state.sim.world.balls[0] ? state.sim.world.balls[0] : null;
                    if (liveBall && Number.isFinite(liveBall.x) && Number.isFinite(liveBall.y)) {
                        const inLane = !!liveBall.inLaunchLane;
                        if (!inLane && state.autoplay.liveWasInLaunchLane) {
                            state.autoplay.liveServeIndex += 1;
                            state.autoplay.livePath = [];
                            state.autoplay.liveTrajectories.push({
                                label: "live_ball_" + state.autoplay.liveServeIndex,
                                status: "warn",
                                path: state.autoplay.livePath
                            });
                            if (state.autoplay.liveTrajectories.length > 10) state.autoplay.liveTrajectories.shift();
                        }
                        if (!state.autoplay.liveTrajectories.length) {
                            state.autoplay.liveServeIndex = 1;
                            state.autoplay.livePath = [];
                            state.autoplay.liveTrajectories.push({
                                label: "live_ball_1",
                                status: "warn",
                                path: state.autoplay.livePath
                            });
                        }
                        state.autoplay.liveWasInLaunchLane = inLane;
                        stampLiveAutoplayHeatmap(liveBall);
                        state.autoplay.liveSampleCounter += 1;
                        if (state.autoplay.livePath.length < 400 || state.autoplay.liveSampleCounter % 4 === 0) {
                            state.autoplay.livePath.push({ x: liveBall.x, y: liveBall.y });
                        }
                        const aimDebug = state.autoplay.liveController && typeof state.autoplay.liveController.getAimDebug === "function" ?
                            state.autoplay.liveController.getAimDebug() : null;
                        if (state.autoplay.liveMode === "neural") state.autoplay.neuralLastDebug = aimDebug || null;
                        const aimSegments = [];
                        const aimLabels = [{ text: (state.autoplay.liveMode === "neural" ? "Neural" : "Heuristic") + " live autoplay sampling", x: 14, y: 20 }];
                        const aimPoints = [];
                        const aimCircles = [];
                        const aimTrajectories = [];
                        if (state.autoplay.liveMode === "neural" && aimDebug && aimDebug.outputs) {
                            aimLabels.push({ text: "policy " + String(aimDebug.action || "none") + " conf " + String(round(aimDebug.confidence || 0, 3)), x: 14, y: 38 });
                            aimLabels.push({ text: "none " + String(round(aimDebug.outputs.none || 0, 3)) + " left " + String(round(aimDebug.outputs.left || 0, 3)) + " right " + String(round(aimDebug.outputs.right || 0, 3)), x: 14, y: 54 });
                            if (aimDebug.controls) {
                                aimLabels.push({
                                    text: "out L/R/Launch " + Number(!!aimDebug.controls.left) + "/" + Number(!!aimDebug.controls.right) + "/" + Number(!!aimDebug.controls.launch) +
                                        " | src " + String(aimDebug.source || "model") + " | pulse " + (aimDebug.pulseLeft || 0) + "/" + (aimDebug.pulseRight || 0),
                                    x: 14,
                                    y: 70
                                });
                            }
                            if (aimDebug.model) {
                                aimLabels.push({
                                    text: "model " + String(aimDebug.model.inputSize || "-") + "->" + String(aimDebug.model.hiddenSize || "-") + "->3",
                                    x: 14,
                                    y: 86
                                });
                            }
                            if (Array.isArray(aimDebug.features) && aimDebug.features.length >= 4) {
                                aimLabels.push({
                                    text: "f bx/by/vx/vy " +
                                        String(round(aimDebug.features[0] || 0, 3)) + "/" +
                                        String(round(aimDebug.features[1] || 0, 3)) + "/" +
                                        String(round(aimDebug.features[2] || 0, 3)) + "/" +
                                        String(round(aimDebug.features[3] || 0, 3)),
                                    x: 14,
                                    y: 102
                                });
                            }
                        }
                        const latestShotSample = state.autoplay.training.recentShotSamples && state.autoplay.training.recentShotSamples.length
                            ? state.autoplay.training.recentShotSamples[state.autoplay.training.recentShotSamples.length - 1]
                            : null;
                        if (latestShotSample) {
                            aimLabels.push({
                                text: "shot " + latestShotSample.side + " -> " + latestShotSample.targetId + " @+" + latestShotSample.ticksAfterFlip + "t",
                                x: 14,
                                y: 118
                            });
                        }
                        if (aimDebug && aimDebug.target && Number.isFinite(aimDebug.target.x) && Number.isFinite(aimDebug.target.y)) {
                            const scheduledAction = aimDebug.scheduled ?
                                (String(aimDebug.chosen || "none") + "@" + String(aimDebug.scheduled.delay || 0) + "/" + String(aimDebug.scheduled.pulse || 0)) :
                                "none";
                            aimPoints.push({
                                x: aimDebug.target.x,
                                y: aimDebug.target.y,
                                fill: "rgba(70, 212, 142, 0.30)",
                                stroke: "rgba(70, 212, 142, 0.96)"
                            });
                            aimCircles.push({
                                x: aimDebug.target.x,
                                y: aimDebug.target.y,
                                r: 18,
                                fill: "rgba(70, 212, 142, 0.10)",
                                stroke: "rgba(70, 212, 142, 0.78)",
                                lineWidth: 1.5
                            });
                            if (Number.isFinite(liveBall.x) && Number.isFinite(liveBall.y)) {
                                aimSegments.push({
                                    x1: liveBall.x,
                                    y1: liveBall.y,
                                    x2: aimDebug.target.x,
                                    y2: aimDebug.target.y,
                                    color: "rgba(70, 212, 142, 0.72)"
                                });
                            }
                            if (Array.isArray(aimDebug.candidates)) {
                                aimDebug.candidates.slice(0, 6).forEach(function eachCandidate(candidate, index) {
                                    if (!candidate || !candidate.end) return;
                                    const chosen = !!candidate.action && candidate.action === scheduledAction;
                                    if (Number.isFinite(candidate.end.x) && Number.isFinite(candidate.end.y) && Number.isFinite(liveBall.x) && Number.isFinite(liveBall.y)) {
                                        aimSegments.push({
                                            x1: liveBall.x,
                                            y1: liveBall.y,
                                            x2: candidate.end.x,
                                            y2: candidate.end.y,
                                            color: chosen ? "rgba(82, 225, 147, 0.95)" : "rgba(255, 188, 94, 0.68)",
                                            lineWidth: chosen ? 2.6 : 1.4
                                        });
                                    }
                                    if (Array.isArray(candidate.path) && candidate.path.length > 1) {
                                        aimTrajectories.push({
                                            label: candidate.action || candidate.mode,
                                            status: chosen ? "pass" : "warn",
                                            path: candidate.path
                                        });
                                    }
                                    aimLabels.push({
                                        text: (candidate.action || candidate.mode) + " score " + String(candidate.score) + " d " + String(candidate.distance) + (candidate.hit ? " hit" : ""),
                                        x: 14,
                                        y: 38 + index * 16
                                    });
                                });
                                aimLabels.push({
                                    text: "phase " + String(aimDebug.phase || "idle") + " | chosen " + String(aimDebug.chosen || "none") + " @ tick " + aimDebug.tick + " | cooldown " + String(aimDebug.cooldownTicks || 0),
                                    x: 14,
                                    y: 138
                                });
                            }
                        }
                        state.eval.liveCheck = {
                            id: "autoplay_heatmap",
                            category: "autoplay",
                            status: "warn",
                            message: "Autoplay live run in progress...",
                            diagnostics: {
                                heatmap: state.autoplay.liveHeatmap,
                                segments: aimSegments,
                                trajectories: state.autoplay.liveTrajectories.map(function map(entry) {
                                    return {
                                        label: entry.label,
                                        status: entry.status,
                                        path: (entry.path || []).slice(-300)
                                    };
                                }).concat(aimTrajectories.slice(0, 4)),
                                labels: aimLabels,
                                points: aimPoints,
                                circles: aimCircles
                            }
                        };
                        if (state.autoplay.liveMode === "neural") refreshNeuralPanel();
                    } else {
                        autoplayLiveStatus.textContent = "Autoplay live: waiting for ball.";
                    }
                }
                state.runtime.dirty = true;
            }
            if (state.playing || state.runtime.dirty) {
                const renderStart = performance.now ? performance.now() : Date.now();
                render();
                const renderEnd = performance.now ? performance.now() : Date.now();
                renderMs = renderEnd - renderStart;
                state.runtime.dirty = false;
            }
            const now = performance.now ? performance.now() : Date.now();
            if (now - state.runtime.lastMetricsRefreshMs >= state.runtime.metricsRefreshIntervalMs) {
                state.runtime.lastMetricsRefreshMs = now;
                const metricsStart = performance.now ? performance.now() : Date.now();
                refreshMetrics();
                const metricsEnd = performance.now ? performance.now() : Date.now();
                metricsMs = metricsEnd - metricsStart;
                if (state.runtime.perfEnabled) {
                    state.runtime.perfFrameMs = now - frameStart;
                    state.runtime.perfRenderMs = renderMs;
                    state.runtime.perfMetricsMs = metricsMs;
                    perfText.textContent =
                        "frame " + round(state.runtime.perfFrameMs, 2) + "ms | " +
                        "render " + round(state.runtime.perfRenderMs, 2) + "ms | " +
                        "metrics " + round(state.runtime.perfMetricsMs, 2) + "ms";
                }
            }
            requestAnimationFrame(frame);
        }
        requestAnimationFrame(frame);
    }

    mount();
})(window.Pin);
