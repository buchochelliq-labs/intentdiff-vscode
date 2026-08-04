import * as path from "path";
import { existsSync } from "fs";

import type { LiveServerSettings } from "./types";

interface ConfigurationInspection<T> {
  defaultValue?: T;
  globalValue?: T;
  workspaceValue?: T;
  workspaceFolderValue?: T;
}

interface ConfigurationReader {
  get<T>(section: string, defaultValue: T): T;
  inspect?<T>(section: string): ConfigurationInspection<T> | undefined;
}

function cleanExecutable(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() !== "" ? value : undefined;
}

export function readTrustedValue<T>(
  config: ConfigurationReader,
  section: string,
  defaultValue: T,
): T {
  const inspected = config.inspect?.<T>(section);
  if (inspected !== undefined) {
    return inspected.globalValue ?? inspected.defaultValue ?? defaultValue;
  }
  return config.get(section, defaultValue);
}

export function readTrustedExecutable(config: ConfigurationReader): string {
  const inspected = config.inspect?.<string>("executable");
  if (inspected !== undefined) {
    return (
      cleanExecutable(inspected.globalValue)
      ?? cleanExecutable(inspected.defaultValue)
      ?? "intentumdiff"
    );
  }
  return (
    cleanExecutable(config.get("executable", "intentumdiff"))
    ?? "intentumdiff"
  );
}

export function readTrustedSchemaFetchMode(
  config: ConfigurationReader,
): LiveServerSettings["schemaFetchMode"] {
  const value = readTrustedValue<LiveServerSettings["schemaFetchMode"]>(
    config,
    "schemas.fetchMode",
    "cache-only",
  );
  return value === "auto" || value === "off" ? value : "cache-only";
}

export function readTrustedSchemaAllowPrivateHosts(config: ConfigurationReader): boolean {
  return readTrustedValue<boolean>(config, "schemas.allowPrivateHosts", false) === true;
}

export type LiveServerEngine = "auto" | "native" | "python";

export function normalizeLiveServerEngine(value: unknown): LiveServerEngine {
  return value === "native" || value === "python" ? value : "auto";
}

/** The bundled native live-server binary inside the installed extension (`<ext>/native/`), or
 *  undefined when the extension shipped without it. The binary discovers its parsers from the
 *  exe-adjacent `native/wasm/` on its own, so bundling needs zero configuration. */
export function bundledLiveServerPath(
  extensionPath: string,
  exists: (p: string) => boolean = existsSync,
): string | undefined {
  const exe = process.platform === "win32"
    ? "intentumdiff-live-server.exe"
    : "intentumdiff-live-server";
  const candidate = path.join(extensionPath, "native", exe);
  return exists(candidate) ? candidate : undefined;
}

export type LiveServerLaunch =
  | { kind: "native"; executable: string }
  | { kind: "python" };

/** Pure launch chooser (#100 Phase C — native-by-default cutover): an EXPLICIT
 *  `intentumdiff.executable` always wins (users may point at their own binary); otherwise the
 *  trusted `intentumdiff.liveServer.engine` setting decides — "python" skips the bundle,
 *  "auto"/"native" use the bundled native server when present. With nothing bundled the python
 *  engine keeps working (a requested-native degrade is the caller's to surface). */
export function chooseLiveServerLaunch(
  rawExecutable: string,
  engine: LiveServerEngine,
  bundledPath: string | undefined,
): LiveServerLaunch {
  if (rawExecutable !== "intentumdiff") {
    return { kind: "python" };
  }
  if (engine === "python") {
    return { kind: "python" };
  }
  if (bundledPath) {
    return { kind: "native", executable: bundledPath };
  }
  return { kind: "python" };
}

/** What `ensure()` decided at spawn time — carried into failure handling so ENOENT advice
 *  matches what was actually launched (a user override vs the bundle vs the python CLI). */
export interface LiveServerLaunchContext {
  kind: "native" | "python";
  /** True when `intentumdiff.executable` is set to something other than the default. */
  userOverride: boolean;
  bundledPath?: string;
}

export interface LiveServerFailureDetails {
  message: string;
  toast: string;
  suggestedExecutable?: string;
  /** Offer a toast action that clears `intentumdiff.executable` so the bundled engine takes over. */
  offerBundledFallback?: boolean;
}

/** Spawn-ENOENT guidance, context-aware (issue 100 Phase C). Three distinct situations get
 *  three distinct fixes: a missing USER override points at the setting (and the bundled
 *  engine when we ship one — never at the .venv, which would be a downgrade); a missing
 *  bundle means a broken install; a missing python CLI means the workspace .venv. */
export function enoentFailureDetails(
  executable: string,
  launch: LiveServerLaunchContext,
  venvCandidate: string | undefined,
): LiveServerFailureDetails {
  const restart = "Then run 'IntentumDiff: Restart LiveServer' or reload the window.";
  if (launch.userOverride) {
    const fix = launch.bundledPath !== undefined
      ? "Remove the 'intentumdiff.executable' setting to use the extension's bundled engine, or point it at an existing executable."
      : "Point the 'intentumdiff.executable' setting at an existing executable, or remove it to use IntentumDiff from the workspace .venv.";
    return {
      message: `The configured IntentumDiff executable does not exist: ${executable}. ${fix} ${restart}`,
      toast: "IntentumDiff: the configured 'intentumdiff.executable' was not found.",
      offerBundledFallback: launch.bundledPath !== undefined,
    };
  }
  if (launch.kind === "native") {
    return {
      message: `The bundled IntentumDiff engine is missing: ${executable}. Reinstall the IntentumDiff extension, or set 'intentumdiff.liveServer.engine' to 'python'. ${restart}`,
      toast: "IntentumDiff: the bundled engine is missing — reinstall the extension.",
    };
  }
  const install = venvCandidate !== undefined
    ? `Install IntentumDiff into the workspace .venv (expected at ${venvCandidate}), or set 'intentumdiff.executable' to an absolute path.`
    : "Install IntentumDiff, then set 'intentumdiff.executable' to an absolute path.";
  return {
    message: `Could not find '${executable}' on VS Code's PATH. ${install} ${restart}`,
    toast: "IntentumDiff was not found — install it or set 'intentumdiff.executable'.",
    suggestedExecutable: venvCandidate,
  };
}

export function debounceSeconds(settings: Pick<LiveServerSettings, "debounceMs">): string {
  return Math.max(settings.debounceMs, 0) / 1000 + "";
}

export function buildLiveServerArgs(
  workspaceRoot: string,
  settings: LiveServerSettings,
): string[] {
  const args = [
    "live-server",
    workspaceRoot,
    "--stdio",
    "--ref",
    settings.ref,
    "--debounce",
    debounceSeconds(settings),
  ];
  if (settings.fuel !== undefined && settings.fuel !== null && settings.fuel !== "") {
    args.push("--fuel", String(settings.fuel));
  }
  return args;
}

export function buildLiveServerEnv(settings: LiveServerSettings): NodeJS.ProcessEnv {
  const ttlSeconds = Math.max(0, Math.round(settings.schemaCacheTtlHours * 60 * 60));
  return {
    INTENTUMDIFF_SCHEMA_FETCH: settings.schemaFetchMode,
    INTENTUMDIFF_SCHEMA_CACHE_TTL_SECONDS: String(ttlSeconds),
    INTENTUMDIFF_SCHEMA_ALLOW_PRIVATE_HOSTS: settings.schemaAllowPrivateHosts ? "1" : "0",
  };
}
