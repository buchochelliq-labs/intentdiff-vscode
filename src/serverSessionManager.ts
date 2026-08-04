// LiveServer session lifecycle, extracted from PysdController (issue #79
// stage 2). Owns the per-folder session map: spawning the LiveServer process
// transport, wiring protocol events back to the host, and disposal. Failure
// UX (review-tree marking, toasts) stays in the controller via onFailure.
import * as vscode from "vscode";
import {
  buildLiveServerArgs,
  buildLiveServerEnv,
  bundledLiveServerPath,
  chooseLiveServerLaunch,
  enoentFailureDetails,
  type LiveServerFailureDetails,
  type LiveServerLaunchContext,
} from "./config";
import {
  readLiveServerEngine,
  readLiveServerRawExecutable,
  settingsForFolder,
  workspaceVenvIntentumDiffCandidates,
} from "./extensionSettings";
import { ProcessLineTransport } from "./processTransport";
import {
  LiveServerClient,
  type DiffResultEnvelope,
  type ReviewFileEnvelope,
  type ReviewResultEnvelope,
} from "./protocol";
import type { LiveServerSettings } from "./types";

export interface ServerSession {
  folder: vscode.WorkspaceFolder;
  client: LiveServerClient;
  transport: ProcessLineTransport;
}

export type { LiveServerFailureDetails } from "./config";

export interface ServerSessionHost {
  readonly output: vscode.OutputChannel;
  readonly extensionPath: string;
  trace(message: string): void;
  setStatusText(text: string): void;
  onDiff(folder: vscode.WorkspaceFolder, result: DiffResultEnvelope): void;
  onReviewResult(folder: vscode.WorkspaceFolder, result: ReviewResultEnvelope): void;
  onReviewFile(folder: vscode.WorkspaceFolder, result: ReviewFileEnvelope): void;
  /** Return true when the error belonged to a full-review request. */
  onReviewError(folder: vscode.WorkspaceFolder, seq: number, message: string, code?: string): boolean;
  /** Return true when the error belonged to an incremental request. */
  onIncrementalReviewError(folder: vscode.WorkspaceFolder, seq: number, message: string, code?: string): boolean;
  onProtocolError(error: { code: string; message: string }): void;
  onFailure(folder: vscode.WorkspaceFolder, details: LiveServerFailureDetails): Promise<void>;
}

export class ServerSessionManager {
  private readonly sessions = new Map<string, ServerSession>();

  constructor(private readonly host: ServerSessionHost) {}

  get(folderUri: string): ServerSession | undefined {
    return this.sessions.get(folderUri);
  }

  ensure(folder: vscode.WorkspaceFolder): ServerSession {
    const key = folder.uri.toString();
    const existing = this.sessions.get(key);
    if (existing) {
      return existing;
    }

    const settings = settingsForFolder(folder);
    // #100 Phase C: prefer the BUNDLED native live-server unless the user overrode the
    // executable or forced engine=python. The native binary is a CLI drop-in and finds its
    // parsers next to itself, so only the executable changes.
    const rawExecutable = readLiveServerRawExecutable();
    const engine = readLiveServerEngine();
    const bundled = bundledLiveServerPath(this.host.extensionPath);
    const launch = chooseLiveServerLaunch(rawExecutable, engine, bundled);
    const launchContext: LiveServerLaunchContext = {
      kind: launch.kind,
      userOverride: rawExecutable !== "intentumdiff",
      bundledPath: bundled,
    };
    if (launch.kind === "native") {
      settings.executable = launch.executable;
    } else if (engine === "native") {
      this.host.output.appendLine(
        "intentumdiff.liveServer.engine is 'native' but no bundled native server was found; using the python engine.",
      );
    }
    const args = buildLiveServerArgs(folder.uri.fsPath, settings);
    this.host.trace(`spawn [engine=${launch.kind}] ${settings.executable} ${args.join(" ")}`);
    let transport: ProcessLineTransport;
    const client = new LiveServerClient({
      writeLine: (line) => {
        this.host.trace(`> ${line}`);
        transport.writeLine(line);
      },
    });
    transport = new ProcessLineTransport(
      settings.executable,
      args,
      this.host.extensionPath,
      {
        onLine: (line) => {
          this.host.trace(`< ${line}`);
          client.handleLine(line);
        },
        onStderr: (line) => this.host.trace(`stderr: ${line}`),
        onExit: (code, signal) => {
          this.host.setStatusText("IntentumDiff: stopped");
          this.host.output.appendLine(`LiveServer exited: code=${code ?? "null"} signal=${signal ?? "null"}`);
          this.sessions.delete(key);
        },
        onError: (error) => {
          this.host.setStatusText("IntentumDiff: error");
          this.sessions.delete(key);
          const details = liveServerErrorDetails(error, settings, folder, launchContext);
          this.host.output.appendLine(`LiveServer error: ${details.message}`);
          void this.host.onFailure(folder, details);
        },
      },
      buildLiveServerEnv(settings),
    );
    client.onEvent((event) => {
      if (event.kind === "ready") {
        this.host.setStatusText("IntentumDiff: ready");
        if (event.ready.capabilities?.review !== true) {
          this.host.output.appendLine(JSON.stringify({
            liveServerWarning: {
              message: "LiveServer did not advertise review capability; Semantic Changes may not populate.",
              capabilities: event.ready.capabilities ?? {},
            },
          }, null, 2));
        }
        return;
      }
      if (event.kind === "diff") {
        this.host.onDiff(folder, event.result);
        return;
      }
      if (event.kind === "review") {
        this.host.onReviewResult(folder, event.result);
        return;
      }
      if (event.kind === "review_file") {
        this.host.onReviewFile(folder, event.result);
        return;
      }
      if (event.kind === "error") {
        if (
          !this.host.onReviewError(folder, event.seq, event.error.message, event.error.code)
          && !this.host.onIncrementalReviewError(folder, event.seq, event.error.message, event.error.code)
        ) {
          this.host.onProtocolError(event.error);
        }
        return;
      }
      this.host.output.appendLine(`Malformed IntentumDiff protocol line: ${event.message}`);
    });

    const session = { folder, client, transport };
    this.sessions.set(key, session);
    return session;
  }

  disposeAll(): void {
    for (const session of this.sessions.values()) {
      session.transport.dispose();
    }
    this.sessions.clear();
  }
}

export function liveServerErrorDetails(
  error: Error & { code?: string },
  settings: LiveServerSettings,
  folder: vscode.WorkspaceFolder,
  launch: LiveServerLaunchContext,
): LiveServerFailureDetails {
  if (error.code === "ENOENT") {
    return enoentFailureDetails(
      settings.executable,
      launch,
      workspaceVenvIntentumDiffCandidates(folder)[0],
    );
  }
  return {
    message: error.message,
    toast: "IntentumDiff LiveServer failed.",
  };
}
