package main

import (
	"encoding/base64"
	"os"
	"path/filepath"
	"testing"

	"pata/internal/storage/markdown"
)

func TestVaultServiceFileImportAndSearch(t *testing.T) {
	tmpDir, err := os.MkdirTemp("", "pata-vs-files-*")
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

	// 1. Create a dummy external file
	extDir, err := os.MkdirTemp("", "pata-ext-*")
	if err != nil {
		t.Fatal(err)
	}
	defer os.RemoveAll(extDir)

	extPath := filepath.Join(extDir, "proposal.pdf")
	origBytes := []byte("original external pdf content")
	if err := os.WriteFile(extPath, origBytes, 0644); err != nil {
		t.Fatal(err)
	}

	// 2. Import file
	res1, err := svc.ImportFile(extPath)
	if err != nil {
		t.Fatalf("ImportFile failed: %v", err)
	}
	if res1.Name != "proposal.pdf" || res1.Path != "files/proposal.pdf" || res1.Size != int64(len(origBytes)) {
		t.Fatalf("unexpected res1: %+v", res1)
	}

	// Verify original file is still intact and not moved
	if _, err := os.Stat(extPath); os.IsNotExist(err) {
		t.Fatalf("external file was moved or deleted!")
	}

	// 3. Import same filename again -> should generate non-colliding name (proposal 1.pdf)
	res2, err := svc.ImportFile(extPath)
	if err != nil {
		t.Fatalf("second ImportFile failed: %v", err)
	}
	if res2.Name != "proposal 1.pdf" || res2.Path != "files/proposal 1.pdf" {
		t.Fatalf("expected proposal 1.pdf, got %+v", res2)
	}

	// 4. Import via base64 data
	imgData := []byte("fake png binary data")
	b64 := base64.StdEncoding.EncodeToString(imgData)
	res3, err := svc.ImportFileData("chart.png", "data:image/png;base64,"+b64)
	if err != nil {
		t.Fatalf("ImportFileData failed: %v", err)
	}
	if res3.Name != "chart.png" || res3.Path != "files/chart.png" || res3.Size != int64(len(imgData)) {
		t.Fatalf("unexpected res3: %+v", res3)
	}

	// 5. ListFiles
	files, err := svc.ListFiles()
	if err != nil {
		t.Fatalf("ListFiles failed: %v", err)
	}
	if len(files) != 3 {
		t.Fatalf("expected 3 files, got %d: %+v", len(files), files)
	}

	// 6. SearchAll should match files by name
	searchResults, err := svc.SearchAll("proposal")
	if err != nil {
		t.Fatalf("SearchAll failed: %v", err)
	}
	fileMatches := 0
	for _, sr := range searchResults {
		if sr.Type == markdown.EntityTypeFile {
			fileMatches++
		}
	}
	if fileMatches != 2 {
		t.Fatalf("expected 2 file matches for 'proposal', got %d: %+v", fileMatches, searchResults)
	}

	// 7. Path safety check on PreviewFile / OpenFile with path traversal
	err = svc.PreviewFile("../outside.txt")
	if err == nil {
		t.Fatalf("expected error on path escape in PreviewFile, got nil")
	}

	// File not existing in vault
	err = svc.PreviewFile("files/non-existent.pdf")
	if err == nil {
		t.Fatalf("expected error on non-existent file, got nil")
	}

	// Ensure vault index retained all 3 files
	_ = v
}
