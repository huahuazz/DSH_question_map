/**
 * 脚本共用的环境定位：DSH 的 profile 目录、应用目录，以及 React。
 *
 * 全部可用环境变量覆盖，未设置时按常见安装位置猜一份：
 *   DSH_PROFILE_DIR  例如 ~/.dsh/profiles/desktop
 *   DSH_APP_DIR      例如 "C:/Program Files/DSH Desktop/resources/app"
 *
 * 猜不到也不会抛错——调用方拿到的是"可能不存在"的路径，自己决定跳过还是失败，
 * 这样同一个仓库在 CI（没有 DSH）和本机都能跑。
 */

import { existsSync } from "node:fs"
import { homedir } from "node:os"
import { join } from "node:path"
import { createRequire } from "node:module"

/** DSH 的 profile 目录（默认 desktop profile）。 */
export function profileDir() {
  if (process.env.DSH_PROFILE_DIR) return process.env.DSH_PROFILE_DIR
  return join(homedir(), ".dsh", "profiles", "desktop")
}

/** 应用目录的候选位置（按平台）。 */
function appCandidates() {
  return [
    "C:/Program Files/DSH Desktop/resources/app",
    "D:/Program Files/DSH Desktop/resources/app",
    process.env.LOCALAPPDATA === undefined ? undefined : join(process.env.LOCALAPPDATA, "Programs", "DSH Desktop", "resources", "app"),
    "/Applications/DSH Desktop.app/Contents/Resources/app",
    join(homedir(), "Applications", "DSH Desktop.app", "Contents", "Resources", "app"),
  ].filter((entry) => typeof entry === "string" && entry !== "")
}

/** DSH 应用目录（含有 node_modules 的那个）；找不到就返回第一个候选。 */
export function appDir() {
  if (process.env.DSH_APP_DIR) return process.env.DSH_APP_DIR
  const found = appCandidates().find((dir) => existsSync(join(dir, "node_modules")))
  return found ?? appCandidates()[0]
}

/** 应用内 `@deepseek-ai/*` 包目录。 */
export function appModules() {
  return join(appDir(), "node_modules", "@deepseek-ai")
}

/** 这台机器上是否有可用的 DSH 安装（用于决定是否跳过依赖它的检查）。 */
export function hasDshInstall() {
  return existsSync(join(appModules(), "dsh-client-ui-renderer", "package.json"))
}

/**
 * React：优先用 DSH 自带的那份（和宿主一致），其次仓库自己装的，最后退化成最小桩。
 * 桩只提供"模块加载期会碰到"的东西（Component / createElement / hooks），
 * 足够让冒烟测试验证模块格式与控制器逻辑；真实渲染由浏览器验证。
 */
export function loadReact() {
  // 冒烟测试要像调用普通函数那样调用组件（会触碰 hooks 规则），必须用桩。
  const forceStub = process.env.DSH_TEST_STUB_REACT === "1"
  const attempts = []
  if (forceStub) return { react: makeStub(), kind: "stub", from: "DSH_TEST_STUB_REACT=1" }
  for (const base of [join(appDir(), "package.json"), import.meta.url]) {
    try {
      return { react: createRequire(base)("react"), kind: "real", from: base }
    } catch (error) {
      attempts.push(`${base}: ${error instanceof Error ? error.message : String(error)}`)
    }
  }
  return makeStub()
}

function makeStub() {
  const noop = () => {}
  class Component {
    constructor(props) {
      this.props = props
      this.state = {}
    }
    setState(next) {
      this.state = { ...this.state, ...next }
    }
    forceUpdate() {}
    render() {
      return null
    }
  }
  const createElement = (type, props, ...children) => ({ type, props: { ...(props ?? {}), children } })
  const react = {
    Component,
    PureComponent: Component,
    Fragment: "Fragment",
    createElement,
    cloneElement: (element) => element,
    isValidElement: (value) => value !== null && typeof value === "object" && "type" in value,
    createContext: (value) => ({ Provider: "Provider", Consumer: "Consumer", _currentValue: value }),
    useContext: (context) => context?._currentValue,
    useMemo: (factory) => factory(),
    useCallback: (callback) => callback,
    useRef: (initial) => ({ current: initial ?? null }),
    useState: (initial) => [typeof initial === "function" ? initial() : initial, noop],
    useEffect: noop,
    useLayoutEffect: noop,
    useInsertionEffect: noop,
    useSyncExternalStore: (_subscribe, getSnapshot) => getSnapshot(),
    memo: (component) => component,
    forwardRef: (render) => render,
    Children: { map: (children) => children, toArray: (children) => (Array.isArray(children) ? children : [children]) },
  }
  return react
}
