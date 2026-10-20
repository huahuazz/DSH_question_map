/**
 * 带工作目录的追问探针：验证"横向会话在**有 cwd** 的情况下能真正跑起一轮并回到卡片"。
 *
 * 背景：验证实例里没有"当前会话"，所以插件默认创建的横向会话没有 cwd；
 * 这次用调试句柄的 `{ cwd }` 覆盖，模拟真实使用（当前会话有工作目录）时的行为。
 *
 * 用法：node scripts/cwd-probe.mjs <cdp端口> [cwd]
 */

const port = process.argv[2] ?? "9336"
const cwd = process.argv[3] ?? "C:/Users/Admin/AppData/Roaming/Microsoft/Windows/Start Menu"
const target = cwd.startsWith("ws:") ? { workspaceId: cwd.slice(3) } : { cwd }
const base = `http://127.0.0.1:${port}`

const list = await (await fetch(`${base}/json/list`)).json()
const page = list.find((target) => target.type === "page")
if (page === undefined) throw new Error("no page target")

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

const started = await evaluate(`(() => {
  if (typeof window.__lateralAsk?.ask !== 'function') return { ok: false, reason: 'debug handle missing' }
  window.__lateralAsk.ask('锚定浮卡', '从选中处向下展开一张卡片，卡内可继续追问，可拖动保留', ${JSON.stringify(target)})
  return { ok: true }
})()`)
console.log("触发：", started)
if (started?.ok !== true) process.exit(1)

let latest = null
for (let attempt = 0; attempt < 90; attempt += 1) {
  await sleep(1000)
  latest = await evaluate(`(() => {
    const card = document.querySelector('.dla-card')
    const state = window.__lateralAsk?.state()
    return {
      body: card === null ? null : (card.querySelector('.dla-card-body')?.innerText ?? '').slice(0, 500),
      threads: window.__lateralAsk?.threads?.() ?? null,
      nodes: state?.nodes?.length ?? 0,
    }
  })()`)
  const threads = latest?.threads ?? {}
  const hasAnswer = Object.values(threads).some((thread) => thread.messages > 1) || (latest?.body ?? "").length > 120
  if (attempt % 10 === 0 || hasAnswer) {
    console.log(`  ${attempt}s:`, JSON.stringify(latest?.threads), "| body:", JSON.stringify((latest?.body ?? "").slice(0, 120)))
  }
  if (hasAnswer) break
}

console.log("\n最终：")
console.log("  卡片正文:", JSON.stringify(latest?.body))
console.log("  线程状态:", JSON.stringify(latest?.threads))
console.log("  节点数:", latest?.nodes)
socket.close()

const threads = latest?.threads ?? {}
const answered = Object.values(threads).some((thread) => thread.messages > 1)
process.exit(answered ? 0 : 2)
