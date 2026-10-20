/**
 * 常驻导出按钮验收：入口按钮上方的「⤓ 导出图片」在不打开画布的情况下也能导出 PNG。
 *
 * 用法：node scripts/floating-export-check.mjs <cdp端口> <workspaceId> <下载目录>
 */

import { readdirSync, existsSync, rmSync, mkdirSync, statSync, openSync, readSync, closeSync } from "node:fs"
import { join } from "node:path"

const port = process.argv[2] ?? "9357"
const workspaceId = process.argv[3] ?? "a14c412a-b752-44ea-b356-be1d7e5b8f0a"
const downloadDir = process.argv[4] ?? join(process.env.TEMP ?? ".", "dsh-float-export")
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
const record = (step, value) => console.log(`${step} → ${typeof value === "string" ? value : JSON.stringify(value)}`)

await send("Browser.setDownloadBehavior", { behavior: "allow", downloadPath: downloadDir, eventsEnabled: true })
await sleep(300)

// 造一个提问
await evaluate(`window.__lateralAsk.ask('股票', '这只股票的估值贵不贵', { workspaceId: ${JSON.stringify(workspaceId)} })`)
for (let attempt = 0; attempt < 25; attempt += 1) {
  await sleep(1000)
  if (Number(await evaluate("document.querySelectorAll('.dla-entry-export').length")) === 1) break
}

record("① 常驻导出按钮", await evaluate(`(function () {
  var b = document.querySelector('.dla-entry-export')
  if (b === null) return { found: false }
  var r = b.getBoundingClientRect()
  return { found: true, text: b.textContent, x: Math.round(r.left), y: Math.round(r.top), w: Math.round(r.width), h: Math.round(r.height), bottom: Math.round(innerHeight - r.bottom) }
})()`))
record("② 画布是否打开", await evaluate("window.__lateralAsk.state().graphOpen"))

// 点它（不打开画布）
await evaluate("document.querySelector('.dla-entry-export').click()")
let files = []
for (let attempt = 0; attempt < 20; attempt += 1) {
  await sleep(400)
  files = readdirSync(downloadDir).filter((name) => name.endsWith(".png"))
  if (files.length > 0) break
}
record("③ 提示条", await evaluate("document.querySelector('.dla-toast') ? document.querySelector('.dla-toast').textContent : null"))
record("④ 下载文件", files)

for (const name of files) {
  const path = join(downloadDir, name)
  const header = Buffer.alloc(8)
  const fd = openSync(path, "r")
  readSync(fd, header, 0, 8, 0)
  closeSync(fd)
  const isPng = header[0] === 0x89 && header[1] === 0x50 && header[2] === 0x4e && header[3] === 0x47
  console.log(`   ${name}: ${statSync(path).size} 字节, PNG=${isPng}`)
}

socket.close()
process.exit(files.length > 0 ? 0 : 1)
