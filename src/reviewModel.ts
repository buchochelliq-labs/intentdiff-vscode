import type {
  ChangeGroup,
  CrossFileChange,
  GuardrailViolation,
  NodePosition,
  SemanticChange,
  SemanticDiff,
  SchemaStatusMetadata,
} from "./types";
import {
  isPresentationNoiseChange,
  reviewTargetForChange,
  type SemanticChangeTargetSide,
} from "./mapper";
import { kindForChange } from "./intentCodeLens";

export type ReviewFileStatus = "pending" | "ready" | "skipped" | "error";
export type ReviewEntryKind =
  | "guardrail"
  | "cross-file"
  | "schema-status"
  | "file-lifecycle"
  | "asset"
  | "moved-code"
  | "refactoring"
  | "meaningful"
  | "ignored-style"
  | "noise-suppressed"
  | "raw-evidence"
  | "change"
  | "evidence"
  | "style"
  | "clean"
  | "skipped"
  | "error";

export interface ReviewFile {
  folderName: string;
  folderUri: string;
  relativePath: string;
  status: ReviewFileStatus;
  diff?: SemanticDiff;
  error?: string;
  pendingMessage?: string;
  skippedReason?: string;
}

export type ReviewFileGroupingMode =
  | "auto"
  | "none"
  | "language"
  | "schema"
  | "languageThenSchema";

export interface ReviewFileGroup {
  key: string;
  label: string;
  description: string;
  mode: Exclude<ReviewFileGroupingMode, "auto" | "none">;
  files: ReviewFile[];
  summary: ReviewSummary;
  schema?: string;
  language?: string;
}

export interface ReviewEntry {
  kind: ReviewEntryKind;
  label: string;
  description?: string;
  severity?: "error" | "warning" | "info";
  position?: NodePosition | null;
  positionSide?: SemanticChangeTargetSide;
  change?: SemanticChange;
  evidence?: ReviewEntry[];
  evidenceIndex?: number;
  group?: ChangeGroup;
  violation?: GuardrailViolation;
  schema?: SchemaStatusMetadata;
  crossFileChange?: CrossFileChange;
}

export interface ReviewCrossFileEntry {
  kind: "cross-file";
  folderUri: string;
  label: string;
  description?: string;
  severity: "info";
  change: CrossFileChange;
  relativePath?: string;
}

export interface ReviewSummary {
  fileCount: number;
  readyCount: number;
  skippedCount: number;
  errorCount: number;
  guardrailCount: number;
  crossFileChangeCount: number;
  immutableCount: number;
  importantCount: number;
  semanticChangeCount: number;
  styleOnlyCount: number;
  cleanCount: number;
}

export function summarizeReview(files: ReviewFile[]): ReviewSummary {
  const summary: ReviewSummary = {
    // The synthetic `.intentumdiff-review` placeholder (review-level status/error carrier) is not
    // a workspace file — counting it made the tree/summary claim one more file than exists.
    fileCount: files.filter((f) => f.relativePath !== ".intentumdiff-review").length,
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

  for (const file of files) {
    if (file.status === "skipped") {
      summary.skippedCount += 1;
      continue;
    }
    if (file.status === "error") {
      summary.errorCount += 1;
      continue;
    }
    if (file.status !== "ready") {
      continue;
    }
    summary.readyCount += 1;
    const diff = file.diff;
    const violations = diff?.guardrail_violations ?? [];
    summary.guardrailCount += violations.length;
    summary.immutableCount += violations.filter((item) => item.severity === "immutable").length;
    summary.importantCount += violations.filter((item) => item.severity === "important").length;
    summary.semanticChangeCount += diff?.changes?.length ?? 0;
    if (isStyleOnlyReviewDiff(diff)) {
      summary.styleOnlyCount += 1;
    }
    if (
      fileLifecycle(diff) === "modified"
      && !isStyleOnlyReviewDiff(diff)
      && (diff?.changes?.length ?? 0) === 0
      && violations.length === 0
    ) {
      summary.cleanCount += 1;
    }
  }
  return summary;
}

export function summarizeReviewWithCrossFile(
  files: ReviewFile[],
  crossFileChanges: CrossFileChange[],
): ReviewSummary {
  const summary = summarizeReview(files);
  summary.crossFileChangeCount = crossFileChanges.length;
  return summary;
}

export function reviewEntriesForCrossFileChanges(
  changes: CrossFileChange[],
  folderUri: string,
): ReviewCrossFileEntry[] {
  return [...changes]
    .sort((a, b) => crossFileRank(a) - crossFileRank(b)
      || a.symbol_name.localeCompare(b.symbol_name))
    .map((change) => ({
      kind: "cross-file",
      folderUri,
      label: crossFileLabel(change),
      description: crossFileDescription(change),
      severity: "info",
      change,
      relativePath: singleTargetPath(change),
    }));
}

export function reviewEntriesForFile(file: ReviewFile): ReviewEntry[] {
  if (file.status === "skipped") {
    return [{
      kind: "skipped",
      label: file.skippedReason ?? "Skipped",
      severity: "info",
    }];
  }
  if (file.status === "error") {
    return [{
      kind: "error",
      label: file.error ?? "Diff failed",
      severity: "error",
    }];
  }
  if (file.status === "pending") {
    return [{
      kind: "clean",
      label: file.pendingMessage ?? "Queued",
      severity: "info",
    }];
  }

  const diff = file.diff;
  const entries: ReviewEntry[] = [];
  for (const violation of diff?.guardrail_violations ?? []) {
    entries.push({
      kind: "guardrail",
      label: violation.message,
      description: violation.semantic_path,
      severity: violation.severity === "immutable" ? "error" : "warning",
      position: violation.position,
      violation,
    });
  }
  const schemaEntry = reviewEntryForSchema(diff);
  if (schemaEntry) {
    entries.push(schemaEntry);
  }
  const lifecycleEntry = reviewEntryForFileLifecycle(file);
  if (lifecycleEntry) {
    entries.push(lifecycleEntry);
  }
  entries.push(...reviewEntriesForParserDiagnostics(diff));
  const changes = diff?.changes ?? [];
  const groupEntries = reviewEntriesForGroups(reviewGroupsForLifecycle(diff), changes);
  entries.push(...groupEntries);

  const groupedChangeIndices = new Set<number>();
  for (const entry of groupEntries) {
    for (const evidence of entry.evidence ?? []) {
      if (evidence.evidenceIndex !== undefined) {
        groupedChangeIndices.add(evidence.evidenceIndex);
      }
    }
  }

  // A change owned by no group is a real change the engine left ungrouped (e.g. a new line
  // in a generic-parser file like .gitignore, whose only "group" is the emptied token-churn
  // noise group). When the file's story is NOT already told by shown intent groups
  // (moved/refactor/meaningful), those ungrouped changes ARE the story: promote each that
  // classifies as a shown category to a first-class entry so it reads as its own
  // Meaningful/Refactor/Moved change (content-labelled downstream) instead of being demoted
  // to a generic "Raw evidence" node. When rich intent groups already exist, or on
  // added/deleted files (where the file-lifecycle entry is the headline), leave ungrouped
  // changes in the collapsed raw-evidence bucket. Nothing is ever dropped.
  const hasShownIntentGroups = groupEntries.some(
    (entry) => entry.kind === "moved-code" || entry.kind === "refactoring" || entry.kind === "meaningful",
  );
  const promoteUngrouped = fileLifecycle(diff) === "modified" && !hasShownIntentGroups;
  const promotedChangeEntries: ReviewEntry[] = [];
  const residualEvidenceEntries: ReviewEntry[] = [];
  for (const [index, change] of changes.entries()) {
    if (groupedChangeIndices.has(index)) {
      continue;
    }
    if (isPresentationNoiseChange(change)) {
      continue;
    }
    const entryKind = promoteUngrouped ? groupEntryKind(kindForChange(change)) : undefined;
    if (entryKind) {
      promotedChangeEntries.push({ ...reviewEntryForChange(change, index, "change"), kind: entryKind });
    } else {
      residualEvidenceEntries.push(reviewEntryForChange(change, index, "change"));
    }
  }
  entries.push(...promotedChangeEntries);
  if (residualEvidenceEntries.length > 0) {
    if (
      groupEntries.length > 0
      || promotedChangeEntries.length > 0
      || entries.some((entry) => entry.kind === "guardrail" || entry.kind === "file-lifecycle")
    ) {
      entries.push({
        kind: "raw-evidence",
        label: "Raw evidence",
        description: plural(residualEvidenceEntries.length, "change"),
        severity: "info",
        evidence: sortReviewEntries(residualEvidenceEntries.map((entry) => ({
          ...entry,
          kind: "evidence" as const,
        }))),
      });
    } else {
      entries.push(...residualEvidenceEntries);
    }
  }
  if (entries.length === 0 && isStyleOnlyReviewDiff(diff)) {
    entries.push({
      kind: "style",
      label: "Style-only changes",
      severity: "info",
    });
  }
  if (entries.length === 0) {
    entries.push({
      kind: "clean",
      label: "No semantic changes",
      severity: "info",
    });
  }
  if (entries.length === 1 && entries[0].kind === "clean" && isImageLikePath(file.relativePath)) {
    const leaf = file.relativePath.split(/[/\\]/u).pop() ?? file.relativePath;
    return [ {
      kind: "asset",
      label: `Image asset: ${leaf}`,
      description: "image asset review",
      severity: "info",
    } ];
  }
  return sortReviewEntries(entries);
}

function reviewEntryForFileLifecycle(file: ReviewFile): ReviewEntry | undefined {
  const lifecycle = fileLifecycle(file.diff);
  if (lifecycle === "modified" || !file.diff) {
    return undefined;
  }
  const language = languageLabel(file.diff.language);
  const changes = file.diff.changes ?? [];
  const expectedType = lifecycle === "added" ? "ADDITION" : "DELETION";
  const count = changes.filter((change) => change.change_type === expectedType).length;
  return {
    kind: "file-lifecycle",
    label: lifecycle === "added" ? `New ${language} file` : `Deleted ${language} file`,
    description: `${count} ${lifecycle === "added" ? "added" : "deleted"} change${count === 1 ? "" : "s"}`,
    severity: "info",
  };
}

function reviewEntriesForParserDiagnostics(diff: SemanticDiff | undefined): ReviewEntry[] {
  if (!diff) {
    return [];
  }
  const entries: ReviewEntry[] = [];
  for (const message of diff.parse_errors ?? []) {
    const isFuel = message.includes("FUEL_EXCEEDED");
    entries.push({
      kind: "error",
      label: isFuel ? "Fuel limit exceeded" : "Parser warning",
      description: message,
      severity: isFuel ? "error" : "warning",
    });
  }
  if (diff.is_fallback) {
    entries.push({
      kind: "error",
      label: "Parser fallback used",
      description: "IntentumDiff used fallback parsing for this file; semantic precision may be reduced.",
      severity: "warning",
    });
  }
  for (const hotspot of fuelHotspots(diff)) {
    entries.push({
      kind: "error",
      label: "Excessive parser fuel",
      description: fuelHotspotDescription(hotspot),
      severity: "warning",
    });
  }
  return entries;
}

function reviewGroupsForLifecycle(diff: SemanticDiff | undefined): ChangeGroup[] {
  const groups = diff?.change_groups ?? [];
  if (fileLifecycle(diff) === "modified") {
    return groups;
  }
  return groups.filter((group) => group.kind !== "IGNORED_STYLE");
}

function reviewEntriesForGroups(
  groups: ChangeGroup[],
  changes: SemanticChange[],
): ReviewEntry[] {
  const entries: ReviewEntry[] = [];
  for (const group of groups) {
    const kind = groupEntryKind(group.kind);
    if (!kind) {
      continue;
    }
    const representative = representativeChangeForGroup(group, changes);
    const target = representative ? reviewTargetForChange(representative) : undefined;
    const evidence = reviewEntriesForGroupEvidence(group, changes);
    entries.push({
      kind,
      label: groupLabel(group),
      description: groupDescription(group),
      severity: "info",
      position: target?.position ?? null,
      positionSide: target?.side,
      change: representative,
      evidence: evidence.length > 0 ? evidence : undefined,
      group,
    });
  }
  return entries;
}

function reviewEntriesForGroupEvidence(
  group: ChangeGroup,
  changes: SemanticChange[],
): ReviewEntry[] {
  const seen = new Set<number>();
  const entries: ReviewEntry[] = [];
  for (const index of group.raw_change_indices ?? []) {
    if (!Number.isInteger(index) || index < 0 || index >= changes.length || seen.has(index)) {
      continue;
    }
    seen.add(index);
    entries.push(reviewEntryForChange(changes[index], index, "evidence"));
  }
  return sortReviewEntries(entries);
}

function reviewEntryForChange(
  change: SemanticChange,
  index: number,
  kind: "change" | "evidence",
): ReviewEntry {
  const target = reviewTargetForChange(change);
  return {
    kind,
    label: change.description || change.refactoring_kind || change.change_type,
    description: change.change_type,
    severity: "info",
    position: target?.position ?? null,
    positionSide: target?.side,
    change,
    evidenceIndex: index,
  };
}

export function sortReviewFiles(files: ReviewFile[]): ReviewFile[] {
  return [...files].sort((a, b) => fileRank(a) - fileRank(b)
    || a.relativePath.localeCompare(b.relativePath));
}

export function normalizeReviewFileGroupingMode(value: unknown): ReviewFileGroupingMode {
  return value === "none"
    || value === "language"
    || value === "schema"
    || value === "languageThenSchema"
    || value === "auto"
    ? value
    : "auto";
}

export function nextReviewFileGroupingMode(mode: ReviewFileGroupingMode): ReviewFileGroupingMode {
  if (mode === "auto") {
    return "none";
  }
  if (mode === "none") {
    return "language";
  }
  if (mode === "language") {
    return "schema";
  }
  if (mode === "schema") {
    return "languageThenSchema";
  }
  return "auto";
}

export function resolveReviewFileGroupingMode(
  files: ReviewFile[],
  mode: ReviewFileGroupingMode,
): Exclude<ReviewFileGroupingMode, "auto"> {
  if (mode !== "auto") {
    return mode;
  }
  if (files.length >= 4 || reviewLanguages(files).size > 1 || files.some((file) => schemaStatus(file.diff))) {
    return "languageThenSchema";
  }
  return "none";
}

export function groupReviewFiles(
  files: ReviewFile[],
  mode: ReviewFileGroupingMode,
): ReviewFileGroup[] {
  const effectiveMode = resolveReviewFileGroupingMode(files, mode);
  if (effectiveMode === "none") {
    return [];
  }

  const groups = new Map<string, {
    label: string;
    mode: ReviewFileGroup["mode"];
    schema?: string;
    language?: string;
    files: ReviewFile[];
  }>();
  for (const file of sortReviewFiles(files)) {
    const identity = fileGroupIdentity(file, effectiveMode);
    const existing = groups.get(identity.key);
    if (existing) {
      existing.files.push(file);
      continue;
    }
    groups.set(identity.key, {
      label: identity.label,
      mode: effectiveMode,
      schema: identity.schema,
      language: identity.language,
      files: [file],
    });
  }

  return [...groups.entries()]
    .map(([key, group]) => {
      const summary = summarizeReview(group.files);
      return {
        key,
        label: group.label,
        description: fileGroupDescription(group.files, summary),
        mode: group.mode,
        files: group.files,
        summary,
        schema: group.schema,
        language: group.language,
      };
    })
    .sort((a, b) => fileGroupRank(a) - fileGroupRank(b)
      || a.label.localeCompare(b.label));
}

export function sortReviewEntries(entries: ReviewEntry[]): ReviewEntry[] {
  return [...entries].sort((a, b) => entryRank(a) - entryRank(b)
    || entryPositionRank(a) - entryPositionRank(b)
    || a.label.localeCompare(b.label));
}

function reviewLanguages(files: ReviewFile[]): Set<string> {
  return new Set(files.map((file) => file.diff?.language).filter(isDefined));
}

function fileGroupIdentity(
  file: ReviewFile,
  mode: Exclude<ReviewFileGroupingMode, "auto" | "none">,
): {
  key: string;
  label: string;
  schema?: string;
  language?: string;
} {
  const language = languageLabel(file.diff?.language);
  const languageKey = groupKeyPart(language);
  const schema = schemaCompactDescription(file.diff);
  const schemaKey = schema ? groupKeyPart(schema) : undefined;
  const schemaRelevant = isSchemaRelevantFile(file);
  if (mode === "language") {
    return {
      key: `language:${languageKey}`,
      label: language,
      language,
    };
  }
  if (mode === "schema") {
    if (schema) {
      return {
        key: `schema:${schemaKey}`,
        label: schema,
        schema,
        language,
      };
    }
    if (schemaRelevant) {
      return {
        key: `schema-missing:${languageKey}`,
        label: `${language} · schema missing`,
        schema: "schema missing",
        language,
      };
    }
    return {
      key: `language:${languageKey}`,
      label: language,
      language,
    };
  }
  if (schema) {
    return {
      key: `language-schema:${languageKey}:${schemaKey}`,
      label: `${language} · ${schema}`,
      schema,
      language,
    };
  }
  if (schemaRelevant) {
    return {
      key: `language-schema-missing:${languageKey}`,
      label: `${language} · schema missing`,
      schema: "schema missing",
      language,
    };
  }
  return {
    key: `language:${languageKey}`,
    label: language,
    language,
  };
}

function groupKeyPart(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9#+]+/gu, "-").replace(/^-|-$/gu, "");
}

function fileGroupDescription(files: ReviewFile[], summary: ReviewSummary): string {
  const groupCount = files.reduce((total, file) => total + reviewGroupCounts(file.diff).review, 0);
  const rawCount = files.reduce((total, file) => total + (file.diff?.changes?.length ?? 0), 0);
  return [
    plural(files.length, "file"),
    summary.guardrailCount > 0 ? plural(summary.guardrailCount, "guardrail") : undefined,
    groupCount > 0 ? plural(groupCount, "review group") : undefined,
    rawCount > 0 ? `${rawCount} raw` : undefined,
  ].filter(isDefined).join(" | ");
}

function fileGroupRank(group: ReviewFileGroup): number {
  if (group.summary.guardrailCount > 0) {
    return 0;
  }
  if (group.summary.semanticChangeCount > 0) {
    return 1;
  }
  if (group.summary.errorCount > 0) {
    return 2;
  }
  if (group.summary.skippedCount > 0) {
    return 3;
  }
  if (group.summary.styleOnlyCount > 0) {
    return 4;
  }
  return 5;
}

function languageLabel(language: string | undefined): string {
  if (!language) {
    return "Unknown";
  }
  const labels: Record<string, string> = {
    csharp: "C#",
    cpp: "C++",
    css: "CSS",
    html: "HTML",
    javascript: "JavaScript",
    json: "JSON",
    jsonc: "JSON",
    mdx: "MDX",
    php: "PHP",
    python: "Python",
    sql: "SQL",
    typescript: "TypeScript",
    tsx: "TSX",
    xml: "XML",
    yaml: "YAML",
    yml: "YAML",
  };
  return labels[language.toLowerCase()] ?? humanizeConstant(language.replace(/[-.]/gu, "_"));
}

function fileLifecycle(diff: SemanticDiff | undefined): "added" | "deleted" | "modified" {
  const raw = diff?.metadata?.file_lifecycle;
  if (raw === "added" || raw === "deleted") {
    return raw;
  }
  if (diff?.old_filename && !diff.new_filename) {
    return "deleted";
  }
  if (!diff?.old_filename && diff?.new_filename) {
    return "added";
  }
  return "modified";
}

export function isStyleOnlyReviewDiff(diff: SemanticDiff | undefined): boolean {
  return diff?.is_style_only === true && fileLifecycle(diff) === "modified";
}

function fuelHotspots(diff: SemanticDiff | undefined): Record<string, unknown>[] {
  const telemetry = diff?.metadata?.engine_telemetry;
  if (!telemetry || typeof telemetry !== "object" || Array.isArray(telemetry)) {
    return [];
  }
  const hotspots = (telemetry as { fuel_hotspots?: unknown }).fuel_hotspots;
  return Array.isArray(hotspots)
    ? hotspots.filter((item): item is Record<string, unknown> => typeof item === "object" && item !== null)
    : [];
}

function fuelHotspotDescription(hotspot: Record<string, unknown>): string {
  const language = typeof hotspot.language === "string" && hotspot.language ? hotspot.language : "unknown";
  const method = typeof hotspot.function === "string" && hotspot.function ? hotspot.function : "plugin";
  const consumed = typeof hotspot.fuel_consumed === "number" ? hotspot.fuel_consumed.toLocaleString("en-US") : "unknown";
  const filename = typeof hotspot.filename === "string" && hotspot.filename ? ` in ${hotspot.filename}` : "";
  return `${language} ${method}${filename} consumed ${consumed} fuel`;
}

function isSchemaRelevantFile(file: ReviewFile): boolean {
  const language = file.diff?.language?.toLowerCase();
  if (language === "json" || language === "jsonc" || language === "yaml" || language === "yml") {
    return true;
  }
  return /\.(jsonc?|ya?ml)$/iu.test(file.relativePath);
}

function fileRank(file: ReviewFile): number {
  if ((file.diff?.guardrail_violations?.length ?? 0) > 0) {
    return 0;
  }
  if ((file.diff?.change_groups?.length ?? 0) > 0 || (file.diff?.changes?.length ?? 0) > 0) {
    return 1;
  }
  if (file.status === "error") {
    return 2;
  }
  if (file.status === "skipped") {
    return 3;
  }
  if (isStyleOnlyReviewDiff(file.diff)) {
    return 4;
  }
  return 5;
}

function entryRank(entry: ReviewEntry): number {
  if (entry.kind === "guardrail") {
    return entry.severity === "error" ? 0 : 1;
  }
  if (entry.kind === "cross-file") {
    return 2;
  }
  if (entry.kind === "schema-status") {
    return 3;
  }
  if (entry.kind === "file-lifecycle") {
    return 4;
  }
  if (entry.kind === "moved-code") {
    return 5;
  }
  if (entry.kind === "refactoring") {
    return 6;
  }
  if (entry.kind === "meaningful") {
    return 7;
  }
  if (entry.kind === "ignored-style") {
    return 8;
  }
  if (entry.kind === "noise-suppressed") {
    return 9;
  }
  if (entry.kind === "raw-evidence") {
    return 10;
  }
  if (entry.kind === "change") {
    return 11;
  }
  if (entry.kind === "evidence") {
    return 12;
  }
  if (entry.kind === "error") {
    return 13;
  }
  if (entry.kind === "skipped") {
    return 14;
  }
  if (entry.kind === "style") {
    return 15;
  }
  return 16;
}

function entryPositionRank(entry: ReviewEntry): number {
  const position = entry.position ?? undefined;
  if (!position) {
    return Number.MAX_SAFE_INTEGER;
  }
  return position.start_line * 100_000 + position.start_col;
}

function crossFileRank(change: CrossFileChange): number {
  if (change.change_type === "SPLIT_MODULE") {
    return 0;
  }
  if (change.change_type === "MOVE_TO_MODULE") {
    return 1;
  }
  if (change.change_type === "CROSS_FILE_RENAME") {
    return 2;
  }
  return 3;
}

function crossFileLabel(change: CrossFileChange): string {
  if (change.description) {
    return change.description;
  }
  if (change.change_type === "SPLIT_MODULE") {
    return `${change.old_file} split across files`;
  }
  return `${change.symbol_name}: ${change.old_file} -> ${change.new_file}`;
}

function crossFileDescription(change: CrossFileChange): string {
  if (change.change_type === "SPLIT_MODULE") {
    return change.new_file;
  }
  return `${change.change_type} (${Math.round((change.confidence ?? 1) * 100)}%)`;
}

function singleTargetPath(change: CrossFileChange): string | undefined {
  if (change.change_type === "SPLIT_MODULE" || !change.new_file || change.new_file.includes(",")) {
    return undefined;
  }
  return change.new_file;
}

function groupEntryKind(kind: string): ReviewEntryKind | undefined {
  if (kind === "asset") {
    return "asset";
  }
  if (kind === "MOVED_CODE") {
    return "moved-code";
  }
  if (kind === "REFACTORING") {
    return "refactoring";
  }
  if (kind === "MEANINGFUL_CHANGE") {
    return "meaningful";
  }
  if (kind === "IGNORED_STYLE") {
    return "ignored-style";
  }
  if (kind === "NOISE_SUPPRESSED") {
    return "noise-suppressed";
  }
  return undefined;
}

function representativeChangeForGroup(
  group: ChangeGroup,
  changes: SemanticChange[],
): SemanticChange | undefined {
  for (const index of group.raw_change_indices ?? []) {
    if (!Number.isInteger(index) || index < 0 || index >= changes.length) {
      continue;
    }
    const change = changes[index];
    if (reviewTargetForChange(change)) {
      return change;
    }
  }
  return undefined;
}

function groupLabel(group: ChangeGroup): string {
  const labelPair = groupLabelPair(group);
  if (group.kind === "asset") {
    return `Image asset: ${labelPair.newLabel ?? labelPair.oldLabel ?? "changed image"}`;
  }
  if (group.kind === "MOVED_CODE") {
    return `Moved code: ${labelPair.newLabel ?? labelPair.oldLabel ?? "code"}`;
  }
  if (group.kind === "REFACTORING") {
    const kind = humanizeConstant(group.refactoring_kind ?? "REFACTORING");
    return labelPair.oldLabel && labelPair.newLabel
      ? `${kind}: ${labelPair.oldLabel} -> ${labelPair.newLabel}`
      : kind;
  }
  if (group.kind === "MEANINGFUL_CHANGE") {
    if (group.rule_id === "refinement.moved_entity_content_changed") {
      return `Moved and edited: ${labelPair.newLabel ?? labelPair.oldLabel ?? "code"}`;
    }
    return labelPair.oldLabel && labelPair.newLabel
      ? `Meaningful change: ${labelPair.oldLabel} -> ${labelPair.newLabel}`
      : "Meaningful change";
  }
  if (group.kind === "IGNORED_STYLE") {
    return "Ignored style changes";
  }
  if (group.kind === "NOISE_SUPPRESSED") {
    const count = suppressedCount(group);
    return count ? `Suppressed ${count} noisy changes` : "Suppressed review noise";
  }
  return humanizeConstant(group.kind);
}

function isImageLikePath(relativePath: string): boolean {
  return /\.(png|jpe?g|webp)$/iu.test(relativePath);
}

function groupDescription(group: ChangeGroup): string | undefined {
  if (group.kind === "asset") {
    const provider = group.metadata?.asset_provider;
    return typeof provider === "string" ? `${provider} asset review` : "asset review";
  }
  if (group.kind === "NOISE_SUPPRESSED") {
    const rule = group.rule_id;
    const count = suppressedCount(group);
    if (rule && count) {
      return `${rule} (${count} hidden)`;
    }
  }
  if (group.kind === "IGNORED_STYLE" && group.rule_id) {
    return group.rule_id;
  }
  if (group.confidence !== undefined && group.rule_id) {
    return `${group.rule_id} (${Math.round(group.confidence * 100)}%)`;
  }
  return group.rule_id;
}

function groupLabelPair(group: ChangeGroup): {
  oldLabel?: string;
  newLabel?: string;
} {
  return {
    oldLabel: firstUsefulLabel(group.old_labels),
    newLabel: firstUsefulLabel(group.new_labels),
  };
}

function firstUsefulLabel(labels: string[] | undefined): string | undefined {
  return labels?.find((label) => label.trim().length > 0);
}

function suppressedCount(group: ChangeGroup): number | undefined {
  const value = group.metadata?.suppressed_count;
  if (typeof value === "number" && Number.isFinite(value) && value > 0) {
    return value;
  }
  const rawCount = group.raw_change_indices?.length ?? 0;
  return rawCount > 0 ? rawCount : undefined;
}

function humanizeConstant(value: string): string {
  return value
    .toLowerCase()
    .split("_")
    .filter(Boolean)
    .map((part) => `${part[0]?.toUpperCase() ?? ""}${part.slice(1)}`)
    .join(" ");
}

function reviewEntryForSchema(diff: SemanticDiff | undefined): ReviewEntry | undefined {
  const schema = schemaStatus(diff);
  if (!schema) {
    return undefined;
  }
  return {
    kind: "schema-status",
    label: schemaEntryLabel(schema),
    description: schemaEntryDescription(schema),
    severity: schema.available ? "info" : "warning",
    schema,
  };
}

function schemaStatus(diff: SemanticDiff | undefined): SchemaStatusMetadata | undefined {
  const schema = diff?.metadata?.schema;
  return schema?.detected ? schema : undefined;
}

function schemaEntryLabel(schema: SchemaStatusMetadata): string {
  const provider = schemaProviderLabel(schema.provider_id);
  if (schema.available) {
    return `Schema used: ${provider}`;
  }
  if (schema.status === "no_raw_schema") {
    return `Schema detected but unavailable: ${provider}`;
  }
  if (schema.status === "cache_miss" || schema.status === "cache_stale") {
    return `Schema detected but cache missing: ${provider}`;
  }
  if (schema.status === "disabled") {
    return `Schema detected but disabled: ${provider}`;
  }
  return `Schema detected but unavailable: ${provider}`;
}

function schemaEntryDescription(schema: SchemaStatusMetadata): string | undefined {
  if (schema.available) {
    const count = schema.identity_fields?.length ?? 0;
    return count > 0 ? plural(count, "identity hint") : schemaStatusLabel(schema.status);
  }
  if (schema.status === "no_raw_schema") {
    return "no raw schema available";
  }
  return schemaStatusLabel(schema.status);
}

function schemaProviderLabel(providerId: string | undefined): string {
  if (!providerId) {
    return "schema";
  }
  if (providerId === "embedded") {
    return "declared schema";
  }
  if (providerId === "databricks:bundle") {
    return "Databricks bundle";
  }
  if (providerId === "adf:no_raw_schema") {
    return "ADF raw source";
  }
  if (providerId.startsWith("dbt:")) {
    const rawKey = providerId.slice(4);
    const key = rawKey.startsWith("dbt_") ? rawKey.slice(4) : rawKey;
    return `dbt ${humanizeConstant(key).toLowerCase()}`;
  }
  return humanizeConstant(providerId.replace(/[:.-]/gu, "_"));
}

function schemaStatusLabel(status: string | undefined): string | undefined {
  if (!status) {
    return undefined;
  }
  return humanizeConstant(status);
}

function schemaTooltipLine(diff: SemanticDiff | undefined): string | undefined {
  const schema = schemaStatus(diff);
  if (!schema) {
    return undefined;
  }
  const provider = schemaProviderLabel(schema.provider_id);
  const status = schemaStatusLabel(schema.status);
  if (schema.available) {
    return `Schema: ${provider}${status ? ` (${status.toLowerCase()})` : ""}`;
  }
  if (schema.status === "no_raw_schema") {
    return `Schema: ${provider} detected, no raw schema available`;
  }
  return `Schema: ${provider} detected${status ? `, ${status.toLowerCase()}` : ""}`;
}

export function schemaCompactDescription(diff: SemanticDiff | undefined): string | undefined {
  const schema = schemaStatus(diff);
  if (!schema) {
    return undefined;
  }
  const provider = schemaProviderLabel(schema.provider_id);
  if (schema.available) {
    return `${provider} schema`;
  }
  if (schema.status === "no_raw_schema") {
    return `${provider} schema unavailable`;
  }
  return `${provider} schema missing`;
}

export function tooltipForReviewFile(file: ReviewFile): string {
  const lines = [file.relativePath];
  if (file.status === "pending") {
    lines.push(file.pendingMessage ?? "Queued for semantic review");
    return lines.join("\n");
  }
  if (file.status === "skipped") {
    lines.push(file.skippedReason ?? "Skipped");
    return lines.join("\n");
  }
  if (file.status === "error") {
    lines.push(file.error ?? "Diff failed");
    return lines.join("\n");
  }

  const diff = file.diff;
  if (diff?.language) {
    lines.push(`Language: ${diff.language}`);
  }
  const lifecycle = fileLifecycle(diff);
  if (lifecycle === "added") {
    lines.push("New file");
  }
  if (lifecycle === "deleted") {
    lines.push("Deleted file");
  }
  const schemaLine = schemaTooltipLine(diff);
  if (schemaLine) {
    lines.push(schemaLine);
  }
  const summary = summarizeReview([file]);
  const groupCounts = reviewGroupCounts(diff);
  const rawCount = diff?.changes?.length ?? 0;
  if (summary.guardrailCount > 0) {
    lines.push(plural(summary.guardrailCount, "guardrail"));
  }
  if (groupCounts.review > 0) {
    lines.push(plural(groupCounts.review, "review group"));
  }
  if (groupCounts.suppressedNoise > 0) {
    lines.push(plural(groupCounts.suppressedNoise, "suppressed-noise group"));
  }
  if (rawCount > 0) {
    lines.push(plural(rawCount, "raw change"));
  }
  if (isStyleOnlyReviewDiff(diff)) {
    lines.push("Style-only changes");
  }
  if (summary.cleanCount > 0) {
    lines.push("No semantic changes");
  }
  return lines.join("\n");
}

export function tooltipForReviewEntry(entry: ReviewEntry): string {
  if (entry.schema) {
    return tooltipForSchemaEntry(entry.schema, entry.label);
  }
  if (entry.kind === "raw-evidence") {
    return [
      entry.label,
      entry.description,
      entry.evidence?.length ? `Evidence: ${plural(entry.evidence.length, "raw change")}` : undefined,
    ].filter(isDefined).join("\n");
  }
  if (entry.group) {
    return tooltipForGroupEntry(entry);
  }
  if (entry.change) {
    return tooltipForChangeEntry(entry);
  }
  if (entry.violation) {
    return [
      entry.label,
      `Guardrail: ${entry.violation.rule_id}`,
      `Severity: ${entry.violation.severity}`,
      entry.violation.semantic_path ? `Path: ${entry.violation.semantic_path}` : undefined,
      formatTarget(entry.position, entry.positionSide),
    ].filter(isDefined).join("\n");
  }
  return [entry.label, entry.description].filter(isDefined).join("\n");
}

function tooltipForSchemaEntry(schema: SchemaStatusMetadata, label: string): string {
  return [
    label,
    schema.provider_id ? `Provider: ${schema.provider_id}` : undefined,
    schema.status ? `Status: ${schema.status}` : undefined,
    schema.available !== undefined ? `Available: ${schema.available ? "yes" : "no"}` : undefined,
    schema.identity_fields?.length
      ? `Identity hints: ${schema.identity_fields.join(", ")}`
      : undefined,
    schema.source_url ? `Source: ${schema.source_url}` : undefined,
    schema.error ? `Error: ${schema.error}` : undefined,
  ].filter(isDefined).join("\n");
}

function tooltipForGroupEntry(entry: ReviewEntry): string {
  const group = entry.group;
  if (!group) {
    return entry.label;
  }
  const labelPair = groupLabelPair(group);
  return [
    entry.label,
    `Kind: ${group.kind}`,
    group.refactoring_kind ? `Refactoring: ${humanizeConstant(group.refactoring_kind)}` : undefined,
    group.rule_id ? `Rule: ${group.rule_id}` : undefined,
    group.confidence !== undefined ? `Confidence: ${Math.round(group.confidence * 100)}%` : undefined,
    labelPair.oldLabel ? `Old label: ${labelPair.oldLabel}` : undefined,
    labelPair.newLabel ? `New label: ${labelPair.newLabel}` : undefined,
    entry.evidence?.length ? `Evidence: ${plural(entry.evidence.length, "raw change")}` : undefined,
    formatTarget(entry.position, entry.positionSide),
  ].filter(isDefined).join("\n");
}

function tooltipForChangeEntry(entry: ReviewEntry): string {
  const change = entry.change;
  if (!change) {
    return entry.label;
  }
  return [
    entry.label,
    `Change: ${change.change_type}`,
    change.refactoring_kind ? `Refactoring: ${humanizeConstant(change.refactoring_kind)}` : undefined,
    entry.positionSide ? `Side: ${entry.positionSide}` : undefined,
    formatTarget(entry.position, entry.positionSide),
    nodeSummary("Old node", change.old_node),
    nodeSummary("New node", change.new_node),
    change.text_diff ? `Text diff: ${change.text_diff}` : undefined,
  ].filter(isDefined).join("\n");
}

function nodeSummary(prefix: string, node: SemanticChange["old_node"]): string | undefined {
  if (!node) {
    return undefined;
  }
  const bits = [node.node_type, node.label].filter(isDefined).join(" ");
  return bits ? `${prefix}: ${bits}` : undefined;
}

function formatTarget(
  position: NodePosition | null | undefined,
  side: SemanticChangeTargetSide | undefined,
): string | undefined {
  if (!position) {
    return undefined;
  }
  const target = side ? `${side} ` : "";
  return `Target: ${target}line ${position.start_line + 1}`;
}

function plural(count: number, noun: string): string {
  return `${count} ${noun}${count === 1 ? "" : "s"}`;
}

function isDefined<T>(value: T | undefined | null): value is T {
  return value !== undefined && value !== null && value !== "";
}

export function reviewGroupCounts(diff: SemanticDiff | undefined): {
  review: number;
  suppressedNoise: number;
} {
  let review = 0;
  let suppressedNoise = 0;
  for (const group of reviewGroupsForLifecycle(diff)) {
    if (group.kind === "NOISE_SUPPRESSED") {
      suppressedNoise += 1;
      continue;
    }
    if (groupEntryKind(group.kind)) {
      review += 1;
    }
  }
  return { review, suppressedNoise };
}
