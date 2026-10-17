# zing · Agent 工作边界

## 产品边界

- **Human First**：鼠标、熟悉的快捷键与两者交替都是完整使用路径；功能不能依赖用户记住隐晦快捷键或模式前缀。
- **Local & Honest**：无账号、服务端或遥测；权限按需最小化，Cookie 逐站授权，UserScript 单次显式运行。命名忠于行为：「收起」只移入原生折叠组，不关闭或 discard 页面；重启后无法唯一确认归属的组交由用户核对。
- **Unified & Predictable**：所有功能从主搜索中英文直达；相关性分级优先于本机使用习惯，学习权重只在同级内微调。危险操作须显式检索或从菜单触发，并保护固定标签页。
- **Chrome Native**：复用原生 Tab Group、`_favicon` 缓存与 `sessions`；视觉遵循 Chrome CR2023 Omnibox / Tab Search 的安静单色图标槽、胶囊搜索与柔和蓝色选中态。

## 按任务加载

- **新增或修改 UI**：先读 [交互架构](docs/INTERACTION-ARCHITECTURE.md)，逐项核对适用的列表、底栏／菜单、返回与上下文、键盘、承载与延迟契约；这些契约同样约束主搜索、二级视图和两种 Tab Switcher 承载。
- **修改定位或承载方式**：先读 [ADR 0010](docs/adr/0010-content-anchor-panel-geometry.md)，区分当前内容区估算与暂停中的屏幕定位目标；后者尚未实现或验收。
- **选择或执行验证**：读 [测试指南](docs/TESTING.md)，按影响范围选择用例。UI 改动须通过类型检查、单元测试、构建与相关 Playwright 测试，覆盖鼠标、纯键盘和交替流程。
- **评审实现或验证结论**：读 [评审标准](docs/CODING_STANDARDS.md)，检查跨视图一致性、需求与实现的区别，以及证据是否独立于被测假设。

架构决策变更同步更新 `docs/adr/`；组件契约变更同步更新交互架构；用户可见行为变更同步更新 `README.md`、`README.en.md` 与 `docs/USAGE.md`。实际验收证据记入 [验收记录](docs/ACCEPTANCE.md)，通过项仅适用于所验证的构建与用例。
