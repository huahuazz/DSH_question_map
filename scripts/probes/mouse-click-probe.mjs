/**
 * 真实鼠标点击验收（这一步过去用合成 click 测不出来）：
 *   ① 用 CDP 的 Input.dispatchMouseEvent 在节点上按下+抬起（真实鼠标序列）
 *   ② 期望：主视图切到该节点对应的会话（说明 onClick 收得到）
 *   ③ 同样方式点 ↗ 图标，期望也切换
 *   ④ 节点宽度是否随文字长度不同而不同
 *
 * 用法：node scripts/mouse-click-probe.mjs <cdp端口> <workspaceId>
 */

const port = process.argv[2] ?? "9354"
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

const clickAt = async (x, y) => {
  await send("Input.dispatchMouseEvent", { type: "mouseMoved", x, y, button: "none", buttons: 0 })
  await send("Input.dispatchMouseEvent", { type: "mousePressed", x, y, button: "left", buttons: 1, clickCount: 1 })
  await send("Input.dispatchMouseEvent", { type: "mouseReleased", x, y, button: "left", buttons: 0, clickCount: 1 })
}

// 造两个文字长度不同的节点，方便看宽度自适应
await evaluate(`window.__lateralAsk.ask('股票', '这只股票的估值贵不贵', { workspaceId: ${JSON.stringify(workspaceId)} })`)
for (let attempt = 0; attempt < 25; attempt += 1) {
  await sleep(1000)
  if (Number(await evaluate("document.querySelectorAll('.dla-entry').length")) === 1) break
}
await evaluate(`window.__lateralAsk.ask('ETF与LOF的区别以及各自的费率结构', 'ETF 和 LOF 有什么区别', { workspaceId: ${JSON.stringify(workspaceId)} })`)
await sleep(4000)

await evaluate("document.querySelector('.dla-entry').click()")
for (let attempt = 0; attempt < 10; attempt += 1) {
  await sleep(700)
  if (Number(await evaluate("document.querySelectorAll('.dla-graph').length")) > 0) break
}

record("① 节点宽度（应随文字不同）", await evaluate(`Array.from(document.querySelectorAll('.dla-node rect')).map(function (r) { return Math.round(Number(r.getAttribute('width'))) })`))
record("   节点文字", await evaluate(`Array.from(document.querySelectorAll('.dla-node')).map(function (g) { var t = g.querySelector('text'); return t ? t.textContent : null })`))

// ② 真实鼠标点节点本体
const before = await centerTitle()
const nodeBox = JSON.parse(await evaluate(`JSON.stringify((function () {
  var g = document.querySelector('.dla-node')
  if (g === null) return null
  var r = g.getBoundingClientRect()
  return { x: Math.round(r.left + r.width * 0.4), y: Math.round(r.top + r.height / 2) }
})())`) ?? "null")
record("   节点坐标", nodeBox)
if (nodeBox !== null) await clickAt(nodeBox.x, nodeBox.y)
await sleep(2000)
const afterNodeClick = await evaluate("document.querySelectorAll('.dla-card').length")
record("② 真实鼠标点节点后：卡片数", afterNodeClick)
record("   提示条", await evaluate("document.querySelector('.dla-toast') ? document.querySelector('.dla-toast').textContent : null"))

// 关掉卡片，回图里点 ↗
await evaluate("document.querySelector('.dla-card .dla-icon-btn[title]') && document.querySelectorAll('.dla-card button').length > 0 ? Array.from(document.querySelectorAll('.dla-card button')).pop().click() : null")
await sleep(400)
await evaluate("document.querySelector('.dla-entry').click()")
await sleep(1200)

const badgeBox = JSON.parse(await evaluate(`JSON.stringify((function () {
  var b = document.querySelector('.dla-node-open')
  if (b === null) return null
  var r = b.getBoundingClientRect()
  return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) }
})())`) ?? "null")
record("   ↗ 坐标", badgeBox)
const beforeBadge = await centerTitle()
if (badgeBox !== null) await clickAt(badgeBox.x, badgeBox.y)
await sleep(2500)
const afterBadge = await centerTitle()
record("③ 点 ↗ 后主视图标题", afterBadge)
record("   是否切换", beforeBadge !== afterBadge)
record("   提示条", await evaluate("document.querySelector('.dla-toast') ? document.querySelector('.dla-toast').textContent : null"))

socket.close()
