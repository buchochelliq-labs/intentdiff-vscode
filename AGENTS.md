# Agent instructions — intentumdiff-vscode

The VS Code extension: **renders what the engine serves — never computes semantics**.

## Hard invariants
- Native-first: diffs open with `vscode.diff`; no webview diff editors, no Monaco embeds.
- Theme-native: `--vscode-*` variables + contributed color IDs only; no hardcoded chrome hex;
  codicons only; must read in Dark+, Light+, High-Contrast.
- Privacy/BYOK (`PRIVACY.md`): no bundled keys; SecretStorage; consent before any cloud send;
  never raw source to a cloud endpoint.
- No image processing in the webview — asset-diff artifacts come from the engine.

## Build + test (Node 20)
```bash
npm ci && npm run lint && npm run test        # extension (244 tests)
cd review-shell && npm ci && npm run test     # review shell
python scripts/validate_release_media_manifest.py
```

## Map
`docs/ARCHITECTURE.md` (topology + invariants) · `docs/architecture/diff-viewer.md`
(deep-dive) · `docs/BUILDING.md` · `docs/RELEASE.md` (publish runbook) · `.claude/skills/`.
