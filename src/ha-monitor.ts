import WebSocket, { type RawData } from "ws";
import type { HomeAssistantConfig } from "./types.js";

export class HomeAssistantMonitor {
  private config: HomeAssistantConfig;
  private onStateChanged: (event: Record<string, any>) => void;
  private ws: WebSocket | null = null;
  private msgId = 1;
  private stopped = false;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private reconnectDelay = 1000;

  constructor(
    config: HomeAssistantConfig,
    onStateChanged: (event: Record<string, any>) => void
  ) {
    this.config = config;
    this.onStateChanged = onStateChanged;
  }

  async start() {
    this.stopped = false;
    this.connect();
  }

  private connect() {
    if (this.stopped) return;

    const wsUrl = this.toWsUrl(this.config.baseURL);
    this.ws = new WebSocket(wsUrl);

    this.ws.on("open", () => {
      this.reconnectDelay = 1000;
      this.send({
        type: "auth",
        access_token: this.config.token,
      });
    });

    this.ws.on("message", (data: RawData) => {
      const text = this.rawDataToText(data);
      const parsed = this.safeJsonParse(text ?? "");
      if (!parsed) {
        return;
      }

      if (parsed.type === "auth_ok") {
        this.send({
          id: this.nextId(),
          type: "subscribe_events",
          event_type: "state_changed",
        });
        return;
      }

      if (
        parsed.type === "event" &&
        parsed.event?.event_type === "state_changed"
      ) {
        this.onStateChanged(parsed);
      }
    });

    this.ws.on("error", () => {
      console.log("HA WebSocket 连接失败");
    });

    this.ws.on("close", () => {
      this.scheduleReconnect();
    });
  }

  private scheduleReconnect() {
    if (this.stopped) return;
    const delay = Math.min(this.reconnectDelay, 30000);
    console.log(`HA WebSocket 将在 ${delay / 1000}s 后重连`);
    this.reconnectTimer = setTimeout(() => {
      this.reconnectDelay = Math.min(this.reconnectDelay * 2, 30000);
      this.connect();
    }, delay);
  }

  stop() {
    this.stopped = true;
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
  }

  private send(message: Record<string, unknown>) {
    if (!this.ws) {
      return;
    }
    this.ws.send(JSON.stringify(message));
  }

  private nextId() {
    return this.msgId++;
  }

  private toWsUrl(baseURL: string) {
    if (baseURL.startsWith("https://")) {
      return baseURL.replace("https://", "wss://") + "/api/websocket";
    }
    if (baseURL.startsWith("http://")) {
      return baseURL.replace("http://", "ws://") + "/api/websocket";
    }
    return `ws://${baseURL}/api/websocket`;
  }

  private rawDataToText(data: RawData) {
    if (typeof data === "string") {
      return data;
    }
    if (Buffer.isBuffer(data)) {
      return data.toString();
    }
    if (Array.isArray(data)) {
      return Buffer.concat(data).toString();
    }
    return Buffer.from(data).toString();
  }

  private safeJsonParse(text: string) {
    try {
      return JSON.parse(text);
    } catch (_) {
      return null;
    }
  }
}
