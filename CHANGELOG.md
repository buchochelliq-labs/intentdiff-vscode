# Changelog

## 0.0.1 - 2026-08-04

First stable release, and the first under the **IntentumDiff** name (previously IntentDiff).

- Added natural-language intent explanations ("what + why") on hovers, CodeLens,
  inlay hints, and release notes, with honest no-op/stub detection.
- Added an **opt-in** AI intent explainer (off by default) supporting your
  existing GitHub Copilot (`vscode-lm`), Anthropic, or an OpenAI-compatible /
  local endpoint — Bring-Your-Own-Key, key stored in VS Code SecretStorage.
- **Privacy-first LLM policy:** the explainer sends a locally-derived semantic
  summary, **not your source code**. New `intentumdiff.intent.llm.codeSharing`
  levels (`signatures` default / `facts` / `full`); verbatim source is only ever
  sent to a **local** endpoint — cloud providers and Copilot auto-downgrade. See
  [PRIVACY.md](PRIVACY.md).

## 0.0.1-beta.1 - 2026-06-03

- Added live semantic diff feedback through `intentumdiff live-server --stdio`.
- Added the Source Control **Semantic Changes** tree for saved working-tree
  review.
- Added group-first review entries for moved code, refactorings, meaningful
  changes, ignored style, and suppressed noise.
- Added native VS Code diff navigation with side-aware semantic decorations.
- Added guardrail diagnostics and pinned guardrail review entries.
- Added Marketplace-ready icon, banner metadata, and curated release media.
