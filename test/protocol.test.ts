import assert from "node:assert/strict";
import test from "node:test";
import { JsonLineBuffer, LiveServerClient, type ClientEvent } from "../src/protocol";

class FakeTransport {
  readonly lines: string[] = [];

  writeLine(line: string): void {
    this.lines.push(line);
  }
}

test("JsonLineBuffer emits complete non-empty lines", () => {
  const buffer = new JsonLineBuffer();

  assert.deepEqual(buffer.push('{"a":'), []);
  assert.deepEqual(buffer.push("1}\n\n{\"b\":2}\r\npartial"), ['{"a":1}', '{"b":2}']);
  assert.deepEqual(buffer.push("\n"), ["partial"]);
});

test("ready protocol v2 is accepted and emitted", () => {
  const transport = new FakeTransport();
  const client = new LiveServerClient(transport);
  const events: ClientEvent[] = [];
  client.onEvent((event) => events.push(event));

  client.handleLine(JSON.stringify({
    op: "ready",
    ok: true,
    protocol_version: 2,
    repo_path: "/repo",
    ref: "HEAD",
    transport: "stdio",
  }));

  assert.equal(events[0].kind, "ready");
  assert.equal(client.ready?.protocol_version, 2);
});

test("unsupported ready protocol emits structured error", () => {
  const transport = new FakeTransport();
  const client = new LiveServerClient(transport);
  const events: ClientEvent[] = [];
  client.onEvent((event) => events.push(event));

  client.handleLine(JSON.stringify({
    op: "ready",
    ok: true,
    protocol_version: 1,
    repo_path: "/repo",
    ref: "HEAD",
    transport: "stdio",
  }));

  assert.equal(events[0].kind, "error");
  assert.deepEqual(events[0], {
    kind: "error",
    seq: 0,
    error: {
      code: "unsupported_protocol",
      message: "IntentumDiff live-server did not report protocol version 2",
    },
  });
});

test("hello sends protocol request with a sequence number", () => {
  const transport = new FakeTransport();
  const client = new LiveServerClient(transport);

  client.hello();

  assert.deepEqual(JSON.parse(transport.lines[0]), { op: "hello", seq: 1 });
});

test("newer diff cancels older request for same path and suppresses stale response", () => {
  const transport = new FakeTransport();
  const client = new LiveServerClient(transport);
  const events: ClientEvent[] = [];
  client.onEvent((event) => events.push(event));

  const firstSeq = client.diff("src/app.py", "one");
  const secondSeq = client.diff("src/app.py", "two");

  assert.deepEqual(JSON.parse(transport.lines[0]), {
    op: "diff",
    seq: firstSeq,
    path: "src/app.py",
    content: "one",
  });
  assert.deepEqual(JSON.parse(transport.lines[1]), {
    op: "cancel",
    seq: firstSeq,
    path: "src/app.py",
  });
  assert.deepEqual(JSON.parse(transport.lines[2]), {
    op: "diff",
    seq: secondSeq,
    path: "src/app.py",
    content: "two",
  });

  client.handleLine(JSON.stringify({
    op: "diff",
    seq: firstSeq,
    ok: true,
    diff: { language: "python", changes: [{ change_type: "MODIFICATION" }] },
  }));
  client.handleLine(JSON.stringify({
    op: "diff",
    seq: secondSeq,
    ok: true,
    diff: { language: "python", changes: [] },
  }));

  assert.equal(events.length, 1);
  assert.equal(events[0].kind, "diff");
  if (events[0].kind === "diff") {
    assert.equal(events[0].result.path, "src/app.py");
    assert.equal(events[0].result.seq, secondSeq);
    assert.equal(events[0].result.purpose, "live");
  }
});

test("live and review diff requests for same path use separate freshness lanes", () => {
  const transport = new FakeTransport();
  const client = new LiveServerClient(transport);
  const events: ClientEvent[] = [];
  client.onEvent((event) => events.push(event));

  const liveSeq = client.diff("src/app.py", "live", { purpose: "live" });
  const reviewSeq = client.diff("src/app.py", "review", { purpose: "review" });

  assert.deepEqual(JSON.parse(transport.lines[0]), {
    op: "diff",
    seq: liveSeq,
    path: "src/app.py",
    content: "live",
  });
  assert.deepEqual(JSON.parse(transport.lines[1]), {
    op: "diff",
    seq: reviewSeq,
    path: "src/app.py",
    content: "review",
  });

  client.handleLine(JSON.stringify({
    op: "diff",
    seq: liveSeq,
    ok: true,
    diff: { language: "python", changes: [{ change_type: "MODIFICATION" }] },
  }));
  client.handleLine(JSON.stringify({
    op: "diff",
    seq: reviewSeq,
    ok: true,
    diff: { language: "python", changes: [] },
  }));

  assert.equal(events.length, 2);
  assert.equal(events[0].kind, "diff");
  assert.equal(events[1].kind, "diff");
  if (events[0].kind === "diff" && events[1].kind === "diff") {
    assert.equal(events[0].result.seq, liveSeq);
    assert.equal(events[0].result.purpose, "live");
    assert.equal(events[1].result.seq, reviewSeq);
    assert.equal(events[1].result.purpose, "review");
  }
});

test("review sends commit-level request and suppresses stale review responses", () => {
  const transport = new FakeTransport();
  const client = new LiveServerClient(transport);
  const events: ClientEvent[] = [];
  client.onEvent((event) => events.push(event));

  const firstSeq = client.review({ oldRef: "origin/main" });
  const secondSeq = client.review({ oldRef: "HEAD", newRef: "feature" });

  assert.deepEqual(JSON.parse(transport.lines[0]), {
    op: "review",
    seq: firstSeq,
    old_ref: "origin/main",
  });
  assert.deepEqual(JSON.parse(transport.lines[1]), {
    op: "cancel",
    seq: firstSeq,
  });
  assert.deepEqual(JSON.parse(transport.lines[2]), {
    op: "review",
    seq: secondSeq,
    old_ref: "HEAD",
    new_ref: "feature",
  });

  client.handleLine(JSON.stringify({
    op: "review",
    seq: firstSeq,
    ok: true,
    commit_diff: { old_ref: "origin/main", new_ref: "", cross_file_changes: [] },
  }));
  client.handleLine(JSON.stringify({
    op: "review",
    seq: secondSeq,
    ok: true,
    commit_diff: {
      old_ref: "HEAD",
      new_ref: "feature",
      cross_file_changes: [{ change_type: "MOVE_TO_MODULE", symbol_name: "greet", old_file: "a.py", new_file: "b.py" }],
    },
  }));

  assert.equal(events.length, 1);
  assert.equal(events[0].kind, "review");
  if (events[0].kind === "review") {
    assert.equal(events[0].result.commitDiff.cross_file_changes?.[0].symbol_name, "greet");
  }
});

test("server error responses are emitted without throwing", () => {
  const transport = new FakeTransport();
  const client = new LiveServerClient(transport);
  const events: ClientEvent[] = [];
  client.onEvent((event) => events.push(event));

  client.handleLine(JSON.stringify({
    op: "diff",
    seq: 3,
    ok: false,
    error: { code: "invalid_path", message: "bad path" },
  }));

  assert.deepEqual(events[0], {
    kind: "error",
    seq: 3,
    error: { code: "invalid_path", message: "bad path" },
  });
});
