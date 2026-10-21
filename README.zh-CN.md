<picture>
  <source media="(prefers-color-scheme: dark)" srcset="docs/brand/logo-dark.svg">
  <source media="(prefers-color-scheme: light)" srcset="docs/brand/logo-light.svg">
  <img alt="JustOneHop Logo" src="docs/brand/logo-light.svg" width="64" height="64">
</picture>

# 小范围瞬移 · JustOneHop

[English](README.md) · 简体中文

**顺应直觉、贴合 Chrome 原生体验的命令面板。**

标签页开多了找不着、书签和历史分散在不同入口？按一下 **`⌘Shift+P`**（Windows/Linux 为 `Ctrl+Shift+P`），在一个搜索框里同时找齐**已打开的标签页、书签、浏览历史、标签组和常用操作**——用鼠标点选、按快捷键，或中途混用都自然顺手。

> **100% 本地运行与隐私优先** —— 无账号、无服务端、无遥测，所有数据留在你的设备。

---

## 为什么做它？

- **不用背指令（Human First）**：告别 `>`、`@`、`%` 等隐晦前缀。直接输入日常中英文（如 `刷新`、`恢复标签`、`深色模式`、`downloads`），鼠标和键盘都是完整的一等公民路径。
- **像浏览器自带（Chrome Native）**：视觉遵循 Chrome CR2023 设计语言，自动适配深浅色模式；直接复用原生标签组（Tab Groups）、书签、历史与图标缓存。
- **越用越顺手，但绝不乱排（Predictable）**：相关性永远第一；同一搜索词下常选的结果仅在同级内自然前移，随时可查看原因或一键遗忘。

---

## 核心功能

### 1. 一个搜索框，找齐所有内容

![统一搜索演示](docs/demo/zh-search.gif)

- **中英文口语直达**：搜网页标题、域名，或直接输入 `新建标签`、`扩展`、`密码`、`清理缓存` 等日常表达即可执行（若目标内置页已打开则直接切换，不重复开页）。
- **懂你要找什么**：搜项目名（如 `justonehop`）优先定位仓库主页，加词（`justonehop testing`）再找子文档；输入网址直接跳转，未知词一键发起 Google 搜索。
- **原地跳转或新开标签**：书签、历史与网址默认按 `Enter` 在当前页打开，按 `⌘Enter`（Windows/Linux `Alt+Enter`）在新标签页打开。

### 2. Tab Switcher：像 `Alt+Tab` 一样切回刚才的网页

![最近标签切换演示](docs/demo/zh-switcher.gif)

- **按住选、松手即切**：按住 `Control+J`（内置向导支持 10 秒配置为 **`Ctrl+Tab`**），按**最近访问顺序（MRU）**穿梭，松开修饰键立即切换。
- **随时打字筛选**：切换途中点搜索框或按 `⌘F`，即可松开按键，输入标题或网址快速缩小范围。
- **纯鼠标也好用**：随时可从面板首页点进 `Tab Switcher`，用鼠标或回车从容选择。

### 3. 连续整理标签页与开发者工具

![标签整理与操作菜单演示](docs/demo/zh-actions.gif)

- **连续整理不中断（右键 / `⌘K`）**：对任意标签页一键复制链接、固定、静音、收藏或关闭。操作后面板**保持打开并自动选中下一项**，一口气清理多个标签页。
- **原生标签组与闲置收起**：直接搜索并展开、改名、解散或关闭标签组（自动保护固定页）。开启「自动收起」后，电脑空闲时会将久未访问的标签页移入原生折叠组，不关网页也能让标签栏保持清爽。
- **免开 DevTools 看存储**：搜 `local storage`、`session storage` 或 `cookie`，双栏只读查看格式化 JSON 并一键复制（Cookie 权限仅按站点独立申请）。

---

## 常用操作速查

| 你想做的事 | 鼠标操作 | macOS 快捷键（Win/Linux 将 `⌘` 换为 `Ctrl`） |
| --- | --- | --- |
| 打开 / 关闭面板 | 点击工具栏图标 / 右侧 `esc` | `⌘Shift+P` / `Esc` |
| 选择并执行 | 点击结果行或底栏主按钮 | `↑` `↓` 选择，`Enter` 执行 |
| 在新标签页打开 | 点击底栏「新标签页打开」 | `⌘Enter`（Win/Linux 为 `Alt+Enter`） |
| 更多操作（固定、静音、关闭等） | 右键结果行，或点底栏「操作」 | `⌘K` |
| 最近标签页切换 (MRU) | 首页点击 `Tab Switcher` | `Control+J`（可配置 `Ctrl+Tab`） |
| 返回上一层 | 点击底栏返回箭头 / 触控板双指右滑 | `Esc`（空搜索框也可按 `Backspace`） |
| 打开设置 / 使用帮助 | 点击底栏齿轮 / 首页「使用帮助」 | `⌘,` / 搜索 `help` |

> 完整功能教程、触控板手势与 `Ctrl+Tab` 配置步骤，请查阅 **[使用指南](docs/USAGE.zh-CN.md)**（[English](docs/USAGE.md)）。

---

## 安装方式

### 方式一：Chrome 应用商店 / 发行包

- **Chrome 应用商店**：[小范围瞬移 · JustOneHop](https://chromewebstore.google.com/detail/justonehop/mbofggnjaoneioopfbpheapgphmkclbo)
- **GitHub Releases**：在 [Releases 页面](https://github.com/lyyourc/JustOneHop/releases) 下载最新构建包，或查看 [更新日志](CHANGELOG.md)（当前源码版本：`0.2.0`）。

### 方式二：从源码本地构建

需要 Node.js / npm 与 Chrome 127+：

```sh
npm ci
npm run build
```

1. 打开 `chrome://extensions`，开启右上角 **「开发者模式」**。
2. 点击 **「加载已解压的扩展程序」**，选择生成的 **`dist/`** 目录。
3. 按 **`⌘Shift+P`**（Windows/Linux `Ctrl+Shift+P`）或点击工具栏图标即可使用。

---

## 隐私与运行机制

- **全场景无缝承载**：普通网页以内嵌浮层居中偏上显示；在 `chrome://`、应用商店等受限页面，自动切换为轻量独立窗口。
- **数据 100% 留在本机**：偏好设置、搜索习惯（最多 2000 条，90 天未使用自动失效）与标签组状态仅保存在本机扩展存储。查看的网页 Storage / Cookie 仅在内存中只读展示，绝不落盘或外传。
- **隐私政策**：详见 [中文隐私政策](docs/PRIVACY.md)（[English](docs/PRIVACY.en.md)）。开发者：`lyyourc` · 联系邮箱：[liangyida42@gmail.com](mailto:liangyida42@gmail.com)。

---

## 开发与文档

```sh
npm run dev            # 监听源码并增量构建
npm run check          # 运行类型检查、单元测试、构建与端到端测试
npm run package:store  # 校验发布元数据并打包商店 ZIP
```

本地重新构建后，可在面板中直接搜索 `Reload` 或 `重新加载扩展` 原地重载。

- [使用指南](docs/USAGE.zh-CN.md)（[English](docs/USAGE.md)） · [交互架构](docs/INTERACTION-ARCHITECTURE.md) · [ADR 架构决策](docs/adr/README.md)
- [最近标签切换](docs/RECENT-TABS.md) · [页面存储查看](docs/PAGE-STORAGE.md) · [测试指南](docs/TESTING.md) · [Logo 规范](docs/brand/LOGO.md)
- [更新日志](CHANGELOG.md) · [版本发布与商店指南](docs/STORE-LISTING.md#5-本地打包与发布检查清单)
