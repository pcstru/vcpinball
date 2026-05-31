/*
 * Table evaluation harness for baseline playability validation.
 * What: run deterministic static, geometry-adjacent, and physics sanity checks
 * against a table definition and emit a machine-readable report.
 * Why: catch broken or invalid tables early with repeatable PASS/WARN/FAIL
 * outcomes before deeper gameplay tuning.
 */
(function initTableEval(Pin) {
    const BASE_FIXED_DT = 1 / 120;
    const STEPS = 900;
    const EVAL_CHECK_DEFS = [
        { id: "table_validation", label: "Table Schema Validation", category: "static" },
        { id: "playability_validation", label: "Playability Validation", category: "static" },
        { id: "ids_and_types", label: "Element IDs and Types", category: "static" },
        { id: "numeric_fields", label: "Numeric Field Validation", category: "static" },
        { id: "bounds", label: "Playfield Bounds", category: "static" },
        { id: "compilation", label: "Runtime Compilation", category: "static" },
        { id: "accessibility_heatmap", label: "Accessibility Heatmap", category: "reachability" },
        { id: "autoplay_heatmap", label: "Autoplay Heatmap", category: "autoplay" },
        { id: "launcher_rays", label: "Launcher Reachability Rays", category: "stuck" },
        { id: "flipper_reachability", label: "Flipper Reachability Rays", category: "reachability" },
        { id: "target_to_flipper_reachability", label: "Target To Flipper Reachability", category: "reachability" },
        { id: "reachability_todo", label: "Reachability TODO Reminder", category: "reachability" }
    ];
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

    /*
     * What: Resolve evaluation timestep from table playfield timing settings.
     * Why: table validation probes should run on the same fixed-step contract
     * used by live play and harness simulations.
     */
    function fixedDtForWorld(world) {
        if (Pin.table && Pin.table.getFixedPhysicsDt) {
            return Pin.table.getFixedPhysicsDt(world && world.table && world.table.playfield);
        }
        return BASE_FIXED_DT;
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
                launcherVelocitySamples: 0,
                launcherVelocityMin: 0,
                launcherVelocityMax: 0,
                launcherVelocitySpread: 0,
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
            lastPhysicsDt: fixedDtForWorld({ table: table }),
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
        const fixedDt = fixedDtForWorld(world);
        for (let i = 0; i < STEPS; i++) {
            refreshDynamicRuntime(world);
            world.lastPhysicsDt = fixedDt;
            Pin.physics.stepWorld(world, fixedDt);
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

    function normalizedFloatLimit(value, fallback, min, max) {
        const numeric = Number(value);
        if (!Number.isFinite(numeric)) return fallback;
        return Math.max(min, Math.min(max, numeric));
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
        const fixedDt = fixedDtForWorld(world);
        refreshDynamicRuntime(world);
        world.lastPhysicsDt = fixedDt;
        Pin.physics.stepWorld(world, fixedDt);
    }

    /* What: Hold the production launcher for a sampled duration and release it.
     * Why: this converts a user-facing hold time into the same plunger state and
     * strike velocity used by interactive play.
     */
    function chargeLauncherForHold(world, holdSeconds) {
        const fixedDt = fixedDtForWorld(world);
        const chargeSteps = Math.max(0, Math.round(holdSeconds / fixedDt));
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

    /* What: Evenly sample long arrays while preserving endpoints.
     * Why: evaluator diagnostics should stay visually useful without carrying
     * thousands of points/rays that degrade lab responsiveness.
     */
    function sampleArrayEvenly(items, maxCount) {
        if (!Array.isArray(items) || !items.length) return [];
        if (!Number.isFinite(maxCount) || maxCount <= 0) return [];
        if (items.length <= maxCount) return items.slice();
        if (maxCount === 1) return [items[0]];
        const out = [];
        const lastIndex = items.length - 1;
        let prevIndex = -1;
        for (let i = 0; i < maxCount; i++) {
            const idx = Math.round((i * lastIndex) / (maxCount - 1));
            if (idx === prevIndex) continue;
            out.push(items[idx]);
            prevIndex = idx;
        }
        if (out[out.length - 1] !== items[lastIndex]) out[out.length - 1] = items[lastIndex];
        return out;
    }

    function sampledTrajectoryPath(path, maxPoints) {
        const sampled = sampleArrayEvenly(path, maxPoints);
        return sampled.map(function map(point) {
            return point && isFiniteNumber(point.x) && isFiniteNumber(point.y) ? { x: point.x, y: point.y } : point;
        }).filter(function keep(point) {
            return point && isFiniteNumber(point.x) && isFiniteNumber(point.y);
        });
    }

    /* What: Build compact trajectory diagnostics for UI/rendering use.
     * Why: full probe payloads can be extremely large and make the physics lab
     * sluggish after evaluation completes.
     */
    function compactTrajectoryDiagnostics(traces, buildEntry) {
        const MAX_TRAJECTORIES = 96;
        const MAX_POINTS_PER_PATH = 160;
        return sampleArrayEvenly(traces, MAX_TRAJECTORIES).map(function map(trace) {
            const entry = buildEntry(trace) || {};
            entry.path = sampledTrajectoryPath(trace && trace.path, MAX_POINTS_PER_PATH);
            return entry;
        });
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
        let launchSample = null;
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
            if (!ball.inLaunchLane) {
                if (!exitedLauncher) {
                    const speed = Math.sqrt(ball.vx * ball.vx + ball.vy * ball.vy);
                    launchSample = {
                        speed: speed,
                        vx: ball.vx,
                        vy: ball.vy,
                        tick: world.physicsTick || (i + 1)
                    };
                }
                exitedLauncher = true;
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
                    launchSpeed: launchSample ? launchSample.speed : 0,
                    launchVx: launchSample ? launchSample.vx : 0,
                    launchVy: launchSample ? launchSample.vy : 0,
                    launchTick: launchSample ? launchSample.tick : 0,
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
            launchSpeed: launchSample ? launchSample.speed : 0,
            launchVx: launchSample ? launchSample.vx : 0,
            launchVy: launchSample ? launchSample.vy : 0,
            launchTick: launchSample ? launchSample.tick : 0,
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
            maxTicks: normalizedProbeLimit(options && options.launchMaxTicks, 10000, 60, 60000),
            minLaunchSpeedSpread: normalizedFloatLimit(options && options.launchMinSpeedSpread, 2.5, 0, 60)
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

    function accessibilityHeatmapLimits(options) {
        const requestedMode = String((options && options.accessibilityRayMode) || "geometric").toLowerCase();
        const rayMode = requestedMode === "physics" ? "physics" : "geometric";
        const defaultMaxRays = rayMode === "physics" ? 320 : 5000;
        const defaultMaxTicks = rayMode === "physics" ? 420 : 2400;
        const defaultMaxCollisions = rayMode === "physics" ? 1 : 80;
        return {
            rayMode: rayMode,
            maxDepth: normalizedProbeLimit(options && options.accessibilityMaxDepth, 3, 0, 8),
            branchRays: normalizedProbeLimit(options && options.accessibilityBranchRays, 16, 1, 64),
            cellSize: normalizedProbeLimit(options && options.accessibilityCellSize, 32, 8, 128),
            maxRays: normalizedProbeLimit(options && options.accessibilityMaxRays, defaultMaxRays, 1, 50000),
            speed: normalizedFloatLimit(options && options.accessibilityRaySpeed, 15, 1, 60),
            maxTicks: normalizedProbeLimit(options && options.accessibilityMaxTicks, defaultMaxTicks, 60, 20000),
            maxCollisions: normalizedProbeLimit(options && options.accessibilityMaxCollisions, defaultMaxCollisions, 1, 5000)
        };
    }

    function normalizeVector(x, y) {
        const len = Math.sqrt(x * x + y * y);
        if (!(len > 0.000001)) return null;
        return { x: x / len, y: y / len };
    }

    function raycastCircle(origin, dir, maxDistance, circle, inflateBy) {
        if (!circle || !isFiniteNumber(circle.x) || !isFiniteNumber(circle.y) || !hasPositiveNumber(circle.radius)) return null;
        const radius = circle.radius + Math.max(0, inflateBy || 0);
        const ox = origin.x - circle.x;
        const oy = origin.y - circle.y;
        const b = ox * dir.x + oy * dir.y;
        const c = ox * ox + oy * oy - radius * radius;
        const disc = b * b - c;
        if (disc < 0) return null;
        const sqrtDisc = Math.sqrt(disc);
        const t1 = -b - sqrtDisc;
        const t2 = -b + sqrtDisc;
        const t = t1 > 0.0001 ? t1 : (t2 > 0.0001 ? t2 : Infinity);
        if (!Number.isFinite(t) || t > maxDistance) return null;
        return t;
    }

    function raycastSegment(origin, dir, maxDistance, seg, inflateBy) {
        if (!seg || !isFiniteNumber(seg.x1) || !isFiniteNumber(seg.y1) || !isFiniteNumber(seg.x2) || !isFiniteNumber(seg.y2)) return null;
        const thickness = Math.max(0, (hasPositiveNumber(seg.thickness) ? seg.thickness : 0) + Math.max(0, inflateBy || 0));
        const vx = seg.x2 - seg.x1;
        const vy = seg.y2 - seg.y1;
        const wx = origin.x - seg.x1;
        const wy = origin.y - seg.y1;
        const segLenSq = vx * vx + vy * vy;
        let closestX = seg.x1;
        let closestY = seg.y1;
        if (segLenSq > 0.000001) {
            let u = (wx * vx + wy * vy) / segLenSq;
            u = Math.max(0, Math.min(1, u));
            closestX = seg.x1 + vx * u;
            closestY = seg.y1 + vy * u;
        }
        const nx = closestX - origin.x;
        const ny = closestY - origin.y;
        const proj = nx * dir.x + ny * dir.y;
        if (proj < 0) return null;
        const perpSq = (nx * nx + ny * ny) - proj * proj;
        const radSq = thickness * thickness;
        if (perpSq > radSq + 0.0001) return null;
        const offset = Math.sqrt(Math.max(0, radSq - Math.max(0, perpSq)));
        const t = Math.max(0, proj - offset);
        if (t > maxDistance) return null;
        return t;
    }

    function raycastBounds(origin, dir, width, height) {
        let best = Infinity;
        if (Math.abs(dir.x) > 0.000001) {
            const tx0 = (0 - origin.x) / dir.x;
            const tx1 = (width - origin.x) / dir.x;
            if (tx0 > 0.0001) best = Math.min(best, tx0);
            if (tx1 > 0.0001) best = Math.min(best, tx1);
        }
        if (Math.abs(dir.y) > 0.000001) {
            const ty0 = (0 - origin.y) / dir.y;
            const ty1 = (height - origin.y) / dir.y;
            if (ty0 > 0.0001) best = Math.min(best, ty0);
            if (ty1 > 0.0001) best = Math.min(best, ty1);
        }
        return Number.isFinite(best) ? best : 0;
    }

    function rasterizeSegmentToHeatmap(origin, target, heatmap, cellSize, width, height) {
        const dx = target.x - origin.x;
        const dy = target.y - origin.y;
        const len = Math.sqrt(dx * dx + dy * dy);
        if (!(len > 0.000001)) return;
        const steps = Math.max(1, Math.ceil(len / Math.max(2, cellSize * 0.5)));
        for (let i = 0; i <= steps; i++) {
            const t = i / steps;
            const x = origin.x + dx * t;
            const y = origin.y + dy * t;
            if (x < 0 || y < 0 || x > width || y > height) continue;
            const cx = Math.max(0, Math.min(heatmap.cols - 1, Math.floor(x / cellSize)));
            const cy = Math.max(0, Math.min(heatmap.rows - 1, Math.floor(y / cellSize)));
            const idx = cy * heatmap.cols + cx;
            heatmap.values[idx] += 1;
        }
    }

    function estimateLauncherExitOrigin(table, world) {
        const launcher = Pin.physics && Pin.physics.getLauncherConfig ? Pin.physics.getLauncherConfig(world) : null;
        if (!launcher || !hasPositiveNumber(launcher.width) || !isFiniteNumber(launcher.x) || !isFiniteNumber(launcher.top)) return null;
        const playfield = (table && table.playfield) || {};
        const radius = hasPositiveNumber(playfield.ballRadius) ? playfield.ballRadius : 8;
        return {
            x: launcher.x,
            y: launcher.top - radius - 2
        };
    }

    /*
     * What: Trace one accessibility ray with full physics stepping.
     * Why: this mode trades throughput for realism by using production collision
     * and response logic instead of direct geometric intersection tests.
     */
    function traceAccessibilityRayPhysics(table, origin, dir, limits, width, height, ballRadius) {
        const world = buildEvalWorld(table);
        world.physicsCollisionCount = 0;
        world.balls = [{
            x: origin.x,
            y: origin.y,
            radius: ballRadius,
            vx: dir.x * limits.speed,
            vy: dir.y * limits.speed,
            level: 0
        }];
        const path = [{ x: origin.x, y: origin.y }];
        let ignoredGateHitCount = 0;
        let hitCount = 0;
        let nonGateCollisions = 0;
        let reason = "ticks";
        for (let i = 0; i < limits.maxTicks; i++) {
            stepEvalWorld(world);
            const ball = world.balls && world.balls[0];
            if (!ball) {
                reason = "none";
                break;
            }
            if (!Number.isFinite(ball.x) || !Number.isFinite(ball.y) || !Number.isFinite(ball.vx) || !Number.isFinite(ball.vy)) {
                reason = "invalid";
                break;
            }
            if (i < 60 || i % 6 === 0) path.push({ x: ball.x, y: ball.y });
            if (ball.drained) {
                reason = "drained";
                break;
            }
            if (ball.x < 0 || ball.y < 0 || ball.x > width || ball.y > height) {
                reason = "bounds";
                break;
            }
            const last = world.lastPhysicsCollision || null;
            if (last && last.elementType === "gate") ignoredGateHitCount += 1;
            if (last && last.elementType && last.elementType !== "gate") {
                hitCount += 1;
                nonGateCollisions += 1;
                reason = "hit";
                path.push({ x: ball.x, y: ball.y });
                break;
            }
            if (nonGateCollisions > limits.maxCollisions) {
                reason = "collisions";
                break;
            }
        }
        const endPoint = path[path.length - 1] || { x: origin.x, y: origin.y };
        return {
            endPoint: endPoint,
            path: path,
            hitCount: hitCount,
            ignoredGateHitCount: ignoredGateHitCount,
            nonGateCollisions: nonGateCollisions,
            reason: reason
        };
    }

    function checkAccessibilityHeatmap(table, report, options, onProgress) {
        const limits = accessibilityHeatmapLimits(options);
        const world = buildEvalWorld(table);
        const playfield = (table && table.playfield) || {};
        const width = hasPositiveNumber(playfield.width) ? playfield.width : 0;
        const height = hasPositiveNumber(playfield.height) ? playfield.height : 0;
        if (!(width > 0) || !(height > 0)) {
            addCheck(report, {
                id: "accessibility_heatmap",
                category: "reachability",
                status: "warn",
                message: "Accessibility heatmap skipped: playfield bounds are invalid.",
                objects: [],
                diagnostics: {}
            });
            return;
        }
        const origin = estimateLauncherExitOrigin(table, world);
        if (!origin) {
            addCheck(report, {
                id: "accessibility_heatmap",
                category: "reachability",
                status: "warn",
                message: "Accessibility heatmap skipped: no launcher exit origin.",
                objects: [],
                diagnostics: {}
            });
            return;
        }

        const cellSize = limits.cellSize;
        const cols = Math.max(1, Math.ceil(width / cellSize));
        const rows = Math.max(1, Math.ceil(height / cellSize));
        const heatmap = {
            cellSize: cellSize,
            cols: cols,
            rows: rows,
            values: new Array(cols * rows).fill(0)
        };
        const diagnosticsSegments = [];
        const queue = [{
            x: origin.x,
            y: origin.y,
            dx: 0,
            dy: -1,
            depth: 0
        }];
        const runtimeSegments = world.runtimeSegments || [];
        const runtimeCircles = world.runtimeCircles || [];
        const ballRadius = hasPositiveNumber(playfield.ballRadius) ? playfield.ballRadius : 8;
        const maxDistance = Math.sqrt(width * width + height * height) + 8;
        let rayCount = 0;
        let hitCount = 0;
        let depthLimitCount = 0;
        let ignoredGateHitCount = 0;

        let lastProgressMs = 0;
        while (queue.length && rayCount < limits.maxRays) {
            const node = queue.shift();
            const dir = normalizeVector(node.dx, node.dy);
            if (!dir) continue;
            let endPoint = { x: node.x, y: node.y };
            let physicsTrace = null;
            if (limits.rayMode === "physics") {
                physicsTrace = traceAccessibilityRayPhysics(table, { x: node.x, y: node.y }, dir, limits, width, height, ballRadius);
                endPoint = physicsTrace.endPoint;
                ignoredGateHitCount += physicsTrace.ignoredGateHitCount;
                hitCount += physicsTrace.hitCount;
                if (diagnosticsSegments.length < 450 && Array.isArray(physicsTrace.path) && physicsTrace.path.length > 1) {
                    const maxSegmentsPerRay = 8;
                    const pathSegments = physicsTrace.path.length - 1;
                    const step = Math.max(1, Math.ceil(pathSegments / maxSegmentsPerRay));
                    for (let p = step; p < physicsTrace.path.length; p += step) {
                        const a = physicsTrace.path[Math.max(0, p - step)];
                        const b = physicsTrace.path[p];
                        diagnosticsSegments.push({ x1: a.x, y1: a.y, x2: b.x, y2: b.y });
                        if (diagnosticsSegments.length >= 450) break;
                    }
                }
                if (Array.isArray(physicsTrace.path) && physicsTrace.path.length > 1) {
                    for (let p = 1; p < physicsTrace.path.length; p++) {
                        rasterizeSegmentToHeatmap(physicsTrace.path[p - 1], physicsTrace.path[p], heatmap, cellSize, width, height);
                    }
                } else {
                    rasterizeSegmentToHeatmap({ x: node.x, y: node.y }, endPoint, heatmap, cellSize, width, height);
                }
            } else {
                const boundsT = raycastBounds({ x: node.x, y: node.y }, dir, width, height);
                if (!(boundsT > 0.0001)) continue;
                let nearest = boundsT;
                let nearestType = "bounds";

                runtimeSegments.forEach(function each(seg) {
                    const isGate = seg && seg.role === "gate";
                    const t = raycastSegment({ x: node.x, y: node.y }, dir, nearest, seg, isGate ? 0 : ballRadius);
                    if (!Number.isFinite(t)) return;
                    if (isGate) {
                        ignoredGateHitCount += 1;
                        return;
                    }
                    if (t < nearest) {
                        nearest = t;
                        nearestType = "block";
                    }
                });
                runtimeCircles.forEach(function each(circle) {
                    const t = raycastCircle({ x: node.x, y: node.y }, dir, nearest, circle, ballRadius);
                    if (!Number.isFinite(t)) return;
                    if (t < nearest) {
                        nearest = t;
                        nearestType = "block";
                    }
                });
                endPoint = {
                    x: node.x + dir.x * nearest,
                    y: node.y + dir.y * nearest
                };
                rasterizeSegmentToHeatmap({ x: node.x, y: node.y }, endPoint, heatmap, cellSize, width, height);
                if (diagnosticsSegments.length < 450) {
                    diagnosticsSegments.push({ x1: node.x, y1: node.y, x2: endPoint.x, y2: endPoint.y });
                }
                if (nearestType === "block") hitCount += 1;
            }
            rayCount += 1;

            if (typeof onProgress === "function") {
                const now = Date.now();
                if (rayCount === 1 || rayCount % 24 === 0 || now - lastProgressMs > 120) {
                    lastProgressMs = now;
                    onProgress({
                        phase: "accessibility",
                        done: rayCount,
                        total: limits.maxRays,
                        message: "Accessibility rays " + rayCount + " / " + limits.maxRays,
                        check: {
                            id: "accessibility_heatmap",
                            category: "reachability",
                            status: "warn",
                            message: "Accessibility search in progress...",
                            objects: [],
                            diagnostics: {
                                heatmap: heatmap,
                                segments: diagnosticsSegments.slice(-220),
                                points: [{ x: origin.x, y: origin.y }],
                                labels: [{
                                    text: "Mode " + limits.rayMode + " | rays " + rayCount + " | hits " + hitCount + " | ignored gates " + ignoredGateHitCount,
                                    x: 16,
                                    y: 34
                                }]
                            }
                        }
                    });
                }
            }

            if (node.depth >= limits.maxDepth) {
                depthLimitCount += 1;
                continue;
            }
            let mid = {
                x: node.x + (endPoint.x - node.x) * 0.5,
                y: node.y + (endPoint.y - node.y) * 0.5
            };
            if (limits.rayMode === "physics" && physicsTrace && Array.isArray(physicsTrace.path) && physicsTrace.path.length) {
                mid = physicsTrace.path[Math.floor(physicsTrace.path.length * 0.5)] || mid;
            }
            for (let i = 0; i < limits.branchRays; i++) {
                const angle = (i / limits.branchRays) * Math.PI * 2;
                queue.push({
                    x: mid.x,
                    y: mid.y,
                    dx: Math.cos(angle),
                    dy: Math.sin(angle),
                    depth: node.depth + 1
                });
                if ((queue.length + rayCount) >= limits.maxRays) break;
            }
        }

        let accessibleCells = 0;
        heatmap.values.forEach(function each(value) {
            if (value > 0) accessibleCells += 1;
        });
        const totalCells = heatmap.values.length || 1;
        report.metrics.accessibleCells = accessibleCells;
        report.metrics.totalCells = totalCells;
        report.metrics.accessibleCoverageRatio = accessibleCells / totalCells;
        report.metrics.accessibilityRayCount = rayCount;
        report.metrics.accessibilityHitCount = hitCount;
        report.metrics.ignoredGateHitCount = ignoredGateHitCount;
        report.metrics.accessibilityDepthLimitCount = depthLimitCount;

        addCheck(report, {
            id: "accessibility_heatmap",
            category: "reachability",
            status: rayCount > 0 ? "pass" : "warn",
            message: rayCount > 0 ?
                ("Accessibility heatmap covered " + accessibleCells + " / " + totalCells + " cells (" + ((accessibleCells / totalCells) * 100).toFixed(1) + "%).") :
                "Accessibility heatmap produced no rays.",
            objects: [],
            diagnostics: {
                heatmap: heatmap,
                segments: diagnosticsSegments,
                points: [{ x: origin.x, y: origin.y }],
                labels: [{
                    text: "Mode " + limits.rayMode + " | rays " + rayCount + " | hits " + hitCount + " | ignored gates " + ignoredGateHitCount,
                    x: 16,
                    y: 34
                }]
            }
        });
        if (typeof onProgress === "function") {
            onProgress({
                phase: "accessibility",
                done: rayCount,
                total: limits.maxRays,
                message: "Accessibility search complete",
                check: {
                    id: "accessibility_heatmap",
                    category: "reachability",
                    status: "pass",
                    message: "Accessibility search complete.",
                    objects: [],
                    diagnostics: {
                        heatmap: heatmap,
                        segments: diagnosticsSegments.slice(-260),
                        points: [{ x: origin.x, y: origin.y }],
                        labels: [{
                            text: "Mode " + limits.rayMode + " | rays " + rayCount + " | hits " + hitCount + " | ignored gates " + ignoredGateHitCount,
                            x: 16,
                            y: 34
                        }]
                    }
                }
            });
        }
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

    /* What: Resolve a stable geometric center for a trigger source element.
     * Why: target-to-flipper probes must spread from the authored source shape,
     * not from whichever fallback field happens to be present.
     */
    function sourceCenterForElement(el) {
        if (!el) return null;
        if (isFiniteNumber(el.x) && isFiniteNumber(el.y)) return { x: el.x, y: el.y };
        if (Array.isArray(el.anchors) && el.anchors.length) {
            let sx = 0;
            let sy = 0;
            let count = 0;
            el.anchors.forEach(function each(anchor) {
                if (!anchor || !isFiniteNumber(anchor.x) || !isFiniteNumber(anchor.y)) return;
                sx += anchor.x;
                sy += anchor.y;
                count += 1;
            });
            if (count > 0) return { x: sx / count, y: sy / count };
        }
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

    function projectOnDirection(point, dirX, dirY) {
        return point.x * dirX + point.y * dirY;
    }

    /* What: Compile one source element to recover its real contact geometry.
     * Why: probe starts must use collider/sensor boundaries rather than inferred
     * center points, otherwise rays can begin inside blocking geometry.
     */
    function sourceGeometryForElement(table, world, source) {
        if (!Pin.elements || typeof Pin.elements.compileElements !== "function") {
            return { segments: [], circles: [], sensors: [] };
        }
        const runtime = Pin.elements.compileElements(table, world, {
            elements: [source]
        }) || {};
        const segments = (runtime.segments || []).filter(function filter(seg) {
            return seg && isFiniteNumber(seg.x1) && isFiniteNumber(seg.y1) && isFiniteNumber(seg.x2) && isFiniteNumber(seg.y2);
        });
        const circles = (runtime.circles || []).filter(function filter(circle) {
            return circle && isFiniteNumber(circle.x) && isFiniteNumber(circle.y) && hasPositiveNumber(circle.radius);
        });
        const sensors = (runtime.sensors || []).filter(function filter(sensor) {
            if (!sensor || !sensor.shape || !isFiniteNumber(sensor.x) || !isFiniteNumber(sensor.y)) return false;
            if (sensor.shape === "circle") return hasPositiveNumber(sensor.radius);
            if (sensor.shape === "rect") return hasPositiveNumber(sensor.w) && hasPositiveNumber(sensor.h);
            return false;
        });
        return { segments: segments, circles: circles, sensors: sensors };
    }

    /* What: Compute how far a ray start must move from source center to exit.
     * Why: non-pass-through colliders should never spawn probe balls from inside
     * their own blocking volume.
     */
    function sourceEdgeOffset(geometry, sourceCenter, dirX, dirY, ballRadius) {
        if (!geometry || !sourceCenter) return 0;
        const clearance = 0.5;
        const centerProjection = projectOnDirection(sourceCenter, dirX, dirY);
        let hasBlocking = false;
        let hasAny = false;
        let maxProjection = centerProjection;

        (geometry.circles || []).forEach(function each(circle) {
            if (circle.passThrough) return;
            const support =
                projectOnDirection({ x: circle.x, y: circle.y }, dirX, dirY) +
                circle.radius +
                ballRadius +
                clearance;
            maxProjection = Math.max(maxProjection, support);
            hasBlocking = true;
            hasAny = true;
        });
        (geometry.segments || []).forEach(function each(seg) {
            if (seg.passThrough) return;
            const thickness = hasPositiveNumber(seg.thickness) ? seg.thickness : 0;
            const support =
                Math.max(
                    projectOnDirection({ x: seg.x1, y: seg.y1 }, dirX, dirY),
                    projectOnDirection({ x: seg.x2, y: seg.y2 }, dirX, dirY)
                ) +
                thickness +
                ballRadius +
                clearance;
            maxProjection = Math.max(maxProjection, support);
            hasBlocking = true;
            hasAny = true;
        });

        if (!hasBlocking) {
            (geometry.sensors || []).forEach(function each(sensor) {
                let support = -Infinity;
                if (sensor.shape === "circle") {
                    support =
                        projectOnDirection({ x: sensor.x, y: sensor.y }, dirX, dirY) +
                        sensor.radius +
                        clearance;
                } else if (sensor.shape === "rect") {
                    support =
                        projectOnDirection({ x: sensor.x, y: sensor.y }, dirX, dirY) +
                        Math.abs(dirX) * sensor.w * 0.5 +
                        Math.abs(dirY) * sensor.h * 0.5 +
                        clearance;
                }
                if (!Number.isFinite(support)) return;
                maxProjection = Math.max(maxProjection, support);
                hasAny = true;
            });
        }

        if (!hasAny) return 0;
        return Math.max(0, maxProjection - centerProjection);
    }

    function spreadRadiansForIndex(index, count, spreadDeg) {
        if (count <= 1 || spreadDeg <= 0) return 0;
        const t = count <= 1 ? 0.5 : (index / (count - 1));
        return ((t * 2) - 1) * (spreadDeg * Math.PI / 180);
    }

    function traceTargetRay(table, elements, source, targetFlipper, rayIndex, limits) {
        const sourceCenter = sourceCenterForElement(source);
        if (!sourceCenter || !targetFlipper || !targetFlipper.pivot) {
            return { ok: false, reason: "bad_source" };
        }
        const world = buildEvalWorld(table);
        const playfield = (table && table.playfield) || {};
        const ballRadius = hasPositiveNumber(playfield.ballRadius) ? playfield.ballRadius : 8;
        const envelope = flipperArcEnvelope(targetFlipper, table);
        const toPivotX = targetFlipper.pivot.x - sourceCenter.x;
        const toPivotY = targetFlipper.pivot.y - sourceCenter.y;
        const baseAngle = Math.atan2(toPivotY, toPivotX);
        const angle = baseAngle + spreadRadiansForIndex(rayIndex, limits.count, limits.spreadDeg);
        const directionX = Math.cos(angle);
        const directionY = Math.sin(angle);
        const sourceGeometry = sourceGeometryForElement(table, world, source);
        const edgeOffset = sourceEdgeOffset(sourceGeometry, sourceCenter, directionX, directionY, ballRadius);
        const sourceOrigin = {
            x: sourceCenter.x + directionX * edgeOffset,
            y: sourceCenter.y + directionY * edgeOffset
        };
        const probeSpeed = 15;
        world.balls = [{
            x: sourceOrigin.x,
            y: sourceOrigin.y,
            radius: ballRadius,
            vx: directionX * probeSpeed,
            vy: directionY * probeSpeed,
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
                trajectories: compactTrajectoryDiagnostics(traces, function build(trace) {
                    return {
                        label: trace.sourceId + " -> " + trace.targetFlipperId,
                        status: trace.reached ? "pass" : "warn",
                        limitReason: trace.limitReason || "",
                        ticks: trace.ticks || 0,
                        collisions: trace.collisions || 0
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
            addCheck(report, {
                id: "launcher_velocity_spread",
                category: "stuck",
                status: "warn",
                message: "Launcher velocity spread check skipped: launcher probes did not produce launch traces.",
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
        const launchSpeeds = traces.filter(function filter(trace) {
            return trace && trace.exitedLauncher && hasPositiveNumber(trace.launchSpeed);
        }).map(function map(trace) {
            return trace.launchSpeed;
        });
        const minSpeed = launchSpeeds.length ? Math.min.apply(null, launchSpeeds) : 0;
        const maxSpeed = launchSpeeds.length ? Math.max.apply(null, launchSpeeds) : 0;
        const spread = launchSpeeds.length ? (maxSpeed - minSpeed) : 0;
        report.metrics.launcherVelocitySamples = launchSpeeds.length;
        report.metrics.launcherVelocityMin = minSpeed;
        report.metrics.launcherVelocityMax = maxSpeed;
        report.metrics.launcherVelocitySpread = spread;

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
                trajectories: compactTrajectoryDiagnostics(traces, function build(trace) {
                    return {
                        label: "hold " + trace.holdSeconds.toFixed(2) + "s",
                        status: trace.stuckLikely ? "warn" : "pass",
                        limitReason: trace.limitReason || "",
                        ticks: trace.ticks || 0,
                        collisions: trace.collisions || 0
                    };
                }),
                labels: [{
                    text: traces.length + " launch probes | stuck " + stuckTraces.length + " | drain " + drainTraces.length + " | limits c" + limits.maxCollisions + "/t" + limits.maxTicks,
                    x: 16,
                    y: 34
                }]
            }
        });
        const spreadStatus = launchSpeeds.length < 2 ? "warn" : (spread >= limits.minLaunchSpeedSpread ? "pass" : "warn");
        const spreadMessage = launchSpeeds.length < 2 ?
            "Launcher velocity spread could not be measured across at least two exiting probes." :
            (spread >= limits.minLaunchSpeedSpread ?
                ("Launcher velocity spread passed: " + spread.toFixed(2) + " across " + launchSpeeds.length + " launch samples.") :
                ("Launcher velocity spread is too narrow (" + spread.toFixed(2) + "); expected at least " + limits.minLaunchSpeedSpread.toFixed(2) + "."));
        addCheck(report, {
            id: "launcher_velocity_spread",
            category: "stuck",
            status: spreadStatus,
            message: spreadMessage,
            objects: [],
            diagnostics: {
                objectIds: [],
                labels: [{
                    text: "Launch speed min " + minSpeed.toFixed(2) + " | max " + maxSpeed.toFixed(2) + " | spread " + spread.toFixed(2) + " | target >= " + limits.minLaunchSpeedSpread.toFixed(2),
                    x: 16,
                    y: 88
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
                trajectories: compactTrajectoryDiagnostics(traces, function build(trace) {
                    return {
                        label: trace.flipperId + " t=" + trace.contactT.toFixed(2),
                        status: trace.stuckLikely ? "warn" : "pass",
                        limitReason: trace.limitReason || "",
                        ticks: trace.ticks || 0,
                        collisions: trace.collisions || 0
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

    /* What: Expose stable, user-facing evaluation check IDs.
     * Why: the physics lab needs a deterministic checklist for individual or
     * batch execution without hard-coding evaluator internals in the UI.
     */
    function listChecks() {
        return EVAL_CHECK_DEFS.map(function map(definition) {
            return {
                id: definition.id,
                label: definition.label,
                category: definition.category
            };
        });
    }

    /* What: Resolve which evaluator checks are enabled for this run.
     * Why: callers can run one check, a selected subset, or the full suite.
     */
    function resolveCheckSelection(options) {
        const requested = options && options.evalChecks;
        const defaults = {};
        EVAL_CHECK_DEFS.forEach(function each(definition) {
            defaults[definition.id] = true;
        });
        if (!requested) return defaults;
        const selected = {};
        EVAL_CHECK_DEFS.forEach(function each(definition) {
            selected[definition.id] = false;
        });
        if (Array.isArray(requested)) {
            requested.forEach(function each(id) {
                if (typeof id !== "string") return;
                if (Object.prototype.hasOwnProperty.call(selected, id)) selected[id] = true;
            });
            return selected;
        }
        if (requested && typeof requested === "object") {
            Object.keys(selected).forEach(function each(id) {
                selected[id] = !!requested[id];
            });
            return selected;
        }
        return defaults;
    }

    function runPreLauncherChecks(context, selectedChecks, onProgress) {
        const normalized = context.normalized;
        const report = context.report;
        if (!checkCoreShape(normalized, report)) {
            finalizeOverall(report);
            return false;
        }
        const elements = context.elements;
        if (selectedChecks.table_validation) checkTableValidation(normalized, report);
        if (selectedChecks.playability_validation) checkPlayabilityValidation(normalized, report);
        if (selectedChecks.ids_and_types) checkIdsAndTypes(elements, report);
        if (selectedChecks.numeric_fields) checkNumericFields(normalized, elements, report);
        if (selectedChecks.bounds) checkBounds(normalized, elements, report);
        if (selectedChecks.compilation) checkCompilation(normalized, report);
        if (selectedChecks.accessibility_heatmap) checkAccessibilityHeatmap(normalized, report, context.opts, onProgress);
        if (selectedChecks.autoplay_heatmap) checkAutoplayHeatmap(normalized, report, context.opts);
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

    /*
     * What: Run autoplay sampling and collect trace/heatmap diagnostics.
     * Why: this check validates table flow using production physics while
     * keeping expensive decision logic outside gameplay mode.
     */
    function checkAutoplayHeatmap(table, report, options) {
        if (!Pin.tableAutoplay || typeof Pin.tableAutoplay.run !== "function") {
            addCheck(report, {
                id: "autoplay_heatmap",
                category: "autoplay",
                status: "warn",
                message: "Autoplay runtime is unavailable in this environment.",
                objects: [],
                diagnostics: {}
            });
            return;
        }
        const result = Pin.tableAutoplay.run(table, {
            ballCount: normalizedProbeLimit(options && options.autoplayBallCount, 5, 1, 64),
            maxTicksPerBall: normalizedProbeLimit(options && options.autoplayMaxTicksPerBall, 12000, 120, 120000),
            targetingIntervalTicks: normalizedProbeLimit(options && options.autoplayTargetingIntervalTicks, 8, 1, 120),
            preferUnlitTargets: options && options.autoplayPreferUnlitTargets !== false,
            cellSize: normalizedProbeLimit(options && options.autoplayCellSize, 24, 8, 128),
            aimHorizonTicks: normalizedProbeLimit(options && options.autoplayAimHorizonTicks, 48, 8, 120),
            aimPulseTicks: normalizedProbeLimit(options && options.autoplayAimPulseTicks, 3, 1, 6),
            aimCooldownTicks: normalizedProbeLimit(options && options.autoplayAimCooldownTicks, 8, 2, 24)
        });
        const minScore = normalizedProbeLimit(options && options.autoplayMinScore, 0, 0, 1000000000);
        const bestScore = result && result.summary ? Number(result.summary.bestBallScore || 0) : 0;
        const scoreStatus = bestScore >= minScore ? "pass" : "warn";
        const status = minScore > 0 ? scoreStatus : ((result && result.status) || "pass");
        const message = minScore > 0 ?
            ("Autoplay sampled for score: best " + bestScore + " / required " + minScore + ".") :
            ((result && result.message) || "Autoplay run completed.");
        addCheck(report, {
            id: "autoplay_heatmap",
            category: "autoplay",
            status: status,
            message: message,
            objects: [],
            diagnostics: result && result.diagnostics ? result.diagnostics : {}
        });
    }

    function evaluateTable(table, options) {
        const context = createEvaluationContext(table, options);
        const selectedChecks = resolveCheckSelection(context.opts);
        if (!runPreLauncherChecks(context, selectedChecks, null)) return context.report;
        if (selectedChecks.launcher_rays) {
            checkLauncherRayStuck(context.normalized, context.elements, context.report, context.opts);
        }
        if (selectedChecks.flipper_reachability) {
            checkFlipperRayReachability(context.normalized, context.elements, context.report, context.opts);
        }
        if (selectedChecks.target_to_flipper_reachability) {
            checkTargetToFlipperReachability(context.normalized, context.elements, context.report, context.opts);
        }
        if (selectedChecks.reachability_todo) addReachabilityTodo(context.report);
        finalizeOverall(context.report);
        return context.report;
    }

    function evaluateTableAsync(table, options) {
        const context = createEvaluationContext(table, options);
        const selectedChecks = resolveCheckSelection(context.opts);
        const onProgress = typeof context.opts.onProgress === "function" ? context.opts.onProgress : function noop() {};
        if (!runPreLauncherChecks(context, selectedChecks, onProgress)) return Promise.resolve(context.report);

        const limits = launcherProbeLimits(context.opts);
        const targetLimits = targetReachabilityLimits(context.opts);
        const runLauncher = !!selectedChecks.launcher_rays;
        const runFlipper = !!selectedChecks.flipper_reachability;
        const runTarget = !!selectedChecks.target_to_flipper_reachability;
        const runTodo = !!selectedChecks.reachability_todo;
        const launcherTraces = [];
        const flipperTraces = [];
        const targetTraces = [];
        const flippers = (runFlipper || runTarget) ? flippersFromElements(context.elements) : [];
        const targetSources = runTarget ? logicTriggerSourceElements(context.normalized, context.elements) : [];
        const launcherProbeCount = runLauncher ? limits.count : 0;
        const totalFlipperProbes = runFlipper ? (flippers.length * limits.count) : 0;
        const totalTargetProbes = runTarget ? (targetSources.length * flippers.length * targetLimits.count) : 0;
        const totalProbes = launcherProbeCount + totalFlipperProbes + totalTargetProbes;
        let firstFailure = null;
        let lastYieldTime = 0;
        if (totalProbes > 0) {
            if (runLauncher) {
                onProgress({ phase: "launcher", done: 0, total: totalProbes, message: "Launcher probes 0 / " + launcherProbeCount });
            } else if (runFlipper) {
                onProgress({ phase: "flipper", done: 0, total: totalProbes, message: "Flipper probes 0 / " + totalFlipperProbes });
            } else if (runTarget) {
                onProgress({ phase: "reachability", done: 0, total: totalProbes, message: "Target probes 0 / " + totalTargetProbes });
            }
        }

        function maybeYield(next) {
            const now = Date.now();
            const shouldYield = now - lastYieldTime > 50;
            if (!shouldYield) return next();
            lastYieldTime = now;
            return yieldToBrowser().then(next);
        }

        function finishEvaluation() {
            if (runFlipper) addFlipperRayCheck(context.report, flipperTraces, limits, flippers.length, context.elements);
            if (runTarget) addTargetReachabilityCheck(context.report, targetTraces, targetSources, context.elements, targetLimits);
            if (runTodo) addReachabilityTodo(context.report);
            finalizeOverall(context.report);
            onProgress({ phase: "complete", done: totalProbes, total: totalProbes, message: "Evaluation complete" });
            return Promise.resolve(context.report);
        }

        function runTargetNext(index) {
            if (!runTarget) return finishEvaluation();
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
                done: launcherProbeCount + totalFlipperProbes + index + 1,
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
            if (!runFlipper) {
                if (runTarget) {
                    onProgress({
                        phase: "reachability",
                        done: launcherProbeCount,
                        total: totalProbes,
                        message: "Target probes 0 / " + totalTargetProbes
                    });
                }
                return runTargetNext(0);
            }
            if (index >= totalFlipperProbes) {
                if (runTarget) {
                    onProgress({
                        phase: "reachability",
                        done: launcherProbeCount + totalFlipperProbes,
                        total: totalProbes,
                        message: "Target probes 0 / " + totalTargetProbes
                    });
                }
                return runTargetNext(0);
            }

            const flipper = flippers[Math.floor(index / limits.count)];
            const sampleIndex = index % limits.count;
            const contactT = flipperContactTForIndex(sampleIndex, limits.count);
            flipperTraces.push(traceFlipperRay(context.normalized, context.elements, context.normalized && context.normalized.playfield, flipper, contactT, sampleIndex, limits));

            onProgress({
                phase: "flipper",
                done: launcherProbeCount + index + 1,
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
            if (!runLauncher) {
                if (runFlipper) {
                    onProgress({ phase: "flipper", done: launcherProbeCount, total: totalProbes, message: "Flipper probes 0 / " + totalFlipperProbes });
                } else if (runTarget) {
                    onProgress({ phase: "reachability", done: launcherProbeCount, total: totalProbes, message: "Target probes 0 / " + totalTargetProbes });
                }
                return runFlipperNext(0);
            }
            if (index >= launcherProbeCount || firstFailure) {
                addLauncherRayCheck(context.report, launcherTraces, limits, firstFailure);
                if (runFlipper) {
                    onProgress({ phase: "flipper", done: launcherProbeCount, total: totalProbes, message: "Flipper probes 0 / " + totalFlipperProbes });
                } else if (runTarget) {
                    onProgress({ phase: "reachability", done: launcherProbeCount, total: totalProbes, message: "Target probes 0 / " + totalTargetProbes });
                }
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
                message: "Launcher probes " + (index + 1) + " / " + launcherProbeCount
            });

            const now = Date.now();
            const shouldYield = index + 1 < launcherProbeCount && ((index + 1) % 4 === 0 || now - lastYieldTime > 50);
            if (shouldYield) {
                lastYieldTime = now;
                return yieldToBrowser().then(function resume() {
                    return runNext(index + 1);
                });
            }
            return runNext(index + 1);
        }

        if (totalProbes === 0) return finishEvaluation();
        return runNext(0);
    }

    Pin.tableEval = {
        listChecks: listChecks,
        evaluateTable: evaluateTable,
        evaluateTableAsync: evaluateTableAsync
    };
})(window.Pin);
