import assert from "node:assert/strict";
import test from "node:test";
import {
  createReviewRefreshSnapshot,
  planReviewRefresh,
  type ReviewRefreshFile,
} from "../src/reviewRefresh";

test("modified file refreshes only that path", () => {
  const previous = snapshot([
    file("src/app.py", "modified", "mtime:1"),
    file("README.md", "modified", "mtime:1"),
  ]);
  const current = snapshot([
    file("src/app.py", "modified", "mtime:2"),
    file("README.md", "modified", "mtime:1"),
  ]);

  assert.deepEqual(planReviewRefresh(previous, current), {
    kind: "incremental",
    refresh: [file("src/app.py", "modified", "mtime:2")],
    remove: [],
  });
});

test("added and untracked files refresh those paths", () => {
  const previous = snapshot([]);
  const current = snapshot([
    file("src/new.py", "added", "mtime:1"),
    file("scratch.yaml", "untracked", "mtime:1"),
  ]);

  assert.deepEqual(planReviewRefresh(previous, current), {
    kind: "incremental",
    refresh: [
      file("scratch.yaml", "untracked", "mtime:1"),
      file("src/new.py", "added", "mtime:1"),
    ],
    remove: [],
  });
});

test("deleted file refreshes with deleted status", () => {
  const previous = snapshot([file("config.yaml", "modified", "mtime:1")]);
  const current = snapshot([file("config.yaml", "deleted", "deleted")]);

  assert.deepEqual(planReviewRefresh(previous, current), {
    kind: "incremental",
    refresh: [file("config.yaml", "deleted", "deleted")],
    remove: [],
  });
});

test("committed or clean file removes stale entry", () => {
  const previous = snapshot([file("config.yaml", "modified", "mtime:1")]);
  const current = snapshot([]);

  assert.deepEqual(planReviewRefresh(previous, current), {
    kind: "incremental",
    refresh: [],
    remove: ["config.yaml"],
  });
});

test("ref change requests full review", () => {
  const previous = snapshot([file("config.yaml", "modified", "mtime:1")], "HEAD", "aaa");
  const current = snapshot([file("config.yaml", "modified", "mtime:1")], "HEAD", "bbb");

  assert.deepEqual(planReviewRefresh(previous, current), {
    kind: "full",
    reason: "resolved ref changed",
  });
});

test("rename requests full review", () => {
  const previous = snapshot([file("old.yaml", "renamed", "mtime:1")]);
  const current = snapshot([file("new.yaml", "renamed", "mtime:1")]);

  assert.deepEqual(planReviewRefresh(previous, current), {
    kind: "full",
    reason: "rename detected",
  });
});

test("unstaged rename-shaped delete plus create requests full review", () => {
  const previous = snapshot([
    file("README.md", "modified", "mtime:1"),
  ]);
  const current = snapshot([
    file("README.md", "modified", "mtime:1"),
    file("old.yaml", "deleted", "deleted"),
    file("new.yaml", "untracked", "mtime:1"),
  ]);

  assert.deepEqual(planReviewRefresh(previous, current), {
    kind: "full",
    reason: "possible rename detected",
  });
});

test("cross-file review falls back to full when status changed", () => {
  const previous = snapshot([file("src/app.py", "modified", "mtime:1")]);
  const current = snapshot([file("src/app.py", "modified", "mtime:2")]);

  assert.deepEqual(planReviewRefresh(previous, current, { hasCrossFileChanges: true }), {
    kind: "full",
    reason: "cross-file changes are shown",
  });
});

function snapshot(
  files: ReviewRefreshFile[],
  ref = "HEAD",
  resolvedCommit = "abc123",
) {
  return createReviewRefreshSnapshot(ref, resolvedCommit, files);
}

function file(
  relativePath: string,
  status: ReviewRefreshFile["status"],
  stamp: string,
): ReviewRefreshFile {
  return { relativePath, status, stamp };
}
