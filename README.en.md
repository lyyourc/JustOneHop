# zing

[简体中文](README.md) · English

A Chrome command palette that makes everyday browser tasks easier.

A locally loaded extension for personal use. No account, backend, or telemetry.

## Features

### Command Palette

Find tabs, bookmarks, browsing history, and browser commands in one place. Matching text uses a heavier weight without added color or spacing, and relevant commands take priority. Results that support learning can move up among equally relevant matches for the same query. A normal click or Enter runs the result; releasing the mouse after dragging to select result text in the main or history search does not navigate. In these two searches, choose Copy URL from Actions for tabs, history, bookmarks, and other candidates with a URL to copy the full address without opening it or recording a ranking preference. Success preserves your query, selected result, and input caret or text selection.

Closing, pinning, muting, and other organizing actions keep zing open with your search and caret preserved. Removing a result selects a neighboring item so you can keep working. Navigation, such as switching tabs or opening a page, closes the palette on success. If you close the tab hosting zing, your search continues in a separate panel for the same browser window, retaining the system title bar. Select a result again before continuing. Closing the source window or its last tab ends the session; it never follows you into another browser window.

### Browsing history search

Typing also searches the past week of Chrome history, including pages opened outside zing, with up to 100 history matches. The palette waits at most 100ms before presenting the combined results once; late history replies do not insert rows. Search All History occupies the seventh result slot, or follows the results when fewer than six exist. Explicit `history`, `search history`, or Chinese equivalents put it first and open an empty history search field. Click it or press Enter to search all time inside the panel; you can edit the query or go back while loading. Timeouts, no matches, and read failures have distinct messages. History pages open in a new tab in the source window; history candidates duplicating matching tabs or bookmarks are omitted. The `history` permission is requested at installation. zing only reads HTTP(S) history and keeps no persistent copy of the history database. Only explicit selections that open successfully save the search term and website address locally; API reads and failed opens create no learning records. Incognito windows do not read ordinary history or record selections.

Search results share icon, title/description, and right-side metadata rendering. In the main search, Current appears to the right of the category as muted text without a background, matching history timestamps. History shows the last visit as just now, minutes ago, today/yesterday with time, or a date. Hover for the full local timestamp; narrow layouts retain the time.

### Chrome Pages

Search `extension`, `password`, or equivalent Chinese keywords to open Extensions, Password Manager, Downloads, History, Bookmark Manager, Chrome Settings, and Extension Shortcuts. An exact destination already open in the current window is activated; otherwise a new tab opens, preserving your current page and other native subpages. Search “Chrome Pages” or “Chrome 内置页面” to find the group; these commands stay out of the empty-search home. `settings` / `设置` still opens zing Settings. These commands only navigate, without reading passwords, history, or download data or adding permissions.

### Tab Switcher

**Zing: Tab Switcher** shows “Switch tabs like in VS Code” and the launch shortcut currently assigned in Chrome; no keycap is shown when unbound. Settings shows the same actual binding or “Not assigned”; Ctrl+Tab is an optional one-time setup. Choose it from home or search to browse recent tabs in the current palette and immediately filter by title or URL. Click a result, press Enter, or choose Switch in the footer to confirm. Cancel, Esc, or the footer back button restores the parent query, selection, and caret. Launching with the shortcut still supports holding to browse and releasing to confirm, including a quick return to your previous tab.

### Script Library

Search “scripts” to manage locally saved scripts: select from the list on the left to see a live, read-only code preview, Name, and Content Type JavaScript on the right. A click only selects the preview; hovering preserves your selection. Arrow keys or Ctrl+N/P also change the preview, while Enter or Copy Code in the footer copies the selected script. Open the context menu or Actions to edit; built-in items offer View Setup Instructions. Use New Script in the footer (a plus button on narrow panels) or Cmd+Shift+N (Ctrl+Shift+N on Windows/Linux) to create, save the name-and-code form with Cmd/Ctrl+Enter, and confirm before deleting. At widths of 520px or less, the list sits above the preview, with each scrolling independently. “Run script” still opens a full-width selection list where clicking or pressing Enter runs a script once on the current webpage. Scripts run only when explicitly requested, with no automatic text expansion or execution on page load; results stay in the current panel.

### Website Storage

Search `local storage`, `session storage`, or `cookie` to inspect the current site's storage. Like Script Library, select a key on the left to preview its full value on the right, with the key, content type, and cookie attributes below. A click only selects; Enter or Copy Value in the footer copies the original string. JSON is formatted for reading, and cookies retain domain, path, and other attributes. Narrow panels stack the list above the preview, with each scrolling independently. Storage is read-only, cookie access is granted per site, and values stay in the current panel.

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

Type English or Chinese keywords to search everything in one place, without a mode prefix. Try a page title, website domain, `new tab`, or `settings`, everyday phrases such as `refresh page`, `reopen last tab`, `dark mode`, or `打开书签`, or combine titles, domains, tab groups, and bookmark folders in any order (such as `github pull`, `notion 路线`, or `前端 react`).

You do not need to type full command names: `clo` finds Close Tab, `clo oth` finds Close Other Tabs, and `tab clo ri` finds Close Tabs to the Right (`关闭` and `guan` also work; `cl`, `cloud`, and `tab` alone will not trigger close commands). Mute and pin aliases follow the target tab’s current state so opposite actions are not suggested. Relevance comes first: learned habits only reorder items within the same relevance tier for the same query. Home has one **Suggested / 推荐** list mixing pages and commands, with at most 10 items. Without learned preferences, the default order is **Zing: Settings**, **Zing: Help**, **Zing: Tab Switcher**, Script Library, Search All History, New Tab, Reload Tab, Pin/Unpin Tab, Local Storage, and Cookies; available undo-tuck or tuck-recovery entries may also appear. Pages need a successful choice through zing to qualify; recent visits never fill empty slots. The current full URL is excluded, and exact URL duplicates become one item, preferring an open tab in the current window. Home aggregates frequency with decay across queries and, only here, combines tab/history and bookmark habits for the same URL. Weights halve every 14 days, expire after 90 days without use, and are stored in at most 500 records. Mute/Unmute Tab, Reopen Closed Tab, and View Session Storage appear only in search, even when they have learned preferences. Settings destinations use names such as **Settings: Theme** and **Settings: Language** and open the corresponding controls.

Home scores are captured when the palette opens or a source session begins. Typing, returning from child views, and new learning preserve home order until the next open; actual data removal still updates the list. On home, `Cmd/Ctrl+↑/↓` jumps to the first or last item. Pressing Enter immediately runs the first suggestion, with no promise of returning to the previous tab. Incognito home uses default entries only, hides Search All History, and does not use ordinary-window habits. Home does not preload history or add permissions.

In both the main search and Search All History view, results with a learning record show a small history icon on the right, before any shortcut keycap. Hover or focus it to see one short sentence explaining the ranking reason, followed by “Forget Preference for This Query” or, on home, “Forget This Command’s Preferences” or “Forget This Page's Preferences”. The icon changes to an X; click it to forget. After selecting a row with the keyboard, press `Tab` to focus its icon, then `Enter` / `Space` to forget, or press `Shift+Backspace` to forget the selected result’s records directly.

With a search query, forgetting removes only this result’s preference for the normalized query (ignoring case, trimming outer whitespace, and collapsing repeated whitespace). On home, commands lose all their query records; pages atomically lose all records for the full URL and matching learned bookmarks across every query, including the empty query. After deletion, the icon disappears while order, selection, and scroll position stay in place. Search reranks when the query changes; home retains its order until the next open. Other open panels receive updated records and icons, and actual changes such as closed tabs still refresh lists. Forgetting deletes neither pages nor bookmarks, adds no hide or “do not recommend” preference, and allows future choices to learn again. Resetting in this panel’s **Settings → Experimental Features → Search Ranking** immediately restores default ranking and home entries.

Learning covers regular tabs, browsing history, bookmarks, browser commands, Settings, and website storage entry points. Scripts, Help, tab-group navigation, the Tab Switcher entry, and extension reload do not participate. Successful page choices directly from home also learn; switching tabs in Tab Switcher does not. Query search keeps shared history/tab preferences for the same full URL and separate bookmark identities, with the same query-specific forgetting scope. Records stay on your device; incognito windows do not record selections.

| Action | Mouse control | macOS shortcut |
| --- | --- | --- |
| Run a search result | Click the result or footer primary action | Select with `↑` / `↓` or `Ctrl+P` / `Ctrl+N`, then `Enter` |
| More actions for the selected result | Right-click the result, or click Actions in the footer | `Cmd+K` |
| Open settings | Settings gear in the footer | `Cmd+,` |
| Go back one level | Click the footer back arrow or `esc` beside the search field | `Esc` (`Backspace` also works in an empty secondary search field) |
| Close the main palette | `esc` beside the search field | `Esc` |

Right-click the zing toolbar icon to view or change the current launch shortcut, or to open the built-in Help guide in a new tab (also available inside the palette via Settings → General → Help, or by searching `help`, `帮助`, or `使用说明`).

**Tab Switcher** supports VSCode style Ctrl+Tab switching, configured from **Settings → Keyboard → Tab Switcher → Copy & Open**. This copies a single-line command with your extension ID and opens Chrome’s shortcuts page. Paste it into that page’s Console and press Enter to set both directions; it is not a terminal command. The Zing guide stays available across repeated tab switches until you leave the guide; transient popups preserve it in a separate guide tab. To switch recent tabs, hold `Control+J` (`Ctrl+,` on Windows/Linux, or `Ctrl+Tab` if configured), select with `N` / `P` or arrow keys, and release the modifier key to confirm. Click the switcher search field or press `Cmd/Ctrl+F` to pause release-to-switch and filter by title or URL instead, then press `Enter` or click a result to switch.

The default recent-tab shortcut is `Control+J` on macOS and `Ctrl+,` on Windows/Linux; add `Shift` for reverse cycling. For other actions on Windows/Linux, use `Ctrl` instead of `Command`. See the [usage guide (Chinese)](docs/USAGE.md) for details and platform differences.

## Limits and data

Regular webpages use an overlay centered horizontally near the top of the page viewport, up to 750×516px and reduced to fit smaller viewports. The command palette on Chrome's internal pages, and Tab Switcher whenever its webpage overlay is unavailable, use a separate window whose position is estimated from the source content area and zoom. It follows the source tab's zoom and corrects its own native frame using window and tab dimensions from the Chrome API before rendering the UI, while retaining the system title bar.

Separate windows use the source tab's content dimensions and browser outer bounds reported by Chrome in device-independent pixels (DIP). They estimate the content area as horizontally symmetric and bottom-aligned, then apply the source page's zoom to calculate position and size. The source content area's screen origin cannot be measured directly, so vertical tabs, docked DevTools, and system borders may cause offsets; pixel-perfect alignment is not guaranteed.

The command palette still uses a toolbar popup when the address bar holds focus on a regular webpage and in other restricted cases such as the Web Store; Chrome controls that popup's position. A quick tap of the recent-tab shortcut from the address bar or another area without a key listener may require Enter to confirm.

Preferences, saved scripts, and search usage history stay on your device. Website storage values and script results are held only in the current panel.

**Auto Tuck Tabs** is available in Settings → Experimental Features and is off by default; when enabled, it automatically tucks eligible tabs unused for 7 days. Tucking does not close or explicitly discard pages. After a browser restart or extension reload, zing reconciles groups with locally saved records. If a group cannot be uniquely identified, search “recover tucked tabs”, review its member cards, and choose “Continue Managing This Group” in the footer or Actions menu to confirm. Clicking a card only selects the candidate group. Pending recovery prevents duplicate tuck-away groups. Records stay on your device and exclude incognito pages. See [tucking tabs (Chinese)](docs/USAGE.md#收起标签页).

See the [usage guide (Chinese)](docs/USAGE.md) for other features, permissions, limitations, and manual Ctrl+Tab configuration.

## Development and testing

Built with React, TypeScript, Fuse.js, and esbuild. Tests use an isolated temporary browser profile and local pages.

```sh
npm run dev                       # Watch source files and rebuild
npx playwright install chromium   # Before the first browser test run
npm run check                     # Type checks, unit tests, build, and end-to-end tests
```

For routine changes, use the [testing matrix](docs/TESTING.md) to select type checks, module unit tests, and a few relevant browser scenarios; layout-only changes do not default to the full unit suite. `npm run test:e2e -- --grep '<test selector>' --list` discovers tests without building or launching a browser; remove `--list` to build and execute. Each run saves isolated artifacts, phase timings, and `validation.json`. `npm run check` runs the full suite; the positioning matrix still has unresolved cases. Set `ZING_CHROMIUM_PATH` to specify Chrome for Testing. Vimium compatibility cases require `ZING_VIMIUM_PATH` and verify that the extension loaded; without the path, they are explicitly skipped. See the [testing guide](docs/TESTING.md) for execution and acceptance boundaries.

After building, open zing and search `Zing: Reload`, `reload zing`, or “重新加载扩展”. Click **Zing: Reload** or press Enter to load the installed build. zing panels close while pages and saved settings remain; invoke zing again to use it. Reload once from Chrome’s extensions page to install this feature; that page also remains the fallback if zing cannot open. Changes to the manifest or locale files in `public/` require a rebuild. Build output, dependencies, and test screenshots are not committed to Git.

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
