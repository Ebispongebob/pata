package main

import (
	"path/filepath"
	"testing"
	"time"

	"pata/internal/storage/markdown"
)

func TestVaultServiceConfigRoundTrip(t *testing.T) {
	dir := t.TempDir()
	s := &VaultService{configPath: filepath.Join(dir, "vault.json")}

	// Missing file returns empty config without error (fresh install)
	cfg, err := s.loadConfig()
	if err != nil || cfg.VaultPath != "" {
		t.Fatalf("loadConfig on missing file = %+v, %v", cfg, err)
	}

	if err := s.saveConfig(VaultConfig{VaultPath: "/tmp/my-vault"}); err != nil {
		t.Fatalf("saveConfig failed: %v", err)
	}
	cfg, err = s.loadConfig()
	if err != nil || cfg.VaultPath != "/tmp/my-vault" {
		t.Fatalf("loadConfig = %+v, %v", cfg, err)
	}
}

func TestVaultServiceOpenAndListTasks(t *testing.T) {
	vaultDir := t.TempDir()
	task := &markdown.Task{
		Type:      markdown.EntityTypeTask,
		ID:        markdown.GenerateEntityID(markdown.EntityTypeTask),
		Title:     "冒烟测试任务",
		Status:    markdown.TaskStatusTodo,
		Priority:  markdown.TaskPriorityP2,
		CreatedAt: time.Now(),
		UpdatedAt: time.Now(),
	}
	v, err := markdown.NewVault(vaultDir)
	if err != nil {
		t.Fatalf("NewVault failed: %v", err)
	}
	if _, err := v.SaveEntity(task, nil); err != nil {
		t.Fatalf("SaveEntity failed: %v", err)
	}

	s := &VaultService{}
	if _, err := s.openVault(vaultDir); err != nil {
		t.Fatalf("openVault failed: %v", err)
	}

	st := s.GetVaultStatus()
	if !st.Open || st.TaskCount != 1 {
		t.Fatalf("unexpected status: %+v", st)
	}

	tasks, err := s.ListTasks()
	if err != nil || len(tasks) != 1 || tasks[0].Title != "冒烟测试任务" {
		t.Fatalf("ListTasks = %+v, %v", tasks, err)
	}

	if err := s.RescanVault(); err != nil {
		t.Fatalf("RescanVault failed: %v", err)
	}

	// Opening a second vault must replace the first (single vault, D18)
	other := t.TempDir()
	if _, err := s.openVault(other); err != nil {
		t.Fatalf("openVault(second) failed: %v", err)
	}
	if st := s.GetVaultStatus(); st.TaskCount != 0 {
		t.Fatalf("expected replaced vault to be empty, got %+v", st)
	}

	if s.stopWatcher != nil {
		s.stopWatcher()
	}
}
