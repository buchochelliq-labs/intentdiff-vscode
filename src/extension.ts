import * as path from "path";
import { execFile } from "child_process";
import { existsSync } from "fs";
import { writeFile } from "fs/promises";
import * as vscode from "vscode";
import { BaseContentProvider } from "./baseContentProvider";
import { ReviewTelemetryService } from "./reviewTelemetryService";
import { ServerSessionManager, type LiveServerFailureDetails, type ServerSession } from "./serverSessionManager";
import {
  DiffSurfaceController,
  type OpenedDiffContext,
  type OpenFileReviewPayload,
} from "./diffSurfaceController";
import { ReviewPollingService } from "./reviewPollingService";
import { createReviewSnapshot, readWorkingTreeFile } from "./reviewSnapshotSource";
import {
  fallbackDiffEnabled,
  readDiffMode,
  readFuelPolicy,
  readLiveServerSettings,
  readReviewMaxAutoRetries,
  readReviewDiffContextLines,
  readReviewDiffSurface,
  readReviewGroupingMode,
  readSemanticOnlyOptions,
  resolveExecutableForFolder,
  workspaceVenvIntentumDiffCandidates,
  type NativeDiffMode,
} from "./extensionSettings";
import { BASE_SCHEME, assertSafeRelativePath, decodeBaseIdentity } from "./baseUri";
import {
  buildLiveServerArgs,
  buildLiveServerEnv,
  readTrustedExecutable,
  readTrustedSchemaAllowPrivateHosts,
  readTrustedSchemaFetchMode,
} from "./config";
import { EMPTY_SCHEME, EmptyContentProvider } from "./emptyContentProvider";
import {
  buildIntentLenses,
  categoryForKind,
  riskForKind,
  type IntentLensContext,
  type IntentSide,
  type PeekIntentArgs,
} from "./intentCodeLens";
import {
  IntentCodeActionProvider,
  IntentCodeLensProvider,
  IntentHoverProvider,
  IntentInlayHintsProvider,
} from "./intentCodeLensProvider";
import { IntentLlmExplainer } from "./intentLlmExplainer";
import {
  buildReleaseNotes,
  releaseNotesToJson,
  releaseNotesToMarkdown,
} from "./releaseNotes";
import {
  reviewActionTargetForPayload,
  semanticReviewHunkEditForPayload,
  semanticReviewActionTargetForPayload,
  type SemanticReviewActionKind,
  type SemanticReviewHunkEdit,
} from "./reviewActionModel";
import {
  diffToBaseDecorations,
  diffToDiagnostics,
  diffToModifiedDecorations,
  reviewTargetForChange,
  statusText,
  summarizeDiff,
} from "./mapper";
import {
  LiveServerClient,
  type AssetDiffEnvelope,
  type DiffResultEnvelope,
  type ReviewFileEnvelope,
  type ReviewResultEnvelope,
} from "./protocol";
import { ProcessLineTransport } from "./processTransport";
import {
  nextReviewFileGroupingMode,
  normalizeReviewFileGroupingMode,
  isStyleOnlyReviewDiff,
  reviewEntriesForCrossFileChanges,
  summarizeReviewWithCrossFile,
  type ReviewCrossFileEntry,
  type ReviewFile,
  type ReviewFileGroupingMode,
} from "./reviewModel";
import {
  SemanticReviewTreeProvider,
  type OpenReviewPayload,
  type ReviewDiffSurface,
  type ReviewTreeNode,
} from "./reviewTree";
import {
  ReviewDashboardWebviewProvider,
  ReviewPanelWebviewController,
} from "./reviewWebview";
import { registerReviewTimelineProvider, ReviewTimelineProvider } from "./reviewTimeline";
import {
  appendReviewTimelineSnapshot,
  createReviewTimelineSnapshot,
  type ReviewTimelineSnapshot,
} from "./reviewTimelineModel";
import {
  buildReviewDashboardModel,
  buildReviewPanelModel,
  DEFAULT_REVIEW_FUEL_POLICY,
  type ReviewFuelHistory,
  type ReviewFuelPolicy,
  type ReviewWebviewMessage,
  type ReviewWebviewPayload,
} from "./reviewWebviewModel";
import {
  createReviewRefreshSnapshot,
  planReviewRefresh,
  type ReviewRefreshFile,
  type ReviewRefreshSnapshot,
} from "./reviewRefresh";
import {
  discoverWorkingTreeFilesForFolder,
  resolveGitRef,
  type WorkingTreeFile,
} from "./scm";
import { selectionTargetForDocument } from "./selectionRange";
import {
  decodeSemanticOnlyIdentity,
  SEMANTIC_BASE_SCHEME,
  SEMANTIC_MODIFIED_SCHEME,
  SemanticOnlyContentProvider,
} from "./semanticOnlyContentProvider";
import {
  projectDecorations,
  projectPosition,
  selectedChanges,
  type SemanticOnlyOptions,
  type SemanticOnlyProjection,
} from "./semanticOnlyDiff";
import type { CommitDiff, DecorationLike, DiagnosticLike, LiveServerSettings, NodePosition, SemanticDiff } from "./types";
import {
  DiagnosticsParserCall,
  DiagnosticsReport,
  DiagnosticsReportFile,
  FuelSummary,
  arrayRecords,
  createDiagnosticsNonce,
  diagnosticsReportMarkdown,
  emptyFuelSummary,
  escapeHtml,
  formatFuel,
  fuelSummaryForDiff,
  numberField,
  parserCallsForDiff,
  recordField,
  renderDiagnosticsReportHtml,
  statusSummary,
  stringField,
  uniqueStrings,
} from "./diagnosticsReport";
import {
  applyGitIndexPatch,
  delay,
  existingOrEmptyModifiedUri,
  fileUriExists,
  fileUriFromGitPath,
  findVisibleTextEditor,
  gitUriPathCandidates,
  isOldOnlyChange,
  isReviewTreeNode,
  isTextDiffTabInput,
  messageOf,
  nonNegativeNumber,
  normalizeOpenReviewPayload,
  readFuelSetting,
  safeDecodeURIComponent,
  samePosition,
  semanticLineHintDecorations,
  shouldRevealBaseSide,
  toDecorationOption,
  toRange,
  toSeverity,
  toVsDiagnostic,
  wordRangeForInlineDeletion,
  workspaceFileUriFromGitUri,
} from "./extensionEditorUtils";
import {
  imageAssetReviewDiff,
  isImageLikePath,
  nonTextAssetReviewDiff,
  normalizeReviewDiffFilenames,
  pendingMessageFor,
  requestKey,
  reviewGroupingModeLabel,
  reviewKey,
  withAssetDiffFailure,
  withEngineAssetDiff,
} from "./reviewAssetDiffs";

interface IncrementalReviewRequest {
  folderUri: string;
  relativePath: string;
  seq: number;
  generation: number;
  stamp: string;
  status: ReviewRefreshFile["status"];
}

export function activate(context: vscode.ExtensionContext): void {
  const controller = new PysdController(context);
  context.subscriptions.push(controller);
  controller.activate();
}

export function deactivate(): void {
  // VS Code disposes subscriptions from activate().
}

class PysdController implements vscode.Disposable {
  private readonly output = vscode.window.createOutputChannel("IntentumDiff");
  private readonly diagnostics = vscode.languages.createDiagnosticCollection("IntentumDiff");
  private readonly status = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 20);
  private readonly diffStatus = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 20);
  private readonly reviewTree = new SemanticReviewTreeProvider();
  private readonly reviewTimeline = new ReviewTimelineProvider();
  private readonly baseContentProvider = new BaseContentProvider(this.output);
  private readonly emptyContentProvider = new EmptyContentProvider();
  private readonly semanticOnlyContentProvider = new SemanticOnlyContentProvider();
  private readonly intentCodeLens = new IntentCodeLensProvider((uri) => this.intentLensContext(uri));
  private readonly intentInlayHints = new IntentInlayHintsProvider((uri) => this.intentLensContext(uri));
  private intentLlmExplainer!: IntentLlmExplainer;
  private readonly serverSessions: ServerSessionManager;
  private readonly timers = new Map<string, NodeJS.Timeout>();
  private readonly decorationCache = new Map<string, DecorationLike[]>();
  private readonly semanticLineHintCache = new Map<string, vscode.DecorationOptions[]>();
  private readonly diffSurfaces: DiffSurfaceController;
  // Live diffs keyed by working-file URI so intent CodeLens appears on the
  // editing buffer (not only inside the diff editor).
  private readonly liveIntentContexts = new Map<string, { diff: SemanticDiff; folderUri: string; relativePath: string }>();
  private readonly navigationIndexes = new Map<string, number>();
  private readonly reviewFiles = new Map<string, ReviewFile>();
  private readonly reviewRequests = new Map<string, {
    folderUri: string;
    seq: number;
    snapshot?: ReviewRefreshSnapshot;
  }>();
  private readonly reviewSlowTimers = new Map<string, NodeJS.Timeout>();
  private readonly incrementalReviewRequests = new Map<string, IncrementalReviewRequest>();
  /** In-flight perceptual asset requests, keyed like every other protocol request. */
  private readonly assetDiffRequests = new Map<string, {
    folderUri: string;
    relativePath: string;
    generation: number;
  }>();
  private readonly streamedReviewFiles = new Map<string, Set<string>>();
  private readonly reviewSnapshots = new Map<string, ReviewRefreshSnapshot>();
  private readonly telemetry: ReviewTelemetryService;
  private readonly liveServerWarningKeys = new Set<string>();
  private reviewCrossFileEntries: ReviewCrossFileEntry[] = [];
  private reviewView: vscode.TreeView<ReviewTreeNode> | undefined;
  private scmReviewView: vscode.TreeView<ReviewTreeNode> | undefined;
  private reviewDashboardProvider: ReviewDashboardWebviewProvider | undefined;
  private reviewPanelController: ReviewPanelWebviewController | undefined;
  private reviewPanelPayload: OpenFileReviewPayload | undefined;
  private reviewViewVisible = false;
  private reviewWasVisible = false;
  private reviewRefreshTimer: NodeJS.Timeout | undefined;
  private reviewDispatching = false;
  private reviewRefreshRunning = false;
  // Auto-retry guard (issue 123): a failing review must not hot-loop. Deterministic failures
  // (same input -> same error) are never auto-retried; transient ones retry up to the
  // configurable cap. Any real input change or explicit user action resets the streak.
  private reviewFailureStreak = 0;
  private reviewFailureGeneration = -1;
  private lastReviewFailure: { code?: string; message: string } | undefined;
  private reviewRetrySuppressedLogged = false;
  private readonly nonRetryableReviewCodes = new Set([
    "native_fallback",
    "invalid_request",
    "invalid_ref",
    "invalid_path",
    "invalid_content",
    "invalid_stream",
    "invalid_deltas",
    "invalid_seq",
    "invalid_json",
    "invalid_op",
    "unsupported_protocol",
    "line_too_large",
    "content_too_large",
    "too_many_deltas",
  ]);
  private readonly streakResetRefreshReasons = new Set([
    "document save",
    "file change",
    "file create",
    "file delete",
    "file rename",
    "manual refresh",
    "restart",
    "enabled",
  ]);
  private reviewRefreshQueued = false;
  private pendingReviewForceFull = false;
  private pendingReviewReason = "refresh";
  private reviewGeneration = 0;
  private readonly reviewPolling: ReviewPollingService;
  private paused = false;
  private overlaysVisible = true;
  private hideComments = false;

  // Category accents (overview-ruler ticks, borders, inline markers) use the
  // contributed intentumdiff.semanticChanges.* tokens so the live overlay shares
  // one palette with every other surface. Line backgrounds keep the
  // theme-native translucent diffEditor.* tokens (the contributed tokens are
  // vivid foregrounds, unsuitable as a full-strength background).
  private readonly decorationTypes = {
    addition: vscode.window.createTextEditorDecorationType({
      backgroundColor: new vscode.ThemeColor("diffEditor.insertedTextBackground"),
      overviewRulerColor: new vscode.ThemeColor("intentumdiff.semanticChanges.addition"),
      overviewRulerLane: vscode.OverviewRulerLane.Right,
    }),
    deletion: vscode.window.createTextEditorDecorationType({
      backgroundColor: new vscode.ThemeColor("diffEditor.removedTextBackground"),
      overviewRulerColor: new vscode.ThemeColor("intentumdiff.semanticChanges.deletion"),
      overviewRulerLane: vscode.OverviewRulerLane.Right,
    }),
    modification: vscode.window.createTextEditorDecorationType({
      backgroundColor: new vscode.ThemeColor("diffEditor.changedTextBackground"),
      overviewRulerColor: new vscode.ThemeColor("intentumdiff.semanticChanges.modification"),
      overviewRulerLane: vscode.OverviewRulerLane.Right,
    }),
    move: vscode.window.createTextEditorDecorationType({
      isWholeLine: true,
      border: "1px dashed",
      borderColor: new vscode.ThemeColor("intentumdiff.semanticChanges.movedCode"),
      overviewRulerColor: new vscode.ThemeColor("intentumdiff.semanticChanges.movedCode"),
      overviewRulerLane: vscode.OverviewRulerLane.Right,
    }),
    refactoring: vscode.window.createTextEditorDecorationType({
      isWholeLine: true,
      border: "1px solid",
      borderColor: new vscode.ThemeColor("intentumdiff.semanticChanges.refactoring"),
      overviewRulerColor: new vscode.ThemeColor("intentumdiff.semanticChanges.refactoring"),
      overviewRulerLane: vscode.OverviewRulerLane.Right,
    }),
    style: vscode.window.createTextEditorDecorationType({
      isWholeLine: true,
      opacity: "0.65",
      overviewRulerColor: new vscode.ThemeColor("intentumdiff.semanticChanges.muted"),
      overviewRulerLane: vscode.OverviewRulerLane.Right,
    }),
    inlineDeletionWord: vscode.window.createTextEditorDecorationType({
      backgroundColor: new vscode.ThemeColor("diffEditor.changedTextBackground"),
      border: "1px dotted",
      borderColor: new vscode.ThemeColor("intentumdiff.semanticChanges.deletion"),
      overviewRulerColor: new vscode.ThemeColor("intentumdiff.semanticChanges.deletion"),
      overviewRulerLane: vscode.OverviewRulerLane.Right,
    }),
    inlineDeletionGap: vscode.window.createTextEditorDecorationType({
      textDecoration: "none; border-left: 1px dotted; border-right: 1px dotted;",
      after: {
        color: new vscode.ThemeColor("intentumdiff.semanticChanges.deletion"),
        backgroundColor: new vscode.ThemeColor("diffEditor.removedTextBackground"),
        margin: "0 0 0 0.25em",
      },
      overviewRulerColor: new vscode.ThemeColor("intentumdiff.semanticChanges.deletion"),
      overviewRulerLane: vscode.OverviewRulerLane.Right,
    }),
  };

  private readonly semanticLineHintDecoration = vscode.window.createTextEditorDecorationType({
    before: {
      color: new vscode.ThemeColor("editorLineNumber.foreground"),
      margin: "0 1.5em 0 0",
    },
  });

  constructor(private readonly context: vscode.ExtensionContext) {
    this.diffSurfaces = new DiffSurfaceController({
      output: this.output,
      baseContentProvider: this.baseContentProvider,
      emptyContentProvider: this.emptyContentProvider,
      semanticOnlyContentProvider: this.semanticOnlyContentProvider,
      hideComments: () => this.hideComments,
      reviewFileFor: (folderUri, relativePath) => this.reviewFiles.get(reviewKey(folderUri, relativePath)),
      resolvedCommitFor: (folderUri) => this.reviewSnapshots.get(folderUri)?.resolvedCommit,
      openReviewPanel: (payload) => this.openReviewPanel(payload),
      applyDiffVisuals: (uri, diff) => this.applyDiffVisuals(uri, diff),
      applyBaseDiffVisuals: (uri, diff) => this.applyBaseDiffVisuals(uri, diff),
      setDecorationsForUri: (uri, decorations) => this.setDecorationsForUri(uri, decorations),
      setSemanticLineHintsForUri: (uri, options) => this.setSemanticLineHintsForUri(uri, options),
      onContextsChanged: () => {
        this.updateEditorContext();
        this.intentCodeLens.refresh();
        this.intentInlayHints.refresh();
      },
    });
    this.reviewPolling = new ReviewPollingService({
      output: this.output,
      subscribe: (disposable) => this.context.subscriptions.push(disposable),
      onRefreshNeeded: (reason) => this.scheduleReviewRefresh(reason),
    });
    this.serverSessions = new ServerSessionManager({
      output: this.output,
      extensionPath: context.extensionPath,
      trace: (message) => this.trace(message),
      setStatusText: (text) => { this.status.text = text; },
      onDiff: (folder, result) => this.handleDiff(folder, result),
      onReviewResult: (folder, result) => this.handleReviewResult(folder, result),
      onReviewFile: (folder, result) => this.handleReviewFile(folder, result),
      onAssetDiff: (folder, result) => this.handleAssetDiff(folder, result),
      onReviewError: (folder, seq, message, code) => this.handleReviewError(folder, seq, message, code),
      onIncrementalReviewError: (folder, seq, message, code) =>
        this.handleIncrementalReviewError(folder, seq, message, code),
      onAssetDiffError: (folder, seq, message) => this.handleAssetDiffError(folder, seq, message),
      onProtocolError: (error) => this.handleProtocolError(error),
      onFailure: (folder, details) => this.notifyLiveServerFailure(folder, details),
    });
    this.telemetry = new ReviewTelemetryService({
      output: this.output,
      workspaceState: context.workspaceState,
      reviewFiles: () => [...this.reviewFiles.values()],
      fuelPolicy: () => readFuelPolicy(),
      setTimelineSnapshots: (snapshots) => this.reviewTimeline.setReviewSnapshots(snapshots),
    });
    this.status.command = "intentumdiff.showOutput";
    this.status.text = "IntentumDiff";
    this.status.tooltip = "IntentumDiff";
    this.diffStatus.name = "IntentumDiff mode";
  }

  activate(): void {
    this.status.show();
    this.closeStaleBaseDirectoryTabs();
    this.intentLlmExplainer = new IntentLlmExplainer(this.context.secrets, this.context.globalState);
    this.telemetry.restore();
    this.reviewTree.setGroupingMode(readReviewGroupingMode());
    this.reviewTree.setDiffSurface(readReviewDiffSurface());
    const reviewView = vscode.window.createTreeView("intentumdiff.review", {
      treeDataProvider: this.reviewTree,
      showCollapseAll: true,
    });
    const scmReviewView = vscode.window.createTreeView("intentumdiff.semanticChanges", {
      treeDataProvider: this.reviewTree,
      showCollapseAll: true,
    });
    const reviewDashboardProvider = new ReviewDashboardWebviewProvider(
      () => buildReviewDashboardModel(
        [...this.reviewFiles.values()],
        this.reviewCrossFileEntries,
        readReviewGroupingMode(),
        this.telemetry.fuelHistorySnapshot(),
        readFuelPolicy(),
        [...this.telemetry.timeline()],
      ),
      (message) => this.handleReviewWebviewMessage(message),
      () => this.syncReviewViewVisibility("dashboard visibility"),
      this.context.extensionUri,
    );
    const reviewPanelController = new ReviewPanelWebviewController(
      this.context.extensionUri,
      (message) => this.handleReviewWebviewMessage(message),
    );
    const workspaceFileWatcher = vscode.workspace.createFileSystemWatcher("**/*");
    this.reviewView = reviewView;
    this.scmReviewView = scmReviewView;
    this.reviewDashboardProvider = reviewDashboardProvider;
    this.reviewPanelController = reviewPanelController;
    this.context.subscriptions.push(
      this.output,
      this.diagnostics,
      this.status,
      this.diffStatus,
      this.reviewTree,
      this.baseContentProvider,
      this.emptyContentProvider,
      this.semanticOnlyContentProvider,
      vscode.workspace.registerTextDocumentContentProvider(BASE_SCHEME, this.baseContentProvider),
      vscode.workspace.registerTextDocumentContentProvider(EMPTY_SCHEME, this.emptyContentProvider),
      vscode.workspace.registerTextDocumentContentProvider(SEMANTIC_BASE_SCHEME, this.semanticOnlyContentProvider),
      vscode.workspace.registerTextDocumentContentProvider(SEMANTIC_MODIFIED_SCHEME, this.semanticOnlyContentProvider),
      reviewDashboardProvider,
      reviewPanelController,
      vscode.window.registerWebviewViewProvider("intentumdiff.dashboard", reviewDashboardProvider, {
        webviewOptions: { retainContextWhenHidden: true },
      }),
      registerReviewTimelineProvider(vscode.workspace, this.reviewTimeline),
      this.intentCodeLens,
      vscode.languages.registerCodeLensProvider(
        [{ scheme: "file" }, { scheme: BASE_SCHEME }, { scheme: EMPTY_SCHEME }],
        this.intentCodeLens,
      ),
      vscode.languages.registerHoverProvider(
        [{ scheme: "file" }, { scheme: BASE_SCHEME }, { scheme: EMPTY_SCHEME }],
        new IntentHoverProvider((uri) => this.intentLensContext(uri), this.intentLlmExplainer),
      ),
      vscode.commands.registerCommand("intentumdiff.setIntentExplainerKey", () => this.intentLlmExplainer.setKey()),
      vscode.commands.registerCommand("intentumdiff.clearIntentExplainerKey", () => this.intentLlmExplainer.clearKey()),
      vscode.languages.registerCodeActionsProvider(
        [{ scheme: "file" }, { scheme: BASE_SCHEME }, { scheme: EMPTY_SCHEME }],
        new IntentCodeActionProvider((uri) => this.intentLensContext(uri)),
        { providedCodeActionKinds: IntentCodeActionProvider.kinds },
      ),
      this.intentInlayHints,
      vscode.languages.registerInlayHintsProvider(
        [{ scheme: "file" }, { scheme: BASE_SCHEME }, { scheme: EMPTY_SCHEME }],
        this.intentInlayHints,
      ),
      vscode.commands.registerCommand(
        "intentumdiff.peekIntent",
        (args?: PeekIntentArgs) => this.peekIntent(args),
      ),
      reviewView,
      scmReviewView,
      reviewView.onDidChangeVisibility(() => this.syncReviewViewVisibility("view visibility")),
      scmReviewView.onDidChangeVisibility(() => this.syncReviewViewVisibility("view visibility")),
      vscode.commands.registerCommand("intentumdiff.toggle", () => this.toggle()),
      vscode.commands.registerCommand("intentumdiff.toggleEditorDiff", () => this.toggleEditorDiff()),
      vscode.commands.registerCommand("intentumdiff.showEditorDiff", () => this.setEditorDiffVisible(true)),
      vscode.commands.registerCommand("intentumdiff.hideEditorDiff", () => this.setEditorDiffVisible(false)),
      vscode.commands.registerCommand("intentumdiff.toggleHideComments", () => this.toggleHideComments()),
      vscode.commands.registerCommand("intentumdiff.showCommentChanges", () => this.setHideComments(false)),
      vscode.commands.registerCommand("intentumdiff.hideCommentChanges", () => this.setHideComments(true)),
      vscode.commands.registerCommand("intentumdiff.configureVisibleChangeTypes", () => this.configureVisibleChangeTypes()),
      vscode.commands.registerCommand("intentumdiff.restartServer", () => this.restartAll()),
      vscode.commands.registerCommand("intentumdiff.diffActiveFile", () => this.diffActiveEditorNow()),
      vscode.commands.registerCommand("intentumdiff.showOutput", () => this.output.show()),
      vscode.commands.registerCommand("intentumdiff.refreshReview", () => this.requestFullReview("manual refresh")),
      vscode.commands.registerCommand("intentumdiff.openReviewDashboard", () => this.openReviewDashboard()),
      vscode.commands.registerCommand("intentumdiff.openDiagnostics", () => this.telemetry.openDiagnosticsReport()),
      vscode.commands.registerCommand("intentumdiff.exportDiagnostics", () => this.telemetry.exportDiagnosticsReport()),
      vscode.commands.registerCommand("intentumdiff.cycleReviewGrouping", () => this.cycleReviewGrouping()),
      vscode.commands.registerCommand(
        "intentumdiff.openReviewPanel",
        (payload?: OpenReviewPayload | ReviewTreeNode | ReviewWebviewPayload) => this.openReviewPanel(payload),
      ),
      vscode.commands.registerCommand(
        "intentumdiff.reviewPanel.openNativeDiff",
        () => this.openReviewPanelNativeDiff("full"),
      ),
      vscode.commands.registerCommand(
        "intentumdiff.reviewPanel.openSemanticOnlyDiff",
        () => this.openReviewPanelNativeDiff("semanticOnly"),
      ),
      vscode.commands.registerCommand(
        "intentumdiff.reviewPanel.stageFile",
        async (payload?: OpenReviewPayload | ReviewWebviewPayload) => {
          const uri = this.reviewPayloadUri(payload);
          if (!uri) {
            void vscode.window.showInformationMessage("IntentumDiff: no reviewed file is available to stage.");
            return;
          }
          await vscode.commands.executeCommand("git.stage", uri);
        },
      ),
      vscode.commands.registerCommand(
        "intentumdiff.reviewPanel.revertFile",
        async (payload?: OpenReviewPayload | ReviewWebviewPayload) => {
          const uri = this.reviewPayloadUri(payload);
          if (!uri) {
            void vscode.window.showInformationMessage("IntentumDiff: no reviewed file is available to revert.");
            return;
          }
          const choice = await vscode.window.showWarningMessage(
            "Revert this file through VS Code Git?",
            { modal: true },
            "Revert File",
          );
          if (choice === "Revert File") {
            await vscode.commands.executeCommand("git.clean", uri);
          }
        },
      ),
      vscode.commands.registerCommand(
        "intentumdiff.reviewPanel.stageHunk",
        async (payload?: ReviewWebviewPayload) => this.handleSemanticHunkAction("stageHunk", payload),
      ),
      vscode.commands.registerCommand(
        "intentumdiff.reviewPanel.revertHunk",
        async (payload?: ReviewWebviewPayload) => this.handleSemanticHunkAction("revertHunk", payload),
      ),
      vscode.commands.registerCommand(
        "intentumdiff.reviewPanel.applyHunk",
        async (payload?: ReviewWebviewPayload) => this.handleSemanticHunkAction("applyHunk", payload),
      ),
      vscode.commands.registerCommand(
        "intentumdiff.reviewPanel.previousChange",
        () => this.reviewPanelController?.postPanelCommand("previousChange"),
      ),
      vscode.commands.registerCommand(
        "intentumdiff.reviewPanel.nextChange",
        () => this.reviewPanelController?.postPanelCommand("nextChange"),
      ),
      vscode.commands.registerCommand(
        "intentumdiff.reviewPanel.toggleRail",
        () => this.reviewPanelController?.postPanelCommand("toggleRail"),
      ),
      vscode.commands.registerCommand(
        "intentumdiff.reviewPanel.toggleEvidenceDrawer",
        () => this.reviewPanelController?.postPanelCommand("toggleEvidenceDrawer"),
      ),
      vscode.commands.registerCommand(
        "intentumdiff.reviewPanel.setView",
        (reviewView?: string) => this.reviewPanelController?.postPanelCommand("setReviewView", reviewView),
      ),
      vscode.commands.registerCommand(
        "intentumdiff.openSemanticDiff",
        (payload: OpenReviewPayload | ReviewTreeNode) => this.diffSurfaces.open(payload),
      ),
      vscode.commands.registerCommand(
        "intentumdiff.openChange",
        (payload: OpenReviewPayload | ReviewTreeNode) => this.diffSurfaces.open(payload),
      ),
      vscode.commands.registerCommand(
        "intentumdiff.openSemanticOnlyDiff",
        (payload?: OpenReviewPayload | ReviewTreeNode) => this.diffSurfaces.open(payload, "semanticOnly"),
      ),
      vscode.commands.registerCommand(
        "intentumdiff.openFullDiff",
        (payload?: OpenReviewPayload | ReviewTreeNode) => this.diffSurfaces.open(payload, "full"),
      ),
      vscode.commands.registerCommand("intentumdiff.nextSemanticChange", () => this.navigateSemanticChange(1)),
      vscode.commands.registerCommand("intentumdiff.previousSemanticChange", () => this.navigateSemanticChange(-1)),
      vscode.commands.registerCommand("intentumdiff.expandSemanticDiffContext", () => this.adjustSemanticContextLines(1)),
      vscode.commands.registerCommand("intentumdiff.collapseSemanticDiffContext", () => this.adjustSemanticContextLines(-1)),
      vscode.commands.registerCommand("intentumdiff.clearReview", () => this.clearReview()),
      vscode.commands.registerCommand("intentumdiff.revealActiveFileInReview", () => this.revealActiveFileInReview()),
      vscode.workspace.onDidOpenTextDocument((document) => this.scheduleDocument(document)),
      vscode.workspace.onDidSaveTextDocument((document) => {
        this.scheduleDocument(document);
        this.scheduleReviewRefresh("document save");
      }),
      vscode.workspace.onDidChangeTextDocument((event) => this.scheduleDocument(event.document)),
      workspaceFileWatcher,
      workspaceFileWatcher.onDidChange((uri) => this.scheduleReviewRefreshForKnownFileChange(uri)),
      vscode.workspace.onDidCloseTextDocument((document) => this.clearDocumentVisuals(document.uri)),
      vscode.workspace.onDidCreateFiles(() => this.scheduleReviewRefresh("file create")),
      vscode.workspace.onDidDeleteFiles(() => this.scheduleReviewRefresh("file delete")),
      vscode.workspace.onDidRenameFiles(() => this.scheduleReviewRefresh("file rename", { forceFull: true })),
      vscode.workspace.onDidChangeWorkspaceFolders(() => this.scheduleReviewRefresh("workspace folders", { forceFull: true })),
      vscode.window.onDidChangeActiveTextEditor((editor) => {
        if (editor) {
          this.applyCachedDecorations(editor);
          this.scheduleDocument(editor.document);
        }
        this.updateEditorContext();
      }),
      vscode.workspace.onDidChangeConfiguration((event) => {
        if (
          event.affectsConfiguration("intentumdiff.executable")
          || event.affectsConfiguration("intentumdiff.ref")
          || event.affectsConfiguration("intentumdiff.enabled")
          || event.affectsConfiguration("intentumdiff.debounceMs")
          || event.affectsConfiguration("intentumdiff.fuel")
          || event.affectsConfiguration("intentumdiff.trace")
          || event.affectsConfiguration("intentumdiff.schemas")
        ) {
          this.restartAll();
        } else if (
          event.affectsConfiguration("intentumdiff.diff.hideComments")
          || event.affectsConfiguration("intentumdiff.diff.fallbackDiff")
          || event.affectsConfiguration("intentumdiff.diff.contextLines")
          || event.affectsConfiguration("intentumdiff.diff.defaultMode")
          || event.affectsConfiguration("intentumdiff.visualization")
        ) {
          this.readVisualSettings();
          this.updateEditorContext();
          this.refreshVisibleDecorations();
          if (
            event.affectsConfiguration("intentumdiff.diff.hideComments")
            || event.affectsConfiguration("intentumdiff.diff.contextLines")
            || event.affectsConfiguration("intentumdiff.visualization")
          ) {
            void this.diffSurfaces.refreshOpenSemanticOnly();
          }
        }
        if (event.affectsConfiguration("intentumdiff.review.groupFilesBy")
          || event.affectsConfiguration("intentumdiff.review.diffSurface")) {
          this.applyReviewGrouping();
        }
        if (event.affectsConfiguration("intentumdiff.review.pollIntervalMs") && this.reviewViewVisible) {
          this.reviewPolling.stopPolling();
          this.reviewPolling.startPolling();
        }
      }),
    );
    if (this.context.extensionMode === vscode.ExtensionMode.Test) {
      this.context.subscriptions.push(
        vscode.commands.registerCommand("intentumdiff.test.getReviewState", () => this.reviewStateForTests()),
        vscode.commands.registerCommand("intentumdiff.test.getActiveDiffState", () => this.activeDiffStateForTests()),
      );
    }
    const visibilityTimer = setTimeout(() => {
      this.syncReviewViewVisibility("initial view visibility");
    }, 0);
    this.context.subscriptions.push(new vscode.Disposable(() => clearTimeout(visibilityTimer)));
    void this.reviewPolling.registerGitStatusWatcher();
    this.readVisualSettings();
    this.updateEditorContext();
    this.scheduleDocument(vscode.window.activeTextEditor?.document);
  }

  dispose(): void {
    this.clearTimers();
    this.serverSessions.disposeAll();
    this.clearVisuals();
    for (const decorationType of Object.values(this.decorationTypes)) {
      decorationType.dispose();
    }
    this.semanticLineHintDecoration.dispose();
  }

  private toggle(): void {
    this.paused = !this.paused;
    if (this.paused) {
      this.status.text = "IntentumDiff: paused";
      this.clearTimers();
      this.clearVisuals();
      this.serverSessions.disposeAll();
      return;
    }
    this.status.text = "IntentumDiff: enabled";
    this.scheduleDocument(vscode.window.activeTextEditor?.document);
    this.scheduleReviewRefresh("enabled", { forceFull: true });
  }

  private toggleEditorDiff(): void {
    this.setEditorDiffVisible(!this.overlaysVisible);
  }

  private toggleHideComments(): void {
    this.setHideComments(!this.hideComments);
  }

  private setEditorDiffVisible(visible: boolean): void {
    this.overlaysVisible = visible;
    this.updateEditorContext();
    this.refreshVisibleDecorations();
    this.status.text = this.overlaysVisible ? "IntentumDiff: overlays shown" : "IntentumDiff: overlays hidden";
  }

  private setHideComments(hidden: boolean): void {
    this.hideComments = hidden;
    this.updateEditorContext();
    this.refreshVisibleDecorations();
    void this.diffSurfaces.refreshOpenSemanticOnly();
    this.status.text = this.hideComments ? "IntentumDiff: comments hidden" : "IntentumDiff: comments shown";
  }

  private async configureVisibleChangeTypes(): Promise<void> {
    const config = vscode.workspace.getConfiguration("intentumdiff");
    const options = [
      { label: "Additions", setting: "visualization.showAdditions" },
      { label: "Deletions", setting: "visualization.showDeletions" },
      { label: "Modifications", setting: "visualization.showModifications" },
      { label: "Moves and Refactorings", setting: "visualization.movedCode" },
      { label: "Inline Deletion Markers", setting: "visualization.inlineDeletionMarkers" },
      { label: "Comment Changes", setting: "diff.hideComments", inverted: true },
    ];
    const picked = await vscode.window.showQuickPick(
      options.map((option) => ({
        ...option,
        picked: option.inverted
          ? !config.get(option.setting, false)
          : config.get(option.setting, true),
      })),
      {
        canPickMany: true,
        title: "IntentumDiff visible change types",
      },
    );
    if (!picked) {
      return;
    }
    const visible = new Set(picked.map((item) => item.setting));
    await Promise.all(options.map((option) => config.update(
      option.setting,
      option.inverted ? !visible.has(option.setting) : visible.has(option.setting),
      vscode.ConfigurationTarget.Workspace,
    )));
    this.readVisualSettings();
    this.refreshVisibleDecorations();
    void this.diffSurfaces.refreshOpenSemanticOnly();
  }

  private restartAll(): void {
    this.clearTimers();
    this.serverSessions.disposeAll();
    this.clearVisuals();
    this.liveServerWarningKeys.clear();
    this.clearReview();
    this.baseContentProvider.clear();
    this.emptyContentProvider.clear();
    this.status.text = "IntentumDiff: restarting";
    this.scheduleDocument(vscode.window.activeTextEditor?.document);
    this.scheduleReviewRefresh("restart", { forceFull: true });
  }

  private diffActiveEditorNow(): void {
    const document = vscode.window.activeTextEditor?.document;
    if (!document) {
      void vscode.window.showInformationMessage("IntentumDiff: no active editor");
      return;
    }
    this.diffDocument(document);
  }

  private async openReviewDashboard(): Promise<void> {
    await vscode.commands.executeCommand("workbench.view.extension.intentumdiffActivity");
    await vscode.commands.executeCommand("intentumdiff.dashboard.focus");
  }

  private async cycleReviewGrouping(): Promise<void> {
    const config = vscode.workspace.getConfiguration("intentumdiff");
    const current = readReviewGroupingMode();
    const next = nextReviewFileGroupingMode(current);
    await config.update("review.groupFilesBy", next, vscode.ConfigurationTarget.Global);
    this.applyReviewGrouping();
    void vscode.window.showInformationMessage(`IntentumDiff review grouping: ${reviewGroupingModeLabel(next)}`);
  }

  private applyReviewGrouping(): void {
    this.reviewTree.setGroupingMode(readReviewGroupingMode());
    this.reviewTree.setDiffSurface(readReviewDiffSurface());
    this.reviewDashboardProvider?.refresh();
  }

  private async handleReviewWebviewMessage(message: ReviewWebviewMessage): Promise<void> {
    if (message.command === "refresh") {
      this.requestFullReview("webview refresh");
      return;
    }
    if (message.command === "cycleGrouping") {
      await this.cycleReviewGrouping();
      return;
    }
    if (message.command === "copyReleaseNotes" || message.command === "exportReleaseNotes") {
      await this.handleReleaseNotesExport(message.command, message.payload);
      return;
    }
    if (message.command === "openTimelineSnapshot") {
      this.openTimelineSnapshot(message.payload);
      return;
    }
    if (message.command === "openCustomDiff") {
      await this.openReviewPanel(message.payload);
      return;
    }
    if (message.command === "openSemanticOnlyDiff") {
      await this.diffSurfaces.open(message.payload, "semanticOnly");
      return;
    }
    if (message.command === "openNativeDiff" || message.command === "reveal") {
      await this.diffSurfaces.open(message.payload, "full");
      return;
    }
    if (message.command === "stageFile") {
      await vscode.commands.executeCommand("intentumdiff.reviewPanel.stageFile", message.payload);
      return;
    }
    if (message.command === "revertFile") {
      await vscode.commands.executeCommand("intentumdiff.reviewPanel.revertFile", message.payload);
      return;
    }
    if (message.command === "stageHunk" || message.command === "revertHunk" || message.command === "applyHunk") {
      await vscode.commands.executeCommand(`intentumdiff.reviewPanel.${message.command}`, message.payload);
      return;
    }
    if (message.command === "editHunk") {
      await vscode.commands.executeCommand("intentumdiff.reviewPanel.applyHunk", message.payload);
    }
  }

  /**
   * Resolve the review file payload release notes should be generated for:
   * prefer the payload the button carried, else the active review panel's file.
   */
  private releaseNotesPayloadFor(
    payload: ReviewWebviewPayload | undefined,
  ): OpenFileReviewPayload | undefined {
    if (payload?.relativePath) {
      try {
        assertSafeRelativePath(payload.relativePath);
      } catch {
        return undefined;
      }
      return { ...payload, relativePath: payload.relativePath };
    }
    return this.reviewPanelPayload;
  }

  private async handleReleaseNotesExport(
    command: "copyReleaseNotes" | "exportReleaseNotes",
    payload: ReviewWebviewPayload | undefined,
  ): Promise<void> {
    const filePayload = this.releaseNotesPayloadFor(payload);
    if (!filePayload) {
      void vscode.window.showInformationMessage("IntentumDiff: no reviewed file is available for release notes.");
      return;
    }
    const model = await this.buildReviewPanelModelForPayload(filePayload);
    if (!model) {
      // buildReviewPanelModelForPayload already surfaced a message.
      return;
    }
    const notes = buildReleaseNotes(model.diff);
    if (command === "copyReleaseNotes") {
      const narrativeSource = new vscode.CancellationTokenSource();
      let narrative: string | undefined;
      try {
        narrative = await this.intentLlmExplainer?.draftReleaseNarrative(notes, narrativeSource.token);
      } finally {
        narrativeSource.dispose();
      }
      const markdown = releaseNotesToMarkdown(notes, { title: `Release notes — ${filePayload.relativePath}`, narrative });
      await vscode.env.clipboard.writeText(markdown);
      void vscode.window.showInformationMessage("IntentumDiff: release notes copied as Markdown.");
      return;
    }
    const baseName = path.basename(filePayload.relativePath).replace(/\.[^.]+$/u, "") || "release-notes";
    const defaultUri = vscode.Uri.file(
      path.join(vscode.Uri.parse(filePayload.folderUri).fsPath, `${baseName}.release-notes.json`),
    );
    const target = await vscode.window.showSaveDialog({
      saveLabel: "Export release notes",
      filters: { JSON: ["json"] },
      defaultUri,
    });
    if (!target) {
      return;
    }
    await vscode.workspace.fs.writeFile(target, Buffer.from(releaseNotesToJson(notes), "utf8"));
    void vscode.window.showInformationMessage(`IntentumDiff: release notes exported to ${path.basename(target.fsPath)}.`);
  }

  private openTimelineSnapshot(payload: ReviewWebviewPayload | undefined): void {
    const snapshotId = payload?.snapshotId;
    const snapshot = snapshotId
      ? this.telemetry.timeline().find((item) => item.id === snapshotId)
      : undefined;
    if (!snapshot) {
      void vscode.window.showWarningMessage("IntentumDiff: review timeline snapshot is no longer available.");
      return;
    }
    this.output.appendLine(JSON.stringify({
      reviewTimelineSnapshot: snapshot,
    }, null, 2));
    this.output.show(true);
    void vscode.window.showInformationMessage(
      `IntentumDiff snapshot: ${snapshot.folderName}, ${snapshot.fileCount} files, ${snapshot.semanticChangeCount} semantic changes, ${snapshot.errorCount} errors, ${snapshot.fuelHotspotCount} fuel hotspots.`,
    );
  }

  private async handleSemanticHunkAction(
    kind: SemanticReviewActionKind,
    payload: ReviewWebviewPayload | undefined,
  ): Promise<void> {
    const editResult = semanticReviewHunkEditForPayload(
      { ...payload, actionKind: kind },
      (folderUri) => vscode.Uri.parse(folderUri).fsPath,
    );
    if (editResult.edit && (kind === "applyHunk" || kind === "revertHunk")) {
      await this.applySemanticHunkEdit(kind, editResult.edit);
      return;
    }
    if (editResult.edit && kind === "stageHunk") {
      await this.stageSemanticHunkEdit(payload, editResult.edit);
      return;
    }
    if (kind !== "stageHunk" && editResult.error) {
      void vscode.window.showWarningMessage(
        `IntentumDiff: semantic hunk action is unavailable: ${editResult.error}`,
      );
      return;
    }
    const result = semanticReviewActionTargetForPayload(
      { ...payload, actionKind: kind },
      (folderUri) => vscode.Uri.parse(folderUri).fsPath,
    );
    if (!result.target) {
      void vscode.window.showWarningMessage(
        `IntentumDiff: semantic hunk action is unavailable${result.error ? `: ${result.error}` : "."}`,
      );
      return;
    }
    const lineText = `${result.target.side} lines ${result.target.startLine}-${result.target.endLine}`;
    this.output.appendLine(JSON.stringify({
      semanticHunkActionPreview: {
        kind: result.target.kind,
        file: result.target.fsPath,
        side: result.target.side,
        startLine: result.target.startLine,
        endLine: result.target.endLine,
        label: result.target.previewLabel,
        error: editResult.error,
      },
    }, null, 2));
    void vscode.window.showInformationMessage(`${result.target.previewLabel} (${lineText})`);
  }

  private async applySemanticHunkEdit(
    kind: SemanticReviewActionKind,
    hunkEdit: SemanticReviewHunkEdit,
  ): Promise<void> {
    if (kind === "revertHunk") {
      const choice = await vscode.window.showWarningMessage(
        `${hunkEdit.target.previewLabel}\n${hunkEdit.target.fsPath}\nworking lines ${hunkEdit.editStartLine}-${hunkEdit.editEndLine}`,
        { modal: true },
        "Revert Hunk",
      );
      if (choice !== "Revert Hunk") {
        return;
      }
    }
    const uri = vscode.Uri.file(hunkEdit.target.fsPath);
    const document = await vscode.workspace.openTextDocument(uri);
    const startLine = Math.max(0, Math.min(document.lineCount, hunkEdit.editStartLine - 1));
    const endLineExclusive = Math.max(startLine, Math.min(document.lineCount, hunkEdit.editEndLine));
    const range = new vscode.Range(startLine, 0, endLineExclusive, 0);
    const replacementText = hunkEdit.replacementText.length > 0 ? `${hunkEdit.replacementText}\n` : "";
    const edit = new vscode.WorkspaceEdit();
    edit.replace(uri, range, replacementText);
    const applied = await vscode.workspace.applyEdit(edit);
    this.output.appendLine(JSON.stringify({
      semanticHunkActionApplied: {
        kind,
        file: hunkEdit.target.fsPath,
        editStartLine: hunkEdit.editStartLine,
        editEndLine: hunkEdit.editEndLine,
        applied,
        previewPatch: hunkEdit.previewPatch,
      },
    }, null, 2));
    if (applied) {
      await document.save();
      void vscode.window.showInformationMessage(`${hunkEdit.target.previewLabel} applied.`);
    } else {
      void vscode.window.showWarningMessage(`IntentumDiff: ${hunkEdit.target.previewLabel} did not apply.`);
    }
  }

  private async stageSemanticHunkEdit(
    payload: ReviewWebviewPayload | undefined,
    hunkEdit: SemanticReviewHunkEdit,
  ): Promise<void> {
    if (!hunkEdit.indexPatch) {
      void vscode.window.showWarningMessage("IntentumDiff: semantic hunk stage is unavailable: patch could not be generated.");
      return;
    }
    const folderUri = payload?.folderUri;
    if (!folderUri) {
      void vscode.window.showWarningMessage("IntentumDiff: semantic hunk stage is unavailable: missing workspace folder.");
      return;
    }
    const repoFsPath = vscode.Uri.parse(folderUri).fsPath;
    try {
      await applyGitIndexPatch(repoFsPath, hunkEdit.indexPatch);
      this.output.appendLine(JSON.stringify({
        semanticHunkActionStaged: {
          kind: hunkEdit.target.kind,
          file: hunkEdit.target.fsPath,
          relativePath: hunkEdit.relativePath,
          editStartLine: hunkEdit.editStartLine,
          editEndLine: hunkEdit.editEndLine,
          indexPatch: hunkEdit.indexPatch,
        },
      }, null, 2));
      void vscode.window.showInformationMessage(`${hunkEdit.target.previewLabel} staged.`);
    } catch (error) {
      void vscode.window.showWarningMessage(`IntentumDiff: semantic hunk stage failed: ${messageOf(error)}`);
    }
  }

  private reviewPayloadUri(payload: OpenReviewPayload | ReviewWebviewPayload | undefined): vscode.Uri | undefined {
    const result = reviewActionTargetForPayload(
      payload,
      (folderUri) => vscode.Uri.parse(folderUri).fsPath,
    );
    if (!result.target) {
      if (result.error) {
        void vscode.window.showWarningMessage(`IntentumDiff: unsafe review file target: ${result.error}`);
      }
      return undefined;
    }
    return vscode.Uri.file(result.target.fsPath);
  }

  private scheduleDocument(document: vscode.TextDocument | undefined): void {
    if (!document || !this.isEnabled()) {
      return;
    }
    const target = this.resolveDocument(document);
    if (!target || isImageLikePath(target.relativePath)) {
      // Binary images are reviewed via the perceptual asset panel, never the
      // text engine — a text parser on a PNG balloons to invalid output.
      return;
    }
    const key = document.uri.toString();
    const existing = this.timers.get(key);
    if (existing) {
      clearTimeout(existing);
    }
    const timer = setTimeout(() => {
      this.timers.delete(key);
      this.diffDocument(document);
    }, readLiveServerSettings().debounceMs);
    this.timers.set(key, timer);
  }

  private setReviewViewVisible(visible: boolean, reason: string): void {
    this.reviewViewVisible = visible;
    if (!visible) {
      this.reviewPolling.stopPolling();
      return;
    }
    this.reviewPolling.startPolling();
    const forceFull = !this.reviewWasVisible;
    this.reviewWasVisible = true;
    this.scheduleReviewRefresh(reason, { forceFull, immediate: forceFull });
  }

  private syncReviewViewVisibility(reason: string): void {
    this.setReviewViewVisible(
      this.reviewView?.visible === true
        || this.scmReviewView?.visible === true
        || this.reviewDashboardProvider?.visible === true,
      reason,
    );
  }

  private scheduleReviewRefresh(
    reason: string,
    options: { forceFull?: boolean; immediate?: boolean; allowHidden?: boolean } = {},
  ): void {
    if ((!this.reviewViewVisible && options.allowHidden !== true) || !this.isEnabled()) {
      return;
    }
    if (this.streakResetRefreshReasons.has(reason)) {
      this.resetReviewFailureStreak();
    }
    this.pendingReviewReason = reason;
    this.pendingReviewForceFull = this.pendingReviewForceFull || options.forceFull === true;
    if (this.isReviewRefreshBusy()) {
      this.reviewRefreshQueued = true;
      return;
    }
    if (this.reviewRefreshTimer) {
      clearTimeout(this.reviewRefreshTimer);
    }
    const delayMs = options.immediate === true
      ? 0
      : Math.max(250, readLiveServerSettings().debounceMs);
    this.reviewRefreshTimer = setTimeout(() => {
      this.reviewRefreshTimer = undefined;
      void this.refreshReviewIfNeeded();
    }, delayMs);
  }

  private requestFullReview(reason: string): void {
    this.scheduleReviewRefresh(reason, { forceFull: true, immediate: true, allowHidden: true });
  }

  private scheduleReviewRefreshForKnownFileChange(uri: vscode.Uri): void {
    const target = this.resolveWorkspaceUri(uri);
    if (!target) {
      return;
    }
    if (!this.reviewFiles.has(reviewKey(target.folder.uri.toString(), target.relativePath))) {
      return;
    }
    this.scheduleReviewRefresh("file change");
  }

  private isReviewRefreshBusy(): boolean {
    return this.reviewRefreshRunning || this.hasInFlightReviewWork();
  }

  private hasInFlightReviewWork(): boolean {
    return this.reviewDispatching
      || this.reviewRequests.size > 0
      || this.incrementalReviewRequests.size > 0;
  }

  private cancelPendingReviewRefresh(): void {
    if (this.reviewRefreshTimer) {
      clearTimeout(this.reviewRefreshTimer);
      this.reviewRefreshTimer = undefined;
    }
    this.reviewRefreshQueued = false;
    this.pendingReviewForceFull = false;
    this.pendingReviewReason = "refresh";
  }

  private async refreshReviewIfNeeded(): Promise<void> {
    if (this.reviewRefreshRunning || !this.reviewViewVisible || !this.isEnabled()) {
      return;
    }
    if (this.hasInFlightReviewWork()) {
      this.reviewRefreshQueued = true;
      return;
    }
    const retrySuppression = this.autoReviewRetrySuppression();
    if (retrySuppression) {
      this.reviewRefreshQueued = false;
      this.status.text = "IntentumDiff: review failed (auto-retry paused)";
      if (!this.reviewRetrySuppressedLogged) {
        this.reviewRetrySuppressedLogged = true;
        this.output.appendLine(JSON.stringify({
          reviewAutoRetryPaused: {
            reason: retrySuppression,
            lastError: this.lastReviewFailure ?? null,
            hint: "Edit a file or run 'IntentumDiff: Refresh Semantic Changes' to retry.",
          },
        }, null, 2));
      }
      return;
    }
    this.reviewRefreshRunning = true;
    const forceFull = this.pendingReviewForceFull;
    const reason = this.pendingReviewReason;
    this.pendingReviewForceFull = false;
    this.reviewRefreshQueued = false;
    try {
      if (forceFull) {
        this.output.appendLine(JSON.stringify({
          autoReviewRefresh: { kind: "full", reason },
        }, null, 2));
        await this.refreshReview(reason);
        return;
      }

      const folders = vscode.workspace.workspaceFolders ?? [];
      if (folders.length === 0) {
        return;
      }

      const plans: Array<{
        folder: vscode.WorkspaceFolder;
        current: ReviewRefreshSnapshot;
        refresh: ReviewRefreshFile[];
        remove: string[];
      }> = [];
      let fullReason: string | undefined;
      for (const folder of folders) {
        const folderUri = folder.uri.toString();
        let current: ReviewRefreshSnapshot;
        try {
          current = await createReviewSnapshot(folder);
        } catch (error) {
          fullReason = `status discovery failed: ${messageOf(error)}`;
          break;
        }
        const plan = planReviewRefresh(this.reviewSnapshots.get(folderUri), current, {
          hasCrossFileChanges: this.reviewCrossFileEntries.some((entry) => entry.folderUri === folderUri),
          maxIncrementalPaths: 10,
        });
        if (plan.kind === "full") {
          fullReason = plan.reason;
          break;
        }
        plans.push({ folder, current, refresh: plan.refresh, remove: plan.remove });
      }

      if (fullReason) {
        this.output.appendLine(JSON.stringify({
          autoReviewRefresh: { kind: "full", reason: fullReason },
        }, null, 2));
        await this.refreshReview(fullReason);
        return;
      }

      let changed = false;
      for (const plan of plans) {
        const folderUri = plan.folder.uri.toString();
        for (const relativePath of plan.remove) {
          this.removeReviewFile(plan.folder, relativePath);
          changed = true;
        }
        if (plan.refresh.length > 0) {
          this.reviewFiles.delete(reviewKey(folderUri, ".intentumdiff-review"));
        }
        for (const file of plan.refresh) {
          this.markReviewFilePending(plan.folder, file.relativePath, pendingMessageFor(file));
          changed = true;
        }
        this.reviewSnapshots.set(folderUri, plan.current);
      }
      if (changed) {
        this.updateReviewTree();
      }
      for (const plan of plans) {
        for (const file of plan.refresh) {
          await this.diffReviewFile(plan.folder, file);
        }
      }
      if (changed) {
        this.finishReviewIfIdle();
      }
    } finally {
      this.reviewRefreshRunning = false;
      this.drainQueuedReviewRefresh();
    }
  }

  private reviewStateForTests(): object {
    return {
      files: [...this.reviewFiles.values()].map((file) => ({
        folderName: file.folderName,
        folderUri: file.folderUri,
        relativePath: file.relativePath,
        status: file.status,
        language: file.diff?.language,
        changeCount: file.diff?.changes?.length ?? 0,
        changeTypes: [...new Set((file.diff?.changes ?? []).map((change) => change.change_type))],
        groupKinds: [...new Set((file.diff?.change_groups ?? []).map((group) => group.kind))],
        guardrailCount: file.diff?.guardrail_violations?.length ?? 0,
        parseErrorCount: file.diff?.parse_errors?.length ?? 0,
        isStyleOnly: isStyleOnlyReviewDiff(file.diff),
      })),
      crossFileCount: this.reviewCrossFileEntries.length,
      pendingReviewCount:
        this.reviewRequests.size
        + this.incrementalReviewRequests.size
        + (this.reviewDispatching || this.reviewRefreshRunning ? 1 : 0),
      generation: this.reviewGeneration,
      snapshots: [...this.reviewSnapshots.entries()].map(([folderUri, snapshot]) => ({
        folderUri,
        ref: snapshot.ref,
        resolvedCommit: snapshot.resolvedCommit,
        statusSignature: snapshot.statusSignature,
      })),
      reviewTimelineSnapshots: [...this.telemetry.timeline()],
      fuelHistory: this.telemetry.fuelHistorySnapshot(),
    };
  }

  private activeDiffStateForTests(): object | undefined {
    const context = this.diffSurfaces.active();
    if (!context) {
      return undefined;
    }
    return {
      mode: context.mode,
      relativePath: context.relativePath,
      baseScheme: context.baseUri.scheme,
      modifiedScheme: context.modifiedUri.scheme,
      contextLines: readSemanticOnlyOptions(this.hideComments).contextLines,
      selectedChangeCount: context.semanticProjection?.selectedChangeIndexes.length,
    };
  }

  private diffDocument(document: vscode.TextDocument): void {
    if (!this.isEnabled()) {
      return;
    }
    const target = this.resolveDocument(document);
    if (!target) {
      this.status.text = "IntentumDiff: unavailable";
      this.clearDocumentVisuals(document.uri);
      return;
    }
    if (isImageLikePath(target.relativePath)) {
      // Never send a binary image to the text engine (the generic parser emits
      // gigantic invalid output). Images are reviewed in the perceptual panel.
      this.clearDocumentVisuals(document.uri);
      return;
    }
    let session: ServerSession;
    try {
      session = this.serverSessions.ensure(target.folder);
    } catch (error) {
      this.status.text = "IntentumDiff: error";
      const message = error instanceof Error ? error.message : String(error);
      this.output.appendLine(`LiveServer startup failed: ${message}`);
      void this.notifyLiveServerFailure(target.folder, {
        message,
        toast: "IntentumDiff LiveServer could not start.",
      });
      return;
    }
    this.status.text = "IntentumDiff: diffing";
    session.client.diff(target.relativePath, document.getText(), { purpose: "live" });
  }

  private async notifyLiveServerFailure(
    folder: vscode.WorkspaceFolder,
    details: LiveServerFailureDetails,
  ): Promise<void> {
    this.reviewFiles.set(reviewKey(folder.uri.toString(), ".intentumdiff-liveserver"), {
      folderName: folder.name,
      folderUri: folder.uri.toString(),
      relativePath: ".intentumdiff-liveserver",
      status: "error",
      error: details.message,
    });
    this.updateReviewTree();

    const warningKey = `${folder.uri.toString()}::${details.toast}::${details.suggestedExecutable ?? ""}`;
    if (this.liveServerWarningKeys.has(warningKey)) {
      return;
    }
    this.liveServerWarningKeys.add(warningKey);

    const actions = ["Open Setting", "Show Output"];
    const suggestedExecutable = details.suggestedExecutable;
    const canUseSuggested = suggestedExecutable !== undefined && existsSync(suggestedExecutable);
    if (canUseSuggested) {
      actions.unshift("Use workspace .venv");
    }
    if (details.offerBundledFallback) {
      actions.unshift("Use bundled engine");
    }
    const selected = await vscode.window.showWarningMessage(
      details.toast,
      { modal: false, detail: details.message },
      ...actions,
    );
    if (selected === "Use bundled engine") {
      // Clear intentumdiff.executable at every level it is set so the launch chooser falls
      // through to the bundled native engine (issue 100 Phase C).
      const config = vscode.workspace.getConfiguration("intentumdiff");
      const inspected = config.inspect<string>("executable");
      if (inspected?.workspaceFolderValue !== undefined) {
        await config.update("executable", undefined, vscode.ConfigurationTarget.WorkspaceFolder);
      }
      if (inspected?.workspaceValue !== undefined) {
        await config.update("executable", undefined, vscode.ConfigurationTarget.Workspace);
      }
      if (inspected?.globalValue !== undefined) {
        await config.update("executable", undefined, vscode.ConfigurationTarget.Global);
      }
      this.restartAll();
      return;
    }
    if (selected === "Use workspace .venv" && suggestedExecutable) {
      await vscode.workspace
        .getConfiguration("intentumdiff")
        .update("executable", suggestedExecutable, vscode.ConfigurationTarget.Global);
      this.restartAll();
      return;
    }
    if (selected === "Open Setting") {
      await vscode.commands.executeCommand("workbench.action.openSettings", "intentumdiff.executable");
      return;
    }
    if (selected === "Show Output") {
      this.output.show();
    }
  }

  private handleDiff(folder: vscode.WorkspaceFolder, result: DiffResultEnvelope): void {
    const diff = result.response.diff;
    if (!diff) {
      return;
    }
    const incrementalRequest = this.incrementalReviewRequests.get(requestKey(folder.uri.toString(), result.seq));
    if (result.purpose === "review" && !incrementalRequest) {
      return;
    }
    if (incrementalRequest) {
      this.handleIncrementalReviewDiff(folder, result, incrementalRequest);
      return;
    }
    const uri = vscode.Uri.file(path.join(folder.uri.fsPath, result.path));
    this.applyDiffVisuals(uri, diff);
    this.liveIntentContexts.set(uri.toString(), {
      diff,
      folderUri: folder.uri.toString(),
      relativePath: result.path,
    });
    this.intentCodeLens.refresh();
    this.intentInlayHints.refresh();
    this.status.text = statusText(diff);
    this.output.appendLine(JSON.stringify({ path: result.path, summary: summarizeDiff(diff) }, null, 2));
  }

  private handleIncrementalReviewDiff(
    folder: vscode.WorkspaceFolder,
    result: DiffResultEnvelope,
    request: IncrementalReviewRequest,
  ): void {
    const key = requestKey(folder.uri.toString(), result.seq);
    this.incrementalReviewRequests.delete(key);
    const snapshotFile = this.reviewSnapshots.get(request.folderUri)
      ?.files.find((file) => file.relativePath === request.relativePath);
    if (
      request.generation !== this.reviewGeneration
      || !snapshotFile
      || snapshotFile.stamp !== request.stamp
      || snapshotFile.status !== request.status
    ) {
      return;
    }
    const diff = result.response.diff;
    if (!diff) {
      return;
    }
    const relativePath = request.relativePath;
    const normalizedDiff = normalizeReviewDiffFilenames(diff, relativePath, request.status);
    this.reviewFiles.set(reviewKey(request.folderUri, relativePath), {
      folderName: folder.name,
      folderUri: request.folderUri,
      relativePath,
      status: "ready",
      diff: normalizedDiff,
    });
    this.telemetry.recordFuelTelemetry(request.folderUri, relativePath, normalizedDiff);
    if (request.status !== "deleted") {
      const uri = vscode.Uri.file(path.join(folder.uri.fsPath, relativePath));
      this.applyDiffVisuals(uri, normalizedDiff);
    }
    this.updateReviewTree();
    this.finishReviewIfIdle();
    this.output.appendLine(JSON.stringify({
      incrementalReview: {
        path: relativePath,
        summary: summarizeDiff(normalizedDiff),
      },
      workspace: folder.name,
    }, null, 2));
  }

  private async tryCreateReviewSnapshot(folder: vscode.WorkspaceFolder): Promise<ReviewRefreshSnapshot | undefined> {
    try {
      return await createReviewSnapshot(folder);
    } catch (error) {
      this.output.appendLine(JSON.stringify({
        reviewSnapshot: {
          workspace: folder.name,
          phase: "request",
          error: messageOf(error),
        },
      }, null, 2));
      return undefined;
    }
  }

  private async recordReviewSnapshot(folder: vscode.WorkspaceFolder): Promise<void> {
    const generation = this.reviewGeneration;
    try {
      const snapshot = await createReviewSnapshot(folder);
      if (generation === this.reviewGeneration) {
        this.reviewSnapshots.set(folder.uri.toString(), snapshot);
      }
    } catch (error) {
      this.output.appendLine(JSON.stringify({
        reviewSnapshot: {
          workspace: folder.name,
          error: messageOf(error),
        },
      }, null, 2));
    }
  }

  private markReviewFilePending(
    folder: vscode.WorkspaceFolder,
    relativePath: string,
    pendingMessage: string,
  ): void {
    this.reviewFiles.set(reviewKey(folder.uri.toString(), relativePath), {
      folderName: folder.name,
      folderUri: folder.uri.toString(),
      relativePath,
      status: "pending",
      pendingMessage,
    });
  }

  private removeReviewFile(folder: vscode.WorkspaceFolder, relativePath: string): void {
    this.reviewFiles.delete(reviewKey(folder.uri.toString(), relativePath));
    const uri = vscode.Uri.file(path.join(folder.uri.fsPath, relativePath));
    this.clearDocumentVisuals(uri);
  }

  private async diffReviewFile(
    folder: vscode.WorkspaceFolder,
    file: ReviewRefreshFile,
  ): Promise<void> {
    const folderUri = folder.uri.toString();
    try {
      assertSafeRelativePath(file.relativePath);
      if (isImageLikePath(file.relativePath)) {
        const diff = imageAssetReviewDiff(folder, file);
        this.reviewFiles.set(reviewKey(folderUri, file.relativePath), {
          folderName: folder.name,
          folderUri,
          relativePath: file.relativePath,
          status: "ready",
          diff,
        });
        // The entry is ready now (the file IS a change); the perceptual comparison arrives
        // separately so one slow image cannot hold up the rest of the review.
        this.requestAssetDiff(folder, file.relativePath);
        this.updateReviewTree();
        this.finishReviewIfIdle();
        this.output.appendLine(JSON.stringify({
          imageAssetReview: {
            path: file.relativePath,
            status: file.status,
            summary: summarizeDiff(diff),
          },
          workspace: folder.name,
        }, null, 2));
        return;
      }
      const session = this.serverSessions.ensure(folder);
      const content = file.status === "deleted"
        ? ""
        : await readWorkingTreeFile(folder, file.relativePath);
      for (const [key, request] of this.incrementalReviewRequests.entries()) {
        if (request.folderUri === folderUri && request.relativePath === file.relativePath) {
          this.incrementalReviewRequests.delete(key);
        }
      }
      const seq = session.client.diff(file.relativePath, content, { purpose: "review" });
      this.incrementalReviewRequests.set(requestKey(folderUri, seq), {
        folderUri,
        relativePath: file.relativePath,
        seq,
        generation: this.reviewGeneration,
        stamp: file.stamp,
        status: file.status,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.reviewFiles.set(reviewKey(folderUri, file.relativePath), {
        folderName: folder.name,
        folderUri,
        relativePath: file.relativePath,
        status: "error",
        error: message,
      });
      this.updateReviewTree();
    }
  }

  private async refreshReview(reason: string = "refresh"): Promise<void> {
    if (!this.isEnabled()) {
      this.status.text = "IntentumDiff: disabled";
      return;
    }
    if (this.hasInFlightReviewWork()) {
      this.pendingReviewReason = reason;
      this.pendingReviewForceFull = true;
      this.reviewRefreshQueued = true;
      return;
    }
    this.reviewDispatching = true;
    this.cancelPendingReviewRefresh();
    this.status.text = "IntentumDiff: review queued";
    try {
      this.clearReview({ preserveRefreshState: true });
      this.baseContentProvider.clear();
      const dispatchGeneration = this.reviewGeneration;
      const folders = vscode.workspace.workspaceFolders ?? [];
      if (folders.length === 0) {
        this.status.text = "IntentumDiff: review clean";
        this.output.appendLine("Semantic review: no workspace folders found.");
        return;
      }

      this.status.text = `IntentumDiff: reviewing 0/${folders.length}`;
      for (const folder of folders) {
        const folderUri = folder.uri.toString();
        this.setReviewPlaceholder(
          folder,
          "Starting semantic review...",
        );
        try {
          const snapshot = await this.tryCreateReviewSnapshot(folder);
          if (this.reviewGeneration !== dispatchGeneration) {
            return;
          }
          for (const file of snapshot?.files ?? []) {
            this.markReviewFilePending(folder, file.relativePath, pendingMessageFor(file));
          }
          const session = this.serverSessions.ensure(folder);
          const reviewStreaming = session.client.ready?.capabilities?.review_streaming === true;
          const seq = session.client.review({
            oldRef: readLiveServerSettings().ref,
            ...(reviewStreaming ? { stream: true } : {}),
          });
          const key = requestKey(folderUri, seq);
          this.reviewRequests.set(key, { folderUri, seq, snapshot });
          this.setReviewPlaceholder(
            folder,
            `Review request sent (seq ${seq}); waiting for LiveServer response...`,
          );
          this.updateReviewTree();
          this.reviewSlowTimers.set(key, setTimeout(() => {
            this.reviewSlowTimers.delete(key);
            if (!this.reviewRequests.has(key)) {
              return;
            }
            this.setReviewPlaceholder(
              folder,
              `Still waiting for LiveServer review response (seq ${seq})...`,
            );
            this.output.appendLine(JSON.stringify({
              reviewPending: {
                workspace: folder.name,
                seq,
                message: "LiveServer has not returned a review response yet.",
              },
            }, null, 2));
            this.updateReviewTree();
          }, 15000));
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          this.reviewFiles.set(reviewKey(folderUri, ".intentumdiff-review"), {
            folderName: folder.name,
            folderUri,
            relativePath: ".intentumdiff-review",
            status: "error",
            error: message,
          });
        }
      }
      this.updateReviewTree();
      this.finishReviewIfIdle();
    } finally {
      this.reviewDispatching = false;
    }
  }

  private clearReview(options: { preserveRefreshState?: boolean } = {}): void {
    if (options.preserveRefreshState !== true) {
      this.cancelPendingReviewRefresh();
    }
    this.assetDiffRequests.clear();
    this.reviewGeneration += 1;
    for (const request of this.reviewRequests.values()) {
      const session = this.serverSessions.get(request.folderUri);
      if (session) {
        session.client.cancel(request.seq);
      }
    }
    this.reviewRequests.clear();
    for (const request of this.incrementalReviewRequests.values()) {
      const session = this.serverSessions.get(request.folderUri);
      if (session) {
        session.client.cancel(request.seq);
      }
    }
    this.incrementalReviewRequests.clear();
    this.streamedReviewFiles.clear();
    for (const timer of this.reviewSlowTimers.values()) {
      clearTimeout(timer);
    }
    this.reviewSlowTimers.clear();
    this.reviewFiles.clear();
    this.telemetry.clearFuelHistory();
    this.reviewCrossFileEntries = [];
    this.reviewSnapshots.clear();
    this.reviewPanelPayload = undefined;
    this.diffSurfaces.clear();
    this.navigationIndexes.clear();
    this.semanticLineHintCache.clear();
    this.reviewTree.clear();
    this.reviewDashboardProvider?.refresh();
    this.emptyContentProvider.clear();
    this.semanticOnlyContentProvider.clear();
    this.updateEditorContext();
  }

  private async openReviewPanel(
    argument: OpenReviewPayload | ReviewTreeNode | ReviewWebviewPayload | undefined,
  ): Promise<void> {
    const explicitPayload = normalizeOpenReviewPayload(argument as OpenReviewPayload | ReviewTreeNode | undefined);
    const activeDiffTabPayload = explicitPayload ? undefined : this.activeDiffTabReviewPayload();
    const payload = explicitPayload
      ?? this.diffSurfaces.active()?.payload
      ?? activeDiffTabPayload?.payload
      ?? this.activeEditorReviewPayload()
      ?? (activeDiffTabPayload?.sawDiff ? undefined : this.firstReadyReviewPayload());
    if (!payload?.relativePath) {
      const message = activeDiffTabPayload?.sawDiff
        ? "IntentumDiff: this diff is not in the current semantic review. Refresh Semantic Review, then try again."
        : "IntentumDiff: no reviewed file is available for the custom review panel.";
      void vscode.window.showInformationMessage(message);
      return;
    }
    try {
      assertSafeRelativePath(payload.relativePath);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      void vscode.window.showWarningMessage(`IntentumDiff: cannot open custom review: ${message}`);
      return;
    }
    const filePayload: OpenFileReviewPayload = { ...payload, relativePath: payload.relativePath };
    const model = await this.buildReviewPanelModelForPayload(filePayload);
    if (!model) {
      return;
    }
    this.reviewPanelPayload = filePayload;
    this.reviewPanelController?.open(model);
    // Draft the AI release narrative in the background (opt-in); refresh the panel
    // when it resolves. Non-blocking so the deterministic notes show immediately.
    void this.attachReleaseNarrative(filePayload, model);
  }

  /**
   * When the LLM explainer is enabled, draft a release narrative from the derived
   * (privacy-safe) notes and re-open the panel with it — if the panel still shows
   * this file. Never blocks the initial render.
   */
  private async attachReleaseNarrative(
    payload: OpenFileReviewPayload,
    model: ReturnType<typeof buildReviewPanelModel>,
  ): Promise<void> {
    if (!this.intentLlmExplainer?.isEnabled()) {
      return;
    }
    const notes = buildReleaseNotes(model.diff);
    const tokenSource = new vscode.CancellationTokenSource();
    try {
      const narrative = await this.intentLlmExplainer.draftReleaseNarrative(notes, tokenSource.token);
      if (!narrative) {
        return;
      }
      if (
        this.reviewPanelPayload?.relativePath === payload.relativePath
        && this.reviewPanelPayload?.folderUri === payload.folderUri
      ) {
        this.reviewPanelController?.open({ ...model, releaseNarrative: narrative });
      }
    } finally {
      tokenSource.dispose();
    }
  }

  private async openReviewPanelNativeDiff(mode: NativeDiffMode): Promise<void> {
    if (!this.reviewPanelPayload) {
      void vscode.window.showInformationMessage("IntentumDiff: no custom review panel is active.");
      return;
    }
    await this.diffSurfaces.open(this.reviewPanelPayload, mode);
  }

  private async buildReviewPanelModelForPayload(
    filePayload: OpenFileReviewPayload,
  ): Promise<ReturnType<typeof buildReviewPanelModel> | undefined> {
    const file = this.reviewFiles.get(reviewKey(filePayload.folderUri, filePayload.relativePath));
    if (!file || file.status !== "ready" || !file.diff || file.relativePath === ".intentumdiff-review") {
      // A review that has not finished is an ordinary, expected state — not something the
      // user must act on. Raising a notification for it made "not finished yet" and
      // "something is wrong" look identical, and it is the first thing a new user sees.
      // A transient status-bar message says the same thing without the alarm. (#24)
      vscode.window.setStatusBarMessage("IntentumDiff: preparing semantic review…", 3000);
      return undefined;
    }
    const folderUri = vscode.Uri.parse(filePayload.folderUri);
    const workingUri = vscode.Uri.file(path.join(folderUri.fsPath, filePayload.relativePath));
    const modifiedUri = await existingOrEmptyModifiedUri(
      workingUri,
      this.emptyContentProvider,
      filePayload.folderUri,
      filePayload.relativePath,
    );
    const ref = readLiveServerSettings().ref;
    const baseUri = this.baseContentProvider.createUri({
      folderUri: filePayload.folderUri,
      ref,
      relativePath: filePayload.relativePath,
      cacheNonce: this.reviewSnapshots.get(filePayload.folderUri)?.resolvedCommit,
    });
    const contextLines = readReviewDiffContextLines();
    if (isImageLikePath(filePayload.relativePath)) {
      // The perceptual comparison is already on the review entry (or on its way there via the
      // engine's asset_diff response); the panel renders what the engine returned.
      return buildReviewPanelModel(file, "", "", ref, { contextLines });
    }
    const [baseDocument, modifiedDocument] = await Promise.all([
      vscode.workspace.openTextDocument(baseUri),
      vscode.workspace.openTextDocument(modifiedUri),
    ]);
    return buildReviewPanelModel(file, baseDocument.getText(), modifiedDocument.getText(), ref, { contextLines });
  }

  private activeEditorReviewPayload(): OpenFileReviewPayload | undefined {
    const document = vscode.window.activeTextEditor?.document;
    if (!document) {
      return undefined;
    }
    const target = this.resolveDocument(document);
    if (!target) {
      return undefined;
    }
    return this.reviewPayloadForWorkspaceTarget(target);
  }

  private activeDiffTabReviewPayload(): { sawDiff: boolean; payload?: OpenFileReviewPayload } {
    const input = vscode.window.tabGroups.activeTabGroup.activeTab?.input;
    if (!isTextDiffTabInput(input)) {
      return { sawDiff: false };
    }
    const payload = this.reviewPayloadForUri(input.modified)
      ?? this.reviewPayloadForUri(input.original);
    return { sawDiff: true, payload };
  }

  private reviewPayloadForUri(uri: vscode.Uri | undefined): OpenFileReviewPayload | undefined {
    if (!uri) {
      return undefined;
    }
    if (uri.scheme === BASE_SCHEME) {
      try {
        const identity = decodeBaseIdentity(uri.query);
        const target = this.resolveWorkspaceUri(vscode.Uri.parse(identity.folderUri));
        if (!target) {
          return undefined;
        }
        return this.reviewPayloadForWorkspaceTarget({
          folder: target.folder,
          relativePath: identity.relativePath,
        });
      } catch {
        return undefined;
      }
    }
    if (uri.scheme === SEMANTIC_BASE_SCHEME || uri.scheme === SEMANTIC_MODIFIED_SCHEME) {
      try {
        const identity = decodeSemanticOnlyIdentity(uri);
        const target = this.resolveWorkspaceUri(vscode.Uri.parse(identity.folderUri));
        if (!target) {
          return undefined;
        }
        return this.reviewPayloadForWorkspaceTarget({
          folder: target.folder,
          relativePath: identity.relativePath,
        });
      } catch {
        return undefined;
      }
    }
    const context = this.diffSurfaces.get(uri.toString());
    if (context) {
      return context.payload;
    }
    const target = this.resolveWorkspaceLikeUri(uri);
    return target ? this.reviewPayloadForWorkspaceTarget(target) : undefined;
  }

  private reviewPayloadForWorkspaceTarget(
    target: { folder: vscode.WorkspaceFolder; relativePath: string },
  ): OpenFileReviewPayload | undefined {
    const file = this.reviewFiles.get(reviewKey(target.folder.uri.toString(), target.relativePath));
    if (!file || file.status !== "ready" || !file.diff || file.relativePath === ".intentumdiff-review") {
      return undefined;
    }
    return {
      folderUri: target.folder.uri.toString(),
      relativePath: target.relativePath,
    };
  }

  private firstReadyReviewPayload(): OpenFileReviewPayload | undefined {
    for (const file of this.reviewFiles.values()) {
      if (file.status === "ready" && file.diff && file.relativePath !== ".intentumdiff-review") {
        return {
          folderUri: file.folderUri,
          relativePath: file.relativePath,
        };
      }
    }
    return undefined;
  }

  private refreshReviewWebviews(): void {
    this.reviewDashboardProvider?.refresh();
    if (this.reviewPanelPayload) {
      void this.refreshOpenReviewPanel();
    }
  }

  private async refreshOpenReviewPanel(): Promise<void> {
    if (!this.reviewPanelPayload) {
      return;
    }
    const model = await this.buildReviewPanelModelForPayload(this.reviewPanelPayload);
    if (model) {
      this.reviewPanelController?.refresh(model);
    }
  }

  /**
   * VS Code restores open editors across window reloads. A base diff tab whose
   * left side is an untracked directory (a stale `.claude/`-style entry from before
   * directories were filtered out of the review) re-opens and fails on every
   * reload. Close those tabs on activation so the error does not keep reappearing.
   */
  private closeStaleBaseDirectoryTabs(): void {
    try {
      const groups = vscode.window.tabGroups;
      if (!groups) {
        return;
      }
      const stale: vscode.Tab[] = [];
      for (const group of groups.all) {
        for (const tab of group.tabs) {
          const input = tab.input as { original?: unknown; modified?: unknown; uri?: unknown } | undefined;
          const uris = [input?.original, input?.modified, input?.uri].filter(
            (value): value is vscode.Uri => value instanceof vscode.Uri,
          );
          const isStaleDirectory = uris.some((uri) => {
            if (uri.scheme !== BASE_SCHEME) {
              return false;
            }
            try {
              const { relativePath } = decodeBaseIdentity(uri.query);
              return relativePath.endsWith("/") || relativePath.endsWith("\\");
            } catch {
              // decodeBaseIdentity now throws for directory paths (and any other
              // malformed base query); a base tab that cannot decode is stale.
              return true;
            }
          });
          if (isStaleDirectory) {
            stale.push(tab);
          }
        }
      }
      if (stale.length > 0) {
        void groups.close(stale, true);
        this.output.appendLine(`IntentumDiff: closed ${stale.length} stale base directory diff tab(s).`);
      }
    } catch (error) {
      this.output.appendLine(`IntentumDiff: stale base tab cleanup skipped: ${messageOf(error)}`);
    }
  }

  /** Resolve the intent-lens context for a diff document URI (base or modified). */
  private intentLensContext(uri: vscode.Uri): IntentLensContext | undefined {
    const context = this.diffSurfaces.get(uri.toString());
    if (context) {
      const side: IntentSide = uri.toString() === context.baseUri.toString() ? "base" : "modified";
      return {
        diff: context.diff,
        mode: context.mode,
        side,
        folderUri: context.folderUri,
        relativePath: context.relativePath,
      };
    }
    // Fall back to the live diff so lenses appear on the working buffer itself.
    const live = this.liveIntentContexts.get(uri.toString());
    if (live) {
      return {
        diff: live.diff,
        mode: "full",
        side: "modified",
        folderUri: live.folderUri,
        relativePath: live.relativePath,
      };
    }
    return undefined;
  }

  private workingUriFor(folderUri: string, relativePath: string): vscode.Uri {
    return vscode.Uri.file(path.join(vscode.Uri.parse(folderUri).fsPath, relativePath));
  }

  private liveIntentContextFor(folderUri: string, relativePath: string): SemanticDiff | undefined {
    return this.liveIntentContexts.get(this.workingUriFor(folderUri, relativePath).toString())?.diff;
  }

  /**
   * CodeLens intent action: reveal the hunk and open a native Peek of the
   * counterpart ("before"/"after") location when one exists; otherwise reveal
   * and surface the derived category/risk.
   */
  private async peekIntent(args?: PeekIntentArgs): Promise<void> {
    if (!args) {
      return;
    }
    // Prefer an open diff editor (enables a native before/after Peek); otherwise
    // fall back to the live diff on the working buffer.
    const context = this.diffSurfaces.forFile(args.folderUri, args.relativePath);
    const diff = context?.diff ?? this.liveIntentContextFor(args.folderUri, args.relativePath);
    if (!diff) {
      return;
    }
    const sourceUri = args.side === "base" && context
      ? context.baseUri
      : context?.modifiedUri ?? this.workingUriFor(args.folderUri, args.relativePath);
    const sourcePosition = new vscode.Position(Math.max(args.line, 0), 0);
    const group = (diff.change_groups ?? [])[args.groupIndex];
    if (context) {
      const otherSide: IntentSide = args.side === "base" ? "modified" : "base";
      const counterpart = buildIntentLenses(diff, otherSide)
        .find((lens) => lens.groupIndex === args.groupIndex);
      if (counterpart) {
        const counterpartUri = otherSide === "base" ? context.baseUri : context.modifiedUri;
        await vscode.commands.executeCommand(
          "editor.action.showReferences",
          sourceUri,
          sourcePosition,
          [new vscode.Location(counterpartUri, new vscode.Position(Math.max(counterpart.line, 0), 0))],
        );
        return;
      }
    }
    // No counterpart line (pure addition/deletion) or live-only buffer: reveal
    // and surface the derived category/risk.
    const editor = await vscode.window.showTextDocument(sourceUri, { preview: false });
    editor.selection = new vscode.Selection(sourcePosition, sourcePosition);
    editor.revealRange(new vscode.Range(sourcePosition, sourcePosition), vscode.TextEditorRevealType.InCenterIfOutsideViewport);
    if (group) {
      const risk = riskForKind(group.kind);
      const label = categoryForKind(group.kind)?.label ?? group.kind;
      void vscode.window.showInformationMessage(
        `IntentumDiff${risk ? ` · ${risk === "behavior" ? "Behavior" : "Internal"}` : ""}: ${label}`,
      );
    }
  }

  private async navigateSemanticChange(direction: 1 | -1): Promise<void> {
    const context = this.diffSurfaces.active();
    if (!context?.diff) {
      void vscode.window.showInformationMessage("IntentumDiff: no semantic diff is active.");
      return;
    }
    const targets = selectedChanges(context.diff, readSemanticOnlyOptions(this.hideComments))
      .map(({ change, index }) => ({
        change,
        index,
        target: reviewTargetForChange(change),
      }))
      .filter((item): item is {
        change: NonNullable<typeof item.change>;
        index: number;
        target: NonNullable<ReturnType<typeof reviewTargetForChange>>;
      } => item.target !== undefined);
    if (targets.length === 0) {
      void vscode.window.showInformationMessage("IntentumDiff: no visible semantic changes to navigate.");
      return;
    }
    const key = `${context.folderUri}::${context.relativePath}::${context.mode}`;
    const current = this.navigationIndexes.get(key) ?? (direction > 0 ? -1 : targets.length);
    const next = (current + direction + targets.length) % targets.length;
    this.navigationIndexes.set(key, next);
    const target = targets[next];
    await this.diffSurfaces.reveal(context, {
      ...context.payload,
      position: target.target.position,
      positionSide: target.target.side,
      change: target.change,
    });
  }

  private async adjustSemanticContextLines(delta: 1 | -1): Promise<void> {
    const config = vscode.workspace.getConfiguration("intentumdiff");
    const current = Math.max(0, config.get("diff.contextLines", 3));
    const next = Math.max(0, current + delta);
    if (next === current) {
      void vscode.window.showInformationMessage("IntentumDiff: semantic-only context is already collapsed.");
      return;
    }
    await config.update("diff.contextLines", next, vscode.ConfigurationTarget.Workspace);
    this.status.text = `IntentumDiff: semantic context ${next}`;
    this.updateEditorContext();
    await this.diffSurfaces.refreshOpenSemanticOnly();
  }

  private async revealActiveFileInReview(): Promise<void> {
    const document = vscode.window.activeTextEditor?.document;
    if (!document) {
      return;
    }
    const target = this.resolveDocument(document);
    if (!target) {
      return;
    }
    const node = this.reviewTree.revealFile(target.relativePath);
    if (node) {
      const targetView = this.reviewView?.visible
        ? this.reviewView
        : this.scmReviewView?.visible
          ? this.scmReviewView
          : this.reviewView ?? this.scmReviewView;
      await targetView?.reveal(node, { focus: true, select: true, expand: true });
    }
  }

  private handleReviewResult(folder: vscode.WorkspaceFolder, result: ReviewResultEnvelope): void {
    const request = this.reviewRequests.get(requestKey(folder.uri.toString(), result.seq));
    if (!request) {
      return;
    }
    this.resetReviewFailureStreak();
    this.completeReviewRequest(folder.uri.toString(), result.seq);
    this.applyCommitReview(folder, result.commitDiff);
    // The engine skips binary/image assets (they are not text-diffable), so they
    // never appear in commit_diff.file_diffs. Reconcile any snapshot file still
    // "pending" here, or it would hang the review at "Refreshing...".
    this.reconcileSkippedReviewFiles(folder, request.snapshot);
    if (request.snapshot) {
      this.reviewSnapshots.set(folder.uri.toString(), request.snapshot);
    } else {
      void this.recordReviewSnapshot(folder);
    }
    this.updateReviewTree();
    this.output.appendLine(JSON.stringify({
      review: {
        files: result.commitDiff.file_diffs?.length ?? 0,
        guardrails: result.commitDiff.guardrail_violations?.length ?? 0,
        crossFileChanges: result.commitDiff.cross_file_changes?.length ?? 0,
        parseErrors: result.commitDiff.parse_errors?.length ?? 0,
        fileNames: (result.commitDiff.file_diffs ?? [])
          .map((diff) => diff.new_filename || diff.old_filename || "unknown")
          .slice(0, 25),
      },
      workspace: folder.name,
    }, null, 2));
    this.finishReviewIfIdle();
  }

  private handleReviewFile(folder: vscode.WorkspaceFolder, result: ReviewFileEnvelope): void {
    const request = this.reviewRequests.get(requestKey(folder.uri.toString(), result.seq));
    if (!request) {
      return;
    }
    const folderUri = folder.uri.toString();
    const relativePath = result.newFilename || result.oldFilename || "unknown";
    if (relativePath === ".intentumdiff-review" || relativePath === "unknown") {
      return;
    }
    const reviewFile: ReviewFile = {
      folderName: folder.name,
      folderUri,
      relativePath,
      status: "ready",
      diff: result.fileDiff,
    };
    this.reviewFiles.set(reviewKey(folderUri, relativePath), reviewFile);
    let streamed = this.streamedReviewFiles.get(folderUri);
    if (!streamed) {
      streamed = new Set();
      this.streamedReviewFiles.set(folderUri, streamed);
    }
    streamed.add(relativePath);
    this.telemetry.recordFuelTelemetry(folderUri, relativePath, result.fileDiff);
    this.updateReviewTree();
    this.output.appendLine(JSON.stringify({
      streamedReviewFile: {
        path: relativePath,
        index: result.index,
      },
      workspace: folder.name,
    }, null, 2));
  }

  /** Count at most ONE failure per review generation so ten per-file errors in a single
   *  dispatch don't exhaust the retry budget in one cycle. */
  private recordReviewFailure(message: string, code?: string): void {
    this.lastReviewFailure = { code, message };
    if (this.reviewFailureGeneration !== this.reviewGeneration) {
      this.reviewFailureGeneration = this.reviewGeneration;
      this.reviewFailureStreak += 1;
    }
  }

  private resetReviewFailureStreak(): void {
    this.reviewFailureStreak = 0;
    this.reviewFailureGeneration = -1;
    this.lastReviewFailure = undefined;
    this.reviewRetrySuppressedLogged = false;
  }

  /** Non-empty reason when automatic review dispatch should pause (issue 123): the last failure is
   *  deterministic (retrying the same input cannot help), or the configurable retry budget is
   *  spent. Manual refresh / restart / any file change resets the streak and resumes. */
  private autoReviewRetrySuppression(): string | undefined {
    if (this.reviewFailureStreak === 0) {
      return undefined;
    }
    const code = this.lastReviewFailure?.code;
    if (code && this.nonRetryableReviewCodes.has(code)) {
      return "last review failed with non-retryable '" + code + "'";
    }
    const maxRetries = readReviewMaxAutoRetries();
    if (this.reviewFailureStreak > maxRetries) {
      return "review failed " + this.reviewFailureStreak
        + " times (intentumdiff.review.maxAutoRetries = " + maxRetries + ")";
    }
    return undefined;
  }

  private handleReviewError(
    folder: vscode.WorkspaceFolder,
    seq: number,
    message: string,
    code?: string,
  ): boolean {
    const key = requestKey(folder.uri.toString(), seq);
    const request = this.reviewRequests.get(key);
    if (!request) {
      return false;
    }
    this.recordReviewFailure(message, code);
    this.completeReviewRequest(folder.uri.toString(), seq);
    this.reviewFiles.set(reviewKey(folder.uri.toString(), ".intentumdiff-review"), {
      folderName: folder.name,
      folderUri: folder.uri.toString(),
      relativePath: ".intentumdiff-review",
      status: "error",
      error: message,
    });
    this.updateReviewTree();
    this.finishReviewIfIdle();
    return true;
  }

  private handleIncrementalReviewError(
    folder: vscode.WorkspaceFolder,
    seq: number,
    message: string,
    code?: string,
  ): boolean {
    const key = requestKey(folder.uri.toString(), seq);
    const request = this.incrementalReviewRequests.get(key);
    if (!request) {
      return false;
    }
    this.incrementalReviewRequests.delete(key);
    if (request.generation !== this.reviewGeneration) {
      return true;
    }
    this.recordReviewFailure(message, code);
    this.reviewFiles.set(reviewKey(request.folderUri, request.relativePath), {
      folderName: folder.name,
      folderUri: request.folderUri,
      relativePath: request.relativePath,
      status: "error",
      error: message,
    });
    this.updateReviewTree();
    this.finishReviewIfIdle();
    return true;
  }

  /**
   * Ask the engine to compare one image against the review ref.
   *
   * Only a repo-relative path and the ref go over the wire — the base version lives in git's
   * object store and the engine materialises it. Nothing here opens, decodes, or describes an
   * image; the panel shows a comparison only once `handleAssetDiff` has one to show.
   */
  private requestAssetDiff(folder: vscode.WorkspaceFolder, relativePath: string): void {
    const folderUri = folder.uri.toString();
    for (const [key, request] of this.assetDiffRequests.entries()) {
      if (request.folderUri === folderUri && request.relativePath === relativePath) {
        this.assetDiffRequests.delete(key);
      }
    }
    try {
      const session = this.serverSessions.ensure(folder);
      const seq = session.client.assetDiff(relativePath, { ref: readLiveServerSettings().ref });
      this.assetDiffRequests.set(requestKey(folderUri, seq), {
        folderUri,
        relativePath,
        generation: this.reviewGeneration,
      });
    } catch (error) {
      this.applyAssetDiffOutcome(folderUri, relativePath, (diff) =>
        withAssetDiffFailure(diff, messageOf(error)));
    }
  }

  private handleAssetDiff(folder: vscode.WorkspaceFolder, result: AssetDiffEnvelope): void {
    const key = requestKey(folder.uri.toString(), result.seq);
    const request = this.assetDiffRequests.get(key);
    if (!request) {
      return;
    }
    this.assetDiffRequests.delete(key);
    if (request.generation !== this.reviewGeneration) {
      return;
    }
    this.applyAssetDiffOutcome(request.folderUri, request.relativePath, (diff) =>
      withEngineAssetDiff(diff, result.manifest));
    this.output.appendLine(JSON.stringify({
      assetDiff: {
        path: request.relativePath,
        status: result.manifest.status ?? "unknown",
        artifacts: Object.keys((result.manifest.artifacts as Record<string, unknown>) ?? {}),
      },
      workspace: folder.name,
    }, null, 2));
  }

  private handleAssetDiffError(folder: vscode.WorkspaceFolder, seq: number, message: string): boolean {
    const key = requestKey(folder.uri.toString(), seq);
    const request = this.assetDiffRequests.get(key);
    if (!request) {
      return false;
    }
    this.assetDiffRequests.delete(key);
    if (request.generation === this.reviewGeneration) {
      // A failed perceptual compare does not fail the file's review — the image is still a
      // reviewable change. Only the perceptual half is unavailable, and it says so.
      this.applyAssetDiffOutcome(request.folderUri, request.relativePath, (diff) =>
        withAssetDiffFailure(diff, message));
    }
    return true;
  }

  /** Rewrite a ready image entry's diff in place and refresh whatever is showing it. */
  private applyAssetDiffOutcome(
    folderUri: string,
    relativePath: string,
    apply: (diff: SemanticDiff) => SemanticDiff,
  ): void {
    const key = reviewKey(folderUri, relativePath);
    const existing = this.reviewFiles.get(key);
    if (!existing?.diff) {
      return;
    }
    this.reviewFiles.set(key, { ...existing, diff: apply(existing.diff) });
    this.updateReviewTree();
    void this.refreshOpenReviewPanel();
  }

  private applyCommitReview(folder: vscode.WorkspaceFolder, commitDiff: CommitDiff): void {
    const folderUri = folder.uri.toString();
    const streamed = this.streamedReviewFiles.get(folderUri);
    this.streamedReviewFiles.delete(folderUri);
    this.reviewFiles.delete(reviewKey(folderUri, ".intentumdiff-review"));
    for (const diff of commitDiff.file_diffs ?? []) {
      const relativePath = diff.new_filename || diff.old_filename || "unknown";
      this.reviewFiles.set(reviewKey(folderUri, relativePath), {
        folderName: folder.name,
        folderUri,
        relativePath,
        status: "ready",
        diff,
      });
      if (!streamed?.has(relativePath)) {
        this.telemetry.recordFuelTelemetry(folderUri, relativePath, diff);
      }
    }
    if ((commitDiff.parse_errors?.length ?? 0) > 0) {
      this.reviewFiles.set(reviewKey(folderUri, ".intentumdiff-review"), {
        folderName: folder.name,
        folderUri,
        relativePath: ".intentumdiff-review",
        status: "error",
        error: commitDiff.parse_errors?.slice(0, 5).join("\n"),
      });
    }
    this.reviewCrossFileEntries.push(...reviewEntriesForCrossFileChanges(
      commitDiff.cross_file_changes ?? [],
      folderUri,
    ));
    const hasReviewContent = (commitDiff.file_diffs?.length ?? 0) > 0
      || (commitDiff.parse_errors?.length ?? 0) > 0
      || (commitDiff.cross_file_changes?.length ?? 0) > 0;
    if (!hasReviewContent) {
      this.reviewFiles.set(reviewKey(folderUri, ".intentumdiff-review"), {
        folderName: folder.name,
        folderUri,
        relativePath: ".intentumdiff-review",
        status: "ready",
        diff: {
          old_filename: ".intentumdiff-review",
          new_filename: ".intentumdiff-review",
          language: "generic",
          changes: [],
          change_groups: [],
          guardrail_violations: [],
          parse_errors: [],
          has_semantic_changes: false,
          is_style_only: false,
        },
      });
    }
  }

  /**
   * Mark any snapshot file the engine skipped (binary/image assets the semantic
   * text engine does not diff) as `ready`, so the streaming review can finish.
   * Images get the perceptual asset preview; other binaries get a non-text-asset
   * entry. Files the engine did report are left untouched.
   */
  private reconcileSkippedReviewFiles(
    folder: vscode.WorkspaceFolder,
    snapshot: ReviewRefreshSnapshot | undefined,
  ): void {
    if (!snapshot) {
      return;
    }
    const folderUri = folder.uri.toString();
    for (const file of snapshot.files) {
      const key = reviewKey(folderUri, file.relativePath);
      const existing = this.reviewFiles.get(key);
      if (!existing || existing.status !== "pending") {
        continue;
      }
      const isImage = isImageLikePath(file.relativePath);
      const diff = isImage
        ? imageAssetReviewDiff(folder, file)
        : nonTextAssetReviewDiff(file);
      this.reviewFiles.set(key, {
        folderName: folder.name,
        folderUri,
        relativePath: file.relativePath,
        status: "ready",
        diff,
      });
      if (isImage) {
        this.requestAssetDiff(folder, file.relativePath);
      }
    }
  }

  private setReviewPlaceholder(folder: vscode.WorkspaceFolder, pendingMessage: string): void {
    this.reviewFiles.set(reviewKey(folder.uri.toString(), ".intentumdiff-review"), {
      folderName: folder.name,
      folderUri: folder.uri.toString(),
      relativePath: ".intentumdiff-review",
      status: "pending",
      pendingMessage,
    });
  }

  private completeReviewRequest(folderUri: string, seq: number): void {
    const key = requestKey(folderUri, seq);
    this.reviewRequests.delete(key);
    const timer = this.reviewSlowTimers.get(key);
    if (timer) {
      clearTimeout(timer);
      this.reviewSlowTimers.delete(key);
    }
  }

  private updateReviewTree(): void {
    const roots = new Map<string, string>();
    for (const folder of vscode.workspace.workspaceFolders ?? []) {
      roots.set(folder.uri.toString(), folder.name);
    }
    this.reviewTree.setReview([...this.reviewFiles.values()], this.reviewCrossFileEntries, roots);
    this.reviewTimeline.setReviewFiles([...this.reviewFiles.values()]);
    this.refreshReviewWebviews();
  }

  private finishReviewIfIdle(): void {
    const pendingCount = this.reviewRequests.size + this.incrementalReviewRequests.size;
    if (pendingCount > 0) {
      this.status.text = `IntentumDiff: reviewing ${pendingCount} pending`;
      return;
    }
    this.updateReviewTree();
    this.telemetry.recordTimelineSnapshot();
    const summary = summarizeReviewWithCrossFile(
      [...this.reviewFiles.values()],
      this.reviewCrossFileEntries.map((entry) => entry.change),
    );
    if (summary.guardrailCount > 0) {
      this.status.text = `IntentumDiff: review ${summary.guardrailCount} guardrail`;
    } else if (summary.errorCount > 0) {
      this.status.text = `IntentumDiff: review ${summary.errorCount} error`;
    } else if (summary.crossFileChangeCount > 0) {
      this.status.text = `IntentumDiff: review ${summary.crossFileChangeCount} cross-file`;
    } else {
      this.status.text = `IntentumDiff: review ${summary.semanticChangeCount} changes`;
    }
    this.output.appendLine(JSON.stringify({ reviewSummary: summary }, null, 2));
    this.drainQueuedReviewRefresh();
  }

  private drainQueuedReviewRefresh(): void {
    if (!this.reviewRefreshQueued) {
      return;
    }
    const reason = this.pendingReviewReason;
    const forceFull = this.pendingReviewForceFull;
    this.reviewRefreshQueued = false;
    this.pendingReviewForceFull = false;
    this.scheduleReviewRefresh(reason, { forceFull });
  }

  private applyCachedDecorations(editor: vscode.TextEditor): void {
    this.applyDecorations(
      editor,
      this.filterDecorations(this.decorationCache.get(editor.document.uri.toString()) ?? []),
    );
    this.applySemanticLineHints(editor);
  }

  private applyDecorations(editor: vscode.TextEditor, decorations: DecorationLike[]): void {
    const byKind = new Map<DecorationLike["kind"], vscode.DecorationOptions[]>();
    for (const decoration of decorations) {
      const options = toDecorationOption(decoration);
      if (decoration.kind === "inlineDeletionWord") {
        options.range = wordRangeForInlineDeletion(editor, options.range);
      }
      const current = byKind.get(decoration.kind) ?? [];
      current.push(options);
      byKind.set(decoration.kind, current);
    }
    for (const [kind, decorationType] of Object.entries(this.decorationTypes)) {
      editor.setDecorations(
        decorationType,
        byKind.get(kind as DecorationLike["kind"]) ?? [],
      );
    }
  }

  private resolveDocument(document: vscode.TextDocument):
    | { folder: vscode.WorkspaceFolder; relativePath: string }
    | undefined {
    if (document.uri.scheme !== "file" || document.isUntitled) {
      return undefined;
    }
    return this.resolveWorkspaceUri(document.uri);
  }

  private resolveWorkspaceLikeUri(uri: vscode.Uri):
    | { folder: vscode.WorkspaceFolder; relativePath: string }
    | undefined {
    if (uri.scheme === "file") {
      return this.resolveWorkspaceUri(uri);
    }
    if (uri.scheme === "git") {
      const candidate = workspaceFileUriFromGitUri(uri);
      return candidate ? this.resolveWorkspaceUri(candidate) : undefined;
    }
    return undefined;
  }

  private resolveWorkspaceUri(uri: vscode.Uri):
    | { folder: vscode.WorkspaceFolder; relativePath: string }
    | undefined {
    if (uri.scheme !== "file") {
      return undefined;
    }
    const folder = vscode.workspace.getWorkspaceFolder(uri);
    if (!folder) {
      return undefined;
    }
    const relative = path.relative(folder.uri.fsPath, uri.fsPath);
    if (relative.startsWith("..") || path.isAbsolute(relative)) {
      return undefined;
    }
    return {
      folder,
      relativePath: relative.split(path.sep).join("/"),
    };
  }

  private isEnabled(): boolean {
    return !this.paused && readLiveServerSettings().enabled;
  }

  private clearTimers(): void {
    for (const timer of this.timers.values()) {
      clearTimeout(timer);
    }
    this.timers.clear();
    if (this.reviewRefreshTimer) {
      clearTimeout(this.reviewRefreshTimer);
      this.reviewRefreshTimer = undefined;
    }
    this.reviewPolling.stopPolling();
  }

  private clearVisuals(): void {
    this.diagnostics.clear();
    this.decorationCache.clear();
    this.semanticLineHintCache.clear();
    this.liveIntentContexts.clear();
    this.intentCodeLens.refresh();
    this.intentInlayHints.refresh();
    for (const editor of vscode.window.visibleTextEditors) {
      this.applyDecorations(editor, []);
      editor.setDecorations(this.semanticLineHintDecoration, []);
    }
  }

  private applyDiffVisuals(uri: vscode.Uri, diff: SemanticDiff): void {
    if (diff.is_fallback === true && !fallbackDiffEnabled()) {
      this.diagnostics.set(uri, [new vscode.Diagnostic(
        new vscode.Range(0, 0, 0, 1),
        "IntentumDiff fallback diff is disabled for this file.",
        vscode.DiagnosticSeverity.Warning,
      )]);
      this.setDecorationsForUri(uri, []);
      return;
    }
    this.diagnostics.set(uri, this.overlaysVisible ? diffToDiagnostics(diff).map(toVsDiagnostic) : []);
    this.setDecorationsForUri(uri, diffToModifiedDecorations(diff));
  }

  private applyBaseDiffVisuals(uri: vscode.Uri, diff: SemanticDiff): void {
    this.setDecorationsForUri(uri, diffToBaseDecorations(diff));
  }

  private filterDecorations(decorations: DecorationLike[]): DecorationLike[] {
    if (!this.overlaysVisible) {
      return [];
    }
    const config = vscode.workspace.getConfiguration("intentumdiff");
    const showAdditions = config.get("visualization.showAdditions", true);
    const showDeletions = config.get("visualization.showDeletions", true);
    const showModifications = config.get("visualization.showModifications", true);
    const inlineDeletionMarkers = config.get("visualization.inlineDeletionMarkers", true);
    const movedCode = config.get("visualization.movedCode", true);
    return decorations.filter((decoration) => {
      if (this.hideComments && decoration.isComment === true) {
        return false;
      }
      if (!showAdditions && decoration.kind === "addition") {
        return false;
      }
      if (!showDeletions && (
        decoration.kind === "deletion"
        || decoration.kind === "inlineDeletionWord"
        || decoration.kind === "inlineDeletionGap"
      )) {
        return false;
      }
      if (!showModifications && decoration.kind === "modification") {
        return false;
      }
      if (!inlineDeletionMarkers && (
        decoration.kind === "inlineDeletionWord"
        || decoration.kind === "inlineDeletionGap"
      )) {
        return false;
      }
      if (!movedCode && (
        decoration.kind === "move"
        || decoration.kind === "refactoring"
      )) {
        return false;
      }
      return true;
    });
  }

  private readVisualSettings(): void {
    const config = vscode.workspace.getConfiguration("intentumdiff");
    this.hideComments = config.get("diff.hideComments", false);
  }

  private updateEditorContext(): void {
    const activeContext = this.diffSurfaces.active();
    void vscode.commands.executeCommand("setContext", "intentumdiff.editorDiffVisible", this.overlaysVisible);
    void vscode.commands.executeCommand("setContext", "intentumdiff.hideComments", this.hideComments);
    void vscode.commands.executeCommand("setContext", "intentumdiff.inSemanticDiff", activeContext !== undefined);
    void vscode.commands.executeCommand("setContext", "intentumdiff.semanticOnlyDiffVisible", activeContext?.mode === "semanticOnly");
    this.updateDiffStatus(activeContext);
  }

  private updateDiffStatus(activeContext: OpenedDiffContext | undefined): void {
    if (!activeContext) {
      this.diffStatus.hide();
      return;
    }
    const options = readSemanticOnlyOptions(this.hideComments);
    const visibleFilters = [
      options.showAdditions ? "additions" : undefined,
      options.showDeletions ? "deletions" : undefined,
      options.showModifications ? "modifications" : undefined,
      options.movedCode ? "moves" : undefined,
      !options.hideComments ? "comments" : undefined,
    ].filter((item): item is string => item !== undefined);
    if (activeContext.mode === "semanticOnly") {
      this.diffStatus.text = `$(filter) IntentumDiff semantic-only (${options.contextLines} ctx)`;
      this.diffStatus.command = "intentumdiff.openFullDiff";
      this.diffStatus.tooltip = [
        "IntentumDiff semantic-only native diff",
        `Context lines: ${options.contextLines}`,
        `Visible: ${visibleFilters.join(", ") || "none"}`,
        "Click to switch to the full VS Code diff.",
      ].join("\n");
    } else {
      this.diffStatus.text = "$(diff) IntentumDiff full diff";
      this.diffStatus.command = "intentumdiff.openSemanticOnlyDiff";
      this.diffStatus.tooltip = [
        "IntentumDiff full VS Code diff",
        `Semantic-only context lines: ${options.contextLines}`,
        `Semantic-only visible filters: ${visibleFilters.join(", ") || "none"}`,
        "Click to switch to semantic-only diff.",
      ].join("\n");
    }
    this.diffStatus.show();
  }

  private refreshVisibleDecorations(): void {
    for (const editor of vscode.window.visibleTextEditors) {
      this.applyCachedDecorations(editor);
      if (!this.overlaysVisible) {
        this.diagnostics.delete(editor.document.uri);
      }
    }
  }

  private applySemanticLineHints(editor: vscode.TextEditor): void {
    editor.setDecorations(
      this.semanticLineHintDecoration,
      this.semanticLineHintCache.get(editor.document.uri.toString()) ?? [],
    );
  }

  private setDecorationsForUri(uri: vscode.Uri, decorations: DecorationLike[]): void {
    this.decorationCache.set(uri.toString(), decorations);
    for (const editor of vscode.window.visibleTextEditors) {
      if (editor.document.uri.toString() === uri.toString()) {
        this.applyDecorations(editor, this.filterDecorations(decorations));
      }
    }
  }

  private setSemanticLineHintsForUri(uri: vscode.Uri, decorations: vscode.DecorationOptions[]): void {
    this.semanticLineHintCache.set(uri.toString(), decorations);
    for (const editor of vscode.window.visibleTextEditors) {
      if (editor.document.uri.toString() === uri.toString()) {
        this.applySemanticLineHints(editor);
      }
    }
  }

  private clearDocumentVisuals(uri: vscode.Uri): void {
    this.diagnostics.delete(uri);
    this.decorationCache.delete(uri.toString());
    this.semanticLineHintCache.delete(uri.toString());
    for (const editor of vscode.window.visibleTextEditors) {
      if (editor.document.uri.toString() === uri.toString()) {
        this.applyDecorations(editor, []);
        editor.setDecorations(this.semanticLineHintDecoration, []);
      }
    }
  }

  private handleProtocolError(error: { code: string; message: string }): void {
    this.status.text = "IntentumDiff: error";
    this.output.appendLine(`IntentumDiff error: ${error.code}: ${error.message}`);
    if (error.code === "unsupported_protocol") {
      void vscode.window.showWarningMessage(
        "IntentumDiff LiveServer protocol v2 is required. Update IntentumDiff or check intentumdiff.executable.",
      );
    }
  }

  private trace(message: string): void {
    if (readLiveServerSettings().trace) {
      this.output.appendLine(message);
    }
  }
}
