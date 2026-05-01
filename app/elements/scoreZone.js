(function registerScoreZone(Pin) {
    Pin.elements.register("scoreZone", {
        compile: function compile(el) {
            return {
                circles: [{
                    x: el.x,
                    y: el.y,
                    radius: el.radius || 20,
                    restitution: typeof el.restitution === "number" ? el.restitution : undefined,
                    onHit: function onHit(ball, hit, world) {
                        const score = Pin.rules && Pin.rules.resolveElementScore ?
                            Pin.rules.resolveElementScore(world, el, 500) :
                            (el.score || 500);
                        if (Pin.events) {
                            Pin.events.emit(world, { type: "score", sourceId: el.id, elementType: el.type, points: score });
                            Pin.events.emit(world, { type: "switchClosed", sourceId: el.id, elementType: el.type });
                        }
                        ball.vx += hit.nx * 2;
                        ball.vy += hit.ny * 2;
                        if (Pin.audio) Pin.audio.target();
                    }
                }]
            };
        },
        draw: function draw(ctx, el) {
            const r = el.radius || 20;
            ctx.save();
            const color = el.color || "#ffee55";
            ctx.strokeStyle = color;
            ctx.lineWidth = 2;
            ctx.setLineDash([4, 4]);
            Pin.render.makeGlow(ctx, color, 12);
            ctx.beginPath();
            ctx.arc(el.x, el.y, r, 0, Math.PI * 2);
            ctx.stroke();
            ctx.fillStyle = "rgba(255,238,85,0.08)";
            ctx.beginPath();
            ctx.arc(el.x, el.y, r - 2, 0, Math.PI * 2);
            ctx.fill();
            ctx.restore();
        },
        editor: { handles: true, hitTest: true, inspectorFields: ["radius", "restitution", "score", "color"] }
    });
})(window.Pin);
