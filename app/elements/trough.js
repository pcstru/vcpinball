/*
 * Trough element.
 * What: a circular saucer/pit that captures a ball briefly, then ejects it.
 * Why: designers need a physical hold-and-release mechanism, distinct from
 * the drain sensor that removes balls from play.
 */
(function registerTrough(Pin) {
    function numberOr(value, fallback) {
        return typeof value === "number" && !Number.isNaN(value) ? value : fallback;
    }

    function emit(world, event) {
        if (Pin.events) Pin.events.emit(world, event);
    }

    function isReleaseCoolingDown(ball, sensor, world) {
        if (!ball.troughRelease || ball.troughRelease.id !== sensor.id) return false;
        const now = world && typeof world.physicsTime === "number" ? world.physicsTime : 0;
        const releasedAt = typeof ball.troughRelease.time === "number" ? ball.troughRelease.time : 0;
        const delay = typeof sensor.reactivateDelay === "number" ? sensor.reactivateDelay : 2;
        return now - releasedAt < delay;
    }

    Pin.elements.register("trough", {
        compile: function compile(el) {
            const x = numberOr(el.x, 250);
            const y = numberOr(el.y, 835);
            const radius = numberOr(el.radius, 18);
            const holdSeconds = Math.max(0, numberOr(el.holdSeconds, 0.75));
            const ejectPower = numberOr(el.ejectPower, 10);
            const ejectAngle = numberOr(el.ejectAngle, -Math.PI * 0.5);
            const reactivateDelay = Math.max(0, numberOr(el.reactivateDelay, 2));
            return {
                sensors: [{
                    id: el.id,
                    shape: "circle",
                    x: x,
                    y: y,
                    radius: radius,
                    reactivateDelay: reactivateDelay,
                    onEnter: function onEnter(ball, world, sensor) {
                        if (isReleaseCoolingDown(ball, sensor, world)) return;
                        ball.capturedBy = sensor.id;
                        ball.captureAge = 0;
                        ball.x = sensor.x;
                        ball.y = sensor.y;
                        ball.vx = 0;
                        ball.vy = 0;
                        emit(world, { type: "troughCaptured", sourceId: sensor.id, elementType: "trough" });
                    },
                    onStay: function onStay(ball, world, sensor) {
                        if (ball.capturedBy !== sensor.id) return;
                        const dt = numberOr(world && world.lastPhysicsDt, 1 / 120);
                        ball.captureAge = numberOr(ball.captureAge, 0) + dt;
                        ball.x = sensor.x;
                        ball.y = sensor.y;
                        ball.vx = 0;
                        ball.vy = 0;
                        if (ball.captureAge < holdSeconds) return;
                        ball.capturedBy = null;
                        ball.captureAge = 0;
                        ball.troughRelease = {
                            id: sensor.id,
                            tick: world && typeof world.physicsTick === "number" ? world.physicsTick : 0,
                            time: world && typeof world.physicsTime === "number" ? world.physicsTime : 0
                        };
                        ball.x = sensor.x + Math.cos(ejectAngle) * (sensor.radius + ball.radius + 2);
                        ball.y = sensor.y + Math.sin(ejectAngle) * (sensor.radius + ball.radius + 2);
                        ball.vx = Math.cos(ejectAngle) * ejectPower;
                        ball.vy = Math.sin(ejectAngle) * ejectPower;
                        emit(world, { type: "troughReleased", sourceId: sensor.id, elementType: "trough" });
                    }
                }]
            };
        },
        draw: function draw(ctx, el, runtime, world) {
            const x = el.x || 250;
            const y = el.y || 835;
            const radius = el.radius || 18;
            const rimColor = el.color || "#88aaff";
            const pitColor = el.pitColor || "rgba(5,10,22,0.9)";
            ctx.save();
            const gradient = ctx.createRadialGradient(x - radius * 0.35, y - radius * 0.35, radius * 0.2, x, y, radius);
            gradient.addColorStop(0, "rgba(255,255,255,0.18)");
            gradient.addColorStop(0.45, pitColor);
            gradient.addColorStop(1, "rgba(0,0,0,0.95)");
            ctx.fillStyle = gradient;
            ctx.strokeStyle = rimColor;
            ctx.lineWidth = 2;
            ctx.beginPath();
            ctx.arc(x, y, radius, 0, Math.PI * 2);
            ctx.fill();
            ctx.stroke();
            ctx.beginPath();
            ctx.strokeStyle = "rgba(255,255,255,0.18)";
            ctx.arc(x, y, radius * 0.45, 0, Math.PI * 2);
            ctx.stroke();
            ctx.restore();
        },
        editor: { handles: true, hitTest: true, inspectorFields: ["x", "y", "radius", "holdSeconds", "reactivateDelay", "ejectPower", "ejectAngle", "color", "pitColor"] }
    });
})(window.Pin);
