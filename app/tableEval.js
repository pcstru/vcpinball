/*
 * Table evaluation harness for baseline playability validation.
 * What: run deterministic static, geometry-adjacent, and physics sanity checks
 * against a table definition and emit a machine-readable report.
 * Why: catch broken or invalid tables early with repeatable PASS/WARN/FAIL
 * outcomes before deeper gameplay tuning.
 */
(function initTableEval(Pin) {
    const FIXED_DT = 1 / 120;
    const STEPS = 900;
    const KNOWN_NUMERIC_FIELDS = [
        "x", "y", "w", "h", "radius", "length", "width", "top", "bottom",
        "thickness", "restAngle", "activeAngle", "flipSpeed", "flipAccel",
        "returnSpeed", "returnAccel", "maxPower", "maxRetract", "pullSpeed",
        "returnSpeed", "springStrength", "zStart", "zEnd"
    ];

    function clone(value) {
        return JSON.parse(JSON.stringify(value));
    }

    function isFiniteNumber(value) {
        return typeof value === "number" && Number.isFinite(value);
    }

    function hasPositiveNumber(value) {
        return isFiniteNumber(value) && value > 0;
    }

    function makeReport(meta) {
        return {
            tableId: meta.tableId || "unknown",
            tableName: meta.tableName || "Untitled Table",
            overall: "pass",
            summary: { passed: 0, warnings: 0, failed: 0 },
            checks: [],
            metrics: {
                elementCount: 0,
                segmentCount: 0,
                circleCount: 0,
                sensorCount: 0,
                stepsSimulated: 0,
                ballMoved: false,
                drained: false,
                launcherRayCount: 0,
                launcherStuckRays: 0,
                launcherDrainRays: 0,
                launcherTickLimitRays: 0,
                launcherCollisionLimitRays: 0,
                flipperRayCount: 0,
                flipperStuckRays: 0,
                flipperDrainRays: 0,
                flipperTickLimitRays: 0,
                flipperCollisionLimitRays: 0,
                targetReachabilitySourceCount: 0,
                targetReachabilityRayCount: 0,
                targetReachabilityReached: 0,
                targetReachabilityUnreached: 0,
                targetReachabilityBounceLimitRays: 0
            }
        };
    }

    function pathSegmentsFromElement(element) {
        if (!element || element.type !== "path" || !Array.isArray(element.anchors) || element.anchors.length < 2) return [];
        return Pin.geometry.pathToSegments(element.anchors, !!element.closed, 1).map(function map(seg) {
            return { x1: seg.x1, y1: seg.y1, x2: seg.x2, y2: seg.y2 };
        });
    }

    function findElementById(elements, id) {
        return (elements || []).find(function find(el) {
            return el && el.id === id;
        }) || null;
    }

    function baseElementDiagnostics(elements, ids) {
        const diagnostics = { objectIds: (ids || []).slice(), segments: [], rects: [], circles: [], points: [], labels: [] };
        (ids || []).forEach(function each(id) {
            const el = findElementById(elements, id);
            if (!el) return;
            if (el.type === "path") {
                diagnostics.segments = diagnostics.segments.concat(pathSegmentsFromElement(el));
            } else if (el.type === "launcher" && isFiniteNumber(el.x) && isFiniteNumber(el.top) && isFiniteNumber(el.bottom) && isFiniteNumber(el.width)) {
                diagnostics.rects.push({
                    x: el.x - el.width * 0.5,
                    y: el.top,
                    w: el.width,
                    h: el.bottom - el.top
                });
            } else if (el.type === "drain" && isFiniteNumber(el.x) && isFiniteNumber(el.y)) {
                diagnostics.rects.push({
                    x: el.x - (el.w || 120) * 0.5,
                    y: el.y - (el.h || 24) * 0.5,
                    w: el.w || 120,
                    h: el.h || 24
                });
            } else if (el.type === "flipper" && el.pivot && hasPositiveNumber(el.length)) {
                const restAngle = isFiniteNumber(el.restAngle) ? el.restAngle : 0;
                const activeAngle = isFiniteNumber(el.activeAngle) ? el.activeAngle : restAngle;
                diagnostics.segments.push({
                    x1: el.pivot.x,
                    y1: el.pivot.y,
                    x2: el.pivot.x + Math.cos(restAngle) * el.length,
                    y2: el.pivot.y + Math.sin(restAngle) * el.length
                });
                diagnostics.segments.push({
                    x1: el.pivot.x,
                    y1: el.pivot.y,
                    x2: el.pivot.x + Math.cos(activeAngle) * el.length,
                    y2: el.pivot.y + Math.sin(activeAngle) * el.length
                });
                diagnostics.points.push({ x: el.pivot.x, y: el.pivot.y });
            } else if (isFiniteNumber(el.x) && isFiniteNumber(el.y) && isFiniteNumber(el.radius)) {
                diagnostics.circles.push({ x: el.x, y: el.y, r: el.radius });
            } else if (isFiniteNumber(el.x) && isFiniteNumber(el.y) && isFiniteNumber(el.w) && isFiniteNumber(el.h)) {
                diagnostics.rects.push({
                    x: el.x - el.w * 0.5,
                    y: el.y - el.h * 0.5,
                    w: el.w,
                    h: el.h
                });
            } else if (isFiniteNumber(el.x) && isFiniteNumber(el.y)) {
                diagnostics.points.push({ x: el.x, y: el.y });
            }
        });
        return diagnostics;
    }

    function addCheck(report, check) {
        if (check && check.objects && !check.objectIds) check.objectIds = check.objects.slice();
        report.checks.push(check);
        if (check.status === "fail") report.summary.failed += 1;
        else if (check.status === "warn") report.summary.warnings += 1;
        else report.summary.passed += 1;
    }

    function finalizeOverall(report) {
        if (report.summary.failed > 0) report.overall = "fail";
        else if (report.summary.warnings > 0) report.overall = "warn";
        else report.overall = "pass";
    }

    function extractElements(table) {
        return Array.isArray(table && table.elements) ? table.elements : [];
    }

    function checkCoreShape(table, report) {
        if (!table || typeof table !== "object") {
            addCheck(report, {
                id: "table_object",
                category: "static",
                status: "fail",
                message: "Table must be an object.",
                objects: []
            });
            return false;
        }
        addCheck(report, {
            id: "table_object",
            category: "static",
            status: "pass",
            message: "Table object exists.",
            objects: []
        });
        return true;
    }

    function checkTableValidation(table, report) {
        if (!Pin.table || typeof Pin.table.validateTable !== "function") return;
        const structural = Pin.table.validateTable(table);
        if (structural.ok) {
            addCheck(report, {
                id: "validate_table",
                category: "static",
                status: "pass",
                message: "Table schema validation passed.",
                objects: []
            });
        } else {
            addCheck(report, {
                id: "validate_table",
                category: "static",
                status: "fail",
                message: "Table schema validation failed.",
                objects: []
            });
        }
        (structural.issues || []).forEach(function each(issue, index) {
            addCheck(report, {
                id: "schema_issue_" + index,
                category: "static",
                status: issue.severity === "error" ? "fail" : "warn",
                message: issue.message,
                objects: []
            });
        });
    }

    function checkPlayabilityValidation(table, report) {
        if (!Pin.table || typeof Pin.table.validatePlayability !== "function") return;
        const issues = Pin.table.validatePlayability(table);
        if (!issues.length) {
            addCheck(report, {
                id: "playability_issues",
                category: "static",
                status: "pass",
                message: "No playability warnings from baseline table validator.",
                objects: []
            });
            return;
        }
        issues.forEach(function each(issue, index) {
            addCheck(report, {
                id: "playability_issue_" + index,
                category: "static",
                status: issue.severity === "error" ? "fail" : "warn",
                message: issue.message,
                objects: []
            });
        });
    }

    function checkIdsAndTypes(elements, report) {
        const seen = {};
        let missing = 0;
        let duplicate = 0;
        const unknownTypeIds = [];
        elements.forEach(function each(el, idx) {
            if (!el || typeof el !== "object") return;
            if (typeof el.id !== "string" || !el.id.trim()) {
                missing += 1;
                return;
            }
            if (seen[el.id]) duplicate += 1;
            else seen[el.id] = true;
            if (!el.type || !Pin.elements || !Pin.elements.registry || !Pin.elements.registry[el.type]) {
                unknownTypeIds.push(el.id);
            }
            if (typeof el.type !== "string") {
                addCheck(report, {
                    id: "missing_type_" + idx,
                    category: "static",
                    status: "fail",
                    message: "Element is missing a valid type.",
                    objects: [el.id || "unknown"],
                    diagnostics: baseElementDiagnostics(elements, [el.id || "unknown"])
                });
            }
        });
        addCheck(report, {
            id: "element_ids_present",
            category: "static",
            status: missing ? "fail" : "pass",
            message: missing ? "Some elements are missing IDs." : "All elements have IDs.",
            objects: []
        });
        addCheck(report, {
            id: "element_ids_unique",
            category: "static",
            status: duplicate ? "fail" : "pass",
            message: duplicate ? "Duplicate element IDs detected." : "Element IDs are unique.",
            objects: []
        });
        addCheck(report, {
            id: "known_element_types",
            category: "static",
            status: unknownTypeIds.length ? "warn" : "pass",
            message: unknownTypeIds.length ?
                "Some element types are not registered in this runtime." :
                "All element types are recognized by the current runtime.",
            objects: unknownTypeIds,
            diagnostics: baseElementDiagnostics(elements, unknownTypeIds)
        });
    }

    function checkNumericFields(table, elements, report) {
        const pf = (table && table.playfield) || {};
        const playfieldValid = hasPositiveNumber(pf.width) && hasPositiveNumber(pf.height);
        addCheck(report, {
            id: "playfield_dimensions",
            category: "static",
            status: playfieldValid ? "pass" : "fail",
            message: playfieldValid ? "Playfield width and height are positive." : "Playfield dimensions are invalid.",
            objects: []
        });

        elements.forEach(function each(el) {
            if (!el || typeof el !== "object") return;
            KNOWN_NUMERIC_FIELDS.forEach(function eachField(key) {
                if (el[key] == null) return;
                if (!isFiniteNumber(el[key])) {
                    addCheck(report, {
                        id: "finite_" + key + "_" + (el.id || "unknown"),
                        category: "static",
                        status: "fail",
                        message: "Element field '" + key + "' must be finite.",
                        objects: [el.id || "unknown"],
                        diagnostics: baseElementDiagnostics(elements, [el.id || "unknown"])
                    });
                }
            });
            if (el.type === "path" && Array.isArray(el.anchors)) {
                el.anchors.forEach(function eachAnchor(anchor, idx) {
                    if (!anchor || !isFiniteNumber(anchor.x) || !isFiniteNumber(anchor.y)) {
                        addCheck(report, {
                            id: "anchor_finite_" + (el.id || "unknown") + "_" + idx,
                            category: "static",
                            status: "fail",
                            message: "Path anchor coordinates must be finite.",
                            objects: [el.id || "unknown"],
                            diagnostics: {
                                objectIds: [el.id || "unknown"],
                                segments: pathSegmentsFromElement(el),
                                points: [{ x: anchor && anchor.x, y: anchor && anchor.y }],
                                labels: [{ text: "Bad anchor " + idx, x: (anchor && anchor.x) || 20, y: (anchor && anchor.y) || 20 }]
                            }
                        });
                    }
                });
            }
            if (el.type === "drain") {
                const ok = hasPositiveNumber(el.w || 0) && hasPositiveNumber(el.h || 0);
                addCheck(report, {
                    id: "drain_size_" + (el.id || "unknown"),
                    category: "geometry",
                    status: ok ? "pass" : "fail",
                    message: ok ? "Drain dimensions look valid." : "Drain width/height must be positive.",
                    objects: [el.id || "unknown"],
                    diagnostics: baseElementDiagnostics(elements, [el.id || "unknown"])
                });
            }
            if (el.type === "launcher") {
                const widthOk = hasPositiveNumber(el.width || 0);
                const laneOk = isFiniteNumber(el.top) && isFiniteNumber(el.bottom) && el.bottom > el.top;
                addCheck(report, {
                    id: "launcher_shape_" + (el.id || "unknown"),
                    category: "geometry",
                    status: widthOk && laneOk ? "pass" : "fail",
                    message: widthOk && laneOk ? "Launcher dimensions are valid." : "Launcher width/top/bottom are invalid.",
                    objects: [el.id || "unknown"],
                    diagnostics: baseElementDiagnostics(elements, [el.id || "unknown"])
                });
            }
        });
    }

    function checkBounds(table, elements, report) {
        const pf = (table && table.playfield) || {};
        if (!hasPositiveNumber(pf.width) || !hasPositiveNumber(pf.height)) return;
        const margin = 96;
        const outside = [];
        elements.forEach(function each(el) {
            if (!el || typeof el !== "object") return;
            const x = el.x;
            const y = el.y;
            if (!isFiniteNumber(x) || !isFiniteNumber(y)) return;
            if (x < -margin || y < -margin || x > pf.width + margin || y > pf.height + margin) {
                outside.push(el.id || "unknown");
            }
        });
        addCheck(report, {
            id: "elements_near_playfield",
            category: "geometry",
            status: outside.length ? "warn" : "pass",
            message: outside.length ? "Some elements are far outside playfield bounds." : "Elements are within expected bounds.",
            objects: outside,
            diagnostics: {
                objectIds: outside.slice(),
                rects: [{ x: 0, y: 0, w: pf.width, h: pf.height }],
                labels: [{ text: "Playfield bounds", x: 8, y: 16 }]
            }
        });
    }

    function buildEvalWorld(table) {
        const staticRuntime = Pin.elements.compileElements(table, null, { dynamic: false });
        const dynamicElements = Pin.elements.filterElements ?
            Pin.elements.filterElements(table, Pin.elements.isDynamicPhysicsType) :
            (table.elements || []);
        const dynamicRuntime = Pin.elements.compileElements(table, null, {
            static: false,
            dynamicPhysicsOnly: true,
            elements: dynamicElements
        });
        const world = {
            table: table,
            balls: [],
            score: 0,
            events: [],
            ruleState: {},
            lampState: {},
            currentBall: 1,
            ballsRemaining: 1,
            controls: { left: false, right: false },
            elementState: {},
            staticRuntime: staticRuntime,
            staticSegments: staticRuntime.segments || [],
            staticCircles: staticRuntime.circles || [],
            staticRamps: staticRuntime.ramps || [],
            staticSensors: staticRuntime.sensors || [],
            dynamicPhysicsElements: dynamicElements,
            dynamicRuntime: dynamicRuntime,
            dynamicSegments: dynamicRuntime.segments || [],
            dynamicCircles: dynamicRuntime.circles || [],
            dynamicRamps: dynamicRuntime.ramps || [],
            dynamicSensors: dynamicRuntime.sensors || [],
            runtime: {
                segments: (staticRuntime.segments || []).concat(dynamicRuntime.segments || []),
                circles: (staticRuntime.circles || []).concat(dynamicRuntime.circles || []),
                ramps: (staticRuntime.ramps || []).concat(dynamicRuntime.ramps || []),
                sensors: (staticRuntime.sensors || []).concat(dynamicRuntime.sensors || []),
                drawables: (staticRuntime.drawables || []).concat(dynamicRuntime.drawables || [])
            },
            runtimeSegments: [],
            runtimeCircles: [],
            runtimeRamps: [],
            runtimeSensors: [],
            physicsTick: 0,
            physicsTime: 0,
            lastPhysicsDt: FIXED_DT,
            staticBroadPhase: Pin.physics.buildBroadPhase(staticRuntime.segments || [], staticRuntime.circles || [], table.playfield),
            staticSensorBroadPhase: Pin.physics.buildSensorBroadPhase(staticRuntime.sensors || [])
        };
        world.runtimeSegments = world.runtime.segments;
        world.runtimeCircles = world.runtime.circles;
        world.runtimeRamps = world.runtime.ramps;
        world.runtimeSensors = world.runtime.sensors;
        return world;
    }

    function refreshDynamicRuntime(world) {
        const dynamicRuntime = Pin.elements.compileElements(world.table, world, {
            static: false,
            dynamicPhysicsOnly: true,
            elements: world.dynamicPhysicsElements
        });
        world.dynamicRuntime = dynamicRuntime;
        world.dynamicSegments = dynamicRuntime.segments || [];
        world.dynamicCircles = dynamicRuntime.circles || [];
        world.dynamicRamps = dynamicRuntime.ramps || [];
        world.dynamicSensors = dynamicRuntime.sensors || [];
        world.runtime = {
            segments: (world.staticRuntime.segments || []).concat(world.dynamicRuntime.segments || []),
            circles: (world.staticRuntime.circles || []).concat(world.dynamicRuntime.circles || []),
            ramps: (world.staticRuntime.ramps || []).concat(world.dynamicRuntime.ramps || []),
            sensors: (world.staticRuntime.sensors || []).concat(world.dynamicRuntime.sensors || []),
            drawables: (world.staticRuntime.drawables || []).concat(world.dynamicRuntime.drawables || [])
        };
        world.runtimeSegments = world.runtime.segments;
        world.runtimeCircles = world.runtime.circles;
        world.runtimeRamps = world.runtime.ramps;
        world.runtimeSensors = world.runtime.sensors;
    }

    function placeInitialBall(world, report) {
        const launcher = Pin.physics.getLauncherConfig(world);
        if (launcher && launcher.element) {
            world.balls = [{
                x: launcher.x,
                y: launcher.y,
                radius: world.table.playfield.ballRadius || 8,
                vx: 0,
                vy: 0,
                level: 0,
                inLaunchLane: true
            }];
            Pin.physics.releaseLauncher(world);
            addCheck(report, {
                id: "spawn_ball",
                category: "physics",
                status: "pass",
                message: "Ball spawned in launcher lane and released.",
                objects: [launcher.id || "launcher"]
            });
            return true;
        }
        const pf = world.table.playfield || {};
        if (!hasPositiveNumber(pf.width) || !hasPositiveNumber(pf.height)) {
            addCheck(report, {
                id: "spawn_ball",
                category: "physics",
                status: "fail",
                message: "Cannot infer spawn because playfield dimensions are invalid.",
                objects: []
            });
            return false;
        }
        world.balls = [{
            x: pf.width * 0.5,
            y: Math.min(80, pf.height * 0.2),
            radius: pf.ballRadius || 8,
            vx: 0,
            vy: 0,
            level: 0
        }];
        addCheck(report, {
            id: "spawn_ball",
            category: "physics",
            status: "warn",
            message: "No launcher element found; used fallback spawn.",
            objects: []
        });
        return true;
    }

    function runPhysicsSanity(world, report) {
        if (!world.balls.length) {
            addCheck(report, {
                id: "physics_steps",
                category: "physics",
                status: "fail",
                message: "No ball available for physics sanity checks.",
                objects: []
            });
            return;
        }
        const start = { x: world.balls[0].x, y: world.balls[0].y };
        let invalid = false;
        let escaped = false;
        let drained = false;
        const trajectory = [];
        const pf = world.table.playfield || {};
        for (let i = 0; i < STEPS; i++) {
            refreshDynamicRuntime(world);
            world.lastPhysicsDt = FIXED_DT;
            Pin.physics.stepWorld(world, FIXED_DT);
            report.metrics.stepsSimulated += 1;
            const ball = world.balls[0];
            if (!ball) break;
            if (trajectory.length < 240) {
                trajectory.push({ x: ball.x, y: ball.y });
            }
            if (
                !isFiniteNumber(ball.x) || !isFiniteNumber(ball.y) ||
                !isFiniteNumber(ball.vx) || !isFiniteNumber(ball.vy)
            ) {
                invalid = true;
                break;
            }
            if (ball.drained) drained = true;
            if (hasPositiveNumber(pf.width) && hasPositiveNumber(pf.height)) {
                if (ball.x < -240 || ball.x > pf.width + 240 || ball.y < -240 || ball.y > pf.height + 280) {
                    if (!ball.drained) escaped = true;
                    break;
                }
            }
        }
        const ball = world.balls[0];
        const moved = ball ? ((ball.x - start.x) * (ball.x - start.x) + (ball.y - start.y) * (ball.y - start.y)) > 16 : drained;
        report.metrics.ballMoved = moved;
        report.metrics.drained = drained;

        addCheck(report, {
            id: "physics_numeric_stability",
            category: "physics",
            status: invalid ? "fail" : "pass",
            message: invalid ? "Physics produced invalid numeric state (NaN/Infinity)." : "Physics numeric state remained finite.",
            objects: [],
            diagnostics: { trajectory: trajectory.slice() }
        });
        addCheck(report, {
            id: "physics_motion",
            category: "physics",
            status: moved ? "pass" : "warn",
            message: moved ? "Ball moved under physics." : "Ball showed little movement in probe window.",
            objects: [],
            diagnostics: { trajectory: trajectory.slice() }
        });
        addCheck(report, {
            id: "world_bounds",
            category: "physics",
            status: escaped ? "fail" : "pass",
            message: escaped ? "Ball escaped sensible world bounds without draining." : "Ball stayed in sensible bounds or drained.",
            objects: [],
            diagnostics: {
                trajectory: trajectory.slice(),
                rects: hasPositiveNumber(pf.width) && hasPositiveNumber(pf.height) ? [{ x: 0, y: 0, w: pf.width, h: pf.height }] : []
            }
        });
        addCheck(report, {
            id: "drain_observed",
            category: "physics",
            status: drained ? "pass" : "warn",
            message: drained ? "Ball drained during probe." : "Ball did not drain during probe window.",
            objects: [],
            diagnostics: { trajectory: trajectory.slice() }
        });
    }

    function checkCompilation(table, report) {
        try {
            const world = buildEvalWorld(table);
            report.metrics.elementCount = extractElements(table).length;
            report.metrics.segmentCount = (world.runtimeSegments || []).length;
            report.metrics.circleCount = (world.runtimeCircles || []).length;
            report.metrics.sensorCount = (world.runtimeSensors || []).length;
            addCheck(report, {
                id: "compile_runtime",
                category: "geometry",
                status: "pass",
                message: "Element runtime compilation succeeded.",
                objects: []
            });
            if (placeInitialBall(world, report)) runPhysicsSanity(world, report);
        } catch (error) {
            addCheck(report, {
                id: "compile_runtime",
                category: "geometry",
                status: "fail",
                message: "Runtime compilation failed: " + (error && error.message ? error.message : "Unknown error"),
                objects: []
            });
        }
    }

    function launcherFromElements(elements) {
        return (elements || []).find(function find(el) {
            return el && el.type === "launcher" && isFiniteNumber(el.x) && isFiniteNumber(el.top) && isFiniteNumber(el.bottom);
        }) || null;
    }

    function flippersFromElements(elements) {
        return (elements || []).filter(function filter(el) {
            return el &&
                el.type === "flipper" &&
                el.pivot &&
                isFiniteNumber(el.pivot.x) &&
                isFiniteNumber(el.pivot.y) &&
                hasPositiveNumber(el.length);
        });
    }

    function drainRectsFromElements(elements) {
        return (elements || []).filter(function filter(el) {
            return el && el.type === "drain" && isFiniteNumber(el.x) && isFiniteNumber(el.y);
        }).map(function map(el) {
            const w = el.w || 120;
            const h = el.h || 24;
            return {
                id: el.id || "drain",
                x: el.x - w * 0.5,
                y: el.y - h * 0.5,
                w: w,
                h: h
            };
        });
    }

    function pointInRect(point, rect) {
        return point.x >= rect.x && point.x <= rect.x + rect.w && point.y >= rect.y && point.y <= rect.y + rect.h;
    }

    /* What: Bound the user-requested launch probe count.
     * Why: each probe runs the real physics loop, so the lab needs an explicit
     * operator limit while still allowing dense launch-envelope sweeps.
     */
    function normalizedLauncherRayCount(value) {
        const count = Math.round(Number(value));
        if (!Number.isFinite(count)) return 5;
        return Math.max(1, Math.min(500, count));
    }

    function normalizedProbeLimit(value, fallback, min, max) {
        const count = Math.round(Number(value));
        if (!Number.isFinite(count)) return fallback;
        return Math.max(min, Math.min(max, count));
    }

    /* What: Spread launch samples across short tap through full hold.
     * Why: stuck detection needs to sample player launch strength without
     * inventing a separate launch model outside the production launcher state.
     */
    function launcherHoldSecondsForIndex(index, count) {
        if (count <= 1) return 0;
        return (index / (count - 1)) * 2;
    }

    /* What: Spread flipper samples from inner blade through the tip.
     * Why: a reachability probe from a single contact point can miss obvious
     * stuck envelopes, while a bounded contact sweep stays inspectable.
     */
    function flipperContactTForIndex(index, count) {
        if (count <= 1) return 0.55;
        return 0.18 + (index / (count - 1)) * 0.72;
    }

    /* What: Resolve the runtime control name for a table flipper.
     * Why: evaluation must press the same left/right/custom control that the
     * element compiler reads during normal play.
     */
    function flipperControlName(flipper, table) {
        if (flipper.control) return flipper.control;
        if (flipper.side) return flipper.side;
        if (table && table.playfield && flipper.pivot && isFiniteNumber(table.playfield.width)) {
            return flipper.pivot.x > table.playfield.width * 0.5 ? "right" : "left";
        }
        if (isFiniteNumber(flipper.restAngle) && Math.cos(flipper.restAngle) < 0) return "right";
        return "left";
    }

    /* What: Compute the ball-side normal used to stage a flipper shot.
     * Why: the probe must place the ball outside the blade by ball radius and
     * flipper thickness, not on the geometric centerline.
     */
    function flipperLiftNormal(flipper, angle, table) {
        const control = flipperControlName(flipper, table);
        let nx;
        let ny;
        if (control === "right") {
            nx = -Math.sin(angle);
            ny = Math.cos(angle);
        } else {
            nx = Math.sin(angle);
            ny = -Math.cos(angle);
        }
        if (ny > 0) {
            nx = -nx;
            ny = -ny;
        }
        return { x: nx, y: ny };
    }

    /* What: Stage a real ball in the compiled launcher lane.
     * Why: probe trajectories must start from the same state shape that the
     * play sandbox uses so launcher gates and lane contacts stay authoritative.
     */
    function makeLauncherBall(launcher, playfield) {
        const radius = hasPositiveNumber(playfield && playfield.ballRadius) ? playfield.ballRadius : 8;
        return {
            x: launcher.x,
            y: launcher.bottom - radius - 1,
            radius: radius,
            vx: 0,
            vy: 0,
            level: 0,
            inLaunchLane: true
        };
    }

    /* What: Stage a real ball at a sampled point on a real flipper blade.
     * Why: flipper reachability probes need ball diameter and blade thickness
     * baked into the initial state before the production collision solver runs.
     */
    function makeFlipperShotBall(flipper, table, contactT) {
        const playfield = (table && table.playfield) || {};
        const radius = hasPositiveNumber(playfield.ballRadius) ? playfield.ballRadius : 8;
        const thickness = hasPositiveNumber(flipper.thickness) ? flipper.thickness : 10;
        const angle = isFiniteNumber(flipper.restAngle) ? flipper.restAngle : 0;
        const normal = flipperLiftNormal(flipper, angle, table);
        const t = Math.max(0.08, Math.min(0.96, contactT));
        const bladeX = flipper.pivot.x + Math.cos(angle) * flipper.length * t;
        const bladeY = flipper.pivot.y + Math.sin(angle) * flipper.length * t;
        return {
            x: bladeX + normal.x * (radius + thickness + 0.5),
            y: bladeY + normal.y * (radius + thickness + 0.5),
            radius: radius,
            vx: 0,
            vy: 0,
            level: 0,
            flipperContactT: t
        };
    }

    /* What: Advance the evaluation world one fixed timestep.
     * Why: dynamic elements such as launchers and flippers compile from current
     * world state, so probes refresh that runtime before each physics step.
     */
    function stepEvalWorld(world) {
        refreshDynamicRuntime(world);
        world.lastPhysicsDt = FIXED_DT;
        Pin.physics.stepWorld(world, FIXED_DT);
    }

    /* What: Hold the production launcher for a sampled duration and release it.
     * Why: this converts a user-facing hold time into the same plunger state and
     * strike velocity used by interactive play.
     */
    function chargeLauncherForHold(world, holdSeconds) {
        const chargeSteps = Math.max(0, Math.round(holdSeconds / FIXED_DT));
        world.launchCharging = true;
        for (let i = 0; i < chargeSteps; i++) {
            stepEvalWorld(world);
        }
        world.launchCharging = false;
        Pin.physics.releaseLauncher(world);
    }

    /* What: Run one launcher geodesic using only the core physics engine.
     * Why: this is the atomic stuck probe; it records where the ball actually
     * travels after a sampled launcher hold and flags repeated low-resolution
     * states as a possible stuck envelope.
     */
    function recordTrajectoryPoint(path, ball, stepIndex, force) {
        if (!ball || !isFiniteNumber(ball.x) || !isFiniteNumber(ball.y)) return;
        if (!force && path.length >= 900) return;
        if (force || stepIndex < 300 || stepIndex % 8 === 0) {
            path.push({ x: ball.x, y: ball.y });
        }
    }

    function traceLauncherRay(table, elements, playfield, holdSeconds, index, limits) {
        if (!launcherFromElements(elements)) {
            return { ok: false, reason: "no_launcher" };
        }
        const world = buildEvalWorld(table);
        const launcher = Pin.physics.getLauncherConfig(world);
        if (!launcher || !launcher.element) return { ok: false, reason: "no_launcher" };
        world.balls = [makeLauncherBall(launcher, playfield)];
        chargeLauncherForHold(world, holdSeconds || 0);
        const path = [];
        const hitObjectIds = [];
        const visited = {};
        let reachedDrain = false;
        let escaped = false;
        const drains = drainRectsFromElements(elements);
        const maxTicks = limits.maxTicks;
        const maxCollisions = limits.maxCollisions;
        let exitedLauncher = false;
        let limitReason = "";
        world.physicsCollisionCount = 0;
        for (let i = 0; i < maxTicks; i++) {
            stepEvalWorld(world);
            const ball = world.balls[0];
            if (!ball) break;
            if (!isFiniteNumber(ball.x) || !isFiniteNumber(ball.y) || !isFiniteNumber(ball.vx) || !isFiniteNumber(ball.vy)) {
                escaped = true;
                break;
            }
            if (!ball.inLaunchLane) exitedLauncher = true;
            recordTrajectoryPoint(path, ball, i, false);
            if (ball.drained || drains.some(function some(rect) { return pointInRect(ball, rect); })) {
                reachedDrain = true;
                recordTrajectoryPoint(path, ball, i, true);
                break;
            }
            if ((world.physicsCollisionCount || 0) >= maxCollisions) {
                limitReason = "collisions";
                recordTrajectoryPoint(path, ball, i, true);
                break;
            }
            if ((world.physicsTick || 0) >= maxTicks) {
                limitReason = "ticks";
                recordTrajectoryPoint(path, ball, i, true);
                break;
            }
            const stateKey =
                Math.round(ball.x / 8) + "|" +
                Math.round(ball.y / 8) + "|" +
                Math.round(ball.vx * 10) + "|" +
                Math.round(ball.vy * 10);
            visited[stateKey] = (visited[stateKey] || 0) + 1;
            if (visited[stateKey] >= 6) {
                return {
                    ok: true,
                    stuckLikely: true,
                    reachedDrain: false,
                    escaped: false,
                    bounces: i + 1,
                    ticks: world.physicsTick || i + 1,
                    collisions: world.physicsCollisionCount || 0,
                    limitReason: "repeat",
                    exitedLauncher: exitedLauncher,
                    holdSeconds: holdSeconds || 0,
                    sampleIndex: index || 0,
                    path: path,
                    wallIds: hitObjectIds,
                    simulatedLaunch: true
                };
            }
            if (
                hasPositiveNumber(playfield && playfield.width) &&
                hasPositiveNumber(playfield && playfield.height) &&
                (ball.x < -220 || ball.x > playfield.width + 220 || ball.y < -220 || ball.y > playfield.height + 220)
            ) {
                escaped = true;
                recordTrajectoryPoint(path, ball, i, true);
                break;
            }
        }
        if (!reachedDrain && !escaped && !limitReason && (world.physicsTick || 0) >= maxTicks) {
            limitReason = "ticks";
        }

        return {
            ok: true,
            stuckLikely: limitReason === "ticks" || limitReason === "collisions",
            reachedDrain: reachedDrain,
            escaped: escaped,
            exitedLauncher: exitedLauncher,
            ticks: world.physicsTick || maxTicks,
            collisions: world.physicsCollisionCount || 0,
            limitReason: limitReason,
            holdSeconds: holdSeconds || 0,
            sampleIndex: index || 0,
            simulatedLaunch: true,
            bounces: path.length - 1,
            path: path,
            wallIds: hitObjectIds
        };
    }

    /* What: Run one flipper-origin geodesic through the core physics engine.
     * Why: reachability must use the same flipper motion, ball radius, collision
     * response, drain handling, and stuck limits as normal gameplay.
     */
    function traceFlipperRay(table, elements, playfield, flipper, contactT, index, limits) {
        const world = buildEvalWorld(table);
        const control = flipperControlName(flipper, table);
        world.controls[control] = false;
        refreshDynamicRuntime(world);
        world.balls = [makeFlipperShotBall(flipper, table, contactT)];
        const path = [];
        const visited = {};
        const drains = drainRectsFromElements(elements);
        const maxTicks = limits.maxTicks;
        const maxCollisions = limits.maxCollisions;
        let reachedDrain = false;
        let escaped = false;
        let limitReason = "";
        world.physicsCollisionCount = 0;
        world.controls[control] = true;
        recordTrajectoryPoint(path, world.balls[0], 0, true);

        for (let i = 0; i < maxTicks; i++) {
            stepEvalWorld(world);
            const ball = world.balls[0];
            if (!ball) break;
            if (!isFiniteNumber(ball.x) || !isFiniteNumber(ball.y) || !isFiniteNumber(ball.vx) || !isFiniteNumber(ball.vy)) {
                escaped = true;
                break;
            }
            recordTrajectoryPoint(path, ball, i, false);
            if (ball.drained || drains.some(function some(rect) { return pointInRect(ball, rect); })) {
                reachedDrain = true;
                recordTrajectoryPoint(path, ball, i, true);
                break;
            }
            if ((world.physicsCollisionCount || 0) >= maxCollisions) {
                limitReason = "collisions";
                recordTrajectoryPoint(path, ball, i, true);
                break;
            }
            if ((world.physicsTick || 0) >= maxTicks) {
                limitReason = "ticks";
                recordTrajectoryPoint(path, ball, i, true);
                break;
            }
            const stateKey =
                Math.round(ball.x / 8) + "|" +
                Math.round(ball.y / 8) + "|" +
                Math.round(ball.vx * 10) + "|" +
                Math.round(ball.vy * 10);
            visited[stateKey] = (visited[stateKey] || 0) + 1;
            if (visited[stateKey] >= 6) {
                limitReason = "repeat";
                recordTrajectoryPoint(path, ball, i, true);
                break;
            }
            if (
                hasPositiveNumber(playfield && playfield.width) &&
                hasPositiveNumber(playfield && playfield.height) &&
                (ball.x < -220 || ball.x > playfield.width + 220 || ball.y < -220 || ball.y > playfield.height + 220)
            ) {
                escaped = true;
                recordTrajectoryPoint(path, ball, i, true);
                break;
            }
        }
        if (!reachedDrain && !escaped && !limitReason && (world.physicsTick || 0) >= maxTicks) {
            limitReason = "ticks";
        }

        return {
            ok: true,
            stuckLikely: limitReason === "ticks" || limitReason === "collisions" || limitReason === "repeat",
            reachedDrain: reachedDrain,
            escaped: escaped,
            ticks: world.physicsTick || maxTicks,
            collisions: world.physicsCollisionCount || 0,
            limitReason: limitReason,
            flipperId: flipper.id || "flipper",
            control: control,
            contactT: contactT,
            sampleIndex: index || 0,
            simulatedFlipperShot: true,
            bounces: path.length - 1,
            path: path
        };
    }

    function launcherProbeLimits(options) {
        return {
            count: normalizedLauncherRayCount(options && options.launchRayCount),
            maxCollisions: normalizedProbeLimit(options && options.launchMaxCollisions, 400, 1, 5000),
            maxTicks: normalizedProbeLimit(options && options.launchMaxTicks, 10000, 60, 60000)
        };
    }

    function targetReachabilityLimits(options) {
        return {
            count: normalizedProbeLimit(options && options.targetRayCount, 7, 1, 120),
            spreadDeg: normalizedProbeLimit(options && options.targetSpreadDeg, 16, 0, 80),
            maxBounces: normalizedProbeLimit(options && options.targetMaxBounces, 5, 0, 60),
            maxTicks: normalizedProbeLimit(options && options.launchMaxTicks, 10000, 60, 60000)
        };
    }

    function angleInSweep(angle, fromAngle, toAngle) {
        const span = Math.atan2(Math.sin(toAngle - fromAngle), Math.cos(toAngle - fromAngle));
        const rel = Math.atan2(Math.sin(angle - fromAngle), Math.cos(angle - fromAngle));
        if (span >= 0) return rel >= -1e-6 && rel <= span + 1e-6;
        return rel <= 1e-6 && rel >= span - 1e-6;
    }

    function flipperArcEnvelope(flipper, table) {
        const playfield = (table && table.playfield) || {};
        const radius = hasPositiveNumber(playfield.ballRadius) ? playfield.ballRadius : 8;
        const thickness = hasPositiveNumber(flipper.thickness) ? flipper.thickness : 10;
        const restAngle = isFiniteNumber(flipper.restAngle) ? flipper.restAngle : 0;
        const activeAngle = isFiniteNumber(flipper.activeAngle) ? flipper.activeAngle : restAngle;
        return {
            id: flipper.id || "flipper",
            px: flipper.pivot.x,
            py: flipper.pivot.y,
            minR: Math.max(6, thickness * 0.45),
            maxR: flipper.length + radius + thickness,
            fromAngle: restAngle,
            toAngle: activeAngle
        };
    }

    function arcSegments(envelope, radius, steps) {
        const segs = [];
        if (!envelope || !isFiniteNumber(radius)) return segs;
        const stepCount = Math.max(3, steps || 20);
        const delta = Math.atan2(
            Math.sin(envelope.toAngle - envelope.fromAngle),
            Math.cos(envelope.toAngle - envelope.fromAngle)
        );
        let prev = null;
        for (let i = 0; i <= stepCount; i++) {
            const t = i / stepCount;
            const a = envelope.fromAngle + delta * t;
            const p = {
                x: envelope.px + Math.cos(a) * radius,
                y: envelope.py + Math.sin(a) * radius
            };
            if (prev) {
                segs.push({ x1: prev.x, y1: prev.y, x2: p.x, y2: p.y });
            }
            prev = p;
        }
        return segs;
    }

    function ballIntersectsFlipperEnvelope(ball, envelope) {
        const dx = ball.x - envelope.px;
        const dy = ball.y - envelope.py;
        const radius = Math.sqrt(dx * dx + dy * dy);
        if (radius < envelope.minR || radius > envelope.maxR) return false;
        const angle = Math.atan2(dy, dx);
        return angleInSweep(angle, envelope.fromAngle, envelope.toAngle);
    }

    function targetSourceTypeSet() {
        return {
            lane: true,
            dropTarget: true,
            bumper: true,
            scoreZone: true,
            drain: true,
            spinner: true,
            kicker: true,
            trough: true,
            gate: true
        };
    }

    function logicTriggerSourceElements(table, elements) {
        const byId = {};
        (elements || []).forEach(function each(el) {
            if (el && typeof el.id === "string") byId[el.id] = el;
        });
        const out = [];
        const seen = {};
        const switchRegistry = Array.isArray(table && table.switchRegistry) ? table.switchRegistry : [];
        switchRegistry.forEach(function each(sw) {
            if (!sw) return;
            const sourceId = typeof sw.sourceElementId === "string" && sw.sourceElementId ? sw.sourceElementId :
                (typeof sw.id === "string" ? sw.id : "");
            const element = byId[sourceId];
            if (!element || !element.id || seen[element.id]) return;
            seen[element.id] = true;
            out.push(element);
        });
        if (out.length) return out;
        const allowed = targetSourceTypeSet();
        return (elements || []).filter(function filter(el) {
            return el && el.id && allowed[el.type];
        });
    }

    function sourceOriginForElement(el) {
        if (!el) return null;
        if (isFiniteNumber(el.x) && isFiniteNumber(el.y)) return { x: el.x, y: el.y };
        if (el.type === "path" && Array.isArray(el.anchors) && el.anchors.length >= 2) {
            const a = el.anchors[0];
            const b = el.anchors[1];
            if (a && b && isFiniteNumber(a.x) && isFiniteNumber(a.y) && isFiniteNumber(b.x) && isFiniteNumber(b.y)) {
                return { x: (a.x + b.x) * 0.5, y: (a.y + b.y) * 0.5 };
            }
        }
        if (el.pivot && isFiniteNumber(el.pivot.x) && isFiniteNumber(el.pivot.y)) {
            return { x: el.pivot.x, y: el.pivot.y };
        }
        return null;
    }

    function spreadRadiansForIndex(index, count, spreadDeg) {
        if (count <= 1 || spreadDeg <= 0) return 0;
        const t = count <= 1 ? 0.5 : (index / (count - 1));
        return ((t * 2) - 1) * (spreadDeg * Math.PI / 180);
    }

    function traceTargetRay(table, elements, source, targetFlipper, rayIndex, limits) {
        const sourceOrigin = sourceOriginForElement(source);
        if (!sourceOrigin || !targetFlipper || !targetFlipper.pivot) {
            return { ok: false, reason: "bad_source" };
        }
        const world = buildEvalWorld(table);
        const playfield = (table && table.playfield) || {};
        const ballRadius = hasPositiveNumber(playfield.ballRadius) ? playfield.ballRadius : 8;
        const envelope = flipperArcEnvelope(targetFlipper, table);
        const toPivotX = targetFlipper.pivot.x - sourceOrigin.x;
        const toPivotY = targetFlipper.pivot.y - sourceOrigin.y;
        const baseAngle = Math.atan2(toPivotY, toPivotX);
        const angle = baseAngle + spreadRadiansForIndex(rayIndex, limits.count, limits.spreadDeg);
        const probeSpeed = 15;
        world.balls = [{
            x: sourceOrigin.x,
            y: sourceOrigin.y,
            radius: ballRadius,
            vx: Math.cos(angle) * probeSpeed,
            vy: Math.sin(angle) * probeSpeed,
            level: 0
        }];
        const path = [];
        const visited = {};
        let reachedFlipperArc = false;
        let escaped = false;
        let limitReason = "";
        world.physicsCollisionCount = 0;
        recordTrajectoryPoint(path, world.balls[0], 0, true);

        for (let i = 0; i < limits.maxTicks; i++) {
            stepEvalWorld(world);
            const ball = world.balls[0];
            if (!ball) break;
            if (!isFiniteNumber(ball.x) || !isFiniteNumber(ball.y) || !isFiniteNumber(ball.vx) || !isFiniteNumber(ball.vy)) {
                escaped = true;
                break;
            }
            recordTrajectoryPoint(path, ball, i, false);
            if (ballIntersectsFlipperEnvelope(ball, envelope)) {
                reachedFlipperArc = true;
                recordTrajectoryPoint(path, ball, i, true);
                break;
            }
            if ((world.physicsCollisionCount || 0) > limits.maxBounces) {
                limitReason = "bounces";
                recordTrajectoryPoint(path, ball, i, true);
                break;
            }
            if (ball.drained) {
                limitReason = "drained";
                break;
            }
            const stateKey =
                Math.round(ball.x / 8) + "|" +
                Math.round(ball.y / 8) + "|" +
                Math.round(ball.vx * 10) + "|" +
                Math.round(ball.vy * 10);
            visited[stateKey] = (visited[stateKey] || 0) + 1;
            if (visited[stateKey] >= 6) {
                limitReason = "repeat";
                recordTrajectoryPoint(path, ball, i, true);
                break;
            }
            if (
                hasPositiveNumber(playfield.width) &&
                hasPositiveNumber(playfield.height) &&
                (ball.x < -220 || ball.x > playfield.width + 220 || ball.y < -220 || ball.y > playfield.height + 220)
            ) {
                escaped = true;
                recordTrajectoryPoint(path, ball, i, true);
                break;
            }
        }

        return {
            ok: true,
            sourceId: source.id || "source",
            targetFlipperId: targetFlipper.id || "flipper",
            reached: reachedFlipperArc,
            escaped: escaped,
            collisions: world.physicsCollisionCount || 0,
            ticks: world.physicsTick || 0,
            limitReason: limitReason,
            path: path,
            origin: sourceOrigin,
            envelope: envelope
        };
    }

    function addTargetReachabilityCheck(report, traces, sources, elements, limits) {
        if (!sources.length) {
            addCheck(report, {
                id: "reachability_target_to_flipper",
                category: "reachability",
                status: "warn",
                message: "Target-to-flipper reachability skipped: no trigger source elements found.",
                objects: [],
                diagnostics: {}
            });
            return;
        }
        const reachedBySource = {};
        traces.forEach(function each(trace) {
            if (trace.reached) reachedBySource[trace.sourceId] = true;
        });
        const unreached = sources.filter(function filter(source) {
            return !reachedBySource[source.id];
        }).map(function map(source) {
            return source.id;
        });
        const bounceLimited = traces.filter(function filter(trace) { return trace.limitReason === "bounces"; });
        report.metrics.targetReachabilitySourceCount = sources.length;
        report.metrics.targetReachabilityRayCount = traces.length;
        report.metrics.targetReachabilityReached = sources.length - unreached.length;
        report.metrics.targetReachabilityUnreached = unreached.length;
        report.metrics.targetReachabilityBounceLimitRays = bounceLimited.length;

        const status = unreached.length ? "warn" : "pass";
        const message = unreached.length ?
            ("Target-to-flipper reachability did not reach a flipper arc for " + unreached.length + " of " + sources.length + " trigger sources.") :
            ("Target-to-flipper reachability reached a flipper arc for all " + sources.length + " trigger sources.");
        const sourceIds = sources.map(function map(source) { return source.id; });
        const diagnostics = baseElementDiagnostics(elements, sourceIds);
        const envelopeLabels = [];
        const envelopeByFlipper = {};
        traces.forEach(function each(trace) {
            if (!trace.envelope || !trace.targetFlipperId) return;
            if (!envelopeByFlipper[trace.targetFlipperId]) {
                envelopeByFlipper[trace.targetFlipperId] = trace.envelope;
            }
        });
        Object.keys(envelopeByFlipper).forEach(function each(flipperId, index) {
            const envelope = envelopeByFlipper[flipperId];
            const fromX = envelope.px + Math.cos(envelope.fromAngle) * envelope.maxR;
            const fromY = envelope.py + Math.sin(envelope.fromAngle) * envelope.maxR;
            const toX = envelope.px + Math.cos(envelope.toAngle) * envelope.maxR;
            const toY = envelope.py + Math.sin(envelope.toAngle) * envelope.maxR;
            diagnostics.segments = diagnostics.segments.concat(arcSegments(envelope, envelope.maxR, 28));
            diagnostics.segments = diagnostics.segments.concat(arcSegments(envelope, envelope.minR, 28));
            diagnostics.segments.push({ x1: envelope.px, y1: envelope.py, x2: fromX, y2: fromY });
            diagnostics.segments.push({ x1: envelope.px, y1: envelope.py, x2: toX, y2: toY });
            envelopeLabels.push({
                text: "Flipper arc " + (index + 1) + " (" + flipperId + ")",
                x: envelope.px + 10,
                y: envelope.py - 10 - (index * 12)
            });
        });
        addCheck(report, {
            id: "reachability_target_to_flipper",
            category: "reachability",
            status: status,
            message: message,
            objects: unreached,
            diagnostics: Object.assign(diagnostics, {
                trajectories: traces.map(function map(trace) {
                    return {
                        label: trace.sourceId + " -> " + trace.targetFlipperId,
                        status: trace.reached ? "pass" : "warn",
                        limitReason: trace.limitReason || "",
                        ticks: trace.ticks || 0,
                        collisions: trace.collisions || 0,
                        path: trace.path
                    };
                }),
                labels: (diagnostics.labels || []).concat(envelopeLabels).concat([{
                    text: "Sources " + sources.length + " | reached " + (sources.length - unreached.length) + " | unreached " + unreached.length + " | bounce-limit rays " + bounceLimited.length,
                    x: 16,
                    y: 70
                }])
            })
        });
    }

    function checkTargetToFlipperReachability(table, elements, report, options) {
        const flippers = flippersFromElements(elements);
        if (!flippers.length) {
            addCheck(report, {
                id: "reachability_target_to_flipper",
                category: "reachability",
                status: "warn",
                message: "Target-to-flipper reachability skipped: no flipper elements.",
                objects: [],
                diagnostics: {}
            });
            return;
        }
        const limits = targetReachabilityLimits(options);
        const sources = logicTriggerSourceElements(table, elements);
        const traces = [];
        sources.forEach(function eachSource(source) {
            flippers.forEach(function eachFlipper(flipper) {
                for (let i = 0; i < limits.count; i++) {
                    const trace = traceTargetRay(table, elements, source, flipper, i, limits);
                    if (trace.ok) traces.push(trace);
                }
            });
        });
        addTargetReachabilityCheck(report, traces, sources, elements, limits);
    }

    function yieldToBrowser() {
        return new Promise(function wait(resolve) {
            setTimeout(resolve, 0);
        });
    }

    function addLauncherRayCheck(report, traces, limits, firstFailure) {
        if (firstFailure) {
            addCheck(report, {
                id: "stuck_launcher_ray",
                category: "stuck",
                status: "warn",
                message: firstFailure.reason === "no_launcher" ?
                    "Launcher geodesic probes skipped: no launcher element." :
                    "Launcher geodesic probes skipped: ball did not exit the launcher.",
                objects: [],
                diagnostics: {}
            });
            return;
        }
        const stuckTraces = traces.filter(function filter(trace) { return trace.stuckLikely; });
        const drainTraces = traces.filter(function filter(trace) { return trace.reachedDrain; });
        const trappedLauncherTraces = traces.filter(function filter(trace) { return !trace.exitedLauncher; });
        const tickLimitTraces = traces.filter(function filter(trace) { return trace.limitReason === "ticks"; });
        const collisionLimitTraces = traces.filter(function filter(trace) { return trace.limitReason === "collisions"; });
        report.metrics.launcherRayCount = traces.length;
        report.metrics.launcherStuckRays = stuckTraces.length;
        report.metrics.launcherDrainRays = drainTraces.length;
        report.metrics.launcherTickLimitRays = tickLimitTraces.length;
        report.metrics.launcherCollisionLimitRays = collisionLimitTraces.length;

        const status = stuckTraces.length || trappedLauncherTraces.length ? "warn" : "pass";
        const message = stuckTraces.length ?
            "Launcher geodesic probes abandoned " + stuckTraces.length + " of " + traces.length + " launches as possible stuck paths." :
            (trappedLauncherTraces.length ?
                "Launcher geodesic probes failed to exit the launcher in " + trappedLauncherTraces.length + " of " + traces.length + " launches." :
                "Launcher geodesic probes did not show repeated state loops across " + traces.length + " launch holds.");
        addCheck(report, {
            id: "stuck_launcher_ray",
            category: "stuck",
            status: status,
            message: message,
            objects: [],
            diagnostics: {
                objectIds: [],
                trajectories: traces.map(function map(trace) {
                    return {
                        label: "hold " + trace.holdSeconds.toFixed(2) + "s",
                        status: trace.stuckLikely ? "warn" : "pass",
                        limitReason: trace.limitReason || "",
                        ticks: trace.ticks || 0,
                        collisions: trace.collisions || 0,
                        path: trace.path
                    };
                }),
                labels: [{
                    text: traces.length + " launch probes | stuck " + stuckTraces.length + " | drain " + drainTraces.length + " | limits c" + limits.maxCollisions + "/t" + limits.maxTicks,
                    x: 16,
                    y: 34
                }]
            }
        });
    }

    function addFlipperRayCheck(report, traces, limits, flipperCount, elements) {
        if (!flipperCount) {
            addCheck(report, {
                id: "reachability_flipper_rays",
                category: "reachability",
                status: "warn",
                message: "Flipper reachability probes skipped: no flipper elements.",
                objects: [],
                diagnostics: {}
            });
            return;
        }
        const stuckTraces = traces.filter(function filter(trace) { return trace.stuckLikely; });
        const drainTraces = traces.filter(function filter(trace) { return trace.reachedDrain; });
        const tickLimitTraces = traces.filter(function filter(trace) { return trace.limitReason === "ticks"; });
        const collisionLimitTraces = traces.filter(function filter(trace) { return trace.limitReason === "collisions"; });
        const objectIds = traces.map(function map(trace) { return trace.flipperId; }).filter(function filter(id, index, list) {
            return id && list.indexOf(id) === index;
        });
        const diagnostics = baseElementDiagnostics(elements, objectIds);
        report.metrics.flipperRayCount = traces.length;
        report.metrics.flipperStuckRays = stuckTraces.length;
        report.metrics.flipperDrainRays = drainTraces.length;
        report.metrics.flipperTickLimitRays = tickLimitTraces.length;
        report.metrics.flipperCollisionLimitRays = collisionLimitTraces.length;

        addCheck(report, {
            id: "reachability_flipper_rays",
            category: "reachability",
            status: stuckTraces.length ? "warn" : "pass",
            message: stuckTraces.length ?
                "Flipper reachability probes abandoned " + stuckTraces.length + " of " + traces.length + " shots as possible stuck paths." :
                "Flipper reachability probes completed across " + traces.length + " sampled shots.",
            objects: objectIds,
            diagnostics: Object.assign(diagnostics, {
                trajectories: traces.map(function map(trace) {
                    return {
                        label: trace.flipperId + " t=" + trace.contactT.toFixed(2),
                        status: trace.stuckLikely ? "warn" : "pass",
                        limitReason: trace.limitReason || "",
                        ticks: trace.ticks || 0,
                        collisions: trace.collisions || 0,
                        path: trace.path
                    };
                }),
                labels: diagnostics.labels.concat([{
                    text: traces.length + " flipper probes | stuck " + stuckTraces.length + " | drain " + drainTraces.length + " | limits c" + limits.maxCollisions + "/t" + limits.maxTicks,
                    x: 16,
                    y: 52
                }])
            })
        });
    }

    /* What: Run a spread of launcher geodesics and attach drawable diagnostics.
     * Why: a single launch can miss stuck behaviour; several hold durations show
     * the launch envelope while still producing one machine-readable check.
     */
    function checkLauncherRayStuck(table, elements, report, options) {
        const limits = launcherProbeLimits(options);
        const traces = [];
        let firstFailure = null;
        for (let i = 0; i < limits.count; i++) {
            const holdSeconds = launcherHoldSecondsForIndex(i, limits.count);
            const trace = traceLauncherRay(table, elements, table && table.playfield, holdSeconds, i, limits);
            if (!trace.ok) {
                firstFailure = trace;
                break;
            }
            traces.push(trace);
        }
        addLauncherRayCheck(report, traces, limits, firstFailure);
    }

    /* What: Run reachability rays from each valid flipper contact sample.
     * Why: this starts the evaluator's non-launch reachability model without
     * leaving the production physics engine or faking ray reflections.
     */
    function checkFlipperRayReachability(table, elements, report, options) {
        const limits = launcherProbeLimits(options);
        const flippers = flippersFromElements(elements);
        const traces = [];
        flippers.forEach(function eachFlipper(flipper) {
            for (let i = 0; i < limits.count; i++) {
                const contactT = flipperContactTForIndex(i, limits.count);
                traces.push(traceFlipperRay(table, elements, table && table.playfield, flipper, contactT, i, limits));
            }
        });
        addFlipperRayCheck(report, traces, limits, flippers.length, elements);
    }

    function createEvaluationContext(table, options) {
        const opts = options || {};
        const normalized = Pin.table && Pin.table.normalizeTable ? Pin.table.normalizeTable(table) : clone(table);
        const report = makeReport({
            tableId: opts.tableId || "",
            tableName: normalized && normalized.name
        });
        return { opts: opts, normalized: normalized, report: report, elements: extractElements(normalized) };
    }

    function runPreLauncherChecks(context) {
        const normalized = context.normalized;
        const report = context.report;
        if (!checkCoreShape(normalized, report)) {
            finalizeOverall(report);
            return false;
        }
        const elements = context.elements;
        checkTableValidation(normalized, report);
        checkPlayabilityValidation(normalized, report);
        checkIdsAndTypes(elements, report);
        checkNumericFields(normalized, elements, report);
        checkBounds(normalized, elements, report);
        checkCompilation(normalized, report);
        return true;
    }

    function addReachabilityTodo(report) {
        addCheck(report, {
            id: "reachability_todo",
            category: "reachability",
            status: "warn",
            message: "Advanced contact-backtrace and arbitrary-location reachability coverage is TODO beyond launcher, flipper, and trigger-source probes.",
            objects: []
        });
    }

    function evaluateTable(table, options) {
        const context = createEvaluationContext(table, options);
        if (!runPreLauncherChecks(context)) return context.report;
        checkLauncherRayStuck(context.normalized, context.elements, context.report, context.opts);
        checkFlipperRayReachability(context.normalized, context.elements, context.report, context.opts);
        checkTargetToFlipperReachability(context.normalized, context.elements, context.report, context.opts);
        addReachabilityTodo(context.report);
        finalizeOverall(context.report);
        return context.report;
    }

    function evaluateTableAsync(table, options) {
        const context = createEvaluationContext(table, options);
        const onProgress = typeof context.opts.onProgress === "function" ? context.opts.onProgress : function noop() {};
        if (!runPreLauncherChecks(context)) return Promise.resolve(context.report);

        const limits = launcherProbeLimits(context.opts);
        const targetLimits = targetReachabilityLimits(context.opts);
        const launcherTraces = [];
        const flipperTraces = [];
        const targetTraces = [];
        const flippers = flippersFromElements(context.elements);
        const targetSources = logicTriggerSourceElements(context.normalized, context.elements);
        const totalTargetProbes = targetSources.length * flippers.length * targetLimits.count;
        const totalProbes = limits.count + flippers.length * limits.count + totalTargetProbes;
        let firstFailure = null;
        let lastYieldTime = 0;
        onProgress({ phase: "launcher", done: 0, total: totalProbes, message: "Launcher probes 0 / " + limits.count });

        function maybeYield(next) {
            const now = Date.now();
            const shouldYield = now - lastYieldTime > 50;
            if (!shouldYield) return next();
            lastYieldTime = now;
            return yieldToBrowser().then(next);
        }

        function finishEvaluation() {
            addFlipperRayCheck(context.report, flipperTraces, limits, flippers.length, context.elements);
            addTargetReachabilityCheck(context.report, targetTraces, targetSources, context.elements, targetLimits);
            addReachabilityTodo(context.report);
            finalizeOverall(context.report);
            onProgress({ phase: "complete", done: totalProbes, total: totalProbes, message: "Evaluation complete" });
            return Promise.resolve(context.report);
        }

        function runTargetNext(index) {
            if (index >= totalTargetProbes) return finishEvaluation();
            const sourceIndex = Math.floor(index / (flippers.length * targetLimits.count));
            const inSource = index % (flippers.length * targetLimits.count);
            const flipperIndex = Math.floor(inSource / targetLimits.count);
            const rayIndex = inSource % targetLimits.count;
            const source = targetSources[sourceIndex];
            const flipper = flippers[flipperIndex];
            const trace = traceTargetRay(context.normalized, context.elements, source, flipper, rayIndex, targetLimits);
            if (trace.ok) targetTraces.push(trace);
            onProgress({
                phase: "reachability",
                done: limits.count + (flippers.length * limits.count) + index + 1,
                total: totalProbes,
                message: "Target probes " + (index + 1) + " / " + totalTargetProbes
            });
            if ((index + 1) % 4 === 0) {
                return yieldToBrowser().then(function resume() {
                    return runTargetNext(index + 1);
                });
            }
            return maybeYield(function next() {
                return runTargetNext(index + 1);
            });
        }

        function runFlipperNext(index) {
            const totalFlipperProbes = flippers.length * limits.count;
            if (index >= totalFlipperProbes) {
                onProgress({
                    phase: "reachability",
                    done: limits.count + totalFlipperProbes,
                    total: totalProbes,
                    message: "Target probes 0 / " + totalTargetProbes
                });
                return runTargetNext(0);
            }

            const flipper = flippers[Math.floor(index / limits.count)];
            const sampleIndex = index % limits.count;
            const contactT = flipperContactTForIndex(sampleIndex, limits.count);
            flipperTraces.push(traceFlipperRay(context.normalized, context.elements, context.normalized && context.normalized.playfield, flipper, contactT, sampleIndex, limits));

            onProgress({
                phase: "flipper",
                done: limits.count + index + 1,
                total: totalProbes,
                message: "Flipper probes " + (index + 1) + " / " + totalFlipperProbes
            });

            if ((index + 1) % 4 === 0) {
                return yieldToBrowser().then(function resume() {
                    return runFlipperNext(index + 1);
                });
            }
            return maybeYield(function next() {
                return runFlipperNext(index + 1);
            });
        }

        function runNext(index) {
            if (index >= limits.count || firstFailure) {
                addLauncherRayCheck(context.report, launcherTraces, limits, firstFailure);
                onProgress({ phase: "flipper", done: limits.count, total: totalProbes, message: "Flipper probes 0 / " + (flippers.length * limits.count) });
                return runFlipperNext(0);
            }

            const holdSeconds = launcherHoldSecondsForIndex(index, limits.count);
            const trace = traceLauncherRay(context.normalized, context.elements, context.normalized && context.normalized.playfield, holdSeconds, index, limits);
            if (!trace.ok) firstFailure = trace;
            else launcherTraces.push(trace);

            onProgress({
                phase: "launcher",
                done: index + 1,
                total: totalProbes,
                message: "Launcher probes " + (index + 1) + " / " + limits.count
            });

            const now = Date.now();
            const shouldYield = index + 1 < limits.count && ((index + 1) % 4 === 0 || now - lastYieldTime > 50);
            if (shouldYield) {
                lastYieldTime = now;
                return yieldToBrowser().then(function resume() {
                    return runNext(index + 1);
                });
            }
            return runNext(index + 1);
        }

        return runNext(0);
    }

    Pin.tableEval = {
        evaluateTable: evaluateTable,
        evaluateTableAsync: evaluateTableAsync
    };
})(window.Pin);
