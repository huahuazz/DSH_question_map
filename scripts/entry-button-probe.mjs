/**
 * 入口按钮可见性探针：确认浮层已挂到 `document.body`（portal），
 * 并且右下角那个点上"最顶层的元素"就是我们自己的按钮——直接验证遮挡问题是否修复。
 *
 * 用法：node scripts/entry-button-probe.mjs <cdp端口>
 */

const port = process.argv[2] ?? "9348"
const base = `http://127.0.0.1:${port}`
const list = await (await fetch(`${base}/json/list`)).json()
const page = list.find((target) => target.type === "page")
const socket = new WebSocket(page.webSocketDebuggerUrl)
await new Promise((resolve) => socket.addEventListener("open", resolve))
let nextId = 0
const pending = new Map()
socket.addEventListener("message", (event) => {
  const message = JSON.parse(event.data)
  const waiter = pending.get(message.id)
  if (waiter !== undefined) {
    pending.delete(message.id)
    waiter(message)
  }
})
const evaluate = (expression) => new Promise((resolve) => {
  const id = ++nextId
  pending.set(id, (message) => resolve(message.result?.result?.value ?? message.result?.exceptionDetails?.text ?? null))
  socket.send(JSON.stringify({ id, method: "Runtime.evaluate", params: { expression, returnByValue: true, awaitPromise: true } }))
})
const sleep = (ms) => new Promise((done) => setTimeout(done, ms))
const record = (step, value) => console.log(`${step} → ${typeof value === "string" ? value : JSON.stringify(value)}`)

record("浮层父节点", await evaluate(`(() => {
  const layer = document.querySelector('.dla-layer')
  return layer === null ? null : { parentTag: layer.parentElement?.tagName ?? null, zIndex: getComputedStyle(layer).zIndex }
})()`))

record("入口按钮存在", await evaluate("document.querySelectorAll('.dla-entry').length"))

record("右下角命中元素", await evaluate(`(() => {
  const x = window.innerWidth - 30
  const y = window.innerHeight - 30
  const hit = document.elementFromPoint(x, y)
  if (hit === null) return { hit: null }
  return {
    tag: hit.tagName,
    cls: String(hit.className).slice(0, 60),
    isOurs: hit.closest('.dla-entry') !== null,
  }
})()`))

// 打开一张卡片后再看一次（卡片/画布渲染不应该带走按钮）
await evaluate("window.__lateralAsk.openGraph()")
await sleep(700)
record("打开图后按钮仍在", await evaluate(`JSON.stringify({
  entry: document.querySelectorAll('.dla-entry').length,
  graph: document.querySelectorAll('.dla-graph').length,
  layerParent: document.querySelector('.dla-layer')?.parentElement?.tagName ?? null,
})`))
await evaluate("window.__lateralAsk.openGraph()")
await sleep(400)

socket.close()
