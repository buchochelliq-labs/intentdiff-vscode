// #100 Phase C — the native-by-default launch chooser. Pure functions from config.ts (vscode-free).
import assert from "node:assert/strict";
import { test } from "node:test";
import * as path from "node:path";

import {
  bundledLiveServerPath,
  chooseLiveServerLaunch,
  enoentFailureDetails,
  normalizeLiveServerEngine,
} from "../src/config";

const BUNDLED = "C:/ext/native/intentdiff-live-server.exe";

test("explicit user executable always wins over the bundled native server", () => {
  assert.deepEqual(
    chooseLiveServerLaunch("C:/custom/intentdiff-live-server.exe", "auto", BUNDLED),
    { kind: "python" },
  );
  assert.deepEqual(
    chooseLiveServerLaunch("/workspace/.venv/bin/intentdiff", "native", BUNDLED),
    { kind: "python" },
  );
});

test("auto prefers the bundled native server when present", () => {
  assert.deepEqual(chooseLiveServerLaunch("intentdiff", "auto", BUNDLED), {
    kind: "native",
    executable: BUNDLED,
  });
});

test("auto without a bundle stays on the python engine", () => {
  assert.deepEqual(chooseLiveServerLaunch("intentdiff", "auto", undefined), { kind: "python" });
});

test("engine=python skips the bundle even when present", () => {
  assert.deepEqual(chooseLiveServerLaunch("intentdiff", "python", BUNDLED), { kind: "python" });
});

test("engine=native uses the bundle, degrades to python when missing", () => {
  assert.deepEqual(chooseLiveServerLaunch("intentdiff", "native", BUNDLED), {
    kind: "native",
    executable: BUNDLED,
  });
  assert.deepEqual(chooseLiveServerLaunch("intentdiff", "native", undefined), { kind: "python" });
});

test("normalizeLiveServerEngine coerces unknown values to auto", () => {
  assert.equal(normalizeLiveServerEngine("native"), "native");
  assert.equal(normalizeLiveServerEngine("python"), "python");
  assert.equal(normalizeLiveServerEngine("AUTO"), "auto");
  assert.equal(normalizeLiveServerEngine(42), "auto");
  assert.equal(normalizeLiveServerEngine(undefined), "auto");
});

test("ENOENT on a user override steers at the setting and offers the bundled engine", () => {
  const details = enoentFailureDetails(
    "C:/stale/intentdiff-live-server.exe",
    { kind: "python", userOverride: true, bundledPath: BUNDLED },
    "C:/ws/.venv/Scripts/intentdiff.exe",
  );
  assert.match(details.message, /configured IntentDiff executable does not exist/);
  assert.match(details.message, /bundled engine/);
  assert.equal(details.offerBundledFallback, true);
  // Never steer an override user at the .venv — that would be a downgrade suggestion.
  assert.equal(details.suggestedExecutable, undefined);
  assert.doesNotMatch(details.message, /\.venv/);
});

test("ENOENT on a user override without a bundle points at the setting only", () => {
  const details = enoentFailureDetails(
    "C:/stale/intentdiff.exe",
    { kind: "python", userOverride: true, bundledPath: undefined },
    "C:/ws/.venv/Scripts/intentdiff.exe",
  );
  assert.equal(details.offerBundledFallback, false);
  assert.match(details.message, /intentdiff\.executable/);
});

test("ENOENT on the bundle itself means a broken install", () => {
  const details = enoentFailureDetails(
    BUNDLED,
    { kind: "native", userOverride: false, bundledPath: BUNDLED },
    "C:/ws/.venv/Scripts/intentdiff.exe",
  );
  assert.match(details.message, /Reinstall the IntentDiff extension/);
  assert.match(details.message, /liveServer\.engine/);
  assert.equal(details.offerBundledFallback, undefined);
});

test("ENOENT on the default python CLI keeps the workspace .venv suggestion", () => {
  const candidate = "C:/ws/.venv/Scripts/intentdiff.exe";
  const details = enoentFailureDetails(
    "intentdiff",
    { kind: "python", userOverride: false, bundledPath: undefined },
    candidate,
  );
  assert.match(details.message, /Install IntentDiff into the workspace \.venv/);
  assert.equal(details.suggestedExecutable, candidate);
});

test("bundledLiveServerPath probes <ext>/native/<exe> with an injected exists", () => {
  const exe = process.platform === "win32"
    ? "intentdiff-live-server.exe"
    : "intentdiff-live-server";
  const expected = path.join("C:/ext", "native", exe);
  assert.equal(
    bundledLiveServerPath("C:/ext", (p) => p === expected),
    expected,
  );
  assert.equal(bundledLiveServerPath("C:/ext", () => false), undefined);
});
