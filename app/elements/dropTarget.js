(function registerDropTarget(Pin) {
    function clamp(value, min, max) {
        return Math.max(min, Math.min(max, value));
    }

    function emitTargetHit(el, world) {
        /* What: Emit the gameplay events for a drop target impact.
         * Why: A target hit should close its switch regardless of which edge collided.
         */
        const score = Pin.rules && Pin.rules.resolveElementScore ?
            Pin.rules.resolveElementScore(world, el, (el.score || 0)) :
            (el.score || 0);
        if (!Pin.events) return;
        if (score) Pin.events.emit(world, { type: "score", sourceId: el.id, elementType: el.type, points: score });
        Pin.events.emit(world, { type: "switchClosed", sourceId: el.id, elementType: el.type });
        if (Pin.audio) Pin.audio.target();
    }

    function litState(el, world) {
        const key = (el && el.lampId) ? String(el.lampId) : String(el && el.id || "");
        const state = world && world.lampState ? world.lampState[key] : null;
        const on = !!(state && state.on);
        return {
            on: on,
            intensity: on ? Math.max(0.15, Math.min(1, state.intensity == null ? 1 : state.intensity)) : 0
        };
    }

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
                    {
                        x1: corners[0].x,
                        y1: corners[0].y,
                        x2: corners[1].x,
                        y2: corners[1].y,
                        restitution: typeof el.restitution === "number" ? el.restitution : undefined,
                        onHit: function onHit(ball, hit, world) { emitTargetHit(el, world); }
                    },
                    {
                        x1: corners[1].x,
                        y1: corners[1].y,
                        x2: corners[2].x,
                        y2: corners[2].y,
                        restitution: typeof el.restitution === "number" ? el.restitution : undefined,
                        onHit: function onHit(ball, hit, world) { emitTargetHit(el, world); }
                    },
                    {
                        x1: corners[2].x,
                        y1: corners[2].y,
                        x2: corners[3].x,
                        y2: corners[3].y,
                        restitution: typeof el.restitution === "number" ? el.restitution : undefined,
                        onHit: function onHit(ball, hit, world) { emitTargetHit(el, world); }
                    },
                    {
                        x1: corners[3].x,
                        y1: corners[3].y,
                        x2: corners[0].x,
                        y2: corners[0].y,
                        restitution: typeof el.restitution === "number" ? el.restitution : undefined,
                        onHit: function onHit(ball, hit, world) { emitTargetHit(el, world); }
                    }
                ]
            };
        },
        draw: function draw(ctx, el, runtime, world, options) {
            const w = el.w || 14;
            const h = el.h || 40;
            const lit = litState(el, world);
            const transparency = clamp(typeof el.transparency === "number" ? el.transparency : 1, 0, 1);
            ctx.save();
            ctx.globalAlpha = transparency;
            /* Property semantics:
             * - color => lit color
             * - unlitColor => optional idle color
             */
            const litColor = el.color || "#ffee55";
            const offColor = el.unlitColor || "rgba(68, 72, 88, 0.9)";
            const fill = lit.on ? litColor : offColor;
            ctx.translate(el.x, el.y);
            ctx.rotate(el.angle || 0);
            Pin.render.roundRect(ctx, -w * 0.5, -h * 0.5, w, h, 3);
            ctx.fillStyle = fill;
            if (lit.on) Pin.render.makeGlow(ctx, litColor, 14 + lit.intensity * 22);
            ctx.fill();
            ctx.strokeStyle = lit.on ? "#ffffff" : "rgba(170, 178, 205, 0.78)";
            ctx.lineWidth = 1.5;
            ctx.stroke();
            ctx.fillStyle = lit.on ? "#ffffff" : "rgba(200, 205, 228, 0.75)";
            ctx.beginPath();
            ctx.arc(0, -h * 0.5 + 8, 3, 0, Math.PI * 2);
            ctx.fill();
            if (lit.on) {
                ctx.fillStyle = "rgba(255,255,255,0.32)";
                Pin.render.roundRect(ctx, -w * 0.34, -h * 0.32, w * 0.68, h * 0.24, 2);
                ctx.fill();
            }
            if (options && options.designMode && !lit.on) {
                ctx.save();
                ctx.strokeStyle = "rgba(255,255,255,0.3)";
                ctx.setLineDash([3, 3]);
                ctx.strokeRect(-w * 0.5 - 3, -h * 0.5 - 3, w + 6, h + 6);
                ctx.restore();
            }
            ctx.restore();
        },
        editor: { handles: true, hitTest: true, inspectorFields: ["w", "h", "angle", "restitution", "score", "color", "unlitColor", "transparency"] }
    });
})(window.Pin);
