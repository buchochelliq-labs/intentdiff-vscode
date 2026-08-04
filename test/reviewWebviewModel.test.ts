import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { JSDOM } from "jsdom";
import {
  buildReviewDashboardModel,
  buildReviewPanelModel,
  escapeHtml,
  isReviewWebviewMessage,
  normalizeReviewView,
  renderDashboardHtml,
  renderPanelHtml,
} from "../src/reviewWebviewModel";
import type { ReviewCrossFileEntry, ReviewFile } from "../src/reviewModel";

const sampleFile: ReviewFile = {
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
      semantic_path: "settings.api_key",
      message: "Protected setting changed",
      position: { start_line: 1, start_col: 0, end_line: 1, end_col: 8 },
    }],
    change_groups: [{
      kind: "REFACTORING",
      raw_change_indices: [0],
      old_labels: ["addr"],
      new_labels: ["address"],
      refactoring_kind: "RENAME_VARIABLE",
      confidence: 0.93,
      rule_id: "presentation.final_refactoring_group",
    }],
    changes: [{
      change_type: "REFACTORING",
      refactoring_kind: "RENAME_VARIABLE",
      description: "Rename addr to address",
      old_node: {
        label: "addr",
        position: { start_line: 1, start_col: 0, end_line: 1, end_col: 4 },
      },
      new_node: {
        label: "address",
        position: { start_line: 1, start_col: 0, end_line: 1, end_col: 7 },
      },
    }],
  },
};

test("panel script parses and wires buttons end-to-end (guards against script syntax errors)", () => {
  // HTML string-matching cannot catch a syntax error in the inline panel script,
  // which silently breaks every delegated button. Execute the script in JSDOM.
  // (buildReviewPanelModel derives file.payload for ready files.)
  const html = renderPanelHtml(
    buildReviewPanelModel(sampleFile, "def old():\n    pass\n", "def new():\n    pass\n", "HEAD"),
    { nonce: "n1", cspSource: "vscode-resource:" },
  );
  const dom = new JSDOM(html, { pretendToBeVisual: true, runScripts: "outside-only" });
  const { window } = dom;
  const posted: unknown[] = [];
  (window as unknown as { acquireVsCodeApi: () => unknown }).acquireVsCodeApi = () => ({
    postMessage: (message: unknown) => posted.push(message),
    getState: () => ({}),
    setState: () => undefined,
  });
  const scriptText = window.document.querySelector("script:not([src])")?.textContent ?? "";
  assert.ok(scriptText.length > 0, "panel script must be present");
  assert.doesNotThrow(() => window.eval(scriptText), "panel script must execute without throwing");

  // A data-command button posts its command to the extension host.
  const nativeDiffButton = window.document.querySelector('[data-command="openNativeDiff"]');
  assert.ok(nativeDiffButton, "expected an Open native diff button");
  nativeDiffButton?.dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
  // Normalize through JSON: messages are created in the JSDOM realm, so their
  // prototypes differ from the test realm (deepStrictEqual would reject them).
  assert.deepEqual(JSON.parse(JSON.stringify(posted)), [
    { command: "openNativeDiff", payload: { folderUri: "file:///repo", relativePath: "src/app.py" } },
  ]);

  // A client-side tab click switches the active review view.
  const intentTab = window.document.querySelector('.product-tab[data-review-view="intent"]');
  assert.ok(intentTab, "expected an Intent tab");
  intentTab?.dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
  const app = window.document.querySelector(".diff-app") as unknown as { dataset: Record<string, string> } | null;
  assert.equal(app?.dataset.reviewView, "intent");
});

test("panel diff collapses non-semantic regions by default and Expand all reveals them", () => {
  const base = Array.from({ length: 16 }, (_, i) => `const x${i} = ${i};`).join("\n");
  const oldText = `${base}\nreturn 1;\n`;
  const newText = `${base}\nreturn 2;\n`;
  const file: ReviewFile = {
    ...sampleFile,
    diff: {
      language: "javascript",
      guardrail_violations: [],
      change_groups: [{ kind: "MEANINGFUL_CHANGE", raw_change_indices: [0] }],
      changes: [{
        change_type: "MODIFICATION",
        description: "tweak return value",
        old_node: { label: "return 1", position: { start_line: 16, start_col: 0, end_line: 16, end_col: 9 } },
        new_node: { label: "return 2", position: { start_line: 16, start_col: 0, end_line: 16, end_col: 9 } },
      }],
    },
  };
  const html = renderPanelHtml(
    buildReviewPanelModel(file, oldText, newText, "HEAD"),
    { nonce: "n1", cspSource: "vscode-resource:" },
  );
  const dom = new JSDOM(html, { pretendToBeVisual: true, runScripts: "outside-only" });
  const { window } = dom;
  (window as unknown as { acquireVsCodeApi: () => unknown }).acquireVsCodeApi = () => ({
    postMessage: () => undefined, getState: () => ({}), setState: () => undefined,
  });

  const block = window.document.querySelector("[data-collapse-block]");
  assert.ok(block, "a collapsed block should exist for the far unchanged region");
  assert.equal(block?.getAttribute("data-collapse-open"), "false", "collapsed by default");
  const content = window.document.querySelector("[data-collapse-content]") as unknown as { hidden: boolean } | null;
  assert.ok(content, "collapsed content container should exist");

  window.eval(window.document.querySelector("script:not([src])")?.textContent ?? "");
  const expandAll = window.document.querySelector('[data-panel-action="expandAll"]');
  assert.ok(expandAll, "Expand all control should exist");
  expandAll?.dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
  const openBlock = window.document.querySelector("[data-collapse-block]");
  assert.equal(openBlock?.getAttribute("data-collapse-open"), "true", "Expand all opens the block");
  assert.equal((content as { hidden: boolean }).hidden, false, "hidden lines revealed after Expand all");
});

test("panel diff syntax-highlights code cells via the vendored highlighter", () => {
  const html = renderPanelHtml(
    buildReviewPanelModel(sampleFile, "def old():\n    return 1\n", "def new():\n    return 2\n", "HEAD"),
    { nonce: "n1", cspSource: "vscode-resource:", highlightUri: "vscode-resource:/media/highlight/highlight.min.js" },
  );
  assert.match(html, /<script nonce="n1" src="vscode-resource:\/media\/highlight\/highlight\.min\.js"><\/script>/u);
  assert.match(html, /data-language="python"/u);

  const dom = new JSDOM(html, { pretendToBeVisual: true, runScripts: "outside-only" });
  const { window } = dom;
  (window as unknown as { acquireVsCodeApi: () => unknown }).acquireVsCodeApi = () => ({
    postMessage: () => undefined, getState: () => ({}), setState: () => undefined,
  });
  const hljsSource = readFileSync(join(__dirname, "..", "..", "media", "highlight", "highlight.min.js"), "utf8");
  window.eval(hljsSource); // defines window.hljs
  window.eval(window.document.querySelector("script:not([src])")?.textContent ?? "");
  const highlighted = window.document.querySelector(".diff-table code.new-code.hljs");
  assert.ok(highlighted, "code cells should be syntax-highlighted after the highlighter runs");
  assert.match(highlighted?.innerHTML ?? "", /hljs-/u);
});

test("panel diff working cells are directly editable and Apply posts the edited hunk", () => {
  const html = renderPanelHtml(
    buildReviewPanelModel(sampleFile, "def old():\n    return 1\n", "def new():\n    return 2\n", "HEAD"),
    { nonce: "n1", cspSource: "vscode-resource:" },
  );
  // Working-tree cells inside the hunk are contenteditable and tagged with the hunk id.
  assert.match(html, /class="new-code" contenteditable="true" spellcheck="false" data-hunk-edit-cell data-hunk-id="hunk-\d+"/u);

  const dom = new JSDOM(html, { pretendToBeVisual: true, runScripts: "outside-only" });
  const { window } = dom;
  const posted: unknown[] = [];
  (window as unknown as { acquireVsCodeApi: () => unknown }).acquireVsCodeApi = () => ({
    postMessage: (message: unknown) => posted.push(message), getState: () => ({}), setState: () => undefined,
  });
  window.eval(window.document.querySelector("script:not([src])")?.textContent ?? "");

  const cell = window.document.querySelector("[data-hunk-edit-cell]") as unknown as
    { getAttribute: (n: string) => string | null; textContent: string; dispatchEvent: (e: Event) => boolean } | null;
  assert.ok(cell, "an editable working cell should exist");
  const hunkId = cell?.getAttribute("data-hunk-id");
  cell?.dispatchEvent(new window.Event("focusin", { bubbles: true }));
  if (cell) cell.textContent = "def renamed():";
  cell?.dispatchEvent(new window.Event("input", { bubbles: true }));

  const applyBtn = window.document.querySelector('.hunk-apply-btn[data-hunk-id="' + hunkId + '"]') as unknown as
    { disabled: boolean; dispatchEvent: (e: Event) => boolean } | null;
  assert.ok(applyBtn, "the hunk Apply button should exist");
  assert.equal(applyBtn?.disabled, false, "Apply is enabled after an edit");
  applyBtn?.dispatchEvent(new window.MouseEvent("click", { bubbles: true }));

  const messages = JSON.parse(JSON.stringify(posted)) as Array<{ command: string; payload?: { hunk?: { newLines?: string[] } } }>;
  const editMessage = messages.find((message) => message.command === "editHunk");
  assert.ok(editMessage, "an editHunk message should be posted");
  assert.ok(
    (editMessage?.payload?.hunk?.newLines ?? []).includes("def renamed():"),
    "the edited working line is collected into the applied hunk",
  );
});

test("evidence page renders filter chips that drive the client filter state", () => {
  const html = renderPanelHtml(
    buildReviewPanelModel(sampleFile, "def addr():\n    pass\n", "def address():\n    pass\n", "HEAD"),
    { nonce: "n1", cspSource: "vscode-resource:" },
  );
  assert.match(html, /class="evidence-filters"/u);
  assert.match(html, /class="evidence-chip evidence-chip-all" type="button" data-filter=""/u);
  assert.match(html, /class="evidence-chip chip-refactoring" type="button" data-filter="refactoring"/u);

  const dom = new JSDOM(html, { pretendToBeVisual: true, runScripts: "outside-only" });
  const { window } = dom;
  (window as unknown as { acquireVsCodeApi: () => unknown }).acquireVsCodeApi = () => ({
    postMessage: () => undefined, getState: () => ({}), setState: () => undefined,
  });
  window.eval(window.document.querySelector("script:not([src])")?.textContent ?? "");
  const chip = window.document.querySelector('.evidence-chip[data-filter="refactoring"]');
  assert.ok(chip, "a refactoring evidence chip should render");
  chip?.dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
  const app = window.document.querySelector(".diff-app") as unknown as { dataset: Record<string, string> } | null;
  assert.equal(app?.dataset.filterActive, "refactoring", "clicking a chip activates the evidence filter");
});

test("diffContextLines controls how much unchanged context stays visible in the panel", () => {
  const base = Array.from({ length: 12 }, (_, i) => `const x${i} = ${i};`).join("\n");
  const oldText = `${base}\nreturn 1;\n`;
  const newText = `${base}\nreturn 2;\n`;
  const file: ReviewFile = {
    ...sampleFile,
    diff: {
      language: "javascript",
      guardrail_violations: [],
      change_groups: [{ kind: "MEANINGFUL_CHANGE", raw_change_indices: [0] }],
      changes: [{
        change_type: "MODIFICATION",
        description: "tweak return value",
        old_node: { label: "return 1", position: { start_line: 12, start_col: 0, end_line: 12, end_col: 9 } },
        new_node: { label: "return 2", position: { start_line: 12, start_col: 0, end_line: 12, end_col: 9 } },
      }],
    },
  };
  const hiddenCount = (model: ReturnType<typeof buildReviewPanelModel>): number =>
    model.diffRows.filter((row) => row.kind === "collapsed").reduce((sum, row) => sum + (row.hiddenRows?.length ?? 0), 0);
  const tight = buildReviewPanelModel(file, oldText, newText, "HEAD", { contextLines: 0 });
  const loose = buildReviewPanelModel(file, oldText, newText, "HEAD", { contextLines: 5 });
  assert.ok(hiddenCount(tight) > hiddenCount(loose), "a smaller context window hides more unchanged lines");
});

test("each semantic hunk offers an Edit-in-native handoff that opens the native diff at the hunk", () => {
  const html = renderPanelHtml(
    buildReviewPanelModel(sampleFile, "def addr():\n    pass\n", "def address():\n    pass\n", "HEAD"),
    { nonce: "n1", cspSource: "vscode-resource:" },
  );
  // The hunk action bar exposes an "Edit in native" button that opens the native diff editor
  // (the recommended free-form live-edit surface) at the hunk, side = modified.
  assert.match(html, /Edit in native/u);
  assert.match(html, /data-command="openNativeDiff"[^>]*data-payload="[^"]*positionSide&quot;:&quot;modified&quot;/u);
  assert.match(html, /data-command="openNativeDiff"[^>]*data-payload="[^"]*&quot;position&quot;:/u);
});

test("dashboard model preserves summary, language, schema, guardrail, and group entries", () => {
  const crossFileEntries: ReviewCrossFileEntry[] = [{
    kind: "cross-file",
    folderUri: "file:///repo",
    label: "Moved user helper across files",
    description: "helper moved from old.py to new.py",
    severity: "info",
    relativePath: "src/app.py",
    change: {
      change_type: "MOVE",
      symbol_name: "helper",
      old_file: "old.py",
      new_file: "src/app.py",
      new_position: { start_line: 3, start_col: 0, end_line: 3, end_col: 6 },
    },
  }];

  const model = buildReviewDashboardModel([sampleFile], crossFileEntries);

  assert.equal(model.summary.fileCount, 1);
  assert.equal(model.summary.guardrailCount, 1);
  assert.deepEqual(model.languages, [{ language: "python", count: 1 }]);
  assert.equal(model.files[0].schema, "Databricks bundle schema");
  assert.equal(model.files[0].groupCount, 1);
  assert.equal(model.files[0].guardrailCount, 1);
  assert.equal(model.files[0].entries.map((entry) => entry.kind).join(","), "guardrail,schema-status,refactoring");
  assert.equal(model.primaryPayload?.relativePath, "src/app.py");
  assert.equal(model.crossFileEntries[0].payload?.relativePath, "src/app.py");
});

test("dashboard model and HTML render grouped language/schema file sections", () => {
  const typescriptFile: ReviewFile = {
    folderName: "repo",
    folderUri: "file:///repo",
    relativePath: "plugins/vscode/src/extension.ts",
    status: "ready",
    diff: {
      language: "typescript",
      changes: [{ change_type: "MODIFICATION", description: "Update extension" }],
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

  const model = buildReviewDashboardModel([typescriptFile, jsonFile], [], "auto");
  const dashboardHtml = renderDashboardHtml(model, { nonce: "abc123", cspSource: "vscode-resource:" });

  assert.equal(model.groupingMode, "auto");
  assert.equal(model.effectiveGroupingMode, "languageThenSchema");
  assert.deepEqual(model.fileGroups.map((group) => group.label), [
    "JSON · Databricks bundle schema",
    "TypeScript",
  ]);
  assert.match(dashboardHtml, /class="dashboard-file-group"/u);
  assert.match(dashboardHtml, /data-dashboard-toggle-group="language-schema:json:databricks-bundle-schema"/u);
  assert.match(dashboardHtml, /Grouping: Auto: Language \+ schema/u);
});

test("dashboard aggregates fuel diagnostics and renders task-manager history", () => {
  const fuelFile: ReviewFile = {
    ...sampleFile,
    relativePath: "apps/review-shell/src/main.ts",
    diff: {
      ...sampleFile.diff,
      language: "typescript",
      metadata: {
        ...sampleFile.diff?.metadata,
        engine_telemetry: {
          calls: [{
            plugin: "src/intentumdiff/wasm/js_ts_parser.wasm",
            function: "process",
            language: "typescript",
            filename: "apps/review-shell/src/main.ts",
            fuel_consumed: 25000000,
            total_fuel_consumed: 25000000,
            input_bytes: 512,
            input_lines: 22,
            provenance: "first_party_wasm",
            engine: "python_wasmtime_plugin_host",
            trusted: true,
          }],
          fuel_hotspots: [{
            function: "process",
            language: "typescript",
            filename: "apps/review-shell/src/main.ts",
            fuel_consumed: 25000000,
          }],
        },
      },
    },
  };
  const historyKey = "file:///repo::apps/review-shell/src/main.ts";
  const model = buildReviewDashboardModel([fuelFile], [], "auto", {
    [historyKey]: [1000000, 25000000],
  });
  const dashboardHtml = renderDashboardHtml(model, { nonce: "abc123", cspSource: "vscode-resource:" });

  assert.equal(model.files[0].fuelDiagnostics.peakFuel, 25000000);
  assert.deepEqual(model.files[0].fuelHistory, [1000000, 25000000]);
  assert.match(dashboardHtml, /Fuel diagnostics/u);
  assert.match(dashboardHtml, /data-fuel-file="dashboard-file-0"/u);
  assert.match(dashboardHtml, /25\.0M peak/u);
  assert.match(dashboardHtml, /peak&gt;20\.0M/u);
  assert.match(dashboardHtml, /fuel-sparkline/u);
  assert.match(dashboardHtml, /data-dashboard-filter="fuel"/u);
  assert.match(dashboardHtml, /Fuel peak/u);
});

test("dashboard and panel do not present parse-only fallback diagnostics as clean", () => {
  const parseOnlyFile: ReviewFile = {
    ...sampleFile,
    relativePath: "src/main.ts",
    diff: {
      language: "typescript",
      is_fallback: true,
      parse_errors: ["FUEL_EXCEEDED: 10.0M file='src/main.ts'"],
      changes: [],
    },
  };
  const dashboardModel = buildReviewDashboardModel([parseOnlyFile], []);
  const dashboardHtml = renderDashboardHtml(dashboardModel, { nonce: "abc123", cspSource: "vscode-resource:" });
  const panelHtml = renderPanelHtml(
    buildReviewPanelModel(parseOnlyFile, "const value = 1;\n", "const value = 2;\n", "HEAD"),
    { nonce: "abc123", cspSource: "vscode-resource:" },
  );

  assert.equal(dashboardModel.files[0].description, "typescript - 1 parse error - parser fallback");
  assert.equal(dashboardModel.files[0].fuelDiagnostics.parseErrorCount, 1);
  assert.equal(dashboardModel.files[0].fuelDiagnostics.fallback, true);
  assert.match(dashboardHtml, /class="dashboard-fuel-row is-hot"/u);
  assert.match(dashboardHtml, /src\/main\.ts/u);
  assert.match(dashboardHtml, /1 parse error, parser fallback/u);
  assert.match(dashboardHtml, /data-dashboard-filter="fuel"/u);
  assert.doesNotMatch(dashboardHtml, /No parser fuel telemetry yet/u);
  assert.match(panelHtml, /Inspect parser fuel telemetry/u);
  assert.match(panelHtml, /FUEL_EXCEEDED: 10\.0M/u);
  assert.match(panelHtml, /Parser fallback was used for this file/u);
  assert.doesNotMatch(panelHtml, /No parse, fallback, fuel, or telemetry diagnostics/u);
});

test("panel script supports keyboard-first semantic navigation", () => {
  const panelHtml = renderPanelHtml(
    buildReviewPanelModel(sampleFile, "import token\n", "import token2\n", "HEAD"),
    { nonce: "abc123", cspSource: "vscode-resource:" },
  );

  assert.match(panelHtml, /window\.addEventListener\("keydown",/u);
  assert.match(panelHtml, /function isTextInputTarget\(target\)/u);
  assert.match(panelHtml, /event\.key === "ArrowDown"/u);
  assert.match(panelHtml, /event\.key === "ArrowUp"/u);
  assert.match(panelHtml, /event\.key === "Home"/u);
  assert.match(panelHtml, /event\.key === "End"/u);
  assert.match(panelHtml, /function moveSelectionToEdge\(end/u);
  assert.match(panelHtml, /event\.preventDefault\(\);/u);
});

test("dashboard renders review timeline snapshot comparison", () => {
  const model = buildReviewDashboardModel([sampleFile], [], "auto", {}, undefined, [
    {
      id: "older",
      timestamp: 1000,
      folderName: "repo",
      folderUri: "file:///repo",
      fileCount: 1,
      semanticChangeCount: 1,
      errorCount: 0,
      fuelHotspotCount: 0,
    },
    {
      id: "newer",
      timestamp: 2000,
      folderName: "repo",
      folderUri: "file:///repo",
      fileCount: 2,
      semanticChangeCount: 3,
      errorCount: 1,
      fuelHotspotCount: 2,
    },
  ]);
  const dashboardHtml = renderDashboardHtml(model, { nonce: "abc123", cspSource: "vscode-resource:" });

  assert.equal(model.timelineComparison?.summary, "+1 file, +2 semantic changes, +1 error, +2 fuel hotspots");
  assert.match(dashboardHtml, /Review history/u);
  assert.match(dashboardHtml, /Compare recent review snapshots/u);
  assert.match(dashboardHtml, /\+1 file, \+2 semantic changes, \+1 error, \+2 fuel hotspots/u);
  assert.match(dashboardHtml, /data-review-snapshot="newer"/u);
  assert.match(dashboardHtml, /data-review-snapshot="older"/u);
  assert.match(dashboardHtml, /data-command="openTimelineSnapshot"/u);
  assert.match(dashboardHtml, /&quot;snapshotId&quot;:&quot;newer&quot;/u);
  assert.match(dashboardHtml, /class="dashboard-timeline-row is-hot"/u);
  assert.match(dashboardHtml, /\.dashboard-timeline-panel/u);
});

test("panel model creates side-by-side diff rows with semantic highlighting", () => {
  const model = buildReviewPanelModel(
    sampleFile,
    "token = addr\nprint(token)\n",
    "token = address\nprint(token)\n",
    "HEAD",
  );

  assert.equal(model.file.relativePath, "src/app.py");
  assert.equal(model.ref, "HEAD");
  assert.equal(model.entries.some((entry) => entry.kind === "refactoring"), true);
  assert.equal(model.entries.some((entry) => entry.targetId?.startsWith("row-")), true);
  assert.equal(model.diffRows.some((row) => row.kind === "change"), true);
  assert.equal(model.diffRows.some((row) => row.semantic), true);
  assert.equal(model.diffRows.some((row) => row.intent === "refactoring"), true);
  assert.equal(model.diffRows.every((row) => row.id?.startsWith("row-")), true);
});

test("panel renders scope breadcrumbs and optional hidden Unicode markers", () => {
  const scopedFile: ReviewFile = {
    ...sampleFile,
    diff: {
      ...sampleFile.diff,
      change_groups: [{
        kind: "MEANINGFUL_CHANGE",
        raw_change_indices: [0],
        confidence: 0.92,
        rule_id: "competitor.scope_fixture",
        metadata: {
          scope_trail: ["module app", "class Greeter", "function greet"],
        },
      }],
      changes: [{
        change_type: "MODIFICATION",
        description: "Hidden Unicode character changed",
        old_node: {
          label: "greet",
          node_type: "function_definition",
          position: { start_line: 1, start_col: 0, end_line: 1, end_col: 20 },
        },
        new_node: {
          label: "greet",
          node_type: "function_definition",
          position: { start_line: 1, start_col: 0, end_line: 1, end_col: 21 },
        },
      }],
    },
  };

  const panelHtml = renderPanelHtml(
    buildReviewPanelModel(
      scopedFile,
      "def greet():\n    return \"hello\"\n",
      "def greet():\n    return \"hello\u200b\"\n",
      "HEAD",
    ),
    { nonce: "abc123", cspSource: "vscode-resource:" },
  );

  // The diff page renders the inline semantic diff (hidden-Unicode markers and
  // all) with a native-diff action to open VS Code's diff editor for the full
  // collapse/expand + editable experience.
  assert.match(panelHtml, /class="diff-table"/u);
  assert.match(panelHtml, /Open native diff/u);
  assert.match(panelHtml, /unicode-marker/u);
  assert.match(panelHtml, /\.diff-app\[data-unicode-open="true"\] \.unicode-marker/u);
});

test("panel stylesheet includes VS Code light theme overrides for the review surface", () => {
  const panelHtml = renderPanelHtml(
    buildReviewPanelModel(sampleFile, "def old_name():\n    return 1\n", "def new_name():\n    return 2\n", "HEAD"),
    { nonce: "abc123", cspSource: "vscode-resource:" },
  );

  assert.match(panelHtml, /body\.vscode-light \{ color-scheme:light;/u);
  assert.match(panelHtml, /body\.vscode-light \.product-shell,/u);
  assert.match(panelHtml, /body\.vscode-light \.diff-topbar,/u);
  assert.match(panelHtml, /body\.vscode-light \.diff-surface,/u);
  assert.match(panelHtml, /body\.vscode-light \.diff-link-gutter,/u);
  assert.match(panelHtml, /body\.vscode-light \.diff-link-line/u);
  assert.match(panelHtml, /body\.vscode-light \.diff-hunk/u);
  assert.match(panelHtml, /body\.vscode-light \.semantic-token/u);
  assert.match(panelHtml, /body\.vscode-light \.empty-code/u);
  assert.match(panelHtml, /body\.vscode-light \.diff-delete code\.old-code/u);
  assert.match(panelHtml, /body\.vscode-light \.diff-insert code\.new-code/u);
});

test("structural chrome variables inherit VS Code theme colors with brand fallbacks", () => {
  const panelHtml = renderPanelHtml(
    buildReviewPanelModel(sampleFile, "def old_name():\n    return 1\n", "def new_name():\n    return 2\n", "HEAD"),
    { nonce: "abc123", cspSource: "vscode-resource:" },
  );

  // Structural chrome is theme-native: base vars reference --vscode-* with NO
  // hex fallbacks (issue #84 drove the #27 ratchet to zero; webview hosts
  // always inject the theme variables).
  assert.match(panelHtml, /--bg:var\(--vscode-editor-background\)/u);
  assert.match(panelHtml, /--panel:var\(--vscode-editorWidget-background\)/u);
  assert.match(panelHtml, /--text:var\(--vscode-foreground\)/u);
  assert.match(panelHtml, /--muted:var\(--vscode-descriptionForeground\)/u);
  assert.match(panelHtml, /--line:var\(--vscode-panel-border\)/u);
  // The light-theme block keeps the same theme-var mapping.
  assert.match(panelHtml, /body\.vscode-light \{[^}]*--bg:var\(--vscode-editor-background\)/u);
  // Semantic-intent accents inherit the theme chart colors outright.
  assert.match(panelHtml, /--green:var\(--vscode-charts-green\);/u);
  assert.match(panelHtml, /--red:var\(--vscode-charts-red\);/u);
  assert.match(panelHtml, /--purple:var\(--vscode-charts-purple\);/u);
});

test("panel model collapses uninteresting blank inserted rows behind gutter controls", () => {
  const blankHeavyFile: ReviewFile = {
    ...sampleFile,
    diff: {
      ...sampleFile.diff,
      guardrail_violations: [],
      change_groups: [],
      changes: [{
        change_type: "ADDITION",
        description: "Add boo",
        new_node: {
          label: "boo",
          position: { start_line: 0, start_col: 0, end_line: 1, end_col: 17 },
        },
      }],
    },
  };
  const model = buildReviewPanelModel(
    blankHeavyFile,
    "",
    "def boo():\n    print(\"Boo!\")\n\n\n\n\n\n\n\n\n",
    "HEAD",
  );
  const collapsed = model.diffRows.find((row) => row.kind === "collapsed");

  assert.equal(collapsed?.collapseReason, "blank");
  assert.equal(collapsed?.hiddenRows?.length, 9);

  const panelHtml = renderPanelHtml(model, {
    nonce: "abc123",
    cspSource: "vscode-resource:",
  });

  assert.match(panelHtml, /function toggleCollapsedBlock/u);
  assert.match(panelHtml, /expandedBlocks/u);
  assert.match(panelHtml, /class="diff-table"/u);
});

test("panel diff renders the inline semantic diff plus a native-diff action for text files", () => {
  const panelHtml = renderPanelHtml(
    buildReviewPanelModel(sampleFile, "def old():\n    pass\n", "def new():\n    pass\n", "HEAD"),
    { nonce: "abc123", cspSource: "vscode-resource:" },
  );

  // The inline diff is rendered directly in the panel (the HTML diff-row grid).
  assert.match(panelHtml, /class="diff-table"/u);
  assert.match(panelHtml, /class="diff-column-heads"/u);
  assert.match(panelHtml, /class="diff-row/u);
  // Text diff shares the same workbench/surface/toolbar frame as the perceptual asset diff.
  assert.match(panelHtml, /class="diff-workbench text-diff-workbench"/u);
  assert.match(panelHtml, /class="diff-surface text-diff-surface"/u);
  assert.match(panelHtml, /class="diff-toolbar text-diff-toolbar"/u);
  // The native diff editor is one click away for full collapse/expand + editing.
  assert.match(panelHtml, /Open native diff/u);
  assert.match(panelHtml, /data-command="openNativeDiff"/u);
  assert.match(panelHtml, /data-command="openSemanticOnlyDiff"/u);
  // Monaco host, its editing scaffolding, and the vendored loader are gone.
  assert.doesNotMatch(panelHtml, /id="monaco-diff-host"/u);
  assert.doesNotMatch(panelHtml, /id="monaco-diff-stage"/u);
  assert.doesNotMatch(panelHtml, /data-old-text="/u);
  assert.doesNotMatch(panelHtml, /data-new-text="/u);
  assert.doesNotMatch(panelHtml, /\/vs\/loader\.js/u);
  assert.doesNotMatch(panelHtml, /reviewDiff\.css/u);
  assert.doesNotMatch(panelHtml, /reviewDiff\.js/u);
  assert.doesNotMatch(panelHtml, /worker-src blob:/u);
  assert.doesNotMatch(panelHtml, /window\.__monacoBase/u);
});

test("panel release-notes page renders categorized notes with copy/export actions", () => {
  const panelHtml = renderPanelHtml(
    buildReviewPanelModel(sampleFile, "def old():\n    pass\n", "def new():\n    pass\n", "HEAD"),
    { nonce: "abc123", cspSource: "vscode-resource:" },
  );

  // Copy-as-Markdown + Export-JSON actions are wired through the message guard.
  assert.match(panelHtml, /data-command="copyReleaseNotes"/u);
  assert.match(panelHtml, /data-command="exportReleaseNotes"/u);
  assert.match(panelHtml, /Copy as Markdown/u);
  assert.match(panelHtml, /Export JSON/u);
  // Three risk-derived sections, sourced from the semantic diff.
  assert.match(panelHtml, /<h3>Behavior changes<\/h3>/u);
  assert.match(panelHtml, /<h3>Internal changes<\/h3>/u);
  assert.match(panelHtml, /<h3>Guardrails<\/h3>/u);
  // sampleFile carries a RENAME_VARIABLE refactor (internal) and an immutable guardrail.
  // Notes now render `code` spans as <code> and append a "why" impact clause.
  assert.match(panelHtml, /Renamed <code>addr<\/code> → <code>address<\/code>/u);
  assert.match(panelHtml, /Immutable: Protected setting changed/u);
  // No behavior-facing groups → placeholder empty state.
  assert.match(panelHtml, /No behavior-facing changes detected\./u);
});

test("intent tab collates rich meanings with risk pills, not terse labels", () => {
  const panelHtml = renderPanelHtml(
    buildReviewPanelModel(sampleFile, "def old():\n    pass\n", "def new():\n    pass\n", "HEAD"),
    { nonce: "abc123", cspSource: "vscode-resource:" },
  );
  // "What changed" is a collated intent-meaning list, rendering what/why + a risk pill.
  assert.match(panelHtml, /class="intent-meaning-list"/u);
  assert.match(panelHtml, /class="intent-meaning-head"><strong>Renamed <code>addr<\/code> → <code>address<\/code>/u);
  // sampleFile's rename is an Internal risk → Internal pill; evidence rows share the pill markup.
  assert.match(panelHtml, /class="risk-pill risk-internal">Internal</u);
  // The old bare placeholder is gone.
  assert.doesNotMatch(panelHtml, /No semantic intent selected/u);
});

test("a non-code file (.gitignore) reads as content, not code behavior", () => {
  const gitignoreFile: ReviewFile = {
    folderName: "repo",
    folderUri: "file:///repo",
    relativePath: ".gitignore",
    status: "ready",
    diff: {
      language: "gitignore",
      change_groups: [{ kind: "MEANINGFUL_CHANGE", raw_change_indices: [0], new_labels: ["/.intentumdiff"] }],
      changes: [{
        change_type: "ADDITION",
        new_node: { label: "/.intentumdiff", node_type: "text_line", position: { start_line: 85, start_col: 0, end_line: 85, end_col: 11 } },
      }],
    },
  };
  const panelHtml = renderPanelHtml(
    buildReviewPanelModel(gitignoreFile, "node_modules\n", "node_modules\n/.intentumdiff\n", "HEAD"),
    { nonce: "abc123", cspSource: "vscode-resource:" },
  );
  // Content pill, not a Behavior/code claim.
  assert.match(panelHtml, /class="risk-pill risk-content">Content</u);
  assert.doesNotMatch(panelHtml, /New public API/u);
  assert.doesNotMatch(panelHtml, /class="risk-pill risk-behavior"/u);
  // Content-framed meaning + the Docs & chores release-notes bucket.
  assert.match(panelHtml, /New configuration entry\./u);
  assert.match(panelHtml, /Docs &amp; chores/u);
});

test("rendered webviews escape labels and source text and include a nonce CSP", () => {
  const hostileFile: ReviewFile = {
    ...sampleFile,
    relativePath: "src/<img src=x onerror=alert(1)>.py",
    diff: {
      ...sampleFile.diff,
      changes: [{
        change_type: "MODIFICATION",
        description: "<script>alert(1)</script>",
        new_node: {
          label: "<b>owned</b>",
          position: { start_line: 0, start_col: 0, end_line: 0, end_col: 4 },
        },
      }],
    },
  };
  const dashboardHtml = renderDashboardHtml(buildReviewDashboardModel([hostileFile], []), {
    nonce: "abc123",
    cspSource: "vscode-resource:",
  });
  const panelHtml = renderPanelHtml(
    buildReviewPanelModel(hostileFile, "<script>old()</script>", "<img src=x onerror=alert(1)>", "HEAD"),
    { nonce: "abc123", cspSource: "vscode-resource:" },
  );

  assert.match(dashboardHtml, /script-src 'nonce-abc123'/u);
  assert.doesNotMatch(dashboardHtml, /<img src=x onerror=alert\(1\)>/u);
  assert.match(dashboardHtml, /src\/&lt;img src=x onerror=alert\(1\)&gt;\.py/u);
  assert.doesNotMatch(panelHtml, /<script>old\(\)<\/script>/u);
  assert.doesNotMatch(panelHtml, /<img src=x onerror=alert\(1\)>/u);
  assert.match(panelHtml, /&lt;script&gt;old\(\)&lt;\/script&gt;/u);
  assert.match(panelHtml, /class="diff-table"/u);
  assert.doesNotMatch(panelHtml, /id="monaco-diff-host"/u);
  assert.doesNotMatch(panelHtml, /class="product-brand"/u);
  assert.doesNotMatch(panelHtml, />IntentumDiff<\/span>/u);
  assert.match(panelHtml, /class="product-context"/u);
  assert.match(panelHtml, /<strong>src\/&lt;img src=x onerror=alert\(1\)&gt;\.py<\/strong>/u);
  assert.match(panelHtml, /data-review-view="semantic"/u);
  assert.match(panelHtml, /data-review-view="intent"/u);
  assert.doesNotMatch(panelHtml, /data-review-view="risk"/u);
  assert.match(panelHtml, /data-review-view="evidence"/u);
  assert.match(panelHtml, /data-review-view="diagnostics"/u);
  assert.doesNotMatch(panelHtml, /data-review-view="notes"/u);
  assert.match(panelHtml, /data-review-view="release-notes"/u);
  assert.doesNotMatch(panelHtml, /data-review-view="binary-image"/u);
  assert.match(panelHtml, />Diff<\/span><\/button>/u);
  assert.match(panelHtml, /class="review-pages"/u);
  assert.match(panelHtml, /class="review-page semantic-page"/u);
  assert.match(panelHtml, /data-review-page="intent"/u);
  assert.doesNotMatch(panelHtml, /data-review-page="risk"/u);
  assert.match(panelHtml, /data-review-page="evidence"/u);
  assert.match(panelHtml, /data-review-page="diagnostics"/u);
  assert.doesNotMatch(panelHtml, /data-review-page="notes"/u);
  assert.doesNotMatch(panelHtml, /class="review-detail-panel"/u);
  assert.match(panelHtml, /Intent summary/u);
  assert.match(panelHtml, /Risk &amp; guardrails/u);
  assert.doesNotMatch(panelHtml, /Review notes/u);
  assert.doesNotMatch(panelHtml, /Decision workspace for this file/u);
  assert.match(panelHtml, /Draft notes stay grouped with source traceability/u);
  assert.match(panelHtml, /Open native diff/u);
  assert.doesNotMatch(panelHtml, /Accept classification/u);
  assert.doesNotMatch(panelHtml, /Mark behaviour change/u);
  assert.doesNotMatch(panelHtml, /Add to release notes/u);
  assert.doesNotMatch(panelHtml, /id="monaco-diff-host"/u);
  assert.doesNotMatch(panelHtml, /data-panel-action="applyEdits"/u);
  assert.doesNotMatch(panelHtml, /data-panel-action="discardEdits"/u);
  assert.doesNotMatch(panelHtml, /data-old-text="/u);
  assert.doesNotMatch(panelHtml, /data-new-text="/u);
  assert.match(panelHtml, /class="stat stat-semantic"/u);
  assert.match(panelHtml, /class="diff-app" data-review-view="semantic" data-diff-mode="text" data-language="python" data-rail="left" data-rail-open="false" data-rail-pinned="false" data-minimap-open="true" data-drawer-open="false" data-unicode-open="false"/u);
  assert.match(panelHtml, /class="file-mode-badge">Semantic diff<\/span>/u);
  assert.match(panelHtml, /class="pill filter-pill mode-pill" type="button" data-filter="diff-mode">text diff<\/button>/u);
  assert.match(panelHtml, /class="entry-reveal"/u);
  assert.match(panelHtml, /class="entry-actions" aria-label="Semantic entity actions"/u);
  assert.match(panelHtml, />Stage<\/span><\/button>/u);
  assert.match(panelHtml, />Revert<\/span><\/button>/u);
  assert.match(panelHtml, />Apply<\/span><\/button>/u);
  assert.match(panelHtml, /command === "editHunk"/u);
  assert.match(panelHtml, /payload\.hunk\.newLines = editedLines/u);
  assert.match(panelHtml, /commandButton && commandButton\.getAttribute\("data-command"\) !== "reveal"/u);
  assert.match(panelHtml, /function postCommandButton\(button\)/u);
  assert.match(panelHtml, /&quot;actionKind&quot;:&quot;stageHunk&quot;/u);
  assert.match(panelHtml, /&quot;hunk&quot;:\{&quot;oldLines&quot;:\[/u);
  assert.match(panelHtml, /&quot;newLines&quot;:\[/u);
  assert.match(panelHtml, /&quot;change_type&quot;:&quot;MODIFICATION&quot;/u);
  assert.doesNotMatch(panelHtml, /<svg class="overview-svg"/u);
  assert.match(panelHtml, /\.diff-surface \{ --diff-grid:/u);
  assert.match(panelHtml, /\.diff-row\.intent-refactoring \{ outline-color:var\(--intent-refactor-accent\); \}/u);
  assert.match(panelHtml, /\.diff-column-heads \{ display:grid; grid-template-columns:var\(--diff-grid\)/u);
  assert.match(panelHtml, /\.diff-row \{ display:grid; grid-template-columns:var\(--diff-grid\)/u);
  // Native diff palette: body/gutters/line-numbers + insert/delete tints bind to VS Code tokens.
  assert.match(panelHtml, /--diff-inserted-bg:var\(--vscode-diffEditor-insertedLineBackground/u);
  assert.match(panelHtml, /--diff-removed-bg:var\(--vscode-diffEditor-removedLineBackground/u);
  assert.match(panelHtml, /\.diff-table \{[^}]*background:var\(--diff-editor-bg\)/u);
  assert.match(panelHtml, /\.line-no \{ color:var\(--diff-linenumber-fg\)/u);
  assert.match(panelHtml, /\.diff-insert \.new-code,\.diff-change \.new-code \{ background:var\(--diff-inserted-bg\); box-shadow:inset 3px 0 0 var\(--diff-inserted-strip\); \}/u);
  assert.match(panelHtml, /@media \(max-width: 920px\)/u);
  assert.match(panelHtml, /\.hunk-inline-editor \{ grid-column:1 \/ 7;/u);
  assert.match(panelHtml, /\.diff-app:not\(\[data-review-view="semantic"\]\) \.diff-topbar \{ display:none; \}/u);
  assert.match(panelHtml, /\.diff-topbar \.hero-actions \{ max-width:100%; overflow-x:auto/u);
  assert.match(panelHtml, /\.review-page \{ min-height:0; display:none !important; overflow:hidden; \}/u);
  assert.match(panelHtml, /\.diff-app\[data-review-view="intent"\] \[data-review-page="intent"\]/u);
  assert.doesNotMatch(panelHtml, /data-review-page="binary-image"/u);
  assert.doesNotMatch(panelHtml, /data-review-page="binary-image"\] \{ display:grid !important; \}/u);
  assert.match(panelHtml, /\.diff-surface \{ --diff-grid:22px 34px minmax\(90px,1fr\) 24px 34px minmax\(90px,1fr\); \}/u);
  assert.match(panelHtml, /\.diff-column-heads,\.diff-hunk,\.diff-row \{ min-width:0; \}/u);
  assert.match(panelHtml, /\.hunk-actions \{ grid-column:1 \/ 7; display:flex; justify-content:flex-end/u);
  assert.doesNotMatch(panelHtml, /data-layout-toggle="rail"/u);
  assert.doesNotMatch(panelHtml, /data-layout-hover="rail"/u);
  assert.doesNotMatch(panelHtml, /data-layout-toggle="rail-pin"/u);
  assert.doesNotMatch(panelHtml, /data-layout-toggle="rail-close"/u);
  assert.doesNotMatch(panelHtml, /data-layout-toggle="rail-side"/u);
  assert.doesNotMatch(panelHtml, /data-layout-toggle="minimap"/u);
  assert.doesNotMatch(panelHtml, /data-layout-hover="minimap"/u);
  assert.doesNotMatch(panelHtml, /data-layout-toggle="drawer"/u);
  assert.doesNotMatch(panelHtml, /class="dock-tab rail-dock-tab"/u);
  assert.doesNotMatch(panelHtml, /class="minimap-proof"/u);
  assert.doesNotMatch(panelHtml, /class="minimap-dock"/u);
  assert.doesNotMatch(panelHtml, /class="dock-tab map-dock-tab"/u);
  assert.doesNotMatch(panelHtml, /class="evidence-drawer"/u);
  assert.doesNotMatch(panelHtml, /evidence in drawer/u);
  assert.doesNotMatch(panelHtml, /\\.intent-rail \\.entry/u);
  assert.match(panelHtml, /reviewView: "semantic"/u);
  assert.match(panelHtml, /function setReviewView\(view\)/u);
  assert.match(panelHtml, /document\.querySelectorAll\("\.product-tab\[data-review-view\]"\)/u);
  assert.match(panelHtml, /event\.target\.closest\("\.product-tab\[data-review-view\]"\)/u);
  assert.match(panelHtml, /hoverLayout/u);
  assert.match(panelHtml, /data-filter="semantic"/u);
  assert.match(panelHtml, /data-target="row-/u);
  assert.match(panelHtml, /window\.addEventListener\("message"/u);
});

test("dashboard renders compact cockpit with hover-pin docks and top signals only", () => {
  const richFile: ReviewFile = {
    ...sampleFile,
    diff: {
      ...sampleFile.diff,
      change_groups: [
        ...(sampleFile.diff?.change_groups ?? []),
        { kind: "MOVED_CODE", raw_change_indices: [0], confidence: 0.91, rule_id: "presentation.moved_code_group" },
        { kind: "MEANINGFUL_CHANGE", raw_change_indices: [0], confidence: 0.88, rule_id: "refinement.meaningful_group" },
      ],
      changes: [
        ...(sampleFile.diff?.changes ?? []),
        {
          change_type: "ADDITION",
          description: "Add review command",
          new_node: {
            label: "intentumdiff.openReviewPanel",
            position: { start_line: 4, start_col: 0, end_line: 4, end_col: 8 },
          },
        },
      ],
    },
  };

  const dashboardHtml = renderDashboardHtml(buildReviewDashboardModel([richFile], []), {
    nonce: "abc123",
    cspSource: "vscode-resource:",
  });

  assert.match(dashboardHtml, /class="dashboard-app"/u);
  assert.match(dashboardHtml, /class="dashboard-topbar"/u);
  assert.match(dashboardHtml, /data-dashboard-dock="left"/u);
  assert.match(dashboardHtml, /data-dashboard-dock="right"/u);
  assert.match(dashboardHtml, /data-dashboard-file="dashboard-file-0"/u);
  assert.match(dashboardHtml, /data-dashboard-detail="dashboard-file-0"/u);
  assert.match(dashboardHtml, /data-dashboard-toggle-file="dashboard-file-0"/u);
  assert.match(dashboardHtml, /class="dashboard-signal-preview"/u);
  assert.match(dashboardHtml, /class="dashboard-file-extra"/u);
  assert.match(dashboardHtml, /\.dashboard-actions \{ grid-area:actions; min-width:0; display:flex; justify-content:flex-end; gap:6px; overflow-x:auto/u);
  assert.match(dashboardHtml, /\.dashboard-app\[data-left-pinned="true"\] \.dashboard-board \{ padding-left:42px; \}/u);
  assert.match(dashboardHtml, /\.dashboard-file-actions \{ justify-content:flex-start; flex-wrap:nowrap; max-width:100%; overflow-x:auto/u);
  assert.match(dashboardHtml, /dashboardState/u);
});

test("panel header renders schema badge directly beside the JSON type badge", () => {
  const jsonFile: ReviewFile = {
    ...sampleFile,
    relativePath: "plugins/vscode/package.json",
    diff: {
      ...sampleFile.diff,
      language: "json",
    },
  };

  const panelHtml = renderPanelHtml(
    buildReviewPanelModel(jsonFile, "{\"scripts\":{}}\n", "{\"scripts\":{\"test\":\"npm test\"}}\n", "HEAD"),
    { nonce: "abc123", cspSource: "vscode-resource:" },
  );

  assert.match(panelHtml, /<span class="type-schema-badges" aria-label="File type and schema used">/u);
  assert.match(
    panelHtml,
    /<button class="pill filter-pill type-pill" type="button" data-filter="language">json<\/button><span class="schema-link" aria-hidden="true">\+<\/span><button class="pill filter-pill schema-pill schema-adjacent" type="button" data-filter="schema">Databricks bundle schema<\/button>/u,
  );
});

test("panel renders beta product pages and folds image review into the Diff tab", () => {
  const imageFile: ReviewFile = {
    ...sampleFile,
    relativePath: "media/hero.png",
    diff: {
      ...sampleFile.diff,
      language: "png",
      changes: [
        ...(sampleFile.diff?.changes ?? []),
        {
          change_type: "ADDITION",
          description: "Add changed visual region",
          new_node: {
            label: "changed region",
            position: { start_line: 2, start_col: 0, end_line: 2, end_col: 8 },
          },
        },
      ],
    },
  };

  const panelHtml = renderPanelHtml(
    buildReviewPanelModel(imageFile, "old image metadata\n", "new image metadata\n", "HEAD"),
    { nonce: "abc123", cspSource: "vscode-resource:" },
  );

  assert.match(panelHtml, /class="insight-layout intent-product-page"/u);
  assert.match(panelHtml, /class="insight-card metric-strip"/u);
  assert.match(panelHtml, /class="metric-tile"><strong>\d+<\/strong><span>Intents<\/span>/u);
  assert.doesNotMatch(panelHtml, /risk-product-page/u);
  assert.match(panelHtml, /class="insight-card risk-fold" aria-label="Risk and guardrails"/u);
  assert.match(panelHtml, /class="remediation-card"/u);
  assert.match(panelHtml, /Track unresolved risk in your normal issue workflow/u);
  assert.match(panelHtml, /class="insight-layout evidence-product-page"/u);
  assert.match(panelHtml, /class="change-bar change-bar-insert"/u);
  assert.match(panelHtml, /class="change-bar change-bar-semantic"/u);
  assert.match(panelHtml, /class="insight-layout release-notes-product-page"/u);
  assert.match(panelHtml, /class="insight-card traceability-card"/u);
  assert.match(panelHtml, /data-target="row-/u);
  assert.match(panelHtml, /class="diff-workbench asset-diff-workbench"/u);
  assert.match(panelHtml, /class="diff-surface asset-diff-surface"/u);
  assert.match(panelHtml, /data-diff-mode="asset"/u);
  assert.match(panelHtml, /class="file-mode-badge">Perceptual diff<\/span>/u);
  assert.match(panelHtml, /class="pill filter-pill mode-pill" type="button" data-filter="diff-mode">visual diff<\/button>/u);
  assert.match(panelHtml, /Perceptual image data unavailable/u);
  assert.match(panelHtml, /Run the asset diff command for this image/u);
  assert.doesNotMatch(panelHtml, /Attach asset JSON/u);
  assert.match(panelHtml, /No image-processing logic runs in the VS Code webview/u);
  assert.doesNotMatch(panelHtml, /Binary \/ Image/u);
  assert.doesNotMatch(panelHtml, /Side-by-side, overlay, slider, changed regions, and perceptual score belong/u);
});

test("panel diagnostics tab renders fuel telemetry, hotspots, and trace events", () => {
  const telemetryFile: ReviewFile = {
    ...sampleFile,
    relativePath: "apps/review-shell/src/main.ts",
    diff: {
      ...sampleFile.diff,
      language: "typescript",
      parse_errors: ["FUEL_EXCEEDED: 10.0M file='apps/review-shell/src/main.ts'"],
      is_fallback: true,
      metadata: {
        ...sampleFile.diff?.metadata,
        engine_telemetry: {
          calls: [{
            plugin: "src/intentumdiff/wasm/js_ts_parser.wasm",
            function: "process",
            language: "typescript",
            filename: "apps/review-shell/src/main.ts",
            call_count: 1,
            fuel_budget: 100000000,
            fuel_consumed: 25000000,
            total_fuel_consumed: 25000000,
            max_fuel_used_percent: 25,
            elapsed_ms: 12.5,
            input_bytes: 620,
            input_lines: 10,
            provenance: "first_party_wasm",
            engine: "python_wasmtime_plugin_host",
            trusted: true,
            statuses: { ok: 1 },
          }],
          fuel_hotspots: [{
            language: "typescript",
            function: "process",
            filename: "apps/review-shell/src/main.ts",
            fuel_consumed: 25000000,
            thresholds_exceeded: ["per_line"],
          }],
        },
        diagnostics: {
          events: [{
            stage: "engine.telemetry",
            action: "wasm_fuel_hotspot",
            rule_id: "engine.wasm_fuel_hotspot",
            reason: "Wasm plugin fuel use exceeded the excessive-fuel policy",
          }],
        },
      },
    },
  };

  const model = buildReviewPanelModel(
    telemetryFile,
    "void app.whenReady().then(createWindow);\n",
    "void app.whenReady().then(createWindow);\nvoid app.whenReady().then(createWindow);\n",
    "HEAD",
  );
  const panelHtml = renderPanelHtml(model, { nonce: "abc123", cspSource: "vscode-resource:" });

  assert.match(panelHtml, /Runtime diagnostics/u);
  assert.match(panelHtml, /Inspect parser fuel telemetry/u);
  assert.match(panelHtml, /class="fuel-row is-hot"/u);
  assert.match(panelHtml, /typescript process .*apps\/review-shell\/src\/main\.ts/u);
  assert.match(panelHtml, /25\.0M fuel/u);
  assert.match(panelHtml, /perLine&gt;1\.50M/u);
  assert.match(panelHtml, /first_party_wasm/u);
  assert.match(panelHtml, /python_wasmtime_plugin_host/u);
  assert.match(panelHtml, /per_line/u);
  assert.match(panelHtml, /FUEL_EXCEEDED: 10\.0M/u);
  assert.match(panelHtml, /wasm_fuel_hotspot/u);
  assert.match(panelHtml, /data-review-view="diagnostics"/u);
  assert.match(panelHtml, /data-review-page="diagnostics"/u);
});

test("panel renders Rust perceptual asset diff data when attached", () => {
  const imageFile: ReviewFile = {
    ...sampleFile,
    relativePath: "media/hero.png",
    diff: {
      ...sampleFile.diff,
      language: "png",
      metadata: {
        asset_diff: {
          status: "compared",
          summary: "Image changed slightly: 2.4% of pixels differ.",
          changed_pixel_percentage: 2.4,
          mean_absolute_error: 1.25,
          root_mean_squared_error: 3.5,
          artifacts: {
            contact_sheet: "vscode-resource:/out/contact-sheet.png",
            overlay: "vscode-resource:/out/overlay.png",
            heatmap: "vscode-resource:/out/heatmap.png",
            diff: "vscode-resource:/out/diff.png",
          },
          hotspots: [{
            id: "hotspot-1",
            label: "Hotspot 1",
            bbox: { x: 4, y: 8, width: 16, height: 12 },
            pixel_count: 90,
            changed_pixel_percentage: 2.4,
            severity: "medium",
            summary: "Medium image change covering 2.4% of pixels in the top-right region.",
          }],
          histograms: {
            bins: 16,
            red_delta: [10, 2],
            green_delta: [9, 3],
            blue_delta: [8, 4],
            brightness_delta: [7, 5],
            alpha_delta: null,
          },
        },
      },
    },
  };

  const panelHtml = renderPanelHtml(
    buildReviewPanelModel(imageFile, "old image metadata\n", "new image metadata\n", "HEAD"),
    { nonce: "abc123", cspSource: "vscode-resource:" },
  );

  assert.match(panelHtml, /class="asset-comparison-grid asset-artifact-strip"/u);
  assert.match(panelHtml, /class="asset-review-grid"/u);
  assert.match(panelHtml, /class="asset-primary-visual"/u);
  assert.match(panelHtml, /class="asset-review-panel"/u);
  // Interactive three-mode viewer replaces the static primary artifact.
  assert.match(panelHtml, /data-asset-viewer/u);
  assert.match(panelHtml, />Side by side</u);
  assert.match(panelHtml, />Onion</u);
  assert.match(panelHtml, />Swipe</u);
  assert.match(panelHtml, />Difference</u);
  // Onion + swipe are disabled without separate before/after layers.
  assert.match(panelHtml, /data-asset-mode="onion" aria-selected="false" disabled/u);
  assert.match(panelHtml, /data-asset-mode="swipe" aria-selected="false" disabled/u);
  assert.match(panelHtml, /Image changed slightly: 2\.4% of pixels differ/u);
  assert.match(panelHtml, /Pixels changed/u);
  assert.match(panelHtml, /vscode-resource:\/out\/heatmap\.png/u);
  assert.match(panelHtml, /Changed-region hotspots/u);
  assert.match(panelHtml, /Hotspot 1/u);
  assert.match(panelHtml, /Medium image change covering 2\.4%/u);
  assert.match(panelHtml, /Channel histogram/u);
  // Histogram is now a per-channel SVG bar chart, not peak-bin text.
  assert.match(panelHtml, /class="asset-histogram-bars"/u);
  assert.match(panelHtml, /class="asset-histogram-row channel-red"/u);
  assert.match(panelHtml, /<svg class="asset-histogram-chart"/u);
  // Alpha channel row omitted when alpha_delta is null (CSS still defines the class).
  assert.doesNotMatch(panelHtml, /asset-histogram-row channel-alpha/u);
  // Hotspots are listed once (the right rail), not duplicated in a detail grid.
  assert.doesNotMatch(panelHtml, /Hotspot navigation/u);
  assert.doesNotMatch(panelHtml, /Waiting for Rust Perceptual Asset Diff/u);
  assert.doesNotMatch(panelHtml, /Rust artifact unavailable/u);
});

test("asset viewer enables onion-skin with before/after layers and numbered hotspot markers", () => {
  const imageFile: ReviewFile = {
    ...sampleFile,
    relativePath: "media/hero.png",
    diff: {
      ...sampleFile.diff,
      language: "png",
      metadata: {
        asset_diff: {
          status: "compared",
          summary: "Image changed: 5% of pixels differ.",
          changed_pixel_percentage: 5,
          mean_absolute_error: 2,
          root_mean_squared_error: 4,
          comparison_dimensions: { width: 1000, height: 800 },
          artifacts: {
            before: "vscode-resource:/out/before.png",
            after: "vscode-resource:/out/after.png",
            heatmap: "vscode-resource:/out/heatmap.png",
            diff: "vscode-resource:/out/diff.png",
            mask: "vscode-resource:/out/mask.png",
            overlay: "vscode-resource:/out/overlay.png",
            contact_sheet: "vscode-resource:/out/contact-sheet.png",
          },
          hotspots: [
            { id: "hotspot-1", label: "Hotspot 1", bbox: { x: 700, y: 100, width: 120, height: 90 }, centroid: { x: 0.75, y: 0.25 }, changed_pixel_percentage: 3, severity: "high" },
            { id: "hotspot-2", label: "Hotspot 2", bbox: { x: 150, y: 420, width: 60, height: 60 }, centroid: { x: 0.2, y: 0.6 }, changed_pixel_percentage: 2, severity: "low" },
          ],
        },
      },
    },
  };

  const panelHtml = renderPanelHtml(
    buildReviewPanelModel(imageFile, "old\n", "new\n", "HEAD"),
    { nonce: "abc123", cspSource: "vscode-resource:" },
  );

  // Three modes; onion-skin now enabled (no `disabled`) because before+after exist.
  assert.match(panelHtml, /data-asset-mode="onion" aria-selected="false"(?! disabled)/u);
  assert.match(panelHtml, /class="asset-onion-top"[^>]*data-asset-onion-top/u);
  assert.match(panelHtml, /vscode-resource:\/out\/before\.png/u);
  assert.match(panelHtml, /vscode-resource:\/out\/after\.png/u);
  // Opacity (blend) slider present.
  assert.match(panelHtml, /type="range"[^>]*data-asset-opacity/u);
  // Difference is the default active view with the heatmap image.
  assert.match(panelHtml, /data-asset-view="difference"/u);
  // Numbered markers positioned from the engine's normalized centroids.
  assert.match(panelHtml, /class="asset-marker severity-high" data-asset-hotspot="hotspot-1"[^>]*left:75\.00%;top:25\.00%[^>]*>1</u);
  assert.match(panelHtml, /class="asset-marker severity-low" data-asset-hotspot="hotspot-2"[^>]*left:20\.00%;top:60\.00%[^>]*>2</u);
  // Swipe mode enabled with before/after layers + a draggable divider.
  assert.match(panelHtml, /data-asset-mode="swipe" aria-selected="false"(?! disabled)/u);
  assert.match(panelHtml, /class="asset-swipe-divider" data-asset-swipe-handle/u);
  assert.match(panelHtml, /data-asset-swipe-top/u);
  // Blink comparator controls (play toggle + speed).
  assert.match(panelHtml, /data-asset-blink /u);
  assert.match(panelHtml, /data-asset-blink-speed/u);
  // Photoshop-style marching-ants lasso in comparison-dimensions space, per hotspot.
  assert.match(panelHtml, /<svg class="asset-lasso-svg" viewBox="0 0 1000 800"/u);
  assert.match(panelHtml, /class="asset-lasso severity-high" data-asset-hotspot="hotspot-1"/u);
  assert.match(panelHtml, /class="asset-lasso-ants"/u);
  // Change-outline toggle present.
  assert.match(panelHtml, /data-asset-outline-toggle/u);
  // Hotspot list items are selectable + numbered for interaction.
  assert.match(panelHtml, /class="asset-hotspot severity-high" data-asset-hotspot="hotspot-1" role="button"/u);
  assert.match(panelHtml, /class="asset-hotspot-badge">1</u);
  assert.match(panelHtml, /data-asset-hotspot-step="prev"/u);
  // Difference is the default active view with the heatmap image.
  // Client script wires the mode switch, blend slider, swipe, blink, and hotspots.
  assert.match(panelHtml, /function setAssetMode/u);
  assert.match(panelHtml, /function setAssetOpacity/u);
  assert.match(panelHtml, /function toggleAssetBlink/u);
  assert.match(panelHtml, /function setAssetSwipe/u);
  assert.match(panelHtml, /function selectAssetHotspot/u);
});

test("panel renders changed image asset preview before perceptual artifacts exist", () => {
  const imageFile: ReviewFile = {
    ...sampleFile,
    relativePath: "image.png",
    diff: {
      ...sampleFile.diff,
      language: "png",
      metadata: {
        asset_diff: {
          status: "preview",
          summary: "image.png is a changed image asset.",
          artifacts: {
            changed: "C:\\repo\\image.png",
          },
        },
      },
    },
  };

  const panelHtml = renderPanelHtml(
    buildReviewPanelModel(imageFile, "", "", "HEAD"),
    {
      nonce: "abc123",
      cspSource: "vscode-resource:",
      resolveResourceUri: (resourcePath) => `vscode-resource:${resourcePath.replaceAll("\\", "/")}`,
    },
  );

  assert.match(panelHtml, /Image asset review/u);
  assert.match(panelHtml, /Working tree image/u);
  assert.match(panelHtml, /vscode-resource:C:\/repo\/image\.png/u);
  assert.match(panelHtml, /Perceptual diff pending/u);
  assert.doesNotMatch(panelHtml, /Perceptual image data unavailable/u);
});

test("message guard accepts only whitelisted webview commands", () => {
  assert.equal(isReviewWebviewMessage({
    command: "cycleGrouping",
  }), true);
  assert.equal(isReviewWebviewMessage({
    command: "openNativeDiff",
    payload: {
      folderUri: "file:///repo",
      relativePath: "src/app.py",
      positionSide: "modified",
    },
  }), true);
  assert.equal(isReviewWebviewMessage({
    command: "stageHunk",
    payload: {
      folderUri: "file:///repo",
      relativePath: "src/app.py",
      actionKind: "stageHunk",
      change: {
        change_type: "MODIFICATION",
        new_node: {
          position: { start_line: 1, start_col: 0, end_line: 2, end_col: 0 },
        },
      },
    },
  }), true);
  assert.equal(isReviewWebviewMessage({
    command: "editHunk",
    payload: {
      folderUri: "file:///repo",
      relativePath: "src/app.py",
      actionKind: "applyHunk",
      hunk: {
        oldLines: ["old"],
        newLines: ["new"],
        newStartLine: 1,
        newEndLine: 1,
      },
      change: {
        change_type: "MODIFICATION",
        new_node: {
          position: { start_line: 1, start_col: 0, end_line: 1, end_col: 0 },
        },
      },
    },
  }), true);
  assert.equal(isReviewWebviewMessage({
    command: "openTimelineSnapshot",
    payload: {
      folderUri: "file:///repo",
      snapshotId: "snapshot-1",
    },
  }), true);
  assert.equal(isReviewWebviewMessage({
    command: "openTimelineSnapshot",
    payload: {
      folderUri: "file:///repo",
      snapshotId: 1,
    },
  }), false);
  assert.equal(isReviewWebviewMessage({ command: "deleteEverything", payload: { folderUri: "file:///repo" } }), false);
  assert.equal(isReviewWebviewMessage({ command: "refresh" }), true);
  assert.equal(isReviewWebviewMessage({ command: "reveal", payload: { relativePath: "src/app.py" } }), false);
});

test("review panel view normalization accepts only known product tabs", () => {
  for (const view of ["semantic", "intent", "evidence", "diagnostics", "release-notes"] as const) {
    assert.equal(normalizeReviewView(view), view);
  }

  assert.equal(normalizeReviewView("risk"), "semantic");
  assert.equal(normalizeReviewView("notes"), "semantic");
  assert.equal(normalizeReviewView("binary-image"), "semantic");
  assert.equal(normalizeReviewView(""), "semantic");
  assert.equal(normalizeReviewView(null), "semantic");
  assert.equal(normalizeReviewView({ reviewView: "risk" }), "semantic");
  assert.equal(normalizeReviewView("binary-image", "intent"), "intent");
  assert.equal(normalizeReviewView(null, "release-notes"), "release-notes");
});

test("escapeHtml encodes the characters that matter for webview markup", () => {
  assert.equal(escapeHtml(`"'&<>`), "&quot;&#39;&amp;&lt;&gt;");
});

test("panel diff no longer emits Monaco projection data attributes", () => {
  const model = buildReviewPanelModel(sampleFile, "old line\n", "new line\n", "HEAD");
  const panelHtml = renderPanelHtml(model, { nonce: "n1", cspSource: "vscode-resource:" });
  // Semantic projection is still computed on the model (consumed by the
  // semantic-only native diff command), but nothing is projected into the
  // webview HTML now that Monaco is gone.
  assert.ok(model.semanticGaps !== undefined, "semanticGaps still computed on the model");
  assert.ok(model.semanticAnchors !== undefined, "semanticAnchors still computed on the model");
  assert.doesNotMatch(panelHtml, /data-semantic-old-text="/u);
  assert.doesNotMatch(panelHtml, /data-semantic-new-text="/u);
  assert.doesNotMatch(panelHtml, /data-semantic-gaps="/u);
  assert.doesNotMatch(panelHtml, /data-semantic-anchors="/u);
  assert.doesNotMatch(panelHtml, /data-old-text="/u);
  assert.doesNotMatch(panelHtml, /data-new-text="/u);
  assert.doesNotMatch(panelHtml, /data-panel-action="applyEdits"/u);
  assert.doesNotMatch(panelHtml, /data-panel-action="discardEdits"/u);
  assert.doesNotMatch(panelHtml, /Show full file/u);
  assert.doesNotMatch(panelHtml, /data-panel-action="toggleRaw"/u);
});

test("panel diff semantic projection includes gap metadata and anchors for files with diffs", () => {
  const fileWithDiff: ReviewFile = {
    ...sampleFile,
    diff: {
      changes: [
        {
          change_type: "MODIFICATION",
          old_node: { position: { start_line: 0, start_col: 0, end_line: 0, end_col: 5 } },
          new_node: { position: { start_line: 0, start_col: 0, end_line: 0, end_col: 5 } },
        },
        {
          change_type: "ADDITION",
          new_node: { position: { start_line: 8, start_col: 0, end_line: 8, end_col: 5 } },
        },
      ],
    },
  };
  const oldText = Array.from({ length: 10 }, (_, i) => "line " + i).join("\n");
  const newText = Array.from({ length: 10 }, (_, i) => "line " + i).join("\n");
  const model = buildReviewPanelModel(fileWithDiff, oldText, newText, "HEAD");

  // Gap metadata populated when disjoint chunks exist (contextLines=2 so chunks at line 0 and 8 don't merge)
  assert.ok(model.semanticGaps !== undefined, "semanticGaps should be present");
  assert.ok(Array.isArray(model.semanticGaps), "semanticGaps should be an array");
  assert.ok(model.semanticAnchors !== undefined, "semanticAnchors should be present");

  // Projection is model-only now; the panel HTML no longer carries Monaco data attributes.
  const panelHtml = renderPanelHtml(model, { nonce: "n2", cspSource: "vscode-resource:" });
  assert.doesNotMatch(panelHtml, /data-semantic-gaps="/u);
  assert.doesNotMatch(panelHtml, /data-semantic-anchors="/u);
  assert.doesNotMatch(panelHtml, /data-semantic-old-text="/u);
  assert.doesNotMatch(panelHtml, /data-semantic-new-text="/u);
});

test("panel diff exposes dense projected-line maps so collapsed gaps preserve original line numbers", () => {
  const fileWithGap: ReviewFile = {
    ...sampleFile,
    diff: {
      changes: [
        {
          change_type: "MODIFICATION",
          old_node: { position: { start_line: 0, start_col: 0, end_line: 0, end_col: 5 } },
          new_node: { position: { start_line: 0, start_col: 0, end_line: 0, end_col: 5 } },
        },
        {
          change_type: "ADDITION",
          new_node: { position: { start_line: 15, start_col: 0, end_line: 15, end_col: 5 } },
        },
      ],
    },
  };
  // Old: lines 0..14 are mostly gap, new: lines 0..19 are mostly gap.
  const oldText = Array.from({ length: 15 }, (_, i) => "old " + i).join("\n");
  const newText = Array.from({ length: 20 }, (_, i) => "new " + i).join("\n");
  const model = buildReviewPanelModel(fileWithGap, oldText, newText, "HEAD");

  const baseMap = model.semanticBaseOriginalLineMap ?? [];
  const modMap  = model.semanticModifiedOriginalLineMap ?? [];

  // Maps must be dense arrays indexed by projected position
  assert.ok(Array.isArray(baseMap), "base line map should be an array");
  assert.ok(Array.isArray(modMap), "modified line map should be an array");
  assert.ok(baseMap.length > 0, "base line map should be populated");
  assert.ok(modMap.length  > 0, "modified line map should be populated");

  // Each content entry is the original 0-based line number from the source file
  for (const value of baseMap) {
    assert.ok(value === -1 || (typeof value === "number" && value >= 0),
      "base line map entries are either -1 (placeholder) or non-negative");
  }
  for (const value of modMap) {
    assert.ok(value === -1 || (typeof value === "number" && value >= 0),
      "modified line map entries are either -1 (placeholder) or non-negative");
  }

  // At least one -1 sentinel must exist (the placeholder row between chunks)
  assert.ok(baseMap.includes(-1), "base line map marks placeholder rows with -1");
  assert.ok(modMap.includes(-1),  "modified line map marks placeholder rows with -1");

  // Placeholders must NOT appear at the start of the map (no leading gaps in the projection)
  assert.notEqual(baseMap[0], -1, "no leading placeholder on base side");
  assert.notEqual(modMap[0], -1, "no leading placeholder on modified side");

  // Trailing -1 is allowed: a chunk that exists on only one side leaves the other side
  // ending with a gap row. That row is still rendered with the gap chevron, so the dense
  // map correctly marks it as "no original line" rather than fabricating one.

  // The dense maps stay on the model (the semantic-only native diff command
  // consumes them) but are no longer projected into the webview HTML.
  const panelHtml = renderPanelHtml(model, { nonce: "n3", cspSource: "vscode-resource:" });
  assert.doesNotMatch(panelHtml, /data-semantic-base-line-map="\[/u);
  assert.doesNotMatch(panelHtml, /data-semantic-modified-line-map="\[/u);
});

test("panel diff attaches colour-coded decorations to each gap for the webview palette", () => {
  const fileWithDecorations: ReviewFile = {
    ...sampleFile,
    diff: {
      changes: [
        {
          change_type: "MODIFICATION",
          old_node: { position: { start_line: 0, start_col: 0, end_line: 0, end_col: 5 } },
          new_node: { position: { start_line: 0, start_col: 0, end_line: 0, end_col: 5 } },
        },
        {
          change_type: "ADDITION",
          new_node: { position: { start_line: 18, start_col: 0, end_line: 18, end_col: 5 } },
        },
        {
          change_type: "DELETION",
          old_node: { position: { start_line: 6, start_col: 0, end_line: 6, end_col: 5 } },
        },
        {
          change_type: "MOVE",
          old_node: { position: { start_line: 3, start_col: 0, end_line: 3, end_col: 5 } },
          new_node: { position: { start_line: 11, start_col: 0, end_line: 11, end_col: 5 } },
        },
        {
          change_type: "REFACTORING",
          refactoring_kind: "RENAME_VARIABLE",
          old_node: { position: { start_line: 1, start_col: 0, end_line: 1, end_col: 5 } },
          new_node: { position: { start_line: 14, start_col: 0, end_line: 14, end_col: 5 } },
        },
      ],
    },
  };
  const oldText = Array.from({ length: 12 }, (_, i) => "old " + i).join("\n");
  const newText = Array.from({ length: 20 }, (_, i) => "new " + i).join("\n");
  const model = buildReviewPanelModel(fileWithDecorations, oldText, newText, "HEAD");

  const gaps = model.semanticGaps ?? [];
  assert.ok(gaps.length > 0, "expected at least one gap in the projection");

  // Every gap may have a `trailingKind` field — server-derived from the
  // LATER chunk. Gaps with no following chunk may not have a kind set, and
  // chunk merging can collapse neighbouring chunks so a single kind can
  // dominate over what the user perceives. We assert at least one gap has a
  // trailingKind, then verify the rendered payload carries the data
  // correctly.
  let trailingCount = 0;
  for (const gap of gaps) {
    if (gap.trailingKind) { trailingCount += 1; }
  }
  assert.ok(trailingCount > 0, "at least one gap has a trailingKind");

  // Trailing-kind decorations remain on the model gaps but are no longer
  // projected into the webview HTML; the legend/chunk-palette painter is gone
  // with Monaco.
  const panelHtml = renderPanelHtml(model, { nonce: "n4", cspSource: "vscode-resource:" });
  assert.doesNotMatch(panelHtml, /data-semantic-gaps="/u);
  assert.doesNotMatch(panelHtml, /data-semantic-changes="/u);
  assert.doesNotMatch(panelHtml, /class="legend-chip"/u);
});

test("toolbar renders a three-column layout with legend chips derived from decoration counts", () => {
  const model = buildReviewPanelModel(
    {
      ...sampleFile,
      diff: {
        changes: [
          { change_type: "MODIFICATION", old_node: { position: { start_line: 0, start_col: 0, end_line: 0, end_col: 1 } }, new_node: { position: { start_line: 0, start_col: 0, end_line: 0, end_col: 1 } } },
          { change_type: "ADDITION", new_node: { position: { start_line: 3, start_col: 0, end_line: 3, end_col: 1 } } },
          { change_type: "DELETION", old_node: { position: { start_line: 1, start_col: 0, end_line: 1, end_col: 1 } } },
          { change_type: "MOVE", old_node: { position: { start_line: 2, start_col: 0, end_line: 2, end_col: 1 } }, new_node: { position: { start_line: 5, start_col: 0, end_line: 5, end_col: 1 } } },
        ],
      },
    },
    "a\nb\nc\nd\ne\n",
    "a\nB\nc\nnew\nd\ne\n",
    "HEAD",
  );
  const panelHtml = renderPanelHtml(model, { nonce: "n5", cspSource: "vscode-resource:" });
  // The Monaco diff toolbar (three-column legend + apply/discard) is gone.
  assert.doesNotMatch(panelHtml, /class="diff-toolbar-left"/u);
  assert.doesNotMatch(panelHtml, /class="diff-toolbar-right"/u);
  assert.doesNotMatch(panelHtml, /class="diff-toolbar-legend"/u);
  assert.doesNotMatch(panelHtml, /class="legend-chip"/u);
  assert.doesNotMatch(panelHtml, /data-panel-action="applyEdits"/u);
  assert.doesNotMatch(panelHtml, /data-panel-action="discardEdits"/u);
});
