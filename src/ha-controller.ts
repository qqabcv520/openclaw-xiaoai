import type { HomeAssistantConfig } from "./types.js";

export class HomeAssistantController {
  private config: HomeAssistantConfig;

  constructor(config: HomeAssistantConfig) {
    this.config = config;
  }

  async callService(
    domain: string,
    service: string,
    data: Record<string, unknown>
  ) {
    const url = this.normalizeUrl(
      this.config.baseURL,
      `/api/services/${domain}/${service}`
    );
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${this.config.token}`,
      },
      body: JSON.stringify(data),
    });
    return res.ok;
  }

  async lightOn(entityId: string, brightness?: number) {
    return this.callService("light", "turn_on", {
      entity_id: entityId,
      ...(brightness ? { brightness } : {}),
    });
  }

  async lightOff(entityId: string) {
    return this.callService("light", "turn_off", { entity_id: entityId });
  }

  async switchOn(entityId: string) {
    return this.callService("switch", "turn_on", { entity_id: entityId });
  }

  async switchOff(entityId: string) {
    return this.callService("switch", "turn_off", { entity_id: entityId });
  }

  async climateSetTemperature(entityId: string, temperature: number) {
    return this.callService("climate", "set_temperature", {
      entity_id: entityId,
      temperature,
    });
  }

  private normalizeUrl(baseURL: string, endpoint: string) {
    const trimmedBase = baseURL.replace(/\/+$/, "");
    const trimmedEndpoint = endpoint.startsWith("/")
      ? endpoint
      : `/${endpoint}`;
    return `${trimmedBase}${trimmedEndpoint}`;
  }
}
