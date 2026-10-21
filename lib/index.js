/**
 * dsh-question-map — 宿主半边。
 *
 * 这个插件完全跑在浏览器侧：追问网格的数据存在浏览器 localStorage 里，
 * 渲染全部走客户端的 slot 浮层，因此宿主半边**故意保持空实现**。
 *
 * 这么做是有原因的：DSH 0.2.x 换掉了客户端设置存储服务
 * （`settingsScope` → `configForms` / `settingsSchema`），
 * 依赖宿主设置文档的旧实现会在升级后连 import 都失败
 * （`@deepseek-ai/dsh-settings` 不再导出 `settingsNamespace`）。
 * 不 import 任何 `@deepseek-ai/*` 包，插件就不会被宿主内部 API 的变动带崩。
 *
 * 说明：`dsh.bundle.patch` 会把本插件插入插件树，宿主半边只需能被 import 成功。
 */

/** 插件短名（与 cordis.patch.yml 里的 name 一致）。 */
const NAME = 'dsh-question-map'

/**
 * 宿主侧不做任何事；保留 `apply` 以符合 Cordis 插件契约。
 */
function apply() {
  // 有意为空：所有界面与数据都在客户端。
}

export { apply, NAME }
