/**
 * 无浏览器的冒烟测试：把 `lib/client.js` 当成 DSH 的浏览器模块加载，喂一套最小桩，
 * 验证「模块格式、注入清单、locale/slot 注册、本地存储、会话跳转、调试句柄、卸载」。
 *
 * 渲染相关的验收由 `scripts/headless-probe.mjs`（真实浏览器）承担——
 * 这里不再依赖 react-dom/server（当前运行环境里不保证有它）。
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

// react 从 DSH 应用目录解析（宿主静态模块表里的那份）。
const appRequire = createRequire("D:/Program Files/DSH Desktop/resources/app/package.json")
const React = appRequire("react")

const loaded = []
const storage = new Map()
const headChildren = []
const listeners = new Map()

globalThis.localStorage = {
  getItem: (key) => (storage.has(key) ? storage.get(key) : null),
  setItem: (key, value) => storage.set(key, String(value)),
  removeItem: (key) => storage.delete(key),
}
globalThis.document = {
  head: {
    append(child) {
      headChildren.push(child)
      return child
    },
  },
  body: { append() {}, setAttribute() {}, removeAttribute() {} },
  querySelector: () => null,
  querySelectorAll: () => [],
  createElement: () => ({ dataset: {}, style: {}, append() {}, remove() {}, addEventListener() {} }),
  addEventListener(type, fn) {
    listeners.set(type, [...(listeners.get(type) ?? []), fn])
  },
  removeEventListener(type, fn) {
    listeners.set(type, (listeners.get(type) ?? []).filter((entry) => entry !== fn))
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
globalThis.requestAnimationFrame = (fn) => setTimeout(fn, 0)

const source = await readFile(bundlePath, "utf8")
vm.runInThisContext(source, { filename: bundlePath })

assert(loaded.length === 1, "bundle 应该注册恰好一个模块")
const entry = loaded[0]
assert(entry.id === "dsh-plugin-question-map", `模块 id 不符：${entry.id}`)

const sharedModules = {
  react: React,
  "react-dom": { createPortal: (children) => children },
  "@deepseek-ai/dsh-client-ui-primitives": {
    MarkdownText: (props) => React.createElement("div", { className: "fake-markdown" }, props.text),
  },
}
const requiredNames = []
const plugin = entry.factory((name) => {
  requiredNames.push(name)
  if (name in sharedModules) return sharedModules[name]
  throw new Error(`unexpected require: ${name}`)
})

assert(typeof plugin.apply === "function", "插件应导出 apply")
assert(Array.isArray(plugin.inject), "插件应导出 inject")
for (const service of ["slots", "locale", "sessions", "uiConversation", "uiWorkspace", "remote", "remote.session"]) {
  assert(plugin.inject.includes(service), `inject 应包含 ${service}`)
}
assert(plugin.inject.includes("settingsScope") === false, "inject 不应再包含已移除的 settingsScope")
assert(requiredNames.every((name) => name in sharedModules), `出现了共享模块表之外的 require：${requiredNames}`)

//#region 桩上下文
const effects = []
const registeredSlots = []
const localeNamespaces = []
const openedSessions = []
const sessions = { current: "main-session" }

const ctx = {
  effect(fn, label) {
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
    list: {
      getSnapshot: () => ({ current: sessions.current, byId: { "main-session": { cwd: "C:/work" } } }),
      subscribe: () => () => {},
    },
    binding: () => undefined,
    create: async () => "session-stub",
  },
  uiConversation: {
    binding: () => {
      throw new Error("no session in smoke test")
    },
  },
  uiWorkspace: {
    openSession: (id) => {
      openedSessions.push(id)
    },
  },
  workspaces: {
    list: { getSnapshot: () => ({ items: [] }) },
  },
  remote: { session: { selectModel: async () => ({ ok: true }) } },
}
//#endregion

plugin.apply(ctx)

assert(localeNamespaces.length === 1, "应注册一个 locale 命名空间")
assert(localeNamespaces[0].namespace === "questionMap", "locale 命名空间应为 questionMap")
assert(
  Object.keys(localeNamespaces[0].dictionaries.zh).length === Object.keys(localeNamespaces[0].dictionaries.en).length,
  "中英文案键集应一致",
)
assert(registeredSlots.length === 1, "应注册一个 slot 条目")
assert(registeredSlots[0].definition.name === "shell.overlay", "slot 条目应挂在 shell.overlay")
assert(registeredSlots[0].definition.locale === "questionMap", "slot 条目应绑定 questionMap 文案")
assert(typeof registeredSlots[0].component === "function", "slot 条目应带组件")
assert(headChildren.some((child) => child.dataset?.plugin === "dsh-plugin-question-map"), "应注入插件样式表")

assert(globalThis.__questionMap !== undefined, "挂载后应暴露调试句柄 __questionMap")
const state = globalThis.__questionMap.state()
assert(Array.isArray(state.nodes), "state.nodes 应为数组")
assert(state.graphOpen === false, "图默认关闭")

// ---- 控制器行为：提问 → 落库 → 入口可见性 ----
const controller = registeredSlots[0].definition.inject().controller
await controller.ask({ term: "锚定浮卡", quote: "从选中处展开卡片", parent: null, rect: null })
await new Promise((done) => setTimeout(done, 400))
assert(controller.state.nodes.length === 1, `提问后应有 1 个节点，实际 ${controller.state.nodes.length}`)
assert(storage.size === 1, "图应写入 localStorage")
const persisted = JSON.parse([...storage.values()][0])
assert(persisted.nodes.length === 1, "localStorage 里应有 1 个节点")

assert(controller.relatedGraph("main-session") !== null, "当前会话应与追问网相关（入口按钮可见）")
assert(controller.relatedGraph("另一个新会话") === null, "无关会话不应显示入口按钮")
assert(controller.relatedGraph(controller.state.nodes[0].sessionId) !== null, "横向会话本身也应相关")

// ---- 打开会话走新接口 ----
controller.openInMain(controller.state.nodes[0].sessionId)
await new Promise((done) => setTimeout(done, 50))
assert(openedSessions.length === 1, `应通过 uiWorkspace.openSession 打开会话，实际 ${openedSessions.length}`)

// ---- 卸载 ----
for (const { disposer } of effects.slice()) {
  if (typeof disposer === "function") disposer()
}
assert(globalThis.__questionMap === undefined, "卸载后应移除调试句柄")

// ---- 恢复：本地存储为空时，用已有的 ⟂ 会话把图补回来 ----
storage.clear()
const recoverCtx = {
  ...ctx,
  sessions: {
    list: {
      getSnapshot: () => ({
        current: "main-session",
        byId: {
          "main-session": { title: "基金与股票入门介绍", cwd: "C:/work" },
          "old-1": { title: "⟂ 股票（Stock）", cwd: "C:/work", updatedAt: 1000 },
          "old-2": { title: "⟂ ETF/LOF", cwd: "C:/work", updatedAt: 2000 },
          "old-3": { title: "普通对话", cwd: "C:/work" },
        },
      }),
      subscribe: () => () => {},
    },
    binding: () => undefined,
    create: async () => "session-stub",
  },
  workspaces: {
    list: {
      getSnapshot: () => ({
        items: [{ workspaceId: "ws-1", sessionIds: ["main-session", "old-1", "old-2", "old-3"] }],
      }),
    },
  },
}
plugin.apply(recoverCtx)
const recoveredController = registeredSlots[registeredSlots.length - 1].definition.inject().controller
assert(recoveredController.state.nodes.length === 2, `应从 ⟂ 会话恢复 2 个节点，实际 ${recoveredController.state.nodes.length}`)
const recoveredTerms = recoveredController.state.nodes.map((node) => node.term).sort()
assert(recoveredTerms.join("|") === "ETF/LOF|股票（Stock）", `恢复出的节点词不对：${recoveredTerms.join("|")}`)
assert(recoveredController.state.nodes.every((node) => node.recovered === true && node.rootSessionId === null), "恢复的节点应标记 recovered 且无根会话")
assert(recoveredController.relatedGraph("main-session") !== null, "同工作区的主会话也应看到入口按钮")
assert(recoveredController.relatedGraph("old-1") !== null, "恢复出来的追问会话本身应相关")
await new Promise((done) => setTimeout(done, 400))
assert(JSON.parse(storage.get("dsh-question-map:graph")).nodes.length === 2, "恢复结果应回写 localStorage")
for (const { disposer } of effects.slice()) {
  if (typeof disposer === "function") disposer()
}

console.log("smoke ok：模块格式、注入清单、locale/slot 注册、本地存储、旧会话恢复、会话跳转、调试句柄、卸载全部通过")
console.log(`  inject: ${plugin.inject.join(", ")}`)
console.log(`  require 过的共享模块: ${[...new Set(requiredNames)].join(", ")}`)

function assert(condition, message) {
  if (!condition) {
    console.error(`[smoke] FAILED: ${message}`)
    process.exit(1)
  }
}
