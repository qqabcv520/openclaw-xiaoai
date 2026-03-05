import { randomUUID } from "node:crypto";
import { OpenXiaoAIProtocol } from "./open-xiaoai.js";
import { OpenXiaoAISpeaker } from "./speaker.js";
import { UnifiedGateway } from "./gateway.js";
import { LocalHandler } from "./local-handler.js";
import { HomeAssistantController } from "./ha-controller.js";
import { HomeAssistantMonitor } from "./ha-monitor.js";
import { KwsService } from "./kws.js";
import { TtsService } from "./tts.js";
import { NotificationServer } from "./notification-server.js";
import type { AppConfig, WakeWord } from "./types.js";

export class XiaoAiApp {
  private config: AppConfig;
  private gateway: UnifiedGateway;
  private speaker = OpenXiaoAISpeaker;
  private kws: KwsService | null = null;
  private ttsService: TtsService | null = null;
  private notificationServer: NotificationServer;
  private ttsEnabled = false;
  private isTtsStreaming = false;
  private ttsStreamingTimer: NodeJS.Timeout | null = null;
  private lastBargeInAt = 0;
  private kwsEnabled = false;
  private kwsHoldUntil = 0;
  private kwsResumeTimer: NodeJS.Timeout | null = null;
  private jarvisArmed = false;
  private jarvisArmedAt = 0;
  private jarvisFallbackSuppressUntil = 0;
  private lastHandledAsr: {
    wakeWord: WakeWord;
    text: string;
    at: number;
  } | null = null;
  private sessionId = randomUUID();
  private queue = Promise.resolve();

  constructor(config: AppConfig) {
    this.config = config;

    const haController = new HomeAssistantController(config.ha);
    const localHandler = new LocalHandler(config, haController);

    this.gateway = new UnifiedGateway({
      config,
      localHandler,
    });

    this.notificationServer = new NotificationServer(
      config.notification,
      (text) => this.enqueueNotification(text)
    );

    if (config.kws?.enabled) {
      this.kws = new KwsService(config.kws, (keyword) =>
        this.onKwsDetected(keyword)
      );
    }

    if (config.tts?.enabled) {
      this.ttsService = new TtsService(config.tts);
    }
  }

  async start() {
    await this.notificationServer.start();

    this.kwsEnabled = this.kws ? await this.kws.start() : false;
    if (!this.kwsEnabled && this.config.kws?.enabled) {
      console.log("服务端 KWS 未启用，跳过录音流启动");
    }

    this.ttsEnabled = this.ttsService
      ? await this.ttsService.start()
      : false;
    if (!this.ttsEnabled && this.config.tts?.enabled) {
      console.log("Edge TTS 未启用，将使用小爱自带 TTS");
    }

    const haMonitor = new HomeAssistantMonitor(this.config.ha, (event) => {
      console.log("HA 状态变更", event?.event?.data?.entity_id ?? "");
    });
    await haMonitor.start();

    console.log("服务已启动...");
    OpenXiaoAIProtocol.registerCommand("get_version", async () => ({
      data: "nodejs",
    }));
    await OpenXiaoAIProtocol.start({
      onConnection: async () => this.onSpeakerConnected(),
      onEvent: (event) => {
        this.onEvent(event);
      },
      onStream: (stream) => {
        this.onStream(stream);
      },
    });
  }

  private enqueueNotification(text: string): Promise<void> {
    return new Promise((resolve, reject) => {
      this.queue = this.queue
        .then(async () => {
          try {
            await this.playResponse(text);
            resolve();
          } catch (err) {
            reject(err);
          }
        })
        .catch((err) => {
          console.log("通知播报失败", err?.message ?? err);
          reject(err);
        });
    });
  }

  private onInputData = (data: Uint8Array) => {
    if (!this.kwsEnabled) {
      return;
    }
    this.kws?.feedAudio(data);
  };

  private async onSpeakerConnected() {
    if (!this.kwsEnabled || !this.kws?.isActive()) {
      return;
    }
    await this.startRecordingWithRetry(3, 2000);
  }

  private async startRecordingWithRetry(
    maxRetries: number,
    delayMs: number
  ): Promise<boolean> {
    for (let i = 0; i < maxRetries; i++) {
      try {
        await OpenXiaoAIProtocol.callRemote("start_recording", {
          pcm: "plug:noop",
          channels: 1,
          bits_per_sample: 16,
          sample_rate: 16000,
          period_size: 360,
          buffer_size: 1440,
        });
        console.log("录音流已启动");
        return true;
      } catch (err) {
        console.log(
          `启动录音失败 (${i + 1}/${maxRetries})`,
          (err as Error)?.message ?? err
        );
        if (i < maxRetries - 1) {
          await this.sleep(delayMs);
        }
      }
    }
    console.log("录音流启动失败，服务端 KWS 不可用");
    return false;
  }

  private onKwsDetected = async (keyword: string) => {
    console.log("服务端 KWS 检测到唤醒词", keyword);
    if (this.isJarvisKeyword(keyword)) {
      try {
        await this.playResponse("我在");
        this.finishTtsStreaming();
        await this.sleep(800);
      } catch (err) {
        console.log(
          '服务端播报"我在"失败',
          (err as Error)?.message ?? err
        );
      }
    }
    this.pauseKwsForHold(this.config.wakeup.jarvisHoldMs + 2000);

    this.onEvent({ event: "kws", data: { Keyword: keyword } });

    try {
      await this.speaker.wakeUp(true, { silent: true });
    } catch (err) {
      console.log("唤醒音箱失败", (err as Error)?.message ?? err);
    }
  };

  private onStream = (stream: { tag: string; bytes: Uint8Array }) => {
    if (stream.tag === "record") {
      this.onInputData(stream.bytes);
    }
  };

  private onEvent = (event: { event: string; data?: any }) => {
    if (event.event === "playing") {
      this.speaker.status =
        event.data === "Playing"
          ? "playing"
          : event.data === "Paused"
          ? "paused"
          : "idle";
      if (this.speaker.status === "playing" && !this.isTtsStreaming) {
        this.kws?.pause();
      } else if (this.speaker.status === "idle") {
        this.finishTtsStreaming();
        this.tryResumeKws();
      }
      return;
    }

    if (event.event === "kws") {
      const keyword = this.getKwsKeyword(event.data);
      if (!keyword) {
        return;
      }

      if (this.isTtsStreaming && this.isBargeInKeyword(keyword)) {
        const now = Date.now();
        const cooldown = this.config.tts?.bargeInCooldownMs ?? 600;
        if (now - this.lastBargeInAt < cooldown) {
          return;
        }
        this.lastBargeInAt = now;
        console.log("TTS 播放被打断", keyword);
        this.finishTtsStreaming();
        void this.speaker.stopPlayStream();
        void this.speaker.wakeUp(true, { silent: true });
        return;
      }

      if (this.isJarvisKeyword(keyword)) {
        this.jarvisArmed = true;
        this.jarvisArmedAt = Date.now();
        console.log("唤醒词识别", keyword);
      }
      return;
    }

    if (event.event === "instruction" && event.data?.NewLine) {
      const line = this.safeJsonParse(event.data.NewLine);
      if (!line?.header || !line?.payload) {
        return;
      }

      if (
        line.header.namespace === "SpeechRecognizer" &&
        line.header.name === "RecognizeResult"
      ) {
        const text = line.payload?.results?.[0]?.text ?? "";
        console.log(`ASR: "${text}" (final=${line.payload?.is_final})`);
      }

      if (
        line.header.namespace === "SpeechRecognizer" &&
        line.header.name === "RecognizeResult" &&
        line.payload?.is_final &&
        line.payload?.results?.[0]?.text
      ) {
        const rawText = line.payload.results[0].text as string;
        this.enqueueTask(() => this.handleRecognizeText(rawText));
      }
    }
  };

  private enqueueTask(task: () => Promise<void>) {
    this.queue = this.queue.then(task).catch((err) => {
      console.log("处理失败", err?.message ?? err);
    });
  }

  private async handleRecognizeText(rawText: string) {
    this.kws?.pause();
    try {
      const now = Date.now();
      if (
        this.jarvisArmed &&
        now - this.jarvisArmedAt > this.config.wakeup.jarvisHoldMs
      ) {
        this.jarvisArmed = false;
      }

      const isJarvis =
        (this.jarvisArmed &&
          now - this.jarvisArmedAt <= this.config.wakeup.jarvisHoldMs) ||
        this.hasJarvisPrefix(rawText);

      if (isJarvis) {
        this.jarvisArmed = false;
      }

      const wakeWord: WakeWord = isJarvis ? "贾维斯" : "小爱同学";
      const text = this.normalizeText(rawText, wakeWord);
      if (!text) {
        return;
      }
      if (
        wakeWord === "小爱同学" &&
        now < this.jarvisFallbackSuppressUntil
      ) {
        console.log(`忽略贾维斯后的回落识别: ${text}`);
        return;
      }
      if (this.isDuplicateAsrRequest(wakeWord, text, now)) {
        console.log(`忽略重复识别: ${text}`);
        return;
      }
      this.lastHandledAsr = { wakeWord, text, at: now };
      if (wakeWord === "贾维斯") {
        this.jarvisFallbackSuppressUntil = now + 2000;
      }
      if (wakeWord === "贾维斯" && this.config.xiaoai.abortOnJarvis) {
        const aborted = await this.speaker.abortXiaoAI();
        if (aborted) {
          await this.sleep(300);
        }
      }

      const result = await this.gateway.handleRequest({
        wakeWord,
        text,
        source: "asr",
      });

      if (result.forwardToXiaoAI) {
        await this.speaker.askXiaoAI(text);
        return;
      }

      // 贾维斯路径返回空 text（异步 webhook），不需要本地播报
      if (!result.text) {
        return;
      }

      await this.playResponse(result.text);
    } finally {
      this.tryResumeKws();
    }
  }

  private async playResponse(text: string) {
    if (this.ttsEnabled && this.ttsService?.isReady()) {
      const audio = await this.ttsService.synthesize(text);
      if (audio) {
        const chunkMs = this.normalizeChunkMs(this.config.tts?.chunkMs);
        const bargeInEnabled = this.config.tts?.allowBargeIn ?? false;
        const initOk = await this.speaker.initPlayStream(audio.sampleRate);
        if (initOk) {
          if (bargeInEnabled) {
            this.startTtsStreaming(audio.durationMs);
          }
          const playOk = await this.speaker.playPcmStream(
            audio.pcmBytes,
            audio.sampleRate,
            chunkMs
          );
          if (playOk) {
            return;
          }
          if (bargeInEnabled) {
            this.finishTtsStreaming();
          }
        }
        console.log("Edge TTS 播放失败，回退到小爱 TTS");
      } else {
        console.log("Edge TTS 合成失败，回退到小爱 TTS");
      }
    }
    await this.speaker.play({ text });
  }

  private isJarvisKeyword(keyword: string) {
    return this.config.wakeup.jarvisKeywords.some((item) => item === keyword);
  }

  private isBargeInKeyword(keyword: string) {
    if (!this.config.tts?.allowBargeIn) {
      return false;
    }
    const words = this.config.tts.bargeInWakeWords ?? ["贾维斯", "小爱同学"];
    return words.some((w) => w === keyword);
  }

  private hasJarvisPrefix(text: string) {
    return this.config.wakeup.jarvisKeywords.some((item) =>
      text.startsWith(item)
    );
  }

  private normalizeText(text: string, wakeWord: WakeWord) {
    const cleaned = text.trim();
    if (!cleaned) {
      return "";
    }

    const prefixes =
      wakeWord === "贾维斯"
        ? this.config.wakeup.jarvisKeywords
        : ["小爱同学"];

    for (const prefix of prefixes) {
      if (cleaned.startsWith(prefix)) {
        return cleaned.slice(prefix.length).replace(/^[,，。.!?？\s]+/, "");
      }
    }

    return cleaned;
  }

  private getKwsKeyword(data: unknown) {
    if (!data) {
      return "";
    }
    if (typeof data === "string") {
      return data;
    }
    if (typeof data === "object" && data !== null) {
      const maybe = (data as Record<string, string>).Keyword;
      if (maybe) {
        return maybe;
      }
    }
    return "";
  }

  private safeJsonParse(text: unknown) {
    if (typeof text !== "string") {
      return text;
    }
    try {
      return JSON.parse(text);
    } catch (_) {
      return null;
    }
  }

  private sleep(ms: number) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  private normalizeChunkMs(chunkMs?: number) {
    const candidate = Math.floor(chunkMs ?? 60);
    if (!Number.isFinite(candidate) || candidate <= 0) {
      return 1;
    }
    return candidate;
  }

  private isDuplicateAsrRequest(
    wakeWord: WakeWord,
    text: string,
    now: number
  ) {
    if (!this.lastHandledAsr) {
      return false;
    }
    const dedupeWindowMs = 1500;
    if (now - this.lastHandledAsr.at > dedupeWindowMs) {
      return false;
    }
    if (this.lastHandledAsr.text !== text) {
      return false;
    }
    if (this.lastHandledAsr.wakeWord === wakeWord) {
      return true;
    }
    return (
      this.lastHandledAsr.wakeWord === "贾维斯" && wakeWord === "小爱同学"
    );
  }

  private startTtsStreaming(durationMs: number) {
    this.isTtsStreaming = true;
    const safeDurationMs = Number.isFinite(durationMs) && durationMs > 0 ? durationMs : 0;
    const timeoutMs = Math.max(1000, Math.ceil(safeDurationMs) + 800);
    if (this.ttsStreamingTimer) {
      clearTimeout(this.ttsStreamingTimer);
    }
    this.ttsStreamingTimer = setTimeout(() => {
      this.ttsStreamingTimer = null;
      this.finishTtsStreaming();
      this.tryResumeKws();
    }, timeoutMs);
  }

  private finishTtsStreaming() {
    this.isTtsStreaming = false;
    if (this.ttsStreamingTimer) {
      clearTimeout(this.ttsStreamingTimer);
      this.ttsStreamingTimer = null;
    }
  }

  private pauseKwsForHold(holdMs: number) {
    if (!this.kwsEnabled) {
      return;
    }
    const nextHoldUntil = Date.now() + holdMs;
    this.kwsHoldUntil = Math.max(this.kwsHoldUntil, nextHoldUntil);
    this.kws?.pause();
    this.scheduleKwsResumeCheck();
  }

  private tryResumeKws() {
    if (!this.kwsEnabled || !this.kws?.isActive()) {
      return;
    }
    if (this.speaker.status !== "idle") {
      return;
    }
    const remainingMs = this.kwsHoldUntil - Date.now();
    if (remainingMs > 0) {
      this.scheduleKwsResumeCheck();
      return;
    }
    this.kwsHoldUntil = 0;
    this.kws.resume();
  }

  private scheduleKwsResumeCheck() {
    if (!this.kwsEnabled) {
      return;
    }
    if (this.kwsResumeTimer) {
      clearTimeout(this.kwsResumeTimer);
    }
    const delayMs = Math.max(0, this.kwsHoldUntil - Date.now());
    this.kwsResumeTimer = setTimeout(() => {
      this.kwsResumeTimer = null;
      this.tryResumeKws();
    }, delayMs);
  }
}
