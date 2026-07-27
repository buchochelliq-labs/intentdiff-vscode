import assert from "node:assert/strict";
import test from "node:test";
import { selectionTargetForDocument } from "../src/selectionRange";

function documentOf(lines: string[]) {
  return {
    lineCount: lines.length,
    lineAt(line: number) {
      return { text: lines[line] ?? "" };
    },
  };
}

test("selectionTargetForDocument preserves exact in-bounds ranges", () => {
  const target = selectionTargetForDocument(
    { start_line: 0, start_col: 0, end_line: 0, end_col: 10 },
    documentOf(["gone: true"]),
  );

  assert.equal(target.exact, true);
  assert.equal(target.shouldSelect, true);
  assert.deepEqual(target.position, { start_line: 0, start_col: 0, end_line: 0, end_col: 10 });
});

test("selectionTargetForDocument reveals without selecting when columns are stale", () => {
  const target = selectionTargetForDocument(
    { start_line: 0, start_col: 4, end_line: 0, end_col: 25 },
    documentOf(["short"]),
  );

  assert.equal(target.exact, false);
  assert.equal(target.shouldSelect, false);
  assert.deepEqual(target.position, { start_line: 0, start_col: 4, end_line: 0, end_col: 4 });
});

test("selectionTargetForDocument reveals the nearest line when the target line is stale", () => {
  const target = selectionTargetForDocument(
    { start_line: 9, start_col: 3, end_line: 9, end_col: 7 },
    documentOf(["first", "last"]),
  );

  assert.equal(target.exact, false);
  assert.equal(target.shouldSelect, false);
  assert.deepEqual(target.position, { start_line: 1, start_col: 3, end_line: 1, end_col: 3 });
});
