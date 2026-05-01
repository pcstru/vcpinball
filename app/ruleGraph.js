(function initRuleGraph(Pin) {
    function clone(value) {
        return JSON.parse(JSON.stringify(value));
    }

    function makeId(prefix) {
        return prefix + "_" + Math.random().toString(36).slice(2, 8);
    }

    const NODE_TYPES = [
        { value: "start", label: "Start" },
        { value: "switchStep", label: "Switch Step" },
        { value: "timedTarget", label: "Timed Target" },
        { value: "award", label: "Award" },
        { value: "reset", label: "Reset" },
        { value: "event", label: "Event" },
        { value: "condition", label: "Condition" },
        { value: "action", label: "Action" },
        { value: "lamp", label: "Lamp" },
        { value: "note", label: "Note" }
    ];

    function labelForType(type) {
        const item = NODE_TYPES.find(function each(entry) { return entry.value === type; });
        if (item) return item.label;
        return type ? type.replace(/([A-Z])/g, " $1").replace(/^./, function cap(ch) { return ch.toUpperCase(); }) : "Node";
    }

    function ensureConfig(table) {
        table.rulesEngine = table.rulesEngine || {};
        table.rulesEngine.switchMap = table.rulesEngine.switchMap || [];
        table.rulesEngine.sequenceRules = table.rulesEngine.sequenceRules || [];
        table.rulesEngine.logicGraphs = table.rulesEngine.logicGraphs || [];
        return table.rulesEngine;
    }

    function ensureGraph(graph) {
        graph.nodes = graph.nodes || [];
        graph.edges = graph.edges || [];
        return graph;
    }

    function defaultNode(type, x, y, props) {
        const out = Object.assign({
            id: makeId(type),
            type: type,
            x: x,
            y: y,
            label: labelForType(type)
        }, props || {});
        return out;
    }

    function createGraph(name, props) {
        return Object.assign({
            id: makeId("graph"),
            sourceRuleId: "",
            name: name || "Logic Graph",
            enabled: true,
            ordered: true,
            nodes: [],
            edges: []
        }, props || {});
    }

    function graphNextPosition(graph) {
        const nodes = (graph.nodes || []).filter(function each(node) {
            return node && typeof node.x === "number" && typeof node.y === "number";
        });
        if (!nodes.length) return { x: 220, y: 120 };
        const rightmost = nodes.reduce(function reduce(max, node) {
            if (!max) return node;
            return (node.x || 0) > (max.x || 0) ? node : max;
        }, null);
        return {
            x: (rightmost ? (rightmost.x || 220) : 220) + 170,
            y: rightmost ? (rightmost.y || 120) : 120
        };
    }

    function addNode(graph, type, position, props) {
        ensureGraph(graph);
        const place = position || graphNextPosition(graph);
        const node = defaultNode(type, place.x, place.y, props || {});
        graph.nodes.push(node);
        return node;
    }

    function addEdge(graph, fromId, toId, props) {
        ensureGraph(graph);
        if (!fromId || !toId || fromId === toId) return null;
        const existing = graph.edges.find(function each(edge) {
            return edge.from === fromId && edge.to === toId;
        });
        if (existing) return existing;
        const edge = Object.assign({ id: makeId("edge"), from: fromId, to: toId }, props || {});
        graph.edges.push(edge);
        return edge;
    }

    function removeNode(graph, nodeId) {
        ensureGraph(graph);
        graph.nodes = graph.nodes.filter(function each(node) { return node.id !== nodeId; });
        graph.edges = graph.edges.filter(function each(edge) { return edge.from !== nodeId && edge.to !== nodeId; });
    }

    function removeEdge(graph, edgeId) {
        ensureGraph(graph);
        graph.edges = graph.edges.filter(function each(edge) { return edge.id !== edgeId; });
    }

    function findNode(graph, type) {
        return (graph.nodes || []).find(function each(node) { return node.type === type; }) || null;
    }

    function findNodeById(graph, nodeId) {
        return (graph.nodes || []).find(function each(node) { return node.id === nodeId; }) || null;
    }

    /*
     * What: Copy rule action fields between graph nodes and sequence rules.
     * Why: graph sync must preserve variable and lamp actions, not just legacy
     *      element score/property actions.
     * Correctness: only graph-layout fields are omitted; all authored action
     *              data remains JSON-cloned into the compiled rule.
     */
    function actionFields(source) {
        const out = {};
        Object.keys(source || {}).forEach(function each(key) {
            if (["id", "type", "x", "y", "label", "title"].indexOf(key) >= 0) return;
            out[key] = clone(source[key]);
        });
        if (!out.actionType) out.actionType = "setElementScore";
        return out;
    }

    function conditionFields(source) {
        const out = {};
        Object.keys(source || {}).forEach(function each(key) {
            if (["id", "type", "x", "y", "label", "title"].indexOf(key) >= 0) return;
            out[key] = clone(source[key]);
        });
        if (!out.operator) out.operator = "eq";
        return out;
    }

    function mainPathNodes(graph) {
        const nodes = graph.nodes || [];
        const edges = graph.edges || [];
        const byId = {};
        const outgoing = {};
        nodes.forEach(function each(node) {
            if (!node || !node.id) return;
            byId[node.id] = node;
        });
        edges.forEach(function each(edge) {
            if (!edge || !edge.from || !edge.to) return;
            outgoing[edge.from] = outgoing[edge.from] || [];
            outgoing[edge.from].push(edge);
        });

        const start = findNode(graph, "start") || nodes.slice().sort(function sort(a, b) {
            return (a.x || 0) - (b.x || 0);
        })[0] || null;
        if (!start) return [];

        const ordered = [];
        const seen = {};
        let current = start;
        while (current && !seen[current.id]) {
            ordered.push(current);
            seen[current.id] = true;
            const nextEdge = (outgoing[current.id] || [])[0];
            if (!nextEdge) break;
            current = byId[nextEdge.to] || null;
        }
        return ordered;
    }

    function fromSequenceRule(rule, index) {
        const graphId = "graph_" + (rule.id || makeId("rule"));
        const y = 80 + (index || 0) * 220;
        const graph = createGraph(rule.name || rule.id || "Sequence", {
            id: graphId,
            sourceRuleId: rule.id || "",
            enabled: rule.enabled !== false,
            ordered: rule.ordered !== false
        });
        const start = defaultNode("start", 60, y, { label: rule.name || rule.id || "Sequence" });
        graph.nodes.push(start);
        let previousId = start.id;

        const steps = rule.steps || [];
        const stepLampIds = rule.stepLampIds || [];
        if (!steps.length) {
            const emptyStep = defaultNode("switchStep", 220, y, { switchId: "", lampId: "" });
            graph.nodes.push(emptyStep);
            graph.edges.push({ id: makeId("edge"), from: previousId, to: emptyStep.id });
            previousId = emptyStep.id;
        } else {
            steps.forEach(function each(stepId, stepIndex) {
                const stepNode = defaultNode("switchStep", 220 + stepIndex * 170, y, {
                    switchId: stepId || "",
                    lampId: stepLampIds[stepIndex] || "",
                    stepIndex: stepIndex
                });
                graph.nodes.push(stepNode);
                graph.edges.push({ id: makeId("edge"), from: previousId, to: stepNode.id });
                previousId = stepNode.id;
            });
        }

        const hasTarget = !!rule.targetSwitchId;
        if (hasTarget) {
            const target = defaultNode("timedTarget", 220 + steps.length * 170, y, {
                switchId: rule.targetSwitchId || "",
                lampId: rule.targetLampId || "",
                windowSeconds: rule.windowSeconds || 8
            });
            graph.nodes.push(target);
            graph.edges.push({ id: makeId("edge"), from: previousId, to: target.id });
            previousId = target.id;
        }

        (rule.conditions || []).forEach(function each(condition, conditionIndex) {
            const conditionNode = defaultNode("condition", 390 + (steps.length + conditionIndex) * 170, y, conditionFields(condition));
            graph.nodes.push(conditionNode);
            graph.edges.push({ id: makeId("edge"), from: previousId, to: conditionNode.id });
            previousId = conditionNode.id;
        });

        const award = defaultNode("award", 420 + steps.length * 170, y, {
            awardPoints: rule.awardPoints || 0,
            awardEvent: rule.awardEvent || "ruleAwarded"
        });
        graph.nodes.push(award);
        graph.edges.push({ id: makeId("edge"), from: previousId, to: award.id });
        previousId = award.id;

        (rule.actions || []).forEach(function each(action, actionIndex) {
            const actionNode = defaultNode("action", 600 + (steps.length + actionIndex) * 170, y, actionFields(action));
            graph.nodes.push(actionNode);
            graph.edges.push({ id: makeId("edge"), from: previousId, to: actionNode.id });
            previousId = actionNode.id;
        });

        const reset = defaultNode("reset", 600 + steps.length * 170, y, {
            resetOnDrain: rule.resetOnDrain !== false,
            resetOnComplete: rule.resetOnComplete !== false,
            resetOnWrongOrder: !!rule.resetOnWrongOrder
        });
        graph.nodes.push(reset);
        graph.edges.push({ id: makeId("edge"), from: previousId, to: reset.id });
        return graph;
    }

    function deriveGraphsFromSequenceRules(table) {
        const config = ensureConfig(table);
        return (config.sequenceRules || []).map(function map(rule, index) {
            return fromSequenceRule(rule, index);
        });
    }

    function listStepNodes(graph) {
        const ordered = mainPathNodes(graph).filter(function onlyStep(node) {
            return node.type === "switchStep";
        });
        if (ordered.length) return ordered;
        return (graph.nodes || [])
            .filter(function onlyStep(node) { return node.type === "switchStep"; })
            .sort(function sort(a, b) { return (a.x || 0) - (b.x || 0); });
    }

    function compileGraphToSequenceRule(graph, fallbackRuleId) {
        const orderedNodes = mainPathNodes(graph);
        const stepNodes = listStepNodes(graph);
        const targetNode = orderedNodes.find(function each(node) { return node.type === "timedTarget"; }) || findNode(graph, "timedTarget");
        const awardNode = orderedNodes.find(function each(node) { return node.type === "award"; }) || findNode(graph, "award");
        const conditionNodes = orderedNodes.filter(function each(node) { return node.type === "condition"; });
        const actionNodes = orderedNodes.filter(function each(node) { return node.type === "action"; });
        const resetNode = orderedNodes.find(function each(node) { return node.type === "reset"; }) || findNode(graph, "reset");
        const ruleId = graph.sourceRuleId || fallbackRuleId || makeId("rule");
        return {
            id: ruleId,
            name: graph.name || ruleId,
            type: "sequence",
            enabled: graph.enabled !== false,
            ordered: graph.ordered !== false,
            steps: stepNodes.map(function map(node) { return node.switchId || ""; }).filter(Boolean),
            targetSwitchId: targetNode ? (targetNode.switchId || "") : "",
            stepLampIds: stepNodes.map(function map(node) { return node.lampId || ""; }).filter(Boolean),
            targetLampId: targetNode ? (targetNode.lampId || "") : "",
            windowSeconds: targetNode ? (targetNode.windowSeconds || 8) : 8,
            awardPoints: awardNode ? (awardNode.awardPoints || 0) : 0,
            awardEvent: awardNode ? (awardNode.awardEvent || "ruleAwarded") : "ruleAwarded",
            conditions: conditionNodes.map(conditionFields),
            actions: actionNodes.map(actionFields),
            resetOnDrain: resetNode ? resetNode.resetOnDrain !== false : true,
            resetOnComplete: resetNode ? resetNode.resetOnComplete !== false : true,
            resetOnWrongOrder: resetNode ? !!resetNode.resetOnWrongOrder : false
        };
    }

    function applySequenceRuleToGraph(graph, rule, index) {
        ensureGraph(graph);
        const y = 80 + (index || 0) * 220;
        graph.sourceRuleId = rule.id || graph.sourceRuleId || "";
        graph.name = rule.name || graph.name || rule.id || "Sequence";
        graph.enabled = rule.enabled !== false;
        graph.ordered = rule.ordered !== false;
        const start = findNode(graph, "start") || addNode(graph, "start", { x: 60, y: y }, { label: rule.name || rule.id || "Sequence" });

        const steps = rule.steps || [];
        const stepLampIds = rule.stepLampIds || [];
        let stepNodes = graph.nodes.filter(function each(node) { return node.type === "switchStep"; });
        if (!stepNodes.length && steps.length) {
            const first = addNode(graph, "switchStep", { x: 220, y: y }, { switchId: "", lampId: "" });
            stepNodes = [first];
        }
        stepNodes.sort(function sort(a, b) { return (a.x || 0) - (b.x || 0); });

        while (stepNodes.length < steps.length) {
            const last = stepNodes[stepNodes.length - 1];
            const place = last ? { x: (last.x || 220) + 170, y: last.y || y } : { x: 220, y: y };
            stepNodes.push(addNode(graph, "switchStep", place, { switchId: "", lampId: "" }));
        }

        stepNodes.forEach(function each(node, stepIndex) {
            node.switchId = steps[stepIndex] || "";
            node.lampId = stepLampIds[stepIndex] || "";
            node.stepIndex = stepIndex;
            node.x = typeof node.x === "number" ? node.x : 220 + stepIndex * 170;
            node.y = typeof node.y === "number" ? node.y : y;
        });

        const target = findNode(graph, "timedTarget") || (rule.targetSwitchId ? addNode(graph, "timedTarget", { x: 220 + steps.length * 170, y: y }, {}) : null);
        if (target) {
            target.switchId = rule.targetSwitchId || "";
            target.lampId = rule.targetLampId || "";
            target.windowSeconds = rule.windowSeconds || 8;
        }

        let conditionNodes = (graph.nodes || []).filter(function each(node) { return node.type === "condition"; })
            .sort(function sort(a, b) { return (a.x || 0) - (b.x || 0); });
        const conditions = rule.conditions || [];
        while (conditionNodes.length < conditions.length) {
            const place = conditionNodes.length ?
                { x: (conditionNodes[conditionNodes.length - 1].x || (390 + steps.length * 170)) + 170, y: y } :
                { x: 390 + steps.length * 170, y: y };
            conditionNodes.push(addNode(graph, "condition", place, { operator: "eq" }));
        }
        conditionNodes.forEach(function each(node, index) {
            const condition = conditions[index] || {};
            Object.keys(node).forEach(function clear(key) {
                if (["id", "type", "x", "y", "label"].indexOf(key) < 0) delete node[key];
            });
            Object.assign(node, conditionFields(condition));
            node.x = typeof node.x === "number" ? node.x : 390 + steps.length * 170 + index * 170;
            node.y = typeof node.y === "number" ? node.y : y;
        });

        const award = findNode(graph, "award") || addNode(graph, "award", { x: 420 + steps.length * 170, y: y }, {});
        award.awardPoints = rule.awardPoints || 0;
        award.awardEvent = rule.awardEvent || "ruleAwarded";

        let actionNodes = (graph.nodes || []).filter(function each(node) { return node.type === "action"; })
            .sort(function sort(a, b) { return (a.x || 0) - (b.x || 0); });
        const actions = rule.actions || [];
        while (actionNodes.length < actions.length) {
            const place = actionNodes.length ?
                { x: (actionNodes[actionNodes.length - 1].x || (420 + steps.length * 170)) + 170, y: y } :
                { x: 600 + steps.length * 170, y: y };
            actionNodes.push(addNode(graph, "action", place, { actionType: "setElementScore", targetId: "", value: 0 }));
        }
        actionNodes.forEach(function each(node, index) {
            const action = actions[index] || {};
            Object.keys(node).forEach(function clear(key) {
                if (["id", "type", "x", "y", "label"].indexOf(key) < 0) delete node[key];
            });
            Object.assign(node, actionFields(action));
            node.x = typeof node.x === "number" ? node.x : 600 + steps.length * 170 + index * 170;
            node.y = typeof node.y === "number" ? node.y : y;
        });

        const reset = findNode(graph, "reset") || addNode(graph, "reset", { x: 600 + steps.length * 170, y: y }, {});
        reset.resetOnDrain = rule.resetOnDrain !== false;
        reset.resetOnComplete = rule.resetOnComplete !== false;
        reset.resetOnWrongOrder = !!rule.resetOnWrongOrder;

        const coreNodes = [start].concat(stepNodes);
        if (target) coreNodes.push(target);
        coreNodes.push.apply(coreNodes, conditionNodes.slice(0, conditions.length));
        coreNodes.push(award);
        coreNodes.push.apply(coreNodes, actionNodes.slice(0, actions.length));
        coreNodes.push(reset);
        coreNodes.forEach(function each(node, nodeIndex) {
            const next = coreNodes[nodeIndex + 1];
            if (!next) return;
            addEdge(graph, node.id, next.id);
        });
        return graph;
    }

    function syncGraphsFromSequenceRules(table) {
        const config = ensureConfig(table);
        if (!config.logicGraphs || !config.logicGraphs.length) {
            config.logicGraphs = deriveGraphsFromSequenceRules(table);
            return config.logicGraphs;
        }
        const graphByRuleId = {};
        config.logicGraphs.forEach(function each(graph) {
            if (graph && graph.sourceRuleId) graphByRuleId[graph.sourceRuleId] = graph;
        });
        const used = {};
        const nextGraphs = [];
        (config.sequenceRules || []).forEach(function each(rule, index) {
            let graph = graphByRuleId[rule.id];
            if (!graph) {
                graph = config.logicGraphs[index];
            }
            if (!graph) {
                graph = fromSequenceRule(rule, index);
            } else {
                applySequenceRuleToGraph(graph, rule, index);
            }
            used[graph.id] = true;
            nextGraphs.push(graph);
        });
        config.logicGraphs.forEach(function each(graph) {
            if (!graph || used[graph.id]) return;
            nextGraphs.push(graph);
        });
        config.logicGraphs = nextGraphs;
        return config.logicGraphs;
    }

    function syncRuleGraphs(table) {
        const config = ensureConfig(table);
        if (!config.logicGraphs || !config.logicGraphs.length) {
            config.logicGraphs = deriveGraphsFromSequenceRules(table);
        }
        const sequenceRules = [];
        (config.logicGraphs || []).forEach(function each(graph, index) {
            const existingId = graph.sourceRuleId || ("rule_" + index);
            const compiled = compileGraphToSequenceRule(graph, existingId);
            graph.sourceRuleId = compiled.id;
            if (!graph.name) graph.name = compiled.name;
            sequenceRules.push(compiled);
        });
        config.sequenceRules = sequenceRules;
        return config;
    }

    function appendStepNode(graph) {
        const steps = listStepNodes(graph);
        const lastStep = steps[steps.length - 1];
        const x = lastStep ? (lastStep.x || 220) + 170 : 220;
        const y = lastStep ? (lastStep.y || 120) : 120;
        return addNode(graph, "switchStep", { x: x, y: y }, { switchId: "", lampId: "" });
    }

    function appendGraphNode(graph, type, position, props) {
        return addNode(graph, type, position, props);
    }

    Pin.ruleGraph = {
        ensureConfig: ensureConfig,
        createGraph: createGraph,
        addNode: addNode,
        addEdge: addEdge,
        removeNode: removeNode,
        removeEdge: removeEdge,
        findNodeById: findNodeById,
        nodeTypes: NODE_TYPES,
        deriveGraphsFromSequenceRules: deriveGraphsFromSequenceRules,
        compileGraphToSequenceRule: compileGraphToSequenceRule,
        applySequenceRuleToGraph: applySequenceRuleToGraph,
        syncGraphsFromSequenceRules: syncGraphsFromSequenceRules,
        syncRuleGraphs: syncRuleGraphs,
        appendStepNode: appendStepNode,
        appendGraphNode: appendGraphNode
    };
})(window.Pin);
