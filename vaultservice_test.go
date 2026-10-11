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

	dueStr := "2026-10-15"
	input := CreateTaskInput{
		Title:    "阶段2任务落地",
		Status:   markdown.TaskStatusDoing,
		Priority: markdown.TaskPriorityP1,
		Due:      &dueStr,
		Tags:     []string{"架构设计", "GoCore"},
		NoteIDs:  []string{"n-ref-001"},
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
