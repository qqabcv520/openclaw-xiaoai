import type { AppConfig } from "./types.js";
import type { HomeAssistantController } from "./ha-controller.js";

export interface LocalHandleResult {
  handled: boolean;
  text: string;
}

export class LocalHandler {
  private config: AppConfig;
  private ha: HomeAssistantController;

  constructor(config: AppConfig, ha: HomeAssistantController) {
    this.config = config;
    this.ha = ha;
  }

  async process(text: string): Promise<LocalHandleResult> {
    const trimmed = text.trim();
    if (!trimmed) {
      return { handled: false, text: "" };
    }

    const onWords = ["打开", "开启", "开"];
    const offWords = ["关闭", "关掉", "关"];

    const light = this.matchDevice(trimmed, this.config.devices.lights);
    if (light) {
      if (this.includesAny(trimmed, onWords)) {
        const ok = await this.ha.lightOn(light.entityId);
        return {
          handled: true,
          text: ok ? `好的，已打开${light.name}` : `打开${light.name}失败`,
        };
      }
      if (this.includesAny(trimmed, offWords)) {
        const ok = await this.ha.lightOff(light.entityId);
        return {
          handled: true,
          text: ok ? `好的，已关闭${light.name}` : `关闭${light.name}失败`,
        };
      }
    }

    const sw = this.matchDevice(trimmed, this.config.devices.switches);
    if (sw) {
      if (this.includesAny(trimmed, onWords)) {
        const ok = await this.ha.switchOn(sw.entityId);
        return {
          handled: true,
          text: ok ? `好的，已打开${sw.name}` : `打开${sw.name}失败`,
        };
      }
      if (this.includesAny(trimmed, offWords)) {
        const ok = await this.ha.switchOff(sw.entityId);
        return {
          handled: true,
          text: ok ? `好的，已关闭${sw.name}` : `关闭${sw.name}失败`,
        };
      }
    }

    const climate = this.matchDevice(trimmed, this.config.devices.climates);
    if (climate) {
      if (this.includesAny(trimmed, onWords)) {
        const ok = await this.ha.callService("climate", "turn_on", {
          entity_id: climate.entityId,
        });
        return {
          handled: true,
          text: ok ? `好的，已打开${climate.name}` : `打开${climate.name}失败`,
        };
      }
      if (this.includesAny(trimmed, offWords)) {
        const ok = await this.ha.callService("climate", "turn_off", {
          entity_id: climate.entityId,
        });
        return {
          handled: true,
          text: ok ? `好的，已关闭${climate.name}` : `关闭${climate.name}失败`,
        };
      }
      const temp = this.parseTemperature(trimmed);
      if (temp !== null) {
        const ok = await this.ha.climateSetTemperature(climate.entityId, temp);
        return {
          handled: true,
          text: ok
            ? `好的，已将${climate.name}设置为${temp}度`
            : `${climate.name}温度设置失败`,
        };
      }
    }

    return { handled: false, text: "" };
  }

  private includesAny(text: string, words: string[]) {
    return words.some((word) => text.includes(word));
  }

  private matchDevice(text: string, mapping: Record<string, string>) {
    for (const [name, entityId] of Object.entries(mapping)) {
      if (name && text.includes(name)) {
        return { name, entityId };
      }
    }
    return null;
  }

  private parseTemperature(text: string) {
    const match = text.match(/(\d+(?:\.\d+)?)\s*度/);
    if (!match) {
      return null;
    }
    const matched = match[1];
    if (!matched) {
      return null;
    }
    const value = Number.parseFloat(matched);
    if (Number.isNaN(value)) {
      return null;
    }
    return value;
  }
}
