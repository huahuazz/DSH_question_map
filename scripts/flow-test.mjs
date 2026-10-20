/**
 * 流程级测试：不碰浏览器，用夹具模拟 `sessions` / `uiConversation` / `uiWorkspace` / localStorage
 * 的真实形状，把控制器从"选中提问"到"答案落库"整条异步链路跑一遍。
 *
 * 覆盖：
 *   1. 建会话带着当前主会话的 cwd
 *   2. 标题带 ⟂ 前缀、模型选择被继承（provider/model/reasoningEffort 透传）
 *   3. 首问内容包含术语与引文，且 mode 走 queue
 *   4. 会话事件窗口被显式 open（后台会话不会自己 follow）
 *   5. chat 视图快照 → 消息列表（过滤掉模板首问、保留答案）
 *   6. 节点写进设置文档（防抖后 graph 字段是一段可解析的 JSON）
 *   7. 从节点里再选词 → 子节点，parent 指向父节点、归属会话不变
 *   8. create 失败 → 卡片进入 failed 且不写节点
 *
 * 运行：node scripts/flow-test.mjs
 */

import { createRequire } from "node:module"
import { readFile } from "node:fs/promises"
import { fileURLToPath } from "node:url"
import { dirname, resolve } from "node:path"
import vm from "node:vm"

const here = dirname(fileURLToPath(import.meta.url))
const bundlePath = resolve(here, "..", "lib", "client.js")
const profileRequire = createRequire("D:/Program Files/DSH Desktop/resources/app/package.json")
const React = profileRequire("react")

//#region 浏览器桩
const documentStub = {
  head: { append() {} },
  body: { append() {}, setAttribute() {}, removeAttribute() {} },
  querySelector: () => null,
  createElement: () => ({ dataset: {}, style: {}, append() {}, remove() {} }),
  addEventListener() {},
  removeEventListener() {},
}
globalThis.document = documentStub
globalThis.window = {
  innerWidth: 1440,
  innerHeight: 900,
  getSelection: () => null,
  __ModuleLoader__: { load(entry) { captured.push(entry) } },
}
globalThis.requestAnimationFrame = (fn) => setTimeout(fn, 0)
const __storage = new Map()
globalThis.localStorage = {
  getItem: (key) => (__storage.has(key) ? __storage.get(key) : null),
  setItem: (key, value) => __storage.set(key, String(value)),
  removeItem: (key) => __storage.delete(key),
}
const captured = []
//#endregion

const source = await readFile(bundlePath, "utf8")
vm.runInThisContext(source, { filename: bundlePath })
const plugin = captured[0].factory((name) => {
  if (name === "react") return React
  if (name === "react-dom") return { createPortal: (children) => children }
  if (name === "@deepseek-ai/dsh-client-ui-primitives") {
    return { MarkdownText: (props) => React.createElement("div", null, props.text) }
  }
  throw new Error(`unexpected require: ${name}`)
})

//#region 夹具
const MAIN_SESSION = "main-session"
const created = []
const prompts = []
const renames = []
const opened = []
const retained = new Set()
const modelSelections = []
const storage = __storage
const viewListeners = new Set()

/** 当前 chat 视图快照（测试过程中被改写以模拟流式回答）。 */
let chatView = { order: [], nodes: new Map() }
let running = false
let failCreate = false
let sessionCounter = 0

function bindingFor(sessionId) {
  return {
    sessionId,
    session: {
      open: async () => {
        opened.push(sessionId)
      },
      prompt: async (content, mode) => {
        prompts.push({ sessionId, content, mode })
        return { ok: true, value: { accepted: true } }
      },
      rename: async (title) => {
        renames.push({ sessionId, title })
        return { ok: true }
      },
      cancel: async () => ({ ok: true }),
      getSnapshot: () => ({ running }),
      projections: {
        faceOf: () => ({
          getSnapshot: () => ({ lastUsed: { provider: "deepseek-official", model: "deepseek-v4-flash" }, next: { provider: "deepseek-official", model: "deepseek-v4-flash", reasoningEffort: "high" } }),
        }),
      },
    },
  }
}

const ctx = {
  effect(fn) {
    const disposer = fn()
    return () => {
      if (typeof disposer === "function") disposer()
    }
  },
  locale: { register: () => () => {} },
  slots: {
    inject(_name, fn) {
      fn()
      return () => {}
    },
    register(definition, component) {
      registered = { definition, component }
      return () => {}
    },
  },
  sessions: {
    list: { getSnapshot: () => ({ current: MAIN_SESSION, byId: { [MAIN_SESSION]: { cwd: "C:/work/demo" } } }) },
    create: async (options) => {
      created.push(options)
      if (failCreate) throw new Error("host refused")
      sessionCounter += 1
      return `side-${sessionCounter}`
    },
    binding: (id) => (id === MAIN_SESSION || retained.has(id) ? bindingFor(id) : undefined),
    retain: (id) => {
      retained.add(id)
      return { sessionId: id, release: () => retained.delete(id), ready: Promise.resolve() }
    },

  },
  uiConversation: {
    binding: () => ({
      target: () => ({
        getSnapshot: () => chatView,
        subscribe: (listener) => {
          viewListeners.add(listener)
          return () => viewListeners.delete(listener)
        },
      }),
    }),
  },
  uiWorkspace: {
    openSession: (id) => opened.push(`select:${id}`),
  },
  workspaces: { list: { getSnapshot: () => ({ items: [] }) } },
  remote: {
    session: {
      selectModel: async (request) => {
        modelSelections.push(request)
        return { ok: true }
      },
    },
  },
}

let registered
plugin.apply(ctx)
const controller = registered.definition.inject().controller
//#endregion

//#region 断言
const sleep = (ms) => new Promise((done) => setTimeout(done, ms))

// 1~5：一次完整的首问
await controller.ask({ term: "锚定浮卡", quote: "从选中处向下展开一张卡片，卡内可继续追问", parent: null, rect: null })
await sleep(10)

assert(created.length === 1, `create 应被调用一次，实际 ${created.length}`)
assert(created[0].cwd === "C:/work/demo", `create 应带主会话 cwd，实际 ${JSON.stringify(created[0])}`)
assert(renames.length === 1 && renames[0].title.startsWith("⟂ "), `标题应带 ⟂ 前缀，实际 ${JSON.stringify(renames[0])}`)
assert(modelSelections.length === 1, "应继承一次模型选择")
assert(
  modelSelections[0].provider === "deepseek-official"
  && modelSelections[0].model === "deepseek-v4-flash"
  && modelSelections[0].reasoningEffort === "high",
  `模型继承参数不符：${JSON.stringify(modelSelections[0])}`,
)
assert(modelSelections[0].sessionId === "side-1", "模型应设到新建的横向会话上")
assert(opened.includes("side-1"), "应显式 open 后台会话的事件窗口")
assert(prompts.length === 1 && prompts[0].mode === "queue", `首问应以 queue 发出，实际 ${JSON.stringify(prompts[0]?.mode)}`)
const promptText = prompts[0].content[0].text
assert(promptText.includes("锚定浮卡"), "首问应包含选中的术语")
assert(promptText.includes("卡内可继续追问"), "首问应包含引文")
assert(promptText.includes("不要复述我贴的原文"), "首问应带「只解释这个词」的指令")

const node = controller.state.nodes[0]
assert(node !== undefined, "首问成功后应写入节点")
assert(node.sessionId === "side-1", `节点 sessionId 不符：${node.sessionId}`)
assert(node.rootSessionId === MAIN_SESSION, `节点归属会话应为当前主会话，实际 ${node.rootSessionId}`)
assert(controller.state.card?.nodeId === node.id, "卡片应切到该节点")

// 模拟流式回答：先只有用户消息，再来答案
chatView = {
  order: ["u1"],
  nodes: new Map([["u1", { kind: "user", content: [{ type: "text", text: promptText }] }]]),
}
for (const listener of viewListeners) listener()
assert(controller.threadOf("side-1").messages.length === 1, "应读到用户消息")

running = true
chatView = {
  order: ["u1", "a1"],
  nodes: new Map([
    ["u1", { kind: "user", content: [{ type: "text", text: promptText }] }],
    ["a1", { kind: "assistant-step", blocks: [{ kind: "text", text: "锚定浮卡是贴着选区展开的卡片。" }] }],
  ]),
}
for (const listener of viewListeners) listener()
const thread = controller.threadOf("side-1")
assert(thread.messages.length === 2, `应读到两条消息，实际 ${thread.messages.length}`)
assert(thread.messages[1].role === "assistant", "第二条应是助手消息")
assert(thread.messages[1].text.includes("贴着选区"), `助手文本不符：${thread.messages[1].text}`)
assert(thread.running === true, "运行状态应投影到线程")

// 6：防抖后落库（localStorage）
await sleep(400)
assert(storage.size >= 1, "节点应写入 localStorage")
const latest = JSON.parse([...storage.values()][storage.size - 1])
assert(Array.isArray(latest.nodes) && latest.nodes.length === 1, "持久化内容应含一个节点")
assert(latest.nodes[0].id === node.id, "持久化节点 id 应与内存一致")

// 7：从节点里再选词 → 子节点
await controller.ask({ term: "选区", quote: "贴着选区展开", parent: { kind: "node", nodeId: node.id }, rect: null })
await sleep(10)
const child = controller.state.nodes.find((candidate) => candidate.id !== node.id)
assert(child !== undefined, "应新增子节点")
assert(child.parent?.kind === "node" && child.parent.nodeId === node.id, "子节点的 parent 应指向父节点")
assert(child.rootSessionId === MAIN_SESSION, "子节点应留在同一张图里")
assert(controller.state.nodes.length === 2, "图上应有 2 个节点")

// 8：create 失败不留脏数据
failCreate = true
const before = controller.state.nodes.length
await controller.ask({ term: "失败词", quote: "", parent: null, rect: null })
await sleep(10)
assert(controller.state.nodes.length === before, "create 失败不应写入节点")
assert(controller.state.card?.phase === "failed", `失败时卡片应进入 failed，实际 ${JSON.stringify(controller.state.card)}`)
assert(prompts.length === 2, "create 失败后不应发问")

console.log("flow ok：建会话、继承模型、首问模板、事件窗口、消息投影、落库、子节点、失败路径全部通过")
console.log(`  节点：${controller.state.nodes.map((entry) => `${entry.term}(${entry.sessionId})`).join(" → ")}`)
process.exit(0)

function assert(condition, message) {
  if (!condition) {
    console.error(`[flow] FAILED: ${message}`)
    process.exit(1)
  }
}
//#endregion
