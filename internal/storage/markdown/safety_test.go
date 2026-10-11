package markdown

import (
	"errors"
	"os"
	"path/filepath"
	"testing"
)

func TestSafeWriteBasic(t *testing.T) {
	tmpDir := t.TempDir()
	target := filepath.Join(tmpDir, "test.md")

	content1 := []byte("Initial content")
	baseline1, err := SafeWrite(target, content1, nil, nil)
	if err != nil {
		t.Fatalf("SafeWrite failed: %v", err)
	}

	readBack, err := os.ReadFile(target)
	if err != nil {
		t.Fatalf("failed to read back file: %v", err)
	}
	if string(readBack) != string(content1) {
		t.Fatalf("content mismatch: got %q, want %q", readBack, content1)
	}

	// Update with correct baseline
	content2 := []byte("Second content")
	baseline2, err := SafeWrite(target, content2, baseline1, nil)
	if err != nil {
		t.Fatalf("SafeWrite with valid baseline failed: %v", err)
	}
	if baseline2.Hash == baseline1.Hash {
		t.Fatalf("expected new hash, got same hash %s", baseline2.Hash)
	}
}

func TestSafeWriteConflictDetection(t *testing.T) {
	tmpDir := t.TempDir()
	target := filepath.Join(tmpDir, "conflict.md")

	initial := []byte("Version 0")
	baseline, err := SafeWrite(target, initial, nil, nil)
	if err != nil {
		t.Fatalf("initial write failed: %v", err)
	}

	// External editor modifies the file behind our back
	externalEdit := []byte("Version 1 (External edit by Pi agent)")
	if err := os.WriteFile(target, externalEdit, 0644); err != nil {
		t.Fatalf("simulating external write failed: %v", err)
	}

	// Try to write our un-merged edit based on old baseline
	myEdit := []byte("Version 1 (User local changes)")
	_, err = SafeWrite(target, myEdit, baseline, nil)
	if err == nil {
		t.Fatalf("expected ConflictError, got nil")
	}

	if !errors.Is(err, ErrConflict) {
		t.Fatalf("expected ErrConflict, got: %v", err)
	}

	// Disk file MUST NOT be overwritten
	diskContent, _ := os.ReadFile(target)
	if string(diskContent) != string(externalEdit) {
		t.Fatalf("file was overwritten despite conflict! got %q", diskContent)
	}
}

func TestWriteTrackerSuppression(t *testing.T) {
	tracker := NewWriteTracker(0)
	target := "/test/path/note.md"
	hash := ComputeContentHash([]byte("hello"))

	if tracker.IsInternalWrite(target, hash) {
		t.Fatalf("should not be internal before marking")
	}

	tracker.MarkInternalWrite(target, hash)

	if !tracker.IsInternalWrite(target, hash) {
		t.Fatalf("should be internal right after marking")
	}

	// Second check should be consumed
	if tracker.IsInternalWrite(target, hash) {
		t.Fatalf("internal write should have been consumed")
	}
}
