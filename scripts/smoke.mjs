/**
 * 无浏览器的冒烟测试：把 `lib/client.js` 当成 DSH 的浏览器模块加载，喂一套最小桩，
 * 验证「模块格式、注入清单、locale/slot 注册、本地存储、会话跳转、调试句柄、卸载」。
 *
 * 渲染相关的验收由 `scripts/headless-probe.mjs`（真实浏览器）承担——
 * 这里不再依赖 react-dom/server（当前运行环境里不保证有它）。
 *
 * 运行：node scripts/smoke.mjs
 */

import { readFile } from "node:fs/promises"
import { fileURLToPath } from "node:url"
import { dirname, resolve } from "node:path"
import vm from "node:vm"
import { loadReact } from "./lib/env.mjs"

const here = dirname(fileURLToPath(import.meta.url))
const bundlePath = resolve(here, "..", "lib", "client.js")

// react 从 DSH 应用目录解析（宿主静态模块表里的那份）。
process.env.DSH_TEST_STUB_REACT = "1"
const { react: React, kind } = loadReact()

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
assert(entry.id === "dsh-question-map", `模块 id 不符：${entry.id}`)

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
const renamed = []
const sideSessions = []
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
      getSnapshot: () => {
        const byId = {}
        for (const id of ["main-session", ...sideSessions]) byId[id] = { cwd: "C:/work", retainedBy: sessions.current === id ? { mainView: 1 } : {} }
        return { byId }
      },
      subscribe: () => () => {},
    },
    binding: (id) => (sideSessions.includes(id) || id === "main-session"
      ? { session: { rename: async (title) => { renamed.push({ id, title }) }, open: async () => {}, getSnapshot: () => ({ running: false }) } }
      : undefined),
    create: async () => {
      const id = "side-" + (sideSessions.length + 1)
      sideSessions.push(id)
      return id
    },
    retain: (id) => ({ sessionId: id, release: () => {}, ready: Promise.resolve() }),
  },
  uiConversation: {
    binding: () => {
      throw new Error("no session in smoke test")
    },
  },
  uiWorkspace: {
    openSession: (id) => {
      openedSessions.push(id)
      sessions.current = id
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
assert(registeredSlots.length === 2, "应注册两个 slot 条目（输入区入口 + 浮层），实际 " + registeredSlots.length)
const slotByName = (name) => registeredSlots.find((slot) => slot.definition.name === name)
assert(slotByName("conversation.input.left") !== undefined, "入口按钮应挂在 conversation.input.left（跟着输入框走）")
assert(slotByName("shell.overlay") !== undefined, "浮卡/画布应挂在 shell.overlay")
assert(slotByName("shell.overlay").definition.locale === "questionMap", "slot 条目应绑定 questionMap 文案")
assert(typeof slotByName("shell.overlay").component === "function", "slot 条目应带组件")
assert(typeof slotByName("conversation.input.left").component === "function", "入口按钮 slot 应带组件")
assert(headChildren.some((child) => child.dataset?.plugin === "dsh-question-map"), "应注入插件样式表")

assert(globalThis.__questionMap !== undefined, "挂载后应暴露调试句柄 __questionMap")
const state = globalThis.__questionMap.state()
assert(Array.isArray(state.nodes), "state.nodes 应为数组")
assert(state.graphOpen === false, "图默认关闭")

// ---- 控制器行为：提问 → 落库 → 入口可见性 ----
const controller = slotByName("shell.overlay").definition.inject().controller
await controller.ask({ term: "锚定浮卡", quote: "从选中处展开卡片", parent: null, rect: null })
await new Promise((done) => setTimeout(done, 400))
assert(controller.state.nodes.length === 1, `提问后应有 1 个节点，实际 ${controller.state.nodes.length}`)
assert(storage.size === 1, "图应写入 localStorage")
const persisted = JSON.parse([...storage.values()][0])
assert(persisted.nodes.length === 1, "localStorage 里应有 1 个节点")

assert(controller.currentRootId() === "main-session", `应能从 retainedBy.mainView 认出当前会话，实际 ${controller.currentRootId()}`)
assert(controller.relatedGraph("main-session") !== null, "当前会话应与追问网格相关（入口按钮可见）")
assert(controller.relatedGraph("另一个新会话") === null, "无关会话不应显示入口按钮")
assert(controller.relatedGraph(controller.state.nodes[0].sessionId) !== null, "横向会话本身也应相关")

// ---- 切换会话应清场（浮卡属于上一个会话的上下文）----
assert(controller.state.card !== null, "提问后应有一张浮卡")
controller.onSessionChanged("main-session")   // 首次只记录，不动界面
assert(controller.state.card !== null, "同会话不应收起浮卡")
controller.onSessionChanged("另一个新会话")
assert(controller.state.card === null, "切到别的会话后浮卡应自动收起")
assert(controller.state.button === null, "切到别的会话后选区按钮也应收起")

// ---- 在子提问里继续追问：要挂到子节点下面，并留在同一张图 ----
const first = controller.state.nodes[0]
sessions.current = first.sessionId
const inferred = controller.parentForSelection(false)
assert(inferred !== null && inferred.kind === "node" && inferred.nodeId === first.id, "在追问会话里选词应把该会话的节点作为父节点")
await controller.ask({ term: "线程池", quote: "线程池的调度策略", parent: inferred, rect: null })
await new Promise((done) => setTimeout(done, 400))
const grandchild = controller.state.nodes.find((node) => node.id !== first.id)
assert(grandchild !== undefined, "应新增第二层节点")
assert(grandchild.parent.kind === "node" && grandchild.parent.nodeId === first.id, "第二层节点的父节点应是第一层追问")
assert(grandchild.rootSessionId === first.rootSessionId, "第二层节点应继承同一张图的根")
const longBox = globalThis.__questionMap.nodeBox(grandchild.id)
assert(longBox !== null, "应能读到节点盒子")
assert(longBox.width <= 420, "节点宽度不应超过 420：" + longBox.width)
assert(longBox.lines.length >= 1 && longBox.lines.length <= 2, "节点最多两行：" + JSON.stringify(longBox.lines))
await controller.ask({ term: "会话归档到底删不删除记录以及归档之后还能不能恢复这段对话的完整内容", quote: "", parent: null, rect: null })
await new Promise((done) => setTimeout(done, 400))
const wide = controller.state.nodes[controller.state.nodes.length - 1]
const wideBox = globalThis.__questionMap.nodeBox(wide.id)
assert(wideBox.lines.length === 2, "超长标签应折成两行，实际 " + wideBox.lines.length)
assert(wideBox.height === 50, "两行节点高度应为 50，实际 " + wideBox.height)
assert(wideBox.width <= 420, "折行后宽度仍应受 420 限制，实际 " + wideBox.width)

const laid = globalThis.__questionMap.layout()
const posOf = (id) => laid.positions.get(id)
const anchorKey = [...laid.positions.keys()].find((key) => key.startsWith("anchor:"))
assert(anchorKey !== undefined, "应有一个锚点")
const anchorPos = posOf(anchorKey)
const firstPos = posOf(first.id)
const childPos = posOf(grandchild.id)
assert(anchorPos.depth === 0 && firstPos.depth === 1 && childPos.depth === 2, "层级应为 锚点(0) → 第一层(1) → 第二层(2)")
assert(firstPos.x > anchorPos.x + 60, "第一层应排在锚点右侧")
assert(childPos.x > firstPos.x + 60, "第二层应排在更右侧，不能被上一层压住")

// ---- 删除节点：第一层不可删，第二层删掉连带子追问 ----
controller.openNode(first.id)
assert(controller.state.card !== null, "打开节点后应有浮卡")
assert(controller.isRootNode(first) === true, "第一层追问应被识别为根节点")
assert(controller.isRootNode(grandchild) === false, "第二层追问不应是根节点")
const beforeRemove = controller.state.nodes.length
const refused = controller.removeNode(first.id)
assert(refused === false, "第一层追问应拒绝删除")
assert(controller.state.nodes.length === beforeRemove, "拒绝删除后节点数不应变化")
assert(controller.state.nodes.some((node) => node.id === first.id), "第一层追问应仍在图里")
controller.removeNode(grandchild.id)
assert(controller.state.nodes.length === beforeRemove - 1, "删除第二层应只删它自己（无子节点时），实际剩 " + controller.state.nodes.length)
assert(controller.state.nodes.some((node) => node.id === grandchild.id) === false, "第二层节点应已移除")
assert(controller.state.nodes.some((node) => node.id === first.id), "它的父节点不受影响")

// ---- 右键菜单：颜色 / 重命名 / 删除保护 ----
controller.openMenu("node", first.id, 100, 120)
assert(controller.state.menu !== null && controller.state.menu.kind === "node", "右键节点应打开菜单")
controller.setNodeColor(first.id, "amber")
assert(controller.nodeById(first.id).color === "amber", "应记录高亮色")
await new Promise((done) => setTimeout(done, 400))
assert(JSON.parse(storage.get("dsh-question-map:graph")).nodes.some((node) => node.id === first.id && node.color === "amber"), "颜色应写进 localStorage")
controller.setNodeColor(first.id, null)
assert(controller.nodeById(first.id).color === undefined, "清除颜色应删除字段")

// 菜单重命名 → 节点标题 + 会话标题
controller.openMenu("node", first.id, 100, 120)
controller.menuEdit()
assert(controller.state.menu.mode === "rename", "应进入重命名态")
await controller.setNodeTitle(first.id, "股票入门")
assert(controller.nodeById(first.id).title === "股票入门", "节点应记住自定义标题")
assert(renamed.some((entry) => entry.title.includes("股票入门")), "应同步改会话标题，实际：" + JSON.stringify(renamed))

// 右键菜单在锚点上也开（只有重命名）
controller.openMenu("anchor", controller.nodeById(first.id).rootSessionId, 50, 60)
assert(controller.state.menu.kind === "anchor", "锚点菜单应可打开")
controller.closeMenu()

// ---- 颜色必须落在内联 style 上（SVG 表现属性会被 CSS 覆盖）----
controller.setNodeColor(first.id, "green")
const tColor = (key) => key
const colorTree = globalThis.__questionMap.components.GraphView({ controller, nodes: controller.state.nodes, t: tColor })
const colorNode = (function find(el) {
  if (el === null || typeof el !== "object") return null
  if (Array.isArray(el)) {
    for (const child of el) { const hit = find(child); if (hit !== null) return hit }
    return null
  }
  if (el.props?.className === "dla-node") return el
  for (const child of el.props?.children ?? []) { const hit = find(child); if (hit !== null) return hit }
  return null
})(colorTree)
assert(colorNode !== null, "应能定位到节点元素")
const coloredRects = (colorNode.props.children ?? []).filter((child) => child !== null && typeof child === "object" && child.type === "rect" && child.props?.style?.fill !== undefined)
assert(coloredRects.length >= 1, "节点的矩形应带内联 fill（否则会被样式表覆盖）")
assert(coloredRects.some((rect) => String(rect.props.style.fill).includes("18,161,80")), "内联 fill 应为所选绿色，实际 " + JSON.stringify(coloredRects.map((r) => r.props.style.fill)))
controller.setNodeColor(first.id, null)
assert(controller.state.menu === null, "关闭后菜单应为空")
// ---- 组件"渲染"（用桩 React 直接调用，抓渲染期的 ReferenceError）----
const components = globalThis.__questionMap.components
const t = (key) => key
const cardProps = { controller, card: { nodeId: first.id, rect: null }, node: first, thread: null, t }
controller.openMenu("node", first.id, 40, 40)
const renderProps = {
  GraphView: { controller, nodes: controller.state.nodes, t },
  AskCard: cardProps,
  LateralOverlay: { controller, t },
  GraphMenu: { controller, menu: controller.state.menu, t },
}
controller.closeMenu()
for (const name of Object.keys(renderProps)) {
  try {
    components[name](renderProps[name])
  } catch (error) {
    assert(false, `${name} 渲染时抛错：${error instanceof Error ? error.message : String(error)}`)
  }
}
// ---- 网图节点点击语义：点节点体跳会话、点小圆点开浮卡 ----
await controller.ask({ term: "点节点应跳转", quote: "", parent: null, rect: null })
await new Promise((done) => setTimeout(done, 400))
const tree = globalThis.__questionMap.components.GraphView({ controller, nodes: controller.state.nodes, t })
const findAll = (element, className, out = []) => {
  if (element === null || typeof element !== "object") return out
  if (Array.isArray(element)) {
    for (const child of element) findAll(child, className, out)
    return out
  }
  if (element.props !== undefined && element.props.className === className) out.push(element)
  const children = element.props?.children ?? []
  for (const child of children) findAll(child, className, out)
  return out
}
const nodeEls = findAll(tree, "dla-node")
assert(nodeEls.length >= 1, "网图里应有可点的节点，实际 " + nodeEls.length)
const beforeOpen = openedSessions.length
nodeEls[0].props.onClick({ stopPropagation() {} })
assert(openedSessions.length === beforeOpen + 1, "点节点体应跳转到会话（uiWorkspace.openSession）")
assert(controller.state.graphOpen === false, "跳转后应收起网图")
const cardBefore = controller.state.card
const dotEls = findAll(tree, "dla-node-open")
assert(dotEls.length >= 1, "节点上应有小圆点")
dotEls[0].props.onClick({ stopPropagation() {} })
assert(controller.state.card !== null && controller.state.card !== cardBefore, "点小圆点应打开浮卡（不跳转）")

// ---- 浮卡：没有图钉；标题区可拖动、右下角可改大小 ----
const cardTree = components.AskCard({ controller, card: controller.state.card, node: controller.state.nodes[0], thread: null, t })
const pinButtons = findAll(cardTree, "dla-icon-btn").filter((el) => el.props.title === "card.pin" || el.props.title === "card.unpin")
assert(pinButtons.length === 0, "浮卡上不应再有图钉按钮")
const heads = findAll(cardTree, "dla-card-head")
assert(heads.length === 1 && typeof heads[0].props.onPointerDown === "function", "浮卡标题区应挂上拖动处理")
assert(heads[0].props.title === "card.drag", "标题区应有「可拖动」的提示")
const grips = findAll(cardTree, "dla-card-resize")
assert(grips.length === 1 && typeof grips[0].props.onPointerMove === "function", "浮卡右下角应有改大小的把手")
assert(typeof grips[0].props.onPointerUp === "function", "改大小的把手应在松手时收尾（写本地存储）")

// ---- 视觉层：图标必须是内联 svg，界面里不再出现 emoji ----
const collectStrings = (element, out = []) => {
  if (element === null || element === undefined) return out
  if (typeof element === "string" || typeof element === "number") { out.push(String(element)); return out }
  if (Array.isArray(element)) { for (const child of element) collectStrings(child, out); return out }
  if (typeof element === "object") {
    // 函数组件（比如 Icon）在这里就地展开，否则拿到的只是组件引用，看不到真正的 svg。
    if (typeof element.type === "function") return collectStrings(element.type(element.props), out)
    collectStrings(element.props?.children ?? [], out)
  }
  return out
}
const findByType = (element, type, out = []) => {
  if (element === null || typeof element !== "object") return out
  if (Array.isArray(element)) { for (const child of element) findByType(child, type, out); return out }
  if (typeof element.type === "function") return findByType(element.type(element.props), type, out)
  if (element.type === type) out.push(element)
  findByType(element.props?.children ?? [], type, out)
  return out
}
const EMOJI = /[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}]/u
const emojiIn = (element) => collectStrings(element).filter((text) => EMOJI.test(text))
assert(emojiIn(cardTree).length === 0, "浮卡里不应再有 emoji：" + emojiIn(cardTree).join(" | "))
assert(findByType(cardTree, "svg").length >= 3, "浮卡的操作按钮应使用内联 svg 图标，实际 " + findByType(cardTree, "svg").length)
const graphTree = components.GraphView({ controller, nodes: controller.state.nodes, t })
assert(emojiIn(graphTree).length === 0, "网格里不应再有 emoji：" + emojiIn(graphTree).join(" | "))
assert(findByType(graphTree, "svg").length >= 2, "网格的工具栏与节点应使用内联 svg 图标，实际 " + findByType(graphTree, "svg").length)

// ---- 输入区入口按钮：一块方形按钮，无关会话里不渲染 ----
const entryEl = components.EntryButton({ controller, t })
assert(entryEl !== null && entryEl.type === "button", "入口按钮应渲染成 button")
assert(entryEl.props.className === "dla-entry", "入口按钮应带 dla-entry 类名")
assert(findByType(entryEl, "svg").length >= 1, "入口按钮应使用内联 svg 图标（Z 形节点）")
assert(emojiIn(entryEl).length === 0, "入口按钮里不应有 emoji")
const currentBackup = sessions.current
sessions.current = "完全无关的会话"
assert(components.EntryButton({ controller, t }) === null, "与追问无关的会话里不应渲染入口按钮")
sessions.current = currentBackup

// ---- 锚点：当前就在根会话时，点击只收网格 ----
const anchorEls = findAll(graphTree, "dla-anchor")
assert(anchorEls.length >= 1, "网格里应有会话锚点，实际 " + anchorEls.length)
assert(anchorEls[0].props["data-clickable"] === "", "可点的锚点应有 data-clickable 标记")
assert(typeof anchorEls[0].props.onClick === "function", "有归属会话的锚点应可点击")
controller.toggleGraph()
assert(controller.state.graphOpen === true, "应能打开网格")
anchorEls[0].props.onClick({ stopPropagation() {} })
assert(controller.state.graphOpen === false, "点当前根会话的锚点应只收起网格")
// ---- 打开会话走新接口 ----
const openedBefore = openedSessions.length
controller.openInMain(controller.state.nodes[0].sessionId)
await new Promise((done) => setTimeout(done, 50))
assert(openedSessions.length === openedBefore + 1, `openInMain 应只再打开一个会话，实际 +${openedSessions.length - openedBefore}`)
assert(controller.currentRootId() === openedSessions[openedSessions.length - 1], `跳转后应能认出当前会话（retainedBy.mainView），实际 ${controller.currentRootId()}`)

// ---- 点别的根会话的锚点：走 openInMain 切过去（把方法换成探针，避免真的排一个 800ms 校验）----
const sessionBeforeAnchor = sessions.current
sessions.current = "some-other-session"
const elsewhereAnchor = findAll(components.GraphView({ controller, nodes: controller.state.nodes, t }), "dla-anchor")[0]
const realOpenInMain = controller.openInMain
let anchorTarget = null
controller.openInMain = (sessionId) => { anchorTarget = sessionId }
elsewhereAnchor.props.onClick({ stopPropagation() {} })
controller.openInMain = realOpenInMain
sessions.current = sessionBeforeAnchor
const rootIds = new Set(controller.state.nodes.map((node) => node.rootSessionId).filter((id) => id !== null))
assert(anchorTarget !== null && rootIds.has(anchorTarget), "点锚点应切到该锚点所属的根会话，实际 " + anchorTarget)

// ---- 清空整张图 ----
controller.markClear()
assert(controller.state.confirmClear === true, "第一次点清空应进入确认态")
controller.clearGraph()
assert(controller.state.nodes.length === 0, "清空后图应为空")
assert(controller.state.confirmClear === false, "清空后应退出确认态")


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
const recoveredTree = components.GraphView({ controller: recoveredController, nodes: recoveredController.state.nodes, t })
const orphanAnchor = findAll(recoveredTree, "dla-anchor")[0]
assert(orphanAnchor !== undefined, "恢复出来的图也应有锚点")
assert(typeof orphanAnchor.props.onClick !== "function", "「未归属提问」锚点不应可点（没有可跳转的会话）")
assert(orphanAnchor.props["data-clickable"] === undefined, "「未归属提问」锚点不应带 data-clickable")
assert(recoveredController.state.nodes.every((node) => node.recovered === true && node.rootSessionId === null), "恢复的节点应标记 recovered 且无根会话")
assert(recoveredController.relatedGraph("main-session") === null, "无关会话（哪怕同工作区）不应显示入口按钮")
assert(recoveredController.relatedGraph("old-1") !== null, "恢复出来的追问会话本身应相关")
await new Promise((done) => setTimeout(done, 400))
assert(JSON.parse(storage.get("dsh-question-map:graph")).nodes.length === 2, "恢复结果应回写 localStorage")
for (const { disposer } of effects.slice()) {
  if (typeof disposer === "function") disposer()
}

// ---- 时序：启动时会话列表还没加载完，等列表有数据后应补恢复 ----
storage.clear()
const lateListeners = new Set()
let lateById = {}
plugin.apply({
  ...ctx,
  sessions: {
    list: {
      getSnapshot: () => ({ current: "main-session", byId: lateById }),
      subscribe: (listener) => {
        lateListeners.add(listener)
        return () => lateListeners.delete(listener)
      },
    },
    binding: () => undefined,
    create: async () => "session-stub",
  },
  workspaces: { list: { getSnapshot: () => ({ items: [{ workspaceId: "ws-9", sessionIds: ["main-session", "late-1"] }] }) } },
})
const lateController = registeredSlots[registeredSlots.length - 1].definition.inject().controller
assert(lateController.state.nodes.length === 0, "会话列表为空时不应恢复出节点")
assert(lateListeners.size === 1, "应挂上一个一次性会话订阅等待列表就绪")
lateById = { "main-session": { title: "主对话" }, "late-1": { title: "⟂ 迟到恢复", updatedAt: 5 } }
for (const listener of [...lateListeners]) listener()
assert(lateController.state.nodes.length === 1, `会话列表就绪后应补恢复 1 个节点，实际 ${lateController.state.nodes.length}`)
assert(lateListeners.size === 0, "恢复成功后应退订")
for (const { disposer } of effects.slice()) {
  if (typeof disposer === "function") disposer()
}

console.log("smoke ok：模块格式、注入清单、locale/slot 注册、本地存储、旧会话恢复（含时序）、会话跳转、调试句柄、卸载全部通过")
console.log(`  inject: ${plugin.inject.join(", ")}`)
console.log(`  React: ${kind}`)
console.log(`  require 过的共享模块: ${[...new Set(requiredNames)].join(", ")}`)

function assert(condition, message) {
  if (!condition) {
    console.error(`[smoke] FAILED: ${message}`)
    process.exit(1)
  }
}
