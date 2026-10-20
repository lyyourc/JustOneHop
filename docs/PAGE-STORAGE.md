# 页面存储实现参考 · Page Storage Technical Reference

用户使用指引见 [使用指南 (中文)](USAGE.zh-CN.md#6-开发者利器免开-devtools-查看-storage--cookies) · [User Guide (English)](USAGE.md#6-developer-inspection-localstorage-sessionstorage--cookies)。逐网站 Cookie 授权的动机与架构取舍见 [ADR 0004](adr/0004-page-storage-permissions.md)。

本文档记录小范围瞬移的只读页面存储查看器（Local Storage、Session Storage、Cookies）的内部接口契约、权限作用域与安全读取边界。

---

## 1. 消息接口与请求契约

页面存储采用单一内部只读请求，由前台视图向后台发出。TypeScript 完整类型以 [`src/types.ts`](../src/types.ts) 为准：

```ts
{
  source: 'justonehop';
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

### 响应数据契约 (`Reply<T>`)

成功返回时包含实际读取的 `url`、`kind` 与条目列表 `entries`：
- **Local / Session Storage**：每条记录包含稳定 `id`、`name`（键名）与原始字符串 `value`。
- **Cookies**：除 `name` 与 `value` 外，额外提供 `domain`、`path`、`secure`、`httpOnly`、`sameSite`、`session`、可选的 `expirationDate`，以及 Chrome 132+ 支持的 `partitionKey`。

前台接收后在双栏视图中展示：左侧键名列表支持关键词筛选，右侧进行 JSON 格式化高亮与元数据呈现。按下 Enter 或点击底栏直接向系统剪贴板写入原始字符串，不提供存储修改或删除接口。

后台严格校验 `sender`、目标 `windowId`/`tabId` 与 `expectedUrl`；网页覆盖层仅能读取自身所在的活动标签页。页面若发生导航或关闭，请求立即拒绝并提示刷新，防止串读不同页面的敏感数据。

---

## 2. 权限模型与读取边界

| 存储类型 | 依赖权限 | 作用域与读取边界 |
| --- | --- | --- |
| **Local Storage** | `activeTab`, `scripting` | 仅读取当前标签页顶层 Frame 的 `origin`。使用临时脚本注入提取，无需声明全网 Host 权限。 |
| **Session Storage** | `activeTab`, `scripting` | 仅读取当前标签页顶层 Frame 的 `sessionStorage`。不跨 Tab、不跨 Frame。 |
| **Cookies** | `cookies`, 可选网站主机权限 | 匹配当前标签页 URL 的所属 Cookie Store（包含 `HttpOnly` 及顶层 Frame 的分区 Cookie）。区分同名、不同路径与分区的记录。 |

### Cookie 逐站授权机制

- Manifest 中仅声明 `optional_host_permissions: ["*://*/*"]`，绝不在安装时申请全网权限。
- 当目标站点的 Cookie 需要访问权限时，扩展通过 `open-cookie-access` 打开本地独立授权引导页（[`src/cookie-access.tsx`](../src/cookie-access.tsx)）。
- 授权页利用 `tldts` 库严格计算当前域名及其可注册父域（Registrable Domain），仅向 Chrome 原生权限系统申请该站点及必要父域的 HTTP/HTTPS 权限，绝不申请同级兄弟子域的通配符。
- 用户授权后，授权页自动关闭，面板无缝重新读取 Cookie；用户拒绝可重试，用户可随时在 Chrome 设置中撤销该站点的授权。

### 内存隔离与零持久化

- **只读保证**：存储查看器不提供编辑、修改、删除或注入功能。
- **内存生命周期**：读取到的 Key 和 Value 仅在当前面板渲染进程的 React State 中暂存，关闭面板即从内存中彻底销毁。
- **零日志、不上云**：不写入任何持久存储（如 `chrome.storage.local`），不记录任何网络日志，绝无远程上报。仅命令入口（如 `local storage`）参与搜索频率学习，条目本身与键名绝不参与。

---

## 3. 源码实现与验证入口

- **核心实现**：
  - [页面读取与注入](../src/pageStorage.ts)
  - [Cookie 授权范围计算](../src/cookieAccess.ts)
  - [Cookie 授权引导页](../src/cookie-access.tsx)
  - [存储双栏视图组件](../src/StorageView.tsx)
- **自动化测试**：
  - [页面存储单元测试](../tests/pageStorage.test.ts)
  - [端到端浏览器测试](../tests/palette.spec.ts)（覆盖原始字符串、空值、超大 JSON、同名 Cookie、权限拒绝与页面跳转防护，验证系统剪贴板真实拷贝值）。
- **本地手工测试**：
  - 运行 `node tests/storage-manual.mjs` 启动本地隔离测试环境。
