# Change Log

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
