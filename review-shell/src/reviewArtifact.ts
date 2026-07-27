export interface ReviewArtifactSummary {
  checked_files?: number;
  semantic_changes?: number;
  style_only_changes?: number;
  guardrail_violations?: number;
  cross_file_changes?: number;
}

export interface ReviewArtifactFile {
  path?: string;
  old_filename?: string;
  new_filename?: string;
  language?: string;
  changes?: unknown[];
  guardrail_violations?: unknown[];
  parse_errors?: string[];
  is_fallback?: boolean;
  metadata?: Record<string, unknown>;
}

export interface ReviewArtifactTimelineSnapshot {
  id?: string;
  timestamp?: number;
  fileCount?: number;
  semanticChangeCount?: number;
  errorCount?: number;
  fuelHotspotCount?: number;
}

export interface ReviewArtifactCrossFileGroup {
  title?: string;
  kind?: string;
  files?: string[];
  changes?: unknown[];
}

export interface ReviewArtifact {
  summary?: ReviewArtifactSummary;
  files?: ReviewArtifactFile[];
  file_diffs?: ReviewArtifactFile[];
  cross_file_groups?: ReviewArtifactCrossFileGroup[];
  timeline_snapshots?: ReviewArtifactTimelineSnapshot[];
}

export interface ReviewShellModel {
  title: string;
  checkedFiles: number;
  semanticChanges: number;
  guardrailViolations: number;
  crossFileChanges: number;
  files: Array<{
    path: string;
    language: string;
    changeCount: number;
    guardrailCount: number;
    fuel: FuelSummary;
    parserCalls: FuelCall[];
    assetDiff?: AssetDiffSummary;
  }>;
  fuel: FuelSummary;
  assetDiffs: AssetDiffSummary[];
  timelineSnapshots: TimelineSnapshotSummary[];
  crossFileGroups: Array<{
    title: string;
    kind: string;
    fileCount: number;
    changeCount: number;
  }>;
}

interface AssetDiffSummary {
  file: string;
  status: string;
  summary: string;
  changedPixelPercentage?: number;
  hotspotCount: number;
}

interface TimelineSnapshotSummary {
  id: string;
  timestamp: number;
  fileCount: number;
  semanticChangeCount: number;
  errorCount: number;
  fuelHotspotCount: number;
}

interface FuelSummary {
  callCount: number;
  hotspotCount: number;
  peakFuel: number;
  totalFuel: number;
  parseErrorCount: number;
  fallback: boolean;
}

interface FuelCall {
  plugin: string;
  func: string;
  language: string;
  provenance: string;
  engine: string;
  version: string;
  fuelConsumed: number;
  fuelPerLine?: number;
  fuelPerKb?: number;
}

export function modelFromArtifact(artifact: ReviewArtifact): ReviewShellModel {
  const files = artifact.files ?? artifact.file_diffs ?? [];
  const crossFileGroups = artifact.cross_file_groups ?? [];
  const summary = artifact.summary ?? {};
  const fileModels = files.map((file) => fileModel(file));
  return {
    title: "IntentDiff Review",
    checkedFiles: Number(summary.checked_files ?? files.length),
    semanticChanges: Number(summary.semantic_changes ?? 0),
    guardrailViolations: Number(summary.guardrail_violations ?? 0),
    crossFileChanges: Number(summary.cross_file_changes ?? 0),
    files: fileModels,
    fuel: aggregateFuel(files.map(fuelSummaryForFile)),
    assetDiffs: fileModels.map((file) => file.assetDiff).filter((asset): asset is AssetDiffSummary => asset !== undefined),
    timelineSnapshots: (artifact.timeline_snapshots ?? []).map(timelineSnapshotSummary),
    crossFileGroups: crossFileGroups.map((group) => ({
      title: group.title ?? "Cross-file group",
      kind: group.kind ?? "related-change",
      fileCount: group.files?.length ?? 0,
      changeCount: group.changes?.length ?? 0,
    })),
  };
}

function fileModel(file: ReviewArtifactFile): ReviewShellModel["files"][number] {
  const path = file.path ?? file.new_filename ?? file.old_filename ?? "unknown";
  const assetDiff = assetDiffSummaryForFile(path, file);
  return {
    path,
    language: file.language ?? "unknown",
    changeCount: file.changes?.length ?? 0,
    guardrailCount: file.guardrail_violations?.length ?? 0,
    fuel: fuelSummaryForFile(file),
    parserCalls: fuelCallsForFile(file),
    ...(assetDiff ? { assetDiff } : {}),
  };
}

function assetDiffSummaryForFile(filePath: string, file: ReviewArtifactFile): AssetDiffSummary | undefined {
  const asset = recordField(file.metadata?.asset_diff);
  if (!asset) {
    return undefined;
  }
  const hotspots = arrayRecords(asset.hotspots);
  return {
    file: filePath,
    status: stringField(asset.status, "unknown"),
    summary: stringField(asset.summary, "Visual asset diff metadata attached"),
    changedPixelPercentage: numberField(asset.changed_pixel_percentage) ?? undefined,
    hotspotCount: hotspots.length,
  };
}

function timelineSnapshotSummary(snapshot: ReviewArtifactTimelineSnapshot): TimelineSnapshotSummary {
  return {
    id: snapshot.id ?? "snapshot",
    timestamp: Number(snapshot.timestamp ?? 0),
    fileCount: Number(snapshot.fileCount ?? 0),
    semanticChangeCount: Number(snapshot.semanticChangeCount ?? 0),
    errorCount: Number(snapshot.errorCount ?? 0),
    fuelHotspotCount: Number(snapshot.fuelHotspotCount ?? 0),
  };
}

export function renderReviewShell(model: ReviewShellModel): string {
  const rows = model.files.map((file) => `
    <article class="file-row">
      <strong>${escapeHtml(file.path)}</strong>
      <span>${escapeHtml(file.language)}</span>
      <span>${file.changeCount} changes</span>
      <span>${file.guardrailCount} guardrails</span>
      <span>${escapeHtml(formatFuel(file.fuel.peakFuel))} fuel</span>
    </article>`).join("");
  const assetRows = model.assetDiffs.map((asset) => `
    <article class="asset-row ${asset.status === "compared" ? "" : "warn"}">
      <strong>${escapeHtml(asset.file)}</strong>
      <span>${escapeHtml(asset.status)}</span>
      <span>${escapeHtml(formatPercent(asset.changedPixelPercentage))}</span>
      <span>${asset.hotspotCount} hotspots</span>
      <small>${escapeHtml(asset.summary)}</small>
    </article>`).join("");
  const timelineRows = model.timelineSnapshots
    .slice()
    .sort((a, b) => b.timestamp - a.timestamp)
    .map((snapshot) => `
    <article class="timeline-row ${snapshot.errorCount || snapshot.fuelHotspotCount ? "warn" : ""}">
      <strong>${escapeHtml(snapshot.id)}</strong>
      <span>${escapeHtml(new Date(snapshot.timestamp).toISOString())}</span>
      <span>${snapshot.fileCount} files</span>
      <span>${snapshot.semanticChangeCount} semantic</span>
      <span>${snapshot.errorCount} errors</span>
      <span>${snapshot.fuelHotspotCount} fuel</span>
    </article>`).join("");
  const fuelRows = model.files
    .filter((file) => file.fuel.callCount > 0 || file.fuel.hotspotCount > 0 || file.fuel.parseErrorCount > 0 || file.fuel.fallback)
    .sort((a, b) => (
      b.fuel.hotspotCount - a.fuel.hotspotCount
      || b.fuel.parseErrorCount - a.fuel.parseErrorCount
      || Number(b.fuel.fallback) - Number(a.fuel.fallback)
      || b.fuel.peakFuel - a.fuel.peakFuel
      || b.fuel.totalFuel - a.fuel.totalFuel
      || a.path.localeCompare(b.path)
    ))
    .map((file) => {
      const signals = [
        file.fuel.hotspotCount ? `${file.fuel.hotspotCount} hotspots` : "",
        file.fuel.parseErrorCount ? `${file.fuel.parseErrorCount} parse errors` : "",
        file.fuel.fallback ? "parser fallback" : "",
      ].filter(Boolean).join(" / ") || "within policy";
      const identity = file.parserCalls.slice(0, 2)
        .map((call) => `${call.provenance} ${call.engine}${call.version ? ` ${call.version}` : ""} ${call.func}`)
        .join(" · ");
      return `
    <article class="fuel-row ${file.fuel.hotspotCount || file.fuel.parseErrorCount || file.fuel.fallback ? "hot" : ""}">
      <strong>${escapeHtml(file.path)}</strong>
      <span>${escapeHtml(file.language)}</span>
      <span>${escapeHtml(formatFuel(file.fuel.peakFuel))} peak</span>
      <span>${escapeHtml(formatFuel(file.fuel.totalFuel))} total</span>
      <span>${escapeHtml(signals)}</span>
      <small>${escapeHtml(identity || "parser identity unavailable")}</small>
      <i style="--bar-width:${fuelBarWidth(file.fuel.peakFuel, model.fuel.peakFuel)}%"></i>
    </article>`;
    }).join("");
  const crossFileRows = model.crossFileGroups.map((group) => `
    <article class="cross-file-row">
      <strong>${escapeHtml(group.title)}</strong>
      <span>${escapeHtml(group.kind)}</span>
      <span>${group.fileCount} files</span>
      <span>${group.changeCount} changes</span>
    </article>`).join("");
  return `<!doctype html>
<html lang="en">
<head><meta charset="utf-8"><title>${escapeHtml(model.title)}</title><style>
body{margin:0;padding:18px;background:#07111d;color:#e6edf7;font:13px/1.45 system-ui,sans-serif}.review-shell{display:grid;gap:14px;max-width:1180px;margin:auto}.metrics{display:grid;grid-template-columns:repeat(auto-fit,minmax(120px,1fr));gap:8px}.metrics span,.file-row,.cross-file-row,.fuel-row,.asset-row,.timeline-row{border:1px solid #26364d;border-radius:8px;background:#101b2d;padding:10px}.files,.cross-file-groups,.fuel-diagnostics,.asset-diffs,.timeline-history{display:grid;gap:8px}.file-row,.cross-file-row,.fuel-row,.asset-row,.timeline-row{display:grid;grid-template-columns:minmax(180px,1fr) repeat(4,minmax(86px,auto));gap:10px;align-items:center}.timeline-row{grid-template-columns:minmax(160px,1fr) minmax(160px,auto) repeat(4,minmax(70px,auto))}.fuel-row{grid-template-columns:minmax(180px,1fr) repeat(4,minmax(86px,auto));position:relative;overflow:hidden}.fuel-row.hot,.asset-row.warn,.timeline-row.warn{border-color:#ff6b6b}.fuel-row i{grid-column:1/-1;height:6px;width:var(--bar-width);border-radius:999px;background:linear-gradient(90deg,#7ee787,#4fd6ff)}h1,h2{margin:0}strong{color:#eef7ff}span,small{color:#9fb0c7}
</style></head>
<body>
  <main class="review-shell">
    <h1>${escapeHtml(model.title)}</h1>
    <section class="metrics">
      <span data-metric="files">${model.checkedFiles}</span>
      <span data-metric="semantic">${model.semanticChanges}</span>
      <span data-metric="guardrails">${model.guardrailViolations}</span>
      <span data-metric="cross-file">${model.crossFileChanges}</span>
      <span data-metric="fuel-peak">${escapeHtml(formatFuel(model.fuel.peakFuel))}</span>
      <span data-metric="fuel-hotspots">${model.fuel.hotspotCount}</span>
    </section>
    <section class="fuel-diagnostics"><h2>Fuel diagnostics</h2>${fuelRows || "<p>No parser fuel telemetry was attached to this artifact.</p>"}</section>
    <section class="asset-diffs"><h2>Asset diffs</h2>${assetRows || "<p>No visual asset diff metadata was attached to this artifact.</p>"}</section>
    <section class="timeline-history"><h2>Timeline history</h2>${timelineRows || "<p>No review timeline snapshots were attached to this artifact.</p>"}</section>
    <section class="files">${rows}</section>
    <section class="cross-file-groups">${crossFileRows}</section>
  </main>
</body>
  </html>`;
}

function fuelSummaryForFile(file: ReviewArtifactFile): FuelSummary {
  const telemetry = recordField(file.metadata?.engine_telemetry);
  const calls = arrayRecords(telemetry?.calls);
  const hotspots = arrayRecords(telemetry?.fuel_hotspots);
  return {
    callCount: calls.length,
    hotspotCount: hotspots.length,
    peakFuel: calls.reduce((peak, call) => Math.max(peak, numberField(call.fuel_consumed) ?? 0), 0),
    totalFuel: calls.reduce((total, call) => total + (numberField(call.total_fuel_consumed) ?? numberField(call.fuel_consumed) ?? 0), 0),
    parseErrorCount: file.parse_errors?.length ?? 0,
    fallback: file.is_fallback === true,
  };
}

function fuelCallsForFile(file: ReviewArtifactFile): FuelCall[] {
  const telemetry = recordField(file.metadata?.engine_telemetry);
  return arrayRecords(telemetry?.calls).map((call) => {
    const fuelConsumed = numberField(call.fuel_consumed) ?? 0;
    const inputBytes = numberField(call.input_bytes);
    const inputLines = numberField(call.input_lines);
    return {
      plugin: stringField(call.plugin, "plugin"),
      func: stringField(call.function, "call"),
      language: stringField(call.language, file.language ?? "unknown"),
      provenance: stringField(call.provenance, "unknown"),
      engine: stringField(call.engine, "unknown"),
      version: stringField(call.parser_version ?? call.plugin_version ?? call.version, ""),
      fuelConsumed,
      fuelPerKb: fuelConsumed / Math.max((inputBytes ?? 0) / 1024, 1),
      fuelPerLine: fuelConsumed / Math.max(inputLines ?? 0, 1),
    };
  });
}

function aggregateFuel(items: FuelSummary[]): FuelSummary {
  return items.reduce<FuelSummary>((total, item) => ({
    callCount: total.callCount + item.callCount,
    hotspotCount: total.hotspotCount + item.hotspotCount,
    peakFuel: Math.max(total.peakFuel, item.peakFuel),
    totalFuel: total.totalFuel + item.totalFuel,
    parseErrorCount: total.parseErrorCount + item.parseErrorCount,
    fallback: total.fallback || item.fallback,
  }), {
    callCount: 0,
    hotspotCount: 0,
    peakFuel: 0,
    totalFuel: 0,
    parseErrorCount: 0,
    fallback: false,
  });
}

function recordField(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;
}

function arrayRecords(value: unknown): Record<string, unknown>[] {
  return Array.isArray(value)
    ? value.filter((item): item is Record<string, unknown> => recordField(item) !== undefined)
    : [];
}

function numberField(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function stringField(value: unknown, fallback: string): string {
  return typeof value === "string" && value.length > 0 ? value : fallback;
}

function formatFuel(value: number): string {
  if (value >= 1_000_000) {
    return `${(value / 1_000_000).toFixed(value >= 10_000_000 ? 1 : 2)}M`;
  }
  if (value >= 1_000) {
    return `${(value / 1_000).toFixed(value >= 10_000 ? 1 : 2)}K`;
  }
  return String(Math.round(value));
}

function formatPercent(value: number | undefined): string {
  return value === undefined ? "n/a" : `${value.toFixed(2)}%`;
}

function fuelBarWidth(value: number, peak: number): string {
  return Math.max(4, Math.min(100, peak > 0 ? value / peak * 100 : 4)).toFixed(1);
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}
