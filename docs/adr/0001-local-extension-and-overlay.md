# 0001 · 本地扩展与网页浮层

状态：已采纳。记录日期：2026-10-15，基于现有实现与历史验收补录；不代表这些决策在同一天首次作出。

## 背景

命令面板需要操作当前浏览器状态，并在普通网页内保持一致的位置与键盘体验；页面全局样式和 Vimium 等扩展可能干扰输入。Chrome 内部页又不能注入普通内容脚本。

## 决策

采用 Manifest V3 本地扩展：React 界面负责交互，service worker 读取浏览器状态并执行操作，不引入账号、服务端或遥测。

普通网页通过 activeTab 按需注入，以 Shadow DOM、原生 modal dialog 和空白沙箱 iframe 隔离布局与键盘事件；Chrome 内部页等受限场景回退到 action popup。启动必须收到面板明确的就绪回复，不能只凭 sendMessage 未报错判断已安装。

## 取舍与影响

统一入口保留，但工具栏 popup 的位置受 Chrome 控制，无法保证所有页面都居中。隔离框架使焦点与键盘监听必须使用实际 UI 所在的 document/window，而非代码执行环境的全局 window。

## 未采用的方案

不采用直接嵌入页面 DOM 的面板：已有 CSS 和快捷键冲突；不要求所有页面使用原生 popup：其位置与生命周期限制普通网页体验。

## 相关文档与实现

[实现参考](../INTERACTION-ARCHITECTURE.md) · [content.tsx](../../src/content.tsx) · [background.ts](../../src/background.ts)
