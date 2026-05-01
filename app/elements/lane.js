(function registerLane(Pin) {
    Pin.elements.register("lane", {
        compile: function compile(el) {
            return {
                sensors: [{
                    id: el.id,
                    shape: "rect",
                    x: el.x,
                    y: el.y,
                    w: el.w || 40,
                    h: el.h || 20,
                    onEnter: function onEnter(ball, hit, world) {
                        const score = Pin.rules && Pin.rules.resolveElementScore ?
                            Pin.rules.resolveElementScore(world, el, 0) :
                            (el.score || 0);
                        if (Pin.events) {
                            if (score) Pin.events.emit(world, { type: "score", sourceId: el.id, elementType: el.type, points: score });
                            Pin.events.emit(world, { type: "switchClosed", sourceId: el.id, elementType: el.type });
                        }
                        if (Pin.audio) Pin.audio.target();
                    }
                }]
            };
        },
        draw: function draw(ctx, el) {
            const w = el.w || 40;
            const h = el.h || 20;
            ctx.save();
            ctx.translate(el.x || 0, el.y || 0);
            ctx.rotate(el.angle || 0);
            const x = -w * 0.5;
            const y = -h * 0.5;
            const color = el.color || "#33dd88";
            Pin.render.roundRect(ctx, x, y, w, h, 5);
            ctx.fillStyle = "rgba(24,28,46,0.22)";
            ctx.fill();
            ctx.strokeStyle = "rgba(51,221,136,0.42)";
            ctx.lineWidth = 1.4;
            Pin.render.makeGlow(ctx, color, 12);
            ctx.stroke();
            ctx.strokeStyle = color;
            ctx.lineWidth = Math.max(2, Math.min(4, h * 0.18));
            ctx.lineCap = "round";
            ctx.beginPath();
            ctx.moveTo(-w * 0.38, 0);
            ctx.lineTo(w * 0.38, 0);
            ctx.stroke();
            if (el.label) {
                ctx.fillStyle = "#ffffff";
                ctx.font = '10px "Courier New"';
                ctx.textAlign = "center";
                ctx.textBaseline = "middle";
                ctx.fillText(String(el.label).slice(0, 3), 0, -Math.max(8, h * 0.34));
            }
            ctx.restore();
        },
        editor: { handles: true, hitTest: true, inspectorFields: ["w", "h", "angle", "score", "label", "color"] }
    });
})(window.Pin);
