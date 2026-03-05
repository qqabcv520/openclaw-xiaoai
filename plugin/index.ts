import type { ChannelPlugin, ChannelApi } from "openclaw";

interface XiaoAiAccountConfig {
  bridgeUrl: string;
  token: string;
  enabled?: boolean;
}

const xiaoaiChannel: ChannelPlugin<XiaoAiAccountConfig> = {
  id: "xiaoai",

  meta: {
    label: "XiaoAi Speaker",
    selectionLabel: "XiaoAi Speaker (小爱音箱)",
    blurb: "通过小爱音箱进行语音对话。",
  },

  capabilities: {
    chatTypes: ["direct"],
  },

  config: {
    resolveAccount(cfg) {
      const channelCfg = cfg.channels?.xiaoai;
      if (!channelCfg?.accounts) return undefined;
      const account = Object.values(channelCfg.accounts).find(
        (a: any) => a.enabled !== false,
      ) as XiaoAiAccountConfig | undefined;
      return account;
    },
  },

  outbound: {
    async sendText(ctx, text) {
      const account = ctx.account as XiaoAiAccountConfig;
      if (!account?.bridgeUrl) {
        throw new Error(
          "xiaoai channel: bridgeUrl not configured in channels.xiaoai",
        );
      }

      const url = `${account.bridgeUrl.replace(/\/+$/, "")}/notify`;

      const res = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-openclaw-token": account.token ?? "",
        },
        body: JSON.stringify({ text }),
      });

      if (!res.ok) {
        throw new Error(
          `xiaoai channel: POST ${url} failed with status ${res.status}`,
        );
      }
    },
  },
};

export default function register(api: ChannelApi) {
  api.registerChannel({ plugin: xiaoaiChannel });
}
