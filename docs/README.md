# Pata · 文档与实施路线

**文档按实施阶段组织，而不是按功能模块组织。** 当前路线包含 **8 个顺序阶段**：前五阶段完成业务 MVP，第六阶段负责品牌接入，第七阶段负责笔记引用，第八阶段以一个独立交付阶段完成 Activity 归属式存储重构。只有实际新增一个独立交付阶段时，才新增对应的 `docs/NN-name/` 目录。

| 顺序 | 目录 / 阶段 | 阶段结束应交付什么 | 核心文档 |
|---|---|---|---|
| 1 | [`01-validate`](01-validate/) · 确认产品与交互 | 范围冻结、端到端流程、可离线运行的 UI 原型 | [idea](01-validate/idea.md) · [proposal](01-validate/proposal.md) · [UI](01-validate/ui.md) |
| 2 | [`02-foundation`](02-foundation/) · 数据底座 | 可启动的 Wails 桌面壳、Markdown Go Core、基本任务管理 | [idea](02-foundation/idea.md) · [proposal](02-foundation/proposal.md) · [schema](02-foundation/schema.md) |
| 3 | [`03-daily-loop`](03-daily-loop/) · 每日工作闭环 | Today 计划 + Memo 评论和独立记录 + 历史时间线 | [idea](03-daily-loop/idea.md) · [proposal](03-daily-loop/proposal.md) |
| 4 | [`04-knowledge-loop`](04-knowledge-loop/) · 文档沉淀 | 单列 Notes、长篇 Markdown 编辑、明确的 Task–Note 关联 | [idea](04-knowledge-loop/idea.md) · [proposal](04-knowledge-loop/proposal.md) |
| 5 | [`05-release`](05-release/) · 整合交付 | 全局标签/搜索、安全性回归、macOS MVP 打包验收 | [idea](05-release/idea.md) · [proposal](05-release/proposal.md) · [验收](05-release/acceptance.md) |
| 6 | [`06-branding`](06-branding/) · 品牌接入与 Logo 动画 | 三层卡片 V2 静态品牌接入、启动与记录成功动画、菜单栏增强验证 | [idea](06-branding/idea.md) · [proposal](06-branding/proposal.md) |
| 7 | [`07-note-links`](07-note-links/) · 笔记引用闭环 | 笔记正文 / 任务描述 / 活动记录统一 `[[` 引用、点击跳转、自动被引用来源 | [idea](07-note-links/idea.md) · [proposal](07-note-links/proposal.md) |
| 8 | [`08-activity-storage`](08-activity-storage/) · Activity 归属式存储重构 | 统一内嵌 Activity，Task/DayPlan 新格式、删除生命周期、搜索/时间线/链接回归 | [idea](08-activity-storage/idea.md) · [proposal](08-activity-storage/proposal.md) · [Schema](02-foundation/schema.md) |

阶段 1 的 UI 附加设计： [macOS 27 原生体验与 Magpie 源码参考](01-validate/macos-native.md)，其真实 Wails 验证安排在阶段 2。

阶段 6 的品牌资料：[idea](06-branding/idea.md) · [proposal](06-branding/proposal.md) · [实施记录](06-branding/implementation-notes.md) · [V2 静态资源总览](06-branding/resources/pata-branding-refined-v2/previews/overview.png)。V2 静态品牌、构建图标、应用内动画与**静态菜单栏托盘**均已接入并有构建记录；用户选择不做菜单栏帧动画。**macOS 最终实机目视、托盘点击与无障碍验收未完成**。

## 每阶段的文档约定

- `idea.md`：本阶段为什么需要做、用户价值、**交付结果**。
- `proposal.md`：本阶段具体做什么、**实施顺序**、完成标准及相关功能行为设计。
- 只有对实现有必要时才添加其它文档；放在它**首次需要且负责验收的阶段**，而不是另建 `features/`、`architecture/`、`ui/` 之类横向模块目录。
- 前一个阶段完成之后再进入下一个阶段；需要跨阶段引用时使用相对 Markdown 链接，**不复制成第二套规范**。

## 重要约束

- 三主导航：Today / Tasks / Notes；Activity 不独立设导航。
- 标签是 Task、Note、Activity 的全局聚合；Task 内 Activity 动态继承 Task 标签；无 Projects / Inbox。
- Notes 是**单列卡片浏览 → 单主区域编辑**；原型位于 [`01-validate/prototype/index.html`](01-validate/prototype/index.html)。
- Markdown 是数据源；Task/DayPlan 的 Activity 各自存于所属文件而不复制；DayPlan 不等于 Due；记录只有一份。
- **最新目标 Schema 以 [02-foundation/schema.md](02-foundation/schema.md) 为准**；阶段 2/3 的旧 Memo 描述属于历史交付记录，在阶段 8 落地前源码仍可能使用旧格式。
- **MVP 无 CLI、MCP、内置 AI、云同步**；预留代码分层即可，不作具体实现。

## 当前状态

阶段 1 设计已基本完成（待真实用户确认）。阶段 2 已完成：桌面 Spike（P2-001）、存储核心（P2-002，`internal/storage/markdown`）、单 Vault 接入与 Tasks 管理闭环、外部修改感知与冲突提示（P2-003/P2-004）；完成标准已勾选，仅剩用户实机手动走查一次。阶段 3 已完成：Memo 闭环（P3-001，任务详情评论+独立 Memo）、DayPlan 与 Today 计划区块（P3-002，多日安排/due 独立/昨日候选不自动顺延）、今日记录时间线与历史回顾（P3-003，本机时区聚合/完成事件/当前状态注脚）；完成标准已勾选，剩用户实机手动走查。阶段 4 已完成：Notes 服务与单列卡片列表（P4-001）、Vditor 全主区域编辑器与 D19 自动保存（P4-002，含离线包裁剪 23MB→7.5MB 与 cdn dist 层修正）、Task–Note 显式关联（P4-003）；完成标准已勾选，剩用户实机手动走查。阶段 5 代码侧全部完成：全局标签聚合与跨类型搜索后端（P5-001）、侧边栏真实标签与单列标签视图（P5-002）、⌘K/⌘P 全局搜索浮层（P5-003）、GetVaultHealth 错误报告暴露与服务层回归补缺（P5-004）、健康状态 UI/基础无障碍/快捷键与首启审计/macOS 打包验证（P5-005，产出 bin/pata.app 与 bin/pata.dmg）；每批均经独立审查（P5-R1~R5，仅 P5-004 一次通过，余含一次返工）。剩用户实机：真实资料走查、macOS 原生体验回归、MVP 验收清单勾选。

阶段 6 代码侧已接入静态品牌、应用内动画、离线预览与静态菜单栏托盘，并留有打包记录；手动实机验收仍待完成，菜单栏帧动画按用户选择不实施。

阶段 7 主体代码已实现：Notes / Task 描述 / 任务评论 / Today 记录的 `[[` 选择、跳转与持久绑定，Note 相对链接及按 Note/Task 身份去重的“被引用”；已有部分 Go 回归测试。但**外部移动路径自动维护、返回精确上下文、失效绑定禁止同名接管的前端逻辑及 macOS 实机验收**仍待完成。与阶段 8 的 Activity 内嵌模型衔接时需保留现有引用能力；见 [idea](07-note-links/idea.md) 与 [proposal](07-note-links/proposal.md)。

**阶段 8 设计已确认、待实施**：统一 `a-` Activity；Task Frontmatter 改存纯文本描述、Body 存活动；Today 沿用 `.pata/plans/`，Body 存独立活动。删除 Task 连同 Activity 一起删除并清理 DayPlan 引用；单文件原子写入、幂等修复、异常文件隔离。仅计划存储和业务重构，不实现 CLI。详见 [idea](08-activity-storage/idea.md)、[proposal](08-activity-storage/proposal.md)；Schema 见 [阶段 2 规范](02-foundation/schema.md)。

阶段 3 新增 Today 体验完善方案：末尾 `#标签` 快速创建、类似 ChatGPT 的左导航 / 中间 Today 或 Tasks / 右任务详情三栏、移除任务优先级、明确移出计划语义、紧凑日期及时间线。右栏按需打开，Notes 仍单列浏览与全主区域编辑。文档已整理，新增完成标准尚未验收，见 [idea](03-daily-loop/idea.md) 与 [proposal](03-daily-loop/proposal.md)；不改变原基础能力的已完成记录，也不新增阶段。
