# Lessons from VisualPinball.Engine

Reference inspected: a local checkout of `VisualPinball.Engine`.

This is not a proposal to clone Visual Pinball Engine. It is a set of practical lessons for our browser pinball project, especially around precision mechanics, ramps/levels, editor architecture, and feature growth.

## Highest-Value Lessons

### 1. Move From Overlap Correction Toward Time-of-Impact Physics

VisualPinball.Engine does not just move the ball and then resolve overlaps. Its physics cycle searches for the next collision time inside the current physics step, advances to that exact time, resolves the collision, then repeats until the step is consumed.

Relevant reference:
- `VisualPinball.Unity/VisualPinball.Unity/Game/PhysicsCycle.cs`
- `VisualPinball.Unity/VisualPinball.Unity/Physics/README.md`

For us:
- Keep the fixed timestep we added, but introduce a narrow-phase API that can return `hitTime` in `[0, dt]`.
- Start with line/circle colliders and flippers.
- Use overlap correction only as fallback/contact handling, not as the primary collision model.

Immediate improvement target:
- Implement swept circle vs segment.
- Implement swept circle vs circle.
- Let `stepWorld()` find earliest collision per substep, resolve, then consume remaining time.

### 2. Treat Flippers as First-Class Physics Mechanisms

VisualPinball.Engine has a dedicated `FlipperCollider`, `FlipperMovementState`, `FlipperVelocityPhysics`, `FlipperStaticData`, `FlipperVelocityData`, and `FlipperTricksData`. Flippers are not ordinary line segments with an impulse. They are rotating bodies with:
- angular position
- angular velocity
- torque
- inertia
- start/end limits
- end-of-stroke damping
- return strength
- contact behavior
- live catch heuristics

Relevant reference:
- `VisualPinball.Unity/VisualPinball.Unity/VPT/Flipper/FlipperCollider.cs`
- `VisualPinball.Unity/VisualPinball.Unity/VPT/Flipper/FlipperVelocityPhysics.cs`
- `VisualPinball.Unity/VisualPinball.Unity/VPT/Flipper/FlipperStaticData.cs`
- `VisualPinball.Unity/VisualPinball.Unity/VPT/Flipper/FlipperTricksData.cs`

For us:
- Replace our simple active/rest angle switch with a persistent flipper state:
  - `angle`
  - `angularVelocity`
  - `targetAngle`
  - `strength`
  - `returnStrength`
  - `inertia`
  - `eosDamping`
- Compute ball response from relative velocity at the flipper contact point.
- Keep editor controls simple, but map them to these richer fields.

Immediate improvement target:
- Add `world.elementState["flipper:<id>"]` as the source of truth for angle/velocity.
- Compile flipper collider from current state, not directly from input.
- Use relative contact velocity: ball velocity minus flipper surface velocity.

### 3. Separate Colliders, Visuals, Runtime State, and Device Logic

VisualPinball.Engine has clear separations:
- item data: imported/saved table configuration
- visual mesh components
- collider components/generators
- runtime movement state
- API/device components for switches/coils
- packable references for serialization

Relevant reference:
- `VisualPinball.Engine/VisualPinball.Engine/VPT/Table/TableContainer.cs`
- `VisualPinball.Unity/VisualPinball.Unity/VPT/CollidableApi.cs`
- `VisualPinball.Unity/VisualPinball.Unity/Mappings/SwitchMapping.cs`

For us:
- Stop treating each element as one object that owns schema, editor UI, rendering, collision, and gameplay all together.
- Introduce a compile output with named channels:
  - `staticColliders`
  - `dynamicColliders`
  - `sensors`
  - `drawables`
  - `devices`
  - `runtimeState`
- Keep table JSON declarative. Put transient state in `world.elementState`.

Immediate improvement target:
- Split `compileElements()` into static table compilation and per-frame dynamic compilation.
- Static paths/rubbers/walls should not rebuild every frame.
- Flippers, gates, spinners, plunger, balls should be dynamic.

### 4. Add Broad Phase Before More Feature Work

VisualPinball.Engine uses spatial acceleration structures to discard most colliders before narrow-phase tests. Static colliders are indexed once. Dynamic ball-ball collision uses a rebuilt broad phase each physics cycle.

Relevant reference:
- `VisualPinball.Unity/VisualPinball.Unity/Physics/README.md`
- `VisualPinball.Unity/VisualPinball.Unity/Game/PhysicsCycle.cs`
- `VisualPinball.Unity/VisualPinball.Unity/Physics/NativeColliders.cs`

For us:
- Add cheap broad phase before adding many more components.
- A uniform grid is enough for canvas pinball.
- Precompute AABBs for static colliders.
- Query only nearby colliders for each ball.

Immediate improvement target:
- Add `runtime.staticIndex`.
- Use collider AABBs inflated by ball radius and max travel.
- Query index in physics instead of iterating every segment/circle.

### 5. Ramps Need Floor Surfaces, Walls, and Edge Joints

VisualPinball.Engine ramps are generated as actual 3D floor triangles plus wall line colliders and edge/joint colliders. It does not model ramps as two rails with a state flag.

Relevant reference:
- `VisualPinball.Unity/VisualPinball.Unity/VPT/Ramp/RampColliderGenerator.cs`

For us:
- Our 2.5D ramp model is a useful bridge, but it should evolve.
- Represent ramp floor as a surface strip, not only an outline.
- Add entry and exit edge colliders.
- Add rail/wall height.
- Add underside/overpass semantics.
- Use `z` and `level` as collision filters, but derive them from ramp surface progress.

Immediate improvement target:
- Compile each ramp into:
  - `rampSurface` with progress/z interpolation
  - `leftWall` and `rightWall`
  - `entryEdge` and `exitEdge`
  - `underpassClearance`

### 6. Spinners and Gates Are Rotating Dynamic Objects, Not Passive Lines

VisualPinball.Engine models spinners and gates as two line colliders with movement state. Hits set angular speed based on impact direction and position. Gates can be one-way or two-way and have bounce-back behavior.

Relevant reference:
- `VisualPinball.Unity/VisualPinball.Unity/VPT/Spinner/SpinnerCollider.cs`
- `VisualPinball.Unity/VisualPinball.Unity/VPT/Gate/GateCollider.cs`

For us:
- Spinner should track angle and angular velocity in runtime state.
- Gate should track angle, angular velocity, damping, limit, and one-way behavior.
- Collision should affect the mechanism, then the mechanism animation follows state.

Immediate improvement target:
- Convert spinner from score pulse plus visual spin to a real rotating sensor:
  - `angle`
  - `angularVelocity`
  - `damping`
  - `scorePerSpin`
- Convert gate to dynamic one-way/two-way plate:
  - `angle`
  - `restAngle`
  - `maxAngle`
  - `returnDamping`
  - `twoWay`

### 7. Plunger/Launcher Should Be a Spring Mechanism

VisualPinball.Engine distinguishes manual plunger, auto plunger, analog position, release detection, spring movement, sync to physical plunger, and launch button semantics.

Relevant reference:
- `VisualPinball.Unity/VisualPinball.Unity/VPT/Plunger/PlungerVelocityPhysics.cs`
- `VisualPinball.Unity/VisualPinball.Unity/VPT/Plunger/PlungerComponent.cs`

For us:
- The launcher should not just set ball velocity on key release.
- It should have plunger state:
  - `position`
  - `velocity`
  - `pullForce`
  - `springStrength`
  - `restPosition`
  - `maxRetract`
  - `autoFire`
- The ball should be physically constrained in the lane and hit by the plunger tip.

Immediate improvement target:
- Add a `plunger` runtime state.
- Render plunger from state.
- Launch ball by moving plunger tip, not directly assigning ball velocity.

### 8. Add Devices: Switches, Coils, Lamps, and Events

VisualPinball.Engine treats table mechanisms as devices with available switch/coil/lamp endpoints. A trough exposes switches/coils; mappings connect game logic to physical mechanisms.

Relevant reference:
- `VisualPinball.Unity/VisualPinball.Unity/VPT/Trough/TroughComponent.cs`
- `VisualPinball.Unity/VisualPinball.Unity/Mappings/SwitchMapping.cs`

For us:
- This would make the game richer and cleaner than direct `world.score += ...` in collision callbacks.
- Elements should emit events:
  - `switchClosed`
  - `switchOpened`
  - `coilFired`
  - `score`
  - `ballEntered`
  - `ballExited`
- Rules should listen to events.

Immediate improvement target:
- Add `world.events` queue.
- Replace direct scoring in bumpers/spinners/score zones with emitted events.
- Add a small rules engine that consumes events and updates score/state.

### 9. Ball Management Needs Troughs, Kickers, Drains, and Locks

VisualPinball.Engine has a non-rendered trough component that models ball count, switches, roll timing, jam switch, entry switch, and eject coil.

Relevant reference:
- `VisualPinball.Unity/VisualPinball.Unity/VPT/Trough/TroughComponent.cs`
- `VisualPinball.Unity/VisualPinball.Unity.Test/VPT/TroughTests.cs`

For us:
- Current ball lifecycle is too simple: if `y > height`, delete and respawn.
- Add explicit drain sensor, trough, shooter lane, kicker, locks, and multiball source.

Immediate improvement target:
- Add `drain` sensor element.
- Add `trough` logical element.
- Add `kicker`/`eject` behavior for serving balls.
- Move ball count/lifecycle out of `main.js`.

### 10. Tests Should Validate Data Round Trips and Mechanism Contracts

VisualPinball.Engine has tests for table item data, import/export round-trips, and mechanism contracts like trough switch/coil counts.

Relevant reference:
- `VisualPinball.Unity/VisualPinball.Unity.Test/VPT/FlipperTests.cs`
- `VisualPinball.Unity/VisualPinball.Unity.Test/VPT/RampTests.cs`
- `VisualPinball.Unity/VisualPinball.Unity.Test/VPT/TroughTests.cs`

For us:
- We need small deterministic JS tests before more physics tuning.
- Browser canvas is not the test target; compiled runtime data and physics functions are.

Immediate improvement target:
- Add test fixtures for:
  - flipper hit consistency
  - fast ball vs wall
  - spinner hit event
  - launcher serve
  - ramp entry/exit
  - save/load round trip

### 11. Add Rule State Machines, Modes, and Timed Awards

VisualPinball.Engine separates playfield mechanisms from the game-logic layer through declared switches, coils, lamps, wires, and mappings. A physical device emits switch state; mappings connect those switch IDs to game logic; lamps/coils are addressed by IDs rather than by direct element mutation. This is the missing layer for rules like "roll through gates A, B, and C, then hit target X within 8 seconds for a bonus."

Relevant reference:
- `VisualPinball.Engine/VisualPinball.Engine/Game/Engines/GamelogicEngineSwitch.cs`
- `VisualPinball.Engine/VisualPinball.Engine/Game/Engines/GamelogicEngineCoil.cs`
- `VisualPinball.Engine/VisualPinball.Engine/Game/Engines/GamelogicEngineLamp.cs`
- `VisualPinball.Engine/VisualPinball.Engine/Game/Engines/GamelogicEngineWire.cs`
- `VisualPinball.Unity/VisualPinball.Unity/Mappings/SwitchMapping.cs`
- `VisualPinball.Unity/VisualPinball.Unity/Mappings/WireMapping.cs`
- `VisualPinball.Engine/VisualPinball.Engine/Game/EventId.cs`

For us:
- Keep mechanisms dumb: they emit `switchClosed`, `switchOpened`, `targetHit`, `spinnerSpin`, `gateOpened`, `ballDrained`, and similar events.
- Add a rules/state-machine layer that consumes events and owns transient gameplay state:
  - mode progress
  - lit shots
  - timed opportunities
  - combo chains
  - bonus qualification
  - multiplier state
  - per-ball and per-game resets
- Add a clock/timer scheduler tied to fixed physics ticks, not wall-clock animation frames.
- Add lamps/inserts as rule-driven outputs so the table can show which gates/targets are lit, completed, or expiring.
- Make table JSON declarative: rules should describe sequences, timers, awards, lamps, and reset behavior without hard-coding element IDs inside physics callbacks.

Immediate improvement target:
- Add `world.rules` state and a deterministic `Pin.rules.process(world, dt)` pass after event collection.
- Add a generic sequence rule:
  - `steps`: ordered switch/event IDs
  - `windowSeconds`: optional time limit after sequence completion
  - `awardEvent`: emitted when the final shot is made in time
  - `resetOnDrain`, `resetOnComplete`, `perBall`
- Add a timed bonus rule for the concrete case:
  - gates A/B/C must be completed in order
  - bonus target lights for N seconds
  - hitting the target emits a score/award event and clears the mode
- Add deterministic tests for sequence progress, wrong-order events, timer expiry, drain reset, and successful bonus collection.

## Component Ideas Worth Adding

### Core Playfield Components

- `rubber`: curved or path-based bouncy surface, distinct from hard wall.
- `surface`: closed polygon with optional slingshot edges.
- `metalWireGuide`: wire guide with narrow collision and distinct visual.
- `trigger`: invisible or visible sensor, no hard collision.
- `drain`: sensor that routes ball into trough.
- `trough`: logical ball store with serve/eject.
- `ballLock`: captures and releases balls.
- `teleporter`: optional arcade-style mechanism for moving balls.

### Mechanical Components

- `gate`: one-way/two-way rotating plate.
- `spinner`: rotating switch with score-per-spin.
- `dropTargetBank`: group behavior for drop targets, reset coil, completion event.
- `slingshot`: explicit triangular component instead of path role.
- `plunger`: spring-loaded launcher.
- `kicker`: capture, hold, aim, eject.

### Presentation Components

- `light`: rule-controlled inserts.
- `flasher`: brief high-intensity visual.
- `display`: score/reel/DMD style UI surface.
- `sound`: per-event audio mapping.

### Rule Components

- `switchMap`: declarative mapping from element/sensor events to switch IDs.
- `lampMap`: declarative mapping from rule/lamp IDs to light elements.
- `sequenceRule`: ordered or unordered switch/event completion logic.
- `timedShotRule`: lights an award shot for a limited window.
- `modeRule`: state machine for multistep modes, wizard progress, hurry-ups, and jackpot qualification.
- `award`: score, multiplier, extra ball, lock, multiball, lamp, sound, or custom event output.
- `ruleTimer`: deterministic countdown driven by fixed physics ticks.

## Architecture Roadmap for This Project

Status key:
- `[ ]` not started
- `[~]` in progress
- `[x]` completed

### Phase 1: Physics Stabilization

1. `[x]` Implement swept circle collision for segment/circle.
2. `[x]` Change `stepWorld()` to consume substep time by earliest hit.
3. `[x]` Add AABB broad phase.
4. `[x]` Make flippers persistent dynamic mechanisms.
5. `[x]` Add deterministic physics tests.

### Phase 2: Runtime Model Cleanup

1. `[x]` Split static compilation from dynamic compilation.
2. `[x]` Add `world.events`.
3. `[x]` Move scoring/rules out of element collision callbacks.
4. `[x]` Add per-element runtime state contracts.
5. `[x]` Add explicit sensors.

### Phase 3: Real Mechanisms

1. `[x]` Plunger as spring mechanism.
2. `[x]` Spinner as angular mechanism.
3. `[x]` Gate as angular mechanism.
4. `[ ]` Drop target banks.
5. `[x]` Trough/drain/serve flow.

### Phase 4: Rule State, Modes, and Bonuses

1. `[x]` Add `Pin.rules` deterministic rules engine.
2. `[~]` Add `world.ruleState` with per-ball/per-game reset scopes.
3. `[x]` Add declarative switch/event mapping for rules.
4. `[x]` Add sequence rule support: ordered/unordered steps, wrong-order handling, completion events.
5. `[x]` Add timed shot/bonus windows.
6. `[x]` Add lamp/light output state for lit shots and countdown feedback.
7. `[x]` Add a sample rule: pass gates A/B/C, then hit bonus target within N seconds.
8. `[x]` Add deterministic rule tests for sequence progress, expiry, drain reset, and award collection.

### Phase 5: Levels and Ramps

1. `[~]` Replace ramp rails-only model with ramp surface strips.
2. `[ ]` Add ramp floor/wall/edge collision outputs.
3. `[ ]` Add underpass/overpass clearance.
4. `[ ]` Add editor elevation tools.
5. `[ ]` Sort rendering by level/z and draw shadows/occlusion cues.

### Phase 6: Editor Upgrade

1. `[~]` Tool-specific inspectors instead of raw object dumps.
2. `[~]` Visual handles for mechanism-specific properties.
3. `[x]` Palette components grouped by role.
4. `[ ]` Layer/level filtering.
5. `[x]` Validation panel: missing trough, no drain, unreachable launcher, invalid ramp exits.
6. `[~]` Rule editor panel for sequences, timed shots, awards, and lamp mappings.
7. `[x]` Rule validation panel: missing switch IDs, duplicate switch mappings, unreachable bonus target, unbound lamp outputs.
8. `[~]` Logic graph tab for visual rule/state-machine authoring with table-object context.

## Current Implementation Log

- 2026-04-26: Started tracking roadmap status in this file.
- 2026-04-26: Phase 1/2 current focus is static/dynamic runtime compilation plus static broad phase.
- 2026-04-26: Added static/dynamic runtime compilation split. Static colliders are now compiled once at world creation; dynamic mechanisms compile each physics tick.
- 2026-04-26: Added a static AABB grid broad phase and wired ball collision resolution to query nearby static colliders while still checking dynamic colliders directly.
- 2026-04-26: Added swept circle-vs-segment and circle-vs-circle pre-pass for ball movement. `stepWorld()` now moves through `moveBallWithSweeps()` before overlap/contact fallback, reducing tunneling through thin walls and targets.
- 2026-04-26: Converted flippers to persistent runtime mechanisms. Flipper angle and angular velocity now live in `world.elementState`, advance over fixed physics ticks with editable flip/return speeds, compile swept intermediate colliders instead of snapping directly from rest to active angle, and apply contact response from relative surface velocity.
- 2026-04-26: Added `tests/physics.test.js` as a deterministic Node smoke suite for swept wall collision, flipper runtime/contact behavior, and the static/dynamic compile split.
- 2026-04-26: Changed swept ball movement to consume explicit remaining substep time after each time-of-impact collision. Added a close-wall ricochet test to prove post-bounce remaining time is still simulated inside the same physics step.
- 2026-04-26: Added `app/events.js` with `world.events`, `Pin.events.emit()`, and `Pin.events.processRules()`. Score zones and spinners now emit score/switch events when the event service is loaded, and play mode drains the rules queue each fixed physics tick.
- 2026-04-26: Fixed a flipper swallowing case by marking intermediate flipper sweep positions as `sweepOnly`. Swept movement can still see them, but overlap/contact fallback now resolves only against the current physical blade. Added a regression test that keeps a ball from being pushed by a stale flipper position.
- 2026-04-26: Removed direct score writes from score-zone and spinner collision callbacks. These elements now emit `score` events only; `Pin.events.processRules()` is the single path that mutates `world.score`.
- 2026-04-26: Added element runtime-state helpers: `Pin.elements.getStateKey()`, `getState()`, and `peekState()`. Flippers and spinners now use namespaced state contracts, with legacy spinner state migrated from bare element ids.
- 2026-04-27: Added explicit sensor runtime support. Compiled runtimes now carry `sensors`, physics tracks sensor enter/exit state per ball, emits `switchClosed`/`switchOpened` events, and lane elements now compile as non-blocking rectangular sensors instead of hard circle colliders.
- 2026-04-27: Converted spinner animation into a runtime angular mechanism. Spinner angle/angular velocity now live in namespaced element state, compile advances/damps rotation on fixed ticks, hits add angular velocity, and draw no longer mutates mechanism state.
- 2026-04-27: Converted gates into runtime angular mechanisms. Gates now store angle/angular velocity in namespaced state, damp back toward rest during compile, support one-way pass/block behavior and two-way pass-through behavior, and emit gate-open/block events.
- 2026-04-30: Consolidated gate/valve authoring around `gate`. New gates use the pivot/length/angle rotating behavior previously represented by `valve`; `valve` remains loadable as a legacy alias but should not be used for new table designs.
- 2026-04-27: Fixed another flipper ball-eating path. Flipper colliders now provide a playable-side `resolveNormal`, so overlap correction separates balls upward/outward from the blade instead of using a generic closest-point normal that could push balls under the flipper. Added a regression test and ran a sampled flipper-trap model across both flippers.
- 2026-04-27: Converted launcher serve flow to persistent plunger state. Launcher elements now track charge/retract/release state, play mode calls `Pin.physics.releaseLauncher()`, and physics serves launch-lane balls from plunger state while emitting `plungerReleased`.
- 2026-04-27: Added explicit drain/trough serve flow. Drain is now a non-blocking sensor element, trough is a logical table element, and `Pin.ballLifecycle` owns drained-ball removal, next-ball serving, and game-over transitions instead of ad hoc filtering in `main.js`.
- 2026-04-27: Added a roadmap phase for rule state machines, timed bonuses, modes, switch/lamp mappings, and deterministic rule tests. This fills the gap between mechanism events and table objectives such as "complete gates A/B/C, then hit a target within N seconds."
- 2026-04-27: Started state mechanics with `Pin.rules`, declarative switch mappings, ordered/unordered sequence rules, timed bonus windows, and deterministic rule tests. Added a Rules editor tab with CRUD/navigation for sequence rules and switch mappings.
- 2026-04-27: Added rule-driven lamp outputs. Sequence rules can now light step lamps, target lamps, and countdown state through `world.lampState`; the editor can create `light` inserts and wire `stepLampIds`/`targetLampId`.
- 2026-04-27: Wired a concrete Cyberpin sample rule: complete lanes A/B/C in order, then hit the bonus target within 8 seconds for 2500 points. Added matching insert lamps so the rule is visible in play and editable in the rule panel.
- 2026-04-27: Added rule validation as a reusable `Pin.rules.validate()` helper and surfaced it in the editor Rules tab. It now flags missing switch/lamp references, duplicate rule IDs, duplicate switch mappings, empty rules, and invalid target windows.
- 2026-04-27: Improved rule editing UX with dropdown/picker controls for known element, switch, and lamp IDs. New switch mappings now prefill from an existing mechanism when possible, and README documents the rules/switch/lamp model.
- 2026-04-27: Improved ordered sequence editing with up/down/remove token controls and a step-to-lamp preview, so timed bonus rules can be authored without raw comma editing.
- 2026-04-27: Added table playability validation via `Pin.table.validatePlayability()` and surfaced it in the Table tab. It now catches missing launcher/drain/trough/flippers, duplicate element IDs, invalid launcher geometry, and suspect ramp setup.
- 2026-04-27: Added `app/ruleGraph.js` and upgraded the Logic tab into a real graph authoring layer. The editor now keeps `rulesEngine.logicGraphs` as the editable model, compiles sequence-shaped paths into `sequenceRules` for runtime, preserves custom nodes/edges, and lets designers select graph nodes against table objects or light inserts.
- 2026-04-27: Retuned flipper collision response to be less spring-like. Normal bounce and driven lift are now softer, default flipper impulse/damping values were lowered, and a regression checks that a moving flipper still lifts the ball without firing it like a trampoline.
- 2026-04-30: Replaced the most opaque flipper contact knobs with a smaller material-style model. Passive and active flipper contact now resolve from relative normal/tangential velocity plus `surfaceRestitution`, `surfaceFriction`, and a small `strikeBoost`, and the physics lab uses those exact same runtime parameters rather than a separate sandbox-only contact model.
- 2026-04-27: Extended the Logic tab with node-detail assignment. A designer can select a graph step/target/lamp node, select a table object or light, and bind that object back into the sequence rule without editing raw IDs.
- 2026-04-27: Made the Logic tab visibly functional for new rules. `Add Sequence` now lands in the graph editor with a starter node chain and unassigned placeholder target/lamp nodes; graph cards can add sequence steps directly.
- 2026-04-27: Added a draggable splitter for the right inspector/Logic panel, with persisted width, so graph authoring is not constrained to the default narrow sidebar.
- 2026-04-27: Added `tables/logic_demo.json` as a loadable example table with two sequence rules: an ordered lane bonus and an unordered drop-bank bonus, each with lamps and a timed target.
- 2026-04-27: Added table image layers so a PNG can render as play background art and/or as a design-only layout overlay. Wired the editor Table tab to add, edit, reorder, and remove image layers, and added the example table image to `logic_demo.json`.
- 2026-04-27: Reduced editor redraw cost. Continuous drag/pan/resize now throttles full table-layer recompiles to a steadier cadence instead of recompiling on every mousemove, and path/ramp drawing now reuses compiled geometry instead of tessellating again during draw.
- 2026-04-28: Removed a launcher source-of-truth conflict in the editor. The Table tab no longer edits duplicate launcher fields, launcher legacy sync no longer runs on every refresh, and generic refresh no longer mutates the table model. Also reduced persistent editor churn by caching palette renders, autosaving only after actual edits, and stopping the canvas from redrawing continuously just because an element is selected.
- 2026-04-28: Started decomposing the editor monolith. Extracted table/image/element mutation paths into `app/editor/actions.js` behind `Pin.editorActions`, so `editor.js` no longer owns every mutation body directly and the refresh policy can be tightened around a narrower action boundary.
- 2026-04-28: Extracted editor session transitions into `app/editor/session.js`. Table application, selection clearing, element/rule/logic-node selection, validation focus, and load/reset flows now sit behind `Pin.editorSession` instead of being reimplemented inline across toolbar handlers and inspector callbacks.
- 2026-04-28: Extracted rules and logic-graph editing into `app/editor/rulesLogic.js`. Sequence creation, graph node/edge mutation, rule CRUD, and switch-map CRUD now sit behind `Pin.editorRulesLogic`, leaving `editor.js` more focused on input wiring, rendering, and invalidation.
- 2026-04-28: Extracted pure table/editor helpers into `app/editor/model.js`. Default element creation, launcher sync, rule-config/image-layer initialization, and switch/lamp lookup helpers now live outside `editor.js`, reducing the editor shell’s responsibility to orchestration rather than model shape knowledge.
- 2026-04-28: Retuned held-flipper trapping and added a deterministic elbow-trap regression. Passive flipper contacts now damp residual normal/tangential motion instead of forcing a standing upward kick, and the flipper draw path now uses rounded end arcs so the blade reads less pointy at the tip and base.
- 2026-04-28: Broadened flipper catch regression coverage from a single elbow-trap case to a small stable-catch matrix across multiple contact points and incoming speeds. We now have deterministic numbers for whether a held flipper settles or chatters instead of relying on feel alone.
- 2026-04-28: Retuned passive flipper trapping again after the first trap fix proved too adhesive in play. The passive contact path now preserves pivot-ward tangential motion instead of biasing the ball into place, and the trap regression now checks for visible cradle roll-in from mid-flipper contact rather than rewarding an immediate dead stop on the blade.
- 2026-04-28: Added a deterministic moving-flipper catch regression, but did not keep the first explicit live-catch branch. That branch reduced the upward pop but destabilized the post-catch path, so the safer result for now is broader coverage around “playable moving catch” while keeping the simpler stable contact model.
- 2026-04-28: Tightened the inspector field widgets. Global delete/nudge shortcuts now ignore focused form controls, angle fields display in degrees instead of raw radians, color-like fields use a proper picker plus text entry, and number fields use more sensible per-property step sizes instead of a single generic increment.
- 2026-04-28: Moved inspector editing toward an explicit draft/commit model. Table, selection, rule, logic-node, image-layer, switch-map, and anchor cards now hold local draft state with Save/Reset actions, so card edits no longer mutate the table incrementally while the user is still working through a form.

## Concrete Changes to Consider Next

1. **Flipper rewrite**
   - `elementState.flipper` with torque/inertia.
   - swept time-of-impact collider.
   - live-catch dampening option.

2. **Physics broad phase**
   - static AABB grid.
   - dynamic collider list for flippers/gates/spinners/plunger.

3. **Event queue**
   - emit `hit`, `switch`, `score`, `mechanism` events.
   - consume in a rules module.

4. **Rules and bonus modes**
   - add `Pin.rules`.
   - declarative switch/event mapping.
   - sequence and timed-shot rules.
   - lamp/light outputs for lit objectives.

5. **Plunger rewrite**
   - spring model.
   - lane ball constraint.
   - physical plunger collision.

6. **Ramp rewrite**
   - surface centerline with width and z curve.
   - walls and entry/exit edges.
   - level filtering based on z/clearance.

## Design Principle

The big lesson is that pinball is not a set of passive shapes. It is a table of mechanisms. Each mechanism has data, visuals, collision, runtime state, events, and editor affordances. Our current architecture can grow into that, but the next improvements should push us toward explicit mechanisms and deterministic physics instead of adding more special cases to simple segment/circle collisions.

## Recent Update

- Added a shared `app/physicsHarness.js` module for flipper tuning scenarios.
- Added `physics-lab.html` so held-trap, moving-catch, and release/return cases can be replayed visually with live sliders.
- The automated flipper regressions now call the same harness scenarios, so manual tuning and test validation stay aligned.
- Added a static-app assistant path for design mode. The assistant is provider-agnostic, OpenAI-compatible, tool-based, and limited to structured rule patches so undo/validation stay deterministic.
- Extended the assistant with explicit layout picks and first-pass layout operations (`alignHorizontal`, `distributeHorizontal`, `matchWidth`, `matchHeight`) so object-alignment requests can produce real patches instead of generic advice.
- Simplified the visible assistant UX back to a chat-first surface. Extra context machinery can stay behind the scenes, but the user-facing model is now: ask in chat, review patch, apply or rollback.
- Tightened the assistant pipeline to a two-stage prompt flow: first pass thinks/tools, second pass emits strict patch JSON. This is the preferred approach over accumulating patch-repair code; beyond basic markdown stripping, unsupported formats should be rejected rather than normalized by more local helper logic.
- Added assistant trace logging and a visible log dialog. Invalid extraction output should now surface as an invalid structured response, with the first pass, extraction pass, parse result, and provider errors visible in-app instead of being flattened into `No response`.
- Tightened the assistant prompts further after inspecting real logs. The first pass should identify target ids and intended operations, not produce tutorial prose or replacement objects. The extraction pass should convert that intent into the supported patch envelope, not mirror malformed raw JSON back at the editor.
- Added API-level JSON Schema enforcement for the extraction pass where the provider supports it, with a logged fallback when it does not. This keeps the solution in prompt/contract discipline rather than growing local output-repair logic.
- Extended `physics-lab.html` with a sandbox scenario. The lab can now draw simple wall segments, place flippers, drag a repeatable ball spawn point, trigger left/right flippers, and tune core playfield physics live on the same runtime path as the harness scenarios.
- Extended the sandbox again with basic editor behavior: `Select / Move` now picks walls and flippers on the canvas, flipper pivots and wall segments can be dragged, and selecting a flipper exposes its live physics settings in the lab UI.
- Added a real sandbox drain on the same engine path. The lab now loads the `drain` element module, the sandbox table includes a bottom drain sensor, and the harness removes drained balls and respawns from the authored spawn point.
- Added base `score` support to more scoring mechanisms (`lane`, `bumper`, `dropTarget`, `kicker`) and kept them on the same event-queue scoring path as `spinner` and `scoreZone`.
- Added award-time rule actions for score control. Logic action nodes can now `setElementScore`, `addElementScore`, or `resetElementScore` against a target element id, and score-producing elements resolve their effective score through that runtime override state.
- Recast `trough` as a round saucer/pit mechanism: it captures, holds, and ejects a ball with configurable hold time, eject power, and eject angle. `drain` remains the bottom out-of-play removal sensor.
- Updated the assistant contract/context after the recent model changes. The compact table summary now exposes current editable element fields, `get_element` returns the full live element, and the prompt contract names the current score, flipper material, gate, launcher, drain, and trough properties so the model can produce supported patches instead of stale prose or invented fields.
