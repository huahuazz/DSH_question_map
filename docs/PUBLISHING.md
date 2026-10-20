# 发布与上架

本文记录「改完之后怎么发出去」，以及社区市场的收录要求（依据本机 `dshmarket` 的 README 与
[awesome-dsh-plugin](https://github.com/awesome-dsh-plugin/awesome-dsh-plugin) 列表）。

## 0. 发布前自检

```sh
node scripts/smoke.mjs              # 模块格式 / inject / localStorage / 会话跳转
node scripts/flow-test.mjs          # 建会话 → 提问 → 读取 → 落库 → 子节点
node scripts/verify-composition.mjs # 清单与 DSH 组合契约（读本机 DSH 安装）
node scripts/pack-check.mjs         # npm 发布面（files/exports/dsh/engines）
```

四条都通过再发布。

## 1. 版本号

`package.json` 的 `version` 用语义化版本。改 DSH 兼容线（例如从 0.2.x 到 0.3.x）时至少升 minor。

## 2. 推到 GitHub

```sh
git add -A
git commit -m "feat: ..."
git push origin main
```

仓库：<https://github.com/huahuazz/DSH_question_map>

## 3. （可选）发布到 npm

社区市场优先安装 **npm 上的包**（按版本秒装）；只发 GitHub 也能装，走仓库 tarball。

```sh
npm login
npm pack --dry-run   # 先看清单，应该只包含 lib/ cordis.patch.yml README* LICENSE docs/
npm publish --access public
```

包名 `dsh-plugin-question-map`。发布前确认 `private` 不是 `true`（本仓库没有设置它）。

## 4. 提交到社区精选列表（上架）

市场里的插件来自 **[awesome-dsh-plugin](https://github.com/awesome-dsh-plugin/awesome-dsh-plugin)**——
不是往 dsh-market 仓库提。流程：

1. Fork `awesome-dsh-plugin/awesome-dsh-plugin`；
2. 在 `README.md`（以及 `README.zh.md`）对应的分类下加一行，格式与相邻条目一致：

   ```md
   - [huahuazz/DSH_question_map](https://github.com/huahuazz/DSH_question_map) - Select text in a conversation to ask a context-free side question; all questions form a browsable network graph.
   ```

3. 提 PR。站点与市场每天同步一次，通常一天内生效。

收录条件（列表维护者的原话）：能用 `dsh plugin add` 装上、行为与一句话描述一致、放在正确分类、持续维护。
本仓库满足前三条的前提是：

- `package.json` 声明了 `dsh.bundle.patch`（`cordis.patch.yml`），所以 `dsh plugin add dsh-plugin-question-map` 会把它作为一层插件装进 profile；
- 声明了 `dsh.client.platform = "web"` 与 `exports["./client"]`，所以浏览器侧 bundle 能被 `/plugins` 提供；
- `engines.dsh` 声明了最低版本，市场的"按宿主发现"能据此判断兼容性。

## 5. 发版检查清单

- [ ] `engines.dsh` 与目标 DSH 线一致
- [ ] `lib/client.js` 里 `__ModuleLoader__.load({ id })` 的 id **等于包名**
- [ ] `dsh.client.inject` 里的插件 id 都能在本机 DSH 安装里找到
- [ ] README 顶部有截图（GitHub 图床，相对路径 `docs/images/...` 也可以）
- [ ] `cordis.patch.yml` 的 `name:` 等于包名
