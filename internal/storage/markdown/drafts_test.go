package markdown

import (
	"strings"
	"testing"
	"time"
)

func TestDraftNote_SchemaAndSerialization(t *testing.T) {
	now := time.Now()
	// Draft note with empty title and no tags is valid
	draftNote := &Note{
		Type:      EntityTypeNote,
		ID:        "n-01drafttest",
		Draft:     true,
		Title:     "",
		CreatedAt: now,
		UpdatedAt: now,
		Body:      "草稿内容",
	}

	if err := ValidateEntity("notes/n-01drafttest.md", draftNote); err != nil {
		t.Fatalf("expected draftNote to pass validation, got: %v", err)
	}

	data, err := SerializeMarkdown(draftNote)
	if err != nil {
		t.Fatalf("SerializeMarkdown failed: %v", err)
	}

	dataStr := string(data)
	if !strings.Contains(dataStr, "draft: true") {
		t.Fatalf("expected serialized markdown to contain 'draft: true', got:\n%s", dataStr)
	}

	// Parse back
	parsed, err := ParseMarkdown("notes/n-01drafttest.md", data)
	if err != nil {
		t.Fatalf("ParseMarkdown failed: %v", err)
	}
	parsedNote, ok := parsed.(*Note)
	if !ok {
		t.Fatalf("expected *Note, got %T", parsed)
	}
	if !parsedNote.Draft {
		t.Fatalf("expected parsedNote.Draft to be true")
	}
	if parsedNote.Title != "" {
		t.Fatalf("expected empty title, got %q", parsedNote.Title)
	}
	if strings.TrimSpace(parsedNote.Body) != "草稿内容" {
		t.Fatalf("expected body %q, got %q", "草稿内容", parsedNote.Body)
	}

	// Formal note with empty title MUST fail validation
	formalInvalid := &Note{
		Type:      EntityTypeNote,
		ID:        "n-01formaltest",
		Draft:     false,
		Title:     "",
		CreatedAt: now,
		UpdatedAt: now,
		Body:      "正式笔记内容",
	}
	if err := ValidateEntity("notes/n-01formaltest.md", formalInvalid); err == nil {
		t.Fatalf("expected formal note with empty title to fail validation")
	}
}

func TestDraftNote_FilenameFormatting(t *testing.T) {
	draftWithTitle := &Note{
		Type:  EntityTypeNote,
		ID:    "n-0123456789",
		Draft: true,
		Title: "试图指定标题的草稿",
	}
	if fn := FormatEntityFilename(draftWithTitle); fn != "n-0123456789.md" {
		t.Fatalf("expected draft filename 'n-0123456789.md', got %q", fn)
	}

	formal := &Note{
		Type:  EntityTypeNote,
		ID:    "n-0123456789",
		Draft: false,
		Title: "测试笔记",
	}
	if fn := FormatEntityFilename(formal); fn != "测试笔记_n-0123456789.md" {
		t.Fatalf("expected filename '测试笔记_n-0123456789.md', got %q", fn)
	}
}

func TestDraftNote_ListNotesSorting(t *testing.T) {
	idx := NewMemoryIndex()
	t1 := time.Date(2026, 10, 26, 10, 0, 0, 0, time.UTC)
	t2 := time.Date(2026, 10, 26, 11, 0, 0, 0, time.UTC)

	n1 := &Note{
		Type:      EntityTypeNote,
		ID:        "n-01",
		Draft:     true,
		UpdatedAt: t1,
		CreatedAt: t1,
	}
	n2 := &Note{
		Type:      EntityTypeNote,
		ID:        "n-02",
		Draft:     false,
		Title:     "笔记2",
		UpdatedAt: t2,
		CreatedAt: t2,
	}
	idx.notes["n-01"] = n1
	idx.notes["n-02"] = n2

	list := idx.ListNotes()
	if len(list) != 2 {
		t.Fatalf("expected 2 notes, got %d", len(list))
	}
	if list[0].ID != "n-02" || list[1].ID != "n-01" {
		t.Fatalf("expected order [n-02, n-01], got [%s, %s]", list[0].ID, list[1].ID)
	}
}
