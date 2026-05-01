# Logic UI Plan

## What This Document Is For

This document reviews the current Logic tab in edit mode and proposes a clearer interaction model for building table logic. The goal is not to replace the underlying `rulesEngine.sequenceRules` or `rulesEngine.logicGraphs` model immediately. The goal is to stop exposing that model as the primary user experience.

## Status

Current implementation status as of 2026-05-01:

- Done: renamed the main logic workflow to `Design`, `Outcomes`, `Reset`, `Check`, `Advanced`
- Done: made the default logic subtab `Design`
- Done: moved generic graph editing behind `Advanced`
- Done: added human-readable outcome summaries, including gate lock actions
- Done: added direct outcome creation shortcuts for score actions and gate lock actions
- Done: consolidated reset and timing controls into one `Reset` view
- Done: kept the graph model internal and reused existing rule/graph sync
- Not done: true pick mode on the playfield for bind operations
- Not done: richer sequence summary cards with issue badges and usage counts
- Not done: specialized lamp outcome rows and mode-specific outcome rows
- Not done: a full domain-specific node editor

## Assumptions

- The common author is thinking in pinball terms: lanes, lights, targets, gates, awards, resets, and timed modes.
- The user should not need to understand graph coordinates, node ids, edge direction, switch ids, or lamp ids for normal sequence authoring.
- The assistant can construct valid logic, but the visible editor still needs to let a human inspect, adjust, and trust that logic.
- The existing `logicGraphs` model can remain the internal editable representation for now.
- The right inspector panel is constrained; the logic UI must avoid long vertical forms and repeated scrolling.

## Current State

The current Logic tab is technically functional but cognitively expensive.

It currently exposes:

- a sequence list
- subtabs: `Build`, `Selected`, `Rule`, `Validate`
- a flow strip
- step rows
- a timed target row
- an award row
- generic selected-node editing
- switch and lamp candidate pickers
- generic action node configuration
- graph-specific operations such as source/edge/node selection

The implementation lives mainly in:

- `app/editor/panels.js`, `renderLogicTab`
- `app/editor/rulesLogic.js`
- `app/ruleGraph.js`

The main problem is not missing capability. The main problem is that the UI makes the user translate their intention into implementation vocabulary.

## Main UX Problems

### 1. The UI Uses Internal Terms

Words such as `node`, `edge`, `source`, `graph`, `switchStep`, `timedTarget`, `lampId`, and `sourceRuleId` are implementation terms. They are meaningful to the code but not to the table designer.

The user wants to say:

- when these three lanes are completed
- light these three inserts
- then enable this bumper for 8 seconds
- score 1000 per hit
- then reset
- lock this gate after the ball has passed

The UI should present exactly that.

### 2. Sequence Construction Is Split Across Too Many Places

To edit one sequence, the user must move between `Build`, `Selected`, `Rule`, and sometimes `Validate`. The currently selected table object also matters, but that relationship is not always visually obvious.

The interface should let the user inspect and edit one complete sequence from one place.

### 3. Generic Graph Editing Is Too Prominent

The graph model is useful internally and may become useful for advanced rule work. It is not the right primary view for common pinball logic.

Most table logic is structured:

- trigger steps
- optional progress lights
- optional timed target
- awards
- property changes
- reset conditions

That structure should be the visible UI.

### 4. Object References Are Hard To Trust

IDs are correct for machines but weak for humans. The UI needs to emphasize:

- display name if present
- object type
- small visual icon
- table highlight
- role in the sequence

Raw ids should be available, but secondary.

### 5. Actions Are Too Abstract

`setElementProperty` is correct internally, but a user should see:

- Lock gate: Launcher Exit Gate
- Set score: Red Bumper = 1000
- Light lamp: Lane A = On

The generic operation name can be shown in an advanced/details area, not as the main label.

### 6. Add Sequence Creates Too Much Structure Too Soon

Currently `Add Sequence` creates a starter graph with step, timed target, award, and reset. That is mechanically convenient but visually presumptive. The user then sees several concepts they may not need yet.

The better flow is:

1. Create empty sequence with a readable name.
2. Add trigger steps.
3. Add outcomes.
4. Add optional target/timer.
5. Configure reset.

The UI can still create sensible defaults internally, but it should not force the user to reason about unused pieces.

## Target Mental Model

The Logic tab should answer four questions for each sequence:

1. **When does this sequence progress?**
2. **What does the player see while it progresses?**
3. **What happens when it completes?**
4. **When does it reset?**

That maps to a much clearer UI:

- `Sequences`: choose which rule to edit.
- `Steps`: table objects that must be hit/passed.
- `Progress Lights`: optional lamps tied to steps.
- `Complete / Target`: optional timed target after steps finish.
- `Outcomes`: score awards, property changes, lamp changes.
- `Reset`: drain, completion, wrong order, timer expiry.
- `Diagnostics`: validation issues and raw references.

## Proposed Logic Tab Layout

### Top Bar

The top of the Logic tab should be compact and always visible:

- sequence dropdown or segmented pill list
- `+ Sequence`
- duplicate
- delete
- validation badge

Example:

```text
Sequence: Lane Bonus v
[+ Sequence] [Duplicate] [Delete]   1 warning
```

Avoid a long list of sequence pills when many sequences exist. Use a dropdown or compact list with search once there are more than 4-5 sequences.

### Main Subtabs

Replace the current subtabs with:

- `Design`
- `Outcomes`
- `Reset`
- `Check`
- `Advanced`

`Design` should be the default and contain the normal workflow.

### Design Subtab

This should be the main editor.

It should show a readable sentence-like summary:

```text
Complete all of:
  1. Left Lane        lights Left Lane Lamp
  2. Middle Lane      lights Middle Lane Lamp
  3. Right Lane       lights Right Lane Lamp

Then for 8 seconds:
  Hit Red Bumper
```

Each row should include:

- object icon
- display name
- type label
- role label
- `Pick from table`
- `Change`
- remove/reorder controls

The user should be able to select a row, then click an object on the table to bind it.

Important behavior:

- Selecting a logic row highlights the referenced table object.
- Selecting a table object highlights every sequence row that references it.
- Hovering a row should highlight its table object.
- Unbound rows should be visually obvious but not noisy.

### Outcomes Subtab

This is where awards and property changes live.

Use domain labels instead of operation labels.

Examples:

```text
On completion:
  Award 1000 points
  Lock Launcher Exit Gate

During bonus window:
  Red Bumper scores 1000 per hit
```

Action rows should be type-driven:

- `Award points`
- `Set element score`
- `Change property`
- `Lock/unlock gate`
- `Turn lamp on/off`
- `Emit event`

For common cases, provide specialized rows:

- gate lock/unlock
- target score
- lamp state

Keep the generic property editor available only after choosing `Advanced property change`.

### Reset Subtab

Reset should be one short grouped section:

```text
Reset when:
[x] Ball drains
[x] Sequence completes
[ ] Wrong step is hit
[x] Timer expires
```

If ordered sequence is enabled:

```text
Order:
(*) In listed order
( ) Any order
```

This should not be mixed into graph node details.

### Check Subtab

Validation should be practical and actionable.

Each issue should say:

- what is wrong
- which sequence/object is involved
- what action fixes it

Example:

```text
Lane Bonus: Step 2 has no lamp.
[Pick lamp] [Ignore]
```

Switch mappings should not dominate this view. They are support plumbing.

### Advanced Subtab

This is where the existing graph view belongs.

It should be explicitly labeled as advanced/debug:

- raw graph nodes
- raw edges
- ids
- compiled sequence preview
- switch map table

This keeps the capability without making it the default authoring surface.

## Visual Object Picking

Object picking should be a first-class mode for logic editing.

When the user clicks `Pick trigger`:

1. The playfield enters pick mode.
2. Valid objects are highlighted.
3. Invalid objects are dimmed.
4. The row being edited remains visible in the right panel.
5. Clicking an object assigns it and exits pick mode.
6. Escape cancels.

Valid pick sets:

- trigger step: lane, spinner, gate, drain, launcher, dropTarget, bumper, kicker, scoreZone
- progress lamp: light, arrowLight
- timed target: same as trigger step
- action target: any element relevant to the chosen action

This is better than `Use Selected`, because it gives the user a clear task mode.

## Object Naming Requirement

The logic UI depends on understandable object names.

Every element should display:

```text
Display Name
type / id
```

If `name` is empty, fall back to a generated friendly name:

- `Lane lane_wcohsa` -> `Lane`
- `Gate gate_x12` -> `Gate`
- `Bumper bumper_m11qpo` -> `Bumper`

But the UI should encourage naming when an object enters logic:

```text
This object is used in logic. Name it:
[Left Lane]
```

Do not force naming, but make it easy.

## Sequence Summary Cards

Each sequence should have a compact card:

```text
Lane Bonus
3 steps -> Red Bumper for 8s -> 1000 pts
Uses: 3 lanes, 3 lights, 1 bumper
```

Status badges:

- `OK`
- `Missing target`
- `Missing lamp`
- `Disabled`
- `Advanced`

This gives context before the user opens details.

## How To Represent The Graph

Keep the graph as an internal model, but do not make normal users edit nodes directly.

Recommended visible graph treatment:

- A small read-only flow preview in `Design`.
- A full editable graph only in `Advanced`.
- No visible x/y fields for normal users.
- No `Mark as Source` / `Connect Source -> This` outside Advanced.

If we later build a true node editor, it should use domain-specific nodes:

- `Complete lanes`
- `Start timed target`
- `Award`
- `Lock gate`
- `Reset`

Not raw implementation node types.

## Data Model Implications

The existing model can support the proposed UI.

Current sequence rule fields already map well:

- `steps`
- `stepLampIds`
- `targetSwitchId`
- `targetLampId`
- `windowSeconds`
- `awardPoints`
- `actions`
- reset flags

Current action support also maps:

- score actions
- property actions such as `locked`

Likely useful additions later:

- stable display names for logic rows
- optional `description` for sequences
- optional `tags` or `category`
- richer action schemas for lamps and modes

Do not add these until the UI actually needs them.

## Implementation Plan

### Phase 1: Rename And Reframe Without Rebuilding

Goal: make the current UI less hostile quickly.

- Done: renamed `Build` to `Design`.
- Done: split the old `Rule`/`Validate` model into `Reset` and `Check`.
- Done: hid most graph/node vocabulary from the primary authoring flow.
- Done: show action summaries as human text such as `Lock Gate`.
- Partial: the old selected-node editor still exists, but only under `Advanced`.
- Remaining: rename bind actions more explicitly and remove remaining raw wording where it still leaks through.

Verify:

- A user can open a sequence and understand steps, target, award, and reset without reading ids.

### Phase 2: Single-Page Sequence Designer

Goal: one sequence can be edited mostly from one screen.

- Done in current form: steps, target, award, actions, and reset are now grouped by purpose instead of by raw node type.
- Done: keep Save/Reset card behavior for edits.
- Done: keep existing `rulesLogic` mutation functions and graph sync.
- Done: avoid rendering the full advanced graph by default.
- Remaining: break the current `renderLogicTab` implementation into smaller helpers such as `renderSequenceDesign`, `renderSequenceOutcomes`, and `renderSequenceAdvanced`.

Verify:

- Create a three-lane, three-light bonus sequence from the UI.
- Add an action that locks a gate.
- Delete and undo a sequence.

### Phase 3: Pick Mode

Goal: bind logic by clicking the table.

- Add editor pick mode state: `{ kind, graphId, nodeId, field }`.
- Highlight valid playfield objects.
- Click assigns the object to the active logic row.
- Escape cancels.
- Keep dropdown fallback in the row.

Verify:

- User can bind steps, lamps, target, and action target without manually selecting ids from long lists.

### Phase 4: Human-Focused Outcomes

Goal: make actions understandable.

- Add outcome row types:
  - award points
  - set score
  - lock/unlock gate
  - set property
- Internally compile these to existing action nodes / sequence actions.
- Hide generic `setElementProperty` unless advanced mode is active.

Verify:

- User can set: pass lane, return gate, lock gate.
- User can set: three lanes complete, timed bumper bonus starts.

### Phase 5: Advanced Graph Demotion

Goal: preserve power without polluting the normal workflow.

- Move raw graph node editing into `Advanced`.
- Show graph coordinates only there.
- Keep node/edge connect tools only there.
- Clearly label it as advanced.

Verify:

- Existing graph-based tables still load and can be inspected.
- Normal sequence editing does not require Advanced.

## Acceptance Scenarios

### Three Lanes Light Three Lamps

The user should be able to:

1. Create `Lane Bonus`.
2. Add three step rows.
3. Pick each lane from the table.
4. Pick each lamp from the table.
5. Set order to `Any order`.
6. See a summary saying all three lanes are required.

No raw ids should be required.

### Timed Red Bumper Bonus

The user should be able to:

1. After the three lanes complete, set `Red Bumper` as timed target.
2. Set timer to `8s`.
3. Set score award to `1000 per hit` or equivalent action.
4. See the target lamp if configured.

### Launcher Exit Gate

The user should be able to:

1. Use a gate as a trigger.
2. Add outcome: `Lock gate`.
3. Pick the launcher exit gate from the table.
4. See summary: `When sequence completes: lock Launcher Exit Gate`.

The user should not have to choose `setElementProperty`, type `locked`, or type `true` for the common case.

## Non-Goals For The First Pass

- Do not build a full visual programming environment.
- Do not introduce a new rules engine.
- Do not create a second source of truth.
- Do not require multi-select for sequence authoring.
- Do not make the Assistant the only usable logic workflow.

## Risks

- If the UI edits both graph and sequence structures independently, they may drift.
- If pick mode is vague, users may not know whether they are editing the table or binding logic.
- If advanced features remain mixed with normal authoring, the UI will stay intimidating.
- If object names remain blank, even a better UI will still be hard to read.

## Recommended Next Step

Start with Phase 1 and Phase 2 together:

1. Keep the existing graph data path.
2. Replace the visible `Build` content with a sequence designer.
3. Move selected-node editing and edge controls under `Advanced`.
4. Add human-readable outcome rows for score and gate lock actions.

This gives the biggest usability improvement without changing the runtime rules engine.
