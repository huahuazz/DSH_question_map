/**
 * 读取插件的原始视图结构：把 `uiConversation.binding(id).target('chat')` 的快照形状打出来，
 * 用来确认"读不到消息"到底是数据没到还是我解析的字段不对。
 *
 * 用法：node scripts/raw-probe.mjs <cdp端口> <sessionId>
 */

const port = process.argv[2] ?? "9338"
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
const sleep = (ms) => new Promise((done) => setTimeout(done, ms))

const states = await evaluate("JSON.stringify(window.__lateralAsk?.state()?.nodes ?? [])")
console.log("图里的节点：", states)
const parsed = JSON.parse(states ?? "[]")
const target = sessionId ?? parsed[parsed.length - 1]?.sessionId
if (target === undefined) {
  console.error("没有可检查的会话")
  process.exit(1)
}
console.log(`\n检查会话 ${target}`)
for (let attempt = 0; attempt < 6; attempt += 1) {
  const raw = await evaluate(`JSON.stringify(window.__lateralAsk?.raw?.(${JSON.stringify(target)}) ?? null)`)
  console.log(`  ${attempt}:`, raw)
  await sleep(2000)
}
socket.close()
