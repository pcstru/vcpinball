(function initEvents(Pin) {
    function now() {
        if (typeof performance !== "undefined" && performance.now) return performance.now();
        return Date.now();
    }

    function emit(world, event) {
        if (!world || !event) return;
        world.events = world.events || [];
        world.events.push(Object.assign({
            time: now(),
            tick: world.physicsTick || 0
        }, event));
    }

    function processRules(world, dt) {
        if (!world || !world.events) return [];
        world.ruleState = world.ruleState || {};

        function syncRuleElementProperties(runtime) {
            var source = runtime && runtime.elementProperties ? runtime.elementProperties : {};
            var out = {};
            Object.keys(source).forEach(function eachElement(id) {
                if (!source[id] || typeof source[id] !== "object") return;
                out[id] = {};
                Object.keys(source[id]).forEach(function eachProp(key) {
                    out[id][key] = source[id][key];
                });
            });
            world.ruleState.elementProperties = out;
        }

        function ensureLogicRuntime() {
            if (world.logicRuntime || !Pin.logicCompile || !Pin.logicSim) return;
            const doc = Pin.logicCompile.extractFromTable(world.table || {});
            world.logicRuntime = Pin.logicSim.createRuntime(doc);
            syncLogicLamps(world.logicRuntime);
            syncRuleElementProperties(world.logicRuntime);
        }

        function resolveLogicTriggersFromSource(sourceId) {
            const raw = String(sourceId || "");
            if (!raw) return [];
            const logicSwitches = world && world.logicRuntime && world.logicRuntime.doc && Array.isArray(world.logicRuntime.doc.switchRegistry)
                ? world.logicRuntime.doc.switchRegistry
                : [];
            if (!world._logicTriggerMap || world._logicTriggerMapSource !== logicSwitches) {
                /*
                 * What: Index physical and logical switch ids for this runtime.
                 * Why: switch events happen in the physics loop, so dispatch should
                 * not rescan the whole registry for every rollover or target hit.
                 */
                const map = {};
                logicSwitches.forEach(function each(row) {
                    if (!row) return;
                    const logicalId = row.id != null ? String(row.id) : "";
                    const physicalId = row.sourceElementId != null ? String(row.sourceElementId) : "";
                    if (!logicalId) return;
                    [logicalId, physicalId].forEach(function add(key) {
                        if (!key) return;
                        if (!map[key]) map[key] = [];
                        if (map[key].indexOf(logicalId) < 0) map[key].push(logicalId);
                    });
                });
                world._logicTriggerMap = map;
                world._logicTriggerMapSource = logicSwitches;
            }
            const out = world._logicTriggerMap[raw];
            if (out && out.length) return out;
            return [raw];
        }

        function logicElementPropertiesSignature(runtime) {
            const source = runtime && runtime.elementProperties ? runtime.elementProperties : {};
            const parts = [];
            Object.keys(source).sort().forEach(function eachElement(id) {
                if (!source[id] || typeof source[id] !== "object") return;
                Object.keys(source[id]).sort().forEach(function eachProp(key) {
                    parts.push(id + "." + key + "=" + String(source[id][key]));
                });
            });
            return parts.join("|");
        }

        function syncRuleElementPropertiesIfChanged(runtime) {
            /*
             * What: Copy element-property outputs only when the logic runtime changed.
             * Why: lights and element draw code need a plain ruleState snapshot, but
             * unchanged switch hits should not allocate a fresh nested object tree.
             */
            const signature = logicElementPropertiesSignature(runtime);
            if (world._logicElementPropertiesSignature === signature) return;
            world._logicElementPropertiesSignature = signature;
            syncRuleElementProperties(runtime);
        }

        function syncLogicLamps(runtime) {
            const map = runtime && runtime.lamps ? runtime.lamps : {};
            const next = {};
            Object.keys(map).forEach(function each(id) {
                next[id] = { on: !!map[id], intensity: map[id] ? 1 : 0 };
            });
            world.lampState = next;
        }

        function hasTimerSwitches(runtime) {
            /* What: Cache whether this logic document has cadence-driven switches.
             * Why: Most playfield rules are event-driven and should not copy lamp
             * and element-property maps on every physics tick.
             */
            if (!runtime || !runtime.doc) return false;
            if (runtime._hasTimerSwitches != null) return runtime._hasTimerSwitches;
            runtime._hasTimerSwitches = (runtime.doc.switchRegistry || []).some(function some(row) {
                return row && row.kind === "timer" && row.id;
            });
            return runtime._hasTimerSwitches;
        }

        if (Pin.logicSim) {
            ensureLogicRuntime();
            if (world.logicRuntime && typeof Pin.logicSim.advanceTime === "function" && hasTimerSwitches(world.logicRuntime)) {
                const firedTimers = Pin.logicSim.advanceTime(world.logicRuntime, dt);
                if (firedTimers && firedTimers.length) {
                    syncLogicLamps(world.logicRuntime);
                    syncRuleElementPropertiesIfChanged(world.logicRuntime);
                }
            }
        }
        const processed = [];
        while (world.events.length) {
            const events = world.events.splice(0, world.events.length);
            processed.push.apply(processed, events);
            events.forEach(function apply(event) {
                if (event.type === "score") {
                    const points = Number(event.points) || 0;
                    world.score = (world.score || 0) + points;
                    event.scoreDelta = points;
                }
                if (event.type === "switchClosed" && Pin.logicSim) {
                    const worldScoreBefore = Number(world.score || 0);
                    ensureLogicRuntime();
                    if (!world.logicRuntime) return;
                    const previous = Number(world.logicRuntime.score || 0);
                    const triggerIds = resolveLogicTriggersFromSource(event.sourceId || "");
                    triggerIds.forEach(function eachTriggerId(triggerId) {
                        Pin.logicSim.fireSwitch(world.logicRuntime, triggerId);
                    });
                    const after = Number(world.logicRuntime.score || 0);
                    const delta = after - previous;
                    if (delta) world.score = (world.score || 0) + delta;
                    event.scoreDelta = Number(world.score || 0) - worldScoreBefore;
                    syncLogicLamps(world.logicRuntime);
                    syncRuleElementPropertiesIfChanged(world.logicRuntime);
                }
            });
        }
        return processed;
    }

    Pin.events = {
        emit: emit,
        processRules: processRules
    };
})(window.Pin);
