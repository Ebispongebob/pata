# Idea — 阶段 8：Activity 归属式存储重构

> 状态：设计已确认，尚未实施。前置阶段的完成记录保持历史事实；本阶段负责替换旧 Memo 存储模型。

## 为什么要做

当前每条 Memo 独立保存于 `memos/YYYY/MM/*.md`，通过可选 `task_id` 关联 Task。删除 Task 后，关联 Memo 仍留在磁盘、失去上下文；旧 DayPlan 中的 Task ID 也可能悬空，导致 Vault 健康检查报错。这不是偶发写盘故障，而是现有生命周期设计造成的体验断层。

两种记录在界面上具有不同归属：任务详情的活动记录依赖 Task 提供上下文；Today 的独立记录属于某个日期。两者**可以统一为同一种 Activity 数据模型**，但应保存在各自拥有者的 Markdown 文件中，而非作为独立文件、依靠 `task_id` 反向归属。

## 用户价值

- 删除任务时，该任务的活动记录自然随任务消失；独立 Today 记录不受影响。
- Today 继续混合展示任务活动、独立活动和既有完成/重开事件，不因存储位置不同而分裂视图。
- 每条 Activity 通过稳定的 `a-` ID 精确定位、编辑、删除；`[[笔记引用]]` 和标签行为保持一致。
- 结构化读写统一进入 Go Core；保留 Markdown 为唯一数据源、可重建索引和本地优先能力。
- 用户只操作 GUI；Task/Today 源 Markdown 是内部持久化协议，**不以用户直接编辑为主要交互**。Notes 仍然是面向用户编辑的 Markdown。

## 阶段交付

1. Task：Frontmatter 保存任务属性及纯文本 `description`；正文仅保存属于该 Task 的 Activity。
2. DayPlan：沿用 `.pata/plans/YYYY-MM-DD.md`；Frontmatter 保留有序 `task_ids`，正文保存该日期独立 Activity。
3. 统一 Activity：`a-` + ULID、`at` 时间、可选 `tags` / `note_refs`，使用成对 HTML Comment 包围正文。
4. 删除 Task 同时删除其 Activity，清理所有 DayPlan 中对该 Task 的引用；失败时允许可恢复的最终一致性。
5. Today、Tasks、标签、全局搜索、反向链接及健康检查保持功能闭环；已有 Notes `[[` 引用交互不得回退。
6. 以解析、业务、前端集成与回归测试完成验收；**不因本次重构增加新页面、复杂任务状态或新基础设施**。

## 必守边界

- 只有 Today / Tasks / Notes 三个主入口；不存在独立 Memo/Activity 管理入口。
- Task 仍是未完成 / 已完成二态；无优先级、Project、自动日结等新概念。
- Task 描述、Activity 正文延续纯文本 + `[[笔记]]` 的输入行为；Notes 编辑器的 Markdown 行为不变。
- Task Activity 的标签 = 自身标签 ∪ Task 标签（动态继承）；独立 Today Activity 只使用自身标签。
- 单文件安全写入、幂等修复、文件级故障隔离；不实现跨文件事务/WAL。
- 新格式无需兼容当前测试阶段的旧 Memo 数据，但**不允许静默删除**尚存的旧文件；切换前建议备份测试 Vault。
- 未来 CLI 可通过运行中的 Pata App 使用同一 Core，但本阶段**不开发 CLI、IPC、MCP 或 AI 工作流**。

## 文档与验收归属

- [本阶段实施方案](proposal.md)：步骤、改造点、验收与非目标。
- [Markdown Schema](../02-foundation/schema.md)：所有存储字段、Activity 块语法及不变量的**唯一规范**。
- [已确认的产品决策](../01-validate/decisions.md)：该设计对旧 Memo 决策的覆盖关系。

**完成判定**：使用者在 GUI 中创建、查阅、修改记录和删除任务时，所有跨页面行为符合直觉，重启后数据一致且不存在由正常操作制造的悬空 Task/Activity。
