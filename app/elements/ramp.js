(function registerRamp(Pin) {
    function pointFromSegStart(seg) {
        return { x: seg.x1, y: seg.y1 };
    }

    function buildRailPoints(segs) {
        if (!segs.length) return [];
        const points = segs.map(pointFromSegStart);
        const last = segs[segs.length - 1];
        points.push({ x: last.x2, y: last.y2 });
        return points;
    }

    function buildCenterAnchors(leftAnchors, rightAnchors) {
        const count = Math.min(leftAnchors.length, rightAnchors.length);
        const anchors = [];
        for (let i = 0; i < count; i++) {
            const left = leftAnchors[i];
            const right = rightAnchors[i];
            const anchor = {
                x: (left.x + right.x) * 0.5,
                y: (left.y + right.y) * 0.5
            };
            if (left.outHandle || right.outHandle) {
                anchor.outHandle = {
                    x: ((left.outHandle && left.outHandle.x) || 0) * 0.5 + ((right.outHandle && right.outHandle.x) || 0) * 0.5,
                    y: ((left.outHandle && left.outHandle.y) || 0) * 0.5 + ((right.outHandle && right.outHandle.y) || 0) * 0.5
                };
            }
            if (left.inHandle || right.inHandle) {
                anchor.inHandle = {
                    x: ((left.inHandle && left.inHandle.x) || 0) * 0.5 + ((right.inHandle && right.inHandle.x) || 0) * 0.5,
                    y: ((left.inHandle && left.inHandle.y) || 0) * 0.5 + ((right.inHandle && right.inHandle.y) || 0) * 0.5
                };
            }
            anchors.push(anchor);
        }
        return anchors;
    }

    function addLengths(segs) {
        let total = 0;
        segs.forEach(function each(seg) {
            const dx = seg.x2 - seg.x1;
            const dy = seg.y2 - seg.y1;
            seg.startLength = total;
            seg.length = Math.sqrt(dx * dx + dy * dy);
            total += seg.length;
        });
        return total;
    }

    Pin.elements.register("ramp", {
        compile: function compile(el) {
            const leftSegs = Pin.geometry.pathToSegments(el.leftAnchors || [], false, 0.5);
            const rightSegs = Pin.geometry.pathToSegments(el.rightAnchors || [], false, 0.5);
            const drawLeftSegs = Pin.geometry.pathToSegments(el.leftAnchors || [], false, 1);
            const drawRightSegs = Pin.geometry.pathToSegments(el.rightAnchors || [], false, 1);
            const segments = leftSegs.concat(rightSegs).map(function toSeg(seg) {
                return {
                    x1: seg.x1,
                    y1: seg.y1,
                    x2: seg.x2,
                    y2: seg.y2,
                    role: "ramp",
                    surfaceId: el.id,
                    thickness: typeof el.railThickness === "number" ? el.railThickness : 2
                };
            });
            const leftPoints = buildRailPoints(leftSegs);
            const rightPoints = buildRailPoints(rightSegs);
            const centerAnchors = buildCenterAnchors(el.leftAnchors || [], el.rightAnchors || []);
            const centerSegments = Pin.geometry.pathToSegments(centerAnchors, false, 0.5);
            const totalLength = addLengths(centerSegments);
            const ramp = {
                id: el.id,
                levelFrom: typeof el.levelFrom === "number" ? el.levelFrom : 0,
                levelTo: typeof el.levelTo === "number" ? el.levelTo : 1,
                zStart: typeof el.zStart === "number" ? el.zStart : 0,
                zEnd: typeof el.zEnd === "number" ? el.zEnd : 48,
                outline: leftPoints.concat(rightPoints.slice().reverse()),
                centerSegments: centerSegments,
                totalLength: totalLength
            };
            return {
                segments: segments,
                ramps: ramp.outline.length >= 3 && centerSegments.length ? [ramp] : [],
                drawLeftSegs: drawLeftSegs,
                drawRightSegs: drawRightSegs
            };
        },
        draw: function draw(ctx, el, runtime) {
            const leftSegs = (runtime && runtime.drawLeftSegs) || Pin.geometry.pathToSegments(el.leftAnchors || [], false, 1);
            const rightSegs = (runtime && runtime.drawRightSegs) || Pin.geometry.pathToSegments(el.rightAnchors || [], false, 1);
            ctx.save();
            ctx.strokeStyle = el.color || "#88aaff";
            ctx.lineWidth = 2;
            ctx.lineCap = "round";
            Pin.render.makeGlow(ctx, el.color || "#88aaff", 10);
            leftSegs.forEach(function drawSeg(seg) {
                ctx.beginPath();
                ctx.moveTo(seg.x1, seg.y1);
                ctx.lineTo(seg.x2, seg.y2);
                ctx.stroke();
            });
            rightSegs.forEach(function drawSeg(seg) {
                ctx.beginPath();
                ctx.moveTo(seg.x1, seg.y1);
                ctx.lineTo(seg.x2, seg.y2);
                ctx.stroke();
            });
            if (leftSegs.length && rightSegs.length) {
                ctx.fillStyle = "rgba(130,160,255,0.08)";
                ctx.beginPath();
                ctx.moveTo(leftSegs[0].x1, leftSegs[0].y1);
                leftSegs.forEach(function each(seg) { ctx.lineTo(seg.x2, seg.y2); });
                for (let i = rightSegs.length - 1; i >= 0; i--) ctx.lineTo(rightSegs[i].x1, rightSegs[i].y1);
                ctx.closePath();
                ctx.fill();
            }
            ctx.restore();
        },
        editor: { handles: true, hitTest: true, inspectorFields: ["color"] }
    });
})(window.Pin);
