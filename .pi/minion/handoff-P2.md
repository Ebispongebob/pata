# Minion 阶段 2 委派记录(Lead 交接)

更新:2026-10-11 · 环境 work(config-work.yaml)· Lead:pi 会话

## Worker 运行映射

| Worker | Tab/Pane | 组合 | 实际模型(证据) | 状态 |
|---|---|---|---|---|
| p2-desktop | w17:t2 / w17:p2 | agy | Gemini 3.8 Flash · high(原生界面) | P2-001 尝试 2 返工中 |
| p2-storage | w17:t3 / w17:p3 | agy | 同上 | 空闲,保留待集成(存储核心待并入根模块) |
| p2-reviewer | w17:t4 / w17:p4 | pi + 显式 zoesoft/glm-5.3 | glm-5.3(状态栏) | 空闲,保留待复核 P2-001 返工 |

返工计数:P2-002 已用 1/2(关闭);P2-001 已用 0/2,当前尝试 2 为首轮返工。

## 已交付

- **P2-002 存储核心**(提交 eea0137 + 1e245db 返工):spikes/storage/ 独立模块。frontmatter 解析(未知字段值保留)/四实体 schema 校验/ULID ID/文件名 slug_id/vault 扫描+索引/安全写入(同目录临时文件+Sync+rename+目录 fsync,hash 基线冲突拒绝,nil 基线防覆盖)/fsnotify 自反馈抑制+重扫兜底。23 测试含 -race 全绿(Lead 与 reviewer 双复核)。
- **P2-001 桌面 Spike**(提交 1e245db,返工中):Wails v3.0.0-beta.28 + React18/TS5/Tailwind4/Vite8 + Vditor4 离线。macOS 27 原生清单 A/B/C 类通过(B2 LiquidGlass 归回退增强);bin/pata + pata.app 产物验证。
- 完整报告:/tmp/minion/p2-001-final.md、p2-002-final.md;审查:/tmp/minion/p2-r1-report.md、p2-r2-report.md(如丢失,向对应 Worker 要)。

## 已知限制与后续(实装注意)

- SafeWrite TOCTOU 窗口(safety.go shortcut 注释,多进程写入时升级文件锁)。
- 文件移动时 Create 先于 Remove 到达会误拒同 ID 新路径,周期重扫自愈(实装处理"同 ID 换路径")。
- 无 frontmatter 占位 ID 无 n- 前缀;重扫 CreatedAt 漂移(不入盘)。
- parseErrors 无去重;fsnotify 测试靠 sleep 时序。
- status 外部手改 done 无事件:不伪造历史,完成时间未知(README §2.6)。
- public/vditor 全量 23MB 离线包,实装裁剪;@wailsio/runtime 曾浮动(P2-001 返工钉版)。
- build/ios 脚手架曾破坏 go build ./...(P2-001 返工修复中)。

## 阶段 2 剩余(proposal 任务 2-5,未开始)

Vault 目录选择 UI、扫描/索引接入 Go Core、Tasks 列表/创建/详情/编辑/状态/删除 UI、外部修改感知与冲突提示接入前端;存储核心从 spikes/storage 并入根模块。
