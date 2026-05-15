(function initMain(Pin) {
    const perfEnabled = !!(window.localStorage && localStorage.getItem("pin.perf") === "1");
    const perfState = {};
    let bootToken = 0;

    function perfStart() {
        if (!perfEnabled || typeof performance === "undefined") return 0;
        return performance.now();
    }

    function perfEnd(name, startedAt) {
        if (!perfEnabled || !startedAt || typeof performance === "undefined") return;
        const entry = perfState[name] || { total: 0, count: 0 };
        entry.total += performance.now() - startedAt;
        entry.count += 1;
        perfState[name] = entry;
    }

    function flushPerf() {
        if (!perfEnabled) return;
        const keys = Object.keys(perfState);
        if (!keys.length) return;
        const parts = keys.map(function map(key) {
            const item = perfState[key];
            const avg = item.count ? item.total / item.count : 0;
            return key + "=" + avg.toFixed(2) + "ms";
        });
        console.log("[pin.perf][play] " + parts.join(" | "));
        keys.forEach(function clear(key) { delete perfState[key]; });
    }

    function decodePart(value) {
        if (value == null) return "";
        try {
            return decodeURIComponent(String(value));
        } catch (err) {
            return String(value);
        }
    }

    function parseHashKv(hash) {
        const parts = hash.split("&");
        const kv = {};
        parts.slice(1).forEach(function each(part) {
            if (!part) return;
            const chunks = part.split("=");
            const key = chunks[0];
            if (!key) return;
            kv[key] = decodePart(chunks.slice(1).join("="));
        });
        return kv;
    }

    function parseQueryKv() {
        const kv = {};
        let params = null;
        try {
            params = new URLSearchParams(location.search || "");
        } catch (err) {
            return kv;
        }
        params.forEach(function each(value, key) {
            kv[key] = value;
        });
        return kv;
    }

    function parseHash() {
        const hash = (location.hash || "#play").replace(/^#/, "");
        const parts = hash.split("&");
        const mode = parts[0] || "play";
        const hashKv = parseHashKv(hash);
        const queryKv = parseQueryKv();
        return {
            mode: mode,
            kv: Object.assign({}, hashKv, queryKv),
            hashKv: hashKv,
            queryKv: queryKv
        };
    }

    function createWorld(table, options) {
        options = options || {};
        const world = {
            table: table,
            balls: [],
            score: 0,
            events: [],
            ruleState: {},
            lampState: {},
            currentBall: 1,
            ballsRemaining: table.rules.balls,
            state: "ready",
            launchCharging: false,
            launchStart: 0,
            tableAssetBaseHref: typeof options.tableAssetBaseHref === "string" ? options.tableAssetBaseHref : "",
            controls: {
                left: false,
                right: false
            },
            elementState: {}
        };
        if (Pin.logicCompile && Pin.logicSim) {
            const logicDoc = Pin.logicCompile.extractFromTable(table);
            world.logicRuntime = Pin.logicSim.createRuntime(logicDoc);
            Object.keys(world.logicRuntime.lamps || {}).forEach(function eachLamp(id) {
                world.lampState[id] = { on: !!world.logicRuntime.lamps[id], intensity: world.logicRuntime.lamps[id] ? 1 : 0 };
            });
        }
        world.balls = [Pin.ballLifecycle.makeLaunchBall(world)];
        buildStaticRuntime(world);
        refreshRuntime(world);
        return world;
    }

    function buildStaticRuntime(world) {
        const staticRuntime = Pin.elements.compileElements(world.table, world, { dynamic: false });
        world.staticRuntime = staticRuntime;
        world.staticSegments = staticRuntime.segments;
        world.staticCircles = staticRuntime.circles;
        world.staticRamps = staticRuntime.ramps || [];
        world.staticSensors = staticRuntime.sensors || [];
        world.dynamicPhysicsElements = Pin.elements.filterElements ?
            Pin.elements.filterElements(world.table, Pin.elements.isDynamicPhysicsType) :
            (world.table.elements || []);
        world.dynamicDrawableRuntime = Pin.elements.createDrawables ?
            Pin.elements.createDrawables(world.table, Pin.elements.isDynamicPhysicsType) :
            { drawables: [] };
        world.staticBroadPhase = Pin.physics.buildBroadPhase(world.staticSegments, world.staticCircles, world.table.playfield);
        world.staticSensorBroadPhase = Pin.physics.buildSensorBroadPhase(world.staticSensors);
    }

    function refreshRuntime(world) {
        const startedAt = perfStart();
        const dynamicRuntime = Pin.elements.compileElements(world.table, world, {
            static: false,
            dynamicPhysicsOnly: true,
            elements: world.dynamicPhysicsElements
        });
        world.dynamicRuntime = dynamicRuntime;
        world.dynamicSegments = dynamicRuntime.segments;
        world.dynamicCircles = dynamicRuntime.circles;
        world.dynamicRamps = dynamicRuntime.ramps || [];
        world.dynamicSensors = dynamicRuntime.sensors || [];
        const runtime = Pin.elements.mergeRuntimes(
            world.runtime || { segments: [], circles: [], ramps: [], sensors: [], drawables: [] },
            world.staticRuntime,
            dynamicRuntime
        );
        // Dynamic drawables read current world state directly, so keep them out
        // of the per-tick collider rebuild and append them once here.
        runtime.drawables.length = 0;
        runtime.drawables.push.apply(runtime.drawables, world.staticRuntime.drawables || []);
        runtime.drawables.push.apply(runtime.drawables, (world.dynamicDrawableRuntime && world.dynamicDrawableRuntime.drawables) || []);
        world.runtime = runtime;
        world.runtimeSegments = runtime.segments;
        world.runtimeCircles = runtime.circles;
        world.runtimeRamps = runtime.ramps;
        world.runtimeSensors = runtime.sensors;
        perfEnd("refreshRuntime", startedAt);
    }

    function mountPlay(root, table, options) {
        options = options || {};
        if (typeof root._pinballCleanup === "function") root._pinballCleanup();
        root.innerHTML = "";
        const wrap = document.createElement("div");
        wrap.className = "play-mode";
        const inner = document.createElement("div");
        inner.className = "play-canvas-wrap";
        const canvas = document.createElement("canvas");
        canvas.width = table.playfield.width;
        canvas.height = table.playfield.height;
        inner.appendChild(canvas);
        const highScoreOverlay = document.createElement("div");
        highScoreOverlay.className = "high-score-overlay";
        inner.appendChild(highScoreOverlay);
        const tableStack = document.createElement("div");
        tableStack.className = "play-table-stack";
        const controls = document.createElement("div");
        controls.className = "mobile-play-controls";
        controls.setAttribute("aria-label", "Mobile play controls");
        const leftButton = document.createElement("button");
        leftButton.type = "button";
        leftButton.className = "play-control-button flipper-left";
        leftButton.setAttribute("aria-label", "Left flipper");
        leftButton.textContent = "L";
        const launchButton = document.createElement("button");
        launchButton.type = "button";
        launchButton.className = "play-control-button launch";
        launchButton.setAttribute("aria-label", "Launch");
        launchButton.textContent = "Launch";
        const rightButton = document.createElement("button");
        rightButton.type = "button";
        rightButton.className = "play-control-button flipper-right";
        rightButton.setAttribute("aria-label", "Right flipper");
        rightButton.textContent = "R";
        controls.appendChild(leftButton);
        controls.appendChild(launchButton);
        controls.appendChild(rightButton);
        const help = document.createElement("div");
        help.className = "play-instructions";
        help.setAttribute("aria-label", "Help");
        help.innerHTML =
            "<p><strong>Play</strong> &mdash; <kbd>Space</kbd>: hold to charge, release to launch. " +
            "<kbd>Left Arrow</kbd>/<kbd>A</kbd>: left flipper. <kbd>Right Arrow</kbd>/<kbd>L</kbd>: right flipper. " +
            "<kbd>H</kbd>: hide/show touch buttons. " +
            "<kbd>R</kbd>: restart. <kbd>D</kbd>: open <strong>design (edit) mode</strong>. " +
            "Touch: use the buttons below the table, or hold/release the table while staged and hold left/right screen half for flippers.</p>" +
            "<p><strong>Design mode</strong> &mdash; open this app with <code>#design</code> in the address bar " +
            "(e.g. <code>index.html#design</code>), or from play press <kbd>D</kbd>. " +
            "Add <strong>leftFlipper</strong> or <strong>rightFlipper</strong> from the editor palette. " +
            "Use <strong>Test Play</strong> in the editor toolbar to return to play with your current table.</p>";
        tableStack.appendChild(inner);
        tableStack.appendChild(controls);
        wrap.appendChild(tableStack);
        wrap.appendChild(help);
        root.appendChild(wrap);
        const ctx = canvas.getContext("2d");
        const world = createWorld(table, {
            tableAssetBaseHref: typeof options.tableAssetBaseHref === "string" ? options.tableAssetBaseHref : ""
        });
        let playedGameOverSound = false;
        let handledGameOverScores = false;
        let frameRaf = 0;
        let fitRaf = 0;
        let running = true;
        const activePointers = {};
        let launchButtonPointerId = null;
        let controlsHidden = false;

        // Fit the play surface to the viewport so the table is visible without browser zoom.
        function fitPlayCanvas() {
            const pf = table.playfield;
            const wrapRect = wrap.getBoundingClientRect();
            const helpRect = help.getBoundingClientRect();
            const controlsRect = controls.getBoundingClientRect();
            const gap = 18;
            const padX = 28;
            const padY = 20;
            const stacked = window.innerWidth <= 860;
            const helpWidth = Math.max(220, Math.min(320, Math.ceil(helpRect.width || 320)));
            const availableWidth = Math.max(320, Math.floor(window.innerWidth - padX - (stacked ? 0 : gap + helpWidth)));
            const controlsHeight = controlsRect.height ? controlsRect.height + 10 : 0;
            const availableHeight = Math.max(320, Math.floor(window.innerHeight - padY - controlsHeight));
            const scale = Math.max(0.25, Math.min(
                availableWidth / pf.width,
                availableHeight / pf.height
            ));
            const displayWidth = Math.max(1, Math.floor(pf.width * scale));
            const displayHeight = Math.max(1, Math.floor(pf.height * scale));
            canvas.style.width = displayWidth + "px";
            canvas.style.height = displayHeight + "px";
            inner.style.width = displayWidth + "px";
            inner.style.height = displayHeight + "px";
            tableStack.style.width = displayWidth + "px";
            controls.style.width = displayWidth + "px";
            wrap.style.minHeight = Math.max(displayHeight, Math.floor(wrapRect.height || 0)) + "px";
        }

        function setControlsHidden(hidden) {
            /*
             * What: Toggle the touch button row in play mode.
             * Why: keyboard players on desktop can reclaim vertical space for
             * the table while touch users can keep the on-screen controls.
             */
            controlsHidden = !!hidden;
            controls.classList.toggle("is-hidden", controlsHidden);
            resetLaunchControl();
            world.controls.left = false;
            world.controls.right = false;
            fitPlayCanvas();
        }

        function launchBall() {
            const ball = world.balls.find(function findBall(b) { return b.inLaunchLane; }) || world.balls[0];
            if (!ball) {
                world.launchCharging = false;
                return;
            }
            const wasReady = world.state === "ready";
            Pin.physics.releaseLauncher(world);
            if (Pin.audio) Pin.audio.launch();
            world.launchCharging = false;
            world.state = "playing";
            if (wasReady && world.currentBall === 1) hideHighScores();
        }

        function setLaunchButtonMode(label) {
            launchButton.textContent = label;
            launchButton.setAttribute("aria-label", label);
        }

        function resetLaunchControl() {
            launchButtonPointerId = null;
            world.launchCharging = false;
            launchButton.classList.remove("is-pressed");
        }

        function highScoresAreVisible() {
            return highScoreOverlay.classList.contains("is-visible");
        }

        function startFromPlayPrompt() {
            if (world.state === "game_over") resetWorldForNextGame();
            hideHighScores();
            resetLaunchControl();
            setLaunchButtonMode("Launch");
        }

        function ballIsInLauncher() {
            return !!world.balls.find(function findBall(ball) { return ball.inLaunchLane; });
        }

        function setTouchFlipper(side, pressed) {
            if (!side) return;
            const code = side === "left" ? "ArrowLeft" : "ArrowRight";
            setFlipperControl(code, pressed);
        }

        function onFlipperButtonDown(side, button, e) {
            if (e.pointerType === "mouse" && e.button !== 0) return;
            e.preventDefault();
            Pin.audio.ensure();
            button.classList.add("is-pressed");
            if (button.setPointerCapture) {
                try { button.setPointerCapture(e.pointerId); } catch (err) {}
            }
            setTouchFlipper(side, true);
        }

        function onFlipperButtonUp(side, button, e) {
            e.preventDefault();
            button.classList.remove("is-pressed");
            setTouchFlipper(side, false);
        }

        function onLaunchButtonDown(e) {
            if (e.pointerType === "mouse" && e.button !== 0) return;
            e.preventDefault();
            Pin.audio.ensure();
            if (highScoresAreVisible() || world.state === "game_over") {
                startFromPlayPrompt();
                return;
            }
            if (world.state === "ready" && !ballIsInLauncher()) {
                world.balls = [Pin.ballLifecycle.makeLaunchBall(world)];
            }
            if (!ballIsInLauncher()) return;
            launchButtonPointerId = e.pointerId;
            launchButton.classList.add("is-pressed");
            if (launchButton.setPointerCapture) {
                try { launchButton.setPointerCapture(e.pointerId); } catch (err) {}
            }
            world.launchCharging = true;
            world.launchStart = performance.now();
        }

        function onLaunchButtonUp(e) {
            if (launchButtonPointerId === null || e.pointerId !== launchButtonPointerId) return;
            e.preventDefault();
            launchButtonPointerId = null;
            launchButton.classList.remove("is-pressed");
            if (world.launchCharging) launchBall();
        }

        function screenSideFromEvent(e) {
            const x = typeof e.clientX === "number" ? e.clientX : (window.innerWidth || 0) * 0.5;
            return x < (window.innerWidth || document.documentElement.clientWidth || 0) * 0.5 ? "left" : "right";
        }

        function onPointerDown(e) {
            if (e.pointerType === "mouse" && e.button !== 0) return;
            e.preventDefault();
            Pin.audio.ensure();
            if (highScoresAreVisible() || world.state === "game_over") return;
            if (canvas.setPointerCapture) {
                try { canvas.setPointerCapture(e.pointerId); } catch (err) {}
            }
            if (ballIsInLauncher()) {
                activePointers[e.pointerId] = { kind: "launch" };
                world.launchCharging = true;
                world.launchStart = performance.now();
                return;
            }
            const side = screenSideFromEvent(e);
            activePointers[e.pointerId] = { kind: "flipper", side: side };
            setTouchFlipper(side, true);
        }

        function endPointer(e) {
            const state = activePointers[e.pointerId];
            if (!state) return;
            e.preventDefault();
            delete activePointers[e.pointerId];
            if (state.kind === "launch") {
                if (world.launchCharging) launchBall();
                return;
            }
            if (state.kind === "flipper") setTouchFlipper(state.side, false);
        }

        function setFlipperControl(code, pressed) {
            if (code === "ArrowLeft" || code === "KeyA") {
                if (pressed && !world.controls.left && Pin.audio) Pin.audio.flipper();
                world.controls.left = pressed;
            }
            if (code === "ArrowRight" || code === "KeyL") {
                if (pressed && !world.controls.right && Pin.audio) Pin.audio.flipper();
                world.controls.right = pressed;
            }
        }

        function isTextEntryTarget(target) {
            /* What: Detect focused form controls.
             * Why: Initial entry should not also trigger launch, restart, or design shortcuts.
             */
            const tag = target && target.tagName ? String(target.tagName).toUpperCase() : "";
            return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || tag === "BUTTON";
        }

        function formatScore(value) {
            /* What: Render scores consistently in the play overlay.
             * Why: High-score rows and current score should be easy to scan.
             */
            return String(Math.floor(Number(value) || 0));
        }

        function hideHighScores() {
            /* What: Hide the leaderboard overlay.
             * Why: The table should be unobstructed once the first ball is launched.
             */
            highScoreOverlay.classList.remove("is-visible");
            highScoreOverlay.innerHTML = "";
        }

        function renderHighScoreList(container, entries) {
            /* What: Draw the fixed-size leaderboard rows.
             * Why: Both attract mode and post-game mode share the same score table.
             */
            const list = document.createElement("ol");
            list.className = "high-score-list";
            if (!entries.length) {
                const row = document.createElement("li");
                row.className = "high-score-empty";
                row.textContent = "No scores yet";
                list.appendChild(row);
            } else {
                entries.forEach(function each(entry) {
                    const row = document.createElement("li");
                    const initials = document.createElement("span");
                    initials.className = "high-score-initials";
                    initials.textContent = entry.initials;
                    const score = document.createElement("span");
                    score.className = "high-score-value";
                    score.textContent = formatScore(entry.score);
                    row.appendChild(initials);
                    row.appendChild(score);
                    list.appendChild(row);
                });
            }
            container.appendChild(list);
        }

        function showHighScores(message) {
            /* What: Show the table-local leaderboard over the playfield.
             * Why: Play mode should default to scores until the player starts a game.
             */
            resetLaunchControl();
            setLaunchButtonMode("Play");
            const entries = Pin.highScores ? Pin.highScores.load(table) : [];
            highScoreOverlay.innerHTML = "";
            highScoreOverlay.classList.add("is-visible");
            const panel = document.createElement("div");
            panel.className = "high-score-panel";
            const title = document.createElement("div");
            title.className = "high-score-title";
            title.textContent = table.name || "Pinball";
            const subtitle = document.createElement("div");
            subtitle.className = "high-score-subtitle";
            subtitle.textContent = message || "Press Play to start";
            panel.appendChild(title);
            panel.appendChild(subtitle);
            renderHighScoreList(panel, entries);
            highScoreOverlay.appendChild(panel);
        }

        function showInitialsEntry() {
            /* What: Ask for initials after a qualifying final score.
             * Why: High-score entry must happen after the last ball before showing the updated table.
             */
            resetLaunchControl();
            setLaunchButtonMode("Play");
            highScoreOverlay.innerHTML = "";
            highScoreOverlay.classList.add("is-visible");
            const panel = document.createElement("div");
            panel.className = "high-score-panel high-score-entry";
            const title = document.createElement("div");
            title.className = "high-score-title";
            title.textContent = "New High Score";
            const score = document.createElement("div");
            score.className = "high-score-subtitle";
            score.textContent = formatScore(world.score);
            const form = document.createElement("form");
            form.className = "high-score-form";
            const input = document.createElement("input");
            input.type = "text";
            input.maxLength = 3;
            input.autocomplete = "off";
            input.inputMode = "text";
            input.placeholder = "ABC";
            input.setAttribute("aria-label", "Initials");
            const submit = document.createElement("button");
            submit.type = "submit";
            submit.textContent = "Save";
            submit.disabled = true;
            input.addEventListener("input", function onInput() {
                const clean = Pin.highScores ? Pin.highScores.normalizeInitials(input.value) : String(input.value || "").toUpperCase().slice(0, 3);
                input.value = clean;
                submit.disabled = clean.length !== 3;
            });
            form.addEventListener("submit", function onSubmit(event) {
                event.preventDefault();
                const clean = Pin.highScores ? Pin.highScores.normalizeInitials(input.value) : "";
                if (clean.length !== 3) return;
                if (Pin.highScores) Pin.highScores.add(table, clean, world.score);
                enterAttractMode("Saved. Press Play to start");
            });
            form.appendChild(input);
            form.appendChild(submit);
            panel.appendChild(title);
            panel.appendChild(score);
            panel.appendChild(form);
            highScoreOverlay.appendChild(panel);
            setTimeout(function focusInitials() { input.focus(); }, 0);
        }

        function handleGameOverHighScores() {
            /* What: Route game-over into save-or-show leaderboard state once.
             * Why: The render loop can see game_over for many frames.
             */
            if (handledGameOverScores) return;
            handledGameOverScores = true;
            if (Pin.highScores && Pin.highScores.qualifies(table, world.score)) {
                showInitialsEntry();
            } else {
                resetWorldForNextGame();
                showHighScores("Game over. Press Play to start");
            }
        }

        function resetWorldForNextGame() {
            /* What: Restore a staged, pre-launch game state.
             * Why: Between-game UI should be a real ready state, not a lingering game-over state.
             */
            world.balls = [Pin.ballLifecycle.makeLaunchBall(world)];
            world.currentBall = 1;
            world.ballsRemaining = table.rules.balls;
            world.score = 0;
            world.state = "ready";
            resetLaunchControl();
            playedGameOverSound = false;
            handledGameOverScores = false;
            setLaunchButtonMode("Play");
        }

        function enterAttractMode(message) {
            resetWorldForNextGame();
            showHighScores(message || "Press Play to start");
        }

        function restartGame() {
            /* What: Reset play state for a new local game.
             * Why: Restart should return to attract-mode high scores until launch.
             */
            if (Pin.audio) Pin.audio.restart();
            enterAttractMode("Press Play to start");
        }

        function onKeyDown(e) {
            if (isTextEntryTarget(e.target)) return;
            Pin.audio.ensure();
            setFlipperControl(e.code, true);
            if (e.code === "ArrowLeft" || e.code === "ArrowRight" || e.code === "Space") e.preventDefault();
            if (e.code === "Space") {
                if (highScoresAreVisible() || world.state === "game_over") {
                    startFromPlayPrompt();
                    return;
                }
                world.launchCharging = true;
                world.launchStart = performance.now();
            }
            if (e.code === "KeyD") {
                location.hash = "#design&t=" + Pin.storage.url.encode(world.table);
            }
            if (e.code === "KeyH") {
                e.preventDefault();
                setControlsHidden(!controlsHidden);
            }
            if (e.code === "KeyR") {
                restartGame();
            }
        }
        function onKeyUp(e) {
            if (isTextEntryTarget(e.target)) return;
            setFlipperControl(e.code, false);
            if (e.code === "Space" && world.launchCharging) launchBall();
        }

        let last = performance.now();
        let accumulator = 0;
        const fixedDt = 1 / 120;
        let perfLastLog = performance.now();
        const qualityController = (Pin.performance && Pin.performance.createAdaptiveQualityController) ?
            Pin.performance.createAdaptiveQualityController() :
            null;
        function frame(now) {
            if (!running) return;
            const frameDt = Math.min(0.08, (now - last) / 1000);
            last = now;
            accumulator = Math.min(0.12, accumulator + frameDt);
            if (Pin.render && Pin.render.setQuality) {
                const quality = qualityController ?
                    qualityController.sample({
                        now: now,
                        frameDt: frameDt,
                        backlogSteps: accumulator / fixedDt
                    }) :
                    { glowScale: 1, reducedEffects: false };
                Pin.render.setQuality(quality);
            }
            while (accumulator >= fixedDt) {
                world.lastPhysicsDt = fixedDt;
                refreshRuntime(world);
                const physicsStartedAt = perfStart();
                Pin.physics.stepWorld(world, fixedDt);
                perfEnd("stepWorld", physicsStartedAt);
                if (Pin.events) Pin.events.processRules(world, fixedDt);
                accumulator -= fixedDt;
            }
            const lifecycle = Pin.ballLifecycle.update(world);
            if (lifecycle.drained && Pin.audio) Pin.audio.drain();
            if (world.state === "game_over" && !playedGameOverSound) {
                if (Pin.audio) Pin.audio.gameOver();
                playedGameOverSound = true;
            }
            if (world.state === "game_over") handleGameOverHighScores();
            const renderStartedAt = perfStart();
            Pin.render.renderWorld(ctx, world);
            perfEnd("renderWorld", renderStartedAt);
            if (world.state === "game_over") {
                ctx.save();
                ctx.fillStyle = "rgba(0,0,0,0.65)";
                ctx.fillRect(0, 0, table.playfield.width, table.playfield.height);
                ctx.fillStyle = "#ff4444";
                ctx.font = 'bold 32px "Courier New"';
                ctx.fillText("GAME OVER", 160, 380);
                ctx.fillStyle = "#dddddd";
                ctx.font = '14px "Courier New"';
                ctx.fillText("Press Play to restart or D for design", 85, 420);
                ctx.restore();
            }
            if (now - perfLastLog > 1500) {
                flushPerf();
                perfLastLog = now;
            }
            frameRaf = requestAnimationFrame(frame);
        }
        const leftButtonDown = onFlipperButtonDown.bind(null, "left", leftButton);
        const leftButtonUp = onFlipperButtonUp.bind(null, "left", leftButton);
        const rightButtonDown = onFlipperButtonDown.bind(null, "right", rightButton);
        const rightButtonUp = onFlipperButtonUp.bind(null, "right", rightButton);

        window.addEventListener("resize", fitPlayCanvas);
        window.addEventListener("keydown", onKeyDown);
        window.addEventListener("keyup", onKeyUp);
        canvas.addEventListener("pointerdown", onPointerDown);
        canvas.addEventListener("pointerup", endPointer);
        canvas.addEventListener("pointercancel", endPointer);
        canvas.addEventListener("lostpointercapture", endPointer);
        leftButton.addEventListener("pointerdown", leftButtonDown);
        leftButton.addEventListener("pointerup", leftButtonUp);
        leftButton.addEventListener("pointercancel", leftButtonUp);
        leftButton.addEventListener("lostpointercapture", leftButtonUp);
        rightButton.addEventListener("pointerdown", rightButtonDown);
        rightButton.addEventListener("pointerup", rightButtonUp);
        rightButton.addEventListener("pointercancel", rightButtonUp);
        rightButton.addEventListener("lostpointercapture", rightButtonUp);
        launchButton.addEventListener("pointerdown", onLaunchButtonDown);
        launchButton.addEventListener("pointerup", onLaunchButtonUp);
        launchButton.addEventListener("pointercancel", onLaunchButtonUp);
        launchButton.addEventListener("lostpointercapture", onLaunchButtonUp);
        root._pinballCleanup = function cleanupPlay() {
            running = false;
            if (frameRaf) {
                cancelAnimationFrame(frameRaf);
                frameRaf = 0;
            }
            if (fitRaf) {
                cancelAnimationFrame(fitRaf);
                fitRaf = 0;
            }
            window.removeEventListener("resize", fitPlayCanvas);
            window.removeEventListener("keydown", onKeyDown);
            window.removeEventListener("keyup", onKeyUp);
            canvas.removeEventListener("pointerdown", onPointerDown);
            canvas.removeEventListener("pointerup", endPointer);
            canvas.removeEventListener("pointercancel", endPointer);
            canvas.removeEventListener("lostpointercapture", endPointer);
            leftButton.removeEventListener("pointerdown", leftButtonDown);
            leftButton.removeEventListener("pointerup", leftButtonUp);
            leftButton.removeEventListener("pointercancel", leftButtonUp);
            leftButton.removeEventListener("lostpointercapture", leftButtonUp);
            rightButton.removeEventListener("pointerdown", rightButtonDown);
            rightButton.removeEventListener("pointerup", rightButtonUp);
            rightButton.removeEventListener("pointercancel", rightButtonUp);
            rightButton.removeEventListener("lostpointercapture", rightButtonUp);
            launchButton.removeEventListener("pointerdown", onLaunchButtonDown);
            launchButton.removeEventListener("pointerup", onLaunchButtonUp);
            launchButton.removeEventListener("pointercancel", onLaunchButtonUp);
            launchButton.removeEventListener("lostpointercapture", onLaunchButtonUp);
            world.controls.left = false;
            world.controls.right = false;
            world.launchCharging = false;
        };
        setLaunchButtonMode("Play");
        showHighScores("Press Play to start");
        fitRaf = requestAnimationFrame(fitPlayCanvas);
        frameRaf = requestAnimationFrame(frame);
    }

    function tableSelectorHref(mode, entry) {
        /* What: Build a route for either a bundled file or a local saved table.
         * Why: bundled cards should stay small by referencing files, while local
         * saves need embedded table data because they have no static URL.
         */
        if (entry && entry.ref) return "#" + mode + "&table=" + encodeURIComponent(entry.ref);
        return "#" + mode + "&t=" + Pin.storage.url.encode(entry.table);
    }

    function tableElementCount(table) {
        /* What: Count visible authoring objects for selector metadata.
         * Why: cards need a cheap signal for table complexity without opening it.
         */
        return table && Array.isArray(table.elements) ? table.elements.length : 0;
    }

    function drawSelectorPreview(canvas, table, tableAssetBaseHref) {
        /* What: Render a static table thumbnail into a small canvas.
         * Why: geometry previews should be generated in-browser instead of saved
         * as separate PNG/JPG assets that can clash with playfield art filenames.
         */
        const pf = table.playfield || Pin.table.DEFAULT_PLAYFIELD;
        const dpr = Math.max(1, Math.min(2, window.devicePixelRatio || 1));
        const previewWidth = 240;
        const scale = Math.max(0.1, previewWidth / Math.max(1, pf.width || previewWidth));
        const width = Math.max(1, Math.round((pf.width || previewWidth) * scale * dpr));
        const height = Math.max(1, Math.round((pf.height || 360) * scale * dpr));
        const ctx = canvas.getContext("2d");
        let cancelled = false;
        let redrawRaf = 0;

        canvas.width = width;
        canvas.height = height;
        canvas.style.aspectRatio = String(pf.width || previewWidth) + " / " + String(pf.height || 360);

        function scheduleRedraw() {
            if (cancelled || redrawRaf) return;
            redrawRaf = requestAnimationFrame(function redraw() {
                redrawRaf = 0;
                render();
            });
        }

        function render() {
            if (cancelled) return;
            ctx.setTransform(1, 0, 0, 1, 0, 0);
            ctx.clearRect(0, 0, canvas.width, canvas.height);
            ctx.setTransform(scale * dpr, 0, 0, scale * dpr, 0, 0);
            const world = createWorld(table, { tableAssetBaseHref: tableAssetBaseHref || "" });
            world.balls = [];
            Pin.render.renderWorld(ctx, world, {
                designMode: true,
                showHud: false,
                showCabinet: false,
                skipStaticCache: true,
                onImageReady: scheduleRedraw
            });
        }

        render();
        return function cancelPreview() {
            cancelled = true;
            if (redrawRaf) cancelAnimationFrame(redrawRaf);
        };
    }

    function appendSelectorActions(actions, entry) {
        /* What: Add the table entry commands used by each selector card.
         * Why: selector cards should offer the three existing workspaces without
         * duplicating table loading code.
         */
        [
            { label: "Play", mode: "play" },
            { label: "Edit", mode: "design" },
            { label: "Logic", mode: "logic" }
        ].forEach(function each(action) {
            const link = document.createElement("a");
            link.className = "table-card-action";
            link.href = tableSelectorHref(action.mode, entry);
            link.textContent = action.label;
            actions.appendChild(link);
        });
    }

    function renderLoadedSelectorCard(card, entry, table, validation, tableAssetBaseHref, addPreviewDisposer) {
        /* What: Replace a loading selector card with table metadata and preview.
         * Why: each table fetch resolves independently, so one bad file should
         * not block the rest of the catalog.
         */
        const safeTable = validation.ok ? table : Pin.table.createEmptyTable();
        const displayTable = table || safeTable;
        card.innerHTML = "";
        card.classList.toggle("table-card-invalid", !validation.ok);

        const preview = document.createElement("div");
        preview.className = "table-card-preview";
        const canvas = document.createElement("canvas");
        preview.appendChild(canvas);
        card.appendChild(preview);
        addPreviewDisposer(drawSelectorPreview(canvas, safeTable, tableAssetBaseHref));

        const body = document.createElement("div");
        body.className = "table-card-body";
        const title = document.createElement("h2");
        title.textContent = displayTable.name || entry.label || "Untitled Table";
        const meta = document.createElement("div");
        meta.className = "table-card-meta";
        meta.textContent = String(tableElementCount(safeTable)) + " elements · " +
            String(safeTable.playfield.width) + " x " + String(safeTable.playfield.height);
        const status = document.createElement("div");
        status.className = validation.ok ? "table-card-status" : "table-card-status error";
        status.textContent = validation.ok ? "Ready" : "Invalid table";
        const actions = document.createElement("div");
        actions.className = "table-card-actions";
        if (validation.ok) appendSelectorActions(actions, Object.assign({}, entry, { table: safeTable }));

        body.appendChild(title);
        body.appendChild(meta);
        body.appendChild(status);
        body.appendChild(actions);
        card.appendChild(body);
    }

    function renderFailedSelectorCard(card, entry, message) {
        /* What: Show an individual catalog loading failure.
         * Why: a missing file should be visible without hiding usable tables.
         */
        card.innerHTML = "";
        card.classList.add("table-card-invalid");
        const body = document.createElement("div");
        body.className = "table-card-body";
        const title = document.createElement("h2");
        title.textContent = entry.label || entry.ref || "Table";
        const status = document.createElement("div");
        status.className = "table-card-status error";
        status.textContent = message || "Unable to load";
        body.appendChild(title);
        body.appendChild(status);
        card.appendChild(body);
    }

    function loadSelectorEntry(entry) {
        /* What: Load and normalize one bundled catalog entry.
         * Why: selector thumbnails use the same table contracts as play/design.
         */
        return loadTableFromRef(entry.ref).then(function loaded(result) {
            const table = Pin.table.normalizeTable(result.table);
            return {
                table: table,
                validation: Pin.table.validateTable(table),
                tableAssetBaseHref: result.tableAssetBaseHref || ""
            };
        });
    }

    function appendLocalSelectorCard(grid, slot, label, addPreviewDisposer) {
        /* What: Add a card for an in-browser saved table when it exists.
         * Why: autosave and slot data are useful selector entries but cannot be
         * represented by static file paths.
         */
        const saved = Pin.storage.local.load(slot);
        if (!saved) return;
        const table = Pin.table.normalizeTable(saved);
        const validation = Pin.table.validateTable(table);
        const card = document.createElement("article");
        card.className = "table-card table-card-local";
        renderLoadedSelectorCard(card, { label: label, table: table }, table, validation, "", addPreviewDisposer);
        grid.insertBefore(card, grid.firstChild);
    }

    function mountTableSelector(root) {
        /* What: Mount the bundled table picker.
         * Why: users need a visual entrypoint for choosing among static tables.
         */
        if (typeof root._pinballCleanup === "function") root._pinballCleanup();
        root.innerHTML = "";
        let disposed = false;
        const previewDisposers = [];
        const addPreviewDisposer = function addPreviewDisposer(dispose) {
            if (typeof dispose === "function") previewDisposers.push(dispose);
        };

        const wrap = document.createElement("main");
        wrap.className = "table-selector";
        const header = document.createElement("header");
        header.className = "table-selector-header";
        const title = document.createElement("h1");
        title.textContent = "Tables";
        const sub = document.createElement("p");
        sub.textContent = "Choose a table to play, edit, or wire in Logic Studio.";
        header.appendChild(title);
        header.appendChild(sub);
        wrap.appendChild(header);

        if (location.protocol === "file:") {
            const warning = document.createElement("div");
            warning.className = "table-selector-warning";
            warning.textContent = "Bundled table browsing needs a local HTTP server. Local autosaves can still appear here.";
            wrap.appendChild(warning);
        }

        const grid = document.createElement("section");
        grid.className = "table-card-grid";
        wrap.appendChild(grid);
        root.appendChild(wrap);

        appendLocalSelectorCard(grid, "slot1", "Slot 1", addPreviewDisposer);
        appendLocalSelectorCard(grid, "autosave", "Autosave", addPreviewDisposer);

        const entries = (Pin.tableCatalog && Array.isArray(Pin.tableCatalog.tables)) ? Pin.tableCatalog.tables : [];
        if (location.protocol !== "file:") {
            entries.forEach(function each(entry) {
                const card = document.createElement("article");
                card.className = "table-card";
                const loading = document.createElement("div");
                loading.className = "table-card-loading";
                loading.textContent = entry.label || entry.ref || "Loading table";
                card.appendChild(loading);
                grid.appendChild(card);
                loadSelectorEntry(entry).then(function loaded(result) {
                    if (disposed) return;
                    renderLoadedSelectorCard(card, entry, result.table, result.validation, result.tableAssetBaseHref, addPreviewDisposer);
                }).catch(function failed(err) {
                    if (disposed) return;
                    renderFailedSelectorCard(card, entry, err && err.message ? err.message : "Unable to load");
                });
            });
        }

        if (!grid.children.length) {
            const empty = document.createElement("div");
            empty.className = "table-selector-empty";
            empty.textContent = "No tables are available.";
            grid.appendChild(empty);
        }

        root._pinballCleanup = function cleanupSelector() {
            disposed = true;
            while (previewDisposers.length) previewDisposers.pop()();
        };
    }

    function isAbsoluteUrl(value) {
        return /^[a-z][a-z0-9+.-]*:/i.test(value || "");
    }

    function normalizeTableRef(rawRef) {
        if (!rawRef) return "";
        let ref = String(rawRef).trim();
        if (
            (ref[0] === "\"" && ref[ref.length - 1] === "\"") ||
            (ref[0] === "'" && ref[ref.length - 1] === "'")
        ) {
            ref = ref.slice(1, -1).trim();
        }
        if (!ref) return "";
        if (!/^[a-z][a-z0-9+.-]*:/i.test(ref) && ref[0] !== "/" && ref.indexOf("/") < 0) {
            ref = "tables/" + ref;
        }
        if (!/\.[a-z0-9]+$/i.test(ref)) ref += ".json";
        return ref;
    }

    function tableRefFromParsed(parsed) {
        const kv = (parsed && parsed.kv) || {};
        return kv.table || kv.tableName || kv.name || "";
    }

    function toSameOriginJsonUrl(rawRef) {
        const ref = normalizeTableRef(rawRef);
        if (!ref) return null;
        if (isAbsoluteUrl(ref)) {
            try {
                const absolute = new URL(ref);
                if (absolute.origin !== location.origin) return null;
                if (!/\.json$/i.test(absolute.pathname)) return null;
                return absolute;
            } catch (err) {
                return null;
            }
        }
        try {
            const resolved = new URL(ref, location.href);
            if (resolved.origin !== location.origin) return null;
            if (!/\.json$/i.test(resolved.pathname)) return null;
            return resolved;
        } catch (err) {
            return null;
        }
    }

    function tableBaseHref(url) {
        const href = String(url && url.href ? url.href : "");
        const index = href.lastIndexOf("/");
        if (index < 0) return "";
        return href.slice(0, index + 1);
    }

    function loadTableFromRef(rawRef) {
        if (location.protocol === "file:") {
            return Promise.reject(new Error("Table URL loading is unavailable from file:// origin."));
        }
        const url = toSameOriginJsonUrl(rawRef);
        if (!url) return Promise.reject(new Error("Invalid table reference: " + rawRef));
        return fetch(url.href).then(function parseResponse(response) {
            if (!response.ok) throw new Error("Failed to load table: " + url.href);
            return response.json();
        }).then(function buildResult(table) {
            return {
                table: table,
                tableAssetBaseHref: tableBaseHref(url)
            };
        });
    }

    function loadInitialTable(parsed) {
        const tableRef = tableRefFromParsed(parsed);
        const hasExplicitEmbeddedTable = !!parsed.kv.t;
        const hasExplicitTableRef = !!tableRef;
        const hasExplicitTableRequest = hasExplicitEmbeddedTable || hasExplicitTableRef;
        if (parsed.kv.t) {
            try {
                return Promise.resolve({
                    table: Pin.storage.url.decode(parsed.kv.t),
                    tableAssetBaseHref: "",
                    explicitSource: true
                });
            } catch (e) {
                return Promise.reject(new Error("Failed to decode embedded table URL parameter."));
            }
        }
        if (tableRef && location.protocol !== "file:") {
            return loadTableFromRef(tableRef).catch(function explicitTableRefFailed(err) {
                throw new Error("Failed to load requested table '" + tableRef + "'. " + (err && err.message ? err.message : ""));
            }).then(function afterTableRef(result) {
                if (result) {
                    result.explicitSource = true;
                    return result;
                }
                const fromLocal = Pin.storage.local.load(localStorage.getItem("pin.lastSlot") || "autosave");
                if (fromLocal) return { table: fromLocal, tableAssetBaseHref: "" };
                if (location.protocol === "file:") {
                    return { table: Pin.table.cloneTable(Pin.presets.cyberpin || Pin.table.createEmptyTable()), tableAssetBaseHref: "" };
                }
                return fetch("tables/DefTable.json")
                    .then(function parseResponse(response) {
                        if (!response.ok) throw new Error("Failed to load tables/DefTable.json");
                        return response.json();
                    })
                    .then(function asResult(table) {
                        return { table: table, tableAssetBaseHref: "" };
                    })
                    .catch(function fallback() {
                        return { table: Pin.table.cloneTable(Pin.presets.cyberpin || Pin.table.createEmptyTable()), tableAssetBaseHref: "" };
                    });
            });
        }
        if (hasExplicitTableRef && location.protocol === "file:") {
            return Promise.reject(new Error("Table URL loading is unavailable from file:// origin."));
        }
        const fromLocal = hasExplicitTableRequest ? null : Pin.storage.local.load(localStorage.getItem("pin.lastSlot") || "autosave");
        if (fromLocal) return Promise.resolve({ table: fromLocal, tableAssetBaseHref: "" });
        if (location.protocol === "file:") {
            return Promise.resolve({ table: Pin.table.cloneTable(Pin.presets.cyberpin || Pin.table.createEmptyTable()), tableAssetBaseHref: "" });
        }
        return fetch("tables/DefTable.json")
            .then(function parseResponse(response) {
                if (!response.ok) throw new Error("Failed to load tables/DefTable.json");
                return response.json();
            })
            .then(function asResult(table) {
                return { table: table, tableAssetBaseHref: "" };
            })
            .catch(function fallback() {
                return { table: Pin.table.cloneTable(Pin.presets.cyberpin || Pin.table.createEmptyTable()), tableAssetBaseHref: "" };
            });
    }

    function showBootError(root, message) {
        if (!root) return;
        root.innerHTML = "";
        const wrap = document.createElement("div");
        wrap.className = "play-mode";
        const panel = document.createElement("div");
        panel.className = "high-score-panel high-score-entry";
        const title = document.createElement("div");
        title.className = "high-score-title";
        title.textContent = "Unable to load table";
        const subtitle = document.createElement("div");
        subtitle.className = "high-score-subtitle";
        subtitle.textContent = String(message || "The requested table could not be loaded.");
        panel.appendChild(title);
        panel.appendChild(subtitle);
        wrap.appendChild(panel);
        root.appendChild(wrap);
    }

    function boot() {
        const root = document.getElementById("app");
        const token = ++bootToken;
        if (typeof root._pinballCleanup === "function") root._pinballCleanup();
        const parsed = parseHash();
        const hasExplicitRoute = !!(location.hash || parsed.kv.t || tableRefFromParsed(parsed));
        if (parsed.mode === "tables" || !hasExplicitRoute) {
            mountTableSelector(root);
            return;
        }
        Promise.resolve(loadInitialTable(parsed)).then(function mountLoadedTable(loaded) {
            if (token !== bootToken) return;
            if (Pin.render && Pin.render.clearImageCache) Pin.render.clearImageCache();
            const table = loaded && loaded.table ? loaded.table : loaded;
            const normalizedTable = Pin.table.normalizeTable(table);
            const validation = Pin.table.validateTable(normalizedTable);
            if (!validation.ok && loaded && loaded.explicitSource) {
                showBootError(root, "The requested table is invalid.");
                return;
            }
            const safeTable = validation.ok ? normalizedTable : Pin.table.createEmptyTable();
            if (parsed.mode === "design") {
                Pin.editor.mountEditor(root, {
                    table: safeTable,
                    selected: null,
                    undo: [],
                    tableAssetBaseHref: loaded && loaded.tableAssetBaseHref ? loaded.tableAssetBaseHref : ""
                });
            } else if (parsed.mode === "logic" || parsed.mode === "logicstudio") {
                Pin.logicPage.mount(root, { table: safeTable, tableAssetBaseHref: loaded && loaded.tableAssetBaseHref ? loaded.tableAssetBaseHref : "" });
            } else {
                mountPlay(root, safeTable, { tableAssetBaseHref: loaded && loaded.tableAssetBaseHref ? loaded.tableAssetBaseHref : "" });
            }
        }).catch(function onBootFailure(err) {
            if (token !== bootToken) return;
            console.warn("Failed to bootstrap requested table.", err);
            showBootError(root, err && err.message ? err.message : "The requested table could not be loaded.");
        });
    }

    window.addEventListener("hashchange", boot);
    boot();
})(window.Pin);
