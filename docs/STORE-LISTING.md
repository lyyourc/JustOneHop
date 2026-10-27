# Chrome Web Store 发布与审核指南

[English Listing](#1-english-store-listing) · [中文发布文案](#2-中文商店文案) · [权限与用途申明](#3-审核后台权限与单一用途声明) · [审核员指引](#4-审核员测试指引-reviewer-instructions) · [打包与检查清单](#5-本地打包与发布检查清单)

本文档是 **小范围瞬移 · JustOneHop** 在 Chrome Web Store 上架与审核的官方权威参考，完整收录了可直接复制的中英文商店文案、后台权限与单一用途声明、数据安全问卷填写依据、审核员操作指引（Reviewer Instructions）及商店图片与打包清单。

---

## 基本信息一览

| 字段 | 填写内容 | 说明 |
| --- | --- | --- |
| **扩展名称 (Name)** | `JustOneHop`（默认语言） / `小范围瞬移`（中文） | 英文首字母大写；中文名统一 |
| **已上架版本** | `0.3.0` | 2026-10-26 确认后台为 Published，已公开上架 |
| **扩展 ID** | `mbofggnjaoneioopfbpheapgphmkclbo` | 商店官方分配唯一标识 |
| **开发者账号** | `lyyourc` | 个人开发者 |
| **支持与隐私邮箱** | `liangyida42@gmail.com` | 已验证联系邮箱 |
| **商店分类** | `Tools`（工具） | 当前后台分类 |
| **分发范围** | `Public` / `All regions` / `Free` | 公开、全区免费分发 |
| **隐私政策 URL** | `https://github.com/lyyourc/JustOneHop/blob/main/docs/PRIVACY.en.md` | 英文为主，页面顶部有中文互链 |
| **项目主页 URL** | `https://github.com/lyyourc/JustOneHop` | GitHub 仓库公开主页 |
| **支持页面 URL** | `https://github.com/lyyourc/JustOneHop/blob/main/docs/USAGE.md` | 使用指南（默认英文，提供中文链接） |

---

## 1. English Store Listing

### Name (Paste-ready)
```text
JustOneHop
```

### Short Description (Paste-ready, within 128 characters)
```text
A human-first, Chrome-native command palette for tabs, bookmarks, history, and browser actions.
```

### Detailed Description (Paste-ready)
```text
A human-first, Chrome-native command palette.

Press Command+Shift+P (Ctrl+Shift+P on Windows/Linux) or click the toolbar icon to search open tabs, bookmarks, history, and browser actions from one place. Works naturally whether you prefer a mouse, trackpad, or keyboard.

1. One Search Box for Everything
• Tabs, bookmarks, and history together: Switch to an open tab, or open bookmarks and history (Enter here, Command+Enter / Alt+Enter in a new tab).
• Search naturally: Type everyday words like “new tab”, “reopen”, “downloads”, “extensions”, or “dark mode” in English, Chinese, or pinyin. No command prefixes required.
• Remembers your choices: Frequently picked items move up in search, and you can clear any learned ranking with one click.

2. Switch Recent Tabs Like Alt+Tab
• Hold and release: Hold Control+J (Ctrl+, on Windows/Linux, or set up Ctrl+Tab with the built-in guide) to flip through tabs in order of recent use.
• Type to filter anytime: Click the search box or press Command+F while cycling to release the keys and filter by title or URL.

3. Clean Up Tabs Without Losing Your Flow
• Tidy multiple tabs in a row (Right-click / Command+K): Pin, mute, bookmark, copy links, or close tabs. The panel stays open and selects the next item so you can clean up several tabs in one go.
• Tuck inactive tabs away: Slide tabs you do not need right now into a collapsed group without closing them. You can also turn on auto-tuck when idle.

100% Local & Private: No accounts, no backend servers, and no telemetry. Everything runs locally in your browser.
```

---

## 2. 中文商店文案

### 名称（可直接复制）
```text
小范围瞬移
```

### 简介（可直接复制）
```text
Human-first，Chrome-native。在一个搜索框里找齐标签页、书签、历史与常用操作。
```

### 详细介绍（可直接复制）
```text
Human-first，Chrome-native 的命令面板。

按 ⌘Shift+P（Windows/Linux 为 Ctrl+Shift+P）或点击工具栏图标，在一个搜索框里找齐已打开的标签页、书签、浏览历史和常用操作。用鼠标还是键盘都一样顺手。

1. 一个搜索框，找齐所有内容
• 标签页、书签与历史同框：切到已打开的标签页，或者直接打开书签和历史记录（Enter 当前页打开，⌘Enter / Alt+Enter 新标签页打开）。
• 直接打字，不用记前缀：支持中英文或拼音，直接搜“新建标签”“恢复标签”“下载”“扩展”或“深色模式”。
• 记住习惯：常用的结果会排在更前面，也可以随时一键清除记忆。

2. Alt+Tab 式切最近标签
• 按住选、松手即切：按住 Control+J（Windows/Linux 为 Ctrl+,，也可以按向导设为 Ctrl+Tab），按最近使用顺序翻选标签页。
• 随时打字筛选：切标签时点一下搜索框或按 ⌘F，就能松开按键，打字搜标题或网址。

3. 顺手整理标签页
• 连续整理不打断（右键 / ⌘K）：固定、静音、收藏、复制链接或关闭标签。关闭或固定后，面板不会消失，还会自动选到下一项。
• 暂时不看的页面先收起来：把用不到的网页放进折叠标签组，不用关掉网页，也能让标签栏变清爽。支持空闲时自动收起。

100% 本地运行：没有账号，没有后台服务器，也不收集任何使用数据。
```

---

## 3. 审核后台：权限与单一用途声明

### 单一用途说明 (Single Purpose)

#### English (Paste-ready)
```text
Provide a local command palette for finding and acting on browser content: search and switch between tabs, bookmarks, and history; organize native tab groups; and run current-page and browser actions. Current-page tools also include a read-only website storage viewer opened explicitly by the user.
```

#### 中文对照
```text
通过一个本地命令面板查找和操作浏览器中的内容：搜索与切换标签页、书签和历史，整理原生标签组，执行当前页面及浏览器操作；当前页面工具还提供用户主动触发的只读网站存储查看。
```

### 权限正当性声明 (Permission Justifications)

| Manifest 权限 | Justification (Paste-ready in CWS Console) |
| --- | --- |
| `activeTab` | Temporarily access the active page after the user invokes the extension, to open the command palette and inspect that page's top-level Local Storage or Session Storage on request. |
| `contextMenus` | Provide Help and keyboard shortcut settings from the extension toolbar icon's context menu. |
| `cookies` | Read cookies matching the current page URL when the user explicitly opens the read-only cookie viewer. Reading also requires applicable website access. Cookie values are never persisted by the extension or uploaded to the developer. |
| `scripting` | Inject the packaged command palette into the user-selected page and run packaged functions to read its top-level Local Storage or Session Storage when requested. No remote scripts are executed. |
| `tabs` | Read tab titles, URLs, and state to search and switch tabs, and carry out requested tab actions such as pinning, muting, closing, and tucking. |
| `bookmarks` | Search the user's bookmark titles, URLs, and folders, and create or remove native bookmarks when the user requests those actions. |
| `history` | Query recent history and user-requested full-history searches to find pages. The extension does not persist a copy of the entire history database or modify it. Successful selections may contribute a search term and URL to local ranking records. |
| `sessions` | Restore the most recently closed tab or window when requested by the user. |
| `storage` | Store preferences (including a custom search icon), local ranking and query-completion records, and tuck timing/recovery records. Session storage holds temporary panel/tuck state and a per-window Continue Search query, target, and timestamp. No chrome.storage.sync is used. |
| `favicon` | Display site icons using Chrome's native favicon interface without any third-party icon service. |
| `tabGroups` | Display and manage native Chrome tab groups and move tabs into or out of collapsed groups for manual tucking and optional Auto Tuck. |
| `alarms` | Schedule Auto Tuck scans and cleanup retries, and periodically synchronize the toolbar icon with the system color scheme. |
| `idle` | Check whether the computer is idle before running automatic tab tucking, avoiding automatic changes while the user is active. |
| `offscreen` | Run a packaged local page that reads the system light/dark preference through matchMedia so the toolbar icon can follow system appearance even when the palette is closed. |

### 广泛网页匹配与可选网站权限声明 (Broad Host & Optional Permissions)

#### English (Paste-ready)
```text
The packaged recent-keys.js content script runs at document_start in HTTP/HTTPS pages and their subframes where Chrome allows access. It tracks Control/Meta/Alt modifier state and reports modifier release during recent-tab switching. Subframe coverage allows release detection when focus is inside a frame. It does not record typed text, input field contents, or page contents, and does not persist or upload keyboard events.

The optional host permission declaration allows the user to grant specific website access needed by the cookie viewer. The extension does not request the entire wildcard range for cookie viewing. When required access is missing, a user click requests exact current and ancestor hosts up to the registrable domain, covering HTTP/HTTPS and all paths, without wildcard sibling subdomains. This is website access, not a cookie-only permission. Existing applicable grants may mean no additional prompt is needed. Users can revoke website access in Chrome settings.
```

### 远程代码合规声明 (Remote Code Policy)

#### English (Paste-ready)
```text
The extension does not load or execute remotely hosted code. JavaScript and dependencies are bundled in the extension package. Google search and other URL actions navigate browser tabs to websites at the user's request; they do not load remote code into the extension.
```

### 数据安全申报准则 (Data Safety Questionnaire)

按后台当前字段定义申报以下实际处理范围；不得将“仅本地处理”写成“不处理数据”。出售、无关用途、信用评估通常为合规声明复选框，按实际文字确认，不假定存在 Yes/No 字段。参见 [官方隐私字段说明](https://developer.chrome.com/docs/webstore/cws-dashboard-privacy) 与 [本地处理披露要求](https://developer.chrome.com/docs/webstore/program-policies/user-data-faq)。

当前后台数据类别勾选为 **Personally identifiable information、Authentication information、Web history、User activity、Website content**。本地网页存储可能包含姓名、邮箱或认证 Token；扩展仅在用户主动打开查看器时只读展示，不向开发者上传。标签页、历史与本地查询记录用于检索、排序和补全；快捷键桥接仅处理修饰键状态。其余健康、财务、通信、位置类别未主动处理为独立功能，未勾选。

后台三项既有声明均已勾选：不在允许用途之外出售或转移数据；不用于与单一用途无关的目的；不用于信用或贷款用途。后台没有单独的 `App functionality` 用途选择器或广告 Yes/No 字段；以当前页面字段为准，不套用其他商店问卷。

---

## 4. 审核员测试指引 (Reviewer Instructions)

后台 **Additional instructions** 上限为 500 字符，使用以下摘要：

```text
No login needed. Chrome 127+. Use a test profile and HTTPS tabs. Open the toolbar palette; search tabs, bookmarks, history or Chinese pinyin. Right-click results for actions. Search "tab switcher", "settings", "local storage", "session storage" or "cookie"; grant site access only for test data. Restricted Chrome pages open a companion window. After opening search results, try prefix completion and Continue Search within 10 minutes. Auto Tuck is off by default.
```

以下完整步骤供本地审核对照，不直接粘贴到 500 字符字段：

```text
No account, sign-in, subscription, license key, or test credentials are required. Use Chrome 127 or later. All extension features run locally on the client.

1. Unified Search & Quick Navigation:
Open 3-4 ordinary HTTPS websites in a Chrome window. Click the JustOneHop toolbar icon (or press Command+Shift+P on macOS / Ctrl+Shift+P on Windows/Linux). Type a word from an open tab's title (or Chinese pinyin/initials if testing Chinese titles) and press Enter to switch to it immediately.

2. Bookmark & History Search:
Bookmark one of your test pages. Summon the palette again and search for it to see the native bookmark result. Type "history" to test the 7-day and full-history search views.

3. Continuous Tab Actions (Command+K / Right-Click):
In the search results, right-click any tab or press Command+K (Ctrl+K) to open the action menu. Try pinning/unpinning, muting, bookmarking, or copying the URL. The palette keeps the selected item for organizing actions; removing a result selects an adjacent item so you can continue tidying tabs in a row.

4. Tab Switcher (Alt+Tab style):
Search for "tab switcher" in the palette, or use the default shortcut (Control+J on macOS / Ctrl+, on Windows/Linux). Hold the modifier key, tap through recent tabs in MRU order, and release the modifier to switch. Alternatively, click the search bar or press Command+F to filter tabs on the fly.

5. Tab Groups & Tab Tucking:
With an unpinned tab active, summon the palette and search for "tuck tab". The tab is moved into a collapsed native Chrome Tab Group ("Tuck Away") without closing the page. Type "undo tuck" to restore it.

6. Read-Only Site Storage & Cookie Inspector:
On an ordinary HTTPS website, summon the palette and search for "local storage", "session storage", or "cookie". The viewer renders keys on the left and formatted JSON values on the right. Press Enter to copy the raw value. If cookie access is missing, click the explicit grant button to trigger Chrome's host permission dialog. All data is read-only and processed solely in memory.

7. Standalone Window Fallback:
Navigate to a restricted page such as chrome://extensions or chrome://settings and summon the palette. JustOneHop automatically opens in a lightweight companion window positioned relative to the source browser window.

8. Local Query Completion, Continue Search & Custom Appearance:
After successfully opening results from a query, type a prefix of that query and accept the local completion hint with Tab or the footer button. A qualifying page search with at least two distinct available pages can also be continued within 10 minutes in the same window. Search "settings" to explore Appearance, Keyboard, Labs, and Help; open "Hop Badge" to customize the search bar icon with an Emoji or local PNG/JPEG/WebP, or use "Reset search ranking" in Labs to clear local search records. Nothing is uploaded off-device.

Support & review contact: liangyida42@gmail.com (developer: lyyourc).
```

---

## 5. 本地打包与发布检查清单

### 版本与上架状态

**补丁版本 `0.3.1`（2026-10-27）：** 修复来源页面地址变化导致的历史搜索读取失败，权限与数据处理范围不变。发布文件使用 `0.3.1`，tag 为 `v0.3.1`，商店包为 `justonehop-0.3.1.zip`；完整类型检查、422 项单测和 126 项浏览器用例均已通过，无失败或跳过；ZIP 已与受测构建逐文件核对。GitHub 版本为 `v0.3.1`，具体发布记录见 [Release](https://github.com/lyyourc/JustOneHop/releases/tag/v0.3.1)。该版本已于 2026-10-27 提交 Chrome Web Store，后台状态为 `Pending review`，已选择审核通过后自动发布；以下 `0.3.0` 上架记录作为已发布版本的历史状态保留。

**已公开的商店版本：`0.3.0` 已通过 Chrome Web Store 审核并公开上架。** 功能已冻结，沿用原标记 1.0.0 构建的完整自动化验证；0.3.0 仅修改版本元数据，其余包内文件逐字节一致，已通过打包校验（2026-10-24）。 本次准备已完成 `justonehop-0.3.0.zip` 及其逐文件审计（见 `releases/justonehop-0.3.0-package-audit.json` 与 `releases/justonehop-0.3.0-notes.md`），已于 2026-10-24 发布 GitHub Release（`v0.3.0`）并提交 Chrome Web Store 审核，2026-10-26 确认后台状态为 `Published`，并明确显示已向公众开放。[商店安装入口](https://chromewebstore.google.com/detail/mbofggnjaoneioopfbpheapgphmkclbo)。发布范围为 Public / All regions / Free，当前分类为 Tools。

`package.json`、`package-lock.json`（顶层及根包）和 `public/manifest.json` 统一使用三段数字版本 `0.3.1`；Git tag 与 GitHub Release 使用 `v0.3.1`，发布包附件名为 `justonehop-0.3.1.zip`。后续新增功能递增次版本，修复递增补丁版本。上传前核对后台已有版本；待上传版本必须高于已发布版本。本次上传前原草稿为 0.1.0，彼时无已发布版本；当前已发布版本为 0.3.0。

[CHANGELOG](../CHANGELOG.md) 按版本维护用户可见变化。准备中的版本标记 `Unreleased`；正式发布时改为发布日期（`YYYY-MM-DD`）。GitHub Release 与 Chrome Web Store 审核状态相互独立：只有后台审核通过并公开可访问后，才将商店状态标记为已上线。

### 准备与验证

1. 在发布分支收齐版本文件、CHANGELOG 与商店文档，提交为发布候选。
2. 安装锁定依赖（`npm ci`），执行 `npm run release:check`，校验版本格式、版本文件一致性及 CHANGELOG 条目。
3. 对发布候选按 [测试指南](TESTING.md#正式发版验证) 执行 `npm run check`，覆盖类型检查、完整单元测试、构建和全量浏览器 E2E。
4. 全量通过后冻结发布内容，保留受测 commit、验证报告和 dist 哈希。后续仅涉及文档或商店宣传图更新、未引入运行代码与构建输入变化时，核对产物哈希一致后沿用全量验证证据。
5. 从已验证的 `dist/` 生成并核对 `releases/justonehop-0.3.0.zip`。

### 生成发布 ZIP

发布验证已生成且核对未变化的 `dist/` 时，直接打包，避免再次构建：

```sh
npm run release:check
npx tsx scripts/package-store.ts
```

尚无已验证产物时，可在仓库根目录执行以下命令构建并打包；该命令本身不构成全量验证：

```sh
npm run package:store
```

该命令会自动：
1. 检查源码版本与 CHANGELOG 一致；
2. 运行完整构建（`npm run build`）；
3. 提取 `dist/` 中的发布文件，严格剔除 `*.map` 源映射文件与代码末尾的 `sourceMappingURL` 注释；
4. 将 `manifest.json` 放置于 ZIP 根目录，在 `releases/` 目录下生成 `justonehop-<version>.zip`；
5. 执行 ZIP 包完整性校验。

### Git tag 与 GitHub Release

以下以 `0.3.0` 为例，仅在发布提交已审阅、工作区干净且验证完成后执行：

```sh
npm run release:check -- v0.3.0
npx tsx scripts/package-store.ts
unzip -p releases/justonehop-0.3.0.zip manifest.json
shasum -a 256 releases/justonehop-0.3.0.zip
git tag -a v0.3.0 -m "JustOneHop 0.3.0"
git push origin HEAD
git push origin v0.3.0
```

等待该提交／tag 的 Validate CI 通过后创建 Release：

```sh
gh release create v0.3.0 releases/justonehop-0.3.0.zip \
  --verify-tag --draft --title "JustOneHop 0.3.0" \
  --notes-file releases/justonehop-0.3.0-notes.md
gh release view v0.3.0
gh release edit v0.3.0 --draft=false
```

GitHub 自动生成的源码归档不是商店上传包；商店提审务必上传 `releases/justonehop-0.3.0.zip`。

### 商店发布状态（2026-10-26 确认）

- [x] 上传 `releases/justonehop-0.3.0.zip`；SHA-256 为 `f7f82eb5a7dfea6c3007ab91998844fdc6c7011cee1513e902d8c79796ca2a0b`，后台包版本确认为 `0.3.0`。
- [x] 英文、简体中文介绍已保存；`zh-TW` 条目沿用简体中文并明确说明，未声称提供繁体翻译。
- [x] 全局英文 5 张截图、`zh-CN` 本地化 5 张截图及两张共用宣传图已上传；保留现有商店图标。
- [x] 单一用途、14 项权限理由及广泛主机用途已核对；更新 storage 说明以覆盖图标、补全及继续搜索，保留无远程代码声明及实际数据类别披露。
- [x] 审核员说明已更新为 464 字符；后台限制为 500 字符。
- [x] 公开中英文隐私政策已同步至 0.3.0 的数据处理范围（GitHub main 提交 `def2f24bb274a0cf0f0beb58f1778cb9e7a1476e`）；隐私和使用指南可匿名访问。
- [x] 2026-10-24 提交审核，选择审核通过后自动发布。
- [x] 2026-10-26 确认后台为 **Published**，并显示已向公众开放；[商店入口](https://chromewebstore.google.com/detail/mbofggnjaoneioopfbpheapgphmkclbo)。
- [ ] 可选：从商店安装后核对扩展版本及基本操作；本次未新增商店安装实测。

当前已正式上架。提交时凭证与包审计保存在本地 `releases/`，保留历史送审状态。
