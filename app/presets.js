(function initPresets(Pin) {
    Pin.presets = Pin.presets || {};
    Pin.presets.cyberpin = {
        version: 1,
        name: "Neon Cyberpin",
        playfield: {
            width: 500,
            height: 880,
            gravity: 0.35,
            friction: 0.999,
            restitution: 0.55,
            maxSpeed: 24,
            realTimeScale: 1,
            tilt: {
                enabled: true,
                impulseX: 0,
                impulseY: -8,
                cooldownSeconds: 0.35,
                warningWindowSeconds: 2,
                warningLimit: 3
            }
        },
        rules: { balls: 3, highScoreKey: "cyberpinHighScore" },
        launcher: { x: 439, y: 710, dir: { x: 0, y: -1 }, maxPower: 42 },
        elements: [
            { id: "outerWall", type: "path", role: "wall", closed: true, anchors: [{ x: 35, y: 75 }, { x: 465, y: 75 }, { x: 470, y: 200 }, { x: 470, y: 600 }, { x: 455, y: 700 }, { x: 360, y: 720 }, { x: 140, y: 720 }, { x: 45, y: 700 }, { x: 30, y: 600 }, { x: 30, y: 200 }] },
            { id: "launchLane", type: "launcher", x: 439, top: 195, bottom: 735, width: 38, maxPower: 42, maxRetract: 65, pullSpeed: 95, returnSpeed: 220, springStrength: 1 },
            { id: "leftSling", type: "path", role: "slingshot", impulseX: 1, impulseY: -10, closed: false, anchors: [{ x: 45, y: 580 }, { x: 90, y: 640 }] },
            { id: "rightSling", type: "path", role: "slingshot", impulseX: -1, impulseY: -10, closed: false, anchors: [{ x: 390, y: 580 }, { x: 345, y: 640 }] },
            { id: "lf", type: "flipper", side: "left", control: "left", pivot: { x: 135, y: 685 }, length: 95, restAngle: 0.55, activeAngle: -0.55, flipSpeed: 24, flipAccel: 220, returnSpeed: 18, returnAccel: 160, strikeBoost: 0.52, surfaceRestitution: 0.28, surfaceFriction: 0.08, thickness: 10, color: "#00ddff" },
            { id: "rf", type: "flipper", side: "right", control: "right", pivot: { x: 365, y: 685 }, length: 95, restAngle: 2.5915926535, activeAngle: 3.6915926535, flipSpeed: 24, flipAccel: 220, returnSpeed: 18, returnAccel: 160, strikeBoost: 0.52, surfaceRestitution: 0.28, surfaceFriction: 0.08, thickness: 10, color: "#ff4466" },
            { id: "drain1", type: "drain", x: 250, y: 842, w: 170, h: 24, color: "#ff4466" },
            { id: "trough1", type: "trough", x: 250, y: 812, radius: 18, holdSeconds: 0.75, ejectPower: 10, ejectAngle: -1.5707963267948966, color: "#88aaff", pitColor: "#08101f" },
            { id: "bumper1", type: "bumper", x: 160, y: 280, radius: 28, power: 12 },
            { id: "laneA", type: "lane", x: 80, y: 115, w: 40, h: 20 },
            { id: "laneB", type: "lane", x: 155, y: 115, w: 40, h: 20 },
            { id: "laneC", type: "lane", x: 230, y: 115, w: 40, h: 20 },
            { id: "scoreZone1", type: "scoreZone", x: 380, y: 370, radius: 22, score: 1000, color: "#33ccff" },
            { id: "lampLaneA", type: "light", x: 80, y: 145, radius: 11, lampId: "lamp_lane_a", label: "A", color: "#ffee55" },
            { id: "lampLaneB", type: "light", x: 155, y: 145, radius: 11, lampId: "lamp_lane_b", label: "B", color: "#ffee55" },
            { id: "lampLaneC", type: "light", x: 230, y: 145, radius: 11, lampId: "lamp_lane_c", label: "C", color: "#ffee55" },
            { id: "lampBonusTarget", type: "light", x: 380, y: 405, radius: 13, lampId: "lamp_bonus_target", label: "BON", color: "#33ccff" }
        ]
    };
})(window.Pin);
