/**
 * 在小工具里做一次页面导航（带 token 的启动 URL → 换成 cookie 后的根 URL）。
 * 用法：node scripts/navigate.mjs 9335 "http://127.0.0.1:43198/?token=..."
 */

const port = process.argv[2] ?? "9335"
const url = process.argv[3]
if (url === undefined) throw new Error("usage: node scripts/navigate.mjs <port> <url>")

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
const send = (method, params) => new Promise((resolve) => {
  const id = ++nextId
  pending.set(id, resolve)
  socket.send(JSON.stringify({ id, method, params }))
})

await send("Page.enable", {})
await send("Page.navigate", { url })
await new Promise((done) => setTimeout(done, 8000))
const current = await send("Runtime.evaluate", { expression: "location.href", returnByValue: true })
console.log("now at:", current.result?.result?.value ?? "(unknown)")
socket.close()
