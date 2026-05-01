(function registerSpinner(Pin) {
    function now() {
        if (typeof performance !== "undefined" && performance.now) return performance.now();
        return Date.now();
    }

    Pin.elements.register("spinner", {
        compile: function compile(el, table, world) {
            const len = el.length || 60;
            const state = Pin.elements.getState ?
                Pin.elements.getState(world, el, { angle: 0, angularVelocity: 0, lastTime: now() }, el.id) :
                { angle: 0, angularVelocity: 0, lastTime: now() };
            if (typeof state.angularVelocity !== "number" && typeof state.velocity === "number") {
                state.angularVelocity = state.velocity * 22;
                delete state.velocity;
            }
            const dt = world && world.lastPhysicsDt ? world.lastPhysicsDt : 1 / 120;
            const damping = typeof el.damping === "number" ? el.damping : 3.5;
            state.angle = (state.angle || 0) + (state.angularVelocity || 0) * dt;
            state.angularVelocity = (state.angularVelocity || 0) * Math.exp(-damping * dt);
            state.lastTime = now();
            const angle = (el.angle || 0) + (state.angle || 0);
            const dx = Math.cos(angle) * len * 0.5;
            const dy = Math.sin(angle) * len * 0.5;
            return {
                segments: [{
                    x1: el.x - dx,
                    y1: el.y - dy,
                    x2: el.x + dx,
                    y2: el.y + dy,
                    onHit: function onHit(ball, hit, world) {
                        const score = Pin.rules && Pin.rules.resolveElementScore ?
                            Pin.rules.resolveElementScore(world, el, 100) :
                            (el.score || 100);
                        const speed = Math.sqrt(ball.vx * ball.vx + ball.vy * ball.vy);
                        if (world) {
                            if (Pin.events) {
                                Pin.events.emit(world, { type: "score", sourceId: el.id, elementType: el.type, points: score });
                                Pin.events.emit(world, { type: "switchClosed", sourceId: el.id, elementType: el.type });
                            }
                            const hitState = Pin.elements.getState ?
                                Pin.elements.getState(world, el, { angle: 0, angularVelocity: 0, lastTime: now() }, el.id) :
                                { angle: 0, angularVelocity: 0, lastTime: now() };
                            const contactT = Math.max(0, Math.min(1, hit && typeof hit.t === "number" ? hit.t : 0.5));
                            const arm = (contactT - 0.5) * len;
                            const tangentV = ball.vx * (-Math.sin(angle)) + ball.vy * Math.cos(angle);
                            const direction = arm * tangentV >= 0 ? 1 : -1;
                            hitState.angularVelocity = (hitState.angularVelocity || 0) + direction * Math.max(4, Math.min(28, speed * 1.2));
                            hitState.lastHit = now();
                        }
                        ball.vx *= 0.98;
                        ball.vy *= 0.98;
                        if (Pin.audio) Pin.audio.spinner();
                    }
                }]
            };
        },
        draw: function draw(ctx, el, runtime, world) {
            const len = el.length || 60;
            let angle = 0;
            const state = Pin.elements.peekState ? Pin.elements.peekState(world, el, el.id) : null;
            if (state) {
                angle = state.angle || 0;
            }
            ctx.save();
            const color = el.color || "#ffdd00";
            ctx.translate(el.x, el.y);
            ctx.rotate(el.angle || 0);
            ctx.fillStyle = "#8891aa";
            ctx.beginPath();
            ctx.arc(-len * 0.5 - 8, 0, 6, 0, Math.PI * 2);
            ctx.arc(len * 0.5 + 8, 0, 6, 0, Math.PI * 2);
            ctx.fill();
            ctx.strokeStyle = color;
            ctx.lineWidth = 4;
            ctx.lineCap = "round";
            Pin.render.makeGlow(ctx, "#ffaa00", 14);
            ctx.beginPath();
            ctx.moveTo(-len * 0.5, 0);
            ctx.lineTo(len * 0.5, 0);
            ctx.stroke();
            ctx.rotate(angle);
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
        editor: { handles: true, hitTest: true, inspectorFields: ["length", "angle", "damping", "score", "color"] }
    });
})(window.Pin);
