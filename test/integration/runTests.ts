import { execFileSync } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";
import { downloadAndUnzipVSCode, runTests } from "@vscode/test-electron";

async function main(): Promise<void> {
  const extensionDevelopmentPath = path.resolve(__dirname, "../../..");
  const extensionTestsPath = path.resolve(__dirname, "suite.js");
  const repoRoot = path.resolve(extensionDevelopmentPath, "../..");
  const uvCacheDir = path.join(extensionDevelopmentPath, ".vscode-test", "uv-cache");
  const supportedLanguages = readSupportedLanguages(repoRoot, uvCacheDir);
  // Allow relocating the mutable fixture outside OneDrive-synced paths, where
  // sync locks cause EPERM during the suite's rmSync/mkdir fixture setup. Set
  // INTENTDIFF_FIXTURE_DIR to a non-synced directory (the suite git-inits and
  // populates it from scratch).
  const fixtureWorkspace = process.env.INTENTDIFF_FIXTURE_DIR
    ? path.resolve(process.env.INTENTDIFF_FIXTURE_DIR)
    : path.join(
        extensionDevelopmentPath,
        "test",
        "fixtures",
        "workspace",
      );
  const downloadedExecutable = await downloadAndUnzipVSCode({
    version: "stable",
    extensionDevelopmentPath,
  });

  // The downloaded test VS Code uses the same singleton mutex name as the
  // user's running editor, which makes downloadAndUnzipVSCode fail with
  // "Error: Error mutex already exists". Patch product.json to use a unique
  // productName so the test VS Code acquires a separate mutex.
  const productJsonPath = path.join(
    path.dirname(downloadedExecutable),
    "resources",
    "app",
    "product.json",
  );
  if (fs.existsSync(productJsonPath)) {
    try {
      const product = JSON.parse(fs.readFileSync(productJsonPath, "utf8"));
      const orig = product.nameShort || product.name || "Code";
      product.nameShort = "IntentDiffTestVSCode";
      product.name = "IntentDiffTestVSCode";
      product.applicationName = "intentdiff-test-vscode";
      // productQuality is read by the app for the singleton mutex seed.
      product.quality = "intentdiff-test-" + Date.now();
      fs.writeFileSync(productJsonPath, JSON.stringify(product, null, "	"), "utf8");
      console.log("[runTests] patched product.json: " + orig + " -> IntentDiffTestVSCode");
    } catch (e) {
      console.warn("[runTests] could not patch product.json: " + e);
    }
  }

  await runTests({
    vscodeExecutablePath: downloadedExecutable,
    extensionDevelopmentPath,
    extensionTestsPath,
    launchArgs: [
      "--disable-workspace-trust",
      "--disable-extensions",
      // Open the fixture folder as the initial workspace so
      // ensureWorkspaceFolder() in suite.ts succeeds. Without this the
      // extension host starts in empty-workspace mode and updateWorkspaceFolders
      // is a no-op, causing the test to time out. The folder must exist BEFORE
      // launch — VS Code silently drops a nonexistent workspace path (the
      // INTENTDIFF_FIXTURE_DIR relocation starts from nothing).
      (fs.mkdirSync(fixtureWorkspace, { recursive: true }), fixtureWorkspace),
    ],
    extensionTestsEnv: {
      ELECTRON_RUN_AS_NODE: undefined,
      INTENTDIFF_NODE_EXECUTABLE: process.execPath,
      INTENTDIFF_REPO_ROOT: repoRoot,
      INTENTDIFF_SUPPORTED_LANGUAGES: JSON.stringify(supportedLanguages),
      INTENTDIFF_UV_CACHE_DIR: uvCacheDir,
      INTENTDIFF_VSCODE_FIXTURE: fixtureWorkspace,
      INTENTDIFF_VSCODE_LOG: path.join(fixtureWorkspace, ".intentdiff-fake-log.jsonl"),
      INTENTDIFF_SCREENSHOT_DIR: path.join(extensionDevelopmentPath, "artifacts"),
    },
  });
}

function readSupportedLanguages(repoRoot: string, uvCacheDir: string): string[] {
  const script = "from intentdiff import SemanticDiffer; print(chr(10).join(SemanticDiffer().supported_languages()))";
  try {
    const output = execFileSync("uv", ["run", "--no-sync", "python", "-c", script], {
      cwd: repoRoot,
      encoding: "utf8",
      env: {
        ...process.env,
        INTENTDIFF_ALLOW_VULNERABLE_WASMTIME: "1",
        UV_CACHE_DIR: uvCacheDir,
      },
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
    });
    const languages = parseLanguageLines(output);
    if (languages.length > 0) {
      return languages;
    }
  } catch {
    // Fall back to checked-in parser metadata when sandboxed test runners cannot import Python.
  }
  return readParserEntryPointLanguages(repoRoot);
}

function readParserEntryPointLanguages(repoRoot: string): string[] {
  const pyproject = fs.readFileSync(path.join(repoRoot, "pyproject.toml"), "utf8");
  const section = pyproject.match(/\[project\.entry-points\."intentdiff\.parsers"\]\r?\n(?<body>[\s\S]*?)(?:\r?\n\[|$)/u);
  const languages = new Set(section?.groups?.body
    .split(/\r?\n/u)
    .map((line) => line.match(/^\s*([a-z0-9-]+)\s*=/iu)?.[1])
    .filter((language): language is string => Boolean(language)) ?? []);
  for (const alias of ["databricks", "wast"]) {
    languages.add(alias);
  }
  if (languages.size === 0) {
    throw new Error("runtime supported language list should not be empty");
  }
  return [...languages].sort();
}

function parseLanguageLines(output: string): string[] {
  return output.split(/\r?\n/u)
    .map((line) => line.trim())
    .filter((line) => /^[a-z0-9-]+$/u.test(line));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
