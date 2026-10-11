package main

import (
	"context"
	"encoding/json"
	"fmt"
	"log"
	"os"
	"path/filepath"
	"sort"
	"strings"
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

// CreateTaskInput defines parameters for creating a new Task.
type CreateTaskInput struct {
	Title    string                `json:"title"`
	Status   markdown.TaskStatus   `json:"status,omitempty"`
	Priority markdown.TaskPriority `json:"priority,omitempty"`
	Due      *string               `json:"due,omitempty"`
	Tags     []string              `json:"tags,omitempty"`
	NoteIDs  []string              `json:"note_ids,omitempty"`
	Body     string                `json:"body,omitempty"`
}

// UpdateTaskInput defines parameters for updating an existing Task.
// Note: tags, note_ids, and body follow full-replacement semantics (not partial patch).
type UpdateTaskInput struct {
	ID       string                `json:"id"`
	Title    string                `json:"title"`
	Status   markdown.TaskStatus   `json:"status"`
	Priority markdown.TaskPriority `json:"priority"`
	Due      *string               `json:"due"`
	Tags     []string              `json:"tags,omitempty"`
	NoteIDs  []string              `json:"note_ids,omitempty"`
	Body     string                `json:"body"`
}

// CreateMemoInput defines parameters for creating a new Memo.
type CreateMemoInput struct {
	Body   string   `json:"body"`
	TaskID string   `json:"task_id,omitempty"`
	Tags   []string `json:"tags,omitempty"`
}

// UpdateMemoInput defines parameters for updating an existing Memo.
type UpdateMemoInput struct {
	ID   string   `json:"id"`
	Body string   `json:"body"`
	Tags []string `json:"tags,omitempty"`
}

// TimelineItem represents an aggregated item in the day timeline (memo or completion).
type TimelineItem struct {
	Kind      string         `json:"kind"` // "memo" | "completion"
	Time      time.Time      `json:"time"`
	Memo      *markdown.Memo `json:"memo,omitempty"`
	TaskID    string         `json:"task_id,omitempty"`
	TaskTitle string         `json:"task_title,omitempty"`
}

// EventVaultChanged is emitted to the Wails frontend when a vault entity is created, modified, or deleted.
const EventVaultChanged = "vault:changed"

// VaultChangeEvent describes a change dispatched to the frontend application.
type VaultChangeEvent struct {
	Op       string `json:"op"`
	Path     string `json:"path"`
	EntityID string `json:"entity_id,omitempty"`
	Type     string `json:"type,omitempty"`
}

// VaultService owns the single Vault instance; all structured file access goes through it.
type VaultService struct {
	mu          sync.Mutex
	vault       *markdown.Vault
	stopWatcher func()
	configPath  string
	emitEvent   func(name string, data any)
}

func NewVaultService() *VaultService {
	defaultEmit := func(name string, data any) {
		if app := application.Get(); app != nil && app.Event != nil {
			app.Event.Emit(name, data)
		}
	}

	configDir, err := os.UserConfigDir()
	if err != nil {
		log.Printf("vault: cannot resolve user config dir, persistence disabled: %v", err)
		return &VaultService{emitEvent: defaultEmit}
	}
	return &VaultService{
		configPath: filepath.Join(configDir, "pata", "vault.json"),
		emitEvent:  defaultEmit,
	}
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

// GetTask returns a task by its ID.
func (s *VaultService) GetTask(id string) (*markdown.Task, error) {
	s.mu.Lock()
	v := s.vault
	s.mu.Unlock()
	if v == nil {
		return nil, fmt.Errorf("尚未打开 Vault")
	}

	if strings.TrimSpace(id) == "" {
		return nil, fmt.Errorf("任务 ID 不能为空")
	}

	task, ok := v.Index.GetTask(id)
	if !ok {
		return nil, fmt.Errorf("任务不存在: %s", id)
	}
	return task, nil
}

// CreateTask creates a new Task, writes it safely as Markdown, and updates the index.
func (s *VaultService) CreateTask(input CreateTaskInput) (*markdown.Task, error) {
	s.mu.Lock()
	v := s.vault
	s.mu.Unlock()
	if v == nil {
		return nil, fmt.Errorf("尚未打开 Vault")
	}

	title := strings.TrimSpace(input.Title)
	if title == "" {
		return nil, fmt.Errorf("任务标题不能为空")
	}

	status := input.Status
	if status == "" {
		status = markdown.TaskStatusTodo
	}

	priority := input.Priority
	if priority == "" {
		priority = markdown.TaskPriorityP2
	}

	var due *string
	if input.Due != nil && strings.TrimSpace(*input.Due) != "" {
		d := strings.TrimSpace(*input.Due)
		due = &d
	}

	now := time.Now()
	task := &markdown.Task{
		Type:      markdown.EntityTypeTask,
		ID:        markdown.GenerateEntityID(markdown.EntityTypeTask),
		Title:     title,
		Status:    status,
		Priority:  priority,
		Due:       due,
		Tags:      input.Tags,
		NoteIDs:   input.NoteIDs,
		CreatedAt: now,
		UpdatedAt: now,
		Body:      input.Body,
	}

	if status == markdown.TaskStatusDone {
		task.StatusEvents = []markdown.StatusEvent{
			{
				Action: markdown.StatusEventActionCompleted,
				At:     now,
			},
		}
	}

	if _, err := v.SaveEntity(task, nil); err != nil {
		return nil, err
	}

	return task, nil
}

// UpdateTask updates an existing Task, safely writes changes to Markdown, and preserves unknown frontmatter.
func (s *VaultService) UpdateTask(input UpdateTaskInput) (*markdown.Task, error) {
	s.mu.Lock()
	v := s.vault
	s.mu.Unlock()
	if v == nil {
		return nil, fmt.Errorf("尚未打开 Vault")
	}

	if strings.TrimSpace(input.ID) == "" {
		return nil, fmt.Errorf("任务 ID 不能为空")
	}

	title := strings.TrimSpace(input.Title)
	if title == "" {
		return nil, fmt.Errorf("任务标题不能为空")
	}

	existing, ok := v.Index.GetTask(input.ID)
	if !ok {
		return nil, fmt.Errorf("任务不存在: %s", input.ID)
	}

	now := time.Now()
	// Status event semantics: record completion or reopen
	if existing.Status != markdown.TaskStatusDone && input.Status == markdown.TaskStatusDone {
		existing.StatusEvents = append(existing.StatusEvents, markdown.StatusEvent{
			Action: markdown.StatusEventActionCompleted,
			At:     now,
		})
	} else if existing.Status == markdown.TaskStatusDone && (input.Status == markdown.TaskStatusTodo || input.Status == markdown.TaskStatusDoing) {
		existing.StatusEvents = append(existing.StatusEvents, markdown.StatusEvent{
			Action: markdown.StatusEventActionReopened,
			At:     now,
		})
	}

	var due *string
	if input.Due != nil && strings.TrimSpace(*input.Due) != "" {
		d := strings.TrimSpace(*input.Due)
		due = &d
	}

	existing.Title = title
	existing.Status = input.Status
	existing.Priority = input.Priority
	existing.Due = due
	existing.Tags = input.Tags
	existing.NoteIDs = input.NoteIDs
	existing.Body = input.Body
	existing.UpdatedAt = now

	// SaveEntity preserves Extra (unknown frontmatter)
	baseline := taskBaseline(v, existing)
	if _, err := v.SaveEntity(existing, baseline); err != nil {
		return nil, err
	}

	return existing, nil
}

// taskBaseline looks up the baseline for an entity directly from the memory index.
func taskBaseline(v *markdown.Vault, task *markdown.Task) *markdown.FileBaseline {
	path := v.ResolveEntityPath(task)
	if b, ok := v.Index.GetBaseline(path); ok {
		return &b
	}
	return nil
}

// SetTaskStatus toggles or updates the status of a Task with completion/reopen event semantics.
func (s *VaultService) SetTaskStatus(id string, status markdown.TaskStatus) (*markdown.Task, error) {
	s.mu.Lock()
	v := s.vault
	s.mu.Unlock()
	if v == nil {
		return nil, fmt.Errorf("尚未打开 Vault")
	}

	if strings.TrimSpace(id) == "" {
		return nil, fmt.Errorf("任务 ID 不能为空")
	}

	switch status {
	case markdown.TaskStatusTodo, markdown.TaskStatusDoing, markdown.TaskStatusDone:
		// valid
	default:
		return nil, fmt.Errorf("无效的任务状态: %s (必须为 todo, doing 或 done)", status)
	}

	existing, ok := v.Index.GetTask(id)
	if !ok {
		return nil, fmt.Errorf("任务不存在: %s", id)
	}

	if existing.Status == status {
		return existing, nil
	}

	now := time.Now()
	if status == markdown.TaskStatusDone {
		existing.StatusEvents = append(existing.StatusEvents, markdown.StatusEvent{
			Action: markdown.StatusEventActionCompleted,
			At:     now,
		})
	} else if existing.Status == markdown.TaskStatusDone {
		existing.StatusEvents = append(existing.StatusEvents, markdown.StatusEvent{
			Action: markdown.StatusEventActionReopened,
			At:     now,
		})
	}

	existing.Status = status
	existing.UpdatedAt = now

	baseline := taskBaseline(v, existing)
	if _, err := v.SaveEntity(existing, baseline); err != nil {
		return nil, err
	}

	return existing, nil
}

// DeleteTask deletes a task from disk and updates the index, preserving any referencing Memos.
func (s *VaultService) DeleteTask(id string) error {
	s.mu.Lock()
	v := s.vault
	s.mu.Unlock()
	if v == nil {
		return fmt.Errorf("尚未打开 Vault")
	}

	if strings.TrimSpace(id) == "" {
		return fmt.Errorf("任务 ID 不能为空")
	}

	if _, ok := v.Index.GetTask(id); !ok {
		return fmt.Errorf("任务不存在: %s", id)
	}

	return v.DeleteEntity(id)
}

// ListMemosByTask returns all memos associated with taskID from the vault index, oldest first.
func (s *VaultService) ListMemosByTask(taskID string) ([]*markdown.Memo, error) {
	s.mu.Lock()
	v := s.vault
	s.mu.Unlock()
	if v == nil {
		return nil, fmt.Errorf("尚未打开 Vault")
	}
	return v.Index.ListMemosByTask(taskID), nil
}

// GetMemo returns a memo by its ID.
func (s *VaultService) GetMemo(id string) (*markdown.Memo, error) {
	s.mu.Lock()
	v := s.vault
	s.mu.Unlock()
	if v == nil {
		return nil, fmt.Errorf("尚未打开 Vault")
	}

	if strings.TrimSpace(id) == "" {
		return nil, fmt.Errorf("Memo ID 不能为空")
	}

	memo, ok := v.Index.GetMemo(id)
	if !ok {
		return nil, fmt.Errorf("Memo 不存在: %s", id)
	}
	return memo, nil
}

// CreateMemo creates a new Memo, writes it safely as Markdown, and updates the index.
func (s *VaultService) CreateMemo(input CreateMemoInput) (*markdown.Memo, error) {
	s.mu.Lock()
	v := s.vault
	s.mu.Unlock()
	if v == nil {
		return nil, fmt.Errorf("尚未打开 Vault")
	}

	body := strings.TrimSpace(input.Body)
	if body == "" {
		return nil, fmt.Errorf("Memo 正文不能为空")
	}

	taskID := strings.TrimSpace(input.TaskID)
	if taskID != "" {
		if _, ok := v.Index.GetTask(taskID); !ok {
			return nil, fmt.Errorf("任务不存在: %s", taskID)
		}
	}

	var tags []string
	for _, tag := range input.Tags {
		cleaned := strings.TrimSpace(strings.TrimPrefix(tag, "#"))
		if cleaned != "" {
			tags = append(tags, cleaned)
		}
	}

	memo := &markdown.Memo{
		Type:      markdown.EntityTypeMemo,
		ID:        markdown.GenerateEntityID(markdown.EntityTypeMemo),
		TaskID:    taskID,
		CreatedAt: time.Now(),
		Tags:      tags,
		Body:      input.Body,
	}

	if _, err := v.SaveEntity(memo, nil); err != nil {
		return nil, err
	}

	return memo, nil
}

// UpdateMemo updates an existing Memo's body and tags while preserving its creation timestamp.
func (s *VaultService) UpdateMemo(input UpdateMemoInput) (*markdown.Memo, error) {
	s.mu.Lock()
	v := s.vault
	s.mu.Unlock()
	if v == nil {
		return nil, fmt.Errorf("尚未打开 Vault")
	}

	if strings.TrimSpace(input.ID) == "" {
		return nil, fmt.Errorf("Memo ID 不能为空")
	}

	body := strings.TrimSpace(input.Body)
	if body == "" {
		return nil, fmt.Errorf("Memo 正文不能为空")
	}

	existing, ok := v.Index.GetMemo(input.ID)
	if !ok {
		return nil, fmt.Errorf("Memo 不存在: %s", input.ID)
	}

	var tags []string
	for _, tag := range input.Tags {
		cleaned := strings.TrimSpace(strings.TrimPrefix(tag, "#"))
		if cleaned != "" {
			tags = append(tags, cleaned)
		}
	}

	existing.Body = input.Body
	existing.Tags = tags

	baseline := memoBaseline(v, existing)
	if _, err := v.SaveEntity(existing, baseline); err != nil {
		return nil, err
	}

	return existing, nil
}

// memoBaseline looks up the baseline for a memo directly from the memory index.
func memoBaseline(v *markdown.Vault, memo *markdown.Memo) *markdown.FileBaseline {
	path := v.ResolveEntityPath(memo)
	if b, ok := v.Index.GetBaseline(path); ok {
		return &b
	}
	return nil
}

// GetDayPlan returns the DayPlan for a date. If no plan exists, an empty DayPlan is returned without error.
func (s *VaultService) GetDayPlan(date string) (*markdown.DayPlan, error) {
	s.mu.Lock()
	v := s.vault
	s.mu.Unlock()
	if v == nil {
		return nil, fmt.Errorf("尚未打开 Vault")
	}

	trimmedDate := strings.TrimSpace(date)
	if _, err := time.Parse("2006-01-02", trimmedDate); err != nil {
		return nil, fmt.Errorf("无效的日期格式: %s (必须为 YYYY-MM-DD)", date)
	}

	if plan, ok := v.Index.GetDayPlan(trimmedDate); ok {
		if plan.TaskIDs == nil {
			plan.TaskIDs = []string{}
		}
		return plan, nil
	}

	return &markdown.DayPlan{
		Type:    markdown.EntityTypeDayPlan,
		Date:    trimmedDate,
		TaskIDs: []string{},
	}, nil
}

// SaveDayPlan creates or updates a DayPlan for a date with an ordered list of task IDs.
func (s *VaultService) SaveDayPlan(date string, taskIDs []string) (*markdown.DayPlan, error) {
	s.mu.Lock()
	v := s.vault
	s.mu.Unlock()
	if v == nil {
		return nil, fmt.Errorf("尚未打开 Vault")
	}

	trimmedDate := strings.TrimSpace(date)
	if _, err := time.Parse("2006-01-02", trimmedDate); err != nil {
		return nil, fmt.Errorf("无效的日期格式: %s (必须为 YYYY-MM-DD)", date)
	}

	cleanedTaskIDs := make([]string, len(taskIDs))
	for i, tid := range taskIDs {
		id := strings.TrimSpace(tid)
		if id == "" {
			return nil, fmt.Errorf("任务 ID 不能为空")
		}
		if _, ok := v.Index.GetTask(id); !ok {
			return nil, fmt.Errorf("任务不存在: %s", id)
		}
		cleanedTaskIDs[i] = id
	}

	existing, exists := v.Index.GetDayPlan(trimmedDate)
	var baseline *markdown.FileBaseline
	var plan *markdown.DayPlan
	if exists {
		baseline = dayPlanBaseline(v, existing)
		existing.TaskIDs = cleanedTaskIDs
		plan = existing
	} else {
		plan = &markdown.DayPlan{
			Type:    markdown.EntityTypeDayPlan,
			Date:    trimmedDate,
			TaskIDs: cleanedTaskIDs,
		}
	}

	if _, err := v.SaveEntity(plan, baseline); err != nil {
		return nil, err
	}

	return plan, nil
}

// dayPlanBaseline looks up the baseline for a day plan directly from the memory index.
func dayPlanBaseline(v *markdown.Vault, plan *markdown.DayPlan) *markdown.FileBaseline {
	path := v.ResolveEntityPath(plan)
	if b, ok := v.Index.GetBaseline(path); ok {
		return &b
	}
	return nil
}

// GetDayTimeline returns daily timeline items (memos and task completion events) for a given date YYYY-MM-DD in local timezone.
func (s *VaultService) GetDayTimeline(date string) ([]TimelineItem, error) {
	s.mu.Lock()
	v := s.vault
	s.mu.Unlock()
	if v == nil {
		return nil, fmt.Errorf("尚未打开 Vault")
	}

	trimmedDate := strings.TrimSpace(date)
	if _, err := time.Parse("2006-01-02", trimmedDate); err != nil {
		return nil, fmt.Errorf("无效的日期格式: %s (必须为 YYYY-MM-DD)", date)
	}

	var items []TimelineItem
	tasks := v.Index.ListTasks()
	taskMap := make(map[string]*markdown.Task, len(tasks))
	for _, t := range tasks {
		taskMap[t.ID] = t
	}

	// 1. Task completions: StatusEvents with action=completed whose local date matches
	for _, t := range tasks {
		for _, ev := range t.StatusEvents {
			if ev.Action == markdown.StatusEventActionCompleted {
				localDate := ev.At.In(time.Local).Format("2006-01-02")
				if localDate == trimmedDate {
					items = append(items, TimelineItem{
						Kind:      "completion",
						Time:      ev.At,
						TaskID:    t.ID,
						TaskTitle: t.Title,
					})
				}
			}
		}
	}

	// 2. Memos: created_at local date matches
	allMemos := s.getAllMemos(v)
	for _, m := range allMemos {
		localDate := m.CreatedAt.In(time.Local).Format("2006-01-02")
		if localDate == trimmedDate {
			var taskTitle string
			if m.TaskID != "" {
				if parent, ok := taskMap[m.TaskID]; ok {
					taskTitle = parent.Title
				} else if parent, ok := v.Index.GetTask(m.TaskID); ok {
					taskTitle = parent.Title
				}
			}
			items = append(items, TimelineItem{
				Kind:      "memo",
				Time:      m.CreatedAt,
				Memo:      m,
				TaskID:    m.TaskID,
				TaskTitle: taskTitle,
			})
		}
	}

	// Sort descending by Time (newest -> oldest)
	sort.Slice(items, func(i, j int) bool {
		if items[i].Time.Equal(items[j].Time) {
			if items[i].Kind != items[j].Kind {
				return items[i].Kind < items[j].Kind
			}
			if items[i].Memo != nil && items[j].Memo != nil {
				return items[i].Memo.ID > items[j].Memo.ID
			}
			return items[i].TaskID > items[j].TaskID
		}
		return items[i].Time.After(items[j].Time)
	})

	if items == nil {
		return []TimelineItem{}, nil
	}
	return items, nil
}

// getAllMemos retrieves clones of all memos across the vault (independent, task-associated, and dangling).
func (s *VaultService) getAllMemos(v *markdown.Vault) []*markdown.Memo {
	seen := make(map[string]bool)
	var allMemos []*markdown.Memo

	// 1. Independent memos (TaskID == "")
	for _, m := range v.Index.ListMemosByTask("") {
		if !seen[m.ID] {
			seen[m.ID] = true
			allMemos = append(allMemos, m)
		}
	}

	// 2. Memos associated with active tasks
	for _, t := range v.Index.ListTasks() {
		for _, m := range v.Index.ListMemosByTask(t.ID) {
			if !seen[m.ID] {
				seen[m.ID] = true
				allMemos = append(allMemos, m)
			}
		}
	}

	// 3. Memos referencing missing/deleted tasks (dangling refs)
	for _, d := range v.Index.ListDanglingReferences() {
		if d.SourceType == markdown.EntityTypeMemo {
			if !seen[d.SourceID] {
				if m, ok := v.Index.GetMemo(d.SourceID); ok {
					seen[d.SourceID] = true
					allMemos = append(allMemos, m)
				}
			}
		}
	}

	return allMemos
}

func (s *VaultService) dispatchEvent(name string, data any) {
	s.mu.Lock()
	emit := s.emitEvent
	s.mu.Unlock()
	if emit != nil {
		emit(name, data)
	}
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

	stopForwarder := make(chan struct{})
	go s.forwardVaultEvents(v.Events(), stopForwarder)

	s.mu.Lock()
	oldStop := s.stopWatcher
	s.vault = v
	s.stopWatcher = func() {
		close(stopForwarder)
		stopRescan()
		_ = v.StopWatcher()
	}
	s.mu.Unlock()

	if oldStop != nil {
		oldStop()
	}
	return v, nil
}

func (s *VaultService) forwardVaultEvents(events <-chan markdown.VaultEvent, stop <-chan struct{}) {
	for {
		select {
		case <-stop:
			return
		case ev, ok := <-events:
			if !ok {
				return
			}
			payload := VaultChangeEvent{
				Op:       string(ev.Op),
				Path:     ev.Path,
				EntityID: ev.EntityID,
				Type:     string(ev.Type),
			}
			s.dispatchEvent(EventVaultChanged, payload)
		}
	}
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
