(function registerGate(Pin) {
    function clamp(value, min, max) {
        return Math.max(min, Math.min(max, value));
    }

    /*
     * What: Resolve a hinge response from gate contact.
     * Why: The previous gate logic updated angular velocity only, which made the
     * gate technically move but often too weakly to read in play. A small direct
     * angular nudge plus a stronger velocity impulse produces a visible swing
     * while still letting return spring/damping control the rest motion.
     */
    function gateSwingLimits(el, restAngle) {
        const maxAngle = Math.abs(typeof el.maxAngle === "number" ? el.maxAngle : 1.05);
        const start = typeof el.swingStartAngle === "number" ? el.swingStartAngle : restAngle - maxAngle;
        const end = typeof el.swingEndAngle === "number" ? el.swingEndAngle : restAngle + maxAngle;
        const localA = start - restAngle;
        const localB = end - restAngle;
        return {
            min: Math.min(localA, localB, 0),
            max: Math.max(localA, localB, 0),
            span: Math.abs(localA - localB) || maxAngle
        };
    }

    function applyGateImpulse(el, state, speed, directionSign, limits) {
        const impulse = clamp(speed * 0.24, 1.2, 8.5) * directionSign;
        const angleNudge = clamp(speed * 0.014, 0.035, Math.max(0.035, limits.span * 0.18)) * directionSign;
        state.angularVelocity = (state.angularVelocity || 0) + impulse;
        state.angle = clamp((state.angle || 0) + angleNudge, limits.min, limits.max);
    }

    function canSwing(state, directionSign, limits) {
        const angle = state && typeof state.angle === "number" ? state.angle : 0;
        if (directionSign > 0) return angle < limits.max - 0.001;
        return angle > limits.min + 0.001;
    }

    function normalizeDirection(value) {
        const raw = String(value || "").toLowerCase();
        if (raw === "reverse") return "reverse";
        if (raw === "twoway" || raw === "two-way" || raw === "two_way" || raw === "both") return "twoWay";
        return "forward";
    }

    function directionAllows(el, world, pushDirection) {
        const configured = Pin.rules && Pin.rules.resolveElementProperty ?
            Pin.rules.resolveElementProperty(world, el, "direction", el.direction || "forward") :
            (el.direction || "forward");
        const direction = normalizeDirection(configured);
        if (direction === "twoWay") return true;
        if (direction === "reverse") return pushDirection < 0;
        return pushDirection > 0;
    }

    function isOpen(el, world) {
        if (Pin.rules && Pin.rules.resolveElementProperty) {
            return !!Pin.rules.resolveElementProperty(world, el, "open", !!el.open);
        }
        return !!el.open;
    }

    function forcedOpenAngle(el, world, limits) {
        const configured = Pin.rules && Pin.rules.resolveElementProperty ?
            Pin.rules.resolveElementProperty(world, el, "direction", el.direction || "forward") :
            (el.direction || "forward");
        const direction = normalizeDirection(configured);
        if (direction === "reverse") return limits.min;
        return limits.max;
    }

    function buildGeometry(el, state) {
        const pivotX = typeof el.x === "number" ? el.x : 0;
        const pivotY = typeof el.y === "number" ? el.y : 0;
        const length = Math.max(8, typeof el.length === "number" ? el.length : 64);
        const restAngle = typeof el.angle === "number" ? el.angle : 0;
        const localAngle = state && typeof state.angle === "number" ? state.angle : 0;
        const absolute = restAngle + localAngle;
        return {
            pivotX: pivotX,
            pivotY: pivotY,
            length: length,
            restAngle: restAngle,
            angle: absolute,
            x2: pivotX + Math.cos(absolute) * length,
            y2: pivotY + Math.sin(absolute) * length
        };
    }

    function isLocked(el, world) {
        if (Pin.rules && Pin.rules.resolveElementProperty) {
            return !!Pin.rules.resolveElementProperty(world, el, "locked", !!el.locked);
        }
        return !!el.locked;
    }

    function kickGate(el, world, ball, pushDirection) {
        if (!world || !Pin.elements.getState) return;
        if (isLocked(el, world)) return;
        const state = Pin.elements.getState(world, el, { angle: 0, angularVelocity: 0 });
        if ((world.physicsTick || 0) > 0 && state.lastKickTick === world.physicsTick) return;
        const restAngle = typeof el.angle === "number" ? el.angle : 0;
        const limits = gateSwingLimits(el, restAngle);
        const speed = Math.sqrt(ball.vx * ball.vx + ball.vy * ball.vy);
        if (speed < 0.2) return;
        applyGateImpulse(el, state, speed, pushDirection, limits);
        state.lastKickTick = world.physicsTick || 0;
        if (Pin.events) Pin.events.emit(world, { type: "gateOpened", sourceId: el.id, elementType: el.type });
    }

    Pin.elements.register("gate", {
        compile: function compile(el, table, world) {
            const state = Pin.elements.getState ?
                Pin.elements.getState(world, el, { angle: 0, angularVelocity: 0 }) :
                { angle: 0, angularVelocity: 0 };
            const dt = world && world.lastPhysicsDt ? world.lastPhysicsDt : 1 / 120;
            const restAngle = typeof el.angle === "number" ? el.angle : 0;
            const limits = gateSwingLimits(el, restAngle);
            const returnStrength = typeof el.returnStrength === "number" ? el.returnStrength : 24;
            const damping = typeof el.returnDamping === "number" ? el.returnDamping : 8;
            const locked = isLocked(el, world);
            const open = !locked && isOpen(el, world);
            if (locked) {
                state.angle = 0;
                state.angularVelocity = 0;
            } else if (open) {
                state.angle = forcedOpenAngle(el, world, limits);
                state.angularVelocity = 0;
            } else {
                state.angularVelocity = (state.angularVelocity || 0) - (state.angle || 0) * returnStrength * dt;
                state.angularVelocity *= Math.exp(-damping * dt);
                state.angle = clamp((state.angle || 0) + state.angularVelocity * dt, limits.min, limits.max);
            }
            if (Math.abs(state.angle) < 0.0015 && Math.abs(state.angularVelocity) < 0.02) {
                state.angle = 0;
                state.angularVelocity = 0;
            }

            const geom = buildGeometry(el, state);
            const nx = -(geom.y2 - geom.pivotY) / geom.length;
            const ny = (geom.x2 - geom.pivotX) / geom.length;
            function contactDot(ball) {
                return ball.vx * nx + ball.vy * ny;
            }
            /*
             * What: Resolve which hinge direction this contact should push.
             * Why: velocity-normal dot alone can be ambiguous during overlap/sweep
             * contacts and let blocked-side hits incorrectly open the gate.
             */
            function resolvePushDirection(ball) {
                const side = (ball.x - geom.pivotX) * nx + (ball.y - geom.pivotY) * ny;
                if (Math.abs(side) > 0.0001) return side < 0 ? 1 : -1;
                return contactDot(ball) >= 0 ? 1 : -1;
            }
            const seg = {
                x1: geom.pivotX,
                y1: geom.pivotY,
                x2: geom.x2,
                y2: geom.y2,
                role: "gate",
                restitution: typeof el.restitution === "number" ? el.restitution : undefined,
                thickness: typeof el.thickness === "number" ? el.thickness : 3,
                oneWay: function oneWay(ball, hitWorld) {
                    if (isLocked(el, hitWorld || world)) return false;
                    if (isOpen(el, hitWorld || world)) return true;
                    const pushDirection = resolvePushDirection(ball);
                    if (!directionAllows(el, hitWorld || world, pushDirection)) return false;
                    const gateState = Pin.elements.getState ? Pin.elements.getState(hitWorld || world, el, { angle: 0, angularVelocity: 0 }) : state;
                    const passable = canSwing(gateState, pushDirection, limits);
                    if (passable) kickGate(el, hitWorld || world, ball, pushDirection);
                    return passable;
                },
                onHit: function onHit(ball, hit, hitWorld) {
                    if (!isLocked(el, hitWorld || world) && !isOpen(el, hitWorld || world) && world && Pin.elements.getState) {
                        const state = Pin.elements.getState(hitWorld || world, el, { angle: 0, angularVelocity: 0 });
                        const pushDirection = resolvePushDirection(ball);
                        const speed = Math.sqrt(ball.vx * ball.vx + ball.vy * ball.vy);
                        if (directionAllows(el, hitWorld || world, pushDirection) && canSwing(state, pushDirection, limits)) {
                            applyGateImpulse(el, state, speed, pushDirection, limits);
                        } else {
                            state.angularVelocity = 0;
                            state.angle = clamp(state.angle || 0, limits.min, limits.max);
                        }
                    }
                    ball.vx *= 0.72;
                    ball.vy *= 0.72;
                    if (Pin.events) Pin.events.emit(hitWorld || world, { type: "gateBlocked", sourceId: el.id, elementType: el.type });
                }
            };
            return { segments: [seg] };
        },
        draw: function draw(ctx, el, runtime, world) {
            const state = Pin.elements.peekState ? Pin.elements.peekState(world, el) : null;
            const geom = buildGeometry(el, state);
            const shaftColor = el.color || "#99ffcc";
            const pinColor = el.pinColor || "#d9fff2";
            ctx.save();
            ctx.strokeStyle = shaftColor;
            ctx.lineWidth = Math.max(2, typeof el.thickness === "number" ? el.thickness + 1 : 4);
            ctx.lineCap = "round";
            Pin.render.makeGlow(ctx, shaftColor, 10);
            ctx.beginPath();
            ctx.moveTo(geom.pivotX, geom.pivotY);
            ctx.lineTo(geom.x2, geom.y2);
            ctx.stroke();
            ctx.fillStyle = pinColor;
            ctx.beginPath();
            ctx.arc(geom.pivotX, geom.pivotY, 5, 0, Math.PI * 2);
            ctx.arc(geom.x2, geom.y2, 2.5, 0, Math.PI * 2);
            ctx.fill();
            ctx.restore();
        },
        editor: { handles: true, hitTest: true, inspectorFields: ["x", "y", "length", "angle", "direction", "open", "locked", "swingStartAngle", "swingEndAngle", "returnStrength", "returnDamping", "thickness", "restitution", "color", "pinColor"] }
    });
})(window.Pin);
