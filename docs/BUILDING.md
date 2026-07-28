# Building intentdiff-vscode

Toolchain: **Node 20**.

## Extension

```bash
npm ci
npm run lint      # tsc -p ./ --noEmit
npm run test      # compiles then runs the node:test suite (244 tests)
```

## Review shell

```bash
cd review-shell
npm ci
npm run test      # builds (tsc) then runs its suite
```

(Its tsconfig pins `typeRoots` locally so the extension's `@types` don't leak into the nested
package.)

## Release media gate

`release-media/manifest.json` declares the visual proof surfaces; validate with:

```bash
python scripts/validate_release_media_manifest.py
```

The recorder (`scripts/record-release-demo.ps1`) regenerates screenshots; the CI gate
(`release-media-manifest-gate.yml`) enforces manifest validity on every change.

## VSIX packaging

The release VSIX bundles, per platform: the compiled extension, the native
`intentdiff-live-server` binary (staged under `/live-server`), and the parser component set.
Bundling is release-channel work driven by the publish pipeline; local development runs the
extension host against a locally built live-server instead.
