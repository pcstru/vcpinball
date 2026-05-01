(function initEditorRulesLogic(Pin) {
    function createRulesLogic(options) {
        const state = options.state;
        const pushUndo = options.pushUndo;
        const markTableDirty = options.markTableDirty;
        const refresh = options.refresh;
        const makeRuleId = options.makeRuleId;
        const normalizeInput = options.normalizeInput;
        const ensureRulesEngine = options.ensureRulesEngine;
        const getLogicGraphs = options.getLogicGraphs;
        const getSelectedGraph = options.getSelectedGraph;
        const getSelectedGraphNode = options.getSelectedGraphNode;
        const getSelected = options.getSelected;
        const getElementById = options.getElementById;
        const firstSwitchElementId = options.firstSwitchElementId;
        const setSelectedId = options.setSelectedId;
        const setSelectedRuleId = options.setSelectedRuleId;
        const setSelectedLogicNode = options.setSelectedLogicNode;
        const setSelectedGraphId = options.setSelectedGraphId;
        const setSelectedGraphNodeId = options.setSelectedGraphNodeId;
        const getPendingEdgeSourceNodeId = options.getPendingEdgeSourceNodeId;
        const setPendingEdgeSourceNodeId = options.setPendingEdgeSourceNodeId;
        const setInspectorTab = options.setInspectorTab;

        function applyNormalizedPatch(target, patch, normalizer) {
            Object.keys(patch || {}).forEach(function each(key) {
                const value = patch[key];
                if (Array.isArray(value)) {
                    target[key] = Pin.editorTools.clone(value);
                    return;
                }
                if (value && typeof value === "object") {
                    if (!target[key] || typeof target[key] !== "object" || Array.isArray(target[key])) target[key] = {};
                    applyNormalizedPatch(target[key], value, normalizer);
                    return;
                }
                target[key] = normalizer ? normalizer(key, value) : normalizeInput(value);
            });
        }

        function syncRulesFromGraphs() {
            if (Pin.ruleGraph && Pin.ruleGraph.syncRuleGraphs) Pin.ruleGraph.syncRuleGraphs(state.table);
            const graph = getSelectedGraph();
            if (graph) setSelectedRuleId(graph.sourceRuleId || null);
        }

        function rebuildGraphsFromRules() {
            const rules = ensureRulesEngine();
            if (Pin.ruleGraph && Pin.ruleGraph.syncGraphsFromSequenceRules) {
                rules.logicGraphs = Pin.ruleGraph.syncGraphsFromSequenceRules(state.table);
            } else if (Pin.ruleGraph && Pin.ruleGraph.deriveGraphsFromSequenceRules) {
                rules.logicGraphs = Pin.ruleGraph.deriveGraphsFromSequenceRules(state.table);
            }
            const graph = getSelectedGraph();
            if (graph) setSelectedRuleId(graph.sourceRuleId || null);
        }

        function normalizeRuleValue(key, value) {
            if (key === "steps" || key === "stepLampIds") {
                return String(value || "").split(",").map(function trim(part) { return part.trim(); }).filter(Boolean);
            }
            return normalizeInput(value);
        }

        function graphNodePosition(graph) {
            const nodes = (graph && graph.nodes) || [];
            const selected = getSelectedGraphNode();
            if (selected && graph && selected.id && graph.id === options.getSelectedGraphId()) {
                return { x: (selected.x || 220) + 170, y: selected.y || 120 };
            }
            const pendingEdgeSourceNodeId = getPendingEdgeSourceNodeId();
            if (pendingEdgeSourceNodeId) {
                const source = nodes.find(function find(node) { return node.id === pendingEdgeSourceNodeId; });
                if (source) return { x: (source.x || 220) + 170, y: source.y || 120 };
            }
            if (nodes.length) {
                const rightmost = nodes.reduce(function reduce(max, node) {
                    if (!max) return node;
                    return (node.x || 0) > (max.x || 0) ? node : max;
                }, null);
                return {
                    x: (rightmost ? (rightmost.x || 220) : 220) + 170,
                    y: rightmost ? (rightmost.y || 120) : 120
                };
            }
            return { x: 220, y: 120 };
        }

        function markLogicEdgeSource(nodeId) {
            setPendingEdgeSourceNodeId(nodeId || null);
            refresh("all");
        }

        function connectLogicNodes(graphId, fromNodeId, toNodeId) {
            const graph = getLogicGraphs().find(function find(item) { return item.id === graphId; });
            if (!graph || !fromNodeId || !toNodeId) return;
            pushUndo();
            if (Pin.ruleGraph && Pin.ruleGraph.addEdge) {
                Pin.ruleGraph.addEdge(graph, fromNodeId, toNodeId);
            } else {
                graph.edges = graph.edges || [];
                graph.edges.push({ id: "edge_" + makeRuleId(), from: fromNodeId, to: toNodeId });
            }
            syncRulesFromGraphs();
            setSelectedGraphId(graph.id);
            setSelectedRuleId(graph.sourceRuleId || null);
            setSelectedGraphNodeId(toNodeId);
            setSelectedLogicNode(toNodeId);
            setInspectorTab("logic");
            markTableDirty();
            refresh("all");
        }

        function addLogicNode(graphId, type, props) {
            const graph = getLogicGraphs().find(function find(item) { return item.id === graphId; });
            if (!graph || !type) return;
            pushUndo();
            const node = Pin.ruleGraph && Pin.ruleGraph.appendGraphNode ?
                Pin.ruleGraph.appendGraphNode(graph, type, graphNodePosition(graph), props || {}) :
                null;
            if (!node) return;
            syncRulesFromGraphs();
            setSelectedGraphId(graph.id);
            setSelectedRuleId(graph.sourceRuleId || null);
            setSelectedGraphNodeId(node.id);
            setSelectedLogicNode(node.id);
            setInspectorTab("logic");
            markTableDirty();
            refresh("all");
        }

        function applyElementToGraphNode(graphNode, selected) {
            if (!selected || !graphNode) return;
            if ((graphNode.type === "switchStep" || graphNode.type === "timedTarget") && selected.type === "light") {
                graphNode.lampId = selected.lampId || selected.id;
            } else if (graphNode.type === "switchStep" || graphNode.type === "timedTarget") {
                graphNode.switchId = selected.id;
            } else if (graphNode.type === "event") {
                graphNode.sourceId = selected.id;
                if (!graphNode.eventType) graphNode.eventType = selected.type === "light" ? "lamp" : "switchClosed";
            } else if (graphNode.type === "action") {
                graphNode.targetId = selected.id;
            } else if (graphNode.type === "lamp" && selected.type === "light") {
                graphNode.lampId = selected.lampId || selected.id;
            } else if (graphNode.type === "lamp" && selected.type !== "light") {
                graphNode.lampId = selected.id;
            }
        }

        function assignElementToLogicNode(node, selected) {
            if (!selected || !node || !node.id) return;
            const graph = getSelectedGraph();
            if (!graph) return;
            const graphNode = (graph.nodes || []).find(function find(item) { return item.id === node.id; });
            if (!graphNode) return;

            pushUndo();
            applyElementToGraphNode(graphNode, selected);
            syncRulesFromGraphs();
            setPendingEdgeSourceNodeId(null);
            setSelectedGraphId(graph.id);
            setSelectedRuleId(graph.sourceRuleId || null);
            setSelectedGraphNodeId(node.id);
            setSelectedLogicNode(node.id);
            setInspectorTab("logic");
            markTableDirty();
            refresh("all");
        }

        function assignSelectedToLogicNode(node) {
            assignElementToLogicNode(node, getSelected());
        }

        function assignElementIdToLogicNode(node, elementId) {
            assignElementToLogicNode(node, getElementById ? getElementById(elementId) : null);
        }

        function addSequenceRule() {
            pushUndo();
            const rules = ensureRulesEngine();
            const nextNumber = (rules.logicGraphs || []).length + 1;
            const firstSwitch = firstSwitchElementId();
            const graph = Pin.ruleGraph && Pin.ruleGraph.createGraph ?
                Pin.ruleGraph.createGraph("Sequence " + nextNumber, {
                    sourceRuleId: makeRuleId(),
                    enabled: true,
                    ordered: true
                }) : {
                    id: "graph_" + makeRuleId(),
                    sourceRuleId: makeRuleId(),
                    name: "Sequence " + nextNumber,
                    enabled: true,
                    ordered: true,
                    nodes: [],
                    edges: []
                };
            const startNode = Pin.ruleGraph && Pin.ruleGraph.addNode ?
                Pin.ruleGraph.addNode(graph, "start", { x: 60, y: 120 }, { label: "Start" }) :
                { id: "start_" + makeRuleId(), type: "start", x: 60, y: 120, label: "Start" };
            const stepNode = Pin.ruleGraph && Pin.ruleGraph.addNode ?
                Pin.ruleGraph.addNode(graph, "switchStep", { x: 220, y: 120 }, { switchId: firstSwitch || "", lampId: "" }) :
                { id: "step_" + makeRuleId(), type: "switchStep", x: 220, y: 120, switchId: firstSwitch || "", lampId: "" };
            const targetNode = Pin.ruleGraph && Pin.ruleGraph.addNode ?
                Pin.ruleGraph.addNode(graph, "timedTarget", { x: 390, y: 120 }, { switchId: "", lampId: "", windowSeconds: 8 }) :
                { id: "target_" + makeRuleId(), type: "timedTarget", x: 390, y: 120, switchId: "", lampId: "", windowSeconds: 8 };
            const awardNode = Pin.ruleGraph && Pin.ruleGraph.addNode ?
                Pin.ruleGraph.addNode(graph, "award", { x: 560, y: 120 }, { awardPoints: 1000, awardEvent: "ruleAwarded" }) :
                { id: "award_" + makeRuleId(), type: "award", x: 560, y: 120, awardPoints: 1000, awardEvent: "ruleAwarded" };
            const resetNode = Pin.ruleGraph && Pin.ruleGraph.addNode ?
                Pin.ruleGraph.addNode(graph, "reset", { x: 730, y: 120 }, { resetOnDrain: true, resetOnComplete: true, resetOnWrongOrder: false }) :
                { id: "reset_" + makeRuleId(), type: "reset", x: 730, y: 120, resetOnDrain: true, resetOnComplete: true, resetOnWrongOrder: false };
            if (Pin.ruleGraph && Pin.ruleGraph.addEdge) {
                Pin.ruleGraph.addEdge(graph, startNode.id, stepNode.id);
                Pin.ruleGraph.addEdge(graph, stepNode.id, targetNode.id);
                Pin.ruleGraph.addEdge(graph, targetNode.id, awardNode.id);
                Pin.ruleGraph.addEdge(graph, awardNode.id, resetNode.id);
            } else {
                graph.nodes = [startNode, stepNode, targetNode, awardNode, resetNode];
                graph.edges = [
                    { id: "edge_" + makeRuleId(), from: startNode.id, to: stepNode.id },
                    { id: "edge_" + makeRuleId(), from: stepNode.id, to: targetNode.id },
                    { id: "edge_" + makeRuleId(), from: targetNode.id, to: awardNode.id }
                ];
            }
            rules.logicGraphs.push(graph);
            syncRulesFromGraphs();
            setSelectedGraphId(graph.id);
            setSelectedRuleId(graph.sourceRuleId);
            setSelectedGraphNodeId(stepNode.id);
            setSelectedLogicNode(stepNode.id);
            if (firstSwitch) setSelectedId(firstSwitch);
            setPendingEdgeSourceNodeId(null);
            setInspectorTab("logic");
            markTableDirty();
            refresh("all");
        }

        function addLogicStep(graphId) {
            const rules = ensureRulesEngine();
            const graph = (rules.logicGraphs || []).find(function find(item) { return item.id === graphId; });
            if (!graph) return;
            pushUndo();
            const node = Pin.ruleGraph && Pin.ruleGraph.appendStepNode ? Pin.ruleGraph.appendStepNode(graph) : null;
            syncRulesFromGraphs();
            setSelectedGraphId(graph.id);
            setSelectedRuleId(graph.sourceRuleId || null);
            setSelectedGraphNodeId(node ? node.id : null);
            setSelectedLogicNode(node ? node.id : null);
            setInspectorTab("logic");
            markTableDirty();
            refresh("all");
        }

        function deleteGraphEdge(graphId, edgeId) {
            const graph = getLogicGraphs().find(function find(item) { return item.id === graphId; });
            if (!graph || !edgeId) return;
            pushUndo();
            if (Pin.ruleGraph && Pin.ruleGraph.removeEdge) {
                Pin.ruleGraph.removeEdge(graph, edgeId);
            } else {
                graph.edges = (graph.edges || []).filter(function keep(edge) { return edge.id !== edgeId; });
            }
            syncRulesFromGraphs();
            markTableDirty();
            refresh("all");
        }

        function patchGraphNode(graphId, nodeId, key, value) {
            const graph = getLogicGraphs().find(function find(item) { return item.id === graphId; });
            if (!graph) return;
            const node = (graph.nodes || []).find(function findNode(item) { return item.id === nodeId; });
            if (!node) return;
            pushUndo();
            node[key] = normalizeInput(value);
            syncRulesFromGraphs();
            setSelectedGraphId(graphId);
            setSelectedGraphNodeId(nodeId);
            setSelectedLogicNode(nodeId);
            markTableDirty();
            refresh("all");
        }

        function patchGraphNodeFields(graphId, nodeId, patch) {
            const graph = getLogicGraphs().find(function find(item) { return item.id === graphId; });
            if (!graph) return;
            const node = (graph.nodes || []).find(function findNode(item) { return item.id === nodeId; });
            if (!node) return;
            pushUndo();
            applyNormalizedPatch(node, patch || {});
            syncRulesFromGraphs();
            setSelectedGraphId(graphId);
            setSelectedGraphNodeId(nodeId);
            setSelectedLogicNode(nodeId);
            markTableDirty();
            refresh("all");
        }

        function moveGraphNode(graphId, nodeId, x, y) {
            const graph = getLogicGraphs().find(function find(item) { return item.id === graphId; });
            if (!graph) return;
            const node = (graph.nodes || []).find(function findNode(item) { return item.id === nodeId; });
            if (!node) return;
            pushUndo();
            node.x = normalizeInput(x);
            node.y = normalizeInput(y);
            setSelectedGraphId(graphId);
            setSelectedGraphNodeId(nodeId);
            setSelectedLogicNode(nodeId);
            markTableDirty();
            refresh("all");
        }

        function deleteGraphNode(graphId, nodeId) {
            const graph = getLogicGraphs().find(function find(item) { return item.id === graphId; });
            if (!graph) return;
            const node = (graph.nodes || []).find(function findNode(item) { return item.id === nodeId; });
            if (!node || node.type === "start" || node.type === "award" || node.type === "reset") return;
            pushUndo();
            if (Pin.ruleGraph && Pin.ruleGraph.removeNode) {
                Pin.ruleGraph.removeNode(graph, nodeId);
            } else {
                graph.nodes = (graph.nodes || []).filter(function keep(item) { return item.id !== nodeId; });
                graph.edges = (graph.edges || []).filter(function keep(edge) { return edge.from !== nodeId && edge.to !== nodeId; });
            }
            if (getPendingEdgeSourceNodeId() === nodeId) setPendingEdgeSourceNodeId(null);
            syncRulesFromGraphs();
            setSelectedGraphNodeId(null);
            setSelectedLogicNode(null);
            markTableDirty();
            refresh("all");
        }

        function patchRule(id, key, value) {
            const rules = ensureRulesEngine();
            const rule = rules.sequenceRules.find(function find(item) { return item.id === id; });
            if (!rule) return;
            pushUndo();
            rule[key] = normalizeRuleValue(key, value);
            if (key === "id") setSelectedRuleId(rule.id);
            rebuildGraphsFromRules();
            markTableDirty();
            refresh("all");
        }

        function patchRuleFields(id, patch) {
            const rules = ensureRulesEngine();
            const rule = rules.sequenceRules.find(function find(item) { return item.id === id; });
            if (!rule) return;
            pushUndo();
            applyNormalizedPatch(rule, patch || {}, normalizeRuleValue);
            if (patch && Object.prototype.hasOwnProperty.call(patch, "id")) setSelectedRuleId(rule.id);
            rebuildGraphsFromRules();
            markTableDirty();
            refresh("all");
        }

        function duplicateRule(id) {
            const rules = ensureRulesEngine();
            const rule = rules.sequenceRules.find(function find(item) { return item.id === id; });
            if (!rule) return;
            pushUndo();
            const copy = Pin.editorTools.clone(rule);
            copy.id = makeRuleId();
            copy.name = (copy.name || "Sequence") + " Copy";
            rules.sequenceRules.push(copy);
            setSelectedRuleId(copy.id);
            rebuildGraphsFromRules();
            markTableDirty();
            refresh("all");
        }

        function deleteRule(id) {
            const rules = ensureRulesEngine();
            let resolvedId = id || "";
            const matchedGraph = (rules.logicGraphs || []).find(function find(item) {
                return item && (item.id === id || item.sourceRuleId === id);
            }) || null;
            if (matchedGraph && matchedGraph.sourceRuleId) resolvedId = matchedGraph.sourceRuleId;
            const index = rules.sequenceRules.findIndex(function find(item) { return item.id === resolvedId; });
            if (index < 0) return;
            pushUndo();
            rules.sequenceRules.splice(index, 1);
            if (matchedGraph) {
                rules.logicGraphs = (rules.logicGraphs || []).filter(function keep(graph) {
                    return graph !== matchedGraph && graph.id !== matchedGraph.id && graph.sourceRuleId !== resolvedId;
                });
            }
            const nextRule = rules.sequenceRules[0] || null;
            setSelectedRuleId(nextRule ? nextRule.id : null);
            if (!nextRule) {
                setSelectedGraphId(null);
                setSelectedGraphNodeId(null);
                setSelectedLogicNode(null);
                setPendingEdgeSourceNodeId(null);
            }
            rebuildGraphsFromRules();
            if (nextRule) {
                const nextGraph = (getLogicGraphs() || []).find(function find(graph) { return graph && graph.sourceRuleId === nextRule.id; }) || null;
                setSelectedGraphId(nextGraph ? nextGraph.id : null);
                setSelectedGraphNodeId(null);
                setSelectedLogicNode(null);
                setPendingEdgeSourceNodeId(null);
            }
            if (!nextRule) setInspectorTab("logic");
            markTableDirty();
            refresh("all");
        }

        function addSwitchMap() {
            pushUndo();
            const firstSwitchElement = (state.table.elements || []).find(function find(el) {
                return el && el.id && ["lane", "scoreZone", "spinner", "gate", "valve", "drain", "launcher", "dropTarget"].indexOf(el.type) >= 0;
            });
            const sourceId = firstSwitchElement ? firstSwitchElement.id : "";
            ensureRulesEngine().switchMap.push({ eventType: "switchClosed", sourceId: sourceId, switchId: sourceId });
            setInspectorTab("rules");
            markTableDirty();
            refresh("all");
        }

        function patchSwitchMap(index, key, value) {
            const rules = ensureRulesEngine();
            if (!rules.switchMap[index]) return;
            pushUndo();
            rules.switchMap[index][key] = normalizeInput(value);
            markTableDirty();
            refresh("all");
        }

        function patchSwitchMapFields(index, patch) {
            const rules = ensureRulesEngine();
            if (!rules.switchMap[index]) return;
            pushUndo();
            applyNormalizedPatch(rules.switchMap[index], patch || {});
            markTableDirty();
            refresh("all");
        }

        function removeSwitchMap(index) {
            const rules = ensureRulesEngine();
            if (!rules.switchMap[index]) return;
            pushUndo();
            rules.switchMap.splice(index, 1);
            markTableDirty();
            refresh("all");
        }

        function addVariable() {
            const rules = ensureRulesEngine();
            pushUndo();
            const next = (rules.variables || []).length + 1;
            rules.variables.push({ id: "var_" + next, name: "Variable " + next, properties: { value: false } });
            setInspectorTab("logic");
            markTableDirty();
            refresh("all");
        }

        function patchVariableFields(index, patch) {
            const rules = ensureRulesEngine();
            if (!rules.variables[index]) return;
            pushUndo();
            applyNormalizedPatch(rules.variables[index], patch || {});
            if (!rules.variables[index].properties || typeof rules.variables[index].properties !== "object") {
                rules.variables[index].properties = { value: false };
            }
            markTableDirty();
            refresh("all");
        }

        function removeVariable(index) {
            const rules = ensureRulesEngine();
            if (!rules.variables[index]) return;
            pushUndo();
            rules.variables.splice(index, 1);
            markTableDirty();
            refresh("all");
        }

        function addTrigger() {
            const rules = ensureRulesEngine();
            pushUndo();
            const next = (rules.triggers || []).length + 1;
            rules.triggers.push({ id: "timer_" + next, type: "interval", everySeconds: 1, switchId: "tick." + next, enabled: true });
            setInspectorTab("logic");
            markTableDirty();
            refresh("all");
        }

        function patchTriggerFields(index, patch) {
            const rules = ensureRulesEngine();
            if (!rules.triggers[index]) return;
            pushUndo();
            applyNormalizedPatch(rules.triggers[index], patch || {});
            markTableDirty();
            refresh("all");
        }

        function removeTrigger(index) {
            const rules = ensureRulesEngine();
            if (!rules.triggers[index]) return;
            pushUndo();
            rules.triggers.splice(index, 1);
            markTableDirty();
            refresh("all");
        }

        function getElementsByIds(ids) {
            return (ids || []).map(function map(id) {
                return (state.table.elements || []).find(function find(element) { return element && element.id === id; }) || null;
            }).filter(Boolean);
        }

        function applyAlignHorizontal(ids) {
            const elements = getElementsByIds(ids).filter(function keep(element) {
                return typeof element.y === "number";
            });
            if (elements.length < 2) return { ok: false, message: "Need at least two positioned elements to align horizontally." };
            const avgY = elements.reduce(function reduce(sum, element) { return sum + element.y; }, 0) / elements.length;
            elements.forEach(function each(element) {
                element.y = avgY;
            });
            return { ok: true };
        }

        function applyDistributeHorizontal(ids) {
            const elements = getElementsByIds(ids).filter(function keep(element) {
                return typeof element.x === "number";
            }).sort(function sort(a, b) { return a.x - b.x; });
            if (elements.length < 3) return { ok: false, message: "Need at least three positioned elements to distribute horizontally." };
            const minX = elements[0].x;
            const maxX = elements[elements.length - 1].x;
            const step = (maxX - minX) / (elements.length - 1);
            elements.forEach(function each(element, index) {
                element.x = minX + step * index;
            });
            return { ok: true };
        }

        function applyMatchWidth(ids, value) {
            const elements = getElementsByIds(ids).filter(function keep(element) {
                return typeof element.w === "number";
            });
            if (elements.length < 2) return { ok: false, message: "Need at least two width-based elements to match width." };
            const width = typeof value === "number" ? value : (elements.reduce(function reduce(sum, element) { return sum + element.w; }, 0) / elements.length);
            elements.forEach(function each(element) {
                element.w = width;
            });
            return { ok: true };
        }

        function applyMatchHeight(ids, value) {
            const elements = getElementsByIds(ids).filter(function keep(element) {
                return typeof element.h === "number";
            });
            if (elements.length < 2) return { ok: false, message: "Need at least two height-based elements to match height." };
            const height = typeof value === "number" ? value : (elements.reduce(function reduce(sum, element) { return sum + element.h; }, 0) / elements.length);
            elements.forEach(function each(element) {
                element.h = height;
            });
            return { ok: true };
        }

        function normalizeElementPatchKey(key) {
            if (key === "baseScore") return "score";
            return key;
        }

        function applyElementPatch(target, patch) {
            Object.keys(patch || {}).forEach(function each(key) {
                const nextKey = normalizeElementPatchKey(key);
                const value = patch[key];
                if (Array.isArray(value)) {
                    target[nextKey] = Pin.editorTools.clone(value);
                    return;
                }
                if (value && typeof value === "object") {
                    if (!target[nextKey] || typeof target[nextKey] !== "object" || Array.isArray(target[nextKey])) target[nextKey] = {};
                    applyElementPatch(target[nextKey], value);
                    return;
                }
                target[nextKey] = normalizeInput(value);
            });
        }

        function applyPatchElements(operation) {
            const patches = operation.patches || ((operation.patch && operation.patch.patches) || []);
            if (!Array.isArray(patches) || !patches.length) {
                return { ok: false, message: "patchElements needs a non-empty patches list." };
            }
            for (let i = 0; i < patches.length; i++) {
                const entry = patches[i] || {};
                if (!entry.id) return { ok: false, message: "patchElements entry is missing id." };
                const element = getElementById(entry.id);
                if (!element) return { ok: false, message: "Unknown element id: " + entry.id };
                applyElementPatch(element, entry.patch || {});
            }
            return { ok: true };
        }

        function applyAssistantPatch(patch) {
            if (!patch || !Array.isArray(patch.operations) || !patch.operations.length) {
                return { ok: false, message: "Assistant patch has no operations." };
            }
            const originalTable = Pin.editorTools.clone(state.table);
            const originalUndoLength = state.undo.length;
            const rules = ensureRulesEngine();
            pushUndo();
            let selectedRule = null;
            function fail(result) {
                state.table = originalTable;
                state.undo.length = originalUndoLength;
                refresh("all");
                return result;
            }
            for (let i = 0; i < patch.operations.length; i++) {
                const operation = patch.operations[i] || {};
                if (operation.op === "addSequenceRule") {
                    const rule = Pin.editorTools.clone(operation.rule || {});
                    if (!rule.id) rule.id = makeRuleId();
                    if (!rule.name) rule.name = "Sequence";
                    if (!Array.isArray(rule.steps)) rule.steps = [];
                    if (!Array.isArray(rule.stepLampIds)) rule.stepLampIds = [];
                    if (typeof rule.enabled !== "boolean") rule.enabled = true;
                    if (typeof rule.ordered !== "boolean") rule.ordered = true;
                    if (typeof rule.resetOnDrain !== "boolean") rule.resetOnDrain = true;
                    if (typeof rule.resetOnComplete !== "boolean") rule.resetOnComplete = true;
                    if (typeof rule.resetOnWrongOrder !== "boolean") rule.resetOnWrongOrder = false;
                    rules.sequenceRules.push(rule);
                    selectedRule = rule.id;
                    continue;
                }
                if (operation.op === "updateSequenceRule") {
                    const rule = rules.sequenceRules.find(function find(item) { return item.id === operation.id; });
                    if (!rule) return fail({ ok: false, message: "Unknown rule id: " + operation.id });
                    applyNormalizedPatch(rule, operation.patch || {}, normalizeRuleValue);
                    selectedRule = rule.id;
                    continue;
                }
                if (operation.op === "deleteSequenceRule") {
                    const index = rules.sequenceRules.findIndex(function find(item) { return item.id === operation.id; });
                    if (index < 0) return fail({ ok: false, message: "Unknown rule id: " + operation.id });
                    rules.sequenceRules.splice(index, 1);
                    continue;
                }
                if (operation.op === "addSwitchMap") {
                    rules.switchMap.push(Pin.editorTools.clone(operation.mapping || {}));
                    continue;
                }
                if (operation.op === "updateSwitchMap") {
                    if (!rules.switchMap[operation.index]) return fail({ ok: false, message: "Unknown switch map index: " + operation.index });
                    applyNormalizedPatch(rules.switchMap[operation.index], operation.patch || {});
                    continue;
                }
                if (operation.op === "deleteSwitchMap") {
                    if (!rules.switchMap[operation.index]) return fail({ ok: false, message: "Unknown switch map index: " + operation.index });
                    rules.switchMap.splice(operation.index, 1);
                    continue;
                }
                if (operation.op === "addVariable") {
                    const variable = Pin.editorTools.clone(operation.variable || {});
                    if (!variable.id && !variable.name) variable.id = "var_" + ((rules.variables || []).length + 1);
                    if (!variable.properties || typeof variable.properties !== "object") variable.properties = { value: false };
                    rules.variables.push(variable);
                    continue;
                }
                if (operation.op === "updateVariable") {
                    const variable = (rules.variables || []).find(function find(item) {
                        return item && (item.id === operation.id || item.name === operation.id);
                    });
                    if (!variable) return fail({ ok: false, message: "Unknown variable id: " + operation.id });
                    applyNormalizedPatch(variable, operation.patch || {});
                    continue;
                }
                if (operation.op === "deleteVariable") {
                    const variableIndex = (rules.variables || []).findIndex(function find(item) {
                        return item && (item.id === operation.id || item.name === operation.id);
                    });
                    if (variableIndex < 0) return fail({ ok: false, message: "Unknown variable id: " + operation.id });
                    rules.variables.splice(variableIndex, 1);
                    continue;
                }
                if (operation.op === "addTrigger") {
                    const trigger = Pin.editorTools.clone(operation.trigger || {});
                    if (!trigger.id) trigger.id = "timer_" + ((rules.triggers || []).length + 1);
                    if (!trigger.type) trigger.type = "interval";
                    if (trigger.enabled !== false) trigger.enabled = true;
                    rules.triggers.push(trigger);
                    continue;
                }
                if (operation.op === "updateTrigger") {
                    const trigger = (rules.triggers || []).find(function find(item) { return item && item.id === operation.id; });
                    if (!trigger) return fail({ ok: false, message: "Unknown trigger id: " + operation.id });
                    applyNormalizedPatch(trigger, operation.patch || {});
                    continue;
                }
                if (operation.op === "deleteTrigger") {
                    const triggerIndex = (rules.triggers || []).findIndex(function find(item) { return item && item.id === operation.id; });
                    if (triggerIndex < 0) return fail({ ok: false, message: "Unknown trigger id: " + operation.id });
                    rules.triggers.splice(triggerIndex, 1);
                    continue;
                }
                if (operation.op === "alignHorizontal") {
                    const result = applyAlignHorizontal(operation.ids || []);
                    if (!result.ok) return fail(result);
                    continue;
                }
                if (operation.op === "distributeHorizontal") {
                    const result = applyDistributeHorizontal(operation.ids || []);
                    if (!result.ok) return fail(result);
                    continue;
                }
                if (operation.op === "matchWidth") {
                    const result = applyMatchWidth(operation.ids || [], operation.value);
                    if (!result.ok) return fail(result);
                    continue;
                }
                if (operation.op === "matchHeight") {
                    const result = applyMatchHeight(operation.ids || [], operation.value);
                    if (!result.ok) return fail(result);
                    continue;
                }
                if (operation.op === "patchElements") {
                    const result = applyPatchElements(operation);
                    if (!result.ok) return fail(result);
                    continue;
                }
                return fail({ ok: false, message: "Unsupported assistant operation: " + operation.op });
            }
            rebuildGraphsFromRules();
            if (selectedRule) {
                setSelectedRuleId(selectedRule);
                const selectedGraph = (getLogicGraphs() || []).find(function find(graph) { return graph && graph.sourceRuleId === selectedRule; }) || null;
                setSelectedGraphId(selectedGraph ? selectedGraph.id : null);
                setSelectedGraphNodeId(null);
                setSelectedLogicNode(null);
                setInspectorTab("logic");
            }
            markTableDirty();
            refresh("all");
            const issues = Pin.rules && Pin.rules.validate ? Pin.rules.validate(state.table) : [];
            const hasIssues = issues.length > 0;
            return {
                ok: true,
                message: hasIssues ? "Patch applied with validation issues." : "Patch applied.",
                issues: issues
            };
        }

        return {
            markLogicEdgeSource: markLogicEdgeSource,
            connectLogicNodes: connectLogicNodes,
            addLogicNode: addLogicNode,
            assignSelectedToLogicNode: assignSelectedToLogicNode,
            assignElementIdToLogicNode: assignElementIdToLogicNode,
            addSequenceRule: addSequenceRule,
            addLogicStep: addLogicStep,
            deleteGraphEdge: deleteGraphEdge,
            patchGraphNode: patchGraphNode,
            patchGraphNodeFields: patchGraphNodeFields,
            moveGraphNode: moveGraphNode,
            deleteGraphNode: deleteGraphNode,
            patchRule: patchRule,
            patchRuleFields: patchRuleFields,
            duplicateRule: duplicateRule,
            deleteRule: deleteRule,
            addSwitchMap: addSwitchMap,
            patchSwitchMap: patchSwitchMap,
            patchSwitchMapFields: patchSwitchMapFields,
            removeSwitchMap: removeSwitchMap,
            addVariable: addVariable,
            patchVariableFields: patchVariableFields,
            removeVariable: removeVariable,
            addTrigger: addTrigger,
            patchTriggerFields: patchTriggerFields,
            removeTrigger: removeTrigger,
            applyAssistantPatch: applyAssistantPatch
        };
    }

    Pin.editorRulesLogic = {
        create: createRulesLogic
    };
})(window.Pin);
