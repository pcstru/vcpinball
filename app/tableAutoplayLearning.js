/*
 * Tiny lab-only neural autoplay policy and trainer.
 * Why: allow browser-side experimentation with learned flipper timing without
 * touching core physics internals or game-mode control paths.
 */
(function initTableAutoplayLearning(Pin) {
    const FEATURE_NAMES = [
        "ball_x_norm",
        "ball_y_norm",
        "ball_vx_norm",
        "ball_vy_norm",
        "ball_speed_norm",
        "left_dx_norm",
        "left_dy_norm",
        "right_dx_norm",
        "right_dy_norm",
        "left_dist_norm",
        "right_dist_norm",
        "is_lower_playfield",
        "is_descending",
        "is_in_launch_lane",
        "target_dx_norm",
        "target_dy_norm"
    ];

    function clamp(value, min, max) {
        return Math.max(min, Math.min(max, value));
    }

    function isFiniteNumber(value) {
        return typeof value === "number" && Number.isFinite(value);
    }

    function sigmoid(value) {
        return 1 / (1 + Math.exp(-value));
    }

    function softmax3(a, b, c) {
        const m = Math.max(a, b, c);
        const ea = Math.exp(a - m);
        const eb = Math.exp(b - m);
        const ec = Math.exp(c - m);
        const sum = ea + eb + ec || 1;
        return [ea / sum, eb / sum, ec / sum];
    }

    function liveBall(world) {
        return world && world.balls && world.balls[0] ? world.balls[0] : null;
    }

    function pickFlipperPivots(world) {
        const table = world && world.table ? world.table : null;
        const elements = table && Array.isArray(table.elements) ? table.elements : [];
        const out = { left: null, right: null };
        elements.forEach(function each(el) {
            if (!el || el.type !== "flipper" || !el.pivot) return;
            if (el.side === "left" && !out.left) out.left = el.pivot;
            if (el.side === "right" && !out.right) out.right = el.pivot;
        });
        return out;
    }

    function findLauncher(world) {
        const table = world && world.table ? world.table : null;
        const elements = table && Array.isArray(table.elements) ? table.elements : [];
        return elements.find(function find(el) { return el && el.type === "launcher"; }) || null;
    }

    function ballSeemsInLaunchLane(ball, launcher) {
        if (!ball || !launcher) return false;
        if (ball.inLaunchLane) return true;
        if (!isFiniteNumber(ball.x) || !isFiniteNumber(ball.y)) return false;
        if (!isFiniteNumber(launcher.x) || !isFiniteNumber(launcher.top) || !isFiniteNumber(launcher.bottom)) return false;
        const width = Math.max(14, Number(launcher.width) || 18);
        const insideX = Math.abs(ball.x - launcher.x) <= (width * 1.2);
        const insideY = ball.y >= (launcher.top - 8) && ball.y <= (launcher.bottom + 8);
        return insideX && insideY;
    }

    /*
     * What: Encode compact numeric state for a tiny policy network.
     * Why: keep training fast and stable in-browser with deterministic bounds.
     */
    function extractFeatures(world, context) {
        const table = world && world.table ? world.table : null;
        const playfield = table && table.playfield ? table.playfield : {};
        const width = Math.max(100, Number(playfield.width) || 500);
        const height = Math.max(100, Number(playfield.height) || 880);
        const pivots = pickFlipperPivots(world);
        const ball = liveBall(world);
        const target = context && context.target && isFiniteNumber(context.target.x) && isFiniteNumber(context.target.y)
            ? context.target
            : null;
        if (!ball) return [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0];

        const bx = clamp(ball.x / width, 0, 1);
        const by = clamp(ball.y / height, 0, 1);
        const vx = clamp((ball.vx || 0) / 24, -1, 1);
        const vy = clamp((ball.vy || 0) / 24, -1, 1);
        const speed = clamp(Math.sqrt((ball.vx || 0) * (ball.vx || 0) + (ball.vy || 0) * (ball.vy || 0)) / 24, 0, 1);
        const leftDx = pivots.left ? clamp((ball.x - pivots.left.x) / 140, -1, 1) : 0;
        const leftDy = pivots.left ? clamp((ball.y - pivots.left.y) / 140, -1, 1) : 0;
        const rightDx = pivots.right ? clamp((ball.x - pivots.right.x) / 140, -1, 1) : 0;
        const rightDy = pivots.right ? clamp((ball.y - pivots.right.y) / 140, -1, 1) : 0;
        const leftDist = pivots.left ? clamp(Math.sqrt(leftDx * leftDx + leftDy * leftDy), 0, 2) / 2 : 1;
        const rightDist = pivots.right ? clamp(Math.sqrt(rightDx * rightDx + rightDy * rightDy), 0, 2) / 2 : 1;
        const lowerPlayfield = by > 0.5 ? 1 : 0;
        const descending = vy > 0 ? 1 : 0;
        const inLaunchLane = ball.inLaunchLane ? 1 : 0;
        const tx = target ? clamp((target.x - ball.x) / 200, -1, 1) : 0;
        const ty = target ? clamp((target.y - ball.y) / 200, -1, 1) : 0;
        return [bx, by, vx, vy, speed, leftDx, leftDy, rightDx, rightDy, leftDist, rightDist, lowerPlayfield, descending, inLaunchLane, tx, ty];
    }

    function createModel(inputSize, hiddenSize) {
        const inN = Math.max(4, Math.round(inputSize || 16));
        const hidN = Math.max(4, Math.round(hiddenSize || 12));
        const w1 = [];
        for (let h = 0; h < hidN; h++) {
            const row = [];
            for (let i = 0; i < inN; i++) row.push((Math.random() * 2 - 1) * 0.15);
            w1.push(row);
        }
        const b1 = new Array(hidN).fill(0);
        const w2 = [];
        for (let o = 0; o < 3; o++) {
            const row2 = [];
            for (let h2 = 0; h2 < hidN; h2++) row2.push((Math.random() * 2 - 1) * 0.15);
            w2.push(row2);
        }
        const b2 = [0, 0, 0];
        return { inputSize: inN, hiddenSize: hidN, w1: w1, b1: b1, w2: w2, b2: b2 };
    }

    function forward(model, input) {
        const hidden = new Array(model.hiddenSize);
        for (let h = 0; h < model.hiddenSize; h++) {
            let sum = model.b1[h];
            for (let i = 0; i < model.inputSize; i++) sum += model.w1[h][i] * (input[i] || 0);
            hidden[h] = sigmoid(sum);
        }
        const o0 = model.b2[0] + hidden.reduce(function sum(acc, v, idx) { return acc + v * model.w2[0][idx]; }, 0);
        const o1 = model.b2[1] + hidden.reduce(function sum(acc, v, idx) { return acc + v * model.w2[1][idx]; }, 0);
        const o2 = model.b2[2] + hidden.reduce(function sum(acc, v, idx) { return acc + v * model.w2[2][idx]; }, 0);
        const probs = softmax3(o0, o1, o2);
        return { hidden: hidden, logits: [o0, o1, o2], probs: probs };
    }

    function actionIndex(label) {
        if (label === "left") return 1;
        if (label === "right") return 2;
        return 0;
    }

    function trainModel(model, samples, options) {
        const epochs = clamp(Math.round((options && options.epochs) || 4), 1, 40);
        const learningRate = clamp(Number((options && options.learningRate) || 0.05), 0.0005, 1.2);
        const size = Array.isArray(samples) ? samples.length : 0;
        if (!size) return { epochs: 0, samples: 0, finalLoss: 0 };
        let loss = 0;
        for (let epoch = 0; epoch < epochs; epoch++) {
            loss = 0;
            for (let s = 0; s < samples.length; s++) {
                const sample = samples[s];
                if (!sample || !Array.isArray(sample.features)) continue;
                const input = sample.features;
                const targetIdx = actionIndex(sample.action);
                const pass = forward(model, input);
                const p = pass.probs;
                loss += -Math.log(Math.max(1e-8, p[targetIdx]));
                const dLogits = [p[0], p[1], p[2]];
                dLogits[targetIdx] -= 1;
                for (let o = 0; o < 3; o++) {
                    for (let h = 0; h < model.hiddenSize; h++) {
                        model.w2[o][h] -= learningRate * dLogits[o] * pass.hidden[h];
                    }
                    model.b2[o] -= learningRate * dLogits[o];
                }
                for (let h2 = 0; h2 < model.hiddenSize; h2++) {
                    let dh = 0;
                    for (let o2 = 0; o2 < 3; o2++) dh += dLogits[o2] * model.w2[o2][h2];
                    const gradHidden = dh * pass.hidden[h2] * (1 - pass.hidden[h2]);
                    for (let i = 0; i < model.inputSize; i++) {
                        model.w1[h2][i] -= learningRate * gradHidden * (input[i] || 0);
                    }
                    model.b1[h2] -= learningRate * gradHidden;
                }
            }
            loss /= Math.max(1, size);
        }
        return { epochs: epochs, samples: size, finalLoss: loss };
    }

    function createController(world, options) {
        const opts = options || {};
        const model = opts.model;
        const fallback = opts.fallbackController || null;
        const minConfidence = clamp(Number(opts.minConfidence || 0.52), 0.34, 0.95);
        const minActionProbability = clamp(Number(opts.minActionProbability || 0.22), 0.05, 0.8);
        const indecisiveGap = clamp(Number(opts.indecisiveGap || 0.1), 0.01, 0.6);
        const pulseTicks = clamp(Math.round(opts.pulseTicks || 2), 1, 8);
        const cooldownTicks = clamp(Math.round(opts.cooldownTicks || 6), 1, 24);
        const maxInput = 64;
        const maxHidden = 64;
        const validModel = !!(model &&
            Number.isFinite(model.inputSize) &&
            Number.isFinite(model.hiddenSize) &&
            model.inputSize >= 4 &&
            model.inputSize <= maxInput &&
            model.hiddenSize >= 4 &&
            model.hiddenSize <= maxHidden &&
            Array.isArray(model.w1) &&
            Array.isArray(model.w2) &&
            Array.isArray(model.b1) &&
            Array.isArray(model.b2) &&
            model.w1.length === model.hiddenSize &&
            model.b1.length === model.hiddenSize &&
            model.w2.length === 3 &&
            model.b2.length === 3 &&
            model.w1.every(function everyRow(row) { return Array.isArray(row) && row.length === model.inputSize; }) &&
            model.w2.every(function everyOut(row2) { return Array.isArray(row2) && row2.length === model.hiddenSize; }));
        const state = {
            pulseLeft: 0,
            pulseRight: 0,
            cooldown: 0,
            debug: null,
            launchHold: 0,
            serve: 0,
            lastFeatures: null
        };
        const launcher = findLauncher(world);

        function simpleFallbackAction(ball) {
            const table = world && world.table ? world.table : null;
            const elements = table && Array.isArray(table.elements) ? table.elements : [];
            let bestLeft = null;
            let bestRight = null;
            elements.forEach(function each(el) {
                if (!el || el.type !== "flipper" || !el.pivot) return;
                const dx = ball.x - el.pivot.x;
                const dy = ball.y - el.pivot.y;
                const d2 = dx * dx + dy * dy;
                if (el.side === "left" && (bestLeft == null || d2 < bestLeft)) bestLeft = d2;
                if (el.side === "right" && (bestRight == null || d2 < bestRight)) bestRight = d2;
            });
            const threshold = 95 * 95;
            return {
                left: bestLeft != null && bestLeft <= threshold && (ball.vy || 0) > -1.5,
                right: bestRight != null && bestRight <= threshold && (ball.vy || 0) > -1.5
            };
        }
        function inPlayableFlipperWindow(ball) {
            if (!ball || !isFiniteNumber(ball.x) || !isFiniteNumber(ball.y)) return false;
            const table = world && world.table ? world.table : null;
            const playfield = table && table.playfield ? table.playfield : {};
            const height = Math.max(120, Number(playfield.height) || 880);
            if (ball.y < height * 0.46) return false;
            return (ball.vy || 0) > -1.8;
        }
        function update() {
            const ball = liveBall(world);
            const controls = { left: false, right: false, launch: false };
            if (!ball || !validModel) {
                if (!ball) state.launchHold = 0;
                const emergency = ball ? simpleFallbackAction(ball) : { left: false, right: false };
                const inLaneFallback = ballSeemsInLaunchLane(ball, launcher);
                state.debug = {
                    action: "fallback",
                    confidence: 1,
                    outputs: { none: 0, left: 0, right: 0 },
                    logits: null,
                    hidden: null,
                    cooldown: state.cooldown,
                    pulseLeft: state.pulseLeft,
                    pulseRight: state.pulseRight,
                    target: null,
                    source: "fallback",
                    controls: {
                        left: !!emergency.left,
                        right: !!emergency.right,
                        launch: !!inLaneFallback
                    },
                    model: validModel ? { inputSize: model.inputSize, hiddenSize: model.hiddenSize } : null
                };
                return {
                    left: !!emergency.left,
                    right: !!emergency.right,
                    launch: !!inLaneFallback
                };
            }
            const inLane = ballSeemsInLaunchLane(ball, launcher);
            if (inLane) {
                if (state.launchHold <= 0) {
                    state.serve += 1;
                    state.launchHold = 14 + (state.serve % 8) * 2;
                }
                controls.launch = state.launchHold > 0;
                state.launchHold -= 1;
            } else {
                state.launchHold = 0;
            }
            const target = opts.targetProvider ? opts.targetProvider() : null;
            const features = extractFeatures(world, { target: target });
            state.lastFeatures = features.slice(0);
            const pass = forward(model, features);
            const best = pass.probs[1] > pass.probs[2]
                ? (pass.probs[1] > pass.probs[0] ? "left" : "none")
                : (pass.probs[2] > pass.probs[0] ? "right" : "none");
            const confidence = Math.max(pass.probs[0], pass.probs[1], pass.probs[2]);
            const modelActionProb = Math.max(pass.probs[1], pass.probs[2]);
            const modelGap = Math.abs(pass.probs[1] - pass.probs[2]);
            if (state.cooldown <= 0 && state.pulseLeft <= 0 && state.pulseRight <= 0 && best !== "none") {
                if (best === "left") state.pulseLeft = pulseTicks;
                if (best === "right") state.pulseRight = pulseTicks;
                state.cooldown = cooldownTicks;
            }
            if (state.pulseLeft > 0) {
                controls.left = true;
                state.pulseLeft -= 1;
            }
            if (state.pulseRight > 0) {
                controls.right = true;
                state.pulseRight -= 1;
            }
            if (state.cooldown > 0) state.cooldown -= 1;
            let usedFallback = false;
            const lowConfidence = confidence < minConfidence;
            const indecisive = (best === "none") || modelActionProb < minActionProbability || modelGap < indecisiveGap;
            if (lowConfidence || (indecisive && inPlayableFlipperWindow(ball))) {
                if (fallback && typeof fallback.update === "function") {
                    const heavyFallback = fallback.update();
                    controls.left = !!controls.left || !!heavyFallback.left;
                    controls.right = !!controls.right || !!heavyFallback.right;
                    controls.launch = !!controls.launch || !!heavyFallback.launch;
                    usedFallback = true;
                } else {
                    const emergency = simpleFallbackAction(ball);
                    controls.left = !!controls.left || !!emergency.left;
                    controls.right = !!controls.right || !!emergency.right;
                    usedFallback = true;
                }
            }
            state.debug = {
                action: usedFallback ? ("fallback(" + best + ")") : best,
                confidence: confidence,
                outputs: { none: pass.probs[0], left: pass.probs[1], right: pass.probs[2] },
                logits: pass.logits.slice(0, 3),
                hidden: pass.hidden.slice(0, 24),
                cooldown: state.cooldown,
                pulseLeft: state.pulseLeft,
                pulseRight: state.pulseRight,
                target: target,
                source: usedFallback ? "fallback" : "model",
                modelActionProb: modelActionProb,
                modelGap: modelGap,
                inLaunchLane: !!inLane,
                launchHold: state.launchHold,
                controls: {
                    left: !!controls.left,
                    right: !!controls.right,
                    launch: !!controls.launch
                },
                featureNames: FEATURE_NAMES.slice(0),
                features: state.lastFeatures ? state.lastFeatures.slice(0, 16) : null,
                model: { inputSize: model.inputSize, hiddenSize: model.hiddenSize }
            };
            return controls;
        }
        return {
            update: update,
            getAimDebug: function getAimDebug() { return state.debug; }
        };
    }

    Pin.tableAutoplayLearning = {
        featureNames: FEATURE_NAMES.slice(0),
        createModel: createModel,
        extractFeatures: extractFeatures,
        trainModel: trainModel,
        createController: createController
    };
})(window.Pin);
