# openclaw-xiaoai

小爱音箱 Pro (LX06) ↔ OpenClaw 双向语音桥接服务 + Channel Plugin。

## 架构

```
OpenClaw Gateway
    ├── xiaoai Channel Plugin
    │   inbound: /channels/xiaoai/inbound → dispatch → deliver
    │   outbound: sendText() → POST :4400/notify
    ↕ HTTP
桥接服务 (本项目)
    ├── NotificationServer (:4400) ← 接收 Plugin 推送 → TTS 播报
    ├── Gateway → 贾维斯: POST /channels/xiaoai/inbound
    ├── ProtocolServer (WS :4399) ← 与小爱通信
    └── KWS / TTS / Speaker
    ↕ WebSocket :4399
小爱音箱 Pro (LX06)
```

### 数据流

- **"贾维斯"** → ASR → POST /channels/xiaoai/inbound → Plugin dispatch → Agent → deliver → POST :4400/notify → TTS 播报
- **"小爱同学"** → 原生管线自然处理，本项目不介入
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
  gateway: {
    url: "http://localhost:18789",           // OpenClaw Gateway 基础 URL
    token: "your-gateway-token-here",        // 与 openclaw.json channels.xiaoai.token 一致
    timeoutMs: 10000,
  },
  notification: {
    port: 4400,
    host: "0.0.0.0",
    token: "your-notification-token-here",   // 与 openclaw.json channels.xiaoai.token 一致
  },
  // ...其他配置
};
```

### Token 对齐清单

桥接服务和 OpenClaw 配置中的 token 需保持一致：

| Token | 桥接服务 (config.ts) | OpenClaw (openclaw.json) |
|-------|---------------------|--------------------------|
| Gateway | `gateway.token` | `channels.xiaoai.accounts.default.token` |
| Notification | `notification.token` | `channels.xiaoai.accounts.default.token` |

### OpenClaw 侧配置

将 `plugin/` 目录部署到 OpenClaw Gateway 可访问的路径，并在 `openclaw.json` 中配置：

```json
{
  "channels": {
    "xiaoai": {
      "accounts": {
        "default": {
          "bridgeUrl": "http://192.168.1.42:4400",
          "token": "your-token-here",
          "enabled": true
        }
      }
    }
  },
  "plugins": {
    "load": {
      "paths": ["./plugin"]
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
- OpenClaw Gateway 实例
