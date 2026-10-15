# 0004 · 只读页面存储与逐网站 Cookie 授权

状态：已采纳。记录日期：2026-10-15，基于现有实现与历史验收补录；不代表这些决策在同一天首次作出。

## 背景

需要查看并准确复制 Local/Session Storage 和包含 HttpOnly 的 Cookie。初期 loopback 测试配置具有网站权限，但实际生产配置仅凭 activeTab 不能满足 Cookie API 的网站授权要求。

## 决策

存储查看器只提供读取、详情与复制，不提供编辑或删除。Local/Session Storage 使用 activeTab 读取当前顶层页面；Cookie 使用 cookies 权限加按需申请的具体网站权限。

Cookie 授权通过独立扩展页面展示目标主机和必要父域，再由用户点击触发 Chrome 原生权限请求。每次读取验证发送者、标签页、窗口和预期 URL，防止导航后读取错误页面。

## 取舍与影响

Cookie 首次使用多一步授权，权限可在 Chrome 设置撤销。完整 Cookie 支持带来父域、分区和 store 的处理成本；不能把 content script 匹配声明视为 Cookie 网站授权。值仅存在面板内存，不写入扩展存储、日志或学习记录。

## 未采用的方案

仅通过 document.cookie 会遗漏 HttpOnly；只依赖 activeTab 无法满足此 API；预先申请所有网站访问权超出当前需要。

## 相关文档与实现

[当前接口与授权实现](../PAGE-STORAGE.md) · [cookieAccess.ts](../../src/cookieAccess.ts) · [生产授权问题验收](../ACCEPTANCE.md)
