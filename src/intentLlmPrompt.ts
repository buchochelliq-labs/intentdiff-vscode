/**
 * Pure (vscode-free, network-free) helpers for the opt-in LLM intent explainer:
 * the privacy-tiered payload, prompt, per-provider request bodies, response
 * parsers, and a cache key. The vscode/network orchestration lives in
 * intentLlmExplainer.ts.
 *
 * Privacy model (see docs): raw source is NEVER the default payload. The model is
 * grounded in a locally-derived **fact sheet** — structure + semantics extracted
 * from the semantic tree, not the hunk — so implementation logic does not leave
 * the machine. Verbatim code is only sent at the "full" level, which the explainer
 * restricts to local endpoints.
 */

/** How much of the change is put in front of the model. */
export type IntentShareLevel = "facts" | "signatures" | "full";

/**
 * Locally-derived, non-verbatim description of a change. `name`/`owner`/`returnType`/
 * `scopeName` are identifier-bearing and only surfaced at the "signatures" level;
 * everything else is structural and safe at "facts" (no identifiers, no literals,
 * no bodies).
 */
export interface IntentFacts {
  changeType: string;
  symbolKind?: string;
  name?: string;
  owner?: string;
  arity?: number;
  returnType?: string;
  /** Authoritative return semantics from the engine: "none" | "value" | "literal" | "unknown". */
  returns?: string;
  /** Kind of returned constant when returns === "literal" (int/float/str/bool/none/mixed). */
  returnKind?: string;
  /** The body has a side effect (a bare call / output). */
  sideEffects?: boolean;
  /** Behavior classification (#69-H): "linear" | "branching" | "looping". */
  controlShape?: string;
  /** The body has error handling (try/catch/except/rescue). */
  hasErrorHandling?: boolean;
  /** Whether a substantive body computes (operators/comprehensions) vs only calling+returning.
   *  Explicit false lets the sheet say "performs no computation" (the #68 antidote). */
  hasComputation?: boolean;
  /** Coarse purpose rollup: "accessor"|"transformer"|"validator"|"io"|"mutator"|"factory". */
  behaviorCategory?: string;
  /** Class facts (#69 catalog D): shape counts + kind (enum/exception). No member/base names. */
  methodCount?: number;
  fieldCount?: number;
  baseCount?: number;
  isEnum?: boolean;
  isException?: boolean;
  /** Decorator semantics (#69 catalog C/D): behavior flags inferred from decorators. No names. */
  isProperty?: boolean;
  isStaticmethod?: boolean;
  isClassmethod?: boolean;
  isAbstract?: boolean;
  isCached?: boolean;
  isDataclass?: boolean;
  decoratorCount?: number;
  /** Param kinds (#69 catalog C): counts/flags only, never a parameter name. */
  defaultCount?: number;
  keywordOnlyCount?: number;
  hasVariadic?: boolean;
  hasKwargs?: boolean;
  /** Coupling (#69-J): outbound-call fan-out count (no callee names) + self-recursion flag. */
  callCount?: number;
  recursive?: boolean;
  /** Change-delta (#69-I): what shifted on a MODIFICATION (e.g. "adds a loop", "becomes async"). */
  changeDelta?: string[];
  bodyKind?: "stub" | "substantive";
  stubSentinel?: string;
  lineSpan?: number;
  role?: string;
  valueCategory?: string;
  scopeName?: string;
  isAsync?: boolean;
  isGenerator?: boolean;
}

/** What the provider assembles and hands to the explainer (level-agnostic). */
export interface IntentExplainInput {
  category: string;
  risk?: "behavior" | "internal";
  /** Deterministic "what changed" — identifier-bearing; used only at signatures/full. */
  what: string;
  language?: string;
  scope?: string;
  facts: IntentFacts;
  /** Verbatim sliced source — only transmitted at the "full" level (local endpoints). */
  code?: { before?: string; after?: string };
}

/** The resolved, level-specific prompt payload (what actually gets sent). */
export interface IntentPromptInput {
  category: string;
  risk?: "behavior" | "internal";
  language?: string;
  level: IntentShareLevel;
  /** Identifier-bearing; present only at signatures/full. */
  what?: string;
  scope?: string;
  /** Non-verbatim structured summary; present at facts/signatures. */
  factSheet?: string;
  /** Verbatim code; present only at full. */
  before?: string;
  after?: string;
}

const CODE_CHAR_CAP = 1500;
/** Human words for a returned-constant kind (never the value). Shared with the deterministic explainer. */
export const RETURN_KIND_WORD: Record<string, string> = {
  int: "integer",
  float: "number",
  // Grammars that don't distinguish int/float at the CST (JS/TS `number`).
  number: "number",
  str: "string",
  bool: "boolean",
  none: "None",
};
/** Human phrase (infinitive, reads after "appears to") for the coarse behavior category (#69-H). */
const BEHAVIOR_PHRASE: Record<string, string> = {
  accessor: "read and return a value",
  transformer: "compute and return a value",
  validator: "validate and raise on failure",
  io: "perform I/O / side effects",
  mutator: "update state in place",
  factory: "build and return a new object",
};
const CHANGE_VERB: Record<string, string> = {
  ADDITION: "Adds",
  DELETION: "Removes",
  MODIFICATION: "Modifies",
  MOVE: "Moves",
  REORDER: "Reorders",
  REFACTORING: "Refactors",
};

/**
 * Render a non-verbatim fact sheet. At "facts" it emits NO identifiers, literals,
 * or bodies — only structure/roles. At "signatures" it adds symbol names, types,
 * and scope (the public API surface), but still never a body or a literal value.
 */
export function renderFactSheet(facts: IntentFacts, level: "facts" | "signatures"): string {
  const named = level === "signatures";
  const verb = CHANGE_VERB[facts.changeType] ?? "Changes";
  const kind = facts.symbolKind ?? "code element";
  const clauses: string[] = [];

  if (named && facts.name) {
    clauses.push(`${verb} the ${kind} \`${facts.name}\`${facts.owner ? ` on \`${facts.owner}\`` : ""}`);
  } else {
    clauses.push(`${verb} a ${kind}`);
  }
  if (facts.isAsync) {
    clauses.push("async");
  }
  if (facts.arity !== undefined) {
    clauses.push(facts.arity === 0 ? "no parameters" : `${facts.arity} parameter${facts.arity === 1 ? "" : "s"}`);
  }
  // Param kinds (#69 catalog C) — refine the arity with optional / keyword-only / variadic shape.
  if (facts.defaultCount) {
    clauses.push(`${facts.defaultCount} optional`);
  }
  if (facts.keywordOnlyCount) {
    clauses.push(`${facts.keywordOnlyCount} keyword-only`);
  }
  if (facts.hasVariadic) {
    clauses.push("variadic (*args)");
  }
  if (facts.hasKwargs) {
    clauses.push("arbitrary keyword args (**kwargs)");
  }
  if (named && facts.returnType) {
    clauses.push(`returns \`${facts.returnType}\``);
  } else if (facts.returns === "none") {
    clauses.push("returns nothing");
  } else if (facts.returns === "literal") {
    const word = facts.returnKind ? RETURN_KIND_WORD[facts.returnKind] : undefined;
    clauses.push(word ? `returns a constant ${word}` : "returns a constant value");
  } else if (facts.returns === "value") {
    clauses.push("returns a value");
  }
  if (facts.sideEffects) {
    clauses.push("has a side effect (produces output or calls out)");
  }
  // #68 antidote: an explicit false means a substantive body that computes nothing — say so, so
  // the model does not invent "performs some internal computation". Emitted only when false.
  if (facts.hasComputation === false) {
    clauses.push("performs no computation (only calls and returns)");
  }
  if (facts.controlShape === "looping") {
    clauses.push("loops");
  } else if (facts.controlShape === "branching") {
    clauses.push("branches on a condition");
  }
  if (facts.hasErrorHandling) {
    clauses.push("handles errors");
  }
  // Coupling (#69-J): fan-out + recursion. No callee names — just the shape of how it delegates.
  if (facts.recursive) {
    clauses.push("recursive (calls itself)");
  }
  if (facts.callCount !== undefined && facts.callCount > 0) {
    clauses.push(`delegates to ${facts.callCount} call${facts.callCount === 1 ? "" : "s"}`);
  }
  if (facts.behaviorCategory && BEHAVIOR_PHRASE[facts.behaviorCategory]) {
    clauses.push(`appears to ${BEHAVIOR_PHRASE[facts.behaviorCategory]}`);
  }
  // Class shape/kind (#69 catalog D) — kind, base count, and member counts. No member/base names.
  if (facts.isEnum) {
    clauses.push("an enumeration");
  } else if (facts.isException) {
    clauses.push("an exception type");
  }
  if (facts.baseCount !== undefined && facts.baseCount > 0) {
    clauses.push(`subclasses ${facts.baseCount} base${facts.baseCount === 1 ? "" : "s"}`);
  }
  if (facts.methodCount !== undefined) {
    const members: string[] = [];
    if (facts.methodCount > 0) {
      members.push(`${facts.methodCount} method${facts.methodCount === 1 ? "" : "s"}`);
    }
    if (facts.fieldCount) {
      members.push(`${facts.fieldCount} field${facts.fieldCount === 1 ? "" : "s"}`);
    }
    clauses.push(members.length > 0 ? `with ${members.join(" and ")}` : "with no members yet");
  }
  // Decorator semantics (#69 catalog C/D) — behavior-changing modifiers, no decorator names.
  if (facts.isDataclass) {
    clauses.push("a dataclass");
  }
  if (facts.isProperty) {
    clauses.push("a read-only property");
  }
  if (facts.isStaticmethod) {
    clauses.push("a static method");
  }
  if (facts.isClassmethod) {
    clauses.push("a class method");
  }
  if (facts.isAbstract) {
    clauses.push("abstract (must be overridden)");
  }
  if (facts.isCached) {
    clauses.push("cached/memoized");
  }
  if (facts.isGenerator) {
    clauses.push("a generator (yields)");
  }
  // Change-delta (#69-I): for a MODIFICATION, WHAT shifted is the intent — surface it explicitly.
  if (facts.changeDelta && facts.changeDelta.length > 0) {
    clauses.push(`the edit ${facts.changeDelta.join(", ")}`);
  }
  if (facts.bodyKind === "stub") {
    clauses.push(`an empty no-op body${facts.stubSentinel ? ` (${facts.stubSentinel})` : ""}`);
  } else if (facts.bodyKind === "substantive") {
    clauses.push("a non-trivial body");
  }
  if (facts.lineSpan !== undefined && facts.lineSpan >= 4) {
    clauses.push(`about ${facts.lineSpan} lines`);
  }
  if (facts.role) {
    clauses.push(facts.role);
  }
  if (facts.valueCategory) {
    clauses.push(`${facts.valueCategory} changed`);
  }
  if (named && facts.scopeName) {
    clauses.push(`in \`${facts.scopeName}\``);
  }
  return `${clauses.join("; ")}.`;
}

/**
 * Resolve the level-agnostic request into the exact payload for the given level.
 * "full" without usable code degrades to a signatures fact sheet (still local).
 */
export function buildPromptInput(input: IntentExplainInput, level: IntentShareLevel): IntentPromptInput {
  const base: IntentPromptInput = {
    category: input.category,
    risk: input.risk,
    language: input.language,
    level,
  };
  const before = input.code?.before?.trim();
  const after = input.code?.after?.trim();
  if (level === "full" && (before || after)) {
    return { ...base, what: input.what, scope: input.scope, before, after };
  }
  if (level === "signatures" || (level === "full" && !before && !after)) {
    return {
      ...base,
      level: "signatures",
      what: input.what,
      scope: input.scope,
      factSheet: renderFactSheet(input.facts, "signatures"),
    };
  }
  return { ...base, level: "facts", factSheet: renderFactSheet(input.facts, "facts") };
}

/**
 * Prompt grounding the model in either a structured fact sheet (default, private)
 * or — only at the "full" level — the real code. Either way it must describe what
 * the change does, never give review-process advice, and call out no-ops honestly.
 */
export function buildExplainPrompt(input: IntentPromptInput): string {
  const isCode = input.before !== undefined || input.after !== undefined;
  const intro = isCode
    ? [
        "You are a senior engineer explaining a code change to a teammate. Describe, in plain language,",
        "WHAT THIS CODE DOES and its concrete effect — name the actual operation, values, or return value.",
        "Answer in 1-2 short sentences (max ~40 words).",
      ]
    : [
        "You are a senior engineer explaining a code change to a teammate. You are given a STRUCTURED",
        "SUMMARY of the change (NOT the source code). Explain the change in plain language using ONLY the",
        "facts listed below — do not infer anything not stated. Answer in 1-2 short sentences (max ~40 words).",
      ];
  const lines = [
    ...intro,
    "",
    "Rules:",
    "- Explain the change itself; do NOT give review-process advice (never say \"reviewers must verify\",",
    "  \"check callers\", \"ensure naming\", or anything similar).",
    "- If it is a placeholder/stub/no-op — an empty body, `pass`, `...`, only a docstring, or it raises",
    "  NotImplementedError — say so plainly and do NOT imply it has behavior or importance.",
    ...(isCode
      ? []
      : [
          "- Describe ONLY what the facts state. Do NOT infer or invent behavior, purpose, computation, or",
          "  effects that are not listed — never say a function \"performs computation\", \"processes data\",",
          "  \"does internal work\", or describe what it is for when the facts do not say so. If the facts only",
          "  give a body shape and a return, state just that (e.g. a stub that returns a constant) — no more.",
        ]),
    "- Do not invent details beyond what you are given. No preamble, no restating the category label.",
    "",
    `Language: ${input.language ?? "unknown"}`,
    `Category: ${input.category}${input.risk ? ` (${input.risk === "behavior" ? "behavior-affecting" : "internal"})` : ""}`,
    input.scope ? `Location: ${input.scope}` : "",
    input.what ? `Summary: ${input.what}` : "",
    isCode ? codeSection("Removed code", input.before) : "",
    isCode ? codeSection("Added code", input.after) : "",
    !isCode && input.factSheet ? `Change summary:\n${input.factSheet}` : "",
  ];
  return lines.filter((line) => line !== "").join("\n");
}

/** A labelled, char-capped code block (keeps newlines) or "" when the code is absent/empty. */
function codeSection(label: string, code: string | undefined): string {
  const trimmed = (code ?? "").trim();
  if (trimmed.length === 0) {
    return "";
  }
  const capped = trimmed.length > CODE_CHAR_CAP ? `${trimmed.slice(0, CODE_CHAR_CAP - 1)}…` : trimmed;
  return `${label}:\n${capped}`;
}

export interface LlmRequestBody {
  model: string;
  max_tokens: number;
  messages: Array<{ role: "user"; content: string }>;
}

export function anthropicRequest(prompt: string, model: string): LlmRequestBody {
  return { model, max_tokens: 120, messages: [{ role: "user", content: prompt }] };
}

export function openAiRequest(prompt: string, model: string): LlmRequestBody {
  return { model, max_tokens: 120, messages: [{ role: "user", content: prompt }] };
}

/** Trim, strip wrapping quotes, and cap to ~two sentences of prose. */
function cleanExplanation(text: string): string {
  const trimmed = text.trim().replace(/^["'`]+|["'`]+$/gu, "").trim();
  return trimmed.length > 320 ? `${trimmed.slice(0, 319)}…` : trimmed;
}

/** Extract the explanation text from an Anthropic Messages API response. */
export function parseAnthropic(response: unknown): string | undefined {
  const content = (response as { content?: Array<{ type?: string; text?: string }> })?.content;
  const text = Array.isArray(content) ? content.find((part) => part?.type === "text")?.text : undefined;
  return text ? cleanExplanation(text) : undefined;
}

/** Extract the explanation text from an OpenAI-compatible chat completion. */
export function parseOpenAi(response: unknown): string | undefined {
  const choices = (response as { choices?: Array<{ message?: { content?: string } }> })?.choices;
  const text = Array.isArray(choices) ? choices[0]?.message?.content : undefined;
  return text ? cleanExplanation(text) : undefined;
}

/** Stable cache key: identical resolved payload → identical key (djb2 hash, no deps). */
export function explainCacheKey(input: IntentPromptInput): string {
  const source = [
    input.category,
    input.risk,
    input.level,
    input.what,
    input.scope,
    input.factSheet,
    input.before,
    input.after,
    input.language,
  ].join("");
  let hash = 5381;
  for (let index = 0; index < source.length; index += 1) {
    hash = ((hash << 5) + hash + source.charCodeAt(index)) | 0;
  }
  return `intent-explain:${(hash >>> 0).toString(36)}`;
}

/** The three already-derived, privacy-safe release-note buckets (no source code). */
export interface ReleaseNarrativeInput {
  behavior: string[];
  internal: string[];
  guardrails: string[];
}

/**
 * Prompt for the opt-in release-notes narrative. The input is the locally-derived
 * release-note buckets — NOT source code — so the model only rewrites the already-safe
 * summary into prose. Pure (vscode-free, network-free).
 */
export function buildReleaseNarrativePrompt(notes: ReleaseNarrativeInput): string {
  const section = (title: string, lines: string[]): string =>
    lines.length > 0 ? `${title}:\n${lines.map((line) => `- ${line}`).join("\n")}` : "";
  const body = [
    section("Behavior changes", notes.behavior),
    section("Internal changes", notes.internal),
    section("Guardrail violations", notes.guardrails),
  ].filter(Boolean).join("\n\n") || "- No notable changes.";
  return [
    "Write concise release notes from the change summary below.",
    "Output 2-4 short sentences of plain prose — no bullet lists, no headings, no preamble like \"Here are\".",
    "Lead with user-facing behavior changes; mention internal/refactor work briefly; call out any guardrail violations as needing review.",
    "Do not invent changes that are not listed. Keep any `code` spans in backticks.",
    "",
    "Change summary:",
    body,
  ].join("\n");
}

/** Cache key for a release narrative, from the derived notes only. */
export function releaseNarrativeCacheKey(notes: ReleaseNarrativeInput): string {
  const source = [...notes.behavior, "|", ...notes.internal, "|", ...notes.guardrails].join("");
  let hash = 5381;
  for (let index = 0; index < source.length; index += 1) {
    hash = ((hash << 5) + hash + source.charCodeAt(index)) | 0;
  }
  return `release-narrative:${(hash >>> 0).toString(36)}`;
}
