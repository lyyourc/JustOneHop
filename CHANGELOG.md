# Changelog

User-visible changes are grouped by release. Git tags use `v<version>`; extension manifests and store packages use `<version>`. GitHub release dates do not imply Chrome Web Store approval. See the [release guide](docs/STORE-LISTING.md#5-本地打包与发布检查清单).

## [0.3.2] - 2026-10-28

### Fixed / 修复

- Keep reusing an existing tuck-away group when its name and window stay the same, including after color changes or manually adding tabs. Preserve its color, manage its current members, and keep undo limited to the latest tucked batch. / 收起组的名称与所在窗口不变时持续复用，改颜色或手动加入标签不再导致放弃管理并另建同名组；保留当前颜色、管理当前成员，撤销仍只影响最近收起批次。
- Keep page context visible when footer keyboard hints expand. / 展开底栏键盘提示时保留页面上下文信息。

### Changed / 改进

- Simplify bilingual store and usage descriptions and use consistent Tab Switcher wording. / 精简中英文商店与使用说明，统一标签切换器文案。

## [0.3.1] - 2026-10-27

### Fixed / 修复

- Fix browsing-history searches failing after the source page's address changes, including Feishu documents. Main search and Search All History no longer require matching source URL snapshots; extension identity, incognito checks, and protection against opening results on a changed page remain in place. / 修复来源页面地址变化后（包括飞书文档）历史搜索读取失败的问题。主搜索和「搜索全部历史」不再要求来源地址快照一致，保留扩展身份、无痕检查及打开结果时的错页保护。

## [0.3.0] - 2026-10-24

Available on the [Chrome Web Store](https://chromewebstore.google.com/detail/mbofggnjaoneioopfbpheapgphmkclbo); the developer dashboard confirmed `Published` and public availability on 2026-10-26. GitHub release published on 2026-10-24. / 已通过审核并在 Chrome Web Store 公开上架，2026-10-26 确认后台状态为 `Published`；GitHub Release 发布于 2026-10-24。

### Added / 新增

- Find Chinese titles and commands with full pinyin, initials, or mixed Chinese/English queries. History supplements literal search with pinyin matches from the latest 1,000 pages in the selected time range. / 支持中文全拼、首字母和中英文混合检索；历史在字面搜索之外，补充所选时间范围最近 1,000 个页面的拼音匹配。
- Complete queries from successful local searches, and continue the latest qualifying page search in the same window within 10 minutes. Both offer keyboard and footer-button entry points. / 根据本机成功搜索补全查询，并可在同窗口 10 分钟内继续最近一次符合条件的页面搜索；均提供键盘与底栏按钮入口。
- Customize the search icon with an Emoji or a local image, with preview, explicit save, and restore-default controls. / 使用 Emoji 或本地图片自定义搜索图标，支持预览、保存与恢复默认。

### Changed / 改进

- Group settings into Appearance, Shortcuts, Experimental, and Help, with search across categories and consistent return navigation that preserves input and drafts. / 设置按外观、快捷键、实验室与帮助分类，支持跨分类搜索，返回时保留输入上下文和草稿。
- Unify secondary-page navigation, keyboard focus, footer actions, and feedback across the webpage overlay and standalone window. Footer hints can be shown or hidden through the pet control. / 统一网页浮层与独立窗口的二级导航、键盘焦点、底栏操作与反馈，可通过小动物控件显示或隐藏操作提示。
- Keep up to 2,000 local search records for ranking and completion, with reset and forget controls. / 本地排序与补全共用最多 2,000 条搜索记录，保留重置与遗忘入口。

### Fixed / 修复

- Anchor narrow-window keyboard hints to the pet, keep search focus guidance separate from input text, and allow the switcher shortcut from a native command palette. Use “宠物” consistently in Chinese settings. / 窄屏键盘提示贴近宠物入口，搜索聚焦引导与输入内容分开排布；原生命令面板内可继续唤起标签切换器，中文设置统一使用「宠物」。

- Preserve tab order across automatic tucking batches and improve recovery after browser restarts, partial failures, and manual group changes. / 保留自动收起跨批次的标签顺序，完善浏览器重启、部分失败与手动分组变更后的恢复处理。
- Refine narrow-window layout, menu focus, search hints, and transparent panel backdrops. / 修正窄窗口布局、菜单焦点、搜索提示与面板透明背景。

## [0.2.1] - 2026-10-22

### Fixed / 修复

- Anchor native command and tab-switcher panels to the source browser window, including vertical-tab layouts and page zoom. Webpage overlays remain anchored to the page viewport; the two hosts share sizing without requiring identical screen positions. / 原生命令面板与标签切换器锚定来源浏览器窗口，适配竖向标签栏与页面缩放；网页浮层继续锚定页面视口，两种承载共用尺寸策略，不再要求屏幕位置重合。

### Changed / 改进

- Organize browser tests by feature, separate component UI coverage from real extension integration, and cap browser concurrency at two workers. / 按功能组织浏览器测试，分离组件 UI 与真实扩展集成验证，并将浏览器并发限制为两个 worker。
- Stabilize lifecycle stress diagnostics and asynchronous storage/clock assertions while retaining complete stop, wake, reload, and Vimium compatibility coverage. / 稳定生命周期压力诊断及存储就绪、模拟时钟断言，保留完整停止、唤醒、重载和 Vimium 兼容验证。
- Refresh the bilingual introduction and document the independent positioning anchors and release validation boundaries. / 更新双语介绍，明确独立定位锚点与发布验收边界。

## [0.2.0] - 2026-10-21

### Added / 新增

- Configure the automatic tab-tucking idle duration and inspect its runtime status in Settings. / 在设置中配置自动收纳的闲置时长，并查看运行状态。
- Manage native tab groups with streamlined actions and safe group removal. / 优化原生标签组操作，支持安全移除标签组。

### Changed / 改进

- Consistent footer feedback for settings, copying, and tab management, including progress and persistent failure messages. / 设置、复制与标签整理统一在底栏反馈结果，包含执行中与持续可见的失败提示。
- Less crowded footer actions with clearer current-tab and new-tab choices. / 精简底栏，明确当前页与新标签页打开操作。
- More readable built-in help with a direct link to the full GitHub usage guide. / 改善内置帮助排版，提供 GitHub 完整指南入口。

### Fixed / 修复

- Keep the command palette's search and current view when switching to another application. / 切换到其他应用时保留命令面板搜索词与当前视图。
- Clear a nonempty search using its trailing button without closing the current view. / 点击搜索框尾部清空按钮时保留当前视图。
- Save the automatic tucking duration immediately after selection. / 选择自动收纳时长后立即保存。
- Open bookmarks and history in the current tab by default. / 书签与历史记录默认在当前标签页打开。
- Rank exact page-name matches ahead of title-prefix matches. / 搜索时优先展示准确匹配页面名称的结果。
- Strip trailing source-map references as well as source-map files from store archives. / 商店包同时剔除源映射文件与末尾引用注释。

## [0.1.0] - Initial submission / 首次提审

- Unified search for tabs, bookmarks, history, and browser commands. / 统一搜索标签页、书签、历史记录与浏览器命令。
- Recent-tab switching, native tab groups, and manual or automatic tab tucking. / 最近标签切换、原生标签组与手动／自动收纳。
- Read-only site storage and cookie inspection, local preferences, and built-in help. / 只读查看网站存储与 Cookie、本地偏好和内置帮助。

Repository records describe a Chrome Web Store submission of `0.1.0`. Its exact source commit and current store approval status have not been confirmed; no historical tag or release date is asserted here. / 仓库记录表明 `0.1.0` 已提交商店审核；对应源码提交与当前审核状态尚未确认，因此不补写历史 tag 或发布日期。
