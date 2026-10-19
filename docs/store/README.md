# 商店图片与上传清单

[整套预览](contact-sheet.png) · [商店文案](../STORE-LISTING.md) · [尺寸与 SHA-256 清单](assets.json) · [采集记录](capture.json)

## 按语言上传截图

Chrome Web Store 支持按语言分别上传截图；小宣传图与 Marquee 大宣传图不能本地化，所有语言共用英文版。参见[官方本地化说明](https://developer.chrome.com/docs/webstore/cws-dashboard-listing#localize-your-listing)。

| 用途 | 中文商店页 (`zh_CN`) | 英文商店页 (`en`) | 尺寸 |
| --- | --- | --- | --- |
| 截图 1：统一搜索（建议排第一） | [zh-1-search.png](zh-1-search.png) | [en-1-search.png](en-1-search.png) | 1280×800 |
| 截图 2：最近标签切换（深色模式） | [zh-2-switcher.png](zh-2-switcher.png) | [en-2-switcher.png](en-2-switcher.png) | 1280×800 |
| 截图 3：右键操作菜单 | [zh-3-actions.png](zh-3-actions.png) | [en-3-actions.png](en-3-actions.png) | 1280×800 |

| 共用素材 | 上传文件 | 尺寸 |
| --- | --- | --- |
| 小宣传图（Small Promo Tile） | [promo-440x280.png](promo-440x280.png) | 440×280 |
| 大宣传图（Marquee Promo Tile，可选） | [promo-1400x560.png](promo-1400x560.png) | 1400×560 |
| 商店图标（Store Icon） | [store-icon-128.png](store-icon-128.png) | 128×128 |

`en-promo-*` 与对应 `promo-*` 内容相同，是生成器保留的英文副本；上传时只选表中的共用文件。中文宣传图已移除，后续生成也不再输出。

只上传表中的单张 PNG，不上传 `contact-sheet.png`、`raw/`、JSON 或本说明。发布包中的 `zh_TW` 沿用简体中文翻译；商店后台如启用该语言，请核对其文案与截图，不将其描述为繁体中文翻译。

## 画面来源与展示整理

- 扩展文件从本地 `dist/` 加载到临时独立 Chrome profile。标签页标题、网址、书签、历史和站点图标是本地路由提供的演示数据；不读取个人浏览器资料，也不代表真实网页内容、真实发言或第三方背书。站点图标是脚本绘制的示意图，经 Chrome 原生 `_favicon` 缓存显示。
- 主搜索、右键菜单和最近标签切换器的面板来自扩展采集。采集前对展示 DOM 做了整理：操作菜单仅保留七项核心操作，切换器移除扩展页面自身的结果。这些画面不能作为完整菜单内容或系统快捷键链路的验收证据。
- 外围 macOS Chrome 风格窗口、地址栏与 GitHub 风格网页背景为合成排版，不是完整浏览器窗口的原样截屏。浅色截图配浅色面板，深色截图配深色面板。
- `440×280` 小宣传图使用放大的搜索卡片示意；`1400×560` 大宣传图组合英文浅色搜索与深色切换器采集图。两者均属于宣传排版。
- 主要展示统一搜索、最近标签切换和常用标签操作；隐藏收起菜单项不改变产品实际提供的功能与权限披露。

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

成品 PNG、`raw/`、总览、JSON 清单与生成脚本一起提交，保留所用素材及重排版输入。仅在正式更新素材时提交新图，临时试稿无需留进历史。这组素材只有数 MB，无需 Git LFS。

商店图片通过商店后台单独上传，不放进扩展 ZIP。发布包只包含重新构建的 `dist/` 内容，打包方法和剩余待办见[商店文案的发布清单](../STORE-LISTING.md#发布前待填写)。
