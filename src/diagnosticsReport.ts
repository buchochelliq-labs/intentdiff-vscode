// Fuel/diagnostics report model plus its webview HTML and markdown renderers.
import type { ReviewFuelPolicy } from "./reviewWebviewModel";
import type { SemanticDiff } from "./types";

export interface FuelSummary {
  callCount: number;
  hotspotCount: number;
  peakFuel: number;
  totalFuel: number;
  parseErrorCount: number;
  fallback: boolean;
  policyExceeded: boolean;
  policyReasons: string[];
}

export interface DiagnosticsParserCall {
  plugin: string;
  func: string;
  language: string;
  filename: string;
  provenance: string;
  engine: string;
  version: string;
  trusted: boolean;
  status: string;
  fuelConsumed: number;
  totalFuelConsumed: number;
  fuelBudget?: number;
  fuelUsedPercent?: number;
  fuelPerKb?: number;
  fuelPerLine?: number;
  inputBytes?: number;
  inputLines?: number;
}

export interface DiagnosticsReportFile {
  folderName: string;
  folderUri: string;
  relativePath: string;
  language: string;
  summary: FuelSummary;
  history: number[];
  parserCalls: DiagnosticsParserCall[];
}

export interface DiagnosticsReport {
  generatedAt: string;
  policy: ReviewFuelPolicy;
  aggregate: FuelSummary;
  files: DiagnosticsReportFile[];
}

export function emptyFuelSummary(): FuelSummary {
  return {
    callCount: 0,
    hotspotCount: 0,
    peakFuel: 0,
    totalFuel: 0,
    parseErrorCount: 0,
    fallback: false,
    policyExceeded: false,
    policyReasons: [],
  };
}

export function fuelSummaryForDiff(diff: SemanticDiff | undefined, fuelPolicy: ReviewFuelPolicy): FuelSummary {
  const telemetry = recordField(diff?.metadata?.engine_telemetry);
  const calls = arrayRecords(telemetry?.calls);
  const hotspots = arrayRecords(telemetry?.fuel_hotspots);
  const policyReasons = uniqueStrings(calls.flatMap((call) => {
    const fuelConsumed = numberField(call.fuel_consumed);
    const inputBytes = numberField(call.input_bytes);
    const inputLines = numberField(call.input_lines);
    const fuelPerKb = fuelConsumed !== undefined ? fuelConsumed / Math.max((inputBytes ?? 0) / 1024, 1) : undefined;
    const fuelPerLine = fuelConsumed !== undefined ? fuelConsumed / Math.max(inputLines ?? 0, 1) : undefined;
    return [
      fuelConsumed !== undefined && fuelConsumed > fuelPolicy.peakFuelWarning ? "peak" : "",
      fuelPerKb !== undefined && fuelPerKb > fuelPolicy.fuelPerKbWarning ? "per_kb" : "",
      fuelPerLine !== undefined && fuelPerLine > fuelPolicy.fuelPerLineWarning ? "per_line" : "",
    ].filter(Boolean);
  }));
  return {
    callCount: calls.length,
    hotspotCount: hotspots.length,
    peakFuel: calls.reduce((peak, call) => Math.max(peak, numberField(call.fuel_consumed) ?? 0), 0),
    totalFuel: calls.reduce((total, call) => {
      const totalConsumed = numberField(call.total_fuel_consumed);
      const consumed = numberField(call.fuel_consumed);
      return total + (totalConsumed ?? consumed ?? 0);
    }, 0),
    parseErrorCount: diff?.parse_errors?.length ?? 0,
    fallback: diff?.is_fallback === true,
    policyExceeded: policyReasons.length > 0 || hotspots.length > 0,
    policyReasons,
  };
}

export function parserCallsForDiff(diff: SemanticDiff | undefined): DiagnosticsParserCall[] {
  const telemetry = recordField(diff?.metadata?.engine_telemetry);
  return arrayRecords(telemetry?.calls).map((call) => {
    const fuelConsumed = numberField(call.fuel_consumed) ?? 0;
    const inputBytes = numberField(call.input_bytes);
    const inputLines = numberField(call.input_lines);
    return {
      plugin: stringField(call.plugin, "plugin"),
      func: stringField(call.function, "call"),
      language: stringField(call.language, "unknown"),
      filename: stringField(call.filename, ""),
      provenance: stringField(call.provenance, "unknown"),
      engine: stringField(call.engine, "unknown"),
      version: stringField(call.parser_version ?? call.plugin_version ?? call.version, ""),
      trusted: call.trusted === true,
      status: statusSummary(call.statuses) || stringField(call.status, "unknown"),
      fuelConsumed,
      totalFuelConsumed: numberField(call.total_fuel_consumed) ?? fuelConsumed,
      fuelBudget: numberField(call.fuel_budget),
      fuelUsedPercent: numberField(call.max_fuel_used_percent) ?? numberField(call.fuel_used_percent),
      fuelPerKb: fuelConsumed / Math.max((inputBytes ?? 0) / 1024, 1),
      fuelPerLine: fuelConsumed / Math.max(inputLines ?? 0, 1),
      inputBytes,
      inputLines,
    };
  });
}

export function recordField(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;
}

export function arrayRecords(value: unknown): Record<string, unknown>[] {
  return Array.isArray(value)
    ? value.filter((item): item is Record<string, unknown> => recordField(item) !== undefined)
    : [];
}

export function numberField(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

export function stringField(value: unknown, fallback: string): string {
  return typeof value === "string" && value.length > 0 ? value : fallback;
}

export function statusSummary(value: unknown): string {
  const record = recordField(value);
  if (!record) {
    return "";
  }
  return Object.entries(record)
    .map(([status, count]) => `${status}:${count}`)
    .join(", ");
}

export function uniqueStrings(values: string[]): string[] {
  return [...new Set(values.filter(Boolean))];
}

export function formatFuel(value: number): string {
  if (value >= 1_000_000) {
    return `${(value / 1_000_000).toFixed(value >= 10_000_000 ? 1 : 2)}M`;
  }
  if (value >= 1_000) {
    return `${(value / 1_000).toFixed(value >= 10_000 ? 1 : 2)}K`;
  }
  return String(Math.round(value));
}

export function escapeHtml(value: unknown): string {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

export function createDiagnosticsNonce(): string {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  let result = "";
  for (let index = 0; index < 32; index += 1) {
    result += alphabet[Math.floor(Math.random() * alphabet.length)];
  }
  return result;
}

export function renderDiagnosticsReportHtml(report: DiagnosticsReport, options: { nonce: string; cspSource: string }): string {
  const rows = report.files.map((file) => `
    <article class="file ${file.summary.policyExceeded ? "hot" : ""}">
      <header><strong>${escapeHtml(file.relativePath)}</strong><span>${escapeHtml(file.language)}</span></header>
      <div class="metrics">
        <span>${escapeHtml(formatFuel(file.summary.peakFuel))}<small>peak</small></span>
        <span>${escapeHtml(formatFuel(file.summary.totalFuel))}<small>total</small></span>
        <span>${file.summary.hotspotCount}<small>hotspots</small></span>
        <span>${file.history.length}<small>samples</small></span>
      </div>
      <p>${escapeHtml(file.summary.policyReasons.join(", ") || "within policy")}</p>
      <ul>${file.parserCalls.slice(0, 5).map((call) => `<li title="${escapeHtml(call.plugin)}">${escapeHtml(`${call.language} ${call.func} ${formatFuel(call.fuelConsumed)} fuel ${call.provenance} ${call.engine}${call.version ? ` ${call.version}` : ""}`)}</li>`).join("")}</ul>
    </article>`).join("");
  return `<!doctype html><html lang="en"><head><meta charset="utf-8">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src ${options.cspSource} data:; style-src 'nonce-${options.nonce}';">
  <style nonce="${options.nonce}">
    body{margin:0;padding:18px;background:var(--vscode-editor-background);color:var(--vscode-editor-foreground);font:13px/1.45 var(--vscode-font-family,system-ui,sans-serif)}
    main{display:grid;gap:12px;max-width:1180px;margin:auto}h1,h2,p{margin:0}.summary,.file{border:1px solid var(--vscode-panel-border);border-radius:8px;background:var(--vscode-editorWidget-background);padding:12px}.file.hot{border-color:var(--vscode-errorForeground)}.metrics{display:grid;grid-template-columns:repeat(auto-fit,minmax(110px,1fr));gap:8px}.metrics span{display:grid;border:1px solid var(--vscode-panel-border);border-radius:7px;padding:8px;background:var(--vscode-input-background)}.metrics small{color:var(--vscode-descriptionForeground)}header{display:flex;justify-content:space-between;gap:12px}li{margin-top:4px;color:var(--vscode-foreground)}
  </style><title>IntentumDiff Diagnostics</title></head><body><main>
    <h1>IntentumDiff Diagnostics</h1>
    <section class="summary"><h2>Fuel policy</h2><p>Generated ${escapeHtml(report.generatedAt)}</p><div class="metrics">
      <span>${escapeHtml(formatFuel(report.aggregate.peakFuel))}<small>peak</small></span>
      <span>${escapeHtml(formatFuel(report.aggregate.totalFuel))}<small>total</small></span>
      <span>${report.aggregate.hotspotCount}<small>hotspots</small></span>
      <span>${report.files.length}<small>files</small></span>
    </div></section>
    ${rows || "<p>No review diagnostics are available yet.</p>"}
  </main></body></html>`;
}

export function diagnosticsReportMarkdown(report: DiagnosticsReport): string {
  const lines = [
    "# IntentumDiff Diagnostics",
    "",
    `Generated: ${report.generatedAt}`,
    "",
    `- Peak fuel: ${formatFuel(report.aggregate.peakFuel)}`,
    `- Total fuel: ${formatFuel(report.aggregate.totalFuel)}`,
    `- Hotspots: ${report.aggregate.hotspotCount}`,
    `- Policy: peak>${formatFuel(report.policy.peakFuelWarning)}, perKB>${formatFuel(report.policy.fuelPerKbWarning)}, perLine>${formatFuel(report.policy.fuelPerLineWarning)}`,
    "",
    "## Files",
    "",
  ];
  for (const file of report.files) {
    lines.push(
      `### ${file.relativePath}`,
      "",
      `- Language: ${file.language}`,
      `- Peak fuel: ${formatFuel(file.summary.peakFuel)}`,
      `- Total fuel: ${formatFuel(file.summary.totalFuel)}`,
      `- Hotspots: ${file.summary.hotspotCount}`,
      `- Policy: ${file.summary.policyReasons.join(", ") || "within policy"}`,
      `- History samples: ${file.history.map(formatFuel).join(", ") || "none"}`,
      "",
    );
    for (const call of file.parserCalls.slice(0, 5)) {
      lines.push(`  - ${call.language} ${call.func}: ${formatFuel(call.fuelConsumed)} fuel, ${call.provenance}, ${call.engine}${call.version ? `, ${call.version}` : ""}, ${call.plugin}`);
    }
    lines.push("");
  }
  return `${lines.join("\n")}\n`;
}

