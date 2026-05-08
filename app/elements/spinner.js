(function registerSpinner(Pin) {
    function now() {
        if (typeof performance !== "undefined" && performance.now) return performance.now();
        return Date.now();
    }

    /* What: Resolve spinner blade radius from the current schema.
     * Why: Spinner physics and drawing share one authored radius field.
     */
    function getSpinnerRadius(el) {
        if (el && typeof el.radius === "number") return el.radius;
        return 30;
    }

    Pin.elements.register("spinner", {
        compile: function compile(el, table, world) {
            const radius = getSpinnerRadius(el);
            const state = Pin.elements.getState ?
                Pin.elements.getState(world, el, { angle: 0, angularVelocity: 0, lastTime: now() }) :
                { angle: 0, angularVelocity: 0, lastTime: now() };
            const dt = world && world.lastPhysicsDt ? world.lastPhysicsDt : 1 / 120;
            const damping = typeof el.damping === "number" ? el.damping : 3.5;
            state.angle = (state.angle || 0) + (state.angularVelocity || 0) * dt;
            state.angularVelocity = (state.angularVelocity || 0) * Math.exp(-damping * dt);
            state.lastTime = now();
            const baseAngle = (el.angle || 0) + (state.angle || 0);
            function buildBladeSegment(segmentAngle) {
                const dx = Math.cos(segmentAngle) * radius;
                const dy = Math.sin(segmentAngle) * radius;
                return {
                    x1: el.x - dx,
                    y1: el.y - dy,
                    x2: el.x + dx,
                    y2: el.y + dy,
                    onHit: function onHit(ball, hit, world) {
                        const score = Pin.rules && Pin.rules.resolveElementScore ?
                            Pin.rules.resolveElementScore(world, el, (el.score || 100)) :
                            (el.score || 100);
                        const speed = Math.sqrt(ball.vx * ball.vx + ball.vy * ball.vy);
                        if (world) {
                            if (Pin.events) {
                                Pin.events.emit(world, { type: "score", sourceId: el.id, elementType: el.type, points: score });
                                Pin.events.emit(world, { type: "switchClosed", sourceId: el.id, elementType: el.type });
                            }
                            const hitState = Pin.elements.getState ?
                                Pin.elements.getState(world, el, { angle: 0, angularVelocity: 0, lastTime: now() }) :
                                { angle: 0, angularVelocity: 0, lastTime: now() };
                            const contactT = Math.max(0, Math.min(1, hit && typeof hit.t === "number" ? hit.t : 0.5));
                            const arm = (contactT - 0.5) * radius * 2;
                            const tangentV = ball.vx * (-Math.sin(segmentAngle)) + ball.vy * Math.cos(segmentAngle);
                            const direction = arm * tangentV >= 0 ? 1 : -1;
                            hitState.angularVelocity = (hitState.angularVelocity || 0) + direction * Math.max(4, Math.min(28, speed * 1.2));
                            hitState.lastHit = now();
                        }
                        ball.vx *= 0.98;
                        ball.vy *= 0.98;
                        if (Pin.audio) Pin.audio.spinner();
                    }
                };
            }
            return {
                segments: [
                    buildBladeSegment(baseAngle),
                    buildBladeSegment(baseAngle + Math.PI * 0.5)
                ]
            };
        },
        draw: function draw(ctx, el, runtime, world) {
            const radius = getSpinnerRadius(el);
            let angle = 0;
            const state = Pin.elements.peekState ? Pin.elements.peekState(world, el) : null;
            if (state) {
                angle = state.angle || 0;
            }
            ctx.save();
            const color = el.color || "#ffdd00";
            ctx.translate(el.x, el.y);
            ctx.rotate(el.angle || 0);
            ctx.rotate(angle);
            ctx.strokeStyle = color;
            ctx.lineWidth = 4;
            ctx.lineCap = "round";
            Pin.render.makeGlow(ctx, "#ffaa00", 14);
            ctx.beginPath();
            ctx.moveTo(-radius, 0);
            ctx.lineTo(radius, 0);
            ctx.moveTo(0, -radius);
            ctx.lineTo(0, radius);
            ctx.stroke();
            ctx.strokeStyle = "rgba(255,255,255,0.85)";
            ctx.lineWidth = 2;
            ctx.beginPath();
            ctx.moveTo(-8, 0);
            ctx.lineTo(8, 0);
            ctx.moveTo(0, -8);
            ctx.lineTo(0, 8);
            ctx.stroke();
            ctx.fillStyle = "#ffffff";
            ctx.beginPath();
            ctx.arc(0, 0, 5, 0, Math.PI * 2);
            ctx.fill();
            ctx.restore();
        },
        editor: { handles: true, hitTest: true, inspectorFields: ["radius", "angle", "damping", "score", "color"] }
    });
})(window.Pin);
