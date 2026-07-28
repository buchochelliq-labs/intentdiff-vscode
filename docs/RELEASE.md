# Extension release runbook

- **Identity**: package `intentdiff`, publisher `buchochelliq-labs`; publish only under the
  IntentDiff identity (never a legacy name unless the brand decision is explicitly reversed).
- **Rebrand gate before live publishing**: confirm/reserve the publisher namespace on VS
  Marketplace AND Open VSX; confirm the repo URL resolves; keep `intentdiff.*` command/setting
  compatibility for the first public release; re-run the release dry run after any manifest or
  README changes.
- **VSIX contents** (per platform, self-contained): compiled extension + the native
  `intentdiff-live-server` binary + the parser component set — no Python.
- **Gates before any publish**: lint + both test suites green, the release-media manifest
  gate valid, and the listing preflight (catches marketplace name collisions).
- Marketplace collateral (icon, banner, demo media, changelog, support, license) ships from
  this repo; the release-media set is the validated proof source.
