import * as path from "path";
import * as vscode from "vscode";
import { assertSafeRelativePath } from "./baseUri";
import {
  buildSemanticOnlyDocuments,
  SEMANTIC_BASE_SCHEME,
  SEMANTIC_MODIFIED_SCHEME,
  type SemanticOnlyDocumentPair,
  type SemanticOnlyOptions,
  type SemanticOnlyProjection,
} from "./semanticOnlyDiff";
import type { SemanticDiff } from "./types";

export { SEMANTIC_BASE_SCHEME, SEMANTIC_MODIFIED_SCHEME };

export interface SemanticOnlyDocumentIdentity {
  id: string;
  side: "base" | "modified";
  folderUri: string;
  relativePath: string;
}

export interface SemanticOnlyDocumentRequest {
  folderUri: string;
  relativePath: string;
  oldText: string;
  newText: string;
  diff: SemanticDiff;
  options: SemanticOnlyOptions;
}

export interface SemanticOnlyDocumentUris {
  id: string;
  baseUri: vscode.Uri;
  modifiedUri: vscode.Uri;
  projection: SemanticOnlyProjection;
}

interface SemanticOnlySession {
  identity: Omit<SemanticOnlyDocumentIdentity, "side">;
  pair: SemanticOnlyDocumentPair;
  baseUri: vscode.Uri;
  modifiedUri: vscode.Uri;
}

export class SemanticOnlyContentProvider implements vscode.TextDocumentContentProvider, vscode.Disposable {
  private readonly sessions = new Map<string, SemanticOnlySession>();
  private readonly changeEmitter = new vscode.EventEmitter<vscode.Uri>();
  private nextId = 1;
  readonly onDidChange = this.changeEmitter.event;

  createDocuments(request: SemanticOnlyDocumentRequest): SemanticOnlyDocumentUris {
    assertSafeRelativePath(request.relativePath);
    const id = String(this.nextId);
    this.nextId += 1;
    const pair = buildSemanticOnlyDocuments(
      request.oldText,
      request.newText,
      request.diff,
      request.options,
    );
    const identity = {
      id,
      folderUri: request.folderUri,
      relativePath: request.relativePath,
    };
    const baseUri = this.createUri({ ...identity, side: "base" });
    const modifiedUri = this.createUri({ ...identity, side: "modified" });
    this.sessions.set(id, {
      identity,
      pair,
      baseUri,
      modifiedUri,
    });
    return {
      id,
      baseUri,
      modifiedUri,
      projection: pair.projection,
    };
  }

  updateDocuments(id: string, request: SemanticOnlyDocumentRequest): SemanticOnlyProjection | undefined {
    assertSafeRelativePath(request.relativePath);
    const session = this.sessions.get(id);
    if (!session) {
      return undefined;
    }
    session.pair = buildSemanticOnlyDocuments(
      request.oldText,
      request.newText,
      request.diff,
      request.options,
    );
    this.changeEmitter.fire(session.baseUri);
    this.changeEmitter.fire(session.modifiedUri);
    return session.pair.projection;
  }

  projectionForUri(uri: vscode.Uri): SemanticOnlyProjection | undefined {
    const identity = decodeSemanticOnlyIdentity(uri);
    return this.sessions.get(identity.id)?.pair.projection;
  }

  sessionIdForUri(uri: vscode.Uri): string | undefined {
    if (uri.scheme !== SEMANTIC_BASE_SCHEME && uri.scheme !== SEMANTIC_MODIFIED_SCHEME) {
      return undefined;
    }
    return decodeSemanticOnlyIdentity(uri).id;
  }

  provideTextDocumentContent(uri: vscode.Uri): string {
    const identity = decodeSemanticOnlyIdentity(uri);
    assertSafeRelativePath(identity.relativePath);
    const session = this.sessions.get(identity.id);
    if (!session) {
      return "IntentDiff: semantic-only diff session expired.";
    }
    return identity.side === "base" ? session.pair.baseText : session.pair.modifiedText;
  }

  clear(): void {
    for (const session of this.sessions.values()) {
      this.changeEmitter.fire(session.baseUri);
      this.changeEmitter.fire(session.modifiedUri);
    }
    this.sessions.clear();
  }

  dispose(): void {
    this.changeEmitter.dispose();
    this.sessions.clear();
  }

  private createUri(identity: SemanticOnlyDocumentIdentity): vscode.Uri {
    return vscode.Uri.from({
      scheme: identity.side === "base" ? SEMANTIC_BASE_SCHEME : SEMANTIC_MODIFIED_SCHEME,
      path: `/${path.basename(identity.relativePath) || "semantic"}`,
      query: encodeURIComponent(JSON.stringify(identity)),
    });
  }
}

export function decodeSemanticOnlyIdentity(uri: vscode.Uri): SemanticOnlyDocumentIdentity {
  const parsed = JSON.parse(decodeURIComponent(uri.query)) as SemanticOnlyDocumentIdentity;
  assertSafeRelativePath(parsed.relativePath);
  return parsed;
}
