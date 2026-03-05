// 为所有日志添加时间戳
const _log = console.log;
console.log = (...args: unknown[]) => {
  const ts = new Date().toLocaleString("zh-CN", { hour12: false });
  _log(`[${ts}]`, ...args);
};

import { kAppConfig } from "../config.js";
import { XiaoAiApp } from "./xiaoai-app.js";

async function main() {
  const app = new XiaoAiApp(kAppConfig);
  await app.start();
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
