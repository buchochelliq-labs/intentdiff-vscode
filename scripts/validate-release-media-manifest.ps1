param(
  [string]$ManifestPath = "artifacts\release-media-review\manifest.json"
)

$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

# Keep validation logic centralized in Python for CI and cross-platform callers.
$pythonValidator = Join-Path $PSScriptRoot "validate_release_media_manifest.py"
if (Get-Command uv -ErrorAction SilentlyContinue) {
  & uv run --no-sync python $pythonValidator $ManifestPath
  return
}
if (Get-Command python -ErrorAction SilentlyContinue) {
  & python $pythonValidator $ManifestPath
  return
}

$requiredSurfaces = @(
  "dashboard",
  "review",
  "intent",
  "risk",
  "evidence",
  "notes",
  "release-notes",
  "binary-image",
  "schema",
  "guardrails",
  "language-sweep",
  "narrow",
  "light-theme"
)
$allowedStatuses = @("approved", "needs_polish", "post_beta")

function Parse-CaptureRegion {
  param([string]$Region)
  if ($Region -eq "full-desktop" -or -not $Region) {
    return $null
  }
  if ($Region -notmatch "^\s*(\d+),\s*(\d+),\s*(\d+),\s*(\d+)\s*$") {
    throw "Visual proof manifest has invalid capture_region '$Region'."
  }
  return @{
    Width = [int]$Matches[3]
    Height = [int]$Matches[4]
  }
}

function Assert-ExpectedDimensions {
  param(
    [Parameter(Mandatory = $true)][string]$Surface,
    [Parameter(Mandatory = $true)][int]$Width,
    [Parameter(Mandatory = $true)][int]$Height
  )

  $expectedWidth = 1280
  $expectedHeight = 720
  if ($Surface -eq "narrow") {
    $expectedWidth = 760
    $expectedHeight = 720
  }

  if ($Width -ne $expectedWidth -or $Height -ne $expectedHeight) {
    throw "Visual proof surface '$Surface' has unexpected dimensions ${Width}x${Height}; expected ${expectedWidth}x${expectedHeight}."
  }
}

if (-not (Test-Path -LiteralPath $ManifestPath)) {
  throw "Visual proof manifest not found: $ManifestPath"
}

$manifest = Get-Content -LiteralPath $ManifestPath -Raw | ConvertFrom-Json
$screenshots = @($manifest.screenshots)
if ($screenshots.Count -eq 0) {
  throw "Visual proof manifest has no screenshots: $ManifestPath"
}

$seen = @{}
foreach ($entry in $screenshots) {
  if (-not $entry.surface) {
    throw "Visual proof manifest contains an entry without a surface."
  }
  if ($seen.ContainsKey([string]$entry.surface)) {
    throw "Visual proof manifest has duplicate surface entry: $($entry.surface)"
  }
  if ($allowedStatuses -notcontains [string]$entry.status) {
    throw "Visual proof surface '$($entry.surface)' has invalid status '$($entry.status)'."
  }
  if (-not $entry.screenshot_path) {
    throw "Visual proof surface '$($entry.surface)' has no screenshot_path."
  }
  if (-not (Test-Path -LiteralPath $entry.screenshot_path)) {
    throw "Visual proof surface '$($entry.surface)' references missing screenshot: $($entry.screenshot_path)"
  }
  if (-not $entry.capture_region) {
    throw "Visual proof surface '$($entry.surface)' has no capture_region."
  }
  if (-not $entry.captured_width -or $entry.captured_width -le 0) {
    throw "Visual proof surface '$($entry.surface)' has invalid captured_width '$($entry.captured_width)'."
  }
  if (-not $entry.captured_height -or $entry.captured_height -le 0) {
    throw "Visual proof surface '$($entry.surface)' has invalid captured_height '$($entry.captured_height)'."
  }
  if (-not $entry.capture_command) {
    throw "Visual proof surface '$($entry.surface)' has no capture_command."
  }

  if ($entry.capture_command -notlike "*-Scene $($entry.surface) *" -and $entry.capture_command -notlike "*-Scene `"$($entry.surface)`" *") {
    throw "Visual proof surface '$($entry.surface)' capture_command does not match the surface."
  }
  if ($entry.screenshot_path -notlike "*intentumdiff-vscode-$($entry.surface).png") {
    throw "Visual proof surface '$($entry.surface)' has unexpected screenshot filename '$($entry.screenshot_path)'."
  }

  $parsedRegion = Parse-CaptureRegion -Region $entry.capture_region
  if ($null -ne $parsedRegion) {
    Assert-ExpectedDimensions -Surface $entry.surface -Width $parsedRegion.Width -Height $parsedRegion.Height
  }
  Assert-ExpectedDimensions -Surface $entry.surface -Width $entry.captured_width -Height $entry.captured_height

  $seen[[string]$entry.surface] = $true
}

$missing = @($requiredSurfaces | Where-Object { -not $seen.ContainsKey($_) })
if ($missing.Count -gt 0) {
  throw "Visual proof manifest is missing required surfaces: $($missing -join ', ')"
}

Write-Host "Visual proof manifest is valid:"
Write-Host "  $ManifestPath"
Write-Host "  surfaces: $($requiredSurfaces.Count)"
