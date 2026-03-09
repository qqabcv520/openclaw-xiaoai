import type { AppConfig } from "./types.js";

export interface GatewayRequest {
  wakeWord: "小爱同学" | "贾维斯";
  text: string;
  source: "asr" | "manual";
}

export interface GatewayResult {
  text: string;
  handler: "openclaw" | "unknown";
  forwardToXiaoAI?: boolean;
}

export class UnifiedGateway {
  private config: AppConfig;

  constructor(options: { config: AppConfig }) {
    this.config = options.config;
  }

  async handleRequest(req: GatewayRequest): Promise<GatewayResult> {
    if (req.wakeWord === "贾维斯") {
      await this.postToChannel(req.text);
      return { text: "", handler: "openclaw" };
    }

    return { text: "未知的唤醒词", handler: "unknown" };
  }

  private async postToChannel(text: string): Promise<void> {
    const { url, token, timeoutMs } = this.config.gateway;
    const inboundUrl = `${url.replace(/\/+$/, "")}/channels/xiaoai/inbound`;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await fetch(inboundUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-openclaw-token": token,
        },
        body: JSON.stringify({ message: text }),
        signal: controller.signal,
      });
      if (!res.ok) {
        const body = await res.text().catch(() => "");
        console.log("channel inbound 响应异常", res.status, body.slice(0, 200));
      }
    } catch (err) {
      console.log("channel inbound 请求失败", (err as Error)?.message ?? err);
    } finally {
      clearTimeout(timeout);
    }
  }
}
