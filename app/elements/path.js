(function registerPath(Pin) {
    Pin.elements.register("path", {
        compile: function compile(el) {
            const thickness = typeof el.thickness === "number" ? el.thickness : ((el.lineWidth || (el.role === "wall" ? 6 : 4)) * 0.5);
            const collisionSegments = Pin.geometry.pathToSegments(el.anchors || [], !!el.closed, 0.5);
            const drawSegments = Pin.geometry.pathToSegments(el.anchors || [], !!el.closed, 1);
            const segments = collisionSegments.map(function tag(seg) {
                return {
                    x1: seg.x1, y1: seg.y1, x2: seg.x2, y2: seg.y2,
                    role: el.role || "wall",
                    restitution: typeof el.restitution === "number" ? el.restitution : undefined,
                    thickness: thickness,
                    onHit: function onHit(ball) {
                        if (el.role === "slingshot") {
                            ball.vx += (el.impulseX || 0);
                            ball.vy += (el.impulseY || -8);
                            if (Pin.audio) Pin.audio.sling();
                        }
                    }
                };
            });
            return { segments: segments, drawSegments: drawSegments };
        },
        draw: function draw(ctx, el, runtime) {
            const segments = (runtime && runtime.drawSegments) || Pin.geometry.pathToSegments(el.anchors || [], !!el.closed, 1);
            ctx.save();
            const color = el.color || (el.role === "slingshot" ? "#ff8800" : "rgba(160,160,220,0.85)");
            ctx.strokeStyle = color;
            ctx.lineWidth = el.lineWidth || (el.role === "slingshot" ? 4 : Math.max(3, (el.thickness || 6)));
            ctx.lineCap = "round";
            ctx.lineJoin = "round";
            Pin.render.makeGlow(ctx, color, el.role === "slingshot" ? 12 : 7);
            ctx.beginPath();
            segments.forEach(function each(seg) {
                ctx.moveTo(seg.x1, seg.y1);
                ctx.lineTo(seg.x2, seg.y2);
            });
            ctx.stroke();
            if (el.role === "slingshot" && segments.length) {
                const first = segments[0];
                const last = segments[segments.length - 1];
                const midX = (first.x1 + last.x2) * 0.5;
                const midY = (first.y1 + last.y2) * 0.5;
                ctx.fillStyle = "rgba(255,120,0,0.16)";
                ctx.beginPath();
                ctx.moveTo(first.x1, first.y1);
                segments.forEach(function each(seg) { ctx.lineTo(seg.x2, seg.y2); });
                ctx.lineTo(midX, midY - 18);
                ctx.closePath();
                ctx.fill();
            }
            ctx.restore();
        },
        editor: { handles: true, hitTest: true, inspectorFields: ["role", "color", "closed", "thickness", "restitution"] }
    });
})(window.Pin);
