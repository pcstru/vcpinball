/*
 * Flipper mechanism and finite-volume contact response.
 * Why: centerline-only flippers behave like thick lines. A physical blade
 * needs root/tip caps plus explicit playable and underside edges.
 */
(function registerFlipper(Pin) {
    function getControlName(el, table) {
        if (el.control) return el.control;
        if (el.side) return el.side;
        if (table && table.playfield && el.pivot && typeof el.pivot.x === "number") {
            return el.pivot.x > table.playfield.width * 0.5 ? "right" : "left";
        }
        if (typeof el.restAngle === "number" && Math.cos(el.restAngle) < 0) return "right";
        return "left";
    }

    function getControlState(el, world, table) {
        if (!world || !world.controls) return false;
        const control = getControlName(el, table || (world && world.table));
        return !!world.controls[control];
    }

    function getTargetAngle(el, world, table) {
        return getControlState(el, world, table) ? el.activeAngle : el.restAngle;
    }

    function getRuntimeAngle(el, world, table) {
        const state = Pin.elements.peekState ? Pin.elements.peekState(world, el) : null;
        if (state && typeof state.angle === "number") return state.angle;
        return getTargetAngle(el, world, table);
    }

    function getTipAtAngle(el, angle) {
        return {
            x: el.pivot.x + Math.cos(angle) * el.length,
            y: el.pivot.y + Math.sin(angle) * el.length,
            angle: angle
        };
    }

    function getTip(el, world, table) {
        return getTipAtAngle(el, getRuntimeAngle(el, world, table));
    }

    function normalizeDelta(angle) {
        while (angle > Math.PI) angle -= Math.PI * 2;
        while (angle < -Math.PI) angle += Math.PI * 2;
        return angle;
    }

    function clamp(value, min, max) {
        return Math.max(min, Math.min(max, value));
    }

    function getUpstrokeSign(el) {
        const delta = normalizeDelta((el.activeAngle || 0) - (el.restAngle || 0));
        return delta >= 0 ? 1 : -1;
    }

    function getMaxAngularSpeed(el, controlActive) {
        return controlActive ?
            (typeof el.flipSpeed === "number" ? el.flipSpeed : 24) :
            (typeof el.returnSpeed === "number" ? el.returnSpeed : 18);
    }

    function getAngularAcceleration(el, controlActive) {
        if (controlActive) {
            if (typeof el.flipAccel === "number") return el.flipAccel;
            const speed = typeof el.flipSpeed === "number" ? el.flipSpeed : 24;
            return Math.max(40, speed * 9);
        }
        if (typeof el.returnAccel === "number") return el.returnAccel;
        const speed = typeof el.returnSpeed === "number" ? el.returnSpeed : 18;
        return Math.max(30, speed * 8);
    }

    function getSurfaceRestitution(el) {
        if (typeof el.surfaceRestitution === "number") return el.surfaceRestitution;
        return 0.28;
    }

    function getSurfaceFriction(el) {
        if (typeof el.surfaceFriction === "number") return el.surfaceFriction;
        return 0.08;
    }

    function getTipRestitution(el) {
        if (typeof el.tipRestitution === "number") return el.tipRestitution;
        return getSurfaceRestitution(el);
    }

    function getTipFriction(el) {
        if (typeof el.tipFriction === "number") return el.tipFriction;
        return getSurfaceFriction(el);
    }

    function getStrikeBoost(el) {
        if (typeof el.strikeBoost === "number") return el.strikeBoost;
        return 0.52;
    }

    function getTipStrikeBoost(el) {
        if (typeof el.tipStrikeBoost === "number") return el.tipStrikeBoost;
        return getStrikeBoost(el);
    }

    /*
     * Resolve authored flipper drawing palette with safe fallbacks.
     * Why: designers should control flipper colors beyond one hardcoded theme.
     */
    function getDrawPalette(el) {
        const start = el.bodyColor || el.color || (el.side === "right" ? "#ff4466" : "#00ddff");
        const end = el.tipColor || el.glowColor || (el.side === "right" ? "#cc0033" : "#00aacc");
        return {
            bodyStart: start,
            bodyEnd: end,
            stroke: el.strokeColor || "rgba(255,255,255,0.58)",
            pivot: el.pivotColor || "#ffffff",
            highlight: el.highlightColor || "rgba(255,255,255,0.35)",
            glowStrength: typeof el.glowStrength === "number" ? Math.max(0, el.glowStrength) : 12
        };
    }

    function getDefaultRootRadius(el) {
        const thickness = typeof el.thickness === "number" ? el.thickness : 10;
        return Math.max(8, thickness * 1.4);
    }

    function getDefaultTipRadius(el) {
        const thickness = typeof el.thickness === "number" ? el.thickness : 10;
        return Math.max(5, thickness * 0.7);
    }

    function getRootRadius(el) {
        if (typeof el.rootRadius === "number") return Math.max(1, el.rootRadius);
        return getDefaultRootRadius(el);
    }

    function getTipRadius(el) {
        if (typeof el.tipRadius === "number") return Math.max(1, el.tipRadius);
        return getDefaultTipRadius(el);
    }

    function normalizeVector(x, y) {
        const len = Math.sqrt(x * x + y * y);
        if (len <= 0.000001) return { x: 0, y: -1 };
        return { x: x / len, y: y / len };
    }

    function getContactT(hit) {
        if (hit && typeof hit.t === "number") return hit.t;
        if (hit && typeof hit.tSeg === "number") return hit.tSeg;
        return 0.5;
    }

    /*
     * Build the finite blade geometry for one angle.
     * Why: response should use the same shape for draw and collision.
     */
    function buildBladeGeometry(el, angle, table) {
        const ux = Math.cos(angle);
        const uy = Math.sin(angle);
        const nx0 = -uy;
        const ny0 = ux;
        const lift = getControlName(el, table) === "right" ? { x: nx0, y: ny0 } : { x: -nx0, y: -ny0 };
        const liftNorm = normalizeVector(lift.x, lift.y);
        const undersideNorm = { x: -liftNorm.x, y: -liftNorm.y };
        const rootRadius = getRootRadius(el);
        const tipRadius = getTipRadius(el);
        const root = { x: el.pivot.x, y: el.pivot.y };
        const tip = { x: root.x + ux * el.length, y: root.y + uy * el.length, angle: angle };
        return {
            root: root,
            tip: tip,
            ux: ux,
            uy: uy,
            rootRadius: rootRadius,
            tipRadius: tipRadius,
            playableEdge: {
                x1: root.x + liftNorm.x * rootRadius,
                y1: root.y + liftNorm.y * rootRadius,
                x2: tip.x + liftNorm.x * tipRadius,
                y2: tip.y + liftNorm.y * tipRadius,
                nx: liftNorm.x,
                ny: liftNorm.y
            },
            undersideEdge: {
                x1: root.x + undersideNorm.x * rootRadius,
                y1: root.y + undersideNorm.y * rootRadius,
                x2: tip.x + undersideNorm.x * tipRadius,
                y2: tip.y + undersideNorm.y * tipRadius,
                nx: undersideNorm.x,
                ny: undersideNorm.y
            }
        };
    }

    function getSurfaceVelocityAtAngle(el, angle, angularVelocity, contactT) {
        const t = Math.max(0, Math.min(1, typeof contactT === "number" ? contactT : 0.5));
        const surfaceSpeed = (angularVelocity || 0) * el.length * t / 120;
        return { x: -Math.sin(angle) * surfaceSpeed, y: Math.cos(angle) * surfaceSpeed };
    }

    function buildOnHit(el, table, angle, sweepT, angularVelocity, controlActive, collisionKind) {
        return function onHit(ball, hit, world) {
            const contactT = Math.max(0, Math.min(1, getContactT(hit)));
            const overlap = Math.max(0, hit && typeof hit.overlap === "number" ? hit.overlap : 0);
            let nx = hit && typeof hit.nx === "number" ? hit.nx : 0;
            let ny = hit && typeof hit.ny === "number" ? hit.ny : -1;
            const normal = normalizeVector(nx, ny);
            nx = normal.x;
            ny = normal.y;
            if (overlap > 0) {
                ball.x += nx * overlap;
                ball.y += ny * overlap;
            }
            let tx = -ny;
            let ty = nx;
            const bladeTx = Math.cos(angle);
            const bladeTy = Math.sin(angle);
            if (tx * bladeTx + ty * bladeTy < 0) {
                tx = -tx;
                ty = -ty;
            }
            const surfaceVelocity = getSurfaceVelocityAtAngle(el, angle, angularVelocity, contactT);
            const surfaceVx = surfaceVelocity.x;
            const surfaceVy = surfaceVelocity.y;
            const relNormalVelocity = (ball.vx - surfaceVx) * nx + (ball.vy - surfaceVy) * ny;
            const relTangentialVelocity = (ball.vx - surfaceVx) * tx + (ball.vy - surfaceVy) * ty;
            const upstrokeSign = getUpstrokeSign(el);
            const upstrokeSpeed = (angularVelocity || 0) * upstrokeSign;
            const isDrivenHit = upstrokeSpeed > 3.1;
            const tipBlend = Math.max(0, Math.min(1, contactT));
            const tipProfile = tipBlend * tipBlend;
            const baseRestitution = Math.max(0, getSurfaceRestitution(el));
            const baseFriction = Math.max(0, getSurfaceFriction(el));
            const baseStrikeBoost = getStrikeBoost(el);
            const restitution = baseRestitution + (getTipRestitution(el) - baseRestitution) * tipProfile;
            const friction = baseFriction + (getTipFriction(el) - baseFriction) * tipProfile;
            const strikeBoost = baseStrikeBoost + (getTipStrikeBoost(el) - baseStrikeBoost) * tipProfile;
            const recentSupport = world && ball.supportContact &&
                ball.supportContact.kind === "flipper" &&
                ball.supportContact.hitKey === "flipper:" + el.id &&
                ((world.physicsTick || 0) - (ball.supportContact.tick || 0) <= 3);
            let nextRelNormal = relNormalVelocity;
            let nextRelTangential = relTangentialVelocity;
            if (relNormalVelocity < 0) {
                const incomingNormal = -relNormalVelocity;
                const passiveRestitution = recentSupport ? 0 : restitution * (0.35 + contactT * 0.65);
                nextRelNormal = incomingNormal * passiveRestitution;
                const frictionScale = relTangentialVelocity < 0 ? 0.1 : 1;
                const frictionImpulse = Math.min(Math.abs(relTangentialVelocity), incomingNormal * friction * frictionScale);
                nextRelTangential -= Math.sign(relTangentialVelocity || 1) * frictionImpulse;
            } else if (relNormalVelocity < 0.45) {
                const supportLoad = 0.45 - relNormalVelocity;
                const frictionScale = relTangentialVelocity < 0 ? 0.1 : 1;
                const supportFriction = Math.min(Math.abs(relTangentialVelocity), supportLoad * friction * frictionScale);
                nextRelTangential -= Math.sign(relTangentialVelocity || 1) * supportFriction;
            }
            if (isDrivenHit && collisionKind === "playable") {
                const tipBias = 0.22 + 0.32 * contactT;
                const sweepBoost = Math.min(0.12, upstrokeSpeed * 0.001);
                const activeBoost = sweepT != null ? 0.18 + sweepT * 0.12 : 0.28;
                nextRelNormal += strikeBoost * tipBias * (1 + sweepBoost) * activeBoost;
            }
            ball.vx = surfaceVx + tx * nextRelTangential + nx * nextRelNormal;
            ball.vy = surfaceVy + ty * nextRelTangential + ny * nextRelNormal;
            if (world && collisionKind === "playable") {
                ball.supportContact = {
                    kind: "flipper",
                    hitKey: "flipper:" + el.id,
                    controlActive: !!getControlState(el, world, table),
                    tick: world.physicsTick || 0,
                    contactRadius: ball.radius + getRootRadius(el),
                    contactSlop: 2,
                    surfaceFriction: friction,
                    surfaceVx: surfaceVx,
                    surfaceVy: surfaceVy,
                    tx: tx,
                    ty: ty,
                    nx: nx,
                    ny: ny
                };
            }
        };
    }

    function makeSegmentCollider(el, geom, angle, sweepT, angularVelocity, controlActive, sweepOnly, kind) {
        const edge = kind === "playable" ? geom.playableEdge : geom.undersideEdge;
        const hitKeySuffix = kind === "playable" ? ":play" : ":under";
        return {
            x1: edge.x1,
            y1: edge.y1,
            x2: edge.x2,
            y2: edge.y2,
            role: "flipper",
            hitKey: "flipper:" + el.id + hitKeySuffix,
            restitution: 0,
            skipDefaultResolve: true,
            sweepOnly: !!sweepOnly,
            controlActive: !!controlActive,
            thickness: 0,
            surfaceVelocityAt: function surfaceVelocityAt(contactT) {
                return getSurfaceVelocityAtAngle(el, angle, angularVelocity, contactT);
            },
            resolveNormal: function resolveNormal() { return { x: edge.nx, y: edge.ny }; },
            onHit: buildOnHit(el, null, angle, sweepT, angularVelocity, controlActive, kind)
        };
    }

    function makeCapCollider(el, geom, angle, sweepT, angularVelocity, controlActive, sweepOnly, kind) {
        const isTip = kind === "tip";
        const c = isTip ? geom.tip : geom.root;
        const r = isTip ? geom.tipRadius : geom.rootRadius;
        return {
            x: c.x,
            y: c.y,
            radius: r,
            role: "flipper",
            hitKey: "flipper:" + el.id + ":" + kind,
            restitution: 0,
            skipDefaultResolve: true,
            sweepOnly: !!sweepOnly,
            controlActive: !!controlActive,
            surfaceVelocityAt: function surfaceVelocityAt(contactT) {
                return getSurfaceVelocityAtAngle(el, angle, angularVelocity, contactT);
            },
            onHit: buildOnHit(el, null, angle, sweepT, angularVelocity, controlActive, kind)
        };
    }

    function stepFlipper(el, table, world, dt) {
        const controlActive = getControlState(el, world, table);
        const targetAngle = controlActive ? el.activeAngle : el.restAngle;
        const minAngle = Math.min(el.restAngle, el.activeAngle);
        const maxAngle = Math.max(el.restAngle, el.activeAngle);
        const state = Pin.elements.getState ?
            Pin.elements.getState(world, el, { angle: el.restAngle, angularVelocity: 0 }) :
            { angle: targetAngle, angularVelocity: 0 };
        const prevAngle = typeof state.angle === "number" ? state.angle : targetAngle;
        const prevVelocity = typeof state.angularVelocity === "number" ? state.angularVelocity : 0;
        const toTarget = normalizeDelta(targetAngle - prevAngle);
        const desiredDir = Math.abs(toTarget) <= 0.0001 ? 0 : Math.sign(toTarget);
        const accel = getAngularAcceleration(el, controlActive);
        const maxSpeed = Math.max(0.001, getMaxAngularSpeed(el, controlActive));
        let angularVelocity = prevVelocity;
        if (desiredDir === 0) {
            angularVelocity = 0;
        } else {
            angularVelocity += desiredDir * accel * dt;
            if (Math.sign(angularVelocity) === desiredDir) {
                angularVelocity = Math.sign(angularVelocity) * Math.min(Math.abs(angularVelocity), maxSpeed);
            }
        }
        let appliedDelta = angularVelocity * dt;
        let currentAngle = prevAngle + appliedDelta;
        if (desiredDir !== 0 && Math.sign(appliedDelta) === desiredDir && Math.abs(appliedDelta) >= Math.abs(toTarget)) {
            appliedDelta = toTarget;
            currentAngle = prevAngle + appliedDelta;
            angularVelocity = 0;
        }
        const clampedAngle = clamp(currentAngle, minAngle, maxAngle);
        if (clampedAngle !== currentAngle) {
            currentAngle = clampedAngle;
            if (currentAngle === prevAngle || Math.sign(angularVelocity) === Math.sign(prevVelocity)) angularVelocity = 0;
        }
        state.prevAngle = prevAngle;
        state.angle = currentAngle;
        state.angularVelocity = angularVelocity;
        state.targetAngle = targetAngle;
        state.active = controlActive;
    }

    Pin.elements.register("flipper", {
        compile: function compile(el, table, world) {
            const controlActive = getControlState(el, world, table);
            const state = Pin.elements.getState ?
                Pin.elements.getState(world, el, { angle: el.restAngle, angularVelocity: 0 }) :
                { angle: el.restAngle, angularVelocity: 0 };
            const prevAngle = typeof state.prevAngle === "number" ? state.prevAngle : (typeof state.angle === "number" ? state.angle : el.restAngle);
            const currentAngle = typeof state.angle === "number" ? state.angle : el.restAngle;
            const angularVelocity = typeof state.angularVelocity === "number" ? state.angularVelocity : 0;
            const appliedDelta = currentAngle - prevAngle;

            const segments = [];
            const circles = [];
            const sweepSteps = Math.max(1, Math.min(6, Math.ceil(Math.abs(appliedDelta) / 0.12)));
            for (let i = 0; i <= sweepSteps; i++) {
                const t = sweepSteps === 0 ? 1 : i / sweepSteps;
                const angle = prevAngle + appliedDelta * t;
                const geom = buildBladeGeometry(el, angle, table);
                const sweepOnly = i < sweepSteps;
                segments.push(makeSegmentCollider(el, geom, angle, t, angularVelocity, controlActive, sweepOnly, "playable"));
                segments.push(makeSegmentCollider(el, geom, angle, t, angularVelocity, controlActive, sweepOnly, "underside"));
                circles.push(makeCapCollider(el, geom, angle, t, angularVelocity, controlActive, sweepOnly, "pivot"));
                circles.push(makeCapCollider(el, geom, angle, t, angularVelocity, controlActive, sweepOnly, "tip"));
            }

            return { segments: segments, circles: circles };
        },
        step: function step(el, table, world, dt) {
            stepFlipper(el, table, world, Number(dt) || (1 / 120));
        },
        physicsCacheKey: function physicsCacheKey(el, table, world) {
            const state = Pin.elements.peekState ? Pin.elements.peekState(world, el) : null;
            const angle = state && typeof state.angle === "number" ? state.angle : el.restAngle;
            const prevAngle = state && typeof state.prevAngle === "number" ? state.prevAngle : angle;
            const velocity = state && typeof state.angularVelocity === "number" ? state.angularVelocity : 0;
            const active = state && state.active ? 1 : 0;
            return [
                angle.toFixed(5),
                prevAngle.toFixed(5),
                velocity.toFixed(5),
                active
            ].join("|");
        },
        draw: function draw(ctx, el, runtime, world) {
            const angle = getRuntimeAngle(el, world, world && world.table);
            const geom = buildBladeGeometry(el, angle, world && world.table);
            const palette = getDrawPalette(el);
            const tx = geom.ux;
            const ty = geom.uy;
            const topA = geom.playableEdge;
            const botA = geom.undersideEdge;
            ctx.save();
            const grad = ctx.createLinearGradient(geom.root.x, geom.root.y, geom.tip.x, geom.tip.y);
            grad.addColorStop(0, palette.bodyStart);
            grad.addColorStop(1, palette.bodyEnd);
            ctx.fillStyle = grad;
            Pin.render.makeGlow(ctx, palette.bodyEnd, palette.glowStrength);
            ctx.strokeStyle = palette.stroke;
            ctx.lineWidth = 2;
            // Draw as body + explicit end caps so mirrored flippers do not
            // depend on arc winding choices in one closed path.
            ctx.beginPath();
            ctx.moveTo(topA.x1, topA.y1);
            ctx.lineTo(topA.x2, topA.y2);
            ctx.lineTo(botA.x2, botA.y2);
            ctx.lineTo(botA.x1, botA.y1);
            ctx.closePath();
            ctx.fill();
            ctx.stroke();
            ctx.beginPath();
            ctx.arc(geom.tip.x, geom.tip.y, geom.tipRadius, 0, Math.PI * 2);
            ctx.fill();
            ctx.stroke();
            ctx.beginPath();
            ctx.arc(geom.root.x, geom.root.y, geom.rootRadius, 0, Math.PI * 2);
            ctx.fill();
            ctx.stroke();
            ctx.fillStyle = palette.pivot;
            Pin.render.makeGlow(ctx, palette.pivot, Math.max(0, palette.glowStrength * 0.5));
            ctx.beginPath();
            ctx.arc(geom.root.x, geom.root.y, Math.max(4, geom.rootRadius * 0.36), 0, Math.PI * 2);
            ctx.fill();
            // Minor highlight on the top edge for readability.
            ctx.strokeStyle = palette.highlight;
            ctx.lineWidth = 1.5;
            ctx.beginPath();
            ctx.moveTo(topA.x1 + tx * 0.5, topA.y1 + ty * 0.5);
            ctx.lineTo(topA.x2 - tx * 0.5, topA.y2 - ty * 0.5);
            ctx.stroke();
            ctx.restore();
        },
        editor: {
            handles: true,
            hitTest: true,
            inspectorFields: [
                "side",
                "control",
                "length",
                "restAngle",
                "activeAngle",
                "flipSpeed",
                "flipAccel",
                "returnSpeed",
                "returnAccel",
                "strikeBoost",
                "surfaceRestitution",
                "surfaceFriction",
                "thickness",
                "rootRadius",
                "tipRadius",
                "color",
                "glowColor",
                "bodyColor",
                "tipColor",
                "strokeColor",
                "pivotColor",
                "highlightColor",
                "glowStrength"
            ]
        }
    });
})(window.Pin);
