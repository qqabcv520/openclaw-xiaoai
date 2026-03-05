import { describe, it, expect, vi, beforeEach } from "vitest";
import { UnifiedGateway } from "@/gateway.js";
import type { AppConfig } from "@/types.js";

const mockConfig = {
  webhook: {
    url: "http://localhost:18789/hooks/xiaoai",
    token: "test-token",
    timeoutMs: 5000,
  },
  local: {
    forwardToXiaoAIOnFallback: false,
  },
} as AppConfig;

describe("UnifiedGateway", () => {
  let gateway: UnifiedGateway;
  const mockLocalHandler = {
    process: vi.fn(),
  };

  beforeEach(() => {
    vi.restoreAllMocks();
    gateway = new UnifiedGateway({
      config: mockConfig,
      localHandler: mockLocalHandler as any,
    });
  });

  it("小爱同学唤醒词走 LocalHandler", async () => {
    mockLocalHandler.process.mockResolvedValue({
      handled: true,
      text: "已打开客厅灯",
    });

    const result = await gateway.handleRequest({
      wakeWord: "小爱同学",
      text: "打开客厅灯",
      source: "asr",
    });

    expect(result.handler).toBe("local");
    expect(result.text).toBe("已打开客厅灯");
    expect(mockLocalHandler.process).toHaveBeenCalledWith("打开客厅灯");
  });

  it("小爱同学未匹配本地指令时返回提示", async () => {
    mockLocalHandler.process.mockResolvedValue({ handled: false, text: "" });

    const result = await gateway.handleRequest({
      wakeWord: "小爱同学",
      text: "今天天气怎么样",
      source: "asr",
    });

    expect(result.handler).toBe("local");
    expect(result.text).toContain("贾维斯");
  });

  it("贾维斯唤醒词走 webhook", async () => {
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
