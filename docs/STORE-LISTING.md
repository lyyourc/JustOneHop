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
A human-first command palette for Chrome. Search tabs, bookmarks, and history, and run actions naturally with keyboard or mouse.
```

### Detailed Description (Paste-ready)
```text
When dozens of tabs pile up and bookmarks or browsing history live in separate menus, finding what you need shouldn’t mean squinting at tiny tab titles. JustOneHop brings a fast, Chrome-native command palette to your browser—letting you search open tabs, bookmarks, history, tab groups, and everyday browser actions from a single box.

Click the toolbar icon or press Command+Shift+P on macOS (Ctrl+Shift+P on Windows/Linux). Every workflow is designed Human First: whether you prefer mouse clicking, keyboard shortcuts, trackpad gestures, or switching between them mid-flow, there are no cryptic prefixes or command modes to memorize.

1. One Search Box for Everything
• Tabs, Bookmarks & History Together: Search open tabs in the current window, saved bookmarks, and recent 7-day history at once—or expand to Search All History with one click.
• Plain-Language Browser Actions: Type everyday words like “new tab”, “reopen closed tab”, “downloads”, “extensions”, “passwords”, or “dark mode” to run commands or jump to Chrome pages (automatically switching to an existing tab instead of opening duplicates).
• Bilingual & Chinese Pinyin Search: Find Chinese titles and commands using full pinyin, initials, or mixed Chinese/English queries across tabs, bookmarks, actions, and the latest 1,000 history pages in your selected time range (use literal text for older history).
• Smart Query Completion & Continue Search: Accept inline suggestions from your past local searches with Tab, the right arrow, or the footer button. If you opened a page from a multi-result search, reopen the palette in the same window within 10 minutes to continue that search right where you left off.
• Predictable Local Ranking: True relevance always comes first. Frequently chosen items move up smoothly within their relevance tier, show a clear learned-ranking badge, and can be forgotten anytime with one click or Shift+Backspace.

2. Switch Recent Tabs Like Alt+Tab
• Most-Recently-Used (MRU) Order: Open the built-in Tab Switcher (Control+J on macOS / Ctrl+, on Windows & Linux) to cycle through open tabs in the exact order you viewed them.
• Hold & Release, or Type to Filter: Hold the modifier key and release to jump immediately, or click the search bar / press Command+F (Ctrl+F) mid-switch to filter tabs by title, domain, or pinyin.
• Ctrl+Tab Setup Guide: Prefer Ctrl+Tab? Follow the built-in step-by-step setup wizard in Settings.

3. Tidy Tabs & Tab Groups Without Losing Your Place
• Continuous Tab Actions (Command+K / Right-Click): Copy a URL, pin or unpin, mute, reload, add or remove a bookmark (Command+D), move to a group, or close any tab right from the results list. Most organizing actions keep the panel open and preserve or advance selection to the adjacent item, so you can clean up multiple tabs in a row.
• Native Chrome Tab Groups: Search any tab group by name to inspect its tabs, expand or collapse, rename, ungroup while keeping pages open, or close the entire group with a clear confirmation dialog (pinned tabs stay protected).
• Tuck Tabs Away (Declutter Without Closing): Move tabs you don’t need right now into the native collapsed group “Tuck Away” without closing pages. Search for a page to bring it back, or undo the latest batch. Optional Auto Tuck in Settings → Labs tidies inactive tabs while your computer is idle or after Chrome has remained unfocused for 30 minutes, preserving original tab order across batches.

4. Built-in Developer Tools & Personalization
• Read-Only Site Storage & Cookie Viewer: Search “local storage”, “session storage”, or “cookies” to inspect keys, formatted JSON values, and cookie attributes side by side without opening heavy DevTools. Press Enter to copy the raw value. Cookie access is requested strictly per site.
• Make It Yours: Follow system Light/Dark mode or choose a theme manually, customize your Hop Badge (search bar icon) with an Emoji or local image, and toggle footer keyboard hints via the companion pet control. All settings are organized into Appearance, Keyboard, Labs, and Help, and are searchable from the top bar.

5. 100% Local & Private by Design
• Zero Telemetry, Zero Cloud: All tab, bookmark, and history searches run locally on your device—no account, developer server, analytics, or tracking. Opening a URL or choosing Google Search navigates your browser to that website.
• Transparent On-Device Storage: Preferences, custom icons, and search records stay on your device and are never synced to the cloud. Ranking and completion share up to 2,000 local records, which may include search terms and full URLs. Use “Reset search ranking” in Settings to clear learned rankings, completion history, and Continue Search hints at once.
• In-Memory Storage Inspection: Site storage and cookie values are read only in memory while viewing; copied values are placed on your system clipboard. See the linked Privacy Policy for full details.

How It Runs in Chrome:
Regular webpages use a centered in-page overlay; restricted pages where Chrome blocks content scripts (such as chrome:// pages or the Chrome Web Store) automatically open in a lightweight companion window anchored to the source browser window. Shortcuts can be customized in chrome://extensions/shortcuts.
```

---

## 2. 中文商店文案

### 名称（可直接复制）
```text
小范围瞬移
```

### 简介（可直接复制，49 字符）
```text
一个让日常浏览器操作更顺手的命令面板。轻松搜索标签页、书签与历史，随时用快捷键或鼠标执行常用操作。
```

### 详细介绍（可直接复制）
```text
网页开多了，想切回刚才看的页面总要在密密麻麻的标签栏里找半天？书签、历史记录和常用设置又散落在不同菜单？「小范围瞬移（JustOneHop）」为 Chrome 提供一个贴合原生视觉与直觉手感的命令面板，让你在一个搜索框里同时找齐已打开的标签页、书签、浏览历史、标签组和常用操作。

点击工具栏图标，或按下 ⌘Shift+P（Windows/Linux 为 Ctrl+Shift+P）即可唤起。无论是习惯键盘快捷键、偏爱鼠标点选与触控板手势，还是在日常操作中随时混用，都不需要背诵任何隐晦的搜索前缀或命令语法。

1. 一个搜索框，瞬移至任何内容
• 标签页、书签与历史一体检索：同时检索当前窗口已打开的标签页、收藏夹书签与最近 7 天浏览历史，也可一键展开「搜索全部历史」。
• 日常中英文口语直达命令：直接输入“新建标签页”“恢复关闭的标签页”“历史记录”“下载”“扩展”“深色模式”或“new tab”“downloads”“settings”即可执行；若目标内置页已打开则自动切换激活，不重复多开。
• 中文拼音与中英混输：支持全拼、首字母及中英文混合搜索。历史拼音匹配覆盖所选时间范围最近 1000 个页面，更早的页面可用中文原文查找。
• 本机查询补全与「继续搜索」：根据本机成功搜索提供输入前缀补全，支持按 Tab、右方向键或点击底栏按钮接受。通过主搜索从多个结果中打开页面后，同窗口 10 分钟内重新打开面板还可继续最近一次页面搜索。
• 可解释的本地学习排序：搜索相关性始终优先，常用结果仅在同级内自然前移；右侧展示学习标记与推荐原因，可随时点击 × 或按 Shift+Backspace 单条遗忘。

2. 像 Alt+Tab 一样切换最近标签页（Tab Switcher）
• 按最近访问顺序（MRU）排列：内置最近标签切换器（macOS 默认 Control+J，Windows/Linux 默认 Ctrl+,），按住修饰键点按即选、松手立刻切回刚才看的网页。
• 配置专属 Ctrl+Tab：内置可视化配置向导，按向导复制脚本，在 Chrome 快捷键设置页的开发者工具 Console 中执行，以配置 Ctrl+Tab 与反向切换绑定。
• 切换途中随时打字筛选：切换时点击顶部搜索框或按 ⌘F（Ctrl+F），即可松开按键，输入标题、域名或拼音快速缩小范围。

3. 连续整理标签页与「收起来」减负
• 右键或按 ⌘K 连续整理：在标签页结果上打开操作菜单，即可复制链接、固定／取消固定、静音、刷新、添加或移除书签（⌘D）、移入分组或关闭标签页。多数整理操作后面板保持打开并保留所选项；移除结果后自动选中相邻项，方便一口气连续整理多个页面。
• 原生标签组管理：直接搜索组名进入成员列表，支持展开／折叠、重命名、解散分组（保留所有页面）或安全关闭整个分组（固定标签页始终受保护）。
• 标签收起（Tab Tucking）：把暂时不看的页面移入 Chrome 原生折叠组「收起来」，不关闭网页。搜索页面即可找回，也可一键撤销最近一批收起。在「设置 → 实验室」开启自动收起后，当电脑空闲或 Chrome 连续失焦 30 分钟时会自动整理久未访问的标签页，并跨批次保持原有的左右顺序。

4. 开发者利器与个性化外观
• 免开 DevTools 查看网站存储：输入“local storage”“session storage”或“cookie”，直接在双栏视图中左侧检索键名、右侧预览格式化 JSON 与 Cookie 属性，按回车一键复制原始值；读取 Cookie 时仅按当前站点独立申请授权。
• 定制「瞬移徽章」与分类设置：深浅色外观可跟随系统或手动切换，支持用 Emoji 或本地图片打造专属搜索栏瞬移徽章；设置按「外观、键盘、实验室、使用帮助」分类并支持全局搜索，点击底栏宠物可随时展开或隐藏键盘提示。

5. 100% 本地运行与隐私保护
• 零账号、零服务端、零遥测：标签页、书签和历史检索全部在本机完成，绝不向开发者收集或上传浏览数据。主动执行 Google 搜索或打开网址时，浏览器会直接访问相应网站。
• 本地数据透明可控：偏好、瞬移徽章和搜索记录仅保存在本机，不通过云端同步。排序与补全共用最多 2000 条记录，可能包含搜索词和完整网址。设置中的「重置搜索排序」可同时清除排序习惯、补全历史与继续搜索提示。
• 内存级只读查看：网站存储查看器中的内容仅在当前面板内存中只读展示，不写入持久存储；你主动复制的内容会进入系统剪贴板。完整说明请参阅隐私政策链接。

使用说明：
普通网页以居中偏上浮层展示；在 Chrome 内置页、应用商店等限制脚本注入的页面会自动切换为相对来源浏览器窗口定位的独立伴侣窗口。支持按 Esc、点击顶部返回徽章、空搜索框按 Backspace 或 macOS 触控板双指右滑逐层返回。
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

**补丁候选 `0.3.1`（2026-10-27）：** 修复来源页面地址变化导致的历史搜索读取失败，权限与数据处理范围不变。发布文件使用 `0.3.1`，tag 为 `v0.3.1`，商店包为 `justonehop-0.3.1.zip`；待完成当前候选的全量验证与包校验。该版本尚未提交 Chrome Web Store，以下 `0.3.0` 上架记录作为已发布版本的历史状态保留。

**当前阶段：`0.3.0` 已通过 Chrome Web Store 审核并公开上架。** 功能已冻结，沿用原标记 1.0.0 构建的完整自动化验证；0.3.0 仅修改版本元数据，其余包内文件逐字节一致，已通过打包校验（2026-10-24）。 本次准备已完成 `justonehop-0.3.0.zip` 及其逐文件审计（见 `releases/justonehop-0.3.0-package-audit.json` 与 `releases/justonehop-0.3.0-notes.md`），已于 2026-10-24 发布 GitHub Release（`v0.3.0`）并提交 Chrome Web Store 审核，2026-10-26 确认后台状态为 `Published`，并明确显示已向公众开放。[商店安装入口](https://chromewebstore.google.com/detail/mbofggnjaoneioopfbpheapgphmkclbo)。发布范围为 Public / All regions / Free，当前分类为 Tools。

`package.json`、`package-lock.json`（顶层及根包）和 `public/manifest.json` 当前候选统一使用三段数字版本 `0.3.1`；Git tag 与 GitHub Release 使用 `v0.3.1`，发布包附件名为 `justonehop-0.3.1.zip`。后续新增功能递增次版本，修复递增补丁版本。上传前核对后台已有版本；待上传版本必须高于已发布版本。本次上传前原草稿为 0.1.0，彼时无已发布版本；当前已发布版本为 0.3.0。

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
