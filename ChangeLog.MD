# Change Log

## 2026-06-01 14:24:40 +01:00

### Before Change
- **User intent:** Ensure Brain view reflects the new reward/drain behavior so operators can see it happening.
- **Scope before implementation:** Reward/drain telemetry existed in Autoplay Neural metrics, but Brain tab remained focused on model internals and did not show outcome counters or reward summaries.

### After Change
- Updated `app/tuning/lab.js`:
  - Extended `refreshBrainPanel(...)` to consume training telemetry (`weightedSuccessSampleCount`, hit/score/miss counts, quick-drain misses, average reward).
  - Added reward/outcome values into Brain output metric rows (`shot_hit`, `shot_score`, `shot_miss`, `shot_quick_drain`, `avg_reward`).
  - Updated Brain run status text to include weighted success for immediate training-impact visibility.
- Updated `tests/smoke.test.js`:
  - Added assertions that Brain rendering includes weighted-success and reward/outcome fields (`shot_quick_drain`, `avg_reward`).

### Verification
- `npm test` (smoke tests ok; eval-agent smoke ok).

## 2026-06-01 14:15:20 +01:00

### Before Change
- **User intent:** Discourage autoplay shots that quickly end in drain.
- **Scope before implementation:** Miss outcomes were penalized uniformly and mostly at timeout, so fast post-flip drains were not explicitly identified or penalized more strongly than other misses.

### After Change
- Updated `app/tuning/lab.js`:
  - Added `shotDrainLookup(...)` so shot attribution can identify drain switch sources.
  - Added explicit drain-event attribution path in `attributeShotOutcomes(...)` that converts recent flipper attempts into immediate miss samples when drain fires soon after a shot.
  - Added stronger reward penalties for drain misses in `rewardForShotOutcome(...)`, with the harshest penalty for very quick drains.
  - Added stronger miss weights for drain-driven misses in `trainingWeightForShot(...)` so training updates learn away from those actions faster.
  - Added `quickDrainSampleCount` training telemetry and surfaced it in the Neural panel as `Quick drain misses`.
  - Reset shot attribution lookups (`shotTargetLookup`, `shotDrainLookup`) when live autoplay stops/starts to avoid stale-table mapping.
- Updated `tests/smoke.test.js`:
  - Added assertions for drain lookup creation, drain event detection branch, fast-drain penalty rule, and quick-drain telemetry row.

### Verification
- `npm test` (smoke tests ok; eval-agent smoke ok).

## 2026-06-01 14:06:42 +01:00

### Before Change
- **User intent:** Revisit Lab autoplay/neural behavior so training encourages target hits or points and reduces non-productive flipper behavior.
- **Scope before implementation:** Neural training used a 3-class supervised loop with duplicated success samples from attributed hits, but lacked explicit reward metadata, conservative miss penalties, and weighted gradient training. Event processing also did not expose per-switch score deltas for attribution.

### After Change
- Updated `app/events.js`:
  - Added `event.scoreDelta` metadata for processed `score` and `switchClosed` events so lab attribution can consume points from switch outcomes.
- Updated `app/tableAutoplayLearning.js`:
  - Raised default hidden-size fallback from `12` to `24`.
  - Added bounded per-sample training weight support and applied weights to loss/gradient updates.
  - Added `weightedSamples` in training result metadata.
- Updated `app/tuning/lab.js`:
  - Expanded neural training state for reward telemetry (`weightedSuccessSampleCount`, hit/score/miss counters, accumulated reward).
  - Upgraded shot-attribution pipeline:
    - records `scoreAtFlip` on each pending shot attempt,
    - attributes `hit` / `hit_score` outcomes from `switchClosed` events using `event.scoreDelta`,
    - emits conservative timeout outcomes (`score` or `miss`) after attribution window expiry.
  - Added explicit reward and weight functions (`rewardForShotOutcome`, `trainingWeightForShot`) and materialized `sample.reward`/`sample.weight` for shot samples.
  - Changed outcome->training conversion to weighted samples (including conservative `none` labels for misses) instead of pure duplication.
  - Updated neural panel telemetry to expose outcome mix, weighted success, average reward, and richer last/recent shot detail.
  - Raised lab neural hidden-size fallback defaults from `12` to `24`.
- Updated `tests/smoke.test.js`:
  - Added assertions for `event.scoreDelta` metadata in events processing.
  - Added assertions for weighted training support and new hidden-size default.
  - Added assertions for score-baseline/miss timeout attribution behavior and new neural telemetry fields.

### Verification
- `npm test` (smoke tests ok; eval-agent smoke ok).

## 2026-06-01 10:55:00 +01:00

### Before Change
- **User intent:** Fix new runtime errors after Lab UI rework and prevent recurrence with regression tests.
- **Scope before implementation:** `refreshBrainPanel` referenced undeclared brain metric DOM nodes (`brainFeatureRows`, `brainHiddenRows`, `brainOutputRows`), and browser emitted a warning because the AI API key password input was not inside a form.

### After Change
- Updated `app/tuning/lab.js`:
  - Restored Brain detail DOM construction for telemetry rows/canvas/status blocks so `refreshBrainPanel` has valid bound nodes.
  - Wrapped AI provider credential controls in `aiProviderForm`, including API key input.
  - Hardened provider buttons inside the form as `type="button"` and prevented default submit behavior.
- Updated `tests/smoke.test.js`:
  - Added assertions that brain metric row nodes are declared before `refreshBrainPanel` uses them.
  - Added assertions that AI provider settings create/use a form containing the API key row.

### Verification
- `npm test` (pending run after patch set).

## 2026-06-01 10:40:00 +01:00

### Before Change
- **User intent:** Fix runtime crash in Physics Lab after UI reorganization and ensure regression coverage.
- **Scope before implementation:** `app/tuning/lab.js` referenced `autoplayWrap` before initialization inside `mount`, causing `ReferenceError` and preventing lab bootstrap.

### After Change
- Updated `app/tuning/lab.js`:
  - Moved `Autoplay & Neural` panel wrapper creation (`autoplayWrap`) so it is declared before first use.
  - Removed duplicate later declaration block to keep one clear construction path.
- Updated `tests/smoke.test.js`:
  - Added declaration-order regression assertion to enforce `autoplayWrap` creation appears before first `appendChild` usage.

### Verification
- `npm test` (pending run after patch set).

## 2026-06-01 10:25:00 +01:00

### Before Change
- **User intent:** Review and remediate Physics Lab UI organization so users can access controls/data with minimal navigation and without long-scroll hunting.
- **Scope before implementation:** Lab UI concentrated many workflows in mixed long panels (especially Eval + Autoplay/Neural) and used a continuously stacked right rail for metrics, eval detail, AI detail, and export.

### After Change
- Updated `app/tuning/lab.js` workflow information architecture:
  - Re-labeled top workflow tabs to `Tune`, `Sandbox`, `Evaluate`, `Autoplay`, and `AI Patch`.
  - Split Autoplay/Neural controls out of `Evaluate` into a dedicated `Autoplay` workflow panel.
  - Added right-rail detail tabs (`Metrics`, `Eval`, `Brain`, `AI`, `Export`) with contextual panes to remove long mixed-purpose scrolling.
- Updated `app/tuning/lab.css` layout behavior:
  - Removed hard app min-width floor.
  - Added right-rail detail tab/pane styling.
  - Added responsive breakpoints so panels stack for narrower screens instead of forcing fixed desktop width.
- Updated `tests/smoke.test.js` to align expected lab tab label with the new `Autoplay` workflow tab.

### Verification
- `npm test` (pending run after patch set).

## 2026-05-31 22:09:52 +01:00

### Before Change
- **User intent:** Fix unreliable launch behavior in Lab `Neural Live`.
- **Scope before implementation:** Neural controller launch charging depended on immediate launch-lane detection each tick and reset quickly on lane-state flicker, causing inconsistent charge/release cycles compared with heuristic live autoplay.

### After Change
- Updated `app/tableAutoplayLearning.js` neural live controller:
  - Added explicit serve-cycle launch state: `prevInLaunchLane`, `launchReleased`.
  - Detects lane entry edges to start a single launch hold countdown per serve.
  - Releases launcher once per serve and avoids re-arming until a new lane entry.
  - Applied the same launch-cycle behavior to fallback path inside neural controller for consistency when model confidence gates to fallback.
- Impact:
  - `Neural Live` launch behavior now follows the same resilient charge/release pattern used by heuristic autoplay, reducing missed or stalled serves.

## 2026-05-31 21:56:49 +01:00

### Before Change
- **User intent:** In Lab autoplay, treat spinners like bumpers/kickers and only target them when no lanes, drop targets, or active troughs are available.
- **Scope before implementation:** Target ranking could promote spinner-style collectable shots as soon as unlit primaries were exhausted, even when foundational shots (lanes/targets/troughs) still existed.

### After Change
- Updated `app/tableAutoplay.js` target ranking:
  - Added explicit foundational-target classification (`lane`, `dropTarget`, and active `trough`).
  - Forced foundational targets to rank above spinner/kicker/bumper-style fallback targets.
  - Kept existing unlit-primary and collectable sorting behavior inside each class.
- Impact:
  - Heuristic targeting now keeps spinner shots as fallback opportunities instead of early preferred goals.
  - Neural live feedback that consumes heuristic target context now inherits the same target-priority policy.

## 2026-05-31 21:39:17 +01:00

### Before Change
- **User intent:** Update documentation for the current autoplay/neural Brain work and push the repository to GitHub.
- **Scope before implementation:** README described autoplay and a browser neural path, but still said the repo could not train a flipper controller and did not document the new `Brain` tab, hidden/logit telemetry, or attributed shot-outcome training data.

### After Change
- Updated `README.md` to:
  - clarify that Lab can train a small browser-side neural flipper policy, while not claiming production-quality or reward-optimising training,
  - include the `Brain` tab in Lab capabilities and tab workflow,
  - describe visible neural telemetry: input features, hidden activations, output probabilities, logits, selected action, source/fallback state, and weight summaries,
  - explain that training can use heuristic samples plus attributed successful shot outcomes from processed switch events,
  - keep limits explicit: no reinforcement learning loop, no direct score-reward optimisation, and continued heuristic fallback/target context.

## 2026-05-31 18:30:00 +01:00

### Before Change
- **User intent:** Make model success align with successful flipper-to-target outcomes, not only frame-level imitation labels.
- **Scope before implementation:** Neural training primarily consumed `none/left/right` frame labels; shot-outcome attribution existed but was not yet used as a weighted training signal.

### After Change
- Updated `app/tuning/lab.js`:
  - Added `shotOutcomeSamplesToActionSamples(...)` to convert attributed shot outcomes into additional action samples.
  - Weighted outcome-derived samples by shot latency (`ticksAfterFlip`) so cleaner, near-term target hits contribute more.
  - Merged success-derived samples into the neural training set and rebalanced before SGD.
  - Added panel visibility for outcome-driven training influence (`Shot L/R`, `Success used`).
  - Training status now reports raw + success sample contribution.
- Updated `tests/smoke.test.js`:
  - Added assertions for success-sample transformation hook and new panel visibility fields.

### Verification
- `npm test` (smoke + eval-agent smoke).

## 2026-05-31 18:15:00 +01:00

### Before Change
- **User intent:** Make the new autoplay shot-outcome data fully visible in the lab UI ("everything, we should be able to see").
- **Scope before implementation:** The panel showed aggregate shot counters and only a single last-shot row, which made it hard to inspect pending attempts, recent attributed outcomes, and per-target hit distribution.

### After Change
- Updated `app/tuning/lab.js`:
  - Added `Pending shots` metric to the `Autoplay Brain` panel.
  - Added `Recent shots` detail summary showing the latest attributed `flip -> target @+T` outcomes.
  - Added `Target hit map` detail summary showing top per-target outcome counts.
  - Preserved existing aggregate rows while exposing rawer live context.
- Updated `tests/smoke.test.js`:
  - Added assertions for pending-shot visibility, recent-shot detail text, and target-hit-map detail text.

### Verification
- `npm test` (smoke + eval-agent smoke).

## 2026-05-31 18:05:00 +01:00

### Before Change
- **User intent:** Improve autoplay/neural data quality by linking flipper actions to later target hits with a time offset, starting from easy switch-backed targets/lanes.
- **Scope before implementation:** Live neural training samples captured frame-level action labels only (`none/left/right`) and did not preserve outcome labels like `target hit after T`.

### After Change
- Updated `app/physicsHarness.js`:
  - Sandbox step now stores processed rule events as `world.lastProcessedEvents` so lab live mode can attribute outcomes without touching core physics.
- Updated `app/tuning/lab.js`:
  - Added shot-attempt collection on flipper press transitions (`recordShotAttempt`), including state snapshot and features at press time.
  - Added shot-outcome attribution (`attributeShotOutcomes`) from processed `switchClosed` events using a tick window to compute `ticksAfterFlip` and `secondsAfterFlip`.
  - Added lab training state buffers/maps for outcome data: `shotSamples`, `recentShotSamples`, `shotHitMap`, and `pendingShotAttempts`.
  - Added neural panel/overlay visibility for shot outcome accumulation and latest `flip -> target @+T` attribution.
- Updated `tests/smoke.test.js`:
  - Added assertions for harness processed-event retention and live lab shot-attribution wiring/visibility.

### Verification
- `npm test` (smoke + eval-agent smoke).

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

## 2026-05-31 21:26:31 +01:00

### Before Change
- **User intent:** Add a dedicated, visible neural-network view in Lab so model activity is auditable ("if it is happening, we can see it"), including architecture options and live telemetry.
- **Scope before implementation:** Neural autoplay status existed in a compact right-side summary, but there was no dedicated brain page, no network diagram, and no exposed hidden/logit activations for inspection.

### After Change
- Added a dedicated **Brain** tab in `app/tuning/lab.js` and expanded tab layout in `app/tuning/lab.css` to five tabs.
- Added a Brain panel with:
  - live run/model/action/status summaries,
  - architecture option visibility (`16->8->3`, `16->12->3`, `16->16->3`, `16->24->3`),
  - a canvas-rendered network flow graph (inputs -> hidden -> outputs),
  - feature/hidden/output value tables including logits.
- Added a new eval control: **Neural hidden units** (4..64), and wired it into training model creation.
- Synced hidden-size UI with loaded persisted models so architecture display remains accurate after reload.
- Extended autoplay learning debug payload in `app/tableAutoplayLearning.js` to expose:
  - `hidden` activations,
  - `logits`,
  - `featureNames` metadata,
  and exported `featureNames` from `Pin.tableAutoplayLearning`.
- Added/updated smoke checks in `tests/smoke.test.js` for:
  - Brain tab/panel existence,
  - brain graph refresh hooks,
  - hidden-unit control exposure,
  - debug telemetry fields (`hidden`, `logits`, `featureNames`).
## 2026-06-01 - Logic Visual Builder Prototype (Visual Tab)

- **User intent:** Implement the Pinball Logic Editor visual-builder spec as a safe prototype that projects existing schema, keeps JSON as source of truth, and integrates as a separate tab.
- **Scope before implementation:** The `#logic` workspace was feature-first but did not have the requested desktop-style visual builder layout with grouped projection cards, feature tree panel, inspector/playfield split, and bottom JSON/schema/validation tabs in one surface.

- Added `app/logic/visualProjection.js`:
  - Implemented pure projection helpers: `buildVisualModel`, `detectCompletionGroups`, `detectClaimGroups`, `detectDrainBehaviour`, and `detectMultiplierLadders`.
  - Added `validateVisualModel` to preserve unknown effect types while warning instead of mutating/dropping them.
- Added `app/logic/visualBuilder.js`:
  - Implemented `Pin.logicVisualBuilder.mount(container, options)` prototype view.
  - Added top toolbar, left nav rail, feature tree, grouped logic canvas, right inspector + playfield reference mini-map, and bottom JSON/schema/validation tabs.
  - Added safe first-pass edits for action rules (`name`, `enabled`, `trigger`, `condition`, editable effect values) and feature membership toggles (`objects`, `states`, `rules`, `lamps`).
  - Ensured edits write directly to existing `table.logicDocument` and `table.features`.
- Added `app/logic/visualBuilder.css` for isolated visual-builder styling.
- Updated `app/logic/page.js`:
  - Added a new `Visual Builder` section in the existing `#logic` workspace.
  - Mounted visual builder as a separate tab and kept legacy sections intact.
  - Reused existing persistence/validation flow via `commitDocChange`.
- Updated `index.html`:
  - Added `app/logic/visualBuilder.css`.
  - Added `app/logic/visualProjection.js` and `app/logic/visualBuilder.js` before `app/logic/page.js`.
- Updated `tests/smoke.test.js`:
  - Added script-order assertions for the new visual modules.
  - Added projection detector tests for completion/drain group detection and score-multiplier ladder detection.

- **Impact after change:** The app now has a working visual logic-builder tab that improves inspectability and safe editing without introducing a new persisted runtime model; existing logic schema remains canonical and round-trippable.
## 2026-06-01 - Visual Builder Playfield Reference Upgrade

- **User intent:** Replace the visual builder playfield reference placeholder with something that actually shows the table.
- **Scope before implementation:** The panel rendered only a gradient mini-map with dots, which made object context hard to understand and looked like visual noise.

- Updated `app/logic/page.js`:
  - Passed `tableAssetBaseHref` through to visual builder mount so relative image paths resolve correctly.
- Updated `app/logic/visualBuilder.js`:
  - Added playfield image URL resolution from `table.images[]` (prefers `mode: play|both`).
  - Applied resolved image as mini-map background with safe CSS URL escaping.
  - Added object/lamp visibility toggles and retained click-to-select marker behavior.
  - Increased marker cap and differentiated marker type styling (`object` vs `lamp`).
- Updated `app/logic/visualBuilder.css`:
  - Styled toggle row and improved mini-map image treatment.
  - Added marker variants and image overlay treatment for contrast/readability.

- **Impact after change:** The playfield reference now renders an actual table thumbnail when art is available, with usable overlays for logic-oriented object/lamp selection.
## 2026-06-01 - Visual Builder Reference UI Pass

- **User intent:** Move the Logic Visual Builder toward the provided reference image so the workspace looks and reads like a production desktop logic tool.
- **Scope before implementation:** The prior prototype proved projection/editing mechanics, but canvas cards, density, inspector richness, and overall layout hierarchy were still simplified and not visually aligned with the target.

- Updated `app/logic/visualBuilder.js`:
  - Reworked the full render pipeline into a denser four-column workspace with a structured top toolbar, left nav rail, feature tree, grouped logic canvas, right inspector/playfield stack, and bottom JSON/schema/validation panel.
  - Added richer group renderers:
    - completion flow cards (switch -> latch/state -> computed -> rule),
    - claim-flow cards,
    - drain behaviour split into `Engine Flow` (synthetic) and `Table Reset` (real drain-triggered rules),
    - multiplier ladder step cards,
    - improved generic rule grouping.
  - Expanded selection model (`rule`, `feature`, `group`, `switch`, `state`, `computed`, `object`) and added feature-driven group highlighting/muting.
  - Upgraded inspector behavior:
    - rule editing for name/enabled/trigger/condition/effects with add-effect action,
    - related objects/states/lamps chips,
    - feature membership editing with chips,
    - object/state/switch/computed read-only inspectors.
  - Kept writeback constrained to existing `table.logicDocument` + `table.features` through existing commit hooks.
- Updated `app/logic/visualBuilder.css`:
  - Replaced prototype styles with a denser, reference-oriented visual system (desktop panel rhythm, tighter cards, clearer hierarchy, node accents by type, stronger bottom validation presentation, responsive fallbacks).
  - Improved playfield marker readability and selection visibility.

- **Impact after change:** The Visual Builder now presents as an intentional, high-density logic workspace much closer to the reference direction while preserving the core guardrail: visual groups are projections and persisted JSON schema remains unchanged.
## 2026-06-01 - Playfield Marker Numbering Consistency

- **User intent:** Ensure playfield reference markers are consistently labeled, not only a subset.
- **Scope before implementation:** Marker text was intentionally sparse (every fourth marker), which made numbering appear inconsistent and confusing during selection.

- Updated `app/logic/visualBuilder.js`:
  - Changed playfield marker labeling so every visible marker receives a numeric badge (`1..N`) instead of sparse sampling.

- **Impact after change:** Marker labeling is now predictable and consistent for all rendered markers in the playfield reference panel.
## 2026-06-01 - Logic Canvas Icon Parity + Playfield Cross-Highlight

- **User intent:** Reuse the same icon language as Designer on Logic canvas cards, and when selecting canvas items show involved object(s) highlighted in Playfield Reference.
- **Scope before implementation:** Logic node cards used custom/simple labels without Designer icon parity, and playfield highlighting only activated for directly selected marker objects, not for rule/group/state-driven selections.

- Updated `app/logic/visualBuilder.js`:
  - Added Designer palette SVG mapping (`designerPaletteSvgForType`) to logic canvas node cards.
  - Updated node card rendering to include icon cells matching Designer vocabulary.
  - Added selection-to-playfield cross-reference resolver (`highlightedObjectIds`) so canvas/inspector selections now highlight related playfield objects:
    - rule -> related trigger/effect objects,
    - switch -> source element,
    - state/computed -> objects from related rules,
    - feature -> explicit objects + objects implied by feature rules,
    - group -> objects implied by group rules,
    - object -> direct active marker.
  - Updated marker class assignment to distinguish direct selection (`active`) from related involvement (`involved`).
- Updated `app/logic/visualBuilder.css`:
  - Added node icon layout/style primitives for embedded SVG icons.
  - Added `involved` marker styling so related objects are visibly indicated even when not directly selected.

- **Impact after change:** Logic canvas now shares icon semantics with Designer, and playfield reference consistently reflects object involvement for canvas/inspector-driven selections.
## 2026-06-01 - Sticky Inspector Rail While Scrolling Canvas

- **User intent:** Keep Inspector visible when scrolling down the Logic Canvas so details are immediately visible after selecting deep items.
- **Scope before implementation:** The right column (Inspector + Playfield Reference) scrolled away with the page, forcing users to scroll back up after selecting lower canvas cards.

- Updated `app/logic/visualBuilder.js`:
  - Marked the right workspace column with a dedicated sticky-rail class (`logic-vb-col-right`).
- Updated `app/logic/visualBuilder.css`:
  - Added sticky side-rail behavior for the right column (`position: sticky`, top anchor, viewport-bounded internal scrolling).
  - Added responsive fallback to disable sticky behavior on narrow layouts (`max-width: 1260px`) so stacked mobile/tablet layout remains natural.

- **Impact after change:** The Inspector/Playfield rail now stays in view while users scroll through large canvas groups, removing the “scroll up to inspect” workflow interruption.

### Follow-up (2026-06-01)

- **User feedback:** Sticky behavior still appeared unreliable in practice.
- **Root cause identified:** `.logic-vb-shell` used `overflow: hidden`, which can break viewport-based sticky behavior by creating a non-visible overflow ancestor.
- Updated `app/logic/visualBuilder.css`:
  - Changed `.logic-vb-shell` overflow to `visible` so sticky can anchor to page scroll.
  - Added `z-index` to `.logic-vb-col-right` to keep the side rail on top during scroll.
- **Impact after follow-up:** Right rail sticky behavior is now aligned with browser sticky mechanics and should remain visible while scrolling the canvas.
## 2026-06-01 - Logic Canvas Group Reflow (Horizontal Density)

- **User intent:** Improve arrangement inside Logic Canvas groups with better horizontal space usage.
- **Scope before implementation:** Completion/claim groups used mostly row/wrap flow with wider minimum cards, causing avoidable vertical growth and less efficient desktop scanning.

- Updated `app/logic/visualBuilder.js`:
  - Reworked completion group rendering into a two-column structure:
    - feeder switch->latch rows in a left grid,
    - computed + follow-up rule stack in a right column.
  - Updated claim group to use a dedicated horizontal layout class for stable trigger -> condition -> rule flow.
- Updated `app/logic/visualBuilder.css`:
  - Added horizontal-first group layout rules (`logic-vb-completion-layout`, `logic-vb-feeder-grid`, `logic-vb-claim-layout`).
  - Reduced node card minimum width and generic rule-card minimum width to fit more cards per row.
  - Added responsive fallbacks so narrow screens still stack cleanly.

- **Impact after change:** Canvas groups now use desktop width more effectively, reduce unnecessary vertical scrolling, and preserve readability of trigger/condition/effect flow.

### Follow-up (2026-06-01)

- **User intent:** Proceed with stronger in-group alignment so groups feel more grid-structured and less wrap-driven.
- Updated `app/logic/visualBuilder.js`:
  - Added group-kind CSS class tagging on each rendered group section (`logic-vb-group-<kind>`).
- Updated `app/logic/visualBuilder.css`:
  - Tightened completion layout into a stable two-column split with fixed feeder row columns (`switch -> arrow -> latch`).
  - Tuned claim row to a fixed five-column flow (`trigger -> arrow -> condition -> arrow -> rule`).
  - Increased generic rule-grid minimum width for cleaner horizontal packing.
  - Added group-kind-specific sizing tweaks (drain two-column balance, consistent node heights in completion/claim cards).

- **Impact after follow-up:** Group internals now align more consistently across rows, improving scanability and horizontal space usage on desktop.
## 2026-06-01 - PinLogic as Primary Logic Surface + Working Rail Navigation

- **User intent:** Remove the nested “screen within a screen” effect, reclaim space, and make the new PinLogic rail navigation actually work.
- **Scope before implementation:** The new visual builder was mounted as one tab inside the old three-pane logic workspace, with duplicate navigation chrome and static rail items in PinLogic.

- Updated `app/logic/page.js`:
  - Changed default logic section to `visual` so `#logic` opens directly into PinLogic.
  - Added mode-route navigation helper for Play/Design transitions from PinLogic.
  - Added mapping from PinLogic rail ids to existing logic sections.
  - When in `visual` section:
    - bypasses legacy left-nav/right-inspector rendering,
    - mounts PinLogic as the primary workspace,
    - removes the extra right-side “this is new” note card.
  - Passed navigation callbacks and active rail id into PinLogic mount:
    - `onNavigateMode` (play/design route),
    - `onNavigateSection` (features/rules/state/feedback/simulator/diagnostics),
    - `activeNavId` (rail highlight state).
- Updated `app/logic/visualBuilder.js`:
  - Added callback-driven rail routing so nav items are functional.
  - Wired toolbar `Test in Simulator` to navigate to simulator section.
  - Converted rail rows to buttons and active state driven by host-provided `activeNavId`.
- Updated `app/logic/visualBuilder.css`:
  - Added button-safe styling for rail items (full width, transparent background, pointer cursor, explicit border/text alignment).
- Updated `app/editor/editor.css`:
  - Added `logic-workbench-visual` mode to collapse legacy 3-column shell to full-width main canvas.
  - Hides legacy nav/inspector and removes extra main padding in visual mode.

- **Impact after change:** PinLogic now uses the full available logic workspace, avoids duplicate nested UI chrome, and provides working in-rail navigation for top-level mode hops and logic subsections.

### Follow-up (2026-06-01)

- **User intent:** Keep non-visual logic areas within the PinLogic shell so navigation style stays consistent.
- Updated `app/logic/visualBuilder.js`:
  - Added internal `workspaceSection` handling so rail clicks (`Features`, `Rules`, `State`, `Feedback`, `Simulator`, `Diagnostics`) switch views inside PinLogic instead of requiring legacy layout.
  - Added in-shell canvas renderers for those sections:
    - feature summary grid,
    - dense rules grid,
    - combined state/computed grid,
    - lamp binding grid,
    - simulator entry panel,
    - diagnostics issue list.
  - Added lamp-binding selection/inspector support for the feedback section.
- Updated `app/logic/page.js`:
  - Added `visualWorkspaceSection` state and passed it through to PinLogic mount.
  - Updated section callback wiring so rail section changes stay inside visual mode and simply switch PinLogic subsection.
- Updated `app/logic/visualBuilder.css`:
  - Added state grid layout class for subsection rendering consistency.

- **Impact after follow-up:** Most logic navigation now remains within one cohesive PinLogic shell, with consistent rail behavior and no fallback to legacy chrome for standard subsection browsing.

### Follow-up (2026-06-01) - Simulator Access Regression Fix

- **User intent:** Restore access to simulator and check for orphaned navigation behavior.
- **Regression identified:** PinLogic rail `Simulator` switched only the visual sub-section state and did not flip `activeSection` to legacy simulator renderer, making the full simulator workspace inaccessible.
- Updated `app/logic/page.js`:
  - PinLogic `Simulator` navigation now sets `activeSection = "simulator"` so `renderTest()` is reachable again.
  - Added reset rule when returning to visual mode: if visual sub-section was `simulator`, it is normalized back to `logic` to avoid stale sub-view state.

- **Orphaned/stale behavior audit:** Found a visual-shell simulator placeholder branch (`renderSimulatorCanvas`) that is now effectively a fallback-only path; it does not block simulator access after this fix.
- **Impact after follow-up:** Simulator workspace is reachable again from PinLogic navigation, and returning to visual mode re-enters the main logic canvas predictably.

### Follow-up (2026-06-01) - Orphaned Simulator Path Cleanup

- **User intent:** Proceed with orphan cleanup after simulator restoration.
- Updated `app/logic/visualBuilder.js`:
  - Removed the in-shell `renderSimulatorCanvas` placeholder branch.
  - Updated rail routing so `Simulator` is a direct host handoff (`onNavigateSection("simulator")`) without mutating visual subsection state first.

- **Impact after follow-up:** There is now a single simulator navigation path (PinLogic rail -> legacy simulator workspace), removing ambiguous/fallback simulator behavior inside PinLogic.
## 2026-06-01 - PinLogic Visual Builder Authoring (In Progress/Complete)

### User Intent / Scope Before Change
- Move the new PinLogic editor from display-only to actual authoring.
- Keep JSON schema canonical and write through existing `logicDocument` + `features` arrays.
- Add guided build flows, role-based assignment from playfield/canvas clicks, and minimal generic rule creation.

### Changes Implemented
- `app/logic/visualBuilder.js`
  - Added canvas Build panel for guided creation:
    - `Create Switch -> Lamp`
    - `Create Target Bank + Collect`
    - `Create Drain Reset`
    - minimal `Add Rule` creation
  - Added role-mode assignment (`trigger/target/collect/drain/lamp`) and click-to-assign from playfield/canvas selections.
  - Added creation helpers that mutate only existing schema arrays:
    - `switchRegistry`, `stateTable`, `computedState`, `lampBindings`, `actionRules`, `resetRules`, `features`
  - Added effect removal in rule inspector to make created rules editable without leaving visual shell.
- `app/logic/visualBuilder.css`
  - Added styling for Build panel, role chips, summary panel, action row, and build error text.

### Impact / Notes After Change
- PinLogic now supports creating logic, not just inspecting it.
- No new persisted logic model was introduced; visual authoring writes directly into existing table schema.
- Existing unknown effect payloads remain preserved (still rendered as raw JSON when unsupported).
- Validation and projection continue to run through existing commit path after each create/edit action.

### Verification
- `npm test` passed:
  - `smoke tests ok`
  - `eval-agent smoke ok`

### Follow-up (Same Date): Feature Membership Linking
- Updated guided flow generation in `app/logic/visualBuilder.js` so created features now carry stronger membership metadata:
  - `Create Switch -> Lamp` now fills `feature.objects` from trigger source object and lamp host object when resolvable.
  - `Create Target Bank + Collect` now fills `feature.objects` from selected target/collect switch source objects and `feature.lamps` from related lamp-capable objects.
  - `Create Drain Reset` now also creates a feature row with reset-related object/state/rule membership, improving discoverability in tree/inspector.
- Verification rerun: `npm test` passed (`smoke tests ok`, `eval-agent smoke ok`).
