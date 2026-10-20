/**
 * 在验证实例里用**应用自己的输入框**发一句话，看主对话能不能拿到回答。
 * 这是区分"环境问题（模型/凭证）"与"插件调用方式问题"的关键实验。
 *
 * 用法：node scripts/composer-probe.mjs <cdp端口> [文本]
 */

const port = process.argv[2] ?? "9338"
const text = process.argv[3] ?? "只用一句话回答：1+1 等于几？"
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

// 聚焦编辑器
const focused = await evaluate(`(() => {
  const editor = document.querySelector('[contenteditable="true"]')
  if (editor === null) return { ok: false, reason: 'no contenteditable' }
  editor.focus()
  return { ok: true, tag: editor.tagName, cls: String(editor.className).slice(0, 40) }
})()`)
console.log("聚焦输入框：", focused)
if (focused?.ok !== true) process.exit(1)

// 真实键盘输入 + 回车
await send("Input.insertText", { text })
await sleep(500)
await send("Input.dispatchKeyEvent", { type: "keyDown", key: "Enter", code: "Enter", windowsVirtualKeyCode: 13, nativeVirtualKeyCode: 13 })
await send("Input.dispatchKeyEvent", { type: "keyUp", key: "Enter", code: "Enter", windowsVirtualKeyCode: 13, nativeVirtualKeyCode: 13 })
console.log("已发送，等待回答…")

let view = ""
for (let attempt = 0; attempt < 90; attempt += 1) {
  await sleep(1000)
  view = await evaluate("(document.querySelector('[class*=\"_centerCol\"]')?.innerText ?? '').slice(0, 1500)")
  if (/(等于|2|二|1\+1)/.test(view) && view.length > 120) break
  if (attempt % 10 === 0) console.log(`  ${attempt}s:`, JSON.stringify((view ?? "").slice(0, 160)))
}
console.log("\n主视图文本：")
console.log(view)

socket.close()
