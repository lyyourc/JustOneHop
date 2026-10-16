# 0010 · 内容区锚定与原生窗口边框校准

状态：已采纳（来源内容区原点仍为估算）。记录日期：2026-10-17。更新 [ADR 0001](0001-local-extension-and-overlay.md) 中独立窗口相对来源浏览器外框居中的位置与尺寸策略。

## 背景

普通网页的 Command Palette 与 Tab Switcher 共享内容区水平居中、偏上的浮层；原生页等场景需要独立窗口兜底。若独立窗口按整个浏览器外框居中，或固定采用 750×560 外框，其内容位置和可用高度会与网页浮层分离。原生标题栏和边框又因系统而异，不能把固定的外框尺寸当作面板内容尺寸。

网页浮层按页面视口布局。Chrome 提供来源窗口的屏幕位置与外框尺寸，以及标签页内容区宽高，但无法直接提供内容原点。独立窗口当前按水平对称、底边对齐估算来源内容区；将外框与内容宽度之差平均分到左右，会把左侧 240 DIP 标签栏误当作两侧各 120 DIP，令独立窗口向左偏 120 DIP。这一不对称布局偏差仍是已知限制。

## 决策

新增共享模块 `src/panelGeometry.ts`，供 Command Palette 与 Tab Switcher 的独立窗口使用。网页浮层保留 CSS 布局，`panelRect(viewport)` 与 `.zing-app.overlay` / `.palette` 的规则保持一致：

- 面板水平居中，宽度为 `min(750, viewport.width - 48)`；视口宽度 ≤520 时改为减 20，即左右各留 10px。
- 顶部 inset 为 `clamp(28, viewport.height × 0.16, 150)`；窄屏固定为 24。
- 高度为 `min(516, viewport.height - inset - 24)`，底部预留 24px；函数将极小视口的宽高下限保护为 1px。
- 750×516 表示面板内容矩形，独立窗口的系统标题栏和边框另计。

`nativePanelBounds(owner, tab, frame, zoom)` 以 Chrome 返回的来源 `tab.width/height` 和窗口 `left/top/width/height` 水平对称、底边对齐估算内容区，宽高不超过窗口外框；来源尺寸缺失时沿用函数内的回退值，不将外框视为已测得的内容区。API 尺寸均为屏幕逻辑像素（DIP）。先除以来源 `chrome.tabs.getZoom` 返回的缩放比例，将内容宽高换算成 CSS 视口，交给 `panelRect`，再将结果乘回 zoom、加上估算的内容原点，扣除框架左／上偏移、加上框架总宽高，换算成整数外框坐标与尺寸。

创建窗口时默认采用 `{ left: 0, top: 44, width: 0, height: 44 }`，即先估计 44px 高的原生框架。`popup.tsx` 的独立窗口入口与 `switcher.tsx` 随后调用 `alignPanelWindow`：重新读取来源窗口、标签页和当前 popup，核对归属，popup 用 automatic / per-tab 缩放跟随来源标签页，避免继承扩展站点的旧缩放并影响其他扩展页。自身框架改用 Chrome API 返回的 popup 外框减去 popup 标签页内容尺寸，两者单位均为 DIP，不用 DOM 的 `innerWidth/innerHeight` 与窗口尺寸混减。左右偏移取总宽差的一半，上偏移取总高差减去半宽差；调用 `chrome.windows.update` 校准外框。

校准在 UI 渲染前完成；切换器也在发送 `ready` 就绪交接前完成。校准失败时保留创建时估算。初始 44px 不再作为最终框架高度的固定约束。系统标题栏保留；工具栏 action popup 仍由 Chrome 控制位置，不接入此独立窗口定位策略。

## 取舍与边界

- 同一内容区几何避免两个功能各自维护原生窗口尺寸与位置规则；CSS 与 TypeScript 仍须同步维护。
- 来源内容区的屏幕原点无法直接测量，当前仍使用水平对称、底边对齐估算；垂直标签栏、停靠 DevTools 和系统边框可能造成偏差，不能承诺像素级对齐。`alignPanelWindow` 的窗口／标签页尺寸差值只描述 popup 自身框架，不能修正来源原点的估算误差。
- 边框校准增加一次窗口更新，在界面渲染前完成也不代表系统窗口框架完全不可见。保留原生标题栏与浏览器对窗口边界的约束。
- 沿用现有来源上下文、焦点、松键确认、取消与权限逻辑，不增加几何采样或缓存。

## 未采用的方案

- 继续按来源浏览器外框居中或固定 750×560 外框：与网页浮层的内容区锚点和实际面板尺寸不一致。
- 只减去固定标题栏高度：无法适配不同系统的原生框架；44px 仅用于创建阶段估算。
- 为取得来源内容区原点而增加原生助手或额外页面访问权限：超出本地扩展现有边界，也无法让受限原生页通过普通注入直接提供该测量。
- 将独立窗口与工具栏 action popup 一并定位：工具栏弹窗位置由 Chrome 管理，继续保留其原有行为。

## 相关文档与实现

[位置与承载方式](../INTERACTION-ARCHITECTURE.md#位置与浏览器承载方式) · [最近标签切换](../RECENT-TABS.md) · [panelGeometry.ts](../../src/panelGeometry.ts) · [paletteWindow.ts](../../src/paletteWindow.ts) · [recentTabs.ts](../../src/recentTabs.ts) · [popup.tsx](../../src/popup.tsx) · [switcher.tsx](../../src/switcher.tsx) · [style.css](../../src/style.css)
