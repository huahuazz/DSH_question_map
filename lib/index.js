/**
 * lateral-ask — 宿主半边。
 *
 * 只做一件事：把 `lateral-ask` 设置命名空间注册进宿主设置文档，供浏览器半边
 * (`lib/client.js`) 通过 `ctx.settingsScope.bind({ namespace: 'lateral-ask' })` 读写。
 *
 * 存储形状刻意做得很浅：整个图以一段 JSON 文本存放在单个标量字段 `graph` 里，
 * 这样宿主 schema 只需要一条 `z.string()`，不会随着节点结构演进而反复改 schema，
 * 也不会因为数组/嵌套对象的宽松校验把整份文档拒掉。
 */

import { settingsNamespace } from '@deepseek-ai/dsh-settings'
import z from '@deepseek-ai/schemastery'

/** 设置命名空间（小写 kebab-case，符合 dsh-settings 的 NAMESPACE_PATTERN）。 */
const NAMESPACE = 'lateral-ask'

/** 命名空间里唯一的字段：整张横向提问图的 JSON 文本。 */
const GRAPH_FIELD = 'graph'

/** 命名空间 schema：一个空字符串默认值即可，解析失败一律按"空图"处理。 */
const LateralAskSchema = z.object({
  [GRAPH_FIELD]: z.string().default(''),
})

/**
 * 注册设置命名空间；settings 服务缺席时静默跳过（图退化为仅本次运行可用）。
 * @param ctx - 宿主 Cordis 上下文。
 */
function apply(ctx) {
  ctx.inject(['settings'], (settingsCtx) => {
    try {
      settingsCtx.settings.register(settingsNamespace(NAMESPACE), LateralAskSchema)
    } catch (error) {
      settingsCtx.logger?.warn?.(`lateral-ask: settings namespace "${NAMESPACE}" was not registered: ${String(error)}`)
    }
  })
}

export { apply, GRAPH_FIELD, NAMESPACE }
