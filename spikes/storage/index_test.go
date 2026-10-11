package storage

import (
	"path/filepath"
	"testing"
)

func TestScanExamplesVault(t *testing.T) {
	examplesDir := filepath.Join("..", "..", "docs", "02-foundation", "examples")
	idx, err := ScanVault(examplesDir)
	if err != nil {
		t.Fatalf("ScanVault failed: %v", err)
	}

	if len(idx.parseErrors) != 0 {
		t.Fatalf("expected 0 parse errors in examples, got %d: %+v", len(idx.parseErrors), idx.parseErrors)
	}

	// Verify tasks
	task1, ok := idx.GetTask("t-demo-001")
	if !ok || task1.Title != "统一资源接入方案" {
		t.Fatalf("t-demo-001 not found or wrong title: %+v", task1)
	}

	task2, ok := idx.GetTask("t-demo-002")
	if !ok || task2.Title != "Flink SQL 批处理 POC" {
		t.Fatalf("t-demo-002 not found or wrong title: %+v", task2)
	}

	// Verify memo
	memo1, ok := idx.GetMemo("m-demo-001")
	if !ok || memo1.TaskID != "t-demo-001" {
		t.Fatalf("m-demo-001 not found or wrong task_id: %+v", memo1)
	}

	// Verify day plan
	plan, ok := idx.GetDayPlan("2026-10-11")
	if !ok || len(plan.TaskIDs) != 2 {
		t.Fatalf("day plan 2026-10-11 not found or wrong task IDs: %+v", plan)
	}

	// Verify tag index and inheritance:
	// "架构设计" is on t-demo-001 and n-demo-001.
	// m-demo-001 has no own tags, but references t-demo-001!
	// Therefore FindByTag("架构设计") should match Task t-demo-001, Note n-demo-001, AND Memo m-demo-001 (inherited)!
	tagRefs := idx.FindByTag("架构设计")
	if len(tagRefs) != 3 {
		t.Fatalf("expected 3 entities for tag '架构设计' (Task, Note, inherited Memo), got %d: %+v", len(tagRefs), tagRefs)
	}

	hasInheritedMemo := false
	for _, ref := range tagRefs {
		if ref.Type == EntityTypeMemo && ref.ID == "m-demo-001" && ref.Inherited {
			hasInheritedMemo = true
		}
	}
	if !hasInheritedMemo {
		t.Fatalf("expected memo m-demo-001 to inherit tag '架构设计' from parent task")
	}

	// Tag "Doris" is on m-demo-002 only
	dorisRefs := idx.FindByTag("Doris")
	if len(dorisRefs) != 1 || dorisRefs[0].ID != "m-demo-002" {
		t.Fatalf("expected m-demo-002 for tag 'Doris', got %+v", dorisRefs)
	}
}

func TestDanglingReferences(t *testing.T) {
	idx := NewMemoryIndex()

	// Memo referencing non-existent task
	memo := &Memo{
		Type:   EntityTypeMemo,
		ID:     "m-orphan-1",
		TaskID: "t-missing-999",
	}
	idx.PutEntity("/vault/memos/m-orphan-1.md", memo, FileBaseline{})

	// Task referencing non-existent note
	task := &Task{
		Type:    EntityTypeTask,
		ID:      "t-orphan-1",
		Title:   "Some task",
		NoteIDs: []string{"n-missing-123"},
	}
	idx.PutEntity("/vault/tasks/t-orphan-1.md", task, FileBaseline{})

	// DayPlan referencing non-existent task
	plan := &DayPlan{
		Type:    EntityTypeDayPlan,
		Date:    "2026-10-11",
		TaskIDs: []string{"t-missing-999"},
	}
	idx.PutEntity("/vault/.pata/plans/2026-10-11.md", plan, FileBaseline{})

	dangling := idx.ListDanglingReferences()
	if len(dangling) != 3 {
		t.Fatalf("expected 3 dangling references, got %d: %+v", len(dangling), dangling)
	}

	// Verify explainable degradation details
	t.Logf("Dangling references correctly isolated:\n")
	for _, d := range dangling {
		t.Logf("  - %s\n", d.String())
	}
}
