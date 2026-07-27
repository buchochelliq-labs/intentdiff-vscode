import type { DecorationLike, NodePosition, SemanticChange, SemanticDiff } from "./types";

export const SEMANTIC_BASE_SCHEME = "intentdiff-semantic-base";
export const SEMANTIC_MODIFIED_SCHEME = "intentdiff-semantic-modified";
export const SEMANTIC_EMPTY_MESSAGE = "IntentDiff: no semantic changes match the current filters.";
/**
 * @deprecated The gap row in the projection is now an empty line. The webview
 * renders the collapsed-gap affordance via a deltaDecoration. The token is
 * retained only so external consumers (tests, plugins) keep compiling.
 */
export const SEMANTIC_GAP_TOKEN = "IntentDiffGap:";

export type SemanticOnlySide = "base" | "modified";

export interface SemanticOnlyOptions {
  contextLines: number;
  showAdditions: boolean;
  showDeletions: boolean;
  showModifications: boolean;
  movedCode: boolean;
  hideComments: boolean;
}

export interface SemanticGapSide {
  /** 1-based projected (virtual document) line number of the gap row. */
  projectedLine?: number;
  omittedLineCount: number;
  originalStartLine?: number;
  originalEndLine?: number;
}

export interface SemanticDecoration {
  kind: "added" | "removed" | "changed" | "refactored" | "moved";
  /** 1-based projected line number. */
  line: number;
}

export interface SemanticDecorationPerSide {
  base: SemanticDecoration[];
  modified: SemanticDecoration[];
}

export type DecorationKind = "added" | "removed" | "changed" | "refactored" | "moved";

export interface SemanticChunkDecoration {
  kind: DecorationKind;
  side: "base" | "modified" | "both";
  /** 1-based projected line number (inclusive). */
  startProjected: number;
  /** 1-based projected line number (inclusive). */
  endProjected: number;
}

export interface SemanticGap {
  id: string;
  base?: SemanticGapSide;
  modified?: SemanticGapSide;
  /**
   * Kind of the chunk that ends immediately AFTER this gap. Used to colour
   * the gap row itself in the diff editor. Derived server-side from the
   * LATER chunk in {@link attachSemanticDecorations}.
   */
  trailingKind?: DecorationKind;
  /**
   * @deprecated Replaced by per-chunk `SemanticOnlyProjection.changes[i]` ranges
   * plus `SemanticGap.trailingKind`. Kept exported for backwards compatibility.
   */
  decorations?: SemanticDecorationPerSide;
}

export interface SemanticProjectionAnchors {
  base: { firstVisibleOriginalLine: number; lastVisibleOriginalLine: number };
  modified: { firstVisibleOriginalLine: number; lastVisibleOriginalLine: number };
}

export interface SemanticOnlyDocumentPair {
  baseText: string;
  modifiedText: string;
  projection: SemanticOnlyProjection;
  gaps: SemanticGap[];
  anchors: SemanticProjectionAnchors;
}

export interface SemanticOnlyProjection {
  baseLineMap: Map<number, number>;
  modifiedLineMap: Map<number, number>;
  baseOriginalLineMap: Map<number, number>;
  modifiedOriginalLineMap: Map<number, number>;
  changes: SemanticOnlyChangeProjection[];
  selectedChangeIndexes: number[];
}

export interface SemanticOnlyChangeProjection {
  changeIndex: number;
  base?: ProjectedRange;
  modified?: ProjectedRange;
  /**
   * 1-based projected line number of the LAST line in the chunk's window
   * (i.e. the projected position of the last line of context, not just the
   * change). Computed by the chunk-generation pass; used by the webview to
   * attach the LATER-chunk kind to the gap that follows the chunk.
   */
  baseWindowEnd?: number;
  modifiedWindowEnd?: number;
}

export interface ProjectedRange {
  original: NodePosition;
  projected: NodePosition;
  exact: boolean;
}

interface LineRange {
  start: number;
  end: number;
}

interface PendingChunk {
  oldRange?: LineRange;
  newRange?: LineRange;
  changeIndexes: number[];
}

interface GeneratedSide {
  text: string;
  lineMap: Map<number, number>;
  originalLineMap: Map<number, number>;
}

export function buildSemanticOnlyDocuments(
  oldText: string,
  newText: string,
  diff: SemanticDiff,
  options: SemanticOnlyOptions,
): SemanticOnlyDocumentPair {
  const oldLines = splitLines(oldText);
  const newLines = splitLines(newText);
  const selected = selectedChanges(diff, options);
  const chunks = semanticChunks(selected, oldLines.length, newLines.length, options.contextLines);

  const emptyAnchors: SemanticProjectionAnchors = {
    base: { firstVisibleOriginalLine: 0, lastVisibleOriginalLine: 0 },
    modified: { firstVisibleOriginalLine: 0, lastVisibleOriginalLine: 0 },
  };

  if (chunks.length === 0) {
    return {
      baseText: SEMANTIC_EMPTY_MESSAGE,
      modifiedText: SEMANTIC_EMPTY_MESSAGE,
      projection: {
        baseLineMap: new Map(),
        modifiedLineMap: new Map(),
        baseOriginalLineMap: new Map(),
        modifiedOriginalLineMap: new Map(),
        changes: [],
        selectedChangeIndexes: [],
      },
      gaps: [],
      anchors: emptyAnchors,
    };
  }

  const gaps = buildGapMetadata(chunks, oldLines.length, newLines.length);
  const base = generateSide(oldLines, chunks, "oldRange", gaps, "base");
  const modified = generateSide(newLines, chunks, "newRange", gaps, "modified");

  // For each chunk, compute the 1-based projected line of the last line in
  // its window on each side. The webview uses this to attach the LATER
  // chunk's kind to the gap that sits immediately after the chunk.
  const windowEnds = computeWindowEnds(chunks, base.originalLineMap, modified.originalLineMap);

  const projection: SemanticOnlyProjection = {
    baseLineMap: base.lineMap,
    modifiedLineMap: modified.lineMap,
    baseOriginalLineMap: base.originalLineMap,
    modifiedOriginalLineMap: modified.originalLineMap,
    changes: selected.map(({ change, index }) => ({
      changeIndex: index,
      base: projectPosition(change.old_node?.position ?? undefined, base.lineMap),
      modified: projectPosition(change.new_node?.position ?? undefined, modified.lineMap),
      baseWindowEnd: windowEnds[index]?.baseWindowEnd,
      modifiedWindowEnd: windowEnds[index]?.modifiedWindowEnd,
    })),
    selectedChangeIndexes: selected.map((item) => item.index),
  };

  return {
    baseText: base.text,
    modifiedText: modified.text,
    projection,
    gaps,
    anchors: {
      base: computeAnchors(base.lineMap),
      modified: computeAnchors(modified.lineMap),
    },
  };
}

export function selectedChanges(
  diff: SemanticDiff,
  options: SemanticOnlyOptions,
): Array<{ change: SemanticChange; index: number }> {
  return (diff.changes ?? [])
    .map((change, index) => ({ change, index }))
    .filter(({ change }) => isVisibleChange(change, options));
}

export function projectPosition(
  position: NodePosition | null | undefined,
  lineMap: Map<number, number>,
): ProjectedRange | undefined {
  if (!position) {
    return undefined;
  }
  const startLine = lineMap.get(position.start_line);
  const endLine = lineMap.get(position.end_line);
  if (startLine !== undefined && endLine !== undefined) {
    return {
      original: position,
      exact: true,
      projected: {
        ...position,
        start_line: startLine,
        end_line: endLine,
      },
    };
  }
  const nearest = nearestProjectedLine(position.start_line, lineMap);
  if (nearest === undefined) {
    return undefined;
  }
  return {
    original: position,
    exact: false,
    projected: {
      start_line: nearest.generatedLine,
      start_col: 0,
      end_line: nearest.generatedLine,
      end_col: 0,
    },
  };
}

export function projectDecorations(
  decorations: DecorationLike[],
  lineMap: Map<number, number>,
): DecorationLike[] {
  return decorations.flatMap((decoration) => {
    const projected = projectPosition(decoration.position, lineMap);
    if (!projected) {
      return [];
    }
    return [{
      ...decoration,
      position: projected.projected,
    }];
  });
}

function semanticChunks(
  selected: Array<{ change: SemanticChange; index: number }>,
  oldLineCount: number,
  newLineCount: number,
  contextLines: number,
): PendingChunk[] {
  const chunks: PendingChunk[] = [];
  for (const item of selected) {
    const oldRange = windowForPosition(item.change.old_node?.position, oldLineCount, contextLines);
    const newRange = windowForPosition(item.change.new_node?.position, newLineCount, contextLines);
    if (!oldRange && !newRange) {
      continue;
    }
    const last = chunks[chunks.length - 1];
    if (last && shouldMergeChunks(last, oldRange, newRange)) {
      last.oldRange = mergeRanges(last.oldRange, oldRange);
      last.newRange = mergeRanges(last.newRange, newRange);
      last.changeIndexes.push(item.index);
      continue;
    }
    chunks.push({
      oldRange,
      newRange,
      changeIndexes: [item.index],
    });
  }
  return chunks;
}

function generateSide(
  originalLines: string[],
  chunks: PendingChunk[],
  key: "oldRange" | "newRange",
  gaps: SemanticGap[],
  side: "base" | "modified",
): GeneratedSide {
  const output: string[] = [];
  const lineMap = new Map<number, number>();
  const originalLineMap = new Map<number, number>();

  for (const [index, chunk] of chunks.entries()) {
    if (index > 0) {
      const gap = gaps[index - 1];
      const gapSide = side === "base" ? gap.base : gap.modified;
      // The gap row is intentionally an empty line so Monaco's diff engine does
      // not paint a fake insert/delete highlight on it; the webview renders the
      // collapsed-gap affordance via a deltaDecoration (.intentdiff-gap-line)
      // and a centred chevron overlay. We still record the 1-based projected
      // line of the gap row so the chevron, the gap tint, and the
      // reconstruction algorithm can locate it.
      const projectedLineNumber = output.length + 1;
      output.push("");
      if (gapSide) {
        gapSide.projectedLine = projectedLineNumber;
      } else {
        const newSide: SemanticGapSide = { omittedLineCount: 0, projectedLine: projectedLineNumber };
        if (side === "base") {
          gap.base = newSide;
        } else {
          gap.modified = newSide;
        }
      }
    }

    const range = chunk[key];
    if (!range) {
      continue;
    }
    for (let line = range.start; line <= range.end; line += 1) {
      lineMap.set(line, output.length);
      originalLineMap.set(output.length, line);
      output.push(originalLines[line] ?? "");
    }
  }

  return {
    text: output.join("\n"),
    lineMap,
    originalLineMap,
  };
}

function buildGapMetadata(
  chunks: PendingChunk[],
  oldLineCount: number,
  newLineCount: number,
): SemanticGap[] {
  const gaps: SemanticGap[] = [];
  for (let idx = 1; idx < chunks.length; idx += 1) {
    const prev = chunks[idx - 1];
    const next = chunks[idx];
    const id = String(idx);
    const baseSide = buildGapSide(prev.oldRange, next.oldRange, oldLineCount, id);
    const modifiedSide = buildGapSide(prev.newRange, next.newRange, newLineCount, id);
    gaps.push({ id, base: baseSide, modified: modifiedSide });
  }
  return gaps;
}

function buildGapSide(
  previous: LineRange | undefined,
  next: LineRange | undefined,
  maxLines: number,
  id: string,
): SemanticGapSide {
  const range = gapOriginalRange(previous, next, maxLines);
  const omittedLineCount = range ? Math.max(0, range.end - range.start + 1) : 0;
  return {
    omittedLineCount,
    originalStartLine: range?.start,
    originalEndLine: range?.end,
  };
}

function gapOriginalRange(
  previous: LineRange | undefined,
  next: LineRange | undefined,
  maxLines: number,
): { start: number; end: number } | undefined {
  if (!previous || !next) {
    return undefined;
  }
  const start = clamp(previous.end + 1, 0, Math.max(0, maxLines - 1));
  const end = clamp(next.start - 1, 0, Math.max(0, maxLines - 1));
  if (end < start) {
    return undefined;
  }
  return { start, end };
}

function computeAnchors(lineMap: Map<number, number>): { firstVisibleOriginalLine: number; lastVisibleOriginalLine: number } {
  if (lineMap.size === 0) {
    return { firstVisibleOriginalLine: 0, lastVisibleOriginalLine: 0 };
  }
  let first = Infinity;
  let last = -Infinity;
  for (const origLine of lineMap.keys()) {
    if (origLine < first) { first = origLine; }
    if (origLine > last) { last = origLine; }
  }
  return {
    firstVisibleOriginalLine: first === Infinity ? 0 : first,
    lastVisibleOriginalLine: last === -Infinity ? 0 : last,
  };
}

function windowForPosition(
  position: NodePosition | null | undefined,
  lineCount: number,
  contextLines: number,
): LineRange | undefined {
  if (!position || lineCount <= 0) {
    return undefined;
  }
  const maxLine = lineCount - 1;
  const startLine = clamp(position.start_line, 0, maxLine);
  const endLine = clamp(Math.max(position.end_line, position.start_line), 0, maxLine);
  return {
    start: clamp(startLine - contextLines, 0, maxLine),
    end: clamp(endLine + contextLines, 0, maxLine),
  };
}

function shouldMergeChunks(
  previous: PendingChunk,
  oldRange: LineRange | undefined,
  newRange: LineRange | undefined,
): boolean {
  return rangesTouch(previous.oldRange, oldRange) || rangesTouch(previous.newRange, newRange);
}

function rangesTouch(left: LineRange | undefined, right: LineRange | undefined): boolean {
  if (!left || !right) {
    return false;
  }
  return right.start <= left.end + 1;
}

function mergeRanges(left: LineRange | undefined, right: LineRange | undefined): LineRange | undefined {
  if (!left) {
    return right;
  }
  if (!right) {
    return left;
  }
  return {
    start: Math.min(left.start, right.start),
    end: Math.max(left.end, right.end),
  };
}

function isVisibleChange(change: SemanticChange, options: SemanticOnlyOptions): boolean {
  if (options.hideComments && isCommentChange(change)) {
    return false;
  }
  if (change.change_type === "ADDITION") {
    return options.showAdditions;
  }
  if (change.change_type === "DELETION") {
    return options.showDeletions;
  }
  if (isMoveOrRefactoring(change)) {
    return options.movedCode;
  }
  return options.showModifications;
}

function isMoveOrRefactoring(change: SemanticChange): boolean {
  return change.change_type === "MOVE"
    || change.change_type === "REORDER"
    || change.change_type === "REFACTORING"
    || Boolean(change.refactoring_kind);
}

function isCommentChange(change: SemanticChange): boolean {
  return isCommentNode(change.old_node) || isCommentNode(change.new_node);
}

function isCommentNode(node: SemanticChange["old_node"]): boolean {
  const nodeType = node?.node_type?.toLowerCase() ?? "";
  return nodeType === "comment" || nodeType.endsWith("_comment") || nodeType.includes("comment");
}

function nearestProjectedLine(
  originalLine: number,
  lineMap: Map<number, number>,
): { originalLine: number; generatedLine: number } | undefined {
  let best: { originalLine: number; generatedLine: number } | undefined;
  for (const [mappedOriginalLine, generatedLine] of lineMap.entries()) {
    if (
      !best
      || Math.abs(mappedOriginalLine - originalLine) < Math.abs(best.originalLine - originalLine)
    ) {
      best = { originalLine: mappedOriginalLine, generatedLine };
    }
  }
  return best;
}

function splitLines(text: string): string[] {
  if (text.length === 0) {
    return [];
  }
  return text.split(/\r?\n/u);
}

/**
 * For each chunk, compute the 1-based projected line of the LAST line in its
 * window (the projected end of the last context line). Returns a list
 * indexed in chunk order (parallel to the `chunks` array). The caller pairs
 * this with the `selected` list, but since chunk indices and change indices
 * are 1:1, we return by change index.
 */
function computeWindowEnds(
  chunks: PendingChunk[],
  baseOriginalLineMap: Map<number, number>,
  modifiedOriginalLineMap: Map<number, number>,
): { baseWindowEnd: number | undefined; modifiedWindowEnd: number | undefined }[] {
  return chunks.map((chunk) => {
    const baseEnd = chunk.oldRange ? baseOriginalLineMap.get(chunk.oldRange.end) : undefined;
    const modEnd  = chunk.newRange ? modifiedOriginalLineMap.get(chunk.newRange.end) : undefined;
    return {
      baseWindowEnd: baseEnd != null ? baseEnd + 1 : undefined,
      modifiedWindowEnd: modEnd != null ? modEnd + 1 : undefined,
    };
  });
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}
