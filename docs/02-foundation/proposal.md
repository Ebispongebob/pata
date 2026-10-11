# Proposal — 阶段 2：建立可用的数据底座

## 实施顺序

1. Spike：验证 Go + Wails v3 + React/Vite 的启动、开发和 macOS 打包。
   - 同时执行 [阶段 1 定义的 macOS 原生窗口 Spike](../01-validate/macos-native.md)：HiddenInset、拖动/no-drag、原生交通灯、系统主题与回退。
2. 用户选择 Vault 目录；建立 Markdown 文件扫描、Frontmatter 解析、Schema 校验和可重建索引。
3. 搭建 Go Core 与 UI 分层，结构化写操作只由 Go Core 执行。
4. 实现 Tasks 列表、创建、详情、编辑属性、状态变更及删除确认。
5. 验证外部修改感知、版本比较与安全写入；为后续 Memo/Today 预留数据能力，但不提前开发业务页面。

## 本阶段完成标准

- [x] macOS 可启动应用，离线可访问用户选择的 Vault。（`wails3 task build` 产出 bin/pata.app；冒烟验证启动存活）
- [x] 实机验证标题栏/窗口行为、系统深浅色、缩放、侧边栏收起；记录系统/Wails 版本及结果；Liquid Glass 不强制。（见 [spike-desktop-result.md](spike-desktop-result.md)）
- [x] 新建/编辑 Task 写入真实 Markdown，重新启动内容仍正确。（单测模拟重扫；实机手动回归待用户一次性走查）
- [x] Task 属性合法校验、未知 Frontmatter 字段保留。（测试覆盖）
- [x] 外部文本编辑器改动可被感知，存在冲突时不覆盖。（fsnotify→vault:changed 事件+ConflictError 拒绝覆盖；单测覆盖，实机走查同上）
- [x] 任务管理与 UI/Wails 代码解耦，CLI 不属于本阶段工作。（internal/storage/markdown 无 Wails 依赖；未引入 CLI）

## 应用架构与技术路线

## 推荐选型（实现前需 Spike）

- 首发：macOS。
- 桌面层：**Wails v3**（当前版本兼容性需要验证）。
- 业务与文件服务：**Go**。
- 前端：**React + TypeScript + Vite**。
- UI：**Tailwind CSS + shadcn/ui**。
- Markdown 编辑器：**Vditor**（优先 WYSIWYG；须验证 round-trip）。
- 文件监控：**fsnotify**，辅以显式刷新及扫描兜底。
- 搜索：内存索引，全量 Markdown 可重新扫描；无需初期 SQLite。

## 逻辑分层

```text
Desktop (Wails) ─── React UI ─── app bindings
                                   │
                              Go Application
                                   │
                        Domain (Task/Memo/Note/DayPlan)
                                   │
                    Markdown Repository + Validators
                                   │
                             Local filesystem
```

UI 只传业务动作，不能自己拼接 Frontmatter 写文件。Vditor 编辑正文，Go Core 维护元数据。

## 建议 Go 包划分（仅方向）

- `internal/domain`：实体与约束。
- `internal/application`：创建任务、完成任务、创建 Memo、编辑 DayPlan 等操作。
- `internal/storage/markdown`：Frontmatter 与正文读写、路径、索引。
- `internal/watch`：文件变化、重扫、冲突信号。
- `internal/desktop`：Wails 绑定，不持有业务规则。
- `frontend`：页面、编辑器、状态管理与组件。

## 状态流

加载 vault → 校验/建索引 → 用户操作 → Go Core 结构化修改 → 安全写入 → 通知 UI。外部编辑触发监听 → 校验 → 更新索引 → UI 刷新/提示冲突。

## MVP 非目标

CLI、MCP、内置 AI、网络 API、插件、云服务、协作编辑、同步冲突自动合并。

## 工程 Spike

1. Wails v3 在目标 macOS 上打包和稳定启动。
   - 验证 `MacTitleBarHiddenInset`、原生交通灯、Wails drag/no-drag 与 WKWebView 控件交互。
   - 比较标准内容背景和可选侧边栏材质，测试减少透明度/减少动态效果。
   - 借鉴 [Magpie 源码参考与验收项](../01-validate/macos-native.md)，但禁止直接复制魔法像素作为最终适配。
2. Vditor 对长篇 Markdown（代码块、表格、中文、相对链接）的编辑往返一致性。
3. Go 对任意合法 YAML Frontmatter 的读写是否保留用户未知字段。
4. 外部文件变更和正在编辑的文档的冲突提示与恢复。

## Markdown 存储方案

## 目录建议

```text
vault/
  tasks/                # 每任务一个 Markdown
  memos/YYYY/MM/         # 每 Memo 一个 Markdown
  notes/                # 长篇 Markdown；允许用户自建子目录
  .pata/plans/        # 每日期一个 DayPlan Markdown（内部）
```

`vault` 为用户选择的目录。`.pata/` 仅保存可重建或内部计划相关数据；DayPlan 是业务数据，必须备份，**不能因为目录以点开头就随意删除**。

## 标识

采用不会因重命名文件变化的稳定 ID；文件名可包含可读 slug，但任何关联都不能依赖文件名。最初可以使用 UUID/ULID 类唯一标识（生成方式待实现时确定）。

## 数据优先级

Markdown 是唯一业务真相；内存索引从文件扫描重建。UI 更新、外部文件编辑、Agent 改写都要遵守同一份 schema。

## 文件兼容

Frontmatter 由 Go Core 读写；编辑器只编辑正文。允许未知字段原样保留（只要不与必需字段冲突），减小外部工具协作风险。

## 关联

- Task → Note：显式 `note_ids` 或正文中的标准链接（两者取其一，MVP 采用 `note_ids`）。
- Memo → Task：可选 `task_id`。
- DayPlan → Task：有序 `task_ids`。
- 标签：字符串列表；动态过滤相关内容。

具体格式见 [schema.md](schema.md)。

## 任务能力的 V1 设计

## 列表

全量任务池；按状态、截止时间、标签、优先级过滤或排序。可快速创建。无 Inbox、Project、Area、子任务、看板。

## Task 详情

- 标题、状态（todo/doing/done）、优先级（p1/p2/p3）、可选 due、标签。
- Markdown 描述（任务目标与验收，不必贴完整技术方案）。
- 关联 Notes / 代码仓库或 PR 链接（显式引用，可选）。
- Memo 线程：按时间排列、输入框追加评论。

## 状态

完成记录时间事件；重新打开可用，必须保留原历史完成事件。状态改变不自动移除历史 DayPlan。

## 删除

建议软删除或归档作为后续验证项；MVP 最少需要删除确认，并处理关联 Memo 和 DayPlan 的失效引用。**不得悄然删除关联 Memo**。

## 不做

重复计划、依赖图、复杂状态工作流、子任务、团队指派。

## 阶段资料

- [Markdown Schema](schema.md)（单一规范来源）
- [文件安全与冲突处理](file-safety.md)
- [`examples/`](examples/) 为格式样例，绝非真实数据。
