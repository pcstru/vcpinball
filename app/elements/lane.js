/*
 * What: Lane rollover switch element.
 * Why: Lanes score and close logic switches while also showing lamp state on
 * table layouts that bind them to progression rules.
 */
(function registerLane(Pin) {
    function clamp01(value, fallback) {
        const numeric = typeof value === "number" && Number.isFinite(value) ? value : fallback;
        return Math.max(0, Math.min(1, numeric));
    }

    function litState(el, world) {
        /* What: Resolve the lane lamp binding for rendering.
         * Why: Group-completion rules need lanes to visibly latch after rollover.
         */
        const key = (el && el.lampId) ? String(el.lampId) : String(el && el.id || "");
        const state = world && world.lampState ? world.lampState[key] : null;
        const on = !!(state && state.on);
        return {
            on: on,
            intensity: on ? Math.max(0.15, Math.min(1, state.intensity == null ? 1 : state.intensity)) : 0
        };
    }

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
                    onEnter: function onEnter(ball, world) {
                        const score = Pin.rules && Pin.rules.resolveElementScore ?
                            Pin.rules.resolveElementScore(world, el, (el.score || 0)) :
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
        draw: function draw(ctx, el, runtime, world, options) {
            const w = el.w || 40;
            const h = el.h || 20;
            const opacity = clamp01(el.opacity, 1);
            const lit = litState(el, world);
            if (options && options.designMode && !lit.on) {
                lit.on = true;
                lit.intensity = 0.25;
            }
            ctx.save();
            ctx.globalAlpha = opacity;
            ctx.translate(el.x || 0, el.y || 0);
            ctx.rotate(el.angle || 0);
            const x = -w * 0.5;
            const y = -h * 0.5;
            const color = el.color || "#33dd88";
            Pin.render.roundRect(ctx, x, y, w, h, 5);
            ctx.fillStyle = lit.on ? "rgba(51,221,136,0.2)" : "rgba(24,28,46,0.22)";
            ctx.fill();
            ctx.strokeStyle = lit.on ? "rgba(255,255,255,0.82)" : "rgba(51,221,136,0.42)";
            ctx.lineWidth = 1.4;
            if (lit.on) Pin.render.makeGlow(ctx, color, 12 + lit.intensity * 18);
            else Pin.render.makeGlow(ctx, color, 8);
            ctx.stroke();
            ctx.strokeStyle = lit.on ? "#ffffff" : color;
            ctx.lineWidth = Math.max(2, Math.min(4, h * 0.18));
            ctx.lineCap = "round";
            ctx.beginPath();
            ctx.moveTo(-w * 0.38, 0);
            ctx.lineTo(w * 0.38, 0);
            ctx.stroke();
            if (lit.on) {
                ctx.fillStyle = "rgba(255,255,255,0.32)";
                Pin.render.roundRect(ctx, x + w * 0.18, y + h * 0.2, w * 0.64, h * 0.22, 3);
                ctx.fill();
            }
            if (el.label) {
                ctx.fillStyle = "#ffffff";
                ctx.font = '10px "Courier New"';
                ctx.textAlign = "center";
                ctx.textBaseline = "middle";
                ctx.fillText(String(el.label).slice(0, 3), 0, -Math.max(8, h * 0.34));
            }
            ctx.restore();
        },
        editor: { handles: true, hitTest: true, inspectorFields: ["w", "h", "angle", "score", "label", "color", "opacity"] }
    });
})(window.Pin);
