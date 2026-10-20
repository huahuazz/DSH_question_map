# 更新记录

## 0.2.2

- 修正：0.2.x 的 `sessions.binding()` 只对「被保留（retain）」的会话有效，新建的横向会话取不到绑定，
  导致浮卡报 `session is not addressable` 且读不到回答。现在建完会话立即 retain，卸载时统一 release。

## 0.2.1

- 新增：本地存储为空时，从已有的 ⟂ 会话自动恢复追问网（覆盖「存储迁移 / 重装丢图」）。
- 修正：会话列表在插件启动之后才加载完成时，恢复会错过时机——现在会挂一次性订阅补恢复。
- 节点记录 workspaceId；同工作区里的历史追问会话也能看到入口按钮。

## 0.2.0

**迁移到 DSH 0.2.x（不兼容 0.1.x）。**

- 存储：宿主 `settingsScope` 服务在 0.2.x 被移除，改为浏览器 `localStorage`（键 `dsh-question-map:graph`）。
- 跳转：`sessions.open()` 已不存在，改用 `uiWorkspace.openSession()`。
- 宿主半边：不再 import `@deepseek-ai/dsh-settings`（0.2.x 删除了 `settingsNamespace` 导出，
  旧实现会在升级后连模块都导入失败），宿主半边保持空实现。
- 包名：`dsh-plugin-lateral-ask` → `dsh-plugin-question-map`；`dsh.client` 注入增加
  `@deepseek-ai/dsh-client-ui-workspace`。
- 新增 `dsh.bundle.patch` 与 `cordis.patch.yml`：`dsh plugin add` 现在会把它作为一层插件装进 profile。
- 新增 `engines.dsh`、`keywords`、`repository`/`homepage`/`bugs`、英文 README 与 `LICENSE`。
- 新增 `scripts/pack-check.mjs`（npm 发布面自检）与 `docs/PUBLISHING.md`（上架流程）。

## 0.1.0

首个可用版本：选词追问浮卡、横向会话、追问网图、节点跳转、导出 PNG。
