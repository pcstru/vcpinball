/*
 * AI-Lab shared patch/evaluation contract.
 * What: Provides one patch-contract + apply + validate + eval pipeline for
 * browser AI-Lab and Node eval-agent automation.
 * Why: keeps physics/validation behavior aligned across interactive and batch
 * workflows so generated data remains trustworthy for model tuning.
 */
(function initAiLabContract(root, factory) {
    if (typeof module !== "undefined" && module.exports) {
        module.exports = factory;
    } else {
        const pin = root.Pin = root.Pin || {};
        pin.aiLabContract = factory(pin);
    }
})(typeof window !== "undefined" ? window : globalThis, function buildAiLabContract(Pin) {
    const CONTRACT_VERSION = 1;

    function clone(value) {
        return JSON.parse(JSON.stringify(value));
    }

    function normalizeInput(value) {
        if (typeof value === "number" && !Number.isNaN(value)) return value;
        if (typeof value === "boolean") return value;
        if (value == null) return value;
        if (typeof value === "string") {
            const trimmed = value.trim();
            if (trimmed === "") return "";
            if (/^-?\d+(\.\d+)?$/.test(trimmed)) return Number(trimmed);
            return value;
        }
        return value;
    }

    function makeId(prefix) {
        return String(prefix || "id") + "_" + Math.random().toString(36).slice(2, 8);
    }

    function isPlainObject(value) {
        return !!value && typeof value === "object" && !Array.isArray(value);
    }

    function applyNormalizedPatch(target, patch) {
        Object.keys(patch || {}).forEach(function each(key) {
            const value = patch[key];
            if (Array.isArray(value)) {
                target[key] = clone(value);
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

    function getLogicDocForTable(table) {
        table.logicDocument = table.logicDocument || {
            logicVersion: 1,
            switchRegistry: [],
            stateTable: [],
            computedState: [],
            lampBindings: [],
            actionRules: [],
            resetRules: []
        };
        return table.logicDocument;
    }

    function validatePatchContract(patch) {
        const issues = [];
        if (!isPlainObject(patch)) return { ok: false, issues: ["Patch must be a JSON object."] };
        const allowedKeys = {
            tablePatch: true,
            addElements: true,
            patchElements: true,
            removeElements: true,
            addFeatures: true,
            patchFeatures: true,
            removeFeatures: true,
            logicDocPatch: true
        };
        Object.keys(patch).forEach(function each(key) {
            if (!allowedKeys[key]) issues.push("Unsupported patch key: " + key);
        });
        function expectArrayOfObjects(key) {
            if (patch[key] == null) return;
            if (!Array.isArray(patch[key])) issues.push(key + " must be an array.");
            else patch[key].forEach(function each(item, index) {
                if (!isPlainObject(item)) issues.push(key + "[" + index + "] must be an object.");
            });
        }
        function expectArrayOfStrings(key) {
            if (patch[key] == null) return;
            if (!Array.isArray(patch[key])) issues.push(key + " must be an array.");
            else patch[key].forEach(function each(item, index) {
                if (typeof item !== "string") issues.push(key + "[" + index + "] must be a string id.");
            });
        }
        if (patch.tablePatch != null && !isPlainObject(patch.tablePatch)) issues.push("tablePatch must be an object.");
        expectArrayOfObjects("addElements");
        expectArrayOfObjects("addFeatures");
        expectArrayOfStrings("removeElements");
        expectArrayOfStrings("removeFeatures");
        if (patch.patchElements != null) {
            if (!Array.isArray(patch.patchElements)) issues.push("patchElements must be an array.");
            else patch.patchElements.forEach(function each(change, index) {
                if (!isPlainObject(change)) issues.push("patchElements[" + index + "] must be an object.");
                else {
                    if (typeof change.id !== "string" || !change.id) issues.push("patchElements[" + index + "].id must be a string.");
                    if (!isPlainObject(change.patch)) issues.push("patchElements[" + index + "].patch must be an object.");
                }
            });
        }
        if (patch.patchFeatures != null) {
            if (!Array.isArray(patch.patchFeatures)) issues.push("patchFeatures must be an array.");
            else patch.patchFeatures.forEach(function each(change, index) {
                if (!isPlainObject(change)) issues.push("patchFeatures[" + index + "] must be an object.");
                else {
                    if (typeof change.id !== "string" || !change.id) issues.push("patchFeatures[" + index + "].id must be a string.");
                    if (!isPlainObject(change.patch)) issues.push("patchFeatures[" + index + "].patch must be an object.");
                }
            });
        }
        if (patch.logicDocPatch != null && !isPlainObject(patch.logicDocPatch)) issues.push("logicDocPatch must be an object.");
        return { ok: issues.length === 0, issues: issues };
    }

    function applyPatchAndValidate(sourceTable, patch) {
        if (!Pin || !Pin.table || !Pin.table.normalizeTable || !Pin.table.validateTable) {
            return { ok: false, message: "Pin.table runtime is unavailable.", issues: [] };
        }
        const working = clone(sourceTable || {});
        working.elements = Array.isArray(working.elements) ? working.elements : [];
        working.features = Array.isArray(working.features) ? working.features : [];

        if (patch.tablePatch && typeof patch.tablePatch === "object") applyNormalizedPatch(working, patch.tablePatch);
        if (Array.isArray(patch.addElements)) {
            patch.addElements.forEach(function each(element) {
                if (!element || typeof element !== "object") return;
                const out = clone(element);
                if (!out.id) out.id = makeId(out.type || "element");
                working.elements.push(out);
            });
        }
        if (Array.isArray(patch.patchElements)) {
            patch.patchElements.forEach(function each(change) {
                if (!change || !change.id || !change.patch || typeof change.patch !== "object") return;
                const element = working.elements.find(function find(el) { return el && el.id === change.id; });
                if (element) applyNormalizedPatch(element, change.patch);
            });
        }
        if (Array.isArray(patch.removeElements)) {
            const removeIds = {};
            patch.removeElements.forEach(function each(id) { if (id) removeIds[String(id)] = true; });
            working.elements = working.elements.filter(function keep(el) {
                return !(el && el.id && removeIds[String(el.id)]);
            });
        }
        if (Array.isArray(patch.addFeatures)) {
            patch.addFeatures.forEach(function each(feature) {
                if (!feature || typeof feature !== "object") return;
                const out = clone(feature);
                if (!out.id) out.id = makeId("feature");
                working.features.push(out);
            });
        }
        if (Array.isArray(patch.patchFeatures)) {
            patch.patchFeatures.forEach(function each(change) {
                if (!change || !change.id || !change.patch || typeof change.patch !== "object") return;
                const feature = working.features.find(function find(item) { return item && item.id === change.id; });
                if (feature) applyNormalizedPatch(feature, change.patch);
            });
        }
        if (Array.isArray(patch.removeFeatures)) {
            const removeIds = {};
            patch.removeFeatures.forEach(function each(id) { if (id) removeIds[String(id)] = true; });
            working.features = working.features.filter(function keep(item) {
                return !(item && item.id && removeIds[String(item.id)]);
            });
        }
        if (patch.logicDocPatch && typeof patch.logicDocPatch === "object") {
            const logicDoc = getLogicDocForTable(working);
            applyNormalizedPatch(logicDoc, patch.logicDocPatch);
            if (Pin.logicTypes && Pin.logicTypes.normalizeLogicDocument) {
                working.logicDocument = Pin.logicTypes.normalizeLogicDocument(logicDoc);
            }
        }

        const normalized = Pin.table.normalizeTable(working);
        const tableValidation = Pin.table.validateTable(normalized);
        let logicValidation = { ok: true, issues: [] };
        if (Pin.logicCompile && Pin.logicValidate && Pin.logicAssets) {
            const logicDoc = Pin.logicCompile.extractFromTable(normalized);
            const logicAssets = Pin.logicAssets.extractAssets(normalized);
            logicValidation = Pin.logicValidate.validateDocument(logicDoc, logicAssets);
        }
        const issues = []
            .concat(Array.isArray(tableValidation.issues) ? tableValidation.issues : [])
            .concat(Array.isArray(logicValidation.issues) ? logicValidation.issues : []);
        return {
            ok: !!(tableValidation.ok && logicValidation.ok),
            message: tableValidation.ok && logicValidation.ok ? "Patch applied." : "Patch produced validation errors.",
            table: normalized,
            validationIssues: issues
        };
    }

    function runTableEval(table, options) {
        if (!Pin || !Pin.tableEval || typeof Pin.tableEval.evaluateTable !== "function") {
            return { overall: "fail", summary: { passed: 0, warnings: 0, failed: 1 }, checks: [{ id: "table_eval_unavailable", status: "fail", message: "Pin.tableEval runtime is unavailable." }] };
        }
        return Pin.tableEval.evaluateTable(table, options || {});
    }

    function runtimeFingerprint() {
        const parts = [
            "table:" + !!(Pin.table && Pin.table.normalizeTable),
            "logic:" + !!(Pin.logicCompile && Pin.logicValidate && Pin.logicAssets),
            "elements:" + !!(Pin.elements && Pin.elements.compileElements),
            "physics:" + !!(Pin.physics && Pin.physics.stepWorld),
            "eval:" + !!(Pin.tableEval && Pin.tableEval.evaluateTable)
        ];
        return parts.join("|");
    }

    function evaluatePatchAttempt(sourceTable, patch, options) {
        const contract = validatePatchContract(patch);
        if (!contract.ok) {
            return {
                accepted: false,
                contractVersion: CONTRACT_VERSION,
                runtimeFingerprint: runtimeFingerprint(),
                physicsContract: "Pin.physics.stepWorld",
                contractIssues: contract.issues,
                validationIssues: [],
                evalReport: null
            };
        }
        const applied = applyPatchAndValidate(sourceTable, patch);
        if (!applied.ok) {
            return {
                accepted: false,
                contractVersion: CONTRACT_VERSION,
                runtimeFingerprint: runtimeFingerprint(),
                physicsContract: "Pin.physics.stepWorld",
                contractIssues: [],
                validationIssues: applied.validationIssues || [],
                evalReport: null,
                patchedTable: applied.table
            };
        }
        const report = runTableEval(applied.table, options || {});
        const accepted = !(report && report.summary && report.summary.failed > 0);
        return {
            accepted: accepted,
            contractVersion: CONTRACT_VERSION,
            runtimeFingerprint: runtimeFingerprint(),
            physicsContract: "Pin.physics.stepWorld",
            contractIssues: [],
            validationIssues: applied.validationIssues || [],
            evalReport: report,
            patchedTable: applied.table
        };
    }

    return {
        contractVersion: CONTRACT_VERSION,
        validatePatchContract: validatePatchContract,
        applyPatchAndValidate: applyPatchAndValidate,
        runTableEval: runTableEval,
        evaluatePatchAttempt: evaluatePatchAttempt,
        runtimeFingerprint: runtimeFingerprint
    };
});
