(function initEditorSession(Pin) {
    function createSession(options) {
        const state = options.state;
        const ensureSelectableLauncher = options.ensureSelectableLauncher;
        const ensureLevels = options.ensureLevels;
        const ensureElementLevels = options.ensureElementLevels;
        const syncLauncherConfig = options.syncLauncherConfig;
        const syncCanvasToTable = options.syncCanvasToTable;
        const markTableDirty = options.markTableDirty;
        const refresh = options.refresh;
        const setPaletteDirty = options.setPaletteDirty;
        const getLogicGraphs = options.getLogicGraphs;
        const findElementForSwitchId = options.findElementForSwitchId;
        const findElementForLampId = options.findElementForLampId;
        const setSelectedId = options.setSelectedId;
        const setSelectedRuleId = options.setSelectedRuleId;
        const setSelectedLogicNode = options.setSelectedLogicNode;
        const setSelectedGraphId = options.setSelectedGraphId;
        const setSelectedGraphNodeId = options.setSelectedGraphNodeId;
        const setPendingEdgeSourceNodeId = options.setPendingEdgeSourceNodeId;
        const setInspectorTab = options.setInspectorTab;

        function clearSelection() {
            setSelectedId(null);
            setSelectedRuleId(null);
            setSelectedLogicNode(null);
            setSelectedGraphId(null);
            setSelectedGraphNodeId(null);
            setPendingEdgeSourceNodeId(null);
        }

        function applyTable(table) {
            state.table = Pin.table.normalizeTable(table);
            ensureSelectableLauncher(state.table);
            ensureLevels(state.table);
            ensureElementLevels(state.table);
            syncLauncherConfig(state.table);
            clearSelection();
            setPaletteDirty(true);
            syncCanvasToTable();
            markTableDirty();
            refresh("all");
        }

        function selectElement(id) {
            setSelectedId(id || null);
            refresh("inspector");
            refresh("canvas");
        }

        function selectRule(id) {
            setSelectedRuleId(id || null);
            const graph = (getLogicGraphs() || []).find(function find(item) {
                return item.sourceRuleId === id;
            });
            setSelectedGraphId(graph ? graph.id : null);
            setSelectedLogicNode(null);
            setSelectedGraphNodeId(null);
            setPendingEdgeSourceNodeId(null);
            refresh("all");
        }

        function selectLogicNode(node) {
            if (!node) return;
            setSelectedLogicNode(node.id || null);
            setSelectedGraphNodeId(node.id || null);
            setSelectedGraphId(node.graphId || null);
            let element = null;
            if (node.refKind === "switch") element = findElementForSwitchId(node.refId);
            if (node.refKind === "lamp") element = findElementForLampId(node.refId);
            if (element) setSelectedId(element.id);
            setInspectorTab("logic");
            refresh("all");
        }

        function focusValidationIssue(issue) {
            if (!issue || !issue.ruleId) return;
            setSelectedRuleId(issue.ruleId);
            const graph = (getLogicGraphs() || []).find(function find(item) {
                return item.sourceRuleId === issue.ruleId;
            });
            if (graph) {
                setSelectedGraphId(graph.id);
                setSelectedGraphNodeId(null);
                setSelectedLogicNode(null);
                setInspectorTab("logic");
            } else {
                setSelectedGraphId(null);
                setSelectedGraphNodeId(null);
                setSelectedLogicNode(null);
                setInspectorTab("rules");
            }
            refresh("all");
        }

        return {
            clearSelection: clearSelection,
            applyTable: applyTable,
            selectElement: selectElement,
            selectRule: selectRule,
            selectLogicNode: selectLogicNode,
            focusValidationIssue: focusValidationIssue
        };
    }

    Pin.editorSession = {
        create: createSession
    };
})(window.Pin);
