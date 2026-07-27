import assert from "node:assert/strict";
import test from "node:test";
import {
  buildReleaseNotes,
  hasReleaseNotes,
  releaseNotesSummary,
  releaseNotesToJson,
  releaseNotesToMarkdown,
} from "../src/releaseNotes";
import type { SemanticDiff } from "../src/types";

function change(description: string) {
  return {
    change_type: "MODIFICATION",
    new_node: { position: { start_line: 1, start_col: 0, end_line: 1, end_col: 1 } },
    description,
  };
}

test("buildReleaseNotes buckets groups by derived risk", () => {
  const diff: SemanticDiff = {
    language: "python",
    changes: [
      change("Tighten payment validation"),
      change("Rename helper"),
      change("Move parser into module"),
      change("Reformat whitespace"),
    ],
    change_groups: [
      { kind: "MEANINGFUL_CHANGE", raw_change_indices: [0] },
      { kind: "REFACTORING", raw_change_indices: [1], refactoring_kind: "RENAME_SYMBOL" },
      { kind: "MOVED_CODE", raw_change_indices: [2] },
      { kind: "IGNORED_STYLE", raw_change_indices: [3] },
    ],
  };
  const notes = buildReleaseNotes(diff);
  // Notes are now "what — why"; assert on the leading "what" so the appended why
  // (impact sentence) doesn't pin the test to exact wording.
  assert.equal(notes.behavior.length, 1);
  assert.match(notes.behavior[0], /^Tighten payment validation/u);
  assert.equal(notes.internal.length, 2);
  assert.match(notes.internal[0], /^Rename symbol/u);
  assert.match(notes.internal[1], /^Move parser into module/u);
  assert.deepEqual(notes.guardrails, []);
});

test("buildReleaseNotes suppresses style/noise and de-duplicates", () => {
  const diff: SemanticDiff = {
    language: "python",
    changes: [change("Add retry to fetch"), change("Add retry to fetch"), change("noise")],
    change_groups: [
      { kind: "MEANINGFUL_CHANGE", raw_change_indices: [0] },
      { kind: "MEANINGFUL_CHANGE", raw_change_indices: [1] },
      { kind: "NOISE_SUPPRESSED", raw_change_indices: [2] },
    ],
  };
  const notes = buildReleaseNotes(diff);
  assert.equal(notes.behavior.length, 1, "duplicates collapse; noise suppressed");
  assert.match(notes.behavior[0], /^Add retry to fetch/u);
  assert.deepEqual(notes.internal, []);
});

test("buildReleaseNotes covers a meaningful change left ungrouped alongside real groups", () => {
  // Index-space fix: the engine reindex can leave a genuine addition (change[2]) owned by
  // no group while other groups exist. The note must still land instead of being dropped
  // (previously only the groups.length === 0 path covered raw changes).
  const diff: SemanticDiff = {
    language: "python",
    changes: [
      change("Reformat whitespace"),
      change("Rename helper"),
      {
        change_type: "ADDITION",
        description: "Add function riskForContent",
        new_node: { position: { start_line: 20, start_col: 0, end_line: 24, end_col: 0 } },
        old_node: null,
      },
    ],
    change_groups: [
      { kind: "IGNORED_STYLE", raw_change_indices: [0] },
      { kind: "REFACTORING", raw_change_indices: [1], refactoring_kind: "RENAME_SYMBOL" },
      // The addition (change[2]) is owned by no shown group.
    ],
  };
  const notes = buildReleaseNotes(diff);
  assert.equal(notes.behavior.length, 1, "the ungrouped addition lands in a behavior note");
  assert.match(notes.behavior[0], /riskForContent/u);
  assert.equal(notes.internal.length, 1);
  assert.match(notes.internal[0], /^Rename symbol/u);
});

test("buildReleaseNotes ignores out-of-range group indices when covering ungrouped changes", () => {
  const diff: SemanticDiff = {
    language: "python",
    changes: [
      {
        change_type: "ADDITION",
        description: "Add exported helper",
        new_node: { position: { start_line: 3, start_col: 0, end_line: 5, end_col: 0 } },
        old_node: null,
      },
    ],
    // A stale noise group whose index is out of range must not mask the real addition.
    change_groups: [{ kind: "NOISE_SUPPRESSED", raw_change_indices: [42] }],
  };
  const notes = buildReleaseNotes(diff);
  assert.equal(notes.behavior.length, 1, "the addition is not masked by an out-of-range noise index");
  assert.match(notes.behavior[0], /exported helper/u);
});

test("buildReleaseNotes surfaces guardrail violations with severity and scope", () => {
  const diff: SemanticDiff = {
    guardrail_violations: [
      {
        rule_id: "no-mutate-frozen",
        severity: "immutable",
        file: "api.py",
        language: "python",
        semantic_path: "Api.token",
        message: "Immutable field changed",
      },
      {
        rule_id: "review-public-api",
        severity: "important",
        file: "api.py",
        language: "python",
        semantic_path: "",
        message: "Public API surface changed",
      },
    ],
  };
  const notes = buildReleaseNotes(diff);
  assert.deepEqual(notes.guardrails, [
    "Immutable: Immutable field changed (Api.token)",
    "Important: Public API surface changed",
  ]);
});

test("buildReleaseNotes tolerates an undefined / empty diff", () => {
  const empty = buildReleaseNotes(undefined);
  assert.deepEqual(empty, { behavior: [], internal: [], other: [], guardrails: [] });
  assert.equal(hasReleaseNotes(empty), false);
  assert.equal(hasReleaseNotes({ behavior: ["x"], internal: [], other: [], guardrails: [] }), true);
  assert.equal(hasReleaseNotes({ behavior: [], internal: [], other: ["docs"], guardrails: [] }), true);
});

test("releaseNotesToMarkdown always renders four sections with placeholders", () => {
  const md = releaseNotesToMarkdown({ behavior: ["Add retry"], internal: [], other: [], guardrails: [] });
  assert.match(md, /^# Release notes/u);
  assert.match(md, /## Behavior changes\n- Add retry/u);
  assert.match(md, /## Internal changes\n- _No internal-only changes detected\._/u);
  assert.match(md, /## Docs & chores\n- _No docs or chore changes detected\._/u);
  assert.match(md, /## Guardrails\n- _No guardrail violations\._/u);
});

test("releaseNotesToMarkdown honors a custom title", () => {
  const md = releaseNotesToMarkdown({ behavior: [], internal: [], other: [], guardrails: [] }, { title: "v1.2.0" });
  assert.match(md, /^# v1\.2\.0/u);
});

test("releaseNotesSummary counts non-empty buckets, else notes the clean state", () => {
  assert.equal(releaseNotesSummary({ behavior: ["a", "b"], internal: ["c"], other: ["d"], guardrails: ["e"] }), "2 behavior · 1 internal · 1 docs/chore · 1 guardrail");
  assert.equal(releaseNotesSummary({ behavior: [], internal: [], other: [], guardrails: [] }), "No release-worthy changes — formatting or noise only.");
});

test("releaseNotesToMarkdown includes the optional AI narrative as a Summary section", () => {
  const md = releaseNotesToMarkdown(
    { behavior: ["Add retry"], internal: [], other: [], guardrails: [] },
    { narrative: "This release adds retry logic to network calls." },
  );
  assert.match(md, /## Summary\nThis release adds retry logic to network calls\./u);
  // Narrative does not replace the buckets.
  assert.match(md, /## Behavior changes\n- Add retry/u);
});

test("releaseNotesToJson emits pretty-printed structured buckets", () => {
  const json = releaseNotesToJson({ behavior: ["a"], internal: ["b"], other: ["c"], guardrails: ["d"] });
  assert.deepEqual(JSON.parse(json), { behavior: ["a"], internal: ["b"], other: ["c"], guardrails: ["d"] });
  assert.match(json, /\n  "behavior": \[/u);
});
