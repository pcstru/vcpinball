(function registerDropTarget(Pin) {
    function rotatePoint(cx, cy, x, y, angle) {
        const c = Math.cos(angle || 0);
        const s = Math.sin(angle || 0);
        return {
            x: cx + x * c - y * s,
            y: cy + x * s + y * c
        };
    }

    function getCorners(el) {
        const w = el.w || 14;
        const h = el.h || 40;
        const angle = el.angle || 0;
        return [
            rotatePoint(el.x, el.y, -w * 0.5, -h * 0.5, angle),
            rotatePoint(el.x, el.y, w * 0.5, -h * 0.5, angle),
            rotatePoint(el.x, el.y, w * 0.5, h * 0.5, angle),
            rotatePoint(el.x, el.y, -w * 0.5, h * 0.5, angle)
        ];
    }

    Pin.elements.register("dropTarget", {
        compile: function compile(el) {
            const corners = getCorners(el);
            return {
                segments: [
                    { x1: corners[0].x, y1: corners[0].y, x2: corners[1].x, y2: corners[1].y, restitution: typeof el.restitution === "number" ? el.restitution : undefined },
                    { x1: corners[1].x, y1: corners[1].y, x2: corners[2].x, y2: corners[2].y, restitution: typeof el.restitution === "number" ? el.restitution : undefined },
                    {
                        x1: corners[2].x,
                        y1: corners[2].y,
                        x2: corners[3].x,
                        y2: corners[3].y,
                        restitution: typeof el.restitution === "number" ? el.restitution : undefined,
                        onHit: function onHit(ball, hit, world) {
                            const score = Pin.rules && Pin.rules.resolveElementScore ?
                                Pin.rules.resolveElementScore(world, el, 0) :
                                (el.score || 0);
                            if (!Pin.events) return;
                            if (score) Pin.events.emit(world, { type: "score", sourceId: el.id, elementType: el.type, points: score });
                            Pin.events.emit(world, { type: "switchClosed", sourceId: el.id, elementType: el.type });
                            if (Pin.audio) Pin.audio.target();
                        }
                    },
                    { x1: corners[3].x, y1: corners[3].y, x2: corners[0].x, y2: corners[0].y, restitution: typeof el.restitution === "number" ? el.restitution : undefined }
                ]
            };
        },
        draw: function draw(ctx, el) {
            const w = el.w || 14;
            const h = el.h || 40;
            ctx.save();
            const color = el.color || "#ffcc00";
            ctx.translate(el.x, el.y);
            ctx.rotate(el.angle || 0);
            Pin.render.roundRect(ctx, -w * 0.5, -h * 0.5, w, h, 3);
            ctx.fillStyle = color;
            Pin.render.makeGlow(ctx, "#ffaa00", 12);
            ctx.fill();
            ctx.strokeStyle = "#ffffff";
            ctx.lineWidth = 1.5;
            ctx.stroke();
            ctx.fillStyle = "#ffffff";
            ctx.beginPath();
            ctx.arc(0, -h * 0.5 + 8, 3, 0, Math.PI * 2);
            ctx.fill();
            ctx.restore();
        },
        editor: { handles: true, hitTest: true, inspectorFields: ["w", "h", "angle", "restitution", "score", "color"] }
    });
})(window.Pin);
