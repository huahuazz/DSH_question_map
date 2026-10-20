/**
 * 无头浏览器探针：连到已经开着的 Chrome/Edge（`--remote-debugging-port`），
 * 在真实渲染进程里求值，用来验证"插件模块真的执行了、浮层真的渲染了"。
 *
 * 用法：
 *   1. 先起一个带调试端口的无头浏览器：
 *        msedge --headless=new --remote-debugging-port=9333 --user-data-dir=<tmp> <url>
 *   2. node scripts/headless-probe.mjs 9333
 *
 * 输出一组断言结果；任何一项不满足都以非零退出码结束。
 */

const port = process.argv[2] ?? "9333"
const base = `http://127.0.0.1:${port}`

async function getTargets() {
  for (let attempt = 0; attempt < 40; attempt += 1) {
    try {
      const response = await fetch(`${base}/json/list`)
      if (response.ok) {
        const list = await response.json()
        const page = list.find((target) => target.type === "page")
        if (page !== undefined) return page
      }
    } catch (_notReady) {
      /* 浏览器刚起，端口还没监听 */
    }
    await new Promise((done) => setTimeout(done, 500))
  }
  throw new Error("no debuggable page target appeared")
}

/** 最小 CDP 客户端：只用到 Runtime.evaluate。 */
class Cdp {
  constructor(webSocketUrl) {
    this.socket = new WebSocket(webSocketUrl)
    this.nextId = 1
    this.pending = new Map()
    this.opened = new Promise((resolve, reject) => {
      this.socket.addEventListener("open", () => resolve())
      this.socket.addEventListener("error", (event) => reject(event.error ?? new Error("websocket error")))
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
    if (response.error !== undefined) throw new Error(JSON.stringify(response.error))
    const result = response.result?.result
    if (response.result?.exceptionDetails !== undefined) {
      return { exception: response.result.exceptionDetails.text ?? "evaluation failed" }
    }
    return result?.value
  }

  close() {
    this.socket.close()
  }
}

const target = await getTargets()
console.log(`page: ${target.url.slice(0, 80)}…`)
const cdp = new Cdp(target.webSocketDebuggerUrl)

const probes = {
  "插件调试句柄存在": "typeof window.__lateralAsk === 'object' && window.__lateralAsk !== null",
  "浮层容器已挂载": "document.querySelectorAll('[data-lateral-ask]').length",
  "入口按钮已渲染": "document.querySelectorAll('.dla-entry').length",
  "入口按钮文案": "document.querySelector('.dla-entry')?.textContent ?? null",
  "图谱节点数": "window.__lateralAsk?.state()?.nodes?.length ?? null",
  "图默认关闭": "window.__lateralAsk?.state()?.graphOpen ?? null",
  "样式表已注入": "document.querySelectorAll('style[data-plugin=\"dsh-plugin-lateral-ask\"]').length",
  "对话区已识别": "Boolean(document.querySelector('[class*=\"_centerCol\"]'))",
}

const results = {}
for (const [label, expression] of Object.entries(probes)) {
  results[label] = await cdp.evaluate(expression)
}

for (const [label, value] of Object.entries(results)) {
  console.log(`${label.padEnd(12, " ")} = ${JSON.stringify(value)}`)
}

const failures = []
if (results["插件调试句柄存在"] !== true) failures.push("__lateralAsk 不存在：插件模块没有执行")
if (results["浮层容器已挂载"] < 1) failures.push("没有 [data-lateral-ask] 容器：slot 注册没生效")
if (results["入口按钮已渲染"] < 1) failures.push("没有 .dla-entry：根组件没有渲染")
if (results["样式表已注入"] < 1) failures.push("插件样式表没有注入")
if (results["图默认关闭"] !== false) failures.push("初始状态 graphOpen 应为 false")

cdp.close()

if (failures.length > 0) {
  console.error(`\nheadless probe FAILED (${failures.length})`)
  for (const failure of failures) console.error(`  - ${failure}`)
  process.exit(1)
}
console.log("\nheadless probe ok：插件在真实渲染进程里执行、浮层容器与入口按钮都已渲染")
