/*
 * Kicker element.
 * What: supports a 1-3 post rubber-ring kicker.
 * Why: real kickers are often formed from several round posts with a rubber band perimeter.
 */
(function registerKicker(Pin) {
    function postRadius(el, anchor) {
        const value = anchor && typeof anchor.radius === "number" ? anchor.radius : el.radius;
        return Math.max(4, value || 14);
    }

    function getPosts(el) {
        return (el.anchors || []).slice(0, 3).map(function map(anchor) {
            return { x: anchor.x, y: anchor.y, radius: postRadius(el, anchor) };
        });
    }

    function getSegments(posts, closed) {
        const segments = [];
        if (!posts || posts.length < 2) return segments;
        for (let i = 0; i < posts.length - 1; i++) {
            segments.push({ a: posts[i], b: posts[i + 1], index: segments.length });
        }
        if (closed && posts.length > 2) {
            segments.push({ a: posts[posts.length - 1], b: posts[0], index: segments.length });
        }
        return segments;
    }

    function polygonOrientation(posts) {
        if (!posts || posts.length < 3) return 0;
        let area = 0;
        for (let i = 0; i < posts.length; i++) {
            const a = posts[i];
            const b = posts[(i + 1) % posts.length];
            area += (a.x * b.y) - (b.x * a.y);
        }
        return area === 0 ? 0 : (area > 0 ? 1 : -1);
    }

    function chooseBandNormal(ax, ay, ar, bx, by, br, desired) {
        const dx = bx - ax;
        const dy = by - ay;
        const len = Math.sqrt(dx * dx + dy * dy) || 1;
        const ux = dx / len;
        const uy = dy / len;
        const k = Math.max(-1, Math.min(1, (ar - br) / len));
        const side = Math.sqrt(Math.max(0, 1 - k * k));
        const candidateA = {
            x: ux * k - uy * side,
            y: uy * k + ux * side
        };
        const candidateB = {
            x: ux * k + uy * side,
            y: uy * k - ux * side
        };
        const scoreA = desired ? (candidateA.x * desired.x + candidateA.y * desired.y) : (-candidateA.y);
        const scoreB = desired ? (candidateB.x * desired.x + candidateB.y * desired.y) : (-candidateB.y);
        return scoreA >= scoreB ? candidateA : candidateB;
    }

    function getBandSpans(posts, closed) {
        const orientation = polygonOrientation(posts);
        return getSegments(posts, closed).map(function map(segment) {
            const dx = segment.b.x - segment.a.x;
            const dy = segment.b.y - segment.a.y;
            const len = Math.sqrt(dx * dx + dy * dy) || 1;
            const desired = closed ? {
                x: orientation >= 0 ? dy / len : -dy / len,
                y: orientation >= 0 ? -dx / len : dx / len
            } : null;
            const normal = chooseBandNormal(segment.a.x, segment.a.y, segment.a.radius, segment.b.x, segment.b.y, segment.b.radius, desired);
            return {
                index: segment.index,
                a: segment.a,
                b: segment.b,
                x1: segment.a.x + normal.x * segment.a.radius,
                y1: segment.a.y + normal.y * segment.a.radius,
                x2: segment.b.x + normal.x * segment.b.radius,
                y2: segment.b.y + normal.y * segment.b.radius
            };
        }).filter(function keep(span) {
            const dx = span.x2 - span.x1;
            const dy = span.y2 - span.y1;
            return dx * dx + dy * dy > 1;
        });
    }

    function emitKick(el, ball, hit, world) {
        const score = Pin.rules && Pin.rules.resolveElementScore ?
            Pin.rules.resolveElementScore(world, el, (el.score || 0)) :
            (el.score || 0);
        ball.vx += hit.nx * (el.kickPower || 14);
        ball.vy += hit.ny * (el.kickPower || 14);
        if (Pin.events) {
            if (score) Pin.events.emit(world, { type: "score", sourceId: el.id, elementType: el.type, points: score });
            Pin.events.emit(world, { type: "switchClosed", sourceId: el.id, elementType: el.type });
        }
        if (Pin.audio) Pin.audio.bonus();
    }

    function notePulse(el, world, pulsePatch) {
        if (!world || !Pin.elements || !Pin.elements.getState) return;
        const state = Pin.elements.getState(world, el, { pulse: 0, pulseSegment: -1, pulsePoint: null });
        state.pulse = 1;
        state.pulseSegment = typeof pulsePatch.pulseSegment === "number" ? pulsePatch.pulseSegment : -1;
        state.pulsePoint = pulsePatch.pulsePoint || null;
    }

    function angleTo(center, point) {
        return Math.atan2(point.y - center.y, point.x - center.x);
    }

    function drawBandArc(ctx, post, fromPoint, toPoint, orientation) {
        ctx.beginPath();
        ctx.arc(
            post.x,
            post.y,
            post.radius,
            angleTo(post, fromPoint),
            angleTo(post, toPoint),
            orientation < 0
        );
        ctx.stroke();
    }

    Pin.elements.register("kicker", {
        compile: function compile(el) {
            const posts = getPosts(el);
            const restitution = typeof el.restitution === "number" ? el.restitution : undefined;
            const bandThickness = el.bandThickness || 6;
            const closed = el.closed !== false && posts.length > 2;
            const circles = posts.map(function map(post, index) {
                return {
                    x: post.x,
                    y: post.y,
                    radius: post.radius,
                    restitution: restitution,
                    hitKey: el.id + ":post:" + index,
                    onHit: function onHit(ball, hit, world) {
                        notePulse(el, world, {
                            pulseSegment: -1,
                            pulsePoint: { x: post.x, y: post.y }
                        });
                        emitKick(el, ball, hit, world);
                    }
                };
            });
            const segments = getBandSpans(posts, closed).map(function map(segment) {
                return {
                    x1: segment.x1,
                    y1: segment.y1,
                    x2: segment.x2,
                    y2: segment.y2,
                    thickness: bandThickness * 0.5,
                    restitution: restitution,
                    hitKey: el.id + ":band:" + segment.index,
                    onHit: function onHit(ball, hit, world) {
                        notePulse(el, world, {
                            pulseSegment: segment.index,
                            pulsePoint: hit && typeof hit.cx === "number" && typeof hit.cy === "number" ? { x: hit.cx, y: hit.cy } : null
                        });
                        emitKick(el, ball, hit, world);
                    }
                };
            });
            return {
                circles: circles,
                segments: segments,
                posts: posts,
                bandSpans: getBandSpans(posts, closed),
                closed: closed,
                orientation: polygonOrientation(posts)
            };
        },
        draw: function draw(ctx, el, runtime, world) {
            const posts = (runtime && runtime.posts) || getPosts(el);
            const bandThickness = el.bandThickness || 6;
            const state = world && Pin.elements && Pin.elements.getState ? Pin.elements.getState(world, el, { pulse: 0, pulseSegment: -1, pulsePoint: null }) : null;
            if (state && state.pulse > 0) state.pulse = Math.max(0, state.pulse - ((world && world.lastPhysicsDt) || (1 / 60)) * 7);
            ctx.save();
            const color = el.color || "#ffaa66";
            const closed = runtime && typeof runtime.closed === "boolean" ? runtime.closed : (el.closed !== false && posts.length > 2);
            const orientation = runtime && typeof runtime.orientation === "number" ? runtime.orientation : polygonOrientation(posts);
            const segments = (runtime && runtime.bandSpans) || getBandSpans(posts, closed);
            if (segments.length) {
                ctx.strokeStyle = color;
                ctx.lineWidth = bandThickness;
                ctx.lineCap = "round";
                ctx.lineJoin = "round";
                Pin.render.makeGlow(ctx, color, 16);
                segments.forEach(function each(segment) {
                    const pulse = state && state.pulseSegment === segment.index ? state.pulse : 0;
                    const mx = (segment.x1 + segment.x2) * 0.5;
                    const my = (segment.y1 + segment.y2) * 0.5;
                    const dx = segment.x2 - segment.x1;
                    const dy = segment.y2 - segment.y1;
                    const len = Math.sqrt(dx * dx + dy * dy) || 1;
                    const nx = -dy / len;
                    const ny = dx / len;
                    const bend = pulse * Math.min(8, bandThickness * 0.9);
                    ctx.beginPath();
                    ctx.moveTo(segment.x1, segment.y1);
                    ctx.quadraticCurveTo(mx - nx * bend, my - ny * bend, segment.x2, segment.y2);
                    ctx.stroke();
                });
                if (closed && segments.length === posts.length) {
                    posts.forEach(function eachPost(post, index) {
                        const incoming = segments[(index + segments.length - 1) % segments.length];
                        const outgoing = segments[index];
                        drawBandArc(ctx, post, { x: incoming.x2, y: incoming.y2 }, { x: outgoing.x1, y: outgoing.y1 }, orientation);
                    });
                }
            }
            posts.forEach(function each(post) {
                ctx.fillStyle = "rgba(255,170,102,0.12)";
                ctx.beginPath();
                ctx.arc(post.x, post.y, Math.max(2, post.radius - bandThickness * 0.5), 0, Math.PI * 2);
                ctx.fill();
                ctx.fillStyle = "#fff4d8";
                ctx.beginPath();
                ctx.arc(post.x, post.y, 4, 0, Math.PI * 2);
                ctx.fill();
            });
            ctx.restore();
        },
        editor: { handles: true, hitTest: true, inspectorFields: ["radius", "bandThickness", "kickPower", "restitution", "score", "color"] }
    });
})(window.Pin);
