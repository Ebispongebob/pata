# Minion 阶段 5 委派记录(Lead 交接)

更新:2026-10-12(阶段 5 启动,第一批 P5-001 进行中) · 环境 work(config-work.yaml,MINION_PROFILE 未设,来源公共 config.yaml profile:work) · Lead:pi 会话(w17:t1)

## 计划(按 docs/05-release/proposal.md 实施顺序 1-2 先行)

| 任务 | 内容 | 依赖 | 状态 |
|---|---|---|---|
| P5-001 | 后端:全局标签聚合 + 跨类型搜索 + VaultService 绑定(GetTagOverview/ListByTag/SearchAll) + bindings 重生成 | 无 | ✅ 完成(尝试 2,含 P5-R1 返工) |
| P5-002 | 前端:侧边栏真实标签列表 + 标签视图(任务/笔记/记录 分组,无第四导航) | P5-001 bindings | ✅ 完成(尝试 2,含 P5-R2 返工) |
| P5-003 | 前端:⌘K 全局搜索浮层 | P5-001 bindings;与 P5-002 同改 App.tsx → 串行 | ✅ 完成(尝试 2,含 P5-R3 返工) |
| P5-R1.. | 每批实现后 pi 独立审查 | 各批实现完成 | R1✅ R2✅ R3✅ |

后续批次(proposal 步骤 3-5:可靠性回归/打磨打包/真实资料走查)另行委派。

## Worker 运行映射

| Worker | Tab/Pane | 组合 | 实际模型(证据) | 状态 |
|---|---|---|---|---|
| p5-backend | w17:tF / w17:pF | agy | Gemini 3.8 Flash · high(终端页脚) | ✅ P5-001/002 完成(各含 1 次返工),待 P5-003 复用 |
| p5-reviewer | w17:tG / w17:pG | pi + zoesoft/glm-5.3 | glm-5.3(状态栏 2%/1M) | ✅ P5-R1 完成(0 must/2 should/4 nice),待复用 |

## P5-001 委派快照

- 提交时间:2026-10-12(本会话) · 初始预估 40-60 分钟 · 首个复查节点:发送后 20 分钟
- 任务书:/tmp/p5-001-brief.md(要点:MemoryIndex 聚合 AllTags/TagOverview + SearchAll 子串不区分大小写、不做父标签继承;vaultservice.go 三绑定;bindings 重生成;测试覆盖聚合计数/Memo 自有标签/空 query/标题正文标签命中/ListByTag 继承命中)
- ACK 已收到(尝试 1)→ 完成;P5-R1 返工 4 项(删别名/删 DTO 直返 markdown 类型/聚合 EqualFold 对齐/测试注释+用例)尝试 2 全部闭环;Lead 终验 go build+test -race 59 全绿、npm build 过。
- 交付: GetTagOverview(ToLower 分组+首发 displayTag)、ListByTag(继承语义保留)、SearchAll(子串不区分大小写/不继承/类型分组稳定排序/Snippet);D20 大小写决策记入 decisions.md

## P5-002 委派快照(尝试 1 完成→R2 返工→尝试 2 验收)

- 复用 p5-backend 会话;App.tsx 侧边栏真实 GetTagOverview + vault:changed 刷新;activeNav 扩展 'tag' 变体(无第四导航);新 TagView.tsx(284 行):ListByTag 单列 Task→Note→Memo 分组、Memo GetMemo 扇出取正文、inherited「经父任务」徽标+前往任务。
- P5-R2: 1 must(TagView.loadTagData 竞态)/0 should/4 nice(GetMemo 失败与空正文不可区分、inherited 取失败丢前往任务、formatMemoTime 第 6 份拷贝、错误态无重试——均保留)。尝试 2 加 useRef 序列令牌(ListByTag 后/Promise.all 后/catch/finally-loading 五处)验收通过。
- Lead 终验: npm build 过、go test 全绿

## P5-003 委派快照(尝试 1 完成→R3 返工→尝试 2 验收)

- 复用 p5-backend;新 SearchOverlay.tsx(顶部居中弹层、250ms 防抖+序列令牌全覆盖合 SearchAll 返回/GetMemo 扇出/catch/finally/清空/关闭)、Task→Note→Memo 分组每类前 5 条+总数、Memo 预取 task_id 跳父任务、↑↓/Enter/Esc 键盘导航+scrollIntoView;App.tsx 集成 ⌘K/⌘P(ctrlKey/大小写兼容)与工具栏入口。
- P5-R3: 0 must/2 should/5 nice。should-1: ⌘K 与 Vditor 链接热键双触发(审查用 vditor dist+NotesView:332 实证)→尝试 2 加 contenteditable/.vditor 守卫;should-2: Lead 自己的 .gitignore 追加未换行拼入 build/android/gen/ 行,Lead 自修。nice 保留: 错误态与无结果混同、独立记录标签覆盖预取失败、a11y(role/aria/焦点还原——阶段 5 第 4 步排期)、select-none 不可复制、section 块重复。
- 教训: Lead `git add -A` 会收进根目录 go build 二进制(f33420f 误提交 24MB,已 git rm --cached+.gitignore /pata);后续提交前查 git status。
- Lead 终验: npm build 过;提交 4f14924
- 边界:只改 internal/storage/markdown/、vaultservice.go(+test)、frontend/bindings/

## Lead 上下文

- 未原生观测(pi 状态栏在 TUI 侧);会话早期,下批委派前再核对
