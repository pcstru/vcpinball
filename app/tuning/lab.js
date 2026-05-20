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
                launchRayCount: 5,
                launchMaxCollisions: 400,
                launchMaxTicks: 10000,
                targetRayCount: 7,
                targetMaxBounces: 5,
                runId: 0,
                running: false
            },
            aiLab: {
                prompt: "",
                running: false,
                providerChecking: false,
                providerLastCheckedMs: 0,
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
        const tabAi = create("button", "", "AI-Lab");
        tabRow.appendChild(tabTune);
        tabRow.appendChild(tabSandbox);
        tabRow.appendChild(tabEval);
        tabRow.appendChild(tabAi);
        left.appendChild(tabRow);
        const tabBody = create("div", "lab-tab-body");
        left.appendChild(tabBody);
        const tunePanel = create("section", "lab-tab-panel active");
        const sandboxPanel = create("section", "lab-tab-panel");
        const evalPanel = create("section", "lab-tab-panel");
        const aiPanel = create("section", "lab-tab-panel");
        tabBody.appendChild(tunePanel);
        tabBody.appendChild(sandboxPanel);
        tabBody.appendChild(evalPanel);
        tabBody.appendChild(aiPanel);

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

        right.appendChild(create("h2", "", "Metrics"));
        const metricsWrap = create("div", "lab-group");
        const runStateSummary = create("div", "lab-eval-summary");
        runStateSummary.textContent = "No simulation loaded.";
        metricsWrap.appendChild(runStateSummary);
        const metricList = create("div", "lab-metric-list");
        metricsWrap.appendChild(metricList);
        right.appendChild(metricsWrap);

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
        const runEvalButton = create("button", "", "Run Evaluation");
        evalActions.appendChild(loadTableButton);
        evalActions.appendChild(runEvalButton);
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
        const evalSummary = create("div", "lab-eval-summary", "No report yet.");
        const evalProgress = create("div", "lab-progress");
        const evalProgressFill = create("div", "lab-progress-fill");
        evalProgress.appendChild(evalProgressFill);
        const evalChecks = create("div", "lab-eval-checks lab-scroll-list");
        evalWrap.appendChild(evalTableSelect);
        evalWrap.appendChild(evalManifestInfo);
        evalWrap.appendChild(evalActions);
        evalWrap.appendChild(launchRayRow);
        evalWrap.appendChild(launchCollisionRow);
        evalWrap.appendChild(launchTickRow);
        evalWrap.appendChild(targetRayRow);
        evalWrap.appendChild(targetBounceRow);
        evalWrap.appendChild(evalSummary);
        evalWrap.appendChild(evalProgress);
        evalWrap.appendChild(evalChecks);
        evalPanel.appendChild(evalWrap);

        aiPanel.appendChild(create("h2", "", "AI-Lab"));
        aiPanel.appendChild(create("p", "small", "Visibility-first patch loop using shared contract and evaluator runtime."));
        const aiWrap = create("div", "lab-group");
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
                ai: nextTab === "ai"
            };
            tabTune.className = active.tune ? "active" : "";
            tabSandbox.className = active.sandbox ? "active" : "";
            tabEval.className = active.eval ? "active" : "";
            tabAi.className = active.ai ? "active" : "";
            tunePanel.className = "lab-tab-panel" + (active.tune ? " active" : "");
            sandboxPanel.className = "lab-tab-panel" + (active.sandbox ? " active" : "");
            evalPanel.className = "lab-tab-panel" + (active.eval ? " active" : "");
            aiPanel.className = "lab-tab-panel" + (active.ai ? " active" : "");
        }

        tabTune.onclick = function onTuneTabClick() { setActiveTab("tune"); };
        tabSandbox.onclick = function onSandboxTabClick() { setActiveTab("sandbox"); };
        tabEval.onclick = function onEvalTabClick() { setActiveTab("eval"); };
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

        function renderEvalReport(report) {
            if (!report) {
                setEvalStatus("No report yet.");
                setEvalProgress(0, 0);
                evalChecks.innerHTML = "";
                evalReport.value = "";
                setEvalCheckDetail(null);
                state.eval.selectedCheckIndex = -1;
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
                    row.appendChild(create("strong", "", "[" + statusText(check.status) + "] " + check.id));
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

            state.sandbox.physics.gravity = typeof pf.gravity === "number" ? pf.gravity : state.sandbox.physics.gravity;
            state.sandbox.physics.friction = typeof pf.friction === "number" ? pf.friction : state.sandbox.physics.friction;
            state.sandbox.physics.restitution = typeof pf.restitution === "number" ? pf.restitution : state.sandbox.physics.restitution;
            state.sandbox.physics.maxSpeed = typeof pf.maxSpeed === "number" ? pf.maxSpeed : state.sandbox.physics.maxSpeed;

            state.sandbox.spawn.radius = typeof pf.ballRadius === "number" ? pf.ballRadius : state.sandbox.spawn.radius;
            if (launcher && typeof launcher.x === "number" && typeof launcher.top === "number" && typeof launcher.bottom === "number") {
                const laneY = launcher.bottom - 30;
                state.sandbox.spawn.x = launcher.x;
                state.sandbox.spawn.y = clamp(laneY, 40, 840);
                state.sandbox.spawn.useLauncher = true;
            } else {
                state.sandbox.spawn.useLauncher = false;
            }
            state.sandbox.spawn.vx = 0;
            state.sandbox.spawn.vy = 0;

            state.sandbox.elements = clone(table.elements || []).map(normalizeSandboxFlipper);
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
                    state.scenarioId = "sandbox";
                    scenarioSelect.value = "sandbox";
                    setActiveTab("sandbox");
                    state.eval.loadError = "";
                    state.eval.report = null;
                    reloadControls();
                    rebuildSimulation();
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
            runEvalButton.disabled = false;
            runEvalButton.textContent = "Run Evaluation";
            setEvalProgress(1, 1);
            const stuckIndex = report.checks.findIndex(function find(check) {
                return check && check.id === "stuck_launcher_ray";
            });
            state.eval.selectedCheckIndex = stuckIndex >= 0 ? stuckIndex : (report.checks.length ? 0 : -1);
            renderEvalReport(report);
            render();
            console.log("[tableEval]", report);
        }

        function runTableEvaluation() {
            if (!state.eval.selectedTable) {
                setEvalStatus("Load a table before running evaluation.", "warn");
                return;
            }
            if (state.eval.running) return;
            const runId = state.eval.runId + 1;
            state.eval.runId = runId;
            state.eval.running = true;
            runEvalButton.disabled = true;
            runEvalButton.textContent = "Running...";
            evalChecks.innerHTML = "";
            evalReport.value = "";
            setEvalProgress(0, 0);
            setEvalStatus("Starting evaluation...", "warn");

            const options = {
                tableId: state.eval.selectedRef || state.eval.selectedName,
                launchRayCount: state.eval.launchRayCount,
                launchMaxCollisions: state.eval.launchMaxCollisions,
                launchMaxTicks: state.eval.launchMaxTicks,
                targetRayCount: state.eval.targetRayCount,
                targetMaxBounces: state.eval.targetMaxBounces,
                onProgress: function onProgress(progress) {
                    if (runId !== state.eval.runId) return;
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
                    runEvalButton.disabled = false;
                    runEvalButton.textContent = "Run Evaluation";
                    setEvalProgress(0, 0);
                    setEvalStatus("Evaluation failed: " + (error && error.message ? error.message : "Unknown error"), "fail");
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

        function aiLabSetStatus(text, level) {
            state.aiLab.status = text || "";
            aiStatus.textContent = text || "";
            aiStatus.className = "lab-eval-summary" + (level ? " " + level : "");
            state.runtime.dirty = true;
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
            if (result.patchedTable) state.aiLab.pendingPatchedTable = result.patchedTable;
            renderAiAttempts();
            return entry;
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

        function aiLabBuildPrompt(baseTask, feedback) {
            const report = state.eval.report || null;
            const failChecks = aiLabFailedChecks(report).slice(0, 16);
            const context = {
                tableName: state.eval.selectedName || "",
                summary: report && report.summary ? report.summary : null,
                failedChecks: failChecks
            };
            return [
                "Return JSON patch only.",
                "Allowed keys: tablePatch, addElements, patchElements, removeElements, addFeatures, patchFeatures, removeFeatures, logicDocPatch.",
                "Task:",
                baseTask,
                "Context:",
                JSON.stringify(context),
                feedback ? ("Repair previous issues:\n" + feedback) : ""
            ].join("\n");
        }

        function aiLabRequestPatch(prompt) {
            const settings = aiLabSettings();
            const baseUrl = String(settings.baseUrl || "").trim();
            const apiKey = String(settings.apiKey || "").trim();
            const model = String(settings.model || "").trim();
            if (!baseUrl || !apiKey || !model) {
                return Promise.reject(new Error("Missing provider settings in assistant config."));
            }
            const endpoint = /\/chat\/completions\/?$/i.test(baseUrl) ? baseUrl.replace(/\/+$/, "") : (baseUrl.replace(/\/+$/, "") + "/chat/completions");
            return fetch(endpoint, {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    Authorization: "Bearer " + apiKey
                },
                body: JSON.stringify({
                    model: model,
                    temperature: 0.1,
                    messages: [{ role: "user", content: prompt }]
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
                    targetMaxBounces: state.eval.targetMaxBounces
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

            (diagnostics.segments || []).forEach(function each(seg) {
                if (!seg) return;
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
                ctx.beginPath();
                ctx.arc(circle.x, circle.y, circle.r || 8, 0, Math.PI * 2);
                ctx.fill();
                ctx.stroke();
            });
            (diagnostics.points || []).forEach(function each(point) {
                if (!point || typeof point.x !== "number" || typeof point.y !== "number") return;
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

        function rebuildSandboxSimulation() {
            state.sandbox.elements.forEach(normalizeSandboxFlipper);
            state.sim = Pin.physicsHarness.createSimulation("sandbox", {
                sandbox: {
                    physics: clone(state.sandbox.physics),
                    elements: clone(state.sandbox.elements),
                    spawn: clone(state.sandbox.spawn)
                }
            });
            state.sandbox.launchHeldPrev = false;
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
        }

        function render() {
            if (state.eval.selectedTable && state.scenarioId !== "sandbox") {
                try {
                    const previewWorld = createEvalPreviewWorld(state.eval.selectedTable);
                    Pin.render.renderWorld(ctx, previewWorld, { showHud: false, showCabinet: true });
                } catch (error) {
                    Pin.render.renderWorld(ctx, state.sim.world);
                }
            } else {
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
            drawDiagnosticOverlay(selectedEvalCheck());
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
        runEvalButton.onclick = function runEvalClick() {
            runTableEvaluation();
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
        launchRayInput.onchange = function onLaunchRayCountChange() {
            const next = Math.round(Number(launchRayInput.value));
            state.eval.launchRayCount = Number.isFinite(next) ? clamp(next, 1, 500) : 5;
            launchRayInput.value = String(state.eval.launchRayCount);
            if (state.eval.report) runTableEvaluation();
        };
        launchCollisionInput.onchange = function onLaunchCollisionLimitChange() {
            const next = Math.round(Number(launchCollisionInput.value));
            state.eval.launchMaxCollisions = Number.isFinite(next) ? clamp(next, 1, 5000) : 400;
            launchCollisionInput.value = String(state.eval.launchMaxCollisions);
            if (state.eval.report) runTableEvaluation();
        };
        launchTickInput.onchange = function onLaunchTickLimitChange() {
            const next = Math.round(Number(launchTickInput.value));
            state.eval.launchMaxTicks = Number.isFinite(next) ? clamp(next, 60, 60000) : 10000;
            launchTickInput.value = String(state.eval.launchMaxTicks);
            if (state.eval.report) runTableEvaluation();
        };
        targetRayInput.onchange = function onTargetRayCountChange() {
            const next = Math.round(Number(targetRayInput.value));
            state.eval.targetRayCount = Number.isFinite(next) ? clamp(next, 1, 120) : 7;
            targetRayInput.value = String(state.eval.targetRayCount);
            if (state.eval.report) runTableEvaluation();
        };
        targetBounceInput.onchange = function onTargetBounceLimitChange() {
            const next = Math.round(Number(targetBounceInput.value));
            state.eval.targetMaxBounces = Number.isFinite(next) ? clamp(next, 0, 60) : 5;
            targetBounceInput.value = String(state.eval.targetMaxBounces);
            if (state.eval.report) runTableEvaluation();
        };
        evalTableSelect.onchange = function onEvalTableChange() {
            state.eval.selectedRef = evalTableSelect.value;
        };

        scenarioSelect.value = state.scenarioId;
        buildTableSelect();
        renderEvalReport(null);
        renderAiAttempts();
        aiLabRefreshProviderStatus(false);
        setActiveTab(state.scenarioId === "sandbox" ? "sandbox" : "tune");
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
                    applySandboxControlsToWorld();
                }
                state.sim.step(2);
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
