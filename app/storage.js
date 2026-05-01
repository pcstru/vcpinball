(function initStorage(Pin) {
    function saveLocal(slot, table) {
        localStorage.setItem("pin.tables." + slot, JSON.stringify(table));
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

    function exportFile(table) {
        const blob = new Blob([JSON.stringify(table, null, 2)], { type: "application/json" });
        const a = document.createElement("a");
        a.href = URL.createObjectURL(blob);
        a.download = (table.name || "table") + ".pin.json";
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
        local: { save: saveLocal, load: loadLocal },
        file: { export: exportFile, import: importFile },
        url: { encode: encodeUrl, decode: decodeUrl }
    };
})(window.Pin);
