<picture>
  <source media="(prefers-color-scheme: dark)" srcset="docs/brand/logo-dark.svg">
  <source media="(prefers-color-scheme: light)" srcset="docs/brand/logo-light.svg">
  <img alt="JustOneHop Logo" src="docs/brand/logo-light.svg" width="64" height="64">
</picture>

# JustOneHop · 小范围瞬移

[简体中文](README.md) · English

**Human First · Chrome Native** — Intuitive interaction and a seamless native feel that make using Chrome every day more effortless and enjoyable.

> **Environment & Project Note**
> - A Chrome command palette extension that runs entirely locally — no account, no backend, and no telemetry.
> - Currently tested on real hardware only on **macOS 26.7.1** with **Google Chrome 155.0.8059.85**.

---

## Philosophy

- **Human First**: Mouse clicks, familiar keyboard shortcuts, and switching freely between the two are all first-class workflows—you never have to memorize cryptic shortcuts or mode prefixes.
- **Chrome Native**: Designed to feel right at home in Chrome, building directly on native bookmarks, browsing history, Tab Groups, and favicon caches.

---

## Core Features

### 1. Unified Command Palette

Search across **open tabs, bookmarks, recent browsing history, tab groups, and browser commands** from a single input:

- **Natural search in English & Chinese**: Search by page title, domain, everyday phrases (`refresh page`, `reopen last tab`, `dark mode`, `刷新页面`), or short command prefixes (`clo` for Close Tab, `clo oth` for Close Other Tabs).
- **Curated command aliases**: Use `prefs` for Settings, `pwd` for Password Manager, `plugins`, `favorites`, or listed misspellings such as `setings` and `extention`. Brand aliases include `joh`, `just one hop`, `just-one-hop`, and `瞬移`: try `joh settings`, `joh: help`, or `reload joh`.
- **Habit-aware ranking**: Relevance always comes first; for the same query, frequently chosen items move up within their relevance tier. Hover the history icon on any learned result to see why it moved up or forget that preference with one click.
- **Go to URL & Search Google**: Type `example.com` or `localhost:3000` to navigate directly, or type any query to search Google (`Enter` opens in the current tab; `⌘Enter` opens in a new tab).
- **Full History Search**: Recent 7-day history matches appear inline as you type, with a one-click **Search All History** view for older visits.

### 2. Tab Switcher (VS Code-style MRU Switching)

Jump between open tabs in your current window ordered by most recently used:

- Hold `Control+J` (or configure **`Ctrl+Tab`** with the built-in one-line setup guide), cycle with `N` / `P` or arrow keys, and **release the modifier key to switch**.
- Click the search bar or press `⌘F` while the switcher is open to pause release-to-switch and filter tabs by title or URL.
- Also accessible anytime from the main palette home list using the mouse or `Enter`.

### 3. Tab Organization & Auto Tuck

- **Organize without losing context**: Pin, mute, bookmark/unbookmark, remove from a tab group, or close other tabs straight from the results list or the `⌘K` Actions menu. The palette stays open and selects the next item so you can clean up several tabs in a row.
- **Auto Tuck**: Automatically (or manually) move tabs unused for 7 days into a collapsed native Chrome Tab Group (“Tucked Away”), keeping your tab strip clean for active work. **Tucking never closes or discards pages**—search or click anytime to bring a page back.

### 4. Website Storage Inspector & Chrome Pages

- **Read-only Website Storage**: Search `local storage`, `session storage`, or `cookie` to inspect keys, values, and cookie attributes side by side. JSON values are formatted automatically, and `Enter` copies the raw string. Cookie access is requested per site.
- **Quick Chrome Pages**: Search `extension`, `password`, `download`, or `chrome settings` to jump straight to Chrome's built-in pages (activating an existing tab if one is already open).

---

## Installation

Requires Node.js / npm and Chrome 127+.

```sh
npm ci
npm run build
```

1. Open `chrome://extensions` and enable **Developer mode**.
2. Click **Load unpacked** and select the generated **`dist/`** directory.
3. Click the JustOneHop toolbar icon or press **`⌘Shift+P`** (`Ctrl+Shift+P` on Windows/Linux).

> `dist/` is not tracked in Git—run `npm run build` after cloning or pulling updates. If the launch shortcut conflicts with another binding, customize it at `chrome://extensions/shortcuts` or search `shortcuts` inside JustOneHop.

---

## Quick Reference

| Action | Mouse | macOS Shortcut |
| --- | --- | --- |
| Open / close palette | Click toolbar icon / `esc` in search bar | `⌘Shift+P` / `Esc` |
| Select & run result | Click result row or primary footer button | `↑` `↓` (or `Ctrl+P` / `Ctrl+N`), then `Enter` |
| More actions (Copy URL, close, pin, etc.) | Right-click result or click **Actions** in footer | `⌘K` |
| Switch recent tabs | Choose `Tab Switcher` on home | `Control+J` (or configure `Ctrl+Tab` in Settings) |
| Open Settings | Click gear icon in footer | `⌘,` |
| Go back one level | Click footer back arrow, `esc` badge, or two-finger swipe right | `Esc` (or `Backspace` in an empty secondary search bar) |

For detailed feature behavior, gesture rules, and `Ctrl+Tab` setup instructions, see the **[Usage Guide (Chinese)](docs/USAGE.md)**.

---

## Boundaries & Privacy

- **Hosting modes**: Uses a centered in-page overlay on regular webpages. On restricted pages where Chrome blocks content scripts (such as `chrome://` pages or the Chrome Web Store), it automatically falls back to a standalone popup window aligned with the active tab.
- **Local data**: Preferences, search ranking, and group recovery records stay on your device and may include search terms and full URLs. Inspected Storage and Cookie values are not persisted by the extension; values you copy enter the system clipboard. Executing a Google search sends the query to Google through normal browser navigation.
- **Full details**: The [Privacy Policy](docs/PRIVACY.en.md) explains access, website permissions, retention, and data controls. Developer contact details and the effective date will be completed before public release.

---

## Development & Documentation

```sh
npm run dev     # Watch source files and rebuild incrementally
npm run check   # Run type checks, unit tests, build, and E2E tests
```

After building local changes, search `Reload` (`JustOneHop: Reload`) inside the palette to reload the extension in place. See the [Testing Guide](docs/TESTING.md) for scoped verification workflows.

| Document (Chinese) | Description |
| --- | --- |
| [Usage Guide](docs/USAGE.md) | Complete feature guide, ranking rules, and edge-case boundaries |
| [Interaction Architecture](docs/INTERACTION-ARCHITECTURE.md) | UI contracts for lists, footers, menus, focus, and window hosting |
| [ADR Index](docs/adr/README.md) | Architectural decisions and tradeoffs |
| [Recent Tabs Implementation](docs/RECENT-TABS.md) | Key-release handling, focus management, and quick-tap behavior |
| [Website Storage Implementation](docs/PAGE-STORAGE.md) | Target verification and per-site permission model for Storage & Cookies |
| [Testing Guide](docs/TESTING.md) | Unit test, Playwright browser verification, and test selection matrix |
| [Logo Specification](docs/brand/LOGO.md) | Brand mark philosophy, geometry specs, and light/dark assets |
| [Acceptance History](docs/ACCEPTANCE.md) | Iteration verification records |
