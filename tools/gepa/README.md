# GEPA Prompt Optimization Harness

What: offline harness for evolving the assistant patch-generation prompt.
Why: schema misunderstandings should be reduced by repeatable prompt evaluation before considering fine-tuning or changing production code.

GEPA is useful here because the project already emits actionable feedback: contract issues, logic/table validation issues, and table-eval failures. The optimizer can mutate only the prompt text while `tools/eval-agent.js` keeps the patch contract and physics/evaluation runtime fixed.

## Workflow

1. Collect JSONL cases with `table` and `task` fields.
2. Run GEPA against `tools/gepa/assistant-patch-seed.txt`.
3. Review the optimized prompt text and GEPA logs.
4. Manually port useful instruction changes into `app/aiPromptContract.js`.
5. Run `npm test` before using the changed prompt in the browser assistant.

Example:

```powershell
python -m pip install gepa
Copy-Item .env.example .env
# Edit `.env` with your real provider values. Yes, the key belongs there.
python tools/gepa-prompt-optimizer.py --cases tools/gepa/cases.example.jsonl --reflection-lm local --max-metric-calls 20 --out tools/gepa/optimized-assistant-prompt.txt --viz-run tools/gepa/runs/latest-viz-run.json
```

The target model is read by `eval-agent` from `PIN_AI_*`. The reflection model is passed to GEPA with `--reflection-lm`.

`tools/RunGepa.template.ps1` is the committed template. Copy it to the ignored local launcher before first use:

```powershell
Copy-Item tools/RunGepa.template.ps1 tools/RunGepa.ps1
```

`tools/RunGepa.ps1` loads `.env`, then supports separate target and reflection providers:

- `PIN_AI_BASE_URL`, `PIN_AI_API_KEY`, `PIN_AI_MODEL`: target patch-generation model evaluated by `eval-agent`.
- `PIN_REFLECTION_BASE_URL`, `PIN_REFLECTION_API_KEY`, `PIN_REFLECTION_MODEL`: GEPA reflection/proposal model.

If `PIN_REFLECTION_*` values are absent, `RunGepa.ps1` falls back to `PIN_AI_*`.

`RunGepa.ps1` writes each optimizer run to a timestamped directory under `tools/gepa/runs/`. This avoids GEPA resuming an older incompatible `gepa_state.bin` after harness or frontier-setting changes. The visualizer serves the stable copy at `tools/gepa/runs/latest-viz-run.json`.

The committed launcher defaults are intentionally cheap and specific:

- cases: `tools/gepa/cases.a_targ_grpb.jsonl`
- target task: wire `A-Targ` Group B drop targets to light on hit and reset on drain
- evaluation profile: fast logic/schema checks, not the expensive ray/reachability gauntlet

OpenRouter reflection example:

```powershell
PIN_AI_BASE_URL=http://0.0.0.0:8082
PIN_AI_API_KEY=NA
PIN_AI_MODEL=Qwen2.5.1-Coder-7B-Instruct-Q6_K_L
PIN_REFLECTION_BASE_URL=https://openrouter.ai/api/v1
PIN_REFLECTION_API_KEY=sk-or-...
PIN_REFLECTION_MODEL=anthropic/claude-3.5-sonnet
```

Put those values in `.env`, then run:

```powershell
.\tools\RunGepa.ps1
```

## Visual Feedback

`--viz-run` enables the optional `gepa-viz` callback. It writes a live run file that shows accepted candidates, rejected proposals, prompt diffs, per-case feedback, and the Pareto frontier.

Run the optimizer in one terminal:

```powershell
npm run gepa-prompt -- --reflection-lm local --max-metric-calls 20 --viz-run tools/gepa/runs/latest-viz-run.json
```

Serve the visualizer in another terminal:

```powershell
npm run gepa-viz
```

This opens `http://127.0.0.1:5151` when `gepa-viz` is installed with its browser bundle. `gepa-viz` is not currently published on PyPI, so installing only the GitHub `python/` package can leave the static browser bundle missing. If `npm run gepa-viz` warns that the bundle is missing, build it in the `gepa-viz` source repo, not in this Pinball repo:

```powershell
git clone https://github.com/modaic-ai/gepa-viz.git C:\tmp\gepa-viz
cd C:\tmp\gepa-viz
just install
just build
python -m pip install --force-reinstall .\python
```

`just install` and `just build` use `uv` in the upstream repo, so you need `git`, `node`, `npm`, `uv`, and `just` for that source-build path. If you only care about the optimizer, omit `--viz-run` and skip this entire dependency side quest.

Keep this offline. Do not automatically overwrite `app/aiPromptContract.js` from a GEPA result; the optimized text still needs human review for overfitting, accidental schema weakening, and cost/latency tradeoffs.
