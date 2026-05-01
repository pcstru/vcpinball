(function initEditorActions(Pin) {
    function createActions(options) {
        const state = options.state;
        const pushUndo = options.pushUndo;
        const markTableDirty = options.markTableDirty;
        const refresh = options.refresh;
        const syncCanvasToTable = options.syncCanvasToTable;
        const syncLauncherConfig = options.syncLauncherConfig;
        const getLauncherElement = options.getLauncherElement;
        const getSelected = options.getSelected;
        const ensureLevels = options.ensureLevels;
        const getElementLevel = options.getElementLevel;
        const makeId = options.makeId;
        const normalizeInput = options.normalizeInput;

        function applyNormalizedPatch(target, patch) {
            Object.keys(patch || {}).forEach(function each(key) {
                const value = patch[key];
                if (Array.isArray(value)) {
                    target[key] = Pin.editorTools.clone(value);
                    return;
                }
                if (value && typeof value === "object") {
                    if (!target[key] || typeof target[key] !== "object" || Array.isArray(target[key])) target[key] = {};
                    applyNormalizedPatch(target[key], value);
                    return;
                }
                target[key] = normalizeInput(value);
            });
        }

        function patchTable(path, value) {
            pushUndo();
            const normalized = normalizeInput(value);
            if (path.indexOf("launcher.") === 0) {
                const launcherField = path.slice("launcher.".length);
                const launcherElement = getLauncherElement(state.table);
                if (launcherElement) {
                    launcherElement[launcherField] = normalized;
                    syncLauncherConfig(state.table);
                } else {
                    Pin.editorTools.setByPath(state.table, path, normalized);
                }
            } else {
                Pin.editorTools.setByPath(state.table, path, normalized);
            }
            if (path === "playfield.width" || path === "playfield.height") syncCanvasToTable();
            markTableDirty();
            refresh("all");
        }

        function patchTableFields(patch) {
            pushUndo();
            applyNormalizedPatch(state.table, patch || {});
            if (patch && patch.playfield && (Object.prototype.hasOwnProperty.call(patch.playfield, "width") || Object.prototype.hasOwnProperty.call(patch.playfield, "height"))) {
                syncCanvasToTable();
            }
            markTableDirty();
            refresh("all");
        }

        function addImageLayer() {
            pushUndo();
            state.table.images = state.table.images || [];
            state.table.images.push({
                id: makeId("image"),
                src: "tables/ExTableImg.png",
                mode: "design",
                opacity: 0.35,
                fit: "contain",
                scale: 1,
                offsetX: 0,
                offsetY: 0
            });
            markTableDirty();
            refresh("all");
        }

        function patchImageLayer(index, key, value) {
            const images = state.table.images || [];
            if (!images[index]) return;
            pushUndo();
            images[index][key] = normalizeInput(value);
            markTableDirty();
            refresh("all");
        }

        function patchImageLayerFields(index, patch) {
            const images = state.table.images || [];
            if (!images[index]) return;
            pushUndo();
            applyNormalizedPatch(images[index], patch || {});
            markTableDirty();
            refresh("all");
        }

        function removeImageLayer(index) {
            const images = state.table.images || [];
            if (!images[index]) return;
            pushUndo();
            images.splice(index, 1);
            markTableDirty();
            refresh("all");
        }

        function moveImageLayer(index, delta) {
            const images = state.table.images || [];
            const next = index + delta;
            if (index < 0 || next < 0 || next >= images.length) return;
            pushUndo();
            const tmp = images[index];
            images[index] = images[next];
            images[next] = tmp;
            markTableDirty();
            refresh("all");
        }

        function addLevel(parentLevel) {
            pushUndo();
            const levels = ensureLevels(state.table);
            let nextLevel = 0;
            levels.forEach(function each(entry) {
                nextLevel = Math.max(nextLevel, (entry.level || 0) + 1);
            });
            levels.push({
                level: nextLevel,
                name: "Level " + nextLevel,
                parentLevel: typeof parentLevel === "number" ? parentLevel : 0,
                elevation: nextLevel * 48,
                editorVisible: true
            });
            markTableDirty();
            refresh("all");
        }

        function patchLevelFields(levelValue, patch) {
            const levels = ensureLevels(state.table);
            const level = levels.find(function find(entry) { return entry.level === levelValue; });
            if (!level) return;
            pushUndo();
            applyNormalizedPatch(level, patch || {});
            if (typeof level.parentLevel !== "number" && level.level > 0) level.parentLevel = 0;
            if (level.level === 0) level.parentLevel = null;
            markTableDirty();
            refresh("all");
        }

        function setLevelVisibility(levelValue, visible) {
            const levels = ensureLevels(state.table);
            const level = levels.find(function find(entry) { return entry.level === levelValue; });
            if (!level) return;
            pushUndo();
            level.editorVisible = visible !== false;
            markTableDirty();
            refresh("all");
        }

        function isolateLevel(levelValue) {
            const levels = ensureLevels(state.table);
            pushUndo();
            const allowed = {};
            let cursor = levelValue;
            while (typeof cursor === "number") {
                allowed[cursor] = true;
                const entry = levels.find(function find(item) { return item.level === cursor; });
                cursor = entry && typeof entry.parentLevel === "number" && entry.parentLevel !== cursor ? entry.parentLevel : null;
            }
            levels.forEach(function each(entry) {
                entry.editorVisible = !!allowed[entry.level];
            });
            markTableDirty();
            refresh("all");
        }

        function showAllLevels() {
            const levels = ensureLevels(state.table);
            pushUndo();
            levels.forEach(function each(entry) {
                entry.editorVisible = true;
            });
            markTableDirty();
            refresh("all");
        }

        function assignSelectedToLevel(levelValue) {
            const selected = getSelected();
            if (!selected) return;
            pushUndo();
            selected.level = levelValue;
            if (selected.type === "ramp") {
                if (typeof selected.levelFrom !== "number") selected.levelFrom = levelValue;
                if (typeof selected.levelTo !== "number") selected.levelTo = Math.max(levelValue, selected.levelFrom || 0);
            }
            markTableDirty();
            refresh("all");
        }

        function removeLevel(levelValue) {
            if (levelValue === 0) return;
            const levels = ensureLevels(state.table);
            const index = levels.findIndex(function find(entry) { return entry.level === levelValue; });
            if (index < 0) return;
            pushUndo();
            const fallback = typeof levels[index].parentLevel === "number" ? levels[index].parentLevel : 0;
            levels.splice(index, 1);
            levels.forEach(function each(entry) {
                if (entry.parentLevel === levelValue) entry.parentLevel = fallback;
            });
            (state.table.elements || []).forEach(function each(el) {
                if (!el) return;
                if (getElementLevel(el) === levelValue) el.level = fallback;
                if (el.levelFrom === levelValue) el.levelFrom = fallback;
                if (el.levelTo === levelValue) el.levelTo = fallback;
            });
            markTableDirty();
            refresh("all");
        }

        function patchSelected(path, value) {
            const selected = getSelected();
            if (!selected) return;
            pushUndo();
            Pin.editorTools.setByPath(selected, path, normalizeInput(value));
            if (selected.type === "launcher") syncLauncherConfig(state.table);
            markTableDirty();
            refresh("all");
        }

        function patchSelectedFields(patch) {
            const selected = getSelected();
            if (!selected) return;
            pushUndo();
            applyNormalizedPatch(selected, patch || {});
            if (selected.type === "launcher") syncLauncherConfig(state.table);
            markTableDirty();
            refresh("all");
        }

        function patchAnchor(key, index, field, value) {
            const selected = getSelected();
            if (!selected || !Array.isArray(selected[key]) || !selected[key][index]) return;
            pushUndo();
            selected[key][index][field] = normalizeInput(value);
            markTableDirty();
            refresh("all");
        }

        function patchAnchorFields(key, index, patch) {
            const selected = getSelected();
            if (!selected || !Array.isArray(selected[key]) || !selected[key][index]) return;
            pushUndo();
            applyNormalizedPatch(selected[key][index], patch || {});
            markTableDirty();
            refresh("all");
        }

        function addAnchor(key) {
            const selected = getSelected();
            if (!selected || !Array.isArray(selected[key]) || !selected[key].length) return;
            if (selected.type === "kicker" && selected[key].length >= 3) return;
            pushUndo();
            const list = selected[key];
            const tail = list[list.length - 1];
            list.push(selected.type === "kicker" ?
                { x: tail.x + 30, y: tail.y + 30, radius: typeof tail.radius === "number" ? tail.radius : (selected.radius || 14) } :
                { x: tail.x + 30, y: tail.y + 30 });
            markTableDirty();
            refresh("all");
        }

        function deleteElementById(id) {
            const index = state.table.elements.findIndex(function find(el) { return el.id === id; });
            if (index < 0) return;
            pushUndo();
            state.table.elements.splice(index, 1);
            syncLauncherConfig(state.table);
            markTableDirty();
            refresh("all");
        }

        function duplicateSelected() {
            const selected = getSelected();
            if (!selected) return null;
            pushUndo();
            const copy = Pin.editorTools.clone(selected);
            copy.id = makeId(copy.type);
            Pin.editorHitTest.shiftElement(copy, 12, 12);
            state.table.elements.push(copy);
            if (copy.type === "launcher") syncLauncherConfig(state.table);
            markTableDirty();
            refresh("all");
            return copy;
        }

        function moveElementById(id, delta) {
            const index = state.table.elements.findIndex(function find(el) { return el.id === id; });
            if (index < 0) return;
            const next = Math.max(0, Math.min(state.table.elements.length - 1, index + delta));
            if (index === next) return;
            pushUndo();
            const tmp = state.table.elements[index];
            state.table.elements[index] = state.table.elements[next];
            state.table.elements[next] = tmp;
            markTableDirty();
            refresh("all");
        }

        return {
            patchTable: patchTable,
            patchTableFields: patchTableFields,
            addImageLayer: addImageLayer,
            patchImageLayer: patchImageLayer,
            patchImageLayerFields: patchImageLayerFields,
            removeImageLayer: removeImageLayer,
            moveImageLayer: moveImageLayer,
            addLevel: addLevel,
            patchLevelFields: patchLevelFields,
            setLevelVisibility: setLevelVisibility,
            isolateLevel: isolateLevel,
            showAllLevels: showAllLevels,
            assignSelectedToLevel: assignSelectedToLevel,
            removeLevel: removeLevel,
            patchSelected: patchSelected,
            patchSelectedFields: patchSelectedFields,
            patchAnchor: patchAnchor,
            patchAnchorFields: patchAnchorFields,
            addAnchor: addAnchor,
            deleteElementById: deleteElementById,
            duplicateSelected: duplicateSelected,
            moveElementById: moveElementById
        };
    }

    Pin.editorActions = {
        create: createActions
    };
})(window.Pin);
