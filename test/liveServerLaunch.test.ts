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

const BUNDLED = "C:/ext/native/intentumdiff-live-server.exe";

test("explicit user executable always wins over the bundled native server", () => {
  assert.deepEqual(
    chooseLiveServerLaunch("C:/custom/intentumdiff-live-server.exe", "auto", BUNDLED),
    { kind: "python" },
  );
  assert.deepEqual(
    chooseLiveServerLaunch("/workspace/.venv/bin/intentumdiff", "native", BUNDLED),
    { kind: "python" },
  );
});

test("auto prefers the bundled native server when present", () => {
  assert.deepEqual(chooseLiveServerLaunch("intentumdiff", "auto", BUNDLED), {
    kind: "native",
    executable: BUNDLED,
  });
});

test("auto without a bundle stays on the python engine", () => {
  assert.deepEqual(chooseLiveServerLaunch("intentumdiff", "auto", undefined), { kind: "python" });
});

test("engine=python skips the bundle even when present", () => {
  assert.deepEqual(chooseLiveServerLaunch("intentumdiff", "python", BUNDLED), { kind: "python" });
});

test("engine=native uses the bundle, degrades to python when missing", () => {
  assert.deepEqual(chooseLiveServerLaunch("intentumdiff", "native", BUNDLED), {
    kind: "native",
    executable: BUNDLED,
  });
  assert.deepEqual(chooseLiveServerLaunch("intentumdiff", "native", undefined), { kind: "python" });
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
    "C:/stale/intentumdiff-live-server.exe",
    { kind: "python", userOverride: true, bundledPath: BUNDLED },
    "C:/ws/.venv/Scripts/intentumdiff.exe",
  );
  assert.match(details.message, /configured IntentumDiff executable does not exist/);
  assert.match(details.message, /bundled engine/);
  assert.equal(details.offerBundledFallback, true);
  // Never steer an override user at the .venv — that would be a downgrade suggestion.
  assert.equal(details.suggestedExecutable, undefined);
  assert.doesNotMatch(details.message, /\.venv/);
});

test("ENOENT on a user override without a bundle points at the setting only", () => {
  const details = enoentFailureDetails(
    "C:/stale/intentumdiff.exe",
    { kind: "python", userOverride: true, bundledPath: undefined },
    "C:/ws/.venv/Scripts/intentumdiff.exe",
  );
  assert.equal(details.offerBundledFallback, false);
  assert.match(details.message, /intentumdiff\.executable/);
});

test("ENOENT on the bundle itself means a broken install", () => {
  const details = enoentFailureDetails(
    BUNDLED,
    { kind: "native", userOverride: false, bundledPath: BUNDLED },
    "C:/ws/.venv/Scripts/intentumdiff.exe",
  );
  assert.match(details.message, /Reinstall the IntentumDiff extension/);
  assert.match(details.message, /liveServer\.engine/);
  assert.equal(details.offerBundledFallback, undefined);
});

test("ENOENT on the default python CLI keeps the workspace .venv suggestion", () => {
  const candidate = "C:/ws/.venv/Scripts/intentumdiff.exe";
  const details = enoentFailureDetails(
    "intentumdiff",
    { kind: "python", userOverride: false, bundledPath: undefined },
    candidate,
  );
  assert.match(details.message, /Install IntentumDiff into the workspace \.venv/);
  assert.equal(details.suggestedExecutable, candidate);
});

test("bundledLiveServerPath probes <ext>/native/<exe> with an injected exists", () => {
  const exe = process.platform === "win32"
    ? "intentumdiff-live-server.exe"
    : "intentumdiff-live-server";
  const expected = path.join("C:/ext", "native", exe);
  assert.equal(
    bundledLiveServerPath("C:/ext", (p) => p === expected),
    expected,
  );
  assert.equal(bundledLiveServerPath("C:/ext", () => false), undefined);
});
