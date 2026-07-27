import type { ReviewFile } from "./reviewModel";

export interface ReviewTimelineItemModel {
  label: string;
  timestamp: number;
  description: string;
  detail: string;
  iconId: "git-commit" | "warning";
}

export interface ReviewTimelineSnapshot {
  id: string;
  timestamp: number;
  folderName: string;
  folderUri: string;
  fileCount: number;
  semanticChangeCount: number;
  errorCount: number;
  fuelHotspotCount: number;
}

export interface ReviewTimelineSnapshotComparison {
  baselineId: string;
  latestId: string;
  fileDelta: number;
  semanticChangeDelta: number;
  errorDelta: number;
  fuelHotspotDelta: number;
  summary: string;
}

export function buildReviewTimelineItems(
  files: ReviewFile[],
  now: () => number = Date.now,
  snapshots: ReviewTimelineSnapshot[] = [],
): ReviewTimelineItemModel[] {
  const timestamp = now();
  const currentItems: ReviewTimelineItemModel[] = files
    .filter((file) => file.status !== "pending")
    .map((file) => {
      const changeCount = file.diff?.changes?.length ?? 0;
      return {
        label: file.relativePath,
        description: file.diff?.language ?? file.status,
        detail: `${file.folderName}: ${changeCount} semantic change${changeCount === 1 ? "" : "s"}`,
        timestamp,
        iconId: file.status === "ready" ? "git-commit" as const : "warning" as const,
      };
    });
  const snapshotItems: ReviewTimelineItemModel[] = snapshots
    .slice()
    .sort((a, b) => b.timestamp - a.timestamp)
    .map((snapshot) => ({
      label: `Review snapshot: ${snapshot.folderName}`,
      description: `${snapshot.fileCount} file${snapshot.fileCount === 1 ? "" : "s"}`,
      detail: `${snapshot.semanticChangeCount} semantic change${snapshot.semanticChangeCount === 1 ? "" : "s"}, ${snapshot.errorCount} error${snapshot.errorCount === 1 ? "" : "s"}, ${snapshot.fuelHotspotCount} fuel hotspot${snapshot.fuelHotspotCount === 1 ? "" : "s"}`,
      timestamp: snapshot.timestamp,
      iconId: snapshot.errorCount > 0 || snapshot.fuelHotspotCount > 0 ? "warning" as const : "git-commit" as const,
    }));
  return [...snapshotItems, ...currentItems];
}

export function createReviewTimelineSnapshot(
  files: ReviewFile[],
  now: () => number = Date.now,
): ReviewTimelineSnapshot | undefined {
  const visibleFiles = files.filter((file) => file.status !== "pending");
  if (visibleFiles.length === 0) {
    return undefined;
  }
  const timestamp = now();
  const folderUri = visibleFiles[0]?.folderUri ?? "";
  const folderName = visibleFiles[0]?.folderName ?? "workspace";
  const semanticChangeCount = visibleFiles.reduce((sum, file) => sum + (file.diff?.changes?.length ?? 0), 0);
  const errorCount = visibleFiles.filter((file) => file.status === "error" || (file.diff?.parse_errors?.length ?? 0) > 0).length;
  const fuelHotspotCount = visibleFiles.reduce((sum, file) => {
    const telemetry = file.diff?.metadata?.engine_telemetry as { fuel_hotspots?: unknown } | undefined;
    const hotspots = telemetry?.fuel_hotspots;
    return sum + (Array.isArray(hotspots) ? hotspots.length : 0);
  }, 0);
  return {
    id: `${folderUri}::${timestamp}::${visibleFiles.length}::${semanticChangeCount}::${errorCount}::${fuelHotspotCount}`,
    timestamp,
    folderName,
    folderUri,
    fileCount: visibleFiles.length,
    semanticChangeCount,
    errorCount,
    fuelHotspotCount,
  };
}

export function appendReviewTimelineSnapshot(
  snapshots: ReviewTimelineSnapshot[],
  snapshot: ReviewTimelineSnapshot | undefined,
  limit = 20,
): ReviewTimelineSnapshot[] {
  if (!snapshot) {
    return snapshots.slice(-limit);
  }
  const withoutDuplicate = snapshots.filter((item) => item.id !== snapshot.id);
  return [...withoutDuplicate, snapshot].slice(-limit);
}

export function compareReviewTimelineSnapshots(
  snapshots: ReviewTimelineSnapshot[],
): ReviewTimelineSnapshotComparison | undefined {
  const ordered = snapshots.slice().sort((a, b) => b.timestamp - a.timestamp);
  const latest = ordered[0];
  const baseline = ordered[1];
  if (!latest || !baseline) {
    return undefined;
  }
  const comparison = {
    baselineId: baseline.id,
    latestId: latest.id,
    fileDelta: latest.fileCount - baseline.fileCount,
    semanticChangeDelta: latest.semanticChangeCount - baseline.semanticChangeCount,
    errorDelta: latest.errorCount - baseline.errorCount,
    fuelHotspotDelta: latest.fuelHotspotCount - baseline.fuelHotspotCount,
  };
  return {
    ...comparison,
    summary: [
      deltaLabel(comparison.fileDelta, "file"),
      deltaLabel(comparison.semanticChangeDelta, "semantic change"),
      deltaLabel(comparison.errorDelta, "error"),
      deltaLabel(comparison.fuelHotspotDelta, "fuel hotspot"),
    ].join(", "),
  };
}

function deltaLabel(delta: number, label: string): string {
  const abs = Math.abs(delta);
  const noun = `${label}${abs === 1 ? "" : "s"}`;
  if (delta > 0) {
    return `+${delta} ${noun}`;
  }
  if (delta < 0) {
    return `${delta} ${noun}`;
  }
  return `no ${noun}`;
}
