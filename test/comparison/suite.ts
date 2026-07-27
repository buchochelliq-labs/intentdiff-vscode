import * as assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";
import * as vscode from "vscode";

type SemanticDiffStatus =
  | "semanticdiff_rendered"
  | "semanticdiff_text_fallback"
  | "semanticdiff_failed";

type PysdStatus =
  | "intentdiff_semantic"
  | "intentdiff_style_only"
  | "intentdiff_fallback"
  | "intentdiff_failed";

type PysdDiffMode = "full_native_diff" | "semantic_only_native_diff";

type IssueSeverity = "none" | "low" | "medium" | "high";

interface Scenario {
  id: string;
  language: string;
  filename: string;
  tier: string;
  semanticdiff_support: "supported" | "unsupported_by_semanticdiff";
  source: { url: string; type: string };
  fixture: { old: string; new: string };
  expected: { labels: string[] };
}

interface ScenarioRun {
  scenario_id: string;
  language: string;
  tier: string;
  source_url: string;
  relative_path: string;
  semanticdiff_status: SemanticDiffStatus;
  intentdiff_status: PysdStatus;
  intentdiff_diff_mode: PysdDiffMode;
  semanticdiff_screenshot: string;
  intentdiff_screenshot: string;
  performance_ms: {
    intentdiff_diff_generation: number;
    semanticdiff_render: number;
    intentdiff_review_wait: number;
    intentdiff_open: number;
  };
  notes: string[];
}

interface IssueLogEntry {
  language: string;
  scenario_id: string;
  issue_type: "none" | "intentdiff_parser" | "intentdiff_ui" | "semanticdiff_limitation" | "parity_gap";
  severity: IssueSeverity;
  observed_behavior: string;
  expected_or_desired_behavior: string;
  suggested_fix: string;
  labels: string[];
}

interface ScreenshotCapture {
  title: string;
  foreground_title: string;
  width: number;
  height: number;
  expected_marker: string;
}

interface ReviewState {
  files: Array<{
    relativePath: string;
    status: string;
    language?: string;
    changeCount: number;
    changeTypes: string[];
    groupKinds: string[];
    guardrailCount: number;
    parseErrorCount: number;
    isStyleOnly: boolean;
  }>;
  pendingReviewCount: number;
}

const COMPARISON_IDS = [
  "python-moved-helper-edited-policy",
  "typescript-discriminated-union-status-migration",
  "go-error-wrapping-with-context",
  "rust-match-to-if-let",
  "json-package-scripts-expand",
  "html-accessible-status-region",
  "vue-inline-handler-extracted-method",
  "css-delete-debug-banner",
  "hcl-s3-versioning-and-tags",
  "databricks-workflow-conditional-task",
  "adf-pipeline-success-webhook",
  "sql-windowed-revenue-filter",
  "csharp-null-coalescing-guard",
];

export async function run(): Promise<void> {
  const repoRoot = requiredEnv("INTENTDIFF_REPO_ROOT");
  const workspaceRoot = requiredEnv("INTENTDIFF_SEMANTICDIFF_COMPARISON_WORKSPACE");
  const artifactsRoot = requiredEnv("INTENTDIFF_SEMANTICDIFF_COMPARISON_ARTIFACTS");
  const semanticDiffExtensionPath = requiredEnv("INTENTDIFF_SEMANTICDIFF_EXTENSION_PATH");
  const nodeExecutable = requiredEnv("INTENTDIFF_NODE_EXECUTABLE");
  const lockDir = path.join(path.dirname(workspaceRoot), "semanticdiff-comparison.lock");
  if (!acquireComparisonLock(lockDir)) {
    return;
  }
  const scenarios = readScenarios(repoRoot);

  try {
    fs.mkdirSync(artifactsRoot, { recursive: true });
    const diffGenerationMs = Number(requiredEnv("INTENTDIFF_DIFF_GENERATION_MS"));

    await ensureWorkspaceFolder(workspaceRoot);
    await activateAndConfigureExtensions(nodeExecutable, semanticDiffExtensionPath);

    const reviewStarted = Date.now();
    await vscode.commands.executeCommand("intentdiff.refreshReview");
    await waitFor(async () => {
      const state = await reviewState();
      return state.pendingReviewCount === 0
        && scenarios.every((scenario) => state.files.some(
          (file) => file.relativePath === relativePathFor(scenario),
        ));
    }, "IntentDiff review state");
    const intentdiffReviewWaitMs = Date.now() - reviewStarted;

    const scenarioRuns: ScenarioRun[] = [];
    for (const scenario of scenarios) {
      const semantic = await runSemanticDiffScenario(workspaceRoot, artifactsRoot, scenario);
      const intentdiff = await runPysdScenario(workspaceRoot, artifactsRoot, scenario);
      scenarioRuns.push({
        scenario_id: scenario.id,
        language: scenario.language,
        tier: scenario.tier,
        source_url: scenario.source.url,
        relative_path: relativePathFor(scenario),
        semanticdiff_status: semantic.status,
        intentdiff_status: intentdiff.status,
        intentdiff_diff_mode: intentdiff.diffMode,
        semanticdiff_screenshot: semantic.screenshot,
        intentdiff_screenshot: intentdiff.screenshot,
        performance_ms: {
          intentdiff_diff_generation: diffGenerationMs,
          semanticdiff_render: semantic.durationMs,
          intentdiff_review_wait: intentdiffReviewWaitMs,
          intentdiff_open: intentdiff.durationMs,
        },
        notes: [...semantic.notes, ...intentdiff.notes],
      });
    }

    const issueLog = scenarioRuns.map((run) => issueLogEntry(run));
    writeReport(artifactsRoot, semanticDiffExtensionPath, scenarioRuns, issueLog);
    validateReport(scenarios, scenarioRuns, issueLog, artifactsRoot);
  } finally {
    fs.rmSync(lockDir, { recursive: true, force: true });
  }
}

function acquireComparisonLock(lockDir: string): boolean {
  try {
    fs.mkdirSync(lockDir, { recursive: false });
    return true;
  } catch {
    return false;
  }
}

function readScenarios(repoRoot: string): Scenario[] {
  const fixturePath = path.join(
    repoRoot,
    "tests",
    "fixtures",
    "semanticdiff_competitive_scenarios.json",
  );
  const data = JSON.parse(fs.readFileSync(fixturePath, "utf8")) as { scenarios: Scenario[] };
  const scenarios = data.scenarios.filter((scenario) => COMPARISON_IDS.includes(scenario.id));
  assert.deepEqual(
    scenarios.map((scenario) => scenario.id).sort(),
    [...COMPARISON_IDS].sort(),
    "comparison fixture should contain every required scenario",
  );
  return scenarios;
}

function prepareWorkspace(workspaceRoot: string, scenarios: Scenario[]): void {
  fs.writeFileSync(
    path.join(workspaceRoot, ".gitignore"),
    ".semanticdiff-old/\n.intentdiff-comparison-commit-diff.json\n.intentdiff-comparison-input.json\n.intentdiff-comparison-log.jsonl\nlive-server\n",
    "utf8",
  );
  for (const scenario of scenarios) {
    const relativePath = relativePathFor(scenario);
    const workingPath = path.join(workspaceRoot, relativePath);
    const oldPath = oldSnapshotPath(workspaceRoot, scenario);
    fs.mkdirSync(path.dirname(workingPath), { recursive: true });
    fs.mkdirSync(path.dirname(oldPath), { recursive: true });
    fs.writeFileSync(workingPath, scenario.fixture.old, "utf8");
    fs.writeFileSync(oldPath, scenario.fixture.old, "utf8");
  }
  execGit(workspaceRoot, ["init"]);
  execGit(workspaceRoot, ["add", "."]);
  execGit(workspaceRoot, [
    "-c",
    "user.name=intentdiff comparison",
    "-c",
    "user.email=intentdiff-comparison@example.com",
    "commit",
    "-m",
    "old scenario fixtures",
  ]);
  for (const scenario of scenarios) {
    fs.writeFileSync(
      path.join(workspaceRoot, relativePathFor(scenario)),
      scenario.fixture.new,
      "utf8",
    );
  }
}

function generatePysdCommitDiff(
  repoRoot: string,
  workspaceRoot: string,
  scenarios: Scenario[],
): number {
  const inputPath = path.join(workspaceRoot, ".intentdiff-comparison-input.json");
  const outputPath = path.join(workspaceRoot, ".intentdiff-comparison-commit-diff.json");
  const payload = {
    scenarios: scenarios.map((scenario) => ({
      id: scenario.id,
      language: scenario.language,
      relative_path: relativePathFor(scenario),
      old: scenario.fixture.old,
      new: scenario.fixture.new,
    })),
  };
  fs.writeFileSync(inputPath, JSON.stringify(payload), "utf8");
  const script = [
    "import json, sys",
    "from intentdiff import SemanticDiffer",
    "payload = json.load(open(sys.argv[1], encoding='utf8'))",
    "differ = SemanticDiffer()",
    "file_diffs = []",
    "metadata = {}",
    "for item in payload['scenarios']:",
    "    diff = differ.diff_strings(item['old'], item['new'], filename=item['relative_path'], language_hint=item['language'])",
    "    data = diff.model_dump(mode='json')",
    "    data['old_filename'] = item['relative_path']",
    "    data['new_filename'] = item['relative_path']",
    "    file_diffs.append(data)",
    "    metadata[item['id']] = {'is_fallback': data.get('is_fallback', False), 'parse_errors': data.get('parse_errors', []), 'change_count': len(data.get('changes', []))}",
    "json.dump({'old_ref': 'HEAD', 'new_ref': '', 'file_diffs': file_diffs, 'cross_file_changes': [], 'guardrail_violations': [], 'parse_errors': [], 'metadata': metadata}, open(sys.argv[2], 'w', encoding='utf8'), indent=2)",
  ].join("\n");
  const started = Date.now();
  execFileSync("uv", ["run", "--no-sync", "python", "-c", script, inputPath, outputPath], {
    cwd: repoRoot,
    encoding: "utf8",
    env: {
      ...process.env,
      INTENTDIFF_ALLOW_VULNERABLE_WASMTIME: "1",
      UV_CACHE_DIR: requiredEnv("INTENTDIFF_UV_CACHE_DIR"),
    },
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true,
  });
  return Date.now() - started;
}

function writeLiveServer(workspaceRoot: string): void {
  fs.writeFileSync(path.join(workspaceRoot, "live-server"), LIVE_SERVER, "utf8");
}

async function activateAndConfigureExtensions(
  nodeExecutable: string,
  semanticDiffExtensionPath: string,
): Promise<void> {
  const intentdiff = vscode.extensions.getExtension("buchochelliq-labs.intentdiff");
  assert.ok(intentdiff, "IntentDiff extension should be loaded as extensionDevelopmentPath");
  await intentdiff.activate();

  const semanticDiff = vscode.extensions.getExtension("semanticdiff.semanticdiff");
  assert.ok(
    semanticDiff,
    `SemanticDiff extension should load from ${semanticDiffExtensionPath}`,
  );
  await semanticDiff.activate();

  const commands = await vscode.commands.getCommands(true);
  for (const command of ["semanticdiff.show", "semanticdiff.hide", "semanticdiff.nextChange"]) {
    assert.ok(commands.includes(command), `SemanticDiff command must be registered: ${command}`);
  }

  const intentdiffConfig = vscode.workspace.getConfiguration("intentdiff");
  await intentdiffConfig.update("executable", nodeExecutable, vscode.ConfigurationTarget.Workspace);
  await intentdiffConfig.update("ref", "HEAD", vscode.ConfigurationTarget.Workspace);
  await intentdiffConfig.update("debounceMs", 50, vscode.ConfigurationTarget.Workspace);
  await intentdiffConfig.update("review.pollIntervalMs", 500, vscode.ConfigurationTarget.Workspace);
  await intentdiffConfig.update("enabled", true, vscode.ConfigurationTarget.Workspace);
  await intentdiffConfig.update("trace", true, vscode.ConfigurationTarget.Workspace);

  const semanticConfig = vscode.workspace.getConfiguration("semanticdiff");
  await semanticConfig.update("fallbackDiff", true, vscode.ConfigurationTarget.Workspace);
  await semanticConfig.update("defaultDiffViewer", false, vscode.ConfigurationTarget.Workspace);
  await semanticConfig.update("closeOriginalTab", false, vscode.ConfigurationTarget.Workspace);
  await semanticConfig.update("diff.compareMovedCode", true, vscode.ConfigurationTarget.Workspace);
}

async function runSemanticDiffScenario(
  workspaceRoot: string,
  artifactsRoot: string,
  scenario: Scenario,
): Promise<{ status: SemanticDiffStatus; screenshot: string; durationMs: number; notes: string[] }> {
  await vscode.commands.executeCommand("workbench.action.closeAllEditors");
  const oldUri = vscode.Uri.file(oldSnapshotPath(workspaceRoot, scenario));
  const newUri = vscode.Uri.file(path.join(workspaceRoot, relativePathFor(scenario)));
  const title = `${scenario.id} (SemanticDiff comparison)`;
  await vscode.commands.executeCommand("vscode.diff", oldUri, newUri, title, { preview: false });
  await waitFor(
    () => vscode.window.visibleTextEditors.some((editor) => editor.document.uri.toString() === oldUri.toString())
      && vscode.window.visibleTextEditors.some((editor) => editor.document.uri.toString() === newUri.toString()),
    `VS Code diff editors for ${scenario.id}`,
  );

  const started = Date.now();
  let status: SemanticDiffStatus;
  const notes: string[] = [];
  try {
    await vscode.commands.executeCommand("semanticdiff.show");
    let rendered = await waitForMaybe(isSemanticDiffWebviewActive, 12_000);
    if (!rendered) {
      await vscode.commands.executeCommand("semanticdiff.show-alt");
      rendered = await waitForMaybe(isSemanticDiffWebviewActive, 12_000);
    }
    status = rendered && scenario.semanticdiff_support === "supported"
      ? "semanticdiff_rendered"
      : "semanticdiff_text_fallback";
    if (rendered) {
      await sleep(2_500);
    }
  } catch (error) {
    status = "semanticdiff_failed";
    notes.push(error instanceof Error ? error.message : String(error));
  }
  const durationMs = Date.now() - started;
  notes.push(`active webview after SemanticDiff command: ${activeWebviewType() ?? "none"}`);
  notes.push(`active tab after SemanticDiff command: ${activeTabDescription()}`);
  if (scenario.semanticdiff_support === "unsupported_by_semanticdiff" && status !== "semanticdiff_rendered") {
    notes.push("SemanticDiff did not render a semantic webview for this unsupported language.");
  }

  const screenshot = path.join("semanticdiff", `${scenario.id}.png`);
  await prepareWorkbenchForScreenshot();
  const capture = captureWindowScreenshot(path.join(artifactsRoot, screenshot), scenario.id);
  notes.push(`screenshot captured window: ${capture.title}`);
  assert.ok(fs.existsSync(path.join(artifactsRoot, screenshot)), `missing screenshot ${screenshot}`);
  if (scenario.semanticdiff_support === "supported") {
    assert.equal(
      status,
      "semanticdiff_rendered",
      `SemanticDiff must render supported scenario ${scenario.id}; ${notes.join("; ")}`,
    );
  }
  return { status, screenshot, durationMs, notes };
}

async function runPysdScenario(
  workspaceRoot: string,
  artifactsRoot: string,
  scenario: Scenario,
): Promise<{ status: PysdStatus; diffMode: PysdDiffMode; screenshot: string; durationMs: number; notes: string[] }> {
  await vscode.commands.executeCommand("workbench.action.closeAllEditors");
  const relativePath = relativePathFor(scenario);
  let state = await reviewState();
  let entry = state.files.find((file) => file.relativePath === relativePath);
  if (!entry) {
    await vscode.commands.executeCommand("intentdiff.refreshReview");
    await waitFor(async () => {
      state = await reviewState();
      entry = state.files.find((file) => file.relativePath === relativePath);
      return state.pendingReviewCount === 0 && Boolean(entry);
    }, `IntentDiff refreshed review entry for ${scenario.id}`);
  }
  assert.ok(entry, `IntentDiff review entry should exist for ${scenario.id}`);

  const status: PysdStatus = entry.parseErrorCount > 0
    ? "intentdiff_fallback"
    : entry.isStyleOnly
      ? "intentdiff_style_only"
      : entry.status === "ready" && (entry.changeCount > 0 || entry.groupKinds.length > 0)
        ? "intentdiff_semantic"
        : "intentdiff_failed";
  assert.notEqual(status, "intentdiff_failed", `IntentDiff should render ${scenario.id}`);

  const started = Date.now();
  const diffMode = intentdiffDiffModeForScenario(scenario);
  await vscode.commands.executeCommand(
    diffMode === "semantic_only_native_diff" ? "intentdiff.openSemanticOnlyDiff" : "intentdiff.openSemanticDiff",
    openPayload(workspaceRoot, scenario),
  );
  if (await waitForMaybe(isSemanticDiffWebviewActive, 1_000)) {
    await vscode.commands.executeCommand("semanticdiff.hide");
  }
  await waitFor(
    async () => {
      if (isSemanticDiffWebviewActive()) {
        await vscode.commands.executeCommand("semanticdiff.hide");
      }
      return hasVisiblePysdDiff(relativePath);
    },
    `IntentDiff editors for ${scenario.id}`,
  );
  const durationMs = Date.now() - started;
  const notes: string[] = [`IntentDiff screenshot mode: ${diffMode}`];
  if (diffMode === "semantic_only_native_diff") {
    const baseText = visibleTextFor("intentdiff-semantic-base", scenario.filename);
    const modifiedText = visibleTextFor("intentdiff-semantic-modified", scenario.filename);
    assert.ok(baseText, `semantic-only base editor should contain generated text for ${scenario.id}`);
    assert.ok(modifiedText, `semantic-only modified editor should contain generated text for ${scenario.id}`);
    assert.notEqual(
      baseText,
      "IntentDiff: no semantic changes match the current filters.",
      `semantic-only base editor should show real semantic chunks for ${scenario.id}`,
    );
    notes.push(
      `semantic-only generated lines: base=${lineCount(baseText)}, modified=${lineCount(modifiedText)}`,
    );
  }
  if (scenario.id === "css-delete-debug-banner") {
    const baseScheme = diffMode === "semantic_only_native_diff" ? "intentdiff-semantic-base" : "intentdiff-base";
    const modifiedScheme = diffMode === "semantic_only_native_diff" ? "intentdiff-semantic-modified" : "file";
    const baseSelection = selectedTextFor(baseScheme, scenario.filename);
    assert.equal(
      baseSelection,
      ".debug-banner {",
      "CSS deletion should select the deleted rule on the IntentDiff base side",
    );
    notes.push("Deleted CSS rule was selectable on the IntentDiff base side.");
    assert.notEqual(
      selectedTextFor(modifiedScheme, scenario.filename),
      ".debug-banner {",
      "CSS deletion must not select deleted text on modified side",
    );
  }

  const screenshot = path.join("intentdiff", `${scenario.id}.png`);
  await prepareWorkbenchForScreenshot();
  const capture = captureWindowScreenshot(path.join(artifactsRoot, screenshot), scenario.id);
  notes.push(`screenshot captured window: ${capture.title}`);
  assert.ok(fs.existsSync(path.join(artifactsRoot, screenshot)), `missing screenshot ${screenshot}`);
  return { status, diffMode, screenshot, durationMs, notes };
}

function intentdiffDiffModeForScenario(scenario: Scenario): PysdDiffMode {
  return [
    "python-moved-helper-edited-policy",
    "css-delete-debug-banner",
    "go-error-wrapping-with-context",
    "vue-inline-handler-extracted-method",
  ].includes(scenario.id)
    ? "semantic_only_native_diff"
    : "full_native_diff";
}

function openPayload(workspaceRoot: string, scenario: Scenario): Record<string, unknown> {
  const payload: Record<string, unknown> = {
    folderUri: vscode.Uri.file(workspaceRoot).toString(),
    relativePath: relativePathFor(scenario),
  };
  if (scenario.id === "css-delete-debug-banner") {
    const position = { start_line: 5, start_col: 0, end_line: 5, end_col: 15 };
    payload.position = position;
    payload.positionSide = "base";
    payload.change = {
      change_type: "DELETION",
      description: "Delete CSS rule '.debug-banner'",
      old_node: {
        node_type: "rule_set",
        label: ".debug-banner {",
        position,
      },
    };
  }
  return payload;
}

function issueLogEntry(run: ScenarioRun): IssueLogEntry {
  if (run.semanticdiff_status !== "semanticdiff_rendered") {
    return {
      language: run.language,
      scenario_id: run.scenario_id,
      issue_type: "semanticdiff_limitation",
      severity: "low",
      observed_behavior: "SemanticDiff fell back to a text-oriented diff or unsupported-language message; IntentDiff produced structured review output.",
      expected_or_desired_behavior: "Use this as differentiator material and keep IntentDiff output demonstrably navigable.",
      suggested_fix: "Promote this scenario in docs and future demos; add viewer polish for operational-code review.",
      labels: ["differentiator", "test-candidate"],
    };
  }
  if (run.intentdiff_status !== "intentdiff_semantic" && run.intentdiff_status !== "intentdiff_style_only") {
    return {
      language: run.language,
      scenario_id: run.scenario_id,
      issue_type: "intentdiff_parser",
      severity: "high",
      observed_behavior: `IntentDiff reported ${run.intentdiff_status}.`,
      expected_or_desired_behavior: "IntentDiff should produce structured semantic output for this fixture.",
      suggested_fix: "Debug parser/classification output for this language and add a focused regression test.",
      labels: ["quality-gap", "test-candidate"],
    };
  }
  const supportedParityLanguages = new Set(["python", "typescript", "css", "json", "go", "rust", "html", "vue", "csharp"]);
  if (supportedParityLanguages.has(run.language)) {
    const usesSemanticOnly = run.intentdiff_diff_mode === "semantic_only_native_diff";
    return {
      language: run.language,
      scenario_id: run.scenario_id,
      issue_type: "intentdiff_ui",
      severity: "low",
      observed_behavior: usesSemanticOnly
        ? "IntentDiff produced semantic output in native semantic-only VS Code diff mode; remaining parity gap is richer context/minimap polish."
        : "IntentDiff produced semantic output in full native VS Code diff mode; semantic-only mode should be considered for this scenario if compact review is more useful.",
      expected_or_desired_behavior: "Keep native semantic-only review available and add the remaining context/minimap controls that SemanticDiff exposes.",
      suggested_fix: usesSemanticOnly
        ? "Use this scenario as visual regression coverage for semantic-only native diff polish."
        : "Evaluate enabling semantic-only native diff for this scenario, then reserve custom webview work for features native diff cannot provide.",
      labels: ["parity", "test-candidate"],
    };
  }
  return {
    language: run.language,
    scenario_id: run.scenario_id,
    issue_type: "none",
    severity: "none",
    observed_behavior: "No IntentDiff parser or UI issue recorded for this comparison pass.",
    expected_or_desired_behavior: "Keep this scenario green as smoke coverage.",
    suggested_fix: "No fix required; retain as regression coverage.",
    labels: ["test-candidate"],
  };
}

function writeReport(
  artifactsRoot: string,
  semanticDiffExtensionPath: string,
  scenarios: ScenarioRun[],
  issueLog: IssueLogEntry[],
): void {
  const report = {
    generated_at: new Date().toISOString(),
    semanticdiff_extension_path: semanticDiffExtensionPath,
    scenarios,
    language_issue_log: issueLog,
    performance_summary_ms: summarizePerformance(scenarios),
  };
  fs.writeFileSync(
    path.join(artifactsRoot, "report.json"),
    JSON.stringify(report, null, 2),
    "utf8",
  );
}

function summarizePerformance(scenarios: ScenarioRun[]): Record<string, number> {
  return {
    semanticdiff_render_total: sum(scenarios.map((scenario) => scenario.performance_ms.semanticdiff_render)),
    semanticdiff_render_avg: average(scenarios.map((scenario) => scenario.performance_ms.semanticdiff_render)),
    intentdiff_open_total: sum(scenarios.map((scenario) => scenario.performance_ms.intentdiff_open)),
    intentdiff_open_avg: average(scenarios.map((scenario) => scenario.performance_ms.intentdiff_open)),
    intentdiff_review_wait: scenarios[0]?.performance_ms.intentdiff_review_wait ?? 0,
    intentdiff_diff_generation: scenarios[0]?.performance_ms.intentdiff_diff_generation ?? 0,
  };
}

function validateReport(
  scenarios: Scenario[],
  runs: ScenarioRun[],
  issueLog: IssueLogEntry[],
  artifactsRoot: string,
): void {
  assert.equal(runs.length, scenarios.length);
  assert.equal(issueLog.length, scenarios.length);
  for (const scenario of scenarios) {
    const run = runs.find((item) => item.scenario_id === scenario.id);
    assert.ok(run, `missing report entry for ${scenario.id}`);
    assert.ok(fs.existsSync(path.join(artifactsRoot, run.semanticdiff_screenshot)));
    assert.ok(fs.existsSync(path.join(artifactsRoot, run.intentdiff_screenshot)));
    const issue = issueLog.find((item) => item.scenario_id === scenario.id && item.language === scenario.language);
    assert.ok(issue, `missing language issue log entry for ${scenario.language}/${scenario.id}`);
    assert.ok(["none", "low", "medium", "high"].includes(issue.severity));
    assert.ok(issue.labels.length > 0);
    assert.ok(issue.suggested_fix.length > 0);
  }
}

function relativePathFor(scenario: Scenario): string {
  return path.posix.join("cases", scenario.id, scenario.filename);
}

function oldSnapshotPath(workspaceRoot: string, scenario: Scenario): string {
  return path.join(workspaceRoot, ".semanticdiff-old", scenario.id, scenario.filename);
}

async function ensureWorkspaceFolder(workspaceRoot: string): Promise<void> {
  const uri = vscode.Uri.file(workspaceRoot);
  const existing = vscode.workspace.workspaceFolders ?? [];
  if (existing.length === 1 && existing[0].uri.toString() === uri.toString()) {
    return;
  }
  const changed = vscode.workspace.updateWorkspaceFolders(
    0,
    existing.length,
    { uri, name: "intentdiff-semanticdiff-comparison" },
  );
  if (!changed) {
    const folders = vscode.workspace.workspaceFolders ?? [];
    assert.ok(
      folders.some((folder) => folder.uri.toString() === uri.toString()),
      "comparison workspace folder should be open or replaceable",
    );
  }
  await waitFor(
    () => {
      const folders = vscode.workspace.workspaceFolders ?? [];
      return folders.length === 1 && folders[0].uri.toString() === uri.toString();
    },
    "comparison workspace folder",
  );
}

async function reviewState(): Promise<ReviewState> {
  return await vscode.commands.executeCommand("intentdiff.test.getReviewState") as ReviewState;
}

function activeWebviewType(): string | undefined {
  const input = vscode.window.tabGroups.activeTabGroup.activeTab?.input as { viewType?: string } | undefined;
  return input?.viewType;
}

function isSemanticDiffWebviewActive(): boolean {
  return activeWebviewType()?.endsWith("SemanticDiff") === true;
}

function activeTabDescription(): string {
  const tab = vscode.window.tabGroups.activeTabGroup.activeTab;
  if (!tab) {
    return "none";
  }
  const input = tab.input as { viewType?: string } | undefined;
  return JSON.stringify({
    label: tab.label,
    viewType: input?.viewType,
    isActive: tab.isActive,
  });
}

function selectedTextFor(scheme: string, fileName: string): string | undefined {
  const editor = vscode.window.visibleTextEditors.find((item) => (
    item.document.uri.scheme === scheme
    && item.document.uri.path.endsWith(fileName)
  ));
  return editor?.document.getText(editor.selection);
}

function visibleTextFor(scheme: string, fileName: string): string | undefined {
  const editor = vscode.window.visibleTextEditors.find((item) => (
    item.document.uri.scheme === scheme
    && item.document.uri.path.endsWith(fileName)
  ));
  return editor?.document.getText();
}

function lineCount(text: string): number {
  return text.length === 0 ? 0 : text.split(/\r?\n/u).length;
}

function hasVisiblePysdDiff(relativePath: string): boolean {
  const normalized = relativePath.replace(/\\/gu, "/");
  const hasEditors = vscode.window.visibleTextEditors.some(
    (editor) => editor.document.uri.path.endsWith(normalized) || editor.document.uri.path.endsWith(path.basename(normalized)),
  ) && vscode.window.visibleTextEditors.some(
    (editor) => (editor.document.uri.scheme === "intentdiff-base" || editor.document.uri.scheme === "intentdiff-semantic-base")
      && (editor.document.uri.path.endsWith(normalized) || editor.document.uri.path.endsWith(path.basename(normalized))),
  );
  if (hasEditors) {
    return true;
  }
  const tab = vscode.window.tabGroups.activeTabGroup.activeTab;
  return !isSemanticDiffWebviewActive()
    && (tab?.label.includes("IntentDiff:") === true || tab?.label.includes(path.basename(normalized)) === true);
}

async function prepareWorkbenchForScreenshot(): Promise<void> {
  for (const command of [
    "workbench.action.closeSidebar",
    "workbench.action.closeAuxiliaryBar",
    "workbench.action.closePanel",
    "notifications.hideList",
    "notifications.hideToasts",
  ]) {
    try {
      await vscode.commands.executeCommand(command);
    } catch {
      // Optional workbench chrome command; ignore if unavailable in this VS Code build.
    }
  }
  await sleep(500);
}

function captureWindowScreenshot(targetPath: string, expectedMarker: string): ScreenshotCapture {
  if (process.platform !== "win32") {
    throw new Error("SemanticDiff UI comparison screenshots currently require Windows.");
  }
  fs.mkdirSync(path.dirname(targetPath), { recursive: true });
  const metadataPath = `${targetPath}.meta.json`;
  const script = [
    "$ErrorActionPreference = 'Stop'",
    `$targetPath = ${JSON.stringify(targetPath)}`,
    `$metaPath = ${JSON.stringify(metadataPath)}`,
    `$expectedMarker = ${JSON.stringify(expectedMarker)}`,
    "Add-Type -AssemblyName System.Drawing",
    "Add-Type -AssemblyName System.Windows.Forms",
    "Add-Type @'",
    "using System;",
    "using System.Text;",
    "using System.Runtime.InteropServices;",
    "public static class NativeWindowCapture {",
    "  public delegate bool EnumWindowsProc(IntPtr hWnd, IntPtr lParam);",
    "  [DllImport(\"user32.dll\")] public static extern bool EnumWindows(EnumWindowsProc callback, IntPtr lParam);",
    "  [DllImport(\"user32.dll\")] public static extern IntPtr GetForegroundWindow();",
    "  [DllImport(\"user32.dll\")] public static extern bool GetWindowRect(IntPtr hWnd, out RECT rect);",
    "  [DllImport(\"user32.dll\")] public static extern bool IsWindowVisible(IntPtr hWnd);",
    "  [DllImport(\"user32.dll\", CharSet = CharSet.Unicode)] public static extern int GetWindowText(IntPtr hWnd, StringBuilder text, int count);",
    "  [DllImport(\"user32.dll\", CharSet = CharSet.Unicode)] public static extern int GetWindowTextLength(IntPtr hWnd);",
    "  [DllImport(\"user32.dll\")] public static extern bool SetForegroundWindow(IntPtr hWnd);",
    "  [DllImport(\"user32.dll\")] public static extern bool BringWindowToTop(IntPtr hWnd);",
    "  [DllImport(\"user32.dll\")] public static extern IntPtr SetActiveWindow(IntPtr hWnd);",
    "  [DllImport(\"user32.dll\")] public static extern IntPtr SetFocus(IntPtr hWnd);",
    "  [DllImport(\"user32.dll\")] public static extern bool SetWindowPos(IntPtr hWnd, IntPtr hWndInsertAfter, int X, int Y, int cx, int cy, uint uFlags);",
    "  [DllImport(\"user32.dll\")] public static extern bool ShowWindow(IntPtr hWnd, int nCmdShow);",
    "  public struct RECT { public int Left; public int Top; public int Right; public int Bottom; }",
    "  public static string GetTitle(IntPtr hWnd) {",
    "    int length = GetWindowTextLength(hWnd);",
    "    if (length <= 0) { return string.Empty; }",
    "    StringBuilder text = new StringBuilder(length + 1);",
    "    GetWindowText(hWnd, text, text.Capacity);",
    "    return text.ToString();",
    "  }",
    "  private static bool Contains(string value, string needle) {",
    "    return !String.IsNullOrEmpty(needle) && value.IndexOf(needle, StringComparison.OrdinalIgnoreCase) >= 0;",
    "  }",
    "  public static IntPtr FindVSCodeWindow(string expectedMarker) {",
    "    IntPtr best = IntPtr.Zero;",
    "    int bestScore = -1000000;",
    "    int bestArea = 0;",
    "    EnumWindows((hWnd, lParam) => {",
    "      if (!IsWindowVisible(hWnd)) { return true; }",
    "      string title = GetTitle(hWnd);",
    "      if (String.IsNullOrEmpty(title)) { return true; }",
    "      bool isComparisonHost = Contains(title, expectedMarker) || Contains(title, \"intentdiff-semanticdiff-comparison\") || Contains(title, \"semanticdiff-comparison-workspace\") || Contains(title, \"Extension Development Host\");",
    "      if (!isComparisonHost) { return true; }",
    "      RECT rect;",
    "      if (!GetWindowRect(hWnd, out rect)) { return true; }",
    "      int width = rect.Right - rect.Left;",
    "      int height = rect.Bottom - rect.Top;",
    "      if (width < 500 || height < 300) { return true; }",
    "      int area = width * height;",
    "      int score = 0;",
    "      if (Contains(title, expectedMarker)) { score += 1000; }",
    "      if (Contains(title, \"intentdiff-semanticdiff-comparison\")) { score += 900; }",
    "      if (Contains(title, \"semanticdiff-comparison-workspace\")) { score += 850; }",
    "      if (Contains(title, \"Extension Development Host\")) { score += 800; }",
    "      if (Contains(title, \"Visual Studio Code\")) { score += 50; }",
    "      if (Contains(title, \"IntentDiff\") && !Contains(title, \"Extension Development Host\") && !Contains(title, \"intentdiff-semanticdiff-comparison\")) { score -= 1000; }",
    "      if (score > bestScore || (score == bestScore && area > bestArea)) { best = hWnd; bestScore = score; bestArea = area; }",
    "      return true;",
    "    }, IntPtr.Zero);",
    "    return best;",
    "  }",
    "}",
    "'@",
    "$handle = [NativeWindowCapture]::FindVSCodeWindow($expectedMarker)",
    "if ($handle -eq [IntPtr]::Zero -or $null -eq $handle) { throw \"No comparison Extension Development Host window found for screenshot marker '$expectedMarker'.\" }",
    "$title = [NativeWindowCapture]::GetTitle($handle)",
    "$accepted = $false",
    "foreach ($marker in @($expectedMarker, 'intentdiff-semanticdiff-comparison', 'semanticdiff-comparison-workspace')) {",
    "  if ($marker -and $title.IndexOf($marker, [System.StringComparison]::OrdinalIgnoreCase) -ge 0) { $accepted = $true }",
    "}",
    "if (-not $accepted) { throw \"Refusing to capture non-comparison VS Code window: $title\" }",
    "[void][NativeWindowCapture]::ShowWindow($handle, 3)",
    "[void][NativeWindowCapture]::SetWindowPos($handle, [IntPtr](-1), 0, 0, 0, 0, 0x0043)",
    "[void][NativeWindowCapture]::BringWindowToTop($handle)",
    "$shell = New-Object -ComObject WScript.Shell",
    "[void]$shell.AppActivate($title)",
    "[System.Windows.Forms.SendKeys]::SendWait('%')",
    "[void][NativeWindowCapture]::SetForegroundWindow($handle)",
    "[void][NativeWindowCapture]::SetActiveWindow($handle)",
    "[void][NativeWindowCapture]::SetFocus($handle)",
    "Start-Sleep -Milliseconds 900",
    "$foregroundHandle = [NativeWindowCapture]::GetForegroundWindow()",
    "$foregroundTitle = [NativeWindowCapture]::GetTitle($foregroundHandle)",
    "$foregroundAccepted = $false",
    "foreach ($marker in @($expectedMarker, 'intentdiff-semanticdiff-comparison', 'semanticdiff-comparison-workspace')) {",
    "  if ($marker -and $foregroundTitle.IndexOf($marker, [System.StringComparison]::OrdinalIgnoreCase) -ge 0) { $foregroundAccepted = $true }",
    "}",
    "if (-not $foregroundAccepted) {",
    "  [void][NativeWindowCapture]::SetWindowPos($handle, [IntPtr](-2), 0, 0, 0, 0, 0x0043)",
    "  throw \"Refusing to capture because foreground window is not the comparison host: $foregroundTitle\"",
    "}",
    "$rect = New-Object NativeWindowCapture+RECT",
    "[void][NativeWindowCapture]::GetWindowRect($handle, [ref]$rect)",
    "$width = [Math]::Max(1, $rect.Right - $rect.Left)",
    "$height = [Math]::Max(1, $rect.Bottom - $rect.Top)",
    "$bitmap = New-Object System.Drawing.Bitmap $width, $height",
    "$graphics = [System.Drawing.Graphics]::FromImage($bitmap)",
    "$graphics.Clear([System.Drawing.ColorTranslator]::FromHtml('#1e1e1e'))",
    "$graphics.CopyFromScreen($rect.Left, $rect.Top, 0, 0, $bitmap.Size)",
    "$bitmap.Save($targetPath, [System.Drawing.Imaging.ImageFormat]::Png)",
    "$graphics.Dispose()",
    "$bitmap.Dispose()",
    "[void][NativeWindowCapture]::SetWindowPos($handle, [IntPtr](-2), 0, 0, 0, 0, 0x0043)",
    "$metadata = [ordered]@{ title = $title; foreground_title = $foregroundTitle; width = $width; height = $height; expected_marker = $expectedMarker; target_path = $targetPath }",
    "$metadata | ConvertTo-Json -Depth 3 | Set-Content -LiteralPath $metaPath -Encoding UTF8",
  ].join("\n");
  execFileSync("powershell.exe", [
    "-NoProfile",
    "-ExecutionPolicy",
    "Bypass",
    "-Command",
    script,
  ], {
    stdio: "pipe",
    windowsHide: true,
  });
  const metadataText = fs.readFileSync(metadataPath, "utf8").replace(/^\uFEFF/u, "");
  const metadata = JSON.parse(metadataText) as ScreenshotCapture;
  assert.ok(
    metadata.title.includes("Extension Development Host")
      || metadata.title.includes("intentdiff-semanticdiff-comparison")
      || metadata.title.includes("semanticdiff-comparison-workspace")
      || metadata.title.includes(expectedMarker),
    `screenshot captured wrong window: ${metadata.title}`,
  );
  return metadata;
}

function execGit(cwd: string, args: string[]): string {
  return execFileSync("git", ["-c", `safe.directory=${cwd}`, ...args], {
    cwd,
    encoding: "utf8",
    stdio: "pipe",
    windowsHide: true,
  });
}

function sum(values: number[]): number {
  return values.reduce((total, value) => total + value, 0);
}

function average(values: number[]): number {
  return values.length === 0 ? 0 : Math.round(sum(values) / values.length);
}

function requiredEnv(name: string): string {
  const value = process.env[name];
  assert.ok(value, `${name} should be set`);
  return value;
}

async function waitFor(predicate: () => boolean | Promise<boolean>, description: string): Promise<void> {
  const started = Date.now();
  while (Date.now() - started < 20_000) {
    if (await predicate()) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`Timed out waiting for ${description}`);
}

async function waitForMaybe(predicate: () => boolean | Promise<boolean>, timeoutMs: number): Promise<boolean> {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    if (await predicate()) {
      return true;
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  return false;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

const LIVE_SERVER = String.raw`
const fs = require("node:fs");
const readline = require("node:readline");

function write(payload) {
  process.stdout.write(JSON.stringify(payload) + "\n");
}

function refArg() {
  const index = process.argv.indexOf("--ref");
  return index >= 0 && process.argv[index + 1] ? process.argv[index + 1] : "HEAD";
}

function commitDiff() {
  return JSON.parse(fs.readFileSync(".intentdiff-comparison-commit-diff.json", "utf8"));
}

write({
  op: "ready",
  ok: true,
  protocol_version: 2,
  repo_path: process.cwd(),
  ref: refArg(),
  transport: "stdio",
  capabilities: { diff: true, cancel: true },
  limits: { max_content_bytes: 5_000_000 },
});

readline.createInterface({ input: process.stdin, crlfDelay: Infinity }).on("line", (line) => {
  const payload = JSON.parse(line);
  if (payload.op === "cancel") {
    write({ op: "cancel", seq: payload.seq, ok: true, cancelled: payload.seq });
    return;
  }
  if (payload.op === "review") {
    const diff = commitDiff();
    write({
      op: "review",
      seq: payload.seq,
      ok: true,
      metadata: {
        duration_ms: 1,
        file_count: diff.file_diffs.length,
        guardrail_violation_count: 0,
        cross_file_change_count: 0,
      },
      commit_diff: diff,
    });
    return;
  }
  if (payload.op === "diff") {
    const diff = commitDiff().file_diffs.find((item) => item.new_filename === payload.path || item.old_filename === payload.path);
    write({
      op: "diff",
      seq: payload.seq,
      ok: true,
      metadata: { duration_ms: 1, language: diff?.language || "generic", change_count: diff?.changes?.length || 0 },
      diff,
    });
    return;
  }
  write({ op: payload.op || "unknown", seq: payload.seq || 0, ok: true });
});
`;
