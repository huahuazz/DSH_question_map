/**
 * 宿主半边冒烟测试：从**已安装**的位置 import `lib/index.js`，确认
 *
 *   1. 它不依赖任何 `@deepseek-ai/*` 包（0.2.x 换掉设置 API 时不会连 import 都失败）；
 *   2. 它导出 `apply`（Cordis 插件契约）且调用不抛错；
 *   3. 导出的 `NAME` 与包名一致。
 *
 * 运行：node scripts/host-smoke.mjs
 * 未安装插件时跳过（CI 友好）。
 */

import { existsSync, readFileSync } from "node:fs"
import { join } from "node:path"
import { pathToFileURL } from "node:url"
import { profileDir } from "./lib/env.mjs"

const packageName = "dsh-plugin-question-map"
const installedDir = join(profileDir(), "node_modules", packageName)
const installed = join(installedDir, "lib", "index.js")

if (existsSync(installed) === false) {
  console.log(`skipped：未安装到 profile（${installedDir}）。装了之后这个检查才有意义。`)
  process.exit(0)
}

// 1) 源码层面：不许 import 官方包
const source = readFileSync(installed, "utf8")
const imports = [...source.matchAll(/from\s+"([^"]+)"/g)].map((match) => match[1])
const official = imports.filter((name) => name.startsWith("@deepseek-ai/"))
assert(official.length === 0, `宿主半边不应 import 官方包（0.2.x 会因导出变化而加载失败）：${official.join(", ")}`)

// 2) 模块契约
const module_ = await import(pathToFileURL(installed).href)
console.log("exports:", Object.keys(module_).join(", "))
assert(typeof module_.apply === "function", "apply 应为函数")
assert(module_.NAME === packageName, `NAME 应为 ${packageName}，实际 ${module_.NAME}`)

// 3) apply 可被调用，且不会去碰任何宿主服务
const touched = []
const stub = new Proxy(
  {},
  {
    get(_target, property) {
      touched.push(String(property))
      return () => {
        throw new Error(`宿主半边不应调用 ctx.${String(property)}`)
      }
    },
  },
)
module_.apply(stub)
assert(touched.length === 0, `apply 不应访问任何宿主服务，实际访问了：${touched.join(", ")}`)

console.log("host smoke ok：无官方依赖、apply 契约、空实现全部通过")
console.log(`  安装位置：${installedDir}`)

function assert(condition, message) {
  if (!condition) {
    console.error(`[host-smoke] FAILED: ${message}`)
    process.exit(1)
  }
}
