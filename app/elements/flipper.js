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
     * Compute the flipper surface velocity at a contact position.
     * Why: persistent contacts must use the current flipper motion, not a stale
     * velocity captured when the ball first touched the blade.
     */
    function getSurfaceVelocityAtAngle(el, angle, angularVelocity, contactT) {
        const t = Math.max(0, Math.min(1, typeof contactT === "number" ? contactT : 0.5));
        const surfaceSpeed = (angularVelocity || 0) * el.length * t / 120;
        return {
            x: -Math.sin(angle) * surfaceSpeed,
            y: Math.cos(angle) * surfaceSpeed
        };
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
     * Normalize a 2D vector when it is safe to use as a contact direction.
     * Why: swept endpoint hits can carry unnormalized normals, while response
     * code needs a unit frame to keep rebound and friction predictable.
     */
    function normalizeVector(x, y) {
        const len = Math.sqrt(x * x + y * y);
        if (len <= 0.000001) return null;
        return { x: x / len, y: y / len };
    }

    /*
     * Read the contact's progress along the flipper centerline.
     * Why: overlap collisions report t, while swept collisions report tSeg
     * before physics builds the final hit object.
     */
    function getContactT(hit) {
        if (hit && typeof hit.t === "number") return hit.t;
        if (hit && typeof hit.tSeg === "number") return hit.tSeg;
        return 0.5;
    }

    /*
     * Return the radial normal for a rounded flipper end-cap contact.
     * Why: the pivot and tip are circular ends, not flat blade surfaces, so
     * their collision normals must come from the actual cap hit.
     */
    function getRoundedEndNormal(hit) {
        const contactT = getContactT(hit);
        if (contactT > 0.000001 && contactT < 0.999999) return null;
        if (typeof hit.nx !== "number" || typeof hit.ny !== "number") return null;
        return normalizeVector(hit.nx, hit.ny);
    }

    /*
     * Build the contact frame used by the flipper collision response.
     * Why: blade contacts need the authored lift normal, while rounded end caps
     * need radial normals and tangents so elbow and tip hits deflect correctly.
     */
    function getContactFrame(el, angle, hit, tip, table) {
        const bladeTx = Math.cos(angle);
        const bladeTy = Math.sin(angle);
        const contactT = getContactT(hit);
        const capNormal = getRoundedEndNormal(hit);
        if (!capNormal) {
            const lift = getLiftNormal(el, tip, table);
            return { nx: lift.x, ny: lift.y, tx: bladeTx, ty: bladeTy, roundedEnd: "" };
        }

        let capTx = -capNormal.y;
        let capTy = capNormal.x;
        if (capTx * bladeTx + capTy * bladeTy < 0) {
            capTx = -capTx;
            capTy = -capTy;
        }
        return { nx: capNormal.x, ny: capNormal.y, tx: capTx, ty: capTy, roundedEnd: contactT <= 0.000001 ? "pivot" : "tip" };
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
     * Clamp a value between bounds.
     * Why: flipper angle integration must stay within authored travel limits.
     */
    function clamp(value, min, max) {
        return Math.max(min, Math.min(max, value));
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
     * rubberized flipper face.
     */
    function getSurfaceRestitution(el) {
        if (typeof el.surfaceRestitution === "number") return el.surfaceRestitution;
        return 0.28;
    }

    /*
     * Resolve the flipper surface friction.
     * Why: this controls tangential slip reduction along the blade.
     */
    function getSurfaceFriction(el) {
        if (typeof el.surfaceFriction === "number") return el.surfaceFriction;
        return 0.08;
    }

    /*
     * Resolve tip restitution from current flipper tuning.
     * Why: tip behavior can be authored separately from the blade surface.
     */
    function getTipRestitution(el) {
        if (typeof el.tipRestitution === "number") return el.tipRestitution;
        return getSurfaceRestitution(el);
    }

    /*
     * Resolve tip friction from current flipper tuning.
     * Why: tip behavior can be authored separately from the blade surface.
     */
    function getTipFriction(el) {
        if (typeof el.tipFriction === "number") return el.tipFriction;
        return getSurfaceFriction(el);
    }

    /*
     * Resolve the active strike assist term.
     * Why: the line-segment model still benefits from a small authored assist
     * on the upstroke so active flips feel lively without a large fake kick.
     */
    function getStrikeBoost(el) {
        if (typeof el.strikeBoost === "number") return el.strikeBoost;
        return 0.52;
    }

    /*
     * Resolve tip strike assist from current flipper tuning.
     * Why: tip shots can need a different strike profile from blade hits.
     */
    function getTipStrikeBoost(el) {
        if (typeof el.tipStrikeBoost === "number") return el.tipStrikeBoost;
        return getStrikeBoost(el);
    }

    /*
     * Build one collision segment for the current flipper sweep sample.
     * Why: moving flippers expose intermediate swept segments to prevent
     * tunneling and swallowed-ball behavior during fast motion.
     */
    function makeFlipperSegment(el, table, angle, sweepT, currentTip, angularVelocity, controlActive, sweepOnly) {
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
            controlActive: !!controlActive,
            thickness: typeof el.thickness === "number" ? el.thickness : 10,
            surfaceVelocityAt: function surfaceVelocityAt(contactT) {
                return getSurfaceVelocityAtAngle(el, angle, angularVelocity, contactT);
            },
            resolveNormal: function resolveNormal(ball, hit) {
                const frame = getContactFrame(el, angle, hit, currentTip || tip, table);
                return { x: frame.nx, y: frame.ny };
            },
            onHit: function onHit(ball, hit, world) {
                const contactT = Math.max(0, Math.min(1, getContactT(hit)));
                const frame = getContactFrame(el, angle, hit, currentTip || tip, table);
                const nx = frame.nx;
                const ny = frame.ny;
                const overlap = Math.max(0, hit && typeof hit.overlap === "number" ? hit.overlap : 0);
                if (overlap > 0) {
                    ball.x += nx * overlap;
                    ball.y += ny * overlap;
                }
                const tx = frame.tx;
                const ty = frame.ty;
                const surfaceVelocity = getSurfaceVelocityAtAngle(el, angle, angularVelocity, contactT);
                const surfaceVx = surfaceVelocity.x;
                const surfaceVy = surfaceVelocity.y;
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
                // The tip cap is a deflector, not a cradle surface; persistent
                // support there can trap a ball at the end of the flipper.
                if (world && frame.roundedEnd !== "tip") {
                    ball.supportContact = {
                        kind: "flipper",
                        hitKey: "flipper:" + el.id,
                        controlActive: !!getControlState(el, world, table),
                        tick: world.physicsTick || 0,
                        contactRadius: ball.radius + (typeof el.thickness === "number" ? el.thickness : 10),
                        contactSlop: 2,
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
            const minAngle = Math.min(el.restAngle, el.activeAngle);
            const maxAngle = Math.max(el.restAngle, el.activeAngle);
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
            const clampedAngle = clamp(currentAngle, minAngle, maxAngle);
            if (clampedAngle !== currentAngle) {
                currentAngle = clampedAngle;
                appliedDelta = currentAngle - prevAngle;
                if (appliedDelta === 0 || Math.sign(angularVelocity) === Math.sign(prevVelocity)) {
                    angularVelocity = 0;
                }
            }
            const tip = getTipAtAngle(el, currentAngle);
            const segments = [];
            const sweepSteps = Math.max(1, Math.min(6, Math.ceil(Math.abs(appliedDelta) / 0.12)));
            for (let i = 0; i <= sweepSteps; i++) {
                const t = sweepSteps === 0 ? 1 : i / sweepSteps;
                const angle = prevAngle + appliedDelta * t;
                segments.push(makeFlipperSegment(el, table, angle, t, tip, angularVelocity, controlActive, i < sweepSteps));
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
        editor: { handles: true, hitTest: true, inspectorFields: ["side", "control", "length", "restAngle", "activeAngle", "flipSpeed", "flipAccel", "returnSpeed", "returnAccel", "strikeBoost", "surfaceRestitution", "surfaceFriction", "thickness", "color", "glowColor"] }
    });
})(window.Pin);
