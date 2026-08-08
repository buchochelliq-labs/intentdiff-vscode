# Contributing

Developer setup for the IntentumDiff VS Code extension. User-facing
documentation lives at https://buchochelliq-labs.github.io/intentumdiff-docs/.

Work targets the release-candidate branch, never `main` — see the
`intentumdiff-release` skill.

## Run Locally

```powershell
cd plugins/vscode
npm install
npm run compile
npm test
npm run test:integration
```

Open this folder in VS Code and run **Developer: Reload Window** or launch an
Extension Development Host.

For faster TypeScript iteration while an Extension Development Host is open:

```powershell
cd plugins/vscode
npm run dev:watch
```

VS Code still needs **Developer: Reload Window** when installed extension code
has already been loaded by the current extension host.

To open a source-backed Extension Development Host:

```powershell
cd plugins/vscode
npm run dev:host
```

This avoids replacing the installed extension directory while VS Code has it
locked. Pair `npm run dev:watch` with **Developer: Reload Window** in the
Extension Development Host for the closest local hot-reload loop.

## Install Locally

For normal dogfooding, install the extension into your current VS Code profile
from a locally packaged VSIX:

```powershell
powershell -ExecutionPolicy Bypass -File scripts/install-vscode-extension.ps1
```

From `plugins/vscode`, the same flow is available as:

```powershell
npm run install:local
```

The installer checks for `npm` and the VS Code `code` CLI, installs npm
dependencies only when `node_modules` is missing, compiles, packages, and runs
`code --install-extension <vsix> --force`.
It also writes an ignored workspace setting at `.vscode/settings.json` pointing
`intentumdiff.executable` at a local IntentumDiff executable when one exists. The setting
name remains `intentumdiff.executable` for compatibility with the pre-rebrand extension.

For the normal after-each-iteration loop, run the repository-level sync helper.
It detects changed Python/Rust files and reinstalls the IntentumDiff executable,
detects changed VS Code files and reinstalls the VSIX, and skips work when only
docs/tests outside those surfaces changed:

```powershell
powershell -ExecutionPolicy Bypass -File scripts/sync-local-dev.ps1
```

From `plugins/vscode`, the same sync helper is available as:

```powershell
npm run sync:local
```

If the installed extension directory is locked by the current VS Code extension
host, the sync helper falls back to opening a source-backed Extension Development
Host instead of failing the whole iteration.
When the sync helper is run from a VS Code integrated terminal, it skips the
installed-profile replacement and opens the source-backed Extension Development
Host by default. Run from an external terminal, or pass `-ForceVsixInstall`, if
you specifically want to replace the installed VSIX profile.

Useful sync options:

```powershell
powershell -ExecutionPolicy Bypass -File scripts/sync-local-dev.ps1 `
  -ForceExecutable `
  -ForceVsCode `
  -StopIntentumDiffProcesses
```

When executable files changed, the sync helper stops repo-scoped IntentumDiff
LiveServer/LSP processes before reinstalling so native files are not held open.
Use `-SkipStopIntentumDiffProcesses` only when you intentionally want to leave
those processes running.

Useful options:

```powershell
powershell -ExecutionPolicy Bypass -File scripts/install-vscode-extension.ps1 `
  -CodeCommand "C:\Users\you\AppData\Local\Programs\Microsoft VS Code\bin\code.cmd" `
  -SkipNpmInstall `
  -SkipCompile `
  -SetIntentumDiffExecutable "C:\path\to\intentumdiff.exe"
```

Use `-NoWorkspaceSettings` if you want to install the extension without writing
`.vscode/settings.json`.

To uninstall the local build:

```powershell
code --uninstall-extension buchochelliq-labs.intentumdiff
```

## Manual Smoke Checklist

1. Build the extension with `npm run compile`.
2. Open `plugins/vscode` in VS Code and launch an Extension Development Host.
3. In the Extension Development Host, open a small git-backed workspace.
4. Set `intentumdiff.executable` to the local `intentumdiff` command or absolute path.
5. Set `intentumdiff.ref` to `HEAD` or a branch such as `origin/main`.
6. Enable `intentumdiff.trace` and open **IntentumDiff: Show Output**.
7. Edit a supported file and confirm the status bar moves through `diffing`
   to `clean`, `style-only`, `N changes`, or `N guardrail`.
8. Change a protected config value from `intentumdiff.yaml` and confirm an editor
   diagnostic appears at the changed position.
9. Introduce a parse warning/error and confirm a warning diagnostic appears
   without crashing the extension host.
10. Open the Source Control sidebar and confirm **Semantic Changes** refreshes
    automatically. Use **IntentumDiff: Refresh Semantic Review** to rerun it manually,
    then confirm changed files appear with guardrails on top and any cross-file
    changes listed before ordinary file changes.
11. Select a changed file in **Semantic Changes** and confirm a native diff editor
    opens with a `intentumdiff-base:` left side and the working-tree file on the right.
12. Change `intentumdiff.ref`, refresh the review, and confirm the diff editor uses the
    new base ref.
13. Move a saved function or class between files, refresh the review, and confirm
    a cross-file entry appears in **Semantic Changes**.
14. Toggle the extension off and on, then restart the server; diagnostics and
    decorations should clear and rebuild cleanly.

## Notes

This V1 extension consumes `intentumdiff live-server --stdio` protocol v2. It is
release-candidate ready; Marketplace/Open VSX publication is pending namespace
and credential confirmation.
