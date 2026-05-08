(function initRenderer(Pin) {
    const quality = {
        glowScale: 1,
        reducedEffects: false
    };
    const imageCache = {};
    const staticCache = {
        canvas: null,
        ctx: null,
        width: 0,
        height: 0,
        tableRef: null,
        designMode: false,
        glowScale: 1,
        reducedEffects: false,
        dirty: true
    };
    
    function createImageEntry(src) {
        const image = new Image();
        const entry = {
            image: image,
            ready: false,
            error: false,
            listeners: []
        };
        image.onload = function onload() {
            entry.ready = true;
            entry.error = false;
            const listeners = entry.listeners.slice();
            entry.listeners.length = 0;
            listeners.forEach(function each(fn) { try { fn(); } catch (e) {} });
        };
        image.onerror = function onerror() {
            entry.error = true;
            entry.ready = false;
            const listeners = entry.listeners.slice();
            entry.listeners.length = 0;
            listeners.forEach(function each(fn) { try { fn(); } catch (e) {} });
        };
        image.src = src;
        return entry;
    }

    function clamp(value, min, max) {
        return Math.max(min, Math.min(max, value));
    }

    function roundRect(ctx, x, y, w, h, r) {
        const radius = Math.max(0, Math.min(r, Math.min(w, h) * 0.5));
        ctx.beginPath();
        ctx.moveTo(x + radius, y);
        ctx.arcTo(x + w, y, x + w, y + h, radius);
        ctx.arcTo(x + w, y + h, x, y + h, radius);
        ctx.arcTo(x, y + h, x, y, radius);
        ctx.arcTo(x, y, x + w, y, radius);
        ctx.closePath();
    }

    function makeGlow(ctx, color, blur) {
        if (quality.reducedEffects) {
            ctx.shadowColor = "rgba(0,0,0,0)";
            ctx.shadowBlur = 0;
            return;
        }
        ctx.shadowColor = color;
        ctx.shadowBlur = Math.max(0, blur * (quality.glowScale || 1));
    }

    function getImageLayer(src, onReady) {
        if (!src || typeof Image === "undefined") return null;
        let entry = imageCache[src];
        if (!entry) {
            entry = imageCache[src] = createImageEntry(src);
        } else if (entry.error) {
            // Retry transient image failures when the same URL is requested again.
            entry = imageCache[src] = createImageEntry(src);
        }
        if (onReady && !entry.ready && !entry.error && entry.listeners.indexOf(onReady) < 0) {
            entry.listeners.push(onReady);
        }
        return entry;
    }

    function shouldDrawLayer(layer, designMode) {
        const mode = (layer && layer.mode) || "both";
        if (mode === "both") return true;
        if (mode === "play") return !designMode;
        if (mode === "design") return !!designMode;
        return true;
    }

    function resolveImageSrc(src, world) {
        const raw = typeof src === "string" ? src.trim() : "";
        if (!raw) return raw;
        // Path semantics:
        // - scheme URLs and root paths are used as-is
        // - `tables/...` remains app-relative to preserve bundled table defaults
        // - any other relative path is resolved against the loaded table JSON directory
        if (/^[a-z][a-z0-9+.-]*:/i.test(raw) || raw[0] === "/" || raw.indexOf("tables/") === 0) return raw;
        const base = world && typeof world.tableAssetBaseHref === "string" ? world.tableAssetBaseHref : "";
        if (!base) return raw;
        try {
            return new URL(raw, base).href;
        } catch (err) {
            return raw;
        }
    }

    function drawImageLayer(ctx, layer, w, h, designMode, onReady, world) {
        if (!layer || !layer.src || !shouldDrawLayer(layer, designMode)) return;
        const resolvedSrc = resolveImageSrc(layer.src, world);
        const entry = getImageLayer(resolvedSrc, onReady);
        if (!entry || entry.error || !entry.ready || !entry.image || !entry.image.naturalWidth) return;
        const image = entry.image;
        const iw = image.naturalWidth || image.width;
        const ih = image.naturalHeight || image.height;
        if (!iw || !ih) return;
        const fit = layer.fit || "contain";
        const opacity = clamp(typeof layer.opacity === "number" ? layer.opacity : 1, 0, 1);
        const scale = typeof layer.scale === "number" ? layer.scale : 1;
        let dw = iw;
        let dh = ih;
        let dx = 0;
        let dy = 0;
        if (fit === "stretch") {
            dw = w;
            dh = h;
        } else {
            const baseScale = fit === "cover" ? Math.max(w / iw, h / ih) : Math.min(w / iw, h / ih);
            dw = iw * baseScale;
            dh = ih * baseScale;
            dx = (w - dw) * 0.5;
            dy = (h - dh) * 0.5;
        }
        if (fit === "none") {
            dw = iw;
            dh = ih;
            dx = (w - dw) * 0.5;
            dy = (h - dh) * 0.5;
        }
        dw *= scale;
        dh *= scale;
        dx += typeof layer.offsetX === "number" ? layer.offsetX : 0;
        dy += typeof layer.offsetY === "number" ? layer.offsetY : 0;
        ctx.save();
        ctx.globalAlpha = opacity;
        ctx.drawImage(image, dx, dy, dw, dh);
        ctx.restore();
    }

    function drawImageLayers(ctx, world, designMode, onReady) {
        const pf = world.table.playfield;
        const layers = (world.table && world.table.images) || [];
        layers.forEach(function each(layer) {
            drawImageLayer(ctx, layer, pf.width, pf.height, designMode, onReady, world);
        });
    }

    function drawBackground(ctx, w, h) {
        if (quality.reducedEffects) {
            ctx.fillStyle = "#070c18";
            ctx.fillRect(0, 0, w, h);
            return;
        }
        const gradient = ctx.createLinearGradient(0, 0, 0, h);
        gradient.addColorStop(0, "#0b1022");
        gradient.addColorStop(0.45, "#0b0f1a");
        gradient.addColorStop(1, "#05070d");
        ctx.fillStyle = gradient;
        ctx.fillRect(0, 0, w, h);

        const glowA = ctx.createRadialGradient(w * 0.25, h * 0.18, 12, w * 0.25, h * 0.18, w * 0.55);
        glowA.addColorStop(0, "rgba(0,180,255,0.2)");
        glowA.addColorStop(1, "rgba(0,180,255,0)");
        ctx.fillStyle = glowA;
        ctx.fillRect(0, 0, w, h);

        const glowB = ctx.createRadialGradient(w * 0.72, h * 0.28, 18, w * 0.72, h * 0.28, w * 0.48);
        glowB.addColorStop(0, "rgba(255,70,120,0.14)");
        glowB.addColorStop(1, "rgba(255,70,120,0)");
        ctx.fillStyle = glowB;
        ctx.fillRect(0, 0, w, h);

        ctx.save();
        ctx.strokeStyle = "rgba(110,140,220,0.08)";
        ctx.lineWidth = 1;
        for (let y = 84; y < h; y += 56) {
            ctx.beginPath();
            ctx.moveTo(18, y);
            ctx.lineTo(w - 18, y);
            ctx.stroke();
        }
        ctx.restore();
    }

    function drawCabinetFrame(ctx, w, h) {
        if (quality.reducedEffects) {
            ctx.save();
            ctx.strokeStyle = "rgba(45,55,90,0.42)";
            ctx.lineWidth = 3;
            roundRect(ctx, 10, 10, w - 20, h - 20, 16);
            ctx.stroke();
            ctx.restore();
            return;
        }
        ctx.save();
        const frame = ctx.createLinearGradient(0, 0, 0, h);
        frame.addColorStop(0, "rgba(51,67,120,0.3)");
        frame.addColorStop(1, "rgba(15,20,42,0.6)");
        ctx.strokeStyle = frame;
        ctx.lineWidth = 4;
        roundRect(ctx, 10, 10, w - 20, h - 20, 16);
        ctx.stroke();
        ctx.restore();
    }

    function drawBalls(ctx, balls) {
        balls.forEach(function drawBall(ball) {
            const lift = Math.max(0, ball.z || 0) * 0.18;
            const drawY = ball.y - lift;
            if (lift > 0) {
                ctx.save();
                ctx.fillStyle = "rgba(0,0,0,0.28)";
                ctx.beginPath();
                ctx.ellipse(ball.x, ball.y + 4, ball.radius * 1.05, Math.max(3, ball.radius * 0.45), 0, 0, Math.PI * 2);
                ctx.fill();
                ctx.restore();
            }
            ctx.save();
            if (quality.reducedEffects) {
                ctx.fillStyle = "#aeb8d2";
            } else {
                const grad = ctx.createRadialGradient(ball.x - 2, drawY - 3, ball.radius * 0.1, ball.x, drawY, ball.radius);
                grad.addColorStop(0, "#ffffff");
                grad.addColorStop(0.38, "#d8dff5");
                grad.addColorStop(1, "#3f4a6e");
                ctx.fillStyle = grad;
                makeGlow(ctx, "#88ccff", 10);
            }
            ctx.beginPath();
            ctx.arc(ball.x, drawY, ball.radius, 0, Math.PI * 2);
            ctx.fill();
            ctx.strokeStyle = "rgba(255,255,255,0.45)";
            ctx.lineWidth = 1;
            ctx.stroke();
            ctx.fillStyle = "rgba(255,255,255,0.75)";
            ctx.beginPath();
            ctx.arc(ball.x - 2, drawY - 3, ball.radius * 0.32, 0, Math.PI * 2);
            ctx.fill();
            ctx.restore();
        });
    }

    function drawHud(ctx, world) {
        world._hudCache = world._hudCache || { scoreRaw: null, scoreText: "0" };
        if (world._hudCache.scoreRaw !== world.score) {
            world._hudCache.scoreRaw = world.score;
            world._hudCache.scoreText = (world.score || 0).toLocaleString();
        }
        ctx.save();
        ctx.globalAlpha = 0.5;
        roundRect(ctx, 18, 14, 208, 46, 8);
        ctx.fillStyle = "rgba(14,16,24,0.94)";
        ctx.fill();
        ctx.strokeStyle = "rgba(71,75,92,0.9)";
        ctx.lineWidth = 2;
        ctx.stroke();
        ctx.fillStyle = "#ff7a18";
        makeGlow(ctx, "#ff5a00", 12);
        ctx.font = 'bold 22px "Courier New"';
        ctx.fillText("SCORE " + world._hudCache.scoreText, 30, 33);
        ctx.shadowBlur = 0;
        ctx.fillStyle = "#cfd3e3";
        ctx.font = '12px "Courier New"';
        ctx.fillText("BALL " + world.currentBall + "/" + world.table.rules.balls, 30, 50);
        if (world.ballsRemaining != null) {
            ctx.fillStyle = "#8c91a8";
            ctx.fillText("REMAIN " + world.ballsRemaining, 130, 50);
        }
        ctx.restore();
    }

    function drawLauncherFallback(ctx, world) {
        const launcher = Pin.physics && Pin.physics.getLauncherConfig ? Pin.physics.getLauncherConfig(world) : null;
        const x = launcher && launcher.x || 439;
        const top = launcher && launcher.top || 195;
        const bottom = launcher && launcher.bottom || 735;
        const width = launcher && launcher.width || 38;
        const left = x - width * 0.5;
        const launchT = world && world.launchCharging ? Math.max(0, Math.min(1, (performance.now() - world.launchStart) / 2000)) : 0;
        const plungerBaseY = bottom - 10;
        const plungerY = plungerBaseY - launchT * 65;
        const ballInLane = world && world.balls && world.balls.find(function findBall(ball) { return ball.inLaunchLane; });

        ctx.save();
        roundRect(ctx, left, top, width, bottom - top, 4);
        ctx.fillStyle = "rgba(20,22,45,0.8)";
        ctx.fill();
        ctx.strokeStyle = "rgba(120,140,220,0.6)";
        ctx.lineWidth = 2;
        ctx.stroke();

        ctx.strokeStyle = "rgba(110,120,150,0.9)";
        ctx.lineWidth = 2;
        ctx.setLineDash([5, 5]);
        ctx.beginPath();
        ctx.moveTo(x, plungerBaseY);
        ctx.lineTo(x, plungerY + 10);
        ctx.stroke();
        ctx.setLineDash([]);

        ctx.fillStyle = "#ee4444";
        makeGlow(ctx, "#ff2222", 12);
        ctx.beginPath();
        ctx.arc(x, plungerY, 10, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = "#ffffff";
        ctx.lineWidth = 2;
        ctx.stroke();

        ctx.fillStyle = "#2a2a38";
        roundRect(ctx, x - 9, bottom - 5, 18, 14, 4);
        ctx.fill();
        ctx.strokeStyle = "#555";
        ctx.lineWidth = 2;
        ctx.stroke();

        ctx.fillStyle = "rgba(200,220,255,0.75)";
        ctx.font = '16px "Courier New"';
        ctx.textAlign = "center";
        ctx.fillText("\u25b2", x, top + 22);
        if (ballInLane) {
            ctx.fillStyle = "rgba(255,255,255,0.12)";
            roundRect(ctx, left + 4, bottom - 54, width - 8, 30, 6);
            ctx.fill();
        }
        ctx.restore();
    }

    /*
     * Render the table world.
     * Why: play mode and editor mode share the same table rendering, but the
     * editor can suppress play-only chrome such as the HUD and cabinet frame.
     */
    function renderWorld(ctx, world, options) {
        const designMode = !!(options && options.designMode);
        const onReady = options && options.onImageReady;
        const showHud = !options || options.showHud !== false;
        const showCabinet = !options || options.showCabinet !== false;
        const pf = world.table.playfield;
        const dynamicTypeFn = Pin.elements && Pin.elements.isDynamicType;
        const canUseStaticCache = !!(!options || !options.skipStaticCache) && !!dynamicTypeFn;
        const cacheNeedsResize = staticCache.width !== pf.width || staticCache.height !== pf.height;
        const cacheSceneChanged =
            staticCache.tableRef !== world.table ||
            staticCache.designMode !== designMode ||
            staticCache.glowScale !== quality.glowScale ||
            staticCache.reducedEffects !== quality.reducedEffects;
        if (canUseStaticCache && (staticCache.dirty || cacheNeedsResize || cacheSceneChanged)) {
            if (!staticCache.canvas || cacheNeedsResize) {
                staticCache.canvas = document.createElement("canvas");
                staticCache.canvas.width = pf.width;
                staticCache.canvas.height = pf.height;
                staticCache.ctx = staticCache.canvas.getContext("2d");
            }
            const sc = staticCache.ctx;
            sc.clearRect(0, 0, pf.width, pf.height);
            drawBackground(sc, pf.width, pf.height);
            drawImageLayers(sc, world, designMode, function onStaticImageReady() {
                staticCache.dirty = true;
                if (typeof onReady === "function") onReady();
            });
            world.runtime.drawables.forEach(function drawEntry(entry) {
                if (!entry || !entry.module || !entry.element) return;
                if (dynamicTypeFn(entry.element.type)) return;
                if (entry.module.draw) entry.module.draw(sc, entry.element, entry.runtime, world, options || {});
            });
            staticCache.width = pf.width;
            staticCache.height = pf.height;
            staticCache.tableRef = world.table;
            staticCache.designMode = designMode;
            staticCache.glowScale = quality.glowScale;
            staticCache.reducedEffects = quality.reducedEffects;
            staticCache.dirty = false;
        }
        if (canUseStaticCache && staticCache.canvas) {
            ctx.drawImage(staticCache.canvas, 0, 0);
        } else {
            drawBackground(ctx, pf.width, pf.height);
            drawImageLayers(ctx, world, designMode, onReady, world);
            world.runtime.drawables.forEach(function drawEntry(entry) {
                if (entry.module.draw) entry.module.draw(ctx, entry.element, entry.runtime, world, options || {});
            });
        }
        if (!(world.table.elements || []).some(function hasLauncher(el) { return el.type === "launcher"; })) {
            drawLauncherFallback(ctx, world);
        }
        world.runtime.drawables.forEach(function drawEntry(entry) {
            if (!canUseStaticCache || !dynamicTypeFn(entry.element.type)) return;
            if (entry.module.draw) entry.module.draw(ctx, entry.element, entry.runtime, world, options || {});
        });
        drawBalls(ctx, world.balls);
        if (showHud) drawHud(ctx, world);
        if (showCabinet) drawCabinetFrame(ctx, pf.width, pf.height);
    }

    function clearImageCache() {
        Object.keys(imageCache).forEach(function each(key) {
            delete imageCache[key];
        });
        staticCache.dirty = true;
        staticCache.tableRef = null;
    }

    Pin.render = {
        renderWorld: renderWorld,
        roundRect: roundRect,
        makeGlow: makeGlow,
        getImageLayer: getImageLayer,
        drawImageLayer: drawImageLayer,
        clearImageCache: clearImageCache,
        setQuality: function setQuality(next) {
            if (!next) return;
            let changed = false;
            if (typeof next.glowScale === "number" && Number.isFinite(next.glowScale)) {
                const glowScale = Math.max(0, Math.min(1, next.glowScale));
                if (quality.glowScale !== glowScale) {
                    quality.glowScale = glowScale;
                    changed = true;
                }
            }
            if (typeof next.reducedEffects === "boolean") {
                if (quality.reducedEffects !== next.reducedEffects) {
                    quality.reducedEffects = next.reducedEffects;
                    changed = true;
                }
            }
            if (changed) staticCache.dirty = true;
        }
    };
})(window.Pin);
