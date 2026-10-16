# zing · Agent 设计与交互守则 (AGENTS.md)

本文件会在 Agent 进入仓库时自动加载，旨在确保每次迭代都严格遵守 zing 最初的产品哲学与交互架构，防止新页面或子功能出现“设计漂移（Design Drift）”。

## 1. 核心产品理念

1. **Human First（鼠键平权）**：用户可以用熟悉的快捷键，也可以只用鼠标，或在中途无缝切换。任何功能都不能以“记住隐晦快捷键或前缀”为前提。
2. **Local & Honest（本地零打扰与诚实边界）**：无账号、无服务端、无遥测。最小化权限（按需申请单站 Cookie、单次显式运行 UserScript）。功能命名忠于真实行为（例如“收起”只移入原生折叠组，绝不悄悄关闭或 discard 网页内存；重启后无法唯一确认归属的收起组必须交由用户核对确认，绝不冒领）。
3. **Unified & Predictable（统一入口与可预期心智）**：无模式前缀，所有功能入口均可从主搜索中英文直达。相关性分级始终高于本机使用习惯（学习权重仅在同级相关性内微调，绝不让无关结果反超精确意图）。危险操作（如批量关闭）必须显式检索或从菜单触发，并保护固定标签页。
4. **Native Runtime, Chrome Native Surface（原生骨架与 Chrome Omnibox / Tab Search 原生质感）**：底层直接操作 Chrome 原生对象（原生 Tab Group、`_favicon` 缓存、原生 `sessions`）；表层视觉对齐 Chrome CR2023 原生地址栏下拉框（Omnibox）与 Tab Search 的材质语言——**内嵌胶囊搜索槽（聚焦浮起蓝框）、未选中项统一安静的无框圆角图标槽（`#f1f3f4` / `#35363a` 单色图标，零杂色干扰）、选中项采用柔和蓝底（`#e8f0fe` / `#394457`）配左侧 `3.5px` 圆头指示条（`#0b57d0` / `#8ab4f8`）**，杜绝五颜六色的图标噪音与框中套框（Box-in-Box）的生硬线条。

---

## 2. 新增/修改视图的防漂移检查表（Anti-Drift Checklist）

每当新增或修改任何列表、子页面或操作弹窗时，**必须逐项核对以下 6 条契约**：

### ① 同一操作，同一逻辑（Mouse & Keyboard Parity）
- **左键单击 = Enter = 底栏主按钮**：在候选列表（主搜索、标签组、Storage 等）中，鼠标单击行必须执行与按 `Enter`、点击底栏主操作完全一致的主动作，不得出现“按 Enter 执行、单击却无反应”的割裂。
- **右键直达操作菜单（`onContextMenu`）**：只要当前视图配备了 `ActionMenu`，列表候选项必须支持右键（`event.preventDefault()`）直接选中该项、保存输入框光标位置并打开对应的 `ActionMenu`。
- **静止指针防抢焦点**：列表项的 `onMouseMove` 必须比对物理屏幕坐标（`event.screenX / event.screenY`），防止键盘滚动列表时静止的鼠标指针意外覆盖键盘选中项。在 Tab Switcher 中，鼠标悬停仅展示可点击描边，不改变松开修饰键的确认目标。

### ② 共用底栏与跨语言操作菜单（`PaletteFooter` & `ActionMenu`）
- **统一底栏呈现**：业务页面复用 `PaletteFooter`，固定 44px、不随正文滚动，不在滚动区末尾私自堆砌提交按钮；常规面板总高 516px、候选行 40px，切层保持搜索框与底栏位置。主搜索和二级列表页左侧统一为「控件 + 位置 + `·` 补充信息／状态」。API 为 `navigation?: { kind: 'settings' | 'back'; label: string; tooltip: string; disabled?: boolean; onAction: () => void }`、`title?: string`、`context?: ReactNode`、`status?: ReactNode`：组件自己渲染唯一的 26px 单色图标按钮，统一尺寸、圆角、悬浮态；主搜索是设置齿轮 + `zing`，二级页是返回箭头 + 存储类型名称（如 `Local Storage`）或 `groupLabel`。位置名称统一为 11.5px / 500 的弱化只读文字，旁边不得叠加品牌装饰、类型图标或组色图标；不用 `leading` / `title.onBack` 拼装控件，不把标题做成返回按钮。
- **补充信息与窄屏**：站点来源、成员数量一律走 `context`；左侧补充信息显式使用 11px 字号、400 字重、16px 行高的弱化文字，主搜索 `App` 与 Tab Switcher 的 `RecentSwitcherView` 均传 `context={<NavigationHint />}`，共用本地化「选择 / Navigate」与 `↑ Ctrl P ↓ Ctrl N`，悬浮提示共用 `navigationHelp`，继承这一排版；二级列表页仍显示自己的站点来源或成员数量。导航键保留一个语义 `kbd` 对应一个按键，继承相同字体与颜色，无边框、背景、内边距或最小宽度，宽度自动、高度 16px，不显示键帽框；右侧主操作与 Actions 的键帽保持 20px 高及原有边框、背景。短暂 `status` 在同一位置替换 `context`，不得增加独立槽位。宽度 ≤520px 时仅隐藏补充信息 `.palette-footer-context`（包括主搜索与 Tab Switcher 的导航提示）；`status` 仍然可见，保留复制成功、执行中及危险操作等反馈，必要时可截断。导航按钮、位置名称及右侧操作始终保留，按钮不收缩，长名称先于操作控件截断。右侧主操作与操作菜单契约保持一致。
- **Tab Switcher 共用底栏**：网页浮层与独立窗口共用 `RecentSwitcherView`，必须复用 `PaletteFooter`，不得手写底栏或另加底部帮助行。搜索框默认使用原生 `disabled` 且聚焦候选列表，不显示光标或编辑蓝框；点击搜索图标、输入区域或 Ctrl/Cmd+F 后才启用并聚焦输入，并暂停本次松键确认。`title` 在默认快速切换时放本地化松键提示（如「松开 Ctrl 切换」），进入搜索后改为切换器名称，保证窄屏仍可见；`context` 与主搜索一样传 `<NavigationHint />`，使用同一套本地化文案、按键及 `navigationHelp` 悬浮提示，沿用 11px / 400 / 16px 排版；实际启动快捷键放在切换器 `header` 的 `title` 属性，未绑定时不提供该提示。右侧 `primary` 为「切换 ↵」，可选 `secondary?: { label: string; keys: string[]; disabled?: boolean; onAction: () => void }` 为「取消 esc」，与主操作共用按钮规则，均文字在前、键帽在后；`actions` 仍可选，`isMac?: boolean` 默认为 `false`，仅供 Actions 快捷键显示。搜索栏右侧保留取消入口。浮层 `.recent-overlay .recent-switcher` 使用 `flex: 1; min-height: 0; height: auto` 填满父 `.palette`，不得独立硬编码 516px／最大高度；独立窗口仍用 `100vh`。
- **主按钮实时联动与危险态**：打开 `ActionMenu` 时，`PaletteFooter` 的 `primary` 按钮文案与行为应跟随菜单当前高亮动作；若当前动作为破坏性操作（`danger: true`，如关闭、删除、放弃恢复），必须向 `PaletteFooter` 传入 `danger: true` 以保持视觉警示一致。
- **菜单双语检索与图标**：传给 `ActionMenu` 的每个动作都必须包含图标（`icon`）与**中英文双语 `keywords`**，过滤逻辑必须同时匹配 `title` 与 `keywords`，确保在中文界面输入英文（如 `rename`、`close`、`copy`）或在英文界面输入中文均能命中。

### ③ 统一返回路由与上下文恢复（`NavigationRoot` & `BackLayer`）
- **禁止私自监听 `Escape`**：所有层级（子页面、`ActionMenu`、下拉框、删除确认框）必须通过 `<BackLayer>` 接入 `NavigationRoot`，按 React 渲染树深度每次只退出最深一层。底栏返回按钮的 `navigation.onAction` 调用页面现有返回回调，与 Esc 逐层返回语义一致，匹配最深活动 `BackLayer` 的返回行为，不得直接跳回主搜索；`label` / `tooltip` 说明返回行为，`disabled` 必须与键盘返回的可用性一致，不能只因业务忙碌而阻断鼠标返回。
- **空搜索框退格返回**：二级页面的搜索框应标记 `data-back-on-empty`，使空输入时按 `Backspace` 自然返回上一层，有内容时正常删字。
- **完整恢复编辑上下文**：从 `ActionMenu`、详情页或内嵌编辑态（如重命名、换色、脚本编辑）返回列表搜索框时，**必须恢复原搜索词、列表选中项以及输入框的光标/选区位置（`setSelectionRange(...caret.current)`）**。

### ④ 可搜索列表的视觉与导航规范
- **命中高亮（`HighlightedText`）**：所有支持关键词过滤的列表（包括主搜索、Storage、Tab Group、Script Library、Script Runner 及 ActionMenu）都必须使用 `<HighlightedText>` 渲染匹配词高亮。
- **全键盘导航**：所有列表均须支持 `↑/↓` 与 `Ctrl+P / Ctrl+N`（无额外修饰键时），选中项变化时自动 `scrollIntoView({ block: 'nearest' })`；长列表支持 `PageUp / PageDown`、`Option+↑/↓` 翻页与 `Cmd/Ctrl+↑/↓` 首尾跳转。
- **输入法与修饰键保护**：`isComposing` 或 `keyCode === 229` 期间的 `Enter` / `Escape` / `Backspace` 绝不触发业务执行或返回；带修饰键（除明确定义的 `Cmd/Ctrl+Enter` 保存外）或 `event.repeat` 的 `Enter` 不得误执行。

### ⑤ 承载容器、焦点边界与延迟反馈
- **内容区锚定与原生窗口边界**：网页浮层 CSS 与 `src/panelGeometry.ts` 的 `panelRect` 保持一致：宽度为 `min(750, 视口宽度 - 48)`，视口宽度 ≤520 时减 20；顶部 inset 为 `clamp(28, 视口高度 × 16%, 150)`，窄屏为 24；高度为 `min(516, 视口高度 - inset - 24)`，极小视口至少保留 1px。Command Palette 与 Tab Switcher 的独立窗口共用 `nativePanelBounds`，以来源 `tab.width/height` 和来源窗口 `left/top/width/height`（均为 DIP）估算水平居中、底边对齐的内容区；先按 `chrome.tabs.getZoom` 换成 CSS 视口应用同一规则，再乘回缩放比例计算屏幕坐标，不以整个浏览器外框居中。创建时暂估 44px 原生框架高度，`popup.tsx` / `switcher.tsx` 在 UI 渲染／切换器就绪交接前调用 `alignPanelWindow`，popup 用 automatic / per-tab 缩放跟随来源，边框由 Chrome API 的 popup 外框减 popup 标签页内容尺寸计算，禁止把缩放后的 DOM inner 尺寸与原生窗口尺寸混减。来源原生页内容区的屏幕原点不可直接测量，侧栏、停靠 DevTools 及系统边框可能造成偏差，不承诺像素级对齐。独立窗口保留系统标题栏；工具栏 action popup 的位置仍由 Chrome 控制。决策见 `docs/adr/0010-content-anchor-panel-geometry.md`。
- **闭合 Shadow DOM 与焦点解析**：面板可能运行在普通网页的闭合 Shadow DOM + 沙箱 iframe、独立居中窗口或原生 popup 中。解析当前焦点必须使用面板自身的 `getRootNode()` / `ownerDocument`，不得依赖全局 `window`。
- **150ms 防闪烁原则**：首屏 Loading 与快速切换浮层遵循 150ms 延迟展示，快操作直接完成不闪白屏/蒙层，已有数据刷新时不清空现有列表。

### ⑥ 验收要求
- 任何 UI 改动必须通过 `npm run typecheck`、`npm test`、`npm run build` 及相关 Playwright 端到端测试（覆盖鼠标流程、纯键盘流程及鼠键交替流程）。
- 涉及架构决策变更同步更新 `docs/adr/`，涉及组件契约更新 `docs/INTERACTION-ARCHITECTURE.md`，涉及用户可见行为更新 `README.md`、`README.en.md` 与 `docs/USAGE.md`。
