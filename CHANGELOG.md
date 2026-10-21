# Changelog

User-visible changes are grouped by release. Git tags use `v<version>`; extension manifests and store packages use `<version>`. GitHub release dates do not imply Chrome Web Store approval. See the [release guide](docs/STORE-LISTING.md#5-本地打包与发布检查清单).

## [0.2.1] - Unreleased

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
