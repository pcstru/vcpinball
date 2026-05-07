/* What: Core document helpers for the logic-only authoring model.
 * Why: The #logic endpoint needs a stable schema that stays simple for humans.
 */
(function initLogicTypes(Pin) {
    function createEmptyLogicDocument() {
        /* What: Build a fresh logic authoring document.
         * Why: Editors and imports need a canonical default shape.
         */
        return {
            logicVersion: 1,
            switchRegistry: [],
            stateTable: [],
            computedState: [],
            lampBindings: [],
            actionRules: [],
            resetRules: []
        };
    }

    function clone(value) {
        /* What: Deep clone JSON-safe data.
         * Why: Editor state mutations should not leak to source objects.
         */
        return JSON.parse(JSON.stringify(value));
    }

    function normalizeLogicDocument(input) {
        /* What: Normalize any input into the logic v1 shape.
         * Why: Imported/embedded data may be missing arrays.
         */
        var base = createEmptyLogicDocument();
        var source = input && typeof input === "object" ? input : {};
        function asList(value) {
            if (Array.isArray(value)) return clone(value);
            if (value && typeof value === "object") return [clone(value)];
            return [];
        }
        base.logicVersion = source.logicVersion === 1 ? 1 : 1;
        base.switchRegistry = asList(source.switchRegistry);
        base.stateTable = asList(source.stateTable);
        base.computedState = asList(source.computedState);
        base.lampBindings = asList(source.lampBindings);
        base.actionRules = asList(source.actionRules);
        base.resetRules = asList(source.resetRules);
        return base;
    }

    function nextId(prefix) {
        /* What: Create short deterministic-like IDs for UI-created rows.
         * Why: Users need immediate IDs without a backend allocator.
         */
        return String(prefix || "id") + "_" + Math.random().toString(36).slice(2, 8);
    }

    Pin.logicTypes = {
        createEmptyLogicDocument: createEmptyLogicDocument,
        normalizeLogicDocument: normalizeLogicDocument,
        clone: clone,
        nextId: nextId
    };
})(window.Pin);
