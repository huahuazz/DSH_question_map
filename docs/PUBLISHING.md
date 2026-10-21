# 发布与上架

依据：
- [awesome-dsh-plugin/contributing.md](https://github.com/awesome-dsh-plugin/awesome-dsh-plugin/blob/main/contributing.md)（收录要求，2026-10 版本）
- 本机 `dshmarket` 插件的 README（市场里的插件源就是这份精选列表）

## 0. 发布前自检

```sh
node scripts/smoke.mjs              # 模块格式 / inject / localStorage / 会话跳转
node scripts/flow-test.mjs          # 建会话 → 提问 → 读取 → 落库 → 子节点
node scripts/verify-composition.mjs # 清单与 DSH 组合契约（读本机 DSH 安装）
node scripts/pack-check.mjs         # npm 发布面（files/exports/dsh/engines）
```

四条都通过再发布。

## 1. 版本号

`package.json` 的 `version` 用语义化版本；改 DSH 兼容线（例如 0.2.x → 0.3.x）时至少升 minor。

## 2. 推到 GitHub

```sh
git add -A && git commit -m "..." && git push origin main
```

仓库：<https://github.com/huahuazz/DSH_question_map>

## 3. 上架：往 awesome-dsh-plugin 提一个 PR

市场（dshmarket）**不是**从 DeepSeek 官方仓库拉的，而是读
[awesome-dsh-plugin](https://github.com/awesome-dsh-plugin/awesome-dsh-plugin) 这份精选列表。
提交方式不是改 README，而是**新增一个 YAML 文件**：

`data/plugins/huahuazz__DSH_question_map.yml`

```yaml
url: https://github.com/huahuazz/DSH_question_map
name: huahuazz/DSH_question_map
category: ui
description:
  en: 'Select text in a conversation to ask a context-free side question in a floating card, and browse every question as a network graph.'
  zh: '在对话里选中文字横向追问（空上下文的浮卡），所有追问连成一张可浏览的网状图，支持导出 PNG。'
```

> 描述里出现 `: `（半角冒号+空格）必须加引号，所以上面用单引号包起来。
> `category` 可选值：`agi` `ui` `usage` `theme` `model` `identity` `session` `memory`
> `tools` `wsl` `browser` `vision` `voice` `docs` `skill` `workflow` `git` `notify`
> `dev` `security` `remote` `market` `fun`。本插件是 Web 交互增强，取 `ui`。

### 提交前必须满足（CI 会逐条查）

| 要求 | 我们 |
|---|---|
| `package.json` 声明 `dsh.bundle`（只声明 `dsh.client` 会被拒） | ✅ `./cordis.patch.yml` |
| 仓库根有 `cordis.patch.yml`，内含 `insert` 本包 | ✅ |
| 真实可用的代码，不是占位/纯 README | ✅ |
| **仓库创建满 1 天**（CI 自动查） | ⚠️ 见下方"时间门槛" |
| 仓库添加 `dsh-plugin` topic | ⚠️ 需在 GitHub 网页上点一下 |
| 描述属实、无营销词 | ✅ |

### 时间门槛

CI 会查仓库创建时间，**不满 1 天直接拒**（目的是过滤"提 PR 前几分钟才建好"的仓库）。
如果仓库是刚建的，把功能做完、过一天再提；重新提交不会有任何影响。

### 截图（可选，已做）

市场详情页的 App Store 式截图来自**本仓库自己的** `screenshots.json`：

```json
["docs/images/graph.png", "docs/images/graph-nodes.png", "docs/images/exported.png"]
```

改截图只要推自己的仓库，下一次构建自动生效，不用再来提 PR。

## 4. 发布到 npm（**已决定暂缓，不是必做项**）

**现状：不上 npm。** 收录与安装都不依赖它：

- 列表照样收录（市场条目只要求 `dsh.bundle` + 仓库可用）；
- 安装走 GitHub 源码：`dsh plugin add github:huahuazz/DSH_question_map`；
- 代价：市场不显示下载量；安装时多一步源码构建（本仓库零构建，影响很小）。

以后想做时，注意下面几点：

```sh
# 本机默认 registry 是国内镜像（只读），登录/发布都必须显式指官方源
npm login --registry=https://registry.npmjs.org/
npm publish --registry=https://registry.npmjs.org/ --access public
```

- 包名 `dsh-question-map`（官方源上尚未被占用，2026-10 复核）；`question-map` 已被别人占用，所以 `dsh-` 前缀不能省。
- 打包预演约 224 KB / 15 个文件（`lib/`、`cordis.patch.yml`、README、截图、docs），不含 `scripts/`。
- 发布后 `repository` 字段必须指回本仓库，否则市场不会把 npm 包与条目关联（我们已指向）。
- 开了 auth-and-writes 级 2FA 时，`npm publish` 会要求一次 6 位验证码。

## 5. 发版检查清单

- [ ] `engines.dsh` 与目标 DSH 线一致
- [ ] `lib/client.js` 里 `__ModuleLoader__.load({ id })` 的 id **等于包名**
- [ ] `dsh.client.inject` 里的插件 id 都能在本机 DSH 安装里找到
- [ ] `cordis.patch.yml` 的 `name:` 等于包名
- [ ] `node scripts/ci.mjs` 全绿（本地等价 CI）
- [ ] 仓库已有 `dsh-plugin` topic、创建满 1 天
