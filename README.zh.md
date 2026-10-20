# DSH Question Map · 追问网格

[![CI](https://github.com/huahuazz/DSH_question_map/actions/workflows/ci.yml/badge.svg)](https://github.com/huahuazz/DSH_question_map/actions/workflows/ci.yml)

> 在 DSH 对话里**选中一段文字横向追问**，不再把原始问题越推越远；所有追问会自动连成一张**网状图**。

一个 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness)（`dsh`）的社区插件，适用于 **DSH Web 与 DSH Desktop**。

---
`scripts/probes/` 里是开发期用的一次性浏览器/接口探针，用于排查具体问题，不属于常规自检。


## 它解决什么问题

大模型对话是线性的：你问一个问题，拿到五条答案，其中某条里的某个词看不懂，只能接着在同一个对话框里问。
问着问着，最初的问题被推到上面去了，上下文也越来越长——而你其实只是想单独搞懂**那一个词**。

这个插件让你：**选中任意一段对话文字 → 点「追问」→ 在旁边开一个空上下文的迷你对话**只问它。
每次追问都会记录"从哪段文字问出来的"，最后连成一张可以浏览的网状图。

![追问网格](docs/images/graph.png)

## 功能

| 能力 | 说明 |
|---|---|
| **选词追问** | 选中对话里的文字，旁边出现「追问」小按钮；点开是一张贴着选区的浮卡，按住头部可拖动、拖右下角可拉大小 |
| **空上下文** | 每次追问都是一个**全新的会话**，只带"选中的词 + 前后一小段引文"，不继承主对话历史 |
| **卡内继续聊** | 浮卡里可以直接追问，还是同一个横向会话，不会打断主对话 |
| **再选词→子孙节点** | 在浮卡的答案里再选词追问，就长出子节点，越问越细 |
| **网状图** | 会话锚点 → 一级追问 → 子追问，带箭头连线；缩放、拖拽、点节点重开卡 |
| **跳回会话** | 每个节点右侧的 ↗（或双击节点）直接切回那次追问的会话 |
| **导出图片** | 图栏「导出图片」把当前网图导出成 PNG |
| **本地留存** | 图存在浏览器本地存储里，重启后还在 |

## 安装

```sh
# 尚未发布到 npm 时，直接从 GitHub 安装
dsh plugin --profile web add github:huahuazz/DSH_question_map
```

> 发布到 npm 之后可以简写成 `dsh plugin --profile web add dsh-plugin-question-map`。

DSH Desktop 用户在 **设置 → 插件** 里搜索安装，或在终端：

```sh
dsh plugin --profile desktop add github:huahuazz/DSH_question_map
```

装好后**完全退出并重启** DSH（客户端 bundle 在启动时装载）。

## 使用

1. 在任意回复里**选中一段文字**；
2. 点旁边冒出的「⟂ 追问」（或按 `Alt+Enter`），浮卡会贴着选区打开并开始回答；
3. 右下角「⟂ 追问网格」查看所有追问的网状图；
4. 图上点节点重开那张卡，点 ↗ 或双击节点回到那次追问的会话。

| 浮卡 | 网状图 |
|---|---|
| ![浮卡](docs/images/graph-nodes.png) | ![导出](docs/images/exported.png) |

## 兼容性

- 需要 **dsh >= 0.2.1-rc.2**（`package.json` 的 `engines.dsh`）。
- 只用公开的客户端扩展点：`shell.overlay` slot、`uiConversation`、`uiWorkspace`、`sessions`、`locale`、`remote.session`。
- 不依赖任何宿主内部设置 API，因此不会因为 DSH 升级换掉设置服务而加载失败。

## 数据与隐私

- 追问网格的节点/连线存在**浏览器 localStorage**（键 `dsh-question-map:graph`）。
- 每次追问会在你的会话列表里新增一个真实会话（标题以 `⟂` 开头），内容按 DSH 自己的会话存储规则落盘。
- 插件本身不向任何服务器发请求；模型调用走 DSH 自己的会话通道。

## 已知限制

- 追问会话会出现在会话列表里（这是"复用真实会话、能力与主对话一致"的代价）。
- 图按 `localStorage` 保存：同源即可跨重启；换端口或清缓存会丢（可重新生成）。
- 每个横向提问都会真实调用一次模型。

## 开发

仓库是**零构建**的：`lib/client.js` 手写成 DSH 浏览器模块格式（`window.__ModuleLoader__.load`），
没有打包步骤，改完直接放回 profile 即可。

```sh
node scripts/smoke.mjs              # 模块格式 / 注入清单 / 本地存储 / 删除与清空
node scripts/flow-test.mjs          # 建会话 → 提问 → 流式读取 → 落库 → 子节点
node scripts/verify-composition.mjs # 清单与 DSH 组合契约（没有本机 DSH 时自动跳过）
node scripts/pack-check.mjs         # npm 发布面自检（files/exports/dsh 清单）
```

脚本默认从 `~/.dsh/profiles/desktop` 和常见安装位置找 DSH；装在别处时用环境变量指定：

```sh
DSH_PROFILE_DIR="/path/to/profiles/desktop" DSH_APP_DIR="/path/to/resources/app" node scripts/verify-composition.mjs
```

推送会跑 GitHub Actions（语法 / 冒烟 / 流程 / 发布面），依赖本机 DSH 的检查在没有安装时自动跳过。

发布流程见 [`docs/PUBLISHING.md`](docs/PUBLISHING.md)。

## 许可

[MIT](LICENSE)
