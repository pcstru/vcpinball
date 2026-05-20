(function initTableModule(Pin) {
    const DEFAULT_PLAYFIELD = {
        width: 500,
        height: 880,
        ballRadius: 8,
        gravity: 0.35,
        friction: 0.999,
        restitution: 0.55,
        maxSpeed: 24
    };
    const DEFAULT_FLIPPER_TUNING = {
        flipSpeed: 24,
        flipAccel: 220,
        returnSpeed: 18,
        returnAccel: 160,
        strikeBoost: 0.52,
        surfaceRestitution: 0.28,
        surfaceFriction: 0.08,
        thickness: 10
    };

    function createEmptyTable() {
        return {
            version: 1,
            name: "Untitled Table",
            playfield: Object.assign({}, DEFAULT_PLAYFIELD),
            rules: { balls: 3, highScoreKey: "pinball.generic.highscore" },
            logicDocument: {
                logicVersion: 1,
                switchRegistry: [],
                stateTable: [],
                computedState: [],
                lampBindings: [],
                actionRules: [],
                resetRules: []
            },
            levels: [
                { level: 0, name: "Playfield", parentLevel: null, elevation: 0, editorVisible: true },
                { level: 1, name: "Upper Level", parentLevel: 0, elevation: 48, editorVisible: true }
            ],
            features: [],
            images: [],
            elements: [
                {
                    id: "outerWall",
                    type: "path",
                    level: 0,
                    role: "wall",
                    transparency: 1,
                    closed: true,
                    anchors: [
                        { x: 10, y: 150, outHandle: { x: 0, y: -58 } },
                        { x: 82, y: 72, inHandle: { x: -34, y: 0 }, outHandle: { x: 48, y: -22 } },
                        { x: 250, y: 28, inHandle: { x: -62, y: 0 }, outHandle: { x: 62, y: 0 } },
                        { x: 418, y: 72, inHandle: { x: -48, y: -22 }, outHandle: { x: 34, y: 0 } },
                        { x: 490, y: 150, inHandle: { x: 0, y: -58 } },
                        { x: 490, y: 220 },
                        { x: 490, y: 870 },
                        { x: 10, y: 870 },
                        { x: 10, y: 220 }
                    ]
                },
                {
                    id: "launchLane",
                    type: "launcher",
                    level: 0,
                    x: 439,
                    top: 555,
                    bottom: 735,
                    width: 38,
                    maxPower: 42,
                    maxRetract: 65,
                    pullSpeed: 95,
                    returnSpeed: 220,
                    springStrength: 1
                },
                {
                    id: "lf",
                    type: "flipper",
                    level: 0,
                    side: "left",
                    control: "left",
                    pivot: { x: 135, y: 685 },
                    length: 95,
                    restAngle: 0.55,
                    activeAngle: -0.55,
                    flipSpeed: DEFAULT_FLIPPER_TUNING.flipSpeed,
                    flipAccel: DEFAULT_FLIPPER_TUNING.flipAccel,
                    returnSpeed: DEFAULT_FLIPPER_TUNING.returnSpeed,
                    returnAccel: DEFAULT_FLIPPER_TUNING.returnAccel,
                    strikeBoost: DEFAULT_FLIPPER_TUNING.strikeBoost,
                    surfaceRestitution: DEFAULT_FLIPPER_TUNING.surfaceRestitution,
                    surfaceFriction: DEFAULT_FLIPPER_TUNING.surfaceFriction,
                    thickness: DEFAULT_FLIPPER_TUNING.thickness,
                    color: "#00ddff"
                },
                {
                    id: "rf",
                    type: "flipper",
                    level: 0,
                    side: "right",
                    control: "right",
                    pivot: { x: 365, y: 685 },
                    length: 95,
                    restAngle: 2.5915926535,
                    activeAngle: 3.6915926535,
                    flipSpeed: DEFAULT_FLIPPER_TUNING.flipSpeed,
                    flipAccel: DEFAULT_FLIPPER_TUNING.flipAccel,
                    returnSpeed: DEFAULT_FLIPPER_TUNING.returnSpeed,
                    returnAccel: DEFAULT_FLIPPER_TUNING.returnAccel,
                    strikeBoost: DEFAULT_FLIPPER_TUNING.strikeBoost,
                    surfaceRestitution: DEFAULT_FLIPPER_TUNING.surfaceRestitution,
                    surfaceFriction: DEFAULT_FLIPPER_TUNING.surfaceFriction,
                    thickness: DEFAULT_FLIPPER_TUNING.thickness,
                    color: "#ff4466"
                }
            ]
        };
    }

    function cloneTable(table) {
        return JSON.parse(JSON.stringify(table));
    }

    function safeLauncherWidth(playfield) {
        /*
         * What: Resolve the minimum lane width that can hold and release a ball.
         * Why: narrower launcher lanes overlap the ball against both side walls,
         * which can trap launch balls and stall play.
         */
        const radius = playfield && typeof playfield.ballRadius === "number" && !Number.isNaN(playfield.ballRadius) ?
            Math.max(1, playfield.ballRadius) :
            DEFAULT_PLAYFIELD.ballRadius;
        return radius * 2 + 6;
    }

    function clampLauncherWidth(launcher, playfield) {
        if (!launcher || launcher.type !== "launcher") return launcher;
        const minWidth = safeLauncherWidth(playfield);
        const width = typeof launcher.width === "number" && !Number.isNaN(launcher.width) ? launcher.width : minWidth;
        launcher.width = Math.max(minWidth, width);
        return launcher;
    }

    function clampLauncherWidths(table) {
        if (!table || !Array.isArray(table.elements)) return table;
        const playfield = table.playfield || DEFAULT_PLAYFIELD;
        table.elements.forEach(function each(el) {
            clampLauncherWidth(el, playfield);
        });
        return table;
    }

    function fallbackElementName(element) {
        /* What: Build a readable default element name.
         * Why: Logic authoring and selection are clearer with human labels.
         */
        if (!element || typeof element !== "object") return "";
        if (typeof element.label === "string" && element.label.trim()) return element.label.trim();
        if (typeof element.id === "string" && element.id.trim()) return element.id.trim();
        if (typeof element.type === "string" && element.type.trim()) return element.type.trim();
        return "element";
    }

    function normalizeTable(input) {
        const source = input && typeof input === "object" ? input : {};
        const table = cloneTable(source);
        const defaults = createEmptyTable();
        if (table.version == null) table.version = defaults.version;
        if (typeof table.name !== "string") table.name = defaults.name;
        table.playfield = Object.assign({}, defaults.playfield, table.playfield || {});
        table.rules = Object.assign({}, defaults.rules, table.rules || {});
        if (typeof table.rules.balls !== "number" || Number.isNaN(table.rules.balls) || table.rules.balls < 1) {
            table.rules.balls = defaults.rules.balls;
        }
        if (typeof table.rules.highScoreKey !== "string" || !table.rules.highScoreKey) {
            table.rules.highScoreKey = defaults.rules.highScoreKey;
        }
        if (!Array.isArray(table.levels)) table.levels = cloneTable(defaults.levels);
        if (!Array.isArray(table.features)) table.features = [];
        if (!Array.isArray(table.images)) table.images = [];
        if (!Array.isArray(table.elements)) table.elements = [];
        if (!table.logicDocument || typeof table.logicDocument !== "object") {
            table.logicDocument = cloneTable(defaults.logicDocument);
        }
        table.elements.forEach(function ensureElementName(el) {
            if (!el || typeof el !== "object") return;
            if (typeof el.name !== "string" || !el.name.trim()) el.name = fallbackElementName(el);
            if (el.type === "gate") {
                const restAngle = typeof el.swingStartAngle === "number" ? el.swingStartAngle : (typeof el.angle === "number" ? el.angle : 0);
                if (typeof el.angle !== "number") el.angle = restAngle;
                if (typeof el.swingStartAngle !== "number") el.swingStartAngle = restAngle;
                if (typeof el.swingAngle !== "number") {
                    if (typeof el.swingEndAngle === "number") el.swingAngle = el.swingEndAngle - restAngle;
                    else el.swingAngle = Math.abs(typeof el.maxAngle === "number" ? el.maxAngle : 1.05);
                }
                if (typeof el.swingEndAngle !== "number") el.swingEndAngle = restAngle + el.swingAngle;
            }
        });
        clampLauncherWidths(table);
        return table;
    }

    function validateTable(table) {
        const issues = [];
        const errors = [];
        function issue(severity, message) {
            issues.push({ severity: severity, message: message });
            if (severity === "error") errors.push(message);
        }

        if (!table || typeof table !== "object") issue("error", "Table must be an object.");
        if (!table || table.version !== 1) issue("error", "Table version must be 1.");
        if (!table || typeof table.name !== "string") issue("error", "Table name must be a string.");
        if (table && table.date != null && typeof table.date !== "string") issue("warning", "date should be a string when present.");
        if (table && table.tableVersion != null && typeof table.tableVersion !== "string" && typeof table.tableVersion !== "number") {
            issue("warning", "tableVersion should be a string or number when present.");
        }
        if (!table || !table.playfield) issue("error", "Missing playfield.");
        if (!table || !table.rules || typeof table.rules !== "object") issue("error", "Missing rules.");
        if (table && !Array.isArray(table.elements)) issue("error", "elements must be an array.");
        if (table && table.logicDocument != null && typeof table.logicDocument !== "object") {
            issue("error", "logicDocument must be an object when present.");
        }
        if (table && table.playfield) {
            ["width", "height", "ballRadius", "gravity", "friction", "restitution", "maxSpeed"].forEach(function checkNumber(k) {
                if (typeof table.playfield[k] !== "number" || Number.isNaN(table.playfield[k])) {
                    issue("error", "playfield." + k + " must be a number.");
                }
            });
        }
        if (table && table.rules) {
            if (typeof table.rules.balls !== "number" || Number.isNaN(table.rules.balls) || table.rules.balls < 1) {
                issue("error", "rules.balls must be a positive number.");
            }
            if (typeof table.rules.highScoreKey !== "string" || !table.rules.highScoreKey) {
                issue("warning", "rules.highScoreKey should be a non-empty string.");
            }
        }
        if (table && table.levels != null && !Array.isArray(table.levels)) {
            issue("error", "levels must be an array when present.");
        }
        if (table && table.features != null && !Array.isArray(table.features)) {
            issue("error", "features must be an array when present.");
        }
        if (table && Array.isArray(table.features)) {
            const featureIds = {};
            table.features.forEach(function validateFeature(feature, i) {
                if (!feature || typeof feature !== "object") {
                    issue("error", "features[" + i + "] must be an object.");
                    return;
                }
                if (typeof feature.id !== "string" || !feature.id) {
                    issue("warning", "features[" + i + "].id should be a non-empty string.");
                } else if (featureIds[feature.id]) {
                    issue("error", "Duplicate feature id '" + feature.id + "'.");
                } else {
                    featureIds[feature.id] = true;
                }
                if (feature.name != null && typeof feature.name !== "string") {
                    issue("warning", "features[" + i + "].name should be a string.");
                }
                if (feature.description != null && typeof feature.description !== "string") {
                    issue("warning", "features[" + i + "].description should be a string.");
                }
                if (feature.goal != null && typeof feature.goal !== "string") {
                    issue("warning", "features[" + i + "].goal should be a string.");
                }
                ["objects", "states", "rules", "lamps"].forEach(function checkList(key) {
                    if (feature[key] == null) return;
                    if (!Array.isArray(feature[key])) {
                        issue("warning", "features[" + i + "]." + key + " should be an array.");
                        return;
                    }
                    feature[key].forEach(function checkEntry(value, j) {
                        if (typeof value !== "string") {
                            issue("warning", "features[" + i + "]." + key + "[" + j + "] should be a string.");
                        }
                    });
                });
            });
        }
        if (table && Array.isArray(table.levels)) {
            const levelSeen = {};
            table.levels.forEach(function validateLevel(entry, i) {
                if (!entry || typeof entry !== "object") {
                    issue("error", "levels[" + i + "] must be an object.");
                    return;
                }
                if (typeof entry.level !== "number" || Number.isNaN(entry.level)) {
                    issue("error", "levels[" + i + "].level must be a number.");
                } else if (levelSeen[entry.level]) {
                    issue("error", "Duplicate level " + entry.level + ".");
                } else {
                    levelSeen[entry.level] = true;
                }
                if (entry.name != null && typeof entry.name !== "string") {
                    issue("warning", "levels[" + i + "].name should be a string.");
                }
            });
        }
        if (table && Array.isArray(table.elements)) {
            const ids = {};
            table.elements.forEach(function validateElement(el, i) {
                if (!el || typeof el !== "object") {
                    issue("error", "elements[" + i + "] must be an object.");
                    return;
                }
                if (typeof el.id !== "string" || !el.id) issue("error", "elements[" + i + "].id must be a string.");
                else if (ids[el.id]) issue("error", "Duplicate element id '" + el.id + "'.");
                else ids[el.id] = true;
                if (typeof el.type !== "string") issue("error", "elements[" + i + "].type must be a string.");
                if (el.level != null && (typeof el.level !== "number" || Number.isNaN(el.level))) {
                    issue("warning", "elements[" + i + "].level should be a number when present.");
                }
            });
        }
        if (table && table.images != null && !Array.isArray(table.images)) {
            issue("error", "images must be an array when present.");
        }
        if (table && Array.isArray(table.images)) {
            table.images.forEach(function validateImage(image, i) {
                if (!image || typeof image !== "object") {
                    issue("error", "images[" + i + "] must be an object.");
                    return;
                }
                if (typeof image.src !== "string" || !image.src) issue("warning", "images[" + i + "] is missing src.");
                if (image.mode && ["play", "design", "both"].indexOf(image.mode) < 0) {
                    issue("warning", "images[" + i + "].mode should be play, design, or both.");
                }
                if (image.fit && ["contain", "cover", "stretch", "none"].indexOf(image.fit) < 0) {
                    issue("warning", "images[" + i + "].fit should be contain, cover, stretch, or none.");
                }
            });
        }
        return { ok: errors.length === 0, errors: errors, issues: issues };
    }

    function validatePlayability(table) {
        const structural = validateTable(table);
        const issues = (structural.issues || []).slice();
        if (!table || !Array.isArray(table.elements)) return issues;
        const elements = table.elements;
        const playfield = table.playfield || DEFAULT_PLAYFIELD;
        const byType = {};
        elements.forEach(function each(el) {
            if (!el || !el.type) return;
            byType[el.type] = byType[el.type] || [];
            byType[el.type].push(el);
        });

        function add(severity, message) {
            issues.push({ severity: severity, message: message });
        }

        const launchers = byType.launcher || [];
        const drains = byType.drain || [];
        const troughs = byType.trough || [];
        const flippers = byType.flipper || [];
        const ramps = byType.ramp || [];

        if (!launchers.length) add("warning", "No selectable launcher element is present.");
        if (!drains.length) add("warning", "No drain sensor is present; balls may never enter the trough.");
        if (!drains.length && !troughs.length) add("warning", "No drain or trough element is present; balls may not leave play cleanly.");
        if (flippers.length < 2) add("warning", "Fewer than two flippers are present.");
        launchers.forEach(function checkLauncher(el) {
            const x = el.x || 0;
            const top = el.top || 0;
            const bottom = el.bottom || 0;
            const width = typeof el.width === "number" && !Number.isNaN(el.width) ? el.width : 0;
            const minWidth = safeLauncherWidth(playfield);
            if (x < 0 || x > playfield.width || top < 0 || bottom > playfield.height || bottom <= top) {
                add("warning", "Launcher '" + el.id + "' is outside the playfield or has invalid top/bottom values.");
            }
            if (width < minWidth) {
                add("warning", "Launcher '" + el.id + "' is narrower than the ball-safe minimum width of " + minWidth + ".");
            }
        });
        ramps.forEach(function checkRamp(el) {
            if (!Array.isArray(el.leftAnchors) || el.leftAnchors.length < 2) {
                add("warning", "Ramp '" + el.id + "' needs at least two left anchors.");
            }
            if (!Array.isArray(el.rightAnchors) || el.rightAnchors.length < 2) {
                add("warning", "Ramp '" + el.id + "' needs at least two right anchors.");
            }
            if (el.levelFrom === el.levelTo) {
                add("warning", "Ramp '" + el.id + "' has the same entry and exit level.");
            }
            if (typeof el.zStart === "number" && typeof el.zEnd === "number" && el.zStart === el.zEnd) {
                add("info", "Ramp '" + el.id + "' has no elevation change.");
            }
        });
        return issues;
    }

    Pin.table = {
        createEmptyTable: createEmptyTable,
        cloneTable: cloneTable,
        normalizeTable: normalizeTable,
        validateTable: validateTable,
        validatePlayability: validatePlayability,
        safeLauncherWidth: safeLauncherWidth,
        clampLauncherWidth: clampLauncherWidth,
        clampLauncherWidths: clampLauncherWidths,
        DEFAULT_PLAYFIELD: DEFAULT_PLAYFIELD,
        DEFAULT_FLIPPER_TUNING: DEFAULT_FLIPPER_TUNING
    };
})(window.Pin);
