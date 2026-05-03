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
                    vy: 0
                },
                controls: { left: false, right: false }
            }
        };

        const shell = create("div", "lab-shell");
        const left = create("aside", "lab-panel");
        const center = create("main", "lab-canvas-wrap");
        const right = create("aside", "lab-panel right");
        shell.appendChild(left);
        shell.appendChild(center);
        shell.appendChild(right);
        root.appendChild(shell);

        left.appendChild(create("h1", "", "Physics Lab"));
        left.appendChild(create("p", "small", "Use the same flipper scenarios as the regression harness, tune parameters with sliders, then copy a JSON fragment for code updates."));

        const scenarioSelect = create("select", "lab-select");
        Pin.physicsHarness.scenarios.forEach(function each(entry) {
            const opt = document.createElement("option");
            opt.value = entry.id;
            opt.textContent = entry.name;
            scenarioSelect.appendChild(opt);
        });
        left.appendChild(scenarioSelect);

        const actionRow = create("div", "lab-actions");
        const playPause = create("button", "", "Pause");
        const restart = create("button", "", "Restart");
        const step = create("button", "", "Step");
        const copy = create("button", "lab-copy", "Copy JSON");
        actionRow.appendChild(playPause);
        actionRow.appendChild(restart);
        actionRow.appendChild(step);
        actionRow.appendChild(copy);
        left.appendChild(actionRow);

        const scenarioInfo = create("div", "lab-group");
        left.appendChild(scenarioInfo);
        const scenarioControls = create("div");
        left.appendChild(scenarioControls);
        const tuningControls = create("div");
        left.appendChild(tuningControls);
        const sandboxControls = create("div");
        left.appendChild(sandboxControls);

        const stage = create("div", "lab-stage");
        const canvas = create("canvas", "lab-canvas");
        canvas.width = 500;
        canvas.height = 880;
        stage.appendChild(canvas);
        center.appendChild(stage);
        const ctx = canvas.getContext("2d");

        right.appendChild(create("h2", "", "Metrics"));
        const metricsWrap = create("div", "lab-group");
        const metricList = create("div", "lab-metric-list");
        metricsWrap.appendChild(metricList);
        right.appendChild(metricsWrap);

        right.appendChild(create("h2", "", "Export"));
        right.appendChild(create("p", "small", "This fragment is intended to be pasted back into discussion so the tuned values can be applied to a real flipper."));
        const exportBox = document.createElement("textarea");
        exportBox.className = "lab-export";
        right.appendChild(exportBox);

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
            state.sim.world.controls.left = !!state.sandbox.controls.left;
            state.sim.world.controls.right = !!state.sandbox.controls.right;
            exportBox.value = JSON.stringify(state.sim.toFragment(), null, 2);
            render();
            refreshMetrics();
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
            metricList.innerHTML = "";
            metricEntries(state.sim).forEach(function each(entry) {
                metricList.appendChild(create("div", "label", entry.label));
                metricList.appendChild(create("div", "value", String(entry.value)));
            });
            exportBox.value = JSON.stringify(state.sim.toFragment(), null, 2);
        }

        function render() {
            Pin.render.renderWorld(ctx, state.sim.world);
            if (state.scenarioId === "sandbox") {
                ctx.save();
                ctx.strokeStyle = "rgba(124, 214, 255, 0.85)";
                ctx.lineWidth = 2;
                ctx.setLineDash([8, 6]);
                state.sandbox.elements.forEach(function each(element) {
                    if (!element || !element.anchors || element.anchors.length < 2) return;
                    ctx.beginPath();
                    ctx.moveTo(element.anchors[0].x, element.anchors[0].y);
                    ctx.lineTo(element.anchors[1].x, element.anchors[1].y);
                    ctx.stroke();
                });
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
                ctx.setLineDash([]);
                ctx.restore();
            }
            ctx.save();
            ctx.fillStyle = "rgba(7,10,16,0.84)";
            ctx.fillRect(16, 72, 220, 76);
            ctx.fillStyle = "#dfe9ff";
            ctx.font = 'bold 16px Arial';
            ctx.fillText(state.sim.name, 28, 98);
            ctx.font = '12px Arial';
            ctx.fillStyle = "#9fb1d6";
            ctx.fillText("Tick " + state.sim.tick + " / " + state.sim.totalTicks, 28, 120);
            ctx.fillText(state.playing ? "Running" : "Paused", 28, 138);
            if (state.scenarioId === "sandbox") {
                ctx.fillText("Tool: " + state.sandbox.tool, 28, 156);
                ctx.fillText("Controls: Z/Left and //Right", 28, 174);
            }
            ctx.restore();
        }

        function setSandboxTool(nextTool) {
            state.sandbox.tool = nextTool;
            buildSandboxControls();
            render();
        }

        function countSandboxElements(type) {
            return state.sandbox.elements.filter(function filter(element) { return element && element.type === type; }).length;
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
            controlState.appendChild(create("p", "small", "Use Z or Left Arrow for the left flipper, and / or Right Arrow for the right flipper."));
            const controlRow = create("div", "lab-actions");
            const leftButton = create("button", state.sandbox.controls.left ? "active" : "", "Left Down");
            leftButton.onmousedown = function leftDown() { state.sandbox.controls.left = true; };
            leftButton.onmouseup = function leftUp() { state.sandbox.controls.left = false; };
            leftButton.onmouseleave = function leftLeave() { state.sandbox.controls.left = false; };
            const rightButton = create("button", state.sandbox.controls.right ? "active" : "", "Right Down");
            rightButton.onmousedown = function rightDown() { state.sandbox.controls.right = true; };
            rightButton.onmouseup = function rightUp() { state.sandbox.controls.right = false; };
            rightButton.onmouseleave = function rightLeave() { state.sandbox.controls.right = false; };
            controlRow.appendChild(leftButton);
            controlRow.appendChild(rightButton);
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
            } else {
                buildSliderGroup(scenarioControls, "Scenario Inputs", scenario.params, state.inputs, rebuildSimulation);
                buildSliderGroup(tuningControls, "Flipper Tuning", Pin.physicsHarness.tuningFields, state.tuning, rebuildSimulation);
            }
            buildSandboxControls();
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
        };
        restart.onclick = function restartSimulation() {
            rebuildSimulation();
            state.playing = true;
            playPause.textContent = "Pause";
        };
        step.onclick = function singleStep() {
            if (state.scenarioId === "sandbox") {
                state.sim.world.controls.left = !!state.sandbox.controls.left;
                state.sim.world.controls.right = !!state.sandbox.controls.right;
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
        };

        scenarioSelect.value = state.scenarioId;
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
        });

        function frame() {
            if (state.playing && !state.sim.done) {
                if (state.scenarioId === "sandbox") {
                    state.sim.world.controls.left = !!state.sandbox.controls.left;
                    state.sim.world.controls.right = !!state.sandbox.controls.right;
                }
                state.sim.step(2);
            }
            render();
            refreshMetrics();
            requestAnimationFrame(frame);
        }
        requestAnimationFrame(frame);
    }

    mount();
})(window.Pin);
