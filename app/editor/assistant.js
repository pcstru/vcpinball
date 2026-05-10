/*
 * What: Minimal assistant state container for table/design guidance.
 * Why: Chat and Agentic UI currently provide local guidance while external AI
 *      execution remains disabled in this static build.
 */
(function initEditorAssistant(Pin) {
    const SETTINGS_KEY = "pin.assistant.settings";
    const AGENTIC_MODE_KEY = "pin.assistant.agenticMode";

    function clone(value) {
        return JSON.parse(JSON.stringify(value == null ? {} : value));
    }

    function readJson(key, fallback) {
        /* What: Read assistant settings from browser storage.
         * Why: Provider configuration should survive editor refreshes in the static app.
         */
        if (typeof localStorage === "undefined") return clone(fallback);
        try {
            const raw = localStorage.getItem(key);
            return raw ? JSON.parse(raw) : clone(fallback);
        } catch (err) {
            console.warn("Ignoring corrupt assistant storage for " + key + ".", err);
            return clone(fallback);
        }
    }

    function writeJson(key, value) {
        /* What: Persist assistant settings to browser storage.
         * Why: The provider pane has explicit Save controls and should keep the saved draft.
         */
        if (typeof localStorage === "undefined") return;
        try {
            localStorage.setItem(key, JSON.stringify(value == null ? {} : value));
        } catch (err) {
            console.warn("Unable to save assistant storage for " + key + ".", err);
        }
    }

    function normalizeSettings(settings) {
        /* What: Normalize provider settings into the shape used by the provider pane.
         * Why: Saved values come from form inputs and should round-trip predictably.
         */
        settings = settings || {};
        return {
            providerLabel: settings.providerLabel == null ? "" : String(settings.providerLabel),
            baseUrl: settings.baseUrl == null ? "" : String(settings.baseUrl),
            model: settings.model == null ? "" : String(settings.model),
            apiKey: settings.apiKey == null ? "" : String(settings.apiKey),
            maxSteps: typeof settings.maxSteps === "number" && Number.isFinite(settings.maxSteps) ? settings.maxSteps : 4
        };
    }

    function normalizeAgenticMode(mode) {
        /* What: Normalize Agentic execution mode flags.
         * Why: The Agentic pane persists independent boolean controls.
         */
        mode = mode || {};
        return {
            fullyAuto: mode.fullyAuto !== false,
            approveEachChange: !!mode.approveEachChange
        };
    }

    function toModelsEndpoint(baseUrl) {
        /* What: Build an OpenAI-compatible models endpoint from provider base URL.
         * Why: Provider settings may be entered as root, /v1, or direct /models URLs.
         */
        const raw = String(baseUrl || "").trim();
        if (!raw) return "";
        if (/\/models\/?$/i.test(raw)) return raw.replace(/\/+$/, "");
        return raw.replace(/\/+$/, "") + "/models";
    }

    function toChatEndpoint(baseUrl) {
        /* What: Build an OpenAI-compatible chat endpoint from provider base URL.
         * Why: Providers may expose root, /v1, or direct /chat/completions URLs.
         */
        const raw = String(baseUrl || "").trim();
        if (!raw) return "";
        if (/\/chat\/completions\/?$/i.test(raw)) return raw.replace(/\/+$/, "");
        return raw.replace(/\/+$/, "") + "/chat/completions";
    }

    function safeString(value) {
        return value == null ? "" : String(value);
    }


    function extractPatchJson(text) {
        /* What: Parse a patch object from model output.
         * Why: Providers often wrap JSON in prose or code fences.
         */
        const raw = safeString(text).trim();
        if (!raw) return null;
        try {
            return JSON.parse(raw);
        } catch (err) {}
        const fence = raw.match(/```json\s*([\s\S]*?)```/i) || raw.match(/```\s*([\s\S]*?)```/i);
        if (fence && fence[1]) {
            try { return JSON.parse(fence[1].trim()); } catch (err) {}
        }
        const firstBrace = raw.indexOf("{");
        const lastBrace = raw.lastIndexOf("}");
        if (firstBrace >= 0 && lastBrace > firstBrace) {
            const candidate = raw.slice(firstBrace, lastBrace + 1);
            try { return JSON.parse(candidate); } catch (err) {}
        }
        return null;
    }

    function isPlainObject(value) {
        return !!value && typeof value === "object" && !Array.isArray(value);
    }

    function validatePatchContract(patch) {
        /* What: Validate assistant patch shape before preview/apply.
         * Why: Early structural checks provide clearer repair signals for model retries.
         */
        const issues = [];
        if (!isPlainObject(patch)) {
            issues.push("Patch must be a JSON object.");
            return { ok: false, issues: issues };
        }

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
            if (!Array.isArray(patch[key])) {
                issues.push(key + " must be an array.");
                return;
            }
            patch[key].forEach(function each(item, index) {
                if (!isPlainObject(item)) issues.push(key + "[" + index + "] must be an object.");
            });
        }

        function expectArrayOfStrings(key) {
            if (patch[key] == null) return;
            if (!Array.isArray(patch[key])) {
                issues.push(key + " must be an array.");
                return;
            }
            patch[key].forEach(function each(item, index) {
                if (typeof item !== "string") issues.push(key + "[" + index + "] must be a string id.");
            });
        }

        if (patch.tablePatch != null && !isPlainObject(patch.tablePatch)) {
            issues.push("tablePatch must be an object.");
        }
        expectArrayOfObjects("addElements");
        expectArrayOfObjects("addFeatures");
        expectArrayOfStrings("removeElements");
        expectArrayOfStrings("removeFeatures");

        if (patch.patchElements != null) {
            if (!Array.isArray(patch.patchElements)) issues.push("patchElements must be an array.");
            else patch.patchElements.forEach(function each(change, index) {
                if (!isPlainObject(change)) {
                    issues.push("patchElements[" + index + "] must be an object.");
                    return;
                }
                if (typeof change.id !== "string" || !change.id) issues.push("patchElements[" + index + "].id must be a string.");
                if (!isPlainObject(change.patch)) issues.push("patchElements[" + index + "].patch must be an object.");
            });
        }

        if (patch.patchFeatures != null) {
            if (!Array.isArray(patch.patchFeatures)) issues.push("patchFeatures must be an array.");
            else patch.patchFeatures.forEach(function each(change, index) {
                if (!isPlainObject(change)) {
                    issues.push("patchFeatures[" + index + "] must be an object.");
                    return;
                }
                if (typeof change.id !== "string" || !change.id) issues.push("patchFeatures[" + index + "].id must be a string.");
                if (!isPlainObject(change.patch)) issues.push("patchFeatures[" + index + "].patch must be an object.");
            });
        }

        function validateFeatureObject(feature, pathPrefix) {
            if (!isPlainObject(feature)) {
                issues.push(pathPrefix + " must be an object.");
                return;
            }
            unknownKeys(feature, {
                id: true,
                name: true,
                description: true,
                goal: true,
                objects: true,
                states: true,
                rules: true,
                lamps: true,
                parts: true
            });
            if (feature.id != null && (typeof feature.id !== "string" || !feature.id)) issues.push(pathPrefix + ".id must be a non-empty string when present.");
            if (feature.name != null && typeof feature.name !== "string") issues.push(pathPrefix + ".name must be a string when present.");
            if (feature.description != null && typeof feature.description !== "string") issues.push(pathPrefix + ".description must be a string when present.");
            if (feature.goal != null && typeof feature.goal !== "string") issues.push(pathPrefix + ".goal must be a string when present.");
            ["objects", "states", "rules", "lamps", "parts"].forEach(function each(key) {
                if (feature[key] == null) return;
                if (!Array.isArray(feature[key])) {
                    issues.push(pathPrefix + "." + key + " must be an array when present.");
                    return;
                }
                feature[key].forEach(function eachEntry(value, entryIndex) {
                    if (typeof value !== "string") issues.push(pathPrefix + "." + key + "[" + entryIndex + "] must be a string.");
                });
            });
        }

        (Array.isArray(patch.addFeatures) ? patch.addFeatures : []).forEach(function each(feature, index) {
            validateFeatureObject(feature, "addFeatures[" + index + "]");
        });
        (Array.isArray(patch.patchFeatures) ? patch.patchFeatures : []).forEach(function each(change, index) {
            if (!change || !isPlainObject(change) || !isPlainObject(change.patch)) return;
            validateFeatureObject(change.patch, "patchFeatures[" + index + "].patch");
        });

        function unknownKeys(obj, allowedMap) {
            Object.keys(obj || {}).forEach(function each(key) {
                if (!allowedMap[key]) issues.push("Unsupported key: " + key);
            });
        }

        if (patch.logicDocPatch != null) {
            if (!isPlainObject(patch.logicDocPatch)) issues.push("logicDocPatch must be an object.");
            else {
                const logicPatch = patch.logicDocPatch;
                const allowedLogicKeys = {
                    logicVersion: true,
                    switchRegistry: true,
                    stateTable: true,
                    computedState: true,
                    lampBindings: true,
                    actionRules: true,
                    resetRules: true
                };
                Object.keys(logicPatch).forEach(function each(key) {
                    if (!allowedLogicKeys[key]) issues.push("logicDocPatch contains unsupported key: " + key);
                });
                ["switchRegistry", "stateTable", "computedState", "lampBindings", "actionRules", "resetRules"].forEach(function each(key) {
                    const value = logicPatch[key];
                    if (value == null) return;
                    if (!Array.isArray(value)) issues.push("logicDocPatch." + key + " must be an array.");
                });
                if (logicPatch.logicVersion != null && logicPatch.logicVersion !== 1) {
                    issues.push("logicDocPatch.logicVersion must be 1 when present.");
                }

                (Array.isArray(logicPatch.switchRegistry) ? logicPatch.switchRegistry : []).forEach(function each(row, index) {
                    if (!isPlainObject(row)) {
                        issues.push("logicDocPatch.switchRegistry[" + index + "] must be an object.");
                        return;
                    }
                    unknownKeys(row, { id: true, name: true, sourceElementId: true, kind: true, intervalMs: true });
                    if (!row.id || typeof row.id !== "string") issues.push("logicDocPatch.switchRegistry[" + index + "].id must be a string.");
                    if (!row.sourceElementId || typeof row.sourceElementId !== "string") issues.push("logicDocPatch.switchRegistry[" + index + "].sourceElementId must be a string.");
                    if (row.intervalMs != null && (!Number.isFinite(Number(row.intervalMs)) || Number(row.intervalMs) <= 0)) {
                        issues.push("logicDocPatch.switchRegistry[" + index + "].intervalMs must be a positive number when present.");
                    }
                });

                (Array.isArray(logicPatch.stateTable) ? logicPatch.stateTable : []).forEach(function each(row, index) {
                    if (!isPlainObject(row)) {
                        issues.push("logicDocPatch.stateTable[" + index + "] must be an object.");
                        return;
                    }
                    unknownKeys(row, { id: true, name: true, type: true, initial: true, volatile: true });
                    if (!row.id || typeof row.id !== "string") issues.push("logicDocPatch.stateTable[" + index + "].id must be a string.");
                    if (row.type != null && row.type !== "bool" && row.type !== "int") issues.push("logicDocPatch.stateTable[" + index + "].type must be 'bool' or 'int'.");
                });

                (Array.isArray(logicPatch.computedState) ? logicPatch.computedState : []).forEach(function each(row, index) {
                    if (!isPlainObject(row)) {
                        issues.push("logicDocPatch.computedState[" + index + "] must be an object.");
                        return;
                    }
                    unknownKeys(row, { id: true, name: true, type: true, expr: true });
                    if (!row.id || typeof row.id !== "string") issues.push("logicDocPatch.computedState[" + index + "].id must be a string.");
                    if (typeof row.expr !== "string") issues.push("logicDocPatch.computedState[" + index + "].expr must be a string.");
                });

                (Array.isArray(logicPatch.lampBindings) ? logicPatch.lampBindings : []).forEach(function each(row, index) {
                    if (!isPlainObject(row)) {
                        issues.push("logicDocPatch.lampBindings[" + index + "] must be an object.");
                        return;
                    }
                    unknownKeys(row, { lampId: true, expr: true });
                    if (!row.lampId || typeof row.lampId !== "string") issues.push("logicDocPatch.lampBindings[" + index + "].lampId must be a string.");
                    if (typeof row.expr !== "string") issues.push("logicDocPatch.lampBindings[" + index + "].expr must be a string (not expression).");
                });

                (Array.isArray(logicPatch.actionRules) ? logicPatch.actionRules : []).forEach(function each(rule, index) {
                    if (!isPlainObject(rule)) {
                        issues.push("logicDocPatch.actionRules[" + index + "] must be an object.");
                        return;
                    }
                    unknownKeys(rule, { id: true, name: true, trigger: true, condition: true, effects: true, enabled: true });
                    if (!rule.id || typeof rule.id !== "string") issues.push("logicDocPatch.actionRules[" + index + "].id must be a string.");
                    if (!rule.trigger || typeof rule.trigger !== "string") issues.push("logicDocPatch.actionRules[" + index + "].trigger must be a string switch id.");
                    if (rule.condition != null && typeof rule.condition !== "string") issues.push("logicDocPatch.actionRules[" + index + "].condition must be a string.");
                    if (!Array.isArray(rule.effects)) {
                        issues.push("logicDocPatch.actionRules[" + index + "].effects must be an array.");
                        return;
                    }
                    rule.effects.forEach(function eachEffect(effect, effectIndex) {
                        if (!isPlainObject(effect)) {
                            issues.push("logicDocPatch.actionRules[" + index + "].effects[" + effectIndex + "] must be an object.");
                            return;
                        }
                        unknownKeys(effect, { type: true, target: true, value: true });
                        if (typeof effect.type !== "string") {
                            issues.push("logicDocPatch.actionRules[" + index + "].effects[" + effectIndex + "].type must be a string.");
                            return;
                        }
                        if (["set", "add", "reset", "setElementProperty", "clearElementProperty"].indexOf(effect.type) >= 0 && typeof effect.target !== "string") {
                            issues.push("logicDocPatch.actionRules[" + index + "].effects[" + effectIndex + "].target must be a string for " + effect.type + ".");
                        }
                        if (effect.type === "set" && effect.value == null) {
                            issues.push("logicDocPatch.actionRules[" + index + "].effects[" + effectIndex + "].value is required for set.");
                        }
                        if (effect.type === "add" && typeof effect.value !== "number") {
                            issues.push("logicDocPatch.actionRules[" + index + "].effects[" + effectIndex + "].value must be numeric for add.");
                        }
                        if (effect.type === "score" && typeof effect.value !== "number") {
                            issues.push("logicDocPatch.actionRules[" + index + "].effects[" + effectIndex + "].value must be numeric for score.");
                        }
                        if (["set", "add", "score", "reset", "setElementProperty", "clearElementProperty"].indexOf(effect.type) < 0) {
                            issues.push("logicDocPatch.actionRules[" + index + "].effects[" + effectIndex + "].type must be one of: set, add, score, reset, setElementProperty, clearElementProperty.");
                        }
                    });
                });

                (Array.isArray(logicPatch.resetRules) ? logicPatch.resetRules : []).forEach(function each(rule, index) {
                    if (!isPlainObject(rule)) {
                        issues.push("logicDocPatch.resetRules[" + index + "] must be an object.");
                        return;
                    }
                    unknownKeys(rule, { id: true, name: true, trigger: true, scope: true, resets: true });
                    if (!rule.id || typeof rule.id !== "string") issues.push("logicDocPatch.resetRules[" + index + "].id must be a string.");
                    if (!rule.trigger || typeof rule.trigger !== "string") issues.push("logicDocPatch.resetRules[" + index + "].trigger must be a string switch id.");
                    if (!Array.isArray(rule.resets)) issues.push("logicDocPatch.resetRules[" + index + "].resets must be an array of state ids.");
                });

                const switchIds = {};
                (Array.isArray(logicPatch.switchRegistry) ? logicPatch.switchRegistry : []).forEach(function each(row) {
                    if (row && typeof row.id === "string" && row.id) switchIds[row.id] = true;
                });
                if (Object.keys(switchIds).length) {
                    (Array.isArray(logicPatch.actionRules) ? logicPatch.actionRules : []).forEach(function each(rule, index) {
                        if (!rule || typeof rule.trigger !== "string") return;
                        if (!switchIds[rule.trigger]) {
                            issues.push("logicDocPatch.actionRules[" + index + "].trigger must reference an id present in logicDocPatch.switchRegistry.");
                        }
                    });
                    (Array.isArray(logicPatch.resetRules) ? logicPatch.resetRules : []).forEach(function each(rule, index) {
                        if (!rule || typeof rule.trigger !== "string") return;
                        if (!switchIds[rule.trigger]) {
                            issues.push("logicDocPatch.resetRules[" + index + "].trigger must reference an id present in logicDocPatch.switchRegistry.");
                        }
                    });
                }
            }
        }

        return { ok: issues.length === 0, issues: issues };
    }


    function create(options) {
        const storedSettings = normalizeSettings(readJson(SETTINGS_KEY, {}));
        const storedAgenticMode = normalizeAgenticMode(readJson(AGENTIC_MODE_KEY, {}));
        const state = {
            settings: storedSettings,
            messages: [],
            draft: "",
            agenticDraft: "",
            agenticFullyAuto: storedAgenticMode.fullyAuto,
            agenticApproveEachChange: storedAgenticMode.approveEachChange,
            agenticRunning: false,
            agenticStopRequested: false,
            agenticBatches: [],
            agenticPendingPatch: null,
            agenticPendingBatchId: "",
            busy: false,
            error: "",
            lastPatch: null,
            logs: [],
            logOpen: false,
            picks: { steps: [], target: "", stepLamps: [], targetLamp: "" },
            layoutPicks: [],
            connectionStatus: "Disabled",
            availableModels: []
        };

        function refresh() {
            if (options && options.refresh) options.refresh("inspector");
        }

        function snapshot() {
            return clone(state);
        }

        function setSettings(nextSettings) {
            state.settings = normalizeSettings(nextSettings);
            writeJson(SETTINGS_KEY, state.settings);
            state.connectionStatus = "Saved";
            refresh();
        }
        function setDraft(value) { state.draft = value || ""; }
        function setAgenticDraft(value) { state.agenticDraft = value || ""; }
        function setAgenticMode(nextMode) {
            const mode = normalizeAgenticMode(nextMode);
            state.agenticFullyAuto = mode.fullyAuto;
            state.agenticApproveEachChange = mode.approveEachChange;
            writeJson(AGENTIC_MODE_KEY, mode);
            refresh();
        }
        function clearConversation() { state.messages = []; refresh(); }
        function addSelectedPick() {}
        function removePick() {}
        function clearPicks() {}
        function addSelectedLayoutPick() {}
        function removeLayoutPick() {}
        function clearLayoutPicks() {}
        function loadModels() {
            /* What: Populate provider model options for the provider pane.
             * Why: Even in static mode, the UI should provide deterministic feedback.
             */
            state.busy = true;
            state.error = "";
            state.connectionStatus = "Loading models...";
            refresh();
            return Promise.resolve().then(function finishLoad() {
                const settings = state.settings || {};
                const hasBaseUrl = !!String(settings.baseUrl || "").trim();
                const hasApiKey = !!String(settings.apiKey || "").trim();
                if (!hasBaseUrl || !hasApiKey) {
                    const missing = [];
                    if (!hasBaseUrl) missing.push("baseUrl");
                    if (!hasApiKey) missing.push("apiKey");
                    state.availableModels = [];
                    state.connectionStatus = "Missing required provider settings: " + missing.join(", ");
                    return [];
                }
                if (typeof fetch !== "function") {
                    state.availableModels = [];
                    state.connectionStatus = "Model loading unavailable (no fetch)";
                    return [];
                }
                const endpoint = toModelsEndpoint(settings.baseUrl);
                const headers = {
                    "Content-Type": "application/json",
                    Authorization: "Bearer " + String(settings.apiKey || "").trim()
                };
                return fetch(endpoint, { method: "GET", headers: headers }).then(function parseResponse(response) {
                    if (!response.ok) throw new Error("HTTP " + response.status + " from " + endpoint);
                    return response.json();
                }).then(function parseModels(payload) {
                    const rows = payload && Array.isArray(payload.data) ? payload.data : [];
                    const configured = settings.model ? String(settings.model) : "";
                    const seen = {};
                    const models = [];
                    rows.forEach(function each(row) {
                        const id = row && row.id != null ? String(row.id) : "";
                        if (!id || seen[id]) return;
                        seen[id] = true;
                        models.push({ id: id, label: id });
                    });
                    if (configured && !seen[configured]) {
                        models.unshift({ id: configured, label: configured });
                    }
                    state.availableModels = models;
                    state.connectionStatus = models.length ? "Models loaded" : "No models returned";
                    return models;
                });
            }).catch(function onError(err) {
                state.error = err && err.message ? String(err.message) : "Failed to load models.";
                state.connectionStatus = "Model load failed";
                state.availableModels = [];
                return [];
            }).finally(function done() {
                state.busy = false;
                refresh();
            });
        }
        function testConnection() {
            /* What: Validate provider settings shape in static mode.
             * Why: The button should communicate a concrete pass/fail result.
             */
            state.busy = true;
            state.error = "";
            state.connectionStatus = "Testing...";
            refresh();
            return Promise.resolve().then(function finishTest() {
                const settings = state.settings || {};
                const hasBaseUrl = !!String(settings.baseUrl || "").trim();
                const hasApiKey = !!String(settings.apiKey || "").trim();
                if (hasBaseUrl && hasApiKey) {
                    state.connectionStatus = "Configuration valid (static mode)";
                } else {
                    const missing = [];
                    if (!hasBaseUrl) missing.push("baseUrl");
                    if (!hasApiKey) missing.push("apiKey");
                    state.connectionStatus = "Missing required provider settings: " + missing.join(", ");
                }
            }).catch(function onError(err) {
                state.error = err && err.message ? String(err.message) : "Connection test failed.";
                state.connectionStatus = "Test failed";
            }).finally(function done() {
                state.busy = false;
                refresh();
            });
        }

        function appendLog(kind, detail) {
            state.logs.push({
                at: new Date().toISOString(),
                kind: kind,
                detail: detail
            });
        }

        function summarizePatch(patch) {
            const out = [];
            if (!patch || typeof patch !== "object") return out;
            if (Array.isArray(patch.addElements) && patch.addElements.length) out.push("Add elements: " + patch.addElements.length);
            if (Array.isArray(patch.patchElements) && patch.patchElements.length) out.push("Patch elements: " + patch.patchElements.length);
            if (Array.isArray(patch.removeElements) && patch.removeElements.length) out.push("Remove elements: " + patch.removeElements.length);
            if (Array.isArray(patch.addFeatures) && patch.addFeatures.length) out.push("Add features: " + patch.addFeatures.length);
            if (Array.isArray(patch.patchFeatures) && patch.patchFeatures.length) out.push("Patch features: " + patch.patchFeatures.length);
            if (Array.isArray(patch.removeFeatures) && patch.removeFeatures.length) out.push("Remove features: " + patch.removeFeatures.length);
            if (patch.tablePatch && typeof patch.tablePatch === "object") out.push("Patch table fields");
            if (patch.logicDocPatch && typeof patch.logicDocPatch === "object") out.push("Patch logic document");
            return out;
        }

        function ensureProviderReady() {
            const settings = state.settings || {};
            const baseUrl = safeString(settings.baseUrl).trim();
            const apiKey = safeString(settings.apiKey).trim();
            const model = safeString(settings.model).trim();
            if (!baseUrl || !apiKey || !model) {
                const missing = [];
                if (!baseUrl) missing.push("baseUrl");
                if (!apiKey) missing.push("apiKey");
                if (!model) missing.push("model");
                return { ok: false, message: "Missing required provider settings: " + missing.join(", ") };
            }
            if (typeof fetch !== "function") return { ok: false, message: "Fetch unavailable in this environment." };
            return { ok: true, settings: settings };
        }

        function createPatchRequestPrompt(task, table, selected) {
            const switchTypes = {
                lane: true,
                dropTarget: true,
                bumper: true,
                scoreZone: true,
                drain: true,
                spinner: true,
                kicker: true,
                trough: true,
                gate: true
            };
            const lampTypes = {
                light: true,
                arrowLight: true,
                boxLight: true,
                dropTarget: true,
                lane: true
            };
            const elements = Array.isArray(table && table.elements) ? table.elements : [];
            const logicDoc = table && table.logicDocument
                ? table.logicDocument
                : {
                    logicVersion: 1,
                    switchRegistry: [],
                    stateTable: [],
                    computedState: [],
                    lampBindings: [],
                    actionRules: [],
                    resetRules: []
                };
            const compact = {
                name: table && table.name || "",
                features: Array.isArray(table && table.features) ? table.features : [],
                selected: selected ? { id: selected.id, type: selected.type, name: selected.name || selected.label || "" } : null,
                elements: elements.map(function map(el) {
                    return { id: el.id, type: el.type, name: el.name || el.label || el.text || "" };
                }),
                switchCandidates: elements.filter(function filter(el) {
                    return el && el.id && switchTypes[el.type];
                }).map(function map(el) {
                    return { id: el.id, type: el.type, name: el.name || el.label || el.id };
                }),
                lampCandidates: elements.filter(function filter(el) {
                    return el && el.id && lampTypes[el.type];
                }).map(function map(el) {
                    const lampId = el.type === "dropTarget" ? String(el.id) : String(el.lampId || el.id);
                    return { lampId: lampId, sourceElementId: el.id, type: el.type, name: el.name || el.label || el.text || lampId };
                }),
                timerSwitches: [
                    { id: "timer_100ms", kind: "timer", intervalMs: 100 },
                    { id: "timer_1s", kind: "timer", intervalMs: 1000 }
                ],
                logicDoc: logicDoc
            };
            return [
                "You are a patch generator for a pinball table editor.",
                "Return ONLY JSON patch object with optional keys:",
                "tablePatch, addElements, patchElements, removeElements, addFeatures, patchFeatures, removeFeatures, logicDocPatch.",
                "Feature schema (for addFeatures/patchFeatures.patch): id, name, description, goal, objects[], states[], rules[], lamps[].",
                "Prefer feature-first updates: add/patch feature metadata when creating or changing gameplay logic.",
                "When editing logic, write into logicDocPatch using current schema keys only:",
                "logicVersion, switchRegistry, stateTable, computedState, lampBindings, actionRules, resetRules.",
                "Strict logic schema:",
                "- lampBindings rows use { lampId, expr } (NOT expression).",
                "- actionRules rows use { id, trigger, condition, effects, enabled } (NOT when).",
                "- action effect rows use { type, target?, value? } where type in set|add|score|reset|setElementProperty|clearElementProperty (NOT setState).",
                "- resetRules rows use { id, trigger, scope, resets } (NOT effects).",
                "- actionRules.trigger and resetRules.trigger must be switch IDs from switchRegistry.",
                "- Never use state ids as triggers.",
                "- Built-in timer switches available: timer_100ms and timer_1s.",
                "Only output the current patch keys listed above.",
                "For wiring tasks, always generate complete arrays in logicDocPatch for any lists you modify.",
                "When wiring a target to light when hit, ensure all of these are present:",
                "1) switchRegistry row mapping trigger switch id/sourceElementId",
                "2) stateTable bool state (example: target_id_lit)",
                "3) lampBindings row with lampId and expr = that state id",
                "4) actionRules row triggered by switch id, sets state true.",
                "If asked for timeout behavior, only implement it when a real timer/tick-like switch already exists in switchRegistry; never invent synthetic timeout trigger ids.",
                "For timeout behavior, prefer this valid pattern: int counter state + timer_1s add rule + threshold condition rule + drain/collect reset rule clearing counter/state.",
                "Keep existing unrelated logic rows unchanged.",
                "Do not include markdown.",
                "Respect feature-first logic authoring.",
                "Task:",
                safeString(task),
                "Table context:",
                JSON.stringify(compact)
            ].join("\n");
        }

        function requestPatch(taskText, repairNote) {
            const ready = ensureProviderReady();
            if (!ready.ok) return Promise.resolve({ ok: false, message: ready.message });
            const settings = ready.settings;
            const table = options && options.getTable ? options.getTable() : {};
            const selected = options && options.getSelected ? options.getSelected() : null;
            const endpoint = toChatEndpoint(settings.baseUrl);
            const body = {
                model: settings.model,
                temperature: 0.1,
                messages: [
                    { role: "system", content: "Generate safe structured patch JSON only." },
                    {
                        role: "user",
                        content: createPatchRequestPrompt(taskText, table, selected) +
                            (repairNote ? ("\nRepair note:\n" + repairNote) : "")
                    }
                ]
            };
            const headers = {
                "Content-Type": "application/json",
                Authorization: "Bearer " + safeString(settings.apiKey).trim()
            };
            return fetch(endpoint, {
                method: "POST",
                headers: headers,
                body: JSON.stringify(body)
            }).then(function parseResponse(response) {
                if (!response.ok) throw new Error("HTTP " + response.status + " from " + endpoint);
                return response.json();
            }).then(function parsePayload(payload) {
                const content = payload &&
                    payload.choices &&
                    payload.choices[0] &&
                    payload.choices[0].message &&
                    payload.choices[0].message.content
                    ? String(payload.choices[0].message.content)
                    : "";
                const patch = extractPatchJson(content);
                if (!patch || typeof patch !== "object") {
                    return { ok: false, message: "Model response did not include valid patch JSON.", raw: content };
                }
                const contract = validatePatchContract(patch);
                if (!contract.ok) {
                    return {
                        ok: false,
                        message: "Patch contract validation failed.",
                        contractIssues: contract.issues,
                        raw: content
                    };
                }
                return { ok: true, patch: patch, raw: content };
            }).catch(function onError(err) {
                return { ok: false, message: err && err.message ? String(err.message) : "Patch request failed." };
            });
        }

        function summarizePreviewIssues(preview) {
            if (!preview) return "";
            const issues = Array.isArray(preview.issues) ? preview.issues : [];
            if (!issues.length) return preview.error ? String(preview.error) : "";
            return issues.slice(0, 8).map(function map(issue) {
                const sev = issue && issue.severity ? String(issue.severity) : "issue";
                const msg = issue && issue.message ? String(issue.message) : "unknown";
                return "[" + sev + "] " + msg;
            }).join("\n");
        }

        function requestPatchWithRepair(taskText) {
            /* What: Generate a patch with iterative preview-driven repair attempts.
             * Why: Complex tasks often need multiple LLM passes to satisfy schema/validation.
             */
            const maxSteps = Math.max(1, Number((state.settings && state.settings.maxSteps) || 4));
            let attempt = 0;
            let lastFailure = "";

            function failureMessage(kind) {
                const label = kind || "validation";
                return "Unable to produce a valid patch after " + String(maxSteps) + " attempt(s). Last " + label + " issues: " + lastFailure;
            }

            function iterate() {
                attempt += 1;
                const repairNote = lastFailure ? (
                    "Previous patch failed validation. Fix these issues and return a full corrected patch JSON.\n" +
                    lastFailure
                ) : "";
                return requestPatch(taskText, repairNote).then(function onPatch(result) {
                    if (!result.ok) {
                        if (Array.isArray(result.contractIssues) && result.contractIssues.length) {
                            lastFailure = result.contractIssues.join("\n");
                            if (attempt < maxSteps) return iterate();
                            return {
                                ok: false,
                                message: failureMessage("contract"),
                                contractIssues: result.contractIssues,
                                raw: result.raw
                            };
                        }
                        return result;
                    }
                    const preview = options && options.previewPatch ? options.previewPatch(result.patch) : { ok: true, issuesCount: 0 };
                    result.preview = preview;
                    if (preview && preview.ok && Number(preview.issuesCount || 0) === 0) {
                        return result;
                    }
                    lastFailure = summarizePreviewIssues(preview) || (preview && preview.error) || "Unknown preview failure.";
                    if (attempt >= maxSteps) {
                        return {
                            ok: false,
                            message: failureMessage("preview"),
                            lastPatch: result.patch,
                            preview: preview
                        };
                    }
                    return iterate();
                });
            }

            return iterate();
        }
        function send() {
            if (!state.draft.trim()) return;
            const task = state.draft.trim();
            state.messages.push({ role: "user", content: task });
            state.busy = true;
            state.error = "";
            refresh();
            return requestPatchWithRepair(task).then(function onPatch(result) {
                if (!result.ok) {
                    state.error = result.message || "Assistant request failed.";
                    if (result.lastPatch) {
                        state.lastPatch = result.lastPatch;
                        state.lastPatchSummary = summarizePatch(result.lastPatch);
                    }
                    state.messages.push({ role: "assistant", content: "Failed: " + state.error });
                    appendLog("chat_error", state.error);
                    return;
                }
                const preview = result.preview || (options && options.previewPatch ? options.previewPatch(result.patch) : { ok: true, issuesCount: 0 });
                state.lastPatch = result.patch;
                state.lastPatchSummary = summarizePatch(result.patch);
                const status = preview.ok ? "Patch ready." : ("Patch generated with preview errors (" + (preview.error || "unknown") + ").");
                state.messages.push({ role: "assistant", content: status + " Review the Proposed Patch panel and click Apply." });
                appendLog("chat_patch", JSON.stringify({
                    summary: state.lastPatchSummary,
                    preview: preview
                }));
            }).finally(function done() {
                state.draft = "";
                state.busy = false;
                refresh();
            });
        }
        function runAgentic() {
            const task = safeString(state.agenticDraft).trim();
            if (!task || state.busy || state.agenticRunning) return;
            state.busy = true;
            state.agenticRunning = true;
            state.error = "";
            refresh();
            return requestPatchWithRepair(task).then(function onPatch(result) {
                if (!result.ok) {
                    state.error = result.message || "Agentic request failed.";
                    if (result.lastPatch) state.agenticPendingPatch = result.lastPatch;
                    appendLog("agentic_error", state.error);
                    return;
                }
                const preview = result.preview || (options && options.previewPatch ? options.previewPatch(result.patch) : { ok: true, issuesCount: 0 });
                const summary = summarizePatch(result.patch);
                if (state.agenticApproveEachChange || !state.agenticFullyAuto || !preview.ok || (preview.issuesCount || 0) > 0) {
                    state.agenticPendingPatch = result.patch;
                    state.agenticPendingBatchId = "batch_" + Date.now();
                    state.agenticBatches.push({
                        status: "pending",
                        at: new Date().toISOString(),
                        summary: summary,
                        preview: preview
                    });
                    appendLog("agentic_pending", JSON.stringify({ summary: summary, preview: preview }));
                    return;
                }
                const applyResult = options && options.applyPatch ? options.applyPatch(result.patch) : { ok: false, message: "No applyPatch callback." };
                state.agenticBatches.push({
                    status: applyResult.ok ? "applied" : "failed",
                    at: new Date().toISOString(),
                    summary: summary,
                    preview: preview,
                    error: applyResult.ok ? "" : (applyResult.message || "Apply failed")
                });
                if (!applyResult.ok) state.error = applyResult.message || "Apply failed.";
                appendLog("agentic_apply", JSON.stringify(applyResult));
            }).finally(function done() {
                state.busy = false;
                state.agenticRunning = false;
                refresh();
            });
        }
        function stopAgentic() {
            state.agenticStopRequested = true;
            state.agenticRunning = false;
            state.busy = false;
            refresh();
        }
        function applyAgenticPendingPatch() {
            if (!state.agenticPendingPatch) return { ok: false, message: "No pending patch." };
            const patch = state.agenticPendingPatch;
            const applyResult = options && options.applyPatch ? options.applyPatch(patch) : { ok: false, message: "No applyPatch callback." };
            const summary = summarizePatch(patch);
            state.agenticBatches.push({
                status: applyResult.ok ? "applied" : "failed",
                at: new Date().toISOString(),
                summary: summary,
                error: applyResult.ok ? "" : (applyResult.message || "Apply failed")
            });
            if (applyResult.ok) {
                state.agenticPendingPatch = null;
                state.agenticPendingBatchId = "";
            } else {
                state.error = applyResult.message || "Apply failed.";
            }
            refresh();
            return applyResult;
        }
        function rejectAgenticPendingPatch() {
            if (!state.agenticPendingPatch) return { ok: false, message: "No pending patch." };
            state.agenticBatches.push({
                status: "rejected",
                at: new Date().toISOString(),
                summary: summarizePatch(state.agenticPendingPatch)
            });
            state.agenticPendingPatch = null;
            state.agenticPendingBatchId = "";
            refresh();
            return { ok: true };
        }
        function quickPrompt() {}
        function applyLastPatch() {
            if (!state.lastPatch) return { ok: false, message: "No assistant patch to apply." };
            const result = options && options.applyPatch ? options.applyPatch(state.lastPatch) : { ok: false, message: "No applyPatch callback." };
            if (!result.ok) state.error = result.message || "Patch apply failed.";
            if (result.ok) state.lastPatch = null;
            refresh();
            return result;
        }
        function openLog() { state.logOpen = true; refresh(); }
        function closeLog() { state.logOpen = false; refresh(); }
        function clearLog() { state.logs = []; refresh(); }

        return {
            getState: snapshot,
            setSettings: setSettings,
            setDraft: setDraft,
            clearConversation: clearConversation,
            addSelectedPick: addSelectedPick,
            removePick: removePick,
            clearPicks: clearPicks,
            addSelectedLayoutPick: addSelectedLayoutPick,
            removeLayoutPick: removeLayoutPick,
            clearLayoutPicks: clearLayoutPicks,
            loadModels: loadModels,
            testConnection: testConnection,
            send: send,
            setAgenticDraft: setAgenticDraft,
            setAgenticMode: setAgenticMode,
            runAgentic: runAgentic,
            stopAgentic: stopAgentic,
            applyAgenticPendingPatch: applyAgenticPendingPatch,
            rejectAgenticPendingPatch: rejectAgenticPendingPatch,
            quickPrompt: quickPrompt,
            applyLastPatch: applyLastPatch,
            openLog: openLog,
            closeLog: closeLog,
            clearLog: clearLog
        };
    }

    Pin.editorAssistant = {
        create: create
    };
})(window.Pin);
