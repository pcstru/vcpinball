# TBSpec (Current Runtime + Assistant Contract)

## What
This document is the authoritative table/logic contract for:
- table JSON used by play/design/logic pages
- assistant + agentic patch generation/validation
- runtime-compatible logic compilation

## Why
Assistant/agentic output is only valid when it matches the exact schema and behavior implemented in the app. This spec is intentionally implementation-shaped.

## 1) Top-Level Table Shape
`version: 1` tables are centered on:
- `name`
- `playfield`
- `rules`
- `launcher` (legacy compatibility mirror of launcher element)
- `levels`
- `features`
- `images`
- `elements`
- `rulesEngine`

Expected key payloads:
- `playfield`: width/height and render-safe geometry bounds
- `rules`: at least balls/highScoreKey compatible values
- `features`: optional human-facing gameplay grouping metadata
- `images`: optional background/overlay image layers (`mode`: `play|design|both`)
- `elements`: physical/mechanism/lamp objects used by physics/render/logic mapping
- `rulesEngine`: compiled runtime logic + embedded authoring source document

## 2) Feature Metadata (`table.features`)
`features` is editorial authoring metadata (not runtime state machine execution).  
Each feature entry may include:
- `id` (string)
- `name` (string)
- `description` (string)
- `goal` (string)
- `objects` (string[])
- `states` (string[])
- `rules` (string[])
- `lamps` (string[])
- `parts` (string[], legacy compatibility)

## 3) Logic Source of Truth
Feature-first authoring lives in:
- `table.rulesEngine.logicGraphs.logicDocument`

Logic document schema (`logicVersion: 1`):
- `logicVersion: 1`
- `switchRegistry: []`
- `stateTable: []`
- `computedState: []`
- `lampBindings: []`
- `actionRules: []`
- `resetRules: []`

Compiled compatibility payloads still exist under `rulesEngine`:
- `switchMap`
- `sequenceRules` (kept for compatibility, typically empty from new logic flow)
- `triggers`
- `variables`
- `logicGraphs.logicDocument` (source document round-trip)

## 4) Assistant/Agentic Patch Contract
Patch object may only use these top-level keys:
- `tablePatch`
- `addElements`
- `patchElements`
- `removeElements`
- `addFeatures`
- `patchFeatures`
- `removeFeatures`
- `logicDocPatch`

`logicDocPatch` may only include:
- `logicVersion`
- `switchRegistry`
- `stateTable`
- `computedState`
- `lampBindings`
- `actionRules`
- `resetRules`

Strict logic row rules:
- `lampBindings` rows: `{ lampId, expr }`
- `actionRules` rows: `{ id, trigger, condition, effects, enabled }`
- action `effects` rows: `{ type, target?, value? }`
- allowed effect `type`: `set|add|score|reset|setElementProperty|clearElementProperty`
- `resetRules` rows: `{ id, trigger, scope, resets }`
- `trigger` fields reference switch IDs (not state IDs)
- `logicVersion` must be `1` when present

## 5) Supported Element Types (Current)
Current authoring/runtime element families include:
- `flipper`
- `launcher`
- `path`
- `lane`
- `dropTarget`
- `spinner`
- `gate` (`valve` is legacy/loadable compatibility alias)
- `kicker`
- `bumper`
- `scoreZone`
- `drain`
- `trough`
- `light`
- `arrowLight`
- `boxLight`
- `ramp`

## 6) Notable Current Element Properties
Only list fields that materially affect assistant/agentic correctness:
- `lane`: includes `x,y,w,h,angle,score,label,color,opacity`
- `trough`: includes `x,y,radius,holdSeconds,reactivateDelay,ejectPower,ejectAngle,color,pitColor,opacity`
- `drain`: includes `x,y,w,h,color`; runtime sensor marks balls drained
- lamp types use `lampId`/`color`/shape fields
- launcher runtime behavior comes from launcher element + synced `table.launcher` compatibility fields

## 7) Current Mode-Specific Behavior Constraints
These are behavior constraints assistant/agentic should not violate:
- `drain` is design-visible and play-hidden (render suppression in play mode)
- lane/trough visual transparency is controlled via `opacity`
- play mode starts in attract/high-score state; mobile restart flow uses launch button:
  - label is `Play` between games
  - pressing `Play` arms start and changes label to `Launch`
  - `Launch` then performs staged-ball launch

## 8) Authoring Guidance for Assistant/Agentic
- Prefer feature-first logic updates (`features` + `logicDocPatch`) over legacy trigger prose.
- Keep edits surgical: only mutate requested fields/rows.
- Do not invent unsupported keys, effect types, or alternate logic schemas.
- Treat `rulesEngine.logicGraphs.logicDocument` as the editable logic source.
