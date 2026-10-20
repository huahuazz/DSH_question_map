/**
 * 工具栏位置验收：图打开时，底栏必须在窗口**下半部分**、且「导出图片」按钮可见可点。
 *
 * 用法：node scripts/graph-bar-check.mjs <cdp端口> <workspaceId>
 */

const port = process.argv[2] ?? "9356"
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

// 造一个提问，打开图
await evaluate(`window.__lateralAsk.ask('股票', '这只股票的估值贵不贵', { workspaceId: ${JSON.stringify(workspaceId)} })`)
for (let attempt = 0; attempt < 25; attempt += 1) {
  await sleep(1000)
  if (Number(await evaluate("document.querySelectorAll('.dla-entry').length")) === 1) break
}
await evaluate("document.querySelector('.dla-entry').click()")
for (let attempt = 0; attempt < 10; attempt += 1) {
  await sleep(600)
  if (Number(await evaluate("document.querySelectorAll('.dla-graph').length")) > 0) break
}
await sleep(800)

record("视口", await evaluate("JSON.stringify({ w: innerWidth, h: innerHeight })"))
record("底栏位置", await evaluate(`(function () {
  var bar = document.querySelector('.dla-graph-bar')
  if (bar === null) return { found: false }
  var r = bar.getBoundingClientRect()
  return { found: true, top: Math.round(r.top), bottom: Math.round(r.bottom), height: Math.round(r.height), inLowerHalf: r.top > innerHeight / 2 }
})()`))
record("底栏按钮", await evaluate("Array.from(document.querySelectorAll('.dla-graph-bar .dla-btn')).map(function (b) { return b.textContent })"))
record("导出按钮可见", await evaluate(`(function () {
  var buttons = Array.from(document.querySelectorAll('.dla-graph-bar .dla-btn'))
  var target = buttons.find(function (b) { return (b.textContent || '').indexOf('导出') >= 0 })
  if (target === undefined) return { found: false }
  var r = target.getBoundingClientRect()
  var hit = document.elementFromPoint(Math.round(r.left + r.width / 2), Math.round(r.top + r.height / 2))
  return { found: true, w: Math.round(r.width), h: Math.round(r.height), topmost: hit !== null && hit.closest('.dla-btn') === target }
})()`))
socket.close()
