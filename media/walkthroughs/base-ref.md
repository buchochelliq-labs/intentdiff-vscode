# Pick your base ref

IntentDiff compares your **working tree** against a **base ref** and explains the
*intent* behind each change.

The base ref is the setting `intentdiff.ref` — it defaults to `HEAD`, so out of the
box you review your uncommitted changes.

Common choices:

- **`HEAD`** — review your uncommitted working-tree changes (default).
- **`main`** / **`origin/main`** — review everything on your branch since it forked.
- **`@{u}`** — review unpushed commits (against the upstream branch).
- any **commit SHA** or **tag**.

[Open the `intentdiff.ref` setting](command:workbench.action.openSettings?%22intentdiff.ref%22)

> Tip: the review re-runs automatically as you edit. You can change the base ref at
> any time and re-run.
