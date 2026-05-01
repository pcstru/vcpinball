/*
 * Flipper mechanism and contact response.
 * Why: keep flipper motion and ball interaction in one place so tuning and
 * tests exercise the same logic the main table runtime uses.
 */
(function registerFlipper(Pin) {
    /*
     * Resolve which player control drives this flipper.
     * Why: editor-authored tables may specify control, side, or only geometry.
     * Falling back in one place keeps runtime behavior predictable.
     */
    function getControlName(el, table) {
        if (el.control) return el.control;
        if (el.side) return el.side;
        if (table && table.playfield && el.pivot && typeof el.pivot.x === "number") {
            return el.pivot.x > table.playfield.width * 0.5 ? "right" : "left";
        }
        if (typeof el.restAngle === "number" && Math.cos(el.restAngle) < 0) return "right";
        return "left";
    }

    /*
     * Read whether this flipper's control is currently active.
     * Why: compile and draw both need the same control decision.
     */
    function getControlState(el, world, table) {
        if (!world || !world.controls) return false;
        const control = getControlName(el, table || (world && world.table));
        return !!world.controls[control];
    }

    /*
     * Choose the flipper's commanded angle.
     * Why: the motion model accelerates toward rest or active angle.
     */
    function getTargetAngle(el, world, table) {
        return getControlState(el, world, table) ? el.activeAngle : el.restAngle;
    }

    /*
     * Return the current simulated angle for draw and collision use.
     * Why: the flipper can be between rest and active due to acceleration.
     */
    function getRuntimeAngle(el, world, table) {
        const state = Pin.elements.peekState ? Pin.elements.peekState(world, el) : null;
        if (state && typeof state.angle === "number") {
            return state.angle;
        }
        return getTargetAngle(el, world, table);
    }

    /*
     * Compute the tip position for a given flipper angle.
     * Why: contact and draw both depend on the same geometry.
     */
    function getTipAtAngle(el, angle) {
        return {
            x: el.pivot.x + Math.cos(angle) * el.length,
            y: el.pivot.y + Math.sin(angle) * el.length,
            angle: angle
        };
    }

    /*
     * Compute the current tip position from runtime state.
     * Why: draw code should reflect the same angle used by collision.
     */
    function getTip(el, world, table) {
        return getTipAtAngle(el, getRuntimeAngle(el, world, table));
    }

    /*
     * Resolve the playable-side normal used for flipper lift.
     * Why: left and right flippers need mirrored normals, always biased upward.
     */
    function getLiftNormal(el, tip, table) {
        const control = getControlName(el, table);
        let nx;
        let ny;
        if (control === "right") {
            nx = -Math.sin(tip.angle);
            ny = Math.cos(tip.angle);
        } else {
            nx = Math.sin(tip.angle);
            ny = -Math.cos(tip.angle);
        }
        if (ny > 0) {
            nx = -nx;
            ny = -ny;
        }
        return { x: nx, y: ny };
    }

    /*
     * Normalize an angle delta to [-pi, pi].
     * Why: motion should travel the short way between rest and active angles.
     */
    function normalizeDelta(angle) {
        while (angle > Math.PI) angle -= Math.PI * 2;
        while (angle < -Math.PI) angle += Math.PI * 2;
        return angle;
    }

    /*
     * Determine the positive direction for an activating flipper.
     * Why: upstroke detection must work for both left and right flippers.
     */
    function getUpstrokeSign(el) {
        const delta = normalizeDelta((el.activeAngle || 0) - (el.restAngle || 0));
        return delta >= 0 ? 1 : -1;
    }

    /*
     * Return the speed limit for the current motion phase.
     * Why: press and return have distinct authorable speed caps.
     */
    function getMaxAngularSpeed(el, controlActive) {
        return controlActive ?
            (typeof el.flipSpeed === "number" ? el.flipSpeed : 24) :
            (typeof el.returnSpeed === "number" ? el.returnSpeed : 18);
    }

    /*
     * Return the acceleration for the current motion phase.
     * Why: flippers now accelerate rather than snapping at constant speed.
     */
    function getAngularAcceleration(el, controlActive) {
        if (controlActive) {
            if (typeof el.flipAccel === "number") return el.flipAccel;
            const speed = typeof el.flipSpeed === "number" ? el.flipSpeed : 24;
            return Math.max(40, speed * 9);
        }
        if (typeof el.returnAccel === "number") return el.returnAccel;
        const speed = typeof el.returnSpeed === "number" ? el.returnSpeed : 18;
        return Math.max(30, speed * 8);
    }

    /*
     * Resolve the flipper surface restitution.
     * Why: this is the physically meaningful normal bounce parameter for the
     * rubberized flipper face. A small legacy fallback keeps old tables sane.
     */
    function getSurfaceRestitution(el) {
        if (typeof el.surfaceRestitution === "number") return el.surfaceRestitution;
        if (typeof el.trapDamping === "number") {
            return Math.max(0.08, Math.min(0.4, el.trapDamping * 0.28));
        }
        return 0.28;
    }

    /*
     * Resolve the flipper surface friction.
     * Why: this controls tangential slip reduction along the blade. Legacy
     * damping fields are only used as a rough fallback for older tables.
     */
    function getSurfaceFriction(el) {
        if (typeof el.surfaceFriction === "number") return el.surfaceFriction;
        if (typeof el.tangentialDamping === "number") {
            return Math.max(0.02, Math.min(0.35, 1 - el.tangentialDamping));
        }
        return 0.08;
    }

    /*
     * Resolve the tip restitution separately from the blade body.
     * Why: the tip often needs a more lively contact response than the cradle
     * region so it does not feel glued to the ball.
     */
    function getTipRestitution(el) {
        if (typeof el.tipRestitution === "number") return el.tipRestitution;
        return Math.max(0.12, getSurfaceRestitution(el) * 1.35);
    }

    /*
     * Resolve the tip friction separately from the blade body.
     * Why: a tip that drags too much makes the ball feel sticky instead of
     * slipping and rebounding naturally.
     */
    function getTipFriction(el) {
        if (typeof el.tipFriction === "number") return el.tipFriction;
        return Math.max(0.01, getSurfaceFriction(el) * 0.5);
    }

    /*
     * Resolve the active strike assist term.
     * Why: the line-segment model still benefits from a small authored assist
     * on the upstroke so active flips feel lively without a large fake kick.
     */
    function getStrikeBoost(el) {
        if (typeof el.strikeBoost === "number") return el.strikeBoost;
        if (typeof el.impulse === "number") return Math.max(0, el.impulse * 0.2);
        return 0.52;
    }

    /*
     * Resolve the tip strike assist term.
     * Why: the end of the blade can need a slightly different launch response
     * than the center so contact feels less sticky at the far end.
     */
    function getTipStrikeBoost(el) {
        if (typeof el.tipStrikeBoost === "number") return el.tipStrikeBoost;
        return Math.max(0, getStrikeBoost(el) * 1.15);
    }

    /*
     * Build one collision segment for the current flipper sweep sample.
     * Why: moving flippers expose intermediate swept segments to prevent
     * tunneling and swallowed-ball behavior during fast motion.
     */
    function makeFlipperSegment(el, table, angle, sweepT, currentTip, angularVelocity, sweepOnly) {
        const tip = {
            x: el.pivot.x + Math.cos(angle) * el.length,
            y: el.pivot.y + Math.sin(angle) * el.length,
            angle: angle
        };
        return {
            x1: el.pivot.x,
            y1: el.pivot.y,
            x2: tip.x,
            y2: tip.y,
            role: "flipper",
            hitKey: "flipper:" + el.id,
            restitution: 0,
            skipDefaultResolve: true,
            sweepOnly: !!sweepOnly,
            thickness: typeof el.thickness === "number" ? el.thickness : 10,
            resolveNormal: function resolveNormal(ball, hit) {
                return getLiftNormal(el, currentTip || tip, table);
            },
            onHit: function onHit(ball, hit, world) {
                const lift = getLiftNormal(el, currentTip || tip, table);
                const contactT = Math.max(0, Math.min(1, hit && typeof hit.t === "number" ? hit.t : 0.5));
                const nx = hit && typeof hit.nx === "number" ? hit.nx : lift.x;
                const ny = hit && typeof hit.ny === "number" ? hit.ny : lift.y;
                const overlap = Math.max(0, hit && typeof hit.overlap === "number" ? hit.overlap : 0);
                if (overlap > 0) {
                    ball.x += nx * overlap;
                    ball.y += ny * overlap;
                }
                const tx = Math.cos(angle);
                const ty = Math.sin(angle);
                const surfaceSpeed = (angularVelocity || 0) * el.length * contactT / 120;
                const surfaceVx = -Math.sin(angle) * surfaceSpeed;
                const surfaceVy = Math.cos(angle) * surfaceSpeed;
                const relNormalVelocity = (ball.vx - surfaceVx) * nx + (ball.vy - surfaceVy) * ny;
                const relTangentialVelocity = (ball.vx - surfaceVx) * tx + (ball.vy - surfaceVy) * ty;
                const upstrokeSign = getUpstrokeSign(el);
                const upstrokeSpeed = (angularVelocity || 0) * upstrokeSign;
                const isDrivenHit = upstrokeSpeed > 3.1;
                const tipBlend = Math.max(0, Math.min(1, contactT));
                const tipProfile = tipBlend * tipBlend;
                const baseRestitution = Math.max(0, getSurfaceRestitution(el));
                const baseFriction = Math.max(0, getSurfaceFriction(el));
                const baseStrikeBoost = getStrikeBoost(el);
                const restitution = baseRestitution + (getTipRestitution(el) - baseRestitution) * tipProfile;
                const friction = baseFriction + (getTipFriction(el) - baseFriction) * tipProfile;
                const strikeBoost = baseStrikeBoost + (getTipStrikeBoost(el) - baseStrikeBoost) * tipProfile;
                const recentSupport = world && ball.supportContact &&
                    ball.supportContact.kind === "flipper" &&
                    ball.supportContact.hitKey === "flipper:" + el.id &&
                    ((world.physicsTick || 0) - (ball.supportContact.tick || 0) <= 3);
                let nextRelNormal = relNormalVelocity;
                let nextRelTangential = relTangentialVelocity;
                if (relNormalVelocity < 0) {
                    const incomingNormal = -relNormalVelocity;
                    const passiveRestitution = recentSupport ? 0 : restitution * (0.35 + contactT * 0.65);
                    nextRelNormal = incomingNormal * passiveRestitution;
                    const frictionScale = relTangentialVelocity < 0 ? 0.1 : 1;
                    const frictionImpulse = Math.min(Math.abs(relTangentialVelocity), incomingNormal * friction * frictionScale);
                    nextRelTangential -= Math.sign(relTangentialVelocity || 1) * frictionImpulse;
                } else if (relNormalVelocity < 0.45) {
                    // Supported rolling contact still needs surface friction even when
                    // the ball is no longer moving into the blade. Without this, the
                    // friction slider barely affects cradle/roll behavior after impact.
                    const supportLoad = 0.45 - relNormalVelocity;
                    const frictionScale = relTangentialVelocity < 0 ? 0.1 : 1;
                    const supportFriction = Math.min(Math.abs(relTangentialVelocity), supportLoad * friction * frictionScale);
                    nextRelTangential -= Math.sign(relTangentialVelocity || 1) * supportFriction;
                }
                if (isDrivenHit) {
                    const tipBias = 0.22 + 0.32 * contactT;
                    const sweepBoost = Math.min(0.12, upstrokeSpeed * 0.001);
                    const activeBoost = sweepT != null ? 0.18 + sweepT * 0.12 : 0.28;
                    nextRelNormal += strikeBoost * tipBias * (1 + sweepBoost) * activeBoost;
                }
                ball.vx = surfaceVx + tx * nextRelTangential + nx * nextRelNormal;
                ball.vy = surfaceVy + ty * nextRelTangential + ny * nextRelNormal;
                if (world) {
                    ball.supportContact = {
                        kind: "flipper",
                        hitKey: "flipper:" + el.id,
                        tick: world.physicsTick || 0,
                        supportRadius: ball.radius + (typeof el.thickness === "number" ? el.thickness : 10) + 8,
                        surfaceFriction: friction,
                        surfaceVx: surfaceVx,
                        surfaceVy: surfaceVy,
                        tx: tx,
                        ty: ty,
                        nx: nx,
                        ny: ny
                    };
                }
            }
        };
    }

    Pin.elements.register("flipper", {
        compile: function compile(el, table, world) {
            const dt = world && world.lastPhysicsDt ? world.lastPhysicsDt : 1 / 120;
            const controlActive = getControlState(el, world, table);
            const targetAngle = controlActive ? el.activeAngle : el.restAngle;
            const state = Pin.elements.getState ?
                Pin.elements.getState(world, el, { angle: el.restAngle, angularVelocity: 0 }) :
                { angle: targetAngle, angularVelocity: 0 };
            const prevAngle = typeof state.angle === "number" ? state.angle : targetAngle;
            const prevVelocity = typeof state.angularVelocity === "number" ? state.angularVelocity : 0;
            const toTarget = normalizeDelta(targetAngle - prevAngle);
            const desiredDir = Math.abs(toTarget) <= 0.0001 ? 0 : Math.sign(toTarget);
            const accel = getAngularAcceleration(el, controlActive);
            const maxSpeed = Math.max(0.001, getMaxAngularSpeed(el, controlActive));
            let angularVelocity = prevVelocity;
            if (desiredDir === 0) {
                angularVelocity = 0;
            } else {
                angularVelocity += desiredDir * accel * dt;
                if (Math.sign(angularVelocity) === desiredDir) {
                    angularVelocity = Math.sign(angularVelocity) * Math.min(Math.abs(angularVelocity), maxSpeed);
                }
            }
            let appliedDelta = angularVelocity * dt;
            let currentAngle = prevAngle + appliedDelta;
            if (desiredDir !== 0 && Math.sign(appliedDelta) === desiredDir && Math.abs(appliedDelta) >= Math.abs(toTarget)) {
                appliedDelta = toTarget;
                currentAngle = prevAngle + appliedDelta;
                angularVelocity = 0;
            }
            const tip = getTipAtAngle(el, currentAngle);
            const segments = [];
            const sweepSteps = Math.max(1, Math.min(6, Math.ceil(Math.abs(appliedDelta) / 0.12)));
            for (let i = 0; i <= sweepSteps; i++) {
                const t = sweepSteps === 0 ? 1 : i / sweepSteps;
                const angle = prevAngle + appliedDelta * t;
                segments.push(makeFlipperSegment(el, table, angle, t, tip, angularVelocity, i < sweepSteps));
            }
            if (world) {
                state.angle = currentAngle;
                state.angularVelocity = angularVelocity;
                state.targetAngle = targetAngle;
                state.active = controlActive;
            }
            return { segments: segments };
        },
        draw: function draw(ctx, el, runtime, world) {
            const tip = getTip(el, world, world && world.table);
            ctx.save();
            const baseColor = el.color || (el.side === "right" ? "#ff4466" : "#00ddff");
            const glowColor = el.glowColor || (el.side === "right" ? "#cc0033" : "#00aacc");
            const dx = tip.x - el.pivot.x;
            const dy = tip.y - el.pivot.y;
            const len = Math.max(1, Math.sqrt(dx * dx + dy * dy));
            const ux = dx / len;
            const uy = dy / len;
            const perpX = -uy;
            const perpY = ux;
            const baseWidth = 14;
            const tipWidth = 7;
            const grad = ctx.createLinearGradient(el.pivot.x, el.pivot.y, tip.x, tip.y);
            grad.addColorStop(0, baseColor);
            grad.addColorStop(1, glowColor);
            ctx.fillStyle = grad;
            Pin.render.makeGlow(ctx, glowColor, 12);
            ctx.strokeStyle = "rgba(255,255,255,0.58)";
            ctx.lineWidth = 2;
            ctx.beginPath();
            ctx.moveTo(el.pivot.x + perpX * baseWidth, el.pivot.y + perpY * baseWidth);
            ctx.lineTo(tip.x + perpX * tipWidth, tip.y + perpY * tipWidth);
            ctx.arc(tip.x, tip.y, tipWidth, Math.atan2(perpY, perpX), Math.atan2(-perpY, -perpX), true);
            ctx.lineTo(el.pivot.x - perpX * baseWidth, el.pivot.y - perpY * baseWidth);
            ctx.arc(el.pivot.x, el.pivot.y, baseWidth, Math.atan2(-perpY, -perpX), Math.atan2(perpY, perpX), true);
            ctx.closePath();
            ctx.fill();
            ctx.stroke();
            ctx.fillStyle = "#ffffff";
            Pin.render.makeGlow(ctx, "#ffffff", 6);
            ctx.beginPath();
            ctx.arc(el.pivot.x, el.pivot.y, 5, 0, Math.PI * 2);
            ctx.fill();
            ctx.restore();
        },
        editor: { handles: true, hitTest: true, inspectorFields: ["side", "control", "length", "restAngle", "activeAngle", "flipSpeed", "flipAccel", "returnSpeed", "returnAccel", "strikeBoost", "tipStrikeBoost", "surfaceRestitution", "surfaceFriction", "tipRestitution", "tipFriction", "thickness", "color", "glowColor"] }
    });
})(window.Pin);
