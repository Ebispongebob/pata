# Minion 阶段 3 委派记录(Lead 交接)

更新:2026-10-12(阶段 3 全部交付完成) · 环境 work(config-work.yaml) · Lead:pi 会话

## 状态:两个 Worker 待关闭后无遗留任务

## Worker 运行映射(阶段 3)

| Worker | Tab/Pane | 组合 | 实际模型(证据) | 状态 |
|---|---|---|---|---|
| p3-memo | w17:tA / w17:pA | agy | Gemini 3.8 Flash · high(状态栏) | ✅ P3-001/002/003 全部完成(各含 1 次返工),待关闭 |
| p3-reviewer | w17:tB / w17:pB | pi + zoesoft/glm-5.3 | glm-5.3(状态栏) | ✅ P3-R1/R2/R3 完成(0 must),待关闭 |

## 已交付(三批,均实现→独立审查→返工→Lead 终验→提交)

- **P3-001 Memo 闭环**(e833191):MemoryIndex.ListMemosByTask;VaultService CreateMemo(无标题/标签/task_id 可存,task_id 非空须存在)/UpdateMemo(保留 created_at 与未知 frontmatter,baseline 冲突拒绝)/GetMemo/ListMemosByTask;TasksView 任务详情评论区块(本机时区、⌘↵、vault:changed 刷新保护草稿)。P3-R1 通过,返工:gofmt+Extra 保留测试。
- **P3-002 DayPlan 与 Today 计划**(4b09595):GetDayPlan(无计划返回空、纯读不落盘)/SaveDayPlan(日期/引用校验、空列表合法、baseline 冲突拒绝);TodayView(日期切换无月历网格、有序计划区上下移/移出仅出计划、任务选择器+快速新建、昨日未完成仅候选不自动顺延、悬空占位行)。同 Task 多日安排 due 不变有专项测试。P3-R2 通过,返工:整体保存前剔除失效占位并提示。
- **P3-003 时间线与历史回顾**(abb8a47):GetDayTimeline(本机时区分桶、Memo 唯一记录不复制、completion 事件含完成→重开→再完成多事件、倒序确定性排序、纯读);Today 快速输入独立 Memo;时间线关联任务跳转(focusTaskId 一次性消费);历史日"当前状态"注脚。独立性测试覆盖完成标准 5 条。P3-R3 通过,返工:悬空 Memo 项降级不渲染死按钮+历史日"记入今天"提示。
- **阶段 3 完成标准全部勾选**(proposal.md);48 测试含 -race 全绿,tsc/vite build 全过。

## 已知限制与后续(阶段 4/5 注意)

- loadData 无 stale-response 防护(IPC FIFO 下概率极低,P3-R2/R3 记录)。
- vault:changed 不分实体类型,TodayView 全量重拉(本地 IPC 无感)。
- bindings 生成器升级副作用:类型 interface→class+createFrom(abb8a47 提交,纯生成)。
- Vditor 23MB 离线包裁剪仍欠(阶段 4 前)。
- 历史日任务状态为当前状态+注脚,无"当时状态"回放(按 proposal 设计,非缺陷)。
- 用户实机手动走查未做(阶段 2 也仍欠一次)。

## 阶段 3 剩余

无自动化遗留。仅剩用户实机走查:Today 排计划→执行完成→快速记录→切历史日回顾→任务详情看评论同一来源。
