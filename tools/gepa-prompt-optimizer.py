"""
What: Optimize the Pinball assistant prompt with GEPA against the real patch
validation pipeline.
Why: When the model invents IDs, mangles schema, or generally behaves like it
skimmed the contract while on a moving bus, we want a repeatable way to improve
the prompt instead of cargo-culting another sentence into it by hand.

This script deliberately does not auto-edit production prompt code. It writes an
optimized candidate to disk so a human can review it before it graduates into
app/aiPromptContract.js and starts causing problems in a more public venue.
"""

from __future__ import annotations

import argparse
import json
import os
import subprocess
import sys
import tempfile
import urllib.error
import urllib.request
from pathlib import Path
from typing import Any


ROOT = Path(__file__).resolve().parents[1]

STATIC_EVAL_CHECKS = [
    "table_validation",
    "playability_validation",
    "ids_and_types",
    "numeric_fields",
    "bounds",
    "compilation",
]
EXPENSIVE_EVAL_CHECKS = [
    "launcher_rays",
    "flipper_reachability",
    "target_to_flipper_reachability",
    "reachability_todo",
]
EVAL_CHECK_PROFILES = {
    "static": STATIC_EVAL_CHECKS,
    "full": STATIC_EVAL_CHECKS + EXPENSIVE_EVAL_CHECKS,
    "schema_only": ["table_validation", "ids_and_types", "numeric_fields", "bounds"],
    "logic_fast": STATIC_EVAL_CHECKS,
}


def log_line(message: str) -> None:
    """Write one diagnostic line to stdout without pretending to be a logging framework."""
    print(message, flush=True)


def shorten(text: str, limit: int) -> str:
    """Trim noisy text for console diagnostics."""
    text = str(text or "").strip().replace("\r", " ").replace("\n", " ")
    if len(text) <= limit:
        return text
    return text[: max(0, limit - 3)] + "..."


def summarize_failed_checks(result: dict[str, Any]) -> str:
    """Build a short failed-check summary for console output."""
    checks = ((result.get("evalReport") or {}).get("checks") or [])
    failed = [check.get("id", "?") for check in checks if check.get("status") == "fail"]
    if not failed:
        return "none"
    return ",".join(failed[:4]) + (",..." if len(failed) > 4 else "")


def describe_eval_checks(eval_checks: list[str] | None) -> str:
    """Describe the active eval-check set for human beings reading the console."""
    if eval_checks is None:
        return "all eval-agent default checks"
    if not eval_checks:
        return "no eval checks"
    return ", ".join(eval_checks)


def log_run_configuration(args: argparse.Namespace, cases: list[dict[str, Any]], eval_checks: list[str] | None) -> None:
    """
    Emit one concise startup summary.

    People running prompt optimization need to know what is being optimized,
    which model is doing reflection, and whether the expensive probe cannon is
    currently pointed at their machine.
    """
    reflection_base_url = args.reflection_base_url or os.environ.get("PIN_REFLECTION_BASE_URL") or os.environ.get("PIN_AI_BASE_URL", "")
    reflection_model = args.reflection_model or os.environ.get("PIN_REFLECTION_MODEL") or os.environ.get("PIN_AI_MODEL", "")
    log_line(f"[gepa] cases={len(cases)} max_metric_calls={args.max_metric_calls} prompt_eval_steps={args.prompt_eval_steps}")
    log_line(f"[gepa] eval_checks={describe_eval_checks(eval_checks)}")
    log_line(f"[gepa] target_model={os.environ.get('PIN_AI_MODEL', '')} target_base={os.environ.get('PIN_AI_BASE_URL', '')}")
    if args.reflection_lm == "local":
        log_line(f"[gepa] reflection_model={reflection_model} reflection_base={reflection_base_url}")
    else:
        log_line(f"[gepa] reflection_lm={args.reflection_lm}")


def log_case_result(case: dict[str, Any], result: dict[str, Any]) -> None:
    """Emit one compact per-case result line."""
    task = shorten(case.get("task", ""), 72)
    contract_count = len(result.get("contractIssues") or [])
    validation_count = len(result.get("validationIssues") or [])
    failed_checks = summarize_failed_checks(result)
    attempt = result.get("attempt")
    accepted = bool(result.get("accepted"))
    score = float(result.get("score") or 0)
    parts = [
        f"table={case.get('table', '')}",
        f"attempt={attempt if attempt is not None else 'n/a'}",
        f"accepted={accepted}",
        f"score={score:.4f}",
        f"contract={contract_count}",
        f"validation={validation_count}",
        f"failed_checks={failed_checks}",
        f"task=\"{task}\"",
    ]
    log_line("[prompt-eval] " + " | ".join(parts))
    if contract_count:
        log_line("[prompt-eval] contract_issue=" + shorten((result.get("contractIssues") or [""])[0], 180))
    if validation_count:
        first_issue = (result.get("validationIssues") or [{}])[0]
        log_line("[prompt-eval] validation_issue=" + shorten(first_issue.get("message", ""), 180))
    stderr = shorten(result.get("stderr", ""), 220)
    if stderr:
        log_line("[prompt-eval] stderr=" + stderr)


def read_cases(path: Path) -> list[dict[str, Any]]:
    """Load prompt-evaluation cases from JSONL."""
    cases: list[dict[str, Any]] = []
    with path.open("r", encoding="utf-8") as handle:
        for line_number, line in enumerate(handle, 1):
            stripped = line.strip()
            if not stripped:
                continue
            case = json.loads(stripped)
            if not isinstance(case.get("table"), str) or not isinstance(case.get("task"), str):
                raise ValueError(f"{path}:{line_number} must contain string table and task fields")
            cases.append(case)
    if not cases:
        raise ValueError(f"{path} did not contain any cases")
    return cases


def import_gepa() -> tuple[Any, Any]:
    """Import GEPA's current optimizer API with an explicit setup error."""
    try:
        from gepa import optimize
        from gepa.core.adapter import EvaluationBatch
    except Exception as exc:  # pragma: no cover - depends on optional external package.
        raise SystemExit(
            "GEPA is not importable. Install it with `python -m pip install gepa` "
            "or `python -m pip install git+https://github.com/gepa-ai/gepa.git`."
        ) from exc
    return optimize, EvaluationBatch


def build_viz_callbacks(path: Path | None, cases: list[dict[str, Any]]) -> list[Any]:
    """
    Create optional GEPA visualization callbacks.

    The dependency is imported only when requested so normal prompt optimization
    stays usable in plain GEPA environments. The callback writes a live JSON file
    consumed by `gepa-viz serve`.
    """
    if path is None:
        return []
    try:
        from gepa_viz import GepaVizCallback
    except Exception as exc:  # pragma: no cover - depends on optional external package.
        raise SystemExit(
            "gepa-viz is not importable. It is not currently published on PyPI. "
            "Install it from GitHub with "
            "`python -m pip install \"git+https://github.com/modaic-ai/gepa-viz.git#subdirectory=python\"`, "
            "or omit --viz-run."
        ) from exc
    path.parent.mkdir(parents=True, exist_ok=True)
    return [GepaVizCallback(valset=cases, trainset=cases, path=str(path))]


def run_prompt_eval(candidate: str, case: dict[str, Any], max_steps: int, eval_checks: list[str] | None) -> dict[str, Any]:
    """
    Evaluate one prompt candidate through the Node runtime.

    The temporary file makes subprocess quoting predictable on Windows and keeps
    the candidate text visible to eval-agent exactly as GEPA proposed it. This
    also keeps the expensive-vs-cheap eval choice outside GEPA itself, where it
    belongs; GEPA is here to mutate prompts, not to decide whether your laptop
    should become a space heater.
    """
    table_path = Path(case["table"])
    if not table_path.is_absolute():
        table_path = ROOT / table_path
    with tempfile.NamedTemporaryFile("w", encoding="utf-8", suffix=".txt", delete=False) as handle:
        handle.write(candidate)
        candidate_path = Path(handle.name)
    try:
        log_line(
            "[prompt-eval] starting"
            + f" table={case.get('table', '')}"
            + f" task=\"{shorten(case.get('task', ''), 72)}\""
            + f" checks={describe_eval_checks(eval_checks)}"
        )
        command = [
            "node",
            "tools/eval-agent.js",
            "prompt-eval",
            "--table",
            str(table_path),
            "--task",
            case["task"],
            "--candidate",
            str(candidate_path),
            "--max-steps",
            str(max_steps),
        ]
        if eval_checks is not None:
            command.extend(["--eval-checks", ",".join(eval_checks)])
        completed = subprocess.run(
            command,
            cwd=ROOT,
            check=False,
            capture_output=True,
            text=True,
            encoding="utf-8",
        )
    finally:
        try:
            candidate_path.unlink()
        except OSError:
            pass
    if completed.returncode != 0:
        result = {
            "accepted": False,
            "score": 0,
            "contractIssues": ["prompt-eval command failed"],
            "validationIssues": [],
            "evalReport": None,
            "stderr": completed.stderr[-2000:],
        }
        log_case_result(case, result)
        return result
    result = json.loads(completed.stdout)
    log_case_result(case, result)
    return result


def call_openai_compatible_chat(base_url: str, api_key: str, model: str, prompt: str) -> str:
    """
    Call a local or remote OpenAI-compatible chat endpoint.

    This is used for GEPA reflection so local llama.cpp servers can be used
    without LiteLLM's OpenAI credential checks. The target-model evaluator still
    runs through tools/eval-agent.js and PIN_AI_*.
    """
    endpoint = base_url.rstrip("/")
    if not endpoint.lower().endswith("/chat/completions"):
        endpoint += "/chat/completions"
    payload = json.dumps({
        "model": model,
        "temperature": 0.1,
        "messages": [{"role": "user", "content": prompt}],
    }).encode("utf-8")
    request = urllib.request.Request(
        endpoint,
        data=payload,
        headers={
            "Content-Type": "application/json",
            "Authorization": "Bearer " + api_key,
        },
        method="POST",
    )
    try:
        with urllib.request.urlopen(request, timeout=180) as response:
            data = json.loads(response.read().decode("utf-8"))
    except urllib.error.HTTPError as exc:
        body = exc.read().decode("utf-8", errors="replace")
        raise RuntimeError(f"Reflection provider HTTP {exc.code}: {body[:1000]}") from exc
    choices = data.get("choices") or []
    if not choices:
        raise RuntimeError("Reflection provider returned no choices.")
    return str(((choices[0].get("message") or {}).get("content")) or "")


def models_endpoint_for_base_url(base_url: str) -> str:
    """Resolve the OpenAI-compatible `/models` endpoint from a base URL."""
    endpoint = base_url.rstrip("/")
    lower = endpoint.lower()
    if lower.endswith("/models"):
        return endpoint
    if lower.endswith("/chat/completions"):
        return endpoint[: -len("/chat/completions")] + "/models"
    return endpoint + "/models"


def fetch_openai_compatible_models(base_url: str, api_key: str) -> list[str]:
    """
    Query an OpenAI-compatible `/models` endpoint.

    If this fails, the run should stop before GEPA starts spending effort on a
    reflection model name that does not exist or on a provider URL that is wrong.
    That is not "exploration"; that is just avoidable waste.
    """
    endpoint = models_endpoint_for_base_url(base_url)
    request = urllib.request.Request(
        endpoint,
        headers={
            "Authorization": "Bearer " + api_key,
        },
        method="GET",
    )
    try:
        with urllib.request.urlopen(request, timeout=60) as response:
            data = json.loads(response.read().decode("utf-8"))
    except urllib.error.HTTPError as exc:
        body = exc.read().decode("utf-8", errors="replace")
        raise SystemExit(f"Reflection provider model-list HTTP {exc.code}: {shorten(body, 400)}") from exc
    except urllib.error.URLError as exc:
        raise SystemExit(f"Reflection provider model-list failed: {exc}") from exc
    raw = data.get("data") or []
    models = []
    for item in raw:
        if isinstance(item, dict) and isinstance(item.get("id"), str):
            models.append(item["id"])
    if not models:
        raise SystemExit("Reflection provider returned no models from /models; check the base URL and provider compatibility.")
    return models


def preflight_reflection_provider(args: argparse.Namespace) -> None:
    """Verify that the configured local reflection model exists before optimization starts."""
    if args.reflection_lm != "local":
        return
    base_url = args.reflection_base_url or os.environ.get("PIN_AI_BASE_URL", "")
    api_key = args.reflection_api_key or os.environ.get("PIN_AI_API_KEY", "NA")
    model = args.reflection_model or os.environ.get("PIN_AI_MODEL", "")
    log_line(f"[reflection] preflight checking model list for {base_url}")
    models = fetch_openai_compatible_models(base_url, api_key)
    if model in models:
        log_line(f"[reflection] preflight model ok: {model}")
        return
    close = [name for name in models if model.lower() in name.lower() or name.lower() in model.lower()]
    sample = close[:8] if close else models[:8]
    raise SystemExit(
        "Reflection model not found in provider /models list.\n"
        f"Requested: {model}\n"
        f"Provider: {base_url}\n"
        "Available examples: " + ", ".join(sample)
    )


def build_reflection_lm(args: argparse.Namespace) -> Any:
    """Resolve the reflection model to either a local callable or a GEPA/LiteLLM name."""
    if args.reflection_lm != "local":
        return args.reflection_lm
    base_url = args.reflection_base_url or os.environ.get("PIN_AI_BASE_URL", "")
    api_key = args.reflection_api_key or os.environ.get("PIN_AI_API_KEY", "NA")
    model = args.reflection_model or os.environ.get("PIN_AI_MODEL", "")
    if not base_url or not model:
        raise SystemExit("For --reflection-lm local, set --reflection-base-url/--reflection-model or PIN_AI_BASE_URL/PIN_AI_MODEL.")

    def reflection_lm(prompt: str) -> str:
        log_line(f"[reflection] requesting local reflection completion model={model}")
        return call_openai_compatible_chat(base_url, api_key, model, prompt)

    return reflection_lm


def result_side_info(case: dict[str, Any], result: dict[str, Any]) -> dict[str, Any]:
    """Keep GEPA reflection focused on actionable schema/eval failures."""
    checks = ((result.get("evalReport") or {}).get("checks") or [])
    failed_checks = [
        {"id": check.get("id"), "message": check.get("message")}
        for check in checks
        if check.get("status") == "fail"
    ][:20]
    return {
        "table": case["table"],
        "task": case["task"],
        "accepted": bool(result.get("accepted")),
        "contractIssues": result.get("contractIssues") or [],
        "validationIssues": result.get("validationIssues") or [],
        "failedChecks": failed_checks,
        "attempt": result.get("attempt"),
        "stderr": result.get("stderr", ""),
    }


def format_feedback(side_info: dict[str, Any]) -> str:
    """Build concise reflection feedback from patch contract and evaluator failures."""
    return json.dumps(side_info, indent=2)


def resolve_eval_checks(args: argparse.Namespace) -> list[str] | None:
    """
    Resolve which table-eval checks should run inside prompt-eval.

    `None` means "let eval-agent use its default full suite". A concrete list
    means "run exactly these checks". This lets prompt tuning focus on contract
    and logic correctness first, before spending time on reachability physics.
    """
    if args.eval_checks:
        return [item for item in args.eval_checks if item]
    if args.eval_check_profile == "all":
        return None
    profile = EVAL_CHECK_PROFILES.get(args.eval_check_profile)
    if profile is None:
        raise SystemExit(f"Unknown eval-check profile: {args.eval_check_profile}")
    return profile[:]


def make_pinball_adapter(EvaluationBatch: Any, max_steps: int, eval_checks: list[str] | None) -> Any:
    """Create the GEPA adapter for the current `gepa.optimize` API."""

    class PinballPromptAdapter:
        """
        What: Bridge GEPA candidates into the Node patch/eval harness.
        Why: GEPA's current API optimizes named text components; our component is
        the assistant patch prompt, evaluated through eval-agent. It is one
        prompt string, not a mystery religion.
        """
        propose_new_texts = None

        def evaluate(self, batch: list[dict[str, Any]], candidate: dict[str, str], capture_traces: bool = False) -> Any:
            """
            Run each GEPA prompt candidate against the selected Pinball tasks.

            Each case goes through `eval-agent prompt-eval`, which in turn asks
            the target model for a patch and scores the result against the chosen
            validation/eval checks. Per-example failure remains data, not an
            exception; blowing up the whole run because one patch was nonsense
            would be a spectacularly unhelpful interpretation of "optimizer".
            """
            prompt = candidate.get("prompt", "")
            outputs: list[dict[str, Any]] = []
            scores: list[float] = []
            trajectories: list[dict[str, Any]] | None = [] if capture_traces else None
            for case in batch:
                result = run_prompt_eval(prompt, case, max_steps, eval_checks)
                side_info = result_side_info(case, result)
                score = float(result.get("score") or 0)
                outputs.append(result)
                scores.append(score)
                if trajectories is not None:
                    trajectories.append({
                        "case": case,
                        "result": result,
                        "feedback": format_feedback(side_info),
                    })
            return EvaluationBatch(outputs=outputs, scores=scores, trajectories=trajectories)

        def make_reflective_dataset(self, candidate: dict[str, str], eval_batch: Any, components_to_update: list[str]) -> dict[str, list[dict[str, str]]]:
            """
            Distill evaluation results into compact reflection records.

            The reflection model does not need the entire universe. It needs the
            task, the model's attempted patch, and the validator/evaluator telling
            it exactly how the patch was wrong.
            """
            trajectories = eval_batch.trajectories or []
            records = []
            for trajectory in trajectories:
                case = trajectory.get("case") or {}
                result = trajectory.get("result") or {}
                records.append({
                    "Inputs": json.dumps({
                        "table": case.get("table", ""),
                        "task": case.get("task", ""),
                    }),
                    "Generated Outputs": json.dumps({
                        "patch": result.get("patch"),
                        "accepted": result.get("accepted"),
                        "score": result.get("score"),
                    }, indent=2),
                    "Feedback": str(trajectory.get("feedback") or ""),
                })
            return {component: records for component in components_to_update}

    return PinballPromptAdapter()


def best_candidate_text(result: Any) -> str:
    """Extract best prompt text from the GEPA result shapes documented upstream."""
    candidate = getattr(result, "best_candidate", None)
    if isinstance(candidate, str):
        return candidate
    if isinstance(candidate, dict):
        value = candidate.get("prompt") or candidate.get("system_prompt")
        if isinstance(value, str):
            return value
    raise TypeError("GEPA result did not expose a string best_candidate prompt")


def parse_args(argv: list[str]) -> argparse.Namespace:
    """
    Parse CLI arguments.

    Defaults are intentionally conservative. Prompt optimization can become an
    accidental stress test for your provider bill or your physics harness if you
    let every run spray full reachability checks at every candidate.
    """
    parser = argparse.ArgumentParser(description="Optimize the Pinball assistant patch prompt with GEPA.")
    parser.add_argument("--cases", default="tools/gepa/cases.example.jsonl", help="JSONL cases with table and task fields.")
    parser.add_argument("--seed", default="tools/gepa/assistant-patch-seed.txt", help="Seed prompt text to optimize.")
    parser.add_argument("--out", default="tools/gepa/optimized-assistant-prompt.txt", help="Where to write GEPA's best prompt.")
    parser.add_argument("--reflection-lm", required=True, help="GEPA reflection LM name, or 'local' to use the OpenAI-compatible PIN_AI_* endpoint.")
    parser.add_argument("--reflection-base-url", default="", help="OpenAI-compatible reflection base URL for --reflection-lm local.")
    parser.add_argument("--reflection-api-key", default="", help="Reflection API key for --reflection-lm local; use NA for local servers that ignore keys.")
    parser.add_argument("--reflection-model", default="", help="Reflection model id for --reflection-lm local.")
    parser.add_argument("--max-metric-calls", type=int, default=20, help="Hard cap on target-model evaluations.")
    parser.add_argument("--prompt-eval-steps", type=int, default=2, help="Repair attempts per target-model evaluation.")
    parser.add_argument(
        "--eval-check-profile",
        default="logic_fast",
        choices=["logic_fast", "schema_only", "static", "full", "all"],
        help="Which table-eval checks prompt-eval should run. 'logic_fast' is the default cheap schema/logic gate; 'full' runs expensive reachability checks too; 'all' leaves eval-agent defaults untouched.",
    )
    parser.add_argument(
        "--eval-check",
        action="append",
        dest="eval_checks",
        help="Explicit eval check id to run. Repeat to override the profile completely.",
    )
    parser.add_argument("--run-dir", default="tools/gepa/runs/latest", help="GEPA run directory for logs and stop file.")
    parser.add_argument(
        "--viz-run",
        default="",
        help="Optional gepa-viz run JSON path, for example tools/gepa/runs/latest/viz-run.json.",
    )
    return parser.parse_args(argv)


def main(argv: list[str]) -> int:
    """
    Run GEPA and write the best candidate prompt.

    The important split is:
    - target model: generates patches and is scored by Pinball validation
    - reflection model: rewrites the prompt based on those failures
    - eval-check selection: controls whether scoring stays cheap and structural
      or graduates into the more expensive physics/reachability checks
    """
    args = parse_args(argv)
    if not os.environ.get("PIN_AI_BASE_URL") or not os.environ.get("PIN_AI_API_KEY") or not os.environ.get("PIN_AI_MODEL"):
        raise SystemExit("Set PIN_AI_BASE_URL, PIN_AI_API_KEY, and PIN_AI_MODEL before running prompt optimization.")

    optimize, EvaluationBatch = import_gepa()
    cases = read_cases(ROOT / args.cases)
    seed = (ROOT / args.seed).read_text(encoding="utf-8")
    eval_checks = resolve_eval_checks(args)
    viz_path = ROOT / args.viz_run if args.viz_run else None
    callbacks = build_viz_callbacks(viz_path, cases)
    log_run_configuration(args, cases, eval_checks)
    preflight_reflection_provider(args)
    result = optimize(
        seed_candidate={"prompt": seed},
        trainset=cases,
        valset=cases,
        adapter=make_pinball_adapter(EvaluationBatch, args.prompt_eval_steps, eval_checks),
        reflection_lm=build_reflection_lm(args),
        max_metric_calls=args.max_metric_calls,
        run_dir=str(ROOT / args.run_dir),
        callbacks=callbacks,
        track_best_outputs=True,
        raise_on_exception=False,
    )
    out_path = ROOT / args.out
    out_path.parent.mkdir(parents=True, exist_ok=True)
    out_path.write_text(best_candidate_text(result), encoding="utf-8")
    log_line(
        "[gepa] finished"
        + f" best_idx={getattr(result, 'best_idx', 'n/a')}"
        + f" candidates={getattr(result, 'num_candidates', 'n/a')}"
        + f" metric_calls={getattr(result, 'total_metric_calls', 'n/a')}"
        + f" output={out_path}"
    )
    print(str(out_path))
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
