import type { CommitDiff, LiveResponse, ReadyMessage, SemanticDiff } from "./types";

export interface LineTransport {
  writeLine(line: string): void;
}

export interface DiffRequestOptions {
  ref?: string;
  stream?: boolean;
  purpose?: DiffRequestPurpose;
}

export type DiffRequestPurpose = "live" | "review";

export interface DiffResultEnvelope {
  path: string;
  seq: number;
  purpose: DiffRequestPurpose;
  response: LiveResponse;
}

export interface ReviewResultEnvelope {
  seq: number;
  commitDiff: CommitDiff;
  response: LiveResponse;
}

export interface ReviewFileEnvelope {
  seq: number;
  fileDiff: SemanticDiff;
  oldFilename: string;
  newFilename: string;
  index: number;
  response: LiveResponse;
}

/** The engine's perceptual manifest for one image, carried through untouched. */
export interface AssetDiffEnvelope {
  seq: number;
  path: string;
  manifest: Record<string, unknown>;
  response: LiveResponse;
}

export type ClientEvent =
  | { kind: "ready"; ready: ReadyMessage }
  | { kind: "diff"; result: DiffResultEnvelope }
  | { kind: "review"; result: ReviewResultEnvelope }
  | { kind: "review_file"; result: ReviewFileEnvelope }
  | { kind: "asset_diff"; result: AssetDiffEnvelope }
  | { kind: "error"; seq: number; error: { code: string; message: string } }
  | { kind: "malformed"; message: string; line: string };

export class JsonLineBuffer {
  private buffer = "";

  push(chunk: string): string[] {
    this.buffer += chunk;
    const lines = this.buffer.split(/\r?\n/u);
    this.buffer = lines.pop() ?? "";
    return lines.filter((line) => line.length > 0);
  }
}

export class LiveServerClient {
  private seq = 0;
  private readonly pathToSeq = new Map<string, number>();
  private readonly seqToPath = new Map<number, string>();
  private readonly seqToDiffKey = new Map<number, string>();
  private readonly seqToDiffPurpose = new Map<number, DiffRequestPurpose>();
  private readonly seqToAssetPath = new Map<number, string>();
  private latestReviewSeq = 0;
  private readonly listeners: Array<(event: ClientEvent) => void> = [];
  ready: ReadyMessage | undefined;

  constructor(private readonly transport: LineTransport) {}

  onEvent(listener: (event: ClientEvent) => void): void {
    this.listeners.push(listener);
  }

  diff(path: string, content: string, options: DiffRequestOptions = {}): number {
    const diffKey = diffRequestKey(path, options.purpose);
    const previousSeq = this.pathToSeq.get(diffKey);
    const nextSeq = ++this.seq;
    if (previousSeq !== undefined) {
      this.send({
        op: "cancel",
        seq: previousSeq,
        path,
      });
    }
    this.pathToSeq.set(diffKey, nextSeq);
    this.seqToPath.set(nextSeq, path);
    this.seqToDiffKey.set(nextSeq, diffKey);
    this.seqToDiffPurpose.set(nextSeq, options.purpose ?? "live");
    this.send({
      op: "diff",
      seq: nextSeq,
      path,
      content,
      ...(options.ref ? { ref: options.ref } : {}),
      ...(options.stream !== undefined ? { stream: options.stream } : {}),
    });
    return nextSeq;
  }

  hello(): void {
    this.send({ op: "hello", seq: ++this.seq });
  }

  review(options: { oldRef?: string; newRef?: string; stream?: boolean } = {}): number {
    const nextSeq = ++this.seq;
    if (this.latestReviewSeq > 0) {
      this.send({ op: "cancel", seq: this.latestReviewSeq });
    }
    this.latestReviewSeq = nextSeq;
    this.send({
      op: "review",
      seq: nextSeq,
      ...(options.oldRef ? { old_ref: options.oldRef } : {}),
      ...(options.newRef !== undefined ? { new_ref: options.newRef } : {}),
      ...(options.stream !== undefined ? { stream: options.stream } : {}),
    });
    return nextSeq;
  }

  /**
   * Ask the engine for one image's perceptual diff against `ref`.
   *
   * Only the path and the ref go over the wire: the *before* bytes live in git's object
   * store, and materialising them is the engine's job. The extension never opens an image.
   */
  assetDiff(path: string, options: { ref?: string } = {}): number {
    const nextSeq = ++this.seq;
    this.seqToAssetPath.set(nextSeq, path);
    this.send({
      op: "asset_diff",
      seq: nextSeq,
      path,
      ...(options.ref ? { ref: options.ref } : {}),
    });
    return nextSeq;
  }

  /** Forget an asset request once its outcome (result or error) has been handled. */
  forgetAssetDiff(seq: number): void {
    this.seqToAssetPath.delete(seq);
  }

  cancel(pathOrSeq: string | number): void {
    if (typeof pathOrSeq === "number") {
      this.send({ op: "cancel", seq: pathOrSeq });
      return;
    }
    const seq = this.pathToSeq.get(diffRequestKey(pathOrSeq, "live"))
      ?? this.pathToSeq.get(diffRequestKey(pathOrSeq, "review"))
      ?? ++this.seq;
    this.send({ op: "cancel", seq, path: pathOrSeq });
  }

  handleLine(line: string): void {
    let parsed: unknown;
    try {
      parsed = JSON.parse(line);
    } catch (error) {
      this.emit({
        kind: "malformed",
        line,
        message: error instanceof Error ? error.message : String(error),
      });
      return;
    }

    if (!isRecord(parsed)) {
      this.emit({ kind: "malformed", line, message: "protocol line is not an object" });
      return;
    }

    if (parsed.op === "ready") {
      if (parsed.ok !== true || parsed.protocol_version !== 2) {
        this.emit({
          kind: "error",
          seq: 0,
          error: {
            code: "unsupported_protocol",
            message: "IntentumDiff live-server did not report protocol version 2",
          },
        });
        return;
      }
      this.ready = parsed as unknown as ReadyMessage;
      this.emit({ kind: "ready", ready: this.ready });
      return;
    }

    const response = parsed as LiveResponse;
    const seq = typeof response.seq === "number" ? response.seq : 0;
    if (response.ok === false || response.error) {
      this.emit({
        kind: "error",
        seq,
        error: response.error ?? {
          code: "protocol_error",
          message: "IntentumDiff returned an unsuccessful response",
        },
      });
      return;
    }

    if (response.op === "diff" && response.diff) {
      const path = this.seqToPath.get(seq);
      const diffKey = this.seqToDiffKey.get(seq);
      const purpose = this.seqToDiffPurpose.get(seq);
      if (!path || !diffKey || !purpose || this.pathToSeq.get(diffKey) !== seq) {
        return;
      }
      this.emit({ kind: "diff", result: { path, seq, purpose, response } });
      return;
    }

    if (response.op === "asset_diff" && response.result) {
      const path = this.seqToAssetPath.get(seq);
      if (path === undefined) {
        return;
      }
      this.seqToAssetPath.delete(seq);
      this.emit({
        kind: "asset_diff",
        result: { seq, path, manifest: response.result, response },
      });
      return;
    }

    if (response.op === "review" && response.commit_diff) {
      if (this.latestReviewSeq !== seq) {
        return;
      }
      this.emit({
        kind: "review",
        result: {
          seq,
          commitDiff: response.commit_diff,
          response,
        },
      });
      return;
    }

    if (response.op === "review_file" && response.file_diff) {
      if (this.latestReviewSeq !== seq) {
        return;
      }
      this.emit({
        kind: "review_file",
        result: {
          seq,
          fileDiff: response.file_diff,
          oldFilename: typeof response.old_filename === "string" ? response.old_filename : "",
          newFilename: typeof response.new_filename === "string" ? response.new_filename : "",
          index: typeof response.index === "number" ? response.index : 0,
          response,
        },
      });
    }
  }

  private send(payload: Record<string, unknown>): void {
    this.transport.writeLine(JSON.stringify(payload));
  }

  private emit(event: ClientEvent): void {
    for (const listener of this.listeners) {
      listener(event);
    }
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function diffRequestKey(path: string, purpose: DiffRequestPurpose = "live"): string {
  return `${purpose}:${path}`;
}
