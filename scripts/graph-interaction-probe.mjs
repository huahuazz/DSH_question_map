/**
 * 图交互验收：缩放（滚轮）、平移（拖拽）、以及这段时间内的控制台异常。
 *
 * 用法：node scripts/graph-interaction-probe.mjs <cdp端口>
 */

const port = process.argv[2] ?? "9347"
const base = `http://127.0.0.1:${port}`
const list = await (await fetch(`${base}/json/list`)).json()
const page = list.find((target) => target.type === "page")
const socket = new WebSocket(page.webSocketDebuggerUrl)
await new Promise((resolve) => socket.addEventListener("open", resolve))
let nextId = 0
const pending = new Map()
const exceptions = []
socket.addEventListener("message", (event) => {
  const message = JSON.parse(event.data)
  if (message.method === "Runtime.exceptionThrown") {
    exceptions.push(message.params?.exceptionDetails?.exception?.description ?? message.params?.exceptionDetails?.text ?? "exception")
    return
  }
  if (message.method === "Runtime.consoleAPICalled" && message.params?.type === "error") {
    exceptions.push(`console.error: ${(message.params.args ?? []).map((arg) => arg.value ?? arg.description ?? "?").join(" ")}`)
    return
  }
  const waiter = pending.get(message.id)
  if (waiter !== undefined) {
    pending.delete(message.id)
    waiter(message)
  }
})
const send = (method, params) => new Promise((resolve) => {
  const id = ++nextId
  pending.set(id, resolve)
  socket.send(JSON.stringify({ id, method, params }))
})
const evaluate = async (expression) => {
  const result = await send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true })
  return result.result?.result?.value ?? result.result?.exceptionDetails?.text ?? null
}
const sleep = (ms) => new Promise((done) => setTimeout(done, ms))
const record = (step, value) => console.log(`${step} → ${typeof value === "string" ? value : JSON.stringify(value)}`)

await send("Runtime.enable", {})

await evaluate("window.__lateralAsk.openGraph()")
await sleep(1000)
const transform = () => evaluate("document.querySelector('.dla-svg > g')?.getAttribute('transform') ?? null")
record("初始 transform", await transform())

const box = JSON.parse(await evaluate(`JSON.stringify((() => {
  const rect = document.querySelector('.dla-svg')?.getBoundingClientRect()
  return rect === undefined || rect === null ? { ok: false } : { ok: true, x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 }
})())`) ?? "null")
record("画布中心", box)

// 滚轮缩放
await send("Input.dispatchMouseEvent", { type: "mouseWheel", x: box.x, y: box.y, deltaX: 0, deltaY: -240 })
await sleep(500)
record("滚轮后 transform", await transform())

// 拖拽平移
await send("Input.dispatchMouseEvent", { type: "mousePressed", x: box.x, y: box.y, button: "left", buttons: 1, clickCount: 1 })
await send("Input.dispatchMouseEvent", { type: "mouseMoved", x: box.x + 120, y: box.y + 60, button: "left", buttons: 1 })
await send("Input.dispatchMouseEvent", { type: "mouseReleased", x: box.x + 120, y: box.y + 60, button: "left", buttons: 0, clickCount: 1 })
await sleep(500)
record("拖拽后 transform", await transform())

// 页面是否还活着 + 控制台异常
record("图仍打开", await evaluate("window.__lateralAsk.state().graphOpen"))
record("节点数", await evaluate("document.querySelectorAll('.dla-node').length"))
await sleep(1500)
record("期间捕获的异常数", exceptions.length)
if (exceptions.length > 0) {
  for (const entry of exceptions.slice(0, 6)) console.log(`  ! ${entry.slice(0, 200)}`)
}
socket.close()
