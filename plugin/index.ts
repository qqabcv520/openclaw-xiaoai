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

      await postToBridge(account, text);
    },
  },
};

async function postToBridge(
  account: XiaoAiAccountConfig,
  text: string,
): Promise<void> {
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
}

function registerInboundRoute(api: ChannelApi): void {
  api.registerHttpRoute({
    path: "/channels/xiaoai/inbound",
    auth: "plugin",
    handler: async (req, res) => {
      try {
        // 验证 token
        const token =
          (req.headers as Record<string, string | undefined>)[
            "x-openclaw-token"
          ] ?? "";
        const account = xiaoaiChannel.config!.resolveAccount(
          api.config,
        ) as XiaoAiAccountConfig | undefined;
        if (!account || token !== account.token) {
          res.statusCode = 401;
          res.end(JSON.stringify({ error: "unauthorized" }));
          return true;
        }

        // 解析请求体
        const chunks: Buffer[] = [];
        for await (const chunk of req) {
          chunks.push(chunk as Buffer);
        }
        const body = JSON.parse(Buffer.concat(chunks).toString());
        const message = body.message as string;
        if (!message) {
          res.statusCode = 400;
          res.end(JSON.stringify({ error: "missing message" }));
          return true;
        }

        // 立即返回 200，后续异步 dispatch
        res.statusCode = 200;
        res.end(JSON.stringify({ ok: true }));

        // 异步 dispatch 到 Agent
        const rt = (api as any).runtime;
        const cfg = api.config;

        const route = rt.channel.routing.resolveAgentRoute({
          cfg,
          channel: "xiaoai",
          accountId: "default",
          peer: { kind: "direct", id: "speaker" },
        });

        const storePath = rt.channel.session.resolveStorePath(
          cfg.session?.store,
          { agentId: route.agentId },
        );

        const ctx = rt.channel.reply.finalizeInboundContext({
          Body: message,
          RawBody: message,
          CommandBody: message,
          From: "xiaoai:speaker",
          To: "xiaoai:speaker",
          SessionKey: route.sessionKey,
          AccountId: "default",
          ChatType: "direct",
          ConversationLabel: "XiaoAi Speaker",
          SenderName: "XiaoAi",
          SenderId: "speaker",
          Provider: "xiaoai",
          Surface: "xiaoai",
          MessageSid: `xiaoai-${Date.now()}`,
          OriginatingChannel: "xiaoai",
          OriginatingTo: "xiaoai:speaker",
        });

        await rt.channel.session.recordInboundSession({
          storePath,
          sessionKey: ctx.SessionKey || route.sessionKey,
          ctx,
        });

        await rt.channel.reply.dispatchReplyWithBufferedBlockDispatcher({
          ctx,
          cfg,
          dispatcherOptions: {
            deliver: async (payload: any) => {
              const text = payload.text;
              if (!text) return;
              try {
                await postToBridge(account, text);
              } catch (err) {
                console.log(
                  "xiaoai channel: deliver failed",
                  (err as Error)?.message ?? err,
                );
              }
            },
            onError: (err: unknown) => {
              console.log(
                "xiaoai channel: dispatch error",
                (err as Error)?.message ?? err,
              );
            },
          },
        });
      } catch (err) {
        console.log(
          "xiaoai channel: inbound handler error",
          (err as Error)?.message ?? err,
        );
        if (!res.writableEnded) {
          res.statusCode = 500;
          res.end(JSON.stringify({ error: "internal error" }));
        }
      }
      return true;
    },
  });
}

export default function register(api: ChannelApi) {
  api.registerChannel({ plugin: xiaoaiChannel });
  registerInboundRoute(api);
}
