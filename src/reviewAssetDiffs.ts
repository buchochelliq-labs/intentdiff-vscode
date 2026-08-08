// Review-refresh bookkeeping and the review entries for binary/image assets.
//
// The perceptual half of an image review is the engine's: every metric, artifact, hotspot and
// histogram in `metadata.asset_diff` arrives from the live-server's `asset_diff` op and is
// passed through untouched. This module supplies the lifecycle scaffolding around it and
// nothing else — an entry here never describes a comparison that has not been made.
import * as path from "path";
import * as vscode from "vscode";
import type { ReviewFileGroupingMode } from "./reviewModel";
import type { ReviewRefreshFile } from "./reviewRefresh";
import type { SemanticDiff } from "./types";

export function reviewKey(folderUri: string, relativePath: string): string {
  return `${folderUri}::${relativePath}`;
}

export function isImageLikePath(relativePath: string): boolean {
  return /\.(png|jpe?g|webp)$/iu.test(relativePath);
}

/** A minimal review entry for a changed binary/non-text asset the engine skips. */
export function nonTextAssetReviewDiff(file: ReviewRefreshFile): SemanticDiff {
  const leaf = path.basename(file.relativePath);
  const lifecycle = file.status === "untracked" ? "added" : file.status;
  const changeType = file.status === "deleted"
    ? "DELETION"
    : file.status === "added" || file.status === "untracked"
      ? "ADDITION"
      : "MODIFICATION";
  return {
    old_filename: file.relativePath,
    new_filename: file.relativePath,
    language: "binary",
    has_semantic_changes: false,
    is_style_only: false,
    is_fallback: false,
    parse_errors: [],
    guardrail_violations: [],
    change_groups: [],
    changes: [{
      change_type: changeType,
      description: `${leaf} binary asset ${lifecycle} (not text-diffable)`,
      old_node: null,
      new_node: null,
    }],
    metadata: {
      file_lifecycle: lifecycle,
      content_type: { category: "binary", is_text: false },
    },
  };
}

/**
 * The review entry for a changed image, before the engine has been asked anything.
 *
 * It carries the file's lifecycle and the working-tree image itself, and deliberately carries
 * no `asset_diff`: the panel must be able to tell "the perceptual comparison has not come back
 * yet" from "here it is". The previous version of this function filled that field in with a
 * plausible placeholder and never called the engine at all, so the panel promised evidence
 * that was never coming. themeColors.test.ts pins that the placeholder stays gone.
 */
export function imageAssetReviewDiff(folder: vscode.WorkspaceFolder, file: ReviewRefreshFile): SemanticDiff {
  const leaf = path.basename(file.relativePath);
  const lifecycle = file.status === "untracked" ? "added" : file.status;
  const changeType = file.status === "deleted"
    ? "DELETION"
    : file.status === "added" || file.status === "untracked"
      ? "ADDITION"
      : "MODIFICATION";
  return {
    old_filename: file.relativePath,
    new_filename: file.relativePath,
    language: path.extname(file.relativePath).replace(".", "").toLowerCase() || "image",
    has_semantic_changes: true,
    is_style_only: false,
    is_fallback: false,
    parse_errors: [],
    guardrail_violations: [],
    change_groups: [{
      kind: "asset",
      raw_change_indices: [0],
      new_labels: [leaf],
      metadata: {
        file_lifecycle: lifecycle,
        asset_provider: "image",
      },
    }],
    changes: [{
      change_type: changeType,
      description: `${leaf} image asset ${file.status === "untracked" ? "added" : file.status}`,
      old_node: file.status === "deleted" ? {
        node_type: "image_asset",
        label: leaf,
        position: null,
      } : null,
      new_node: file.status === "deleted" ? null : {
        node_type: "image_asset",
        label: leaf,
        position: null,
      },
    }],
    metadata: {
      file_lifecycle: lifecycle,
      // Not an artifact — the user's own file on disk, so a reader can at least see the image
      // when the engine has nothing to compare it against (added and deleted images).
      working_tree_image: file.status === "deleted"
        ? undefined
        : path.join(folder.uri.fsPath, file.relativePath),
    },
  };
}

/**
 * Attach the engine's perceptual manifest to an image review entry, verbatim.
 *
 * Everything the viewer draws — metrics, before/after/diff/heatmap/mask/overlay artifacts,
 * hotspot geometry, channel histograms — comes from `crates/rust-core-host/src/asset_diff.rs`.
 * Nothing is added, renamed, or defaulted on the way through: a field the engine did not send
 * is a field the panel must not show.
 */
export function withEngineAssetDiff(
  diff: SemanticDiff,
  manifest: Record<string, unknown>,
): SemanticDiff {
  return {
    ...diff,
    metadata: {
      ...(diff.metadata ?? {}),
      asset_diff: manifest,
    },
  };
}

/**
 * Record that the engine could not be asked, or refused — with its reason.
 *
 * A failed request is a distinct state from "no comparison is possible" (added/deleted, which
 * the engine itself reports as `skipped`). Both are honest; neither is a comparison.
 */
export function withAssetDiffFailure(diff: SemanticDiff, reason: string): SemanticDiff {
  return {
    ...diff,
    metadata: {
      ...(diff.metadata ?? {}),
      asset_diff: {
        kind: "asset_diff",
        provider: "image",
        status: "unavailable",
        reason,
        summary: `Perceptual comparison unavailable: ${reason}`,
      },
    },
  };
}

export function normalizeReviewDiffFilenames(
  diff: SemanticDiff,
  relativePath: string,
  status: ReviewRefreshFile["status"],
): SemanticDiff {
  if (status === "deleted") {
    return {
      ...diff,
      old_filename: diff.old_filename ?? relativePath,
      new_filename: undefined,
      metadata: {
        ...diff.metadata,
        file_lifecycle: "deleted",
      },
    };
  }
  if (status === "added" || status === "untracked") {
    return {
      ...diff,
      old_filename: undefined,
      new_filename: diff.new_filename ?? relativePath,
      metadata: {
        ...diff.metadata,
        file_lifecycle: "added",
      },
    };
  }
  return {
    ...diff,
    old_filename: diff.old_filename ?? relativePath,
    new_filename: diff.new_filename ?? relativePath,
  };
}

export function requestKey(folderUri: string, seq: number): string {
  return `${folderUri}::${seq}`;
}

export function pendingMessageFor(file: ReviewRefreshFile): string {
  if (file.status === "deleted") {
    return "Refreshing deleted file...";
  }
  if (file.status === "added" || file.status === "untracked") {
    return "Refreshing new file...";
  }
  return "Refreshing semantic changes...";
}

export function reviewGroupingModeLabel(mode: ReviewFileGroupingMode): string {
  if (mode === "auto") {
    return "auto";
  }
  if (mode === "none") {
    return "flat";
  }
  if (mode === "language") {
    return "language";
  }
  if (mode === "schema") {
    return "schema";
  }
  return "language + schema";
}

