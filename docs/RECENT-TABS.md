# 小范围瞬移 · JustOneHop 最近标签页切换器

本文描述当前实现与测试边界。使用方法见 [使用指南](USAGE.md#最近标签页切换)，选择此方案的原因见 [ADR 0006](adr/0006-recent-tab-switcher.md)。

## 当前交互

### 面板内入口（2026-10-18）

首页推荐及中英文主搜索提供「JustOneHop: Tab Switcher」（`tab switcher / 最近标签页 / 切换标签页`）。点击、Enter 或底栏主操作只在当前 palette host 内导航到共享 `RecentSwitcherView`，不启动快捷键会话、不另开窗口，入口本身不学习。搜索初始启用并聚焦；按来源窗口 MRU 展示其他页、来源页置末，可直接按标题／URL 筛选。点击候选、普通 Enter 或底栏「切换」明确确认并关闭面板；没有松键确认或 150ms 快速切换展示延迟。切换未提供学习查询，不记录搜索习惯。

取消、Esc、搜索尾部 esc 与底栏返回共用父面板的 `BackLayer`，恢复主搜索 query、selection、caret／选区及选中项可见位置；子页不建立独立 `NavigationRoot`。列表、筛选、当前标记、键盘保护与底栏复用共享组件，初始焦点和退出行为由入口区分。主搜索首页现为最多 10 项的混合推荐，不是 MRU；立即 Enter 执行第一条推荐，最近使用顺序由本切换器提供。

### 快捷键启动

原快捷键路径保持以下行为。普通 HTTP(S) 页面复用 Command Palette 的网页浮层容器，位置、宽度和高度一致：按页面视口水平居中、偏上，最大 750×516px，按可用视口缩小。无法聚焦网页、无法注入或 Chrome 原生页面使用独立窗口兜底，按来源标签页内容尺寸与缩放比例估算同一锚点与尺寸，并在 UI 渲染和就绪交接前校准自身原生边框；系统标题栏仍保留。源窗口限定为启动时的普通浏览器窗口。几何规则与近似边界见 [ADR 0010](adr/0010-content-anchor-panel-geometry.md)。

1. 当前绑定的快捷键（默认 macOS 为 Control+J，Windows/Linux 为 Ctrl+,，也可配置 Ctrl+Tab）打开并高亮上一标签页；反向快捷键反向高亮。搜索框初始为空且原生 `disabled`，由候选列表接收焦点，显示本地化「搜索最近标签页… / Search recent tabs…」。
2. ↑/↓、Ctrl+N/P、Tab / Shift+Tab 循环选择；PageUp/PageDown、Alt（Option）+↑/↓ 按页移动，Ctrl/Cmd+↑/↓ 跳到首尾。重复启动快捷键仍可连续选择，导航不切页。
3. 普通 Enter、点击候选项或底栏「切换」才激活最终目标、关闭切换器并返回源窗口；未进入搜索时，松开启动修饰键同样确认。所有带修饰键、长按重复及输入法组合期间的 Enter 均不执行。
4. Esc 通过 `NavigationRoot` + `BackLayer` 取消，加载期间也有效；点击浮层外部、失焦或最小化同样取消，不切页、不抢回焦点；源窗口或源标签页关闭/移走时也取消。
5. 候选按打开时的 MRU 排序，当前页在首项；搜索与导航不改变顺序，不写入搜索使用习惯。关闭/移走候选时移除该行；选中项消失则仅在源页仍在筛选结果中时回到源页，否则暂不选择，直到导航、点击或修改查询，避免意外确认其邻居。

点击搜索图标按钮、输入框外层区域（`pointerdown`）或按标准 Cmd+F（Windows/Linux 为 Ctrl+F）显式进入搜索，暂停本次会话的松键确认；可松开启动修饰键正常输入，再用普通 Enter、点击候选项或底栏「切换」确认。进入搜索才启用并聚焦输入框；之后点击搜索图标或再次按 Ctrl/Cmd+F 均将焦点带回输入框。初始列表聚焦不出现光标或蓝色编辑边框，普通快速切换仍按松键确认。

输入按标题和 URL 筛选，仅限本次会话的来源窗口候选，不区分大小写；以空白分隔的词须全部命中，每个词可命中标题或 URL。修改查询时保留仍可见的选中页，否则选择首项。无匹配或无选中项时，Enter、松键及底栏主操作均不激活标签页。

网页浮层立即接收按键，面板与蒙层统一延后 150ms 展示。快速松键直接确认，不显示浮层；等待后台切换期间也不补显。持续按住时再显示候选列表，切换操作本身不等待这个展示延迟。

确认前重新校验源标签页仍在原窗口且处于激活状态、候选仍在源窗口、切换器仍持有焦点。语言、主题和快捷键沿用现有设置。两种容器共用列表组件；浮层仅回传确认目标或取消，后台校验来源页、窗口和会话后切换。后台断连时浮层关闭。

## 共用搜索、底栏与布局

内嵌子页、快捷键网页浮层与独立窗口共用 `RecentSwitcherView`；内嵌子页初始即为搜索状态，底栏额外提供返回父页的共享导航按钮，其余两种承载的初始列表焦点与松键提示保持不变。首行使用与主搜索相同的 `.search-bar` 输入胶囊，候选区复用 `.results`、`.result` 和 `.entry-copy`。输入框以 `combobox` 关联列表；快捷键启动时默认焦点和 `aria-activedescendant` 属于列表，启用搜索后由输入框的 `aria-controls` 与 `aria-activedescendant` 表达当前候选；标题和 URL 使用 `HighlightedText` 高亮匹配文字，不启用拼写容错。搜索栏右侧提供取消按钮，实际启动快捷键仍放在 `header` 的 `title` 属性，未绑定时不提供该提示。

底栏统一由 `PaletteFooter` 渲染，固定 44px 且不随列表滚动，不另加 `recent-help` 行。左侧 `title` 在快速切换时使用本地化 `recentRelease`（如「松开 Ctrl 切换」），按 `releaseKey` 显示对应修饰键；显式进入搜索后改为 `recentSwitcher`（中英文均使用「Tab Switcher」术语）；`context={<NavigationHint />}` 与根 `App` 完全相同，共用本地化「选择 / Navigate」与 `↑ Ctrl P ↓ Ctrl N`、`navigationHelp` 悬浮提示及 11px / 400 / 16px 辅助文字样式。宽度 ≤520px 时隐藏导航提示，仍保留底栏 `title` 中的松键提示或搜索状态标题。

右侧 `primary` 为「切换 ↵」，`secondary` 为「取消 esc」，均复用共享按钮样式、文字在前且键帽在后。未加载、无有效选中项或关闭期间禁用主操作，取消调用共享回调。

网页浮层的 `.recent-overlay .recent-switcher` 使用 `flex: 1; min-height: 0; height: auto` 填满 `.palette` 的可用空间，不独立指定 516px 高度或最大高度，避免底栏溢出或底部空白。独立窗口仍使用 `100vh`。

## 已知边界

Chrome commands 不提供全局 keyup。普通网页通过 document_start 的隔离脚本观察真实 Control/Alt/Meta 状态，包含已聚焦且匹配 HTTP(S) 的子框架。后台先向网页建立本次会话，再打开浮层；浮层安装监听后才报告就绪。独立窗口兜底在安装监听后才接管焦点。后台开始前已经观察到松键时直接切页；加载期间松键会被缓冲，在就绪后确认。没有计时猜测、持久化按键记录、文本读取或原生助手。

现有网页在扩展更新后需刷新一次。地址栏、受限页面、未匹配的 iframe 或未注入页面仍用原独立窗口兜底，过早松键仍可能需要 Enter。内容脚本匹配权限不等于 Cookie API 主机授权；不添加全站 host_permissions，Cookie 继续逐站请求。

独立窗口保留系统标题栏与边框。`nativePanelBounds` 使用 Chrome 返回的来源 `tab.width/height` 与窗口 `left/top/width/height`（DIP），按水平对称、底边对齐估算内容区，再按来源缩放换算为 CSS 视口、应用同一几何规则并换回屏幕坐标。`alignPanelWindow` 以 automatic / per-tab 缩放跟随来源，并用 Chrome API 中 popup 外框与标签页内容尺寸之差校准自身框架。

来源内容区的屏幕原点无法直接测量；popup 自身边框校准不能消除这一估算误差。垂直标签栏、停靠 DevTools 和系统边框可能造成偏差，不能承诺像素级对齐。

macOS 全屏入口已检查，多显示器/多 Spaces 未完整验收。横向／垂直标签栏 × 80%／100%／125% 缩放的当前屏幕位置对照矩阵尚未全部通过，垂直标签栏的来源原点偏差仍未解决；既有几何通过记录的适用范围见 [验收记录](ACCEPTANCE.md)。自动化工具不能独立派发原生 Control 松开，松键逻辑由隔离 Chrome 真实扩展窗口的 CDP 键盘事件验证。

## 测试

```sh
npm run typecheck
npm run build
npm run test:e2e -- --grep 'recent switcher|recent bridge'
node tests/switcher-manual.mjs
```

切换器回归覆盖：打开/连续导航不切页、松键最终确认、Esc/失焦取消、关闭/移走候选、快速连续导航后松键、源窗口及源页关闭、工具栏行为保持不变。手工脚本只创建临时配置及 A/B/C 合成页面。
