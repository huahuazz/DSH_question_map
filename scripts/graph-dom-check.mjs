/**
 * 一次性诊断：打开图之后，DOM 里到底有没有画布/节点，以及控制器状态。
 * 用法：node scripts/graph-dom-check.mjs <cdp端口>
 */

const port = process.argv[2] ?? "9350"
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

console.log("state:", await evaluate("JSON.stringify({ graphOpen: window.__lateralAsk.state().graphOpen, nodes: window.__lateralAsk.state().nodes.length, current: null })"))
console.log("before open:", await evaluate("JSON.stringify({ graphs: document.querySelectorAll('.dla-graph').length, svgs: document.querySelectorAll('svg.dla-svg').length, nodes: document.querySelectorAll('.dla-node').length })"))
await evaluate("window.__lateralAsk.openGraph()")
await sleep(1500)
console.log("after open:", await evaluate("JSON.stringify({ graphOpen: window.__lateralAsk.state().graphOpen, graphs: document.querySelectorAll('.dla-graph').length, svgs: document.querySelectorAll('svg.dla-svg').length, nodes: document.querySelectorAll('.dla-node').length, anchors: document.querySelectorAll('.dla-anchor').length, bar: document.querySelector('.dla-graph-bar') ? document.querySelector('.dla-graph-bar').textContent : null })"))
console.log("layer html head:", await evaluate("(document.querySelector('.dla-layer') ? document.querySelector('.dla-layer').innerHTML.slice(0, 300) : null)"))
socket.close()
