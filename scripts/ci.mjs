/**
 * 本地复现 CI：按 .github/workflows/ci.yml 的顺序跑一遍，
 * 并把环境"降级成干净 runner"——找不到 DSH 安装、找不到真实 React。
 *
 * 目的：避免"本机绿、CI 红"。本机有 DSH 时，脚本会自动用真实 React 与组合链检查；
 * 这里强制走它们在没有 DSH 时的分支。
 *
 * 运行：node scripts/ci.mjs
 */

import { spawnSync } from "node:child_process"
import { join } from "node:path"
import { fileURLToPath } from "node:url"

const root = fileURLToPath(new URL("..", import.meta.url))
const env = {
  ...process.env,
  // 指向不存在的目录：模拟没有 DSH 的 Linux runner
  DSH_APP_DIR: join(root, ".ci-no-dsh"),
  DSH_PROFILE_DIR: join(root, ".ci-no-profile"),
}

const steps = [
  ["语法：浏览器半边", "node", ["--check", "lib/client.js"]],
  ["语法：宿主半边", "node", ["--check", "lib/index.js"]],
  ["冒烟：模块格式 / 注入清单 / 本地存储 / 删除与清空", "node", ["scripts/smoke.mjs"]],
  ["流程：建会话 → 提问 → 流式读取 → 落库 → 子节点", "node", ["scripts/flow-test.mjs"]],
  ["发布面：files / exports / dsh 清单 / bundle 身份", "node", ["scripts/pack-check.mjs"]],
  ["组合链（无 DSH 时应跳过）", "node", ["scripts/verify-composition.mjs"]],
  ["宿主半边（未安装时应跳过）", "node", ["scripts/host-smoke.mjs"]],
]

let failed = 0
for (const [label, command, args] of steps) {
  const result = spawnSync(command, args, { cwd: root, env, encoding: "utf8" })
  const output = `${result.stdout ?? ""}${result.stderr ?? ""}`.trim()
  const ok = result.status === 0
  if (ok === false) failed += 1
  console.log(`${ok ? "✓" : "✗"} ${label}`)
  for (const line of output.split("\n").slice(-4)) {
    if (line.trim() !== "") console.log(`    ${line.trim().slice(0, 160)}`)
  }
}

if (failed > 0) {
  console.error(`\nCI 会失败：${failed} 个步骤未通过`)
  process.exit(1)
}
console.log("\nCI 等价检查全部通过（模拟了没有 DSH 的干净环境）")
