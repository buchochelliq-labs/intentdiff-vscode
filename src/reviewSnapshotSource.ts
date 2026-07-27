// Working-tree snapshot construction for the review refresh pipeline,
// extracted from PysdController (issue #79 stage 2). Pure of controller state:
// reads git + the filesystem and returns the stamped snapshot.
import * as path from "path";
import * as vscode from "vscode";
import { readLiveServerSettings } from "./extensionSettings";
import { createReviewRefreshSnapshot, type ReviewRefreshFile, type ReviewRefreshSnapshot } from "./reviewRefresh";
import { discoverWorkingTreeFilesForFolder, resolveGitRef, type WorkingTreeFile } from "./scm";

export async function stampWorkingTreeFile(file: WorkingTreeFile): Promise<ReviewRefreshFile> {
  if (file.status === "deleted") {
    return {
      relativePath: file.relativePath,
      status: file.status,
      stamp: "deleted",
    };
  }
  try {
    const stat = await vscode.workspace.fs.stat(file.uri);
    return {
      relativePath: file.relativePath,
      status: file.status,
      stamp: `${stat.type}:${stat.size}:${stat.mtime}`,
    };
  } catch {
    return {
      relativePath: file.relativePath,
      status: file.status,
      stamp: "missing",
    };
  }
}

export async function createReviewSnapshot(folder: vscode.WorkspaceFolder): Promise<ReviewRefreshSnapshot> {
  const ref = readLiveServerSettings().ref;
  const [resolvedCommit, files] = await Promise.all([
    resolveGitRef(folder, ref),
    discoverWorkingTreeFilesForFolder(folder),
  ]);
  const stampedFiles = await Promise.all(files.map((file) => stampWorkingTreeFile(file)));
  return createReviewRefreshSnapshot(ref, resolvedCommit, stampedFiles);
}

export async function readWorkingTreeFile(
  folder: vscode.WorkspaceFolder,
  relativePath: string,
): Promise<string> {
  const uri = vscode.Uri.file(path.join(folder.uri.fsPath, relativePath));
  const bytes = await vscode.workspace.fs.readFile(uri);
  return Buffer.from(bytes).toString("utf8");
}
