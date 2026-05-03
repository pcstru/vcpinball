/*
 * What: TBGameLogic v2 schema helpers and compiler.
 * Why: designers should author pinball logic in feature terms and compile to
 *      the existing low-level runtime rules model consumed by the simulator.
 */
(function initGameLogicV2(Pin) {
    const SWITCH_ELEMENT_TYPES = ["lane", "scoreZone", "spinner", "gate", "valve", "drain", "launcher", "dropTarget", "bumper", "kicker", "trough"];
    const LAMP_ELEMENT_TYPES = ["light", "arrowLight", "boxLight"];

    /*
     * What: Return a JSON-safe clone of authored or compiled logic objects.
     * Why: compiler stages should not share mutable references across outputs.
     */
    function clone(value) {
        return JSON.parse(JSON.stringify(value));
    }

    /*
     * What: Build an empty TBGameLogic v2 source object.
     * Why: editor flows need a deterministic starter shape for new logic files.
     */
    function createEmpty(name) {
        return {
            version: 2,
            name: name || "Game Logic",
            tableRef: "",
            shots: [],
            features: [],
            modes: [],
            awards: [],
            resets: []
        };
    }

    /*
     * What: Normalize a possible game logic payload into v2 collections.
     * Why: import and editor drafts may omit arrays while still being salvageable.
     */
    function normalize(source) {
        const next = clone(source || {});
        if (next.version == null) next.version = 2;
        if (!Array.isArray(next.shots)) next.shots = [];
        if (!Array.isArray(next.features)) next.features = [];
        if (!Array.isArray(next.modes)) next.modes = [];
        if (!Array.isArray(next.awards)) next.awards = [];
        if (!Array.isArray(next.resets)) next.resets = [];
        return next;
    }

    /*
     * What: Create a starter source by scanning switch/lamp elements in a table.
     * Why: designers should begin from named shots, not raw runtime identifiers.
     */
    function scaffoldFromTable(table, name) {
        const source = createEmpty(name || (((table || {}).name || "Table") + " Logic"));
        const elements = ((table || {}).elements) || [];
        elements.forEach(function each(element) {
            if (!element || !element.id) return;
            if (SWITCH_ELEMENT_TYPES.indexOf(element.type) < 0) return;
            const lamp = elements.find(function find(light) {
                if (!light || !light.id) return false;
                if (LAMP_ELEMENT_TYPES.indexOf(light.type) < 0) return false;
                const lampRef = light.lampId || light.id;
                return lampRef === ("lamp_" + element.id) || light.id === ("lamp_" + element.id);
            });
            source.shots.push({
                id: String(element.id),
                name: element.name || element.label || element.id,
                switches: [element.id],
                lamps: lamp ? [lamp.lampId || lamp.id] : [],
                baseScore: typeof element.score === "number" ? element.score : 0
            });
        });
        return source;
    }

    function makeId(prefix) {
        return String(prefix || "id") + "_" + Math.random().toString(36).slice(2, 8);
    }

    function makeIssue(list, severity, message, path) {
        list.push({
            severity: severity || "error",
            message: message || "Unknown issue",
            path: path || ""
        });
    }

    function ensureRulesEngine(table) {
        table.rulesEngine = table.rulesEngine || {};
        table.rulesEngine.switchMap = table.rulesEngine.switchMap || [];
        table.rulesEngine.sequenceRules = table.rulesEngine.sequenceRules || [];
        table.rulesEngine.logicGraphs = table.rulesEngine.logicGraphs || [];
        table.rulesEngine.triggers = table.rulesEngine.triggers || [];
        table.rulesEngine.variables = table.rulesEngine.variables || [];
        return table.rulesEngine;
    }

    function uniqueStrings(values) {
        const out = [];
        (values || []).forEach(function each(value) {
            const normalized = String(value || "").trim();
            if (!normalized) return;
            if (out.indexOf(normalized) >= 0) return;
            out.push(normalized);
        });
        return out;
    }

    function parseCompleteExpr(expr) {
        const text = String(expr || "").trim();
        const match = /^([a-z0-9_:-]+)\.complete$/i.exec(text);
        if (!match) return null;
        return { kind: "complete", id: match[1] };
    }

    /*
     * What: Validate authored TBGameLogic v2 data against table references.
     * Why: compile should fail fast on missing ids rather than emit broken rules.
     */
    function validate(source, table) {
        const issues = [];
        const normalized = normalize(source);
        if (normalized.version !== 2) {
            makeIssue(issues, "error", "TBGameLogic must use version 2.", "version");
        }
        const shotIds = {};
        normalized.shots.forEach(function each(shot, index) {
            const id = String((shot && shot.id) || "").trim();
            if (!id) {
                makeIssue(issues, "error", "Shot is missing id.", "shots[" + index + "]");
                return;
            }
            if (shotIds[id]) makeIssue(issues, "error", "Duplicate shot id '" + id + "'.", "shots[" + index + "].id");
            shotIds[id] = true;
        });
        const logicalIds = {};
        function registerLogical(id, path) {
            const normalizedId = String(id || "").trim();
            if (!normalizedId) return;
            if (logicalIds[normalizedId]) {
                makeIssue(issues, "error", "Duplicate logic id '" + normalizedId + "'.", path);
                return;
            }
            logicalIds[normalizedId] = true;
        }
        normalized.features.forEach(function each(item, index) { registerLogical(item && item.id, "features[" + index + "].id"); });
        normalized.modes.forEach(function each(item, index) { registerLogical(item && item.id, "modes[" + index + "].id"); });
        normalized.awards.forEach(function each(item, index) { registerLogical(item && item.id, "awards[" + index + "].id"); });
        const elements = ((table || {}).elements) || [];
        const elementIds = {};
        const lampIds = {};
        elements.forEach(function each(element) {
            if (!element || !element.id) return;
            elementIds[element.id] = true;
            if (LAMP_ELEMENT_TYPES.indexOf(element.type) >= 0) lampIds[element.lampId || element.id] = true;
        });
        normalized.shots.forEach(function each(shot, index) {
            uniqueStrings(shot && shot.switches).forEach(function eachSwitch(switchId) {
                if (!elementIds[switchId]) {
                    makeIssue(issues, "error", "Shot '" + (shot.id || "") + "' switch '" + switchId + "' does not exist on table.", "shots[" + index + "].switches");
                }
            });
            uniqueStrings(shot && shot.lamps).forEach(function eachLamp(lampId) {
                if (!lampIds[lampId]) {
                    makeIssue(issues, "warning", "Shot '" + (shot.id || "") + "' lamp '" + lampId + "' not found as light element.", "shots[" + index + "].lamps");
                }
            });
        });
        normalized.features.forEach(function each(feature, index) {
            uniqueStrings(feature && feature.shots).forEach(function eachShot(shotId) {
                if (!shotIds[shotId]) makeIssue(issues, "error", "Feature '" + (feature.id || "") + "' references unknown shot '" + shotId + "'.", "features[" + index + "].shots");
            });
        });
        normalized.modes.forEach(function each(mode, index) {
            const parsed = parseCompleteExpr(mode && mode.startsWhen);
            if (mode && mode.startsWhen && !parsed) {
                makeIssue(issues, "error", "Mode '" + (mode.id || "") + "' startsWhen must be '<id>.complete'.", "modes[" + index + "].startsWhen");
            }
            (mode && mode.effects || []).forEach(function eachEffect(effect, effectIndex) {
                if (!effect || !effect.type) {
                    makeIssue(issues, "error", "Mode '" + (mode.id || "") + "' has effect missing type.", "modes[" + index + "].effects[" + effectIndex + "]");
                    return;
                }
                if (effect.type === "scoreMultiplier" && !shotIds[String(effect.shot || "")]) {
                    makeIssue(issues, "error", "Mode '" + (mode.id || "") + "' scoreMultiplier references unknown shot '" + (effect.shot || "") + "'.", "modes[" + index + "].effects[" + effectIndex + "].shot");
                }
                if ((effect.type === "flashLamp" || effect.type === "lampOn") && !lampIds[String(effect.lamp || "")]) {
                    makeIssue(issues, "warning", "Mode '" + (mode.id || "") + "' effect lamp '" + (effect.lamp || "") + "' not found.", "modes[" + index + "].effects[" + effectIndex + "].lamp");
                }
            });
        });
        normalized.awards.forEach(function each(award, index) {
            const parsed = parseCompleteExpr(award && award.litWhen);
            if (award && award.litWhen && !parsed) {
                makeIssue(issues, "error", "Award '" + (award.id || "") + "' litWhen must be '<id>.complete'.", "awards[" + index + "].litWhen");
            }
            const collectShot = String((award && award.collectShot) || "");
            if (collectShot && !shotIds[collectShot]) {
                makeIssue(issues, "error", "Award '" + (award.id || "") + "' collectShot '" + collectShot + "' is not a known shot.", "awards[" + index + "].collectShot");
            }
        });
        return issues;
    }

    function ensureVariable(rules, id, defaultValue) {
        const existing = (rules.variables || []).find(function find(item) {
            return item && item.id === id;
        });
        if (existing) return existing.id;
        rules.variables.push({
            id: id,
            name: id,
            properties: { value: defaultValue }
        });
        return id;
    }

    function addRule(rules, rule) {
        rules.sequenceRules.push(rule);
    }

    function makeRule(id, name) {
        return {
            id: id || makeId("rule"),
            name: name || "Rule",
            type: "sequence",
            enabled: true,
            ordered: true,
            steps: [],
            targetSwitchId: "",
            stepLampIds: [],
            targetLampId: "",
            windowSeconds: 8,
            awardPoints: 0,
            awardEvent: "ruleAwarded",
            conditions: [],
            actions: [],
            resetOnDrain: true,
            resetOnComplete: true,
            resetOnWrongOrder: false
        };
    }

    function appendOnCompleteActions(rule, onComplete) {
        if (!onComplete || typeof onComplete !== "object") return;
        uniqueStrings(onComplete.light).forEach(function each(lampId) {
            rule.actions.push({ actionType: "setLamp", lampId: lampId, value: true });
        });
        uniqueStrings(onComplete.enable).forEach(function each(variableId) {
            rule.actions.push({ actionType: "setVariableProperty", variableId: variableId, property: "value", value: true });
        });
        if (typeof onComplete.award === "number") {
            rule.awardPoints = onComplete.award;
        }
    }

    /*
     * What: Compile TBGameLogic v2 source into runtime rulesEngine fields.
     * Why: runtime remains low-level while designers edit higher-level features.
     */
    function compile(source, table) {
        const normalized = normalize(source);
        const tableOut = clone(table || {});
        const rules = ensureRulesEngine(tableOut);
        const issues = validate(normalized, tableOut);
        if (issues.some(function has(issue) { return issue.severity === "error"; })) {
            return { ok: false, issues: issues, table: tableOut };
        }
        rules.sequenceRules = [];
        rules.logicGraphs = [];
        rules.triggers = [];
        rules.variables = [];

        const shotById = {};
        normalized.shots.forEach(function each(shot) {
            if (!shot || !shot.id) return;
            shotById[shot.id] = clone(shot);
        });
        const completionVarById = {};

        // Compile direct shot lamp behavior so simple shot->lamp authoring works
        // even before higher-level features are defined.
        normalized.shots.forEach(function eachShotRule(shot) {
            if (!shot || !shot.id) return;
            const switches = uniqueStrings(shot.switches);
            const lamps = uniqueStrings(shot.lamps);
            if (!switches.length || !lamps.length) return;
            const shotRule = makeRule("gl_shot_" + shot.id, "Shot " + (shot.name || shot.id));
            shotRule.steps = [switches[0]];
            shotRule.resetOnDrain = true;
            shotRule.resetOnComplete = false;
            shotRule.resetOnWrongOrder = false;
            lamps.forEach(function eachLamp(lampId) {
                shotRule.actions.push({ actionType: "setLamp", lampId: lampId, value: true });
            });
            addRule(rules, shotRule);
        });

        normalized.features.forEach(function each(feature) {
            if (!feature || !feature.id) return;
            const featureType = String(feature.type || "").toLowerCase();
            if (featureType !== "set" && featureType !== "sequence" && featureType !== "set_completion") return;
            const rule = makeRule("gl_feature_" + feature.id, feature.name || feature.id);
            const shotIds = uniqueStrings(feature.shots);
            shotIds.forEach(function eachShot(shotId) {
                const shot = shotById[shotId];
                if (!shot) return;
                const switches = uniqueStrings(shot.switches);
                if (switches[0]) rule.steps.push(switches[0]);
                const lamps = uniqueStrings(shot.lamps);
                if (lamps[0]) rule.stepLampIds.push(lamps[0]);
            });
            rule.ordered = feature.ordered !== false ? true : false;
            const resetPolicy = String(feature.reset || "");
            if (resetPolicy === "on_ball_drain") {
                rule.resetOnDrain = true;
                rule.resetOnComplete = false;
            }
            const completionVar = "gl_complete_" + feature.id;
            completionVarById[feature.id] = completionVar;
            ensureVariable(rules, completionVar, false);
            rule.actions.push({
                actionType: "setVariableProperty",
                variableId: completionVar,
                property: "value",
                value: true
            });
            appendOnCompleteActions(rule, feature.onComplete || null);
            addRule(rules, rule);
        });

        const tickSwitchId = "tick.gamelogic";
        const timerResolution = 0.25;
        if (normalized.modes.length) {
            rules.triggers.push({
                id: "timer_gamelogic_tick",
                type: "interval",
                everySeconds: timerResolution,
                switchId: tickSwitchId,
                enabled: true
            });
        }

        normalized.modes.forEach(function each(mode) {
            if (!mode || !mode.id) return;
            const parsedStart = parseCompleteExpr(mode.startsWhen);
            const startVar = parsedStart ? completionVarById[parsedStart.id] : "";
            if (!startVar) return;
            const activeVar = "gl_mode_" + mode.id + "_active";
            const timeVar = "gl_mode_" + mode.id + "_remaining";
            ensureVariable(rules, activeVar, false);
            ensureVariable(rules, timeVar, 0);

            const startRule = makeRule("gl_mode_start_" + mode.id, (mode.name || mode.id) + " Start");
            startRule.steps = [tickSwitchId];
            startRule.conditions = [
                { source: "variable", variableId: startVar, property: "value", operator: "truthy" },
                { source: "variable", variableId: activeVar, property: "value", operator: "falsy" }
            ];
            startRule.actions.push({ actionType: "setVariableProperty", variableId: activeVar, property: "value", value: true });
            startRule.actions.push({ actionType: "setVariableProperty", variableId: timeVar, property: "value", value: Math.max(0, Number(mode.durationSeconds) || 0) });

            const endActions = [];
            (mode.effects || []).forEach(function eachEffect(effect) {
                if (!effect || !effect.type) return;
                if (effect.type === "scoreMultiplier") {
                    const shot = shotById[String(effect.shot || "")];
                    const multiplier = Number(effect.multiplier) || 1;
                    (shot && uniqueStrings(shot.switches) || []).forEach(function eachSwitch(switchId) {
                        const baseScore = typeof shot.baseScore === "number" ? shot.baseScore : 0;
                        startRule.actions.push({ actionType: "setElementScore", targetId: switchId, value: Math.round(baseScore * multiplier) });
                        endActions.push({ actionType: "resetElementScore", targetId: switchId });
                    });
                    return;
                }
                if (effect.type === "flashLamp" || effect.type === "lampOn") {
                    if (!effect.lamp) return;
                    startRule.actions.push({ actionType: "setLamp", lampId: effect.lamp, value: true });
                    endActions.push({ actionType: "clearLamp", lampId: effect.lamp });
                }
            });
            addRule(rules, startRule);

            if (Math.max(0, Number(mode.durationSeconds) || 0) > 0) {
                const tickRule = makeRule("gl_mode_tick_" + mode.id, (mode.name || mode.id) + " Tick");
                tickRule.steps = [tickSwitchId];
                tickRule.conditions = [
                    { source: "variable", variableId: activeVar, property: "value", operator: "truthy" }
                ];
                tickRule.actions.push({ actionType: "addVariableProperty", variableId: timeVar, property: "value", value: -timerResolution });
                addRule(rules, tickRule);

                const endRule = makeRule("gl_mode_end_" + mode.id, (mode.name || mode.id) + " End");
                endRule.steps = [tickSwitchId];
                endRule.conditions = [
                    { source: "variable", variableId: activeVar, property: "value", operator: "truthy" },
                    { source: "variable", variableId: timeVar, property: "value", operator: "lte", value: 0 }
                ];
                endRule.actions.push({ actionType: "setVariableProperty", variableId: activeVar, property: "value", value: false });
                endRule.actions.push({ actionType: "setVariableProperty", variableId: timeVar, property: "value", value: 0 });
                endActions.forEach(function eachAction(action) { endRule.actions.push(action); });
                addRule(rules, endRule);
            }
        });

        normalized.awards.forEach(function each(award) {
            if (!award || !award.id || !award.collectShot) return;
            const shot = shotById[award.collectShot];
            if (!shot) return;
            const parsedLit = parseCompleteExpr(award.litWhen);
            const litVar = parsedLit ? completionVarById[parsedLit.id] : "";
            const rule = makeRule("gl_award_" + award.id, award.name || award.id);
            rule.steps = uniqueStrings(shot.switches).slice(0, 1);
            if (litVar) {
                rule.conditions.push({ source: "variable", variableId: litVar, property: "value", operator: "truthy" });
            }
            rule.awardPoints = Number(award.award) || 0;
            uniqueStrings(award.onCollect).forEach(function eachCollect(actionText) {
                const lightMatch = /^light:(.+)$/i.exec(actionText);
                if (lightMatch) {
                    rule.actions.push({ actionType: "setLamp", lampId: String(lightMatch[1]).trim(), value: true });
                }
            });
            addRule(rules, rule);
        });

        const allResets = normalized.resets.reduce(function reduce(out, reset) {
            if (!reset || typeof reset !== "object") return out;
            if (Array.isArray(reset.onDrain)) out.onDrain = out.onDrain.concat(reset.onDrain);
            if (Array.isArray(reset.onCollect)) out.onCollect = out.onCollect.concat(reset.onCollect);
            return out;
        }, { onDrain: [], onCollect: [] });
        if (allResets.onDrain.length) {
            const drainElement = ((tableOut.elements || []).find(function find(element) { return element && element.type === "drain" && element.id; }) ||
                (tableOut.elements || []).find(function find(element) { return element && element.type === "trough" && element.id; }) ||
                null);
            if (drainElement) {
                const resetRule = makeRule("gl_reset_drain", "Drain Reset");
                resetRule.steps = [drainElement.id];
                uniqueStrings(allResets.onDrain).forEach(function eachReset(id) {
                    const completionVar = completionVarById[id];
                    if (completionVar) {
                        resetRule.actions.push({ actionType: "setVariableProperty", variableId: completionVar, property: "value", value: false });
                    }
                    resetRule.actions.push({ actionType: "setVariableProperty", variableId: "gl_mode_" + id + "_active", property: "value", value: false });
                    resetRule.actions.push({ actionType: "setVariableProperty", variableId: "gl_mode_" + id + "_remaining", property: "value", value: 0 });
                });
                addRule(rules, resetRule);
            }
        }

        if (Pin.ruleGraph && Pin.ruleGraph.syncGraphsFromSequenceRules) {
            rules.logicGraphs = Pin.ruleGraph.syncGraphsFromSequenceRules(tableOut);
        }

        return { ok: true, issues: issues, table: tableOut };
    }

    Pin.gameLogicV2 = {
        createEmpty: createEmpty,
        normalize: normalize,
        scaffoldFromTable: scaffoldFromTable,
        validate: validate,
        compile: compile
    };
})(window.Pin);
