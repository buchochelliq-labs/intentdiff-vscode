# Contributing to intentumdiff-vscode

- Build + test per [docs/BUILDING.md](docs/BUILDING.md); lint (`tsc --noEmit`) and both test
  suites must be green.
- Honor the invariants in [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md): native-first diff
  surfaces (no webview diff editors), theme-native styling (no hardcoded chrome hex, codicons
  only), and the privacy/BYOK rules (`PRIVACY.md`).
- Semantics belong in the engine — the extension renders; it never computes diffs or
  processes images.
- UI changes to the proof surfaces require refreshed release media + a passing manifest gate.
