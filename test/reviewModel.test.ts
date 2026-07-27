import assert from "node:assert/strict";
import test from "node:test";
import {
  groupReviewFiles,
  nextReviewFileGroupingMode,
  normalizeReviewFileGroupingMode,
  reviewEntriesForCrossFileChanges,
  reviewEntriesForFile,
  resolveReviewFileGroupingMode,
  schemaCompactDescription,
  sortReviewFiles,
  summarizeReview,
  summarizeReviewWithCrossFile,
  tooltipForReviewEntry,
  tooltipForReviewFile,
  type ReviewFile,
} from "../src/reviewModel";

const guardrailFile: ReviewFile = {
  folderName: "repo",
  folderUri: "file:///repo",
  relativePath: "config.yaml",
  status: "ready",
  diff: {
    language: "yaml",
    guardrail_violations: [{
      rule_id: "prod-host",
      severity: "immutable",
      file: "config.yaml",
      language: "yaml",
      semantic_path: "server.host",
      old_value: "localhost",
      new_value: "prod.example.com",
      message: "Protected host changed",
      position: { start_line: 1, start_col: 0, end_line: 1, end_col: 10 },
    }],
    changes: [{
      change_type: "MODIFICATION",
      description: "Update server.host",
    }],
  },
};

test("review entries prioritize guardrails before refactorings and changes", () => {
  const entries = reviewEntriesForFile({
    ...guardrailFile,
    diff: {
      ...guardrailFile.diff,
      change_groups: [{
        kind: "REFACTORING",
        refactoring_kind: "RENAME_VARIABLE",
        rule_id: "presentation.final_refactoring_group",
      }],
    },
  });

  assert.deepEqual(entries.map((entry) => entry.kind), ["guardrail", "refactoring", "raw-evidence"]);
  assert.equal(entries[0].label, "Protected host changed");
});

test("review entries surface semantic groups before raw change evidence", () => {
  const reviewFile: ReviewFile = {
    folderName: "repo",
    folderUri: "file:///repo",
    relativePath: "src/app.py",
    status: "ready",
    diff: {
      language: "python",
      guardrail_violations: [{
        rule_id: "protected-symbol",
        severity: "important",
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
          rule_id: "presentation.final_move_group",
        },
        {
          kind: "REFACTORING",
          raw_change_indices: [1],
          old_labels: ["addr"],
          new_labels: ["address"],
          refactoring_kind: "RENAME_VARIABLE",
          confidence: 0.92,
          rule_id: "presentation.final_refactoring_group",
        },
        {
          kind: "MEANINGFUL_CHANGE",
          raw_change_indices: [2],
          old_labels: ["md5"],
          new_labels: ["sha256"],
          rule_id: "refinement.moved_entity_leaf_update",
        },
        {
          kind: "IGNORED_STYLE",
          raw_change_indices: [3],
          old_labels: ["foo"],
          new_labels: ["foo"],
          rule_id: "python.formatting.call_wrapping_equivalence",
        },
        {
          kind: "NOISE_SUPPRESSED",
          raw_change_indices: [4],
          rule_id: "refinement.suppress_descendant_moves",
          metadata: { suppressed_count: 3 },
        },
      ],
      changes: [
        {
          change_type: "MOVE",
          description: "Move calc_hash",
          old_node: {
            label: "calc_hash",
            position: { start_line: 30, start_col: 0, end_line: 34, end_col: 0 },
          },
          new_node: {
            label: "calc_hash",
            position: { start_line: 8, start_col: 0, end_line: 12, end_col: 0 },
          },
        },
        {
          change_type: "REFACTORING",
          refactoring_kind: "RENAME_VARIABLE",
          description: "Rename addr to address",
          new_node: {
            label: "address",
            position: { start_line: 20, start_col: 4, end_line: 20, end_col: 11 },
          },
        },
        {
          change_type: "MODIFICATION",
          description: "Update md5 to sha256",
          new_node: {
            label: "sha256",
            position: { start_line: 9, start_col: 16, end_line: 9, end_col: 24 },
          },
        },
        {
          change_type: "MODIFICATION",
          description: "Formatting wrapper evidence",
          new_node: {
            label: "foo",
            position: { start_line: 40, start_col: 2, end_line: 40, end_col: 8 },
          },
        },
        {
          change_type: "REORDER",
          description: "Suppressed reorder evidence",
          old_node: {
            node_type: "identifier",
            label: "child",
            position: { start_line: 70, start_col: 2, end_line: 70, end_col: 7 },
          },
          new_node: {
            node_type: "identifier",
            label: "child",
            position: { start_line: 50, start_col: 2, end_line: 50, end_col: 7 },
          },
        },
        {
          change_type: "MODIFICATION",
          description: "Update retry limit",
          new_node: {
            node_type: "identifier",
            label: "retry_limit",
            position: { start_line: 61, start_col: 8, end_line: 61, end_col: 19 },
          },
        },
      ],
    },
  };
  const entries = reviewEntriesForFile(reviewFile);

  assert.deepEqual(entries.map((entry) => entry.kind), [
    "guardrail",
    "moved-code",
    "refactoring",
    "meaningful",
    "ignored-style",
    "noise-suppressed",
    "raw-evidence",
  ]);
  assert.equal(entries[1].label, "Moved code: calc_hash");
  assert.equal(entries[1].positionSide, "modified");
  assert.equal(entries[1].position?.start_line, 8);
  assert.equal(entries[2].label, "Rename Variable: addr -> address");
  assert.equal(entries[3].label, "Meaningful change: md5 -> sha256");
  assert.equal(entries[4].label, "Ignored style changes");
  assert.equal(entries[4].description, "python.formatting.call_wrapping_equivalence");
  assert.equal(entries[5].label, "Suppressed 3 noisy changes");
  assert.equal(entries[5].description, "refinement.suppress_descendant_moves (3 hidden)");
  assert.equal(entries[5].position?.start_line, 50);
  assert.equal(entries[6].label, "Raw evidence");
  assert.equal(entries[6].description, "1 change");
  assert.equal(entries[6].evidence?.[0].label, "Update retry limit");

  assert.equal(entries[1].evidence?.length, 1);
  assert.equal(entries[1].evidence?.[0].kind, "evidence");
  assert.equal(entries[1].evidence?.[0].label, "Move calc_hash");
  assert.equal(entries[1].evidence?.[0].positionSide, "modified");
  assert.equal(entries[1].evidence?.[0].position?.start_line, 8);
  assert.equal(entries[2].evidence?.[0].label, "Rename addr to address");
  assert.equal(entries[4].evidence?.[0].label, "Formatting wrapper evidence");
  assert.equal(entries[5].evidence?.[0].label, "Suppressed reorder evidence");
  assert.equal(entries.some((entry) => entry.label === "Move calc_hash"), false);

  const fileTooltip = tooltipForReviewFile(reviewFile);
  assert.match(fileTooltip, /src\/app\.py/u);
  assert.match(fileTooltip, /Language: python/u);
  assert.match(fileTooltip, /1 guardrail/u);
  assert.match(fileTooltip, /4 review groups/u);
  assert.match(fileTooltip, /1 suppressed-noise group/u);
  assert.match(fileTooltip, /6 raw changes/u);

  const refactoringTooltip = tooltipForReviewEntry(entries[2]);
  assert.match(refactoringTooltip, /Kind: REFACTORING/u);
  assert.match(refactoringTooltip, /Rule: presentation\.final_refactoring_group/u);
  assert.match(refactoringTooltip, /Confidence: 92%/u);
  assert.match(refactoringTooltip, /Old label: addr/u);
  assert.match(refactoringTooltip, /New label: address/u);
  assert.match(refactoringTooltip, /Evidence: 1 raw change/u);
  assert.match(refactoringTooltip, /Target: modified line 21/u);

  const evidenceTooltip = tooltipForReviewEntry(entries[2].evidence?.[0]!);
  assert.match(evidenceTooltip, /Change: REFACTORING/u);
  assert.match(evidenceTooltip, /Refactoring: Rename Variable/u);
  assert.match(evidenceTooltip, /Side: modified/u);
  assert.match(evidenceTooltip, /New node: address/u);
});

test("review entries surface fuel, parser, and fallback diagnostics instead of clean state", () => {
  const reviewFile: ReviewFile = {
    folderName: "repo",
    folderUri: "file:///repo",
    relativePath: "src/large.ts",
    status: "ready",
    diff: {
      language: "typescript",
      is_fallback: true,
      parse_errors: [
        "FUEL_EXCEEDED: 1.0K file='src/large.ts'",
        "recoverable parser warning",
      ],
      metadata: {
        engine_telemetry: {
          fuel_hotspots: [{
            language: "typescript",
            function: "process",
            filename: "src/large.ts",
            fuel_consumed: 20000000,
          }],
        },
      },
      changes: [],
      change_groups: [],
    },
  };

  const entries = reviewEntriesForFile(reviewFile);

  assert.deepEqual(entries.map((entry) => entry.label), [
    "Excessive parser fuel",
    "Fuel limit exceeded",
    "Parser fallback used",
    "Parser warning",
  ]);
  assert.deepEqual(entries.map((entry) => entry.severity), [
    "warning",
    "error",
    "warning",
    "warning",
  ]);
  assert.equal(entries.some((entry) => entry.kind === "clean"), false);
  assert.match(entries[0].description ?? "", /typescript process/u);
  assert.match(entries[1].description ?? "", /FUEL_EXCEEDED/u);
});

test("review entries label moved and edited semantic groups distinctly", () => {
  const reviewFile: ReviewFile = {
    folderName: "repo",
    folderUri: "file:///repo",
    relativePath: "src/order.ts",
    status: "ready",
    diff: {
      language: "typescript",
      change_groups: [{
        kind: "MEANINGFUL_CHANGE",
        raw_change_indices: [0],
        old_labels: ["formatOrder"],
        new_labels: ["formatOrder"],
        confidence: 0.8,
        rule_id: "refinement.moved_entity_content_changed",
      }],
      changes: [{
        change_type: "MOVE",
        description: "Move formatOrder",
        old_node: {
          label: "formatOrder",
          position: { start_line: 10, start_col: 0, end_line: 13, end_col: 0 },
        },
        new_node: {
          label: "formatOrder",
          position: { start_line: 1, start_col: 0, end_line: 4, end_col: 0 },
        },
      }],
    },
  };

  const entries = reviewEntriesForFile(reviewFile);

  assert.equal(entries[0].kind, "meaningful");
  assert.equal(entries[0].label, "Moved and edited: formatOrder");
  assert.equal(entries[0].description, "refinement.moved_entity_content_changed (80%)");
});

test("review entries keep added package configuration keys visible", () => {
  const entries = reviewEntriesForFile({
    folderName: "repo",
    folderUri: "file:///repo",
    relativePath: "plugins/vscode/package.json",
    status: "ready",
    diff: {
      language: "json",
      changes: [
        {
          change_type: "ADDITION",
          description: "Insert -> pair('intentdiff.diff.fallbackDiff')",
          new_node: {
            node_type: "pair",
            label: "intentdiff.diff.fallbackDiff",
            position: { start_line: 215, start_col: 8, end_line: 219, end_col: 9 },
            children: [],
          },
        },
        {
          change_type: "ADDITION",
          description: "Insert -> pair('intentdiff.diff.hideComments')",
          new_node: {
            node_type: "pair",
            label: "intentdiff.diff.hideComments",
            position: { start_line: 220, start_col: 8, end_line: 224, end_col: 9 },
            children: [],
          },
        },
      ],
    },
  });

  assert.deepEqual(
    entries.map((entry) => entry.label),
    [
      "Insert -> pair('intentdiff.diff.fallbackDiff')",
      "Insert -> pair('intentdiff.diff.hideComments')",
    ],
  );
  assert.deepEqual(entries.map((entry) => entry.description), ["ADDITION", "ADDITION"]);
});

test("review entries narrate added files before raw evidence and never as style-only", () => {
  const reviewFile: ReviewFile = {
    folderName: "repo",
    folderUri: "file:///repo",
    relativePath: "boo.py",
    status: "ready",
    diff: {
      language: "python",
      is_style_only: false,
      metadata: { file_lifecycle: "added" },
      change_groups: [{
        kind: "IGNORED_STYLE",
        raw_change_indices: [0],
        rule_id: "python.formatting.blank_lines",
      }],
      changes: [
        {
          change_type: "ADDITION",
          description: "Insert -> function_definition('boo')",
          new_node: {
            node_type: "function_definition",
            label: "boo",
            position: { start_line: 0, start_col: 0, end_line: 1, end_col: 17 },
            children: [],
          },
        },
        {
          change_type: "ADDITION",
          description: "Insert -> function_definition('boo2')",
          new_node: {
            node_type: "function_definition",
            label: "boo2",
            position: { start_line: 9, start_col: 0, end_line: 10, end_col: 18 },
            children: [],
          },
        },
      ],
    },
  };

  const entries = reviewEntriesForFile(reviewFile);

  assert.deepEqual(entries.map((entry) => entry.kind), ["file-lifecycle", "raw-evidence"]);
  assert.equal(entries[0].label, "New Python file");
  assert.equal(entries[0].description, "2 added changes");
  assert.equal(entries[1].evidence?.length, 2);
  assert.equal(entries.some((entry) => entry.kind === "ignored-style"), false);
  assert.match(tooltipForReviewFile(reviewFile), /New file/u);
  assert.doesNotMatch(tooltipForReviewFile(reviewFile), /Style-only/u);
});

test("ungrouped change on a modified file with no intent groups is a first-class meaningful entry", () => {
  // The .gitignore case: the generic token-churn noise group is emptied at the source, so the
  // real `/.intentdiff` insert is owned by no group. With no shown intent groups telling the
  // story, it must surface as its own Meaningful entry — not demoted under "Raw evidence".
  const reviewFile: ReviewFile = {
    folderName: "repo",
    folderUri: "file:///repo",
    relativePath: ".gitignore",
    status: "ready",
    diff: {
      language: "generic",
      change_groups: [{
        kind: "NOISE_SUPPRESSED",
        raw_change_indices: [],
        rule_id: "presentation.generic_text_diff",
        metadata: { suppressed_count: 4 },
      }],
      changes: [{
        change_type: "ADDITION",
        description: "Insert line 86: '/.intentdiff'",
        new_node: {
          node_type: "text_line",
          label: "/.intentdiff",
          position: { start_line: 85, start_col: 0, end_line: 85, end_col: 12 },
        },
      }],
    },
  };

  const entries = reviewEntriesForFile(reviewFile);
  const kinds = entries.map((entry) => entry.kind);
  assert.ok(kinds.includes("meaningful"), "the ungrouped insert is a first-class meaningful entry");
  assert.ok(!kinds.includes("raw-evidence"), "it is not demoted to a Raw evidence node");
  const meaningful = entries.find((entry) => entry.kind === "meaningful");
  assert.equal(meaningful?.label, "Insert line 86: '/.intentdiff'");
  // The emptied noise group still shows its "(N hidden)" summary.
  assert.ok(entries.some((entry) => entry.kind === "noise-suppressed"));
});

test("ungrouped change stays raw-evidence when shown intent groups already tell the story", () => {
  // A modified code file with a real refactoring group + one ungrouped leftover modification:
  // the leftover belongs in the collapsed raw-evidence bucket, not promoted beside the group.
  const reviewFile: ReviewFile = {
    folderName: "repo",
    folderUri: "file:///repo",
    relativePath: "app.py",
    status: "ready",
    diff: {
      language: "python",
      change_groups: [{
        kind: "REFACTORING",
        raw_change_indices: [0],
        refactoring_kind: "RENAME_VARIABLE",
        rule_id: "presentation.final_refactoring_group",
        new_node_ids: ["n0"],
      }],
      changes: [
        {
          change_type: "REFACTORING",
          refactoring_kind: "RENAME_VARIABLE",
          description: "Rename amt to amount",
          new_node: { node_type: "identifier", label: "amount", id: "n0", position: { start_line: 5, start_col: 0, end_line: 5, end_col: 6 } },
        },
        {
          change_type: "MODIFICATION",
          description: "Tweak leftover",
          new_node: { node_type: "identifier", label: "x", position: { start_line: 20, start_col: 0, end_line: 20, end_col: 1 } },
        },
      ],
    },
  };

  const entries = reviewEntriesForFile(reviewFile);
  const kinds = entries.map((entry) => entry.kind);
  assert.deepEqual(kinds, ["refactoring", "raw-evidence"]);
});

test("review entries narrate deleted files before raw evidence and never as style-only", () => {
  const reviewFile: ReviewFile = {
    folderName: "repo",
    folderUri: "file:///repo",
    relativePath: "old.py",
    status: "ready",
    diff: {
      language: "python",
      is_style_only: true,
      metadata: { file_lifecycle: "deleted" },
      change_groups: [{
        kind: "IGNORED_STYLE",
        raw_change_indices: [0],
        rule_id: "python.formatting.blank_lines",
      }],
      changes: [{
        change_type: "DELETION",
        description: "Delete -> function_definition('old')",
        old_node: {
          node_type: "function_definition",
          label: "old",
          position: { start_line: 0, start_col: 0, end_line: 1, end_col: 17 },
          children: [],
        },
      }],
    },
  };

  const entries = reviewEntriesForFile(reviewFile);

  assert.deepEqual(entries.map((entry) => entry.kind), ["file-lifecycle", "raw-evidence"]);
  assert.equal(entries[0].label, "Deleted Python file");
  assert.equal(entries[0].description, "1 deleted change");
  assert.equal(entries[1].evidence?.length, 1);
  assert.equal(entries.some((entry) => entry.kind === "ignored-style"), false);
  assert.equal(entries.some((entry) => entry.kind === "style"), false);
  assert.match(tooltipForReviewFile(reviewFile), /Deleted file/u);
  assert.doesNotMatch(tooltipForReviewFile(reviewFile), /Style-only/u);
});

test("review entries show schema status for used and missing schemas", () => {
  const usedSchemaFile: ReviewFile = {
    folderName: "repo",
    folderUri: "file:///repo",
    relativePath: "databricks.yml",
    status: "ready",
    diff: {
      language: "databricks-workflow",
      metadata: {
        schema: {
          provider_id: "databricks:bundle",
          status: "cache_hit",
          source_url: "https://example.test/databricks.json",
          identity_fields: ["job_cluster_key", "task_key"],
          detected: true,
          available: true,
        },
      },
      changes: [],
    },
  };
  const usedEntries = reviewEntriesForFile(usedSchemaFile);

  assert.deepEqual(usedEntries.map((entry) => entry.kind), ["schema-status"]);
  assert.equal(usedEntries[0].label, "Schema used: Databricks bundle");
  assert.equal(usedEntries[0].description, "2 identity hints");
  assert.equal(schemaCompactDescription(usedSchemaFile.diff), "Databricks bundle schema");
  assert.match(tooltipForReviewFile(usedSchemaFile), /Schema: Databricks bundle \(cache hit\)/u);
  assert.match(tooltipForReviewEntry(usedEntries[0]), /Identity hints: job_cluster_key, task_key/u);

  const missingSchemaFile: ReviewFile = {
    folderName: "repo",
    folderUri: "file:///repo",
    relativePath: "dbt_project.yml",
    status: "ready",
    diff: {
      language: "yaml",
      metadata: {
        schema: {
          provider_id: "dbt:dbt_project",
          status: "cache_miss",
          source_url: "https://example.test/dbt_project.json",
          identity_fields: [],
          detected: true,
          available: false,
        },
      },
      changes: [],
    },
  };
  const missingEntries = reviewEntriesForFile(missingSchemaFile);

  assert.equal(missingEntries[0].label, "Schema detected but cache missing: dbt project");
  assert.equal(missingEntries[0].description, "Cache Miss");
  assert.equal(schemaCompactDescription(missingSchemaFile.diff), "dbt project schema missing");
  assert.match(tooltipForReviewFile(missingSchemaFile), /Schema: dbt project detected, cache miss/u);
});

test("review entries show ADF detected but unavailable schema status", () => {
  const entries = reviewEntriesForFile({
    folderName: "repo",
    folderUri: "file:///repo",
    relativePath: "pipeline.json",
    status: "ready",
    diff: {
      language: "json",
      metadata: {
        schema: {
          provider_id: "adf:no_raw_schema",
          status: "no_raw_schema",
          source_url: "https://learn.microsoft.com/adf/schema-note",
          identity_fields: [],
          detected: true,
          available: false,
        },
      },
      changes: [],
    },
  });

  assert.deepEqual(entries.map((entry) => entry.kind), ["schema-status"]);
  assert.equal(entries[0].label, "Schema detected but unavailable: ADF raw source");
  assert.equal(entries[0].description, "no raw schema available");
  assert.match(tooltipForReviewEntry(entries[0]), /Available: no/u);
});

test("review entries show image assets even when no engine change-groups exist", () => {
  const entries = reviewEntriesForFile({
    folderName: "repo",
    folderUri: "file:///repo",
    relativePath: "artifacts/release-media-review/intentdiff-vscode-language-sweep.png",
    status: "ready",
    diff: {
      old_filename: "artifacts/release-media-review/intentdiff-vscode-language-sweep.png",
      new_filename: "artifacts/release-media-review/intentdiff-vscode-language-sweep.png",
      language: "png",
      has_semantic_changes: false,
      is_style_only: false,
      parse_errors: [],
      change_groups: [],
      changes: [],
      guardrail_violations: [],
      metadata: {},
    },
  });

  assert.deepEqual(entries.map((entry) => entry.kind), ["asset"]);
  assert.equal(entries[0].label, "Image asset: intentdiff-vscode-language-sweep.png");
  assert.equal(entries[0].description, "image asset review");
});

test("review change entries follow source order before label order", () => {
  const entries = reviewEntriesForFile({
    folderName: "repo",
    folderUri: "file:///repo",
    relativePath: "plugins/vscode/package.json",
    status: "ready",
    diff: {
      language: "json",
      changes: [
        {
          change_type: "ADDITION",
          description: "Insert -> string('z')",
          new_node: {
            node_type: "string",
            label: "z",
            position: { start_line: 10, start_col: 4, end_line: 10, end_col: 7 },
            children: [],
          },
        },
        {
          change_type: "ADDITION",
          description: "Insert -> string('a')",
          new_node: {
            node_type: "string",
            label: "a",
            position: { start_line: 2, start_col: 4, end_line: 2, end_col: 7 },
            children: [],
          },
        },
      ],
    },
  });

  assert.deepEqual(entries.map((entry) => entry.label), [
    "Insert -> string('a')",
    "Insert -> string('z')",
  ]);
});

test("review deletion entries target base-file coordinates", () => {
  const entries = reviewEntriesForFile({
    folderName: "repo",
    folderUri: "file:///repo",
    relativePath: "plugins/vscode/src/mapper.ts",
    status: "ready",
    diff: {
      language: "typescript",
      changes: [
        {
          change_type: "DELETION",
          description: "Delete shorthand_property_identifier('position')",
          old_node: {
            node_type: "shorthand_property_identifier",
            label: "position",
            position: { start_line: 83, start_col: 8, end_line: 83, end_col: 16 },
            children: [],
          },
        },
        {
          change_type: "ADDITION",
          description: "Insert -> lexical_declaration('decorationPosition')",
          new_node: {
            node_type: "lexical_declaration",
            label: "decorationPosition",
            position: { start_line: 83, start_col: 4, end_line: 83, end_col: 42 },
            children: [],
          },
        },
      ],
    },
  });

  const deletion = entries.find((entry) => entry.description === "DELETION");
  const addition = entries.find((entry) => entry.description === "ADDITION");

  assert.equal(deletion?.positionSide, "base");
  assert.equal(deletion?.position?.start_line, 83);
  assert.equal(addition?.positionSide, "modified");
});

test("pending review file exposes a visible status entry", () => {
  const entries = reviewEntriesForFile({
    folderName: "repo",
    folderUri: "file:///repo",
    relativePath: ".intentdiff-review",
    status: "pending",
    pendingMessage: "Still waiting for LiveServer review response (seq 5)...",
  });

  assert.equal(entries.length, 1);
  assert.equal(entries[0].kind, "clean");
  assert.equal(entries[0].label, "Still waiting for LiveServer review response (seq 5)...");
});

test("review summary counts severities, clean files, style-only files, and skips", () => {
  const summary = summarizeReview([
    guardrailFile,
    {
      folderName: "repo",
      folderUri: "file:///repo",
      relativePath: "clean.yaml",
      status: "ready",
      diff: { changes: [] },
    },
    {
      folderName: "repo",
      folderUri: "file:///repo",
      relativePath: "style.yaml",
      status: "ready",
      diff: { changes: [], is_style_only: true },
    },
    {
      folderName: "repo",
      folderUri: "file:///repo",
      relativePath: "deleted.generated.json",
      status: "ready",
      diff: {
        old_filename: "deleted.generated.json",
        changes: [],
        is_style_only: true,
      },
    },
    {
      folderName: "repo",
      folderUri: "file:///repo",
      relativePath: "binary.dat",
      status: "skipped",
      skippedReason: "Binary file",
    },
  ]);

  assert.equal(summary.fileCount, 5);
  assert.equal(summary.guardrailCount, 1);
  assert.equal(summary.crossFileChangeCount, 0);
  assert.equal(summary.immutableCount, 1);
  assert.equal(summary.semanticChangeCount, 1);
  assert.equal(summary.cleanCount, 1);
  assert.equal(summary.styleOnlyCount, 1);
  assert.equal(summary.skippedCount, 1);
});

test("cross-file entries are sorted and target single-file changes", () => {
  const entries = reviewEntriesForCrossFileChanges(
    [
      {
        change_type: "MOVE_TO_MODULE",
        symbol_name: "greet",
        old_file: "a.py",
        new_file: "b.py",
        new_position: { start_line: 8, start_col: 2, end_line: 12, end_col: 0 },
        node_type: "function_definition",
        symbol_kind: "function",
        description: "'greet' moved from 'a.py' to 'b.py'",
      },
      {
        change_type: "SPLIT_MODULE",
        symbol_name: "a.py",
        old_file: "a.py",
        new_file: "b.py, c.py",
        description: "'a.py' was split across files",
      },
    ],
    "file:///repo",
  );

  assert.equal(entries[0].folderUri, "file:///repo");
  assert.deepEqual(entries.map((entry) => entry.change.change_type), [
    "SPLIT_MODULE",
    "MOVE_TO_MODULE",
  ]);
  assert.equal(entries[0].relativePath, undefined);
  assert.equal(entries[1].relativePath, "b.py");
  assert.equal(entries[1].change.new_position?.start_line, 8);
  assert.equal(entries[1].change.symbol_kind, "function");

  const summary = summarizeReviewWithCrossFile([guardrailFile], entries.map((entry) => entry.change));
  assert.equal(summary.crossFileChangeCount, 2);
});

test("sortReviewFiles keeps pinned guardrails above changes and skipped files", () => {
  const sorted = sortReviewFiles([
    {
      folderName: "repo",
      folderUri: "file:///repo",
      relativePath: "z-binary.dat",
      status: "skipped",
      skippedReason: "Binary file",
    },
    {
      folderName: "repo",
      folderUri: "file:///repo",
      relativePath: "b-code.py",
      status: "ready",
      diff: { changes: [{ change_type: "ADDITION" }] },
    },
    guardrailFile,
  ]);

  assert.deepEqual(sorted.map((file) => file.relativePath), [
    "config.yaml",
    "b-code.py",
    "z-binary.dat",
  ]);
});

test("review file grouping auto stays flat for tiny single-language reviews", () => {
  const files: ReviewFile[] = [
    {
      folderName: "repo",
      folderUri: "file:///repo",
      relativePath: "src/app.py",
      status: "ready",
      diff: { language: "python", changes: [{ change_type: "ADDITION" }] },
    },
  ];
  const groups = groupReviewFiles(files, "auto");

  assert.equal(resolveReviewFileGroupingMode(files, "auto"), "none");
  assert.deepEqual(groups, []);
});

test("review file grouping auto groups mixed-language and larger reviews", () => {
  const files: ReviewFile[] = [
    {
      folderName: "repo",
      folderUri: "file:///repo",
      relativePath: "src/app.py",
      status: "ready",
      diff: { language: "python", changes: [{ change_type: "ADDITION" }] },
    },
    {
      folderName: "repo",
      folderUri: "file:///repo",
      relativePath: "plugins/vscode/src/extension.ts",
      status: "ready",
      diff: { language: "typescript", changes: [{ change_type: "MODIFICATION" }] },
    },
  ];
  const mixedGroups = groupReviewFiles(files, "auto");
  const largerGroups = groupReviewFiles([
    ...files,
    {
      folderName: "repo",
      folderUri: "file:///repo",
      relativePath: "src/one.py",
      status: "ready",
      diff: { language: "python", changes: [{ change_type: "ADDITION" }] },
    },
    {
      folderName: "repo",
      folderUri: "file:///repo",
      relativePath: "src/two.py",
      status: "ready",
      diff: { language: "python", changes: [{ change_type: "ADDITION" }] },
    },
  ], "auto");

  assert.deepEqual(mixedGroups.map((group) => group.label), ["Python", "TypeScript"]);
  assert.deepEqual(largerGroups.map((group) => group.label), ["Python", "TypeScript"]);
});

test("review file grouping distinguishes schema used, missing, and unavailable cases", () => {
  const files: ReviewFile[] = [
    {
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
        changes: [{ change_type: "MODIFICATION" }],
      },
    },
    {
      folderName: "repo",
      folderUri: "file:///repo",
      relativePath: "pipeline.json",
      status: "ready",
      diff: {
        language: "json",
        metadata: {
          schema: {
            provider_id: "adf:no_raw_schema",
            status: "no_raw_schema",
            detected: true,
            available: false,
          },
        },
        changes: [{ change_type: "MODIFICATION" }],
      },
    },
    {
      folderName: "repo",
      folderUri: "file:///repo",
      relativePath: "plain.json",
      status: "ready",
      diff: { language: "json", changes: [{ change_type: "ADDITION" }] },
    },
    {
      folderName: "repo",
      folderUri: "file:///repo",
      relativePath: "dbt_project.yml",
      status: "ready",
      diff: {
        language: "yaml",
        metadata: {
          schema: {
            provider_id: "dbt:dbt_project",
            status: "cache_hit",
            detected: true,
            available: true,
          },
        },
        changes: [{ change_type: "MODIFICATION" }],
      },
    },
  ];

  assert.deepEqual(groupReviewFiles(files, "languageThenSchema").map((group) => group.label), [
    "JSON · ADF raw source schema unavailable",
    "JSON · Databricks bundle schema",
    "JSON · schema missing",
    "YAML · dbt project schema",
  ]);
  assert.deepEqual(groupReviewFiles(files, "schema").map((group) => group.label), [
    "ADF raw source schema unavailable",
    "Databricks bundle schema",
    "dbt project schema",
    "JSON · schema missing",
  ]);
  assert.deepEqual(groupReviewFiles(files, "language").map((group) => group.label), ["JSON", "YAML"]);
  assert.deepEqual(groupReviewFiles(files, "none"), []);
});

test("review file grouping mode helpers normalize and cycle modes", () => {
  assert.equal(normalizeReviewFileGroupingMode("schema"), "schema");
  assert.equal(normalizeReviewFileGroupingMode("bogus"), "auto");
  assert.equal(nextReviewFileGroupingMode("auto"), "none");
  assert.equal(nextReviewFileGroupingMode("none"), "language");
  assert.equal(nextReviewFileGroupingMode("language"), "schema");
  assert.equal(nextReviewFileGroupingMode("schema"), "languageThenSchema");
  assert.equal(nextReviewFileGroupingMode("languageThenSchema"), "auto");
});
