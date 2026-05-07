(function registerBumper(Pin) {
    function clamp(value, min, max) {
        return Math.max(min, Math.min(max, value));
    }

    Pin.elements.register("bumper", {
        compile: function compile(el) {
            return {
                circles: [{
                    x: el.x,
                    y: el.y,
                    radius: el.radius || 24,
                    restitution: typeof el.restitution === "number" ? el.restitution : undefined,
                    onHit: function onHit(ball, hit, world) {
                        const score = Pin.rules && Pin.rules.resolveElementScore ?
                            Pin.rules.resolveElementScore(world, el, (el.score || 0)) :
                            (el.score || 0);
                        ball.vx += hit.nx * (el.power || 10);
                        ball.vy += hit.ny * (el.power || 10);
                        if (Pin.events) {
                            if (score) Pin.events.emit(world, { type: "score", sourceId: el.id, elementType: el.type, points: score });
                            Pin.events.emit(world, { type: "switchClosed", sourceId: el.id, elementType: el.type });
                        }
                        if (Pin.audio) Pin.audio.bumper();
                    }
                }]
            };
        },
        draw: function draw(ctx, el) {
            const r = el.radius || 24;
            const transparency = clamp(typeof el.transparency === "number" ? el.transparency : 1, 0, 1);
            ctx.save();
            ctx.globalAlpha = transparency;
            const color = el.color || "#ff3377";
            const grad = ctx.createRadialGradient(el.x - r * 0.2, el.y - r * 0.3, r * 0.08, el.x, el.y, r);
            grad.addColorStop(0, "#ffffff");
            grad.addColorStop(0.28, color);
            grad.addColorStop(1, "rgba(0,0,0,0.82)");
            ctx.fillStyle = grad;
            Pin.render.makeGlow(ctx, color, 22);
            ctx.beginPath();
            ctx.arc(el.x, el.y, r, 0, Math.PI * 2);
            ctx.fill();
            ctx.strokeStyle = color;
            ctx.lineWidth = 3;
            ctx.stroke();
            ctx.strokeStyle = "rgba(255,255,255,0.45)";
            ctx.lineWidth = 1;
            ctx.beginPath();
            ctx.arc(el.x, el.y, r * 0.6, 0, Math.PI * 2);
            ctx.stroke();
            ctx.fillStyle = "#ffffff";
            Pin.render.makeGlow(ctx, "#ffffff", 8);
            ctx.beginPath();
            ctx.arc(el.x, el.y, 5, 0, Math.PI * 2);
            ctx.fill();
            ctx.restore();
        },
        editor: { handles: true, hitTest: true, inspectorFields: ["radius", "power", "restitution", "score", "color", "transparency"] }
    });
})(window.Pin);
