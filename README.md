# 啪嗒 · Pata

**记下一点，完成一件。**

一款极简、本地优先、以 Markdown 为唯一业务数据源的 macOS 个人工作工具。

**Today 管当下，Tasks 管进展，Notes 管沉淀，Memo 负责记录，Labels 负责关联。**

> 当前仓库只有产品/技术设计与可离线运行的 UI 交互原型；**尚未实现桌面程序和真实文件存储**。

## 项目推进方式

`docs/` **按计划的实施顺序划分 5 个阶段，而不是按功能模块划分**。每个阶段有 `idea.md`（为什么、交付什么）和 `proposal.md`（怎么做、验收标准），具体技术/UI文档附在对应阶段。

1. [阶段 1 · 确认产品与交互](docs/01-validate/proposal.md)：产品基线、工作流程、UI 设计和原型。
2. [阶段 2 · 建立数据底座](docs/02-foundation/proposal.md)：Wails/Go、Markdown Schema、Tasks。
3. [阶段 3 · 每日工作闭环](docs/03-daily-loop/proposal.md)：Memo、Today 和历史回顾。
4. [阶段 4 · 文档沉淀](docs/04-knowledge-loop/proposal.md)：Notes 编辑与关联。
5. [阶段 5 · 整合交付](docs/05-release/proposal.md)：全局标签/搜索、稳定性与交付。

**完整阶段清单：[docs/README.md](docs/README.md)**

## 体验 UI 原型

直接用浏览器打开 [`docs/01-validate/prototype/index.html`](docs/01-validate/prototype/index.html)，无需安装依赖或构建；刷新即恢复演示数据。

## MVP 边界

- 三个一级入口：**Today / Tasks / Notes**；Memo 是记录数据，不是第四个入口。
- 标签是跨 Task / Note / Memo 的全局聚合；没有 Projects / Inbox。
- Notes 采用 Flomo 启发的单列卡片列表，打开后占用整块主内容区编辑。
- 本地 Markdown + YAML Frontmatter；初期无需独立业务数据库。
- **CLI、MCP、内置 AI、插件、云同步均不进入 MVP**。

工程选型候选为 Go + Wails v3 + React/TypeScript + Vditor，尚需工程验证。

原生体验目标遵循 macOS 27 HIG；[Magpie 源码实现参考与 macOS 验收约束](docs/01-validate/macos-native.md) 已加入阶段 1，真正的标题栏和系统材质在阶段 2 Wails 实机验证。
