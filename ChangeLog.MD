# Change Log

## 2026-05-31 17:35:00 +01:00

### Before Change
- **User intent:** Update project documentation for the current autoplay behavior and push the latest work to GitHub.
- **Scope before implementation:** README described autoplay generally, but did not mention active collectable target selection, event-based per-target hit maps, or the current browser neural autoplay experiment.

### After Change
- Updated `README.md`:
  - Clarified that autoplay now targets switch-backed elements, preferring unlit lane/drop-target primaries first and active collectable shots such as rule-armed troughs afterward.
  - Documented that target-hit tracking is based on processed `switchClosed` events and exposed through `summary.targetHitMap`.
  - Added a grounded description of the experimental browser neural autoplay path, including its heuristic sample training and fallback limits.
  - Updated AI experiment and architecture notes to include per-target hit maps and `app/tableAutoplayLearning.js`.

### Verification
- `npm test` (smoke + eval-agent smoke).
- `git push origin main`.

## 2026-05-31 17:20:00 +01:00

### Before Change
- **User intent:** Improve autoplay target selection so active troughs/collectable targets become valid aim targets when normal lanes/targets are already lit, and make target-hit tracking reliable because it is important evaluation data.
- **Scope before implementation:** Autoplay only chose `lane` and `dropTarget` elements, preferred unlit lamps, and counted hits using distance to the currently selected target rather than authoritative switch events.

### After Change
- Updated `app/tableAutoplay.js`:
  - Expanded autoplay target sources to include switch-backed targets such as troughs, kickers, spinners, score zones, bumpers, lanes, and drop targets.
  - Added target center resolution for x/y and anchor-based elements.
  - Target ranking now prefers unlit primary lane/drop targets first, then active collectable targets (for example lit/active troughs) once primaries are complete.
  - Active state is resolved through `Pin.rules.resolveElementProperty(world, el, "active", ...)` so logic-driven trough activation is visible to autoplay.
  - Target-hit tracking now uses processed `switchClosed` events and exposes `summary.targetHitMap` with per-target counts.
- Updated `app/tuning/lab.js`:
  - Heuristic-vs-neural compare hit counting now includes the broader autoplay target set.
- Updated `tests/smoke.test.js`:
  - Added assertions for trough/active collectable target selection and event-based per-target hit tracking.

### Verification
- `npm test` (smoke + eval-agent smoke).

## 2026-05-31 17:00:00 +01:00

### Before Change
- **User intent:** Neural autoplay is too passive; output action probabilities stay very low and flippers do not visibly twitch, falling far below heuristic baseline.
- **Scope before implementation:** Training rebalance still favored `none` heavily, and runtime fallback only activated on low confidence (not on indecisive/no-action behavior in playable flipper windows).

### After Change
- Updated `app/tableAutoplayLearning.js`:
  - Added indecision gating (`minActionProbability`, `indecisiveGap`) so neural mode can defer to fallback when model action confidence is weak even if top-class confidence is high.
  - Added playable-window check and applied fallback assist there when model is indecisive.
  - Kept model pulses and merged fallback outputs with OR semantics (instead of replacing model output), preserving learned actions when present.
  - Extended debug telemetry with `modelActionProb` and `modelGap` for clearer diagnosis of passive output.
- Updated `app/tuning/lab.js`:
  - Added stronger training rebalance helper for class distribution (`left/right` balancing + trimmed `none` class).
  - Applied rebalance to both offline sample collection and live-buffer training path.
  - Wired neural live controller options for indecision assist (`minActionProbability: 0.22`, `indecisiveGap: 0.1`) in both start and rebuild paths.
- Updated `tests/smoke.test.js`:
  - Added assertions for indecision-assist wiring in lab and option support in neural controller module.

### Verification
- `npm test` (smoke + eval-agent smoke).

## 2026-05-31 16:45:00 +01:00

### Before Change
- **User intent:** Implement fixes for neural live autoplay visibility and control so flippers actually move, launch behavior is sane, and live/training data is inspectable.
- **Scope before implementation:** Neural live lacked heuristic target context, fallback could mask model outputs, launcher control was effectively held while in lane, and panel/overlay telemetry did not expose final control outputs or sample content.

### After Change
- Updated `app/tableAutoplayLearning.js`:
  - Kept bounded launch-hold behavior but removed forced `launch=true` while in lane, so launcher release can occur.
  - Blended low-confidence fallback with model outputs instead of overwriting model pulses.
  - Extended debug payload with `source`, final `controls`, launch state, model shape, and feature snapshot.
- Updated `app/tuning/lab.js`:
  - Neural live now wires a heuristic companion controller as `fallbackController` and `targetProvider`.
  - Added richer neural panel metrics: final outputs, pulse/cooldown, source, model shape, live-action count, and latest sample preview.
  - Added live sample preview buffering and action-frame count tracking during heuristic data collection.
  - Applied the same neural wiring on sandbox rebuild while live autoplay is active.
- Updated `tests/smoke.test.js`:
  - Added assertions for neural live fallback/target wiring, richer panel telemetry fields, and neural-controller debug/control semantics.
  - Added assertion that neural launch logic no longer forces launch while in-lane.

### Verification
- `npm test` (smoke + eval-agent smoke).

## 2026-05-31 16:27:36 +01:00

### Before Change
- **User intent:** Fix inability to switch back to heuristic live mode after switching to neural mode.
- **Scope before implementation:** Live-mode UI state disabled mode buttons too aggressively after starting autoplay, preventing controller switchback.

### After Change
- Updated `app/tuning/lab.js`:
  - Mode buttons now remain usable for in-place switching while live is running.
  - Only the currently-active mode button is disabled; the other mode remains enabled.
  - Added active visual state (`active` class) for current live mode button.
  - Stop resets mode-button active state and restores normal availability.

### Verification
- `npm test` (smoke + eval-agent smoke).

## 2026-05-31 16:20:10 +01:00

### Before Change
- **User intent:** Fix remaining issue where switching between heuristic/neural live modes could leave autoplay unable to launch the next ball.
- **Scope before implementation:** Launch-cycle state was not reset when no ball existed, so new serves could be treated as already-in-lane and skip charge/release. Controller handoff could also carry stale launcher-charge state.

### After Change
- Updated `app/tableAutoplay.js`:
  - Heuristic controller now resets launch-lane cycle state when no active ball exists (`prevInLaunchLane`, `launchHoldTicks`, `launchReleased`).
- Updated `app/tableAutoplayLearning.js`:
  - Neural controller now clears `launchHold` when no ball exists, preventing stale hold carry-over into next serve.
- Updated `app/tuning/lab.js`:
  - Live controller switching now releases any pending launcher charge and clears handoff launch flags before swapping controllers.
- Updated `tests/smoke.test.js`:
  - Added assertions for no-ball launch reset in heuristic/neural controllers and launcher-release handoff on controller switch.

### Verification
- `npm test` (smoke + eval-agent smoke).

## 2026-05-31 16:13:25 +01:00

### Before Change
- **User intent:** Explain/fix repeated stable sample counts (e.g., `474`) and ensure training data accumulates during heuristic live autoplay.
- **Scope before implementation:** Training used an offline batch collector only. Reported sample count reflected post-rebalance set size, which could stabilize to similar values even when raw collected data differed.

### After Change
- Updated `app/tuning/lab.js`:
  - Added explicit `raw` vs `used` training sample reporting in neural status (`Collected raw / used`).
  - Added live heuristic sample buffer accumulation (`liveSamples`) while autoplay runs in heuristic mode.
  - `Train Neural` now prefers accumulated live samples when available; otherwise it falls back to batch collection.
  - Added `Collect Live On/Off` toggle to enable/disable live sample capture.
  - Added training panel updates for live-buffer size and accumulation visibility.
- Updated `tests/smoke.test.js`:
  - Added assertion for the `Collect Live On` control.

### Verification
- `npm test` (smoke + eval-agent smoke).

## 2026-05-31 16:08:47 +01:00

### Before Change
- **User intent:** Proceed on the wider issue where autoplay/eval actions were still forcing context changes to Sandbox.
- **Scope before implementation:** `loadEvalTable` forcibly switched scenario/tab to Sandbox and rebuilt simulation, disrupting current context.

### After Change
- Updated `app/tuning/lab.js`:
  - `loadEvalTable` no longer forces `scenarioId = "sandbox"` or tab changes.
  - Loading a table now preserves current context; sandbox rebuild only occurs when user is already in Sandbox.
- Updated `tests/smoke.test.js`:
  - Added regression assertion that eval-table load path does not enforce sandbox switch-and-rebuild sequence.

### Verification
- `npm test` (smoke + eval-agent smoke).

## 2026-05-31 16:05:48 +01:00

### Before Change
- **User intent:** Neural live should not reset the current ball/simulation when switching control mode, and autoplay buttons must not force the user into Sandbox automatically.
- **Scope before implementation:** `startLiveAutoplay` always forced `scenarioId = "sandbox"` and rebuilt simulation, which reset ball state and changed user context on button press.

### After Change
- Updated `app/tuning/lab.js`:
  - `startLiveAutoplay` now requires an already-active Sandbox simulation and does **not** auto-switch scenario/tab.
  - Added explicit status message when not in Sandbox: `Autoplay live: switch to Sandbox first (no auto-switch).`
  - When live autoplay is already running, switching heuristic/neural now swaps controller **in place** (`controller switched`) without rebuilding simulation or resetting the ball.
  - Fresh live start still initializes diagnostics/heatmap, but no forced scenario transition occurs.
- Updated `tests/smoke.test.js`:
  - Added assertions for no-auto-switch status messaging and in-place controller-switch behavior text.

### Verification
- `npm test` (smoke + eval-agent smoke).

## 2026-05-31 16:00:31 +01:00

### Before Change
- **User intent:** Continue and fix remaining neural-live launch failure; add visibility of training-data accumulation.
- **Scope before implementation:** Neural launch relied too heavily on `ball.inLaunchLane` state, and training UI only showed post-hoc totals rather than live sample accumulation.

### After Change
- Updated `app/tableAutoplayLearning.js`:
  - Added geometric launcher-lane fallback detection (`launcher` bounds + ball position) for launch control.
  - Neural launch now uses lane-state backup logic so it can launch even when `inLaunchLane` is missing/late.
- Updated `app/tuning/lab.js`:
  - Added right-rail `Training data` status/metrics in the `Autoplay Brain` panel.
  - Training collection now reports live totals, `none/left/right` class counts, and estimated sample rate.
  - Training panel explicitly shows `collecting` vs `idle`.
- Updated `tests/smoke.test.js`:
  - Added assertion that training-data status text is present in lab UI.

### Verification
- `npm test` (smoke + eval-agent smoke).

## 2026-05-31 15:52:13 +01:00

### Before Change
- **User intent:** Fix neural live freeze that still occurred after previous fallback/sanitization changes.
- **Scope before implementation:** Neural live path still passed a full heuristic controller as fallback, which could run expensive predictive lookahead every frame in parallel with neural inference and stall the lab loop on some tables.

### After Change
- Updated `app/tableAutoplayLearning.js`:
  - Reworked fallback behavior to avoid per-frame heavy controller execution.
  - Added cheap built-in emergency fallback action based on ball/flipper proximity.
  - Kept launch safety behavior in neural mode without invoking heuristic predictor each tick.
  - Heavy fallback controller is now only consulted when explicitly provided and confidence is low.
- Updated `app/tuning/lab.js`:
  - Removed full heuristic fallback-controller injection from neural live creation/rebuild paths.
  - Neural live now uses lightweight fallback path by default.

### Verification
- `npm test` (smoke + eval-agent smoke).

## 2026-05-31 15:44:36 +01:00

### Before Change
- **User intent:** Remediate neural live autoplay regression where switching to trained control caused no visible launch/flipper action and apparent ball loss.
- **Scope before implementation:** Neural policy ran standalone and could become inert (or load weak/stale weights), with no forced fallback to heuristic control in live mode.

### After Change
- Updated `app/tableAutoplayLearning.js`:
  - Added controller validation and defensive fallback path.
  - Added optional `fallbackController` and `minConfidence` gating.
  - Neural controller now always falls back to heuristic outputs when confidence is low or model is invalid.
  - Launch command now includes fallback launch behavior to avoid dead starts.
- Updated `app/tuning/lab.js`:
  - Neural live mode now injects a heuristic fallback controller.
  - Neural training sample set is rebalanced to reduce no-flip label dominance.
  - Training status now reports class counts (`none/left/right`) for visibility.
  - Rebuild path for active neural live mode now re-attaches the fallback-enabled neural controller.
- Updated `tests/smoke.test.js`:
  - Added assertions that neural controller supports fallback controller and confidence-threshold fallback settings.

### Verification
- `npm test` (smoke + eval-agent smoke).

## 2026-05-31 15:38:01 +01:00

### Before Change
- **User intent:** Proceed with the suggested next steps by adding heuristic-vs-neural autoplay comparison and model persistence for the lab neural controller.
- **Scope before implementation:** Neural autoplay could train and run live, but had no side-by-side comparison workflow and no per-table persistence of trained model weights.

### After Change
- Updated `app/tuning/lab.js`:
  - Added per-table neural model persistence (`localStorage`) keyed by selected table ref.
  - Neural model now auto-loads when a table is loaded in the lab.
  - Added `Compare Runs` action to run heuristic and neural controllers over the same configured ball budget and show score/target-hit deltas.
  - Compare summary is displayed directly in live autoplay status text.
  - Neural panel state/controls now refresh with compare and persistence state.
- Updated `tests/smoke.test.js`:
  - Added assertion that the lab eval UI exposes `Compare Runs`.

### Verification
- `npm test` (smoke + eval-agent smoke).

## 2026-05-31 15:34:05 +01:00

### Before Change
- **User intent:** Implement a first lab-only neural autoplay path with meaningful visuals around network behavior and activity, while keeping core physics untouched.
- **Scope before implementation:** Lab autoplay supported heuristic control with target diagnostics and scoring, but had no trainable in-browser policy, no neural-vs-heuristic switch, and no dedicated neural telemetry panel.

### After Change
- Added `app/tableAutoplayLearning.js` (lab-only):
  - Tiny feed-forward policy (`16 -> 12 -> 3`) with softmax outputs (`none`, `left`, `right`).
  - Feature extractor from live world state (ball pose/velocity, flipper-relative geometry, launch-lane flag, optional target vector).
  - Browser-side SGD training from labeled samples.
  - Neural controller using bounded pulses/cooldown so flippers do not latch.
- Updated `physics-lab.html`:
  - Added `app/tableAutoplayLearning.js` after `app/tableAutoplay.js` and before evaluator bootstrap.
- Updated `app/tuning/lab.js`:
  - Added neural autoplay state (`model`, sample/loss stats, live mode).
  - Added eval-panel controls for neural training (`Neural train balls`, `Neural max samples`, `Neural epochs`) plus actions (`Train Neural`, `Neural Live`, `Heuristic Live`, `Stop Live`).
  - Implemented heuristic-sample collection via sandbox simulation clones, then neural training from those samples.
  - Added live-mode switching between heuristic and neural controllers without touching `Pin.physics`.
  - Added right-side `Autoplay Brain` panel with mode, sample count, loss, policy outputs, action, and confidence.
  - Extended on-table live labels to include neural policy output and confidence during neural live runs.
- Updated `tests/smoke.test.js`:
  - Added assertions that `physics-lab.html` loads `app/tableAutoplayLearning.js`.
  - Added assertions that neural training/live controls are present in lab eval UI.
  - Added assertions that the neural module exports expected runtime entry points.

### Verification
- `npm test` (smoke + eval-agent smoke).

## 2026-05-31 14:20:00 +01:00

### Before Change
- **User intent:** Fix autoplay so it actually scores and lights targets in live lab mode, and stop trail paths from dying during longer runs.
- **Scope before implementation:** Live autoplay used sandbox simulation that did not process queued rule events and did not preserve loaded table logic/rules in sandbox table construction. Trail sampling used `path.length % 4`, which stops sampling once the path length reaches a non-divisible steady value.

### After Change
- Updated `app/physicsHarness.js`:
  - Sandbox table builder now supports `baseTable`, preserving authored `rules`/`logicDocument` while still overriding lab playfield/elements.
  - Sandbox world setup now builds `staticSensorBroadPhase` and tracks `dynamicSensors` like normal runtime worlds.
  - Harness `stepWorld` now runs `Pin.events.processRules(world, dt)` after physics so switch events update score/lamp/rule state.
- Updated `app/tuning/lab.js`:
  - Loaded eval tables are now stored as `state.sandbox.baseTable` and passed into sandbox simulation rebuilds.
  - Live autoplay trail sampling now uses `liveSampleCounter` instead of `livePath.length % 4`, so long sessions keep appending sampled points.
  - Live autoplay start/stop now resets `liveSampleCounter`.
- Updated `app/tableAutoplay.js`:
  - Eval worlds now initialize `staticBroadPhase` and `staticSensorBroadPhase` for runtime parity.
  - Autoplay trace sampling now uses `stats.traceSampleCounter` to avoid sampling deadlock after path growth.
- Updated `tests/smoke.test.js`:
  - Added checks for autoplay world broad-phase setup and explicit trace sample counter.
  - Added checks that physics harness sandbox supports `baseTable` and processes rule events.
  - Added checks that lab live autoplay keeps base table data and uses continuous sample-counter path sampling.
- Updated runtime loading for autoplay logic/scoring parity:
  - Added `app/logic/simulate.js`, `app/rules.js`, and `app/events.js` to `physics-lab.html`.
  - Added `app/logic/simulate.js` and `app/events.js` to `tools/eval-agent.js` runtime script list.
  - Added smoke assertions that lab/eval-agent include these required scripts.

### Verification
- `npm test` (smoke + eval-agent smoke).

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
