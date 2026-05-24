/*
 * What: Shared prompt contract builder for Designer Assistant and AI Lab.
 * Why: Prompt drift between assistant surfaces causes different patch quality and
 *      schema compliance. A single builder keeps instruction policy aligned.
 */
(function initAiPromptContract(root) {
    const Pin = root && root.Pin ? root.Pin : (typeof window !== "undefined" ? window.Pin : null);
    if (!Pin) return;

    /*
     * What: Build strict patch-generation prompt text from task, context, and feedback.
     * Why: Both Designer Assistant and AI Lab require the same patch schema guidance.
     * Correctness: The prompt explicitly names allowed patch keys and logicDoc shapes
     *              validated by runtime contract checks.
     */
    function buildPatchPrompt(options) {
        options = options || {};
        const task = String(options.task || "").trim();
        const context = options.context || {};
        const repairNote = String(options.repairNote || "").trim();
        const out = [
            "You are a patch generator for a pinball table editor.",
            "Return ONLY JSON patch object with optional keys:",
            "tablePatch, addElements, patchElements, removeElements, addFeatures, patchFeatures, removeFeatures, logicDocPatch.",
            "Feature schema (for addFeatures/patchFeatures.patch): id, name, description, goal, objects[], states[], rules[], lamps[].",
            "- In features, objects/states/rules/lamps arrays MUST contain strings only.",
            "- feature.states is an array of state IDs (strings), not state objects.",
            "- feature.rules is an array of action/reset rule IDs or short string notes, not rule objects.",
            "- feature.lamps is an array of lamp IDs (strings), not lamp binding objects.",
            "- Define state objects only in logicDocPatch.stateTable.",
            "- Define executable rules only in logicDocPatch.actionRules and logicDocPatch.resetRules.",
            "Prefer feature-first updates: add/patch feature metadata when creating or changing gameplay logic.",
            "When editing logic, write into logicDocPatch using current schema keys only:",
            "logicVersion, switchRegistry, stateTable, computedState, lampBindings, actionRules, resetRules.",
            "Strict logic schema:",
            "- patchElements entries MUST use { id, patch }. Never use { id, properties }.",
            "- lampBindings rows use { lampId, expr } (NOT expression).",
            "- actionRules rows use { id, trigger, condition, effects, enabled } (NOT when).",
            "- action effect rows use { type, target?, value? } where type in set|add|score|reset|setElementProperty|clearElementProperty (NOT setState).",
            "- resetRules rows use { id, trigger, scope, resets } (NOT effects).",
            "- resetRules.resets MUST be an array of state IDs as strings.",
            "- switchRegistry rows use { id, sourceElementId, name?, kind?, intervalMs? }. Do NOT use key `type` in switchRegistry.",
            "- actionRules.trigger and resetRules.trigger must be switch IDs from switchRegistry.",
            "- Every action/reset trigger you use MUST appear as a switchRegistry row in the same logicDocPatch.",
            "- Never use state ids or computed ids as triggers (invalid examples: trigger: \"BonusTimer\", trigger: \"BonusCollected\").",
            "- Every set/add/reset target and every resetRules.resets entry MUST appear as a stateTable id in the same logicDocPatch.",
            "- Never use state ids as triggers.",
            "- Do not use timer_100ms or timer_1s as triggers unless the current logicDoc already contains those switch ids.",
            "Only output the current patch keys listed above.",
            "Scope guardrails:",
            "- Do not invent unrelated mechanics, bonus modes, timers, trough logic, or new elements unless the task explicitly asks for them.",
            "- If task is about target lighting + drain reset, do not include addElements or unrelated patchElements.",
            "- Keep patch strictly scoped to the requested behavior.",
            "For wiring tasks, always generate complete arrays in logicDocPatch for any lists you modify.",
            "When wiring a target to light when hit, ensure all of these are present:",
            "1) switchRegistry row mapping trigger switch id/sourceElementId",
            "2) stateTable bool state (example: target_id_lit)",
            "3) lampBindings row with lampId and expr = that state id",
            "4) actionRules row triggered by switch id, sets state true.",
            "5) If you reset on drain, include a drain switch row in switchRegistry and use that exact switch id as resetRules.trigger.",
            "Group-target pattern:",
            "- If task says two groups of targets, create one bool state id per group in logicDocPatch.stateTable.",
            "- In addFeatures, set each feature.states to string ids only (example: [\"TrgGrpA_lit\"]).",
            "- Bind each target lamp to its group state via lampBindings.",
            "- Add one hit action rule per target switch that sets its group state true.",
            "- Add one drain reset rule that clears both group states.",
            "Valid feature metadata example:",
            "{ \"id\": \"feature_targets_a\", \"name\": \"Targets A\", \"objects\": [\"dropTarget_a1\"], \"states\": [\"TrgGrpA_lit\"], \"rules\": [\"TrgGrpA_on_a1\", \"TrgGrpA_reset_on_drain\"], \"lamps\": [\"dropTarget_a1\"] }",
            "Schema micro-example:",
            "{ \"patchElements\": [{ \"id\": \"dropTarget_x\", \"patch\": { \"score\": 1000 } }], \"logicDocPatch\": { \"switchRegistry\": [{ \"id\": \"dropTarget_x_hit\", \"sourceElementId\": \"dropTarget_x\" }], \"stateTable\": [{ \"id\": \"dropTarget_x_lit\", \"type\": \"bool\", \"initial\": false }], \"lampBindings\": [{ \"lampId\": \"dropTarget_x\", \"expr\": \"dropTarget_x_lit\" }], \"actionRules\": [{ \"id\": \"dropTarget_x_on\", \"trigger\": \"dropTarget_x_hit\", \"condition\": \"true\", \"effects\": [{ \"type\": \"set\", \"target\": \"dropTarget_x_lit\", \"value\": true }], \"enabled\": true }], \"resetRules\": [] } }",
            "If asked for timeout behavior, only implement it when a real timer/tick-like switch already exists in switchRegistry; never invent synthetic timeout trigger ids.",
            "For timeout behavior, prefer this valid pattern: int counter state + timer_1s add rule + threshold condition rule + drain/collect reset rule clearing counter/state.",
            "Keep existing unrelated logic rows unchanged.",
            "Do not include markdown.",
            "Respect feature-first logic authoring.",
            "Task:",
            task,
            "Table context:",
            JSON.stringify(context)
        ];
        if (repairNote) out.push("Repair note:\n" + repairNote);
        return out.join("\n");
    }

    Pin.aiPromptContract = {
        buildPatchPrompt: buildPatchPrompt
    };
})(typeof window !== "undefined" ? window : (typeof globalThis !== "undefined" ? globalThis : this));
