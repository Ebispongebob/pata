package main

import (
	"context"
	"encoding/json"
	"fmt"
	"log"
	"os"
	"path/filepath"
	"sync"
	"time"

	"github.com/wailsapp/wails/v3/pkg/application"

	"pata/internal/storage/markdown"
)

// VaultConfig is the persisted single-vault choice (D18: 单 Vault).
type VaultConfig struct {
	VaultPath string `json:"vault_path"`
}

// VaultStatus reports whether a vault is configured/open for the UI.
type VaultStatus struct {
	Configured bool   `json:"configured"`
	Path       string `json:"path"`
	Open       bool   `json:"open"`
	TaskCount  int    `json:"taskCount"`
	Error      string `json:"error,omitempty"`
}

// VaultService owns the single Vault instance; all structured file access goes through it.
type VaultService struct {
	mu          sync.Mutex
	vault       *markdown.Vault
	stopWatcher func()
	configPath  string
}

func NewVaultService() *VaultService {
	configDir, err := os.UserConfigDir()
	if err != nil {
		log.Printf("vault: cannot resolve user config dir, persistence disabled: %v", err)
		return &VaultService{}
	}
	return &VaultService{configPath: filepath.Join(configDir, "pata", "vault.json")}
}

// ServiceStartup auto-opens the persisted vault; failure leaves the vault closed, not the app dead.
func (s *VaultService) ServiceStartup(ctx context.Context, options application.ServiceOptions) error {
	cfg, err := s.loadConfig()
	if err != nil || cfg.VaultPath == "" {
		return nil // nothing configured yet
	}
	if _, err := s.openVault(cfg.VaultPath); err != nil {
		log.Printf("vault: failed to open persisted vault %s: %v", cfg.VaultPath, err)
	}
	return nil
}

// SelectVaultDirectory shows a native directory picker, persists the choice (single vault)
// and opens it. Cancel returns the unchanged status.
func (s *VaultService) SelectVaultDirectory() (VaultStatus, error) {
	dialog := application.Get().Dialog.OpenFile()
	dialog.SetTitle("选择 Pata Vault 目录")
	dialog.CanChooseFiles(false)
	dialog.CanChooseDirectories(true)
	dialog.CanCreateDirectories(true)
	path, err := dialog.PromptForSingleSelection()
	if err != nil {
		return s.GetVaultStatus(), fmt.Errorf("打开目录选择器失败: %w", err)
	}
	if path == "" { // user cancelled
		return s.GetVaultStatus(), nil
	}
	if _, err := s.openVault(path); err != nil {
		return s.GetVaultStatus(), err
	}
	if err := s.saveConfig(VaultConfig{VaultPath: path}); err != nil {
		return s.GetVaultStatus(), fmt.Errorf("Vault 已打开但保存配置失败: %w", err)
	}
	return s.GetVaultStatus(), nil
}

// GetVaultStatus is cheap and callable before any vault is opened.
func (s *VaultService) GetVaultStatus() VaultStatus {
	s.mu.Lock()
	defer s.mu.Unlock()
	st := VaultStatus{}
	if cfg, err := s.loadConfig(); err == nil && cfg.VaultPath != "" {
		st.Configured = true
		st.Path = cfg.VaultPath
	}
	if s.vault != nil {
		st.Open = true
		st.TaskCount = len(s.vault.Index.ListTasks())
	}
	return st
}

// ListTasks returns all tasks from the vault index, newest first.
func (s *VaultService) ListTasks() ([]*markdown.Task, error) {
	s.mu.Lock()
	v := s.vault
	s.mu.Unlock()
	if v == nil {
		return nil, fmt.Errorf("尚未打开 Vault")
	}
	return v.Index.ListTasks(), nil
}

// RescanVault rebuilds the index from disk (manual refresh; watcher handles external changes).
func (s *VaultService) RescanVault() error {
	s.mu.Lock()
	v := s.vault
	s.mu.Unlock()
	if v == nil {
		return fmt.Errorf("尚未打开 Vault")
	}
	return v.Scan()
}

func (s *VaultService) openVault(path string) (*markdown.Vault, error) {
	v, err := markdown.NewVault(path)
	if err != nil {
		return nil, fmt.Errorf("打开 Vault 失败: %w", err)
	}
	if err := v.StartWatcher(); err != nil {
		log.Printf("vault: watcher failed to start, relying on rescan: %v", err)
	}
	stopRescan := v.StartPeriodicRescan(30 * time.Second)

	s.mu.Lock()
	oldStop := s.stopWatcher
	s.vault = v
	s.stopWatcher = func() {
		stopRescan()
		_ = v.StopWatcher()
	}
	s.mu.Unlock()

	if oldStop != nil {
		oldStop()
	}
	return v, nil
}

func (s *VaultService) loadConfig() (VaultConfig, error) {
	var cfg VaultConfig
	if s.configPath == "" {
		return cfg, fmt.Errorf("persistence disabled")
	}
	data, err := os.ReadFile(s.configPath)
	if os.IsNotExist(err) {
		return cfg, nil
	}
	if err != nil {
		return cfg, err
	}
	err = json.Unmarshal(data, &cfg)
	return cfg, err
}

func (s *VaultService) saveConfig(cfg VaultConfig) error {
	if s.configPath == "" {
		return fmt.Errorf("persistence disabled")
	}
	if err := os.MkdirAll(filepath.Dir(s.configPath), 0755); err != nil {
		return err
	}
	data, err := json.MarshalIndent(cfg, "", "  ")
	if err != nil {
		return err
	}
	return os.WriteFile(s.configPath, data, 0644)
}
