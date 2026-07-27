import assert from "node:assert/strict";
import Module from "node:module";
import test from "node:test";
import type { ReviewFile } from "../src/reviewModel";
import type * as vscodeTypes from "vscode";

const vscode = installVscodeMock();
const { SemanticReviewTreeProvider } = require("../src/reviewTree") as typeof import("../src/reviewTree");

const reviewFile: ReviewFile = {
  folderName: "repo",
  folderUri: "file:///repo",
  relativePath: "src/app.py",
  status: "ready",
  diff: {
    language: "python",
    metadata: {
      schema: {
        provider_id: "databricks:bundle",
        status: "cache_hit",
        detected: true,
        available: true,
        identity_fields: ["resources.jobs"],
      },
    },
    guardrail_violations: [{
      rule_id: "protected-symbol",
      severity: "immutable",
      file: "src/app.py",
      language: "python",
      semantic_path: "calc_hash",
      message: "Protected symbol changed",
      position: { start_line: 1, start_col: 0, end_line: 1, end_col: 8 },
    }],
    change_groups: [
      {
        kind: "MOVED_CODE",
        raw_change_indices: [0],
        old_labels: ["calc_hash"],
        new_labels: ["calc_hash"],
      },
      {
        kind: "REFACTORING",
        raw_change_indices: [1],
        old_labels: ["addr"],
        new_labels: ["address"],
        refactoring_kind: "RENAME_VARIABLE",
      },
      {
        kind: "MEANINGFUL_CHANGE",
        raw_change_indices: [2],
        old_labels: ["md5"],
        new_labels: ["sha256"],
      },
      {
        kind: "IGNORED_STYLE",
        raw_change_indices: [3],
        rule_id: "python.formatting.call_wrapping_equivalence",
      },
      {
        kind: "NOISE_SUPPRESSED",
        raw_change_indices: [4],
        metadata: { suppressed_count: 8 },
        rule_id: "presentation.suppress_descendant_noise",
      },
    ],
    changes: [
      {
        change_type: "MOVE",
        description: "Move calc_hash",
        new_node: { position: { start_line: 8, start_col: 0, end_line: 12, end_col: 0 } },
      },
      {
        change_type: "REFACTORING",
        refactoring_kind: "RENAME_VARIABLE",
        description: "Rename addr to address",
        new_node: { label: "address", position: { start_line: 20, start_col: 4, end_line: 20, end_col: 11 } },
      },
      {
        change_type: "MODIFICATION",
        description: "Update md5 to sha256",
        new_node: { label: "sha256", position: { start_line: 9, start_col: 16, end_line: 9, end_col: 24 } },
      },
      {
        change_type: "MODIFICATION",
        description: "Formatting wrapper evidence",
        new_node: { label: "foo", position: { start_line: 40, start_col: 2, end_line: 40, end_col: 8 } },
      },
      {
        change_type: "REORDER",
        description: "Suppressed reorder evidence",
        new_node: { label: "child", position: { start_line: 50, start_col: 2, end_line: 50, end_col: 7 } },
      },
      {
        change_type: "ADDITION",
        description: "Insert retry option",
        new_node: { label: "retry_limit", position: { start_line: 61, start_col: 8, end_line: 61, end_col: 19 } },
      },
    ],
  },
};

test("semantic review tree separates review groups, raw evidence, schema, and guardrails", () => {
  const provider = new SemanticReviewTreeProvider();
  const fileItem = provider.getTreeItem({ kind: "file", file: reviewFile });

  assert.equal(fileItem.description, "python | 1 guardrail | 4 groups | 6 raw | 1 suppressed | Databricks bundle schema");
  assert.equal(themeIconId(fileItem.iconPath), "shield");
  assert.equal(themeIconColorId(fileItem.iconPath), "intentdiff.semanticChanges.guardrail");

  const entryNodes = provider.getChildren({ kind: "file", file: reviewFile });
  assert.deepEqual(entryNodes.map((node) => node.kind === "entry" ? node.entry.kind : node.kind), [
    "guardrail",
    "schema-status",
    "moved-code",
    "refactoring",
    "meaningful",
    "ignored-style",
    "noise-suppressed",
    "raw-evidence",
  ]);

  // Selecting an intent group opens the native diff at its representative line.
  const meaningfulNode = entryNodes.find((node) => node.kind === "entry" && node.entry.kind === "meaningful");
  assert.ok(meaningfulNode?.kind === "entry");
  assert.equal(provider.getTreeItem(meaningfulNode).command?.command, "intentdiff.openSemanticDiff");

  const rawNode = entryNodes.find((node) => node.kind === "entry" && node.entry.kind === "raw-evidence");
  assert.ok(rawNode?.kind === "entry");
  const rawItem = provider.getTreeItem(rawNode);
  assert.equal(rawItem.label, "Ungrouped raw evidence");
  assert.equal(rawItem.description, "ungrouped | 1 change");
  assert.equal(rawItem.collapsibleState, vscode.TreeItemCollapsibleState.Collapsed);

  const evidenceNode = provider.getChildren(rawNode)[0];
  assert.ok(evidenceNode?.kind === "evidence");
  const evidenceItem = provider.getTreeItem(evidenceNode);
  assert.equal(evidenceItem.label, "Evidence: Insert retry option");
  assert.equal(evidenceItem.description, "raw | ADDITION");
  // Selecting evidence opens the native diff at the representative line (spec surface B).
  assert.equal(evidenceItem.command?.command, "intentdiff.openSemanticDiff");
  const evidenceArgs = evidenceItem.command?.arguments?.[0] as { relativePath?: string } | undefined;
  assert.equal(evidenceArgs?.relativePath, reviewFile.relativePath);
});

test("diffSurface setting routes tree selections between native diff and the panel", () => {
  const provider = new SemanticReviewTreeProvider();
  // Default is native.
  assert.equal(
    provider.getTreeItem({ kind: "file", file: reviewFile }).command?.command,
    "intentdiff.openSemanticDiff",
  );

  provider.setDiffSurface("panel");
  assert.equal(
    provider.getTreeItem({ kind: "file", file: reviewFile }).command?.command,
    "intentdiff.openReviewPanel",
  );
  const meaningfulNode = provider
    .getChildren({ kind: "file", file: reviewFile })
    .find((node) => node.kind === "entry" && node.entry.kind === "meaningful");
  assert.ok(meaningfulNode?.kind === "entry");
  assert.equal(provider.getTreeItem(meaningfulNode).command?.command, "intentdiff.openReviewPanel");

  provider.setDiffSurface("native");
  assert.equal(
    provider.getTreeItem({ kind: "file", file: reviewFile }).command?.command,
    "intentdiff.openSemanticDiff",
  );
});

test("semantic review tree uses vivid IntentDiff icons for tree entries", () => {
  const provider = new SemanticReviewTreeProvider();
  const entries = provider.getChildren({ kind: "file", file: reviewFile });
  const icons = new Map(entries.map((node) => [
    node.kind === "entry" ? node.entry.kind : node.kind,
    provider.getTreeItem(node).iconPath,
  ]));

  assert.equal(themeIconId(icons.get("guardrail")), "circle-slash");
  assert.equal(themeIconColorId(icons.get("guardrail")), "intentdiff.semanticChanges.guardrail");
  assert.equal(themeIconId(icons.get("schema-status")), "database");
  assert.equal(themeIconColorId(icons.get("schema-status")), "intentdiff.semanticChanges.schemaStatus");
  assert.equal(themeIconId(icons.get("moved-code")), "diff-renamed");
  assert.equal(themeIconColorId(icons.get("moved-code")), "intentdiff.semanticChanges.movedCode");
  assert.equal(themeIconId(icons.get("refactoring")), "symbol-variable");
  assert.equal(themeIconColorId(icons.get("refactoring")), "intentdiff.semanticChanges.refactoring");
  assert.equal(themeIconId(icons.get("meaningful")), "sparkle");
  assert.equal(themeIconColorId(icons.get("meaningful")), "intentdiff.semanticChanges.meaningful");
  assert.equal(themeIconId(icons.get("ignored-style")), "eye-closed");
  assert.equal(themeIconColorId(icons.get("ignored-style")), "intentdiff.semanticChanges.ignoredStyle");
  assert.equal(themeIconId(icons.get("noise-suppressed")), "eye-closed");
  assert.equal(themeIconColorId(icons.get("noise-suppressed")), "intentdiff.semanticChanges.noiseSuppressed");
});

test("semantic review tree lists image assets as semantic change entries", () => {
  const provider = new SemanticReviewTreeProvider();
  const imageFile: ReviewFile = {
    folderName: "repo",
    folderUri: "file:///repo",
    relativePath: "media/hero.png",
    status: "ready",
    diff: {
      old_filename: "media/hero.png",
      new_filename: "media/hero.png",
      language: "png",
      has_semantic_changes: true,
      is_style_only: false,
      change_groups: [{
        kind: "asset",
        raw_change_indices: [0],
        new_labels: ["hero.png"],
        metadata: {
          asset_provider: "image",
        },
      }],
      changes: [{
        change_type: "MODIFICATION",
        description: "hero.png image asset modified",
        old_node: {
          node_type: "image_asset",
          label: "hero.png",
          position: null,
        },
        new_node: {
          node_type: "image_asset",
          label: "hero.png",
          position: null,
        },
      }],
      metadata: {
        asset_diff: {
          status: "preview",
          summary: "hero.png is a changed image asset.",
        },
      },
    },
  };

  const fileItem = provider.getTreeItem({ kind: "file", file: imageFile });
  assert.equal(fileItem.description, "png | 1 group | 1 raw");
  assert.equal(fileItem.command?.command, "intentdiff.openReviewPanel");

  const entries = provider.getChildren({ kind: "file", file: imageFile });
  assert.deepEqual(entries.map((node) => node.kind === "entry" ? node.entry.kind : node.kind), ["asset"]);

  const assetNode = entries[0];
  assert.ok(assetNode?.kind === "entry");
  const assetItem = provider.getTreeItem(assetNode);
  assert.equal(assetItem.label, "Image asset: hero.png");
  assert.equal(assetItem.description, "asset | image asset review");
  assert.equal(themeIconId(assetItem.iconPath), "file-media");
  assert.equal(themeIconColorId(assetItem.iconPath), "intentdiff.semanticChanges.meaningful");

  const evidenceNode = provider.getChildren(assetNode)[0];
  assert.ok(evidenceNode?.kind === "evidence");
  assert.equal(provider.getTreeItem(evidenceNode).label, "Evidence: hero.png image asset modified");
});

test("semantic review tree groups ordinary files while guardrails stay pinned", () => {
  const provider = new SemanticReviewTreeProvider();
  const pythonFile: ReviewFile = {
    folderName: "repo",
    folderUri: "file:///repo",
    relativePath: "src/worker.py",
    status: "ready",
    diff: {
      language: "python",
      changes: [{ change_type: "ADDITION", description: "Add worker" }],
    },
  };
  const jsonFile: ReviewFile = {
    folderName: "repo",
    folderUri: "file:///repo",
    relativePath: "bundle.json",
    status: "ready",
    diff: {
      language: "json",
      metadata: {
        schema: {
          provider_id: "databricks:bundle",
          status: "cache_hit",
          detected: true,
          available: true,
        },
      },
      changes: [{ change_type: "MODIFICATION", description: "Update bundle" }],
    },
  };
  provider.setReview([pythonFile, reviewFile, jsonFile], []);

  const children = provider.getChildren();

  assert.deepEqual(children.map((node) => node.kind), ["file", "fileGroup", "fileGroup"]);
  assert.ok(children[0].kind === "file");
  assert.equal(children[0].file.relativePath, "src/app.py");

  const groupLabels = children
    .map((node) => node.kind === "fileGroup" ? provider.getTreeItem(node).label : undefined)
    .filter((label): label is string => typeof label === "string");
  assert.deepEqual(groupLabels, ["JSON · Databricks bundle schema", "Python"]);

  const jsonGroup = children.find((node) => node.kind === "fileGroup" && node.group.label.startsWith("JSON"));
  assert.ok(jsonGroup?.kind === "fileGroup");
  assert.equal(themeIconId(provider.getTreeItem(jsonGroup).iconPath), "database");
  assert.deepEqual(
    provider.getChildren(jsonGroup).map((node) => node.kind === "file" ? node.file.relativePath : node.kind),
    ["bundle.json"],
  );
});

function themeIconId(iconPath: vscodeTypes.TreeItem["iconPath"]): string | undefined {
  return iconPath instanceof vscode.ThemeIcon
    ? iconPath.id
    : undefined;
}

function themeIconColorId(iconPath: vscodeTypes.TreeItem["iconPath"]): string | undefined {
  return iconPath instanceof vscode.ThemeIcon
    ? iconPath.color?.id
    : undefined;
}

function installVscodeMock(): typeof vscodeTypes {
  const originalLoad = (Module as unknown as {
    _load: (request: string, parent: NodeModule | null, isMain: boolean) => unknown;
  })._load;

  class ThemeColor {
    constructor(readonly id: string) {}
  }

  class ThemeIcon {
    constructor(
      readonly id: string,
      readonly color?: ThemeColor,
    ) {}
  }

  class TreeItem {
    label: string;
    description?: string;
    tooltip?: string;
    contextValue?: string;
    iconPath?: ThemeIcon;
    command?: { command: string; title: string; arguments?: unknown[] };
    resourceUri?: unknown;

    constructor(label: string, readonly collapsibleState = TreeItemCollapsibleState.None) {
      this.label = label;
    }
  }

  const TreeItemCollapsibleState = {
    None: 0,
    Collapsed: 1,
    Expanded: 2,
  } as const;

  class EventEmitter<T> {
    readonly event = (() => undefined) as unknown;
    fire(_value: T): void {}
    dispose(): void {}
  }

  const mock = {
    ThemeColor,
    ThemeIcon,
    TreeItem,
    TreeItemCollapsibleState,
    EventEmitter,
    Uri: {
      parse(value: string): { fsPath: string } {
        return { fsPath: value.replace(/^file:\/\/\/?/u, "/") };
      },
      file(value: string): { fsPath: string } {
        return { fsPath: value };
      },
    },
  } as unknown as typeof vscodeTypes;

  (Module as unknown as {
    _load: (request: string, parent: NodeModule | null, isMain: boolean) => unknown;
  })._load = function load(request, parent, isMain) {
    if (request === "vscode") {
      return mock;
    }
    return originalLoad.call(this, request, parent, isMain);
  };

  return mock;
}
