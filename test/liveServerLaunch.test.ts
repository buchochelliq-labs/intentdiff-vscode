// #100 Phase C — the native-by-default launch chooser. Pure functions from config.ts (vscode-free).
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
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

// The monorepo root, 4 hops up from out/test/. Absent in the extracted intentumdiff-vscode repo
// (#82 split), where there is no crate or staging script to check against.
const repoRoot = path.join(__dirname, "..", "..", "..", "..");

/** What `bundledLiveServerPath` actually probes for, asked of the function rather than of a
 *  copy of its platform expression — a copy would drift with the thing it is meant to pin. */
function probedBinaryName(): string {
  let probed = "";
  bundledLiveServerPath("C:/ext", (candidate) => {
    probed = candidate;
    return false;
  });
  return path.basename(probed, path.extname(probed));
}

// This exact mismatch shipped: the staged binary kept its pre-rebrand `intentdiff-` name while
// the lookup had moved to `intentumdiff-`, so the extension quietly fell back to the python
// engine and every install believed it was running native.
test("the bundled binary name is the one the native live-server crate builds", () => {
  const cargoPath = path.join(repoRoot, "crates", "live-server", "Cargo.toml");
  if (!existsSync(cargoPath)) {
    return;
  }
  const built = /\[\[bin\]\][\s\S]*?name\s*=\s*"([^"]+)"/.exec(readFileSync(cargoPath, "utf8"));
  assert.ok(built, "crates/live-server/Cargo.toml declares no [[bin]] name");
  assert.equal(
    probedBinaryName(),
    built[1],
    "the extension probes for a binary name the live-server crate does not build",
  );
});

test("the staging scripts copy the binary name the extension probes for", () => {
  const scripts = ["sync-local-dev.ps1", "install-vscode-extension.ps1"]
    .map((name) => path.join(repoRoot, "scripts", name))
    .filter((candidate) => existsSync(candidate));
  if (scripts.length === 0) {
    return;
  }
  const expected = `${probedBinaryName()}.exe`;
  for (const script of scripts) {
    const source = readFileSync(script, "utf8");
    assert.ok(
      source.includes(expected),
      `${path.basename(script)} does not stage ${expected}`,
    );
  }
});
