import { describe, it, expect, vi, beforeEach } from "vitest";
import { UnifiedGateway } from "@/gateway.js";
import type { AppConfig } from "@/types.js";

const mockConfig = {
  gateway: {
    url: "http://localhost:18789",
    token: "test-token",
    timeoutMs: 5000,
  },
} as AppConfig;

describe("UnifiedGateway", () => {
  let gateway: UnifiedGateway;

  beforeEach(() => {
    vi.restoreAllMocks();
    gateway = new UnifiedGateway({ config: mockConfig });
  });

  it("贾维斯唤醒词走 channel inbound", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({ ok: true, text: () => Promise.resolve("") })
    );

    const result = await gateway.handleRequest({
      wakeWord: "贾维斯",
      text: "今天天气怎么样",
      source: "asr",
    });

    expect(result.handler).toBe("openclaw");
    expect(result.text).toBe("");

    vi.unstubAllGlobals();
  });

  it("未知唤醒词返回 unknown", async () => {
    const result = await gateway.handleRequest({
      wakeWord: "未知" as any,
      text: "test",
      source: "asr",
    });

    expect(result.handler).toBe("unknown");
  });
});
