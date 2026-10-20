/**
 * 导出落盘验收：把浏览器的下载目录指到一个临时文件夹，点「导出图片」，
 * 然后检查真的生成了一个 PNG 文件（而不是只在内存里编码了一下）。
 *
 * 用法：node scripts/export-download-check.mjs <cdp端口> <下载目录>
 */

import { readdirSync, statSync, existsSync, rmSync, mkdirSync, openSync, readSync, closeSync } from "node:fs"
import { join } from "node:path"

const port = process.argv[2] ?? "9355"
const downloadDir = process.argv[3] ?? join(process.env.TEMP ?? ".", "dsh-export-check")
const base = `http://127.0.0.1:${port}`

if (existsSync(downloadDir)) rmSync(downloadDir, { recursive: true, force: true })
mkdirSync(downloadDir, { recursive: true })

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

await send("Browser.setDownloadBehavior", { behavior: "allow", downloadPath: downloadDir, eventsEnabled: true })
await sleep(300)

// 确保图里有东西
const nodeCount = Number(await evaluate("window.__lateralAsk.state().nodes.length"))
console.log("图里节点数:", nodeCount)

// 走 UI 按钮：先开图，再点「导出图片」
await evaluate("window.__lateralAsk.openGraph()")
await sleep(1000)
const clicked = await evaluate(`(() => {
  const buttons = Array.from(document.querySelectorAll('.dla-graph-bar .dla-btn'))
  const target = buttons.find(function (b) { return (b.textContent ?? '').indexOf('导出') >= 0 })
  if (target === undefined) return { ok: false, found: buttons.map(function (b) { return b.textContent }) }
  target.click()
  return { ok: true }
})()`)
console.log("点击导出按钮:", JSON.stringify(clicked))

let files = []
for (let attempt = 0; attempt < 20; attempt += 1) {
  await sleep(500)
  files = readdirSync(downloadDir).filter((name) => name.endsWith(".png") || name.endsWith(".crdownload") === false)
  if (files.some((name) => name.endsWith(".png"))) break
}

console.log("提示条:", await evaluate("document.querySelector('.dla-toast') ? document.querySelector('.dla-toast').textContent : null"))
console.log("下载目录内容:", JSON.stringify(files))

let pngOk = false
let size = 0
for (const name of files) {
  const path = join(downloadDir, name)
  size = statSync(path).size
  const header = Buffer.alloc(8)
  const fd = openSync(path, "r")
  readSync(fd, header, 0, 8, 0)
  closeSync(fd)
  const isPng = header[0] === 0x89 && header[1] === 0x50 && header[2] === 0x4e && header[3] === 0x47
  console.log(`  文件 ${name}: ${size} 字节, PNG 头=${isPng}`)
  pngOk = pngOk || isPng
}

socket.close()
if (files.length === 0 || pngOk === false) {
  console.error("\n导出落盘 FAILED：没有拿到有效的 PNG 文件")
  process.exit(1)
}
console.log("\n导出落盘 ok：真实生成了 PNG 文件并落到下载目录")
