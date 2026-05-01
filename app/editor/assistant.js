/*
 * Assistant runtime for the design editor.
 * Why: keep the visible UI chat-first while giving the model enough table context
 * to propose reviewable patches that can be applied and rolled back.
 */
(function initEditorAssistant(Pin) {
    const SETTINGS_KEY = "pin.assistant.settings";
    const DEFAULT_SETTINGS = {
        providerLabel: "LM Studio",
        baseUrl: "http://127.0.0.1:1234/v1",
        model: "",
        apiKey: "",
        maxSteps: 4
    };
    const DEFAULT_PICKS = {
        steps: [],
        target: "",
        stepLamps: [],
        targetLamp: ""
    };
    const DEFAULT_LAYOUT_PICKS = [];
    const MAX_LOG_ENTRIES = 80;
    const AUTHORING_CONTRACT = [
        "Authoring contract:",
        "- Use only current table objects and exact ids returned by tools.",
        "- Prefer structured patches over explanations when the request is actionable.",
        "- For lane layout, lane elements use x/y center coordinates and w/h size fields.",
        "- Score-producing elements use the property name score. Do not invent baseScore; use score.",
        "- Rule actions can use element actions, variable actions, and lamp actions. Variables live in rulesEngine.variables and timers live in rulesEngine.triggers.",
        "- Timer triggers emit normal switch IDs, so sequence steps may use trigger switch IDs like tick.flash.",
        "- Rules may also use conditions. Conditions can compare variables, element scores/properties, world score, or constants with eq/ne/gt/gte/lt/lte/truthy/falsy.",
        "- Logic variables are invisible runtime state, not table elements. Use setVariableProperty, addVariableProperty, toggleVariableProperty, resetVariableProperty, setLamp, clearLamp, or setLampFromVariable when needed.",
        "- Flippers use pivot, length, restAngle, activeAngle, flipSpeed, flipAccel, returnSpeed, returnAccel, strikeBoost, surfaceRestitution, surfaceFriction, tipStrikeBoost, tipRestitution, tipFriction, and thickness.",
        "- Gate is the current rotating gate mechanism. Gate supports locked; when locked it acts as a wall and cannot swing.",
        "- Drain is an out-of-play removal sensor. Trough is a circular saucer/pit with radius, holdSeconds, reactivateDelay, ejectPower, and ejectAngle.",
        "- Launcher is selectable and uses x, top, bottom, width, maxPower, maxRetract, pullSpeed, returnSpeed, and springStrength.",
        "- Presentation lamps use light, arrowLight, or boxLight. All support lampId, text, label, and color; arrowLight uses w, h, and angle; boxLight uses w, h, angle, and cornerRadius.",
        "- Do not invent geometry fields for elements that do not expose them.",
        "- If the request is under-specified, explain the blocker briefly instead of guessing.",
        "- Do not output raw element objects when the task is an edit request.",
        "- For layout requests, reason in terms of editor operations first, not freehand coordinate math."
    ].join("\n");

    function clone(value) {
        return JSON.parse(JSON.stringify(value));
    }

    function loadSettings() {
        try {
            const raw = localStorage.getItem(SETTINGS_KEY);
            if (!raw) return clone(DEFAULT_SETTINGS);
            const parsed = JSON.parse(raw);
            const settings = Object.assign({}, DEFAULT_SETTINGS, parsed);
            if (parsed && parsed.apiKey) {
                try {
                    localStorage.setItem(SETTINGS_KEY, JSON.stringify(Object.assign({}, parsed, { apiKey: "" })));
                } catch (writeErr) {}
            }
            settings.apiKey = "";
            return settings;
        } catch (err) {
            return clone(DEFAULT_SETTINGS);
        }
    }

    function saveSettings(settings) {
        try {
            const safeSettings = Object.assign({}, settings, { apiKey: "" });
            localStorage.setItem(SETTINGS_KEY, JSON.stringify(safeSettings));
        } catch (err) {}
    }

    function stripTrailingSlash(value) {
        return String(value || "").replace(/\/+$/, "");
    }

    function summarizeElement(element) {
        if (!element) return null;
        const summary = {
            id: element.id,
            name: element.name || "",
            type: element.type,
            level: typeof element.level === "number" ? element.level : 0,
            pivot: element.pivot ? { x: element.pivot.x, y: element.pivot.y } : undefined,
            label: element.label || "",
            text: element.text || "",
            lampId: element.lampId || ""
        };
        [
            "x", "y", "w", "h", "width", "top", "bottom", "radius", "length", "angle", "cornerRadius",
            "restAngle", "activeAngle", "flipSpeed", "flipAccel", "returnSpeed", "returnAccel",
            "strikeBoost", "tipStrikeBoost", "surfaceRestitution", "surfaceFriction",
            "tipRestitution", "tipFriction", "thickness", "maxPower", "maxRetract",
            "pullSpeed", "springStrength", "power", "kickPower", "score", "restitution",
            "friction", "holdSeconds", "reactivateDelay", "ejectPower", "ejectAngle", "maxAngle",
            "returnStrength", "returnDamping", "levelFrom", "levelTo", "zStart", "zEnd"
        ].forEach(function copyNumber(key) {
            if (typeof element[key] === "number") summary[key] = element[key];
        });
        [
            "side", "control", "role", "direction", "color", "pitColor", "pinColor",
            "surfaceId", "lampId"
        ].forEach(function copyString(key) {
            if (typeof element[key] === "string" && element[key]) summary[key] = element[key];
        });
        ["closed", "twoWay", "enabled", "locked"].forEach(function copyBoolean(key) {
            if (typeof element[key] === "boolean") summary[key] = element[key];
        });
        ["anchors", "leftAnchors", "rightAnchors"].forEach(function countAnchors(key) {
            if (Array.isArray(element[key])) summary[key + "Count"] = element[key].length;
        });
        return summary;
    }

    function summarizeElementFull(element) {
        if (!element) return null;
        return clone(element);
    }

    function getElementKnowledge() {
        return {
            patchOperation: "Use patchElements with { patches: [{ id, patch }] } for direct element property edits.",
            score: "Use score for default contact scoring. Do not use baseScore.",
            gate: "Use gate for rotating gate mechanisms. Valve is legacy and should not be proposed for new table edits. Gate locked=true makes it act as a wall.",
            trough: "Use trough for a round saucer/pit: radius, holdSeconds, reactivateDelay, ejectPower, ejectAngle, color, pitColor.",
            drain: "Use drain for bottom out-of-play removal: x, y, w, h, color.",
            flipper: "Use flipper material fields: surfaceRestitution/surfaceFriction for body, tipRestitution/tipFriction/tipStrikeBoost for tip, strikeBoost for driven impact.",
            launcher: "Launcher geometry is x/top/bottom/width; power is maxPower/maxRetract/pullSpeed/returnSpeed/springStrength.",
            presentation: "Use light for circular lamps, arrowLight for scalable rotated arrow lamps, and boxLight for rotated rounded text boxes. All use lampId and optional text.",
            logic: "Rules can use sequenceRules plus logicGraphs. Timers are rulesEngine.triggers and emit normal switch IDs. Variables are rulesEngine.variables runtime state. Rules may use conditions with eq/ne/gt/gte/lt/lte/truthy/falsy. Action nodes can use element, variable, and lamp action types."
        };
    }

    function summarizeRule(rule) {
        if (!rule) return null;
        return {
            id: rule.id,
            name: rule.name || "",
            enabled: rule.enabled !== false,
            ordered: !!rule.ordered,
            steps: clone(rule.steps || []),
            stepLampIds: clone(rule.stepLampIds || []),
            targetSwitchId: rule.targetSwitchId || "",
            targetLampId: rule.targetLampId || "",
            windowSeconds: typeof rule.windowSeconds === "number" ? rule.windowSeconds : 0,
            awardPoints: typeof rule.awardPoints === "number" ? rule.awardPoints : 0,
            awardEvent: rule.awardEvent || "",
            conditions: clone(rule.conditions || []),
            actions: clone(rule.actions || []),
            resetOnDrain: rule.resetOnDrain !== false,
            resetOnComplete: rule.resetOnComplete !== false,
            resetOnWrongOrder: !!rule.resetOnWrongOrder
        };
    }

    function summarizeGraph(graph) {
        if (!graph) return null;
        return {
            id: graph.id,
            name: graph.name || "",
            sourceRuleId: graph.sourceRuleId || "",
            nodeCount: (graph.nodes || []).length,
            edgeCount: (graph.edges || []).length
        };
    }

    function summarizeNode(node) {
        if (!node) return null;
        return {
            id: node.id,
            type: node.type,
            label: node.label || "",
            switchId: node.switchId || "",
            lampId: node.lampId || "",
            sourceId: node.sourceId || "",
            targetId: node.targetId || "",
            value: typeof node.value === "number" ? node.value : undefined,
            windowSeconds: typeof node.windowSeconds === "number" ? node.windowSeconds : undefined,
            awardPoints: typeof node.awardPoints === "number" ? node.awardPoints : undefined,
            variableId: node.variableId || "",
            property: node.property || "",
            operator: node.operator || "",
            actionType: node.actionType || "",
            lampId: node.lampId || ""
        };
    }

    function distanceBetween(a, b) {
        if (!a || !b) return Number.POSITIVE_INFINITY;
        const ax = typeof a.x === "number" ? a.x : (a.pivot ? a.pivot.x : null);
        const ay = typeof a.y === "number" ? a.y : (a.pivot ? a.pivot.y : null);
        const bx = typeof b.x === "number" ? b.x : (b.pivot ? b.pivot.x : null);
        const by = typeof b.y === "number" ? b.y : (b.pivot ? b.pivot.y : null);
        if (ax == null || ay == null || bx == null || by == null) return Number.POSITIVE_INFINITY;
        const dx = ax - bx;
        const dy = ay - by;
        return Math.sqrt(dx * dx + dy * dy);
    }

    function normalizeResponseContent(content) {
        if (Array.isArray(content)) {
            return content.map(function map(part) {
                if (typeof part === "string") return part;
                if (part && typeof part.text === "string") return part.text;
                return "";
            }).join("\n").trim();
        }
        return typeof content === "string" ? content.trim() : "";
    }

    function tryParseJson(text) {
        if (!text) return null;
        try {
            return JSON.parse(text);
        } catch (err) {}
        const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
        if (fenced && fenced[1]) {
            try {
                return JSON.parse(fenced[1].trim());
            } catch (err) {}
        }
        const arrayStart = text.indexOf("[");
        const arrayEnd = text.lastIndexOf("]");
        if (arrayStart >= 0 && arrayEnd > arrayStart) {
            try {
                return JSON.parse(text.slice(arrayStart, arrayEnd + 1));
            } catch (err) {}
        }
        const start = text.indexOf("{");
        const end = text.lastIndexOf("}");
        if (start >= 0 && end > start) {
            try {
                return JSON.parse(text.slice(start, end + 1));
            } catch (err) {}
        }
        return null;
    }

    function makeSchema() {
        return {
            type: "object",
            properties: {
                message: { type: "string" },
                patch: {
                    anyOf: [
                        { type: "null" },
                        {
                            type: "object",
                            properties: {
                                type: { type: "string" },
                                description: { type: "string" },
                                operations: {
                                    type: "array",
                                    items: {
                                        type: "object",
                                        properties: {
                                            op: { type: "string" },
                                            rule: { type: "object" },
                                            variable: { type: "object" },
                                            trigger: { type: "object" },
                                            id: { type: "string" },
                                            ids: { type: "array", items: { type: "string" } },
                                            value: { type: "number" },
                                            patch: { type: "object" },
                                            mapping: { type: "object" },
                                            index: { type: "number" }
                                        },
                                        required: ["op"]
                                    }
                                }
                            },
                            required: ["type", "operations"]
                        }
                    ]
                }
            },
            required: ["message", "patch"]
        };
    }

    function clipLogText(value, limit) {
        const text = typeof value === "string" ? value : JSON.stringify(value, null, 2);
        if (!text) return "";
        return text.length > (limit || 6000) ? text.slice(0, limit || 6000) + "\n...[truncated]" : text;
    }

    function displayElementRef(element) {
        if (!element) return "";
        const name = element.name || element.label || "";
        return name ? name + " (" + element.id + ")" : element.id;
    }

    function create(options) {
        const state = {
            settings: loadSettings(),
            messages: [],
            draft: "",
            busy: false,
            error: "",
            lastPatch: null,
            logs: [],
            logOpen: false,
            picks: clone(DEFAULT_PICKS),
            layoutPicks: clone(DEFAULT_LAYOUT_PICKS),
            connectionStatus: "Not tested",
            availableModels: [],
            skillText: ""
        };
        const refresh = options.refresh;

        function snapshot() {
            return {
                settings: clone(state.settings),
                messages: clone(state.messages),
                draft: state.draft,
                busy: state.busy,
                error: state.error,
                lastPatch: clone(state.lastPatch),
                lastPatchSummary: summarizePatch(state.lastPatch),
                logs: clone(state.logs),
                logOpen: state.logOpen,
                picks: clone(state.picks),
                layoutPicks: summarizeLayoutPicks(),
                connectionStatus: state.connectionStatus,
                availableModels: clone(state.availableModels)
            };
        }

        /**
         * Append one bounded assistant trace entry.
         * Why: invalid provider/model output needs to be inspectable in the UI
         * without turning the assistant path into a server-side debugging system.
         */
        function logEntry(stage, detail) {
            state.logs.push({
                at: new Date().toISOString(),
                stage: stage,
                detail: clipLogText(detail, 8000)
            });
            if (state.logs.length > MAX_LOG_ENTRIES) state.logs.splice(0, state.logs.length - MAX_LOG_ENTRIES);
        }

        function persistSettings() {
            saveSettings(state.settings);
        }

        function setSettings(patch) {
            Object.keys(patch || {}).forEach(function each(key) {
                state.settings[key] = patch[key];
            });
            persistSettings();
            refresh("inspector");
        }

        function setDraft(value) {
            state.draft = value || "";
        }

        function clearConversation() {
            state.messages = [];
            state.error = "";
            state.lastPatch = null;
            refresh("inspector");
        }

        function openLog() {
            state.logOpen = true;
            refresh("inspector");
        }

        function closeLog() {
            state.logOpen = false;
            refresh("inspector");
        }

        function clearLog() {
            state.logs = [];
            refresh("inspector");
        }

        function getElementById(id) {
            const table = options.getTable();
            return ((table && table.elements) || []).find(function find(element) { return element.id === id; }) || null;
        }

        function summarizePickedState() {
            return {
                steps: state.picks.steps.map(function map(id) { return summarizeElement(getElementById(id)); }).filter(Boolean),
                target: summarizeElement(getElementById(state.picks.target)),
                stepLamps: state.picks.stepLamps.map(function map(id) { return summarizeElement(getElementById(id)); }).filter(Boolean),
                targetLamp: summarizeElement(getElementById(state.picks.targetLamp))
            };
        }

        function summarizeLayoutPicks() {
            return state.layoutPicks.map(function map(id) {
                return summarizeElement(getElementById(id));
            }).filter(Boolean);
        }

        function describeElementId(id) {
            if (!id) return "(none)";
            return displayElementRef(getElementById(id)) || id;
        }

        function describeLampRef(id) {
            if (!id) return "(none)";
            const element = getElementById(id) || ((options.getTable().elements || []).find(function find(entry) {
                return entry && (entry.type === "light" || entry.type === "arrowLight" || entry.type === "boxLight") && ((entry.lampId || entry.id) === id);
            }) || null);
            return displayElementRef(element) || id;
        }

        function summarizePatch(patch) {
            if (!patch || !Array.isArray(patch.operations)) return [];
            const lines = [];
            patch.operations.forEach(function each(operation) {
                if (!operation || !operation.op) return;
                if (operation.op === "addSequenceRule") {
                    const rule = operation.rule || {};
                    lines.push("Add sequence " + (rule.name || rule.id || "Sequence"));
                    lines.push("  Steps: " + ((rule.steps || []).map(describeElementId).join(" -> ") || "(none)"));
                    if ((rule.stepLampIds || []).length) {
                        lines.push("  Step lamps: " + rule.stepLampIds.map(describeLampRef).join(" -> "));
                    }
                    lines.push("  Target: " + describeElementId(rule.targetSwitchId));
                    if (rule.targetLampId) lines.push("  Target lamp: " + describeLampRef(rule.targetLampId));
                    if (typeof rule.windowSeconds === "number") lines.push("  Window: " + rule.windowSeconds + "s");
                    if (typeof rule.awardPoints === "number") lines.push("  Award: " + rule.awardPoints + " points");
                    if (rule.awardEvent) lines.push("  Event: " + rule.awardEvent);
                    return;
                }
                if (operation.op === "updateSequenceRule") {
                    lines.push("Update sequence " + (operation.id || "(unknown)"));
                    const patchFields = operation.patch || {};
                    Object.keys(patchFields).forEach(function eachKey(key) {
                        let value = patchFields[key];
                        if (key === "steps") value = (value || []).map(describeElementId).join(" -> ");
                        else if (key === "stepLampIds") value = (value || []).map(describeLampRef).join(" -> ");
                        else if (key === "targetSwitchId") value = describeElementId(value);
                        else if (key === "targetLampId") value = describeLampRef(value);
                        lines.push("  " + key + ": " + String(value));
                    });
                    return;
                }
                if (operation.op === "deleteSequenceRule") {
                    lines.push("Delete sequence " + (operation.id || "(unknown)"));
                    return;
                }
                if (operation.op === "addSwitchMap") {
                    const mapping = operation.mapping || {};
                    lines.push("Add switch map " + (mapping.sourceId || "(source)") + " -> " + (mapping.switchId || "(switch)"));
                    return;
                }
                if (operation.op === "updateSwitchMap") {
                    lines.push("Update switch map #" + operation.index);
                    Object.keys(operation.patch || {}).forEach(function eachKey(key) {
                        lines.push("  " + key + ": " + String(operation.patch[key]));
                    });
                    return;
                }
                if (operation.op === "deleteSwitchMap") {
                    lines.push("Delete switch map #" + operation.index);
                    return;
                }
                if (operation.op === "addVariable") {
                    const variable = operation.variable || {};
                    lines.push("Add variable " + (variable.name || variable.id || "(variable)"));
                    return;
                }
                if (operation.op === "updateVariable") {
                    lines.push("Update variable " + (operation.id || "(unknown)"));
                    Object.keys(operation.patch || {}).forEach(function eachKey(key) {
                        lines.push("  " + key + ": " + JSON.stringify(operation.patch[key]));
                    });
                    return;
                }
                if (operation.op === "deleteVariable") {
                    lines.push("Delete variable " + (operation.id || "(unknown)"));
                    return;
                }
                if (operation.op === "addTrigger") {
                    const trigger = operation.trigger || {};
                    lines.push("Add trigger " + (trigger.id || "(trigger)") + " -> " + (trigger.switchId || "(switch)"));
                    return;
                }
                if (operation.op === "updateTrigger") {
                    lines.push("Update trigger " + (operation.id || "(unknown)"));
                    Object.keys(operation.patch || {}).forEach(function eachKey(key) {
                        lines.push("  " + key + ": " + JSON.stringify(operation.patch[key]));
                    });
                    return;
                }
                if (operation.op === "deleteTrigger") {
                    lines.push("Delete trigger " + (operation.id || "(unknown)"));
                    return;
                }
                if (operation.op === "alignHorizontal") {
                    lines.push("Align horizontally: " + (operation.ids || []).map(describeElementId).join(", "));
                    return;
                }
                if (operation.op === "distributeHorizontal") {
                    lines.push("Distribute horizontally: " + (operation.ids || []).map(describeElementId).join(", "));
                    return;
                }
                if (operation.op === "matchWidth") {
                    lines.push("Match width for: " + (operation.ids || []).map(describeElementId).join(", "));
                    if (typeof operation.value === "number") lines.push("  Width: " + operation.value);
                    return;
                }
                if (operation.op === "matchHeight") {
                    lines.push("Match height for: " + (operation.ids || []).map(describeElementId).join(", "));
                    if (typeof operation.value === "number") lines.push("  Height: " + operation.value);
                    return;
                }
                if (operation.op === "patchElements") {
                    lines.push("Patch explicit element fields");
                    const patches = operation.patches || ((operation.patch && operation.patch.patches) || []);
                    patches.forEach(function eachPatch(entry) {
                        lines.push("  " + describeElementId(entry.id) + ": " + Object.keys(entry.patch || {}).map(function map(key) {
                            return key + "=" + entry.patch[key];
                        }).join(", "));
                    });
                    return;
                }
                lines.push("Operation: " + operation.op);
            });
            return lines;
        }

        function makeContextSummary() {
            const selected = options.getSelected ? options.getSelected() : null;
            const selectedRule = options.getSelectedRule ? options.getSelectedRule() : null;
            const selectedGraph = options.getSelectedGraph ? options.getSelectedGraph() : null;
            const selectedNode = options.getSelectedLogicNode ? options.getSelectedLogicNode() : null;
            const table = options.getTable();
            const rulesEngine = (table && table.rulesEngine) || {};
            const nearby = selected ? (table.elements || [])
                .filter(function filter(element) { return element && element.id !== selected.id; })
                .map(function map(element) {
                    return {
                        element: element,
                        distance: distanceBetween(selected, element)
                    };
                })
                .sort(function sort(a, b) { return a.distance - b.distance; })
                .slice(0, 8)
                .map(function map(entry) {
                    const summary = summarizeElement(entry.element);
                    summary.distance = Number.isFinite(entry.distance) ? Math.round(entry.distance * 10) / 10 : null;
                    return summary;
                }) : [];
            return {
                knowledge: getElementKnowledge(),
                table: {
                    name: table.name,
                    playfield: clone(table.playfield || {}),
                    selectedObject: summarizeElement(selected),
                    selectedRule: summarizeRule(selectedRule),
                    selectedGraph: summarizeGraph(selectedGraph),
                    selectedLogicNode: summarizeNode(selectedNode),
                    elementCount: (table.elements || []).length
                },
                nearbyElements: nearby,
                picks: summarizePickedState(),
                layoutPicks: summarizeLayoutPicks(),
                elements: (table.elements || []).map(summarizeElement),
                rules: (rulesEngine.sequenceRules || []).map(summarizeRule),
                triggers: clone(rulesEngine.triggers || []),
                variables: clone(rulesEngine.variables || []),
                logicGraphs: (rulesEngine.logicGraphs || []).map(summarizeGraph),
                validationIssues: options.getValidationIssues ? options.getValidationIssues() : [],
                activeTab: options.getActiveTab ? options.getActiveTab() : "properties"
            };
        }

        function buildTools() {
            return [
                {
                    type: "function",
                    function: {
                        name: "get_table_summary",
                        description: "Return a compact summary of the current table, element fields, rules, selection, validation issues, and authoring knowledge.",
                        parameters: { type: "object", properties: {} }
                    }
                },
                {
                    type: "function",
                    function: {
                        name: "get_selected_context",
                        description: "Return the selected object, selected rule, selected graph node, and nearby useful elements.",
                        parameters: { type: "object", properties: {} }
                    }
                },
                {
                    type: "function",
                    function: {
                        name: "get_picked_context",
                        description: "Return the explicitly picked step objects, target object, and lamps for guided sequence building.",
                        parameters: { type: "object", properties: {} }
                    }
                },
                {
                    type: "function",
                    function: {
                        name: "get_layout_picks",
                        description: "Return the explicitly picked layout objects for alignment and sizing tasks.",
                        parameters: { type: "object", properties: {} }
                    }
                },
                {
                    type: "function",
                    function: {
                        name: "list_elements",
                        description: "List elements, optionally filtered by type or level.",
                        parameters: {
                            type: "object",
                            properties: {
                                type: { type: "string" },
                                level: { type: "number" }
                            }
                        }
                    }
                },
                {
                    type: "function",
                    function: {
                        name: "get_element",
                        description: "Return one full element by id, including all current editable properties.",
                        parameters: {
                            type: "object",
                            properties: { id: { type: "string" } },
                            required: ["id"]
                        }
                    }
                },
                {
                    type: "function",
                    function: {
                        name: "list_rules",
                        description: "List existing sequence rules.",
                        parameters: { type: "object", properties: {} }
                    }
                },
                {
                    type: "function",
                    function: {
                        name: "get_rule",
                        description: "Return one sequence rule by id.",
                        parameters: {
                            type: "object",
                            properties: { id: { type: "string" } },
                            required: ["id"]
                        }
                    }
                },
                {
                    type: "function",
                    function: {
                        name: "get_validation_issues",
                        description: "Return current playability and rule validation issues.",
                        parameters: { type: "object", properties: {} }
                    }
                }
            ];
        }

        function executeToolCall(name, args) {
            const table = options.getTable();
            const rulesEngine = (table && table.rulesEngine) || {};
            if (name === "get_table_summary") {
                return makeContextSummary();
            }
            if (name === "get_selected_context") {
                const context = makeContextSummary();
                return {
                    selectedObject: context.table.selectedObject,
                    selectedRule: context.table.selectedRule,
                    selectedGraph: context.table.selectedGraph,
                    selectedLogicNode: context.table.selectedLogicNode,
                    nearbyElements: context.nearbyElements
                };
            }
            if (name === "get_picked_context") {
                return summarizePickedState();
            }
            if (name === "get_layout_picks") {
                return summarizeLayoutPicks();
            }
            if (name === "list_elements") {
                return (table.elements || []).filter(function filter(element) {
                    if (args.type && element.type !== args.type) return false;
                    if (typeof args.level === "number" && (element.level || 0) !== args.level) return false;
                    return true;
                }).map(summarizeElement);
            }
            if (name === "get_element") {
                return summarizeElementFull((table.elements || []).find(function find(element) { return element.id === args.id; }) || null);
            }
            if (name === "list_rules") {
                return (rulesEngine.sequenceRules || []).map(summarizeRule);
            }
            if (name === "get_rule") {
                return summarizeRule((rulesEngine.sequenceRules || []).find(function find(rule) { return rule.id === args.id; }) || null);
            }
            if (name === "get_validation_issues") {
                const ruleIssues = Pin.rules && Pin.rules.validate ? Pin.rules.validate(table) : [];
                return {
                    table: options.getValidationIssues ? options.getValidationIssues() : [],
                    rules: Array.isArray(ruleIssues) ? ruleIssues : (ruleIssues.issues || [])
                };
            }
            return { error: "Unknown tool " + name };
        }

        /**
         * Build the first-pass prompt.
         * Why: this pass is allowed to inspect tools and think about the task,
         * but it should not be forced into strict JSON too early.
         */
        function buildSystemPrompt() {
            const skillText = state.skillText ? ("\n\nTBSpec skill:\n" + state.skillText) : "";
            return [
                "You are an assistant embedded in a pinball table editor.",
                "Your main job is to help author table logic and table layout.",
                "You can also help with layout when explicit layout picks are provided.",
                "You may use tools to inspect the current table before answering.",
                "Do not invent element ids or lamp ids. Use only ids returned by tools.",
                "Do not ask the user to edit raw JSON by hand when you can propose a structured patch.",
                "Prefer concise, practical answers focused on the current table.",
                "The expected outcome is a clear intended edit or a short blocker explanation if a valid edit cannot be formed.",
                "When the user is asking for an edit, do not answer like a tutorial.",
                "Do not produce replacement JSON objects for edit requests.",
                "For layout requests, identify the exact target ids and state the intended editor operations.",
                "Good first-pass layout wording is like: 'Target ids: laneA, laneB, laneC. Intended operations: alignHorizontal, matchWidth, matchHeight.'",
                "Bad wording is freehand geometry advice, average-coordinate calculations, or illustrative JSON.",
                AUTHORING_CONTRACT,
                skillText
            ].join("\n");
        }

        /**
         * Build the second-pass prompt.
         * Why: this pass exists purely to emit the supported patch envelope as
         * strict JSON. We keep format discipline here instead of adding local
         * JSON repair code for every bad assistant shape.
         */
        function buildExtractionPrompt() {
            return [
                "You are a strict JSON patch normalizer for a pinball table editor.",
                "Convert the prior assistant output into one supported response object.",
                "You are compiling rough notes into a patch, not reviewing or improving the writing.",
                "Return strict JSON only. No markdown. No commentary.",
                "If no valid patch can be formed, return patch null and a short blocker message.",
                "Never return raw element objects, JSON Patch arrays, or prose-only advice.",
                "Return exactly one JSON object with keys: message, patch.",
                "Allowed patch operations only:",
                "- addSequenceRule { rule }",
                "- updateSequenceRule { id, patch }",
                "- deleteSequenceRule { id }",
                "- addSwitchMap { mapping }",
                "- updateSwitchMap { index, patch }",
                "- deleteSwitchMap { index }",
                "- addVariable { variable }",
                "- updateVariable { id, patch }",
                "- deleteVariable { id }",
                "- addTrigger { trigger }",
                "- updateTrigger { id, patch }",
                "- deleteTrigger { id }",
                "- alignHorizontal { ids }",
                "- distributeHorizontal { ids }",
                "- matchWidth { ids, value? }",
                "- matchHeight { ids, value? }",
                "- patchElements { patches: [{ id, patch }] }",
                "Use only ids and fields already present in the provided context.",
                "For current supported element properties, use the Current editor context knowledge section and the element summaries.",
                "For score edits, emit patchElements patches that set score, never baseScore.",
                "For trough edits, emit patchElements patches using radius, holdSeconds, reactivateDelay, ejectPower, ejectAngle, color, or pitColor.",
                "For flipper physics/material edits, emit patchElements patches using surfaceRestitution, surfaceFriction, tipRestitution, tipFriction, tipStrikeBoost, strikeBoost, flipAccel, returnAccel, flipSpeed, or returnSpeed.",
                "For launcher edits, emit patchElements patches using x, top, bottom, width, maxPower, maxRetract, pullSpeed, returnSpeed, or springStrength.",
                "For horizontal alignment requests, prefer alignHorizontal with the resolved ids.",
                "For 'same size' requests on rectangular elements such as lanes, prefer matchWidth and matchHeight.",
                "Use patchElements only when the edit cannot be represented by the higher-level layout operations.",
                "If the first-pass text contains raw objects or coordinate suggestions, do not copy that shape. Extract the intent and emit the supported patch format.",
                "If the original request says there are three lanes and one is selected, resolve the other lane ids from the provided context when possible.",
                "Do not explain averages, spacing, or geometry unless the patch must use explicit field edits.",
                "Example valid response:",
                JSON.stringify({
                    message: "Align the three lanes horizontally and match their size.",
                    patch: {
                        type: "layoutPatch",
                        operations: [
                            { op: "alignHorizontal", ids: ["laneA", "laneB", "laneC"] },
                            { op: "matchWidth", ids: ["laneA", "laneB", "laneC"] },
                            { op: "matchHeight", ids: ["laneA", "laneB", "laneC"] }
                        ]
                    }
                }),
                "Example blocker response:",
                JSON.stringify({
                    message: "I could not resolve which objects should be aligned.",
                    patch: null
                }),
                "Required response schema:",
                JSON.stringify(makeSchema())
            ].join("\n");
        }

        async function ensureSkillText() {
            if (state.skillText) return state.skillText;
            try {
                const response = await fetch("TBSpec.MD");
                if (response.ok) {
                    const text = await response.text();
                    state.skillText = text.slice(0, 24000);
                }
            } catch (err) {}
            return state.skillText;
        }

        function addSelectedPick(kind) {
            const selected = options.getSelected ? options.getSelected() : null;
            if (!selected) return;
            if (kind === "step") {
                if (state.picks.steps.indexOf(selected.id) < 0) state.picks.steps.push(selected.id);
            } else if (kind === "target") {
                state.picks.target = selected.id;
            } else if (kind === "stepLamp") {
                if (state.picks.stepLamps.indexOf(selected.id) < 0) state.picks.stepLamps.push(selected.id);
            } else if (kind === "targetLamp") {
                state.picks.targetLamp = selected.id;
            }
            refresh("inspector");
        }

        function removePick(kind, id) {
            if (kind === "step") {
                state.picks.steps = state.picks.steps.filter(function keep(entry) { return entry !== id; });
            } else if (kind === "target") {
                state.picks.target = "";
            } else if (kind === "stepLamp") {
                state.picks.stepLamps = state.picks.stepLamps.filter(function keep(entry) { return entry !== id; });
            } else if (kind === "targetLamp") {
                state.picks.targetLamp = "";
            }
            refresh("inspector");
        }

        function clearPicks() {
            state.picks = clone(DEFAULT_PICKS);
            refresh("inspector");
        }

        function addSelectedLayoutPick() {
            const selected = options.getSelected ? options.getSelected() : null;
            if (!selected) return;
            if (state.layoutPicks.indexOf(selected.id) < 0) state.layoutPicks.push(selected.id);
            refresh("inspector");
        }

        function removeLayoutPick(id) {
            state.layoutPicks = state.layoutPicks.filter(function keep(entry) { return entry !== id; });
            refresh("inspector");
        }

        function clearLayoutPicks() {
            state.layoutPicks = clone(DEFAULT_LAYOUT_PICKS);
            refresh("inspector");
        }

        /**
         * Post a chat completion request to the configured provider.
         * Why: both assistant passes share the same transport, but only the
         * first pass should expose tools.
         */
        async function postChat(messages, tools, temperature, extraOptions) {
            const baseUrl = stripTrailingSlash(state.settings.baseUrl || "");
            if (!baseUrl) throw new Error("Assistant base URL is not configured.");
            if (!state.settings.model) throw new Error("Assistant model is not configured.");
            const payload = {
                model: state.settings.model,
                messages: messages,
                temperature: typeof temperature === "number" ? temperature : 0.2
            };
            if (Array.isArray(tools) && tools.length) {
                payload.tools = tools;
                payload.tool_choice = "auto";
            }
            Object.assign(payload, extraOptions || {});
            const response = await fetchJson(baseUrl + "/chat/completions", payload);
            return response;
        }

        async function fetchJson(url, body) {
            const headers = { "Content-Type": "application/json" };
            if (state.settings.apiKey) headers.Authorization = "Bearer " + state.settings.apiKey;
            const response = await fetch(url, {
                method: body ? "POST" : "GET",
                headers: headers,
                body: body ? JSON.stringify(body) : undefined
            });
            if (!response.ok) {
                const text = await response.text();
                throw new Error("Assistant request failed (" + response.status + "): " + text);
            }
            return response.json();
        }

        async function loadModels() {
            const baseUrl = stripTrailingSlash(state.settings.baseUrl || "");
            if (!baseUrl) throw new Error("Assistant base URL is not configured.");
            const payload = await fetchJson(baseUrl + "/models");
            const items = Array.isArray(payload && payload.data) ? payload.data : [];
            state.availableModels = items.map(function map(item) {
                return {
                    id: item.id,
                    label: item.id
                };
            });
            if (!state.settings.model && state.availableModels[0]) {
                state.settings.model = state.availableModels[0].id;
                persistSettings();
            }
            logEntry("provider.models", {
                baseUrl: baseUrl,
                count: state.availableModels.length,
                models: state.availableModels.map(function map(item) { return item.id; })
            });
            refresh("inspector");
            return state.availableModels;
        }

        async function testConnection() {
            state.connectionStatus = "Testing...";
            state.error = "";
            refresh("inspector");
            try {
                const models = await loadModels();
                state.connectionStatus = models.length ?
                    ("Connected: " + models.length + " model" + (models.length === 1 ? "" : "s")) :
                    "Connected: no models returned";
                logEntry("provider.test.ok", {
                    baseUrl: stripTrailingSlash(state.settings.baseUrl || ""),
                    model: state.settings.model || "",
                    status: state.connectionStatus
                });
            } catch (err) {
                state.connectionStatus = "Connection failed";
                state.error = err && err.message ? err.message : String(err);
                logEntry("provider.test.error", state.error);
            }
            refresh("inspector");
        }

        /**
         * Run the first assistant pass.
         * Why: let the model inspect the current table with tools and produce a
         * compact working answer before we ask for strict JSON.
         */
        async function runAgent(userText) {
            await ensureSkillText();
            const tools = buildTools();
            const apiMessages = [
                { role: "system", content: buildSystemPrompt() },
                { role: "system", content: "Current editor context:\n" + JSON.stringify(makeContextSummary(), null, 2) },
                {
                    role: "system",
                    content: [
                        "For edit requests, answer as short working notes.",
                        "Prefer this shape:",
                        "Target ids: id1, id2",
                        "Intended operations: op1, op2",
                        "Blocker: <only if needed>",
                        "No tutorial prose. No replacement JSON. No coordinate math unless the edit truly requires patchElements."
                    ].join("\n")
                }
            ];
            state.messages.forEach(function each(message) {
                apiMessages.push({ role: message.role, content: message.content });
            });
            apiMessages.push({ role: "user", content: userText });
            logEntry("pass1.request", {
                model: state.settings.model,
                maxSteps: Math.max(1, Number(state.settings.maxSteps) || 4),
                userText: userText
            });

            for (let step = 0; step < Math.max(1, Number(state.settings.maxSteps) || 4); step++) {
                const payload = await postChat(apiMessages, tools, 0.2);
                const choice = payload && payload.choices && payload.choices[0] ? payload.choices[0] : null;
                const assistantMessage = choice && choice.message ? choice.message : null;
                if (!assistantMessage) throw new Error("Assistant returned no message.");
                if (assistantMessage.tool_calls && assistantMessage.tool_calls.length) {
                    logEntry("pass1.toolCalls", assistantMessage.tool_calls.map(function map(call) {
                        return {
                            id: call.id,
                            name: call.function && call.function.name,
                            arguments: call.function && call.function.arguments
                        };
                    }));
                    apiMessages.push({
                        role: "assistant",
                        content: assistantMessage.content || "",
                        tool_calls: assistantMessage.tool_calls
                    });
                    for (let i = 0; i < assistantMessage.tool_calls.length; i++) {
                        const toolCall = assistantMessage.tool_calls[i];
                        const rawArgs = toolCall.function && toolCall.function.arguments ? toolCall.function.arguments : "{}";
                        let args = {};
                        try { args = JSON.parse(rawArgs); } catch (err) {}
                        const result = executeToolCall(toolCall.function.name, args || {});
                        logEntry("pass1.toolResult", {
                            name: toolCall.function.name,
                            args: args || {},
                            result: result
                        });
                        apiMessages.push({
                            role: "tool",
                            tool_call_id: toolCall.id,
                            content: JSON.stringify(result)
                        });
                    }
                    continue;
                }
                logEntry("pass1.response", assistantMessage.content || "");
                return normalizeResponseContent(assistantMessage.content) || "";
            }
            throw new Error("Assistant exceeded tool step limit.");
        }

        /**
         * Run the second assistant pass.
         * Why: convert the first-pass working answer into the supported patch
         * schema with strict JSON output and no tool use.
         */
        async function extractStructuredResponse(userText, firstPassText) {
            const context = makeContextSummary();
            const messages = [
                { role: "system", content: buildExtractionPrompt() },
                { role: "system", content: "Current editor context:\n" + JSON.stringify(context, null, 2) },
                { role: "user", content: "Original user request:\n" + userText },
                { role: "user", content: "Assistant working output to normalize:\n" + firstPassText }
            ];
            logEntry("pass2.request", {
                userText: userText,
                firstPassText: firstPassText
            });
            let payload;
            try {
                payload = await postChat(messages, null, 0, {
                    response_format: {
                        type: "json_schema",
                        json_schema: {
                            name: "assistant_patch_response",
                            strict: true,
                            schema: makeSchema()
                        }
                    }
                });
            } catch (err) {
                logEntry("pass2.responseFormatFallback", err && err.message ? err.message : String(err));
                payload = await postChat(messages, null, 0);
            }
            const choice = payload && payload.choices && payload.choices[0] ? payload.choices[0] : null;
            const assistantMessage = choice && choice.message ? choice.message : null;
            if (!assistantMessage) throw new Error("Assistant extraction pass returned no message.");
            logEntry("pass2.response", assistantMessage.content || "");
            return normalizeResponseContent(assistantMessage.content);
        }

        function normalizePatchCandidate(result) {
            if (!result) return { message: "No response.", patch: null, error: "" };
            if (result && result.patch && typeof result.message === "string") {
                return validateStructuredPatch(result);
            }
            if (result && result.type && Array.isArray(result.operations)) {
                return validateStructuredPatch({ message: "Patch extracted.", patch: result });
            }
            if (result && typeof result.message === "string") {
                return { message: result.message, patch: null, error: "" };
            }
            return { message: "No response.", patch: null, error: "" };
        }

        function validateStructuredPatch(result) {
            const patch = result.patch;
            if (!patch || typeof patch !== "object" || !Array.isArray(patch.operations)) {
                return { message: result.message || "Unsupported patch.", patch: null, error: "Assistant patch is not in the supported structured format." };
            }
            const allowed = {
                addSequenceRule: true,
                updateSequenceRule: true,
                deleteSequenceRule: true,
                addSwitchMap: true,
                updateSwitchMap: true,
                deleteSwitchMap: true,
                addVariable: true,
                updateVariable: true,
                deleteVariable: true,
                addTrigger: true,
                updateTrigger: true,
                deleteTrigger: true,
                alignHorizontal: true,
                distributeHorizontal: true,
                matchWidth: true,
                matchHeight: true,
                patchElements: true
            };
            for (let i = 0; i < patch.operations.length; i++) {
                const operation = patch.operations[i] || {};
                if (!allowed[operation.op]) {
                    return {
                        message: result.message || "Unsupported patch.",
                        patch: null,
                        error: "Assistant returned unsupported operation: " + operation.op
                    };
                }
            }
            return { message: result.message || "Patch ready.", patch: patch, error: "" };
        }

        async function send() {
            const text = (state.draft || "").trim();
            if (!text || state.busy) return;
            return sendPrompt(text, true);
        }

        /**
         * Send one user prompt through the two-pass assistant pipeline.
         * Why: the visible chat stays simple, while patch shaping is isolated to
         * the strict extraction pass.
         */
        async function sendPrompt(text, consumeDraft) {
            if (!text || state.busy) return;
            state.busy = true;
            state.error = "";
            state.lastPatch = null;
            state.messages.push({ role: "user", content: text });
            logEntry("send.start", {
                text: text,
                selection: (options.getSelected && options.getSelected()) ? options.getSelected().id : "",
                selectedRule: (options.getSelectedRule && options.getSelectedRule()) ? options.getSelectedRule().id : ""
            });
            if (consumeDraft) state.draft = "";
            refresh("inspector");
            try {
                const firstPassText = await runAgent(text);
                const extractedText = await extractStructuredResponse(text, firstPassText);
                const extractedResult = tryParseJson(extractedText);
                logEntry("pass2.parse", extractedResult ? { ok: true } : { ok: false, extractedText: extractedText });
                const result = extractedResult ?
                    normalizePatchCandidate(extractedResult) :
                    {
                        message: "Assistant returned an invalid structured response.",
                        patch: null,
                        error: extractedText ? "Assistant extraction did not return valid JSON." : "Assistant extraction returned no content."
                    };
                logEntry("patch.result", {
                    message: result.message,
                    hasPatch: !!(result && result.patch),
                    error: result.error || ""
                });
                const assistantText = result && typeof result.message === "string" ? result.message : "No response.";
                state.lastPatch = result && result.patch ? result.patch : null;
                if (result && result.error) state.error = result.error;
                state.messages.push({ role: "assistant", content: assistantText });
            } catch (err) {
                state.error = err && err.message ? err.message : String(err);
                logEntry("send.error", state.error);
            } finally {
                state.busy = false;
                refresh("inspector");
            }
        }

        function quickPrompt(kind) {
            const selected = options.getSelected ? options.getSelected() : null;
            const selectedRule = options.getSelectedRule ? options.getSelectedRule() : null;
            const validation = options.getValidationIssues ? options.getValidationIssues() : [];
            if (kind === "build-selection") {
                const target = selected ? (selected.name || selected.id) : "the current table";
                return sendPrompt(
                    "Inspect the current selection context and nearby elements. Help me build a simple playable logic sequence around " +
                    target +
                    ". Prefer an ordered sequence when it makes sense, use existing lights if available, and return a structured patch only if the references are valid.",
                    false
                );
            }
            if (kind === "build-picked-sequence") {
                return sendPrompt(
                    "Use the explicit picked context to build one sequence rule. Treat picked steps as the sequence steps in their current order, picked target as the timed target, picked step lamps as the step lamps in order, and picked target lamp as the target lamp. If the picked context is incomplete, explain exactly what is missing instead of guessing. Return a structured patch only when the references are valid.",
                    false
                );
            }
            if (kind === "layout-picked-objects") {
                return sendPrompt(
                    "Use the explicit layout picks to satisfy the layout request. If the user asked for horizontal alignment or same size, use the layout patch operations rather than prose. Only operate on the picked layout objects. If there are fewer than two layout picks, explain that briefly instead of guessing.",
                    false
                );
            }
            if (kind === "explain-validation") {
                return sendPrompt(
                    "Inspect the current validation issues and explain the most important ones in practical terms. If there is a safe structured patch that improves the logic setup, include it.",
                    false
                );
            }
            if (kind === "improve-rule") {
                const ruleTarget = selectedRule ? (selectedRule.name || selectedRule.id) : "the current logic setup";
                return sendPrompt(
                    "Inspect " + ruleTarget + " and suggest a cleaner or more complete sequence setup using the current table objects and lamps. If a concrete improvement is possible, return a structured patch.",
                    false
                );
            }
        }

        function applyLastPatch() {
            if (!state.lastPatch || !options.applyPatch) return { ok: false, message: "No patch to apply." };
            const result = options.applyPatch(state.lastPatch);
            if (result && result.ok) {
                state.messages.push({
                    role: "assistant",
                    content: "Applied patch: " + (state.lastPatch.description || state.lastPatch.type || "changes")
                });
                state.lastPatch = null;
            } else if (result && result.message) {
                state.error = result.message;
            }
            refresh("inspector");
            return result;
        }

        return {
            getState: snapshot,
            setSettings: setSettings,
            setDraft: setDraft,
            clearConversation: clearConversation,
            addSelectedPick: addSelectedPick,
            removePick: removePick,
            clearPicks: clearPicks,
            addSelectedLayoutPick: addSelectedLayoutPick,
            removeLayoutPick: removeLayoutPick,
            clearLayoutPicks: clearLayoutPicks,
            loadModels: loadModels,
            testConnection: testConnection,
            send: send,
            quickPrompt: quickPrompt,
            applyLastPatch: applyLastPatch,
            openLog: openLog,
            closeLog: closeLog,
            clearLog: clearLog
        };
    }

    Pin.editorAssistant = {
        create: create
    };
})(window.Pin);
