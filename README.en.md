# zing

[简体中文](README.md) · English

A Chrome command palette that makes everyday browser tasks easier.

A locally loaded extension for personal use. No account, backend, or telemetry.

## Features

### Command Palette

Find tabs, bookmarks, and browser commands in one place. Matching text is highlighted, relevant commands take priority, and frequently chosen results move up based on your usage. Click a result or press Enter to run it, and use the Actions menu to manage the selected tab.

Closing, pinning, muting, and other organizing actions keep zing open with your search and caret preserved. Removing a result selects a neighboring item so you can keep working. Navigation, such as switching tabs or opening a page, closes the palette on success. If you close the tab hosting zing, your search continues in a separate panel for the same browser window, retaining the system title bar. Select a result again before continuing. Closing the source window or its last tab ends the session; it never follows you into another browser window.

### Chrome Pages

Search `extension`, `password`, or equivalent Chinese keywords to open Extensions, Password Manager, Downloads, History, Bookmark Manager, Chrome Settings, and Extension Shortcuts. An exact destination already open in the current window is activated; otherwise a new tab opens, preserving your current page and other native subpages. Search “Chrome Pages” or “Chrome 内置页面” to find the group; these commands stay out of the empty-search home. `settings` / `设置` still opens zing Settings. These commands only navigate, without reading passwords, history, or download data or adding permissions.

### Tab Switcher

Switch between tabs in the current window in order of recent use, or type a title or URL to filter them. Hold the shortcut to browse, release to confirm, and quickly return to your previous tab.

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

The main search and secondary lists share one footer: a monochrome icon button, the current location name, and additional context separated by `·` on the left. The main search shows a settings gear and `zing`; secondary pages such as Local Storage and Tab Groups show a back arrow and the storage type or group name, without a separate title bar. Clicking the back arrow works like Esc, leaving the deepest active layer each time. Location names share the same muted text style, without brand decoration, a type icon, or a group-colored icon beside them. The primary action and Actions menu remain on the right.

Navigation hints in the main search and Tab Switcher, website origins, and group member counts share the context position and the same quiet 11px supporting text style. Navigation keys appear without boxes; the primary action and Actions keycaps on the right retain their borders and backgrounds. Transient status feedback replaces that context in the same position. At widths of 520px or less, only supplemental context is hidden, including the main search and Tab Switcher hints. Status feedback, such as copy success, work in progress, or a dangerous action, remains visible in that position and can truncate as needed. The icon button and location name remain visible; long names truncate before action controls, which retain their size. The regular panel is 516px tall, with a 44px footer and 40px list rows. The footer and search field keep their positions between layers; Storage names and value previews appear side by side.

| Action | Mouse control | macOS shortcut |
| --- | --- | --- |
| Run a search result | Click the result or footer primary action | Select with ↑ / ↓ or Ctrl+P / Ctrl+N, then Enter |
| More actions for the selected result | Click Actions in the footer, then a menu item | Cmd+K |
| Open settings | Settings button in the footer | Cmd+, |
| Go back one level | Click the back arrow at the left of the footer | Esc; Backspace also works in an empty search field |
| Close the main palette | Close button beside the search field | Esc |

To browse recent tabs, hold Control+J, select with N/P, and release Control to confirm.

Tab Switcher uses the main palette’s search capsule and list layout in both the webpage overlay and separate window. The search field starts empty and disabled, with focus on the candidate list and “Search recent tabs…” as its placeholder. Click the search icon or field area, or press Cmd+F (Ctrl+F on Windows/Linux) to search; releasing the launch modifier then leaves the switcher open so you can type normally. Confirm with plain Enter, a result click, or the footer’s Switch button. Quick switching still confirms on modifier release until you enter search. Filtering matches titles and URLs without regard to case; every whitespace-separated term must match. Results keep their recent-use order and highlight matching text. Editing the query keeps the selected tab if it remains visible, otherwise selects the first result; no matches means no tab activation.

Tab Switcher shares the same 44px footer: “Release Ctrl to switch” during quick switching, or “Switch Recent Tabs” after entering search, followed by exactly the same “Navigate ↑ Ctrl P ↓ Ctrl N” hint as the main search (“选择 ↑ Ctrl P ↓ Ctrl N” in Chinese). Hovering over the hint explains arrow keys, Ctrl+P/N, and clicking to select. Clickable “Switch ↵” and “Cancel esc” buttons appear on the right, each showing its label before its keycap. Narrow layouts hide only the navigation hint, keeping the release instruction or search-state title; hover over the search header to see the actual launch shortcut. The webpage switcher fills the available panel space, with no separate help row below the footer.

On Windows/Linux, menu and settings shortcuts use Ctrl instead of Command; the default recent-tab shortcut is Ctrl+,. See the [usage guide (Chinese)](docs/USAGE.md) for nested navigation, text editing, and platform differences.

## Limits and data

Regular webpages use an overlay centered horizontally near the top of the page viewport, up to 750×516px and reduced to fit smaller viewports. The command palette on Chrome's internal pages, and Tab Switcher whenever its webpage overlay is unavailable, use a separate window whose position is estimated from the source content area and zoom. It follows the source tab's zoom and corrects its own native frame using window and tab dimensions from the Chrome API before rendering the UI, while retaining the system title bar.

Separate windows use the source tab's content dimensions and browser outer bounds reported by Chrome in device-independent pixels (DIP). They estimate the content area as horizontally symmetric and bottom-aligned, then apply the source page's zoom to calculate position and size. The source content area's screen origin cannot be measured directly, so vertical tabs, docked DevTools, and system borders may cause offsets; pixel-perfect alignment is not guaranteed.

The command palette still uses a toolbar popup when the address bar holds focus on a regular webpage and in other restricted cases such as the Web Store; Chrome controls that popup's position. A quick tap of the recent-tab shortcut from the address bar or another area without a key listener may require Enter to confirm.

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

For routine changes, run `npm run typecheck`, `npm test`, and `npm run test:e2e -- --grep '<test selector>'` for the affected cases. The E2E runner builds first and saves isolated artifacts plus `validation.json`. `npm run check` runs the full suite; the positioning matrix still has unresolved cases. Set `ZING_CHROMIUM_PATH` to specify Chrome for Testing. Vimium compatibility cases require `ZING_VIMIUM_PATH` and verify that the extension loaded; without the path, they are explicitly skipped. See the [testing guide](docs/TESTING.md) for execution and acceptance boundaries.

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
