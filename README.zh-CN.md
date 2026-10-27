<picture>
  <source media="(prefers-color-scheme: dark)" srcset="docs/brand/logo-dark.svg">
  <source media="(prefers-color-scheme: light)" srcset="docs/brand/logo-light.svg">
  <img alt="JustOneHop Logo" src="docs/brand/logo-light.svg" width="64" height="64">
</picture>

# 小范围瞬移 · JustOneHop

[English](README.md) · 简体中文

**[从 Chrome 应用商店安装](https://chromewebstore.google.com/detail/mbofggnjaoneioopfbpheapgphmkclbo)** · 免费 · Chrome 127+ · 100% 本地运行

**Human-first，Chrome-native 的命令面板。**

按 **`⌘Shift+P`**（Windows/Linux 为 `Ctrl+Shift+P`）或点击工具栏图标，在一个搜索框里找齐已打开的标签页、书签、浏览历史和常用操作。用鼠标还是键盘都一样顺手。

---

## 核心功能

### 1. 一个搜索框，找齐所有内容

![统一搜索演示](docs/demo/zh-search.gif)

- **标签页、书签与历史同框**：切到已打开的标签页，或者直接打开书签和历史记录（`Enter` 当前页打开，`⌘Enter` / `Alt+Enter` 新标签页打开）。
- **直接打字，不用记前缀**：支持中英文或拼音，直接搜 `新建标签`、`恢复标签`、`下载`、`扩展` 或 `深色模式`。
- **记住习惯**：常用的结果会排在更前面，也可以随时一键清除记忆。

### 2. `Alt+Tab` 式切最近标签

![最近标签切换演示](docs/demo/zh-switcher.gif)

- **按住选、松手即切**：按住 `Control+J`（Windows/Linux 为 `Ctrl+,`，也可以按向导设为 `Ctrl+Tab`），按最近使用顺序翻选标签页。
- **随时打字筛选**：切标签时点一下搜索框或按 `⌘F`，就能松开按键，打字搜标题或网址。

### 3. 顺手整理标签页

![标签整理与操作菜单演示](docs/demo/zh-actions.gif)

- **连续整理不打断（右键 / `⌘K`）**：固定、静音、收藏、复制链接或关闭标签。关闭或固定后，面板不会消失，还会自动选到下一项。
- **暂时不看的页面先收起来**：把用不到的网页放进折叠标签组，不用关掉网页，也能让标签栏变清爽。支持空闲时自动收起。

---

## 常用操作速查

每个操作都同时支持鼠标与键盘（Windows/Linux 将 `⌘` 换为 `Ctrl`）：

| 你想做的事 | 鼠标操作 | 快捷键 |
| --- | --- | --- |
| 打开 / 关闭面板 | 点击工具栏图标或右侧 `esc` | `⌘Shift+P` / `Esc` |
| 打开结果 / 新标签页打开 | 点击结果行 / 底栏「新标签页打开」 | `Enter` / `⌘Enter`（Win/Linux `Alt+Enter`） |
| 更多操作（固定、静音、关闭…） | 右键结果行或点底栏「操作」 | `⌘K` |
| 最近标签切换 | 首页点击 `Tab Switcher` | `Control+J`（可配置 `Ctrl+Tab`） |
| 返回上一层 | 点击返回按钮 / 触控板双指右滑 | `Esc`（空输入框也可按 `Backspace`） |
| 设置与使用帮助 | 点击底栏品牌名或首页「使用帮助」 | `⌘,` / 搜索 `help` |

完整技巧与 `Ctrl+Tab` 配置步骤请参考：**[使用指南](docs/USAGE.zh-CN.md)**（[English](docs/USAGE.md)）

---

## 安装与本地构建

- **Chrome 应用商店（推荐）**：**[前往商店添加至 Chrome](https://chromewebstore.google.com/detail/mbofggnjaoneioopfbpheapgphmkclbo)**
- **手动安装发行包**：从 [GitHub Releases](https://github.com/lyyourc/JustOneHop/releases) 下载 `justonehop-<version>.zip` 并解压，在 `chrome://extensions` 开启「开发者模式」后点击「加载已解压的扩展程序」。
- **从源码构建**：
  ```sh
  npm ci && npm run build   # 随后在 chrome://extensions 加载 dist/ 目录
  ```

---

## 隐私与文档

- **100% 本地运行**：没有账号，没有后台服务器，也不收集任何使用数据。详见[隐私政策](docs/PRIVACY.md)（[English](docs/PRIVACY.en.md)）。
- **项目文档**：[使用指南](docs/USAGE.zh-CN.md) · [交互架构](docs/INTERACTION-ARCHITECTURE.md) · [ADR 架构决策](docs/adr/README.md) · [测试指南](docs/TESTING.md) · [更新日志](CHANGELOG.md)
