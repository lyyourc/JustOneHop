# Chrome Web Store 发布文案

适用版本：0.1.0。中文与英文商店介绍对应相同功能。简介与语言包的 `extensionDescription` 严格保持一致；下面各个“可直接粘贴”区块只包含对应字段的正文。

配套素材：[中英文截图与宣传图](store/README.md) · [整套图片预览](store/contact-sheet.png)。

## 发布前待填写

- 已确认开发者：`lyyourc`；隐私咨询与支持邮箱：`liangyida42@gmail.com`。已同步到[中文隐私政策](PRIVACY.md)和[英文隐私政策](PRIVACY.en.md)。这不代表商店开发者账户已注册或邮箱已验证。
- 政策生效日期：在实际公开发布时填写，并移除两份政策的草稿提示。
- 公开隐私政策 URL：公开政策后填写，必须无需登录即可访问；本地 Markdown 路径不能作为后台 URL。可直接使用公开 GitHub 仓库中政策 Markdown 的网页链接，无需额外搭建 GitHub Pages，也可使用其他公开网站。
- 支持页面 URL：后台若要求网页地址，使用公开仓库的使用指南或已启用的 Issues 页面；不要把邮箱或 `mailto:` 当成 HTTPS 页面地址。当前没有已确认的仓库／网站地址，先保留待填。
- 完成后台数据使用勾选、单一用途／权限声明、分类、语言、分发地区和可见性设置；建议分类为 Productivity，按实际目标地区填写分发范围。本文提供事实依据，不代替已完成申报或审核通过的证明。
- 截图按语言上传；小宣传图与大宣传图不支持本地化，所有语言共用英文 `promo-*`，见[图片上传清单](store/README.md)。
- 提交前重新构建并核对 ZIP：版本、各语言简介、Manifest 引用文件与所测构建一致，`manifest.json` 必须位于 ZIP 根目录。商店图片与政策文档单独发布，不打入扩展包。

### 公开链接与后台填写

如果使用公开 GitHub 仓库，在文件页面复制实际地址；以下仅是地址结构示例，不是已经发布的链接，也不假定开发者名称就是 GitHub 账户名：

```text
隐私政策：https://github.com/<owner>/<repo>/blob/<branch>/docs/PRIVACY.en.md
中文政策：https://github.com/<owner>/<repo>/blob/<branch>/docs/PRIVACY.md
项目首页：https://github.com/<owner>/<repo>
使用帮助：https://github.com/<owner>/<repo>/blob/<branch>/docs/USAGE.md
```

商店隐私政策字段可填写英文版，其顶部已有中文互链。发布后在退出登录或无痕窗口中检查：链接正常显示完整正文、两种语言互链可用、联系邮箱和生效日期正确、没有草稿占位符。若不公开产品源码，可以只公开政策文件；商店需要可访问的政策网页，不要求公开扩展源码。仓库变为私有、重命名或移动文件时，需要同步维护这些链接。

| 后台项目 | 本项目填写依据／剩余操作 |
| --- | --- |
| 开发者联系 | `lyyourc` / `liangyida42@gmail.com`；在后台完成其要求的联系验证 |
| 名称、简介、详细介绍 | 使用下方对应语言区块；默认语言为英文，中文填写到对应语言项 |
| 分类 | 建议选择后台的 Productivity 相关分类 |
| 隐私政策 | 待实际公开后填写网页 URL，不能填写本地路径或占位链接 |
| 单一用途、权限与远程代码 | 使用本文对应段落；无远程托管执行代码 |
| 数据使用 | 结合本文事实依据与后台当时的字段定义填写；不因无开发者上传就一律勾选“不处理数据” |
| 测试账号 | 无需账号、登录、订阅、许可证密钥或测试凭据 |
| 审核操作说明 | 使用下方英文操作步骤 |
| 分发地区、可见性与发布时机 | 由发布者在后台选择；本文不预设全球发布或自动上线 |
| 图片 | 中英文截图分别填写，英文大小宣传图共用，见素材清单 |

### 本地生成发布 ZIP

在仓库根目录运行；如果同名 ZIP 已存在，先另选文件名，避免向旧包追加文件：

```sh
npm run build
mkdir -p releases
test ! -e releases/justonehop-0.1.0.zip && (cd dist && zip -qr ../releases/justonehop-0.1.0.zip .)
unzip -t releases/justonehop-0.1.0.zip
```

ZIP 包含 `dist/` 的文件内容（含构建生成的 source map），不额外嵌套 `dist/` 目录。`releases/` 为本地忽略目录，不提交 Git；版本变化时同步修改文件名。结构检查通过不代表商店审核通过或完整浏览器功能验收。最终提交前仍需确定政策生效日期、填写公开政策地址和后台字段。

---

## 中文商店信息

名称：小范围瞬移

### 简介（可直接粘贴，49 字符）

一个让日常浏览器操作更顺手的命令面板。轻松搜索标签页、书签与历史，随时用快捷键或鼠标执行常用操作。

### 详细介绍（可直接粘贴）

网页开多了，想切回刚才看的页面总要在标签栏里找半天？「小范围瞬移」为 Chrome 提供一个贴合原生视觉与手感的命令面板，让你在一个搜索框里查找标签页、书签、浏览历史和常用操作。

点击工具栏图标，或按 ⌘Shift+P（Windows/Linux 为 Ctrl+Shift+P）即可打开。无论是直接用鼠标点选、习惯键盘快捷键，还是两者混用都很顺手，不需要背诵任何搜索前缀或命令语法。

核心功能：
• 统一搜索标签页、书签与历史记录：同时检索当前窗口已打开的标签页、收藏夹书签与最近 7 天浏览历史，也可一键展开搜索全部历史。
• 像 Alt+Tab 一样切换最近标签页：内置最近标签切换器（Tab Switcher），按最近访问顺序（MRU）排列标签页。支持按住快捷键松手即切，或直接打字按标题、域名筛选。
• 右键或按 ⌘K 连续整理标签页：在任意结果上直接复制链接、固定／取消固定、静音、刷新、添加或移除书签、关闭标签页；执行后面板保持打开并自动选中下一项，方便一次清理多个标签页。
• 日常中英文口语直达命令：直接输入“新建标签页”“恢复关闭的标签页”“历史记录”“下载”“扩展”“深色模式”或“new tab”“downloads”“settings”即可执行，无需输入模式前缀。
• Chrome 原生深浅色外观：界面遵循 Chrome CR2023 设计语言，浅色与深色模式自动跟随系统或手动切换。
• 只读网站存储查看器：输入“local storage”“session storage”或“cookie”，可在分栏视图中查看并复制当前网页的存储键值；读取 Cookie 时仅按当前站点申请权限。

隐私与本地运行：
• 标签页、书签和历史检索在本地完成，无需注册账号，无开发者后端或遥测，不向开发者上传浏览数据。主动执行 Google 搜索或打开网址时，浏览器会访问相应网站。
• 偏好设置与本机搜索排序记录仅保存在你的设备本地（可能包含搜索词与完整网址，不通过云端同步），随时可在设置中一键重置。
• 网站存储查看器中的内容仅在当前面板内存中只读展示，不写入持久存储；你主动复制的内容会进入系统剪贴板。完整说明请参阅隐私政策链接。

使用说明
普通网页以居中浮层展示；在 Chrome 内置页、应用商店等限制脚本注入的页面会自动切换为独立窗口。地址栏持有焦点时，可能需要点击搜索框开始输入。快捷键可在 Chrome 扩展快捷键设置中修改；Ctrl+Tab 切换需按内置说明配置。当前实机测试主要在 macOS 完成，Windows/Linux 尚未完成同等真机覆盖。

---

## English store information

Name: JustOneHop

### Short description (paste-ready, 128 characters)

A human-first command palette for Chrome. Search tabs, bookmarks, and history, and run actions naturally with keyboard or mouse.

### Detailed description (paste-ready)

When you have dozens of tabs open, finding the page you were just looking at shouldn't mean squinting at tiny tab titles. JustOneHop adds a clean, Chrome-native command palette that lets you search open tabs, bookmarks, browsing history, and browser actions in one place.

Click the toolbar icon or press Command+Shift+P on macOS (Ctrl+Shift+P on Windows/Linux). Everything works naturally with the mouse, keyboard shortcuts, or both—without memorizing cryptic prefixes or command modes.

Key features:
• Search tabs, bookmarks & history together: Find open tabs, saved bookmarks, and recent 7-day history from a single search bar, or expand to Search All History with one click.
• Switch recent tabs like Alt+Tab: Open the built-in Tab Switcher to cycle through open tabs in most-recently-used (MRU) order. Hold and release the shortcut to jump, or type anytime to filter by title or domain.
• Tidy tabs without losing your place: Right-click any result or press Command+K to copy the URL, pin, mute, reload, bookmark, or close a tab. The panel stays open and selects the next item so you can clean up several tabs in a row.
• Everyday commands in plain words: Type “new tab”, “reopen closed tab”, “downloads”, “extensions”, “passwords”, or “dark mode” to run browser actions directly—no special prefix required.
• Chrome-native Light & Dark themes: Built around Chrome's CR2023 Omnibox and Tab Search look, automatically matching your system appearance.
• Read-only site storage viewer: Search “local storage”, “session storage”, or “cookies” to inspect and copy keys and formatted JSON for the current page, requesting host permission only for the site you choose to inspect.

Local & private by design:
• Tab, bookmark, and history searches run locally—no account, developer server, telemetry, or tracking. When you choose Google Search or open a URL, your browser connects to the corresponding website.
• Preferences and local ranking records stay on your device (never synced to the cloud) and can be reset anytime in Settings.
• Site storage values are read only in memory while viewing; copied values are placed on your system clipboard. See the linked Privacy Policy for full details.

Usage notes
Regular webpages use a centered in-page overlay; restricted pages where Chrome blocks content scripts (such as chrome:// pages or the Chrome Web Store) automatically open in a standalone window. If the browser address bar holds focus, you may need to click the search input to start typing. Shortcuts can be customized in Chrome's extension shortcut settings; binding Ctrl+Tab uses the built-in setup guide. Current hands-on testing is primarily on macOS; Windows and Linux have not yet received equivalent hardware coverage.

---

## 审核后台：单一用途说明

中文：

通过一个本地命令面板查找和操作浏览器中的内容：搜索与切换标签页、书签和历史，整理原生标签组，执行当前页面及浏览器操作；当前页面工具还提供用户主动触发的只读网站存储查看。

English (paste-ready):

Provide a local command palette for finding and acting on browser content: search and switch between tabs, bookmarks, and history; organize native tab groups; and run current-page and browser actions. Current-page tools also include a read-only website storage viewer opened explicitly by the user.

审核注意：网站存储查看器与导航／标签管理的用途关联仍需审核方判断。此说明完整披露现有功能，不表示单一用途审核已通过，也不能用共用界面替代对功能关联的解释。

## 审核后台：权限用途（英文，可按字段复制）

| Manifest 权限 | Justification |
| --- | --- |
| `activeTab` | Temporarily access the active page after the user invokes the extension, to open the command palette and inspect that page's top-level Local Storage or Session Storage on request. |
| `contextMenus` | Provide Help and keyboard shortcut settings from the extension toolbar icon's context menu. |
| `cookies` | Read cookies matching the current page URL when the user opens the read-only cookie viewer. Reading also requires applicable website access. Cookie values are not persisted by the extension or uploaded to the developer. |
| `scripting` | Inject the packaged command palette into the user-selected page and run packaged functions to read its top-level Local Storage or Session Storage when requested. No remote scripts are executed. |
| `tabs` | Read tab titles, URLs, and state to search and switch tabs, and carry out requested tab actions such as pinning, muting, closing, and tucking. |
| `bookmarks` | Search the user's bookmark titles, URLs, and folders, and create or remove native bookmarks when the user requests those actions. |
| `history` | Query recent history and user-requested full-history searches to find pages. The extension does not persist a copy of the entire history database or modify it. Successful selections may contribute a search term and URL to local ranking records. |
| `sessions` | Restore the most recently closed tab or window when requested by the user. |
| `storage` | Store preferences, search ranking records, and tuck timing/recovery records locally, and keep temporary panel and tuck state in session storage. No chrome.storage.sync is used. |
| `favicon` | Display site icons using Chrome's favicon interface without a third-party icon service. |
| `tabGroups` | Display and manage native Chrome tab groups and move tabs into or out of collapsed groups for manual tucking and optional Auto Tuck. |
| `alarms` | Schedule Auto Tuck scans and cleanup retries, and periodically synchronize the toolbar icon with the system color scheme. |
| `idle` | Check whether the computer is idle before running automatic tab tucking, avoiding automatic changes while the user is active. |
| `offscreen` | Run a packaged local page that reads the system light/dark preference through matchMedia so the toolbar icon can follow system appearance even when the palette is closed. |

### 广泛网页匹配与可选网站权限说明（英文，可直接粘贴）

The packaged recent-keys.js content script runs at document_start in HTTP/HTTPS pages and their subframes where Chrome allows access. It tracks Control/Meta/Alt modifier state and reports modifier release during recent-tab switching. Subframe coverage allows release detection when focus is inside a frame. It does not record typed text, input field contents, or page contents, and does not persist or upload keyboard events.

The optional host permission declaration allows the user to grant specific website access needed by the cookie viewer. The extension does not request the entire wildcard range for cookie viewing. When required access is missing, a user click requests exact current and ancestor hosts up to the registrable domain, covering HTTP/HTTPS and all paths, without wildcard sibling subdomains. This is website access, not a cookie-only permission. Existing applicable grants may mean no additional prompt is needed. Users can revoke website access in Chrome settings.

### 远程代码说明（英文，可直接粘贴）

The extension does not load or execute remotely hosted code. JavaScript and dependencies are bundled in the extension package. Google search and other URL actions navigate browser tabs to websites at the user's request; they do not load remote code into the extension.

### 数据使用申报事实依据

按后台届时对“收集”“使用”和数据类别的定义逐项填写，不因“本地处理”直接推导为所有选项均为否。

- 访问并处理浏览活动：标签标题、网址、书签和历史搜索结果。
- 本地持久记录包含搜索词、目标网址／标识、选择时间，以及收起恢复所需的完整网址。
- 网站存储查看器可能读到个人信息、Cookie、会话标识及认证令牌；不能声明“不接触认证信息”。这些值不持久写入扩展存储，不上传给开发者。
- 快捷键桥接处理修饰键状态，不记录用户普通打字内容。
- 用户主动执行 Google 搜索时，查询通过导航发送给 Google；没有输入时的在线联想请求。
- 无数据出售、广告用途、信用评估、开发者遥测或与所述功能无关的数据使用。
- 联系邮箱、隐私政策 URL、后台申报及实际包行为必须一致；阅读后台认证声明后再勾选。

## 审核后台：操作说明（英文，可直接粘贴）

No account, sign-in, subscription, license key, or test credentials are required. Use Chrome 127 or later. All extension features are available locally; websites opened by the reviewer may have their own access requirements.

1. Open a few ordinary HTTPS pages in one Chrome window. Click the extension toolbar icon to open the command palette. You can also use Command+Shift+P on macOS or Ctrl+Shift+P on Windows/Linux. If a shortcut is already assigned elsewhere, use the toolbar icon or configure it at chrome://extensions/shortcuts.
2. Search for part of an open tab's title or domain and click a result to switch to it. Bookmark one of the test pages using Chrome, then search again to see bookmark results. History results depend on the browsing history in the test profile; the main search covers the last seven days and offers Search All History. An empty profile may have no bookmark or history matches.
3. Right-click a tab result to open its action menu. Try copying its URL, pinning/unpinning it, or adding/removing its bookmark. Available actions depend on the selected result. Use disposable test tabs for close actions; pinned tabs are protected.
4. Search for "tab switcher" in the main palette and open it. Type a title or domain to filter recent tabs, then click a result or press Enter to switch. This path does not require holding a modifier key or changing system keyboard settings.
5. Search for "settings" to change language or appearance and inspect the search-ranking reset control. Search selections can create local ranking records; resetting them does not revoke website permissions or clear all other extension data.
6. On an ordinary HTTPS page, search for "local storage", "session storage", or "cookie" and open the matching viewer. An empty list is expected when the page has no applicable values. Local Storage and Session Storage are limited to the top-level page. If cookie access is missing, follow the explicit website-access button and Chrome permission prompt. The requested hosts can include the current host and necessary parent hosts. Values are read-only; copying a value places it on the system clipboard. Please use a test page/profile without personal credentials when inspecting storage.
7. To inspect native tab-group management, search for "tuck tab" on a disposable, unpinned tab. The tab moves into a collapsed native group; it is not closed or discarded. Search for "undo tuck" to undo the latest batch. Auto Tuck is optional, off by default, and uses a seven-day inactivity threshold plus idle checks; it is not expected to run immediately during a short review.
8. On restricted pages such as chrome:// pages or the Chrome Web Store, the palette opens in a standalone extension window. If the browser address bar retains focus, click the palette's search field. macOS has received the primary hands-on coverage; equivalent Windows/Linux hardware coverage has not been completed.

The extension has no developer backend or telemetry. Searches of tabs, bookmarks, and history run locally. Executing Google Search or opening a website explicitly navigates the browser to that external destination. Website storage values are not persisted by the extension or uploaded to the developer. See the supplied privacy policy for local ranking and group-recovery retention details.

Support and review contact: liangyida42@gmail.com (developer: lyyourc).

## 文案边界与参考

不使用“完全不保存浏览数据”“所有权限都按需申请”“90 天后彻底自动删除”“收起释放内存”或“所有平台已全面验证”等表述。图片、公开政策部署和后台实际填写仍是独立发布步骤。

- [简介长度上限](https://developer.chrome.com/docs/extensions/reference/manifest/description)：132 字符。
- [隐私政策 FAQ](https://developer.chrome.com/docs/webstore/program-policies/user-data-faq)：本地处理用户数据也需要政策。
- [隐私字段说明](https://developer.chrome.com/docs/webstore/cws-dashboard-privacy)。
- [单一用途说明](https://developer.chrome.com/docs/webstore/program-policies/quality-guidelines-faq)。
