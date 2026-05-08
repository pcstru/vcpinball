# TBSpec (Current Runtime + Assistant Contract)

## What
This document is the authoritative current table/logic contract for:
- table JSON used by play/design/logic pages
- assistant + agentic patch generation/validation
- direct logic-document runtime execution

## Why
Assistant/agentic output is only valid when it matches the exact schema and behavior implemented in the app. This spec is intentionally implementation-shaped.

## 1) Top-Level Table Shape
`version: 1` tables are centered on:
- `name`
- `playfield`
- `rules`
- `levels`
- `features`
- `images`
- `elements`
- `logicDocument`

Expected key payloads:
- `playfield`: width/height and render-safe geometry bounds
- `rules`: `balls` and `highScoreKey`
- `features`: optional human-facing gameplay grouping metadata
- `images`: optional background/overlay image layers (`mode`: `play|design|both`)
- `elements`: physical/mechanism/lamp objects used by physics/render/logic mapping
- `logicDocument`: executable gameplay logic source

## 2) Feature Metadata (`table.features`)
`features` is editorial authoring metadata, not runtime state machine execution.
Each feature entry may include:
- `id` (string)
- `name` (string)
- `description` (string)
- `goal` (string)
- `objects` (string[])
- `states` (string[])
- `rules` (string[])
- `lamps` (string[])

## 3) Logic Source of Truth
Feature-first authoring lives in:
- `table.logicDocument`

Logic document schema (`logicVersion: 1`):
- `logicVersion: 1`
- `switchRegistry: []`
- `stateTable: []`
- `computedState: []`
- `lampBindings: []`
- `actionRules: []`
- `resetRules: []`

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
- `trigger` fields reference switch IDs, not state IDs
- `logicVersion` must be `1` when present

## 5) Supported Element Types
Current authoring/runtime element families include:
- `flipper`
- `launcher`
- `path`
- `lane`
- `dropTarget`
- `spinner`
- `gate`
- `kicker`
- `bumper`
- `scoreZone`
- `drain`
- `trough`
- `light`
- `arrowLight`
- `boxLight`
- `ramp`

## 6) Notable Element Properties
Only list fields that materially affect assistant/agentic correctness:
- `lane`: includes `x,y,w,h,angle,score,label,color,opacity`
- `trough`: includes `x,y,radius,holdSeconds,reactivateDelay,ejectPower,ejectAngle,color,pitColor,opacity`
- `drain`: includes `x,y,w,h,color`; runtime sensor marks balls drained
- lamp types use `lampId`/`color`/shape fields
- launcher runtime behavior comes from the `launcher` element

## 7) Current Mode-Specific Behavior Constraints
These are behavior constraints assistant/agentic should not violate:
- `drain` is design-visible and play-hidden
- lane/trough visual transparency is controlled via `opacity`
- play mode starts in attract/high-score state; mobile restart flow uses launch button:
  - label is `Play` between games
  - pressing `Play` arms start and changes label to `Launch`
  - `Launch` then performs staged-ball launch

## 8) Authoring Guidance for Assistant/Agentic
- Prefer feature-first logic updates with `features` + `logicDocPatch`.
- Keep edits surgical: only mutate requested fields/rows.
- Do not invent unsupported keys, effect types, or alternate logic schemas.
- Treat `table.logicDocument` as the editable logic source.
