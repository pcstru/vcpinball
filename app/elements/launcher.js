(function registerLauncher(Pin) {
    Pin.elements.register("launcher", {
        compile: function compile(el, table, world) {
            const x = el.x || 439;
            const top = el.top || 195;
            const bottom = el.bottom || 735;
            const width = el.width || 38;
            const half = width * 0.5;
            const maxRetract = el.maxRetract || 65;
            const state = Pin.elements.getState ?
                Pin.elements.getState(world, el, { position: 0, velocity: 0, charge: 0, releasing: false }) :
                { position: 0, velocity: 0, charge: 0, releasing: false };
            const dt = world && world.lastPhysicsDt ? world.lastPhysicsDt : 1 / 120;
            if (world && world.launchCharging) {
                state.charging = true;
                state.charge = Math.min(1, (state.charge || 0) + dt / 2);
                state.position = Math.min(maxRetract, (state.position || 0) + (el.pullSpeed || 95) * dt);
                state.velocity = 0;
            } else if (!state.releasing) {
                state.charging = false;
                state.position = Math.max(0, (state.position || 0) - (el.returnSpeed || 220) * dt);
                if (state.position <= 0.001) state.charge = 0;
            }
            state.maxRetract = maxRetract;
            const segments = [
                { x1: x - half, y1: top, x2: x - half, y2: bottom, thickness: 2 },
                { x1: x + half, y1: top, x2: x + half, y2: bottom, thickness: 2 },
                { x1: x - half, y1: bottom, x2: x + half, y2: bottom, thickness: 2 }
            ];
            return { segments: segments };
        },
        draw: function draw(ctx, el, runtime, world) {
            const x = el.x || 439;
            const top = el.top || 195;
            const bottom = el.bottom || 735;
            const width = el.width || 38;
            const left = x - width * 0.5;
            const ballInLane = world && world.balls && world.balls.find(function findBall(ball) { return ball.inLaunchLane; });
            const state = Pin.elements.peekState ? Pin.elements.peekState(world, el) : null;
            const launchT = state && state.maxRetract ? Math.max(0, Math.min(1, (state.position || 0) / state.maxRetract)) : 0;
            const plungerBaseY = bottom - 10;
            const plungerY = plungerBaseY - launchT * 65;
            ctx.save();
            Pin.render.roundRect(ctx, left, top, width, bottom - top, 4);
            ctx.fillStyle = "rgba(20,22,45,0.8)";
            ctx.fill();
            ctx.strokeStyle = "rgba(120,140,220,0.6)";
            ctx.lineWidth = 2;
            ctx.stroke();

            ctx.strokeStyle = "rgba(110,120,150,0.9)";
            ctx.lineWidth = 2;
            ctx.setLineDash([5, 5]);
            ctx.beginPath();
            ctx.moveTo(x, plungerBaseY);
            ctx.lineTo(x, plungerY + 10);
            ctx.stroke();
            ctx.setLineDash([]);

            ctx.fillStyle = "#ee4444";
            Pin.render.makeGlow(ctx, "#ff2222", 12);
            ctx.beginPath();
            ctx.arc(x, plungerY, 10, 0, Math.PI * 2);
            ctx.fill();
            ctx.strokeStyle = "#ffffff";
            ctx.lineWidth = 2;
            ctx.stroke();

            ctx.fillStyle = "#2a2a38";
            Pin.render.roundRect(ctx, x - 9, bottom - 5, 18, 14, 4);
            ctx.fill();
            ctx.strokeStyle = "#555";
            ctx.lineWidth = 2;
            ctx.stroke();

            ctx.fillStyle = "rgba(200,220,255,0.75)";
            ctx.font = '16px "Courier New"';
            ctx.textAlign = "center";
            ctx.fillText("\u25b2", x, top + 22);
            if (ballInLane) {
                ctx.fillStyle = "rgba(255,255,255,0.12)";
                Pin.render.roundRect(ctx, left + 4, bottom - 54, width - 8, 30, 6);
                ctx.fill();
            }
            ctx.restore();
        },
        editor: { handles: true, hitTest: true, inspectorFields: ["x", "y", "top", "bottom", "width", "maxPower", "maxRetract", "pullSpeed", "returnSpeed"] }
    });
})(window.Pin);
