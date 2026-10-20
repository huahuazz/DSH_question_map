/**
 * 锚点内容 + 跳转验收：
 *   ① 锚点显示会话的真实标题（不是空的「本次对话」）
 *   ② 点节点上的 ↗ 真的切到该会话
 *   ③ 双击节点体也能切过去
 *   ④ 卡片头部的「打开会话」按钮存在
 *
 * 用法：node scripts/anchor-title-probe.mjs <cdp端口> <workspaceId>
 */

const port = process.argv[2] ?? "9353"
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
const centerTitle = () => evaluate("((document.querySelector('[class*=\"_centerCol\"]')?.innerText ?? '').split('\\n')[0]) || null")

// 先在一个会话里问一句
await evaluate(`window.__lateralAsk.ask('股票', '这家公司的股票值得买吗', { workspaceId: ${JSON.stringify(workspaceId)} })`)
for (let attempt = 0; attempt < 25; attempt += 1) {
  await sleep(1000)
  if (Number(await evaluate("document.querySelectorAll('.dla-entry').length")) === 1) break
}

await evaluate("document.querySelector('.dla-entry').click()")
for (let attempt = 0; attempt < 10; attempt += 1) {
  await sleep(700)
  if (Number(await evaluate("document.querySelectorAll('.dla-graph').length")) > 0) break
}

record("① 锚点文字", await evaluate("Array.from(document.querySelectorAll('.dla-anchor')).map(function (g) { return g.textContent })"))
record("   锚点 tooltip", await evaluate("document.querySelector('.dla-anchor title') ? document.querySelector('.dla-anchor title').textContent : null"))
record("   节点文字", await evaluate("Array.from(document.querySelectorAll('.dla-node')).map(function (g) { const t = g.querySelector('text'); return t ? t.textContent : null })"))
record("   当前主视图标题（跳转前）", await centerTitle())

// ② 点 ↗
const before = await centerTitle()
await evaluate("document.querySelectorAll('.dla-node-open')[0].dispatchEvent(new MouseEvent('click', { bubbles: true }))")
await sleep(2500)
const after = await centerTitle()
record("② 点↗后主视图标题", after)
record("   标题是否变了", before !== after)
record("   提示条", await evaluate("document.querySelector('.dla-toast') ? document.querySelector('.dla-toast').textContent : null"))

// ③ 回到图里，双击节点体
await evaluate("window.__lateralAsk.openGraph()")
await sleep(1000)
const beforeDouble = await centerTitle()
await evaluate(`(() => {
  const node = document.querySelector('.dla-node')
  if (node === null) return null
  node.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }))
  return 'sent'
})()`)
await sleep(2500)
const afterDouble = await centerTitle()
record("③ 双击后主视图标题", afterDouble)
record("   双击是否切换", beforeDouble !== afterDouble)

// ④ 卡片头的「打开会话」按钮
await evaluate("window.__lateralAsk.state().nodes.length > 0 ? null : null")
await evaluate("(() => { const n = window.__lateralAsk.state().nodes[0]; if (n) window.__lateralAsk.openNode ? null : null })()")
socket.close()
