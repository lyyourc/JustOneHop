<picture>
  <source media="(prefers-color-scheme: dark)" srcset="docs/brand/logo-dark.svg">
  <source media="(prefers-color-scheme: light)" srcset="docs/brand/logo-light.svg">
  <img alt="JustOneHop Logo" src="docs/brand/logo-light.svg" width="64" height="64">
</picture>

# JustOneHop · 小范围瞬移

English · [简体中文](README.zh-CN.md)

**[Install from the Chrome Web Store](https://chromewebstore.google.com/detail/mbofggnjaoneioopfbpheapgphmkclbo)** · v0.3.0 · Free · Chrome 127+

**A human-first, Chrome-native command palette.**

Too many tabs open, with bookmarks and history scattered across different menus? Press **`⌘Shift+P`** (`Ctrl+Shift+P` on Windows/Linux) to search **open tabs, bookmarks, browsing history, tab groups, and browser actions** from a single box—effortless with your mouse, keyboard, or both.

> **100% Local & Private** — Runs entirely on your device. No account, no backend server, and no telemetry.

---

## Why JustOneHop?

- **Human First (Seamless Mouse & Keyboard Flow)**: Whether you prefer keyboard shortcuts, trackpad gestures, mouse clicking, or switching between them mid-flow, every path is a first-class citizen. Search naturally with plain words (`new tab`, `reopen`, `dark mode`, `downloads`) without awkward hand-offs.
- **Chrome Native**: Built to feel like part of Chrome—blending with Chrome CR2023 visuals, adapting to Light/Dark mode, and reusing native Tab Groups, bookmarks, history, and favicon caches rather than creating a heavy, isolated silo.
- **Predictable & Adaptive**: True relevance always comes first. Frequently chosen items move up smoothly within their relevance tier for the same query, and every learned preference is transparent and forgettable with one click.

---

## Core Features

### 1. One Search Box for Everything

![Unified Search Demo](docs/demo/en-search.gif)

- **Plain words, bilingual support**: Search by page title or domain, or type everyday actions like `extensions`, `passwords`, `downloads`, or `clear cache` (switches to an existing tab if already open).
- **Understands intent**: Searching a project name (e.g. `justonehop`) prioritizes the repository root, while adding a keyword (`justonehop testing`) finds specific docs. Type any URL to go straight there, or press `Enter` to search Google.
- **Type less with local query completion**: After using `github` successfully, type `g` to see a faint completion. Accept with `Tab`, `→`, or the footer’s **Complete** button; `Enter` still runs the selected result. Suggestions stay on-device and are disabled in incognito.
- **Open here or in a new tab**: Bookmarks, history, and URLs open in the current tab on `Enter`, or in a new active tab on `⌘Enter` (`Alt+Enter` on Windows/Linux).

### 2. Tab Switcher (`Alt+Tab` for Chrome Tabs)

![Recent Tab Switcher Demo](docs/demo/en-switcher.gif)

- **Hold & release**: Hold `Control+J` (or configure **`Ctrl+Tab`** using the built-in guide), cycle through tabs in **most recently used (MRU)** order, and release the modifier key to switch.
- **Filter anytime**: Click the search bar or press `⌘F` while switching to release the keys and filter by title or URL.
- **Mouse-friendly**: Also available right from the home list whenever you prefer clicking.

### 3. Continuous Tab Tidy & Developer Tools

![Tab Actions Demo](docs/demo/en-actions.gif)

- **Tidy tabs in a row (Right-click / `⌘K`)**: Copy URLs, pin, mute, bookmark, or close tabs from the Actions menu. The palette **stays open and preserves your selection**, moving to the next item when the selected tab is removed, so you can clean up multiple tabs without reopening it.
- **Native Tab Groups & Auto-Tuck**: Search and expand, rename, ungroup, or close tab groups directly (pinned tabs stay protected). Enable **Auto-Tuck** in Settings to slide inactive tabs into native collapsed groups while your computer is idle—decluttering your tab strip without closing pages.
- **Inspect Storage without DevTools**: Search `local storage`, `session storage`, or `cookie` for a side-by-side, read-only JSON viewer with one-key copy (cookie access is requested per site).

---

## Quick Shortcuts

| What you want to do | Mouse | macOS Shortcut (`Ctrl` instead of `⌘` on Win/Linux) |
| --- | --- | --- |
| Open / close palette | Click toolbar icon / `esc` badge | `⌘Shift+P` / `Esc` |
| Select & run | Click row or primary footer button | `↑` `↓` to select, `Enter` to run |
| Open in new tab | Click **New Tab** in footer | `⌘Enter` (`Alt+Enter` on Win/Linux) |
| More actions (pin, mute, close, etc.) | Right-click row or click **Actions** | `⌘K` |
| Recent Tab Switcher (MRU) | Click `Tab Switcher` on home | `Control+J` (or configure `Ctrl+Tab`) |
| Step back one level | Click back arrow / two-finger swipe right | `Esc` (or `Backspace` when search is empty) |
| Settings / Built-in Help | Click gear icon / "Help" on home | `⌘,` / search `help` |

> For full walkthroughs, trackpad gestures, and `Ctrl+Tab` setup instructions, see the **[Usage Guide](docs/USAGE.md)** ([中文版](docs/USAGE.zh-CN.md)).

---

## Installation

### Option 1: Chrome Web Store (Recommended)

**v0.3.0 is published and available to everyone.** Open [JustOneHop on the Chrome Web Store](https://chromewebstore.google.com/detail/mbofggnjaoneioopfbpheapgphmkclbo) and click **Add to Chrome**. Requires Chrome 127+.

### Option 2: Install a Release Package Manually

Download `justonehop-0.3.0.zip` from [GitHub Release v0.3.0](https://github.com/lyyourc/JustOneHop/releases/tag/v0.3.0), extract it, then open `chrome://extensions`, enable **Developer mode**, and choose **Load unpacked**. Select the extracted folder containing `manifest.json`. GitHub's automatic source archives are not installable extension packages. See the [Changelog](CHANGELOG.md) for changes.

### Option 3: Build from Source

Requires Node.js / npm and Chrome 127+:

```sh
npm ci
npm run build
```

1. Open `chrome://extensions` and enable **Developer mode** in the top right.
2. Click **Load unpacked** and select the generated **`dist/`** directory.
3. Press **`⌘Shift+P`** (`Ctrl+Shift+P` on Windows/Linux) or click the toolbar icon.

---

## Privacy & How It Runs

- **Works everywhere**: Renders as a centered in-page overlay on regular webpages, and automatically falls back to a lightweight companion window on restricted pages (such as `chrome://` or the Chrome Web Store).
- **100% On-Device Data**: Preferences, learned search rankings (capped at 2,000 entries, expiring after 90 days of inactivity), and tab group states live only in local extension storage. Inspected Storage/Cookie values are read in memory and never persisted or transmitted.
- **Privacy Policy**: Read the full [Privacy Policy](docs/PRIVACY.en.md) ([中文版](docs/PRIVACY.md)). Developer: `lyyourc` · Contact: [liangyida42@gmail.com](mailto:liangyida42@gmail.com).

---

## Development & Docs

```sh
npm run dev            # Watch source files and rebuild incrementally
npm run check          # Run typecheck, unit tests, build, and E2E tests
npm run package:store  # Validate release metadata and build the store ZIP
```

After building local changes, search `Reload` inside the palette to reload the extension in place.

- [Usage Guide](docs/USAGE.md) ([中文版](docs/USAGE.zh-CN.md)) · [Interaction Architecture](docs/INTERACTION-ARCHITECTURE.md) · [ADR Index](docs/adr/README.md)
- [Recent Tabs](docs/RECENT-TABS.md) · [Site Storage](docs/PAGE-STORAGE.md) · [Testing Guide](docs/TESTING.md) · [Brand & Logo](docs/brand/LOGO.md)
- [Changelog](CHANGELOG.md) · [Release & Store Guide](docs/STORE-LISTING.md#5-本地打包与发布检查清单)
