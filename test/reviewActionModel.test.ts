import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";
import {
  reviewActionTargetForPayload,
  semanticHunkIndexPatch,
  semanticReviewHunkEditForPayload,
  semanticReviewActionTargetForPayload,
} from "../src/reviewActionModel";

test("review action target resolves safe repo-relative payloads", () => {
  const result = reviewActionTargetForPayload(
    {
      folderUri: "file:///repo",
      relativePath: "src/app.py",
    },
    () => path.normalize("C:/repo"),
  );

  assert.equal(result.error, undefined);
  assert.equal(result.target?.fsPath, path.join(path.normalize("C:/repo"), "src/app.py"));
});

test("review action target ignores missing payloads", () => {
  assert.deepEqual(reviewActionTargetForPayload(undefined, () => path.normalize("C:/repo")), {});
  assert.deepEqual(reviewActionTargetForPayload({ folderUri: "file:///repo" }, () => path.normalize("C:/repo")), {});
  assert.deepEqual(reviewActionTargetForPayload({ relativePath: "src/app.py" }, () => path.normalize("C:/repo")), {});
});

test("review action target rejects absolute and traversal payloads", () => {
  for (const relativePath of ["../secret.py", "src/../../secret.py", "/tmp/secret.py", "C:\\tmp\\secret.py"]) {
    const result = reviewActionTargetForPayload(
      {
        folderUri: "file:///repo",
        relativePath,
      },
      () => path.normalize("C:/repo"),
    );

    assert.equal(result.target, undefined);
    assert.match(result.error ?? "", /Absolute paths|Traversal paths/u);
  }
});

test("semantic hunk action target stages modified-side line ranges", () => {
  const result = semanticReviewActionTargetForPayload(
    {
      folderUri: "file:///repo",
      relativePath: "src/app.ts",
      actionKind: "stageHunk",
      change: {
        change_type: "ADDITION",
        new_node: {
          label: "createWindow",
          position: { start_line: 10, start_col: 0, end_line: 14, end_col: 1 },
        },
      },
    },
    () => path.normalize("C:/repo"),
  );

  assert.deepEqual(result, {
    target: {
      fsPath: path.normalize("C:/repo/src/app.ts"),
      kind: "stageHunk",
      side: "modified",
      startLine: 10,
      endLine: 14,
      previewLabel: "Stage semantic hunk: createWindow",
    },
  });
});

test("semantic hunk action target reverts base-side line ranges when available", () => {
  const result = semanticReviewActionTargetForPayload(
    {
      folderUri: "file:///repo",
      relativePath: "src/app.ts",
      actionKind: "revertHunk",
      change: {
        change_type: "MODIFICATION",
        old_node: {
          label: "createWindow",
          position: { start_line: 8, start_col: 0, end_line: 12, end_col: 1 },
        },
        new_node: {
          label: "createWindow",
          position: { start_line: 10, start_col: 0, end_line: 14, end_col: 1 },
        },
      },
    },
    () => path.normalize("C:/repo"),
  );

  assert.equal(result.target?.kind, "revertHunk");
  assert.equal(result.target?.side, "base");
  assert.equal(result.target?.startLine, 8);
  assert.equal(result.target?.endLine, 12);
  assert.equal(result.target?.previewLabel, "Revert semantic hunk: createWindow");
});

test("semantic hunk action target rejects unsafe path and missing ranges", () => {
  const unsafe = semanticReviewActionTargetForPayload(
    {
      folderUri: "file:///repo",
      relativePath: "../app.ts",
      actionKind: "stageHunk",
      change: { change_type: "ADDITION" },
    },
    () => path.normalize("C:/repo"),
  );
  assert.match(unsafe.error ?? "", /Traversal paths/u);

  const missingRange = semanticReviewActionTargetForPayload(
    {
      folderUri: "file:///repo",
      relativePath: "src/app.ts",
      actionKind: "applyHunk",
      change: { change_type: "ADDITION", new_node: { label: "missing" } },
    },
    () => path.normalize("C:/repo"),
  );
  assert.equal(missingRange.error, "semantic review action has no concrete line range");
});

test("semantic hunk edit applies modified-side lines for apply actions", () => {
  const result = semanticReviewHunkEditForPayload(
    {
      folderUri: "file:///repo",
      relativePath: "src/app.ts",
      actionKind: "applyHunk",
      change: {
        change_type: "MODIFICATION",
        old_node: {
          label: "main",
          position: { start_line: 4, start_col: 0, end_line: 5, end_col: 0 },
        },
        new_node: {
          label: "main",
          position: { start_line: 4, start_col: 0, end_line: 6, end_col: 0 },
        },
      },
      hunk: {
        oldStartLine: 4,
        oldEndLine: 5,
        newStartLine: 4,
        newEndLine: 6,
        oldLines: ["function main() {", "  boot();"],
        newLines: ["function main() {", "  boot();", "  logReady();"],
      },
    },
    () => path.normalize("C:/repo"),
  );

  assert.equal(result.error, undefined);
  assert.equal(result.edit?.editStartLine, 4);
  assert.equal(result.edit?.editEndLine, 6);
  assert.deepEqual(result.edit?.replacementLines, ["function main() {", "  boot();", "  logReady();"]);
  assert.match(result.edit?.previewPatch ?? "", /IntentDiff semantic hunk applyHunk/u);
  assert.match(result.edit?.previewPatch ?? "", /\+   logReady\(\);/u);
});

test("semantic hunk edit generates a zero-context index patch for stage actions", () => {
  const result = semanticReviewHunkEditForPayload(
    {
      folderUri: "file:///repo",
      relativePath: "src/app.ts",
      actionKind: "stageHunk",
      change: {
        change_type: "MODIFICATION",
        old_node: {
          label: "main",
          position: { start_line: 4, start_col: 0, end_line: 5, end_col: 0 },
        },
        new_node: {
          label: "main",
          position: { start_line: 4, start_col: 0, end_line: 6, end_col: 0 },
        },
      },
      hunk: {
        oldStartLine: 4,
        oldEndLine: 5,
        newStartLine: 4,
        newEndLine: 6,
        oldLines: ["function main() {", "  boot();"],
        newLines: ["function main() {", "  boot();", "  logReady();"],
      },
    },
    () => path.normalize("C:/repo"),
  );

  assert.equal(result.error, undefined);
  assert.match(result.edit?.indexPatch ?? "", /diff --git a\/src\/app\.ts b\/src\/app\.ts/u);
  assert.match(result.edit?.indexPatch ?? "", /@@ -4,2 \+4,3 @@/u);
  assert.match(result.edit?.indexPatch ?? "", /-  boot\(\);/u);
  assert.match(result.edit?.indexPatch ?? "", /\+  logReady\(\);/u);
});

test("semantic hunk edit reverts modified-side range to base-side text", () => {
  const result = semanticReviewHunkEditForPayload(
    {
      folderUri: "file:///repo",
      relativePath: "src/app.ts",
      actionKind: "revertHunk",
      change: {
        change_type: "MODIFICATION",
        old_node: {
          label: "main",
          position: { start_line: 4, start_col: 0, end_line: 5, end_col: 0 },
        },
        new_node: {
          label: "main",
          position: { start_line: 4, start_col: 0, end_line: 6, end_col: 0 },
        },
      },
      hunk: {
        oldStartLine: 4,
        oldEndLine: 5,
        newStartLine: 4,
        newEndLine: 6,
        oldLines: ["function main() {", "  boot();"],
        newLines: ["function main() {", "  boot();", "  logReady();"],
      },
    },
    () => path.normalize("C:/repo"),
  );

  assert.equal(result.error, undefined);
  assert.equal(result.edit?.target.side, "base");
  assert.equal(result.edit?.editStartLine, 4);
  assert.equal(result.edit?.editEndLine, 6);
  assert.deepEqual(result.edit?.replacementLines, ["function main() {", "  boot();"]);
  assert.match(result.edit?.previewPatch ?? "", /IntentDiff semantic hunk revertHunk/u);
});

test("semantic hunk edit rejects missing hunk text before editor mutation", () => {
  const result = semanticReviewHunkEditForPayload(
    {
      folderUri: "file:///repo",
      relativePath: "src/app.ts",
      actionKind: "revertHunk",
      change: {
        change_type: "MODIFICATION",
        old_node: {
          label: "main",
          position: { start_line: 4, start_col: 0, end_line: 5, end_col: 0 },
        },
        new_node: {
          label: "main",
          position: { start_line: 4, start_col: 0, end_line: 6, end_col: 0 },
        },
      },
      hunk: {
        newStartLine: 4,
        newEndLine: 6,
        oldLines: [],
        newLines: ["function main() {", "  boot();", "  logReady();"],
      },
    },
    () => path.normalize("C:/repo"),
  );

  assert.equal(result.error, "semantic review hunk revert has no base-side lines");
  assert.equal(result.edit, undefined);
});

test("semantic hunk index patch rejects unsafe relative paths", () => {
  assert.equal(semanticHunkIndexPatch("../secret.ts", {
    oldStartLine: 1,
    newStartLine: 1,
  }, ["old"], ["new"]), undefined);
  assert.equal(semanticHunkIndexPatch("src/app.ts", {
    oldStartLine: 1,
    newStartLine: 1,
  }, ["old"], ["new"]), [
    "diff --git a/src/app.ts b/src/app.ts",
    "--- a/src/app.ts",
    "+++ b/src/app.ts",
    "@@ -1,1 +1,1 @@",
    "-old",
    "+new",
    "",
  ].join("\n"));
});
