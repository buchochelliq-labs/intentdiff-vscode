// Review telemetry history + the diagnostics report surface, extracted from
// PysdController (issue #79 stage 2). Owns the workspaceState-persisted fuel
// history and review-timeline snapshots, and builds/opens/exports the
// diagnostics report they feed.
import * as path from "path";
import { writeFile } from "fs/promises";
import * as vscode from "vscode";
import {
  createDiagnosticsNonce,
  diagnosticsReportMarkdown,
  emptyFuelSummary,
  fuelSummaryForDiff,
  parserCallsForDiff,
  renderDiagnosticsReportHtml,
  uniqueStrings,
  type DiagnosticsReport,
  type FuelSummary,
} from "./diagnosticsReport";
import { reviewKey } from "./reviewAssetDiffs";
import type { ReviewFile } from "./reviewModel";
import {
  appendReviewTimelineSnapshot,
  createReviewTimelineSnapshot,
  type ReviewTimelineSnapshot,
} from "./reviewTimelineModel";
import type { ReviewFuelHistory, ReviewFuelPolicy } from "./reviewWebviewModel";
import type { SemanticDiff } from "./types";

export interface ReviewTelemetryHost {
  readonly output: vscode.OutputChannel;
  readonly workspaceState: vscode.Memento;
  reviewFiles(): ReviewFile[];
  fuelPolicy(): ReviewFuelPolicy;
  /** Pushes restored/updated snapshots into the Timeline view provider. */
  setTimelineSnapshots(snapshots: ReviewTimelineSnapshot[]): void;
}

function isReviewTimelineSnapshot(value: unknown): value is ReviewTimelineSnapshot {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }
  const snapshot = value as Partial<ReviewTimelineSnapshot>;
  return typeof snapshot.id === "string"
    && typeof snapshot.timestamp === "number"
    && Number.isFinite(snapshot.timestamp)
    && typeof snapshot.folderName === "string"
    && typeof snapshot.folderUri === "string"
    && typeof snapshot.fileCount === "number"
    && typeof snapshot.semanticChangeCount === "number"
    && typeof snapshot.errorCount === "number"
    && typeof snapshot.fuelHotspotCount === "number";
}

export class ReviewTelemetryService {
  private timelineSnapshots: ReviewTimelineSnapshot[] = [];
  private readonly fuelHistory = new Map<string, number[]>();

  constructor(private readonly host: ReviewTelemetryHost) {}

  /** Restore both persisted histories (called once at activation). */
  restore(): void {
    this.restoreTimelineSnapshots();
    this.restoreFuelHistory();
  }

  timeline(): readonly ReviewTimelineSnapshot[] {
    return this.timelineSnapshots;
  }

  fuelHistorySnapshot(): ReviewFuelHistory {
    return Object.fromEntries(
      [...this.fuelHistory.entries()].map(([key, values]) => [key, [...values]]),
    );
  }

  fuelHistoryFor(folderUri: string, relativePath: string): number[] {
    return this.fuelHistory.get(reviewKey(folderUri, relativePath)) ?? [];
  }

  clearFuelHistory(): void {
    this.fuelHistory.clear();
  }

  private restoreTimelineSnapshots(): void {
    const saved = this.host.workspaceState.get<unknown>("intentdiff.reviewTimelineSnapshots", []);
    if (!Array.isArray(saved)) {
      return;
    }
    this.timelineSnapshots = saved
      .filter(isReviewTimelineSnapshot)
      .slice(-20);
    this.host.setTimelineSnapshots(this.timelineSnapshots);
  }

  private persistTimelineSnapshots(): void {
    void this.host.workspaceState.update("intentdiff.reviewTimelineSnapshots", this.timelineSnapshots);
    this.host.setTimelineSnapshots(this.timelineSnapshots);
  }

  recordTimelineSnapshot(): void {
    const snapshot = createReviewTimelineSnapshot(this.host.reviewFiles());
    const next = appendReviewTimelineSnapshot(this.timelineSnapshots, snapshot);
    if (next.length === this.timelineSnapshots.length
      && next.every((item, index) => item.id === this.timelineSnapshots[index]?.id)) {
      return;
    }
    this.timelineSnapshots = next;
    this.persistTimelineSnapshots();
  }

  private restoreFuelHistory(): void {
    const saved = this.host.workspaceState.get<ReviewFuelHistory>("intentdiff.reviewFuelHistory", {});
    if (!saved || typeof saved !== "object" || Array.isArray(saved)) {
      return;
    }
    for (const [key, values] of Object.entries(saved)) {
      if (!Array.isArray(values)) {
        continue;
      }
      const cleanValues = values
        .filter((value): value is number => typeof value === "number" && Number.isFinite(value) && value >= 0)
        .slice(-12);
      if (cleanValues.length > 0) {
        this.fuelHistory.set(key, cleanValues);
      }
    }
  }

  private persistFuelHistory(): void {
    void this.host.workspaceState.update("intentdiff.reviewFuelHistory", this.fuelHistorySnapshot());
  }

  recordFuelTelemetry(folderUri: string, relativePath: string, diff: SemanticDiff | undefined): void {
    const summary = fuelSummaryForDiff(diff, this.host.fuelPolicy());
    if (summary.callCount === 0 && summary.hotspotCount === 0 && summary.parseErrorCount === 0 && !summary.fallback) {
      return;
    }
    const key = reviewKey(folderUri, relativePath);
    const history = [...(this.fuelHistory.get(key) ?? []), summary.peakFuel].slice(-12);
    this.fuelHistory.set(key, history);
    this.persistFuelHistory();
    this.host.output.appendLine(JSON.stringify({
      fuelTelemetry: {
        file: relativePath,
        peakFuel: summary.peakFuel,
        totalFuel: summary.totalFuel,
        calls: summary.callCount,
        hotspots: summary.hotspotCount,
        parseErrors: summary.parseErrorCount,
        fallback: summary.fallback,
        policyExceeded: summary.policyExceeded,
        policyReasons: summary.policyReasons,
        samples: history.length,
      },
    }, null, 2));
  }

  buildDiagnosticsReport(): DiagnosticsReport {
    const files = this.host.reviewFiles()
      .filter((file) => file.status === "ready" && file.diff)
      .map((file) => {
        const summary = fuelSummaryForDiff(file.diff, this.host.fuelPolicy());
        return {
          folderName: file.folderName,
          folderUri: file.folderUri,
          relativePath: file.relativePath,
          language: file.diff?.language ?? "unknown",
          summary,
          history: this.fuelHistoryFor(file.folderUri, file.relativePath),
          parserCalls: parserCallsForDiff(file.diff),
        };
      })
      .sort((a, b) => (
        b.summary.hotspotCount - a.summary.hotspotCount
        || b.summary.peakFuel - a.summary.peakFuel
        || b.summary.totalFuel - a.summary.totalFuel
        || a.relativePath.localeCompare(b.relativePath)
      ));
    return {
      generatedAt: new Date().toISOString(),
      policy: this.host.fuelPolicy(),
      files,
      aggregate: files.reduce<FuelSummary>((total, file) => ({
        callCount: total.callCount + file.summary.callCount,
        hotspotCount: total.hotspotCount + file.summary.hotspotCount,
        peakFuel: Math.max(total.peakFuel, file.summary.peakFuel),
        totalFuel: total.totalFuel + file.summary.totalFuel,
        parseErrorCount: total.parseErrorCount + file.summary.parseErrorCount,
        fallback: total.fallback || file.summary.fallback,
        policyExceeded: total.policyExceeded || file.summary.policyExceeded,
        policyReasons: uniqueStrings([...total.policyReasons, ...file.summary.policyReasons]),
      }), emptyFuelSummary()),
    };
  }

  openDiagnosticsReport(): void {
    const report = this.buildDiagnosticsReport();
    const panel = vscode.window.createWebviewPanel(
      "intentdiff.diagnostics",
      "IntentDiff Diagnostics",
      vscode.ViewColumn.Active,
      { enableScripts: false, retainContextWhenHidden: true },
    );
    panel.webview.html = renderDiagnosticsReportHtml(report, {
      nonce: createDiagnosticsNonce(),
      cspSource: panel.webview.cspSource,
    });
  }

  async exportDiagnosticsReport(): Promise<void> {
    const selected = await vscode.window.showQuickPick([
      { label: "JSON", description: "Machine-readable diagnostics report", extension: "json" },
      { label: "Markdown", description: "Human-readable diagnostics summary", extension: "md" },
    ], {
      title: "Export IntentDiff diagnostics",
      placeHolder: "Choose report format",
    });
    if (!selected) {
      return;
    }
    const uri = await vscode.window.showSaveDialog({
      defaultUri: vscode.Uri.file(path.join(
        vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? process.cwd(),
        `intentdiff-diagnostics.${selected.extension}`,
      )),
      filters: selected.extension === "json"
        ? { "JSON": ["json"] }
        : { "Markdown": ["md"] },
    });
    if (!uri) {
      return;
    }
    const report = this.buildDiagnosticsReport();
    const content = selected.extension === "json"
      ? `${JSON.stringify(report, null, 2)}\n`
      : diagnosticsReportMarkdown(report);
    await writeFile(uri.fsPath, content, "utf8");
    void vscode.window.showInformationMessage(`IntentDiff diagnostics exported to ${uri.fsPath}`);
  }
}
