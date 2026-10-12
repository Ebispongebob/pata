# Pata · 文档与实施路线

**文档按实施阶段组织，而不是按功能模块组织。** 整个 MVP 划分为下面 **5 个顺序阶段**；只有实际新增一个独立交付阶段时，才新增对应的 `docs/NN-name/` 目录。

| 顺序 | 目录 / 阶段 | 阶段结束应交付什么 | 核心文档 |
|---|---|---|---|
| 1 | [`01-validate`](01-validate/) · 确认产品与交互 | 范围冻结、端到端流程、可离线运行的 UI 原型 | [idea](01-validate/idea.md) · [proposal](01-validate/proposal.md) · [UI](01-validate/ui.md) |
| 2 | [`02-foundation`](02-foundation/) · 数据底座 | 可启动的 Wails 桌面壳、Markdown Go Core、基本任务管理 | [idea](02-foundation/idea.md) · [proposal](02-foundation/proposal.md) · [schema](02-foundation/schema.md) |
| 3 | [`03-daily-loop`](03-daily-loop/) · 每日工作闭环 | Today 计划 + Memo 评论和独立记录 + 历史时间线 | [idea](03-daily-loop/idea.md) · [proposal](03-daily-loop/proposal.md) |
| 4 | [`04-knowledge-loop`](04-knowledge-loop/) · 文档沉淀 | 单列 Notes、长篇 Markdown 编辑、明确的 Task–Note 关联 | [idea](04-knowledge-loop/idea.md) · [proposal](04-knowledge-loop/proposal.md) |
| 5 | [`05-release`](05-release/) · 整合交付 | 全局标签/搜索、安全性回归、macOS MVP 打包验收 | [idea](05-release/idea.md) · [proposal](05-release/proposal.md) · [验收](05-release/acceptance.md) |

阶段 1 的 UI 附加设计： [macOS 27 原生体验与 Magpie 源码参考](01-validate/macos-native.md)，其真实 Wails 验证安排在阶段 2。

## 每阶段的文档约定

- `idea.md`：本阶段为什么需要做、用户价值、**交付结果**。
- `proposal.md`：本阶段具体做什么、**实施顺序**、完成标准及相关功能行为设计。
- 只有对实现有必要时才添加其它文档；放在它**首次需要且负责验收的阶段**，而不是另建 `features/`、`architecture/`、`ui/` 之类横向模块目录。
- 前一个阶段完成之后再进入下一个阶段；需要跨阶段引用时使用相对 Markdown 链接，**不复制成第二套规范**。

## 重要约束

- 三主导航：Today / Tasks / Notes；Memo 不是第四个导航。
- 标签是 Task、Note、Memo 的全局聚合；无 Projects / Inbox。
- Notes 是**单列卡片浏览 → 单主区域编辑**；原型位于 [`01-validate/prototype/index.html`](01-validate/prototype/index.html)。
- Markdown 是数据源；DayPlan 不等于 Due；记录只有一份。
- **MVP 无 CLI、MCP、内置 AI、云同步**；预留代码分层即可，不作具体实现。

## 当前状态

阶段 1 设计已基本完成（待真实用户确认）。阶段 2 已完成：桌面 Spike（P2-001）、存储核心（P2-002，`internal/storage/markdown`）、单 Vault 接入与 Tasks 管理闭环、外部修改感知与冲突提示（P2-003/P2-004）；完成标准已勾选，仅剩用户实机手动走查一次。阶段 3 已完成：Memo 闭环（P3-001，任务详情评论+独立 Memo）、DayPlan 与 Today 计划区块（P3-002，多日安排/due 独立/昨日候选不自动顺延）、今日记录时间线与历史回顾（P3-003，本机时区聚合/完成事件/当前状态注脚）；完成标准已勾选，剩用户实机手动走查。阶段 4 已完成：Notes 服务与单列卡片列表（P4-001）、Vditor 全主区域编辑器与 D19 自动保存（P4-002，含离线包裁剪 23MB→7.5MB 与 cdn dist 层修正）、Task–Note 显式关联（P4-003）；完成标准已勾选，剩用户实机手动走查。阶段 5 进行中：全局标签聚合与跨类型搜索后端（P5-001）、侧边栏真实标签与单列标签视图（P5-002）、⌘K/⌘P 全局搜索浮层（P5-003）已交付（各含独立审查与返工）；剩余：可靠性回归与错误报告、快捷键/焦点/无障碍/打包打磨、实机 macOS 回归与真实资料走查。
