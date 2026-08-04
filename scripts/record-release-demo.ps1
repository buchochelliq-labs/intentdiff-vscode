param(
  [ValidateSet("vscode", "cli")]
  [string]$Demo = "vscode",
  [ValidateSet("dashboard", "review", "intent", "risk", "evidence", "notes", "release-notes", "binary-image", "guardrails", "schema", "language-sweep", "narrow", "light-theme")]
  [string]$Scene = "review",
  [ValidateSet("record", "screenshot")]
  [string]$CaptureMode = "record",
  [string]$OutputGif,
  [string]$OutputVideo,
  [string]$OutputScreenshot,
  [string]$CaptureRegion,
  [int]$DurationSeconds = 14,
  [int]$FrameRate = 12,
  [int]$ScaleWidth = 960,
  [int]$ScaleHeight = 540,
  [int]$CountdownSeconds = 5,
  [int]$MaxGifMb = 5,
  [string]$Ffmpeg = "ffmpeg",
  [string]$Ffprobe = "ffprobe",
  [string]$CodeCommand = "code",
  [string]$UvCommand = "uv",
  [string]$DemoRoot = "C:\tmp\intentumdiff-release-demo",
  [string]$ManifestPath = "artifacts\release-media-review\manifest.json",
  [switch]$AutoStage,
  [switch]$KeepVideo,
  [switch]$DryRun
)

$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

$RequiredVisualProofScenes = @(
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
$AllowedVisualProofStatuses = @("approved", "needs_polish", "post_beta")

function Resolve-VsCodeDemoContentScene {
  param(
    [Parameter(Mandatory = $true)]
    [ValidateSet("dashboard", "review", "intent", "risk", "evidence", "notes", "release-notes", "binary-image", "guardrails", "schema", "language-sweep", "narrow", "light-theme")]
    [string]$Scene
  )
  switch ($Scene) {
    "guardrails" { return "guardrails" }
    "schema" { return "schema" }
    "language-sweep" { return "language-sweep" }
    "binary-image" { return "semantic" }
    default { return "review" }
  }
}

function Resolve-VsCodeDemoReviewView {
  param(
    [Parameter(Mandatory = $true)]
    [ValidateSet("dashboard", "review", "intent", "risk", "evidence", "notes", "release-notes", "binary-image", "guardrails", "schema", "language-sweep", "narrow", "light-theme")]
    [string]$Scene
  )
  switch ($Scene) {
    "intent" { return "intent" }
    "risk" { return "risk" }
    "evidence" { return "evidence" }
    "notes" { return "notes" }
    "release-notes" { return "release-notes" }
    "binary-image" { return "binary-image" }
    default { return "semantic" }
  }
}

function Resolve-Executable {
  param(
    [Parameter(Mandatory = $true)]
    [string]$Name
  )
  if (Test-Path -LiteralPath $Name) {
    return (Resolve-Path -LiteralPath $Name).Path
  }
  $command = Get-Command $Name -ErrorAction SilentlyContinue
  if ($null -eq $command) {
    throw "Could not find '$Name'. Install ffmpeg or pass -Ffmpeg/-Ffprobe explicitly."
  }
  return $command.Source
}

function Resolve-VsCodeExecutableForDemo {
  param(
    [Parameter(Mandatory = $true)]
    [string]$RepoRoot,
    [Parameter(Mandatory = $true)]
    [string]$CodeName
  )
  if ($CodeName -ne "code" -and $CodeName -ne "code.cmd") {
    return Resolve-Executable -Name $CodeName
  }
  $testRoot = Join-Path $RepoRoot "plugins\vscode\.vscode-test"
  $testCode = Get-ChildItem -Path $testRoot -Recurse -Filter "Code.exe" -ErrorAction SilentlyContinue |
    Sort-Object LastWriteTime -Descending |
    Select-Object -First 1
  if ($null -ne $testCode) {
    return $testCode.FullName
  }
  $testCli = Get-ChildItem -Path $testRoot -Recurse -Filter "code.cmd" -ErrorAction SilentlyContinue |
    Sort-Object LastWriteTime -Descending |
    Select-Object -First 1
  if ($null -ne $testCli) {
    return $testCli.FullName
  }
  return Resolve-Executable -Name $CodeName
}

function Resolve-DefaultOutput {
  param(
    [Parameter(Mandatory = $true)]
    [string]$RepoRoot,
    [Parameter(Mandatory = $true)]
    [string]$DemoName,
    [Parameter(Mandatory = $true)]
    [string]$SceneName
  )
  if ($DemoName -eq "vscode") {
    return Join-Path $RepoRoot "plugins\vscode\media\intentumdiff-vscode-$SceneName-recording.gif"
  }
  return Join-Path $RepoRoot "docs\media\intentumdiff-cli-recording.gif"
}

function Resolve-DefaultScreenshotOutput {
  param(
    [Parameter(Mandatory = $true)]
    [string]$DemoRootPath,
    [Parameter(Mandatory = $true)]
    [string]$DemoName,
    [Parameter(Mandatory = $true)]
    [string]$SceneName
  )
  return Join-Path $DemoRootPath "samples\intentumdiff-$DemoName-$SceneName.png"
}

function New-VisualProofManifest {
  return [ordered]@{
    schema_version = 1
    generated_by = "scripts/record-release-demo.ps1"
    required_surfaces = $RequiredVisualProofScenes
    allowed_statuses = $AllowedVisualProofStatuses
    screenshots = @()
  }
}

function Read-VisualProofManifest {
  param([Parameter(Mandatory = $true)][string]$PathValue)
  if (-not (Test-Path -LiteralPath $PathValue)) {
    return New-VisualProofManifest
  }
  $raw = Get-Content -LiteralPath $PathValue -Raw
  if (-not $raw.Trim()) {
    return New-VisualProofManifest
  }
  return $raw | ConvertFrom-Json
}

function Update-VisualProofManifest {
  param(
    [Parameter(Mandatory = $true)]
    [string]$PathValue,
    [Parameter(Mandatory = $true)]
    [string]$SceneName,
    [Parameter(Mandatory = $true)]
    [string]$ScreenshotPath,
    [Parameter(Mandatory = $true)]
    [string]$CaptureCommand,
    [string]$CaptureRegion,
    [int]$CapturedWidth = 0,
    [int]$CapturedHeight = 0,
    [string]$Notes = "Captured for review; user approval is required before refreshing curated media."
  )
  $manifest = Read-VisualProofManifest -PathValue $PathValue
  $screenshots = @($manifest.screenshots | Where-Object { $_.surface -ne $SceneName })
  $screenshots += [ordered]@{
    surface = $SceneName
    screenshot_path = $ScreenshotPath
    status = "needs_polish"
    capture_command = $CaptureCommand
    capture_region = $CaptureRegion
    captured_width = $CapturedWidth
    captured_height = $CapturedHeight
    captured_at = (Get-Date).ToUniversalTime().ToString("o")
    notes = $Notes
  }
  $next = [ordered]@{
    schema_version = 1
    generated_by = "scripts/record-release-demo.ps1"
    required_surfaces = $RequiredVisualProofScenes
    allowed_statuses = $AllowedVisualProofStatuses
    screenshots = @($screenshots | Sort-Object surface)
  }
  $manifestDir = Split-Path -Parent $PathValue
  if ($manifestDir) {
    New-Item -ItemType Directory -Force -Path $manifestDir | Out-Null
  }
  $next | ConvertTo-Json -Depth 12 | Set-Content -LiteralPath $PathValue -Encoding UTF8
}

function Parse-CaptureRegion {
  param([string]$Region)
  if (-not $Region) {
    return $null
  }
  if ($Region -notmatch "^\s*(\d+),\s*(\d+),\s*(\d+),\s*(\d+)\s*$") {
    throw "CaptureRegion must be 'x,y,width,height'. Example: -CaptureRegion '80,80,1280,720'"
  }
  return @{
    X = [int]$Matches[1]
    Y = [int]$Matches[2]
    Width = [int]$Matches[3]
    Height = [int]$Matches[4]
  }
}

function Get-PngDimensions {
  param(
    [Parameter(Mandatory = $true)]
    [string]$Path
  )

  $bytes = [System.IO.File]::ReadAllBytes($Path)
  if ($bytes.Length -lt 24) {
    throw "Screenshot file is too small to parse PNG dimensions: $Path"
  }

  if ($bytes[0] -ne 0x89 -or $bytes[1] -ne 0x50 -or $bytes[2] -ne 0x4E -or $bytes[3] -ne 0x47) {
    throw "Expected screenshot file to be a PNG: $Path"
  }

  $width = (([int]$bytes[16] -shl 24) -bor ([int]$bytes[17] -shl 16) -bor ([int]$bytes[18] -shl 8) -bor [int]$bytes[19])
  $height = (([int]$bytes[20] -shl 24) -bor ([int]$bytes[21] -shl 16) -bor ([int]$bytes[22] -shl 8) -bor [int]$bytes[23])

  if ($width -le 0 -or $height -le 0) {
    throw "Could not parse valid PNG dimensions from screenshot: $Path"
  }

  return @{
    width = $width
    height = $height
  }
}

function Resolve-OutputPath {
  param(
    [Parameter(Mandatory = $true)]
    [string]$PathValue,
    [Parameter(Mandatory = $true)]
    [string]$BaseDir
  )
  if ([System.IO.Path]::IsPathRooted($PathValue)) {
    return [System.IO.Path]::GetFullPath($PathValue)
  }
  return [System.IO.Path]::GetFullPath((Join-Path $BaseDir $PathValue))
}

function Join-DisplayCommand {
  param([string[]]$CommandArgs)
  return ($CommandArgs | ForEach-Object {
    if ($_ -match "\s") {
      '"' + ($_ -replace '"', '\"') + '"'
    } else {
      $_
    }
  }) -join " "
}

function ConvertTo-PSQuotedString {
  param([string]$Value)
  return "'" + ($Value -replace "'", "''") + "'"
}

function ConvertTo-CSharpVerbatimString {
  param([string]$Value)
  return '@"' + ($Value -replace '"', '""') + '"'
}

function Set-Utf8NoBomContent {
  param(
    [Parameter(Mandatory = $true)]
    [string]$PathValue,
    [Parameter(Mandatory = $true)]
    [string]$Value
  )
  [System.IO.File]::WriteAllText(
    $PathValue,
    $Value,
    [System.Text.UTF8Encoding]::new($false)
  )
}

function Invoke-External {
  param(
    [Parameter(Mandatory = $true)]
    [string]$Label,
    [Parameter(Mandatory = $true)]
    [string]$FilePath,
    [string[]]$Arguments = @(),
    [string]$WorkingDirectory
  )
  Write-Host "  $Label"
  if ($WorkingDirectory) {
    Push-Location $WorkingDirectory
  }
  try {
    & $FilePath @Arguments
    if ($LASTEXITCODE -ne 0) {
      throw "$Label failed with exit code $LASTEXITCODE"
    }
  } finally {
    if ($WorkingDirectory) {
      Pop-Location
    }
  }
}

function Invoke-VsCodeExternal {
  param(
    [Parameter(Mandatory = $true)]
    [string]$Label,
    [Parameter(Mandatory = $true)]
    [string]$FilePath,
    [string[]]$Arguments = @(),
    [string]$WorkingDirectory
  )
  $previousElectronRunAsNode = $env:ELECTRON_RUN_AS_NODE
  Remove-Item Env:ELECTRON_RUN_AS_NODE -ErrorAction SilentlyContinue
  try {
    Invoke-External -Label $Label -FilePath $FilePath -Arguments $Arguments -WorkingDirectory $WorkingDirectory
  } finally {
    if ($null -ne $previousElectronRunAsNode) {
      $env:ELECTRON_RUN_AS_NODE = $previousElectronRunAsNode
    }
  }
}

function Reset-DirectoryUnderDemoRoot {
  param(
    [Parameter(Mandatory = $true)]
    [string]$PathValue,
    [Parameter(Mandatory = $true)]
    [string]$DemoRootPath
  )
  $resolvedRoot = [System.IO.Path]::GetFullPath($DemoRootPath)
  $resolvedPath = [System.IO.Path]::GetFullPath($PathValue)
  if (-not $resolvedPath.StartsWith($resolvedRoot, [System.StringComparison]::OrdinalIgnoreCase)) {
    throw "Refusing to reset a directory outside DemoRoot: $resolvedPath"
  }
  Remove-Item -LiteralPath $resolvedPath -Recurse -Force -ErrorAction SilentlyContinue
  New-Item -ItemType Directory -Force -Path $resolvedPath | Out-Null
}

function Stop-DemoProcessesUnderRoot {
  param(
    [Parameter(Mandatory = $true)]
    [string]$DemoRootPath
  )
  $resolvedRoot = [System.IO.Path]::GetFullPath($DemoRootPath).TrimEnd("\")
  $escapedRoot = $resolvedRoot.Replace("\", "\\")
  $processes = Get-CimInstance Win32_Process |
    Where-Object {
      ($_.ExecutablePath -and [System.IO.Path]::GetFullPath($_.ExecutablePath).StartsWith($resolvedRoot, [System.StringComparison]::OrdinalIgnoreCase)) `
        -or ($_.CommandLine -and $_.CommandLine -like "*$resolvedRoot*") `
        -or ($_.CommandLine -and $_.CommandLine -like "*$escapedRoot*")
    }
  foreach ($process in $processes) {
    if ($process.ProcessId -eq $PID) {
      continue
    }
    try {
      Write-Host "  Stopping stale demo process PID $($process.ProcessId): $($process.Name)"
      Stop-Process -Id $process.ProcessId -Force -ErrorAction Stop
    } catch {
      Write-Host "  Could not stop stale demo process PID $($process.ProcessId): $($_.Exception.Message)"
    }
  }
}

function Stop-ProcessesForExecutable {
  param(
    [Parameter(Mandatory = $true)]
    [string]$ExecutablePath
  )
  $resolvedExecutable = [System.IO.Path]::GetFullPath($ExecutablePath)
  $processes = Get-CimInstance Win32_Process |
    Where-Object {
      $_.ExecutablePath -and
      [System.IO.Path]::GetFullPath($_.ExecutablePath).Equals($resolvedExecutable, [System.StringComparison]::OrdinalIgnoreCase)
    }
  foreach ($process in $processes) {
    if ($process.ProcessId -eq $PID) {
      continue
    }
    try {
      Write-Host "  Stopping stale VS Code test-host PID $($process.ProcessId): $($process.Name)"
      Stop-Process -Id $process.ProcessId -Force -ErrorAction Stop
    } catch {
      Write-Host "  Could not stop stale VS Code test-host PID $($process.ProcessId): $($_.Exception.Message)"
    }
  }
}

function Disable-VsCodeTestHostUpdateCheck {
  param(
    [Parameter(Mandatory = $true)]
    [string]$ExecutablePath
  )
  $resolvedExecutable = [System.IO.Path]::GetFullPath($ExecutablePath)
  if ($resolvedExecutable -notlike "*\.vscode-test\*") {
    return
  }

  $appRoot = Split-Path -Parent $resolvedExecutable
  $productPath = Join-Path $appRoot "resources\app\product.json"
  if (-not (Test-Path -LiteralPath $productPath)) {
    $productPath = Get-ChildItem -LiteralPath $appRoot -Recurse -Filter "product.json" -ErrorAction SilentlyContinue |
      Where-Object { $_.FullName -like "*\resources\app\product.json" } |
      Select-Object -First 1 -ExpandProperty FullName
    if (-not $productPath) {
      Write-Warning "Could not find VS Code test-host product metadata under: $appRoot"
      return
    }
  }

  $product = Get-Content -LiteralPath $productPath -Raw | ConvertFrom-Json
  if ($product.win32VersionedUpdate -eq $false) {
    return
  }

  $product.win32VersionedUpdate = $false
  $product | ConvertTo-Json -Depth 100 | Set-Content -LiteralPath $productPath -Encoding UTF8
  Write-Host "  Disabled VS Code test-host update mutex check: $productPath"
}

function New-IntentumDiffRunnerExe {
  param(
    [Parameter(Mandatory = $true)]
    [string]$RunnerPath,
    [Parameter(Mandatory = $true)]
    [string]$RepoRoot,
    [Parameter(Mandatory = $true)]
    [string]$UvPath
  )
  $runnerDir = Split-Path -Parent $RunnerPath
  New-Item -ItemType Directory -Force -Path $runnerDir | Out-Null
  Remove-Item -LiteralPath $RunnerPath -Force -ErrorAction SilentlyContinue
  $uvLiteral = ConvertTo-CSharpVerbatimString -Value $UvPath
  $repoLiteral = ConvertTo-CSharpVerbatimString -Value $RepoRoot
  $source = @"
using System;
using System.Diagnostics;
using System.Linq;

public static class Program
{
    private const string UvPath = $uvLiteral;
    private const string RepoRoot = $repoLiteral;

    public static int Main(string[] args)
    {
        var fixedArgs = new[] { "run", "--no-sync", "python", "-m", "intentumdiff.cli" };
        var allArgs = fixedArgs.Concat(args).Select(QuoteArg);
        var process = Process.Start(new ProcessStartInfo
        {
            FileName = UvPath,
            Arguments = string.Join(" ", allArgs),
            WorkingDirectory = RepoRoot,
            UseShellExecute = false,
        });
        if (process == null)
        {
            Console.Error.WriteLine("Could not start uv for IntentumDiff demo runner.");
            return 1;
        }
        process.WaitForExit();
        return process.ExitCode;
    }

    private static string QuoteArg(string arg)
    {
        if (string.IsNullOrEmpty(arg))
        {
            return "\"\"";
        }
        if (!arg.Any(char.IsWhiteSpace) && !arg.Contains("\""))
        {
            return arg;
        }
        return "\"" + arg.Replace("\\", "\\\\").Replace("\"", "\\\"") + "\"";
    }
}
"@
  Add-Type -TypeDefinition $source -OutputAssembly $RunnerPath -OutputType ConsoleApplication
  if (-not (Test-Path -LiteralPath $RunnerPath)) {
    throw "IntentumDiff demo runner was not created: $RunnerPath"
  }
}

function Register-IsolatedExtension {
  param(
    [Parameter(Mandatory = $true)]
    [string]$ExtensionsDir,
    [Parameter(Mandatory = $true)]
    [string]$Identifier,
    [Parameter(Mandatory = $true)]
    [string]$Version,
    [Parameter(Mandatory = $true)]
    [string]$ExtensionDir
  )
  $extensionsJson = Join-Path $ExtensionsDir "extensions.json"
  $existing = @()
  if (Test-Path -LiteralPath $extensionsJson) {
    $raw = Get-Content -LiteralPath $extensionsJson -Raw
    if ($raw.Trim()) {
      $parsed = $raw | ConvertFrom-Json
      if ($parsed -is [array]) {
        $existing = @($parsed)
      } else {
        $existing = @($parsed)
      }
    }
  }
  $extensionFullPath = [System.IO.Path]::GetFullPath($ExtensionDir)
  $relativeLocation = Split-Path -Leaf $extensionFullPath
  $uriFsPath = ($extensionFullPath -replace "\\", "/")
  if ($uriFsPath -match "^[A-Z]:") {
    $uriFsPath = $uriFsPath.Substring(0, 1).ToLowerInvariant() + $uriFsPath.Substring(1)
  }
  $externalPath = "/" + ($uriFsPath -replace ":", "%3A")
  $pathValue = "/" + $uriFsPath
  $entry = [ordered]@{
    identifier = [ordered]@{ id = $Identifier }
    version = $Version
    location = [ordered]@{
      fsPath = $extensionFullPath
      external = "file://$externalPath"
      path = $pathValue
      scheme = "file"
    }
    relativeLocation = $relativeLocation
    metadata = [ordered]@{
      installedTimestamp = [int64]([DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds())
      pinned = $true
      source = "local"
    }
  }
  @($existing | Where-Object { $_.identifier.id -ne $Identifier }) + [pscustomobject]$entry |
    ConvertTo-Json -Depth 20 |
    Set-Content -LiteralPath $extensionsJson -Encoding UTF8
}

function Install-VsixIntoIsolatedExtensionDir {
  param(
    [Parameter(Mandatory = $true)]
    [string]$VsixPath,
    [Parameter(Mandatory = $true)]
    [string]$ExtensionsDir,
    [Parameter(Mandatory = $true)]
    [string]$Identifier,
    [Parameter(Mandatory = $true)]
    [string]$Version
  )
  $resolvedExtensionsDir = [System.IO.Path]::GetFullPath($ExtensionsDir)
  $targetDir = [System.IO.Path]::GetFullPath((Join-Path $resolvedExtensionsDir "$Identifier-$Version"))
  $extractDir = [System.IO.Path]::GetFullPath((Join-Path $resolvedExtensionsDir "$Identifier-$Version.extract"))
  $zipPath = [System.IO.Path]::GetFullPath((Join-Path $resolvedExtensionsDir "$Identifier-$Version.zip"))
  foreach ($pathValue in @($targetDir, $extractDir, $zipPath)) {
    if (-not $pathValue.StartsWith($resolvedExtensionsDir, [System.StringComparison]::OrdinalIgnoreCase)) {
      throw "Refusing to install an extension outside ExtensionsDir: $pathValue"
    }
    Remove-Item -LiteralPath $pathValue -Recurse -Force -ErrorAction SilentlyContinue
  }
  Copy-Item -LiteralPath $VsixPath -Destination $zipPath
  Expand-Archive -LiteralPath $zipPath -DestinationPath $extractDir -Force
  $sourceDir = Join-Path $extractDir "extension"
  if (-not (Test-Path -LiteralPath $sourceDir)) {
    throw "VSIX did not contain an extension/ directory: $VsixPath"
  }
  Copy-Item -LiteralPath $sourceDir -Destination $targetDir -Recurse
  Remove-Item -LiteralPath $extractDir -Recurse -Force -ErrorAction SilentlyContinue
  Remove-Item -LiteralPath $zipPath -Force -ErrorAction SilentlyContinue
  Register-IsolatedExtension `
    -ExtensionsDir $resolvedExtensionsDir `
    -Identifier $Identifier `
    -Version $Version `
    -ExtensionDir $targetDir
  return $targetDir
}

function Initialize-WindowMover {
  if ("IntentumDiffReleaseDemo.Window" -as [type]) {
    return
  }
  Add-Type -TypeDefinition @"
namespace IntentumDiffReleaseDemo {
  using System;
  using System.Diagnostics;
  using System.Runtime.InteropServices;
  using System.Text;
  using System.Text.RegularExpressions;

  public static class Window {
    public delegate bool EnumWindowsProc(IntPtr hWnd, IntPtr lParam);
    [DllImport("user32.dll")]
    public static extern bool EnumWindows(EnumWindowsProc callback, IntPtr lParam);
    [DllImport("user32.dll", SetLastError = true)]
    public static extern bool IsWindowVisible(IntPtr hWnd);
    [DllImport("user32.dll", CharSet = CharSet.Unicode)]
    public static extern int GetWindowText(IntPtr hWnd, StringBuilder text, int count);
    [DllImport("user32.dll", CharSet = CharSet.Unicode)]
    public static extern int GetWindowTextLength(IntPtr hWnd);
    [DllImport("user32.dll")]
    public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint processId);
    [DllImport("user32.dll")]
    public static extern bool GetWindowRect(IntPtr hWnd, out RECT rect);
    [DllImport("user32.dll", SetLastError = true)]
    public static extern bool MoveWindow(IntPtr hWnd, int x, int y, int width, int height, bool repaint);
    [DllImport("user32.dll", SetLastError = true)]
    public static extern bool SetForegroundWindow(IntPtr hWnd);
    [DllImport("user32.dll")]
    public static extern bool BringWindowToTop(IntPtr hWnd);
    [DllImport("user32.dll")]
    public static extern IntPtr SetActiveWindow(IntPtr hWnd);
    [DllImport("user32.dll")]
    public static extern IntPtr SetFocus(IntPtr hWnd);
    [DllImport("user32.dll")]
    public static extern bool ShowWindow(IntPtr hWnd, int nCmdShow);
    [DllImport("user32.dll")]
    public static extern bool SetWindowPos(IntPtr hWnd, IntPtr hWndInsertAfter, int X, int Y, int cx, int cy, uint uFlags);

    public struct RECT { public int Left; public int Top; public int Right; public int Bottom; }

    public sealed class WindowInfo {
      public IntPtr Handle { get; set; }
      public string Title { get; set; }
      public string MainWindowTitle { get { return Title; } }
      public int ProcessId { get; set; }
      public string ProcessPath { get; set; }
      public int Area { get; set; }
      public WindowInfo() {
        Title = "";
        ProcessPath = "";
      }
    }

    public static string GetTitle(IntPtr hWnd) {
      int length = GetWindowTextLength(hWnd);
      if (length <= 0) { return String.Empty; }
      StringBuilder text = new StringBuilder(length + 1);
      GetWindowText(hWnd, text, text.Capacity);
      return text.ToString();
    }

    private static bool MatchesWildcard(string value, string pattern) {
      if (String.IsNullOrEmpty(pattern) || pattern == "*") { return true; }
      string expression = "^" + Regex.Escape(pattern).Replace("\\*", ".*").Replace("\\?", ".") + "$";
      return Regex.IsMatch(value ?? "", expression, RegexOptions.IgnoreCase | RegexOptions.CultureInvariant);
    }

    private static string ProcessPathFor(uint processId) {
      try {
        using (Process process = Process.GetProcessById((int)processId)) {
          try { return process.MainModule.FileName ?? process.ProcessName; }
          catch { return process.ProcessName; }
        }
      } catch {
        return "";
      }
    }

    public static WindowInfo FindVisibleWindow(string titlePattern, string pathPattern) {
      WindowInfo best = null;
      EnumWindows((hWnd, lParam) => {
        if (!IsWindowVisible(hWnd)) { return true; }
        string title = GetTitle(hWnd);
        if (String.IsNullOrWhiteSpace(title)) { return true; }
        uint processId;
        GetWindowThreadProcessId(hWnd, out processId);
        string processPath = ProcessPathFor(processId);
        if (!MatchesWildcard(title, titlePattern)) { return true; }
        if (!MatchesWildcard(processPath, pathPattern)) { return true; }
        RECT rect;
        int area = 0;
        if (GetWindowRect(hWnd, out rect)) {
          area = Math.Max(0, rect.Right - rect.Left) * Math.Max(0, rect.Bottom - rect.Top);
        }
        WindowInfo current = new WindowInfo {
          Handle = hWnd,
          Title = title,
          ProcessId = (int)processId,
          ProcessPath = processPath,
          Area = area
        };
        if (best == null || current.Area > best.Area) {
          best = current;
        }
        return true;
      }, IntPtr.Zero);
      return best;
    }

    public static void PlaceWindow(IntPtr hWnd, int x, int y, int width, int height) {
      ShowWindow(hWnd, 1);
      MoveWindow(hWnd, x, y, width, height, true);
      SetWindowPos(hWnd, new IntPtr(-1), x, y, width, height, 0x0040);
      BringWindowToTop(hWnd);
      SetForegroundWindow(hWnd);
      SetActiveWindow(hWnd);
      SetFocus(hWnd);
    }
  }
}
"@
}

function Move-DemoWindow {
  param(
    [Parameter(Mandatory = $true)]
    [System.Diagnostics.Process]$Process,
    [Parameter(Mandatory = $true)]
    [hashtable]$Region
  )
  Initialize-WindowMover
  for ($attempt = 0; $attempt -lt 30; $attempt++) {
    $Process.Refresh()
    if ($Process.MainWindowHandle -ne [IntPtr]::Zero) {
      [IntentumDiffReleaseDemo.Window]::PlaceWindow(
        $Process.MainWindowHandle,
        $Region.X,
        $Region.Y,
        $Region.Width,
        $Region.Height
      ) | Out-Null
      return
    }
    Start-Sleep -Milliseconds 250
  }
  Write-Warning "Could not find the demo window handle; recording will still use the configured capture region."
}

function Wait-VsCodeWindowByTitle {
  param(
    [Parameter(Mandatory = $true)]
    [string]$TitlePattern,
    [Parameter(Mandatory = $true)]
    [string]$PathPattern,
    [Parameter(Mandatory = $true)]
    [int]$TimeoutSeconds,
    [hashtable]$Region
  )
  Initialize-WindowMover
  $deadline = (Get-Date).AddSeconds($TimeoutSeconds)
  while ((Get-Date) -lt $deadline) {
    $candidate = [IntentumDiffReleaseDemo.Window]::FindVisibleWindow($TitlePattern, $PathPattern)
    if ($null -ne $candidate) {
      if ($null -ne $Region) {
        [IntentumDiffReleaseDemo.Window]::PlaceWindow(
          $candidate.Handle,
          $Region.X,
          $Region.Y,
          $Region.Width,
          $Region.Height
        ) | Out-Null
      }
      return $candidate
    }
    Start-Sleep -Milliseconds 500
  }
  throw "Timed out waiting for VS Code window '$TitlePattern'. Check the isolated VS Code logs under DemoRoot."
}

function Get-IsolatedVsCodeWindow {
  param(
    [Parameter(Mandatory = $true)]
    [datetime]$StartedAt,
    [Parameter(Mandatory = $true)]
    [string]$ExecutablePath
  )
  $resolvedExecutable = [System.IO.Path]::GetFullPath($ExecutablePath)
  $candidatePids = Get-CimInstance Win32_Process |
    Where-Object {
      $_.ExecutablePath -and
      [System.IO.Path]::GetFullPath($_.ExecutablePath).Equals($resolvedExecutable, [System.StringComparison]::OrdinalIgnoreCase)
    } |
    Select-Object -ExpandProperty ProcessId

  if (-not $candidatePids) {
    return $null
  }

  Get-Process -ErrorAction SilentlyContinue |
    Where-Object {
      $_.Id -in $candidatePids -and
      $_.MainWindowHandle -ne [IntPtr]::Zero -and
      $_.StartTime -ge $StartedAt.AddSeconds(-2)
    } |
    Sort-Object StartTime -Descending |
    Select-Object -First 1
}

function Move-LatestVsCodeWindow {
  param(
    [Parameter(Mandatory = $true)]
    [datetime]$StartedAt,
    [Parameter(Mandatory = $true)]
    [string]$ExecutablePath,
    [Parameter(Mandatory = $true)]
    [hashtable]$Region
  )
  Initialize-WindowMover
  for ($attempt = 0; $attempt -lt 80; $attempt++) {
    $candidate = Get-IsolatedVsCodeWindow -StartedAt $StartedAt -ExecutablePath $ExecutablePath
    if ($null -ne $candidate) {
      [IntentumDiffReleaseDemo.Window]::PlaceWindow(
        $candidate.MainWindowHandle,
        $Region.X,
        $Region.Y,
        $Region.Width,
        $Region.Height
      ) | Out-Null
      return
    }
    Start-Sleep -Milliseconds 250
  }
  throw "Could not find a visible isolated VS Code window for executable: $ExecutablePath"
}

function New-CliDemoScript {
  param(
    [Parameter(Mandatory = $true)]
    [string]$DemoDir,
    [Parameter(Mandatory = $true)]
    [string]$RepoRoot,
    [Parameter(Mandatory = $true)]
    [string]$UvPath,
    [Parameter(Mandatory = $true)]
    [int]$StartDelaySeconds,
    [Parameter(Mandatory = $true)]
    [int]$HoldSeconds
  )

  New-Item -ItemType Directory -Force -Path $DemoDir | Out-Null
  Set-Content -LiteralPath (Join-Path $DemoDir "before.py") -Encoding UTF8 -Value @'
def total_for_invoice(invoice):
    subtotal = sum(item.price for item in invoice.items)
    return subtotal + tax_for(invoice.customer.region)

def tax_for(region):
    return 0 if region == "EXEMPT" else 12
'@
  Set-Content -LiteralPath (Join-Path $DemoDir "after.py") -Encoding UTF8 -Value @'
def tax_for(region):
    return 0 if region == "EXEMPT" else 12

def calculate_invoice_total(invoice):
    subtotal = sum(item.price for item in invoice.items)
    discount = invoice.customer.discount
    return subtotal - discount + tax_for(invoice.customer.region)
'@

  $demoScript = Join-Path $DemoDir "run-cli-demo.ps1"
  $repoLiteral = ConvertTo-PSQuotedString -Value $RepoRoot
  $demoLiteral = ConvertTo-PSQuotedString -Value $DemoDir
  $beforeLiteral = ConvertTo-PSQuotedString -Value (Join-Path $DemoDir "before.py")
  $afterLiteral = ConvertTo-PSQuotedString -Value (Join-Path $DemoDir "after.py")
  $uvLiteral = ConvertTo-PSQuotedString -Value $UvPath
  Set-Content -LiteralPath $demoScript -Encoding UTF8 -Value @"
`$ErrorActionPreference = "Continue"
`$Host.UI.RawUI.WindowTitle = "IntentumDiff CLI demo"
Set-Location $repoLiteral
`$BeforePath = $beforeLiteral
`$AfterPath = $afterLiteral
Start-Sleep -Seconds $StartDelaySeconds
Clear-Host

function Write-Step {
  param([string]`$Text)
  Write-Host ""
  Write-Host "intentumdiff> " -ForegroundColor Cyan -NoNewline
  Write-Host `$Text -ForegroundColor White
  Start-Sleep -Milliseconds 900
}

function Invoke-IntentumDiff {
  param([string[]]`$IntentArgs)
  `$command = Get-Command "intentumdiff" -ErrorAction SilentlyContinue
  if (`$null -ne `$command) {
    & `$command.Source @IntentArgs
    return
  }
  & $uvLiteral run --no-sync python -m intentumdiff.cli @IntentArgs
}

Write-Host "IntentumDiff" -ForegroundColor Cyan
Write-Host "Semantic review shell" -ForegroundColor Yellow
Write-Host "Diff with meaning." -ForegroundColor DarkCyan

Write-Step "intentumdiff --version"
Invoke-IntentumDiff @("--version")

Start-Sleep -Seconds 1
Write-Step "intentumdiff file before.py after.py --format terminal"
Invoke-IntentumDiff @("--no-banner", "file", `$BeforePath, `$AfterPath, "--format", "terminal")

Start-Sleep -Seconds 1
Write-Step "pip install intentumdiff"
Write-Host "Install the beta from PyPI, then run IntentumDiff from any repository." -ForegroundColor Gray
Start-Sleep -Seconds $HoldSeconds
"@
  return $demoScript
}

function Start-CliAutoStage {
  param(
    [Parameter(Mandatory = $true)]
    [string]$RepoRoot,
    [Parameter(Mandatory = $true)]
    [string]$TempDir,
    [Parameter(Mandatory = $true)]
    [string]$UvName,
    [Parameter(Mandatory = $true)]
    [int]$DurationSeconds,
    [Parameter(Mandatory = $true)]
    [int]$StartDelaySeconds,
    [hashtable]$Region
  )

  $uvPath = Resolve-Executable -Name $UvName
  $demoDir = Join-Path $TempDir "cli-demo"
  $demoScript = New-CliDemoScript -DemoDir $demoDir -RepoRoot $RepoRoot -UvPath $uvPath -StartDelaySeconds $StartDelaySeconds -HoldSeconds ([Math]::Max(4, $DurationSeconds + 2))
  $powershell = Resolve-Executable -Name "powershell.exe"
  $process = Start-Process -FilePath $powershell -ArgumentList @(
    "-NoProfile",
    "-ExecutionPolicy", "Bypass",
    "-File", $demoScript
  ) -WorkingDirectory $RepoRoot -PassThru
  if ($null -ne $Region) {
    Move-DemoWindow -Process $process -Region $Region
  }
  return $process
}

function Write-DemoTextFile {
  param(
    [Parameter(Mandatory = $true)]
    [string]$Workspace,
    [Parameter(Mandatory = $true)]
    [string]$RelativePath,
    [Parameter(Mandatory = $true)]
    [string]$Value
  )
  $path = Join-Path $Workspace $RelativePath
  $parent = Split-Path -Parent $path
  if ($parent) {
    New-Item -ItemType Directory -Force -Path $parent | Out-Null
  }
  Set-Utf8NoBomContent -PathValue $path -Value $Value
}

function Write-DemoBase64File {
  param(
    [Parameter(Mandatory = $true)]
    [string]$Workspace,
    [Parameter(Mandatory = $true)]
    [string]$RelativePath,
    [Parameter(Mandatory = $true)]
    [string]$Base64Value
  )
  $path = Join-Path $Workspace $RelativePath
  $directory = Split-Path -Parent $path
  if ($directory) {
    New-Item -ItemType Directory -Force -Path $directory | Out-Null
  }
  [System.IO.File]::WriteAllBytes($path, [System.Convert]::FromBase64String($Base64Value))
}

function New-SchemaCacheEntry {
  param(
    [Parameter(Mandatory = $true)]
    [string]$LocalAppDataDir,
    [Parameter(Mandatory = $true)]
    [string]$SourceUrl,
    [Parameter(Mandatory = $true)]
    [string]$ProviderId,
    [Parameter(Mandatory = $true)]
    [string[]]$IdentityFields
  )
  $cacheRoot = Join-Path $LocalAppDataDir "intentumdiff\schemas"
  New-Item -ItemType Directory -Force -Path $cacheRoot | Out-Null
  $sha = [System.Security.Cryptography.SHA256]::Create()
  try {
    $urlBytes = [System.Text.Encoding]::UTF8.GetBytes($SourceUrl)
    $digest = [System.BitConverter]::ToString($sha.ComputeHash($urlBytes)).Replace("-", "").ToLowerInvariant()
    $schemaText = $ProviderId + ":" + ($IdentityFields -join ",")
    $schemaDigest = [System.BitConverter]::ToString($sha.ComputeHash([System.Text.Encoding]::UTF8.GetBytes($schemaText))).Replace("-", "").ToLowerInvariant()
  } finally {
    $sha.Dispose()
  }
  $properties = [ordered]@{}
  foreach ($field in $IdentityFields) {
    $properties[$field] = [ordered]@{ "type" = "string" }
  }
  $metadata = [ordered]@{
    "provider_id" = $ProviderId
    "source_url" = $SourceUrl
    "final_url" = $SourceUrl
    "fetched_at" = [int][DateTimeOffset]::UtcNow.ToUnixTimeSeconds()
    "content_hash" = $schemaDigest
    "byte_size" = 512
    "schema" = [ordered]@{
      "`$schema" = "https://json-schema.org/draft/2020-12/schema"
      "type" = "object"
      "properties" = $properties
    }
  }
  $path = Join-Path $cacheRoot "$digest.json"
  $cacheJson = $metadata | ConvertTo-Json -Depth 20
  Set-Utf8NoBomContent -PathValue $path -Value $cacheJson
}

function Initialize-VsCodeDemoSceneBaseline {
  param(
    [Parameter(Mandatory = $true)]
    [string]$Workspace,
    [Parameter(Mandatory = $true)]
    [ValidateSet("review", "guardrails", "schema", "language-sweep", "binary-image")]
    [string]$Scene,
    [Parameter(Mandatory = $true)]
    [string]$LocalAppDataDir
  )
  New-Item -ItemType Directory -Force -Path (Join-Path $Workspace ".vscode") | Out-Null
  Write-DemoTextFile -Workspace $Workspace -RelativePath "README.md" -Value @'
# IntentumDiff release demo workspace

This temporary workspace is generated by the release recording script.
'@

  switch ($Scene) {
    "review" {
      Write-DemoTextFile -Workspace $Workspace -RelativePath "src\billing.py" -Value @'
def tax_for(region):
    return 0 if region == "EXEMPT" else 12

def total_for_invoice(invoice):
    subtotal = sum(item.price for item in invoice.items)
    return subtotal + tax_for(invoice.customer.region)
'@
      return [ordered]@{
        FocusPath = "src/billing.py"
        DiffPath = "src/billing.py"
        PositionLine = 3
      }
    }
    "guardrails" {
      Write-DemoTextFile -Workspace $Workspace -RelativePath "intentumdiff.yaml" -Value @'
guardrails:
  protected:
    - id: production-api-host
      language: yaml
      path: service.host
      severity: immutable
      message: Production API host changed
      files:
        - config/*.yaml
'@
      Write-DemoTextFile -Workspace $Workspace -RelativePath "config\service.yaml" -Value @'
service:
  host: api.production.intentumdiff.local
  timeout_seconds: 30
  retries: 2
'@
      return [ordered]@{
        FocusPath = "config/service.yaml"
        DiffPath = "config/service.yaml"
        PositionLine = 2
      }
    }
    "schema" {
      $databricksUrl = "https://raw.githubusercontent.com/databricks/cli/main/bundle/schema/jsonschema.json"
      $dbtUrl = "https://raw.githubusercontent.com/dbt-labs/dbt-jsonschema/main/schemas/latest/dbt_project-latest.json"
      New-SchemaCacheEntry -LocalAppDataDir $LocalAppDataDir -SourceUrl $databricksUrl -ProviderId "databricks:bundle" -IdentityFields @("name", "job_cluster_key", "task_key")
      New-SchemaCacheEntry -LocalAppDataDir $LocalAppDataDir -SourceUrl $dbtUrl -ProviderId "dbt:dbt_project" -IdentityFields @("name", "package")
      Write-DemoTextFile -Workspace $Workspace -RelativePath "databricks.yml" -Value @'
bundle:
  name: retail-intent

resources:
  jobs:
    invoice_review:
      name: invoice-review
      tasks:
        - task_key: validate
          notebook_task:
            notebook_path: ./notebooks/validate
'@
      Write-DemoTextFile -Workspace $Workspace -RelativePath "dbt_project.yml" -Value @'
name: intentumdiff_demo
version: 1.0.0
profile: demo

models:
  intentumdiff_demo:
    +materialized: table
'@
      Write-DemoTextFile -Workspace $Workspace -RelativePath "factory\pipeline.json" -Value @'
{
  "name": "LoadInvoices",
  "properties": {
    "activities": [
      { "name": "CopyInvoices", "type": "Copy" }
    ]
  }
}
'@
      return [ordered]@{
        FocusPath = "databricks.yml"
        DiffPath = "databricks.yml"
        PositionLine = 6
      }
    }
    "language-sweep" {
      Write-DemoTextFile -Workspace $Workspace -RelativePath "LANGUAGE_SWEEP.md" -Value @'
# IntentumDiff language sweep

This demo workspace changes representative Python, TypeScript, Go, Rust, SQL,
JSON, YAML, Dockerfile, Markdown, and shell files so the review tree shows
language-agnostic semantic coverage without hiding raw evidence.
'@
      Write-DemoTextFile -Workspace $Workspace -RelativePath "src\app.py" -Value @'
def greet(name):
    return f"hello {name}"
'@
      Write-DemoTextFile -Workspace $Workspace -RelativePath "web\panel.ts" -Value @'
export function label(value: string): string {
  return value.trim();
}
'@
      Write-DemoTextFile -Workspace $Workspace -RelativePath "services\main.go" -Value @'
package main

func label(value string) string {
	return value
}
'@
      Write-DemoTextFile -Workspace $Workspace -RelativePath "crates\demo.rs" -Value @'
pub fn label(value: &str) -> &str {
    value
}
'@
      Write-DemoTextFile -Workspace $Workspace -RelativePath "data\job.json" -Value @'
{
  "name": "daily-refresh",
  "timeout": 30
}
'@
      Write-DemoTextFile -Workspace $Workspace -RelativePath "config\service.yaml" -Value @'
service:
  name: api
  replicas: 2
'@
      Write-DemoTextFile -Workspace $Workspace -RelativePath "sql\report.sql" -Value @'
select id, total
from invoices
where status = 'open';
'@
      Write-DemoTextFile -Workspace $Workspace -RelativePath "Dockerfile" -Value @'
FROM python:3.12-slim
CMD ["python", "-m", "app"]
'@
      Write-DemoTextFile -Workspace $Workspace -RelativePath "scripts\deploy.sh" -Value @'
set -eu
echo "deploy"
'@
      return [ordered]@{
        FocusPath = "LANGUAGE_SWEEP.md"
        DiffPath = "src/app.py"
        PositionLine = 1
      }
    }
    "binary-image" {
      Write-DemoTextFile -Workspace $Workspace -RelativePath "README.md" -Value @'
# IntentumDiff perceptual asset demo

This scene stages a real PNG asset change. The Binary/Image tab consumes
Rust-produced perceptual asset JSON when attached by the release workflow.
'@
      Write-DemoBase64File -Workspace $Workspace -RelativePath "assets\intentumdiff-card.png" -Base64Value "iVBORw0KGgoAAAANSUhEUgAAAAQAAAAECAIAAAAmkwkpAAAAFklEQVR4nGNkYPjPgAkwMaACUvkVAABf1gQFnH4XnAAAAABJRU5ErkJggg=="
      return [ordered]@{
        FocusPath = "README.md"
        DiffPath = "assets/intentumdiff-card.png"
        PositionLine = 1
      }
    }
  }
}

function Update-VsCodeDemoSceneWorkingTree {
  param(
    [Parameter(Mandatory = $true)]
    [string]$Workspace,
    [Parameter(Mandatory = $true)]
    [ValidateSet("review", "guardrails", "schema", "language-sweep", "binary-image")]
    [string]$Scene
  )
  switch ($Scene) {
    "review" {
      Write-DemoTextFile -Workspace $Workspace -RelativePath "src\billing.py" -Value @'
def tax_for(region):
    return 0 if region == "EXEMPT" else 12

def calculate_invoice_total(invoice):
    subtotal = sum(item.price for item in invoice.items)
    discount = invoice.customer.discount
    return subtotal - discount + tax_for(invoice.customer.region)
'@
      Write-DemoTextFile -Workspace $Workspace -RelativePath "src\review_policy.py" -Value @'
REVIEW_MODE = "semantic"
'@
    }
    "guardrails" {
      Write-DemoTextFile -Workspace $Workspace -RelativePath "config\service.yaml" -Value @'
service:
  host: api.staging.intentumdiff.local
  timeout_seconds: 45
  retries: 2
'@
    }
    "schema" {
      Write-DemoTextFile -Workspace $Workspace -RelativePath "databricks.yml" -Value @'
bundle:
  name: retail-intent

resources:
  jobs:
    invoice_review:
      name: invoice-review
      tasks:
        - task_key: validate
          job_cluster_key: shared-small
          notebook_task:
            notebook_path: ./notebooks/validate_v2
'@
      Write-DemoTextFile -Workspace $Workspace -RelativePath "dbt_project.yml" -Value @'
name: intentumdiff_demo
version: 1.0.0
profile: demo

models:
  intentumdiff_demo:
    +materialized: incremental
'@
      Write-DemoTextFile -Workspace $Workspace -RelativePath "factory\pipeline.json" -Value @'
{
  "name": "LoadInvoices",
  "properties": {
    "activities": [
      { "name": "CopyInvoices", "type": "Copy" },
      { "name": "ValidateInvoices", "type": "Validation" }
    ]
  }
}
'@
    }
    "language-sweep" {
      Write-DemoTextFile -Workspace $Workspace -RelativePath "src\app.py" -Value @'
def greet(name):
    cleaned = name.strip()
    return f"hello {cleaned}"
'@
      Write-DemoTextFile -Workspace $Workspace -RelativePath "web\panel.ts" -Value @'
export function label(value: string): string {
  const cleaned = value.trim();
  return cleaned.toUpperCase();
}
'@
      Write-DemoTextFile -Workspace $Workspace -RelativePath "services\main.go" -Value @'
package main

func label(value string) string {
	return "intent:" + value
}
'@
      Write-DemoTextFile -Workspace $Workspace -RelativePath "crates\demo.rs" -Value @'
pub fn label(value: &str) -> String {
    format!("intent:{value}")
}
'@
      Write-DemoTextFile -Workspace $Workspace -RelativePath "data\job.json" -Value @'
{
  "name": "daily-refresh",
  "timeout": 45,
  "retries": 2
}
'@
      Write-DemoTextFile -Workspace $Workspace -RelativePath "config\service.yaml" -Value @'
service:
  name: api
  replicas: 3
'@
      Write-DemoTextFile -Workspace $Workspace -RelativePath "sql\report.sql" -Value @'
select id, total, updated_at
from invoices
where status in ('open', 'held');
'@
      Write-DemoTextFile -Workspace $Workspace -RelativePath "Dockerfile" -Value @'
FROM python:3.12-slim
ENV INTENTUMDIFF_DEMO=1
CMD ["python", "-m", "app"]
'@
      Write-DemoTextFile -Workspace $Workspace -RelativePath "scripts\deploy.sh" -Value @'
set -eu
echo "deploy"
echo "verify semantic review"
'@
    }
    "binary-image" {
      Write-DemoBase64File -Workspace $Workspace -RelativePath "assets\intentumdiff-card.png" -Base64Value "iVBORw0KGgoAAAANSUhEUgAAAAQAAAAECAIAAAAmkwkpAAAAFklEQVR4nGNk+M+ABTAxoAJS+RUAAF8BBAWcfhecAAAAAElFTkSuQmCC"
    }
  }
}

function Start-VsCodeAutoStage {
  param(
    [Parameter(Mandatory = $true)]
    [string]$RepoRoot,
    [Parameter(Mandatory = $true)]
    [string]$CodeName,
    [Parameter(Mandatory = $true)]
    [string]$UvName,
    [Parameter(Mandatory = $true)]
    [string]$DemoRootPath,
    [Parameter(Mandatory = $true)]
    [int]$StartDelaySeconds,
    [Parameter(Mandatory = $true)]
    [int]$DurationSeconds,
    [string]$StartMarkerPath,
    [switch]$WaitForFinalState,
    [hashtable]$Region,
    [Parameter(Mandatory = $true)]
    [ValidateSet("dashboard", "review", "intent", "risk", "evidence", "notes", "release-notes", "binary-image", "guardrails", "schema", "language-sweep", "narrow", "light-theme")]
    [string]$Scene
  )
  $codePath = Resolve-VsCodeExecutableForDemo -RepoRoot $RepoRoot -CodeName $CodeName
  Write-Host "  Using VS Code executable: $codePath"
  if ($codePath -like "*\.vscode-test\*") {
    Stop-ProcessesForExecutable -ExecutablePath $codePath
    Disable-VsCodeTestHostUpdateCheck -ExecutablePath $codePath
  }
  $uvPath = Resolve-Executable -Name $UvName
  $npmPath = Resolve-Executable -Name "npm.cmd"
  $npxPath = Resolve-Executable -Name "npx.cmd"
  $gitPath = Resolve-Executable -Name "git"
  $demoRootFull = [System.IO.Path]::GetFullPath($DemoRootPath)
  New-Item -ItemType Directory -Force -Path $demoRootFull | Out-Null

  $workspace = Join-Path $demoRootFull "vscode-workspace"
  $userDataDir = Join-Path $demoRootFull "vscode-user-data"
  $extensionsDir = Join-Path $demoRootFull "vscode-extensions"
  $localAppDataDir = Join-Path $demoRootFull "local-app-data"
  $driverDir = Join-Path $extensionsDir "intentumdiff.intentumdiff-demo-driver-0.0.0"
  $driverVsixPath = Join-Path $demoRootFull "intentumdiff-demo-driver.vsix"
  $intentumdiffExe = Join-Path $demoRootFull "intentumdiff-demo-runner.exe"
  $vsixPath = Join-Path $demoRootFull "intentumdiff-vscode-recording.vsix"
  $extensionDir = Join-Path $RepoRoot "plugins\vscode"

  Stop-DemoProcessesUnderRoot -DemoRootPath $demoRootFull
  Reset-DirectoryUnderDemoRoot -PathValue $workspace -DemoRootPath $demoRootFull
  Reset-DirectoryUnderDemoRoot -PathValue $userDataDir -DemoRootPath $demoRootFull
  Reset-DirectoryUnderDemoRoot -PathValue $extensionsDir -DemoRootPath $demoRootFull
  Reset-DirectoryUnderDemoRoot -PathValue $localAppDataDir -DemoRootPath $demoRootFull

  $contentScene = Resolve-VsCodeDemoContentScene -Scene $Scene
  $reviewView = Resolve-VsCodeDemoReviewView -Scene $Scene
  $openCustomPanel = $Scene -notin @("dashboard", "language-sweep")
  $openSemanticDiff = $Scene -notin @("dashboard", "binary-image")

  $sceneInfo = Initialize-VsCodeDemoSceneBaseline `
    -Workspace $workspace `
    -Scene $contentScene `
    -LocalAppDataDir $localAppDataDir
  Invoke-External -Label "Initializing demo git repository" -FilePath $gitPath -Arguments @("init") -WorkingDirectory $workspace
  Invoke-External -Label "Configuring demo git author" -FilePath $gitPath -Arguments @("config", "user.name", "IntentumDiff Demo") -WorkingDirectory $workspace
  Invoke-External -Label "Configuring demo git email" -FilePath $gitPath -Arguments @("config", "user.email", "demo@intentumdiff.local") -WorkingDirectory $workspace
  Invoke-External -Label "Committing demo baseline" -FilePath $gitPath -Arguments @("add", ".") -WorkingDirectory $workspace
  Invoke-External -Label "Creating demo baseline commit" -FilePath $gitPath -Arguments @("commit", "-m", "baseline") -WorkingDirectory $workspace
  Update-VsCodeDemoSceneWorkingTree -Workspace $workspace -Scene $contentScene

  Write-Host "  Creating isolated IntentumDiff runner executable"
  New-IntentumDiffRunnerExe -RunnerPath $intentumdiffExe -RepoRoot $RepoRoot -UvPath $uvPath
  Invoke-External -Label "Verifying isolated IntentumDiff runner" -FilePath $intentumdiffExe -Arguments @("--version")

  Invoke-External -Label "Compiling VS Code extension" -FilePath $npmPath -Arguments @("run", "compile") -WorkingDirectory $extensionDir
  Invoke-External -Label "Packaging VSIX to temp directory" -FilePath $npxPath -Arguments @(
    "@vscode/vsce", "package",
    "--out", $vsixPath,
    "--baseContentUrl", "https://github.com/buchochelliq-labs/intentumdiff/blob/HEAD/plugins/vscode",
    "--baseImagesUrl", "https://github.com/buchochelliq-labs/intentumdiff/raw/HEAD/plugins/vscode"
  ) -WorkingDirectory $extensionDir
  $extensionPackage = Get-Content -LiteralPath (Join-Path $extensionDir "package.json") -Raw | ConvertFrom-Json
  $extensionIdentifier = "$($extensionPackage.publisher).$($extensionPackage.name)"
  $installedExtensionDir = Install-VsixIntoIsolatedExtensionDir `
    -VsixPath $vsixPath `
    -ExtensionsDir $extensionsDir `
    -Identifier $extensionIdentifier `
    -Version $extensionPackage.version
  Write-Host "  Registered isolated IntentumDiff extension: $installedExtensionDir"

  New-Item -ItemType Directory -Force -Path (Join-Path $userDataDir "User") | Out-Null
  [ordered]@{
    "intentumdiff.executable" = $intentumdiffExe
    "intentumdiff.ref" = "HEAD"
    "intentumdiff.review.pollIntervalMs" = 500
    "intentumdiff.debounceMs" = 100
    "intentumdiff.schemas.fetchMode" = "cache-only"
    "intentumdiff.schemas.allowPrivateHosts" = $false
    "intentumdiff.trace" = $false
    "scm.showHistoryGraph" = $false
    "scm.showGraph" = $false
    "scm.graph.enabled" = $false
    "git.enabled" = $false
    "git.showHistoryGraph" = $false
    "window.zoomLevel" = 0.35
    "workbench.startupEditor" = "none"
    "workbench.colorTheme" = if ($Scene -eq "light-theme") { "Default Light Modern" } else { "Default Dark Modern" }
    "workbench.iconTheme" = "vs-seti"
    "workbench.tree.indent" = 18
    "workbench.list.smoothScrolling" = $true
    "workbench.commandPalette.experimental.suggestCommands" = $false
    "workbench.secondarySideBar.defaultVisibility" = "hidden"
    "workbench.layoutControl.enabled" = $false
    "window.commandCenter" = $false
    "editor.fontSize" = 14
    "editor.lineHeight" = 22
    "editor.minimap.enabled" = $false
    "editor.renderWhitespace" = "none"
    "diffEditor.renderSideBySide" = $true
    "diffEditor.ignoreTrimWhitespace" = $false
    "chat.commandCenter.enabled" = $false
    "chat.agent.enabled" = $false
    "github.copilot.chat.welcomeMessage" = "never"
    "extensions.ignoreRecommendations" = $true
    "security.workspace.trust.enabled" = $false
    "telemetry.telemetryLevel" = "off"
    "workbench.colorCustomizations" = if ($Scene -eq "light-theme") { [ordered]@{
      "activityBar.background" = "#f8fbff"
      "activityBar.foreground" = "#0969da"
      "activityBar.activeBorder" = "#0969da"
      "sideBar.background" = "#ffffff"
      "sideBar.foreground" = "#152033"
      "sideBarSectionHeader.background" = "#eef4fb"
      "sideBarSectionHeader.foreground" = "#152033"
      "list.activeSelectionBackground" = "#dceeff"
      "list.activeSelectionForeground" = "#0969da"
      "list.focusBackground" = "#eaf4ff"
      "list.highlightForeground" = "#0969da"
      "list.inactiveSelectionBackground" = "#eef4fb"
      "statusBar.background" = "#eaf4ff"
      "statusBar.foreground" = "#152033"
      "statusBarItem.prominentBackground" = "#dceeff"
      "editor.background" = "#ffffff"
      "editorLineNumber.foreground" = "#6f849e"
      "editorGutter.modifiedBackground" = "#bf8700"
      "diffEditor.insertedTextBackground" = "#2ea04329"
      "diffEditor.removedTextBackground" = "#f8514933"
      "diffEditor.insertedLineBackground" = "#2ea0431f"
      "diffEditor.removedLineBackground" = "#f8514926"
      "intentumdiff.semanticChanges.root" = "#0969da"
      "intentumdiff.semanticChanges.fileWithGroups" = "#0969da"
      "intentumdiff.semanticChanges.movedCode" = "#0f766e"
      "intentumdiff.semanticChanges.refactoring" = "#6741d9"
      "intentumdiff.semanticChanges.meaningful" = "#9a6700"
      "intentumdiff.semanticChanges.ignoredStyle" = "#1a7f37"
      "intentumdiff.semanticChanges.noiseSuppressed" = "#6f849e"
      "intentumdiff.semanticChanges.rawChange" = "#6741d9"
      "intentumdiff.semanticChanges.addition" = "#1a7f37"
      "intentumdiff.semanticChanges.deletion" = "#cf222e"
      "intentumdiff.semanticChanges.modification" = "#9a6700"
      "intentumdiff.semanticChanges.reorder" = "#6f849e"
      "intentumdiff.semanticChanges.crossFile" = "#bc4c00"
      "intentumdiff.semanticChanges.guardrail" = "#cf222e"
      "intentumdiff.semanticChanges.schemaStatus" = "#0969da"
      "intentumdiff.semanticChanges.muted" = "#6f849e"
    } } else { [ordered]@{
      "activityBar.background" = "#111827"
      "activityBar.foreground" = "#7ee787"
      "activityBar.activeBorder" = "#4fd6ff"
      "sideBar.background" = "#111827"
      "sideBar.foreground" = "#dce8f8"
      "sideBarSectionHeader.background" = "#172033"
      "sideBarSectionHeader.foreground" = "#f8fbff"
      "list.activeSelectionBackground" = "#173b4f"
      "list.activeSelectionForeground" = "#ffffff"
      "list.focusBackground" = "#173b4f"
      "list.highlightForeground" = "#4fd6ff"
      "list.inactiveSelectionBackground" = "#1f2937"
      "statusBar.background" = "#12313f"
      "statusBar.foreground" = "#dffcff"
      "statusBarItem.prominentBackground" = "#0f766e"
      "editor.background" = "#0f1720"
      "editorLineNumber.foreground" = "#5f6f86"
      "editorGutter.modifiedBackground" = "#f7c14d"
      "diffEditor.insertedTextBackground" = "#164e343d"
      "diffEditor.removedTextBackground" = "#7f1d1d42"
      "diffEditor.insertedLineBackground" = "#123f2d55"
      "diffEditor.removedLineBackground" = "#4a162255"
      "intentumdiff.semanticChanges.root" = "#4fd6ff"
      "intentumdiff.semanticChanges.fileWithGroups" = "#4fd6ff"
      "intentumdiff.semanticChanges.movedCode" = "#56d6c2"
      "intentumdiff.semanticChanges.refactoring" = "#b58cff"
      "intentumdiff.semanticChanges.meaningful" = "#f7c14d"
      "intentumdiff.semanticChanges.ignoredStyle" = "#7ee787"
      "intentumdiff.semanticChanges.noiseSuppressed" = "#9aa4b2"
      "intentumdiff.semanticChanges.rawChange" = "#d2a8ff"
      "intentumdiff.semanticChanges.addition" = "#7ee787"
      "intentumdiff.semanticChanges.deletion" = "#ff6b6b"
      "intentumdiff.semanticChanges.modification" = "#f7c14d"
      "intentumdiff.semanticChanges.reorder" = "#9aa4b2"
      "intentumdiff.semanticChanges.crossFile" = "#ffab70"
      "intentumdiff.semanticChanges.guardrail" = "#ff6b6b"
      "intentumdiff.semanticChanges.schemaStatus" = "#4fd6ff"
      "intentumdiff.semanticChanges.muted" = "#8b949e"
    } }
  } | ConvertTo-Json -Depth 20 | Set-Content -LiteralPath (Join-Path $userDataDir "User\settings.json") -Encoding UTF8

  New-Item -ItemType Directory -Force -Path $driverDir | Out-Null
  Set-Utf8NoBomContent -PathValue (Join-Path $driverDir "package.json") -Value @'
{
  "name": "intentumdiff-demo-driver",
  "displayName": "IntentumDiff Demo Driver",
  "publisher": "intentumdiff",
  "version": "0.0.0",
  "license": "MIT",
  "repository": {
    "type": "git",
    "url": "https://github.com/buchochelliq-labs/intentumdiff"
  },
  "engines": { "vscode": "^1.90.0" },
  "activationEvents": ["*"],
  "main": "./extension.js",
  "files": [
    "extension.js",
    "README.md",
    "LICENSE.txt"
  ]
}
'@
  Set-Utf8NoBomContent -PathValue (Join-Path $driverDir "README.md") -Value @'
# IntentumDiff Demo Driver

Temporary extension used only by the IntentumDiff release recording script.
'@
  Set-Utf8NoBomContent -PathValue (Join-Path $driverDir "LICENSE.txt") -Value @'
MIT
'@
  $driverFocusSegments = @($sceneInfo.FocusPath -split "[\\/]" | Where-Object { $_ })
  $driverFocusSegmentsJson = "[" + (($driverFocusSegments | ForEach-Object { $_ | ConvertTo-Json -Compress }) -join ",") + "]"
  $driverDiffPath = ($sceneInfo.DiffPath -replace "\\", "/")
  $driverPositionLine = [int]$sceneInfo.PositionLine
  $driverPositionEndLine = [Math]::Max($driverPositionLine + 4, $driverPositionLine)
  $driverStartMs = [Math]::Max(0, $StartDelaySeconds * 1000)
  $driverReviewMs = [Math]::Max(6500, [Math]::Min(10000, ($DurationSeconds - 7) * 1000))
  $driverHoldMs = [Math]::Max(4000, ($DurationSeconds + 5) * 1000)
  $markerLiteral = if ($StartMarkerPath) {
    ($StartMarkerPath -replace "\\", "\\\\") -replace '"', '\"'
  } else {
    ""
  }
  Set-Utf8NoBomContent -PathValue (Join-Path $driverDir "extension.js") -Value @"
const vscode = require("vscode");
const fs = require("fs");

const startMarkerPath = "$markerLiteral";
const focusPathSegments = $driverFocusSegmentsJson;
  const diffPath = "$driverDiffPath";
  const positionLine = $driverPositionLine;
  const positionEndLine = $driverPositionEndLine;
const reviewView = "$reviewView";
const openCustomPanel = $($openCustomPanel.ToString().ToLowerInvariant());
const openSemanticDiff = $($openSemanticDiff.ToString().ToLowerInvariant());

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForStartMarker(output) {
  if (!startMarkerPath) {
    return;
  }
  output.appendLine("Waiting for recording marker: " + startMarkerPath);
  for (let attempt = 0; attempt < 180; attempt += 1) {
    if (fs.existsSync(startMarkerPath)) {
      output.appendLine("Recording marker observed.");
      await sleep(900);
      return;
    }
    await sleep(250);
  }
  output.appendLine("Timed out waiting for recording marker; continuing.");
}

async function activate() {
  const output = vscode.window.createOutputChannel("IntentumDiff Demo Driver");
  output.appendLine("Starting IntentumDiff real recording driver.");
  await sleep($driverStartMs);
  const extension = vscode.extensions.getExtension("buchochelliq-labs.intentumdiff");
  if (extension) {
    void extension.activate();
    output.appendLine("Requested IntentumDiff activation.");
  } else {
    output.appendLine("IntentumDiff extension was not found.");
  }
  const folder = vscode.workspace.workspaceFolders?.[0];
  if (!folder) {
    output.appendLine("No workspace folder found.");
    return;
  }
  const document = await vscode.workspace.openTextDocument(vscode.Uri.joinPath(folder.uri, ...focusPathSegments));
  await vscode.window.showTextDocument(document, { preview: false });
  output.appendLine("Opened " + focusPathSegments.join("/") + ".");
  await vscode.commands.executeCommand("workbench.view.extension.intentumdiffActivity");
  await vscode.commands.executeCommand("intentumdiff.review.focus");
  await waitForStartMarker(output);
  await vscode.commands.executeCommand("intentumdiff.refreshReview");
  output.appendLine("Requested Semantic Changes review.");
  await sleep($driverReviewMs);
  if (openSemanticDiff) {
    await vscode.commands.executeCommand("intentumdiff.openSemanticDiff", {
      folderUri: folder.uri.toString(),
      relativePath: diffPath,
      position: {
        start_line: positionLine,
        start_col: 0,
        end_line: positionEndLine,
        end_col: 0
      },
      positionSide: "modified"
    });
    output.appendLine("Opened semantic diff.");
  }
  if (openCustomPanel) {
    await sleep(700);
    await vscode.commands.executeCommand("intentumdiff.openReviewPanel", {
      folderUri: folder.uri.toString(),
      relativePath: diffPath,
      position: {
        start_line: positionLine,
        start_col: 0,
        end_line: positionEndLine,
        end_col: 0
      },
      positionSide: "modified"
    });
    await sleep(700);
    await vscode.commands.executeCommand("intentumdiff.reviewPanel.setView", reviewView);
    output.appendLine("Opened custom review panel view: " + reviewView + ".");
  }
  await sleep($driverHoldMs);
}

function deactivate() {}

module.exports = { activate, deactivate };
"@
  $localVscePath = Join-Path $extensionDir "node_modules\.bin\vsce.cmd"
  if (Test-Path -LiteralPath $localVscePath) {
    $driverVscePath = $localVscePath
    $driverVsceArgs = @("package", "--allow-star-activation", "--out", $driverVsixPath)
  } else {
    $driverVscePath = $npxPath
    $driverVsceArgs = @("@vscode/vsce", "package", "--allow-star-activation", "--out", $driverVsixPath)
  }
  Invoke-External -Label "Packaging demo driver VSIX" -FilePath $driverVscePath -Arguments $driverVsceArgs -WorkingDirectory $driverDir
  Register-IsolatedExtension `
    -ExtensionsDir $extensionsDir `
    -Identifier "intentumdiff.intentumdiff-demo-driver" `
    -Version "0.0.0" `
    -ExtensionDir $driverDir
  Write-Host "  Registered isolated demo driver extension: $driverDir"

  $launchedAt = Get-Date
  $previousElectronRunAsNode = $env:ELECTRON_RUN_AS_NODE
  $previousLocalAppData = $env:LOCALAPPDATA
  Remove-Item Env:ELECTRON_RUN_AS_NODE -ErrorAction SilentlyContinue
  try {
    $env:LOCALAPPDATA = $localAppDataDir
    Start-Process -FilePath $codePath -ArgumentList @(
      "--user-data-dir", $userDataDir,
      "--extensions-dir", $extensionsDir,
      "--new-window",
      "--disable-updates",
      "--disable-extension", "GitHub.copilot",
      "--disable-extension", "GitHub.copilot-chat",
      "--disable-extension", "github.copilot",
      "--disable-extension", "github.copilot-chat",
      "--disable-workspace-trust",
      "--disable-telemetry",
      "--skip-welcome",
      "--skip-release-notes",
      $workspace
    ) -WorkingDirectory $workspace | Out-Null
  } finally {
    if ($null -ne $previousLocalAppData) {
      $env:LOCALAPPDATA = $previousLocalAppData
    } else {
      Remove-Item Env:LOCALAPPDATA -ErrorAction SilentlyContinue
    }
    if ($null -ne $previousElectronRunAsNode) {
      $env:ELECTRON_RUN_AS_NODE = $previousElectronRunAsNode
    }
  }
  if ($null -ne $Region) {
    Move-LatestVsCodeWindow -StartedAt $launchedAt -ExecutablePath $codePath -Region $Region
  }
  if ($WaitForFinalState) {
    $settleSeconds = [Math]::Max(10, [Math]::Min(25, $DurationSeconds + 8))
    Write-Host "  Waiting $settleSeconds seconds for screenshot scene to settle."
    Start-Sleep -Seconds $settleSeconds
    if ($null -ne $Region) {
      Move-LatestVsCodeWindow -StartedAt $launchedAt -ExecutablePath $codePath -Region $Region
    }
    $readyWindow = Get-IsolatedVsCodeWindow -StartedAt $launchedAt -ExecutablePath $codePath
    if ($null -eq $readyWindow) {
      throw "Screenshot scene did not produce a visible isolated VS Code window for executable: $codePath"
    }
  } else {
    $readyWindow = Wait-VsCodeWindowByTitle `
      -TitlePattern "*billing.py*" `
      -PathPattern "*vscode-test*" `
      -TimeoutSeconds ([Math]::Max(60, $DurationSeconds + 35)) `
      -Region $Region
  }
  Write-Host "VS Code real demo launched with isolated workspace/profile:"
  Write-Host "  workspace:  $workspace"
  Write-Host "  user data:  $userDataDir"
  Write-Host "  extensions: $extensionsDir"
  Write-Host "  schema cache: $localAppDataDir"
  Write-Host "  intentumdiff: $intentumdiffExe"
  if ($null -ne $readyWindow) {
    Write-Host "  ready:      $($readyWindow.MainWindowTitle)"
  } else {
    Write-Host "  ready:      screenshot settle completed without a matched top-level window"
  }
}

if ($DurationSeconds -le 0) {
  throw "DurationSeconds must be positive."
}
if ($FrameRate -le 0) {
  throw "FrameRate must be positive."
}
if ($ScaleWidth -le 0 -or $ScaleHeight -le 0) {
  throw "ScaleWidth and ScaleHeight must be positive."
}
if ($MaxGifMb -le 0) {
  throw "MaxGifMb must be positive."
}

$scriptDir = Split-Path -Parent $PSCommandPath
$repoRoot = Resolve-Path -LiteralPath (Join-Path $scriptDir "..")
$ffmpegPath = Resolve-Executable -Name $Ffmpeg
$ffprobePath = Resolve-Executable -Name $Ffprobe
if ($AutoStage -and -not $CaptureRegion) {
  if ($Demo -eq "cli") {
    $CaptureRegion = "80,80,960,540"
  } elseif ($Scene -eq "narrow") {
    $CaptureRegion = "80,80,760,720"
  } else {
    $CaptureRegion = "80,80,1280,720"
  }
}
$region = Parse-CaptureRegion -Region $CaptureRegion
$captureRegionLabel = if ($null -ne $region) {
  "$($region.X),$($region.Y),$($region.Width),$($region.Height)"
} else {
  "full-desktop"
}

$tempDir = Resolve-OutputPath -PathValue $DemoRoot -BaseDir $repoRoot
$ManifestPath = Resolve-OutputPath -PathValue $ManifestPath -BaseDir $repoRoot
$startMarkerPath = if ($AutoStage -and $Demo -eq "vscode" -and $CaptureMode -eq "record") {
  Join-Path $tempDir "intentumdiff-vscode-$Scene-recording-start.marker"
} else {
  $null
}
if ($CaptureMode -eq "screenshot") {
  if (-not $OutputScreenshot) {
    $OutputScreenshot = Resolve-DefaultScreenshotOutput -DemoRootPath $tempDir -DemoName $Demo -SceneName $Scene
  }
  $OutputScreenshot = Resolve-OutputPath -PathValue $OutputScreenshot -BaseDir $repoRoot
  $outputDir = Split-Path -Parent $OutputScreenshot
} else {
  if (-not $OutputGif) {
    $OutputGif = Resolve-DefaultOutput -RepoRoot $repoRoot -DemoName $Demo -SceneName $Scene
  }
  $OutputGif = Resolve-OutputPath -PathValue $OutputGif -BaseDir $repoRoot
  $outputDir = Split-Path -Parent $OutputGif
}
$safeTimestamp = Get-Date -Format "yyyyMMdd-HHmmss"
if (-not $OutputVideo) {
  $OutputVideo = Join-Path $tempDir "intentumdiff-$Demo-$Scene-$safeTimestamp.mp4"
}
$OutputVideo = Resolve-OutputPath -PathValue $OutputVideo -BaseDir $repoRoot
$palettePath = Join-Path $tempDir "intentumdiff-$Demo-$safeTimestamp-palette.png"

$captureArgs = @(
  "-y",
  "-hide_banner",
  "-loglevel", "warning",
  "-f", "gdigrab",
  "-framerate", [string]$FrameRate
)
if ($null -ne $region) {
  $captureArgs += @(
    "-offset_x", [string]$region.X,
    "-offset_y", [string]$region.Y,
    "-video_size", "$($region.Width)x$($region.Height)"
  )
}
$captureArgs += @(
  "-i", "desktop",
  "-t", [string]$DurationSeconds,
  "-an",
  "-c:v", "libx264",
  "-pix_fmt", "yuv420p",
  $OutputVideo
)

$screenshotArgs = @(
  "-y",
  "-hide_banner",
  "-loglevel", "warning",
  "-f", "gdigrab"
)
if ($null -ne $region) {
  $screenshotArgs += @(
    "-offset_x", [string]$region.X,
    "-offset_y", [string]$region.Y,
    "-video_size", "$($region.Width)x$($region.Height)"
  )
}
$screenshotArgs += @(
  "-i", "desktop",
  "-frames:v", "1",
  "-update", "true",
  $OutputScreenshot
)

$scaleFilter = "fps=$FrameRate,scale=${ScaleWidth}:${ScaleHeight}:force_original_aspect_ratio=decrease,pad=${ScaleWidth}:${ScaleHeight}:(ow-iw)/2:(oh-ih)/2:color=0x0f1720"
$paletteArgs = @(
  "-y",
  "-hide_banner",
  "-loglevel", "warning",
  "-i", $OutputVideo,
  "-vf", "$scaleFilter,palettegen=stats_mode=diff",
  "-frames:v", "1",
  "-update", "true",
  $palettePath
)
$gifArgs = @(
  "-y",
  "-hide_banner",
  "-loglevel", "warning",
  "-i", $OutputVideo,
  "-i", $palettePath,
  "-lavfi", "$scaleFilter [x]; [x][1:v] paletteuse=dither=bayer:bayer_scale=3",
  $OutputGif
)

Write-Host "IntentumDiff release demo recording"
Write-Host "  demo:       $Demo"
if ($Demo -eq "vscode") {
  Write-Host "  scene:      $Scene"
}
Write-Host "  mode:       $CaptureMode"
if ($CaptureMode -eq "screenshot") {
  Write-Host "  screenshot: $OutputScreenshot"
  Write-Host "  manifest:   $ManifestPath"
} else {
  Write-Host "  output gif: $OutputGif"
  Write-Host "  video:      $OutputVideo"
}
if ($null -ne $region) {
  Write-Host "  region:     $($region.X),$($region.Y),$($region.Width),$($region.Height)"
} else {
  Write-Host "  region:     full desktop"
}
Write-Host "  duration:   $DurationSeconds seconds"
Write-Host "  frame rate: $FrameRate fps"
Write-Host "  scale:      ${ScaleWidth}x${ScaleHeight}"

if ($DryRun) {
  Write-Host ""
  Write-Host "Dry run only. Commands that would run:"
  if ($CaptureMode -eq "screenshot") {
    Write-Host "  $ffmpegPath $(Join-DisplayCommand -CommandArgs $screenshotArgs)"
    Write-Host "  update visual proof manifest: $ManifestPath"
  } else {
    Write-Host "  $ffmpegPath $(Join-DisplayCommand -CommandArgs $captureArgs)"
    Write-Host "  $ffmpegPath $(Join-DisplayCommand -CommandArgs $paletteArgs)"
    Write-Host "  $ffmpegPath $(Join-DisplayCommand -CommandArgs $gifArgs)"
    Write-Host "  $ffprobePath <output>"
  }
  if ($AutoStage) {
    if ($Demo -eq "vscode") {
      Write-Host "  auto-stage $Demo $Scene demo before capture"
    } else {
      Write-Host "  auto-stage $Demo demo before capture"
    }
  }
  exit 0
}

New-Item -ItemType Directory -Force -Path $outputDir | Out-Null
New-Item -ItemType Directory -Force -Path $tempDir | Out-Null

Write-Host ""
if ($AutoStage) {
  if ($Demo -eq "vscode") {
    Write-Host "Auto-staging the $Demo $Scene demo..."
  } else {
    Write-Host "Auto-staging the $Demo demo..."
  }
  if ($Demo -eq "cli") {
    Start-CliAutoStage -RepoRoot $repoRoot -TempDir $tempDir -UvName $UvCommand -DurationSeconds $DurationSeconds -StartDelaySeconds ($CountdownSeconds + 1) -Region $region | Out-Null
  } else {
    Start-VsCodeAutoStage `
      -RepoRoot $repoRoot `
      -CodeName $CodeCommand `
      -UvName $UvCommand `
      -DemoRootPath $tempDir `
      -StartDelaySeconds 1 `
      -DurationSeconds $DurationSeconds `
      -StartMarkerPath $startMarkerPath `
      -WaitForFinalState:($CaptureMode -eq "screenshot") `
      -Region $region `
      -Scene $Scene
  }
} else {
  Write-Host "Stage the $Demo demo window now. Recording starts after the countdown."
}
for ($i = $CountdownSeconds; $i -gt 0; $i--) {
  Write-Host "  $i..."
  Start-Sleep -Seconds 1
}

if ($CaptureMode -eq "screenshot") {
  Write-Host "Capturing screenshot..."
  & $ffmpegPath @screenshotArgs
  if ($LASTEXITCODE -ne 0) {
    throw "ffmpeg screenshot capture failed with exit code $LASTEXITCODE"
  }
  if (-not (Test-Path -LiteralPath $OutputScreenshot)) {
    throw "Expected screenshot was not written: $OutputScreenshot"
  }
  $screenshotSize = (Get-Item -LiteralPath $OutputScreenshot).Length
  Write-Host ""
  Write-Host "Generated screenshot:"
  Write-Host "  $OutputScreenshot"
  Write-Host "  $screenshotSize bytes"
  $screenshotDimensions = Get-PngDimensions -Path $OutputScreenshot
  $captureCommand = "powershell -ExecutionPolicy Bypass -File scripts\record-release-demo.ps1 -Demo $Demo -Scene $Scene -CaptureMode screenshot -OutputScreenshot `"$OutputScreenshot`" -ManifestPath `"$ManifestPath`""
  Update-VisualProofManifest `
    -PathValue $ManifestPath `
    -SceneName $Scene `
    -ScreenshotPath $OutputScreenshot `
    -CaptureCommand $captureCommand `
    -CaptureRegion $captureRegionLabel `
    -CapturedWidth $screenshotDimensions.width `
    -CapturedHeight $screenshotDimensions.height
  Write-Host "Updated visual proof manifest:"
  Write-Host "  $ManifestPath"
  exit 0
}

if ($startMarkerPath) {
  Remove-Item -LiteralPath $startMarkerPath -Force -ErrorAction SilentlyContinue
  Set-Content -LiteralPath $startMarkerPath -Encoding UTF8 -Value "start"
}

Write-Host "Recording..."
& $ffmpegPath @captureArgs
if ($LASTEXITCODE -ne 0) {
  throw "ffmpeg screen capture failed with exit code $LASTEXITCODE"
}

Write-Host "Generating GIF palette..."
& $ffmpegPath @paletteArgs
if ($LASTEXITCODE -ne 0) {
  throw "ffmpeg palette generation failed with exit code $LASTEXITCODE"
}

Write-Host "Encoding GIF..."
& $ffmpegPath @gifArgs
if ($LASTEXITCODE -ne 0) {
  throw "ffmpeg GIF encoding failed with exit code $LASTEXITCODE"
}

if (-not (Test-Path -LiteralPath $OutputGif)) {
  throw "Expected GIF was not written: $OutputGif"
}

$gifInfo = & $ffprobePath -v error -select_streams v:0 -show_entries stream=width,height,nb_frames,duration -of default=noprint_wrappers=1 $OutputGif
if ($LASTEXITCODE -ne 0) {
  throw "ffprobe failed for generated GIF with exit code $LASTEXITCODE"
}

$maxBytes = $MaxGifMb * 1000 * 1000
$gifSize = (Get-Item -LiteralPath $OutputGif).Length
if ($gifSize -gt $maxBytes) {
  throw "Generated GIF is too large: $gifSize bytes > $maxBytes bytes. Reduce duration, frame rate, or capture region."
}

Write-Host ""
Write-Host "Generated GIF:"
Write-Host "  $OutputGif"
Write-Host "  $gifSize bytes"
Write-Host $gifInfo

if (-not $KeepVideo) {
  Remove-Item -LiteralPath $OutputVideo -Force -ErrorAction SilentlyContinue
}
Remove-Item -LiteralPath $palettePath -Force -ErrorAction SilentlyContinue
