export type GuardrailSeverity = "important" | "immutable";

export interface NodePosition {
  start_line: number;
  start_col: number;
  end_line: number;
  end_col: number;
}

/**
 * Privacy-safe structural facts emitted by the Rust parser for definition nodes.
 * Only counts/enums/flags — never source, identifiers, or literals.
 */
export interface NodeFacts {
  /** Declared parameter count (0 for `()`). */
  param_count?: number | null;
  /** "none" | "value" | "literal" (constant) | "unknown". */
  returns?: string | null;
  /** Kind of constant when returns === "literal": "int"|"float"|"str"|"bool"|"none"|"mixed". */
  return_kind?: string | null;
  /** "empty" | "stub" | "substantive". */
  body?: string | null;
  /** True when the body has a bare call statement (a side effect / output). */
  side_effects?: boolean | null;
  /** Behavior classification (#69-H): control-flow shape. */
  has_conditional?: boolean | null;
  has_loop?: boolean | null;
  has_error_handling?: boolean | null;
  /** The body raises/throws an exception. */
  throws?: boolean | null;
  /** The body mutates state (augmented assignment, or assignment to an attribute/subscript). */
  mutates?: boolean | null;
  /** The body returns a freshly-built collection/object (factory signal). */
  constructs?: boolean | null;
  /** Whether a substantive body performs computation (operators/comprehensions) vs only
   *  calling+returning. Explicit false = the #68 antidote; absent for stub/empty bodies. */
  has_computation?: boolean | null;
  /** "linear" | "branching" | "looping" — rollup of the control-flow flags. */
  control_shape?: string | null;
  /** Coarse purpose rollup: "accessor"|"transformer"|"validator"|"io"|"mutator"|"factory". */
  behavior_category?: string | null;
  is_async?: boolean | null;
  is_generator?: boolean | null;
  decorator_count?: number | null;
  /** Class facts (#69 catalog D): shape counts from the class definition. */
  method_count?: number | null;
  field_count?: number | null;
  base_count?: number | null;
  /** Class kind inferred from bases (never the base name): enum / exception. */
  is_enum?: boolean | null;
  is_exception?: boolean | null;
  /** Decorator semantics (#69 catalog C/D), inferred from decorator names, emitted as flags. */
  is_property?: boolean | null;
  is_staticmethod?: boolean | null;
  is_classmethod?: boolean | null;
  is_abstract?: boolean | null;
  is_cached?: boolean | null;
  is_dataclass?: boolean | null;
  /** Param kinds (#69 catalog C): counts/flags only, never a parameter name. */
  default_count?: number | null;
  keyword_only_count?: number | null;
  has_variadic?: boolean | null;
  has_kwargs?: boolean | null;
  /** Coupling (#69-J): outbound-call fan-out count (no callee names) + self-recursion flag. */
  call_count?: number | null;
  recursive?: boolean | null;
}

export interface SemanticNode {
  id?: string;
  node_type?: string;
  label?: string;
  position?: NodePosition | null;
  children?: SemanticNode[];
  /** Class that directly owns this node (parsers set it for methods). */
  parent_type?: string | null;
  /** LSP-resolved type string (e.g. "int", "str | None"); null when no LSP info. */
  type_info?: string | null;
  /** Authoritative structural facts (definition nodes); preferred over child-tree heuristics. */
  facts?: NodeFacts | null;
}

export interface SemanticChange {
  change_type: string;
  old_node?: SemanticNode | null;
  new_node?: SemanticNode | null;
  refactoring_kind?: string | null;
  confidence?: number;
  description?: string;
  text_diff?: string | null;
}

export interface ChangeGroup {
  kind: string;
  raw_change_indices?: number[];
  old_labels?: string[];
  new_labels?: string[];
  old_node_ids?: string[];
  new_node_ids?: string[];
  refactoring_kind?: string | null;
  confidence?: number;
  rule_id?: string;
  metadata?: Record<string, unknown>;
}

export interface GuardrailViolation {
  rule_id: string;
  severity: GuardrailSeverity;
  file: string;
  language: string;
  semantic_path: string;
  old_value?: string | null;
  new_value?: string | null;
  message: string;
  position?: NodePosition | null;
}

export interface SchemaStatusMetadata {
  provider_id?: string;
  status?: string;
  source_url?: string | null;
  identity_fields?: string[];
  detected?: boolean;
  available?: boolean;
  error?: string;
}

export interface SemanticDiff {
  guardrail_violations?: GuardrailViolation[];
  changes?: SemanticChange[];
  change_groups?: ChangeGroup[];
  old_filename?: string;
  new_filename?: string;
  language?: string;
  has_semantic_changes?: boolean;
  is_style_only?: boolean;
  parse_errors?: string[];
  is_fallback?: boolean;
  metadata?: {
    schema?: SchemaStatusMetadata;
    /** Magic-byte content type of the diffed file (mime + coarse category). */
    content_type?: {
      mime?: string;
      extension?: string;
      category?: string;
      is_text?: boolean;
    };
    [key: string]: unknown;
  };
}

export interface CrossFileChange {
  change_type: string;
  symbol_name: string;
  old_file: string;
  new_file: string;
  old_node_id?: string | null;
  new_node_id?: string | null;
  old_position?: NodePosition | null;
  new_position?: NodePosition | null;
  old_language?: string;
  new_language?: string;
  node_type?: string;
  symbol_kind?: string;
  confidence?: number;
  description?: string;
}

export interface CommitDiff {
  old_ref: string;
  new_ref: string;
  guardrail_violations?: GuardrailViolation[];
  file_diffs?: SemanticDiff[];
  cross_file_changes?: CrossFileChange[];
  parse_errors?: string[];
}

export interface ReadyMessage {
  op: "ready";
  ok: true;
  protocol_version: number;
  repo_path: string;
  ref: string;
  transport: string;
  limits?: Record<string, unknown>;
  capabilities?: Record<string, unknown>;
}

export interface ErrorPayload {
  code: string;
  message: string;
}

export interface LiveResponse {
  op?: string;
  seq?: number;
  ok?: boolean;
  diff?: SemanticDiff;
  file_diff?: SemanticDiff;
  commit_diff?: CommitDiff;
  old_filename?: string;
  new_filename?: string;
  index?: number;
  event?: unknown;
  done?: boolean;
  cancelled?: number;
  error?: ErrorPayload;
  metadata?: Record<string, unknown>;
}

export interface LiveServerSettings {
  executable: string;
  ref: string;
  enabled: boolean;
  debounceMs: number;
  fuel?: number | string | null;
  trace: boolean;
  schemaFetchMode: "auto" | "cache-only" | "off";
  schemaCacheTtlHours: number;
  schemaAllowPrivateHosts: boolean;
}

export interface DiagnosticLike {
  severity: "error" | "warning" | "information";
  message: string;
  source: "IntentDiff";
  position?: NodePosition | null;
  code?: string;
}

export interface DecorationLike {
  kind:
    | "addition"
    | "deletion"
    | "modification"
    | "move"
    | "refactoring"
    | "style"
    | "inlineDeletionWord"
    | "inlineDeletionGap";
  message: string;
  position: NodePosition;
  deletedText?: string;
  isComment?: boolean;
}

export interface DiffSummary {
  changeCount: number;
  guardrailCount: number;
  immutableCount: number;
  importantCount: number;
  styleOnly: boolean;
  hasParseErrors: boolean;
  language?: string;
}
