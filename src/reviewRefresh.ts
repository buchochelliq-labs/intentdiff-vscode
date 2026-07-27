import type { WorkingTreeStatus } from "./gitStatus";

export interface ReviewRefreshFile {
  relativePath: string;
  status: WorkingTreeStatus;
  stamp: string;
}

export interface ReviewRefreshSnapshot {
  ref: string;
  resolvedCommit?: string;
  statusSignature: string;
  files: ReviewRefreshFile[];
}

export interface ReviewRefreshOptions {
  hasCrossFileChanges?: boolean;
  maxIncrementalPaths?: number;
}

export type ReviewRefreshPlan =
  | { kind: "full"; reason: string }
  | { kind: "incremental"; refresh: ReviewRefreshFile[]; remove: string[] };

const DEFAULT_MAX_INCREMENTAL_PATHS = 10;

export function createReviewRefreshSnapshot(
  ref: string,
  resolvedCommit: string | undefined,
  files: ReviewRefreshFile[],
): ReviewRefreshSnapshot {
  const sortedFiles = sortFiles(files);
  return {
    ref,
    resolvedCommit,
    statusSignature: sortedFiles
      .map((file) => `${file.status}:${file.relativePath}:${file.stamp}`)
      .join("|"),
    files: sortedFiles,
  };
}

export function planReviewRefresh(
  previous: ReviewRefreshSnapshot | undefined,
  current: ReviewRefreshSnapshot,
  options: ReviewRefreshOptions = {},
): ReviewRefreshPlan {
  if (!previous) {
    return { kind: "full", reason: "initial review" };
  }
  if (previous.ref !== current.ref) {
    return { kind: "full", reason: "configured ref changed" };
  }
  if ((previous.resolvedCommit ?? "") !== (current.resolvedCommit ?? "")) {
    return { kind: "full", reason: "resolved ref changed" };
  }
  if (options.hasCrossFileChanges === true && previous.statusSignature !== current.statusSignature) {
    return { kind: "full", reason: "cross-file changes are shown" };
  }
  if (hasStatus(previous, "renamed") || hasStatus(current, "renamed")) {
    return { kind: "full", reason: "rename detected" };
  }
  if (hasStatus(previous, "unknown") || hasStatus(current, "unknown")) {
    return { kind: "full", reason: "unknown git status" };
  }

  const previousByPath = new Map(previous.files.map((file) => [file.relativePath, file]));
  const currentByPath = new Map(current.files.map((file) => [file.relativePath, file]));
  if (hasPossibleRenamePair(previousByPath, current.files)) {
    return { kind: "full", reason: "possible rename detected" };
  }
  const refresh = current.files.filter((file) => {
    const oldFile = previousByPath.get(file.relativePath);
    return !oldFile || oldFile.status !== file.status || oldFile.stamp !== file.stamp;
  });
  const remove = previous.files
    .filter((file) => !currentByPath.has(file.relativePath))
    .map((file) => file.relativePath);

  const changedPathCount = refresh.length + remove.length;
  const maxIncrementalPaths = options.maxIncrementalPaths ?? DEFAULT_MAX_INCREMENTAL_PATHS;
  if (changedPathCount > maxIncrementalPaths) {
    return { kind: "full", reason: "too many paths changed" };
  }
  return { kind: "incremental", refresh, remove };
}

function sortFiles(files: ReviewRefreshFile[]): ReviewRefreshFile[] {
  return [...files].sort((a, b) => a.relativePath.localeCompare(b.relativePath));
}

function hasStatus(snapshot: ReviewRefreshSnapshot, status: WorkingTreeStatus): boolean {
  return snapshot.files.some((file) => file.status === status);
}

function hasPossibleRenamePair(
  previousByPath: Map<string, ReviewRefreshFile>,
  currentFiles: ReviewRefreshFile[],
): boolean {
  let hasNewDeletedPath = false;
  let hasNewCreatedPath = false;
  for (const file of currentFiles) {
    const previous = previousByPath.get(file.relativePath);
    if (file.status === "deleted" && previous?.status !== "deleted") {
      hasNewDeletedPath = true;
    }
    if ((file.status === "added" || file.status === "untracked") && !previous) {
      hasNewCreatedPath = true;
    }
  }
  return hasNewDeletedPath && hasNewCreatedPath;
}
