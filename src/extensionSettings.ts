// Stateless configuration readers for the extension controller, extracted from
// PysdController (issue #79 stage 2). Every function reads live from
// vscode.workspace configuration; controller UI state (hideComments) is passed
// in explicitly where a reader needs it.
import * as path from "path";
import { existsSync } from "fs";
import * as vscode from "vscode";
import {
  normalizeLiveServerEngine,
  readTrustedExecutable,
  readTrustedSchemaAllowPrivateHosts,
  readTrustedSchemaFetchMode,
  readTrustedValue,
  type LiveServerEngine,
} from "./config";
import { nonNegativeNumber, readFuelSetting } from "./extensionEditorUtils";
import { normalizeReviewFileGroupingMode, type ReviewFileGroupingMode } from "./reviewModel";
import type { ReviewDiffSurface } from "./reviewTree";
import { DEFAULT_REVIEW_FUEL_POLICY, type ReviewFuelPolicy } from "./reviewWebviewModel";
import type { SemanticOnlyOptions } from "./semanticOnlyDiff";
import type { LiveServerSettings } from "./types";

export type NativeDiffMode = "full" | "semanticOnly";

export function readLiveServerSettings(): LiveServerSettings {
  const config = vscode.workspace.getConfiguration("intentdiff");
  return {
    executable: readTrustedExecutable(config),
    ref: config.get("ref", "HEAD"),
    enabled: config.get("enabled", true),
    debounceMs: config.get("debounceMs", 250),
    fuel: readFuelSetting(config),
    trace: config.get("trace", false),
    schemaFetchMode: readTrustedSchemaFetchMode(config),
    schemaCacheTtlHours: Math.max(0, config.get("schemas.cacheTtlHours", 24)),
    schemaAllowPrivateHosts: readTrustedSchemaAllowPrivateHosts(config),
  };
}

export function settingsForFolder(folder: vscode.WorkspaceFolder): LiveServerSettings {
  const settings = readLiveServerSettings();
  return {
    ...settings,
    executable: resolveExecutableForFolder(settings.executable, folder),
  };
}

export function resolveExecutableForFolder(executable: string, folder: vscode.WorkspaceFolder): string {
  if (path.isAbsolute(executable) || executable !== "intentdiff" || !vscode.workspace.isTrusted) {
    return executable;
  }
  return workspaceVenvIntentDiffCandidates(folder).find((candidate) => existsSync(candidate)) ?? executable;
}

export function workspaceVenvIntentDiffCandidates(folder: vscode.WorkspaceFolder): string[] {
  return [
    path.join(folder.uri.fsPath, ".venv", "Scripts", "intentdiff.exe"),
    path.join(folder.uri.fsPath, ".venv", "bin", "intentdiff"),
  ];
}

/** The trusted engine choice for the live server (global config only, like the executable —
 *  it decides WHAT gets spawned). */
export function readLiveServerEngine(): LiveServerEngine {
  const config = vscode.workspace.getConfiguration("intentdiff");
  return normalizeLiveServerEngine(readTrustedValue<string>(config, "liveServer.engine", "auto"));
}

/** The RAW trusted executable setting, before the workspace-venv mapping — "intentdiff" means
 *  the user did NOT override it (so the bundled native engine may be chosen). */
export function readLiveServerRawExecutable(): string {
  return readTrustedExecutable(vscode.workspace.getConfiguration("intentdiff"));
}

export function readReviewMaxAutoRetries(): number {
  const config = vscode.workspace.getConfiguration("intentdiff");
  const raw = config.get("review.maxAutoRetries", 2);
  return Number.isFinite(raw) ? Math.max(0, Math.round(raw as number)) : 2;
}

export function readDiffMode(): NativeDiffMode {
  return vscode.workspace.getConfiguration("intentdiff").get<string>("diff.defaultMode", "full") === "semanticOnly"
    ? "semanticOnly"
    : "full";
}

export function readReviewGroupingMode(): ReviewFileGroupingMode {
  return normalizeReviewFileGroupingMode(
    vscode.workspace.getConfiguration("intentdiff").get("review.groupFilesBy", "auto"),
  );
}

export function readReviewDiffSurface(): ReviewDiffSurface {
  return vscode.workspace.getConfiguration("intentdiff").get<string>("review.diffSurface", "native") === "panel"
    ? "panel"
    : "native";
}

export function readFuelPolicy(): ReviewFuelPolicy {
  const config = vscode.workspace.getConfiguration("intentdiff");
  return {
    peakFuelWarning: nonNegativeNumber(
      config.get("diagnostics.fuelPeakWarning", DEFAULT_REVIEW_FUEL_POLICY.peakFuelWarning),
      DEFAULT_REVIEW_FUEL_POLICY.peakFuelWarning,
    ),
    fuelPerKbWarning: nonNegativeNumber(
      config.get("diagnostics.fuelPerKbWarning", DEFAULT_REVIEW_FUEL_POLICY.fuelPerKbWarning),
      DEFAULT_REVIEW_FUEL_POLICY.fuelPerKbWarning,
    ),
    fuelPerLineWarning: nonNegativeNumber(
      config.get("diagnostics.fuelPerLineWarning", DEFAULT_REVIEW_FUEL_POLICY.fuelPerLineWarning),
      DEFAULT_REVIEW_FUEL_POLICY.fuelPerLineWarning,
    ),
  };
}

export function readSemanticOnlyOptions(hideComments: boolean): SemanticOnlyOptions {
  const config = vscode.workspace.getConfiguration("intentdiff");
  return {
    contextLines: Math.max(0, config.get("diff.contextLines", 3)),
    showAdditions: config.get("visualization.showAdditions", true),
    showDeletions: config.get("visualization.showDeletions", true),
    showModifications: config.get("visualization.showModifications", true),
    movedCode: config.get("visualization.movedCode", true),
    hideComments,
  };
}

export function readReviewDiffContextLines(): number {
  const value = vscode.workspace.getConfiguration("intentdiff").get<number>("review.diffContextLines", 1);
  return Number.isFinite(value) ? Math.max(0, Math.floor(value)) : 1;
}

export function fallbackDiffEnabled(): boolean {
  return vscode.workspace.getConfiguration("intentdiff").get("diff.fallbackDiff", true);
}
