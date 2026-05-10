/* What: Extract logic-relevant physical assets from a table JSON.
 * Why: Logic authoring references existing switches and lamps from the table.
 */
(function initLogicAssets(Pin) {
    var SWITCH_TYPES = {
        lane: true,
        dropTarget: true,
        bumper: true,
        scoreZone: true,
        drain: true,
        spinner: true,
        kicker: true,
        trough: true,
        gate: true
    };
    var LAMP_TYPES = { light: true, arrowLight: true, boxLight: true, dropTarget: true, lane: true };

    function extractAssets(table) {
        /* What: Gather switch/lamp candidates from the current table.
         * Why: The logic editor must bootstrap from physical elements.
         */
        var elements = table && Array.isArray(table.elements) ? table.elements : [];
        var switchCandidates = [];
        var lampCandidates = [];
        elements.forEach(function each(el) {
            if (!el || typeof el.id !== "string") return;
            if (SWITCH_TYPES[el.type]) {
                switchCandidates.push({
                    id: el.id,
                    name: String(el.name || el.label || el.id),
                    sourceElementId: el.id,
                    kind: "switch",
                    type: el.type
                });
            }
            if (LAMP_TYPES[el.type]) {
                var lampKey = (el.type === "dropTarget") ? String(el.id) : String(el.lampId || el.id);
                lampCandidates.push({
                    id: lampKey,
                    sourceElementId: el.id,
                    name: String(el.name || el.label || el.text || el.lampId || el.id),
                    type: el.type
                });
            }
        });
        return { switchCandidates: switchCandidates, lampCandidates: lampCandidates };
    }

    Pin.logicAssets = { extractAssets: extractAssets };
})(window.Pin);
