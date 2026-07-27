// Review-refresh bookkeeping and synthetic review diffs for binary/image assets.
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

export function imageAssetReviewDiff(folder: vscode.WorkspaceFolder, file: ReviewRefreshFile): SemanticDiff {
  const leaf = path.basename(file.relativePath);
  const lifecycle = file.status === "untracked" ? "added" : file.status;
  const changeType = file.status === "deleted"
    ? "DELETION"
    : file.status === "added" || file.status === "untracked"
      ? "ADDITION"
      : "MODIFICATION";
  const artifactPath = file.status === "deleted"
    ? undefined
    : path.join(folder.uri.fsPath, file.relativePath);
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
      asset_diff: {
        status: "preview",
        summary: `${leaf} is a changed image asset. Working-tree preview is available; perceptual evidence has not been generated yet.`,
        artifacts: artifactPath ? {
          changed: artifactPath,
          preview: artifactPath,
        } : {},
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

