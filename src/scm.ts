import { execFile } from "child_process";
import * as path from "path";
import * as vscode from "vscode";
import {
  parseGitStatusPorcelain,
  type ParsedGitStatusEntry,
  type WorkingTreeStatus,
} from "./gitStatus";

export { parseGitStatusPorcelain, type ParsedGitStatusEntry, type WorkingTreeStatus };

export interface WorkingTreeFile {
  folder: vscode.WorkspaceFolder;
  uri: vscode.Uri;
  relativePath: string;
  status: WorkingTreeStatus;
}

export async function discoverWorkingTreeFiles(): Promise<WorkingTreeFile[]> {
  const folders = vscode.workspace.workspaceFolders ?? [];
  const byKey = new Map<string, WorkingTreeFile>();
  for (const folder of folders) {
    try {
      for (const file of await discoverWorkingTreeFilesForFolder(folder)) {
        byKey.set(file.uri.toString(), file);
      }
    } catch {
      for (const file of await discoverFromGitApi(folder)) {
        byKey.set(file.uri.toString(), file);
      }
    }
  }
  return [...byKey.values()].sort((a, b) => a.relativePath.localeCompare(b.relativePath));
}

export async function discoverWorkingTreeFilesForFolder(
  folder: vscode.WorkspaceFolder,
): Promise<WorkingTreeFile[]> {
  try {
    return await discoverFromGitStatus(folder);
  } catch (gitStatusError) {
    const apiFiles = await discoverFromGitApi(folder);
    if (apiFiles.length > 0) {
      return apiFiles;
    }
    throw gitStatusError;
  }
}

export async function resolveGitRef(
  folder: vscode.WorkspaceFolder,
  ref: string,
): Promise<string | undefined> {
  try {
    const output = await execGit(folder.uri.fsPath, ["rev-parse", "--verify", `${ref}^{commit}`]);
    return output.trim() || undefined;
  } catch {
    return undefined;
  }
}

async function discoverFromGitApi(folder: vscode.WorkspaceFolder): Promise<WorkingTreeFile[]> {
  const gitExtension = vscode.extensions.getExtension("vscode.git");
  if (!gitExtension) {
    return [];
  }
  try {
    const extension = gitExtension.isActive ? gitExtension : await gitExtension.activate();
    const api = extension.getAPI?.(1);
    const repository = api?.repositories?.find(
      (item: { rootUri?: vscode.Uri }) => item.rootUri?.toString() === folder.uri.toString(),
    );
    if (!repository?.state) {
      return [];
    }
    const resources = [
      ...(repository.state.indexChanges ?? []),
      ...(repository.state.workingTreeChanges ?? []),
      ...(repository.state.mergeChanges ?? []),
    ];
    const files: WorkingTreeFile[] = [];
    for (const item of resources as Array<{
      resourceUri?: vscode.Uri;
      originalResourceUri?: vscode.Uri;
      type?: string | number;
      status?: string | number;
      state?: string | number;
    }>) {
      const uri = item.resourceUri;
      if (!uri || uri.scheme !== "file") {
        continue;
      }
      const relativePath = relativePathFor(folder, uri);
      if (!relativePath) {
        continue;
      }
      files.push({
        folder,
        uri,
        relativePath,
        status: statusFromGitResource(item),
      });
    }
    return files;
  } catch {
    return [];
  }
}

async function discoverFromGitStatus(folder: vscode.WorkspaceFolder): Promise<WorkingTreeFile[]> {
  try {
    const output = await execGit(folder.uri.fsPath, ["status", "--porcelain=v1"]);
    return parseGitStatusPorcelain(output).map((entry) => ({
      folder,
      uri: vscode.Uri.file(path.join(folder.uri.fsPath, entry.relativePath)),
      relativePath: entry.relativePath,
      status: entry.status,
    }));
  } catch {
    return [];
  }
}

function execGit(cwd: string, args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(
      "git",
      ["-c", `safe.directory=${cwd}`, ...args],
      { cwd, windowsHide: true },
      (error, stdout) => {
        if (error) {
          reject(error);
          return;
        }
        resolve(stdout);
      },
    );
  });
}

function relativePathFor(folder: vscode.WorkspaceFolder, uri: vscode.Uri): string | undefined {
  const relative = path.relative(folder.uri.fsPath, uri.fsPath);
  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    return undefined;
  }
  return relative.split(path.sep).join("/");
}

function statusFromGitResource(item: {
  originalResourceUri?: vscode.Uri;
  type?: string | number;
  status?: string | number;
  state?: string | number;
}): WorkingTreeStatus {
  if (item.originalResourceUri) {
    return "renamed";
  }
  const statusText = String(item.type ?? item.status ?? item.state ?? "").toLowerCase();
  if (statusText.includes("untracked")) {
    return "untracked";
  }
  if (statusText.includes("delete")) {
    return "deleted";
  }
  if (statusText.includes("rename")) {
    return "renamed";
  }
  if (statusText.includes("add")) {
    return "added";
  }
  if (statusText.includes("mod")) {
    return "modified";
  }
  return "modified";
}
