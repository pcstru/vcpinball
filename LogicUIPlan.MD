# Logic UI Plan (Current)

## Purpose

The logic editor should expose pinball meaning, not implementation storage. The current system is feature-first: a feature is the normal unit of work, while rules/state/feedback remain inspectable details.

## Current Shape

Routes:

- `#play`: gameplay
- `#design`: physical table/object editing
- `#logic`: logic-only authoring
- `#logicstudio`: alias for `#logic`

The logic workspace is separate from geometry editing. It may show table references, but it should not edit positions, shapes, walls, physics, flippers, launchers, or device geometry.

## Pane Model

The logic UI uses three main panes:

```text
Table references | Logic workspace | Inspector
```

Left pane:

- imported switches
- imported lamps
- state references
- usage/binding badges

Center pane:

- feature cards
- readable rule rows
- state/feedback scoped to selected feature
- simulator and diagnostics

Right pane:

- selected item details
- conditions and effects
- downstream dependencies
- exact ids where needed

## Top Navigation

Current top sections:

- `Features`
- `Rules`
- `State`
- `Feedback`
- `Simulator`
- `Diagnostics`

Default section: `Features`.

`Rules`, `State`, and `Feedback` include a scope selector:

- `All Features`
- one named feature

## Core Concepts

Use this hierarchy:

```text
Table references
  -> Feature
    -> Physical objects/signals
    -> State
    -> Rules
    -> Feedback
    -> Resets
    -> Simulation
```

Avoid this as the primary UI:

```text
rulesEngine
  -> switchMap
  -> variables
  -> triggers
  -> effects arrays
  -> graph internals
```

## Feature Layer

`table.features[]` groups human meaning:

```json
{
  "id": "lhs_bonus",
  "name": "Left Bonus",
  "description": "Hit all three left targets to make the left bonus lane collectable.",
  "goal": "Light all three targets, then collect the lane.",
  "objects": ["dropTarget_1", "dropTarget_2", "lane_lhs_bonus"],
  "states": ["lhs_1_lit", "lhs_2_lit", "lhs_ready"],
  "rules": ["A_LHS_1", "A_LHS_COLLECT"],
  "lamps": ["lhs_1_lit", "lhs_bonus_arrow"]
}
```

This is not duplication. It is editorial structure over the execution model.

## Rule Inspector

When an action rule is selected, the inspector should show:

- name and id
- When: switch event
- If: condition
- Then: effects
- Reads as: human summary
- Affects Lamps
- Affects Computed State
- Affects Features

The important behavior is consequence visibility. A rule editor that only shows the rule is not enough.

## Simulator

The simulator is required for trust. It should allow firing named switches and should show:

- current score
- stored state
- computed state
- lamp state
- event log

Tests should be feature-oriented where possible.

## Diagnostics

Diagnostics may expose the matrix/God View and lower-level runtime detail. Graph or raw compiled fields belong here, not in the default workflow.

## Assistant/Agentic Alignment

Assistant and Agentic guidance must follow the same model:

- start with the feature
- resolve table references
- define state
- define rules in When/If/Then language
- bind feedback
- define resets
- prove behavior in the simulator

Do not describe the current logic system as removed. Do not make `sequenceRules`, `variables`, `triggers`, or graph nodes the primary authoring language.

## Near-Term Improvements

- Feature cards should offer direct drill-down to their linked rules/state/feedback.
- The signal browser should support selecting a reference and showing where it is used.
- Simulator should support saved test sequences grouped by feature.
- Agentic execution, when enabled, should mutate only through structured validated patches.
