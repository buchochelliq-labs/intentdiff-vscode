import type { NodePosition } from "./types";

export interface TextDocumentLineLike {
  text: string;
}

export interface TextDocumentLike {
  lineCount: number;
  lineAt(line: number): TextDocumentLineLike;
}

export interface DocumentSelectionTarget {
  position: NodePosition;
  shouldSelect: boolean;
  exact: boolean;
}

export function selectionTargetForDocument(
  position: NodePosition,
  document: TextDocumentLike,
): DocumentSelectionTarget {
  const lastLine = Math.max(document.lineCount - 1, 0);
  const startLine = clamp(position.start_line, 0, lastLine);
  const startCol = clamp(position.start_col, 0, lineLength(document, startLine));
  const exact = isDocumentPosition(position.start_line, position.start_col, document)
    && isDocumentPosition(position.end_line, position.end_col, document)
    && isOrderedRange(position);

  if (!exact) {
    return {
      position: pointPosition(startLine, startCol),
      shouldSelect: false,
      exact: false,
    };
  }

  return {
    position,
    shouldSelect: !isEmptyRange(position),
    exact: true,
  };
}

function isDocumentPosition(line: number, col: number, document: TextDocumentLike): boolean {
  return line >= 0
    && line < document.lineCount
    && col >= 0
    && col <= lineLength(document, line);
}

function lineLength(document: TextDocumentLike, line: number): number {
  if (line < 0 || line >= document.lineCount) {
    return 0;
  }
  return document.lineAt(line).text.length;
}

function isOrderedRange(position: NodePosition): boolean {
  return (position.end_line > position.start_line)
    || (position.end_line === position.start_line && position.end_col >= position.start_col);
}

function isEmptyRange(position: NodePosition): boolean {
  return position.start_line === position.end_line && position.start_col === position.end_col;
}

function pointPosition(line: number, col: number): NodePosition {
  return {
    start_line: line,
    start_col: col,
    end_line: line,
    end_col: col,
  };
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}
