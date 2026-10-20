/**
 * 按钮冲突验收：画布打开时右下角不该再有常驻按钮；画布关闭时常驻按钮回来且不重叠。
 *
 * 用法：node scripts/button-conflict-check.mjs <cdp端口> <workspaceId>
 */

const port = process.argv[2] ?? "9358"
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

const snapshot = () => evaluate(`(function () {
  var entries = Array.prototype.map.call(document.querySelectorAll('.dla-entry'), function (b) {
    var r = b.getBoundingClientRect()
    return { text: b.textContent, top: Math.round(r.top), left: Math.round(r.left), bottom: Math.round(innerHeight - r.bottom) }
  })
  var bar = document.querySelector('.dla-graph-bar')
  return {
    graphOpen: window.__lateralAsk.state().graphOpen,
    entryButtons: entries,
    barButtons: bar === null ? [] : Array.prototype.map.call(bar.querySelectorAll('.dla-btn'), function (b) { return b.textContent }),
    barRect: bar === null ? null : (function () { var r = bar.getBoundingClientRect(); return { top: Math.round(r.top), bottom: Math.round(r.bottom) } })(),
  }
})()`)

await evaluate(`window.__lateralAsk.ask('股票', '这只股票的估值贵不贵', { workspaceId: ${JSON.stringify(workspaceId)} })`)
for (let attempt = 0; attempt < 25; attempt += 1) {
  await sleep(1000)
  if (Number(await evaluate("document.querySelectorAll('.dla-entry').length")) >= 1) break
}
record("① 画布关闭时", await snapshot())

// 打开画布
await evaluate("document.querySelector('.dla-entry').click()")
await sleep(1200)
record("② 画布打开时", await snapshot())

// 关闭画布（点底栏的关闭）
await evaluate(`(function () {
  var buttons = Array.prototype.slice.call(document.querySelectorAll('.dla-graph-bar .dla-btn'))
  var close = buttons.find(function (b) { return (b.textContent || '').indexOf('关闭') >= 0 })
  if (close) close.click()
})()`)
await sleep(1000)
record("③ 再关闭画布后", await snapshot())

socket.close()
