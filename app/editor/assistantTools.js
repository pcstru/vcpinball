/*
 * What: Deterministic browser-local tools for assistant numeric/layout tasks.
 * Why: LLM output is weak at exact geometry, so tool calls provide exact values
 *      without introducing a backend executor or arbitrary code execution.
 */
(function initEditorAssistantTools(Pin) {
    const TOOL_DEFS = {
        radialLayout: {
            name: "radialLayout",
            purpose: "Compute evenly spaced element placement around a center point or selected object.",
            args: {
                elementType: "string",
                count: "int",
                radius: "number",
                startAngleDeg: "number optional",
                centerElementId: "string optional",
                center: "{x:number,y:number} optional",
                elementDefaults: "object optional"
            }
        }
    };

    function safeNumber(value, fallback) {
        const num = Number(value);
        return Number.isFinite(num) ? num : fallback;
    }

    function toInt(value, fallback) {
        const num = Math.floor(Number(value));
        return Number.isFinite(num) ? num : fallback;
    }

    function isPlainObject(value) {
        return !!value && typeof value === "object" && !Array.isArray(value);
    }

    function makeElementFactory() {
        let counter = 0;
        return function makeId(type) {
            counter += 1;
            return String(type || "element") + "_" + String(Date.now()) + "_" + String(counter);
        };
    }

    function createElement(type, makeId) {
        if (Pin.editorModel && typeof Pin.editorModel.createDefaultElement === "function") {
            return Pin.editorModel.createDefaultElement(type, makeId);
        }
        if (type === "light") {
            return { id: makeId(type), type: "light", level: 0, x: 0, y: 0, radius: 13, lampId: "", text: "", label: "", color: "#ffee55", transparency: 1 };
        }
        return null;
    }

    function findElementById(table, id) {
        const elements = table && Array.isArray(table.elements) ? table.elements : [];
        return elements.find(function find(el) { return el && el.id === id; }) || null;
    }

    function resolveCenter(args, context) {
        if (isPlainObject(args.center)) {
            return {
                x: safeNumber(args.center.x, NaN),
                y: safeNumber(args.center.y, NaN)
            };
        }
        if (args.centerElementId) {
            const el = findElementById(context.table, String(args.centerElementId));
            if (el) return { x: safeNumber(el.x, NaN), y: safeNumber(el.y, NaN) };
        }
        if (context.selected && typeof context.selected.x === "number" && typeof context.selected.y === "number") {
            return { x: context.selected.x, y: context.selected.y };
        }
        return { x: NaN, y: NaN };
    }

    function runRadialLayout(args, context) {
        const count = toInt(args.count, 0);
        const radius = safeNumber(args.radius, 0);
        const startAngleDeg = safeNumber(args.startAngleDeg, -90);
        const elementType = String(args.elementType || "light");
        const center = resolveCenter(args, context);
        const makeId = makeElementFactory();
        const issues = [];
        if (!Number.isFinite(center.x) || !Number.isFinite(center.y)) issues.push("radialLayout requires center coordinates, centerElementId, or a selected element with x/y.");
        if (!(count >= 1 && count <= 128)) issues.push("radialLayout count must be between 1 and 128.");
        if (!(radius > 0)) issues.push("radialLayout radius must be greater than 0.");
        if (issues.length) return { ok: false, message: issues.join(" ") };

        const elements = [];
        const step = (Math.PI * 2) / count;
        const startAngle = (startAngleDeg * Math.PI) / 180;
        for (let i = 0; i < count; i += 1) {
            const angle = startAngle + (step * i);
            const el = createElement(elementType, makeId);
            if (!el) return { ok: false, message: "Unsupported elementType for radialLayout: " + elementType };
            el.x = center.x + (Math.cos(angle) * radius);
            el.y = center.y + (Math.sin(angle) * radius);
            if (isPlainObject(args.elementDefaults)) {
                Object.keys(args.elementDefaults).forEach(function each(key) {
                    if (key === "id" || key === "type" || key === "x" || key === "y") return;
                    el[key] = args.elementDefaults[key];
                });
            }
            if ((el.type === "light" || el.type === "arrowLight" || el.type === "boxLight") && !String(el.lampId || "").trim()) {
                el.lampId = el.id;
            }
            elements.push(el);
        }
        return {
            ok: true,
            patch: { addElements: elements },
            summary: "radialLayout generated " + String(elements.length) + " " + elementType + " element(s)."
        };
    }

    function runToolRequest(request, context) {
        if (!isPlainObject(request)) return { ok: false, message: "Tool request must be an object." };
        const tool = String(request.tool || "");
        const args = isPlainObject(request.args) ? request.args : {};
        if (tool === "radialLayout") return runRadialLayout(args, context || {});
        return { ok: false, message: "Unsupported tool: " + tool };
    }

    function describeTools() {
        return Object.keys(TOOL_DEFS).map(function map(key) {
            return TOOL_DEFS[key];
        });
    }

    function runToolRequests(requests, context) {
        if (!Array.isArray(requests) || !requests.length) {
            return { ok: false, message: "toolRequests must be a non-empty array." };
        }
        const toolResults = [];
        for (let i = 0; i < requests.length; i += 1) {
            const request = requests[i];
            const result = runToolRequest(request, context || {});
            if (!result.ok) return { ok: false, message: "Tool request " + String(i) + " failed: " + result.message };
            toolResults.push({
                index: i,
                tool: String(request.tool || ""),
                patch: result.patch,
                summary: result.summary || ""
            });
        }
        return { ok: true, toolResults: toolResults };
    }

    Pin.editorAssistantTools = {
        describeTools: describeTools,
        runToolRequest: runToolRequest,
        runToolRequests: runToolRequests
    };
})(window.Pin);
