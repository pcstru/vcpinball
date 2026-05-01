(function initElementRegistry(Pin) {
    const DYNAMIC_TYPES = {
        flipper: true,
        spinner: true,
        gate: true,
        valve: true,
        launcher: true
    };

    function createRuntime() {
        return {
            segments: [],
            circles: [],
            ramps: [],
            sensors: [],
            drawables: []
        };
    }

    function addCompiled(runtime, el, mod, out) {
        const elementLevel = typeof el.level === "number" ? el.level : 0;
        (out.segments || []).forEach(function addSeg(seg) {
            if (seg.level == null && !seg.surfaceId) seg.level = elementLevel;
            runtime.segments.push(seg);
        });
        (out.circles || []).forEach(function addCircle(circle) {
            if (circle.level == null && !circle.surfaceId) circle.level = elementLevel;
            runtime.circles.push(circle);
        });
        (out.ramps || []).forEach(function addRamp(ramp) { runtime.ramps.push(ramp); });
        (out.sensors || []).forEach(function addSensor(sensor) {
            if (sensor.level == null && !sensor.surfaceId) sensor.level = elementLevel;
            if (!sensor.id) sensor.id = el.id;
            if (!sensor.elementType) sensor.elementType = el.type;
            runtime.sensors.push(sensor);
        });
        runtime.drawables.push({ element: el, module: mod, runtime: out });
    }

    function compileElements(table, world, options) {
        const opts = options || {};
        const runtime = {
            segments: [],
            circles: [],
            ramps: [],
            sensors: [],
            drawables: []
        };
        table.elements.forEach(function compile(el) {
            const mod = Pin.elements.registry[el.type];
            if (!mod || typeof mod.compile !== "function") return;
            const isDynamic = !!(mod.dynamic || DYNAMIC_TYPES[el.type]);
            if (opts.dynamic === false && isDynamic) return;
            if (opts.static === false && !isDynamic) return;
            const out = mod.compile(el, table, world) || {};
            addCompiled(runtime, el, mod, out);
        });
        return runtime;
    }

    function mergeRuntimes(target) {
        const runtime = target || createRuntime();
        runtime.segments.length = 0;
        runtime.circles.length = 0;
        runtime.ramps.length = 0;
        runtime.sensors.length = 0;
        runtime.drawables.length = 0;
        Array.prototype.slice.call(arguments, 1).forEach(function merge(part) {
            if (!part) return;
            runtime.segments.push.apply(runtime.segments, part.segments || []);
            runtime.circles.push.apply(runtime.circles, part.circles || []);
            runtime.ramps.push.apply(runtime.ramps, part.ramps || []);
            runtime.sensors.push.apply(runtime.sensors, part.sensors || []);
            runtime.drawables.push.apply(runtime.drawables, part.drawables || []);
        });
        return runtime;
    }

    function getStateKey(el) {
        return (el && el.type ? el.type : "element") + ":" + (el && el.id ? el.id : "anonymous");
    }

    function getState(world, el, defaults, legacyKey) {
        if (!world) return Object.assign({}, defaults || {});
        world.elementState = world.elementState || {};
        const key = getStateKey(el);
        if (!world.elementState[key]) {
            if (legacyKey && world.elementState[legacyKey]) {
                world.elementState[key] = world.elementState[legacyKey];
                delete world.elementState[legacyKey];
            } else {
                world.elementState[key] = Object.assign({}, defaults || {});
            }
        }
        return world.elementState[key];
    }

    function peekState(world, el, legacyKey) {
        if (!world || !world.elementState) return null;
        return world.elementState[getStateKey(el)] || (legacyKey ? world.elementState[legacyKey] : null) || null;
    }

    Pin.elements.compileElements = compileElements;
    Pin.elements.mergeRuntimes = mergeRuntimes;
    Pin.elements.getStateKey = getStateKey;
    Pin.elements.getState = getState;
    Pin.elements.peekState = peekState;
    Pin.elements.isDynamicType = function isDynamicType(type) { return !!DYNAMIC_TYPES[type]; };
})(window.Pin);
