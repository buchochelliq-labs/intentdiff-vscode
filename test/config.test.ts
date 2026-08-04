import assert from "node:assert/strict";
import test from "node:test";
import {
  buildLiveServerArgs,
  buildLiveServerEnv,
  debounceSeconds,
  readTrustedExecutable,
  readTrustedSchemaAllowPrivateHosts,
  readTrustedSchemaFetchMode,
} from "../src/config";

test("debounceSeconds converts milliseconds to seconds", () => {
  assert.equal(debounceSeconds({ debounceMs: 250 }), "0.25");
});

test("buildLiveServerArgs includes stdio ref debounce and optional fuel", () => {
  assert.deepEqual(
    buildLiveServerArgs("C:/repo", {
      executable: "intentumdiff",
      ref: "origin/main",
      enabled: true,
      debounceMs: 250,
      fuel: "inf",
      trace: false,
      schemaFetchMode: "auto",
      schemaCacheTtlHours: 24,
      schemaAllowPrivateHosts: false,
    }),
    [
      "live-server",
      "C:/repo",
      "--stdio",
      "--ref",
      "origin/main",
      "--debounce",
      "0.25",
      "--fuel",
      "inf",
    ],
  );
});

test("buildLiveServerArgs omits empty fuel values", () => {
  assert.deepEqual(
    buildLiveServerArgs("/repo", {
      executable: "intentumdiff",
      ref: "HEAD",
      enabled: true,
      debounceMs: 100,
      fuel: null,
      trace: false,
      schemaFetchMode: "auto",
      schemaCacheTtlHours: 24,
      schemaAllowPrivateHosts: false,
    }),
    ["live-server", "/repo", "--stdio", "--ref", "HEAD", "--debounce", "0.1"],
  );
});

test("buildLiveServerEnv maps schema settings to Python env vars", () => {
  assert.deepEqual(
    buildLiveServerEnv({
      executable: "intentumdiff",
      ref: "HEAD",
      enabled: true,
      debounceMs: 100,
      fuel: null,
      trace: false,
      schemaFetchMode: "cache-only",
      schemaCacheTtlHours: 2.5,
      schemaAllowPrivateHosts: true,
    }),
    {
      INTENTUMDIFF_SCHEMA_FETCH: "cache-only",
      INTENTUMDIFF_SCHEMA_CACHE_TTL_SECONDS: "9000",
      INTENTUMDIFF_SCHEMA_ALLOW_PRIVATE_HOSTS: "1",
    },
  );
});

test("readTrustedExecutable ignores workspace-provided executable", () => {
  const executable = readTrustedExecutable({
    get: <T>(_section: string, defaultValue: T) => defaultValue,
    inspect: <T>() => ({
      defaultValue: "intentumdiff" as T,
      globalValue: "C:/Tools/intentumdiff.exe" as T,
      workspaceValue: "C:/repo/malicious.exe" as T,
      workspaceFolderValue: "C:/repo/folder-malicious.exe" as T,
    }),
  });

  assert.equal(executable, "C:/Tools/intentumdiff.exe");
});

test("readTrustedExecutable falls back to default when only workspace value exists", () => {
  const executable = readTrustedExecutable({
    get: <T>(_section: string, defaultValue: T) => defaultValue,
    inspect: <T>() => ({
      defaultValue: "intentumdiff" as T,
      workspaceValue: "C:/repo/malicious.exe" as T,
    }),
  });

  assert.equal(executable, "intentumdiff");
});

test("readTrustedExecutable never reads workspace value through get when inspection is available", () => {
  const executable = readTrustedExecutable({
    get: <T>() => "C:/repo/malicious.exe" as T,
    inspect: <T>() => ({
      workspaceValue: "C:/repo/malicious.exe" as T,
    }),
  });

  assert.equal(executable, "intentumdiff");
});

test("schema fetch mode ignores workspace-provided auto value", () => {
  const mode = readTrustedSchemaFetchMode({
    get: <T>(_section: string, defaultValue: T) => defaultValue,
    inspect: <T>() => ({
      defaultValue: "cache-only" as T,
      workspaceValue: "auto" as T,
      workspaceFolderValue: "auto" as T,
    }),
  });

  assert.equal(mode, "cache-only");
});

test("schema fetch mode accepts global auto value", () => {
  const mode = readTrustedSchemaFetchMode({
    get: <T>(_section: string, defaultValue: T) => defaultValue,
    inspect: <T>() => ({
      defaultValue: "cache-only" as T,
      globalValue: "auto" as T,
      workspaceValue: "off" as T,
    }),
  });

  assert.equal(mode, "auto");
});

test("schema private-host opt-in ignores workspace value", () => {
  const allow = readTrustedSchemaAllowPrivateHosts({
    get: <T>(_section: string, defaultValue: T) => defaultValue,
    inspect: <T>() => ({
      defaultValue: false as T,
      workspaceValue: true as T,
      workspaceFolderValue: true as T,
    }),
  });

  assert.equal(allow, false);
});

test("schema private-host opt-in accepts global value", () => {
  const allow = readTrustedSchemaAllowPrivateHosts({
    get: <T>(_section: string, defaultValue: T) => defaultValue,
    inspect: <T>() => ({
      defaultValue: false as T,
      globalValue: true as T,
      workspaceValue: false as T,
    }),
  });

  assert.equal(allow, true);
});
