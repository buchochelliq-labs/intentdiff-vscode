import type { ReviewArtifact } from "./reviewArtifact";

export function artifactPathFromArgs(args: string[]): string | undefined {
  return args.find((arg) => arg.startsWith("--artifact="))?.slice("--artifact=".length);
}

export function defaultReviewArtifact(): ReviewArtifact {
  return { summary: {}, files: [] };
}

export function loadReviewArtifactFromArgs(
  args: string[],
  readText: (path: string) => string,
): ReviewArtifact {
  const artifactPath = artifactPathFromArgs(args);
  return artifactPath
    ? JSON.parse(readText(artifactPath)) as ReviewArtifact
    : defaultReviewArtifact();
}
