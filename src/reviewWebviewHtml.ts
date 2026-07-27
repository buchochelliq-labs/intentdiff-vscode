// Shared chrome primitives for the review webview renderers.

import type { ReviewWebviewCommand, ReviewWebviewPayload } from "./reviewWebviewModel";

export function escapeHtml(value: unknown): string {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}


export function commandAttributes(command: ReviewWebviewCommand, payload?: ReviewWebviewPayload): string {
  return `data-command="${command}"${payload ? ` data-payload="${escapeHtml(JSON.stringify(payload))}"` : ""}`;
}


export type IconName =
  | "brand"
  | "rail"
  | "dock"
  | "map"
  | "drawer"
  | "native"
  | "filter"
  | "refresh"
  | "pin"
  | "detail"
  | "unicode"
  | "intent"
  | "risk"
  | "evidence"
  | "notes"
  | "release"
  | "copy"
  | "download"
  | "image"
  | "schema"
  | "accept"
  | "issue"
  | "graph";

export function iconSvg(name: IconName): string {
  // Chrome icons are CODICONS (CLAUDE.md invariant #7 / issue #27); the sole SVG
  // left is the brand LOGO (branding, not a chrome icon — like the asset-diff
  // data overlays, it is exempt).
  if (name === "brand") {
    return `<svg class="control-icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false"><defs><linearGradient id="id-brand" x1="5" y1="2" x2="19" y2="22" gradientUnits="userSpaceOnUse"><stop offset="0" stop-color="#18e8c7"/><stop offset=".52" stop-color="#28bdf6"/><stop offset="1" stop-color="#7b5cff"/></linearGradient></defs><path fill="url(#id-brand)" d="M6.5 2.8h5.2c.9 0 1.7.8 1.7 1.7v15c0 .9-.8 1.7-1.7 1.7H6.5c-.9 0-1.7-.8-1.7-1.7v-2.3c0-.9.8-1.7 1.7-1.7h1.2v-7H6.5c-.9 0-1.7-.8-1.7-1.7V4.5c0-.9.8-1.7 1.7-1.7Z"/><path d="M12.8 6.2h6.6M12.8 10.1h5.5M12.8 14h7.1M12.8 17.9h4.2" stroke="url(#id-brand)" stroke-width="1.8" stroke-linecap="round"/><circle cx="20.9" cy="6.2" r=".9" fill="#3b8cff"/><circle cx="19.5" cy="14" r=".85" fill="#8b5cff"/></svg>`;
  }
  const codicons: Record<Exclude<IconName, "brand">, string> = {
    rail: "table",
    dock: "layout",
    map: "list-tree",
    drawer: "layout-panel",
    native: "go-to-file",
    filter: "filter",
    refresh: "refresh",
    pin: "pin",
    detail: "info",
    unicode: "whole-word",
    intent: "lightbulb",
    risk: "warning",
    evidence: "checklist",
    notes: "note",
    release: "rocket",
    copy: "copy",
    download: "desktop-download",
    image: "file-media",
    schema: "symbol-structure",
    accept: "check",
    issue: "issues",
    graph: "type-hierarchy",
  };
  return `<span class="codicon codicon-${codicons[name]} control-icon" aria-hidden="true"></span>`;
}


export function actionButton(label: string, command: ReviewWebviewCommand, payload?: ReviewWebviewPayload, icon?: IconName): string {
  return `<button class="action ${icon ? "has-icon" : ""}" type="button" ${commandAttributes(command, payload)} title="${escapeHtml(label)}">${icon ? iconSvg(icon) : ""}<span>${escapeHtml(label)}</span></button>`;
}


export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
