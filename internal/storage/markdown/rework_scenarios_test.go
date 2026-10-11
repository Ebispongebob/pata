package markdown

import (
	"errors"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

// H1 Test: Two Notes with identical titles and different IDs must resolve to different paths
// and neither can overwrite the other. Also, baseline == nil onto an existing file with different
// content must be rejected with ErrConflict.
func TestScenario_H1_SameTitleDifferentIDNotesNotOverwritten(t *testing.T) {
	tmpDir := t.TempDir()
	vault, err := NewVault(tmpDir)
	if err != nil {
		t.Fatalf("failed to init vault: %v", err)
	}

	note1 := &Note{
		Type:      EntityTypeNote,
		ID:        "n-same-001",
		Title:     "统一架构方案",
		CreatedAt: time.Now(),
		UpdatedAt: time.Now(),
		Body:      "第一篇同标题笔记",
	}

	note2 := &Note{
		Type:      EntityTypeNote,
		ID:        "n-same-002",
		Title:     "统一架构方案",
		CreatedAt: time.Now(),
		UpdatedAt: time.Now(),
		Body:      "第二篇同标题笔记",
	}

	// 1. Save note 1 with baseline nil
	b1, err := vault.SaveEntity(note1, nil)
	if err != nil {
		t.Fatalf("failed to save note1: %v", err)
	}
	if b1 == nil {
		t.Fatalf("expected non-nil baseline")
	}

	// 2. Save note 2 with baseline nil
	b2, err := vault.SaveEntity(note2, nil)
	if err != nil {
		t.Fatalf("failed to save note2: %v", err)
	}
	if b2 == nil {
		t.Fatalf("expected non-nil baseline")
	}

	// Verify paths are distinct because ID is included in filename
	path1 := vault.ResolveEntityPath(note1)
	path2 := vault.ResolveEntityPath(note2)
	if path1 == path2 {
		t.Fatalf("expected distinct file paths for note1 and note2, but both resolved to %s", path1)
	}

	// Verify both exist on disk
	content1, err := os.ReadFile(path1)
	if err != nil {
		t.Fatalf("failed to read note1 file: %v", err)
	}
	content2, err := os.ReadFile(path2)
	if err != nil {
		t.Fatalf("failed to read note2 file: %v", err)
	}

	if !strings.Contains(string(content1), "第一篇同标题笔记") {
		t.Fatalf("note1 was corrupted: %s", string(content1))
	}
	if !strings.Contains(string(content2), "第二篇同标题笔记") {
		t.Fatalf("note2 was corrupted: %s", string(content2))
	}

	// Verify both exist in index
	retrieved1, ok1 := vault.Index.GetNote("n-same-001")
	retrieved2, ok2 := vault.Index.GetNote("n-same-002")
	if !ok1 || !ok2 {
		t.Fatalf("both notes should exist in index: ok1=%v, ok2=%v", ok1, ok2)
	}
	if retrieved1.Body != note1.Body || retrieved2.Body != note2.Body {
		t.Fatalf("retrieved notes body mismatch")
	}

	// 3. Test baseline == nil overwrite protection:
	// Trying to SafeWrite different data to path1 with baseline == nil must be rejected!
	collidingData := []byte("恶意覆盖内容")
	_, err = SafeWrite(path1, collidingData, nil, nil)
	if err == nil {
		t.Fatalf("expected ConflictError when SafeWrite with baseline == nil over existing different file, got nil")
	}
	if !errors.Is(err, ErrConflict) {
		t.Fatalf("expected ErrConflict, got: %v", err)
	}
}

// H2 Test: Multiple plain markdown files without frontmatter coexist in index
// with distinct derived IDs, and removing one file does not damage the other's index.
func TestScenario_H2_MultiplePlainMarkdownCoexistAndRemoveOne(t *testing.T) {
	tmpDir := t.TempDir()
	vault, err := NewVault(tmpDir)
	if err != nil {
		t.Fatalf("failed to init vault: %v", err)
	}

	plainDir := filepath.Join(tmpDir, "notes")
	if err := os.MkdirAll(plainDir, 0755); err != nil {
		t.Fatalf("failed to create dir: %v", err)
	}

	fileA := filepath.Join(plainDir, "guide.md")
	contentA := "# 指南文档\n\n这是纯文本指南。"
	if err := os.WriteFile(fileA, []byte(contentA), 0644); err != nil {
		t.Fatalf("failed to write fileA: %v", err)
	}

	fileB := filepath.Join(plainDir, "intro.md")
	contentB := "# 介绍文档\n\n这是纯文本介绍。"
	if err := os.WriteFile(fileB, []byte(contentB), 0644); err != nil {
		t.Fatalf("failed to write fileB: %v", err)
	}

	// Scan vault to index both
	if err := vault.Scan(); err != nil {
		t.Fatalf("scan failed: %v", err)
	}

	// Check fileToID mapping
	vault.Index.mu.RLock()
	idA, okA := vault.Index.fileToID[fileA]
	idB, okB := vault.Index.fileToID[fileB]
	vault.Index.mu.RUnlock()

	if !okA || !okB {
		t.Fatalf("expected both files to be indexed: okA=%v, okB=%v", okA, okB)
	}
	if idA == "" || idB == "" {
		t.Fatalf("expected non-empty derived IDs for plain files, got idA=%q, idB=%q", idA, idB)
	}
	if idA == idB {
		t.Fatalf("expected distinct derived IDs for fileA and fileB, both got %q", idA)
	}

	// Check notes map contains both
	noteA, okA := vault.Index.GetNote(idA)
	noteB, okB := vault.Index.GetNote(idB)
	if !okA || !okB {
		t.Fatalf("expected both notes accessible by ID: okA=%v, okB=%v", okA, okB)
	}
	if noteA.Title != "指南文档" || noteB.Title != "介绍文档" {
		t.Fatalf("note titles mismatch: titleA=%q, titleB=%q", noteA.Title, noteB.Title)
	}

	// Now remove file A from disk and index
	if err := os.Remove(fileA); err != nil {
		t.Fatalf("failed to remove fileA: %v", err)
	}
	vault.Index.RemoveFile(fileA)

	// Note A must be gone
	if _, existsA := vault.Index.GetNote(idA); existsA {
		t.Fatalf("noteA should have been removed from index")
	}

	// Note B must REMAIN completely intact!
	retainedNoteB, existsB := vault.Index.GetNote(idB)
	if !existsB {
		t.Fatalf("noteB was erroneously removed when noteA was deleted!")
	}
	if retainedNoteB.Title != "介绍文档" {
		t.Fatalf("retained noteB data corrupted: %+v", retainedNoteB)
	}

	vault.Index.mu.RLock()
	mappedPathB, hasMappingB := vault.Index.idToFile[idB]
	vault.Index.mu.RUnlock()
	if !hasMappingB || mappedPathB != fileB {
		t.Fatalf("idToFile mapping for noteB was damaged: path=%q", mappedPathB)
	}
}

// M2 Test: Duplicate entity ID across different files is detected during scan
// and PutEntity, recorded in parseErrors as explainable degradation, without silent last-wins overwrite.
func TestScenario_M2_DuplicateEntityIDCollisionIsolated(t *testing.T) {
	tmpDir := t.TempDir()
	vault, err := NewVault(tmpDir)
	if err != nil {
		t.Fatalf("failed to init vault: %v", err)
	}

	tasksDir := filepath.Join(tmpDir, "tasks")
	if err := os.MkdirAll(tasksDir, 0755); err != nil {
		t.Fatalf("failed to create dir: %v", err)
	}

	file1 := filepath.Join(tasksDir, "task_one.md")
	content1 := `---
type: task
id: t-dup-001
title: 第一个任务
status: todo
priority: p1
created_at: 2026-10-11T10:00:00+08:00
updated_at: 2026-10-11T10:00:00+08:00
---

内容 1
`
	if err := os.WriteFile(file1, []byte(content1), 0644); err != nil {
		t.Fatalf("failed to write file1: %v", err)
	}

	file2 := filepath.Join(tasksDir, "task_two.md")
	content2 := `---
type: task
id: t-dup-001
title: 冲突的第二个任务(同ID)
status: doing
priority: p2
created_at: 2026-10-11T11:00:00+08:00
updated_at: 2026-10-11T11:00:00+08:00
---

内容 2
`
	if err := os.WriteFile(file2, []byte(content2), 0644); err != nil {
		t.Fatalf("failed to write file2: %v", err)
	}

	// Scan vault
	if err := vault.Scan(); err != nil {
		t.Fatalf("vault scan failed: %v", err)
	}

	// 1. Check parse errors contains duplicate collision report
	errs := vault.Index.ListParseErrors()
	foundCollision := false
	for _, e := range errs {
		if strings.Contains(e.Reason, "duplicate entity ID collision") && strings.Contains(e.Reason, "t-dup-001") {
			foundCollision = true
			break
		}
	}
	if !foundCollision {
		t.Fatalf("expected duplicate ID collision error in parseErrors, got: %+v", errs)
	}

	// 2. Original entity in index must NOT be silently overwritten
	t1, ok := vault.Index.GetTask("t-dup-001")
	if !ok {
		t.Fatalf("task t-dup-001 missing from index")
	}
	if t1.Title != "第一个任务" {
		t.Fatalf("task t-dup-001 was silently overwritten by file2! title=%q", t1.Title)
	}

	// 3. PutEntity on a different path with existing ID should also be rejected and recorded
	collidingTask := t1.Clone().(*Task)
	collidingTask.Title = "PutEntity 冲突测试"
	vault.Index.PutEntity("/different/path/task.md", collidingTask, FileBaseline{})

	tAfter, _ := vault.Index.GetTask("t-dup-001")
	if tAfter.Title != "第一个任务" {
		t.Fatalf("PutEntity silently overwrote task despite duplicate ID collision!")
	}
}
