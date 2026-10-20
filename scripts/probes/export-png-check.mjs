/**
 * 导出管线校验：SVG 文本 → Image → Canvas → PNG dataURL。
 * （下载那一下靠 `a.click()`，无头环境不落盘，这里验证到 PNG 编码这一步。）
 *
 * 用法：node scripts/export-png-check.mjs <cdp端口>
 */

const port = process.argv[2] ?? "9352"
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

// 先确保图里有内容（有提问才好看）
await evaluate("window.__lateralAsk.state().nodes.length === 0 ? window.__lateralAsk.ask('导出测试', '这是一段引文') : null")
await new Promise((done) => setTimeout(done, 3000))

const result = await evaluate(`(async () => {
  const svg = window.__lateralAsk.exportSvg('追问网格')
  if (typeof svg !== 'string' || svg.indexOf('<svg') !== 0) return { ok: false, reason: 'svg text bad' }
  const url = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg)
  const image = new Image()
  const loaded = await new Promise(function (resolve) {
    image.onload = function () { resolve(true) }
    image.onerror = function () { resolve(false) }
    image.src = url
  })
  if (!loaded) return { ok: false, reason: 'image failed to load' }
  const canvas = document.createElement('canvas')
  canvas.width = Math.max(1, image.width * 2)
  canvas.height = Math.max(1, image.height * 2)
  const context = canvas.getContext('2d')
  if (context === null) return { ok: false, reason: 'no 2d context' }
  context.fillStyle = '#ffffff'
  context.fillRect(0, 0, canvas.width, canvas.height)
  context.scale(2, 2)
  context.drawImage(image, 0, 0)
  const dataUrl = canvas.toDataURL('image/png')
  return { ok: dataUrl.indexOf('data:image/png') === 0, width: canvas.width, height: canvas.height, pngChars: dataUrl.length, svgChars: svg.length }
})()`)

console.log("导出管线 →", JSON.stringify(result))
socket.close()
process.exit(result?.ok === true ? 0 : 1)
