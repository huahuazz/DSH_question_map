/**
 * 无浏览器的冒烟测试：把 `lib/client.js` 当作 DSH 的模块格式加载，喂一套最小桩，
 * 验证「插件能被实例化、注册进 shell.overlay、根组件能渲染」这三件事。
 *
 * 运行：node scripts/smoke.mjs
 */

import { createRequire } from "node:module"
import { readFile } from "node:fs/promises"
import { fileURLToPath } from "node:url"
import { dirname, resolve } from "node:path"
import vm from "node:vm"

const here = dirname(fileURLToPath(import.meta.url))
const bundlePath = resolve(here, "..", "lib", "client.js")
const profileRequire = createRequire("C:/Users/Admin/.dsh/profiles/desktop/package.json")
const React = profileRequire("react")
const ReactDOMServer = profileRequire("react-dom/server")

/** 极简 DOM 桩：只提供插件启动路径真正会碰到的成员。 */
function createFakeDocument() {
  const listeners = new Map()
  const created = []
  const headChildren = []
  return {
    head: {
      append(child) {
        headChildren.push(child)
      },
    },
    body: { append() {}, removeAttribute() {}, setAttribute() {} },
    _created: created,
    _headChildren: headChildren,
    _listeners: listeners,
    querySelector() {
      return null
    },
    querySelectorAll() {
      return []
    },
    createElement(tag) {
      const element = {
        tagName: tag,
        dataset: {},
        style: {},
        textContent: "",
        append() {},
        remove() {},
        addEventListener() {},
        removeEventListener() {},
      }
      created.push(element)
      return element
    },
    addEventListener(type, fn) {
      const list = listeners.get(type) ?? []
      list.push(fn)
      listeners.set(type, list)
    },
    removeEventListener(type, fn) {
      const list = listeners.get(type) ?? []
      listeners.set(type, list.filter((entry) => entry !== fn))
    },
  }
}

const document = createFakeDocument()
const loaded = []

/** 平台静态模块表里我们会用到的三个。 */
const sharedModules = {
  react: React,
  "react-dom": { createPortal: (children) => children },
  "@deepseek-ai/dsh-client-ui-primitives": {
    MarkdownText: (props) => React.createElement("div", { className: "fake-markdown" }, props.text),
  },
}

globalThis.window = {
  innerWidth: 1440,
  innerHeight: 900,
  getSelection: () => null,
  __ModuleLoader__: {
    load(entry) {
      loaded.push(entry)
    },
  },
}
globalThis.document = document
globalThis.requestAnimationFrame = (fn) => setTimeout(fn, 0)

const source = await readFile(bundlePath, "utf8")
vm.runInThisContext(source, { filename: bundlePath })

assert(loaded.length === 1, "bundle 应该注册恰好一个模块")
const entry = loaded[0]
assert(entry.id === "dsh-plugin-lateral-ask", `模块 id 不符：${entry.id}`)

const requiredNames = []
const plugin = entry.factory((name) => {
  requiredNames.push(name)
  if (name in sharedModules) return sharedModules[name]
  throw new Error(`unexpected require: ${name}`)
})

assert(typeof plugin.apply === "function", "插件应导出 apply")
assert(Array.isArray(plugin.inject), "插件应导出 inject")
assert(plugin.inject.includes("slots"), "inject 应包含 slots")
assert(requiredNames.every((name) => name in sharedModules), `出现了共享模块表之外的 require：${requiredNames}`)

// ---- 桩上下文 ----
const effects = []
const registeredSlots = []
const localeNamespaces = []
const settingsWrites = []

const ctx = {
  effect(fn, label) {
    // cordis 的 ctx.effect 会立即执行回调并接管其返回值作为清理函数，这里照做。
    const disposer = fn()
    effects.push({ disposer, label })
    return () => {
      if (typeof disposer === "function") disposer()
    }
  },
  locale: {
    register(namespace, dictionaries) {
      localeNamespaces.push({ namespace, dictionaries })
      return () => {}
    },
  },
  slots: {
    inject(name, fn) {
      fn()
      return () => {}
    },
    register(definition, component) {
      registeredSlots.push({ definition, component })
      return () => {}
    },
  },
  sessions: {
    list: { getSnapshot: () => ({ current: undefined, byId: {} }) },
    binding: () => undefined,
    create: async () => "session-stub",
    open: () => {},
  },
  uiConversation: {
    binding: () => {
      throw new Error("no session in smoke test")
    },
  },
  settingsScope: {
    bind() {
      return {
        getSnapshot: () => ({ status: "loading", value: undefined, revision: undefined }),
        subscribe: () => () => {},
        set(field, value) {
          settingsWrites.push({ field, value })
        },
      }
    },
  },
  remote: { session: { selectModel: async () => ({ ok: true }) } },
}

plugin.apply(ctx)

assert(localeNamespaces.length === 1, "应注册一个 locale 命名空间")
assert(localeNamespaces[0].namespace === "lateralAsk", "locale 命名空间应为 lateralAsk")
assert(
  Object.keys(localeNamespaces[0].dictionaries.zh).length === Object.keys(localeNamespaces[0].dictionaries.en).length,
  "中英文案键集应一致",
)
assert(registeredSlots.length === 1, "应注册一个 slot 条目")
assert(registeredSlots[0].definition.name === "shell.overlay", "slot 条目应挂在 shell.overlay")
assert(registeredSlots[0].definition.locale === "lateralAsk", "slot 条目应绑定 lateralAsk 文案")
assert(typeof registeredSlots[0].component === "function", "slot 条目应带组件")

assert(globalThis.__lateralAsk !== undefined, "挂载后应暴露调试句柄 __lateralAsk")
const state = globalThis.__lateralAsk.state()
assert(Array.isArray(state.nodes), "state.nodes 应为数组")
assert(state.graphOpen === false, "图默认关闭")
assert(document._headChildren.some((child) => child.dataset && child.dataset.plugin === "dsh-plugin-lateral-ask"), "应注入插件样式表")

// ---- 渲染根组件 ----
const business = registeredSlots[0].definition.inject()
const html = ReactDOMServer.renderToString(
  React.createElement(registeredSlots[0].component, { controller: business.controller, t: (key) => key }),
)
assert(html.includes("dla-entry"), "根组件应渲染入口按钮")
assert(html.includes("dla-layer"), "根组件应渲染浮层容器")

// ---- 卸载：每个 effect 的清理函数都应安全执行 ----
for (const { disposer } of effects.slice()) {
  if (typeof disposer === "function") disposer()
}
assert(globalThis.__lateralAsk === undefined, "卸载后应移除调试句柄")

console.log("smoke ok：模块格式、locale、slot 注册、调试句柄、根组件渲染、卸载全部通过")
console.log(`  inject: ${plugin.inject.join(", ")}`)
console.log(`  require 过的共享模块: ${[...new Set(requiredNames)].join(", ")}`)

function assert(condition, message) {
  if (!condition) {
    console.error(`[smoke] FAILED: ${message}`)
    process.exit(1)
  }
}
