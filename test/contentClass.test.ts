import assert from "node:assert/strict";
import test from "node:test";
import { contentClassForDiff, contentClassForParts, isCodeContent } from "../src/contentClass";
import type { SemanticChange, SemanticDiff } from "../src/types";

const codeNode: SemanticChange = { change_type: "ADDITION", new_node: { node_type: "function_definition", label: "f" } };
const rustNode: SemanticChange = { change_type: "ADDITION", new_node: { node_type: "function_item", label: "f" } };
const textNode: SemanticChange = { change_type: "ADDITION", new_node: { node_type: "text_line", label: "/.intentumdiff" } };

test("contentClassForParts maps languages and node shapes", () => {
  assert.equal(contentClassForParts("gitignore", undefined, [textNode]), "config");
  assert.equal(contentClassForParts("markdown", undefined, []), "docs");
  assert.equal(contentClassForParts("json", undefined, []), "data");
  assert.equal(contentClassForParts("yaml", undefined, []), "data");
  // Real code: a code-construct node type is the reliable signal, even without a language.
  assert.equal(contentClassForParts(undefined, undefined, [codeNode]), "code");
  assert.equal(contentClassForParts("rust", undefined, [rustNode]), "code");
  // Generic/text parser output → text, never mislabelled as code.
  assert.equal(contentClassForParts("generic", undefined, [textNode]), "text");
  assert.equal(contentClassForParts(undefined, undefined, [textNode]), "text");
  // A known code language with only sparse nodes still reads as code.
  assert.equal(contentClassForParts("python", undefined, []), "code");
});

test("content_type category disambiguates documents", () => {
  assert.equal(contentClassForParts("", "document", [textNode]), "docs");
});

test("contentClassForDiff reads the diff's language + changes", () => {
  const gitignore: SemanticDiff = { language: "gitignore", changes: [textNode] };
  assert.equal(contentClassForDiff(gitignore), "config");
  assert.equal(isCodeContent(contentClassForDiff(gitignore)), false);
  const py: SemanticDiff = { language: "python", changes: [codeNode] };
  assert.equal(contentClassForDiff(py), "code");
  assert.equal(isCodeContent(contentClassForDiff(py)), true);
});
