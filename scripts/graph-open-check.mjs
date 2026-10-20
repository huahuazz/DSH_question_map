/**
 * 聚焦测试：在"当前会话"里提问 → 确认入口按钮 → 打开图并轮询等待画布出现。
 * 用法：node scripts/graph-open-check.mjs <cdp端口> <workspaceId>
 */

const port = process.argv[2] ?? "9350"
const workspaceId = process.argv[3] ?? "a14c412a-b752-44ea-b356-be1d7e5b8f0a"
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

record("起始", await evaluate("JSON.stringify({ open: window.__lateralAsk.state().graphOpen, nodes: window.__lateralAsk.state().nodes.length, entry: document.querySelectorAll('.dla-entry').length })"))

await evaluate(`window.__lateralAsk.ask('锚定浮卡', '卡片位置绑定在选中的文字上', { workspaceId: ${JSON.stringify(workspaceId)} })`)
for (let attempt = 0; attempt < 20; attempt += 1) {
  await sleep(1000)
  if (Number(await evaluate("document.querySelectorAll('.dla-entry').length")) === 1) break
}
record("提问后", await evaluate("JSON.stringify({ entry: document.querySelectorAll('.dla-entry').length, open: window.__lateralAsk.state().graphOpen })"))

// 用按钮本身打开（更接近用户操作）
await evaluate("document.querySelector('.dla-entry').click()")
let opened = false
for (let attempt = 0; attempt < 10; attempt += 1) {
  await sleep(700)
  const dom = JSON.parse(await evaluate("JSON.stringify({ graphs: document.querySelectorAll('.dla-graph').length, nodes: document.querySelectorAll('.dla-node').length, anchors: document.querySelectorAll('.dla-anchor').length })") ?? "{}")
  record(`  打开后 ${attempt}`, dom)
  if (dom.graphs > 0) {
    opened = true
    break
  }
}
record("图已打开", opened)
record("节点名", await evaluate("Array.from(document.querySelectorAll('.dla-node')).map(function (g) { var t = g.querySelector('text'); return t ? t.textContent : null })"))
record("锚点", await evaluate("Array.from(document.querySelectorAll('.dla-anchor')).map(function (g) { return g.textContent })"))
record("图栏按钮", await evaluate("Array.from(document.querySelectorAll('.dla-graph-bar .dla-btn')).map(function (b) { return b.textContent })"))
socket.close()
