/**
 * 组合链核对：按 DSH 0.2.x 客户端模块系统与社区市场的真实规则，逐项检查本包
 * 「能不能被 `dsh plugin add` 装上、bundle 会不会被 /plugins 提供、插件能不能拿到它要的服务」。
 *
 * 检查依据：
 *   - `dsh-plugin-manager`：包必须声明 `dsh.bundle`，安装时才会作为 profile 层并加载它的 patch 文件
 *   - `dsh-client-modules`：row 名 → 最近匹配的 package.json → `dsh.client.platform === "web"`
 *     → `exports["./client"]`；bundle 里 `load({ id })` 的 id 必须等于包名
 *   - 浏览器侧 `require` 只能命中平台静态表（react / react-dom / cordis / client-store / ui-slots / ui-primitives）
 *   - cordis `inject`：每个服务名都必须真有人 provide
 *
 * 运行：node scripts/verify-composition.mjs
 */

import { readFileSync, existsSync, readdirSync, statSync } from "node:fs"
import { join, resolve } from "node:path"
import { appModules, hasDshInstall, profileDir } from "./lib/env.mjs"

const PROFILE = profileDir()
const PACKAGE_NAME = "dsh-question-map"
const INSTALLED_DIR = join(PROFILE, "node_modules", PACKAGE_NAME)
const APP_MODULES = appModules()
const PLATFORM_MODULES = [
  "react",
  "react/jsx-runtime",
  "react-dom",
  "react-dom/client",
  "@deepseek-ai/cordis",
  "@deepseek-ai/dsh-client-store",
  "@deepseek-ai/dsh-client-ui-slots",
  "@deepseek-ai/dsh-client-ui-primitives",
]

if (hasDshInstall() === false) {
  console.log(`skipped：本机没有 DSH 安装（可用 DSH_APP_DIR 指定），跳过组合链检查。`)
  console.log(`  查过的位置：${APP_MODULES}`)
  process.exit(0)
}

const failures = []
const checks = []
function check(label, condition, detail) {
  checks.push({ label, ok: condition === true, detail })
  if (condition !== true) failures.push(`${label}${detail === undefined ? "" : ` → ${detail}`}`)
}

// ---- 1. 已安装清单满足客户端模块系统与 plugin manager 的契约 ----
const manifestPath = join(INSTALLED_DIR, "package.json")
check("已安装 package.json 存在", existsSync(manifestPath), manifestPath)
const manifest = JSON.parse(readFileSync(manifestPath, "utf8"))
check("包名与 loader 行名一致", manifest.name === PACKAGE_NAME, manifest.name)
check("dsh.client.platform 是 web", manifest.dsh?.client?.platform === "web", String(manifest.dsh?.client?.platform))
check("声明了 dsh.bundle.patch（plugin add 才会作为 profile 层）", typeof manifest.dsh?.bundle?.patch === "string", String(manifest.dsh?.bundle?.patch))
check("声明了 engines.dsh", typeof manifest.engines?.dsh === "string", String(manifest.engines?.dsh))

const clientExport = manifest.exports?.["./client"]
const clientRel = typeof clientExport === "string" ? clientExport : clientExport?.default
check('exports["./client"] 可解析为字符串', typeof clientRel === "string", JSON.stringify(clientExport))
const clientPath = clientRel === undefined ? undefined : resolve(INSTALLED_DIR, clientRel)
check("客户端 bundle 文件存在", clientPath !== undefined && existsSync(clientPath), String(clientPath))
check("宿主入口文件存在", existsSync(resolve(INSTALLED_DIR, manifest.main ?? "index.js")), manifest.main)

// ---- 2. bundle 自身：模块身份 + 只依赖平台共享表 ----
const bundle = clientPath !== undefined && existsSync(clientPath) ? readFileSync(clientPath, "utf8") : ""
const idMatch = /__ModuleLoader__\.load\(\s*\{[\s\S]{0,120}?id:\s*"([^"]+)"/.exec(bundle)
check("bundle 内注册 id 等于包名", idMatch !== null && idMatch[1] === PACKAGE_NAME, idMatch === null ? "未找到 id" : idMatch[1])
const requires = [...bundle.matchAll(/require\("([^"]+)"\)/g)].map((match) => match[1])
const outside = [...new Set(requires)].filter((name) => PLATFORM_MODULES.includes(name) === false)
check("bundle 只 require 平台共享表内的模块", outside.length === 0, outside.join(", ") || "ok")

// ---- 3. patch 文件：安装时会插入本插件 ----
const patchPath = join(INSTALLED_DIR, "cordis.patch.yml")
check("cordis.patch.yml 存在", existsSync(patchPath), patchPath)
const patchText = existsSync(patchPath) ? readFileSync(patchPath, "utf8") : ""
check("cordis.patch.yml 插入了本包", patchText.includes(`name: ${PACKAGE_NAME}`), patchPath)

// ---- 4. dsh.client.inject 的插件 id 在本机 DSH 里都存在 ----
const injectPlugins = manifest.dsh?.client?.inject ?? []
const missingDeps = injectPlugins.filter((name) => existsSync(join(APP_MODULES, name.replace("@deepseek-ai/", ""), "package.json")) === false)
check("dsh.client.inject 的插件都存在于本机 DSH", missingDeps.length === 0, missingDeps.join(", ") || `${injectPlugins.length} 个`)

// ---- 5. cordis inject 的每个服务都真有人 provide ----
const wantedServices = ["slots", "locale", "sessions", "uiConversation", "uiWorkspace", "workspaces", "remote", "remote.session"]
const providers = new Map()
const scanRoots = [APP_MODULES, join(PROFILE, "node_modules", "@deepseek-ai")]
for (const root of scanRoots) {
  if (existsSync(root) === false) continue
  for (const name of readdirSync(root)) {
    const dir = join(root, name)
    try {
      if (statSync(dir).isDirectory() === false) continue
    } catch (_dangling) {
      continue
    }
    for (const candidate of ["lib/client.js", "lib/index.js"]) {
      const file = join(dir, candidate)
      if (existsSync(file) === false) continue
      let source
      try {
        source = readFileSync(file, "utf8")
      } catch (_unreadable) {
        continue
      }
      for (const service of wantedServices) {
        const escaped = service.replace(".", "\\.")
        const patterns = [
          new RegExp(`(?:reflect\\.)?provide\\(\\s*["']${escaped}["']`),
          new RegExp(`super\\(\\s*ctx\\s*,\\s*["']${escaped}["']`),
        ]
        if (patterns.some((pattern) => pattern.test(source))) {
          const bucket = providers.get(service) ?? new Set()
          bucket.add(name)
          providers.set(service, bucket)
        }
      }
    }
  }
}
// `remote` 由连接/网关装配在运行时提供，`remote.<ns>` 由 Remote 网关按已注册的定义生成：
// 这里改为核对"宿主确实注册了这个 Remote 命名空间" + "已有客户端插件在 inject 里声明了 remote"。
const sessionHost = join(APP_MODULES, "dsh-api-session-controller", "lib", "index.js")
const sessionHostText = existsSync(sessionHost) ? readFileSync(sessionHost, "utf8") : ""
const declaresRemote = (() => {
  for (const name of readdirSync(APP_MODULES)) {
    const file = join(APP_MODULES, name, "lib", "client.js")
    if (existsSync(file) === false) continue
    try {
      if (/inject\s*=\s*\[[^\]]*"remote"/.test(readFileSync(file, "utf8"))) return true
    } catch (_unreadable) {
      continue
    }
  }
  return false
})()
if (declaresRemote) providers.set("remote", new Set(["connection/gateway (runtime)"]))
if (/namespace:\s*["']session["']/.test(sessionHostText)) providers.set("remote.session", new Set(["dsh-api-session-controller (host)"]))
const unprovided = wantedServices.filter((service) => providers.has(service) === false)
check("插件 inject 的每个服务都有提供方", unprovided.length === 0, unprovided.join(", ") || "ok")

// ---- 6. profile 的用户补丁层登记了本插件 ----
const profilePatch = join(PROFILE, "cordis.patch.yml")
const profileText = existsSync(profilePatch) ? readFileSync(profilePatch, "utf8") : ""
check("profile 的 cordis.patch.yml 登记了本插件", profileText.includes(PACKAGE_NAME), profilePatch)

// ---- 报告 ----
const width = 50
for (const entry of checks) {
  console.log(`${entry.ok ? "✓" : "✗"} ${entry.label.padEnd(width, " ")} ${entry.detail ?? ""}`)
}
console.log("\n服务提供方：")
for (const service of wantedServices) {
  const owners = providers.get(service)
  console.log(`  ${service.padEnd(18, " ")} ← ${owners === undefined ? "(未找到)" : [...owners].join(", ")}`)
}

if (failures.length > 0) {
  console.error(`\ncomposition check FAILED (${failures.length})`)
  for (const failure of failures) console.error(`  - ${failure}`)
  process.exit(1)
}
console.log("\ncomposition ok：清单契约、bundle 身份、共享模块、注入依赖、服务提供方、补丁登记全部通过")
