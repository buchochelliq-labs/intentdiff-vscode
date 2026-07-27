# Watch the guardrails

Guardrails flag changes to **protected** symbols and settings — the things you almost
never mean to touch (API keys, immutable config, security-sensitive values).

When a guardrail is violated, IntentDiff:

- raises a **Problem** (Diagnostic) in the Problems panel, and
- **pins** the affected file and change to the top of the Semantic Changes tree.

[Open the Problems panel](command:workbench.actions.view.problems)

Severity maps straight through:

- **`immutable` / `important`** → critical, pinned, and flagged in the release notes.
- lower-severity guardrails still surface but don't block.

Guardrail rules come from the engine's `rules.yaml` / invariance definitions, so they
travel with the project, not the editor.
