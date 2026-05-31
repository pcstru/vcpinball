/*
 * Shared physics harness used by tests and the visual lab.
 * Why: keep tuning scenarios and ad hoc sandbox tests on the same simulation
 * path as the game runtime so manual tuning matches automated checks.
 */
(function initPhysicsHarness(Pin) {
    const BASE_FIXED_DT = 1 / 120;
    const DEFAULT_PLAYFIELD = Object.assign({
        width: 500,
        height: 880,
        ballRadius: 8,
        gravity: 0.35,
        friction: 0.999,
        restitution: 0.55,
        maxSpeed: 24
    }, (Pin.table && Pin.table.DEFAULT_PLAYFIELD) || {});
    const DEFAULT_TUNING = Object.assign({
        flipSpeed: 24,
        flipAccel: 220,
        returnSpeed: 18,
        returnAccel: 160,
        strikeBoost: 0.52,
        surfaceRestitution: 0.28,
        surfaceFriction: 0.08,
        thickness: 10,
        rootRadius: 14,
        tipRadius: 7
    }, (Pin.table && Pin.table.DEFAULT_FLIPPER_TUNING) || {});
    const TUNING_FIELDS = [
        { key: "flipSpeed", label: "Flip Speed", min: 4, max: 40, step: 1 },
        { key: "flipAccel", label: "Flip Accel", min: 20, max: 600, step: 5 },
        { key: "returnSpeed", label: "Return Speed", min: 4, max: 40, step: 1 },
        { key: "returnAccel", label: "Return Accel", min: 20, max: 600, step: 5 },
        { key: "strikeBoost", label: "Strike Boost", min: 0, max: 6, step: 0.05 },
        { key: "surfaceRestitution", label: "Surface Restitution", min: 0, max: 2, step: 0.01 },
        { key: "surfaceFriction", label: "Surface Friction", min: 0, max: 4, step: 0.05 }
    ];
    const SCENARIOS = [
        {
            id: "sandbox",
            name: "Sandbox",
            description: "Draw simple wall segments, drop balls, and tune core playfield physics live.",
            ticks: 100000,
            params: []
        },
        {
            id: "heldTrap",
            name: "Held Trap",
            description: "Ball settles on a held flipper and rolls into the elbow.",
            ticks: 360,
            params: [
                { key: "contactT", label: "Contact", min: 0.12, max: 0.55, step: 0.01, value: 0.18 },
                { key: "initialVy", label: "Initial VY", min: -1, max: 4, step: 0.1, value: 0.5 },
                { key: "initialVx", label: "Initial VX", min: -2, max: 2, step: 0.1, value: 0 }
            ]
        },
        {
            id: "movingCatch",
            name: "Moving Catch",
            description: "Ball meets the flipper during the upstroke and should stay in a sane envelope.",
            ticks: 360,
            params: [
                { key: "contactT", label: "Contact", min: 0.12, max: 0.55, step: 0.01, value: 0.28 },
                { key: "initialVy", label: "Initial VY", min: 0.5, max: 6, step: 0.1, value: 3.5 },
                { key: "initialVx", label: "Initial VX", min: -2, max: 2, step: 0.1, value: 0 },
                { key: "engageTick", label: "Engage Tick", min: 0, max: 36, step: 1, value: 6 }
            ]
        },
        {
            id: "releaseReturn",
            name: "Release and Return",
            description: "Flipper should coast briefly after release, then reverse and accelerate home.",
            ticks: 72,
            params: [
                { key: "pressTicks", label: "Press Ticks", min: 1, max: 18, step: 1, value: 4 },
                { key: "reengageTick", label: "Re-Engage Tick", min: 8, max: 54, step: 1, value: 28 }
            ]
        }
    ];

    function clone(value) {
        return JSON.parse(JSON.stringify(value));
    }

    /*
     * What: Resolve the harness world fixed timestep from table playfield data.
     * Why: harness scenarios and lab simulation must follow the same slow-motion
     * policy as play mode to keep tuning and regression checks aligned.
     */
    function fixedDtForWorld(world) {
        if (Pin.table && Pin.table.getFixedPhysicsDt) {
            return Pin.table.getFixedPhysicsDt(world && world.table && world.table.playfield);
        }
        return BASE_FIXED_DT;
    }

    function round(value, digits) {
        const factor = Math.pow(10, digits == null ? 3 : digits);
        return Math.round(value * factor) / factor;
    }

    function findScenario(id) {
        return SCENARIOS.find(function find(entry) { return entry.id === id; }) || SCENARIOS[0];
    }

    function scenarioDefaults(scenario) {
        const out = {};
        scenario.params.forEach(function each(param) {
            out[param.key] = param.value;
        });
        return out;
    }

    function mergeSettings(base, overrides) {
        const next = {};
        Object.keys(base || {}).forEach(function each(key) { next[key] = base[key]; });
        Object.keys(overrides || {}).forEach(function each(key) {
            if (overrides[key] != null) next[key] = overrides[key];
        });
        return next;
    }

    function buildFlipper(overrides) {
        return Object.assign({
            id: "lf",
            type: "flipper",
            side: "left",
            control: "left",
            pivot: { x: 135, y: 685 },
            length: 95,
            restAngle: 0.55,
            activeAngle: -0.55,
            color: "#00ddff"
        }, DEFAULT_TUNING, overrides || {});
    }

    function buildTrapWall() {
        return {
            id: "trapWall",
            type: "path",
            role: "wall",
            thickness: 6,
            anchors: [{ x: 105, y: 620 }, { x: 105, y: 760 }]
        };
    }

    function buildHarnessTable(elements) {
        return {
            version: 1,
            name: "Physics Harness",
            playfield: clone(DEFAULT_PLAYFIELD),
            rules: { balls: 1, highScoreKey: "pinball.physicsHarness" },
            elements: elements
        };
    }

    function buildSandboxBounds(playfield) {
        const pf = playfield || DEFAULT_PLAYFIELD;
        const width = Number.isFinite(pf.width) && pf.width > 80 ? pf.width : DEFAULT_PLAYFIELD.width;
        const height = Number.isFinite(pf.height) && pf.height > 120 ? pf.height : DEFAULT_PLAYFIELD.height;
        const inset = 18;
        return [
            {
                id: "sandboxWallLeft",
                type: "path",
                role: "wall",
                thickness: 8,
                anchors: [{ x: inset, y: inset }, { x: inset, y: height - inset }]
            },
            {
                id: "sandboxWallRight",
                type: "path",
                role: "wall",
                thickness: 8,
                anchors: [{ x: width - inset, y: inset }, { x: width - inset, y: height - inset }]
            },
            {
                id: "sandboxWallBottom",
                type: "path",
                role: "wall",
                thickness: 8,
                anchors: [{ x: inset, y: height - inset }, { x: width - inset, y: height - inset }]
            }
        ];
    }

    function buildSandboxDrain(playfield) {
        const pf = playfield || DEFAULT_PLAYFIELD;
        const width = Number.isFinite(pf.width) && pf.width > 80 ? pf.width : DEFAULT_PLAYFIELD.width;
        const height = Number.isFinite(pf.height) && pf.height > 120 ? pf.height : DEFAULT_PLAYFIELD.height;
        return {
            id: "sandboxDrain",
            type: "drain",
            x: width * 0.5,
            y: height - 38,
            w: Math.max(120, Math.min(220, width * 0.34)),
            h: 24,
            color: "#ff4466"
        };
    }

    function buildSandboxTable(options) {
        /* What: Build a sandbox table, optionally preserving authored rule/logic data.
         * Why: live autoplay over loaded tables should keep switch/lamp/score logic
         * active while still letting the lab override geometry and physics quickly.
         */
        const physics = mergeSettings({
            gravity: DEFAULT_PLAYFIELD.gravity,
            friction: DEFAULT_PLAYFIELD.friction,
            restitution: DEFAULT_PLAYFIELD.restitution,
            maxSpeed: DEFAULT_PLAYFIELD.maxSpeed
        }, options && options.physics);
        const requestedPlayfield = options && options.playfield ? options.playfield : {};
        const playfield = {
            width: Number.isFinite(requestedPlayfield.width) && requestedPlayfield.width > 80 ? requestedPlayfield.width : DEFAULT_PLAYFIELD.width,
            height: Number.isFinite(requestedPlayfield.height) && requestedPlayfield.height > 120 ? requestedPlayfield.height : DEFAULT_PLAYFIELD.height,
            ballRadius: Number.isFinite(requestedPlayfield.ballRadius) && requestedPlayfield.ballRadius > 0 ? requestedPlayfield.ballRadius : DEFAULT_PLAYFIELD.ballRadius
        };
        const includeDefaultBounds = !options || options.includeDefaultBounds !== false;
        const elements = (includeDefaultBounds ? buildSandboxBounds(playfield) : [])
            .concat([buildSandboxDrain(playfield)])
            .concat(clone((options && options.elements) || []));
        const baseTable = options && options.baseTable ? clone(options.baseTable) : null;
        const table = baseTable || buildHarnessTable(elements);
        table.name = (baseTable && baseTable.name) || "Physics Sandbox";
        table.elements = elements;
        table.rules = Object.assign({ balls: 1, highScoreKey: "pinball.physicsHarness" }, table.rules || {});
        if (!table.logicDocument || typeof table.logicDocument !== "object") {
            table.logicDocument = {
                logicVersion: 1,
                switchRegistry: [],
                stateTable: [],
                computedState: [],
                lampBindings: [],
                actionRules: [],
                resetRules: []
            };
        }
        table.playfield.width = playfield.width;
        table.playfield.height = playfield.height;
        table.playfield.ballRadius = playfield.ballRadius;
        table.playfield.gravity = physics.gravity;
        table.playfield.friction = physics.friction;
        table.playfield.restitution = physics.restitution;
        table.playfield.maxSpeed = physics.maxSpeed;
        return table;
    }

    function buildSandboxFlipper(side, pivot, tuning) {
        const base = buildFlipper(mergeSettings(DEFAULT_TUNING, tuning));
        if (side === "right") {
            return Object.assign(base, {
                id: "sandboxFlipper_" + Math.random().toString(36).slice(2, 8),
                side: "right",
                control: "right",
                pivot: { x: pivot.x, y: pivot.y },
                restAngle: Math.PI - 0.55,
                activeAngle: Math.PI + 0.55,
                color: "#ff4466"
            });
        }
        return Object.assign(base, {
            id: "sandboxFlipper_" + Math.random().toString(36).slice(2, 8),
            side: "left",
            control: "left",
            pivot: { x: pivot.x, y: pivot.y },
            restAngle: -0.55,
            activeAngle: 0.55,
            color: "#00ddff"
        });
    }

    function sandboxLauncherElement(table) {
        const elements = (table && table.elements) || [];
        for (let i = 0; i < elements.length; i++) {
            if (elements[i] && elements[i].type === "launcher") return elements[i];
        }
        return null;
    }

    function buildSandboxBall(spawn, table) {
        const source = spawn || {};
        const launcher = sandboxLauncherElement(table);
        const useLauncherSpawn = !!(launcher && source && source.useLauncher === true);
        const spawnX = useLauncherSpawn && typeof launcher.x === "number" ? launcher.x : source.x;
        const spawnY = useLauncherSpawn && typeof launcher.y === "number" ? launcher.y :
            (useLauncherSpawn && typeof launcher.bottom === "number" ? launcher.bottom - 25 : source.y);
        return {
            x: spawnX != null ? spawnX : 250,
            y: spawnY != null ? spawnY : 140,
            radius: source.radius != null ? source.radius : 8,
            vx: source.vx != null ? source.vx : 0,
            vy: source.vy != null ? source.vy : 0,
            level: 0,
            inLaunchLane: useLauncherSpawn
        };
    }

    function updateSandboxLifecycle(world, spawn) {
        const pf = world.table.playfield;
        const hadBalls = world.balls.length > 0;
        world.balls = world.balls.filter(function keep(ball) {
            return !ball.drained && ball.y <= pf.height + 40;
        });
        if (!hadBalls) return;
        if (world.balls.length) return;
        if (spawn) world.balls.push(buildSandboxBall(spawn, world.table));
    }

    // Keep the harness world aligned with the same runtime structure the game loop uses.
    function refreshRuntime(world) {
        const dynamicRuntime = Pin.elements.compileElements(world.table, world, {
            static: false,
            dynamicPhysicsOnly: true,
            elements: world.dynamicPhysicsElements
        });
        world.dynamicRuntime = dynamicRuntime;
        world.dynamicSegments = dynamicRuntime.segments || [];
        world.dynamicCircles = dynamicRuntime.circles || [];
        const staticRuntime = world.staticRuntime;
        const runtime = {
            segments: (staticRuntime.segments || []).concat(dynamicRuntime.segments || []),
            circles: (staticRuntime.circles || []).concat(dynamicRuntime.circles || []),
            ramps: (staticRuntime.ramps || []).concat(dynamicRuntime.ramps || []),
            sensors: (staticRuntime.sensors || []).concat(dynamicRuntime.sensors || []),
            drawables: (staticRuntime.drawables || []).concat((world.dynamicDrawableRuntime && world.dynamicDrawableRuntime.drawables) || [])
        };
        world.runtime = runtime;
        world.runtimeSegments = runtime.segments;
        world.runtimeCircles = runtime.circles;
        world.runtimeRamps = runtime.ramps;
        world.runtimeSensors = runtime.sensors;
    }

    function createWorld(table, controls) {
        const staticRuntime = Pin.elements.compileElements(table, null, { dynamic: false });
        const dynamicPhysicsElements = Pin.elements.filterElements ?
            Pin.elements.filterElements(table, Pin.elements.isDynamicPhysicsType) :
            (table.elements || []);
        const dynamicDrawableRuntime = Pin.elements.createDrawables ?
            Pin.elements.createDrawables(table, Pin.elements.isDynamicPhysicsType) :
            { drawables: [] };
        const world = {
            table: table,
            balls: [],
            score: 0,
            events: [],
            ruleState: {},
            lampState: {},
            currentBall: 1,
            ballsRemaining: 1,
            controls: Object.assign({ left: false, right: false }, controls || {}),
            elementState: {},
            staticRuntime: staticRuntime,
            staticSegments: staticRuntime.segments || [],
            staticCircles: staticRuntime.circles || [],
            staticRamps: staticRuntime.ramps || [],
            staticSensors: staticRuntime.sensors || [],
            staticBroadPhase: Pin.physics.buildBroadPhase(staticRuntime.segments || [], staticRuntime.circles || [], table.playfield),
            staticSensorBroadPhase: Pin.physics.buildSensorBroadPhase(staticRuntime.sensors || []),
            dynamicPhysicsElements: dynamicPhysicsElements,
            dynamicDrawableRuntime: dynamicDrawableRuntime,
            dynamicSegments: [],
            dynamicCircles: [],
            dynamicSensors: [],
            runtimeSensors: [],
            runtimeRamps: [],
            physicsTick: 0,
            physicsTime: 0,
            lastPhysicsDt: fixedDtForWorld({ table: table })
        };
        refreshRuntime(world);
        return world;
    }

    function stepWorld(world) {
        world.lastPhysicsDt = fixedDtForWorld(world);
        if (Pin.elements && typeof Pin.elements.stepDynamicElements === "function") {
            Pin.elements.stepDynamicElements(world.table, world, world.lastPhysicsDt, world.dynamicPhysicsElements);
        }
        refreshRuntime(world);
        Pin.physics.stepWorld(world, world.lastPhysicsDt);
        if (Pin.events && typeof Pin.events.processRules === "function") {
            Pin.events.processRules(world, world.lastPhysicsDt);
        }
    }

    function primeHeldFlipper(world, ticks) {
        world.controls.left = true;
        for (let i = 0; i < ticks; i++) stepWorld(world);
    }

    function getBlade(world, flipperId) {
        const segments = (world.dynamicRuntime && world.dynamicRuntime.segments) || [];
        for (let i = segments.length - 1; i >= 0; i--) {
            const segment = segments[i];
            if (segment && segment.hitKey === "flipper:" + flipperId && !segment.sweepOnly) {
                return segment;
            }
        }
        return null;
    }

    function getBladeVectors(blade) {
        const angle = Math.atan2(blade.y2 - blade.y1, blade.x2 - blade.x1);
        return {
            angle: angle,
            tangent: { x: Math.cos(angle), y: Math.sin(angle) },
            lift: { x: Math.sin(angle), y: -Math.cos(angle) }
        };
    }

    function placeBallOnBlade(world, flipperId, contactT, normalOffset, tangentialOffset, vx, vy) {
        const blade = getBlade(world, flipperId);
        const vectors = getBladeVectors(blade);
        const baseX = blade.x1 + (blade.x2 - blade.x1) * contactT;
        const baseY = blade.y1 + (blade.y2 - blade.y1) * contactT;
        const ball = {
            x: baseX - vectors.lift.x * normalOffset + vectors.tangent.x * (tangentialOffset || 0),
            y: baseY - vectors.lift.y * normalOffset + vectors.tangent.y * (tangentialOffset || 0),
            radius: 8,
            vx: vx || 0,
            vy: vy || 0,
            level: 0
        };
        world.balls = [ball];
        return {
            blade: blade,
            vectors: vectors,
            ball: ball,
            start: { x: ball.x, y: ball.y }
        };
    }

    function finalizeTailMetrics(metrics) {
        if (metrics.tailCount) {
            metrics.tailAvg = metrics.tailAvgSum / metrics.tailCount;
        } else {
            metrics.tailAvg = 0;
        }
    }

    function createHeldTrapSimulation(options) {
        const tuning = mergeSettings(DEFAULT_TUNING, options.tuning);
        const inputs = mergeSettings(scenarioDefaults(findScenario("heldTrap")), options.inputs);
        const flipper = buildFlipper(tuning);
        const table = buildHarnessTable([buildTrapWall(), flipper]);
        const world = createWorld(table, { left: true });
        primeHeldFlipper(world, 24);
        const placement = placeBallOnBlade(world, flipper.id, inputs.contactT, 7.9, 0, inputs.initialVx, inputs.initialVy);
        const metrics = {
            start: placement.start,
            at60: null,
            tailMax: 0,
            tailAvgSum: 0,
            tailCount: 0,
            tailAvg: 0
        };
        return {
            id: "heldTrap",
            name: "Held Trap",
            description: "Ball should calm down and roll toward the elbow on a held flipper.",
            tuning: tuning,
            inputs: inputs,
            world: world,
            ball: placement.ball,
            totalTicks: 360,
            tick: 0,
            metrics: metrics,
            beforeStep: function beforeStep() {
                world.controls.left = true;
            },
            afterStep: function afterStep() {
                const speed = Math.sqrt(placement.ball.vx * placement.ball.vx + placement.ball.vy * placement.ball.vy);
                if (this.tick === 59) {
                    metrics.at60 = {
                        x: placement.ball.x,
                        y: placement.ball.y,
                        vx: placement.ball.vx,
                        vy: placement.ball.vy,
                        speed: speed
                    };
                }
                if (this.tick >= 300) {
                    metrics.tailMax = Math.max(metrics.tailMax, speed);
                    metrics.tailAvgSum += speed;
                    metrics.tailCount += 1;
                }
            },
            finalize: function finalize() {
                finalizeTailMetrics(metrics);
                metrics.ball = {
                    x: placement.ball.x,
                    y: placement.ball.y,
                    vx: placement.ball.vx,
                    vy: placement.ball.vy
                };
                metrics.rollDistance = metrics.start.x - placement.ball.x;
                metrics.earlyRollDistance = metrics.at60 ? (metrics.start.x - metrics.at60.x) : 0;
            }
        };
    }

    function createMovingCatchSimulation(options) {
        const tuning = mergeSettings(DEFAULT_TUNING, options.tuning);
        const inputs = mergeSettings(scenarioDefaults(findScenario("movingCatch")), options.inputs);
        const flipper = buildFlipper(tuning);
        const table = buildHarnessTable([buildTrapWall(), flipper]);
        const world = createWorld(table, { left: false });
        const placement = placeBallOnBlade(world, flipper.id, inputs.contactT, 8.5, 0, inputs.initialVx, inputs.initialVy);
        placement.ball.y -= 9.5;
        const metrics = {
            start: placement.start,
            peakUpward: 0,
            tailMax: 0,
            tailAvgSum: 0,
            tailCount: 0,
            tailAvg: 0
        };
        return {
            id: "movingCatch",
            name: "Moving Catch",
            description: "Ball meets the flipper during the upstroke and should not launch uncontrollably.",
            tuning: tuning,
            inputs: inputs,
            world: world,
            ball: placement.ball,
            totalTicks: 360,
            tick: 0,
            metrics: metrics,
            beforeStep: function beforeStep() {
                if (this.tick === inputs.engageTick) world.controls.left = true;
            },
            afterStep: function afterStep() {
                const speed = Math.sqrt(placement.ball.vx * placement.ball.vx + placement.ball.vy * placement.ball.vy);
                metrics.peakUpward = Math.min(metrics.peakUpward, placement.ball.vy);
                if (this.tick >= 300) {
                    metrics.tailMax = Math.max(metrics.tailMax, speed);
                    metrics.tailAvgSum += speed;
                    metrics.tailCount += 1;
                }
            },
            finalize: function finalize() {
                finalizeTailMetrics(metrics);
                metrics.ball = {
                    x: placement.ball.x,
                    y: placement.ball.y,
                    vx: placement.ball.vx,
                    vy: placement.ball.vy
                };
            }
        };
    }

    function createReleaseReturnSimulation(options) {
        const tuning = mergeSettings(DEFAULT_TUNING, options.tuning);
        const inputs = mergeSettings(scenarioDefaults(findScenario("releaseReturn")), options.inputs);
        const flipper = buildFlipper(tuning);
        const table = buildHarnessTable([flipper]);
        const world = createWorld(table, { left: false });
        const metrics = {
            angleAtRelease: null,
            velocityAtRelease: null,
            firstCarryAngle: null,
            firstCarryVelocity: null,
            reverseTick: null,
            angleAtReverse: null,
            reengageReverseTick: null,
            finalAngle: null,
            history: []
        };
        return {
            id: "releaseReturn",
            name: "Release and Return",
            description: "Flipper should coast through release, then return with acceleration and accept mid-return re-engage.",
            tuning: tuning,
            inputs: inputs,
            world: world,
            ball: null,
            totalTicks: 72,
            tick: 0,
            metrics: metrics,
            beforeStep: function beforeStep() {
                world.controls.left = this.tick < inputs.pressTicks;
                if (this.tick >= inputs.pressTicks && this.tick < inputs.reengageTick) {
                    world.controls.left = false;
                }
                if (this.tick >= inputs.reengageTick) {
                    world.controls.left = true;
                }
            },
            afterStep: function afterStep() {
                const state = world.elementState["flipper:" + flipper.id];
                metrics.history.push({
                    tick: this.tick,
                    angle: state.angle,
                    angularVelocity: state.angularVelocity,
                    control: !!world.controls.left
                });
                if (this.tick === inputs.pressTicks - 1) {
                    metrics.angleAtRelease = state.angle;
                    metrics.velocityAtRelease = state.angularVelocity;
                }
                if (this.tick === inputs.pressTicks) {
                    metrics.firstCarryAngle = state.angle;
                    metrics.firstCarryVelocity = state.angularVelocity;
                }
                if (this.tick >= inputs.pressTicks && metrics.reverseTick == null && state.angularVelocity > 0) {
                    metrics.reverseTick = this.tick;
                    metrics.angleAtReverse = state.angle;
                }
                if (this.tick >= inputs.reengageTick && metrics.reengageReverseTick == null && state.angularVelocity < 0) {
                    metrics.reengageReverseTick = this.tick;
                }
            },
            finalize: function finalize() {
                const state = world.elementState["flipper:" + flipper.id];
                metrics.finalAngle = state.angle;
            }
        };
    }

    function createSandboxSimulation(options) {
        const sandbox = options && options.sandbox ? options.sandbox : {};
        const table = buildSandboxTable(sandbox);
        const world = createWorld(table, { left: false, right: false });
        world.balls = sandbox.spawn ? [buildSandboxBall(sandbox.spawn, table)] : [];
        const metrics = {
            segmentCount: (sandbox.elements || []).length,
            ballCount: world.balls.length,
            flipperCount: (sandbox.elements || []).filter(function filter(element) { return element && element.type === "flipper"; }).length
        };
        return {
            id: "sandbox",
            name: "Sandbox",
            description: "Draw wall segments, drop balls, and tune playfield physics.",
            tuning: mergeSettings(DEFAULT_TUNING, options && options.tuning),
            inputs: {},
            world: world,
            ball: world.balls[0] || null,
            totalTicks: 100000,
            tick: 0,
            metrics: metrics,
            beforeStep: function beforeStep() {},
            afterStep: function afterStep() {
                updateSandboxLifecycle(world, sandbox.spawn);
                metrics.segmentCount = (sandbox.elements || []).length;
                metrics.ballCount = world.balls.length;
                metrics.flipperCount = (sandbox.elements || []).filter(function filter(element) { return element && element.type === "flipper"; }).length;
                if (world.balls[0]) {
                    this.ball = world.balls[0];
                }
            },
            finalize: function finalize() {
                metrics.segmentCount = (sandbox.elements || []).length;
                metrics.ballCount = world.balls.length;
                metrics.flipperCount = (sandbox.elements || []).filter(function filter(element) { return element && element.type === "flipper"; }).length;
            }
        };
    }

    function createSimulation(id, options) {
        const scenario = findScenario(id);
        const builders = {
            sandbox: createSandboxSimulation,
            heldTrap: createHeldTrapSimulation,
            movingCatch: createMovingCatchSimulation,
            releaseReturn: createReleaseReturnSimulation
        };
        const sim = builders[scenario.id](options || {});
        sim.done = false;
        sim.step = function step(count) {
            const steps = Math.max(1, count || 1);
            for (let i = 0; i < steps && !this.done; i++) {
                if (this.beforeStep) this.beforeStep();
                stepWorld(this.world);
                if (this.afterStep) this.afterStep();
                this.tick += 1;
                if (this.tick >= this.totalTicks) {
                    this.done = true;
                    if (this.finalize) this.finalize();
                }
            }
            return this;
        };
        sim.getMetrics = function getMetrics() {
            if (!this.done && this.finalize) {
                const snapshot = clone(this.metrics);
                if (snapshot.tailAvgSum != null && snapshot.tailCount != null) {
                    snapshot.tailAvg = snapshot.tailCount ? snapshot.tailAvgSum / snapshot.tailCount : 0;
                }
                return snapshot;
            }
            return clone(this.metrics);
        };
        sim.toFragment = function toFragment() {
            if (this.id === "sandbox") {
                return {
                    scenario: this.id,
                    sandbox: {
                        physics: {
                            gravity: round(this.world.table.playfield.gravity, 4),
                            friction: round(this.world.table.playfield.friction, 4),
                            restitution: round(this.world.table.playfield.restitution, 4),
                        maxSpeed: round(this.world.table.playfield.maxSpeed, 3)
                    },
                    elements: clone((options && options.sandbox && options.sandbox.elements) || []),
                    spawn: clone((options && options.sandbox && options.sandbox.spawn) || null)
                }
            };
            }
            return {
                scenario: this.id,
                flipper: {
                    id: "lf",
                    type: "flipper",
                    flipSpeed: round(this.tuning.flipSpeed, 3),
                    flipAccel: round(this.tuning.flipAccel, 3),
                    returnSpeed: round(this.tuning.returnSpeed, 3),
                    returnAccel: round(this.tuning.returnAccel, 3),
                    strikeBoost: round(this.tuning.strikeBoost, 3),
                    surfaceRestitution: round(this.tuning.surfaceRestitution, 3),
                    surfaceFriction: round(this.tuning.surfaceFriction, 3)
                },
                inputs: clone(this.inputs)
            };
        };
        return sim;
    }

    function runScenario(id, options) {
        const sim = createSimulation(id, options);
        while (!sim.done) sim.step();
        return {
            scenario: sim.id,
            tuning: clone(sim.tuning),
            inputs: clone(sim.inputs),
            metrics: sim.getMetrics(),
            fragment: sim.toFragment()
        };
    }

    Pin.physicsHarness = {
        fixedDt: BASE_FIXED_DT,
        defaultTuning: clone(DEFAULT_TUNING),
        tuningFields: clone(TUNING_FIELDS),
        scenarios: SCENARIOS.map(function map(entry) {
            return {
                id: entry.id,
                name: entry.name,
                description: entry.description,
                ticks: entry.ticks,
                params: clone(entry.params)
            };
        }),
        createSandboxFlipper: buildSandboxFlipper,
        createSandboxBall: buildSandboxBall,
        createSimulation: createSimulation,
        runScenario: runScenario
    };
})(window.Pin);
