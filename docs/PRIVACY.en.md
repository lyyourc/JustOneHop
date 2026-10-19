# JustOneHop Privacy Policy

[简体中文](PRIVACY.md) · English

> Pre-publication draft: the developer and contact email are confirmed; the effective date will be filled in when the policy is published. This file is not yet a public policy page. Supply a policy URL that is accessible without signing in in the store dashboard.

- Product: JustOneHop (小范围瞬移), a Chrome extension
- Developer: lyyourc
- Privacy contact: [liangyida42@gmail.com](mailto:liangyida42@gmail.com)
- Effective date: **[TO COMPLETE: effective date of the published policy]**

## 1. Scope

This policy describes how JustOneHop accesses, uses, and stores data. The extension helps you search and manage browser content, including tabs, bookmarks, history, and tab groups, and inspect the current website's storage when you request it.

JustOneHop requires no account, has no developer-operated backend, and includes no telemetry, advertising, or analytics tracking. It processes the data needed for its features on your device. It does not upload that data to the developer, sell user data, or use it for advertising, credit assessments, or purposes unrelated to the features described here.

This policy covers the extension itself. Websites you choose to visit, Google Search, and the service hosting this policy page are subject to their own privacy practices.

## 2. Data the extension accesses

| Data | Purpose and scope |
| --- | --- |
| Tabs and windows | Titles, URLs, tab and window identifiers, group membership, pinned and muted states, and related properties support tab search, switching, and management. |
| Bookmarks | Bookmark titles, URLs, and folders are read for search. Chrome bookmarks are created or removed when you request those actions. |
| Browsing history | Recent history or the full history range you choose to search is queried to display matching results. The extension does not maintain a persistent copy of the entire history database or modify that database. |
| Recently closed sessions | Chrome's recently closed tab or window sessions are used when you request restoration. |
| Website Local Storage, Session Storage, and cookies | Read only when you open the corresponding viewer. Local Storage and Session Storage access is limited to the current top-level page. Cookies are limited to records matching the current page URL, including HttpOnly cookies and current partition cookies where supported by Chrome. Viewers do not modify or delete these values. Websites may store personal information or sign-in tokens in this data. |
| Keyboard modifier state | A webpage shortcut bridge listens to trusted keyboard events and tracks whether Control, Meta, or Alt is held or released for recent-tab switching. It does not record ordinary typed characters, input field contents, or page text. |
| System idle and color-scheme state | Idle state helps schedule automatic tab tucking. The system light/dark preference selects the toolbar icon. |

## 3. Local storage and retention

The extension uses Chrome's local extension storage and session storage. It does not use `chrome.storage.sync` to synchronize this data across devices.

- **Preferences:** Language, theme, and the Auto Tuck setting remain locally until changed or extension data is removed.
- **Search ranking records:** Some successful selections store a normalized search term, target identifier, weight, and last-used time. Targets may include a full webpage URL, including query parameters and fragments, a bookmark ID, or a command ID. Home-screen selections may also be recorded. These records are used only for local ranking, with a maximum of 500 valid records. Records older than 90 days no longer affect ranking; subsequent recording or forgetting operations clean up old stored records. There is no background job guaranteeing physical deletion on day 90. Reading history or a failed open does not create a selection record. Direct URL navigation and Google searches do not write these learning records.
- **Auto Tuck timing:** While Auto Tuck is enabled, full URLs and last-used times for eligible tabs are stored locally. Turning Auto Tuck off clears timing records once cleanup completes.
- **Group recovery records:** Manual or automatic tucking stores group names, colors, full member URLs, and the full URLs of other HTTP/HTTPS tabs in the same window to verify group ownership after a browser restart. Unresolved records may be retained without a fixed expiry. Turning Auto Tuck off does not guarantee removal of every unresolved recovery record.
- **Session state:** Panel source information, tab/window/group identifiers, switching state, and tuck undo information support the current runtime session. Some stays in memory and some uses Chrome session storage. Closing a panel removes its corresponding panel session record.
- **Website storage viewer contents:** Retrieved names, values, and attributes are processed in the current viewer's memory, are not written to the extension's persistent storage, and are not sent to the developer. After the viewer closes, the extension no longer retains its copy of that viewer's contents. If you copy a value, it enters the system clipboard. Closing the panel does not clear the clipboard; the operating system or clipboard tools may retain copies.

## 4. Website permissions and shortcut scripts

The extension declares feature permissions such as tabs, bookmarks, history, and cookies at installation. Panel injection and Local Storage/Session Storage inspection use temporary `activeTab` access triggered by a user action.

A lightweight shortcut script runs automatically in HTTP/HTTPS pages and subframes where Chrome permits access, so recent-tab switching can detect modifier release. It does not wait for the cookie viewer's per-site authorization and does not record what you type into pages.

The `cookies` API permission is declared at installation. Reading cookies also requires applicable website access. When that access is missing, the extension offers an authorization step and requests access from Chrome after your click. Requests cover the current host and the ancestor hosts needed to read parent-domain cookies, stopping at the registrable domain boundary. They cover both HTTP and HTTPS and all paths, without wildcard access to sibling subdomains. For example, a request for `a.b.example.com` may include `a.b.example.com`, `b.example.com`, and `example.com`.

This is Chrome website access, not permission limited to cookies or one URL path. Existing applicable authorization may mean no new prompt is shown. You can inspect or revoke access in Chrome's extension details and site access settings. Revocation may prevent related features from working.

## 5. External access and sharing

The extension does not request online search suggestions while you type. If you execute a Google search, the browser opens a Google Search URL containing your query. Google receives that query and information associated with a normal website visit, subject to the [Google Privacy Policy](https://policies.google.com/privacy).

Opening a URL, bookmark, or history result also navigates the browser to the corresponding website. These visits carry out your requested actions; they are not uploads of browsing data to the developer.

The extension uses Chrome's favicon interface, not a third-party icon service. Executable code is packaged with the extension; it does not download and execute remote code. The developer does not receive the extension feature data described above or provide it to data brokers, advertisers, or analytics services.

## 6. Your controls

- Use Reset search ranking in settings to clear learned ranking records, or the ranking explanation control on a result to forget the relevant preference. There is currently no separate switch to disable learning. Later eligible successful actions may create new records.
- Turn off Auto Tuck to stop automatic tucking and trigger its cleanup. For a recovery record awaiting confirmation, use the action to stop recovering that record. This removes the record without closing pages or deleting the native group.
- Revoke website access in Chrome's extension settings. Resetting search ranking does not revoke permissions or clear preferences or all group recovery records.
- Removing the extension from Chrome removes that installation's local extension storage. There is no additional server copy held by the developer to request deletion of. Uninstalling does not reverse actions already taken on Chrome bookmarks, tabs, history, or groups, clear the system clipboard, or delete copies retained by other tools.

If you allow the extension in incognito windows, it does not query ordinary browsing history or record search selection learning in those windows. Tucking excludes incognito tabs. Other features you actively use there still process the data needed to perform the requested action.

## 7. Contact and policy updates

For privacy inquiries, contact the developer at the email address above. If you voluntarily send email or issue feedback, your email provider or feedback platform processes the content you supply. Please do not include passwords, cookie values, sign-in tokens, or unrelated private browsing records. Such feedback is not an automatic upload by the extension.

When features or data handling change, we will update this policy and its effective date, along with store disclosures and permission requests where applicable. Current data use is limited to providing and improving the user-visible features described here and follows the Chrome Web Store User Data Policy, including its Limited Use requirements.
