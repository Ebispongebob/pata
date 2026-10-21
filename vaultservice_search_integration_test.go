package main

import (
	"encoding/base64"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"pata/internal/storage/markdown"
)

type searchIntegrationData struct {
	taskID, noteID, draftID, activityID, fileID string
}

func seedSearchIntegrationData(t *testing.T, s *VaultService) searchIntegrationData {
	t.Helper()
	task, err := s.CreateTask(CreateTaskInput{Title: "检索示例·任务", Description: "任务独有正文 MiXeD"})
	if err != nil {
		t.Fatal(err)
	}
	note, err := s.CreateNote(CreateNoteInput{Title: "检索示例·笔记", Body: "笔记独有正文 MiXeD"})
	if err != nil {
		t.Fatal(err)
	}
	draft, err := s.CreateDraft(s.vault.RootPath)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := s.SaveDraft(SaveDraftInput{VaultPath: s.vault.RootPath, ID: draft.ID, Version: draft.Version, Body: "检索示例·草稿\n草稿独有正文 MiXeD\n[literal]*"}); err != nil {
		t.Fatal(err)
	}
	activity, err := s.CreateActivity(CreateActivityInput{OwnerType: markdown.EntityTypeTask, TaskID: task.ID, Body: "检索示例·记录"})
	if err != nil {
		t.Fatal(err)
	}
	file, err := s.ImportFileData("检索示例.txt", base64.StdEncoding.EncodeToString([]byte("附件原文")))
	if err != nil {
		t.Fatal(err)
	}
	return searchIntegrationData{task.ID, note.ID, draft.ID, activity.ID, file.Path}
}

func TestSearchIntegrationAllTypesAndContent(t *testing.T) {
	s := openDraftIntegrationVault(t)
	data := seedSearchIntegrationData(t, s)
	results, err := s.SearchAll("检索示例")
	if err != nil {
		t.Fatal(err)
	}
	wantTypes := []markdown.EntityType{markdown.EntityTypeTask, markdown.EntityTypeNote, markdown.EntityTypeDraft, markdown.EntityTypeActivity, markdown.EntityTypeFile}
	wantIDs := []string{data.taskID, data.noteID, data.draftID, data.activityID, data.fileID}
	if len(results) != len(wantTypes) {
		t.Fatalf("应返回五类结果，实际 %d 条", len(results))
	}
	for i, result := range results {
		if result.Type != wantTypes[i] || result.ID != wantIDs[i] {
			t.Fatalf("第 %d 项类型或身份不正确", i)
		}
	}
	if results[2].Snippet == results[2].Title || !strings.Contains(results[2].Snippet, "草稿独有正文") {
		t.Fatal("草稿片段应展示后续正文，不重复首行标题")
	}
	for query, id := range map[string]string{"任务独有正文": data.taskID, "笔记独有正文": data.noteID, "草稿独有正文": data.draftID, "[literal]*": data.draftID} {
		items, err := s.SearchAll(query)
		if err != nil || len(items) != 1 || items[0].ID != id || !strings.Contains(items[0].Snippet, query) {
			t.Fatalf("正文查询 %q 未正确返回片段", query)
		}
	}
	items, err := s.SearchAll("  mixed  ")
	if err != nil || len(items) != 3 {
		t.Fatal("应忽略大小写和查询两端空白")
	}
	for _, query := range []string{"", " \n\t ", "不会命中的内容"} {
		items, err := s.SearchAll(query)
		if err != nil || len(items) != 0 {
			t.Fatal("空查询或无匹配查询不应返回结果")
		}
	}
	notes, err := s.ListNotes()
	if err != nil || len(notes) != 1 || notes[0].ID != data.noteID {
		t.Fatal("搜索不应把草稿写入笔记索引")
	}
}

func TestSearchIntegrationDraftRefreshDeleteAndVaultSwitch(t *testing.T) {
	s := openDraftIntegrationVault(t)
	data := seedSearchIntegrationData(t, s)
	root := s.vault.RootPath
	path := filepath.Join(root, "drafts", data.draftID+".md")
	if err := os.WriteFile(path, []byte("外部编辑标题\n外部更新正文"), 0600); err != nil {
		t.Fatal(err)
	}
	items, err := s.SearchAll("外部更新正文")
	if err != nil || len(items) != 1 || items[0].ID != data.draftID || items[0].Title != "外部编辑标题" {
		t.Fatal("外部草稿改动应在下次查询直接可见")
	}
	if old, err := s.SearchAll("草稿独有正文"); err != nil || len(old) != 0 {
		t.Fatal("不应搜索到草稿旧正文")
	}
	loaded, err := s.GetDraft(root, data.draftID)
	if err != nil || loaded.Body != "外部编辑标题\n外部更新正文" {
		t.Fatal("搜索结果应能按 ID 打开当前原文")
	}
	if err := s.DeleteDraft(root, loaded.ID, loaded.Version); err != nil {
		t.Fatal(err)
	}
	if items, err := s.SearchAll("外部更新正文"); err != nil || len(items) != 0 {
		t.Fatal("删除后不应保留搜索结果")
	}
	if _, err := s.openVault(t.TempDir()); err != nil {
		t.Fatal(err)
	}
	if items, err := s.SearchAll("检索示例"); err != nil || len(items) != 0 {
		t.Fatal("不应搜索旧 Vault 的内容")
	}
	if _, err := (&VaultService{}).SearchAll("关键词"); err == nil {
		t.Fatal("无 Vault 时应报告错误")
	}
}

func TestSearchIntegrationUnreadableDraftAndPathBoundary(t *testing.T) {
	s := openDraftIntegrationVault(t)
	data := seedSearchIntegrationData(t, s)
	root := s.vault.RootPath
	bad, err := s.CreateDraft(root)
	if err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(root, "drafts", bad.ID+".md"), []byte{0xff, 0xfe}, 0600); err != nil {
		t.Fatal(err)
	}
	linked, err := s.CreateDraft(root)
	if err != nil {
		t.Fatal(err)
	}
	linkPath := filepath.Join(root, "drafts", linked.ID+".md")
	if err := os.Remove(linkPath); err != nil {
		t.Fatal(err)
	}
	outside := filepath.Join(t.TempDir(), "outside.md")
	if err := os.WriteFile(outside, []byte("禁止读到的外部正文"), 0600); err != nil {
		t.Fatal(err)
	}
	if err := os.Symlink(outside, linkPath); err != nil {
		t.Fatal(err)
	}
	items, err := s.SearchAll("检索示例")
	if err != nil || len(items) != 5 {
		t.Fatal("单个非法草稿不应影响其他可搜索内容")
	}
	if items, err := s.SearchAll("禁止读到"); err != nil || len(items) != 0 {
		t.Fatal("草稿搜索不应读取链接目标")
	}
	note, err := s.GetNote(data.noteID)
	if err != nil || note.Body != "笔记独有正文 MiXeD" {
		t.Fatal("搜索改变了原笔记")
	}
	if _, err := s.openVault(t.TempDir()); err != nil {
		t.Fatal(err)
	}
	if err := os.Symlink(filepath.Dir(outside), filepath.Join(s.vault.RootPath, "drafts")); err != nil {
		t.Fatal(err)
	}
	if _, err := s.SearchAll("禁止读到"); err == nil {
		t.Fatal("草稿目录越界应报告错误")
	}
}
