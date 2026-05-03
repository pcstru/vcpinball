/*
 * What: Standalone Logic Studio UI for TBSpec rules authoring.
 * Why: rule authoring, validation, and simulation should be accessible without
 *      the geometry/physics editor surface.
 */
(function initLogicStudio(Pin) {
    const core = Pin.logicStudioCore;
    const GRID_SIZE = 20;

    function clone(value) {
        return core && core.clone ? core.clone(value) : JSON.parse(JSON.stringify(value));
    }

    function createEl(tag, className, text) {
        const node = document.createElement(tag);
        if (className) node.className = className;
        if (text != null) node.textContent = text;
        return node;
    }

    function asNumber(value, fallback) {
        const parsed = Number(value);
        return Number.isFinite(parsed) ? parsed : fallback;
    }

    function toId(text, prefix) {
        const raw = String(text || "").trim().toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
        return raw || (prefix || "item") + "_" + Math.random().toString(36).slice(2, 6);
    }

    function mountLogicStudio(root, options) {
        const initial = core.normalizeTable(clone((options && options.table) || Pin.table.createEmptyTable()));
        const state = {
            table: initial,
            revision: 0,
            undo: [],
            selectedGraphId: "",
            selectedNodeId: "",
            selectedAsset: null,
            sidebarSearch: "",
            bottomTab: "validation",
            inspectorTab: "node",
            linkMode: false,
            linkSourceNodeId: "",
            clipboardNode: null,
            graphView: { zoom: 1, panX: 0, panY: 0 },
            dragNode: null,
            dragCanvas: null,
            simulationInputSwitch: "",
            simulationInputDrain: "",
            simulationDt: 0.5,
            compiledCache: null,
            assetsCache: null,
            issuesCache: null,
            simCache: null,
            simRevision: -1
        };

        function ensureGraphSelection() {
            core.syncGraphsFromRules(state.table);
            const graphs = state.table.rulesEngine.logicGraphs || [];
            if (!graphs.length) {
                state.selectedGraphId = "";
                state.selectedNodeId = "";
                return;
            }
            if (!graphs.some(function has(graph) { return graph && graph.id === state.selectedGraphId; })) {
                state.selectedGraphId = graphs[0].id;
            }
            const selectedGraph = getSelectedGraph();
            const nodes = (selectedGraph && selectedGraph.nodes) || [];
            if (!nodes.some(function has(node) { return node && node.id === state.selectedNodeId; })) {
                state.selectedNodeId = nodes.length ? nodes[0].id : "";
            }
        }

        function invalidateDerived() {
            state.revision += 1;
            state.compiledCache = null;
            state.assetsCache = null;
            state.issuesCache = null;
            state.simCache = null;
            state.simRevision = -1;
        }

        function pushUndo() {
            state.undo.push(clone(state.table));
            if (state.undo.length > 80) state.undo.shift();
        }

        function mutate(label, fn) {
            pushUndo();
            fn();
            ensureGraphSelection();
            invalidateDerived();
            renderAll();
        }

        function getCompiledTable() {
            if (!state.compiledCache) {
                state.compiledCache = core.compileTable(state.table);
            }
            return state.compiledCache;
        }

        function getAssets() {
            if (!state.assetsCache) {
                state.assetsCache = core.collectAssets(getCompiledTable());
            }
            return state.assetsCache;
        }

        function getIssues() {
            if (!state.issuesCache) {
                state.issuesCache = core.validateLogic(getCompiledTable());
            }
            return state.issuesCache;
        }

        function getSimulation() {
            if (!state.simCache || state.simRevision !== state.revision) {
                state.simCache = core.createSimulationSession(getCompiledTable());
                state.simRevision = state.revision;
            }
            return state.simCache;
        }

        function getSelectedGraph() {
            return (state.table.rulesEngine.logicGraphs || []).find(function find(graph) {
                return graph && graph.id === state.selectedGraphId;
            }) || null;
        }

        function getSelectedNode() {
            const graph = getSelectedGraph();
            if (!graph) return null;
            return (graph.nodes || []).find(function find(node) {
                return node && node.id === state.selectedNodeId;
            }) || null;
        }

        function issueCountBySeverity() {
            return getIssues().reduce(function reduce(out, issue) {
                const key = issue.severity || "warning";
                out[key] = (out[key] || 0) + 1;
                return out;
            }, {});
        }

        function nodeTitle(node) {
            if (!node) return "";
            const map = {
                start: "Start",
                switchStep: "Sequence Step",
                timedTarget: "Target Timer",
                condition: "Condition",
                action: "Action",
                award: "Score / Award",
                reset: "Reset",
                event: "Trigger",
                lamp: "Lamp",
                note: "Note"
            };
            return map[node.type] || node.type;
        }

        function nodeSummary(node) {
            if (!node) return "";
            if (node.type === "switchStep") return (node.switchId || "(unbound)") + (node.lampId ? " | lamp " + node.lampId : "");
            if (node.type === "timedTarget") return (node.switchId || "(target)") + " | " + (node.windowSeconds || 0) + "s";
            if (node.type === "condition") return (node.operator || "eq") + " " + (node.variableId || (node.left && node.left.variableId) || "");
            if (node.type === "action") return node.actionType || "(action)";
            if (node.type === "award") return (node.awardPoints || 0) + " pts";
            if (node.type === "reset") return "drain:" + (node.resetOnDrain !== false ? "on" : "off");
            if (node.type === "event") return (node.switchId || node.sourceId || "(event)");
            return node.label || "";
        }

        function graphRuleFor(graph) {
            if (!graph || !graph.sourceRuleId) return null;
            return (state.table.rulesEngine.sequenceRules || []).find(function find(rule) {
                return rule && rule.id === graph.sourceRuleId;
            }) || null;
        }

        function selectableSwitchIds() {
            const assets = getAssets();
            const fromElements = assets.switches.map(function map(item) { return item.id; });
            const fromMap = assets.switchMap.map(function map(item) { return item.switchId; });
            const fromTriggers = assets.triggers.map(function map(item) { return item.switchId; });
            const ids = [].concat(fromElements, fromMap, fromTriggers).filter(Boolean);
            return ids.filter(function unique(id, index, all) { return all.indexOf(id) === index; });
        }

        function selectableLampIds() {
            const assets = getAssets();
            const ids = assets.lamps.map(function map(item) { return item.id; }).filter(Boolean);
            return ids.filter(function unique(id, index, all) { return all.indexOf(id) === index; });
        }

        function selectableVariableIds() {
            const assets = getAssets();
            const ids = assets.variables.map(function map(item) { return item.id || item.name; }).filter(Boolean);
            return ids.filter(function unique(id, index, all) { return all.indexOf(id) === index; });
        }

        function selectableElementIds() {
            return (state.table.elements || []).map(function map(element) {
                return element && element.id;
            }).filter(Boolean);
        }

        function applySearch(items, pickText) {
            const query = String(state.sidebarSearch || "").trim().toLowerCase();
            if (!query) return items;
            return items.filter(function keep(item) {
                return String(pickText(item) || "").toLowerCase().indexOf(query) >= 0;
            });
        }

        const layout = createEl("div", "logicstudio-layout");
        const sidebar = createEl("aside", "logicstudio-sidebar");
        const main = createEl("main", "logicstudio-main");
        const inspector = createEl("aside", "logicstudio-inspector");
        const toolbar = createEl("div", "logicstudio-toolbar");
        const canvasShell = createEl("div", "logicstudio-canvas-shell");
        const canvasViewport = createEl("div", "logicstudio-canvas-viewport");
        const canvasEdges = createEl("svg", "logicstudio-canvas-edges");
        const canvasNodes = createEl("div", "logicstudio-canvas-nodes");
        const bottom = createEl("section", "logicstudio-bottom");

        canvasViewport.appendChild(canvasEdges);
        canvasViewport.appendChild(canvasNodes);
        canvasShell.appendChild(canvasViewport);
        main.appendChild(toolbar);
        main.appendChild(canvasShell);
        main.appendChild(bottom);
        layout.appendChild(sidebar);
        layout.appendChild(main);
        layout.appendChild(inspector);
        root.innerHTML = "";
        root.appendChild(layout);

        function fieldRow(parent, labelText, input) {
            const row = createEl("label", "logicstudio-field");
            const label = createEl("span", "logicstudio-field-label", labelText);
            row.appendChild(label);
            row.appendChild(input);
            parent.appendChild(row);
            return row;
        }

        function selectInput(options, value, onChange) {
            const select = createEl("select", "logicstudio-input");
            options.forEach(function each(option) {
                const opt = document.createElement("option");
                if (typeof option === "string") {
                    opt.value = option;
                    opt.textContent = option || "(blank)";
                } else {
                    opt.value = option.value;
                    opt.textContent = option.label;
                }
                select.appendChild(opt);
            });
            select.value = value == null ? "" : String(value);
            select.addEventListener("change", function onInputChange() {
                onChange(select.value);
            });
            return select;
        }

        function textInput(value, onChange) {
            const input = createEl("input", "logicstudio-input");
            input.type = "text";
            input.value = value == null ? "" : String(value);
            input.addEventListener("change", function onInputChange() { onChange(input.value); });
            return input;
        }

        function numberInput(value, onChange) {
            const input = createEl("input", "logicstudio-input");
            input.type = "number";
            input.value = Number.isFinite(Number(value)) ? String(value) : "0";
            input.addEventListener("change", function onInputChange() { onChange(asNumber(input.value, 0)); });
            return input;
        }

        function checkboxInput(value, onChange) {
            const input = createEl("input", "logicstudio-checkbox");
            input.type = "checkbox";
            input.checked = !!value;
            input.addEventListener("change", function onInputChange() { onChange(input.checked); });
            return input;
        }

        function renderToolbar() {
            toolbar.innerHTML = "";

            const left = createEl("div", "logicstudio-toolbar-group");
            const title = createEl("strong", "logicstudio-toolbar-title", "Logic Studio");
            const sub = createEl("span", "logicstudio-toolbar-sub", state.table.name || "Untitled");
            left.appendChild(title);
            left.appendChild(sub);
            toolbar.appendChild(left);

            const middle = createEl("div", "logicstudio-toolbar-group");
            const addStep = createEl("button", "logicstudio-btn", "Step");
            addStep.addEventListener("click", function onAddStep() {
                const graph = getSelectedGraph();
                if (!graph) return;
                mutate("add-step", function apply() {
                    core.addGraphNode(state.table, graph.id, "switchStep", null, { switchId: "", lampId: "" });
                });
            });
            middle.appendChild(addStep);

            const addCondition = createEl("button", "logicstudio-btn", "Condition");
            addCondition.addEventListener("click", function onAddCondition() {
                const graph = getSelectedGraph();
                if (!graph) return;
                mutate("add-condition", function apply() {
                    core.addGraphNode(state.table, graph.id, "condition", null, {
                        source: "variable",
                        variableId: selectableVariableIds()[0] || "",
                        property: "value",
                        operator: "truthy",
                        value: true
                    });
                });
            });
            middle.appendChild(addCondition);

            const addAction = createEl("button", "logicstudio-btn", "Action");
            addAction.addEventListener("click", function onAddAction() {
                const graph = getSelectedGraph();
                if (!graph) return;
                mutate("add-action", function apply() {
                    core.addGraphNode(state.table, graph.id, "action", null, {
                        actionType: "setVariableProperty",
                        variableId: selectableVariableIds()[0] || "",
                        property: "value",
                        value: true
                    });
                });
            });
            middle.appendChild(addAction);

            const addScore = createEl("button", "logicstudio-btn", "Score");
            addScore.addEventListener("click", function onAddScore() {
                const graph = getSelectedGraph();
                if (!graph) return;
                mutate("add-score", function apply() {
                    core.addGraphNode(state.table, graph.id, "award", null, {
                        awardPoints: 100,
                        awardEvent: "ruleAwarded"
                    });
                });
            });
            middle.appendChild(addScore);

            const addReset = createEl("button", "logicstudio-btn", "Reset");
            addReset.addEventListener("click", function onAddReset() {
                const graph = getSelectedGraph();
                if (!graph) return;
                mutate("add-reset", function apply() {
                    core.addGraphNode(state.table, graph.id, "reset", null, {
                        resetOnDrain: true,
                        resetOnComplete: true,
                        resetOnWrongOrder: false
                    });
                });
            });
            middle.appendChild(addReset);

            const right = createEl("div", "logicstudio-toolbar-group logicstudio-toolbar-right");
            const linkMode = createEl("button", "logicstudio-btn" + (state.linkMode ? " active" : ""), state.linkMode ? "Link On" : "Link");
            linkMode.addEventListener("click", function onToggleLink() {
                state.linkMode = !state.linkMode;
                if (!state.linkMode) state.linkSourceNodeId = "";
                renderToolbar();
                renderCanvas();
            });
            right.appendChild(linkMode);

            const autoLayout = createEl("button", "logicstudio-btn", "Auto");
            autoLayout.addEventListener("click", function onLayout() {
                const graph = getSelectedGraph();
                if (!graph) return;
                mutate("auto-layout", function apply() {
                    const nodes = (graph.nodes || []).slice().sort(function sort(a, b) {
                        return (a.x || 0) - (b.x || 0);
                    });
                    nodes.forEach(function each(node, index) {
                        node.x = 70 + (index % 6) * 180;
                        node.y = 90 + Math.floor(index / 6) * 130;
                    });
                });
            });
            right.appendChild(autoLayout);

            const duplicate = createEl("button", "logicstudio-btn", "Duplicate");
            duplicate.addEventListener("click", function onDuplicate() {
                const graph = getSelectedGraph();
                const node = getSelectedNode();
                if (!graph || !node) return;
                mutate("duplicate-node", function apply() {
                    const payload = clone(node);
                    delete payload.id;
                    delete payload.x;
                    delete payload.y;
                    const copy = core.addGraphNode(state.table, graph.id, node.type, { x: (node.x || 0) + 30, y: (node.y || 0) + 30 }, payload);
                    state.selectedNodeId = copy ? copy.id : state.selectedNodeId;
                });
            });
            right.appendChild(duplicate);

            const del = createEl("button", "logicstudio-btn danger", "Delete");
            del.addEventListener("click", function onDelete() {
                const graph = getSelectedGraph();
                const node = getSelectedNode();
                if (!graph || !node) return;
                mutate("delete-node", function apply() {
                    core.removeGraphNode(state.table, graph.id, node.id);
                    state.selectedNodeId = "";
                });
            });
            right.appendChild(del);

            const exportBtn = createEl("button", "logicstudio-btn", "Export");
            exportBtn.addEventListener("click", function onExport() {
                const compiled = getCompiledTable();
                Pin.storage.file.export(compiled);
            });
            right.appendChild(exportBtn);

            const importBtn = createEl("button", "logicstudio-btn", "Import");
            importBtn.addEventListener("click", function onImport() {
                Pin.storage.file.import().then(function loaded(table) {
                    mutate("import", function applyImport() {
                        state.table = core.normalizeTable(table);
                        state.selectedGraphId = "";
                        state.selectedNodeId = "";
                        state.selectedAsset = null;
                    });
                }).catch(function ignore() {});
            });
            right.appendChild(importBtn);

            const playBtn = createEl("button", "logicstudio-btn", "Play");
            playBtn.addEventListener("click", function onPlay() {
                const compiled = getCompiledTable();
                location.hash = "#play&t=" + Pin.storage.url.encode(compiled);
            });
            right.appendChild(playBtn);

            const designBtn = createEl("button", "logicstudio-btn", "Design");
            designBtn.addEventListener("click", function onDesign() {
                const compiled = getCompiledTable();
                location.hash = "#design&t=" + Pin.storage.url.encode(compiled);
            });
            right.appendChild(designBtn);

            toolbar.appendChild(middle);
            toolbar.appendChild(right);
        }

        function sidebarSection(parent, titleText) {
            const section = createEl("section", "logicstudio-section");
            section.appendChild(createEl("h3", "logicstudio-section-title", titleText));
            parent.appendChild(section);
            return section;
        }

        function renderSidebar() {
            sidebar.innerHTML = "";
            const search = createEl("input", "logicstudio-search");
            search.type = "search";
            search.placeholder = "Search assets";
            search.value = state.sidebarSearch;
            search.addEventListener("input", function onSearch() {
                state.sidebarSearch = search.value;
                renderSidebar();
            });
            sidebar.appendChild(search);

            const assets = getAssets();
            const graphsSection = sidebarSection(sidebar, "Graphs");
            const addGraphBtn = createEl("button", "logicstudio-btn full", "Add Graph");
            addGraphBtn.addEventListener("click", function onAddGraph() {
                mutate("add-graph", function apply() {
                    const graph = core.addSequenceGraph(state.table, "Sequence " + ((state.table.rulesEngine.logicGraphs || []).length + 1));
                    state.selectedGraphId = graph.id;
                    state.selectedNodeId = "";
                    state.selectedAsset = null;
                });
            });
            graphsSection.appendChild(addGraphBtn);

            applySearch(assets.logicGraphs, function pick(graph) { return (graph.name || "") + " " + (graph.id || ""); }).forEach(function each(graph) {
                const row = createEl("button", "logicstudio-list-item" + (graph.id === state.selectedGraphId ? " active" : ""), graph.name || graph.id);
                row.title = graph.id;
                row.addEventListener("click", function onPickGraph() {
                    state.selectedGraphId = graph.id;
                    state.selectedNodeId = "";
                    state.selectedAsset = { kind: "graph", id: graph.id };
                    renderAll();
                });
                graphsSection.appendChild(row);
            });

            if (state.selectedGraphId) {
                const removeGraph = createEl("button", "logicstudio-btn danger full", "Delete Graph");
                removeGraph.addEventListener("click", function onDeleteGraph() {
                    mutate("delete-graph", function apply() {
                        core.removeGraph(state.table, state.selectedGraphId);
                        state.selectedGraphId = "";
                        state.selectedNodeId = "";
                    });
                });
                graphsSection.appendChild(removeGraph);
            }

            const rulesSection = sidebarSection(sidebar, "Sequence Rules");
            applySearch(assets.sequenceRules, function pick(rule) { return (rule.name || "") + " " + (rule.id || ""); }).forEach(function each(rule) {
                const row = createEl("div", "logicstudio-row");
                const btn = createEl("button", "logicstudio-list-item compact", (rule.name || rule.id || "rule") + "  [" + (rule.steps || []).length + "]");
                btn.addEventListener("click", function onPickRule() {
                    const graph = (state.table.rulesEngine.logicGraphs || []).find(function find(item) {
                        return item && item.sourceRuleId === rule.id;
                    });
                    if (graph) state.selectedGraphId = graph.id;
                    state.selectedNodeId = "";
                    state.selectedAsset = { kind: "rule", id: rule.id };
                    renderAll();
                });
                row.appendChild(btn);
                rulesSection.appendChild(row);
            });

            const variablesSection = sidebarSection(sidebar, "Variables");
            const addVariable = createEl("button", "logicstudio-btn full", "Add Variable");
            addVariable.addEventListener("click", function onAddVariable() {
                mutate("add-variable", function apply() {
                    const next = (state.table.rulesEngine.variables || []).length + 1;
                    state.table.rulesEngine.variables.push({
                        id: "var_" + next,
                        name: "Variable " + next,
                        properties: { value: false }
                    });
                    state.selectedAsset = { kind: "variable", index: state.table.rulesEngine.variables.length - 1 };
                });
            });
            variablesSection.appendChild(addVariable);
            const liveVariables = (state.table.rulesEngine.variables || []).map(function map(variable, index) {
                return { variable: variable, index: index };
            });
            applySearch(liveVariables, function pick(item) {
                return ((item.variable && item.variable.id) || "") + " " + ((item.variable && item.variable.name) || "");
            }).forEach(function each(item) {
                const variable = item.variable || {};
                const row = createEl("button", "logicstudio-list-item compact", (variable.id || variable.name || "var") + " = " + JSON.stringify((variable.properties || {}).value));
                row.addEventListener("click", function onPickVariable() {
                    state.selectedAsset = { kind: "variable", index: item.index };
                    state.inspectorTab = "asset";
                    renderInspector();
                });
                variablesSection.appendChild(row);
            });

            const triggerSection = sidebarSection(sidebar, "Triggers");
            const addTrigger = createEl("button", "logicstudio-btn full", "Add Trigger");
            addTrigger.addEventListener("click", function onAddTrigger() {
                mutate("add-trigger", function apply() {
                    const next = (state.table.rulesEngine.triggers || []).length + 1;
                    state.table.rulesEngine.triggers.push({
                        id: "timer_" + next,
                        type: "interval",
                        everySeconds: 1,
                        switchId: "tick." + next,
                        enabled: true
                    });
                    state.selectedAsset = { kind: "trigger", index: state.table.rulesEngine.triggers.length - 1 };
                });
            });
            triggerSection.appendChild(addTrigger);
            const liveTriggers = (state.table.rulesEngine.triggers || []).map(function map(trigger, index) {
                return { trigger: trigger, index: index };
            });
            applySearch(liveTriggers, function pick(item) {
                return ((item.trigger && item.trigger.id) || "") + " " + ((item.trigger && item.trigger.switchId) || "");
            }).forEach(function each(item) {
                const trigger = item.trigger || {};
                const row = createEl("button", "logicstudio-list-item compact", (trigger.id || "trigger") + " -> " + (trigger.switchId || ""));
                row.addEventListener("click", function onPickTrigger() {
                    state.selectedAsset = { kind: "trigger", index: item.index };
                    state.inspectorTab = "asset";
                    renderInspector();
                });
                triggerSection.appendChild(row);
            });

            const switchMapSection = sidebarSection(sidebar, "Switch Map");
            const addMap = createEl("button", "logicstudio-btn full", "Add Mapping");
            addMap.addEventListener("click", function onAddMap() {
                mutate("add-switch-map", function apply() {
                    state.table.rulesEngine.switchMap.push({ eventType: "switchClosed", sourceId: "", switchId: "" });
                    state.selectedAsset = { kind: "switchMap", index: state.table.rulesEngine.switchMap.length - 1 };
                    state.inspectorTab = "asset";
                });
            });
            switchMapSection.appendChild(addMap);
            const liveMappings = (state.table.rulesEngine.switchMap || []).map(function map(mapping, index) {
                return { mapping: mapping, index: index };
            });
            applySearch(liveMappings, function pick(item) {
                return ((item.mapping && item.mapping.sourceId) || "") + " " + ((item.mapping && item.mapping.switchId) || "");
            }).forEach(function each(item) {
                const mapping = item.mapping || {};
                const row = createEl("button", "logicstudio-list-item compact", (mapping.sourceId || "*") + " => " + (mapping.switchId || "(unset)"));
                row.addEventListener("click", function onPickMap() {
                    state.selectedAsset = { kind: "switchMap", index: item.index };
                    state.inspectorTab = "asset";
                    renderInspector();
                });
                switchMapSection.appendChild(row);
            });

            const switchSection = sidebarSection(sidebar, "Available Switches");
            applySearch(assets.switches, function pick(item) { return item.id + " " + item.name; }).forEach(function each(item) {
                switchSection.appendChild(createEl("div", "logicstudio-badge", item.id + " (" + item.type + ")"));
            });

            const lampSection = sidebarSection(sidebar, "Available Lamps");
            applySearch(assets.lamps, function pick(item) { return item.id + " " + item.name; }).forEach(function each(item) {
                lampSection.appendChild(createEl("div", "logicstudio-badge", item.id));
            });

            const scoreSection = sidebarSection(sidebar, "Score Targets");
            applySearch(assets.scoreTargets, function pick(item) { return item.id + " " + item.name; }).forEach(function each(item) {
                scoreSection.appendChild(createEl("div", "logicstudio-badge", item.id + " (" + item.score + ")"));
            });

            const snippets = sidebarSection(sidebar, "Templates");
            function addSnippetButton(label, handler) {
                const button = createEl("button", "logicstudio-btn full", label);
                button.addEventListener("click", handler);
                snippets.appendChild(button);
            }
            addSnippetButton("Simple Event", function onSimpleEvent() {
                mutate("snippet-simple-event", function apply() {
                    const switches = selectableSwitchIds();
                    const rule = {
                        id: toId("simple_event", "rule"),
                        name: "Simple Event",
                        type: "sequence",
                        enabled: true,
                        ordered: true,
                        steps: switches.length ? [switches[0]] : [],
                        stepLampIds: [],
                        conditions: [],
                        actions: [],
                        awardPoints: 50,
                        awardEvent: "ruleAwarded",
                        resetOnDrain: true,
                        resetOnComplete: true,
                        resetOnWrongOrder: false
                    };
                    state.table.rulesEngine.sequenceRules.push(rule);
                    core.syncGraphsFromRules(state.table);
                });
            });
            addSnippetButton("Ordered Trio", function onOrderedTrio() {
                mutate("snippet-ordered-trio", function apply() {
                    const switches = selectableSwitchIds().slice(0, 3);
                    const lamps = selectableLampIds().slice(0, 3);
                    const rule = {
                        id: toId("ordered_trio", "rule"),
                        name: "Ordered Trio",
                        type: "sequence",
                        enabled: true,
                        ordered: true,
                        steps: switches,
                        stepLampIds: lamps,
                        conditions: [],
                        actions: [],
                        awardPoints: 150,
                        awardEvent: "ruleAwarded",
                        resetOnDrain: true,
                        resetOnComplete: true,
                        resetOnWrongOrder: true
                    };
                    state.table.rulesEngine.sequenceRules.push(rule);
                    core.syncGraphsFromRules(state.table);
                });
            });
            addSnippetButton("Drain Reset", function onDrainReset() {
                mutate("snippet-drain-reset", function apply() {
                    const drain = (state.table.elements || []).find(function find(element) {
                        return element && element.type === "drain";
                    });
                    const variableIds = selectableVariableIds();
                    const actions = variableIds.map(function map(id) {
                        return { actionType: "setVariableProperty", variableId: id, property: "value", value: false };
                    });
                    const rule = {
                        id: toId("drain_reset", "rule"),
                        name: "Drain Reset",
                        type: "sequence",
                        enabled: true,
                        ordered: true,
                        steps: drain ? [drain.id] : [],
                        stepLampIds: [],
                        conditions: [],
                        actions: actions,
                        awardPoints: 0,
                        awardEvent: "ruleAwarded",
                        resetOnDrain: true,
                        resetOnComplete: true,
                        resetOnWrongOrder: false
                    };
                    state.table.rulesEngine.sequenceRules.push(rule);
                    core.syncGraphsFromRules(state.table);
                });
            });
        }

        function renderCanvas() {
            canvasNodes.innerHTML = "";
            canvasEdges.innerHTML = "";
            const graph = getSelectedGraph();
            const nodes = (graph && graph.nodes) || [];
            const edges = (graph && graph.edges) || [];

            canvasViewport.style.transform = "translate(" + state.graphView.panX + "px," + state.graphView.panY + "px) scale(" + state.graphView.zoom + ")";
            canvasEdges.setAttribute("viewBox", "0 0 2200 1600");
            canvasEdges.setAttribute("preserveAspectRatio", "xMinYMin meet");

            edges.forEach(function each(edge) {
                const from = nodes.find(function find(node) { return node.id === edge.from; });
                const to = nodes.find(function find(node) { return node.id === edge.to; });
                if (!from || !to) return;
                const line = document.createElementNS("http://www.w3.org/2000/svg", "path");
                const x1 = (from.x || 0) + 72;
                const y1 = (from.y || 0) + 32;
                const x2 = (to.x || 0) + 6;
                const y2 = (to.y || 0) + 32;
                const cx = Math.max(30, Math.abs(x2 - x1) * 0.5);
                line.setAttribute("d", "M " + x1 + " " + y1 + " C " + (x1 + cx) + " " + y1 + ", " + (x2 - cx) + " " + y2 + ", " + x2 + " " + y2);
                line.setAttribute("class", "logicstudio-edge");
                if (state.linkSourceNodeId && edge.from === state.linkSourceNodeId) line.setAttribute("class", "logicstudio-edge active");
                canvasEdges.appendChild(line);
            });

            nodes.forEach(function each(node) {
                const card = createEl("button", "logicstudio-node type-" + node.type + (node.id === state.selectedNodeId ? " active" : ""));
                card.style.left = ((node.x || 0) + "px");
                card.style.top = ((node.y || 0) + "px");
                card.setAttribute("data-node-id", node.id);
                card.innerHTML = "<strong>" + nodeTitle(node) + "</strong><span>" + nodeSummary(node) + "</span>";
                if (state.linkMode && state.linkSourceNodeId === node.id) card.classList.add("link-source");
                card.addEventListener("mousedown", function onNodeMouseDown(evt) {
                    if (evt.button !== 0) return;
                    evt.preventDefault();
                    evt.stopPropagation();
                    state.selectedNodeId = node.id;
                    state.selectedAsset = null;
                    if (state.linkMode) {
                        if (!state.linkSourceNodeId) {
                            state.linkSourceNodeId = node.id;
                        } else if (state.linkSourceNodeId !== node.id) {
                            mutate("connect-node", function apply() {
                                core.connectGraphNodes(state.table, graph.id, state.linkSourceNodeId, node.id);
                                state.linkSourceNodeId = "";
                            });
                            return;
                        }
                        renderToolbar();
                        renderCanvas();
                        renderInspector();
                        return;
                    }
                    state.dragNode = {
                        nodeId: node.id,
                        startX: evt.clientX,
                        startY: evt.clientY,
                        nodeX: node.x || 0,
                        nodeY: node.y || 0
                    };
                    renderInspector();
                    renderCanvas();
                });
                card.addEventListener("click", function onNodeClick() {
                    state.selectedNodeId = node.id;
                    state.selectedAsset = null;
                    renderInspector();
                });
                canvasNodes.appendChild(card);
            });
        }

        function renderInspector() {
            inspector.innerHTML = "";
            const tabs = createEl("div", "logicstudio-tabs");
            const nodeTab = createEl("button", "logicstudio-btn small" + (state.inspectorTab === "node" ? " active" : ""), "Node");
            nodeTab.addEventListener("click", function onNodeTab() {
                state.inspectorTab = "node";
                renderInspector();
            });
            tabs.appendChild(nodeTab);
            const assetTab = createEl("button", "logicstudio-btn small" + (state.inspectorTab === "asset" ? " active" : ""), "Asset");
            assetTab.addEventListener("click", function onAssetTab() {
                state.inspectorTab = "asset";
                renderInspector();
            });
            tabs.appendChild(assetTab);
            inspector.appendChild(tabs);

            if (state.inspectorTab === "asset") {
                renderAssetInspector(inspector);
                return;
            }
            renderNodeInspector(inspector);
        }

        function renderAssetInspector(parent) {
            if (!state.selectedAsset) {
                parent.appendChild(createEl("p", "logicstudio-empty", "Select a variable, trigger, mapping, or graph asset."));
                return;
            }
            const asset = state.selectedAsset;
            if (asset.kind === "graph") {
                const graph = getSelectedGraph();
                if (!graph) return;
                parent.appendChild(createEl("h3", "logicstudio-pane-title", "Graph"));
                fieldRow(parent, "Name", textInput(graph.name || "", function onChange(value) {
                    mutate("graph-name", function apply() {
                        core.patchGraph(state.table, graph.id, { name: value });
                    });
                }));
                fieldRow(parent, "Enabled", checkboxInput(graph.enabled !== false, function onChange(value) {
                    mutate("graph-enabled", function apply() {
                        core.patchGraph(state.table, graph.id, { enabled: value });
                    });
                }));
                fieldRow(parent, "Ordered", checkboxInput(graph.ordered !== false, function onChange(value) {
                    mutate("graph-ordered", function apply() {
                        core.patchGraph(state.table, graph.id, { ordered: value });
                    });
                }));
                const rule = graphRuleFor(graph);
                const preview = createEl("pre", "logicstudio-preview");
                preview.textContent = JSON.stringify(rule || {}, null, 2);
                parent.appendChild(preview);
                return;
            }
            if (asset.kind === "variable") {
                const variable = state.table.rulesEngine.variables[asset.index];
                if (!variable) return;
                parent.appendChild(createEl("h3", "logicstudio-pane-title", "Variable"));
                fieldRow(parent, "ID", textInput(variable.id || "", function onChange(value) {
                    mutate("var-id", function apply() { variable.id = value; });
                }));
                fieldRow(parent, "Name", textInput(variable.name || "", function onChange(value) {
                    mutate("var-name", function apply() { variable.name = value; });
                }));
                fieldRow(parent, "Default Value", textInput(JSON.stringify((variable.properties || {}).value), function onChange(value) {
                    mutate("var-value", function apply() {
                        variable.properties = variable.properties || {};
                        try {
                            variable.properties.value = JSON.parse(value);
                        } catch (err) {
                            variable.properties.value = value;
                        }
                    });
                }));
                const del = createEl("button", "logicstudio-btn danger full", "Delete Variable");
                del.addEventListener("click", function onDelete() {
                    mutate("delete-variable", function apply() {
                        state.table.rulesEngine.variables.splice(asset.index, 1);
                        state.selectedAsset = null;
                    });
                });
                parent.appendChild(del);
                return;
            }
            if (asset.kind === "trigger") {
                const trigger = state.table.rulesEngine.triggers[asset.index];
                if (!trigger) return;
                parent.appendChild(createEl("h3", "logicstudio-pane-title", "Trigger"));
                fieldRow(parent, "ID", textInput(trigger.id || "", function onChange(value) {
                    mutate("trigger-id", function apply() { trigger.id = value; });
                }));
                fieldRow(parent, "Type", selectInput(["interval"], trigger.type || "interval", function onChange(value) {
                    mutate("trigger-type", function apply() { trigger.type = value; });
                }));
                fieldRow(parent, "Every Seconds", numberInput(trigger.everySeconds || 0, function onChange(value) {
                    mutate("trigger-seconds", function apply() { trigger.everySeconds = value; });
                }));
                fieldRow(parent, "Every Ticks", numberInput(trigger.everyTicks || 0, function onChange(value) {
                    mutate("trigger-ticks", function apply() { trigger.everyTicks = value; });
                }));
                fieldRow(parent, "Switch ID", textInput(trigger.switchId || "", function onChange(value) {
                    mutate("trigger-switch", function apply() { trigger.switchId = value; });
                }));
                fieldRow(parent, "Enabled", checkboxInput(trigger.enabled !== false, function onChange(value) {
                    mutate("trigger-enabled", function apply() { trigger.enabled = value; });
                }));
                const del = createEl("button", "logicstudio-btn danger full", "Delete Trigger");
                del.addEventListener("click", function onDelete() {
                    mutate("delete-trigger", function apply() {
                        state.table.rulesEngine.triggers.splice(asset.index, 1);
                        state.selectedAsset = null;
                    });
                });
                parent.appendChild(del);
                return;
            }
            if (asset.kind === "switchMap") {
                const mapping = state.table.rulesEngine.switchMap[asset.index];
                if (!mapping) return;
                parent.appendChild(createEl("h3", "logicstudio-pane-title", "Switch Mapping"));
                fieldRow(parent, "Event Type", textInput(mapping.eventType || "", function onChange(value) {
                    mutate("map-event", function apply() { mapping.eventType = value; });
                }));
                fieldRow(parent, "Source ID", textInput(mapping.sourceId || "", function onChange(value) {
                    mutate("map-source", function apply() { mapping.sourceId = value; });
                }));
                fieldRow(parent, "Switch ID", textInput(mapping.switchId || "", function onChange(value) {
                    mutate("map-switch", function apply() { mapping.switchId = value; });
                }));
                const del = createEl("button", "logicstudio-btn danger full", "Delete Mapping");
                del.addEventListener("click", function onDelete() {
                    mutate("delete-switch-map", function apply() {
                        state.table.rulesEngine.switchMap.splice(asset.index, 1);
                        state.selectedAsset = null;
                    });
                });
                parent.appendChild(del);
            }
        }

        function renderConditionFields(container, node, graphId) {
            const condition = node.left ? node : {
                source: node.source || "variable",
                variableId: node.variableId || "",
                targetId: node.targetId || "",
                property: node.property || "value",
                operator: node.operator || "eq",
                value: Object.prototype.hasOwnProperty.call(node, "value") ? node.value : true
            };
            fieldRow(container, "Source", selectInput([
                { value: "variable", label: "Variable" },
                { value: "score", label: "World Score" },
                { value: "elementScore", label: "Element Score" },
                { value: "elementProperty", label: "Element Property" },
                { value: "constant", label: "Constant" }
            ], condition.source || "variable", function onChange(value) {
                mutate("condition-source", function apply() {
                    core.patchGraphNode(state.table, graphId, node.id, { source: value });
                });
            }));
            fieldRow(container, "Operator", selectInput(core.supportedOperators, condition.operator || "eq", function onChange(value) {
                mutate("condition-op", function apply() {
                    core.patchGraphNode(state.table, graphId, node.id, { operator: value });
                });
            }));
            if ((condition.source || "variable") === "variable") {
                fieldRow(container, "Variable", selectInput([""].concat(selectableVariableIds()), condition.variableId || "", function onChange(value) {
                    mutate("condition-var", function apply() {
                        core.patchGraphNode(state.table, graphId, node.id, { variableId: value });
                    });
                }));
                fieldRow(container, "Property", textInput(condition.property || "value", function onChange(value) {
                    mutate("condition-prop", function apply() {
                        core.patchGraphNode(state.table, graphId, node.id, { property: value || "value" });
                    });
                }));
            }
            if ((condition.source || "") === "elementScore" || (condition.source || "") === "elementProperty") {
                fieldRow(container, "Element", selectInput([""].concat(selectableElementIds()), condition.targetId || "", function onChange(value) {
                    mutate("condition-target", function apply() {
                        core.patchGraphNode(state.table, graphId, node.id, { targetId: value });
                    });
                }));
            }
            if ((condition.source || "") === "elementProperty") {
                fieldRow(container, "Property", textInput(condition.property || "", function onChange(value) {
                    mutate("condition-element-prop", function apply() {
                        core.patchGraphNode(state.table, graphId, node.id, { property: value });
                    });
                }));
            }
            if ((condition.source || "") !== "score") {
                fieldRow(container, "Value", textInput(JSON.stringify(condition.value), function onChange(value) {
                    mutate("condition-value", function apply() {
                        let parsed = value;
                        try { parsed = JSON.parse(value); } catch (err) {}
                        core.patchGraphNode(state.table, graphId, node.id, { value: parsed });
                    });
                }));
            }
        }

        function renderActionFields(container, node, graphId) {
            const actionType = node.actionType || "setElementScore";
            fieldRow(container, "Action Type", selectInput(core.supportedActions, actionType, function onChange(value) {
                mutate("action-type", function apply() {
                    core.patchGraphNode(state.table, graphId, node.id, { actionType: value });
                });
            }));
            const needsElement = ["setElementScore", "addElementScore", "resetElementScore", "setElementProperty", "resetElementProperty"].indexOf(actionType) >= 0;
            const needsVariable = ["setVariableProperty", "addVariableProperty", "toggleVariableProperty", "resetVariableProperty", "setLampFromVariable"].indexOf(actionType) >= 0;
            const needsLamp = ["setLamp", "clearLamp", "setLampFromVariable"].indexOf(actionType) >= 0;
            const needsValue = ["setElementScore", "addElementScore", "setElementProperty", "setVariableProperty", "addVariableProperty", "setLamp"].indexOf(actionType) >= 0;
            if (needsElement) {
                fieldRow(container, "Element", selectInput([""].concat(selectableElementIds()), node.targetId || "", function onChange(value) {
                    mutate("action-target", function apply() {
                        core.patchGraphNode(state.table, graphId, node.id, { targetId: value });
                    });
                }));
            }
            if (needsVariable) {
                fieldRow(container, "Variable", selectInput([""].concat(selectableVariableIds()), node.variableId || node.targetId || "", function onChange(value) {
                    mutate("action-var", function apply() {
                        core.patchGraphNode(state.table, graphId, node.id, { variableId: value });
                    });
                }));
                fieldRow(container, "Property", textInput(node.property || "value", function onChange(value) {
                    mutate("action-var-prop", function apply() {
                        core.patchGraphNode(state.table, graphId, node.id, { property: value || "value" });
                    });
                }));
            }
            if (needsLamp) {
                fieldRow(container, "Lamp", selectInput([""].concat(selectableLampIds()), node.lampId || node.targetId || "", function onChange(value) {
                    mutate("action-lamp", function apply() {
                        core.patchGraphNode(state.table, graphId, node.id, { lampId: value });
                    });
                }));
            }
            if (actionType === "setElementProperty" || actionType === "resetElementProperty") {
                fieldRow(container, "Property", textInput(node.property || "", function onChange(value) {
                    mutate("action-el-prop", function apply() {
                        core.patchGraphNode(state.table, graphId, node.id, { property: value });
                    });
                }));
            }
            if (needsValue) {
                fieldRow(container, "Value", textInput(JSON.stringify(node.value), function onChange(value) {
                    mutate("action-value", function apply() {
                        let parsed = value;
                        try { parsed = JSON.parse(value); } catch (err) {}
                        core.patchGraphNode(state.table, graphId, node.id, { value: parsed });
                    });
                }));
            }
        }

        function renderNodeInspector(parent) {
            const graph = getSelectedGraph();
            const node = getSelectedNode();
            if (!graph || !node) {
                parent.appendChild(createEl("p", "logicstudio-empty", "Select a node to edit."));
                return;
            }

            const card = createEl("div", "logicstudio-pane");
            card.appendChild(createEl("h3", "logicstudio-pane-title", nodeTitle(node)));
            card.appendChild(createEl("div", "logicstudio-node-meta", "Node ID: " + node.id));
            fieldRow(card, "Label", textInput(node.label || "", function onChange(value) {
                mutate("node-label", function apply() {
                    core.patchGraphNode(state.table, graph.id, node.id, { label: value });
                });
            }));
            fieldRow(card, "X", numberInput(node.x || 0, function onChange(value) {
                mutate("node-x", function apply() {
                    core.patchGraphNode(state.table, graph.id, node.id, { x: value });
                });
            }));
            fieldRow(card, "Y", numberInput(node.y || 0, function onChange(value) {
                mutate("node-y", function apply() {
                    core.patchGraphNode(state.table, graph.id, node.id, { y: value });
                });
            }));

            if (node.type === "switchStep") {
                fieldRow(card, "Switch", selectInput([""].concat(selectableSwitchIds()), node.switchId || "", function onChange(value) {
                    mutate("step-switch", function apply() {
                        core.patchGraphNode(state.table, graph.id, node.id, { switchId: value });
                    });
                }));
                fieldRow(card, "Lamp", selectInput([""].concat(selectableLampIds()), node.lampId || "", function onChange(value) {
                    mutate("step-lamp", function apply() {
                        core.patchGraphNode(state.table, graph.id, node.id, { lampId: value });
                    });
                }));
            } else if (node.type === "timedTarget") {
                fieldRow(card, "Target Switch", selectInput([""].concat(selectableSwitchIds()), node.switchId || "", function onChange(value) {
                    mutate("target-switch", function apply() {
                        core.patchGraphNode(state.table, graph.id, node.id, { switchId: value });
                    });
                }));
                fieldRow(card, "Target Lamp", selectInput([""].concat(selectableLampIds()), node.lampId || "", function onChange(value) {
                    mutate("target-lamp", function apply() {
                        core.patchGraphNode(state.table, graph.id, node.id, { lampId: value });
                    });
                }));
                fieldRow(card, "Window Seconds", numberInput(node.windowSeconds || 8, function onChange(value) {
                    mutate("target-window", function apply() {
                        core.patchGraphNode(state.table, graph.id, node.id, { windowSeconds: value });
                    });
                }));
            } else if (node.type === "award") {
                fieldRow(card, "Points", numberInput(node.awardPoints || 0, function onChange(value) {
                    mutate("award-points", function apply() {
                        core.patchGraphNode(state.table, graph.id, node.id, { awardPoints: value });
                    });
                }));
                fieldRow(card, "Event", textInput(node.awardEvent || "ruleAwarded", function onChange(value) {
                    mutate("award-event", function apply() {
                        core.patchGraphNode(state.table, graph.id, node.id, { awardEvent: value || "ruleAwarded" });
                    });
                }));
            } else if (node.type === "reset") {
                fieldRow(card, "Reset On Drain", checkboxInput(node.resetOnDrain !== false, function onChange(value) {
                    mutate("reset-drain", function apply() {
                        core.patchGraphNode(state.table, graph.id, node.id, { resetOnDrain: value });
                    });
                }));
                fieldRow(card, "Reset On Complete", checkboxInput(node.resetOnComplete !== false, function onChange(value) {
                    mutate("reset-complete", function apply() {
                        core.patchGraphNode(state.table, graph.id, node.id, { resetOnComplete: value });
                    });
                }));
                fieldRow(card, "Reset Wrong Order", checkboxInput(!!node.resetOnWrongOrder, function onChange(value) {
                    mutate("reset-wrong", function apply() {
                        core.patchGraphNode(state.table, graph.id, node.id, { resetOnWrongOrder: value });
                    });
                }));
            } else if (node.type === "condition") {
                renderConditionFields(card, node, graph.id);
            } else if (node.type === "action") {
                renderActionFields(card, node, graph.id);
            } else if (node.type === "event") {
                fieldRow(card, "Event Type", textInput(node.eventType || "switchClosed", function onChange(value) {
                    mutate("event-type", function apply() {
                        core.patchGraphNode(state.table, graph.id, node.id, { eventType: value });
                    });
                }));
                fieldRow(card, "Source ID", textInput(node.sourceId || "", function onChange(value) {
                    mutate("event-source", function apply() {
                        core.patchGraphNode(state.table, graph.id, node.id, { sourceId: value });
                    });
                }));
                fieldRow(card, "Switch ID", textInput(node.switchId || "", function onChange(value) {
                    mutate("event-switch", function apply() {
                        core.patchGraphNode(state.table, graph.id, node.id, { switchId: value });
                    });
                }));
            }

            const issues = getIssues().filter(function keep(issue) {
                return issue.id === graph.sourceRuleId || issue.id === node.id || issue.scope === "runtime";
            });
            const validity = createEl("div", "logicstudio-validity " + (issues.some(function has(issue) { return issue.severity === "error"; }) ? "error" : "ok"));
            validity.textContent = issues.length ? "Validation: " + issues.length + " issue(s)" : "Validation: no issues";
            card.appendChild(validity);
            const rule = graphRuleFor(graph);
            const preview = createEl("pre", "logicstudio-preview");
            preview.textContent = JSON.stringify(rule || {}, null, 2);
            card.appendChild(preview);
            parent.appendChild(card);
        }

        function renderBottom() {
            bottom.innerHTML = "";
            const tabs = createEl("div", "logicstudio-bottom-tabs");
            ["eventLog", "validation", "simulation", "json", "references"].forEach(function each(tabKey) {
                const names = {
                    eventLog: "Event Log",
                    validation: "Validation",
                    simulation: "Simulation",
                    json: "JSON Preview",
                    references: "References"
                };
                const button = createEl("button", "logicstudio-btn small" + (state.bottomTab === tabKey ? " active" : ""), names[tabKey]);
                button.addEventListener("click", function onPick() {
                    state.bottomTab = tabKey;
                    renderBottom();
                });
                tabs.appendChild(button);
            });
            bottom.appendChild(tabs);
            const pane = createEl("div", "logicstudio-bottom-pane");
            bottom.appendChild(pane);

            if (state.bottomTab === "validation") {
                const counts = issueCountBySeverity();
                const summary = createEl("div", "logicstudio-validation-summary", "Errors: " + (counts.error || 0) + " | Warnings: " + (counts.warning || 0) + " | Info: " + (counts.info || 0));
                pane.appendChild(summary);
                getIssues().forEach(function each(issue) {
                    const row = createEl("div", "logicstudio-validation-row " + (issue.severity || "warning"));
                    row.textContent = "[" + (issue.severity || "warning").toUpperCase() + "] " + issue.message;
                    pane.appendChild(row);
                });
                if (!getIssues().length) pane.appendChild(createEl("p", "logicstudio-empty", "No validation issues."));
                return;
            }

            if (state.bottomTab === "json") {
                const pre = createEl("pre", "logicstudio-json");
                pre.textContent = JSON.stringify(getCompiledTable().rulesEngine, null, 2);
                pane.appendChild(pre);
                return;
            }

            if (state.bottomTab === "references") {
                const assets = getAssets();
                const blocks = [
                    { title: "Switches", values: assets.switches.map(function map(item) { return item.id; }) },
                    { title: "Lamps", values: assets.lamps.map(function map(item) { return item.id; }) },
                    { title: "Variables", values: assets.variables.map(function map(item) { return item.id || item.name; }) },
                    { title: "Triggers", values: assets.triggers.map(function map(item) { return (item.id || "") + " => " + item.switchId; }) },
                    { title: "Rules", values: assets.sequenceRules.map(function map(item) { return item.id; }) }
                ];
                blocks.forEach(function each(block) {
                    pane.appendChild(createEl("h4", "logicstudio-ref-title", block.title));
                    if (!block.values.length) {
                        pane.appendChild(createEl("p", "logicstudio-empty", "None"));
                        return;
                    }
                    const list = createEl("div", "logicstudio-ref-list");
                    block.values.forEach(function eachValue(value) {
                        list.appendChild(createEl("span", "logicstudio-badge", value));
                    });
                    pane.appendChild(list);
                });
                return;
            }

            if (state.bottomTab === "eventLog") {
                const log = getSimulation().log();
                if (!log.length) {
                    pane.appendChild(createEl("p", "logicstudio-empty", "No simulation events yet."));
                    return;
                }
                log.slice(-120).forEach(function each(entry) {
                    const row = createEl("div", "logicstudio-event-row");
                    row.textContent = "[" + entry.tick + "] " + entry.type + (entry.switchId ? " (" + entry.switchId + ")" : "") + (entry.points ? " +" + entry.points : "") + (entry.synthetic ? " synthetic" : "");
                    pane.appendChild(row);
                });
                return;
            }

            if (state.bottomTab === "simulation") {
                const controls = createEl("div", "logicstudio-sim-controls");
                pane.appendChild(controls);
                const switchIds = selectableSwitchIds();
                const drainIds = (state.table.elements || []).filter(function keep(element) {
                    return element && element.type === "drain";
                }).map(function map(element) { return element.id; });
                if (!state.simulationInputSwitch && switchIds.length) state.simulationInputSwitch = switchIds[0];
                if (!state.simulationInputDrain && drainIds.length) state.simulationInputDrain = drainIds[0];

                fieldRow(controls, "Fire Switch", selectInput([""].concat(switchIds), state.simulationInputSwitch || "", function onChange(value) {
                    state.simulationInputSwitch = value;
                }));
                const fireSwitch = createEl("button", "logicstudio-btn", "Fire");
                fireSwitch.addEventListener("click", function onFire() {
                    if (!state.simulationInputSwitch) return;
                    getSimulation().fireSwitch(state.simulationInputSwitch);
                    renderBottom();
                });
                controls.appendChild(fireSwitch);

                fieldRow(controls, "Drain", selectInput([""].concat(drainIds), state.simulationInputDrain || "", function onChange(value) {
                    state.simulationInputDrain = value;
                }));
                const fireDrain = createEl("button", "logicstudio-btn", "Drain");
                fireDrain.addEventListener("click", function onDrain() {
                    if (!state.simulationInputDrain) return;
                    getSimulation().fireDrain(state.simulationInputDrain);
                    renderBottom();
                });
                controls.appendChild(fireDrain);

                fieldRow(controls, "Tick Seconds", numberInput(state.simulationDt, function onChange(value) {
                    state.simulationDt = Math.max(0, value);
                }));
                const tick = createEl("button", "logicstudio-btn", "Tick");
                tick.addEventListener("click", function onTick() {
                    getSimulation().tick(state.simulationDt, 1);
                    renderBottom();
                });
                controls.appendChild(tick);

                const reset = createEl("button", "logicstudio-btn danger", "Reset Sim");
                reset.addEventListener("click", function onReset() {
                    getSimulation().reset();
                    renderBottom();
                });
                controls.appendChild(reset);

                const snap = getSimulation().snapshot();
                const pre = createEl("pre", "logicstudio-json");
                pre.textContent = JSON.stringify(snap, null, 2);
                pane.appendChild(pre);
            }
        }

        function renderAll() {
            ensureGraphSelection();
            renderToolbar();
            renderSidebar();
            renderCanvas();
            renderInspector();
            renderBottom();
        }

        function applyCanvasPan(dx, dy) {
            state.graphView.panX += dx;
            state.graphView.panY += dy;
            renderCanvas();
        }

        function zoomCanvas(factor) {
            state.graphView.zoom = Math.max(0.35, Math.min(2.4, state.graphView.zoom * factor));
            renderCanvas();
        }

        function onPointerMove(evt) {
            if (state.dragNode) {
                const graph = getSelectedGraph();
                if (!graph) return;
                const node = (graph.nodes || []).find(function find(item) { return item && item.id === state.dragNode.nodeId; });
                if (!node) return;
                const dx = (evt.clientX - state.dragNode.startX) / state.graphView.zoom;
                const dy = (evt.clientY - state.dragNode.startY) / state.graphView.zoom;
                node.x = Math.round((state.dragNode.nodeX + dx) / GRID_SIZE) * GRID_SIZE;
                node.y = Math.round((state.dragNode.nodeY + dy) / GRID_SIZE) * GRID_SIZE;
                core.syncRulesFromGraphs(state.table);
                invalidateDerived();
                renderCanvas();
                renderInspector();
                return;
            }
            if (state.dragCanvas) {
                const dx = evt.clientX - state.dragCanvas.startX;
                const dy = evt.clientY - state.dragCanvas.startY;
                applyCanvasPan(dx, dy);
                state.dragCanvas.startX = evt.clientX;
                state.dragCanvas.startY = evt.clientY;
            }
        }

        function onPointerUp() {
            state.dragNode = null;
            state.dragCanvas = null;
        }

        canvasShell.addEventListener("mousedown", function onCanvasDown(evt) {
            if (evt.button === 1 || evt.button === 2 || evt.altKey) {
                evt.preventDefault();
                state.dragCanvas = { startX: evt.clientX, startY: evt.clientY };
                return;
            }
            if (evt.target === canvasShell || evt.target === canvasViewport || evt.target === canvasEdges) {
                state.selectedNodeId = "";
                state.linkSourceNodeId = "";
                state.selectedAsset = { kind: "graph", id: state.selectedGraphId };
                renderInspector();
                renderCanvas();
            }
        });
        canvasShell.addEventListener("wheel", function onCanvasWheel(evt) {
            evt.preventDefault();
            zoomCanvas(evt.deltaY < 0 ? 1.08 : 0.92);
        }, { passive: false });
        canvasShell.addEventListener("contextmenu", function onContext(evt) {
            evt.preventDefault();
        });
        window.addEventListener("mousemove", onPointerMove);
        window.addEventListener("mouseup", onPointerUp);

        window.addEventListener("keydown", function onKeyDown(evt) {
            const selected = getSelectedNode();
            if (evt.key === "Delete" && selected && getSelectedGraph()) {
                evt.preventDefault();
                mutate("delete-key", function apply() {
                    core.removeGraphNode(state.table, getSelectedGraph().id, selected.id);
                    state.selectedNodeId = "";
                });
            }
            if ((evt.ctrlKey || evt.metaKey) && evt.key.toLowerCase() === "z") {
                evt.preventDefault();
                const previous = state.undo.pop();
                if (!previous) return;
                state.table = core.normalizeTable(previous);
                state.selectedAsset = null;
                ensureGraphSelection();
                invalidateDerived();
                renderAll();
            }
            if ((evt.ctrlKey || evt.metaKey) && evt.key.toLowerCase() === "c" && selected) {
                evt.preventDefault();
                state.clipboardNode = clone(selected);
                delete state.clipboardNode.id;
            }
            if ((evt.ctrlKey || evt.metaKey) && evt.key.toLowerCase() === "v" && state.clipboardNode && getSelectedGraph()) {
                evt.preventDefault();
                mutate("paste-node", function apply() {
                    const source = selected || { x: 120, y: 120 };
                    const payload = clone(state.clipboardNode);
                    const pasted = core.addGraphNode(state.table, getSelectedGraph().id, payload.type || "note", {
                        x: (source.x || 0) + 24,
                        y: (source.y || 0) + 24
                    }, payload);
                    if (pasted) state.selectedNodeId = pasted.id;
                });
            }
        });

        ensureGraphSelection();
        invalidateDerived();
        renderAll();
        root._pinballCleanup = function cleanupLogicStudio() {
            window.removeEventListener("mousemove", onPointerMove);
            window.removeEventListener("mouseup", onPointerUp);
        };
    }

    /*
     * What: Mount a user-focused TBGameLogic v2 editor at the #logic route.
     * Why: designers should author features directly and compile to runtime
     *      rules, while legacy graph editing remains an advanced fallback.
     */
    function mountUserLogicStudio(root, options) {
        const table = core.normalizeTable(clone((options && options.table) || Pin.table.createEmptyTable()));
        let source = Pin.gameLogicV2 && Pin.gameLogicV2.scaffoldFromTable ?
            Pin.gameLogicV2.scaffoldFromTable(table, (table.name || "Table") + " Logic") :
            { version: 2, shots: [], features: [], modes: [], awards: [], resets: [] };
        let lastIssues = [];
        let activeUserTab = "author";

        root.innerHTML = "";
        const wrap = createEl("div", "logicstudio-layout logicdesigner-layout");
        const left = createEl("aside", "logicstudio-sidebar");
        const main = createEl("main", "logicstudio-main");
        wrap.appendChild(left);
        wrap.appendChild(main);
        root.appendChild(wrap);

        const header = createEl("div", "logicstudio-toolbar");
        const title = createEl("div", "logicstudio-title", "Game Logic");
        const actions = createEl("div", "logicstudio-toolbar-actions");
        header.appendChild(title);
        header.appendChild(actions);
        main.appendChild(header);

        const editorPane = createEl("section", "logicstudio-canvas-shell");
        const issuesPane = createEl("section", "logicstudio-bottom");
        main.appendChild(editorPane);
        main.appendChild(issuesPane);

        function sourceSafe() {
            source = Pin.gameLogicV2 && Pin.gameLogicV2.normalize ? Pin.gameLogicV2.normalize(source || {}) : (source || {});
            return source;
        }

        function renderIssues(issues) {
            lastIssues = issues || [];
            issuesPane.innerHTML = "";
            const head = createEl("h3", "logicstudio-bottom-title", "Validation");
            issuesPane.appendChild(head);
            if (!issues.length) {
                issuesPane.appendChild(createEl("p", "logicstudio-empty", "No validation issues."));
                return;
            }
            issues.forEach(function each(issue) {
                const row = createEl("div", "logicstudio-issue-row");
                row.textContent = "[" + (issue.severity || "warning") + "] " + (issue.message || "Issue");
                issuesPane.appendChild(row);
            });
        }

        function validateSource() {
            const issues = Pin.gameLogicV2 && Pin.gameLogicV2.validate ? Pin.gameLogicV2.validate(sourceSafe(), table) : [];
            renderIssues(issues);
            return issues;
        }

        /*
         * What: Compile the authored game logic source into runtime table JSON.
         * Why: play mode and existing runtime require low-level rulesEngine data.
         */
        function compileToRuntimeTable() {
            if (!Pin.gameLogicV2 || !Pin.gameLogicV2.compile) {
                renderIssues([{ severity: "error", message: "Logic compiler unavailable." }]);
                return null;
            }
            const compiled = Pin.gameLogicV2.compile(sourceSafe(), table);
            const compileSummary = compiled && compiled.table && compiled.table.rulesEngine ? {
                severity: "info",
                message: "Compiled " + ((compiled.table.rulesEngine.sequenceRules || []).length) + " playable rules."
            } : null;
            const issueList = (compiled.issues || []).slice();
            if (compileSummary) issueList.unshift(compileSummary);
            renderIssues(issueList);
            if (!compiled.ok) return null;
            return compiled.table;
        }

        function field(parent, label, value, onChange) {
            const row = createEl("label", "logicstudio-field");
            const title = createEl("span", "logicstudio-field-label", label);
            const input = createEl("input", "logicstudio-input");
            input.type = "text";
            input.value = value == null ? "" : String(value);
            input.addEventListener("change", function onInput() { onChange(input.value); });
            row.appendChild(title);
            row.appendChild(input);
            parent.appendChild(row);
            return input;
        }

        function numberField(parent, label, value, onChange) {
            const row = createEl("label", "logicstudio-field");
            const title = createEl("span", "logicstudio-field-label", label);
            const input = createEl("input", "logicstudio-input");
            input.type = "number";
            input.value = String(typeof value === "number" ? value : 0);
            input.addEventListener("change", function onInput() { onChange(Number(input.value)); });
            row.appendChild(title);
            row.appendChild(input);
            parent.appendChild(row);
            return input;
        }

        function boolField(parent, label, value, onChange) {
            const row = createEl("label", "logicstudio-field");
            const title = createEl("span", "logicstudio-field-label", label);
            const input = createEl("input", "logicstudio-input");
            input.type = "checkbox";
            input.checked = !!value;
            input.addEventListener("change", function onInput() { onChange(!!input.checked); });
            row.appendChild(title);
            row.appendChild(input);
            parent.appendChild(row);
            return input;
        }

        function selectField(parent, label, options, value, onChange) {
            const row = createEl("label", "logicstudio-field");
            const title = createEl("span", "logicstudio-field-label", label);
            const select = createEl("select", "logicstudio-input");
            (options || []).forEach(function each(option) {
                const opt = document.createElement("option");
                if (typeof option === "string") {
                    opt.value = option;
                    opt.textContent = option || "(blank)";
                } else {
                    opt.value = option.value || "";
                    opt.textContent = option.label || option.value || "(blank)";
                }
                select.appendChild(opt);
            });
            select.value = value || "";
            select.addEventListener("change", function onInput() { onChange(select.value); });
            row.appendChild(title);
            row.appendChild(select);
            parent.appendChild(row);
            return select;
        }

        function completeExprField(parent, label, value, idOptions, onChange) {
            const row = createEl("div", "logicstudio-field");
            const title = createEl("span", "logicstudio-field-label", label);
            const wrap = createEl("div", "logicstudio-ref-list");
            const select = createEl("select", "logicstudio-input");
            const blank = document.createElement("option");
            blank.value = "";
            blank.textContent = "(none)";
            select.appendChild(blank);
            (idOptions || []).forEach(function each(option) {
                const opt = document.createElement("option");
                opt.value = option.value || "";
                opt.textContent = option.label || option.value || "(blank)";
                select.appendChild(opt);
            });
            const currentExpr = String(value || "").trim();
            const matched = /^([a-z0-9_:-]+)\.complete$/i.exec(currentExpr);
            if (matched) select.value = matched[1];
            select.addEventListener("change", function onPick() {
                const picked = String(select.value || "").trim();
                onChange(picked ? (picked + ".complete") : "");
            });
            const text = createEl("input", "logicstudio-input");
            text.type = "text";
            text.value = currentExpr;
            text.placeholder = "feature_id.complete";
            text.addEventListener("change", function onText() {
                onChange(text.value || "");
            });
            wrap.appendChild(select);
            wrap.appendChild(text);
            row.appendChild(title);
            row.appendChild(wrap);
            parent.appendChild(row);
        }

        function removeButton(parent, onClick) {
            const row = createEl("div", "logicstudio-field");
            const btn = createEl("button", "logicstudio-btn danger", "Remove");
            btn.type = "button";
            btn.addEventListener("click", onClick);
            row.appendChild(createEl("span", "logicstudio-field-label", ""));
            row.appendChild(btn);
            parent.appendChild(row);
        }

        function shotName(shotId) {
            const shot = (sourceSafe().shots || []).find(function find(item) {
                return item && item.id === shotId;
            });
            return (shot && (shot.name || shot.id)) || shotId || "";
        }

        function cardHeader(parent, label, title, meta) {
            const head = createEl("div", "logic-designer-card-head");
            const text = createEl("div", "logic-designer-card-title");
            text.appendChild(createEl("span", "logic-designer-card-label", label));
            text.appendChild(createEl("strong", "", title || label));
            if (meta) text.appendChild(createEl("small", "", meta));
            head.appendChild(text);
            parent.appendChild(head);
            return head;
        }

        function detailGroup(parent, label) {
            const details = document.createElement("details");
            details.className = "logic-designer-details";
            const summary = document.createElement("summary");
            summary.textContent = label;
            details.appendChild(summary);
            parent.appendChild(details);
            return details;
        }

        function typeButtonRow(parent, currentType, onChange) {
            const row = createEl("div", "logic-designer-type-row");
            [
                { value: "set", label: "Set" },
                { value: "sequence", label: "Sequence" }
            ].forEach(function each(option) {
                const btn = createEl("button", "logicstudio-btn" + (currentType === option.value || (option.value === "set" && currentType === "set_completion") ? " active" : ""), option.label);
                btn.type = "button";
                btn.addEventListener("click", function choose() { onChange(option.value); });
                row.appendChild(btn);
            });
            parent.appendChild(row);
        }

        function optionsFromTableSwitches() {
            return ((table.elements || []).filter(function keep(element) {
                return element && element.id && ["lane", "scoreZone", "spinner", "gate", "valve", "drain", "launcher", "dropTarget", "bumper", "kicker", "trough"].indexOf(element.type) >= 0;
            }).map(function map(element) {
                const label = (element.name || element.label || element.id) + " (" + element.id + ")";
                return { value: element.id, label: label };
            }));
        }

        function optionsFromTableLamps() {
            return ((table.elements || []).filter(function keep(element) {
                return element && element.id && ["light", "arrowLight", "boxLight"].indexOf(element.type) >= 0;
            }).map(function map(element) {
                const lampId = element.lampId || element.id;
                const label = (element.name || element.label || lampId) + " (" + lampId + ")";
                return { value: lampId, label: label };
            }));
        }

        function unique(values) {
            const out = [];
            (values || []).forEach(function each(value) {
                const normalized = String(value || "").trim();
                if (!normalized) return;
                if (out.indexOf(normalized) >= 0) return;
                out.push(normalized);
            });
            return out;
        }

        function multiValueEditor(parent, label, currentValues, options, onChange) {
            const wrap = createEl("div", "logicstudio-field");
            const title = createEl("span", "logicstudio-field-label", label);
            const controls = createEl("div", "logicstudio-ref-list");
            const selected = unique(currentValues);

            const select = createEl("select", "logicstudio-input");
            const blank = document.createElement("option");
            blank.value = "";
            blank.textContent = "(select)";
            select.appendChild(blank);
            (options || []).forEach(function each(option) {
                const opt = document.createElement("option");
                opt.value = option.value || "";
                opt.textContent = option.label || option.value || "(blank)";
                select.appendChild(opt);
            });
            const add = createEl("button", "logicstudio-btn", "Add");
            add.type = "button";
            add.addEventListener("click", function onAdd() {
                const value = String(select.value || "").trim();
                if (!value) return;
                if (selected.indexOf(value) >= 0) return;
                onChange(selected.concat([value]));
                renderStructuredEditor();
                validateSource();
            });
            controls.appendChild(select);
            controls.appendChild(add);

            const tokens = createEl("div", "logicstudio-ref-list");
            if (!selected.length) {
                tokens.appendChild(createEl("span", "logicstudio-empty", "None"));
            } else {
                selected.forEach(function eachValue(value) {
                    const token = createEl("span", "logicstudio-badge", value);
                    token.style.cursor = "pointer";
                    token.title = "Click to remove";
                    token.addEventListener("click", function onRemove() {
                        onChange(selected.filter(function keep(item) { return item !== value; }));
                        renderStructuredEditor();
                        validateSource();
                    });
                    tokens.appendChild(token);
                });
            }
            wrap.appendChild(title);
            const content = createEl("div", "logicstudio-ref-list");
            content.appendChild(controls);
            content.appendChild(tokens);
            wrap.appendChild(content);
            parent.appendChild(wrap);
        }

        function section(parent, titleText, addLabel, onAdd) {
            const container = createEl("section", "logicstudio-bottom");
            const titleNode = createEl("h3", "logicstudio-bottom-title", titleText);
            container.appendChild(titleNode);
            if (addLabel && onAdd) {
                const btn = createEl("button", "logicstudio-btn", addLabel);
                btn.type = "button";
                btn.addEventListener("click", onAdd);
                container.appendChild(btn);
            }
            parent.appendChild(container);
            return container;
        }

        function renderUserTabButtons(parent) {
            const row = createEl("div", "logicstudio-toolbar-group");
            [
                { id: "author", label: "Author" },
                { id: "preview", label: "Preview" },
                { id: "advanced", label: "Advanced" }
            ].forEach(function each(tab) {
                const btn = createEl("button", "logicstudio-btn" + (activeUserTab === tab.id ? " active" : ""), tab.label);
                btn.type = "button";
                btn.addEventListener("click", function choose() {
                    activeUserTab = tab.id;
                    renderStructuredEditor();
                });
                row.appendChild(btn);
            });
            parent.appendChild(row);
        }

        function featureSummary(feature) {
            const type = String((feature && feature.type) || "set");
            const name = (feature && (feature.name || feature.id)) || "Feature";
            const shots = unique((feature && feature.shots) || []);
            const shotText = shots.length ? shots.map(shotName).join(" + ") : "(no shots)";
            const orderText = feature && feature.ordered === false ? "any order" : "in order";
            return name + ": complete " + shotText + " (" + orderText + ")" + (type === "sequence" ? " as a sequence" : "");
        }

        function completeExprText(expr) {
            const match = /^([a-z0-9_:-]+)\.complete$/i.exec(String(expr || "").trim());
            if (!match) return expr || "nothing selected";
            const feature = (sourceSafe().features || []).find(function find(item) { return item && item.id === match[1]; });
            return (feature && (feature.name || feature.id)) || match[1];
        }

        function renderPreviewTab(parent) {
            const previewSection = section(parent, "Readable Preview", "", null);
            const rules = sourceSafe();
            (rules.features || []).forEach(function each(feature) {
                const row = createEl("p", "logicstudio-empty", featureSummary(feature));
                previewSection.appendChild(row);
            });
            (rules.modes || []).forEach(function each(mode) {
                const name = mode.name || mode.id || "Mode";
                const start = completeExprText(mode.startsWhen);
                const duration = typeof mode.durationSeconds === "number" ? mode.durationSeconds + "s" : "untimed";
                previewSection.appendChild(createEl("p", "logicstudio-empty", "Mode " + name + " starts when " + start + " and runs " + duration + "."));
            });
            (rules.awards || []).forEach(function each(award) {
                const name = award.name || award.id || "Award";
                previewSection.appendChild(createEl("p", "logicstudio-empty", "Collect " + name + " lights after " + completeExprText(award.litWhen) + " and collects on " + (award.collectShot ? shotName(award.collectShot) : "nothing selected") + "."));
            });
            if (!(rules.features || []).length && !(rules.modes || []).length && !(rules.awards || []).length) {
                previewSection.appendChild(createEl("p", "logicstudio-empty", "No designer features yet. Add shots and features in Author."));
            }

            const compiledSection = section(parent, "Compiled Snapshot", "Compile Now", function compileNow() {
                compileToRuntimeTable();
                renderStructuredEditor();
            });
            const compiled = Pin.gameLogicV2 && Pin.gameLogicV2.compile ? Pin.gameLogicV2.compile(sourceSafe(), table) : null;
            if (!compiled || !compiled.table || !compiled.table.rulesEngine) {
                compiledSection.appendChild(createEl("p", "logicstudio-empty", "Compiler unavailable."));
                return;
            }
            const engine = compiled.table.rulesEngine || {};
            compiledSection.appendChild(createEl("p", "logicstudio-empty",
                "Playable rules: " + ((engine.sequenceRules || []).length) +
                " | State flags: " + ((engine.variables || []).length) +
                " | Timers: " + ((engine.triggers || []).length)
            ));
            (engine.sequenceRules || []).forEach(function eachRule(rule) {
                const line = (rule.name || rule.id || "Rule") + ": when " + ((rule.steps || []).join(", ") || "nothing") + " happens, award " + (rule.awardPoints || 0) + " points.";
                compiledSection.appendChild(createEl("p", "logicstudio-empty", line));
            });
        }

        function renderAdvancedTab(parent) {
            const advancedSection = section(parent, "Advanced", "", null);
            const advancedActions = createEl("div", "logicstudio-toolbar-group");
            [
                { label: "Import Source", onClick: function onImportSource() {
                    Pin.storage.file.import().then(function loaded(payload) {
                        source = Pin.gameLogicV2 && Pin.gameLogicV2.normalize ? Pin.gameLogicV2.normalize(payload || {}) : (payload || {});
                        activeUserTab = "author";
                        renderStructuredEditor();
                        validateSource();
                    }).catch(function failed(err) {
                        renderIssues([{ severity: "error", message: "Import failed: " + (err && err.message ? err.message : err) }]);
                    });
                } },
                { label: "Export Source", onClick: function onExportSource() {
                    const blob = new Blob([JSON.stringify(sourceSafe(), null, 2)], { type: "application/json" });
                    const a = document.createElement("a");
                    a.href = URL.createObjectURL(blob);
                    a.download = ((table.name || "table").replace(/[^a-z0-9_-]+/gi, "_")) + ".game-logic.json";
                    a.click();
                    URL.revokeObjectURL(a.href);
                } },
                { label: "Export Runtime", onClick: function onExportRuntime() {
                    const compiledTable = compileToRuntimeTable();
                    if (compiledTable) Pin.storage.file.export(compiledTable);
                } },
                { label: "Open Runtime Graphs", onClick: function onLegacy() { location.hash = "#logicstudio"; } }
            ].forEach(function each(def) {
                const btn = createEl("button", "logicstudio-btn", def.label);
                btn.type = "button";
                btn.addEventListener("click", def.onClick);
                advancedActions.appendChild(btn);
            });
            advancedSection.appendChild(advancedActions);
            const raw = document.createElement("textarea");
            raw.className = "logicstudio-json";
            raw.style.width = "100%";
            raw.style.minHeight = "320px";
            raw.value = JSON.stringify(source, null, 2);
            advancedSection.appendChild(raw);
            const applyRaw = createEl("button", "logicstudio-btn", "Apply Raw JSON");
            applyRaw.type = "button";
            applyRaw.addEventListener("click", function onApplyRaw() {
                try {
                    source = Pin.gameLogicV2 && Pin.gameLogicV2.normalize ? Pin.gameLogicV2.normalize(JSON.parse(raw.value || "{}")) : JSON.parse(raw.value || "{}");
                    validateSource();
                    renderStructuredEditor();
                } catch (err) {
                    renderIssues([{ severity: "error", message: "Invalid JSON: " + err.message }].concat(lastIssues || []));
                }
            });
            advancedSection.appendChild(applyRaw);
            advancedSection.appendChild(createEl("p", "logicstudio-empty", "Low-level debugging and graph editing remain in #logicstudio."));
        }

        function renderStructuredEditor() {
            sourceSafe();
            editorPane.innerHTML = "";
            renderUserTabButtons(editorPane);
            if (activeUserTab === "preview") {
                renderPreviewTab(editorPane);
                return;
            }
            if (activeUserTab === "advanced") {
                renderAdvancedTab(editorPane);
                return;
            }
            const shotIds = (source.shots || []).map(function map(shot) { return shot && shot.id; }).filter(Boolean);

            const shotsSection = section(editorPane, "Shots", "Add Shot", function onAddShot() {
                source.shots.push({ id: toId("shot", "shot"), name: "Shot", switches: [], lamps: [], baseScore: 0 });
                renderStructuredEditor();
                validateSource();
            });
            const tableSwitchOptions = optionsFromTableSwitches();
            const tableLampOptions = optionsFromTableLamps();
            const featureIdOptions = (source.features || []).map(function map(feature) {
                const id = String((feature && feature.id) || "").trim();
                if (!id) return null;
                return { value: id, label: id };
            }).filter(Boolean);
            (source.shots || []).forEach(function eachShot(shot, index) {
                const card = createEl("div", "anchor-card");
                const switchText = (shot.switches || []).length ? "Triggered by " + (shot.switches || []).join(", ") : "No trigger bound";
                cardHeader(card, "Shot", shot.name || shot.id || "Shot", switchText);
                field(card, "Name", shot.name || "", function onChange(value) { shot.name = value; });
                multiValueEditor(card, "Trigger switch", shot.switches, tableSwitchOptions, function onChange(values) { shot.switches = values; });
                multiValueEditor(card, "Light when hit", shot.lamps, tableLampOptions, function onChange(values) { shot.lamps = values; });
                numberField(card, "Base score", typeof shot.baseScore === "number" ? shot.baseScore : 0, function onChange(value) { shot.baseScore = asNumber(value, 0); });
                const identity = detailGroup(card, "Identity");
                field(identity, "Machine id", shot.id || "", function onChange(value) { shot.id = toId(value || ("shot_" + (index + 1)), "shot"); validateSource(); });
                removeButton(card, function onRemove() { source.shots.splice(index, 1); renderStructuredEditor(); validateSource(); });
                shotsSection.appendChild(card);
            });

            const featuresSection = section(editorPane, "Features", "Add Feature", function onAddFeature() {
                source.features.push({ id: toId("feature", "feature"), type: "set", name: "Feature", shots: [], ordered: false, onComplete: { light: [], enable: [], award: 0 }, reset: "" });
                renderStructuredEditor();
                validateSource();
            });
            (source.features || []).forEach(function eachFeature(feature, index) {
                feature.onComplete = feature.onComplete || { light: [], enable: [], award: 0 };
                const card = createEl("div", "anchor-card");
                cardHeader(card, feature.type === "sequence" ? "Sequence" : "Set", feature.name || feature.id || "Feature", featureSummary(feature));
                field(card, "Name", feature.name || "", function onChange(value) { feature.name = value; });
                typeButtonRow(card, feature.type || "set", function onChange(value) {
                    feature.type = value;
                    feature.ordered = value === "sequence" ? true : feature.ordered;
                    validateSource();
                    renderStructuredEditor();
                });
                multiValueEditor(card, "Shots to complete", feature.shots, shotIds.map(function map(id) { return { value: id, label: shotName(id) }; }), function onChange(values) { feature.shots = values; validateSource(); });
                boolField(card, "Complete in order", feature.ordered !== false, function onChange(value) { feature.ordered = value; });
                numberField(card, "Award points", Number(feature.onComplete.award) || 0, function onChange(value) { feature.onComplete.award = asNumber(value, 0); });
                multiValueEditor(card, "Light on complete", feature.onComplete.light, tableLampOptions, function onChange(values) { feature.onComplete.light = values; });
                selectField(card, "Reset", [{ value: "", label: "Keep completed" }, { value: "on_ball_drain", label: "On ball drain" }], feature.reset || "", function onChange(value) { feature.reset = value; });
                const identity = detailGroup(card, "Advanced");
                field(identity, "Machine id", feature.id || "", function onChange(value) { feature.id = toId(value || ("feature_" + (index + 1)), "feature"); validateSource(); });
                multiValueEditor(identity, "Enable flags", feature.onComplete.enable, [], function onChange(values) { feature.onComplete.enable = values; });
                removeButton(card, function onRemove() { source.features.splice(index, 1); renderStructuredEditor(); validateSource(); });
                featuresSection.appendChild(card);
            });

            const modesSection = section(editorPane, "Modes", "Add Mode", function onAddMode() {
                source.modes.push({ id: toId("mode", "mode"), startsWhen: "", durationSeconds: 20, effects: [] });
                renderStructuredEditor();
                validateSource();
            });
            (source.modes || []).forEach(function eachMode(mode, index) {
                mode.effects = Array.isArray(mode.effects) ? mode.effects : [];
                const card = createEl("div", "anchor-card");
                cardHeader(card, "Mode", mode.name || mode.id || "Mode", "Starts after " + (mode.startsWhen || "a feature completes"));
                field(card, "Name", mode.name || "", function onChange(value) { mode.name = value; });
                completeExprField(card, "Starts after", mode.startsWhen || "", featureIdOptions, function onChange(value) { mode.startsWhen = value; validateSource(); });
                numberField(card, "Duration seconds", Number(mode.durationSeconds) || 0, function onChange(value) { mode.durationSeconds = asNumber(value, 0); });
                const effectWrap = createEl("div", "logicstudio-field");
                effectWrap.appendChild(createEl("span", "logicstudio-field-label", "During mode"));
                const effectBody = createEl("div", "logicstudio-ref-list");
                if (!mode.effects.length) {
                    effectBody.appendChild(createEl("p", "logicstudio-empty", "No mode effects"));
                } else {
                    mode.effects.forEach(function eachEffect(effect, effectIndex) {
                        const effectCard = createEl("div", "anchor-card");
                        selectField(effectCard, "type", [
                            { value: "scoreMultiplier", label: "Multiply shot score" },
                            { value: "flashLamp", label: "Flash lamp" },
                            { value: "lampOn", label: "Turn lamp on" }
                        ], effect.type || "scoreMultiplier", function onType(value) {
                            effect.type = value;
                            if (value === "scoreMultiplier") {
                                if (!effect.shot) effect.shot = shotIds[0] || "";
                                if (typeof effect.multiplier !== "number") effect.multiplier = 2;
                                delete effect.lamp;
                            } else {
                                if (!effect.lamp) effect.lamp = ((tableLampOptions[0] || {}).value || "");
                                delete effect.shot;
                                delete effect.multiplier;
                            }
                            renderStructuredEditor();
                            validateSource();
                        });
                        if (effect.type === "scoreMultiplier") {
                            selectField(effectCard, "Shot", [{ value: "", label: "(none)" }].concat(shotIds.map(function map(id) { return { value: id, label: shotName(id) }; })), effect.shot || "", function onShot(value) {
                                effect.shot = value;
                                validateSource();
                            });
                            numberField(effectCard, "Multiplier", Number(effect.multiplier) || 1, function onMultiplier(value) {
                                effect.multiplier = Math.max(0, asNumber(value, 1));
                                validateSource();
                            });
                        } else {
                            selectField(effectCard, "Lamp", [{ value: "", label: "(none)" }].concat(tableLampOptions), effect.lamp || "", function onLamp(value) {
                                effect.lamp = value;
                                validateSource();
                            });
                        }
                        const removeEffect = createEl("button", "logicstudio-btn danger", "Remove Effect");
                        removeEffect.type = "button";
                        removeEffect.addEventListener("click", function onRemoveEffect() {
                            mode.effects.splice(effectIndex, 1);
                            renderStructuredEditor();
                            validateSource();
                        });
                        effectCard.appendChild(removeEffect);
                        effectBody.appendChild(effectCard);
                    });
                }
                const addEffectRow = createEl("div", "logicstudio-ref-list");
                const addEffectType = createEl("select", "logicstudio-input");
                [
                    { value: "scoreMultiplier", label: "Multiply shot score" },
                    { value: "flashLamp", label: "Flash lamp" },
                    { value: "lampOn", label: "Turn lamp on" }
                ].forEach(function eachOption(option) {
                    const opt = document.createElement("option");
                    opt.value = option.value;
                    opt.textContent = option.label;
                    addEffectType.appendChild(opt);
                });
                const addEffectBtn = createEl("button", "logicstudio-btn", "Add Effect");
                addEffectBtn.type = "button";
                addEffectBtn.addEventListener("click", function onAddEffect() {
                    const kind = addEffectType.value || "scoreMultiplier";
                    if (kind === "scoreMultiplier") {
                        mode.effects.push({ type: "scoreMultiplier", shot: shotIds[0] || "", multiplier: 2 });
                    } else {
                        mode.effects.push({ type: kind, lamp: ((tableLampOptions[0] || {}).value || "") });
                    }
                    renderStructuredEditor();
                    validateSource();
                });
                addEffectRow.appendChild(addEffectType);
                addEffectRow.appendChild(addEffectBtn);
                effectBody.appendChild(addEffectRow);
                effectWrap.appendChild(effectBody);
                card.appendChild(effectWrap);
                const identity = detailGroup(card, "Identity");
                field(identity, "Machine id", mode.id || "", function onChange(value) { mode.id = toId(value || ("mode_" + (index + 1)), "mode"); validateSource(); });
                removeButton(card, function onRemove() { source.modes.splice(index, 1); renderStructuredEditor(); validateSource(); });
                modesSection.appendChild(card);
            });

            const awardsSection = section(editorPane, "Awards", "Add Award", function onAddAward() {
                source.awards.push({ id: toId("award", "award"), litWhen: "", collectShot: shotIds[0] || "", award: 1000, onCollect: [] });
                renderStructuredEditor();
                validateSource();
            });
            (source.awards || []).forEach(function eachAward(award, index) {
                const card = createEl("div", "anchor-card");
                cardHeader(card, "Collect", award.name || award.id || "Award", "Collect on " + (award.collectShot ? shotName(award.collectShot) : "a shot"));
                field(card, "Name", award.name || "", function onChange(value) { award.name = value; });
                completeExprField(card, "Lights after", award.litWhen || "", featureIdOptions, function onChange(value) { award.litWhen = value; validateSource(); });
                selectField(card, "Collect shot", [{ value: "", label: "(none)" }].concat(shotIds.map(function map(id) { return { value: id, label: shotName(id) }; })), award.collectShot || "", function onChange(value) { award.collectShot = value; validateSource(); });
                numberField(card, "Award points", Number(award.award) || 0, function onChange(value) { award.award = asNumber(value, 0); });
                multiValueEditor(card, "Light after collect", award.onCollect, tableLampOptions.map(function map(option) {
                    return { value: "light:" + option.value, label: "light:" + option.value };
                }), function onChange(values) { award.onCollect = values; });
                const identity = detailGroup(card, "Identity");
                field(identity, "Machine id", award.id || "", function onChange(value) { award.id = toId(value || ("award_" + (index + 1)), "award"); validateSource(); });
                removeButton(card, function onRemove() { source.awards.splice(index, 1); renderStructuredEditor(); validateSource(); });
                awardsSection.appendChild(card);
            });

            const resetsSection = section(editorPane, "Resets", "Add Reset Group", function onAddReset() {
                source.resets.push({ onDrain: [], onCollect: [] });
                renderStructuredEditor();
                validateSource();
            });
            (source.resets || []).forEach(function eachReset(reset, index) {
                const card = createEl("div", "anchor-card");
                cardHeader(card, "Reset", "Reset policy", "Clears selected features or awards.");
                multiValueEditor(card, "On ball drain", reset.onDrain, (source.features || []).map(function map(feature) { return { value: feature.id || "", label: feature.name || feature.id || "" }; }).concat((source.modes || []).map(function map(mode) { return { value: mode.id || "", label: mode.name || mode.id || "" }; })), function onChange(values) { reset.onDrain = values; });
                multiValueEditor(card, "On collect", reset.onCollect, (source.awards || []).map(function map(award) { return { value: award.id || "", label: award.name || award.id || "" }; }), function onChange(values) { reset.onCollect = values; });
                removeButton(card, function onRemove() { source.resets.splice(index, 1); renderStructuredEditor(); validateSource(); });
                resetsSection.appendChild(card);
            });

        }

        function button(label, onClick, className) {
            const btn = createEl("button", "logicstudio-btn" + (className ? " " + className : ""), label);
            btn.type = "button";
            btn.addEventListener("click", onClick);
            actions.appendChild(btn);
            return btn;
        }

        button("Validate", function onValidate() {
            validateSource();
        });
        button("Compile", function onCompile() {
            compileToRuntimeTable();
        });
        button("Scaffold", function onScaffold() {
            source = Pin.gameLogicV2 && Pin.gameLogicV2.scaffoldFromTable ?
                Pin.gameLogicV2.scaffoldFromTable(table, (table.name || "Table") + " Logic") :
                source;
            renderStructuredEditor();
            validateSource();
        });
        button("Test Play", function onTestPlay() {
            const compiledTable = compileToRuntimeTable();
            if (!compiledTable) return;
            Pin.storage.local.save("autosave", compiledTable);
            location.hash = "#play&t=" + Pin.storage.url.encode(compiledTable);
        });
        button("Design Mode", function onDesign() {
            location.hash = "#design&t=" + Pin.storage.url.encode(table);
        });

        left.appendChild(createEl("h3", "logicstudio-sidebar-title", "Authoring Model"));
        left.appendChild(createEl("p", "logicstudio-empty", "Shots: " + (sourceSafe().shots || []).length));
        left.appendChild(createEl("p", "logicstudio-empty", "Features: " + (sourceSafe().features || []).length));
        left.appendChild(createEl("p", "logicstudio-empty", "Modes: " + (sourceSafe().modes || []).length));
        left.appendChild(createEl("p", "logicstudio-empty", "Collects: " + (sourceSafe().awards || []).length));

        renderStructuredEditor();
        validateSource();
    }

    Pin.logicStudio = {
        mount: mountUserLogicStudio,
        mountLegacy: mountLogicStudio
    };
})(window.Pin);
