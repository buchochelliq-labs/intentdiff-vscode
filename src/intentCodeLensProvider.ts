import * as vscode from "vscode";
import {
  buildIntentLenses,
  categoryForContent,
  intentForLine,
  type IntentCategory,
  type IntentLens,
  type IntentLensContext,
  type IntentSide,
} from "./intentCodeLens";
import { contentClassForDiff } from "./contentClass";
import { explainChange, explainGroup, extractFacts, type IntentExplanation } from "./intentExplain";
import type { IntentLlmExplainer } from "./intentLlmExplainer";
import type { IntentExplainInput } from "./intentLlmPrompt";
import type { NodePosition, SemanticChange, SemanticDiff } from "./types";

function commandUri(command: string, args: unknown[]): string {
  return `command:${command}?${encodeURIComponent(JSON.stringify(args))}`;
}

function stripCode(text: string): string {
  return text.replace(/`/gu, "");
}

/** " · Behavior" / " · Internal" for code; nothing for non-code content (the label says it). */
function riskSuffix(category: IntentCategory): string {
  if (category.risk === "behavior") {
    return " · Behavior";
  }
  if (category.risk === "internal") {
    return " · Internal";
  }
  return "";
}

/**
 * Resolve a lens (or a fallback groupIndex) to its natural-language explanation.
 * Positive groupIndex → a change group; negative → the raw change at
 * `-(groupIndex) - 1` (the no-groups fallback path).
 */
function explanationFor(diff: SemanticDiff, groupIndex: number): IntentExplanation | undefined {
  const contentClass = contentClassForDiff(diff);
  if (groupIndex >= 0) {
    const group = (diff.change_groups ?? [])[groupIndex];
    return group ? explainGroup(group, diff.changes ?? [], contentClass) : undefined;
  }
  const change = (diff.changes ?? [])[-groupIndex - 1];
  return change ? explainChange(change, undefined, contentClass) : undefined;
}

/** Intent lenses with each category adjusted for the file's content class (non-code → Docs/Config/…). */
function contentAwareLenses(diff: SemanticDiff, side: IntentSide): IntentLens[] {
  const contentClass = contentClassForDiff(diff);
  return buildIntentLenses(diff, side).map((lens) => ({
    ...lens,
    category: categoryForContent(lens.category, contentClass),
  }));
}

/** The representative change behind a lens/hover (for LLM before/after context). */
function changeFor(diff: SemanticDiff, groupIndex: number): SemanticChange | undefined {
  if (groupIndex >= 0) {
    const group = (diff.change_groups ?? [])[groupIndex];
    const index = group?.raw_change_indices?.[0];
    return index !== undefined ? (diff.changes ?? [])[index] : undefined;
  }
  return (diff.changes ?? [])[-groupIndex - 1];
}

/**
 * Slice the actual source of a changed node out of the open document (its
 * `position` follows the 0-based `toRange` convention), so the LLM sees real
 * code — e.g. a function body — rather than just its name. `undefined` when the
 * position is missing or out of range.
 */
function sliceCode(document: vscode.TextDocument, position: NodePosition | null | undefined): string | undefined {
  if (!position) {
    return undefined;
  }
  const start = Math.max(0, position.start_line);
  const end = Math.min(document.lineCount - 1, position.end_line);
  if (start > end) {
    return undefined;
  }
  const range = new vscode.Range(start, 0, end, document.lineAt(end).range.end.character);
  const text = document.getText(range);
  return text.trim().length > 0 ? text : undefined;
}

/** Real removed/added code for the hovered side, falling back to node labels. */
function codeContextFor(
  document: vscode.TextDocument,
  change: SemanticChange | undefined,
  side: IntentSide,
): { before?: string; after?: string } {
  if (!change) {
    return {};
  }
  // The open document is the hovered side; we can only slice that side's real text.
  if (side === "base") {
    return {
      before: sliceCode(document, change.old_node?.position) ?? change.old_node?.label ?? undefined,
      after: change.new_node?.label ?? undefined,
    };
  }
  return {
    before: change.old_node?.label ?? undefined,
    after: sliceCode(document, change.new_node?.position) ?? change.new_node?.label ?? undefined,
  };
}

function llmInputFor(
  diff: SemanticDiff,
  category: string,
  risk: "behavior" | "internal",
  explanation: IntentExplanation,
  groupIndex: number,
  language: string | undefined,
  document: vscode.TextDocument,
  side: IntentSide,
): IntentExplainInput {
  const change = changeFor(diff, groupIndex);
  const group = groupIndex >= 0 ? (diff.change_groups ?? [])[groupIndex] : undefined;
  const facts = change ? extractFacts(change, group) : { changeType: "MODIFICATION" };
  // The verbatim slice is assembled locally but only transmitted at the "full"
  // level (which the explainer restricts to local endpoints); the default payload
  // is the non-verbatim fact sheet built from `facts`.
  const code = codeContextFor(document, change, side);
  return {
    category,
    risk,
    what: explanation.what,
    language,
    scope: facts.scopeName,
    facts,
    code,
  };
}

/** Concise CodeLens title: `$(icon) Category · Added function ccc`. */
function lensTitle(lens: IntentLens, explanation: IntentExplanation | undefined): string {
  const risk = riskSuffix(lens.category);
  const what = explanation ? stripCode(explanation.what) : lens.why;
  return `$(${lens.category.icon}) ${lens.category.label}${risk} · ${what}`;
}

/**
 * Inline intent hints: a subtle "‹ Category ›" inlay at the end of each intent
 * line (shown categories only — meaningful/refactor/moved), so intent reads
 * inline without opening anything.
 */
export class IntentInlayHintsProvider implements vscode.InlayHintsProvider {
  private readonly changeEmitter = new vscode.EventEmitter<void>();
  readonly onDidChangeInlayHints = this.changeEmitter.event;

  constructor(private readonly lookup: (uri: vscode.Uri) => IntentLensContext | undefined) {}

  refresh(): void {
    this.changeEmitter.fire();
  }

  dispose(): void {
    this.changeEmitter.dispose();
  }

  provideInlayHints(document: vscode.TextDocument, range: vscode.Range): vscode.InlayHint[] {
    const context = this.lookup(document.uri);
    if (!context || !context.diff || context.mode !== "full") {
      return [];
    }
    const hints: vscode.InlayHint[] = [];
    for (const lens of contentAwareLenses(context.diff, context.side)) {
      if (lens.line < range.start.line || lens.line > range.end.line || lens.line >= document.lineCount) {
        continue;
      }
      const position = document.lineAt(lens.line).range.end;
      const hint = new vscode.InlayHint(position, ` ‹ ${lens.category.label} ›`, vscode.InlayHintKind.Type);
      hint.paddingLeft = true;
      const explanation = explanationFor(context.diff, lens.groupIndex);
      const tooltip = new vscode.MarkdownString(undefined, true);
      const risk = riskSuffix(lens.category);
      tooltip.appendMarkdown(`$(${lens.category.icon}) **${lens.category.label}**${risk}\n\n`);
      tooltip.appendMarkdown(explanation ? `${explanation.what} — ${explanation.why}` : lens.why);
      hint.tooltip = tooltip;
      hints.push(hint);
    }
    return hints;
  }
}

/**
 * Rich intent hover: hovering any changed line in the native diff shows the
 * category, derived risk, plain-English why, and quick actions (Peek, open the
 * review panel). Reuses the pure `intentForLine` matcher.
 */
export class IntentHoverProvider implements vscode.HoverProvider {
  constructor(
    private readonly lookup: (uri: vscode.Uri) => IntentLensContext | undefined,
    private readonly llm?: IntentLlmExplainer,
  ) {}

  provideHover(document: vscode.TextDocument, position: vscode.Position, token: vscode.CancellationToken): vscode.Hover | undefined {
    const context = this.lookup(document.uri);
    if (!context || !context.diff || context.mode !== "full") {
      return undefined;
    }
    const intent = intentForLine(context.diff, context.side, position.line);
    if (!intent) {
      return undefined;
    }
    const explanation = explanationFor(context.diff, intent.groupIndex);
    const category = categoryForContent(intent.category, contentClassForDiff(context.diff));
    const md = new vscode.MarkdownString(undefined, true);
    md.isTrusted = true;
    const risk = riskSuffix(category);
    md.appendMarkdown(`$(${category.icon}) **IntentumDiff — ${category.label}**${risk}\n\n`);
    // What changed (bold) + why it matters.
    md.appendMarkdown(`**${explanation?.what ?? intent.why}**\n\n`);
    // Prefer a cached LLM explanation; otherwise show deterministic + populate the
    // cache in the background so a re-hover shows the AI explanation (non-blocking).
    // Only code "behavior" changes are enriched (bounds cost; skips non-code).
    let why = explanation?.why ?? "";
    if (this.llm && explanation && category.risk === "behavior") {
      const input = llmInputFor(context.diff, category.label, category.risk, explanation, intent.groupIndex, context.diff.language, document, context.side);
      const cached = this.llm.peekCache(input);
      if (cached) {
        why = cached;
        md.appendMarkdown("$(sparkle) ");
      } else if (this.llm.isEnabled()) {
        void this.llm.explain(input, token);
      }
    }
    if (why) {
      md.appendMarkdown(`${why}\n\n`);
    }
    const peekArgs = [{
      folderUri: context.folderUri,
      relativePath: context.relativePath,
      side: context.side,
      line: position.line,
      groupIndex: intent.groupIndex,
    }];
    const panelArgs = [{ folderUri: context.folderUri, relativePath: context.relativePath }];
    md.appendMarkdown(
      `[$(search) Peek before/after](${commandUri("intentumdiff.peekIntent", peekArgs)})`
      + ` · [$(list-tree) Open review panel](${commandUri("intentumdiff.openReviewPanel", panelArgs)})`,
    );
    return new vscode.Hover(md);
  }
}

/**
 * Lightbulb code actions on changed lines in the native diff: Explain intent,
 * Open review panel, Stage/Revert file. (Per-hunk stage/revert from native needs
 * a reconstructed hunk payload and lives in the review panel for now.)
 */
export class IntentCodeActionProvider implements vscode.CodeActionProvider {
  static readonly kinds = [vscode.CodeActionKind.QuickFix];

  constructor(private readonly lookup: (uri: vscode.Uri) => IntentLensContext | undefined) {}

  provideCodeActions(document: vscode.TextDocument, range: vscode.Range | vscode.Selection): vscode.CodeAction[] {
    const context = this.lookup(document.uri);
    if (!context || !context.diff || context.mode !== "full") {
      return [];
    }
    const intent = intentForLine(context.diff, context.side, range.start.line);
    if (!intent) {
      return [];
    }
    const file = { folderUri: context.folderUri, relativePath: context.relativePath };
    const action = (title: string, command: string, args: unknown[]): vscode.CodeAction => {
      const codeAction = new vscode.CodeAction(title, vscode.CodeActionKind.QuickFix);
      codeAction.command = { command, title, arguments: args };
      return codeAction;
    };
    return [
      action(
        `IntentumDiff: Explain intent (${intent.category.label})`,
        "intentumdiff.peekIntent",
        [{ ...file, side: context.side, line: range.start.line, groupIndex: intent.groupIndex }],
      ),
      action("IntentumDiff: Open review panel", "intentumdiff.openReviewPanel", [file]),
      action("IntentumDiff: Stage file", "intentumdiff.reviewPanel.stageFile", [file]),
      action("IntentumDiff: Revert file", "intentumdiff.reviewPanel.revertFile", [file]),
    ];
  }
}

/**
 * CodeLens provider that renders the intent lens above each changed hunk in the
 * native diff editor. Pure lens logic lives in intentCodeLens.ts; this shell
 * only adapts it to the vscode CodeLens API.
 */
export class IntentCodeLensProvider implements vscode.CodeLensProvider {
  private readonly changeEmitter = new vscode.EventEmitter<void>();
  readonly onDidChangeCodeLenses = this.changeEmitter.event;

  constructor(private readonly lookup: (uri: vscode.Uri) => IntentLensContext | undefined) {}

  refresh(): void {
    this.changeEmitter.fire();
  }

  dispose(): void {
    this.changeEmitter.dispose();
  }

  provideCodeLenses(document: vscode.TextDocument): vscode.CodeLens[] {
    const context = this.lookup(document.uri);
    // Semantic-only mode reprojects line numbers; intent lenses target the full
    // native diff where positions map 1:1.
    if (!context || !context.diff || context.mode !== "full") {
      return [];
    }
    const diff = context.diff;
    return contentAwareLenses(diff, context.side).map((lens) => {
      const range = new vscode.Range(lens.line, 0, lens.line, 0);
      const explanation = explanationFor(diff, lens.groupIndex);
      return new vscode.CodeLens(range, {
        title: lensTitle(lens, explanation),
        tooltip: explanation ? `${stripCode(explanation.what)} — ${explanation.why}` : `${lens.category.label} — Peek intent`,
        command: "intentumdiff.peekIntent",
        arguments: [{
          folderUri: context.folderUri,
          relativePath: context.relativePath,
          side: lens.side,
          line: lens.line,
          groupIndex: lens.groupIndex,
        }],
      });
    });
  }
}
