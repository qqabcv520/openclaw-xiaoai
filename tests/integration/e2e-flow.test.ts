import { describe, it, expect, afterEach, beforeEach } from "vitest";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { UnifiedGateway } from "@/gateway.js";
import { NotificationServer } from "@/notification-server.js";
import type { AppConfig } from "@/types.js";

/**
 * 端到端集成测试：验证完整的数据流
 *
 * 路径 A — 贾维斯语音问答链路：
 *   小爱 ASR → Gateway → POST webhook → OpenClaw 处理
 *   → Plugin sendText() → POST /notify → NotificationServer → 回调
 *
 * 本测试启动真实的 HTTP 服务器来模拟各环节。
 */
describe("端到端链路: Gateway → Webhook → NotificationServer", () => {
  let mockWebhookServer: ReturnType<typeof createServer>;
  let notificationServer: NotificationServer;
  let webhookPort: number;
  let notifyPort: number;

  // 最终从 NotificationServer 收到的文本
  let notifiedTexts: string[];

  beforeEach(async () => {
    notifiedTexts = [];
  });

  afterEach(() => {
    mockWebhookServer?.close();
    notificationServer?.stop();
  });

  it("完整链路: 贾维斯请求 → webhook → 异步回传通知", async () => {
    // 1. 启动 NotificationServer（模拟桥接服务接收 OpenClaw 回传）
    notificationServer = new NotificationServer(
      { port: 0, token: "notify-token" },
      async (text) => {
        notifiedTexts.push(text);
      }
    );
    await notificationServer.start();
    const notifyAddr = (notificationServer as any).server?.address();
    notifyPort = typeof notifyAddr === "object" ? notifyAddr.port : 0;

    // 2. 启动模拟 webhook 服务器（模拟 OpenClaw Gateway）
    //    收到 webhook 后，模拟 Plugin 向 NotificationServer 回传
    mockWebhookServer = createServer(async (req: IncomingMessage, res: ServerResponse) => {
      const chunks: Buffer[] = [];
      for await (const chunk of req) {
        chunks.push(chunk as Buffer);
      }
      const body = JSON.parse(Buffer.concat(chunks).toString());

      // 模拟 OpenClaw 处理完后，Plugin 调用 sendText → POST /notify
      res.writeHead(200);
      res.end();

      // 异步回传：模拟 Plugin 的 sendText
      await fetch(`http://127.0.0.1:${notifyPort}/notify`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-openclaw-token": "notify-token",
        },
        body: JSON.stringify({
          text: `回答: 你问了"${body.message}"，这是AI回复。`,
        }),
      });
    });

    await new Promise<void>((resolve) => {
      mockWebhookServer.listen(0, "127.0.0.1", () => resolve());
    });
    const webhookAddr = mockWebhookServer.address();
    webhookPort = typeof webhookAddr === "object" && webhookAddr ? webhookAddr.port : 0;

    // 3. 创建 Gateway
    const gateway = new UnifiedGateway({
      config: {
        webhook: {
          url: `http://127.0.0.1:${webhookPort}/hooks/xiaoai`,
          token: "webhook-token",
          timeoutMs: 5000,
        },
        local: { forwardToXiaoAIOnFallback: false },
      } as AppConfig,
      localHandler: { process: async () => ({ handled: false, text: "" }) } as any,
    });

    // 4. 模拟"贾维斯"唤醒词请求
    const result = await gateway.handleRequest({
      wakeWord: "贾维斯",
      text: "今天天气怎么样",
      source: "asr",
    });

    // Gateway 立即返回空文本（异步模式）
    expect(result.handler).toBe("openclaw");
    expect(result.text).toBe("");

    // 5. 等待异步回传完成
    await new Promise((r) => setTimeout(r, 500));

    // 验证 NotificationServer 收到了 OpenClaw 的回传
    expect(notifiedTexts).toHaveLength(1);
    expect(notifiedTexts[0]).toContain("今天天气怎么样");
    expect(notifiedTexts[0]).toContain("AI回复");
  });

  it("完整链路: 小爱同学请求走本地处理，不触发 webhook", async () => {
    // 启动 NotificationServer
    notificationServer = new NotificationServer(
      { port: 0, token: "notify-token" },
      async (text) => {
        notifiedTexts.push(text);
      }
    );
    await notificationServer.start();

    // webhook 请求计数
    let webhookHits = 0;
    mockWebhookServer = createServer((_req, res) => {
      webhookHits++;
      res.writeHead(200);
      res.end();
    });
    await new Promise<void>((resolve) => {
      mockWebhookServer.listen(0, "127.0.0.1", () => resolve());
    });
    const webhookAddr = mockWebhookServer.address();
    webhookPort = typeof webhookAddr === "object" && webhookAddr ? webhookAddr.port : 0;

    const mockLocalHandler = {
      process: async (text: string) => {
        if (text.includes("客厅灯")) {
          return { handled: true, text: "好的，已打开客厅灯" };
        }
        return { handled: false, text: "" };
      },
    };

    const gateway = new UnifiedGateway({
      config: {
        webhook: {
          url: `http://127.0.0.1:${webhookPort}/hooks/xiaoai`,
          token: "webhook-token",
          timeoutMs: 5000,
        },
        local: { forwardToXiaoAIOnFallback: false },
      } as AppConfig,
      localHandler: mockLocalHandler as any,
    });

    // "小爱同学"指令走本地处理
    const result = await gateway.handleRequest({
      wakeWord: "小爱同学",
      text: "打开客厅灯",
      source: "asr",
    });

    expect(result.handler).toBe("local");
    expect(result.text).toBe("好的，已打开客厅灯");

    // webhook 不应被调用
    expect(webhookHits).toBe(0);
    // NotificationServer 不应收到通知
    expect(notifiedTexts).toHaveLength(0);
  });
});
