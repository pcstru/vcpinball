# What: Template launcher for the GEPA prompt-optimization harness.
# Why: The real operator-facing launcher should stay local and ignored, because
# scripts with secrets have a distressing tendency to end up in commits when
# someone mistakes "works on my machine" for a security policy.

$ErrorActionPreference = "Stop"

$RepoRoot = Resolve-Path (Join-Path $PSScriptRoot "..")
. (Join-Path $RepoRoot "tools\LoadPinEnv.ps1")

Import-PinDotEnv -Path (Join-Path $RepoRoot ".env")

$Optimizer = Join-Path $RepoRoot "tools\gepa-prompt-optimizer.py"
$Cases = Join-Path $RepoRoot "tools\gepa\cases.a_targ_grpb.jsonl"
$Out = Join-Path $RepoRoot "tools\gepa\optimized-assistant-prompt.txt"
$RunStamp = Get-Date -Format "yyyyMMdd-HHmmss"
$RunDir = Join-Path $RepoRoot ("tools\gepa\runs\" + $RunStamp)
$LatestVizRun = Join-Path $RepoRoot "tools\gepa\runs\latest-viz-run.json"

if (-not $env:PIN_AI_BASE_URL) {
    $env:PIN_AI_BASE_URL = "http://0.0.0.0:8082"
}
if (-not $env:PIN_AI_API_KEY) {
    $env:PIN_AI_API_KEY = "NA"
}
if (-not $env:PIN_AI_MODEL) {
    $env:PIN_AI_MODEL = "Qwen2.5.1-Coder-7B-Instruct-Q6_K_L"
}

if (-not $env:PIN_REFLECTION_BASE_URL) {
    $env:PIN_REFLECTION_BASE_URL = $env:PIN_AI_BASE_URL
}
if (-not $env:PIN_REFLECTION_API_KEY) {
    $env:PIN_REFLECTION_API_KEY = $env:PIN_AI_API_KEY
}
if (-not $env:PIN_REFLECTION_MODEL) {
    $env:PIN_REFLECTION_MODEL = $env:PIN_AI_MODEL
}

python -c "import gepa" 2>$null
if ($LASTEXITCODE -ne 0) {
    Write-Error @"
GEPA is not installed for this Python interpreter.

Interpreter:
$(python -c "import sys; print(sys.executable)")

Install:
python -m pip install gepa

If PyPI does not have the version you need:
python -m pip install "git+https://github.com/gepa-ai/gepa.git"
"@
}

Write-Host "GEPA run directory: $RunDir"
Write-Host "GEPA cases: $Cases"

if (-not (Test-Path -LiteralPath $LatestVizRun)) {
    New-Item -ItemType File -Path $LatestVizRun -Force | Out-Null
}

python $Optimizer --cases $Cases --reflection-lm local --reflection-base-url $env:PIN_REFLECTION_BASE_URL --reflection-api-key $env:PIN_REFLECTION_API_KEY --reflection-model $env:PIN_REFLECTION_MODEL --max-metric-calls 20 --out $Out --run-dir $RunDir --viz-run $LatestVizRun
