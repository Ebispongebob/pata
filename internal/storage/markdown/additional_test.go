package markdown

import (
	"strings"
	"testing"
	"time"
)

func TestPlainMarkdownWithoutFrontmatter(t *testing.T) {
	plainMD := "# 普通 Markdown 文件\n\n这是没有 YAML frontmatter 的笔记内容。"
	entity, err := ParseMarkdown("/vault/notes/plain.md", []byte(plainMD))
	if err != nil {
		t.Fatalf("failed to parse plain markdown: %v", err)
	}

	if entity.GetType() != EntityTypeNote {
		t.Fatalf("expected plain markdown to be treated as Note, got %s", entity.GetType())
	}
	if entity.GetBody() != plainMD {
		t.Fatalf("body mismatch: got %q", entity.GetBody())
	}
}

func TestTaskStatusEventsAndValidation(t *testing.T) {
	// Task with completed and reopened events
	now := time.Now()
	task := &Task{
		Type:      EntityTypeTask,
		ID:        "t-events-01",
		Title:     "生命周期历史",
		Status:    TaskStatusDoing,
		Priority:  TaskPriorityP1,
		CreatedAt: now.Add(-2 * time.Hour),
		UpdatedAt: now,
		StatusEvents: []StatusEvent{
			{Action: StatusEventActionCompleted, At: now.Add(-1 * time.Hour)},
			{Action: StatusEventActionReopened, At: now.Add(-30 * time.Minute)},
		},
	}

	if err := ValidateEntity("task.md", task); err != nil {
		t.Fatalf("expected valid task, got: %v", err)
	}

	// Invalid action
	taskInvalid := task.Clone().(*Task)
	taskInvalid.StatusEvents = []StatusEvent{
		{Action: "invalid_action", At: now},
	}
	if err := ValidateEntity("task.md", taskInvalid); err == nil {
		t.Fatalf("expected validation error on invalid action")
	}

	// Tag containing '#' should fail
	taskTagHash := task.Clone().(*Task)
	taskTagHash.Tags = []string{"#illegalTag"}
	if err := ValidateEntity("task.md", taskTagHash); err == nil {
		t.Fatalf("expected validation error on tag with '#'")
	}

	// Invalid due format
	taskBadDue := task.Clone().(*Task)
	badDue := "2026/10/11"
	taskBadDue.Due = &badDue
	if err := ValidateEntity("task.md", taskBadDue); err == nil {
		t.Fatalf("expected validation error on invalid due format")
	}
}

func TestPeriodicRescanFallback(t *testing.T) {
	tmpDir := t.TempDir()
	vault, err := NewVault(tmpDir)
	if err != nil {
		t.Fatalf("failed to init vault: %v", err)
	}

	stopTicker := vault.StartPeriodicRescan(50 * time.Millisecond)
	defer stopTicker()

	// Write a file directly into disk behind vault's back without watcher active
	notePath := vault.ResolveEntityPath(&Note{
		Type:      EntityTypeNote,
		ID:        "n-periodic-01",
		Title:     "周期重扫笔记",
		CreatedAt: time.Now(),
		UpdatedAt: time.Now(),
	})

	noteContent := `---
type: note
id: n-periodic-01
title: 周期重扫笔记
created_at: 2026-10-11T12:00:00+08:00
updated_at: 2026-10-11T12:00:00+08:00
---

等待周期重扫发现。
`
	_, _ = SafeWrite(notePath, []byte(noteContent), nil, nil)

	// Wait for periodic scan to run
	time.Sleep(150 * time.Millisecond)

	n, ok := vault.Index.GetNote("n-periodic-01")
	if !ok || n.Title != "周期重扫笔记" {
		t.Fatalf("periodic rescan failed to discover note: %+v", n)
	}
}

func TestUnclosedFrontmatterError(t *testing.T) {
	unclosed := `---
type: task
id: t-unclosed
title: Unclosed
`
	_, err := ParseMarkdown("unclosed.md", []byte(unclosed))
	if err == nil {
		t.Fatalf("expected unclosed frontmatter error, got nil")
	}
	if !strings.Contains(err.Error(), "unclosed frontmatter") {
		t.Fatalf("expected unclosed frontmatter reason, got %v", err)
	}
}
