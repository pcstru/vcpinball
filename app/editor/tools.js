(function initEditorTools(Pin) {
    function getMousePos(canvas, evt) {
        const rect = canvas.getBoundingClientRect();
        const x = (evt.clientX - rect.left) / rect.width * canvas.width;
        const y = (evt.clientY - rect.top) / rect.height * canvas.height;
        return { x: x, y: y };
    }

    function createView() {
        return { zoom: 1, panX: 0, panY: 0 };
    }

    function worldToScreen(pt, view) {
        return {
            x: pt.x * view.zoom + view.panX,
            y: pt.y * view.zoom + view.panY
        };
    }

    function screenToWorld(canvas, evt, view) {
        const p = getMousePos(canvas, evt);
        return {
            x: (p.x - view.panX) / view.zoom,
            y: (p.y - view.panY) / view.zoom
        };
    }

    function snap(n, size, enabled) {
        if (!enabled) return n;
        return Math.round(n / size) * size;
    }

    function clone(value) {
        return JSON.parse(JSON.stringify(value));
    }

    function getByPath(obj, path) {
        return path.split(".").reduce(function reduce(acc, part) {
            return acc && acc[part];
        }, obj);
    }

    function setByPath(obj, path, value) {
        const parts = path.split(".");
        let cursor = obj;
        for (let i = 0; i < parts.length - 1; i++) {
            if (!cursor[parts[i]] || typeof cursor[parts[i]] !== "object") cursor[parts[i]] = {};
            cursor = cursor[parts[i]];
        }
        cursor[parts[parts.length - 1]] = value;
    }

    function distancePointToSegment(px, py, x1, y1, x2, y2) {
        const dx = x2 - x1;
        const dy = y2 - y1;
        const lenSq = dx * dx + dy * dy || 1;
        const t = Math.max(0, Math.min(1, ((px - x1) * dx + (py - y1) * dy) / lenSq));
        const cx = x1 + dx * t;
        const cy = y1 + dy * t;
        const qx = px - cx;
        const qy = py - cy;
        return { dist: Math.sqrt(qx * qx + qy * qy), t: t, x: cx, y: cy };
    }

    Pin.editorTools = {
        getMousePos: getMousePos,
        createView: createView,
        worldToScreen: worldToScreen,
        screenToWorld: screenToWorld,
        snap: snap,
        clone: clone,
        getByPath: getByPath,
        setByPath: setByPath,
        distancePointToSegment: distancePointToSegment,
        names: ["select", "pen", "bumper", "leftFlipper", "rightFlipper", "launcher", "path", "lane", "dropTarget", "spinner", "gate", "kicker", "ramp", "scoreZone"]
    };
})(window.Pin);
