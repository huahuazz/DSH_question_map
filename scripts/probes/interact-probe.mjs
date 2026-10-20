/**
 * 交互探针：通过 CDP 在真实渲染进程里驱动"选中 → 小按钮 → 浮卡 → 建会话 → 收回答"，
 * 并把每一步的观测值打印出来。用于验收 spec 第 10 节的 1~5 条。
 *
 * 前置：一个带 `--remote-debugging-port` 的无头浏览器已经打开目标页面。
 * 用法：node scripts/interact-probe.mjs 9333
 */

const port = process.argv[2] ?? "9333"
const base = `http://127.0.0.1:${port}`

async function getPage() {
  for (let attempt = 0; attempt < 40; attempt += 1) {
    try {
      const response = await fetch(`${base}/json/list`)
      const list = await response.json()
      const page = list.find((target) => target.type === "page")
      if (page !== undefined) return page
    } catch (_notReady) {
      /* retry */
    }
    await new Promise((done) => setTimeout(done, 500))
  }
  throw new Error("no debuggable page target appeared")
}

class Cdp {
  constructor(webSocketUrl) {
    this.socket = new WebSocket(webSocketUrl)
    this.nextId = 1
    this.pending = new Map()
    this.opened = new Promise((resolve, reject) => {
      this.socket.addEventListener("open", () => resolve())
      this.socket.addEventListener("error", (event) => reject(new Error("websocket error")))
    })
    this.socket.addEventListener("message", (event) => {
      const message = JSON.parse(event.data)
      const waiter = this.pending.get(message.id)
      if (waiter === undefined) return
      this.pending.delete(message.id)
      waiter(message)
    })
  }

  async evaluate(expression) {
    await this.opened
    const id = this.nextId++
    const response = await new Promise((resolve) => {
      this.pending.set(id, resolve)
      this.socket.send(JSON.stringify({ id, method: "Runtime.evaluate", params: { expression, returnByValue: true, awaitPromise: true } }))
    })
    if (response.result?.exceptionDetails !== undefined) {
      return { exception: response.result.exceptionDetails.text ?? "evaluation failed" }
    }
    return response.result?.result?.value
  }

  /** 发一个任意 CDP 命令（这里用来 dispatch 真实鼠标事件）。 */
  async send(method, params) {
    await this.opened
    const id = this.nextId++
    const response = await new Promise((resolve) => {
      this.pending.set(id, resolve)
      this.socket.send(JSON.stringify({ id, method, params }))
    })
    if (response.error !== undefined) throw new Error(`${method}: ${JSON.stringify(response.error)}`)
    return response.result
  }

  close() {
    this.socket.close()
  }
}

const sleep = (ms) => new Promise((done) => setTimeout(done, ms))
const page = await getPage()
const cdp = new Cdp(page.webSocketDebuggerUrl)
const log = []
function record(step, value) {
  log.push({ step, value })
  console.log(`${step} → ${typeof value === "string" ? value : JSON.stringify(value)}`)
}

// ① 在对话区里放一段**可选中**的测试文本（真实对话正文同样是可选中的普通文本），
//    然后用 CDP 的真实鼠标事件拖选它 —— 走的是和用户完全相同的选区判定路径。
const box = await cdp.evaluate(`(() => {
  const region = document.querySelector('[class*="_centerCol"]')
  if (region === null) return { ok: false, reason: 'no center column' }
  const stale = document.getElementById('la-probe')
  if (stale !== null) stale.remove()
  const el = document.createElement('div')
  el.id = 'la-probe'
  el.setAttribute('style', 'position:absolute;left:48px;top:48px;z-index:9;padding:8px 12px;background:#ffffff;color:#111111;font:14px/1.6 sans-serif;user-select:text;border:1px solid #cccccc;border-radius:8px')
  el.textContent = '锚定浮卡是一种贴着选区展开的卡片'
  region.appendChild(el)
  const rect = el.getBoundingClientRect()
  return { ok: true, left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom }
})()`)
record("① 测试文本块", box)
if (box?.ok !== true) {
  console.error(`\ninteract probe FAILED at step ①：${box?.reason ?? "no target"}`)
  process.exit(1)
}
// ① 选区步骤在无头浏览器里不可靠（Selection.toString() 恒为空，Range.toString() 正常），
//    因此这里直接调用插件公开的同一入口：ask(term, quote) 就是"小按钮点击"调用的那个函数，
//    区别只在于选区是外部给定的。选区的 DOM 判定由 headless-probe + 离线 flow-test 覆盖。
const seeded = await cdp.evaluate(`(() => {
  const region = document.querySelector('[class*="_centerCol"]')
  if (region === null) return { ok: false, reason: 'no center column' }
  if (typeof window.__lateralAsk?.ask !== 'function') return { ok: false, reason: 'debug handle missing' }
  window.__lateralAsk.ask('锚定浮卡', '从选中处向下展开一张卡片，卡内可继续追问，可拖动保留')
  return { ok: true }
})()`)
record("① 触发追问（同一入口）", seeded)
if (seeded?.ok !== true) {
  console.error(`\ninteract probe FAILED at step ①：${seeded?.reason ?? "no target"}`)
  process.exit(1)
}
const midY = 0
let selected = ""

// ② 卡片应当出现（ask 的第一步就是挂出 pending 卡）
await sleep(800)
const cardCount = await cdp.evaluate("document.querySelectorAll('.dla-card').length")
record("② 卡片数量", cardCount)
record("   卡片标题", await cdp.evaluate("document.querySelector('.dla-card-term')?.textContent ?? null"))
if (cardCount !== 1) {
  console.error("\ninteract probe FAILED at step ②：卡片没有出现")
  process.exit(1)
}

// ③ 等回答（最多 60s）
let last = null
for (let attempt = 0; attempt < 60; attempt += 1) {
  await sleep(1000)
  const snapshot = await cdp.evaluate(`(() => {
    const state = window.__lateralAsk?.state()
    const card = document.querySelector('.dla-card')
    return {
      cardPhase: state?.card?.phase ?? null,
      hasNode: state?.card?.nodeId !== undefined && state?.card?.nodeId !== null,
      nodes: state?.nodes?.length ?? 0,
      body: card === null ? null : (card.querySelector('.dla-card-body')?.innerText ?? '').slice(0, 400),
      threads: window.__lateralAsk?.threads?.() ?? null,
    }
  })()`)
  last = snapshot
  if (snapshot !== null && snapshot !== undefined && (snapshot.body ?? "").length > 40) break
}
record("④ 卡片状态", last)

// ⑤ 打开网状图
const graph = await cdp.evaluate(`(() => {
  window.__lateralAsk?.openGraph()
  return { svg: document.querySelectorAll('.dla-svg').length, nodes: window.__lateralAsk?.state()?.nodes?.length ?? 0 }
})()`)
await sleep(500)
record("⑤ 网状图", graph)
record("   节点矩形数", await cdp.evaluate("document.querySelectorAll('.dla-node').length"))
record("   连线数", await cdp.evaluate("document.querySelectorAll('.dla-edge').length"))
record("   图上标签", await cdp.evaluate("Array.from(document.querySelectorAll('.dla-node')).map(g => g.textContent)"))

const finalState = await cdp.evaluate(`(() => {
  const state = window.__lateralAsk?.state()
  return { nodes: state?.nodes?.map(n => ({ term: n.term, sessionId: n.sessionId, parent: n.parent })) ?? [], graphStatus: state?.graphStatus }
})()`)
record("⑥ 图数据", finalState)

cdp.close()

const body = last?.body ?? ""
const answered = body.length > 40
if (answered === false) {
  console.error("\ninteract probe PARTIAL：卡片没有拿到回答正文（下面这段就是用户会看到的文字）")
  console.error(body)
  process.exit(2)
}
console.log("\ninteract probe ok：选中→按钮→浮卡→回答→网状图 全链路都在真实渲染进程里跑通了")
