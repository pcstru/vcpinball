# TBSpec

This document is a working "skill" for LLMs that need to produce valid pinball table JSON for this application.

It is not a design essay. It is an authoring contract.

If you generate a table, your job is to produce JSON that:

1. loads without schema errors
2. is structurally playable
3. uses only mechanisms the app currently supports
4. uses IDs and rules consistently

Use this spec as the source of truth for table generation.

## Output Contract

When asked to create a table, produce:

- one JSON object
- UTF-8 plain JSON
- no comments
- no trailing commas
- stable element IDs

Default target path convention:

- `tables/<short_name>.json`

## Required Top-Level Shape

Every table should follow this shape:

```json
{
  "version": 1,
  "name": "Table Name",
  "playfield": {
    "width": 500,
    "height": 880,
    "gravity": 0.35,
    "friction": 0.999,
    "restitution": 0.55,
    "maxSpeed": 24
  },
  "rules": {
    "balls": 3,
    "highScoreKey": "someUniqueKey"
  },
  "rulesEngine": {
    "switchMap": [],
    "sequenceRules": [],
    "logicGraphs": [],
    "triggers": [],
    "variables": []
  },
  "levels": [
    { "level": 0, "name": "Playfield", "parentLevel": null, "elevation": 0, "editorVisible": true }
  ],
  "images": [],
  "launcher": {
    "x": 439,
    "y": 710,
    "dir": { "x": 0, "y": -1 },
    "maxPower": 42
  },
  "elements": []
}
```

Notes:

- Keep `version: 1`.
- Keep `rulesEngine.logicGraphs` present even if empty.
- Keep `rulesEngine.triggers` and `rulesEngine.variables` present even if empty.
- Keep `levels` present even if there is only one level.
- Keep `images` present even if empty.
- Keep the legacy top-level `launcher` object present, even though live tuning is driven by the launcher element.

## Minimum Playable Table

A table should include at least:

- `launcher` element
- 2 flippers
- 1 drain
- 1 trough
- enclosing walls or guides that keep the ball on the table

Strong recommendation:

- at least one scoring object (`bumper`, `spinner`, `scoreZone`, or rule-driven objective)
- at least one lane or target objective

## Supported Element Types

Use only these currently supported types unless you have confirmed new runtime support in code:

- `path`
- `ramp`
- `launcher`
- `flipper`
- `spinner`
- `gate`
- `kicker`
- `trough`
- `bumper`
- `dropTarget`
- `lane`
- `scoreZone`
- `drain`
- `light`
- `arrowLight`
- `boxLight`

## Levels

Use `table.levels` to describe structural authoring levels such as the base
playfield, raised rails, or upper playfields.

Rules:

- Each level entry must have a numeric `level`.
- `name` should be human-readable.
- `parentLevel` may be `null` for the root or a numeric parent to form a tree.
- `elevation` should usually track the intended vertical height in table units.
- `editorVisible` is allowed and controls editor visibility only.

Example:

```json
"levels": [
  { "level": 0, "name": "Playfield", "parentLevel": null, "elevation": 0, "editorVisible": true },
  { "level": 1, "name": "Upper Left Rail", "parentLevel": 0, "elevation": 48, "editorVisible": true }
]
```

Elements should usually include a numeric `level` field:

```json
{ "id": "upperGuide", "type": "path", "level": 1, "role": "wall", "anchors": [{ "x": 90, "y": 260 }, { "x": 160, "y": 210 }] }
```

## Element Requirements

### `path`

Used for walls, guides, slingshot-like rails, and curved boundaries.

Typical shape:

```json
{
  "id": "outerWall",
  "type": "path",
  "role": "wall",
  "closed": true,
  "anchors": [
    { "x": 35, "y": 75 },
    { "x": 465, "y": 75 },
    { "x": 470, "y": 200 }
  ]
}
```

Rules:

- Must have `anchors`.
- Use at least 2 anchors.
- Use `closed: true` for enclosing outlines.
- Optional `restitution` overrides table `playfield.restitution` for this wall only.
- Use wall-level `restitution` for dead rubber posts/dampers or extra-live bounce rails.
- For curves, anchors may include:
  - `inHandle: { "x": dx, "y": dy }`
  - `outHandle: { "x": dx, "y": dy }`

### `ramp`

Used for 2.5D travel between levels.

Typical shape:

```json
{
  "id": "leftRamp",
  "type": "ramp",
  "levelFrom": 0,
  "levelTo": 1,
  "zStart": 0,
  "zEnd": 48,
  "leftAnchors": [{ "x": 100, "y": 500 }, { "x": 180, "y": 420 }],
  "rightAnchors": [{ "x": 130, "y": 520 }, { "x": 210, "y": 440 }]
}
```

Rules:

- Must have `leftAnchors` and `rightAnchors`.
- Each side should have at least 2 anchors.
- `levelFrom` and `levelTo` should differ.
- Use upper-playfield colliders with `level: 1` if you want balls to collide only after the ramp exit.

### `launcher`

Typical shape:

```json
{
  "id": "launchLane",
  "type": "launcher",
  "x": 439,
  "top": 195,
  "bottom": 735,
  "width": 38,
  "maxPower": 42,
  "maxRetract": 65,
  "pullSpeed": 95,
  "returnSpeed": 220,
  "springStrength": 1
}
```

Rules:

- Exactly one is recommended.
- `top < bottom`.
- Keep it inside the playfield.
- Prefer the standard right-side lane values unless the layout genuinely differs.

### `flipper`

Left flipper:

```json
{
  "id": "lf",
  "type": "flipper",
  "side": "left",
  "control": "left",
  "pivot": { "x": 135, "y": 685 },
  "length": 95,
  "restAngle": 0.55,
  "activeAngle": -0.55,
  "flipSpeed": 24,
  "returnSpeed": 18,
  "strikeBoost": 0.52,
  "surfaceRestitution": 0.28,
  "surfaceFriction": 0.08,
  "thickness": 10,
  "color": "#00ddff"
}
```

Right flipper:

```json
{
  "id": "rf",
  "type": "flipper",
  "side": "right",
  "control": "right",
  "pivot": { "x": 365, "y": 685 },
  "length": 95,
  "restAngle": 2.5915926535,
  "activeAngle": 3.6915926535,
  "flipSpeed": 24,
  "returnSpeed": 18,
  "strikeBoost": 0.52,
  "surfaceRestitution": 0.28,
  "surfaceFriction": 0.08,
  "thickness": 10,
  "color": "#ff4466"
}
```

Rules:

- Use radians in JSON.
- Provide both left and right flippers for normal tables.
- Start from the known-good defaults above unless intentionally tuning.

### `drain`

Typical shape:

```json
{ "id": "drain1", "type": "drain", "x": 250, "y": 842, "w": 170, "h": 24, "color": "#ff4466" }
```

Rules:

- Place near the bottom.
- Make sure the ball can actually reach it.

### `trough`

Typical shape:

```json
{ "id": "trough1", "type": "trough", "x": 250, "y": 812, "radius": 18, "holdSeconds": 0.75, "reactivateDelay": 2, "ejectPower": 10, "ejectAngle": -1.5707963267948966, "color": "#88aaff", "pitColor": "#08101f" }
```

Rules:

- A trough is a circular saucer/pit activator. It captures a ball, holds it for `holdSeconds`, then kicks it out using `ejectPower` and `ejectAngle`.
- `reactivateDelay` is seconds after ejection before the trough can capture the same ball again. Default is `2`.
- Use a trough for a visible hold-and-release pit. Use `drain` for a bottom out-of-play sensor that removes the ball and serves the next ball.
- `radius` controls both the visual pit and the circular capture sensor.
- `ejectAngle` is radians. `-1.5707963267948966` ejects upward.

### `lane`

Typical shape:

```json
{ "id": "laneA", "type": "lane", "x": 80, "y": 115, "w": 40, "h": 20, "score": 100 }
```

Rules:

- Lanes are sensors, not hard blockers.
- Their `id` is usually the switch ID directly.
- `score` is optional and is awarded on entry.

### `light`, `arrowLight`, `boxLight`

Lights are presentation elements used by rules and logic graphs. They do not
collide with the ball. Both circular lights and arrow lights may show optional
text via `text`; `label` is still loadable for older tables. `boxLight` is a
rounded rectangular presentation lamp with the same logic binding behavior.

Circular light example:

```json
{ "id": "lampLaneA", "type": "light", "x": 80, "y": 145, "radius": 11, "lampId": "lamp_lane_a", "text": "A", "color": "#ffee55" }
```

Arrow light example:

```json
{ "id": "lamp_shoot", "type": "arrowLight", "x": 250, "y": 220, "w": 90, "h": 34, "angle": 0.4, "lampId": "shoot", "text": "SHOOT", "color": "#66ddff" }
```

Box light example:

```json
{ "id": "lamp_bonus", "type": "boxLight", "x": 250, "y": 180, "w": 120, "h": 40, "angle": 0, "cornerRadius": 10, "lampId": "bonus", "text": "BONUS", "color": "#8fe36a" }
```

Rules:

- Use `lampId` when the rules reference a lamp.
- Keep `lampId` stable and unique.
- Use `w`, `h`, and `angle` to scale and rotate arrow lights.
- Use `w`, `h`, `angle`, and `cornerRadius` to scale, rotate, and round box lights.

### `spinner`

Typical shape:

```json
{ "id": "spinner1", "type": "spinner", "x": 250, "y": 210, "length": 60, "score": 100, "color": "#88ccff" }
```

### `scoreZone`

Typical shape:

```json
{ "id": "scoreZone1", "type": "scoreZone", "x": 380, "y": 370, "radius": 22, "score": 1000, "color": "#33ccff" }
```

### `bumper`

Typical shape:

```json
{ "id": "bumper1", "type": "bumper", "x": 160, "y": 280, "radius": 28, "power": 12, "score": 100, "color": "#ff3366" }
```

### `dropTarget`

Typical shape:

```json
{ "id": "dropA", "type": "dropTarget", "x": 120, "y": 500, "w": 14, "h": 40, "score": 250, "color": "#ffcc00" }
```

Note:

- Treat drop targets as valid switch-producing mechanisms by ID.

### `gate`, `kicker`

Use these only when needed and only in patterns already present in the codebase or existing tables.

If unsure, omit them rather than inventing fields.

If you use a `kicker`, it may also carry an optional `score` property.
`kicker` supports either:

- a legacy single-post form: `x`, `y`, `radius`
- a composite post-ring form: `anchors` with 1-3 posts, shared `radius`, and `bandThickness`

Each kicker anchor may also override the shared radius:

```json
{ "x": 240, "y": 260, "radius": 16 }
```

Composite kicker example:

```json
{
  "id": "kickerTri",
  "type": "kicker",
  "radius": 14,
  "bandThickness": 6,
  "kickPower": 14,
  "restitution": 0.55,
  "score": 150,
  "closed": true,
  "anchors": [
    { "x": 240, "y": 260, "radius": 16 },
    { "x": 290, "y": 240, "radius": 14 },
    { "x": 300, "y": 295, "radius": 18 }
  ]
}
```

Use `gate` for pivoted one-way gate behavior. Prefer explicit swing arc fields:

```json
{ "id": "gate1", "type": "gate", "x": 230, "y": 360, "length": 64, "angle": -0.2, "swingStartAngle": -0.2, "swingEndAngle": 0.85 }
```

`angle` is the rest angle. `swingStartAngle` and `swingEndAngle` are absolute angular limits in radians, and the rest angle must lie inside that arc. Use an arc with one limit equal to `angle` when the gate should only open one way. `locked: true` makes the gate act as a wall and prevents hinge swing; rules can set or reset this at runtime with property actions. `maxAngle`, `direction`, and `twoWay` are legacy fields; avoid them for new gates.

`valve` is a legacy alias retained for older tables. Do not generate new `valve` elements.

## Rules Engine Contract

### `switchMap`

Use this when a mechanism event should map to a different game-logic switch name.

Example:

```json
[
  { "eventType": "switchClosed", "sourceId": "leftOrbitSensor", "switchId": "orbit-left" }
]
```

Rules:

- `sourceId` should refer to an existing element ID.
- `switchId` should be stable and unique within the rule set.
- Avoid duplicate mappings unless deliberately mirroring behavior.

### `sequenceRules`

Use this for timed sequence objectives.

Example:

```json
[
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
    "conditions": [
      { "source": "variable", "variableId": "mode_ready", "property": "value", "operator": "truthy" }
    ],
    "actions": [
      { "actionType": "setElementScore", "targetId": "scoreZone1", "value": 5000 },
      { "actionType": "setElementProperty", "targetId": "gate1", "property": "locked", "value": true },
      { "actionType": "toggleVariableProperty", "variableId": "flash", "property": "value" },
      { "actionType": "setLampFromVariable", "lampId": "lamp_flash", "variableId": "flash", "property": "value" }
    ],
    "resetOnDrain": true,
    "resetOnComplete": true,
    "resetOnWrongOrder": false
  }
]
```

Rules:

- `id` must be unique.
- `steps` must not be empty.
- Each `steps[]` entry should resolve to:
  - an element ID that emits switch events directly, or
  - a `switchId` defined in `switchMap`
  - a `switchId` emitted by `rulesEngine.triggers`
- `targetSwitchId` should resolve the same way.
- `stepLampIds` should align in order with `steps`.
- `windowSeconds` should be greater than `0`.
- `actions` is optional.
- `conditions` is optional. Supported operators are `eq`, `ne`, `gt`, `gte`, `lt`, `lte`, `truthy`, and `falsy`.
- Conditions should be simple gates over variables, element scores/properties, world score, or constants. Prefer variables for mode state.
- Supported action types are:
  - `setElementScore`
  - `addElementScore`
  - `resetElementScore`
  - `setElementProperty`
  - `resetElementProperty`
  - `setVariableProperty`
  - `addVariableProperty`
  - `toggleVariableProperty`
  - `resetVariableProperty`
  - `setLamp`
  - `clearLamp`
  - `setLampFromVariable`
- Score actions should target an existing score-producing element ID.
- Property actions should target an existing element ID and include `property`. Use them sparingly for gameplay state such as locking a gate after a sequence completes.
- Variable actions should reference a variable from `rulesEngine.variables`; variables are runtime-only and invisible on the table.
- Lamp actions should reference a `lampId` from a `light`, `arrowLight`, or `boxLight`.

### `triggers`

Use this for timer/tick sources that should behave like normal switches.

Example:

```json
[
  { "id": "flash_timer", "type": "interval", "everySeconds": 0.5, "switchId": "tick.flash", "enabled": true },
  { "id": "tick_timer", "type": "interval", "everyTicks": 30, "switchId": "tick.thirty", "enabled": true }
]
```

Rules:

- `type` should be `"interval"`.
- Provide `everySeconds` or `everyTicks` greater than `0`.
- `switchId` is the game-logic switch emitted by the trigger and may be used in sequence `steps`.
- `id` should be stable and unique.
- Timers do not replace sequence rules; they feed sequence rules.

### `variables`

Use this for named runtime logic state.

Example:

```json
[
  { "id": "flash", "name": "Flash", "properties": { "value": false } },
  { "id": "mode_ready", "name": "Mode Ready", "properties": { "value": false } }
]
```

Rules:

- Provide an `id`, `name`, or both. Prefer a stable `id`.
- Variables are not physical elements and are not rendered.
- Variables reset from these defaults when a new world/table is loaded.
- Prefer a simple `properties.value` field unless another property name is clearly needed.

### `logicGraphs`

Current rule:

- include it
- keep it as `[]` unless you intentionally generate graph-based editor content

For broad compatibility, `sequenceRules` should still be considered the canonical gameplay definition for generated tables.

## Images Contract

Optional.

Example:

```json
[
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

Rules:

- `mode`: `play`, `design`, or `both`
- `fit`: `contain`, `cover`, `stretch`, or `none`
- `src` should point to an asset that exists relative to the app root

## ID Rules

All element IDs must be unique.

Recommended naming:

- flippers: `lf`, `rf`
- launcher: `launchLane`
- drain: `drain1`
- trough: `trough1`
- lanes: `laneA`, `laneB`, `laneC`
- lamps: `lampXxx`
- score zones: `scoreZone1`
- bumpers: `bumper1`, `bumper2`
- drop targets: `dropA`, `dropB`, ...

Rules:

- Do not reuse IDs across element types.
- Keep IDs short, readable, and stable.

## Playability Rules for LLMs

Before finalizing a table, enforce these:

1. There is a visible launch lane.
2. The ball has an enclosed upper boundary and side walls.
3. Two flippers are present near the bottom.
4. The drain sits below the flippers.
5. The trough exists.
6. No critical element is placed outside the playfield.
7. Sequence rules reference valid switches and lamps.
8. If using ramps, both sides have enough anchors and levels change.

## Good Defaults

Use these unless you have a reason not to:

- playfield:
  - `width: 500`
  - `height: 880`
  - `gravity: 0.35`
  - `friction: 0.999`
  - `restitution: 0.55`
  - `maxSpeed: 24`
- balls:
  - `rules.balls: 3`
- launcher:
  - `x: 439`
  - `top: 195`
  - `bottom: 735`
  - `width: 38`
  - `maxPower: 42`
  - `maxRetract: 65`
  - `pullSpeed: 95`
  - `returnSpeed: 220`
  - `springStrength: 1`
- flippers:
  - use the values shown above verbatim

## Recommended Generation Pattern

When generating a table:

1. Start with the required top-level structure.
2. Add outer walls as a `path`.
3. Add launcher, flippers, drain, trough.
4. Add 3-8 scoring or objective elements.
5. Add lanes or targets for at least one simple sequence.
6. Add lights for any lit objective.
7. Add `rulesEngine.sequenceRules`.
8. Add optional `rulesEngine.variables`, `rulesEngine.triggers`, and rule `conditions` when table logic needs state or timers.
9. Add optional image layers.
10. Re-check ID consistency and playability.

## Safe Authoring Limits

To keep generated tables reliable:

- Prefer 10-30 elements total.
- Prefer 0-2 ramps.
- Prefer 1-3 sequence rules.
- Prefer simple wall geometry over dense decorative geometry.
- Avoid extremely tight gaps near the flippers or launcher.

## Things Not to Invent

Do not invent:

- unsupported element types
- custom physics fields not already used by the runtime
- arbitrary rule-engine schemas beyond `switchMap`, `sequenceRules`, `logicGraphs`, `triggers`, and `variables`
- SVG or image references that do not exist

If unsure, use a simpler supported mechanism.

## Example: Minimal Valid Table Skeleton

```json
{
  "version": 1,
  "name": "Starter Table",
  "playfield": { "width": 500, "height": 880, "gravity": 0.35, "friction": 0.999, "restitution": 0.55, "maxSpeed": 24 },
  "rules": { "balls": 3, "highScoreKey": "starterHighScore" },
  "rulesEngine": {
    "switchMap": [],
    "sequenceRules": [
      {
        "id": "abc",
        "name": "ABC",
        "enabled": true,
        "ordered": true,
        "steps": ["laneA", "laneB", "laneC"],
        "targetSwitchId": "scoreZone1",
        "stepLampIds": ["lamp_lane_a", "lamp_lane_b", "lamp_lane_c"],
        "targetLampId": "lamp_bonus_target",
        "windowSeconds": 8,
        "awardPoints": 2500,
        "awardEvent": "abcAwarded",
        "resetOnDrain": true,
        "resetOnComplete": true,
        "resetOnWrongOrder": false
      }
    ],
    "logicGraphs": [],
    "triggers": [],
    "variables": []
  },
  "images": [],
  "launcher": { "x": 439, "y": 710, "dir": { "x": 0, "y": -1 }, "maxPower": 42 },
  "elements": [
    { "id": "outerWall", "type": "path", "role": "wall", "closed": true, "anchors": [{ "x": 35, "y": 75 }, { "x": 465, "y": 75 }, { "x": 470, "y": 700 }, { "x": 30, "y": 700 }] },
    { "id": "launchLane", "type": "launcher", "x": 439, "top": 195, "bottom": 735, "width": 38, "maxPower": 42, "maxRetract": 65, "pullSpeed": 95, "returnSpeed": 220, "springStrength": 1 },
    { "id": "lf", "type": "flipper", "side": "left", "control": "left", "pivot": { "x": 135, "y": 685 }, "length": 95, "restAngle": 0.55, "activeAngle": -0.55, "flipSpeed": 24, "returnSpeed": 18, "strikeBoost": 0.52, "surfaceRestitution": 0.28, "surfaceFriction": 0.08, "thickness": 10, "color": "#00ddff" },
    { "id": "rf", "type": "flipper", "side": "right", "control": "right", "pivot": { "x": 365, "y": 685 }, "length": 95, "restAngle": 2.5915926535, "activeAngle": 3.6915926535, "flipSpeed": 24, "returnSpeed": 18, "strikeBoost": 0.52, "surfaceRestitution": 0.28, "surfaceFriction": 0.08, "thickness": 10, "color": "#ff4466" },
    { "id": "drain1", "type": "drain", "x": 250, "y": 842, "w": 170, "h": 24, "color": "#ff4466" },
    { "id": "trough1", "type": "trough", "x": 250, "y": 812, "radius": 18, "holdSeconds": 0.75, "reactivateDelay": 2, "ejectPower": 10, "ejectAngle": -1.5707963267948966, "color": "#88aaff", "pitColor": "#08101f" },
    { "id": "laneA", "type": "lane", "x": 80, "y": 115, "w": 40, "h": 20 },
    { "id": "laneB", "type": "lane", "x": 155, "y": 115, "w": 40, "h": 20 },
    { "id": "laneC", "type": "lane", "x": 230, "y": 115, "w": 40, "h": 20 },
    { "id": "scoreZone1", "type": "scoreZone", "x": 380, "y": 370, "radius": 22, "score": 1000, "color": "#33ccff" },
    { "id": "lampLaneA", "type": "light", "x": 80, "y": 145, "radius": 11, "lampId": "lamp_lane_a", "label": "A", "color": "#ffee55" },
    { "id": "lampLaneB", "type": "light", "x": 155, "y": 145, "radius": 11, "lampId": "lamp_lane_b", "label": "B", "color": "#ffee55" },
    { "id": "lampLaneC", "type": "light", "x": 230, "y": 145, "radius": 11, "lampId": "lamp_lane_c", "label": "C", "color": "#ffee55" },
    { "id": "lampBonusTarget", "type": "light", "x": 380, "y": 405, "radius": 13, "lampId": "lamp_bonus_target", "label": "BON", "color": "#33ccff" }
  ]
}
```

## Final Rule

Prefer a simpler valid table over a richer invalid one.
