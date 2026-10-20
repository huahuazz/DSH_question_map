/**
 * 读会话日志：把 `.jsonl.zstd` 解压出来，统计事件类型，用来回答
 * "横向会话到底有没有真的跑过一轮、模型返回了什么"。
 *
 * 用法：node scripts/read-session-log.mjs <session.jsonl.zstd 路径>
 */

import { readFileSync, readdirSync, statSync } from "node:fs"
import { join } from "node:path"
import { zstdDecompressSync } from "node:zlib"

const target = process.argv[2]
const home = process.argv[3] ?? join(process.env.TEMP ?? "", "dsh-verify-home")

function newestSessionLogs(root) {
  const found = []
  const walk = (dir, depth) => {
    if (depth > 3) return
    let entries
    try {
      entries = readdirSync(dir, { withFileTypes: true })
    } catch (_unreadable) {
      return
    }
    for (const entry of entries) {
      const path = join(dir, entry.name)
      if (entry.isDirectory()) {
        walk(path, depth + 1)
        continue
      }
      if (entry.name.endsWith(".jsonl.zstd")) {
        found.push({ path, mtime: statSync(path).mtimeMs, size: statSync(path).size })
      }
    }
  }
  walk(join(root, "sessions"), 0)
  return found.sort((left, right) => right.mtime - left.mtime)
}

const logs = newestSessionLogs(home)
console.log(`发现 ${logs.length} 份会话日志：`)
for (const log of logs.slice(0, 5)) {
  console.log(`  ${log.path.slice(-60)}  ${log.size}B  ${new Date(log.mtime).toISOString()}`)
}

const chosen = target ?? logs[0]?.path
if (chosen === undefined) {
  console.error("没有可读的会话日志")
  process.exit(1)
}
console.log(`\n读取：${chosen}`)

const raw = readFileSync(chosen)
let text
try {
  text = zstdDecompressSync(raw).toString("utf8")
} catch (error) {
  console.error(`解压失败（可能是多帧追加日志，需逐帧解）：${String(error)}`)
  // 多帧：逐个 zstd 帧解压
  const frames = []
  let offset = 0
  const magic = Buffer.from([0x28, 0xb5, 0x2f, 0xfd])
  while (offset < raw.length) {
    const next = raw.indexOf(magic, offset + 1)
    const end = next === -1 ? raw.length : next
    try {
      frames.push(zstdDecompressSync(raw.subarray(offset, end)).toString("utf8"))
    } catch (_frameFailure) {
      /* 跳过坏帧 */
    }
    if (next === -1) break
    offset = next
  }
  text = frames.join("")
}

const lines = text.split("\n").filter((line) => line.trim() !== "")
const counts = new Map()
for (const line of lines) {
  try {
    const record = JSON.parse(line)
    const event = record.event ?? record
    const type = event.type ?? record.type ?? "unknown"
    counts.set(type, (counts.get(type) ?? 0) + 1)
  } catch (_notJson) {
    counts.set("(unparseable)", (counts.get("(unparseable)") ?? 0) + 1)
  }
}
console.log(`事件数：${lines.length}`)
for (const [type, count] of [...counts.entries()].sort((left, right) => right[1] - left[1])) {
  console.log(`  ${type.padEnd(28)} ${count}`)
}

// 打印与失败/回答相关的片段
console.log("\n关键事件片段：")
for (const line of lines) {
  if (/(agent\/error|turn\/start|assistant\/message|request\/error|error)/i.test(line) === false) continue
  console.log(`  ${line.slice(0, 300)}`)
}
