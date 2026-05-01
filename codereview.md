# Code Review

Review date: 2026-04-30 22:51:03 +01:00

Scope: static browser pinball game at this workspace snapshot. Initial review only; remediation notes below track source changes made after the review.

Existing verification run:

- `node tests\physics.test.js`
- Result: `physics tests ok`

## Remediation Log

### 2026-04-30

- Added `Pin.table.normalizeTable()` as the canonical table-defaulting path for boot and editor table application.
- Hardened LocalStorage table loading so corrupt saved JSON is ignored instead of breaking boot.
- Extended structural validation for `rules`, `rules.balls`, `rules.highScoreKey`, and `rulesEngine` arrays.
- Made assistant patch application transactional: failed operations now restore the original table and undo stack length.
- Fixed assistant patch validation reporting to consume the array returned by `Pin.rules.validate()`.
- Added a regression assertion that sparse normalized tables pass structural validation with runtime defaults.
- Runtime rules now compile graph-backed rules into a local evaluation list instead of rewriting `rulesEngine.sequenceRules` during play/validation.
- Added a minimal `package.json` with `npm test`.
- Collapsed the duplicate `physics-lab.html` README entry and marked `DS-Pinballv2.html` as legacy/reference.
- Removed confirmed orphan rule/logic helper copies from `app/editor/editor.js`; active implementations remain in `app/editor/rulesLogic.js`.
- `Pin.elements.mergeRuntimes()` now supports a reusable target runtime and is used by the play loop.
- README now documents `valve` as a legacy/loadable mechanism and directs new designs to `gate`.
- Added a dependency-free static smoke test for `index.html` script existence/order and `tables/DefTable.json` normalization.
- `npm test` now runs `tests/run-all.js`, which executes smoke and physics tests without shell-specific command chaining.
- Verification: `node --check app\table.js`, `node --check app\storage.js`, `node --check app\editor\session.js`, `node --check app\editor\rulesLogic.js`, `node --check app\rules.js`, `node --check app\editor\editor.js`, `node --check app\elements\index.js`, `node --check app\main.js`, `node --check tests\smoke.test.js`, `node --check tests\run-all.js`, `node --check tests\physics.test.js`, `node tests\physics.test.js`, and `npm test`.

## Executive View

The game has good bones: the physics/rules split is real, there is a usable editor model, runtime elements are compiled through a registry, and the physics test file is not token garnish. For something grown progressively, that is no small mercy.

That said, the codebase is still balanced on a few wobbly bar stools. The main risks are not "the flipper feels off" problems; they are data-contract and state-management problems. A bad saved table, a half-applied assistant patch, or drift between logic graphs and sequence rules can turn a good table into a confusing failure with very little diagnostic help.

## Findings

### High: saved or imported malformed tables can break boot/editor flows

Status: remediated 2026-04-30. `Pin.storage.local.load()` now catches corrupt JSON, `Pin.table.normalizeTable()` fills defaults/migrates legacy-shaped input, and editor/boot table application pass through normalization.

`Pin.storage.local.load()` parses saved JSON without a catch, and `main.loadInitialTable()` calls it before falling back to the bundled table. If LocalStorage contains invalid JSON, boot can reject before the fallback path is reached.

Evidence:

- `app/storage.js:7-10` directly calls `JSON.parse(raw)`.
- `app/main.js:447-460` only catches the network/default-table fetch path, not LocalStorage parse failures.
- `app/editor/editor.js:1238-1266` loads autosave/slot tables and applies them without validation or migration.
- `app/editor/editor.js:1249-1254` imports arbitrary JSON and applies it directly.

Impact: one corrupt autosave, manual LocalStorage edit, or malformed imported file can strand the app or editor. A pinball table editor should treat user-authored files as suspicious until normalized.

Recommendation: make table loading a single safe path: parse, migrate if needed, validate core fields, normalize missing defaults, then either apply or show a recoverable error.

### High: table validation misses runtime-required fields

Status: remediated 2026-04-30. `validateTable()` now checks `rules`, positive `rules.balls`, `rules.highScoreKey`, and the required `rulesEngine` arrays. `normalizeTable()` supplies those values before runtime/editor use.

`validateTable()` checks `version`, `name`, `playfield`, `levels`, `images`, and `elements`, but it does not validate `rules` or `rules.balls`. Runtime code assumes those fields exist.

Evidence:

- `app/table.js:125-201` has no `rules` validation.
- `app/main.js:52-53` reads `table.rules.balls` when creating a world.
- `app/render.js:207` reads `world.table.rules.balls` for the HUD.

Impact: a table can pass validation but still crash in play mode. That is the worst sort of validation: it looks stern, then lets the drunk through the door.

Recommendation: validate and normalize `rules`, `rules.balls`, `rules.highScoreKey`, and `rulesEngine` in the same place as the other table invariants.

### High: assistant patch application is not transactional

Status: remediated 2026-04-30. `applyAssistantPatch()` now snapshots the table and undo length, restores both on any failed operation, and refreshes without committing a partial mutation.

`applyAssistantPatch()` calls `pushUndo()` once, then mutates the table operation by operation. If a later operation fails, earlier operations remain applied even though the function returns `{ ok: false }`.

Evidence:

- `app/editor/rulesLogic.js:541-548` starts processing after pushing undo.
- Failure returns occur inside the mutation loop, for example `app/editor/rulesLogic.js:565-617`.
- There is no rollback to the undo snapshot on failure.

Impact: the Assistant UI can report a failed patch while leaving partial table edits behind. That will make authors distrust the tool and will create some beautifully cursed rule states.

Recommendation: pre-validate every operation before mutation, or apply against a cloned table and commit only if the whole patch succeeds.

### High: assistant patch validation reporting is broken

Status: remediated 2026-04-30. The assistant patch result now treats `Pin.rules.validate()` as an issues array and reports "with validation issues" only when that array is non-empty.

`applyAssistantPatch()` treats `Pin.rules.validate()` as if it returns `{ ok, issues }`, but `Pin.rules.validate()` returns the issues array directly.

Evidence:

- `app/rules.js:246-320` returns `issues`.
- `app/editor/rulesLogic.js:630-634` checks `validation.ok` and `validation.issues`.

Impact: successful assistant patches will be reported as "with validation issues" because `validation.ok` is undefined, and the actual issues are dropped because `validation.issues` is also undefined.

Recommendation: either change the call site to treat the return as an array, or change `Pin.rules.validate()` to return a consistent object and update all callers.

### Medium: logic graph and sequence rule synchronization has source-of-truth risk

Status: partially remediated 2026-04-30. Runtime processing and validation no longer call `syncRuleGraphs()` and therefore no longer rewrite `sequenceRules` as a side effect. Editor/save flows still intentionally sync graphs and rules, so the remaining decision is whether to make that boundary more explicit in the UI/documentation.

The rules model has two representations: `sequenceRules` and `logicGraphs`. Several code paths compile graphs back into sequence rules, and `syncRuleGraphs()` replaces `config.sequenceRules` wholesale from the graph list.

Evidence:

- `app/ruleGraph.js:390-404` rebuilds `sequenceRules` from `logicGraphs`.
- `app/rules.js:213-217` may sync graphs during runtime rule processing.
- `app/editor/model.js:232-240` syncs graphs while ensuring the rules engine.

Impact: if either representation is stale, incomplete, or partially edited, the other can be overwritten. That is a classic two-ledgers problem: sooner or later the books disagree, and then the accountant gets blamed.

Recommendation: make one representation canonical. If `logicGraphs` are canonical in the editor, compile to `sequenceRules` only at explicit save/play boundaries. If `sequenceRules` are canonical at runtime, do not mutate them during rule processing.

### Medium: runtime recompiles dynamic elements every fixed tick

The fixed loop refreshes the dynamic runtime before every physics step. Static broad phase work is sensibly cached, but dynamic compile still allocates and rebuilds arrays continuously.

Evidence:

- `app/main.js:350-357` calls `refreshRuntime(world)` inside the fixed-step loop.
- `app/main.js:79-108` recompiles dynamic elements and repopulates runtime arrays.
- `app/elements/index.js:40-58` recompiles all matching elements for the requested pass.

Impact: this may be fine for current tables, but it is the first place I would expect frame-time spikes as tables get more dynamic mechanisms, lamps, gates, launchers, and editor-test-play usage.

Recommendation: profile before changing it. If it shows up, separate "dynamic geometry that moves every tick" from "dynamic-ish state that only changes on edit/control".

### Medium: test coverage is strong in one place, thin everywhere else

Status: partially remediated 2026-04-30. Added `package.json` with `npm test`, extended the existing Node suite for table normalization and non-mutating graph-backed runtime processing, and added a dependency-free static smoke test for the hosted entrypoint/default table. Full browser/editor smoke coverage remains open.

`tests/physics.test.js` covers physics, drains, troughs, rules, and several regression cases. That is genuinely useful. But there is no visible package script, no CI config, and no browser/editor smoke test.

Evidence:

- `tests/physics.test.js` exists and passes under Node.
- No `package.json` or CI config was present in the reviewed file list.
- UI-heavy paths such as import/open/save, assistant patch apply, hash boot, and editor mounting are not covered by an automated browser smoke test.

Impact: the riskiest bugs in this app are now integration bugs, not isolated physics math bugs. The test suite is proving the engine bits, but not enough of the table lifecycle around them.

Recommendation: add a tiny test runner script first, then a browser smoke test that opens `index.html`, verifies play boot, switches to design, imports a table, and returns to play.

### Low: browser globals and script order are now an architectural tax

Status: partially remediated 2026-04-30. The architecture is still browser-global/script-order based, but `tests/smoke.test.js` now checks that every `index.html` script exists and that `app/main.js` remains the final bootstrap script.

Everything hangs from `window.Pin`, with `index.html` loading scripts in dependency order. That is workable for a small static app, but this is no longer small.

Evidence:

- `index.html:12-65` defines `window.Pin` and loads every module manually.
- Modules communicate by mutating `Pin.*` namespaces.

Impact: refactors are fragile, missing scripts fail at runtime, and tests need a custom VM loader that mirrors the browser load order.

Recommendation: keep the no-build deployment if that matters, but consider native ES modules. You can still serve static files while gaining explicit imports and better failure modes.

### Low: legacy/demo surface may confuse future maintenance

Status: remediated 2026-04-30. README now marks `DS-Pinballv2.html` as a legacy/reference standalone prototype rather than the active app surface.

`DS-Pinballv2.html` appears to be a standalone older game beside the current app. It may be useful as reference, but it is not clearly marked as legacy or excluded from active maintenance.

Impact: future fixes may land in the wrong surface, or reviewers may waste time comparing behavior that is no longer meant to match.

Recommendation: mark it explicitly as legacy/reference in the README or move it under a clearly named archive/reference directory.

## Redundancy And Orphans

There is some redundant and probably orphaned code, but it is not everywhere. The mess is concentrated around old compatibility paths and editor code that was partly extracted into smaller modules.

### Medium: extracted editor logic left unused copies behind

Status: remediated 2026-04-30. Removed the unused `editor.js` copies of `syncRulesFromGraphs`, `rebuildGraphsFromRules`, `normalizeRuleValue`, and `graphNodePosition`; the active implementations remain in `rulesLogic.js`.

`app/editor/editor.js` still defines several rule/logic helper functions that appear to have been moved into `app/editor/rulesLogic.js`. Search evidence shows definitions in `editor.js` but no local call sites for:

- `syncRulesFromGraphs`
- `rebuildGraphsFromRules`
- `normalizeRuleValue`
- `graphNodePosition`

The corresponding active versions exist in `app/editor/rulesLogic.js` and are called there. This is proper orphan territory: not fatal, but it is the sort of old rope that makes future changes snag.

Recommendation: delete the unused `editor.js` copies after one browser smoke test of the Logic tab.

### Medium: legacy migration exists but is not wired into loading

Status: remediated 2026-04-30. `Pin.table.normalizeTable()` now calls `migrateLegacyToV1()` for non-v1 input, and boot/editor table application route through normalization.

`app/table.js` exports `migrateLegacyToV1()`, and the README describes table helpers as including legacy migration. I found no in-repo caller. Meanwhile the actual load/import paths apply parsed tables directly or only validate strict `version: 1` tables.

Impact: this is not merely redundant. It means the project advertises a migration story while the runtime does not consistently use it. Old tables may either fail validation or be applied raw in the editor.

Recommendation: either wire migration into every table entry point, or remove/rename it until there is a real migration path.

### Low: exported runtime helpers with no visible callers

Status: remediated 2026-04-30. `Pin.elements.mergeRuntimes()` now supports a reusable target and `main.refreshRuntime()` uses it.

`Pin.elements.mergeRuntimes()` is exported from `app/elements/index.js`, but the app currently hand-merges runtimes inside `app/main.js`. I found no in-repo caller of the exported helper.

Impact: small, but it creates doubt about which runtime-merge path is canonical.

Recommendation: either use the helper from `main.js` or keep it private/remove it.

### Low: `valve` is a half-retired mechanism

Status: remediated 2026-04-30 by documentation. `TBSpec.MD` already tells agents not to generate new valves, and README now marks `valve` as legacy/loadable while directing new table work to `gate`.

The assistant contract says `valve` is legacy/loadable and new edits should prefer `gate`. The code still loads `app/elements/valve.js`, includes valve hit testing, has a default valve model, and has palette icon support. At the same time, the main palette tool list omits `valve`, so it sits in a limbo state: not first-class, not gone.

Impact: future authors will not know whether to fix valve bugs, migrate valves to gates, or ignore them.

Recommendation: document it as supported legacy, add a migration to `gate`, or remove the dead editor affordances.

### Low: utility duplication is mild but real

There are repeated local `clone()` helpers in several modules, plus similar `applyNormalizedPatch()` implementations in `app/editor/actions.js` and `app/editor/rulesLogic.js`. The duplication is not currently dangerous, but it makes assistant/editor patch behavior easier to diverge by accident.

Recommendation: only consolidate the patch helper if you touch assistant/editor patching anyway. This is cleanup, not a fire.

### Low: documentation has stale duplicate entries

Status: remediated 2026-04-30. README now has a single `physics-lab.html` entry.

The README lists `physics-lab.html` twice in the file list with slightly different descriptions. That is minor, but it is exactly how docs start growing barnacles.

Recommendation: collapse the duplicate entry and add an explicit note for `DS-Pinballv2.html` if it is intentionally retained as reference.

## Strengths Worth Keeping

- The element registry is a good shape for a pinball table editor. `app/elements/index.js` gives the project a clear extension point.
- Static/dynamic runtime separation is the right instinct. The broad-phase cache for static colliders is a good performance foundation.
- The physics tests are meaningful. They cover behavior rather than just checking that functions exist.
- The assistant is not allowed to mutate tables directly from prose; it emits structured patches and requires an explicit apply. The apply path needs hardening, but the product shape is right.
- The README is unusually current for this kind of project and explains table JSON, rules, lamps, ramps, storage, and controls.

## Suggested Priority

1. Harden table load/import validation and defaults.
2. Make assistant patch apply transactional and fix validation result handling.
3. Decide the canonical rules representation and stop runtime/editor sync from surprising authors.
4. Add a small browser smoke test around boot, design mode, import/export, and test play.
5. Remove confirmed editor orphans and mark legacy/reference files explicitly.
6. Profile dynamic runtime rebuilds only after the data-contract issues are handled.

## Bottom Line

The core game looks healthier than the "vibe coded" warning label suggests. The danger is not that the thing lacks structure; it has structure. The danger is that several structures overlap without a single hard contract. Tighten table normalization, make assistant edits atomic, and stop the rules graph from quietly rewriting the rule book, and this becomes a much sturdier machine.
