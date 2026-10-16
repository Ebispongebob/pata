package markdown

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/fsnotify/fsnotify"
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

func TestVault_DeleteEntity_PreservesReferencingDayPlan(t *testing.T) {
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
		CreatedAt: time.Now(),
		UpdatedAt: time.Now(),
		Body:      "此任务将被删除",
	}
	if _, err := vault.SaveEntity(task, nil); err != nil {
		t.Fatalf("failed to save task: %v", err)
	}

	plan := &DayPlan{
		Type:    EntityTypeDayPlan,
		Date:    "2026-10-15",
		TaskIDs: []string{"t-del-01"},
	}
	if _, err := vault.SaveEntity(plan, nil); err != nil {
		t.Fatalf("failed to save plan: %v", err)
	}

	taskPath := vault.ResolveEntityPath(task)
	planPath := vault.ResolveEntityPath(plan)

	// Pre-condition: both exist
	if _, err := os.Stat(taskPath); err != nil {
		t.Fatalf("task file not found before delete: %v", err)
	}
	if _, err := os.Stat(planPath); err != nil {
		t.Fatalf("plan file not found before delete: %v", err)
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

	// 3. Plan file still exists on disk
	if _, err := os.Stat(planPath); err != nil {
		t.Fatalf("plan file was deleted or cannot be stated: %v", err)
	}

	// 4. Plan still exists in index
	p, ok := vault.Index.GetDayPlan("2026-10-15")
	if !ok || len(p.TaskIDs) != 1 || p.TaskIDs[0] != "t-del-01" {
		t.Fatalf("plan missing or corrupted in index after task delete: %+v", p)
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

// TestWatcher_SameID_PathConvergence_AtomicRename_CreateBeforeRemove tests that
// when a file is atomically renamed and fsnotify delivers Create before Remove,
// the index converges to the new path with no duplicate entities.
func TestWatcher_SameID_PathConvergence_AtomicRename_CreateBeforeRemove(t *testing.T) {
	vaultDir := t.TempDir()
	vault, err := NewVault(vaultDir)
	if err != nil {
		t.Fatalf("NewVault failed: %v", err)
	}

	task := &Task{
		Type:      EntityTypeTask,
		ID:        "t-converge-01",
		Title:     "重命名收敛测试任务",
		Status:    TaskStatusTodo,
		CreatedAt: time.Now(),
		UpdatedAt: time.Now(),
	}
	if _, err := vault.SaveEntity(task, nil); err != nil {
		t.Fatalf("SaveEntity failed: %v", err)
	}

	oldPath := vault.ResolveEntityPath(task)
	newPath := filepath.Join(filepath.Dir(oldPath), "renamed_task_t-converge-01.md")

	// Atomic rename: oldPath is immediately unlinked and newPath created
	if err := os.Rename(oldPath, newPath); err != nil {
		t.Fatalf("Rename failed: %v", err)
	}

	// Deliver Create(newPath) FIRST before Remove(oldPath)
	vault.handleFSEvent(fsnotify.Event{
		Name: newPath,
		Op:   fsnotify.Create,
	})

	// Check state right after Create: already converged because oldPath does not exist on disk
	tk, ok := vault.Index.GetTask("t-converge-01")
	if !ok {
		t.Fatalf("expected task in index after Create event, but not found")
	}
	if vault.ResolveEntityPath(tk) != newPath {
		t.Fatalf("expected entity path to be %s, got %s", newPath, vault.ResolveEntityPath(tk))
	}
	if len(vault.Index.ListTasks()) != 1 {
		t.Fatalf("expected exactly 1 task in index, got %d", len(vault.Index.ListTasks()))
	}

	// Deliver Remove(oldPath) SECOND
	vault.handleFSEvent(fsnotify.Event{
		Name: oldPath,
		Op:   fsnotify.Remove,
	})

	// Final verification: exactly 1 entity at newPath, no duplicates, no parseErrors
	finalTasks := vault.Index.ListTasks()
	if len(finalTasks) != 1 {
		t.Fatalf("expected 1 task after Remove, got %d", len(finalTasks))
	}
	if finalTasks[0].ID != "t-converge-01" {
		t.Fatalf("expected task ID t-converge-01, got %s", finalTasks[0].ID)
	}
	if vault.ResolveEntityPath(finalTasks[0]) != newPath {
		t.Fatalf("expected path %s, got %s", newPath, vault.ResolveEntityPath(finalTasks[0]))
	}
	if len(vault.Index.ListParseErrors()) != 0 {
		t.Fatalf("unexpected parse errors: %+v", vault.Index.ListParseErrors())
	}
}

// TestWatcher_SameID_PathConvergence_WriteThenDelete_CreateBeforeRemove tests that
// when an editor/tool writes the new file before removing the old file,
// and Create arrives before Remove, the candidate is promoted once old file is removed.
func TestWatcher_SameID_PathConvergence_WriteThenDelete_CreateBeforeRemove(t *testing.T) {
	vaultDir := t.TempDir()
	vault, err := NewVault(vaultDir)
	if err != nil {
		t.Fatalf("NewVault failed: %v", err)
	}

	task := &Task{
		Type:      EntityTypeTask,
		ID:        "t-converge-02",
		Title:     "写入后删除测试任务",
		Status:    TaskStatusDoing,
		CreatedAt: time.Now(),
		UpdatedAt: time.Now(),
	}
	if _, err := vault.SaveEntity(task, nil); err != nil {
		t.Fatalf("SaveEntity failed: %v", err)
	}

	oldPath := vault.ResolveEntityPath(task)
	newPath := filepath.Join(filepath.Dir(oldPath), "new_location_t-converge-02.md")

	// Read content from oldPath and write to newPath (both exist on disk simultaneously)
	data, err := os.ReadFile(oldPath)
	if err != nil {
		t.Fatalf("ReadFile oldPath failed: %v", err)
	}
	if err := os.WriteFile(newPath, data, 0644); err != nil {
		t.Fatalf("WriteFile newPath failed: %v", err)
	}

	// Deliver Create(newPath) FIRST while oldPath still exists
	vault.handleFSEvent(fsnotify.Event{
		Name: newPath,
		Op:   fsnotify.Create,
	})

	// At this point, newPath was recorded as pending candidate
	// Old task is still valid in index
	tMid, ok := vault.Index.GetTask("t-converge-02")
	if !ok {
		t.Fatalf("task lost in index during pending move")
	}
	if vault.ResolveEntityPath(tMid) != oldPath {
		t.Fatalf("expected task still at oldPath while oldPath exists")
	}

	// Now delete oldPath and deliver Remove(oldPath)
	if err := os.Remove(oldPath); err != nil {
		t.Fatalf("Remove oldPath failed: %v", err)
	}
	vault.handleFSEvent(fsnotify.Event{
		Name: oldPath,
		Op:   fsnotify.Remove,
	})

	// Final verification: pending move promoted, index converged to newPath, no duplicates
	tFinal, ok := vault.Index.GetTask("t-converge-02")
	if !ok {
		t.Fatalf("task lost after promotion")
	}
	if vault.ResolveEntityPath(tFinal) != newPath {
		t.Fatalf("expected task promoted to %s, got %s", newPath, vault.ResolveEntityPath(tFinal))
	}
	if len(vault.Index.ListTasks()) != 1 {
		t.Fatalf("expected exactly 1 task, got %d", len(vault.Index.ListTasks()))
	}
	if len(vault.Index.ListParseErrors()) != 0 {
		t.Fatalf("expected parseErrors to be cleared after promotion, got %+v", vault.Index.ListParseErrors())
	}
}

// TestWatcher_SameID_RealFSWatcher_PollingAssert tests real fsnotify watcher event handling
// with polling assertions rather than fragile sleep timings.
func TestWatcher_SameID_RealFSWatcher_PollingAssert(t *testing.T) {
	vaultDir := t.TempDir()
	vault, err := NewVault(vaultDir)
	if err != nil {
		t.Fatalf("NewVault failed: %v", err)
	}

	task := &Task{
		Type:      EntityTypeTask,
		ID:        "t-converge-03",
		Title:     "真实Watcher收敛测试",
		Status:    TaskStatusTodo,
		CreatedAt: time.Now(),
		UpdatedAt: time.Now(),
	}
	if _, err := vault.SaveEntity(task, nil); err != nil {
		t.Fatalf("SaveEntity failed: %v", err)
	}

	if err := vault.StartWatcher(); err != nil {
		t.Fatalf("StartWatcher failed: %v", err)
	}
	defer vault.StopWatcher()

	oldPath := vault.ResolveEntityPath(task)
	newPath := filepath.Join(filepath.Dir(oldPath), "renamed_real_t-converge-03.md")

	if err := os.Rename(oldPath, newPath); err != nil {
		t.Fatalf("Rename failed: %v", err)
	}

	// Polling assertion with timeout
	deadline := time.Now().Add(3 * time.Second)
	converged := false
	for time.Now().Before(deadline) {
		tk, ok := vault.Index.GetTask("t-converge-03")
		if ok && vault.ResolveEntityPath(tk) == newPath && len(vault.Index.ListTasks()) == 1 {
			converged = true
			break
		}
		time.Sleep(20 * time.Millisecond)
	}

	if !converged {
		t.Fatalf("watcher failed to converge within timeout; tasks: %d, path: %s",
			len(vault.Index.ListTasks()), vault.ResolveEntityPath(task))
	}
}

// TestVault_DeleteEntity_ClearsPendingMove_NoResurrection verifies should-2:
// When an external duplicate file with the same ID was written and stored in pendingMoves,
// deleting the original entity clears pendingMoves so the task does not resurrect.
func TestVault_DeleteEntity_ClearsPendingMove_NoResurrection(t *testing.T) {
	vaultDir := t.TempDir()
	vault, err := NewVault(vaultDir)
	if err != nil {
		t.Fatalf("NewVault failed: %v", err)
	}

	task := &Task{
		Type:      EntityTypeTask,
		ID:        "t-dup-del-01",
		Title:     "原版任务",
		Status:    TaskStatusTodo,
		CreatedAt: time.Now(),
		UpdatedAt: time.Now(),
	}
	if _, err := vault.SaveEntity(task, nil); err != nil {
		t.Fatalf("SaveEntity failed: %v", err)
	}

	oldPath := vault.ResolveEntityPath(task)

	// An external duplicate file is created with the exact same ID
	dupPath := filepath.Join(filepath.Dir(oldPath), "duplicate_task_t-dup-del-01.md")
	dupContent := `---
type: task
id: t-dup-del-01
title: 冲突重复任务
status: doing
priority: p1
created_at: 2026-10-11T12:00:00+08:00
updated_at: 2026-10-11T12:00:00+08:00
---

外部重复写入的内容。
`
	if err := os.WriteFile(dupPath, []byte(dupContent), 0644); err != nil {
		t.Fatalf("WriteFile dupPath failed: %v", err)
	}

	// Trigger watcher Create on the duplicate file while oldPath still exists
	vault.handleFSEvent(fsnotify.Event{
		Name: dupPath,
		Op:   fsnotify.Create,
	})

	// Verify dupPath is in pendingMoves
	vault.Index.mu.RLock()
	_, hasPending := vault.Index.pendingMoves["t-dup-del-01"]
	vault.Index.mu.RUnlock()
	if !hasPending {
		t.Fatalf("expected dupPath to be staged in pendingMoves")
	}

	// Now delete the entity via DeleteEntity
	if err := vault.DeleteEntity("t-dup-del-01"); err != nil {
		t.Fatalf("DeleteEntity failed: %v", err)
	}

	// 1. Task should NOT be in index
	if _, ok := vault.Index.GetTask("t-dup-del-01"); ok {
		t.Fatalf("task resurrected after DeleteEntity!")
	}

	// 2. ListTasks should not contain the deleted ID
	tasks := vault.Index.ListTasks()
	for _, tk := range tasks {
		if tk != nil && tk.ID == "t-dup-del-01" {
			t.Fatalf("deleted task still listed in ListTasks")
		}
	}

	// 3. Even if subsequent Remove event for oldPath arrives from fsnotify,
	// task must not resurrect from dupPath
	vault.handleFSEvent(fsnotify.Event{
		Name: oldPath,
		Op:   fsnotify.Remove,
	})

	if _, ok := vault.Index.GetTask("t-dup-del-01"); ok {
		t.Fatalf("task resurrected after subsequent Remove event!")
	}
	for _, tk := range vault.Index.ListTasks() {
		if tk != nil && tk.ID == "t-dup-del-01" {
			t.Fatalf("task resurrected in ListTasks after Remove event!")
		}
	}
}

func TestTaskCompletedAtAndLegacyDoing(t *testing.T) {
	// 1. Legacy doing status is normalized to todo on ParseMarkdown
	legacyMD := `---
type: task
id: t-legacy-01
title: 兼容旧进行中状态任务
status: doing
created_at: 2026-10-14T09:00:00+08:00
updated_at: 2026-10-14T09:30:00+08:00
---

正文内容
`
	ent, err := ParseMarkdown("task.md", []byte(legacyMD))
	if err != nil {
		t.Fatalf("ParseMarkdown failed on legacy doing status: %v", err)
	}
	task, ok := ent.(*Task)
	if !ok {
		t.Fatalf("expected *Task, got %T", ent)
	}
	if task.Status != TaskStatusTodo {
		t.Fatalf("expected status to be normalized to todo, got %s", task.Status)
	}

	// 2. Task with explicit completed_at
	completedMD := `---
type: task
id: t-completed-01
title: 已完成任务
status: done
completed_at: 2026-10-14T10:00:00+08:00
created_at: 2026-10-14T09:00:00+08:00
updated_at: 2026-10-14T10:00:00+08:00
---
`
	entDone, err := ParseMarkdown("task_done.md", []byte(completedMD))
	if err != nil {
		t.Fatalf("ParseMarkdown failed on completed task: %v", err)
	}
	taskDone, ok := entDone.(*Task)
	if !ok {
		t.Fatalf("expected *Task, got %T", entDone)
	}
	if taskDone.Status != TaskStatusDone {
		t.Fatalf("expected status done, got %s", taskDone.Status)
	}
	if taskDone.CompletedAt == nil {
		t.Fatalf("expected completed_at to be parsed")
	}
	if taskDone.CompletedAt.Format(time.RFC3339) != "2026-10-14T10:00:00+08:00" {
		t.Fatalf("completed_at mismatch: %v", taskDone.CompletedAt)
	}

	// 3. Serialize and verify completed_at appears in YAML frontmatter
	bytes, err := SerializeMarkdown(taskDone)
	if err != nil {
		t.Fatalf("SerializeMarkdown failed: %v", err)
	}
	if !strings.Contains(string(bytes), "completed_at:") {
		t.Fatalf("serialized markdown missing completed_at: %s", string(bytes))
	}
}
