package app

import (
	"encoding/json"
	"fmt"
	"net"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"testing"

	"pata/internal/keychain"
)

func openDraftIntegrationVault(t *testing.T) *VaultService {
	t.Helper()
	s := &VaultService{keychain: keychain.NewMemoryStore(), configPath: filepath.Join(t.TempDir(), "vault.json")}
	if _, err := s.openVault(t.TempDir()); err != nil {
		t.Fatal(err)
	}
	if err := s.saveConfig(VaultConfig{VaultPath: s.vault.RootPath}); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		if s.stopWatcher != nil {
			s.stopWatcher()
		}
	})
	return s
}

func TestDraftIntegrationPersistenceAndNotesIsolation(t *testing.T) {
	s := openDraftIntegrationVault(t)
	root := s.vault.RootPath
	note, err := s.CreateNote(CreateNoteInput{Title: "普通笔记保持原样", Body: "原有笔记正文\n"})
	if err != nil {
		t.Fatal(err)
	}
	notePath := s.vault.ResolveEntityPath(note)
	before, err := os.ReadFile(notePath)
	if err != nil {
		t.Fatal(err)
	}
	draft, err := s.CreateDraft(root)
	if err != nil {
		t.Fatal(err)
	}
	body := "草稿标题\n中文、$&、反斜线\\、空行均保留。\n\n"
	saved, err := s.SaveDraft(SaveDraftInput{VaultPath: root, ID: draft.ID, Version: draft.Version, Body: body})
	if err != nil {
		t.Fatal(err)
	}
	second, err := s.CreateDraft(root)
	if err != nil || second.ID == draft.ID {
		t.Fatalf("多篇草稿创建失败: %v", err)
	}
	if _, err := s.openVault(root); err != nil {
		t.Fatal(err)
	}
	loaded, err := s.GetDraft(root, draft.ID)
	if err != nil || loaded.Body != body || loaded.Version != saved.Version {
		t.Fatalf("重新打开未恢复原文: %+v %v", loaded, err)
	}
	list, err := s.ListDrafts(root)
	if err != nil || len(list) != 2 {
		t.Fatalf("草稿列表: %+v %v", list, err)
	}
	data, err := os.ReadFile(filepath.Join(root, "drafts", draft.ID+".md"))
	if err != nil || string(data) != body {
		t.Fatal("草稿文件必须只包含原文")
	}
	if err := s.RescanVault(); err != nil {
		t.Fatal(err)
	}
	notes, err := s.ListNotes()
	if err != nil || len(notes) != 1 || notes[0].ID != note.ID {
		t.Fatal("草稿混入 Notes")
	}
	after, err := os.ReadFile(notePath)
	if err != nil || string(before) != string(after) {
		t.Fatal("原有 Note 文件被修改")
	}
}

func TestDraftIntegrationConflictConcurrentWritersAndDeletion(t *testing.T) {
	s := openDraftIntegrationVault(t)
	root := s.vault.RootPath
	draft, err := s.CreateDraft(root)
	if err != nil {
		t.Fatal(err)
	}
	start := make(chan struct{})
	results := make(chan error, 2)
	var group sync.WaitGroup
	for _, body := range []string{"编辑者甲", "编辑者乙"} {
		group.Add(1)
		go func(body string) {
			defer group.Done()
			<-start
			_, err := s.SaveDraft(SaveDraftInput{VaultPath: root, ID: draft.ID, Version: draft.Version, Body: body})
			results <- err
		}(body)
	}
	close(start)
	group.Wait()
	close(results)
	success, conflicts := 0, 0
	for err := range results {
		if err == nil {
			success++
		} else if strings.Contains(err.Error(), "冲突") {
			conflicts++
		} else {
			t.Fatal(err)
		}
	}
	if success != 1 || conflicts != 1 {
		t.Fatalf("并发保存结果: 成功 %d，冲突 %d", success, conflicts)
	}
	loaded, err := s.GetDraft(root, draft.ID)
	if err != nil {
		t.Fatal(err)
	}
	path := filepath.Join(root, "drafts", draft.ID+".md")
	if err := os.WriteFile(path, []byte("外部编辑的内容"), 0600); err != nil {
		t.Fatal(err)
	}
	if _, err := s.SaveDraft(SaveDraftInput{VaultPath: root, ID: draft.ID, Version: loaded.Version, Body: "过期编辑"}); err == nil {
		t.Fatal("过期保存未被阻止")
	}
	data, err := os.ReadFile(path)
	if err != nil || string(data) != "外部编辑的内容" {
		t.Fatal("覆盖了外部内容")
	}
	if err := os.Remove(path); err != nil {
		t.Fatal(err)
	}
	if _, err := s.SaveDraft(SaveDraftInput{VaultPath: root, ID: draft.ID, Version: loaded.Version, Body: "重新出现"}); err == nil {
		t.Fatal("外部删除后不应重新创建")
	}
	if _, err := os.Stat(path); !os.IsNotExist(err) {
		t.Fatal("已删除文件被重新创建")
	}
}

func TestDraftIntegrationDelete(t *testing.T) {
	s := openDraftIntegrationVault(t)
	root := s.vault.RootPath
	note, err := s.CreateNote(CreateNoteInput{Title: "保留笔记", Body: "笔记正文"})
	if err != nil {
		t.Fatal(err)
	}
	notePath := s.vault.ResolveEntityPath(note)
	noteBefore, err := os.ReadFile(notePath)
	if err != nil {
		t.Fatal(err)
	}
	first, err := s.CreateDraft(root)
	if err != nil {
		t.Fatal(err)
	}
	second, err := s.CreateDraft(root)
	if err != nil {
		t.Fatal(err)
	}
	saved, err := s.SaveDraft(SaveDraftInput{VaultPath: root, ID: first.ID, Version: first.Version, Body: "已保存的草稿"})
	if err != nil {
		t.Fatal(err)
	}
	if err := s.DeleteDraft(root, first.ID, first.Version); err == nil || !strings.Contains(err.Error(), "冲突") {
		t.Fatal("旧版本不应删除新内容")
	}
	if err := s.DeleteDraft(root, first.ID, saved.Version); err != nil {
		t.Fatal(err)
	}
	if _, err := s.GetDraft(root, first.ID); err == nil {
		t.Fatal("已删除草稿仍可读取")
	}
	if err := s.DeleteDraft(root, first.ID, saved.Version); err != nil {
		t.Fatal("重复删除应保持成功")
	}
	if _, err := s.SaveDraft(SaveDraftInput{VaultPath: root, ID: first.ID, Version: saved.Version, Body: "延迟保存"}); err == nil {
		t.Fatal("延迟保存不应重新创建已删除草稿")
	}
	if _, err := os.Stat(filepath.Join(root, "drafts", first.ID+".md")); !os.IsNotExist(err) {
		t.Fatal("删除后草稿文件仍存在")
	}
	if err := s.RescanVault(); err != nil {
		t.Fatal(err)
	}
	list, err := s.ListDrafts(root)
	if err != nil || len(list) != 1 || list[0].ID != second.ID {
		t.Fatal("删除影响了其他草稿")
	}
	noteAfter, err := os.ReadFile(notePath)
	if err != nil || string(noteBefore) != string(noteAfter) {
		t.Fatal("删除草稿影响了普通笔记")
	}
	path := filepath.Join(root, "drafts", second.ID+".md")
	if err := os.WriteFile(path, []byte("外部编辑内容"), 0600); err != nil {
		t.Fatal(err)
	}
	if err := s.DeleteDraft(root, second.ID, second.Version); err == nil {
		t.Fatal("不应删除外部更新的文件")
	}
	data, err := os.ReadFile(path)
	if err != nil || string(data) != "外部编辑内容" {
		t.Fatal("外部更新未保留")
	}
}

func TestDraftIntegrationVaultScopeAndPathBoundary(t *testing.T) {
	s := openDraftIntegrationVault(t)
	root := s.vault.RootPath
	if _, err := s.GetDraft(root, "../../notes/test"); err == nil {
		t.Fatal("接受了非法 ID")
	}
	if err := s.DeleteDraft(root, "../../notes/test", "invalid"); err == nil {
		t.Fatal("删除应拒绝越界 ID")
	}
	if _, err := s.CreateDraft(""); err == nil {
		t.Fatal("接受了未限定 Vault 的创建")
	}
	draft, err := s.CreateDraft(root)
	if err != nil {
		t.Fatal(err)
	}
	path := filepath.Join(root, "drafts", draft.ID+".md")
	if err := os.Remove(path); err != nil {
		t.Fatal(err)
	}
	outside := filepath.Join(t.TempDir(), "outside.md")
	if err := os.WriteFile(outside, []byte("外部文件"), 0600); err != nil {
		t.Fatal(err)
	}
	if err := os.Symlink(outside, path); err != nil {
		t.Fatal(err)
	}
	if _, err := s.GetDraft(root, draft.ID); err == nil {
		t.Fatal("读取了链接目标")
	}
	if _, err := s.SaveDraft(SaveDraftInput{VaultPath: root, ID: draft.ID, Version: draft.Version, Body: "覆盖"}); err == nil {
		t.Fatal("写入了链接路径")
	}
	if err := s.DeleteDraft(root, draft.ID, draft.Version); err == nil {
		t.Fatal("删除应拒绝符号链接")
	}
	if _, err := s.openVault(t.TempDir()); err != nil {
		t.Fatal(err)
	}
	if _, err := s.CreateDraft(root); err == nil {
		t.Fatal("Vault 切换后仍接受旧页面请求")
	}
	if err := s.DeleteDraft(root, draft.ID, draft.Version); err == nil {
		t.Fatal("删除应拒绝旧 Vault 请求")
	}
	if err := os.Symlink(filepath.Join(s.vault.RootPath, "notes"), filepath.Join(s.vault.RootPath, "drafts")); err != nil {
		t.Fatal(err)
	}
	if _, err := s.CreateDraft(s.vault.RootPath); err == nil {
		t.Fatal("Draft 目录不应通过链接写入 Notes")
	}
}

// 仅用于浏览器集成验证：端点调用真实服务和临时 Vault，不编入产品。
func TestDraftUIIntegrationServer(t *testing.T) {
	port := os.Getenv("PATA_DRAFT_UI_PORT")
	if port == "" {
		t.Skip("未启用浏览器集成服务")
	}
	s := openDraftIntegrationVault(t)
	if _, err := s.CreateNote(CreateNoteInput{Title: "普通笔记保持原样", Body: "原有笔记正文\n"}); err != nil {
		t.Fatal(err)
	}
	if os.Getenv("PATA_SEARCH_UI") == "1" {
		seedSearchIntegrationData(t, s)
	}
	listener, err := net.Listen("tcp", "127.0.0.1:"+port)
	if err != nil {
		t.Fatal(err)
	}
	defer listener.Close()
	t.Log("Draft 浏览器集成服务已就绪")
	handler := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		var args []json.RawMessage
		if err := json.NewDecoder(r.Body).Decode(&args); err != nil {
			http.Error(w, "参数无效", 400)
			return
		}
		arg := func(index int) string {
			var value string
			if index < len(args) {
				_ = json.Unmarshal(args[index], &value)
			}
			return value
		}
		var value any = []any{}
		var callErr error
		switch strings.TrimPrefix(r.URL.Path, "/__integration/") {
		case "StopIntegration":
			go listener.Close()
		case "ExternalDraftWrite":
			var path string
			path, callErr = draftPath(s.vault, arg(0))
			if callErr == nil {
				callErr = os.WriteFile(path, []byte(arg(1)), 0600)
			}
		case "GetVaultStatus":
			value = s.GetVaultStatus()
		case "GetVaultHealth":
			value, callErr = s.GetVaultHealth()
		case "GetThemePreference":
			value, callErr = s.GetThemePreference()
		case "SetThemePreference":
			callErr = s.SetThemePreference(arg(0))
		case "GetAccentColorPreference":
			value, callErr = s.GetAccentColorPreference()
		case "SetAccentColorPreference":
			callErr = s.SetAccentColorPreference(arg(0))
		case "GetASRConfigStatus":
			value = map[string]bool{"configured": false}
		case "ListDrafts":
			value, callErr = s.ListDrafts(arg(0))
		case "CreateDraft":
			value, callErr = s.CreateDraft(arg(0))
		case "GetDraft":
			value, callErr = s.GetDraft(arg(0), arg(1))
		case "DeleteDraft":
			callErr = s.DeleteDraft(arg(0), arg(1), arg(2))
		case "SaveDraft":
			var input SaveDraftInput
			if len(args) == 0 {
				callErr = fmt.Errorf("缺少保存参数")
			} else if callErr = json.Unmarshal(args[0], &input); callErr == nil {
				value, callErr = s.SaveDraft(input)
			}
		case "ListNotes":
			value, callErr = s.ListNotes()
		case "SearchAll":
			value, callErr = s.SearchAll(arg(0))
		case "ListTasks":
			value, callErr = s.ListTasks()
		case "GetTask":
			value, callErr = s.GetTask(arg(0))
		case "GetActivity":
			value, callErr = s.GetActivity(arg(0))
		case "ListActivitiesByTask":
			value, callErr = s.ListActivitiesByTask(arg(0))
		case "ListNoteRefs":
			value, callErr = s.ListNoteRefs()
		case "GetNote":
			value, callErr = s.GetNote(arg(0))
		case "GetDayPlan":
			value, callErr = s.GetDayPlan(arg(0))
		case "GetTagOverview":
			value, callErr = s.GetTagOverview()
		case "ListFiles":
			value, callErr = s.ListFiles()
		}
		w.Header().Set("Content-Type", "application/json")
		if callErr != nil {
			w.WriteHeader(409)
			_ = json.NewEncoder(w).Encode(map[string]string{"error": callErr.Error()})
			return
		}
		_ = json.NewEncoder(w).Encode(value)
	})
	if err := http.Serve(listener, handler); err != nil && !strings.Contains(err.Error(), "closed") {
		t.Fatal(err)
	}
}
