import WebSocket, { WebSocketServer, type RawData } from "ws";
import {
  createId,
  decodeStream,
  encodeAppMessage,
  encodeStream,
  parseAppMessage,
} from "./codec.js";
import type {
  EventMessage,
  RequestMessage,
  ResponseMessage,
  StreamPayload,
} from "./types.js";

export type RequestHandler = (
  request: RequestMessage
) => Promise<ResponseMessage | { data?: unknown }>;

export class OpenXiaoAIProtocolServer {
  private wss: WebSocketServer | null = null;
  private ws: WebSocket | null = null;
  private handlers = new Map<string, RequestHandler>();
  private pending = new Map<
    string,
    {
      resolve: (value: ResponseMessage) => void;
      reject: (reason?: Error) => void;
      timer: NodeJS.Timeout;
    }
  >();

  private onEventHandler?: (event: EventMessage) => void;
  private onStreamHandler?: (stream: StreamPayload) => void;
  private onConnectionHandler?: () => void | Promise<void>;

  async start(options?: {
    host?: string;
    port?: number;
    onConnection?: () => void | Promise<void>;
    onEvent?: (event: EventMessage) => void;
    onStream?: (stream: StreamPayload) => void;
  }) {
    const host = options?.host ?? "0.0.0.0";
    const port = options?.port ?? 4399;
    this.onEventHandler = options?.onEvent;
    this.onStreamHandler = options?.onStream;
    this.onConnectionHandler = options?.onConnection;

    this.wss = new WebSocketServer({ host, port });
    this.wss.on("connection", (ws: WebSocket) => {
      console.log("音箱已连接");
      if (this.ws && this.ws.readyState === WebSocket.OPEN) {
        this.ws.close();
      }
      this.ws = ws;
      const task = this.onConnectionHandler?.();
      if (task && typeof (task as Promise<void>).catch === "function") {
        void (task as Promise<void>).catch((err) => {
          console.log("onConnection 回调执行失败", err);
        });
      }
      ws.on("message", (data: RawData, isBinary: boolean) => {
        if (isBinary) {
          this.handleBinary(this.rawDataToBuffer(data));
        } else {
          const text = this.rawDataToBuffer(data).toString();
          this.handleText(text);
        }
      });
      ws.on("close", () => {
        if (this.ws === ws) {
          this.ws = null;
        }
        console.log("音箱已断开连接");
      });
    });

    await new Promise<void>((resolve) => {
      this.wss?.once("listening", () => resolve());
    });
    console.log(`WebSocket 监听中: ${host}:${port}`);
  }

  stop() {
    this.wss?.close();
    this.wss = null;
    this.ws?.close();
    this.ws = null;
  }

  registerCommand(command: string, handler: RequestHandler) {
    this.handlers.set(command, handler);
  }

  async callRemote(
    command: string,
    payload?: unknown,
    timeoutMs = 10 * 1000
  ) {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      throw new Error("WebSocket 未连接");
    }

    const request: RequestMessage = {
      id: createId(),
      command,
      ...(payload !== undefined ? { payload } : {}),
    };

    const response = await new Promise<ResponseMessage>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(request.id);
        reject(new Error("请求超时"));
      }, timeoutMs);

      this.pending.set(request.id, { resolve, reject, timer });
      this.ws?.send(encodeAppMessage("Request", request));
    });

    return response;
  }

  sendStream(tag: string, bytes: Uint8Array, data?: unknown) {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      throw new Error("WebSocket 未连接");
    }
    this.ws.send(encodeStream(tag, bytes, data));
  }

  private handleText(text: string) {
    const msg = parseAppMessage(text);
    if (!msg) {
      return;
    }

    if (msg.type === "Request") {
      console.log(`收到请求: ${msg.payload.command}`);
      void this.handleRequest(msg.payload);
    } else if (msg.type === "Response") {
      this.handleResponse(msg.payload);
    } else if (msg.type === "Event") {
      const evt = msg.payload;
      console.log(`收到事件: ${evt.event}`, typeof evt.data === "string" ? evt.data : "");
      this.onEventHandler?.(evt);
    }
  }

  private handleBinary(buffer: Buffer) {
    const stream = decodeStream(buffer);
    if (!stream) {
      return;
    }
    this.onStreamHandler?.(stream);
  }

  private async handleRequest(request: RequestMessage) {
    const handler = this.handlers.get(request.command);
    let response: ResponseMessage;

    if (!handler) {
      response = {
        id: request.id,
        code: -1,
        msg: "command not found",
      };
    } else {
      try {
        const result = await handler(request);
        if ("id" in result) {
          const { id: _id, ...rest } = result;
          response = { id: request.id, ...rest };
        } else {
          response = {
            id: request.id,
            code: 0,
            msg: "success",
            data: result.data,
          };
        }
      } catch (err) {
        response = {
          id: request.id,
          code: -1,
          msg: err instanceof Error ? err.message : "unknown error",
        };
      }
    }

    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(encodeAppMessage("Response", response));
    }
  }

  private handleResponse(response: ResponseMessage) {
    const pending = this.pending.get(response.id);
    if (!pending) {
      return;
    }
    clearTimeout(pending.timer);
    this.pending.delete(response.id);
    pending.resolve(response);
  }

  private rawDataToBuffer(data: RawData): Buffer {
    if (Buffer.isBuffer(data)) {
      return data;
    }
    if (typeof data === "string") {
      return Buffer.from(data);
    }
    if (Array.isArray(data)) {
      return Buffer.concat(data);
    }
    return Buffer.from(data);
  }
}
