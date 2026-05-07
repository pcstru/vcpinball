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
            const out = [];
            const seen = {};
            const switchMap = world && world.table && world.table.rulesEngine && Array.isArray(world.table.rulesEngine.switchMap)
                ? world.table.rulesEngine.switchMap
                : [];
            const logicSwitches = world && world.logicRuntime && world.logicRuntime.doc && Array.isArray(world.logicRuntime.doc.switchRegistry)
                ? world.logicRuntime.doc.switchRegistry
                : [];
            switchMap.forEach(function each(row) {
                if (!row) return;
                const logicalId = row.id != null ? String(row.id) : "";
                const physicalId = row.sourceElementId != null ? String(row.sourceElementId) : "";
                if (!logicalId) return;
                if (logicalId === raw || physicalId === raw) {
                    if (!seen[logicalId]) {
                        seen[logicalId] = true;
                        out.push(logicalId);
                    }
                }
            });
            logicSwitches.forEach(function each(row) {
                if (!row) return;
                const logicalId = row.id != null ? String(row.id) : "";
                const physicalId = row.sourceElementId != null ? String(row.sourceElementId) : "";
                if (!logicalId) return;
                if (logicalId === raw || physicalId === raw) {
                    if (!seen[logicalId]) {
                        seen[logicalId] = true;
                        out.push(logicalId);
                    }
                }
            });
            if (!out.length) out.push(raw);
            return out;
        }

        function syncLogicLamps(runtime) {
            const map = runtime && runtime.lamps ? runtime.lamps : {};
            const next = {};
            Object.keys(map).forEach(function each(id) {
                next[id] = { on: !!map[id], intensity: map[id] ? 1 : 0 };
            });
            world.lampState = next;
        }

        if (Pin.logicSim) {
            ensureLogicRuntime();
            if (world.logicRuntime && typeof Pin.logicSim.advanceTime === "function") {
                Pin.logicSim.advanceTime(world.logicRuntime, dt);
                syncLogicLamps(world.logicRuntime);
                syncRuleElementProperties(world.logicRuntime);
            }
        }
        const processed = [];
        while (world.events.length) {
            const events = world.events.splice(0, world.events.length);
            processed.push.apply(processed, events);
            events.forEach(function apply(event) {
                if (event.type === "score") {
                    world.score = (world.score || 0) + (event.points || 0);
                }
                if (event.type === "switchClosed" && Pin.logicSim) {
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
                    syncLogicLamps(world.logicRuntime);
                    syncRuleElementProperties(world.logicRuntime);
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
