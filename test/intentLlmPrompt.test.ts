import assert from "node:assert/strict";
import test from "node:test";
import {
  anthropicRequest,
  buildExplainPrompt,
  buildPromptInput,
  buildReleaseNarrativePrompt,
  explainCacheKey,
  openAiRequest,
  parseAnthropic,
  parseOpenAi,
  releaseNarrativeCacheKey,
  renderFactSheet,
  type IntentExplainInput,
  type IntentFacts,
} from "../src/intentLlmPrompt";

const stubFacts: IntentFacts = {
  changeType: "ADDITION",
  symbolKind: "function",
  name: "ccc",
  arity: 0,
  returns: "none",
  bodyKind: "stub",
  stubSentinel: "pass",
};

const request: IntentExplainInput = {
  category: "Meaningful change",
  risk: "behavior",
  what: "Added function `ccc`",
  language: "python",
  scope: "module app",
  facts: stubFacts,
  code: { before: "", after: "def ccc():\n    pass" },
};

// --- Fact sheet (privacy) --------------------------------------------------------------

test("renderFactSheet at 'facts' emits NO identifiers, literals, or bodies", () => {
  const sheet = renderFactSheet(stubFacts, "facts");
  assert.match(sheet, /Adds a function/);
  assert.match(sheet, /no parameters/);
  assert.match(sheet, /returns nothing/);
  assert.match(sheet, /empty no-op body \(pass\)/);
  assert.doesNotMatch(sheet, /ccc/, "the symbol name must not appear at facts level");
});

test("renderFactSheet surfaces a constant return + side effect without the value (#68)", () => {
  // The `def ccc(): print("Boo!"); return 99` case: say WHAT it returns (a constant integer)
  // and that it has a side effect — never the value 99 or the callee `print`.
  const facts: IntentFacts = {
    changeType: "ADDITION",
    symbolKind: "function",
    name: "ccc",
    arity: 0,
    returns: "literal",
    returnKind: "int",
    sideEffects: true,
    hasComputation: false,
    bodyKind: "substantive",
  };
  const sheet = renderFactSheet(facts, "facts");
  assert.match(sheet, /returns a constant integer/);
  assert.match(sheet, /has a side effect/);
  // The #68 antidote: a substantive body that computes nothing says so, so the model cannot
  // invent "performs some internal computation".
  assert.match(sheet, /performs no computation/);
  assert.doesNotMatch(sheet, /99/, "the literal value must never appear");
  assert.doesNotMatch(sheet, /print/, "the callee identifier must never appear");
  assert.doesNotMatch(sheet, /returns a value\b/, "must be specific, not the vague 'returns a value'");
  // A body that DOES compute must NOT carry the no-computation clause.
  const computing = renderFactSheet({ ...facts, hasComputation: true }, "facts");
  assert.doesNotMatch(computing, /performs no computation/);
});

test("renderFactSheet surfaces control-flow behavior (#69-H)", () => {
  // Behavior classification: the sheet describes WHAT the body does (loops, handles errors) —
  // still no identifiers or values.
  const facts: IntentFacts = {
    changeType: "MODIFICATION",
    symbolKind: "function",
    name: "scan",
    controlShape: "looping",
    hasErrorHandling: true,
    bodyKind: "substantive",
  };
  const sheet = renderFactSheet(facts, "facts");
  assert.match(sheet, /loops/);
  assert.match(sheet, /handles errors/);
  assert.doesNotMatch(sheet, /scan/, "the symbol name must not appear at facts level");
  // A linear body says neither.
  const linear = renderFactSheet({ ...facts, controlShape: "linear", hasErrorHandling: false }, "facts");
  assert.doesNotMatch(linear, /loops|branches on a condition|handles errors/);
});

test("renderFactSheet surfaces the behavior_category purpose (#69-H)", () => {
  const validator = renderFactSheet(
    { changeType: "ADDITION", symbolKind: "function", behaviorCategory: "validator" },
    "facts",
  );
  assert.match(validator, /appears to validate and raise on failure/);
  const accessor = renderFactSheet(
    { changeType: "ADDITION", symbolKind: "function", behaviorCategory: "accessor" },
    "facts",
  );
  assert.match(accessor, /appears to read and return a value/);
  const mutator = renderFactSheet(
    { changeType: "ADDITION", symbolKind: "function", behaviorCategory: "mutator" },
    "facts",
  );
  assert.match(mutator, /appears to update state in place/);
  const factory = renderFactSheet(
    { changeType: "ADDITION", symbolKind: "function", behaviorCategory: "factory" },
    "facts",
  );
  assert.match(factory, /appears to build and return a new object/);
});

test("renderFactSheet surfaces class shape + kind (#69 catalog D)", () => {
  // A class change describes its kind, base count, and member counts — no member/base names.
  const enumSheet = renderFactSheet(
    {
      changeType: "ADDITION",
      symbolKind: "class",
      name: "Color",
      isEnum: true,
      baseCount: 1,
      methodCount: 0,
      fieldCount: 2,
    },
    "facts",
  );
  assert.match(enumSheet, /an enumeration/);
  assert.match(enumSheet, /subclasses 1 base/);
  assert.match(enumSheet, /2 fields/);
  assert.doesNotMatch(enumSheet, /Color/, "the class name must not appear at facts level");

  const exceptionSheet = renderFactSheet(
    {
      changeType: "ADDITION",
      symbolKind: "class",
      isException: true,
      baseCount: 1,
      methodCount: 1,
      fieldCount: 0,
    },
    "facts",
  );
  assert.match(exceptionSheet, /an exception type/);
  assert.match(exceptionSheet, /1 method\b/);
  assert.doesNotMatch(exceptionSheet, /field/, "no fields => no field clause");

  // A class with nothing in it yet says so, not a bare "with".
  const emptySheet = renderFactSheet(
    { changeType: "ADDITION", symbolKind: "class", methodCount: 0, fieldCount: 0 },
    "facts",
  );
  assert.match(emptySheet, /with no members yet/);
});

test("renderFactSheet surfaces coupling: recursion + fan-out (#69-J)", () => {
  const sheet = renderFactSheet(
    { changeType: "ADDITION", symbolKind: "function", name: "fact", recursive: true, callCount: 3 },
    "facts",
  );
  assert.match(sheet, /recursive \(calls itself\)/);
  assert.match(sheet, /delegates to 3 calls/);
  assert.doesNotMatch(sheet, /fact\b/, "no symbol/callee name at facts level");
  // Singular + no recursion.
  const one = renderFactSheet({ changeType: "ADDITION", symbolKind: "function", callCount: 1 }, "facts");
  assert.match(one, /delegates to 1 call\b/);
  assert.doesNotMatch(one, /recursive/);
});

test("renderFactSheet surfaces param kinds (#69 catalog C)", () => {
  const sheet = renderFactSheet(
    {
      changeType: "ADDITION",
      symbolKind: "function",
      arity: 5,
      defaultCount: 2,
      keywordOnlyCount: 2,
      hasVariadic: true,
      hasKwargs: true,
    },
    "facts",
  );
  assert.match(sheet, /5 parameters/);
  assert.match(sheet, /2 optional/);
  assert.match(sheet, /2 keyword-only/);
  assert.match(sheet, /variadic \(\*args\)/);
  assert.match(sheet, /arbitrary keyword args \(\*\*kwargs\)/);
  // A plain two-arg function shows none of the kind detail.
  const plain = renderFactSheet({ changeType: "ADDITION", symbolKind: "function", arity: 2 }, "facts");
  assert.doesNotMatch(plain, /optional|keyword-only|variadic/);
});

test("renderFactSheet surfaces decorator semantics (#69 catalog C/D)", () => {
  // Behavior flags folded in from decorators — the modifier, never the decorator name.
  const prop = renderFactSheet(
    { changeType: "ADDITION", symbolKind: "function", name: "handler", isProperty: true, decoratorCount: 1 },
    "facts",
  );
  assert.match(prop, /a read-only property/);
  assert.doesNotMatch(prop, /handler|@/, "no symbol name or decorator syntax at facts level");

  const dataclass = renderFactSheet(
    { changeType: "ADDITION", symbolKind: "class", isDataclass: true, methodCount: 0, fieldCount: 2 },
    "facts",
  );
  assert.match(dataclass, /a dataclass/);
  assert.match(dataclass, /2 fields/);

  const staticCached = renderFactSheet(
    { changeType: "ADDITION", symbolKind: "function", isStaticmethod: true, isCached: true },
    "facts",
  );
  assert.match(staticCached, /a static method/);
  assert.match(staticCached, /cached\/memoized/);
});

test("renderFactSheet leads a modification with its change-delta (#69-I)", () => {
  const facts: IntentFacts = {
    changeType: "MODIFICATION",
    symbolKind: "function",
    name: "handle",
    changeDelta: ["adds a loop", "adds error handling", "becomes async"],
    bodyKind: "substantive",
  };
  const sheet = renderFactSheet(facts, "facts");
  assert.match(sheet, /the edit adds a loop, adds error handling, becomes async/);
  assert.doesNotMatch(sheet, /handle/, "the symbol name must not appear at facts level");
});

test("renderFactSheet at 'signatures' adds names and types but never a body", () => {
  const facts: IntentFacts = {
    changeType: "ADDITION",
    symbolKind: "function",
    name: "charge",
    owner: "Invoice",
    arity: 2,
    returnType: "Decimal",
    bodyKind: "substantive",
    lineSpan: 18,
    scopeName: "billing",
  };
  const sheet = renderFactSheet(facts, "signatures");
  assert.match(sheet, /Adds the function `charge` on `Invoice`/);
  assert.match(sheet, /2 parameters/);
  assert.match(sheet, /returns `Decimal`/);
  assert.match(sheet, /a non-trivial body/);
  assert.match(sheet, /about 18 lines/);
  assert.match(sheet, /in `billing`/);
});

// --- Level resolution (buildPromptInput) -----------------------------------------------

test("buildPromptInput at 'facts' drops the name-bearing what/scope and sends only the sheet", () => {
  const input = buildPromptInput(request, "facts");
  assert.equal(input.level, "facts");
  assert.equal(input.what, undefined);
  assert.equal(input.scope, undefined);
  assert.equal(input.before, undefined);
  assert.ok(input.factSheet && !input.factSheet.includes("ccc"));
});

test("buildPromptInput at 'signatures' keeps names but never the code body", () => {
  const input = buildPromptInput(request, "signatures");
  assert.equal(input.level, "signatures");
  assert.equal(input.what, "Added function `ccc`");
  assert.ok(input.factSheet);
  assert.equal(input.before, undefined);
  assert.equal(input.after, undefined);
});

test("buildPromptInput at 'full' sends the real code; without code it degrades to signatures", () => {
  const full = buildPromptInput(request, "full");
  assert.equal(full.level, "full");
  assert.equal(full.after, "def ccc():\n    pass");
  assert.equal(full.factSheet, undefined);

  const degraded = buildPromptInput({ ...request, code: undefined }, "full");
  assert.equal(degraded.level, "signatures");
  assert.ok(degraded.factSheet);
  assert.equal(degraded.after, undefined);
});

// --- Prompt rendering ------------------------------------------------------------------

test("the facts-level prompt tells the model it has a summary, not the source", () => {
  const prompt = buildExplainPrompt(buildPromptInput(request, "signatures"));
  assert.match(prompt, /STRUCTURED\s+SUMMARY of the change \(NOT the source code\)/);
  assert.match(prompt, /Change summary:/);
  assert.doesNotMatch(prompt, /Removed code:|Added code:/);
  assert.match(prompt, /do NOT give review-process advice/i);
  assert.match(prompt, /raises\s+NotImplementedError/);
  // Anti-fabrication guardrail (#68): from a coarse fact sheet the model must not invent
  // computation/purpose — that is how a stub `print()+return 99` became "performs some internal
  // computation". Facts-level prompt must forbid it and use only the listed facts.
  assert.match(prompt, /using ONLY the\s+facts listed below/i);
  assert.match(prompt, /Describe ONLY what the facts state/);
  assert.match(prompt, /performs computation|does internal work/);
  // The "name the actual operation" nudge is CODE-level only; it manufactures operations at
  // facts level, so it must be absent here.
  assert.doesNotMatch(prompt, /name the actual operation/);
});

test("the full-level prompt inlines the real code", () => {
  const prompt = buildExplainPrompt(buildPromptInput(request, "full"));
  assert.match(prompt, /WHAT THIS CODE DOES/);
  assert.match(prompt, /Added code:\ndef ccc\(\):\n {4}pass/);
  assert.doesNotMatch(prompt, /Change summary:/);
});

test("buildExplainPrompt caps very large code blocks", () => {
  const huge = `line\n`.repeat(2000);
  const prompt = buildExplainPrompt(buildPromptInput({ ...request, code: { after: huge } }, "full"));
  const added = prompt.slice(prompt.indexOf("Added code:"));
  assert.ok(added.length < 1700, "added code section should be capped");
  assert.match(prompt, /…/);
});

// --- Provider request bodies + response parsing ----------------------------------------

test("request builders produce a one-message body with a token cap", () => {
  const anthropic = anthropicRequest("hello", "claude-haiku-4-5-20251001");
  assert.deepEqual(anthropic, {
    model: "claude-haiku-4-5-20251001",
    max_tokens: 120,
    messages: [{ role: "user", content: "hello" }],
  });
  const openai = openAiRequest("hello", "gpt-4o-mini");
  assert.deepEqual(openai, {
    model: "gpt-4o-mini",
    max_tokens: 120,
    messages: [{ role: "user", content: "hello" }],
  });
});

test("parseAnthropic extracts the first text block and strips wrapping quotes", () => {
  const response = { content: [{ type: "text", text: "\"Doubles the tax rate applied to every price.\"" }] };
  assert.equal(parseAnthropic(response), "Doubles the tax rate applied to every price.");
});

test("parseAnthropic returns undefined for a malformed response", () => {
  assert.equal(parseAnthropic({}), undefined);
  assert.equal(parseAnthropic({ content: [] }), undefined);
  assert.equal(parseAnthropic(null), undefined);
});

test("parseOpenAi extracts the first choice message content", () => {
  const response = { choices: [{ message: { content: "Doubles the tax rate." } }] };
  assert.equal(parseOpenAi(response), "Doubles the tax rate.");
});

test("parseOpenAi returns undefined for a malformed response", () => {
  assert.equal(parseOpenAi({}), undefined);
  assert.equal(parseOpenAi({ choices: [] }), undefined);
  assert.equal(parseOpenAi(null), undefined);
});

test("the cleaner keeps up to two sentences of prose", () => {
  const two = "Adds an empty placeholder that does nothing. It has no body yet, just a pass.";
  const response = { choices: [{ message: { content: two } }] };
  assert.equal(parseOpenAi(response), two);
});

// --- Cache key -------------------------------------------------------------------------

test("explainCacheKey is stable and varies with the resolved payload (incl. level)", () => {
  const signatures = buildPromptInput(request, "signatures");
  const key = explainCacheKey(signatures);
  assert.match(key, /^intent-explain:[0-9a-z]+$/);
  assert.equal(explainCacheKey(buildPromptInput(request, "signatures")), key, "same payload → same key");
  assert.notEqual(explainCacheKey(buildPromptInput(request, "facts")), key, "level changes the key");
  assert.notEqual(explainCacheKey(buildPromptInput(request, "full")), key, "full code changes the key");
});

test("buildReleaseNarrativePrompt uses only the derived notes and forbids invention", () => {
  const prompt = buildReleaseNarrativePrompt({
    behavior: ["Added retry to `fetch`"],
    internal: ["Renamed `total` → `subtotal`"],
    guardrails: ["Immutable: token changed"],
  });
  // Contains the derived note buckets (no source code).
  assert.match(prompt, /Behavior changes:\n- Added retry to `fetch`/u);
  assert.match(prompt, /Internal changes:\n- Renamed `total` → `subtotal`/u);
  assert.match(prompt, /Guardrail violations:\n- Immutable: token changed/u);
  // Guards the output shape.
  assert.match(prompt, /Do not invent changes/u);
  assert.match(prompt, /no bullet lists, no headings/u);
});

test("releaseNarrativeCacheKey is stable per notes and changes with content", () => {
  const a = releaseNarrativeCacheKey({ behavior: ["x"], internal: [], guardrails: [] });
  assert.match(a, /^release-narrative:[0-9a-z]+$/u);
  assert.equal(a, releaseNarrativeCacheKey({ behavior: ["x"], internal: [], guardrails: [] }));
  assert.notEqual(a, releaseNarrativeCacheKey({ behavior: ["y"], internal: [], guardrails: [] }));
});
