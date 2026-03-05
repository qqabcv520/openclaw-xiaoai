import { describe, it, expect, afterEach } from "vitest";
import { NotificationServer } from "@/notification-server.js";

describe("NotificationServer 集成测试", () => {
  let server: NotificationServer;
  let serverPort: number;

  function createServer(
    onNotify: (text: string) => Promise<void>,
    token = "test-token"
  ) {
    server = new NotificationServer(
      { port: 0, host: "127.0.0.1", token } as any,
      onNotify
    );
    return server;
  }

  async function startAndGetPort() {
    await server.start();
    const httpServer = (server as any).server;
    const addr = httpServer?.address();
    if (!addr || typeof addr === "string") {
      throw new Error("Failed to get server address");
    }
    serverPort = addr.port;
    return serverPort;
  }

  afterEach(() => {
    server?.stop();
  });

  it("POST /notify 带正确 token 返回 200 并触发回调", async () => {
    const received: string[] = [];
    createServer(async (text) => {
      received.push(text);
    });
    const port = await startAndGetPort();

    const res = await fetch(`http://127.0.0.1:${port}/notify`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-openclaw-token": "test-token",
      },
      body: JSON.stringify({ text: "你好，我是集成测试" }),
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);

    // 等待异步回调执行
    await new Promise((r) => setTimeout(r, 100));
    expect(received).toEqual(["你好，我是集成测试"]);
  });

  it("POST /notify 缺少 token 返回 401", async () => {
    createServer(async () => {});
    const port = await startAndGetPort();

    const res = await fetch(`http://127.0.0.1:${port}/notify`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text: "hello" }),
    });

    expect(res.status).toBe(401);
  });

  it("POST /notify 错误 token 返回 401", async () => {
    createServer(async () => {});
    const port = await startAndGetPort();

    const res = await fetch(`http://127.0.0.1:${port}/notify`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-openclaw-token": "wrong-token",
      },
      body: JSON.stringify({ text: "hello" }),
    });

    expect(res.status).toBe(401);
  });

  it("POST /notify 支持 Bearer token 认证", async () => {
    const received: string[] = [];
    createServer(async (text) => {
      received.push(text);
    });
    const port = await startAndGetPort();

    const res = await fetch(`http://127.0.0.1:${port}/notify`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: "Bearer test-token",
      },
      body: JSON.stringify({ text: "bearer认证" }),
    });

    expect(res.status).toBe(200);
    await new Promise((r) => setTimeout(r, 100));
    expect(received).toEqual(["bearer认证"]);
  });

  it("POST /notify 支持 message 字段作为文本", async () => {
    const received: string[] = [];
    createServer(async (text) => {
      received.push(text);
    });
    const port = await startAndGetPort();

    const res = await fetch(`http://127.0.0.1:${port}/notify`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-openclaw-token": "test-token",
      },
      body: JSON.stringify({ message: "通过message字段发送" }),
    });

    expect(res.status).toBe(200);
    await new Promise((r) => setTimeout(r, 100));
    expect(received).toEqual(["通过message字段发送"]);
  });

  it("POST /notify 缺少文本内容返回 400", async () => {
    createServer(async () => {});
    const port = await startAndGetPort();

    const res = await fetch(`http://127.0.0.1:${port}/notify`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-openclaw-token": "test-token",
      },
      body: JSON.stringify({}),
    });

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe("missing text");
  });

  it("POST /notify 非法 JSON 返回 400", async () => {
    createServer(async () => {});
    const port = await startAndGetPort();

    const res = await fetch(`http://127.0.0.1:${port}/notify`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-openclaw-token": "test-token",
      },
      body: "not json{{{",
    });

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe("invalid JSON");
  });

  it("GET /health 返回 200 健康检查", async () => {
    createServer(async () => {});
    const port = await startAndGetPort();

    const res = await fetch(`http://127.0.0.1:${port}/health`);

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.status).toBe("ok");
  });

  it("GET /notify 返回 404", async () => {
    createServer(async () => {});
    const port = await startAndGetPort();

    const res = await fetch(`http://127.0.0.1:${port}/notify`);

    expect(res.status).toBe(404);
  });

  it("POST /other 返回 404", async () => {
    createServer(async () => {});
    const port = await startAndGetPort();

    const res = await fetch(`http://127.0.0.1:${port}/other`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-openclaw-token": "test-token",
      },
      body: JSON.stringify({ text: "wrong path" }),
    });

    expect(res.status).toBe(404);
  });
});
