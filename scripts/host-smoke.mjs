/**
 * 宿主半边冒烟测试：从**已安装**的位置动态 import `lib/index.js`，确认
 * 依赖能解析、schema 能构造、apply 真的注册了设置命名空间。
 *
 * 运行：node scripts/host-smoke.mjs
 */

import { pathToFileURL } from "node:url"
import { existsSync } from "node:fs"

const installed = "C:/Users/Admin/.dsh/profiles/desktop/node_modules/dsh-plugin-lateral-ask/lib/index.js"

if (existsSync(installed) === false) {
  console.error(`[host-smoke] 未找到已安装的插件：${installed}（先跑 scripts/install.ps1 的等价步骤）`)
  process.exit(1)
}

const module_ = await import(pathToFileURL(installed).href)
console.log("exports:", Object.keys(module_).join(", "))
assert(typeof module_.apply === "function", "apply 应为函数")
assert(module_.NAMESPACE === "lateral-ask", `NAMESPACE 不符：${module_.NAMESPACE}`)
assert(module_.GRAPH_FIELD === "graph", `GRAPH_FIELD 不符：${module_.GRAPH_FIELD}`)

const registered = []
const stub = {
  inject(dependencies, callback) {
    console.log("inject deps:", dependencies.join(", "))
    callback({
      settings: {
        register(namespace, schema) {
          registered.push({ namespace, schema })
        },
      },
      logger: { warn: () => {} },
    })
  },
}

module_.apply(stub)
assert(registered.length === 1, "应注册恰好一个命名空间")
assert(registered[0].namespace === "lateral-ask", `命名空间不符：${registered[0].namespace}`)

const schema = registered[0].schema
const empty = schema({})
assert(typeof empty === "object" && empty !== null, "schema 应能把空对象解析成对象")
assert(empty.graph === "", `默认 graph 应为空串，实际：${JSON.stringify(empty)}`)

const payload = JSON.stringify({ version: 1, nodes: [{ id: "a" }] })
const parsed = schema({ graph: payload })
assert(parsed.graph === payload, "schema 应原样接受图 JSON 文本")

let rejected = false
try {
  schema({ graph: 123 })
} catch (_error) {
  rejected = true
}
assert(rejected, "schema 应拒绝非字符串的 graph")

console.log("host smoke ok：依赖解析、schema 默认值、JSON 文本往返、类型拒绝全部通过")

function assert(condition, message) {
  if (!condition) {
    console.error(`[host-smoke] FAILED: ${message}`)
    process.exit(1)
  }
}
