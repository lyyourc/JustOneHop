<picture>
  <source media="(prefers-color-scheme: dark)" srcset="docs/brand/logo-dark.svg">
  <source media="(prefers-color-scheme: light)" srcset="docs/brand/logo-light.svg">
  <img alt="JustOneHop Logo" src="docs/brand/logo-light.svg" width="64" height="64">
</picture>

# 小范围瞬移 · JustOneHop

简体中文 · [English](README.en.md)

**Human First · Chrome Native** —— 顺应直觉的交互，原生自然的体验，让日常使用 Chrome 更轻松愉悦。

> **环境与项目说明**
> - 纯本地运行的 Chrome 命令面板扩展，无账号、无服务端、无遥测。
> - 目前仅在 **macOS 26.7.1**、**Google Chrome 155.0.8059.85** 真机环境下测试。

---

## 为什么做它

- **Human First**：鼠标点击、熟悉的快捷键，或是两者随时切换，都是完整、顺手的使用方式——不需要背诵隐晦的快捷键或模式前缀。
- **Chrome Native**：视觉与交互贴合 Chrome 原生体验，直接复用原生书签、历史记录、Tab Group 与站点图标缓存，不另造封闭体系。

---

## 核心功能

### 1. 统一搜索与命令面板（Command Palette）

在一个搜索框里同时查找**已打开的标签页、书签、最近浏览历史、标签组和浏览器命令**：

- **中英文与口语直达**：无需前缀，直接搜网页标题、域名，或输入 `刷新页面`、`恢复标签`、`深色模式`、`new tab` 等日常表达；也支持 `clo`（关闭标签页）、`clo oth`（关闭其他标签页）等简写。
- **命令别名白名单**：支持 `prefs`（设置）、`pwd`（密码管理）、`插件管理`、`收藏夹` 及 `setings`、`extention` 等已收录错拼。品牌名可写作 `joh`、`just one hop`、`just-one-hop` 或 `瞬移`，例如 `joh settings`、`joh: help`、`reload joh`、`重载瞬移`。
- **贴合习惯的排序**：相关性优先；同一搜索词下常选的结果会在同级内自然前移，右侧可通过小图标随时查看原因或一键忘记偏好。
- **直达网址与 Google 搜索**：输入 `example.com` 或 `localhost:3000` 直接访问网址；输入任意词可直接用 Google 搜索（`Enter` 在当前页打开，`⌘Enter` 在新标签页打开）。
- **全量历史检索**：输入时同步匹配最近一周历史，也可一键展开面板内的「搜索全部历史」。

### 2. Tab Switcher（VS Code 风格最近标签切换）

按最近使用（MRU）顺序在当前窗口的标签页间快速切换：

- 按住 `Control+J`（或按内置指南一次性配置为 **`Ctrl+Tab`**），继续按键或用方向键选择，**松开修饰键即刻切换**。
- 切换途中点击搜索框或按 `⌘F`，即可暂停松键切换，直接输入标题或网址筛选目标页。
- 也可以随时从命令面板首页打开 Tab Switcher，用鼠标或回车从容选择。

### 3. 标签页整理与 Auto Tuck（自动收起）

- **连续整理不中断**：对列表中的任意标签页执行固定、静音、收藏/取消收藏、移出标签组或关闭其他页时，面板保持打开并自动选中相邻项，方便一路整理到底。
- **收起标签页（Auto Tuck）**：把 7 天未使用的标签页自动（或手动）收进 Chrome 原生折叠组「已收起」，把标签栏留给手头正在做的事。**收起不是关闭，也不主动卸载页面**，随时搜标题就能找回。

### 4. 页面存储查看与 Chrome 内置页直达

- **只读查看站点存储**：搜索 `local storage`、`session storage` 或 `cookie`，左右分栏查看当前网页的键值与属性，JSON 自动格式化，`Enter` 一键复制原始值。Cookie 权限按网站独立申请。
- **Chrome 原生页面直达**：搜索 `extension`、`password`、`download` 或对应中文，快速跳转到扩展管理、密码管理器、下载内容、Chrome 设置等内置页面（已有打开页时直接切过去，避免重复开页）。

---

## 安装

需要 Node.js / npm 与 Chrome 127+。

```sh
npm ci
npm run build
```

1. 打开 `chrome://extensions`，开启右上角 **「开发者模式」**。
2. 点击 **「加载已解压的扩展程序」**，选择项目构建生成的 **`dist/`** 目录。
3. 点击工具栏的「小范围瞬移」图标，或按 **`⌘Shift+P`**（Windows/Linux 为 `Ctrl+Shift+P`）唤起面板。

> `dist/` 不纳入 Git，首次克隆或拉取更新后请先执行 `npm run build`。若快捷键冲突，可在 `chrome://extensions/shortcuts` 中调整，或在面板内搜索「快捷键」直达设置。

---

## 常用操作速查

| 操作 | 鼠标操作 | macOS 快捷键 |
| --- | --- | --- |
| 打开 / 关闭面板 | 点击工具栏图标 / 搜索框右侧 `esc` | `⌘Shift+P` / `Esc` |
| 选择并执行结果 | 直接点击结果行或底栏主按钮 | `↑` `↓`（或 `Ctrl+P` / `Ctrl+N`）选择，`Enter` 执行 |
| 候选项更多操作（复制 URL、关闭、固定等） | 右键候选项，或点击底栏「操作」 | `⌘K` |
| 最近标签页快速切换 | 首页选择 `Tab Switcher` | `Control+J`（可在设置中配置 `Ctrl+Tab`） |
| 打开设置 | 点击底栏左侧齿轮 | `⌘,` |
| 返回上一层 | 点击底栏返回箭头、搜索框 `esc` 或双指右滑 | `Esc`（二级页空搜索框也可按 `Backspace`） |

更多功能细节、手势说明与 `Ctrl+Tab` 配置方式，请查看 **[使用指南](docs/USAGE.md)**。

---

## 使用边界与隐私

- **承载方式**：在普通网页上以居中浮层展示；在 Chrome 内置页、应用商店等无法注入浮层的页面，自动切换为跟随来源页位置的独立窗口。
- **本地数据**：设置、搜索排序与收起恢复记录保存在本机，可能包含搜索词和完整网址；页面 Storage / Cookie 内容不写入扩展持久存储，主动复制的值会进入系统剪贴板。执行 Google 搜索时，查询词会通过网页导航发送给 Google。
- **完整说明**：[隐私政策](docs/PRIVACY.md)说明访问范围、网站权限、数据保留及清理方式；政策自 2026-10-19 起生效。开发者：lyyourc；隐私咨询与使用反馈：[liangyida42@gmail.com](mailto:liangyida42@gmail.com)。

---

## 开发与文档

```sh
npm run dev     # 监听源码并增量构建
npm run check   # 运行类型检查、单元测试、构建与端到端测试
```

本地修改并构建后，可直接在面板中搜索 `Reload` 或 `重新加载扩展` 一键重载。按改动范围选择测试的方式详见 [测试指南](docs/TESTING.md)。

| 文档 | 内容说明 |
| --- | --- |
| [使用指南](docs/USAGE.md) | 各项功能的完整操作说明、搜索排序规则与使用边界 |
| [交互架构](docs/INTERACTION-ARCHITECTURE.md) | 列表、底栏、菜单、焦点管理与承载方式的交互契约 |
| [ADR 架构决策](docs/adr/README.md) | 核心设计取舍与历史架构演进记录 |
| [最近标签切换实现](docs/RECENT-TABS.md) | Tab Switcher 的修饰键监听、焦点与快速点按处理 |
| [页面存储实现](docs/PAGE-STORAGE.md) | Storage / Cookie 的目标校验与按站点授权机制 |
| [测试指南](docs/TESTING.md) | 单元测试、Playwright 浏览器验证与分层预算 |
| [Logo 规范](docs/brand/LOGO.md) | 品牌标志的设计理念、几何规范与深浅色资源 |
| [历史验收记录](docs/ACCEPTANCE.md) | 历次迭代的验证记录 |
