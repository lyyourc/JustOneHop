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
- **统一底栏呈现**：业务页面复用 `PaletteFooter`（固定高度、不随正文滚动），不在滚动区末尾私自堆砌提交按钮。
- **主按钮实时联动与危险态**：打开 `ActionMenu` 时，`PaletteFooter` 的 `primary` 按钮文案与行为应跟随菜单当前高亮动作；若当前动作为破坏性操作（`danger: true`，如关闭、删除、放弃恢复），必须向 `PaletteFooter` 传入 `danger: true` 以保持视觉警示一致。
- **菜单双语检索与图标**：传给 `ActionMenu` 的每个动作都必须包含图标（`icon`）与**中英文双语 `keywords`**，过滤逻辑必须同时匹配 `title` 与 `keywords`，确保在中文界面输入英文（如 `rename`、`close`、`copy`）或在英文界面输入中文均能命中。

### ③ 统一返回路由与上下文恢复（`NavigationRoot` & `BackLayer`）
- **禁止私自监听 `Escape`**：所有层级（子页面、`ActionMenu`、下拉框、删除确认框）必须通过 `<BackLayer>` 接入 `NavigationRoot`，按 React 渲染树深度每次只退出最深一层。
- **空搜索框退格返回**：二级页面的搜索框应标记 `data-back-on-empty`，使空输入时按 `Backspace` 自然返回上一层，有内容时正常删字。
- **完整恢复编辑上下文**：从 `ActionMenu`、详情页或内嵌编辑态（如重命名、换色、脚本编辑）返回列表搜索框时，**必须恢复原搜索词、列表选中项以及输入框的光标/选区位置（`setSelectionRange(...caret.current)`）**。

### ④ 可搜索列表的视觉与导航规范
- **命中高亮（`HighlightedText`）**：所有支持关键词过滤的列表（包括主搜索、Storage、Tab Group、Script Library、Script Runner 及 ActionMenu）都必须使用 `<HighlightedText>` 渲染匹配词高亮。
- **全键盘导航**：所有列表均须支持 `↑/↓` 与 `Ctrl+P / Ctrl+N`（无额外修饰键时），选中项变化时自动 `scrollIntoView({ block: 'nearest' })`；长列表支持 `PageUp / PageDown`、`Option+↑/↓` 翻页与 `Cmd/Ctrl+↑/↓` 首尾跳转。
- **输入法与修饰键保护**：`isComposing` 或 `keyCode === 229` 期间的 `Enter` / `Escape` / `Backspace` 绝不触发业务执行或返回；带修饰键（除明确定义的 `Cmd/Ctrl+Enter` 保存外）或 `event.repeat` 的 `Enter` 不得误执行。

### ⑤ 承载容器、焦点边界与延迟反馈
- **闭合 Shadow DOM 与焦点解析**：面板可能运行在普通网页的闭合 Shadow DOM + 沙箱 iframe、独立居中窗口或原生 popup 中。解析当前焦点必须使用面板自身的 `getRootNode()` / `ownerDocument`，不得依赖全局 `window`。
- **150ms 防闪烁原则**：首屏 Loading 与快速切换浮层遵循 150ms 延迟展示，快操作直接完成不闪白屏/蒙层，已有数据刷新时不清空现有列表。

### ⑥ 验收要求
- 任何 UI 改动必须通过 `npm run typecheck`、`npm test`、`npm run build` 及相关 Playwright 端到端测试（覆盖鼠标流程、纯键盘流程及鼠键交替流程）。
- 涉及架构决策变更同步更新 `docs/adr/`，涉及组件契约更新 `docs/INTERACTION-ARCHITECTURE.md`，涉及用户可见行为更新 `README.md`、`README.en.md` 与 `docs/USAGE.md`。
