import { execFile } from "child_process";
import * as fs from "fs";
import * as path from "path";
import * as vscode from "vscode";
import {
  BASE_SCHEME,
  assertSafeGitRef,
  baseDocumentCacheKey,
  decodeBaseIdentity,
  encodeBaseIdentity,
  gitShowArgs,
  type BaseDocumentIdentity,
} from "./baseUri";

export class BaseContentProvider implements vscode.TextDocumentContentProvider, vscode.Disposable {
  private readonly cache = new Map<string, string>();
  private readonly knownUris = new Map<string, vscode.Uri>();
  private readonly changeEmitter = new vscode.EventEmitter<vscode.Uri>();
  readonly onDidChange = this.changeEmitter.event;

  constructor(private readonly output: vscode.OutputChannel) {}

  createUri(identity: BaseDocumentIdentity): vscode.Uri {
    return vscode.Uri.from({
      scheme: BASE_SCHEME,
      path: `/${path.basename(identity.relativePath) || "base"}`,
      query: encodeBaseIdentity(identity),
    });
  }

  clear(): void {
    this.cache.clear();
    for (const uri of this.knownUris.values()) {
      this.changeEmitter.fire(uri);
    }
    this.knownUris.clear();
  }

  async provideTextDocumentContent(uri: vscode.Uri): Promise<string> {
    const identity = decodeBaseIdentity(uri.query);
    assertSafeGitRef(identity.ref);
    const key = baseDocumentCacheKey(identity);
    this.knownUris.set(key, uri);
    const cached = this.cache.get(key);
    if (cached !== undefined) {
      return cached;
    }
    const content = await this.readFromGitShowOrExtension(identity);
    this.cache.set(key, content);
    return content;
  }

  dispose(): void {
    this.changeEmitter.dispose();
    this.cache.clear();
    this.knownUris.clear();
  }

  private async readFromGitExtension(identity: BaseDocumentIdentity): Promise<string | undefined> {
    const folderUri = vscode.Uri.parse(identity.folderUri);
    const gitExtension = vscode.extensions.getExtension("vscode.git");
    if (!gitExtension) {
      return undefined;
    }
    try {
      const extension = gitExtension.isActive ? gitExtension : await gitExtension.activate();
      const api = extension.getAPI?.(1);
      const repository = api?.repositories?.find(
        (item: { rootUri?: vscode.Uri }) => item.rootUri?.toString() === folderUri.toString(),
      );
      if (typeof repository?.show !== "function") {
        return undefined;
      }
      return await repository.show(identity.ref, identity.relativePath) as string;
    } catch (error) {
      this.output.appendLine(`IntentumDiff base git-extension read failed: ${messageOf(error)}`);
      return undefined;
    }
  }

  private async readFromGitShowOrExtension(identity: BaseDocumentIdentity): Promise<string> {
    try {
      return await this.readFromGitShow(identity);
    } catch (gitShowError) {
      const extensionContent = await this.readFromGitExtension(identity);
      if (extensionContent !== undefined) {
        return extensionContent;
      }
      throw gitShowError;
    }
  }

  private async readFromGitShow(identity: BaseDocumentIdentity): Promise<string> {
    const folderPath = vscode.Uri.parse(identity.folderUri).fsPath;
    const args = ["-c", `safe.directory=${folderPath}`, ...gitShowArgs(identity)];
    return new Promise((resolve, reject) => {
      execFile(
        "git",
        args,
        {
          cwd: folderPath,
          windowsHide: true,
          maxBuffer: 16 * 1024 * 1024,
        },
        (error, stdout) => {
          if (error) {
            if (isMissingPathAtRef(messageOf(error)) && workingTreeFileExists(identity)) {
              resolve("");
              return;
            }
            reject(new Error(
              `Unable to read ${identity.relativePath} at ${identity.ref}: ${messageOf(error)}`,
            ));
            return;
          }
          resolve(stdout);
        },
      );
    });
  }
}

function isMissingPathAtRef(message: string): boolean {
  return message.includes("exists on disk, but not in")
    || message.includes("does not exist in");
}

function workingTreeFileExists(identity: BaseDocumentIdentity): boolean {
  const folderPath = vscode.Uri.parse(identity.folderUri).fsPath;
  try {
    return fs.statSync(path.join(folderPath, identity.relativePath)).isFile();
  } catch {
    return false;
  }
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
