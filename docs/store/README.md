# 商店图片与上传清单

[整套预览](contact-sheet.png) · [商店文案](../STORE-LISTING.md) · [尺寸与 SHA-256 清单](assets.json) · [采集记录](capture.json)

本组素材基于 `0.3.0` 本地发布候选构建采集并渲染，已核对尺寸、SHA-256 哈希和画面表现；实际版本与采集环境见 `capture.json`，成品文件清单见 `assets.json`。

## 按语言上传截图

Chrome Web Store 支持按语言分别上传最多 5 张详情页截图（`1280×800`）；小宣传图与 Marquee 大宣传图不能按语言区分，所有语言共用英文版。参见[官方本地化说明](https://developer.chrome.com/docs/webstore/cws-dashboard-listing#localize-your-listing)。

| 顺序与展示主题 | 中文商店页 (`zh_CN`) | 英文商店页 (`en`) | 尺寸 |
| --- | --- | --- | --- |
| 截图 1：统一搜索与智能补全（浅色） | [zh-1-search.png](zh-1-search.png) | [en-1-search.png](en-1-search.png) | 1280×800 |
| 截图 2：最近标签切换 Tab Switcher（深色） | [zh-2-switcher.png](zh-2-switcher.png) | [en-2-switcher.png](en-2-switcher.png) | 1280×800 |
| 截图 3：右键或 ⌘K 连续整理标签页（浅色） | [zh-3-actions.png](zh-3-actions.png) | [en-3-actions.png](en-3-actions.png) | 1280×800 |
| 截图 4：免开 DevTools 查看 Storage & Cookie（深色） | [zh-4-storage.png](zh-4-storage.png) | [en-4-storage.png](en-4-storage.png) | 1280×800 |
| 截图 5：自定义搜索图标与分类设置（浅色） | [zh-5-settings.png](zh-5-settings.png) | [en-5-settings.png](en-5-settings.png) | 1280×800 |

| 共用素材 | 上传文件 | 尺寸 |
| --- | --- | --- |
| 小宣传图（Small Promo Tile） | [promo-440x280.png](promo-440x280.png) | 440×280 |
| 大宣传图（Marquee Promo Tile，可选） | [promo-1400x560.png](promo-1400x560.png) | 1400×560 |
| 商店图标（Store Icon） | [store-icon-128.png](store-icon-128.png) | 128×128 |

本次提交：英文 5 张作为 Global screenshots，简体中文 5 张作为 `zh-CN` Localized screenshots；`zh-TW` 使用全局英文截图及注明简体中文的介绍。

`en-promo-*` 与对应 `promo-*` 内容相同，是生成器保留的英文副本；上传时只选表中的共用文件。

只上传表中的单张 PNG，不上传 `contact-sheet.png`、`raw/`、JSON 或本说明。发布包中的 `zh_TW` 沿用简体中文翻译；商店后台如启用该语言，请核对其文案与截图，不将其描述为繁体中文翻译。

## 画面来源与展示整理

- 扩展文件从本地 `dist/` 加载到临时独立 Chrome profile。标签页标题、网址、书签、历史、演示 Local Storage 键值和站点图标均由本地路由与测试页提供；不读取个人浏览器资料，也不代表真实网页内容、真实发言或第三方背书。站点图标由脚本绘制示意图，经 Chrome 原生 `_favicon` 缓存显示。
- 主搜索（含查询补全与学习标记）、最近标签切换器、右键操作菜单、只读存储查看器和分类设置／自定义搜索图标界面均来自扩展真实渲染采集。采集时覆盖临时 profile 的 `chrome.tabs.get/query`，将独立采集页绑定至演示来源标签页并过滤采集页自身；同时覆盖 `chrome.scripting.executeScript` 返回预设存储数据。截图展示真实组件与模拟数据，不作为真实存储读取的集成验收证据。
- 外围 macOS Chrome 风格窗口、地址栏与 GitHub 风格网页背景为合成排版，不是完整浏览器窗口的原样截屏。浅色截图配浅色面板，深色截图配深色面板。
- `440×280` 小宣传图使用放大的搜索卡片示意；`1400×560` 大宣传图组合英文浅色搜索与深色切换器采集图。两者均属于宣传排版。

## 重新生成

在仓库根目录运行：

```sh
npm run build
node scripts/store-assets.mjs
```

如果只改外围排版或文案、产品原始采集图没有变化，可复用已有原始图快速渲染：

```sh
node scripts/store-assets.mjs --render-only
```

`--render-only` 更新成品图、总览和尺寸／哈希清单，不重新采集面板，也不更新采集时间。`capture.json` 对应原始采集；`assets.json` 对应最新渲染。

## Git 与发布包

成品 PNG、`raw/`、总览、JSON 清单与生成脚本一起提交，保留所用素材及重排版输入。仅在正式更新素材时提交新图，临时试稿无需留进历史。

商店图片通过商店后台单独上传，不放进扩展 ZIP。通过 `npm run package:store` 生成发布包：排除 `*.map` 并清理 JS/CSS 末尾的 `sourceMappingURL` 注释，本地 `dist/` 保留调试信息，打包方法和提交检查见 [Chrome Web Store 发布指南](../STORE-LISTING.md#5-本地打包与发布检查清单)。
