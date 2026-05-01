const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

function loadPin() {
    const root = path.resolve(__dirname, "..");
    const ctx = {
        console,
        window: {
            Pin: {
                elements: {
                    registry: {},
                    register(name, module) {
                        this.registry[name] = module;
                    }
                }
            }
        }
    };
    ctx.Pin = ctx.window.Pin;
    vm.createContext(ctx);
    [
        "app/table.js",
        "app/geometry.js",
        "app/physics.js",
        "app/events.js",
        "app/ruleGraph.js",
        "app/rules.js",
        "app/ballLifecycle.js",
        "app/physicsHarness.js",
        "app/elements/index.js",
        "app/elements/path.js",
        "app/elements/flipper.js",
        "app/elements/spinner.js",
        "app/elements/scoreZone.js",
        "app/elements/lane.js",
        "app/elements/bumper.js",
        "app/elements/dropTarget.js",
        "app/elements/kicker.js",
        "app/elements/gate.js",
        "app/elements/launcher.js",
        "app/elements/light.js",
        "app/elements/drain.js",
        "app/elements/trough.js"
    ].forEach(function load(file) {
        vm.runInContext(fs.readFileSync(path.join(root, file), "utf8"), ctx, { filename: file });
    });
    return ctx.window.Pin;
}

function makeWorld(table) {
    const Pin = loadPin();
    const staticRuntime = Pin.elements.compileElements(table, null, { dynamic: false });
    return {
        Pin,
        world: {
            table,
            balls: [],
            controls: {},
            elementState: {},
            staticSegments: staticRuntime.segments,
            staticCircles: staticRuntime.circles,
            staticBroadPhase: Pin.physics.buildBroadPhase(staticRuntime.segments, staticRuntime.circles, table.playfield),
            dynamicSegments: [],
            dynamicCircles: [],
            runtimeSensors: [],
            runtimeRamps: []
        }
    };
}

function baseTable(elements) {
    return {
        playfield: { width: 500, height: 880, gravity: 0, friction: 1, restitution: 0.8, maxSpeed: 100 },
        launcher: { x: 439, y: 710 },
        elements
    };
}

function testFastBallHitsWall() {
    const table = baseTable([
        {
            id: "wall",
            type: "path",
            role: "wall",
            thickness: 0,
            anchors: [{ x: 150, y: 80 }, { x: 150, y: 220 }]
        }
    ]);
    const setup = makeWorld(table);
    const ball = { x: 100, y: 150, radius: 8, vx: 70, vy: 0, level: 0 };
    setup.world.balls = [ball];

    setup.Pin.physics.stepWorld(setup.world, 1 / 60);

    assert(ball.x < 150 - ball.radius + 0.5, "ball should remain on the near side of the wall");
    assert(ball.vx < 0, "ball should bounce left after hitting the wall");
}

/*
 * Path colliders should be able to override table-wide restitution.
 * Why: walls need to support dead or rubbery bounce without changing the
 * whole table's fallback collision response.
 */
function testWallRestitutionOverride() {
    const table = baseTable([
        {
            id: "wall",
            type: "path",
            role: "wall",
            restitution: 0,
            thickness: 0,
            anchors: [{ x: 150, y: 80 }, { x: 150, y: 220 }]
        }
    ]);
    table.playfield.restitution = 0.8;
    const setup = makeWorld(table);
    const ball = { x: 100, y: 150, radius: 8, vx: 70, vy: 0, level: 0 };
    setup.world.balls = [ball];

    setup.Pin.physics.stepWorld(setup.world, 1 / 60);

    assert(Math.abs(ball.vx) < 1, "wall restitution override should suppress bounce even when table restitution is high");
}

/*
 * Circle colliders should be able to override table-wide restitution.
 * Why: bumpers/posts/kickers need local material control instead of inheriting
 * the same fallback bounce as the whole table.
 */
function testCircleRestitutionOverride() {
    const Pin = loadPin();
    const table = baseTable([]);
    table.playfield.restitution = 0.8;
    const circle = { x: 150, y: 150, radius: 24, restitution: 0 };
    const world = {
        table,
        balls: [],
        controls: {},
        elementState: {},
        staticSegments: [],
        staticCircles: [circle],
        staticBroadPhase: Pin.physics.buildBroadPhase([], [circle], table.playfield),
        dynamicSegments: [],
        dynamicCircles: [],
        runtimeSensors: [],
        runtimeRamps: []
    };
    const ball = { x: 150, y: 110, radius: 8, vx: 0, vy: 8, level: 0 };
    world.balls = [ball];

    Pin.physics.stepWorld(world, 1 / 60);

    assert(Math.abs(ball.vy) < 1.5, "circle restitution override should suppress bounce even when table restitution is high");
}

function testFlipperPersistentMotionAndHit() {
    const Pin = loadPin();
    const flipper = {
        id: "lf",
        type: "flipper",
        side: "left",
        control: "left",
        pivot: { x: 135, y: 685 },
        length: 95,
        restAngle: 0.55,
        activeAngle: -0.55,
        flipSpeed: 24,
        flipAccel: 5000,
        returnSpeed: 18,
        returnAccel: 160,
        impulse: 4.6,
        thickness: 10
    };
    const table = baseTable([flipper]);
    const world = { table, controls: { left: false }, elementState: {}, lastPhysicsDt: 1 / 120, physicsTick: 1 };

    Pin.elements.compileElements(table, world, { static: false });
    world.controls.left = true;
    const runtime = Pin.elements.compileElements(table, world);
    const firstAngle = world.elementState["flipper:lf"].angle;

    assert(firstAngle < flipper.restAngle && firstAngle > flipper.activeAngle, "flipper should advance over time, not snap");
    assert(runtime.segments.length > 1, "moving flipper should expose swept intermediate colliders");

    const ball = { x: 180, y: 690, radius: 8, vx: 0, vy: 1, level: 0 };
    runtime.segments[runtime.segments.length - 1].onHit(ball, { t: 0.8, nx: 0, ny: -1 });
    assert(ball.vy < 0, "flipper hit should drive the ball upward");

    for (let i = 0; i < 20; i++) {
        Pin.elements.compileElements(table, world, { static: false });
    }
    assert(Math.abs(world.elementState["flipper:lf"].angle - flipper.activeAngle) < 0.02, "flipper should reach active angle");
}

function testFlipperReleaseCarriesMomentumBeforeReturn() {
    const Pin = loadPin();
    const result = Pin.physicsHarness.runScenario("releaseReturn", {
        inputs: {
            pressTicks: 4,
            reengageTick: 28
        }
    }).metrics;

    assert(result.velocityAtRelease < 0, "pressed flipper should be moving on the upstroke before release");
    assert(result.firstCarryAngle < result.angleAtRelease, "released flipper should carry through briefly on existing momentum");
    assert(result.firstCarryVelocity < 0, "released flipper should not reverse direction instantly");
    assert(result.reverseTick != null, "released flipper should eventually accelerate back toward rest");
    assert(result.reengageReverseTick != null, "re-engaging during return should reverse the flipper again");
    assert(result.finalAngle < result.angleAtReverse, "re-engaged flipper should head back toward the active angle");
}

function testFlipperContactIsNotOverSpringy() {
    const Pin = loadPin();
    const flipper = {
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
        returnAccel: 160,
        impulse: 2.6,
        trapDamping: 0.92,
        tangentialDamping: 0.95,
        thickness: 10
    };
    const table = baseTable([flipper]);
    const world = { table, controls: { left: true }, elementState: {}, lastPhysicsDt: 1 / 120, physicsTick: 1 };

    const runtime = Pin.elements.compileElements(table, world, { static: false });
    const ball = { x: 180, y: 690, radius: 8, vx: 0, vy: 1, level: 0 };
    runtime.segments[runtime.segments.length - 1].onHit(ball, { t: 0.8, nx: 0, ny: -1 }, world);

    assert(ball.vy < 0, "flipper hit should still lift the ball");
    assert(ball.vy > -6, "flipper hit should not feel like a springboard");
}

/*
 * Passive flipper contact should preserve a small rebound.
 * Why: a resting flipper should damp the ball, but it should not absorb the
 * incoming normal component so completely that the ball appears to stick.
 */
function testPassiveFlipperContactDoesNotStick() {
    const Pin = loadPin();
    const flipper = {
        id: "rf",
        type: "flipper",
        side: "right",
        control: "right",
        pivot: { x: 260, y: 360 },
        length: 95,
        restAngle: 2.98,
        activeAngle: 4.08,
        flipSpeed: 24,
        flipAccel: 220,
        returnSpeed: 18,
        returnAccel: 160,
        impulse: 2.6,
        trapDamping: 0.95,
        tangentialDamping: 0.98,
        pivotRollPreserve: 0.98,
        outwardSlipPreserve: 0.99,
        passiveSettleBias: 0.997,
        drivenSettleBias: 0.991,
        thickness: 10
    };
    const table = baseTable([flipper]);
    const world = { table, controls: { right: false }, elementState: {}, lastPhysicsDt: 1 / 120, physicsTick: 1 };
    const runtime = Pin.elements.compileElements(table, world, { static: false });
    const ball = { x: 250, y: 140, radius: 8, vx: 0, vy: 1.2, level: 0 };

    runtime.segments[runtime.segments.length - 1].onHit(ball, { t: 0.6, nx: 0, ny: -1 }, world);

    assert(ball.vy < -0.05, "passive flipper contact should return a small upward rebound instead of sticking");
}

/*
 * Flippers should not inherit table-level restitution before their own hit logic.
 * Why: flipper contact is handled by flipper-specific material response, not the
 * generic fallback bounce used by the rest of the table.
 */
function testFlipperIgnoresTableRestitutionFallback() {
    const Pin = loadPin();
    const flipper = {
        id: "rf",
        type: "flipper",
        side: "right",
        control: "right",
        pivot: { x: 260, y: 360 },
        length: 95,
        restAngle: 2.98,
        activeAngle: 4.08,
        flipSpeed: 24,
        flipAccel: 220,
        returnSpeed: 18,
        returnAccel: 160,
        strikeBoost: 0.52,
        surfaceRestitution: 0,
        surfaceFriction: 0.08,
        thickness: 10
    };
    const table = baseTable([flipper]);
    table.playfield.restitution = 1.5;
    const world = { table, controls: { right: false }, elementState: {}, lastPhysicsDt: 1 / 120, physicsTick: 1 };
    const runtime = Pin.elements.compileElements(table, world, { static: false });
    const ball = { x: 250, y: 140, radius: 8, vx: 0, vy: 1.2, level: 0 };

    runtime.segments[runtime.segments.length - 1].onHit(ball, { t: 0.6, nx: 0, ny: -1 }, world);

    assert(ball.vy > -0.8, "flipper contact should not gain a large extra bounce from table-level restitution");
}

/*
 * Runtime flipper collisions should still bounce under physics stepping.
 * Why: direct onHit tests are not enough if the generic solver pre-resolves the
 * collision before the flipper response gets a chance to see the incoming normal.
 */
function testFlipperRuntimeContactKeepsItsOwnBounceModel() {
    const Pin = loadPin();
    const flipper = {
        id: "rf",
        type: "flipper",
        side: "right",
        control: "right",
        pivot: { x: 260, y: 360 },
        length: 95,
        restAngle: 2.98,
        activeAngle: 4.08,
        flipSpeed: 24,
        flipAccel: 220,
        returnSpeed: 18,
        returnAccel: 160,
        strikeBoost: 0.52,
        surfaceRestitution: 0.28,
        surfaceFriction: 0.08,
        thickness: 10
    };
    const table = baseTable([flipper]);
    table.playfield.restitution = 1.5;
    const staticRuntime = Pin.elements.compileElements(table, null, { dynamic: false });
    const world = {
        table,
        balls: [],
        controls: { right: false },
        elementState: {},
        staticSegments: staticRuntime.segments,
        staticCircles: staticRuntime.circles,
        staticBroadPhase: Pin.physics.buildBroadPhase(staticRuntime.segments, staticRuntime.circles, table.playfield),
        dynamicSegments: [],
        dynamicCircles: [],
        runtimeSensors: [],
        runtimeRamps: [],
        lastPhysicsDt: 1 / 120,
        physicsTick: 1
    };
    const dynamicRuntime = Pin.elements.compileElements(table, world, { static: false });
    world.dynamicSegments = dynamicRuntime.segments;
    world.dynamicCircles = dynamicRuntime.circles;
    const blade = dynamicRuntime.segments[dynamicRuntime.segments.length - 1];
    const contactT = 0.6;
    const bx = blade.x1 + (blade.x2 - blade.x1) * contactT;
    const by = blade.y1 + (blade.y2 - blade.y1) * contactT;
    const ball = { x: bx, y: by - 8.4, radius: 8, vx: 0, vy: 1.2, level: 0 };
    world.balls = [ball];

    Pin.physics.stepWorld(world, 1 / 120);

    assert(ball.vy < -0.05, "runtime flipper contact should still produce an upward rebound");
    assert(ball.vy > -1.2, "runtime flipper contact should not inherit a large extra bounce from table restitution");
}

function testFlipperSweepSegmentsDoNotSwallowByOverlap() {
    const Pin = loadPin();
    const flipper = {
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
        returnAccel: 160,
        impulse: 4.6,
        thickness: 10
    };
    const table = baseTable([flipper]);
    table.playfield.restitution = 0.8;
    const world = {
        table,
        balls: [],
        controls: { left: false },
        elementState: {},
        staticSegments: [],
        staticCircles: [],
        staticBroadPhase: Pin.physics.buildBroadPhase([], [], table.playfield),
        dynamicSegments: [],
        dynamicCircles: [],
        runtimeSensors: [],
        runtimeRamps: [],
        lastPhysicsDt: 1 / 120
    };

    Pin.elements.compileElements(table, world, { static: false });
    world.controls.left = true;
    const runtime = Pin.elements.compileElements(table, world);
    world.dynamicSegments = runtime.segments.filter(function keep(seg) { return seg.sweepOnly; });
    assert(world.dynamicSegments.length > 0, "moving flipper should expose sweep-only segments");
    const staleTip = {
        x: flipper.pivot.x + Math.cos(flipper.restAngle) * flipper.length,
        y: flipper.pivot.y + Math.sin(flipper.restAngle) * flipper.length
    };
    const ball = { x: staleTip.x, y: staleTip.y, radius: 8, vx: 0, vy: 0, level: 0 };
    world.balls = [ball];

    Pin.physics.stepWorld(world, 1 / 120);

    assert(Math.abs(ball.x - staleTip.x) < 0.001, "stale sweep-only flipper segment should not overlap-push the ball");
    assert(Math.abs(ball.y - staleTip.y) < 0.001, "stale sweep-only flipper segment should not overlap-push the ball");
    assert.strictEqual(ball.vx, 0, "stale sweep-only flipper segment should not add velocity");
    assert.strictEqual(ball.vy, 0, "stale sweep-only flipper segment should not add velocity");
}

function testFlipperOverlapResolvesToPlayableSide() {
    const Pin = loadPin();
    const flipper = {
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
        returnAccel: 160,
        impulse: 4.6,
        thickness: 10
    };
    const table = baseTable([flipper]);
    table.playfield.restitution = 0.8;
    const world = {
        table,
        balls: [],
        controls: { left: false },
        elementState: {},
        staticSegments: [],
        staticCircles: [],
        staticBroadPhase: Pin.physics.buildBroadPhase([], [], table.playfield),
        dynamicSegments: [],
        dynamicCircles: [],
        runtimeSensors: [],
        runtimeRamps: [],
        lastPhysicsDt: 1 / 120
    };

    Pin.elements.compileElements(table, world, { static: false });
    world.controls.left = true;
    const runtime = Pin.elements.compileElements(table, world, { static: false });
    const currentBlade = runtime.segments[runtime.segments.length - 1];
    world.dynamicSegments = runtime.segments;
    const angle = Math.atan2(currentBlade.y2 - currentBlade.y1, currentBlade.x2 - currentBlade.x1);
    const lift = { x: Math.sin(angle), y: -Math.cos(angle) };
    const mid = {
        x: currentBlade.x1 + (currentBlade.x2 - currentBlade.x1) * 0.62,
        y: currentBlade.y1 + (currentBlade.y2 - currentBlade.y1) * 0.62
    };
    const ball = {
        x: mid.x - lift.x * 5,
        y: mid.y - lift.y * 5,
        radius: 8,
        vx: 0,
        vy: 0,
        level: 0
    };
    const before = { x: ball.x, y: ball.y };
    world.balls = [ball];

    Pin.physics.stepWorld(world, 1 / 120);

    const movedAlongLift = (ball.x - before.x) * lift.x + (ball.y - before.y) * lift.y;
    assert(movedAlongLift > 0, "overlapped flipper ball should be corrected toward the playable side");
    assert(ball.y < before.y, "left flipper correction should lift the ball upward instead of eating it downward");
    assert(ball.vy < 0, "flipper contact should leave the ball moving upward");
}

function testHeldFlipperTrapSettlesInElbow() {
    const Pin = loadPin();
    const result = simulateHeldFlipperTrap(Pin, 0.18, 0.5, 0);

    assert(result.tailMax < 1.2, "held flipper trap should not keep the ball chattering at high speed");
    assert(result.tailAvg < 0.45, "held flipper trap should let the ball settle into the elbow");
}

function testHeldFlipperTrapRollsIntoElbow() {
    const Pin = loadPin();
    const result = simulateHeldFlipperTrap(Pin, 0.35, 0.5, 0);

    assert(result.at60, "trap simulation should capture an early checkpoint");
    assert(result.start.x - result.at60.x > 10, "mid-body trap should roll noticeably toward the elbow within the first half second");
    assert(result.start.x - result.ball.x > 30, "mid-body trap should finish much closer to the elbow than the initial contact point");
}

function simulateHeldFlipperTrap(Pin, contactT, initialVy, initialVx) {
    return Pin.physicsHarness.runScenario("heldTrap", {
        inputs: {
            contactT: contactT,
            initialVy: initialVy,
            initialVx: initialVx
        }
    }).metrics;
}

function testHeldFlipperTrapMatrixStaysStable() {
    const Pin = loadPin();
    const cases = [
        { contactT: 0.18, vy: -0.5, avgLimit: 0.2, maxLimit: 0.35 },
        { contactT: 0.18, vy: 0.5, avgLimit: 0.2, maxLimit: 0.35 },
        { contactT: 0.18, vy: 1.5, avgLimit: 0.2, maxLimit: 0.35 },
        { contactT: 0.18, vy: 3.0, avgLimit: 0.2, maxLimit: 0.35 },
        { contactT: 0.35, vy: 0.5, avgLimit: 0.25, maxLimit: 0.4 },
        { contactT: 0.35, vy: 1.5, avgLimit: 0.25, maxLimit: 0.4 }
    ];

    cases.forEach(function each(testCase) {
        const result = simulateHeldFlipperTrap(Pin, testCase.contactT, testCase.vy, 0);
        assert(result.tailAvg <= testCase.avgLimit, "trap case should settle on average for t=" + testCase.contactT + ", vy=" + testCase.vy);
        assert(result.tailMax <= testCase.maxLimit, "trap case should avoid sustained chatter spikes for t=" + testCase.contactT + ", vy=" + testCase.vy);
    });
}

/*
 * Flipper surface friction should materially affect active contact behavior.
 * Why: the lab exposes this as a user-tunable material property, and the
 * current model expresses it most clearly during moving flipper contact.
 */
function testFlipperSurfaceFrictionAffectsMovingCatch() {
    const Pin = loadPin();
    const lowFriction = Pin.physicsHarness.runScenario("movingCatch", {
        tuning: { strikeBoost: 0.52, surfaceRestitution: 0.28, surfaceFriction: 0.01 },
        inputs: { contactT: 0.28, initialVy: 3.5, initialVx: 0, engageTick: 6 }
    }).metrics;
    const highFriction = Pin.physicsHarness.runScenario("movingCatch", {
        tuning: { strikeBoost: 0.52, surfaceRestitution: 0.28, surfaceFriction: 0.5 },
        inputs: { contactT: 0.28, initialVy: 3.5, initialVx: 0, engageTick: 6 }
    }).metrics;

    assert(highFriction.peakUpward - lowFriction.peakUpward > 4, "higher flipper surface friction should materially change moving flipper contact response");
}

/*
 * Tip-specific flipper material values should alter a tip contact differently
 * from the blade body.
 * Why: the designer now exposes separate tip properties, so they must feed the
 * same runtime path and create a measurable change in tip contact response.
 */
function testFlipperTipMaterialAffectsTipContact() {
    const Pin = loadPin();
    const softTip = Pin.physicsHarness.runScenario("movingCatch", {
        tuning: {
            strikeBoost: 0.52,
            tipStrikeBoost: 0.35,
            surfaceRestitution: 0.28,
            surfaceFriction: 0.08,
            tipRestitution: 0.08,
            tipFriction: 0.02
        },
        inputs: { contactT: 0.92, initialVy: 3.5, initialVx: 0, engageTick: 6 }
    }).metrics;
    const livelyTip = Pin.physicsHarness.runScenario("movingCatch", {
        tuning: {
            strikeBoost: 0.52,
            tipStrikeBoost: 1.0,
            surfaceRestitution: 0.28,
            surfaceFriction: 0.08,
            tipRestitution: 1.2,
            tipFriction: 0.32
        },
        inputs: { contactT: 0.92, initialVy: 3.5, initialVx: 0, engageTick: 6 }
    }).metrics;

    const delta = Math.abs(softTip.peakUpward - livelyTip.peakUpward) + Math.abs((softTip.tailAvg || 0) - (livelyTip.tailAvg || 0));
    assert(delta > 2, "tip material properties should materially affect tip contact response");
}

function testMovingFlipperCatchStaysPlayable() {
    const Pin = loadPin();
    const result = simulateLiveCatch(Pin, 0.28, 3.5, 0, 6);

    assert(result.peakUpward < 0, "moving flipper catch should still lift the ball");
    assert(result.peakUpward > -14, "moving flipper catch should stay below a runaway upward launch envelope");
}

function simulateLiveCatch(Pin, contactT, initialVy, initialVx, engageTick) {
    return Pin.physicsHarness.runScenario("movingCatch", {
        inputs: {
            contactT: contactT,
            initialVy: initialVy,
            initialVx: initialVx,
            engageTick: engageTick
        }
    }).metrics;
}

function testStepConsumesCollisionTime() {
    const Pin = loadPin();
    let leftHits = 0;
    let rightHits = 0;
    const table = baseTable([]);
    table.playfield.restitution = 1;
    const leftWall = {
        x1: 135,
        y1: 50,
        x2: 135,
        y2: 150,
        thickness: 0,
        level: 0,
        onHit() { leftHits += 1; }
    };
    const rightWall = {
        x1: 165,
        y1: 50,
        x2: 165,
        y2: 150,
        thickness: 0,
        level: 0,
        onHit() { rightHits += 1; }
    };
    const world = {
        table,
        balls: [{ x: 145, y: 100, radius: 5, vx: 100, vy: 0, level: 0 }],
        controls: {},
        elementState: {},
        staticSegments: [leftWall, rightWall],
        staticCircles: [],
        staticBroadPhase: Pin.physics.buildBroadPhase([leftWall, rightWall], [], table.playfield),
        dynamicSegments: [],
        dynamicCircles: [],
        runtimeSensors: [],
        runtimeRamps: []
    };

    Pin.physics.stepWorld(world, 0.2);

    assert(leftHits > 0, "remaining substep time should allow the ball to reach the left wall after bouncing");
    assert(rightHits > 0, "ball should hit the right wall first");
    assert(world.balls[0].x > 140 && world.balls[0].x < 160, "ball should remain between the close walls");
}

function testPhysicsFrictionIsTimeScaledAcrossSubsteps() {
    const Pin = loadPin();
    const table = baseTable([]);
    table.playfield.gravity = 0;
    table.playfield.friction = 0.9;
    table.playfield.maxSpeed = 1000;
    const world = {
        table,
        balls: [],
        controls: {},
        elementState: {},
        staticSegments: [],
        staticCircles: [],
        staticBroadPhase: Pin.physics.buildBroadPhase([], [], table.playfield),
        dynamicSegments: [],
        dynamicCircles: [],
        runtimeSensors: [],
        runtimeRamps: []
    };

    const slowBall = { x: 100, y: 100, vx: 5, vy: 0, radius: 8, level: 0 };
    const fastBall = { x: 100, y: 100, vx: 20, vy: 0, radius: 8, level: 0 };

    world.balls = [slowBall];
    Pin.physics.stepWorld(world, 1 / 120);
    const slowRatio = Math.sqrt(slowBall.vx * slowBall.vx + slowBall.vy * slowBall.vy) / 5;

    world.balls = [fastBall];
    world.physicsTick = 0;
    Pin.physics.stepWorld(world, 1 / 120);
    const fastRatio = Math.sqrt(fastBall.vx * fastBall.vx + fastBall.vy * fastBall.vy) / 20;

    const expected = Math.pow(0.9, 0.5);
    assert(Math.abs(slowRatio - expected) < 0.002, "slow ball damping should follow time-scaled friction");
    assert(Math.abs(fastRatio - expected) < 0.002, "fast ball damping should follow time-scaled friction");
}

function testStaticDynamicCompilationSplit() {
    const Pin = loadPin();
    const table = baseTable([
        { id: "wall", type: "path", role: "wall", anchors: [{ x: 10, y: 10 }, { x: 30, y: 10 }] },
        {
            id: "lf",
            type: "flipper",
            side: "left",
            control: "left",
            pivot: { x: 135, y: 685 },
            length: 95,
            restAngle: 0.55,
            activeAngle: -0.55,
            flipAccel: 220,
            returnAccel: 160
        }
    ]);
    const staticRuntime = Pin.elements.compileElements(table, null, { dynamic: false });
    const dynamicRuntime = Pin.elements.compileElements(table, { table, controls: {}, elementState: {} }, { static: false });

    assert.strictEqual(staticRuntime.segments.length, 1, "static pass should include the wall");
    assert.strictEqual(dynamicRuntime.segments.length > 0, true, "dynamic pass should include the flipper");
}

function testScoreEventsProcessThroughRulesQueue() {
    const Pin = loadPin();
    const world = { score: 0, events: [], physicsTick: 7 };

    Pin.events.emit(world, { type: "score", sourceId: "zone1", points: 500 });
    Pin.events.emit(world, { type: "switchClosed", sourceId: "zone1" });

    assert.strictEqual(world.score, 0, "score should not change before event processing");
    const processed = Pin.events.processRules(world);
    assert.strictEqual(world.score, 500, "score event should update score when rules process the queue");
    assert.strictEqual(world.events.length, 0, "event queue should drain after processing");
    assert.strictEqual(processed.length, 2, "rules processing should return the drained event batch");
}

function testScoreElementsEmitEventsOnly() {
    const Pin = loadPin();
    const table = baseTable([
        { id: "spinner1", type: "spinner", x: 250, y: 200, length: 60, score: 100 },
        { id: "zone1", type: "scoreZone", x: 300, y: 220, radius: 20, score: 500 }
    ]);
    const world = { table, score: 0, events: [], elementState: {}, physicsTick: 3 };
    const runtime = Pin.elements.compileElements(table, world);
    const ball = { x: 250, y: 200, radius: 8, vx: 2, vy: -3, level: 0 };

    runtime.segments[0].onHit(ball, { t: 0.5, nx: 0, ny: -1 }, world);
    runtime.circles[0].onHit(ball, { nx: 0, ny: -1 }, world);

    assert.strictEqual(world.score, 0, "score elements should emit events instead of mutating score directly");
    assert.strictEqual(world.events.filter(function isScore(event) { return event.type === "score"; }).length, 2, "spinner and score zone should emit score events");
    Pin.events.processRules(world);
    assert.strictEqual(world.score, 600, "rules processing should apply emitted score events");
}

function testBaseScoreElementsEmitEventsOnly() {
    const Pin = loadPin();
    const table = baseTable([
        { id: "lane1", type: "lane", x: 100, y: 100, w: 40, h: 20, score: 50 },
        { id: "bumper1", type: "bumper", x: 160, y: 180, radius: 24, power: 10, score: 100 },
        { id: "drop1", type: "dropTarget", x: 220, y: 240, w: 14, h: 40, angle: 0, score: 250 },
        { id: "kicker1", type: "kicker", x: 280, y: 300, radius: 14, kickPower: 14, score: 150 }
    ]);
    const world = { table, score: 0, events: [], elementState: {}, physicsTick: 4 };
    const runtime = Pin.elements.compileElements(table, world);
    const ball = { x: 100, y: 100, radius: 8, vx: 2, vy: -3, level: 0 };

    runtime.sensors[0].onEnter(ball, null, world);
    runtime.circles[0].onHit(ball, { nx: 0, ny: -1 }, world);
    runtime.segments[2].onHit(ball, { nx: 0, ny: -1 }, world);
    runtime.circles[1].onHit(ball, { nx: 0, ny: -1 }, world);

    assert.strictEqual(world.score, 0, "base score elements should emit score events instead of mutating score directly");
    assert.strictEqual(world.events.filter(function isScore(event) { return event.type === "score"; }).length, 4, "base score elements should emit one score event per hit");
    assert.strictEqual(world.events.filter(function isSwitch(event) { return event.type === "switchClosed"; }).length, 4, "base score elements should also emit switch events");
    Pin.events.processRules(world);
    assert.strictEqual(world.score, 550, "rules processing should apply emitted base scores");
}

/*
 * Composite kickers should expose band colliders between their posts.
 * Why: multi-post kickers need hits on the rubber perimeter, not just on the posts.
 */
function testCompositeKickerBandHitsKickAndScore() {
    const Pin = loadPin();
    const table = baseTable([
        {
            id: "kickerTri",
            type: "kicker",
            radius: 14,
            bandThickness: 6,
            kickPower: 14,
            restitution: 0.55,
            score: 150,
            closed: true,
            anchors: [
                { x: 240, y: 260 },
                { x: 290, y: 240 },
                { x: 300, y: 295 }
            ]
        }
    ]);
    const world = { table, score: 0, events: [], elementState: {}, physicsTick: 5, lastPhysicsDt: 1 / 120 };
    const runtime = Pin.elements.compileElements(table, world);
    const ball = { x: 265, y: 235, radius: 8, vx: 0, vy: 2, level: 0 };

    assert.strictEqual(runtime.circles.length, 3, "composite kicker should compile one circle per post");
    assert.strictEqual(runtime.segments.length, 3, "three-post kicker should compile a closed rubber perimeter");
    assert(Math.abs(runtime.segments[0].y1 - table.elements[0].anchors[0].y) > 8, "band should be tangent around the post perimeter instead of following the center line");
    assert(Math.abs(runtime.segments[0].y2 - table.elements[0].anchors[1].y) > 8, "band should meet the next post on its perimeter instead of its center line");

    runtime.segments[0].onHit(ball, { nx: 0, ny: -1, cx: 265, cy: 250 }, world);

    assert(ball.vy < 0, "band hit should kick the ball away from the struck edge");
    assert.strictEqual(world.events.filter(function isScore(event) { return event.type === "score"; }).length, 1, "band hit should emit one score event");
    assert.strictEqual(world.events.filter(function isSwitch(event) { return event.type === "switchClosed"; }).length, 1, "band hit should emit one switch event");
    assert(world.elementState["kicker:kickerTri"] && world.elementState["kicker:kickerTri"].pulse > 0, "band hit should arm a short visual pulse");
}

function testSpinnerAngularStateAdvancesInCompile() {
    const Pin = loadPin();
    const spinner = { id: "spinner1", type: "spinner", x: 250, y: 200, length: 60, score: 100, damping: 1 };
    const table = baseTable([spinner]);
    const world = { table, score: 0, events: [], elementState: {}, physicsTick: 3, lastPhysicsDt: 1 / 120 };
    let runtime = Pin.elements.compileElements(table, world, { static: false });
    const ball = { x: 250, y: 200, radius: 8, vx: 5, vy: -3, level: 0 };

    runtime.segments[0].onHit(ball, { t: 0.9, nx: 0, ny: -1 }, world);
    const afterHit = world.elementState["spinner:spinner1"];
    assert(Math.abs(afterHit.angularVelocity) > 0, "spinner hit should add angular velocity to runtime state");

    runtime = Pin.elements.compileElements(table, world, { static: false });
    assert(Math.abs(world.elementState["spinner:spinner1"].angle) > 0, "spinner compile should advance angle from angular velocity");
    assert(runtime.segments[0].x1 !== runtime.segments[0].x2, "spinner should still compile a physical blade segment");
}

function testGateOneWayAndTwoWayAngularMechanism() {
    const Pin = loadPin();
    const oneWayGate = { id: "gate1", type: "gate", x1: 100, y1: 100, x2: 160, y2: 100, maxAngle: 0.85 };
    const twoWayGate = { id: "gate2", type: "gate", x1: 100, y1: 140, x2: 160, y2: 140, twoWay: true, maxAngle: 0.85 };
    const table = baseTable([oneWayGate, twoWayGate]);
    const world = { table, events: [], elementState: {}, lastPhysicsDt: 1 / 120, physicsTick: 12 };
    const runtime = Pin.elements.compileElements(table, world, { static: false });
    const oneWay = runtime.segments[0];
    const twoWay = runtime.segments[1];
    const passBall = { x: 120, y: 96, radius: 5, vx: 0, vy: 10, level: 0 };
    const blockedBall = { x: 120, y: 104, radius: 5, vx: 0, vy: -10, level: 0 };

    assert.strictEqual(oneWay.oneWay(passBall, world), true, "one-way gate should pass from the permitted side");
    assert(Math.abs(world.elementState["gate:gate1"].angularVelocity) > 0, "one-way gate should gain angular velocity when passed");
    const afterPassVelocity = world.elementState["gate:gate1"].angularVelocity;
    assert.strictEqual(oneWay.oneWay(blockedBall, world), false, "one-way gate should block from the wrong side");
    const beforeBlockedVy = blockedBall.vy;
    oneWay.onHit(blockedBall, { nx: 0, ny: 1 }, world);
    assert(Math.abs(blockedBall.vy) < Math.abs(beforeBlockedVy), "blocked gate hit should damp the ball");
    assert.strictEqual(world.elementState["gate:gate1"].angularVelocity, 0, "blocked gate hit should not open the mechanical stop");

    const twoWayBall = { x: 120, y: 144, radius: 5, vx: 0, vy: -10, level: 0 };
    assert.strictEqual(twoWay.oneWay(twoWayBall, world), true, "two-way gate should pass from either side");
    assert(Math.abs(world.elementState["gate:gate2"].angularVelocity) > 0, "two-way gate should gain angular velocity");

    Pin.elements.compileElements(table, world, { static: false });
    assert(Math.abs(world.elementState["gate:gate2"].angle) > 0.01, "gate compile should visibly advance angular state");
}

function testGateAsymmetricSwingLimits() {
    const Pin = loadPin();
    const gate = {
        id: "gateAsym",
        type: "gate",
        x: 100,
        y: 100,
        length: 60,
        angle: 0,
        swingStartAngle: 0,
        swingEndAngle: Math.PI / 2,
        returnStrength: 0,
        returnDamping: 0
    };
    const table = baseTable([gate]);
    const world = { table, events: [], elementState: {}, lastPhysicsDt: 1 / 120, physicsTick: 20 };
    const runtime = Pin.elements.compileElements(table, world, { static: false });
    const seg = runtime.segments[0];
    const blockedSideBall = { x: 120, y: 96, radius: 5, vx: 0, vy: -10, level: 0 };
    const openSideBall = { x: 120, y: 104, radius: 5, vx: 0, vy: 10, level: 0 };

    seg.onHit(blockedSideBall, { nx: 0, ny: 1 }, world);
    Pin.elements.compileElements(table, world, { static: false });
    assert(world.elementState["gate:gateAsym"].angle >= -0.00001, "gate should not swing outside the zero-side arc");

    world.physicsTick += 1;
    seg.onHit(openSideBall, { nx: 0, ny: 1 }, world);
    Pin.elements.compileElements(table, world, { static: false });
    assert(world.elementState["gate:gateAsym"].angle > 0.01, "gate should swing into the authored open-side arc");
}

function testLockedGateActsAsWall() {
    const Pin = loadPin();
    const gate = {
        id: "gateLock",
        type: "gate",
        x: 100,
        y: 100,
        length: 60,
        angle: 0,
        twoWay: true,
        locked: true
    };
    const table = baseTable([gate]);
    const world = { table, events: [], elementState: {}, lastPhysicsDt: 1 / 120, physicsTick: 30 };
    const runtime = Pin.elements.compileElements(table, world, { static: false });
    const seg = runtime.segments[0];
    const ball = { x: 120, y: 96, radius: 5, vx: 0, vy: 10, level: 0 };

    assert.strictEqual(seg.oneWay(ball, world), false, "locked gate should never become pass-through");
    seg.onHit(ball, { nx: 0, ny: -1 }, world);
    assert.strictEqual(world.elementState["gate:gateLock"].angle, 0, "locked gate should not swing on contact");
    assert.strictEqual(world.elementState["gate:gateLock"].angularVelocity, 0, "locked gate should not receive hinge velocity");
}

function testRuleActionLocksGateProperty() {
    const Pin = loadPin();
    const table = baseTable([
        { id: "laneA", type: "lane", x: 80, y: 115, w: 40, h: 20 },
        { id: "gateLock", type: "gate", x: 100, y: 100, length: 60, angle: 0, locked: false }
    ]);
    const graph = Pin.ruleGraph.createGraph("Gate Lock", { sourceRuleId: "gate_lock_rule" });
    const start = Pin.ruleGraph.addNode(graph, "start", { x: 60, y: 120 }, { label: "Start" });
    const step = Pin.ruleGraph.addNode(graph, "switchStep", { x: 220, y: 120 }, { switchId: "laneA", lampId: "" });
    const award = Pin.ruleGraph.addNode(graph, "award", { x: 390, y: 120 }, { awardPoints: 0, awardEvent: "gateLockAwarded" });
    const action = Pin.ruleGraph.addNode(graph, "action", { x: 560, y: 120 }, {
        actionType: "setElementProperty",
        targetId: "gateLock",
        property: "locked",
        value: true
    });
    const reset = Pin.ruleGraph.addNode(graph, "reset", { x: 730, y: 120 }, { resetOnDrain: true, resetOnComplete: true, resetOnWrongOrder: false });
    Pin.ruleGraph.addEdge(graph, start.id, step.id);
    Pin.ruleGraph.addEdge(graph, step.id, award.id);
    Pin.ruleGraph.addEdge(graph, award.id, action.id);
    Pin.ruleGraph.addEdge(graph, action.id, reset.id);

    table.rulesEngine = { switchMap: [], sequenceRules: [], logicGraphs: [graph] };
    const world = { table, score: 0, events: [], ruleState: {}, elementState: {}, physicsTick: 1 };
    Pin.events.emit(world, { type: "switchClosed", sourceId: "laneA" });
    Pin.events.processRules(world);

    assert.strictEqual(Pin.rules.resolveElementProperty(world, table.elements[1], "locked", false), true, "property action should lock the gate at runtime");
    assert.strictEqual(table.rulesEngine.sequenceRules.length, 0, "runtime rule processing should not rewrite graph-backed sequence rules");
}

function testElementRuntimeStateContracts() {
    const Pin = loadPin();
    const spinner = { id: "spinA", type: "spinner" };
    const world = { elementState: { spinA: { angle: 1, velocity: 2 } } };

    const state = Pin.elements.getState(world, spinner, { angle: 0, velocity: 0 }, "spinA");

    assert.strictEqual(Pin.elements.getStateKey(spinner), "spinner:spinA", "state keys should be type namespaced");
    assert.strictEqual(state.angle, 1, "legacy spinner state should migrate into the namespaced key");
    assert.strictEqual(world.elementState.spinA, undefined, "legacy state key should be removed after migration");
    assert.strictEqual(world.elementState["spinner:spinA"], state, "migrated state should be stored under the contract key");
}

function testLaneCompilesAsNonBlockingSensor() {
    const Pin = loadPin();
    const table = baseTable([{ id: "laneA", type: "lane", x: 100, y: 100, w: 40, h: 20 }]);
    const runtime = Pin.elements.compileElements(table, { table, controls: {}, elementState: {} });

    assert.strictEqual(runtime.circles.length, 0, "lane should not compile as a hard circle collider");
    assert.strictEqual(runtime.sensors.length, 1, "lane should compile as an explicit sensor");
    assert.strictEqual(runtime.sensors[0].shape, "rect", "lane sensor should use its rectangular bounds");
}

function testSensorEnterExitEventsDoNotBlockBall() {
    const Pin = loadPin();
    const table = baseTable([{ id: "laneA", type: "lane", x: 100, y: 100, w: 40, h: 20 }]);
    const runtime = Pin.elements.compileElements(table, { table, controls: {}, elementState: {} });
    const world = {
        table,
        events: [],
        physicsTick: 10,
        runtimeSensors: runtime.sensors,
        sensorState: {}
    };
    const ball = { id: "b1", x: 100, y: 100, radius: 5, vx: 3, vy: -2, level: 0 };

    Pin.physics.processSensors(ball, world, 0);
    Pin.physics.processSensors(ball, world, 0);
    ball.x = 200;
    Pin.physics.processSensors(ball, world, 0);

    assert.strictEqual(ball.vx, 3, "sensor should not change ball vx");
    assert.strictEqual(ball.vy, -2, "sensor should not change ball vy");
    assert.strictEqual(world.events.filter(function closed(event) { return event.type === "switchClosed"; }).length, 1, "sensor should emit one enter event");
    assert.strictEqual(world.events.filter(function opened(event) { return event.type === "switchOpened"; }).length, 1, "sensor should emit one exit event");
}

function testLauncherSpringStateServesBall() {
    const Pin = loadPin();
    const launcher = { id: "launchLane", type: "launcher", x: 439, top: 195, bottom: 735, width: 38, maxPower: 42, maxRetract: 65, pullSpeed: 120, returnSpeed: 220, springStrength: 1 };
    const table = baseTable([launcher]);
    const world = {
        table,
        balls: [{ x: 439, y: 710, radius: 8, vx: 0, vy: 0, level: 0, inLaunchLane: true }],
        controls: {},
        events: [],
        elementState: {},
        staticSegments: [],
        staticCircles: [],
        staticBroadPhase: Pin.physics.buildBroadPhase([], [], table.playfield),
        dynamicSegments: [],
        dynamicCircles: [],
        runtimeSensors: [],
        runtimeRamps: [],
        launchCharging: true,
        lastPhysicsDt: 1 / 120
    };

    for (let i = 0; i < 30; i++) {
        Pin.elements.compileElements(table, world, { static: false });
    }
    const charged = world.elementState["launcher:launchLane"];
    assert(charged.position > 0, "charging should retract the launcher state");

    world.launchCharging = false;
    Pin.physics.releaseLauncher(world);
    assert(charged.releasing, "release should arm the plunger state");
    Pin.physics.stepWorld(world, 1 / 120);

    const ball = world.balls[0];
    assert.strictEqual(ball.inLaunchLane, false, "plunger release should serve the ball out of the launch lane");
    assert(ball.vy < -14, "served ball should receive upward velocity from plunger state");
    assert.strictEqual(charged.releasing, false, "plunger should clear releasing state after serving");
    assert.strictEqual(world.events.filter(function released(event) { return event.type === "plungerReleased"; }).length, 1, "plunger release should emit an event");
}

/*
 * Launcher release should not depend on the optional top valve.
 * Why: the launcher's core job is to serve staged balls; an open shooter lane
 * should not add hidden positional recapture rules that can cancel release.
 */
function testLauncherWithoutValveStillServesBall() {
    const Pin = loadPin();
    const launcher = { id: "launchLane", type: "launcher", x: 439, top: 195, bottom: 735, width: 38, maxPower: 42, maxRetract: 65, pullSpeed: 120, returnSpeed: 220, springStrength: 1, valve: "false" };
    const table = baseTable([launcher]);
    const world = {
        table,
        balls: [{ x: 439, y: 710, radius: 8, vx: 0, vy: 0, level: 0, inLaunchLane: true }],
        controls: {},
        events: [],
        elementState: {},
        staticSegments: [],
        staticCircles: [],
        staticBroadPhase: Pin.physics.buildBroadPhase([], [], table.playfield),
        dynamicSegments: [],
        dynamicCircles: [],
        runtimeSensors: [],
        runtimeRamps: [],
        launchCharging: true,
        lastPhysicsDt: 1 / 120
    };

    for (let i = 0; i < 30; i++) {
        Pin.elements.compileElements(table, world, { static: false });
    }
    world.launchCharging = false;
    Pin.physics.releaseLauncher(world);
    Pin.physics.stepWorld(world, 1 / 120);

    const ball = world.balls[0];
    assert.strictEqual(Pin.physics.getLauncherConfig(world).valve, false, "string false valve should be treated as disabled");
    assert.strictEqual(ball.inLaunchLane, false, "open shooter lane should still release the ball");
    assert(ball.vy < -14, "released ball should still receive launch velocity with valve disabled");
}

function testReturnedBallRestagesInLauncher() {
    const Pin = loadPin();
    const launcher = { id: "launchLane", type: "launcher", x: 439, top: 195, bottom: 735, width: 38, maxPower: 42, maxRetract: 65, springStrength: 1 };
    const table = baseTable([launcher]);
    const world = {
        table,
        balls: [{ x: 439, y: 712, radius: 8, vx: 0.2, vy: 2, level: 0, inLaunchLane: false }],
        controls: {},
        events: [],
        elementState: { "launcher:launchLane": { position: 12, velocity: 0, charge: 0.2, releasing: true } },
        staticSegments: [],
        staticCircles: [],
        staticBroadPhase: Pin.physics.buildBroadPhase([], [], table.playfield),
        dynamicSegments: [],
        dynamicCircles: [],
        runtimeSensors: [],
        runtimeRamps: [],
        lastPhysicsDt: 1 / 120
    };

    Pin.physics.stepWorld(world, 1 / 120);

    const ball = world.balls[0];
    const plunger = world.elementState["launcher:launchLane"];
    assert.strictEqual(ball.inLaunchLane, true, "descending ball in launcher lane should be staged again");
    assert.strictEqual(ball.vx, 0, "staged returned ball should stop horizontally");
    assert.strictEqual(ball.vy, 0, "staged returned ball should stop vertically");
    assert.strictEqual(plunger.releasing, false, "launcher should reset release state when restaging");
    assert.strictEqual(plunger.position, 0, "launcher should reset plunger position when restaging");
}

function testLaunchBallUsesTableBallRadius() {
    const Pin = loadPin();
    const table = baseTable([{ id: "launchLane", type: "launcher", x: 439, top: 195, bottom: 735, width: 38, maxPower: 42 }]);
    table.playfield.ballRadius = 12;
    const world = { table };
    const ball = Pin.ballLifecycle.makeLaunchBall(world);
    assert.strictEqual(ball.radius, 12, "launch ball should inherit playfield.ballRadius");
}

function testDrainTroughLifecycleServesNextBall() {
    const Pin = loadPin();
    const table = baseTable([
        { id: "launchLane", type: "launcher", x: 439, top: 195, bottom: 735, width: 38, maxPower: 42 },
        { id: "drain1", type: "drain", x: 250, y: 840, w: 160, h: 24 },
        { id: "trough1", type: "trough", x: 250, y: 812, radius: 18, holdSeconds: 0.75, ejectPower: 10, ejectAngle: -Math.PI * 0.5 }
    ]);
    table.rules = { balls: 3 };
    const runtime = Pin.elements.compileElements(table, { table, controls: {}, elementState: {} });
    const world = {
        table,
        balls: [{ id: "b1", x: 250, y: 840, radius: 8, vx: 0, vy: 5, level: 0 }],
        score: 0,
        events: [],
        currentBall: 1,
        ballsRemaining: 3,
        state: "playing",
        elementState: {},
        runtimeSensors: runtime.sensors,
        sensorState: {}
    };

    Pin.physics.processSensors(world.balls[0], world, 0);
    assert.strictEqual(world.balls[0].drained, true, "drain sensor should mark the ball as drained");
    const result = Pin.ballLifecycle.update(world);

    assert.strictEqual(result.drained, 1, "lifecycle should remove drained balls");
    assert.strictEqual(result.served, 1, "lifecycle should serve the next ball when balls remain");
    assert.strictEqual(world.ballsRemaining, 2, "lifecycle should decrement remaining balls");
    assert.strictEqual(world.currentBall, 2, "lifecycle should advance current ball");
    assert.strictEqual(world.balls[0].inLaunchLane, true, "next ball should be served into launch lane");
}

/*
 * Troughs should behave like round kickout pits, not passive decorations.
 * Why: designers need an activator that can hold a ball briefly and release it
 * with a deliberate kick while the drain remains the out-of-play removal path.
 */
function testTroughCapturesAndReleasesBall() {
    const Pin = loadPin();
    const table = baseTable([
        { id: "trough1", type: "trough", x: 250, y: 400, radius: 20, holdSeconds: 0.02, ejectPower: 8, ejectAngle: -Math.PI * 0.5 }
    ]);
    const runtime = Pin.elements.compileElements(table, { table, controls: {}, elementState: {} });
    const world = {
        table,
        events: [],
        runtimeSensors: runtime.sensors,
        sensorState: {},
        lastPhysicsDt: 1 / 120,
        physicsTick: 1
    };
    const ball = { id: "b1", x: 250, y: 400, radius: 8, vx: 4, vy: 3, level: 0 };

    Pin.physics.processSensors(ball, world, 0);
    assert.strictEqual(ball.capturedBy, "trough1", "trough should capture a ball entering the pit");
    assert.strictEqual(ball.vx, 0, "captured ball should stop horizontally");
    assert.strictEqual(ball.vy, 0, "captured ball should stop vertically");

    for (let i = 0; i < 4; i++) {
        world.physicsTick += 1;
        Pin.physics.processSensors(ball, world, 0);
    }

    assert.strictEqual(ball.capturedBy, null, "trough should release the ball after its hold time");
    assert(ball.y < 400, "released ball should be nudged out of the pit along the eject angle");
    assert(ball.vy < -7.5, "released ball should receive the configured eject kick");
    assert.strictEqual(world.events.filter(function captured(event) { return event.type === "troughCaptured"; }).length, 1, "trough should emit one capture event");
    assert.strictEqual(world.events.filter(function released(event) { return event.type === "troughReleased"; }).length, 1, "trough should emit one release event");
}

function testTroughReactivationDelayPreventsImmediateRecapture() {
    const Pin = loadPin();
    const table = baseTable([
        { id: "trough1", type: "trough", x: 250, y: 400, radius: 20, holdSeconds: 0.01, reactivateDelay: 2, ejectPower: 0, ejectAngle: -Math.PI * 0.5 }
    ]);
    const runtime = Pin.elements.compileElements(table, { table });
    const world = {
        table,
        balls: [{ id: "ball1", x: 250, y: 400, radius: 8, vx: 0, vy: 0, level: 0 }],
        events: [],
        runtimeSensors: runtime.sensors,
        sensorState: {},
        lastPhysicsDt: 0.02,
        physicsTick: 1,
        physicsTime: 0
    };
    const ball = world.balls[0];

    Pin.physics.processSensors(ball, world, 0);
    assert.strictEqual(ball.capturedBy, "trough1", "trough should initially capture the ball");
    Pin.physics.processSensors(ball, world, 0);
    assert.strictEqual(ball.capturedBy, null, "trough should release after hold time");
    assert(ball.troughRelease, "released ball should carry trough release metadata");

    ball.x = 250;
    ball.y = 400;
    world.physicsTime = 1;
    Pin.physics.processSensors(ball, world, 0);
    assert.strictEqual(ball.capturedBy, null, "trough should ignore recapture during reactivation delay");

    ball.x = 340;
    ball.y = 400;
    Pin.physics.processSensors(ball, world, 0);
    ball.x = 250;
    ball.y = 400;
    world.physicsTime = 2.1;
    Pin.physics.processSensors(ball, world, 0);
    assert.strictEqual(ball.capturedBy, "trough1", "trough should recapture after reactivation delay");
}

function testDrainLifecycleGameOver() {
    const Pin = loadPin();
    const table = baseTable([{ id: "launchLane", type: "launcher", x: 439, top: 195, bottom: 735, width: 38, maxPower: 42 }]);
    table.rules = { balls: 1 };
    const world = {
        table,
        balls: [{ id: "b1", x: 250, y: 920, radius: 8, vx: 0, vy: 5, level: 0, drained: true }],
        events: [],
        currentBall: 1,
        ballsRemaining: 1,
        state: "playing",
        elementState: {}
    };

    const result = Pin.ballLifecycle.update(world);

    assert.strictEqual(result.gameOver, true, "last drained ball should end the game");
    assert.strictEqual(world.state, "game_over", "world should enter game over state");
    assert.strictEqual(world.balls.length, 0, "no replacement ball should be served after final drain");
}

function testSequenceRuleTimedBonusAward() {
    const Pin = loadPin();
    const table = baseTable([]);
    table.rulesEngine = {
        switchMap: [
            { eventType: "switchClosed", sourceId: "gateA", switchId: "gate-a" },
            { eventType: "switchClosed", sourceId: "gateB", switchId: "gate-b" },
            { eventType: "switchClosed", sourceId: "gateC", switchId: "gate-c" },
            { eventType: "switchClosed", sourceId: "bonusTarget", switchId: "bonus-target" }
        ],
        sequenceRules: [{
            id: "abcBonus",
            name: "ABC Bonus",
            ordered: true,
            steps: ["gate-a", "gate-b", "gate-c"],
            targetSwitchId: "bonus-target",
            windowSeconds: 5,
            awardPoints: 2500,
            resetOnDrain: true,
            resetOnComplete: true
        }]
    };
    const world = { table, score: 0, events: [], ruleState: {}, physicsTick: 1 };

    ["gateA", "gateB", "gateC"].forEach(function hit(sourceId) {
        Pin.events.emit(world, { type: "switchClosed", sourceId: sourceId });
        Pin.events.processRules(world, 1);
    });
    assert.strictEqual(world.ruleState.abcBonus.qualified, true, "sequence should qualify the timed bonus");
    assert.strictEqual(world.score, 0, "sequence completion should not award until target hit");

    Pin.events.emit(world, { type: "switchClosed", sourceId: "bonusTarget" });
    Pin.events.processRules(world, 1);

    assert.strictEqual(world.score, 2500, "bonus target inside window should award points");
    assert.strictEqual(world.ruleState.abcBonus.qualified, false, "rule should reset after collection");
}

function testSequenceRuleExpiryAndDrainReset() {
    const Pin = loadPin();
    const table = baseTable([]);
    table.rulesEngine = {
        switchMap: [],
        sequenceRules: [{
            id: "quickBonus",
            ordered: true,
            steps: ["a", "b"],
            targetSwitchId: "target",
            windowSeconds: 2,
            awardPoints: 1000,
            resetOnDrain: true,
            resetOnWrongOrder: true
        }]
    };
    const world = { table, score: 0, events: [], ruleState: {}, physicsTick: 1 };

    Pin.events.emit(world, { type: "switchClosed", switchId: "b" });
    Pin.events.processRules(world, 0.5);
    assert.strictEqual(world.ruleState.quickBonus.stepIndex, 0, "wrong-order step should reset ordered rule");

    Pin.events.emit(world, { type: "switchClosed", switchId: "a" });
    Pin.events.processRules(world, 0.5);
    Pin.events.emit(world, { type: "switchClosed", switchId: "b" });
    Pin.events.processRules(world, 0.5);
    assert.strictEqual(world.ruleState.quickBonus.qualified, true, "correct sequence should qualify");

    Pin.events.processRules(world, 3);
    assert.strictEqual(world.ruleState.quickBonus.qualified, false, "qualified timed shot should expire");

    Pin.events.emit(world, { type: "switchClosed", switchId: "a" });
    Pin.events.processRules(world, 0.5);
    Pin.events.emit(world, { type: "ballDrained" });
    Pin.events.processRules(world, 0.5);
    assert.strictEqual(world.ruleState.quickBonus.stepIndex, 0, "drain should reset partial rule progress");
}

function testSequenceRuleLampOutputs() {
    const Pin = loadPin();
    const table = baseTable([]);
    table.rulesEngine = {
        switchMap: [],
        sequenceRules: [{
            id: "litBonus",
            ordered: true,
            steps: ["a", "b"],
            stepLampIds: ["lamp-a", "lamp-b"],
            targetSwitchId: "target",
            targetLampId: "lamp-target",
            windowSeconds: 4,
            awardPoints: 1000
        }]
    };
    const world = { table, score: 0, events: [], ruleState: {}, lampState: {}, physicsTick: 1 };

    Pin.events.processRules(world, 0);
    assert.strictEqual(world.lampState["lamp-a"].status, "next", "first step lamp should identify the next shot");
    assert.strictEqual(world.lampState["lamp-a"].on, false, "next step lamp should not be lit until the lane is completed");
    assert.strictEqual(world.lampState["lamp-b"].status, "off", "future step lamp should stay off");
    assert.strictEqual(world.lampState["lamp-target"].on, false, "target lamp should be off before qualification");

    Pin.events.emit(world, { type: "switchClosed", switchId: "a" });
    Pin.events.processRules(world, 0.5);
    assert.strictEqual(world.lampState["lamp-a"].status, "complete", "completed step lamp should remain lit");
    assert.strictEqual(world.lampState["lamp-b"].status, "next", "second step lamp should become the next shot");
    assert.strictEqual(world.lampState["lamp-b"].on, false, "next incomplete step lamp should remain unlit");

    Pin.events.emit(world, { type: "switchClosed", switchId: "b" });
    Pin.events.processRules(world, 0.5);
    assert.strictEqual(world.lampState["lamp-target"].status, "qualified", "target lamp should light during the timed window");
    assert(world.lampState["lamp-target"].remaining <= 4, "target lamp should expose countdown state");

    Pin.events.processRules(world, 5);
    assert.strictEqual(world.lampState["lamp-target"].on, false, "target lamp should turn off after expiry");
}

/*
 * Timed triggers should enter the existing rule path as ordinary switch IDs.
 * Why: timer logic must drive the same sequence/action/lamp machinery as table
 * switches rather than becoming a separate runtime.
 */
function testIntervalTriggerEmitsSwitchEvents() {
    const Pin = loadPin();
    const table = baseTable([]);
    table.rulesEngine = {
        switchMap: [],
        triggers: [{ id: "flashTimer", type: "interval", everySeconds: 0.5, switchId: "tick.flash", enabled: true }],
        variables: [{ id: "flash", name: "Flash", properties: { value: false } }],
        sequenceRules: [{
            id: "flashRule",
            steps: ["tick.flash"],
            actions: [{ actionType: "toggleVariableProperty", variableId: "flash", property: "value" }]
        }]
    };
    const world = { table, score: 0, events: [], ruleState: {}, lampState: {}, physicsTick: 0 };

    Pin.events.processRules(world, 0.25);
    assert.strictEqual(world.variableState.flash.value, false, "partial interval should not emit");

    Pin.events.processRules(world, 0.25);
    assert.strictEqual(world.variableState.flash.value, true, "completed interval should emit the timer switch");

    Pin.events.processRules(world, 0.5);
    assert.strictEqual(world.variableState.flash.value, false, "later interval should emit again");
}

function testTickTriggerUsesPhysicsTickDelta() {
    const Pin = loadPin();
    const table = baseTable([]);
    table.rulesEngine = {
        switchMap: [],
        triggers: [{ id: "tickTimer", type: "interval", everyTicks: 3, switchId: "tick.three", enabled: true }],
        variables: [{ id: "counter", name: "Counter", properties: { value: 0 } }],
        sequenceRules: [{
            id: "tickRule",
            steps: ["tick.three"],
            actions: [{ actionType: "addVariableProperty", variableId: "counter", property: "value", value: 1 }]
        }]
    };
    const world = { table, score: 0, events: [], ruleState: {}, lampState: {}, physicsTick: 0 };

    Pin.events.processRules(world, 0);
    world.physicsTick = 2;
    Pin.events.processRules(world, 0);
    assert.strictEqual(world.variableState.counter.value, 0, "tick trigger should wait for the configured tick count");

    world.physicsTick = 3;
    Pin.events.processRules(world, 0);
    assert.strictEqual(world.variableState.counter.value, 1, "tick trigger should emit once after three ticks");

    world.physicsTick = 9;
    Pin.events.processRules(world, 0);
    assert.strictEqual(world.variableState.counter.value, 3, "tick trigger should catch up across multiple elapsed intervals");
}

function testVariableActionsSetAddToggleAndReset() {
    const Pin = loadPin();
    const table = baseTable([]);
    table.rulesEngine = {
        switchMap: [],
        variables: [{ id: "mode", name: "Mode", properties: { value: 1 } }],
        sequenceRules: [
            { id: "setVar", steps: ["set"], actions: [{ actionType: "setVariableProperty", variableId: "mode", property: "value", value: 4 }] },
            { id: "addVar", steps: ["add"], actions: [{ actionType: "addVariableProperty", variableId: "mode", property: "value", value: 3 }] },
            { id: "toggleVar", steps: ["toggle"], actions: [{ actionType: "toggleVariableProperty", variableId: "mode", property: "enabled" }] },
            { id: "resetVar", steps: ["reset"], actions: [{ actionType: "resetVariableProperty", variableId: "mode", property: "value" }] }
        ]
    };
    const world = { table, score: 0, events: [], ruleState: {}, lampState: {}, physicsTick: 0 };

    Pin.events.emit(world, { type: "switchClosed", switchId: "set" });
    Pin.events.processRules(world, 0);
    assert.strictEqual(world.variableState.mode.value, 4, "setVariableProperty should replace the property");

    Pin.events.emit(world, { type: "switchClosed", switchId: "add" });
    Pin.events.processRules(world, 0);
    assert.strictEqual(world.variableState.mode.value, 7, "addVariableProperty should add numeric values");

    Pin.events.emit(world, { type: "switchClosed", switchId: "toggle" });
    Pin.events.processRules(world, 0);
    assert.strictEqual(world.variableState.mode.enabled, true, "toggleVariableProperty should flip truthiness");

    Pin.events.emit(world, { type: "switchClosed", switchId: "reset" });
    Pin.events.processRules(world, 0);
    assert.strictEqual(world.variableState.mode.value, 1, "resetVariableProperty should restore the table default");
}

function testRuleConditionsGateAwardsAndState() {
    const Pin = loadPin();
    const table = baseTable([]);
    table.rulesEngine = {
        switchMap: [],
        variables: [{ id: "modeReady", name: "Mode Ready", properties: { value: false } }],
        sequenceRules: [{
            id: "conditionalAward",
            steps: ["go"],
            conditions: [{ source: "variable", variableId: "modeReady", property: "value", operator: "truthy" }],
            awardPoints: 100
        }]
    };
    const world = { table, score: 0, events: [], ruleState: {}, lampState: {}, physicsTick: 0 };

    Pin.events.emit(world, { type: "switchClosed", switchId: "go" });
    Pin.events.processRules(world, 0);
    assert.strictEqual(world.score, 0, "false condition should block the award");
    assert.strictEqual(world.ruleState.conditionalAward.stepIndex, 0, "false condition should not consume the sequence step");

    world.variableState.modeReady.value = true;
    Pin.events.emit(world, { type: "switchClosed", switchId: "go" });
    Pin.events.processRules(world, 0);
    assert.strictEqual(world.score, 100, "true condition should allow the award");
}

function testTimerDrivenLampFlashesThroughVariableState() {
    const Pin = loadPin();
    const table = baseTable([{ id: "flashLamp", type: "light", x: 100, y: 100, radius: 10, lampId: "lamp.flash" }]);
    table.rulesEngine = {
        switchMap: [],
        triggers: [{ id: "flashTimer", type: "interval", everySeconds: 0.5, switchId: "tick.flash", enabled: true }],
        variables: [{ id: "flash", name: "Flash", properties: { value: false } }],
        sequenceRules: [{
            id: "flashLampRule",
            steps: ["tick.flash"],
            actions: [
                { actionType: "toggleVariableProperty", variableId: "flash", property: "value" },
                { actionType: "setLampFromVariable", lampId: "lamp.flash", variableId: "flash", property: "value" }
            ]
        }]
    };
    const world = { table, score: 0, events: [], ruleState: {}, lampState: {}, physicsTick: 0 };

    Pin.events.processRules(world, 0.5);
    assert.strictEqual(world.lampState["lamp.flash"].on, true, "timer should toggle the variable and light the lamp");

    Pin.events.processRules(world, 0.5);
    assert.strictEqual(world.lampState["lamp.flash"].on, false, "next timer tick should clear the lamp through the variable");
}

function testRuleValidationFindsBrokenReferences() {
    const Pin = loadPin();
    const table = baseTable([
        { id: "laneA", type: "lane", x: 100, y: 100, w: 40, h: 20 },
        { id: "lampA", type: "light", x: 100, y: 130, lampId: "lamp-a" }
    ]);
    table.rulesEngine = {
        switchMap: [
            { eventType: "switchClosed", sourceId: "missingSource", switchId: "mapped-a" },
            { eventType: "switchClosed", sourceId: "missingSource", switchId: "mapped-a" }
        ],
        sequenceRules: [{
            id: "broken",
            steps: ["laneA", "missing-step"],
            targetSwitchId: "missing-target",
            stepLampIds: ["lamp-a", "missing-lamp", "extra-lamp"],
            targetLampId: "missing-target-lamp",
            windowSeconds: 0
        }, {
            id: "broken",
            steps: []
        }]
    };

    const issues = Pin.rules.validate(table);
    const text = issues.map(function m(issue) { return issue.message; }).join("\n");
    assert(text.indexOf("Duplicate rule id 'broken'") >= 0, "validation should flag duplicate rule ids");
    assert(text.indexOf("unknown step switch 'missing-step'") >= 0, "validation should flag missing step switches");
    assert(text.indexOf("unknown target switch 'missing-target'") >= 0, "validation should flag missing target switches");
    assert(text.indexOf("unknown step lamp 'missing-lamp'") >= 0, "validation should flag missing step lamps");
    assert(text.indexOf("Duplicate switch mapping") >= 0, "validation should flag duplicate switch mappings");
    assert(text.indexOf("target window should be greater than zero") >= 0, "validation should flag invalid target timers");
}

function testRuleValidationFindsLogicVariableTimerAndLampIssues() {
    const Pin = loadPin();
    const table = baseTable([{ id: "lampA", type: "light", x: 100, y: 130, lampId: "lamp-a" }]);
    table.rulesEngine = {
        switchMap: [],
        variables: [{ id: "known", name: "Known", properties: { value: false } }],
        triggers: [{ id: "badTimer", type: "interval", everySeconds: 0, switchId: "" }],
        sequenceRules: [{
            id: "brokenLogic",
            steps: ["lampA"],
            conditions: [{ source: "variable", variableId: "missingVar", operator: "truthy" }],
            actions: [
                { actionType: "toggleVariableProperty", variableId: "missingVar", property: "value" },
                { actionType: "setLamp", lampId: "missingLamp", value: true }
            ]
        }]
    };

    const issues = Pin.rules.validate(table);
    const text = issues.map(function m(issue) { return issue.message; }).join("\n");
    assert(text.indexOf("Trigger #1 is missing switchId") >= 0, "validation should flag incomplete timer triggers");
    assert(text.indexOf("unknown variable 'missingVar'") >= 0, "validation should flag unknown variable references");
    assert(text.indexOf("unknown lamp 'missingLamp'") >= 0, "validation should flag unknown logic lamp actions");
}

function testLogicGraphKeepsGenericNodesWhileCompilingSequenceRules() {
    const Pin = loadPin();
    const table = baseTable([
        { id: "laneA", type: "lane", x: 80, y: 115, w: 40, h: 20 },
        { id: "laneB", type: "lane", x: 155, y: 115, w: 40, h: 20 },
        { id: "scoreZone1", type: "scoreZone", x: 380, y: 370, radius: 22, score: 1000 },
        { id: "lampA", type: "light", x: 80, y: 145, lampId: "lamp-a" }
    ]);
    const graph = Pin.ruleGraph.createGraph("Graph Test", { sourceRuleId: "graph_rule" });
    const start = Pin.ruleGraph.addNode(graph, "start", { x: 60, y: 120 }, { label: "Start" });
    const note = Pin.ruleGraph.addNode(graph, "note", { x: 170, y: 120 }, { label: "Note", text: "custom node" });
    const step = Pin.ruleGraph.addNode(graph, "switchStep", { x: 320, y: 120 }, { switchId: "laneA", lampId: "lamp-a" });
    const event = Pin.ruleGraph.addNode(graph, "event", { x: 490, y: 120 }, { label: "Event", eventType: "switchClosed", sourceId: "laneB" });
    const target = Pin.ruleGraph.addNode(graph, "timedTarget", { x: 660, y: 120 }, { switchId: "scoreZone1", lampId: "", windowSeconds: 6 });
    const award = Pin.ruleGraph.addNode(graph, "award", { x: 830, y: 120 }, { awardPoints: 500 });
    const reset = Pin.ruleGraph.addNode(graph, "reset", { x: 1000, y: 120 }, { resetOnDrain: true, resetOnComplete: true, resetOnWrongOrder: false });
    Pin.ruleGraph.addEdge(graph, start.id, note.id);
    Pin.ruleGraph.addEdge(graph, note.id, step.id);
    Pin.ruleGraph.addEdge(graph, step.id, event.id);
    Pin.ruleGraph.addEdge(graph, event.id, target.id);
    Pin.ruleGraph.addEdge(graph, target.id, award.id);
    Pin.ruleGraph.addEdge(graph, award.id, reset.id);

    table.rulesEngine = { switchMap: [], sequenceRules: [], logicGraphs: [graph] };
    Pin.ruleGraph.syncRuleGraphs(table);

    const syncedGraph = table.rulesEngine.logicGraphs[0];
    const compiledRule = table.rulesEngine.sequenceRules[0];
    assert(syncedGraph.nodes.some(function has(node) { return node.type === "note"; }), "logic graph should keep generic note nodes");
    assert(syncedGraph.nodes.some(function has(node) { return node.type === "event"; }), "logic graph should keep generic event nodes");
    assert.strictEqual(compiledRule.steps[0], "laneA", "sequence compiler should still read step nodes");
    assert.strictEqual(compiledRule.targetSwitchId, "scoreZone1", "sequence compiler should still read target nodes");
    assert.strictEqual(compiledRule.awardPoints, 500, "sequence compiler should still read award nodes");
}

function testRuleActionOverridesElementScore() {
    const Pin = loadPin();
    const table = baseTable([
        { id: "laneA", type: "lane", x: 80, y: 115, w: 40, h: 20, score: 50 },
        { id: "bumper1", type: "bumper", x: 160, y: 280, radius: 28, power: 12, score: 100 }
    ]);
    const graph = Pin.ruleGraph.createGraph("Score Override", { sourceRuleId: "score_override_rule" });
    const start = Pin.ruleGraph.addNode(graph, "start", { x: 60, y: 120 }, { label: "Start" });
    const step = Pin.ruleGraph.addNode(graph, "switchStep", { x: 220, y: 120 }, { switchId: "laneA", lampId: "" });
    const award = Pin.ruleGraph.addNode(graph, "award", { x: 390, y: 120 }, { awardPoints: 0, awardEvent: "scoreOverrideAwarded" });
    const action = Pin.ruleGraph.addNode(graph, "action", { x: 560, y: 120 }, { actionType: "setElementScore", targetId: "bumper1", value: 500 });
    const reset = Pin.ruleGraph.addNode(graph, "reset", { x: 730, y: 120 }, { resetOnDrain: true, resetOnComplete: true, resetOnWrongOrder: false });
    Pin.ruleGraph.addEdge(graph, start.id, step.id);
    Pin.ruleGraph.addEdge(graph, step.id, award.id);
    Pin.ruleGraph.addEdge(graph, award.id, action.id);
    Pin.ruleGraph.addEdge(graph, action.id, reset.id);

    table.rulesEngine = { switchMap: [], sequenceRules: [], logicGraphs: [graph] };
    const world = { table, score: 0, events: [], ruleState: {}, elementState: {}, physicsTick: 1 };
    Pin.events.emit(world, { type: "switchClosed", sourceId: "laneA" });
    Pin.events.processRules(world);

    const runtime = Pin.elements.compileElements(table, world);
    const ball = { x: 160, y: 280, radius: 8, vx: 2, vy: -3, level: 0 };
    runtime.circles[0].onHit(ball, { nx: 0, ny: -1 }, world);
    Pin.events.processRules(world);

    assert.strictEqual(world.score, 500, "logic action should override the target element score before its next hit");
    assert.strictEqual(table.rulesEngine.sequenceRules.length, 0, "runtime rule processing should not rewrite graph-backed sequence rules");
}

function testTablePlayabilityValidation() {
    const Pin = loadPin();
    const table = baseTable([
        { id: "launchLane", type: "launcher", x: 999, top: 200, bottom: 100, width: 38 },
        { id: "badRamp", type: "ramp", levelFrom: 1, levelTo: 1, leftAnchors: [{ x: 10, y: 10 }], rightAnchors: [] },
        { id: "dup", type: "lane", x: 100, y: 100, w: 40, h: 20 },
        { id: "dup", type: "lane", x: 150, y: 100, w: 40, h: 20 }
    ]);

    const issues = Pin.table.validatePlayability(table);
    const text = issues.map(function m(issue) { return issue.message; }).join("\n");
    assert(text.indexOf("Duplicate element id 'dup'") >= 0, "table validation should flag duplicate element ids");
    assert(text.indexOf("No drain sensor is present") >= 0, "table validation should flag missing drains");
    assert(text.indexOf("No trough element is present") >= 0, "table validation should flag missing troughs");
    assert(text.indexOf("Fewer than two flippers") >= 0, "table validation should flag missing flippers");
    assert(text.indexOf("Launcher 'launchLane' is outside") >= 0, "table validation should flag bad launcher geometry");
    assert(text.indexOf("Ramp 'badRamp' needs at least two left anchors") >= 0, "table validation should flag bad ramp anchors");
    assert(text.indexOf("Ramp 'badRamp' has the same entry and exit level") >= 0, "table validation should flag ineffective ramps");
}

function testTableNormalizationFillsRuntimeDefaults() {
    const Pin = loadPin();
    const table = Pin.table.normalizeTable({ version: 1, name: "Sparse", playfield: { width: 320 }, elements: [] });
    const validation = Pin.table.validateTable(table);

    assert.strictEqual(validation.ok, true, "normalized sparse table should pass structural validation");
    assert.strictEqual(table.rules.balls, 3, "normalization should add default ball count");
    assert(Array.isArray(table.rulesEngine.sequenceRules), "normalization should add rulesEngine arrays");
    assert.strictEqual(table.playfield.height, 880, "normalization should fill missing playfield defaults");
}

function testDefTableLaneBonusRule() {
    const Pin = loadPin();
    const tablePath = path.resolve(__dirname, "..", "tables", "DefTable.json");
    const table = Pin.table.normalizeTable(JSON.parse(fs.readFileSync(tablePath, "utf8")));
    const world = { table, score: 0, events: [], ruleState: {}, lampState: {}, physicsTick: 1 };

    Pin.events.processRules(world, 0);
    assert.strictEqual(world.lampState.lamp_lane_left.on, false, "left lane lamp should start off");
    assert.strictEqual(world.lampState.lamp_lane_middle.on, false, "middle lane lamp should start off");
    assert.strictEqual(world.lampState.lamp_lane_right.on, false, "right lane lamp should start off");

    Pin.events.emit(world, { type: "switchClosed", sourceId: "lane_wcohsa" });
    Pin.events.processRules(world, 0.1);
    assert.strictEqual(world.lampState.lamp_lane_left.on, true, "left lane should light its lamp");

    Pin.events.emit(world, { type: "switchClosed", sourceId: "lane_2m7sow" });
    Pin.events.processRules(world, 0.1);
    assert.strictEqual(world.lampState.lamp_lane_middle.on, true, "middle lane should light its lamp");

    Pin.events.emit(world, { type: "switchClosed", sourceId: "lane_sa2lu2" });
    Pin.events.processRules(world, 0.1);
    assert.strictEqual(world.lampState.lamp_lane_right.on, true, "right lane should light its lamp");

    Pin.events.emit(world, { type: "switchClosed", sourceId: "bumper_m11qpo" });
    Pin.events.processRules(world, 0.1);
    Pin.events.emit(world, { type: "switchClosed", sourceId: "bumper_m11qpo" });
    Pin.events.processRules(world, 0.1);
    assert.strictEqual(world.score, 2000, "red bumper should score 1000 for each hit during the timed bonus");
}

testFastBallHitsWall();
testWallRestitutionOverride();
testCircleRestitutionOverride();
testFlipperPersistentMotionAndHit();
testFlipperReleaseCarriesMomentumBeforeReturn();
testFlipperContactIsNotOverSpringy();
testPassiveFlipperContactDoesNotStick();
testFlipperIgnoresTableRestitutionFallback();
testFlipperRuntimeContactKeepsItsOwnBounceModel();
testFlipperSweepSegmentsDoNotSwallowByOverlap();
testFlipperOverlapResolvesToPlayableSide();
testHeldFlipperTrapSettlesInElbow();
testHeldFlipperTrapRollsIntoElbow();
testHeldFlipperTrapMatrixStaysStable();
testFlipperSurfaceFrictionAffectsMovingCatch();
testFlipperTipMaterialAffectsTipContact();
testMovingFlipperCatchStaysPlayable();
testStepConsumesCollisionTime();
testPhysicsFrictionIsTimeScaledAcrossSubsteps();
testStaticDynamicCompilationSplit();
testScoreEventsProcessThroughRulesQueue();
testScoreElementsEmitEventsOnly();
testBaseScoreElementsEmitEventsOnly();
testCompositeKickerBandHitsKickAndScore();
testSpinnerAngularStateAdvancesInCompile();
testGateOneWayAndTwoWayAngularMechanism();
testGateAsymmetricSwingLimits();
testLockedGateActsAsWall();
testRuleActionLocksGateProperty();
testElementRuntimeStateContracts();
testLaneCompilesAsNonBlockingSensor();
testSensorEnterExitEventsDoNotBlockBall();
testLaunchBallUsesTableBallRadius();
testLauncherSpringStateServesBall();
testLauncherWithoutValveStillServesBall();
testReturnedBallRestagesInLauncher();
testDrainTroughLifecycleServesNextBall();
testTroughCapturesAndReleasesBall();
testTroughReactivationDelayPreventsImmediateRecapture();
testDrainLifecycleGameOver();
testSequenceRuleTimedBonusAward();
testSequenceRuleExpiryAndDrainReset();
testSequenceRuleLampOutputs();
testIntervalTriggerEmitsSwitchEvents();
testTickTriggerUsesPhysicsTickDelta();
testVariableActionsSetAddToggleAndReset();
testRuleConditionsGateAwardsAndState();
testTimerDrivenLampFlashesThroughVariableState();
testRuleValidationFindsBrokenReferences();
testRuleValidationFindsLogicVariableTimerAndLampIssues();
testLogicGraphKeepsGenericNodesWhileCompilingSequenceRules();
testRuleActionOverridesElementScore();
testTablePlayabilityValidation();
testTableNormalizationFillsRuntimeDefaults();
testDefTableLaneBonusRule();
console.log("physics tests ok");
