import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";

const packageJsonPath = path.join(__dirname, "..", "..", "package.json");
const extensionRoot = path.join(__dirname, "..", "..");
// The release-media scripts live at the monorepo root's scripts/ (4 hops up) OR, in the
// extracted intentdiff-vscode repo (#82 split), in the extension-local scripts/ — prefer local.
const scriptsRoot = existsSync(path.join(extensionRoot, "scripts", "record-release-demo.ps1"))
  ? path.join(extensionRoot, "scripts")
  : path.join(extensionRoot, "..", "..", "scripts");
const releaseRecorderPath = path.join(scriptsRoot, "record-release-demo.ps1");
const releaseManifestValidatorPath = path.join(scriptsRoot, "validate-release-media-manifest.ps1");
const extensionSourcePath = path.join(__dirname, "..", "..", "src", "extension.ts");
const reviewTimelineSourcePath = path.join(__dirname, "..", "..", "src", "reviewTimeline.ts");
const packageJson = JSON.parse(readFileSync(packageJsonPath, "utf8")) as {
  contributes?: {
    colors?: Array<{ id?: string; defaults?: Record<string, string> }>;
    commands?: Array<{ command?: string; icon?: unknown }>;
    configuration?: { properties?: Record<string, { default?: unknown; enum?: unknown[] }> };
    menus?: Record<string, Array<{ command?: string; group?: string; when?: string }>>;
    views?: Record<string, Array<{ id?: string; type?: string }>>;
  };
};

test("extension contributes vivid IntentDiff semantic review colors", () => {
  const colors = new Map(
    (packageJson.contributes?.colors ?? []).map((color) => [color.id, color.defaults]),
  );

  for (const id of [
    "intentdiff.semanticChanges.root",
    "intentdiff.semanticChanges.fileWithGroups",
    "intentdiff.semanticChanges.movedCode",
    "intentdiff.semanticChanges.refactoring",
    "intentdiff.semanticChanges.meaningful",
    "intentdiff.semanticChanges.ignoredStyle",
    "intentdiff.semanticChanges.noiseSuppressed",
    "intentdiff.semanticChanges.rawChange",
    "intentdiff.semanticChanges.addition",
    "intentdiff.semanticChanges.deletion",
    "intentdiff.semanticChanges.modification",
    "intentdiff.semanticChanges.reorder",
    "intentdiff.semanticChanges.crossFile",
    "intentdiff.semanticChanges.schemaStatus",
    "intentdiff.semanticChanges.guardrail",
    "intentdiff.semanticChanges.muted",
  ]) {
    assert.ok(colors.has(id), `missing contributed color ${id}`);
    assert.match(colors.get(id)?.dark ?? "", /^#[0-9a-f]{6}$/iu);
    assert.match(colors.get(id)?.light ?? "", /^#[0-9a-f]{6}$/iu);
    assert.match(colors.get(id)?.highContrast ?? "", /^#[0-9a-f]{6}$/iu);
  }
});

test("live editor overlay decorations accent from contributed semanticChanges tokens", () => {
  const extensionSource = readFileSync(extensionSourcePath, "utf8");
  for (const id of ["addition", "deletion", "modification", "movedCode", "refactoring"]) {
    assert.match(
      extensionSource,
      new RegExp(`overviewRulerColor: new vscode\\.ThemeColor\\("intentdiff\\.semanticChanges\\.${id}"\\)`, "u"),
      `overview-ruler accent for ${id} must use the contributed token`,
    );
  }
  // The generic accent tokens must no longer drive the overview ruler.
  assert.ok(!/overviewRulerColor: new vscode\.ThemeColor\("testing\.iconPassed"\)/u.test(extensionSource));
  assert.ok(!/overviewRulerColor: new vscode\.ThemeColor\("testing\.iconQueued"\)/u.test(extensionSource));
});

test("extension contributes both review trees and custom review webviews", () => {
  const commands = new Set((packageJson.contributes?.commands ?? []).map((command) => command.command));
  const activityViews = packageJson.contributes?.views?.intentdiffActivity ?? [];
  const scmViews = packageJson.contributes?.views?.scm ?? [];

  assert.ok(commands.has("intentdiff.openReviewDashboard"));
  assert.ok(commands.has("intentdiff.openDiagnostics"));
  assert.ok(commands.has("intentdiff.exportDiagnostics"));
  assert.ok(commands.has("intentdiff.openReviewPanel"));
  assert.ok(commands.has("intentdiff.cycleReviewGrouping"));
  assert.ok(commands.has("intentdiff.reviewPanel.openNativeDiff"));
  assert.ok(commands.has("intentdiff.reviewPanel.openSemanticOnlyDiff"));
  assert.ok(commands.has("intentdiff.reviewPanel.previousChange"));
  assert.ok(commands.has("intentdiff.reviewPanel.nextChange"));
  assert.deepEqual(
    packageJson.contributes?.commands?.find((command) => command.command === "intentdiff.openReviewPanel")?.icon,
    {
      light: "resources/review-icon-light.svg",
      dark: "resources/review-icon-dark.svg",
    },
  );
  assert.deepEqual(activityViews.map((view) => view.id), ["intentdiff.dashboard", "intentdiff.review"]);
  assert.equal(activityViews.find((view) => view.id === "intentdiff.dashboard")?.type, "webview");
  assert.ok(scmViews.some((view) => view.id === "intentdiff.semanticChanges"));
  const editorTitleRows = packageJson.contributes?.menus?.["editor/title"] ?? [];
  assert.ok(editorTitleRows.some((row) => row.command === "intentdiff.openReviewPanel"
    && row.when === "isInDiffEditor"
    && row.group === "navigation@-10"));
  // Native diff editor title-bar intent navigation (bell 4): prev/next intent +
  // semantic-only<->full toggle, gated on an active IntentDiff diff. Commands carry
  // icons so they render as title-bar buttons.
  const commandsById = new Map((packageJson.contributes?.commands ?? []).map((command) => [command.command, command]));
  for (const command of [
    "intentdiff.previousSemanticChange",
    "intentdiff.nextSemanticChange",
    "intentdiff.openSemanticOnlyDiff",
    "intentdiff.openFullDiff",
  ]) {
    assert.ok(
      editorTitleRows.some((row) => row.command === command && (row.when ?? "").includes("intentdiff.inSemanticDiff")),
      `editor/title must contribute ${command} for an active IntentDiff diff`,
    );
    assert.ok(commandsById.get(command)?.icon, `${command} needs an icon to render as a title-bar button`);
  }
  assert.ok(editorTitleRows.some((row) => row.command === "intentdiff.reviewPanel.openNativeDiff"
    && row.when === "activeWebviewPanelId == intentdiff.reviewPanel"));
  const viewTitleRows = packageJson.contributes?.menus?.["view/title"] ?? [];
  assert.ok(viewTitleRows.some((row) => row.command === "intentdiff.cycleReviewGrouping"
    && row.when === "view == intentdiff.dashboard || view == intentdiff.review || view == intentdiff.semanticChanges"));
  assert.ok(viewTitleRows.some((row) => row.command === "intentdiff.openDiagnostics"
    && row.when === "view == intentdiff.dashboard || view == intentdiff.review || view == intentdiff.semanticChanges"));
  assert.deepEqual(packageJson.contributes?.configuration?.properties?.["intentdiff.review.groupFilesBy"]?.enum, [
    "auto",
    "none",
    "language",
    "schema",
    "languageThenSchema",
  ]);
  assert.equal(packageJson.contributes?.configuration?.properties?.["intentdiff.review.groupFilesBy"]?.default, "auto");
  assert.deepEqual(packageJson.contributes?.configuration?.properties?.["intentdiff.review.diffSurface"]?.enum, ["native", "panel"]);
  assert.equal(packageJson.contributes?.configuration?.properties?.["intentdiff.review.diffSurface"]?.default, "native");
  assert.equal(packageJson.contributes?.configuration?.properties?.["intentdiff.review.diffContextLines"]?.default, 1);
  assert.equal(packageJson.contributes?.configuration?.properties?.["intentdiff.diagnostics.fuelPeakWarning"]?.default, 20000000);
  assert.equal(packageJson.contributes?.configuration?.properties?.["intentdiff.diagnostics.fuelPerKbWarning"]?.default, 15000000);
  assert.equal(packageJson.contributes?.configuration?.properties?.["intentdiff.diagnostics.fuelPerLineWarning"]?.default, 1500000);
});

test("extension contributes Timeline, stage, and revert review surfaces", () => {
  const commands = packageJson.contributes?.commands ?? [];
  const commandIds = commands.map((command) => command.command ?? "");
  const editorTitleRows = packageJson.contributes?.menus?.["editor/title"] ?? [];
  const extensionSource = readFileSync(extensionSourcePath, "utf8");
  const reviewTimelineSource = readFileSync(reviewTimelineSourcePath, "utf8");

  assert.ok(commandIds.includes("intentdiff.reviewPanel.openNativeDiff"));
  assert.ok(commandIds.includes("intentdiff.reviewPanel.openSemanticOnlyDiff"));
  assert.ok(commandIds.includes("intentdiff.reviewPanel.stageFile"));
  assert.ok(commandIds.includes("intentdiff.reviewPanel.revertFile"));
  assert.ok(editorTitleRows.some((row) => row.command === "intentdiff.reviewPanel.openNativeDiff"
    && row.when === "activeWebviewPanelId == intentdiff.reviewPanel"));
  assert.ok(editorTitleRows.some((row) => row.command === "intentdiff.reviewPanel.openSemanticOnlyDiff"
    && row.when === "activeWebviewPanelId == intentdiff.reviewPanel"));
  assert.ok(editorTitleRows.some((row) => row.command === "intentdiff.reviewPanel.stageFile"
    && row.when === "activeWebviewPanelId == intentdiff.reviewPanel"));
  assert.ok(editorTitleRows.some((row) => row.command === "intentdiff.reviewPanel.revertFile"
    && row.when === "activeWebviewPanelId == intentdiff.reviewPanel"));

  assert.match(extensionSource, /registerReviewTimelineProvider/u);
  assert.match(reviewTimelineSource, /catch\s*\(error\)/u);
  assert.match(reviewTimelineSource, /Timeline provider unavailable/u);
  assert.match(reviewTimelineSource, /new vscode\.Disposable\(\(\) => undefined\)/u);
  assert.match(extensionSource, /intentdiff\.openDiagnostics/u);
  assert.match(extensionSource, /intentdiff\.exportDiagnostics/u);
  // Fuel/timeline persistence moved to reviewTelemetryService.ts (issue #79
  // stage 2); extension.ts keeps the command registrations and view wiring.
  const telemetrySource = readFileSync(path.join(__dirname, "..", "..", "src", "reviewTelemetryService.ts"), "utf8");
  assert.match(telemetrySource, /workspaceState\.get<ReviewFuelHistory>\("intentdiff\.reviewFuelHistory"/u);
  assert.match(telemetrySource, /workspaceState\.update\("intentdiff\.reviewFuelHistory"/u);
  assert.match(telemetrySource, /workspaceState\.get<unknown>\("intentdiff\.reviewTimelineSnapshots"/u);
  assert.match(telemetrySource, /workspaceState\.update\("intentdiff\.reviewTimelineSnapshots"/u);
  assert.match(telemetrySource, /createReviewTimelineSnapshot/u);
  assert.match(telemetrySource, /appendReviewTimelineSnapshot/u);
  assert.match(extensionSource, /this\.telemetry\.timeline\(\)/u);
  assert.match(extensionSource, /message\.command === "openTimelineSnapshot"/u);
  assert.match(extensionSource, /private openTimelineSnapshot\(payload: ReviewWebviewPayload \| undefined\): void/u);
  assert.match(extensionSource, /reviewTimelineSnapshot: snapshot/u);
  assert.match(extensionSource, /renderDiagnosticsReportHtml/u);
  assert.match(extensionSource, /createDiagnosticsNonce/u);
  // The renderer itself moved to diagnosticsReport.ts (issue #79 split);
  // extension.ts keeps the call sites asserted above.
  const diagnosticsReportSource = readFileSync(path.join(__dirname, "..", "..", "src", "diagnosticsReport.ts"), "utf8");
  assert.match(diagnosticsReportSource, /Content-Security-Policy/u);
  assert.match(diagnosticsReportSource, /style-src 'nonce-\$\{options\.nonce\}'/u);
  assert.match(extensionSource, /diagnosticsReportMarkdown/u);
  assert.match(extensionSource, /showSaveDialog/u);
  assert.match(extensionSource, /intentdiff\.reviewPanel\.stageFile/u);
  assert.match(extensionSource, /intentdiff\.reviewPanel\.revertFile/u);
  assert.match(extensionSource, /intentdiff\.reviewPanel\.stageHunk/u);
  assert.match(extensionSource, /intentdiff\.reviewPanel\.revertHunk/u);
  assert.match(extensionSource, /intentdiff\.reviewPanel\.applyHunk/u);
  assert.match(extensionSource, /message\.command === "editHunk"/u);
  assert.match(extensionSource, /executeCommand\("intentdiff\.reviewPanel\.applyHunk", message\.payload\)/u);
  assert.match(extensionSource, /executeCommand\("intentdiff\.reviewPanel\.stageFile", message\.payload\)/u);
  assert.match(extensionSource, /executeCommand\("intentdiff\.reviewPanel\.revertFile", message\.payload\)/u);
  assert.match(extensionSource, /semanticReviewActionTargetForPayload/u);
  assert.match(extensionSource, /semanticReviewHunkEditForPayload/u);
  assert.match(extensionSource, /semanticHunkActionPreview/u);
  assert.match(extensionSource, /semanticHunkActionStaged/u);
  assert.match(extensionSource, /applyGitIndexPatch/u);
  const editorUtilsSource = readFileSync(path.join(__dirname, "..", "..", "src", "extensionEditorUtils.ts"), "utf8");
  assert.match(editorUtilsSource, /"--cached"/u);
  assert.match(editorUtilsSource, /"--unidiff-zero"/u);
  assert.match(extensionSource, /reviewPayloadUri/u);
  assert.match(extensionSource, /reviewActionTargetForPayload/u);
  assert.match(extensionSource, /executeCommand\("git\.stage", uri\)/u);
  assert.match(extensionSource, /executeCommand\("git\.clean", uri\)/u);
  assert.match(extensionSource, /showWarningMessage/u);
  assert.match(extensionSource, /modal: true/u);
  assert.match(extensionSource, /preview: false/u);
});

test("dedicated editor toolbar icons are packaged and theme-specific", () => {
  const darkIcon = readFileSync(path.join(__dirname, "..", "..", "resources", "review-icon-dark.svg"), "utf8");
  const lightIcon = readFileSync(path.join(__dirname, "..", "..", "resources", "review-icon-light.svg"), "utf8");
  const brandMark = readFileSync(path.join(__dirname, "..", "..", "resources", "brand-mark.svg"), "utf8");
  const compactMark = readFileSync(path.join(__dirname, "..", "..", "resources", "brand-mark-compact.svg"), "utf8");
  const processIcons = readFileSync(path.join(__dirname, "..", "..", "resources", "process-icons.svg"), "utf8");

  assert.match(darkIcon, /<svg\b/u);
  assert.match(lightIcon, /<svg\b/u);
  assert.match(brandMark, /IntentDiff brand mark/u);
  assert.match(compactMark, /IntentDiff compact brand mark/u);
  assert.match(processIcons, /IntentDiff process icons/u);
  assert.match(processIcons, /CODE CHANGES/u);
  assert.match(processIcons, /SEMANTIC ANALYSIS/u);
  assert.match(processIcons, /INTENT COMPARISON/u);
  assert.match(processIcons, /INTENT DIFF/u);
  assert.notEqual(darkIcon, lightIcon);
  assert.match(darkIcon, /#(?:18e8c7|28bdf6|7b5cff)/iu);
  assert.match(lightIcon, /#(?:05a889|0078c8|0969da|6741d9)/iu);
  assert.match(brandMark, /id="intentdiff-mark-gradient"/u);
  assert.match(compactMark, /id="intentdiff-compact-gradient"/u);
});

test("image assets are routed to asset review instead of text semantic diff", () => {
  const extensionSource = readFileSync(extensionSourcePath, "utf8");
  const webviewSource = readFileSync(path.join(__dirname, "..", "..", "src", "reviewWebview.ts"), "utf8");
  const modelSource = readFileSync(path.join(__dirname, "..", "..", "src", "reviewWebviewModel.ts"), "utf8");
  // The asset-review helpers moved to reviewAssetDiffs.ts (issue #79 split);
  // extension.ts keeps the call sites.
  const assetDiffSource = readFileSync(path.join(__dirname, "..", "..", "src", "reviewAssetDiffs.ts"), "utf8");

  assert.match(assetDiffSource, /export function isImageLikePath\(relativePath: string\)/u);
  assert.match(assetDiffSource, /export function imageAssetReviewDiff\(folder: vscode\.WorkspaceFolder, file: ReviewRefreshFile\): SemanticDiff/u);
  assert.match(extensionSource, /if \(isImageLikePath\(file\.relativePath\)\) \{\s+const diff = imageAssetReviewDiff\(folder, file\);/u);
  // Image panels upgrade the preview to the real perceptual compare on demand,
  // computed in the background (non-blocking) then refreshed in.
  // The compare cache/CLI machinery moved to assetCompareService.ts (issue #79
  // stage 2); extension.ts keeps the synchronous upgrade call site.
  const assetCompareSource = readFileSync(path.join(__dirname, "..", "..", "src", "assetCompareService.ts"), "utf8");
  assert.match(extensionSource, /assetCompare\.comparedFileOrPreview\(folderUri, filePayload\.relativePath, ref, file\)/u);
  assert.match(extensionSource, /return buildReviewPanelModel\(fileForPanel, "", "", ref, \{ contextLines \}\);/u);
  assert.match(assetCompareSource, /computeInBackground\(folderUri, ref\)/u);
  assert.match(assetCompareSource, /"assets", "git", "--repo"/u);
  // Skipped binary/image assets are reconciled so the streaming review finishes
  // (the engine drops them from commit_diff.file_diffs, so they'd hang "pending").
  assert.match(extensionSource, /reconcileSkippedReviewFiles\(folder, request\.snapshot\)/u);
  assert.match(assetDiffSource, /export function nonTextAssetReviewDiff\(file: ReviewRefreshFile\): SemanticDiff/u);
  // The image-fallback message moved with the open flow to
  // diffSurfaceController.ts (issue #79 stage 2).
  const diffSurfaceSource = readFileSync(path.join(__dirname, "..", "..", "src", "diffSurfaceController.ts"), "utf8");
  assert.match(diffSurfaceSource, /image assets open in the custom review panel/u);
  assert.match(webviewSource, /localResourceRoots: \[folderUri, mediaUri, codiconsRoot\]/u);
  assert.match(webviewSource, /webview\.asWebviewUri\(vscode\.Uri\.file\(resourcePath\)\)/u);
  assert.match(modelSource, /Working tree image/u);
  assert.match(modelSource, /Perceptual diff pending/u);
});

test("release media screenshot workflow covers every beta proof surface", () => {
  const recorder = readFileSync(releaseRecorderPath, "utf8");
  const validator = readFileSync(releaseManifestValidatorPath, "utf8");
  const extensionSource = readFileSync(extensionSourcePath, "utf8");
  const requiredScenes = [
    "dashboard",
    "review",
    "intent",
    "risk",
    "evidence",
    "notes",
    "release-notes",
    "binary-image",
    "schema",
    "guardrails",
    "language-sweep",
    "narrow",
    "light-theme",
  ];

  for (const scene of requiredScenes) {
    assert.ok(recorder.includes(`"${scene}"`), `recorder missing scene ${scene}`);
    assert.ok(validator.includes(`"${scene}"`), `validator missing scene ${scene}`);
  }

  assert.match(recorder, /artifacts\\release-media-review\\manifest\.json/u);
  assert.match(recorder, /Update-VisualProofManifest/u);
  assert.match(recorder, /status = "needs_polish"/u);
  assert.match(recorder, /Resolve-VsCodeDemoReviewView/u);
  assert.match(recorder, /Resolve-VsCodeDemoContentScene/u);
  assert.match(recorder, /intentdiff\.reviewPanel\.setView/u);
  assert.match(recorder, /"binary-image" \{ return "semantic" \}/u);
  assert.match(recorder, /\$openSemanticDiff = \$Scene -notin @\("dashboard", "binary-image"\)/u);
  assert.match(recorder, /executeCommand\("intentdiff\.openReviewPanel", \{/u);
  assert.match(recorder, /relativePath: diffPath/u);
  assert.match(recorder, /workbench\.colorTheme" = if \(\$Scene -eq "light-theme"\)/u);
  assert.match(validator, /approved/u);
  assert.match(validator, /needs_polish/u);
  assert.match(validator, /post_beta/u);
  assert.match(extensionSource, /intentdiff\.reviewPanel\.setView/u);
});

// ── Native-first migration (Phase 4) ───────────────────────────────────────
// The custom Monaco diff webview has been removed. Category colours still come
// from the contributed intentdiff.semanticChanges.* tokens (asserted above),
// and the diff media assets must no longer exist.

test("Monaco diff media assets are removed after the native-first migration", () => {
  const reviewDiffCssPath = path.join(__dirname, "..", "..", "media", "reviewDiff.css");
  const reviewDiffJsPath = path.join(__dirname, "..", "..", "media", "reviewDiff.js");
  assert.ok(!existsSync(reviewDiffCssPath), "media/reviewDiff.css must be deleted");
  assert.ok(!existsSync(reviewDiffJsPath), "media/reviewDiff.js must be deleted");

  // The webview model must not reference Monaco or the deleted media assets.
  const modelSource = readFileSync(path.join(__dirname, "..", "..", "src", "reviewWebviewModel.ts"), "utf8");
  const webviewSource = readFileSync(path.join(__dirname, "..", "..", "src", "reviewWebview.ts"), "utf8");
  assert.ok(!/monaco/iu.test(modelSource), "reviewWebviewModel.ts must not reference Monaco");
  assert.ok(!/reviewDiff\.(?:js|css)/u.test(modelSource), "reviewWebviewModel.ts must not reference the deleted media assets");
  assert.ok(!/monaco/iu.test(webviewSource), "reviewWebview.ts must not reference Monaco");
  assert.ok(!/reviewDiff\.(?:js|css)/u.test(webviewSource), "reviewWebview.ts must not reference the deleted media assets");

  // The Diff page renders the inline HTML diff and offers the native diff editor
  // (collapse/expand + editing) via the native commands.
  assert.match(modelSource, /class="diff-table"/u);
  assert.match(modelSource, /"openNativeDiff"/u);
  assert.match(modelSource, /"openSemanticOnlyDiff"/u);
});

test("theme-native ratchet: chrome hex literals never increase (issue #27)", () => {
  // CLAUDE.md §6: chrome binds to --vscode-* variables and the contributed
  // intentdiff.semanticChanges.* tokens — hardcoded chrome hex renders as a
  // dark island in Light+/High-Contrast. This ratchet makes the standing
  // violations enforceable: the diagnostics report is already clean (stays 0),
  // and the review panel's bespoke palette must only shrink as it migrates.
  // Drive the baseline to ZERO, then inline these limits away.
  const extensionSource = readFileSync(path.join(__dirname, "..", "..", "src", "extension.ts"), "utf8");
  // The panel chrome was split across sibling modules (issue #78); the ratchet
  // follows the code so relocated styles/markup stay counted.
  const modelSource = ["reviewWebviewModel.ts", "reviewWebviewStyles.ts", "reviewWebviewScript.ts", "reviewDiffRows.ts", "reviewAssetViewer.ts", "reviewWebviewHtml.ts"]
    .map((name) => readFileSync(path.join(__dirname, "..", "..", "src", name), "utf8"))
    .join("\n");
  const hex = /#[0-9a-fA-F]{3,8}\b/gu;
  const splitSources = ["diagnosticsReport.ts", "extensionEditorUtils.ts", "reviewAssetDiffs.ts"]
    .map((name) => readFileSync(path.join(__dirname, "..", "..", "src", name), "utf8"))
    .join("\n");
  const extensionHexes = (extensionSource + splitSources).match(hex) ?? [];
  assert.deepStrictEqual(extensionHexes, [], "extension.ts chrome HTML (incl. its split modules) must stay free of hardcoded hex");
  // The IntentDiff brand-mark SVG (iconSvg's logo gradient) is a deliberate
  // brand asset, not chrome - its colors are pinned by the icon test above.
  const brandFree = modelSource.replace(/<svg class="control-icon"[\s\S]*?<\/svg>/gu, "");
  const modelHexes = brandFree.match(hex) ?? [];
  assert.deepStrictEqual(
    modelHexes,
    [],
    "review-panel chrome must stay free of hardcoded hex (issue #27 ratchet driven to zero under #84)",
  );
});
