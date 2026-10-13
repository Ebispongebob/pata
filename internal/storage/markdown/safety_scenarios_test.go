package markdown

import (
	"errors"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

// Scenario 1: External edit conflict
// External editor modifies the file behind user's back; SaveEntity must reject overwrite and return ErrConflict.
func TestScenario_ExternalEditConflict(t *testing.T) {
	tmpDir := t.TempDir()
	vault, err := NewVault(tmpDir)
	if err != nil {
		t.Fatalf("failed to init vault: %v", err)
	}

	task := &Task{
		Type:      EntityTypeTask,
		ID:        "t-conflict-01",
		Title:     "原始任务标题",
		Status:    TaskStatusTodo,
		CreatedAt: time.Now(),
		UpdatedAt: time.Now(),
		Body:      "用户第一版内容",
	}

	baseline, err := vault.SaveEntity(task, nil)
	if err != nil {
		t.Fatalf("initial save failed: %v", err)
	}

	taskPath := vault.ResolveEntityPath(task)

	// External agent (e.g. Pi agent) edits file directly on disk
	externalData := `---
type: task
id: t-conflict-01
title: Pi 外部修改后的任务
status: doing
priority: p1
created_at: 2026-10-11T10:00:00+08:00
updated_at: 2026-10-11T10:30:00+08:00
---

外部编辑者修改了这段内容。
`
	if err := os.WriteFile(taskPath, []byte(externalData), 0644); err != nil {
		t.Fatalf("failed to write external file: %v", err)
	}

	// User tries to save their local edits based on old baseline
	userTask := task.Clone().(*Task)
	userTask.Title = "用户想覆盖的标题"
	userTask.Body = "用户想覆盖的内容"

	_, err = vault.SaveEntity(userTask, baseline)
	if err == nil {
		t.Fatalf("expected conflict error, got nil")
	}

	if !errors.Is(err, ErrConflict) {
		t.Fatalf("expected ErrConflict, got: %v", err)
	}

	// Verify disk content was NOT overwritten
	contentOnDisk, _ := os.ReadFile(taskPath)
	if !strings.Contains(string(contentOnDisk), "外部编辑者修改了这段内容") {
		t.Fatalf("disk file was overwritten despite conflict! got: %s", string(contentOnDisk))
	}
}

// Scenario 2: Editor rename replacing write
// Many editors (e.g. Vim, VSCode) write to a temporary file and atomically rename over the target.
func TestScenario_EditorRenameReplaceWrite(t *testing.T) {
	tmpDir := t.TempDir()
	vault, err := NewVault(tmpDir)
	if err != nil {
		t.Fatalf("failed to init vault: %v", err)
	}

	if err := vault.StartWatcher(); err != nil {
		t.Fatalf("failed to start watcher: %v", err)
	}
	defer vault.StopWatcher()

	task := &Task{
		Type:      EntityTypeTask,
		ID:        "t-rename-01",
		Title:     "重命名测试任务",
		Status:    TaskStatusTodo,
		CreatedAt: time.Now(),
		UpdatedAt: time.Now(),
		Body:      "V1",
	}

	_, err = vault.SaveEntity(task, nil)
	if err != nil {
		t.Fatalf("save failed: %v", err)
	}

	taskPath := vault.ResolveEntityPath(task)

	// Editor writes to .tmp file then renames over taskPath
	editorContent := `---
type: task
id: t-rename-01
title: 重命名测试任务 - 编辑器原子保存
status: done
priority: p2
created_at: 2026-10-11T10:00:00+08:00
updated_at: 2026-10-11T10:45:00+08:00
---

由外部编辑器通过原子重命名写入。
`
	tmpSavePath := filepath.Join(filepath.Dir(taskPath), "temp_editor_save.tmp")
	if err := os.WriteFile(tmpSavePath, []byte(editorContent), 0644); err != nil {
		t.Fatalf("failed to write editor temp file: %v", err)
	}

	if err := os.Rename(tmpSavePath, taskPath); err != nil {
		t.Fatalf("failed to rename editor temp file: %v", err)
	}

	// Wait for fsnotify event to be processed
	time.Sleep(300 * time.Millisecond)

	// Check that the in-memory index was updated with new title and status
	updatedTask, ok := vault.Index.GetTask("t-rename-01")
	if !ok {
		t.Fatalf("task t-rename-01 not found in index after editor rename")
	}

	if updatedTask.Title != "重命名测试任务 - 编辑器原子保存" || updatedTask.Status != TaskStatusDone {
		t.Fatalf("index not updated correctly: %+v", updatedTask)
	}
}

// Scenario 3: Invalid YAML isolation
// External tool writes malformed YAML; app must isolate error with path & reason without corrupting/deleting original file.
func TestScenario_InvalidYAMLIsolation(t *testing.T) {
	tmpDir := t.TempDir()
	vault, err := NewVault(tmpDir)
	if err != nil {
		t.Fatalf("failed to init vault: %v", err)
	}

	// 1. Valid note
	validNote := &Note{
		Type:      EntityTypeNote,
		ID:        "n-valid-01",
		Title:     "正常笔记",
		CreatedAt: time.Now(),
		UpdatedAt: time.Now(),
		Body:      "正常内容",
	}
	_, err = vault.SaveEntity(validNote, nil)
	if err != nil {
		t.Fatalf("failed to save valid note: %v", err)
	}

	// 2. Corrupted file written directly to disk
	brokenPath := filepath.Join(tmpDir, "notes", "broken.md")
	brokenContent := `---
type: note
id: [bad yaml syntax:::
  - unclosed
title: Broken
---
正文内容
`
	if err := os.MkdirAll(filepath.Dir(brokenPath), 0755); err != nil {
		t.Fatalf("failed to create dir: %v", err)
	}
	if err := os.WriteFile(brokenPath, []byte(brokenContent), 0644); err != nil {
		t.Fatalf("failed to write broken file: %v", err)
	}

	// Rescan vault
	if err := vault.Scan(); err != nil {
		t.Fatalf("scan failed: %v", err)
	}

	// Original broken file MUST still exist untouched on disk
	diskBytes, err := os.ReadFile(brokenPath)
	if err != nil || string(diskBytes) != brokenContent {
		t.Fatalf("broken file was modified or deleted! err: %v", err)
	}

	// Valid note still indexed
	n, ok := vault.Index.GetNote("n-valid-01")
	if !ok || n.Title != "正常笔记" {
		t.Fatalf("valid note missing from index: %+v", n)
	}

	// Parse errors list contains detailed info
	errs := vault.Index.ListParseErrors()
	if len(errs) != 1 {
		t.Fatalf("expected 1 parse error, got %d: %+v", len(errs), errs)
	}

	if errs[0].Path != brokenPath {
		t.Fatalf("expected error path %s, got %s", brokenPath, errs[0].Path)
	}
	if !strings.Contains(errs[0].Reason, "invalid YAML") && !strings.Contains(errs[0].Error(), "yaml") {
		t.Fatalf("expected YAML error reason, got %s (%v)", errs[0].Reason, errs[0].Err)
	}
}

// Scenario 4: UTF-8 Chinese & Emoji support
func TestScenario_UTF8ChineseAndEmoji(t *testing.T) {
	tmpDir := t.TempDir()
	vault, err := NewVault(tmpDir)
	if err != nil {
		t.Fatalf("failed to init vault: %v", err)
	}

	task := &Task{
		Type:      EntityTypeTask,
		ID:        "t-utf8-01",
		Title:     "🚀 统一接入方案 & 极速测试 🌟",
		Status:    TaskStatusDoing,
		Tags:      []string{"架构设计", "⚡️性能优化", "🎉里程碑"},
		CreatedAt: time.Now(),
		UpdatedAt: time.Now(),
		Body:      "## 背景与目标\n\n测试复杂 Unicode 字符集：\n- 简体中文：你好世界\n- Emoji 组合：👨‍💻 🚀 💥 💯\n- 特殊标点：【方案】《白皮书》——（完）\n",
	}

	_, err = vault.SaveEntity(task, nil)
	if err != nil {
		t.Fatalf("failed to save UTF8 task: %v", err)
	}

	path := vault.ResolveEntityPath(task)
	data, err := os.ReadFile(path)
	if err != nil {
		t.Fatalf("failed to read task file: %v", err)
	}

	readEntity, err := ParseMarkdown(path, data)
	if err != nil {
		t.Fatalf("failed to parse back UTF8 task: %v", err)
	}

	readTask := readEntity.(*Task)
	if readTask.Title != task.Title {
		t.Fatalf("title mismatch: got %q, want %q", readTask.Title, task.Title)
	}
	if len(readTask.Tags) != 3 || readTask.Tags[1] != "⚡️性能优化" {
		t.Fatalf("tags mismatch: %+v", readTask.Tags)
	}
	if !strings.Contains(readTask.Body, "Emoji 组合：👨‍💻 🚀 💥 💯") {
		t.Fatalf("body unicode corrupted: %s", readTask.Body)
	}
}

// Scenario 5: Dangling ID references explainable degradation
func TestScenario_DanglingReferenceDegradation(t *testing.T) {
	tmpDir := t.TempDir()
	vault, err := NewVault(tmpDir)
	if err != nil {
		t.Fatalf("failed to init vault: %v", err)
	}

	// Create task referencing a note that doesn't exist yet
	task := &Task{
		Type:      EntityTypeTask,
		ID:        "t-dang-01",
		Title:     "测试关联缺失",
		Status:    TaskStatusTodo,
		NoteIDs:   []string{"n-missing-01"},
		CreatedAt: time.Now(),
		UpdatedAt: time.Now(),
	}
	_, err = vault.SaveEntity(task, nil)
	if err != nil {
		t.Fatalf("failed to save task: %v", err)
	}

	// Create memo referencing missing task
	memo := &Memo{
		Type:      EntityTypeMemo,
		ID:        "m-dang-01",
		TaskID:    "t-nonexistent-01",
		CreatedAt: time.Now(),
	}
	_, err = vault.SaveEntity(memo, nil)
	if err != nil {
		t.Fatalf("failed to save memo: %v", err)
	}

	// Check dangling references
	dangling := vault.Index.ListDanglingReferences()
	if len(dangling) != 2 {
		t.Fatalf("expected 2 dangling references, got %d: %+v", len(dangling), dangling)
	}

	// Verify both were degraded with explanation
	foundNoteRef := false
	foundTaskRef := false
	for _, d := range dangling {
		if d.TargetID == "n-missing-01" && d.TargetType == EntityTypeNote {
			foundNoteRef = true
		}
		if d.TargetID == "t-nonexistent-01" && d.TargetType == EntityTypeTask {
			foundTaskRef = true
		}
	}
	if !foundNoteRef || !foundTaskRef {
		t.Fatalf("dangling references not properly categorized: %+v", dangling)
	}

	// Now repair the reference by creating the missing note!
	missingNote := &Note{
		Type:      EntityTypeNote,
		ID:        "n-missing-01",
		Title:     "补齐的缺失笔记",
		CreatedAt: time.Now(),
		UpdatedAt: time.Now(),
	}
	_, err = vault.SaveEntity(missingNote, nil)
	if err != nil {
		t.Fatalf("failed to save note: %v", err)
	}

	// Note dangling ref should be resolved!
	danglingAfter := vault.Index.ListDanglingReferences()
	if len(danglingAfter) != 1 || danglingAfter[0].TargetID != "t-nonexistent-01" {
		t.Fatalf("expected only 1 remaining dangling ref, got %d: %+v", len(danglingAfter), danglingAfter)
	}
}

// Scenario 6: Round-trip unknown YAML fields preservation
func TestScenario_UnknownYAMLFieldsPreserved(t *testing.T) {
	input := `---
type: task
id: t-roundtrip-01
title: 未知字段测试
status: doing
priority: p1
created_at: 2026-10-11T10:00:00+08:00
updated_at: 2026-10-11T10:00:00+08:00
custom_agent_id: pi-007
nested_attributes:
  ai_confidence: 0.98
  source: ide_plugin
---

正文内容保持不变。
`
	entity, err := ParseMarkdown("/test/task.md", []byte(input))
	if err != nil {
		t.Fatalf("parse failed: %v", err)
	}

	task := entity.(*Task)
	// Modify known field
	task.Title = "更新后的已知标题"

	serialized, err := SerializeMarkdown(task)
	if err != nil {
		t.Fatalf("serialize failed: %v", err)
	}

	outStr := string(serialized)
	if !strings.Contains(outStr, "custom_agent_id: pi-007") {
		t.Fatalf("unknown field 'custom_agent_id' lost in round-trip! output:\n%s", outStr)
	}
	if !strings.Contains(outStr, "ai_confidence: 0.98") {
		t.Fatalf("nested unknown field 'ai_confidence' lost in round-trip! output:\n%s", outStr)
	}
	if !strings.Contains(outStr, "更新后的已知标题") {
		t.Fatalf("updated title missing: %s", outStr)
	}
}

// Scenario 7: DayPlan invariant - no duplicate task IDs
func TestScenario_DayPlanInvariant(t *testing.T) {
	validPlan := &DayPlan{
		Type:    EntityTypeDayPlan,
		Date:    "2026-10-11",
		TaskIDs: []string{"t-01", "t-02", "t-03"},
	}
	if err := ValidateEntity("plan.md", validPlan); err != nil {
		t.Fatalf("valid day plan failed: %v", err)
	}

	duplicatePlan := &DayPlan{
		Type:    EntityTypeDayPlan,
		Date:    "2026-10-11",
		TaskIDs: []string{"t-01", "t-02", "t-01"}, // duplicate!
	}
	err := ValidateEntity("plan.md", duplicatePlan)
	if err == nil {
		t.Fatalf("expected validation error on duplicate task id in DayPlan, got nil")
	}

	var valErr *ValidationError
	if !errors.As(err, &valErr) || !strings.Contains(valErr.Reason, "duplicate task id") {
		t.Fatalf("expected duplicate task id reason, got: %v", err)
	}
}

// Scenario 8: Internal write suppression avoids fsnotify feedback
func TestScenario_FSNotifySelfFeedbackSuppression(t *testing.T) {
	tmpDir := t.TempDir()
	vault, err := NewVault(tmpDir)
	if err != nil {
		t.Fatalf("failed to init vault: %v", err)
	}

	if err := vault.StartWatcher(); err != nil {
		t.Fatalf("failed to start watcher: %v", err)
	}
	defer vault.StopWatcher()

	task := &Task{
		Type:      EntityTypeTask,
		ID:        "t-suppress-01",
		Title:     "内部写入自反馈测试",
		Status:    TaskStatusTodo,
		CreatedAt: time.Now(),
		UpdatedAt: time.Now(),
	}

	// Drain any existing events in channel
	time.Sleep(50 * time.Millisecond)
drainLoop:
	for {
		select {
		case <-vault.Events():
		default:
			break drainLoop
		}
	}

	// Internal write via SaveEntity
	_, err = vault.SaveEntity(task, nil)
	if err != nil {
		t.Fatalf("save entity failed: %v", err)
	}

	// Wait briefly to see if fsnotify fired a self event
	select {
	case ev := <-vault.Events():
		t.Fatalf("unexpected fsnotify event dispatched for internal write: %+v", ev)
	case <-time.After(200 * time.Millisecond):
		// Success! Suppressed properly.
	}
}
