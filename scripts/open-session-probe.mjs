/**
 * 在侧边栏点开那个横向会话（标题带 ⟂），把主视图文本抓出来——用来观察宿主到底
 * 给了这个会话什么状态（有没有报错横幅、有没有消息）。
 *
 * 用法：node scripts/open-session-probe.mjs <cdp端口>
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

const clicked = await evaluate(`(() => {
  const nodes = Array.from(document.querySelectorAll('button, a, [role="button"], li, div'))
  const target = nodes.find((element) => (element.textContent ?? '').includes('⟂') && element.childElementCount <= 6)
  if (target === undefined) return { ok: false, reason: 'no ⟂ item in DOM' }
  target.click()
  return { ok: true, text: (target.textContent ?? '').trim().slice(0, 40) }
})()`)
console.log("点击侧边栏项：", clicked)
await sleep(6000)

const view = await evaluate(`(() => {
  const center = document.querySelector('[class*="_centerCol"]')
  return {
    text: (center?.innerText ?? '').slice(0, 1200),
  }
})()`)
console.log("\n主视图文本：")
console.log(view?.text)

socket.close()
