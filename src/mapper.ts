import type {
  DecorationLike,
  DiagnosticLike,
  DiffSummary,
  NodePosition,
  SemanticChange,
  SemanticDiff,
} from "./types";

export function summarizeDiff(diff: SemanticDiff): DiffSummary {
  const violations = diff.guardrail_violations ?? [];
  return {
    changeCount: diff.changes?.length ?? 0,
    guardrailCount: violations.length,
    immutableCount: violations.filter((item) => item.severity === "immutable").length,
    importantCount: violations.filter((item) => item.severity === "important").length,
    styleOnly: diff.is_style_only === true,
    hasParseErrors: (diff.parse_errors?.length ?? 0) > 0,
    language: diff.language,
  };
}

export function diffToDiagnostics(diff: SemanticDiff): DiagnosticLike[] {
  const diagnostics: DiagnosticLike[] = [];
  for (const violation of diff.guardrail_violations ?? []) {
    diagnostics.push({
      severity: violation.severity === "immutable" ? "error" : "warning",
      message: violation.message,
      source: "IntentDiff",
      position: violation.position,
      code: violation.rule_id,
    });
  }

  for (const parseError of diff.parse_errors ?? []) {
    const isFuel = parseError.includes("FUEL_EXCEEDED");
    diagnostics.push({
      severity: isFuel ? "error" : "warning",
      message: parseError,
      source: "IntentDiff",
      position: { start_line: 0, start_col: 0, end_line: 0, end_col: 1 },
      code: isFuel ? "fuel_exceeded" : "parse_error",
    });
  }
  if (diff.is_fallback === true) {
    diagnostics.push({
      severity: "warning",
      message: "Parser fallback used; semantic precision may be reduced.",
      source: "IntentDiff",
      position: { start_line: 0, start_col: 0, end_line: 0, end_col: 1 },
      code: "parser_fallback",
    });
  }
  for (const hotspot of fuelHotspots(diff)) {
    diagnostics.push({
      severity: "warning",
      message: fuelHotspotMessage(hotspot),
      source: "IntentDiff",
      position: { start_line: 0, start_col: 0, end_line: 0, end_col: 1 },
      code: "fuel_hotspot",
    });
  }

  for (const group of diff.change_groups ?? []) {
    if (group.kind === "REFACTORING") {
      const label = group.refactoring_kind ?? group.kind;
      diagnostics.push({
        severity: "information",
        message: `Refactoring detected: ${label}`,
        source: "IntentDiff",
        code: "refactoring",
      });
    }
  }
  return diagnostics;
}

export function diffToDecorations(diff: SemanticDiff): DecorationLike[] {
  return diffToModifiedDecorations(diff);
}

export type SemanticChangeTargetSide = "base" | "modified";

export interface SemanticChangeTarget {
  position: NodePosition;
  side: SemanticChangeTargetSide;
}

export function reviewTargetForChange(change: SemanticChange): SemanticChangeTarget | undefined {
  const newPosition = change.new_node?.position ?? undefined;
  if (newPosition) {
    return { position: newPosition, side: "modified" };
  }
  const oldPosition = change.old_node?.position ?? undefined;
  if (oldPosition) {
    return { position: oldPosition, side: "base" };
  }
  return undefined;
}

export function diffToModifiedDecorations(diff: SemanticDiff): DecorationLike[] {
  const decorations: DecorationLike[] = [];
  for (const change of diff.changes ?? []) {
    if (isPresentationNoiseChange(change)) {
      continue;
    }
    if (change.change_type === "DELETION") {
      continue;
    }
    const position = change.new_node?.position ?? undefined;
    if (!position) {
      continue;
    }
    const decorationPosition = compactStructuralWrapperPosition(diff, change, position);
    decorations.push({
      kind: decorationKind(change),
      message: change.description || change.refactoring_kind || change.change_type,
      position: decorationPosition,
      isComment: isCommentChange(change),
    });
    if (hasInlineGenericDeletionEvidence(diff, change)) {
      const deletionPoint = inlineDeletionPoint(change);
      if (deletionPoint) {
        decorations.push(...inlineDeletionDecorations(change, deletionPoint));
      }
    }
  }
  return decorations;
}

function hasInlineGenericDeletionEvidence(diff: SemanticDiff, change: SemanticChange): boolean {
  return (
    diff.language === "generic"
    && change.change_type === "MODIFICATION"
    && change.new_node?.position !== undefined
    && change.old_node?.node_type === "text_span"
    && change.old_node.position?.start_line === change.old_node.position?.end_line
    && change.text_diff?.includes("[-") === true
  );
}

function inlineDeletionPoint(change: SemanticChange): NodePosition | undefined {
  const position = change.new_node?.position;
  if (!position) {
    return undefined;
  }
  return {
    ...position,
    end_line: position.start_line,
    end_col: position.start_col,
  };
}

function inlineDeletionDecorations(
  change: SemanticChange,
  position: NodePosition,
): DecorationLike[] {
  const message = change.description || change.text_diff || change.change_type;
  const decorations: DecorationLike[] = [];
  const insideWordDeletion = isInsideWordDeletion(change);
  if (insideWordDeletion) {
    decorations.push({
      kind: "inlineDeletionWord",
      message,
      position,
      isComment: isCommentChange(change),
    });
  }
  decorations.push({
    kind: "inlineDeletionGap",
    message,
    position,
    deletedText: insideWordDeletion ? undefined : deletedTextLabel(change),
    isComment: isCommentChange(change),
  });
  return decorations;
}

function deletedTextLabel(change: SemanticChange): string | undefined {
  const deletedText = (change.old_node?.label ?? "").trim();
  return deletedText ? deletedText : undefined;
}

function isInsideWordDeletion(change: SemanticChange): boolean {
  const deletedText = change.old_node?.label ?? "";
  if (!deletedText || /^\s|\s$/u.test(deletedText)) {
    return false;
  }

  for (const marker of deletionMarkers(change.text_diff ?? "")) {
    if (marker.deletedText !== deletedText) {
      continue;
    }
    const before = marker.markerStart > 0 ? marker.textDiff[marker.markerStart - 1] : "";
    const after = marker.markerEnd < marker.textDiff.length
      ? marker.textDiff[marker.markerEnd]
      : "";
    return isWordCharacter(before) && isWordCharacter(after);
  }

  return false;
}

function deletionMarkers(textDiff: string): Array<{
  deletedText: string;
  markerStart: number;
  markerEnd: number;
  textDiff: string;
}> {
  const markers: Array<{
    deletedText: string;
    markerStart: number;
    markerEnd: number;
    textDiff: string;
  }> = [];
  let searchFrom = 0;
  while (searchFrom < textDiff.length) {
    const markerStart = textDiff.indexOf("[-", searchFrom);
    if (markerStart === -1) {
      break;
    }
    const deletedStart = markerStart + 2;
    const markerEnd = textDiff.indexOf("]", deletedStart);
    if (markerEnd === -1) {
      break;
    }
    markers.push({
      deletedText: textDiff.slice(deletedStart, markerEnd),
      markerStart,
      markerEnd: markerEnd + 1,
      textDiff,
    });
    searchFrom = markerEnd + 1;
  }
  return markers;
}

function isWordCharacter(value: string): boolean {
  return /^[A-Za-z0-9_]$/u.test(value);
}

export function diffToBaseDecorations(diff: SemanticDiff): DecorationLike[] {
  const decorations: DecorationLike[] = [];
  for (const change of diff.changes ?? []) {
    if (isPresentationNoiseChange(change)) {
      continue;
    }
    if (change.change_type !== "DELETION") {
      continue;
    }
    const position = change.old_node?.position ?? undefined;
    if (!position) {
      continue;
    }
    const decorationPosition = compactStructuralWrapperPosition(diff, change, position);
    decorations.push({
      kind: "deletion",
      message: change.description || change.change_type,
      position: decorationPosition,
      isComment: isCommentChange(change),
    });
  }
  return decorations;
}

export function statusText(diff: SemanticDiff): string {
  const summary = summarizeDiff(diff);
  if (summary.guardrailCount > 0) {
    return `IntentDiff: ${summary.guardrailCount} guardrail`;
  }
  if ((diff.parse_errors ?? []).some((error) => error.includes("FUEL_EXCEEDED"))) {
    return "IntentDiff: fuel exceeded";
  }
  if ((diff.parse_errors?.length ?? 0) > 0) {
    return `IntentDiff: ${diff.parse_errors?.length ?? 0} parser warning`;
  }
  if (diff.is_fallback === true) {
    return "IntentDiff: parser fallback";
  }
  const hotspotCount = fuelHotspots(diff).length;
  if (hotspotCount > 0) {
    return `IntentDiff: ${hotspotCount} fuel warning${hotspotCount === 1 ? "" : "s"}`;
  }
  if (summary.styleOnly) {
    return "IntentDiff: style-only";
  }
  if (summary.changeCount === 0) {
    return "IntentDiff: clean";
  }
  return `IntentDiff: ${summary.changeCount} changes`;
}

function fuelHotspots(diff: SemanticDiff): Record<string, unknown>[] {
  const telemetry = diff.metadata?.engine_telemetry;
  if (!telemetry || typeof telemetry !== "object" || Array.isArray(telemetry)) {
    return [];
  }
  const hotspots = (telemetry as { fuel_hotspots?: unknown }).fuel_hotspots;
  return Array.isArray(hotspots)
    ? hotspots.filter((item): item is Record<string, unknown> => typeof item === "object" && item !== null)
    : [];
}

function fuelHotspotMessage(hotspot: Record<string, unknown>): string {
  const language = typeof hotspot.language === "string" && hotspot.language ? hotspot.language : "unknown language";
  const method = typeof hotspot.function === "string" && hotspot.function ? hotspot.function : "plugin call";
  const consumed = typeof hotspot.fuel_consumed === "number" ? hotspot.fuel_consumed.toLocaleString("en-US") : "unknown";
  const filename = typeof hotspot.filename === "string" && hotspot.filename ? ` in ${hotspot.filename}` : "";
  return `Excessive ${language} ${method} fuel${filename}: ${consumed}`;
}

function decorationKind(change: SemanticChange): DecorationLike["kind"] {
  if (change.change_type === "ADDITION") {
    return "addition";
  }
  if (change.change_type === "MOVE" || change.change_type === "REORDER") {
    return "move";
  }
  if (change.change_type === "REFACTORING" || change.refactoring_kind) {
    return "refactoring";
  }
  if (change.change_type === "STYLE_ONLY") {
    return "style";
  }
  return "modification";
}

function isCommentChange(change: SemanticChange): boolean {
  return isCommentNode(change.old_node) || isCommentNode(change.new_node);
}

function isCommentNode(node: SemanticChange["old_node"]): boolean {
  const nodeType = node?.node_type?.toLowerCase() ?? "";
  return nodeType === "comment" || nodeType.endsWith("_comment") || nodeType.includes("comment");
}

export function isPresentationNoiseChange(change: SemanticChange): boolean {
  if (change.change_type !== "MODIFICATION" || !change.old_node || !change.new_node) {
    return false;
  }
  return sameSemanticContentIgnoringArrayIndex(change.old_node, change.new_node);
}

function sameSemanticContentIgnoringArrayIndex(
  oldNode: NonNullable<SemanticChange["old_node"]>,
  newNode: NonNullable<SemanticChange["new_node"]>,
): boolean {
  if (oldNode.node_type !== newNode.node_type) {
    return false;
  }
  if (!sameLabelIgnoringArrayIndex(oldNode.label, newNode.label)) {
    return false;
  }
  const oldChildren = oldNode.children ?? [];
  const newChildren = newNode.children ?? [];
  if (oldChildren.length !== newChildren.length) {
    return false;
  }
  return oldChildren.every((oldChild, index) => {
    const newChild = newChildren[index];
    return newChild ? sameSemanticContentIgnoringArrayIndex(oldChild, newChild) : false;
  });
}

function sameLabelIgnoringArrayIndex(oldLabel: string | undefined, newLabel: string | undefined): boolean {
  if (oldLabel === newLabel) {
    return true;
  }
  return isArrayIndexLabel(oldLabel) && isArrayIndexLabel(newLabel);
}

function isArrayIndexLabel(label: string | undefined): boolean {
  return label !== undefined && /^\[\d+\]$/u.test(label);
}

const COMPACT_WRAPPER_LANGUAGES = new Set(["javascript", "typescript", "tsx"]);
const COMPACT_WRAPPER_NODE_TYPES = new Set(["array", "statement_block"]);

function compactStructuralWrapperPosition(
  diff: SemanticDiff,
  change: SemanticChange,
  position: NodePosition,
): NodePosition {
  const language = diff.language?.toLowerCase() ?? "";
  const node = change.new_node ?? change.old_node ?? undefined;
  if (
    !COMPACT_WRAPPER_LANGUAGES.has(language)
    || !node
    || !COMPACT_WRAPPER_NODE_TYPES.has(node.node_type?.toLowerCase() ?? "")
    || (node.children?.length ?? 0) === 0
    || position.start_line === position.end_line
  ) {
    return position;
  }
  return {
    ...position,
    end_line: position.start_line,
    end_col: position.start_col + 1,
  };
}
