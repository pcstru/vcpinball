/* What: Validation for the logic authoring document.
 * Why: The #logic editor requires aggressive, inspectable rule validation.
 */
(function initLogicValidate(Pin) {
    function validateDocument(doc, assets) {
        /* What: Validate references, expression syntax, and dependency safety.
         * Why: Invalid authoring data should be caught before simulation/export.
         */
        var issues = [];
        var errors = [];
        var expr = Pin.logicExpressions;
        var safeDoc = Pin.logicTypes.normalizeLogicDocument(doc);
        var switchSet = {};
        var stateSet = {};
        var computedSet = {};
        var lampSet = {};
        var assetSwitch = {};
        var assetLamp = {};

        (assets && assets.switchCandidates || []).forEach(function each(s) { assetSwitch[s.id] = true; });
        (assets && assets.lampCandidates || []).forEach(function each(l) { assetLamp[l.id] = true; });

        function issue(severity, section, id, message) {
            var item = { severity: severity, section: section, id: id || "", message: message };
            issues.push(item);
            if (severity === "error") errors.push(item);
        }
        function requireUnique(list, section) {
            var seen = {};
            list.forEach(function each(row, i) {
                var id = row && row.id ? String(row.id) : "";
                if (!id) {
                    issue("error", section, "", "Row " + i + " missing id");
                    return;
                }
                if (seen[id]) issue("error", section, id, "Duplicate id");
                seen[id] = true;
            });
            return seen;
        }

        switchSet = requireUnique(safeDoc.switchRegistry, "switchRegistry");
        stateSet = requireUnique(safeDoc.stateTable, "stateTable");
        computedSet = requireUnique(safeDoc.computedState, "computedState");
        safeDoc.switchRegistry.forEach(function each(row) {
            var isTimer = row && row.kind === "timer";
            if (isTimer) return;
            if (!assetSwitch[row.sourceElementId]) issue("error", "switchRegistry", row.id, "Unknown sourceElementId '" + row.sourceElementId + "'");
        });

        safeDoc.lampBindings.forEach(function each(row, i) {
            var key = row && row.lampId ? String(row.lampId) : "";
            if (!key) issue("error", "lampBindings", "", "Row " + i + " missing lampId");
            else if (lampSet[key]) issue("error", "lampBindings", key, "Duplicate lamp binding");
            lampSet[key] = true;
            if (!assetLamp[key]) issue("error", "lampBindings", key, "Unknown lampId '" + key + "'");
            try {
                expr.parseExpression(String(row.expr || ""));
            } catch (err) {
                issue("error", "lampBindings", key, "Invalid expression: " + err.message);
            }
        });

        safeDoc.computedState.forEach(function each(row) {
            try {
                var ast = expr.parseExpression(String(row.expr || ""));
                var refs = {};
                expr.collectIdentifiers(ast, refs);
                Object.keys(refs).forEach(function eachRef(name) {
                    if (!stateSet[name] && !computedSet[name]) issue("error", "computedState", row.id, "Unknown identifier '" + name + "'");
                });
            } catch (err) {
                issue("error", "computedState", row.id, "Invalid expression: " + err.message);
            }
        });

        safeDoc.actionRules.forEach(function each(rule, i) {
            var id = rule && rule.id ? String(rule.id) : "rule@" + i;
            if (!rule || !rule.trigger) issue("error", "actionRules", id, "Missing trigger");
            else if (!switchSet[rule.trigger]) issue("error", "actionRules", id, "Unknown trigger '" + rule.trigger + "'");
            if (rule && rule.condition) {
                try {
                    var condAst = expr.parseExpression(String(rule.condition));
                    var condRefs = {};
                    expr.collectIdentifiers(condAst, condRefs);
                    Object.keys(condRefs).forEach(function eachRef(name) {
                        if (!stateSet[name] && !computedSet[name]) issue("error", "actionRules", id, "Unknown condition identifier '" + name + "'");
                    });
                } catch (err) {
                    issue("error", "actionRules", id, "Invalid condition: " + err.message);
                }
            }
            (rule && Array.isArray(rule.effects) ? rule.effects : []).forEach(function eachEffect(effect, idx) {
                if (!effect || !effect.type) {
                    issue("error", "actionRules", id, "Effect " + idx + " missing type");
                    return;
                }
                if ((effect.type === "set" || effect.type === "add" || effect.type === "reset") && !stateSet[effect.target]) {
                    issue("error", "actionRules", id, "Unknown effect target '" + effect.target + "'");
                }
                if (effect.type === "setElementProperty" || effect.type === "clearElementProperty") {
                    var target = String(effect.target || "");
                    if (!/^[^.]+\.[^.]+$/.test(target)) {
                        issue("error", "actionRules", id, "Element property target must be elementId.property");
                    }
                }
            });
        });

        safeDoc.resetRules.forEach(function each(rule, i) {
            var id = rule && rule.id ? String(rule.id) : "reset@" + i;
            if (!rule || !rule.trigger) issue("error", "resetRules", id, "Missing trigger");
            else if (!switchSet[rule.trigger]) issue("error", "resetRules", id, "Unknown trigger '" + rule.trigger + "'");
            (rule && Array.isArray(rule.resets) ? rule.resets : []).forEach(function eachTarget(target) {
                if (!stateSet[target]) issue("error", "resetRules", id, "Unknown reset target '" + target + "'");
            });
        });

        var cycles = findComputedCycles(safeDoc.computedState);
        cycles.forEach(function each(cycle) {
            issue("error", "computedState", cycle[0] || "", "Circular computed dependency: " + cycle.join(" -> "));
        });
        return { ok: errors.length === 0, issues: issues, errors: errors };
    }

    function findComputedCycles(computedRows) {
        /* What: Detect cycles in computed-state references.
         * Why: v1 rejects circular computed dependencies.
         */
        var expr = Pin.logicExpressions;
        var graph = {};
        (computedRows || []).forEach(function each(row) {
            var id = row && row.id ? String(row.id) : "";
            if (!id) return;
            graph[id] = [];
            try {
                var ast = expr.parseExpression(String(row.expr || ""));
                var refs = {};
                expr.collectIdentifiers(ast, refs);
                Object.keys(refs).forEach(function eachRef(name) {
                    if (name !== id) graph[id].push(name);
                });
            } catch (err) {}
        });
        var visited = {};
        var inStack = {};
        var path = [];
        var cycles = [];
        function dfs(node) {
            visited[node] = true;
            inStack[node] = true;
            path.push(node);
            (graph[node] || []).forEach(function each(next) {
                if (!graph[next]) return;
                if (!visited[next]) dfs(next);
                else if (inStack[next]) {
                    var idx = path.indexOf(next);
                    if (idx >= 0) cycles.push(path.slice(idx).concat([next]));
                }
            });
            path.pop();
            inStack[node] = false;
        }
        Object.keys(graph).forEach(function each(id) {
            if (!visited[id]) dfs(id);
        });
        return cycles;
    }

    Pin.logicValidate = {
        validateDocument: validateDocument,
        findComputedCycles: findComputedCycles
    };
})(window.Pin);
