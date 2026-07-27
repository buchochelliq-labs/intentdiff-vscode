import type { GuardrailViolation, SemanticChange, SemanticDiff } from "./types";
import { categoryForKind, coveredChangeIndices, kindForChange, riskForContent } from "./intentCodeLens";
import { contentClassForDiff } from "./contentClass";
import { explainChange, explainGroup, type IntentExplanation } from "./intentExplain";

/**
 * A release-note line = what + why, e.g. "Added function `ccc` — empty stub, no
 * implementation yet." The why is dropped when it merely restates the what or is empty.
 */
function noteLine(explanation: IntentExplanation): string {
  const what = explanation.what.trim();
  const why = explanation.why?.trim() ?? "";
  if (!why || what.toLowerCase().includes(why.toLowerCase())) {
    return what;
  }
  const tail = why.charAt(0).toLowerCase() + why.slice(1);
  return `${what.replace(/\.$/u, "")} — ${tail}`;
}

/**
 * Release-notes generation (pure — no vscode import so it stays unit-testable
 * under `node --test`). Turns a {@link SemanticDiff} into three
 * reviewer-facing buckets derived from the same intent category → risk map the
 * CodeLens uses (see intentCodeLens.ts):
 *
 * - `behavior`   → user-visible / meaningful changes (risk "behavior").
 * - `internal`   → refactors and moves (risk "internal").
 * - `guardrails` → guardrail violations that need a call-out.
 *
 * Style-only and noise-suppressed groups earn no note (categoryForKind returns
 * undefined for them), matching the CodeLens suppression rule.
 */

export interface ReleaseNotes {
  behavior: string[];
  internal: string[];
  /** Non-code content edits (docs / config / data / text) — "Docs & chores". */
  other: string[];
  guardrails: string[];
}

const EMPTY_BEHAVIOR = "No behavior-facing changes detected.";
const EMPTY_INTERNAL = "No internal-only changes detected.";
const EMPTY_OTHER = "No docs or chore changes detected.";
const EMPTY_GUARDRAILS = "No guardrail violations.";

function dedupe(lines: string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) {
      continue;
    }
    const key = trimmed.toLowerCase();
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    result.push(trimmed);
  }
  return result;
}

function guardrailLine(violation: GuardrailViolation): string {
  const severity = violation.severity === "immutable" ? "Immutable" : "Important";
  const message = violation.message?.trim() || violation.rule_id || "Guardrail violation";
  const scope = violation.semantic_path?.trim();
  return scope ? `${severity}: ${message} (${scope})` : `${severity}: ${message}`;
}

/**
 * Build categorized release notes from a semantic diff. Returns three buckets;
 * each bucket is a de-duplicated, source-derived list. Empty diffs yield empty
 * buckets (callers decide how to present the empty state).
 */
export function buildReleaseNotes(diff: SemanticDiff | undefined): ReleaseNotes {
  const changes: SemanticChange[] = diff?.changes ?? [];
  const groups = diff?.change_groups ?? [];
  const contentClass = contentClassForDiff(diff);
  const behavior: string[] = [];
  const internal: string[] = [];
  const other: string[] = [];
  const bucket = (risk: ReturnType<typeof riskForContent>, note: string): void => {
    const trimmed = note.trim();
    if (!trimmed) {
      return;
    }
    if (risk === "behavior") {
      behavior.push(trimmed);
    } else if (risk === "internal") {
      internal.push(trimmed);
    } else if (risk === "content") {
      other.push(trimmed);
    }
  };
  for (const group of groups) {
    // categoryForKind suppresses style/noise the same way the CodeLens does.
    if (!categoryForKind(group.kind)) {
      continue;
    }
    bucket(riskForContent(group.kind, contentClass), noteLine(explainGroup(group, changes, contentClass)));
  }
  // Cover any change NOT owned by a group — the engine may emit no groups, or leave a real
  // change (e.g. a new function) ungrouped after dropping mis-indexed groups. Classify it
  // directly so it still lands in a note instead of being silently dropped (as CodeLens does).
  const covered = coveredChangeIndices(groups, changes.length);
  changes.forEach((change, index) => {
    if (covered.has(index)) {
      return;
    }
    const kind = kindForChange(change);
    if (!categoryForKind(kind)) {
      return;
    }
    bucket(riskForContent(kind, contentClass), noteLine(explainChange(change, undefined, contentClass)));
  });
  const guardrails = (diff?.guardrail_violations ?? []).map(guardrailLine);
  return {
    behavior: dedupe(behavior),
    internal: dedupe(internal),
    other: dedupe(other),
    guardrails: dedupe(guardrails),
  };
}

/** True when at least one bucket has a note. */
export function hasReleaseNotes(notes: ReleaseNotes): boolean {
  return notes.behavior.length > 0 || notes.internal.length > 0 || notes.other.length > 0 || notes.guardrails.length > 0;
}

/** One-line summary, e.g. "2 behavior · 1 internal · 1 docs · 1 guardrail" (or a clean-state note). */
export function releaseNotesSummary(notes: ReleaseNotes): string {
  const parts = [
    notes.behavior.length ? `${notes.behavior.length} behavior` : "",
    notes.internal.length ? `${notes.internal.length} internal` : "",
    notes.other.length ? `${notes.other.length} docs/chore${notes.other.length === 1 ? "" : "s"}` : "",
    notes.guardrails.length ? `${notes.guardrails.length} guardrail${notes.guardrails.length === 1 ? "" : "s"}` : "",
  ].filter(Boolean);
  return parts.length > 0 ? parts.join(" · ") : "No release-worthy changes — formatting or noise only.";
}

function markdownSection(title: string, lines: string[], emptyLine: string): string {
  const body = lines.length > 0
    ? lines.map((line) => `- ${line}`).join("\n")
    : `- _${emptyLine}_`;
  return `## ${title}\n${body}`;
}

/**
 * Render release notes as a Markdown document suitable for Copy-as-Markdown.
 * All three sections are always present so pasted notes have a stable shape.
 */
export function releaseNotesToMarkdown(
  notes: ReleaseNotes,
  options: { title?: string; narrative?: string } = {},
): string {
  const heading = options.title?.trim() || "Release notes";
  const narrative = options.narrative?.trim();
  return [
    `# ${heading}`,
    "",
    ...(narrative ? [`## Summary`, narrative, ""] : []),
    markdownSection("Behavior changes", notes.behavior, EMPTY_BEHAVIOR),
    "",
    markdownSection("Internal changes", notes.internal, EMPTY_INTERNAL),
    "",
    markdownSection("Docs & chores", notes.other, EMPTY_OTHER),
    "",
    markdownSection("Guardrails", notes.guardrails, EMPTY_GUARDRAILS),
    "",
  ].join("\n");
}

/** Serialize release notes to pretty-printed JSON for Export-JSON. */
export function releaseNotesToJson(notes: ReleaseNotes): string {
  return JSON.stringify(notes, null, 2);
}
