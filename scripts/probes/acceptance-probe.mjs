/**
 * 验收探针：在真实渲染进程里跑 spec 第 10 节剩下的交互项。
 *   ① 卡内追问（同一线程，不新建节点）
 *   ② 打开网状图 → 点节点 → 重开对应的卡
 *
 * 用法：node scripts/acceptance-probe.mjs <cdp端口>
 */

const port = process.argv[2] ?? "9346"
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

// ① 卡内追问
const before = JSON.parse(await evaluate("JSON.stringify({ nodes: window.__lateralAsk.state().nodes.length })") ?? "{}")
record("① 追问前节点数", before)

const focused = await evaluate(`(() => {
  const input = document.querySelector('.dla-card .dla-input')
  if (input === null) return { ok: false, reason: 'no card input' }
  input.focus()
  return { ok: true }
})()`)
record("   聚焦卡片输入框", focused)

if (focused?.ok === true) {
  await send("Input.insertText", { text: "再补一句：举一个具体例子。" })
  await sleep(300)
  await send("Input.dispatchKeyEvent", { type: "keyDown", key: "Enter", code: "Enter", windowsVirtualKeyCode: 13, nativeVirtualKeyCode: 13 })
  await send("Input.dispatchKeyEvent", { type: "keyUp", key: "Enter", code: "Enter", windowsVirtualKeyCode: 13, nativeVirtualKeyCode: 13 })
  record("   已按 Enter 发送追问", "ok")
}

let followState = null
for (let attempt = 0; attempt < 60; attempt += 1) {
  await sleep(2000)
  followState = JSON.parse(await evaluate(`JSON.stringify({
    nodes: window.__lateralAsk.state().nodes.length,
    threads: window.__lateralAsk.threads(),
    body: (document.querySelector('.dla-card .dla-card-body')?.innerText ?? '').slice(0, 200),
  })`) ?? "{}")
  const messages = Object.values(followState.threads ?? {})[0]?.messages ?? 0
  if (attempt % 5 === 0) record(`   等待追问回答（${attempt * 2}s）`, { nodes: followState.nodes, messages })
  if (messages >= 4) break
}
record("① 追问后", { nodes: followState?.nodes, threads: Object.values(followState?.threads ?? {})[0] })
record("   卡片正文尾部", (followState?.body ?? "").slice(-120))

// ② 打开网状图 → 点节点
const opened = await evaluate(`(() => {
  window.__lateralAsk.openGraph()
  return { svg: document.querySelectorAll('.dla-svg').length, nodeRects: document.querySelectorAll('.dla-node').length }
})()`)
await sleep(600)
record("② 打开图", opened)
const clicked = await evaluate(`(() => {
  const node = document.querySelector('.dla-node')
  if (node === null) return { ok: false, reason: 'no node' }
  const label = node.textContent
  node.dispatchEvent(new MouseEvent('click', { bubbles: true }))
  return { ok: true, label }
})()`)
await sleep(800)
record("② 点击节点", clicked)
record("   卡片是否重开", await evaluate("JSON.stringify({ cards: document.querySelectorAll('.dla-card').length, title: document.querySelector('.dla-card-term')?.textContent ?? null, graphOpen: window.__lateralAsk.state().graphOpen })"))

socket.close()
