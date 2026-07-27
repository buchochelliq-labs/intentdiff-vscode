import * as path from "path";
import * as vscode from "vscode";
import {
  reviewEntriesForFile,
  reviewEntriesForCrossFileChanges,
  groupReviewFiles,
  sortReviewFiles,
  reviewGroupCounts,
  normalizeReviewFileGroupingMode,
  schemaCompactDescription,
  summarizeReview,
  summarizeReviewWithCrossFile,
  tooltipForReviewEntry,
  tooltipForReviewFile,
  type ReviewCrossFileEntry,
  type ReviewEntry,
  type ReviewFile,
  type ReviewFileGroup,
  type ReviewFileGroupingMode,
  type ReviewSummary,
} from "./reviewModel";
import type { SemanticChange } from "./types";

export type ReviewDiffSurface = "native" | "panel";

export type ReviewTreeNode =
  | { kind: "root"; folderName: string; folderUri: string }
  | { kind: "fileGroup"; folderUri: string; group: ReviewFileGroup }
  | { kind: "crossEntry"; folderUri: string; entry: ReviewCrossFileEntry }
  | { kind: "file"; file: ReviewFile }
  | { kind: "entry"; file: ReviewFile; entry: ReviewEntry }
  | { kind: "evidence"; file: ReviewFile; parent: ReviewEntry; entry: ReviewEntry };

export interface OpenReviewPayload {
  folderUri: string;
  relativePath?: string;
  position?: {
    start_line: number;
    start_col: number;
    end_line: number;
    end_col: number;
  } | null;
  positionSide?: ReviewEntry["positionSide"];
  change?: SemanticChange;
  crossFileChange?: ReviewCrossFileEntry["change"];
}

export class SemanticReviewTreeProvider implements vscode.TreeDataProvider<ReviewTreeNode> {
  private readonly changeEmitter = new vscode.EventEmitter<ReviewTreeNode | undefined>();
  private files: ReviewFile[] = [];
  private crossFileEntries: ReviewCrossFileEntry[] = [];
  private rootFolders = new Map<string, string>();
  private groupingMode: ReviewFileGroupingMode = "auto";
  private diffSurface: ReviewDiffSurface = "native";
  readonly onDidChangeTreeData = this.changeEmitter.event;

  dispose(): void {
    this.changeEmitter.dispose();
  }

  setFiles(files: ReviewFile[]): void {
    this.files = sortReviewFiles(files);
    this.crossFileEntries = [];
    this.rootFolders = rootsForFiles(files);
    this.changeEmitter.fire(undefined);
  }

  setReview(
    files: ReviewFile[],
    crossFileEntries: ReviewCrossFileEntry[],
    rootFolders: Map<string, string> = rootsForFiles(files),
  ): void {
    this.files = sortReviewFiles(files);
    this.crossFileEntries = crossFileEntries;
    this.rootFolders = rootFolders;
    this.changeEmitter.fire(undefined);
  }

  clear(): void {
    this.files = [];
    this.crossFileEntries = [];
    this.rootFolders.clear();
    this.changeEmitter.fire(undefined);
  }

  setGroupingMode(mode: ReviewFileGroupingMode): void {
    this.groupingMode = normalizeReviewFileGroupingMode(mode);
    this.changeEmitter.fire(undefined);
  }

  setDiffSurface(surface: ReviewDiffSurface): void {
    this.diffSurface = surface === "panel" ? "panel" : "native";
    this.changeEmitter.fire(undefined);
  }

  /**
   * The command a tree node fires to open its diff. Honours the
   * `intentdiff.review.diffSurface` setting: "native" opens VS Code's native
   * diff editor at the representative line; "panel" opens the rich semantic
   * review panel. Image assets and asset entries always use the panel.
   */
  private openDiffCommand(
    payloadArgs: OpenReviewPayload,
    panelArg: ReviewTreeNode,
    file: ReviewFile,
    forcePanel = false,
  ): vscode.Command {
    if (forcePanel || this.diffSurface === "panel" || isImageReviewFile(file)) {
      return {
        command: "intentdiff.openReviewPanel",
        title: "Open IntentDiff Review",
        arguments: [panelArg],
      };
    }
    return {
      command: "intentdiff.openSemanticDiff",
      title: "Open Semantic Change",
      arguments: [payloadArgs],
    };
  }

  summary(): ReviewSummary {
    return summarizeReviewWithCrossFile(
      this.files,
      this.crossFileEntries.map((entry) => entry.change),
    );
  }

  revealFile(relativePath: string): ReviewTreeNode | undefined {
    const file = this.files.find((item) => item.relativePath === relativePath);
    return file ? { kind: "file", file } : undefined;
  }

  getTreeItem(element: ReviewTreeNode): vscode.TreeItem {
    if (element.kind === "root") {
      const item = new vscode.TreeItem(element.folderName, vscode.TreeItemCollapsibleState.Expanded);
      item.contextValue = "intentdiffReviewRoot";
      item.iconPath = new vscode.ThemeIcon("repo", themeColor("intentdiff.semanticChanges.root"));
      return item;
    }
    if (element.kind === "file") {
      const entries = reviewEntriesForFile(element.file);
      const item = new vscode.TreeItem(
        element.file.relativePath,
        entries.length > 0
          ? vscode.TreeItemCollapsibleState.Expanded
          : vscode.TreeItemCollapsibleState.None,
      );
      item.description = fileDescription(element.file);
      item.tooltip = tooltipForReviewFile(element.file);
      item.contextValue = "intentdiffReviewFile";
      item.iconPath = fileIcon(element.file);
      if (!isReviewStatusFile(element.file)) {
        item.resourceUri = vscode.Uri.file(
          path.join(vscode.Uri.parse(element.file.folderUri).fsPath, element.file.relativePath),
        );
        item.command = this.openDiffCommand(payloadFor(element.file), element, element.file);
      }
      return item;
    }
    if (element.kind === "fileGroup") {
      const item = new vscode.TreeItem(element.group.label, vscode.TreeItemCollapsibleState.Expanded);
      item.description = element.group.description;
      item.tooltip = tooltipForReviewFileGroup(element.group);
      item.contextValue = "intentdiffReviewFileGroup";
      item.iconPath = fileGroupIcon(element.group);
      return item;
    }
    if (element.kind === "crossEntry") {
      const item = new vscode.TreeItem(element.entry.label, vscode.TreeItemCollapsibleState.None);
      item.description = element.entry.description;
      item.tooltip = [element.entry.label, element.entry.description].filter(Boolean).join("\n");
      item.contextValue = element.entry.relativePath
        ? "intentdiffReviewCrossFile"
        : "intentdiffReviewCrossFile.summary";
      item.iconPath = new vscode.ThemeIcon(
        element.entry.relativePath ? "symbol-method" : "symbol-namespace",
        themeColor("intentdiff.semanticChanges.crossFile"),
      );
      if (element.entry.relativePath) {
        item.command = {
          command: "intentdiff.openSemanticDiff",
          title: "Open Semantic Change",
          arguments: [{
            folderUri: element.folderUri,
            relativePath: element.entry.relativePath,
            position: element.entry.change.new_position,
            positionSide: "modified",
            crossFileChange: element.entry.change,
          }],
        };
      }
      return item;
    }
    if (element.kind === "evidence") {
      const item = new vscode.TreeItem(treeEntryLabel(element.entry, true), vscode.TreeItemCollapsibleState.None);
      item.description = treeEntryDescription(element.entry, true);
      item.tooltip = tooltipForReviewEntry(element.entry);
      item.contextValue = "intentdiffReviewEntry.evidence";
      item.iconPath = entryIcon(element.entry);
      if (!isReviewStatusFile(element.file)) {
        // "native" opens the native diff at the representative line; "panel"
        // opens the semantic review panel (image assets always use the panel).
        item.command = this.openDiffCommand(payloadFor(element.file, element.entry), element, element.file);
      }
      return item;
    }
    const item = new vscode.TreeItem(
      treeEntryLabel(element.entry),
      collapsibleStateForEntry(element.entry),
    );
    item.description = treeEntryDescription(element.entry);
    item.tooltip = tooltipForReviewEntry(element.entry);
    item.contextValue = `intentdiffReviewEntry.${element.entry.kind}`;
    item.iconPath = entryIcon(element.entry);
    if (!isReviewStatusFile(element.file)) {
      // Intent groups open the diff at their representative line; "panel" mode
      // (and asset entries) open the semantic review panel instead.
      item.command = this.openDiffCommand(
        payloadFor(element.file, element.entry),
        element,
        element.file,
        element.entry.kind === "asset",
      );
    }
    return item;
  }

  getChildren(element?: ReviewTreeNode): ReviewTreeNode[] {
    if (!element) {
      if (this.rootFolders.size === 1) {
        const [folderUri] = this.rootFolders.keys();
        return this.childrenForRoot(folderUri);
      }
      return [...this.rootFolders.entries()].map(([folderUri, folderName]) => ({
        kind: "root",
        folderUri,
        folderName,
      }));
    }
    if (element.kind === "root") {
      return this.childrenForRoot(element.folderUri);
    }
    if (element.kind === "fileGroup") {
      return element.group.files.map((file) => ({
        kind: "file",
        file,
      }));
    }
    if (element.kind === "file") {
      return reviewEntriesForFile(element.file).map((entry) => ({
        kind: "entry",
        file: element.file,
        entry,
      }));
    }
    if (element.kind === "crossEntry") {
      return [];
    }
    if (element.kind === "entry") {
      return (element.entry.evidence ?? []).map((entry) => ({
        kind: "evidence",
        file: element.file,
        parent: element.entry,
        entry,
      }));
    }
    return [];
  }

  private childrenForRoot(folderUri: string): ReviewTreeNode[] {
    const files = this.files.filter((file) => file.folderUri === folderUri);
    const guardrailFiles = files.filter((file) => (file.diff?.guardrail_violations?.length ?? 0) > 0);
    const otherFiles = files.filter((file) => (file.diff?.guardrail_violations?.length ?? 0) === 0);
    const fileGroups = groupReviewFiles(otherFiles, this.groupingMode);
    return [
      ...guardrailFiles.map((file) => ({ kind: "file" as const, file })),
      ...this.crossFileEntries
        .filter((entry) => entry.folderUri === folderUri)
        .map((entry) => ({
          kind: "crossEntry" as const,
          folderUri,
          entry,
        })),
      ...(fileGroups.length > 0
        ? fileGroups.map((group) => ({ kind: "fileGroup" as const, folderUri, group }))
        : otherFiles.map((file) => ({ kind: "file" as const, file }))),
    ];
  }
}

export { reviewEntriesForCrossFileChanges };

function rootsForFiles(files: ReviewFile[]): Map<string, string> {
  const roots = new Map<string, string>();
  for (const file of files) {
    roots.set(file.folderUri, file.folderName);
  }
  return roots;
}

function payloadFor(file: ReviewFile, entry?: ReviewEntry): OpenReviewPayload {
  return {
    folderUri: file.folderUri,
    relativePath: file.relativePath,
    position: entry?.position,
    positionSide: entry?.positionSide,
    change: entry?.change,
  };
}

function isReviewStatusFile(file: ReviewFile): boolean {
  return file.relativePath === ".intentdiff-review";
}

function isImageReviewFile(file: ReviewFile): boolean {
  return /\.(png|jpe?g|webp)$/iu.test(file.relativePath)
    || file.diff?.metadata?.asset_diff !== undefined;
}

function fileDescription(file: ReviewFile): string {
  if (file.status === "skipped") {
    return "skipped";
  }
  if (file.status === "error") {
    return "error";
  }
  if (file.status === "pending") {
    return "queued";
  }
  const summary = summarizeReview([file]);
  return compactFileDescription(file, summary);
}

function compactFileDescription(file: ReviewFile, summary: ReviewSummary): string {
  const counts = reviewGroupCounts(file.diff);
  const rawCount = file.diff?.changes?.length ?? 0;
  const parts: string[] = [];
  if (file.diff?.language) {
    parts.push(file.diff.language);
  }
  if (summary.guardrailCount > 0) {
    parts.push(`${summary.guardrailCount} guardrail${summary.guardrailCount === 1 ? "" : "s"}`);
  }
  if (counts.review > 0) {
    parts.push(`${counts.review} group${counts.review === 1 ? "" : "s"}`);
  }
  if (rawCount > 0) {
    parts.push(`${rawCount} raw`);
  }
  if (counts.suppressedNoise > 0) {
    parts.push(`${counts.suppressedNoise} suppressed`);
  }
  const schema = schemaCompactDescription(file.diff);
  if (schema) {
    parts.push(schema);
  }
  if (parts.length > 0) {
    return parts.join(" | ");
  }
  if (summary.styleOnlyCount > 0) {
    return "style-only";
  }
  return "clean";
}

function fileIcon(file: ReviewFile): vscode.ThemeIcon {
  if ((file.diff?.guardrail_violations?.length ?? 0) > 0 || file.status === "error") {
    return new vscode.ThemeIcon("shield", themeColor("intentdiff.semanticChanges.guardrail"));
  }
  if ((file.diff?.change_groups?.length ?? 0) > 0) {
    return new vscode.ThemeIcon("diff", themeColor("intentdiff.semanticChanges.fileWithGroups"));
  }
  if ((file.diff?.changes?.length ?? 0) > 0) {
    return new vscode.ThemeIcon("diff", themeColor("intentdiff.semanticChanges.rawChange"));
  }
  if (file.status === "skipped") {
    return new vscode.ThemeIcon("circle-slash", themeColor("intentdiff.semanticChanges.muted"));
  }
  return new vscode.ThemeIcon("check", themeColor("intentdiff.semanticChanges.ignoredStyle"));
}

function fileGroupIcon(group: ReviewFileGroup): vscode.ThemeIcon {
  if (group.schema) {
    return new vscode.ThemeIcon("database", themeColor("intentdiff.semanticChanges.schemaStatus"));
  }
  return new vscode.ThemeIcon("folder-library", themeColor("intentdiff.semanticChanges.root"));
}

function tooltipForReviewFileGroup(group: ReviewFileGroup): string {
  return [
    group.label,
    group.description,
    group.language ? `Language: ${group.language}` : undefined,
    group.schema ? `Schema: ${group.schema}` : undefined,
  ].filter((item): item is string => !!item).join("\n");
}

function treeEntryLabel(entry: ReviewEntry, evidenceChild = false): string {
  if (evidenceChild) {
    return `Evidence: ${entry.label}`;
  }
  if (entry.kind === "raw-evidence") {
    return "Ungrouped raw evidence";
  }
  return entry.label;
}

function treeEntryDescription(entry: ReviewEntry, evidenceChild = false): string | undefined {
  if (entry.kind === "guardrail") {
    const protectedLabel = entry.violation?.severity === "immutable" ? "protected" : "guardrail";
    return [protectedLabel, entry.description].filter(Boolean).join(" | ");
  }
  if (entry.kind === "schema-status") {
    return ["schema", entry.description].filter(Boolean).join(" | ");
  }
  if (entry.kind === "asset") {
    return ["asset", entry.description].filter(Boolean).join(" | ");
  }
  if (entry.kind === "raw-evidence") {
    return ["ungrouped", entry.description].filter(Boolean).join(" | ");
  }
  if (entry.kind === "noise-suppressed") {
    return ["suppressed", entry.description].filter(Boolean).join(" | ");
  }
  if (evidenceChild) {
    return ["raw", entry.description].filter(Boolean).join(" | ");
  }
  return entry.description;
}

function entryIcon(entry: ReviewEntry): vscode.ThemeIcon {
  if (entry.kind === "guardrail") {
    if (entry.violation?.severity === "immutable") {
      return new vscode.ThemeIcon("circle-slash", themeColor("intentdiff.semanticChanges.guardrail"));
    }
    return new vscode.ThemeIcon(
      entry.severity === "error" ? "error" : "warning",
      themeColor("intentdiff.semanticChanges.guardrail"),
    );
  }
  if (entry.kind === "schema-status") {
    return new vscode.ThemeIcon("database", themeColor("intentdiff.semanticChanges.schemaStatus"));
  }
  if (entry.kind === "asset") {
    return new vscode.ThemeIcon("file-media", themeColor("intentdiff.semanticChanges.meaningful"));
  }
  if (entry.kind === "refactoring") {
    return new vscode.ThemeIcon("symbol-variable", themeColor("intentdiff.semanticChanges.refactoring"));
  }
  if (entry.kind === "moved-code") {
    return new vscode.ThemeIcon("diff-renamed", themeColor("intentdiff.semanticChanges.movedCode"));
  }
  if (entry.kind === "meaningful") {
    return new vscode.ThemeIcon("sparkle", themeColor("intentdiff.semanticChanges.meaningful"));
  }
  if (entry.kind === "ignored-style") {
    return new vscode.ThemeIcon("eye-closed", themeColor("intentdiff.semanticChanges.ignoredStyle"));
  }
  if (entry.kind === "noise-suppressed") {
    return new vscode.ThemeIcon("eye-closed", themeColor("intentdiff.semanticChanges.noiseSuppressed"));
  }
  if (entry.kind === "raw-evidence") {
    return new vscode.ThemeIcon("list-tree", themeColor("intentdiff.semanticChanges.rawChange"));
  }
  if (entry.kind === "change" || entry.kind === "evidence") {
    return rawChangeIcon(entry);
  }
  if (entry.kind === "skipped") {
    return new vscode.ThemeIcon("circle-slash", themeColor("intentdiff.semanticChanges.muted"));
  }
  if (entry.kind === "error") {
    return new vscode.ThemeIcon("error", themeColor("intentdiff.semanticChanges.guardrail"));
  }
  return new vscode.ThemeIcon("check", themeColor("intentdiff.semanticChanges.ignoredStyle"));
}

function themeColor(id: string): vscode.ThemeColor {
  return new vscode.ThemeColor(id);
}

function collapsibleStateForEntry(entry: ReviewEntry): vscode.TreeItemCollapsibleState {
  const evidenceCount = entry.evidence?.length ?? 0;
  if (evidenceCount === 0) {
    return vscode.TreeItemCollapsibleState.None;
  }
  if (entry.kind === "raw-evidence" || entry.kind === "noise-suppressed") {
    return vscode.TreeItemCollapsibleState.Collapsed;
  }
  if (evidenceCount <= 3) {
    return vscode.TreeItemCollapsibleState.Expanded;
  }
  return vscode.TreeItemCollapsibleState.Collapsed;
}

function rawChangeIcon(entry: ReviewEntry): vscode.ThemeIcon {
  const changeType = entry.change?.change_type;
  if (changeType === "ADDITION") {
    return new vscode.ThemeIcon("diff-added", themeColor("intentdiff.semanticChanges.addition"));
  }
  if (changeType === "DELETION") {
    return new vscode.ThemeIcon("diff-removed", themeColor("intentdiff.semanticChanges.deletion"));
  }
  if (changeType === "MOVE") {
    return new vscode.ThemeIcon("diff-renamed", themeColor("intentdiff.semanticChanges.movedCode"));
  }
  if (changeType === "REFACTORING") {
    return new vscode.ThemeIcon("symbol-method", themeColor("intentdiff.semanticChanges.refactoring"));
  }
  if (changeType === "REORDER") {
    return new vscode.ThemeIcon("list-ordered", themeColor("intentdiff.semanticChanges.reorder"));
  }
  if (changeType === "MODIFICATION") {
    return new vscode.ThemeIcon("diff-modified", themeColor("intentdiff.semanticChanges.modification"));
  }
  return new vscode.ThemeIcon("diff-modified", themeColor("intentdiff.semanticChanges.rawChange"));
}
