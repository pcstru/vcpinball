(function initEditorHitTest(Pin) {
    function pointInRect(x, y, cx, cy, w, h) {
        return x >= cx - w * 0.5 && x <= cx + w * 0.5 && y >= cy - h * 0.5 && y <= cy + h * 0.5;
    }

    function rotatePoint(cx, cy, x, y, angle) {
        const c = Math.cos(angle || 0);
        const s = Math.sin(angle || 0);
        return {
            x: cx + x * c - y * s,
            y: cy + x * s + y * c
        };
    }

    function getRectCorners(cx, cy, w, h, angle) {
        return [
            rotatePoint(cx, cy, -w * 0.5, -h * 0.5, angle),
            rotatePoint(cx, cy, w * 0.5, -h * 0.5, angle),
            rotatePoint(cx, cy, w * 0.5, h * 0.5, angle),
            rotatePoint(cx, cy, -w * 0.5, h * 0.5, angle)
        ];
    }

    function pointInRotatedRect(x, y, cx, cy, w, h, angle) {
        const c = Math.cos(-(angle || 0));
        const s = Math.sin(-(angle || 0));
        const dx = x - cx;
        const dy = y - cy;
        const localX = dx * c - dy * s;
        const localY = dx * s + dy * c;
        return pointInRect(localX, localY, 0, 0, w, h);
    }

    function worldToLocal(x, y, cx, cy, angle) {
        const c = Math.cos(-(angle || 0));
        const s = Math.sin(-(angle || 0));
        const dx = x - cx;
        const dy = y - cy;
        return {
            x: dx * c - dy * s,
            y: dx * s + dy * c
        };
    }

    function lineEndpoints(cx, cy, length, angle) {
        const half = length * 0.5;
        return {
            x1: cx - Math.cos(angle || 0) * half,
            y1: cy - Math.sin(angle || 0) * half,
            x2: cx + Math.cos(angle || 0) * half,
            y2: cy + Math.sin(angle || 0) * half
        };
    }

    /* What: Resolve spinner blade radius from the current schema.
     * Why: Editor handles should match runtime spinner geometry.
     */
    function spinnerRadius(el) {
        if (el && typeof el.radius === "number") return el.radius;
        return 30;
    }

    function spinnerBladeSegments(el, angle) {
        const radius = spinnerRadius(el);
        return [
            lineEndpoints(el.x, el.y, radius * 2, angle || 0),
            lineEndpoints(el.x, el.y, radius * 2, (angle || 0) + Math.PI * 0.5)
        ];
    }

    function gateSwingArc(el) {
        const restAngle = typeof el.angle === "number" ? el.angle : 0;
        const maxAngle = Math.abs(typeof el.maxAngle === "number" ? el.maxAngle : 1.05);
        return {
            start: typeof el.swingStartAngle === "number" ? el.swingStartAngle : restAngle - maxAngle,
            end: typeof el.swingEndAngle === "number" ? el.swingEndAngle : restAngle + maxAngle,
            rest: restAngle
        };
    }

    function drawGateSwingArc(ctx, el, view) {
        if (!isPivotGate(el)) return;
        const x = el.x || 0;
        const y = el.y || 0;
        const length = el.length || 64;
        const arc = gateSwingArc(el);
        const center = Pin.editorTools.worldToScreen({ x: x, y: y }, view);
        const radius = Math.max(12, length * view.zoom);
        const start = Pin.editorTools.worldToScreen({ x: x + Math.cos(arc.start) * length, y: y + Math.sin(arc.start) * length }, view);
        const end = Pin.editorTools.worldToScreen({ x: x + Math.cos(arc.end) * length, y: y + Math.sin(arc.end) * length }, view);
        const rest = Pin.editorTools.worldToScreen({ x: x + Math.cos(arc.rest) * length, y: y + Math.sin(arc.rest) * length }, view);
        ctx.save();
        ctx.strokeStyle = "rgba(153,255,204,0.7)";
        ctx.fillStyle = "rgba(153,255,204,0.08)";
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(center.x, center.y);
        ctx.arc(center.x, center.y, radius, arc.start, arc.end);
        ctx.closePath();
        ctx.fill();
        ctx.stroke();
        ctx.setLineDash([4, 4]);
        ctx.strokeStyle = "rgba(255,255,255,0.55)";
        ctx.beginPath();
        ctx.moveTo(center.x, center.y);
        ctx.lineTo(start.x, start.y);
        ctx.moveTo(center.x, center.y);
        ctx.lineTo(end.x, end.y);
        ctx.stroke();
        ctx.setLineDash([]);
        ctx.strokeStyle = "rgba(255,196,0,0.95)";
        ctx.beginPath();
        ctx.moveTo(center.x, center.y);
        ctx.lineTo(rest.x, rest.y);
        ctx.stroke();
        ctx.restore();
    }

    function isPivotGate(el) {
        return el && el.type === "gate" && typeof el.x === "number" && typeof el.y === "number";
    }

    function getElementCenter(el) {
        if (typeof el.x === "number" && typeof el.y === "number") return { x: el.x, y: el.y };
        if (el.type === "flipper" && el.pivot) return { x: el.pivot.x, y: el.pivot.y };
        if (el.type === "kicker" && Array.isArray(el.anchors) && el.anchors.length) {
            const sum = el.anchors.reduce(function reduce(acc, a) { acc.x += a.x; acc.y += a.y; return acc; }, { x: 0, y: 0 });
            return { x: sum.x / el.anchors.length, y: sum.y / el.anchors.length };
        }
        if (el.type === "gate") return { x: el.x || 0, y: el.y || 0 };
        if (el.type === "launcher") return { x: el.x || 439, y: ((el.top || 195) + (el.bottom || 735)) * 0.5 };
        if (el.type === "path" && Array.isArray(el.anchors) && el.anchors.length) {
            const sum = el.anchors.reduce(function reduce(acc, a) { acc.x += a.x; acc.y += a.y; return acc; }, { x: 0, y: 0 });
            return { x: sum.x / el.anchors.length, y: sum.y / el.anchors.length };
        }
        return { x: 250, y: 440 };
    }

    function getKickerPostRadius(el, anchor) {
        return Math.max(4, (anchor && typeof anchor.radius === "number" ? anchor.radius : (el.radius || 14)));
    }

    function getPolygonOrientation(points) {
        if (!points || points.length < 3) return 0;
        let area = 0;
        for (let i = 0; i < points.length; i++) {
            const a = points[i];
            const b = points[(i + 1) % points.length];
            area += (a.x * b.y) - (b.x * a.y);
        }
        return area === 0 ? 0 : (area > 0 ? 1 : -1);
    }

    function chooseKickerBandNormal(ax, ay, ar, bx, by, br, desired) {
        const dx = bx - ax;
        const dy = by - ay;
        const len = Math.sqrt(dx * dx + dy * dy) || 1;
        const ux = dx / len;
        const uy = dy / len;
        const k = Math.max(-1, Math.min(1, (ar - br) / len));
        const side = Math.sqrt(Math.max(0, 1 - k * k));
        const candidateA = { x: ux * k - uy * side, y: uy * k + ux * side };
        const candidateB = { x: ux * k + uy * side, y: uy * k - ux * side };
        const scoreA = desired ? (candidateA.x * desired.x + candidateA.y * desired.y) : (-candidateA.y);
        const scoreB = desired ? (candidateB.x * desired.x + candidateB.y * desired.y) : (-candidateB.y);
        return scoreA >= scoreB ? candidateA : candidateB;
    }

    function getKickerBandSpans(el) {
        const anchors = Array.isArray(el.anchors) ? el.anchors : [];
        const spans = [];
        if (anchors.length < 2) return spans;
        const closed = el.closed !== false && anchors.length > 2;
        const orientation = getPolygonOrientation(anchors);
        for (let i = 0; i < anchors.length - 1; i++) {
            spans.push({ a: anchors[i], b: anchors[i + 1] });
        }
        if (closed) spans.push({ a: anchors[anchors.length - 1], b: anchors[0] });
        return spans.map(function map(span) {
            const ra = getKickerPostRadius(el, span.a);
            const rb = getKickerPostRadius(el, span.b);
            const dx = span.b.x - span.a.x;
            const dy = span.b.y - span.a.y;
            const len = Math.sqrt(dx * dx + dy * dy) || 1;
            const desired = closed ? {
                x: orientation >= 0 ? dy / len : -dy / len,
                y: orientation >= 0 ? -dx / len : dx / len
            } : null;
            const normal = chooseKickerBandNormal(span.a.x, span.a.y, ra, span.b.x, span.b.y, rb, desired);
            return {
                x1: span.a.x + normal.x * ra,
                y1: span.a.y + normal.y * ra,
                x2: span.b.x + normal.x * rb,
                y2: span.b.y + normal.y * rb
            };
        }).filter(function keep(span) {
            const dx = span.x2 - span.x1;
            const dy = span.y2 - span.y1;
            return dx * dx + dy * dy > 1;
        });
    }

    function shiftElement(el, dx, dy) {
        if (typeof el.x === "number") el.x += dx;
        if (typeof el.y === "number") el.y += dy;
        if (el.type === "launcher") {
            if (typeof el.top === "number") el.top += dy;
            if (typeof el.bottom === "number") el.bottom += dy;
        }
        if (el.pivot) { el.pivot.x += dx; el.pivot.y += dy; }
        ["anchors", "leftAnchors", "rightAnchors"].forEach(function each(k) {
            if (!Array.isArray(el[k])) return;
            el[k].forEach(function moveAnchor(a) {
                a.x += dx;
                a.y += dy;
            });
        });
    }

    function buildPathHandles(el, key) {
        const anchors = el[key] || [];
        const handles = [];
        anchors.forEach(function each(a, i) {
            handles.push({ kind: "anchor", key: key, index: i, x: a.x, y: a.y });
            if (a.inHandle) handles.push({ kind: "in", key: key, index: i, x: a.x + a.inHandle.x, y: a.y + a.inHandle.y });
            else handles.push({ kind: "inGhost", key: key, index: i, x: a.x - 24, y: a.y });
            if (a.outHandle) handles.push({ kind: "out", key: key, index: i, x: a.x + a.outHandle.x, y: a.y + a.outHandle.y });
            else handles.push({ kind: "outGhost", key: key, index: i, x: a.x + 24, y: a.y });
        });
        return handles;
    }

    function hitPathBody(el, world, tolPx, view, key) {
        const anchors = el[key] || [];
        const segs = Pin.geometry.pathToSegments(anchors, !!el.closed, 0.8);
        let best = null;
        segs.forEach(function each(seg, i) {
            const d = Pin.editorTools.distancePointToSegment(world.x, world.y, seg.x1, seg.y1, seg.x2, seg.y2);
            const tolWorld = tolPx / view.zoom;
            if (d.dist <= tolWorld && (!best || d.dist < best.dist)) {
                best = { segmentIndex: i, dist: d.dist, x: d.x, y: d.y, t: d.t };
            }
        });
        return best;
    }

    function pointNearBounds(world, bounds, pad) {
        if (!bounds) return true;
        return world.x >= bounds.minX - pad &&
            world.x <= bounds.maxX + pad &&
            world.y >= bounds.minY - pad &&
            world.y <= bounds.maxY + pad;
    }

    function boundsFromPoints(points) {
        if (!points || !points.length) return null;
        const first = points[0];
        const bounds = { minX: first.x, minY: first.y, maxX: first.x, maxY: first.y };
        for (let i = 1; i < points.length; i++) {
            const point = points[i];
            if (point.x < bounds.minX) bounds.minX = point.x;
            if (point.y < bounds.minY) bounds.minY = point.y;
            if (point.x > bounds.maxX) bounds.maxX = point.x;
            if (point.y > bounds.maxY) bounds.maxY = point.y;
        }
        return bounds;
    }

    function getElementBounds(el, runtime) {
        if (runtime && runtime.segments && runtime.segments.length) {
            const points = [];
            runtime.segments.forEach(function each(seg) {
                points.push({ x: seg.x1, y: seg.y1 });
                points.push({ x: seg.x2, y: seg.y2 });
            });
            (runtime.circles || []).forEach(function each(circle) {
                points.push({ x: circle.x - (circle.radius || 0), y: circle.y - (circle.radius || 0) });
                points.push({ x: circle.x + (circle.radius || 0), y: circle.y + (circle.radius || 0) });
            });
            return boundsFromPoints(points);
        }
        if (typeof el.x === "number" && typeof el.y === "number") {
            if (typeof el.radius === "number") {
                return {
                    minX: el.x - el.radius,
                    minY: el.y - el.radius,
                    maxX: el.x + el.radius,
                    maxY: el.y + el.radius
                };
            }
            const halfW = (el.w || el.width || el.size || el.length || 40) * 0.5;
            const halfH = (el.h || Math.abs((el.bottom || 0) - (el.top || 0)) || el.length || 40) * 0.5;
            return {
                minX: el.x - halfW,
                minY: el.y - halfH,
                maxX: el.x + halfW,
                maxY: el.y + halfH
            };
        }
        if (el.pivot && typeof el.length === "number") {
            return {
                minX: Math.min(el.pivot.x, el.pivot.x + Math.cos(el.restAngle || 0) * el.length),
                minY: Math.min(el.pivot.y, el.pivot.y + Math.sin(el.restAngle || 0) * el.length),
                maxX: Math.max(el.pivot.x, el.pivot.x + Math.cos(el.restAngle || 0) * el.length),
                maxY: Math.max(el.pivot.y, el.pivot.y + Math.sin(el.restAngle || 0) * el.length)
            };
        }
        return null;
    }

    function forElement(el, world, view, runtime) {
        const screenTol = 10;
        const tolWorld = screenTol / view.zoom;
        if (!pointNearBounds(world, getElementBounds(el, runtime), tolWorld + 32 / view.zoom)) {
            return { hit: false, handle: null, body: null };
        }
        const handles = [];
        const center = getElementCenter(el);
        handles.push({ kind: "move", x: center.x, y: center.y });

        if (el.type === "path") handles.push.apply(handles, buildPathHandles(el, "anchors"));
        if (el.type === "kicker" && Array.isArray(el.anchors)) {
            (el.anchors || []).forEach(function each(anchor, index) {
                handles.push({ kind: "anchor", key: "anchors", index: index, x: anchor.x, y: anchor.y });
            });
        }
        if (el.type === "ramp") {
            handles.push.apply(handles, buildPathHandles(el, "leftAnchors"));
            handles.push.apply(handles, buildPathHandles(el, "rightAnchors"));
        }
        if (el.type === "flipper" && el.pivot) {
            const tipX = el.pivot.x + Math.cos(el.restAngle) * el.length;
            const tipY = el.pivot.y + Math.sin(el.restAngle) * el.length;
            const rot = rotatePoint(el.pivot.x, el.pivot.y, el.length * 0.58, -24, el.restAngle);
            handles.push({ kind: "pivot", x: el.pivot.x, y: el.pivot.y });
            handles.push({ kind: "tip", x: tipX, y: tipY });
            handles.push({ kind: "rotate", x: rot.x, y: rot.y });
        }
        if (isPivotGate(el)) {
            const angle = el.angle || 0;
            const length = el.length || 64;
            const tip = rotatePoint(el.x || 0, el.y || 0, length, 0, angle);
            const rot = rotatePoint(el.x || 0, el.y || 0, length * 0.58, -24, angle);
            handles.push({ kind: "pivot", x: el.x || 0, y: el.y || 0 });
            handles.push({ kind: "length", x: tip.x, y: tip.y });
            handles.push({ kind: "rotate", x: rot.x, y: rot.y });
        }
        if (el.type === "launcher") {
            const x = el.x || 439;
            const top = el.top || 195;
            const bottom = el.bottom || 735;
            const width = el.width || 38;
            handles.push({ kind: "launcherTop", x: x, y: top });
            handles.push({ kind: "launcherBottom", x: x, y: bottom });
            handles.push({ kind: "launcherWidth", x: x + width * 0.5, y: (top + bottom) * 0.5 });
        }
        if (el.type === "spinner") {
            const angle = el.angle || 0;
            const end = rotatePoint(el.x, el.y, spinnerRadius(el), 0, angle);
            const rot = rotatePoint(el.x, el.y, 0, -30, angle);
            handles.push({ kind: "radius", x: end.x, y: end.y });
            handles.push({ kind: "rotate", x: rot.x, y: rot.y });
        }
        if (el.type === "lane" || el.type === "dropTarget" || el.type === "drain" || el.type === "arrowLight" || el.type === "boxLight") {
            const w = el.w || 40;
            const h = el.h || 20;
            const size = rotatePoint(el.x, el.y, w * 0.5, h * 0.5, el.angle || 0);
            handles.push({ kind: "size", x: size.x, y: size.y });
            if (el.type === "lane" || el.type === "dropTarget" || el.type === "arrowLight" || el.type === "boxLight") {
                const rot = rotatePoint(el.x, el.y, 0, -h * 0.5 - 22, el.angle || 0);
                handles.push({ kind: "rotate", x: rot.x, y: rot.y });
            }
        }
        if (el.type === "bumper" || el.type === "kicker" || el.type === "scoreZone" || el.type === "light" || el.type === "trough") {
            const radiusCenter = el.type === "kicker" && Array.isArray(el.anchors) && el.anchors.length ? center : { x: el.x, y: el.y };
            handles.push({ kind: "radius", x: radiusCenter.x + (el.radius || 20), y: radiusCenter.y });
            if (el.type === "trough") {
                const angle = typeof el.ejectAngle === "number" ? el.ejectAngle : -Math.PI * 0.5;
                const distance = Math.max(32, (el.radius || 18) + 26);
                handles.push({ kind: "ejectAngle", x: el.x + Math.cos(angle) * distance, y: el.y + Math.sin(angle) * distance });
            }
        }

        for (let i = handles.length - 1; i >= 0; i--) {
            const h = handles[i];
            const dx = world.x - h.x;
            const dy = world.y - h.y;
            if (Math.sqrt(dx * dx + dy * dy) <= tolWorld) return { hit: true, handle: h, body: null };
        }

        let body = false;
        let bodyMeta = null;
        if (el.type === "kicker" && Array.isArray(el.anchors) && el.anchors.length) {
            const bandRadius = ((el.bandThickness || 6) * 0.5) + tolWorld;
            body = el.anchors.some(function some(anchor) {
                return Math.hypot(world.x - anchor.x, world.y - anchor.y) <= getKickerPostRadius(el, anchor) + tolWorld;
            });
            if (!body && el.anchors.length > 1) {
                const spans = getKickerBandSpans(el);
                for (let i = 0; i < spans.length; i++) {
                    if (Pin.editorTools.distancePointToSegment(world.x, world.y, spans[i].x1, spans[i].y1, spans[i].x2, spans[i].y2).dist <= bandRadius) {
                        body = true;
                        break;
                    }
                }
            }
        } else if ((el.type === "bumper" || el.type === "kicker" || el.type === "scoreZone" || el.type === "light" || el.type === "trough") && typeof el.x === "number") {
            const r = el.radius || 20;
            body = Math.hypot(world.x - el.x, world.y - el.y) <= r + tolWorld;
        } else if (el.type === "lane" || el.type === "dropTarget" || el.type === "drain" || el.type === "arrowLight" || el.type === "boxLight") {
            body = pointInRotatedRect(world.x, world.y, el.x, el.y, el.w || 40, el.h || 20, el.angle || 0);
        } else if (el.type === "flipper" && el.pivot) {
            const tipX = el.pivot.x + Math.cos(el.restAngle) * el.length;
            const tipY = el.pivot.y + Math.sin(el.restAngle) * el.length;
            body = Pin.editorTools.distancePointToSegment(world.x, world.y, el.pivot.x, el.pivot.y, tipX, tipY).dist <= (14 / view.zoom);
        } else if (isPivotGate(el)) {
            const x = el.x || 0;
            const y = el.y || 0;
            const tip = rotatePoint(x, y, el.length || 64, 0, el.angle || 0);
            body = Pin.editorTools.distancePointToSegment(world.x, world.y, x, y, tip.x, tip.y).dist <= (8 / view.zoom);
        } else if (el.type === "launcher") {
            const x = el.x || 439;
            const top = el.top || 195;
            const bottom = el.bottom || 735;
            const width = el.width || 38;
            body = pointInRect(world.x, world.y, x, (top + bottom) * 0.5, width, Math.abs(bottom - top));
        } else if (el.type === "spinner") {
            const blades = spinnerBladeSegments(el, el.angle || 0);
            body = blades.some(function some(blade) {
                return Pin.editorTools.distancePointToSegment(world.x, world.y, blade.x1, blade.y1, blade.x2, blade.y2).dist <= (8 / view.zoom);
            });
        } else if (el.type === "path") {
            bodyMeta = hitPathBodyFromSegments((runtime && runtime.drawSegments) || null, el, world, 6, view, "anchors");
            body = !!bodyMeta;
        } else if (el.type === "ramp") {
            bodyMeta =
                hitPathBodyFromSegments((runtime && runtime.drawLeftSegs) || null, el, world, 6, view, "leftAnchors") ||
                hitPathBodyFromSegments((runtime && runtime.drawRightSegs) || null, el, world, 6, view, "rightAnchors");
            body = !!bodyMeta;
        } else {
            const c = getElementCenter(el);
            body = Math.hypot(world.x - c.x, world.y - c.y) <= (24 / view.zoom);
        }
        return { hit: body, handle: body ? { kind: "move", x: center.x, y: center.y } : null, body: bodyMeta };
    }

    function hitPathBodyFromSegments(precomputed, el, world, tolPx, view, key) {
        if (!precomputed || !precomputed.length) return hitPathBody(el, world, tolPx, view, key);
        let best = null;
        const tolWorld = tolPx / view.zoom;
        precomputed.forEach(function each(seg, i) {
            const d = Pin.editorTools.distancePointToSegment(world.x, world.y, seg.x1, seg.y1, seg.x2, seg.y2);
            if (d.dist <= tolWorld && (!best || d.dist < best.dist)) {
                best = { segmentIndex: i, dist: d.dist, x: d.x, y: d.y, t: d.t };
            }
        });
        return best;
    }

    function applyHandleDrag(el, handle, world, startWorld, opts) {
        const dx = world.x - startWorld.x;
        const dy = world.y - startWorld.y;
        if (handle.kind === "move") {
            shiftElement(el, dx, dy);
            return;
        }
        if (handle.kind === "launcherTop") {
            el.top = Math.min(world.y, (el.bottom || 735) - 24);
            return;
        }
        if (handle.kind === "launcherBottom") {
            el.bottom = Math.max(world.y, (el.top || 195) + 24);
            el.y = el.bottom - 25;
            return;
        }
        if (handle.kind === "launcherWidth") {
            el.width = Math.max(16, Math.abs(world.x - (el.x || 439)) * 2);
            return;
        }
        if (handle.kind === "pivot") {
            if (el.type === "flipper" && el.pivot) {
                el.pivot.x = world.x;
                el.pivot.y = world.y;
                return;
            }
            if (isPivotGate(el)) {
                el.x = world.x;
                el.y = world.y;
            }
            return;
        }
        if (handle.kind === "tip") {
            const vx = world.x - el.pivot.x;
            const vy = world.y - el.pivot.y;
            el.length = Math.max(12, Math.sqrt(vx * vx + vy * vy));
            el.restAngle = Math.atan2(vy, vx);
            return;
        }
        if (handle.kind === "radius") {
            const radiusCenter = el.type === "kicker" && Array.isArray(el.anchors) && el.anchors.length ? getElementCenter(el) : { x: el.x, y: el.y };
            const nextRadius = Math.max(4, Math.sqrt((world.x - radiusCenter.x) * (world.x - radiusCenter.x) + (world.y - radiusCenter.y) * (world.y - radiusCenter.y)));
            el.radius = nextRadius;
            if (el.type === "spinner") el.angle = Math.atan2(world.y - el.y, world.x - el.x);
            return;
        }
        if (handle.kind === "ejectAngle") {
            el.ejectAngle = Math.atan2(world.y - (el.y || 0), world.x - (el.x || 0));
            return;
        }
        if (handle.kind === "size") {
            const local = worldToLocal(world.x, world.y, el.x, el.y, el.angle || 0);
            el.w = Math.max(6, local.x * 2);
            el.h = Math.max(6, local.y * 2);
            return;
        }
        if (handle.kind === "length") {
            if (isPivotGate(el)) {
                el.length = Math.max(12, Math.hypot(world.x - (el.x || 0), world.y - (el.y || 0)));
                el.angle = Math.atan2(world.y - (el.y || 0), world.x - (el.x || 0));
                return;
            }
            const nextSize = Math.max(8, Math.hypot(world.x - el.x, world.y - el.y) * 2);
            el.length = nextSize;
            return;
        }
        if (handle.kind === "rotate") {
            if (el.type === "flipper" && el.pivot) {
                const next = Math.atan2(world.y - el.pivot.y, world.x - el.pivot.x);
                const delta = next - el.restAngle;
                el.restAngle = next;
                if (typeof el.activeAngle === "number") el.activeAngle += delta;
                return;
            }
            if (isPivotGate(el)) {
                el.angle = Math.atan2(world.y - (el.y || 0), world.x - (el.x || 0));
                return;
            }
            if (typeof el.x === "number" && typeof el.y === "number") {
                el.angle = Math.atan2(world.y - el.y, world.x - el.x) + Math.PI * 0.5;
            }
            return;
        }

        if (handle.kind === "anchor" || handle.kind === "in" || handle.kind === "out" || handle.kind === "inGhost" || handle.kind === "outGhost") {
            const list = el[handle.key] || [];
            const a = list[handle.index];
            if (!a) return;
            if (handle.kind === "anchor") {
                a.x = world.x; a.y = world.y;
                return;
            }
            const isIn = handle.kind === "in" || handle.kind === "inGhost";
            const prop = isIn ? "inHandle" : "outHandle";
            a[prop] = { x: world.x - a.x, y: world.y - a.y };
            const opposite = isIn ? "outHandle" : "inHandle";
            if (!opts.altKey) {
                a[opposite] = { x: -a[prop].x, y: -a[prop].y };
            }
        }
    }

    function drawHandles(ctx, el, selected, view, dashOffset, style) {
        if (!selected) return;
        const styles = style || {};
        const boxes = [];
        const pushBox = function (x, y) { boxes.push({ x: x, y: y }); };
        const pushRect = function (x1, y1, x2, y2) {
            boxes.push({ x: x1, y: y1 });
            boxes.push({ x: x2, y: y2 });
        };
        const drawCircle = function (x, y, r, fill) {
            const p = Pin.editorTools.worldToScreen({ x: x, y: y }, view);
            ctx.beginPath();
            ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
            if (fill) ctx.fill(); else ctx.stroke();
            pushBox(p.x, p.y);
        };
        const drawWorldCircle = function (x, y, radius) {
            const p = Pin.editorTools.worldToScreen({ x: x, y: y }, view);
            ctx.beginPath();
            ctx.arc(p.x, p.y, Math.max(4, radius * view.zoom), 0, Math.PI * 2);
            ctx.stroke();
            pushRect(p.x - radius * view.zoom, p.y - radius * view.zoom, p.x + radius * view.zoom, p.y + radius * view.zoom);
        };
        const drawSquare = function (x, y, s, fill) {
            const p = Pin.editorTools.worldToScreen({ x: x, y: y }, view);
            if (fill) ctx.fillRect(p.x - s * 0.5, p.y - s * 0.5, s, s);
            else ctx.strokeRect(p.x - s * 0.5, p.y - s * 0.5, s, s);
            pushBox(p.x, p.y);
        };
        const drawGhostHandle = function (ax, ay, hx, hy) {
            const p1 = Pin.editorTools.worldToScreen({ x: ax, y: ay }, view);
            const p2 = Pin.editorTools.worldToScreen({ x: hx, y: hy }, view);
            ctx.save();
            ctx.strokeStyle = "rgba(255,255,255,0.3)";
            ctx.setLineDash([3, 4]);
            ctx.beginPath();
            ctx.moveTo(p1.x, p1.y);
            ctx.lineTo(p2.x, p2.y);
            ctx.stroke();
            ctx.restore();
            drawCircle(hx, hy, 4, false);
        };
        const drawSelectionCircle = function (x, y, radius) {
            const p = Pin.editorTools.worldToScreen({ x: x, y: y }, view);
            const r = Math.max(7, radius * view.zoom);
            ctx.save();
            ctx.strokeStyle = styles.boundsStrokeStyle || "rgba(0,255,200,0.95)";
            ctx.lineWidth = Math.max(2, styles.lineWidth || 1.6);
            ctx.setLineDash([6, 4]);
            ctx.lineDashOffset = -dashOffset;
            ctx.beginPath();
            ctx.arc(p.x, p.y, r + 7, 0, Math.PI * 2);
            ctx.stroke();
            ctx.restore();
        };
        const drawSelectionRect = function (corners) {
            ctx.save();
            ctx.strokeStyle = styles.boundsStrokeStyle || "rgba(0,255,200,0.95)";
            ctx.lineWidth = Math.max(2, styles.lineWidth || 1.6);
            ctx.setLineDash([6, 4]);
            ctx.lineDashOffset = -dashOffset;
            ctx.beginPath();
            corners.forEach(function each(point, index) {
                const screen = Pin.editorTools.worldToScreen(point, view);
                if (index) ctx.lineTo(screen.x, screen.y); else ctx.moveTo(screen.x, screen.y);
            });
            ctx.closePath();
            ctx.stroke();
            ctx.restore();
        };

        ctx.save();
        ctx.strokeStyle = styles.strokeStyle || "rgba(255,255,255,0.9)";
        ctx.fillStyle = styles.fillStyle || "rgba(255,196,0,0.9)";
        ctx.lineWidth = styles.lineWidth || 1.6;

        if (el.type === "path" || el.type === "ramp") {
            const keys = el.type === "path" ? ["anchors"] : ["leftAnchors", "rightAnchors"];
            keys.forEach(function each(key) {
                (el[key] || []).forEach(function eachAnchor(a) {
                    if (a.inHandle) {
                        ctx.beginPath();
                        const p1 = Pin.editorTools.worldToScreen({ x: a.x, y: a.y }, view);
                        const p2 = Pin.editorTools.worldToScreen({ x: a.x + a.inHandle.x, y: a.y + a.inHandle.y }, view);
                        ctx.moveTo(p1.x, p1.y); ctx.lineTo(p2.x, p2.y); ctx.stroke();
                        drawCircle(a.x + a.inHandle.x, a.y + a.inHandle.y, 5, false);
                    } else {
                        drawGhostHandle(a.x, a.y, a.x - 24, a.y);
                    }
                    if (a.outHandle) {
                        ctx.beginPath();
                        const p1 = Pin.editorTools.worldToScreen({ x: a.x, y: a.y }, view);
                        const p2 = Pin.editorTools.worldToScreen({ x: a.x + a.outHandle.x, y: a.y + a.outHandle.y }, view);
                        ctx.moveTo(p1.x, p1.y); ctx.lineTo(p2.x, p2.y); ctx.stroke();
                        drawCircle(a.x + a.outHandle.x, a.y + a.outHandle.y, 5, false);
                    } else {
                        drawGhostHandle(a.x, a.y, a.x + 24, a.y);
                    }
                    drawSquare(a.x, a.y, 8, true);
                });
            });
        } else if (el.type === "kicker" && Array.isArray(el.anchors) && el.anchors.length) {
            const r = el.radius || 14;
            ctx.lineWidth = styles.lineWidth || 1.6;
            ctx.lineCap = "round";
            ctx.lineJoin = "round";
            const spans = getKickerBandSpans(el);
            if (spans.length) {
                ctx.beginPath();
                const start = Pin.editorTools.worldToScreen({ x: spans[0].x1, y: spans[0].y1 }, view);
                ctx.moveTo(start.x, start.y);
                spans.forEach(function each(span) {
                    const end = Pin.editorTools.worldToScreen({ x: span.x2, y: span.y2 }, view);
                    ctx.lineTo(end.x, end.y);
                });
                ctx.stroke();
            }
            el.anchors.forEach(function each(anchor) {
                drawWorldCircle(anchor.x, anchor.y, getKickerPostRadius(el, anchor) || r);
                drawCircle(anchor.x, anchor.y, 5, true);
            });
        } else if (el.type === "bumper" || el.type === "kicker" || el.type === "scoreZone" || el.type === "light" || el.type === "trough") {
            const r = el.radius || 20;
            drawSelectionCircle(el.x, el.y, r);
            drawWorldCircle(el.x, el.y, r);
            drawCircle(el.x, el.y, 5, true);
            drawCircle(el.x + r, el.y, 5, false);
            if (el.type === "trough") {
                const angle = typeof el.ejectAngle === "number" ? el.ejectAngle : -Math.PI * 0.5;
                const distance = Math.max(32, r + 26);
                const tip = { x: el.x + Math.cos(angle) * distance, y: el.y + Math.sin(angle) * distance };
                const left = rotatePoint(tip.x, tip.y, -10, -5, angle);
                const right = rotatePoint(tip.x, tip.y, -10, 5, angle);
                const centerScreen = Pin.editorTools.worldToScreen({ x: el.x, y: el.y }, view);
                const tipScreen = Pin.editorTools.worldToScreen(tip, view);
                ctx.save();
                ctx.strokeStyle = "rgba(136,170,255,0.95)";
                ctx.fillStyle = "rgba(136,170,255,0.95)";
                ctx.lineWidth = Math.max(2, styles.lineWidth || 1.6);
                ctx.beginPath();
                ctx.moveTo(centerScreen.x, centerScreen.y);
                ctx.lineTo(tipScreen.x, tipScreen.y);
                ctx.stroke();
                ctx.beginPath();
                [tip, left, right].forEach(function each(point, index) {
                    const screen = Pin.editorTools.worldToScreen(point, view);
                    if (index) ctx.lineTo(screen.x, screen.y); else ctx.moveTo(screen.x, screen.y);
                });
                ctx.closePath();
                ctx.fill();
                ctx.restore();
                drawCircle(tip.x, tip.y, 5, false);
            }
        } else if (el.type === "arrowLight" || el.type === "boxLight") {
            const w = el.w || 86;
            const h = el.h || 34;
            const size = rotatePoint(el.x, el.y, w * 0.5, h * 0.5, el.angle || 0);
            const rot = rotatePoint(el.x, el.y, 0, -h * 0.5 - 22, el.angle || 0);
            const corners = [
                rotatePoint(el.x, el.y, -w * 0.5, -h * 0.5, el.angle || 0),
                rotatePoint(el.x, el.y, w * 0.5, -h * 0.5, el.angle || 0),
                rotatePoint(el.x, el.y, w * 0.5, h * 0.5, el.angle || 0),
                rotatePoint(el.x, el.y, -w * 0.5, h * 0.5, el.angle || 0)
            ];
            drawSelectionRect(corners);
            ctx.beginPath();
            corners.forEach(function each(point, index) {
                const screen = Pin.editorTools.worldToScreen(point, view);
                if (index) ctx.lineTo(screen.x, screen.y); else ctx.moveTo(screen.x, screen.y);
            });
            ctx.closePath();
            ctx.stroke();
            drawCircle(el.x, el.y, 5, true);
            drawCircle(size.x, size.y, 5, false);
            drawGhostHandle(el.x, el.y, rot.x, rot.y);
            drawCircle(rot.x, rot.y, 5, false);
        } else if (el.type === "flipper" && el.pivot) {
            const tipX = el.pivot.x + Math.cos(el.restAngle) * el.length;
            const tipY = el.pivot.y + Math.sin(el.restAngle) * el.length;
            const rot = rotatePoint(el.pivot.x, el.pivot.y, el.length * 0.58, -24, el.restAngle);
            drawCircle(el.pivot.x, el.pivot.y, 5, true);
            drawCircle(tipX, tipY, 5, false);
            drawGhostHandle(el.pivot.x, el.pivot.y, rot.x, rot.y);
            drawCircle(rot.x, rot.y, 5, false);
        } else if (el.type === "spinner") {
            const endpoints = lineEndpoints(el.x, el.y, spinnerRadius(el) * 2, el.angle || 0);
            const rot = rotatePoint(el.x, el.y, 0, -30, el.angle || 0);
            drawCircle(el.x, el.y, 5, true);
            drawCircle(endpoints.x2, endpoints.y2, 5, false);
            drawGhostHandle(el.x, el.y, rot.x, rot.y);
            drawCircle(rot.x, rot.y, 5, false);
        } else if (isPivotGate(el)) {
            const x = el.x || 0;
            const y = el.y || 0;
            const tip = rotatePoint(x, y, el.length || 64, 0, el.angle || 0);
            const rot = rotatePoint(x, y, (el.length || 64) * 0.58, -24, el.angle || 0);
            if (isPivotGate(el)) drawGateSwingArc(ctx, el, view);
            drawCircle(x, y, 5, true);
            drawCircle(tip.x, tip.y, 5, false);
            drawGhostHandle(x, y, rot.x, rot.y);
            drawCircle(rot.x, rot.y, 5, false);
        } else if (el.type === "lane" || el.type === "dropTarget" || el.type === "drain") {
            const corners = getRectCorners(el.x, el.y, el.w || 14, el.h || 40, el.angle || 0);
            corners.forEach(function eachCorner(p) { drawSquare(p.x, p.y, 4, false); });
            const size = rotatePoint(el.x, el.y, (el.w || 14) * 0.5, (el.h || 40) * 0.5, el.angle || 0);
            drawCircle(el.x, el.y, 5, true);
            drawCircle(size.x, size.y, 5, false);
            if (el.type === "lane" || el.type === "dropTarget") {
                const rot = rotatePoint(el.x, el.y, 0, -(el.h || 40) * 0.5 - 22, el.angle || 0);
                drawGhostHandle(el.x, el.y, rot.x, rot.y);
                drawCircle(rot.x, rot.y, 5, false);
            }
        } else if (el.type === "launcher") {
            const x = el.x || 439;
            const top = el.top || 195;
            const bottom = el.bottom || 735;
            const width = el.width || 38;
            drawCircle(x, (top + bottom) * 0.5, 5, true);
            drawCircle(x, top, 5, false);
            drawCircle(x, bottom, 5, false);
            drawCircle(x + width * 0.5, (top + bottom) * 0.5, 5, false);
        } else {
            const c = getElementCenter(el);
            drawCircle(c.x, c.y, 5, true);
        }

        if (boxes.length > 0) {
            const minX = Math.min.apply(null, boxes.map(function m(b) { return b.x; })) - 14;
            const minY = Math.min.apply(null, boxes.map(function m(b) { return b.y; })) - 14;
            const maxX = Math.max.apply(null, boxes.map(function m(b) { return b.x; })) + 14;
            const maxY = Math.max.apply(null, boxes.map(function m(b) { return b.y; })) + 14;
            ctx.setLineDash([6, 4]);
            ctx.lineDashOffset = -dashOffset;
            ctx.strokeStyle = styles.boundsStrokeStyle || "rgba(0,255,200,0.95)";
            ctx.lineWidth = styles.lineWidth || 1.6;
            ctx.strokeRect(minX, minY, maxX - minX, maxY - minY);
            ctx.setLineDash([]);
        }
        ctx.restore();
    }

    Pin.editorHitTest = {
        forElement: forElement,
        applyHandleDrag: applyHandleDrag,
        drawHandles: drawHandles,
        shiftElement: shiftElement
    };
})(window.Pin);
