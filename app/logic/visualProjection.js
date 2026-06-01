/* What: Build a visual projection model over the existing logic document schema.
 * Why: Designers need grouped, readable logic flows without introducing a new runtime language.
 */
(function initLogicVisualProjection(Pin) {
    function clone(value) {
        return Pin.logicTypes && Pin.logicTypes.clone ? Pin.logicTypes.clone(value) : JSON.parse(JSON.stringify(value));
    }

    function safeList(value) {
        return Array.isArray(value) ? value : [];
    }

    function buildVisualModel(table, doc, assets) {
        /* What: Build nodes/edges/groups from table + logic document.
         * Why: The visual builder is a projection; persisted JSON remains canonical.
         */
        var safeDoc = Pin.logicTypes.normalizeLogicDocument(doc || null);
        var nodes = [];
        var edges = [];
        var groups = [];
        var nodeById = {};
        var edgeCount = 0;

        function nodeId(kind, id) {
            return String(kind) + ":" + String(id || "");
        }
        function addNode(kind, sourceId, label, data, sourcePath) {
            var id = nodeId(kind, sourceId);
            if (nodeById[id]) return nodeById[id];
            var row = {
                id: id,
                kind: kind,
                label: label || String(sourceId || kind),
                sourceId: sourceId || "",
                sourcePath: sourcePath || "",
                data: clone(data || {})
            };
            nodes.push(row);
            nodeById[id] = row;
            return row;
        }
        function addEdge(from, to, kind, label) {
            var row = { id: "edge_" + (++edgeCount), from: from, to: to, kind: kind || "synthetic", label: label || "" };
            edges.push(row);
            return row.id;
        }

        safeList(safeDoc.switchRegistry).forEach(function each(sw, index) {
            addNode("switch", sw && sw.id, (sw && (sw.name || sw.id)) || "Switch", sw, "logicDocument.switchRegistry[" + index + "]");
        });
        safeList(safeDoc.stateTable).forEach(function each(st, index) {
            addNode("state", st && st.id, (st && (st.name || st.id)) || "State", st, "logicDocument.stateTable[" + index + "]");
        });
        safeList(safeDoc.computedState).forEach(function each(st, index) {
            addNode("computedState", st && st.id, (st && (st.name || st.id)) || "Computed", st, "logicDocument.computedState[" + index + "]");
        });
        safeList(safeDoc.actionRules).forEach(function each(rule, index) {
            var ruleNode = addNode("rule", rule && rule.id, (rule && (rule.name || rule.id)) || "Rule", rule, "logicDocument.actionRules[" + index + "]");
            var swNode = nodeById[nodeId("switch", rule && rule.trigger)];
            if (swNode) addEdge(swNode.id, ruleNode.id, "trigger", "when");
        });
        safeList(safeDoc.lampBindings).forEach(function each(binding, index) {
            addNode("lamp", binding && binding.lampId, (binding && binding.lampId) || "Lamp", binding, "logicDocument.lampBindings[" + index + "]");
        });
        safeList(table && table.features).forEach(function each(feature, index) {
            addNode("feature", feature && feature.id, (feature && (feature.name || feature.id)) || "Feature", feature, "features[" + index + "]");
        });

        groups = groups
            .concat(detectCompletionGroups(safeDoc))
            .concat(detectClaimGroups(safeDoc))
            .concat(detectDrainBehaviour(safeDoc))
            .concat(detectMultiplierLadders(safeDoc));

        if (!groups.length) {
            groups.push({
                id: "group_generic_rules",
                label: "Generic Rules",
                kind: "generic",
                ruleIds: safeList(safeDoc.actionRules).map(function map(rule) { return rule && rule.id; }).filter(Boolean)
            });
        }

        safeList(table && table.features).forEach(function each(feature) {
            groups.push({
                id: "feature_" + String(feature && feature.id || ""),
                label: (feature && (feature.name || feature.id)) || "Feature",
                kind: "feature",
                sourceFeatureId: feature && feature.id || "",
                members: {
                    objects: safeList(feature && feature.objects),
                    states: safeList(feature && feature.states),
                    rules: safeList(feature && feature.rules),
                    lamps: safeList(feature && feature.lamps)
                }
            });
        });

        return {
            nodes: nodes,
            edges: edges,
            groups: groups,
            featureList: safeList(table && table.features),
            doc: safeDoc,
            assets: assets || { switchCandidates: [], lampCandidates: [] }
        };
    }

    function parseIdentifiers(expr) {
        var out = [];
        String(expr || "").replace(/[A-Za-z_][A-Za-z0-9_]*/g, function each(token) {
            out.push(token);
            return token;
        });
        return out;
    }

    function detectCompletionGroups(doc) {
        var out = [];
        safeList(doc && doc.computedState).forEach(function each(row) {
            var expr = String(row && row.expr || "");
            if (!expr || expr.indexOf("&&") < 0) return;
            var parts = expr.split("&&").map(function map(s) { return String(s || "").trim(); }).filter(Boolean);
            if (parts.length < 2) return;
            var feederRules = safeList(doc.actionRules).filter(function filter(rule) {
                var effects = safeList(rule && rule.effects);
                return effects.some(function some(effect) {
                    return effect && effect.type === "set" && effect.value === true && parts.indexOf(String(effect.target || "")) >= 0;
                });
            }).map(function map(rule) { return rule.id; });
            if (!feederRules.length) return;
            var completionRules = safeList(doc.actionRules).filter(function filter(rule) {
                return String(rule && rule.condition || "").indexOf(String(row.id || "")) >= 0;
            }).map(function map(rule) { return rule.id; });
            out.push({
                id: "completion_" + String(row && row.id || out.length),
                label: (row && (row.name || row.id)) || "Completion Group",
                kind: "completionGroup",
                computedStateId: row && row.id || "",
                stateIds: parts,
                feederRuleIds: feederRules,
                completionRuleIds: completionRules
            });
        });
        return out;
    }

    function detectClaimGroups(doc) {
        var out = [];
        safeList(doc && doc.actionRules).forEach(function each(rule) {
            var trigger = String(rule && rule.trigger || "").toLowerCase();
            var name = String(rule && (rule.name || rule.id) || "").toLowerCase();
            var condition = String(rule && rule.condition || "").toLowerCase();
            var effects = safeList(rule && rule.effects);
            var claimLike = /(trough|scoop|kicker|collect|claim|bonus)/.test(trigger) || /(collect|claim|bonus)/.test(name);
            if (!claimLike) return;
            var readyLike = /(ready|armed|claim|bonus)/.test(condition);
            var resetLike = effects.some(function some(effect) {
                var type = String(effect && effect.type || "");
                var target = String(effect && effect.target || "").toLowerCase();
                return type === "reset" || /(ready|active|armed|claim|bonus)/.test(target);
            });
            if (!readyLike && !resetLike) return;
            out.push({
                id: "claim_" + String(rule && rule.id || out.length),
                label: (rule && (rule.name || rule.id)) || "Claim Bonus",
                kind: "claimGroup",
                ruleId: rule && rule.id || "",
                trigger: rule && rule.trigger || "",
                condition: rule && rule.condition || ""
            });
        });
        return out;
    }

    function detectDrainBehaviour(doc) {
        var drainSwitchIds = safeList(doc && doc.switchRegistry).filter(function filter(sw) {
            var id = String(sw && sw.id || "").toLowerCase();
            var name = String(sw && sw.name || "").toLowerCase();
            var src = String(sw && sw.sourceElementId || "").toLowerCase();
            return /(drain)/.test(id) || /(drain)/.test(name) || /(drain)/.test(src);
        }).map(function map(sw) { return sw.id; });
        if (!drainSwitchIds.length) return [];
        var rules = safeList(doc && doc.actionRules).filter(function filter(rule) {
            return drainSwitchIds.indexOf(rule && rule.trigger) >= 0;
        }).map(function map(rule) { return rule.id; });
        return [{
            id: "drain_behaviour",
            label: "Drain Behaviour",
            kind: "drainBehaviour",
            drainSwitchIds: drainSwitchIds,
            resetRuleIds: rules,
            readonlyEngineFlow: true
        }];
    }

    function detectMultiplierLadders(doc) {
        var transitions = [];
        safeList(doc && doc.actionRules).forEach(function each(rule) {
            var condition = String(rule && rule.condition || "");
            var match = condition.match(/score_multiplier\s*==\s*(-?\d+)/);
            if (!match) return;
            var from = Number(match[1]);
            var effect = safeList(rule.effects).find(function find(e) {
                return e && e.type === "set" && String(e.target || "") === "score_multiplier";
            });
            if (!effect || !Number.isFinite(Number(effect.value))) return;
            transitions.push({ ruleId: rule.id, from: from, to: Number(effect.value) });
        });
        if (!transitions.length) return [];
        transitions.sort(function sort(a, b) { return a.from - b.from; });
        return [{
            id: "ladder_score_multiplier",
            label: "Score Multiplier Ladder",
            kind: "multiplierLadder",
            stateId: "score_multiplier",
            transitions: transitions
        }];
    }

    function validateVisualModel(table, doc, assets) {
        var core = Pin.logicValidate.validateDocument(doc, assets || { switchCandidates: [], lampCandidates: [] });
        var warnings = [];
        safeList(doc && doc.actionRules).forEach(function each(rule) {
            safeList(rule && rule.effects).forEach(function eachEffect(effect, idx) {
                var type = String(effect && effect.type || "");
                if (!type) return;
                if (type === "set" || type === "add" || type === "score" || type === "reset" || type === "setElementProperty" || type === "clearElementProperty") return;
                warnings.push({
                    severity: "warn",
                    section: "actionRules",
                    id: rule && rule.id || "",
                    message: "Unknown effect type preserved as raw JSON: " + type + " (effect " + idx + ")"
                });
            });
        });
        safeList(table && table.features).forEach(function each(feature) {
            var id = feature && feature.id || "";
            ["objects", "states", "rules", "lamps"].forEach(function eachList(key) {
                if (!Array.isArray(feature && feature[key])) return;
                feature[key].forEach(function eachRef(ref) {
                    if (typeof ref !== "string" || !ref) {
                        warnings.push({ severity: "warn", section: "features", id: id, message: "Invalid feature " + key + " reference value." });
                    }
                });
            });
        });
        return {
            ok: core.ok,
            issues: core.issues.concat(warnings),
            errors: core.errors
        };
    }

    Pin.logicVisualProjection = {
        buildVisualModel: buildVisualModel,
        detectCompletionGroups: detectCompletionGroups,
        detectClaimGroups: detectClaimGroups,
        detectDrainBehaviour: detectDrainBehaviour,
        detectMultiplierLadders: detectMultiplierLadders,
        validateVisualModel: validateVisualModel,
        parseIdentifiers: parseIdentifiers
    };
})(window.Pin);
