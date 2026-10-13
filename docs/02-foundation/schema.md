# Markdown Schema — V1 候选规范

> **设计候选格式，不是已经实现的 API**。实际编码前为所有字段建立解析、序列化与向后兼容测试。示例见 `examples/`。

## 通用约定

- UTF-8 Markdown，开头 YAML Frontmatter。
- 日期：`YYYY-MM-DD`，表示用户本地工作日；时间戳：带时区的 ISO 8601 / RFC 3339（例如 `2026-10-11T10:20:00+08:00`）。
- ID 稳定且全局不重复，不依赖文件路径。
- 标签无层级、可选；内部存储不带 `#`。
- 必填字段严格校验；未知属性保留；不在 Markdown 正文里嵌入隐藏状态块。

## Task

```yaml
---
type: task
id: t-demo-001
title: 统一资源接入方案
status: doing            # todo | doing | done
due: null                # YYYY-MM-DD | null
tags: [架构设计]
note_ids: [n-demo-001]    # 可选明确关联
created_at: 2026-10-11T09:00:00+08:00
updated_at: 2026-10-11T10:00:00+08:00
status_events:            # 可选，仅记录完成和重新打开
  - action: completed
    at: 2026-10-11T10:00:00+08:00
  - action: reopened
    at: 2026-10-11T10:05:00+08:00
---

目标：明确接入边界和操作协议。
```

Task 正文（UI 中的 description / 描述）为纯文本，支持换行，不解析或渲染 Markdown；仍保存在现有 `.md` 文件的 Frontmatter 后，无需新增字段或迁移文件。已有 Markdown 符号按原文保留，不自动清洗。Note 的 Markdown 编辑不受影响。

Task 不再建模 `priority`；新建任务不写该字段。旧文件中的 `priority` 按未知 Frontmatter 属性保留，不校验其值、不向业务接口暴露，也不在保存时强制删除；无需批量迁移旧文件。

`status` 是当前状态；`status_events` 用于保留 **完成 / 重新打开** 历史，而不是庞大的审计事件系统。创建时间可用于回顾；已完成 Task 的最近一次完成时间可从事件序列中计算。对于只有一个 `done` 状态而无事件的外部手工修改，解析器应明确采取一致的降级策略（待实现 Spike 确定）。

## Memo

```yaml
---
type: memo
id: m-demo-001
task_id: t-demo-001     # 无关联时可省略
created_at: 2026-10-11T10:20:00+08:00
tags: []               # 独立 Memo 可打标签
---

Flink 验证发现吞吐未达到预期，准备检查并行度。
```

`task_id` 存在时即任务评论。标签筛选时采用自有 `tags ∪ 父任务当前 tags`（仅当有关联父任务）。不强制为评论再打标签。

## Note

```yaml
---
type: note
id: n-demo-001
title: 统一资源管理设计
tags: [架构设计]
created_at: 2026-10-11T09:00:00+08:00
updated_at: 2026-10-11T09:30:00+08:00
---

# 统一资源管理设计

...
```

## DayPlan

```yaml
---
type: day_plan
date: 2026-10-11
task_ids:
  - t-demo-001
  - t-demo-002
---
```

只有日期和有序任务 ID；不保存任务标题的副本；不等于每日笔记，不包括到期日。

## 关键不变量

1. 同一天 DayPlan 不允许重复 task ID；同一个 task 可以出现在多个日期。
2. 改变 Task 的 Due 不自动修改任何 DayPlan。
3. Memo 和 Task 之间使用稳定 ID；Task 改名不影响关联。
4. 标签视图是聚合计算，不把继承标签重复写到 Memo。
5. Task 重新打开不会清空已有历史完成事件。
6. 外部用户编辑造成引用悬空时，显示可解释的降级状态并允许修复，不允许静默删数据。

## 待验证的 Schema 问题

- 面对没有 Frontmatter 的普通 Markdown：建议自动视为 Note，而不是强制改写原文件；是否添加 id 应与用户确认或在首次受控编辑时执行。
- ID 实现、文件名生成、软删除/归档语义。
- 外部手工调整 `status` 时如何补全时间线事件。MVP 必须明确规则，不应假装可完整恢复不可观测历史。
