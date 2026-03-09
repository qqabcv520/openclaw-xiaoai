export type WakeWord = "小爱同学" | "贾维斯";

export interface GatewayConfig {
  /** OpenClaw Gateway 基础 URL，如 http://localhost:18789 */
  url: string;
  /** 认证 token */
  token: string;
  /** 请求超时毫秒 */
  timeoutMs: number;
}

export interface NotificationConfig {
  /** 监听端口，默认 4400 */
  port: number;
  /** 监听地址，默认 0.0.0.0 */
  host?: string;
  /** 认证 token，需与 Plugin 侧一致 */
  token: string;
}

export interface WakeupConfig {
  jarvisKeywords: string[];
  jarvisHoldMs: number;
}

export interface XiaoAIConfig {
  abortOnJarvis: boolean;
}

export interface KwsConfig {
  enabled: boolean;
  boost: number;
  modelsDir: string;
  keywordsScore: number;
  keywordsThreshold: number;
}

export interface TtsConfig {
  enabled: boolean;
  voice?: string;
  rate?: string;
  pitch?: string;
  volume?: string;
  timeoutMs?: number;
  chunkMs?: number;
  allowBargeIn?: boolean;
  bargeInWakeWords?: WakeWord[];
  bargeInCooldownMs?: number;
}

export interface AppConfig {
  gateway: GatewayConfig;
  notification: NotificationConfig;
  wakeup: WakeupConfig;
  xiaoai: XiaoAIConfig;
  kws?: KwsConfig;
  tts?: TtsConfig;
}
