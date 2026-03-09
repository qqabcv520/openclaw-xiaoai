import { describe, it, expect, afterEach, beforeEach } from "vitest";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { UnifiedGateway } from "@/gateway.js";
import { NotificationServer } from "@/notification-server.js";
import type { AppConfig } from "@/types.js";

/**
 * 端到端集成测试：验证完整的数据流
 *
 * 路径 A — 贾维斯语音问答链路：
 *   小爱 ASR → Gateway → POST /channels/xiaoai/inbound → OpenClaw 处理
 *   → Plugin deliver() → POST /notify → NotificationServer → 回调
 *
 * 本测试启动真实的 HTTP 服务器来模拟各环节。
 */
describe("端到端链路: Gateway → Channel Plugin → NotificationServer", () => {
  let mockGatewayServer: ReturnType<typeof createServer>;
  let notificationServer: NotificationServer;
  let gatewayPort: number;
  let notifyPort: number;

  // 最终从 NotificationServer 收到的文本
  let notifiedTexts: string[];

  beforeEach(async () => {
    notifiedTexts = [];
  });

  afterEach(() => {
    mockGatewayServer?.close();
    notificationServer?.stop();
  });

  it("完整链路: 贾维斯请求 → channel inbound → 异步回传通知", async () => {
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

    // 2. 启动模拟 Gateway 服务器（模拟 OpenClaw Gateway + Channel Plugin）
    //    收到 inbound 请求后，模拟 Plugin deliver() 向 NotificationServer 回传
    mockGatewayServer = createServer(async (req: IncomingMessage, res: ServerResponse) => {
      const chunks: Buffer[] = [];
      for await (const chunk of req) {
        chunks.push(chunk as Buffer);
      }
      const body = JSON.parse(Buffer.concat(chunks).toString());

      // 模拟 OpenClaw 处理完后，Plugin deliver() → POST /notify
      res.writeHead(200);
      res.end();

      // 异步回传：模拟 Plugin 的 deliver 回调
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
      mockGatewayServer.listen(0, "127.0.0.1", () => resolve());
    });
    const gatewayAddr = mockGatewayServer.address();
    gatewayPort = typeof gatewayAddr === "object" && gatewayAddr ? gatewayAddr.port : 0;

    // 3. 创建 Gateway
    const gateway = new UnifiedGateway({
      config: {
        gateway: {
          url: `http://127.0.0.1:${gatewayPort}`,
          token: "gateway-token",
          timeoutMs: 5000,
        },
      } as AppConfig,
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
});
