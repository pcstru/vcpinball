(function registerDrain(Pin) {
    Pin.elements.register("drain", {
        compile: function compile(el) {
            return {
                sensors: [{
                    id: el.id,
                    shape: "rect",
                    x: el.x,
                    y: el.y,
                    w: el.w || 120,
                    h: el.h || 24,
                    onEnter: function onEnter(ball, world) {
                        ball.drained = true;
                        if (Pin.events) {
                            Pin.events.emit(world, { type: "drainEntered", sourceId: el.id, elementType: el.type });
                            Pin.events.emit(world, { type: "switchClosed", sourceId: el.id, elementType: el.type });
                        }
                    }
                }]
            };
        },
        draw: function draw(ctx, el, runtime, world, options) {
            if (!options || !options.designMode) return;
            const w = el.w || 120;
            const h = el.h || 24;
            ctx.save();
            ctx.fillStyle = "rgba(8,10,18,0.86)";
            ctx.strokeStyle = el.color || "#ff4466";
            ctx.lineWidth = 2;
            Pin.render.roundRect(ctx, el.x - w * 0.5, el.y - h * 0.5, w, h, 4);
            ctx.fill();
            Pin.render.makeGlow(ctx, el.color || "#ff4466", 10);
            ctx.stroke();
            ctx.restore();
        },
        editor: { handles: true, hitTest: true, inspectorFields: ["x", "y", "w", "h", "color"] }
    });
})(window.Pin);
