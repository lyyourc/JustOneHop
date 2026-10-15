# zing

一个键盘优先的 Chrome 命令面板。统一搜索当前窗口的标签页、书签、浏览器命令和保存的脚本；也可查看并复制当前网站的 Local Storage、Session Storage 与 Cookie。

个人本地加载版，无账号、后端或遥测。支持简体中文与英文，语言默认跟随 Chrome；主题默认跟随系统，也可在设置中手动选择。

## 安装

需要 Node.js / npm 和 Chrome 127+。脚本执行需要 Chrome 135+，并开启相应的用户脚本能力，详见 [使用指南](docs/USAGE.md#脚本收藏与-ctrltab-配置)。

```sh
npm ci
npm run build
```

1. 打开 `chrome://extensions`，开启「开发者模式」。
2. 选择「加载已解压的扩展程序」，加载本项目生成的 **dist/** 目录。
3. 按 **Cmd+Shift+P**（Windows/Linux 为 **Ctrl+Shift+P**）或点击工具栏的 zing 图标。

`dist/` 不纳入 Git，首次克隆后需要构建。快捷键冲突时，在 `chrome://extensions/shortcuts` 中修改；也可搜索「快捷键」进入设置。

## 开始使用

输入关键词即可搜索，不需要模式前缀。例如 `new tab`、`settings`、`new script`、`local storage`，也支持相应中文关键词。

| 操作 | macOS 快捷键 |
| --- | --- |
| 选择候选项 | ↑ / ↓ 或 Ctrl+P / Ctrl+N |
| 执行主操作 | Enter |
| 当前候选项的操作菜单 | Cmd+K |
| 打开设置 | Cmd+, |
| 返回上一层；在主搜索关闭面板 | Esc |
| 空搜索框返回上一层 | Backspace |
| 保存脚本 | Cmd+Enter |
| 最近标签页切换 | 按住 Control+J，N/P 选择，松开 Control 确认 |

Windows/Linux 的菜单、设置和保存操作使用 Ctrl 代替 Command；最近标签切换默认使用 Ctrl+,。多层返回、文本编辑和平台差异见 [使用指南](docs/USAGE.md)。

- **标签页与书签**：搜索、切换标签页或打开书签；Cmd+K 可固定、静音、关闭选中的标签页。批量关闭限定当前窗口并保留固定页。
- **搜索排序**：相关命令优先，命中词高亮；成功选择会影响同词排序，空搜索展示最近标签页和常用命令。可在设置中重置习惯记录。
- **页面存储**：按名称查找并复制值，查看 JSON 详情。完整 Cookie 读取首次需要逐网站授权。
- **脚本**：搜索「新建脚本」保存 JavaScript，之后按名称查找，在当前普通网页手动运行。结果页底栏和 Cmd+K 提供复制结果、重新运行。

## 使用边界与数据

普通网页显示居中浮层，Chrome 内置页等受限页面使用工具栏弹窗。受限页面无法执行脚本或读取页面存储；最近标签切换在地址栏等未监听区域快速点按时可能需要 Enter 确认。

偏好、保存的脚本及搜索使用记录只存本机；页面存储值和脚本结果仅保留在当前面板。脚本不会自动执行，但手动运行的代码可以修改页面或发起网络请求。脚本环境不提供网页自身的 JavaScript 变量或油猴 GM_* API。

详细权限、Chrome 版本差异和 Ctrl+Tab 手动配置见 [使用指南](docs/USAGE.md)。

## 开发与测试

React、TypeScript、Fuse.js、esbuild。测试使用独立临时浏览器配置和本地页面。

```sh
npm run dev                       # 监听源码并构建
npx playwright install chromium   # 首次浏览器测试前安装
npm run check                     # 类型检查、单元测试、构建、端到端测试
```

也可分别运行 `npm run typecheck`、`npm test`、`npm run build`、`npm run test:e2e`。`ZING_CHROMIUM_PATH` 可指定 Chrome for Testing 可执行文件；`ZING_VIMIUM_PATH` 可指定 Vimium 目录进行兼容测试。

构建后在 Chrome 扩展管理页重新加载 zing，并刷新测试网页。`public/` 的 manifest 或语言包改变后需重新运行构建。`dist/`、依赖和测试截图不提交到 Git。

## 文档

| 文档 | 回答的问题 |
| --- | --- |
| [使用指南](docs/USAGE.md) | 各项功能如何使用，有哪些限制？ |
| [ADR 索引](docs/adr/README.md) | 为什么采用这些方案，接受了哪些取舍？ |
| [交互实现参考](docs/INTERACTION-ARCHITECTURE.md) | 组件、导航、焦点与权限如何组织？ |
| [页面存储实现](docs/PAGE-STORAGE.md) | 如何读取、验证目标并按网站授权？ |
| [最近标签切换实现](docs/RECENT-TABS.md) | 松键、焦点与快速点按如何处理？ |
| [历史验收记录](docs/ACCEPTANCE.md) | 每次迭代验证过什么？ |
