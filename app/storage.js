(function initStorage(Pin) {
    function stampTableForPersistence(table) {
        /*
         * What: Add human-facing table metadata to a persisted copy.
         * Why: the selector can show when a browser-memory or exported table was
         * last saved without overloading the required schema version field.
         */
        const copy = JSON.parse(JSON.stringify(table || {}));
        copy.date = new Date().toISOString();
        if (copy.tableVersion == null) copy.tableVersion = String(copy.version || 1);
        return copy;
    }

    function saveLocal(slot, table) {
        localStorage.setItem("pin.tables." + slot, JSON.stringify(stampTableForPersistence(table)));
        localStorage.setItem("pin.lastSlot", String(slot));
    }

    function loadLocal(slot) {
        const raw = localStorage.getItem("pin.tables." + slot);
        if (!raw) return null;
        try {
            return JSON.parse(raw);
        } catch (err) {
            console.warn("Ignoring corrupt saved table in slot '" + slot + "'.", err);
            return null;
        }
    }

    function clearAppLocal() {
        /*
         * What: Remove all browser-local state owned by this app.
         * Why: stale autosaves and settings can affect table loading, so the UI
         * needs a controlled reset that does not delete unrelated site storage.
         */
        const keys = [];
        for (let i = 0; i < localStorage.length; i++) {
            const key = localStorage.key(i);
            if (key && key.indexOf("pin.") === 0) keys.push(key);
        }
        keys.forEach(function each(key) {
            localStorage.removeItem(key);
        });
        return keys.length;
    }

    function exportFile(table) {
        const persisted = stampTableForPersistence(table);
        const blob = new Blob([JSON.stringify(persisted, null, 2)], { type: "application/json" });
        const a = document.createElement("a");
        a.href = URL.createObjectURL(blob);
        a.download = (persisted.name || "table") + ".pin.json";
        a.click();
        URL.revokeObjectURL(a.href);
    }

    function importFile() {
        return new Promise(function openPicker(resolve, reject) {
            const input = document.createElement("input");
            input.type = "file";
            input.accept = ".json,.pin.json,application/json";
            input.onchange = function readFile() {
                const file = input.files && input.files[0];
                if (!file) return reject(new Error("No file selected"));
                const reader = new FileReader();
                reader.onload = function onLoad() {
                    try { resolve(JSON.parse(reader.result)); } catch (err) { reject(err); }
                };
                reader.onerror = reject;
                reader.readAsText(file);
            };
            input.click();
        });
    }

    function encodeUrl(table) {
        const raw = JSON.stringify(table);
        if (window.LZString && window.LZString.compressToEncodedURIComponent) {
            return window.LZString.compressToEncodedURIComponent(raw);
        }
        return btoa(unescape(encodeURIComponent(raw)));
    }

    function decodeUrl(token) {
        if (window.LZString && window.LZString.decompressFromEncodedURIComponent) {
            return JSON.parse(window.LZString.decompressFromEncodedURIComponent(token));
        }
        return JSON.parse(decodeURIComponent(escape(atob(token))));
    }

    Pin.storage = {
        local: { save: saveLocal, load: loadLocal, clearApp: clearAppLocal },
        file: { export: exportFile, import: importFile },
        url: { encode: encodeUrl, decode: decodeUrl }
    };
})(window.Pin);
