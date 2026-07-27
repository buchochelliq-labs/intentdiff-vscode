# Pipe out release notes

IntentDiff turns a review into human-readable **release notes**, split by risk:

- **Behavior** — meaningful changes that may affect runtime.
- **Internal** — refactors and moves (behavior preserved).
- Guardrail violations are flagged; style and noise are excluded.

[Open the IntentDiff view](command:workbench.view.extension.intentdiffActivity), open a
file's review from **Semantic Changes**, then switch to the **Release Notes** rail:

From there you can:

- **Copy as Markdown** — paste straight into a PR description or changelog.
- **Export JSON** — feed the structured notes into your own tooling / CI.

That's the loop: pick a base ref → run a review → read the intent → mind the
guardrails → ship the notes. Re-run any time — the review follows your edits live.

Need the raw telemetry? **Diagnostics** shows LiveServer/protocol status and the
per-file Wasm fuel table versus your policy thresholds.
