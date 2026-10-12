# Pata · Agent 项目指引

**项目名称：啪嗒 / Pata。** 阶段 2（Wails 桌面壳 + Markdown 数据底座 + Tasks 管理）已实现并验收；当前处于阶段 3（每日工作闭环）待启动状态。

## 开始阅读

1. 阅读 [docs/README.md](docs/README.md)，按 01 → 06 的顺序了解开发计划。
2. 阅读 [阶段 1 产品提案](docs/01-validate/proposal.md)、[已确认的取舍](docs/01-validate/decisions.md)、[UI 规范](docs/01-validate/ui.md)。
   - macOS 原生窗口细节和 Magpie 源码参考见 [macos-native.md](docs/01-validate/macos-native.md)；浏览器原型不等于真实 Liquid Glass 验证。
3. 数据 Schema 的**单一来源**为 [阶段 2 schema.md](docs/02-foundation/schema.md)；示例位于 `docs/02-foundation/examples/`，不是生产数据。
4. 直接打开 `docs/01-validate/prototype/index.html` 查看静态 UI 原型，无服务依赖。

## 修改文档/执行计划

- `docs/` **仅以实施阶段分目录**，每个阶段有 `idea.md`、`proposal.md`，其他设计资料留在负责它的阶段内。
- 需要修改某个交付目标时，修改该阶段的 proposal 并更新对应完成标准；涉及产品边界的决定同步更新 `docs/01-validate/decisions.md`。
- 不要把功能当做新阶段单独建目录，除非整个交付计划确实新增一个顺序实施步骤。
- 保持 Markdown 可直接读取、数据源唯一、不重复建模。
- **MVP 不实现 CLI/MCP/AI 集成**；禁止因 Agent 使用需求私自扩大范围。
- 本地业务目录后续使用 `.pata/plans/` 保存 DayPlan（须备份），不能当缓存随意删除。

## 产品不可破坏的规则

- 仅 Today / Tasks / Notes 三个主导航。
- Task + Memo + Note，DayPlan 为轻量内部结构。
- 全局标签聚合 Task、Note、Memo；任务关联 Memo 通过 Task 标签参与匹配。
- Today 计划与 Task due 相互独立；不强制下班复盘。
- Notes 无嵌套三列结构：单列浏览、全主区域编辑。
- 参照 macOS 27 HIG + Magpie 的窗口实现；尊重系统主题、强调色、辅助功能；Liquid Glass 可选，非 MVP 必须。
- 核心原则：Less is More / Record Once / Local First。
