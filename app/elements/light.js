(function registerLight(Pin) {
    function roundedRectPath(ctx, x, y, w, h, radius) {
        const halfW = w * 0.5;
        const halfH = h * 0.5;
        const r = Math.max(0, Math.min(radius || 0, halfW, halfH));
        ctx.beginPath();
        ctx.moveTo(x - halfW + r, y - halfH);
        ctx.lineTo(x + halfW - r, y - halfH);
        ctx.arcTo(x + halfW, y - halfH, x + halfW, y - halfH + r, r);
        ctx.lineTo(x + halfW, y + halfH - r);
        ctx.arcTo(x + halfW, y + halfH, x + halfW - r, y + halfH, r);
        ctx.lineTo(x - halfW + r, y + halfH);
        ctx.arcTo(x - halfW, y + halfH, x - halfW, y + halfH - r, r);
        ctx.lineTo(x - halfW, y - halfH + r);
        ctx.arcTo(x - halfW, y - halfH, x - halfW + r, y - halfH, r);
        ctx.closePath();
    }

    function drawFittedText(ctx, text, width, height, color) {
        if (!text) return;
        const label = String(text);
        const maxWidth = Math.max(8, width * 0.78);
        let size = Math.max(7, Math.min(height * 0.42, 18));
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillStyle = color;
        while (size > 6) {
            ctx.font = "700 " + size + "px sans-serif";
            if (ctx.measureText(label).width <= maxWidth) break;
            size -= 1;
        }
        ctx.fillText(label, 0, 0);
    }

    function lampOnState(el, world) {
        const lampId = el.lampId || el.id;
        const state = world && world.lampState ? world.lampState[lampId] : null;
        const on = !!(state && state.on);
        return {
            on: on,
            intensity: on ? Math.max(0.12, Math.min(1, state.intensity == null ? 1 : state.intensity)) : 0
        };
    }

    Pin.elements.register("light", {
        compile: function compile() {
            return {};
        },
        draw: function draw(ctx, el, runtime, world, options) {
            const r = el.radius || 12;
            const lamp = lampOnState(el, world);
            if (options && options.designMode && !lamp.on) {
                lamp.on = true;
                lamp.intensity = 0.28;
            }
            const color = el.color || "#ffee55";
            ctx.save();
            ctx.translate(el.x || 0, el.y || 0);
            ctx.fillStyle = lamp.on ? color : "rgba(54, 58, 74, 0.82)";
            ctx.strokeStyle = lamp.on ? "#ffffff" : "rgba(140, 150, 180, 0.5)";
            ctx.lineWidth = 1.5;
            if (lamp.on) Pin.render.makeGlow(ctx, color, 10 + lamp.intensity * 18);
            ctx.beginPath();
            ctx.arc(0, 0, r, 0, Math.PI * 2);
            ctx.fill();
            ctx.stroke();
            if (options && options.designMode) {
                ctx.save();
                ctx.strokeStyle = "rgba(255,255,255,0.42)";
                ctx.lineWidth = 2;
                ctx.setLineDash([3, 3]);
                ctx.beginPath();
                ctx.arc(0, 0, r + 4, 0, Math.PI * 2);
                ctx.stroke();
                ctx.restore();
            }
            ctx.fillStyle = lamp.on ? "rgba(255,255,255,0.45)" : "rgba(255,255,255,0.08)";
            ctx.beginPath();
            ctx.arc(-r * 0.25, -r * 0.3, r * 0.28, 0, Math.PI * 2);
            ctx.fill();
            drawFittedText(ctx, el.text || el.label, r * 1.65, r * 1.25, lamp.on ? "#101216" : "#c5cadc");
            ctx.restore();
        },
        editor: { handles: true, hitTest: true, inspectorFields: ["radius", "lampId", "text", "label", "color"] }
    });

    Pin.elements.register("arrowLight", {
        compile: function compile() {
            return {};
        },
        draw: function draw(ctx, el, runtime, world, options) {
            const w = el.w || 86;
            const h = el.h || 34;
            const head = Math.min(w * 0.42, Math.max(h * 0.72, 18));
            const color = el.color || "#66ddff";
            const lamp = lampOnState(el, world);
            if (options && options.designMode && !lamp.on) {
                lamp.on = true;
                lamp.intensity = 0.28;
            }
            ctx.save();
            ctx.translate(el.x || 0, el.y || 0);
            ctx.rotate(el.angle || 0);
            if (lamp.on) Pin.render.makeGlow(ctx, color, 12 + lamp.intensity * 22);
            ctx.beginPath();
            ctx.moveTo(-w * 0.5, -h * 0.34);
            ctx.lineTo(w * 0.5 - head, -h * 0.34);
            ctx.lineTo(w * 0.5 - head, -h * 0.5);
            ctx.lineTo(w * 0.5, 0);
            ctx.lineTo(w * 0.5 - head, h * 0.5);
            ctx.lineTo(w * 0.5 - head, h * 0.34);
            ctx.lineTo(-w * 0.5, h * 0.34);
            ctx.closePath();
            ctx.fillStyle = lamp.on ? color : "rgba(48, 58, 74, 0.86)";
            ctx.strokeStyle = lamp.on ? "#ffffff" : "rgba(150, 170, 195, 0.58)";
            ctx.lineWidth = Math.max(1.4, h * 0.055);
            ctx.fill();
            ctx.stroke();
            ctx.fillStyle = lamp.on ? "rgba(255,255,255,0.42)" : "rgba(255,255,255,0.08)";
            ctx.beginPath();
            ctx.moveTo(-w * 0.42, -h * 0.18);
            ctx.lineTo(w * 0.12, -h * 0.18);
            ctx.lineTo(w * 0.22, 0);
            ctx.lineTo(-w * 0.42, 0);
            ctx.closePath();
            ctx.fill();
            drawFittedText(ctx, el.text || el.label, w - head * 0.55, h, lamp.on ? "#071014" : "#d2d8e8");
            ctx.restore();
        },
        editor: { handles: true, hitTest: true, inspectorFields: ["w", "h", "angle", "lampId", "text", "label", "color"] }
    });

    Pin.elements.register("boxLight", {
        compile: function compile() {
            return {};
        },
        draw: function draw(ctx, el, runtime, world, options) {
            const w = el.w || 92;
            const h = el.h || 38;
            const color = el.color || "#8fe36a";
            const cornerRadius = typeof el.cornerRadius === "number" ? el.cornerRadius : 10;
            const lamp = lampOnState(el, world);
            if (options && options.designMode && !lamp.on) {
                lamp.on = true;
                lamp.intensity = 0.28;
            }
            ctx.save();
            ctx.translate(el.x || 0, el.y || 0);
            ctx.rotate(el.angle || 0);
            if (lamp.on) Pin.render.makeGlow(ctx, color, 12 + lamp.intensity * 20);
            roundedRectPath(ctx, 0, 0, w, h, cornerRadius);
            ctx.fillStyle = lamp.on ? color : "rgba(48, 58, 74, 0.86)";
            ctx.strokeStyle = lamp.on ? "#ffffff" : "rgba(150, 170, 195, 0.58)";
            ctx.lineWidth = Math.max(1.4, h * 0.055);
            ctx.fill();
            ctx.stroke();
            ctx.fillStyle = lamp.on ? "rgba(255,255,255,0.3)" : "rgba(255,255,255,0.08)";
            roundedRectPath(ctx, -w * 0.08, -h * 0.1, w * 0.74, h * 0.4, Math.max(3, cornerRadius * 0.55));
            ctx.fill();
            drawFittedText(ctx, el.text || el.label, w * 0.84, h, lamp.on ? "#071014" : "#d2d8e8");
            ctx.restore();
        },
        editor: { handles: true, hitTest: true, inspectorFields: ["w", "h", "angle", "cornerRadius", "lampId", "text", "label", "color"] }
    });
})(window.Pin);
