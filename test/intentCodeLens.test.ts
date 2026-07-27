import assert from "node:assert/strict";
import test from "node:test";
import {
  buildIntentLenses,
  categoryForKind,
  coveredChangeIndices,
  describeKind,
  groupWhy,
  intentForLine,
  lensTitle,
  riskForKind,
} from "../src/intentCodeLens";
import type { SemanticDiff } from "../src/types";

function change(kind: string, line: number, description?: string, side: "new" | "old" = "new") {
  const node = { position: { start_line: line, start_col: 0, end_line: line, end_col: 1 } };
  return {
    change_type: kind === "DELETION" ? "DELETION" : "MODIFICATION",
    new_node: side === "new" ? node : null,
    old_node: side === "old" ? node : null,
    description,
  };
}

test("categoryForKind maps shown categories and suppresses style/noise", () => {
  assert.equal(categoryForKind("MEANINGFUL_CHANGE")?.label, "Meaningful");
  assert.equal(categoryForKind("MEANINGFUL_CHANGE")?.icon, "lightbulb");
  assert.equal(categoryForKind("REFACTORING")?.label, "Refactoring");
  assert.equal(categoryForKind("MOVED_CODE")?.label, "Moved");
  assert.equal(categoryForKind("IGNORED_STYLE"), undefined);
  assert.equal(categoryForKind("NOISE_SUPPRESSED"), undefined);
  assert.equal(categoryForKind("UNKNOWN_KIND"), undefined);
});

test("riskForKind derives behavior vs internal from the category", () => {
  assert.equal(riskForKind("MEANINGFUL_CHANGE"), "behavior");
  assert.equal(riskForKind("REFACTORING"), "internal");
  assert.equal(riskForKind("MOVED_CODE"), "internal");
  assert.equal(riskForKind("IGNORED_STYLE"), undefined);
});

test("buildIntentLenses emits one lens per shown group at its lowest modified line", () => {
  const diff: SemanticDiff = {
    changes: [
      change("MODIFICATION", 12, "Tighten validation"),
      change("MODIFICATION", 8, "Tighten validation"),
      change("MODIFICATION", 30, "Rename helper"),
      change("MODIFICATION", 40, "Whitespace"),
    ],
    change_groups: [
      { kind: "MEANINGFUL_CHANGE", raw_change_indices: [0, 1] },
      { kind: "REFACTORING", raw_change_indices: [2], refactoring_kind: "RENAME_SYMBOL" },
      { kind: "IGNORED_STYLE", raw_change_indices: [3] },
    ],
  };
  const lenses = buildIntentLenses(diff, "modified");
  assert.equal(lenses.length, 2, "style group must be suppressed");
  // Sorted by line: meaningful group anchors at line 8 (lowest of 8/12).
  assert.equal(lenses[0].line, 8);
  assert.equal(lenses[0].category.kind, "MEANINGFUL_CHANGE");
  assert.equal(lenses[0].why, "Tighten validation");
  assert.equal(lenses[1].line, 30);
  assert.equal(lenses[1].category.kind, "REFACTORING");
  assert.equal(lenses[1].why, "Rename symbol");
});

test("buildIntentLenses is side-aware (deletions on base only)", () => {
  const diff: SemanticDiff = {
    changes: [change("DELETION", 5, "Remove dead branch", "old")],
    change_groups: [{ kind: "MEANINGFUL_CHANGE", raw_change_indices: [0] }],
  };
  assert.equal(buildIntentLenses(diff, "modified").length, 0);
  const baseLenses = buildIntentLenses(diff, "base");
  assert.equal(baseLenses.length, 1);
  assert.equal(baseLenses[0].line, 5);
});

test("groupWhy prefers refactoring kind, then description, then labels", () => {
  assert.equal(
    groupWhy({ kind: "REFACTORING", refactoring_kind: "EXTRACT_FUNCTION" }, []),
    "Extract function",
  );
  assert.equal(
    groupWhy({ kind: "MOVED_CODE", old_labels: ["a"], new_labels: ["b"] }, []),
    "a → b",
  );
});

test("intent falls back to raw changes when the engine emits no change_groups", () => {
  // Mirrors real files (e.g. boo.py) that report 0 groups but do have changes.
  const diff: SemanticDiff = {
    change_groups: [],
    changes: [{
      change_type: "ADDITION",
      description: "Add function ccc",
      new_node: { position: { start_line: 6, start_col: 0, end_line: 7, end_col: 0 } },
      old_node: null,
    }],
  };
  const lenses = buildIntentLenses(diff, "modified");
  assert.equal(lenses.length, 1, "a lens is synthesized from the raw change");
  assert.equal(lenses[0].category.kind, "MEANINGFUL_CHANGE");
  assert.equal(lenses[0].why, "Add function ccc");
  assert.equal(intentForLine(diff, "modified", 6)?.category.label, "Meaningful");
  assert.equal(intentForLine(diff, "modified", 7)?.why, "Add function ccc");
});

test("coveredChangeIndices unions in-range group indices and ignores out-of-range ones", () => {
  const covered = coveredChangeIndices(
    [
      { kind: "MEANINGFUL_CHANGE", raw_change_indices: [0, 2] },
      // Stale cross-index-space group carrying indices past the final changes array.
      { kind: "NOISE_SUPPRESSED", raw_change_indices: [3, 4, 86] },
    ],
    3,
  );
  assert.deepEqual([...covered].sort((a, b) => a - b), [0, 2]);
  assert.ok(!covered.has(3), "index 3 is out of range for a 3-change diff");
});

test("an ungrouped meaningful addition surfaces as Meaningful, not the colliding noise group", () => {
  // Reproduces the index-space collision: pre-reindex a NOISE_SUPPRESSED group carried stale
  // indices that collided with a real export addition, painting it "Noise". After the engine
  // reindex the noise + meaningful groups own nothing (they addressed a pre-refinement change
  // set), leaving the addition ungrouped — it must still read Meaningful via the fallback.
  const diff: SemanticDiff = {
    changes: [{
      change_type: "ADDITION",
      description: "Add function riskForContent",
      new_node: { position: { start_line: 20, start_col: 0, end_line: 24, end_col: 0 } },
      old_node: null,
    }],
    change_groups: [
      { kind: "MEANINGFUL_CHANGE", raw_change_indices: [] },
      // Post-reindex the noise group owns nothing; its stale index no longer collides.
      { kind: "NOISE_SUPPRESSED", raw_change_indices: [] },
    ],
  };
  const lenses = buildIntentLenses(diff, "modified");
  assert.equal(lenses.length, 1, "the ungrouped addition still earns a lens");
  assert.equal(lenses[0].category.kind, "MEANINGFUL_CHANGE");
  assert.equal(lenses[0].why, "Add function riskForContent");
  assert.equal(intentForLine(diff, "modified", 20)?.category.label, "Meaningful");
  assert.equal(intentForLine(diff, "modified", 24)?.why, "Add function riskForContent");
});

test("buildIntentLenses ignores out-of-range group indices when covering ungrouped changes", () => {
  // A noise group with an out-of-range index must not claim change[2] as covered.
  const diff: SemanticDiff = {
    changes: [
      change("MODIFICATION", 4, "Meaningful edit"),
      change("MODIFICATION", 5, "Meaningful edit"),
      {
        change_type: "ADDITION",
        description: "Add helper",
        new_node: { position: { start_line: 30, start_col: 0, end_line: 31, end_col: 0 } },
        old_node: null,
      },
    ],
    change_groups: [
      { kind: "MEANINGFUL_CHANGE", raw_change_indices: [0, 1] },
      { kind: "NOISE_SUPPRESSED", raw_change_indices: [99] },
    ],
  };
  const lenses = buildIntentLenses(diff, "modified");
  // One for the meaningful group + one synthesized for the ungrouped addition.
  const forAddition = lenses.find((lens) => lens.line === 30);
  assert.ok(forAddition, "the ungrouped addition earns its own lens");
  assert.equal(forAddition?.category.kind, "MEANINGFUL_CHANGE");
});

test("describeKind covers all kinds including suppressed style/noise (for hover)", () => {
  assert.equal(describeKind("MEANINGFUL_CHANGE")?.label, "Meaningful");
  assert.equal(describeKind("IGNORED_STYLE")?.label, "Style");
  assert.equal(describeKind("NOISE_SUPPRESSED")?.label, "Noise");
  assert.equal(describeKind("UNKNOWN_KIND"), undefined);
});

test("intentForLine matches any line within a group's change range", () => {
  const diff: SemanticDiff = {
    changes: [{
      change_type: "MODIFICATION",
      description: "Tighten validation",
      new_node: { position: { start_line: 10, start_col: 0, end_line: 12, end_col: 0 } },
      old_node: null,
    }],
    change_groups: [{ kind: "MEANINGFUL_CHANGE", raw_change_indices: [0] }],
  };
  assert.equal(intentForLine(diff, "modified", 10)?.category.label, "Meaningful");
  assert.equal(intentForLine(diff, "modified", 12)?.why, "Tighten validation");
  assert.equal(intentForLine(diff, "modified", 13), undefined, "outside the range → no intent");
  assert.equal(intentForLine(diff, "base", 10), undefined, "wrong side → no intent");
});

test("lensTitle renders codicon, label, behavior tag and why", () => {
  const [lens] = buildIntentLenses(
    {
      changes: [change("MODIFICATION", 3, "Guard null input")],
      change_groups: [{ kind: "MEANINGFUL_CHANGE", raw_change_indices: [0] }],
    },
    "modified",
  );
  assert.equal(lensTitle(lens), "$(lightbulb) Meaningful · Behavior · Guard null input");
});
