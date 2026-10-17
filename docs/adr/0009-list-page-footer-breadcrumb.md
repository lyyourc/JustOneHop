# 0009 · 列表页取消标题栏，底栏统一为控件、位置与上下文

状态：已采纳；2026-10-17 修订。记录日期：2026-10-17。

## 背景

主搜索的第一行是搜索胶囊，而 Storage 和标签组管理页原先在搜索框之上各有一个标题栏。进入二级页时打字目标下移 48px（Storage）或 60px（标签组），退出时再跳回去；两处的胶囊几何也不同。把返回和层名移到底栏，可以让搜索框、列表与底边在切层时保持位置。

初版只统一了按钮尺寸：主搜索仍有品牌标记与导航提示，二级页则使用较重的层名、存储类型或组色图标及次级信息，左侧的视觉层级和组装逻辑依然分叉。用户要求主搜索与二级页共用「控件 + 位置 + 上下文」，本次修订取代初版的品牌装饰、标题旁身份图标和 `title.onBack` 方案。

## 决策

列表型二级页（`StorageView`、`TabGroupView`）删除 header，主搜索与二级列表页共用 `PaletteFooter` 的同一左侧结构：

- **控件**：API 为 `navigation?: { kind: 'settings' | 'back'; label: string; tooltip: string; disabled?: boolean; onAction: () => void }`。组件按 `kind` 渲染唯一的 26px 单色图标按钮，统一尺寸、圆角、悬浮态和禁用态，页面不再通过 `leading` 或 `title.onBack` 自行拼装。主搜索的设置齿轮调用共用设置操作；二级页的返回箭头调用页面现有返回回调，与 Esc 逐层返回语义一致，匹配最深活动 `BackLayer` 的返回行为；适用的 Backspace 同样每次只退最深一层：先关菜单，再退编辑层，最后回主搜索。`label` 提供可访问名称，`tooltip` 提供悬浮提示，均说明真实行为（如「返回 · Local Storage」）。`disabled` 必须与键盘路径的可用性一致，不能只因业务忙碌禁用鼠标返回。
- **位置**：`title?: string` 是只读位置名称，主搜索为 `zing`，Storage 为存储类型名称（如 `Local Storage`），标签组为 `groupLabel`。统一使用 11.5px / 500 的弱化文字，不可点击；标题旁不加品牌装饰、第二个类型图标或组色图标。
- **上下文／状态**：`context?: ReactNode` 承载站点来源、成员数量，显式使用 11px 字号、400 字重、16px 行高的弱化辅助文字；主搜索 `App` 与 Tab Switcher 的 `RecentSwitcherView` 均传 `context={<NavigationHint />}` 并继承同一排版，共用本地化「选择 / Navigate」与 `↑ Ctrl P ↓ Ctrl N`，悬浮提示均为 `navigationHelp`；二级列表页不显示这组导航提示。导航键保留一个语义 `kbd` 对应一个按键，继承上下文的字体与颜色，无边框、背景、内边距或最小宽度，宽度自动、高度 16px，左侧补充信息不显示键帽框。`status?: ReactNode` 承载短暂反馈，出现时替换 `context`，共用标题后以 `·` 分隔的同一位置，不增加第二个槽位。

右侧呈现主操作、可选次要操作、操作菜单和快捷键。新增 `secondary?: { label: string; keys: string[]; disabled?: boolean; onAction: () => void }`，与主操作共用按钮规则，文字在前、键帽在后；右侧键帽保持 20px 高及原有边框、背景，主操作沿用原有执行、可用性与危险态契约。`actions` 仍可选，`isMac?: boolean` 默认为 `false`，仅用于 Actions 的平台快捷键显示。业务页面不得在正文末尾另放主要提交按钮，也不得增加重复的返回入口；返回后保留原搜索词、选中项与光标／选区。

Tab Switcher 的网页浮层与独立窗口通过同一 `RecentSwitcherView` 复用 `PaletteFooter`，取代手写底栏和额外的 `recent-help` 行。左侧 `title` 在快速切换时放本地化 `recentRelease`（如「松开 Ctrl 切换」，按 `releaseKey` 显示对应修饰键），显式进入搜索后改为 `recentSwitcher`（切换器名称）；`context` 与根 `App` 一样传 `<NavigationHint />`，共用本地化「选择 / Navigate」、`↑ Ctrl P ↓ Ctrl N` 与 `navigationHelp` 悬浮提示，沿用 11px / 400 / 16px 的共享排版；实际启动快捷键放在切换器 `header` 的 `title` 属性，未绑定时不提供该提示。右侧 `primary` 为「切换 ↵」，`secondary` 为「取消 esc」；搜索栏右侧保留取消按钮，确认、取消与键盘处理沿用共享回调。

搜索胶囊几何由 `.search-bar` / `.storage-search` 共享规则提供，包含窄屏间距。设置保留 header／滚动正文／footer 骨架：header 复用主搜索的 56px 高度、搜索图标、输入胶囊与聚焦蓝框，提供真正的「搜索设置」。空输入显示全部，按名称、说明及中英文关键词过滤独立设置行，隐藏空分区并高亮可见命中；无结果提供清空入口。底栏使用现有 navigation、title 与 context 显示返回、Settings／设置和 Tab / Shift+Tab 提示，无需改变共用底栏 API。设置页保留具名 region，普通进入聚焦搜索输入，Tab／Shift+Tab 遍历 header、可见设置控件和 footer；搜索直达仍聚焦目标控件。输入框的 Enter 不执行重置或开关。设置的控件导航提示在窄屏保留。脚本库、脚本执行结果、收起恢复核对暂保留 header。

## 修订理由与参考

Raycast 的 [A fresh look and feel](https://www.raycast.com/blog/a-fresh-look-and-feel) 将当前命令身份与通知放在底栏左侧，将上下文操作与快捷键放在右侧，以便用户辨认当前位置、接收反馈并发现操作。zing 参考这一分区思路；共享的设置／返回控件、11.5px 弱化位置名称、以状态替换上下文及窄屏隐藏规则均是本项目自己的适配。

这次修订把主搜索也纳入相同的位置语言：`zing` 与 `Local Storage`、组名具有相同字重和角色；设置与返回由同一个组件生成；导航提示、站点来源、成员数量和短暂状态共用一处。移除品牌装饰与标题旁的类型／组色图标，避免左侧继续出现多套视觉与组装逻辑。

## 尺寸与响应式契约

面板统一由 `.palette` 提供含边框的常规 516px 总高与纵向 flex 骨架；网页浮层受可用视口高度约束，独立窗口填满视口。正文以 `flex: 1; min-height: 0` 占满剩余空间并内部滚动，44px 底栏固定且不收缩。列表复用 `.result` 的 40px 行高、26px 图标槽与 `.entry-copy` 单行布局；Storage 名称与值预览并排，完整值仍从详情查看。本次底栏修订保持 516 / 44 / 40 的几何契约；独立窗口的内容区锚点、视口缩小规则与原生边框校准见 [ADR 0010](0010-content-anchor-panel-geometry.md)。Tab Switcher 浮层的 `.recent-overlay .recent-switcher` 改用 `flex: 1; min-height: 0; height: auto` 填满父 `.palette` 可用空间，不再另设 516px 高度／最大高度，避免底栏溢出或删除帮助行后留下底部空白；独立窗口仍使用 `100vh`。

宽度 ≤520px 时仅隐藏补充信息 `.palette-footer-context`，包括主搜索与 Tab Switcher 的导航提示；`status` 不隐藏，复制成功、执行中及危险操作等反馈仍在同一位置替换上下文，必要时可截断。导航按钮、位置名称和右侧操作始终保留；Tab Switcher 把松键提示或进入搜索后的切换器名称放在 `title`，窄屏也保留。按钮不收缩，长名称先于操作控件截断。短暂反馈不另占一行，也不改变底栏高度。

## 取舍与未采用方案

- 取消二级列表页标题栏后，同一面板高度可多显示 48–60px 列表内容，位置名称和返回仍有固定入口；设置也采用同一位置语义，但顶部提供设置搜索，维持统一三段骨架；相较新增分区导航，搜索沿用既有输入习惯并能直接缩小到单项设置；其他表单页暂保留标题栏。
- 保留独立标题栏、只统一其高度，仍会使搜索框在切层时移动；返回留在标题栏、标题移到底栏则不能解决这一问题。
- 把标题做成返回按钮，会让位置文字兼任动作。统一图标按钮提供明确鼠标目标，标题保持只读。
- 保留主搜索品牌装饰或标题旁的类型／组色图标，会让相同位置继续出现不同视觉重量；本次采用单一导航控件与纯文字位置名称。
- 为短暂状态增加独立槽位会挤压名称与操作；用状态替换上下文。窄屏隐藏补充信息，同时保留可截断的状态反馈，让复制成功、执行中及危险操作提示持续可见；位置名称先于操作控件截断。
- 保留 `.search-bar` 与 `.storage-search` 类名，以区分主搜索与 Storage 输入框；通过共享规则统一几何，避免重复维护样式。

## 相关文档与实现

[组件契约](../INTERACTION-ARCHITECTURE.md#面板布局与操作组件) · [使用指南](../USAGE.md) · [PaletteFooter.tsx](../../src/PaletteFooter.tsx) · [style.css](../../src/style.css)
