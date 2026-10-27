# JustOneHop User Guide

English · [简体中文](USAGE.zh-CN.md) · [Back to README](../README.md)

**JustOneHop (小范围瞬移)** is a Chrome-native command palette designed for humans. Whether you prefer keyboard shortcuts, mouse clicks, trackpad gestures, or mixing them mid-flow, you can find pages, switch tabs, and tidy your browser from a single box.

---

## Table of Contents

- [1. Quick Start](#1-quick-start)
- [2. Unified Search: Find Anything in One Hop](#2-unified-search-find-anything-in-one-hop)
- [3. Tab Switcher: Switch Recent Tabs Like Alt+Tab](#3-tab-switcher-recent-tabs-like-vs-code)
- [4. Tab Housekeeping & Quick Actions (`⌘K`)](#4-tab-housekeeping--quick-actions-k)
- [5. Tab Tucking: Declutter without Closing](#5-tab-tucking-declutter-without-closing)
- [6. Developer Inspection: LocalStorage, SessionStorage & Cookies](#6-developer-inspection-localstorage-sessionstorage--cookies)
- [7. Navigation, Gestures & Personalization](#7-navigation-gestures--personalization)
- [8. Keyboard & Mouse Shortcuts](#8-keyboard--mouse-shortcuts)

---

## 1. Quick Start

<a id="使用帮助"></a>

Press the shortcut anywhere in Chrome, or click the JustOneHop icon in your toolbar:

- **macOS**: `⌘ + Shift + P`
- **Windows / Linux**: `Ctrl + Shift + P`

<picture>
  <img alt="Unified Search" src="store/en-1-search.png" width="100%">
</picture>

Before you even type, the **Home View** gives you one-click access to **Tab Switcher**, **Search All History**, common tab controls (**New Tab, Reload, Pin, Mute**), **Storage Viewers**, and **Settings & Help**.

> [!TIP]
> Right-click the JustOneHop toolbar icon anytime to check your active shortcut or open the built-in Help guide.

---

## 2. Unified Search: Find Anything in One Hop

<a id="搜索与导航"></a>

Type whatever you are looking for: page titles, domains, or everyday commands in English, Chinese, or pinyin:

![Unified Search Demo](demo/en-search.gif)

- **Open Tabs**: Type any word from the title or domain and press `Enter` (or click) to jump straight there.
- **Bookmarks & History**: Shown right alongside open tabs. Press `Enter` to open in the current tab, or **`⌘Enter`** (`Alt+Enter` on Windows/Linux) to open in a new tab. Need older pages? Click **Search All History** or type `history`.
- **Browser Actions & Chrome Pages**: Type plain words like `new tab`, `reopen`, `downloads`, `extensions`, `passwords`, or `dark mode` (switches to an existing tab if already open instead of creating duplicates).
- **Direct URLs & Google Search**: Type any URL (e.g. `github.com` or `localhost:3000`) to go right there, or search Google in one keystroke when nothing local matches.

### Helpful Touches

- **Query Completion & Continue Search**: Type the start of a past search to see a faint suggestion. Accept it with **`Tab`**, **`→`**, or the footer button. If you just opened a page from a multi-result search, reopen the palette within 10 minutes to continue where you left off.
- **Predictable Local Learning**: Frequently chosen results gently move up within their relevance tier and show a small clock badge. Click `×` on the badge or press **`Shift+Backspace`** anytime to forget a preference.

---

## 3. Tab Switcher: Switch Recent Tabs Like Alt+Tab

<a id="3-tab-switcher-recent-tabs-like-vs-code"></a>
<a id="最近标签页切换"></a>

Jumping back and forth between a few working tabs? **Tab Switcher** orders your open tabs by **most recently used (MRU)**:

<picture>
  <img alt="Tab Switcher Dark Mode" src="store/en-2-switcher.png" width="100%">
</picture>

1. **Hold the modifier key** (`Control` on macOS, `Ctrl` on Windows/Linux).
2. **Tap the trigger key** (`J` on macOS, `,` on Windows/Linux) to open the switcher and cycle through recent tabs.
3. **Release the modifier key** to jump to the selected tab!

![Tab Switcher Demo](demo/en-switcher.gif)

- **Type to filter mid-switch**: Too many tabs? **Click the search bar** or press **`⌘F`** (`Ctrl+F`) to release the keys and filter by title or URL.
- **Mouse-friendly**: You can also open `Tab Switcher` anytime by clicking it on the Home screen.

### Setting Up Ctrl+Tab in 10 Seconds

<a id="ctrltab-配置"></a>

Chrome doesn't allow binding `Ctrl+Tab` directly in its normal shortcut input, so JustOneHop includes a 1-step setup helper:

1. Search `ctrl tab` in the palette (or open **Settings → Keyboard → Tab Switcher**).
2. Click **Copy & Open** in the footer to copy the setup script and open `chrome://extensions/shortcuts`.
3. Press **`⌘⌥J`** (`Ctrl+Shift+J` on Windows/Linux) to open the DevTools Console, paste, and press `Enter`. Both `Ctrl+Tab` and `Ctrl+Shift+Tab` will be bound immediately.

---

## 4. Tab Housekeeping & Quick Actions (`⌘K`)

<a id="整理标签页与继续操作"></a>

**Right-click** any tab result, click **Actions** in the footer, or press **`⌘K`** (`Ctrl+K` on Windows/Linux) to open the action menu:

![Tab Actions Demo](demo/en-actions.gif)

- **Pin / Mute / Reload / Copy URL / Close Tab**
- **Instant Bookmarking (`⌘D` / `Ctrl+D`)**<a id="收藏与取消收藏标签页"></a>: Bookmark or unbookmark any tab in the list without switching to it first.
- **Native Tab Groups**: Search any group by name to view its tabs, expand/collapse, rename, ungroup (keeping pages open), or safely close the group (pinned tabs stay protected).

> [!TIP]
> **Continuous Multi-Tab Tidy**
> When you close, pin, or mute a background tab, **the palette stays open and automatically selects the next item**. This lets you tidy up several tabs in a row without reopening it.

---

## 5. Tab Tucking: Declutter without Closing

<a id="收起标签页"></a>

Have tabs you might need later, but hate a crowded tab strip? **Tab Tucking** slides them into a native collapsed Chrome group named `Tuck Away` without closing pages or losing page state:

- **Tuck manually**: Search `tuck tab`, or press `⌘K` on any tab and choose **Tuck Tab**.
- **Auto-Tuck when idle**: Enable **Auto-tuck tabs** in **Settings → Labs** to automatically tuck inactive tabs while your computer is idle (active, pinned, and audio-playing tabs are never touched).
- **Restore anytime**: Search for a tucked tab and jump to it; it returns to your active tab strip automatically. You can also search `undo tuck` to restore the latest batch.

---

## 6. Developer Inspection: LocalStorage, SessionStorage & Cookies

<a id="页面存储"></a>

Need to check a token or cookie without opening heavy DevTools? Search:

- `local storage`
- `session storage`
- `cookie`

Browse and filter keys on the left, preview formatted JSON and cookie attributes on the right, and press **`Enter`** to copy the clean raw value. Everything is read-only in memory, and cookie access is requested strictly per site.

---

## 7. Navigation, Gestures & Personalization

<a id="面板位置底栏与返回"></a>

- **Effortless Back Navigation**: Press **`Esc`**, click the top-left Back badge, press **`Backspace`** in an empty search box, or **swipe right with two fingers** on a macOS trackpad to step back one level with your previous query and selection intact.
- **Personalize in Settings**: Click **JustOneHop** in the bottom-left footer (or press `⌘,` / search `settings`) to choose Light/Dark themes, customize the search bar icon with an Emoji or local image, or click the footer pet to toggle keyboard hints.
- **Works Everywhere**: Opens as a centered overlay on normal webpages, and automatically switches to a lightweight companion window on restricted pages like `chrome://` or the Chrome Web Store.

---

## 8. Keyboard & Mouse Shortcuts

| Action | Mouse / Trackpad | macOS | Windows / Linux |
| --- | --- | --- | --- |
| **Open / Close Palette** | Click toolbar icon / `esc` | `⌘ + Shift + P` | `Ctrl + Shift + P` |
| **Step Back One Level** | Click Back badge / 2-finger swipe right | `Esc` (`Backspace` when empty) | `Esc` (`Backspace` when empty) |
| **Select Next / Previous** | Scroll or click row | `↓` / `↑` (or `Ctrl+N/P`) | `↓` / `↑` (or `Ctrl+N/P`) |
| **Open Selected Result** | Click row | `Enter` | `Enter` |
| **Open in New Tab** | Click **New Tab** in footer | `⌘ + Enter` | `Alt + Enter` |
| **Open Actions Menu** | Right-click row / click **Actions** | `⌘ + K` | `Ctrl + K` |
| **Open Settings** | Click **JustOneHop** in footer | `⌘ + ,` | `Ctrl + ,` |
| **Forget Learned Ranking** | Click `×` on clock badge | `Shift + Backspace` | `Shift + Backspace` |
| **Recent Tab Switcher (MRU)** | Click `Tab Switcher` on Home | Hold `Control` + `J` | Hold `Ctrl` + `,` |
| **Filter Tabs in Switcher** | Click search bar | `⌘ + F` | `Ctrl + F` |

---

*Questions or feedback? Feel free to open an issue on [GitHub](https://github.com/lyyourc/JustOneHop).*
