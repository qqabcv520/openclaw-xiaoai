# openclaw-xiaoai 执行计划

**状态：** 待批准

---

## 需求

### 目标
创建独立的 Node.js/TypeScript 项目，将小爱音箱 Pro (LX06) 注册为 OpenClaw 的聊天渠道，实现双向语音对话。

### 范围

**必须完成：**
- [ ] 桥接服务：WebSocket 连接小爱音箱，处理 ASR/TTS/KWS
- [ ] 桥接服务：将贾维斯唤醒词的 ASR 文本 POST 到 OpenClaw webhook
- [ ] 桥接服务：NotificationServer HTTP API 接收 OpenClaw 回复并 TTS 播报
- [ ] 桥接服务：小爱同学唤醒词走本地 HA 控制
- [ ] OpenClaw Channel Plugin：注册 xiaoai 渠道，sendText 投递到桥接服务
- [ ] Edge TTS + 语音打断支持
- [ ] 服务端 KWS 自定义唤醒词

**不在范围内：**
- 多音箱支持（先做单音箱）
- Web 管理界面
- 发布到 ClawHub
- 自动发现 HA 设备

### 验收标准
- [ ] 说"贾维斯，今天天气怎么样" → OpenClaw Agent 回答 → 小爱播报
- [ ] OpenClaw 从其他渠道（如 Telegram）发起"用小爱播报xxx" → 小爱播报
- [ ] 说"小爱同学，打开客厅灯" → 直接控制 HA → 小爱播报结果
- [ ] 多轮对话上下文由 OpenClaw 管理，连续提问有上下文

---

## 方案

### 概述

项目分两部分：
1. **桥接服务**（运行在 NAS 上）：连接小爱音箱（WS :4399）和 OpenClaw（HTTP webhook + notification）
2. **OpenClaw Channel Plugin**（运行在 OpenClaw Gateway 中）：注册 `xiaoai` 渠道

与参考项目的关键差异：移除 `OpenClawClient`（直调 API）和 `ContextStore`（本地上下文），改为通过 webhook + Channel Plugin 实现，会话管理交给 OpenClaw。

### 架构

```
OpenClaw Gateway
    │
    ├── xiaoai Channel Plugin
    │   outbound.sendText() → POST :4400/notify
    │
    ├── Webhook /hooks/xiaoai (接收 ASR 文本)
    │
    ↕ HTTP
    │
桥接服务 (openclaw-xiaoai)
    ├── NotificationServer (:4400) ← 接收 Plugin 推送 → TTS 播报
    ├── Gateway → 贾维斯: POST /hooks/xiaoai
    │           → 小爱同学: LocalHandler → HA
    ├── ProtocolServer (WS :4399) ← 与小爱通信
    ├── KWS / TTS / Speaker
    └── HA Controller + Monitor

WebSocket :4399
    │
小爱音箱 Pro (LX06)
```

### 数据流

**路径 A — 语音问答（贾维斯）：**
```
小爱 ASR → 桥接服务 Gateway
  → POST /hooks/xiaoai → OpenClaw Agent 处理
  → deliver channel=xiaoai → Plugin sendText()
  → POST :4400/notify → 桥接服务 TTS → 小爱播报
```

**路径 B — 本地智能家居（小爱同学）：**
```
小爱 ASR → 桥接服务 Gateway
  → LocalHandler → HA REST API → 桥接服务 TTS → 小爱播报
```

**路径 C — 主动通知（OpenClaw → 小爱）：**
```
OpenClaw Agent (heartbeat/定时/其他渠道)
  → deliver channel=xiaoai → Plugin sendText()
  → POST :4400/notify → 桥接服务 TTS → 小爱播报
```

### 项目结构

```
openclaw-xiaoai/
├── package.json
├── tsconfig.json
├── config.ts                        # 用户配置
├── openclaw.json                    # OpenClaw Gateway 配置参考
├── src/
│   ├── index.ts                     # 入口
│   ├── xiaoai-app.ts                # 主应用（改造）
│   ├── gateway.ts                   # 路由网关（改造）
│   ├── notification-server.ts       # 新建：HTTP :4400
│   ├── types.ts                     # 类型定义（改造）
│   ├── local-handler.ts             # 复用
│   ├── ha-controller.ts             # 复用
│   ├── ha-monitor.ts                # 复用
│   ├── speaker.ts                   # 复用
│   ├── tts.ts                       # 复用
│   ├── kws.ts                       # 复用
│   ├── open-xiaoai.ts               # 复用
│   └── protocol/
│       ├── server.ts                # 复用
│       ├── codec.ts                 # 复用
│       └── types.ts                 # 复用
├── plugin/
│   ├── package.json                 # Plugin 包描述
│   └── index.ts                     # OpenClaw Channel Plugin
└── models/                          # KWS 模型文件
```

### 执行步骤

#### 步骤 1：项目脚手架

**任务 1.1：初始化项目**
- 文件：`package.json`
- 操作：新建
- 详情：type=module，依赖 ws/node-edge-tts/sherpa-onnx-node/@mi-gpt/utils，dev 依赖 tsx/typescript/@types/node

**任务 1.2：TypeScript 配置**
- 文件：`tsconfig.json`
- 操作：新建
- 详情：target ES2022，module ESNext，moduleResolution bundler，strict true

**任务 1.3：Git 初始化**
- 操作：git init，创建 .gitignore（node_modules/dist/.env/models/*.onnx/server.log/.pid）

#### 步骤 2：类型定义

**任务 2.1：类型改造**
- 文件：`src/types.ts`
- 操作：基于参考项目改造
- 详情：
  - 移除 `OpenClawHttpConfig` 和 `ContextConfig`
  - 新增 `WebhookConfig`（url, token, timeoutMs）
  - 新增 `NotificationConfig`（port, host, token）
  - 主接口改名为 `AppConfig`，用 webhook/notification 替代 openclaw/context

#### 步骤 3：协议层复制

**任务 3.1：协议文件复制**
- 文件：`src/protocol/server.ts`、`src/protocol/codec.ts`、`src/protocol/types.ts`、`src/open-xiaoai.ts`
- 操作：从参考项目原样复制
- 详情：无需任何改动

#### 步骤 4：核心服务层复制

**任务 4.1：音箱和 HA 模块复制**
- 文件：`src/speaker.ts`、`src/ha-controller.ts`、`src/ha-monitor.ts`、`src/local-handler.ts`、`src/tts.ts`、`src/kws.ts`
- 操作：从参考项目复制
- 详情：仅 local-handler.ts 需将配置类型从 OpenClawConfig 改为 AppConfig

#### 步骤 5：NotificationServer

**任务 5.1：通知 HTTP 服务器**
- 文件：`src/notification-server.ts`
- 操作：新建
- 详情：
  - 使用 Node.js 原生 http.createServer，无额外依赖
  - POST /notify 端点，接收 `{ text: string }` JSON body
  - 支持 x-openclaw-token 和 Authorization: Bearer 两种认证方式
  - 先返回 200 再异步调用 onNotify 回调播报
  - GET /health 健康检查端点

#### 步骤 6：Gateway 路由改造

**任务 6.1：网关改造**
- 文件：`src/gateway.ts`
- 操作：基于参考项目大幅改造
- 详情：
  - 移除 ContextStore 和 OpenClawClient 依赖
  - 小爱同学路径：保持不变，走 LocalHandler
  - 贾维斯路径：改为 postToWebhook()，POST 到 OpenClaw /hooks/xiaoai
  - webhook body 格式：`{ message, sessionKey: "hook:xiaoai", deliver: true, channel: "xiaoai" }`
  - 返回空 text，实际响应通过 NotificationServer 异步送达

#### 步骤 7：主应用集成

**任务 7.1：主应用类改造**
- 文件：`src/xiaoai-app.ts`
- 操作：基于参考项目 xiaoai.ts 改造
- 详情：
  - 移除 ContextStore 和 OpenClawClient 初始化
  - 新增 NotificationServer 创建，onNotify 回调指向 playResponse()
  - start() 中启动 NotificationServer
  - handleRecognizeText 中：贾维斯路径返回空 text 时跳过播报（等异步回调）

**任务 7.2：入口文件**
- 文件：`src/index.ts`
- 操作：新建
- 详情：导入 config，创建 XiaoAiApp 并启动

**任务 7.3：用户配置**
- 文件：`config.ts`
- 操作：基于参考项目改造
- 详情：移除 openclaw/context 字段，新增 webhook/notification 字段

#### 步骤 8：OpenClaw Channel Plugin

**任务 8.1：Plugin 包描述**
- 文件：`plugin/package.json`
- 操作：新建
- 详情：name=openclaw-channel-xiaoai，main=index.ts

**任务 8.2：Plugin 实现**
- 文件：`plugin/index.ts`
- 操作：新建
- 详情：
  - 定义 xiaoai channel：id, meta, capabilities, config, outbound
  - outbound.sendText：POST 到桥接服务 /notify 端点
  - export default register(api) 调用 api.registerChannel()

**任务 8.3：OpenClaw 配置参考**
- 文件：`openclaw.json`
- 操作：新建
- 详情：
  - hooks 配置：enabled, token, defaultSessionKey=hook:xiaoai
  - channels.xiaoai 配置：bridgeUrl, token
  - plugins.load.paths 指向 plugin/ 目录

#### 步骤 9：部署与文档

**任务 9.1：Systemd 服务文件**
- 文件：`openclaw.service`
- 操作：新建

**任务 9.2：README**
- 文件：`README.md`
- 操作：新建
- 详情：安装步骤、配置说明、Token 对齐清单

**任务 9.3：验证**
- 操作：pnpm exec tsc --noEmit 验证编译
- 详情：确保所有类型正确

### 步骤依赖

| 步骤 | 依赖 | 说明 |
|------|------|------|
| 步骤 1 | - | 无依赖，立即执行 |
| 步骤 2 | 步骤 1 | 需要 package.json 和 tsconfig |
| 步骤 3 | 步骤 2 | 需要 types.ts |
| 步骤 4 | 步骤 2 | 需要 types.ts，可与步骤 3 并行 |
| 步骤 5 | 步骤 2 | 需要 types.ts，可与步骤 3/4 并行 |
| 步骤 6 | 步骤 2, 4 | 需要 types.ts 和 local-handler |
| 步骤 7 | 步骤 3, 4, 5, 6 | 需要所有服务层模块 |
| 步骤 8 | 步骤 1 | 仅需 package.json，可与步骤 2-7 完全并行 |
| 步骤 9 | 步骤 7, 8 | 需要所有代码完成 |

### 注意事项

- **Token 对齐**：两对 token 必须在桥接服务 config.ts 和 openclaw.json 中一致
  - `webhook.token` = `hooks.token`（桥接服务 → OpenClaw）
  - `notification.token` = `channels.xiaoai.token`（OpenClaw → 桥接服务）
- **被移除的模块**：`openclaw-client.ts` 和 `context-store.ts` 不再需要，会话管理由 OpenClaw sessionKey 处理
- **异步响应模式**：贾维斯路径是异步的（POST webhook → Agent 处理 → Plugin sendText → NotificationServer），handleRecognizeText 不再同步等待回复
- **KWS 模型文件**：不在 git 中，需单独 scp 同步到部署机器
- **安全**：仅限局域网使用，未做公网安全加固
