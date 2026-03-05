import type { AppConfig, WakeWord } from "./types.js";
import type { LocalHandler } from "./local-handler.js";

export interface GatewayRequest {
  wakeWord: WakeWord;
  text: string;
  source: "asr" | "manual";
}

export interface GatewayResult {
  text: string;
  handler: "local" | "openclaw" | "xiaoai" | "unknown";
  forwardToXiaoAI?: boolean;
}

export class UnifiedGateway {
  private config: AppConfig;
  private localHandler: LocalHandler;

  constructor(options: {
    config: AppConfig;
    localHandler: LocalHandler;
  }) {
    this.config = options.config;
    this.localHandler = options.localHandler;
  }

  async handleRequest(req: GatewayRequest): Promise<GatewayResult> {
    if (req.wakeWord === "小爱同学") {
      const localResult = await this.localHandler.process(req.text);
      if (!localResult.handled) {
        if (this.config.local.forwardToXiaoAIOnFallback) {
          return { text: "", handler: "xiaoai", forwardToXiaoAI: true };
        }
        return {
          text: '我还没学会这个指令，可以试试说"贾维斯"。',
          handler: "local",
        };
      }
      return { text: localResult.text, handler: "local" };
    }

    if (req.wakeWord === "贾维斯") {
      await this.postToWebhook(req.text);
      return { text: "", handler: "openclaw" };
    }

    return { text: "未知的唤醒词", handler: "unknown" };
  }

  private async postToWebhook(text: string): Promise<void> {
    const { url, token, timeoutMs } = this.config.webhook;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-openclaw-token": token,
        },
        body: JSON.stringify({
          message: text,
          name: "XiaoAi",
          sessionKey: "hook:xiaoai",
          deliver: true,
          channel: "xiaoai",
        }),
        signal: controller.signal,
      });
      if (!res.ok) {
        const body = await res.text().catch(() => "");
        console.log("webhook 响应异常", res.status, body.slice(0, 200));
      }
    } catch (err) {
      console.log("webhook 请求失败", (err as Error)?.message ?? err);
    } finally {
      clearTimeout(timeout);
    }
  }
}
