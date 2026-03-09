import type { AppConfig } from "./src/types.js";

export const kAppConfig: AppConfig = {
  gateway: {
    url: "http://localhost:18789",
    token: "your-gateway-token-here",
    timeoutMs: 10000,
  },
  notification: {
    port: 4400,
    host: "0.0.0.0",
    token: "your-notification-token-here",
  },
  wakeup: {
    jarvisKeywords: ["贾维斯"],
    jarvisHoldMs: 10000,
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
    bargeInWakeWords: ["贾维斯"],
    bargeInCooldownMs: 600,
  },
};
