/**
 * dsh-plugin-question-map — 浏览器半边。
 *
 * 选中对话里的任意文字 → 旁边冒出一个小按钮 → 点开一张锚定浮卡，在一个**空上下文**的
 * 新会话里只问这个词；卡内可以继续追问，也可以在答案里再选词，长出一个子节点。
 * 所有节点连成一张可以缩放浏览的网状图，随主会话分组，持久化在宿主设置文档里。
 *
 * 本文件是 DSH 客户端插件 bundle（`window.__ModuleLoader__.load` 格式），刻意零构建：
 * 只用平台共享的 8 个模块，组件走 `React.createElement`，样式自注入。
 *
 * 设计文档：docs/superpowers/specs/2026-10-19-lateral-ask-design.md
 */
window.__ModuleLoader__.load({
	id: "dsh-plugin-question-map",
	factory: (require) => {
		const React = require("react")
		const primitives = require("@deepseek-ai/dsh-client-ui-primitives")
		const { createPortal } = require("react-dom")
		const h = React.createElement
		const { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } = React
		const MarkdownText = primitives.MarkdownText

		//#region 常量与文案
		/** 设置命名空间，与 `lib/index.js` 注册的一致。 */
		/** 浏览器本地存储键（0.2.x 起宿主不再提供客户端 settings 命名空间服务）。 */
		const STORAGE_KEY = "dsh-question-map:graph"
		/** 命名空间里承载整张图的字段名。 */
		const SETTINGS_FIELD = "graph"
		/** 浮卡固定宽度（px）。 */
		const CARD_WIDTH = 380
		/** 引文最多保留的字符数（提问与展示都用它）。 */
		const QUOTE_LIMIT = 1200
		/** 节点标签最多显示的字符数。 */
		const LABEL_LIMIT = 18
		/** 会话标题里用的前缀，方便在侧边栏认出横向会话。 */
		const TITLE_PREFIX = "⟂ "

		/** 中文词典（键集来源）。 */
		const zh = {
			"entry.label": "追问网",
			"entry.title": "打开横向提问的网状图",
			"ask.button": "追问",
			"card.title": "横向提问",
			"card.creating": "正在新建会话…",
			"card.retry": "重试",
			"card.open": "在主页打开",
			"card.openSession": "打开会话",
			"card.pin": "固定",
			"card.unpin": "取消固定",
			"card.close": "关闭",
			"card.stop": "停止",
			"card.send": "发送",
			"card.placeholder": "继续追问…（Enter 发送，Shift+Enter 换行）",
			"card.noWorkspace": "无工作目录，回答可能没有工具能力",
			"card.thinking": "思考中…",
			"card.opening": "正在打开横向会话…",
			"card.diag": "（诊断：{status}）",
			"card.fallback": "回答进行中，请在主页查看完整对话",
			"card.error": "出错了",
			"card.createFailed": "新建会话失败",
			"card.promptFailed": "提问失败",
			"card.disconnected": "连接中断",
			"graph.title": "追问网",
			"graph.empty": "还没有横向提问。选中一段文字开始吧。",
			"graph.fit": "适应画布",
			"graph.close": "关闭",
			"graph.count": "{n} 个节点",
			"graph.anchor": "本次对话",
			"graph.anchorNone": "未归属提问",
			"graph.openSession": "回到这个提问的会话",
			"graph.export": "导出图片",
			"graph.exportTip": "把当前追问网导出成 PNG 图片",
			"graph.exportName": "追问网",
			"source.main": "来自本次对话",
			"source.node": "来自节点「{label}」",
			"source.unnamed": "未归属",
		}

		/** 英文词典，键集与中文一致。 */
		const en = {
			"entry.label": "Ask-net",
			"entry.title": "Open the lateral question network",
			"ask.button": "Ask",
			"card.title": "Lateral question",
			"card.creating": "Creating a session…",
			"card.retry": "Retry",
			"card.open": "Open in main view",
			"card.openSession": "Open session",
			"card.pin": "Pin",
			"card.unpin": "Unpin",
			"card.close": "Close",
			"card.stop": "Stop",
			"card.send": "Send",
			"card.placeholder": "Follow up… (Enter to send, Shift+Enter for a new line)",
			"card.noWorkspace": "No working directory; answers may lack tool access",
			"card.thinking": "Thinking…",
			"card.opening": "Opening the side session…",
			"card.diag": "(diag: {status})",
			"card.fallback": "Still answering — open the main view to read it",
			"card.error": "Something went wrong",
			"card.createFailed": "Could not create the session",
			"card.promptFailed": "The question was not accepted",
			"card.disconnected": "Connection lost",
			"graph.title": "Question network",
			"graph.empty": "No lateral questions yet. Select some text to start.",
			"graph.fit": "Fit",
			"graph.close": "Close",
			"graph.count": "{n} nodes",
			"graph.anchor": "This conversation",
			"graph.anchorNone": "Unattached",
			"graph.openSession": "Open this question's session",
			"graph.export": "Export image",
			"graph.exportTip": "Export the question network as a PNG",
			"graph.exportName": "question-network",
			"source.main": "from this conversation",
			"source.node": "from node “{label}”",
			"source.unnamed": "unattached",
		}
		//#endregion

		//#region 样式
		/** 自注入样式表；所有类名带 `dla-` 前缀，避免与 DSH 自身的样式冲突。 */
		const CSS = `
.dla-layer{position:fixed;inset:0;z-index:2147483000;pointer-events:none!important;font:inherit}
.dla-layer>*{pointer-events:auto!important}
.dla-entry{position:fixed;right:18px;bottom:18px;z-index:2147483001;display:inline-flex;align-items:center;gap:6px;height:34px;padding:0 12px;border-radius:17px;border:1px solid var(--dsw-alias-border-l2,#d8dce3);background:var(--dsw-alias-bg-layer-1,#fff);color:var(--dsw-alias-label-secondary,#4b5563);box-shadow:0 4px 16px rgba(0,0,0,.12);cursor:pointer;font-size:13px;line-height:1}
.dla-entry:hover{background:var(--dsw-alias-interactive-bg-hover,#f3f4f6);color:var(--dsw-alias-label-primary,#111827)}
.dla-entry[data-active]{border-color:var(--dsw-alias-brand-primary,#4d6bfe);color:var(--dsw-alias-brand-primary,#4d6bfe)}
.dla-entry-export{bottom:60px}
.dla-entry-icon{font-size:15px;line-height:1}
.dla-entry-badge{min-width:18px;height:18px;padding:0 5px;border-radius:9px;background:var(--dsw-alias-brand-primary,#4d6bfe);color:#fff;font-size:11px;display:inline-flex;align-items:center;justify-content:center}
.dla-ask{position:fixed;display:inline-flex;align-items:center;gap:4px;height:28px;padding:0 10px;border-radius:14px;border:1px solid var(--dsw-alias-border-l2,#d8dce3);background:var(--dsw-alias-bg-layer-1,#fff);color:var(--dsw-alias-label-primary,#111827);box-shadow:0 4px 14px rgba(0,0,0,.16);cursor:pointer;font-size:12px;line-height:1;white-space:nowrap}
.dla-ask:hover{border-color:var(--dsw-alias-brand-primary,#4d6bfe);color:var(--dsw-alias-brand-primary,#4d6bfe)}
.dla-card{position:fixed;display:flex;flex-direction:column;width:${CARD_WIDTH}px;max-height:min(70vh,560px);border-radius:12px;border:1px solid var(--dsw-alias-border-l2,#d8dce3);background:var(--dsw-alias-bg-layer-1,#fff);color:var(--dsw-alias-label-primary,#111827);box-shadow:0 12px 40px rgba(0,0,0,.18);overflow:hidden}
.dla-card-head{display:flex;align-items:flex-start;gap:8px;padding:10px 12px;border-bottom:1px solid var(--dsw-alias-border-l1,#e5e7eb);cursor:grab;user-select:none}
.dla-card-head[data-dragging]{cursor:grabbing}
.dla-card-title{flex:1;min-width:0}
.dla-card-term{font-size:13px;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.dla-card-source{margin-top:3px;font-size:11px;color:var(--dsw-alias-label-tertiary,#8b95a5);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.dla-icon-btn{width:24px;height:24px;border:none;border-radius:6px;background:transparent;color:var(--dsw-alias-label-tertiary,#8b95a5);cursor:pointer;font-size:13px;line-height:1;display:inline-flex;align-items:center;justify-content:center;flex:none}
.dla-icon-btn:hover{background:var(--dsw-alias-interactive-bg-hover,#f3f4f6);color:var(--dsw-alias-label-primary,#111827)}
.dla-icon-btn[data-pinned]{color:var(--dsw-alias-brand-primary,#4d6bfe)}
.dla-link-btn{height:24px;padding:0 8px;border:1px solid var(--dsw-alias-border-l2,#d8dce3);border-radius:6px;background:transparent;color:var(--dsw-alias-label-secondary,#4b5563);font-size:12px;line-height:1;cursor:pointer;white-space:nowrap}
.dla-link-btn:hover{border-color:var(--dsw-alias-brand-primary,#4d6bfe);color:var(--dsw-alias-brand-primary,#4d6bfe)}
.dla-toast{position:fixed;right:18px;bottom:64px;max-width:340px;padding:8px 12px;border-radius:10px;background:var(--dsw-alias-state-error-primary,#d93025);color:#fff;font-size:12px;line-height:1.5;box-shadow:0 6px 20px rgba(0,0,0,.25)}
.dla-toast[data-tone=info]{background:var(--dsw-alias-state-success-primary,#12a150)}
.dla-card-body{flex:1;min-height:60px;overflow-y:auto;padding:10px 12px;display:flex;flex-direction:column;gap:10px}
.dla-notice{font-size:11px;line-height:1.5;color:var(--dsw-alias-label-tertiary,#8b95a5)}
.dla-error{font-size:12px;line-height:1.5;color:var(--dsw-alias-state-error-primary,#d93025);word-break:break-word}
.dla-msg{font-size:13px;line-height:1.6}
.dla-msg[data-role=user]{align-self:flex-end;max-width:88%;padding:6px 10px;border-radius:10px;background:var(--dsw-alias-bg-layer-2,#f3f4f6);color:var(--dsw-alias-label-secondary,#4b5563);white-space:pre-wrap;word-break:break-word}
.dla-msg[data-role=assistant]{align-self:stretch}
.dla-msg[data-role=assistant] p{margin:0 0 8px}
.dla-msg[data-role=assistant] p:last-child{margin-bottom:0}
.dla-card-foot{display:flex;flex-direction:column;gap:8px;padding:10px 12px;border-top:1px solid var(--dsw-alias-border-l1,#e5e7eb)}
.dla-input{width:100%;box-sizing:border-box;min-height:58px;max-height:140px;resize:vertical;padding:8px 10px;border-radius:8px;border:1px solid var(--dsw-alias-border-l2,#d8dce3);background:transparent;color:inherit;font:inherit;font-size:13px;line-height:1.5}
.dla-input:focus{outline:none;border-color:var(--dsw-alias-brand-primary,#4d6bfe)}
.dla-actions{display:flex;align-items:center;gap:8px;justify-content:flex-end}
.dla-btn{height:28px;padding:0 12px;border-radius:8px;border:1px solid var(--dsw-alias-border-l2,#d8dce3);background:transparent;color:var(--dsw-alias-label-secondary,#4b5563);font-size:12px;cursor:pointer}
.dla-btn:hover{background:var(--dsw-alias-interactive-bg-hover,#f3f4f6)}
.dla-btn[data-primary]{border-color:transparent;background:var(--dsw-alias-brand-primary,#4d6bfe);color:#fff}
.dla-btn[data-primary]:disabled{opacity:.5;cursor:default}
.dla-graph{position:fixed;inset:0;z-index:2147483000;display:flex;flex-direction:column;gap:10px;padding:14px;background:color-mix(in srgb, var(--dsw-alias-bg-overlay,#000) 42%, transparent);backdrop-filter:blur(2px)}
.dla-graph-bar{display:flex;align-items:center;gap:10px;flex-wrap:wrap;padding:10px 14px;border-radius:12px;background:rgba(17,24,39,.88);color:#fff;font-size:13px;box-shadow:0 8px 24px rgba(0,0,0,.35)}
.dla-graph-title{font-weight:600}
.dla-graph-count{color:rgba(255,255,255,.72);font-size:12px}
.dla-graph-spacer{flex:1}
.dla-graph-bar .dla-btn{height:30px;padding:0 12px;border-color:rgba(255,255,255,.36);color:#fff;background:rgba(255,255,255,.12);font-size:13px}
.dla-graph-bar .dla-btn:hover{background:rgba(255,255,255,.24)}
.dla-graph-canvas{flex:1;min-height:0;border-radius:12px;background:var(--dsw-alias-bg-layer-1,#fff);color:var(--dsw-alias-label-primary,#111827);overflow:hidden;position:relative}
.dla-graph-empty{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;font-size:13px;color:var(--dsw-alias-label-tertiary,#8b95a5)}
.dla-svg{display:block;width:100%;height:100%;cursor:grab}
.dla-svg[data-panning]{cursor:grabbing}
.dla-node{cursor:pointer}
.dla-node rect{fill:var(--dsw-alias-bg-layer-2,#f3f4f6);stroke:var(--dsw-alias-border-l2,#d8dce3)}
.dla-node:hover rect{stroke:var(--dsw-alias-brand-primary,#4d6bfe)}
.dla-node[data-running] rect{stroke:var(--dsw-alias-brand-primary,#4d6bfe)}
.dla-node text{font-size:12px;fill:var(--dsw-alias-label-primary,#111827);dominant-baseline:middle;pointer-events:none}
.dla-node-open{cursor:pointer}
.dla-node-open circle{fill:var(--dsw-alias-bg-layer-1,#fff);stroke:var(--dsw-alias-border-l2,#d8dce3)}
.dla-node-open text{font-size:11px;fill:var(--dsw-alias-label-secondary,#4b5563);text-anchor:middle;dominant-baseline:central;pointer-events:none}
.dla-node-open:hover circle{fill:var(--dsw-alias-brand-primary,#4d6bfe);stroke:var(--dsw-alias-brand-primary,#4d6bfe)}
.dla-node-open:hover text{fill:#fff}
.dla-anchor rect{fill:var(--dsw-alias-bg-layer-2,#f3f4f6);stroke:var(--dsw-alias-border-l2,#d8dce3);stroke-dasharray:5 3}
.dla-anchor[data-current] rect{stroke:var(--dsw-alias-brand-primary,#4d6bfe);stroke-dasharray:none}
.dla-anchor text{font-size:12px;fill:var(--dsw-alias-label-secondary,#4b5563);dominant-baseline:middle;pointer-events:none}
.dla-edge{fill:none;stroke:var(--dsw-alias-border-l2,#d8dce3);stroke-width:1.5}
.dla-root-label{font-size:12px;fill:var(--dsw-alias-label-tertiary,#8b95a5);dominant-baseline:middle}
`
		/** 把样式表插进 <head>（幂等）。 */
		function installStyle() {
			const id = "@question-map/style"
			if (document.querySelector(`style[data-plugin-css="${id}"]`) !== null) return
			const tag = document.createElement("style")
			tag.dataset.plugin = "dsh-plugin-question-map"
			tag.dataset.pluginCss = id
			tag.textContent = CSS
			document.head.append(tag)
		}
		//#endregion

		//#region 小工具
		/** 截断字符串并按需加省略号。 */
		function truncate(text, limit) {
			const value = String(text ?? "").replace(/\s+/g, " ").trim()
			return value.length > limit ? `${value.slice(0, limit - 1)}…` : value
		}

		/** 生成本地唯一 id。 */
		function newId() {
			const random = Math.random().toString(36).slice(2, 10)
			return `la_${Date.now().toString(36)}_${random}`
		}

		/** 从一组 block 里拼出纯文本（兼容 `{kind:text}` 与 `{type:text}` 两种形状）。 */
		function blocksToText(blocks) {
			if (!Array.isArray(blocks)) return ""
			const parts = []
			for (const block of blocks) {
				if (block === null || typeof block !== "object") continue
				if (typeof block.text !== "string") continue
				if (block.kind === "text" || block.type === "text") parts.push(block.text)
			}
			return parts.join("")
		}

		/**
		 * 从 chat 目标的一个视图节点里读出文本与角色。
		 *
		 * 实测的真实形状：节点外壳是 `{ key, kind, id, target, anchorSeq, location, visibility, data }`，
		 * **载荷在 `data` 里**——用户消息是 `data.content`（`{type:'text', text}` 数组），
		 * 助手消息是 `data.blocks`，失败轮次是 `kind: 'turn-error'` 且 `data` 里带错误信息。
		 * 不认识的节点返回 null（绝不抛错）。
		 *
		 * @param wrapper - chat 视图节点。
		 * @returns `{ role, text }`，role 为 user / assistant / error；或 null。
		 */
		function readNode(wrapper) {
			if (wrapper === null || typeof wrapper !== "object") return null
			const kind = wrapper.kind
			const data = wrapper.data !== null && typeof wrapper.data === "object" ? wrapper.data : wrapper
			if (kind === "user" || kind === "steering") {
				const text = collectText(data.content) || collectText(data.blocks) || (typeof data.text === "string" ? data.text : "")
				return text.trim() === "" ? null : { role: "user", text }
			}
			if (kind === "assistant" || kind === "assistant-step" || kind === "assistant-message") {
				const text = collectText(data.blocks) || collectText(data.content) || (typeof data.text === "string" ? data.text : "")
				return text.trim() === "" ? null : { role: "assistant", text }
			}
			if (kind === "turn-error" || kind === "error") {
				const message = data.error?.message
					?? data.message
					?? data.reason?.error?.message
					?? data.reason?.message
					?? null
				if (typeof message === "string" && message.trim() !== "") return { role: "error", text: message }
				const fallback = JSON.stringify(data)
				return typeof fallback === "string" ? { role: "error", text: fallback.slice(0, 300) } : null
			}
			return null
		}

		/** 从若干候选字段里拼出文本，兼容 {kind:text} / {type:text} / 裸 text 三种形状。 */
		function collectText(value) {
			if (Array.isArray(value)) return blocksToText(value)
			return ""
		}

		/** 提问模板：只带"选中的词 + 它前后的一小段引文"，不继承任何对话历史。 */
		function buildPrompt(term, quote) {
			const clipped = String(quote ?? "").slice(0, QUOTE_LIMIT).trim()
			const lead = clipped === "" || clipped === term
				? `「${term}」这个词我不理解。`
				: `我读到这段话：\n\n「${clipped}」\n\n其中「${term}」这个词我不理解。`
			return `${lead}\n\n请只解释「${term}」：它在这里是什么意思、为什么这里用它。不要复述我贴的原文，也不要展开无关背景。`
		}

		/** 一次 prompt 的内容块。 */
		function promptContent(text) {
			return [{ type: "text", text }]
		}

		/** 选区所在的对话区域（布局中列）。找不到返回 null。 */
		function findConversationRegion() {
			const direct = document.querySelector('[class*="_centerCol"]')
			if (direct !== null) return direct
			// 兜底：从输入编辑器往上找，第一个包含编辑器、又不包含侧边栏的祖先。
			const editor = document.querySelector('[contenteditable="true"], textarea')
			if (editor === null) return null
			let current = editor.parentElement
			while (current !== null && current !== document.body) {
				const rect = current.getBoundingClientRect()
				if (rect.width >= 320 && rect.height >= 320 && current.querySelector('[class*="_sidebarCol"]') === null) return current
				current = current.parentElement
			}
			return null
		}

		/** 选区周围的一段引文。 */
		function quoteAround(range, term) {
			try {
				const startNode = range.startContainer
				const startEl = startNode.nodeType === 1 ? startNode : startNode.parentElement
				const block = startEl === null ? null : startEl.closest("p,li,td,pre,blockquote,div")
				const full = block === null ? "" : block.textContent ?? ""
				const index = full.indexOf(term)
				if (index < 0) return term
				const from = Math.max(0, index - 200)
				return full.slice(from, Math.min(full.length, index + term.length + 200)).trim()
			} catch (_failure) {
				return term
			}
		}
		//#endregion

		//#region 控制器：选区、线程、图、持久化
		/**
		 * 唯一的状态持有者。组件只读它的快照，所有副作用（建会话、订阅回答、写图）都在这里。
		 */
		class LateralController {
			constructor(ctx) {
				this.ctx = ctx
				this.listeners = new Set()
				this.state = {
					graphStatus: "init",
					nodes: [],
					button: null,
					card: null,
					graphOpen: false,
					threadsVersion: 0,
				}
				/** sessionId → { sessionId, messages, running, error, loaded, dispose } */
				this.threads = new Map()
				/** sessionId → sessions.retain() 引用（0.2.x 需要保留会话才拿得到 binding）。 */
				this.retained = new Map()
				/** 正在创建的卡片（还没有节点身份）。 */
				this.pending = null
				this.scope = null
				this.writeTimer = null
				this.disposeWatcher = null
				this.toggleGraph = this.toggleGraph.bind(this)
				this.askFromAnchor = this.askFromAnchor.bind(this)
				this.subscribe = this.subscribe.bind(this)
				this.getSnapshot = this.getSnapshot.bind(this)
			}

			// ---- 快照与订阅 ----
			/** @returns 当前快照（引用稳定，只有 notify 时更换）。 */
			getSnapshot() {
				return this.state
			}

			/** @param listener - 变更回调 @returns 取消订阅 */
			subscribe(listener) {
				this.listeners.add(listener)
				return () => {
					this.listeners.delete(listener)
				}
			}

			/** 发布一次新快照。 */
			notify() {
				this.state = { ...this.state, threadsVersion: this.state.threadsVersion + 1 }
				for (const listener of [...this.listeners]) {
					try {
						listener()
					} catch (error) {
						console.error("[question-map] listener failed:", error)
					}
				}
			}

			/** 启动：样式、持久化、选区监听、调试句柄。 */
			start() {
				installStyle()
				this.attachStorage()
				this.installSelectionWatcher()
				globalThis.__questionMap = {
					state: () => this.state,
					threads: () => Object.fromEntries([...this.threads.entries()].map(([sessionId, thread]) => [sessionId, {
						loaded: thread.loaded,
						running: thread.running,
						messages: thread.messages.length,
						sendError: thread.sendError ?? null,
						streamError: thread.streamError ?? null,
						promptError: thread.promptError ?? null,
						diag: thread.diag ?? null,
						diag: thread.diag ?? null,
					}])),
					view: (sessionId) => {
						try {
							const snapshot = this.ctx.uiConversation.binding(sessionId).target("chat").getSnapshot()
							const order = Array.isArray(snapshot?.order) ? snapshot.order : []
							const store = snapshot?.nodes
							const rows = []
							for (const key of order) {
								const node = store !== undefined && store !== null && typeof store.get === "function" ? store.get(key) : undefined
								if (node === undefined || node === null) {
									rows.push({ key: String(key), kind: null, keys: [] })
									continue
								}
								rows.push({ key: String(key), kind: node.kind ?? null, keys: Object.keys(node), json: JSON.stringify(node.data ?? node).slice(0, 900) })
							}
							return rows
						} catch (error) {
							return [{ error: error instanceof Error ? error.message : String(error) }]
						}
					},
					raw: (sessionId) => {
						try {
							const view = this.ctx.uiConversation.binding(sessionId).target("chat").getSnapshot()
							const order = view === undefined || view === null ? undefined : view.order
							const nodes = view === undefined || view === null ? undefined : view.nodes
							const firstKey = Array.isArray(order) && order.length > 0 ? order[0] : undefined
							const sample = firstKey === undefined || nodes === undefined || typeof nodes.get !== "function"
								? null
								: JSON.stringify(nodes.get(firstKey), (key, value) => (typeof value === "function" ? "[fn]" : value))
							return {
								viewKeys: view === undefined ? "undefined" : view === null ? "null" : Object.keys(view),
								orderIsArray: Array.isArray(order),
								orderLength: Array.isArray(order) ? order.length : null,
								nodesIsMap: nodes instanceof Map,
								nodeCount: nodes !== undefined && nodes !== null && typeof nodes.size === "number" ? nodes.size : null,
								sample: sample === null ? null : sample.slice(0, 400),
							}
						} catch (error) {
							return { error: error instanceof Error ? error.message : String(error) }
						}
					},
					refresh: (sessionId) => this.refreshThread(sessionId),
					exportSvg: (title) => buildGraphSvg(this.state.nodes, layoutGraph(this.state.nodes, (rootSessionId) => this.sessionTitle(rootSessionId)), title ?? "lateral-ask"),
					exportPng: () => this.exportImage(this.state.nodes, "追问网"),
					newSession: async () => {
						const id = await this.ctx.sessions.create({})
						this.ctx.sessions.open(id)
						return id
					},
					openGraph: () => this.toggleGraph(),
					clear: () => this.clearGraph(),
					ask: (term, quote, options) => this.ask({ term, quote, anchorRect: null, parent: options?.parent ?? null, cwdOverride: options?.cwd, workspaceIdOverride: options?.workspaceId }),
				}
			}

			/** 卸载：解除监听、断开线程、清掉调试句柄。 */
			dispose() {
				this.disposeWatcher?.()
				this.disposeWatcher = null
				// 恢复用的会话订阅（只在本地存储为空时挂在 list 上）。
				if (typeof this.recoveryOff === "function") this.recoveryOff()
				this.recoveryOff = undefined
				for (const thread of this.threads.values()) {
					thread.dispose?.()
					if (thread.pollTimer !== undefined && thread.pollTimer !== null) clearInterval(thread.pollTimer)
				}
				this.threads.clear()
				for (const reference of this.retained.values()) {
					try {
						reference.release?.()
					} catch (_failure) {
						// 释放失败不影响卸载。
					}
				}
				this.retained.clear()
				if (this.writeTimer !== null) {
					clearTimeout(this.writeTimer)
					this.writeTimer = null
				}
				if (globalThis.__questionMap !== undefined) delete globalThis.__questionMap
			}

			// ---- 持久化（浏览器本地存储；0.2.x 起宿主不再暴露 settingsScope 服务） ----
			/** 读出本地保存的图；读不到就当空图，绝不抛错。 */
			attachStorage() {
				try {
					if (globalThis.localStorage === undefined) throw new Error("localStorage unavailable")
					const raw = globalThis.localStorage.getItem(STORAGE_KEY)
					let stored = []
					if (typeof raw === "string" && raw.trim() !== "") {
						const parsed = JSON.parse(raw)
						if (parsed !== null && Array.isArray(parsed.nodes)) {
							stored = parsed.nodes.filter((node) => node !== null && typeof node.id === "string")
						}
					}
					const merged = new Map()
					for (const node of stored) merged.set(node.id, node)
					for (const node of this.state.nodes) {
						const existing = merged.get(node.id)
						if (existing === undefined || (node.updatedAt ?? 0) > (existing.updatedAt ?? 0)) merged.set(node.id, node)
					}
					this.state = { ...this.state, nodes: [...merged.values()], graphStatus: "ready" }
					// 本地一条记录都没有（首次安装 / 从宿主设置存储迁移过来）：拿已有会话把图补回来。
					this.storageWasEmpty = raw === null || raw.trim() === ""
					if (this.storageWasEmpty) this.tryRecover()
				} catch (error) {
					console.warn("[question-map] reading the stored graph failed:", error)
					this.state = { ...this.state, graphStatus: "unavailable" }
				}
				this.notify()
			}

			/**
			 * 尝试从会话恢复一次；会话列表此刻可能还没加载完，那就挂一个一次性订阅，
			 * 等列表真的有数据时再补——否则"启动太早"会让恢复永远不发生。
			 */
			tryRecover() {
				if (this.state.nodes.length > 0) return
				if (this.recoverFromSessions() > 0) return
				if (typeof this.recoveryOff === "function") return
				try {
					const list = this.ctx.sessions?.list
					if (list === undefined || typeof list.subscribe !== "function") return
					this.recoveryOff = list.subscribe(() => {
						if (this.state.nodes.length > 0 || this.storageWasEmpty !== true) {
							if (typeof this.recoveryOff === "function") this.recoveryOff()
							this.recoveryOff = undefined
							return
						}
						if (this.recoverFromSessions() > 0) {
							if (typeof this.recoveryOff === "function") this.recoveryOff()
							this.recoveryOff = undefined
							this.notify()
						}
					})
				} catch (_failure) {
					// 订阅不上就算了：下次启动还会再试一次。
				}
			}

			/**
			 * 从既有会话重建追问网：横向会话的标题都以 `⟂` 开头，标题就是当初问的那个词。
			 * 只在本地存储为空时执行一次，避免每次启动都重复导入。
			 */
			recoverFromSessions() {
				try {
					const snapshot = this.ctx.sessions.list.getSnapshot()
					const byId = snapshot?.byId
					if (byId === undefined || byId === null) return 0
					const now = Date.now()
					const recovered = []
					for (const sessionId of Object.keys(byId)) {
						const summary = byId[sessionId]
						const title = typeof summary?.title === "string" ? summary.title.trim() : ""
						if (title.startsWith(TITLE_PREFIX) === false) continue
						const term = title.slice(TITLE_PREFIX.length).trim()
						if (term === "" || term === "追问网") continue
						recovered.push({
							id: `recovered-${sessionId}`,
							sessionId,
							rootSessionId: null,
							workspaceId: this.workspaceOf(sessionId),
							term,
							quote: "",
							question: term,
							parent: { kind: "anchor", sessionId: null },
							createdAt: summary?.updatedAt ?? now,
							updatedAt: summary?.updatedAt ?? now,
							recovered: true,
						})
					}
					if (recovered.length === 0) return 0
					console.info("[question-map] recovered", recovered.length, "lateral sessions into the graph")
					this.state = { ...this.state, nodes: [...this.state.nodes, ...recovered] }
					this.saveGraph()
					return recovered.length
				} catch (error) {
					console.warn("[question-map] recovering the graph from sessions failed:", error)
					return 0
				}
			}

			/** 防抖 300ms 后把整张图写回本地存储。 */
			saveGraph() {
				if (this.writeTimer !== null) clearTimeout(this.writeTimer)
				this.writeTimer = setTimeout(() => {
					this.writeTimer = null
					try {
						if (globalThis.localStorage === undefined) return
						globalThis.localStorage.setItem(STORAGE_KEY, JSON.stringify({ version: 1, nodes: this.state.nodes }))
						this.state = { ...this.state, graphStatus: "ready" }
					} catch (error) {
						console.warn("[question-map] saving the graph failed:", error)
						this.state = { ...this.state, graphStatus: "unavailable" }
					}
				}, 300)
			}

			/**
			 * 当前会话所属的工作区 id（DSH 只有用 workspaceId 才会把新会话挂进工作区）。
			 * @param sessionId - 主会话 id。
			 * @returns 工作区 id，判断不出来时 undefined。
			 */
			workspaceOf(sessionId) {
				if (sessionId === undefined || sessionId === null) return undefined
				try {
					const snapshot = this.ctx.workspaces?.list?.getSnapshot?.()
					const items = Array.isArray(snapshot?.items) ? snapshot.items : []
					const owner = items.find((item) => Array.isArray(item.sessionIds) && item.sessionIds.includes(sessionId))
					return owner?.workspaceId
				} catch (_failure) {
					return undefined
				}
			}

			/** 当前主视图里的会话 id（用来在图上标出"当前"锚点）。 */
			currentRootId() {
				try {
					const snapshot = this.ctx.sessions.list.getSnapshot()
					return snapshot === undefined || snapshot === null ? null : snapshot.current ?? null
				} catch (_failure) {
					return null
				}
			}

			/** 供 `useSyncExternalStore` 用的会话订阅（函数身份稳定）。 */
			subscribeSessions = (listener) => {
				try {
					const list = this.ctx.sessions.list
					return typeof list.subscribe === "function" ? list.subscribe(listener) : () => {}
				} catch (_failure) {
					return () => {}
				}
			}

			/** 当前会话 id，供 `useSyncExternalStore` 取值（字符串或 null，引用稳定）。 */
			currentSessionId = () => this.currentRootId()

			/**
			 * 读会话标题：图上的锚点用它显示"真实的对话内容"，而不是一个空标签。
			 * @param sessionId - 会话 id。
			 * @returns 标题；取不到时 undefined。
			 */
			sessionTitle(sessionId) {
				if (sessionId === undefined || sessionId === null) return undefined
				try {
					const snapshot = this.ctx.sessions.list.getSnapshot()
					const summary = snapshot?.byId?.[sessionId]
					const title = summary?.title
					if (typeof title === "string" && title.trim() !== "") return title.trim()
					// 新会话可能还没有标题：退回工作目录名，至少让人认出是哪个对话。
					const cwd = summary?.cwd
					if (typeof cwd === "string" && cwd.trim() !== "") {
						const segments = cwd.trim().replace(/[\\/]+$/u, "").split(/[\\/]/u)
						const last = segments[segments.length - 1]
						if (typeof last === "string" && last !== "") return last
					}
					return undefined
				} catch (_failure) {
					return undefined
				}
			}

			/**
			 * 判断一个会话与"追问网"的关系：它本身是某张图的根会话，或者它本身就是一个横向提问会话。
			 * @param sessionId - 当前会话 id。
			 * @returns `null` 表示与追问无关（入口按钮不该出现）；否则 `{ root }`，root 是它所属的图。
			 */
			relatedGraph(sessionId) {
				if (sessionId === undefined || sessionId === null) return null
				for (const node of this.state.nodes) {
					if (node.sessionId === sessionId) return { root: node.rootSessionId ?? null }
				}
				for (const node of this.state.nodes) {
					if (node.rootSessionId === sessionId) return { root: sessionId }
				}
				// 从旧数据恢复出来的节点没有根会话（rootSessionId 为空）：只要在同一个工作区，
				// 就仍然算"和追问网有关"，否则这些历史追问我不到入口。
				const workspace = this.workspaceOf(sessionId)
				if (workspace !== undefined) {
					for (const node of this.state.nodes) {
						if (node.rootSessionId == null && node.workspaceId === workspace) return { root: null }
					}
				}
				return null
			}

			/** 关闭网状图（会话切到无关会话时用）。 */
			closeGraph() {
				if (this.state.graphOpen !== true) return
				this.state = { ...this.state, graphOpen: false }
				this.notify()
			}

			/** 节点查找。 */
			nodeById(nodeId) {
				return this.state.nodes.find((node) => node.id === nodeId) ?? null
			}

			/** 新增或更新一个节点并触发保存。 */
			upsertNode(node) {
				const nodes = this.state.nodes.slice()
				const index = nodes.findIndex((candidate) => candidate.id === node.id)
				if (index < 0) nodes.push(node)
				else nodes[index] = { ...nodes[index], ...node, updatedAt: Date.now() }
				this.state = { ...this.state, nodes }
				this.saveGraph()
				this.notify()
			}

			/** 清空当前图（调试与用户主动清场用）。 */
			clearGraph() {
				this.state = { ...this.state, nodes: [] }
				this.saveGraph()
				this.notify()
			}

			// ---- 选区监听 ----
			/** 监听选中/滚动/按键，维护"追问"小按钮的位置。 */
			installSelectionWatcher() {
				const onMouseUp = (event) => {
					// 卡片里的输入框不参与选词（否则在输入框里选字会冒按钮）。
					if (event.target instanceof Element && event.target.closest("textarea,[contenteditable=true]") !== null) return
					queueMicrotask(() => this.captureSelection())
				}
				const onMouseDown = (event) => {
					const target = event.target
					if (target instanceof Element && (target.closest(".dla-ask") !== null || target.closest(".dla-card") !== null || target.closest(".dla-graph") !== null)) return
					const nextCard = this.state.card !== null && this.state.card.pinned !== true ? null : this.state.card
					if (this.state.button === null && nextCard === this.state.card) return
					this.state = { ...this.state, button: null, card: nextCard }
					this.notify()
				}
				const onScroll = () => {
					if (this.state.button === null) return
					this.state = { ...this.state, button: null }
					this.notify()
				}
				const onKeyDown = (event) => {
					// Alt+Enter：跳过"小按钮"直接追问当前选区（选区判定失败时的兜底入口）。
					if (event.altKey === true && event.key === "Enter") {
						const selection = window.getSelection()
						if (selection === null || selection.isCollapsed) return
						if (selection.toString().trim() === "") return
						event.preventDefault()
						this.captureSelection()
						if (this.state.button !== null) this.askFromAnchor(this.state.button)
						return
					}
					if (event.key !== "Escape") return
					this.state = { ...this.state, button: null, card: this.state.card?.pinned === true ? this.state.card : null, graphOpen: false }
					this.notify()
				}
				document.addEventListener("mouseup", onMouseUp, true)
				document.addEventListener("mousedown", onMouseDown, true)
				document.addEventListener("scroll", onScroll, true)
				document.addEventListener("keydown", onKeyDown, true)
				this.disposeWatcher = () => {
					document.removeEventListener("mouseup", onMouseUp, true)
					document.removeEventListener("mousedown", onMouseDown, true)
					document.removeEventListener("scroll", onScroll, true)
					document.removeEventListener("keydown", onKeyDown, true)
				}
			}

			/** 读取当前选区，算出按钮位置与来源（主对话 or 卡片里的某个节点）。 */
			captureSelection() {
				const selection = window.getSelection()
				if (selection === null || selection.isCollapsed) return this.hideButton()
				const raw = selection.toString().trim()
				if (raw === "") return this.hideButton()
				if (raw.length > 600) return this.hideButton()
				const range = selection.getRangeAt(0)
				const container = range.commonAncestorContainer
				const element = container.nodeType === 1 ? container : container.parentElement
				if (element === null) return this.hideButton()
				// 输入区（composer、卡片输入框）里的选中不算数。
				if (element.closest("textarea,[contenteditable=true]") !== null) return this.hideButton()
				if (element.closest(".dla-layer") !== null && element.closest(".dla-card") === null) return this.hideButton()
				const inCard = element.closest(".dla-card") !== null
				const region = findConversationRegion()
				if (region !== null && region.contains(container) === false && inCard === false) return this.hideButton()
				const rect = range.getBoundingClientRect()
				if (rect.width === 0 && rect.height === 0) return this.hideButton()
				const parent = inCard && this.state.card !== null && this.state.card.nodeId !== undefined
					? { kind: "node", nodeId: this.state.card.nodeId }
					: null
				const left = Math.min(window.innerWidth - 110, Math.max(8, rect.right + 8))
				const top = Math.min(window.innerHeight - 36, Math.max(8, rect.top - 6))
				const button = { left, top, rect: { left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom }, term: raw, quote: quoteAround(range, raw), parent }
				this.state = { ...this.state, button }
				this.notify()
			}

			/** 收起小按钮。 */
			hideButton() {
				if (this.state.button === null) return
				this.state = { ...this.state, button: null }
				this.notify()
			}

			// ---- 线程（横向会话的回答流） ----
			/** 取线程记录，没有就建订阅。 */
			threadOf(sessionId) {
				return sessionId === undefined ? null : this.threads.get(sessionId) ?? null
			}

			/**
			 * 打开某个横向会话的事件窗口并订阅它的 chat 视图。
			 * @param sessionId - 横向会话 id。
			 */
			async ensureThread(sessionId) {
				const existing = this.threads.get(sessionId)
				if (existing !== undefined) return existing
				const record = { sessionId, messages: [], running: false, sendError: null, streamError: null, loaded: false, dispose: null, pollTimer: null }
				this.threads.set(sessionId, record)
				try {
					// 0.2.x 起 `sessions.binding()` 只对"被保留（retain）"的会话有效，
					// 新建的后台会话默认不在其中——先 retain，否则取不到 binding 也读不到对话。
					this.retainSession(sessionId)
					const binding = this.ctx.sessions.binding(sessionId)
					if (binding === undefined) {
						record.streamError = "session-unresolved"
						this.notify()
						return record
					}
					// 打开后台会话的事件窗口：非当前会话不会自己 follow，必须显式 open。
					try {
						await binding.session.open()
					} catch (error) {
						record.streamError = error instanceof Error ? error.message : String(error)
					}
					const conversation = this.ctx.uiConversation.binding(sessionId)
					const target = conversation.target("chat")
					const refresh = () => this.refreshThread(sessionId)
					if (typeof target.subscribe === "function") record.dispose = target.subscribe(refresh)
					refresh()
				} catch (error) {
					record.streamError = error instanceof Error ? error.message : String(error)
					this.notify()
				}
				return record
			}

			/** 把 chat 视图快照投影成消息列表 + 运行状态。 */
			refreshThread(sessionId) {
				const record = this.threads.get(sessionId)
				if (record === undefined) return
				try {
					const view = this.ctx.uiConversation.binding(sessionId).target("chat").getSnapshot()
					const order = view !== null && Array.isArray(view.order) ? view.order : []
					const store = view !== null && view.nodes !== undefined ? view.nodes : null
					const messages = []
					let nodesSeen = 0
					if (store !== null && typeof store.get === "function") {
						for (const key of order) {
							const node = store.get(key)
							if (node !== undefined && node !== null) nodesSeen += 1
							const read = readNode(node)
							if (read === null) continue
							messages.push({ id: String(key), role: read.role, text: read.text })
						}
					}
					record.diag = { orderLength: order.length, nodesSeen, messages: messages.length }
					record.messages = messages
					record.loaded = true
					// 只清"读流"失败；发问失败由 sendError 单独记录，不能被投影成功抹掉。
					record.streamError = null
					const binding = this.ctx.sessions.binding(sessionId)
					const snapshot = binding === undefined ? undefined : binding.session.getSnapshot()
					record.running = snapshot === undefined ? false : snapshot.running === true
					// Session 自己也会记下最近一次发问失败（promptError），这是最权威的原因来源。
					record.promptError = snapshot === undefined || snapshot.promptError === undefined || snapshot.promptError === null
						? null
						: `${snapshot.promptError.error?.code ?? "prompt-failed"}: ${snapshot.promptError.error?.message ?? ""}`
				} catch (error) {
					record.streamError = error instanceof Error ? error.message : String(error)
				}
				this.notify()
			}

			/**
			 * 保留（retain）一个会话：0.2.x 里只有被主视图或插件保留过的会话才有 `sessions.binding()`，
			 * 也才会真正开始接收事件。同一个会话只保留一次，插件卸载时统一释放。
			 * @param sessionId - 横向会话 id。
			 * @returns 保留引用；失败时 undefined（不影响调用方继续尝试其它路径）。
			 */
			retainSession(sessionId) {
				if (sessionId === undefined || sessionId === null) return undefined
				const kept = this.retained.get(sessionId)
				if (kept !== undefined) return kept
				try {
					if (typeof this.ctx.sessions?.retain !== "function") return undefined
					const reference = this.ctx.sessions.retain(sessionId, { source: "question-map" })
					this.retained.set(sessionId, reference)
					return reference
				} catch (error) {
					console.warn("[question-map] retaining the session failed:", error)
					return undefined
				}
			}

			/** 向某个横向会话发一句话。 */
			async send(sessionId, text) {
				this.retainSession(sessionId)
				const binding = this.ctx.sessions.binding(sessionId)
				if (binding === undefined) throw new Error("question-map: session is not addressable")
				const record = this.threads.get(sessionId)
				if (record !== undefined) record.sendError = null
				const result = await binding.session.prompt(promptContent(text), "queue")
				if (result !== undefined && result.ok === false) {
					const detail = `${result.error?.code ?? "prompt-failed"}: ${result.error?.message ?? ""}`
					if (record !== undefined) record.sendError = detail
					throw new Error(detail)
				}
				// 后台会话的 chat 视图不会推送变更（实测），发问后用轻量轮询把回答拉进卡片。
				this.watchThread(sessionId)
			}

			/**
			 * 卡片打开期间轮询该会话的 chat 快照：每 1.2s 读一次内存快照（不发请求），
			 * 拿到答案或错误就停，最多持续 3 分钟。
			 * @param sessionId - 横向会话 id。
			 */
			watchThread(sessionId) {
				const record = this.threads.get(sessionId)
				if (record === undefined || record === null) return
				if (record.pollTimer !== undefined && record.pollTimer !== null) return
				const deadline = Date.now() + 180000
				record.pollTimer = setInterval(() => {
					const current = this.threads.get(sessionId)
					if (current === undefined || current.pollTimer !== record.pollTimer) {
						clearInterval(record.pollTimer)
						record.pollTimer = null
						return
					}
					this.refreshThread(sessionId)
					const last = [...current.messages].reverse().find((message) => message.role === "assistant")
					const signature = last === undefined ? "" : `${last.text.length}:${last.text.slice(-24)}`
					const errored = current.messages.some((message) => message.role === "error")
					// 流式期间文本一直在变；只有"文本连续 3 次不变且不在运行"（或出错）才算settled。
					current.stableTicks = signature !== "" && signature === current.lastSignature ? (current.stableTicks ?? 0) + 1 : 0
					current.lastSignature = signature
					const settled = errored || (signature !== "" && current.stableTicks >= 3 && current.running === false)
					if (settled || Date.now() > deadline) {
						clearInterval(record.pollTimer)
						record.pollTimer = null
					}
				}, 1200)
			}

			/** 停掉正在跑的横向会话。 */
			async stop(sessionId) {
				const binding = this.ctx.sessions.binding(sessionId)
				if (binding === undefined) return
				try {
					await binding.session.cancel()
				} catch (_failure) {
					/* 停止失败不影响任何状态 */
				}
			}

			// ---- 建会话与提问 ----
			/**
			 * 从一次选中出发：新建横向会话 → 继承模型与标题 → 提问 → 写入节点。
			 * @param anchor - { term, quote, parent, rect }
			 */
			async ask(anchor) {
				const term = truncate(anchor.term, 400)
				const quote = String(anchor.quote ?? "").slice(0, QUOTE_LIMIT)
				const question = buildPrompt(term, quote)
				const list = this.ctx.sessions.list.getSnapshot()
				const currentId = list === undefined ? undefined : list.current
				const current = currentId === undefined ? undefined : list.byId?.[currentId]
				// 和 DSH 自己新建会话的方式对齐：优先用「当前会话所属工作区」的 workspaceId
				// （只有 workspaceId 会触发 workspace.attachSession()），拿不到才退回 cwd。
				const workspaceId = anchor.workspaceIdOverride ?? this.workspaceOf(currentId)
				const cwd = anchor.cwdOverride ?? current?.cwd
				const parent = anchor.parent ?? null
				const parentNode = parent !== null && parent.kind === "node" ? this.nodeById(parent.nodeId) : null
				const rootSessionId = parentNode !== null ? parentNode.rootSessionId ?? null : currentId ?? null

				this.pending = { id: newId(), term, question, quote, phase: "creating", error: null, pinned: false, noWorkspace: workspaceId === undefined && cwd === undefined, rect: anchor.rect ?? null }
				this.pendingAnchor = anchor
				this.state = { ...this.state, button: null, card: { pendingId: this.pending.id, phase: "creating", pinned: false, rect: anchor.rect ?? null } }
				this.notify()

				let sessionId
				try {
					sessionId = await this.ctx.sessions.create(workspaceId !== undefined ? { workspaceId } : cwd === undefined ? {} : { cwd })
				} catch (error) {
					const message = error instanceof Error ? error.message : String(error)
					this.pending = { ...this.pending, phase: "failed", error: message }
					this.state = { ...this.state, card: { ...(this.state.card ?? {}), phase: "failed", error: message } }
					this.notify()
					return
				}

				// 新会话先保留：0.2.x 的 sessions.binding() 只认被保留的会话，
				// 后面的改名、继承模型、发问、读对话全都依赖它。
				this.retainSession(sessionId)

				const node = {
					id: this.pending.id,
					sessionId,
					rootSessionId,
					// 记下所属工作区：重装/清存储后，同一工作区里的追问仍然能互相认出来。
					workspaceId: this.workspaceOf(rootSessionId) ?? this.workspaceOf(currentId),
					term,
					quote,
					question,
					parent,
					createdAt: Date.now(),
					updatedAt: Date.now(),
				}

				await this.inheritModel(currentId, sessionId)
				await this.renameSession(sessionId, `${TITLE_PREFIX}${truncate(term, 24)}`)
				this.upsertNode(node)
				this.state = { ...this.state, card: { nodeId: node.id, pinned: this.state.card?.pinned === true, rect: anchor.rect ?? null } }
				this.pending = null
				this.notify()
				this.ensureThread(sessionId)

				try {
					await this.send(sessionId, question)
				} catch (error) {
					this.threads.set(sessionId, { ...(this.threads.get(sessionId) ?? { sessionId, messages: [], loaded: false }), sendError: `${error instanceof Error ? error.message : String(error)}` })
					this.notify()
				}
			}

			/** 继承主会话的模型选择（尽力而为，失败不影响提问）。 */
			async inheritModel(fromSessionId, toSessionId) {
				if (fromSessionId === undefined) return
				try {
					const binding = this.ctx.sessions.binding(fromSessionId)
					const face = binding?.session?.projections?.faceOf?.("modelSelection")
					const value = face !== undefined && face !== null && typeof face.getSnapshot === "function" ? face.getSnapshot() : face
					const selection = value?.next ?? value?.lastUsed ?? null
					if (selection === null || selection.provider === undefined || selection.model === undefined) return
					const request = { sessionId: toSessionId, provider: selection.provider, model: selection.model }
					if (selection.reasoningEffort !== undefined) request.reasoningEffort = selection.reasoningEffort
					await this.ctx.remote.session.selectModel(request)
				} catch (_failure) {
					/* 继承失败就用宿主默认模型 */
				}
			}

			/** 给横向会话起一个一眼能认出来的标题。 */
			async renameSession(sessionId, title) {
				try {
					const binding = this.ctx.sessions.binding(sessionId)
					if (binding !== undefined) await binding.session.rename(title)
				} catch (_failure) {
					/* 标题只是便利，失败无所谓 */
				}
			}

			// ---- UI 动作 ----
			/** 点击小按钮：从当前选区提问。 */
			askFromAnchor(anchor) {
				return this.ask(anchor)
			}

			/** 打开/关闭网状图。 */
			toggleGraph() {
				// 与追问无关的会话里没有可看的图：直接不打开（也顺手清掉残留状态）。
				if (this.state.graphOpen === false && this.relatedGraph(this.currentRootId()) === null) return
				this.state = { ...this.state, graphOpen: this.state.graphOpen === false, button: null }
				this.notify()
			}

			/** 点击图上的节点：关掉图，打开它的卡。 */
			openNode(nodeId) {
				const node = this.nodeById(nodeId)
				if (node === null) return
				this.state = { ...this.state, graphOpen: false, card: { nodeId, pinned: this.state.card?.pinned === true, rect: null } }
				this.notify()
				this.ensureThread(node.sessionId)
			}

			/** 重试建会话（create 失败后卡片上的重试）。 */
			retryCreate() {
				if (this.pendingAnchor === undefined || this.pendingAnchor === null) return
				return this.ask(this.pendingAnchor)
			}

			/** 关闭浮卡。 */
			closeCard() {
				this.state = { ...this.state, card: null }
				this.notify()
			}

			/** 固定/取消固定浮卡。 */
			togglePin() {
				const card = this.state.card
				if (card === null) return
				this.state = { ...this.state, card: { ...card, pinned: card.pinned !== true } }
				this.notify()
			}

			/**
			 * 在主页打开该横向会话（同时收起浮卡与图），并**校验切换真的生效**——
			 * 失败会通过 `actionNotice` 显示出来，而不是静默什么都不发生。
			 * @param sessionId - 横向会话 id。
			 */
			openInMain(sessionId) {
				if (sessionId === undefined || sessionId === null) return
				try {
					// 0.2.x 起"把某个会话放到主视图"由 uiWorkspace 负责；旧版本退回 sessions.open。
					const workspace = this.ctx.uiWorkspace
					if (workspace !== undefined && workspace !== null && typeof workspace.openSession === "function") {
						workspace.openSession(sessionId)
					} else if (typeof this.ctx.sessions?.open === "function") {
						this.ctx.sessions.open(sessionId)
					} else {
						throw new Error("当前 DSH 版本没有可用的切换会话接口")
					}
				} catch (error) {
					const message = error instanceof Error ? error.message : String(error)
					console.error("[question-map] opening the session failed:", error)
					this.showNotice(`打开会话失败：${message}`)
					return
				}
				this.state = { ...this.state, card: null, graphOpen: false, actionNotice: null }
				this.notify()
				// 打开是异步的：800ms 后回读当前会话，确认真的切过去了。
				setTimeout(() => {
					let current = null
					try {
						current = this.currentRootId()
					} catch (_failure) {
						current = null
					}
					if (current !== sessionId) {
						console.warn("[question-map] session switch did not take effect:", sessionId, "current:", current)
						this.showNotice(current === null ? "会话没有切换（当前没有打开的会话）" : "会话没有切换，当前仍停留在另一个会话")
					}
				}, 800)
			}

			/**
			 * 显示一条短暂的提示（出现在入口按钮上方）。
			 * @param message - 提示文字；4 秒后自动消失。
			 * @param tone - `error`（默认，红底）或 `info`（绿底）。
			 */
			showNotice(message, tone = "error") {
				this.state = { ...this.state, actionNotice: { message, tone } }
				this.notify()
				if (this.noticeTimer !== undefined && this.noticeTimer !== null) clearTimeout(this.noticeTimer)
				this.noticeTimer = setTimeout(() => {
					this.noticeTimer = null
					if (this.state.actionNotice !== null && this.state.actionNotice.message === message) {
						this.state = { ...this.state, actionNotice: null }
						this.notify()
					}
				}, 4000)
			}

			/**
			 * 导出当前图（供画布与调试句柄共用）：成功与失败都给明确反馈。
			 * @param nodes - 参与导出的节点。
			 * @param title - 图片标题与文件名前缀。
			 * @returns 导出结果（失败时为 null）。
			 */
			async exportImage(nodes, title) {
				try {
					const result = await exportGraphPng(nodes, title, (rootSessionId) => this.sessionTitle(rootSessionId))
					this.showNotice(`已导出 ${result.fileName}（${result.width}×${result.height}）`, "info")
					return result
				} catch (error) {
					const message = error instanceof Error ? error.message : String(error)
					console.error("[question-map] export failed:", error)
					this.showNotice(`导出失败：${message}`)
					return null
				}
			}

			/** 卡内追问。 */
			async followUp(node, text) {
				const trimmed = text.trim()
				if (trimmed === "") return
				try {
					await this.send(node.sessionId, trimmed)
				} catch (error) {
					this.threads.set(node.sessionId, { ...(this.threads.get(node.sessionId) ?? { sessionId: node.sessionId, messages: [], loaded: false }), sendError: `${error instanceof Error ? error.message : String(error)}` })
				}
				this.notify()
			}

			/** 重试：把当前卡片的首问再发一次。 */
			async retry(node) {
				try {
					await this.send(node.sessionId, node.question)
					this.threads.set(node.sessionId, { ...(this.threads.get(node.sessionId) ?? { sessionId: node.sessionId, messages: [], loaded: false }), sendError: null })
				} catch (error) {
					this.threads.set(node.sessionId, { ...(this.threads.get(node.sessionId) ?? { sessionId: node.sessionId, messages: [], loaded: false }), sendError: `${error instanceof Error ? error.message : String(error)}` })
				}
				this.notify()
			}
		}
		//#endregion

		//#region 组件
		/** 读控制器快照的钩子。 */
		function useSnapshot(controller) {
			return useSyncExternalStore(controller.subscribe, controller.getSnapshot, controller.getSnapshot)
		}

		/** 译文助手：优先用 slot 运行时给的 `t`，缺席时用内置中文。 */
		function makeT(props) {
			if (typeof props.t === "function") return props.t
			return (key, params) => {
				const template = zh[key] ?? key
				if (params === undefined) return template
				return template.replace(/\{(\w+)\}/g, (whole, name) => (params[name] === undefined ? whole : String(params[name])))
			}
		}

		/** 选中处的小按钮。 */
		function AskButton({ controller, anchor, t }) {
			return h("button", {
				className: "dla-ask",
				style: { left: `${anchor.left}px`, top: `${anchor.top}px` },
				title: t("entry.title"),
				onMouseDown: (event) => {
					event.preventDefault()
					event.stopPropagation()
				},
				onClick: (event) => {
					event.preventDefault()
					event.stopPropagation()
					controller.askFromAnchor(anchor)
				},
			}, "⟂ ", t("ask.button"))
		}

		/** 浮卡里的一条消息。 */
		function MessageRow({ message, streaming }) {
			if (message.role === "user") {
				return h("div", { className: "dla-msg", "data-role": "user" }, message.text)
			}
			if (message.role === "error") {
				return h("div", { className: "dla-error" }, message.text)
			}
			return h("div", { className: "dla-msg", "data-role": "assistant" }, h(MarkdownText, { text: message.text, streaming }))
		}

		/** 锚定浮卡。 */
		function AskCard({ controller, card, node, thread, t }) {
			const [draft, setDraft] = useState("")
			const [offset, setOffset] = useState(null)
			const dragRef = useRef(null)
			const bodyRef = useRef(null)

			// 新内容出现时滚到底。
			useEffect(() => {
				const body = bodyRef.current
				if (body !== null) body.scrollTop = body.scrollHeight
			}, [thread?.messages.length, thread?.running, node?.id])

			const onHeadPointerDown = useCallback((event) => {
				if (event.target instanceof Element && event.target.closest("button") !== null) return
				const rect = event.currentTarget.getBoundingClientRect()
				dragRef.current = { dx: event.clientX - rect.left, dy: event.clientY - rect.top }
				event.currentTarget.setPointerCapture(event.pointerId)
			}, [])

			const onHeadPointerMove = useCallback((event) => {
				const drag = dragRef.current
				if (drag === null) return
				setOffset({ left: Math.max(8, event.clientX - drag.dx), top: Math.max(8, event.clientY - drag.dy) })
			}, [])

			const onHeadPointerUp = useCallback((event) => {
				if (dragRef.current === null) return
				dragRef.current = null
				event.currentTarget.releasePointerCapture?.(event.pointerId)
			}, [])

			// 位置：拖动过就用拖动结果，否则贴着选区。
			const position = useMemo(() => {
				if (offset !== null) return { left: offset.left, top: offset.top }
				const rect = card.rect ?? null
				const margin = 10
				const maxLeft = window.innerWidth - CARD_WIDTH - margin
				const left = rect === null ? Math.max(margin, window.innerWidth - CARD_WIDTH - 24) : Math.min(maxLeft, Math.max(margin, rect.right + 12))
				const top = rect === null ? 96 : Math.min(window.innerHeight - 220, Math.max(margin, rect.top - 8))
				return { left, top }
			}, [offset, card.rect])

			const term = node === null ? controller.pending?.term ?? "" : node.term
			const sourceLabel = node === null
				? t("card.title")
				: node.parent !== null && node.parent.kind === "node"
					? t("source.node", { label: truncate(controller.nodeById(node.parent.nodeId)?.term ?? "", LABEL_LIMIT) })
					: t("source.main")
			const messages = thread === null ? [] : thread.messages
			const visible = messages.filter((message) => !(node !== null && message.role === "user" && message.text === node.question))
			const lastAssistant = [...visible].reverse().find((message) => message.role === "assistant")
			const hasAnswer = visible.some((message) => message.role === "assistant" || message.role === "error")
			const running = thread !== null && thread.running === true
			const error = thread?.sendError ?? thread?.streamError ?? null
			const pendingFailed = node === null && (card.phase === "failed" || controller.pending?.phase === "failed")
			const pendingError = pendingFailed ? card.error ?? controller.pending?.error ?? "unknown" : null

			const submit = () => {
				if (node === null) return
				const text = draft
				setDraft("")
				controller.followUp(node, text)
			}

			return h("div", {
				className: "dla-card",
				style: { left: `${position.left}px`, top: `${position.top}px`, width: `${CARD_WIDTH}px` },
				onMouseDown: (event) => {
					event.stopPropagation()
				},
			},
			h("div", {
				className: "dla-card-head",
				onPointerDown: onHeadPointerDown,
				onPointerMove: onHeadPointerMove,
				onPointerUp: onHeadPointerUp,
				onPointerCancel: onHeadPointerUp,
			},
			h("div", { className: "dla-card-title" },
				h("div", { className: "dla-card-term" }, node === null ? "⟂ …" : `⟂ ${truncate(term, 40)}`),
				h("div", { className: "dla-card-source" }, sourceLabel)),
			node !== null ? h("button", {
				className: "dla-icon-btn",
				"data-pinned": card.pinned === true ? "" : undefined,
				title: card.pinned === true ? t("card.unpin") : t("card.pin"),
				onClick: () => controller.togglePin(),
			}, "📌") : null,
			node !== null ? h("button", {
				className: "dla-link-btn",
				title: t("card.open"),
				onClick: () => controller.openInMain(node.sessionId),
			}, `↗ ${t("card.openSession")}`) : null,
			h("button", {
				className: "dla-icon-btn",
				title: t("card.close"),
				onClick: () => controller.closeCard(),
			}, "✕")),

			h("div", { className: "dla-card-body", ref: bodyRef },
				node === null && controller.pending !== null ? h("div", { className: "dla-notice" }, t("card.creating")) : null,
				node === null && controller.pending?.noWorkspace === true ? h("div", { className: "dla-notice" }, t("card.noWorkspace")) : null,
				pendingError !== null ? h("div", { className: "dla-error" }, `${t("card.createFailed")}：${pendingError}`) : null,
				node !== null && node.quote !== undefined && node.quote !== "" ? h("div", { className: "dla-notice" }, truncate(node.quote, 160)) : null,
				visible.map((message, index) => h(MessageRow, {
					key: message.id ?? `${index}`,
					message,
					streaming: running && message === lastAssistant,
				})),
				hasAnswer === false && node !== null
					? h("div", { className: "dla-notice" }, thread === null ? t("card.opening") : running ? t("card.thinking") : t("card.fallback"))
					: null,
				hasAnswer === false && node !== null
					? h("div", { className: "dla-notice" }, t("card.diag", { status: thread === null ? "thread=none" : `loaded=${thread.loaded} running=${thread.running} messages=${visible.length}` }))
					: null,
				error !== null ? h("div", { className: "dla-error" }, `${t("card.error")}：${error}`) : null),

			h("div", { className: "dla-card-foot" },
				h("textarea", {
					className: "dla-input",
					placeholder: t("card.placeholder"),
					value: draft,
					disabled: node === null,
					onChange: (event) => setDraft(event.target.value),
					onKeyDown: (event) => {
						if (event.key === "Enter" && event.shiftKey === false) {
							event.preventDefault()
							submit()
						}
					},
				}),
				h("div", { className: "dla-actions" },
					pendingFailed ? h("button", { className: "dla-btn", onClick: () => controller.retryCreate() }, t("card.retry")) : null,
					node !== null ? h("button", { className: "dla-btn", onClick: () => controller.retry(node) }, t("card.retry")) : null,
					running && node !== null ? h("button", { className: "dla-btn", onClick: () => controller.stop(node.sessionId) }, t("card.stop")) : null,
					h("button", {
						className: "dla-btn",
						"data-primary": "",
						disabled: node === null || draft.trim() === "",
						onClick: submit,
					}, t("card.send")))))
		}

		//#region 图布局与导出（纯函数，导出与测试共用）
		/** 节点的显示名：按"提出的问题"来写，而不是只写选中的词。 */
		function nodeLabel(node) {
			if (node === null || node === undefined) return ""
			const question = typeof node.question === "string" ? node.question.trim() : ""
			// 我们自己的模板问句里，"解释「X」"就是这次提问的目的，直接用它当名字。
			const asked = /解释「([^」]{1,40})」/u.exec(question)
			if (asked !== null) return truncate(`解释「${asked[1]}」`, 24)
			if (question !== "") {
				const first = question.split(/[\n。！？；]/u).map((part) => part.trim()).find((part) => part !== "")
				if (first !== undefined) return truncate(first.replace(/[：:].*$/u, ""), 24)
			}
			return truncate(node.term ?? "", 24)
		}

		/** XML 文本转义（导出 SVG 用）。 */
		function escapeXml(text) {
			return String(text).replace(/[<>&"']/g, (character) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", '"': "&quot;", "'": "&apos;" })[character])
		}

		/**
		 * 计算三层布局：会话锚点（按 rootSessionId 分组）→ 根提问 → 子提问。
		 * @param nodes - 图里的节点。
		 * @param anchorLabelOf - 会话 id → 锚点显示文字（取不到就用固定文案）。
		 * @returns `{ positions, edges, anchors, bounds }`，positions 的键可能是 `anchor:<root>`。
		 */
		function layoutGraph(nodes, anchorLabelOf) {
			const byId = new Map()
			for (const node of nodes) byId.set(node.id, node)
			const children = new Map()
			const rootsByAnchor = new Map()
			for (const node of nodes) {
				const parentId = node.parent !== null && node.parent !== undefined && node.parent.kind === "node" ? node.parent.nodeId : null
				if (parentId !== null && byId.has(parentId)) {
					const list = children.get(parentId) ?? []
					list.push(node)
					children.set(parentId, list)
				} else {
					const rootKey = node.rootSessionId ?? "none"
					const list = rootsByAnchor.get(rootKey) ?? []
					list.push(node)
					rootsByAnchor.set(rootKey, list)
				}
			}
			const positions = new Map()
			const edges = []
			const anchors = []
			let row = 0
			const place = (node, depth) => {
				const kids = (children.get(node.id) ?? []).filter((kid) => positions.has(kid.id) === false)
				if (kids.length === 0) {
					positions.set(node.id, { x: depth * 210, y: row * 56, depth })
					row += 1
					return row - 1
				}
				const rows = kids.map((kid) => place(kid, depth + 1))
				const y = (Math.min(...rows) + Math.max(...rows)) / 2
				positions.set(node.id, { x: depth * 210, y: y * 56, depth })
				for (const kid of kids) edges.push({ from: node.id, to: kid.id })
				return y
			}
			for (const [rootKey, list] of rootsByAnchor) {
				const rows = list.filter((node) => positions.has(node.id) === false).map((node) => place(node, 1))
				if (rows.length === 0) continue
				const anchorId = `anchor:${rootKey}`
				const y = (Math.min(...rows) + Math.max(...rows)) / 2
				positions.set(anchorId, { x: 0, y: y * 56, depth: 0 })
				const rootSessionId = rootKey === "none" ? null : rootKey
				const label = rootSessionId === null ? "未归属提问" : anchorLabelOf(rootSessionId) ?? "本次对话"
				anchors.push({ id: anchorId, rootSessionId, label, width: anchorWidthOf(label) })
				for (const node of list) edges.push({ from: anchorId, to: node.id })
			}
			let minX = 0
			let maxX = 0
			let minY = 0
			let maxY = 0
			let first = true
			for (const [id, position] of positions.entries()) {
				const width = id.startsWith("anchor:")
					? anchors.find((anchor) => anchor.id === id)?.width ?? 132
					: nodeWidthOf(byId.get(id))
				if (first) {
					minX = position.x
					maxX = position.x + width
					minY = position.y
					maxY = position.y + 34
					first = false
					continue
				}
				minX = Math.min(minX, position.x)
				maxX = Math.max(maxX, position.x + width)
				minY = Math.min(minY, position.y)
				maxY = Math.max(maxY, position.y + 34)
			}
			return { positions, edges, anchors, bounds: { minX, maxX, minY, maxY } }
		}

		/** 字符宽度估算：中日韩全角按 13px，其余按 7.4px（12px 字号下的经验值）。 */
		function textWidth(text) {
			let width = 0
			for (const character of String(text ?? "")) {
				width += character.codePointAt(0) > 0x2e7f ? 13 : 7.4
			}
			return width
		}

		/** 节点圆角矩形的宽度：按标签真实宽度自适应，并给右侧 ↗ 按钮留位置。 */
		function nodeWidthOf(node) {
			const label = truncate(nodeLabel(node), LABEL_LIMIT)
			return Math.round(Math.min(320, Math.max(96, 12 + textWidth(label) + 8 + 26)))
		}

		/** 会话锚点的胶囊宽度：同样按文字自适应。 */
		function anchorWidthOf(label) {
			return Math.round(Math.min(340, Math.max(96, 20 + textWidth(label) + 20)))
		}

		/**
		 * 把当前图渲染成一段独立 SVG 文本（自带底色、标题、箭头标记），供导出使用。
		 * @param nodes - 参与导出的节点。
		 * @param anchors - 锚点列表（来自 layoutGraph）。
		 * @param layout - layoutGraph 的结果。
		 * @param title - 图片标题。
		 * @returns SVG 文本。
		 */
		function buildGraphSvg(nodes, layout, title) {
			const pad = 36
			const titleHeight = 38
			const { minX, maxX, minY, maxY } = layout.bounds
			const width = Math.ceil(maxX - minX + pad * 2)
			const height = Math.ceil(maxY - minY + pad * 2 + titleHeight)
			const parts = []
			parts.push(`<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">`)
			parts.push(`<rect width="${width}" height="${height}" fill="#ffffff"/>`)
			parts.push(`<text x="${pad}" y="26" font-family="-apple-system,Segoe UI,Helvetica,Arial,sans-serif" font-size="14" font-weight="600" fill="#111827">${escapeXml(title)}</text>`)
			parts.push(`<defs><marker id="dla-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse"><path d="M 0 0 L 10 5 L 0 10 z" fill="#c9cfda"/></marker></defs>`)
			parts.push(`<g transform="translate(${pad - minX} ${titleHeight + pad - minY})" font-family="-apple-system,Segoe UI,Helvetica,Arial,sans-serif">`)
			for (const edge of layout.edges) {
				const from = layout.positions.get(edge.from)
				const to = layout.positions.get(edge.to)
				if (from === undefined || to === undefined) continue
				const isAnchor = edge.from.startsWith("anchor:")
				const anchor = isAnchor ? layout.anchors.find((entry) => entry.id === edge.from) : undefined
				const source = isAnchor ? undefined : nodes.find((node) => node.id === edge.from)
				const fromX = from.x + (isAnchor ? anchor?.width ?? 132 : nodeWidthOf(source))
				const fromY = from.y + 17
				const toX = to.x
				const toY = to.y + 17
				const midX = (fromX + toX) / 2
				parts.push(`<path d="M ${fromX} ${fromY} C ${midX} ${fromY}, ${midX} ${toY}, ${toX} ${toY}" fill="none" stroke="#c9cfda" stroke-width="1.5" marker-end="url(#dla-arrow)"/>`)
			}
			for (const anchor of layout.anchors) {
				const position = layout.positions.get(anchor.id)
				if (position === undefined) continue
				parts.push(`<g transform="translate(${position.x} ${position.y})">`)
				parts.push(`<rect width="${anchor.width}" height="34" rx="17" ry="17" fill="#f3f4f6" stroke="#d8dce3" stroke-dasharray="5 3"/>`)
				parts.push(`<text x="20" y="22" font-size="12" fill="#4b5563">${escapeXml(truncate(anchor.label, LABEL_LIMIT))}</text>`)
				parts.push(`</g>`)
			}
			for (const node of nodes) {
				const position = layout.positions.get(node.id)
				if (position === undefined) continue
				const width_ = nodeWidthOf(node)
				const label = truncate(nodeLabel(node), LABEL_LIMIT)
				parts.push(`<g transform="translate(${position.x} ${position.y})">`)
				parts.push(`<rect width="${width_}" height="34" rx="9" ry="9" fill="#eef2f7" stroke="#c9cfda"/>`)
				parts.push(`<text x="12" y="22" font-size="12" fill="#111827">${escapeXml(label)}</text>`)
				parts.push(`</g>`)
			}
			parts.push(`</g></svg>`)
			return parts.join("")
		}

		/**
		 * 把图导出成 PNG 下载（SVG → Image → Canvas → Blob，全程本地，无第三方库）。
		 * @param nodes - 参与导出的节点。
		 * @param title - 图片标题与文件名前缀。
		 * @param anchorLabelOf - 会话 id → 锚点文字。
		 * @returns `{ fileName, width, height, bytes }`；失败时 reject（由调用方负责提示）。
		 */
		function exportGraphPng(nodes, title, anchorLabelOf) {
			if (typeof document === "undefined") return Promise.reject(new Error("no document"))
			const layout = layoutGraph(nodes, anchorLabelOf)
			const svg = buildGraphSvg(nodes, layout, title)
			const url = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`
			const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-")
			const fileName = `${title}-${stamp}.png`
			return new Promise((resolve, reject) => {
				const image = new Image()
				image.onerror = () => reject(new Error("SVG 渲染失败"))
				image.onload = () => {
					try {
						const scale = 2
						const canvas = document.createElement("canvas")
						canvas.width = Math.max(1, Math.round(image.width * scale))
						canvas.height = Math.max(1, Math.round(image.height * scale))
						const context = canvas.getContext("2d")
						if (context === null) {
							reject(new Error("无法创建画布"))
							return
						}
						context.fillStyle = "#ffffff"
						context.fillRect(0, 0, canvas.width, canvas.height)
						context.scale(scale, scale)
						context.drawImage(image, 0, 0)
						canvas.toBlob((blob) => {
							if (blob === null) {
								reject(new Error("PNG 编码失败"))
								return
							}
							const link = document.createElement("a")
							const objectUrl = URL.createObjectURL(blob)
							link.href = objectUrl
							link.download = fileName
							link.rel = "noopener"
							document.body.append(link)
							link.click()
							link.remove()
							setTimeout(() => URL.revokeObjectURL(objectUrl), 10000)
							resolve({ fileName, width: canvas.width, height: canvas.height, bytes: blob.size })
						}, "image/png")
					} catch (error) {
						reject(error instanceof Error ? error : new Error(String(error)))
					}
				}
				image.src = url
			})
		}
		//#endregion

		/** 网状图画布。 */
		function GraphView({ controller, nodes, t }) {
			const [view, setView] = useState({ scale: 1, x: 0, y: 0 })
			const [panning, setPanning] = useState(false)
			const panRef = useRef(null)
			const canvasRef = useRef(null)
			const sizeRef = useRef({ width: 800, height: 600 })

			const ranked = useMemo(() => layoutGraph(nodes, (rootSessionId) => controller.sessionTitle(rootSessionId)), [nodes, controller])

			const fit = useCallback(() => {
				const { width, height } = sizeRef.current
				const { minX, maxX, minY, maxY } = ranked.bounds
				const contentWidth = Math.max(1, maxX - minX)
				const contentHeight = Math.max(1, maxY - minY)
				const scale = Math.min(1, Math.min((width - 96) / contentWidth, (height - 96) / contentHeight))
				const x = (width - contentWidth * scale) / 2 - minX * scale
				const y = (height - contentHeight * scale) / 2 - minY * scale
				setView({ scale, x, y })
			}, [ranked])

			const viewRef = useRef(view)
			viewRef.current = view
			const fittedRef = useRef(false)

			useEffect(() => {
				const element = canvasRef.current
				if (element === null) return
				const rect = element.getBoundingClientRect()
				sizeRef.current = { width: rect.width, height: rect.height }
				if (fittedRef.current === false) {
					fittedRef.current = true
					fit()
				}
			}, [fit])

			// 滚轮缩放必须走非被动监听，React 的 onWheel 是被动绑定，preventDefault 拦不住页面滚动。
			useEffect(() => {
				const element = canvasRef.current
				if (element === null) return
				const onWheel = (event) => {
					event.preventDefault()
					const rect = element.getBoundingClientRect()
					const px = event.clientX - rect.left
					const py = event.clientY - rect.top
					const current = viewRef.current
					const next = Math.min(2, Math.max(0.4, current.scale * (event.deltaY > 0 ? 0.9 : 1.1)))
					const ratio = next / current.scale
					setView({ scale: next, x: px - (px - current.x) * ratio, y: py - (py - current.y) * ratio })
				}
				element.addEventListener("wheel", onWheel, { passive: false })
				return () => element.removeEventListener("wheel", onWheel)
			}, [])

			const onPointerDown = (event) => {
				// 按在节点/锚点上时不启动平移：一旦 setPointerCapture，浏览器会把随后的 click
				// 派发给 svg 本身，节点上的 onClick（开卡片 / 跳会话）就永远收不到了。
				if (event.button !== 0) return
				if (event.target instanceof Element && event.target.closest(".dla-node,.dla-anchor") !== null) return
				panRef.current = { x: event.clientX, y: event.clientY, originX: view.x, originY: view.y }
				event.currentTarget.setPointerCapture?.(event.pointerId)
				setPanning(true)
			}

			const onPointerMove = (event) => {
				const pan = panRef.current
				if (pan === null) return
				setView({ scale: view.scale, x: pan.originX + (event.clientX - pan.x), y: pan.originY + (event.clientY - pan.y) })
			}

			const onPointerUp = (event) => {
				if (panRef.current === null) return
				panRef.current = null
				event.currentTarget.releasePointerCapture?.(event.pointerId)
				setPanning(false)
			}

			return h("div", {
				className: "dla-graph",
				onMouseDown: (event) => event.stopPropagation(),
			},
			h("div", { className: "dla-graph-canvas", ref: canvasRef },
				nodes.length === 0 ? h("div", { className: "dla-graph-empty" }, t("graph.empty")) : null,
				h("svg", {
					className: "dla-svg",
					"data-panning": panning ? "" : undefined,
					onPointerDown,
					onPointerMove,
					onPointerUp,
					onPointerCancel: onPointerUp,
				},
				h("defs", null, h("marker", {
					id: "dla-arrow",
					viewBox: "0 0 10 10",
					refX: 9,
					refY: 5,
					markerWidth: 6,
					markerHeight: 6,
					orient: "auto-start-reverse",
				}, h("path", { d: "M 0 0 L 10 5 L 0 10 z", fill: "#c9cfda" }))),
				h("g", { transform: `translate(${view.x} ${view.y}) scale(${view.scale})` },
					ranked.edges.map((edge) => {
						const from = ranked.positions.get(edge.from)
						const to = ranked.positions.get(edge.to)
						if (from === undefined || to === undefined) return null
						const isAnchor = edge.from.startsWith("anchor:")
						const parentNode = isAnchor ? undefined : nodes.find((node) => node.id === edge.from)
						const sourceWidth = isAnchor
							? ranked.anchors.find((entry) => entry.id === edge.from)?.width ?? 132
							: nodeWidthOf(parentNode)
						const fromX = from.x + sourceWidth
						const fromY = from.y + 17
						const toX = to.x
						const toY = to.y + 17
						const midX = (fromX + toX) / 2
						return h("path", {
							key: `${edge.from}->${edge.to}`,
							className: "dla-edge",
							markerEnd: "url(#dla-arrow)",
							d: `M ${fromX} ${fromY} C ${midX} ${fromY}, ${midX} ${toY}, ${toX} ${toY}`,
						})
					}),
					ranked.anchors.map((anchor) => {
						const position = ranked.positions.get(anchor.id)
						if (position === undefined) return null
						const current = controller.currentRootId() !== null && controller.currentRootId() === anchor.rootSessionId
						return h("g", {
							key: anchor.id,
							className: "dla-anchor",
							"data-current": current ? "" : undefined,
							transform: `translate(${position.x} ${position.y})`,
						},
						h("title", null, anchor.label),
						h("rect", { width: anchor.width, height: 34, rx: 17, ry: 17 }),
						h("text", { x: 20, y: 17 }, truncate(anchor.label, LABEL_LIMIT)))
					}),
					nodes.map((node) => {
						const position = ranked.positions.get(node.id)
						if (position === undefined) return null
						const thread = controller.threadOf(node.sessionId)
						const running = thread !== null && thread.running === true
						const width = nodeWidthOf(node)
						return h("g", {
							key: node.id,
							className: "dla-node",
							"data-running": running ? "" : undefined,
							transform: `translate(${position.x} ${position.y})`,
							onClick: (event) => {
								event.stopPropagation()
								controller.openNode(node.id)
							},
							onDoubleClick: (event) => {
								// 双击节点体也是"回到会话"，给不习惯点小圆点的人一条路。
								event.stopPropagation()
								controller.openInMain(node.sessionId)
							},
						},
						h("rect", { width, height: 34, rx: 9, ry: 9 }),
						h("text", { x: 12, y: 17 }, truncate(nodeLabel(node), LABEL_LIMIT)),
						h("g", {
							className: "dla-node-open",
							transform: `translate(${width - 16} ${17})`,
							onClick: (event) => {
								event.stopPropagation()
								controller.openInMain(node.sessionId)
							},
						},
						h("title", null, t("graph.openSession")),
						h("circle", { r: 10.5 }),
						h("text", { x: 0, y: 0 }, "↗")))
					})))),
			// 工具栏放在**底部**：桌面版的窗口标题栏在顶部，顶栏有被遮住的风险。
			h("div", { className: "dla-graph-bar" },
				h("span", { className: "dla-graph-title" }, t("graph.title")),
				h("span", { className: "dla-graph-count" }, t("graph.count", { n: nodes.length })),
				h("span", { className: "dla-graph-spacer" }),
				h("button", { className: "dla-btn", onClick: () => controller.exportImage(nodes, t("graph.exportName")) }, t("graph.export")),
				h("button", { className: "dla-btn", onClick: fit }, t("graph.fit")),
				h("button", { className: "dla-btn", onClick: () => controller.toggleGraph() }, t("graph.close"))))
		}

		/**
		 * 渲染错误边界：卡片/画布万一抛错，只丢掉它们自己，入口按钮必须活着。
		 */
		class Guarded extends React.Component {
			constructor(props) {
				super(props)
				this.state = { failed: false }
			}

			static getDerivedStateFromError() {
				return { failed: true }
			}

			componentDidCatch(error) {
				console.error("[question-map] render failed:", error)
			}

			render() {
				return this.state.failed === true ? null : this.props.children
			}
		}

		/**
		 * 挂在 `shell.overlay` 上的根组件：入口按钮 + 小按钮 + 浮卡 + 画布。
		 *
		 * 用 portal 挂到 `document.body`：DSH 的 `shell.overlay` 宿主自带 `z-index:20` 的层叠上下文，
		 * 插件元素在里面永远压不过对话区/输入区自己的 `z-index:10~100`，
		 * 输入区一长就会盖住右下角。挂到 body 之后层级由我们自己决定。
		 */
		function LateralOverlay(props) {
			const controller = props.controller
			const t = useMemo(() => makeT(props), [props.t])
			const state = useSnapshot(controller)
			const node = state.card?.nodeId === undefined || state.card === null ? null : controller.nodeById(state.card.nodeId)
			useEffect(() => {
				if (node !== null) controller.ensureThread(node.sessionId)
			}, [controller, node?.sessionId])
			const thread = node === null ? null : controller.threadOf(node.sessionId)
			// 线程内容更新后需要重新渲染；threadsVersion 就是为此而存在。
			void state.threadsVersion
			// 当前会话变了要跟着变：入口按钮只在"与追问相关"的会话里出现。
			const currentId = useSyncExternalStore(controller.subscribeSessions, controller.currentSessionId, controller.currentSessionId)
			const related = controller.relatedGraph(currentId)
			const graphNodes = related === null
				? []
				: state.nodes.filter((entry) => (related.root === null ? entry.rootSessionId === null : entry.rootSessionId === related.root))
			useEffect(() => {
				if (related === null) controller.closeGraph()
			}, [related, controller])
			const layer = h("div", { className: "dla-layer", "data-question-map": "" },
				h(Guarded, null, state.graphOpen && related !== null ? h(GraphView, { controller, nodes: graphNodes, t }) : null),
				h(Guarded, null, state.button !== null && state.graphOpen === false ? h(AskButton, { controller, anchor: state.button, t }) : null),
				h(Guarded, null, state.card !== null && state.graphOpen === false ? h(AskCard, { controller, card: state.card, node, thread, t }) : null),
				// 常驻按钮只在画布关闭时出现：画布自己的底栏里已经有「导出图片 / 关闭」，
				// 两者同时在场会在右下角叠成一团。
				state.graphOpen === false && related !== null ? h("button", {
					className: "dla-entry",
					title: t("entry.title"),
					onClick: () => controller.toggleGraph(),
				},
				h("span", { className: "dla-entry-icon" }, "⟂"),
				h("span", { className: "dla-entry-label" }, t("entry.label")),
				graphNodes.length > 0 ? h("span", { className: "dla-entry-badge" }, String(graphNodes.length)) : null) : null,
				state.graphOpen === false && related !== null && graphNodes.length > 0 ? h("button", {
					className: "dla-entry dla-entry-export",
					title: t("graph.exportTip"),
					onClick: () => controller.exportImage(graphNodes, t("graph.exportName")),
				},
				h("span", { className: "dla-entry-label" }, t("graph.export"))) : null,
				state.actionNotice !== undefined && state.actionNotice !== null
					? h("div", { className: "dla-toast", "data-tone": state.actionNotice.tone ?? "error" }, state.actionNotice.message)
					: null)
			if (typeof document === "undefined" || typeof createPortal !== "function") return layer
			return createPortal(layer, document.body)
		}
		//#endregion

		//#region 插件入口
		/** 需要的客户端服务（cordis inject）。 */
		const inject = ["slots", "locale", "sessions", "uiConversation", "uiWorkspace", "workspaces", "remote", "remote.session"]

		/**
		 * 安装横向提问的全部界面。
		 * @param ctx - 客户端根上下文。
		 */
		function apply(ctx) {
			ctx.effect(() => ctx.locale.register("questionMap", { zh, en }), "question-map: dictionaries")
			const controller = new LateralController(ctx)
			ctx.effect(() => {
				controller.start()
				return () => controller.dispose()
			}, "question-map: controller")
			ctx.effect(() => ctx.slots.inject("shell.overlay", () => ctx.slots.register({
				name: "shell.overlay",
				id: "question-map",
				locale: "questionMap",
				inject: () => ({ controller }),
			}, LateralOverlay)), "question-map: overlay entry")
		}

		const pluginExports = { inject, apply }
		return pluginExports
		//#endregion
	},
})
