import { randomUUID } from "node:crypto";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { EdgeTTS } from "node-edge-tts";
import type { TtsConfig } from "./types.js";

const EDGE_SAMPLE_RATE = 24000;
const PCM_BYTES_PER_SAMPLE = 2;

export interface TtsResult {
  pcmBytes: Uint8Array;
  sampleRate: number;
  durationMs: number;
}

export class TtsService {
  private tts: EdgeTTS | null = null;
  private config: TtsConfig;

  constructor(config: TtsConfig) {
    this.config = config;
  }

  async start(): Promise<boolean> {
    try {
      this.tts = new EdgeTTS({
        voice: this.config.voice ?? "zh-CN-YunxiNeural",
        lang: "zh-CN",
        outputFormat: "raw-24khz-16bit-mono-pcm",
        rate: this.config.rate ?? "+0%",
        pitch: this.config.pitch ?? "default",
        volume: this.config.volume ?? "default",
        timeout: this.config.timeoutMs ?? 10000,
      });
      console.log(`Edge TTS 已启动，voice=${this.config.voice ?? "zh-CN-YunxiNeural"}`);
      return true;
    } catch (err) {
      console.log(
        "Edge TTS 初始化失败，将使用小爱自带 TTS",
        (err as Error)?.message ?? err
      );
      this.tts = null;
      return false;
    }
  }

  async synthesize(text: string): Promise<TtsResult | null> {
    if (!this.tts) {
      return null;
    }

    const content = text.trim();
    if (!content) {
      return null;
    }

    const tempFile = path.join(os.tmpdir(), `openclaw-edge-tts-${randomUUID()}.pcm`);
    try {
      await this.tts.ttsPromise(content, tempFile);
      const pcmBytes = new Uint8Array(await fs.readFile(tempFile));
      const durationMs = (pcmBytes.length / (EDGE_SAMPLE_RATE * PCM_BYTES_PER_SAMPLE)) * 1000;
      return {
        pcmBytes,
        sampleRate: EDGE_SAMPLE_RATE,
        durationMs,
      };
    } catch (err) {
      console.log(
        "Edge TTS 合成失败",
        (err as Error)?.message ?? err
      );
      return null;
    } finally {
      await fs.unlink(tempFile).catch(() => {});
    }
  }

  isReady(): boolean {
    return this.tts !== null;
  }
}
