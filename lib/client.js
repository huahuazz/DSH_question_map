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
 * 设计文档：docs/design.md
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
		/** 浮卡默认宽度（px）；拖右下角改过之后按用户存下来的尺寸来。 */
		const CARD_WIDTH = 380
		/** 浮卡能缩到多小 / 放到多大（px）；宽度上限与视口再取一次小值。 */
		const CARD_MIN_WIDTH = 320
		const CARD_MIN_HEIGHT = 200
		const CARD_MAX_WIDTH = 760
		/** 用户拖出来的浮卡尺寸存在浏览器本地（不需要跨设备）。 */
		const CARD_SIZE_KEY = "dsh-question-map:card-size"
		/** 引文最多保留的字符数（提问与展示都用它）。 */
		const QUOTE_LIMIT = 1200
		/** 节点标签最多显示的字符数。 */
		const LABEL_LIMIT = 34
		/** 会话标题里用的前缀，方便在侧边栏认出横向会话。 */
		const TITLE_PREFIX = "⟂ "

		/** 中文词典（键集来源）。 */
		const zh = {
			"entry.label": "追问网格",
			"entry.title": "打开横向提问的网状图",
			"ask.button": "追问",
			"card.title": "横向提问",
			"card.creating": "正在新建会话…",
			"card.retry": "重试",
			"card.open": "在主页打开",
			"card.openSession": "打开会话",
			"card.remove": "从追问网格里删除这个节点（会连带它的子追问）",
			"card.removeConfirm": "再点一次确认删除",
			"card.drag": "按住标题区可拖动卡片",
			"card.resize": "拖动右下角可调整大小",
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
			"graph.title": "追问网格",
			"graph.empty": "还没有横向提问。选中一段文字开始吧。",
			"graph.fit": "适应画布",
			"graph.clear": "清空",
			"graph.clearConfirm": "再点一次清空整张图",
			"graph.close": "关闭",
			"graph.count": "{n} 个节点",
			"graph.anchor": "本次对话",
			"graph.anchorNone": "未归属提问",
			"graph.anchorOpen": "回到这个会话",
			"graph.anchorNoTarget": "这些提问没有归属会话，无法跳转",
			"graph.openSession": "回到这个提问的会话",
			"graph.export": "导出图片",
			"graph.exportTip": "把当前追问网格导出成 PNG 图片",
			"graph.exportName": "追问网格",
			"source.main": "来自本次对话",
			"source.node": "来自节点「{label}」",
			"source.unnamed": "未归属",
		}

		/** 英文词典，键集与中文一致。 */
		const en = {
			"entry.label": "Ask Grid",
			"entry.title": "Open the question grid",
			"ask.button": "Ask",
			"card.title": "Lateral question",
			"card.creating": "Creating a session…",
			"card.retry": "Retry",
			"card.open": "Open in main view",
			"card.openSession": "Open session",
			"card.remove": "Remove this node from the map (and its sub-questions)",
			"card.removeConfirm": "Click again to confirm",
			"card.drag": "Drag the header to move the card",
			"card.resize": "Drag the corner to resize",
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
			"graph.title": "Question grid",
			"graph.empty": "No lateral questions yet. Select some text to start.",
			"graph.fit": "Fit",
			"graph.clear": "Clear",
			"graph.clearConfirm": "Click again to clear the whole map",
			"graph.close": "Close",
			"graph.count": "{n} nodes",
			"graph.anchor": "This conversation",
			"graph.anchorNone": "Unattached",
			"graph.anchorOpen": "Go back to this conversation",
			"graph.anchorNoTarget": "These questions have no conversation to go back to",
			"graph.openSession": "Open this question's session",
			"graph.export": "Export image",
			"graph.exportTip": "Export the question grid as a PNG",
			"graph.exportName": "question-grid",
			"source.main": "from this conversation",
			"source.node": "from node “{label}”",
			"source.unnamed": "unattached",
		}
		//#endregion

		//#region 样式
		/** 自注入样式表；所有类名带 `dla-` 前缀，避免与 DSH 自身的样式冲突。 */
		const CSS = `
.dla-layer{position:fixed;inset:0;z-index:2147483000;pointer-events:none!important;font:inherit;--dla-ease:cubic-bezier(.2,.8,.2,1);--dla-depth-0:var(--dsw-alias-label-tertiary,#8b95a5);--dla-depth-1:var(--dsw-alias-brand-primary,#4d6bfe);--dla-depth-2:#12a594;--dla-depth-3:#8b5cf6}
.dla-layer>*{pointer-events:auto!important}
.dla-entry{position:fixed;right:18px;bottom:18px;z-index:2147483001;display:inline-flex;align-items:center;gap:7px;height:32px;padding:0 12px 0 11px;border-radius:16px;border:1px solid var(--dsw-alias-border-l2,#d8dce3);background:var(--dsw-alias-bg-layer-1,#fff);color:var(--dsw-alias-label-secondary,#4b5563);box-shadow:0 8px 24px -10px rgba(15,23,42,.28);cursor:pointer;font-size:12.5px;line-height:1;transition:background .12s var(--dla-ease),color .12s var(--dla-ease),border-color .12s var(--dla-ease)}
.dla-entry:hover{background:var(--dsw-alias-interactive-bg-hover,#f3f4f6);color:var(--dsw-alias-label-primary,#111827)}
.dla-entry[data-active]{border-color:var(--dsw-alias-brand-primary,#4d6bfe);color:var(--dsw-alias-brand-primary,#4d6bfe)}
.dla-entry-icon{font-size:14px;line-height:1;opacity:.85}
.dla-entry-badge{min-width:17px;height:17px;padding:0 5px;border-radius:9px;background:color-mix(in srgb,var(--dsw-alias-brand-primary,#4d6bfe) 12%,transparent);color:var(--dsw-alias-brand-primary,#4d6bfe);font-size:10.5px;font-weight:600;display:inline-flex;align-items:center;justify-content:center}
.dla-ask{position:fixed;display:inline-flex;align-items:center;gap:5px;height:26px;padding:0 10px;border-radius:13px;border:1px solid var(--dsw-alias-border-l2,#d8dce3);background:var(--dsw-alias-bg-layer-1,#fff);color:var(--dsw-alias-label-primary,#111827);box-shadow:0 6px 20px -6px rgba(15,23,42,.28);cursor:pointer;font-size:12px;line-height:1;white-space:nowrap;transition:border-color .12s var(--dla-ease),color .12s var(--dla-ease)}
.dla-ask:hover{border-color:var(--dsw-alias-brand-primary,#4d6bfe);color:var(--dsw-alias-brand-primary,#4d6bfe)}
.dla-card{position:fixed;display:flex;flex-direction:column;width:${CARD_WIDTH}px;max-height:min(72vh,600px);border-radius:14px;border:1px solid var(--dsw-alias-border-l2,#d8dce3);background:var(--dsw-alias-bg-layer-1,#fff);color:var(--dsw-alias-label-primary,#111827);box-shadow:0 16px 48px -12px rgba(15,23,42,.32),0 2px 8px rgba(15,23,42,.06);overflow:hidden;animation:dla-pop .14s var(--dla-ease)}
.dla-card[data-dragging]{box-shadow:0 26px 68px -16px rgba(15,23,42,.44),0 4px 12px rgba(15,23,42,.12)}
.dla-card-head{display:flex;align-items:flex-start;gap:10px;padding:12px 12px 12px 16px;border-bottom:1px solid var(--dsw-alias-border-l1,#e5e7eb);cursor:grab;user-select:none}
.dla-card-head[data-dragging]{cursor:grabbing}
.dla-card-title{flex:1;min-width:0}
.dla-card-term{font-size:13px;font-weight:600;letter-spacing:.01em;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.dla-card-source{margin-top:4px;font-size:11px;letter-spacing:.01em;color:var(--dsw-alias-label-tertiary,#8b95a5);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.dla-card-actions{display:flex;align-items:center;gap:2px;opacity:0;transition:opacity .12s var(--dla-ease)}
.dla-card:hover .dla-card-actions,.dla-card:focus-within .dla-card-actions{opacity:1}
.dla-card-resize{position:absolute;right:0;bottom:0;width:15px;height:15px;cursor:nwse-resize;touch-action:none;opacity:.5;background-image:linear-gradient(135deg,transparent 44%,var(--dsw-alias-border-l2,#d8dce3) 44% 52%,transparent 52% 64%,var(--dsw-alias-border-l2,#d8dce3) 64% 72%,transparent 72%);transition:opacity .12s var(--dla-ease)}
.dla-card-resize:hover{opacity:1}
.dla-icon-btn{width:26px;height:26px;border:none;border-radius:7px;background:transparent;color:var(--dsw-alias-label-tertiary,#8b95a5);cursor:pointer;line-height:1;display:inline-flex;align-items:center;justify-content:center;flex:none;transition:background .12s var(--dla-ease),color .12s var(--dla-ease)}
.dla-icon-btn:hover{background:var(--dsw-alias-interactive-bg-hover,#f3f4f6);color:var(--dsw-alias-label-primary,#111827)}
.dla-icon-btn[data-danger]{color:#fff;background:var(--dsw-alias-state-error-primary,#d93025);font-size:11px;width:auto;padding:0 9px;border-radius:7px}
.dla-link-btn{height:26px;padding:0 8px;border:1px solid transparent;border-radius:7px;background:transparent;color:var(--dsw-alias-label-secondary,#4b5563);font-size:12px;line-height:1;cursor:pointer;white-space:nowrap;display:inline-flex;align-items:center;gap:5px;transition:background .12s var(--dla-ease),color .12s var(--dla-ease)}
.dla-link-btn:hover{background:var(--dsw-alias-interactive-bg-hover,#f3f4f6);color:var(--dsw-alias-brand-primary,#4d6bfe)}
.dla-toast{position:fixed;right:18px;bottom:64px;max-width:340px;padding:9px 13px;border-radius:11px;background:var(--dsw-alias-state-error-primary,#d93025);color:#fff;font-size:12px;line-height:1.55;box-shadow:0 10px 30px -10px rgba(15,23,42,.5)}
.dla-toast[data-tone=info]{background:var(--dsw-alias-state-success-primary,#12a150)}
.dla-card-body{flex:1;min-height:64px;overflow-y:auto;padding:14px 16px;display:flex;flex-direction:column;gap:12px}
.dla-notice{font-size:11px;line-height:1.55;color:var(--dsw-alias-label-tertiary,#8b95a5)}
.dla-quote{padding:2px 0 2px 10px;border-left:2px solid color-mix(in srgb,var(--dsw-alias-brand-primary,#4d6bfe) 45%,transparent);font-size:12px;line-height:1.65;color:var(--dsw-alias-label-tertiary,#8b95a5)}
.dla-error{font-size:12px;line-height:1.55;color:var(--dsw-alias-state-error-primary,#d93025);word-break:break-word}
.dla-msg{font-size:13.5px;line-height:1.7}
.dla-msg[data-role=user]{align-self:flex-end;max-width:88%;padding:6px 10px;border-radius:10px;background:var(--dsw-alias-bg-layer-2,#f3f4f6);color:var(--dsw-alias-label-secondary,#4b5563);white-space:pre-wrap;word-break:break-word;line-height:1.6}
.dla-msg[data-role=assistant]{align-self:stretch}
.dla-msg[data-role=assistant] p{margin:0 0 10px}
.dla-msg[data-role=assistant] p:last-child{margin-bottom:0}
.dla-card-foot{display:flex;flex-direction:column;gap:8px;padding:12px 16px 16px;border-top:1px solid var(--dsw-alias-border-l1,#e5e7eb)}
.dla-input{width:100%;box-sizing:border-box;min-height:56px;max-height:140px;resize:vertical;padding:9px 11px;border-radius:10px;border:1px solid var(--dsw-alias-border-l2,#d8dce3);background:transparent;color:inherit;font:inherit;font-size:13px;line-height:1.55;transition:border-color .12s var(--dla-ease),box-shadow .12s var(--dla-ease)}
.dla-input:focus{outline:none;border-color:var(--dsw-alias-brand-primary,#4d6bfe);box-shadow:0 0 0 3px color-mix(in srgb,var(--dsw-alias-brand-primary,#4d6bfe) 14%,transparent)}
.dla-actions{display:flex;align-items:center;gap:8px;justify-content:flex-end}
.dla-btn{height:30px;padding:0 12px;border-radius:8px;border:1px solid var(--dsw-alias-border-l2,#d8dce3);background:transparent;color:var(--dsw-alias-label-secondary,#4b5563);font-size:12.5px;cursor:pointer;display:inline-flex;align-items:center;gap:6px;transition:background .12s var(--dla-ease),color .12s var(--dla-ease),border-color .12s var(--dla-ease)}
.dla-btn:hover{background:var(--dsw-alias-interactive-bg-hover,#f3f4f6)}
.dla-btn[data-primary]{border-color:transparent;background:var(--dsw-alias-brand-primary,#4d6bfe);color:#fff}
.dla-btn[data-primary]:hover{background:color-mix(in srgb,var(--dsw-alias-brand-primary,#4d6bfe) 88%,#000)}
.dla-btn[data-primary]:disabled{opacity:.45;cursor:default}
.dla-graph{position:fixed;inset:0;z-index:2147483000;display:flex;flex-direction:column;gap:10px;padding:14px;background:color-mix(in srgb,var(--dsw-alias-bg-overlay,#000) 58%,transparent)}
.dla-graph-bar{display:flex;align-items:center;gap:8px;flex-wrap:wrap;padding:9px 12px;border-radius:13px;background:rgba(17,24,39,.9);color:#fff;font-size:13px;box-shadow:0 10px 30px -12px rgba(0,0,0,.5)}
.dla-graph-title{font-weight:600;letter-spacing:.01em}
.dla-graph-count{color:rgba(255,255,255,.6);font-size:12px}
.dla-graph-spacer{flex:1}
.dla-graph-bar .dla-btn{height:30px;padding:0 11px;border-color:rgba(255,255,255,.22);color:#fff;background:rgba(255,255,255,.09);font-size:12.5px}
.dla-graph-bar .dla-btn:hover{background:rgba(255,255,255,.18)}
.dla-graph-bar .dla-btn[data-danger]{border-color:transparent;background:var(--dsw-alias-state-error-primary,#d93025)}
.dla-graph-canvas{flex:1;min-height:0;border-radius:16px;border:1px solid var(--dsw-alias-border-l1,#e5e7eb);background:radial-gradient(120% 90% at 12% -10%,color-mix(in srgb,var(--dsw-alias-brand-primary,#4d6bfe) 13%,transparent),transparent 62%),radial-gradient(circle at 1px 1px,color-mix(in srgb,var(--dsw-alias-label-primary,#111827) 9%,transparent) 1px,transparent 1.2px) 0 0/22px 22px,var(--dsw-alias-bg-layer-1,#fff);box-shadow:0 30px 70px -30px rgba(2,6,23,.42);color:var(--dsw-alias-label-primary,#111827);overflow:hidden;position:relative}
.dla-graph-empty{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;font-size:13px;color:var(--dsw-alias-label-tertiary,#8b95a5)}
.dla-svg{display:block;width:100%;height:100%;cursor:grab}
.dla-svg[data-panning]{cursor:grabbing}
.dla-node,.dla-anchor,.dla-edge{transition:opacity .12s var(--dla-ease)}
.dla-svg[data-focus] .dla-node:not([data-active]),.dla-svg[data-focus] .dla-anchor:not([data-active]),.dla-svg[data-focus] .dla-edge:not([data-active]){opacity:.25}
.dla-node{cursor:pointer}
.dla-node rect:not(.dla-node-bar){fill:var(--dsw-alias-bg-layer-1,#fff);stroke:color-mix(in srgb,var(--dla-node-color,var(--dsw-alias-border-l2,#d8dce3)) 40%,transparent);stroke-width:1.2;transition:stroke .12s var(--dla-ease),filter .12s var(--dla-ease)}
.dla-node:hover rect:not(.dla-node-bar),.dla-node[data-active] rect:not(.dla-node-bar){stroke:var(--dla-node-color,var(--dsw-alias-brand-primary,#4d6bfe));filter:drop-shadow(0 6px 14px rgba(15,23,42,.12))}
.dla-node text{font-size:12px;fill:var(--dsw-alias-label-primary,#111827);dominant-baseline:middle;pointer-events:none}
.dla-node[data-running] rect:not(.dla-node-bar){stroke:var(--dla-node-color,var(--dsw-alias-brand-primary,#4d6bfe));animation:dla-breathe 1.6s ease-in-out infinite}
.dla-node-bar{stroke:none;pointer-events:none}
.dla-node-open{cursor:pointer;color:var(--dsw-alias-label-tertiary,#8b95a5)}
.dla-node-open circle{fill:var(--dsw-alias-bg-layer-1,#fff);stroke:var(--dsw-alias-border-l2,#d8dce3);transition:fill .12s var(--dla-ease),stroke .12s var(--dla-ease)}
.dla-node-open:hover{color:#fff}
.dla-node-open:hover circle{fill:var(--dsw-alias-brand-primary,#4d6bfe);stroke:var(--dsw-alias-brand-primary,#4d6bfe)}
.dla-anchor rect{fill:color-mix(in srgb,var(--dsw-alias-bg-layer-2,#f3f4f6) 92%,transparent);stroke:var(--dsw-alias-border-l2,#d8dce3);stroke-dasharray:5 3}
.dla-anchor[data-current] rect{stroke:var(--dsw-alias-brand-primary,#4d6bfe);stroke-dasharray:none}
.dla-anchor[data-current] text{fill:var(--dsw-alias-brand-primary,#4d6bfe)}
.dla-anchor[data-clickable]{cursor:pointer}
.dla-anchor[data-clickable]:hover rect{stroke:var(--dsw-alias-brand-primary,#4d6bfe);stroke-dasharray:none}
.dla-anchor[data-clickable]:hover text{fill:var(--dsw-alias-brand-primary,#4d6bfe)}
.dla-anchor text{font-size:12px;fill:var(--dsw-alias-label-secondary,#4b5563);dominant-baseline:middle;pointer-events:none}
.dla-edge{fill:none;stroke:color-mix(in srgb,var(--dla-edge-color,var(--dsw-alias-border-l2,#d8dce3)) 55%,transparent);stroke-width:1.4;stroke-linecap:round}
.dla-edge[data-active]{stroke:var(--dsw-alias-brand-primary,#4d6bfe);stroke-width:2}
.dla-root-label{font-size:12px;fill:var(--dsw-alias-label-tertiary,#8b95a5);dominant-baseline:middle}
@keyframes dla-pop{from{opacity:0;transform:scale(.97)}to{opacity:1;transform:none}}
@keyframes dla-breathe{0%,100%{stroke-opacity:1}50%{stroke-opacity:.3}}
@media (prefers-reduced-motion:reduce){.dla-card{animation:none}.dla-node[data-running] rect{animation:none}.dla-node,.dla-anchor,.dla-edge{transition:none}}
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
					exportPng: () => this.exportImage(this.state.nodes, "追问网格"),
					layout: () => layoutGraph(this.state.nodes, (rootSessionId) => this.sessionTitle(rootSessionId)),
					components: { GraphView, AskCard, LateralOverlay },
					nodeBox: (nodeId) => {
						const target = this.nodeById(nodeId)
						return target === null ? null : { lines: nodeLines(target), width: nodeWidthOf(target), height: nodeHeightOf(target) }
					},
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
			 * 从既有会话重建追问网格：横向会话的标题都以 `⟂` 开头，标题就是当初问的那个词。
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
						if (term === "" || term === "追问网格" || term === "追问网") continue
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
					if (snapshot === undefined || snapshot === null) return null
					// 0.2.x：列表快照不再有 `current`，当前会话 = 被主视图保留（retainedBy.mainView）的那一行。
					const byId = snapshot.byId
					if (byId !== undefined && byId !== null && typeof byId === "object") {
						for (const id of Object.keys(byId)) {
							const row = byId[id]
							if (row === null || typeof row !== "object") continue
							if ((row.retainedBy?.mainView ?? 0) > 0) return id
						}
					}
					// 0.1.x 兼容：老版本直接把当前会话放在 `current`。
					return snapshot.current ?? null
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
					// 0.2.x 的行有 `displayTitle`（标题或工作目录的兜底名），优先用它。
					const label = summary?.displayTitle
					if (typeof label === "string" && label.trim() !== "") return label.trim()
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
			 * 判断一个会话与"追问网格"的关系：它本身是某张图的根会话，或者它本身就是一个横向提问会话。
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
				// 只认两种直接关系：当前会话是某个追问本身，或者它是某张图的根会话。
				// 不做"同工作区就算相关"的推断——那会让无关会话里也冒出入口按钮。
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
				this.state = { ...this.state, nodes: [], card: null, confirmClear: false }
				this.saveGraph()
				this.notify()
			}

			/** 第一次点"清空"：把按钮切成确认态。 */
			markClear() {
				this.state = { ...this.state, confirmClear: true }
				this.notify()
			}

			/** 第一次点删除：把按钮切成"确认删除"，不立刻动手。 */
			markRemove(nodeId) {
				const card = this.state.card
				if (card === null) return
				this.state = { ...this.state, card: { ...card, confirmRemove: nodeId } }
				this.notify()
			}

			/**
			 * 删除一个节点及其所有子孙（只删图里的记录，不删会话本身）。
			 * @param nodeId - 节点 id。
			 */
			removeNode(nodeId) {
				const doomed = new Set([nodeId])
				let grew = true
				while (grew) {
					grew = false
					for (const node of this.state.nodes) {
						if (doomed.has(node.id)) continue
						if (node.parent !== null && node.parent !== undefined && node.parent.kind === "node" && doomed.has(node.parent.nodeId)) {
							doomed.add(node.id)
							grew = true
						}
					}
				}
				const card = this.state.card
				const cardGone = card !== null && card.nodeId !== undefined && doomed.has(card.nodeId)
				this.state = {
					...this.state,
					nodes: this.state.nodes.filter((node) => doomed.has(node.id) === false),
					card: cardGone ? null : card,
					confirmRemove: null,
					confirmClear: false,
				}
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
					if (this.state.button === null && this.state.card === null) return
					this.state = { ...this.state, button: null, card: null }
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
					this.state = { ...this.state, button: null, card: null, graphOpen: false }
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
				const parent = this.parentForSelection(inCard)
				const left = Math.min(window.innerWidth - 110, Math.max(8, rect.right + 8))
				const top = Math.min(window.innerHeight - 36, Math.max(8, rect.top - 6))
				const button = { left, top, rect: { left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom }, term: raw, quote: quoteAround(range, raw), parent }
				this.state = { ...this.state, button }
				this.notify()
			}

			/**
			 * 推断这次追问的父节点：浮卡里选词 → 当前卡片那个节点；
			 * 主视图本身停在某个追问会话里选词 → 那个追问会话对应的节点（这样它会成为子节点，
			 * 并继承同一张图的根，而不是另起一张图）。
			 * @param inCard - 选区是否落在浮卡内。
			 * @returns `{ kind: 'node', nodeId }`，判断不出来时 null（视为根会话下的第一层）。
			 */
			parentForSelection(inCard) {
				if (inCard && this.state.card !== null && this.state.card.nodeId !== undefined) {
					return { kind: "node", nodeId: this.state.card.nodeId }
				}
				const currentId = this.currentRootId()
				if (currentId === null) return null
				const owner = this.state.nodes.find((node) => node.sessionId === currentId)
				return owner === undefined ? null : { kind: "node", nodeId: owner.id }
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
				// 0.2.x 的列表快照没有 `current`：统一走 currentRootId()（retainedBy.mainView）。
				const currentId = this.currentRootId() ?? undefined
				const current = currentId === undefined || list === undefined || list === null ? undefined : list.byId?.[currentId]
				// 和 DSH 自己新建会话的方式对齐：优先用「当前会话所属工作区」的 workspaceId
				// （只有 workspaceId 会触发 workspace.attachSession()），拿不到才退回 cwd。
				const workspaceId = anchor.workspaceIdOverride ?? this.workspaceOf(currentId)
				const cwd = anchor.cwdOverride ?? current?.cwd
				const parent = anchor.parent ?? null
				const parentNode = parent !== null && parent.kind === "node" ? this.nodeById(parent.nodeId) : null
				const rootSessionId = parentNode !== null ? parentNode.rootSessionId ?? null : currentId ?? null

				this.pending = { id: newId(), term, question, quote, phase: "creating", error: null, noWorkspace: workspaceId === undefined && cwd === undefined, rect: anchor.rect ?? null }
				// 捕获成局部变量：切走会话会清空 `this.pending`，但这次提问仍要继续落库。
				const pendingId = this.pending.id
				this.pendingAnchor = anchor
				this.state = { ...this.state, button: null, card: { pendingId, phase: "creating", rect: anchor.rect ?? null } }
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
					id: pendingId,
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
				// 期间用户可能已经切走会话（切走会清空卡片）：那就不要把卡片再弹回来。
				const stillHere = this.lastSessionId === undefined || this.lastSessionId === currentId || this.lastSessionId === null
				this.pending = null
				this.state = stillHere
					? { ...this.state, card: { nodeId: node.id, rect: anchor.rect ?? null } }
					: { ...this.state, card: null }
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
				this.state = { ...this.state, graphOpen: false, card: { nodeId, rect: null } }
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

			/**
			 * 会话切换时清场：浮卡、待定提问、选区按钮都属于「上一个会话」的上下文，
			 * 留着会和新的对话混在一起。切走只收起界面，已经发出的提问仍会继续落库。
			 * @param currentId - 新的当前会话 id。
			 */
			onSessionChanged(currentId) {
				if (this.lastSessionId === currentId) return
				const first = this.lastSessionId === undefined
				this.lastSessionId = currentId ?? null
				if (first) return
				if (this.state.card === null && this.state.button === null && this.pending === null) return
				this.pending = null
				this.state = { ...this.state, card: null, button: null }
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
				// 只校验**最后一次**请求——连续点两个节点时，前一个的校验会拿"已被换掉的当前会话"
				// 报一条假警告（并弹一条假提示），这不是失败，只是请求过期了。
				const token = (this.openToken ?? 0) + 1
				this.openToken = token
				setTimeout(() => {
					if (this.openToken !== token) return
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

		//#region 图标
		/** 内联图标（24×24 网格，线性描边，颜色跟 currentColor）。 */
		const ICONS = {
			"arrow-up-right": ["M8 16 16 8", "M9.5 8H16v6.5"],
			trash: [
				"M4 7h16",
				"M9.5 7V5.8c0-1 .8-1.8 1.8-1.8h1.4c1 0 1.8.8 1.8 1.8V7",
				"M6.2 7l.78 11.2c.07.95.86 1.8 1.82 1.8h6.4c.96 0 1.75-.85 1.82-1.8L17.8 7",
				"M10.4 11v5.4",
				"M13.6 11v5.4",
			],
			x: ["M7 7l10 10", "M17 7 7 17"],
			"message-circle": ["M20.5 11.6a8.1 8.1 0 0 1-8.7 8.2 8.6 8.6 0 0 1-3.4-.7L4 20.5l1.4-4.1a8.2 8.2 0 0 1-1-3.9 8.1 8.1 0 0 1 8.3-8 8.1 8.1 0 0 1 7.8 7.1Z"],
			download: ["M12 4v10", "M8.5 10.5 12 14l3.5-3.5", "M5 19h14"],
			fit: ["M9 4.5H4.5V9", "M15 4.5h4.5V9", "M20.5 15v4.5H16", "M4.5 15v4.5H9"],
			send: ["M12 19V5.5", "M6.5 11 12 5.5 17.5 11"],
		}

		/** 渲染一个内联图标。 */
		function Icon({ name, size = 16 }) {
			const paths = ICONS[name] ?? []
			return h("svg", {
				viewBox: "0 0 24 24",
				width: size,
				height: size,
				fill: "none",
				stroke: "currentColor",
				"stroke-width": 1.6,
				"stroke-linecap": "round",
				"stroke-linejoin": "round",
				"aria-hidden": "true",
				focusable: "false",
			}, paths.map((d, index) => h("path", { key: index, d })))
		}

		/** 按层级取色：0 锚点中性、1 品牌蓝、2 青、3 及以后紫。 */
		function depthColor(depth) {
			const index = Math.min(3, Math.max(0, Number.isFinite(depth) ? Math.round(depth) : 0))
			return `var(--dla-depth-${index})`
		}
		//#endregion

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

		/** 浮卡允许的最大宽度：不超过常量上限，也不超过视口（留 24px 余量）。 */
		function cardMaxWidth() {
			const viewport = typeof window === "undefined" || typeof window.innerWidth !== "number" ? CARD_MAX_WIDTH + 24 : window.innerWidth
			return Math.max(CARD_MIN_WIDTH, Math.min(CARD_MAX_WIDTH, viewport - 24))
		}

		/** 浮卡允许的最大高度：跟着视口走，别把底栏顶到屏幕外。 */
		function cardMaxHeight() {
			const viewport = typeof window === "undefined" || typeof window.innerHeight !== "number" ? 900 : window.innerHeight
			return Math.max(CARD_MIN_HEIGHT, viewport - 24)
		}

		/** 把数字夹到范围内；不是有效数字就返回 null。 */
		function clampCardNumber(value, min, max) {
			if (typeof value !== "number" || Number.isFinite(value) === false) return null
			return Math.round(Math.min(max, Math.max(min, value)))
		}

		/** 读回上次拖出来的浮卡尺寸；没存过或存坏了就用默认宽度 + 高度自适应。 */
		function readCardSize() {
			if (typeof localStorage === "undefined") return null
			try {
				const raw = localStorage.getItem(CARD_SIZE_KEY)
				if (raw === null) return null
				const parsed = JSON.parse(raw)
				const width = clampCardNumber(parsed?.width, CARD_MIN_WIDTH, cardMaxWidth())
				const height = clampCardNumber(parsed?.height, CARD_MIN_HEIGHT, cardMaxHeight())
				return width === null || height === null ? null : { width, height }
			} catch (_failure) {
				return null
			}
		}

		/** 记住这次拖出来的尺寸，下次打开还是这么大。 */
		function writeCardSize(size) {
			if (typeof localStorage === "undefined") return
			try {
				localStorage.setItem(CARD_SIZE_KEY, JSON.stringify(size))
			} catch (_failure) {
				/* 隐私模式写不进去也无所谓，下次回到默认大小 */
			}
		}

		/** 锚定浮卡。 */
		function AskCard({ controller, card, node, thread, t }) {
			const [draft, setDraft] = useState("")
			const [offset, setOffset] = useState(null)
			const [size, setSize] = useState(() => readCardSize())
			const [dragging, setDragging] = useState(false)
			const dragRef = useRef(null)
			const resizeRef = useRef(null)
			const resizedRef = useRef(null)
			const bodyRef = useRef(null)
			// 宽度参与定位与夹取，先算出来，后面各处都用它。
			const width = size === null ? CARD_WIDTH : size.width

			// 新内容出现时滚到底。
			useEffect(() => {
				const body = bodyRef.current
				if (body !== null) body.scrollTop = body.scrollHeight
			}, [thread?.messages.length, thread?.running, node?.id])

			// 拖标题区移动卡片；夹在视口里，别拖出屏幕。
			const onHeadPointerDown = (event) => {
				if (event.target instanceof Element && event.target.closest("button") !== null) return
				const rect = event.currentTarget.getBoundingClientRect()
				dragRef.current = { dx: event.clientX - rect.left, dy: event.clientY - rect.top }
				event.currentTarget.setPointerCapture?.(event.pointerId)
				setDragging(true)
			}

			const onHeadPointerMove = (event) => {
				const drag = dragRef.current
				if (drag === null) return
				const maxLeft = Math.max(8, window.innerWidth - width - 8)
				const maxTop = Math.max(8, window.innerHeight - 120)
				setOffset({
					left: Math.min(maxLeft, Math.max(8, event.clientX - drag.dx)),
					top: Math.min(maxTop, Math.max(8, event.clientY - drag.dy)),
				})
			}

			const onHeadPointerUp = (event) => {
				if (dragRef.current === null) return
				dragRef.current = null
				event.currentTarget.releasePointerCapture?.(event.pointerId)
				setDragging(false)
			}

			// 右下角把手改大小：过程中只动 state，松手才写本地存储。
			const onResizePointerDown = (event) => {
				event.preventDefault()
				event.stopPropagation()
				const box = event.currentTarget.parentElement?.getBoundingClientRect()
				resizeRef.current = {
					startX: event.clientX,
					startY: event.clientY,
					width: box?.width ?? width,
					height: box?.height ?? CARD_MIN_HEIGHT,
				}
				event.currentTarget.setPointerCapture?.(event.pointerId)
			}

			const onResizePointerMove = (event) => {
				const start = resizeRef.current
				if (start === null) return
				const next = {
					width: clampCardNumber(start.width + (event.clientX - start.startX), CARD_MIN_WIDTH, cardMaxWidth()),
					height: clampCardNumber(start.height + (event.clientY - start.startY), CARD_MIN_HEIGHT, cardMaxHeight()),
				}
				if (next.width === null || next.height === null) return
				resizedRef.current = next
				setSize(next)
			}

			const onResizePointerUp = (event) => {
				if (resizeRef.current === null) return
				resizeRef.current = null
				event.currentTarget.releasePointerCapture?.(event.pointerId)
				const final = resizedRef.current
				if (final !== null) writeCardSize(final)
			}

			// 位置：拖动过就用拖动结果，否则贴着选区。
			const position = useMemo(() => {
				if (offset !== null) return { left: offset.left, top: offset.top }
				const rect = card.rect ?? null
				const margin = 10
				const maxLeft = window.innerWidth - width - margin
				const left = rect === null ? Math.max(margin, window.innerWidth - width - 24) : Math.min(maxLeft, Math.max(margin, rect.right + 12))
				const top = rect === null ? 96 : Math.min(window.innerHeight - 220, Math.max(margin, rect.top - 8))
				return { left, top }
			}, [offset, card.rect, width])

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
				"data-dragging": dragging ? "" : undefined,
				style: size === null
					? { left: `${position.left}px`, top: `${position.top}px`, width: `${width}px` }
					: { left: `${position.left}px`, top: `${position.top}px`, width: `${width}px`, height: `${size.height}px`, maxHeight: "none" },
				onMouseDown: (event) => {
					event.stopPropagation()
				},
			},
			h("div", {
				className: "dla-card-head",
				title: t("card.drag"),
				"data-dragging": dragging ? "" : undefined,
				onPointerDown: onHeadPointerDown,
				onPointerMove: onHeadPointerMove,
				onPointerUp: onHeadPointerUp,
				onPointerCancel: onHeadPointerUp,
			},
			h("div", { className: "dla-card-title" },
				h("div", { className: "dla-card-term" }, node === null ? "⟂ …" : `⟂ ${truncate(term, 40)}`),
				h("div", { className: "dla-card-source" }, sourceLabel)),
			h("div", { className: "dla-card-actions" },
				node !== null ? h("button", {
					className: "dla-link-btn",
					title: t("card.open"),
					onClick: () => controller.openInMain(node.sessionId),
				}, h(Icon, { name: "arrow-up-right", size: 14 }), t("card.openSession")) : null,
				// 删除这个节点（连带它的子追问）；两次点击确认，避免误删。
				node !== null ? h("button", {
					className: "dla-icon-btn",
					"data-danger": card.confirmRemove === node.id ? "" : undefined,
					title: card.confirmRemove === node.id ? t("card.removeConfirm") : t("card.remove"),
					onClick: () => controller.state.card?.confirmRemove === node.id
						? controller.removeNode(node.id)
						: controller.markRemove(node.id),
				}, card.confirmRemove === node.id ? "确认删除" : h(Icon, { name: "trash", size: 14 })) : null,
				h("button", {
					className: "dla-icon-btn",
					title: t("card.close"),
					onClick: () => controller.closeCard(),
				}, h(Icon, { name: "x", size: 14 })))),

			h("div", { className: "dla-card-body", ref: bodyRef },
				node === null && controller.pending !== null ? h("div", { className: "dla-notice" }, t("card.creating")) : null,
				node === null && controller.pending?.noWorkspace === true ? h("div", { className: "dla-notice" }, t("card.noWorkspace")) : null,
				pendingError !== null ? h("div", { className: "dla-error" }, `${t("card.createFailed")}：${pendingError}`) : null,
				node !== null && node.quote !== undefined && node.quote !== "" ? h("div", { className: "dla-quote" }, truncate(node.quote, 160)) : null,
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
				autoFocus: true,
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
					}, h(Icon, { name: "send", size: 14 }), t("card.send")))),
			// 右下角把手：按住拖动即可改宽高（尺寸会存在浏览器本地）。
			h("div", {
				className: "dla-card-resize",
				title: t("card.resize"),
				onPointerDown: onResizePointerDown,
				onPointerMove: onResizePointerMove,
				onPointerUp: onResizePointerUp,
				onPointerCancel: onResizePointerUp,
			}))
		}

		//#region 图布局与导出（纯函数，导出与测试共用）
		/**
		 * 节点的显示名：优先用"你当时选中的那段原文"（或卡片里输入的那句），
		 * 这才是你认得出的东西；旧实现从问句模板里反推，遇到冒号/句号会把后半句切掉，
		 * 看起来就像"内容没显示全"。
		 */
		function nodeLabel(node) {
			if (node === null || node === undefined) return ""
			const term = typeof node.term === "string" ? node.term.replace(/\s+/gu, " ").trim() : ""
			if (term !== "") return truncate(term, 120)
			const question = typeof node.question === "string" ? node.question.trim() : ""
			const asked = /解释「([^」]{1,40})」/u.exec(question)
			return asked === null ? "" : truncate(asked[1], 120)
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
			// 先只算"第几层 + 行号"，列坐标等所有节点宽度算完再统一排——否则长标签会互相压住。
			const place = (node, depth) => {
				const kids = (children.get(node.id) ?? []).filter((kid) => positions.has(kid.id) === false)
				if (kids.length === 0) {
					positions.set(node.id, { x: 0, y: row * ROW_HEIGHT, depth })
					row += 1
					return row - 1
				}
				const rows = kids.map((kid) => place(kid, depth + 1))
				const y = (Math.min(...rows) + Math.max(...rows)) / 2
				positions.set(node.id, { x: 0, y: y * ROW_HEIGHT, depth })
				for (const kid of kids) edges.push({ from: node.id, to: kid.id })
				return y
			}
			for (const [rootKey, list] of rootsByAnchor) {
				const rows = list.filter((node) => positions.has(node.id) === false).map((node) => place(node, 1))
				if (rows.length === 0) continue
				const anchorId = `anchor:${rootKey}`
				const y = (Math.min(...rows) + Math.max(...rows)) / 2
				positions.set(anchorId, { x: 0, y: y * ROW_HEIGHT, depth: 0 })
				const rootSessionId = rootKey === "none" ? null : rootKey
				const label = rootSessionId === null ? "未归属提问" : anchorLabelOf(rootSessionId) ?? "本次对话"
				anchors.push({ id: anchorId, rootSessionId, label, width: anchorWidthOf(label) })
				for (const node of list) edges.push({ from: anchorId, to: node.id })
			}

			// 每一层取该层最宽的节点，列间距据此累加（长标签也能完整显示，不会被下一列压住）。
			const widthAtDepth = new Map()
			for (const [id, position] of positions.entries()) {
				const width = id.startsWith("anchor:")
					? anchors.find((anchor) => anchor.id === id)?.width ?? 132
					: nodeWidthOf(byId.get(id))
				widthAtDepth.set(position.depth, Math.max(widthAtDepth.get(position.depth) ?? 0, width))
			}
			const columnX = new Map()
			let cursor = 0
			for (let depth = 0; depth <= Math.max(...widthAtDepth.keys(), 0); depth += 1) {
				columnX.set(depth, cursor)
				cursor += (widthAtDepth.get(depth) ?? 0) + COLUMN_GAP
			}
			for (const position of positions.values()) position.x = columnX.get(position.depth) ?? 0

			let minX = 0
			let maxX = 0
			let minY = 0
			let maxY = 0
			const nodeHeightAt = (id) => {
				if (id.startsWith("anchor:")) return NODE_HEIGHT
				const node = byId.get(id)
				return node === undefined ? NODE_HEIGHT : nodeHeightOf(node)
			}
			let first = true
			for (const [id, position] of positions.entries()) {
				const width = id.startsWith("anchor:")
					? anchors.find((anchor) => anchor.id === id)?.width ?? 132
					: nodeWidthOf(byId.get(id))
				if (first) {
					minX = position.x
					maxX = position.x + width
					minY = position.y
					maxY = position.y + nodeHeightAt(id)
					first = false
					continue
				}
				minX = Math.min(minX, position.x)
				maxX = Math.max(maxX, position.x + width)
				minY = Math.min(minY, position.y)
				maxY = Math.max(maxY, position.y + nodeHeightAt(id))
			}
			return { positions, edges, anchors, bounds: { minX, maxX, minY, maxY } }
		}

		/** 图布局的固定尺寸（行高 = 节点高度 + 行距；列间距用于分隔层级）。 */
		const NODE_HEIGHT = 34
		const NODE_HEIGHT_WRAPPED = 50
		const ROW_HEIGHT = 76
		const COLUMN_GAP = 96
		/** 单行最多多少个字：超过就折成第二行，两行还放不下才省略。 */
		const LINE_CHARS = 28

		/** 字符宽度估算：中日韩全角按 13px，其余按 7.4px（12px 字号下的经验值）。 */
		function textWidth(text) {
			let width = 0
			for (const character of String(text ?? "")) {
				width += character.codePointAt(0) > 0x2e7f ? 13 : 7.4
			}
			return width
		}

		/**
		 * 把节点标签折成最多两行：第一行放满 LINE_CHARS 个字，剩下放第二行；两行还放不下才省略。
		 * @param node - 图节点。
		 * @returns 行数组（1 或 2 项）。
		 */
		function nodeLines(node) {
			const chars = [...nodeLabel(node)]
			if (chars.length <= LINE_CHARS) return [chars.join("")]
			const first = chars.slice(0, LINE_CHARS).join("")
			const rest = chars.slice(LINE_CHARS)
			const second = rest.length <= LINE_CHARS ? rest.join("") : `${rest.slice(0, LINE_CHARS - 1).join("")}…`
			return [first, second]
		}

		/** 节点高度：单行 34，两行 50。 */
		function nodeHeightOf(node) {
			return nodeLines(node).length > 1 ? NODE_HEIGHT_WRAPPED : NODE_HEIGHT
		}

		/** 节点圆角矩形的宽度：按最长一行文字自适应，并给右侧 ↗ 按钮留位置。 */
		function nodeWidthOf(node) {
			const widest = Math.max(...nodeLines(node).map((line) => textWidth(line)))
			return Math.round(Math.min(420, Math.max(96, 12 + widest + 8 + 26)))
		}

		/** 会话锚点的胶囊宽度：同样按文字自适应。 */
		function anchorWidthOf(label) {
			return Math.round(Math.min(420, Math.max(96, 20 + textWidth(label) + 20)))
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
				const lines = nodeLines(node)
				const height_ = nodeHeightOf(node)
				parts.push(`<g transform="translate(${position.x} ${position.y})">`)
				parts.push(`<rect width="${width_}" height="${height_}" rx="9" ry="9" fill="#eef2f7" stroke="#c9cfda"/>`)
				lines.forEach((line, index) => {
					const y = lines.length > 1 ? (index === 0 ? 19 : 36) : 22
					parts.push(`<text x="12" y="${y}" font-size="12" fill="#111827">${escapeXml(line)}</text>`)
				})
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
			// 底栏的"清空"是两步确认，确认态存在 controller 里，这里要跟着刷新。
			const state = useSnapshot(controller)
			const [view, setView] = useState({ scale: 1, x: 0, y: 0 })
			const [hover, setHover] = useState(null)
			const [panning, setPanning] = useState(false)
			const panRef = useRef(null)
			const canvasRef = useRef(null)
			const sizeRef = useRef({ width: 800, height: 600 })

			const ranked = useMemo(() => layoutGraph(nodes, (rootSessionId) => controller.sessionTitle(rootSessionId)), [nodes, controller])

			// hover 任一节点时，把「它从哪来」的整条祖先链点亮，其余压暗。null = 没有 hover。
			const activeIds = useMemo(() => {
				if (hover === null) return null
				const byId = new Map(nodes.map((node) => [node.id, node]))
				const chain = new Set([hover])
				let cursor = byId.get(hover)
				while (cursor !== undefined) {
					const parentId = cursor.parent !== null && cursor.parent !== undefined && cursor.parent.kind === "node" ? cursor.parent.nodeId : null
					if (parentId === null || chain.has(parentId)) break
					chain.add(parentId)
					cursor = byId.get(parentId)
				}
				// 链路顶端的根提问，再往上就是它所在会话的锚点。
				for (const id of [...chain]) {
					const node = byId.get(id)
					const anchorId = `anchor:${node?.rootSessionId ?? "none"}`
					if (ranked.positions.has(anchorId)) chain.add(anchorId)
				}
				return chain
			}, [hover, nodes, ranked])

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
					"data-focus": activeIds !== null ? "" : undefined,
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
						const onChain = activeIds !== null && activeIds.has(edge.from) && activeIds.has(edge.to)
						return h("path", {
							key: `${edge.from}->${edge.to}`,
							className: "dla-edge",
							"data-active": onChain ? "" : undefined,
							markerEnd: "url(#dla-arrow)",
							style: { "--dla-edge-color": depthColor(from.depth) },
							d: `M ${fromX} ${fromY} C ${midX} ${fromY}, ${midX} ${toY}, ${toX} ${toY}`,
						})
					}),
					ranked.anchors.map((anchor) => {
						const position = ranked.positions.get(anchor.id)
						if (position === undefined) return null
						const current = controller.currentRootId() !== null && controller.currentRootId() === anchor.rootSessionId
						// 锚点 = 这串提问的源头会话：能跳就跳回去，已经在那儿就只收起网格。
						// 「未归属提问」没有可比对的会话（rootSessionId 为 null），不可点。
						const clickable = anchor.rootSessionId !== null
						return h("g", {
							key: anchor.id,
							className: "dla-anchor",
							"data-current": current ? "" : undefined,
							"data-clickable": clickable ? "" : undefined,
							"data-active": activeIds !== null && activeIds.has(anchor.id) ? "" : undefined,
							transform: `translate(${position.x} ${position.y})`,
							onClick: clickable === false ? undefined : (event) => {
								event.stopPropagation()
								if (current) controller.closeGraph()
								else controller.openInMain(anchor.rootSessionId)
							},
						},
						h("title", null, clickable === false
							? `${anchor.label}（${t("graph.anchorNoTarget")}）`
							: current ? `${anchor.label}（${t("graph.close")}）` : `${anchor.label}（${t("graph.anchorOpen")}）`),
						h("rect", { width: anchor.width, height: 34, rx: 17, ry: 17 }),
						h("text", { x: 20, y: 17 }, truncate(anchor.label, LABEL_LIMIT)))
					}),
					nodes.map((node) => {
						const position = ranked.positions.get(node.id)
						if (position === undefined) return null
						const thread = controller.threadOf(node.sessionId)
						const running = thread !== null && thread.running === true
						const width = nodeWidthOf(node)
						const lines = nodeLines(node)
						const height = nodeHeightOf(node)
						const centerY = Math.round(height / 2)
						return h("g", {
							key: node.id,
							className: "dla-node",
							"data-running": running ? "" : undefined,
							"data-active": activeIds !== null && activeIds.has(node.id) ? "" : undefined,
							transform: `translate(${position.x} ${position.y})`,
							style: { "--dla-node-color": depthColor(position.depth) },
							onPointerEnter: () => setHover(node.id),
							onPointerLeave: () => setHover((current) => (current === node.id ? null : current)),
							onClick: (event) => {
								// 点节点 = 直接切到那个会话（用户预期"跳过去"，不是弹浮卡）。
								event.stopPropagation()
								controller.openInMain(node.sessionId)
							},
						},
						h("title", null, `${nodeLabel(node)}（${t("graph.openSession")}）`),
						h("rect", { width, height, rx: 9, ry: 9 }),
						// 左侧 3px 色条标层级：锚点中性、一级蓝、二级青、三级紫。
						h("rect", { className: "dla-node-bar", x: 0, y: 7, width: 3, height: Math.max(8, height - 14), rx: 1.5, fill: depthColor(position.depth) }),
						h("text", { x: 12, y: lines.length > 1 ? 15 : centerY }, lines.map((line, index) =>
							h("tspan", { key: index, x: 12, dy: index === 0 ? 0 : 17 }, line))),
						h("g", {
							className: "dla-node-open",
							transform: `translate(${width - 16} ${centerY})`,
							onClick: (event) => {
								// 小圆点保留"就地看一眼"：不离开当前会话，开浮卡。
								event.stopPropagation()
								controller.openNode(node.id)
							},
						},
						h("title", null, t("graph.openCard")),
						h("circle", { r: 10.5 }),
						h("g", { transform: "translate(-5.5 -5.5)" }, h(Icon, { name: "message-circle", size: 11 }))))
					})))),
			// 工具栏放在**底部**：桌面版的窗口标题栏在顶部，顶栏有被遮住的风险。
			h("div", { className: "dla-graph-bar" },
				h("span", { className: "dla-graph-title" }, t("graph.title")),
				h("span", { className: "dla-graph-count" }, t("graph.count", { n: nodes.length })),
				h("span", { className: "dla-graph-spacer" }),
				h("button", { className: "dla-btn", title: t("graph.exportTip"), onClick: () => controller.exportImage(nodes, t("graph.exportName")) },
					h(Icon, { name: "download", size: 14 }), t("graph.export")),
				h("button", { className: "dla-btn", onClick: fit }, h(Icon, { name: "fit", size: 14 }), t("graph.fit")),
				h("button", {
					className: "dla-btn",
					"data-danger": state.confirmClear ? "" : undefined,
					onClick: () => (controller.state.confirmClear === true ? controller.clearGraph() : controller.markClear()),
				}, state.confirmClear === true ? t("graph.clearConfirm") : t("graph.clear")),
				h("button", { className: "dla-btn", onClick: () => controller.toggleGraph() },
					h(Icon, { name: "x", size: 14 }), t("graph.close"))))
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

		/** 入口按钮的估计宽度（含徽标），用于判断输入框左边放不放得下。 */
		const ENTRY_WIDTH = 148
		/** 入口按钮高度（与 CSS 一致）。 */
		const ENTRY_HEIGHT = 32

		/**
		 * 把入口按钮贴到输入框左边的空白处（而不是窗口右下角）。
		 *
		 * 横向取「输入框左边 - 按钮宽 - 16」；左侧边界取侧栏右缘（拿不到就用对话区左缘）再留 8px。
		 * 这段空白放不下（窗口变窄、侧栏展开、输入框变宽）就返回 null，退回右下角——绝不压到正文上。
		 * 竖向对齐输入框中线；用 `left` 定位而不是 `right`，徽标变宽也不会把按钮推进正文列。
		 */
		function measureEntryAnchor() {
			if (typeof document === "undefined" || typeof window === "undefined") return null
			const region = findConversationRegion()
			if (region === null) return null
			const candidates = [...document.querySelectorAll('[contenteditable="true"], textarea')]
				.filter((element) => element.closest(".dla-layer") === null)
				.map((element) => element.getBoundingClientRect())
				.filter((rect) => rect.width > 0 && rect.height > 0)
			if (candidates.length === 0) return null
			// 输入框在页面最下面：取最靠下的那个，免得抓到设置页或浮卡里的别的输入框。
			const editorRect = candidates.reduce((best, rect) => (rect.top > best.top ? rect : best), candidates[0])
			const sidebar = document.querySelector('[class*="_sidebarCol"]')
			const boundary = sidebar !== null
				? sidebar.getBoundingClientRect().right
				: region.getBoundingClientRect().left
			// 右边贴着输入框左边 16px（渲染时用 translateX(-100%) 反推左边缘），宽度变化不会把间距吃掉。
			const rightEdge = editorRect.left - 16
			if (rightEdge - ENTRY_WIDTH < boundary + 8) return null
			const top = Math.max(8, editorRect.top + editorRect.height / 2 - ENTRY_HEIGHT / 2)
			return { left: rightEdge, top }
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
			const currentId = useSyncExternalStore(controller.subscribeSessions, controller.currentSessionId, controller.currentSessionId)
			// 当前会话变了要跟着变：入口按钮只在"与追问相关"的会话里出现。
			const related = controller.relatedGraph(currentId)
			const entryVisible = state.graphOpen === false && related !== null
			const [entryPos, setEntryPos] = useState(() => null)
			// 入口按钮出现时量一次位置；窗口尺寸变化（含侧栏折叠、换会话后布局重排）再量一次。
			useEffect(() => {
				if (entryVisible === false) return undefined
				const measure = () => setEntryPos(measureEntryAnchor())
				const frame = requestAnimationFrame(measure)
				window.addEventListener("resize", measure)
				return () => {
					cancelAnimationFrame(frame)
					window.removeEventListener("resize", measure)
				}
			}, [entryVisible, currentId])
			useEffect(() => {
				// 切到别的会话就把浮卡/选区按钮收起来：它们属于上一个会话的上下文。
				controller.onSessionChanged(currentId)
			}, [currentId, controller])
			useEffect(() => {
				if (node !== null) controller.ensureThread(node.sessionId)
			}, [controller, node?.sessionId])
			const thread = node === null ? null : controller.threadOf(node.sessionId)
			// 线程内容更新后需要重新渲染；threadsVersion 就是为此而存在。
			void state.threadsVersion
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
				// 只在「当前会话与追问网格有直接关系」时出现；画布打开时收起（底栏自带导出与关闭）。
				entryVisible ? h("button", {
					className: "dla-entry",
					title: t("entry.title"),
					style: entryPos === null ? undefined : { left: `${entryPos.left}px`, top: `${entryPos.top}px`, right: "auto", bottom: "auto", transform: "translateX(-100%)" },
					onClick: () => controller.toggleGraph(),
				},
				h("span", { className: "dla-entry-icon" }, "⟂"),
				h("span", { className: "dla-entry-label" }, t("entry.label")),
				graphNodes.length > 0 ? h("span", { className: "dla-entry-badge" }, String(graphNodes.length)) : null) : null,
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
