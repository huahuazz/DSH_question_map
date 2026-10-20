/**
 * 图结构验收（新版）：会话锚点 + 连线 + 节点上的「回到会话」图标。
 *
 * 用法：node scripts/graph-links-probe.mjs <cdp端口> <workspaceId>
 */

const port = process.argv[2] ?? "9349"
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

await evaluate("window.__lateralAsk.clear()")
await sleep(400)

// 根提问 ×2（都从当前会话问出 → 应共享同一个「本次对话」锚点）
await evaluate(`window.__lateralAsk.ask('锚定浮卡', '卡片位置绑定在选中的文字上', { workspaceId: ${JSON.stringify(workspaceId)} })`)
let nodes = []
for (let attempt = 0; attempt < 30; attempt += 1) {
  await sleep(1000)
  nodes = JSON.parse(await evaluate("JSON.stringify(window.__lateralAsk.state().nodes)") ?? "[]")
  if (nodes.length >= 1) break
}
const first = nodes[0]
record("① 根节点 1", first === undefined ? null : { id: first.id, root: first.rootSessionId })

// 子提问（从上面那个节点问出 → 应连到它）
await evaluate(`window.__lateralAsk.ask('卡片', '卡片是覆盖层，浮在内容之上', { parent: { kind: 'node', nodeId: ${JSON.stringify(first?.id)} } })`)
for (let attempt = 0; attempt < 30; attempt += 1) {
  await sleep(1000)
  nodes = JSON.parse(await evaluate("JSON.stringify(window.__lateralAsk.state().nodes)") ?? "[]")
  if (nodes.length >= 2) break
}
record("② 节点数", nodes.length)

await evaluate("window.__lateralAsk.openGraph()")
await sleep(1200)
record("③ 图结构", JSON.parse(await evaluate(`JSON.stringify({
  anchors: Array.from(document.querySelectorAll('.dla-anchor')).map((g) => ({ text: g.textContent, current: g.hasAttribute('data-current') })),
  nodes: Array.from(document.querySelectorAll('.dla-node')).map((g) => g.querySelector('text')?.textContent ?? null),
  edges: document.querySelectorAll('.dla-edge').length,
  openBadges: document.querySelectorAll('.dla-node-open').length,
})`) ?? "null"))

// ④ 点某个节点的「↗」图标 → 应切到该会话并关掉图
const clicked = await evaluate(`(() => {
  const badge = document.querySelectorAll('.dla-node-open')[0]
  if (badge === undefined) return { ok: false, reason: 'no badge' }
  badge.dispatchEvent(new MouseEvent('click', { bubbles: true }))
  return { ok: true }
})()`)
record("④ 点击↗图标", clicked)
await sleep(2500)
record("   图是否关闭", await evaluate("window.__lateralAsk.state().graphOpen"))
record("   主视图标题", await evaluate("(document.querySelector('[class*=\"_centerCol\"]')?.innerText ?? '').split('\\n')[0] ?? null"))
record("   主视图片段", (await evaluate("(document.querySelector('[class*=\"_centerCol\"]')?.innerText ?? '').slice(0, 120)") ?? "").replace(/\n/g, " / "))

socket.close()
