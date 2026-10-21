package app

import (
	"fmt"
	"path/filepath"
	"sort"
	"strings"

	"pata/internal/storage/markdown"
)

// cleanTags normalizes and deduplicates tags case-insensitively,
// stripping leading '#' characters, trimming spaces, and preserving the first display casing.
// Commas inside tags are kept as valid characters.
func cleanTags(in []string) []string {
	var out []string
	seen := make(map[string]struct{})
	for _, raw := range in {
		trimmed := strings.TrimSpace(raw)
		cleaned := strings.TrimSpace(strings.TrimLeft(trimmed, "#"))
		if cleaned == "" {
			continue
		}
		key := strings.ToLower(cleaned)
		if _, ok := seen[key]; ok {
			continue
		}
		seen[key] = struct{}{}
		out = append(out, cleaned)
	}
	return out
}

// GetTagOverview returns aggregated counts of all unique tags across tasks, notes, and activities.
func (s *VaultService) GetTagOverview() ([]markdown.TagOverviewItem, error) {
	s.mu.Lock()
	v := s.vault
	s.mu.Unlock()
	if v == nil {
		return nil, fmt.Errorf("尚未打开 Vault")
	}

	return v.Index.TagOverview(), nil
}

// ListByTag returns all entities matching the specified tag.
// For Activities, tag matching checks act.Tags ∪ parentTask.Tags (for task activities).
func (s *VaultService) ListByTag(tag string) ([]markdown.EntityRef, error) {
	s.mu.Lock()
	v := s.vault
	s.mu.Unlock()
	if v == nil {
		return nil, fmt.Errorf("尚未打开 Vault")
	}

	trimmed := strings.TrimSpace(tag)
	if trimmed == "" {
		return []markdown.EntityRef{}, nil
	}

	refs := v.Index.FindByTag(trimmed)
	result := make([]markdown.EntityRef, len(refs))
	copy(result, refs)

	sort.SliceStable(result, func(i, j int) bool {
		if !result[i].Time.Equal(result[j].Time) {
			return result[i].Time.After(result[j].Time)
		}
		if result[i].Type != result[j].Type {
			return result[i].Type < result[j].Type
		}
		return result[i].ID < result[j].ID
	})

	return result, nil
}

// ListAllEntities returns all entities matching no tag filter, sorted chronologically descending.
func (s *VaultService) ListAllEntities() ([]markdown.EntityRef, error) {
	s.mu.Lock()
	v := s.vault
	s.mu.Unlock()
	if v == nil {
		return nil, fmt.Errorf("尚未打开 Vault")
	}

	refs := v.Index.FindAll()
	result := make([]markdown.EntityRef, len(refs))
	copy(result, refs)

	sort.SliceStable(result, func(i, j int) bool {
		if !result[i].Time.Equal(result[j].Time) {
			return result[i].Time.After(result[j].Time)
		}
		if result[i].Type != result[j].Type {
			return result[i].Type < result[j].Type
		}
		return result[i].ID < result[j].ID
	})

	return result, nil
}

// SearchAll 按任务、笔记、草稿、记录、附件分组，执行不区分大小写的文字搜索。
func (s *VaultService) SearchAll(query string) ([]markdown.SearchResultItem, error) {
	s.draftMu.Lock()
	defer s.draftMu.Unlock()
	s.mu.Lock()
	v := s.vault
	s.mu.Unlock()
	if v == nil {
		return nil, fmt.Errorf("尚未打开 Vault")
	}

	query = strings.TrimSpace(query)
	results := v.Index.SearchAll(query)
	if query == "" {
		return results, nil
	}
	drafts, err := readDrafts(v, true)
	if err != nil {
		return nil, err
	}
	lowerQuery := strings.ToLower(query)
	draftResults := make([]markdown.SearchResultItem, 0)
	for _, draft := range drafts {
		if !strings.Contains(strings.ToLower(draft.Body), lowerQuery) && !strings.Contains(strings.ToLower(draft.Title), lowerQuery) {
			continue
		}
		snippet := markdown.SearchSnippet(draft.Body, query)
		if snippet == draft.Title {
			_, body, _ := strings.Cut(strings.TrimSpace(draft.Body), "\n")
			snippet = markdown.SearchSnippet(body, query)
		}
		draftResults = append(draftResults, markdown.SearchResultItem{
			Type: markdown.EntityTypeDraft, ID: draft.ID, Title: draft.Title,
			Snippet: snippet,
			Path:    filepath.Join(v.RootPath, "drafts", draft.ID+".md"),
		})
	}
	split := len(results)
	for i, result := range results {
		if result.Type == markdown.EntityTypeActivity || result.Type == markdown.EntityTypeFile {
			split = i
			break
		}
	}
	merged := make([]markdown.SearchResultItem, 0, len(results)+len(draftResults))
	merged = append(merged, results[:split]...)
	merged = append(merged, draftResults...)
	return append(merged, results[split:]...), nil
}
