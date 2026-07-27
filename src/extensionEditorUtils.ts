// Editor/URI/decoration utilities for the extension controller.
import * as path from "path";
import { execFile } from "child_process";
import * as vscode from "vscode";
import { EmptyContentProvider } from "./emptyContentProvider";
import { reviewTargetForChange } from "./mapper";
import type { OpenReviewPayload, ReviewTreeNode } from "./reviewTree";
import type { DecorationLike, DiagnosticLike, SemanticDiff } from "./types";

export function isTextDiffTabInput(value: unknown): value is { original: vscode.Uri; modified: vscode.Uri } {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const candidate = value as { original?: unknown; modified?: unknown };
  return candidate.original instanceof vscode.Uri && candidate.modified instanceof vscode.Uri;
}

export function workspaceFileUriFromGitUri(uri: vscode.Uri): vscode.Uri | undefined {
  const paths = gitUriPathCandidates(uri);
  for (const candidate of paths) {
    const fileUri = fileUriFromGitPath(candidate);
    if (fileUri) {
      return fileUri;
    }
  }
  return undefined;
}

export function gitUriPathCandidates(uri: vscode.Uri): string[] {
  const candidates: string[] = [];
  const add = (value: unknown): void => {
    if (typeof value === "string" && value.length > 0 && !candidates.includes(value)) {
      candidates.push(value);
    }
  };
  for (const raw of [uri.query, safeDecodeURIComponent(uri.query)]) {
    if (!raw) {
      continue;
    }
    try {
      const parsed = JSON.parse(raw) as { path?: unknown; original?: unknown; modified?: unknown };
      add(parsed.path);
      add(parsed.modified);
      add(parsed.original);
    } catch {
      // VS Code Git URIs are not guaranteed to keep a JSON query shape forever.
    }
  }
  add(uri.fsPath);
  add(uri.path);
  return candidates;
}

export function fileUriFromGitPath(candidate: string): vscode.Uri | undefined {
  let normalized = candidate.replaceAll("\\", "/");
  if (/^\/[a-zA-Z]:\//u.test(normalized)) {
    normalized = normalized.slice(1);
  }
  if (/^[a-zA-Z]:\//u.test(normalized) || normalized.startsWith("/")) {
    return vscode.Uri.file(normalized);
  }
  for (const folder of vscode.workspace.workspaceFolders ?? []) {
    const workspaceCandidate = path.join(folder.uri.fsPath, candidate);
    const relative = path.relative(folder.uri.fsPath, workspaceCandidate);
    if (!relative.startsWith("..") && !path.isAbsolute(relative)) {
      return vscode.Uri.file(workspaceCandidate);
    }
  }
  return undefined;
}

export function safeDecodeURIComponent(value: string): string | undefined {
  try {
    return decodeURIComponent(value);
  } catch {
    return undefined;
  }
}

export function applyGitIndexPatch(cwd: string, patch: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = execFile(
      "git",
      ["-c", `safe.directory=${cwd}`, "apply", "--cached", "--unidiff-zero", "-"],
      { cwd, windowsHide: true },
      (error, _stdout, stderr) => {
        if (error) {
          reject(new Error(stderr?.trim() || error.message));
          return;
        }
        resolve();
      },
    );
    child.stdin?.end(patch);
  });
}

export function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function nonNegativeNumber(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : fallback;
}

export function normalizeOpenReviewPayload(
  argument: OpenReviewPayload | ReviewTreeNode | undefined,
): OpenReviewPayload | undefined {
  if (!argument) {
    return undefined;
  }
  if (isReviewTreeNode(argument)) {
    // Both "entry" and "evidence" nodes carry the owning file + a ReviewEntry.
    // Missing "evidence" here made evidence clicks resolve to `undefined`, so the
    // caller fell back to the last-opened diff ("loads the last cached one").
    if (argument.kind === "entry" || argument.kind === "evidence") {
      return normalizeOpenReviewPayload({
        folderUri: argument.file.folderUri,
        relativePath: argument.file.relativePath,
        position: argument.entry.position,
        positionSide: argument.entry.positionSide,
        change: argument.entry.change,
      });
    }
    if (argument.kind === "file") {
      return normalizeOpenReviewPayload({
        folderUri: argument.file.folderUri,
        relativePath: argument.file.relativePath,
      });
    }
    if (argument.kind === "crossEntry") {
      return normalizeOpenReviewPayload({
        folderUri: argument.folderUri,
        relativePath: argument.entry.relativePath,
        position: argument.entry.change.new_position,
        positionSide: "modified",
        crossFileChange: argument.entry.change,
      });
    }
    return undefined;
  }

  const target = argument.change ? reviewTargetForChange(argument.change) : undefined;
  const oldOnlyChange = isOldOnlyChange(argument.change);
  return {
    ...argument,
    position: argument.position ?? target?.position ?? null,
    positionSide: oldOnlyChange ? "base" : argument.positionSide ?? target?.side,
  };
}

export function isReviewTreeNode(value: OpenReviewPayload | ReviewTreeNode): value is ReviewTreeNode {
  return typeof (value as ReviewTreeNode).kind === "string";
}

export function isOldOnlyChange(change: OpenReviewPayload["change"]): boolean {
  return change?.old_node?.position !== undefined && change.new_node?.position === undefined;
}

export function semanticLineHintDecorations(
  originalLineMap: Map<number, number>,
  side: "old" | "new",
): vscode.DecorationOptions[] {
  return [...originalLineMap.entries()]
    .sort(([left], [right]) => left - right)
    .map(([generatedLine, originalLine]) => ({
      range: new vscode.Range(generatedLine, 0, generatedLine, 0),
      renderOptions: {
        before: {
          contentText: `${side} L${originalLine + 1}`,
        },
      },
    }));
}

export function toVsDiagnostic(diagnostic: DiagnosticLike): vscode.Diagnostic {
  const result = new vscode.Diagnostic(
    toRange(diagnostic.position),
    diagnostic.message,
    toSeverity(diagnostic.severity),
  );
  result.source = diagnostic.source;
  result.code = diagnostic.code;
  return result;
}

export function toSeverity(severity: DiagnosticLike["severity"]): vscode.DiagnosticSeverity {
  if (severity === "error") {
    return vscode.DiagnosticSeverity.Error;
  }
  if (severity === "warning") {
    return vscode.DiagnosticSeverity.Warning;
  }
  return vscode.DiagnosticSeverity.Information;
}

export function toDecorationOption(decoration: DecorationLike): vscode.DecorationOptions {
  const option: vscode.DecorationOptions = {
    range: toRange(decoration.position),
    hoverMessage: decoration.message,
  };
  if (decoration.kind === "inlineDeletionGap" && decoration.deletedText) {
    option.renderOptions = {
      after: {
        contentText: " ",
      },
    };
  }
  return option;
}

export function toRange(position: DiagnosticLike["position"]): vscode.Range {
  if (!position) {
    return new vscode.Range(0, 0, 0, 1);
  }
  const startLine = Math.max(position.start_line, 0);
  const endLine = Math.max(position.end_line, startLine);
  const startCol = Math.max(position.start_col, 0);
  const endCol = Math.max(position.end_col, startCol);
  return new vscode.Range(
    startLine,
    startCol,
    endLine,
    endCol,
  );
}

export function wordRangeForInlineDeletion(editor: vscode.TextEditor, range: vscode.Range): vscode.Range {
  if (range.start.line >= editor.document.lineCount) {
    return range;
  }
  const line = editor.document.lineAt(range.start.line);
  const start = new vscode.Position(
    range.start.line,
    Math.min(range.start.character, line.text.length),
  );
  const direct = editor.document.getWordRangeAtPosition(start);
  if (direct) {
    return direct;
  }
  if (start.character > 0) {
    const previous = start.translate(0, -1);
    const previousWord = editor.document.getWordRangeAtPosition(previous);
    if (previousWord) {
      return previousWord;
    }
  }
  const endCharacter = Math.min(start.character + 1, line.text.length);
  if (endCharacter > start.character) {
    return new vscode.Range(start, new vscode.Position(start.line, endCharacter));
  }
  return range;
}

export function readFuelSetting(config: vscode.WorkspaceConfiguration): number | string | null {
  const fuel = config.inspect<number | string | null>("fuel");
  if (
    fuel?.globalValue !== undefined
    || fuel?.workspaceValue !== undefined
    || fuel?.workspaceFolderValue !== undefined
    || fuel?.globalLanguageValue !== undefined
    || fuel?.workspaceLanguageValue !== undefined
    || fuel?.workspaceFolderLanguageValue !== undefined
  ) {
    return config.get<number | string | null>("fuel", null);
  }
  return null;
}

export function shouldRevealBaseSide(payload: OpenReviewPayload, diff: SemanticDiff | undefined): boolean {
  if (isOldOnlyChange(payload.change)) {
    return true;
  }
  if (payload.positionSide === "base") {
    return true;
  }
  if (payload.positionSide === "modified" || payload.crossFileChange || !payload.position || !diff) {
    return false;
  }
  return (diff.changes ?? []).some((change) => (
    change.new_node?.position === undefined
    && samePosition(change.old_node?.position, payload.position)
  ));
}

export function samePosition(
  left: DiagnosticLike["position"],
  right: DiagnosticLike["position"],
): boolean {
  return !!left && !!right
    && left.start_line === right.start_line
    && left.start_col === right.start_col
    && left.end_line === right.end_line
    && left.end_col === right.end_col;
}

export async function existingOrEmptyModifiedUri(
  workingUri: vscode.Uri,
  emptyContentProvider: EmptyContentProvider,
  folderUri: string,
  relativePath: string,
): Promise<vscode.Uri> {
  if (await fileUriExists(workingUri)) {
    return workingUri;
  }
  return emptyContentProvider.createUri({ folderUri, relativePath });
}

export async function fileUriExists(uri: vscode.Uri): Promise<boolean> {
  try {
    const stat = await vscode.workspace.fs.stat(uri);
    return (stat.type & vscode.FileType.File) !== 0;
  } catch {
    return false;
  }
}

export async function findVisibleTextEditor(uri: vscode.Uri): Promise<vscode.TextEditor | undefined> {
  const target = uri.toString();
  for (let attempt = 0; attempt < 10; attempt += 1) {
    const editor = vscode.window.visibleTextEditors.find(
      (item) => item.document.uri.toString() === target,
    );
    if (editor) {
      return editor;
    }
    await delay(25);
  }
  return undefined;
}

export function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
