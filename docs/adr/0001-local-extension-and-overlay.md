# 0001 · 本地扩展与网页浮层

状态：已采纳；独立窗口的位置与尺寸策略于 2026-10-17 由 [ADR 0010](0010-content-anchor-panel-geometry.md) 更新为内容区锚定。记录日期：2026-10-15，基于现有实现与历史验收补录；不代表这些决策在同一天首次作出。

## 背景

命令面板需要操作当前浏览器状态，并在普通网页内保持一致的位置与键盘体验；页面全局样式和 Vimium 等扩展可能干扰输入。Chrome 内部页又不能注入普通内容脚本。

## 决策

采用 Manifest V3 本地扩展：React 界面负责交互，service worker 读取浏览器状态并执行操作，不引入账号、服务端或遥测。

后台由 esbuild 打包为单文件 IIFE，使用 classic Service Worker，不声明 module。源代码仍可使用 TypeScript 模块，但运行时无模块依赖，因此无需额外的模块加载路径；这也规避了实机观察到的 Chromium installed module worker 加载错误所在路径。初始故障的底层触发条件未复现，验证边界见验收记录。

普通网页通过 activeTab 按需注入，以 Shadow DOM、原生 modal dialog 和空白沙箱 iframe 隔离布局与键盘事件；Chrome 原生页使用独立窗口，后台保存来源上下文，复用同一界面；初版按来源浏览器外框居中，当前位置与尺寸策略由 [ADR 0010](0010-content-anchor-panel-geometry.md) 更新为内容区锚定与自身边框校准。其他受限场景回退到 action popup。2026-10-16 补充：地址栏仍持有键盘焦点时，网页虽能创建浮层，却不能保证接收输入；启动时检查 `document.hasFocus()`，无法接收键盘输入则沿用同一 popup 兜底。启动必须收到面板明确的就绪回复，不能只凭 sendMessage 未报错判断已安装。

## 取舍与影响

独立窗口保留系统标题栏，需要显式维护来源上下文和失焦关闭。早期以来源浏览器外框居中；2026-10-17 起采用 [ADR 0010](0010-content-anchor-panel-geometry.md) 的内容区锚定与自身边框校准，来源内容区原点仍属估算，不保证像素级对齐。普通网页地址栏兜底按用户确认保持 action popup，其位置受 Chrome 控制。隔离框架使焦点与键盘监听必须使用实际 UI 所在的 document/window，而非代码执行环境的全局 window。

## 未采用的方案

不采用直接嵌入页面 DOM 的面板：已有 CSS 和快捷键冲突；不要求所有页面使用原生 popup：其位置与生命周期限制普通网页体验。

## 相关文档与实现

[实现参考](../INTERACTION-ARCHITECTURE.md) · [content.tsx](../../src/content.tsx) · [background.ts](../../src/background.ts)
