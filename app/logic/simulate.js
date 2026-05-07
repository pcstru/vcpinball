/* What: Logic simulation runtime for manual switch firing.
 * Why: #logic needs pure logic stepping without playfield physics.
 */
(function initLogicSim(Pin) {
    var TIMER_SWITCHES = {
        timer_100ms: 0.1,
        timer_1s: 1
    };

    function createRuntime(doc) {
        /* What: Build an executable runtime state from logic doc.
         * Why: Simulation must operate over mutable state snapshots.
         */
        var safeDoc = Pin.logicTypes.normalizeLogicDocument(doc);
        var runtime = {
            doc: safeDoc,
            values: {},
            computed: {},
            lamps: {},
            elementProperties: {},
            score: 0,
            log: [],
            timerAccum: {}
        };
        safeDoc.stateTable.forEach(function each(row) {
            runtime.values[row.id] = coerceInitial(row.type, row.initial);
        });
        refreshDerived(runtime);
        return runtime;
    }

    function coerceInitial(type, value) {
        if (type === "bool") return !!value;
        if (type === "int") return Number.isFinite(Number(value)) ? Math.trunc(Number(value)) : 0;
        return value;
    }

    function makeEnv(runtime) {
        var env = {};
        Object.keys(runtime.values).forEach(function each(k) { env[k] = runtime.values[k]; });
        Object.keys(runtime.computed).forEach(function each(k) { env[k] = runtime.computed[k]; });
        return env;
    }

    function refreshDerived(runtime) {
        /* What: Recompute all computed values and lamp states.
         * Why: Action effects can change downstream derived state.
         */
        var expr = Pin.logicExpressions;
        var env = makeEnv(runtime);
        runtime.doc.computedState.forEach(function each(row) {
            try {
                runtime.computed[row.id] = !!expr.evaluate(row.expr || "false", env);
            } catch (err) {
                runtime.computed[row.id] = false;
            }
            env[row.id] = runtime.computed[row.id];
        });
        env = makeEnv(runtime);
        runtime.doc.lampBindings.forEach(function each(row) {
            try {
                runtime.lamps[row.lampId] = !!expr.evaluate(row.expr || "false", env);
            } catch (err) {
                runtime.lamps[row.lampId] = false;
            }
        });
    }

    function applyEffect(runtime, effect, changes) {
        var target = effect && effect.target ? String(effect.target) : "";
        if (effect.type === "set") {
            var prev = runtime.values[target];
            runtime.values[target] = effect.value;
            changes.push(target + ": " + String(prev) + " -> " + String(runtime.values[target]));
        } else if (effect.type === "add") {
            var before = Number(runtime.values[target] || 0);
            var delta = Number(effect.value || 0);
            runtime.values[target] = before + delta;
            changes.push(target + ": " + String(before) + " -> " + String(runtime.values[target]));
        } else if (effect.type === "score") {
            var points = Number(effect.value || 0);
            runtime.score += points;
            changes.push("Score +" + points);
        } else if (effect.type === "reset") {
            runtime.values[target] = 0;
            changes.push(target + ": reset");
        } else if (effect.type === "setElementProperty") {
            var parts = target.split(".");
            var elementId = parts[0] || "";
            var property = parts[1] || "";
            if (!elementId || !property) return;
            runtime.elementProperties[elementId] = runtime.elementProperties[elementId] || {};
            runtime.elementProperties[elementId][property] = effect.value;
            changes.push(elementId + "." + property + " -> " + String(effect.value));
        } else if (effect.type === "clearElementProperty") {
            var clearParts = target.split(".");
            var clearElementId = clearParts[0] || "";
            var clearProperty = clearParts[1] || "";
            if (!clearElementId || !clearProperty) return;
            if (runtime.elementProperties[clearElementId]) {
                delete runtime.elementProperties[clearElementId][clearProperty];
                if (!Object.keys(runtime.elementProperties[clearElementId]).length) {
                    delete runtime.elementProperties[clearElementId];
                }
            }
            changes.push(clearElementId + "." + clearProperty + " cleared");
        }
    }

    function fireSwitch(runtime, switchId) {
        /* What: Execute a switch tick over action and reset rules.
         * Why: This models gameplay logic transitions for designer testing.
         */
        var doc = runtime.doc;
        var expr = Pin.logicExpressions;
        var line = [];
        line.push("Switch Fired: " + switchId);
        var env = makeEnv(runtime);
        doc.actionRules.forEach(function each(rule) {
            if (!rule || rule.enabled === false || rule.trigger !== switchId) return;
            var matched = true;
            if (rule.condition && String(rule.condition).trim()) {
                try {
                    matched = !!expr.evaluate(rule.condition, env);
                } catch (err) {
                    matched = false;
                }
            }
            if (!matched) return;
            line.push("Rule " + rule.id + " matched");
            var changes = [];
            (Array.isArray(rule.effects) ? rule.effects : []).forEach(function eachEffect(effect) {
                applyEffect(runtime, effect || {}, changes);
            });
            changes.forEach(function eachChange(changeLine) { line.push(changeLine); });
            refreshDerived(runtime);
            env = makeEnv(runtime);
        });
        doc.resetRules.forEach(function each(rule) {
            if (!rule || rule.trigger !== switchId) return;
            line.push("Reset " + rule.id + " matched");
            (Array.isArray(rule.resets) ? rule.resets : []).forEach(function eachReset(id) {
                var def = doc.stateTable.find(function find(s) { return s.id === id; });
                var prev = runtime.values[id];
                runtime.values[id] = def ? coerceInitial(def.type, def.initial) : 0;
                line.push(id + ": " + String(prev) + " -> " + String(runtime.values[id]));
            });
            refreshDerived(runtime);
            env = makeEnv(runtime);
        });
        var beforeLamp = {};
        Object.keys(runtime.lamps).forEach(function each(key) { beforeLamp[key] = runtime.lamps[key]; });
        refreshDerived(runtime);
        Object.keys(runtime.lamps).forEach(function eachLamp(id) {
            if (beforeLamp[id] !== runtime.lamps[id]) line.push(id + ": " + (beforeLamp[id] ? "on" : "off") + " -> " + (runtime.lamps[id] ? "on" : "off"));
        });
        runtime.log.unshift(line.join("\n"));
        if (runtime.log.length > 120) runtime.log.length = 120;
        return line;
    }

    function advanceTime(runtime, dt) {
        /* What: Fire virtual timer switches based on elapsed simulation time.
         * Why: Timed logic (timeouts/flashing) needs cadence-driven triggers in play and simulator.
         */
        var elapsed = Number(dt || 0);
        if (!runtime || !runtime.doc || !Number.isFinite(elapsed) || elapsed <= 0) return [];
        var fired = [];
        (runtime.doc.switchRegistry || []).forEach(function each(row) {
            if (!row || row.kind !== "timer" || !row.id) return;
            var interval = Number(row.intervalMs || 0) / 1000;
            if (!Number.isFinite(interval) || interval <= 0) interval = TIMER_SWITCHES[row.id] || 0;
            if (!interval) return;
            var key = String(row.id);
            var acc = Number(runtime.timerAccum[key] || 0) + elapsed;
            while (acc + 1e-9 >= interval) {
                fireSwitch(runtime, key);
                fired.push(key);
                acc -= interval;
            }
            runtime.timerAccum[key] = Math.max(0, acc);
        });
        return fired;
    }

    Pin.logicSim = {
        createRuntime: createRuntime,
        fireSwitch: fireSwitch,
        refreshDerived: refreshDerived,
        advanceTime: advanceTime
    };
})(window.Pin);
