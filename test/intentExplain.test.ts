import assert from "node:assert/strict";
import test from "node:test";
import {
  arity,
  bodyFact,
  bodyKind,
  computeChangeDelta,
  gitignoreWhat,
  explainChange,
  explainGroup,
  extractFacts,
  impactForNodeType,
  lineSpan,
  typeInfo,
  valueChange,
  visibility,
  whatForChange,
} from "../src/intentExplain";
import type { ChangeGroup, SemanticChange, SemanticNode } from "../src/types";

test("computeChangeDelta reports what shifted between old and new facts (#69-I)", () => {
  // A linear helper that returned nothing becomes an async, looping, error-handling function.
  const delta = computeChangeDelta(
    { param_count: 1, returns: "none", control_shape: "linear" },
    {
      param_count: 2,
      returns: "value",
      control_shape: "looping",
      has_error_handling: true,
      is_async: true,
    },
  );
  assert.ok(delta.includes("adds 1 parameter"));
  assert.ok(delta.includes("becomes async"));
  assert.ok(delta.includes("now returns a value"));
  assert.ok(delta.includes("adds a loop"));
  assert.ok(delta.includes("adds error handling"));
  // No spurious deltas when nothing changed.
  assert.deepEqual(
    computeChangeDelta({ param_count: 1, control_shape: "linear" }, { param_count: 1, control_shape: "linear" }),
    [],
  );
});

function node(label: string, nodeType = "function_definition") {
  return { label, node_type: nodeType, position: { start_line: 1, start_col: 0, end_line: 1, end_col: 1 } };
}

/** A function node with an explicit body block of the given statement children. */
function fn(label: string, statements: SemanticNode[], endLine = 1): SemanticNode {
  return {
    label,
    node_type: "function_definition",
    position: { start_line: 1, start_col: 0, end_line: endLine, end_col: 0 },
    children: [{ node_type: "block", label: "", position: null, children: statements }],
  };
}

test("explainChange describes an addition without over-claiming 'public API'", () => {
  const change: SemanticChange = { change_type: "ADDITION", new_node: node("ccc"), old_node: null };
  const explanation = explainChange(change);
  assert.equal(explanation.what, "Added function `ccc`");
  // No grounded visibility signal → state novelty honestly, don't claim it's public API.
  assert.equal(explanation.why, "Newly added.");
  assert.equal(explanation.risk, "behavior");
});

test("an added no-op stub (def ccc(): pass) is called out honestly", () => {
  const stub = fn("ccc", [{ node_type: "pass_statement", label: "pass", position: null }], 2);
  const change: SemanticChange = { change_type: "ADDITION", new_node: stub, old_node: null };
  assert.equal(explainChange(change).why, "Empty stub — no implementation yet (just `pass`).");
});

test("an added substantive function surfaces a concrete body fact", () => {
  const body = fn("add", [{ node_type: "return_statement", label: "return a + b", position: null }], 5);
  const change: SemanticChange = { change_type: "ADDITION", new_node: body, old_node: null };
  assert.equal(explainChange(change).why, "Public — returns `a + b`, 5 lines.");
});

test("valueChange extracts the before/after from a [-old][+new] char diff", () => {
  assert.equal(valueChange("rate = 0.[-1][+2]"), "`rate = 0.1` → `rate = 0.2`");
  assert.equal(valueChange("foo[-Bar][+Baz]"), "`fooBar` → `fooBaz`");
  assert.equal(valueChange(undefined), undefined);
  assert.equal(valueChange("token-level fallback: inserted 2 token(s)"), undefined);
});

test("impactForNodeType maps node roles to a specific impact clause", () => {
  assert.equal(impactForNodeType("return_statement"), "changes the returned value");
  assert.equal(impactForNodeType("if_statement"), "changes control flow — a different branch may run");
  assert.equal(impactForNodeType("parameter"), "changes the call signature");
  assert.equal(impactForNodeType("import_statement"), "changes a dependency");
  assert.equal(impactForNodeType("unknown_thing"), undefined);
});

test("meaningful modification of a return reads as a returns-clause, not the raw diff", () => {
  const change: SemanticChange = {
    change_type: "MODIFICATION",
    new_node: { label: "return x", node_type: "return_statement", position: { start_line: 3, start_col: 0, end_line: 3, end_col: 1 } },
    old_node: { label: "return x", node_type: "return_statement", position: { start_line: 3, start_col: 0, end_line: 3, end_col: 1 } },
    text_diff: "return [-1][+2]",
  };
  assert.equal(explainChange(change).why, "Now returns `2` instead of `1`.");
});

test("explainChange describes a deletion + a consequence why", () => {
  const change: SemanticChange = { change_type: "DELETION", old_node: node("foo"), new_node: null };
  const explanation = explainChange(change);
  assert.equal(explanation.what, "Removed function `foo`");
  assert.equal(explanation.why, "Callers referencing it will break.");
});

test("explainGroup describes a rename as behavior-preserving", () => {
  const changes: SemanticChange[] = [{
    change_type: "REFACTORING",
    refactoring_kind: "RENAME_VARIABLE",
    old_node: { label: "total", position: { start_line: 1, start_col: 0, end_line: 1, end_col: 1 } },
    new_node: { label: "subtotal", position: { start_line: 1, start_col: 0, end_line: 1, end_col: 1 } },
  }];
  const group: ChangeGroup = { kind: "REFACTORING", raw_change_indices: [0], refactoring_kind: "RENAME_VARIABLE" };
  const explanation = explainGroup(group, changes);
  assert.equal(explanation.what, "Renamed `total` → `subtotal`");
  assert.equal(explanation.why, "Update call sites; behavior preserved.");
  assert.equal(explanation.risk, "internal");
});

test("explainGroup describes a move as relocation", () => {
  const changes: SemanticChange[] = [{ change_type: "MOVE", new_node: node("charge_total"), old_node: node("charge_total") }];
  const group: ChangeGroup = { kind: "MOVED_CODE", raw_change_indices: [0] };
  const explanation = explainGroup(group, changes);
  assert.equal(explanation.what, "Moved function `charge_total`");
  assert.equal(explanation.why, "Relocated only; behavior preserved.");
});

test("ignored-style prefers the engine invariance reason when present", () => {
  const changes: SemanticChange[] = [{ change_type: "STYLE_ONLY", new_node: node("x", "text_span") }];
  const group: ChangeGroup = {
    kind: "IGNORED_STYLE",
    raw_change_indices: [0],
    metadata: { reason: "Whitespace discarded by a trusted parser; the parsed tree is unchanged." },
  };
  assert.equal(explainGroup(group, changes).why, "Whitespace discarded by a trusted parser; the parsed tree is unchanged.");
});

test("scope trail adds an 'in <scope>' location", () => {
  const change: SemanticChange = { change_type: "MODIFICATION", new_node: node("rate", "assignment"), old_node: node("rate", "assignment") };
  const group: ChangeGroup = {
    kind: "MEANINGFUL_CHANGE",
    raw_change_indices: [0],
    metadata: { scope_trail: ["module app", "class Greeter", "function greet"] },
  };
  assert.equal(whatForChange(change, group), "Modified assignment `rate` in `greet`");
});

test("whatForChange names the owning class for a method via parent_type", () => {
  const change: SemanticChange = {
    change_type: "MODIFICATION",
    new_node: { label: "charge", node_type: "method_definition", parent_type: "Invoice", position: { start_line: 1, start_col: 0, end_line: 1, end_col: 1 } },
    old_node: { label: "charge", node_type: "method_definition", parent_type: "Invoice", position: { start_line: 1, start_col: 0, end_line: 1, end_col: 1 } },
  };
  assert.equal(whatForChange(change), "Modified method `charge` on `Invoice`");
});

test("lineSpan counts inclusive source lines, or undefined without a position", () => {
  assert.equal(lineSpan({ position: { start_line: 3, start_col: 0, end_line: 7, end_col: 0 } }), 5);
  assert.equal(lineSpan({ position: { start_line: 4, start_col: 0, end_line: 4, end_col: 9 } }), 1);
  assert.equal(lineSpan({}), undefined);
});

test("arity counts params from a wrapper, flat children, or gives up (undefined)", () => {
  const wrapped: SemanticNode = {
    node_type: "function_definition",
    children: [{ node_type: "parameters", children: [{ node_type: "identifier", label: "a" }, { node_type: "identifier", label: "b" }] }],
  };
  assert.equal(arity(wrapped), 2);
  const flat: SemanticNode = { node_type: "function_definition", children: [{ node_type: "parameter", label: "x" }] };
  assert.equal(arity(flat), 1);
  assert.equal(arity({ node_type: "function_definition" }), undefined);
});

test("arity is 0 for an empty parameter list — never counts the wrapper itself (def ccc())", () => {
  const empty: SemanticNode = { node_type: "function_definition", children: [{ node_type: "parameters", children: [] }] };
  assert.equal(arity(empty), 0);
  // Realistic `def ccc(): pass` shape: name + empty params + body.
  const ccc: SemanticNode = {
    node_type: "function_definition",
    children: [
      { node_type: "identifier", label: "ccc" },
      { node_type: "parameters", children: [] },
      { node_type: "block", children: [{ node_type: "pass_statement", label: "pass" }] },
    ],
  };
  assert.equal(arity(ccc), 0, "def ccc() takes no parameters");
});

test("typeInfo returns the LSP type only when present", () => {
  assert.equal(typeInfo({ type_info: "str | None" }), "str | None");
  assert.equal(typeInfo({ type_info: null }), undefined);
  assert.equal(typeInfo({}), undefined);
});

test("visibility reads naming conventions and stays undefined for ordinary names", () => {
  assert.equal(visibility("_helper"), "internal");
  assert.equal(visibility("__init__"), "dunder");
  assert.equal(visibility("MAX_SIZE"), "constant");
  assert.equal(visibility("calculate"), undefined);
  assert.equal(visibility(""), undefined);
});

test("bodyKind identifies stubs and substance, undefined when unsure", () => {
  assert.equal(bodyKind(fn("s", [{ node_type: "pass_statement", label: "pass" }])), "stub");
  assert.equal(bodyKind(fn("e", [{ node_type: "ellipsis", label: "..." }])), "stub");
  assert.equal(bodyKind(fn("d", [{ node_type: "expression_statement", label: "\"docs\"", children: [{ node_type: "string", label: "\"docs\"" }] }])), "stub");
  assert.equal(bodyKind(fn("r", [{ node_type: "return_statement", label: "return 1" }])), "substantive");
  assert.equal(bodyKind(node("x", "variable_declaration")), undefined, "non-function → undefined");
  assert.equal(bodyKind({ node_type: "function_definition" }), undefined, "no identifiable body → undefined");
});

test("bodyFact mines a return expression or first call, else undefined", () => {
  assert.equal(bodyFact(fn("r", [{ node_type: "return_statement", label: "return a + b" }])), "returns `a + b`");
  assert.equal(bodyFact(fn("c", [{ node_type: "call", label: "charge(x)" }])), "calls `charge()`");
  assert.equal(bodyFact(fn("empty", [])), undefined);
});

test("graceful degradation: a bare node still yields a clean what + non-empty why and never throws", () => {
  const change: SemanticChange = { change_type: "MODIFICATION", new_node: { node_type: "wibble_wobble" }, old_node: { node_type: "wibble_wobble" } };
  const explanation = explainChange(change);
  assert.ok(explanation.what.length > 0);
  assert.ok(explanation.why.length > 0);
});

test("extractFacts derives a privacy-safe fact object (structure + signature, no body)", () => {
  const stub = fn("ccc", [{ node_type: "pass_statement", label: "pass" }], 2);
  const facts = extractFacts({ change_type: "ADDITION", new_node: stub, old_node: null });
  assert.equal(facts.changeType, "ADDITION");
  assert.equal(facts.symbolKind, "function");
  assert.equal(facts.name, "ccc");
  assert.equal(facts.bodyKind, "stub");
  assert.equal(facts.stubSentinel, "pass");
  assert.equal(facts.lineSpan, 2);
});

test("extractFacts reports the value CATEGORY, never the literal, on a modification", () => {
  const change: SemanticChange = {
    change_type: "MODIFICATION",
    new_node: { label: "42", node_type: "integer_literal", position: { start_line: 1, start_col: 0, end_line: 1, end_col: 2 } },
    old_node: { label: "1", node_type: "integer_literal", position: { start_line: 1, start_col: 0, end_line: 1, end_col: 1 } },
    text_diff: "[-1][+42]",
  };
  const facts = extractFacts(change);
  assert.equal(facts.valueCategory, "a numeric literal");
});

test("extractFacts prefers authoritative engine facts over child-tree heuristics", () => {
  // The engine emits facts for `def ccc(): pass` even though the body/params are
  // pruned from the semantic tree the extension receives.
  const cccNode: SemanticNode = {
    label: "ccc",
    node_type: "function_definition",
    position: { start_line: 1, start_col: 0, end_line: 2, end_col: 0 },
    facts: { param_count: 0, returns: "none", body: "stub" },
  };
  const facts = extractFacts({ change_type: "ADDITION", new_node: cccNode, old_node: null });
  assert.equal(facts.arity, 0, "param_count from the engine wins");
  assert.equal(facts.bodyKind, "stub", "body enum maps to stub");
  assert.equal(facts.returns, "none");
  assert.equal(facts.stubSentinel, undefined, "engine omits the sentinel token");
});

test("extractFacts carries async/generator flags from engine facts", () => {
  const node: SemanticNode = {
    label: "stream",
    node_type: "function_definition",
    position: { start_line: 1, start_col: 0, end_line: 3, end_col: 0 },
    facts: { param_count: 1, returns: "value", body: "substantive", is_async: true, is_generator: true },
  };
  const facts = extractFacts({ change_type: "ADDITION", new_node: node, old_node: null });
  assert.equal(facts.isAsync, true);
  assert.equal(facts.isGenerator, true);
  assert.equal(facts.returns, "value");
});

test("a no-op stub is called out from engine facts even when the body is pruned", () => {
  // No children at all (pruned) — only the engine facts tell us it's a no-op.
  const cccNode: SemanticNode = {
    label: "ccc",
    node_type: "function_definition",
    position: { start_line: 1, start_col: 0, end_line: 2, end_col: 0 },
    facts: { param_count: 0, returns: "none", body: "stub" },
  };
  const explanation = explainChange({ change_type: "ADDITION", new_node: cccNode, old_node: null });
  assert.equal(explanation.what, "Added function `ccc`");
  assert.equal(explanation.why, "Empty stub — no implementation yet.");
});

test("extractFacts keeps multi-token source-line labels out of the name field", () => {
  const change: SemanticChange = {
    change_type: "MODIFICATION",
    new_node: { label: "return x + 1", node_type: "return_statement", position: { start_line: 1, start_col: 0, end_line: 1, end_col: 1 } },
    old_node: { label: "return x", node_type: "return_statement", position: { start_line: 1, start_col: 0, end_line: 1, end_col: 1 } },
  };
  assert.equal(extractFacts(change).name, undefined, "a source line is not an identifier");
});

test("the why never restates the what's subject label", () => {
  const cases: SemanticChange[] = [
    { change_type: "ADDITION", new_node: node("ccc"), old_node: null },
    { change_type: "ADDITION", new_node: fn("ccc", [{ node_type: "pass_statement", label: "pass" }], 2), old_node: null },
    { change_type: "DELETION", old_node: node("foo"), new_node: null },
  ];
  for (const change of cases) {
    const { why } = explainChange(change);
    const label = (change.new_node ?? change.old_node)?.label ?? "";
    assert.ok(!why.includes(label), `why "${why}" should not contain the subject "${label}"`);
  }
});

test("non-code content changes drop code framing and use the content risk", () => {
  // A .gitignore-style addition (generic text node) explained as config content.
  const change: SemanticChange = {
    change_type: "ADDITION",
    new_node: { label: "/.intentumdiff", node_type: "text_line", position: { start_line: 85, start_col: 0, end_line: 85, end_col: 11 } },
  };
  const explanation = explainChange(change, undefined, "config");
  assert.match(explanation.what, /Added `\/\.intentumdiff`/u);
  assert.doesNotMatch(explanation.why, /public API|function|behavior/iu);
  assert.equal(explanation.why, "New configuration entry.");
  assert.equal(explanation.risk, "content");
});

test("docs and data content changes read as documentation / data, not code", () => {
  const docChange: SemanticChange = { change_type: "ADDITION", new_node: { label: "Intro", node_type: "text_line", position: null } };
  assert.equal(explainChange(docChange, undefined, "docs").why, "Documentation added.");
  const dataChange: SemanticChange = { change_type: "MODIFICATION", new_node: { label: "port", node_type: "pair", position: null }, text_diff: "[-8080][+9090]" };
  assert.match(explainChange(dataChange, undefined, "data").why, /Value `8080` → `9090`\./u);
  assert.equal(explainChange(docChange, undefined, "docs").risk, "content");
});

test("Rust todo!() body is detected as a stub across languages", () => {
  const stub = fn("charge", [{ node_type: "macro_invocation", label: "todo!()", position: null }], 2);
  assert.equal(bodyKind(stub), "stub");
});

test("gitignore changes read as human review wording, per verb (#58)", () => {
  const pat = (node_type: string, label: string) => ({ id: "1", node_type, label, children: [] });
  const add = { change_type: "ADDITION", old_node: null, new_node: pat("pattern", "build/") };
  assert.equal(gitignoreWhat(add as never), "Adds an ignore rule for `build/` (directory)");
  const addExt = { change_type: "ADDITION", old_node: null, new_node: pat("pattern", "*.log") };
  assert.equal(gitignoreWhat(addExt as never), "Adds an ignore rule for `*.log` (extension)");
  const rm = { change_type: "DELETION", old_node: pat("pattern", "dist"), new_node: null };
  assert.equal(gitignoreWhat(rm as never), "Stops ignoring `dist` — matching files become tracked again");
  const neg = { change_type: "ADDITION", old_node: null, new_node: pat("negated_pattern", "!keep.env") };
  assert.equal(gitignoreWhat(neg as never), "Adds an exception: `keep.env` is no longer ignored");
  const negRm = { change_type: "DELETION", old_node: pat("negated_pattern", "!keep.env"), new_node: null };
  assert.equal(gitignoreWhat(negRm as never), "Removes the exception for `keep.env` — it is ignored again");
  const other = { change_type: "ADDITION", old_node: null, new_node: pat("comment", "# note") };
  assert.equal(gitignoreWhat(other as never), undefined);
});
