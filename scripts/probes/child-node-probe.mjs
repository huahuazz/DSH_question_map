/**
 * 子节点与连线验收：在真实渲染进程里
 *   ① 从根节点派生一个子节点（parent 指向根节点）
 *   ② 打开网状图，数节点/连线
 *   ③ 点开子节点，确认来源标注是「来自节点…」
 *
 * 用法：node scripts/child-node-probe.mjs <cdp端口> <workspaceId>
 */

const port = process.argv[2] ?? "9347"
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

// 重置图，确保从一个干净状态开始
await evaluate("window.__lateralAsk.clear()")
await sleep(400)

// ① 根节点
await evaluate(`window.__lateralAsk.ask('锚定浮卡', '卡片位置绑定在选中的文字上', { workspaceId: ${JSON.stringify(workspaceId)} })`)
let root = null
for (let attempt = 0; attempt < 30; attempt += 1) {
  await sleep(1000)
  const state = JSON.parse(await evaluate("JSON.stringify(window.__lateralAsk.state().nodes)") ?? "[]")
  if (state.length >= 1) {
    root = state[0]
    break
  }
}
record("① 根节点", root === null ? null : { id: root.id, term: root.term })
if (root === null) process.exit(1)

// ② 子节点（parent 指向根节点）
await evaluate(`window.__lateralAsk.ask('卡片', '卡片是覆盖层，浮在内容之上', { parent: { kind: 'node', nodeId: ${JSON.stringify(root.id)} } })`)
let nodes = []
for (let attempt = 0; attempt < 30; attempt += 1) {
  await sleep(1000)
  nodes = JSON.parse(await evaluate("JSON.stringify(window.__lateralAsk.state().nodes)") ?? "[]")
  if (nodes.length >= 2) break
}
const child = nodes.find((node) => node.id !== root.id)
record("② 子节点", child === undefined ? null : { id: child.id, term: child.term, parent: child.parent })
if (child === undefined) process.exit(1)

// ③ 打开图，数节点与连线
await evaluate("window.__lateralAsk.openGraph()")
await sleep(1200)
record("③ 图结构", JSON.parse(await evaluate(`JSON.stringify({
  svg: document.querySelectorAll('svg.dla-svg').length,
  nodeGroups: document.querySelectorAll('.dla-node').length,
  edges: document.querySelectorAll('.dla-edge').length,
  labels: Array.from(document.querySelectorAll('.dla-node')).map((group) => group.textContent),
})`) ?? "null"))

// ④ 点开子节点，看来源标注
const clicked = await evaluate(`(() => {
  const groups = Array.from(document.querySelectorAll('.dla-node'))
  const target = groups.find((group) => group.textContent.includes('卡片'))
  if (target === undefined) return { ok: false }
  target.dispatchEvent(new MouseEvent('click', { bubbles: true }))
  return { ok: true }
})()`)
await sleep(900)
record("④ 点击子节点", clicked)
record("   卡片来源标注", await evaluate("document.querySelector('.dla-card-source')?.textContent ?? null"))
record("   卡片标题", await evaluate("document.querySelector('.dla-card-term')?.textContent ?? null"))

socket.close()
