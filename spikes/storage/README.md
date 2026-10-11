# Pata Markdown 存储核心 Spike (`pata/spikes/storage`)

本 Spike 实现了 Pata 桌面应用的基础数据存储与文件安全核心层，涵盖 Markdown + YAML Frontmatter 解析/序列化、严格 Schema 校验、ULID 稳定 ID 生成、可重建内存索引、原子安全写入、并发编辑冲突检测以及 fsnotify 变更监听与自反馈抑制。

---

## 1. 包结构设计

```text
spikes/storage/
├── go.mod                      # 独立 Go 模块 (pata/spikes/storage)
├── types.go                    # 核心领域实体 (Task, Memo, Note, DayPlan) 与基线结构
├── frontmatter.go              # YAML Frontmatter 拆分、解析与序列化 (未知字段原样保留)
├── schema.go                   # 严格 Schema 校验与关键不变量检查 (枚举/时间戳/日期/去重)
├── id.go                       # 稳定 ID 生成 (ULID) 与中文/Unicode 友好 Slug 格式化 (FormatEntityFilename)
├── safety.go                   # 原子写入 (同目录临时文件 + Rename + 目录 fsync)、Hash/ModTime 乐观并发控制、写入抑制
├── index.go                    # 内存可重建索引 (类型索引/标签聚合/Memo 标签继承/悬空引用降级/重复 ID 隔离)
├── vault.go                    # Vault 聚合根：扫描、增量维护、fsnotify 监听、自反馈过滤、定期兜底扫描
├── examples_test.go            # docs/02-foundation/examples/ 所有示例真机解析与 round-trip 测试
├── safety_scenarios_test.go    # file-safety.md 关键验收场景全量离线模拟断言
├── rework_scenarios_test.go    # 审查修复断言: 同标题 Note 独立路径不覆盖(H1)、多普通文件共存(H2)、重复 ID 隔离(M2)
├── index_test.go               # 内存索引、标签继承与悬空引用测试
├── id_test.go                  # ULID 单调性与 Slug 清洗测试
├── safety_test.go              # 安全原子替换与乐观锁冲突测试
└── additional_test.go          # 普通 Markdown 降级、事件历史与周期重扫兜底测试
```

---

## 2. 核心设计决定

### 2.1 稳定 ID 方案：选择 ULID
在对比 ULID 与 UUID (v4/v7) 后，本项目采用 **ULID** (`github.com/oklog/ulid/v2`)，原因如下：
1. **时间单调自增**：ULID 前 48 位为毫秒级时间戳，原生保证时间顺序性，使实体在文件系统与列表中自然按创建时间排列，便于归档与快速浏览。
2. **紧凑且对人类友好**：采用 Crockford's Base32 编码（26 字符，剔除了易混淆的 I、L、O、U），比 36 字符的标准 UUID 更加紧凑且 URL/路径安全。
3. **清晰的实体前缀**：配合语义前缀（如 `t-` 任务、`m-` 备忘、`n-` 笔记），既具可读性又保持全局唯一。

### 2.2 文件名 Slug 与关联分离 (统一由 FormatEntityFilename 驱动)
- Task/Note 文件名包含经安全清洗的人类可读 Slug 与稳定 ID（如 `统一资源接入方案_t-01j...md`、`笔记标题_n-01j...md`），即使包含中文字符与 emoji 也予以良好保留。
- 相同标题的 Note 通过携带不同 ID 的文件名彻底隔离路径，绝不相互覆盖。
- **实体间所有引用关联（Memo -> Task, Task -> Note, DayPlan -> Task）一律使用稳定 ID**，文件重命名或移动不会损坏任何关联。

### 2.3 未知 YAML 字段保留 (L1 澄清)
使用 `yaml.Node` 映射结合 `yaml:",inline"` 捕获实体已知结构外的扩展字段。在编辑正文或已知属性重新序列化写回时：
- **字段值与锚点保留，顺序/注释不保证**：外部 Pi Agent 等工具写入的扩展键值数据与 YAML 别名/锚点能够完整保留，满足 file-safety.md "不破坏未知字段" 规范；但 YAML 内部键顺序可能重排，且顶层 key 头部注释不保证持久。

### 2.4 文件安全、原子替换与目录持久化
- **编辑基线比对与防覆盖**：读取文件时提取内容 SHA-256 Hash 与 ModTime。提交保存时比对磁盘当前状态，若已被外部修改且与本地改动不同，返回 `ErrConflict`，严禁静默覆盖；当 `baseline == nil`（新建）但目标文件已存在且内容不同，同样拒绝并返回冲突。
- **同目录原子写入与 fsync 目录**：先在目标文件的同级目录下创建 `.pata_tmp_*`，完成 `Sync()` 刷盘后原子替换（`os.Rename`），并紧跟 `os.Open(dir)` + `dirFile.Sync()` 持久化目录项，避免跨卷问题并保证掉电安全。
- **写入抑制器 (`WriteTracker`)**：内部原子写入时登记路径与内容 Hash，使 `fsnotify` 捕获到对应变更事件时自动过滤，杜绝内部自反馈循环。

### 2.5 悬空引用与非法文件的降级策略
- **非法 YAML 文件**：记录至 `ParseErrors`，报告具体路径与解析失败原因，**绝不静默删除或重写损坏的文件**，其他合法实体正常索引。
- **重复 ID 隔离 (M2)**：若不同文件出现相同实体 ID，不静默采用 last-wins，而是保留首个实体并将冲突文件记入 `ParseErrors`，对齐不变量 6 的可解释降级策略。
- **无 frontmatter 普通 Markdown (H2)**：通过文件路径派生确定性占位 ID（`plain-<hash>`），使多个普通 Markdown 文件在索引中独立共存，删除其中一个文件不会破坏其他文件的映射。
- **悬空引用**：当 Memo/Task/DayPlan 引用的目标 ID 不存在时，提取为 `DanglingRef` 供 UI 呈现解释性降级提示（如“引用的任务不存在”），当缺失实体被补全时自动恢复。

### 2.6 Schema 待决项决定：手工修改 status 为 done 的降级规则 (M3)
针对 schema.md 留给 Spike 确定的“外部手工将 status 改为 done 却未记录 status_events”问题，本模块明确如下规则：
1. **不伪造事件历史**：解析器与存储层**严禁伪造**不可观测的历史事件（如不虚构当前时间或假时间戳写入 `status_events`）。
2. **显示按当前 status**：读取与渲染时以当前 `status: done` 为准，视为已完成任务。
3. **最近完成时间返回未知**：计算任务最近一次完成时间时，若 `status == done` 且 `status_events` 无对应记录，则明确返回 `nil` / 未知（Unknown），UI 呈现为“已完成（完成时间未知）”，尊重真实事实，绝不假装具备完整审计历史。

---

## 3. 验收场景覆盖

在 `safety_scenarios_test.go` 与 `rework_scenarios_test.go` 中完整覆盖了 `file-safety.md` 与 P2-R1 审查提出的场景：
1. `TestScenario_ExternalEditConflict`：外部编辑器并发修改触发冲突拒绝并保护源文件。
2. `TestScenario_EditorRenameReplaceWrite`：模拟外部编辑器（Vim/VSCode）使用临时文件原子 rename 替代直接 write 时，fsnotify 正确捕获并增量更新索引。
3. `TestScenario_InvalidYAMLIsolation`：语法错误的 YAML 被隔离报告，源文件原封不动，合法实体正常加载。
4. `TestScenario_UTF8ChineseAndEmoji`：测试多语言字符、标点符号与 Emoji 在 frontmatter 与 Markdown 正文的完整保真度。
5. `TestScenario_DanglingReferenceDegradation`：悬空引用可解释降级与修复后自动恢复。
6. `TestScenario_UnknownYAMLFieldsPreserved`：未知扩展字段 round-trip 完整保留。
7. `TestScenario_DayPlanInvariant`：同一天 DayPlan 任务重复校验失败并拒绝。
8. `TestScenario_FSNotifySelfFeedbackSuppression`：内部安全写入不触发自反馈监听事件。
9. `TestScenario_H1_SameTitleDifferentIDNotesNotOverwritten`：同标题不同 ID 的 Note 解析至独立路径不相互覆盖；`baseline == nil` 写入已有不同文件返回 `ErrConflict`。
10. `TestScenario_H2_MultiplePlainMarkdownCoexistAndRemoveOne`：多个无 frontmatter Markdown 文件通过派生 ID 独立共存，删除其中一个不影响其他文件索引。
11. `TestScenario_M2_DuplicateEntityIDCollisionIsolated`：跨文件实体 ID 重复时隔离至降级报告，阻止静默覆盖。

---

## 4. 后续并入根模块的迁移方式

当主应用进入阶段 3 并整合桌面后端时，本 Spike 可按如下步骤无缝并入根模块：

1. **代码迁移**：
   将 `spikes/storage/` 下的业务实现文件（`types.go`, `frontmatter.go`, `schema.go`, `id.go`, `safety.go`, `index.go`, `vault.go`）复制到根模块的 `internal/storage/` 或 `pkg/storage/` 目录。
2. **依赖合并**：
   将本模块的依赖项（`gopkg.in/yaml.v3`, `github.com/fsnotify/fsnotify`, `github.com/oklog/ulid/v2`）合并至根目录的 `go.mod` 并执行 `go mod tidy`。
3. **Wails / Service 绑定**：
   在 Wails App 的 `App` 或 `VaultService` 结构体中持有 `storage.Vault` 实例：
   - 前端加载时暴露 `vault.Index.GetTask`, `vault.Index.FindByTag` 等只读接口。
   - 前端提交保存时暴露 `vault.SaveEntity(entity, baseline)`，若返回 `ErrConflict`，向前端推送弹窗让用户选择“保留外部版本”或“另存为新文件”。
   - 将 `vault.Events()` 的事件通道转换为 Wails 的 `runtime.EventsEmit`，实现文件变更的响应式 UI 刷新。
