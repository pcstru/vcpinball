/*
 * What: Logic Studio core helpers for TBSpec rules authoring.
 * Why: the standalone Logic Studio needs a logic-only data layer that can
 *      extract references, sync graphs/rules, validate, and simulate rules
 *      without depending on playfield editing UI.
 */
(function initLogicStudioCore(Pin) {
    const SWITCH_ELEMENT_TYPES = ["lane", "scoreZone", "spinner", "gate", "valve", "drain", "launcher", "dropTarget", "bumper", "kicker", "trough"];
    const LAMP_ELEMENT_TYPES = ["light", "arrowLight", "boxLight"];
    const SCORE_ELEMENT_TYPES = ["lane", "scoreZone", "spinner", "dropTarget", "bumper", "kicker", "trough"];
    const SUPPORTED_ACTIONS = [
        "setElementScore",
        "addElementScore",
        "resetElementScore",
        "setElementProperty",
        "resetElementProperty",
        "setVariableProperty",
        "addVariableProperty",
        "toggleVariableProperty",
        "resetVariableProperty",
        "setLamp",
        "clearLamp",
        "setLampFromVariable"
    ];
    const SUPPORTED_OPERATORS = ["eq", "ne", "gt", "gte", "lt", "lte", "truthy", "falsy"];

    /*
     * What: JSON-safe clone helper for table/rules data.
     * Why: Logic Studio operations should not retain mutable aliases.
     */
    function clone(value) {
        return JSON.parse(JSON.stringify(value));
    }

    /*
     * What: Normalize a table to the current schema.
     * Why: Logic Studio can open imported JSON and must enforce required arrays.
     */
    function normalizeTable(table) {
        if (Pin.table && Pin.table.normalizeTable) return Pin.table.normalizeTable(table || {});
        return table || {};
    }

    /*
     * What: Ensure `rulesEngine` has all required arrays.
     * Why: TBSpec expects these collections to exist even when empty.
     */
    function ensureRulesEngine(table) {
        if (Pin.rules && Pin.rules.ensureRuleConfig) return Pin.rules.ensureRuleConfig(table || {});
        table.rulesEngine = table.rulesEngine || {};
        table.rulesEngine.switchMap = table.rulesEngine.switchMap || [];
        table.rulesEngine.sequenceRules = table.rulesEngine.sequenceRules || [];
        table.rulesEngine.logicGraphs = table.rulesEngine.logicGraphs || [];
        table.rulesEngine.triggers = table.rulesEngine.triggers || [];
        table.rulesEngine.variables = table.rulesEngine.variables || [];
        return table.rulesEngine;
    }

    /*
     * What: Provide a readable label for an element reference.
     * Why: asset sidebars and inspector previews should show meaningful names.
     */
    function elementLabel(element) {
        if (!element) return "";
        return element.name || element.label || element.text || element.id || "";
    }

    /*
     * What: Build logic-reference catalogs from table elements and rules data.
     * Why: Logic Studio should expose reusable switch/lamp/score/variable assets
     *      instead of playfield authoring controls.
     */
    function collectAssets(table) {
        const normalized = normalizeTable(table || {});
        const rules = ensureRulesEngine(normalized);
        const elements = normalized.elements || [];
        const switches = elements.filter(function keep(element) {
            return element && element.id && SWITCH_ELEMENT_TYPES.indexOf(element.type) >= 0;
        }).map(function map(element) {
            return { id: element.id, name: elementLabel(element), type: element.type };
        });
        const lamps = elements.filter(function keep(element) {
            return element && element.id && LAMP_ELEMENT_TYPES.indexOf(element.type) >= 0;
        }).map(function map(element) {
            return { id: element.lampId || element.id, elementId: element.id, name: elementLabel(element), type: element.type };
        });
        const scoreTargets = elements.filter(function keep(element) {
            return element && element.id && SCORE_ELEMENT_TYPES.indexOf(element.type) >= 0;
        }).map(function map(element) {
            return { id: element.id, name: elementLabel(element), type: element.type, score: typeof element.score === "number" ? element.score : 0 };
        });
        return {
            switches: switches,
            lamps: lamps,
            scoreTargets: scoreTargets,
            switchMap: clone(rules.switchMap || []),
            variables: clone(rules.variables || []),
            triggers: clone(rules.triggers || []),
            sequenceRules: clone(rules.sequenceRules || []),
            logicGraphs: clone(rules.logicGraphs || [])
        };
    }

    /*
     * What: Keep graph metadata aligned with sequence rules.
     * Why: Logic Studio graph editing is an authoring layer over sequence rules.
     */
    function syncGraphsFromRules(table) {
        const rules = ensureRulesEngine(table || {});
        if (Pin.ruleGraph && Pin.ruleGraph.syncGraphsFromSequenceRules) {
            rules.logicGraphs = Pin.ruleGraph.syncGraphsFromSequenceRules(table);
        } else if (!Array.isArray(rules.logicGraphs)) {
            rules.logicGraphs = [];
        }
        return rules.logicGraphs;
    }

    /*
     * What: Compile logic graphs into runtime sequence rules.
     * Why: runtime consumes `sequenceRules`; graphs are authoring metadata only.
     */
    function syncRulesFromGraphs(table) {
        const rules = ensureRulesEngine(table || {});
        if (Pin.ruleGraph && Pin.ruleGraph.syncRuleGraphs) {
            Pin.ruleGraph.syncRuleGraphs(table);
        }
        return rules.sequenceRules;
    }

    /*
     * What: Produce stable ID strings for new graph and rules assets.
     * Why: Logic Studio needs deterministic, collision-free authoring inserts.
     */
    function makeId(prefix) {
        return String(prefix || "id") + "_" + Math.random().toString(36).slice(2, 8);
    }

    /*
     * What: Create a new sequence graph/rule pair.
     * Why: authoring starts from a rule graph scaffold, not raw JSON editing.
     */
    function addSequenceGraph(table, name) {
        const rules = ensureRulesEngine(table || {});
        const ruleId = makeId("rule");
        const graph = Pin.ruleGraph && Pin.ruleGraph.createGraph ?
            Pin.ruleGraph.createGraph(name || "Sequence", { sourceRuleId: ruleId, enabled: true, ordered: true }) :
            { id: makeId("graph"), sourceRuleId: ruleId, name: name || "Sequence", enabled: true, ordered: true, nodes: [], edges: [] };
        if (Pin.ruleGraph && Pin.ruleGraph.addNode && Pin.ruleGraph.addEdge) {
            const start = Pin.ruleGraph.addNode(graph, "start", { x: 70, y: 120 }, { label: "Start" });
            const step = Pin.ruleGraph.addNode(graph, "switchStep", { x: 240, y: 120 }, { switchId: "", lampId: "" });
            const award = Pin.ruleGraph.addNode(graph, "award", { x: 410, y: 120 }, { awardPoints: 100, awardEvent: "ruleAwarded" });
            const reset = Pin.ruleGraph.addNode(graph, "reset", { x: 580, y: 120 }, { resetOnDrain: true, resetOnComplete: true, resetOnWrongOrder: false });
            Pin.ruleGraph.addEdge(graph, start.id, step.id);
            Pin.ruleGraph.addEdge(graph, step.id, award.id);
            Pin.ruleGraph.addEdge(graph, award.id, reset.id);
        }
        rules.logicGraphs.push(graph);
        syncRulesFromGraphs(table);
        return graph;
    }

    /*
     * What: Find a graph by id.
     * Why: editor CRUD operations need a single lookup path.
     */
    function findGraph(table, graphId) {
        const rules = ensureRulesEngine(table || {});
        return (rules.logicGraphs || []).find(function find(item) {
            return item && item.id === graphId;
        }) || null;
    }

    /*
     * What: Add a node into an existing logic graph.
     * Why: node authoring must stay constrained to supported graph node types.
     */
    function addGraphNode(table, graphId, nodeType, position, props) {
        const graph = findGraph(table, graphId);
        if (!graph || !nodeType) return null;
        let node = null;
        if (Pin.ruleGraph && Pin.ruleGraph.appendGraphNode) {
            node = Pin.ruleGraph.appendGraphNode(graph, nodeType, position || null, props || {});
        } else {
            graph.nodes = graph.nodes || [];
            node = Object.assign({
                id: makeId(nodeType),
                type: nodeType,
                x: position && typeof position.x === "number" ? position.x : 220,
                y: position && typeof position.y === "number" ? position.y : 120
            }, props || {});
            graph.nodes.push(node);
        }
        syncRulesFromGraphs(table);
        return node;
    }

    /*
     * What: Remove a node and its edges from a graph.
     * Why: authoring canvas requires full CRUD over logical flow.
     */
    function removeGraphNode(table, graphId, nodeId) {
        const graph = findGraph(table, graphId);
        if (!graph || !nodeId) return false;
        if (Pin.ruleGraph && Pin.ruleGraph.removeNode) {
            Pin.ruleGraph.removeNode(graph, nodeId);
        } else {
            graph.nodes = (graph.nodes || []).filter(function keep(node) { return node.id !== nodeId; });
            graph.edges = (graph.edges || []).filter(function keep(edge) { return edge.from !== nodeId && edge.to !== nodeId; });
        }
        syncRulesFromGraphs(table);
        return true;
    }

    /*
     * What: Add an edge between two nodes in a graph.
     * Why: flow connectivity should be explicit and editable in the canvas.
     */
    function connectGraphNodes(table, graphId, fromNodeId, toNodeId) {
        const graph = findGraph(table, graphId);
        if (!graph || !fromNodeId || !toNodeId || fromNodeId === toNodeId) return null;
        let edge = null;
        if (Pin.ruleGraph && Pin.ruleGraph.addEdge) {
            edge = Pin.ruleGraph.addEdge(graph, fromNodeId, toNodeId);
        } else {
            graph.edges = graph.edges || [];
            const existing = graph.edges.find(function find(item) {
                return item && item.from === fromNodeId && item.to === toNodeId;
            });
            edge = existing || { id: makeId("edge"), from: fromNodeId, to: toNodeId };
            if (!existing) graph.edges.push(edge);
        }
        syncRulesFromGraphs(table);
        return edge;
    }

    /*
     * What: Remove an edge by id.
     * Why: users need to rewrite flow relationships without deleting nodes.
     */
    function removeGraphEdge(table, graphId, edgeId) {
        const graph = findGraph(table, graphId);
        if (!graph || !edgeId) return false;
        if (Pin.ruleGraph && Pin.ruleGraph.removeEdge) {
            Pin.ruleGraph.removeEdge(graph, edgeId);
        } else {
            graph.edges = (graph.edges || []).filter(function keep(edge) { return edge.id !== edgeId; });
        }
        syncRulesFromGraphs(table);
        return true;
    }

    /*
     * What: Patch top-level graph properties.
     * Why: editor inspector modifies graph labels and flags inline.
     */
    function patchGraph(table, graphId, patch) {
        const graph = findGraph(table, graphId);
        if (!graph || !patch) return false;
        Object.keys(patch).forEach(function each(key) {
            graph[key] = patch[key];
        });
        syncRulesFromGraphs(table);
        return true;
    }

    /*
     * What: Patch a node payload in a graph.
     * Why: inspector must edit node references and runtime fields.
     */
    function patchGraphNode(table, graphId, nodeId, patch) {
        const graph = findGraph(table, graphId);
        if (!graph || !nodeId || !patch) return false;
        const node = (graph.nodes || []).find(function find(item) { return item && item.id === nodeId; });
        if (!node) return false;
        Object.keys(patch).forEach(function each(key) {
            node[key] = patch[key];
        });
        syncRulesFromGraphs(table);
        return true;
    }

    /*
     * What: Remove a graph and linked sequence rule.
     * Why: rule lifecycle should allow delete without raw JSON edits.
     */
    function removeGraph(table, graphId) {
        const rules = ensureRulesEngine(table || {});
        const index = (rules.logicGraphs || []).findIndex(function find(graph) { return graph && graph.id === graphId; });
        if (index < 0) return false;
        const graph = rules.logicGraphs[index];
        rules.logicGraphs.splice(index, 1);
        if (graph && graph.sourceRuleId) {
            const ruleIndex = (rules.sequenceRules || []).findIndex(function find(rule) {
                return rule && rule.id === graph.sourceRuleId;
            });
            if (ruleIndex >= 0) rules.sequenceRules.splice(ruleIndex, 1);
        }
        syncRulesFromGraphs(table);
        return true;
    }

    /*
     * What: Build a complete compile output snapshot.
     * Why: JSON preview and export should always show runtime-safe TBSpec JSON.
     */
    function compileTable(table) {
        const out = normalizeTable(clone(table || {}));
        ensureRulesEngine(out);
        syncRulesFromGraphs(out);
        return out;
    }

    function addIssue(list, severity, message, scope, id) {
        list.push({
            severity: severity || "warning",
            message: message || "",
            scope: scope || "",
            id: id || ""
        });
    }

    /*
     * What: Validate graph metadata beyond runtime rule validation.
     * Why: dangling edges and duplicate node ids are authoring defects that
     *      runtime validation does not always surface.
     */
    function validateGraphIntegrity(table) {
        const issues = [];
        const rules = ensureRulesEngine(table || {});
        const graphIds = {};
        (rules.logicGraphs || []).forEach(function each(graph, graphIndex) {
            if (!graph || !graph.id) {
                addIssue(issues, "error", "Logic graph #" + (graphIndex + 1) + " is missing an id.", "logicGraphs", "");
                return;
            }
            if (graphIds[graph.id]) addIssue(issues, "error", "Duplicate logic graph id '" + graph.id + "'.", "logicGraphs", graph.id);
            graphIds[graph.id] = true;
            const nodes = graph.nodes || [];
            const edges = graph.edges || [];
            const nodeIds = {};
            nodes.forEach(function eachNode(node, nodeIndex) {
                if (!node || !node.id) {
                    addIssue(issues, "error", "Graph '" + graph.id + "' node #" + (nodeIndex + 1) + " is missing an id.", "logicGraphNode", graph.id);
                    return;
                }
                if (nodeIds[node.id]) addIssue(issues, "error", "Graph '" + graph.id + "' has duplicate node id '" + node.id + "'.", "logicGraphNode", graph.id);
                nodeIds[node.id] = true;
            });
            edges.forEach(function eachEdge(edge, edgeIndex) {
                if (!edge || !edge.id) {
                    addIssue(issues, "warning", "Graph '" + graph.id + "' edge #" + (edgeIndex + 1) + " is missing an id.", "logicGraphEdge", graph.id);
                    return;
                }
                if (!edge.from || !nodeIds[edge.from]) {
                    addIssue(issues, "error", "Graph '" + graph.id + "' edge '" + edge.id + "' has unknown source node '" + (edge.from || "") + "'.", "logicGraphEdge", graph.id);
                }
                if (!edge.to || !nodeIds[edge.to]) {
                    addIssue(issues, "error", "Graph '" + graph.id + "' edge '" + edge.id + "' has unknown destination node '" + (edge.to || "") + "'.", "logicGraphEdge", graph.id);
                }
            });
        });
        return issues;
    }

    /*
     * What: Validate triggers and variables for standalone authoring issues.
     * Why: duplicate IDs and unsupported values should be highlighted early.
     */
    function validateIdsAndTypes(table) {
        const issues = [];
        const rules = ensureRulesEngine(table || {});
        const variableIds = {};
        const triggerIds = {};
        (rules.variables || []).forEach(function each(variable, index) {
            const id = variable && (variable.id || variable.name || "");
            if (!id) {
                addIssue(issues, "error", "Variable #" + (index + 1) + " needs an id or name.", "variables", "");
                return;
            }
            if (variableIds[id]) addIssue(issues, "error", "Duplicate variable id '" + id + "'.", "variables", id);
            variableIds[id] = true;
        });
        (rules.triggers || []).forEach(function each(trigger, index) {
            const id = trigger && (trigger.id || trigger.switchId || "");
            if (!id) {
                addIssue(issues, "error", "Trigger #" + (index + 1) + " needs an id or switchId.", "triggers", "");
                return;
            }
            if (triggerIds[id]) addIssue(issues, "error", "Duplicate trigger id '" + id + "'.", "triggers", id);
            triggerIds[id] = true;
        });
        (rules.sequenceRules || []).forEach(function each(rule) {
            (rule.actions || []).forEach(function eachAction(action, actionIndex) {
                if (!action || SUPPORTED_ACTIONS.indexOf(action.actionType) >= 0) return;
                addIssue(issues, "warning", "Rule '" + (rule.id || "") + "' action #" + (actionIndex + 1) + " uses unsupported actionType '" + (action.actionType || "") + "'.", "sequenceRules", rule.id || "");
            });
            (rule.conditions || []).forEach(function eachCondition(condition, conditionIndex) {
                const operator = condition && (condition.operator || "eq");
                if (SUPPORTED_OPERATORS.indexOf(operator) >= 0) return;
                addIssue(issues, "warning", "Rule '" + (rule.id || "") + "' condition #" + (conditionIndex + 1) + " uses unsupported operator '" + operator + "'.", "sequenceRules", rule.id || "");
            });
        });
        return issues;
    }

    /*
     * What: Run full Logic Studio validation and return normalized issues.
     * Why: UI needs one validation feed for graph and runtime rule checks.
     */
    function validateLogic(table) {
        const compiled = compileTable(table || {});
        const runtimeIssues = Pin.rules && Pin.rules.validate ? Pin.rules.validate(compiled) : [];
        const graphIssues = validateGraphIntegrity(compiled);
        const idIssues = validateIdsAndTypes(compiled);
        return runtimeIssues.map(function map(issue) {
            return {
                severity: issue.severity || "warning",
                message: issue.message || "",
                scope: "runtime",
                id: issue.ruleId || ""
            };
        }).concat(graphIssues, idIssues);
    }

    /*
     * What: Build a stripped, stable rule-state view for simulation UI.
     * Why: simulator panels should present concise progress snapshots.
     */
    function summarizeRuleState(world) {
        const out = {};
        Object.keys(world.ruleState || {}).forEach(function each(ruleId) {
            const state = world.ruleState[ruleId] || {};
            out[ruleId] = {
                stepIndex: state.stepIndex || 0,
                qualified: !!state.qualified,
                remaining: typeof state.remaining === "number" ? state.remaining : 0,
                completeCount: state.completeCount || 0,
                completed: clone(state.completed || {})
            };
        });
        return out;
    }

    /*
     * What: Produce a simulation snapshot.
     * Why: UI tabs need atomic state captures after each simulated event/tick.
     */
    function simulationSnapshot(world) {
        return {
            score: world.score || 0,
            physicsTick: world.physicsTick || 0,
            variables: clone(world.variableState || {}),
            lamps: clone(world.lampState || {}),
            rules: summarizeRuleState(world)
        };
    }

    /*
     * What: Create a logic-only simulation session for a table.
     * Why: Logic Studio simulation should exercise rules without physics layout.
     */
    function createSimulationSession(table) {
        const compiledTable = compileTable(table || {});
        const initialRules = ensureRulesEngine(compiledTable);

        function createWorld() {
            return {
                table: compiledTable,
                events: [],
                score: 0,
                ruleState: {},
                lampState: {},
                logicLampState: {},
                triggerState: {},
                variableState: null,
                variableStateSignature: "",
                elementScoreState: {},
                elementPropertyState: {},
                physicsTick: 0,
                currentBall: 1,
                ballsRemaining: (compiledTable.rules && compiledTable.rules.balls) || 3,
                state: "playing",
                rulesEngineSnapshot: {
                    variableCount: (initialRules.variables || []).length,
                    triggerCount: (initialRules.triggers || []).length,
                    ruleCount: (initialRules.sequenceRules || []).length
                }
            };
        }

        let world = createWorld();
        const eventLog = [];

        function process(dt, tickDelta, reason) {
            world.physicsTick = Math.max(0, (world.physicsTick || 0) + Math.max(0, tickDelta || 0));
            const processed = Pin.events && Pin.events.processRules ? Pin.events.processRules(world, Math.max(0, dt || 0)) : [];
            processed.forEach(function each(event) {
                eventLog.push({
                    type: event.type || "",
                    sourceId: event.sourceId || "",
                    switchId: event.switchId || "",
                    points: typeof event.points === "number" ? event.points : 0,
                    synthetic: !!event.synthetic,
                    tick: world.physicsTick || 0,
                    reason: reason || "process"
                });
            });
            return {
                processedEvents: processed,
                snapshot: simulationSnapshot(world)
            };
        }

        return {
            fireSwitch: function fireSwitch(switchId, sourceId) {
                const id = String(switchId || "").trim();
                if (!id) return { processedEvents: [], snapshot: simulationSnapshot(world) };
                if (Pin.events && Pin.events.emit) {
                    Pin.events.emit(world, { type: "switchClosed", sourceId: sourceId || id, switchId: id });
                }
                return process(0, 1, "switch");
            },
            fireDrain: function fireDrain(drainId) {
                const id = String(drainId || "").trim();
                if (!id) return { processedEvents: [], snapshot: simulationSnapshot(world) };
                if (Pin.events && Pin.events.emit) {
                    Pin.events.emit(world, { type: "switchClosed", sourceId: id, switchId: id });
                    Pin.events.emit(world, { type: "ballDrained", sourceId: id });
                }
                return process(0, 1, "drain");
            },
            tick: function tick(dt, ticks) {
                return process(typeof dt === "number" ? dt : 1 / 60, typeof ticks === "number" ? ticks : 1, "tick");
            },
            reset: function reset() {
                world = createWorld();
                eventLog.length = 0;
                return simulationSnapshot(world);
            },
            snapshot: function snapshot() {
                return simulationSnapshot(world);
            },
            log: function log() {
                return clone(eventLog);
            }
        };
    }

    Pin.logicStudioCore = {
        clone: clone,
        normalizeTable: normalizeTable,
        ensureRulesEngine: ensureRulesEngine,
        collectAssets: collectAssets,
        syncGraphsFromRules: syncGraphsFromRules,
        syncRulesFromGraphs: syncRulesFromGraphs,
        addSequenceGraph: addSequenceGraph,
        addGraphNode: addGraphNode,
        removeGraphNode: removeGraphNode,
        connectGraphNodes: connectGraphNodes,
        removeGraphEdge: removeGraphEdge,
        patchGraph: patchGraph,
        patchGraphNode: patchGraphNode,
        removeGraph: removeGraph,
        compileTable: compileTable,
        validateLogic: validateLogic,
        createSimulationSession: createSimulationSession,
        supportedActions: SUPPORTED_ACTIONS,
        supportedOperators: SUPPORTED_OPERATORS,
        switchElementTypes: SWITCH_ELEMENT_TYPES,
        lampElementTypes: LAMP_ELEMENT_TYPES,
        scoreElementTypes: SCORE_ELEMENT_TYPES
    };
})(window.Pin);
