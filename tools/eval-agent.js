/*
 * Eval-agent CLI for patch validation and dataset capture.
 * What: Runs assistant-contract patches against real table normalization,
 * logic validation, and tableEval checks in a Node workflow.
 * Why: Enables repeatable Chat/Agent loops that generate patch attempts and
 * collect machine-readable feedback for downstream model tuning.
 */
const fs = require("fs");
const path = require("path");
const vm = require("vm");
const crypto = require("crypto");

const ROOT = path.resolve(__dirname, "..");

function read(relPath) {
    return fs.readFileSync(path.join(ROOT, relPath), "utf8");
}

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

function isPlainObject(value) {
    return !!value && typeof value === "object" && !Array.isArray(value);
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

function loadPinRuntime() {
    const pin = {
        geometry: {},
        table: {},
        logicTypes: {},
        logicCompile: {},
        logicValidate: {},
        logicAssets: {},
        elements: {
            registry: {},
            register: function register(type, mod) {
                this.registry[type] = mod;
            }
        },
        physics: {},
        rules: {},
        events: { emit: function emit() {} },
        audio: {}
    };
    const ctx = {
        window: { Pin: pin },
        Pin: pin,
        console: console,
        setTimeout: setTimeout,
        clearTimeout: clearTimeout,
        performance: { now: function now() { return Date.now(); } }
    };
    vm.createContext(ctx);
    [
        "app/geometry.js",
        "app/table.js",
        "app/logic/expressions.js",
        "app/logic/logicTypes.js",
        "app/logic/compile.js",
        "app/logic/validate.js",
        "app/logic/assets.js",
        "app/elements/index.js",
        "app/elements/path.js",
        "app/elements/flipper.js",
        "app/elements/launcher.js",
        "app/elements/lane.js",
        "app/elements/dropTarget.js",
        "app/elements/bumper.js",
        "app/elements/scoreZone.js",
        "app/elements/drain.js",
        "app/elements/spinner.js",
        "app/elements/kicker.js",
        "app/elements/gate.js",
        "app/elements/trough.js",
        "app/elements/light.js",
        "app/elements/ramp.js",
        "app/editor/model.js",
        "app/editor/assistantTools.js",
        "app/rules.js",
        "app/physics.js",
        "app/aiPromptContract.js",
        "app/aiLabContract.js",
        "app/tableEval.js"
    ].forEach(function each(file) {
        vm.runInContext(read(file), ctx, { filename: file });
    });
    return ctx.window.Pin;
}

function loadJson(filePath) {
    const raw = fs.readFileSync(filePath, "utf8");
    return JSON.parse(raw);
}

function applyAssistantPatchToTable(pin, sourceTable, patch) {
    const working = clone(sourceTable);
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
        if (pin.logicTypes && pin.logicTypes.normalizeLogicDocument) {
            working.logicDocument = pin.logicTypes.normalizeLogicDocument(logicDoc);
        }
    }
    const normalized = pin.table.normalizeTable(working);
    const tableValidation = pin.table.validateTable(normalized);
    let logicValidation = { ok: true, issues: [] };
    if (pin.logicCompile && pin.logicValidate && pin.logicAssets) {
        const logicDoc = pin.logicCompile.extractFromTable(normalized);
        const logicAssets = pin.logicAssets.extractAssets(normalized);
        logicValidation = pin.logicValidate.validateDocument(logicDoc, logicAssets);
    }
    const mergedIssues = []
        .concat(Array.isArray(tableValidation.issues) ? tableValidation.issues : [])
        .concat(Array.isArray(logicValidation.issues) ? logicValidation.issues : []);
    const ok = !!(tableValidation.ok && logicValidation.ok);
    return {
        ok: ok,
        message: ok ? "Patch applied." : "Patch produced validation errors.",
        table: normalized,
        issues: mergedIssues
    };
}

function evaluatePatch(pin, table, patch, options) {
    if (pin.aiLabContract && typeof pin.aiLabContract.evaluatePatchAttempt === "function") {
        const result = pin.aiLabContract.evaluatePatchAttempt(table, patch, options || {});
        return {
            accepted: !!result.accepted,
            contractIssues: result.contractIssues || [],
            apply: { ok: !(result.validationIssues && result.validationIssues.length), message: result.accepted ? "Patch applied." : "Patch produced validation errors." },
            evalReport: result.evalReport || null,
            validationIssues: result.validationIssues || [],
            patchedTable: result.patchedTable || null,
            contractVersion: result.contractVersion,
            runtimeFingerprint: result.runtimeFingerprint,
            physicsContract: result.physicsContract
        };
    }
    const contract = validatePatchContract(patch);
    if (!contract.ok) {
        return {
            accepted: false,
            contractIssues: contract.issues,
            apply: null,
            evalReport: null,
            validationIssues: []
        };
    }
    const apply = applyAssistantPatchToTable(pin, table, patch);
    if (!apply.ok) {
        return {
            accepted: false,
            contractIssues: [],
            apply: { ok: false, message: apply.message },
            evalReport: null,
            validationIssues: apply.issues || []
        };
    }
    const evalReport = pin.tableEval.evaluateTable(apply.table, options || {});
    const hasFail = evalReport && evalReport.summary && evalReport.summary.failed > 0;
    return {
        accepted: !hasFail,
        contractIssues: [],
        apply: { ok: true, message: apply.message },
        evalReport: evalReport,
        validationIssues: apply.issues || [],
        patchedTable: apply.table
    };
}

function hashTable(table) {
    return crypto.createHash("sha256").update(JSON.stringify(table)).digest("hex");
}

function defaultLogicDocument(table) {
    return table && table.logicDocument
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
}

function compactPromptContext(table, evalReport) {
    /*
     * What: Build the same kind of compact schema context used by the browser assistant.
     * Why: Offline prompt optimization must test against realistic context without sending
     * entire table JSON blobs that obscure contract failures.
     * Correctness: The candidate/switch/lamp lists are derived from current table elements,
     * and the executable logic source is the table logicDocument schema used by validators.
     */
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
    return {
        tableName: table && table.name || "",
        summary: evalReport && evalReport.summary ? evalReport.summary : null,
        failedChecks: ((evalReport && evalReport.checks) || []).filter(function filter(check) {
            return check && check.status === "fail";
        }).map(function map(check) {
            return { id: check.id, message: check.message };
        }).slice(0, 16),
        features: Array.isArray(table && table.features) ? table.features : [],
        selected: null,
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
        logicDoc: defaultLogicDocument(table)
    };
}

function buildToolPromptInstruction(pin) {
    const toolsApi = pin && pin.editorAssistantTools;
    const toolList = toolsApi && typeof toolsApi.describeTools === "function"
        ? toolsApi.describeTools()
        : [];
    if (!toolList.length) return "";
    return [
        "You may request deterministic local tools when exact numbers or geometry would improve the patch.",
        "If you need a tool, return JSON only in this shape: {\"toolRequests\":[{\"tool\":\"toolName\",\"args\":{...}}]}",
        "After tool results are provided in a repair note, use them and return final patch JSON.",
        "Available local tools:",
        JSON.stringify(toolList)
    ].join("\n");
}

function buildCandidatePatchPrompt(candidateText, task, context, repairNote, pin) {
    /*
     * What: Render a GEPA prompt candidate into a concrete patch-generation prompt.
     * Why: GEPA should mutate the schema instructions while the task/context envelope
     * remains stable and auditable.
     * Correctness: The evaluator always appends the same task, context, and repair fields,
     * so score changes are attributable to the candidate instructions.
     */
    const toolInstruction = buildToolPromptInstruction(pin);
    const out = [
        String(candidateText || "").trim(),
        toolInstruction,
        "Task:",
        String(task || "").trim(),
        "Table context:",
        JSON.stringify(context || {})
    ].filter(function filter(line) { return !!line; });
    if (repairNote) out.push("Repair note:\n" + repairNote);
    return out.join("\n");
}

function executeToolRequests(pin, table, toolRequests) {
    const toolsApi = pin && pin.editorAssistantTools;
    if (!toolsApi || typeof toolsApi.runToolRequests !== "function") {
        return { ok: false, message: "Local assistant tool runtime is unavailable." };
    }
    return toolsApi.runToolRequests(toolRequests, {
        table: table || {},
        selected: null
    });
}

function toolRepairNote(toolExec) {
    return "Tool results from local deterministic functions. Use these results directly and return final patch JSON only.\n" +
        JSON.stringify({ toolResults: toolExec.toolResults || [] });
}

function appendDatasetRecord(filePath, record) {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.appendFileSync(filePath, JSON.stringify(record) + "\n", "utf8");
}

function parseArgs(argv) {
    const out = { _: [] };
    for (let i = 0; i < argv.length; i++) {
        const token = argv[i];
        if (token.startsWith("--")) {
            const key = token.slice(2);
            const value = argv[i + 1] && !argv[i + 1].startsWith("--") ? argv[++i] : "true";
            out[key] = value;
        } else out._.push(token);
    }
    return out;
}

async function callProvider(prompt, env) {
    const baseUrl = String(env.PIN_AI_BASE_URL || "").trim();
    const apiKey = String(env.PIN_AI_API_KEY || "").trim();
    const model = String(env.PIN_AI_MODEL || "").trim();
    if (!baseUrl || !apiKey || !model) throw new Error("Missing provider env: PIN_AI_BASE_URL, PIN_AI_API_KEY, PIN_AI_MODEL");
    const endpoint = /\/chat\/completions\/?$/i.test(baseUrl) ? baseUrl.replace(/\/+$/, "") : baseUrl.replace(/\/+$/, "") + "/chat/completions";
    const response = await fetch(endpoint, {
        method: "POST",
        headers: {
            "Content-Type": "application/json",
            Authorization: "Bearer " + apiKey
        },
        body: JSON.stringify({
            model: model,
            temperature: 0.1,
            messages: [{ role: "user", content: prompt }]
        })
    });
    if (!response.ok) throw new Error("Provider HTTP " + response.status);
    const payload = await response.json();
    const content = payload && payload.choices && payload.choices[0] && payload.choices[0].message ? String(payload.choices[0].message.content || "") : "";
    return content;
}

async function callReviewProvider(summary, env) {
    const baseUrl = String(env.PIN_AI_REVIEW_BASE_URL || "").trim();
    const apiKey = String(env.PIN_AI_REVIEW_API_KEY || "").trim();
    const model = String(env.PIN_AI_REVIEW_MODEL || "").trim();
    if (!baseUrl || !apiKey || !model) return null;
    const endpoint = /\/chat\/completions\/?$/i.test(baseUrl) ? baseUrl.replace(/\/+$/, "") : baseUrl.replace(/\/+$/, "") + "/chat/completions";
    const response = await fetch(endpoint, {
        method: "POST",
        headers: {
            "Content-Type": "application/json",
            Authorization: "Bearer " + apiKey
        },
        body: JSON.stringify({
            model: model,
            temperature: 0.1,
            messages: [{
                role: "user",
                content:
                    "Score this patch attempt for data quality. Return JSON only: {label,score,reason}.\n" +
                    JSON.stringify(summary)
            }]
        })
    });
    if (!response.ok) return null;
    const payload = await response.json();
    const content = payload && payload.choices && payload.choices[0] && payload.choices[0].message ? String(payload.choices[0].message.content || "") : "";
    const parsed = parsePatchJson(content);
    if (parsed && typeof parsed === "object") return parsed;
    return { label: "review_text", score: 0, reason: content.slice(0, 400) };
}

function parsePatchJson(text) {
    const raw = String(text || "").trim();
    if (!raw) return null;
    try { return JSON.parse(raw); } catch (err) {}
    const firstBrace = raw.indexOf("{");
    const lastBrace = raw.lastIndexOf("}");
    if (firstBrace >= 0 && lastBrace > firstBrace) {
        try { return JSON.parse(raw.slice(firstBrace, lastBrace + 1)); } catch (err) {}
    }
    return null;
}

function parseEvalChecksArg(value) {
    /*
     * What: Parse a comma-separated eval-check selection for prompt-eval runs.
     * Why: prompt optimization sometimes needs only schema/logic validation,
     * not the full "let us launch 10,000 rays because we can" experience.
     */
    if (value == null) return null;
    const items = String(value)
        .split(",")
        .map(function map(item) { return String(item || "").trim(); })
        .filter(function filter(item) { return !!item; });
    return items.length ? items : [];
}

function scorePromptResult(result) {
    /*
     * What: Convert patch/eval feedback into a bounded GEPA metric.
     * Why: GEPA needs a scalar objective, while reflection still receives the detailed
     * side information through the JSON result emitted by prompt-eval.
     * Correctness: Contract/schema failures dominate the penalty because those are the
     * prompt problems this optimizer is intended to reduce.
     */
    const contractPenalty = (result.contractIssues || []).length * 0.18;
    const validationPenalty = (result.validationIssues || []).length * 0.12;
    const summary = result.evalReport && result.evalReport.summary ? result.evalReport.summary : {};
    const failPenalty = Number(summary.failed || 0) * 0.16;
    const warnPenalty = Number(summary.warnings || 0) * 0.04;
    const base = result.accepted ? 1 : 0.35;
    const score = Math.max(0, Math.min(1, base - contractPenalty - validationPenalty - failPenalty - warnPenalty));
    return Math.round(score * 10000) / 10000;
}

async function main() {
    const args = parseArgs(process.argv.slice(2));
    const cmd = args._[0] || "help";
    if (cmd === "help") {
        process.stdout.write(
            "Usage:\n" +
            "  node tools/eval-agent.js validate-patch --table <table.json> --patch <patch.json> [--out <result.json>] [--dataset <records.jsonl>]\n" +
            "  node tools/eval-agent.js provider-loop --table <table.json> --prompt <text> [--max-steps 4] [--dataset <records.jsonl>]\n" +
            "  node tools/eval-agent.js prompt-eval --table <table.json> --task <text> --candidate <prompt.txt> [--max-steps 2] [--eval-checks table_validation,compilation] [--dataset <records.jsonl>]\n"
        );
        return;
    }
    const pin = loadPinRuntime();
    if (cmd === "validate-patch") {
        const tablePath = args.table ? path.resolve(args.table) : "";
        const patchPath = args.patch ? path.resolve(args.patch) : "";
        if (!tablePath || !patchPath) throw new Error("validate-patch requires --table and --patch");
        const table = loadJson(tablePath);
        const patch = loadJson(patchPath);
        const result = evaluatePatch(pin, table, patch, {});
        const payload = {
            accepted: !!result.accepted,
            contractIssues: result.contractIssues || [],
            validationIssues: result.validationIssues || [],
            evalReport: result.evalReport || null,
            patchedTableHash: result.patchedTable ? hashTable(result.patchedTable) : "",
            contractVersion: result.contractVersion || 0,
            runtimeFingerprint: result.runtimeFingerprint || "",
            physicsContract: result.physicsContract || ""
        };
        if (args.out) fs.writeFileSync(path.resolve(args.out), JSON.stringify(payload, null, 2), "utf8");
        if (args.dataset) {
            appendDatasetRecord(path.resolve(args.dataset), {
                runId: "run_" + Date.now(),
                timestamp: new Date().toISOString(),
                tableId: path.basename(tablePath),
                attempt: 1,
                patch: patch,
                accepted: payload.accepted,
                contractIssues: payload.contractIssues,
                validationIssues: payload.validationIssues,
                evalReport: payload.evalReport,
                patchedTableHash: payload.patchedTableHash
            });
        }
        process.stdout.write(JSON.stringify(payload, null, 2) + "\n");
        return;
    }
    if (cmd === "provider-loop") {
        const tablePath = args.table ? path.resolve(args.table) : "";
        const prompt = String(args.prompt || "").trim();
        if (!tablePath || !prompt) throw new Error("provider-loop requires --table and --prompt");
        const table = loadJson(tablePath);
        const maxSteps = Math.max(1, Number(args["max-steps"] || 4));
        let repair = "";
        let finalPayload = null;
        for (let step = 1; step <= maxSteps; step++) {
            const fullPrompt =
                "Return JSON patch only using keys: tablePatch, addElements, patchElements, removeElements, addFeatures, patchFeatures, removeFeatures, logicDocPatch.\n" +
                buildToolPromptInstruction(pin) + "\n" +
                "Task:\n" + prompt + "\n" +
                (repair ? ("\nRepair previous issues:\n" + repair + "\n") : "");
            const raw = await callProvider(fullPrompt, process.env);
            const patch = parsePatchJson(raw);
            if (!patch) {
                repair = "Response was not valid JSON patch.";
                continue;
            }
            if (Array.isArray(patch.toolRequests)) {
                const toolExec = executeToolRequests(pin, table, patch.toolRequests);
                finalPayload = {
                    attempt: step,
                    accepted: false,
                    patch: null,
                    toolRequests: patch.toolRequests,
                    toolResults: toolExec.toolResults || [],
                    contractIssues: toolExec.ok ? [] : [toolExec.message || "Tool execution failed."],
                    validationIssues: [],
                    evalReport: null,
                    contractVersion: 0,
                    runtimeFingerprint: "",
                    physicsContract: ""
                };
                if (!toolExec.ok) {
                    repair = "Tool execution failed: " + (toolExec.message || "unknown");
                    continue;
                }
                repair = toolRepairNote(toolExec);
                continue;
            }
            const result = evaluatePatch(pin, table, patch, {});
            finalPayload = {
                attempt: step,
                accepted: !!result.accepted,
                patch: patch,
                contractIssues: result.contractIssues || [],
                validationIssues: result.validationIssues || [],
                evalReport: result.evalReport || null,
                contractVersion: result.contractVersion || 0,
                runtimeFingerprint: result.runtimeFingerprint || "",
                physicsContract: result.physicsContract || ""
            };
            const review = await callReviewProvider({
                attempt: step,
                accepted: finalPayload.accepted,
                contractIssues: finalPayload.contractIssues,
                validationIssueCount: finalPayload.validationIssues.length,
                failedChecks: ((finalPayload.evalReport && finalPayload.evalReport.checks) || []).filter(function filter(check) {
                    return check && check.status === "fail";
                }).map(function map(check) { return { id: check.id, message: check.message }; }).slice(0, 20)
            }, process.env);
            if (review) finalPayload.review = review;
            if (args.dataset) {
                appendDatasetRecord(path.resolve(args.dataset), {
                    runId: "run_" + Date.now(),
                    timestamp: new Date().toISOString(),
                    tableId: path.basename(tablePath),
                    task: prompt,
                    attempt: step,
                    provider: "primary",
                    model: String(process.env.PIN_AI_MODEL || ""),
                    patch: patch,
                    accepted: finalPayload.accepted,
                    contractIssues: finalPayload.contractIssues,
                    validationIssues: finalPayload.validationIssues,
                    evalReport: finalPayload.evalReport,
                    reviewLabel: review && review.label != null ? review.label : "",
                    reviewScore: review && review.score != null ? review.score : "",
                    reviewReason: review && review.reason != null ? review.reason : "",
                    reviewProvider: review ? String(process.env.PIN_AI_REVIEW_BASE_URL || "") : "",
                    reviewModel: review ? String(process.env.PIN_AI_REVIEW_MODEL || "") : ""
                });
            }
            if (result.accepted) break;
            repair =
                "Contract issues: " + JSON.stringify(result.contractIssues || []) + "\n" +
                "Validation issues: " + JSON.stringify((result.validationIssues || []).slice(0, 20)) + "\n" +
                "Eval failed checks: " + JSON.stringify(
                    ((result.evalReport && result.evalReport.checks) || []).filter(function filter(check) {
                        return check && check.status === "fail";
                    }).map(function map(check) {
                        return { id: check.id, message: check.message };
                    }).slice(0, 20)
                );
        }
        if (!finalPayload) throw new Error("No patch result produced.");
        process.stdout.write(JSON.stringify(finalPayload, null, 2) + "\n");
        return;
    }
    if (cmd === "prompt-eval") {
        const tablePath = args.table ? path.resolve(args.table) : "";
        const task = String(args.task || "").trim();
        const candidatePath = args.candidate ? path.resolve(args.candidate) : "";
        if (!tablePath || !task || !candidatePath) throw new Error("prompt-eval requires --table, --task, and --candidate");
        const table = loadJson(tablePath);
        const candidateText = fs.readFileSync(candidatePath, "utf8");
        const maxSteps = Math.max(1, Number(args["max-steps"] || 2));
        const evalChecks = parseEvalChecksArg(args["eval-checks"]);
        let repair = "";
        let lastEvalReport = null;
        let finalPayload = null;
        for (let step = 1; step <= maxSteps; step++) {
            const context = compactPromptContext(table, lastEvalReport);
            const prompt = buildCandidatePatchPrompt(candidateText, task, context, repair, pin);
            const raw = await callProvider(prompt, process.env);
            const patch = parsePatchJson(raw);
            if (!patch) {
                finalPayload = {
                    attempt: step,
                    accepted: false,
                    score: 0,
                    patch: null,
                    contractIssues: ["Response was not valid JSON patch."],
                    validationIssues: [],
                    evalReport: null,
                    rawResponseSample: raw.slice(0, 1000),
                    contractVersion: 0,
                    runtimeFingerprint: "",
                    physicsContract: ""
                };
                repair = "Response was not valid JSON patch. Return only one JSON object using the supported patch keys.";
                continue;
            }
            if (Array.isArray(patch.toolRequests)) {
                const toolExec = executeToolRequests(pin, table, patch.toolRequests);
                finalPayload = {
                    attempt: step,
                    accepted: false,
                    score: 0,
                    patch: null,
                    toolRequests: patch.toolRequests,
                    toolResults: toolExec.toolResults || [],
                    contractIssues: toolExec.ok ? [] : [toolExec.message || "Tool execution failed."],
                    validationIssues: [],
                    evalReport: null,
                    contractVersion: 0,
                    runtimeFingerprint: "",
                    physicsContract: ""
                };
                if (!toolExec.ok) {
                    repair = "Tool execution failed: " + (toolExec.message || "unknown");
                    continue;
                }
                repair = toolRepairNote(toolExec);
                continue;
            }
            const result = evaluatePatch(pin, table, patch, evalChecks ? { evalChecks: evalChecks } : {});
            finalPayload = {
                attempt: step,
                accepted: !!result.accepted,
                patch: patch,
                contractIssues: result.contractIssues || [],
                validationIssues: result.validationIssues || [],
                evalReport: result.evalReport || null,
                contractVersion: result.contractVersion || 0,
                runtimeFingerprint: result.runtimeFingerprint || "",
                physicsContract: result.physicsContract || ""
            };
            finalPayload.score = scorePromptResult(finalPayload);
            lastEvalReport = finalPayload.evalReport;
            if (args.dataset) {
                appendDatasetRecord(path.resolve(args.dataset), {
                    runId: "prompt_eval_" + Date.now(),
                    timestamp: new Date().toISOString(),
                    tableId: path.basename(tablePath),
                    task: task,
                    attempt: step,
                    model: String(process.env.PIN_AI_MODEL || ""),
                    score: finalPayload.score,
                    patch: patch,
                    accepted: finalPayload.accepted,
                    contractIssues: finalPayload.contractIssues,
                    validationIssues: finalPayload.validationIssues,
                    evalReport: finalPayload.evalReport
                });
            }
            if (finalPayload.accepted) break;
            repair =
                "Contract issues: " + JSON.stringify(finalPayload.contractIssues || []) + "\n" +
                "Validation issues: " + JSON.stringify((finalPayload.validationIssues || []).slice(0, 20)) + "\n" +
                "Eval failed checks: " + JSON.stringify(
                    ((finalPayload.evalReport && finalPayload.evalReport.checks) || []).filter(function filter(check) {
                        return check && check.status === "fail";
                    }).map(function map(check) {
                        return { id: check.id, message: check.message };
                    }).slice(0, 20)
                );
        }
        if (!finalPayload) throw new Error("No prompt evaluation result produced.");
        if (args.out) fs.writeFileSync(path.resolve(args.out), JSON.stringify(finalPayload, null, 2), "utf8");
        process.stdout.write(JSON.stringify(finalPayload, null, 2) + "\n");
        return;
    }
    throw new Error("Unknown command: " + cmd);
}

if (require.main === module) {
    main().catch(function onError(err) {
        process.stderr.write(String(err && err.message ? err.message : err) + "\n");
        process.exit(1);
    });
}

module.exports = {
    loadPinRuntime: loadPinRuntime,
    validatePatchContract: validatePatchContract,
    applyAssistantPatchToTable: applyAssistantPatchToTable,
    evaluatePatch: evaluatePatch,
    compactPromptContext: compactPromptContext,
    buildCandidatePatchPrompt: buildCandidatePatchPrompt,
    buildToolPromptInstruction: buildToolPromptInstruction,
    executeToolRequests: executeToolRequests,
    scorePromptResult: scorePromptResult
};
