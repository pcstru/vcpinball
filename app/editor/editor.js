(function initEditor(Pin) {
    const model = Pin.editorModel;

    function makeId(type) {
        return type + "_" + Math.random().toString(36).slice(2, 8);
    }

    function createDefaultElement(type) {
        return model.createDefaultElement(type, makeId);
    }

        function mountEditor(root, state) {
            /*
             * Keep design-mode refreshes anchored to local editor state.
             * Why: a stale #design&t=... token would otherwise override autosave
             * on Ctrl+Refresh and make metadata edits appear to disappear.
             */
            if (window.history && window.history.replaceState && /^#design(&|$)/.test(location.hash || "")) {
                window.history.replaceState(null, "", location.pathname + location.search + "#design");
            }
            model.ensureSelectableLauncher(state.table);
            model.ensureLevels(state.table);
            model.ensureElementLevels(state.table);
            model.syncLauncherConfig(state.table);
        model.ensureRulesEngine(state.table);
        if (typeof root._pinballCleanup === "function") root._pinballCleanup();
        root.innerHTML = "";
        const layout = document.createElement("div");
        layout.className = "editor-layout";
        const left = document.createElement("div");
        left.className = "panel";
        const center = document.createElement("div");
        center.className = "editor-center";
        const resizer = document.createElement("div");
        resizer.className = "panel-resizer";
        resizer.title = "Drag to resize inspector";
        resizer.setAttribute("aria-label", "Resize inspector panel");
        const right = document.createElement("div");
        right.className = "panel right";

        const hintBar = document.createElement("div");
        hintBar.className = "hint-bar";
        const canvasWrap = document.createElement("div");
        canvasWrap.className = "canvas-wrap";
        center.appendChild(canvasWrap);
        const canvas = document.createElement("canvas");
        canvas.width = 900;
        canvas.height = 900;
        canvasWrap.appendChild(canvas);

        function pushUndo() {
            state.undo.push(JSON.stringify(state.table));
            if (state.undo.length > 100) state.undo.shift();
        }

        const view = Pin.editorTools.createView();
        let selectedId = state.selected ? state.selected.id : null;
        let hoveredId = null;
        let dashTick = 0;
        let activeTool = "select";
        let dragState = null;
        let panelResizeState = null;
        let penState = null;
        let isPanning = false;
        let snapEnabled = true;
        let gridSize = 10;
        let inspectorTab = "properties";
        let assistantSubtab = "chat";
        let logicSubtab = "game";
        let propertySubtab = "layout";
        let penToolSettings = { color: "#a8b5ea", thickness: 6 };
        let selectedRuleId = null;
        let selectedLogicNode = null;
        let selectedGraphId = null;
        let selectedGraphNodeId = null;
        let pendingEdgeSourceNodeId = null;
        const disposers = [];
        const perfEnabled = !!(window.localStorage && localStorage.getItem("pin.perf") === "1");
        const perfState = {};
        let refreshRequest = { canvas: false, palette: false, inspector: false };
        let refreshRaf = 0;
        let paletteDirty = true;
        let tableLayerCanvas = null;
        let tableLayerCtx = null;
        let tableLayerDirty = true;
        let tableLayerRedrawTimer = 0;
        let lastTableLayerDrawAt = 0;
        let gridLayerCanvas = null;
        let gridLayerCtx = null;
        let gridLayerKey = "";
        let runtimeCache = null;
        let runtimeByIdCache = null;
        let dirtyRevision = 0;
        let autosavedRevision = -1;
        let lastDirtyAt = 0;
        let tableFitZoom = 1;
        const inspectorDrafts = {};
        let assistantRuntime = null;
        let gameLogicSource = Pin.gameLogicV2 && Pin.gameLogicV2.createEmpty ? Pin.gameLogicV2.createEmpty(((state.table || {}).name || "Table") + " Logic") : null;
        if (Pin.gameLogicV2 && Pin.gameLogicV2.scaffoldFromTable && gameLogicSource && !(gameLogicSource.shots || []).length) {
            gameLogicSource = Pin.gameLogicV2.scaffoldFromTable(state.table, ((state.table || {}).name || "Table") + " Logic");
        }

        function on(target, type, handler, options) {
            target.addEventListener(type, handler, options);
            disposers.push(function dispose() { target.removeEventListener(type, handler, options); });
        }

        function interval(fn, ms) {
            const id = setInterval(fn, ms);
            disposers.push(function dispose() { clearInterval(id); });
            return id;
        }

        function timeout(fn, ms) {
            const id = setTimeout(fn, ms);
            disposers.push(function dispose() { clearTimeout(id); });
            return id;
        }

        function isTextEntryTarget(target) {
            if (!target) return false;
            if (target.isContentEditable) return true;
            const tag = target.tagName ? target.tagName.toLowerCase() : "";
            return tag === "input" || tag === "textarea" || tag === "select";
        }

        function perfStart(name) {
            if (!perfEnabled || typeof performance === "undefined") return 0;
            return performance.now();
        }

        function perfEnd(name, startedAt) {
            if (!perfEnabled || !startedAt || typeof performance === "undefined") return;
            const entry = perfState[name] || { total: 0, count: 0 };
            entry.total += performance.now() - startedAt;
            entry.count += 1;
            perfState[name] = entry;
        }

        function flushPerf(label) {
            if (!perfEnabled) return;
            const keys = Object.keys(perfState);
            if (!keys.length) return;
            const parts = keys.map(function map(key) {
                const item = perfState[key];
                const avg = item.count ? item.total / item.count : 0;
                return key + "=" + avg.toFixed(2) + "ms";
            });
            console.log("[pin.perf][" + label + "] " + parts.join(" | "));
            keys.forEach(function clear(key) { delete perfState[key]; });
        }

        function clampRightPanelWidth(width) {
            const max = Math.max(300, (window.innerWidth || 1200) - 560);
            return Math.max(300, Math.min(max, width || 360));
        }

        function setRightPanelWidth(width, persist) {
            const next = clampRightPanelWidth(width);
            layout.style.setProperty("--right-panel-width", next + "px");
            if (persist) {
                try { localStorage.setItem("pin.editor.rightPanelWidth", String(next)); } catch (e) {}
            }
            return next;
        }

        function getSelected() {
            return state.table.elements.find(function find(el) { return el.id === selectedId; }) || null;
        }

        function getElementById(id) {
            return state.table.elements.find(function find(el) { return el.id === id; }) || null;
        }

        function normalizeInput(v) {
            if (typeof v === "number") return Number.isFinite(v) ? v : 0;
            if (typeof v === "string") {
                const n = Number(v);
                if (String(n) === String(v)) return n;
            }
            return v;
        }

        function snapPoint(point, enabled) {
            return {
                x: Pin.editorTools.snap(point.x, gridSize, enabled),
                y: Pin.editorTools.snap(point.y, gridSize, enabled)
            };
        }

        function getSnapWorld(evt, world, drag) {
            if (!snapEnabled || evt.ctrlKey || evt.metaKey) return world;
            if (!drag || !drag.handle) return snapPoint(world, true);
            if (drag.handle.kind === "in" || drag.handle.kind === "out" || drag.handle.kind === "rotate") return world;
            const startHandle = drag.startHandleWorld || drag.startWorld;
            const targetHandle = {
                x: world.x - (drag.pointerOffset ? drag.pointerOffset.x : 0),
                y: world.y - (drag.pointerOffset ? drag.pointerOffset.y : 0)
            };
            const snappedHandle = snapPoint(targetHandle, true);
            if (drag.handle.kind === "move") {
                return {
                    x: drag.startWorld.x + (snappedHandle.x - startHandle.x),
                    y: drag.startWorld.y + (snappedHandle.y - startHandle.y)
                };
            }
            return snappedHandle;
        }

        function cloneDraftValue(value) {
            return Pin.editorTools.clone(value == null ? {} : value);
        }

        function draftSignature(value) {
            try {
                return JSON.stringify(value == null ? {} : value);
            } catch (err) {
                return "";
            }
        }

        function getCardDraft(key, source) {
            const signature = draftSignature(source);
            let entry = inspectorDrafts[key];
            if (!entry || (!entry.dirty && entry.sourceSignature !== signature)) {
                entry = {
                    draft: cloneDraftValue(source),
                    sourceSignature: signature,
                    dirty: false
                };
                inspectorDrafts[key] = entry;
            }
            return {
                value: entry.draft,
                dirty: entry.dirty
            };
        }

        function syncDraftUi(key, dirty) {
            if (!right || !key) return;
            let card = null;
            const draftCards = right.querySelectorAll("[data-draft-key]");
            for (let i = 0; i < draftCards.length; i++) {
                if (draftCards[i].dataset.draftKey === key) {
                    card = draftCards[i];
                    break;
                }
            }
            if (!card) return;
            const save = card.querySelector(".draft-save");
            const reset = card.querySelector(".draft-reset");
            if (save) save.disabled = !dirty;
            if (reset) reset.disabled = !dirty;
            card.classList.toggle("draft-dirty", !!dirty);
        }

        function patchCardDraft(key, path, value) {
            const entry = inspectorDrafts[key] || {
                draft: {},
                sourceSignature: draftSignature({}),
                dirty: false
            };
            if (!inspectorDrafts[key]) inspectorDrafts[key] = entry;
            Pin.editorTools.setByPath(entry.draft, path, value);
            entry.dirty = true;
            syncDraftUi(key, true);
        }

        function replaceCardDraft(key, value) {
            const entry = inspectorDrafts[key] || {
                draft: {},
                sourceSignature: draftSignature({}),
                dirty: false
            };
            entry.draft = cloneDraftValue(value);
            entry.dirty = true;
            inspectorDrafts[key] = entry;
            syncDraftUi(key, true);
            refresh("inspector");
        }

        function resetCardDraft(key) {
            delete inspectorDrafts[key];
            syncDraftUi(key, false);
            refresh("inspector");
        }

        function clearAllDrafts() {
            Object.keys(inspectorDrafts).forEach(function clear(key) { delete inspectorDrafts[key]; });
        }

        /*
         * Report whether table-affecting inspector drafts still need persistence.
         * Why: autosave must wake up for metadata edits even before the user
         * explicitly clicks the draft card's Save button.
         */
        function hasPersistableDirtyDrafts() {
            return Object.keys(inspectorDrafts).some(function some(key) {
                if (!inspectorDrafts[key] || !inspectorDrafts[key].dirty) return false;
                return key.indexOf("table:") === 0 ||
                    key.indexOf("selected:") === 0 ||
                    key.indexOf("anchor:") === 0 ||
                    key.indexOf("image:") === 0 ||
                    key.indexOf("level:") === 0 ||
                    key.indexOf("rule:") === 0 ||
                    key.indexOf("switchMap:") === 0 ||
                    key.indexOf("logicVariable:") === 0 ||
                    key.indexOf("logicTrigger:") === 0;
            });
        }

        /*
         * Persist editor drafts that back table metadata and selected element fields.
         * Why: browser refresh should not discard committed-looking inspector edits
         * such as element names that are already sitting in dirty draft buffers.
         */
        function flushPersistedDrafts() {
            const tableDraft = inspectorDrafts["table:main"];
            if (tableDraft && tableDraft.dirty) {
                patchTableFields(tableDraft.draft);
                resetCardDraft("table:main");
            }
            Object.keys(inspectorDrafts).slice().forEach(function each(key) {
                const entry = inspectorDrafts[key];
                if (!entry || !entry.dirty) return;
                if (key.indexOf("selected:") === 0) {
                    const selectedIdFromKey = key.slice("selected:".length);
                    const selectedElement = getElementById(selectedIdFromKey);
                    if (!selectedElement) return;
                    const previousSelectedId = selectedId;
                    selectedId = selectedIdFromKey;
                    patchSelectedFields(entry.draft);
                    selectedId = previousSelectedId;
                    resetCardDraft(key);
                    return;
                }
                if (key.indexOf("anchor:") === 0) {
                    const parts = key.split(":");
                    const anchorSelectedId = parts[1] || "";
                    const anchorKey = parts[2] || "";
                    const anchorIndex = Number(parts[3]);
                    if (!anchorKey || !Number.isFinite(anchorIndex)) return;
                    const anchorElement = getElementById(anchorSelectedId);
                    if (!anchorElement) return;
                    const previousSelectedId = selectedId;
                    selectedId = anchorSelectedId;
                    patchAnchorFields(anchorKey, anchorIndex, entry.draft);
                    selectedId = previousSelectedId;
                    resetCardDraft(key);
                    return;
                }
                if (key.indexOf("image:") === 0) {
                    const imageIndex = Number(key.slice("image:".length));
                    if (!Number.isFinite(imageIndex)) return;
                    patchImageLayerFields(imageIndex, entry.draft);
                    resetCardDraft(key);
                    return;
                }
                if (key.indexOf("level:") === 0) {
                    const levelValue = Number(key.slice("level:".length));
                    if (!Number.isFinite(levelValue)) return;
                    patchLevelFields(levelValue, entry.draft);
                    resetCardDraft(key);
                    return;
                }
                if (key.indexOf("rule:") === 0) {
                    const ruleId = key.slice("rule:".length);
                    if (!ruleId) return;
                    patchRuleFields(ruleId, entry.draft);
                    resetCardDraft(key);
                    return;
                }
                if (key.indexOf("switchMap:") === 0) {
                    const mapIndex = Number(key.slice("switchMap:".length));
                    if (!Number.isFinite(mapIndex)) return;
                    patchSwitchMapFields(mapIndex, entry.draft);
                    resetCardDraft(key);
                    return;
                }
                if (key.indexOf("logicVariable:") === 0) {
                    const variableIndex = Number(key.slice("logicVariable:".length));
                    if (!Number.isFinite(variableIndex)) return;
                    patchVariableFields(variableIndex, entry.draft);
                    resetCardDraft(key);
                    return;
                }
                if (key.indexOf("logicTrigger:") === 0) {
                    const triggerIndex = Number(key.slice("logicTrigger:".length));
                    if (!Number.isFinite(triggerIndex)) return;
                    patchTriggerFields(triggerIndex, entry.draft);
                    resetCardDraft(key);
                }
            });
        }

        function makeRuleId() {
            return "rule_" + Math.random().toString(36).slice(2, 8);
        }

        /*
         * What: Replace the in-memory TBGameLogic v2 source state.
         * Why: logic authoring uses a separate source model that compiles into
         *      the existing runtime rules table only when requested.
         */
        function setGameLogicSource(next) {
            if (!Pin.gameLogicV2 || !Pin.gameLogicV2.normalize) return;
            gameLogicSource = Pin.gameLogicV2.normalize(next || {});
            refresh("inspector");
        }

        /*
         * What: Compile authored TBGameLogic v2 into the current table runtime.
         * Why: the simulator and play mode still execute low-level rulesEngine data.
         */
        function compileGameLogicIntoTable() {
            if (!Pin.gameLogicV2 || !Pin.gameLogicV2.compile || !gameLogicSource) return { ok: false, issues: [{ severity: "error", message: "Game logic compiler unavailable." }] };
            const result = Pin.gameLogicV2.compile(gameLogicSource, state.table);
            if (!result || !result.ok || !result.table) return result || { ok: false, issues: [{ severity: "error", message: "Game logic compile failed." }] };
            pushUndo();
            state.table = result.table;
            model.ensureSelectableLauncher(state.table);
            model.ensureLevels(state.table);
            model.ensureElementLevels(state.table);
            model.syncLauncherConfig(state.table);
            markTableDirty();
            refresh("all");
            return result;
        }

        const editorActions = Pin.editorActions.create({
            state: state,
            pushUndo: pushUndo,
            markTableDirty: markTableDirty,
            refresh: refresh,
            syncCanvasToTable: syncCanvasToTable,
            syncLauncherConfig: model.syncLauncherConfig,
            getLauncherElement: model.getLauncherElement,
            getSelected: getSelected,
            ensureLevels: model.ensureLevels,
            getElementLevel: model.getElementLevel,
            makeId: makeId,
            normalizeInput: normalizeInput
        });

        const editorSession = Pin.editorSession.create({
            state: state,
            ensureSelectableLauncher: model.ensureSelectableLauncher,
            ensureLevels: model.ensureLevels,
            ensureElementLevels: model.ensureElementLevels,
            syncLauncherConfig: model.syncLauncherConfig,
            syncCanvasToTable: syncCanvasToTable,
            markTableDirty: markTableDirty,
            refresh: refresh,
            setPaletteDirty: function setPaletteDirty(next) { paletteDirty = !!next; },
            getLogicGraphs: getLogicGraphs,
            findElementForSwitchId: findElementForSwitchId,
            findElementForLampId: findElementForLampId,
            setSelectedId: function setSelectedId(next) { selectedId = next; },
            setSelectedRuleId: function setSelectedRuleId(next) { selectedRuleId = next; },
            setSelectedLogicNode: function setSelectedLogicNode(next) { selectedLogicNode = next; },
            setSelectedGraphId: function setSelectedGraphId(next) { selectedGraphId = next; },
            setSelectedGraphNodeId: function setSelectedGraphNodeId(next) { selectedGraphNodeId = next; },
            setPendingEdgeSourceNodeId: function setPendingEdgeSourceNodeId(next) { pendingEdgeSourceNodeId = next; },
            setInspectorTab: function setInspectorTab(next) { inspectorTab = next; }
        });

        function ensureRulesEngine() {
            return model.ensureRulesEngine(state.table);
        }

        function ensureImageLayers() {
            return model.ensureImageLayers(state.table);
        }

        function ensureLevels() {
            return model.ensureLevels(state.table);
        }

        function ensureElementLevels() {
            return model.ensureElementLevels(state.table);
        }

        function getVisibleEditorElements() {
            ensureLevels();
            ensureElementLevels();
            return (state.table.elements || []).filter(function keep(el) {
                return model.isElementVisibleInEditor(state.table, el);
            });
        }

        function getEditorDisplayTable() {
            return Object.assign({}, state.table, {
                elements: getVisibleEditorElements()
            });
        }

        function getLogicGraphs() {
            return model.getLogicGraphs(state.table);
        }

        function getSelectedGraph() {
            const graphs = getLogicGraphs();
            if (!graphs.length) return null;
            return graphs.find(function find(graph) { return graph.id === selectedGraphId; }) || graphs[0];
        }

        function getSelectedGraphNode() {
            const graph = getSelectedGraph();
            if (!graph || !selectedGraphNodeId) return null;
            return (graph.nodes || []).find(function find(node) { return node.id === selectedGraphNodeId; }) || null;
        }

        function getSelectedRule() {
            const rules = ensureRulesEngine();
            return (rules.sequenceRules || []).find(function find(rule) { return rule.id === selectedRuleId; }) || null;
        }

        function findElementForSwitchId(switchId) {
            return model.findElementForSwitchId(state.table, switchId);
        }

        function findElementForLampId(lampId) {
            return model.findElementForLampId(state.table, lampId);
        }

        function firstSwitchElementId() {
            return model.firstSwitchElementId(state.table);
        }

        const editorRulesLogic = Pin.editorRulesLogic.create({
            state: state,
            pushUndo: pushUndo,
            markTableDirty: markTableDirty,
            refresh: refresh,
            makeRuleId: makeRuleId,
            normalizeInput: normalizeInput,
            ensureRulesEngine: ensureRulesEngine,
            getLogicGraphs: getLogicGraphs,
            getSelectedGraph: getSelectedGraph,
            getSelectedGraphNode: getSelectedGraphNode,
            getSelected: getSelected,
            getElementById: getElementById,
            firstSwitchElementId: firstSwitchElementId,
            setSelectedId: function setSelectedId(next) { selectedId = next; },
            setSelectedRuleId: function setSelectedRuleId(next) { selectedRuleId = next; },
            setSelectedLogicNode: function setSelectedLogicNode(next) { selectedLogicNode = next; },
            setSelectedGraphId: function setSelectedGraphId(next) { selectedGraphId = next; },
            getSelectedGraphId: function getSelectedGraphId() { return selectedGraphId; },
            setSelectedGraphNodeId: function setSelectedGraphNodeId(next) { selectedGraphNodeId = next; },
            getPendingEdgeSourceNodeId: function getPendingEdgeSourceNodeId() { return pendingEdgeSourceNodeId; },
            setPendingEdgeSourceNodeId: function setPendingEdgeSourceNodeId(next) { pendingEdgeSourceNodeId = next; },
            setInspectorTab: function setInspectorTab(next) { inspectorTab = next; }
        });
        assistantRuntime = Pin.editorAssistant.create({
            getTable: function getTable() { return state.table; },
            getSelected: getSelected,
            getSelectedRule: getSelectedRule,
            getSelectedGraph: getSelectedGraph,
            getSelectedLogicNode: getSelectedGraphNode,
            getActiveTab: function getActiveTab() { return inspectorTab; },
            getValidationIssues: function getValidationIssues() {
                return Pin.table && Pin.table.validatePlayability ? Pin.table.validatePlayability(state.table) : [];
            },
            applyPatch: function applyPatch(patch) {
                return editorRulesLogic.applyAssistantPatch(patch);
            },
            previewPatch: function previewPatch(patch) {
                const previewState = {
                    table: Pin.editorTools.clone(state.table),
                    undo: []
                };
                const previewLogic = Pin.editorRulesLogic.create({
                    state: previewState,
                    pushUndo: function pushUndo() {},
                    markTableDirty: function markTableDirty() {},
                    refresh: function refresh() {},
                    makeRuleId: makeRuleId,
                    normalizeInput: normalizeInput,
                    ensureRulesEngine: function ensureRulesEnginePreview() {
                        return Pin.editorModel.ensureRulesEngine(previewState.table);
                    },
                    getLogicGraphs: function getLogicGraphsPreview() {
                        return Pin.editorModel.getLogicGraphs(previewState.table);
                    },
                    getSelectedGraph: function getSelectedGraphPreview() { return null; },
                    getSelectedGraphNode: function getSelectedGraphNodePreview() { return null; },
                    getSelected: function getSelectedPreview() { return null; },
                    getElementById: function getElementByIdPreview(id) {
                        return (previewState.table.elements || []).find(function find(element) {
                            return element && element.id === id;
                        }) || null;
                    },
                    firstSwitchElementId: function firstSwitchElementIdPreview() { return ""; },
                    setSelectedId: function setSelectedIdPreview() {},
                    setSelectedRuleId: function setSelectedRuleIdPreview() {},
                    setSelectedLogicNode: function setSelectedLogicNodePreview() {},
                    setSelectedGraphId: function setSelectedGraphIdPreview() {},
                    getSelectedGraphId: function getSelectedGraphIdPreview() { return null; },
                    setSelectedGraphNodeId: function setSelectedGraphNodeIdPreview() {},
                    getPendingEdgeSourceNodeId: function getPendingEdgeSourceNodeIdPreview() { return null; },
                    setPendingEdgeSourceNodeId: function setPendingEdgeSourceNodeIdPreview() {},
                    setInspectorTab: function setInspectorTabPreview() {}
                });
                return previewLogic.applyAssistantPatch(patch);
            },
            refresh: refresh
        });

        function selectLogicNode(node) {
            editorSession.selectLogicNode(node);
            const graph = getSelectedGraph();
            if (graph) selectedRuleId = graph.sourceRuleId || selectedRuleId;
        }

        function markLogicEdgeSource(nodeId) {
            editorRulesLogic.markLogicEdgeSource(nodeId);
        }

        function connectLogicNodes(graphId, fromNodeId, toNodeId) {
            editorRulesLogic.connectLogicNodes(graphId, fromNodeId, toNodeId);
        }

        function addLogicNode(graphId, type, props) {
            editorRulesLogic.addLogicNode(graphId, type, props);
        }

        function assignSelectedToLogicNode(node) {
            editorRulesLogic.assignSelectedToLogicNode(node);
        }

        function assignElementIdToLogicNode(node, elementId) {
            editorRulesLogic.assignElementIdToLogicNode(node, elementId);
        }

        function patchTable(path, value) {
            editorActions.patchTable(path, value);
            gridLayerKey = "";
        }

        function patchTableFields(patch) {
            editorActions.patchTableFields(patch);
            gridLayerKey = "";
        }

        function addSequenceRule() {
            editorRulesLogic.addSequenceRule();
        }

        function addRuleTemplate(kind) {
            editorRulesLogic.addRuleTemplate(kind);
        }

        function addLogicStep(graphId) {
            editorRulesLogic.addLogicStep(graphId);
        }

        function deleteGraphEdge(graphId, edgeId) {
            editorRulesLogic.deleteGraphEdge(graphId, edgeId);
        }

        function patchGraphNode(graphId, nodeId, key, value) {
            editorRulesLogic.patchGraphNode(graphId, nodeId, key, value);
        }

        function patchGraphNodeFields(graphId, nodeId, patch) {
            editorRulesLogic.patchGraphNodeFields(graphId, nodeId, patch);
        }

        function moveGraphNode(graphId, nodeId, x, y) {
            editorRulesLogic.moveGraphNode(graphId, nodeId, x, y);
        }

        function deleteGraphNode(graphId, nodeId) {
            editorRulesLogic.deleteGraphNode(graphId, nodeId);
        }

        function patchRule(id, key, value) {
            editorRulesLogic.patchRule(id, key, value);
        }

        function patchRuleFields(id, patch) {
            editorRulesLogic.patchRuleFields(id, patch);
        }

        function duplicateRule(id) {
            editorRulesLogic.duplicateRule(id);
        }

        function deleteRule(id) {
            editorRulesLogic.deleteRule(id);
        }

        function addSwitchMap() {
            editorRulesLogic.addSwitchMap();
        }

        function addImageLayer() {
            editorActions.addImageLayer();
        }

        function patchImageLayer(index, key, value) {
            editorActions.patchImageLayer(index, key, value);
        }

        function patchImageLayerFields(index, patch) {
            editorActions.patchImageLayerFields(index, patch);
        }

        function removeImageLayer(index) {
            editorActions.removeImageLayer(index);
        }

        function moveImageLayer(index, delta) {
            editorActions.moveImageLayer(index, delta);
        }

        function patchSwitchMap(index, key, value) {
            editorRulesLogic.patchSwitchMap(index, key, value);
        }

        function patchSwitchMapFields(index, patch) {
            editorRulesLogic.patchSwitchMapFields(index, patch);
        }

        function removeSwitchMap(index) {
            editorRulesLogic.removeSwitchMap(index);
        }

        function addVariable() {
            editorRulesLogic.addVariable();
        }

        function patchVariableFields(index, patch) {
            editorRulesLogic.patchVariableFields(index, patch);
        }

        function removeVariable(index) {
            editorRulesLogic.removeVariable(index);
        }

        function addTrigger() {
            editorRulesLogic.addTrigger();
        }

        function patchTriggerFields(index, patch) {
            editorRulesLogic.patchTriggerFields(index, patch);
        }

        function removeTrigger(index) {
            editorRulesLogic.removeTrigger(index);
        }

        function focusValidationIssue(issue) {
            editorSession.focusValidationIssue(issue);
        }

        function patchSelected(path, value) {
            editorActions.patchSelected(path, value);
        }

        function patchSelectedFields(patch) {
            editorActions.patchSelectedFields(patch);
        }

        function patchAnchor(key, index, field, value) {
            editorActions.patchAnchor(key, index, field, value);
        }

        function patchAnchorFields(key, index, patch) {
            editorActions.patchAnchorFields(key, index, patch);
        }

        function addAnchor(key) {
            editorActions.addAnchor(key);
        }

        function deleteElementById(id) {
            editorActions.deleteElementById(id);
            if (selectedId === id) selectedId = null;
        }

        function duplicateSelected() {
            const copy = editorActions.duplicateSelected();
            if (copy) selectedId = copy.id;
        }

        function moveElementById(id, delta) {
            editorActions.moveElementById(id, delta);
        }

        function addLevel(parentLevel) {
            editorActions.addLevel(parentLevel);
        }

        function patchLevelFields(levelValue, patch) {
            editorActions.patchLevelFields(levelValue, patch);
        }

        function setLevelVisibility(levelValue, visible) {
            editorActions.setLevelVisibility(levelValue, visible);
        }

        function isolateLevel(levelValue) {
            editorActions.isolateLevel(levelValue);
        }

        function showAllLevels() {
            editorActions.showAllLevels();
        }

        function assignSelectedToLevel(levelValue) {
            editorActions.assignSelectedToLevel(levelValue);
        }

        function removeLevel(levelValue) {
            editorActions.removeLevel(levelValue);
        }

        function framePoints(points) {
            if (!points.length) return;
            const minX = Math.min.apply(null, points.map(function m(p) { return p.x; }));
            const minY = Math.min.apply(null, points.map(function m(p) { return p.y; }));
            const maxX = Math.max.apply(null, points.map(function m(p) { return p.x; }));
            const maxY = Math.max.apply(null, points.map(function m(p) { return p.y; }));
            const w = Math.max(40, maxX - minX);
            const h = Math.max(40, maxY - minY);
            view.zoom = Math.max(0.25, Math.min(4, Math.min(canvas.width / (w + 80), canvas.height / (h + 80))));
            view.panX = canvas.width * 0.5 - (minX + maxX) * 0.5 * view.zoom;
            view.panY = canvas.height * 0.5 - (minY + maxY) * 0.5 * view.zoom;
            gridLayerKey = "";
            refresh("canvas");
        }

        function getViewportWorldCenter() {
            return {
                x: (canvas.width * 0.5 - view.panX) / view.zoom,
                y: (canvas.height * 0.5 - view.panY) / view.zoom
            };
        }

        function getElementPlacementCenter(el) {
            if (!el) return { x: 0, y: 0 };
            if (typeof el.x === "number" && typeof el.y === "number") return { x: el.x, y: el.y };
            if (el.pivot) return { x: el.pivot.x, y: el.pivot.y };
            if (Array.isArray(el.anchors) && el.anchors.length) {
                const sum = el.anchors.reduce(function reduce(acc, anchor) {
                    acc.x += anchor.x;
                    acc.y += anchor.y;
                    return acc;
                }, { x: 0, y: 0 });
                return {
                    x: sum.x / el.anchors.length,
                    y: sum.y / el.anchors.length
                };
            }
            return { x: 0, y: 0 };
        }

        function placeNewElementInView(el) {
            if (!el) return;
            const center = getElementPlacementCenter(el);
            const rawTarget = getViewportWorldCenter();
            const target = snapEnabled ? snapPoint(rawTarget, true) : rawTarget;
            Pin.editorHitTest.shiftElement(el, target.x - center.x, target.y - center.y);
        }

        function getEditorViewBounds() {
            const pf = state.table.playfield;
            const bounds = {
                minX: 0,
                minY: 0,
                maxX: pf.width,
                maxY: pf.height
            };
            function includePoint(x, y) {
                if (typeof x !== "number" || typeof y !== "number") return;
                bounds.minX = Math.min(bounds.minX, x);
                bounds.minY = Math.min(bounds.minY, y);
                bounds.maxX = Math.max(bounds.maxX, x);
                bounds.maxY = Math.max(bounds.maxY, y);
            }
            function includeRadius(x, y, r) {
                const radius = typeof r === "number" ? r : 0;
                includePoint(x - radius, y - radius);
                includePoint(x + radius, y + radius);
            }

            getVisibleEditorElements().forEach(function each(el) {
                if (!el) return;
                if (Array.isArray(el.anchors)) {
                    const pad = Math.max(
                        typeof el.thickness === "number" ? el.thickness : 0,
                        typeof el.radius === "number" ? el.radius : 0,
                        typeof el.bandThickness === "number" ? el.bandThickness : 6,
                        6
                    );
                    el.anchors.forEach(function eachAnchor(anchor) {
                        if (!anchor) return;
                        includeRadius(anchor.x, anchor.y, Math.max(pad, typeof anchor.radius === "number" ? anchor.radius : 0));
                    });
                }
                if (Array.isArray(el.leftAnchors)) {
                    el.leftAnchors.forEach(function eachAnchor(anchor) {
                        if (!anchor) return;
                        includePoint(anchor.x, anchor.y);
                    });
                }
                if (Array.isArray(el.rightAnchors)) {
                    el.rightAnchors.forEach(function eachAnchor(anchor) {
                        if (!anchor) return;
                        includePoint(anchor.x, anchor.y);
                    });
                }
                if (el.pivot) {
                    const length = typeof el.length === "number" ? el.length : 0;
                    const pad = Math.max(10, typeof el.thickness === "number" ? el.thickness : 10);
                    includeRadius(el.pivot.x, el.pivot.y, pad);
                    includeRadius(el.pivot.x + Math.cos(el.restAngle || 0) * length, el.pivot.y + Math.sin(el.restAngle || 0) * length, pad);
                    includeRadius(el.pivot.x + Math.cos(el.activeAngle || 0) * length, el.pivot.y + Math.sin(el.activeAngle || 0) * length, pad);
                }
                if (typeof el.x === "number" && typeof el.y === "number") {
                    if (typeof el.radius === "number") includeRadius(el.x, el.y, el.radius + 2);
                    else if (typeof el.w === "number" && typeof el.h === "number") {
                        includePoint(el.x - el.w * 0.5, el.y - el.h * 0.5);
                        includePoint(el.x + el.w * 0.5, el.y + el.h * 0.5);
                    } else {
                        includeRadius(el.x, el.y, 12);
                    }
                }
                if (typeof el.x1 === "number" && typeof el.y1 === "number" && typeof el.x2 === "number" && typeof el.y2 === "number") {
                    const pad = typeof el.thickness === "number" ? el.thickness : 4;
                    includeRadius(el.x1, el.y1, pad);
                    includeRadius(el.x2, el.y2, pad);
                }
                if (el.type === "launcher") {
                    const half = (el.width || 38) * 0.5;
                    includePoint((el.x || 439) - half, el.top || 195);
                    includePoint((el.x || 439) + half, el.bottom || 735);
                }
            });
            return bounds;
        }

        function updateCanvasViewportSize() {
            const rect = canvasWrap.getBoundingClientRect();
            const nextWidth = Math.max(320, Math.floor(rect.width || 0));
            const nextHeight = Math.max(320, Math.floor(rect.height || 0));
            if (canvas.width === nextWidth && canvas.height === nextHeight) return false;
            canvas.width = nextWidth;
            canvas.height = nextHeight;
            tableLayerDirty = true;
            gridLayerKey = "";
            return true;
        }

        function fitTableView() {
            const pad = 16;
            const usableWidth = Math.max(120, canvas.width - pad * 2);
            const usableHeight = Math.max(120, canvas.height - pad * 2);
            const bounds = getEditorViewBounds();
            const width = Math.max(40, bounds.maxX - bounds.minX);
            const height = Math.max(40, bounds.maxY - bounds.minY);
            tableFitZoom = Math.max(0.25, Math.min(4, Math.min(
                usableWidth / width,
                usableHeight / height
            )));
            view.zoom = tableFitZoom;
            view.panX = canvas.width * 0.5 - (bounds.minX + bounds.maxX) * 0.5 * view.zoom;
            view.panY = canvas.height * 0.5 - (bounds.minY + bounds.maxY) * 0.5 * view.zoom;
            tableLayerDirty = true;
            gridLayerKey = "";
            refresh("canvas");
        }

        function syncCanvasToTable() {
            updateCanvasViewportSize();
            fitTableView();
        }

        /*
         * Keep the editor canvas synced after layout settles and when the browser
         * zoom / visual viewport changes.
         * Why: the editor depends on the measured viewport size, so a late layout
         * shift can otherwise leave the table fit one step too small.
         */
        let syncViewportRaf = 0;
        function requestSyncCanvasToTable() {
            if (syncViewportRaf) return;
            syncViewportRaf = requestAnimationFrame(function syncFrame() {
                syncViewportRaf = 0;
                syncCanvasToTable();
            });
        }

        function setHint(extra) {
            hintBar.textContent = activeTool +
                " | wheel zoom | Space drag pan | G snap | arrows nudge | Delete remove | D duplicate" +
                (extra ? " | " + extra : "");
        }

        /*
         * Normalize pen width from palette inputs.
         * Why: tool controls may provide strings or invalid values.
         */
        function normalizePenThickness(value) {
            const parsed = Number(value);
            if (!Number.isFinite(parsed)) return penToolSettings.thickness;
            return Math.max(1, Math.min(64, parsed));
        }

        /*
         * Normalize pen color from palette inputs.
         * Why: keep authored path color values consistent and render-safe.
         */
        function normalizePenColor(value) {
            const text = String(value || "").trim();
            if (/^#[0-9a-f]{6}$/i.test(text)) return text.toLowerCase();
            return penToolSettings.color;
        }

        /*
         * Apply the active pen tool style to a path.
         * Why: pen settings should immediately affect new/current path strokes.
         */
        function applyPenStyleToPath(path) {
            if (!path || path.type !== "path") return;
            path.thickness = normalizePenThickness(penToolSettings.thickness);
            path.color = normalizePenColor(penToolSettings.color);
        }

        function markTableDirty() {
            ensureLevels();
            ensureElementLevels();
            tableLayerDirty = true;
            runtimeCache = null;
            runtimeByIdCache = null;
            dirtyRevision += 1;
            lastDirtyAt = Date.now();
        }

        function isInteractiveCanvasMotion() {
            return !!(panelResizeState || isPanning || (dragState && dragState.kind === "drag"));
        }

        function scheduleTableLayerRefresh(delayMs) {
            if (tableLayerRedrawTimer || delayMs <= 0) return;
            tableLayerRedrawTimer = timeout(function onTableLayerDelay() {
                tableLayerRedrawTimer = 0;
                refresh("canvas");
            }, delayMs);
        }

        function ensureLayerCanvas(layerCanvas, layerCtx) {
            if (!layerCanvas) {
                layerCanvas = document.createElement("canvas");
                layerCtx = layerCanvas.getContext("2d");
            }
            if (layerCanvas.width !== canvas.width || layerCanvas.height !== canvas.height) {
                layerCanvas.width = canvas.width;
                layerCanvas.height = canvas.height;
            }
            return { canvas: layerCanvas, ctx: layerCtx };
        }

        /*
         * Keep the rendered table layer at table coordinates, not viewport
         * coordinates. Why: the editor later scales/pans this layer into the
         * viewport; if the layer is only viewport-sized, the lower playfield is
         * clipped before the fit transform can show it.
         */
        function ensureTableLayerCanvas(layerCanvas, layerCtx) {
            const pf = state.table.playfield;
            const width = Math.max(1, Math.ceil(pf.width || 500));
            const height = Math.max(1, Math.ceil(pf.height || 880));
            if (!layerCanvas) {
                layerCanvas = document.createElement("canvas");
                layerCtx = layerCanvas.getContext("2d");
            }
            if (layerCanvas.width !== width || layerCanvas.height !== height) {
                layerCanvas.width = width;
                layerCanvas.height = height;
            }
            return { canvas: layerCanvas, ctx: layerCtx };
        }

        function getEditorRuntime() {
            if (runtimeCache) return runtimeCache;
            const startedAt = perfStart("editor.compileElements");
            runtimeCache = Pin.elements.compileElements(getEditorDisplayTable());
            runtimeByIdCache = {};
            (runtimeCache.drawables || []).forEach(function each(entry) {
                if (entry && entry.element && entry.element.id) runtimeByIdCache[entry.element.id] = entry.runtime;
            });
            perfEnd("editor.compileElements", startedAt);
            return runtimeCache;
        }

        function drawGridToLayer() {
            const key = [
                snapEnabled ? 1 : 0,
                gridSize,
                view.zoom.toFixed(4),
                Math.round(view.panX),
                Math.round(view.panY),
                canvas.width,
                canvas.height,
                state.table.playfield.width,
                state.table.playfield.height
            ].join("|");
            if (key === gridLayerKey) return;
            const layer = ensureLayerCanvas(gridLayerCanvas, gridLayerCtx);
            gridLayerCanvas = layer.canvas;
            gridLayerCtx = layer.ctx;
            const ctx = gridLayerCtx;
            ctx.setTransform(1, 0, 0, 1, 0, 0);
            ctx.clearRect(0, 0, gridLayerCanvas.width, gridLayerCanvas.height);
            if (snapEnabled && view.zoom >= 0.35) {
                const step = gridSize;
                const z = view.zoom;
                const w = gridLayerCanvas.width;
                const h = gridLayerCanvas.height;
                ctx.save();
                ctx.strokeStyle = "rgba(120,120,200,0.14)";
                ctx.lineWidth = 1;
                ctx.beginPath();
                for (let x = 0; x <= state.table.playfield.width; x += step) {
                    const sx = x * z + view.panX;
                    ctx.moveTo(sx, 0);
                    ctx.lineTo(sx, h);
                }
                for (let y = 0; y <= state.table.playfield.height; y += step) {
                    const sy = y * z + view.panY;
                    ctx.moveTo(0, sy);
                    ctx.lineTo(w, sy);
                }
                ctx.stroke();
                ctx.restore();
            }
            gridLayerKey = key;
        }

        function drawTableToLayer(force) {
            if (!tableLayerDirty) return;
            const now = (typeof performance !== "undefined" && performance.now) ? performance.now() : Date.now();
            const minInterval = isInteractiveCanvasMotion() ? 1000 / 30 : 0;
            if (!force && minInterval > 0 && (now - lastTableLayerDrawAt) < minInterval) {
                scheduleTableLayerRefresh(Math.ceil(minInterval - (now - lastTableLayerDrawAt)));
                return;
            }
            const layer = ensureTableLayerCanvas(tableLayerCanvas, tableLayerCtx);
            tableLayerCanvas = layer.canvas;
            tableLayerCtx = layer.ctx;
            const ctx = tableLayerCtx;
            ctx.setTransform(1, 0, 0, 1, 0, 0);
            ctx.clearRect(0, 0, tableLayerCanvas.width, tableLayerCanvas.height);
            const runtime = getEditorRuntime();
            const startedAt = perfStart("editor.renderWorld");
            Pin.render.renderWorld(ctx, {
                table: getEditorDisplayTable(),
                runtime: runtime,
                balls: [],
                score: 0,
                currentBall: 1
            }, {
                designMode: true,
                showHud: false,
                showCabinet: false,
                onImageReady: function onImageReady() {
                    tableLayerDirty = true;
                    refresh("canvas");
                }
            });
            perfEnd("editor.renderWorld", startedAt);
            tableLayerDirty = false;
            lastTableLayerDrawAt = now;
        }

        function refreshCanvas() {
            const startedAt = perfStart("editor.refreshCanvas");
            const ctx = canvas.getContext("2d");
            drawGridToLayer();
            drawTableToLayer(false);
            ctx.setTransform(1, 0, 0, 1, 0, 0);
            ctx.clearRect(0, 0, canvas.width, canvas.height);
            if (gridLayerCanvas) ctx.drawImage(gridLayerCanvas, 0, 0);
            ctx.setTransform(view.zoom, 0, 0, view.zoom, view.panX, view.panY);
            if (tableLayerCanvas) ctx.drawImage(tableLayerCanvas, 0, 0);
            ctx.setTransform(1, 0, 0, 1, 0, 0);

            const selected = getSelected();
            if (selected) {
                Pin.editorHitTest.drawHandles(ctx, selected, true, view, dashTick);
                if (inspectorTab === "logic" && selectedGraphNodeId) {
                    Pin.editorHitTest.drawHandles(ctx, selected, true, view, dashTick, {
                        strokeStyle: "rgba(255,255,255,0.98)",
                        fillStyle: "rgba(255,122,214,0.96)",
                        lineWidth: 2,
                        boundsStrokeStyle: "rgba(255,122,214,0.98)"
                    });
                }
            }
            if (hoveredId && hoveredId !== selectedId) {
                const hovered = state.table.elements.find(function find(el) { return el.id === hoveredId; });
                if (hovered && model.isElementVisibleInEditor(state.table, hovered)) {
                    Pin.editorHitTest.drawHandles(ctx, hovered, true, view, 0);
                }
            }
            if (penState && penState.path && penState.lastWorld) {
                const anchors = penState.path.anchors;
                const a = anchors[anchors.length - 1];
                const p1 = Pin.editorTools.worldToScreen({ x: a.x, y: a.y }, view);
                const p2 = Pin.editorTools.worldToScreen(penState.lastWorld, view);
                ctx.save();
                ctx.strokeStyle = "rgba(255,255,255,0.5)";
                ctx.setLineDash([4, 4]);
                ctx.beginPath();
                ctx.moveTo(p1.x, p1.y);
                ctx.lineTo(p2.x, p2.y);
                ctx.stroke();
                ctx.restore();
            }
            setHint(penState ? "Pen anchors: " + penState.path.anchors.length : "");
            perfEnd("editor.refreshCanvas", startedAt);
        }

        function refreshPalettePanel() {
            if (paletteDirty) {
                Pin.editorPanels.renderPalette(left, activeTool, function setTool(tool) {
                    activeTool = tool;
                    paletteDirty = true;
                    if (tool !== "pen") penState = null;
                    refresh("all");
                }, function onCreate(type) {
                    const el = createDefaultElement(type);
                    if (!el) return;
                    placeNewElementInView(el);
                    pushUndo();
                    state.table.elements.push(el);
                    selectedId = el.id;
                    activeTool = type === "path" ? "pen" : "select";
                    paletteDirty = true;
                    if (activeTool === "pen") {
                        applyPenStyleToPath(el);
                        penState = { path: el, lastWorld: null };
                    }
                    if (el.type === "launcher") model.syncLauncherConfig(state.table);
                    markTableDirty();
                    refresh("all");
                }, {
                    tools: [
                        { label: "Undo", onClick: function undo() {
                            const raw = state.undo.pop();
                            if (raw) {
                                clearAllDrafts();
                                editorSession.applyTable(JSON.parse(raw));
                            }
                        } },
                        { label: "New", onClick: function newTable() {
                            pushUndo();
                            clearAllDrafts();
                            editorSession.applyTable(Pin.table.createEmptyTable());
                        } }
                    ],
                    grid: {
                        enabled: snapEnabled,
                        size: gridSize,
                        onToggle: function toggleSnap() {
                            snapEnabled = !snapEnabled;
                            gridLayerKey = "";
                            paletteDirty = true;
                            refresh("all");
                        },
                        onSetSize: function setGridSize(size) {
                            gridSize = size;
                            gridLayerKey = "";
                            paletteDirty = true;
                            refresh("all");
                        }
                    },
                    pen: {
                        color: penToolSettings.color,
                        thickness: penToolSettings.thickness,
                        onSetColor: function onSetPenColor(value) {
                            const nextColor = normalizePenColor(value);
                            if (nextColor === penToolSettings.color) return;
                            penToolSettings.color = nextColor;
                            if (activeTool === "pen" && penState && penState.path) {
                                pushUndo();
                                applyPenStyleToPath(penState.path);
                                markTableDirty();
                                refresh("all");
                                return;
                            }
                            paletteDirty = true;
                            refresh("palette");
                        },
                        onSetThickness: function onSetPenThickness(value) {
                            const nextThickness = normalizePenThickness(value);
                            if (nextThickness === penToolSettings.thickness) return;
                            penToolSettings.thickness = nextThickness;
                            if (activeTool === "pen" && penState && penState.path) {
                                pushUndo();
                                applyPenStyleToPath(penState.path);
                                markTableDirty();
                                refresh("all");
                                return;
                            }
                            paletteDirty = true;
                            refresh("palette");
                        }
                    }
                });
                paletteDirty = false;
            }
        }

        function refreshInspectorPanel() {
            const startedAt = perfStart("editor.refreshInspectorPanel");
            const selected = getSelected();
            const inspectorStartedAt = perfStart("editor.renderInspector");
            Pin.editorPanels.renderInspector(right, {
                table: state.table,
                elements: state.table.elements,
                levels: ensureLevels(),
                selected: selected,
                activeTab: inspectorTab,
                selectedRuleId: selectedRuleId,
                selectedLogicNode: selectedLogicNode,
                selectedGraphId: selectedGraphId,
                selectedGraphNodeId: selectedGraphNodeId,
                pendingEdgeSourceNodeId: pendingEdgeSourceNodeId,
                assistant: assistantRuntime.getState(),
                assistantSubtab: assistantSubtab,
                logicSubtab: logicSubtab,
                gameLogicSource: gameLogicSource,
                propertySubtab: propertySubtab,
                ruleGraphNodeTypes: Pin.ruleGraph ? Pin.ruleGraph.nodeTypes : [],
                logicGraphs: getLogicGraphs(),
                getCardDraft: getCardDraft,
                onPatchCardDraft: patchCardDraft,
                onReplaceCardDraft: replaceCardDraft,
                onResetCardDraft: resetCardDraft,
                onSetTab: function setTab(tab) { inspectorTab = tab; refresh("all"); },
                onSetAssistantSubtab: function setAssistantSubtab(tab) {
                    assistantSubtab = tab || "chat";
                    refresh("inspector");
                },
                onSetLogicSubtab: function setLogicSubtab(tab) {
                    if (tab === "design") logicSubtab = "game";
                    else logicSubtab = tab || "game";
                    refresh("inspector");
                },
                onPatchGameLogicSourceText: function patchGameLogicSourceText(text) {
                    if (!Pin.gameLogicV2) return;
                    let parsed = null;
                    try {
                        parsed = JSON.parse(String(text || "{}"));
                    } catch (err) {
                        return;
                    }
                    setGameLogicSource(parsed);
                },
                onScaffoldGameLogicFromTable: function onScaffoldGameLogicFromTable() {
                    if (!Pin.gameLogicV2 || !Pin.gameLogicV2.scaffoldFromTable) return;
                    setGameLogicSource(Pin.gameLogicV2.scaffoldFromTable(state.table, ((state.table || {}).name || "Table") + " Logic"));
                },
                onCompileGameLogic: function onCompileGameLogic() {
                    compileGameLogicIntoTable();
                },
                onValidateGameLogic: function onValidateGameLogic() {
                    if (!Pin.gameLogicV2 || !Pin.gameLogicV2.validate || !gameLogicSource) return [];
                    return Pin.gameLogicV2.validate(gameLogicSource, state.table);
                },
                onExportGameLogicFile: function onExportGameLogicFile() {
                    if (!gameLogicSource) return;
                    const payload = JSON.stringify(gameLogicSource, null, 2);
                    const blob = new Blob([payload], { type: "application/json" });
                    const a = document.createElement("a");
                    a.href = URL.createObjectURL(blob);
                    a.download = (((state.table && state.table.name) || "table").replace(/[^a-z0-9_-]+/gi, "_")) + ".game-logic.json";
                    a.click();
                    URL.revokeObjectURL(a.href);
                },
                onImportGameLogicFile: function onImportGameLogicFile() {
                    Pin.storage.file.import().then(function apply(imported) {
                        setGameLogicSource(imported || {});
                    });
                },
                onSetPropertySubtab: function setPropertySubtab(tab) {
                    propertySubtab = tab || "layout";
                    refresh("inspector");
                },
                onSaveAssistantSettingsDraft: function saveAssistantSettingsDraft(key, draft) {
                    assistantRuntime.setSettings(draft);
                    resetCardDraft(key);
                },
                onTestAssistantConnection: function testAssistantConnection() {
                    assistantRuntime.testConnection();
                },
                onLoadAssistantModels: function loadAssistantModels() {
                    assistantRuntime.loadModels().catch(function ignore() {});
                },
                onSetAssistantDraft: function setAssistantDraft(value) {
                    assistantRuntime.setDraft(value);
                },
                onSetAgenticDraft: function setAgenticDraft(value) {
                    assistantRuntime.setAgenticDraft(value);
                },
                onSaveAgenticModeDraft: function saveAgenticModeDraft(key, draft) {
                    assistantRuntime.setAgenticMode(draft);
                    resetCardDraft(key);
                },
                onSendAssistantMessage: function sendAssistantMessage() {
                    assistantRuntime.send();
                },
                onRunAgentic: function runAgentic() {
                    assistantRuntime.runAgentic();
                },
                onStopAgentic: function stopAgentic() {
                    assistantRuntime.stopAgentic();
                },
                onApplyAgenticPendingPatch: function applyAgenticPendingPatch() {
                    assistantRuntime.applyAgenticPendingPatch();
                },
                onRejectAgenticPendingPatch: function rejectAgenticPendingPatch() {
                    assistantRuntime.rejectAgenticPendingPatch();
                },
                onAssistantQuickPrompt: function assistantQuickPrompt(kind) {
                    assistantRuntime.quickPrompt(kind);
                },
                onAddAssistantPick: function addAssistantPick(kind) {
                    assistantRuntime.addSelectedPick(kind);
                },
                onRemoveAssistantPick: function removeAssistantPick(kind, id) {
                    assistantRuntime.removePick(kind, id);
                },
                onClearAssistantPicks: function clearAssistantPicks() {
                    assistantRuntime.clearPicks();
                },
                onAddAssistantLayoutPick: function addAssistantLayoutPick() {
                    assistantRuntime.addSelectedLayoutPick();
                },
                onRemoveAssistantLayoutPick: function removeAssistantLayoutPick(id) {
                    assistantRuntime.removeLayoutPick(id);
                },
                onClearAssistantLayoutPicks: function clearAssistantLayoutPicks() {
                    assistantRuntime.clearLayoutPicks();
                },
                onClearAssistantConversation: function clearAssistantConversation() {
                    assistantRuntime.clearConversation();
                },
                onOpenAssistantLog: function openAssistantLog() {
                    assistantRuntime.openLog();
                },
                onCloseAssistantLog: function closeAssistantLog() {
                    assistantRuntime.closeLog();
                },
                onClearAssistantLog: function clearAssistantLog() {
                    assistantRuntime.clearLog();
                },
                onApplyAssistantPatch: function applyAssistantPatch() {
                    assistantRuntime.applyLastPatch();
                },
                onUndo: function undo() {
                    const raw = state.undo.pop();
                    if (raw) {
                        clearAllDrafts();
                        editorSession.applyTable(JSON.parse(raw));
                    }
                },
                canUndo: state.undo.length > 0,
                onPatchTable: patchTable,
                onSaveTableDraft: function saveTableDraft(key, draft) {
                    patchTableFields(draft);
                    resetCardDraft(key);
                },
                onPatchSelected: patchSelected,
                onSaveSelectedDraft: function saveSelectedDraft(key, draft) {
                    patchSelectedFields(draft);
                    resetCardDraft(key);
                },
                onPatchAnchor: patchAnchor,
                onSaveAnchorDraft: function saveAnchorDraft(key, anchorKey, index, draft) {
                    patchAnchorFields(anchorKey, index, draft);
                    resetCardDraft(key);
                },
                onRemoveAnchor: function removeAnchor(key, i) {
                    const selectedNow = getSelected();
                    if (!selectedNow || !Array.isArray(selectedNow[key])) return;
                    if (selectedNow.type === "kicker" && selectedNow[key].length <= 1) return;
                    if (selectedNow.type !== "kicker" && selectedNow[key].length <= 2) return;
                    pushUndo();
                    selectedNow[key].splice(i, 1);
                    markTableDirty();
                    refresh("all");
                },
                onAddAnchor: addAnchor,
                onFrameSelected: function frameSelected() {
                    const selectedNow = getSelected();
                    if (!selectedNow) return;
                    const points = [];
                    ["anchors", "leftAnchors", "rightAnchors"].forEach(function each(k) {
                        (selectedNow[k] || []).forEach(function add(a) { points.push({ x: a.x, y: a.y }); });
                    });
                    if (typeof selectedNow.x === "number" && typeof selectedNow.y === "number") points.push({ x: selectedNow.x, y: selectedNow.y });
                    if (selectedNow.pivot) points.push({ x: selectedNow.pivot.x, y: selectedNow.pivot.y });
                    if (typeof selectedNow.x1 === "number") { points.push({ x: selectedNow.x1, y: selectedNow.y1 }); points.push({ x: selectedNow.x2, y: selectedNow.y2 }); }
                    framePoints(points);
                },
                onFrameTable: function frameTable() {
                    fitTableView();
                },
                onAddImageLayer: addImageLayer,
                onPatchImageLayer: patchImageLayer,
                onSaveImageLayerDraft: function saveImageLayerDraft(key, index, draft) {
                    patchImageLayerFields(index, draft);
                    resetCardDraft(key);
                },
                onRemoveImageLayer: removeImageLayer,
                onMoveImageLayer: moveImageLayer,
                onLoadAutosave: function loadAutosave() {
                    const t = Pin.storage.local.load("autosave");
                    if (!t) return;
                    pushUndo();
                    clearAllDrafts();
                    editorSession.applyTable(t);
                },
                onSaveFile: function saveFile() {
                    flushPersistedDrafts();
                    if (gameLogicSource && Pin.gameLogicV2 && Pin.gameLogicV2.compile) {
                        const compiled = Pin.gameLogicV2.compile(gameLogicSource, state.table);
                        if (compiled && compiled.ok && compiled.table) state.table = compiled.table;
                    }
                    model.syncLauncherConfig(state.table);
                    Pin.storage.file.export(state.table);
                },
                onOpenFile: function openFile() {
                    Pin.storage.file.import().then(function apply(imported) {
                        pushUndo();
                        clearAllDrafts();
                        editorSession.applyTable(imported);
                    });
                },
                onSaveSlot1: function saveSlot1() {
                    flushPersistedDrafts();
                    model.syncLauncherConfig(state.table);
                    Pin.storage.local.save("slot1", state.table);
                },
                onOpenLogicStudio: function openLogicStudio() {
                    flushPersistedDrafts();
                    model.syncLauncherConfig(state.table);
                    location.hash = "#logic&t=" + Pin.storage.url.encode(state.table);
                },
                onLoadSlot1: function loadSlot1() {
                    const t = Pin.storage.local.load("slot1");
                    if (t) {
                        pushUndo();
                        clearAllDrafts();
                        editorSession.applyTable(t);
                    }
                },
                onTestPlay: function testPlay() {
                    flushPersistedDrafts();
                    if (gameLogicSource && Pin.gameLogicV2 && Pin.gameLogicV2.compile) {
                        const compiled = Pin.gameLogicV2.compile(gameLogicSource, state.table);
                        if (compiled && compiled.ok && compiled.table) state.table = compiled.table;
                    }
                    model.syncLauncherConfig(state.table);
                    Pin.storage.local.save("autosave", state.table);
                    autosavedRevision = dirtyRevision;
                    location.hash = "#play&t=" + Pin.storage.url.encode(state.table);
                },
                onSelectElement: editorSession.selectElement,
                onDeleteElement: deleteElementById,
                onAddLevel: addLevel,
                onSaveLevelDraft: function saveLevelDraft(key, levelValue, draft) {
                    patchLevelFields(levelValue, draft);
                    resetCardDraft(key);
                },
                onSetLevelVisibility: setLevelVisibility,
                onIsolateLevel: isolateLevel,
                onShowAllLevels: showAllLevels,
                onAssignSelectedToLevel: assignSelectedToLevel,
                onRemoveLevel: removeLevel,
                onAddSequenceRule: addSequenceRule,
                onAddRuleTemplate: addRuleTemplate,
                onSelectRule: editorSession.selectRule,
                onSelectLogicNode: selectLogicNode,
                onAssignSelectedToLogicNode: assignSelectedToLogicNode,
                onAssignElementIdToLogicNode: assignElementIdToLogicNode,
                onMarkLogicEdgeSource: markLogicEdgeSource,
                onConnectLogicNodes: connectLogicNodes,
                onAddLogicNode: addLogicNode,
                onAddLogicStep: addLogicStep,
                onDeleteGraphEdge: deleteGraphEdge,
                onPatchGraphNode: patchGraphNode,
                onSaveGraphNodeDraft: function saveGraphNodeDraft(key, graphId, nodeId, draft) {
                    patchGraphNodeFields(graphId, nodeId, draft);
                    resetCardDraft(key);
                },
                onMoveGraphNode: moveGraphNode,
                onDeleteGraphNode: deleteGraphNode,
                onPatchRule: patchRule,
                onSaveRuleDraft: function saveRuleDraft(key, id, draft) {
                    patchRuleFields(id, draft);
                    resetCardDraft(key);
                },
                onDuplicateRule: duplicateRule,
                onDeleteRule: deleteRule,
                onAddSwitchMap: addSwitchMap,
                onPatchSwitchMap: patchSwitchMap,
                onSaveSwitchMapDraft: function saveSwitchMapDraft(key, index, draft) {
                    patchSwitchMapFields(index, draft);
                    resetCardDraft(key);
                },
                onRemoveSwitchMap: removeSwitchMap,
                onAddVariable: addVariable,
                onSaveVariableDraft: function saveVariableDraft(key, index, draft) {
                    patchVariableFields(index, draft);
                    resetCardDraft(key);
                },
                onRemoveVariable: removeVariable,
                onAddTrigger: addTrigger,
                onSaveTriggerDraft: function saveTriggerDraft(key, index, draft) {
                    patchTriggerFields(index, draft);
                    resetCardDraft(key);
                },
                onRemoveTrigger: removeTrigger,
                onFocusValidationIssue: focusValidationIssue,
                onDeleteSelected: function deleteSelected() {
                    const selectedNow = getSelected();
                    if (selectedNow) deleteElementById(selectedNow.id);
                },
                onDuplicateSelected: duplicateSelected
            });
            perfEnd("editor.renderInspector", inspectorStartedAt);
            perfEnd("editor.refreshInspectorPanel", startedAt);
        }

        function runRefresh() {
            refreshRaf = 0;
            if (refreshRequest.palette) refreshPalettePanel();
            if (refreshRequest.inspector) refreshInspectorPanel();
            if (refreshRequest.canvas || refreshRequest.inspector || refreshRequest.palette) refreshCanvas();
            refreshRequest.canvas = false;
            refreshRequest.palette = false;
            refreshRequest.inspector = false;
            flushPerf("editor");
        }

        function requestRefresh(flags) {
            if (flags.palette) refreshRequest.palette = true;
            if (flags.inspector) refreshRequest.inspector = true;
            if (flags.canvas) refreshRequest.canvas = true;
            if (!refreshRaf) refreshRaf = requestAnimationFrame(runRefresh);
        }

        function refresh(mode) {
            if (mode === "canvas") requestRefresh({ canvas: true });
            else if (mode === "inspector") requestRefresh({ inspector: true });
            else if (mode === "palette") requestRefresh({ palette: true });
            else if (mode === "panels") requestRefresh({ palette: true, inspector: true });
            else requestRefresh({ canvas: true, palette: true, inspector: true });
        }


        function hitTest(world) {
            getEditorRuntime();
            const visibleElements = getVisibleEditorElements();
            for (let i = visibleElements.length - 1; i >= 0; i--) {
                const el = visibleElements[i];
                const hit = Pin.editorHitTest.forElement(el, world, view, runtimeByIdCache ? runtimeByIdCache[el.id] : null);
                if (hit.hit) return { element: el, handle: hit.handle, body: hit.body };
            }
            return null;
        }

        function closePenPathIfNearStart(path) {
            const anchors = path && path.anchors;
            if (!anchors || anchors.length < 3) return false;
            const first = anchors[0];
            const last = anchors[anchors.length - 1];
            const closeDistance = Math.max(8, gridSize * 0.75);
            if (Math.hypot(last.x - first.x, last.y - first.y) > closeDistance) return false;
            anchors[anchors.length - 1] = { x: first.x, y: first.y };
            path.closed = true;
            return true;
        }

        function finishPenPath() {
            if (!penState || !penState.path) {
                activeTool = "select";
                paletteDirty = true;
                refresh("all");
                return;
            }
            closePenPathIfNearStart(penState.path);
            penState = null;
            paletteDirty = true;
            markTableDirty();
            refresh("all");
        }

        on(canvas, "mousedown", function onMouseDown(evt) {
            canvas.focus();
            if (activeTool === "pen" && evt.button === 2) {
                evt.preventDefault();
                finishPenPath();
                return;
            }
            if (evt.button === 1 || evt.button === 2 || isPanning) {
                isPanning = true;
                dragState = { kind: "pan", sx: evt.clientX, sy: evt.clientY, panX: view.panX, panY: view.panY };
                return;
            }
            if (evt.button !== 0) return;
            const world = Pin.editorTools.screenToWorld(canvas, evt, view);
            if (activeTool === "pen") {
                const penWorld = snapEnabled && !evt.ctrlKey && !evt.metaKey ? snapPoint(world, true) : world;
                if (!penState) {
                    pushUndo();
                    const path = createDefaultElement("path");
                    applyPenStyleToPath(path);
                    path.anchors = [{ x: penWorld.x, y: penWorld.y }];
                    state.table.elements.push(path);
                    selectedId = path.id;
                    penState = { path: path, lastWorld: penWorld };
                    paletteDirty = true;
                    markTableDirty();
                    refresh("all");
                    return;
                }
                pushUndo();
                penState.path.anchors.push({ x: penWorld.x, y: penWorld.y });
                penState.lastWorld = penWorld;
                markTableDirty();
                refresh("all");
                return;
            }
            const hit = hitTest(world);
            if (hit) {
                    selectedId = hit.element.id;
                    pushUndo();
                    dragState = {
                        kind: "drag",
                        elementId: hit.element.id,
                    handle: hit.handle,
                    startWorld: world,
                    startHandleWorld: hit.handle ? { x: hit.handle.x, y: hit.handle.y } : world,
                    pointerOffset: hit.handle ? { x: world.x - hit.handle.x, y: world.y - hit.handle.y } : { x: 0, y: 0 },
                    startSnapshot: Pin.editorTools.clone(hit.element)
                };
                canvas.classList.add("dragging");
            } else {
                selectedId = null;
            }
            refresh("inspector");
            refresh("canvas");
        });

        on(canvas, "contextmenu", function onContextMenu(evt) {
            if (activeTool !== "pen") return;
            evt.preventDefault();
        });

        on(canvas, "mousemove", function onMouseMove(evt) {
            const world = Pin.editorTools.screenToWorld(canvas, evt, view);
            if (penState) penState.lastWorld = snapEnabled && !evt.ctrlKey && !evt.metaKey ? snapPoint(world, true) : world;
            if (isPanning && dragState && dragState.kind === "pan") {
                view.panX = dragState.panX + (evt.clientX - dragState.sx);
                view.panY = dragState.panY + (evt.clientY - dragState.sy);
                gridLayerKey = "";
                refresh("canvas");
                return;
            }
            if (dragState && dragState.kind === "drag") {
                const el = state.table.elements.find(function find(e) { return e.id === dragState.elementId; });
                if (!el) return;
                Object.assign(el, Pin.editorTools.clone(dragState.startSnapshot));
                const moved = getSnapWorld(evt, world, dragState);
                Pin.editorHitTest.applyHandleDrag(el, dragState.handle, moved, dragState.startWorld, evt);
                if (el.type === "launcher") model.syncLauncherConfig(state.table);
                markTableDirty();
                refresh("canvas");
                return;
            }
            const hit = hitTest(world);
            const nextHover = hit ? hit.element.id : null;
            if (nextHover !== hoveredId || penState) {
                hoveredId = nextHover;
                refresh("canvas");
            }
        });

        on(window, "mouseup", function onMouseUp() {
            if (panelResizeState) {
                setRightPanelWidth(panelResizeState.currentWidth || panelResizeState.startWidth, true);
                panelResizeState = null;
                document.body.classList.remove("resizing-panel");
            }
            if (dragState) {
                dragState = null;
                canvas.classList.remove("dragging");
            }
            isPanning = false;
            if (tableLayerDirty) refresh("canvas");
        });

        on(resizer, "mousedown", function onResizeStart(evt) {
            evt.preventDefault();
            panelResizeState = {
                startX: evt.clientX,
                startWidth: right.getBoundingClientRect().width
            };
            document.body.classList.add("resizing-panel");
        });

        on(window, "mousemove", function onPanelResize(evt) {
            if (!panelResizeState) return;
            const width = panelResizeState.startWidth + (panelResizeState.startX - evt.clientX);
            panelResizeState.currentWidth = setRightPanelWidth(width, false);
        });

        on(canvas, "wheel", function onWheel(evt) {
            evt.preventDefault();
            const before = Pin.editorTools.screenToWorld(canvas, evt, view);
            const factor = Math.exp(-evt.deltaY * 0.001);
            view.zoom = Math.max(tableFitZoom, Math.min(4, view.zoom * factor));
            const afterScreen = Pin.editorTools.worldToScreen(before, view);
            const mouse = Pin.editorTools.getMousePos(canvas, evt);
            view.panX += mouse.x - afterScreen.x;
            view.panY += mouse.y - afterScreen.y;
            gridLayerKey = "";
            refresh("canvas");
        }, { passive: false });

        on(canvas, "dblclick", function onDblClick(evt) {
            const world = Pin.editorTools.screenToWorld(canvas, evt, view);
            const hit = hitTest(world);
            if (!hit) {
                fitTableView();
                return;
            }
            const el = hit.element;
            if (el.type !== "path") return;
            if (hit.handle && hit.handle.kind === "anchor") {
                if (el.anchors.length > 2) {
                    pushUndo();
                    el.anchors.splice(hit.handle.index, 1);
                    markTableDirty();
                    refresh("all");
                }
                return;
            }
            const body = Pin.editorHitTest.forElement(el, world, view, runtimeByIdCache ? runtimeByIdCache[el.id] : null);
            if (!body || !body.body) return;
            pushUndo();
            const idx = Math.min(el.anchors.length - 1, (body.body.segmentIndex || 0) + 1);
            el.anchors.splice(idx, 0, { x: body.body.x, y: body.body.y });
            markTableDirty();
            refresh("all");
        });

        on(window, "keydown", function onKeyDown(evt) {
            if (isTextEntryTarget(evt.target)) {
                if (evt.code === "Space") return;
                if (evt.key === "Escape" && penState) {
                    penState = null;
                    activeTool = "select";
                    refresh("all");
                }
                return;
            }
            if (evt.code === "Space") {
                isPanning = true;
            }
            if (evt.key === "p" || evt.key === "P") {
                activeTool = "pen";
                if (!penState) penState = null;
                refresh("all");
            }
            if (evt.key === "Escape" && penState) {
                penState = null;
                activeTool = "select";
                refresh("all");
            }
            if (evt.key === "Enter" && penState && penState.path.anchors.length > 1) {
                finishPenPath();
            }
            const selected = getSelected();
            if (!selected) return;
            const nudge = snapEnabled ? (evt.shiftKey ? gridSize * 5 : gridSize) : (evt.shiftKey ? 10 : 1);
            const nudgeMap = { ArrowLeft: [-nudge, 0], ArrowRight: [nudge, 0], ArrowUp: [0, -nudge], ArrowDown: [0, nudge] };
            if (nudgeMap[evt.key]) {
                evt.preventDefault();
                pushUndo();
                Pin.editorHitTest.shiftElement(selected, nudgeMap[evt.key][0], nudgeMap[evt.key][1]);
                if (selected.type === "launcher") model.syncLauncherConfig(state.table);
                markTableDirty();
                refresh("inspector");
                refresh("canvas");
                return;
            }
            if (evt.key === "g" || evt.key === "G") {
                snapEnabled = !snapEnabled;
                gridLayerKey = "";
                paletteDirty = true;
                refresh("all");
                return;
            }
            if (evt.key === "Delete" || evt.key === "Backspace") {
                if (penState && penState.path.anchors.length > 1) {
                    penState.path.anchors.pop();
                    markTableDirty();
                    refresh("all");
                    return;
                }
                deleteElementById(selected.id);
            }
            if (evt.key === "d" || evt.key === "D") {
                duplicateSelected();
            }
        });

        on(window, "keyup", function onKeyUp(evt) {
            if (evt.code === "Space") isPanning = false;
        });

        on(window, "resize", function onResize() {
            const previousFit = tableFitZoom;
            updateCanvasViewportSize();
            const nextFit = Math.max(0.25, Math.min(4, Math.min(
                Math.max(120, canvas.width - 32) / state.table.playfield.width,
                Math.max(120, canvas.height - 32) / state.table.playfield.height
            )));
            tableFitZoom = nextFit;
            if (view.zoom <= previousFit + 0.001) {
                fitTableView();
                return;
            }
            if (view.zoom < tableFitZoom) view.zoom = tableFitZoom;
            tableLayerDirty = true;
            gridLayerKey = "";
            refresh("canvas");
        });

        layout.appendChild(left);
        layout.appendChild(center);
        layout.appendChild(resizer);
        layout.appendChild(right);
        root.appendChild(layout);
        center.appendChild(hintBar);
        root._pinballCleanup = function cleanupEditor() {
            while (disposers.length) disposers.pop()();
            if (refreshRaf) {
                cancelAnimationFrame(refreshRaf);
                refreshRaf = 0;
            }
            if (syncViewportRaf) {
                cancelAnimationFrame(syncViewportRaf);
                syncViewportRaf = 0;
            }
        };
        interval(function autosave() {
            if (dirtyRevision === autosavedRevision && !hasPersistableDirtyDrafts()) return;
            if (Date.now() - lastDirtyAt < 1500) return;
            if (isInteractiveCanvasMotion()) return;
            if (isTextEntryTarget(document.activeElement)) return;
            flushPersistedDrafts();
            model.syncLauncherConfig(state.table);
            Pin.storage.local.save("autosave", state.table);
            autosavedRevision = dirtyRevision;
        }, 3000);
        on(window, "beforeunload", function onBeforeUnload() {
            flushPersistedDrafts();
            model.syncLauncherConfig(state.table);
            Pin.storage.local.save("autosave", state.table);
            autosavedRevision = dirtyRevision;
        });
        interval(function animateDash() {
            dashTick = (dashTick + 1) % 1000;
            if (dragState || hoveredId || penState) refresh("canvas");
        }, 120);
        try {
            setRightPanelWidth(Number(localStorage.getItem("pin.editor.rightPanelWidth")) || 360, false);
        } catch (e) {
            setRightPanelWidth(360, false);
        }
        updateCanvasViewportSize();
        requestSyncCanvasToTable();
        requestAnimationFrame(requestSyncCanvasToTable);
        if (window.visualViewport) {
            on(window.visualViewport, "resize", requestSyncCanvasToTable);
            on(window.visualViewport, "scroll", requestSyncCanvasToTable);
        }
        refresh("all");
    }

    Pin.editor = { mountEditor: mountEditor };
})(window.Pin);
