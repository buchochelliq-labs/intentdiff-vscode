# Run a semantic review

A semantic review parses every changed file with the Rust core and groups the raw
edits into **intent** — meaningful behavior changes, refactorings, moves, and
style/noise that's safely ignored.

[Refresh Semantic Review](command:intentumdiff.refreshReview)

Then open the **IntentumDiff** view in the Activity Bar to see the results:

- **Semantic Changes** — a tree of changed files, each expanded into its intents and
  raw evidence, ordered by importance (guardrails → cross-file → lifecycle → moved →
  refactor → meaningful → ignored → noise).
- **Review Dashboard** — a cockpit view with per-file metrics, fuel telemetry, and
  review history.

Images route to the **perceptual asset diff** instead of a text diff — open a changed
`.png` / `.jpg` / `.webp` to compare side-by-side, onion-skin, swipe, or difference,
with change outlines and per-channel histograms.
