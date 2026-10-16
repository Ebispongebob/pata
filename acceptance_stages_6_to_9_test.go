package main

import (
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"pata/internal/storage/markdown"
)

// TestStage6_BrandingAndAssetsRealMachine tests stage 6 bundle, icons, and branding integrity on macOS.
func TestStage6_BrandingAndAssetsRealMachine(t *testing.T) {
	appPath := filepath.Join("bin", "pata.app")
	if _, err := os.Stat(appPath); os.IsNotExist(err) {
		t.Fatalf("bin/pata.app does not exist. Run 'wails3 task package' first.")
	}

	// 1. Check executable exists and codesign verifies
	macOSDir := filepath.Join(appPath, "Contents", "MacOS", "pata")
	if fi, err := os.Stat(macOSDir); err != nil || fi.Size() == 0 {
		t.Fatalf("Contents/MacOS/pata executable missing or empty: %v", err)
	}

	cmd := exec.Command("codesign", "--verify", "--deep", "--strict", appPath)
	if out, err := cmd.CombinedOutput(); err != nil {
		t.Fatalf("codesign verification failed: %s, err: %v", string(out), err)
	}

	// 2. Check Resources: icons.icns exists, Assets.car is ABSENT
	resDir := filepath.Join(appPath, "Contents", "Resources")
	icnsPath := filepath.Join(resDir, "icons.icns")
	icnsInfo, err := os.Stat(icnsPath)
	if err != nil || icnsInfo.Size() < 100000 {
		t.Fatalf("icons.icns missing or unexpectedly small: %v", err)
	}

	assetsCarPath := filepath.Join(resDir, "Assets.car")
	if _, err := os.Stat(assetsCarPath); !os.IsNotExist(err) {
		t.Fatalf("Assets.car should NOT exist in pata.app (must prevent Wails default icon residue)")
	}

	// 3. Verify icons.icns unpacks cleanly with iconutil
	tmpIconset, err := os.MkdirTemp("", "pata-iconset-*")
	if err != nil {
		t.Fatal(err)
	}
	defer os.RemoveAll(tmpIconset)

	iconsetTarget := filepath.Join(tmpIconset, "check.iconset")
	unpackCmd := exec.Command("iconutil", "-c", "iconset", icnsPath, "-o", iconsetTarget)
	if out, err := unpackCmd.CombinedOutput(); err != nil {
		t.Fatalf("iconutil unpack failed: %s, err: %v", string(out), err)
	}

	expectedSizes := []string{
		"icon_16x16@2x.png",
		"icon_32x32@2x.png",
		"icon_128x128.png",
		"icon_128x128@2x.png",
		"icon_256x256.png",
		"icon_256x256@2x.png",
		"icon_512x512.png",
		"icon_512x512@2x.png",
	}
	for _, expected := range expectedSizes {
		p := filepath.Join(iconsetTarget, expected)
		if fi, err := os.Stat(p); err != nil || fi.Size() == 0 {
			t.Errorf("missing or empty icon variant: %s", expected)
		}
	}

	// 4. Check tray icon
	trayPath := filepath.Join("assets", "branding", "tray", "tray.png")
	if fi, err := os.Stat(trayPath); err != nil || fi.Size() == 0 {
		t.Fatalf("tray.png missing or empty: %v", err)
	}
}

// TestStage7_NoteLinksEndToEnd tests note references in Task description, activities, backlinks and safe deletion.
func TestStage7_NoteLinksEndToEnd(t *testing.T) {
	tmpDir, err := os.MkdirTemp("", "pata-s7-vault-*")
	if err != nil {
		t.Fatal(err)
	}
	defer os.RemoveAll(tmpDir)

	svc := NewVaultService()
	v, err := svc.openVault(tmpDir)
	if err != nil {
		t.Fatalf("failed to open vault: %v", err)
	}
	defer func() {
		if svc.stopWatcher != nil {
			svc.stopWatcher()
		}
	}()

	// 1. Create two notes: Note A and Note B
	noteA, err := svc.CreateNote(CreateNoteInput{
		Title: "系统架构说明",
		Body:  "# 架构说明\n核心数据结构与边界设计。",
	})
	if err != nil {
		t.Fatalf("CreateNote A failed: %v", err)
	}

	noteB, err := svc.CreateNote(CreateNoteInput{
		Title: "用户界面规范",
		Body:  "# 界面规范\nmacOS 原生窗口与 HIG 适配。",
	})
	if err != nil {
		t.Fatalf("CreateNote B failed: %v", err)
	}

	// 2. Create Task referencing Note A in Description
	task, err := svc.CreateTask(CreateTaskInput{
		Title:       "完善窗口架构",
		Description: "参考 [[系统架构说明]] 实施新窗口规范",
		NoteRefs:    map[string]string{"系统架构说明": noteA.ID},
	})
	if err != nil {
		t.Fatalf("CreateTask failed: %v", err)
	}

	// 3. Add an Activity to Task referencing Note B
	act1, err := svc.CreateActivity(CreateActivityInput{
		OwnerType: markdown.EntityTypeTask,
		TaskID:    task.ID,
		Body:      "阅读了 [[用户界面规范]] 并确认标题栏样式",
		NoteRefs:  map[string]string{"用户界面规范": noteB.ID},
	})
	if err != nil {
		t.Fatalf("CreateActivity act1 failed: %v", err)
	}
	if act1.ID == "" {
		t.Fatalf("expected non-empty activity ID")
	}

	// 4. Add another Activity to Task ALSO referencing Note A
	_, err = svc.CreateActivity(CreateActivityInput{
		OwnerType: markdown.EntityTypeTask,
		TaskID:    task.ID,
		Body:      "再次对齐 [[系统架构说明]] 的边界定义",
		NoteRefs:  map[string]string{"系统架构说明": noteA.ID},
	})
	if err != nil {
		t.Fatalf("CreateActivity act2 failed: %v", err)
	}

	// 5. Verify Backlinks (被引用):
	// Note A should have exactly 1 backlink from Task (deduplicated across Description and Activity)
	backlinksA, err := svc.GetNoteBacklinks(noteA.ID)
	if err != nil {
		t.Fatalf("GetNoteBacklinks failed: %v", err)
	}
	if len(backlinksA) != 1 {
		t.Fatalf("expected 1 backlink for Note A, got %d", len(backlinksA))
	}
	if backlinksA[0].ID != task.ID || backlinksA[0].Type != markdown.EntityTypeTask {
		t.Fatalf("unexpected backlink for Note A: %+v", backlinksA[0])
	}

	// Note B should have 1 backlink from Task
	backlinksB, err := svc.GetNoteBacklinks(noteB.ID)
	if err != nil {
		t.Fatalf("GetNoteBacklinks B failed: %v", err)
	}
	if len(backlinksB) != 1 {
		t.Fatalf("expected 1 backlink for Note B, got %d", len(backlinksB))
	}

	// 6. Test safe deletion: Delete Note A.
	// Task's note_refs still retains noteA.ID, but target Note does not exist.
	if err := v.DeleteEntity(noteA.ID); err != nil {
		t.Fatalf("DeleteEntity Note A failed: %v", err)
	}

	// Verify Note A has 0 backlinks now
	backlinksAfterDel, err := svc.GetNoteBacklinks(noteA.ID)
	if err != nil {
		t.Fatalf("GetNoteBacklinks after del failed: %v", err)
	}
	if len(backlinksAfterDel) != 0 {
		t.Fatalf("expected 0 backlinks after deleting Note A, got %d", len(backlinksAfterDel))
	}

	// 7. Create a NEW note with the SAME title "系统架构说明"
	newNoteA, err := svc.CreateNote(CreateNoteInput{
		Title: "系统架构说明",
		Body:  "# 新架构说明",
	})
	if err != nil {
		t.Fatalf("CreateNote new Note A failed: %v", err)
	}
	if newNoteA.ID == noteA.ID {
		t.Fatalf("new note should have different ID from deleted note")
	}

	// Verify new Note A is NOT hijacked by task's old note_refs!
	newBacklinksA, err := svc.GetNoteBacklinks(newNoteA.ID)
	if err != nil {
		t.Fatalf("GetNoteBacklinks newNoteA failed: %v", err)
	}
	if len(newBacklinksA) != 0 {
		t.Fatalf("new note with same title must NOT inherit old note bindings, got %d backlinks", len(newBacklinksA))
	}
}

// TestStage8_ActivityStorageRefactorEndToEnd tests Task embedded activities, DayPlan in plans/, timeline, and cascade delete.
func TestStage8_ActivityStorageRefactorEndToEnd(t *testing.T) {
	tmpDir, err := os.MkdirTemp("", "pata-s8-vault-*")
	if err != nil {
		t.Fatal(err)
	}
	defer os.RemoveAll(tmpDir)

	svc := NewVaultService()
	v, err := svc.openVault(tmpDir)
	if err != nil {
		t.Fatalf("failed to open vault: %v", err)
	}
	defer func() {
		if svc.stopWatcher != nil {
			svc.stopWatcher()
		}
	}()

	today := time.Now().Format("2006-01-02")

	// 1. Create Task with Description
	task, err := svc.CreateTask(CreateTaskInput{
		Title:       "重构日志模块",
		Description: "第一阶段：支持异步滚动",
		Tags:        []string{"backend", "logging"},
	})
	if err != nil {
		t.Fatalf("CreateTask failed: %v", err)
	}

	// 2. Add Activity to Task
	actTime := time.Now()
	act1, err := svc.CreateActivity(CreateActivityInput{
		OwnerType: markdown.EntityTypeTask,
		TaskID:    task.ID,
		At:        &actTime,
		Body:      "完成了异步队列缓冲区设计 #queue",
		Tags:      []string{"queue"},
	})
	if err != nil {
		t.Fatalf("CreateActivity failed: %v", err)
	}
	if !strings.HasPrefix(act1.ID, "a-") {
		t.Fatalf("activity ID should have prefix 'a-', got %s", act1.ID)
	}

	// Check underlying task file
	taskFile := v.ResolveEntityPath(task)
	contentBytes, err := os.ReadFile(taskFile)
	if err != nil {
		t.Fatal(err)
	}
	content := string(contentBytes)
	if !strings.Contains(content, `description: "第一阶段：支持异步滚动"`) && !strings.Contains(content, `description: 第一阶段：支持异步滚动`) {
		t.Fatalf("task description should be in frontmatter, got:\n%s", content)
	}
	if !strings.Contains(content, `<!-- pata:activity`) || !strings.Contains(content, `id: `+act1.ID) || !strings.Contains(content, `<!-- /pata:activity -->`) {
		t.Fatalf("task body should contain embedded activity block, got:\n%s", content)
	}

	// 3. Add task to Today's DayPlan
	if _, err := svc.SaveDayPlan(today, []string{task.ID}); err != nil {
		t.Fatalf("SaveDayPlan failed: %v", err)
	}

	// 4. Create standalone Activity in Today's DayPlan
	standaloneAct, err := svc.CreateActivity(CreateActivityInput{
		OwnerType: markdown.EntityTypeDayPlan,
		Date:      today,
		Body:      "今天团队同步晨会",
		Tags:      []string{"meeting"},
	})
	if err != nil {
		t.Fatalf("Create standalone activity failed: %v", err)
	}

	// Verify plan file location: plans/YYYY-MM-DD.md
	planFilePath := filepath.Join(tmpDir, "plans", today+".md")
	if _, err := os.Stat(planFilePath); os.IsNotExist(err) {
		t.Fatalf("DayPlan file should be at %s", planFilePath)
	}

	// 5. Test Timeline aggregation
	timeline, err := svc.GetDayTimeline(today)
	if err != nil {
		t.Fatalf("GetDayTimeline failed: %v", err)
	}
	if len(timeline) < 2 {
		t.Fatalf("expected at least 2 items in timeline (task activity + standalone activity), got %d", len(timeline))
	}

	// 6. Toggle task status to done -> should record completion event
	updatedTask, err := svc.UpdateTask(UpdateTaskInput{
		ID:     task.ID,
		Title:  task.Title,
		Status: markdown.TaskStatusDone,
	})
	if err != nil {
		t.Fatalf("UpdateTask to done failed: %v", err)
	}
	if updatedTask.Status != markdown.TaskStatusDone {
		t.Fatalf("expected task status done, got %s", updatedTask.Status)
	}

	timelineWithDone, err := svc.GetDayTimeline(today)
	if err != nil {
		t.Fatalf("GetDayTimeline after done failed: %v", err)
	}
	hasCompletion := false
	for _, item := range timelineWithDone {
		if item.Kind == "completion" && item.TaskID == task.ID {
			hasCompletion = true
			break
		}
	}
	if !hasCompletion {
		t.Fatalf("expected completion event in today's timeline")
	}

	// 7. Cascading Delete: Delete Task
	if err := svc.DeleteTask(task.ID); err != nil {
		t.Fatalf("DeleteTask failed: %v", err)
	}

	// Verify task activity is gone
	if _, _, ok := v.Index.GetActivity(act1.ID); ok {
		t.Fatalf("activity %s should have been deleted when task was deleted", act1.ID)
	}

	// Verify task is removed from DayPlan task_ids
	plan, ok := v.Index.GetDayPlan(today)
	if !ok {
		t.Fatalf("DayPlan for %s should still exist", today)
	}
	for _, tid := range plan.TaskIDs {
		if tid == task.ID {
			t.Fatalf("deleted task ID %s still present in DayPlan task_ids", task.ID)
		}
	}

	// Verify standalone activity is STILL INTACT in DayPlan
	if _, _, ok := v.Index.GetActivity(standaloneAct.ID); !ok {
		t.Fatalf("standalone activity in DayPlan should NOT be deleted when task was deleted")
	}

	// Verify Vault Health has 0 parse errors and 0 dangling references
	health, err := svc.GetVaultHealth()
	if err != nil {
		t.Fatalf("GetVaultHealth failed: %v", err)
	}
	if len(health.ParseErrors) != 0 || len(health.DanglingRefs) != 0 {
		t.Fatalf("vault health check failed: %d parse errors, %d dangling refs", len(health.ParseErrors), len(health.DanglingRefs))
	}
}

// TestStage9_VaultFilesEndToEnd tests vault boundaries, file import, non-collision, search, and preview.
func TestStage9_VaultFilesEndToEnd(t *testing.T) {
	tmpDir, err := os.MkdirTemp("", "pata-s9-vault-*")
	if err != nil {
		t.Fatal(err)
	}
	defer os.RemoveAll(tmpDir)

	svc := NewVaultService()
	v, err := svc.openVault(tmpDir)
	if err != nil {
		t.Fatalf("failed to open vault: %v", err)
	}
	defer func() {
		if svc.stopWatcher != nil {
			svc.stopWatcher()
		}
	}()

	// 1. Boundary test: create an arbitrary markdown file in vault root
	arbitraryMD := filepath.Join(tmpDir, "README.md")
	if err := os.WriteFile(arbitraryMD, []byte("# Ignored\nShould not be indexed as a note"), 0644); err != nil {
		t.Fatal(err)
	}
	// Re-scan
	if err := svc.RescanVault(); err != nil {
		t.Fatal(err)
	}
	if len(v.Index.ListNotes()) != 0 {
		t.Fatalf("arbitrary root README.md must NOT be indexed as Note, got %d notes", len(v.Index.ListNotes()))
	}

	// 2. File Import test
	extDir, err := os.MkdirTemp("", "pata-ext-files-*")
	if err != nil {
		t.Fatal(err)
	}
	defer os.RemoveAll(extDir)

	docPath := filepath.Join(extDir, "技术设计方案.pdf")
	origContent := []byte("PDF content for testing")
	if err := os.WriteFile(docPath, origContent, 0644); err != nil {
		t.Fatal(err)
	}

	imported1, err := svc.ImportFile(docPath)
	if err != nil {
		t.Fatalf("ImportFile failed: %v", err)
	}
	if imported1.Name != "技术设计方案.pdf" || imported1.Path != "files/技术设计方案.pdf" {
		t.Fatalf("unexpected imported1: %+v", imported1)
	}

	// 3. Duplicate import -> should rename without collision
	imported2, err := svc.ImportFile(docPath)
	if err != nil {
		t.Fatalf("ImportFile duplicate failed: %v", err)
	}
	if imported2.Name != "技术设计方案 1.pdf" || imported2.Path != "files/技术设计方案 1.pdf" {
		t.Fatalf("unexpected duplicate imported2: %+v", imported2)
	}

	// Verify original file is still intact
	if _, err := os.Stat(docPath); os.IsNotExist(err) {
		t.Fatalf("original external file was deleted or moved")
	}

	// 4. Global Search by filename (Phase 9: find unreferenced files!)
	searchResults, err := svc.SearchAll("技术设计方案")
	if err != nil {
		t.Fatalf("SearchAll failed: %v", err)
	}
	foundFiles := 0
	for _, res := range searchResults {
		if res.Type == "file" {
			foundFiles++
		}
	}
	if foundFiles < 2 {
		t.Fatalf("expected at least 2 files in search results, got %d", foundFiles)
	}

	// 5. Native Preview path resolution
	absPath, err := svc.resolveSafeFilePath("files/技术设计方案.pdf")
	if err != nil {
		t.Fatalf("resolveSafeFilePath failed: %v", err)
	}
	if _, err := os.Stat(absPath); os.IsNotExist(err) {
		t.Fatalf("resolved absolute path does not exist: %s", absPath)
	}

	// 6. Reference file in Activity
	task, err := svc.CreateTask(CreateTaskInput{
		Title: "审阅技术方案",
	})
	if err != nil {
		t.Fatal(err)
	}
	_, err = svc.CreateActivity(CreateActivityInput{
		OwnerType: markdown.EntityTypeTask,
		TaskID:    task.ID,
		Body:      "请查阅附件 [技术设计方案.pdf](files/技术设计方案.pdf)",
	})
	if err != nil {
		t.Fatal(err)
	}

	// Search for query in Activity body
	searchAct, err := svc.SearchAll("查阅附件")
	if err != nil {
		t.Fatalf("SearchAll for activity failed: %v", err)
	}
	hasActivity := false
	for _, it := range searchAct {
		if it.Type == "activity" {
			hasActivity = true
			break
		}
	}
	if !hasActivity {
		t.Fatalf("expected to find activity in search results: %+v", searchAct)
	}
}

// TestRealVault_TestPataHealth verifies the health and entity status of the actual test vault /Users/wuyukang/code/github/test_pata.
func TestRealVault_TestPataHealth(t *testing.T) {
	testVaultPath := "/Users/wuyukang/code/github/test_pata"
	if _, err := os.Stat(testVaultPath); os.IsNotExist(err) {
		t.Skip("skipping real vault test: test_pata directory not found")
	}

	svc := NewVaultService()
	v, err := svc.openVault(testVaultPath)
	if err != nil {
		t.Fatalf("failed to open test_pata vault: %v", err)
	}
	defer func() {
		if svc.stopWatcher != nil {
			svc.stopWatcher()
		}
	}()

	t.Logf("test_pata Tasks: %d, Notes: %d, DayPlans: %d, Files: %d",
		len(v.Index.ListTasks()),
		len(v.Index.ListNotes()),
		len(v.Index.ListDayPlans()),
		len(v.Index.ListFiles()),
	)

	health, err := svc.GetVaultHealth()
	if err != nil {
		t.Fatalf("GetVaultHealth failed: %v", err)
	}
	if len(health.ParseErrors) > 0 {
		for _, pe := range health.ParseErrors {
			t.Logf("Parse error: %s: %s", pe.Path, pe.Reason)
		}
	}
	if len(health.DanglingRefs) > 0 {
		for _, dr := range health.DanglingRefs {
			t.Logf("Dangling ref: %s -> %s", dr.SourceID, dr.TargetID)
		}
	}
	t.Logf("test_pata Health: %d parse errors, %d dangling references", len(health.ParseErrors), len(health.DanglingRefs))
}

// TestTagView_ChronologicalOrdering verifies that ListByTag returns mixed items sorted chronologically descending.
func TestTagView_ChronologicalOrdering(t *testing.T) {
	tempVault := t.TempDir()
	os.MkdirAll(filepath.Join(tempVault, "notes"), 0755)
	os.MkdirAll(filepath.Join(tempVault, "tasks"), 0755)
	os.MkdirAll(filepath.Join(tempVault, "plans"), 0755)
	os.MkdirAll(filepath.Join(tempVault, "files"), 0755)

	svc := NewVaultService()
	if _, err := svc.openVault(tempVault); err != nil {
		t.Fatalf("failed to open vault: %v", err)
	}
	defer func() {
		if svc.stopWatcher != nil {
			svc.stopWatcher()
		}
	}()

	now := time.Now().UTC()
	tOld := now.Add(-3 * time.Hour)
	tMid := now.Add(-2 * time.Hour)
	tNew := now.Add(-1 * time.Hour)

	// Create Note at tOld
	noteContent := fmt.Sprintf(`---
type: note
id: n-tag-001
title: 历史架构草案
tags:
  - 核心
created_at: %s
updated_at: %s
---

这是最早的笔记正文内容
`, tOld.Format(time.RFC3339Nano), tOld.Format(time.RFC3339Nano))
	if err := os.WriteFile(filepath.Join(tempVault, "notes", "n-tag-001.md"), []byte(noteContent), 0644); err != nil {
		t.Fatalf("write note: %v", err)
	}

	// Create Task at tMid
	taskContent := fmt.Sprintf(`---
type: task
id: t-tag-001
title: 核心模块重构
status: todo
tags:
  - 核心
created_at: %s
updated_at: %s
---

<!-- pata:activity
id: a-tag-001
at: %s
-->
最新的活动进展记录
<!-- /pata:activity -->
`, tMid.Format(time.RFC3339Nano), tMid.Format(time.RFC3339Nano), tNew.Format(time.RFC3339Nano))
	if err := os.WriteFile(filepath.Join(tempVault, "tasks", "t-tag-001.md"), []byte(taskContent), 0644); err != nil {
		t.Fatalf("write task: %v", err)
	}

	if err := svc.RescanVault(); err != nil {
		t.Fatalf("rescan vault failed: %v", err)
	}

	refs, err := svc.ListByTag("核心")
	if err != nil {
		t.Fatalf("ListByTag failed: %v", err)
	}

	if len(refs) != 3 {
		t.Fatalf("expected 3 refs for '核心', got %d: %+v", len(refs), refs)
	}

	// Verify descending order: tNew (activity) -> tMid (task) -> tOld (note)
	if refs[0].Type != markdown.EntityTypeActivity || refs[0].ID != "a-tag-001" {
		t.Errorf("expected 1st item to be newest activity a-tag-001, got %+v", refs[0])
	}
	if refs[0].Snippet != "最新的活动进展记录" {
		t.Errorf("expected activity snippet to be populated, got %q", refs[0].Snippet)
	}
	if refs[0].TaskID != "t-tag-001" {
		t.Errorf("expected activity TaskID to be t-tag-001, got %q", refs[0].TaskID)
	}

	if refs[1].Type != markdown.EntityTypeTask || refs[1].ID != "t-tag-001" {
		t.Errorf("expected 2nd item to be middle task t-tag-001, got %+v", refs[1])
	}
	if refs[1].Status != markdown.TaskStatusTodo {
		t.Errorf("expected task status to be todo, got %q", refs[1].Status)
	}

	if refs[2].Type != markdown.EntityTypeNote || refs[2].ID != "n-tag-001" {
		t.Errorf("expected 3rd item to be oldest note n-tag-001, got %+v", refs[2])
	}
	if !strings.Contains(refs[2].Snippet, "这是最早的笔记正文内容") {
		t.Errorf("expected note snippet to be populated, got %q", refs[2].Snippet)
	}

	// Check timestamps are strictly descending
	if !refs[0].Time.After(refs[1].Time) || !refs[1].Time.After(refs[2].Time) {
		t.Errorf("expected strictly descending timestamps: [%v, %v, %v]", refs[0].Time, refs[1].Time, refs[2].Time)
	}
}

