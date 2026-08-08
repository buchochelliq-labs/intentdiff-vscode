// The extension half of the perceptual asset diff (intentumdiff-vscode#25).
//
// These pin one rule: the extension asks the engine and passes the answer through. It does not
// describe an image, invent metrics, or claim evidence exists. The behaviour being wired to is
// pinned in Rust (`asset_diff.rs`) and over the protocol (`test_live_server_asset_diff.py`).
import assert from "node:assert/strict";
import test from "node:test";

import { LiveServerClient, type ClientEvent } from "../src/protocol";
import {
  imageAssetReviewDiff,
  withAssetDiffFailure,
  withEngineAssetDiff,
} from "../src/reviewAssetDiffs";
import type { ReviewRefreshFile } from "../src/reviewRefresh";
import type { SemanticDiff } from "../src/types";

const folder = {
  uri: { fsPath: "C:\\repo", toString: () => "file:///c%3A/repo" },
  name: "repo",
  index: 0,
} as unknown as Parameters<typeof imageAssetReviewDiff>[0];

function refreshFile(status: ReviewRefreshFile["status"]): ReviewRefreshFile {
  return { relativePath: "assets/card.png", status, stamp: "1" } as ReviewRefreshFile;
}

/** A manifest shaped like the engine's, so the pass-through is tested against the real keys. */
const ENGINE_MANIFEST = {
  kind: "asset_diff",
  provider: "image",
  status: "compared",
  file_path: "assets/card.png",
  changed_pixel_percentage: 12.5,
  mean_absolute_error: 4.25,
  comparison_dimensions: { width: 32, height: 32 },
  artifacts: {
    before: "C:\\repo\\.intentumdiff-cache\\assets\\card\\before.png",
    after: "C:\\repo\\.intentumdiff-cache\\assets\\card\\after.png",
    diff: "C:\\repo\\.intentumdiff-cache\\assets\\card\\diff.png",
    heatmap: "C:\\repo\\.intentumdiff-cache\\assets\\card\\heatmap.png",
    mask: "C:\\repo\\.intentumdiff-cache\\assets\\card\\mask.png",
    overlay: "C:\\repo\\.intentumdiff-cache\\assets\\card\\overlay.png",
    contact_sheet: "C:\\repo\\.intentumdiff-cache\\assets\\card\\contact-sheet.png",
  },
  hotspots: [{ id: "hotspot-1", bbox: { x: 6, y: 8, width: 14, height: 14 } }],
  histograms: { bins: 16, red_delta: [1, 2, 3] },
};

test("a fresh image review entry claims no perceptual comparison", () => {
  const diff = imageAssetReviewDiff(folder, refreshFile("modified"));

  // The entry must be distinguishable from one the engine has answered. Filling in a
  // placeholder here is what made the panel promise evidence it never went on to fetch.
  assert.equal(diff.metadata?.asset_diff, undefined);
  assert.equal(diff.metadata?.file_lifecycle, "modified");
  assert.equal(diff.has_semantic_changes, true);
  // The changed file itself is still offered, and is labelled as the working tree, not an
  // engine artifact.
  assert.match(String(diff.metadata?.working_tree_image), /assets[\\/]card\.png$/u);
});

test("a deleted image offers no working-tree preview, because there is no file", () => {
  const diff = imageAssetReviewDiff(folder, refreshFile("deleted"));

  assert.equal(diff.metadata?.working_tree_image, undefined);
  assert.equal(diff.changes?.[0].change_type, "DELETION");
});

test("the engine's manifest is attached verbatim, key for key", () => {
  const merged = withEngineAssetDiff(imageAssetReviewDiff(folder, refreshFile("modified")), ENGINE_MANIFEST);

  // Deep-equal, not a spot check: anything renamed, dropped or defaulted on the way through is
  // a value the panel would then be showing on the extension's authority rather than the
  // engine's.
  assert.deepEqual(merged.metadata?.asset_diff, ENGINE_MANIFEST);
  // Merging must not discard the lifecycle scaffolding the entry already carried.
  assert.equal(merged.metadata?.file_lifecycle, "modified");
  assert.notEqual(merged.metadata?.working_tree_image, undefined);
});

test("a failed request is recorded as unavailable, with the reason, and no metrics", () => {
  const failed = withAssetDiffFailure(
    imageAssetReviewDiff(folder, refreshFile("modified")),
    "asset diff failed: git rev not found: origin/nope",
  );

  const assetDiff = failed.metadata?.asset_diff as Record<string, unknown>;
  assert.equal(assetDiff.status, "unavailable");
  assert.match(String(assetDiff.reason), /git rev not found/u);
  assert.equal(assetDiff.artifacts, undefined);
  assert.equal(assetDiff.changed_pixel_percentage, undefined);
});

function clientWithLog(): { client: LiveServerClient; sent: string[]; events: ClientEvent[] } {
  const sent: string[] = [];
  const events: ClientEvent[] = [];
  const client = new LiveServerClient({ writeLine: (line) => sent.push(line) });
  client.onEvent((event) => events.push(event));
  return { client, sent, events };
}

test("assetDiff sends a path and a ref, and nothing else the engine can read files with", () => {
  const { client, sent } = clientWithLog();

  const seq = client.assetDiff("assets/card.png", { ref: "origin/main" });

  assert.equal(sent.length, 1);
  assert.deepEqual(JSON.parse(sent[0]), {
    op: "asset_diff",
    seq,
    path: "assets/card.png",
    ref: "origin/main",
  });
});

test("an asset_diff response is delivered with the path it was requested for", () => {
  const { client, events } = clientWithLog();
  const seq = client.assetDiff("assets/card.png");

  client.handleLine(JSON.stringify({ op: "asset_diff", seq, ok: true, done: true, result: ENGINE_MANIFEST }));

  assert.equal(events.length, 1);
  const event = events[0];
  assert.equal(event.kind, "asset_diff");
  if (event.kind !== "asset_diff") {
    return;
  }
  assert.equal(event.result.path, "assets/card.png");
  assert.deepEqual(event.result.manifest, ENGINE_MANIFEST);
});

test("an asset_diff response for an unknown seq is dropped, not attributed to another file", () => {
  const { client, events } = clientWithLog();
  client.assetDiff("assets/card.png");

  client.handleLine(JSON.stringify({ op: "asset_diff", seq: 999, ok: true, result: ENGINE_MANIFEST }));

  assert.deepEqual(events, []);
});

test("a duplicate asset_diff response is delivered once", () => {
  const { client, events } = clientWithLog();
  const seq = client.assetDiff("assets/card.png");
  const line = JSON.stringify({ op: "asset_diff", seq, ok: true, result: ENGINE_MANIFEST });

  client.handleLine(line);
  client.handleLine(line);

  assert.equal(events.filter((event) => event.kind === "asset_diff").length, 1);
});

test("an asset_diff failure surfaces as an error carrying the engine's message", () => {
  const { client, events } = clientWithLog();
  const seq = client.assetDiff("assets/card.png");

  client.handleLine(JSON.stringify({
    op: "asset_diff",
    seq,
    ok: false,
    error: { code: "internal", message: "asset diff failed: unsupported image" },
  }));

  const event = events[0];
  assert.equal(event.kind, "error");
  if (event.kind !== "error") {
    return;
  }
  assert.equal(event.seq, seq);
  assert.match(event.error.message, /unsupported image/u);
});

test("a diff request and an asset request do not collide on seq bookkeeping", () => {
  const { client, events } = clientWithLog();
  const diffSeq = client.diff("src/app.py", "print(1)\n");
  const assetSeq = client.assetDiff("assets/card.png");
  assert.notEqual(diffSeq, assetSeq);

  const diff: SemanticDiff = { old_filename: "src/app.py", new_filename: "src/app.py" };
  client.handleLine(JSON.stringify({ op: "asset_diff", seq: assetSeq, ok: true, result: ENGINE_MANIFEST }));
  client.handleLine(JSON.stringify({ op: "diff", seq: diffSeq, ok: true, diff }));

  assert.deepEqual(events.map((event) => event.kind), ["asset_diff", "diff"]);
});
