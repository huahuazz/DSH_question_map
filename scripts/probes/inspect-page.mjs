/**
 * 页面检查工具：连到已开着的无头浏览器，打印对话区的可选中文本与几何信息，
 * 用来判断"为什么小按钮没出现"。
 *
 * 用法：node scripts/inspect-page.mjs 9333
 */

const port = process.argv[2] ?? "9333"
const base = `http://127.0.0.1:${port}`
const list = await (await fetch(`${base}/json/list`)).json()
const page = list.find((target) => target.type === "page")
if (page === undefined) throw new Error("no page target")

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

console.log("url:", page.url)
console.log("centerCol innerText:", JSON.stringify(await evaluate("(document.querySelector('[class*=\"_centerCol\"]')?.innerText ?? '').slice(0, 300)")))
console.log("centerCol child tags:", await evaluate(`(() => {
  const region = document.querySelector('[class*="_centerCol"]')
  if (region === null) return 'no region'
  return Array.from(region.querySelectorAll('*')).slice(0, 25).map(el => {
    const rect = el.getBoundingClientRect()
    return el.tagName + (el.className ? '.' + String(el.className).split(' ')[0].slice(0, 24) : '') + ' ' + Math.round(rect.width) + 'x' + Math.round(rect.height)
  })
})()`))
console.log("text nodes:", await evaluate(`(() => {
  const region = document.querySelector('[class*="_centerCol"]')
  if (region === null) return 'no region'
  const walker = document.createTreeWalker(region, NodeFilter.SHOW_TEXT)
  const found = []
  let node = null
  while ((node = walker.nextNode()) !== null) {
    const text = (node.nodeValue ?? '').trim()
    if (text === '') continue
    const parent = node.parentElement
    const rect = parent === null ? null : parent.getBoundingClientRect()
    found.push({
      tag: parent === null ? null : parent.tagName,
      cls: parent === null ? null : String(parent.className).slice(0, 30),
      text: text.slice(0, 24),
      width: rect === null ? null : Math.round(rect.width),
      height: rect === null ? null : Math.round(rect.height),
      visible: rect === null ? null : rect.width > 0 && rect.height > 0,
    })
    if (found.length >= 10) break
  }
  return found
})()`))

socket.close()
