(function initElementRegistry(Pin) {
    const DYNAMIC_RENDER_TYPES = {
        flipper: true,
        spinner: true,
        gate: true,
        launcher: true,
        light: true,
        arrowLight: true,
        boxLight: true,
        dropTarget: true,
        kicker: true,
        lane: true,
        trough: true
    };
    const DYNAMIC_PHYSICS_TYPES = {
        flipper: true,
        spinner: true,
        gate: true,
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
        const elements = opts.elements || table.elements || [];
        const cacheStore = opts.dynamicCacheStore || null;
        const cacheMetrics = opts.dynamicCacheMetrics || null;
        elements.forEach(function compile(el) {
            const mod = Pin.elements.registry[el.type];
            if (!mod || typeof mod.compile !== "function") return;
            const isDynamicPhysics = !!DYNAMIC_PHYSICS_TYPES[el.type];
            if (opts.dynamic === false && isDynamicPhysics) return;
            if (opts.static === false && !isDynamicPhysics) return;
            if (opts.dynamicPhysicsOnly && !isDynamicPhysics) return;
            let out = null;
            if (cacheStore && opts.dynamicPhysicsOnly && typeof mod.physicsCacheKey === "function") {
                const stateKey = getStateKey(el);
                const cacheKey = mod.physicsCacheKey(el, table, world);
                const cached = cacheStore[stateKey];
                if (cached && cached.cacheKey === cacheKey && cached.out) {
                    out = cached.out;
                    if (cacheMetrics) cacheMetrics.hits = (cacheMetrics.hits || 0) + 1;
                } else {
                    out = mod.compile(el, table, world) || {};
                    cacheStore[stateKey] = {
                        cacheKey: cacheKey,
                        out: out
                    };
                    if (cacheMetrics) cacheMetrics.misses = (cacheMetrics.misses || 0) + 1;
                }
            } else {
                out = mod.compile(el, table, world) || {};
            }
            addCompiled(runtime, el, mod, out);
        });
        return runtime;
    }

    /*
     * What: Advance runtime state for dynamic physics elements without building
     * colliders.
     * Why: compile should be geometry-only so idle colliders can be cached and
     * reused safely.
     */
    function stepDynamicElements(table, world, dt, elements) {
        const list = elements || table.elements || [];
        list.forEach(function step(el) {
            const mod = Pin.elements.registry[el.type];
            if (!mod || typeof mod.step !== "function") return;
            if (!DYNAMIC_PHYSICS_TYPES[el.type]) return;
            mod.step(el, table, world, dt);
        });
    }

    function filterElements(table, predicate) {
        /* What: Build a stable per-world element list for repeated runtime passes.
         * Why: Play mode should not rescan every table element at 120 Hz.
         */
        const out = [];
        (table.elements || []).forEach(function each(el) {
            if (el && predicate(el.type, el)) out.push(el);
        });
        return out;
    }

    function createDrawables(table, predicate) {
        /* What: Create drawable entries without recompiling element geometry.
         * Why: Dynamic lights and mechanisms draw from element/world state, while
         * physics ticks only need collider-producing dynamic elements.
         */
        const runtime = createRuntime();
        (table.elements || []).forEach(function each(el) {
            const mod = el && Pin.elements.registry[el.type];
            if (!mod || !mod.draw || !predicate(el.type, el)) return;
            runtime.drawables.push({ element: el, module: mod, runtime: {} });
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

    function getState(world, el, defaults) {
        if (!world) return Object.assign({}, defaults || {});
        world.elementState = world.elementState || {};
        const key = getStateKey(el);
        if (!world.elementState[key]) {
            world.elementState[key] = Object.assign({}, defaults || {});
        }
        return world.elementState[key];
    }

    function peekState(world, el) {
        if (!world || !world.elementState) return null;
        return world.elementState[getStateKey(el)] || null;
    }

    Pin.elements.compileElements = compileElements;
    Pin.elements.mergeRuntimes = mergeRuntimes;
    Pin.elements.getStateKey = getStateKey;
    Pin.elements.getState = getState;
    Pin.elements.peekState = peekState;
    Pin.elements.filterElements = filterElements;
    Pin.elements.createDrawables = createDrawables;
    Pin.elements.stepDynamicElements = stepDynamicElements;
    Pin.elements.isDynamicType = function isDynamicType(type) { return !!DYNAMIC_RENDER_TYPES[type]; };
    Pin.elements.isDynamicPhysicsType = function isDynamicPhysicsType(type) { return !!DYNAMIC_PHYSICS_TYPES[type]; };
})(window.Pin);
