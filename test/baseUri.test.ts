import assert from "node:assert/strict";
import test from "node:test";
import {
  baseDocumentCacheKey,
  decodeBaseIdentity,
  encodeBaseIdentity,
  gitShowArgs,
  type BaseDocumentIdentity,
} from "../src/baseUri";

const identity: BaseDocumentIdentity = {
  folderUri: "file:///repo",
  ref: "HEAD",
  relativePath: "src/config.yaml",
};

test("base document identity round trips through a URI-safe query", () => {
  const encoded = encodeBaseIdentity(identity);

  assert.deepEqual(decodeBaseIdentity(encoded), identity);
});

test("base document cache keys include workspace ref and path", () => {
  assert.equal(
    baseDocumentCacheKey(identity),
    "file:///repo::HEAD::src/config.yaml::",
  );
  assert.equal(
    baseDocumentCacheKey({ ...identity, cacheNonce: "abc123" }),
    "file:///repo::HEAD::src/config.yaml::abc123",
  );
});

test("git show args use ref:path and reject unsafe refs and paths", () => {
  assert.deepEqual(gitShowArgs(identity), ["show", "HEAD:src/config.yaml"]);

  assert.throws(
    () => gitShowArgs({ ...identity, ref: "--help" }),
    /Unsafe git ref/u,
  );
  assert.throws(
    () => gitShowArgs({ ...identity, relativePath: "../secret.yaml" }),
    /Traversal/u,
  );
  assert.throws(
    () => gitShowArgs({ ...identity, relativePath: "C:/repo/secret.yaml" }),
    /Absolute/u,
  );
  // Untracked directories (git status collapses them to `.claude/`) are not
  // reviewable base documents and must be rejected before any `git show`.
  assert.throws(
    () => gitShowArgs({ ...identity, relativePath: ".claude/" }),
    /Directory paths/u,
  );
  assert.throws(
    () => gitShowArgs({ ...identity, relativePath: "dist\\" }),
    /Directory paths/u,
  );
});
