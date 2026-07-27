export type WorkingTreeStatus = "added" | "modified" | "renamed" | "untracked" | "deleted" | "unknown";

export interface ParsedGitStatusEntry {
  relativePath: string;
  status: WorkingTreeStatus;
}

export function parseGitStatusPorcelain(output: string): ParsedGitStatusEntry[] {
  const entries: ParsedGitStatusEntry[] = [];
  for (const rawLine of output.split(/\r?\n/u)) {
    if (rawLine.length < 4) {
      continue;
    }
    const statusCode = rawLine.slice(0, 2);
    const rawPath = rawLine.slice(3).trim();
    if (!rawPath) {
      continue;
    }
    const relativePath = normalizeStatusPath(rawPath);
    // `git status --porcelain` collapses an untracked directory into a single
    // trailing-slash entry (e.g. `?? .claude/`). A directory is not a reviewable
    // file — `git show <ref>:.claude/` fails — so skip it. Tracked changes are
    // always individual files, never trailing-slash paths.
    if (relativePath.endsWith("/")) {
      continue;
    }
    const status = statusFromCode(statusCode);
    entries.push({ relativePath, status });
  }
  return entries;
}

function normalizeStatusPath(rawPath: string): string {
  const renameArrow = " -> ";
  const pathPart = rawPath.includes(renameArrow)
    ? rawPath.slice(rawPath.lastIndexOf(renameArrow) + renameArrow.length)
    : rawPath;
  return unquoteGitPath(pathPart).split("\\").join("/");
}

function unquoteGitPath(value: string): string {
  if (value.startsWith('"') && value.endsWith('"')) {
    try {
      return JSON.parse(value) as string;
    } catch {
      return value.slice(1, -1);
    }
  }
  return value;
}

function statusFromCode(code: string): WorkingTreeStatus {
  if (code === "??") {
    return "untracked";
  }
  if (code.includes("D")) {
    return "deleted";
  }
  if (code.includes("R")) {
    return "renamed";
  }
  if (code.includes("A")) {
    return "added";
  }
  if (code.includes("M")) {
    return "modified";
  }
  return "unknown";
}
