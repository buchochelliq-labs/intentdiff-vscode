export const BASE_SCHEME = "intentumdiff-base";

export interface BaseDocumentIdentity {
  folderUri: string;
  ref: string;
  relativePath: string;
  cacheNonce?: string;
}


export function decodeBaseIdentity(encoded: string): BaseDocumentIdentity {
  const parsed = JSON.parse(decodeURIComponent(encoded)) as BaseDocumentIdentity;
  assertSafeRelativePath(parsed.relativePath);
  return parsed;
}

export function encodeBaseIdentity(identity: BaseDocumentIdentity): string {
  assertSafeRelativePath(identity.relativePath);
  return encodeURIComponent(JSON.stringify(identity));
}

export function baseDocumentCacheKey(identity: BaseDocumentIdentity): string {
  assertSafeRelativePath(identity.relativePath);
  return `${identity.folderUri}::${identity.ref}::${identity.relativePath}::${identity.cacheNonce ?? ""}`;
}

export function gitShowArgs(identity: BaseDocumentIdentity): string[] {
  assertSafeRelativePath(identity.relativePath);
  assertSafeGitRef(identity.ref);
  return ["show", `${identity.ref}:${identity.relativePath}`];
}

export function assertSafeGitRef(ref: string): void {
  if (!ref || ref.includes("\0") || ref.startsWith("-")) {
    throw new Error("Unsafe git ref for IntentumDiff base document");
  }
}

export function assertSafeRelativePath(relativePath: string): void {
  if (!relativePath || relativePath.includes("\0")) {
    throw new Error("Empty or unsafe relative path");
  }
  // A trailing slash means a directory (git status collapses untracked dirs to
  // e.g. `.claude/`). Directories are not reviewable base documents — `git show
  // <ref>:dir/` fails — so reject them here rather than attempt the read.
  if (relativePath.endsWith("/") || relativePath.endsWith("\\")) {
    throw new Error("Directory paths are not valid IntentumDiff base documents");
  }
  if (
    /^[a-zA-Z]:[\\/]/u.test(relativePath)
    || relativePath.startsWith("/")
    || relativePath.startsWith("\\")
  ) {
    throw new Error("Absolute paths are not allowed for IntentumDiff base documents");
  }
  const segments = relativePath.split(/[\\/]+/u);
  if (segments.some((segment) => segment === "..")) {
    throw new Error("Traversal paths are not allowed for IntentumDiff base documents");
  }
}
