import * as vscode from "vscode";
import {
  anthropicRequest,
  buildExplainPrompt,
  buildPromptInput,
  buildReleaseNarrativePrompt,
  explainCacheKey,
  openAiRequest,
  parseAnthropic,
  parseOpenAi,
  releaseNarrativeCacheKey,
  type IntentExplainInput,
  type ReleaseNarrativeInput,
  type IntentShareLevel,
} from "./intentLlmPrompt";

const SECRET_KEY = "intentdiff.intentExplainerKey";
const CONSENT_KEY = "intentdiff.intentExplainerConsent";
const TIMEOUT_MS = 6000;

type Provider = "vscode-lm" | "anthropic" | "openai-compatible";

/**
 * Opt-in, BYOK LLM intent explainer. Off by default; only runs for
 * behavior-affecting changes; caches by change facts; any failure/refusal
 * returns undefined so the deterministic explanation is used instead.
 *
 * Providers: `vscode-lm` (the user's GitHub Copilot via VS Code's Language Model
 * API — no key, native consent), `anthropic` (BYOK), `openai-compatible` (BYOK or
 * a local endpoint via baseUrl).
 */
export class IntentLlmExplainer {
  private readonly cache = new Map<string, string>();

  constructor(
    private readonly secrets: vscode.SecretStorage,
    private readonly globalState: vscode.Memento,
  ) {}

  private config() {
    return vscode.workspace.getConfiguration("intentdiff.intent");
  }

  isEnabled(): boolean {
    return this.config().get<string>("explainer", "deterministic") === "llm";
  }

  private provider(): Provider {
    const value = this.config().get<string>("llm.provider", "vscode-lm");
    return value === "anthropic" || value === "openai-compatible" ? value : "vscode-lm";
  }

  /**
   * Effective privacy level for the payload. "full" (verbatim code) is only ever
   * honoured for a **local** endpoint; a cloud provider (or Copilot/vscode-lm) is
   * downgraded to "signatures" so raw source never leaves the machine.
   */
  private shareLevel(): IntentShareLevel {
    // Workspace Trust gates all identifier/source egress (#74): an untrusted
    // workspace is capped at privacy-safe facts regardless of configuration.
    if (!vscode.workspace.isTrusted) {
      return "facts";
    }
    const configured = this.config().get<string>("llm.codeSharing", "signatures");
    const level: IntentShareLevel = configured === "facts" || configured === "full" ? configured : "signatures";
    if (level !== "full") {
      return level;
    }
    const provider = this.provider();
    if (provider === "vscode-lm") {
      this.notifyDowngrade("the vscode-lm provider never receives raw source");
      return "signatures";
    }
    const baseUrl = (this.config().get<string>("llm.baseUrl", "").trim() || defaultBaseUrl(provider)).replace(/\/+$/u, "");
    if (isLocalUrl(baseUrl)) {
      return "full";
    }
    this.notifyDowngrade(`${baseUrl} is not a local endpoint`);
    return "signatures";
  }

  /**
   * The silent full→signatures cap confused users (#74): surface it once per
   * session so the configured `full` visibly did not take effect.
   */
  private notifyDowngrade(reason: string): void {
    if (this.downgradeNotified) {
      return;
    }
    this.downgradeNotified = true;
    void vscode.window.showWarningMessage(
      `IntentDiff: codeSharing "full" was capped to "signatures" — ${reason}. Raw source is only ever sent to loopback endpoints.`,
    );
  }

  private downgradeNotified = false;

  /** Synchronous cache lookup for UI providers that can't await (e.g. hovers). */
  peekCache(input: IntentExplainInput): string | undefined {
    return this.cache.get(explainCacheKey(buildPromptInput(input, this.shareLevel()))) || undefined;
  }

  async setKey(): Promise<void> {
    const key = await vscode.window.showInputBox({
      title: "IntentDiff — LLM API key (BYOK)",
      prompt: "Stored securely in VS Code SecretStorage. Not needed for the Copilot (vscode-lm) provider or a keyless local endpoint.",
      password: true,
      ignoreFocusOut: true,
    });
    if (key) {
      await this.secrets.store(SECRET_KEY, key.trim());
      void vscode.window.showInformationMessage("IntentDiff: LLM API key saved to SecretStorage.");
    }
  }

  async clearKey(): Promise<void> {
    await this.secrets.delete(SECRET_KEY);
    void vscode.window.showInformationMessage("IntentDiff: LLM API key cleared.");
  }

  /** Returns a one-sentence LLM explanation, or undefined to fall back to deterministic. */
  async explain(input: IntentExplainInput, token: vscode.CancellationToken): Promise<string | undefined> {
    // Only enrich behavior-affecting changes (bounds cost/noise).
    if (!this.isEnabled() || input.risk !== "behavior") {
      return undefined;
    }
    const promptInput = buildPromptInput(input, this.shareLevel());
    const cacheKey = explainCacheKey(promptInput);
    const cached = this.cache.get(cacheKey);
    if (cached !== undefined) {
      return cached || undefined;
    }
    try {
      const provider = this.provider();
      const prompt = buildExplainPrompt(promptInput);
      const text = provider === "vscode-lm"
        ? await this.viaVscodeLm(prompt, token)
        : await this.viaFetch(provider, prompt, token);
      this.cache.set(cacheKey, text ?? "");
      return text;
    } catch {
      return undefined;
    }
  }

  /**
   * Opt-in AI-drafted release narrative from the already-derived release notes.
   * Sends only the locally-derived note buckets — never source code. Any failure /
   * disabled / empty state returns undefined so the deterministic notes stand alone.
   */
  async draftReleaseNarrative(notes: ReleaseNarrativeInput, token: vscode.CancellationToken): Promise<string | undefined> {
    if (!this.isEnabled()) {
      return undefined;
    }
    if (notes.behavior.length + notes.internal.length + notes.guardrails.length === 0) {
      return undefined;
    }
    // The note buckets carry identifiers (symbol names). At the "facts" tier —
    // configured or forced by an untrusted workspace — identifiers may not be
    // shared with any model, so the deterministic notes stand alone (#74).
    if (this.shareLevel() === "facts") {
      return undefined;
    }
    const cacheKey = releaseNarrativeCacheKey(notes);
    const cached = this.cache.get(cacheKey);
    if (cached !== undefined) {
      return cached || undefined;
    }
    try {
      const provider = this.provider();
      const prompt = buildReleaseNarrativePrompt(notes);
      const text = provider === "vscode-lm"
        ? await this.viaVscodeLm(prompt, token)
        : await this.viaFetch(provider, prompt, token);
      this.cache.set(cacheKey, text ?? "");
      return text;
    } catch {
      return undefined;
    }
  }

  private async viaVscodeLm(prompt: string, token: vscode.CancellationToken): Promise<string | undefined> {
    if (!vscode.lm?.selectChatModels) {
      return undefined;
    }
    const family = this.config().get<string>("llm.model", "").trim();
    const models = await vscode.lm.selectChatModels({ vendor: "copilot", ...(family ? { family } : {}) });
    if (models.length === 0) {
      return undefined;
    }
    const response = await models[0].sendRequest(
      [vscode.LanguageModelChatMessage.User(prompt)],
      {},
      token,
    );
    let text = "";
    for await (const chunk of response.text) {
      text += chunk;
    }
    return text.trim() || undefined;
  }

  private async viaFetch(
    provider: Exclude<Provider, "vscode-lm">,
    prompt: string,
    token: vscode.CancellationToken,
  ): Promise<string | undefined> {
    const config = this.config();
    const baseUrl = (config.get<string>("llm.baseUrl", "").trim() || defaultBaseUrl(provider)).replace(/\/+$/u, "");
    const model = config.get<string>("llm.model", "").trim() || defaultModel(provider);
    const isLocal = isLocalUrl(baseUrl);
    const key = await this.secrets.get(SECRET_KEY);
    if (!isLocal && provider === "anthropic" && !key) {
      return undefined;
    }
    if (!isLocal && !(await this.ensureConsent(baseUrl))) {
      return undefined;
    }
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS);
    const cancel = token.onCancellationRequested(() => controller.abort());
    try {
      const url = provider === "anthropic" ? `${baseUrl}/v1/messages` : `${baseUrl}/v1/chat/completions`;
      const headers: Record<string, string> = { "content-type": "application/json" };
      if (provider === "anthropic") {
        if (key) {
          headers["x-api-key"] = key;
        }
        headers["anthropic-version"] = "2023-06-01";
      } else if (key) {
        headers.authorization = `Bearer ${key}`;
      }
      const body = provider === "anthropic" ? anthropicRequest(prompt, model) : openAiRequest(prompt, model);
      const response = await fetch(url, {
        method: "POST",
        headers,
        body: JSON.stringify(body),
        signal: controller.signal,
      });
      if (!response.ok) {
        return undefined;
      }
      const json = await response.json();
      return provider === "anthropic" ? parseAnthropic(json) : parseOpenAi(json);
    } finally {
      clearTimeout(timeout);
      cancel.dispose();
    }
  }

  /** One-time consent before any code snippet leaves the machine (cloud only). */
  private async ensureConsent(host: string): Promise<boolean> {
    if (this.globalState.get<boolean>(CONSENT_KEY) === true) {
      return true;
    }
    const choice = await vscode.window.showWarningMessage(
      `IntentDiff will send a structured summary of the change — symbol names, types, and shape, NOT the source code — to ${host} to generate intent explanations. Continue?`,
      { modal: true },
      "Allow",
    );
    if (choice === "Allow") {
      await this.globalState.update(CONSENT_KEY, true);
      return true;
    }
    return false;
  }
}

/**
 * Whether a base URL points at a local/self-hosted endpoint (nothing leaves the machine).
 * Loopback only (#74): exact `localhost`, any 127.0.0.0/8 address, or `[::1]`.
 * `0.0.0.0` is rejected (binds all interfaces; not a guarantee of locality), and
 * dotted hostnames like `localhost.evil.com` never match the exact-host rule.
 */
function isLocalUrl(url: string): boolean {
  let host: string;
  try {
    host = new URL(url).hostname.toLowerCase();
  } catch {
    return false;
  }
  if (host === "localhost" || host === "::1" || host === "[::1]") {
    return true;
  }
  const octets = host.split(".");
  return octets.length === 4 && octets[0] === "127" && octets.every((o) => /^\d{1,3}$/u.test(o) && Number(o) <= 255);
}

function defaultBaseUrl(provider: Exclude<Provider, "vscode-lm">): string {
  return provider === "anthropic" ? "https://api.anthropic.com" : "https://api.openai.com";
}

function defaultModel(provider: Exclude<Provider, "vscode-lm">): string {
  return provider === "anthropic" ? "claude-haiku-4-5-20251001" : "gpt-4o-mini";
}
