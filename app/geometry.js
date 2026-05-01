(function initGeometry(Pin) {
    function point(x, y) {
        return { x: x, y: y };
    }

    function midpoint(a, b) {
        return point((a.x + b.x) * 0.5, (a.y + b.y) * 0.5);
    }

    function lineDistance(p, a, b) {
        const dx = b.x - a.x;
        const dy = b.y - a.y;
        const lenSq = dx * dx + dy * dy || 1;
        const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / lenSq));
        const cx = a.x + dx * t;
        const cy = a.y + dy * t;
        const qx = p.x - cx;
        const qy = p.y - cy;
        return Math.sqrt(qx * qx + qy * qy);
    }

    function cubicFlatEnough(p0, p1, p2, p3, tol) {
        return lineDistance(p1, p0, p3) <= tol && lineDistance(p2, p0, p3) <= tol;
    }

    function flattenCubic(p0, p1, p2, p3, tol, out, depth) {
        const maxDepth = 12;
        const d = depth || 0;
        if (d >= maxDepth || cubicFlatEnough(p0, p1, p2, p3, tol)) {
            out.push({ x1: p0.x, y1: p0.y, x2: p3.x, y2: p3.y });
            return;
        }
        const p01 = midpoint(p0, p1);
        const p12 = midpoint(p1, p2);
        const p23 = midpoint(p2, p3);
        const p012 = midpoint(p01, p12);
        const p123 = midpoint(p12, p23);
        const p0123 = midpoint(p012, p123);
        flattenCubic(p0, p01, p012, p0123, tol, out, d + 1);
        flattenCubic(p0123, p123, p23, p3, tol, out, d + 1);
    }

    function pathToSegments(anchors, closed, tol) {
        const segments = [];
        if (!anchors || anchors.length < 2) return segments;
        const n = anchors.length;
        const end = closed ? n : n - 1;
        for (let i = 0; i < end; i++) {
            const a = anchors[i];
            const b = anchors[(i + 1) % n];
            const p0 = point(a.x, a.y);
            const p3 = point(b.x, b.y);
            const outH = a.outHandle ? point(a.x + a.outHandle.x, a.y + a.outHandle.y) : p0;
            const inH = b.inHandle ? point(b.x + b.inHandle.x, b.y + b.inHandle.y) : p3;
            const curved = a.outHandle || b.inHandle;
            if (curved) {
                flattenCubic(p0, outH, inH, p3, tol || 0.5, segments);
            } else {
                segments.push({ x1: p0.x, y1: p0.y, x2: p3.x, y2: p3.y });
            }
        }
        return segments;
    }

    Pin.geometry = {
        flattenCubic: flattenCubic,
        pathToSegments: pathToSegments
    };
})(window.Pin);
