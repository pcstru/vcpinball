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
        const processed = [];
        let rulesAlreadyAdvanced = false;
        if (!world.events.length && Pin.rules) {
            /*
             * What: Let timer-generated rule events run even when no physical event is queued.
             * Why: timed triggers can award points or emit follow-up events from a quiet frame,
             *      and those follow-up events should be applied during the same rules pass.
             * Correctness: the existing bounded loop below is reused for any events emitted by
             *              rules, preserving the score/event ordering used by physical events.
             */
            Pin.rules.process(world, [], dt || 0);
            rulesAlreadyAdvanced = true;
        }
        let loops = 0;
        while (world.events.length && loops < 8) {
            const events = world.events.splice(0, world.events.length);
            processed.push.apply(processed, events);
            events.forEach(function apply(event) {
                if (event.type === "score") {
                    world.score = (world.score || 0) + (event.points || 0);
                }
            });
            if (Pin.rules) Pin.rules.process(world, events, !rulesAlreadyAdvanced && loops === 0 ? (dt || 0) : 0);
            loops += 1;
        }
        return processed;
    }

    Pin.events = {
        emit: emit,
        processRules: processRules
    };
})(window.Pin);
