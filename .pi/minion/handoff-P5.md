# Minion 阶段 5 委派记录(Lead 交接)

更新:2026-10-12(阶段 5 启动,第一批 P5-001 进行中) · 环境 work(config-work.yaml,MINION_PROFILE 未设,来源公共 config.yaml profile:work) · Lead:pi 会话(w17:t1)

## 计划(按 docs/05-release/proposal.md 实施顺序 1-2 先行)

| 任务 | 内容 | 依赖 | 状态 |
|---|---|---|---|
| P5-001 | 后端:全局标签聚合 + 跨类型搜索 + VaultService 绑定(GetTagOverview/ListByTag/SearchAll) + bindings 重生成 | 无 | ✅ 完成(尝试 2,含 P5-R1 返工) |
| P5-002 | 前端:侧边栏真实标签列表 + 标签视图(任务/笔记/记录 分组,无第四导航) | P5-001 bindings | ✅ 完成(尝试 2,含 P5-R2 返工) |
| P5-003 | 前端:⌘K 全局搜索浮层 | P5-001 bindings;与 P5-002 同改 App.tsx → 串行 | ✅ 完成(尝试 2,含 P5-R3 返工) |
| P5-R1.. | 每批实现后 pi 独立审查 | 各批实现完成 | R1✅ R2✅ R3✅ |

| P5-004 | 后端:GetVaultHealth 错误报告暴露 + 服务层回归审计补缺 | P5-001 | ✅ 完成(R4 一次通过) |
| P5-005 | 前端:健康UI/基础无障碍/快捷键与首启审计/macOS 打包验证 | P5-004 | ✅ 完成(尝试 2,含 P5-R5 返工) |
| 剩余 | proposal 步骤 5:真实资料走查 + 实机 macOS 回归 + MVP 验收清单 | 需用户实机 | ⏸ 留用户 |

## Worker 运行映射

| Worker | Tab/Pane | 组合 | 实际模型(证据) | 状态 |
|---|---|---|---|---|
| p5-backend | w17:tF / w17:pF | agy | Gemini 3.8 Flash · high(终端页脚) | ✅ P5-001~005 全部完成(004 一次过,余各含 1 次返工),待关闭 |
| p5-reviewer | w17:tG / w17:pG | pi + zoesoft/glm-5.3 | glm-5.3(状态栏) | ✅ P5-R1~R5 全部完成(0 must 累计 1;R4 一次通过),待关闭 |

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

## P5-004 委派快照(R4 一次通过)

- VaultService.GetVaultHealth() 直返 markdown.ParseError/DanglingRef(零手抄零转换,R1 惯例);服务层回归审计: 变更监听无缺口(EventForwarding 实测背书)、补 UpdateTask baseline 冲突闭环、RescanVault/GetVaultHealth 未打开防护、ParseError/DanglingRef 生命周期; bindings 重生成(beta.28 CLI,全量风格迁移属工具链对齐,R4 核实兼容)。
- R4: 0 must/0 should/4 nice(bindings CLI 版本已固化到 README;nil 归一化死代码;两次 RLock 非原子;ParseError.Err IPC 无用)。提交 63867d3。

## P5-005 委派快照(尝试 1 完成→R5 返工→尝试 2 验收)

- 健康徽标+诊断弹窗(顶栏,parse_errors/dangling_refs 计数,vault:changed 实时刷新,干净不渲染);SearchOverlay a11y(dialog/combobox/listbox/aria-selected/焦点圈闭/还原);全局 :focus-visible 环;快捷键清单(⌘K/⌘P、⌘S×2、⌘↵×2、Esc/↑↓/Enter)无冲突;首启引导三视图本就一致未改;打包: bin/pata.app(18MB,codesign 严验通过)/bin/pata.dmg(8.5MB)。
- R5: 0 must/2 should(健康弹窗无焦点管理→Esc 打开时无效;焦点环硬编码 #059669 违 ui.md 系统强调色)/4 nice。尝试 2 补 healthTriggerRef/healthModalRef 焦点移入+Esc+Tab 环流+还原、AccentColor+@supports 兜底。提交 8875108。
- R5 提示: 打磨审计书面报告在 worker 会话滚动区,未入工作区;快捷键清单已抄入本台账。

## 收官状态

- 五批实现+五轮审查全部完成并提交(188fcd6/f33420f/4f14924/63867d3/8875108);两个 Worker 关闭。
- 留用户: proposal 步骤 5(真实资料走查)、实机 macOS 回归(macos-native.md 清单)、MVP 验收清单(acceptance.md)勾选。
- 边界:只改 internal/storage/markdown/、vaultservice.go(+test)、frontend/bindings/

## Lead 上下文

- 未原生观测(pi 状态栏在 TUI 侧);会话早期,下批委派前再核对
