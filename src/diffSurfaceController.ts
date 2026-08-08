// The native diff surfaces (full + semantic-only), extracted from
// PysdController (issue #79 stage 2). Owns the open-diff-context map keyed by
// both editor URIs, the open/reveal flows, and the semantic-only projection
// refresh. Review state, visuals, and editor-context flags stay host-side.
import * as path from "path";
import * as vscode from "vscode";
import { assertSafeRelativePath } from "./baseUri";
import type { BaseContentProvider } from "./baseContentProvider";
import type { EmptyContentProvider } from "./emptyContentProvider";
import {
  delay,
  existingOrEmptyModifiedUri,
  findVisibleTextEditor,
  normalizeOpenReviewPayload,
  semanticLineHintDecorations,
  shouldRevealBaseSide,
  toRange,
} from "./extensionEditorUtils";
import {
  readDiffMode,
  readLiveServerSettings,
  readSemanticOnlyOptions,
  type NativeDiffMode,
} from "./extensionSettings";
import { diffToBaseDecorations, diffToModifiedDecorations, summarizeDiff } from "./mapper";
import { isImageLikePath } from "./reviewAssetDiffs";
import type { ReviewFile } from "./reviewModel";
import type { OpenReviewPayload, ReviewTreeNode } from "./reviewTree";
import { selectionTargetForDocument } from "./selectionRange";
import type { SemanticOnlyContentProvider } from "./semanticOnlyContentProvider";
import { projectDecorations, projectPosition, type SemanticOnlyProjection } from "./semanticOnlyDiff";
import type { DecorationLike, NodePosition, SemanticDiff } from "./types";

export type OpenFileReviewPayload = OpenReviewPayload & { relativePath: string };

export interface OpenedDiffContext {
  payload: OpenFileReviewPayload;
  mode: NativeDiffMode;
  folderUri: string;
  relativePath: string;
  baseUri: vscode.Uri;
  modifiedUri: vscode.Uri;
  diff?: SemanticDiff;
  semanticSessionId?: string;
  semanticSourceBaseUri?: vscode.Uri;
  semanticSourceModifiedUri?: vscode.Uri;
  semanticProjection?: SemanticOnlyProjection;
  lastRevealPayload?: OpenFileReviewPayload;
}

export interface DiffSurfaceHost {
  readonly output: vscode.OutputChannel;
  readonly baseContentProvider: BaseContentProvider;
  readonly emptyContentProvider: EmptyContentProvider;
  readonly semanticOnlyContentProvider: SemanticOnlyContentProvider;
  hideComments(): boolean;
  reviewFileFor(folderUri: string, relativePath: string): ReviewFile | undefined;
  resolvedCommitFor(folderUri: string): string | undefined;
  openReviewPanel(payload: OpenFileReviewPayload): Promise<void>;
  applyDiffVisuals(uri: vscode.Uri, diff: SemanticDiff): void;
  applyBaseDiffVisuals(uri: vscode.Uri, diff: SemanticDiff): void;
  setDecorationsForUri(uri: vscode.Uri, decorations: DecorationLike[]): void;
  setSemanticLineHintsForUri(uri: vscode.Uri, options: vscode.DecorationOptions[]): void;
  /** Editor context keys + lens/inlay refresh after the context map changes. */
  onContextsChanged(): void;
}

export class DiffSurfaceController {
  private readonly openDiffContexts = new Map<string, OpenedDiffContext>();

  constructor(private readonly host: DiffSurfaceHost) {}

  get(uriString: string): OpenedDiffContext | undefined {
    return this.openDiffContexts.get(uriString);
  }

  active(): OpenedDiffContext | undefined {
    const uri = vscode.window.activeTextEditor?.document.uri;
    if (!uri) {
      return undefined;
    }
    return this.openDiffContexts.get(uri.toString());
  }

  forFile(folderUri: string, relativePath: string): OpenedDiffContext | undefined {
    for (const context of this.openDiffContexts.values()) {
      if (context.mode === "full" && context.folderUri === folderUri && context.relativePath === relativePath) {
        return context;
      }
    }
    return undefined;
  }

  clear(): void {
    this.openDiffContexts.clear();
  }

  async open(
    argument: OpenReviewPayload | ReviewTreeNode | undefined,
    modeOverride?: NativeDiffMode,
  ): Promise<void> {
    const payload = normalizeOpenReviewPayload(argument) ?? this.active()?.payload;
    if (!payload) {
      return;
    }
    if (!payload.relativePath) {
      this.host.output.appendLine(JSON.stringify({
        crossFileChange: payload.crossFileChange,
        message: "Cross-file summary has no single target file to open.",
      }, null, 2));
      void vscode.window.showInformationMessage("IntentumDiff: cross-file summary has no single target file.");
      return;
    }
    try {
      assertSafeRelativePath(payload.relativePath);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      void vscode.window.showWarningMessage(`IntentumDiff: cannot open semantic diff: ${message}`);
      return;
    }
    const filePayload: OpenFileReviewPayload = { ...payload, relativePath: payload.relativePath };
    const folderUri = vscode.Uri.parse(filePayload.folderUri);
    const file = this.host.reviewFileFor(filePayload.folderUri, filePayload.relativePath);
    if (file?.status === "skipped" || file?.status === "error") {
      void vscode.window.showInformationMessage(
        `IntentumDiff: ${file.skippedReason ?? file.error ?? "file cannot be opened semantically"}`,
      );
      return;
    }
    if (isImageLikePath(filePayload.relativePath)) {
      this.host.output.appendLine(
        "IntentumDiff: image assets open in the custom review panel; native semantic text diff is not available for binary images.",
      );
      await this.host.openReviewPanel(filePayload);
      return;
    }
    const workingUri = vscode.Uri.file(path.join(folderUri.fsPath, filePayload.relativePath));
    const modifiedUri = await existingOrEmptyModifiedUri(
      workingUri,
      this.host.emptyContentProvider,
      filePayload.folderUri,
      filePayload.relativePath,
    );
    const ref = readLiveServerSettings().ref;
    const baseUri = this.host.baseContentProvider.createUri({
      folderUri: filePayload.folderUri,
      ref,
      relativePath: filePayload.relativePath,
      cacheNonce: this.host.resolvedCommitFor(filePayload.folderUri),
    });
    const title = `${filePayload.relativePath} (IntentumDiff: ${ref} ↔ working tree)`;
    const mode = modeOverride ?? readDiffMode();
    if (mode === "semanticOnly" && file?.diff) {
      await this.openSemanticOnlyNativeDiff(filePayload, file.diff, baseUri, modifiedUri, ref);
      return;
    }
    if (mode === "semanticOnly" && !file?.diff) {
      // The full diff opens regardless, so this is narration of a successful fallback.
      // Status bar, not a notification. (#24)
      vscode.window.setStatusBarMessage("IntentumDiff: showing full diff while the semantic review finishes…", 3000);
    }
    await this.openFullNativeDiff(filePayload, file?.diff, baseUri, modifiedUri, ref, title);
  }

  private async openFullNativeDiff(
    payload: OpenFileReviewPayload,
    diff: SemanticDiff | undefined,
    baseUri: vscode.Uri,
    modifiedUri: vscode.Uri,
    ref: string,
    title: string,
  ): Promise<void> {
    await vscode.commands.executeCommand("vscode.diff", baseUri, modifiedUri, title, { preview: false });
    const context = this.remember({
      payload,
      mode: "full",
      folderUri: payload.folderUri,
      relativePath: payload.relativePath,
      baseUri,
      modifiedUri,
      diff,
    });
    if (diff) {
      this.host.applyDiffVisuals(modifiedUri, diff);
      this.host.applyBaseDiffVisuals(baseUri, diff);
    }
    this.host.output.appendLine(JSON.stringify({
      semanticDiffEditor: {
        mode: "full",
        path: payload.relativePath,
        ref,
        summary: diff ? summarizeDiff(diff) : undefined,
      },
    }, null, 2));
    await this.reveal(context, payload);
  }

  private async openSemanticOnlyNativeDiff(
    payload: OpenFileReviewPayload,
    diff: SemanticDiff,
    baseUri: vscode.Uri,
    modifiedUri: vscode.Uri,
    ref: string,
  ): Promise<void> {
    const [baseDocument, modifiedDocument] = await Promise.all([
      vscode.workspace.openTextDocument(baseUri),
      vscode.workspace.openTextDocument(modifiedUri),
    ]);
    const semanticDocs = this.host.semanticOnlyContentProvider.createDocuments({
      folderUri: payload.folderUri,
      relativePath: payload.relativePath,
      oldText: baseDocument.getText(),
      newText: modifiedDocument.getText(),
      diff,
      options: readSemanticOnlyOptions(this.host.hideComments()),
    });
    const title = `${payload.relativePath} (IntentumDiff semantic-only: ${ref} ↔ working tree)`;
    await vscode.commands.executeCommand(
      "vscode.diff",
      semanticDocs.baseUri,
      semanticDocs.modifiedUri,
      title,
      { preview: false },
    );
    const context = this.remember({
      payload,
      mode: "semanticOnly",
      folderUri: payload.folderUri,
      relativePath: payload.relativePath,
      baseUri: semanticDocs.baseUri,
      modifiedUri: semanticDocs.modifiedUri,
      diff,
      semanticSessionId: semanticDocs.id,
      semanticSourceBaseUri: baseUri,
      semanticSourceModifiedUri: modifiedUri,
      semanticProjection: semanticDocs.projection,
    });
    this.applySemanticOnlyVisuals(context);
    this.host.output.appendLine(JSON.stringify({
      semanticDiffEditor: {
        mode: "semanticOnly",
        path: payload.relativePath,
        ref,
        summary: summarizeDiff(diff),
      },
    }, null, 2));
    await this.reveal(context, payload);
  }

  async reveal(
    context: OpenedDiffContext,
    payload: OpenFileReviewPayload,
  ): Promise<void> {
    const revealPosition = payload.position ?? payload.crossFileChange?.new_position;
    if (!revealPosition) {
      return;
    }
    context.lastRevealPayload = payload;
    const revealBaseSide = shouldRevealBaseSide(payload, context.diff);
    const revealUri = revealBaseSide ? context.baseUri : context.modifiedUri;
    const projected = this.projectRevealPosition(context, revealBaseSide ? "base" : "modified", revealPosition);
    if (!projected.position) {
      this.host.output.appendLine(JSON.stringify({
        semanticDiffReveal: {
          path: context.relativePath,
          targetSide: revealBaseSide ? "base" : "modified",
          mode: context.mode,
          message: "Semantic position is hidden by the current semantic-only filters.",
        },
      }, null, 2));
      return;
    }
    const editor = await findVisibleTextEditor(revealUri);
    if (!editor) {
      this.host.output.appendLine(JSON.stringify({
        semanticDiffReveal: {
          path: context.relativePath,
          targetSide: revealBaseSide ? "base" : "modified",
          mode: context.mode,
          message: "Target diff editor was not visible; selection was not applied.",
        },
      }, null, 2));
      return;
    }
    const target = selectionTargetForDocument(projected.position, editor.document);
    const range = toRange(target.position);
    const selectionEnd = target.shouldSelect ? range.end : range.start;
    editor.selection = new vscode.Selection(range.start, selectionEnd);
    editor.revealRange(range, vscode.TextEditorRevealType.InCenterIfOutsideViewport);
    if (!target.exact || !projected.exact) {
      this.host.output.appendLine(JSON.stringify({
        semanticDiffReveal: {
          path: context.relativePath,
          targetSide: revealBaseSide ? "base" : "modified",
          mode: context.mode,
          message: "Semantic position was outside the target document or virtual projection; revealed nearest valid line instead.",
        },
      }, null, 2));
    }
  }

  private projectRevealPosition(
    context: OpenedDiffContext,
    side: "base" | "modified",
    position: NodePosition,
  ): { position?: NodePosition; exact: boolean } {
    if (context.mode !== "semanticOnly" || !context.semanticProjection) {
      return { position, exact: true };
    }
    const lineMap = side === "base"
      ? context.semanticProjection.baseLineMap
      : context.semanticProjection.modifiedLineMap;
    const projected = projectPosition(position, lineMap);
    return {
      position: projected?.projected,
      exact: projected?.exact === true,
    };
  }

  private applySemanticOnlyVisuals(context: OpenedDiffContext): void {
    if (!context.diff || !context.semanticProjection) {
      return;
    }
    this.host.setDecorationsForUri(
      context.baseUri,
      projectDecorations(diffToBaseDecorations(context.diff), context.semanticProjection.baseLineMap),
    );
    this.host.setDecorationsForUri(
      context.modifiedUri,
      projectDecorations(diffToModifiedDecorations(context.diff), context.semanticProjection.modifiedLineMap),
    );
    this.host.setSemanticLineHintsForUri(
      context.baseUri,
      semanticLineHintDecorations(context.semanticProjection.baseOriginalLineMap, "old"),
    );
    this.host.setSemanticLineHintsForUri(
      context.modifiedUri,
      semanticLineHintDecorations(context.semanticProjection.modifiedOriginalLineMap, "new"),
    );
  }

  async refreshOpenSemanticOnly(): Promise<void> {
    const contexts = this.uniqueOpenSemanticOnlyContexts();
    if (contexts.length === 0) {
      return;
    }
    const options = readSemanticOnlyOptions(this.host.hideComments());
    for (const context of contexts) {
      if (
        !context.diff
        || !context.semanticSessionId
        || !context.semanticSourceBaseUri
        || !context.semanticSourceModifiedUri
      ) {
        continue;
      }
      const [baseDocument, modifiedDocument] = await Promise.all([
        vscode.workspace.openTextDocument(context.semanticSourceBaseUri),
        vscode.workspace.openTextDocument(context.semanticSourceModifiedUri),
      ]);
      const projection = this.host.semanticOnlyContentProvider.updateDocuments(context.semanticSessionId, {
        folderUri: context.folderUri,
        relativePath: context.relativePath,
        oldText: baseDocument.getText(),
        newText: modifiedDocument.getText(),
        diff: context.diff,
        options,
      });
      if (!projection) {
        continue;
      }
      context.semanticProjection = projection;
      this.applySemanticOnlyVisuals(context);
      if (context.lastRevealPayload) {
        await delay(25);
        await this.reveal(context, context.lastRevealPayload);
      }
    }
  }

  private uniqueOpenSemanticOnlyContexts(): OpenedDiffContext[] {
    const seen = new Set<string>();
    const contexts: OpenedDiffContext[] = [];
    for (const context of this.openDiffContexts.values()) {
      if (context.mode !== "semanticOnly" || !context.semanticSessionId || seen.has(context.semanticSessionId)) {
        continue;
      }
      seen.add(context.semanticSessionId);
      contexts.push(context);
    }
    return contexts;
  }

  private remember(context: OpenedDiffContext): OpenedDiffContext {
    this.openDiffContexts.set(context.baseUri.toString(), context);
    this.openDiffContexts.set(context.modifiedUri.toString(), context);
    this.host.onContextsChanged();
    return context;
  }
}
