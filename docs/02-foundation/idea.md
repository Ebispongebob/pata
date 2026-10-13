# Idea — 阶段 2：建立可用的数据底座

**阶段目的**：先让真正的桌面程序能安全读取、保存和管理任务。UI、未来的外部 Agent 和任意编辑器应该共享同一套本地 Markdown 数据源。

**阶段产出**：能启动的 macOS 应用、稳定的 Go Core、Schema 实现、Task CRUD 与任务详情。

## Markdown 数据理念

本地目录可被用户、编辑器和现有 Pi Agent 直接访问。Frontmatter 保留少量结构化属性；正文仍然是自然可读的 Markdown。

每个实体一个文件；Task、Note、Memo 的业务关系以稳定 ID 或相对路径引用。DayPlan 独立保存有序 ID 列表，避免把每日计划写进任务本身。

## 桌面架构理念

采用 Go 做文件与业务逻辑，Wails 包装桌面窗口，React/TS 组织交互。结构化写操作都走 Go Core；UI 和未来可能出现的 CLI 都不应重复实现业务规则。现阶段只构建 UI，不构建 CLI。

## 首个可用业务对象：Task

跨天工作以 Task 为唯一行动实体；任务推进过程靠 Memo，而不是每日复制 TODO 或开独立日志。Task 不设优先级，保留状态、可选 due、标签和正文；旧文件的 `priority` 按未知 Frontmatter 属性保留。
