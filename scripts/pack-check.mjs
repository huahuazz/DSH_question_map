/**
 * npm 发布面自检：不联网，只检查「这个包发出去之后别人装得上吗」。
 *
 * 检查项对应社区市场的收录要求：
 *   - `dsh.bundle.patch` 存在且真的插入了本包（`dsh plugin add` 才会把它作为 profile 层）
 *   - `dsh.client.platform = "web"` + `exports["./client"]`（浏览器侧 bundle 才会被 /plugins 提供）
 *   - bundle 里 `__ModuleLoader__.load({ id })` 的 id 等于包名（模块身份）
 *   - `files` 覆盖运行时真正需要的文件，且不夹带开发物
 *   - `engines.dsh` / `keywords` / `license` / `repository` 等元数据齐全
 *
 * 运行：node scripts/pack-check.mjs
 */

import { readFileSync, existsSync, statSync } from "node:fs"
import { join, resolve } from "node:path"

const root = resolve(import.meta.dirname, "..")
const failures = []
const checks = []
function check(label, condition, detail) {
  checks.push({ label, ok: condition === true, detail })
  if (condition !== true) failures.push(`${label}${detail === undefined ? "" : ` → ${detail}`}`)
}

const manifest = JSON.parse(readFileSync(join(root, "package.json"), "utf8"))
const name = manifest.name

// ---- 元数据 ----
check("包名合法（小写、无空格）", /^[a-z][a-z0-9-]*$/.test(name), name)
check("版本号是 semver", /^\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?$/.test(manifest.version), manifest.version)
check("有 description", typeof manifest.description === "string" && manifest.description.length > 20, String(manifest.description?.length))
check("有 license", typeof manifest.license === "string", String(manifest.license))
check("有 repository", typeof manifest.repository?.url === "string", String(manifest.repository?.url))
check("有 homepage", typeof manifest.homepage === "string", String(manifest.homepage))
check("keywords 含 dsh-plugin", Array.isArray(manifest.keywords) && manifest.keywords.includes("dsh-plugin"), JSON.stringify(manifest.keywords))
check("engines.dsh 已声明", typeof manifest.engines?.dsh === "string", String(manifest.engines?.dsh))
check("不是 private 包", manifest.private !== true, String(manifest.private))

// ---- dsh 清单 ----
check("dsh.bundle.patch 已声明", typeof manifest.dsh?.bundle?.patch === "string", String(manifest.dsh?.bundle?.patch))
check("dsh.client.platform 是 web", manifest.dsh?.client?.platform === "web", String(manifest.dsh?.client?.platform))
check("dsh.client.inject 是非空数组", Array.isArray(manifest.dsh?.client?.inject) && manifest.dsh.client.inject.length > 0, JSON.stringify(manifest.dsh?.client?.inject))

const patchRel = manifest.dsh?.bundle?.patch
const patchPath = patchRel === undefined ? undefined : join(root, patchRel)
check("patch 文件存在", patchPath !== undefined && existsSync(patchPath), String(patchPath))
const patchText = patchPath !== undefined && existsSync(patchPath) ? readFileSync(patchPath, "utf8") : ""
check("patch 文件插入了本包", patchText.includes(`name: ${name}`), patchRel)

// ---- 导出与运行时文件 ----
const clientRel = manifest.exports?.["./client"]?.default ?? manifest.exports?.["./client"]
check('exports["./client"] 指向存在的文件', typeof clientRel === "string" && existsSync(join(root, clientRel)), String(clientRel))
check("main 指向存在的文件", typeof manifest.main === "string" && existsSync(join(root, manifest.main)), String(manifest.main))
check("type 是 module", manifest.type === "module", String(manifest.type))

const bundleText = typeof clientRel === "string" ? readFileSync(join(root, clientRel), "utf8") : ""
const idMatch = /__ModuleLoader__\.load\(\s*\{[\s\S]{0,120}?id:\s*"([^"]+)"/.exec(bundleText)
check("bundle 内注册 id 等于包名", idMatch !== null && idMatch[1] === name, idMatch === null ? "未找到 id" : idMatch[1])
const requires = [...new Set([...bundleText.matchAll(/require\("([^"]+)"\)/g)].map((match) => match[1]))]
const allowed = ["react", "react/jsx-runtime", "react-dom", "react-dom/client", "@deepseek-ai/cordis", "@deepseek-ai/dsh-client-store", "@deepseek-ai/dsh-client-ui-slots", "@deepseek-ai/dsh-client-ui-primitives"]
const outside = requires.filter((request) => allowed.includes(request) === false)
check("bundle 只依赖平台共享模块", outside.length === 0, outside.join(", ") || requires.join(", "))

// ---- files ----
const files = manifest.files ?? []
check("files 声明了非空清单", Array.isArray(files) && files.length > 0, JSON.stringify(files))
const missing = files.filter((entry) => existsSync(join(root, entry)) === false)
check("files 里的条目都存在", missing.length === 0, missing.join(", ") || "ok")
const normalize = (entry) => String(entry).replace(/^\.\//, "")
const listed = files.map(normalize)
const required = [manifest.main, clientRel, patchRel, "README.md", "LICENSE"]
const notListed = required.filter((entry) => {
  if (typeof entry !== "string") return false
  const target = normalize(entry)
  return listed.some((pattern) => target === pattern || target.startsWith(`${pattern}/`)) === false
})
check("运行时文件与 README/LICENSE 都在 files 里", notListed.length === 0, notListed.join(", ") || "ok")
const forbidden = files.filter((entry) => entry === "node_modules" || entry.startsWith("node_modules/") || entry === "scripts" || entry.startsWith("scripts/"))
check("files 不夹带 node_modules/scripts", forbidden.length === 0, forbidden.join(", ") || "ok")

// ---- 体积 ----
let total = 0
for (const entry of files) {
  const target = join(root, entry)
  if (existsSync(target) === false) continue
  const stats = statSync(target)
  total += stats.isDirectory() ? 0 : stats.size
}
check("清单文件体积合理（< 1MB）", total < 1024 * 1024, `${Math.round(total / 1024)} KB`)

// ---- 报告 ----
const width = 42
for (const entry of checks) {
  console.log(`${entry.ok ? "✓" : "✗"} ${entry.label.padEnd(width, " ")} ${entry.detail ?? ""}`)
}
if (failures.length > 0) {
  console.error(`\npack check FAILED (${failures.length})`)
  for (const failure of failures) console.error(`  - ${failure}`)
  process.exit(1)
}
console.log("\npack ok：发布面清单、dsh 清单、bundle 身份、files 覆盖全部通过")
