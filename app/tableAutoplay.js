/*
 * Lab autoplay controller and evaluator helper.
 * What: Runs lab-only autoplay sequences on real table physics to gather
 * trajectory and heatmap diagnostics.
 * Why: We need heavier decision work for lab/eval without touching gameplay
 * loop performance or introducing a second physics model.
 */
(function initTableAutoplay(Pin) {
    function clone(value) {
        return JSON.parse(JSON.stringify(value));
    }

    function isFiniteNumber(value) {
        return typeof value === "number" && Number.isFinite(value);
    }

    function hasPositiveNumber(value) {
        return isFiniteNumber(value) && value > 0;
    }

    function clamp(value, min, max) {
        return Math.max(min, Math.min(max, value));
    }

    function fixedDtForWorld(world) {
        if (Pin.table && Pin.table.getFixedPhysicsDt) {
            return Pin.table.getFixedPhysicsDt(world && world.table && world.table.playfield);
        }
        return 1 / 120;
    }

    function controlNameForFlipper(flipper, table) {
        if (flipper && flipper.control) return String(flipper.control);
        if (flipper && flipper.side) return String(flipper.side);
        if (flipper && flipper.pivot && table && table.playfield && isFiniteNumber(table.playfield.width)) {
            return flipper.pivot.x > table.playfield.width * 0.5 ? "right" : "left";
        }
        if (flipper && isFiniteNumber(flipper.restAngle) && Math.cos(flipper.restAngle) < 0) return "right";
        return "left";
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
            staticSensorBroadPhase: Pin.physics.buildSensorBroadPhase(staticRuntime.sensors || []),
            physicsCollisionCount: 0,
            lastPhysicsCollision: null,
            dynamicCompileCache: {},
            physicsScratch: {}
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

    function makeHeatmap(playfield, cellSize) {
        const width = hasPositiveNumber(playfield && playfield.width) ? playfield.width : 500;
        const height = hasPositiveNumber(playfield && playfield.height) ? playfield.height : 880;
        const safeCell = clamp(Math.round(cellSize || 32), 8, 128);
        const cols = Math.max(1, Math.ceil(width / safeCell));
        const rows = Math.max(1, Math.ceil(height / safeCell));
        return {
            cols: cols,
            rows: rows,
            cellSize: safeCell,
            values: new Array(cols * rows).fill(0),
            max: 0
        };
    }

    function stampHeatmap(heatmap, ball) {
        if (!heatmap || !ball || !isFiniteNumber(ball.x) || !isFiniteNumber(ball.y)) return;
        const col = Math.max(0, Math.min(heatmap.cols - 1, Math.floor(ball.x / heatmap.cellSize)));
        const row = Math.max(0, Math.min(heatmap.rows - 1, Math.floor(ball.y / heatmap.cellSize)));
        const index = row * heatmap.cols + col;
        const next = (heatmap.values[index] || 0) + 1;
        heatmap.values[index] = next;
        if (next > heatmap.max) heatmap.max = next;
    }

    function targetSourceTypeSet() {
        return {
            lane: true,
            dropTarget: true,
            bumper: true,
            scoreZone: true,
            spinner: true,
            kicker: true,
            trough: true
        };
    }

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
        return null;
    }

    function sourceElements(table, elements) {
        const byId = {};
        const seen = {};
        const out = [];
        const allowed = targetSourceTypeSet();
        (elements || []).forEach(function each(el) {
            if (el && typeof el.id === "string") byId[el.id] = el;
        });
        const doc = (table && table.logicDocument) || {};
        const switches = Array.isArray(doc.switchRegistry) ? doc.switchRegistry : [];
        switches.forEach(function each(row) {
            if (!row) return;
            const sourceId = typeof row.sourceElementId === "string" && row.sourceElementId ? row.sourceElementId :
                (typeof row.id === "string" ? row.id : "");
            const el = byId[sourceId];
            if (!el || !el.id || !allowed[el.type] || seen[el.id] || !sourceCenterForElement(el)) return;
            seen[el.id] = true;
            out.push(el);
        });
        (elements || []).forEach(function each(el) {
            if (!el || !el.id || !allowed[el.type] || seen[el.id] || !sourceCenterForElement(el)) return;
            seen[el.id] = true;
            out.push(el);
        });
        return out;
    }

    function resolveLampLit(world, el) {
        const lampState = world && world.lampState ? world.lampState : {};
        const keys = [
            String((el && el.lampId) || ""),
            String((el && el.id) || "")
        ].filter(Boolean);
        return keys.some(function some(key) {
            const state = lampState[key];
            return !!(state && state.on);
        });
    }

    function resolveElementActive(world, el) {
        if (!el) return false;
        const fallback = el.active !== false;
        if (Pin.rules && typeof Pin.rules.resolveElementProperty === "function") {
            return !!Pin.rules.resolveElementProperty(world, el, "active", fallback);
        }
        const props = world && world.ruleState && world.ruleState.elementProperties && world.ruleState.elementProperties[el.id];
        if (props && Object.prototype.hasOwnProperty.call(props, "active")) return !!props.active;
        return !!fallback;
    }

    function isPrimaryTarget(el) {
        return el && (el.type === "lane" || el.type === "dropTarget");
    }

    function isFoundationalTarget(world, el) {
        if (!el) return false;
        if (el.type === "lane" || el.type === "dropTarget") return true;
        if (el.type === "trough") return resolveElementActive(world, el);
        return false;
    }

    function isCollectableTarget(world, el) {
        if (!el) return false;
        if (el.type === "trough") return resolveElementActive(world, el);
        if (el.type === "kicker" || el.type === "spinner" || el.type === "scoreZone") return resolveElementActive(world, el) || resolveLampLit(world, el);
        return false;
    }

    function pickTarget(world, elements, preferUnlit) {
        const table = world && world.table ? world.table : {};
        const candidates = sourceElements(table, elements);
        if (!candidates.length) return null;
        const ball = world && world.balls && world.balls[0] ? world.balls[0] : null;
        const primary = candidates.filter(isPrimaryTarget);
        const hasUnlitPrimary = primary.some(function some(el) {
            return !resolveLampLit(world, el);
        });
        const hasFoundational = candidates.some(function some(el) {
            return isFoundationalTarget(world, el);
        });
        const ranked = candidates.map(function map(el) {
            const lit = resolveLampLit(world, el);
            const primaryTarget = isPrimaryTarget(el);
            const foundational = isFoundationalTarget(world, el);
            const collectable = isCollectableTarget(world, el);
            const center = sourceCenterForElement(el) || el;
            let distance = 999999;
            if (ball && isFiniteNumber(ball.x) && isFiniteNumber(ball.y) && isFiniteNumber(center.x) && isFiniteNumber(center.y)) {
                const dx = ball.x - center.x;
                const dy = ball.y - center.y;
                distance = Math.sqrt(dx * dx + dy * dy);
            }
            return {
                el: Object.assign({}, el, { x: center.x, y: center.y }),
                lit: lit,
                primary: primaryTarget,
                foundational: foundational,
                collectable: collectable,
                distance: distance
            };
        });
        ranked.sort(function sort(a, b) {
            if (hasFoundational && a.foundational !== b.foundational) return a.foundational ? -1 : 1;
            if (preferUnlit && hasUnlitPrimary && a.primary !== b.primary) return a.primary ? -1 : 1;
            if (preferUnlit && hasUnlitPrimary && a.primary && b.primary && a.lit !== b.lit) return a.lit ? 1 : -1;
            if (!hasUnlitPrimary && a.collectable !== b.collectable) return a.collectable ? -1 : 1;
            return a.distance - b.distance;
        });
        return ranked[0].el;
    }

    function targetLookup(elements) {
        const out = {};
        sourceElements(null, elements).forEach(function each(el) {
            if (el && el.id) out[el.id] = el;
        });
        return out;
    }

    function makeController(world, options) {
        const table = world && world.table ? world.table : {};
        const playfield = table.playfield || {};
        const elements = table.elements || [];
        const targetInterval = Math.max(1, Math.round((options && options.targetingIntervalTicks) || 8));
        const flippers = elements.filter(function filter(el) { return el && el.type === "flipper" && el.pivot; });
        const preferred = {
            target: null,
            nextRetargetTick: 0
        };
        const controls = { left: false, right: false, launch: false };
        let launchHoldTicks = 0;
        let launchReleased = false;
        let prevInLaunchLane = true;
        let serveIndex = 0;
        let escapeTicks = 0;
        let escapeSide = "left";
        let trapTicks = 0;
        const recentBallSamples = [];
        const aimState = {
            nextDecisionTick: 0,
            chosen: "none",
            phase: "idle",
            scheduled: null,
            cooldownTicks: 0,
            debug: null,
            lastAction: null
        };

        function holdTicksForServe(index) {
            const minHold = Math.max(4, Math.min(80, Math.round((options && options.minLaunchHoldTicks == null ? 12 : options.minLaunchHoldTicks))));
            const maxHold = Math.max(minHold, Math.min(120, Math.round((options && options.maxLaunchHoldTicks == null ? 34 : options.maxLaunchHoldTicks))));
            const span = Math.max(1, Math.round((options && options.holdSweepSpan) || 7));
            const t = span <= 1 ? 0.5 : ((index % span) / (span - 1));
            return Math.round(minHold + (maxHold - minHold) * t);
        }

        function ballSpeed(ball) {
            if (!ball || !isFiniteNumber(ball.vx) || !isFiniteNumber(ball.vy)) return 0;
            return Math.sqrt(ball.vx * ball.vx + ball.vy * ball.vy);
        }

        function nearAnyFlipperPivot(ball) {
            if (!ball || !flippers.length) return false;
            return flippers.some(function some(flipper) {
                if (!flipper || !flipper.pivot) return false;
                const dx = ball.x - flipper.pivot.x;
                const dy = ball.y - flipper.pivot.y;
                return (dx * dx + dy * dy) <= (110 * 110);
            });
        }

        function ballToFlipper(ball, side) {
            if (!ball || !isFiniteNumber(ball.x) || !isFiniteNumber(ball.y)) return null;
            let best = null;
            flippers.forEach(function each(flipper) {
                if (!flipper || !flipper.pivot) return;
                if (controlNameForFlipper(flipper, table) !== side) return;
                const dx = ball.x - flipper.pivot.x;
                const dy = ball.y - flipper.pivot.y;
                const distance = Math.sqrt(dx * dx + dy * dy);
                if (!best || distance < best.distance) {
                    best = { flipper: flipper, dx: dx, dy: dy, distance: distance };
                }
            });
            return best;
        }

        function contactPulseForBall(ball) {
            if (!ball || !isFiniteNumber(ball.vy)) return null;
            const pulseTicks = Math.max(1, Math.min(4, Math.round((options && options.contactPulseTicks) || 2)));
            const maxCaptureDistance = Math.max(50, Math.min(170, Math.round((options && options.contactCaptureDistance) || 120)));
            const left = ballToFlipper(ball, "left");
            const right = ballToFlipper(ball, "right");
            const candidates = [left && { side: "left", sample: left }, right && { side: "right", sample: right }].filter(Boolean);
            if (!candidates.length) return null;
            candidates.sort(function sort(a, b) { return a.sample.distance - b.sample.distance; });
            const best = candidates[0];
            if (best.sample.distance > maxCaptureDistance) return null;
            const approaching = ball.vy > -0.1 || Math.abs(best.sample.dy) < 22;
            if (!approaching) return null;
            if (Math.abs(best.sample.dx) > ((best.sample.flipper.length || 95) * 0.9 + 22)) return null;
            return {
                side: best.side,
                delay: 0,
                pulse: pulseTicks,
                reason: "contact"
            };
        }

        function updateTrapDetection(ball) {
            if (!ball || ball.inLaunchLane) {
                recentBallSamples.length = 0;
                trapTicks = 0;
                return;
            }
            recentBallSamples.push({ x: ball.x, y: ball.y });
            if (recentBallSamples.length > 30) recentBallSamples.shift();
            if (recentBallSamples.length < 12) return;
            let minX = Infinity;
            let maxX = -Infinity;
            let minY = Infinity;
            let maxY = -Infinity;
            recentBallSamples.forEach(function each(sample) {
                if (sample.x < minX) minX = sample.x;
                if (sample.x > maxX) maxX = sample.x;
                if (sample.y < minY) minY = sample.y;
                if (sample.y > maxY) maxY = sample.y;
            });
            const spread = Math.max(maxX - minX, maxY - minY);
            const slow = ballSpeed(ball) < 2.3;
            const nearPivot = nearAnyFlipperPivot(ball);
            if (slow && nearPivot && spread < 26) trapTicks += 1;
            else trapTicks = Math.max(0, trapTicks - 2);
            if (trapTicks > 38 && escapeTicks <= 0) {
                escapeTicks = 20;
                trapTicks = 0;
                recentBallSamples.length = 0;
                escapeSide = escapeSide === "left" ? "right" : "left";
            }
        }

        function clonePredictionWorld(sourceWorld) {
            const simWorld = buildEvalWorld(table);
            simWorld.balls = clone(sourceWorld.balls || []);
            simWorld.controls = clone(sourceWorld.controls || { left: false, right: false });
            simWorld.elementState = clone(sourceWorld.elementState || {});
            simWorld.ruleState = clone(sourceWorld.ruleState || {});
            simWorld.lampState = clone(sourceWorld.lampState || {});
            simWorld.launchCharging = !!sourceWorld.launchCharging;
            simWorld.physicsTick = sourceWorld.physicsTick || 0;
            simWorld.physicsTime = sourceWorld.physicsTime || 0;
            simWorld.lastPhysicsDt = sourceWorld.lastPhysicsDt || fixedDtForWorld(sourceWorld);
            return simWorld;
        }

        function stepPredictionWorld(simWorld, dt, pressLeft, pressRight) {
            simWorld.controls.left = !!pressLeft;
            simWorld.controls.right = !!pressRight;
            if (Pin.elements && typeof Pin.elements.stepDynamicElements === "function") {
                Pin.elements.stepDynamicElements(simWorld.table, simWorld, dt, simWorld.dynamicPhysicsElements);
            }
            refreshDynamicRuntime(simWorld);
            simWorld.lastPhysicsDt = dt;
            Pin.physics.stepWorld(simWorld, dt);
            if (Pin.events && typeof Pin.events.processRules === "function") {
                Pin.events.processRules(simWorld, dt);
            }
        }

        function targetRadius(target) {
            return Math.max(10, Math.min(42, Math.round((options && options.aimTargetRadius) || 22)));
        }

        function actionKey(action) {
            if (!action || action.mode === "none") return "none";
            return action.side + "@" + action.delay + "/" + action.pulse;
        }

        function evaluateCandidate(ball, target, action) {
            if (!ball || !target) return null;
            const simWorld = clonePredictionWorld(world);
            const dt = fixedDtForWorld(simWorld);
            const horizonTicks = Math.max(8, Math.min(120, Math.round((options && options.aimHorizonTicks) || 48)));
            const simPath = [];
            const hitRadius = targetRadius(target);
            let minDistance = Infinity;
            let hit = false;
            for (let i = 0; i < horizonTicks; i++) {
                const pressing = !!action && action.mode !== "none" && i >= action.delay && i < (action.delay + action.pulse);
                stepPredictionWorld(simWorld, dt, pressing && action.side === "left", pressing && action.side === "right");
                const simBall = simWorld.balls && simWorld.balls[0] ? simWorld.balls[0] : null;
                if (!simBall || simBall.drained) break;
                if (!isFiniteNumber(simBall.x) || !isFiniteNumber(simBall.y)) break;
                const dx = simBall.x - target.x;
                const dy = simBall.y - target.y;
                const d = Math.sqrt(dx * dx + dy * dy);
                if (d < minDistance) minDistance = d;
                if (d <= hitRadius) hit = true;
                if (i < 14 || i % 3 === 0) simPath.push({ x: simBall.x, y: simBall.y });
            }
            const endBall = simWorld.balls && simWorld.balls[0] ? simWorld.balls[0] : null;
            if (!endBall || !isFiniteNumber(endBall.x) || !isFiniteNumber(endBall.y)) return null;
            const speed = ballSpeed(endBall);
            const upwardBonus = endBall.vy < 0 ? Math.min(12, Math.abs(endBall.vy) * 1.8) : 0;
            const drainPenalty = endBall.drained ? 350 : 0;
            const lowCornerPenalty = (endBall.y > ((playfield.height || 880) * 0.78) && Math.abs(endBall.vx) < 0.4 && Math.abs(endBall.vy) < 0.7) ? 42 : 0;
            const hitBonus = hit ? 220 : 0;
            const idlePenalty = (!action || action.mode === "none") ? 12 : 0;
            const score = (minDistance * 1.6) + drainPenalty + lowCornerPenalty + idlePenalty - upwardBonus - hitBonus - Math.min(14, speed * 0.5);
            return {
                mode: (!action || action.mode === "none") ? "none" : action.side,
                action: actionKey(action),
                score: score,
                distance: minDistance,
                hit: hit,
                end: { x: endBall.x, y: endBall.y, vx: endBall.vx, vy: endBall.vy },
                path: simPath
            };
        }

        function parseDelayTicks() {
            const raw = (options && options.aimDelayTicks);
            if (Array.isArray(raw) && raw.length) {
                return raw.map(function map(v) { return Math.max(0, Math.min(12, Math.round(Number(v) || 0))); });
            }
            return [0, 2, 4];
        }

        function applyScheduledPulse() {
            const scheduled = aimState.scheduled;
            if (!scheduled) return null;
            if (scheduled.delay > 0) {
                scheduled.delay -= 1;
                aimState.phase = "scheduled";
                return { left: false, right: false };
            }
            if (scheduled.pulse > 0) {
                scheduled.pulse -= 1;
                aimState.phase = "pulse";
                return {
                    left: scheduled.side === "left",
                    right: scheduled.side === "right"
                };
            }
            aimState.scheduled = null;
            aimState.phase = "cooldown";
            aimState.cooldownTicks = Math.max(2, Math.min(24, Math.round((options && options.aimCooldownTicks) || 8)));
            return { left: false, right: false };
        }

        function maybePredictiveDecision(ball, target, tick) {
            if (!target || !ball) return;
            if (aimState.scheduled) return;
            if (tick < aimState.nextDecisionTick) return;
            if (aimState.cooldownTicks > 0) return;
            const actionZoneY = (hasPositiveNumber(playfield.height) ? playfield.height : 880) * 0.58;
            if (!(ball.y >= actionZoneY && ball.vy > 0.08)) return;
            if (!nearAnyFlipperPivot(ball)) return;
            const decisionInterval = Math.max(1, Math.min(30, Math.round((options && options.aimDecisionIntervalTicks) || 6)));
            aimState.nextDecisionTick = tick + decisionInterval;
            const pulseTicks = Math.max(1, Math.min(6, Math.round((options && options.aimPulseTicks) || 3)));
            const candidateActions = [{ mode: "none", side: "none", delay: 0, pulse: 0 }];
            parseDelayTicks().forEach(function eachDelay(delay) {
                candidateActions.push({ mode: "pulse", side: "left", delay: delay, pulse: pulseTicks });
                candidateActions.push({ mode: "pulse", side: "right", delay: delay, pulse: pulseTicks });
            });
            const candidates = candidateActions.map(function map(action) {
                return evaluateCandidate(ball, target, action);
            }).filter(Boolean);
            if (!candidates.length) return;
            candidates.sort(function sort(a, b) { return a.score - b.score; });
            const best = candidates[0];
            const noneCandidate = candidates.find(function find(entry) { return entry.mode === "none"; }) || null;
            const bestDistance = best && isFiniteNumber(best.distance) ? best.distance : Infinity;
            const mustImproveBy = Math.max(2, Math.min(40, Number((options && options.aimMinScoreGain) || 8)));
            const improvement = noneCandidate ? (noneCandidate.score - best.score) : 999;
            const actionMatch = /^(left|right)@(\d+)\/(\d+)$/.exec(best.action || "");
            if (!actionMatch) return;
            if (bestDistance > Math.max(30, (options && options.aimMaxDistance) || 130)) return;
            if (improvement < mustImproveBy && !best.hit) return;
            aimState.chosen = actionMatch[1];
            aimState.scheduled = {
                side: actionMatch[1],
                delay: Math.max(0, parseInt(actionMatch[2], 10) || 0),
                pulse: Math.max(1, parseInt(actionMatch[3], 10) || pulseTicks)
            };
            aimState.phase = aimState.scheduled.delay > 0 ? "scheduled" : "pulse";
            aimState.lastAction = best.action;
            aimState.debug = {
                tick: tick,
                chosen: aimState.chosen,
                phase: aimState.phase,
                scheduled: clone(aimState.scheduled),
                target: { id: target.id || "target", x: target.x, y: target.y },
                cooldownTicks: aimState.cooldownTicks,
                candidates: candidates.map(function map(entry) {
                    return {
                        mode: entry.mode,
                        action: entry.action,
                        hit: !!entry.hit,
                        score: Math.round(entry.score * 100) / 100,
                        distance: Math.round(entry.distance * 100) / 100,
                        end: entry.end,
                        path: entry.path
                    };
                })
            };
        }

        function scheduleImmediatePulse(side, pulse, reason, tick, target) {
            aimState.chosen = side;
            aimState.scheduled = {
                side: side,
                delay: 0,
                pulse: Math.max(1, Math.min(6, Math.round(pulse || 2)))
            };
            aimState.phase = "pulse";
            aimState.debug = {
                tick: tick,
                chosen: side,
                phase: "pulse",
                scheduled: clone(aimState.scheduled),
                target: target ? { id: target.id || "target", x: target.x, y: target.y } : null,
                cooldownTicks: aimState.cooldownTicks,
                reason: reason || "immediate",
                candidates: []
            };
        }

        function applyEscapeControls() {
            if (escapeTicks <= 0) return null;
            escapeTicks -= 1;
            // Brief full release, then one-side pulse to shake free from elbow trap.
            if (escapeTicks >= 12) return { left: false, right: false };
            if (escapeTicks >= 6) {
                aimState.phase = "escape";
                return {
                    left: escapeSide === "left",
                    right: escapeSide === "right"
                };
            }
            return { left: false, right: false };
        }

        function update() {
            const tick = world.physicsTick || 0;
            const ball = world.balls && world.balls[0] ? world.balls[0] : null;
            controls.left = false;
            controls.right = false;
            controls.launch = false;

            if (!ball) {
                // No active ball: ensure next served ball is treated as a fresh lane entry.
                prevInLaunchLane = false;
                launchHoldTicks = 0;
                launchReleased = false;
                return controls;
            }

            // Ball returned to launch lane (new serve) -> allow a new charge/release cycle.
            if (ball.inLaunchLane && !prevInLaunchLane) {
                launchHoldTicks = 0;
                launchReleased = false;
                serveIndex += 1;
                recentBallSamples.length = 0;
                trapTicks = 0;
                escapeTicks = 0;
            }
            prevInLaunchLane = !!ball.inLaunchLane;

            if (ball.inLaunchLane && !launchReleased) {
                const holdTicks = options && options.launchHoldTicks != null ?
                    Math.max(6, Math.round(options.launchHoldTicks)) :
                    holdTicksForServe(serveIndex);
                launchHoldTicks += 1;
                controls.launch = launchHoldTicks < holdTicks;
                if (launchHoldTicks >= holdTicks) {
                    launchReleased = true;
                    controls.launch = false;
                }
                return controls;
            }

            if (tick >= preferred.nextRetargetTick || !preferred.target) {
                preferred.target = pickTarget(world, elements, (options && options.preferUnlitTargets) !== false);
                preferred.nextRetargetTick = tick + targetInterval;
            }
            updateTrapDetection(ball);
            const escape = applyEscapeControls();
            if (aimState.cooldownTicks > 0) {
                aimState.cooldownTicks -= 1;
                if (!aimState.scheduled) aimState.phase = "cooldown";
            }
            if (!escape && !aimState.scheduled) {
                const contact = contactPulseForBall(ball);
                if (contact) {
                    scheduleImmediatePulse(contact.side, contact.pulse, contact.reason, tick, preferred.target);
                    aimState.cooldownTicks = 0;
                }
            }
            if (!escape && !aimState.scheduled) maybePredictiveDecision(ball, preferred.target, tick);
            const aiming = escape ? { left: !!escape.left, right: !!escape.right } : applyScheduledPulse();
            controls.left = aiming ? !!aiming.left : false;
            controls.right = aiming ? !!aiming.right : false;
            if (!aimState.debug) {
                aimState.debug = {
                    tick: tick,
                    chosen: aimState.chosen,
                    phase: aimState.phase,
                    cooldownTicks: aimState.cooldownTicks,
                    target: preferred.target ? { id: preferred.target.id || "target", x: preferred.target.x, y: preferred.target.y } : null,
                    candidates: []
                };
            } else {
                aimState.debug.phase = aimState.phase;
                aimState.debug.cooldownTicks = aimState.cooldownTicks;
            }
            return controls;
        }

        return {
            update: update,
            getTarget: function getTarget() { return preferred.target; },
            getAimDebug: function getAimDebug() { return aimState.debug; }
        };
    }

    function stepWorld(world, controller, dt, stats, trace, heatmap) {
        const controls = controller.update();
        world.controls.left = !!controls.left;
        world.controls.right = !!controls.right;
        world.launchCharging = !!controls.launch;
        if (stats) {
            if (controls.left) stats.leftPresses += 1;
            if (controls.right) stats.rightPresses += 1;
        }
        if (stats && stats.launchHeld && !controls.launch && Pin.physics && Pin.physics.releaseLauncher) {
            Pin.physics.releaseLauncher(world);
            stats.launchReleases += 1;
        }
        if (stats) stats.launchHeld = !!controls.launch;
        if (Pin.elements && typeof Pin.elements.stepDynamicElements === "function") {
            Pin.elements.stepDynamicElements(world.table, world, dt, world.dynamicPhysicsElements);
        }
        refreshDynamicRuntime(world);
        world.lastPhysicsDt = dt;
        Pin.physics.stepWorld(world, dt);
        if (Pin.events && typeof Pin.events.processRules === "function") {
            const processed = Pin.events.processRules(world, dt);
            if (stats && stats.targetLookup && Array.isArray(processed)) {
                processed.forEach(function each(event) {
                    if (!event || event.type !== "switchClosed" || !event.sourceId) return;
                    const sourceId = String(event.sourceId);
                    if (!stats.targetLookup[sourceId]) return;
                    stats.targetHitMap[sourceId] = (stats.targetHitMap[sourceId] || 0) + 1;
                    stats.hitCount += 1;
                });
            }
        }
        const ball = world.balls && world.balls[0] ? world.balls[0] : null;
        if (ball) {
            stats.traceSampleCounter = (stats.traceSampleCounter || 0) + 1;
            if (trace && (trace.length < 320 || stats.traceSampleCounter % 4 === 0)) {
                trace.push({ x: ball.x, y: ball.y });
            }
            stampHeatmap(heatmap, ball);
        }
        return ball;
    }

    function run(table, options) {
        const normalized = Pin.table && Pin.table.normalizeTable ? Pin.table.normalizeTable(table) : clone(table);
        const playfield = (normalized && normalized.playfield) || {};
        const opts = options || {};
        const ballsToRun = Math.max(1, Math.min(64, Math.round(opts.ballCount || 5)));
        const maxTicksPerBall = Math.max(120, Math.min(120000, Math.round(opts.maxTicksPerBall || 12000)));
        const heatmap = makeHeatmap(playfield, opts.cellSize || 24);
        const trajectories = [];
        const labels = [];
        const stats = {
            leftPresses: 0,
            rightPresses: 0,
            launchReleases: 0,
            launchHeld: false,
            hitCount: 0,
            totalScore: 0,
            bestBallScore: 0
        };
        stats.targetHitMap = {};
        stats.targetLookup = targetLookup(normalized.elements || []);
        const minLaunchHoldTicks = Math.max(4, Math.min(80, Math.round((opts.minLaunchHoldTicks == null ? 12 : opts.minLaunchHoldTicks))));
        const maxLaunchHoldTicks = Math.max(minLaunchHoldTicks, Math.min(120, Math.round((opts.maxLaunchHoldTicks == null ? 34 : opts.maxLaunchHoldTicks))));

        for (let ballIndex = 0; ballIndex < ballsToRun; ballIndex++) {
            const world = buildEvalWorld(normalized);
            const launcher = Pin.physics.getLauncherConfig(world);
            const radius = hasPositiveNumber(playfield.ballRadius) ? playfield.ballRadius : 8;
            world.balls = [{
                x: launcher.x,
                y: launcher.bottom - radius - 1,
                radius: radius,
                vx: 0,
                vy: 0,
                level: 0,
                inLaunchLane: true
            }];
            const trace = [];
            const launchT = ballsToRun <= 1 ? 0.5 : (ballIndex / (ballsToRun - 1));
            const launchHoldTicks = Math.round(minLaunchHoldTicks + (maxLaunchHoldTicks - minLaunchHoldTicks) * launchT);
            const controller = makeController(world, Object.assign({}, opts, {
                launchHoldTicks: launchHoldTicks
            }));
            let drained = false;
            for (let tick = 0; tick < maxTicksPerBall; tick++) {
                const dt = fixedDtForWorld(world);
                const ball = stepWorld(world, controller, dt, stats, trace, heatmap);
                if (!ball) {
                    drained = true;
                    break;
                }
                if (ball.drained) {
                    drained = true;
                    break;
                }
                if (!isFiniteNumber(ball.x) || !isFiniteNumber(ball.y) || !isFiniteNumber(ball.vx) || !isFiniteNumber(ball.vy)) {
                    break;
                }
            }
            trajectories.push({
                label: "ball_" + (ballIndex + 1),
                status: drained ? "pass" : "warn",
                launchHoldTicks: launchHoldTicks,
                score: Number(world.score) || 0,
                path: trace
            });
            stats.totalScore += Number(world.score) || 0;
            if ((Number(world.score) || 0) > stats.bestBallScore) stats.bestBallScore = Number(world.score) || 0;
        }

        labels.push({
            text: "Autoplay balls " + ballsToRun + " | left " + stats.leftPresses + " | right " + stats.rightPresses + " | launches " + stats.launchReleases,
            x: 14,
            y: 20
        });
        labels.push({
            text: "Target hits " + stats.hitCount + " | unique " + Object.keys(stats.targetHitMap).length + " | hold ticks " + minLaunchHoldTicks + "-" + maxLaunchHoldTicks,
            x: 14,
            y: 38
        });
        labels.push({
            text: "Score total " + stats.totalScore + " | best ball " + stats.bestBallScore,
            x: 14,
            y: 56
        });

        return {
            status: "pass",
            message: "Autoplay sampled " + ballsToRun + " balls.",
            summary: {
                balls: ballsToRun,
                leftPresses: stats.leftPresses,
                rightPresses: stats.rightPresses,
                launches: stats.launchReleases,
                targetHits: stats.hitCount,
                targetHitMap: clone(stats.targetHitMap),
                totalScore: stats.totalScore,
                bestBallScore: stats.bestBallScore,
                averageBallScore: ballsToRun > 0 ? Math.round(stats.totalScore / ballsToRun) : 0
            },
            diagnostics: {
                heatmap: heatmap,
                trajectories: trajectories,
                labels: labels,
                points: Object.keys(stats.targetHitMap).map(function map(id) {
                    const el = (normalized.elements || []).find(function find(entry) { return entry && entry.id === id; });
                    const center = sourceCenterForElement(el);
                    return center && isFiniteNumber(center.x) && isFiniteNumber(center.y) ? { x: center.x, y: center.y } : null;
                }).filter(Boolean)
            }
        };
    }

    Pin.tableAutoplay = {
        run: run,
        createController: makeController
    };
})(window.Pin);
