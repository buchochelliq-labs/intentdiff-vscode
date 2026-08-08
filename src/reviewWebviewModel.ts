import {
  reviewEntriesForFile,
  groupReviewFiles,
  reviewGroupCounts,
  schemaCompactDescription,
  sortReviewFiles,
  summarizeReviewWithCrossFile,
  tooltipForReviewEntry,
  tooltipForReviewFile,
  type ReviewCrossFileEntry,
  type ReviewEntry,
  type ReviewFile,
  type ReviewFileGroupingMode,
  type ReviewSummary,
} from "./reviewModel";
import { compareReviewTimelineSnapshots, type ReviewTimelineSnapshot, type ReviewTimelineSnapshotComparison } from "./reviewTimelineModel";
import type { NodePosition, SemanticChange, SemanticDiff, SemanticNode } from "./types";
import { script } from "./reviewWebviewScript";
import { styles } from "./reviewWebviewStyles";
import {
  assetArtifact,
  assetDiffFromMetadata,
  assetHistogramBars,
  assetHotspot,
  assetModeViewer,
  formatMetric,
  formatPercent,
  isImageLikePath,
} from "./reviewAssetViewer";
import {
  DEFAULT_DIFF_CONTEXT_LINES,
  buildDiffRows,
  diffRows,
  diffStats,
  hunkTextPayload,
  type DiffStats,
} from "./reviewDiffRows";
import {
  actionButton,
  commandAttributes,
  escapeHtml,
  iconSvg,
  isRecord,
  type IconName,
} from "./reviewWebviewHtml";
export { escapeHtml } from "./reviewWebviewHtml";
export { DEFAULT_DIFF_CONTEXT_LINES } from "./reviewDiffRows";
import {
  buildSemanticOnlyDocuments,
  type SemanticGap,
  type SemanticOnlyOptions,
  type SemanticOnlyProjection,
  type SemanticProjectionAnchors,
} from "./semanticOnlyDiff";
import { buildReleaseNotes, releaseNotesSummary } from "./releaseNotes";
import { explainChange, explainGroup, type IntentExplanation } from "./intentExplain";
import { contentClassForDiff } from "./contentClass";

export type ReviewWebviewCommand =
  | "openCustomDiff"
  | "openNativeDiff"
  | "openSemanticOnlyDiff"
  | "stageFile"
  | "revertFile"
  | "stageHunk"
  | "revertHunk"
  | "applyHunk"
  | "editHunk"
  | "openTimelineSnapshot"
  | "cycleGrouping"
  | "copyReleaseNotes"
  | "exportReleaseNotes"
  | "refresh"
  | "reveal";

export interface ReviewWebviewPayload {
  folderUri: string;
  relativePath?: string;
  position?: NodePosition | null;
  positionSide?: "base" | "modified";
  change?: SemanticChange;
  actionKind?: "stageHunk" | "revertHunk" | "applyHunk";
  hunk?: ReviewWebviewHunkPayload;
  snapshotId?: string;
}

export interface ReviewWebviewHunkPayload {
  oldLines: string[];
  newLines: string[];
  oldStartLine?: number;
  oldEndLine?: number;
  newStartLine?: number;
  newEndLine?: number;
}
export interface ReviewWebviewMessage {
  command: ReviewWebviewCommand;
  payload?: ReviewWebviewPayload;
}

export type ReviewPanelView =
  | "semantic"
  | "intent"
  | "evidence"
  | "diagnostics"
  | "release-notes";

const REVIEW_PANEL_VIEWS = new Set<ReviewPanelView>([
  "semantic",
  "intent",
  "evidence",
  "diagnostics",
  "release-notes",
]);

export function normalizeReviewView(value: unknown, fallback: ReviewPanelView = "semantic"): ReviewPanelView {
  return typeof value === "string" && REVIEW_PANEL_VIEWS.has(value as ReviewPanelView)
    ? value as ReviewPanelView
    : fallback;
}

export interface ReviewDashboardModel {
  summary: ReviewSummary;
  files: ReviewDashboardFile[];
  fileGroups: ReviewDashboardFileGroup[];
  crossFileEntries: ReviewDashboardCrossFile[];
  languages: Array<{ language: string; count: number }>;
  groupingMode: ReviewFileGroupingMode;
  effectiveGroupingMode: Exclude<ReviewFileGroupingMode, "auto">;
  fuelHistory?: ReviewFuelHistory;
  fuelPolicy?: ReviewFuelPolicy;
  timelineSnapshots?: ReviewTimelineSnapshot[];
  timelineComparison?: ReviewTimelineSnapshotComparison;
  primaryPayload?: ReviewWebviewPayload;
}

export interface ReviewDashboardFile {
  id: string;
  folderName: string;
  folderUri: string;
  relativePath: string;
  language?: string;
  status: ReviewFile["status"];
  description: string;
  tooltip: string;
  schema?: string;
  groupCount: number;
  suppressedNoiseCount: number;
  rawChangeCount: number;
  guardrailCount: number;
  fuelDiagnostics: ReviewFuelDiagnosticsSummary;
  fuelHistory?: number[];
  entries: ReviewWebviewEntry[];
  groupKey?: string;
  groupLabel?: string;
  payload?: ReviewWebviewPayload;
}

export interface ReviewFuelDiagnosticsSummary {
  callCount: number;
  hotspotCount: number;
  peakFuel: number;
  totalFuel: number;
  parseErrorCount: number;
  fallback: boolean;
  policyExceeded: boolean;
  policyReasons: string[];
}

export type ReviewFuelHistory = Record<string, number[]>;

export interface ReviewFuelPolicy {
  peakFuelWarning: number;
  fuelPerKbWarning: number;
  fuelPerLineWarning: number;
}

export const DEFAULT_REVIEW_FUEL_POLICY: ReviewFuelPolicy = {
  peakFuelWarning: 20_000_000,
  fuelPerKbWarning: 15_000_000,
  fuelPerLineWarning: 1_500_000,
};

export interface ReviewDashboardFileGroup {
  key: string;
  label: string;
  description: string;
  mode: Exclude<ReviewFileGroupingMode, "auto" | "none">;
  files: ReviewDashboardFile[];
  fileCount: number;
  groupCount: number;
  rawChangeCount: number;
  guardrailCount: number;
  schema?: string;
  language?: string;
}

export interface ReviewDashboardCrossFile {
  label: string;
  description?: string;
  payload?: ReviewWebviewPayload;
}

export interface ReviewWebviewEntry {
  id: string;
  kind: ReviewEntry["kind"];
  label: string;
  description?: string;
  severity?: ReviewEntry["severity"];
  tooltip: string;
  evidenceCount: number;
  targetId?: string;
  payload?: ReviewWebviewPayload;
  /** Rich intent meaning (what/why/risk) derived once from the underlying change/group. */
  explanation?: IntentExplanation;
}

export interface ReviewPanelModel {
  file: ReviewDashboardFile;
  diff?: SemanticDiff;
  entries: ReviewWebviewEntry[];
  oldText: string;
  newText: string;
  diffRows: ReviewDiffRow[];
  ref: string;
  /** Optional AI-drafted release narrative (BYOK/Copilot). Filled asynchronously. */
  releaseNarrative?: string;
  assetDiff?: ReviewAssetDiff;
  /**
   * The changed image itself, on disk. NOT an engine artifact — it is shown only when the
   * engine has no comparison to offer (an added or deleted image), so the reader still sees
   * the file under review. Everything in `assetDiff` comes from the engine.
   */
  workingTreeImage?: string;
  semanticBaseText?: string;
  semanticModifiedText?: string;
  semanticGaps?: SemanticGap[];
  semanticAnchors?: SemanticProjectionAnchors;
  semanticBaseOriginalLineMap?: number[];
  semanticModifiedOriginalLineMap?: number[];
  /**
   * Raw projection from `buildSemanticOnlyDocuments`. Used by the renderer to
   * serialise per-chunk decoration ranges. May be undefined when the panel
   * was built without a diff.
   */
  semanticProjection?: SemanticOnlyProjection;
}

export interface ReviewAssetDiff {
  status?: string;
  summary?: string;
  /** Why there is no comparison, when the engine reported `skipped`/`unavailable`. */
  reason?: string;
  changed_pixel_percentage?: number | null;
  mean_absolute_error?: number | null;
  root_mean_squared_error?: number | null;
  comparison_dimensions?: {
    width?: number;
    height?: number;
  };
  artifacts?: Record<string, string>;
  hotspots?: ReviewAssetHotspot[];
  hotspot_navigation?: {
    count?: number;
    order?: string[];
    selected_id?: string | null;
  };
  histograms?: {
    bins?: number;
    red_delta?: number[];
    green_delta?: number[];
    blue_delta?: number[];
    brightness_delta?: number[];
    alpha_delta?: number[] | null;
  };
}

export interface ReviewAssetHotspot {
  id?: string;
  label?: string;
  bbox?: {
    x?: number;
    y?: number;
    width?: number;
    height?: number;
  };
  centroid?: {
    x?: number;
    y?: number;
  };
  pixel_count?: number;
  changed_pixel_percentage?: number;
  severity?: string;
  summary?: string;
}

export interface ReviewDiffRow {
  id?: string;
  kind: "equal" | "insert" | "delete" | "change" | "collapsed";
  oldLine?: number;
  newLine?: number;
  oldText?: string;
  newText?: string;
  semantic?: boolean;
  intent?: "refactoring";
  scopeTrail?: string[];
  hiddenRows?: ReviewDiffRow[];
  collapseReason?: "blank" | "context";
}

export interface RenderOptions {
  nonce: string;
  cspSource: string;
  resolveResourceUri?: (path: string) => string;
  /** Webview URI of the vendored highlight.js bundle (media/highlight/highlight.min.js). */
  highlightUri?: string;
  /** Webview URI of @vscode/codicons dist/codicon.css (chrome icons are codicons — issue #27). */
  codiconsUri?: string;
}

const EMPTY_SUMMARY: ReviewSummary = {
  fileCount: 0,
  readyCount: 0,
  skippedCount: 0,
  errorCount: 0,
  guardrailCount: 0,
  crossFileChangeCount: 0,
  immutableCount: 0,
  importantCount: 0,
  semanticChangeCount: 0,
  styleOnlyCount: 0,
  cleanCount: 0,
};

export function buildReviewDashboardModel(
  files: ReviewFile[],
  crossFileEntries: ReviewCrossFileEntry[],
  groupingMode: ReviewFileGroupingMode = "auto",
  fuelHistory: ReviewFuelHistory = {},
  fuelPolicy: ReviewFuelPolicy = DEFAULT_REVIEW_FUEL_POLICY,
  timelineSnapshots: ReviewTimelineSnapshot[] = [],
): ReviewDashboardModel {
  const summary = summarizeReviewWithCrossFile(files, crossFileEntries.map((entry) => entry.change));
  const rawGroups = groupReviewFiles(files, groupingMode);
  const sortedFiles = rawGroups.length > 0
    ? rawGroups.flatMap((group) => group.files)
    : sortReviewFiles(files);
  const dashboardFiles = sortedFiles.map((file, index) => dashboardFile(file, index, fuelHistory[reviewFileKey(file)], fuelPolicy));
  const dashboardByKey = new Map(dashboardFiles.map((file) => [dashboardFileKey(file), file]));
  const fileGroups = rawGroups.map((group) => {
    const groupFiles = group.files
      .map((file) => dashboardByKey.get(reviewFileKey(file)))
      .filter((file): file is ReviewDashboardFile => file !== undefined);
    const groupCount = groupFiles.reduce((total, file) => total + file.groupCount, 0);
    const rawChangeCount = groupFiles.reduce((total, file) => total + file.rawChangeCount, 0);
    const guardrailCount = groupFiles.reduce((total, file) => total + file.guardrailCount, 0);
    for (const file of groupFiles) {
      file.groupKey = group.key;
      file.groupLabel = group.label;
    }
    return {
      key: group.key,
      label: group.label,
      description: group.description,
      mode: group.mode,
      files: groupFiles,
      fileCount: groupFiles.length,
      groupCount,
      rawChangeCount,
      guardrailCount,
      schema: group.schema,
      language: group.language,
    };
  });
  return {
    summary,
    files: dashboardFiles,
    fileGroups,
    crossFileEntries: crossFileEntries.map((entry) => ({
      label: entry.label,
      description: entry.description,
      payload: entry.relativePath
        ? {
          folderUri: entry.folderUri,
          relativePath: entry.relativePath,
          position: entry.change.new_position,
          positionSide: "modified",
        }
        : undefined,
    })),
    languages: languageCounts(files),
    groupingMode,
    effectiveGroupingMode: rawGroups.length > 0 ? rawGroups[0].mode : "none",
    fuelHistory,
    fuelPolicy,
    timelineSnapshots,
    timelineComparison: compareReviewTimelineSnapshots(timelineSnapshots),
    primaryPayload: dashboardFiles.find((file) => file.payload)?.payload,
  };
}

export function buildEmptyReviewDashboardModel(): ReviewDashboardModel {
  return {
    summary: { ...EMPTY_SUMMARY },
    files: [],
    fileGroups: [],
    crossFileEntries: [],
    languages: [],
    groupingMode: "auto",
    effectiveGroupingMode: "none",
    fuelHistory: {},
    fuelPolicy: DEFAULT_REVIEW_FUEL_POLICY,
    timelineSnapshots: [],
  };
}

const DEFAULT_SEMANTIC_ONLY_OPTIONS: SemanticOnlyOptions = {
  contextLines: 2,
  showAdditions: true,
  showDeletions: true,
  showModifications: true,
  movedCode: true,
  hideComments: false,
};

export function buildReviewPanelModel(
  file: ReviewFile,
  oldText: string,
  newText: string,
  ref: string,
  options: { contextLines?: number } = {},
): ReviewPanelModel {
  const diffRows = buildDiffRows(oldText, newText, file.diff, options.contextLines ?? DEFAULT_DIFF_CONTEXT_LINES);
  const entries = reviewEntriesForFile(file).map((entry, index) => dashboardEntry(file, entry, index, diffRows));
  const semanticPair = file.diff
    ? buildSemanticOnlyDocuments(oldText, newText, file.diff, DEFAULT_SEMANTIC_ONLY_OPTIONS)
    : undefined;
  if (semanticPair) {
    attachSemanticDecorations(semanticPair, file.diff);
  }
  return {
    file: dashboardFile(file),
    diff: file.diff,
    entries,
    oldText,
    newText,
    diffRows,
    ref,
    assetDiff: assetDiffFromMetadata(file.diff?.metadata),
    workingTreeImage: typeof file.diff?.metadata?.working_tree_image === "string"
      ? file.diff.metadata.working_tree_image
      : undefined,
    semanticBaseText: semanticPair?.baseText,
    semanticModifiedText: semanticPair?.modifiedText,
    semanticGaps: semanticPair?.gaps,
    semanticAnchors: semanticPair?.anchors,
    semanticBaseOriginalLineMap: denseProjectedLineMap(
      semanticPair?.projection.baseOriginalLineMap,
      semanticPair?.baseText ?? "",
    ),
    semanticModifiedOriginalLineMap: denseProjectedLineMap(
      semanticPair?.projection.modifiedOriginalLineMap,
      semanticPair?.modifiedText ?? "",
    ),
    semanticProjection: semanticPair?.projection,
  };
}

function attachSemanticDecorations(
  semanticPair: NonNullable<ReturnType<typeof buildSemanticOnlyDocuments>>,
  diff: SemanticDiff | undefined,
): void {
  const gaps = semanticPair.gaps;
  if (gaps.length === 0) { return; }
  // Reset any prior decoration state. Tests rely on `trailingKind` reflecting
  // the latest build.
  for (const gap of gaps) {
    delete gap.trailingKind;
  }
  const changes = diff?.changes ?? [];
  if (changes.length === 0) { return; }

  const projected = semanticPair.projection.changes;
  if (projected.length === 0) { return; }

  // Build a map: 1-based projected line on the modified side -> gap meta.
  // The gap that sits immediately AFTER a chunk has its `modified.projectedLine`
  // equal to `(chunk's last 1-based projected line) + 1`.
  //
  // We can reverse the lookup: for each gap, find the chunk that ends at
  // `gap.modified.projectedLine - 1` (1-based). Iterate gaps in projected
  // order and pair each with the chunk that precedes it.
  const gapsByMod = new Map<number, typeof gaps[number]>();
  const gapsByBase = new Map<number, typeof gaps[number]>();
  for (const gap of gaps) {
    if (gap.modified && typeof gap.modified.projectedLine === "number") {
      gapsByMod.set(gap.modified.projectedLine, gap);
    }
    if (gap.base && typeof gap.base.projectedLine === "number") {
      gapsByBase.set(gap.base.projectedLine, gap);
    }
  }

  // Walk chunks in projected order. The projection's `changes` array is
  // indexed by projected position; the i-th chunk in the projection is
  // `projected[i]`. The (i+1)-th gap (1-based) follows it on each side.
  // The i-th gap precedes it.
  for (let i = 0; i < projected.length; i++) {
    const proj = projected[i];
    // When multiple changes are merged into one chunk, use the LAST change's
    // kind. The `changeIndexes` list on the projection is the ground truth
    // for which changes contributed to this projected position.
    const chunkChangeIndexes = (proj as { changeIndexes?: number[] }).changeIndexes
      ?? [proj.changeIndex];
    const lastChangeIdx = chunkChangeIndexes[chunkChangeIndexes.length - 1];
    if (lastChangeIdx === undefined) { continue; }
    const change = changes[lastChangeIdx];
    if (!change) { continue; }
    const kind = decorationKindForChange(change);

    // The gap that sits immediately AFTER the chunk has its 1-based
    // `modified.projectedLine` equal to `(chunk's 1-based window end) + 1`.
    // `modifiedWindowEnd` is pre-computed in `buildSemanticOnlyDocuments`.
    if (proj.modifiedWindowEnd != null) {
      const gap = gapsByMod.get(proj.modifiedWindowEnd + 1);
      if (gap) { gap.trailingKind = kind; }
    }
    if (proj.baseWindowEnd != null) {
      const gap = gapsByBase.get(proj.baseWindowEnd + 1);
      if (gap) { gap.trailingKind = kind; }
    }
  }
}

function decorationKindForChange(change: SemanticChange): "added" | "removed" | "changed" | "refactored" | "moved" {
  if (change.change_type === "ADDITION") { return "added"; }
  if (change.change_type === "DELETION") { return "removed"; }
  if (change.change_type === "MOVE" || change.change_type === "REORDER") { return "moved"; }
  if (change.change_type === "REFACTORING" || change.refactoring_kind) { return "refactored"; }
  return "changed";
}

export function decorationCountsForDiff(
  diff: SemanticDiff | undefined,
): Record<"added" | "removed" | "changed" | "refactored" | "moved", number> {
  const counts = { added: 0, removed: 0, changed: 0, refactored: 0, moved: 0 };
  if (!diff?.changes) { return counts; }
  for (const change of diff.changes) {
    counts[decorationKindForChange(change)] += 1;
  }
  return counts;
}

function denseProjectedLineMap(
  originalLineMap: Map<number, number> | undefined,
  projectedText: string,
): number[] | undefined {
  if (!originalLineMap) { return undefined; }
  const projectedLineCount = projectedText.length === 0
    ? 0
    : projectedText.split(/\r?\n/u).length;
  const dense: number[] = new Array(projectedLineCount).fill(-1);
  for (const [projected, original] of originalLineMap) {
    if (projected >= 0 && projected < dense.length && typeof original === "number") {
      dense[projected] = original;
    }
  }
  return dense;
}

export function isReviewWebviewMessage(value: unknown): value is ReviewWebviewMessage {
  if (!isRecord(value)) {
    return false;
  }
  if (!["openCustomDiff", "openNativeDiff", "openSemanticOnlyDiff", "stageFile", "revertFile", "stageHunk", "revertHunk", "applyHunk", "editHunk", "openTimelineSnapshot", "cycleGrouping", "copyReleaseNotes", "exportReleaseNotes", "refresh", "reveal"].includes(String(value.command))) {
    return false;
  }
  if (value.payload === undefined) {
    return true;
  }
  if (!isRecord(value.payload)) {
    return false;
  }
  if (typeof value.payload.folderUri !== "string") {
    return false;
  }
  if (value.payload.relativePath !== undefined && typeof value.payload.relativePath !== "string") {
    return false;
  }
  if (value.payload.snapshotId !== undefined && typeof value.payload.snapshotId !== "string") {
    return false;
  }
  if (
    value.payload.positionSide !== undefined
    && value.payload.positionSide !== "base"
    && value.payload.positionSide !== "modified"
  ) {
    return false;
  }
  return true;
}

export function renderDashboardHtml(model: ReviewDashboardModel, options: RenderOptions): string {
  const body = model.files.length === 0
    ? `<section class="empty"><h2>No review loaded</h2><p>Refresh the review to populate semantic intent, guardrails, schema status, and raw evidence.</p>${actionButton("Refresh", "refresh")}</section>`
    : dashboardCockpit(model);
  return page("IntentumDiff Review", body, options);
}

export function renderPanelHtml(model: ReviewPanelModel, options: RenderOptions): string {
  const file = model.file;
  const payload = file.payload;
  const stats = diffStats(model.diffRows);
  const isAsset = isImageLikePath(file.relativePath) || model.assetDiff !== undefined;
  const body = `
    <section class="diff-app" data-review-view="semantic" data-diff-mode="${isAsset ? "asset" : "text"}" data-language="${escapeHtml(hljsLanguageId(model))}" data-rail="left" data-rail-open="false" data-rail-pinned="false" data-minimap-open="true" data-drawer-open="false" data-unicode-open="false">
      <header class="product-shell" aria-label="IntentumDiff review workspace">
        <div class="product-context" title="${escapeHtml(file.relativePath)}">
          <div class="product-file-line">
            <strong>${escapeHtml(file.relativePath)}</strong>
            <span class="file-mode-badge">${isAsset ? "Perceptual diff" : "Semantic diff"}</span>
          </div>
          <span>${escapeHtml(file.description)}</span>
        </div>
        <nav class="product-tabs" aria-label="Review views">
          ${viewTab("Diff", "semantic", "native", true)}
          ${viewTab("Intent", "intent", "intent")}
          ${viewTab("Release Notes", "release-notes", "release")}
          ${viewTab("Evidence", "evidence", "evidence")}
          ${viewTab("Diagnostics", "diagnostics", "detail")}
        </nav>
      </header>
      <header class="diff-topbar" aria-label="Current file review controls">
        <nav class="top-badges" aria-label="Review filters and counts">
          ${fileTypeAndSchemaBadges(file)}
          ${filterPill(isAsset ? "visual diff" : "text diff", "diff-mode", "mode-pill")}
          ${filterPill(`${file.groupCount} groups`, "groups", "intent-pill")}
          ${filterPill(`${file.rawChangeCount} raw`, "raw", "evidence-pill")}
          ${file.guardrailCount > 0 ? filterPill(`${file.guardrailCount} guardrails`, "guardrails", "guardrail-pill") : ""}
          ${statBadge("insert", stats.insert)}
          ${statBadge("delete", stats.delete)}
          ${statBadge("change", stats.change)}
          ${statBadge("semantic", stats.semantic)}
        </nav>
        <div class="hero-actions" aria-label="Native VS Code diff actions">
          ${payload ? actionButton("Native diff", "openNativeDiff", payload, "native") : ""}
          ${payload ? actionButton("Semantic-only", "openSemanticOnlyDiff", payload, "filter") : ""}
          ${payload ? actionButton("Stage", "stageFile", payload, "accept") : ""}
          ${payload ? actionButton("Revert", "revertFile", payload, "risk") : ""}
        </div>
      </header>
      <main class="review-pages">
        ${renderAdaptiveDiffPage(model, options)}
        ${reviewTabbedPages(model, stats)}
      </main>
    </section>`;
  return page(`IntentumDiff - ${file.relativePath}`, body, options);
}

function renderAdaptiveDiffPage(model: ReviewPanelModel, options: RenderOptions): string {
  const isAsset = isImageLikePath(model.file.relativePath) || model.assetDiff !== undefined;
  return `<section class="review-page semantic-page" data-review-page="semantic" aria-label="Diff view">
    ${isAsset ? renderAssetDiffWorkbench(model, options) : renderTextDiffWorkbench(model)}
  </section>`;
}

// Engine language id → highlight.js language id. Most match 1:1; only aliases
// need mapping. Unknown languages fall through and highlight.js auto-detects.
const HLJS_LANGUAGE_ALIASES: Record<string, string> = {
  tsx: "typescript",
  jsx: "javascript",
  shell: "bash",
  bash: "bash",
  "c++": "cpp",
  "c#": "csharp",
  yml: "yaml",
  md: "markdown",
  mdx: "markdown",
  vue: "xml",
  svelte: "xml",
  html: "xml",
  dockerfile: "dockerfile",
};

function hljsLanguageId(model: ReviewPanelModel): string {
  const language = (model.file.language ?? model.diff?.language ?? "").toLowerCase();
  return HLJS_LANGUAGE_ALIASES[language] ?? language;
}

function renderTextDiffWorkbench(model: ReviewPanelModel): string {
  const payload = model.file.payload;
  const counts = decorationCountsForDiff(model.diff);
  const totalChanges = counts.added + counts.removed + counts.changed + counts.refactored + counts.moved;
  const rows = model.diffRows ?? [];
  const hasContent = rows.some((row) => row.kind !== "equal");
  const body = hasContent
    ? `<div class="diff-column-heads" aria-hidden="true">
          <span></span><span></span><span>Base &middot; ${escapeHtml(model.ref)}</span>
          <span></span><span></span><span>Working tree</span>
        </div>
        <div class="diff-table" role="table" aria-label="Semantic diff rows">
          ${diffRows(rows, payload)}
        </div>`
    : `<div class="diff-empty">No semantic changes to display in this file.</div>`;
  return `<div class="diff-workbench text-diff-workbench">
    <section class="diff-surface text-diff-surface" aria-label="Semantic diff">
      <div class="diff-toolbar text-diff-toolbar">
        <div class="diff-toolbar-heading">
          <strong>${escapeHtml(model.ref)}</strong>
          <span> &rarr; working tree</span>
          <span class="diff-toolbar-tag">${totalChanges} semantic change${totalChanges === 1 ? "" : "s"}</span>
        </div>
        <div class="diff-nav diff-cta-actions" aria-label="Diff actions">
          <button class="icon-action" type="button" data-panel-action="collapseAll" title="Collapse unchanged / non-semantic regions">Collapse all</button>
          <button class="icon-action" type="button" data-panel-action="expandAll" title="Expand all regions to full code">Expand all</button>
          ${payload ? actionButton("Open native diff", "openNativeDiff", payload, "native") : ""}
          ${payload ? actionButton("Semantic-only", "openSemanticOnlyDiff", payload, "filter") : ""}
        </div>
      </div>
      ${body}
    </section>
  </div>`;
}

function renderAssetDiffWorkbench(model: ReviewPanelModel, options: RenderOptions): string {
  const assetDiff = model.assetDiff;
  const hasAssetDiff = assetDiff !== undefined && assetDiff.status === "compared";
  // The engine answered, but with a reason rather than a comparison: an added or deleted image
  // has no counterpart, dimensions can differ under a strict policy, and a request can fail.
  const hasEngineVerdict = assetDiff !== undefined && assetDiff.status !== "compared";
  const artifacts = assetDiff?.artifacts ?? {};
  const hotspots = assetDiff?.hotspots ?? [];
  const histograms = assetDiff?.histograms;
  return `<div class="diff-workbench asset-diff-workbench">
    <section class="diff-surface asset-diff-surface" aria-label="Perceptual asset diff">
      <div class="diff-toolbar asset-diff-toolbar">
        <div>
          <strong>${escapeHtml(model.ref)}</strong>
          <span> -> working tree</span>
        </div>
        <div class="diff-nav">
          <button class="icon-action" type="button" data-panel-action="previousChange" title="Previous changed region">↑</button>
          <button class="icon-action" type="button" data-panel-action="nextChange" title="Next changed region">↓</button>
        </div>
      </div>
      ${hasAssetDiff ? `
        <div class="asset-diff-summary">
          <div>
            <p class="eyebrow">Perceptual asset diff</p>
            <h2>${escapeHtml(assetDiff?.summary ?? "Image comparison complete")}</h2>
          </div>
          <div class="asset-metric-strip" aria-label="Image diff metrics">
            ${metricTile("Pixels changed", formatPercent(assetDiff?.changed_pixel_percentage))}
            ${metricTile("MAE", formatMetric(assetDiff?.mean_absolute_error))}
            ${metricTile("RMSE", formatMetric(assetDiff?.root_mean_squared_error))}
            ${metricTile("Hotspots", hotspots.length)}
          </div>
        </div>
        <div class="asset-review-grid" aria-label="Interactive image comparison">
          <section class="asset-primary-visual">
            ${assetModeViewer(artifacts, hotspots, assetDiff?.comparison_dimensions, options)}
          </section>
          <aside class="asset-review-panel">
            <div class="asset-hotspot-head">
              <h3>Changed-region hotspots</h3>
              ${hotspots.length > 1 ? `<div class="asset-hotspot-nav" role="group" aria-label="Cycle hotspots">
                <button type="button" class="asset-hotspot-step" data-asset-hotspot-step="prev" title="Previous hotspot (←)">‹</button>
                <button type="button" class="asset-hotspot-step" data-asset-hotspot-step="next" title="Next hotspot (→)">›</button>
              </div>` : ""}
            </div>
            ${hotspots.length > 0 ? `<ol class="asset-hotspot-list">${hotspots.map((hotspot, index) => assetHotspot(hotspot, index)).join("")}</ol>` : "<p>No hotspot exceeded the configured region threshold.</p>"}
          </aside>
        </div>
        ${histograms ? `
        <details class="asset-histogram-card" open>
          <summary>Channel histogram</summary>
          ${assetHistogramBars(histograms)}
        </details>` : ""}
        <details class="asset-artifact-details">
          <summary>Supporting perceptual artifacts</summary>
          <div class="asset-comparison-grid asset-artifact-strip" aria-label="Supporting perceptual artifacts">
            ${assetArtifact("Heatmap", artifacts.heatmap, options)}
            ${assetArtifact("Pixel difference", artifacts.diff, options)}
            ${assetArtifact("Mask", artifacts.mask, options)}
            ${assetArtifact("Overlay", artifacts.overlay, options)}
          </div>
        </details>
      ` : hasEngineVerdict ? `
        <div class="asset-diff-summary asset-preview-summary">
          <div>
            <p class="eyebrow">Image asset review</p>
            <h2>${escapeHtml(assetDiff?.summary ?? assetDiff?.reason ?? "No perceptual comparison for this image")}</h2>
          </div>
          <div class="asset-metric-strip" aria-label="Image asset status">
            ${metricTile("Status", assetDiff?.status ?? "unavailable")}
            ${metricTile("File", model.file.relativePath.split("/").pop() ?? model.file.relativePath)}
          </div>
        </div>
        <div class="asset-review-grid asset-preview-grid" aria-label="Changed image">
          <section class="asset-primary-visual">
            ${assetArtifact("Working tree image", model.workingTreeImage, options)}
          </section>
          <aside class="asset-review-panel">
            <h3>${escapeHtml(assetStatusHeading(assetDiff?.status))}</h3>
            <p>${escapeHtml(assetDiff?.reason ?? assetDiff?.summary ?? "The engine did not return a perceptual comparison for this image.")}</p>
            <p class="boundary-note">Overlay, heatmap, mask, histogram and hotspot evidence needs both a before and an after image.</p>
          </aside>
        </div>
      ` : `
        <div class="asset-unavailable-state">
          <div class="insight-mark">${iconSvg("image")}</div>
          <div>
            <p class="eyebrow">Perceptual asset diff</p>
            <h2>${isImageLikePath(model.file.relativePath) ? "Comparing this image..." : "No visual asset selected"}</h2>
            <p>${isImageLikePath(model.file.relativePath) ? "The engine is decoding both versions and rendering the overlay, heatmap, mask, hotspot and histogram evidence. This view updates when it answers." : "Open a changed PNG, JPG, JPEG, or WEBP asset to review perceptual diff output here."}</p>
            <p class="boundary-note">This view renders Rust JSON and generated artifacts only. No image-processing logic runs in the VS Code webview.</p>
          </div>
        </div>
      `}
    </section>
  </div>`;
}

/** Name the engine's non-comparison verdict for what it is, rather than implying more is coming. */
function assetStatusHeading(status: string | undefined): string {
  if (status === "skipped") {
    return "Nothing to compare against";
  }
  if (status === "dimension_mismatch") {
    return "Dimensions changed";
  }
  return "Perceptual comparison unavailable";
}

function dashboardFile(
  file: ReviewFile,
  index = 0,
  fuelHistory?: number[],
  fuelPolicy: ReviewFuelPolicy = DEFAULT_REVIEW_FUEL_POLICY,
): ReviewDashboardFile {
  const groupCounts = reviewGroupCounts(file.diff);
  const entries = reviewEntriesForFile(file).map((entry, index) => dashboardEntry(file, entry, index));
  return {
    id: dashboardFileId(index),
    folderName: file.folderName,
    folderUri: file.folderUri,
    relativePath: file.relativePath,
    language: file.diff?.language,
    status: file.status,
    description: fileDescription(file),
    tooltip: tooltipForReviewFile(file),
    schema: schemaCompactDescription(file.diff),
    groupCount: groupCounts.review,
    suppressedNoiseCount: groupCounts.suppressedNoise,
    rawChangeCount: file.diff?.changes?.length ?? 0,
    guardrailCount: file.diff?.guardrail_violations?.length ?? 0,
    fuelDiagnostics: fuelDiagnosticsSummary(file.diff, fuelPolicy),
    fuelHistory,
    entries,
    payload: file.status === "ready" && file.relativePath !== ".intentumdiff-review"
      ? { folderUri: file.folderUri, relativePath: file.relativePath }
      : undefined,
  };
}

function dashboardFileKey(file: ReviewDashboardFile): string {
  return `${file.folderUri}::${file.relativePath}`;
}

function reviewFileKey(file: ReviewFile): string {
  return `${file.folderUri}::${file.relativePath}`;
}

/**
 * Rich intent meaning for an entry, reusing the same pure explainer the CodeLens and
 * release notes use. Group entries explain the whole group; per-change entries explain
 * the change. Entries with no change/group (guardrail/schema/status) get none.
 */
function entryExplanation(entry: ReviewEntry, diff: SemanticDiff | undefined): IntentExplanation | undefined {
  const contentClass = contentClassForDiff(diff);
  if (entry.group) {
    return explainGroup(entry.group, diff?.changes ?? [], contentClass);
  }
  if (entry.change) {
    return explainChange(entry.change, undefined, contentClass);
  }
  return undefined;
}

function dashboardEntry(
  file: ReviewFile,
  entry: ReviewEntry,
  index: number,
  rows: ReviewDiffRow[] = [],
): ReviewWebviewEntry {
  const hunk = entryHunkPayload(entry, rows);
  return {
    id: `entry-${index}`,
    kind: entry.kind,
    label: entry.label,
    description: entry.description,
    severity: entry.severity,
    tooltip: tooltipForReviewEntry(entry),
    evidenceCount: entry.evidence?.length ?? 0,
    targetId: targetRowIdForEntry(entry, rows),
    explanation: entryExplanation(entry, file.diff),
    payload: file.status === "ready" && file.relativePath !== ".intentumdiff-review"
      ? {
        folderUri: file.folderUri,
        relativePath: file.relativePath,
        position: entry.position,
        positionSide: entry.positionSide,
        change: entry.change,
        hunk,
      }
      : undefined,
  };
}

function entryHunkPayload(entry: ReviewEntry, rows: ReviewDiffRow[]): ReviewWebviewHunkPayload | undefined {
  if (!entry.change || rows.length === 0) {
    return undefined;
  }
  const targetIndex = entryTargetRowIndex(entry, rows);
  if (targetIndex < 0) {
    return undefined;
  }
  let start = targetIndex;
  while (start > 0) {
    const previous = rows[start - 1];
    if (previous.kind === "equal" && previous.semantic !== true) {
      break;
    }
    start -= 1;
  }
  let end = targetIndex + 1;
  while (end < rows.length) {
    const next = rows[end];
    if (next.kind === "equal" && next.semantic !== true) {
      break;
    }
    end += 1;
  }
  const hunk = hunkTextPayload(rows.slice(start, end));
  return hunk.oldLines.length > 0 || hunk.newLines.length > 0 ? hunk : undefined;
}

function entryTargetRowIndex(entry: ReviewEntry, rows: ReviewDiffRow[]): number {
  const position = entry.position ?? entry.change?.new_node?.position ?? entry.change?.old_node?.position;
  const line = position?.start_line;
  if (line === undefined) {
    return rows.findIndex((row) => row.kind !== "equal" || row.semantic);
  }
  const side = entry.positionSide ?? (entry.change?.new_node?.position ? "modified" : "base");
  const targetLine = line + 1;
  const exact = rows.findIndex((row) => (side === "base" ? row.oldLine : row.newLine) === targetLine);
  if (exact >= 0) {
    return exact;
  }
  let bestIndex = -1;
  let bestDistance = Number.POSITIVE_INFINITY;
  rows.forEach((row, index) => {
    const rowLine = side === "base" ? row.oldLine : row.newLine;
    if (rowLine === undefined) {
      return;
    }
    const distance = Math.abs(rowLine - targetLine);
    if (distance < bestDistance) {
      bestDistance = distance;
      bestIndex = index;
    }
  });
  return bestIndex;
}

function targetRowIdForEntry(entry: ReviewEntry, rows: ReviewDiffRow[]): string | undefined {
  const line = entry.position?.start_line;
  if (line === undefined || rows.length === 0) {
    return rows.find((row) => row.kind !== "equal" || row.semantic)?.id;
  }
  const side = entry.positionSide ?? "modified";
  const exact = rows.find((row) => (side === "base" ? row.oldLine : row.newLine) === line + 1);
  if (exact) {
    return exact.id;
  }
  return rows
    .filter((row) => (side === "base" ? row.oldLine : row.newLine) !== undefined)
    .sort((left, right) => Math.abs(((side === "base" ? left.oldLine : left.newLine) ?? 0) - (line + 1))
      - Math.abs(((side === "base" ? right.oldLine : right.newLine) ?? 0) - (line + 1)))[0]?.id;
}

function fileDescription(file: ReviewFile): string {
  if (file.status === "pending") {
    return file.pendingMessage ?? "Queued";
  }
  if (file.status === "skipped") {
    return file.skippedReason ?? "Skipped";
  }
  if (file.status === "error") {
    return file.error ?? "Diff failed";
  }
  const parts = [
    file.diff?.language,
    file.diff?.parse_errors?.length ? `${file.diff.parse_errors.length} parse error` : undefined,
    file.diff?.is_fallback ? "parser fallback" : undefined,
    file.diff?.guardrail_violations?.length ? `${file.diff.guardrail_violations.length} guardrail` : undefined,
    file.diff?.change_groups?.length ? `${file.diff.change_groups.length} groups` : undefined,
    file.diff?.changes?.length ? `${file.diff.changes.length} raw changes` : undefined,
  ].filter(Boolean);
  return parts.join(" - ") || "No semantic changes";
}

function languageCounts(files: ReviewFile[]): Array<{ language: string; count: number }> {
  const counts = new Map<string, number>();
  for (const file of files) {
    const language = file.diff?.language;
    if (!language) {
      continue;
    }
    counts.set(language, (counts.get(language) ?? 0) + 1);
  }
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(([language, count]) => ({ language, count }));
}

function dashboardCockpit(model: ReviewDashboardModel): string {
  const selectedFileId = model.files[0]?.id ?? dashboardFileId(0);
  const fileList = model.fileGroups.length > 0
    ? model.fileGroups.map((group) => dashboardFileGroup(group, selectedFileId)).join("")
    : model.files.map((file) => dashboardFileRow(file, selectedFileId)).join("");
  return `<section class="dashboard-app" data-left-pinned="false" data-left-open="false" data-right-pinned="false" data-right-open="false" data-selected-file="${selectedFileId}">
    ${dashboardTopbar(model)}
    <main class="dashboard-workspace">
      ${dashboardDock("left", "Filters", "filter", dashboardFilters(model))}
      <section class="dashboard-board" aria-label="Changed files">
        ${dashboardFuelPanel(model)}
        ${dashboardTimelinePanel(model)}
        <div class="dashboard-board-heading">
          <div>
            <h2>Changed files</h2>
            <p>Top signals are shown first. Expand a file for full evidence.</p>
          </div>
          <span class="dashboard-board-count">${model.files.length}</span>
        </div>
        <div class="dashboard-file-list">
          ${fileList}
        </div>
      </section>
      ${dashboardDock("right", "Selection", "detail", dashboardDetails(model))}
    </main>
  </section>`;
}

function dashboardTimelinePanel(model: ReviewDashboardModel): string {
  const snapshots = (model.timelineSnapshots ?? []).slice().sort((a, b) => b.timestamp - a.timestamp).slice(0, 6);
  const comparison = model.timelineComparison;
  return `<section class="dashboard-timeline-panel" aria-label="Review timeline history">
    <header>
      <div>
        <h2>Review history</h2>
        <p>Compare recent review snapshots and watch error or fuel trends before release.</p>
      </div>
      ${comparison ? `<span class="timeline-delta" title="${escapeHtml(comparison.summary)}">${escapeHtml(comparison.summary)}</span>` : ""}
    </header>
    ${snapshots.length > 0
      ? `<div class="dashboard-timeline-list">${snapshots.map(dashboardTimelineSnapshot).join("")}</div>`
      : `<article class="quiet-state">${iconSvg("detail")}<strong>No review snapshots yet</strong><span>Refresh review to persist timeline history.</span></article>`}
  </section>`;
}

function dashboardTimelineSnapshot(snapshot: ReviewTimelineSnapshot): string {
  const hot = snapshot.errorCount > 0 || snapshot.fuelHotspotCount > 0 ? "is-hot" : "";
  return `<article class="dashboard-timeline-row ${hot}" data-review-snapshot="${escapeHtml(snapshot.id)}">
    <strong>${escapeHtml(snapshot.folderName)}</strong>
    <span>${escapeHtml(new Date(snapshot.timestamp).toLocaleString())}</span>
    <span>${snapshot.fileCount} files</span>
    <span>${snapshot.semanticChangeCount} semantic</span>
    <span>${snapshot.errorCount} errors</span>
    <span>${snapshot.fuelHotspotCount} fuel</span>
    ${actionButton("Open", "openTimelineSnapshot", { folderUri: snapshot.folderUri, snapshotId: snapshot.id }, "detail")}
  </article>`;
}

function dashboardTopbar(model: ReviewDashboardModel): string {
  const summary = model.summary;
  const groupCount = model.files.reduce((total, file) => total + file.groupCount, 0);
  const fuelSummary = aggregateFuelDiagnostics(model.files);
  const groupingLabel = model.groupingMode === "auto"
    ? `Auto: ${groupingModeLabel(model.effectiveGroupingMode)}`
    : groupingModeLabel(model.groupingMode);
  return `<header class="dashboard-topbar">
    <div class="dashboard-title">
      <p class="eyebrow brand-eyebrow">${iconSvg("brand")}<span>IntentumDiff review</span></p>
      <h1>Semantic review cockpit</h1>
      <p>Compact overview, docked context, and file-first review flow.</p>
    </div>
    <nav class="dashboard-pills" aria-label="Review summary">
      ${dashboardSummaryPill("Files", summary.fileCount, "files")}
      ${dashboardSummaryPill("Groups", groupCount, "groups")}
      ${dashboardSummaryPill("Guardrails", summary.guardrailCount, summary.immutableCount > 0 ? "danger" : "warn")}
      ${dashboardSummaryPill("Raw", summary.semanticChangeCount, "raw")}
      ${dashboardSummaryPill("Fuel peak", formatFuel(fuelSummary.peakFuel), fuelSummary.hotspotCount > 0 ? "danger" : "fuel")}
      ${dashboardSummaryPill("Hotspots", fuelSummary.hotspotCount, fuelSummary.hotspotCount > 0 ? "danger" : "fuel")}
      ${dashboardCommandPill(`Grouping: ${groupingLabel}`, "cycleGrouping", "grouping")}
      ${model.languages.map((item) => dashboardFilterPill(`${item.language} ${item.count}`, `language:${item.language}`, "language")).join("")}
    </nav>
    <div class="dashboard-actions">
      ${actionButton("Refresh", "refresh", undefined, "refresh")}
      ${model.primaryPayload ? actionButton("Custom diff", "openCustomDiff", model.primaryPayload, "native") : ""}
    </div>
  </header>`;
}

function dashboardDock(side: "left" | "right", title: string, icon: IconName, body: string): string {
  return `<aside class="dashboard-dock dashboard-dock-${side}" data-dashboard-dock-side="${side}" aria-label="${escapeHtml(title)} panel">
    <button class="dashboard-dock-tab" type="button" data-dashboard-dock="${side}" title="${escapeHtml(title)} panel">${iconSvg(icon)}<span>${escapeHtml(title)}</span></button>
    <div class="dashboard-dock-panel">
      <header>
        <div>
          <p class="eyebrow">${escapeHtml(title)}</p>
          <h2>${side === "left" ? "Find review work" : "Selected file"}</h2>
        </div>
        <button class="icon-action" type="button" data-dashboard-dock="${side}" title="Pin or unpin ${escapeHtml(title)} panel">${iconSvg("pin")}</button>
      </header>
      ${body}
    </div>
  </aside>`;
}

function dashboardFilters(model: ReviewDashboardModel): string {
  const statusCounts = new Map<ReviewDashboardFile["status"], number>();
  let schemaCount = 0;
  let guardrailCount = 0;
  let fuelCount = 0;
  for (const file of model.files) {
    statusCounts.set(file.status, (statusCounts.get(file.status) ?? 0) + 1);
    if (file.schema) {
      schemaCount += 1;
    }
    if (file.guardrailCount > 0) {
      guardrailCount += 1;
    }
    if (file.fuelDiagnostics.hotspotCount > 0 || file.fuelDiagnostics.parseErrorCount > 0 || file.fuelDiagnostics.fallback) {
      fuelCount += 1;
    }
  }
  return `<div class="dashboard-filter-groups">
    ${model.fileGroups.length > 0 ? `<section>
      <h3>Groups</h3>
      <div class="dashboard-filter-list">
        ${model.fileGroups.map((group) => dashboardFilterPill(`${group.label} ${group.fileCount}`, `group:${group.key}`, "grouping")).join("")}
      </div>
    </section>` : ""}
    <section>
      <h3>Languages</h3>
      <div class="dashboard-filter-list">
        ${model.languages.map((item) => dashboardFilterPill(`${item.language} ${item.count}`, `language:${item.language}`, "language")).join("")}
      </div>
    </section>
    <section>
      <h3>Status</h3>
      <div class="dashboard-filter-list">
        ${[...statusCounts.entries()].map(([status, count]) => dashboardFilterPill(`${status} ${count}`, `status:${status}`, "status")).join("")}
      </div>
    </section>
    <section>
      <h3>Signals</h3>
      <div class="dashboard-filter-list">
        ${guardrailCount ? dashboardFilterPill(`guardrails ${guardrailCount}`, "guardrails", "guardrails") : ""}
        ${fuelCount ? dashboardFilterPill(`fuel ${fuelCount}`, "fuel", "fuel") : ""}
        ${schemaCount ? dashboardFilterPill(`schema ${schemaCount}`, "schema", "schema") : ""}
        ${dashboardFilterPill("all files", "", "all")}
      </div>
    </section>
  </div>`;
}

function dashboardFuelPanel(model: ReviewDashboardModel): string {
  const fuelFiles = model.files
    .filter((file) => hasFuelOrParserSignal(file))
    .sort((a, b) => (
      b.fuelDiagnostics.hotspotCount - a.fuelDiagnostics.hotspotCount
      || b.fuelDiagnostics.parseErrorCount - a.fuelDiagnostics.parseErrorCount
      || Number(b.fuelDiagnostics.fallback) - Number(a.fuelDiagnostics.fallback)
      || b.fuelDiagnostics.peakFuel - a.fuelDiagnostics.peakFuel
      || b.fuelDiagnostics.totalFuel - a.fuelDiagnostics.totalFuel
      || a.relativePath.localeCompare(b.relativePath)
    ))
    .slice(0, 8);
  const summary = aggregateFuelDiagnostics(model.files);
  return `<section class="dashboard-fuel-panel" aria-label="Fuel diagnostics task manager">
    <header>
      <div>
        <h2>Fuel diagnostics</h2>
        <p>Sorted by hotspots, peak fuel, then total fuel across the latest review refresh.</p>
      </div>
      <div class="dashboard-fuel-kpis">
        <span><strong>${escapeHtml(formatFuel(summary.peakFuel))}</strong><small>peak</small></span>
        <span><strong>${escapeHtml(formatFuel(summary.totalFuel))}</strong><small>total</small></span>
        <span><strong>${summary.hotspotCount}</strong><small>hotspots</small></span>
      </div>
    </header>
    ${fuelFiles.length > 0
      ? `<div class="dashboard-fuel-table">${fuelFiles.map(dashboardFuelRow).join("")}</div>`
      : `<article class="quiet-state">${iconSvg("detail")}<strong>No parser fuel telemetry yet</strong><span>Review refreshes with Wasm telemetry will appear here.</span></article>`}
  </section>`;
}

function dashboardFuelRow(file: ReviewDashboardFile): string {
  const summary = file.fuelDiagnostics;
  const history = file.fuelHistory ?? [];
  const sparkline = history.length > 0 ? fuelSparkline(history) : "";
  const tone = summary.policyExceeded || summary.hotspotCount > 0 || summary.parseErrorCount > 0 || summary.fallback ? "is-hot" : "";
  const reasons = [
    ...summary.policyReasons,
    summary.parseErrorCount > 0 ? `${summary.parseErrorCount} parse error${summary.parseErrorCount === 1 ? "" : "s"}` : "",
    summary.fallback ? "parser fallback" : "",
  ].filter(Boolean).join(", ") || "within policy";
  return `<article class="dashboard-fuel-row ${tone}" data-fuel-file="${escapeHtml(file.id)}">
    <strong>${escapeHtml(file.relativePath)}</strong>
    <span>${escapeHtml(file.language ?? "unknown")}</span>
    <span>${escapeHtml(formatFuel(summary.peakFuel))} peak</span>
    <span>${escapeHtml(formatFuel(summary.totalFuel))} total</span>
    <span title="${escapeHtml(reasons)}">${summary.hotspotCount} hotspots</span>
    ${sparkline}
  </article>`;
}

function hasFuelOrParserSignal(file: ReviewDashboardFile): boolean {
  return file.fuelDiagnostics.callCount > 0
    || file.fuelDiagnostics.hotspotCount > 0
    || file.fuelDiagnostics.parseErrorCount > 0
    || file.fuelDiagnostics.fallback
    || file.fuelDiagnostics.policyExceeded
    || (file.fuelHistory?.length ?? 0) > 0;
}

function fuelDiagnosticsSummary(
  diff: SemanticDiff | undefined,
  fuelPolicy: ReviewFuelPolicy = DEFAULT_REVIEW_FUEL_POLICY,
): ReviewFuelDiagnosticsSummary {
  const diagnostics = diagnosticsForDiff(diff, fuelPolicy);
  const policyReasons = uniqueStrings(diagnostics.calls.flatMap((call) => call.policyReasons));
  return {
    callCount: diagnostics.calls.length,
    hotspotCount: diagnostics.hotspots.length,
    peakFuel: diagnostics.calls.reduce((peak, call) => Math.max(peak, call.fuelConsumed ?? 0), 0),
    totalFuel: diagnostics.calls.reduce((total, call) => total + (call.totalFuelConsumed ?? call.fuelConsumed ?? 0), 0),
    parseErrorCount: diagnostics.parseErrors.length,
    fallback: diagnostics.fallback,
    policyExceeded: policyReasons.length > 0 || diagnostics.hotspots.length > 0,
    policyReasons,
  };
}

function aggregateFuelDiagnostics(files: ReviewDashboardFile[]): ReviewFuelDiagnosticsSummary {
  return files.reduce<ReviewFuelDiagnosticsSummary>((total, file) => ({
    callCount: total.callCount + file.fuelDiagnostics.callCount,
    hotspotCount: total.hotspotCount + file.fuelDiagnostics.hotspotCount,
    peakFuel: Math.max(total.peakFuel, file.fuelDiagnostics.peakFuel),
    totalFuel: total.totalFuel + file.fuelDiagnostics.totalFuel,
    parseErrorCount: total.parseErrorCount + file.fuelDiagnostics.parseErrorCount,
    fallback: total.fallback || file.fuelDiagnostics.fallback,
    policyExceeded: total.policyExceeded || file.fuelDiagnostics.policyExceeded,
    policyReasons: uniqueStrings([...total.policyReasons, ...file.fuelDiagnostics.policyReasons]),
  }), {
    callCount: 0,
    hotspotCount: 0,
    peakFuel: 0,
    totalFuel: 0,
    parseErrorCount: 0,
    fallback: false,
    policyExceeded: false,
    policyReasons: [],
  });
}

function fuelSparkline(values: number[]): string {
  const safeValues = values.filter((value) => Number.isFinite(value) && value >= 0).slice(-12);
  if (safeValues.length === 0) {
    return "";
  }
  const peak = Math.max(...safeValues, 1);
  const bars = safeValues.map((value, index) => {
    const height = Math.max(6, Math.min(100, value / peak * 100));
    return `<i style="--bar-height:${height.toFixed(1)}%" title="${escapeHtml(`sample ${index + 1}: ${formatFuel(value)} fuel`)}"></i>`;
  }).join("");
  return `<span class="fuel-sparkline" aria-label="Recent fuel usage">${bars}</span>`;
}

function dashboardDetails(model: ReviewDashboardModel): string {
  return `<div class="dashboard-detail-stack">
    ${model.files.map((file, index) => dashboardFileDetail(file, index === 0)).join("")}
  </div>`;
}

function dashboardFileGroup(group: ReviewDashboardFileGroup, selectedFileId: string): string {
  const tokens = [
    `group:${group.key}`,
    group.language ? `language:${group.language.toLowerCase()}` : "",
    group.schema ? "schema" : "",
    group.guardrailCount > 0 ? "guardrails" : "",
  ].filter(Boolean).join(" ");
  return `<section class="dashboard-file-group" data-dashboard-group="${escapeHtml(group.key)}" data-filter-tokens="${escapeHtml(tokens)}" data-collapsed="false">
    <header class="dashboard-file-group-heading">
      <button class="dashboard-group-toggle" type="button" data-dashboard-toggle-group="${escapeHtml(group.key)}" title="Collapse or expand ${escapeHtml(group.label)}">
        <span class="group-chevron">⌄</span>
        <strong>${escapeHtml(group.label)}</strong>
        <small>${escapeHtml(group.description)}</small>
      </button>
      <div class="dashboard-group-pills">
        <button class="dashboard-filter-pill grouping" type="button" data-dashboard-filter="group:${escapeHtml(group.key)}">${group.fileCount} files</button>
        ${group.groupCount ? `<span class="pill intent-pill">${group.groupCount} groups</span>` : ""}
        ${group.rawChangeCount ? `<span class="pill evidence-pill">${group.rawChangeCount} raw</span>` : ""}
        ${group.guardrailCount ? `<span class="pill guardrail-pill">${group.guardrailCount} guardrail</span>` : ""}
      </div>
    </header>
    <div class="dashboard-file-group-body">
      ${group.files.map((file) => dashboardFileRow(file, selectedFileId)).join("")}
    </div>
  </section>`;
}

function dashboardFileRow(file: ReviewDashboardFile, selectedFileId: string): string {
  const fileId = file.id;
  const topSignals = file.entries.slice(0, 3);
  const extraSignals = file.entries.slice(3);
  const tokens = dashboardFilterTokens(file).join(" ");
  return `<article id="${fileId}" class="dashboard-file-row ${file.guardrailCount > 0 ? "guarded" : ""} ${fileId === selectedFileId ? "is-selected" : ""}" data-dashboard-file="${fileId}" data-filter-tokens="${escapeHtml(tokens)}" data-expanded="false">
    <header>
      <button class="dashboard-file-select" type="button" data-dashboard-file-select="${fileId}" title="Select ${escapeHtml(file.relativePath)}">
        <strong>${escapeHtml(file.relativePath)}</strong>
        <span>${escapeHtml(file.description)}${file.schema ? ` · ${escapeHtml(file.schema)}` : ""}</span>
      </button>
      <div class="dashboard-file-actions">
        ${dashboardFilePills(file)}
        ${file.payload ? actionButton("Custom", "openCustomDiff", file.payload, "native") : ""}
        ${file.payload ? actionButton("Native", "openNativeDiff", file.payload, "filter") : ""}
      </div>
    </header>
    <div class="dashboard-signal-preview">
      ${topSignals.map(dashboardSignal).join("")}
    </div>
    ${extraSignals.length > 0 ? `<button class="dashboard-expand" type="button" data-dashboard-toggle-file="${fileId}">Show ${extraSignals.length} more signals</button>
    <div class="dashboard-file-extra">${extraSignals.map(dashboardSignal).join("")}</div>` : ""}
  </article>`;
}

function dashboardFileDetail(file: ReviewDashboardFile, selected: boolean): string {
  const fileId = file.id;
  const entries = file.entries.slice(0, 8);
  return `<section class="dashboard-file-detail ${selected ? "is-selected" : ""}" data-dashboard-detail="${fileId}">
    <h3>${escapeHtml(file.relativePath)}</h3>
    <p>${escapeHtml(file.description)}${file.schema ? ` · ${escapeHtml(file.schema)}` : ""}</p>
    <div class="dashboard-detail-pills">${dashboardFilePills(file)}</div>
    <div class="dashboard-detail-actions">
      ${file.payload ? actionButton("Custom diff", "openCustomDiff", file.payload, "native") : ""}
      ${file.payload ? actionButton("Native diff", "openNativeDiff", file.payload, "filter") : ""}
    </div>
    <div class="dashboard-detail-signals">
      ${entries.map(dashboardSignal).join("")}
    </div>
    ${file.fuelHistory && file.fuelHistory.length > 0 ? `<div class="dashboard-detail-fuel-history"><strong>Fuel trend</strong>${fuelSparkline(file.fuelHistory)}</div>` : ""}
  </section>`;
}

function dashboardSignal(entry: ReviewWebviewEntry): string {
  const classes = ["dashboard-signal", `entry-${entry.kind}`, entry.severity ? `severity-${entry.severity}` : ""].join(" ");
  return `<button class="${classes}" type="button" ${entry.payload ? commandAttributes("reveal", entry.payload) : ""} title="${escapeHtml(entry.tooltip)}">
    <span class="entry-dot">${entryIcon(entry.kind)}</span>
    <span>
      <strong>${escapeHtml(entry.label)}</strong>
      <small>${escapeHtml(entryKindLabel(entry.kind))}${entry.description ? ` · ${escapeHtml(entry.description)}` : ""}</small>
    </span>
    ${entry.evidenceCount ? `<span class="badge">${entry.evidenceCount}</span>` : ""}
  </button>`;
}

function dashboardFilePills(file: ReviewDashboardFile): string {
  return [
    file.language ? `<span class="pill type-pill">${escapeHtml(file.language)}</span>` : "",
    file.schema ? `<span class="pill schema-pill">${escapeHtml(file.schema)}</span>` : "",
    file.groupCount ? `<span class="pill intent-pill">${file.groupCount} groups</span>` : "",
    file.rawChangeCount ? `<span class="pill evidence-pill">${file.rawChangeCount} raw</span>` : "",
    file.guardrailCount ? `<span class="pill guardrail-pill">${file.guardrailCount} guardrail</span>` : "",
    file.fuelDiagnostics.hotspotCount ? `<span class="pill fuel-pill">${file.fuelDiagnostics.hotspotCount} fuel</span>` : "",
  ].join("");
}

function dashboardSummaryPill(label: string, value: number | string, tone: string): string {
  return `<span class="dashboard-summary-pill ${escapeHtml(tone)}"><small>${escapeHtml(label)}</small><strong>${escapeHtml(value)}</strong></span>`;
}

function dashboardFilterPill(label: string, filter: string, tone: string): string {
  return `<button class="dashboard-filter-pill ${escapeHtml(tone)}" type="button" data-dashboard-filter="${escapeHtml(filter)}">${escapeHtml(label)}</button>`;
}

function dashboardCommandPill(label: string, command: ReviewWebviewCommand, tone: string): string {
  return `<button class="dashboard-filter-pill ${escapeHtml(tone)}" type="button" data-command="${escapeHtml(command)}">${escapeHtml(label)}</button>`;
}

function groupingModeLabel(mode: ReviewFileGroupingMode | Exclude<ReviewFileGroupingMode, "auto">): string {
  if (mode === "none") {
    return "Flat";
  }
  if (mode === "language") {
    return "Language";
  }
  if (mode === "schema") {
    return "Schema";
  }
  if (mode === "languageThenSchema") {
    return "Language + schema";
  }
  return "Auto";
}

function dashboardFileId(index: number): string {
  return `dashboard-file-${index}`;
}

function dashboardFilterTokens(file: ReviewDashboardFile): string[] {
  return [
    file.language ? `language:${file.language}` : "",
    file.groupKey ? `group:${file.groupKey}` : "",
    `status:${file.status}`,
    file.schema ? "schema" : "",
    file.guardrailCount > 0 ? "guardrails" : "",
    file.fuelDiagnostics.hotspotCount > 0 || file.fuelDiagnostics.parseErrorCount > 0 || file.fuelDiagnostics.fallback ? "fuel" : "",
  ].filter(Boolean);
}

function hero(model: ReviewDashboardModel): string {
  const summary = model.summary;
  return `<section class="hero">
    <div>
      <p class="eyebrow">IntentumDiff review</p>
      <h1>Semantic intent, not just changed lines.</h1>
      <p>Groups stay human-facing. Raw changes remain visible as evidence.</p>
    </div>
    <div class="hero-actions">
      ${actionButton("Refresh", "refresh")}
      ${model.primaryPayload ? actionButton("Open custom diff", "openCustomDiff", model.primaryPayload) : ""}
    </div>
    <div class="metric-grid">
      ${metric("Files", summary.fileCount)}
      ${metric("Groups", model.files.reduce((total, file) => total + file.groupCount, 0))}
      ${metric("Guardrails", summary.guardrailCount, summary.immutableCount > 0 ? "danger" : "warn")}
      ${metric("Raw evidence", summary.semanticChangeCount)}
    </div>
  </section>`;
}

function languageStrip(model: ReviewDashboardModel): string {
  if (model.languages.length === 0) {
    return "";
  }
  return `<section class="strip">${model.languages
    .slice(0, 10)
    .map((item) => `<span class="pill">${escapeHtml(item.language)} <strong>${item.count}</strong></span>`)
    .join("")}</section>`;
}

function crossFileSection(model: ReviewDashboardModel): string {
  if (model.crossFileEntries.length === 0) {
    return "";
  }
  return `<section class="section"><h2>Cross-file intent</h2>${model.crossFileEntries
    .map((entry) => `<article class="card cross">
      <div><h3>${escapeHtml(entry.label)}</h3><p>${escapeHtml(entry.description ?? "")}</p></div>
      ${entry.payload ? actionButton("Open", "openNativeDiff", entry.payload) : ""}
    </article>`)
    .join("")}</section>`;
}

function fileCards(files: ReviewDashboardFile[]): string {
  return `<section class="section"><h2>Changed files</h2>${files.map((file) => `
    <article class="file-card ${file.guardrailCount > 0 ? "guarded" : ""}">
      <header>
        <div>
          <h3>${escapeHtml(file.relativePath)}</h3>
          <p>${escapeHtml(file.description)}${file.schema ? ` - ${escapeHtml(file.schema)}` : ""}</p>
        </div>
        <div class="card-actions">
          ${file.payload ? actionButton("Custom", "openCustomDiff", file.payload) : ""}
          ${file.payload ? actionButton("Native", "openNativeDiff", file.payload) : ""}
        </div>
      </header>
      <div class="entry-list">${file.entries.slice(0, 8).map(entryCard).join("")}</div>
    </article>`).join("")}</section>`;
}

function entryCard(entry: ReviewWebviewEntry): string {
  const classes = ["entry", `entry-${entry.kind}`, entry.severity ? `severity-${entry.severity}` : ""].join(" ");
  const target = entry.targetId ? ` data-target="${escapeHtml(entry.targetId)}"` : "";
  // Prefer the rich intent meaning; fall back to the terse label when there is none
  // (guardrail / schema / status rows).
  const what = entry.explanation?.what?.trim() || entry.label;
  const why = entry.explanation?.why?.trim() ?? "";
  const location = entryLocationLabel(entry);
  return `<article class="${classes}" data-entry-kind="${escapeHtml(entry.kind)}"${target} title="${escapeHtml(entry.tooltip)}">
    <button class="entry-reveal" type="button"${target} ${entry.payload ? commandAttributes("reveal", entry.payload) : ""}>
      <span class="entry-dot">${entryIcon(entry.kind)}</span>
      <span class="entry-main">
        <span class="entry-head"><strong>${intentMarkup(what)}</strong>${intentRiskPill(entry.explanation?.risk)}</span>
        ${why ? `<span class="entry-why">${intentMarkup(why)}</span>` : ""}
        <span class="entry-meta">
          <small>${escapeHtml(entryKindLabel(entry.kind))}</small>
          ${location ? `<small class="entry-loc">${escapeHtml(location)}</small>` : ""}
          ${!entry.explanation && entry.description ? `<small>${escapeHtml(entry.description)}</small>` : ""}
        </span>
      </span>
    </button>
    ${entry.evidenceCount ? `<span class="badge">${entry.evidenceCount}</span>` : ""}
    ${entryActionButtons(entry)}
  </article>`;
}

/** `file:line` hint from the change position for evidence rows (base or new side). */
function entryLocationLabel(entry: ReviewWebviewEntry): string {
  const position = entry.payload?.change?.new_node?.position ?? entry.payload?.change?.old_node?.position;
  const relativePath = entry.payload?.relativePath;
  if (!relativePath || !position || typeof position.start_line !== "number") {
    return "";
  }
  const leaf = relativePath.split("/").pop() ?? relativePath;
  return `${leaf}:${position.start_line + 1}`;
}

function entryActionButtons(entry: ReviewWebviewEntry): string {
  if (!entry.payload?.change || !entry.payload.hunk || !isEntityActionEntry(entry)) {
    return "";
  }
  return `<span class="entry-actions" aria-label="Semantic entity actions">
    ${actionButton("Stage", "stageHunk", { ...entry.payload, actionKind: "stageHunk" }, "accept")}
    ${actionButton("Revert", "revertHunk", { ...entry.payload, actionKind: "revertHunk" }, "risk")}
    ${actionButton("Apply", "applyHunk", { ...entry.payload, actionKind: "applyHunk" }, "detail")}
  </span>`;
}

function isEntityActionEntry(entry: ReviewWebviewEntry): boolean {
  return entry.kind === "meaningful"
    || entry.kind === "moved-code"
    || entry.kind === "refactoring"
    || entry.kind === "change"
    || entry.kind === "raw-evidence";
}

function intentSummary(entries: ReviewWebviewEntry[]): string {
  const counts = new Map<ReviewWebviewEntry["kind"], number>();
  for (const entry of entries) {
    counts.set(entry.kind, (counts.get(entry.kind) ?? 0) + 1);
  }
  const visibleKinds: Array<ReviewWebviewEntry["kind"]> = [
    "guardrail",
    "moved-code",
    "refactoring",
    "meaningful",
    "schema-status",
    "ignored-style",
    "noise-suppressed",
    "raw-evidence",
  ];
  const chips = visibleKinds
    .filter((kind) => (counts.get(kind) ?? 0) > 0)
    .map((kind) => `<button class="intent-chip chip-${kind}" type="button" data-filter="${escapeHtml(kind)}">${escapeHtml(entryKindLabel(kind))} <strong>${counts.get(kind)}</strong></button>`)
    .join("");
  return chips ? `<div class="intent-summary">${chips}</div>` : "";
}

// Evidence filter chips reuse the existing `data-filter` client mechanism
// (state.filter → .diff-app[data-filter-active]); the evidence CSS dims
// non-matching entry cards. "All" clears the active filter.
function evidenceFilterChips(entries: ReviewWebviewEntry[]): string {
  const present = new Set(entries.map((entry) => entry.kind));
  const order: Array<{ kind: ReviewWebviewEntry["kind"]; label: string }> = [
    { kind: "moved-code", label: "Moved" },
    { kind: "refactoring", label: "Refactor" },
    { kind: "meaningful", label: "Meaningful" },
    { kind: "cross-file", label: "Cross-file" },
    { kind: "ignored-style", label: "Style" },
    { kind: "noise-suppressed", label: "Noise" },
    { kind: "raw-evidence", label: "Raw" },
  ];
  const chips = order
    .filter((chip) => present.has(chip.kind))
    .map((chip) => `<button class="evidence-chip chip-${chip.kind}" type="button" data-filter="${escapeHtml(chip.kind)}">${escapeHtml(chip.label)}</button>`);
  if (chips.length === 0) {
    return "";
  }
  return `<div class="evidence-filters" role="toolbar" aria-label="Evidence filters">
    <button class="evidence-chip evidence-chip-all" type="button" data-filter="">All</button>
    ${chips.join("")}
  </div>`;
}

/** Escape HTML, then render markdown `code` spans as <code>. Used for intent what/why. */
function intentMarkup(text: string): string {
  return escapeHtml(text).replace(/`([^`]+)`/gu, (_match, inner: string) => `<code>${inner}</code>`);
}

/** Behavior / Internal risk pill from an entry's derived risk. */
function intentRiskPill(risk: IntentExplanation["risk"]): string {
  if (risk === "behavior") {
    return `<span class="risk-pill risk-behavior">Behavior</span>`;
  }
  if (risk === "internal") {
    return `<span class="risk-pill risk-internal">Internal</span>`;
  }
  if (risk === "content") {
    return `<span class="risk-pill risk-content">Content</span>`;
  }
  return "";
}

/** A collated intent meaning row: what (bold) + risk pill + why, from entry.explanation. */
function intentMeaningItem(entry: ReviewWebviewEntry): string {
  const what = entry.explanation?.what?.trim() || entry.label;
  const why = entry.explanation?.why?.trim() ?? "";
  const target = entry.targetId ? ` data-target="${escapeHtml(entry.targetId)}"` : "";
  return `<li class="intent-meaning" data-entry-kind="${escapeHtml(entry.kind)}"${target}>
    <span class="entry-dot">${entryIcon(entry.kind)}</span>
    <span class="intent-meaning-body">
      <span class="intent-meaning-head"><strong>${intentMarkup(what)}</strong>${intentRiskPill(entry.explanation?.risk)}</span>
      ${why ? `<span class="intent-meaning-why">${intentMarkup(why)}</span>` : ""}
    </span>
  </li>`;
}

/** AI-drafted release narrative card (rendered only when the LLM produced one). */
function releaseNarrativeCard(narrative: string | undefined): string {
  const text = narrative?.trim();
  if (!text) {
    return "";
  }
  const paragraphs = text.split(/\n{2,}/u).map((para) => `<p>${intentMarkup(para.trim())}</p>`).join("");
  return `<section class="insight-card release-narrative-card">
    <h3>Draft narrative <span class="ai-badge">AI</span></h3>
    ${paragraphs}
    <p class="release-narrative-note">Drafted from IntentumDiff's local intent summary — no source code was sent. Review before publishing.</p>
  </section>`;
}

/** Suppressed noise/style summary for the graceful "nothing meaningful" state. */
function suppressedNoiseSummary(entries: ReviewWebviewEntry[]): { count: number; reason: string } | undefined {
  const noise = entries.filter((entry) => entry.kind === "noise-suppressed" || entry.kind === "ignored-style");
  if (noise.length === 0) {
    return undefined;
  }
  const count = noise.reduce((total, entry) => total + Math.max(1, entry.evidenceCount || 0), 0);
  const reason = noise[0].explanation?.why?.trim() || noise[0].description?.trim() || noise[0].label;
  return { count, reason };
}

function reviewTabbedPages(model: ReviewPanelModel, stats: DiffStats): string {
  const riskEntries = model.entries.filter((entry) => entry.kind === "guardrail" || entry.severity === "error" || entry.severity === "warning");
  const evidenceEntries = model.entries.filter((entry) => entry.kind === "raw-evidence" || entry.kind === "noise-suppressed" || entry.evidenceCount > 0);
  const releaseNotes = buildReleaseNotes(model.diff);
  const semanticEntries = model.entries.filter((entry) => entry.kind !== "raw-evidence" && entry.kind !== "noise-suppressed");
  const safeRiskEntries = riskEntries.length > 0 ? riskEntries : [];
  const topEvidence = evidenceEntries.length > 0 ? evidenceEntries : model.entries.slice(0, 4);
  const fileScore = reviewFileScore(model, riskEntries.length);
  const semanticCount = semanticEntries.length || stats.semantic;
  const rawCount = model.file.rawChangeCount || stats.insert + stats.delete + stats.change;
  const behaviorCount = semanticEntries.filter((entry) => entry.explanation?.risk === "behavior").length;
  const internalCount = semanticEntries.filter((entry) => entry.explanation?.risk === "internal").length;
  const contentCount = semanticEntries.filter((entry) => entry.explanation?.risk === "content").length;
  const noise = suppressedNoiseSummary(model.entries);
  const intentSummaryParts = [
    behaviorCount ? `${behaviorCount} behavior change${behaviorCount === 1 ? "" : "s"}` : "",
    internalCount ? `${internalCount} internal change${internalCount === 1 ? "" : "s"}` : "",
    contentCount ? `${contentCount} content change${contentCount === 1 ? "" : "s"}` : "",
  ].filter(Boolean);
  const intentHeroTitle = intentSummaryParts.length > 0
    ? intentSummaryParts.join(" · ")
    : noise ? "Formatting / noise only" : "No semantic changes";
  const intentHeroDesc = intentSummaryParts.length > 0
    ? "IntentumDiff groups source evidence into review intent so changed meaning stays visible."
    : noise
      ? `All ${noise.count} raw change${noise.count === 1 ? "" : "s"} in this file were suppressed as formatting or noise.`
      : "No behavior-affecting or refactor changes were detected in this file.";
  const whatChangedList = semanticEntries.length > 0
    ? semanticEntries.slice(0, 8).map(intentMeaningItem).join("")
    : noise
      ? `<li class="intent-meaning intent-meaning-quiet"><span class="entry-dot">${iconSvg("filter")}</span><span class="intent-meaning-body"><span class="intent-meaning-head"><strong>Formatting / noise only</strong></span><span class="intent-meaning-why">${intentMarkup(noise.reason)} (${noise.count} suppressed)</span></span></li>`
      : `<li class="intent-meaning intent-meaning-quiet"><span class="intent-meaning-body"><span class="intent-meaning-head"><strong>No semantic changes</strong></span><span class="intent-meaning-why">Nothing behavior-affecting was detected for this file.</span></span></li>`;
  const presentCategories = [...new Set(model.entries.map((entry) => entry.kind))]
    .filter((kind) => kind !== "clean" && kind !== "change");
  return `
    <section class="review-page insight-page" data-review-page="intent" aria-label="Intent view">
      <div class="insight-layout intent-product-page">
        <article class="insight-hero intent-hero product-hero">
          <div class="insight-mark">${iconSvg("intent")}</div>
          <div>
            <p class="eyebrow">Intent summary</p>
            <h2>${escapeHtml(intentHeroTitle)}</h2>
            <p>${escapeHtml(intentHeroDesc)}</p>
          </div>
          <span class="confidence-ring" aria-label="Overall confidence">${fileScore}%</span>
        </article>
        <section class="insight-card metric-strip" aria-label="Intent metrics">
          ${metricTile("Intents", semanticCount)}
          ${metricTile("Evidence", rawCount)}
          ${metricTile("Risk", riskEntries.length)}
          ${metricTile("Score", `${fileScore}%`)}
        </section>
        <section class="insight-card narrative-card">
          <h3>What changed</h3>
          <ul class="intent-meaning-list">${whatChangedList}</ul>
        </section>
        <section class="insight-card narrative-card">
          <h3>Why inferred</h3>
          <p>${escapeHtml(
            intentSummaryParts.length > 0
              ? `IntentumDiff classified this file's changes into ${intentSummaryParts.join(" and ")}, kept separate from raw evidence so you can trust each call.`
              : "IntentumDiff keeps semantic groups, guardrails, and raw evidence as separate proof streams, so a file with only formatting or noise reads as exactly that.",
          )}</p>
          <div class="tag-row">${presentCategories.slice(0, 6).map((kind) => `<span class="intent-tag tag-${kind}">${escapeHtml(entryKindLabel(kind))}</span>`).join("")}</div>
        </section>
        <section class="insight-card risk-fold" aria-label="Risk and guardrails">
          <h3>Risk &amp; guardrails</h3>
          <p class="risk-fold-summary"><span class="severity-pill ${riskEntries.length > 0 ? "severity-high" : "severity-low"}">${riskEntries.length > 0 ? "Review" : "Low"}</span> ${riskEntries.length} risk or guardrail signal${riskEntries.length === 1 ? "" : "s"} across ${stats.semantic} semantic evidence line${stats.semantic === 1 ? "" : "s"}.</p>
          <div class="insight-list risk-list">
            ${safeRiskEntries.length > 0 ? safeRiskEntries.map(entryCard).join("") : `<article class="quiet-state">${iconSvg("accept")}<strong>No blocking risk selected</strong><span>Guardrails and high-severity signals will appear here when present.</span></article>`}
          </div>
          <div class="remediation-card">
            <h4>Remediation</h4>
            <ul>
              <li>Open the native diff before mutating code.</li>
              <li>Use guardrail evidence as the source of truth for protected symbols.</li>
              <li>Track unresolved risk in your normal issue workflow.</li>
            </ul>
          </div>
        </section>
      </div>
    </section>
    <section class="review-page insight-page" data-review-page="evidence" aria-label="Evidence view">
      <div class="insight-layout evidence-product-page">
        <article class="insight-hero evidence-hero product-hero">
          <div class="insight-mark">${iconSvg("evidence")}</div>
          <div>
            <p class="eyebrow">Evidence</p>
            <h2>${evidenceEntries.length || stats.insert + stats.delete + stats.change} evidence item${(evidenceEntries.length || stats.insert + stats.delete + stats.change) === 1 ? "" : "s"}</h2>
            <p>Raw, suppressed, and representative rows are kept here instead of crowding the code-first view.</p>
          </div>
        </article>
        ${evidenceFilterChips(topEvidence)}
        <section class="insight-list evidence-list">
          ${topEvidence.length > 0 ? topEvidence.map(entryCard).join("") : `<p>No extra raw or suppressed evidence for this review.</p>`}
        </section>
        <section class="insight-card evidence-breakdown">
          <h3>Diff evidence</h3>
          <div class="change-bars">
            ${changeBar("Added", stats.insert, "insert")}
            ${changeBar("Removed", stats.delete, "delete")}
            ${changeBar("Changed", stats.change, "change")}
            ${changeBar("Intent", stats.semantic, "semantic")}
          </div>
        </section>
      </div>
    </section>
    ${diagnosticsPage(model)}
    <section class="review-page insight-page" data-review-page="release-notes" aria-label="Release notes view">
      <div class="insight-layout release-notes-product-page">
        <article class="insight-hero notes-hero product-hero">
          <div class="insight-mark">${iconSvg("release")}</div>
          <div>
            <p class="eyebrow">Release notes</p>
            <h2>${escapeHtml(releaseNotesSummary(releaseNotes))}</h2>
            <p>Draft notes stay grouped with source traceability, separate from the code review surface.</p>
          </div>
          <div class="release-notes-actions">
            ${model.file.payload ? actionButton("Copy as Markdown", "copyReleaseNotes", model.file.payload, "copy") : ""}
            ${model.file.payload ? actionButton("Export JSON", "exportReleaseNotes", model.file.payload, "download") : ""}
          </div>
        </article>
        ${releaseNarrativeCard(model.releaseNarrative)}
        <section class="insight-card release-note-preview">
          <h3>Behavior changes</h3>
          <ul>${releaseNoteItems(releaseNotes.behavior, "No behavior-facing changes detected.")}</ul>
        </section>
        <section class="insight-card release-note-preview">
          <h3>Internal changes</h3>
          <ul>${releaseNoteItems(releaseNotes.internal, "No internal-only changes detected.")}</ul>
        </section>
        <section class="insight-card release-note-preview">
          <h3>Docs &amp; chores</h3>
          <ul>${releaseNoteItems(releaseNotes.other, "No docs or chore changes detected.")}</ul>
        </section>
        <section class="insight-card release-note-preview">
          <h3>Guardrails</h3>
          <ul>${releaseNoteItems(releaseNotes.guardrails, "No guardrail violations.")}</ul>
        </section>
        <section class="insight-card traceability-card">
          <h3>Source traceability</h3>
          <ul>${topEvidence.slice(0, 4).map((entry) => `<li><button type="button"${entry.targetId ? ` data-target="${escapeHtml(entry.targetId)}"` : ""}>${entryIcon(entry.kind)}<span>${escapeHtml(entry.label)}</span></button></li>`).join("")}</ul>
        </section>
      </div>
    </section>`;
}

interface FuelTelemetryCall {
  plugin: string;
  func: string;
  language: string;
  filename: string;
  provenance: string;
  engine: string;
  version: string;
  trusted: boolean;
  status: string;
  callCount: number;
  fuelConsumed?: number;
  totalFuelConsumed?: number;
  fuelBudget?: number;
  fuelUsedPercent?: number;
  fuelPerKb?: number;
  fuelPerLine?: number;
  policyReasons: string[];
  elapsedMs?: number;
  inputBytes?: number;
  inputLines?: number;
}

interface DiagnosticTraceEvent {
  stage: string;
  action: string;
  reason: string;
  ruleId: string;
}

interface ReviewDiagnosticsModel {
  calls: FuelTelemetryCall[];
  hotspots: Record<string, unknown>[];
  events: DiagnosticTraceEvent[];
  parseErrors: string[];
  fallback: boolean;
}

function diagnosticsPage(model: ReviewPanelModel): string {
  const diagnostics = diagnosticsForDiff(model.diff, DEFAULT_REVIEW_FUEL_POLICY);
  const peakFuel = diagnostics.calls.reduce((peak, call) => Math.max(peak, call.fuelConsumed ?? 0), 0);
  const totalFuel = diagnostics.calls.reduce((total, call) => total + (call.totalFuelConsumed ?? call.fuelConsumed ?? 0), 0);
  const hasTelemetry = diagnostics.calls.length > 0 || diagnostics.hotspots.length > 0 || diagnostics.events.length > 0;
  const health = diagnostics.parseErrors.length > 0 || diagnostics.hotspots.length > 0 || diagnostics.fallback
    ? "Inspect"
    : hasTelemetry ? "Normal" : "Not captured";
  return `<section class="review-page insight-page" data-review-page="diagnostics" aria-label="Diagnostics view">
      <div class="insight-layout diagnostics-product-page">
        <article class="insight-hero diagnostics-hero product-hero">
          <div class="insight-mark">${iconSvg("detail")}</div>
          <div>
            <p class="eyebrow">Runtime diagnostics</p>
            <h2>${escapeHtml(health)} parser fuel telemetry</h2>
            <p>Inspect Wasm fuel, parser fallbacks, and diagnostic events for this file as review payloads refresh.</p>
          </div>
          <span class="severity-pill ${health === "Inspect" ? "severity-high" : "severity-low"}">${escapeHtml(health)}</span>
        </article>
        <section class="insight-card metric-strip diagnostics-metrics" aria-label="Fuel metrics">
          ${metricTile("Calls", diagnostics.calls.length)}
          ${metricTile("Hotspots", diagnostics.hotspots.length)}
          ${metricTile("Peak fuel", formatFuel(peakFuel))}
          ${metricTile("Total fuel", formatFuel(totalFuel))}
        </section>
        <section class="insight-card fuel-timeline-card">
          <h3>Fuel timeline</h3>
          ${diagnostics.calls.length > 0
            ? `<div class="fuel-timeline">${diagnostics.calls.map((call, index) => fuelTimelineRow(call, index, peakFuel)).join("")}</div>`
            : `<article class="quiet-state">${iconSvg("detail")}<strong>No Wasm telemetry captured</strong><span>Run with parser telemetry or diagnostics enabled to populate call-level fuel usage.</span></article>`}
        </section>
        <section class="insight-card diagnostics-events-card">
          <h3>Diagnostics events</h3>
          ${diagnosticsEventsList(diagnostics)}
        </section>
        <section class="insight-card diagnostics-hotspots-card">
          <h3>Hotspots</h3>
          ${diagnostics.hotspots.length > 0
            ? `<div class="diagnostics-list">${diagnostics.hotspots.map(hotspotCard).join("")}</div>`
            : `<p>No excessive-fuel hotspot crossed policy thresholds for this file.</p>`}
        </section>
      </div>
    </section>`;
}

function diagnosticsForDiff(
  diff: SemanticDiff | undefined,
  fuelPolicy: ReviewFuelPolicy = DEFAULT_REVIEW_FUEL_POLICY,
): ReviewDiagnosticsModel {
  const telemetry = metadataRecord(diff, "engine_telemetry");
  const calls = arrayRecords(telemetry?.calls).map((record) => fuelTelemetryCall(record, fuelPolicy));
  const hotspots = arrayRecords(telemetry?.fuel_hotspots);
  return {
    calls,
    hotspots,
    events: diagnosticTraceEvents(diff),
    parseErrors: diff?.parse_errors ?? [],
    fallback: diff?.is_fallback === true,
  };
}

function metadataRecord(diff: SemanticDiff | undefined, key: string): Record<string, unknown> | undefined {
  const value = diff?.metadata?.[key];
  return isRecord(value) ? value : undefined;
}

function arrayRecords(value: unknown): Record<string, unknown>[] {
  return Array.isArray(value)
    ? value.filter((item): item is Record<string, unknown> => isRecord(item))
    : [];
}

function fuelTelemetryCall(record: Record<string, unknown>, fuelPolicy: ReviewFuelPolicy): FuelTelemetryCall {
  const fuelConsumed = numberField(record.fuel_consumed);
  const inputBytes = numberField(record.input_bytes);
  const inputLines = numberField(record.input_lines);
  const fuelPerKb = fuelConsumed !== undefined ? fuelConsumed / Math.max((inputBytes ?? 0) / 1024, 1) : undefined;
  const fuelPerLine = fuelConsumed !== undefined ? fuelConsumed / Math.max(inputLines ?? 0, 1) : undefined;
  const policyReasons = fuelPolicyReasons({ fuelConsumed, fuelPerKb, fuelPerLine }, fuelPolicy);
  return {
    plugin: stringField(record.plugin, "plugin"),
    func: stringField(record.function, "call"),
    language: stringField(record.language, "unknown"),
    filename: stringField(record.filename, ""),
    provenance: stringField(record.provenance, "unknown"),
    engine: stringField(record.engine, "unknown"),
    version: stringField(record.parser_version ?? record.plugin_version ?? record.version, ""),
    trusted: record.trusted === true,
    status: statusSummary(record.statuses) || stringField(record.status, "unknown"),
    callCount: numberField(record.call_count) ?? 1,
    fuelConsumed,
    totalFuelConsumed: numberField(record.total_fuel_consumed),
    fuelBudget: numberField(record.fuel_budget),
    fuelUsedPercent: numberField(record.max_fuel_used_percent) ?? numberField(record.fuel_used_percent),
    fuelPerKb,
    fuelPerLine,
    policyReasons,
    elapsedMs: numberField(record.elapsed_ms),
    inputBytes,
    inputLines,
  };
}

function diagnosticTraceEvents(diff: SemanticDiff | undefined): DiagnosticTraceEvent[] {
  const diagnostics = metadataRecord(diff, "diagnostics");
  return arrayRecords(diagnostics?.events)
    .filter((event) => {
      const stage = stringField(event.stage, "");
      const action = stringField(event.action, "");
      const rule = stringField(event.rule_id, "");
      return stage.includes("telemetry") || action.includes("fuel") || rule.includes("fuel");
    })
    .slice(0, 8)
    .map((event) => ({
      stage: stringField(event.stage, "diagnostics"),
      action: stringField(event.action, "event"),
      reason: stringField(event.reason, ""),
      ruleId: stringField(event.rule_id, ""),
    }));
}

function fuelTimelineRow(call: FuelTelemetryCall, index: number, peakFuel: number): string {
  const consumed = call.fuelConsumed ?? 0;
  const percent = call.fuelUsedPercent ?? (
    call.fuelBudget && call.fuelBudget > 0 ? consumed / call.fuelBudget * 100 : undefined
  );
  const width = Math.max(4, Math.min(100, percent ?? (peakFuel > 0 ? consumed / peakFuel * 100 : 4)));
  const classes = [
    "fuel-row",
    call.status.includes("exhaust") || call.policyReasons.length > 0 ? "is-hot" : "",
  ].filter(Boolean).join(" ");
  const filename = call.filename ? ` · ${call.filename}` : "";
  const input = [
    call.inputLines !== undefined ? `${call.inputLines} lines` : "",
    call.inputBytes !== undefined ? `${formatFuel(call.inputBytes)}B` : "",
    call.fuelPerLine !== undefined ? `${formatFuel(call.fuelPerLine)}/line` : "",
    call.fuelPerKb !== undefined ? `${formatFuel(call.fuelPerKb)}/KB` : "",
  ].filter(Boolean).join(" · ");
  const policy = call.policyReasons.length > 0 ? call.policyReasons.join(", ") : "within policy";
  return `<article class="${classes}">
    <header>
      <strong>${escapeHtml(`${index + 1}. ${call.language} ${call.func}${filename}`)}</strong>
      <span>${escapeHtml(call.status)}</span>
    </header>
    <div class="fuel-bar" style="--bar-width:${width.toFixed(1)}%"><i></i></div>
    <footer>
      <span>${escapeHtml(formatFuel(consumed))} fuel${call.callCount > 1 ? ` over ${call.callCount} calls` : ""}</span>
      <span>${percent !== undefined ? escapeHtml(`${percent.toFixed(percent < 10 ? 2 : 1)}% budget`) : "budget n/a"}</span>
      ${call.elapsedMs !== undefined ? `<span>${escapeHtml(formatMetric(call.elapsedMs))} ms</span>` : ""}
      <span>${escapeHtml(policy)}</span>
      <span title="${escapeHtml(call.plugin)}">${escapeHtml(`${call.provenance} · ${call.engine}${call.version ? ` · ${call.version}` : ""}${call.trusted ? " · trusted" : ""}`)}</span>
      ${input ? `<span>${escapeHtml(input)}</span>` : ""}
    </footer>
  </article>`;
}

function diagnosticsEventsList(diagnostics: ReviewDiagnosticsModel): string {
  const parserRows = [
    ...diagnostics.parseErrors.map((message) => `<li class="diagnostics-event diagnostics-error"><strong>parse</strong><span>${escapeHtml(message)}</span></li>`),
    ...(diagnostics.fallback ? [`<li class="diagnostics-event diagnostics-warning"><strong>fallback</strong><span>Parser fallback was used for this file.</span></li>`] : []),
  ];
  const traceRows = diagnostics.events.map((event) => `<li class="diagnostics-event"><strong>${escapeHtml(event.action)}</strong><span>${escapeHtml(event.reason || event.ruleId || event.stage)}</span></li>`);
  const rows = [...parserRows, ...traceRows];
  return rows.length > 0
    ? `<ul class="diagnostics-events">${rows.join("")}</ul>`
    : `<p>No parse, fallback, fuel, or telemetry diagnostics were attached to this review payload.</p>`;
}

function hotspotCard(hotspot: Record<string, unknown>): string {
  const language = stringField(hotspot.language, "unknown");
  const func = stringField(hotspot.function, "plugin");
  const filename = stringField(hotspot.filename, "");
  const thresholds = Array.isArray(hotspot.thresholds_exceeded)
    ? hotspot.thresholds_exceeded.map((item) => String(item)).join(", ")
    : "";
  return `<article class="diagnostics-hotspot">
    <strong>${escapeHtml(`${language} ${func}${filename ? ` · ${filename}` : ""}`)}</strong>
    <span>${escapeHtml(formatFuel(numberField(hotspot.fuel_consumed) ?? 0))} fuel</span>
    <small>${escapeHtml(thresholds || "threshold exceeded")}</small>
  </article>`;
}

function statusSummary(value: unknown): string {
  if (!isRecord(value)) {
    return "";
  }
  return Object.entries(value)
    .map(([status, count]) => `${status}:${count}`)
    .join(", ");
}

function stringField(value: unknown, fallback: string): string {
  return typeof value === "string" && value.length > 0 ? value : fallback;
}

function numberField(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function fuelPolicyReasons(
  values: { fuelConsumed?: number; fuelPerKb?: number; fuelPerLine?: number },
  fuelPolicy: ReviewFuelPolicy,
): string[] {
  return [
    values.fuelConsumed !== undefined && values.fuelConsumed > fuelPolicy.peakFuelWarning
      ? `peak>${formatFuel(fuelPolicy.peakFuelWarning)}`
      : "",
    values.fuelPerKb !== undefined && values.fuelPerKb > fuelPolicy.fuelPerKbWarning
      ? `perKB>${formatFuel(fuelPolicy.fuelPerKbWarning)}`
      : "",
    values.fuelPerLine !== undefined && values.fuelPerLine > fuelPolicy.fuelPerLineWarning
      ? `perLine>${formatFuel(fuelPolicy.fuelPerLineWarning)}`
      : "",
  ].filter(Boolean);
}

function uniqueStrings(values: string[]): string[] {
  return [...new Set(values.filter(Boolean))];
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

function reviewFileScore(model: ReviewPanelModel, riskCount: number): number {
  const semanticWeight = Math.min(12, model.entries.filter((entry) => entry.kind !== "raw-evidence").length * 3);
  const riskPenalty = Math.min(20, riskCount * 8);
  return Math.max(55, Math.min(98, 86 + semanticWeight - riskPenalty));
}

function metricTile(label: string, value: string | number): string {
  return `<div class="metric-tile"><strong>${escapeHtml(String(value))}</strong><span>${escapeHtml(label)}</span></div>`;
}

function changeBar(label: string, value: number, kind: "insert" | "delete" | "change" | "semantic"): string {
  const width = Math.max(4, Math.min(100, value * 12));
  return `<div class="change-bar change-bar-${kind}"><span>${escapeHtml(label)}</span><strong>${value}</strong><i style="--bar-width:${width}%"></i></div>`;
}

function releaseNoteItems(lines: string[], emptyLabel: string): string {
  if (lines.length === 0) {
    return `<li class="release-note-empty">${escapeHtml(emptyLabel)}</li>`;
  }
  return lines.map((line) => `<li>${intentMarkup(line)}</li>`).join("");
}

function viewTab(label: string, view: string, icon: IconName, active = false): string {
  return `<button class="product-tab ${active ? "is-active" : ""}" type="button" data-review-view="${escapeHtml(view)}">${iconSvg(icon)}<span>${escapeHtml(label)}</span></button>`;
}

function entryIcon(kind: ReviewWebviewEntry["kind"]): string {
  if (kind === "guardrail") return iconSvg("risk");
  if (kind === "schema-status") return iconSvg("schema");
  if (kind === "refactoring" || kind === "moved-code") return iconSvg("intent");
  if (kind === "raw-evidence" || kind === "evidence") return iconSvg("evidence");
  if (kind === "noise-suppressed" || kind === "ignored-style" || kind === "style") return iconSvg("filter");
  if (kind === "cross-file") return iconSvg("graph");
  return iconSvg("detail");
}

function entryKindLabel(kind: ReviewWebviewEntry["kind"]): string {
  const labels: Partial<Record<ReviewWebviewEntry["kind"], string>> = {
    "guardrail": "Guardrail",
    "cross-file": "Cross-file",
    "schema-status": "Schema",
    "moved-code": "Moved code",
    "refactoring": "Refactoring",
    "meaningful": "Meaningful",
    "ignored-style": "Ignored style",
    "noise-suppressed": "Noise suppressed",
    "raw-evidence": "Raw evidence",
    "change": "Change",
    "evidence": "Evidence",
    "style": "Style",
    "clean": "Clean",
    "skipped": "Skipped",
    "error": "Error",
  };
  return labels[kind] ?? kind;
}

function metric(label: string, value: number, tone: "normal" | "warn" | "danger" = "normal"): string {
  return `<div class="metric ${tone}"><span>${escapeHtml(label)}</span><strong>${value}</strong></div>`;
}

function layoutButton(label: string, toggle: string, icon: IconName): string {
  return `<button class="action toolbar-icon" type="button" data-layout-toggle="${escapeHtml(toggle)}" title="${escapeHtml(label)}">${iconSvg(icon)}<span class="sr-only">${escapeHtml(label)}</span></button>`;
}

function fileTypeAndSchemaBadges(file: ReviewDashboardFile): string {
  const typeBadge = file.language ? filterPill(file.language, "language", "type-pill") : "";
  const schemaBadge = file.schema
    ? `${typeBadge ? `<span class="schema-link" aria-hidden="true">+</span>` : ""}${filterPill(file.schema, "schema", "schema-pill schema-adjacent")}`
    : "";
  if (!typeBadge && !schemaBadge) {
    return "";
  }
  return `<span class="type-schema-badges" aria-label="File type and schema used">${typeBadge}${schemaBadge}</span>`;
}

function filterPill(label: string, filter: string, className = ""): string {
  return `<button class="pill filter-pill ${className}" type="button" data-filter="${escapeHtml(filter)}">${escapeHtml(label)}</button>`;
}

function statBadge(kind: keyof DiffStats, value: number): string {
  return `<button class="stat stat-${kind}" type="button" data-filter="${escapeHtml(kind)}">${escapeHtml(statLabel(kind))}<strong>${value}</strong></button>`;
}

function statLabel(kind: keyof DiffStats): string {
  if (kind === "insert") {
    return "+";
  }
  if (kind === "delete") {
    return "-";
  }
  if (kind === "change") {
    return "~";
  }
  return "intent";
}

function page(title: string, body: string, options: RenderOptions): string {
  // Inline style="--custom-property:..." attributes (fuel/overview/change bars)
  // require 'unsafe-inline' in style-src; scripts stay nonce-locked.
  const csp = `default-src 'none'; img-src ${options.cspSource} data:; style-src 'nonce-${options.nonce}' 'unsafe-inline' ${options.cspSource}; font-src ${options.cspSource}; script-src 'nonce-${options.nonce}' ${options.cspSource};`;
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta http-equiv="Content-Security-Policy" content="${csp}">
  <title>${escapeHtml(title)}</title>
  ${options.codiconsUri ? `<link rel="stylesheet" href="${options.codiconsUri}">` : ""}
  <style nonce="${options.nonce}">${styles()}</style>
</head>
<body>
  ${body}
  ${options.highlightUri ? `<script nonce="${options.nonce}" src="${options.highlightUri}"></script>` : ""}
  <script nonce="${options.nonce}">${script()}</script>
</body>
</html>`;
}

