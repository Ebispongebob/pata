package markdown

import (
	"os"
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

func TestVault_DeleteEntity_PreservesReferencingMemos(t *testing.T) {
	tmpDir := t.TempDir()
	vault, err := NewVault(tmpDir)
	if err != nil {
		t.Fatalf("failed to init vault: %v", err)
	}

	task := &Task{
		Type:      EntityTypeTask,
		ID:        "t-del-01",
		Title:     "待删除任务",
		Status:    TaskStatusTodo,
		Priority:  TaskPriorityP2,
		CreatedAt: time.Now(),
		UpdatedAt: time.Now(),
		Body:      "此任务将被删除",
	}
	if _, err := vault.SaveEntity(task, nil); err != nil {
		t.Fatalf("failed to save task: %v", err)
	}

	memo := &Memo{
		Type:      EntityTypeMemo,
		ID:        "m-ref-01",
		TaskID:    "t-del-01",
		CreatedAt: time.Now(),
		Body:      "关联到待删除任务的 Memo",
	}
	if _, err := vault.SaveEntity(memo, nil); err != nil {
		t.Fatalf("failed to save memo: %v", err)
	}

	taskPath := vault.ResolveEntityPath(task)
	memoPath := vault.ResolveEntityPath(memo)

	// Pre-condition: both exist
	if _, err := os.Stat(taskPath); err != nil {
		t.Fatalf("task file not found before delete: %v", err)
	}
	if _, err := os.Stat(memoPath); err != nil {
		t.Fatalf("memo file not found before delete: %v", err)
	}
	if len(vault.Index.ListDanglingReferences()) != 0 {
		t.Fatalf("unexpected dangling refs before delete")
	}

	// Delete task entity
	if err := vault.DeleteEntity("t-del-01"); err != nil {
		t.Fatalf("DeleteEntity failed: %v", err)
	}

	// 1. Task file deleted from disk
	if _, err := os.Stat(taskPath); !os.IsNotExist(err) {
		t.Fatalf("task file should have been deleted from disk, but stat err: %v", err)
	}

	// 2. Task removed from index
	if _, ok := vault.Index.GetTask("t-del-01"); ok {
		t.Fatalf("task still exists in index after DeleteEntity")
	}

	// 3. Memo file still exists on disk
	if _, err := os.Stat(memoPath); err != nil {
		t.Fatalf("memo file was deleted or cannot be stated: %v", err)
	}

	// 4. Memo still exists in index
	m, ok := vault.Index.GetMemo("m-ref-01")
	if !ok || m.Body != "关联到待删除任务的 Memo" {
		t.Fatalf("memo missing or corrupted in index after task delete: %+v", m)
	}

	// 5. Dangling references recomputed to include deleted task
	dangling := vault.Index.ListDanglingReferences()
	if len(dangling) != 1 || dangling[0].TargetID != "t-del-01" {
		t.Fatalf("expected 1 dangling reference pointing to t-del-01, got: %+v", dangling)
	}

	// Deleting non-existent entity should return error
	if err := vault.DeleteEntity("t-nonexistent"); err == nil {
		t.Fatalf("expected error when deleting non-existent entity")
	}
}

