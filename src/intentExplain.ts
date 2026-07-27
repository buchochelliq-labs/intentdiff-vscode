import { kindForChange, riskForContent, type IntentRisk } from "./intentCodeLens";
import { contentNoun, type ContentClass } from "./contentClass";
import type { IntentFacts } from "./intentLlmPrompt";
import { RETURN_KIND_WORD } from "./intentLlmPrompt";
import type { ChangeGroup, NodeFacts, SemanticChange, SemanticNode } from "./types";

/**
 * Natural-language intent explanations ("what changed + why it matters").
 *
 * The engine's per-change `description` is terse/mechanical
 * (e.g. `Insert -> function_definition('ccc')`). This module composes a readable
 * sentence from the structured change/group data — deterministic, offline, and
 * unit-testable (vscode-free). Strings are built from parts (verb / subject /
 * location / impact) so `vscode.l10n` internationalisation is feasible later.
 *
 * Richer sources are noted as future upgrades: (a) engine-emitted meaningful
 * explanations, (b) an optional LLM explainer. For style/noise the engine's
 * invariance `reason`/`explanation` (when present on group metadata) is preferred.
 */

export interface IntentExplanation {
  /** What changed, e.g. "Added function `ccc`" (may contain markdown backticks). */
  what: string;
  /** Why it matters / the impact, e.g. "May change runtime behavior." */
  why: string;
  risk?: IntentRisk;
}

const NODE_TYPE_NOUNS: Record<string, string> = {
  function_definition: "function",
  function_declaration: "function",
  method_definition: "method",
  method_declaration: "method",
  class_definition: "class",
  class_declaration: "class",
  interface_declaration: "interface",
  variable_declaration: "variable",
  assignment: "assignment",
  import_statement: "import",
  export_statement: "export",
  decorator: "decorator",
  parameter: "parameter",
  property: "property",
  // Rust
  function_item: "function",
  struct_item: "struct",
  enum_item: "enum",
  trait_item: "trait",
  impl_item: "impl block",
  mod_item: "module",
  const_item: "constant",
  static_item: "static",
  type_item: "type",
  // Go
  type_declaration: "type",
  type_spec: "type",
  // C / C++
  struct_specifier: "struct",
  class_specifier: "class",
  enum_specifier: "enum",
  union_specifier: "union",
  namespace_definition: "namespace",
  // Common others
  constructor_declaration: "constructor",
  constructor_definition: "constructor",
  field_declaration: "field",
  enum_declaration: "enum",
  struct_declaration: "struct",
};

function friendlyType(node: SemanticNode | null | undefined): string {
  const type = node?.node_type?.toLowerCase() ?? "";
  if (NODE_TYPE_NOUNS[type]) {
    return NODE_TYPE_NOUNS[type];
  }
  if (type.includes("comment")) {
    return "comment";
  }
  return "";
}

function code(text: string): string {
  return `\`${text.trim()}\``;
}

/** "function `ccc`" / "method `charge` on `Invoice`" / "`ccc`" / "code". */
function subject(node: SemanticNode | null | undefined): string {
  const label = node?.label?.trim();
  const noun = friendlyType(node);
  const owner = node?.parent_type?.trim();
  const ownerSuffix = owner && noun === "method" ? ` on ${code(owner)}` : "";
  if (label && noun) {
    return `${noun} ${code(label)}${ownerSuffix}`;
  }
  if (label) {
    return code(label);
  }
  if (noun) {
    return `a ${noun}`;
  }
  return "code";
}

/** Innermost human scope name from `change_groups[].metadata.scope_trail`, e.g. "greet". */
function scopeInnermost(group: ChangeGroup | undefined): string | undefined {
  const trail = group?.metadata?.scope_trail;
  if (!Array.isArray(trail)) {
    return undefined;
  }
  const names = trail
    .filter((entry): entry is string => typeof entry === "string")
    .map((entry) => entry.replace(/^(module|package|namespace|class|function|method|def)\s+/iu, "").trim())
    .filter((name) => name.length > 0);
  return names[names.length - 1] || undefined;
}

/** " in `scope`" location suffix, or "" when there is no scope trail. */
function scopeSuffix(group: ChangeGroup | undefined): string {
  const innermost = scopeInnermost(group);
  return innermost ? ` in ${code(innermost)}` : "";
}

function humanizeConstant(value: string): string {
  return value.replace(/[_-]+/gu, " ").toLowerCase().replace(/^\w/u, (c) => c.toUpperCase());
}

function hasLabel(node: SemanticNode | null | undefined): boolean {
  return Boolean(node?.label?.trim());
}

const CHANGE_VERB: Record<string, string> = {
  ADDITION: "Added",
  DELETION: "Removed",
  MOVE: "Moved",
  REORDER: "Reordered",
  MODIFICATION: "Modified",
};

/**
 * The "what" sentence for a change (within its group when known). Prefers a
 * composed "verb + subject (+ location)" when a symbol label exists; otherwise
 * falls back to the engine's `description`, then a generic verb.
 */
/** Human review wording for .gitignore rule changes (issue #58): verb from
 *  change_type × node_type, kind noted from the pattern shape. Pure. */
export function gitignoreWhat(change: SemanticChange): string | undefined {
  const node = change.change_type === "DELETION" ? change.old_node : (change.new_node ?? change.old_node);
  const nodeType = node?.node_type;
  if (nodeType !== "pattern" && nodeType !== "negated_pattern") {
    return undefined;
  }
  const pattern = (node?.label ?? "").trim();
  if (!pattern) {
    return undefined;
  }
  const bare = pattern.replace(/^!/u, "");
  const kind = bare.endsWith("/")
    ? " directory"
    : /^\*\.[^/*]+$/u.test(bare)
      ? " extension"
      : /[*?\[]/u.test(bare)
        ? " glob"
        : "";
  if (nodeType === "negated_pattern") {
    if (change.change_type === "DELETION") {
      return `Removes the exception for ${code(bare)} — it is ignored again`;
    }
    return `Adds an exception: ${code(bare)} is no longer ignored`;
  }
  switch (change.change_type) {
    case "ADDITION":
      return `Adds an ignore rule for ${code(bare)}${kind ? ` (${kind.trim()})` : ""}`;
    case "DELETION":
      return `Stops ignoring ${code(bare)} — matching files become tracked again`;
    case "MODIFICATION":
      return `Changes an ignore rule to ${code(bare)}`;
    default:
      return undefined;
  }
}

export function whatForChange(change: SemanticChange, group?: ChangeGroup): string {
  const oldNode = change.old_node ?? null;
  const newNode = change.new_node ?? null;
  const location = scopeSuffix(group);
  const ignoreWording = gitignoreWhat(change);
  if (ignoreWording) {
    return `${ignoreWording}${location}`;
  }
  const description = change.description?.trim();
  const refactoringKind = (change.refactoring_kind ?? group?.refactoring_kind ?? "").toUpperCase();
  const isRefactoring = Boolean(refactoringKind) || change.change_type === "REFACTORING" || group?.kind === "REFACTORING";

  if (isRefactoring) {
    const oldLabel = oldNode?.label?.trim();
    const newLabel = newNode?.label?.trim();
    if (refactoringKind.includes("RENAME") && oldLabel && newLabel) {
      return `Renamed ${code(oldLabel)} → ${code(newLabel)}${location}`;
    }
    if (refactoringKind.includes("EXTRACT") && newLabel) {
      return `Extracted ${subject(newNode)}${location}`;
    }
    if (hasLabel(newNode ?? oldNode)) {
      const verb = refactoringKind ? humanizeConstant(refactoringKind) : "Refactored";
      return `${verb} ${subject(newNode ?? oldNode)}${location}`;
    }
    if (refactoringKind) {
      return `${humanizeConstant(refactoringKind)}${location}`;
    }
    return description || `Refactored ${subject(newNode ?? oldNode)}${location}`;
  }

  if (change.change_type === "STYLE_ONLY") {
    return `Formatting change${location}`;
  }
  const relevant = change.change_type === "DELETION" ? oldNode : (newNode ?? oldNode);
  const verb = CHANGE_VERB[change.change_type] ?? "Modified";
  if (hasLabel(relevant)) {
    return `${verb} ${subject(relevant)}${location}`;
  }
  return description || `${verb} ${subject(relevant)}${location}`;
}

/**
 * Reconstruct the before/after value from a `[-old][+new]` char-diff. Pure;
 * returns `undefined` unless both sides carry a short, meaningful delta.
 */
export function valueParts(textDiff: string | null | undefined): { before: string; after: string } | undefined {
  if (!textDiff || textDiff.length > 200 || textDiff.includes("\n") || textDiff.includes("token-level fallback")) {
    return undefined;
  }
  if (!/\[-[^\]]*\]/u.test(textDiff) && !/\[\+[^\]]*\]/u.test(textDiff)) {
    return undefined;
  }
  const before = textDiff.replace(/\[\+[^\]]*\]/gu, "").replace(/\[-([^\]]*)\]/gu, "$1").trim();
  const after = textDiff.replace(/\[-[^\]]*\]/gu, "").replace(/\[\+([^\]]*)\]/gu, "$1").trim();
  if (!before || !after || before === after || before.length > 60 || after.length > 60) {
    return undefined;
  }
  return { before, after };
}

/** `` `old` → `new` `` rendering of {@link valueParts}. */
export function valueChange(textDiff: string | null | undefined): string | undefined {
  const parts = valueParts(textDiff);
  return parts ? `${code(parts.before)} → ${code(parts.after)}` : undefined;
}

const NODE_TYPE_IMPACTS: Array<[RegExp, string]> = [
  [/return|yield/u, "changes the returned value"],
  [/param|argument|signature/u, "changes the call signature"],
  [/\bif|cond|ternary|switch|case|when|guard/u, "changes control flow — a different branch may run"],
  [/import|require|include|using|use_declaration/u, "changes a dependency"],
  [/raise|throw|except|catch|\btry\b|finally|error/u, "changes error handling"],
  [/for|while|loop|comprehension|iterat/u, "changes iteration"],
  [/decorator|annotation/u, "changes how it's wrapped"],
  [/class|extends|superclass|base|inherit|implements/u, "changes the type or hierarchy"],
  [/call|invocation|arguments/u, "changes a call"],
  [/assign|variable|binding|declarat/u, "reassigns a value"],
  [/string|number|integer|float|boolean|literal|constant/u, "changes a literal value"],
];

/** Role-based impact clause from a node type, e.g. "changes the returned value". */
export function impactForNodeType(nodeType: string | null | undefined): string | undefined {
  const type = (nodeType ?? "").toLowerCase();
  if (!type) {
    return undefined;
  }
  for (const [pattern, clause] of NODE_TYPE_IMPACTS) {
    if (pattern.test(type)) {
      return clause;
    }
  }
  return undefined;
}

function capitalize(text: string): string {
  return text.replace(/^\w/u, (c) => c.toUpperCase());
}

// --- Deeper, gated signal (each helper returns undefined rather than guess) -------------

/** Number of source lines a node spans (≥1), or undefined without a position. */
export function lineSpan(node: SemanticNode | null | undefined): number | undefined {
  const pos = node?.position;
  if (!pos) {
    return undefined;
  }
  const span = pos.end_line - pos.start_line + 1;
  return span >= 1 ? span : 1;
}

// A parameter-*list* wrapper node (Python `parameters`, JS/Java `formal_parameters`,
// Go/C# `parameter_list`, C/C++ `parameter_declaration_clause`) — distinct from an
// individual `parameter` node.
const PARAM_LIST_RE = /^(parameters|formal_parameters|formal_parameter_list|parameter_list|parameter_declaration_clause)$/iu;
const PARAM_RE = /param/iu;
const PUNCT_RE = /^[(),:;]+$/u;

/**
 * Best-effort parameter count from the child subtree, or undefined when unsure.
 * A params-list wrapper is authoritative even when empty (`()` → 0); only when no
 * list wrapper exists do we fall back to counting individual `parameter` nodes.
 * Never counts the empty wrapper itself (the bug behind "takes a single parameter").
 */
export function arity(node: SemanticNode | null | undefined): number | undefined {
  const children = node?.children;
  if (!Array.isArray(children) || children.length === 0) {
    return undefined;
  }
  const wrapper = children.find((child) => PARAM_LIST_RE.test(child.node_type ?? ""));
  if (wrapper) {
    return (wrapper.children ?? []).filter((param) => {
      const type = param.node_type ?? "";
      return type.length > 0 && !PUNCT_RE.test(type);
    }).length;
  }
  // No list wrapper: count individual params flattened onto the function node.
  const direct = children.filter((child) => PARAM_RE.test(child.node_type ?? ""));
  return direct.length > 0 ? direct.length : undefined;
}

/** LSP-resolved type string when present (never faked; null/absent → undefined). */
export function typeInfo(node: SemanticNode | null | undefined): string | undefined {
  const value = node?.type_info;
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;
}

export type Visibility = "internal" | "dunder" | "constant";

/** Visibility inferred from a naming convention, or undefined when it looks public/ordinary. */
export function visibility(label: string | null | undefined): Visibility | undefined {
  const name = (label ?? "").trim();
  if (!name) {
    return undefined;
  }
  if (/^__.+__$/u.test(name)) {
    return "dunder";
  }
  if (/^_/u.test(name)) {
    return "internal";
  }
  if (name.length > 1 && /^[A-Z0-9_]+$/u.test(name) && /[A-Z]/u.test(name)) {
    return "constant";
  }
  return undefined;
}

const FUNCTIONISH_RE = /function|method|def|constructor|lambda|arrow/iu;
const BLOCK_RE = /block|body|suite/iu;
const STUB_STMT_RE = /pass|ellipsis/iu;
const NOT_IMPLEMENTED_RE = /not[_ ]?implemented/iu;
const STRING_STMT_RE = /string|docstring|comment/iu;

/** The statement children that make up a function/method body, or undefined if not identifiable. */
function bodyBlock(node: SemanticNode | null | undefined): SemanticNode | undefined {
  const children = node?.children;
  if (!Array.isArray(children)) {
    return undefined;
  }
  for (let index = children.length - 1; index >= 0; index -= 1) {
    if (BLOCK_RE.test(children[index].node_type ?? "")) {
      return children[index];
    }
  }
  return undefined;
}

function isTrivialStatement(stmt: SemanticNode): boolean {
  const type = (stmt.node_type ?? "").toLowerCase();
  const label = (stmt.label ?? "").trim();
  if (STUB_STMT_RE.test(type) || label === "pass" || label === "...") {
    return true;
  }
  if (NOT_IMPLEMENTED_RE.test(type) || NOT_IMPLEMENTED_RE.test(label)) {
    return true;
  }
  // Cross-language stub sentinels: Rust `todo!()` / `unimplemented!()`, Go/others `panic(...)`.
  if (/^\s*(todo!|unimplemented!)\s*\(/iu.test(label) || /^\s*panic\s*\(/iu.test(label)) {
    return true;
  }
  if (STRING_STMT_RE.test(type)) {
    return true;
  }
  if (/expression_statement/iu.test(type)) {
    const inner = stmt.children ?? [];
    if (inner.length === 1 && STRING_STMT_RE.test(inner[0].node_type ?? "")) {
      return true;
    }
    if (inner.length === 0 && /^["'`]|^\.\.\.$/u.test(label)) {
      return true;
    }
  }
  return false;
}

/**
 * Whether a function/method body is a stub (no-op) or substantive — or undefined
 * when the node isn't a function or its body can't be confidently identified.
 * Positively identified only: we never falsely claim "stub".
 */
export function bodyKind(node: SemanticNode | null | undefined): "stub" | "substantive" | undefined {
  const type = (node?.node_type ?? "").toLowerCase();
  if (!type || !FUNCTIONISH_RE.test(type)) {
    return undefined;
  }
  const block = bodyBlock(node);
  if (!block) {
    return undefined;
  }
  const statements = block.children ?? [];
  if (statements.length === 0) {
    return "stub";
  }
  return statements.every(isTrivialStatement) ? "stub" : "substantive";
}

/** A human phrase naming the stub's sentinel, e.g. "just `pass`", or undefined. */
function stubPhrase(node: SemanticNode | null | undefined): string | undefined {
  const block = bodyBlock(node);
  for (const stmt of block?.children ?? []) {
    const type = (stmt.node_type ?? "").toLowerCase();
    const label = (stmt.label ?? "").trim();
    if (/pass/iu.test(type) || label === "pass") {
      return "just `pass`";
    }
    if (/ellipsis/iu.test(type) || label === "...") {
      return "just `...`";
    }
    if (NOT_IMPLEMENTED_RE.test(type) || NOT_IMPLEMENTED_RE.test(label)) {
      return "raises `NotImplementedError`";
    }
    if (STRING_STMT_RE.test(type) || /expression_statement/iu.test(type)) {
      return "only a docstring";
    }
  }
  return undefined;
}

function findDescendant(
  node: SemanticNode,
  predicate: (node: SemanticNode) => boolean,
  depth = 0,
): SemanticNode | undefined {
  if (depth > 4) {
    return undefined;
  }
  for (const child of node.children ?? []) {
    if (predicate(child)) {
      return child;
    }
    const nested = findDescendant(child, predicate, depth + 1);
    if (nested) {
      return nested;
    }
  }
  return undefined;
}

/**
 * A concrete fact mined from a substantive body's child subtree (leaf labels are
 * the actual source tokens): "returns `a + b`" / "calls `charge()`", or undefined.
 */
export function bodyFact(node: SemanticNode | null | undefined): string | undefined {
  const block = bodyBlock(node);
  const statements = block?.children;
  if (!Array.isArray(statements)) {
    return undefined;
  }
  for (const stmt of statements) {
    if (/return/iu.test(stmt.node_type ?? "")) {
      const match = /^return\s+(.+)$/u.exec((stmt.label ?? "").trim());
      if (match && match[1].length <= 40) {
        return `returns ${code(match[1])}`;
      }
    }
  }
  for (const stmt of statements) {
    const call = /call/iu.test(stmt.node_type ?? "") ? stmt : findDescendant(stmt, (n) => /call/iu.test(n.node_type ?? ""));
    const callee = /^([A-Za-z_][\w.]*)\s*\(/u.exec((call?.label ?? "").trim());
    if (callee) {
      return `calls ${code(`${callee[1]}()`)}`;
    }
  }
  return undefined;
}

function compact(clauses: Array<string | undefined>): string[] {
  return clauses.filter((clause): clause is string => Boolean(clause));
}

/** Map the engine's authoritative body enum onto the local stub/substantive kind. */
export function engineBodyKind(facts: NodeFacts | null | undefined): "stub" | "substantive" | undefined {
  switch (facts?.body) {
    case "stub":
    case "empty":
      return "stub";
    case "substantive":
      return "substantive";
    default:
      return undefined;
  }
}

/** The stub sentinel as a bare keyword token (no code fragment), or undefined. */
function stubSentinelToken(node: SemanticNode | null | undefined): string | undefined {
  const phrase = stubPhrase(node);
  if (!phrase) {
    return undefined;
  }
  if (phrase.includes("pass")) {
    return "pass";
  }
  if (phrase.includes("...")) {
    return "...";
  }
  if (phrase.includes("NotImplementedError")) {
    return "NotImplementedError";
  }
  return "docstring only";
}

/** The *kind* of value that changed (never the literal itself), for the private fact sheet. */
function valueCategory(nodeType: string | null | undefined): string | undefined {
  const type = (nodeType ?? "").toLowerCase();
  if (/string/u.test(type)) {
    return "a string literal";
  }
  if (/integer|float|number|decimal/u.test(type)) {
    return "a numeric literal";
  }
  if (/bool|true|false/u.test(type)) {
    return "a boolean value";
  }
  if (/return/u.test(type)) {
    return "a return value";
  }
  if (/call/u.test(type)) {
    return "a function call";
  }
  return undefined;
}

/**
 * Derive a privacy-safe {@link IntentFacts} from a change (+ its group): structure
 * and semantics from the tree, never the verbatim body. Identifier-bearing fields
 * (name/owner/returnType/scopeName) are populated but only surfaced by the prompt
 * layer at the "signatures" level. Pure — reads the change, never a document.
 */
/**
 * Change-delta (#69-I): what shifted between the old and new definition, from their privacy-safe
 * facts alone — the most intent-relevant signal for a MODIFICATION. Enum/count/flag only.
 */
export function computeChangeDelta(before: NodeFacts, after: NodeFacts): string[] {
  const out: string[] = [];
  const bp = before.param_count;
  const ap = after.param_count;
  if (typeof bp === "number" && typeof ap === "number" && bp !== ap) {
    const d = ap - bp;
    out.push(
      d > 0
        ? `adds ${d} parameter${d === 1 ? "" : "s"}`
        : `removes ${-d} parameter${-d === 1 ? "" : "s"}`,
    );
  }
  if (!before.is_async && after.is_async) {
    out.push("becomes async");
  }
  if (before.returns !== after.returns || before.return_kind !== after.return_kind) {
    if (before.returns === "none" && after.returns && after.returns !== "none") {
      out.push("now returns a value");
    } else if (after.returns === "none" && before.returns && before.returns !== "none") {
      out.push("no longer returns a value");
    } else {
      out.push("changes what it returns");
    }
  }
  if (before.control_shape !== after.control_shape) {
    if (after.control_shape === "looping" && before.control_shape !== "looping") {
      out.push("adds a loop");
    } else if (after.control_shape === "branching" && before.control_shape === "linear") {
      out.push("adds a branch");
    } else if (after.control_shape === "linear" && before.control_shape !== "linear") {
      out.push("removes control flow");
    }
  }
  if (!before.has_error_handling && after.has_error_handling) {
    out.push("adds error handling");
  } else if (before.has_error_handling && !after.has_error_handling) {
    out.push("removes error handling");
  }
  if (!before.side_effects && after.side_effects) {
    out.push("adds a side effect");
  }
  return out;
}

export function extractFacts(change: SemanticChange, group?: ChangeGroup): IntentFacts {
  const node = change.change_type === "DELETION"
    ? (change.old_node ?? change.new_node)
    : (change.new_node ?? change.old_node);
  const facts: IntentFacts = { changeType: change.change_type };

  const kind = friendlyType(node);
  if (kind) {
    facts.symbolKind = kind;
  }
  const label = node?.label?.trim();
  if (label && !/\s/u.test(label)) {
    facts.name = label; // single-token identifiers only (skip source-line labels like "return x")
  }
  const owner = node?.parent_type?.trim();
  if (owner) {
    facts.owner = owner;
  }

  // Engine-emitted facts (Rust parser, from the full CST before pruning) are
  // authoritative — prefer them over the child-tree heuristics, which only see the
  // pruned semantic tree and can be wrong (e.g. arity for an empty parameter list).
  const engine = node?.facts;
  const params = typeof engine?.param_count === "number" ? engine.param_count : arity(node);
  if (params !== undefined) {
    facts.arity = params;
  }
  const type = typeInfo(node);
  if (type) {
    facts.returnType = type;
  }
  if (engine?.returns) {
    facts.returns = engine.returns;
  }
  if (typeof engine?.return_kind === "string") {
    facts.returnKind = engine.return_kind;
  }
  if (engine?.side_effects) {
    facts.sideEffects = true;
  }
  if (typeof engine?.control_shape === "string") {
    facts.controlShape = engine.control_shape;
  }
  if (engine?.has_error_handling) {
    facts.hasErrorHandling = true;
  }
  // #68 antidote: carry through an explicit false so the sheet can say "performs no computation".
  if (typeof engine?.has_computation === "boolean") {
    facts.hasComputation = engine.has_computation;
  }
  if (typeof engine?.behavior_category === "string") {
    facts.behaviorCategory = engine.behavior_category;
  }
  // Class facts (#69 catalog D): shape counts + kind (no member/base names).
  if (typeof engine?.method_count === "number") {
    facts.methodCount = engine.method_count;
  }
  if (typeof engine?.field_count === "number") {
    facts.fieldCount = engine.field_count;
  }
  if (typeof engine?.base_count === "number") {
    facts.baseCount = engine.base_count;
  }
  if (engine?.is_enum) {
    facts.isEnum = true;
  }
  if (engine?.is_exception) {
    facts.isException = true;
  }
  // Decorator semantics (#69 catalog C/D): behavior flags (no decorator names).
  if (typeof engine?.decorator_count === "number") {
    facts.decoratorCount = engine.decorator_count;
  }
  if (engine?.is_property) {
    facts.isProperty = true;
  }
  if (engine?.is_staticmethod) {
    facts.isStaticmethod = true;
  }
  if (engine?.is_classmethod) {
    facts.isClassmethod = true;
  }
  if (engine?.is_abstract) {
    facts.isAbstract = true;
  }
  if (engine?.is_cached) {
    facts.isCached = true;
  }
  if (engine?.is_dataclass) {
    facts.isDataclass = true;
  }
  // Param kinds (#69 catalog C): counts/flags only, no parameter names.
  if (typeof engine?.default_count === "number") {
    facts.defaultCount = engine.default_count;
  }
  if (typeof engine?.keyword_only_count === "number") {
    facts.keywordOnlyCount = engine.keyword_only_count;
  }
  if (engine?.has_variadic) {
    facts.hasVariadic = true;
  }
  if (engine?.has_kwargs) {
    facts.hasKwargs = true;
  }
  // Coupling (#69-J): fan-out count + recursion flag (no callee names).
  if (typeof engine?.call_count === "number") {
    facts.callCount = engine.call_count;
  }
  if (engine?.recursive) {
    facts.recursive = true;
  }
  if (engine?.is_async) {
    facts.isAsync = true;
  }
  if (engine?.is_generator) {
    facts.isGenerator = true;
  }
  // Change-delta (#69-I): what shifted between old and new — the key intent for a MODIFICATION.
  if (
    change.change_type === "MODIFICATION" &&
    change.old_node?.facts &&
    change.new_node?.facts
  ) {
    const delta = computeChangeDelta(change.old_node.facts, change.new_node.facts);
    if (delta.length > 0) {
      facts.changeDelta = delta;
    }
  }
  const engineBody = engineBodyKind(engine);
  const kindOfBody = engineBody ?? bodyKind(node);
  if (kindOfBody) {
    facts.bodyKind = kindOfBody;
    if (kindOfBody === "stub") {
      // The engine intentionally omits the sentinel token; only the heuristic can name it.
      const sentinel = engineBody ? undefined : stubSentinelToken(node);
      if (sentinel) {
        facts.stubSentinel = sentinel;
      }
    }
  }
  const span = lineSpan(node);
  if (span !== undefined) {
    facts.lineSpan = span;
  }
  const role = impactForNodeType(node?.node_type);
  if (role) {
    facts.role = role;
  }
  if (change.change_type === "MODIFICATION") {
    const category = valueCategory(node?.node_type);
    if (category) {
      facts.valueCategory = category;
    }
  }
  const scopeName = scopeInnermost(group);
  if (scopeName) {
    facts.scopeName = scopeName;
  }
  return facts;
}

/**
 * A specific "why it matters" for a change, using the actual before/after value
 * (`text_diff`) and the changed node's role, rather than a category platitude.
 */
export function whyForChange(
  change: SemanticChange,
  kind: string,
  group?: ChangeGroup,
  contentClass: ContentClass = "code",
): string {
  if (contentClass !== "code") {
    return whyForNonCode(change, kind, group, contentClass);
  }
  switch (kind) {
    case "MEANINGFUL_CHANGE":
      return whyMeaningful(change);
    case "REFACTORING": {
      const refactorKind = (change.refactoring_kind ?? group?.refactoring_kind ?? "").toUpperCase();
      return refactorKind.includes("RENAME")
        ? "Update call sites; behavior preserved."
        : "Structure only — behavior preserved.";
    }
    case "MOVED_CODE":
      return "Relocated only; behavior preserved.";
    case "IGNORED_STYLE":
      return invarianceReason(group) ?? "Formatting or whitespace only — safe to ignore.";
    case "NOISE_SUPPRESSED":
      return invarianceReason(group) ?? "Below the meaningfulness threshold — suppressed.";
    default:
      return "Semantic change.";
  }
}

/**
 * "Why" for a non-code file (docs / config / data / text). Never applies code framing
 * (no "public API", "function", stub, or runtime-behavior claims) — the change is a
 * content edit, described by its content class.
 */
function whyForNonCode(
  change: SemanticChange,
  kind: string,
  group: ChangeGroup | undefined,
  contentClass: ContentClass,
): string {
  const noun = contentNoun(contentClass);
  if (kind === "IGNORED_STYLE" || kind === "NOISE_SUPPRESSED") {
    return invarianceReason(group) ?? `${capitalize(noun)} formatting only.`;
  }
  if (kind === "REFACTORING") {
    return `${capitalize(noun)} restructured; content preserved.`;
  }
  if (kind === "MOVED_CODE") {
    return `Relocated ${noun}; content preserved.`;
  }
  const value = valueChange(change.text_diff);
  if (value) {
    return `Value ${value}.`;
  }
  if (change.change_type === "DELETION") {
    return `${capitalize(noun)} removed.`;
  }
  if (change.change_type === "ADDITION") {
    return contentClass === "config" || contentClass === "data" ? `New ${noun} entry.` : `${capitalize(noun)} added.`;
  }
  return `${capitalize(noun)} content change.`;
}

/** A stub sentence naming the actual sentinel when known, e.g. from `def ccc(): pass`. */
function stubClause(node: SemanticNode | null | undefined): string {
  const phrase = stubPhrase(node);
  return phrase ? `Empty stub — no implementation yet (${phrase}).` : "Empty stub — no implementation yet.";
}

/** Visibility → a short lead clause; always yields a clause so the "why" is never empty. */
function visibilityHead(node: SemanticNode | null | undefined): string {
  switch (visibility(node?.label)) {
    case "internal":
      return "Internal helper";
    case "dunder":
      return "Special method";
    case "constant":
      return "Constant";
    default:
      return "Public";
  }
}

function sizeClause(node: SemanticNode | null | undefined): string | undefined {
  const span = lineSpan(node);
  return span && span >= 4 ? `${span} lines` : undefined;
}

/** Behavioral "why" for a meaningful change — built from gated clauses, never restating the what. */
function whyMeaningful(change: SemanticChange): string {
  if (change.change_type === "ADDITION") {
    const node = change.new_node;
    if ((engineBodyKind(node?.facts) ?? bodyKind(node)) === "stub") {
      return stubClause(node);
    }
    const returnKindWord = node?.facts?.return_kind
      ? RETURN_KIND_WORD[node.facts.return_kind]
      : undefined;
    const returnsClause = node?.facts?.returns === "none"
      ? "returns nothing"
      : node?.facts?.returns === "literal"
        ? `returns a constant${returnKindWord ? ` ${returnKindWord}` : " value"}`
        : node?.facts?.returns === "value"
          ? "returns a value"
          : undefined;
    const sideEffectClause = node?.facts?.side_effects ? "has a side effect" : undefined;
    const facts = compact([bodyFact(node), returnsClause, sideEffectClause, sizeClause(node)]);
    const head = visibilityHead(node);
    if (facts.length > 0) {
      return `${head} — ${facts.join(", ")}.`;
    }
    // "Public" is the *default* when no visibility signal was found — and our signal
    // (leading `_`, dunder, ALL_CAPS) is Python/JS-centric, so we can't actually
    // confirm a symbol is public/exported across languages. Don't over-claim
    // "public API"; only assert the grounded heads (Internal helper / Constant /
    // Special method) and otherwise state novelty honestly.
    return head === "Public" ? "Newly added." : `${head}.`;
  }

  if (change.change_type === "DELETION") {
    return "Callers referencing it will break.";
  }

  // Modification: a stub flip is the strongest signal when both sides are identifiable.
  const flip = bodyKindFlip(change);
  if (flip) {
    return flip;
  }
  const nodeType = change.new_node?.node_type ?? change.old_node?.node_type;
  const isReturn = /return|yield/iu.test((nodeType ?? "").toLowerCase());
  const parts = valueParts(change.text_diff);
  if (parts && isReturn) {
    const before = parts.before.replace(/^return\s+/iu, "").trim();
    const after = parts.after.replace(/^return\s+/iu, "").trim();
    return `Now returns ${code(after)} instead of ${code(before)}.`;
  }
  const impact = impactForNodeType(nodeType);
  if (parts) {
    const value = `${code(parts.before)} → ${code(parts.after)}`;
    return impact ? `${capitalize(impact)} (${value}).` : `Value changes ${value}.`;
  }
  if (impact) {
    return `${capitalize(impact)}.`;
  }
  const type = typeInfo(change.new_node);
  if (type) {
    return `Type is now ${code(type)}.`;
  }
  return "Changed logic here.";
}

/** "Gutted to a stub" / "Implemented" when a body flips between stub and substantive. */
function bodyKindFlip(change: SemanticChange): string | undefined {
  const oldKind = bodyKind(change.old_node);
  const newKind = bodyKind(change.new_node);
  if (!oldKind || !newKind || oldKind === newKind) {
    return undefined;
  }
  return newKind === "stub"
    ? "Gutted to a stub — implementation removed."
    : "Implemented (was an empty stub).";
}

/** Prefer the engine's invariance explanation (rule reason) when it reached us. */
function invarianceReason(group: ChangeGroup | undefined): string | undefined {
  const metadata = group?.metadata as Record<string, unknown> | undefined;
  for (const key of ["reason", "explanation"]) {
    const value = metadata?.[key];
    if (typeof value === "string" && value.trim().length > 0) {
      return value.trim();
    }
  }
  return undefined;
}

function representativeChange(group: ChangeGroup, changes: SemanticChange[]): SemanticChange | undefined {
  for (const index of group.raw_change_indices ?? []) {
    const change = changes[index];
    if (change) {
      return change;
    }
  }
  return undefined;
}

function whatFromLabels(group: ChangeGroup): string {
  const oldLabel = group.old_labels?.find((label) => label.trim());
  const newLabel = group.new_labels?.find((label) => label.trim());
  const location = scopeSuffix(group);
  if (group.refactoring_kind?.toUpperCase().includes("RENAME") && oldLabel && newLabel) {
    return `Renamed ${code(oldLabel)} → ${code(newLabel)}${location}`;
  }
  if (newLabel) {
    return `Changed ${code(newLabel)}${location}`;
  }
  if (oldLabel) {
    return `Changed ${code(oldLabel)}${location}`;
  }
  return `${humanizeConstant(group.refactoring_kind ?? group.kind)}${location}`;
}

/** Explanation for a raw change (used by the no-groups fallback path). */
export function explainChange(
  change: SemanticChange,
  group?: ChangeGroup,
  contentClass: ContentClass = "code",
): IntentExplanation {
  const kind = group?.kind ?? kindForChange(change);
  return {
    what: whatForChange(change, group),
    why: whyForChange(change, kind, group, contentClass),
    risk: riskForContent(kind, contentClass),
  };
}

/** Explanation for an intent group (its representative change + category impact). */
export function explainGroup(
  group: ChangeGroup,
  changes: SemanticChange[],
  contentClass: ContentClass = "code",
): IntentExplanation {
  const rep = representativeChange(group, changes);
  const what = rep ? whatForChange(rep, group) : whatFromLabels(group);
  const why = rep
    ? whyForChange(rep, group.kind, group, contentClass)
    : whyForChange({ change_type: "MODIFICATION" } as SemanticChange, group.kind, group, contentClass);
  return { what, why, risk: riskForContent(group.kind, contentClass) };
}
