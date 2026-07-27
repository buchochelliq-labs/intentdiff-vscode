import assert from "node:assert/strict";
import test from "node:test";
import {
  appendReviewTimelineSnapshot,
  buildReviewTimelineItems,
  compareReviewTimelineSnapshots,
  createReviewTimelineSnapshot,
} from "../src/reviewTimelineModel";
import type { ReviewFile } from "../src/reviewModel";

function reviewFile(file: Partial<ReviewFile>): ReviewFile {
  return {
    folderName: "repo",
    folderUri: "file:///repo",
    relativePath: "src/app.py",
    status: "ready",
    ...file,
  };
}

test("review timeline model hides pending files and creates deterministic review items", () => {
  const items = buildReviewTimelineItems([
    reviewFile({
      relativePath: "src/app.py",
      status: "ready",
      diff: {
        language: "python",
        changes: [{ change_type: "MODIFY" }, { change_type: "MOVE" }],
      } as never,
    }),
    reviewFile({
      relativePath: "src/broken.py",
      status: "error",
      error: "parser failed",
    }),
    reviewFile({
      relativePath: "src/pending.py",
      status: "pending",
      pendingMessage: "waiting",
    }),
  ], () => 1234);

  assert.deepEqual(items, [
    {
      label: "src/app.py",
      description: "python",
      detail: "repo: 2 semantic changes",
      timestamp: 1234,
      iconId: "git-commit",
    },
    {
      label: "src/broken.py",
      description: "error",
      detail: "repo: 0 semantic changes",
      timestamp: 1234,
      iconId: "warning",
    },
  ]);
});

test("review timeline model uses singular wording for one semantic change", () => {
  const [item] = buildReviewTimelineItems([
    reviewFile({
      relativePath: "src/one.py",
      diff: {
        language: "python",
        changes: [{ change_type: "MODIFY" }],
      } as never,
    }),
  ], () => 5678);

  assert.equal(item.detail, "repo: 1 semantic change");
});

test("review timeline snapshots summarize persisted review history", () => {
  const snapshot = createReviewTimelineSnapshot([
    reviewFile({
      relativePath: "src/app.ts",
      diff: {
        language: "typescript",
        changes: [{ change_type: "MODIFY" }, { change_type: "MOVE" }],
        metadata: {
          engine_telemetry: {
            fuel_hotspots: [{ language: "typescript" }],
          },
        },
      } as never,
    }),
    reviewFile({
      relativePath: "src/broken.ts",
      status: "error",
      error: "FUEL_EXCEEDED",
    }),
    reviewFile({
      relativePath: "src/pending.ts",
      status: "pending",
    }),
  ], () => 9000);

  assert.deepEqual(snapshot, {
    id: "file:///repo::9000::2::2::1::1",
    timestamp: 9000,
    folderName: "repo",
    folderUri: "file:///repo",
    fileCount: 2,
    semanticChangeCount: 2,
    errorCount: 1,
    fuelHotspotCount: 1,
  });
});

test("review timeline model renders persisted snapshots before current items", () => {
  const items = buildReviewTimelineItems([
    reviewFile({
      relativePath: "src/current.py",
      diff: {
        language: "python",
        changes: [{ change_type: "MODIFY" }],
      } as never,
    }),
  ], () => 100, [
    {
      id: "older",
      timestamp: 50,
      folderName: "repo",
      folderUri: "file:///repo",
      fileCount: 2,
      semanticChangeCount: 3,
      errorCount: 0,
      fuelHotspotCount: 0,
    },
    {
      id: "newer",
      timestamp: 75,
      folderName: "repo",
      folderUri: "file:///repo",
      fileCount: 1,
      semanticChangeCount: 0,
      errorCount: 1,
      fuelHotspotCount: 2,
    },
  ]);

  assert.equal(items[0].label, "Review snapshot: repo");
  assert.equal(items[0].timestamp, 75);
  assert.equal(items[0].iconId, "warning");
  assert.equal(items[0].detail, "0 semantic changes, 1 error, 2 fuel hotspots");
  assert.equal(items[1].timestamp, 50);
  assert.equal(items[2].label, "src/current.py");
});

test("review timeline snapshot append deduplicates and enforces history limit", () => {
  const snapshots = appendReviewTimelineSnapshot([
    {
      id: "same",
      timestamp: 1,
      folderName: "repo",
      folderUri: "file:///repo",
      fileCount: 1,
      semanticChangeCount: 1,
      errorCount: 0,
      fuelHotspotCount: 0,
    },
    {
      id: "older",
      timestamp: 2,
      folderName: "repo",
      folderUri: "file:///repo",
      fileCount: 1,
      semanticChangeCount: 1,
      errorCount: 0,
      fuelHotspotCount: 0,
    },
  ], {
    id: "same",
    timestamp: 3,
    folderName: "repo",
    folderUri: "file:///repo",
    fileCount: 2,
    semanticChangeCount: 4,
    errorCount: 0,
    fuelHotspotCount: 0,
  }, 2);

  assert.deepEqual(snapshots.map((snapshot) => snapshot.id), ["older", "same"]);
  assert.equal(snapshots[1].timestamp, 3);
});

test("review timeline snapshot comparison summarizes latest deltas", () => {
  const comparison = compareReviewTimelineSnapshots([
    {
      id: "older",
      timestamp: 10,
      folderName: "repo",
      folderUri: "file:///repo",
      fileCount: 2,
      semanticChangeCount: 3,
      errorCount: 1,
      fuelHotspotCount: 0,
    },
    {
      id: "newer",
      timestamp: 20,
      folderName: "repo",
      folderUri: "file:///repo",
      fileCount: 4,
      semanticChangeCount: 1,
      errorCount: 0,
      fuelHotspotCount: 2,
    },
  ]);

  assert.deepEqual(comparison, {
    baselineId: "older",
    latestId: "newer",
    fileDelta: 2,
    semanticChangeDelta: -2,
    errorDelta: -1,
    fuelHotspotDelta: 2,
    summary: "+2 files, -2 semantic changes, -1 error, +2 fuel hotspots",
  });
  assert.equal(compareReviewTimelineSnapshots([]), undefined);
  assert.equal(compareReviewTimelineSnapshots([{
    id: "only",
    timestamp: 20,
    folderName: "repo",
    folderUri: "file:///repo",
    fileCount: 4,
    semanticChangeCount: 1,
    errorCount: 0,
    fuelHotspotCount: 2,
  }]), undefined);
});
