# 测试指南

## 按影响范围验证

先按实际改动选择最小充分验证，执行前完成共享样式／组件调用方检查，避免测试后才发现影响范围而追加构建。

| 改动 | 默认验证范围 |
| --- | --- |
| 纯文档 | 链接、内容与 diff 检查 |
| UI 布局、分组、静态文案，未改状态／业务逻辑 | 类型检查 + 1–2 个相关 Playwright 用例；合计覆盖鼠标、纯键盘、交替流程及适用的窄屏。语言包改动补 `tests/i18n.test.ts`，不默认运行完整单测 |
| 状态、存储、排序、后台或共享交互逻辑 | 类型检查 + 受影响模块单测；浏览器仅补单测不能证明的链路，按调用方扩大定向覆盖 |
| 验证脚本／测试配置 | 类型检查 + 对应工具链单测 + 实际 CLI 冒烟；改变浏览器执行路径时选一个代表用例 |

1–2 项是小型 UI 调整的默认起点；不足以覆盖具体风险时说明原因并增加。`npm test` 的完整单测用于广泛逻辑改动或集成检查，日常定向运行 `npx --no-install tsx --test tests/<模块>.test.ts`；多个相关文件可一次传入。测试标题筛选参数放在文件名前，例如 `--test-name-pattern='reporter'`。新增测试应覆盖可观察行为或回归风险，不为纯样式结构额外搭建单测。

浏览器执行入口会构建一次，直接复用该产物；无需在前后单独 `npm run build`。不执行浏览器但需要交付可加载扩展时才单独构建。日常改动的全量端到端仅在用户明确要求时运行；正式发版必须执行完整单元测试与全量端到端测试，发布请求即包含该验证，不需再次询问是否运行全量。启动、权限、会话等日常全局路径扩大相关定向覆盖，不自动升级为全量。当前脚本定义以 [package.json](../package.json) 为准。

先在 `tests/*.spec.ts` 找对应场景，再用 `--list` 确认筛选结果。例如底栏／跨层布局改动：

```sh
npm run test:e2e -- tests/palette.spec.ts --grep 'storage and Tab Group layers preserve main palette geometry' --list
npm run test:e2e -- tests/palette.spec.ts --grep 'storage and Tab Group layers preserve main palette geometry'
```

这只演示选择方式；涉及交互时还需选中相应的确认、返回、焦点和鼠键流程。同一用例可覆盖多个流程，无需为每条断言单独启动浏览器。Playwright 的 `--grep` 匹配包含文件名与 describe 的完整标题，精确选择可用唯一标题加 `$`，避免把裸用例名放在 `^` 后导致零匹配；选定用例也可用 `tests/palette.spec.ts:<行号>`。脚本、配置和测试标题可直接查阅，不在本文维护完整用例目录或数量。

## 正式发版验证

正式发版以待发布提交为基线，执行 `npm run release:check -- v<version>` 和 `npm run check`（类型检查、完整单元测试、构建与全量 E2E）。同一提交已有完整单测和类型检查的有效证据时，可补跑 `npm run test:e2e`，明确各轮证据来源。GitHub Validate CI 当前只覆盖版本检查、类型、单测与构建，不能替代浏览器验证。

全量运行必须报告通过、失败、跳过及未执行项；失败或未执行项未解决前，不发布正式 Release 或提交商店。缺少依赖导致的跳过必须补齐环境后验证，或明确记录为经发布负责人接受的范围例外，不能计为通过。定向修复复验有助于排查，但不能声称修复后的最终提交已通过全量；正式发布前须完成该最终提交的全量验证。

发布请求授权首次全量运行，即使预计超过日常 10 分钟预算也先说明预计耗时后执行；超预算后的追加、复验与失败处理仍遵循下节停止条件。测试进行期间保持源码与构建不变，成功后从对应提交生成并核对最终发布包。

## 执行预算与停止条件

- 执行前先用 `--list` 核对选择，向用户说明选中的数量、覆盖的改动以及预计耗时；没有历史耗时时明确说明估计不确定。避免宽泛关键词把无关用例带入。纯文档改动无需运行浏览器测试。
- 先完成实现、静态检查、必要单元测试及代码检查，再运行相关 E2E。共享逻辑分支优先用单元测试覆盖，浏览器用例验证必要的真实鼠标、键盘和交替链路，不为每个分支重复启动浏览器。
- 同一源码／构建下，每个失败用例最多额外复验一次。先读错误与 trace，再决定是否复验；仍失败则记录未解决项，不能靠重复运行直到变绿。产品或夹具修复后只运行受修复影响的用例；单纯提高超时不算修复依据。
- 一次任务的 E2E 构建、执行和复验累计达到 10 分钟后，不再自动追加批次；当前批次完成后报告已耗时间、失败证据和未验证范围。预计首批就超过此预算，或需要超预算继续时，先说明具体必要性并由用户决定是否继续。预算是停止追加验证的条件，不是放宽断言或省略必需覆盖后宣称通过的理由。
- 多项出现同类启动、API 或焦点超时时，停止追加批次，先分析已有产物；若证据指向环境问题，最多选一个代表用例复验，不重跑整批。定位故障耗时同样需及时告知，不能以持续分析替代预算报告。
- 已通过的检查仅在后续改动使其结论失效时重跑。测试结束后只补验收文档，不重复构建或 E2E。最终报告列明实际轮次、耗时及仍失败／未验证项；分批通过不能写成一次全绿。

runner 在终端与 `validation.json.timings` 记录发现用例、构建、Playwright 执行、前后源码／dist 校验和总耗时，失败阶段也记录；未执行阶段不出现。预算覆盖各次 runner 的总耗时；当前 runner 不自动终止超预算任务或限制重跑，执行者仍须遵守停止条件。浏览器用例使用独立 profile、逐项启动 Chrome；优先减少无关用例，原生焦点场景保持串行隔离。`palette.spec.ts` 还以 `fixture-timing`／`fixture-cleanup-ms` 注解记录准备、启动、worker 就绪、UI 加载与清理耗时，随每次尝试写入报告。

## 构建与产物隔离

`npm run test:e2e -- <Playwright 参数>` 通过 [runner](../scripts/run-e2e.ts) 执行测试时先构建再启动 Playwright。`--list` / `--help` 仅加载用例声明／帮助，不构建、不启动浏览器、不读取或校验 dist，也不占执行锁；可以在无 dist 的检出中选例。记录标为 `build.status: not-required`，不构成构建或行为验证证据。文件名、`--grep` 等筛选参数传入 Playwright；`--config` / `-c`、`--reporter` 和 `--output` 由仓库管理，不接受覆盖。`--last-failed` 必须同时提供 `--last-failed-file <之前产物中的 .last-run.json>`；runner 校验该文件后复制到本轮目录再使用，避免新目录找不到历史记录而意外运行全套，也保留上轮原始记录。

同一源码需要追加场景或复验时，可传 `--reuse-build <上轮 validation.json>`。runner 在执行锁内核对同一仓库、HEAD、完整工作区状态及 dist 哈希，上轮还须完成前后源码／产物一致性校验；浏览器用例失败但构建与源码有效的记录也可复用。不匹配则在启动浏览器前拒绝，去掉该参数重新构建。复用记录标为 `build.status: reused`、`dist.freshlyBuilt: false`，保留来源报告；源码、测试或文档改动都会使旧记录失效。依赖安装或工具链环境改变后使用默认重建，复用不证明外部依赖或运行环境未变化。

同一仓库的 `test-results/.e2e.lock` 覆盖构建／复用检查至测试结束；已有执行 runner 时立即报错，不并发改写共享 `dist/`。独立 `npm run build`、dev watch 或直接 Playwright 不受该锁控制，执行验证前应结束这些会改写产物的进程。runner 会比较测试前后 `dist/` 哈希及 Git HEAD／工作区状态哈希（含未跟踪文件）；构建产物或源码状态变化都会使本轮验证失败，运行期间也应暂停文档编辑。异常退出残留锁时，先核实锁中 PID 及其 E2E／Chrome 子进程已结束，再按报错提示移除锁。

每次执行生成 `test-results/runs/<时间>-<PID>-<随机值>/`：`validation.json` 关联命令、Git 状态／哈希、构建结果、dist 哈希、测试选择及执行结果；每次测试尝试保留环境和浏览器版本注解。截图与 trace 通过 `testInfo.outputPath()` 放入该 run 的 `artifacts/`。`--list` 仅记录选择，不代表执行通过；前置失败阻断的用例计入 `notRun`，与主动 `skip` 区分。Git 快照不可用时 runner 失败，不能声称源码状态已核实。直接调用 Playwright 仍有独立产物目录，但会标记构建新鲜度未经验证，也不取得 runner 的锁。

## 浏览器与夹具边界

测试使用临时 Chrome profile 和本地页面，与日常浏览器资料隔离。`JUSTONEHOP_CHROMIUM_PATH` 可指定 Chrome for Testing；默认选择逻辑见 [palette.spec.ts](../tests/palette.spec.ts)，调度配置见 [playwright.config.ts](../playwright.config.ts)。原生窗口与焦点用例通过场景选项启动有界面浏览器，避免默认 viewport 覆盖真实窗口尺寸。此类用例仍受系统前台焦点影响；失败时保存 `native-window-lifecycle.json`（窗口创建／导航／关闭及当前窗口、会话状态），结合 trace 判断，不能仅凭重跑成功认定竞态已解决。

`palette.spec.ts` 在 `test.describe` 作用域内通过 `test.use({ environment: ... })` 显式声明 locale、shadow、pageAccess、cookieDomains、commands、toolbarMenus、headed、verticalTabs 和 vimium 等环境选项，默认保持闭合 Shadow DOM；测试标题仅用于说明和筛选。`tabTuck.spec.ts` 的启动存储失败也通过显式选项选择。开放 Shadow DOM、临时网站权限与后台命令钩子只写入测试扩展副本。结构测试和生产闭合 Shadow DOM / iframe 的键盘测试提供不同证据，修改相关路径时按需覆盖两者。

Vimium 兼容场景需指定 `JUSTONEHOP_VIMIUM_PATH`，指向已解包的 Vimium 扩展；场景会核实其 service worker 已加载。未提供路径时该场景跳过，不计为兼容性通过；开放 Shadow DOM 的视觉夹具不承担 Vimium 兼容验收。

## 证据与未解决项

[验收记录](ACCEPTANCE.md) 保存实际执行范围、结果及限制；它不是当前全套测试通过的声明。报告跳过、失败、重跑与未验证范围，并区分隔离浏览器结果和日常 Chrome 重载。截图与 trace 留在忽略的测试产物目录或系统临时目录，不作为长期文档附件。

屏幕定位目标仍暂停、未解决，详见 [ADR 0010](adr/0010-content-anchor-panel-geometry.md#待实现目标)。相关定位用例或历史内容区几何记录，不能证明该目标已经完成。验证设计中的独立证据判断见 [评审标准](CODING_STANDARDS.md)。
