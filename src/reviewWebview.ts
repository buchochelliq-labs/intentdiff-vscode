import * as vscode from "vscode";
import {
  buildEmptyReviewDashboardModel,
  isReviewWebviewMessage,
  renderDashboardHtml,
  renderPanelHtml,
  type ReviewDashboardModel,
  type ReviewPanelModel,
  type ReviewWebviewMessage,
} from "./reviewWebviewModel";

type MessageHandler = (message: ReviewWebviewMessage) => void | Promise<void>;

export class ReviewDashboardWebviewProvider implements vscode.WebviewViewProvider, vscode.Disposable {
  private view: vscode.WebviewView | undefined;
  private readonly disposables: vscode.Disposable[] = [];

  constructor(
    private readonly getModel: () => ReviewDashboardModel,
    private readonly handleMessage: MessageHandler,
    private readonly handleVisibilityChange?: (visible: boolean) => void,
    private readonly extensionUri?: vscode.Uri,
  ) {}

  get visible(): boolean {
    return this.view?.visible === true;
  }

  resolveWebviewView(webviewView: vscode.WebviewView): void {
    this.view = webviewView;
    webviewView.webview.options = {
      enableScripts: true,
      localResourceRoots: [],
    };
    this.disposables.push(
      webviewView.webview.onDidReceiveMessage((message: unknown) => {
        if (isReviewWebviewMessage(message)) {
          void this.handleMessage(message);
        }
      }),
      webviewView.onDidDispose(() => {
        if (this.view === webviewView) {
          this.view = undefined;
        }
        this.handleVisibilityChange?.(false);
      }),
      webviewView.onDidChangeVisibility(() => {
        this.handleVisibilityChange?.(webviewView.visible);
        if (webviewView.visible) {
          this.refresh();
        }
      }),
    );
    this.handleVisibilityChange?.(webviewView.visible);
    this.refresh();
  }

  refresh(): void {
    if (!this.view) {
      return;
    }
    const nonce = createNonce();
    let codiconsUri: string | undefined;
    if (this.extensionUri) {
      const codiconsRoot = vscode.Uri.joinPath(this.extensionUri, "node_modules", "@vscode", "codicons", "dist");
      this.view.webview.options = {
        ...this.view.webview.options,
        localResourceRoots: [...(this.view.webview.options.localResourceRoots ?? []), codiconsRoot],
      };
      codiconsUri = this.view.webview.asWebviewUri(vscode.Uri.joinPath(codiconsRoot, "codicon.css")).toString();
    }
    this.view.webview.html = renderDashboardHtml(this.getModel() ?? buildEmptyReviewDashboardModel(), {
      nonce,
      cspSource: this.view.webview.cspSource,
      codiconsUri,
    });
  }

  dispose(): void {
    for (const disposable of this.disposables) {
      disposable.dispose();
    }
    this.disposables.length = 0;
    this.view = undefined;
  }
}

export class ReviewPanelWebviewController implements vscode.Disposable {
  private panel: vscode.WebviewPanel | undefined;
  private currentModel: ReviewPanelModel | undefined;
  private readonly disposables: vscode.Disposable[] = [];

  constructor(
    private readonly extensionUri: vscode.Uri,
    private readonly handleMessage: MessageHandler,
  ) {}

  open(model: ReviewPanelModel): void {
    this.currentModel = model;
    if (!this.panel) {
      this.panel = vscode.window.createWebviewPanel(
        "intentumdiff.reviewPanel",
        "IntentumDiff Review",
        vscode.ViewColumn.Active,
        {
          enableScripts: true,
          retainContextWhenHidden: true,
          localResourceRoots: [],
        },
      );
      this.panel.iconPath = {
        light: vscode.Uri.joinPath(this.extensionUri, "resources", "review-icon-light.svg"),
        dark: vscode.Uri.joinPath(this.extensionUri, "resources", "review-icon-dark.svg"),
      };
      this.disposables.push(
        this.panel.webview.onDidReceiveMessage((message: unknown) => {
          if (isReviewWebviewMessage(message)) {
            void this.handleMessage(message);
          }
        }),
        this.panel.onDidDispose(() => {
          this.panel = undefined;
          this.currentModel = undefined;
        }),
      );
    } else {
      this.panel.reveal(vscode.ViewColumn.Active, false);
    }
    this.panel.title = `IntentumDiff: ${model.file.relativePath}`;
    this.render();
  }

  postPanelCommand(
    command: "previousChange" | "nextChange" | "toggleRail" | "toggleEvidenceDrawer" | "setReviewView",
    reviewView?: string,
  ): void {
    void this.panel?.webview.postMessage({ command, reviewView });
  }

  refresh(model?: ReviewPanelModel): void {
    if (model) {
      this.currentModel = model;
    }
    this.render();
  }

  dispose(): void {
    for (const disposable of this.disposables) {
      disposable.dispose();
    }
    this.disposables.length = 0;
    this.panel?.dispose();
    this.panel = undefined;
    this.currentModel = undefined;
  }

  private render(): void {
    if (!this.panel || !this.currentModel) {
      return;
    }
    const folderUri = vscode.Uri.parse(this.currentModel.file.folderUri);
    const mediaUri = vscode.Uri.joinPath(this.extensionUri, "media");
    const codiconsRoot = vscode.Uri.joinPath(this.extensionUri, "node_modules", "@vscode", "codicons", "dist");
    this.panel.webview.options = {
      enableScripts: true,
      localResourceRoots: [folderUri, mediaUri, codiconsRoot],
    };
    const nonce = createNonce();
    const highlightUri = this.panel.webview
      .asWebviewUri(vscode.Uri.joinPath(mediaUri, "highlight", "highlight.min.js"))
      .toString();
    const codiconsUri = this.panel.webview
      .asWebviewUri(vscode.Uri.joinPath(codiconsRoot, "codicon.css"))
      .toString();
    this.panel.webview.html = renderPanelHtml(this.currentModel, {
      nonce,
      cspSource: this.panel.webview.cspSource,
      highlightUri,
      codiconsUri,
      resolveResourceUri: (resourcePath) => {
        if (/^vscode-resource:/u.test(resourcePath) || /^https?:/iu.test(resourcePath) || /^data:/iu.test(resourcePath)) {
          return resourcePath;
        }
        return this.panel?.webview.asWebviewUri(vscode.Uri.file(resourcePath)).toString() ?? resourcePath;
      },
    });
  }
}

function createNonce(): string {
  const alphabet = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
  let result = "";
  for (let index = 0; index < 32; index += 1) {
    result += alphabet[Math.floor(Math.random() * alphabet.length)];
  }
  return result;
}
