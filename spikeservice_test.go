package main

import (
	"os"
	"strings"
	"testing"
)

const testMarkdownContent = `# Pata 阶段 2 架构设计与 Markdown 往返一致性验证

> 这是一篇用于验证 **Vditor** 在本地优先（Local First）架构下 Markdown 往返（Round-trip）精度的测试长文。
> 包含多语言代码块、复杂表格、中文排版标记与相对链接。

## 1. 核心架构设计

Pata 遵循以下三大工程设计原则：
1. **Less is More**：单列浏览、低视觉干扰、不增加多余状态卡片。
2. **Record Once**：单次记录，通过标签与关联动态汇聚。
3. **Local First**：纯本地文件存储，Markdown 作为唯一真相源。

相关任务请参阅 [阶段 2 基础设施任务](./tasks/task-p2-001.md)，设计规范见 [macOS 原生体验规范](../docs/01-validate/macos-native.md)。

---

## 2. 状态机与技术选型比较

以下为不同技术路线的评估结果：

| 组件分类 | 选型方案 | 替代方案 | 优势分析 | 往返稳定性 |
| :--- | :--- | :--- | :--- | :---: |
| 桌面宿主 | Wails v3 | Tauri / Electron | 轻量原生、Go 内存安全、无额外 Node 运行时 | 优秀 (A+) |
| 编辑器核心 | Vditor (WYSIWYG) | Milkdown / TipTap | 所见即所得体验佳、原生 Markdown 导出 | 验证中 |
| 索引引擎 | 内存扫描索引 | SQLite / DuckDB | 纯文件为中心、无需数据库迁移 | 优秀 (A) |
| 文件监听 | fsnotify | 轮询定时扫描 | 低延迟响应外部编辑器变动 | 良好 (B+) |

---

## 3. Go 核心接口定义

` + "```go" + `
package domain

import (
	"time"
)

// Task 表示一个纯文本 Markdown 任务实体
type Task struct {
	ID        string    ` + "`yaml:\"id\"`" + `
	Title     string    ` + "`yaml:\"title\"`" + `
	Status    string    ` + "`yaml:\"status\"`" + ` // todo, doing, done
	Priority  string    ` + "`yaml:\"priority\"`" + ` // p1, p2, p3
	Due       *string   ` + "`yaml:\"due,omitempty\"`" + `
	Tags      []string  ` + "`yaml:\"tags,omitempty\"`" + `
	NoteIDs   []string  ` + "`yaml:\"note_ids,omitempty\"`" + `
	CreatedAt time.Time ` + "`yaml:\"created_at\"`" + `
	UpdatedAt time.Time ` + "`yaml:\"updated_at\"`" + `
}
` + "```" + `

## 4. TypeScript 运行时调用

` + "```typescript" + `
export async function verifyDesktopSpike(): Promise<boolean> {
  const sysInfo = await SpikeService.GetSystemInfo();
  console.log("Running on:", sysInfo.productVersion, sysInfo.arch);
  return sysInfo.os === "darwin";
}
` + "```" + `

## 5. 关联引用与备忘

- 任务文档链接：[Task-101 统一资源接入方案](./tasks/task-101.md)
- 历史备忘：[Memo 2026-10-11 验证发现](../memos/2026/10/memo-20261011.md)
- 标签聚合：` + "`#架构设计`" + `、` + "`#Flink`" + `、` + "`#Doris`" + `
- 中文混合符号：测试 “全角引号”、‘单引号’、《书名号》以及数学符号 ∑(x) = ∫f(t)dt。
`

func TestSpikeService_RoundTrip(t *testing.T) {
	service := NewSpikeService()
	defer os.RemoveAll("./spike-data")

	savedPath, err := service.SaveMarkdown("test-roundtrip.md", testMarkdownContent)
	if err != nil {
		t.Fatalf("SaveMarkdown failed: %v", err)
	}
	if !strings.HasSuffix(savedPath, "test-roundtrip.md") {
		t.Errorf("unexpected savedPath: %s", savedPath)
	}

	reloaded, err := service.ReadMarkdown("test-roundtrip.md")
	if err != nil {
		t.Fatalf("ReadMarkdown failed: %v", err)
	}

	res := service.VerifyRoundTrip(testMarkdownContent, reloaded)
	if !res.Success {
		t.Errorf("VerifyRoundTrip failed: diffSummary=%s, diffCount=%d", res.DiffSummary, res.DiffCount)
	}
	if !res.HasCodeBlock {
		t.Error("expected HasCodeBlock=true")
	}
	if !res.HasTable {
		t.Error("expected HasTable=true")
	}
	if !res.HasChinese {
		t.Error("expected HasChinese=true")
	}
	if !res.HasRelativeLinks {
		t.Error("expected HasRelativeLinks=true")
	}
	if res.OriginalLen != res.ReloadedLen {
		t.Errorf("length mismatch: orig=%d, reloaded=%d", res.OriginalLen, res.ReloadedLen)
	}
}

func TestSpikeService_GetSystemInfo(t *testing.T) {
	service := NewSpikeService()
	info := service.GetSystemInfo()

	if info.OS != "darwin" {
		t.Errorf("expected OS=darwin, got %s", info.OS)
	}
	if info.Arch == "" {
		t.Error("expected Arch not empty")
	}
	if info.WailsVersion == "" {
		t.Error("expected WailsVersion not empty")
	}
	if info.ProductVersion == "" {
		t.Error("expected ProductVersion not empty")
	}
}
