import assert from "node:assert/strict";
import test from "node:test";
import { parseGitStatusPorcelain } from "../src/gitStatus";

test("parseGitStatusPorcelain handles common working-tree states", () => {
  assert.deepEqual(
    parseGitStatusPorcelain([
      " M src/app.py",
      "A  src/new.py",
      "?? scratch.yaml",
      "D  old.yaml",
      "R  old-name.yaml -> new-name.yaml",
      ' M "space dir/file.yaml"',
    ].join("\n")),
    [
      { relativePath: "src/app.py", status: "modified" },
      { relativePath: "src/new.py", status: "added" },
      { relativePath: "scratch.yaml", status: "untracked" },
      { relativePath: "old.yaml", status: "deleted" },
      { relativePath: "new-name.yaml", status: "renamed" },
      { relativePath: "space dir/file.yaml", status: "modified" },
    ],
  );
});

test("parseGitStatusPorcelain skips untracked directories (trailing-slash paths)", () => {
  // `git status --porcelain` collapses an untracked directory to a single
  // trailing-slash entry; it is not a reviewable file and `git show <ref>:dir/`
  // would fail, so it must be dropped while real files are kept.
  assert.deepEqual(
    parseGitStatusPorcelain([
      "?? .claude/",
      "?? dist/",
      " M image.png",
      "?? notes.txt",
    ].join("\n")),
    [
      { relativePath: "image.png", status: "modified" },
      { relativePath: "notes.txt", status: "untracked" },
    ],
  );
});
