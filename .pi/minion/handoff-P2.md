# Minion 阶段 2 委派记录(Lead 交接)

更新:2026-10-12(P2-003 Tasks 管理闭环已交付)· 环境 work(config-work.yaml)· Lead:pi 会话

## 状态:三个 Worker 已关闭,无遗留任务

## Worker 运行映射(本批)

| Worker | Tab/Pane | 组合 | 实际模型(证据) | 状态 |
|---|---|---|---|---|
| p2-tasks | w17:t5 / w17:p5 | agy | Gemini 3.8 Flash · high(状态栏) | ✅ P2-003 完成(尝试 2,网络中断恢复一次),已关闭 |
| p2-reviewer | w17:t6 / w17:p6 | pi + zoesoft/glm-5.3 | glm-5.3(状态栏) | ✅ P2-R4 完成(0 must/2 should/5 nice,返工项已修),已关闭 |

## 已交付(Spike 全部验收通过)

- **P2-001 桌面 Spike**(43f8626 验收):Wails v3.0.0-beta.28 + React18/TS5/Tailwind4/Vite8 + Vditor4 离线(钉版)。macOS 27 清单 A/B/C 全过(B2 LiquidGlass 回退增强);go build ./...、vet、test 全绿;模板残留已清;报告 docs/02-foundation/spike-desktop-result.md。
- **P2-002 存储核心**(eea0137+1e245db 验收):frontmatter(未知字段值保留)/四实体校验/ULID/slug_id 文件名/vault 索引/安全写入(原子替换+目录 fsync+hash 冲突拒绝+nil 基线防覆盖)/fsnotify 抑制+重扫兜底;34 测试含 -race 全绿,双重复核。
- **第一批实装**(bb67a63,Lead 直做):存储核心并入 internal/storage/markdown;单 Vault 服务(选择对话框/持久化/自动打开/watcher+周期重扫);Tasks 列表真实数据;D18 单 Vault 决策。
- **P2-003 Tasks 管理闭环**(4f83fed 验收,提交含 P2-R4 返工):VaultService 五方法(状态事件语义:done→completed、reopen 追加且保留历史;baseline 冲突拒绝);markdown.Vault.DeleteEntity(删文件+清索引,不级联 Memo);前端 TasksView(快速创建/筛选搜索/详情编辑 textarea 正文/状态切换/删除确认弹窗/错误回显);34 测试含 -race 全绿;Lead 终验 vet/test/tsc/wails3 build 全过。
- **P2-R4 审查结论**:Go 核心状态流转/SafeWrite baseline/删除语义/校验全部正确且有测试;返工修复 should-1(rescan 后列表不刷新回归)、should-2(列表加载静默失败)、nice-3(baseline 重复块+不可达 fallback)、nice-4/5/7;nice-6(alert 风格)留后续。

## 已知限制与后续(实装注意)

- SafeWrite TOCTOU 窗口(safety.go shortcut 注释,多进程写入时升级文件锁)。
- 文件移动时 Create 先于 Remove 到达会误拒同 ID 新路径,周期重扫自愈(实装处理"同 ID 换路径")。
- 无 frontmatter 占位 ID 无 n- 前缀;重扫 CreatedAt 漂移(不入盘)。
- parseErrors 无去重;fsnotify 测试靠 sleep 时序。
- status 外部手改 done 无事件:不伪造历史,完成时间未知(README §2.6)。
- public/vditor 全量 23MB 离线包,实装裁剪;@wailsio/runtime 曾浮动(P2-001 返工钉版)。
- 生成文件 spikeservice.ts 被手加注释,下次 generate bindings 会丢(P2-R3 nit,重生成时补到别处)。

## 阶段 2 剩余(proposal 任务 2-5)

已完:任务 2/3(数据底座接入)、任务 4(Tasks 管理闭环,P2-003)。

未完:**任务 5**——外部修改感知与冲突提示接入前端(fsnotify 事件→UI 通知/冲突弹窗,处理 SafeWrite ConflictError 的前端呈现;顺带处理 Spike 已知限制:同 ID 换路径误拒、TOCTOU);阶段验收清单勾选与实机回归(含重启后任务正确性的手动验证);Spike 演示页/SpikeService/spike-data 清理。
