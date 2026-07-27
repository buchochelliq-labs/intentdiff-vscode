import assert from "node:assert/strict";
import test from "node:test";
import {
  buildSemanticOnlyDocuments,
  projectDecorations,
  projectPosition,
  SEMANTIC_EMPTY_MESSAGE,
  type SemanticOnlyOptions,
} from "../src/semanticOnlyDiff";
import type { DecorationLike, SemanticDiff } from "../src/types";

const defaultOptions: SemanticOnlyOptions = {
  contextLines: 1,
  showAdditions: true,
  showDeletions: true,
  showModifications: true,
  movedCode: true,
  hideComments: false,
};

test("semantic-only documents project semantic positions into context windows", () => {
  const diff: SemanticDiff = {
    changes: [{
      change_type: "MODIFICATION",
      old_node: {
        node_type: "pair",
        label: "old",
        position: { start_line: 2, start_col: 0, end_line: 2, end_col: 5 },
      },
      new_node: {
        node_type: "pair",
        label: "new",
        position: { start_line: 3, start_col: 0, end_line: 3, end_col: 5 },
      },
    }],
  };

  const result = buildSemanticOnlyDocuments(
    "a\nb\nold\nc\nd\n",
    "a\nb\nc\nnew\nd\n",
    diff,
    defaultOptions,
  );

  assert.equal(result.baseText, "b\nold\nc");
  assert.equal(result.modifiedText, "c\nnew\nd");
  assert.deepEqual([...result.projection.baseOriginalLineMap.entries()], [[0, 1], [1, 2], [2, 3]]);
  assert.deepEqual([...result.projection.modifiedOriginalLineMap.entries()], [[0, 2], [1, 3], [2, 4]]);
  assert.deepEqual(projectPosition(diff.changes![0].old_node!.position, result.projection.baseLineMap)?.projected, {
    start_line: 1,
    start_col: 0,
    end_line: 1,
    end_col: 5,
  });
  assert.deepEqual(projectPosition(diff.changes![0].new_node!.position, result.projection.modifiedLineMap)?.projected, {
    start_line: 1,
    start_col: 0,
    end_line: 1,
    end_col: 5,
  });
});

test("semantic-only documents merge overlapping context windows", () => {
  const diff: SemanticDiff = {
    changes: [
      {
        change_type: "MODIFICATION",
        new_node: {
          position: { start_line: 2, start_col: 0, end_line: 2, end_col: 1 },
        },
      },
      {
        change_type: "ADDITION",
        new_node: {
          position: { start_line: 3, start_col: 0, end_line: 3, end_col: 1 },
        },
      },
    ],
  };

  const result = buildSemanticOnlyDocuments(
    "",
    "0\n1\n2\n3\n4\n5",
    diff,
    defaultOptions,
  );

  assert.equal(result.modifiedText, "1\n2\n3\n4");
  assert.equal(result.modifiedText.includes("IntentDiff omitted"), false);
});

test("semantic-only documents insert identical separators between disjoint chunks", () => {
  const diff: SemanticDiff = {
    changes: [
      {
        change_type: "MODIFICATION",
        old_node: { position: { start_line: 0, start_col: 0, end_line: 0, end_col: 1 } },
        new_node: { position: { start_line: 0, start_col: 0, end_line: 0, end_col: 1 } },
      },
      {
        change_type: "MODIFICATION",
        old_node: { position: { start_line: 5, start_col: 0, end_line: 5, end_col: 1 } },
        new_node: { position: { start_line: 5, start_col: 0, end_line: 5, end_col: 1 } },
      },
    ],
  };

  const result = buildSemanticOnlyDocuments(
    "0\n1\n2\n3\n4\n5\n6",
    "0\n1\n2\n3\n4\n5\n6",
    diff,
    { ...defaultOptions, contextLines: 0 },
  );

  const placeholder = result.baseText.split("\n")[1];
  assert.equal(placeholder, "");
  assert.equal(result.modifiedText.split("\n")[1], placeholder);
  assert.equal(result.projection.baseOriginalLineMap.has(1), false);
  assert.equal(result.projection.modifiedOriginalLineMap.has(1), false);
  // Gap metadata assertions
  assert.equal(result.gaps.length, 1);
  assert.equal(result.gaps[0].id, "1");
  assert.equal(result.gaps[0].base?.omittedLineCount, 4);
  assert.equal(result.gaps[0].modified?.omittedLineCount, 4);
  assert.equal(result.gaps[0].base?.originalStartLine, 1);
  assert.equal(result.gaps[0].base?.originalEndLine, 4);
  assert.equal(result.gaps[0].modified?.originalStartLine, 1);
  assert.equal(result.gaps[0].modified?.originalEndLine, 4);
  assert.equal(result.gaps[0].base?.projectedLine, 2);
  assert.equal(result.gaps[0].modified?.projectedLine, 2);
  // Anchor assertions
  assert.equal(result.anchors.modified.firstVisibleOriginalLine, 0);
  assert.equal(result.anchors.modified.lastVisibleOriginalLine, 5);
});

test("semantic-only filters hide comments and selected change families", () => {
  const diff: SemanticDiff = {
    changes: [
      {
        change_type: "ADDITION",
        new_node: {
          node_type: "comment",
          position: { start_line: 0, start_col: 0, end_line: 0, end_col: 8 },
        },
      },
      {
        change_type: "DELETION",
        old_node: {
          node_type: "pair",
          position: { start_line: 1, start_col: 0, end_line: 1, end_col: 7 },
        },
      },
    ],
  };

  const result = buildSemanticOnlyDocuments(
    "comment\nremoved\n",
    "comment\n",
    diff,
    {
      ...defaultOptions,
      showDeletions: false,
      hideComments: true,
    },
  );

  assert.equal(result.baseText, SEMANTIC_EMPTY_MESSAGE);
  assert.equal(result.modifiedText, SEMANTIC_EMPTY_MESSAGE);
  assert.deepEqual([...result.projection.baseOriginalLineMap.entries()], []);
  assert.deepEqual([...result.projection.modifiedOriginalLineMap.entries()], []);
  assert.deepEqual(result.projection.selectedChangeIndexes, []);
});

test("semantic-only deleted files keep old-only selection on the base side", () => {
  const diff: SemanticDiff = {
    changes: [{
      change_type: "DELETION",
      old_node: {
        node_type: "pair",
        label: "gone: true",
        position: { start_line: 0, start_col: 0, end_line: 0, end_col: 10 },
      },
    }],
  };

  const result = buildSemanticOnlyDocuments("gone: true\n", "", diff, defaultOptions);

  assert.equal(result.baseText, "gone: true\n");
  assert.equal(result.modifiedText, "");
  assert.equal(
    projectPosition(diff.changes![0].old_node!.position, result.projection.baseLineMap)?.projected.start_line,
    0,
  );
  assert.equal(
    projectPosition(diff.changes![0].old_node!.position, result.projection.modifiedLineMap),
    undefined,
  );
});

test("semantic-only decoration projection follows virtual document line maps", () => {
  const decorations: DecorationLike[] = [{
    kind: "deletion",
    message: "Delete",
    position: { start_line: 5, start_col: 1, end_line: 5, end_col: 4 },
  }];
  const lineMap = new Map([[5, 2]]);

  assert.deepEqual(projectDecorations(decorations, lineMap).map((item) => item.position), [{
    start_line: 2,
    start_col: 1,
    end_line: 2,
    end_col: 4,
  }]);
});

test("semantic gap placeholders embed the gap token and id for webview parsing", () => {
  const diff: SemanticDiff = {
    changes: [
      {
        change_type: "MODIFICATION",
        old_node: { position: { start_line: 0, start_col: 0, end_line: 0, end_col: 1 } },
        new_node: { position: { start_line: 0, start_col: 0, end_line: 0, end_col: 1 } },
      },
      {
        change_type: "MODIFICATION",
        old_node: { position: { start_line: 9, start_col: 0, end_line: 9, end_col: 1 } },
        new_node: { position: { start_line: 9, start_col: 0, end_line: 9, end_col: 1 } },
      },
    ],
  };
  const text = Array.from({ length: 11 }, (_, i) => "x" + String(i)).join("\n");
  const result = buildSemanticOnlyDocuments(text, text, diff, { ...defaultOptions, contextLines: 0 });

  // Exactly one gap between the two disjoint chunks
  assert.equal(result.gaps.length, 1);
  const placeholder = result.baseText.split("\n")[1];
  // The gap row is intentionally an empty line so Monaco's diff engine does
  // not paint a fake insert/delete on it. The gap id remains in `gap.id`.
  assert.equal(placeholder, "");
  assert.equal(result.gaps[0].id, "1");
  // Gap reports correct omitted line range (lines 1-8 for both sides)
  assert.equal(result.gaps[0].base?.originalStartLine, 1);
  assert.equal(result.gaps[0].base?.originalEndLine, 8);
  assert.equal(result.gaps[0].base?.omittedLineCount, 8);
  // Anchors span from first visible line (0) to last visible (9)
  assert.equal(result.anchors.modified.firstVisibleOriginalLine, 0);
  assert.equal(result.anchors.modified.lastVisibleOriginalLine, 9);
});

test("semantic gap metadata has correct projected line numbers (1-based)", () => {
  const diff: SemanticDiff = {
    changes: [
      {
        change_type: "MODIFICATION",
        old_node: { position: { start_line: 0, start_col: 0, end_line: 0, end_col: 1 } },
        new_node: { position: { start_line: 0, start_col: 0, end_line: 0, end_col: 1 } },
      },
      {
        change_type: "MODIFICATION",
        old_node: { position: { start_line: 5, start_col: 0, end_line: 5, end_col: 1 } },
        new_node: { position: { start_line: 5, start_col: 0, end_line: 5, end_col: 1 } },
      },
    ],
  };
  const text = "0\n1\n2\n3\n4\n5\n6";
  const result = buildSemanticOnlyDocuments(text, text, diff, { ...defaultOptions, contextLines: 0 });
  // Chunk 0 = line 0 (projected line 1); placeholder at projected line 2; chunk 1 = line 5 (projected line 3)
  assert.equal(result.gaps[0].base?.projectedLine, 2);
  assert.equal(result.gaps[0].modified?.projectedLine, 2);
});
