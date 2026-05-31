# Change Log

## 2026-05-31 12:25:00 +01:00

### Before Change
- **User intent:** Update README and necessary docs to describe autoplay and revise project framing around AI/vibe coding with a practical, honest tone.
- **Scope before implementation:** README described the editor, lab, AI assistant, and eval-agent, but did not explain autoplay, score-based autoplay evaluation, or the project's AI/simulation value proposition in the requested grounded style.

### After Change
- Updated `README.md`:
  - Reframed the project as a work-in-progress experimental browser sandbox rather than a polished product.
  - Added `What You Can Do Today` and explicit `What you cannot do today` lists.
  - Clarified the core idea: deterministic simulation, structured JSON table data, interactive editing, evaluation, and fast iteration.
  - Added a dedicated `Autoplay Evaluation` section covering launcher variation, flipper control, ball traces, heatmaps, target diagnostics, score summaries, and `Autoplay min score`.
  - Revised AI documentation to separate AI-assisted editing, simulation/evaluation, eval-agent automation, prompt evaluation, and possible future learning experiments.
  - Added concrete examples of useful assistant requests and grounded possible AI experiments.
  - Tightened `Project Status` around pinball as a practical exercise for AI-assisted development without claiming that LLMs understand table quality.

### Verification
- Documentation consistency checked with `rg`.

## 2026-05-31 12:05:00 +01:00

### Before Change
- **User intent:** Ensure autoplay runs with active targets/scoring and make single-ball scenarios evaluable on score.
- **Scope before implementation:** Autoplay rules/events were active internally, but score was not surfaced as a first-class autoplay metric and evaluator checks had no score threshold gate.

### After Change
- Updated `app/tableAutoplay.js` to expose score outcomes:
  - Trajectories now include per-ball `score`.
  - Summary now includes `totalScore`, `bestBallScore`, and `averageBallScore`.
  - Diagnostic labels now show score totals and best-ball score.
- Updated `app/tableEval.js` autoplay check:
  - Added `autoplayMinScore` option.
  - `autoplay_heatmap` now returns PASS/WARN against best-ball score when a threshold is provided.
- Updated `app/tuning/lab.js` eval UI/options:
  - Added `Autoplay min score` numeric control.
  - Wired `autoplayMinScore` through evaluator/AI-lab option paths.
- Updated `tests/smoke.test.js`:
  - Added assertions for `Autoplay min score` control/option wiring.
  - Added assertion that autoplay eval supports `autoplayMinScore`.

### Verification
- `npm test` passes (`smoke tests ok`, `eval-agent smoke ok`).

## 2026-05-31 11:40:00 +01:00

### Before Change
- **User intent:** Fix autoplay timing so flippers fire when the ball is actually playable on a flipper and stop random twitches when the ball is nowhere near.
- **Scope before implementation:** Predictive decisions could run too early/too broadly, and there was no immediate contact-trigger pulse path when the ball was already at flipper capture distance.

### After Change
- Updated `app/tableAutoplay.js` timing and trigger logic:
  - Prediction now runs only inside a stricter flipper action window (lower playfield + descending ball + near flipper pivots).
  - Added immediate contact pulse path (`contactPulseForBall`) that schedules a zero-delay short pulse when the ball is at a flipper capture point.
  - Added helper selection logic to pick the nearest left/right flipper candidate before firing.
  - Kept bounded pulse/cooldown behavior to avoid flipper latching.
- Updated `tests/smoke.test.js`:
  - Added assertions for immediate contact pulse path presence.
  - Added assertion that prediction is gated by flipper-proximity action window.

### Verification
- `npm test` passes (`smoke tests ok`, `eval-agent smoke ok`).

## 2026-05-31 11:20:00 +01:00

### Before Change
- **User intent:** Fix autoplay regressions where flippers never move or latch (especially right flipper), ensure multi-ball launch speed variation, reduce flipper-elbow trap loops, and improve predictive target aiming with clearer on-table diagnostics.
- **Scope before implementation:** Autoplay used overlapping control paths (heuristic press + timed assist + predictor), prediction modeled sustained hold instead of finite pulses, and live diagnostics did not clearly distinguish chosen vs rejected aiming outcomes.

### After Change
- Reworked `app/tableAutoplay.js` flipper control into bounded scheduled pulses:
  - Removed overlapping heuristic/timed-assist hold behavior from live control output.
  - Added scheduled pulse execution (`delay + pulse`) with explicit cooldown so flippers cannot latch high.
  - Prediction now evaluates finite pulse candidates (`none`, `left/right` with configurable delay ticks) that match live execution semantics.
  - Improved target choice ranking (unlit-first with distance tie-break) and candidate scoring (closest approach over path, hit bonus, drain/trap penalties).
  - Preserved launch hold sweep behavior for per-ball launch variation and retained trap escape pulses.
- Updated `app/tuning/lab.js` diagnostics and option wiring:
  - Live autoplay now passes unprefixed controller options (`targetingIntervalTicks`, `aimHorizonTicks`, `aimPulseTicks`, `aimCooldownTicks`) in addition to eval-prefixed fields.
  - Diagnostic overlay now supports per-shape color overrides for segments/points/circles.
  - Live aim overlay now renders target marker/ring, candidate rays, candidate trajectories, and richer labels including phase/chosen/cooldown.
- Updated `app/tableEval.js` autoplay check option mapping:
  - Added pass-through for `aimHorizonTicks`, `aimPulseTicks`, and `aimCooldownTicks` (from eval option names).
- Extended `tests/smoke.test.js`:
  - Added coverage for scheduled pulse predictor structure in autoplay runtime.
  - Added coverage for live option mapping to unprefixed controller keys.
  - Added coverage for per-segment/per-point diagnostic color handling.

### Verification
- `npm test` passes (`smoke tests ok`, `eval-agent smoke ok`).

## 2026-05-31 00:00:00 +01:00

### Before Change
- **User intent:** Add a lab autoplay test/eval that plays the current table visually, gathers ball traces, and builds a heatmap without impacting game mode simulation performance.
- **Scope before implementation:** The lab had launcher/flipper/target reachability checks and accessibility heatmaps, but no autoplay runner, no autoplay eval check, and no live autoplay controls for loaded tables.

### After Change
- Added lab-only autoplay runtime module `app/tableAutoplay.js`:
  - Uses production physics/runtime contracts (`Pin.physics.stepWorld`, launcher release, dynamic element stepping, events/rules processing).
  - Runs sequential multi-ball autoplay samples with unlit-first target preference.
  - Adds timed flipper-assist scheduling (impact prediction + lead/hold window) so autoplay actively attempts return shots.
  - Sweeps launcher hold duration across multi-ball samples to vary launch speed/power by design.
- Fixed live lab autoplay control propagation:
  - Updated `app/physicsHarness.js` `stepWorld()` to call `Pin.elements.stepDynamicElements(...)` before runtime refresh/physics.
  - This unblocked dynamic mechanism state updates in lab sandbox mode (flippers/launcher were otherwise visually and physically inert even when controls changed).
- Extended live autoplay launch variation:
  - `app/tableAutoplay.js` now varies launcher hold ticks per served ball in live mode using a min/max sweep instead of repeating one fixed hold duration.
- Fixed live trail visibility across multiple served balls:
  - `app/tuning/lab.js` now records separate live trajectories per serve (`live_ball_N`) instead of a single long path buffer that appeared as first-ball-only trail behavior.
- Added anti-elbow trap escape behavior:
  - `app/tableAutoplay.js` now detects low-speed, low-spread orbiting near flipper pivots and triggers a short escape sequence (release window + one-side pulse) to break repeated micro-flick traps.
- Improved flipper intelligence with predictive targeting:
  - `app/tableAutoplay.js` now runs short-horizon physics lookahead candidates (`none`, `left`, `right`) and selects the lowest-cost action toward the current preferred target.
  - Chosen action is applied for a short hold window before the next decision tick.
- Added visual target-aim diagnostics in live lab mode:
  - `app/tuning/lab.js` now overlays aim segments from live ball to target/predicted endpoints and renders candidate score labels + chosen mode/tick metadata in `state.eval.liveCheck` diagnostics.
  - Produces trace + heatmap diagnostics for evaluator/lab overlay rendering.
- Wired autoplay runtime into non-game surfaces only:
  - `physics-lab.html` now loads `app/tableAutoplay.js` before `app/tableEval.js`.
  - `tools/eval-agent.js` now loads `app/tableAutoplay.js` before `app/tableEval.js`.
- Extended evaluator in `app/tableEval.js`:
  - New check id/label/category: `autoplay_heatmap` / `Autoplay Heatmap` / `autoplay`.
  - New autoplay options consumed by evaluator: ball count, ticks per ball, targeting interval, unlit preference, heatmap cell size.
- Extended lab eval UI/workflow in `app/tuning/lab.js`:
  - Added autoplay eval controls (`Autoplay balls`, `Autoplay max ticks/ball`, `Autoplay target interval`, `Autoplay cell size`).
  - Added live autoplay controls (`Autoplay Live`, `Stop Live`) that run visually on loaded table sandbox world.
  - Added live autoplay overlay feed via `state.eval.liveCheck` so heatmap/trajectory rendering remains on the existing diagnostics path.
- Updated smoke coverage in `tests/smoke.test.js`:
  - Asserts lab and eval-agent script wiring for autoplay runtime.
  - Asserts `autoplay_heatmap` check registration.
  - Asserts lab autoplay controls/options are present.
  - Asserts `index.html` does not load lab-only autoplay runtime.

- Verification:
  - `npm test` passes (`smoke tests ok`, `eval-agent smoke ok`).

## 2026-05-30 11:36:31 +01:00

### Before Change
- **User intent:** Stop adaptive performance quality from upgrading again after it has downgraded.
- **Scope before implementation:** The adaptive quality controller could recover from reduced mode after a sustained stable window. This made quality shift during a play session after pressure had already forced a downgrade.

### After Change
- Updated `app/performance.js` so adaptive quality can still downgrade after sustained pressure, but no longer auto-recovers to full quality during the same controller/session.
- Removed recovery thresholds from the controller options path because they are no longer part of the behavior.
- Updated `tests/smoke.test.js` to assert reduced quality is sticky even after a long stable window.
- Verification:
  - `npm test` passes (`smoke tests ok`, `eval-agent smoke ok`).

## 2026-05-30 12:22:00 +01:00

### Before Change
- **User intent:** Proceed with measurable follow-up after the core performance refactor.
- **Scope before implementation:** Dynamic compile caching existed but had no direct runtime visibility into cache effectiveness during play sessions.

### After Change
- Added lightweight dynamic compile cache telemetry:
  - `app/elements/index.js` now tracks per-refresh `hits`/`misses` when dynamic cache is enabled.
  - `app/main.js` now records a `dynamicCompileCache` gauge in existing `pin.perf` logs, shown as `hits/total (rate%)`.
- Kept behavior unchanged: this update is observability-only and uses the existing perf toggle/logging path.
- Verification:
  - `npm test` passes (`smoke tests ok`, `eval-agent smoke ok`).

## 2026-05-30 12:05:00 +01:00

### Before Change
- **User intent:** Look critically at core physics simulation and presentation performance, then implement the highest-value fixes.
- **Scope before implementation:** Dynamic physics elements advanced mechanism state inside `compile()` and recompiled every fixed tick. Broad-phase query helpers also allocated temporary arrays/maps per query, adding avoidable per-step churn under heavier tables.

### After Change
- Split dynamic mechanism stepping from collider compilation for `flipper`, `gate`, `spinner`, and `launcher`:
  - Added explicit `step(el, table, world, dt)` hooks in each element module.
  - Updated `compile()` paths to emit geometry from current state rather than advancing state directly.
- Added dynamic collider compile caching in `app/elements/index.js`:
  - `compileElements()` now accepts `dynamicCacheStore` and reuses compiled outputs for dynamic physics elements when a module-provided `physicsCacheKey` is unchanged.
  - Added `Pin.elements.stepDynamicElements()` to advance dynamic state in one fixed-step pass.
- Updated play loop integration in `app/main.js`:
  - `createWorld()` now initializes `dynamicCompileCache` and `physicsScratch`.
  - Fixed-step loop now runs `stepDynamicElements(...)` before `refreshRuntime(...)`.
  - Dynamic refresh now passes the world cache store for reuse.
- Reduced physics hot-path allocation churn in `app/physics.js`:
  - `queryBroadPhase()` and `querySensorBroadPhase()` now accept scratch objects and reuse `refs`/`seen` containers.
  - Call sites now route through `world.physicsScratch`.
- Updated smoke coverage in `tests/smoke.test.js`:
  - Added explicit checks for dynamic stepping + caching contracts.
  - Updated gate forced-open/authored-angle test setup to call gate `step()` before `compile()`.
- Verification:
  - `npm test` passes (`smoke tests ok`, `eval-agent smoke ok`).

## 2026-05-26 15:07:34 +01:00

### Before Change
- **User intent:** Improve Assistant/Agentic logging so operators can always see what is happening.
- **Scope before implementation:** Existing assistant logs existed, but the event shape was inconsistent, inline status visibility was weak, and log access was not uniformly exposed across assistant subtabs.

### After Change
- Added a formal assistant log event contract in `app/editor/assistant.js` with structured fields: `id`, `at`, `kind`, `flow`, `phase`, `level`, `summary`, `detail`, and `detailData`.
- Added runtime redaction for sensitive fields before logging/rendering (`apiKey`, auth/token/secret variants).
- Added inline assistant run status (`runStatus`) so Chat/Agentic surfaces always show current flow/phase/summary and attempts.
- Updated `app/editor/panels.js` to:
  - show log metadata + summaries in the Assistant Log dialog,
  - expose `Show Log` in Provider and Agentic subtabs (Chat already had it),
  - show compact inline run status in Chat and Agentic views.
- Updated `Agentic.MD` to codify logging as a baseline contract, including redaction and multi-subtab log access.
- Added smoke coverage in `tests/smoke.test.js` for:
  - log visibility in all assistant subtabs,
  - runtime log metadata/phase/summary presence,
  - redaction expectations for provider-path logging,
  - inline run-status state availability.

## 2026-05-28 10:00:00 +01:00

### Before Change
- **User intent:** Revisit flipper physics so blade thickness behaves like a real body and balls cannot return through the underside.
- **Scope before implementation:** Flipper collision was a single thick centerline segment. This produced a line-like feel for thickness and allowed edge cases where underside interactions were not represented as finite blade volume.

### After Change
- Reworked `app/elements/flipper.js` to compile finite-volume flippers from:
  - playable edge segment,
  - underside edge segment,
  - pivot cap circle,
  - tip cap circle,
  across sweep samples (with `sweepOnly` preserved for intermediate samples).
- Added authored blade shape fields `rootRadius` and `tipRadius` with compatibility fallbacks from legacy `thickness`.
- Kept flipper response on the same material model (`surfaceRestitution`, `surfaceFriction`, `strikeBoost`) while restricting persistent support contact to the playable edge.
- Updated defaults and tuning surfaces:
  - `app/table.js` and `app/physicsHarness.js` now include default `rootRadius`/`tipRadius`.
  - `app/tuning/lab.js` backfills radii for older sandbox flippers and exposes sliders for both fields.
  - `app/editor/panels.js` includes the new fields in flipper inspector grouping.
- Extended `tests/smoke.test.js` with regression coverage for:
  - underside blocking (no upward pass-through from below),
  - authored radius influence on contact reach,
  - dynamic flipper tests now wiring both `dynamicSegments` and `dynamicCircles`.

## 2026-05-28 10:35:00 +01:00

### Before Change
- **User intent:** Keep the improved flipper shape but make flipper colors truly designer-controlled.
- **Scope before implementation:** Flipper visuals were still constrained by fixed highlight/stroke/pivot styling and a limited two-field color setup.

### After Change
- Updated flipper rendering in `app/elements/flipper.js` to support an authored draw palette with backward-compatible fallbacks.
- Added new optional flipper appearance fields:
  - `bodyColor`, `tipColor`, `strokeColor`, `pivotColor`, `highlightColor`, `glowStrength`.
- Kept compatibility with existing tables via `color`/`glowColor` fallback behavior.
- Updated flipper inspector ordering in `app/editor/panels.js` so the new visual controls are directly available in Appearance.
