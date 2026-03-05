import fs from "node:fs";
import path from "node:path";
import type { KwsConfig } from "./types.js";

type KeywordSpotterLike = {
  createStream: () => KeywordStreamLike;
  isReady: (stream: KeywordStreamLike) => boolean;
  decode: (stream: KeywordStreamLike) => void;
  getResult: (stream: KeywordStreamLike) => { keyword?: string };
  reset?: (stream: KeywordStreamLike) => void;
  resetStream?: (stream: KeywordStreamLike) => void;
};

type SherpaLike = {
  KeywordSpotter: new (config: unknown) => KeywordSpotterLike;
};

type KeywordStreamLike = {
  acceptWaveform: (input: { sampleRate: number; samples: Float32Array }) => void;
};

export class KwsService {
  private spotter: KeywordSpotterLike | null = null;
  private stream: KeywordStreamLike | null = null;
  private paused = false;
  private active = false;
  private config: KwsConfig;
  private onKeyword: (keyword: string) => void | Promise<void>;

  constructor(
    config: KwsConfig,
    onKeyword: (keyword: string) => void | Promise<void>
  ) {
    this.config = config;
    this.onKeyword = onKeyword;
  }

  async start(): Promise<boolean> {
    const modelsDir = path.resolve(this.config.modelsDir);
    const required = [
      "encoder.onnx",
      "decoder.onnx",
      "joiner.onnx",
      "tokens.txt",
      "keywords.txt",
    ];
    const missing = required.filter(
      (f) => !fs.existsSync(path.join(modelsDir, f))
    );
    if (missing.length > 0) {
      console.log(
        `KWS 模型文件缺失: ${missing.join(", ")}，KWS 已禁用`
      );
      console.log(`   请从 GitHub Release 下载模型到 ${modelsDir}/`);
      return false;
    }

    const sherpa = await this.loadSherpa();
    if (!sherpa) {
      return false;
    }

    try {
      const keywordsFile = path.join(modelsDir, "keywords.txt");
      const config = {
        featConfig: {
          sampleRate: 16000,
          featureDim: 80,
        },
        modelConfig: {
          transducer: {
            encoder: path.join(modelsDir, "encoder.onnx"),
            decoder: path.join(modelsDir, "decoder.onnx"),
            joiner: path.join(modelsDir, "joiner.onnx"),
          },
          tokens: path.join(modelsDir, "tokens.txt"),
          numThreads: 1,
          provider: "cpu",
          debug: 0,
        },
        keywordsFile,
        keywordsScore: this.config.keywordsScore,
        keywordsThreshold: this.config.keywordsThreshold,
      };

      this.spotter = new sherpa.KeywordSpotter(config);
      this.stream = this.spotter.createStream();
      this.paused = false;
      this.active = true;
      console.log(`KWS 已启动，唤醒词来源: ${keywordsFile}`);
      return true;
    } catch (err) {
      console.log(
        "KWS 初始化失败，KWS 已禁用",
        (err as Error)?.message ?? err
      );
      this.dispose();
      return false;
    }
  }

  private feedCount = 0;

  feedAudio(pcmData: Uint8Array): void {
    if (this.paused || !this.active || !this.spotter || !this.stream) {
      return;
    }

    const int16 = new Int16Array(
      pcmData.buffer,
      pcmData.byteOffset,
      pcmData.byteLength / 2
    );
    const float32 = new Float32Array(int16.length);
    for (let i = 0; i < int16.length; i++) {
      float32[i] = Math.max(
        -1,
        Math.min(1, ((int16[i] ?? 0) * this.config.boost) / 32768.0)
      );
    }

    this.feedCount++;
    if (this.feedCount % 500 === 1) {
      const maxVal = float32.reduce((a, b) => Math.max(a, Math.abs(b)), 0);
      console.log(`KWS 音量: max=${maxVal.toFixed(3)} (feed #${this.feedCount})`);
    }

    this.stream.acceptWaveform({ sampleRate: 16000, samples: float32 });

    while (this.spotter.isReady(this.stream)) {
      this.spotter.decode(this.stream);
      const result = this.spotter.getResult(this.stream);
      if (result.keyword) {
        this.resetStream();
        this.emitKeyword(result.keyword.trim());
        return;
      }
    }
  }

  pause(): void {
    this.paused = true;
  }

  resume(): void {
    this.paused = false;
  }

  isActive(): boolean {
    return this.active;
  }

  dispose(): void {
    this.active = false;
    this.paused = false;
    this.stream = null;
    this.spotter = null;
  }

  private async loadSherpa(): Promise<SherpaLike | null> {
    try {
      const moduleName = "sherpa-onnx-node";
      const mod = await import(moduleName);
      const candidate = ((mod as any).KeywordSpotter ? mod : (mod as any).default) as
        | SherpaLike
        | undefined;
      if (candidate?.KeywordSpotter) {
        return candidate;
      }
      console.log("sherpa-onnx-node 导出不包含 KeywordSpotter，KWS 已禁用");
      return null;
    } catch (err) {
      console.log(
        "sherpa-onnx-node 加载失败，KWS 已禁用",
        (err as Error)?.message ?? err
      );
      return null;
    }
  }

  private emitKeyword(keyword: string) {
    try {
      const result = this.onKeyword(keyword);
      if (result && typeof (result as Promise<void>).catch === "function") {
        void (result as Promise<void>).catch((err) => {
          console.log("KWS 关键词回调失败", (err as Error)?.message ?? err);
        });
      }
    } catch (err) {
      console.log("KWS 关键词回调失败", (err as Error)?.message ?? err);
    }
  }

  private resetStream() {
    if (!this.spotter || !this.stream) {
      return;
    }
    if (typeof this.spotter.resetStream === "function") {
      this.spotter.resetStream(this.stream);
      return;
    }
    if (typeof this.spotter.reset === "function") {
      this.spotter.reset(this.stream);
    }
  }
}
