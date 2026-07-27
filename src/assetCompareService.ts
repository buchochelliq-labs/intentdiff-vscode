// On-demand perceptual asset compares (`intentdiff assets git`), extracted from
// PysdController (issue #79 stage 2). Owns the resolved-compare cache keyed by
// folder + ref + resolved commit, so image panels render the compared viewer
// synchronously once ready; the inflight set dedupes background runs.
import * as path from "path";
import { execFile } from "child_process";
import * as vscode from "vscode";
import { buildLiveServerEnv } from "./config";
import type { ReviewFile } from "./reviewModel";
import type { LiveServerSettings } from "./types";

export interface AssetCompareHost {
  readonly output: vscode.OutputChannel;
  /** The review snapshot's resolved commit for the folder (cache-key input). */
  resolvedCommitFor(folderUri: vscode.Uri): string | undefined;
  settingsForFolder(folder: vscode.WorkspaceFolder): LiveServerSettings;
  /** Called after a background compare lands so the open panel re-renders. */
  onCompareReady(): Promise<void>;
}

export class AssetCompareService {
  private readonly cache = new Map<string, Array<Record<string, unknown>>>();
  private readonly inflight = new Set<string>();

  constructor(private readonly host: AssetCompareHost) {}

  /** Invalidate cached compares (edited images must recompare). */
  clear(): void {
    this.cache.clear();
  }

  private cacheKey(folderUri: vscode.Uri, ref: string): string {
    const commit = this.host.resolvedCommitFor(folderUri) ?? "";
    return `${folderUri.toString()}::${ref}::${commit}`;
  }

  /**
   * Synchronously upgrade an image review file to the real `compared` perceptual
   * diff (before/after/heatmap/hotspots) when the compare is ready in the cache.
   * Otherwise kick off the compare in the BACKGROUND (non-blocking, so the panel
   * shows the preview instantly) and return the file unchanged; the background
   * run refreshes the panel to the compared viewer when it finishes.
   */
  comparedFileOrPreview(
    folderUri: vscode.Uri,
    relativePath: string,
    ref: string,
    file: ReviewFile,
  ): ReviewFile {
    const existing = file.diff?.metadata?.asset_diff as { status?: string } | undefined;
    if (existing?.status === "compared") {
      return file;
    }
    const diffs = this.cache.get(this.cacheKey(folderUri, ref));
    if (!diffs) {
      void this.computeInBackground(folderUri, ref);
      return file;
    }
    const entry = diffs.find((item) => {
      const value = item.file_path ?? item.new_filename ?? item.old_filename;
      return typeof value === "string" && value.replace(/\\/gu, "/") === relativePath;
    });
    if (!entry || entry.status !== "compared" || !file.diff) {
      return file;
    }
    const metadata = { ...(file.diff.metadata ?? {}), asset_diff: entry };
    return { ...file, diff: { ...file.diff, metadata } };
  }

  /** Run `assets git` off the UI path, cache it, then refresh the panel to compared. */
  private async computeInBackground(folderUri: vscode.Uri, ref: string): Promise<void> {
    const cacheKey = this.cacheKey(folderUri, ref);
    if (this.cache.has(cacheKey) || this.inflight.has(cacheKey)) {
      return;
    }
    const folder = vscode.workspace.getWorkspaceFolder(folderUri);
    if (!folder) {
      return;
    }
    this.inflight.add(cacheKey);
    try {
      this.cache.set(cacheKey, await this.runAssetsCompare(folder, ref));
    } finally {
      this.inflight.delete(cacheKey);
    }
    await this.host.onCompareReady();
  }

  /** Spawn `intentdiff assets git` and parse its asset_diffs (empty on any failure). */
  private runAssetsCompare(
    folder: vscode.WorkspaceFolder,
    ref: string,
  ): Promise<Array<Record<string, unknown>>> {
    const settings = this.host.settingsForFolder(folder);
    const outDir = path.join(folder.uri.fsPath, ".intentdiff", "assets");
    const args = ["assets", "git", "--repo", folder.uri.fsPath, "--base", ref, "--out", outDir, "--json"];
    return new Promise<Array<Record<string, unknown>>>((resolve) => {
      execFile(
        settings.executable,
        args,
        {
          cwd: folder.uri.fsPath,
          maxBuffer: 64 * 1024 * 1024,
          // Merge with process.env — buildLiveServerEnv only adds INTENTDIFF_*
          // vars, so passing it alone would drop PATH/SystemRoot and the
          // executable (a Python console script) could not find its runtime.
          env: { ...process.env, ...buildLiveServerEnv(settings), PYTHONUTF8: "1", PYTHONIOENCODING: "utf-8" },
          windowsHide: true,
        },
        (error, stdout) => {
          if (error) {
            this.host.output.appendLine(`assets git failed: ${error.message}`);
            resolve([]);
            return;
          }
          try {
            const parsed = JSON.parse(stdout) as { asset_diffs?: unknown };
            resolve(Array.isArray(parsed.asset_diffs) ? (parsed.asset_diffs as Array<Record<string, unknown>>) : []);
          } catch {
            resolve([]);
          }
        },
      );
    });
  }
}
