package markdown

import (
	"path/filepath"
	"testing"
	"time"
)

func TestScanExamplesVault(t *testing.T) {
	examplesDir := filepath.Join("..", "..", "..", "docs", "02-foundation", "examples")
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

func TestListTasksSortedByUpdatedAt(t *testing.T) {
	idx, err := ScanVault(filepath.Join("..", "..", "..", "docs", "02-foundation", "examples"))
	if err != nil {
		t.Fatalf("ScanVault failed: %v", err)
	}
	tasks := idx.ListTasks()
	if len(tasks) < 2 {
		t.Fatalf("expected at least 2 tasks, got %d", len(tasks))
	}
	for i := 1; i < len(tasks); i++ {
		if tasks[i-1].UpdatedAt.Before(tasks[i].UpdatedAt) {
			t.Fatalf("tasks not sorted by UpdatedAt desc: [%d]=%s before [%d]=%s", i-1, tasks[i-1].ID, i, tasks[i].ID)
		}
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

func TestListMemosByTask(t *testing.T) {
	idx := NewMemoryIndex()

	t1 := time.Date(2026, 10, 11, 10, 0, 0, 0, time.UTC)
	t2 := time.Date(2026, 10, 11, 11, 0, 0, 0, time.UTC)
	t3 := time.Date(2026, 10, 11, 12, 0, 0, 0, time.UTC)

	memo1 := &Memo{
		Type:      EntityTypeMemo,
		ID:        "m-001",
		TaskID:    "t-target",
		CreatedAt: t2,
		Body:      "第二条评论",
	}
	memo2 := &Memo{
		Type:      EntityTypeMemo,
		ID:        "m-002",
		TaskID:    "t-target",
		CreatedAt: t1,
		Body:      "第一条评论",
	}
	memo3 := &Memo{
		Type:      EntityTypeMemo,
		ID:        "m-003",
		TaskID:    "t-target",
		CreatedAt: t3,
		Body:      "第三条评论",
	}
	memoOther := &Memo{
		Type:      EntityTypeMemo,
		ID:        "m-004",
		TaskID:    "t-other",
		CreatedAt: t1,
		Body:      "其他任务的评论",
	}
	memoStandAlone := &Memo{
		Type:      EntityTypeMemo,
		ID:        "m-005",
		TaskID:    "",
		CreatedAt: t1,
		Body:      "独立 Memo",
	}

	idx.PutEntity("/vault/memos/2026/10/m-001.md", memo1, FileBaseline{})
	idx.PutEntity("/vault/memos/2026/10/m-002.md", memo2, FileBaseline{})
	idx.PutEntity("/vault/memos/2026/10/m-003.md", memo3, FileBaseline{})
	idx.PutEntity("/vault/memos/2026/10/m-004.md", memoOther, FileBaseline{})
	idx.PutEntity("/vault/memos/2026/10/m-005.md", memoStandAlone, FileBaseline{})

	// 1. Filter and sorting check (must be sorted by CreatedAt ascending: m-002, m-001, m-003)
	memos := idx.ListMemosByTask("t-target")
	if len(memos) != 3 {
		t.Fatalf("expected 3 memos for t-target, got %d", len(memos))
	}
	if memos[0].ID != "m-002" || memos[1].ID != "m-001" || memos[2].ID != "m-003" {
		t.Fatalf("expected order [m-002, m-001, m-003], got [%s, %s, %s]", memos[0].ID, memos[1].ID, memos[2].ID)
	}

	// 2. Clone check (mutation of returned memo shouldn't affect index)
	memos[0].Body = "篡改的正文"
	m2, _ := idx.GetMemo("m-002")
	if m2.Body != "第一条评论" {
		t.Fatalf("index entity was mutated through returned clone")
	}

	// 3. Query non-existent task returns empty slice, not nil
	empty := idx.ListMemosByTask("t-not-found")
	if empty == nil || len(empty) != 0 {
		t.Fatalf("expected non-nil empty slice for non-existent task, got %v", empty)
	}
}
