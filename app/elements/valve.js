(function registerValve(Pin) {
    function clamp(value, min, max) {
        return Math.max(min, Math.min(max, value));
    }

    function resolveDirectionSign(el) {
        if (el.direction === "reverse") return -1;
        return 1;
    }

    function buildGeometry(el, state) {
        const length = Math.max(8, typeof el.length === "number" ? el.length : 64);
        const restAngle = typeof el.angle === "number" ? el.angle : 0;
        const localAngle = state && typeof state.angle === "number" ? state.angle : 0;
        const absolute = restAngle + localAngle;
        return {
            length: length,
            restAngle: restAngle,
            angle: absolute,
            x2: (el.x || 0) + Math.cos(absolute) * length,
            y2: (el.y || 0) + Math.sin(absolute) * length
        };
    }

    function pushValve(el, world, ball, normalDot) {
        if (!world || !Pin.elements.getState) return;
        const state = Pin.elements.getState(world, el, { angle: 0, angularVelocity: 0 });
        if ((world.physicsTick || 0) > 0 && state.lastKickTick === world.physicsTick) return;
        const openAngle = typeof el.maxAngle === "number" ? Math.abs(el.maxAngle) : 1.05;
        const speed = Math.sqrt(ball.vx * ball.vx + ball.vy * ball.vy);
        const direction = normalDot >= 0 ? 1 : -1;
        if (speed < 0.2) return;
        state.angularVelocity = (state.angularVelocity || 0) + direction * clamp(speed * 0.15, 0.7, 7);
        state.angle = clamp(state.angle || 0, -openAngle, openAngle);
        state.lastKickTick = world.physicsTick || 0;
        if (Pin.events) Pin.events.emit(world, { type: "valveOpened", sourceId: el.id, elementType: el.type });
    }

    Pin.elements.register("valve", {
        compile: function compile(el, table, world) {
            const state = Pin.elements.getState ?
                Pin.elements.getState(world, el, { angle: 0, angularVelocity: 0 }) :
                { angle: 0, angularVelocity: 0 };
            const dt = world && world.lastPhysicsDt ? world.lastPhysicsDt : 1 / 120;
            const maxAngle = typeof el.maxAngle === "number" ? Math.abs(el.maxAngle) : 1.05;
            const returnStrength = typeof el.returnStrength === "number" ? el.returnStrength : 24;
            const damping = typeof el.returnDamping === "number" ? el.returnDamping : 8;
            state.angularVelocity = (state.angularVelocity || 0) - (state.angle || 0) * returnStrength * dt;
            state.angularVelocity *= Math.exp(-damping * dt);
            state.angle = clamp((state.angle || 0) + state.angularVelocity * dt, -maxAngle, maxAngle);
            if (Math.abs(state.angle) < 0.0015 && Math.abs(state.angularVelocity) < 0.02) {
                state.angle = 0;
                state.angularVelocity = 0;
            }

            const geom = buildGeometry(el, state);
            const nx = -(geom.y2 - (el.y || 0)) / geom.length;
            const ny = (geom.x2 - (el.x || 0)) / geom.length;
            const directionSign = resolveDirectionSign(el);
            const seg = {
                x1: el.x || 0,
                y1: el.y || 0,
                x2: geom.x2,
                y2: geom.y2,
                role: "valve",
                thickness: typeof el.thickness === "number" ? el.thickness : 3,
                oneWay: function oneWay(ball, hitWorld) {
                    const dot = (ball.vx * nx + ball.vy * ny) * directionSign;
                    const passable = dot > 0;
                    if (passable) pushValve(el, hitWorld || world, ball, dot);
                    return passable;
                },
                onHit: function onHit(ball, hit, hitWorld) {
                    ball.vx *= 0.75;
                    ball.vy *= 0.75;
                    if (Pin.events) Pin.events.emit(hitWorld || world, { type: "valveBlocked", sourceId: el.id, elementType: el.type });
                }
            };
            return { segments: [seg] };
        },
        draw: function draw(ctx, el, runtime, world) {
            const state = Pin.elements.peekState ? Pin.elements.peekState(world, el) : null;
            const geom = buildGeometry(el, state);
            const pinX = el.x || 0;
            const pinY = el.y || 0;
            const shaftColor = el.color || "#a8e4ff";
            const pinColor = el.pinColor || "#f7fbff";

            ctx.save();
            ctx.strokeStyle = shaftColor;
            ctx.lineWidth = Math.max(2, typeof el.thickness === "number" ? el.thickness + 1 : 4);
            ctx.lineCap = "round";
            Pin.render.makeGlow(ctx, shaftColor, 9);
            ctx.beginPath();
            ctx.moveTo(pinX, pinY);
            ctx.lineTo(geom.x2, geom.y2);
            ctx.stroke();

            ctx.fillStyle = pinColor;
            Pin.render.makeGlow(ctx, pinColor, 7);
            ctx.beginPath();
            ctx.arc(pinX, pinY, 5, 0, Math.PI * 2);
            ctx.fill();

            ctx.fillStyle = "rgba(255,255,255,0.8)";
            ctx.beginPath();
            ctx.arc(geom.x2, geom.y2, 2.5, 0, Math.PI * 2);
            ctx.fill();
            ctx.restore();
        },
        editor: { handles: true, hitTest: true, inspectorFields: ["x", "y", "length", "angle", "direction", "maxAngle", "returnStrength", "returnDamping", "thickness", "color", "pinColor"] }
    });
})(window.Pin);
