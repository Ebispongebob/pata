package markdown

import (
	"os"
	"path/filepath"
	"testing"
)

func TestVaultBoundaryAndFilesIndex(t *testing.T) {
	tmpDir, err := os.MkdirTemp("", "pata-vault-boundary-*")
	if err != nil {
		t.Fatalf("failed to create temp dir: %v", err)
	}
	defer os.RemoveAll(tmpDir)

	// 1. Create directory structure
	for _, dir := range []string{"tasks", "notes/sub", "plans", "files/sub", "docs", "other"} {
		if err := os.MkdirAll(filepath.Join(tmpDir, dir), 0755); err != nil {
			t.Fatalf("failed to create dir %s: %v", dir, err)
		}
	}

	// 2. Put files in root and non-business dirs (should NOT be indexed as notes)
	if err := os.WriteFile(filepath.Join(tmpDir, "README.md"), []byte("# Root Readme\nShould not be a note"), 0644); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(tmpDir, "docs", "guide.md"), []byte("# Guide\nShould not be a note"), 0644); err != nil {
		t.Fatal(err)
	}

	// 3. Put business files
	taskContent := "---\ntype: task\nid: t-01\ntitle: Task 1\nstatus: todo\ncreated_at: 2026-10-16T10:00:00+08:00\nupdated_at: 2026-10-16T10:00:00+08:00\n---\n"
	if err := os.WriteFile(filepath.Join(tmpDir, "tasks", "task-1.md"), []byte(taskContent), 0644); err != nil {
		t.Fatal(err)
	}

	noteContent := "---\ntype: note\nid: n-01\ntitle: Note 1\ncreated_at: 2026-10-16T10:00:00+08:00\nupdated_at: 2026-10-16T10:00:00+08:00\n---\n# Note 1"
	if err := os.WriteFile(filepath.Join(tmpDir, "notes", "note-1.md"), []byte(noteContent), 0644); err != nil {
		t.Fatal(err)
	}
	plainNoteContent := "# Plain Note\nNo frontmatter note"
	if err := os.WriteFile(filepath.Join(tmpDir, "notes", "sub", "plain.md"), []byte(plainNoteContent), 0644); err != nil {
		t.Fatal(err)
	}

	planContent := "---\ntype: day_plan\ndate: 2026-10-16\ntask_ids: [t-01]\n---\n"
	if err := os.WriteFile(filepath.Join(tmpDir, "plans", "2026-10-16.md"), []byte(planContent), 0644); err != nil {
		t.Fatal(err)
	}

	// 4. Put files in files/
	pdfContent := []byte("%PDF-1.4 dummy pdf content")
	if err := os.WriteFile(filepath.Join(tmpDir, "files", "document.pdf"), pdfContent, 0644); err != nil {
		t.Fatal(err)
	}
	imgContent := []byte("fake image data")
	if err := os.WriteFile(filepath.Join(tmpDir, "files", "sub", "image.png"), imgContent, 0644); err != nil {
		t.Fatal(err)
	}

	// Scan vault
	idx, err := ScanVault(tmpDir)
	if err != nil {
		t.Fatalf("ScanVault failed: %v", err)
	}

	// Verify only notes in notes/ were indexed
	notes := idx.ListNotes()
	if len(notes) != 2 {
		t.Fatalf("expected 2 notes, got %d: %+v", len(notes), notes)
	}
	for _, n := range notes {
		if n.Title == "Root Readme" || n.Title == "Guide" {
			t.Fatalf("root README or docs/ was wrongly indexed as note: %+v", n)
		}
	}

	// Verify files/ resources
	files := idx.ListFiles()
	if len(files) != 2 {
		t.Fatalf("expected 2 files in index, got %d: %+v", len(files), files)
	}

	f1, ok := idx.GetFile("files/document.pdf")
	if !ok || f1.Name != "document.pdf" || f1.Ext != ".pdf" || f1.Size != int64(len(pdfContent)) {
		t.Fatalf("file files/document.pdf not found or wrong: %+v", f1)
	}

	f2, ok := idx.GetFile("files/sub/image.png")
	if !ok || f2.Name != "image.png" || f2.Ext != ".png" {
		t.Fatalf("file files/sub/image.png not found or wrong: %+v", f2)
	}

	// Verify SearchAll matches files by name and path
	res := idx.SearchAll("document")
	if len(res) == 0 || res[0].Type != EntityTypeFile || res[0].Title != "document.pdf" {
		t.Fatalf("expected search to find document.pdf, got: %+v", res)
	}

	resSub := idx.SearchAll("sub/image")
	if len(resSub) == 0 || resSub[0].Type != EntityTypeFile || resSub[0].Title != "image.png" {
		t.Fatalf("expected search to find image.png by path, got: %+v", resSub)
	}
}

func TestSafeResolveVaultPath(t *testing.T) {
	tmpDir, err := os.MkdirTemp("", "pata-safety-*")
	if err != nil {
		t.Fatal(err)
	}
	defer os.RemoveAll(tmpDir)

	filesDir := filepath.Join(tmpDir, "files")
	_ = os.MkdirAll(filesDir, 0755)
	testFile := filepath.Join(filesDir, "test.pdf")
	_ = os.WriteFile(testFile, []byte("data"), 0644)

	// Valid relative path
	abs, rel, err := SafeResolveVaultPath(tmpDir, "files/test.pdf")
	if err != nil || rel != "files/test.pdf" || abs != testFile {
		t.Fatalf("expected valid resolution, got abs: %s, rel: %s, err: %v", abs, rel, err)
	}

	// Valid with leading ../ from tasks/
	abs, rel, err = SafeResolveVaultPath(tmpDir, "tasks/../files/test.pdf")
	if err != nil || rel != "files/test.pdf" {
		t.Fatalf("expected valid normalized resolution, got: %s, %s, %v", abs, rel, err)
	}

	// Path escape attempt
	_, _, err = SafeResolveVaultPath(tmpDir, "../outside.txt")
	if err == nil {
		t.Fatalf("expected error for path escape, got nil")
	}

	_, _, err = SafeResolveVaultPath(tmpDir, "files/../../outside.txt")
	if err == nil {
		t.Fatalf("expected error for nested path escape, got nil")
	}

	// Symlink escape attempt
	outsideDir, err := os.MkdirTemp("", "pata-outside-*")
	if err != nil {
		t.Fatal(err)
	}
	defer os.RemoveAll(outsideDir)

	secretFile := filepath.Join(outsideDir, "secret.txt")
	_ = os.WriteFile(secretFile, []byte("secret"), 0644)
	linkToFile := filepath.Join(filesDir, "leak.txt")
	_ = os.Symlink(secretFile, linkToFile)

	if _, _, err := SafeResolveVaultPath(tmpDir, "files/leak.txt"); err == nil {
		t.Fatalf("expected error on symlinked file to outside, got nil")
	}

	// Ancestor symlink escape: vault/files/outside_dir -> outsideDir/
	linkToDir := filepath.Join(filesDir, "outside_dir")
	_ = os.Symlink(outsideDir, linkToDir)

	// Existing file inside outsideDir reached via ancestor symlink
	if _, _, err := SafeResolveVaultPath(tmpDir, "files/outside_dir/secret.txt"); err == nil {
		t.Fatalf("expected error on ancestor symlink resolving to outside file, got nil")
	}

	// Non-existing file inside outsideDir reached via ancestor symlink
	if _, _, err := SafeResolveVaultPath(tmpDir, "files/outside_dir/new_file.txt"); err == nil {
		t.Fatalf("expected error on ancestor symlink for new file, got nil")
	}
}
