import assert from "node:assert/strict";
import test from "node:test";
import {
  diffToBaseDecorations,
  diffToDecorations,
  diffToDiagnostics,
  diffToModifiedDecorations,
  reviewTargetForChange,
  statusText,
  summarizeDiff,
} from "../src/mapper";
import type { SemanticDiff } from "../src/types";

const sampleDiff: SemanticDiff = {
  language: "yaml",
  guardrail_violations: [
    {
      rule_id: "prod-host",
      severity: "immutable",
      file: "config.yaml",
      language: "yaml",
      semantic_path: "server.host",
      old_value: "localhost",
      new_value: "prod.example.com",
      message: "Production host changed",
      position: { start_line: 3, start_col: 2, end_line: 3, end_col: 24 },
    },
  ],
  parse_errors: ["recoverable parse warning"],
  change_groups: [
    {
      kind: "REFACTORING",
      refactoring_kind: "RENAME_SYMBOL",
    },
  ],
  changes: [
    {
      change_type: "ADDITION",
      description: "Insert setting",
      new_node: {
        node_type: "pair",
        label: "host",
        position: { start_line: 3, start_col: 2, end_line: 3, end_col: 24 },
      },
    },
    {
      change_type: "REFACTORING",
      refactoring_kind: "RENAME_SYMBOL",
      description: "Rename symbol",
      new_node: {
        position: { start_line: 6, start_col: 0, end_line: 6, end_col: 8 },
      },
    },
    {
      change_type: "DELETION",
      description: "Remove old setting",
      old_node: {
        position: { start_line: 8, start_col: 0, end_line: 8, end_col: 10 },
      },
    },
  ],
};

test("summarizeDiff counts guardrail severities and change totals", () => {
  assert.deepEqual(summarizeDiff(sampleDiff), {
    changeCount: 3,
    guardrailCount: 1,
    immutableCount: 1,
    importantCount: 0,
    styleOnly: false,
    hasParseErrors: true,
    language: "yaml",
  });
});

test("diffToDiagnostics maps guardrails parse errors and refactoring groups", () => {
  const diagnostics = diffToDiagnostics(sampleDiff);

  assert.equal(diagnostics.length, 3);
  assert.equal(diagnostics[0].severity, "error");
  assert.equal(diagnostics[0].code, "prod-host");
  assert.equal(diagnostics[1].code, "parse_error");
  assert.equal(diagnostics[2].severity, "information");
});

test("diffToDiagnostics distinguishes fuel failures and parser fallback", () => {
  const diagnostics = diffToDiagnostics({
    parse_errors: ["FUEL_EXCEEDED: 1.0K file='large.ts'"],
    is_fallback: true,
    metadata: {
      engine_telemetry: {
        fuel_hotspots: [{
          language: "typescript",
          function: "process",
          filename: "large.ts",
          fuel_consumed: 20000000,
        }],
      },
    },
    changes: [],
  });

  assert.equal(diagnostics.length, 3);
  assert.equal(diagnostics[0].severity, "error");
  assert.equal(diagnostics[0].code, "fuel_exceeded");
  assert.equal(diagnostics[1].severity, "warning");
  assert.equal(diagnostics[1].code, "parser_fallback");
  assert.equal(diagnostics[2].severity, "warning");
  assert.equal(diagnostics[2].code, "fuel_hotspot");
});

test("diffToDecorations maps semantic changes by type and position", () => {
  const decorations = diffToDecorations(sampleDiff);

  assert.equal(decorations.length, 2);
  assert.equal(decorations[0].kind, "addition");
  assert.equal(decorations[1].kind, "refactoring");
  assert.equal(decorations[1].position.start_line, 6);
});

test("diff decoration helpers split modified and base editor positions", () => {
  const modifiedDecorations = diffToModifiedDecorations(sampleDiff);
  const baseDecorations = diffToBaseDecorations(sampleDiff);

  assert.equal(modifiedDecorations.length, 2);
  assert.equal(baseDecorations.length, 1);
  assert.equal(baseDecorations[0].kind, "deletion");
  assert.equal(baseDecorations[0].position.start_line, 8);
});

test("review targets use base coordinates for old-only deletions", () => {
  const deletion = sampleDiff.changes?.find((change) => change.change_type === "DELETION");
  const addition = sampleDiff.changes?.find((change) => change.change_type === "ADDITION");

  assert.deepEqual(reviewTargetForChange(deletion!), {
    position: { start_line: 8, start_col: 0, end_line: 8, end_col: 10 },
    side: "base",
  });
  assert.equal(reviewTargetForChange(addition!)?.side, "modified");
});

test("modified editor decorations ignore old-only coordinates", () => {
  const diff: SemanticDiff = {
    language: "typescript",
    changes: [
      {
        change_type: "REFACTORING",
        refactoring_kind: "RENAME_SYMBOL",
        description: "Rename symbol",
        old_node: {
          position: { start_line: 12, start_col: 2, end_line: 12, end_col: 10 },
        },
      },
    ],
  };

  assert.equal(diffToModifiedDecorations(diff).length, 0);
});

test("comment changes are tagged for editor filtering", () => {
  const diff: SemanticDiff = {
    language: "typescript",
    changes: [
      {
        change_type: "ADDITION",
        description: "Insert comment",
        new_node: {
          node_type: "comment",
          label: "// note",
          position: { start_line: 1, start_col: 0, end_line: 1, end_col: 7 },
        },
      },
    ],
  };

  const decorations = diffToModifiedDecorations(diff);

  assert.equal(decorations.length, 1);
  assert.equal(decorations[0].isComment, true);
});

test("generic inline replacements use new-node coordinates in the modified editor", () => {
  const diff: SemanticDiff = {
    language: "generic",
    changes: [
      {
        change_type: "MODIFICATION",
        description: "Update line 25",
        text_diff: "OUT OF OR IN CO[-N][+X]NECTION",
        old_node: {
          node_type: "text_span",
          label: "N",
          position: { start_line: 19, start_col: 15, end_line: 19, end_col: 16 },
        },
        new_node: {
          node_type: "text_span",
          label: "X",
          position: { start_line: 24, start_col: 12, end_line: 24, end_col: 13 },
        },
      },
    ],
  };

  const decorations = diffToModifiedDecorations(diff);

  assert.equal(decorations.length, 2);
  assert.equal(decorations[0].kind, "modification");
  assert.equal(decorations[1].kind, "inlineDeletionGap");
  assert.equal(decorations[1].deletedText, "N");
  assert.deepEqual(decorations.map((item) => item.position), [
    { start_line: 24, start_col: 12, end_line: 24, end_col: 13 },
    { start_line: 24, start_col: 12, end_line: 24, end_col: 12 },
  ]);
  assert.match(decorations[0].message, /Update line/u);
});

test("generic old-only inline deletions stay on the base side", () => {
  const diff: SemanticDiff = {
    language: "generic",
    changes: [
      {
        change_type: "DELETION",
        description: "Delete text on line 18: 'HOLDERS'",
        text_diff: "AUTHORS OR COPYRIGHT[- HOLDERS] BE LIABLE",
        old_node: {
          node_type: "text_span",
          label: " HOLDERS",
          position: { start_line: 17, start_col: 20, end_line: 17, end_col: 28 },
        },
      },
    ],
  };

  const modifiedDecorations = diffToModifiedDecorations(diff);
  const baseDecorations = diffToBaseDecorations(diff);

  assert.equal(modifiedDecorations.length, 0);
  assert.equal(baseDecorations.length, 1);
  assert.equal(baseDecorations[0].kind, "deletion");
  assert.deepEqual(baseDecorations[0].position, {
    start_line: 17,
    start_col: 20,
    end_line: 17,
    end_col: 28,
  });
});

test("README row deletions do not reuse old columns on the modified side", () => {
  const diff: SemanticDiff = {
    language: "generic",
    changes: [
      {
        change_type: "ADDITION",
        description: "Insert text on line 73: '\"i'",
        text_diff: "| `intentdiff.fuel` | `[+\"i]n[-ull][+f\"]` |[- Optional] `--fuel` override |",
        new_node: {
          node_type: "text_span",
          label: "\"i",
          position: { start_line: 72, start_col: 17, end_line: 72, end_col: 19 },
        },
      },
      {
        change_type: "MODIFICATION",
        description: "Update line 73",
        text_diff: "| `intentdiff.fuel` | `[+\"i]n[-ull][+f\"]` |[- Optional] `--fuel` override |",
        old_node: {
          node_type: "text_span",
          label: "ull",
          position: { start_line: 72, start_col: 18, end_line: 72, end_col: 21 },
        },
        new_node: {
          node_type: "text_span",
          label: "f\"",
          position: { start_line: 72, start_col: 20, end_line: 72, end_col: 22 },
        },
      },
      {
        change_type: "DELETION",
        description: "Delete text on line 73: ' Optional'",
        text_diff: "| `intentdiff.fuel` | `[+\"i]n[-ull][+f\"]` |[- Optional] `--fuel` override |",
        old_node: {
          node_type: "text_span",
          label: " Optional",
          position: { start_line: 72, start_col: 24, end_line: 72, end_col: 33 },
        },
      },
    ],
  };

  const modifiedDecorations = diffToModifiedDecorations(diff);
  const baseDecorations = diffToBaseDecorations(diff);

  assert.equal(modifiedDecorations.some((item) => item.position.start_col === 24), false);
  assert.deepEqual(
    modifiedDecorations.map((item) => [item.kind, item.position.start_col]),
    [
      ["addition", 17],
      ["modification", 20],
      ["inlineDeletionGap", 20],
    ],
  );
  assert.deepEqual(baseDecorations.map((item) => item.position), [
    { start_line: 72, start_col: 24, end_line: 72, end_col: 33 },
  ]);
});

test("non-inline deletions stay out of modified editor decorations", () => {
  const diff: SemanticDiff = {
    language: "generic",
    changes: [
      {
        change_type: "DELETION",
        description: "Delete line",
        old_node: {
          node_type: "text_line",
          label: "removed",
          position: { start_line: 3, start_col: 0, end_line: 3, end_col: 7 },
        },
      },
    ],
  };

  assert.equal(diffToModifiedDecorations(diff).length, 0);
});

test("typescript structural wrapper deletions collapse to a small base editor marker", () => {
  const diff: SemanticDiff = {
    language: "typescript",
    changes: [
      {
        change_type: "DELETION",
        description: "Delete array('array')",
        old_node: {
          node_type: "array",
          label: "array",
          position: { start_line: 10, start_col: 9, end_line: 20, end_col: 3 },
          children: [
            {
              node_type: "object",
              label: "object",
              position: { start_line: 12, start_col: 4, end_line: 16, end_col: 5 },
            },
          ],
        },
      },
    ],
  };

  const decorations = diffToBaseDecorations(diff);

  assert.equal(decorations.length, 1);
  assert.equal(decorations[0].kind, "deletion");
  assert.deepEqual(decorations[0].position, {
    start_line: 10,
    start_col: 9,
    end_line: 10,
    end_col: 10,
  });
});

test("typescript structural wrapper additions collapse to a small modified editor marker", () => {
  const diff: SemanticDiff = {
    language: "typescript",
    changes: [
      {
        change_type: "ADDITION",
        description: "Insert -> statement_block('statement_block')",
        new_node: {
          node_type: "statement_block",
          label: "statement_block",
          position: { start_line: 30, start_col: 2, end_line: 40, end_col: 8 },
          children: [
            {
              node_type: "lexical_declaration",
              label: "const decorations",
              position: { start_line: 32, start_col: 4, end_line: 32, end_col: 42 },
            },
          ],
        },
      },
    ],
  };

  const decorations = diffToModifiedDecorations(diff);

  assert.equal(decorations.length, 1);
  assert.equal(decorations[0].kind, "addition");
  assert.deepEqual(decorations[0].position, {
    start_line: 30,
    start_col: 2,
    end_line: 30,
    end_col: 3,
  });
});

test("typescript entity additions keep their full decoration range", () => {
  const diff: SemanticDiff = {
    language: "typescript",
    changes: [
      {
        change_type: "ADDITION",
        description: "Insert function",
        new_node: {
          node_type: "function_declaration",
          label: "inlineDeletionDecorations",
          position: { start_line: 50, start_col: 0, end_line: 64, end_col: 1 },
          children: [
            {
              node_type: "identifier",
              label: "inlineDeletionDecorations",
              position: { start_line: 50, start_col: 9, end_line: 50, end_col: 34 },
            },
          ],
        },
      },
    ],
  };

  const decorations = diffToModifiedDecorations(diff);

  assert.equal(decorations.length, 1);
  assert.deepEqual(decorations[0].position, {
    start_line: 50,
    start_col: 0,
    end_line: 64,
    end_col: 1,
  });
});

test("statusText prioritizes guardrails style-only clean and change counts", () => {
  assert.equal(statusText(sampleDiff), "IntentDiff: 1 guardrail");
  assert.equal(statusText({ parse_errors: ["FUEL_EXCEEDED: 1.0K"], changes: [] }), "IntentDiff: fuel exceeded");
  assert.equal(statusText({ parse_errors: ["recoverable parser warning"], changes: [] }), "IntentDiff: 1 parser warning");
  assert.equal(statusText({ is_fallback: true, changes: [] }), "IntentDiff: parser fallback");
  assert.equal(statusText({
    metadata: { engine_telemetry: { fuel_hotspots: [{ language: "typescript", function: "process" }] } },
    changes: [],
  }), "IntentDiff: 1 fuel warning");
  assert.equal(statusText({ is_style_only: true, changes: [] }), "IntentDiff: style-only");
  assert.equal(statusText({ changes: [] }), "IntentDiff: clean");
  assert.equal(statusText({ changes: [{ change_type: "MODIFICATION" }] }), "IntentDiff: 1 changes");
});
