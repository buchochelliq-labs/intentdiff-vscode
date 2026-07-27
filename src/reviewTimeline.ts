import * as vscode from "vscode";
import type { ReviewFile } from "./reviewModel";
import { buildReviewTimelineItems, type ReviewTimelineSnapshot } from "./reviewTimelineModel";

interface TimelineItemLike {
  label: string;
  timestamp: number;
  description?: string;
  detail?: string;
  iconPath?: vscode.ThemeIcon;
}

interface TimelineLike {
  items: TimelineItemLike[];
}

interface TimelineRegistrationHost {
  registerTimelineProvider?: (scheme: string, provider: ReviewTimelineProvider) => vscode.Disposable;
}

export class ReviewTimelineProvider {
  private files: ReviewFile[] = [];
  private snapshots: ReviewTimelineSnapshot[] = [];

  setReviewFiles(files: ReviewFile[]): void {
    this.files = files.slice();
  }

  setReviewSnapshots(snapshots: ReviewTimelineSnapshot[]): void {
    this.snapshots = snapshots.slice();
  }

  provideTimeline(): TimelineLike {
    const items = buildReviewTimelineItems(this.files, Date.now, this.snapshots).map((item) => ({
      label: item.label,
      description: item.description,
      detail: item.detail,
      timestamp: item.timestamp,
      iconPath: new vscode.ThemeIcon(item.iconId),
    }));
    return { items };
  }
}

export function registerReviewTimelineProvider(
  workspace: unknown,
  provider: ReviewTimelineProvider,
): vscode.Disposable {
  const host = workspace as TimelineRegistrationHost;
  if (typeof host.registerTimelineProvider === "function") {
    try {
      return host.registerTimelineProvider("intentdiff", provider);
    } catch (error) {
      console.warn("IntentDiff Timeline provider unavailable:", error);
      return new vscode.Disposable(() => undefined);
    }
  }
  return new vscode.Disposable(() => undefined);
}
