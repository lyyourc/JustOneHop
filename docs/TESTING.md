# 测试指南

## 按影响范围验证

UI 改动需通过 `npm run typecheck`、`npm test`、生产构建与相关 Playwright 用例，覆盖鼠标、纯键盘和交替流程。`npm run build` 可单独构建；下述 E2E 入口已包含同一构建，无需紧接着重复构建。日常选择受影响视图及共享组件的调用方；全量端到端仅用于用户明确要求或启动、权限、会话等全局路径的广泛改动。当前脚本定义以 [package.json](../package.json) 为准。

先在 `tests/*.spec.ts` 找对应场景，再用 `--list` 确认筛选结果。例如底栏／跨层布局改动：

```sh
npm run test:e2e -- tests/palette.spec.ts --grep 'storage and Tab Group layers preserve main palette geometry' --list
npm run test:e2e -- tests/palette.spec.ts --grep 'storage and Tab Group layers preserve main palette geometry'
```

这只演示选择方式；涉及交互时还需选中相应的确认、返回、焦点和鼠键流程。脚本、配置和测试标题可直接查阅，不在本文维护完整用例目录或数量。

## 构建与产物隔离

`npm run test:e2e -- <Playwright 参数>` 通过 [runner](../scripts/run-e2e.ts) 先构建再启动 Playwright，`--list` / `--help` 也会构建。文件名、`--grep` 等筛选参数传入 Playwright；`--config` / `-c`、`--reporter` 和 `--output` 由仓库管理，不接受覆盖。`--last-failed` 必须同时提供 `--last-failed-file <之前产物中的 .last-run.json>`；runner 校验该文件后复制到本轮目录再使用，避免新目录找不到历史记录而意外运行全套，也保留上轮原始记录。

同一仓库的 `test-results/.e2e.lock` 覆盖构建至测试结束；已有 runner 时立即报错，不并发改写共享 `dist/`。独立 `npm run build`、dev watch 或直接 Playwright 不受该锁控制，执行验证前应结束这些会改写产物的进程。runner 会比较测试前后 `dist/` 哈希及 Git HEAD／工作区状态哈希（含未跟踪文件）；构建产物或源码状态变化都会使本轮验证失败，运行期间也应暂停文档编辑。异常退出残留锁时，先核实锁中 PID 及其 E2E／Chrome 子进程已结束，再按报错提示移除锁。

每次执行生成 `test-results/runs/<时间>-<PID>-<随机值>/`：`validation.json` 关联命令、Git 状态／哈希、构建结果、dist 哈希、测试选择及执行结果；每次测试尝试保留环境和浏览器版本注解。截图与 trace 通过 `testInfo.outputPath()` 放入该 run 的 `artifacts/`。`--list` 仅记录选择，不代表执行通过；前置失败阻断的用例计入 `notRun`，与主动 `skip` 区分。Git 快照不可用时 runner 失败，不能声称源码状态已核实。直接调用 Playwright 仍有独立产物目录，但会标记构建新鲜度未经验证，也不取得 runner 的锁。

## 浏览器与夹具边界

测试使用临时 Chrome profile 和本地页面，与日常浏览器资料隔离。`ZING_CHROMIUM_PATH` 可指定 Chrome for Testing；默认选择逻辑见 [palette.spec.ts](../tests/palette.spec.ts)，调度配置见 [playwright.config.ts](../playwright.config.ts)。原生窗口与焦点用例通过场景选项启动有界面浏览器，避免默认 viewport 覆盖真实窗口尺寸。此类用例仍受系统前台焦点影响；失败时保存 `native-window-lifecycle.json`（窗口创建／导航／关闭及当前窗口、会话状态），结合 trace 判断，不能仅凭重跑成功认定竞态已解决。

`palette.spec.ts` 在 `test.describe` 作用域内通过 `test.use({ environment: ... })` 显式声明 locale、shadow、pageAccess、cookieDomains、commands、headed、verticalTabs 和 vimium 等环境选项，默认保持闭合 Shadow DOM；测试标题仅用于说明和筛选。`tabTuck.spec.ts` 的启动存储失败也通过显式选项选择。开放 Shadow DOM、临时网站权限与后台命令钩子只写入测试扩展副本。结构测试和生产闭合 Shadow DOM / iframe 的键盘测试提供不同证据，修改相关路径时按需覆盖两者。

Vimium 兼容场景需指定 `ZING_VIMIUM_PATH`，指向已解包的 Vimium 扩展；场景会核实其 service worker 已加载。未提供路径时该场景跳过，不计为兼容性通过；开放 Shadow DOM 的视觉夹具不承担 Vimium 兼容验收。

## 证据与未解决项

[验收记录](ACCEPTANCE.md) 保存实际执行范围、结果及限制；它不是当前全套测试通过的声明。报告跳过、失败、重跑与未验证范围，并区分隔离浏览器结果和日常 Chrome 重载。截图与 trace 留在忽略的测试产物目录或系统临时目录，不作为长期文档附件。

屏幕定位目标仍暂停、未解决，详见 [ADR 0010](adr/0010-content-anchor-panel-geometry.md#待实现目标)。相关定位用例或历史内容区几何记录，不能证明该目标已经完成。验证设计中的独立证据判断见 [评审标准](CODING_STANDARDS.md)。
