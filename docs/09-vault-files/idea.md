# Idea — 阶段 9：专属 Vault 与统一资源引用

> **状态：设计已确认，尚未实施。** 阶段 8 先完成 Activity 归属式存储；阶段 9 在其基础上收敛 Vault 扫描边界，并复用已有 `[[` 引用与全局搜索来接纳文件资源。**本阶段仅记录方案，不修改业务代码。**

## 为什么要做

啪嗒的用户记录主要发生在 Today Activity、Task Activity 与 Note 中。晋升答辩 PPT、架构 PDF、图片等是记录对应的工作成果和资料，而不是需要一个独立页面管理的新业务对象。

现有 Vault 扫描会递归接纳根目录中的任意 Markdown；既有 `[[` 候选只包含 Note，全局搜索也不能直接命中 `files/` 中的文件名。用户需要能在记录中直接拖入文件、再次引用已有文件，并在忘记原记录时从全局搜索找回它。

## 用户只需要记住两个动作

1. **第一次引用**：在 Today / Task 的 Activity 或 Note 中拖入、粘贴文件。啪嗒把文件复制到 Vault 的 `files/`，在当前输入位置插入 Markdown 相对链接。图片可在 Note 中直接呈现，其他文件可点击预览。
2. **再次引用**：输入已有的 `[[`，候选中同时搜索 Note 与文件。选中已有文件只插入链接，不复制第二份文件。

全局搜索通过文件名直接找到文件；Activity / Note 正文中的描述和文件链接也可以命中对应记录。即便所有引用被删除，原始文件仍属于用户，保留在 `files/` 中。

> **设计口径**：记录是入口、文件是资源；内容记录一次、资源保存一次、引用可以多处。统一选择体验，不强求 Note 与文件共享同一存储身份。

## 阶段交付

- 专属单 Vault：按约定目录管理 `notes/`、`tasks/`、`plans/`、`files/`；`.pata/` 只保存应用内部状态。Vault 根目录或其他目录的 Markdown 不自动认作 Note。
- `plans/` 位于 Vault 根目录，承载 DayPlan 和独立 Today Activity；它是用户数据，不应藏在可误认为缓存的 `.pata/` 下。**阶段 8 尚未编码，目标 Schema 和第 8 阶段方案同步采用新位置，避免先写旧目录再迁移。**
- `files/` 只保存原始 PDF、Word、PPT、图片等，不创建包装 Note、不引入 File 实体或 Frontmatter。
- 延伸现有 `[[` 选择器：Note 继续沿用既有 ID 绑定与跳转；文件按相对路径引用，可在多条 Activity / Note 中复用。
- 全局搜索增补文件名候选；点击文件使用 macOS 原生预览与 Finder 定位，不开发 Office/PDF 内置编辑器。
- 仅 Today / Tasks / Notes 三个主入口，不增加 Files 页面或「其他文件」专区。

## 明确不做

不做未引用文件垃圾回收、定时清理、引用计数、inode/Bookmark 自动追踪、跨文件链接批量修复、文件内容全文检索、OCR、格式转换、哈希去重、通用 Resource ID/关系数据库、独立文件生命周期页面。

不处理从外部把普通 Markdown 放入 `notes/` 后的 Frontmatter 转换争议；Agent/CLI 将来通过 App Core 的接口进入，也不在本阶段实现。

## 文档关系

- [本阶段 Proposal](proposal.md)：用户交互、技术边界、实施顺序与验收。
- [Markdown Schema](../02-foundation/schema.md)：Task/Activity/DayPlan 规范及阶段 9 文件链接规则的单一规范源。
- [阶段 8](../08-activity-storage/proposal.md)：前置的 Activity 存储改造与 `plans/` 目标位置。
- [产品决策](../01-validate/decisions.md)：已确认的取舍。

**完成判定**：无需 Files 页面，用户就能拖入一次文件、在多处 `[[` 复用并通过全局搜索找回；其他文件保持原格式、操作安全，现有笔记与 Task/Activity 引用功能没有回退。
