import { execFileSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { downloadAndUnzipVSCode, runTests } from "@vscode/test-electron";

interface Scenario {
  id: string;
  language: string;
  filename: string;
  fixture: { old: string; new: string };
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

async function main(): Promise<void> {
  const extensionDevelopmentPath = path.resolve(__dirname, "../../..");
  const extensionTestsPath = path.resolve(__dirname, "suite.js");
  const repoRoot = path.resolve(extensionDevelopmentPath, "../..");
  const testRoot = path.join(extensionDevelopmentPath, ".vscode-test");
  const fixtureWorkspace = path.join(testRoot, "semanticdiff-comparison-workspace");
  const artifactsDir = path.join(extensionDevelopmentPath, "artifacts", "semanticdiff-comparison");
  const uvCacheDir = path.join(testRoot, "uv-cache");
  const semanticDiffExtensionPath = findSemanticDiffExtension();
  const comparisonExtensionsDir = path.join(testRoot, "semanticdiff-comparison-extensions");
  const userDataDir = path.join(testRoot, "semanticdiff-comparison-user-data");
  const lockDir = path.join(testRoot, "semanticdiff-comparison.lock");

  fs.rmSync(lockDir, { recursive: true, force: true });
  fs.rmSync(userDataDir, { recursive: true, force: true });
  prepareComparisonExtensionsDir(comparisonExtensionsDir, semanticDiffExtensionPath);
  const diffGenerationMs = prepareComparisonWorkspace(repoRoot, fixtureWorkspace, artifactsDir, uvCacheDir);

  const downloadedExecutable = await downloadAndUnzipVSCode({
    version: "stable",
    extensionDevelopmentPath,
  });

  await runTests({
    vscodeExecutablePath: downloadedExecutable,
    extensionDevelopmentPath,
    extensionTestsPath,
    launchArgs: [
      "--disable-workspace-trust",
      "--new-window",
      `--user-data-dir=${userDataDir}`,
      `--extensions-dir=${comparisonExtensionsDir}`,
      fixtureWorkspace,
    ],
    extensionTestsEnv: {
      ELECTRON_RUN_AS_NODE: undefined,
      INTENTUMDIFF_NODE_EXECUTABLE: process.execPath,
      INTENTUMDIFF_REPO_ROOT: repoRoot,
      INTENTUMDIFF_UV_CACHE_DIR: uvCacheDir,
      INTENTUMDIFF_DIFF_GENERATION_MS: String(diffGenerationMs),
      INTENTUMDIFF_SEMANTICDIFF_EXTENSION_PATH: semanticDiffExtensionPath,
      INTENTUMDIFF_SEMANTICDIFF_COMPARISON_WORKSPACE: fixtureWorkspace,
      INTENTUMDIFF_SEMANTICDIFF_COMPARISON_ARTIFACTS: artifactsDir,
      INTENTUMDIFF_VSCODE_LOG: path.join(fixtureWorkspace, ".intentumdiff-comparison-log.jsonl"),
    },
  });
}

function prepareComparisonWorkspace(
  repoRoot: string,
  workspaceRoot: string,
  artifactsDir: string,
  uvCacheDir: string,
): number {
  const scenarios = readScenarios(repoRoot);
  fs.rmSync(workspaceRoot, { recursive: true, force: true });
  fs.rmSync(artifactsDir, { recursive: true, force: true });
  fs.mkdirSync(workspaceRoot, { recursive: true });
  fs.mkdirSync(artifactsDir, { recursive: true });
  fs.writeFileSync(
    path.join(workspaceRoot, ".gitignore"),
    ".semanticdiff-old/\n.intentumdiff-comparison-commit-diff.json\n.intentumdiff-comparison-input.json\n.intentumdiff-comparison-log.jsonl\nlive-server\n",
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
    "user.name=intentumdiff comparison",
    "-c",
    "user.email=intentumdiff-comparison@example.com",
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
  const diffGenerationMs = generatePysdCommitDiff(repoRoot, workspaceRoot, scenarios, uvCacheDir);
  writeLiveServer(workspaceRoot);
  return diffGenerationMs;
}

function readScenarios(repoRoot: string): Scenario[] {
  const fixturePath = path.join(
    repoRoot,
    "tests",
    "fixtures",
    "semanticdiff_competitive_scenarios.json",
  );
  const data = JSON.parse(fs.readFileSync(fixturePath, "utf8")) as { scenarios: Scenario[] };
  return data.scenarios.filter((scenario) => COMPARISON_IDS.includes(scenario.id));
}

function generatePysdCommitDiff(
  repoRoot: string,
  workspaceRoot: string,
  scenarios: Scenario[],
  uvCacheDir: string,
): number {
  const inputPath = path.join(workspaceRoot, ".intentumdiff-comparison-input.json");
  const outputPath = path.join(workspaceRoot, ".intentumdiff-comparison-commit-diff.json");
  fs.writeFileSync(
    inputPath,
    JSON.stringify({
      scenarios: scenarios.map((scenario) => ({
        id: scenario.id,
        language: scenario.language,
        relative_path: relativePathFor(scenario),
        old: scenario.fixture.old,
        new: scenario.fixture.new,
      })),
    }),
    "utf8",
  );
  const script = [
    "import json, sys",
    "from intentumdiff import SemanticDiffer",
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
      INTENTUMDIFF_ALLOW_VULNERABLE_WASMTIME: "1",
      UV_CACHE_DIR: uvCacheDir,
    },
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true,
  });
  return Date.now() - started;
}

function writeLiveServer(workspaceRoot: string): void {
  fs.writeFileSync(path.join(workspaceRoot, "live-server"), LIVE_SERVER, "utf8");
}

function relativePathFor(scenario: Scenario): string {
  return path.posix.join("cases", scenario.id, scenario.filename);
}

function oldSnapshotPath(workspaceRoot: string, scenario: Scenario): string {
  return path.join(workspaceRoot, ".semanticdiff-old", scenario.id, scenario.filename);
}

function execGit(cwd: string, args: string[]): string {
  return execFileSync("git", ["-c", `safe.directory=${cwd}`, ...args], {
    cwd,
    encoding: "utf8",
    stdio: "pipe",
    windowsHide: true,
  });
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
  return JSON.parse(fs.readFileSync(".intentumdiff-comparison-commit-diff.json", "utf8"));
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

function findSemanticDiffExtension(): string {
  const extensionRoot = path.join(os.homedir(), ".vscode", "extensions");
  if (!fs.existsSync(extensionRoot)) {
    throw new Error(`SemanticDiff comparison requires VS Code extensions at ${extensionRoot}`);
  }
  const candidates = fs.readdirSync(extensionRoot)
    .filter((name) => name.startsWith("semanticdiff.semanticdiff-"))
    .map((name) => path.join(extensionRoot, name))
    .filter((candidate) => fs.existsSync(path.join(candidate, "package.json")));
  if (candidates.length === 0) {
    throw new Error(
      "SemanticDiff comparison requires the installed semanticdiff.semanticdiff extension.",
    );
  }
  candidates.sort((left, right) => {
    const leftVersion = readVersion(left);
    const rightVersion = readVersion(right);
    return leftVersion.localeCompare(rightVersion, undefined, { numeric: true });
  });
  return candidates[candidates.length - 1];
}

function readVersion(extensionPath: string): string {
  try {
    const data = JSON.parse(
      fs.readFileSync(path.join(extensionPath, "package.json"), "utf8"),
    ) as { version?: string };
    return data.version ?? "0.0.0";
  } catch {
    return "0.0.0";
  }
}

function prepareComparisonExtensionsDir(targetRoot: string, semanticDiffExtensionPath: string): void {
  const target = path.join(targetRoot, path.basename(semanticDiffExtensionPath));
  fs.rmSync(targetRoot, { recursive: true, force: true });
  fs.mkdirSync(targetRoot, { recursive: true });
  fs.cpSync(semanticDiffExtensionPath, target, { recursive: true });
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
