# What: Serve the GEPA visualizer run file with clear packaging checks.
# Why: gepa-viz currently installs from GitHub without the pre-built SPA bundle,
# so users need actionable source-build instructions when the Python CLI can
# serve /run.json but cannot render the React UI.

$ErrorActionPreference = "Stop"

$RepoRoot = Resolve-Path (Join-Path $PSScriptRoot "..")
$VizRun = Join-Path $RepoRoot "tools\gepa\runs\latest-viz-run.json"

function Test-Command($Name) {
    return $null -ne (Get-Command $Name -ErrorAction SilentlyContinue)
}

function Get-GepaVizPackageInfo {
    $probePath = Join-Path ([System.IO.Path]::GetTempPath()) ("pinball-gepa-viz-probe-" + [System.Guid]::NewGuid().ToString("N") + ".py")
    $script = @'
from pathlib import Path
import gepa_viz

package_dir = Path(gepa_viz.__file__).parent
static_dir = package_dir / "static"
index_html = static_dir / "index.html"
print(package_dir)
print(index_html)
print("ready" if index_html.exists() else "missing")
'@
    Set-Content -LiteralPath $probePath -Value $script -Encoding UTF8
    try {
        $output = python $probePath
        if ($LASTEXITCODE -ne 0 -or $null -eq $output -or $output.Count -lt 3) {
            Write-Error "Unable to inspect the installed gepa_viz package. Try reinstalling it with: python -m pip install --force-reinstall C:\tmp\gepa-viz\python"
        }
    } finally {
        if (Test-Path -LiteralPath $probePath) {
            Remove-Item -LiteralPath $probePath -Force
        }
    }
    return @{
        PackageDir = $output[0]
        IndexHtml = $output[1]
        Status = $output[2]
    }
}

python -c "import gepa_viz" 2>$null
if ($LASTEXITCODE -ne 0) {
    Write-Error @"
gepa-viz is not installed for this Python interpreter.

Install the Python CLI first:
python -m pip install "git+https://github.com/modaic-ai/gepa-viz.git#subdirectory=python"
"@
}

$info = Get-GepaVizPackageInfo
if ($info.Status -ne "ready") {
    Write-Warning @"
gepa-viz is installed, but its static browser bundle is missing:
$($info.IndexHtml)

The upstream README's `just build` command must be run in a clone of
https://github.com/modaic-ai/gepa-viz, not in this Pinball repo and not through npm.

One-time build/install:
  git clone https://github.com/modaic-ai/gepa-viz.git C:\tmp\gepa-viz
  cd C:\tmp\gepa-viz
  just install
  just build
  python -m pip install --force-reinstall .\python

Prerequisites for that source build: git, node, npm, and just. The final
uv build step can fail if uv is missing; pip can still install directly from
.\python after just build has copied the static files.

After reinstalling the built wheel, rerun:
  .\tools\RunGepaViz.ps1
"@
}

if (-not (Test-Command "gepa-viz")) {
    Write-Error "gepa-viz command is not on PATH for this shell. Reopen PowerShell or verify the Python Scripts directory is on PATH."
}

gepa-viz serve --run $VizRun
