/**
 * Focused integration test for the IntentumDiff Monaco diff webview.
 *
 * Opens the semantic diff for boo.py and verifies the webview renders with
 * the chevron + palette + line-number fixes. Bypasses the live-server pipeline.
 */
import * as path from "node:path";
import { downloadAndUnzipVSCode, runTests } from "@vscode/test-electron";

export async function run(): Promise<void> {
  const extensionDevelopmentPath = path.resolve(__dirname, "../..");
  const extensionTestsPath = path.resolve(__dirname, "semanticDiffWebviewSuite.js");
  const fixtureWorkspace = process.env.INTENTUMDIFF_FIXTURE_DIR
    ? path.resolve(process.env.INTENTUMDIFF_FIXTURE_DIR)
    : path.join(extensionDevelopmentPath, "test", "fixtures", "workspace");

  const downloadedExecutable = await downloadAndUnzipVSCode({
    version: "stable",
    extensionDevelopmentPath,
  });

  console.log("[semanticDiffWebview] running in: " + downloadedExecutable);
  console.log("[semanticDiffWebview] fixture:    " + fixtureWorkspace);

  await runTests({
    vscodeExecutablePath: downloadedExecutable,
    extensionDevelopmentPath,
    extensionTestsPath,
    launchArgs: [
      "--disable-workspace-trust",
      fixtureWorkspace,
      "--no-exit",
    ],
    extensionTestsEnv: {
      INTENTUMDIFF_NODE_EXECUTABLE: process.execPath,
      INTENTUMDIFF_FIXTURE_DIR: fixtureWorkspace,
    },
  });
}
