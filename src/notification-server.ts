import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import type { NotificationConfig } from "./types.js";

export type NotifyHandler = (text: string) => Promise<void>;

export class NotificationServer {
  private config: NotificationConfig;
  private onNotify: NotifyHandler;
  private server: ReturnType<typeof createServer> | null = null;

  constructor(config: NotificationConfig, onNotify: NotifyHandler) {
    this.config = config;
    this.onNotify = onNotify;
  }

  async start(): Promise<void> {
    this.server = createServer((req, res) => {
      this.handleRequest(req, res).catch((err) => {
        console.log("NotificationServer 请求处理异常", (err as Error)?.message ?? err);
        if (!res.writableEnded) {
          res.writeHead(500);
          res.end("Internal Server Error");
        }
      });
    });
    const host = this.config.host ?? "0.0.0.0";
    const port = this.config.port;
    await new Promise<void>((resolve) => {
      this.server!.listen(port, host, () => resolve());
    });
    console.log(`NotificationServer 监听中: ${host}:${port}`);
  }

  stop(): void {
    this.server?.close();
    this.server = null;
  }

  private async handleRequest(req: IncomingMessage, res: ServerResponse) {
    // 健康检查
    if (req.method === "GET" && req.url === "/health") {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ status: "ok" }));
      return;
    }

    // 仅接受 POST /notify
    if (req.method !== "POST" || req.url !== "/notify") {
      res.writeHead(404);
      res.end("Not Found");
      return;
    }

    // 验证 token
    const token = this.extractToken(req);
    if (token !== this.config.token) {
      res.writeHead(401);
      res.end("Unauthorized");
      return;
    }

    // 读取 body
    const body = await this.readBody(req);
    if (!body) {
      res.writeHead(400);
      res.end("Bad Request");
      return;
    }

    try {
      const payload = JSON.parse(body) as { text?: string; message?: string };
      const text = (payload.text ?? payload.message)?.trim();
      if (!text) {
        res.writeHead(400, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ ok: false, error: "missing text" }));
        return;
      }

      // 先返回 200，再异步播报
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ ok: true }));

      console.log(`收到通知: "${text}"`);
      this.onNotify(text).catch((err) => {
        console.log("TTS 播报失败", (err as Error)?.message ?? err);
      });
    } catch {
      res.writeHead(400, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ ok: false, error: "invalid JSON" }));
    }
  }

  private extractToken(req: IncomingMessage): string | undefined {
    // 支持 x-openclaw-token header
    const headerToken = req.headers["x-openclaw-token"];
    if (typeof headerToken === "string") {
      return headerToken;
    }
    // 支持 Authorization: Bearer <token>
    const auth = req.headers.authorization;
    if (auth?.startsWith("Bearer ")) {
      return auth.slice(7);
    }
    return undefined;
  }

  private readBody(req: IncomingMessage, maxBytes = 1024 * 1024): Promise<string | null> {
    return new Promise((resolve) => {
      const chunks: Buffer[] = [];
      let totalBytes = 0;
      req.on("data", (chunk: Buffer) => {
        totalBytes += chunk.length;
        if (totalBytes > maxBytes) {
          req.destroy();
          resolve(null);
          return;
        }
        chunks.push(chunk);
      });
      req.on("end", () => resolve(Buffer.concat(chunks).toString()));
      req.on("error", () => resolve(null));
    });
  }
}
