/* What: Read and write the current table-level logic document.
 * Why: Logic authoring no longer emits separate compiled rule payloads.
 */
(function initLogicCompile(Pin) {
    function extractFromTable(table) {
        /* What: Load the table's current logic document.
         * Why: Runtime and editor use one source of truth.
         */
        var raw = table && table.logicDocument;
        return Pin.logicTypes.normalizeLogicDocument(raw || null);
    }

    function applyToTable(table, logicDoc) {
        /* What: Merge the current logic document into a cloned table.
         * Why: Exporting should not mutate working table state by accident.
         */
        var out = Pin.table.cloneTable(table || {});
        out.logicDocument = Pin.logicTypes.normalizeLogicDocument(logicDoc);
        return out;
    }

    Pin.logicCompile = {
        extractFromTable: extractFromTable,
        applyToTable: applyToTable
    };
})(window.Pin);
