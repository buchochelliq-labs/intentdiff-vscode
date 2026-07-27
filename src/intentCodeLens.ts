import { reviewTargetForChange } from "./mapper";
import { contentLabel, type ContentClass } from "./contentClass";
import type { ChangeGroup, SemanticChange, SemanticDiff } from "./types";

/**
 * Intent CodeLens logic for the native diff editor (pure — no vscode import so
 * it stays unit-testable under `node --test`; the provider lives in
 * intentCodeLensProvider.ts).
 *
 * The engine emits a per-group intent category (ChangeGroupKind) which we
 * surface as a CodeLens above each changed hunk: `‹icon› CATEGORY · why`.
 * Risk (behavior vs internal) is derived from the category — the engine does
 * not emit a discrete risk field (see spec §8).
 *
 * Line numbers follow the same convention as `toRange` in extension.ts: engine
 * NodePosition line numbers are already 0-based and map directly onto VS Code
 * ranges.
 */

export type IntentSide = "base" | "modified";
/** "content" = a non-code (docs/config/data/text) change — not runtime behavior. */
export type IntentRisk = "behavior" | "internal" | "content";

export interface IntentCategory {
  /** ChangeGroupKind, e.g. "MEANINGFUL_CHANGE". */
  kind: string;
  /** Human label, e.g. "Meaningful". */
  label: string;
  /** Codicon id (no `$(...)` wrapper), e.g. "lightbulb". */
  icon: string;
  risk?: IntentRisk;
}

export interface IntentLens {
  /** 0-based line the lens anchors to (matches toRange convention). */
  line: number;
  side: IntentSide;
  category: IntentCategory;
  why: string;
  groupIndex: number;
}

interface CategoryMeta {
  label: string;
  icon: string;
  risk?: IntentRisk;
  /** Whether the category earns a CodeLens (style/noise are suppressed). */
  show: boolean;
}

const CATEGORY_META: Record<string, CategoryMeta> = {
  MEANINGFUL_CHANGE: { label: "Meaningful", icon: "lightbulb", risk: "behavior", show: true },
  REFACTORING: { label: "Refactoring", icon: "symbol-variable", risk: "internal", show: true },
  MOVED_CODE: { label: "Moved", icon: "arrow-swap", risk: "internal", show: true },
  IGNORED_STYLE: { label: "Style", icon: "paintcan", show: false },
  NOISE_SUPPRESSED: { label: "Noise", icon: "mute", show: false },
};

export function categoryForKind(kind: string): IntentCategory | undefined {
  const meta = CATEGORY_META[kind];
  if (!meta || !meta.show) {
    return undefined;
  }
  return { kind, label: meta.label, icon: meta.icon, risk: meta.risk };
}

/** Derived risk label for a category kind (behavior vs internal). */
export function riskForKind(kind: string): IntentRisk | undefined {
  return CATEGORY_META[kind]?.risk;
}

/**
 * Content-aware risk: on non-code files a change is never runtime "behavior" — any
 * change the engine deemed notable becomes a "content" edit; style/noise stay unrisked.
 */
export function riskForContent(kind: string, contentClass: ContentClass): IntentRisk | undefined {
  if (contentClass === "code") {
    return riskForKind(kind);
  }
  return riskForKind(kind) ? "content" : undefined;
}

/** Relabel a category for non-code content (Meaningful → Docs/Config/Data/Content). */
export function categoryForContent(category: IntentCategory, contentClass: ContentClass): IntentCategory {
  if (contentClass === "code" || category.risk === undefined) {
    return category;
  }
  return { ...category, label: contentLabel(contentClass), risk: "content" };
}

/**
 * Category descriptor for ANY known kind — including style/noise which are
 * suppressed from CodeLens but still useful on hover / in evidence.
 */
export function describeKind(kind: string): IntentCategory | undefined {
  const meta = CATEGORY_META[kind];
  return meta ? { kind, label: meta.label, icon: meta.icon, risk: meta.risk } : undefined;
}

export interface IntentAtLine {
  category: IntentCategory;
  why: string;
  groupIndex: number;
}

/**
 * The intent covering a given 0-based line on one side of the diff (matches any
 * line within a group's change positions, not just the representative line).
 * Pure so it backs both the hover and the code-action providers.
 */
export function intentForLine(diff: SemanticDiff, side: IntentSide, line: number): IntentAtLine | undefined {
  const changes = diff.changes ?? [];
  const groups = diff.change_groups ?? [];
  for (let groupIndex = 0; groupIndex < groups.length; groupIndex += 1) {
    const group = groups[groupIndex];
    const category = describeKind(group.kind);
    if (!category) {
      continue;
    }
    for (const change of groupChanges(group, changes)) {
      const target = reviewTargetForChange(change);
      if (!target || target.side !== side) {
        continue;
      }
      const start = Math.max(target.position.start_line, 0);
      const end = Math.max(target.position.end_line, start);
      if (line >= start && line <= end) {
        return { category, why: groupWhy(group, changes), groupIndex };
      }
    }
  }
  // Per-change fallback for any change NOT owned by a group — either when the engine
  // emits no groups, or when a real change (e.g. a new function) is left ungrouped after
  // the engine drops mis-indexed groups. Classify it directly so it isn't lost.
  const covered = coveredChangeIndices(groups, changes.length);
  for (let index = 0; index < changes.length; index += 1) {
    if (covered.has(index)) {
      continue;
    }
    const change = changes[index];
    const category = describeKind(kindForChange(change));
    const target = reviewTargetForChange(change);
    if (!category || !target || target.side !== side) {
      continue;
    }
    const start = Math.max(target.position.start_line, 0);
    const end = Math.max(target.position.end_line, start);
    if (line >= start && line <= end) {
      return { category, why: changeWhy(change), groupIndex: -(index + 1) };
    }
  }
  return undefined;
}

/** Set of change indices owned by any group (in range), so the per-change fallback skips them. */
export function coveredChangeIndices(groups: ChangeGroup[], changeCount: number): Set<number> {
  const covered = new Set<number>();
  for (const group of groups) {
    for (const index of group.raw_change_indices ?? []) {
      if (index >= 0 && index < changeCount) {
        covered.add(index);
      }
    }
  }
  return covered;
}

function groupChanges(group: ChangeGroup, changes: SemanticChange[]): SemanticChange[] {
  const indices = group.raw_change_indices ?? [];
  const result: SemanticChange[] = [];
  for (const index of indices) {
    const change = changes[index];
    if (change) {
      result.push(change);
    }
  }
  return result;
}

/** Representative anchor line for a group on the requested side (lowest line). */
function representativeLine(
  group: ChangeGroup,
  changes: SemanticChange[],
  side: IntentSide,
): number | undefined {
  let best: number | undefined;
  for (const change of groupChanges(group, changes)) {
    const target = reviewTargetForChange(change);
    if (!target || target.side !== side) {
      continue;
    }
    const line = Math.max(target.position.start_line, 0);
    if (best === undefined || line < best) {
      best = line;
    }
  }
  return best;
}

function humanize(value: string): string {
  return value
    .replace(/[_-]+/gu, " ")
    .toLowerCase()
    .replace(/^\w/u, (c) => c.toUpperCase());
}

/** One-line "why" for a group: refactoring kind → first description → labels → kind. */
export function groupWhy(group: ChangeGroup, changes: SemanticChange[]): string {
  if (group.refactoring_kind) {
    return humanize(group.refactoring_kind);
  }
  for (const change of groupChanges(group, changes)) {
    const description = change.description?.trim();
    if (description) {
      return description;
    }
  }
  const oldLabel = group.old_labels?.find((label) => label.trim());
  const newLabel = group.new_labels?.find((label) => label.trim());
  if (oldLabel && newLabel && oldLabel !== newLabel) {
    return `${oldLabel} → ${newLabel}`;
  }
  return newLabel ?? oldLabel ?? humanize(group.kind);
}

/** Map a raw change to a ChangeGroupKind when the engine emits no groups. */
export function kindForChange(change: SemanticChange): string {
  if (change.refactoring_kind || change.change_type === "REFACTORING") {
    return "REFACTORING";
  }
  if (change.change_type === "MOVE" || change.change_type === "REORDER") {
    return "MOVED_CODE";
  }
  if (change.change_type === "STYLE_ONLY") {
    return "IGNORED_STYLE";
  }
  return "MEANINGFUL_CHANGE";
}

function changeWhy(change: SemanticChange): string {
  const description = change.description?.trim();
  if (description) {
    return description;
  }
  if (change.refactoring_kind) {
    return humanize(change.refactoring_kind);
  }
  const label = change.new_node?.label?.trim() || change.old_node?.label?.trim();
  return label ?? humanize(change.change_type);
}

/**
 * Build the intent lenses for one side of a diff. Pure and vscode-free so it
 * can be unit-tested with `node --test`. Falls back to the raw `changes[]` when
 * the engine emits no `change_groups` (common for simple files), so intent still
 * surfaces on every semantic change.
 */
export function buildIntentLenses(diff: SemanticDiff, side: IntentSide): IntentLens[] {
  const changes = diff.changes ?? [];
  const groups = diff.change_groups ?? [];
  const lenses: IntentLens[] = [];
  groups.forEach((group, groupIndex) => {
    const category = categoryForKind(group.kind);
    if (!category) {
      return;
    }
    const line = representativeLine(group, changes, side);
    if (line === undefined) {
      return;
    }
    lenses.push({
      line,
      side,
      category,
      why: groupWhy(group, changes),
      groupIndex,
    });
  });
  // Emit a lens for every meaningful change NOT owned by a group (engine emitted none,
  // or left it ungrouped after dropping mis-indexed groups — e.g. a new function).
  const covered = coveredChangeIndices(groups, changes.length);
  changes.forEach((change, index) => {
    if (covered.has(index)) {
      return;
    }
    const category = categoryForKind(kindForChange(change));
    if (!category) {
      return;
    }
    const target = reviewTargetForChange(change);
    if (!target || target.side !== side) {
      return;
    }
    lenses.push({
      line: Math.max(target.position.start_line, 0),
      side,
      category,
      why: changeWhy(change),
      groupIndex: -(index + 1),
    });
  });
  lenses.sort((a, b) => a.line - b.line || a.groupIndex - b.groupIndex);
  return lenses;
}

/** Rendered CodeLens title, e.g. `$(lightbulb) Meaningful · Behavior · Rename foo`. */
export function lensTitle(lens: IntentLens): string {
  const risk = lens.category.risk === "behavior" ? " · Behavior" : "";
  // Non-code "content" changes already carry a content label (Docs/Config/…), so no
  // extra risk suffix is added — the label itself says it isn't runtime behavior.
  return `$(${lens.category.icon}) ${lens.category.label}${risk} · ${lens.why}`;
}

/** The bits of an opened diff the provider needs, resolved per document URI. */
export interface IntentLensContext {
  diff?: SemanticDiff;
  mode: string;
  side: IntentSide;
  folderUri: string;
  relativePath: string;
}

export interface PeekIntentArgs {
  folderUri: string;
  relativePath: string;
  side: IntentSide;
  line: number;
  groupIndex: number;
}
