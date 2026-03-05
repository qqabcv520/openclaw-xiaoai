import { describe, it, expect, afterEach, beforeEach } from "vitest";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { UnifiedGateway } from "@/gateway.js";
import type { AppConfig } from "@/types.js";

/**
 * Gateway → webhook 集成测试
 * 启动一个真实的 HTTP 服务器模拟 OpenClaw webhook 端点，
 * 验证 Gateway 能正确发送 HTTP 请求。
 */
describe("Gateway → Webhook 集成测试", () => {
  let mockWebhookServer: ReturnType<typeof createServer>;
  let webhookPort: number;
  let gateway: UnifiedGateway;

  // 记录 webhook 收到的请求
  let webhookRequests: Array<{
    method: string;
    url: string;
    headers: Record<string, string | string[] | undefined>;
    body: any;
  }>;

  beforeEach(async () => {
    webhookRequests = [];

    // 启动模拟 webhook 服务器
    mockWebhookServer = createServer(async (req: IncomingMessage, res: ServerResponse) => {
      const chunks: Buffer[] = [];
      for await (const chunk of req) {
        chunks.push(chunk as Buffer);
      }
      const bodyStr = Buffer.concat(chunks).toString();
      let body: any;
      try {
        body = JSON.parse(bodyStr);
      } catch {
        body = bodyStr;
      }

      webhookRequests.push({
        method: req.method ?? "",
        url: req.url ?? "",
        headers: req.headers as Record<string, string | string[] | undefined>,
        body,
      });

      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ ok: true }));
    });

    await new Promise<void>((resolve) => {
      mockWebhookServer.listen(0, "127.0.0.1", () => resolve());
    });

    const addr = mockWebhookServer.address();
    webhookPort = typeof addr === "object" && addr ? addr.port : 0;

    const mockConfig = {
      webhook: {
        url: `http://127.0.0.1:${webhookPort}/hooks/xiaoai`,
        token: "webhook-test-token",
        timeoutMs: 5000,
      },
      local: {
        forwardToXiaoAIOnFallback: false,
      },
    } as AppConfig;

    const mockLocalHandler = {
      process: async () => ({ handled: false, text: "" }),
    };

    gateway = new UnifiedGateway({
      config: mockConfig,
      localHandler: mockLocalHandler as any,
    });
  });

  afterEach(() => {
    mockWebhookServer?.close();
  });

  it("贾维斯唤醒词发送正确的 webhook 请求", async () => {
    const result = await gateway.handleRequest({
      wakeWord: "贾维斯",
      text: "今天天气怎么样",
      source: "asr",
    });

    // Gateway 返回空文本和 openclaw handler
    expect(result.handler).toBe("openclaw");
    expect(result.text).toBe("");

    // 验证 webhook 收到了正确的请求
    expect(webhookRequests).toHaveLength(1);
    const req = webhookRequests[0]!;
    expect(req.method).toBe("POST");
    expect(req.url).toBe("/hooks/xiaoai");
    expect(req.headers["x-openclaw-token"]).toBe("webhook-test-token");
    expect(req.headers["content-type"]).toBe("application/json");
    expect(req.body).toEqual({
      message: "今天天气怎么样",
      name: "XiaoAi",
      sessionKey: "hook:xiaoai",
      deliver: true,
      channel: "xiaoai",
    });
  });

  it("webhook 请求包含正确的认证 token", async () => {
    await gateway.handleRequest({
      wakeWord: "贾维斯",
      text: "测试认证",
      source: "asr",
    });

    expect(webhookRequests).toHaveLength(1);
    expect(webhookRequests[0]!.headers["x-openclaw-token"]).toBe("webhook-test-token");
  });

  it("小爱同学唤醒词不发送 webhook 请求", async () => {
    await gateway.handleRequest({
      wakeWord: "小爱同学",
      text: "你好",
      source: "asr",
    });

    expect(webhookRequests).toHaveLength(0);
  });
});

describe("Gateway → Webhook 异常场景", () => {
  let mockWebhookServer: ReturnType<typeof createServer>;
  let webhookPort: number;

  afterEach(() => {
    mockWebhookServer?.close();
  });

  it("webhook 返回非 200 时 Gateway 不抛异常", async () => {
    // 启动返回 500 的服务器
    mockWebhookServer = createServer((_req, res) => {
      res.writeHead(500);
      res.end("Internal Server Error");
    });
    await new Promise<void>((resolve) => {
      mockWebhookServer.listen(0, "127.0.0.1", () => resolve());
    });
    const addr = mockWebhookServer.address();
    webhookPort = typeof addr === "object" && addr ? addr.port : 0;

    const gateway = new UnifiedGateway({
      config: {
        webhook: {
          url: `http://127.0.0.1:${webhookPort}/hooks/xiaoai`,
          token: "test",
          timeoutMs: 5000,
        },
        local: { forwardToXiaoAIOnFallback: false },
      } as AppConfig,
      localHandler: { process: async () => ({ handled: false, text: "" }) } as any,
    });

    // 不应抛异常
    const result = await gateway.handleRequest({
      wakeWord: "贾维斯",
      text: "测试",
      source: "asr",
    });

    expect(result.handler).toBe("openclaw");
  });

  it("webhook 连接不上时 Gateway 不抛异常", async () => {
    const gateway = new UnifiedGateway({
      config: {
        webhook: {
          url: "http://127.0.0.1:1/hooks/xiaoai",
          token: "test",
          timeoutMs: 2000,
        },
        local: { forwardToXiaoAIOnFallback: false },
      } as AppConfig,
      localHandler: { process: async () => ({ handled: false, text: "" }) } as any,
    });

    // 连接拒绝不应抛异常
    const result = await gateway.handleRequest({
      wakeWord: "贾维斯",
      text: "测试",
      source: "asr",
    });

    expect(result.handler).toBe("openclaw");
  });
});
