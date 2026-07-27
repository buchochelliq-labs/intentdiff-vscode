// Review refresh triggering — git status watcher with interval-poll fallback —
// extracted from PysdController (issue #79 stage 2). Prefers the vscode.git
// extension's repository state events; polls only until a watcher registers.
import * as vscode from "vscode";

interface GitRepositoryLike {
  state?: {
    onDidChange?: (listener: () => void) => vscode.Disposable;
  };
}

interface GitApiLike {
  repositories?: GitRepositoryLike[];
  onDidOpenRepository?: (listener: (repository: GitRepositoryLike) => void) => vscode.Disposable;
}

export interface ReviewPollingHost {
  readonly output: vscode.OutputChannel;
  subscribe(disposable: vscode.Disposable): void;
  onRefreshNeeded(reason: string): void;
}

export class ReviewPollingService {
  private pollTimer: NodeJS.Timeout | undefined;
  private gitWatcherRegistered = false;

  constructor(private readonly host: ReviewPollingHost) {}

  get watcherRegistered(): boolean {
    return this.gitWatcherRegistered;
  }

  startPolling(): void {
    if (this.gitWatcherRegistered) {
      return;
    }
    if (this.pollTimer) {
      return;
    }
    this.pollTimer = setInterval(
      () => this.host.onRefreshNeeded("status poll"),
      this.pollIntervalMs(),
    );
  }

  stopPolling(): void {
    if (this.pollTimer) {
      clearInterval(this.pollTimer);
      this.pollTimer = undefined;
    }
  }

  async registerGitStatusWatcher(): Promise<void> {
    const gitExtension = vscode.extensions.getExtension("vscode.git");
    if (!gitExtension) {
      return;
    }
    try {
      const extension = gitExtension.isActive ? gitExtension : await gitExtension.activate();
      const api = extension.getAPI?.(1) as GitApiLike | undefined;
      if (!api) {
        return;
      }
      const watchRepository = (repository: GitRepositoryLike): void => {
        const disposable = repository.state?.onDidChange?.(() => this.host.onRefreshNeeded("git status"));
        if (disposable) {
          this.host.subscribe(disposable);
          if (!this.gitWatcherRegistered) {
            this.gitWatcherRegistered = true;
            this.stopPolling();
            this.host.onRefreshNeeded("git status watcher ready");
          }
        }
      };
      for (const repository of api.repositories ?? []) {
        watchRepository(repository);
      }
      const disposable = api.onDidOpenRepository?.((repository) => watchRepository(repository));
      if (disposable) {
        this.host.subscribe(disposable);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.host.output.appendLine(`IntentDiff git status watcher unavailable: ${message}`);
    }
  }

  private pollIntervalMs(): number {
    const value = vscode.workspace.getConfiguration("intentdiff").get("review.pollIntervalMs", 5000);
    return Math.max(500, Number.isFinite(value) ? value : 5000);
  }
}
