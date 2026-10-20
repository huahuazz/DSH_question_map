# 横向提问（lateral-ask）设计

- 日期：2026-10-19
- 状态：已与用户逐节确认，待实现
- 形态：DSH Web GUI 客户端插件（+ 约 20 行宿主半边）
- 代码位置：`<工作区>\lateral-ask\`

## 1. 背景与目标

当前大模型对话是线性的：一个问题得到一个答案，答案里某个名词看不懂时，只能把追问接在同一个对话框里，
原始问题被越推越远，上下文也越来越长，而用户真正想问的往往只是独立的一个名词。

本插件让用户**选中任意一段对话文字，横向开一个独立的、空上下文的迷你对话**去问它，并把"谁从哪里问出来的"
记录成一张可以可视化浏览的网状图。

**目标**

1. 选中对话区域的文字 → 出现一个小按钮 → 点开一张浮卡 → 得到流式回答。
2. 横向提问**不继承主对话上下文**，只带"被选中的文字 + 它前后的一小段引文"。
3. 卡内可以继续追问（同一个横向线程），也可以在**答案里再选词追问**，形成子节点。
4. 每个主会话有一张自己的网状图：节点 = 一次横向提问，边 = 从哪段文字问出来的。
5. 图跨重启保留。

**非目标（v1 明确不做）**

- 全局总览图（跨会话汇总）
- 可自由拖动缩放的独立窗口、多张卡并排
- 节点手动拖拽重排、导出/分享、节点搜索、跨设备同步
- 自定义主题配色（跟随 DSH 主题 token）
- 让模型调用"画图"之类的工具能力

## 2. 术语

| 词 | 含义 |
|---|---|
| 主会话 | 左侧列表里点开、正在看的对话 |
| 横向会话 | 选词追问时后台新建的、空上下文的真实 DSH 会话 |
| 节点 | 一次横向提问的完整线程（首问 + 卡内后续追问） |
| 边 | "这个节点是从哪段文字问出来的"，指向父节点或主会话中的某条消息 |
| 锚点 | 用户选中的那段文字（原文存下来，用于图中标签与卡片标题） |
| 归属会话 | 节点属于哪张图，等于发起提问时所在的主会话 id |

## 3. 插件形态与安装

### 3.1 包结构

```
lateral-ask/
  package.json
  lib/index.js      # 宿主半边
  lib/client.js     # 浏览器半边（DSH 模块格式，手写，无构建步骤）
  docs/superpowers/specs/2026-10-19-lateral-ask-design.md
```

`package.json` 关键字段：

```json
{
  "name": "dsh-plugin-lateral-ask",
  "type": "module",
  "main": "lib/index.js",
  "exports": {
    ".": { "default": "./lib/index.js" },
    "./client": { "default": "./lib/client.js" },
    "./package.json": "./package.json"
  },
  "dsh": {
    "client": {
      "platform": "web",
      "inject": [
        "@deepseek-ai/dsh-api-remotes",
        "@deepseek-ai/dsh-api-session-controller",
        "@deepseek-ai/dsh-client-connection",
        "@deepseek-ai/dsh-client-locale",
        "@deepseek-ai/dsh-client-ui-conversation",
        "@deepseek-ai/dsh-client-ui-layout",
        "@deepseek-ai/dsh-client-ui-renderer",
        "@deepseek-ai/dsh-client-ui-session",
        "@deepseek-ai/dsh-client-ui-settings"
      ]
    }
  }
}
```

### 3.2 浏览器半边格式

DSH 的客户端插件是预构建的浏览器 bundle，形如：

```js
window.__ModuleLoader__.load({
  id: "dsh-plugin-lateral-ask",
  factory: (require) => {
    // 只能 require 平台静态表里的 8 个模块
    // react / react/jsx-runtime / react-dom / react-dom/client /
    // @deepseek-ai/cordis / @deepseek-ai/dsh-client-store /
    // @deepseek-ai/dsh-client-ui-slots / @deepseek-ai/dsh-client-ui-primitives
    return { inject, apply }
  }
})
```

因此：不引第三方库（图为手写 SVG），组件用 `React.createElement`（`h()`）而非 JSX，
样式在 `apply` 里自注入一个 `<style data-plugin="dsh-plugin-lateral-ask">` 标签。

### 3.3 安装步骤

> 实现时核实出的关键事实：profile 的 `cordis.yml` **每次启动都会被宿主重写成空根**
> （源码注释写着 "Edit cordis.patch.yml, not this file"），真正的用户层是
> **`cordis.patch.yml`**，而且它被 `watchUserPatches` 实时监听（`patchReload: live`），
> 所以改它不需要重启应用，只需要刷新页面。

1. 把 `lateral-ask/` 的 `package.json` 与 `lib/` 复制到
   `C:\Users\Admin\.dsh\profiles\desktop\node_modules\dsh-plugin-lateral-ask\`。
2. 在 `C:\Users\Admin\.dsh\profiles\desktop\cordis.patch.yml` 里追加：

   ```yaml
   - insert:
       - id: lateral-ask
         name: dsh-plugin-lateral-ask
   ```

3. 等宿主实时装载（无需重启），然后在浏览器里刷新页面，客户端启动图才会带上本插件的 bundle。

> 第 1~2 步写在工作区之外的目录，需要一次授权。`scripts/install.ps1` 是同样的步骤，
> 便于以后重新部署；注意本机 PowerShell 执行策略禁止直接跑 `.ps1`，要用
> `powershell -ExecutionPolicy Bypass -File scripts\install.ps1` 或直接内联执行等价命令。

### 3.4 离线验证手段（没有浏览器也能跑）

| 脚本 | 验证什么 |
|---|---|
| `node scripts/smoke.mjs` | 客户端 bundle 的模块格式、`shell.overlay` 注册、locale 键集一致、调试句柄、根组件能渲染、卸载幂等 |
| `node scripts/host-smoke.mjs` | 宿主半边能从**已安装位置**解析依赖、schema 默认值、图 JSON 文本往返、类型拒绝 |
| `node scripts/verify-composition.mjs` | 按客户端模块系统的**真实规则**核对组合链：包名=loader 行名、`dsh.client.platform=web`、`exports["./client"]` 可解析、bundle 内 `id` 等于包名、`require` 不越出平台共享表、注入依赖全是 web 插件、**每个 `inject` 服务都真有提供方**、补丁层已登记 |
| `node scripts/flow-test.mjs` | 控制器整条异步链路（建会话→继承模型→首问模板→显式 open 事件窗口→chat 快照投影→防抖落库→子节点→create 失败不留脏数据） |

另有一条来自宿主自己的证据：

```powershell
node C:\Users\Admin\.dsh\profiles\node_modules\@deepseek-ai\dsh\lib\bin.js --profile desktop --dump-config
```

输出里出现

```
# == C:\Users\Admin\.dsh\profiles\desktop\cordis.patch.yml
- id: lateral-ask
  name: dsh-plugin-lateral-ask
```

即证明插件条目真的被组合进插件树（不是只写进了文件）。

> **改代码后的生效条件**：客户端 bundle 的字节是在宿主组合时快照进内存的（`dsh-client-modules` 只在
> HMR 报告重建时才换图），所以改完 `lib/client.js` 必须**整应用重启一次**；只刷新页面会拿到旧字节。

### 3.5 已取得的运行时证据（不是推断）

用一个**一次性验证实例**证明了两件 spec 要求的事——独立 `DSH_HOME`（`%TEMP%\dsh-verify-home`，
profile 用 junction 指回真实目录）+ 独立端口，验完即销毁，不碰正在使用的桌面实例：

| 结论 | 证据 |
|---|---|
| 插件被加载（进插件树） | `dsh --profile desktop --dump-config` 输出里出现 `# == …\cordis.patch.yml` 下的 `- id: lateral-ask / name: dsh-plugin-lateral-ask` |
| 插件被加载（进浏览器启动图） | 实例首页 `__DSH_BOOT__` 的 plugin 名单里出现 `dsh-plugin-lateral-ask/client.js` |
| bundle 被 `/plugins` 提供 | 取该 combo URL 返回 200 / 4,308,239 字节，内容含 `dsh-plugin-lateral-ask`、`dla-entry`、`追问网`、`shell.overlay`、`settingsScope` |
| 服务的是**当前**构建而不是旧快照 | 返回体里同时含本轮才加进去的 `retryCreate`、`card.diag`、`pendingFailed`、`assistant-message`、`pointer-events:auto!important` |

仍未覆盖的只有**交互层**：选中→按钮→浮卡→流式答案→看图这 5 步需要真实浏览器画面，见第 10 节。

### 3.6 用无头浏览器 + 一次性实例跑出来的实测结论（已写回实现）

用 `msedge --headless` + CDP 驱动一个一次性实例（独立 `DSH_HOME`、独立端口、验完销毁）后，
拿到四条改变实现的结论：

| 实测发现 | 对实现的影响 |
|---|---|
| chat 视图节点外壳是 `{ key, kind, id, target, anchorSeq, location, visibility, **data** }`，**文本载荷在 `data` 里**（用户消息 `data.content`、助手 `data.blocks`、失败轮次 `kind:'turn-error'`） | 读答案必须走 `node.data`；早期版本读节点本身，导致"卡片永远空白" |
| 会话被创建/发问后，`uiConversation.binding(id).target('chat')` 的**订阅不会为后台（非当前）会话推送变更**，但直接 `getSnapshot()` 能读到 7 个节点 | 卡片必须自带轮询兜底（`watchThread`，1.2s 读一次内存快照，文本连续 3 次不变且不在运行才停，最长 3 分钟） |
| 宿主 `session.create` 只有传 **`workspaceId`** 才会 `workspace.attachSession()`；只传 `cwd` 的会话不会挂进工作区 | 新建横向会话优先取「当前会话所属工作区」的 `workspaceId`，拿不到才退回 `cwd` |
| 失败轮次会以 `kind: 'turn-error'` 节点出现，`data` 里带宿主原文（例如 `llm-deepseek: no API key for provider route "deepseek-official"`） | 卡片把错误原文直接显示出来，而不是笼统的"出错了" |

实测中还确认：浮层容器、入口按钮（文案 `⟂追问网`）、插件样式表、`[class*="_centerCol"]` 对话区判定
都在真实渲染进程里成立；网状图的节点矩形与持久化（`settings.yaml` 里的 `lateral-ask.graph`）也在重启后保留。

## 4. 架构

### 4.1 客户端半边：5 个互不耦合的单元

| 单元 | 职责 | 依赖 |
|---|---|---|
| `selection-watcher` | 监听 `selectionchange` / `mouseup` / `scroll`，判断选区是否落在对话区域，算出屏幕矩形与来源定位，输出 `Anchor` 或 `null` | 纯 DOM |
| `ask-button` | 选区旁的小气泡按钮；点击发出 `open(anchor)` 意图 | `Anchor` |
| `ask-card` | 锚定浮卡：术语 + 来源 + 迷你线程 + 追问输入框 + 「在主页打开/固定/关闭」 | `thread-store`、`graph-store` |
| `graph-view` | 画布浮层：SVG 分层布局、缩放、平移、点节点重开卡 | `graph-store` |
| `graph-store` | 节点/边模型 + 持久化适配 + 线程对话数据（每个横向会话的消息列表与运行状态） | `settingsScope`、`sessions`、`uiConversation` |

外部只有一条数据流：`selection-watcher → ask-button → ask-card → (graph-store) → graph-view`。
每个单元只通过普通函数/订阅交互，互不直接引用对方的组件。

### 4.2 宿主半边

`lib/index.js` 只做一件事：把持久化命名空间注册进宿主设置文档。

```js
function apply(ctx) {
  ctx.inject(['settings'], (s) => {
    s.settings.register(settingsNamespace('lateral-ask'), Schema)
  })
}
```

### 4.3 依赖的 DSH 服务

| 服务 | 用途 |
|---|---|
| `ctx.sessions` | `create()` 建横向会话、`binding(id).session.prompt()` 发问、`list` 读当前会话与 cwd |
| `ctx.remote.session.selectModel` | 继承主会话的模型 |
| `ctx.uiConversation.binding(sessionId)` | 订阅横向会话的对话快照（读回答文本） |
| `ctx.slots` | 注册进 `shell.overlay`（root 作用域的 list 槽位，浮层不阻塞布局） |
| `ctx.locale` | 中英文案（命名空间 `lateralAsk`） |
| `ctx.settingsScope` | 图的持久化读写 |
| `ctx.sessions.open(id)` | 「在主页打开」时把主视图切到该横向会话 |
| `sessions.binding(id).session.projections.faceOf('modelSelection')` | 读主会话当前模型（`next ?? lastUsed`）用于继承 |

## 5. 数据模型

### 5.1 图（持久化）

```js
// settings 命名空间 "lateral-ask" 的文档
{
  version: 1,
  nodes: [Node]     // 扁平数组，用 rootSessionId 分组出多张图
}

Node = {
  id: string,                  // 节点 id（uuid）
  sessionId: string,           // 对应的横向会话 id
  rootSessionId: string|null,  // 归属会话；null = 未归属（无当前会话时提问）
  term: string,                // 选中的原文（可能很长，图上截断显示）
  quote: string,               // 选中处前后各约 200 字的引文（提问时用，也便于回溯原意）
  question: string,            // 首问原文
  parent: null
        | { kind: 'session', sessionId: string, messageSeq: number }
        | { kind: 'node', nodeId: string },
  createdAt: number,
  updatedAt: number
}
```

**回答正文不入库**：答案持久化在那个横向会话里，节点只存指针 + 术语 + 问题，避免两份真相。
每个节点几百字节，`settings.yaml` 不会被撑大。

### 5.2 运行时（不持久化）

- `threads: Map<sessionId, { messages: Msg[], running: boolean, error?: string }>`
  从 `uiConversation` 快照投影而来，`Msg = { role: 'user'|'assistant', text: string }`。
- `anchors`、`openCard`、`graphOpen`、`scale`、`offset` 等纯 UI 状态，活在各自的组件里。

## 6. 关键流程

### 6.1 首问

```
选中 → selection-watcher 判定范围与矩形
     → ask-button 出现在选区右下
     → 点击 → ask-card 打开（先显示"正在准备…"，卡片定位在选区旁）
     → graph-store.createNode(anchor):
          cwd   = 当前主会话的 cwd（无则不带）
          id    = await sessions.create({ cwd })
          title = `⟂ ${term 截断 24 字}`（随后 session.rename(title)）
          继承模型：selection = 当前主会话 modelSelection 投影的 next ?? lastUsed
                   → remote.session.selectModel({ sessionId: id, ...selection })
          await sessions.binding(id).session.prompt([{ type: 'text', text: 提问模板 }], 'queue')
     → 订阅 uiConversation.binding(id).target('chat') 快照 → 流式渲染答案
     → `sessions.create` 一成功就把节点写进图；发问失败只更新卡片状态，不删节点
```

**提问模板**（一次性引文，不继承上下文）：

```
我读到这句话：「{quote}」，其中「{term}」这个词我不理解。

请只解释「{term}」：它在这里是什么意思、为什么这里用这个词。不要复述原文，也不要展开无关背景。
```

### 6.2 卡内追问

同一个横向会话再 `prompt`，`mode: 'queue'`。**不新建节点**，卡片内消息列表增长。

### 6.3 卡内再次选词 → 子节点

在卡片的答案区域选词，走同一条首问链路，只是 `parent = { kind: 'node', nodeId: 当前节点 }`，
`rootSessionId` 继承当前节点的归属会话（保持同一张图）。这是"网状"的来源，不需要额外机制。

### 6.4 看图

右上角入口按钮（带节点数徽标）→ 全屏半透明遮罩 + 画布：

- 分层布局：根列（主会话自身）→ 一级节点 → 二级节点……，每层水平间隔 220px，同层垂直间隔 96px。
- 节点：半径 26 的圆 + 右侧标签（term 截断 12 字），有未读/正在运行的节点加高亮描边。
- 边：从父到子的三次贝塞尔曲线 + 箭头。
- 交互：滚轮缩放（0.4~2.0）、空白处拖拽平移、点节点重开其卡、「适应画布」按钮。
- 初始自动 fit 到全部节点。

## 7. 异常与降级

| 情况 | 行为 |
|---|---|
| 无当前会话时选词 | 允许。横向会话不带 cwd，卡片顶部提示「无工作目录，回答可能没有工具能力」；`rootSessionId = null`，图上归到「未归属」 |
| 会话列表未就绪 | 不出现小按钮 |
| `sessions.create` 失败 | 卡片保留并显示错误原文 + 「重试」；**不写节点**，不留脏数据 |
| 发问失败（网络/额度/模型错误） | 卡片内显示宿主错误原文，节点保留（会话真实存在），可「重试」 |
| 回答流中断 | 卡片显示「连接中断」，已收到文本不清空；重开卡从宿主历史重放 |
| 图写入被拒（revision 冲突） | 重读 → 按 id 合并（`updatedAt` 大者胜）→ 重写一次；仍失败则只在内存生效并提示「本次未保存」 |
| 读不到回答文本（内部结构变化） | 卡片显示「回答进行中／请在主页查看」+ 「在主页打开」；图的全部功能不受影响 |
| 插件被热重载 | 浮卡与画布直接消失、不抛错；图从设置文档重建 |
| 选区跨越多个消息 / 超长 | 允许；`term` 保留全文用于提问，图上与卡标题截断显示；引文上限 2000 字 |

通用原则：**图是骨架，UI 永远不崩**。任何读不到内容的情况都退化成「打开主页看」，而不是报错。

## 8. UI 规格

**小按钮**：出现在选区右下 8px，圆形 28px，图标 + tooltip「追问这段」。选区清空、点击别处、Esc、滚动时消失。

**兜底快捷键**：`Alt+Enter`。当对话区判定失败（小按钮没出现）时，选中文字后按 `Alt+Enter` 直接追问同一选区；
实现上它复用完全相同的 `captureSelection()` + `ask()` 链路，只是省掉"点按钮"这一步。它不会在输入框/可编辑区里触发。

**浮卡**：

- 默认 380px 宽，高度自适应，最高 `min(70vh, 560px)`，内容滚动。
- 定位：选区右侧（空间不足则左侧），垂直方向夹在视口内；一旦用户拖动过就记住位置。
- 头部：`⟂ 术语` + 来源（「来自本次对话 · 第 N 轮」/「来自节点 X」）+ 「在主页打开 / 固定 / 关闭」。
- 中部：迷你线程（用户问题右对齐、助手回答左对齐），助手回答用 `MarkdownText` 渲染，运行中显示光标动效。
- 底部：输入框（Enter 发送，Shift+Enter 换行）+ 发送/停止按钮。
- 关闭规则：Esc、点卡片外、点「关闭」；固定后不随点外部关闭。
- 卡内同样接入 `selection-watcher`，所以能再选词开子节点。

**画布浮层**：见 6.4；右上角入口按钮常驻在 `shell.overlay` 内（`pointer-events: auto`），其余位置不拦截点击。

## 9. 持久化细节

- 命名空间 `lateral-ask`，宿主 schema 用 schemastery `z.object({ version: z.number().default(1), nodes: z.array(NodeSchema).default([]) })`。
- 客户端 `ctx.settingsScope.bind({ namespace: 'lateral-ask' })`，读快照、`mutate` 写入。
- 写入时机：节点新增/更新时防抖 300ms 全量提交 `nodes`；同一 tick 内多次变更合并为一次。
- 冲突处理见第 7 节。

## 10. 测试与验收

无自动化测试基建（第三方插件没有 DSH 仓库的测试装置），采用**手动验收清单 + 调试句柄**：

插件在 `apply` 里挂一个只读调试句柄 `window.__lateralAsk = { state(), nodes(), openGraph(), clear() }`，便于在控制台断言状态。

验收清单（交付时逐条自查）：

1. 选中助手回复里的名词 → 右侧冒出小按钮；点开 → 卡片贴着选区出现。（若不出现，选中后按 `Alt+Enter` 应能直接追问——这是对话区判定失败时的兜底入口。）
2. 卡片逐字出答案，Markdown（列表/代码/加粗）正常渲染。
3. 卡内追问一句 → 同一横向会话继续答，卡片不跳。
4. 在卡片答案里再选词追问 → 出现子节点；打开图能看到父→子连线。
5. 图：滚轮缩放、拖拽平移、点节点重开卡、关掉浮卡后图仍在。
6. 点「在主页打开」→ 主界面切到该横向会话，是完整原生对话。
7. 关掉整个应用再打开 → 图还在，节点都在，点开仍能看到原来的答案。
8. 在侧边栏/设置页选词 → **不**冒按钮。
9. 拖选、复制大段文字 → 不冒按钮、不卡顿。
10. 控制台无反复报错（尤其高频 `selectionchange`）。

## 11. 风险与已知取舍

- **会话列表会变长**：每个横向提问是一个真实会话，标题带 `⟂` 前缀便于识别。这是"复用真实会话"方案的直接代价，不是缺陷。
- **依赖非公开接口**：`uiConversation.binding(id).target('chat')`、`settingsScope` 不是面向第三方的稳定约定，DSH 升级可能破；已按第 7 节降级。
- **手写 bundle 与 8 个共享模块强绑定**：不能引第三方库，所以图为手写 SVG。
- **安装需动工作区外目录**：见 3.3，需要一次授权或手动执行。
- **回答文本读取依赖 chat 目标的节点结构**：节点 kind 若变化，走第 7 节降级路径，不影响图。

## 12. v2 候选

全局总览图、节点拖拽重排、卡内多标签并行、导出为 Markdown/JSON、图内搜索、
横向会话在侧边栏折叠成一组、把横向提问结果"吸收"为主对话的一条引用。
