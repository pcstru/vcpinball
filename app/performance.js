// What: Play-loop performance helpers, including adaptive quality control.
// Why: Rendering quality should react to sustained pressure, not single-frame spikes.
(function initPerformance(Pin) {
    Pin.performance = Pin.performance || {};

    function clamp(value, min, max) {
        return Math.max(min, Math.min(max, value));
    }

    function updateEma(previous, nextValue, dtSeconds, halfLifeMs) {
        if (!Number.isFinite(nextValue)) return previous;
        if (!Number.isFinite(previous)) return nextValue;
        const dtMs = Math.max(0, (Number.isFinite(dtSeconds) ? dtSeconds : 0) * 1000);
        if (dtMs <= 0 || !Number.isFinite(halfLifeMs) || halfLifeMs <= 0) return nextValue;
        const alpha = 1 - Math.exp(-Math.LN2 * (dtMs / halfLifeMs));
        return previous + (nextValue - previous) * alpha;
    }

    /* What: Build a stateful adaptive quality controller for play mode.
     * Why: Hysteresis and dwell times prevent quality oscillation and visual flicker.
     */
    function createAdaptiveQualityController(options) {
        const opts = Object.assign({
            frameHalfLifeMs: 650,
            backlogHalfLifeMs: 500,
            enterFrameMs: 22,
            exitFrameMs: 18,
            enterBacklogSteps: 1.55,
            exitBacklogSteps: 0.65,
            enterSustainMs: 900,
            exitSustainMs: 3000,
            minDwellMs: 1800
        }, options || {});

        const fullQuality = { glowScale: 1, reducedEffects: false };
        const reducedQuality = { glowScale: 0.55, reducedEffects: true };
        let mode = "full";
        let modeChangedAt = 0;
        let pressureSince = 0;
        let stableSince = 0;
        let frameMsEma = NaN;
        let backlogEma = NaN;

        /* What: Sample current frame pressure and return the desired quality profile.
         * Why: Play mode needs predictable, low-noise quality switching.
         */
        function sample(metrics) {
            const now = Math.max(0, Number(metrics && metrics.now) || 0);
            const frameDt = clamp(Number(metrics && metrics.frameDt) || 0, 0, 0.2);
            const frameMs = frameDt * 1000;
            const backlogSteps = Math.max(0, Number(metrics && metrics.backlogSteps) || 0);

            frameMsEma = updateEma(frameMsEma, frameMs, frameDt, opts.frameHalfLifeMs);
            backlogEma = updateEma(backlogEma, backlogSteps, frameDt, opts.backlogHalfLifeMs);

            const underPressure = frameMsEma >= opts.enterFrameMs || backlogEma >= opts.enterBacklogSteps;
            const stable = frameMsEma <= opts.exitFrameMs && backlogEma <= opts.exitBacklogSteps;
            const canSwitch = now - modeChangedAt >= opts.minDwellMs;

            if (underPressure) {
                if (!pressureSince) pressureSince = now;
            } else {
                pressureSince = 0;
            }

            if (stable) {
                if (!stableSince) stableSince = now;
            } else {
                stableSince = 0;
            }

            if (mode === "full" && canSwitch && pressureSince && (now - pressureSince >= opts.enterSustainMs)) {
                mode = "reduced";
                modeChangedAt = now;
                stableSince = 0;
            } else if (mode === "reduced" && canSwitch && stableSince && (now - stableSince >= opts.exitSustainMs)) {
                mode = "full";
                modeChangedAt = now;
                pressureSince = 0;
            }

            return mode === "reduced" ? reducedQuality : fullQuality;
        }

        return { sample: sample };
    }

    Pin.performance.createAdaptiveQualityController = createAdaptiveQualityController;
})(window.Pin);
