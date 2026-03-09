import { describe, it, expect, afterEach, beforeEach } from "vitest";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { UnifiedGateway } from "@/gateway.js";
import type { AppConfig } from "@/types.js";

/**
 * Gateway → Channel Plugin 集成测试
 * 启动一个真实的 HTTP 服务器模拟 OpenClaw Channel Plugin 入站端点，
 * 验证 Gateway 能正确发送 HTTP 请求。
 */
describe("Gateway → Channel Plugin 集成测试", () => {
  let mockServer: ReturnType<typeof createServer>;
  let serverPort: number;
  let gateway: UnifiedGateway;

  // 记录服务端收到的请求
  let receivedRequests: Array<{
    method: string;
    url: string;
    headers: Record<string, string | string[] | undefined>;
    body: any;
  }>;

  beforeEach(async () => {
    receivedRequests = [];

    // 启动模拟服务器
    mockServer = createServer(async (req: IncomingMessage, res: ServerResponse) => {
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

      receivedRequests.push({
        method: req.method ?? "",
        url: req.url ?? "",
        headers: req.headers as Record<string, string | string[] | undefined>,
        body,
      });

      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ ok: true }));
    });

    await new Promise<void>((resolve) => {
      mockServer.listen(0, "127.0.0.1", () => resolve());
    });

    const addr = mockServer.address();
    serverPort = typeof addr === "object" && addr ? addr.port : 0;

    const mockConfig = {
      gateway: {
        url: `http://127.0.0.1:${serverPort}`,
        token: "gateway-test-token",
        timeoutMs: 5000,
      },
    } as AppConfig;

    gateway = new UnifiedGateway({ config: mockConfig });
  });

  afterEach(() => {
    mockServer?.close();
  });

  it("贾维斯唤醒词发送正确的 channel inbound 请求", async () => {
    const result = await gateway.handleRequest({
      wakeWord: "贾维斯",
      text: "今天天气怎么样",
      source: "asr",
    });

    // Gateway 返回空文本和 openclaw handler
    expect(result.handler).toBe("openclaw");
    expect(result.text).toBe("");

    // 验证收到了正确的请求
    expect(receivedRequests).toHaveLength(1);
    const req = receivedRequests[0]!;
    expect(req.method).toBe("POST");
    expect(req.url).toBe("/channels/xiaoai/inbound");
    expect(req.headers["x-openclaw-token"]).toBe("gateway-test-token");
    expect(req.headers["content-type"]).toBe("application/json");
    expect(req.body).toEqual({
      message: "今天天气怎么样",
    });
  });

  it("请求包含正确的认证 token", async () => {
    await gateway.handleRequest({
      wakeWord: "贾维斯",
      text: "测试认证",
      source: "asr",
    });

    expect(receivedRequests).toHaveLength(1);
    expect(receivedRequests[0]!.headers["x-openclaw-token"]).toBe("gateway-test-token");
  });
});

describe("Gateway → Channel Plugin 异常场景", () => {
  let mockServer: ReturnType<typeof createServer>;
  let serverPort: number;

  afterEach(() => {
    mockServer?.close();
  });

  it("服务端返回非 200 时 Gateway 不抛异常", async () => {
    // 启动返回 500 的服务器
    mockServer = createServer((_req, res) => {
      res.writeHead(500);
      res.end("Internal Server Error");
    });
    await new Promise<void>((resolve) => {
      mockServer.listen(0, "127.0.0.1", () => resolve());
    });
    const addr = mockServer.address();
    serverPort = typeof addr === "object" && addr ? addr.port : 0;

    const gateway = new UnifiedGateway({
      config: {
        gateway: {
          url: `http://127.0.0.1:${serverPort}`,
          token: "test",
          timeoutMs: 5000,
        },
      } as AppConfig,
    });

    // 不应抛异常
    const result = await gateway.handleRequest({
      wakeWord: "贾维斯",
      text: "测试",
      source: "asr",
    });

    expect(result.handler).toBe("openclaw");
  });

  it("连接不上时 Gateway 不抛异常", async () => {
    const gateway = new UnifiedGateway({
      config: {
        gateway: {
          url: "http://127.0.0.1:1",
          token: "test",
          timeoutMs: 2000,
        },
      } as AppConfig,
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
