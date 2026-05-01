(function initAudio(Pin) {
    let audioCtx = null;

    function ensure() {
        if (!audioCtx) audioCtx = new(window.AudioContext || window.webkitAudioContext)();
        if (audioCtx.state === "suspended") audioCtx.resume();
    }

    function beep(freq, duration, type, vol, slide) {
        if (!audioCtx) return;
        const t = audioCtx.currentTime;
        const osc = audioCtx.createOscillator();
        const gain = audioCtx.createGain();
        osc.type = type || "square";
        osc.frequency.setValueAtTime(freq, t);
        if (slide) osc.frequency.linearRampToValueAtTime(freq + slide, t + duration);
        gain.gain.setValueAtTime(vol || 0.08, t);
        gain.gain.exponentialRampToValueAtTime(0.0001, t + duration);
        osc.connect(gain);
        gain.connect(audioCtx.destination);
        osc.start(t);
        osc.stop(t + duration);
    }

    Pin.audio = {
        ensure: ensure,
        flipper: function flipper() { beep(80, 0.04, "square", 0.05, 0); },
        bumper: function bumper() { beep(600, 0.08, "square", 0.1, -300); },
        target: function target() { beep(900, 0.06, "triangle", 0.12, 0); beep(1200, 0.04, "triangle", 0.06, 0); },
        launch: function launch() { beep(150, 0.4, "triangle", 0.12, 500); },
        sling: function sling() { beep(200, 0.1, "sawtooth", 0.08, 400); },
        bonus: function bonus() { beep(800, 0.08, "triangle", 0.1, 0); beep(1000, 0.08, "triangle", 0.1, 0); },
        spinner: function spinner() { beep(1900, 0.03, "triangle", 0.04, -500); },
        drain: function drain() { beep(70, 0.2, "sawtooth", 0.08, -30); beep(52, 0.35, "triangle", 0.06, -16); },
        restart: function restart() { beep(420, 0.05, "square", 0.06, 80); beep(560, 0.07, "square", 0.05, 0); },
        gameOver: function gameOver() { beep(220, 0.12, "triangle", 0.07, -80); beep(165, 0.18, "triangle", 0.06, -60); beep(110, 0.26, "sine", 0.05, -25); }
    };
})(window.Pin);
