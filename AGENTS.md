# Pata · Agent 项目指引

**项目名称：啪嗒 / Pata。** 前五阶段已完成代码侧交付；**阶段 6/7/8/9 代码完成、待实机验收**。实际进度以 [docs/README.md](docs/README.md) 为准。

## 开始阅读

1. 阅读 [docs/README.md](docs/README.md)，按 01 → 09 的顺序了解开发计划。
2. 阅读 [阶段 1 产品提案](docs/01-validate/proposal.md)、[已确认的取舍](docs/01-validate/decisions.md)、[UI 规范](docs/01-validate/ui.md)。
   - macOS 原生窗口细节和 Magpie 源码参考见 [macos-native.md](docs/01-validate/macos-native.md)；浏览器原型不等于真实 Liquid Glass 验证。
3. 数据 Schema 的**单一来源**为 [阶段 2 schema.md](docs/02-foundation/schema.md)；旧 `docs/02-foundation/examples/` 为历史测试固件，不是生产数据。
4. 直接打开 `docs/01-validate/prototype/index.html` 查看静态 UI 原型，无服务依赖。

## 修改文档/执行计划

- `docs/` **仅以实施阶段分目录**，每个阶段有 `idea.md`、`proposal.md`，其他设计资料留在负责它的阶段内。
- 需要修改某个交付目标时，修改该阶段的 proposal 并更新对应完成标准；涉及产品边界的决定同步更新 `docs/01-validate/decisions.md`。
- 不要把功能当做新阶段单独建目录，除非整个交付计划确实新增一个顺序实施步骤。
- 保持 Markdown 数据源唯一、文件可恢复读取、不重复建模；Task/Today 源文件是 App 内部协议，用户主要通过 GUI 操作，未来 CLI 调用同一 Core；Notes Markdown 保持面向用户编辑。
- **本阶段不实现 CLI/MCP/AI 集成**；未来 CLI 依赖运行中的 App Core，IPC/自动启动等在 CLI 需求阶段讨论，禁止私自扩大范围。
- 阶段 8 的 DayPlan **目标路径**为根 `plans/`（须备份）；阶段 9 的 `files/` 亦为用户数据、不可当缓存清理。
- 阶段 9 仅在 Today/Task Activity 与 Note 中导入、引用文件，`[[` 候选同时支持 Note 与 File；原生预览、按文件名搜索，不做 Files 导航、File 实体或自动清理。

## 产品不可破坏的规则

- 仅 Today / Tasks / Notes 三个主导航。Activity 不独立设入口。
- 目标模型：Task + Note + DayPlan 为顶层 Markdown；Activity 归属于 Task 或 DayPlan 的文件内部（当前源码尚有旧 Memo，阶段 8 改造）。
- 全局标签聚合 Task、Note、Activity；Task 内 Activity 的标签由自身 + Task 动态继承，Today 独立 Activity 仅看自身标签。
- Today 计划与 Task due 相互独立；不强制下班复盘。
- Notes 无嵌套三列结构：单列浏览、全主区域编辑。
- 参照 macOS 27 HIG + Magpie 的窗口实现；尊重系统主题、强调色、辅助功能；Liquid Glass 可选，非 MVP 必须。
- 核心原则：Less is More / Record Once / Local First。
- 阶段 6 不再开发菜单栏帧动画或额外悬停动效；阶段 7 不实现外部移动跨文件自动维护、批量链接更新重试或精确光标/滚动恢复。已绑定 `note_refs` ID 失效时不得按同名笔记重新推断（已修复），详情见 [阶段 7 proposal](docs/07-note-links/proposal.md)。
