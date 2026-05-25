# Agentic Assistant Design (Current)

## Summary

Assistant and Agentic support must treat the current logic system as feature-first authoring, not as a raw rulesEngine editor.

The browser build now supports provider-backed Assistant and Agentic execution through structured, validated table patches. Any agentic execution must continue to preserve the current user-facing model:

- table geometry is edited in `#design`
- gameplay logic is authored in `#logic`
- logic starts from `features`, not raw variables/triggers/effects
- `rulesEngine` remains the compiled/runtime compatibility payload

## Current Logic Model

The logic editor owns:

- `table.features[]`: human editorial grouping for gameplay features
- logic document source under `table.rulesEngine.logicGraphs.logicDocument`
- switch registry
- stored state
- computed/derived state
- action rules
- reset rules
- lamp bindings
- scoring behavior
- simulation/test events

The logic editor must not own:

- playfield positions
- object shapes
- walls
- physics tuning
- flipper setup
- launcher setup
- device geometry

It may show table objects only as read-only references for wiring gameplay meaning.

## Feature Layer

`table.features[]` is the human-facing layer. It is editorial structure, not a second runtime engine.

Feature shape:

```json
{
  "id": "lhs_bonus",
  "name": "Left Bonus",
  "description": "Hit all three left targets to make the left bonus lane collectable.",
  "goal": "Light all three left targets, then collect the left bonus lane.",
  "objects": ["dropTarget_1", "dropTarget_2", "lane_lhs_bonus"],
  "states": ["lhs_1_lit", "lhs_2_lit", "lhs_complete", "lhs_bonus_ready"],
  "rules": ["A_LHS_1", "A_LHS_2", "A_BONUS_COLLECT_L"],
  "lamps": ["lhs_1_lit", "lhs_bonus_arrow"]
}
```

`parts` may appear as a legacy/compatibility list. Prefer `objects`, `states`, `rules`, and `lamps` for new work.

## UI Spine

The logic workspace has three main panes:

- left: table signal browser/reference list
- center: logic workspace
- right: inspector

Top sections:

- `Features`
- `Rules`
- `State`
- `Feedback`
- `Simulator`
- `Diagnostics`

Default section is `Features`.

The left pane lists imported references:

- switches with usage badges
- lamps with binding badges
- state with writer counts

The center pane should be scoped by selected feature when possible. Rules, State, and Feedback have an `All Features` / feature selector. The inspector shows precise details and downstream consequences.

## Authoring Vocabulary

Use pinball meaning in all assistant responses and agentic plans:

- Feature
- Signal
- State
- Derived state
- Rule
- Effect
- Feedback binding
- Reset rule
- Test sequence

Avoid making users work in raw storage terms:

- variables
- triggers
- switchMap
- effects arrays
- rulesEngine internals
- graph nodes/edges

Those terms are allowed only in diagnostics or implementation summaries.

## Current Runtime Flow

Logic source is stored as a normalized logic document in:

```text
table.rulesEngine.logicGraphs.logicDocument
```

Compilation writes runtime-compatible fields:

- `rulesEngine.switchMap`
- `rulesEngine.sequenceRules`
- `rulesEngine.triggers`
- `rulesEngine.variables`
- `rulesEngine.logicGraphs.logicDocument`

At play time, events resolve physical element IDs to logical switch IDs. The logic simulator fires switch rules, mutates state, awards score, and updates lamp state.

## Agentic Mutation Contract

Future agentic mutations must use structured table patches only. Direct free-form JSON rewrites are not permitted.

Allowed table/design edits:

- table metadata updates
- image layer edits
- element add/update/delete
- level edits

Allowed logic edits:

- add/update/delete `table.features[]`
- update `rulesEngine.logicGraphs.logicDocument.switchRegistry`
- update stored state
- update computed state
- update action rules
- update reset rules
- update lamp bindings

After every mutation:

1. normalize table
2. validate table
3. validate logic document
4. simulate relevant switch events when possible
5. report downstream impact

## Agentic Planning Rules

When asked to create or change game logic:

1. Start by identifying the feature, not the rule row.
2. Resolve involved physical objects from table references.
3. Define needed state and derived state.
4. Define rules in readable form: When / If / Then.
5. Define feedback: lamps/arrows/lit targets.
6. Define resets, especially drain/volatile clears.
7. Add or update `table.features[]` to group the work.
8. Compile and validate through the existing logic document path.
9. Run simulator events that prove the behavior.

Example feature plan:

```text
Feature: Left Bonus
Purpose: Hit three left targets, then collect the left bonus lane.
Inputs: LHS Target 1, LHS Target 2, LHS Target 3, LHS Bonus Lane
State: lhs_1_lit, lhs_2_lit, lhs_3_lit, lhs_bonus_ready
Rules:
- When LHS Target 1 is hit, set lhs_1_lit true and score 500.
- When LHS Bonus Lane is entered and lhs_bonus_ready is true, score 3000 and clear target state.
Feedback: bind target lamps and bonus arrow to state.
Reset: drain resets volatile target state.
```

## Assistant Chat Behavior

Current browser build:

- Chat stores a local transcript and can call configured provider endpoints.
- Chat may decide it needs deterministic browser-local tool help for exact numbers or geometry, request one or more whitelisted tools, then return a final structured patch.
- Patch preview and patch application are active runtime paths.
- Chat response should still respect `#logic` as the feature-first authoring surface for gameplay logic.

Do not state that logic is removed. The current logic system is active and feature-first.

## Agentic UI Behavior

Current browser build:

- Agentic controls are active runtime UI.
- Run/stop/apply/pending-review behavior is implemented through the same structured patch contract used by chat.
- Agentic copy should describe the actual guarded execution flow: provider request, validation, preview, pending patch when needed, and apply/reject controls.

When implementation resumes, agentic execution should be feature-aware and should not resurrect old sequence-rule-first language.

## Testing Expectations

Minimum checks after assistant/agentic or logic model edits:

- `npm test`
- table normalization keeps `features: []`
- feature metadata validates structurally
- `#logic` still opens with `Features` as the default section
- rule inspector still shows downstream `Affects` rows
- simulator can fire logical switches without changing table geometry

## Deprecated Guidance

Older references to these as the primary authoring model are stale:

- `sequenceRules` as the central UI unit
- variables/triggers as user-facing first-class concepts
- graph editing as the default logic UI
- "logic system removed"

Keep compatibility with the compiled fields, but do not present them as the main authoring experience.
