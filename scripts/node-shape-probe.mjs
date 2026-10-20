/**
 * 列出 chat 视图里每个节点的 kind 与文本字段，用来把读取器对齐到真实结构。
 *
 * 用法：node scripts/node-shape-probe.mjs <cdp端口> <sessionId>
 */

const port = process.argv[2] ?? "9339"
const sessionId = process.argv[3]
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

const nodes = JSON.parse(await evaluate(`JSON.stringify(window.__lateralAsk?.raw?.(${JSON.stringify(sessionId)}) ?? null)`) ?? "null")
if (nodes === null) {
  console.error("raw() 不可用")
  process.exit(1)
}

// raw() 只给第一个节点的样本；这里换一个能列出全部节点的专用取值
const detail = JSON.parse(await evaluate(`JSON.stringify(window.__lateralAsk?.view?.(${JSON.stringify(sessionId)}) ?? null)`) ?? "null")

if (detail === null) {
  console.log("没有专用视图接口，退回：用 sample 只能看到一个节点")
  console.log(nodes.sample)
  socket.close()
  process.exit(0)
}

console.log("节点总数：", detail.length)
for (const entry of detail) {
  console.log(`- kind=${entry.kind} keys=${entry.keys.join(",")}`)
  console.log(`  json=${(entry.json ?? "").slice(0, 600)}`)
}
socket.close()
