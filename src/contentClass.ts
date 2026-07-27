import type { SemanticChange, SemanticDiff } from "./types";

/**
 * The kind of content a changed file holds, used to keep intent explanations honest:
 * code heuristics ("public API", "function", stub detection) apply only to `code`.
 *
 * Pure (no vscode import) so it stays unit-testable and reusable by both the
 * deterministic explainer and the CodeLens.
 */
export type ContentClass = "code" | "docs" | "config" | "data" | "text";

const DOCS_LANGS = new Set([
  "markdown", "md", "mdx", "rst", "restructuredtext", "asciidoc", "adoc", "org", "textile",
]);
const CONFIG_LANGS = new Set([
  "gitignore", "ignore", "ini", "toml", "dotenv", "env", "properties", "editorconfig",
  "conf", "cfg", "dockerfile", "makefile", "make", "gitattributes", "gitconfig",
]);
const DATA_LANGS = new Set([
  "json", "jsonc", "json5", "yaml", "yml", "xml", "csv", "tsv", "plist",
]);
const TEXT_LANGS = new Set(["generic", "plaintext", "plain", "text", "txt", ""]);

/**
 * A code-construct node type only real language parsers emit — the generic/text
 * fallback parser produces `text_line` / `character_span` / `line`, never these.
 * This is the reliable "this file is actually code" signal.
 */
const CODE_NODE_RE =
  /_definition|_declaration|_item\b|_specifier|_statement|_expression|function|class|method|struct|enum|trait|interface|module|namespace|impl\b/iu;

function hasCodeNode(diff: SemanticDiff | undefined): boolean {
  for (const change of diff?.changes ?? []) {
    const type = change.new_node?.node_type ?? change.old_node?.node_type ?? "";
    if (type && CODE_NODE_RE.test(type)) {
      return true;
    }
  }
  return false;
}

/** Classify a file's content from its language, magic-byte category, and node shapes. */
export function contentClassForParts(
  language: string | undefined,
  contentCategory: string | undefined,
  changes: SemanticChange[] | undefined,
): ContentClass {
  const lang = (language ?? "").toLowerCase();
  if (DOCS_LANGS.has(lang)) {
    return "docs";
  }
  if (CONFIG_LANGS.has(lang)) {
    return "config";
  }
  if (DATA_LANGS.has(lang)) {
    return "data";
  }
  const category = (contentCategory ?? "").toLowerCase();
  if (category === "document" || category === "documentation") {
    return "docs";
  }
  // Reliable "is code" signal: at least one change carries a code-construct node type.
  for (const change of changes ?? []) {
    const type = change.new_node?.node_type ?? change.old_node?.node_type ?? "";
    if (type && CODE_NODE_RE.test(type)) {
      return "code";
    }
  }
  // Known code language even when node types are sparse (e.g. only comment changes).
  return TEXT_LANGS.has(lang) ? "text" : "code";
}

/** Content class for a whole {@link SemanticDiff}. */
export function contentClassForDiff(diff: SemanticDiff | undefined): ContentClass {
  return contentClassForParts(
    diff?.language,
    diff?.metadata?.content_type?.category,
    diff?.changes,
  );
}

export function isCodeContent(contentClass: ContentClass): boolean {
  return contentClass === "code";
}

/** Human noun for a non-code class, e.g. "documentation", "configuration". */
export function contentNoun(contentClass: ContentClass): string {
  switch (contentClass) {
    case "docs":
      return "documentation";
    case "config":
      return "configuration";
    case "data":
      return "data";
    default:
      return "text";
  }
}

/** Short pill label for a non-code content change. */
export function contentLabel(contentClass: ContentClass): string {
  switch (contentClass) {
    case "docs":
      return "Docs";
    case "config":
      return "Config";
    case "data":
      return "Data";
    default:
      return "Content";
  }
}

// `hasCodeNode` is exported for callers that already hold a diff and want the raw signal.
export { hasCodeNode };
