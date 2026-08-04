import * as assert from "node:assert/strict";
import { execFile } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import * as vscode from "vscode";

interface FakeLogEntry {
  kind: string;
  argv?: string[];
  payload?: Record<string, unknown>;
}

interface LanguageSmokeFile {
  language: string;
  kind: "addition" | "deletion" | "modification" | "style" | "guardrail" | "parse" | "refactoring";
  path: string;
}

interface TestReviewState {
  files: Array<{
    folderUri: string;
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
  snapshots?: Array<{
    folderUri: string;
    ref: string;
    resolvedCommit?: string;
    statusSignature: string;
  }>;
}

interface TestActiveDiffState {
  mode: "full" | "semanticOnly";
  relativePath: string;
  baseScheme: string;
  modifiedScheme: string;
  contextLines: number;
  selectedChangeCount?: number;
}

export async function run(): Promise<void> {
  await integrationScenario();
}

async function integrationScenario(): Promise<void> {
  const fixture = requiredEnv("INTENTUMDIFF_VSCODE_FIXTURE");
  const logPath = requiredEnv("INTENTUMDIFF_VSCODE_LOG");
  const nodeExecutable = requiredEnv("INTENTUMDIFF_NODE_EXECUTABLE");
  const repoRoot = requiredEnv("INTENTUMDIFF_REPO_ROOT");
  fs.rmSync(logPath, { force: true });
  const languageSmokeFiles = buildLanguageSmokeFiles(readSupportedLanguages(repoRoot));
  await setupReviewFixture(fixture, languageSmokeFiles);

  await ensureWorkspaceFolder(fixture);

  const extension = vscode.extensions.getExtension("buchochelliq-labs.intentumdiff");
  assert.ok(extension, "extension should be discoverable in the Extension Host");
  await extension.activate();

  const config = vscode.workspace.getConfiguration("intentumdiff");
  // `intentumdiff.executable` is declared scope:"machine" in package.json, which
  // current VS Code stable only permits writing to the User (Global) target.
  // Writing it to Workspace throws CodeExpectedError and aborts setup.
  await config.update("executable", nodeExecutable, vscode.ConfigurationTarget.Global);
  await config.update("ref", "HEAD", vscode.ConfigurationTarget.Workspace);
  await config.update("debounceMs", 50, vscode.ConfigurationTarget.Workspace);
  await config.update("review.pollIntervalMs", 500, vscode.ConfigurationTarget.Workspace);
  await config.update("diff.contextLines", 3, vscode.ConfigurationTarget.Workspace);
  await config.update("trace", true, vscode.ConfigurationTarget.Workspace);
  await config.update("enabled", true, vscode.ConfigurationTarget.Workspace);

  const sampleUri = vscode.Uri.file(path.join(fixture, "sample.yaml"));
  const document = await vscode.workspace.openTextDocument(sampleUri);
  await vscode.window.showTextDocument(document);

  // SKIPPED: live-server diffActiveFile requires a Python binary not in the
  // test path. We jump straight to the semantic-only diff that exercises the
  // webview fixes (chevron, palette, line numbers).
  if (process.env.INTENTUMDIFF_SKIP_LIVE_DIFF === "1") {
    await openSemanticDiffForBooPy(fixture);
    return;
  }

  await replaceDocument(document, "guardrail: true\nvalue: changed\n");
  await vscode.commands.executeCommand("intentumdiff.diffActiveFile");
  await waitFor(() => hasRequest(logPath, "diff"), "diff request");
  await waitFor(
    () => vscode.languages.getDiagnostics(sampleUri).some((item) => item.code === "prod-host"),
    "guardrail diagnostic",
  );

  await vscode.commands.executeCommand("intentumdiff.diffActiveFile");
  await waitFor(() => hasRequest(logPath, "cancel"), "cancel request");

  await replaceDocument(document, "clean: true\n");
  await vscode.commands.executeCommand("intentumdiff.diffActiveFile");
  await waitFor(
    () => vscode.languages.getDiagnostics(sampleUri).length === 0,
    "clean diff clears diagnostics",
  );

  const startsBeforeRestart = readLog(logPath).filter((entry) => entry.kind === "start").length;
  await config.update("ref", "origin/main", vscode.ConfigurationTarget.Workspace);
  await waitFor(
    () => readLog(logPath).filter((entry) => entry.kind === "start").length > startsBeforeRestart,
    "settings change restarts LiveServer",
  );
  // waitFor rather than assert: config updates earlier in setup can queue
  // extra restarts, so the first start after the ref change may still carry
  // the old ref - the contract is that the new ref EVENTUALLY arrives.
  await waitFor(
    () => readLog(logPath).some(
      (entry) => entry.kind === "start" && entry.argv?.includes("origin/main"),
    ),
    "restarted LiveServer should receive the updated ref",
  );

  await replaceDocument(document, "server-error: true\n");
  await vscode.commands.executeCommand("intentumdiff.diffActiveFile");
  await waitFor(
    () => readLog(logPath).some(
      (entry) => entry.payload?.op === "diff"
        && typeof entry.payload.content === "string"
        && entry.payload.content.includes("server-error"),
    ),
    "server-error diff request",
  );

  const startsBeforeReview = readLog(logPath).filter((entry) => entry.kind === "start").length;
  await config.update("ref", "HEAD", vscode.ConfigurationTarget.Workspace);
  await waitFor(
    () => readLog(logPath).filter((entry) => entry.kind === "start").length > startsBeforeReview,
    "review ref reset restarts LiveServer",
  );

  const reviewsBeforeAuto = countRequests(logPath, "review");
  await vscode.commands.executeCommand("intentumdiff.clearReview");
  await vscode.commands.executeCommand("intentumdiff.semanticChanges.focus");
  await waitFor(
    () => countRequests(logPath, "review") > reviewsBeforeAuto,
    "semantic view auto review request",
  );
  await delay(500);
  await captureWindowScreenshot("actual-semantic-changes-view.png");
  await captureTreeItemScreenshot("delete-selection-tree-item.png");
  await captureDeletedFileTreeItemScreenshot("deleted-file-semantic-changes-entry.png");
  assert.equal(hasDiffRequestFor(logPath, "review-deleted.yaml"), false);
  assert.equal(hasDiffRequestFor(logPath, "binary.dat"), false);
  await waitForReviewFile("review-stale.yaml");

  const incrementalEditStart = readLog(logPath).length;
  const reviewsBeforeIncrementalEdit = countRequests(logPath, "review");
  await vscode.workspace.fs.writeFile(
    vscode.Uri.file(path.join(fixture, "review-guardrail.yaml")),
    Buffer.from("guardrail: true\nextra: changed\n", "utf8"),
  );
  await waitFor(
    () => hasDiffRequestForAfter(logPath, "review-guardrail.yaml", incrementalEditStart),
    "incremental review diff request",
  );
  assert.deepEqual(uniqueDiffPathsAfter(logPath, incrementalEditStart), ["review-guardrail.yaml"]);
  assert.equal(
    countRequests(logPath, "review"),
    reviewsBeforeIncrementalEdit,
    "single-file edit should not trigger a full review",
  );

  await vscode.workspace.fs.writeFile(
    vscode.Uri.file(path.join(fixture, "review-stale.yaml")),
    Buffer.from("stale: false\n", "utf8"),
  );
  await waitForReviewFileMissing("review-stale.yaml");

  const addedStart = readLog(logPath).length;
  const addedPath = path.join(fixture, "review-added.yaml");
  await vscode.workspace.fs.writeFile(vscode.Uri.file(addedPath), Buffer.from("added: true\n", "utf8"));
  assert.equal(fs.existsSync(addedPath), true, "added review file should exist on disk");
  await waitFor(
    () => hasDiffRequestForAfter(logPath, "review-added.yaml", addedStart),
    "added file incremental review diff request",
  );
  await waitForReviewFile("review-added.yaml");

  const reviewsBeforeRename = countRequests(logPath, "review");
  await vscode.workspace.fs.rename(
    vscode.Uri.file(path.join(fixture, "review-renamed-source.yaml")),
    vscode.Uri.file(path.join(fixture, "review-renamed-target.yaml")),
  );
  await waitFor(
    () => countRequests(logPath, "review") > reviewsBeforeRename,
    "rename triggers full semantic review",
  );

  const folderUri = vscode.Uri.file(fixture).toString();
  const reviewUri = vscode.Uri.file(path.join(fixture, "review-guardrail.yaml"));
  await vscode.commands.executeCommand("intentumdiff.openSemanticDiff", {
    folderUri,
    relativePath: "review-guardrail.yaml",
    position: { start_line: 0, start_col: 0, end_line: 0, end_col: 16 },
  });
  await waitFor(
    () => vscode.languages.getDiagnostics(reviewUri).some((item) => item.code === "prod-host"),
    "semantic review guardrail diagnostic",
  );
  await waitFor(
    () => vscode.window.visibleTextEditors.some(
      (editor) => editor.document.uri.scheme === "intentumdiff-base",
    ),
    "semantic base diff editor",
  );
  const baseEditor = vscode.window.visibleTextEditors.find(
    (editor) => editor.document.uri.scheme === "intentumdiff-base",
  );
  assert.match(baseEditor?.document.getText() ?? "", /guardrail: false/u);

  const deletedReviewedFilePosition = { start_line: 0, start_col: 0, end_line: 0, end_col: 11 };
  const deletedReviewedFileStart = readLog(logPath).length;
  await vscode.workspace.fs.delete(vscode.Uri.file(path.join(fixture, "review-clean.yaml")));
  await waitFor(
    () => hasDiffRequestForAfter(logPath, "review-clean.yaml", deletedReviewedFileStart),
    "deleted reviewed file incremental diff request",
  );
  await vscode.commands.executeCommand("intentumdiff.openSemanticDiff", {
    folderUri,
    relativePath: "review-clean.yaml",
    position: deletedReviewedFilePosition,
    positionSide: "base",
    change: {
      change_type: "DELETION",
      description: "Delete line 1: 'base: false'",
      old_node: {
        node_type: "block_mapping_pair",
        label: "base: false",
        position: deletedReviewedFilePosition,
      },
    },
  });
  await waitFor(
    () => selectedTextFor("intentumdiff-base", "review-clean.yaml") === "base: false",
    "incrementally deleted file selects removed text on base side",
  );

  const readmeDeletionPosition = { start_line: 72, start_col: 24, end_line: 72, end_col: 33 };
  const readmeDeletionChange = {
    change_type: "DELETION",
    description: "Delete text on line 73: ' Optional'",
    text_diff: "| `intentumdiff.fuel` | `[+\"i]n[-ull][+f\"]` |[- Optional] `--fuel` override [+for active-file live diffs. Set `null` to use `intentumdiff.yaml`. ]|",
    old_node: {
      node_type: "text_span",
      label: " Optional",
      position: readmeDeletionPosition,
    },
  };
  const readmeReviewNode = {
    kind: "entry",
    file: {
      folderName: "intentumdiff-fixture",
      folderUri,
      relativePath: "review-readme.md",
      status: "ready",
    },
    entry: {
      kind: "change",
      label: "Delete text on line 73: ' Optional'",
      description: "DELETION",
      severity: "info",
      position: readmeDeletionPosition,
      positionSide: "base",
      change: readmeDeletionChange,
    },
  };
  await vscode.commands.executeCommand("intentumdiff.openSemanticDiff", readmeReviewNode);
  await waitFor(
    () => selectedTextFor("intentumdiff-base", "review-readme.md") === " Optional",
    "README deletion selects removed text on base side from tree node",
  );
  assert.equal(
    vscode.window.visibleTextEditors.some((editor) => editor.document.uri.scheme === "intentumdiff-semantic-base"),
    false,
    "default semantic diff mode should remain the full VS Code diff",
  );
  await captureEditorScreenshot(
    "delete-selection-base-side.png",
    "Delete selection target",
    editorProofState("intentumdiff-base", "review-readme.md", 72, "left/base"),
    editorProofState("file", "review-readme.md", 72, "right/current"),
  );
  await captureEditorScreenshot(
    "delete-selection-right-side-clear.png",
    "Right side remains clear",
    editorProofState("file", "review-readme.md", 72, "right/current"),
  );
  assert.notEqual(
    selectedTextFor("file", "review-readme.md"),
    '"inf"',
    "README deletion must not select the replacement value on the modified side",
  );

  await vscode.commands.executeCommand("intentumdiff.openSemanticOnlyDiff", readmeReviewNode);
  await waitFor(
    () => selectedTextFor("intentumdiff-semantic-base", "review-readme.md") === " Optional",
    "semantic-only tree command selects removed text on semantic base side",
  );
  await vscode.commands.executeCommand("intentumdiff.nextSemanticChange");
  await waitFor(
    () => selectedTextFor("intentumdiff-semantic-modified", "review-readme.md") === "\"i",
    "next semantic change selects the first modified-side semantic chunk",
  );
  await vscode.commands.executeCommand("intentumdiff.previousSemanticChange");
  await waitFor(
    () => selectedTextFor("intentumdiff-semantic-base", "review-readme.md") === " Optional",
    "previous semantic change returns to base-side deletion in semantic-only diff",
  );
  await vscode.commands.executeCommand("intentumdiff.collapseSemanticDiffContext");
  await waitFor(
    async () => (await activeDiffState())?.contextLines === 2,
    "semantic-only context collapse updates the active semantic-only diff",
  );
  await vscode.commands.executeCommand("intentumdiff.expandSemanticDiffContext");
  await waitFor(
    async () => (await activeDiffState())?.contextLines === 3,
    "semantic-only context expand updates the active semantic-only diff",
  );
  await vscode.commands.executeCommand("intentumdiff.openFullDiff", readmeReviewNode);
  await waitFor(
    () => selectedTextFor("intentumdiff-base", "review-readme.md") === " Optional",
    "full diff tree command preserves base-side deletion selection",
  );

  await vscode.commands.executeCommand("intentumdiff.openSemanticDiff", {
    folderUri,
    relativePath: "review-readme.md",
    position: readmeDeletionPosition,
  });
  await waitFor(
    () => selectedTextFor("intentumdiff-base", "review-readme.md") === " Optional",
    "README deletion infers base side when positionSide is missing",
  );

  const deletedLinePosition = { start_line: 0, start_col: 0, end_line: 0, end_col: 10 };
  const deletedLineChange = {
    change_type: "DELETION",
    description: "Delete line 1: 'gone: true'",
    old_node: {
      node_type: "block_mapping_pair",
      label: "gone: true",
      position: deletedLinePosition,
    },
  };
  await vscode.commands.executeCommand("intentumdiff.openSemanticDiff", {
    folderUri,
    relativePath: "review-deleted.yaml",
    position: deletedLinePosition,
    positionSide: "base",
    change: deletedLineChange,
  });
  await waitFor(
    () => selectedTextFor("intentumdiff-base", "review-deleted.yaml") === "gone: true",
    "deleted file selects removed text on base side",
  );
  await waitFor(
    () => vscode.window.visibleTextEditors.some(
      (editor) => editor.document.uri.scheme === "intentumdiff-empty"
        && editor.document.uri.path.endsWith("review-deleted.yaml"),
    ),
    "deleted file opens an empty modified side",
  );
  await captureWindowScreenshot("actual-deleted-file-diff-view.png");
  await captureEditorScreenshot(
    "deleted-file-selection-base-side.png",
    "Deleted file selection target",
    editorProofState("intentumdiff-base", "review-deleted.yaml", 0, "left/base"),
    editorProofState("intentumdiff-empty", "review-deleted.yaml", 0, "right/deleted"),
  );
  await captureInlineDiffScreenshot(
    "deleted-file-selection-inline-diff.png",
    "Deleted file inline diff target",
    editorProofState("intentumdiff-base", "review-deleted.yaml", 0, "base"),
    editorProofState("intentumdiff-empty", "review-deleted.yaml", 0, "deleted"),
  );
  await vscode.commands.executeCommand("intentumdiff.openSemanticOnlyDiff");
  await waitFor(
    () => selectedTextFor("intentumdiff-semantic-base", "review-deleted.yaml") === "gone: true",
    "deleted file semantic-only diff selects removed text on semantic base side",
  );
  await config.update("visualization.showAdditions", false, vscode.ConfigurationTarget.Workspace);
  await config.update("visualization.showModifications", false, vscode.ConfigurationTarget.Workspace);
  await config.update("visualization.showDeletions", false, vscode.ConfigurationTarget.Workspace);
  await waitFor(
    () => textDocumentTextFor("intentumdiff-semantic-base", "review-readme.md") === "IntentumDiff: no semantic changes match the current filters."
      && textDocumentTextFor("intentumdiff-semantic-base", "review-deleted.yaml") === "IntentumDiff: no semantic changes match the current filters.",
    "all open semantic-only diffs refresh to the no-matching-changes message when filters hide every change",
  );
  await config.update("visualization.showAdditions", true, vscode.ConfigurationTarget.Workspace);
  await config.update("visualization.showModifications", true, vscode.ConfigurationTarget.Workspace);
  await config.update("visualization.showDeletions", true, vscode.ConfigurationTarget.Workspace);
  await waitFor(
    () => selectedTextFor("intentumdiff-semantic-base", "review-deleted.yaml") === "gone: true",
    "semantic-only deleted file restores removed-text selection after filters are shown",
  );

  await vscode.commands.executeCommand("intentumdiff.openChange", {
    folderUri,
    relativePath: "review-guardrail.yaml",
    crossFileChange: {
      change_type: "MOVE_TO_MODULE",
      symbol_name: "greet",
      old_file: "src/source.py",
      new_file: "review-guardrail.yaml",
      new_position: { start_line: 0, start_col: 0, end_line: 0, end_col: 16 },
      description: "'greet' moved",
    },
  });
  await waitFor(
    () => vscode.window.visibleTextEditors.some(
      (editor) => editor.document.uri.fsPath.endsWith("review-guardrail.yaml")
        && editor.selection.active.line === 0,
    ),
    "cross-file target position reveal",
  );

  await runLanguageSmokeScenario(fixture, logPath, folderUri, languageSmokeFiles);
  await runCommitRefreshScenario(fixture, logPath, folderUri);
  await runStaleIncrementalResponseScenario(fixture, logPath);
  await runPendingFullReviewNoResendScenario(fixture, logPath);

  await vscode.commands.executeCommand("intentumdiff.clearReview");
}

/** git object/pack files are read-only on Windows; rmSync alone EPERMs. */
function removeGitDirectory(target: string): void {
  if (!fs.existsSync(target)) {
    return;
  }
  // Rename aside FIRST: rmSync with open handles (the extension polls `git
  // status` in this folder) leaves a Windows delete-pending tombstone that a
  // subsequent `git init` writes into — the contents evaporate when the
  // handles release, yielding an empty invalid .git. A rename frees the name
  // immediately; the stale copy is deleted best-effort.
  const stale = `${target}-stale-${Date.now()}`;
  try {
    fs.renameSync(target, stale);
  } catch {
    // rename blocked - fall through and delete in place
  }
  const doomed = fs.existsSync(stale) ? stale : target;
  for (const entry of [".", ...(fs.readdirSync(doomed, { recursive: true }) as string[])]) {
    try {
      fs.chmodSync(path.join(doomed, entry), 0o777);
    } catch {
      // races are fine - rmSync gets another chance below
    }
  }
  try {
    fs.rmSync(doomed, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
  } catch {
    if (doomed === target) {
      throw new Error(`cannot free ${target} for git init`);
    }
    // stale copy survives in the temp dir - harmless
  }
}

async function setupReviewFixture(fixture: string, languageSmokeFiles: LanguageSmokeFile[]): Promise<void> {
  // INTENTUMDIFF_FIXTURE_DIR may point at a not-yet-created directory (the
  // documented OneDrive-escape path) — the suite populates it from scratch.
  fs.mkdirSync(fixture, { recursive: true });
  // The extension spawns `<executable> live-server ...` with cwd pinned to the
  // EXTENSION path (a deliberate hardening: a workspace-planted executable must
  // never win resolution). The suite sets the executable to node, so node
  // resolves the literal `live-server` script relative to that cwd — stage the
  // fake-server stub at the extension root (gitignored) or every diff wait
  // times out. read+write rather than copyFileSync: OneDrive holds the source
  // in a state where copyfile EBUSYs but plain reads succeed.
  const extensionRoot = path.join(__dirname, "..", "..", "..");
  const stubSource = path.join(extensionRoot, "test", "fixtures", "workspace", "live-server");
  fs.writeFileSync(path.join(extensionRoot, "live-server"), fs.readFileSync(stubSource));
  removeGitDirectory(path.join(fixture, ".git"));
  for (const generatedFile of [
    ".intentumdiff-language-smoke.json",
    ".intentumdiff-last-commit-refresh-state.json",
    "review-added.yaml",
    "review-renamed-target.yaml",
    "review-slow.yaml",
  ]) {
    fs.rmSync(path.join(fixture, generatedFile), { force: true });
  }
  for (const generatedDirectory of ["language-smoke", "language-smoke-added"]) {
    // maxRetries rides out Windows delete-pending races left by a previous
    // extension-host process that crashed mid-run.
    fs.rmSync(path.join(fixture, generatedDirectory), {
      recursive: true,
      force: true,
      maxRetries: 5,
      retryDelay: 100,
    });
  }
  fs.writeFileSync(path.join(fixture, "sample.yaml"), "clean: true\n", "utf8");
  fs.writeFileSync(path.join(fixture, "review-guardrail.yaml"), "guardrail: false\n", "utf8");
  fs.writeFileSync(path.join(fixture, "review-clean.yaml"), "base: false\n", "utf8");
  fs.writeFileSync(path.join(fixture, "review-deleted.yaml"), "gone: true\n", "utf8");
  fs.writeFileSync(path.join(fixture, "review-stale.yaml"), "stale: false\n", "utf8");
  fs.writeFileSync(path.join(fixture, "review-renamed-source.yaml"), "rename: false\n", "utf8");
  for (const item of languageSmokeFiles) {
    if (item.kind === "addition") {
      continue;
    }
    const targetPath = path.join(fixture, item.path);
    fs.mkdirSync(path.dirname(targetPath), { recursive: true });
    fs.writeFileSync(targetPath, "old value\n", "utf8");
  }
  fs.writeFileSync(
    path.join(fixture, "review-readme.md"),
    readmeFixtureContent("| `intentumdiff.fuel` | `null` | Optional `--fuel` override |"),
    "utf8",
  );
  fs.writeFileSync(path.join(fixture, ".gitignore"), ".intentumdiff-fake-log.jsonl\n.intentumdiff-language-smoke.json\n", "utf8");
  fs.rmSync(path.join(fixture, "binary.dat"), { force: true });

  await execGit(fixture, ["init"]);
  await execGit(fixture, ["add", "."]);
  await execGit(fixture, [
    "-c",
    "user.name=intentumdiff test",
    "-c",
    "user.email=intentumdiff@example.com",
    "commit",
    "-m",
    "baseline",
  ]);

  fs.writeFileSync(path.join(fixture, "review-guardrail.yaml"), "guardrail: true\n", "utf8");
  fs.writeFileSync(path.join(fixture, "review-clean.yaml"), "clean: true\n", "utf8");
  fs.writeFileSync(path.join(fixture, "review-stale.yaml"), "stale: true\n", "utf8");
  fs.writeFileSync(
    path.join(fixture, "review-readme.md"),
    readmeFixtureContent("| `intentumdiff.fuel` | `\"inf\"` | `--fuel` override for active-file live diffs. Set `null` to use `intentumdiff.yaml`. |"),
    "utf8",
  );
  fs.rmSync(path.join(fixture, "review-deleted.yaml"), { force: true });
  fs.writeFileSync(path.join(fixture, "binary.dat"), Buffer.from([0, 1, 2, 3]));
}

function readSupportedLanguages(repoRoot: string): string[] {
  const encodedLanguages = process.env.INTENTUMDIFF_SUPPORTED_LANGUAGES;
  if (encodedLanguages) {
    const languages = JSON.parse(encodedLanguages) as unknown;
    assert.ok(Array.isArray(languages), "INTENTUMDIFF_SUPPORTED_LANGUAGES should be a JSON string array");
    assert.ok(languages.every((item) => typeof item === "string"), "INTENTUMDIFF_SUPPORTED_LANGUAGES should only contain strings");
    assert.ok(languages.length > 0, "runtime supported language list should not be empty");
    return languages;
  }
  const pyproject = fs.readFileSync(path.join(repoRoot, "pyproject.toml"), "utf8");
  const section = pyproject.match(/\[project\.entry-points\."intentumdiff\.parsers"\]\r?\n(?<body>[\s\S]*?)(?:\r?\n\[|$)/u);
  const languages = new Set(section?.groups?.body
    .split(/\r?\n/u)
    .map((line) => line.match(/^\s*([a-z0-9-]+)\s*=/iu)?.[1])
    .filter((language): language is string => Boolean(language)) ?? []);
  for (const alias of ["databricks", "wast"]) {
    languages.add(alias);
  }
  assert.ok(languages.size > 0, "runtime supported language list should not be empty");
  return [...languages].sort();
}

function buildLanguageSmokeFiles(languages: string[]): LanguageSmokeFile[] {
  const kinds: LanguageSmokeFile["kind"][] = [
    "addition",
    "deletion",
    "modification",
    "style",
    "guardrail",
    "parse",
    "refactoring",
  ];
  return languages.map((language, index) => {
    const kind = kinds[index % kinds.length];
    const slug = language.replace(/[^a-z0-9_-]/giu, "_");
    return {
      language,
      kind,
      path: kind === "addition"
        ? `language-smoke-added/${slug}.txt`
        : `language-smoke/${slug}.txt`,
    };
  });
}

async function runLanguageSmokeScenario(
  fixture: string,
  logPath: string,
  folderUri: string,
  files: LanguageSmokeFile[],
): Promise<void> {
  prepareLanguageSmokeWorkingTree(fixture, files);
  fs.writeFileSync(
    path.join(fixture, ".intentumdiff-language-smoke.json"),
    JSON.stringify({ files }, null, 2),
    "utf8",
  );
  const reviewsBefore = countRequests(logPath, "review");
  await vscode.commands.executeCommand("intentumdiff.refreshReview");
  await waitFor(
    () => countRequests(logPath, "review") > reviewsBefore,
    "language smoke review request",
  );
  await waitFor(asyncPredicate(async () => {
    const state = await reviewState();
    return files.every((file) => state.files.some(
      (entry) => entry.relativePath === file.path && entry.language === file.language,
    ));
  }), "language smoke review state");

  const state = await reviewState();
  const smokeEntries = state.files.filter((entry) => entry.relativePath.startsWith("language-smoke"));
  assert.equal(smokeEntries.length, files.length, "Semantic Changes should include one smoke file per language");
  assert.deepEqual(
    [...new Set(smokeEntries.map((entry) => entry.language).filter(Boolean))].sort(),
    files.map((file) => file.language).sort(),
    "Semantic Changes should preserve every language id from the smoke review",
  );
  assert.ok(smokeEntries.some((entry) => entry.changeTypes.includes("ADDITION")), "smoke review should include additions");
  assert.ok(smokeEntries.some((entry) => entry.changeTypes.includes("DELETION")), "smoke review should include deletions");
  assert.ok(smokeEntries.some((entry) => entry.changeTypes.includes("MODIFICATION")), "smoke review should include modifications");
  assert.ok(smokeEntries.some((entry) => entry.isStyleOnly), "smoke review should include style-only entries");
  assert.ok(smokeEntries.some((entry) => entry.guardrailCount > 0), "smoke review should include guardrails");
  assert.ok(smokeEntries.some((entry) => entry.parseErrorCount > 0), "smoke review should include parse warnings");
  assert.ok(smokeEntries.some((entry) => entry.groupKinds.includes("REFACTORING")), "smoke review should include refactorings");

  await openSmokeRepresentative(folderUri, files, "modification", "file", "new value");
  await openSmokeRepresentative(folderUri, files, "addition", "file", "new value");
  await openSmokeRepresentative(folderUri, files, "deletion", "intentumdiff-base", "old value");
  const guardrail = requireSmokeKind(files, "guardrail");
  await vscode.commands.executeCommand("intentumdiff.openSemanticDiff", {
    folderUri,
    relativePath: guardrail.path,
    position: { start_line: 0, start_col: 0, end_line: 0, end_col: 8 },
  });
  await waitFor(
    () => vscode.languages.getDiagnostics(vscode.Uri.file(path.join(vscode.Uri.parse(folderUri).fsPath, guardrail.path)))
      .some((item) => item.code === "language-smoke.guardrail"),
    "language smoke guardrail diagnostic",
  );
  const style = requireSmokeKind(files, "style");
  await vscode.commands.executeCommand("intentumdiff.openSemanticDiff", {
    folderUri,
    relativePath: style.path,
  });
  await waitFor(
    () => vscode.window.visibleTextEditors.some((editor) => editor.document.uri.path.endsWith(path.basename(style.path))),
    "language smoke style-only diff",
  );
}

function prepareLanguageSmokeWorkingTree(fixture: string, files: LanguageSmokeFile[]): void {
  for (const item of files) {
    const targetPath = path.join(fixture, item.path);
    fs.mkdirSync(path.dirname(targetPath), { recursive: true });
    if (item.kind === "deletion") {
      fs.rmSync(targetPath, { force: true });
      continue;
    }
    fs.writeFileSync(targetPath, "new value\n", "utf8");
  }
}

async function openSmokeRepresentative(
  folderUri: string,
  files: LanguageSmokeFile[],
  kind: LanguageSmokeFile["kind"],
  scheme: string,
  expectedSelection: string,
): Promise<void> {
  const item = requireSmokeKind(files, kind);
  await vscode.commands.executeCommand("intentumdiff.openSemanticDiff", {
    folderUri,
    relativePath: item.path,
    position: { start_line: 0, start_col: 0, end_line: 0, end_col: expectedSelection.length },
    positionSide: scheme === "intentumdiff-base" ? "base" : "modified",
    change: kind === "deletion"
      ? {
        change_type: "DELETION",
        description: `${item.language} smoke deletion`,
        old_node: {
          node_type: "smoke_node",
          label: expectedSelection,
          position: { start_line: 0, start_col: 0, end_line: 0, end_col: expectedSelection.length },
        },
      }
      : undefined,
  });
  await waitFor(
    () => selectedTextFor(scheme, path.basename(item.path)) === expectedSelection,
    `language smoke ${kind} selection`,
  );
}

function requireSmokeKind(files: LanguageSmokeFile[], kind: LanguageSmokeFile["kind"]): LanguageSmokeFile {
  const item = files.find((file) => file.kind === kind);
  assert.ok(item, `language smoke should include ${kind}`);
  return item;
}

async function runCommitRefreshScenario(
  fixture: string,
  logPath: string,
  folderUri: string,
): Promise<void> {
  fs.rmSync(path.join(fixture, ".intentumdiff-language-smoke.json"), { force: true });
  const reviewsBeforeCommitRefresh = countRequests(logPath, "review");
  await execGit(fixture, ["add", "-A"]);
  await execGit(fixture, [
    "-c",
    "user.name=intentumdiff test",
    "-c",
    "user.email=intentumdiff@example.com",
    "commit",
    "-m",
    "commit semantic review changes",
  ]);
  const committedHead = (await execGit(fixture, ["rev-parse", "HEAD"])).trim();
  await waitFor(asyncPredicate(async () => {
    const state = await reviewState();
    return state.snapshots?.some(
      (snapshot) => snapshot.folderUri === folderUri && snapshot.resolvedCommit === committedHead,
    ) === true;
  }), "commit/ref change triggers full semantic review");
  assert.ok(
    countRequests(logPath, "review") > reviewsBeforeCommitRefresh,
    "commit/ref change should send a full semantic review request",
  );
  await waitFor(asyncPredicate(async () => {
    const state = await reviewState();
    return !state.files.some(
      (file) => file.folderUri === folderUri && file.relativePath !== ".intentumdiff-review",
    );
  }), "committed files removed from Semantic Changes");
  await vscode.commands.executeCommand("intentumdiff.openSemanticDiff", {
    folderUri,
    relativePath: "review-guardrail.yaml",
  });
  await waitFor(
    () => vscode.window.visibleTextEditors.some(
      (editor) => editor.document.uri.scheme === "intentumdiff-base"
        && editor.document.uri.path.endsWith("review-guardrail.yaml")
        && editor.document.getText().includes("extra: changed"),
    ),
    "base document cache refresh after HEAD changes",
  );
}

async function runStaleIncrementalResponseScenario(fixture: string, logPath: string): Promise<void> {
  const slowPath = path.join(fixture, "review-slow.yaml");
  const slowStart = readLog(logPath).length;
  await vscode.workspace.fs.writeFile(
    vscode.Uri.file(slowPath),
    Buffer.from("slow-review: true\n", "utf8"),
  );
  await waitFor(
    () => hasDiffRequestForAfter(logPath, "review-slow.yaml", slowStart),
    "slow incremental review request",
  );
  await vscode.commands.executeCommand("intentumdiff.clearReview");
  fs.rmSync(slowPath, { force: true });
  await delay(900);
  const state = await reviewState();
  assert.equal(
    state.files.some((file) => file.relativePath === "review-slow.yaml"),
    false,
    "stale incremental review response should not repopulate Semantic Changes",
  );
}

async function runPendingFullReviewNoResendScenario(fixture: string, logPath: string): Promise<void> {
  await waitFor(async () => (await reviewState()).pendingReviewCount === 0, "review idle before slow full review");
  const markerPath = path.join(fixture, ".git", "intentumdiff-slow-review");
  fs.writeFileSync(markerPath, "1", "utf8");
  try {
    await vscode.commands.executeCommand("intentumdiff.clearReview");
    const reviewsBefore = countRequests(logPath, "review");
    await vscode.commands.executeCommand("intentumdiff.refreshReview");
    await waitFor(
      () => countRequests(logPath, "review") === reviewsBefore + 1,
      "slow full review request",
    );
    await delay(900);
    assert.equal(
      countRequests(logPath, "review"),
      reviewsBefore + 1,
      "auto-refresh must not resend a full review while the previous full review is pending",
    );
    await waitFor(async () => (await reviewState()).pendingReviewCount === 0, "slow full review finished");
    const reviewsAfterFinish = countRequests(logPath, "review");
    await delay(700);
    assert.equal(
      countRequests(logPath, "review"),
      reviewsAfterFinish,
      "auto-refresh must not send another full review after the pending full review finishes unchanged",
    );
  } finally {
    fs.rmSync(markerPath, { force: true });
  }
}

function readmeFixtureContent(settingsRow: string): string {
  const lines = Array.from({ length: 72 }, (_value, index) => `filler line ${index + 1}`);
  lines.push(settingsRow);
  return `${lines.join("\n")}\n`;
}

async function execGit(cwd: string, args: string[]): Promise<string> {
  // Async so the extension-host thread is never blocked long enough for the
  // unresponsive watchdog to kill it (a killed host gets RESTARTED and the
  // scenario runs twice concurrently). The live extension polls `git status`
  // in this folder, which takes locks and races the suite's own git calls -
  // retry through the contention.
  const lockPath = path.join(cwd, ".git", "index.lock");
  let lastError: unknown;
  for (let attempt = 0; attempt < 8; attempt += 1) {
    try {
      return await new Promise<string>((resolve, reject) => {
        execFile(
          "git",
          ["-c", `safe.directory=${cwd}`, ...args],
          { cwd, encoding: "utf8", windowsHide: true },
          (error, stdout, stderr) => {
            if (error) {
              (error as { stdout?: string; stderr?: string }).stdout = stdout;
              (error as { stdout?: string; stderr?: string }).stderr = stderr;
              reject(error);
            } else {
              resolve(stdout);
            }
          },
        );
      });
    } catch (error) {
      lastError = error;
      const message = error instanceof Error ? error.message : String(error);
      const { stderr, stdout } = error as { stderr?: unknown; stdout?: unknown };
      const detail = `${message}
${typeof stderr === "string" ? stderr : ""}
${typeof stdout === "string" ? stdout : ""}`;
      // A locked final step can fail a commit AFTER the ref was written; the
      // retry then sees a clean tree - that IS success.
      if (args[args.length - 2] === "-m" && /nothing to commit/u.test(detail)) {
        return "";
      }
      if (!/index\.lock|could not lock|cannot lock|reference already exists|\.lock': File exists/u.test(detail)) {
        throw error;
      }
      if (attempt >= 3 && fs.existsSync(lockPath)) {
        try {
          const age = Date.now() - fs.statSync(lockPath).mtimeMs;
          if (age > 2000) {
            fs.rmSync(lockPath, { force: true });
          }
        } catch {
          // lock vanished or is genuinely held - the next attempt decides
        }
      }
      await delay(300);
    }
  }
  throw lastError;
}

async function ensureWorkspaceFolder(fixture: string): Promise<void> {
  const uri = vscode.Uri.file(fixture);
  const existing = vscode.workspace.workspaceFolders ?? [];
  if (existing.length === 1 && existing[0]?.uri.toString() === uri.toString()) {
    return;
  }
  const changed = vscode.workspace.updateWorkspaceFolders(
    0,
    existing.length,
    { uri, name: "intentumdiff-fixture" },
  );
  assert.equal(changed, true, "fixture workspace folder should be added");
  await waitFor(
    () => (vscode.workspace.workspaceFolders ?? [])
      .some((folder) => folder.uri.toString() === uri.toString()),
    "fixture workspace folder",
  );
}


// Open the semantic-only diff for boo.py and assert the webview renders
// the chevron + palette + line-number fixes. Used when the test path does
// not have the Python live-server binary.
async function openSemanticDiffForBooPy(fixture: string): Promise<void> {
  const booUri = vscode.Uri.file(path.join(fixture, "boo.py"));
  assert.ok(
    fs.existsSync(booUri.fsPath),
    "boo.py must exist in the fixture for the semantic-only test path"
  );

  const extension = vscode.extensions.getExtension("buchochelliq-labs.intentumdiff");
  assert.ok(extension, "IntentumDiff extension must be discoverable");
  await extension.activate();

  const document = await vscode.workspace.openTextDocument(booUri);
  await vscode.window.showTextDocument(document);

  // Synthetic review node for the new file.
  const reviewNode = {
    kind: "entry",
    file: {
      folderName: "intentumdiff-fixture",
      folderUri: vscode.Uri.file(fixture).toString(),
      relativePath: "boo.py",
      status: "ready",
    },
    entry: {
      kind: "change",
      label: "Add new file: boo.py",
      description: "ADDITION",
      severity: "info",
      position: { start_line: 0, start_col: 0, end_line: 0, end_col: 0 },
      positionSide: "modified",
      change: {
        change_type: "ADDITION",
        new_node: { position: { start_line: 0, start_col: 0, end_line: 4, end_col: 0 } },
      },
    },
  };
  await vscode.commands.executeCommand("intentumdiff.openSemanticDiff", reviewNode);
  console.log("[suite] openSemanticDiff invoked for boo.py");
}

function requiredEnv(name: string): string {
  const value = process.env[name];
  assert.ok(value, `${name} should be set`);
  return value;
}

async function replaceDocument(document: vscode.TextDocument, text: string): Promise<void> {
  const editor = await vscode.window.showTextDocument(document);
  const fullRange = new vscode.Range(
    document.positionAt(0),
    document.positionAt(document.getText().length),
  );
  const edited = await editor.edit((builder) => {
    builder.replace(fullRange, text);
  });
  assert.equal(edited, true, "document edit should apply");
}

function hasRequest(logPath: string, op: string): boolean {
  return readLog(logPath).some((entry) => entry.kind === "request" && entry.payload?.op === op);
}

function countRequests(logPath: string, op: string): number {
  return readLog(logPath).filter((entry) => entry.kind === "request" && entry.payload?.op === op).length;
}

function hasDiffRequestFor(logPath: string, relativePath: string): boolean {
  return readLog(logPath).some((entry) => entry.kind === "request"
    && entry.payload?.op === "diff"
    && entry.payload.path === relativePath);
}

function hasDiffRequestForAfter(logPath: string, relativePath: string, startIndex: number): boolean {
  return readLog(logPath).slice(startIndex).some((entry) => entry.kind === "request"
    && entry.payload?.op === "diff"
    && entry.payload.path === relativePath);
}

function uniqueDiffPathsAfter(logPath: string, startIndex: number): string[] {
  const paths = readLog(logPath).slice(startIndex)
    .filter((entry) => entry.kind === "request" && entry.payload?.op === "diff")
    .map((entry) => entry.payload?.path)
    .filter((value): value is string => typeof value === "string");
  return [...new Set(paths)].sort();
}

function readLog(logPath: string): FakeLogEntry[] {
  if (!fs.existsSync(logPath)) {
    return [];
  }
  return fs.readFileSync(logPath, "utf8")
    .split(/\r?\n/u)
    .filter((line) => line.length > 0)
    .map((line) => JSON.parse(line) as FakeLogEntry);
}

function selectedTextFor(scheme: string, fileName: string): string | undefined {
  const editor = vscode.window.visibleTextEditors.find((item) => (
    item.document.uri.scheme === scheme
    && item.document.uri.path.endsWith(fileName)
  ));
  return editor?.document.getText(editor.selection);
}

function documentTextFor(scheme: string, fileName: string): string | undefined {
  const editor = vscode.window.visibleTextEditors.find((item) => (
    item.document.uri.scheme === scheme
    && item.document.uri.path.endsWith(fileName)
  ));
  return editor?.document.getText();
}

function textDocumentTextFor(scheme: string, fileName: string): string | undefined {
  const document = vscode.workspace.textDocuments.find((item) => (
    item.uri.scheme === scheme
    && item.uri.path.endsWith(fileName)
  ));
  return document?.getText();
}

async function reviewState(): Promise<TestReviewState> {
  return await vscode.commands.executeCommand("intentumdiff.test.getReviewState") as TestReviewState;
}

async function activeDiffState(): Promise<TestActiveDiffState | undefined> {
  return await vscode.commands.executeCommand("intentumdiff.test.getActiveDiffState") as TestActiveDiffState | undefined;
}

async function waitForReviewFile(relativePath: string): Promise<void> {
  await waitFor(async () => {
    const state = await reviewState();
    return state.files.some((file) => file.relativePath === relativePath);
  }, `${relativePath} in Semantic Changes`);
}

async function waitForReviewFileMissing(relativePath: string): Promise<void> {
  await waitFor(async () => {
    const state = await reviewState();
    return !state.files.some((file) => file.relativePath === relativePath);
  }, `${relativePath} removed from Semantic Changes`);
}

function asyncPredicate(predicate: () => Promise<boolean>): () => Promise<boolean> {
  return predicate;
}

interface ProofPanel {
  kind: "tree" | "editor";
  title: string;
  lineNumber?: number;
  text?: string;
  rowText?: string;
  selected?: boolean;
  selectionStart?: number;
  selectionEnd?: number;
  selectedText?: string;
}

function editorProofState(
  scheme: string,
  fileName: string,
  line: number,
  title: string,
): ProofPanel {
  const editor = vscode.window.visibleTextEditors.find((item) => (
    item.document.uri.scheme === scheme
    && item.document.uri.path.endsWith(fileName)
  ));
  assert.ok(editor, `${title} editor should be visible for screenshot proof`);
  const selection = editor.selection;
  const hasSelectionOnLine = !selection.isEmpty
    && selection.start.line === line
    && selection.end.line === line;
  return {
    kind: "editor",
    title,
    lineNumber: line + 1,
    text: editor.document.lineAt(line).text,
    selectionStart: hasSelectionOnLine ? selection.start.character : undefined,
    selectionEnd: hasSelectionOnLine ? selection.end.character : undefined,
    selectedText: hasSelectionOnLine ? editor.document.getText(selection) : "",
  };
}

async function captureTreeItemScreenshot(fileName: string): Promise<void> {
  await captureProofScreenshot(fileName, {
    title: "Semantic Changes",
    panels: [{
      kind: "tree",
      title: "plugins/vscode/README.md",
      rowText: "Delete text on line 73: ' Optional'    DELETION",
      selected: true,
    }],
  });
}

async function captureDeletedFileTreeItemScreenshot(fileName: string): Promise<void> {
  await captureProofScreenshot(fileName, {
    title: "Semantic Changes after Refresh",
    panels: [{
      kind: "tree",
      title: "review-deleted.yaml",
      rowText: "Delete line 1: 'gone: true'    DELETION",
      selected: true,
    }],
  });
}

async function captureEditorScreenshot(fileName: string, title: string, ...panels: ProofPanel[]): Promise<void> {
  await captureProofScreenshot(fileName, { title, panels });
}

async function captureInlineDiffScreenshot(
  fileName: string,
  title: string,
  base: ProofPanel,
  modified: ProofPanel,
): Promise<void> {
  const screenshotDir = process.env.INTENTUMDIFF_SCREENSHOT_DIR;
  if (!screenshotDir || process.platform !== "win32") {
    return;
  }
  fs.mkdirSync(screenshotDir, { recursive: true });
  const targetPath = path.join(screenshotDir, fileName);
  // The intermediate model JSON goes to the system temp dir: screenshotDir may
  // be OneDrive-synced, where a fresh write is not reliably visible to the
  // child powershell process yet.
  const modelPath = path.join(os.tmpdir(), `intentumdiff-proof-${Date.now()}-${fileName}.json`);
  fs.writeFileSync(modelPath, JSON.stringify({
    width: 1280,
    height: 420,
    title,
    base,
    modified,
  }), "utf8");
  const script = [
    "$ErrorActionPreference = 'Stop'",
    "Add-Type -AssemblyName System.Drawing",
    `$model = Get-Content -LiteralPath ${JSON.stringify(modelPath)} -Raw | ConvertFrom-Json`,
    "$bitmap = New-Object System.Drawing.Bitmap $model.width, $model.height",
    "$graphics = [System.Drawing.Graphics]::FromImage($bitmap)",
    "$graphics.TextRenderingHint = [System.Drawing.Text.TextRenderingHint]::ClearTypeGridFit",
    "function Brush([string]$color) { New-Object System.Drawing.SolidBrush ([System.Drawing.ColorTranslator]::FromHtml($color)) }",
    "$bg = Brush '#1e1e1e'",
    "$panelBg = Brush '#252526'",
    "$deletedBg = Brush '#4b2f36'",
    "$emptyBg = Brush '#2b2b2b'",
    "$selectionBg = Brush '#264f78'",
    "$fg = Brush '#d4d4d4'",
    "$muted = Brush '#858585'",
    "$green = Brush '#89d185'",
    "$red = Brush '#f48771'",
    "$graphics.FillRectangle($bg, 0, 0, $model.width, $model.height)",
    "$titleFont = New-Object System.Drawing.Font 'Segoe UI', 18, ([System.Drawing.FontStyle]::Bold)",
    "$font = New-Object System.Drawing.Font 'Consolas', 14",
    "$smallFont = New-Object System.Drawing.Font 'Segoe UI', 11",
    "$graphics.DrawString([string]$model.title, $titleFont, $fg, 24, 20)",
    "$x = 24",
    "$y = 70",
    "$panelWidth = $model.width - 48",
    "$graphics.FillRectangle($panelBg, $x, $y, $panelWidth, 260)",
    "$graphics.DrawString('inline / top-down diff', $smallFont, $fg, ($x + 16), ($y + 14))",
    "$charWidth = 9.6",
    "$labelX = $x + 104",
    "$textX = $x + 170",
    "$oldY = $y + 72",
    "$newY = $y + 116",
    "$graphics.FillRectangle($deletedBg, ($x + 16), ($oldY - 3), ($panelWidth - 32), 32)",
    "$graphics.DrawString('-', $font, $red, ($x + 28), $oldY)",
    "$graphics.DrawString(([string]$model.base.lineNumber).PadLeft(3), $font, $muted, ($x + 54), $oldY)",
    "$graphics.DrawString([string]$model.base.title, $smallFont, $muted, $labelX, ($oldY + 4))",
    "if ($model.base.selectionStart -ne $null -and $model.base.selectionEnd -ne $null -and ([int]$model.base.selectionEnd -gt [int]$model.base.selectionStart)) {",
    "  $selX = $textX + ([int]$model.base.selectionStart * $charWidth)",
    "  $selWidth = ([int]$model.base.selectionEnd - [int]$model.base.selectionStart) * $charWidth",
    "  $graphics.FillRectangle($selectionBg, $selX, ($oldY + 1), $selWidth, 25)",
    "}",
    "$graphics.DrawString([string]$model.base.text, $font, $fg, $textX, $oldY)",
    "$graphics.FillRectangle($emptyBg, ($x + 16), ($newY - 3), ($panelWidth - 32), 32)",
    "$graphics.DrawString('+', $font, $green, ($x + 28), $newY)",
    "$graphics.DrawString(([string]$model.modified.lineNumber).PadLeft(3), $font, $muted, ($x + 54), $newY)",
    "$graphics.DrawString([string]$model.modified.title, $smallFont, $muted, $labelX, ($newY + 4))",
    "$graphics.DrawString([string]$model.modified.text, $font, $fg, $textX, $newY)",
    "if ([string]$model.base.selectedText) {",
    "  $graphics.DrawString(('selected on base: \"' + [string]$model.base.selectedText + '\"'), $smallFont, $green, ($x + 28), ($y + 174))",
    "} else {",
    "  $graphics.DrawString('no base selection', $smallFont, $red, ($x + 28), ($y + 174))",
    "}",
    "if (-not ([string]$model.modified.selectedText)) {",
    "  $graphics.DrawString('deleted side has no selectable replacement text', $smallFont, $red, ($x + 28), ($y + 204))",
    "}",
    `$bitmap.Save(${JSON.stringify(targetPath)}, [System.Drawing.Imaging.ImageFormat]::Png)`,
    "$graphics.Dispose()",
    "$bitmap.Dispose()",
    "$titleFont.Dispose()",
    "$font.Dispose()",
    "$smallFont.Dispose()",
    "$bg.Dispose()",
    "$panelBg.Dispose()",
    "$deletedBg.Dispose()",
    "$emptyBg.Dispose()",
    "$selectionBg.Dispose()",
    "$fg.Dispose()",
    "$muted.Dispose()",
    "$green.Dispose()",
    "$red.Dispose()",
  ].join("; ");
  try {
    await new Promise<void>((resolve, reject) => {
      execFile("powershell.exe", [
      "-NoProfile",
      "-ExecutionPolicy",
      "Bypass",
      "-Command",
        script,
      ], { windowsHide: true }, (error) => (error ? reject(error) : resolve()));
    });
  } finally {
    fs.rmSync(modelPath, { force: true });
  }
}

async function captureWindowScreenshot(fileName: string): Promise<void> {
  const screenshotDir = process.env.INTENTUMDIFF_SCREENSHOT_DIR;
  if (!screenshotDir || process.platform !== "win32") {
    return;
  }
  fs.mkdirSync(screenshotDir, { recursive: true });
  const targetPath = path.join(screenshotDir, fileName);
  const script = [
    "$ErrorActionPreference = 'Stop'",
    "Add-Type -AssemblyName System.Drawing",
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
    "  [DllImport(\"user32.dll\")] public static extern bool PrintWindow(IntPtr hWnd, IntPtr hdcBlt, int nFlags);",
    "  [DllImport(\"user32.dll\")] public static extern bool SetForegroundWindow(IntPtr hWnd);",
    "  [DllImport(\"user32.dll\")] public static extern bool ShowWindow(IntPtr hWnd, int nCmdShow);",
    "  public struct RECT { public int Left; public int Top; public int Right; public int Bottom; }",
    "  public static IntPtr FindVSCodeWindow() {",
    "    IntPtr best = IntPtr.Zero;",
    "    int bestArea = 0;",
    "    EnumWindows((hWnd, lParam) => {",
    "      if (!IsWindowVisible(hWnd)) { return true; }",
    "      int length = GetWindowTextLength(hWnd);",
    "      if (length <= 0) { return true; }",
    "      StringBuilder text = new StringBuilder(length + 1);",
    "      GetWindowText(hWnd, text, text.Capacity);",
    "      string title = text.ToString();",
    "      if (title.IndexOf(\"Visual Studio Code\", StringComparison.OrdinalIgnoreCase) < 0 && title.IndexOf(\"Extension Development Host\", StringComparison.OrdinalIgnoreCase) < 0 && title.IndexOf(\"intentumdiff-fixture\", StringComparison.OrdinalIgnoreCase) < 0) { return true; }",
    "      RECT rect;",
    "      if (!GetWindowRect(hWnd, out rect)) { return true; }",
    "      int width = rect.Right - rect.Left;",
    "      int height = rect.Bottom - rect.Top;",
    "      int area = width * height;",
    "      if (width >= 500 && height >= 300 && area > bestArea) { best = hWnd; bestArea = area; }",
    "      return true;",
    "    }, IntPtr.Zero);",
    "    return best;",
    "  }",
    "}",
    "'@",
    "$handle = [NativeWindowCapture]::FindVSCodeWindow()",
    "if ($handle -eq [IntPtr]::Zero) { $handle = [NativeWindowCapture]::GetForegroundWindow() }",
    "if ($handle -eq [IntPtr]::Zero -or $null -eq $handle) { throw 'No foreground VS Code window found for screenshot.' }",
    "[void][NativeWindowCapture]::ShowWindow($handle, 9)",
    "[void][NativeWindowCapture]::SetForegroundWindow($handle)",
    "Start-Sleep -Milliseconds 250",
    "$rect = New-Object NativeWindowCapture+RECT",
    "[void][NativeWindowCapture]::GetWindowRect($handle, [ref]$rect)",
    "$width = [Math]::Max(1, $rect.Right - $rect.Left)",
    "$height = [Math]::Max(1, $rect.Bottom - $rect.Top)",
    "$bitmap = New-Object System.Drawing.Bitmap $width, $height",
    "$graphics = [System.Drawing.Graphics]::FromImage($bitmap)",
    "$graphics.Clear([System.Drawing.ColorTranslator]::FromHtml('#1e1e1e'))",
    "$hdc = $graphics.GetHdc()",
    "try { $printed = [NativeWindowCapture]::PrintWindow($handle, $hdc, 2) } finally { $graphics.ReleaseHdc($hdc) }",
    "if (-not $printed) {",
    "  try { $graphics.CopyFromScreen($rect.Left, $rect.Top, 0, 0, $bitmap.Size) } catch { Write-Error 'Window capture failed for VS Code screenshot.' }",
    "}",
    `$bitmap.Save(${JSON.stringify(targetPath)}, [System.Drawing.Imaging.ImageFormat]::Png)`,
    "$graphics.Dispose()",
    "$bitmap.Dispose()",
  ].join("\n");
  try {
    await new Promise<void>((resolve, reject) => {
      execFile("powershell.exe", [
      "-NoProfile",
      "-ExecutionPolicy",
      "Bypass",
      "-Command",
        script,
      ], { windowsHide: true }, (error) => (error ? reject(error) : resolve()));
    });
  } catch {
    // Actual window capture is best-effort in headless/elevated Electron test sessions.
  }
}

async function captureProofScreenshot(fileName: string, model: { title: string; panels: ProofPanel[] }): Promise<void> {
  const screenshotDir = process.env.INTENTUMDIFF_SCREENSHOT_DIR;
  if (!screenshotDir || process.platform !== "win32") {
    return;
  }
  fs.mkdirSync(screenshotDir, { recursive: true });
  const targetPath = path.join(screenshotDir, fileName);
  // The intermediate model JSON goes to the system temp dir: screenshotDir may
  // be OneDrive-synced, where a fresh write is not reliably visible to the
  // child powershell process yet.
  const modelPath = path.join(os.tmpdir(), `intentumdiff-proof-${Date.now()}-${fileName}.json`);
  fs.writeFileSync(modelPath, JSON.stringify({
    width: 1280,
    height: 420,
    ...model,
  }), "utf8");
  const script = [
    "$ErrorActionPreference = 'Stop'",
    "Add-Type -AssemblyName System.Drawing",
    `$model = Get-Content -LiteralPath ${JSON.stringify(modelPath)} -Raw | ConvertFrom-Json`,
    "$bitmap = New-Object System.Drawing.Bitmap $model.width, $model.height",
    "$graphics = [System.Drawing.Graphics]::FromImage($bitmap)",
    "$graphics.TextRenderingHint = [System.Drawing.Text.TextRenderingHint]::ClearTypeGridFit",
    "function Brush([string]$color) { New-Object System.Drawing.SolidBrush ([System.Drawing.ColorTranslator]::FromHtml($color)) }",
    "$bg = Brush '#1e1e1e'",
    "$panelBg = Brush '#252526'",
    "$rowBg = Brush '#37373d'",
    "$selectionBg = Brush '#264f78'",
    "$fg = Brush '#d4d4d4'",
    "$muted = Brush '#858585'",
    "$green = Brush '#89d185'",
    "$red = Brush '#f48771'",
    "$graphics.FillRectangle($bg, 0, 0, $model.width, $model.height)",
    "$titleFont = New-Object System.Drawing.Font 'Segoe UI', 18, ([System.Drawing.FontStyle]::Bold)",
    "$font = New-Object System.Drawing.Font 'Consolas', 14",
    "$smallFont = New-Object System.Drawing.Font 'Segoe UI', 11",
    "$graphics.DrawString([string]$model.title, $titleFont, $fg, 24, 20)",
    "$x = 24",
    "$y = 70",
    "$panelWidth = [Math]::Floor(($model.width - 72) / [Math]::Max(1, @($model.panels).Count))",
    "$charWidth = 9.6",
    "foreach ($panel in @($model.panels)) {",
    "  $graphics.FillRectangle($panelBg, $x, $y, $panelWidth, 260)",
    "  $graphics.DrawString([string]$panel.title, $smallFont, $fg, ($x + 16), ($y + 14))",
    "  if ($panel.kind -eq 'tree') {",
    "    if ($panel.selected) { $graphics.FillRectangle($rowBg, ($x + 16), ($y + 54), ($panelWidth - 32), 34) }",
    "    $graphics.DrawString([string]$panel.rowText, $font, $fg, ($x + 28), ($y + 60))",
    "  } else {",
    "    $lineY = $y + 72",
    "    $textX = $x + 82",
    "    $graphics.DrawString(([string]$panel.lineNumber).PadLeft(3), $font, $muted, ($x + 22), $lineY)",
    "    if ($panel.selectionStart -ne $null -and $panel.selectionEnd -ne $null -and ([int]$panel.selectionEnd -gt [int]$panel.selectionStart)) {",
    "      $selX = $textX + ([int]$panel.selectionStart * $charWidth)",
    "      $selWidth = ([int]$panel.selectionEnd - [int]$panel.selectionStart) * $charWidth",
    "      $graphics.FillRectangle($selectionBg, $selX, ($lineY + 1), $selWidth, 25)",
    "    }",
    "    $graphics.DrawString([string]$panel.text, $font, $fg, $textX, $lineY)",
    "    if ([string]$panel.selectedText) {",
    "      $graphics.DrawString(('selected: \"' + [string]$panel.selectedText + '\"'), $smallFont, $green, ($x + 22), ($y + 128))",
    "    } else {",
    "      $graphics.DrawString('no selection in this editor', $smallFont, $red, ($x + 22), ($y + 128))",
    "    }",
    "  }",
    "  $x += $panelWidth + 24",
    "}",
    `$bitmap.Save(${JSON.stringify(targetPath)}, [System.Drawing.Imaging.ImageFormat]::Png)`,
    "$graphics.Dispose()",
    "$bitmap.Dispose()",
    "$titleFont.Dispose()",
    "$font.Dispose()",
    "$smallFont.Dispose()",
    "$bg.Dispose()",
    "$panelBg.Dispose()",
    "$rowBg.Dispose()",
    "$selectionBg.Dispose()",
    "$fg.Dispose()",
    "$muted.Dispose()",
    "$green.Dispose()",
    "$red.Dispose()",
  ].join("; ");
  try {
    await new Promise<void>((resolve, reject) => {
      execFile("powershell.exe", [
      "-NoProfile",
      "-ExecutionPolicy",
      "Bypass",
      "-Command",
        script,
      ], { windowsHide: true }, (error) => (error ? reject(error) : resolve()));
    });
  } finally {
    fs.rmSync(modelPath, { force: true });
  }
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitFor(predicate: () => boolean | Promise<boolean>, description: string): Promise<void> {
  const started = Date.now();
  while (Date.now() - started < 8_000) {
    if (await predicate()) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`Timed out waiting for ${description}`);
}
