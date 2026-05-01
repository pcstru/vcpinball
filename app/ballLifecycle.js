(function initBallLifecycle(Pin) {
    function makeLaunchBall(world) {
        const launcher = Pin.physics.getLauncherConfig(world);
        const playfield = (world && world.table && world.table.playfield) || {};
        return {
            x: launcher.x,
            y: launcher.y,
            vx: 0,
            vy: 0,
            radius: typeof playfield.ballRadius === "number" ? playfield.ballRadius : 8,
            level: 0,
            z: 0,
            surfaceId: null,
            rampState: null,
            inLaunchLane: true
        };
    }

    function update(world) {
        const pf = world.table.playfield;
        const before = world.balls.length;
        world.balls = world.balls.filter(function keep(ball) {
            return !ball.drained && ball.y <= pf.height + 40;
        });
        const drained = before - world.balls.length;
        if (!drained || world.state === "game_over") return { drained: drained, served: 0, gameOver: world.state === "game_over" };

        if (Pin.events) Pin.events.emit(world, { type: "ballDrained", count: drained });
        world.ballsRemaining -= drained;
        if (world.ballsRemaining <= 0) {
            world.state = "game_over";
            return { drained: drained, served: 0, gameOver: true };
        }

        world.currentBall += drained;
        world.balls.push(makeLaunchBall(world));
        world.state = "ready";
        return { drained: drained, served: 1, gameOver: false };
    }

    Pin.ballLifecycle = {
        makeLaunchBall: makeLaunchBall,
        update: update
    };
})(window.Pin);
