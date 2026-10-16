package markdown

import (
	"strings"
	"testing"
	"time"
)

func TestGenerateULID(t *testing.T) {
	id1 := GenerateULID()
	time.Sleep(2 * time.Millisecond)
	id2 := GenerateULID()

	if len(id1) != 26 || len(id2) != 26 {
		t.Fatalf("expected ULID length 26, got %d and %d", len(id1), len(id2))
	}
	if id1 >= id2 {
		t.Fatalf("expected ULID monotonic order, got %s >= %s", id1, id2)
	}

	taskID := GenerateEntityID(EntityTypeTask)
	if !strings.HasPrefix(taskID, "t-") {
		t.Fatalf("expected prefix 't-', got %s", taskID)
	}

	actID := GenerateEntityID(EntityTypeActivity)
	if !strings.HasPrefix(actID, "a-") {
		t.Fatalf("expected prefix 'a-', got %s", actID)
	}

	noteID := GenerateEntityID(EntityTypeNote)
	if !strings.HasPrefix(noteID, "n-") {
		t.Fatalf("expected prefix 'n-', got %s", noteID)
	}
}

func TestSanitizeSlug(t *testing.T) {
	tests := []struct {
		input    string
		expected string
	}{
		{"统一资源接入方案", "统一资源接入方案"},
		{"Flink SQL POC / Testing: v1.0?", "Flink-SQL-POC-Testing-v1.0"},
		{"  Hello   World!  ", "Hello-World!"},
		{"///:::***", "untitled"},
		{"🚀 高性能 Rust & Go 测试", "🚀-高性能-Rust-Go-测试"},
	}

	for _, tc := range tests {
		got := SanitizeSlug(tc.input)
		// check if forbidden chars were stripped
		if strings.ContainsAny(got, "/\\:*?\"<>|") {
			t.Errorf("SanitizeSlug(%q) contains forbidden chars: %q", tc.input, got)
		}
		if got == "" {
			t.Errorf("SanitizeSlug(%q) returned empty string", tc.input)
		}
	}
}
