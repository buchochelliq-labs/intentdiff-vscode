# intentdiff-vscode architecture

## Topology

```
extension (TypeScript) ──spawns──► intentdiff-live-server (native, bundled)
                                        │ links in-process
                                        ▼
                                  intentdiff-core (the engine)
```

The extension never computes semantics: it spawns the bundled native
[live-server](https://github.com/buchochelliq-labs/intentdiff-live-server) and renders what
the engine serves. The VSIX bundles the native binary + the parser components per platform —
self-contained, no Python.

## Surfaces (native-first)

- **The native diff editor is primary** — diffs open with `vscode.diff` (left: read-only
  `intentdiff-base:` from `git show`; right: the real working-tree file). Editing re-runs the
  engine (debounced) and refreshes intent live. No webview diff editors.
- **Intent** surfaces as CodeLens (`CATEGORY · why`), a Peek command, and semantic decorations
  bound to the contributed `intentdiff.semanticChanges.*` colors. Risk derives from category.
- **One review webview** (dashboard, Intent/Risk/Evidence/Notes/Release-Notes tabs, per-hunk
  staging, the perceptual image diff) — all artifacts come from the engine; **no image
  processing in the webview**.

Deep-dive on the diff viewer: [architecture/diff-viewer.md](architecture/diff-viewer.md).

## Invariants

- **Theme-native**: `--vscode-*` variables + contributed color IDs only — no hardcoded chrome
  hex, no bundled fonts; must read natively in Dark+, Light+, High-Contrast. Codicons only.
- **Privacy/BYOK**: no bundled keys; keys in SecretStorage; cloud consent precedes any send;
  default payloads are privacy-safe fact sheets (never raw source to a cloud endpoint).
- The extension keeps a long-running engine process — after an engine/component rebuild,
  restart it (Reload Window) before re-diagnosing "stale" behavior.

`review-shell/` is the shared review-rendering package (also used by the desktop shell);
`release-media/` holds the validated visual-proof set gated by
`.github/workflows/release-media-manifest-gate.yml`.
