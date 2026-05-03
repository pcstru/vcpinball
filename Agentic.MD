# Agentic Assistant Design (v1)

## Summary
Add a new Assistant subtab named `Agentic` for multi-step, tool-driven table editing that can perform CRUD on table objects and logic with stronger orchestration than the existing chat flow.

The Agentic mode builds on the current assistant runtime, patch schema, validation pipeline, and undo model. It introduces explicit execution controls so authors can choose between:
- fully automatic application of validated changes
- per-change approval before apply

v1 scope is table objects plus table logic. It does not include editor settings management, raw file operations, or arbitrary non-table workflows.

## Goals
- Improve reliability for multi-step tasks that require iterative lookup, resolve, and edit.
- Keep mutation safety tied to the existing structured patch + validation contract.
- Preserve current Assistant Chat behavior while adding an advanced agentic path.
- Enable smaller/cheaper models by constraining context shape and tool outputs.

## Non-Goals (v1)
- Replacing the existing Chat subtab.
- Direct free-form table mutation outside structured patch operations.
- Autonomous editing of local files outside table state.
- Background long-running jobs across browser sessions.

## UX Surface
- Assistant subtabs become: `Chat`, `Agentic`, `Provider`.
- Agentic subtab includes:
  - conversation area
  - execution log/audit stream
  - pending/applied patch batches
  - controls:
    - `Fully Auto` (checkbox)
    - `Approve Each Batch` (checkbox)
    - `Run` / `Stop`
    - `Apply Pending` / `Reject Pending`
    - `Rollback Last` (reuse undo)

### Execution Modes
- If `Fully Auto = true` and `Approve Each Batch = false`:
  - only preview-clean patch batches (preview succeeds and projected issues = 0) are applied automatically.
  - if preview fails or projected issues are non-zero, the batch is parked as pending manual apply.
- If `Approve Each Batch = true`:
  - every mutation batch pauses for explicit user approval.
- If both are false:
  - agent may plan and prepare patch batches, but apply remains manual (review flow).

`Approve Each Batch` takes precedence over `Fully Auto` when both are enabled.

## Architecture

### Reuse Existing Components
- Provider settings and model selection from the current Assistant runtime.
- Existing table query tools (`get_table_summary`, `get_selected_context`, `list_elements`, `get_element`, `list_rules`, `get_rule`, `get_validation_issues`).
- Existing patch schema and allowed operations.
- Existing patch executor (`applyAssistantPatch`) and rollback/undo.
- Existing rule/table validation.

### New Runtime Layer
Add an Agentic controller (logical module) that manages a bounded multi-step loop:
1. inspect context
2. plan next action
3. call read tools
4. produce patch batch
5. validate
6. apply or request approval
7. re-check and continue/finish

This layer does not bypass structured patches. All mutations still flow through patch validation and apply.

### Suggested State Additions
- `assistant.agentic`:
  - `enabled`/tab state
  - `mode`: auto vs approve
  - `running`: bool
  - `currentTaskPlan`: short plan text + steps
  - `batches`: list of proposed/applied/rejected patch batches
  - `auditLog`: compact per-step records
  - `stopRequested`: bool

## CRUD Contract (v1)
Agentic mutations must be expressed only through supported operations:
- `addElements`
- `patchElements`
- `addSequenceRule`, `updateSequenceRule`, `deleteSequenceRule`
- `addSwitchMap`, `updateSwitchMap`, `deleteSwitchMap`
- `addVariable`, `updateVariable`, `deleteVariable`
- `addTrigger`, `updateTrigger`, `deleteTrigger`
- layout ops when relevant (`alignHorizontal`, `distributeHorizontal`, `matchWidth`, `matchHeight`)

No other write path is permitted.

## Agent Loop Specification

### Stage 1: Task Plan
- Produce a concise plan before mutation.
- Plan lists target ids, intended operations, and completion criteria.

### Stage 2: Resolve & Inspect
- Use read tools to resolve ids and inspect exact element/rule shapes.
- Prefer compact listings; fetch full object payload only when needed.

### Stage 3: Build Batch
- Generate one bounded patch batch at a time.
- Batch should be coherent and reversible.
- Use stable ids; avoid speculative creations.
- For per-object staged progression (example: one switch/object advancing several stage lamps), prefer one ordered sequence rule with repeated step IDs and aligned `stepLampIds` rather than multiple one-step stage rules.
- When building lamp actions, target canonical lamp ids: use `lampId` where defined; only use element ids for lights that do not define `lampId`.

### Stage 4: Validate
- Run table/rules validation before apply.
- Run pre-apply patch preview against a cloned table and show projected issue count in batch cards.
- If validation fails:
  - revise batch or stop with explicit blocker.

### Stage 5: Apply / Approve
- Auto mode: apply batch after validation.
- Approval mode: present diff summary + wait for user acceptance.

### Stage 6: Verify
- Re-read impacted entities and check success criteria.
- Continue loop only if remaining tasks exist.

### Stage 7: Finish
- Emit a concise completion summary with:
  - applied batches
  - warnings/issues
  - rollback hint

## Safety Rules
- Never mutate outside structured patches.
- Never apply unvalidated mutation batches.
- Keep each batch small enough for rollback clarity.
- On apply failure, stop and report exact failed operation.
- Keep an explicit audit trail of step -> tool call -> patch -> outcome.
- Respect stop/cancel immediately between loop steps.

## Context Strategy (for Smaller Models)
- Start each step from compact summaries, not full table dumps.
- Include only:
  - active selection
  - relevant nearby/resolved ids
  - impacted rules/variables/triggers
  - recent batch outcomes
- Avoid replaying full conversation history every step.
- Persist minimal structured memory for task state (target ids, unresolved blockers, finished subgoals).

## Implementation Notes
- Add `Agentic` tab wiring in the inspector panel tab list.
- Add event handlers in editor runtime for agentic run/stop/approve/apply.
- Extend assistant runtime with an agentic controller function set while preserving existing chat send flow.
- Reuse existing patch summarizer for human review cards.
- Keep provider/model settings shared across Chat and Agentic to avoid duplicate config state.

## Testing Plan

### Unit/Runtime
- Agentic loop can:
  - inspect -> generate batch -> validate -> apply in auto mode
  - inspect -> generate batch -> wait approval in approval mode
- Validation failures do not mutate table.
- Apply failures stop loop and preserve audit details.
- Stop signal halts further mutation.

### Integration
- Existing Chat subtab behavior unchanged.
- Undo/Rollback works after agentic applies.
- Patch summary matches applied batch content.

### Scenarios
- Add lights and wire sequence rule/actions.
- Progressive bumper scoring with conditions/variables.
- Update + delete + recreate mixed CRUD in multiple batches.
- Ambiguous id resolution produces blocker instead of unsafe mutation.

## Open Questions for v2
- Optional dry-run mode with projected validation outcome only.
- Batch diff visualization improvements.
- Split-model pipeline (small model for inspect/resolve, larger model for patch synthesis).
- Persisted task sessions between reloads.
