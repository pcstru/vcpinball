# What: Load a repo-local `.env` file into the current PowerShell process.
# Why: GEPA and eval tooling need provider settings, but those settings should
# live in ignored local configuration rather than in scripts someone might push
# after a moment of misplaced confidence.

function Import-PinDotEnv {
    <#
    What:
    Parse `KEY=VALUE` lines from a `.env` file and load them into `Env:`.

    Why:
    The GEPA launcher is a convenience wrapper. Convenience is not a license
    to smear secrets into versioned scripts.

    Correctness:
    - Ignores blank lines and `#` comments.
    - Preserves existing process environment variables unless `-Force` is used.
    - Trims a single matching pair of surrounding quotes from values.
    - Throws on malformed non-comment lines so a broken `.env` fails loudly.
    #>
    [CmdletBinding()]
    param(
        [Parameter(Mandatory = $true)]
        [string]$Path,

        [switch]$Force
    )

    if (-not (Test-Path -LiteralPath $Path)) {
        return
    }

    foreach ($rawLine in Get-Content -LiteralPath $Path) {
        $line = $rawLine.Trim()
        if (-not $line -or $line.StartsWith("#")) {
            continue
        }
        if ($line -notmatch "^(?<key>[A-Za-z_][A-Za-z0-9_]*)=(?<value>.*)$") {
            throw "Invalid .env line in ${Path}: $rawLine"
        }

        $key = $Matches["key"]
        $value = $Matches["value"]
        if ($value.Length -ge 2) {
            $first = $value.Substring(0, 1)
            $last = $value.Substring($value.Length - 1, 1)
            if (($first -eq '"' -and $last -eq '"') -or ($first -eq "'" -and $last -eq "'")) {
                $value = $value.Substring(1, $value.Length - 2)
            }
        }

        if (-not $Force -and (Test-Path "Env:${key}")) {
            continue
        }

        Set-Item -Path "Env:${key}" -Value $value
    }
}
