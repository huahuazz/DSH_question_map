/**
 * 组合链静态核对：按 DSH 客户端模块系统**真实使用的规则**逐项检查，确认
 * "这个包会被组合进浏览器启动图、bundle 会被 /plugins 提供、插件能拿到它要的服务"。
 *
 * 检查依据（实现位置）：
 *   - `dsh-client-modules`（node 半边）`resolveMeta`：row 名 → 最近一个 name 匹配的 package.json
 *     → `dsh.client.platform === 'web'` → `exports["./client"]` 必须能解析成文件
 *   - 同一包 browser 半边 `register()`：bundle 里 `load({ id })` 的 id 就是模块身份，
 *     必须等于包名
 *   - browser 半边 `require`：只能命中平台静态表里那 8 个共享模块
 *   - cordis `inject`：每个服务名都必须真有人 provide，否则插件永远不会 apply
 *
 * 运行：node scripts/verify-composition.mjs
 */

import { readFileSync, existsSync, readdirSync, statSync } from "node:fs"
import { join, resolve, dirname } from "node:path"
import { createRequire } from "node:module"
import { pathToFileURL } from "node:url"

const PROFILE = "C:/Users/Admin/.dsh/profiles/desktop"
const PACKAGE_NAME = "dsh-plugin-lateral-ask"
const INSTALLED_DIR = join(PROFILE, "node_modules", PACKAGE_NAME)
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

const failures = []
const checks = []
function check(label, condition, detail) {
  checks.push({ label, ok: condition === true, detail })
  if (condition !== true) failures.push(`${label}${detail === undefined ? "" : ` → ${detail}`}`)
}

// ---- 1. 已安装的清单满足客户端模块系统的契约 ----
const manifestPath = join(INSTALLED_DIR, "package.json")
check("已安装 package.json 存在", existsSync(manifestPath), manifestPath)
const manifest = JSON.parse(readFileSync(manifestPath, "utf8"))
check("包名与 loader 行名一致", manifest.name === PACKAGE_NAME, manifest.name)
check("dsh.client.platform 是 web", manifest.dsh?.client?.platform === "web", String(manifest.dsh?.client?.platform))
const injectPlugins = manifest.dsh?.client?.inject ?? []
check("dsh.client.inject 是非空数组", Array.isArray(injectPlugins) && injectPlugins.length > 0, JSON.stringify(injectPlugins))

const clientExport = manifest.exports?.["./client"]
const clientRel = typeof clientExport === "string" ? clientExport : clientExport?.default
check('exports["./client"] 可解析为字符串', typeof clientRel === "string", JSON.stringify(clientExport))
const clientPath = clientRel === undefined ? undefined : resolve(INSTALLED_DIR, clientRel)
check("客户端 bundle 文件存在", clientPath !== undefined && existsSync(clientPath), String(clientPath))

const hostEntry = resolve(INSTALLED_DIR, manifest.main ?? "index.js")
check("宿主入口文件存在", existsSync(hostEntry), hostEntry)

// ---- 2. bundle 自身：模块身份 + 只依赖平台共享表 ----
const bundle = clientPath !== undefined && existsSync(clientPath) ? readFileSync(clientPath, "utf8") : ""
check("bundle 走 __ModuleLoader__.load 包装", bundle.includes("window.__ModuleLoader__.load("), "未找到包装")
const idMatch = /__ModuleLoader__\.load\(\s*\{[\s\S]{0,120}?id:\s*"([^"]+)"/.exec(bundle)
check("bundle 内注册 id 等于包名", idMatch !== null && idMatch[1] === PACKAGE_NAME, idMatch === null ? "未找到 id" : idMatch[1])

const requires = [...bundle.matchAll(/require\("([^"]+)"\)/g)].map((match) => match[1])
const uniqueRequires = [...new Set(requires)]
const outside = uniqueRequires.filter((name) => PLATFORM_MODULES.includes(name) === false)
check("bundle 只 require 平台共享表内的模块", outside.length === 0, outside.join(", ") || "ok")

// ---- 3. dsh.client.inject 里的插件全部已安装且自带 web bundle ----
const installRoots = [join(PROFILE, "node_modules"), resolve(PROFILE, "..", "node_modules")]
function findInstalled(name) {
  for (const root of installRoots) {
    const manifestPath = join(root, name, "package.json")
    if (existsSync(manifestPath)) return manifestPath
  }
  return undefined
}
const injectReport = []
for (const dependency of injectPlugins) {
  const dependencyManifestPath = findInstalled(dependency)
  if (dependencyManifestPath === undefined) {
    injectReport.push(`${dependency}: MISSING`)
    continue
  }
  const dependencyManifest = JSON.parse(readFileSync(dependencyManifestPath, "utf8"))
  const platform = dependencyManifest.dsh?.client?.platform
  injectReport.push(`${dependency}: platform=${String(platform)}`)
  if (platform !== "web") failures.push(`注入依赖 ${dependency} 没有 web 客户端 bundle`)
}
check("dsh.client.inject 全部是可加载的 web 客户端插件", injectReport.every((line) => line.endsWith("MISSING") === false && line.includes("platform=web")), injectReport.join(" | "))

// ---- 4. cordis inject 的每个服务名都真有人 provide ----
const wantedServices = ["slots", "locale", "sessions", "uiConversation", "settingsScope", "remote", "remote.session"]
const providers = new Map()
// 依赖树分布在 profile 自己的 node_modules 与 profiles 级的共享 node_modules 两处。
const scanRoots = [
  join(PROFILE, "node_modules", "@deepseek-ai"),
  resolve(PROFILE, "..", "node_modules", "@deepseek-ai"),
]
for (const root of scanRoots) {
  if (existsSync(root) === false) continue
  for (const name of readdirSync(root)) {
    const dir = join(root, name)
    try {
      if (statSync(dir).isDirectory() === false) continue
    } catch (_danglingLink) {
      continue // 依赖树里可能有指向已卸载包的悬空链接，跳过
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
          new RegExp(`namespace:\\s*["']${escaped}["']`),
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

// `remote.<namespace>` 不是静态 provide：它由 Remote 网关在运行时按已挂载的 contribution 生成。
// 所以只要求 `remote` 有提供方，并且那个命名空间字符串在依赖树里出现过。
for (const service of wantedServices.filter((entry) => entry.startsWith("remote."))) {
  const namespace = service.slice("remote.".length)
  if (providers.has("remote") === false) continue
  let declared = false
  for (const root of scanRoots) {
    if (existsSync(root) === false) continue
    for (const name of readdirSync(root)) {
      if (name.includes("api-remotes") === false && name.includes("session-controller") === false) continue
      const file = join(root, name, "lib", "client.js")
      if (existsSync(file) === false) continue
      try {
        const source = readFileSync(file, "utf8")
        if (new RegExp(`["'\`]${namespace}["'\`]`).test(source)) declared = true
      } catch (_unreadable) {
        continue
      }
    }
  }
  if (declared) {
    const bucket = providers.get(service) ?? new Set()
    bucket.add("remote gateway (runtime)")
    providers.set(service, bucket)
  }
}
const unprovided = wantedServices.filter((service) => providers.has(service) === false)
check("插件 inject 的每个服务都有提供方", unprovided.length === 0, unprovided.join(", ") || "ok")

// ---- 5. profile 的实时补丁层登记了本插件 ----
const patchPath = join(PROFILE, "cordis.patch.yml")
const patchText = existsSync(patchPath) ? readFileSync(patchPath, "utf8") : ""
check("cordis.patch.yml 登记了本插件", patchText.includes(PACKAGE_NAME), patchPath)

// ---- 报告 ----
const width = 46
for (const entry of checks) {
  console.log(`${entry.ok ? "✓" : "✗"} ${entry.label.padEnd(width, " ")} ${entry.detail ?? ""}`)
}
console.log("")
console.log("服务提供方：")
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
