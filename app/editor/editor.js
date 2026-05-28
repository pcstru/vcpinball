(function initEditor(Pin) {
    const model = Pin.editorModel;

    function makeId(type) {
        return type + "_" + Math.random().toString(36).slice(2, 8);
    }

    function createDefaultElement(type) {
        return model.createDefaultElement(type, makeId);
    }

        function mountEditor(root, state) {
            const tableAssetBaseHref = typeof state.tableAssetBaseHref === "string" ? state.tableAssetBaseHref : "";
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
        let selectedIds = selectedId ? [selectedId] : [];
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
        let visibleElementsCache = null;
        let visibleElementsCacheRevision = -1;
        let dirtyRevision = 0;
        let autosavedRevision = -1;
        let lastDirtyAt = 0;
        let tableFitZoom = 1;
        const inspectorDrafts = {};
        let assistantRuntime = null;
        let gameLogicSource = null;

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

        function setSelectedIds(ids, primaryId) {
            // What: Keep primary inspector selection and canvas group selection coherent.
            // Why: multi-select is transient editor state, while existing panels still
            // expect one primary element for property editing.
            const unique = [];
            (ids || []).forEach(function each(id) {
                if (!id || unique.indexOf(id) >= 0 || !getElementById(id)) return;
                unique.push(id);
            });
            selectedIds = unique;
            selectedId = primaryId && unique.indexOf(primaryId) >= 0 ? primaryId : (unique[unique.length - 1] || null);
        }

        function selectOnlyElement(id) {
            setSelectedIds(id ? [id] : [], id || null);
        }

        function isElementSelected(id) {
            return !!id && selectedIds.indexOf(id) >= 0;
        }

        function makePrimarySelection(id) {
            if (!id) {
                selectOnlyElement(null);
                return;
            }
            if (selectedIds.indexOf(id) < 0) selectedIds.push(id);
            setSelectedIds(selectedIds, id);
        }

        function toggleElementSelection(id) {
            if (!id) {
                selectOnlyElement(null);
                return;
            }
            if (selectedIds.indexOf(id) >= 0) {
                selectedIds = selectedIds.filter(function keep(existingId) { return existingId !== id; });
                setSelectedIds(selectedIds, selectedId === id ? selectedIds[selectedIds.length - 1] : selectedId);
                return;
            }
            selectedIds.push(id);
            setSelectedIds(selectedIds, id);
        }

        function getSelectedElements() {
            return selectedIds.map(getElementById).filter(Boolean);
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
            if (drag.handle.kind === "in" || drag.handle.kind === "out" || drag.handle.kind === "rotate" || drag.handle.kind === "swingEnd" || drag.handle.kind === "activeAngle") return world;
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
                    key.indexOf("rule:") === 0;
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
            gameLogicSource = null;
            refresh("inspector");
        }

        /*
         * What: Placeholder for removed inline gameplay logic compiler.
         * Why: current logic authoring lives in the dedicated #logic workspace.
         */
        function compileGameLogicIntoTable() {
            return { ok: false, issues: [{ severity: "error", message: "Logic compiler has been removed." }] };
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
            setSelectedId: function setSelectedId(next) { selectOnlyElement(next); },
            setSelectedRuleId: function setSelectedRuleId(next) { selectedRuleId = next; },
            setSelectedLogicNode: function setSelectedLogicNode(next) { selectedLogicNode = next; },
            setSelectedGraphId: function setSelectedGraphId(next) { selectedGraphId = next; },
            setSelectedGraphNodeId: function setSelectedGraphNodeId(next) { selectedGraphNodeId = next; },
            setPendingEdgeSourceNodeId: function setPendingEdgeSourceNodeId(next) { pendingEdgeSourceNodeId = next; },
            setInspectorTab: function setInspectorTab(next) { inspectorTab = next; }
        });

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
            if (visibleElementsCache && visibleElementsCacheRevision === dirtyRevision) return visibleElementsCache;
            /*
             * What: Cache the currently visible element list for this table revision.
             * Why: editor hover hit testing and render setup ask for the same filtered
             * list repeatedly while the table itself is unchanged.
             */
            visibleElementsCache = (state.table.elements || []).filter(function keep(el) {
                return model.isElementVisibleInEditor(state.table, el);
            });
            visibleElementsCacheRevision = dirtyRevision;
            return visibleElementsCache;
        }

        function getEditorDisplayTable() {
            return Object.assign({}, state.table, {
                elements: getVisibleEditorElements()
            });
        }

        function getLogicGraphs() {
            return [];
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
            return null;
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

        function cloneJson(value) {
            return JSON.parse(JSON.stringify(value == null ? {} : value));
        }

        function applyNormalizedPatch(target, patch) {
            Object.keys(patch || {}).forEach(function each(key) {
                const value = patch[key];
                if (Array.isArray(value)) {
                    target[key] = cloneJson(value);
                    return;
                }
                if (value && typeof value === "object") {
                    if (!target[key] || typeof target[key] !== "object" || Array.isArray(target[key])) target[key] = {};
                    applyNormalizedPatch(target[key], value);
                    return;
                }
                target[key] = normalizeInput(value);
            });
        }

        function getLogicDocForTable(table) {
            table.logicDocument = table.logicDocument || {
                logicVersion: 1,
                switchRegistry: [],
                stateTable: [],
                computedState: [],
                lampBindings: [],
                actionRules: [],
                resetRules: []
            };
            return table.logicDocument;
        }

        function applyAssistantPatchToTable(table, patch) {
            if (!patch || typeof patch !== "object") return { ok: false, message: "Patch must be an object." };
            const working = table;
            working.elements = Array.isArray(working.elements) ? working.elements : [];
            working.features = Array.isArray(working.features) ? working.features : [];

            if (patch.tablePatch && typeof patch.tablePatch === "object") {
                applyNormalizedPatch(working, patch.tablePatch);
            }
            if (Array.isArray(patch.addElements)) {
                patch.addElements.forEach(function each(element) {
                    if (!element || typeof element !== "object") return;
                    if (!element.id) element.id = makeId(element.type || "element");
                    working.elements.push(cloneJson(element));
                });
            }
            if (Array.isArray(patch.patchElements)) {
                patch.patchElements.forEach(function each(change) {
                    if (!change || !change.id || !change.patch || typeof change.patch !== "object") return;
                    const element = (working.elements || []).find(function find(el) { return el && el.id === change.id; });
                    if (!element) return;
                    applyNormalizedPatch(element, change.patch);
                });
            }
            if (Array.isArray(patch.removeElements)) {
                const removeIds = {};
                patch.removeElements.forEach(function each(id) { if (id) removeIds[String(id)] = true; });
                working.elements = (working.elements || []).filter(function keep(el) {
                    return !(el && el.id && removeIds[String(el.id)]);
                });
            }
            if (Array.isArray(patch.addFeatures)) {
                patch.addFeatures.forEach(function each(feature) {
                    if (!feature || typeof feature !== "object") return;
                    if (!feature.id) feature.id = makeId("feature");
                    working.features.push(cloneJson(feature));
                });
            }
            if (Array.isArray(patch.patchFeatures)) {
                patch.patchFeatures.forEach(function each(change) {
                    if (!change || !change.id || !change.patch || typeof change.patch !== "object") return;
                    const feature = (working.features || []).find(function find(item) { return item && item.id === change.id; });
                    if (!feature) return;
                    applyNormalizedPatch(feature, change.patch);
                });
            }
            if (Array.isArray(patch.removeFeatures)) {
                const removeIds = {};
                patch.removeFeatures.forEach(function each(id) { if (id) removeIds[String(id)] = true; });
                working.features = (working.features || []).filter(function keep(item) {
                    return !(item && item.id && removeIds[String(item.id)]);
                });
            }
            if (patch.logicDocPatch && typeof patch.logicDocPatch === "object") {
                const logicDoc = getLogicDocForTable(working);
                applyNormalizedPatch(logicDoc, patch.logicDocPatch);
                if (Pin.logicTypes && Pin.logicTypes.normalizeLogicDocument) {
                    working.logicDocument = Pin.logicTypes.normalizeLogicDocument(logicDoc);
                }
            }

            const normalized = Pin.table.normalizeTable(working);
            const tableValidation = Pin.table.validateTable(normalized);
            let logicValidation = { ok: true, issues: [] };
            if (Pin.logicCompile && Pin.logicValidate && Pin.logicAssets) {
                const logicDoc = Pin.logicCompile.extractFromTable(normalized);
                const logicAssets = Pin.logicAssets.extractAssets(normalized);
                logicValidation = Pin.logicValidate.validateDocument(logicDoc, logicAssets);
            }
            const mergedIssues = []
                .concat(Array.isArray(tableValidation.issues) ? tableValidation.issues : [])
                .concat(Array.isArray(logicValidation.issues) ? logicValidation.issues : []);
            const ok = !!(tableValidation.ok && logicValidation.ok);
            return {
                ok: ok,
                message: ok ? "Patch applied." : "Patch produced validation errors.",
                table: normalized,
                issues: mergedIssues
            };
        }

        const assistantPatchOps = {
            applyAssistantPatch: function applyAssistantPatch(patch) {
                const result = applyAssistantPatchToTable(state.table, patch);
                if (!result.ok) return { ok: false, message: result.message, issues: result.issues || [] };
                pushUndo();
                state.table = result.table;
                model.ensureSelectableLauncher(state.table);
                model.ensureLevels(state.table);
                model.ensureElementLevels(state.table);
                model.syncLauncherConfig(state.table);
                markTableDirty();
                refresh("all");
                return { ok: true, message: result.message, issues: result.issues || [] };
            },
            markEdgeSource: function markEdgeSource() {},
            connectNodes: function connectNodes() {},
            addNode: function addNode() {},
            assignSelected: function assignSelected() {},
            assignElementId: function assignElementId() {},
            addSequence: function addSequence() {},
            addTemplate: function addTemplate() {},
            addStep: function addStep() {},
            deleteEdge: function deleteEdge() {},
            patchNode: function patchNode() {},
            patchNodeFields: function patchNodeFields() {},
            moveNode: function moveNode() {},
            deleteNode: function deleteNode() {},
            patchRule: function patchRule() {},
            patchRuleFields: function patchRuleFields() {},
            duplicateRule: function duplicateRule() {},
            deleteRule: function deleteRule() {},
            addSwitchMap: function addSwitchMap() {},
            patchSwitchMap: function patchSwitchMap() {},
            patchSwitchMapFields: function patchSwitchMapFields() {},
            removeSwitchMap: function removeSwitchMap() {},
            addVariable: function addVariable() {},
            patchVariableFields: function patchVariableFields() {},
            removeVariable: function removeVariable() {},
            addTrigger: function addTrigger() {},
            patchTriggerFields: function patchTriggerFields() {},
            removeTrigger: function removeTrigger() {}
        };
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
                return assistantPatchOps.applyAssistantPatch(patch);
            },
            previewPatch: function previewPatch(patch) {
                const previewTable = Pin.editorTools.clone(state.table);
                const result = applyAssistantPatchToTable(previewTable, patch);
                return {
                    ok: result.ok,
                    issuesCount: (result.issues || []).filter(function filter(issue) { return issue && issue.severity !== "info"; }).length,
                    issues: result.issues || [],
                    error: result.ok ? "" : (result.message || "Preview failed.")
                };
            },
            refresh: refresh
        });

        function selectLogicNode(node) {
            editorSession.selectLogicNode(node);
            const graph = getSelectedGraph();
            if (graph) selectedRuleId = graph.sourceRuleId || selectedRuleId;
        }

        function markLogicEdgeSource(nodeId) {
            assistantPatchOps.markLogicEdgeSource(nodeId);
        }

        function connectLogicNodes(graphId, fromNodeId, toNodeId) {
            assistantPatchOps.connectLogicNodes(graphId, fromNodeId, toNodeId);
        }

        function addLogicNode(graphId, type, props) {
            assistantPatchOps.addLogicNode(graphId, type, props);
        }

        function assignSelectedToLogicNode(node) {
            assistantPatchOps.assignSelectedToLogicNode(node);
        }

        function assignElementIdToLogicNode(node, elementId) {
            assistantPatchOps.assignElementIdToLogicNode(node, elementId);
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
            assistantPatchOps.addSequenceRule();
        }

        function addRuleTemplate(kind) {
            assistantPatchOps.addRuleTemplate(kind);
        }

        function addLogicStep(graphId) {
            assistantPatchOps.addLogicStep(graphId);
        }

        function deleteGraphEdge(graphId, edgeId) {
            assistantPatchOps.deleteGraphEdge(graphId, edgeId);
        }

        function patchGraphNode(graphId, nodeId, key, value) {
            assistantPatchOps.patchGraphNode(graphId, nodeId, key, value);
        }

        function patchGraphNodeFields(graphId, nodeId, patch) {
            assistantPatchOps.patchGraphNodeFields(graphId, nodeId, patch);
        }

        function moveGraphNode(graphId, nodeId, x, y) {
            assistantPatchOps.moveGraphNode(graphId, nodeId, x, y);
        }

        function deleteGraphNode(graphId, nodeId) {
            assistantPatchOps.deleteGraphNode(graphId, nodeId);
        }

        function patchRule(id, key, value) {
            assistantPatchOps.patchRule(id, key, value);
        }

        function patchRuleFields(id, patch) {
            assistantPatchOps.patchRuleFields(id, patch);
        }

        function duplicateRule(id) {
            assistantPatchOps.duplicateRule(id);
        }

        function deleteRule(id) {
            assistantPatchOps.deleteRule(id);
        }

        function addSwitchMap() {
            assistantPatchOps.addSwitchMap();
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
            assistantPatchOps.patchSwitchMap(index, key, value);
        }

        function patchSwitchMapFields(index, patch) {
            assistantPatchOps.patchSwitchMapFields(index, patch);
        }

        function removeSwitchMap(index) {
            assistantPatchOps.removeSwitchMap(index);
        }

        function addVariable() {
            assistantPatchOps.addVariable();
        }

        function patchVariableFields(index, patch) {
            assistantPatchOps.patchVariableFields(index, patch);
        }

        function removeVariable(index) {
            assistantPatchOps.removeVariable(index);
        }

        function addTrigger() {
            assistantPatchOps.addTrigger();
        }

        function patchTriggerFields(index, patch) {
            assistantPatchOps.patchTriggerFields(index, patch);
        }

        function removeTrigger(index) {
            assistantPatchOps.removeTrigger(index);
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
            if (selectedIds.indexOf(id) >= 0) {
                selectedIds = selectedIds.filter(function keep(existingId) { return existingId !== id; });
                setSelectedIds(selectedIds, selectedId === id ? selectedIds[selectedIds.length - 1] : selectedId);
            }
        }

        function duplicateSelected() {
            const copy = editorActions.duplicateSelected();
            if (copy) selectOnlyElement(copy.id);
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
                " | wheel zoom | Space drag pan | Shift-click add | blank drag select | G snap | arrows nudge | Delete remove | D duplicate" +
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
            visibleElementsCache = null;
            visibleElementsCacheRevision = -1;
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
                currentBall: 1,
                tableAssetBaseHref: tableAssetBaseHref
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

            getSelectedElements().forEach(function each(selectedElement) {
                if (!selectedElement || selectedElement.id === selectedId) return;
                Pin.editorHitTest.drawHandles(ctx, selectedElement, true, view, 0, {
                    strokeStyle: "rgba(255,255,255,0.72)",
                    fillStyle: "rgba(0,255,200,0.55)",
                    lineWidth: 1.2,
                    boundsStrokeStyle: "rgba(0,255,200,0.55)"
                });
            });
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
            if (hoveredId && !isElementSelected(hoveredId)) {
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
            if (dragState && dragState.kind === "marquee") {
                const p1 = Pin.editorTools.worldToScreen(dragState.startWorld, view);
                const p2 = Pin.editorTools.worldToScreen(dragState.currentWorld, view);
                const x = Math.min(p1.x, p2.x);
                const y = Math.min(p1.y, p2.y);
                const width = Math.abs(p2.x - p1.x);
                const height = Math.abs(p2.y - p1.y);
                ctx.save();
                ctx.fillStyle = "rgba(0,255,200,0.12)";
                ctx.strokeStyle = "rgba(0,255,200,0.9)";
                ctx.setLineDash([5, 4]);
                ctx.fillRect(x, y, width, height);
                ctx.strokeRect(x, y, width, height);
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
                    selectOnlyElement(el.id);
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
                graphNodeTypes: [],
                graphNodes: [],
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
                    return;
                },
                onScaffoldGameLogicFromTable: function onScaffoldGameLogicFromTable() {
                    return;
                },
                onCompileGameLogic: function onCompileGameLogic() {
                    compileGameLogicIntoTable();
                },
                onValidateGameLogic: function onValidateGameLogic() {
                    return [];
                },
                onExportGameLogicFile: function onExportGameLogicFile() {
                    return;
                },
                onImportGameLogicFile: function onImportGameLogicFile() {
                    return;
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
                    const providerDraft = inspectorDrafts["assistant:settings"];
                    if (providerDraft && providerDraft.dirty) {
                        assistantRuntime.setSettings(providerDraft.draft);
                        resetCardDraft("assistant:settings");
                    }
                    assistantRuntime.testConnection();
                },
                onLoadAssistantModels: function loadAssistantModels() {
                    const providerDraft = inspectorDrafts["assistant:settings"];
                    if (providerDraft && providerDraft.dirty) {
                        assistantRuntime.setSettings(providerDraft.draft);
                        resetCardDraft("assistant:settings");
                    }
                    assistantRuntime.loadModels().catch(function ignore() {});
                },
                onAutoSaveAssistantModel: function autoSaveAssistantModel(value) {
                    /* What: Persist model selection immediately as the operator types or picks.
                     * Why: Chat/Agentic/Lab all read persisted assistant settings; unsaved draft
                     *      model changes must not silently vanish across tabs/routes.
                     */
                    const snapshot = assistantRuntime.getState ? assistantRuntime.getState() : { settings: {} };
                    const current = snapshot && snapshot.settings ? snapshot.settings : {};
                    assistantRuntime.setSettings(Object.assign({}, current, {
                        model: value == null ? "" : String(value)
                    }));
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
                    const providerDraft = inspectorDrafts["assistant:settings"];
                    if (providerDraft && providerDraft.dirty) {
                        assistantRuntime.setSettings(providerDraft.draft);
                        resetCardDraft("assistant:settings");
                    }
                    assistantRuntime.send();
                },
                onRunAgentic: function runAgentic() {
                    const providerDraft = inspectorDrafts["assistant:settings"];
                    if (providerDraft && providerDraft.dirty) {
                        assistantRuntime.setSettings(providerDraft.draft);
                        resetCardDraft("assistant:settings");
                    }
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
                onOpenPhysicsLab: function openPhysicsLab() {
                    flushPersistedDrafts();
                    model.syncLauncherConfig(state.table);
                    Pin.storage.local.save("autosave", state.table);
                    try {
                        localStorage.setItem("pin.physicsLab.handoff", JSON.stringify({
                            source: "design",
                            at: Date.now(),
                            table: state.table
                        }));
                    } catch (error) {}
                    const next = new URL("physics-lab.html#sandbox", location.href);
                    location.href = next.href;
                },
                onLoadSlot1: function loadSlot1() {
                    const t = Pin.storage.local.load("slot1");
                    if (t) {
                        pushUndo();
                        clearAllDrafts();
                        editorSession.applyTable(t);
                    }
                },
                onWipeBrowserMemory: function wipeBrowserMemory() {
                    if (!window.confirm("Wipe all Pinball browser memory for this site, including autosaves and assistant settings?")) return;
                    if (Pin.storage && Pin.storage.local && Pin.storage.local.clearApp) Pin.storage.local.clearApp();
                    location.reload();
                },
                onTestPlay: function testPlay() {
                    flushPersistedDrafts();
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

        function normalizedWorldRect(a, b) {
            return {
                minX: Math.min(a.x, b.x),
                minY: Math.min(a.y, b.y),
                maxX: Math.max(a.x, b.x),
                maxY: Math.max(a.y, b.y)
            };
        }

        function selectElementsInRect(startWorld, currentWorld) {
            // What: Select visible design elements whose authored geometry intersects the drag box.
            // Why: bounds-only overlap can select nearby objects that never physically enter the marquee.
            getEditorRuntime();
            const rect = normalizedWorldRect(startWorld, currentWorld);
            const ids = [];
            getVisibleEditorElements().forEach(function each(el) {
                if (Pin.editorHitTest.elementIntersectsRect(el, rect, runtimeByIdCache ? runtimeByIdCache[el.id] : null)) ids.push(el.id);
            });
            setSelectedIds(ids, ids[ids.length - 1] || null);
        }

        function restoreDragSnapshot(el, snapshot) {
            if (!el || !snapshot) return;
            Object.assign(el, Pin.editorTools.clone(snapshot));
        }

        function syncLauncherConfigForElements(elements) {
            if ((elements || []).some(function some(el) { return el && el.type === "launcher"; })) {
                model.syncLauncherConfig(state.table);
            }
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
                    selectOnlyElement(path.id);
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
                if (evt.shiftKey) {
                    toggleElementSelection(hit.element.id);
                    refresh("inspector");
                    refresh("canvas");
                    return;
                }
                const wasSelected = isElementSelected(hit.element.id);
                if (wasSelected) makePrimarySelection(hit.element.id);
                else selectOnlyElement(hit.element.id);
                const selectedForDrag = getSelectedElements();
                const canGroupMove = wasSelected && selectedForDrag.length > 1 && hit.handle && hit.handle.kind === "move";
                pushUndo();
                dragState = {
                    kind: "drag",
                    elementId: hit.element.id,
                    handle: hit.handle,
                    startWorld: world,
                    startHandleWorld: hit.handle ? { x: hit.handle.x, y: hit.handle.y } : world,
                    pointerOffset: hit.handle ? { x: world.x - hit.handle.x, y: world.y - hit.handle.y } : { x: 0, y: 0 },
                    startSnapshot: Pin.editorTools.clone(hit.element),
                    groupIds: canGroupMove ? selectedForDrag.map(function map(el) { return el.id; }) : null,
                    groupSnapshots: canGroupMove ? selectedForDrag.reduce(function reduce(acc, el) {
                        acc[el.id] = Pin.editorTools.clone(el);
                        return acc;
                    }, {}) : null
                };
                canvas.classList.add("dragging");
            } else {
                dragState = {
                    kind: "marquee",
                    startWorld: world,
                    currentWorld: world,
                    startClientX: evt.clientX,
                    startClientY: evt.clientY
                };
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
                const moved = getSnapWorld(evt, world, dragState);
                if (dragState.groupIds && dragState.groupSnapshots) {
                    const movedElements = [];
                    const dx = moved.x - dragState.startWorld.x;
                    const dy = moved.y - dragState.startWorld.y;
                    dragState.groupIds.forEach(function each(id) {
                        const element = getElementById(id);
                        if (!element) return;
                        restoreDragSnapshot(element, dragState.groupSnapshots[id]);
                        Pin.editorHitTest.shiftElement(element, dx, dy);
                        movedElements.push(element);
                    });
                    syncLauncherConfigForElements(movedElements);
                    markTableDirty();
                    refresh("canvas");
                    return;
                }
                restoreDragSnapshot(el, dragState.startSnapshot);
                Pin.editorHitTest.applyHandleDrag(el, dragState.handle, moved, dragState.startWorld, { table: state.table, altKey: evt.altKey });
                if (el.type === "launcher") model.syncLauncherConfig(state.table);
                markTableDirty();
                refresh("canvas");
                return;
            }
            if (dragState && dragState.kind === "marquee") {
                dragState.currentWorld = world;
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

        on(window, "mouseup", function onMouseUp(evt) {
            if (panelResizeState) {
                setRightPanelWidth(panelResizeState.currentWidth || panelResizeState.startWidth, true);
                panelResizeState = null;
                document.body.classList.remove("resizing-panel");
            }
            if (dragState) {
                if (dragState.kind === "marquee") {
                    dragState.currentWorld = Pin.editorTools.screenToWorld(canvas, evt, view);
                    if (Math.hypot(evt.clientX - dragState.startClientX, evt.clientY - dragState.startClientY) < 4) {
                        selectOnlyElement(null);
                    } else {
                        selectElementsInRect(dragState.startWorld, dragState.currentWorld);
                    }
                    refresh("inspector");
                    refresh("canvas");
                }
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
                const nudgedElements = getSelectedElements();
                nudgedElements.forEach(function each(el) {
                    Pin.editorHitTest.shiftElement(el, nudgeMap[evt.key][0], nudgeMap[evt.key][1]);
                });
                syncLauncherConfigForElements(nudgedElements);
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
