package app

import (
	"os"
	"path/filepath"
	"strings"
	"testing"

	"pata/internal/storage/markdown"
)

func TestAcceptance_NotesDrafts_Lifecycle(t *testing.T) {
	tmpDir, err := os.MkdirTemp("", "pata-notes-drafts-*")
	if err != nil {
		t.Fatal(err)
	}
	defer os.RemoveAll(tmpDir)

	svc := NewVaultService()
	_, err = svc.openVault(tmpDir)
	if err != nil {
		t.Fatalf("failed to open vault: %v", err)
	}
	defer func() {
		if svc.stopWatcher != nil {
			svc.stopWatcher()
		}
	}()

	// 1. Create a draft note with title passed (should be ignored and forced empty)
	draft, err := svc.CreateNote(CreateNoteInput{
		Draft: true,
		Title: "试图作为草稿标题的内容",
		Body:  "这是正在编写的第一条草稿正文，包含重要想法。",
	})
	if err != nil {
		t.Fatalf("CreateNote draft failed: %v", err)
	}
	if !draft.Draft {
		t.Fatalf("expected draft.Draft to be true, got false")
	}
	if draft.Title != "" {
		t.Fatalf("expected empty title for draft, got %q", draft.Title)
	}

	// Verify file path on disk: should be notes/<id>.md
	draftPath := filepath.Join(tmpDir, "notes", draft.ID+".md")
	contentBytes, err := os.ReadFile(draftPath)
	if err != nil {
		t.Fatalf("expected draft file at %s, read err: %v", draftPath, err)
	}
	contentStr := string(contentBytes)
	if !strings.Contains(contentStr, "draft: true") {
		t.Fatalf("expected 'draft: true' in frontmatter, got:\n%s", contentStr)
	}
	if strings.Contains(contentStr, "title:") {
		t.Fatalf("expected no 'title:' in draft frontmatter, got:\n%s", contentStr)
	}

	// 2. Verify ListNotes includes the draft
	notes, err := svc.ListNotes()
	if err != nil {
		t.Fatalf("ListNotes failed: %v", err)
	}
	var foundDraft *markdown.Note
	for _, n := range notes {
		if n.ID == draft.ID {
			foundDraft = n
			break
		}
	}
	if foundDraft == nil || !foundDraft.Draft {
		t.Fatalf("expected draft note in ListNotes, got %v", foundDraft)
	}

	// 3. Verify ListNoteRefs EXCLUDES the draft
	refs, err := svc.ListNoteRefs()
	if err != nil {
		t.Fatalf("ListNoteRefs failed: %v", err)
	}
	for _, ref := range refs {
		if ref.ID == draft.ID {
			t.Fatalf("draft note MUST NOT be returned in ListNoteRefs")
		}
	}

	// 4. Verify tag overview does not include drafts
	tagOverview, err := svc.GetTagOverview()
	if err != nil {
		t.Fatalf("GetTagOverview failed: %v", err)
	}
	for _, s := range tagOverview {
		if s.NoteCount > 0 {
			t.Fatalf("drafts must not contribute to tag counts, got %v", s)
		}
	}

	// 5. Verify SearchAll finds the draft by body snippet
	searchResults := svc.vault.Index.SearchAll("第一条草稿")
	if len(searchResults) == 0 {
		t.Fatalf("SearchAll expected to find draft by body query, got 0 results")
	}
	if searchResults[0].ID != draft.ID {
		t.Fatalf("expected search result to match draft ID, got %s", searchResults[0].ID)
	}

	// 6. Update draft body while keeping it a draft (empty title)
	fDraft := false
	tDraft := true
	updatedDraft, err := svc.UpdateNote(UpdateNoteInput{
		ID:    draft.ID,
		Draft: &tDraft,
		Title: "",
		Body:  "草稿更新了第二段内容。",
	})
	if err != nil {
		t.Fatalf("UpdateNote on draft failed: %v", err)
	}
	if !updatedDraft.Draft || updatedDraft.Title != "" {
		t.Fatalf("updated draft should remain draft with empty title, got draft=%v title=%q", updatedDraft.Draft, updatedDraft.Title)
	}

	// 7. Converting draft to formal note without title must fail
	_, err = svc.UpdateNote(UpdateNoteInput{
		ID:    draft.ID,
		Draft: &fDraft,
		Title: "   ",
		Body:  updatedDraft.Body,
	})
	if err == nil {
		t.Fatalf("converting draft with empty title must fail, got nil err")
	}

	// 8. Convert draft to formal note with valid title and tags
	formalTitle := "正式笔记方案"
	formalTags := []string{"架构", "设计"}
	converted, err := svc.UpdateNote(UpdateNoteInput{
		ID:    draft.ID,
		Draft: &fDraft,
		Title: formalTitle,
		Tags:  formalTags,
		Body:  updatedDraft.Body,
	})
	if err != nil {
		t.Fatalf("converting draft to formal note failed: %v", err)
	}
	if converted.Draft {
		t.Fatalf("expected converted note Draft to be false")
	}
	if converted.Title != formalTitle {
		t.Fatalf("expected title %q, got %q", formalTitle, converted.Title)
	}
	if converted.ID != draft.ID {
		t.Fatalf("expected converted note to retain original ID %s, got %s", draft.ID, converted.ID)
	}

	// Invariant: file path MUST NOT change after conversion
	contentBytesAfter, err := os.ReadFile(draftPath)
	if err != nil {
		t.Fatalf("expected converted note to remain at original path %s: %v", draftPath, err)
	}
	contentStrAfter := string(contentBytesAfter)
	if strings.Contains(contentStrAfter, "draft:") {
		t.Fatalf("draft field must be omitted after conversion to formal note, got:\n%s", contentStrAfter)
	}
	if !strings.Contains(contentStrAfter, "title: 正式笔记方案") {
		t.Fatalf("title must be present in converted note frontmatter, got:\n%s", contentStrAfter)
	}

	// 9. Converted note MUST now appear in ListNoteRefs
	refsAfter, err := svc.ListNoteRefs()
	if err != nil {
		t.Fatalf("ListNoteRefs after conversion failed: %v", err)
	}
	foundInRefs := false
	for _, ref := range refsAfter {
		if ref.ID == draft.ID {
			foundInRefs = true
			if ref.Title != formalTitle {
				t.Fatalf("expected ref title %q, got %q", formalTitle, ref.Title)
			}
			break
		}
	}
	if !foundInRefs {
		t.Fatalf("converted formal note must appear in ListNoteRefs")
	}

	// 10. Reverting formal note back to draft MUST fail
	_, err = svc.UpdateNote(UpdateNoteInput{
		ID:    draft.ID,
		Draft: &tDraft,
		Title: formalTitle,
		Body:  converted.Body,
	})
	if err == nil {
		t.Fatalf("reverting formal note back to draft must fail, got nil err")
	}
	if !strings.Contains(err.Error(), "正式笔记不可退回为草稿") {
		t.Fatalf("expected error message to contain '正式笔记不可退回为草稿', got: %v", err)
	}

	// 11. Creating formal note without title must fail
	_, err = svc.CreateNote(CreateNoteInput{
		Draft: false,
		Title: "",
		Body:  "普通笔记",
	})
	if err == nil {
		t.Fatalf("creating formal note without title must fail, got nil err")
	}
}
