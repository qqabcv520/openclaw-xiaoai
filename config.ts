import type { AppConfig } from "./src/types.js";

export const kAppConfig: AppConfig = {
  webhook: {
    url: "http://localhost:18789/hooks/xiaoai",
    token: "your-webhook-token-here",
    timeoutMs: 10000,
  },
  notification: {
    port: 4400,
    host: "0.0.0.0",
    token: "your-notification-token-here",
  },
  ha: {
    baseURL: "http://192.168.1.43:8123",
    token: "your-ha-token",
  },
  wakeup: {
    jarvisKeywords: ["贾维斯"],
    jarvisHoldMs: 10000,
  },
  devices: {
    lights: {
      客厅灯: "light.living_room",
    },
    switches: {},
    climates: {
      空调: "climate.living_room",
    },
  },
  local: {
    forwardToXiaoAIOnFallback: true,
  },
  xiaoai: {
    abortOnJarvis: true,
  },
  kws: {
    enabled: true,
    boost: 100,
    modelsDir: "./models",
    keywordsScore: 1.5,
    keywordsThreshold: 0.1,
  },
  tts: {
    enabled: true,
    voice: "zh-CN-YunxiNeural",
    rate: "+0%",
    pitch: "default",
    volume: "default",
    timeoutMs: 10000,
    chunkMs: 60,
    allowBargeIn: true,
    bargeInWakeWords: ["贾维斯", "小爱同学"],
    bargeInCooldownMs: 600,
  },
};
