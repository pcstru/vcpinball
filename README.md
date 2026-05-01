# Generic Pinball: Design + Play

Static pinball web app with two modes:

- `#play` to play a table
- `#design` to edit/create a table

No build step is required.

## Run

- Open `index.html` directly, or serve folder on any static host.
- On a hosted copy, the startup fallback table is `tables/DefTable.json` when there is no URL table token and no saved local table.
- **Play:** open `index.html` (default) or `index.html#play`.
- **Design (edit):** set the URL to `index.html#design` (type `#design` at the end of the path and press Enter), or from play press **D**.
- **Back to play from design:** use the **Test Play** toolbar button, or open `index.html#play`.
- **Physics tuning lab:** open `physics-lab.html`.

## Files

- `app/main.js`: mode bootstrap + runtime loop
- `app/physicsHarness.js`: shared flipper tuning scenarios used by tests and the physics lab
- `app/editor/assistant.js`: provider-agnostic AI assistant runtime for design mode
- `app/table.js`: schema helpers, defaults, legacy migration
- `app/geometry.js`: cubic bezier flattening and path tessellation
- `app/physics.js`: collision + substepped simulation
- `app/elements/*`: object compile/draw behavior
- `app/ruleGraph.js`: sequence-rule graph compiler/sync layer
- `app/editor/*`: design mode layout + tool support
- `app/storage.js`: LocalStorage, import/export, URL encoding
- `tables/DefTable.json`: default startup table for hosted deployments
- `tables/cyberpin.json`: converted Neon Cyberpin table
- `tables/logic_demo.json`: rule/Logic editor demo table
- `tables/empty.json`: starter blank table
- `physics-lab.html`: dedicated flipper tuning plus sandbox walls/flippers/spawn/drain physics page with select/move
- `DS-Pinballv2.html`: legacy/reference standalone prototype, not the active app surface

## Table JSON

Core shape:

```json
{
  "version": 1,
  "name": "Table Name",
  "playfield": { "width": 500, "height": 880, "gravity": 0.35, "friction": 0.999, "restitution": 0.55, "maxSpeed": 24 },
  "rules": { "balls": 3, "highScoreKey": "pin.high" },
  "rulesEngine": { "switchMap": [], "sequenceRules": [], "logicGraphs": [], "triggers": [], "variables": [] },
  "images": [],
  "launcher": { "x": 439, "y": 710, "dir": { "x": 0, "y": -1 }, "maxPower": 42 },
  "elements": []
}
```

Path elements support cubic bezier anchors:

```json
{
  "type": "path",
  "anchors": [
    { "x": 100, "y": 200, "outHandle": { "x": 40, "y": 0 } },
    { "x": 220, "y": 260, "inHandle": { "x": -35, "y": -30 } }
  ]
}
```

The engine tessellates curves into collision segments using adaptive subdivision.

Ramps are 2.5D transition surfaces. Their rails collide only with balls currently
on that ramp, and the ball moves between `levelFrom` and `levelTo` as it travels
through the ramp footprint:

```json
{
  "type": "ramp",
  "levelFrom": 0,
  "levelTo": 1,
  "zStart": 0,
  "zEnd": 48,
  "leftAnchors": [{ "x": 100, "y": 500 }, { "x": 180, "y": 420 }],
  "rightAnchors": [{ "x": 130, "y": 520 }, { "x": 210, "y": 440 }]
}
```

Ordinary elements default to `level: 0`. Add `level: 1` to walls, targets, or
other objects that should only collide with balls after they exit onto an upper
playfield.

## Rules, switches, and lamps

The runtime treats table objects as mechanisms. Mechanisms emit events such as
`switchClosed`, `switchOpened`, `score`, `ballDrained`, and `plungerReleased`.
The rules engine consumes those events after each fixed physics tick.

For simple rules, an element ID is already a valid switch ID. For example, a
lane with `id: "laneA"` can be used directly as the sequence step `"laneA"`.
Use `rulesEngine.switchMap` when you want to rename or normalize a mechanism
event into a game-logic switch ID:

```json
"switchMap": [
  { "eventType": "switchClosed", "sourceId": "leftOrbitSensor", "switchId": "orbit-left" }
]
```

Sequence rules describe objectives such as "complete A/B/C, then hit the lit
target within 8 seconds":

```json
"sequenceRules": [
  {
    "id": "abc_lane_bonus",
    "name": "ABC Lane Bonus",
    "enabled": true,
    "ordered": true,
    "steps": ["laneA", "laneB", "laneC"],
    "targetSwitchId": "scoreZone1",
    "stepLampIds": ["lamp_lane_a", "lamp_lane_b", "lamp_lane_c"],
    "targetLampId": "lamp_bonus_target",
    "windowSeconds": 8,
    "awardPoints": 2500,
    "awardEvent": "abcLaneBonusAwarded",
    "resetOnDrain": true,
    "resetOnComplete": true,
    "resetOnWrongOrder": false
  }
]
```

Timed triggers live in `rulesEngine.triggers`. They emit normal switch-like
events, so a trigger `switchId` can be used in `steps`, graph nodes, scoring,
actions, and lamp logic:

```json
"triggers": [
  { "id": "flash_timer", "type": "interval", "everySeconds": 0.5, "switchId": "tick.flash", "enabled": true }
]
```

Logic variables live in `rulesEngine.variables`. They are runtime-only state,
reset from the table defaults when a world/table is loaded, and are not physical
table elements:

```json
"variables": [
  { "id": "flash", "name": "Flash", "properties": { "value": false } }
]
```

Rules may include `conditions` that read variables, element scores/properties,
world score, or constants. Supported operators are `eq`, `ne`, `gt`, `gte`,
`lt`, `lte`, `truthy`, and `falsy`:

```json
"conditions": [
  { "source": "variable", "variableId": "flash", "property": "value", "operator": "truthy" }
]
```

Score-producing mechanisms can also carry a base `score` property. At runtime,
`spinner`, `scoreZone`, `lane`, `bumper`, `dropTarget`, and `kicker` emit
`score` events through the rules queue rather than mutating `world.score`
directly.

`kicker` now supports both the original single circular post and a composite
1-3 post layout using `anchors` plus `bandThickness`. In the composite form,
the posts and the connecting rubber band perimeter both collide and kick. Each
anchor may also override the shared post radius with its own `radius`.

Sequence rules may also include runtime actions. The current supported action
shapes are:

```json
"actions": [
  { "actionType": "setElementScore", "targetId": "bonusTarget", "value": 5000 },
  { "actionType": "addElementScore", "targetId": "spinner1", "value": 100 },
  { "actionType": "resetElementScore", "targetId": "spinner1" },
  { "actionType": "setElementProperty", "targetId": "launcherExitGate", "property": "locked", "value": true },
  { "actionType": "resetElementProperty", "targetId": "launcherExitGate", "property": "locked" },
  { "actionType": "toggleVariableProperty", "variableId": "flash", "property": "value" },
  { "actionType": "setLampFromVariable", "lampId": "lamp_flash", "variableId": "flash", "property": "value" }
]
```

These actions run when the rule awards and let logic temporarily or permanently
raise/lower the effective score used by later element hits or override supported
runtime properties such as a gate's `locked` state. Variable actions mutate
runtime-only named logic state, and lamp actions write directly to logic lamp
state before the final lamp merge.

Light elements render rule output. A circular `light`, arrow-shaped
`arrowLight`, or rounded presentation `boxLight` is addressed by `lampId`,
falling back to its element `id` if `lampId` is omitted:

```json
{ "id": "lampLaneA", "type": "light", "x": 80, "y": 145, "radius": 11, "lampId": "lamp_lane_a", "text": "A" }
{ "id": "lampShoot", "type": "arrowLight", "x": 250, "y": 220, "w": 90, "h": 34, "angle": 0.4, "lampId": "shoot", "text": "SHOOT" }
{ "id": "lampBonus", "type": "boxLight", "x": 250, "y": 180, "w": 120, "h": 40, "angle": 0, "cornerRadius": 10, "lampId": "bonus", "text": "BONUS" }
```

Table structure levels are separate from image layers. Use `table.levels` to
define authoring groups such as the main playfield and upper areas:

```json
"levels": [
  { "level": 0, "name": "Playfield", "parentLevel": null, "elevation": 0, "editorVisible": true },
  { "level": 1, "name": "Upper Level", "parentLevel": 0, "elevation": 48, "editorVisible": true }
]
```

Elements belong to a level via `level`. Ramps still use `levelFrom` and
`levelTo` for ball travel. In the editor, the Levels tab uses this structure
for visibility and context; it is not a gameplay draw-order list.

Table images are optional playfield layers. They can be used as actual play
background art, as a design-only layout overlay, or both:

```json
"images": [
  {
    "id": "layout_overlay",
    "src": "tables/ExTableImg.png",
    "mode": "design",
    "fit": "contain",
    "opacity": 0.35,
    "scale": 1,
    "offsetX": 0,
    "offsetY": 0
  }
]
```

`mode` accepts `play`, `design`, or `both`. `fit` accepts `contain`, `cover`,
`stretch`, or `none`. `opacity`, `scale`, and `offsetX`/`offsetY` control
how the layer sits on the table. In play mode, images are drawn behind the
mechanisms. In design mode, layers with `mode: "design"` are shown so they can
be used for layout reference without affecting gameplay.

In design mode, the Rules tab provides pickers for known element IDs, switch
IDs, and lamp IDs. Sequence step and lamp lists are ordered; use the up/down
buttons beside each token to change the order without deleting and re-adding
IDs. The sequence preview shows how each step lines up with its lamp. The
validation panel flags missing references, duplicate rule IDs, duplicate switch
mappings, empty sequence rules, invalid timed target windows, bad timers,
unknown variables, and unknown logic lamps. New switch
mappings are prefilled from the first selectable mechanism when possible.

The Table tab also has playability validation. It checks for structural issues
such as missing launcher/drain/trough elements, too few flippers, duplicate
element IDs, invalid launcher geometry, and ramp definitions that do not have
enough anchors or do not change level.

The Logic tab uses `rulesEngine.logicGraphs` as the editable graph model and
compiles the sequence-shaped parts into `sequenceRules` for runtime. `Add
Sequence` opens a visible starter graph with Step, Timed Target, Award, and
Reset nodes, and the editor now also supports generic nodes plus explicit edge
links. Unassigned nodes stay visible so the next authoring action is clear.
Clicking a step or target node selects the table object that provides that
switch when one is already bound. Clicking a lamp node selects the matching
light insert. To bind a graph node, select the graph node, select the table
object or light on the playfield, then use the node detail action to assign the
current selection. Use `Add Step` on the graph card to grow the sequence, or
`Add Node` to add custom graph nodes. The right inspector panel is resizable;
drag the vertical splitter between the playfield and inspector to give the
Logic graph more room. Variables and Timers subtabs edit `rulesEngine.variables`
and `rulesEngine.triggers`; condition nodes gate sequence awards and action
nodes can target elements, variables, or lamps.

The Assistant tab is a static-app client for OpenAI-compatible providers such
as LM Studio. Configure `baseUrl` (for LM Studio typically
`http://127.0.0.1:1234/v1`) and `model`, then ask for help building rules. The
assistant only has read/query tools over the current in-memory table and can
only propose structured patches. Patches are not applied automatically: the
editor shows the proposed JSON and requires an explicit `Apply`.

The Provider section now has:

- `Test Connection`
- `Load Models`

For LM Studio, the intended flow is:

1. set `baseUrl`
2. click `Test Connection`
3. click `Load Models` if needed
4. choose/save a model

`apiKey` is not persisted by the app. On reload you will need to enter it
again, which is intentional for a hosted static deployment.

The Assistant tab is split into:

- `Chat`
- `Provider`

`Chat` is the main agent surface. It includes:

- compact context/status
- conversation
- `Show Log` for the two-pass assistant trace
- proposed patch review/apply

Assistant patches are now shown summary-first. The editor renders a readable
change summary from the proposed operations before the raw JSON payload, so the
normal review flow is: read the summary, then inspect the JSON only if needed.

The assistant is selection-aware and also sees table object names/types, rules,
logic graphs, validation issues, and the `TBSpec.MD` skill text behind the
scenes. The intended user model is still simple: ask in chat, review the patch,
apply or rollback.

The assistant context must stay current with the live editor model. Its compact
table summary includes editable element fields such as lane `w/h`, element
`score`, launcher geometry/power fields, flipper material fields, rotating
`gate` fields, and trough saucer fields. `get_element` returns the full current
element when a task needs exact properties. When new element properties are
added, update `app/editor/assistant.js` and `TBSpec.MD` together.

If the provider returns a bad structured result, the assistant now reports that
as an invalid structured response instead of flattening it into `No response`.
Use `Show Log` to inspect the first pass, extraction pass, parse result, and
provider errors.

Internally the assistant now uses a two-stage prompt pipeline:

1. a tool-using task pass that thinks about the request
2. a strict JSON extraction pass that must emit the supported patch schema

The intent is prompt discipline rather than a growing set of patch-repair
helpers. Outside of basic markdown stripping before JSON parse, unsupported
formats are rejected rather than being repaired with more special cases.

The first pass is intentionally not the patch itself. It should identify the
target ids and intended edit operations in plain working terms. The second pass
must then convert that intent into the supported patch envelope instead of
echoing raw element objects, illustrative JSON, or JSON Patch arrays.

Where the provider supports it, the second pass also requests JSON Schema
output at the API level. That is part of the assistant contract, not an output
repair layer.

Applied assistant changes can be rolled back with `Undo`, and the Assistant
Chat subtab now exposes a `Rollback` button that uses the same undo history.

The first supported assistant patch operations are:

- `addSequenceRule`
- `updateSequenceRule`
- `deleteSequenceRule`
- `addSwitchMap`
- `updateSwitchMap`
- `deleteSwitchMap`
- `addVariable`
- `updateVariable`
- `deleteVariable`
- `addTrigger`
- `updateTrigger`
- `deleteTrigger`
- `alignHorizontal`
- `distributeHorizontal`
- `matchWidth`
- `matchHeight`
- `patchElements`

For direct property edits, the assistant should use the actual table property
names. For scoring objects, that property is `score`, not `baseScore`.
For troughs, use `radius`, `holdSeconds`, `reactivateDelay`, `ejectPower`,
and `ejectAngle`. `reactivateDelay` defaults to `2` seconds after ejection.
For flippers, body material fields are `surfaceRestitution` and
`surfaceFriction`; tip-specific fields are `tipRestitution`, `tipFriction`, and
`tipStrikeBoost`.

Presentation lamps can be circular `light` elements, scalable rotated
`arrowLight` elements, or rounded rotated `boxLight` elements. All support
optional `text` plus `lampId` for rule binding. `boxLight` also supports
`cornerRadius`.

For one-way pivoting mechanisms, use `gate` for new tables. `locked` makes a
gate behave as a wall until table logic resets that property. `valve` remains
loadable as a legacy element for older tables, but it is not a first-choice
editor mechanism.

## Storage and sharing

- LocalStorage slots (`pin.tables.<slot>`)
- File export/import (`*.pin.json`)
- URL hash token (`#play&t=<token>`)

## Controls (play mode)

- `Space`: hold to charge, release to launch
- `R`: restart
- `D`: open design mode (`#design`)

On-screen help appears under the playfield while playing. In design mode, a short blurb under the toolbar explains the same.
