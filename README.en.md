# zing

[简体中文](README.md) · English

A Chrome command palette that makes everyday browser tasks easier.

A locally loaded extension for personal use. No account, backend, or telemetry.

## Features

### Command Palette

Find tabs, bookmarks, and browser commands in one place. Matching text is highlighted, relevant commands take priority, and frequently chosen results move up based on your usage. Click a result or press Enter to run it, and use the Actions menu to manage the selected tab.

### Tab Switcher

Switch between tabs in the current window in order of recent use. Hold the shortcut to browse, release to confirm, and quickly return to your previous tab.

### Auto Tuck

Automatically move tabs unused for 7 days into a collapsed Tucked Away group, leaving room for what you are working on. Pages stay open; search or click to bring one back. Off by default, with manual tuck and undo actions available too.

## Interaction principles

**Human first**: use familiar shortcuts, use the mouse, or switch between them whenever you like. Using zing should not require memorizing shortcuts.

- **Discoverable actions**: common actions have clear, clickable controls. Additional actions live in the Actions menu, with shortcuts shown alongside them.
- **Consistent behavior**: clicks and shortcuts share the same actions, states, and navigation. Switching input methods preserves your context.
- **Clear feedback and natural navigation**: running, waiting, success, and failure have clear feedback. Going back preserves your search, selection, and editing position, while text editing follows familiar conventions.

These principles guide future design and acceptance testing.

## Installation

Requires Node.js / npm and Chrome 127+.

```sh
npm ci
npm run build
```

1. Open `chrome://extensions` and enable **Developer mode**.
2. Choose **Load unpacked** and select the generated **dist/** directory.
3. Click the zing toolbar icon or press **Cmd+Shift+P** (**Ctrl+Shift+P** on Windows/Linux).

`dist/` is not tracked in Git; build it after cloning. If a shortcut conflicts, change it at `chrome://extensions/shortcuts`, or search for “shortcuts” in zing to open its settings.

## Getting started

Type to search, without a mode prefix. Try a tab title, a website domain, `new tab`, or `settings`. Corresponding Chinese keywords also work.

In the main search, click a result to run it, or select it with the arrow keys and press Enter. The primary action and Actions buttons in the footer are clickable too.

| Action | Mouse control | macOS shortcut |
| --- | --- | --- |
| Run a search result | Click the result or footer primary action | Select with ↑ / ↓ or Ctrl+P / Ctrl+N, then Enter |
| More actions for the selected result | Click Actions in the footer, then a menu item | Cmd+K |
| Open settings | Settings button in the footer | Cmd+, |
| Go back one level | Page back button | Esc; Backspace also works in an empty search field |
| Close the main palette | Close button beside the search field | Esc |

To browse recent tabs, hold Control+J, select with N/P, and release Control to confirm.

On Windows/Linux, menu and settings shortcuts use Ctrl instead of Command; the default recent-tab shortcut is Ctrl+,. See the [usage guide (Chinese)](docs/USAGE.md) for nested navigation, text editing, and platform differences.

## Limits and data

Regular webpages use a centered overlay. Restricted pages, such as Chrome's internal pages, use a toolbar popup. A quick tap of the recent-tab shortcut from the address bar or another area without a key listener may require Enter to confirm.

Preferences, saved scripts, and search usage history stay on your device. Website storage values and script results are held only in the current panel.

Tucking does not close or explicitly discard pages. After a browser restart or extension reload, zing reconciles groups with locally saved records. If a group cannot be uniquely identified, search “recover tucked tabs”, review its pages, and choose “Continue Managing This Group”. Pending recovery prevents duplicate tuck-away groups. Records stay on your device and exclude incognito pages. See [tucking tabs (Chinese)](docs/USAGE.md#收起标签页).

See the [usage guide (Chinese)](docs/USAGE.md) for other features, permissions, limitations, and manual Ctrl+Tab configuration.

## Development and testing

Built with React, TypeScript, Fuse.js, and esbuild. Tests use an isolated temporary browser profile and local pages.

```sh
npm run dev                       # Watch source files and rebuild
npx playwright install chromium   # Before the first browser test run
npm run check                     # Type checks, unit tests, build, and end-to-end tests
```

You can also run `npm run typecheck`, `npm test`, `npm run build`, and `npm run test:e2e` separately. Set `ZING_CHROMIUM_PATH` to specify a Chrome for Testing executable, or `ZING_VIMIUM_PATH` to specify a Vimium directory for compatibility tests.

After building, reload zing on Chrome's extensions page and refresh the test webpage. Changes to the manifest or locale files in `public/` require a rebuild. Build output, dependencies, and test screenshots are not committed to Git.

## Documentation

The detailed guides below are currently in Chinese. Keep both README versions in sync when updating them.

| Document | What it covers |
| --- | --- |
| [Usage guide](docs/USAGE.md) | How to use each feature and its limitations |
| [ADR index](docs/adr/README.md) | Reasons for architectural decisions and their tradeoffs |
| [Interaction implementation](docs/INTERACTION-ARCHITECTURE.md) | Components, navigation, focus, and permissions |
| [Website storage implementation](docs/PAGE-STORAGE.md) | Reading storage, validating targets, and per-site permission |
| [Recent-tab switching](docs/RECENT-TABS.md) | Key release, focus, and quick taps |
| [Acceptance history](docs/ACCEPTANCE.md) | What was verified in each iteration |
