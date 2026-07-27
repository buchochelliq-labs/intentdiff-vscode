# Read the intent

IntentDiff answers *what changed and why it matters* — not just which lines moved.

[Open the IntentDiff view](command:workbench.view.extension.intentdiffActivity), then
pick a file in **Semantic Changes** — click a file to open its diff, or expand it and
click an **intent** or **evidence** row to jump straight to that change.

Where intent shows up:

- **CodeLens** above each changed hunk: `CATEGORY · <one-line why>`, with a **Peek**
  action for the full explanation, evidence, and a before/after mini-hunk.
- **Category** — every change is classified as **Behavior** (may change runtime
  behavior), **Internal** (refactor/move — behavior preserved), or **Ignored**
  (style/noise).
- The **native diff editor** is the live, editable surface: edit the right-hand side
  and the intent recomputes as you type, with unchanged regions collapsed.

Want richer, context-aware explanations? Turn on the optional **BYOK / Copilot LLM
explainer** — it sends a locally-derived, privacy-safe fact sheet (not your raw
source) unless you point it at a local endpoint. Set `intentdiff.intent.explainer`
to `llm`.
