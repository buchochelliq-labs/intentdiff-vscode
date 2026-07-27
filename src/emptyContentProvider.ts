import * as path from "path";
import * as vscode from "vscode";
import { assertSafeRelativePath } from "./baseUri";

export const EMPTY_SCHEME = "intentdiff-empty";

export interface EmptyDocumentIdentity {
  folderUri: string;
  relativePath: string;
}

export class EmptyContentProvider implements vscode.TextDocumentContentProvider, vscode.Disposable {
  private readonly changeEmitter = new vscode.EventEmitter<vscode.Uri>();
  readonly onDidChange = this.changeEmitter.event;

  createUri(identity: EmptyDocumentIdentity): vscode.Uri {
    assertSafeRelativePath(identity.relativePath);
    return vscode.Uri.from({
      scheme: EMPTY_SCHEME,
      path: `/${path.basename(identity.relativePath) || "empty"}`,
      query: encodeURIComponent(JSON.stringify(identity)),
    });
  }

  provideTextDocumentContent(uri: vscode.Uri): string {
    const identity = JSON.parse(decodeURIComponent(uri.query)) as EmptyDocumentIdentity;
    assertSafeRelativePath(identity.relativePath);
    return "";
  }

  clear(): void {
    // Empty documents are content-stable; this exists for symmetry with base documents.
  }

  dispose(): void {
    this.changeEmitter.dispose();
  }
}
