/* What: Runtime rule helpers for element property/score overrides.
 * Why: Mechanisms such as gates need dynamic properties driven by logic state.
 */
(function initRules(Pin) {
    function resolveElementProperty(world, el, property, fallback) {
        /* What: Resolve a dynamic element property value.
         * Why: Logic effects can override per-element properties at runtime.
         */
        if (!world || !el || !property) return fallback;
        var map = world.ruleState && world.ruleState.elementProperties;
        if (!map) return fallback;
        var row = map[el.id];
        if (!row || !Object.prototype.hasOwnProperty.call(row, property)) return fallback;
        return row[property];
    }

    function resolveElementScore(world, el, fallback) {
        /* What: Resolve score using optional runtime overrides.
         * Why: Existing scoring elements call through this contract.
         */
        if (!world || !el) return fallback;
        var propertyOverride = resolveElementProperty(world, el, "score", null);
        if (propertyOverride != null) {
            var propertyValue = Number(propertyOverride);
            if (Number.isFinite(propertyValue)) return propertyValue;
        }
        var overrides = world.ruleState && world.ruleState.elementScores;
        if (!overrides || !Object.prototype.hasOwnProperty.call(overrides, el.id)) return fallback;
        var value = Number(overrides[el.id]);
        return Number.isFinite(value) ? value : fallback;
    }

    Pin.rules = {
        resolveElementProperty: resolveElementProperty,
        resolveElementScore: resolveElementScore
    };
})(window.Pin);
