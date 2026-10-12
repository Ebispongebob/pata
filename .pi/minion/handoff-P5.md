# Minion 阶段 5 委派记录(Lead 交接)

更新:2026-10-12(阶段 5 启动,第一批 P5-001 进行中) · 环境 work(config-work.yaml,MINION_PROFILE 未设,来源公共 config.yaml profile:work) · Lead:pi 会话(w17:t1)

## 计划(按 docs/05-release/proposal.md 实施顺序 1-2 先行)

| 任务 | 内容 | 依赖 | 状态 |
|---|---|---|---|
| P5-001 | 后端:全局标签聚合 + 跨类型搜索 + VaultService 绑定(GetTagOverview/ListByTag/SearchAll) + bindings 重生成 | 无 | ✅ 完成(尝试 2,含 P5-R1 返工) |
| P5-002 | 前端:侧边栏真实标签列表 + 标签视图(任务/笔记/记录 分组,无第四导航) | P5-001 bindings | ⏸ 待委派 |
| P5-003 | 前端:⌘K 全局搜索浮层 | P5-001 bindings;与 P5-002 同改 App.tsx → 串行 | ⏸ 待委派 |
| P5-R1.. | 每批实现后 pi 独立审查 | 各批实现完成 | ⏸ |

后续批次(proposal 步骤 3-5:可靠性回归/打磨打包/真实资料走查)另行委派。

## Worker 运行映射

| Worker | Tab/Pane | 组合 | 实际模型(证据) | 状态 |
|---|---|---|---|---|
| p5-backend | w17:tF / w17:pF | agy | Gemini 3.8 Flash · high(终端页脚) | ✅ P5-001 完成(尝试 2),待 P5-002 复用 |
| p5-reviewer | w17:tG / w17:pG | pi + zoesoft/glm-5.3 | glm-5.3(状态栏 2%/1M) | ✅ P5-R1 完成(0 must/2 should/4 nice),待复用 |

## P5-001 委派快照

- 提交时间:2026-10-12(本会话) · 初始预估 40-60 分钟 · 首个复查节点:发送后 20 分钟
- 任务书:/tmp/p5-001-brief.md(要点:MemoryIndex 聚合 AllTags/TagOverview + SearchAll 子串不区分大小写、不做父标签继承;vaultservice.go 三绑定;bindings 重生成;测试覆盖聚合计数/Memo 自有标签/空 query/标题正文标签命中/ListByTag 继承命中)
- ACK 已收到(尝试 1)→ 完成;P5-R1 返工 4 项(删别名/删 DTO 直返 markdown 类型/聚合 EqualFold 对齐/测试注释+用例)尝试 2 全部闭环;Lead 终验 go build+test -race 59 全绿、npm build 过。
- 交付: GetTagOverview(ToLower 分组+首发 displayTag)、ListByTag(继承语义保留)、SearchAll(子串不区分大小写/不继承/类型分组稳定排序/Snippet);D20 大小写决策记入 decisions.md
- 边界:只改 internal/storage/markdown/、vaultservice.go(+test)、frontend/bindings/

## Lead 上下文

- 未原生观测(pi 状态栏在 TUI 侧);会话早期,下批委派前再核对
