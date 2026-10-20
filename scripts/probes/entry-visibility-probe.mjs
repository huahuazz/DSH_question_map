/**
 * 三件事验收（真实渲染进程）：
 *   ① 无提问时不显示入口按钮；有提问的相关会话里显示
 *   ② 节点显示名按"提出的问题"写
 *   ③ 图里能导出图片（校验导出用的 SVG 文本）
 *   ④ 切到与追问无关的新会话后，入口按钮消失且图自动关闭
 *
 * 用法：node scripts/entry-visibility-probe.mjs <cdp端口> <workspaceId>
 */

const port = process.argv[2] ?? "9350"
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

const entryCount = () => evaluate("document.querySelectorAll('.dla-entry').length")
const nodeLabels = () => evaluate("Array.from(document.querySelectorAll('.dla-node')).map(function (g) { var t = g.querySelector('text'); return t ? t.textContent : null })")
const anchorLabels = () => evaluate("Array.from(document.querySelectorAll('.dla-anchor')).map(function (g) { return g.textContent })")
const barButtons = () => evaluate("Array.from(document.querySelectorAll('.dla-graph-bar .dla-btn')).map(function (b) { return b.textContent })")

await evaluate("window.__lateralAsk.clear()")
await sleep(500)
record("① 无提问时入口按钮数", await entryCount())

await evaluate(`window.__lateralAsk.ask('锚定浮卡', '卡片位置绑定在选中的文字上', { workspaceId: ${JSON.stringify(workspaceId)} })`)
for (let attempt = 0; attempt < 30; attempt += 1) {
  await sleep(1000)
  if (Number(await evaluate("window.__lateralAsk.state().nodes.length")) >= 1) break
}
record("② 相关会话里入口按钮数", await entryCount())
record("   徽标数字", await evaluate("document.querySelector('.dla-entry-badge') ? document.querySelector('.dla-entry-badge').textContent : null"))

await evaluate("window.__lateralAsk.openGraph()")
await sleep(1200)
record("③ 节点显示名", await nodeLabels())
record("   会话锚点", await anchorLabels())
record("   图栏按钮", await barButtons())

const svg = await evaluate("window.__lateralAsk.exportSvg('追问网格')")
record("④ 导出 SVG 字节", typeof svg === "string" ? svg.length : svg)
record("   含节点文本", typeof svg === "string" && svg.indexOf("<text") >= 0)
record("   含箭头标记", typeof svg === "string" && svg.indexOf("marker-end") >= 0)
record("   含导出按钮", (await barButtons() ?? []).indexOf("导出图片") >= 0)

await evaluate("window.__lateralAsk.openGraph()")
await sleep(300)
const unrelated = await evaluate("window.__lateralAsk.newSession()")
record("⑤ 新建并切到无关会话", unrelated)
await sleep(1500)
record("   无关会话里入口按钮数", await entryCount())
record("   图是否自动关闭", (await evaluate("window.__lateralAsk.state().graphOpen")) === false)

socket.close()
