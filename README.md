<picture>
  <source media="(prefers-color-scheme: dark)" srcset="docs/brand/logo-dark.svg">
  <source media="(prefers-color-scheme: light)" srcset="docs/brand/logo-light.svg">
  <img alt="JustOneHop Logo" src="docs/brand/logo-light.svg" width="64" height="64">
</picture>

# JustOneHop · 小范围瞬移

English · [简体中文](README.zh-CN.md)

**[Install from Chrome Web Store](https://chromewebstore.google.com/detail/mbofggnjaoneioopfbpheapgphmkclbo)** · Free · Chrome 127+ · 100% Local & Private

**A human-first, Chrome-native command palette.**

Press **`⌘Shift+P`** (`Ctrl+Shift+P` on Windows/Linux) or click the toolbar icon to search open tabs, bookmarks, history, and browser actions from one place. Works naturally whether you prefer a mouse, trackpad, or keyboard.

---

## Core Features

### 1. One Search Box for Everything

![Unified Search Demo](docs/demo/en-search.gif)

- **Tabs, bookmarks, and history together**: Switch to an open tab, or open bookmarks and history (`Enter` here, `⌘Enter` / `Alt+Enter` in a new tab).
- **Search naturally**: Type everyday words like `new tab`, `reopen`, `downloads`, `extensions`, or `dark mode` in English, Chinese, or pinyin. No command prefixes required.
- **Remembers your choices**: Frequently picked items move up in search, and you can clear any learned ranking with one click.

### 2. Switch Recent Tabs Like Alt+Tab

![Recent Tab Switcher Demo](docs/demo/en-switcher.gif)

- **Hold and release**: Hold `Control+J` (`Ctrl+,` on Windows/Linux, or set up `Ctrl+Tab` with the built-in guide) to flip through tabs in order of recent use.
- **Type to filter anytime**: Click the search box or press `⌘F` while cycling to release the keys and filter by title or URL.

### 3. Clean Up Tabs Without Losing Your Flow

![Tab Actions Demo](docs/demo/en-actions.gif)

- **Tidy multiple tabs in a row (Right-click / `⌘K`)**: Pin, mute, bookmark, copy links, or close tabs. The panel stays open and selects the next item so you can clean up several tabs in one go.
- **Tuck inactive tabs away**: Slide tabs you do not need right now into a collapsed group without closing them. You can also turn on auto-tuck when idle.

---

## Quick Shortcuts

Every action works with both mouse and keyboard (`Ctrl` instead of `⌘` on Windows/Linux):

| Action | Mouse | Keyboard |
| --- | --- | --- |
| Open / close | Click toolbar icon or `esc` | `⌘Shift+P` / `Esc` |
| Open result / in new tab | Click row / **New Tab** button | `Enter` / `⌘Enter` (`Alt+Enter` on Win/Linux) |
| More actions (pin, mute, close…) | Right-click row or click **Actions** | `⌘K` |
| Recent Tab Switcher | Click `Tab Switcher` on home | `Control+J` (or configure `Ctrl+Tab`) |
| Step back one level | Click back button / two-finger swipe right | `Esc` (or `Backspace` when input is empty) |
| Settings & Help | Click footer brand name or `Help` | `⌘,` / search `help` |

Full walkthroughs and `Ctrl+Tab` setup: **[User Guide](docs/USAGE.md)** ([中文版](docs/USAGE.zh-CN.md))

---

## Install & Run Locally

- **Chrome Web Store (Recommended)**: **[Add JustOneHop to Chrome](https://chromewebstore.google.com/detail/mbofggnjaoneioopfbpheapgphmkclbo)**
- **From GitHub Release**: Download `justonehop-<version>.zip` from [Releases](https://github.com/lyyourc/JustOneHop/releases), extract it, enable **Developer mode** in `chrome://extensions`, and click **Load unpacked**.
- **From Source**:
  ```sh
  npm ci && npm run build   # Then load `dist/` in chrome://extensions
  ```

---

## Privacy & Docs

- **100% Local & Private**: No accounts, no backend servers, and no telemetry. Everything runs locally in your browser. Read the [Privacy Policy](docs/PRIVACY.en.md) ([中文版](docs/PRIVACY.md)).
- **Docs**: [User Guide](docs/USAGE.md) · [Interaction Architecture](docs/INTERACTION-ARCHITECTURE.md) · [ADR Index](docs/adr/README.md) · [Testing](docs/TESTING.md) · [Changelog](CHANGELOG.md)
