# 页面存储实现参考

使用方法见 [使用指南](USAGE.md#页面存储)，逐网站 Cookie 授权的动机与取舍见 [ADR 0004](adr/0004-page-storage-permissions.md)。本功能已实现，本文描述当前接口与读取边界。

## 接口入口

当前只读请求如下，完整类型以 [src/types.ts](../src/types.ts) 为准：

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

前台 Entry 包含三个打开存储页面的命令标识；存储内容使用独立的列表状态。复制在用户触发时写入剪贴板，不增加存储写入接口。

后台验证发送者、目标窗口/标签页与预期 URL；覆盖层请求只能读取其所在标签页。页面变化或关闭时明确提示刷新或重新打开，避免混用不同页面的数据。读取成功后仅学习三个命令的使用频率，不记录 key、值或存储列表搜索词。

## 权限与读取边界

- Local/Session Storage 读取当前标签页顶层页面的 origin，使用 scripting 与 activeTab 临时授权。
- Cookies 使用当前标签页所属 cookie store，按当前 URL 匹配，包含 HttpOnly；支持时额外读取当前顶层 frame 的分区 Cookie，区分同名、不同路径和分区的记录。
- Cookie API 使用 `cookies` 与具体网站的 host permission。缺少授权时，通过 `open-cookie-access` 请求打开授权页；payload 复用 tabId/windowId/expectedUrl，不含存储内容。
- 授权页重新验证当前网站，在用户点击后请求 Chrome 原生授权；请求当前主机与必要父域的 HTTP/HTTPS 权限，tldts 确定公共后缀和私有域边界。拒绝可重试，授权可由用户在 Chrome 设置撤销。
- Manifest 的 `*://*/*` 仅为 optional_host_permissions 声明，实际请求使用具体主机模式。Local/Session Storage 不要求此额外授权。
- 授权页关闭后，原列表所在 iframe 恢复焦点并重新读取。页面导航、关闭或移走时校验目标并给出错误提示。
- 存储查看器只读，不提供编辑、删除或跨 iframe 浏览。名称和值仅存在当前面板内存，不写入扩展存储、日志或远端服务；成功打开命令可参与使用排序，条目与列表内查询不参与。

## 实现与验证入口

- [页面读取](../src/pageStorage.ts)、[授权范围](../src/cookieAccess.ts)、[授权页](../src/cookie-access.tsx)、[列表与详情](../src/StorageView.tsx)。
- [读取测试](../tests/pageStorage.test.ts)、[浏览器测试](../tests/palette.spec.ts)覆盖原始字符串、空值、JSON、同名 Cookie、权限拒绝和页面变化；验证剪贴板真实值，不仅检查提示。
- `node tests/storage-manual.mjs` 启动隔离的本地验收站点。历史验证结果保留在 [验收记录](ACCEPTANCE.md)。
