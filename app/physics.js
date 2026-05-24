/*
 * Pinball physics stepping, collision response, and sensor processing.
 * What: Advance balls through broad-phase and swept collisions, process
 * launcher/ramp/sensor state, and expose the runtime physics API.
 * Why: centralizing simulation state transitions keeps gameplay behavior
 * deterministic and auditable across table features and element modules.
 */
(function initPhysics(Pin) {
    function getTiltSettings(world) {
        if (!Pin.table || !Pin.table.getTiltSettings) return null;
        const playfield = world && world.table && world.table.playfield;
        return Pin.table.getTiltSettings(playfield);
    }

    function getTiltState(world) {
        world.tiltState = world.tiltState || {
            lockout: false,
            cooldownUntil: 0,
            recentTimes: []
        };
        if (!Array.isArray(world.tiltState.recentTimes)) world.tiltState.recentTimes = [];
        return world.tiltState;
    }

    /*
     * What: Apply one player tilt impulse when allowed by table rules.
     * Why: play controls need a deterministic table bump with cooldown and
     * lockout accounting so aggressive nudging can be penalized.
     */
    function applyTilt(world) {
        const tilt = getTiltSettings(world);
        if (!tilt || !tilt.enabled) return false;
        const tiltState = getTiltState(world);
        const now = world.physicsTime || 0;
        if (tiltState.lockout) return false;
        if (now < (tiltState.cooldownUntil || 0)) return false;
        tiltState.recentTimes = tiltState.recentTimes.filter(function keep(time) {
            return now - time <= tilt.warningWindowSeconds;
        });
        tiltState.recentTimes.push(now);
        tiltState.cooldownUntil = now + tilt.cooldownSeconds;
        if (tiltState.recentTimes.length >= tilt.warningLimit) {
            tiltState.lockout = true;
            if (Pin.events) Pin.events.emit(world, { type: "tiltLockout", sourceId: "playfield", elementType: "playfield" });
            return false;
        }
        (world.balls || []).forEach(function each(ball) {
            if (!ball || ball.drained || ball.inLaunchLane) return;
            ball.vx += tilt.impulseX;
            ball.vy += tilt.impulseY;
        });
        if (Pin.events) Pin.events.emit(world, { type: "tilt", sourceId: "playfield", elementType: "playfield" });
        return true;
    }

    function clearTiltLockout(world) {
        const tiltState = getTiltState(world);
        tiltState.lockout = false;
        tiltState.cooldownUntil = 0;
        tiltState.recentTimes.length = 0;
    }
    function closestPointOnSegment(px, py, x1, y1, x2, y2) {
        const dx = x2 - x1;
        const dy = y2 - y1;
        const lenSq = dx * dx + dy * dy;
        if (lenSq === 0) return { x: x1, y: y1, t: 0 };
        let t = ((px - x1) * dx + (py - y1) * dy) / lenSq;
        t = Math.max(0, Math.min(1, t));
        return { x: x1 + t * dx, y: y1 + t * dy, t: t };
    }

    function circleSegmentCollision(cx, cy, r, x1, y1, x2, y2, thickness, vx, vy) {
        const closest = closestPointOnSegment(cx, cy, x1, y1, x2, y2);
        const dx = cx - closest.x;
        const dy = cy - closest.y;
        const dist = Math.sqrt(dx * dx + dy * dy);
        const radius = r + (thickness || 0);
        const epsilon = 0.0001;
        if (dist <= radius && dist > epsilon) {
            return { hit: true, nx: dx / dist, ny: dy / dist, overlap: radius - dist + 0.01, cx: closest.x, cy: closest.y, t: closest.t };
        }
        if (dist <= epsilon) {
            const segDx = x2 - x1;
            const segDy = y2 - y1;
            const segLen = Math.sqrt(segDx * segDx + segDy * segDy) || 1;
            let nx = -segDy / segLen;
            let ny = segDx / segLen;
            if (typeof vx === "number" && typeof vy === "number") {
                const toward = vx * nx + vy * ny;
                if (toward > 0) {
                    nx = -nx;
                    ny = -ny;
                }
            }
            return {
                hit: true,
                nx: nx,
                ny: ny,
                overlap: radius + 0.01,
                cx: closest.x,
                cy: closest.y,
                t: closest.t
            };
        }
        return { hit: false };
    }

    function circleCircleCollision(cx1, cy1, r1, cx2, cy2, r2, vx, vy) {
        const dx = cx1 - cx2;
        const dy = cy1 - cy2;
        const dist = Math.sqrt(dx * dx + dy * dy);
        const minDist = r1 + r2;
        const epsilon = 0.0001;
        if (dist <= minDist && dist > epsilon) {
            return { hit: true, nx: dx / dist, ny: dy / dist, overlap: minDist - dist + 0.01 };
        }
        if (dist <= epsilon) {
            const speed = Math.sqrt((vx || 0) * (vx || 0) + (vy || 0) * (vy || 0));
            const nx = speed > epsilon ? -(vx || 0) / speed : 0;
            const ny = speed > epsilon ? -(vy || 0) / speed : -1;
            return { hit: true, nx: nx, ny: ny, overlap: minDist + 0.01 };
        }
        return { hit: false };
    }

    function resolveCollision(ball, nx, ny, overlap, restitution) {
        const correction = Math.max(0, overlap || 0);
        ball.x += nx * correction;
        ball.y += ny * correction;
        const relVn = ball.vx * nx + ball.vy * ny;
        if (relVn < 0) {
            ball.vx -= (1 + restitution) * relVn * nx;
            ball.vy -= (1 + restitution) * relVn * ny;
        }
    }

    /*
     * Resolve the restitution to use for a specific collider.
     * Why: table-level restitution is only a fallback. Individual colliders
     * such as flippers and rubber walls need their own bounce response.
     */
    function getColliderRestitution(collider, fallbackRestitution) {
        if (collider && typeof collider.restitution === "number" && !Number.isNaN(collider.restitution)) {
            return collider.restitution;
        }
        return fallbackRestitution;
    }

    function getResolveNormal(collider, ball, hit) {
        if (collider && collider.resolveNormal) {
            const normal = collider.resolveNormal(ball, hit);
            if (normal && typeof normal.x === "number" && typeof normal.y === "number") {
                const len = Math.sqrt(normal.x * normal.x + normal.y * normal.y);
                if (len > 0.000001) return { x: normal.x / len, y: normal.y / len };
            }
        }
        return { x: hit.nx, y: hit.ny };
    }

    function segmentAabb(seg) {
        const pad = seg.thickness || 0;
        return {
            left: Math.min(seg.x1, seg.x2) - pad,
            right: Math.max(seg.x1, seg.x2) + pad,
            top: Math.min(seg.y1, seg.y2) - pad,
            bottom: Math.max(seg.y1, seg.y2) + pad
        };
    }

    function circleAabb(circle) {
        const r = circle.radius || 0;
        return {
            left: circle.x - r,
            right: circle.x + r,
            top: circle.y - r,
            bottom: circle.y + r
        };
    }

    function inflateAabb(aabb, amount) {
        return {
            left: aabb.left - amount,
            right: aabb.right + amount,
            top: aabb.top - amount,
            bottom: aabb.bottom + amount
        };
    }

    function buildBroadPhase(segments, circles, playfield) {
        /* What: Build a uniform-grid index for static colliders.
         * Why: broad-phase culling keeps collision checks proportional to local
         * neighborhood density instead of total table collider count.
         */
        const cellSize = 80;
        const grid = {};
        function add(kind, index, aabb) {
            const minX = Math.floor(aabb.left / cellSize);
            const maxX = Math.floor(aabb.right / cellSize);
            const minY = Math.floor(aabb.top / cellSize);
            const maxY = Math.floor(aabb.bottom / cellSize);
            for (let y = minY; y <= maxY; y++) {
                for (let x = minX; x <= maxX; x++) {
                    const key = x + "," + y;
                    if (!grid[key]) grid[key] = [];
                    grid[key].push({ kind: kind, index: index });
                }
            }
        }
        (segments || []).forEach(function each(seg, i) { add("s", i, segmentAabb(seg)); });
        (circles || []).forEach(function each(circle, i) { add("c", i, circleAabb(circle)); });
        return {
            cellSize: cellSize,
            grid: grid,
            width: playfield && playfield.width,
            height: playfield && playfield.height
        };
    }

    /*
     * What: Build a grid index for non-blocking switch sensors.
     * Why: rollover-heavy tables should not test every sensor on every physics
     * substep when the ball only occupies a small area of the playfield.
     */
    function buildSensorBroadPhase(sensors) {
        const cellSize = 80;
        const grid = {};
        function sensorAabb(sensor) {
            if (sensor.shape === "rect" || sensor.w != null || sensor.h != null) {
                const halfW = (sensor.w || 0) * 0.5;
                const halfH = (sensor.h || 0) * 0.5;
                return {
                    left: sensor.x - halfW,
                    right: sensor.x + halfW,
                    top: sensor.y - halfH,
                    bottom: sensor.y + halfH
                };
            }
            const r = sensor.radius || 0;
            return {
                left: sensor.x - r,
                right: sensor.x + r,
                top: sensor.y - r,
                bottom: sensor.y + r
            };
        }
        function add(index, aabb) {
            const minX = Math.floor(aabb.left / cellSize);
            const maxX = Math.floor(aabb.right / cellSize);
            const minY = Math.floor(aabb.top / cellSize);
            const maxY = Math.floor(aabb.bottom / cellSize);
            for (let y = minY; y <= maxY; y++) {
                for (let x = minX; x <= maxX; x++) {
                    const key = x + "," + y;
                    if (!grid[key]) grid[key] = [];
                    grid[key].push(index);
                }
            }
        }
        (sensors || []).forEach(function each(sensor, i) { add(i, sensorAabb(sensor)); });
        return {
            cellSize: cellSize,
            grid: grid
        };
    }

    function queryBroadPhase(index, aabb) {
        if (!index || !index.grid) return null;
        const refs = [];
        const seen = {};
        const minX = Math.floor(aabb.left / index.cellSize);
        const maxX = Math.floor(aabb.right / index.cellSize);
        const minY = Math.floor(aabb.top / index.cellSize);
        const maxY = Math.floor(aabb.bottom / index.cellSize);
        for (let y = minY; y <= maxY; y++) {
            for (let x = minX; x <= maxX; x++) {
                const bucket = index.grid[x + "," + y] || [];
                bucket.forEach(function each(ref) {
                    const key = ref.kind + ref.index;
                    if (seen[key]) return;
                    seen[key] = true;
                    refs.push(ref);
                });
            }
        }
        return refs;
    }

    function querySensorBroadPhase(index, aabb) {
        if (!index || !index.grid) return null;
        const refs = [];
        const seen = {};
        const minX = Math.floor(aabb.left / index.cellSize);
        const maxX = Math.floor(aabb.right / index.cellSize);
        const minY = Math.floor(aabb.top / index.cellSize);
        const maxY = Math.floor(aabb.bottom / index.cellSize);
        for (let y = minY; y <= maxY; y++) {
            for (let x = minX; x <= maxX; x++) {
                const bucket = index.grid[x + "," + y] || [];
                bucket.forEach(function each(sensorIndex) {
                    if (seen[sensorIndex]) return;
                    seen[sensorIndex] = true;
                    refs.push(sensorIndex);
                });
            }
        }
        return refs;
    }

    function sweptCirclePoint(cx, cy, radius, dx, dy, px, py) {
        const ox = cx - px;
        const oy = cy - py;
        const a = dx * dx + dy * dy;
        if (a <= 0.000001) return null;
        const b = 2 * (ox * dx + oy * dy);
        const c = ox * ox + oy * oy - radius * radius;
        if (c <= 0) return { time: 0, nx: ox || -dx, ny: oy || -dy, cx: px, cy: py };
        const disc = b * b - 4 * a * c;
        if (disc < 0) return null;
        const sqrtDisc = Math.sqrt(disc);
        const t = (-b - sqrtDisc) / (2 * a);
        if (t < 0 || t > 1) return null;
        const hx = cx + dx * t;
        const hy = cy + dy * t;
        const nxRaw = hx - px;
        const nyRaw = hy - py;
        const len = Math.sqrt(nxRaw * nxRaw + nyRaw * nyRaw) || 1;
        return { time: t, nx: nxRaw / len, ny: nyRaw / len, cx: px, cy: py };
    }

    function sweptCircleCircle(cx, cy, r, dx, dy, circle) {
        return sweptCirclePoint(cx, cy, r + circle.radius, dx, dy, circle.x, circle.y);
    }

    function sweptCircleSegment(cx, cy, r, dx, dy, seg) {
        const sx = seg.x2 - seg.x1;
        const sy = seg.y2 - seg.y1;
        const segLen = Math.sqrt(sx * sx + sy * sy);
        if (segLen <= 0.000001) {
            return sweptCirclePoint(cx, cy, r + (seg.thickness || 0), dx, dy, seg.x1, seg.y1);
        }
        const radius = r + (seg.thickness || 0);
        const nx = -sy / segLen;
        const ny = sx / segLen;
        const relX = cx - seg.x1;
        const relY = cy - seg.y1;
        const startDist = relX * nx + relY * ny;
        const deltaDist = dx * nx + dy * ny;
        let best = null;

        function consider(hit) {
            if (!hit || hit.time < 0 || hit.time > 1) return;
            if (!best || hit.time < best.time) best = hit;
        }

        if (Math.abs(deltaDist) > 0.000001) {
            [-radius, radius].forEach(function each(targetDist) {
                const t = (targetDist - startDist) / deltaDist;
                if (t < 0 || t > 1) return;
                const hx = cx + dx * t;
                const hy = cy + dy * t;
                const along = ((hx - seg.x1) * sx + (hy - seg.y1) * sy) / (segLen * segLen);
                if (along < 0 || along > 1) return;
                const side = targetDist >= 0 ? 1 : -1;
                consider({
                    time: t,
                    nx: nx * side,
                    ny: ny * side,
                    tSeg: along,
                    cx: seg.x1 + sx * along,
                    cy: seg.y1 + sy * along
                });
            });
        }

        consider(sweptCirclePoint(cx, cy, radius, dx, dy, seg.x1, seg.y1));
        if (best && best.tSeg == null) best.tSeg = 0;
        const endHit = sweptCirclePoint(cx, cy, radius, dx, dy, seg.x2, seg.y2);
        if (endHit) endHit.tSeg = 1;
        consider(endHit);
        return best;
    }

    function getCandidateRefs(ball, world, dx, dy) {
        const query = inflateAabb({
            left: Math.min(ball.x, ball.x + dx) - ball.radius,
            right: Math.max(ball.x, ball.x + dx) + ball.radius,
            top: Math.min(ball.y, ball.y + dy) - ball.radius,
            bottom: Math.max(ball.y, ball.y + dy) + ball.radius
        }, Math.max(12, ball.radius));
        return queryBroadPhase(world.staticBroadPhase, query);
    }

    function findSweptCollision(ball, world, dx, dy) {
        /* What: Find earliest blocking collision along the current movement.
         * Why: earliest-hit response prevents tunneling and preserves consistent
         * bounce ordering when multiple colliders share the travel corridor.
         */
        if (dx * dx + dy * dy <= 0.000001) return null;
        const staticRefs = getCandidateRefs(ball, world, dx, dy);
        const dynamicSegmentOffset = world.staticSegments ? world.staticSegments.length : 0;
        const dynamicCircleOffset = world.staticCircles ? world.staticCircles.length : 0;
        let best = null;

        function consider(hit, collider, key) {
            if (!hit || !colliderMatchesBall(collider, ball)) return;
            if (collider.passThrough) return;
            if (collider.oneWay && collider.oneWay(ball, world, hit)) return;
            if (!best || hit.time < best.hit.time) best = { hit: hit, collider: collider, key: key };
        }

        if (staticRefs) {
            staticRefs.forEach(function each(ref) {
                if (ref.kind === "s") {
                    const seg = world.staticSegments[ref.index];
                    consider(sweptCircleSegment(ball.x, ball.y, ball.radius, dx, dy, seg), seg, "s" + ref.index);
                } else {
                    const circle = world.staticCircles[ref.index];
                    consider(sweptCircleCircle(ball.x, ball.y, ball.radius, dx, dy, circle), circle, "c" + ref.index);
                }
            });
        } else {
            (world.staticSegments || []).forEach(function each(seg, i) {
                consider(sweptCircleSegment(ball.x, ball.y, ball.radius, dx, dy, seg), seg, "s" + i);
            });
            (world.staticCircles || []).forEach(function each(circle, i) {
                consider(sweptCircleCircle(ball.x, ball.y, ball.radius, dx, dy, circle), circle, "c" + i);
            });
        }
        (world.dynamicSegments || []).forEach(function each(seg, i) {
            consider(sweptCircleSegment(ball.x, ball.y, ball.radius, dx, dy, seg), seg, "s" + (dynamicSegmentOffset + i));
        });
        (world.dynamicCircles || []).forEach(function each(circle, i) {
            consider(sweptCircleCircle(ball.x, ball.y, ball.radius, dx, dy, circle), circle, "c" + (dynamicCircleOffset + i));
        });
        return best;
    }

    /*
     * Fire pass-through swept contacts without making them blocking collisions.
     * Why: spinner blades should score and animate when crossed quickly, but
     * should never consume ball travel or redirect the ball like a wall.
     */
    function processSweptPassThroughCollisions(ball, world, dx, dy) {
        if (dx * dx + dy * dy <= 0.000001) return;
        const staticRefs = getCandidateRefs(ball, world, dx, dy);
        const dynamicSegmentOffset = world.staticSegments ? world.staticSegments.length : 0;
        const dynamicCircleOffset = world.staticCircles ? world.staticCircles.length : 0;

        function consider(hit, collider, key) {
            if (!collider || !collider.passThrough || !hit || !colliderMatchesBall(collider, ball)) return;
            if (collider.oneWay && collider.oneWay(ball, world, hit)) return;
            hit.impactSpeed = Math.max(0, -(ball.vx * hit.nx + ball.vy * hit.ny)) * 0.35;
            fireColliderHit(ball, collider, hit, world, key);
        }

        if (staticRefs) {
            staticRefs.forEach(function each(ref) {
                if (ref.kind === "s") {
                    const seg = world.staticSegments[ref.index];
                    consider(sweptCircleSegment(ball.x, ball.y, ball.radius, dx, dy, seg), seg, "s" + ref.index);
                } else {
                    const circle = world.staticCircles[ref.index];
                    consider(sweptCircleCircle(ball.x, ball.y, ball.radius, dx, dy, circle), circle, "c" + ref.index);
                }
            });
        } else {
            (world.staticSegments || []).forEach(function each(seg, i) {
                consider(sweptCircleSegment(ball.x, ball.y, ball.radius, dx, dy, seg), seg, "s" + i);
            });
            (world.staticCircles || []).forEach(function each(circle, i) {
                consider(sweptCircleCircle(ball.x, ball.y, ball.radius, dx, dy, circle), circle, "c" + i);
            });
        }
        (world.dynamicSegments || []).forEach(function each(seg, i) {
            consider(sweptCircleSegment(ball.x, ball.y, ball.radius, dx, dy, seg), seg, "s" + (dynamicSegmentOffset + i));
        });
        (world.dynamicCircles || []).forEach(function each(circle, i) {
            consider(sweptCircleCircle(ball.x, ball.y, ball.radius, dx, dy, circle), circle, "c" + (dynamicCircleOffset + i));
        });
    }

    function fireColliderHit(ball, collider, hit, world, key) {
        const hitKey = collider.hitKey || key;
        if (collider.passThroughCooldown) {
            const now = world.physicsTime || 0;
            ball._passThroughHitTime = ball._passThroughHitTime || {};
            if (ball._passThroughHitTime[hitKey] != null && now - ball._passThroughHitTime[hitKey] < collider.passThroughCooldown) return;
            ball._passThroughHitTime[hitKey] = now;
        }
        ball._hitFrame = ball._hitFrame || {};
        const alreadyHitThisTick = ball._hitFrame[hitKey] === world.physicsTick;
        // Custom collision solvers must still run on repeated same-tick contact;
        // the de-dupe only suppresses duplicate visual/gameplay side effects.
        if (!alreadyHitThisTick) {
            ball._hitFrame[hitKey] = world.physicsTick;
            if (Pin.render && Pin.render.emitCollisionSparks) Pin.render.emitCollisionSparks(world, ball, hit);
        } else if (!collider.skipDefaultResolve) {
            return;
        }
        /* What: Count accepted contacts on the world when callers need
         * observability.
         * Why: eval probes must abandon long-running stuck cases from the same
         * collision path as gameplay, not from a separate geometry estimate.
         */
        if (world) {
            world.physicsCollisionCount = (world.physicsCollisionCount || 0) + 1;
            world.lastPhysicsCollision = {
                hitKey: hitKey,
                sourceId: collider.sourceId || collider.elementId || collider.id || "",
                elementType: collider.elementType || "",
                x: hit && typeof hit.cx === "number" ? hit.cx : ball.x,
                y: hit && typeof hit.cy === "number" ? hit.cy : ball.y
            };
        }
        if (collider.onHit) collider.onHit(ball, hit, world);
    }

    /*
     * Find a collider by its hit key.
     * Why: supported-contact effects need the current flipper geometry after the
     * initial collision response, not just the stale segment snapshot from impact.
     */
    function findColliderByHitKey(world, hitKey) {
        const dynamicSegments = world.dynamicSegments || [];
        let sweepFallback = null;
        for (let i = dynamicSegments.length - 1; i >= 0; i--) {
            const seg = dynamicSegments[i];
            if (!seg || seg.hitKey !== hitKey) continue;
            if (!seg.sweepOnly) return seg;
            if (!sweepFallback) sweepFallback = seg;
        }
        const staticSegments = world.staticSegments || [];
        for (let i = 0; i < staticSegments.length; i++) {
            const seg = staticSegments[i];
            if (seg && seg.hitKey === hitKey) return seg;
        }
        return sweepFallback;
    }

    /*
     * Resolve the current surface velocity for a persistent supported contact.
     * Why: flippers keep moving after the first hit, and release must not reuse
     * an old active-flip velocity captured by the previous contact frame.
     */
    function getSupportedSurfaceVelocity(collider, support, contactT) {
        if (collider && typeof collider.surfaceVelocityAt === "function") {
            const velocity = collider.surfaceVelocityAt(contactT);
            if (velocity && typeof velocity.x === "number" && typeof velocity.y === "number") {
                return { x: velocity.x, y: velocity.y };
            }
        }
        return {
            x: support.surfaceVx || 0,
            y: support.surfaceVy || 0
        };
    }

    /*
     * Apply a small persistent supported-contact effect for flippers.
     * Why: without this, flipper surface friction only matters at impact time and
     * has little influence while the ball is actually riding the blade.
     */
    function applySupportedContacts(ball, world, subDt) {
        const support = ball.supportContact;
        if (!support || support.kind !== "flipper") return;
        if ((support.tick || 0) === (world.physicsTick || 0)) return;
        const collider = findColliderByHitKey(world, support.hitKey);
        if (!collider) {
            ball.supportContact = null;
            return;
        }
        const currentControlActive = typeof collider.controlActive === "boolean" ? collider.controlActive : !!support.controlActive;
        if (support.controlActive && !currentControlActive) {
            ball.supportContact = null;
            return;
        }
        const closest = closestPointOnSegment(ball.x, ball.y, collider.x1, collider.y1, collider.x2, collider.y2);
        const dx = ball.x - closest.x;
        const dy = ball.y - closest.y;
        const distance = Math.sqrt(dx * dx + dy * dy);
        // Support is a narrow contact tolerance, not a magnetic capture band.
        const contactRadius = support.contactRadius || support.supportRadius || (ball.radius + (collider.thickness || 0));
        const contactSlop = typeof support.contactSlop === "number" ? support.contactSlop : 2;
        if (distance > contactRadius + contactSlop) {
            ball.supportContact = null;
            return;
        }
        const hit = circleSegmentCollision(ball.x, ball.y, ball.radius, collider.x1, collider.y1, collider.x2, collider.y2, collider.thickness, ball.vx, ball.vy);
        const radialLen = distance || 1;
        const fallbackHit = {
            hit: hit.hit,
            nx: hit.hit && typeof hit.nx === "number" ? hit.nx : dx / radialLen,
            ny: hit.hit && typeof hit.ny === "number" ? hit.ny : dy / radialLen,
            overlap: hit.hit && typeof hit.overlap === "number" ? hit.overlap : Math.max(0, contactRadius - distance),
            t: hit.hit && typeof hit.t === "number" ? hit.t : closest.t
        };
        const normal = getResolveNormal(collider, ball, fallbackHit);
        const segDx = collider.x2 - collider.x1;
        const segDy = collider.y2 - collider.y1;
        const segLen = Math.sqrt(segDx * segDx + segDy * segDy) || 1;
        const bladeTangentX = segDx / segLen;
        const bladeTangentY = segDy / segLen;
        let tangentX = -normal.y;
        let tangentY = normal.x;
        if (tangentX * bladeTangentX + tangentY * bladeTangentY < 0) {
            tangentX = -tangentX;
            tangentY = -tangentY;
        }
        const penetration = Math.max(0, contactRadius - distance);
        if (penetration > 0) {
            ball.x += normal.x * (penetration + 0.01);
            ball.y += normal.y * (penetration + 0.01);
        }
        const surfaceVelocity = getSupportedSurfaceVelocity(collider, support, closest.t);
        const surfaceVx = surfaceVelocity.x;
        const surfaceVy = surfaceVelocity.y;
        const relNx = (ball.vx - surfaceVx) * normal.x + (ball.vy - surfaceVy) * normal.y;
        const relTx = (ball.vx - surfaceVx) * tangentX + (ball.vy - surfaceVy) * tangentY;
        if (relNx > 0.6) {
            ball.supportContact = null;
            return;
        }
        const friction = Math.max(0, support.surfaceFriction || 0);
        const gravity = (world.table && world.table.playfield && world.table.playfield.gravity) || 0;
        const inwardGravity = Math.max(0, -(gravity * normal.y));
        const inwardContact = Math.max(0, -relNx);
        const normalLoad = inwardGravity + inwardContact + penetration * 0.12;
        const frictionImpulse = Math.min(Math.abs(relTx), normalLoad * friction * subDt * 60);
        const nextRelTx = relTx - Math.sign(relTx || 1) * frictionImpulse;
        // Preserve outward normal motion so support behaves like contact, not glue.
        const supportedNormal = Math.max(0, relNx);
        ball.vx = surfaceVx + tangentX * nextRelTx + normal.x * supportedNormal;
        ball.vy = surfaceVy + tangentY * nextRelTx + normal.y * supportedNormal;
        support.tick = world.physicsTick || 0;
        support.tx = tangentX;
        support.ty = tangentY;
        support.nx = normal.x;
        support.ny = normal.y;
    }

    function resolveBallCollisions(ball, world, restitution) {
        let anyHit = false;
        const iterations = 3;
        const speed = Math.sqrt(ball.vx * ball.vx + ball.vy * ball.vy);
        const ballQuery = inflateAabb({
            left: ball.x - ball.radius,
            right: ball.x + ball.radius,
            top: ball.y - ball.radius,
            bottom: ball.y + ball.radius
        }, Math.max(12, speed + ball.radius));
        const staticRefs = queryBroadPhase(world.staticBroadPhase, ballQuery);
        for (let pass = 0; pass < iterations; pass++) {
            let passHit = false;
            const dynamicSegmentOffset = world.staticSegments ? world.staticSegments.length : 0;
            const dynamicCircleOffset = world.staticCircles ? world.staticCircles.length : 0;

            function testSegment(seg, key) {
                if (seg.sweepOnly) return;
                if (!colliderMatchesBall(seg, ball)) return;
                const hit = circleSegmentCollision(ball.x, ball.y, ball.radius, seg.x1, seg.y1, seg.x2, seg.y2, seg.thickness, ball.vx, ball.vy);
                if (!hit.hit) return;
                if (seg.oneWay && seg.oneWay(ball, world, hit)) return;
                {
                    const normal = getResolveNormal(seg, ball, hit);
                    hit.nx = normal.x;
                    hit.ny = normal.y;
                    hit.impactSpeed = Math.max(0, -(ball.vx * normal.x + ball.vy * normal.y));
                    if (!seg.skipDefaultResolve) {
                        resolveCollision(ball, normal.x, normal.y, hit.overlap, getColliderRestitution(seg, restitution));
                    }
                    fireColliderHit(ball, seg, hit, world, key);
                    passHit = true;
                    anyHit = true;
                }
            }

            function testCircle(circle, key) {
                if (!colliderMatchesBall(circle, ball)) return;
                const hit = circleCircleCollision(ball.x, ball.y, ball.radius, circle.x, circle.y, circle.radius, ball.vx, ball.vy);
                if (hit.hit) {
                    hit.cx = circle.x + hit.nx * circle.radius;
                    hit.cy = circle.y + hit.ny * circle.radius;
                    hit.impactSpeed = Math.max(0, -(ball.vx * hit.nx + ball.vy * hit.ny));
                    resolveCollision(ball, hit.nx, hit.ny, hit.overlap, getColliderRestitution(circle, restitution));
                    fireColliderHit(ball, circle, hit, world, key);
                    passHit = true;
                    anyHit = true;
                }
            }

            if (staticRefs) {
                staticRefs.forEach(function each(ref) {
                    if (ref.kind === "s") testSegment(world.staticSegments[ref.index], "s" + ref.index);
                });
            } else {
                (world.staticSegments || world.runtimeSegments || []).forEach(function each(seg, i) { testSegment(seg, "s" + i); });
            }
            (world.dynamicSegments || []).forEach(function each(seg, i) { testSegment(seg, "s" + (dynamicSegmentOffset + i)); });

            if (staticRefs) {
                staticRefs.forEach(function each(ref) {
                    if (ref.kind === "c") testCircle(world.staticCircles[ref.index], "c" + ref.index);
                });
            } else {
                (world.staticCircles || world.runtimeCircles || []).forEach(function each(circle, i) { testCircle(circle, "c" + i); });
            }
            (world.dynamicCircles || []).forEach(function each(circle, i) { testCircle(circle, "c" + (dynamicCircleOffset + i)); });

            if (!passHit) break;
        }
        return anyHit;
    }

    function moveBallWithSweeps(ball, world, dt, restitution) {
        /* What: Integrate one ball with swept collision sub-advances.
         * Why: fast pinball motion needs time-of-impact stepping so contact
         * handling remains stable at higher velocities.
         */
        let remainingTime = dt;
        const maxHits = 4;
        for (let i = 0; i < maxHits; i++) {
            const dx = ball.vx * remainingTime * 60;
            const dy = ball.vy * remainingTime * 60;
            const swept = findSweptCollision(ball, world, dx, dy);
            if (!swept || swept.hit.time >= 1) {
                processSweptPassThroughCollisions(ball, world, dx, dy);
                ball.x += dx;
                ball.y += dy;
                updateRampState(ball, world);
                resolveBallCollisions(ball, world, restitution);
                return;
            }

            const travelT = Math.max(0, swept.hit.time - 0.0001);
            processSweptPassThroughCollisions(ball, world, dx * travelT, dy * travelT);
            ball.x += dx * travelT;
            ball.y += dy * travelT;
            updateRampState(ball, world);

            const normal = getResolveNormal(swept.collider, ball, swept.hit);
            const contactHit = {
                hit: true,
                nx: normal.x,
                ny: normal.y,
                overlap: 0.02,
                cx: typeof swept.hit.cx === "number" ? swept.hit.cx : undefined,
                cy: typeof swept.hit.cy === "number" ? swept.hit.cy : undefined,
                impactSpeed: Math.max(0, -(ball.vx * normal.x + ball.vy * normal.y)),
                t: swept.hit.tSeg == null ? 0.5 : swept.hit.tSeg
            };
            if (!swept.collider.skipDefaultResolve) {
                resolveCollision(ball, normal.x, normal.y, contactHit.overlap, getColliderRestitution(swept.collider, restitution));
            }
            fireColliderHit(ball, swept.collider, contactHit, world, swept.key);

            const minConsumedTime = Math.min(remainingTime, 0.000001);
            const consumedTime = Math.max(minConsumedTime, remainingTime * swept.hit.time);
            remainingTime = Math.max(0, remainingTime - consumedTime);
            if (remainingTime <= 0.000001 || ball.vx * ball.vx + ball.vy * ball.vy < 0.0001) {
                resolveBallCollisions(ball, world, restitution);
                return;
            }
        }
        ball.x += ball.vx * remainingTime * 60;
        ball.y += ball.vy * remainingTime * 60;
        updateRampState(ball, world);
        resolveBallCollisions(ball, world, restitution);
    }

    function pointInPolygon(x, y, points) {
        if (!points || points.length < 3) return false;
        let inside = false;
        for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
            const pi = points[i];
            const pj = points[j];
            const crosses = ((pi.y > y) !== (pj.y > y)) &&
                (x < (pj.x - pi.x) * (y - pi.y) / ((pj.y - pi.y) || 0.000001) + pi.x);
            if (crosses) inside = !inside;
        }
        return inside;
    }

    function closestProgressOnPath(x, y, segments, totalLength) {
        let best = null;
        (segments || []).forEach(function each(seg) {
            const closest = closestPointOnSegment(x, y, seg.x1, seg.y1, seg.x2, seg.y2);
            const dx = x - closest.x;
            const dy = y - closest.y;
            const distSq = dx * dx + dy * dy;
            const along = (seg.startLength || 0) + closest.t * (seg.length || 0);
            if (!best || distSq < best.distSq) {
                best = { distSq: distSq, progress: totalLength > 0 ? along / totalLength : 0, x: closest.x, y: closest.y };
            }
        });
        return best || { distSq: Infinity, progress: 0, x: x, y: y };
    }

    function finishRamp(ball, ramp, level) {
        ball.level = level;
        ball.z = level === ramp.levelTo ? ramp.zEnd : ramp.zStart;
        ball.surfaceId = null;
        ball.rampState = null;
    }

    function updateRampState(ball, world) {
        const ramps = world.runtimeRamps || [];
        if (ball.rampState) {
            const ramp = ramps.find(function find(r) { return r.id === ball.rampState.id; });
            if (!ramp) {
                ball.surfaceId = null;
                ball.rampState = null;
                return;
            }
            const closest = closestProgressOnPath(ball.x, ball.y, ramp.centerSegments, ramp.totalLength);
            const inside = pointInPolygon(ball.x, ball.y, ramp.outline);
            const progress = Math.max(0, Math.min(1, closest.progress));
            ball.surfaceId = ramp.id;
            ball.z = ramp.zStart + (ramp.zEnd - ramp.zStart) * progress;
            ball.rampState.progress = progress;

            if (!inside || progress <= 0.02 || progress >= 0.98) {
                finishRamp(ball, ramp, progress >= 0.5 ? ramp.levelTo : ramp.levelFrom);
            }
            return;
        }

        ramps.some(function tryEnter(ramp) {
            if (ball.level !== ramp.levelFrom && ball.level !== ramp.levelTo) return false;
            if (!pointInPolygon(ball.x, ball.y, ramp.outline)) return false;
            const closest = closestProgressOnPath(ball.x, ball.y, ramp.centerSegments, ramp.totalLength);
            const progress = Math.max(0, Math.min(1, closest.progress));
            const nearFrom = ball.level === ramp.levelFrom && progress < 0.35;
            const nearTo = ball.level === ramp.levelTo && progress > 0.65;
            if (!nearFrom && !nearTo) return false;
            ball.surfaceId = ramp.id;
            ball.rampState = { id: ramp.id, progress: progress };
            ball.z = ramp.zStart + (ramp.zEnd - ramp.zStart) * progress;
            return true;
        });
    }

    function colliderMatchesBall(collider, ball) {
        if (collider.level === "all") return true;
        if (ball.surfaceId) return collider.surfaceId === ball.surfaceId;
        const ballLevel = typeof ball.level === "number" ? ball.level : 0;
        const colliderLevel = typeof collider.level === "number" ? collider.level : 0;
        return colliderLevel === ballLevel;
    }

    function sensorOverlapsBall(sensor, ball) {
        if (!colliderMatchesBall(sensor, ball)) return false;
        if (sensor.shape === "rect" || sensor.w != null || sensor.h != null) {
            const halfW = (sensor.w || 0) * 0.5;
            const halfH = (sensor.h || 0) * 0.5;
            const closestX = Math.max(sensor.x - halfW, Math.min(ball.x, sensor.x + halfW));
            const closestY = Math.max(sensor.y - halfH, Math.min(ball.y, sensor.y + halfH));
            const dx = ball.x - closestX;
            const dy = ball.y - closestY;
            return dx * dx + dy * dy <= ball.radius * ball.radius;
        }
        const radius = sensor.radius || 0;
        const dx = ball.x - sensor.x;
        const dy = ball.y - sensor.y;
        return dx * dx + dy * dy <= (ball.radius + radius) * (ball.radius + radius);
    }

    function processSensors(ball, world, ballIndex) {
        /* What: Emit switch-open/close transitions for overlapping sensors.
         * Why: rules logic needs edge-triggered sensor transitions per ball
         * instead of stateless overlap checks every frame.
         */
        const sensors = world.runtimeSensors || [];
        if (!sensors.length) return;
        world.sensorState = world.sensorState || {};
        const ballKey = ball.id || ("ball" + ballIndex);
        const active = {};
        const query = inflateAabb({
            left: ball.x - ball.radius,
            right: ball.x + ball.radius,
            top: ball.y - ball.radius,
            bottom: ball.y + ball.radius
        }, 2);
        const candidates = [];
        const splitSensors = Array.isArray(world.staticSensors) || Array.isArray(world.dynamicSensors);
        if (splitSensors) {
            const staticRefs = querySensorBroadPhase(world.staticSensorBroadPhase, query);
            if (staticRefs) {
                staticRefs.forEach(function each(sensorIndex) {
                    if (world.staticSensors && world.staticSensors[sensorIndex]) {
                        candidates.push({ sensor: world.staticSensors[sensorIndex], index: sensorIndex });
                    }
                });
            } else {
                (world.staticSensors || []).forEach(function each(sensor, sensorIndex) {
                    candidates.push({ sensor: sensor, index: sensorIndex });
                });
            }
            const dynamicOffset = world.staticSensors ? world.staticSensors.length : 0;
            (world.dynamicSensors || []).forEach(function each(sensor, sensorIndex) {
                candidates.push({ sensor: sensor, index: dynamicOffset + sensorIndex });
            });
        } else {
            sensors.forEach(function each(sensor, sensorIndex) {
                candidates.push({ sensor: sensor, index: sensorIndex });
            });
        }
        candidates.forEach(function each(candidate) {
            const sensor = candidate.sensor;
            const sensorIndex = candidate.index;
            const sensorId = sensor.id || ("sensor" + sensorIndex);
            const key = ballKey + "|" + sensorId;
            if (!sensorOverlapsBall(sensor, ball)) return;
            active[key] = true;
            if (!world.sensorState[key]) {
                world.sensorState[key] = true;
                if (Pin.events) {
                    Pin.events.emit(world, { type: "switchClosed", sourceId: sensorId, elementType: sensor.elementType || "sensor" });
                }
                if (sensor.onEnter) sensor.onEnter(ball, world, sensor);
            } else if (sensor.onStay) {
                sensor.onStay(ball, world, sensor);
            }
        });
        Object.keys(world.sensorState).forEach(function each(key) {
            if (key.indexOf(ballKey + "|") !== 0 || active[key]) return;
            const sensorId = key.slice(ballKey.length + 1);
            delete world.sensorState[key];
            if (Pin.events) {
                Pin.events.emit(world, { type: "switchOpened", sourceId: sensorId, elementType: "sensor" });
            }
        });
    }

    function getLauncherConfig(world) {
        if (world && world._launcherConfig && world._launcherConfigTable === world.table) {
            return world._launcherConfig;
        }
        let lane = null;
        const elements = (world.table && world.table.elements) || [];
        for (let i = 0; i < elements.length; i++) {
            if (elements[i] && elements[i].type === "launcher") {
                lane = elements[i];
                break;
            }
        }
        const x = (lane && lane.x) || 439;
        const top = (lane && lane.top) || 195;
        const bottom = (lane && lane.bottom) || 735;
        const width = (lane && lane.width) || 38;
        const rawY = (lane && lane.y) || bottom - 25;
        const config = {
            x: x,
            y: Math.max(top + 12, Math.min(bottom - 8, rawY)),
            top: top,
            bottom: bottom,
            width: width,
            left: x - width * 0.5,
            right: x + width * 0.5,
            id: lane && lane.id,
            element: lane,
            maxPower: (lane && lane.maxPower) || 42,
            maxRetract: (lane && lane.maxRetract) || 65,
            springStrength: (lane && lane.springStrength) || 1
        };
        if (world) {
            world._launcherConfig = config;
            world._launcherConfigTable = world.table;
        }
        return config;
    }

    function getLauncherState(world, launcher) {
        if (!world || !launcher || !launcher.element || !Pin.elements.getState) {
            return { position: 0, velocity: 0, charge: 0, releasing: false, maxRetract: launcher ? launcher.maxRetract : 65 };
        }
        return Pin.elements.getState(world, launcher.element, { position: 0, velocity: 0, charge: 0, releasing: false, maxRetract: launcher.maxRetract });
    }

    function releaseLauncher(world) {
        const launcher = getLauncherConfig(world);
        const state = getLauncherState(world, launcher);
        const maxRetract = launcher.maxRetract || 65;
        const position = Math.max(state.position || 0, maxRetract * 0.08);
        const power = Math.max(0.08, Math.min(1, position / maxRetract));
        state.position = position;
        state.charge = power;
        state.releasing = true;
        state.charging = false;
        state.strikeVelocity = -(power * launcher.maxPower + 14) * (launcher.springStrength || 1);
        state.velocity = -Math.abs(state.strikeVelocity);
        return state;
    }

    function updateLauncherCooldown(ball, dt) {
        if (!ball || !ball.launchRecaptureGrace) return;
        ball.launchRecaptureGrace = Math.max(0, ball.launchRecaptureGrace - dt);
    }

    function tryStageReturnedLauncherBall(ball, world, launcher) {
        if (!ball || ball.inLaunchLane || ball.launchRecaptureGrace > 0) return false;
        const inLane =
            ball.x >= launcher.left + ball.radius &&
            ball.x <= launcher.right - ball.radius &&
            ball.y >= launcher.y &&
            ball.y <= launcher.bottom - ball.radius &&
            ball.vy >= 0;
        if (!inLane) return false;
        const plunger = getLauncherState(world, launcher);
        plunger.releasing = false;
        plunger.charging = false;
        plunger.position = 0;
        plunger.velocity = 0;
        plunger.charge = 0;
        ball.inLaunchLane = true;
        ball.x = launcher.x;
        ball.y = Math.min(ball.y, launcher.bottom - ball.radius - 1);
        ball.vx = 0;
        ball.vy = 0;
        return true;
    }

    function stepWorld(world, dt) {
        /* What: Advance the entire world simulation by one frame timestep.
         * Why: this is the authoritative per-frame integration boundary shared
         * by play loop timing, element state updates, and render side effects.
         */
        const pf = world.table.playfield;
        const gravity = pf.gravity;
        const friction = pf.friction;
        const restitution = pf.restitution;
        const maxSpeed = pf.maxSpeed;
        const balls = world.balls;
        const launcher = getLauncherConfig(world);

        balls.forEach(function stepBall(ball, ballIndex) {
            if (ball.inLaunchLane) {
                const laneBottom = launcher.bottom - ball.radius - 1;
                const plunger = getLauncherState(world, launcher);
                ball.x = launcher.x;
                ball.y = Math.min(ball.y, laneBottom);
                ball.vx = 0;
                ball.vy = 0;
                if (plunger.releasing && plunger.strikeVelocity < 0) {
                    ball.vx = 0;
                    ball.vy = plunger.strikeVelocity;
                    ball.inLaunchLane = false;
                    ball.y = launcher.y - ball.radius;
                    ball.launchRecaptureGrace = 0.6;
                    plunger.releasing = false;
                    plunger.position = 0;
                    plunger.velocity = 0;
                    plunger.charge = 0;
                    if (Pin.events) Pin.events.emit(world, { type: "plungerReleased", sourceId: launcher.id || "launcher", elementType: "launcher" });
                }
                return;
            }

            const speed = Math.sqrt(ball.vx * ball.vx + ball.vy * ball.vy);
            const maxTravel = Math.max(2, ball.radius * 0.45);
            const substeps = Math.max(1, Math.min(18, Math.ceil(speed / maxTravel)));
            const subDt = dt / substeps;
            for (let s = 0; s < substeps; s++) {
                updateLauncherCooldown(ball, subDt);
                world.physicsTick = (world.physicsTick || 0) + 1;
                world.physicsTime = (world.physicsTime || 0) + subDt;
                const timeScale = subDt * 60;
                const frictionScale = friction === 1 ? 1 : Math.pow(Math.max(0, friction), timeScale);
                ball.vy += gravity * timeScale;
                ball.vx *= frictionScale;
                ball.vy *= frictionScale;
                moveBallWithSweeps(ball, world, subDt, restitution);
                applySupportedContacts(ball, world, subDt);
                processSensors(ball, world, ballIndex);
                if (Pin.render && Pin.render.emitBallTrail) Pin.render.emitBallTrail(world, ball, subDt);

                const bSpeed = Math.sqrt(ball.vx * ball.vx + ball.vy * ball.vy);
                if (bSpeed > maxSpeed) {
                    const scale = maxSpeed / bSpeed;
                    ball.vx *= scale;
                    ball.vy *= scale;
                }
                if (tryStageReturnedLauncherBall(ball, world, launcher)) break;
            }
        });
        if (Pin.render && Pin.render.updateSparks) Pin.render.updateSparks(world, dt);
    }

    Pin.physics = {
        closestPointOnSegment: closestPointOnSegment,
        circleSegmentCollision: circleSegmentCollision,
        circleCircleCollision: circleCircleCollision,
        buildBroadPhase: buildBroadPhase,
        buildSensorBroadPhase: buildSensorBroadPhase,
        queryBroadPhase: queryBroadPhase,
        getLauncherConfig: getLauncherConfig,
        releaseLauncher: releaseLauncher,
        applyTilt: applyTilt,
        clearTiltLockout: clearTiltLockout,
        processSensors: processSensors,
        stepWorld: stepWorld
    };
})(window.Pin);
