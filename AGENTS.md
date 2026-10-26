# JustOneHop · 小范围瞬移 · Agent 工作边界

## 产品边界

- **Human First**：鼠标、熟悉的快捷键与两者交替都是完整使用路径；功能不能依赖用户记住隐晦快捷键或模式前缀。
- **Unified & Predictable**：所有功能从主搜索中英文直达；相关性分级优先于本机使用习惯，学习权重只在同级内微调。危险操作须显式检索或从菜单触发，并保护固定标签页。
- **Chrome Native**：复用原生 Tab Group、`_favicon` 缓存与 `sessions`；视觉遵循 Chrome CR2023 Omnibox / Tab Search 的安静单色图标槽、胶囊搜索与柔和蓝色选中态。

## 实现范围

边缘情况的防护应权衡具体触发路径、发生依据、用户影响与复杂度代价。当前需求内的必要防护与验证直接执行，不逐项确认；缺乏具体依据且超出当前目标的扩展仅作为建议提出，不擅自实施。

## 按任务加载

- **新增或修改 UI**：先读 [交互架构](docs/INTERACTION-ARCHITECTURE.md)，逐项核对适用的列表、底栏／菜单、返回与上下文、键盘、承载与延迟契约；这些契约同样约束主搜索、二级视图和两种 Tab Switcher 承载。
- **修改定位或承载方式**：先读 [ADR 0010](docs/adr/0010-content-anchor-panel-geometry.md)，分别核对网页视口与来源浏览器窗口两种定位基准，以及共享尺寸和交互契约。
- **选择或执行验证**：先读 [测试指南](docs/TESTING.md) 的分层矩阵与预算，按实际改动选择最小充分验证；纯 UI、逻辑和工具链改动走各自分支。浏览器用例合计覆盖适用的鼠标、纯键盘和交替流程。
- **评审实现或验证结论**：读 [评审标准](docs/CODING_STANDARDS.md)，检查跨视图一致性、需求与实现的区别，以及证据是否独立于被测假设。

架构决策变更同步更新 `docs/adr/`；组件契约变更同步更新 [交互架构](docs/INTERACTION-ARCHITECTURE.md)（严格遵循黑盒契约与防腐规范，严禁写入代码实现流水）。README（`README.md`、`README.zh-CN.md`）仅在用户明确要求时更新。仅核心功能或核心交互变化同步更新使用指南（`docs/USAGE.md`、`docs/USAGE.zh-CN.md`）；展示微调、边界修复等细节变更不追加使用说明。实际验收证据记入 [验收记录](docs/ACCEPTANCE.md)，通过项仅适用于所验证的构建与用例。

## 文档维护边界与防腐红线

- **严禁把实现细节当架构契约 (No Pseudocode or Workarounds in Architecture)**：[交互架构](docs/INTERACTION-ARCHITECTURE.md) 是黑盒行为规范，仅定义**用户心智模型、全局输入状态机、组件间外部契约与尺寸边界**。严禁记录白盒实现技巧（如“监听某 DOM 变量”、“创建临时 textarea 规避焦点”、“某函数内部 if-else 分支”）、严禁记录代码重构历史（如“某旧字段不再读取”）。实现层面的 edge case 必须写在源码注释中。
- **契约变更的准入检验 (The Black-Box Test)**：修改架构文档前必须自问：*“若明天重构了底层 DOM 或重写了该函数，此规则是否仍然成立？”* 若不成立，说明是代码实现细节，严禁写入架构。
- **严禁向验收记录倾倒过程性日志 (No Procedural Run Logs in Acceptance)**：[验收记录](docs/ACCEPTANCE.md) 是当前版本能力的**全局验收基准与状态矩阵**。严禁向其中追加单次任务的运行耗时、用例复验流水或本地临时 `test-results/runs/` 路径。单次验证结论仅在任务报告或 Commit 描述中体现；仅当系统级验收状态变更、新增功能验收维度或发现新的架构受限边界时，对 [验收记录](docs/ACCEPTANCE.md) 进行**就地更新**。
- **职责严格隔离**：
  - **交互规范与契约**（What & Invariants）：就地更新 [交互架构](docs/INTERACTION-ARCHITECTURE.md) 既有章节。
  - **设计背景与演进取舍**（Why & Trade-offs）：写入 [ADR](docs/adr/)。
  - **测试规范与矩阵**（Testing Matrix）：写入 [测试指南](docs/TESTING.md)；版本验收基准就地维护于 [验收记录](docs/ACCEPTANCE.md)。
  - **过程性测试流水与代码修补细节**（How & Transient Runs）：写入源码注释、Commit 描述或终端任务输出，严禁向规范与验收文档倾倒。

