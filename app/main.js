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

    function parseHash() {
        const hash = (location.hash || "#play").replace(/^#/, "");
        const parts = hash.split("&");
        const mode = parts[0] || "play";
        const kv = {};
        parts.slice(1).forEach(function each(part) {
            const chunks = part.split("=");
            kv[chunks[0]] = chunks.slice(1).join("=");
        });
        return { mode: mode, kv: kv };
    }

    function createWorld(table) {
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
            controls: {
                left: false,
                right: false
            },
            elementState: {}
        };
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
        world.staticBroadPhase = Pin.physics.buildBroadPhase(world.staticSegments, world.staticCircles, world.table.playfield);
    }

    function refreshRuntime(world) {
        const startedAt = perfStart();
        const dynamicRuntime = Pin.elements.compileElements(world.table, world, { static: false });
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
        world.runtime = runtime;
        world.runtimeSegments = runtime.segments;
        world.runtimeCircles = runtime.circles;
        world.runtimeRamps = runtime.ramps;
        world.runtimeSensors = runtime.sensors;
        perfEnd("refreshRuntime", startedAt);
    }

    function mountPlay(root, table) {
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
        const world = createWorld(table);
        let playedGameOverSound = false;
        let frameRaf = 0;
        let fitRaf = 0;
        let running = true;
        const activePointers = {};
        let launchButtonPointerId = null;

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

        function launchBall() {
            const ball = world.balls.find(function findBall(b) { return b.inLaunchLane; }) || world.balls[0];
            if (!ball) return;
            Pin.physics.releaseLauncher(world);
            if (Pin.audio) Pin.audio.launch();
            world.launchCharging = false;
            world.state = "playing";
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

        function onKeyDown(e) {
            Pin.audio.ensure();
            setFlipperControl(e.code, true);
            if (e.code === "ArrowLeft" || e.code === "ArrowRight" || e.code === "Space") e.preventDefault();
            if (e.code === "Space") {
                world.launchCharging = true;
                world.launchStart = performance.now();
            }
            if (e.code === "KeyD") {
                location.hash = "#design&t=" + Pin.storage.url.encode(world.table);
            }
            if (e.code === "KeyR") {
                if (Pin.audio) Pin.audio.restart();
                world.balls = [Pin.ballLifecycle.makeLaunchBall(world)];
                world.currentBall = 1;
                world.ballsRemaining = table.rules.balls;
                world.score = 0;
                world.state = "ready";
                playedGameOverSound = false;
            }
        }
        function onKeyUp(e) {
            setFlipperControl(e.code, false);
            if (e.code === "Space" && world.launchCharging) launchBall();
        }

        let last = performance.now();
        let accumulator = 0;
        const fixedDt = 1 / 120;
        let perfLastLog = performance.now();
        let lowQualityFrames = 0;
        function frame(now) {
            if (!running) return;
            const frameDt = Math.min(0.08, (now - last) / 1000);
            last = now;
            accumulator = Math.min(0.12, accumulator + frameDt);
            if (frameDt > 0.025 || accumulator > fixedDt * 2) {
                lowQualityFrames = 8;
            } else if (lowQualityFrames > 0) {
                lowQualityFrames -= 1;
            }
            if (Pin.render && Pin.render.setQuality) {
                Pin.render.setQuality({
                    glowScale: lowQualityFrames > 0 ? 0.65 : 1
                });
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
                ctx.fillText("Press R to restart or D for design", 100, 420);
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
        fitRaf = requestAnimationFrame(fitPlayCanvas);
        frameRaf = requestAnimationFrame(frame);
    }

    function loadInitialTable(parsed) {
        if (parsed.kv.t) {
            try { return Pin.storage.url.decode(parsed.kv.t); } catch (e) {}
        }
        const fromLocal = Pin.storage.local.load(localStorage.getItem("pin.lastSlot") || "autosave");
        if (fromLocal) return Promise.resolve(fromLocal);
        return fetch("tables/DefTable.json")
            .then(function parseResponse(response) {
                if (!response.ok) throw new Error("Failed to load tables/DefTable.json");
                return response.json();
            })
            .catch(function fallback() {
                return Pin.table.cloneTable(Pin.presets.cyberpin || Pin.table.createEmptyTable());
            });
    }

    function boot() {
        const root = document.getElementById("app");
        const token = ++bootToken;
        if (typeof root._pinballCleanup === "function") root._pinballCleanup();
        const parsed = parseHash();
        Promise.resolve(loadInitialTable(parsed)).then(function mountLoadedTable(table) {
            if (token !== bootToken) return;
            const normalizedTable = Pin.table.normalizeTable(table);
            const validation = Pin.table.validateTable(normalizedTable);
            const safeTable = validation.ok ? normalizedTable : Pin.table.createEmptyTable();
            if (parsed.mode === "design") {
                Pin.editor.mountEditor(root, { table: safeTable, selected: null, undo: [] });
            } else {
                mountPlay(root, safeTable);
            }
        });
    }

    window.addEventListener("hashchange", boot);
    boot();
})(window.Pin);
