/**
 * 测试"打开会话才会驱动轮次"这条假设：
 *   1. 触发一次横向提问
 *   2. 等 15s，记录线程状态
 *   3. 点浮卡上的「在主页打开」（内部调用 ctx.sessions.open）
 *   4. 再观察线程状态与主视图文本
 *
 * 用法：node scripts/open-then-wait.mjs <cdp端口>
 */

const port = process.argv[2] ?? "9338"
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
const threads = () => evaluate("JSON.stringify(window.__lateralAsk?.threads?.() ?? null)")
const centerText = () => evaluate("(document.querySelector('[class*=\"_centerCol\"]')?.innerText ?? '').slice(0, 800)")

console.log("触发追问：", await evaluate(`(() => { window.__lateralAsk.ask('锚定浮卡', '卡内可继续追问'); return 'ok' })()`))
await sleep(15000)
console.log("15s 后线程：", await threads())
console.log("15s 后主视图：", JSON.stringify((await centerText())?.slice(0, 120)))

const clicked = await evaluate(`(() => {
  const card = document.querySelector('.dla-card')
  if (card === null) return { ok: false, reason: 'no card' }
  const buttons = Array.from(card.querySelectorAll('button'))
  const open = buttons.find((button) => (button.getAttribute('title') ?? '').includes('主页') || (button.textContent ?? '').includes('↗'))
  if (open === undefined) return { ok: false, reason: 'no open button', titles: buttons.map((button) => button.getAttribute('title')) }
  open.click()
  return { ok: true }
})()`)
console.log("点击「在主页打开」：", clicked)

for (let attempt = 1; attempt <= 12; attempt += 1) {
  await sleep(5000)
  const thread = await threads()
  const view = await centerText()
  console.log(`  +${attempt * 5}s 线程=${thread}`)
  console.log(`          主视图=${JSON.stringify((view ?? "").slice(0, 140))}`)
  if ((view ?? "").includes("锚定浮卡") && (view ?? "").length > 200) break
}
socket.close()
