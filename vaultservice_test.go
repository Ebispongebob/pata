package main

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"pata/internal/storage/markdown"
)

func TestVaultServiceConfigRoundTrip(t *testing.T) {
	dir := t.TempDir()
	s := &VaultService{configPath: filepath.Join(dir, "vault.json")}

	// Missing file returns empty config without error (fresh install)
	cfg, err := s.loadConfig()
	if err != nil || cfg.VaultPath != "" {
		t.Fatalf("loadConfig on missing file = %+v, %v", cfg, err)
	}

	if err := s.saveConfig(VaultConfig{VaultPath: "/tmp/my-vault"}); err != nil {
		t.Fatalf("saveConfig failed: %v", err)
	}
	cfg, err = s.loadConfig()
	if err != nil || cfg.VaultPath != "/tmp/my-vault" {
		t.Fatalf("loadConfig = %+v, %v", cfg, err)
	}
}

func TestVaultServiceOpenAndListTasks(t *testing.T) {
	vaultDir := t.TempDir()
	task := &markdown.Task{
		Type:      markdown.EntityTypeTask,
		ID:        markdown.GenerateEntityID(markdown.EntityTypeTask),
		Title:     "冒烟测试任务",
		Status:    markdown.TaskStatusTodo,
		Priority:  markdown.TaskPriorityP2,
		CreatedAt: time.Now(),
		UpdatedAt: time.Now(),
	}
	v, err := markdown.NewVault(vaultDir)
	if err != nil {
		t.Fatalf("NewVault failed: %v", err)
	}
	if _, err := v.SaveEntity(task, nil); err != nil {
		t.Fatalf("SaveEntity failed: %v", err)
	}

	s := &VaultService{}
	if _, err := s.openVault(vaultDir); err != nil {
		t.Fatalf("openVault failed: %v", err)
	}

	st := s.GetVaultStatus()
	if !st.Open || st.TaskCount != 1 {
		t.Fatalf("unexpected status: %+v", st)
	}

	tasks, err := s.ListTasks()
	if err != nil || len(tasks) != 1 || tasks[0].Title != "冒烟测试任务" {
		t.Fatalf("ListTasks = %+v, %v", tasks, err)
	}

	if err := s.RescanVault(); err != nil {
		t.Fatalf("RescanVault failed: %v", err)
	}

	// Opening a second vault must replace the first (single vault, D18)
	other := t.TempDir()
	if _, err := s.openVault(other); err != nil {
		t.Fatalf("openVault(second) failed: %v", err)
	}
	if st := s.GetVaultStatus(); st.TaskCount != 0 {
		t.Fatalf("expected replaced vault to be empty, got %+v", st)
	}

	if s.stopWatcher != nil {
		s.stopWatcher()
	}
}

func TestVaultService_CreateTask_PersistAndRestart(t *testing.T) {
	vaultDir := t.TempDir()
	s := &VaultService{}
	if _, err := s.openVault(vaultDir); err != nil {
		t.Fatalf("openVault failed: %v", err)
	}
	defer func() {
		if s.stopWatcher != nil {
			s.stopWatcher()
		}
	}()

	refNote, err := s.CreateNote(CreateNoteInput{
		Title: "阶段2参考笔记",
	})
	if err != nil {
		t.Fatalf("CreateNote failed: %v", err)
	}

	dueStr := "2026-10-15"
	input := CreateTaskInput{
		Title:    "阶段2任务落地",
		Status:   markdown.TaskStatusDoing,
		Priority: markdown.TaskPriorityP1,
		Due:      &dueStr,
		Tags:     []string{"架构设计", "GoCore"},
		NoteIDs:  []string{refNote.ID},
		Body:     "## 验收目标\n- 任务必须写真实 Markdown\n- 重扫解析正确",
	}

	created, err := s.CreateTask(input)
	if err != nil {
		t.Fatalf("CreateTask failed: %v", err)
	}

	if !strings.HasPrefix(created.ID, "t-") {
		t.Fatalf("expected task ID prefix 't-', got %s", created.ID)
	}
	if created.Title != "阶段2任务落地" {
		t.Fatalf("title mismatch: %s", created.Title)
	}
	if created.Status != markdown.TaskStatusDoing {
		t.Fatalf("status mismatch: %s", created.Status)
	}
	if created.Priority != markdown.TaskPriorityP1 {
		t.Fatalf("priority mismatch: %s", created.Priority)
	}
	if created.Due == nil || *created.Due != "2026-10-15" {
		t.Fatalf("due mismatch: %v", created.Due)
	}
	if len(created.Tags) != 2 || created.Tags[0] != "架构设计" {
		t.Fatalf("tags mismatch: %v", created.Tags)
	}
	if created.CreatedAt.IsZero() || created.UpdatedAt.IsZero() {
		t.Fatalf("timestamps not set")
	}

	// 1. Verify markdown file on disk exists in tasks/ directory
	taskPath := s.vault.ResolveEntityPath(created)
	data, err := os.ReadFile(taskPath)
	if err != nil {
		t.Fatalf("failed to read created task file from disk %s: %v", taskPath, err)
	}

	// 2. Parse file from disk to ensure valid YAML frontmatter + Markdown body
	parsed, err := markdown.ParseMarkdown(taskPath, data)
	if err != nil {
		t.Fatalf("ParseMarkdown failed on created file: %v", err)
	}
	parsedTask, ok := parsed.(*markdown.Task)
	if !ok {
		t.Fatalf("parsed entity is not a Task: %T", parsed)
	}
	if parsedTask.Title != created.Title || strings.TrimSpace(parsedTask.Body) != strings.TrimSpace(created.Body) {
		t.Fatalf("parsed task content mismatch: got title=%q, want title=%q, got body=%q, want body=%q",
			parsedTask.Title, created.Title, parsedTask.Body, created.Body)
	}

	// 3. Rescan vault index
	if err := s.RescanVault(); err != nil {
		t.Fatalf("RescanVault failed: %v", err)
	}
	fetched, err := s.GetTask(created.ID)
	if err != nil || fetched.Title != created.Title {
		t.Fatalf("GetTask after rescan failed: %v, task=%+v", err, fetched)
	}

	// 4. Simulate app restart: brand new VaultService opening the same directory
	s2 := &VaultService{}
	if _, err := s2.openVault(vaultDir); err != nil {
		t.Fatalf("s2 openVault restart simulation failed: %v", err)
	}
	defer func() {
		if s2.stopWatcher != nil {
			s2.stopWatcher()
		}
	}()

	restartedTasks, err := s2.ListTasks()
	if err != nil || len(restartedTasks) != 1 {
		t.Fatalf("s2 ListTasks failed: %v, count=%d", err, len(restartedTasks))
	}
	restartedTask := restartedTasks[0]
	if restartedTask.ID != created.ID || restartedTask.Title != created.Title || strings.TrimSpace(restartedTask.Body) != strings.TrimSpace(created.Body) {
		t.Fatalf("restarted task mismatch: %+v", restartedTask)
	}
}

func TestVaultService_StatusTransitions_HistoryPreserved(t *testing.T) {
	vaultDir := t.TempDir()
	s := &VaultService{}
	if _, err := s.openVault(vaultDir); err != nil {
		t.Fatalf("openVault failed: %v", err)
	}
	defer func() {
		if s.stopWatcher != nil {
			s.stopWatcher()
		}
	}()

	created, err := s.CreateTask(CreateTaskInput{
		Title:  "状态变更测试任务",
		Status: markdown.TaskStatusTodo,
	})
	if err != nil {
		t.Fatalf("CreateTask failed: %v", err)
	}
	if len(created.StatusEvents) != 0 {
		t.Fatalf("expected 0 status events initially for todo, got %d", len(created.StatusEvents))
	}

	// 1. todo -> done: should record completed event
	tDone, err := s.SetTaskStatus(created.ID, markdown.TaskStatusDone)
	if err != nil {
		t.Fatalf("SetTaskStatus(done) failed: %v", err)
	}
	if tDone.Status != markdown.TaskStatusDone {
		t.Fatalf("expected done status, got %s", tDone.Status)
	}
	if len(tDone.StatusEvents) != 1 {
		t.Fatalf("expected 1 event, got %d", len(tDone.StatusEvents))
	}
	if tDone.StatusEvents[0].Action != markdown.StatusEventActionCompleted || tDone.StatusEvents[0].At.IsZero() {
		t.Fatalf("unexpected completed event: %+v", tDone.StatusEvents[0])
	}

	// 2. done -> doing (reopen): should append reopened event, preserving completed
	tDoing, err := s.SetTaskStatus(created.ID, markdown.TaskStatusDoing)
	if err != nil {
		t.Fatalf("SetTaskStatus(doing) failed: %v", err)
	}
	if tDoing.Status != markdown.TaskStatusDoing {
		t.Fatalf("expected doing status, got %s", tDoing.Status)
	}
	if len(tDoing.StatusEvents) != 2 {
		t.Fatalf("expected 2 events after reopen, got %d", len(tDoing.StatusEvents))
	}
	if tDoing.StatusEvents[0].Action != markdown.StatusEventActionCompleted {
		t.Fatalf("expected event 0 to be completed, got %s", tDoing.StatusEvents[0].Action)
	}
	if tDoing.StatusEvents[1].Action != markdown.StatusEventActionReopened || tDoing.StatusEvents[1].At.IsZero() {
		t.Fatalf("expected event 1 to be reopened, got %+v", tDoing.StatusEvents[1])
	}

	// 3. doing -> done: should append second completed event
	tDoneAgain, err := s.SetTaskStatus(created.ID, markdown.TaskStatusDone)
	if err != nil {
		t.Fatalf("SetTaskStatus(done again) failed: %v", err)
	}
	if len(tDoneAgain.StatusEvents) != 3 {
		t.Fatalf("expected 3 events, got %d", len(tDoneAgain.StatusEvents))
	}
	if tDoneAgain.StatusEvents[2].Action != markdown.StatusEventActionCompleted {
		t.Fatalf("expected event 2 to be completed, got %s", tDoneAgain.StatusEvents[2].Action)
	}

	// 4. UpdateTask with status todo (reopen): should append reopened event, preserving all 3 prior events
	tTodo, err := s.UpdateTask(UpdateTaskInput{
		ID:       created.ID,
		Title:    "更新标题后的任务",
		Status:   markdown.TaskStatusTodo,
		Priority: markdown.TaskPriorityP1,
		Body:     "更新后的内容",
	})
	if err != nil {
		t.Fatalf("UpdateTask failed: %v", err)
	}
	if tTodo.Status != markdown.TaskStatusTodo {
		t.Fatalf("expected todo status, got %s", tTodo.Status)
	}
	if len(tTodo.StatusEvents) != 4 {
		t.Fatalf("expected 4 events, got %d", len(tTodo.StatusEvents))
	}
	if tTodo.StatusEvents[3].Action != markdown.StatusEventActionReopened {
		t.Fatalf("expected event 3 to be reopened, got %s", tTodo.StatusEvents[3].Action)
	}

	// 5. Verify on disk after rescan
	if err := s.RescanVault(); err != nil {
		t.Fatalf("RescanVault failed: %v", err)
	}
	reloaded, err := s.GetTask(created.ID)
	if err != nil || len(reloaded.StatusEvents) != 4 {
		t.Fatalf("reloaded task status events mismatch: %v, count=%d", err, len(reloaded.StatusEvents))
	}
}

func TestVaultService_DeleteTask_IndexAndMemoPreserved(t *testing.T) {
	vaultDir := t.TempDir()
	s := &VaultService{}
	if _, err := s.openVault(vaultDir); err != nil {
		t.Fatalf("openVault failed: %v", err)
	}
	defer func() {
		if s.stopWatcher != nil {
			s.stopWatcher()
		}
	}()

	task, err := s.CreateTask(CreateTaskInput{
		Title: "将要删除的任务",
	})
	if err != nil {
		t.Fatalf("CreateTask failed: %v", err)
	}

	// Create associated Memo referencing task
	memo := &markdown.Memo{
		Type:      markdown.EntityTypeMemo,
		ID:        "m-associated-01",
		TaskID:    task.ID,
		CreatedAt: time.Now(),
		Body:      "此 Memo 关联到 task，删除 task 时绝对不能被删除",
	}
	if _, err := s.vault.SaveEntity(memo, nil); err != nil {
		t.Fatalf("SaveEntity memo failed: %v", err)
	}

	taskPath := s.vault.ResolveEntityPath(task)
	memoPath := s.vault.ResolveEntityPath(memo)

	// Ensure files exist on disk
	if _, err := os.Stat(taskPath); err != nil {
		t.Fatalf("task file not found: %v", err)
	}
	if _, err := os.Stat(memoPath); err != nil {
		t.Fatalf("memo file not found: %v", err)
	}

	// Delete task
	if err := s.DeleteTask(task.ID); err != nil {
		t.Fatalf("DeleteTask failed: %v", err)
	}

	// 1. Task file removed from disk
	if _, err := os.Stat(taskPath); !os.IsNotExist(err) {
		t.Fatalf("task file still exists on disk after DeleteTask")
	}

	// 2. Task removed from index
	if _, err := s.GetTask(task.ID); err == nil {
		t.Fatalf("expected error when getting deleted task, got nil")
	}
	tasks, _ := s.ListTasks()
	for _, tk := range tasks {
		if tk != nil && tk.ID == task.ID {
			t.Fatalf("deleted task still listed in ListTasks")
		}
	}

	// 3. Deleting already deleted task returns error
	if err := s.DeleteTask(task.ID); err == nil {
		t.Fatalf("expected error when re-deleting task, got nil")
	}

	// 4. Memo file still exists on disk!
	if _, err := os.Stat(memoPath); err != nil {
		t.Fatalf("memo file was deleted or cannot be stated: %v", err)
	}

	// 5. Memo is still in index
	indexedMemo, ok := s.vault.Index.GetMemo("m-associated-01")
	if !ok || indexedMemo.Body != memo.Body {
		t.Fatalf("memo lost or corrupted in index after task delete: %+v", indexedMemo)
	}

	// 6. Dangling references track that task is gone
	dangling := s.vault.Index.ListDanglingReferences()
	if len(dangling) != 1 || dangling[0].TargetID != task.ID {
		t.Fatalf("expected 1 dangling reference pointing to %s, got: %+v", task.ID, dangling)
	}
}

func TestVaultService_UnknownFieldsPreserved(t *testing.T) {
	vaultDir := t.TempDir()
	tasksDir := filepath.Join(vaultDir, "tasks")
	if err := os.MkdirAll(tasksDir, 0755); err != nil {
		t.Fatalf("MkdirAll failed: %v", err)
	}

	rawFile := filepath.Join(tasksDir, "custom_task_t-ext-01.md")
	rawContent := `---
type: task
id: t-ext-01
title: 未知字段测试
status: todo
priority: p2
created_at: 2026-10-11T10:00:00+08:00
updated_at: 2026-10-11T10:00:00+08:00
agent_extension:
  handler: custom-agent
  confidence: 0.99
custom_id: pi-9988
---

任务说明正文。
`
	if err := os.WriteFile(rawFile, []byte(rawContent), 0644); err != nil {
		t.Fatalf("WriteFile failed: %v", err)
	}

	s := &VaultService{}
	if _, err := s.openVault(vaultDir); err != nil {
		t.Fatalf("openVault failed: %v", err)
	}
	defer func() {
		if s.stopWatcher != nil {
			s.stopWatcher()
		}
	}()

	task, err := s.GetTask("t-ext-01")
	if err != nil {
		t.Fatalf("GetTask failed: %v", err)
	}

	// 1. Update task through service
	updated, err := s.UpdateTask(UpdateTaskInput{
		ID:       task.ID,
		Title:    "已知标题被修改",
		Status:   markdown.TaskStatusDoing,
		Priority: markdown.TaskPriorityP1,
		Body:     "更新后的正文内容。",
	})
	if err != nil {
		t.Fatalf("UpdateTask failed: %v", err)
	}
	if updated.Title != "已知标题被修改" {
		t.Fatalf("title not updated: %s", updated.Title)
	}

	// 2. Set task status to done
	_, err = s.SetTaskStatus("t-ext-01", markdown.TaskStatusDone)
	if err != nil {
		t.Fatalf("SetTaskStatus failed: %v", err)
	}

	// 3. Read back markdown file directly from disk
	diskBytes, err := os.ReadFile(rawFile)
	if err != nil {
		t.Fatalf("ReadFile failed: %v", err)
	}
	diskStr := string(diskBytes)

	// Check that unknown YAML fields are preserved!
	if !strings.Contains(diskStr, "agent_extension:") {
		t.Fatalf("unknown field agent_extension lost! Disk content:\n%s", diskStr)
	}
	if !strings.Contains(diskStr, "handler: custom-agent") {
		t.Fatalf("unknown nested field handler lost! Disk content:\n%s", diskStr)
	}
	if !strings.Contains(diskStr, "custom_id: pi-9988") {
		t.Fatalf("unknown field custom_id lost! Disk content:\n%s", diskStr)
	}
	if !strings.Contains(diskStr, "已知标题被修改") {
		t.Fatalf("updated title not in disk file! Disk content:\n%s", diskStr)
	}
}

func TestVaultService_ValidationErrors(t *testing.T) {
	vaultDir := t.TempDir()
	s := &VaultService{}
	if _, err := s.openVault(vaultDir); err != nil {
		t.Fatalf("openVault failed: %v", err)
	}
	defer func() {
		if s.stopWatcher != nil {
			s.stopWatcher()
		}
	}()

	// 1. Empty title
	if _, err := s.CreateTask(CreateTaskInput{Title: "   "}); err == nil {
		t.Fatalf("expected error for empty title")
	}

	// 2. Invalid priority
	if _, err := s.CreateTask(CreateTaskInput{Title: "T", Priority: "p4"}); err == nil {
		t.Fatalf("expected error for invalid priority p4")
	}

	// 3. Invalid due date
	badDue := "2026-99-99"
	if _, err := s.CreateTask(CreateTaskInput{Title: "T", Due: &badDue}); err == nil {
		t.Fatalf("expected error for invalid due format")
	}

	// 4. Invalid tag containing '#'
	if _, err := s.CreateTask(CreateTaskInput{Title: "T", Tags: []string{"#invalid"}}); err == nil {
		t.Fatalf("expected error for tag containing '#'")
	}

	// 5. Non-existent task in GetTask / SetTaskStatus / UpdateTask / DeleteTask
	if _, err := s.GetTask("t-none"); err == nil {
		t.Fatalf("expected error for non-existent GetTask")
	}
	if _, err := s.SetTaskStatus("t-none", markdown.TaskStatusDone); err == nil {
		t.Fatalf("expected error for non-existent SetTaskStatus")
	}
	if _, err := s.UpdateTask(UpdateTaskInput{ID: "t-none", Title: "T"}); err == nil {
		t.Fatalf("expected error for non-existent UpdateTask")
	}
	if err := s.DeleteTask("t-none"); err == nil {
		t.Fatalf("expected error for non-existent DeleteTask")
	}

	// 6. Invalid status in SetTaskStatus
	validTask, err := s.CreateTask(CreateTaskInput{Title: "Valid"})
	if err != nil {
		t.Fatalf("CreateTask failed: %v", err)
	}
	if _, err := s.SetTaskStatus(validTask.ID, "unknown_status"); err == nil {
		t.Fatalf("expected error for invalid status")
	}
}

func TestVaultService_EventForwarding(t *testing.T) {
	vaultDir := t.TempDir()
	eventsReceived := make(chan VaultChangeEvent, 10)
	var eventNameReceived string

	s := &VaultService{
		emitEvent: func(name string, data any) {
			eventNameReceived = name
			if payload, ok := data.(VaultChangeEvent); ok {
				eventsReceived <- payload
			}
		},
	}

	tasksDir := filepath.Join(vaultDir, "tasks")
	if err := os.MkdirAll(tasksDir, 0755); err != nil {
		t.Fatalf("MkdirAll failed: %v", err)
	}

	if _, err := s.openVault(vaultDir); err != nil {
		t.Fatalf("openVault failed: %v", err)
	}
	defer func() {
		if s.stopWatcher != nil {
			s.stopWatcher()
		}
	}()

	// 1. Create a task via external file write (simulating external editor)
	extFile := filepath.Join(tasksDir, "external_task_t-ext-ev1.md")
	content := `---
type: task
id: t-ext-ev1
title: 外部创建任务
status: todo
priority: p2
created_at: 2026-10-11T12:00:00+08:00
updated_at: 2026-10-11T12:00:00+08:00
---

外部正文内容。
`
	if err := os.WriteFile(extFile, []byte(content), 0644); err != nil {
		t.Fatalf("WriteFile failed: %v", err)
	}

	// 2. Poll assert for EventVaultChanged event
	select {
	case ev := <-eventsReceived:
		if eventNameReceived != EventVaultChanged {
			t.Fatalf("expected event name %s, got %s", EventVaultChanged, eventNameReceived)
		}
		if ev.EntityID != "t-ext-ev1" {
			t.Fatalf("expected EntityID t-ext-ev1, got %s", ev.EntityID)
		}
		if ev.Type != "task" {
			t.Fatalf("expected Type task, got %s", ev.Type)
		}
		if ev.Op != "create" && ev.Op != "update" {
			t.Fatalf("unexpected Op %s", ev.Op)
		}
		if ev.Path != extFile {
			t.Fatalf("expected Path %s, got %s", extFile, ev.Path)
		}
	case <-time.After(3 * time.Second):
		t.Fatalf("timed out waiting for forwarded vault event")
	}
}

func TestVaultService_EventForwarding_StopLifecycle(t *testing.T) {
	vaultDir := t.TempDir()
	eventsReceived := make(chan VaultChangeEvent, 10)

	s := &VaultService{
		emitEvent: func(name string, data any) {
			if payload, ok := data.(VaultChangeEvent); ok {
				eventsReceived <- payload
			}
		},
	}

	if _, err := s.openVault(vaultDir); err != nil {
		t.Fatalf("openVault failed: %v", err)
	}

	// Stop watcher
	if s.stopWatcher != nil {
		s.stopWatcher()
	}

	// Create another file after stopWatcher
	tasksDir := filepath.Join(vaultDir, "tasks")
	_ = os.MkdirAll(tasksDir, 0755)
	extFile := filepath.Join(tasksDir, "after_stop_t-ext-ev2.md")
	content := `---
type: task
id: t-ext-ev2
title: 停止后创建
status: todo
priority: p2
created_at: 2026-10-11T12:00:00+08:00
updated_at: 2026-10-11T12:00:00+08:00
---
`
	_ = os.WriteFile(extFile, []byte(content), 0644)

	// No events should be received after stopWatcher
	select {
	case ev := <-eventsReceived:
		t.Fatalf("received unexpected event after stopWatcher: %+v", ev)
	case <-time.After(200 * time.Millisecond):
		// Expected: no event received
	}
}

func TestVaultService_MemoCRUDAndValidation(t *testing.T) {
	sClosed := &VaultService{}
	if _, err := sClosed.CreateMemo(CreateMemoInput{Body: "测试"}); err == nil {
		t.Fatalf("expected error on closed vault for CreateMemo")
	}
	if _, err := sClosed.UpdateMemo(UpdateMemoInput{ID: "m-1", Body: "测试"}); err == nil {
		t.Fatalf("expected error on closed vault for UpdateMemo")
	}
	if _, err := sClosed.GetMemo("m-1"); err == nil {
		t.Fatalf("expected error on closed vault for GetMemo")
	}
	if _, err := sClosed.ListMemosByTask("t-1"); err == nil {
		t.Fatalf("expected error on closed vault for ListMemosByTask")
	}

	vaultDir := t.TempDir()
	s := &VaultService{}
	if _, err := s.openVault(vaultDir); err != nil {
		t.Fatalf("openVault failed: %v", err)
	}
	defer func() {
		if s.stopWatcher != nil {
			s.stopWatcher()
		}
	}()

	// 1. Empty body error
	if _, err := s.CreateMemo(CreateMemoInput{Body: "   "}); err == nil {
		t.Fatalf("expected error for empty memo body")
	}

	// 2. Non-existent taskID error
	if _, err := s.CreateMemo(CreateMemoInput{Body: "关联不存在的任务", TaskID: "t-ghost-999"}); err == nil || !strings.Contains(err.Error(), "任务不存在: t-ghost-999") {
		t.Fatalf("expected '任务不存在: t-ghost-999', got: %v", err)
	}

	// 3. Standalone Memo without title/tags/task_id must succeed
	standalone, err := s.CreateMemo(CreateMemoInput{Body: "独立闪念记录"})
	if err != nil {
		t.Fatalf("CreateMemo standalone failed: %v", err)
	}
	if !strings.HasPrefix(standalone.ID, "m-") {
		t.Fatalf("expected memo ID prefix 'm-', got %s", standalone.ID)
	}
	if standalone.TaskID != "" {
		t.Fatalf("expected empty TaskID, got %s", standalone.TaskID)
	}
	if len(standalone.Tags) != 0 {
		t.Fatalf("expected empty Tags, got %v", standalone.Tags)
	}
	if standalone.CreatedAt.IsZero() {
		t.Fatalf("expected non-zero CreatedAt")
	}

	// 4. Verify disk persistence of standalone Memo in memos/YYYY/MM/
	memoPath := s.vault.ResolveEntityPath(standalone)
	expectedSubdir := filepath.Join("memos", standalone.CreatedAt.Format("2006"), standalone.CreatedAt.Format("01"))
	if !strings.Contains(memoPath, expectedSubdir) {
		t.Fatalf("expected path to contain %s, got %s", expectedSubdir, memoPath)
	}

	data, err := os.ReadFile(memoPath)
	if err != nil {
		t.Fatalf("failed to read memo file from disk: %v", err)
	}
	parsed, err := markdown.ParseMarkdown(memoPath, data)
	if err != nil {
		t.Fatalf("ParseMarkdown failed: %v", err)
	}
	parsedMemo, ok := parsed.(*markdown.Memo)
	if !ok {
		t.Fatalf("parsed entity is not Memo: %T", parsed)
	}
	if strings.TrimSpace(parsedMemo.Body) != "独立闪念记录" {
		t.Fatalf("parsed body mismatch: %s", parsedMemo.Body)
	}

	// 5. Read back via GetMemo
	fetched, err := s.GetMemo(standalone.ID)
	if err != nil || fetched.ID != standalone.ID || fetched.Body != standalone.Body {
		t.Fatalf("GetMemo failed: %v, fetched=%+v", err, fetched)
	}

	// 6. Associate Memo with an existing Task
	task, err := s.CreateTask(CreateTaskInput{Title: "宿主任务"})
	if err != nil {
		t.Fatalf("CreateTask failed: %v", err)
	}

	taskMemo, err := s.CreateMemo(CreateMemoInput{
		Body:   "任务评论第1条",
		TaskID: task.ID,
		Tags:   []string{"#反馈", "开发"},
	})
	if err != nil {
		t.Fatalf("CreateMemo with TaskID failed: %v", err)
	}
	if taskMemo.TaskID != task.ID {
		t.Fatalf("expected TaskID=%s, got %s", task.ID, taskMemo.TaskID)
	}
	if len(taskMemo.Tags) != 2 || taskMemo.Tags[0] != "反馈" || taskMemo.Tags[1] != "开发" {
		t.Fatalf("tags not cleaned properly: %v", taskMemo.Tags)
	}

	memosForTask, err := s.ListMemosByTask(task.ID)
	if err != nil || len(memosForTask) != 1 || memosForTask[0].ID != taskMemo.ID {
		t.Fatalf("ListMemosByTask failed: %v, got %+v", err, memosForTask)
	}
}

func TestVaultService_UpdateMemo_PreserveCreatedAtAndBaselineConflict(t *testing.T) {
	vaultDir := t.TempDir()
	s := &VaultService{}
	if _, err := s.openVault(vaultDir); err != nil {
		t.Fatalf("openVault failed: %v", err)
	}
	defer func() {
		if s.stopWatcher != nil {
			s.stopWatcher()
		}
	}()

	created, err := s.CreateMemo(CreateMemoInput{
		Body: "原始评论正文",
		Tags: []string{"v1"},
	})
	if err != nil {
		t.Fatalf("CreateMemo failed: %v", err)
	}
	origCreatedAt := created.CreatedAt

	// Update Memo
	updated, err := s.UpdateMemo(UpdateMemoInput{
		ID:   created.ID,
		Body: "修改后的评论正文",
		Tags: []string{"v2", "已修复"},
	})
	if err != nil {
		t.Fatalf("UpdateMemo failed: %v", err)
	}

	// Invariant: CreatedAt must NOT be modified
	if !updated.CreatedAt.Equal(origCreatedAt) {
		t.Fatalf("UpdateMemo modified created_at: orig=%s, new=%s", origCreatedAt, updated.CreatedAt)
	}
	if updated.Body != "修改后的评论正文" {
		t.Fatalf("body not updated: %s", updated.Body)
	}
	if len(updated.Tags) != 2 || updated.Tags[0] != "v2" {
		t.Fatalf("tags not updated: %v", updated.Tags)
	}

	// Verify persistence
	memoPath := s.vault.ResolveEntityPath(updated)
	diskData, err := os.ReadFile(memoPath)
	if err != nil {
		t.Fatalf("read disk memo failed: %v", err)
	}
	if !strings.Contains(string(diskData), "修改后的评论正文") {
		t.Fatalf("disk file does not contain updated body: %s", string(diskData))
	}

	// External collision test: tamper with disk file
	tamperedContent := strings.Replace(string(diskData), "修改后的评论正文", "外部冲突编辑", 1)
	if err := os.WriteFile(memoPath, []byte(tamperedContent), 0644); err != nil {
		t.Fatalf("write tampered file failed: %v", err)
	}

	// Attempt UpdateMemo without rescan -> baseline conflict must be rejected
	_, err = s.UpdateMemo(UpdateMemoInput{
		ID:   created.ID,
		Body: "再次尝试编辑将发生冲突",
	})
	if err == nil || !strings.Contains(err.Error(), "conflict") {
		t.Fatalf("expected conflict error on external edit, got: %v", err)
	}
}

func TestVaultService_ListMemosByTask_Ordering(t *testing.T) {
	vaultDir := t.TempDir()
	s := &VaultService{}
	if _, err := s.openVault(vaultDir); err != nil {
		t.Fatalf("openVault failed: %v", err)
	}
	defer func() {
		if s.stopWatcher != nil {
			s.stopWatcher()
		}
	}()

	task, err := s.CreateTask(CreateTaskInput{Title: "排序测试任务"})
	if err != nil {
		t.Fatalf("CreateTask failed: %v", err)
	}

	m1, err := s.CreateMemo(CreateMemoInput{Body: "第1条", TaskID: task.ID})
	if err != nil {
		t.Fatalf("CreateMemo m1 failed: %v", err)
	}
	time.Sleep(20 * time.Millisecond)

	m2, err := s.CreateMemo(CreateMemoInput{Body: "第2条", TaskID: task.ID})
	if err != nil {
		t.Fatalf("CreateMemo m2 failed: %v", err)
	}
	time.Sleep(20 * time.Millisecond)

	m3, err := s.CreateMemo(CreateMemoInput{Body: "第3条", TaskID: task.ID})
	if err != nil {
		t.Fatalf("CreateMemo m3 failed: %v", err)
	}

	list, err := s.ListMemosByTask(task.ID)
	if err != nil {
		t.Fatalf("ListMemosByTask failed: %v", err)
	}
	if len(list) != 3 {
		t.Fatalf("expected 3 memos, got %d", len(list))
	}
	if list[0].ID != m1.ID || list[1].ID != m2.ID || list[2].ID != m3.ID {
		t.Fatalf("expected order [m1, m2, m3], got [%s, %s, %s]", list[0].ID, list[1].ID, list[2].ID)
	}
}

func TestVaultService_UpdateMemo_UnknownFieldsPreserved(t *testing.T) {
	vaultDir := t.TempDir()
	memoDir := filepath.Join(vaultDir, "memos", "2026", "10")
	if err := os.MkdirAll(memoDir, 0755); err != nil {
		t.Fatalf("MkdirAll failed: %v", err)
	}

	rawFile := filepath.Join(memoDir, "custom_memo_m-ext-01.md")
	rawContent := `---
type: memo
id: m-ext-01
created_at: 2026-10-11T10:00:00+08:00
custom_agent_id: agent-xyz
extra_meta:
  source: webhook
  verified: true
---

初始 Memo 正文。
`
	if err := os.WriteFile(rawFile, []byte(rawContent), 0644); err != nil {
		t.Fatalf("WriteFile failed: %v", err)
	}

	s := &VaultService{}
	if _, err := s.openVault(vaultDir); err != nil {
		t.Fatalf("openVault failed: %v", err)
	}
	defer func() {
		if s.stopWatcher != nil {
			s.stopWatcher()
		}
	}()

	memo, err := s.GetMemo("m-ext-01")
	if err != nil {
		t.Fatalf("GetMemo failed: %v", err)
	}

	// Update memo through service
	updated, err := s.UpdateMemo(UpdateMemoInput{
		ID:   memo.ID,
		Body: "经 UpdateMemo 更新后的正文内容。",
		Tags: []string{"重要"},
	})
	if err != nil {
		t.Fatalf("UpdateMemo failed: %v", err)
	}
	if updated.Body != "经 UpdateMemo 更新后的正文内容。" {
		t.Fatalf("body not updated: %s", updated.Body)
	}

	// Read back markdown file directly from disk
	diskBytes, err := os.ReadFile(rawFile)
	if err != nil {
		t.Fatalf("ReadFile failed: %v", err)
	}
	diskStr := string(diskBytes)

	// Check that unknown YAML fields are preserved!
	if !strings.Contains(diskStr, "custom_agent_id: agent-xyz") {
		t.Fatalf("unknown field custom_agent_id lost! Disk content:\n%s", diskStr)
	}
	if !strings.Contains(diskStr, "extra_meta:") || !strings.Contains(diskStr, "source: webhook") {
		t.Fatalf("unknown nested field extra_meta lost! Disk content:\n%s", diskStr)
	}
	if !strings.Contains(diskStr, "经 UpdateMemo 更新后的正文内容。") {
		t.Fatalf("updated body not in disk file! Disk content:\n%s", diskStr)
	}
}

func TestVaultService_DayPlanCRUDAndValidation(t *testing.T) {
	sClosed := &VaultService{}
	if _, err := sClosed.GetDayPlan("2026-10-11"); err == nil {
		t.Fatalf("expected error on closed vault for GetDayPlan")
	}
	if _, err := sClosed.SaveDayPlan("2026-10-11", []string{}); err == nil {
		t.Fatalf("expected error on closed vault for SaveDayPlan")
	}

	vaultDir := t.TempDir()
	s := &VaultService{}
	if _, err := s.openVault(vaultDir); err != nil {
		t.Fatalf("openVault failed: %v", err)
	}
	defer func() {
		if s.stopWatcher != nil {
			s.stopWatcher()
		}
	}()

	// 1. Invalid date format error
	if _, err := s.GetDayPlan("invalid-date"); err == nil {
		t.Fatalf("expected error for invalid date in GetDayPlan")
	}
	if _, err := s.SaveDayPlan("2026/10/11", []string{}); err == nil {
		t.Fatalf("expected error for invalid date in SaveDayPlan")
	}

	// 2. Non-existent day plan returns empty DayPlan without error
	emptyPlan, err := s.GetDayPlan("2026-10-11")
	if err != nil {
		t.Fatalf("GetDayPlan on non-existent date failed: %v", err)
	}
	if emptyPlan.Date != "2026-10-11" || len(emptyPlan.TaskIDs) != 0 {
		t.Fatalf("expected empty plan, got: %+v", emptyPlan)
	}

	// 3. SaveDayPlan with non-existent task_id returns error
	if _, err := s.SaveDayPlan("2026-10-11", []string{"t-ghost-999"}); err == nil || !strings.Contains(err.Error(), "任务不存在: t-ghost-999") {
		t.Fatalf("expected '任务不存在: t-ghost-999', got: %v", err)
	}

	// 4. SaveDayPlan with empty task_ids succeeds (saving empty plan)
	savedEmpty, err := s.SaveDayPlan("2026-10-11", []string{})
	if err != nil {
		t.Fatalf("SaveDayPlan empty failed: %v", err)
	}
	if savedEmpty.Date != "2026-10-11" || len(savedEmpty.TaskIDs) != 0 {
		t.Fatalf("expected empty task IDs, got: %+v", savedEmpty)
	}

	// 5. Create tasks and save day plan (ordered)
	dueStr := "2026-10-25"
	task1, err := s.CreateTask(CreateTaskInput{Title: "任务1", Due: &dueStr})
	if err != nil {
		t.Fatalf("CreateTask 1 failed: %v", err)
	}
	task2, err := s.CreateTask(CreateTaskInput{Title: "任务2"})
	if err != nil {
		t.Fatalf("CreateTask 2 failed: %v", err)
	}

	// New plan with [task1, task2]
	saved, err := s.SaveDayPlan("2026-10-11", []string{task1.ID, task2.ID})
	if err != nil {
		t.Fatalf("SaveDayPlan failed: %v", err)
	}
	if len(saved.TaskIDs) != 2 || saved.TaskIDs[0] != task1.ID || saved.TaskIDs[1] != task2.ID {
		t.Fatalf("expected task IDs [%s, %s], got %v", task1.ID, task2.ID, saved.TaskIDs)
	}

	// Read back via GetDayPlan
	fetched, err := s.GetDayPlan("2026-10-11")
	if err != nil || len(fetched.TaskIDs) != 2 || fetched.TaskIDs[0] != task1.ID {
		t.Fatalf("GetDayPlan failed: %v, fetched: %+v", err, fetched)
	}

	// Update order to [task2, task1]
	reordered, err := s.SaveDayPlan("2026-10-11", []string{task2.ID, task1.ID})
	if err != nil {
		t.Fatalf("SaveDayPlan reorder failed: %v", err)
	}
	if len(reordered.TaskIDs) != 2 || reordered.TaskIDs[0] != task2.ID || reordered.TaskIDs[1] != task1.ID {
		t.Fatalf("reordered mismatch: %v", reordered.TaskIDs)
	}

	// 6. External collision test (conflict rejection)
	planPath := s.vault.ResolveEntityPath(reordered)
	diskBytes, err := os.ReadFile(planPath)
	if err != nil {
		t.Fatalf("read plan file failed: %v", err)
	}
	// Tamper file externally
	tampered := strings.Replace(string(diskBytes), task2.ID, task1.ID, 1)
	if err := os.WriteFile(planPath, []byte(tampered), 0644); err != nil {
		t.Fatalf("write tampered plan file failed: %v", err)
	}
	// Attempt save without rescan -> should detect baseline conflict
	_, err = s.SaveDayPlan("2026-10-11", []string{task1.ID})
	if err == nil || !strings.Contains(err.Error(), "conflict") {
		t.Fatalf("expected conflict error on external edit, got: %v", err)
	}

	// 7. Duplicate task ID in SaveDayPlan is rejected by schema validation
	_ = s.RescanVault()
	_, err = s.SaveDayPlan("2026-10-11", []string{task1.ID, task1.ID})
	if err == nil || !strings.Contains(err.Error(), "duplicate task id") {
		t.Fatalf("expected duplicate task id error from schema, got: %v", err)
	}
}

func TestVaultService_DayPlan_SameTaskMultiDayDueUnchanged(t *testing.T) {
	vaultDir := t.TempDir()
	s := &VaultService{}
	if _, err := s.openVault(vaultDir); err != nil {
		t.Fatalf("openVault failed: %v", err)
	}
	defer func() {
		if s.stopWatcher != nil {
			s.stopWatcher()
		}
	}()

	dueStr := "2026-10-30"
	task, err := s.CreateTask(CreateTaskInput{
		Title: "跨日安排任务",
		Due:   &dueStr,
	})
	if err != nil {
		t.Fatalf("CreateTask failed: %v", err)
	}

	// Arrange the same task in two different DayPlans
	plan1, err := s.SaveDayPlan("2026-10-11", []string{task.ID})
	if err != nil {
		t.Fatalf("SaveDayPlan day 1 failed: %v", err)
	}
	plan2, err := s.SaveDayPlan("2026-10-12", []string{task.ID})
	if err != nil {
		t.Fatalf("SaveDayPlan day 2 failed: %v", err)
	}

	if len(plan1.TaskIDs) != 1 || plan1.TaskIDs[0] != task.ID {
		t.Fatalf("plan1 does not contain task: %+v", plan1)
	}
	if len(plan2.TaskIDs) != 1 || plan2.TaskIDs[0] != task.ID {
		t.Fatalf("plan2 does not contain task: %+v", plan2)
	}

	// Assert: Task.due is UNCHANGED across multiple daily arrangements!
	taskFetched, err := s.GetTask(task.ID)
	if err != nil {
		t.Fatalf("GetTask failed: %v", err)
	}
	if taskFetched.Due == nil || *taskFetched.Due != "2026-10-30" {
		t.Fatalf("Task.Due was modified! Expected 2026-10-30, got %v", taskFetched.Due)
	}
}

func TestVaultService_GetDayTimeline_ValidationAndClosedVault(t *testing.T) {
	sClosed := &VaultService{}
	if _, err := sClosed.GetDayTimeline("2026-10-11"); err == nil {
		t.Fatalf("expected error on closed vault for GetDayTimeline")
	}

	vaultDir := t.TempDir()
	s := &VaultService{}
	if _, err := s.openVault(vaultDir); err != nil {
		t.Fatalf("openVault failed: %v", err)
	}
	defer func() {
		if s.stopWatcher != nil {
			s.stopWatcher()
		}
	}()

	if _, err := s.GetDayTimeline("invalid-date"); err == nil {
		t.Fatalf("expected error on invalid date for GetDayTimeline")
	}

	// Empty timeline for non-existent date
	items, err := s.GetDayTimeline("2026-10-11")
	if err != nil {
		t.Fatalf("GetDayTimeline failed: %v", err)
	}
	if len(items) != 0 {
		t.Fatalf("expected empty items, got %d", len(items))
	}
}

func TestVaultService_DayTimeline_IndependenceAndAcceptanceCriteria(t *testing.T) {
	vaultDir := t.TempDir()
	s := &VaultService{}
	if _, err := s.openVault(vaultDir); err != nil {
		t.Fatalf("openVault failed: %v", err)
	}
	defer func() {
		if s.stopWatcher != nil {
			s.stopWatcher()
		}
	}()

	todayStr := time.Now().In(time.Local).Format("2006-01-02")

	// 1. 带 task_id 的 Memo 在 ListMemosByTask 与 GetDayTimeline 返回同一 ID (同一源文件)
	due := "2026-10-31"
	task, err := s.CreateTask(CreateTaskInput{
		Title: "待关联任务",
		Due:   &due,
	})
	if err != nil {
		t.Fatalf("CreateTask failed: %v", err)
	}

	memoAssoc, err := s.CreateMemo(CreateMemoInput{
		Body:   "这是关联评论",
		TaskID: task.ID,
		Tags:   []string{"tag1"},
	})
	if err != nil {
		t.Fatalf("CreateMemo assoc failed: %v", err)
	}

	// Check ListMemosByTask
	taskMemos := s.vault.Index.ListMemosByTask(task.ID)
	if len(taskMemos) != 1 || taskMemos[0].ID != memoAssoc.ID {
		t.Fatalf("ListMemosByTask mismatch: expected ID %s, got %+v", memoAssoc.ID, taskMemos)
	}

	// Check GetDayTimeline
	timelineToday, err := s.GetDayTimeline(todayStr)
	if err != nil {
		t.Fatalf("GetDayTimeline failed: %v", err)
	}
	var foundAssoc *TimelineItem
	for i := range timelineToday {
		if timelineToday[i].Kind == "memo" && timelineToday[i].Memo != nil && timelineToday[i].Memo.ID == memoAssoc.ID {
			foundAssoc = &timelineToday[i]
			break
		}
	}
	if foundAssoc == nil {
		t.Fatalf("associated memo not found in today's timeline")
	}
	if foundAssoc.TaskID != task.ID || foundAssoc.TaskTitle != task.Title {
		t.Fatalf("associated memo TaskID/TaskTitle mismatch: %+v", foundAssoc)
	}
	if foundAssoc.Memo.ID != taskMemos[0].ID {
		t.Fatalf("memo ID mismatch between Task details and Timeline: %s vs %s", foundAssoc.Memo.ID, taskMemos[0].ID)
	}

	// 2. 无标题/标签/任务的独立 Memo 可保存且出现在当日时间线
	memoIndep, err := s.CreateMemo(CreateMemoInput{
		Body: "纯独立便签正文，无标题无标签无任务",
	})
	if err != nil {
		t.Fatalf("CreateMemo independent failed: %v", err)
	}
	if memoIndep.TaskID != "" || len(memoIndep.Tags) != 0 {
		t.Fatalf("unexpected fields in independent memo: %+v", memoIndep)
	}

	timelineToday2, err := s.GetDayTimeline(todayStr)
	if err != nil {
		t.Fatalf("GetDayTimeline failed: %v", err)
	}
	var foundIndep *TimelineItem
	for i := range timelineToday2 {
		if timelineToday2[i].Kind == "memo" && timelineToday2[i].Memo != nil && timelineToday2[i].Memo.ID == memoIndep.ID {
			foundIndep = &timelineToday2[i]
			break
		}
	}
	if foundIndep == nil {
		t.Fatalf("independent memo not found in today's timeline")
	}
	if foundIndep.TaskID != "" || foundIndep.TaskTitle != "" {
		t.Fatalf("independent memo should have empty task fields, got: %+v", foundIndep)
	}

	// 3. 任务完成(无 Memo)当日时间线出现 completion 项
	// 完成 -> 重开 -> 再完成，两个完成日各有事件
	date1 := "2026-10-15"
	date2 := "2026-10-16"
	t1, err := time.ParseInLocation("2006-01-02 15:04:05", "2026-10-15 10:00:00", time.Local)
	if err != nil {
		t.Fatalf("parse time 1 failed: %v", err)
	}
	tReopen, err := time.ParseInLocation("2006-01-02 15:04:05", "2026-10-15 16:00:00", time.Local)
	if err != nil {
		t.Fatalf("parse time reopen failed: %v", err)
	}
	t2, err := time.ParseInLocation("2006-01-02 15:04:05", "2026-10-16 11:30:00", time.Local)
	if err != nil {
		t.Fatalf("parse time 2 failed: %v", err)
	}

	multiCompTask, err := s.CreateTask(CreateTaskInput{
		Title: "多次完成任务",
	})
	if err != nil {
		t.Fatalf("CreateTask multiComp failed: %v", err)
	}

	// Directly set status events to simulate completed -> reopened -> completed across 2 days
	multiCompTask.StatusEvents = []markdown.StatusEvent{
		{Action: markdown.StatusEventActionCompleted, At: t1},
		{Action: markdown.StatusEventActionReopened, At: tReopen},
		{Action: markdown.StatusEventActionCompleted, At: t2},
	}
	multiCompTask.Status = markdown.TaskStatusDone
	multiPath := s.vault.ResolveEntityPath(multiCompTask)
	var multiBaseline *markdown.FileBaseline
	if b, ok := s.vault.Index.GetBaseline(multiPath); ok {
		multiBaseline = &b
	}
	if _, err := s.vault.SaveEntity(multiCompTask, multiBaseline); err != nil {
		t.Fatalf("SaveEntity multiCompTask failed: %v", err)
	}

	// Check date1 timeline
	tlDate1, err := s.GetDayTimeline(date1)
	if err != nil {
		t.Fatalf("GetDayTimeline date1 failed: %v", err)
	}
	var foundComp1 bool
	for _, item := range tlDate1 {
		if item.Kind == "completion" && item.TaskID == multiCompTask.ID {
			foundComp1 = true
			if !item.Time.Equal(t1) {
				t.Fatalf("expected completion time %v, got %v", t1, item.Time)
			}
		}
	}
	if !foundComp1 {
		t.Fatalf("expected completion event on date1 timeline")
	}

	// Check date2 timeline
	tlDate2, err := s.GetDayTimeline(date2)
	if err != nil {
		t.Fatalf("GetDayTimeline date2 failed: %v", err)
	}
	var foundComp2 bool
	for _, item := range tlDate2 {
		if item.Kind == "completion" && item.TaskID == multiCompTask.ID {
			foundComp2 = true
			if !item.Time.Equal(t2) {
				t.Fatalf("expected completion time %v, got %v", t2, item.Time)
			}
		}
	}
	if !foundComp2 {
		t.Fatalf("expected completion event on date2 timeline")
	}

	// 4. 完成任务不改变 DayPlan 成员与 due (三者独立)
	dueBefore := "2026-10-28"
	indepTask, err := s.CreateTask(CreateTaskInput{
		Title: "三者独立性测试任务",
		Due:   &dueBefore,
	})
	if err != nil {
		t.Fatalf("CreateTask indepTask failed: %v", err)
	}
	planDate := "2026-10-20"
	plan, err := s.SaveDayPlan(planDate, []string{indepTask.ID})
	if err != nil {
		t.Fatalf("SaveDayPlan failed: %v", err)
	}
	if len(plan.TaskIDs) != 1 || plan.TaskIDs[0] != indepTask.ID {
		t.Fatalf("plan does not contain task: %+v", plan)
	}

	// Mark task completed
	_, err = s.SetTaskStatus(indepTask.ID, markdown.TaskStatusDone)
	if err != nil {
		t.Fatalf("SetTaskStatus done failed: %v", err)
	}

	// Check DayPlan: still contains indepTask.ID
	planAfter, err := s.GetDayPlan(planDate)
	if err != nil {
		t.Fatalf("GetDayPlan after completion failed: %v", err)
	}
	if len(planAfter.TaskIDs) != 1 || planAfter.TaskIDs[0] != indepTask.ID {
		t.Fatalf("DayPlan was altered by task completion! Got: %+v", planAfter)
	}

	// Check Task: Due is STILL 2026-10-28!
	taskAfter, err := s.GetTask(indepTask.ID)
	if err != nil {
		t.Fatalf("GetTask after completion failed: %v", err)
	}
	if taskAfter.Due == nil || *taskAfter.Due != "2026-10-28" {
		t.Fatalf("Task.Due was altered by task completion! Got: %v", taskAfter.Due)
	}

	// Check Completion fact in today's timeline
	tlTodayAfter, err := s.GetDayTimeline(todayStr)
	if err != nil {
		t.Fatalf("GetDayTimeline today failed: %v", err)
	}
	var foundIndepComp bool
	for _, it := range tlTodayAfter {
		if it.Kind == "completion" && it.TaskID == indepTask.ID {
			foundIndepComp = true
			break
		}
	}
	if !foundIndepComp {
		t.Fatalf("completed indepTask missing from today's timeline")
	}
}

func TestVaultService_GetDayTimeline_TimezoneBucketing(t *testing.T) {
	vaultDir := t.TempDir()
	s := &VaultService{}
	if _, err := s.openVault(vaultDir); err != nil {
		t.Fatalf("openVault failed: %v", err)
	}
	defer func() {
		if s.stopWatcher != nil {
			s.stopWatcher()
		}
	}()

	// Construct timestamps in local timezone:
	// Day 1 at 23:30 vs Day 2 at 00:10
	day1Str := "2026-10-22"
	day2Str := "2026-10-23"

	t1, err := time.ParseInLocation("2006-01-02 15:04:05", "2026-10-22 23:30:00", time.Local)
	if err != nil {
		t.Fatalf("parse t1 failed: %v", err)
	}
	t2, err := time.ParseInLocation("2006-01-02 15:04:05", "2026-10-23 00:10:00", time.Local)
	if err != nil {
		t.Fatalf("parse t2 failed: %v", err)
	}

	memo1 := &markdown.Memo{
		Type:      markdown.EntityTypeMemo,
		ID:        "m-bucket-day1",
		CreatedAt: t1,
		Body:      "第 1 天深夜 23:30 便签",
	}
	if _, err := s.vault.SaveEntity(memo1, nil); err != nil {
		t.Fatalf("SaveEntity memo1 failed: %v", err)
	}

	memo2 := &markdown.Memo{
		Type:      markdown.EntityTypeMemo,
		ID:        "m-bucket-day2",
		CreatedAt: t2,
		Body:      "第 2 天凌晨 00:10 便签",
	}
	if _, err := s.vault.SaveEntity(memo2, nil); err != nil {
		t.Fatalf("SaveEntity memo2 failed: %v", err)
	}

	// Query day 1
	tl1, err := s.GetDayTimeline(day1Str)
	if err != nil {
		t.Fatalf("GetDayTimeline day1 failed: %v", err)
	}
	if len(tl1) != 1 || tl1[0].Memo == nil || tl1[0].Memo.ID != "m-bucket-day1" {
		t.Fatalf("Day 1 timeline mismatch: expected [m-bucket-day1], got %+v", tl1)
	}

	// Query day 2
	tl2, err := s.GetDayTimeline(day2Str)
	if err != nil {
		t.Fatalf("GetDayTimeline day2 failed: %v", err)
	}
	if len(tl2) != 1 || tl2[0].Memo == nil || tl2[0].Memo.ID != "m-bucket-day2" {
		t.Fatalf("Day 2 timeline mismatch: expected [m-bucket-day2], got %+v", tl2)
	}
}

func TestVaultService_NoteCRUDAndValidation(t *testing.T) {
	sClosed := &VaultService{}
	if _, err := sClosed.ListNotes(); err == nil {
		t.Fatalf("expected error on closed vault for ListNotes")
	}
	if _, err := sClosed.GetNote("n-1"); err == nil {
		t.Fatalf("expected error on closed vault for GetNote")
	}
	if _, err := sClosed.CreateNote(CreateNoteInput{Title: "标题"}); err == nil {
		t.Fatalf("expected error on closed vault for CreateNote")
	}
	if _, err := sClosed.UpdateNote(UpdateNoteInput{ID: "n-1", Title: "标题"}); err == nil {
		t.Fatalf("expected error on closed vault for UpdateNote")
	}

	vaultDir := t.TempDir()
	s := &VaultService{}
	if _, err := s.openVault(vaultDir); err != nil {
		t.Fatalf("openVault failed: %v", err)
	}
	defer func() {
		if s.stopWatcher != nil {
			s.stopWatcher()
		}
	}()

	// 1. Validation: empty title
	if _, err := s.CreateNote(CreateNoteInput{Title: "   "}); err == nil {
		t.Fatalf("expected error for empty title on CreateNote")
	}
	if _, err := s.UpdateNote(UpdateNoteInput{ID: "n-1", Title: "   "}); err == nil {
		t.Fatalf("expected error for empty title on UpdateNote")
	}

	// 2. Validation: empty ID
	if _, err := s.GetNote("   "); err == nil {
		t.Fatalf("expected error for empty ID on GetNote")
	}
	if _, err := s.UpdateNote(UpdateNoteInput{ID: "   ", Title: "新标题"}); err == nil {
		t.Fatalf("expected error for empty ID on UpdateNote")
	}

	// 3. Non-existent note
	if _, err := s.GetNote("n-ghost-999"); err == nil || !strings.Contains(err.Error(), "笔记不存在: n-ghost-999") {
		t.Fatalf("expected '笔记不存在: n-ghost-999', got: %v", err)
	}
	if _, err := s.UpdateNote(UpdateNoteInput{ID: "n-ghost-999", Title: "新标题"}); err == nil || !strings.Contains(err.Error(), "笔记不存在: n-ghost-999") {
		t.Fatalf("expected '笔记不存在: n-ghost-999', got: %v", err)
	}

	// 4. Create Note with empty body and optional tags (with '#' prefix to be stripped)
	created, err := s.CreateNote(CreateNoteInput{
		Title: "  架构设计决策记录  ",
		Tags:  []string{"#架构", "ADR"},
		Body:  "",
	})
	if err != nil {
		t.Fatalf("CreateNote failed: %v", err)
	}
	if !strings.HasPrefix(created.ID, "n-") {
		t.Fatalf("expected note ID prefix 'n-', got %s", created.ID)
	}
	if created.Title != "架构设计决策记录" {
		t.Fatalf("title not trimmed properly: %q", created.Title)
	}
	if len(created.Tags) != 2 || created.Tags[0] != "架构" || created.Tags[1] != "ADR" {
		t.Fatalf("tags not cleaned properly: %v", created.Tags)
	}
	if created.Body != "" {
		t.Fatalf("expected empty body, got: %q", created.Body)
	}
	if created.CreatedAt.IsZero() || created.UpdatedAt.IsZero() {
		t.Fatalf("timestamps not initialized: created=%v, updated=%v", created.CreatedAt, created.UpdatedAt)
	}

	// 5. Verify file on disk in notes/ directory
	notePath := s.vault.ResolveEntityPath(created)
	if !strings.Contains(notePath, filepath.Join(vaultDir, "notes")) {
		t.Fatalf("expected note path to be under notes/, got: %s", notePath)
	}
	diskData, err := os.ReadFile(notePath)
	if err != nil {
		t.Fatalf("read created note file failed: %v", err)
	}
	parsed, err := markdown.ParseMarkdown(notePath, diskData)
	if err != nil {
		t.Fatalf("ParseMarkdown on created note failed: %v", err)
	}
	parsedNote, ok := parsed.(*markdown.Note)
	if !ok {
		t.Fatalf("parsed entity is not *markdown.Note: %T", parsed)
	}
	if parsedNote.Title != "架构设计决策记录" || len(parsedNote.Tags) != 2 {
		t.Fatalf("parsed note mismatch: %+v", parsedNote)
	}

	// 6. Rescan and read back via GetNote and ListNotes
	if err := s.RescanVault(); err != nil {
		t.Fatalf("RescanVault failed: %v", err)
	}
	fetched, err := s.GetNote(created.ID)
	if err != nil || fetched.ID != created.ID || fetched.Title != created.Title {
		t.Fatalf("GetNote failed: %v, fetched=%+v", err, fetched)
	}
	list, err := s.ListNotes()
	if err != nil || len(list) != 1 || list[0].ID != created.ID {
		t.Fatalf("ListNotes failed: %v, list=%+v", err, list)
	}

	// 7. Restart simulation
	s2 := &VaultService{}
	if _, err := s2.openVault(vaultDir); err != nil {
		t.Fatalf("restart openVault failed: %v", err)
	}
	defer func() {
		if s2.stopWatcher != nil {
			s2.stopWatcher()
		}
	}()
	restartedList, err := s2.ListNotes()
	if err != nil || len(restartedList) != 1 || restartedList[0].ID != created.ID {
		t.Fatalf("restarted ListNotes mismatch: %v, list=%+v", err, restartedList)
	}
}

func TestVaultService_UpdateNote_PreserveCreatedAtAndBaselineConflict(t *testing.T) {
	vaultDir := t.TempDir()
	s := &VaultService{}
	if _, err := s.openVault(vaultDir); err != nil {
		t.Fatalf("openVault failed: %v", err)
	}
	defer func() {
		if s.stopWatcher != nil {
			s.stopWatcher()
		}
	}()

	created, err := s.CreateNote(CreateNoteInput{
		Title: "原始笔记标题",
		Tags:  []string{"草稿"},
		Body:  "# 原始正文\n\n初始内容",
	})
	if err != nil {
		t.Fatalf("CreateNote failed: %v", err)
	}
	origCreatedAt := created.CreatedAt

	time.Sleep(10 * time.Millisecond)

	// 1. UpdateNote modifies title, tags, body, and UpdatedAt while keeping CreatedAt
	updated, err := s.UpdateNote(UpdateNoteInput{
		ID:    created.ID,
		Title: "修改后的笔记标题",
		Tags:  []string{"发布", "技术"},
		Body:  "# 修改后正文\n\n更新后的内容",
	})
	if err != nil {
		t.Fatalf("UpdateNote failed: %v", err)
	}
	if !updated.CreatedAt.Equal(origCreatedAt) {
		t.Fatalf("CreatedAt modified! orig=%v, updated=%v", origCreatedAt, updated.CreatedAt)
	}
	if !updated.UpdatedAt.After(origCreatedAt) {
		t.Fatalf("UpdatedAt should be after CreatedAt! created=%v, updated=%v", origCreatedAt, updated.UpdatedAt)
	}
	if updated.Title != "修改后的笔记标题" || updated.Body != "# 修改后正文\n\n更新后的内容" {
		t.Fatalf("updated note mismatch: %+v", updated)
	}

	// 2. Verify file on disk
	notePath := s.vault.ResolveEntityPath(updated)
	diskBytes, err := os.ReadFile(notePath)
	if err != nil {
		t.Fatalf("read disk file failed: %v", err)
	}
	if !strings.Contains(string(diskBytes), "修改后的笔记标题") || !strings.Contains(string(diskBytes), "更新后的内容") {
		t.Fatalf("disk content missing updated fields: %s", string(diskBytes))
	}

	// 3. Baseline conflict: external tampering without rescan
	if s.stopWatcher != nil {
		s.stopWatcher()
		s.stopWatcher = nil
	}
	tampered := strings.Replace(string(diskBytes), "修改后的笔记标题", "外部冲突标题", 1)
	if err := os.WriteFile(notePath, []byte(tampered), 0644); err != nil {
		t.Fatalf("write tampered file failed: %v", err)
	}

	_, err = s.UpdateNote(UpdateNoteInput{
		ID:    created.ID,
		Title: "再次尝试编辑应冲突",
		Body:  "正文",
	})
	if err == nil || !strings.Contains(err.Error(), "conflict") {
		t.Fatalf("expected conflict error on external edit, got: %v", err)
	}
}

func TestVaultService_ListNotes_OrderingAndCloneIsolation(t *testing.T) {
	vaultDir := t.TempDir()
	s := &VaultService{}
	if _, err := s.openVault(vaultDir); err != nil {
		t.Fatalf("openVault failed: %v", err)
	}
	defer func() {
		if s.stopWatcher != nil {
			s.stopWatcher()
		}
	}()

	n1, err := s.CreateNote(CreateNoteInput{Title: "笔记1", Body: "正文1"})
	if err != nil {
		t.Fatalf("CreateNote n1 failed: %v", err)
	}
	time.Sleep(15 * time.Millisecond)

	n2, err := s.CreateNote(CreateNoteInput{Title: "笔记2", Body: "正文2"})
	if err != nil {
		t.Fatalf("CreateNote n2 failed: %v", err)
	}
	time.Sleep(15 * time.Millisecond)

	n3, err := s.CreateNote(CreateNoteInput{Title: "笔记3", Body: "正文3"})
	if err != nil {
		t.Fatalf("CreateNote n3 failed: %v", err)
	}

	// ListNotes: newest UpdatedAt first -> [n3, n2, n1]
	list, err := s.ListNotes()
	if err != nil {
		t.Fatalf("ListNotes failed: %v", err)
	}
	if len(list) != 3 {
		t.Fatalf("expected 3 notes, got %d", len(list))
	}
	if list[0].ID != n3.ID || list[1].ID != n2.ID || list[2].ID != n1.ID {
		t.Fatalf("expected order [n3, n2, n1], got [%s, %s, %s]", list[0].ID, list[1].ID, list[2].ID)
	}

	// Update n1 -> now n1 has the newest UpdatedAt! Order should become [n1, n3, n2]
	time.Sleep(15 * time.Millisecond)
	n1Updated, err := s.UpdateNote(UpdateNoteInput{ID: n1.ID, Title: "笔记1新标题", Body: "正文1更新"})
	if err != nil {
		t.Fatalf("UpdateNote n1 failed: %v", err)
	}
	list2, err := s.ListNotes()
	if err != nil {
		t.Fatalf("ListNotes after update failed: %v", err)
	}
	if list2[0].ID != n1Updated.ID || list2[1].ID != n3.ID || list2[2].ID != n2.ID {
		t.Fatalf("expected order [n1, n3, n2], got [%s, %s, %s]", list2[0].ID, list2[1].ID, list2[2].ID)
	}

	// Clone isolation check: mutating list2 does not mutate index
	list2[0].Title = "恶意篡改标题"
	list2[0].Body = "恶意篡改正文"
	check, err := s.GetNote(n1.ID)
	if err != nil || check.Title != "笔记1新标题" || check.Body != "正文1更新" {
		t.Fatalf("index entity was mutated via returned ListNotes clone: %+v", check)
	}
}

func TestVaultService_UpdateNote_UnknownFieldsPreserved(t *testing.T) {
	vaultDir := t.TempDir()
	notesDir := filepath.Join(vaultDir, "notes")
	if err := os.MkdirAll(notesDir, 0755); err != nil {
		t.Fatalf("MkdirAll failed: %v", err)
	}

	rawFile := filepath.Join(notesDir, "custom_note_n-ext-01.md")
	rawContent := `---
type: note
id: n-ext-01
title: 未知字段测试笔记
created_at: 2026-10-11T10:00:00+08:00
updated_at: 2026-10-11T10:00:00+08:00
custom_author:
  name: Alice
  role: architect
import_source: notion
---

原始笔记正文。
`
	if err := os.WriteFile(rawFile, []byte(rawContent), 0644); err != nil {
		t.Fatalf("WriteFile failed: %v", err)
	}

	s := &VaultService{}
	if _, err := s.openVault(vaultDir); err != nil {
		t.Fatalf("openVault failed: %v", err)
	}
	defer func() {
		if s.stopWatcher != nil {
			s.stopWatcher()
		}
	}()

	note, err := s.GetNote("n-ext-01")
	if err != nil {
		t.Fatalf("GetNote failed: %v", err)
	}

	// Update note via service
	updated, err := s.UpdateNote(UpdateNoteInput{
		ID:    note.ID,
		Title: "通过服务更新后的笔记标题",
		Tags:  []string{"更新"},
		Body:  "更新后的笔记完整正文。",
	})
	if err != nil {
		t.Fatalf("UpdateNote failed: %v", err)
	}
	if updated.Title != "通过服务更新后的笔记标题" {
		t.Fatalf("title not updated: %s", updated.Title)
	}

	// Read raw file directly from disk
	diskBytes, err := os.ReadFile(rawFile)
	if err != nil {
		t.Fatalf("ReadFile failed: %v", err)
	}
	diskStr := string(diskBytes)

	// Check unknown YAML fields are preserved!
	if !strings.Contains(diskStr, "custom_author:") || !strings.Contains(diskStr, "name: Alice") || !strings.Contains(diskStr, "role: architect") {
		t.Fatalf("unknown nested field custom_author lost! Disk content:\n%s", diskStr)
	}
	if !strings.Contains(diskStr, "import_source: notion") {
		t.Fatalf("unknown field import_source lost! Disk content:\n%s", diskStr)
	}
	if !strings.Contains(diskStr, "通过服务更新后的笔记标题") || !strings.Contains(diskStr, "更新后的笔记完整正文。") {
		t.Fatalf("updated note content not found on disk: %s", diskStr)
	}
}

func TestVaultService_TaskNoteLinking_Validation(t *testing.T) {
	vaultDir := t.TempDir()
	s := &VaultService{}
	if _, err := s.openVault(vaultDir); err != nil {
		t.Fatalf("openVault failed: %v", err)
	}
	defer func() {
		if s.stopWatcher != nil {
			s.stopWatcher()
		}
	}()

	// 1. CreateTask: non-existent note_id must fail
	_, err := s.CreateTask(CreateTaskInput{
		Title:   "测试关联不存在笔记的任务",
		NoteIDs: []string{"n-not-found-999"},
	})
	if err == nil || !strings.Contains(err.Error(), "笔记不存在: n-not-found-999") {
		t.Fatalf("expected '笔记不存在: n-not-found-999', got: %v", err)
	}

	// 2. CreateTask: empty string note_id must fail
	_, err = s.CreateTask(CreateTaskInput{
		Title:   "测试空笔记ID的任务",
		NoteIDs: []string{"   "},
	})
	if err == nil || !strings.Contains(err.Error(), "笔记 ID 不能为空") {
		t.Fatalf("expected '笔记 ID 不能为空', got: %v", err)
	}

	// Create a valid task
	validTask, err := s.CreateTask(CreateTaskInput{
		Title: "有效任务",
	})
	if err != nil {
		t.Fatalf("CreateTask failed: %v", err)
	}

	// 3. UpdateTask: non-existent note_id must fail
	_, err = s.UpdateTask(UpdateTaskInput{
		ID:      validTask.ID,
		Title:   validTask.Title,
		Status:  validTask.Status,
		NoteIDs: []string{"n-missing-123"},
	})
	if err == nil || !strings.Contains(err.Error(), "笔记不存在: n-missing-123") {
		t.Fatalf("expected '笔记不存在: n-missing-123', got: %v", err)
	}

	// 4. UpdateTask: empty string note_id must fail
	_, err = s.UpdateTask(UpdateTaskInput{
		ID:      validTask.ID,
		Title:   validTask.Title,
		Status:  validTask.Status,
		NoteIDs: []string{""},
	})
	if err == nil || !strings.Contains(err.Error(), "笔记 ID 不能为空") {
		t.Fatalf("expected '笔记 ID 不能为空', got: %v", err)
	}
}

func TestVaultService_TaskNoteLinking_Lifecycle(t *testing.T) {
	vaultDir := t.TempDir()
	s := &VaultService{}
	if _, err := s.openVault(vaultDir); err != nil {
		t.Fatalf("openVault failed: %v", err)
	}
	defer func() {
		if s.stopWatcher != nil {
			s.stopWatcher()
		}
	}()

	// Create Note 1
	n1, err := s.CreateNote(CreateNoteInput{
		Title: "架构设计决策 ADR-001",
		Tags:  []string{"架构"},
		Body:  "决策内容...",
	})
	if err != nil {
		t.Fatalf("CreateNote n1 failed: %v", err)
	}

	// Create Note 2
	n2, err := s.CreateNote(CreateNoteInput{
		Title: "数据库重构备忘",
		Tags:  []string{"存储"},
		Body:  "备忘内容...",
	})
	if err != nil {
		t.Fatalf("CreateNote n2 failed: %v", err)
	}

	// Create Task linking Note 1
	task, err := s.CreateTask(CreateTaskInput{
		Title:   "实现架构改进",
		NoteIDs: []string{n1.ID},
	})
	if err != nil {
		t.Fatalf("CreateTask with NoteIDs failed: %v", err)
	}
	if len(task.NoteIDs) != 1 || task.NoteIDs[0] != n1.ID {
		t.Fatalf("unexpected NoteIDs in created task: %+v", task.NoteIDs)
	}

	// Verify GetTask returns correct NoteIDs
	gotTask, err := s.GetTask(task.ID)
	if err != nil {
		t.Fatalf("GetTask failed: %v", err)
	}
	if len(gotTask.NoteIDs) != 1 || gotTask.NoteIDs[0] != n1.ID {
		t.Fatalf("unexpected NoteIDs in GetTask: %+v", gotTask.NoteIDs)
	}

	// Update Task to link both Note 1 and Note 2
	updatedTask, err := s.UpdateTask(UpdateTaskInput{
		ID:       task.ID,
		Title:    task.Title,
		Status:   task.Status,
		Priority: task.Priority,
		NoteIDs:  []string{n1.ID, n2.ID},
	})
	if err != nil {
		t.Fatalf("UpdateTask failed: %v", err)
	}
	if len(updatedTask.NoteIDs) != 2 || updatedTask.NoteIDs[0] != n1.ID || updatedTask.NoteIDs[1] != n2.ID {
		t.Fatalf("unexpected NoteIDs after update: %+v", updatedTask.NoteIDs)
	}

	// Unlink all notes: full replacement semantics
	unlinkedTask, err := s.UpdateTask(UpdateTaskInput{
		ID:       task.ID,
		Title:    task.Title,
		Status:   task.Status,
		Priority: task.Priority,
		NoteIDs:  []string{},
	})
	if err != nil {
		t.Fatalf("UpdateTask unlinking failed: %v", err)
	}
	if len(unlinkedTask.NoteIDs) != 0 {
		t.Fatalf("expected empty NoteIDs after unlinking, got: %+v", unlinkedTask.NoteIDs)
	}

	// Verify unlinking does NOT delete the note file: Note 1 and Note 2 must remain intact
	checkN1, err := s.GetNote(n1.ID)
	if err != nil || checkN1 == nil {
		t.Fatalf("Note 1 should remain intact after unlinking, got err: %v", err)
	}
	if checkN1.Title != "架构设计决策 ADR-001" {
		t.Fatalf("Note 1 content modified unexpectedly: %s", checkN1.Title)
	}

	checkN2, err := s.GetNote(n2.ID)
	if err != nil || checkN2 == nil {
		t.Fatalf("Note 2 should remain intact after unlinking, got err: %v", err)
	}
}

func TestVaultService_TaskNoteLinking_SameTagsDoNotLink(t *testing.T) {
	vaultDir := t.TempDir()
	s := &VaultService{}
	if _, err := s.openVault(vaultDir); err != nil {
		t.Fatalf("openVault failed: %v", err)
	}
	defer func() {
		if s.stopWatcher != nil {
			s.stopWatcher()
		}
	}()

	sharedTags := []string{"pata", "frontend", "mvp"}

	// Create Note with shared tags
	note, err := s.CreateNote(CreateNoteInput{
		Title: "关于 MVP 前端设计的随笔",
		Tags:  sharedTags,
		Body:  "这是一篇笔记...",
	})
	if err != nil {
		t.Fatalf("CreateNote failed: %v", err)
	}

	// Create Task with the exact same tags, but empty NoteIDs
	task, err := s.CreateTask(CreateTaskInput{
		Title:   "完成前端组件重构",
		Tags:    sharedTags,
		NoteIDs: []string{},
	})
	if err != nil {
		t.Fatalf("CreateTask failed: %v", err)
	}

	// Assert: identical tags MUST NOT automatically produce links
	gotTask, err := s.GetTask(task.ID)
	if err != nil {
		t.Fatalf("GetTask failed: %v", err)
	}
	if len(gotTask.NoteIDs) != 0 {
		t.Fatalf("red line violation: same tags must NOT produce note_ids links! got NoteIDs: %+v", gotTask.NoteIDs)
	}

	// Assert: Note tags and metadata remain independent and unaffected
	gotNote, err := s.GetNote(note.ID)
	if err != nil {
		t.Fatalf("GetNote failed: %v", err)
	}
	if len(gotNote.Tags) != len(sharedTags) {
		t.Fatalf("note tags corrupted: %+v", gotNote.Tags)
	}
}
