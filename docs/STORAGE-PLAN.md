# 页面存储查看与复制

状态：只读接口与 Cookie 逐网站授权均已获用户确认并实现。Local/Session Storage、Cookie 原生授权、详情与复制已通过日常 Chrome 验收。

## 交互

- 主搜索增加「查看 Local Storage」「查看 Session Storage」「查看 Cookies」，支持中英文别名。
- Enter 进入对应列表。顶部返回按钮、存储类型与当前网站；搜索框按 key / Cookie 名称过滤并高亮。
- 行内显示名称与值摘要；Cookie 附域名、路径，区分同名条目。
- ↑/↓、Ctrl+P/N 导航，Enter 复制原始值并显示成功反馈，列表保留。
- Cmd+K 打开操作：复制值、复制名称、查看详情、刷新。详情显示完整原始值，合法 JSON 提供格式化预览；复制始终保留原始字符串。
- Esc 按操作菜单 → 详情 → 存储列表 → 主搜索逐层返回，恢复原先查询、选择和焦点。
- 延续现有中英文、系统/明暗主题、底栏按键提示。错误、空列表和无搜索结果分别展示。

## 已确认的内部接口

在现有 Request 消息联合类型新增一类只读请求：

```ts
{
  source: 'zing';
  type: 'read-page-storage';
  payload: {
    kind: 'local' | 'session' | 'cookies';
    tabId: number;
    windowId: number;
    expectedUrl: string;
    query?: string; // 仅从主搜索进入时传入，用于记录成功打开的命令
  };
}
```

返回沿用 Reply<T>：成功数据包含实际读取的 `url`、`kind` 与 `entries`。每条记录包含稳定 `id`、`name`、原始 `value`；Cookie 另附 `domain`、`path`、`secure`、`httpOnly`、`sameSite`、`session`、可选 `expirationDate` 与 `partitionKey`。

前台 Entry 增加三个打开存储页面的命令标识；存储内容使用独立的列表状态。复制在用户触发时写入剪贴板，不增加存储写入接口。

后台验证发送者、目标窗口/标签页与预期 URL；覆盖层请求只能读取其所在标签页。页面变化或关闭时明确提示刷新或重新打开，避免混用不同页面的数据。读取成功后仅学习三个命令的使用频率，不记录 key、值或存储列表搜索词。

## 数据范围和权限

- Local/Session Storage：当前标签页顶层页面所属 origin；通过现有 scripting 与 activeTab 临时授权读取。
- Cookies：与当前页面 URL 匹配的 Cookie，使用当前标签页所属 Cookie store，包含可访问的 HttpOnly。分区 Cookie 在浏览器 API 支持时按当前顶层 frame 的 partition key 读取并区分身份。
- Manifest 新增 `cookies` 权限；Cookie 使用用户已确认的逐网站可选授权（详见下方修正），Local/Session Storage 继续使用 activeTab。
- Chrome 内部页等不支持读取的页面显示明确说明。
- 数据仅在本次面板内存中用于显示/复制，不写入扩展存储、日志或远端服务。第一版不提供编辑、删除、脚本执行、跨 iframe 浏览或保存快捷命令。

## 验收

- 隔离本地测试站点：Local/Session 隔离、空字符串、Unicode、多行、JSON、HTML 字符串、长值。
- Cookie：HttpOnly、不同路径的同名项、URL 匹配、独立 store、分区身份与可用性。
- 真实剪贴板读取核对复制值/名称，不仅检查成功提示；覆盖页面覆盖层及可用的 popup 路径。
- 键盘导航、Cmd+K、逐层 Esc、搜索恢复、复制后焦点、刷新、空状态、错误、页面变化。
- 中英文、明暗主题、窄宽度；现有搜索、排序、关闭操作与 Vimium 回归。
- 完成类型检查、逻辑测试、构建与浏览器测试后重载日常 Chrome；使用自建测试页验收，不操作用户站点的存储。

## 参考

- [Raycast Action Panel](https://manual.raycast.com/action-panel)
- [Chrome cookies API](https://developer.chrome.com/docs/extensions/reference/api/cookies)
- [Chrome activeTab](https://developer.chrome.com/docs/extensions/develop/concepts/activeTab)
- [Chrome scripting API](https://developer.chrome.com/docs/extensions/reference/api/scripting)

## 日常 Chrome 验收发现：Cookie 授权修正（已确认并实现）

Local Storage、Session Storage 已在日常 Chrome 的临时本地测试页验证原始值复制、JSON 详情和逐层返回。Cookie 在自动化临时测试扩展（仅授予 loopback host permission）中通过，但在无持久 host permission 的生产配置中失败。

Chromium 的 `CheckHostPermissions` 明确使用 `kUnknownTabId`，忽略 tab-specific grants，故 activeTab 不能满足 Cookie API 的 host permission 要求。来源：[Chromium cookies_api.cc](https://github.com/chromium/chromium/blob/main/extensions/browser/api/cookies/cookies_api.cc)。

用户确认：「可以，按网站授权，支持完整 Cookie」。实现如下：

- 声明 HTTP(S) 的 optional_host_permissions，仅在用户需要查看 Cookies 时申请当前主机及必要父域的网站权限，不预先授予所有网站。
- 缺少网站授权时显示「允许读取此网站的 Cookies」；点击后打开扩展自己的小授权页，明确显示当前网站，用户点击按钮触发 Chrome 原生权限确认。
- 新增内部消息 `open-cookie-access`，payload 为现有 StorageRead 中的 tabId/windowId/expectedUrl（不含存储内容和查询词）。后台校验目标后只负责打开扩展授权页。
- 授权页从 URL 参数读取请求目标，重新验证标签页仍属于该网站；逐一请求明确列出的主机权限，覆盖 HTTP/HTTPS；用 tldts 的公共后缀与私有域规则确定父域边界，不申请其他子域或其他租户权限。授权后关闭授权页，原列表所属 iframe 回到焦点时重新读取；拒绝可返回重试。
- 权限按网站保存，可在 Chrome 的扩展网站访问设置中撤销。Local/Session Storage 沿用 activeTab，无额外授权。
- 补充缺少权限、拒绝/成功授权、导航后目标失效测试；在日常 Chrome 中对临时 loopback 验收网站实测 HttpOnly 复制。

实际 Chrome 验收又发现：分别声明 `http://*/*` 和 `https://*/*` 不允许请求单个 `*://host/*` 模式。已统一 optional_host_permissions 为 `*://*/*`（仍仅为可选声明），增加调用 Chrome 原生 request API 的回归测试。日常 Chrome 对本地验收站点的原生授权、授权后自动返回刷新、HttpOnly 详情和原始值复制均已通过。
