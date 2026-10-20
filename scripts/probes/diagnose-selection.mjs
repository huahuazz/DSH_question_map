/**
 * 选区能力诊断：确认无头浏览器里 Selection 是否可用、以及对话区是否被
 * `user-select:none` 关掉了选中能力。
 *
 * 用法：node scripts/diagnose-selection.mjs 9333
 */

const port = process.argv[2] ?? "9333"
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

// A. 最基础的选区能力
console.log("A. body 上的选区:", await evaluate(`(() => {
  const holder = document.createElement('div')
  holder.textContent = 'abcdef'
  holder.setAttribute('style', 'position:fixed;left:0;top:0;z-index:99999;background:#fff;color:#000')
  document.body.appendChild(holder)
  const range = document.createRange()
  range.selectNodeContents(holder)
  const selection = window.getSelection()
  selection.removeAllRanges()
  selection.addRange(range)
  const parsed = { text: selection.toString(), ranges: selection.rangeCount, collapsed: selection.isCollapsed }
  holder.remove()
  return parsed
})()`))

// B. 注入块里再试一次（这次用 insertAdjacentText，确保存在真正的 Text 节点）
console.log("B. 注入块选区:", await evaluate(`(() => {
  const region = document.querySelector('[class*="_centerCol"]')
  if (region === null) return 'no region'
  const stale = document.getElementById('la-probe')
  if (stale !== null) stale.remove()
  const holder = document.createElement('div')
  holder.id = 'la-probe'
  holder.setAttribute('style', 'position:absolute;left:48px;top:48px;z-index:9;padding:8px 12px;background:#fff;color:#111;font:14px/1.6 sans-serif;user-select:text;-webkit-user-select:text;border:1px solid #ccc')
  holder.insertAdjacentText('afterbegin', '锚定浮卡是一种贴着选区展开的卡片')
  region.appendChild(holder)
  const textNode = holder.firstChild
  const range = document.createRange()
  range.setStart(textNode, 0)
  range.setEnd(textNode, 6)
  const selection = window.getSelection()
  selection.removeAllRanges()
  selection.addRange(range)
  return {
    textNodeType: textNode.nodeType,
    text: selection.toString(),
    collapsed: selection.isCollapsed,
    computedUserSelect: getComputedStyle(holder).userSelect,
    regionUserSelect: getComputedStyle(region).userSelect,
  }
})()`))

// C. 祖先链上的 user-select
console.log("C. 祖先 user-select:", await evaluate(`(() => {
  const holder = document.getElementById('la-probe')
  if (holder === null) return 'no probe'
  const chain = []
  let el = holder
  while (el !== null && el !== document.documentElement) {
    chain.push(el.tagName + ':' + getComputedStyle(el).userSelect)
    el = el.parentElement
  }
  return chain
})()`))

socket.close()
