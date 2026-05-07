/* What: Compile logic authoring doc to TBSpec-compatible rulesEngine fields.
 * Why: Runtime compatibility remains in rulesEngine while authoring stays simple.
 */
(function initLogicCompile(Pin) {
    function compileToRulesEngine(logicDoc) {
        /* What: Convert the six-table model into runtime-compatible payloads.
         * Why: Export requires compatibility with existing TBSpec fields.
         */
        var doc = Pin.logicTypes.normalizeLogicDocument(logicDoc);
        var variables = [];
        doc.stateTable.forEach(function each(row) {
            variables.push({
                id: row.id,
                type: row.type,
                initial: row.initial,
                volatile: !!row.volatile,
                derived: false
            });
        });
        doc.computedState.forEach(function each(row) {
            variables.push({
                id: row.id,
                type: row.type || "bool",
                expr: row.expr || "",
                derived: true
            });
        });
        return {
            switchMap: doc.switchRegistry.map(function map(item) {
                return {
                    id: item.id,
                    sourceElementId: item.sourceElementId,
                    kind: item.kind || "switch"
                };
            }),
            sequenceRules: [],
            triggers: compileTriggers(doc),
            variables: variables,
            logicGraphs: {
                logicDocument: Pin.logicTypes.clone(doc)
            }
        };
    }

    function compileTriggers(doc) {
        /* What: Compile action/reset rows into trigger-like structures.
         * Why: Runtime consumers expect trigger-centric rule definitions.
         */
        var out = [];
        doc.actionRules.forEach(function each(rule) {
            out.push({
                id: rule.id,
                kind: "action",
                trigger: rule.trigger,
                condition: rule.condition || "",
                effects: Array.isArray(rule.effects) ? Pin.logicTypes.clone(rule.effects) : [],
                enabled: rule.enabled !== false
            });
        });
        doc.resetRules.forEach(function each(rule) {
            out.push({
                id: rule.id,
                kind: "reset",
                trigger: rule.trigger,
                scope: rule.scope || "volatile",
                resets: Array.isArray(rule.resets) ? Pin.logicTypes.clone(rule.resets) : []
            });
        });
        return out;
    }

    function extractFromTable(table) {
        /* What: Load logic authoring doc from table.rulesEngine metadata.
         * Why: Logic editing should round-trip through table JSON.
         */
        var raw = table && table.rulesEngine && table.rulesEngine.logicGraphs && table.rulesEngine.logicGraphs.logicDocument;
        return Pin.logicTypes.normalizeLogicDocument(raw || null);
    }

    function applyToTable(table, logicDoc) {
        /* What: Merge compiled rulesEngine fields into a cloned table object.
         * Why: Exporting should not mutate working table state by accident.
         */
        var out = Pin.table.cloneTable(table || {});
        out.rulesEngine = compileToRulesEngine(logicDoc);
        return out;
    }

    Pin.logicCompile = {
        compileToRulesEngine: compileToRulesEngine,
        compileTriggers: compileTriggers,
        extractFromTable: extractFromTable,
        applyToTable: applyToTable
    };
})(window.Pin);
