package app

import (
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"regexp"
	"sort"
	"strings"
	"time"
	"unicode/utf8"

	"pata/internal/storage/markdown"
)

// Draft 为独立文本草稿；磁盘仅保存原文，列表属性从文件名、首行和修改时间得到。
type Draft struct {
	ID        string    `json:"id"`
	Title     string    `json:"title"`
	Body      string    `json:"body"`
	Version   string    `json:"version"`
	UpdatedAt time.Time `json:"updated_at"`
}

type SaveDraftInput struct {
	VaultPath string `json:"vault_path"`
	ID        string `json:"id"`
	Version   string `json:"version"`
	Body      string `json:"body"`
}

var draftIDPattern = regexp.MustCompile(`^d-[0-9a-hjkmnp-tv-z]{26}$`)

func (s *VaultService) draftVault(expectedRoot string) (*markdown.Vault, error) {
	s.mu.Lock()
	v := s.vault
	s.mu.Unlock()
	if v == nil {
		return nil, fmt.Errorf("尚未打开 Vault")
	}
	if expectedRoot == "" || filepath.Clean(expectedRoot) != filepath.Clean(v.RootPath) {
		return nil, fmt.Errorf("Vault 已更换，请重新打开 Draft")
	}
	return v, nil
}

func draftPath(v *markdown.Vault, id string) (string, error) {
	if id != "" && !draftIDPattern.MatchString(id) {
		return "", fmt.Errorf("草稿 ID 无效")
	}
	rel := "drafts"
	if id != "" {
		rel += "/" + id + ".md"
	}
	abs, _, err := markdown.SafeResolveVaultPath(v.RootPath, rel)
	if err != nil {
		return "", fmt.Errorf("草稿路径无效")
	}
	for _, path := range []string{filepath.Join(v.RootPath, "drafts"), abs} {
		info, statErr := os.Lstat(path)
		if statErr != nil && !os.IsNotExist(statErr) {
			return "", fmt.Errorf("无法检查草稿路径")
		}
		if info != nil && info.Mode()&os.ModeSymlink != 0 {
			return "", fmt.Errorf("草稿路径不能使用符号链接")
		}
	}
	return abs, nil
}

func readDraft(v *markdown.Vault, id string) (*Draft, error) {
	path, err := draftPath(v, id)
	if err != nil {
		return nil, err
	}
	baseline, data, err := markdown.ReadBaseline(path)
	if err != nil {
		return nil, fmt.Errorf("无法读取草稿 %s", id)
	}
	if !utf8.Valid(data) {
		return nil, fmt.Errorf("草稿 %s 不是有效的 UTF-8 文本", id)
	}
	title := "未命名草稿"
	for _, line := range strings.Split(string(data), "\n") {
		if text := strings.TrimSpace(line); text != "" {
			runes := []rune(text)
			if len(runes) > 60 {
				text = string(runes[:60]) + "…"
			}
			title = text
			break
		}
	}
	return &Draft{ID: id, Title: title, Body: string(data), Version: baseline.Hash, UpdatedAt: baseline.ModTime}, nil
}

// ListDrafts 仅列出 drafts/ 中由应用管理的文本，不进入 Notes 索引。
func (s *VaultService) ListDrafts(vaultPath string) ([]*Draft, error) {
	s.draftMu.Lock()
	defer s.draftMu.Unlock()
	v, err := s.draftVault(vaultPath)
	if err != nil {
		return nil, err
	}
	dir, err := draftPath(v, "")
	if err != nil {
		return nil, err
	}
	entries, err := os.ReadDir(dir)
	if os.IsNotExist(err) {
		return []*Draft{}, nil
	}
	if err != nil {
		return nil, fmt.Errorf("无法读取草稿列表")
	}
	drafts := []*Draft{}
	for _, entry := range entries {
		id := strings.TrimSuffix(entry.Name(), ".md")
		if entry.IsDir() || !strings.HasSuffix(entry.Name(), ".md") || !draftIDPattern.MatchString(id) {
			continue
		}
		draft, err := readDraft(v, id)
		if err != nil {
			return nil, err
		}
		draft.Body = ""
		drafts = append(drafts, draft)
	}
	sort.Slice(drafts, func(i, j int) bool {
		if drafts[i].UpdatedAt.Equal(drafts[j].UpdatedAt) {
			return drafts[i].ID > drafts[j].ID
		}
		return drafts[i].UpdatedAt.After(drafts[j].UpdatedAt)
	})
	return drafts, nil
}

func (s *VaultService) GetDraft(vaultPath, id string) (*Draft, error) {
	s.draftMu.Lock()
	defer s.draftMu.Unlock()
	v, err := s.draftVault(vaultPath)
	if err != nil {
		return nil, err
	}
	if id == "" {
		return nil, fmt.Errorf("草稿 ID 不能为空")
	}
	return readDraft(v, id)
}

func (s *VaultService) CreateDraft(vaultPath string) (*Draft, error) {
	s.draftMu.Lock()
	defer s.draftMu.Unlock()
	v, err := s.draftVault(vaultPath)
	if err != nil {
		return nil, err
	}
	id := "d-" + strings.ToLower(markdown.GenerateULID())
	path, err := draftPath(v, id)
	if err != nil {
		return nil, err
	}
	if _, err := markdown.SafeWriteExclusive(path, []byte{}, v.Tracker); err != nil {
		return nil, fmt.Errorf("无法创建草稿")
	}
	return readDraft(v, id)
}

// SaveDraft 比较客户端读取的版本，避免重扫或另一编辑者更新后覆盖内容。
func (s *VaultService) SaveDraft(input SaveDraftInput) (*Draft, error) {
	s.draftMu.Lock()
	defer s.draftMu.Unlock()
	v, err := s.draftVault(input.VaultPath)
	if err != nil {
		return nil, err
	}
	if input.ID == "" || input.Version == "" || !utf8.ValidString(input.Body) {
		return nil, fmt.Errorf("草稿 ID、版本或正文无效")
	}
	path, err := draftPath(v, input.ID)
	if err != nil {
		return nil, err
	}
	_, err = markdown.SafeWrite(path, []byte(input.Body), &markdown.FileBaseline{Hash: input.Version}, v.Tracker)
	if err != nil {
		if errors.Is(err, markdown.ErrConflict) {
			return nil, fmt.Errorf("草稿保存冲突：文件已被修改或删除，请先复制当前内容再重新加载")
		}
		return nil, fmt.Errorf("草稿保存失败")
	}
	return readDraft(v, input.ID)
}

// DeleteDraft 检查客户端版本后删除原文；已删除的草稿不会被重复删除或重新创建。
func (s *VaultService) DeleteDraft(vaultPath, id, version string) error {
	s.draftMu.Lock()
	defer s.draftMu.Unlock()
	v, err := s.draftVault(vaultPath)
	if err != nil {
		return err
	}
	if id == "" || version == "" {
		return fmt.Errorf("草稿 ID 或版本无效")
	}
	path, err := draftPath(v, id)
	if err != nil {
		return err
	}
	baseline, _, err := markdown.ReadBaseline(path)
	if os.IsNotExist(err) {
		return nil
	}
	if err != nil {
		return fmt.Errorf("无法读取待删除草稿")
	}
	if baseline.Hash != version {
		return fmt.Errorf("草稿删除冲突：文件已被修改，请重新打开草稿后再删除")
	}
	if err := os.Remove(path); err != nil && !os.IsNotExist(err) {
		return fmt.Errorf("草稿删除失败")
	}
	return nil
}
