import * as path from "path";
import { assertSafeRelativePath } from "./baseUri";
import type { NodePosition, SemanticChange } from "./types";

export interface ReviewActionPayloadLike {
  folderUri?: string;
  relativePath?: string;
}

export interface ReviewActionTarget {
  fsPath: string;
}

export interface ReviewActionTargetResult {
  target?: ReviewActionTarget;
  error?: string;
}

export type SemanticReviewActionKind = "stageHunk" | "revertHunk" | "applyHunk";

export interface SemanticReviewActionPayloadLike extends ReviewActionPayloadLike {
  change?: SemanticChange;
  actionKind?: SemanticReviewActionKind;
  hunk?: SemanticReviewHunkPayloadLike;
}

export interface SemanticReviewHunkPayloadLike {
  oldLines?: string[];
  newLines?: string[];
  oldStartLine?: number;
  oldEndLine?: number;
  newStartLine?: number;
  newEndLine?: number;
}

export interface SemanticReviewActionTarget extends ReviewActionTarget {
  kind: SemanticReviewActionKind;
  startLine: number;
  endLine: number;
  side: "base" | "modified";
  previewLabel: string;
}

export interface SemanticReviewActionTargetResult {
  target?: SemanticReviewActionTarget;
  error?: string;
}

export interface SemanticReviewHunkEdit {
  target: SemanticReviewActionTarget;
  relativePath: string;
  editStartLine: number;
  editEndLine: number;
  replacementLines: string[];
  replacementText: string;
  previewPatch: string;
  indexPatch?: string;
}

export interface SemanticReviewHunkEditResult {
  edit?: SemanticReviewHunkEdit;
  error?: string;
}

export function reviewActionTargetForPayload(
  payload: ReviewActionPayloadLike | undefined,
  folderFsPath: (folderUri: string) => string,
): ReviewActionTargetResult {
  if (!payload?.folderUri || !payload.relativePath) {
    return {};
  }
  try {
    assertSafeRelativePath(payload.relativePath);
    return {
      target: {
        fsPath: path.join(folderFsPath(payload.folderUri), payload.relativePath),
      },
    };
  } catch (error) {
    return {
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

export function semanticReviewActionTargetForPayload(
  payload: SemanticReviewActionPayloadLike | undefined,
  folderFsPath: (folderUri: string) => string,
): SemanticReviewActionTargetResult {
  const fileTarget = reviewActionTargetForPayload(payload, folderFsPath);
  if (fileTarget.error || !fileTarget.target) {
    return fileTarget.error ? { error: fileTarget.error } : {};
  }
  const kind = payload?.actionKind;
  if (!kind) {
    return { error: "missing semantic review action kind" };
  }
  const change = payload?.change;
  if (!change) {
    return { error: "missing semantic review change" };
  }
  const side = semanticActionSide(kind, change);
  const position = side === "base" ? change.old_node?.position : change.new_node?.position;
  const range = semanticActionRange(position);
  if (!range) {
    return { error: "semantic review action has no concrete line range" };
  }
  return {
    target: {
      ...fileTarget.target,
      kind,
      side,
      startLine: range.startLine,
      endLine: range.endLine,
      previewLabel: semanticActionPreviewLabel(kind, change),
    },
  };
}

export function semanticReviewHunkEditForPayload(
  payload: SemanticReviewActionPayloadLike | undefined,
  folderFsPath: (folderUri: string) => string,
): SemanticReviewHunkEditResult {
  const targetResult = semanticReviewActionTargetForPayload(payload, folderFsPath);
  if (!targetResult.target) {
    return targetResult.error ? { error: targetResult.error } : {};
  }
  const hunk = payload?.hunk;
  if (!hunk) {
    return { error: "semantic review hunk action has no hunk text" };
  }
  const oldLines = concreteLines(hunk.oldLines);
  const newLines = concreteLines(hunk.newLines);
  const modifiedRange = semanticModifiedEditRange(payload.actionKind, hunk);
  if (!modifiedRange) {
    return { error: "semantic review hunk action has no modified-side edit range" };
  }
  const replacementLines = payload.actionKind === "revertHunk" ? oldLines : newLines;
  if (payload.actionKind === "revertHunk" && oldLines.length === 0) {
    return { error: "semantic review hunk revert has no base-side lines" };
  }
  if ((payload.actionKind === "applyHunk" || payload.actionKind === "stageHunk") && newLines.length === 0) {
    return { error: "semantic review hunk apply has no modified-side lines" };
  }
  const edit: SemanticReviewHunkEdit = {
    target: targetResult.target,
    relativePath: payload?.relativePath ?? "",
    editStartLine: modifiedRange.startLine,
    editEndLine: modifiedRange.endLine,
    replacementLines,
    replacementText: replacementLines.join("\n"),
    previewPatch: semanticHunkPreviewPatch(
      targetResult.target.fsPath,
      payload.actionKind,
      modifiedRange.startLine,
      modifiedRange.endLine,
      oldLines,
      newLines,
      replacementLines,
    ),
    indexPatch: payload.actionKind === "stageHunk"
      ? semanticHunkIndexPatch(payload.relativePath ?? "", hunk, oldLines, newLines)
      : undefined,
  };
  return { edit };
}

function semanticActionSide(
  kind: SemanticReviewActionKind,
  change: SemanticChange,
): "base" | "modified" {
  if (kind === "revertHunk" && change.old_node?.position) {
    return "base";
  }
  return "modified";
}

function semanticActionRange(position: NodePosition | null | undefined): { startLine: number; endLine: number } | undefined {
  if (!position) {
    return undefined;
  }
  const startLine = Math.max(0, Math.floor(position.start_line));
  const endLine = Math.max(startLine, Math.floor(position.end_line));
  if (!Number.isFinite(startLine) || !Number.isFinite(endLine)) {
    return undefined;
  }
  return { startLine, endLine };
}

function semanticModifiedEditRange(
  kind: SemanticReviewActionKind | undefined,
  hunk: SemanticReviewHunkPayloadLike,
): { startLine: number; endLine: number } | undefined {
  const startLine = finiteLine(hunk.newStartLine);
  const endLine = finiteLine(hunk.newEndLine);
  if (startLine !== undefined && endLine !== undefined) {
    return { startLine, endLine: Math.max(startLine, endLine) };
  }
  if (kind === "applyHunk" && hunk.newLines?.length) {
    return { startLine: 1, endLine: hunk.newLines.length };
  }
  return undefined;
}

function finiteLine(value: unknown): number | undefined {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return undefined;
  }
  return Math.max(1, Math.floor(value));
}

function concreteLines(lines: string[] | undefined): string[] {
  return Array.isArray(lines) ? lines.map((line) => String(line)) : [];
}

function semanticHunkPreviewPatch(
  fsPath: string,
  kind: SemanticReviewActionKind | undefined,
  startLine: number,
  endLine: number,
  oldLines: string[],
  newLines: string[],
  replacementLines: string[],
): string {
  const header = [
    `IntentumDiff semantic hunk ${kind ?? "action"}`,
    `file ${fsPath}`,
    `working lines ${startLine}-${endLine}`,
  ];
  const before = oldLines.length > 0 ? oldLines.map((line) => `- ${line}`) : ["- <empty>"];
  const afterSource = kind === "revertHunk" ? replacementLines : newLines;
  const after = afterSource.length > 0 ? afterSource.map((line) => `+ ${line}`) : ["+ <empty>"];
  return [...header, ...before, ...after].join("\n");
}

export function semanticHunkIndexPatch(
  relativePath: string,
  hunk: SemanticReviewHunkPayloadLike,
  oldLines: string[],
  newLines: string[],
): string | undefined {
  try {
    assertSafeRelativePath(relativePath);
  } catch {
    return undefined;
  }
  const oldStart = finiteLine(hunk.oldStartLine)
    ?? Math.max(1, (finiteLine(hunk.newStartLine) ?? 1) - (oldLines.length === 0 ? 1 : 0));
  const newStart = finiteLine(hunk.newStartLine) ?? oldStart;
  const oldCount = oldLines.length;
  const newCount = newLines.length;
  const header = [
    `diff --git a/${relativePath} b/${relativePath}`,
    `--- a/${relativePath}`,
    `+++ b/${relativePath}`,
    `@@ -${oldStart},${oldCount} +${newStart},${newCount} @@`,
  ];
  const body = [
    ...oldLines.map((line) => `-${line}`),
    ...newLines.map((line) => `+${line}`),
  ];
  return [...header, ...body, ""].join("\n");
}

function semanticActionPreviewLabel(kind: SemanticReviewActionKind, change: SemanticChange): string {
  const label = change.new_node?.label || change.old_node?.label || change.description || "semantic hunk";
  if (kind === "stageHunk") {
    return `Stage semantic hunk: ${label}`;
  }
  if (kind === "revertHunk") {
    return `Revert semantic hunk: ${label}`;
  }
  return `Apply semantic hunk: ${label}`;
}
