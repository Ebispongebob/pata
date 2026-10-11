# Minion 阶段 4 委派记录(Lead 交接)

更新:2026-10-12(阶段 4 全部交付完成) · 环境 work(config-work.yaml) · Lead:pi 会话

## 状态:两个 Worker 待关闭后无遗留任务

## Worker 运行映射(阶段 4)

| Worker | Tab/Pane | 组合 | 实际模型(证据) | 状态 |
|---|---|---|---|---|
| p4-notes | w17:tC / w17:pC | agy | Gemini 3.8 Flash · high(状态栏) | ✅ P4-001/002/003 完成(P4-002 含 2 次返工),待关闭 |
| p4-reviewer | w17:tD / w17:pD | pi + zoesoft/glm-5.3 | glm-5.3(状态栏) | ✅ P4-R1 通过/P4-R2 不通过→返工后通过/P4-R3 通过,待关闭 |

## 已交付(三批,均实现→独立审查→返工→Lead 终验→提交)

- **P4-001 Notes 服务与单列卡片**(ec8dae5):ListNotes(UpdatedAt 倒序+ID 决胜);CreateNote/UpdateNote(标题必填、CreatedAt 保留、baseline 冲突拒绝、Extra round-trip);NotesView 单列卡片(摘要"# 标题"仅显示层折叠/搜索/新建/只读占位)。P4-R1 通过,返工:跨午夜相对时间+加载态。
- **P4-002 Vditor 编辑器与 D19 自动保存**(6bc4f73,含两轮返工):全主区域 WYSIWYG、frontmatter 严格分离、1.5s 防抖+脏检查+flush+⌘S、冲突停写+确认式重载+复制草稿;**P4-R2 首轮不通过**(cdn 缺 dist 层致编辑器无法初始化、空 body 清空正文、返回丢稿三 must-fix),返工修复并以 dev HTTP 探测实证(lute 等 11 路径 200);二次微返工:失败不自动重排。**Vditor 裁剪 23MB→7.5MB**(删 mermaid/katex/mathjax/echarts 等,保留 lute/highlight.js/i18n/icons)。
- **P4-003 Task–Note 显式关联**(87c8e05):Create/UpdateTask 校验 note_ids 存在性;关联笔记区块(选择器/跳转 focusNoteId/解除仅解引用);红线守住:无标签自动关联。P4-R3 通过(0 must/0 should/3 nice)。
- **阶段 4 完成标准全部勾选**;56 测试含 -race 全绿。

## 监听流程修正(本阶段过程改进)

监听从"输出文本正则"改为状态机驱动(`.pi/minion/monitor_worker.sh`:poll 15s、working→idle 转换触发、到复查节点输出证据摘要);任务书增加哨兵行 `#END-REPORT <task> <attempt>` 收尾约定,消除回显误匹配。

## 已知限制与后续(阶段 5 注意)

- 关窗/极速导航切换可能丢 ≤1.5s 输入(beforeunload 异步 IPC,NotesView shortcut 注释;实机走查评估是否需 Go 退出钩子)。
- mermaid/katex 代码块裁剪后降级为普通代码显示(不白屏,未实测 GUI)。
- P4-R3 三 nice 留档:乐观更新失败不回滚、sync.Once 声明加固、选择器过滤重复计算。
- P4-R1 三 nice 留档:卡片 div 无键盘可访问性等。
- spike §4.1"断网验证通过"与代码事实矛盾(cdn dist 层错位)——spike 报告结论存疑,已在 P4-002 提交信息记录。
- 用户实机走查欠:阶段 2、3、4 各一次(WYSIWYG 初始化/防抖落盘/冲突复制草稿/跳转闭环为重点)。

## 阶段 4 剩余

无自动化遗留。阶段 5(05-release:全局标签/搜索、安全性回归、打包验收)待启动。
