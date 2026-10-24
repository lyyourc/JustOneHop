# Chrome Web Store 发布与审核指南

[English Listing](#1-english-store-listing) · [中文发布文案](#2-中文商店文案) · [权限与用途申明](#3-审核后台权限与单一用途声明) · [审核员指引](#4-审核员测试指引-reviewer-instructions) · [打包与检查清单](#5-本地打包与发布检查清单)

本文档是 **小范围瞬移 · JustOneHop** 在 Chrome Web Store 上架与版本审核的官方权威参考，整理了中英文商店文案、后台权限与单一用途声明、数据使用申报依据、审核员操作指引（Reviewer Instructions）及发布清单。

---

## 基本信息一览

| 字段 | 填写内容 | 说明 |
| --- | --- | --- |
| **扩展名称 (Name)** | `JustOneHop`（默认语言） / `小范围瞬移`（中文） | 英文首字母大写；中文名统一 |
| **适用版本** | `1.0.0` | 功能冻结，实机反馈修复包已通过全量验证并完成校验；尚未提交商店 |
| **扩展 ID** | `mbofggnjaoneioopfbpheapgphmkclbo` | 商店官方分配唯一标识 |
| **开发者账号** | `lyyourc` | 个人开发者 |
| **支持与隐私邮箱** | `liangyida42@gmail.com` | 已验证联系邮箱 |
| **商店分类** | `Productivity`（效率工具） | 建议分类 |
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
When you have dozens of tabs open, finding the page you were just looking at shouldn't mean squinting at tiny tab titles. JustOneHop adds a clean, Chrome-native command palette that lets you search open tabs, bookmarks, browsing history, and browser actions in one place.

Click the toolbar icon or press Command+Shift+P on macOS (Ctrl+Shift+P on Windows/Linux). Everything works naturally with your mouse, keyboard shortcuts, or both—without memorizing cryptic prefixes or command modes.

Key features:
• Chinese pinyin search: Find Chinese titles with full pinyin or initials, including mixed Chinese/English queries. History pinyin matching covers the latest 1,000 pages in your selected time range; use literal text for older pages.
• Pick up your search: Complete queries from successful local searches using Tab, the right arrow, or the footer button. Continue the latest qualifying page search in the same window within 10 minutes.
• Search tabs, bookmarks & history together: Find open tabs, saved bookmarks, and recent 7-day history from a single search bar, or expand to Search All History with one click.
• Switch recent tabs like Alt+Tab: Open the built-in Tab Switcher to cycle through open tabs in most-recently-used (MRU) order. Hold and release the shortcut to jump, or type anytime to filter by title or domain.
• Tidy tabs without losing your place: Right-click a tab result or press Command+K to copy its URL, pin or unpin, mute, reload, add or remove a bookmark, or close the tab. Most organizing actions keep the panel open and preserve the selected item; when a result is removed, an adjacent item is smoothly selected.
• Manage Chrome Tab Groups: Search, inspect, expand/collapse, rename, ungroup, or close entire native tab groups with clear confirmation dialogs.
• Tuck tabs away: Move tabs into the native collapsed group “Tuck Away” without closing them. Find a page to bring it back, or undo the latest batch. Optional Auto Tuck in Settings → Experimental runs when the computer is idle or Chrome has remained unfocused for 30 minutes.
• Everyday commands in plain words: Type “new tab”, “reopen closed tab”, “downloads”, “extensions”, “passwords”, or “dark mode” to run browser actions directly—no special syntax required.
• Make it your own: Choose Light, Dark, or System appearance, and set an Emoji or local image as your search icon. Settings are searchable by category.
• Read-only site storage viewer: Search “local storage”, “session storage”, or “cookies” to inspect keys and formatted JSON for the current page without opening heavy DevTools. Cookie inspection requests host access strictly per site.

Local & private by design:
• Tab, bookmark, and history searches run locally on your device—no account, developer server, telemetry, or tracking. When you explicitly choose Google Search or open a URL, your browser connects to that website directly.
• Preferences, custom icons, and search records stay on your device and are never synced to the cloud. Ranking and completion share up to 2,000 records, which may include search terms and full URLs. Use a learned result’s forget control or “Reset search ranking” in Settings; reset also clears completion history and Continue Search hints.
• Site storage values are read only in memory while viewing; copied values are placed on your system clipboard. See the linked Privacy Policy for full details.

Usage notes:
Regular webpages use a centered in-page overlay; restricted pages where Chrome blocks content scripts (such as chrome:// pages or the Chrome Web Store) automatically open in a lightweight companion window. Shortcuts can be customized in chrome://extensions/shortcuts; the optional built-in Ctrl+Tab guide explains the extra setup needed for that shortcut.
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
网页开多了，想切回刚才看的页面总要在标签栏里找半天？「小范围瞬移」为 Chrome 提供一个贴合原生视觉与手感的命令面板，让你在一个搜索框里查找标签页、书签、浏览历史和常用操作。

点击工具栏图标，或按 ⌘Shift+P（Windows/Linux 为 Ctrl+Shift+P）即可打开。无论是直接用鼠标点选、习惯键盘快捷键，还是两者混用都很顺手，不需要背诵任何搜索前缀或命令语法。

核心功能：
• 中文拼音检索：支持全拼、首字母及中英文混合搜索。历史拼音匹配覆盖所选时间范围最近 1000 个页面，更早的页面可用中文原文查找。
• 接着上次搜：根据本机成功搜索提供查询补全，支持 Tab、右方向键或底栏按钮接受。同窗口 10 分钟内，还可继续最近一次符合条件的页面搜索。
• 统一搜索标签页、书签与历史记录：同时检索当前窗口已打开的标签页、收藏夹书签与最近 7 天浏览历史，也可一键展开搜索全部历史。
• 像 Alt+Tab 一样切换最近标签页：内置最近标签切换器（Tab Switcher），按最近访问顺序（MRU）排列标签页。支持按住快捷键松手即切，或直接打字按标题、域名筛选。
• 右键或按 ⌘K 连续整理标签页：在标签页结果上打开操作菜单，即可复制链接、固定／取消固定、静音、刷新、添加或移除书签、关闭标签页。整理操作后面板保持打开并保留所选项；移除结果后选择相邻项，方便连续整理多个页面。
• 原生标签组管理：直接搜索组名进入成员列表，支持展开／折叠、重命名、解散分组（保留所有页面）或安全关闭整个分组。
• 标签收起：把暂时不看的页面移入 Chrome 原生折叠组「收起来」，不关闭页面。搜索页面即可找回，也可撤销最近一批收起。在设置 → 实验室开启自动收起后，电脑空闲或 Chrome 连续失焦 30 分钟时可执行整理。
• 日常中英文口语直达命令：直接输入“新建标签页”“恢复关闭的标签页”“历史记录”“下载”“扩展”“深色模式”或“new tab”“downloads”“settings”即可执行，无需输入模式前缀。
• 自定义外观：深浅色可跟随系统或手动切换，支持用 Emoji 或本地图片设置搜索图标；设置按分类组织，并可直接搜索。
• 只读网站存储查看器：输入“local storage”“session storage”或“cookie”，免开 F12 DevTools，直接在双栏视图中格式化查看并复制当前网页的存储键值；读取 Cookie 时仅按当前站点申请授权。

隐私与本地运行：
• 标签页、书签和历史检索全部在本机完成，无需注册账号，无开发者后端或遥测，绝不向开发者上传浏览数据。主动执行 Google 搜索或打开网址时，浏览器会直接访问相应网站。
• 偏好、自定义图标和搜索记录仅保存在本机，不通过云端同步。排序与补全共用最多 2000 条记录，可能包含搜索词和完整网址。可通过已学习结果的遗忘入口或 Shift+Backspace 清除对应记录；设置中的「重置搜索排序」同时清除补全历史与继续搜索提示。
• 网站存储查看器中的内容仅在当前面板内存中只读展示，不写入持久存储；你主动复制的内容会进入系统剪贴板。完整说明请参阅隐私政策链接。

使用说明：
普通网页以居中浮层展示；在 Chrome 内置页、应用商店等限制脚本注入的页面会自动切换为独立窗口。地址栏持有焦点时，点击搜索框即可开始输入。快捷键可在 Chrome 扩展快捷键设置中修改；如需使用 Ctrl+Tab，可按内置指南完成额外配置。
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

在 Chrome Web Store 后台「Data usage / 数据使用」问卷中，务必按照以下事实勾选：

1. **Web History / 网页历史记录**：勾选“处理”，用途说明选择 `App functionality`。声明数据仅在用户本机处理，不传输至任何外部服务器。
2. **User Activity / 用户活动**：勾选“处理”（标签页管理、书签与搜索习惯），用途为 `App functionality`。
3. **Authentication Info / 认证信息**：只读存储查看器（Cookie / SessionStorage）可能展示当前站点的认证 Token，因此按合规要求勾选为“功能需要读取”，并明确说明：*Values are displayed read-only in memory upon explicit user request and never persisted or transferred off-device.*
4. **Data Selling / 数据出售**：勾选 **No**（绝不出售数据）。
5. **Targeted Advertising / 针对性广告**：勾选 **No**（无广告目的）。
6. **Credit Assessment / 信用评估**：勾选 **No**。

---

## 4. 审核员测试指引 (Reviewer Instructions)

在 CWS 后台的 **Instructions for the reviewer** 中直接粘贴以下英文测试指引：

```text
No account, sign-in, subscription, license key, or test credentials are required. Use Chrome 127 or later. All extension features run locally on the client.

1. Quick Navigation:
Open 3-4 ordinary HTTPS websites in a Chrome window. Click the JustOneHop toolbar icon (or press Command+Shift+P on macOS / Ctrl+Shift+P on Windows/Linux). Type a word from an open tab's title and press Enter to switch to it immediately.

2. Bookmark & History Search:
Bookmark one of your test pages. Summon the palette again and search for it to see the native bookmark result. Type "history" to test the 7-day and full-history search capabilities.

3. Continuous Tab Actions:
In the search results, right-click any tab or press Command+K (Ctrl+K) to open the action menu. Try pinning/unpinning, muting, or copying the clean URL. The palette keeps the selected item for organizing actions; removing a result selects an adjacent item so you can continue.

4. Tab Switcher (Alt+Tab style):
Search for "tab switcher" in the palette, or use the default shortcut (Control+J on macOS / Ctrl+, on Windows/Linux). Hold the modifier key, tap through recent tabs, and release the modifier to switch. Alternatively, click the search bar or press Command+F to filter tabs on the fly.

5. Tab Tucking:
With an unpinned tab active, summon the palette and search for "tuck tab". The tab will be safely moved into a collapsed native Chrome Tab Group ("Tuck Away") without closing the page. Type "undo tuck" to restore it.

6. Site Storage & Cookie Inspector:
On an ordinary HTTPS website, summon the palette and search for "local storage", "session storage", or "cookie". The viewer renders keys on the left and formatted JSON values on the right. Press Enter to copy the raw value. If cookie access is missing, click the explicit grant button to trigger Chrome's host permission dialog. All data is read-only and processed solely in memory.

7. Standalone Window Fallback:
Navigate to a restricted page such as chrome://extensions or chrome://settings and summon the palette. JustOneHop automatically opens in a lightweight companion window positioned relative to the source browser window. Ordinary webpage overlays are positioned relative to the page viewport.

8. Local Search Hints and Appearance:
After successfully opening results from a query, type a prefix of that query and accept the local hint with Tab or the footer button. A qualifying page search with at least two distinct available pages can also be continued within 10 minutes in the same window. Reset search ranking in Settings clears these records. Search Settings for the search icon editor, choose an Emoji or local PNG/JPEG/WebP, preview and save; Restore Default removes the custom icon. Nothing is uploaded.

Support & review contact: liangyida42@gmail.com (developer: lyyourc).
```

---

## 5. 本地打包与发布检查清单

### 版本与发布状态

**当前阶段：1.0.0 功能冻结，实机反馈修复包已通过完整自动化验证与包校验（2026-10-24）。** 仅调整发布元数据、事实性披露、商店素材和验证所需修复；新功能移至后续版本。本次不创建远端 Release、不上传或提交商店。CHANGELOG 保留 `Unreleased`；正式发布另行确定日期。商店线上／审核中／草稿版本尚未核对，不能将本地准备状态当作已上线。

`package.json`、`package-lock.json`（顶层及根包）和 `public/manifest.json` 使用相同的三段数字版本，例如 `1.0.0`；Git tag 与 GitHub Release 使用 `v1.0.0`，附件名为 `justonehop-1.0.0.zip`。新增功能递增次版本，修复递增补丁版本；上传版本须高于商店后台已有版本。

[CHANGELOG](../CHANGELOG.md) 按版本维护用户可见变化。准备中的版本标记 `Unreleased`；确定发布时改为 GitHub 发布日期（`YYYY-MM-DD`）。GitHub 发布与商店审核是独立状态：GitHub Release 可先提供下载，说明中明确商店尚未提交、审核中或已上线；只有后台和公开页确认后才标记商店上线。审核期间商店仍显示上一版不属于版本错误。

历史 `0.1.0` 的提交包对应源码尚未确认，不根据 ZIP 修改时间推断 commit，也不把当前 HEAD 补标为 `v0.1.0`。截图采集记录中的版本属于历史证据，不随源码版本批量替换。

### 准备与验证

1. 在发布分支收齐版本文件、CHANGELOG 发布日期与发布文档，提交为发布候选；提交商店前确认后台的已发布、审核中与草稿版本。
2. 安装锁定依赖（`npm ci`），执行 `npm run release:check`。检查会拒绝不兼容 Chrome 的版本、不一致的版本文件或缺失的 CHANGELOG 版本条目；CI 同样执行，tag 构建另核对 tag 名。
3. 对发布候选按 [测试指南](TESTING.md#正式发版验证) 执行 `npm run check`，覆盖类型检查、完整单元测试、构建和全量浏览器 E2E。发布请求即包含全量验证授权；报告失败、跳过与未执行项，失败未解决前停止正式发布，跳过项按测试指南处理。
4. 全量通过后冻结发布内容，保留受测 commit、验证报告和 dist 哈希。后续文档／日期补录、创建 tag 或未引入额外代码变化的合并，按测试指南核对差异与产物后沿用全量证据，不因提交 SHA 变化重复运行。影响行为、产物或测试有效性的变更，按该指南重新确定验证范围。
5. 从已验证的 dist 生成并核对 ZIP，再完成 tag CI 与发布。已发布版本若补验失败，在 Release 显著标记未通过，暂停商店提交；产品修复使用新版本，不移动旧 tag 或替换旧附件。

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

本地打包会替换同版本 ZIP。发布后保留已上传附件，不以重建产物覆盖它；任何产品修订使用新版本。打包从现有 `dist/` 收集文件，最终发布应使用干净检出构建，避免旧构建遗留文件混入。

### Git tag 与 GitHub Release

以下以 `1.0.0` 为例，仅在发布提交已审阅、工作区干净且验证完成后执行：

```sh
npm run release:check -- v1.0.0
npx tsx scripts/package-store.ts
unzip -p releases/justonehop-1.0.0.zip manifest.json
shasum -a 256 releases/justonehop-1.0.0.zip
git tag -a v1.0.0 -m "JustOneHop 1.0.0"
git push origin HEAD
git push origin v1.0.0
```

tag 必须指向与已验证发布产物对应的源码提交；若与受测 commit 不同，须已完成测试指南规定的差异与产物等价核对。已推送 tag 不移动；发布后修订递增版本。等待该提交／tag 的 Validate CI 通过后创建 Release，不额外触发全量 E2E。

准备发布说明文件（例如系统临时目录中的 `justonehop-1.0.0-notes.md`），包含 CHANGELOG 的本版本内容、源码 commit、ZIP SHA-256、实际验证范围和商店状态。先创建草稿检查附件与说明，再发布：

```sh
gh release create v1.0.0 releases/justonehop-1.0.0.zip \
  --verify-tag --draft --title "JustOneHop 1.0.0" \
  --notes-file /tmp/justonehop-1.0.0-notes.md
gh release view v1.0.0
gh release edit v1.0.0 --draft=false
```

GitHub 自动生成的源码归档不是商店上传包；使用附加的 `justonehop-1.0.0.zip`。这些命令是发布步骤，不由本地打包命令自动执行。

### 商店提交与上线确认

- [ ] 核对后台已有版本与提交资格；若上一版仍在审核，先按后台提供的流程处理，再提交新版本。
- [ ] 上传 GitHub Release 中的同一份 ZIP，核对 SHA-256 与包内 manifest 版本，不单独重建另一份商店包。
- [ ] 确认公开仓库的 [Privacy Policy](https://github.com/lyyourc/JustOneHop/blob/main/docs/PRIVACY.en.md) 与 [Usage Guide](https://github.com/lyyourc/JustOneHop/blob/main/docs/USAGE.md) 在隐私窗口下匿名可访问。
- [ ] 按照 [图片清单](store/README.md) 核对中英文截图与宣传图；功能或外观变化时更新对应素材。
- [ ] 检查商店文案、权限声明与英文审核指引；点击「Submit for review」后才将 Release 商店状态标记为审核中。
- [ ] 审核通过并上线后，核对公开页版本与安装后的扩展版本；同步更新 README 中英文安装状态、Release 说明及 [验收记录](ACCEPTANCE.md) 的商店状态行。

商店拒审时保留事实状态并处理原因。若需修改扩展包，递增版本重新走流程，不替换既有 tag 或 Release 附件。
