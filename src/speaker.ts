import { jsonEncode } from "@mi-gpt/utils/parse";
import { OpenXiaoAIProtocol } from "./open-xiaoai.js";

function shellEscape(s: string): string {
  return "'" + s.replace(/'/g, "'\\''") + "'";
}

export interface CommandResult {
  stdout: string;
  stderr: string;
  exit_code: number;
}

class SpeakerManager {
  status: "playing" | "paused" | "idle" = "idle";
  private currentPlaySampleRate = 0;

  async play({
    text,
    url,
    bytes,
    timeout = 10 * 60 * 1000,
    blocking = false,
  }: {
    text?: string;
    url?: string;
    bytes?: Uint8Array;
    timeout?: number;
    blocking?: boolean;
  }) {
    if (bytes) {
      try {
        OpenXiaoAIProtocol.sendStream("play", bytes);
        return true;
      } catch (_) {
        return false;
      }
    }

    if (blocking) {
      const res = await this.runShell(
        url
          ? `miplayer -f ${shellEscape(url)}`
          : `/usr/sbin/tts_play.sh ${shellEscape(text || "你好")}`,
        { timeout }
      );
      return res?.exit_code === 0;
    }

    const res = await this.runShell(
      url
        ? `ubus call mediaplayer player_play_url '${jsonEncode({
            url: url,
            type: 1,
          })}'`
        : `ubus call mibrain text_to_speech '${jsonEncode({
            text: text || "你好",
            save: 0,
          })}'`,
      { timeout }
    );
    return res?.stdout.includes('"code": 0') ?? false;
  }

  async askXiaoAI(text: string, options?: { silent: boolean }) {
    const { silent = false } = options ?? {};
    const res = await this.runShell(
      `ubus call mibrain ai_service '${jsonEncode({
        tts: silent ? undefined : 1,
        nlp: 1,
        nlp_text: text,
      })}'`
    );
    return res?.stdout.includes('"code": 0') ?? false;
  }

  async abortXiaoAI() {
    const res = await this.runShell(
      "/etc/init.d/mico_aivs_lab restart >/dev/null 2>&1"
    );
    return res?.exit_code === 0;
  }

  async wakeUp(awake = true, options?: { silent: boolean }) {
    const { silent = true } = options ?? {};
    const command = awake
      ? silent
        ? `ubus call pnshelper event_notify '{"src":1,"event":0}'`
        : `ubus call pnshelper event_notify '{"src":0,"event":0}'`
      : `
        ubus call pnshelper event_notify '{"src":3, "event":7}'
        sleep 0.1
        ubus call pnshelper event_notify '{"src":3, "event":8}'
    `;
    const res = await this.runShell(command);
    const ok = res?.stdout.includes('"code": 0');
    if (!ok) {
      console.log("wakeUp 响应异常", JSON.stringify(res));
    }
    return ok;
  }

  async runShell(
    script: string,
    options?: {
      timeout?: number;
    }
  ): Promise<CommandResult | undefined> {
    const { timeout = 10 * 1000 } = options ?? {};
    try {
      const res = await OpenXiaoAIProtocol.callRemote(
        "run_shell",
        script,
        timeout
      );
      if (res?.data) {
        return res.data as CommandResult;
      }
    } catch (_) {
      return undefined;
    }
  }

  async initPlayStream(sampleRate: number): Promise<boolean> {
    if (this.currentPlaySampleRate === sampleRate) {
      return true;
    }
    try {
      await OpenXiaoAIProtocol.callRemote("start_play", {
        pcm: "default",
        channels: 1,
        bits_per_sample: 16,
        sample_rate: sampleRate,
      });
      this.currentPlaySampleRate = sampleRate;
      console.log(`播放流已初始化，采样率=${sampleRate}`);
      return true;
    } catch (err) {
      console.log(
        "start_play 失败",
        (err as Error)?.message ?? err
      );
      return false;
    }
  }

  async playPcmStream(
    bytes: Uint8Array,
    sampleRate: number,
    chunkMs: number
  ): Promise<boolean> {
    try {
      const rawBytesPerChunk = Math.floor(sampleRate * 2 * (chunkMs / 1000));
      const bytesPerChunk = Math.max(1, rawBytesPerChunk);
      for (let offset = 0; offset < bytes.length; offset += bytesPerChunk) {
        const chunk = bytes.subarray(offset, offset + bytesPerChunk);
        OpenXiaoAIProtocol.sendStream("play", chunk);
      }
      return true;
    } catch (err) {
      console.log(
        "音频流发送失败",
        (err as Error)?.message ?? err
      );
      return false;
    }
  }

  async stopPlayStream(): Promise<boolean> {
    try {
      await OpenXiaoAIProtocol.callRemote("stop_play");
      this.currentPlaySampleRate = 0;
      return true;
    } catch (err) {
      console.log(
        "stop_play 失败",
        (err as Error)?.message ?? err
      );
      return false;
    }
  }
}

export const OpenXiaoAISpeaker = new SpeakerManager();
