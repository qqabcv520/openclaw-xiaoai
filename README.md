# openclaw-xiaoai

小爱音箱 Pro (LX06) ↔ OpenClaw 双向语音桥接服务 + Channel Plugin。

## 架构

```
OpenClaw Gateway
    ├── xiaoai Channel Plugin
    │   outbound.sendText() → POST :4400/notify
    ├── Webhook /hooks/xiaoai (接收 ASR 文本)
    ↕ HTTP
桥接服务 (本项目)
    ├── NotificationServer (:4400) ← 接收 Plugin 推送 → TTS 播报
    ├── Gateway → 贾维斯: POST /hooks/xiaoai
    │           → 小爱同学: LocalHandler → HA
    ├── ProtocolServer (WS :4399) ← 与小爱通信
    ├── KWS / TTS / Speaker
    └── HA Controller + Monitor
    ↕ WebSocket :4399
小爱音箱 Pro (LX06)
```

### 数据流

- **"贾维斯"** → ASR → POST webhook → OpenClaw Agent → Plugin sendText → POST :4400/notify → TTS 播报
- **"小爱同学"** → ASR → LocalHandler → HA REST API → TTS 播报
- **主动通知** → OpenClaw Agent → Plugin sendText → POST :4400/notify → TTS 播报

## 安装

```bash
# 克隆项目
git clone <repo-url>
cd openclaw-xiaoai

# 安装依赖
pnpm install

# 复制 KWS 模型文件到 models/ 目录（需要单独获取）
```

## 配置

编辑 `config.ts`，填写以下关键配置：

```typescript
export const kAppConfig: AppConfig = {
  webhook: {
    url: "http://localhost:18789/hooks/xiaoai",  // OpenClaw webhook 地址
    token: "your-webhook-token-here",             // 与 openclaw.json hooks.token 一致
    timeoutMs: 10000,
  },
  notification: {
    port: 4400,
    host: "0.0.0.0",
    token: "your-notification-token-here",        // 与 openclaw.json channels.xiaoai.token 一致
  },
  ha: {
    baseURL: "http://192.168.1.43:8123",          // Home Assistant 地址
    token: "your-ha-token",                        // HA 长期访问令牌
  },
  // ...其他配置
};
```

### Token 对齐清单

两对 token 必须在桥接服务和 OpenClaw 配置中保持一致：

| Token | 桥接服务 (config.ts) | OpenClaw (openclaw.json) |
|-------|---------------------|--------------------------|
| Webhook | `webhook.token` | `hooks.token` |
| Notification | `notification.token` | `channels.xiaoai.token` |

### OpenClaw 侧配置

将 `plugin/` 目录部署到 OpenClaw Gateway 可访问的路径，并在 `openclaw.json` 中配置：

```json
{
  "hooks": {
    "enabled": true,
    "token": "your-webhook-token-here",
    "mappings": {
      "xiaoai": { "defaultSessionKey": "hook:xiaoai" }
    }
  },
  "channels": {
    "xiaoai": {
      "bridgeUrl": "http://192.168.1.42:4400",
      "token": "your-notification-token-here"
    }
  },
  "plugins": {
    "load": {
      "paths": ["./plugins/openclaw-channel-xiaoai"]
    }
  }
}
```

## 运行

```bash
# 开发模式
pnpm dev

# 后台运行
pnpm serve

# 查看状态
pnpm serve:status

# 查看日志
pnpm serve:log

# 停止
pnpm serve:stop
```

### Systemd 部署（Linux）

```bash
# 编辑 openclaw.service 中的路径
# 安装服务
pnpm serve:install

# 启动
sudo systemctl start openclaw

# 查看日志
sudo journalctl -u openclaw -f
```

## 前置条件

- Node.js >= 18
- 小爱音箱 Pro (LX06) 已刷入 open-xiaoai Rust patch
- Home Assistant 实例（可选，用于智能家居控制）
- OpenClaw Gateway 实例
