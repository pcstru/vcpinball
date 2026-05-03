(function initEditorModel(Pin) {
    function defaultLevel(level, name, parentLevel) {
        return {
            level: level,
            name: name || ("Level " + level),
            parentLevel: typeof parentLevel === "number" ? parentLevel : null,
            elevation: level * 48,
            editorVisible: true
        };
    }

    function inferMaxLevel(table) {
        let maxLevel = 0;
        (table.elements || []).forEach(function each(el) {
            if (!el) return;
            if (typeof el.level === "number") maxLevel = Math.max(maxLevel, el.level);
            if (typeof el.levelFrom === "number") maxLevel = Math.max(maxLevel, el.levelFrom);
            if (typeof el.levelTo === "number") maxLevel = Math.max(maxLevel, el.levelTo);
        });
        return maxLevel;
    }

    function coerceBoolean(value) {
        if (typeof value === "string") return value !== "false" && value !== "0" && value !== "";
        return !!value;
    }

    function createDefaultElement(type, makeId) {
        if (type === "bumper") return { id: makeId(type), type: "bumper", x: 250, y: 300, radius: 24, power: 12, restitution: 0.8, score: 100, level: 0 };
        if (type === "leftFlipper") {
                return {
                    id: makeId("flipper"),
                    type: "flipper",
                    level: 0,
                    side: "left",
                control: "left",
                pivot: { x: 165, y: 720 },
                length: 95,
                restAngle: -0.5,
                activeAngle: -1.1,
                flipSpeed: 24,
                flipAccel: 220,
                returnSpeed: 18,
                returnAccel: 160,
                strikeBoost: 0.52,
                surfaceRestitution: 0.28,
                surfaceFriction: 0.08,
                thickness: 10
            };
        }
        if (type === "rightFlipper") {
            return {
                id: makeId("flipper"),
                type: "flipper",
                level: 0,
                side: "right",
                control: "right",
                pivot: { x: 335, y: 720 },
                length: 95,
                restAngle: Math.PI + 0.5,
                activeAngle: Math.PI + 1.1,
                flipSpeed: 24,
                flipAccel: 220,
                returnSpeed: 18,
                returnAccel: 160,
                strikeBoost: 0.52,
                surfaceRestitution: 0.28,
                surfaceFriction: 0.08,
                thickness: 10
            };
        }
        if (type === "path") return { id: makeId(type), type: "path", level: 0, role: "wall", thickness: 6, restitution: 0.55, closed: false, anchors: [{ x: 60, y: 200 }, { x: 200, y: 160 }] };
        if (type === "lane") return { id: makeId(type), type: "lane", level: 0, x: 120, y: 120, w: 40, h: 20, score: 100 };
        if (type === "dropTarget") return { id: makeId(type), type: "dropTarget", level: 0, x: 200, y: 500, w: 14, h: 40, angle: 0, restitution: 0.55, score: 250 };
        if (type === "spinner") return { id: makeId(type), type: "spinner", level: 0, x: 250, y: 220, length: 60, angle: 0, score: 100 };
        if (type === "launcher") return { id: makeId(type), type: "launcher", level: 0, x: 439, y: 710, top: 195, bottom: 735, width: 38, maxPower: 42, maxRetract: 65, pullSpeed: 95, returnSpeed: 220, springStrength: 1 };
        if (type === "gate") return { id: makeId(type), type: "gate", level: 0, x: 230, y: 360, length: 64, angle: -0.2, locked: false, swingStartAngle: -0.2, swingEndAngle: 0.85, maxAngle: 1.05, returnStrength: 24, returnDamping: 8, thickness: 3, restitution: 0.55, color: "#99ffcc", pinColor: "#f7fbff" };
        if (type === "valve") return { id: makeId(type), type: "valve", level: 0, x: 230, y: 360, length: 64, angle: -0.2, direction: "forward", maxAngle: 1.05, returnStrength: 24, returnDamping: 8, thickness: 3, color: "#a8e4ff", pinColor: "#f7fbff" };
        if (type === "drain") return { id: makeId(type), type: "drain", level: 0, x: 250, y: 835, w: 150, h: 24 };
        if (type === "trough") return { id: makeId(type), type: "trough", level: 0, x: 250, y: 820, radius: 18, holdSeconds: 0.75, reactivateDelay: 2, ejectPower: 10, ejectAngle: -Math.PI * 0.5, color: "#88aaff", pitColor: "#08101f" };
        if (type === "kicker") return {
            id: makeId(type),
            type: "kicker",
            level: 0,
            radius: 14,
            bandThickness: 6,
            restitution: 0.55,
            kickPower: 14,
            score: 250,
            color: "#ffaa66",
            closed: true,
            anchors: [
                { x: 160, y: 360 },
                { x: 210, y: 330 },
                { x: 220, y: 390 }
            ]
        };
        if (type === "scoreZone") return { id: makeId(type), type: "scoreZone", level: 0, x: 340, y: 360, radius: 20, restitution: 0.55, score: 500 };
        if (type === "light") return { id: makeId(type), type: "light", level: 0, x: 250, y: 260, radius: 13, lampId: "", text: "", label: "", color: "#ffee55" };
        if (type === "arrowLight") return { id: makeId(type), type: "arrowLight", level: 0, x: 250, y: 260, w: 86, h: 34, angle: 0, lampId: "", text: "GO", label: "", color: "#66ddff" };
        if (type === "boxLight") return { id: makeId(type), type: "boxLight", level: 0, x: 250, y: 260, w: 110, h: 42, angle: 0, cornerRadius: 10, lampId: "", text: "BONUS", label: "", color: "#8fe36a" };
        if (type === "ramp") {
            return {
                id: makeId(type),
                type: "ramp",
                level: 0,
                levelFrom: 0,
                levelTo: 1,
                zStart: 0,
                zEnd: 48,
                railThickness: 2,
                leftAnchors: [{ x: 100, y: 500 }, { x: 180, y: 420 }],
                rightAnchors: [{ x: 130, y: 520 }, { x: 210, y: 440 }]
            };
        }
        return null;
    }

    function ensureLevels(table) {
        const maxLevel = inferMaxLevel(table || {});
        table.levels = Array.isArray(table.levels) ? table.levels.slice() : [];
        const seen = {};
        table.levels = table.levels.filter(function keep(entry) {
            return entry && typeof entry.level === "number" && !seen[entry.level] && (seen[entry.level] = true);
        }).sort(function sort(a, b) {
            return a.level - b.level;
        }).map(function normalize(entry) {
            const base = defaultLevel(entry.level, entry.name, entry.parentLevel);
            return Object.assign(base, entry, {
                level: entry.level,
                parentLevel: typeof entry.parentLevel === "number" ? entry.parentLevel : (entry.level > 0 ? entry.level - 1 : null),
                editorVisible: entry.editorVisible !== false
            });
        });
        for (let level = 0; level <= maxLevel; level++) {
            if (!seen[level]) table.levels.push(defaultLevel(level, level === 0 ? "Playfield" : "Level " + level, level > 0 ? level - 1 : null));
        }
        table.levels.sort(function sort(a, b) {
            return a.level - b.level;
        });
        return table.levels;
    }

    function getLevelEntry(table, level) {
        const levels = ensureLevels(table);
        for (let i = 0; i < levels.length; i++) {
            if (levels[i].level === level) return levels[i];
        }
        return null;
    }

    function getElementLevel(el) {
        if (!el) return 0;
        if (typeof el.level === "number") return el.level;
        if (typeof el.levelFrom === "number") return el.levelFrom;
        return 0;
    }

    function ensureElementLevels(table) {
        ensureLevels(table);
        (table.elements || []).forEach(function each(el) {
            if (!el || typeof el.level === "number") return;
            el.level = getElementLevel(el);
        });
        return table.elements || [];
    }

    function isLevelVisible(table, level) {
        const entry = getLevelEntry(table, level);
        if (!entry) return true;
        if (entry.editorVisible === false) return false;
        if (typeof entry.parentLevel === "number" && entry.parentLevel !== level) {
            return isLevelVisible(table, entry.parentLevel);
        }
        return true;
    }

    function isElementVisibleInEditor(table, el) {
        if (!el) return false;
        if (typeof el.level === "number") return isLevelVisible(table, el.level);
        if (typeof el.levelFrom === "number" || typeof el.levelTo === "number") {
            return isLevelVisible(table, typeof el.levelFrom === "number" ? el.levelFrom : 0) ||
                isLevelVisible(table, typeof el.levelTo === "number" ? el.levelTo : 0);
        }
        return true;
    }

    function getLauncherElement(table) {
        return (table.elements || []).find(function findLauncher(el) { return el.type === "launcher"; }) || null;
    }

    function ensureSelectableLauncher(table) {
        table.elements = table.elements || [];
        if (table.elements.some(function hasLauncher(el) { return el.type === "launcher"; })) return;
        const legacy = table.launcher || {};
        table.elements.unshift({
            id: "launcher",
            type: "launcher",
            x: legacy.x || 439,
            y: legacy.y || 710,
            top: legacy.top || 195,
            bottom: legacy.bottom || 735,
            width: legacy.width || 38,
            maxPower: legacy.maxPower || 42
        });
    }

    function syncLauncherConfig(table) {
        const lane = getLauncherElement(table);
        if (!lane) return;
        table.launcher = table.launcher || {};
        table.launcher.x = lane.x || 439;
        const bottom = lane.bottom || 735;
        const top = lane.top || 195;
        const y = lane.y || bottom - 25;
        table.launcher.y = Math.max(top + 12, Math.min(bottom - 8, y));
        table.launcher.top = lane.top || 195;
        table.launcher.bottom = bottom;
        table.launcher.width = lane.width || 38;
        table.launcher.maxPower = lane.maxPower || table.launcher.maxPower || 42;
        table.launcher.maxRetract = lane.maxRetract || table.launcher.maxRetract || 65;
        table.launcher.springStrength = lane.springStrength || table.launcher.springStrength || 1;
    }

    function ensureRulesEngine(table) {
        table.rulesEngine = table.rulesEngine || {};
        table.rulesEngine.switchMap = table.rulesEngine.switchMap || [];
        table.rulesEngine.sequenceRules = table.rulesEngine.sequenceRules || [];
        table.rulesEngine.logicGraphs = table.rulesEngine.logicGraphs || [];
        table.rulesEngine.triggers = table.rulesEngine.triggers || [];
        table.rulesEngine.variables = table.rulesEngine.variables || [];
        if (Pin.ruleGraph && Pin.ruleGraph.syncRuleGraphs) {
            Pin.ruleGraph.syncRuleGraphs(table);
        }
        return table.rulesEngine;
    }

    function ensureImageLayers(table) {
        table.images = table.images || [];
        return table.images;
    }

    function getLogicGraphs(table) {
        return ensureRulesEngine(table).logicGraphs || [];
    }

    function findElementForSwitchId(table, switchId) {
        if (!switchId) return null;
        const direct = (table.elements || []).find(function find(el) { return el.id === switchId; });
        if (direct) return direct;
        const mapping = (((table.rulesEngine || {}).switchMap) || []).find(function find(map) {
            return map && map.switchId === switchId && map.sourceId;
        });
        if (!mapping) return null;
        return (table.elements || []).find(function find(el) { return el.id === mapping.sourceId; }) || null;
    }

    function findElementForLampId(table, lampId) {
        if (!lampId) return null;
        return (table.elements || []).find(function find(el) {
            return (el.type === "light" || el.type === "arrowLight" || el.type === "boxLight") && (el.lampId === lampId || el.id === lampId);
        }) || null;
    }

    function firstSwitchElementId(table) {
        const element = (table.elements || []).find(function find(el) {
            return el && el.id && ["lane", "scoreZone", "spinner", "gate", "valve", "drain", "launcher", "dropTarget", "bumper", "kicker"].indexOf(el.type) >= 0;
        });
        return element ? element.id : "";
    }

    Pin.editorModel = {
        createDefaultElement: createDefaultElement,
        ensureLevels: ensureLevels,
        getLevelEntry: getLevelEntry,
        getElementLevel: getElementLevel,
        ensureElementLevels: ensureElementLevels,
        isLevelVisible: isLevelVisible,
        isElementVisibleInEditor: isElementVisibleInEditor,
        getLauncherElement: getLauncherElement,
        ensureSelectableLauncher: ensureSelectableLauncher,
        syncLauncherConfig: syncLauncherConfig,
        ensureRulesEngine: ensureRulesEngine,
        ensureImageLayers: ensureImageLayers,
        getLogicGraphs: getLogicGraphs,
        findElementForSwitchId: findElementForSwitchId,
        findElementForLampId: findElementForLampId,
        firstSwitchElementId: firstSwitchElementId
    };
})(window.Pin);
