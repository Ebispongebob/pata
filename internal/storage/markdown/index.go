package markdown

import (
	"fmt"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"sync"
)

// EntityRef represents a reference to an entity returned from queries.
type EntityRef struct {
	Type      EntityType `json:"type"`
	ID        string     `json:"id"`
	Title     string     `json:"title,omitempty"`
	Path      string     `json:"path"`
	Inherited bool       `json:"inherited,omitempty"` // true if matched via parent task tag
}

// DanglingRef represents an explainable degraded reference to a missing entity.
type DanglingRef struct {
	SourceType EntityType `json:"source_type"`
	SourceID   string     `json:"source_id"`
	SourcePath string     `json:"source_path"`
	TargetType EntityType `json:"target_type"`
	TargetID   string     `json:"target_id"`
	Reason     string     `json:"reason"`
}

func (d DanglingRef) String() string {
	return fmt.Sprintf("[%s:%s in %s] references missing %s '%s': %s",
		d.SourceType, d.SourceID, d.SourcePath, d.TargetType, d.TargetID, d.Reason)
}

// MemoryIndex maintains an in-memory rebuildable index of all vault entities.
type MemoryIndex struct {
	mu           sync.RWMutex
	tasks        map[string]*Task
	memos        map[string]*Memo
	notes        map[string]*Note
	dayPlans     map[string]*DayPlan // key: date YYYY-MM-DD
	fileToID     map[string]string   // absPath -> entity ID
	idToFile     map[string]string   // entity ID -> absPath
	baselines    map[string]FileBaseline
	danglingRefs []DanglingRef
	parseErrors  []ParseError
	pendingMoves map[string]pendingMove
}

type pendingMove struct {
	path     string
	entity   Entity
	baseline FileBaseline
}

// NewMemoryIndex creates an empty MemoryIndex.
func NewMemoryIndex() *MemoryIndex {
	return &MemoryIndex{
		tasks:        make(map[string]*Task),
		memos:        make(map[string]*Memo),
		notes:        make(map[string]*Note),
		dayPlans:     make(map[string]*DayPlan),
		fileToID:     make(map[string]string),
		idToFile:     make(map[string]string),
		baselines:    make(map[string]FileBaseline),
		pendingMoves: make(map[string]pendingMove),
	}
}

// Clear resets the index to empty state.
// 注释: Scan 清空 pendingMoves 与 Remove 事件存在竞态窗口(最长 30s 周期重扫闪失、重扫自愈，属已知可接受).
func (idx *MemoryIndex) Clear() {
	idx.mu.Lock()
	defer idx.mu.Unlock()
	idx.tasks = make(map[string]*Task)
	idx.memos = make(map[string]*Memo)
	idx.notes = make(map[string]*Note)
	idx.dayPlans = make(map[string]*DayPlan)
	idx.fileToID = make(map[string]string)
	idx.idToFile = make(map[string]string)
	idx.baselines = make(map[string]FileBaseline)
	idx.pendingMoves = make(map[string]pendingMove)
	idx.danglingRefs = nil
	idx.parseErrors = nil
}

// GetTask returns a clone of the task by ID.
func (idx *MemoryIndex) GetTask(id string) (*Task, bool) {
	idx.mu.RLock()
	defer idx.mu.RUnlock()
	t, ok := idx.tasks[id]
	if !ok {
		return nil, false
	}
	return t.Clone().(*Task), true
}

// ListTasks returns clones of all tasks sorted by UpdatedAt descending.
func (idx *MemoryIndex) ListTasks() []*Task {
	idx.mu.RLock()
	tasks := make([]*Task, 0, len(idx.tasks))
	for _, t := range idx.tasks {
		tasks = append(tasks, t.Clone().(*Task))
	}
	idx.mu.RUnlock()
	sort.Slice(tasks, func(i, j int) bool { return tasks[i].UpdatedAt.After(tasks[j].UpdatedAt) })
	return tasks
}

// GetMemo returns a clone of the memo by ID.
func (idx *MemoryIndex) GetMemo(id string) (*Memo, bool) {
	idx.mu.RLock()
	defer idx.mu.RUnlock()
	m, ok := idx.memos[id]
	if !ok {
		return nil, false
	}
	return m.Clone().(*Memo), true
}

// ListMemosByTask returns clones of all memos belonging to taskID sorted by CreatedAt ascending.
func (idx *MemoryIndex) ListMemosByTask(taskID string) []*Memo {
	idx.mu.RLock()
	var memos []*Memo
	for _, m := range idx.memos {
		if m.TaskID == taskID {
			memos = append(memos, m.Clone().(*Memo))
		}
	}
	idx.mu.RUnlock()
	sort.Slice(memos, func(i, j int) bool {
		if memos[i].CreatedAt.Equal(memos[j].CreatedAt) {
			return memos[i].ID < memos[j].ID
		}
		return memos[i].CreatedAt.Before(memos[j].CreatedAt)
	})
	if memos == nil {
		return []*Memo{}
	}
	return memos
}

// GetNote returns a clone of the note by ID.
func (idx *MemoryIndex) GetNote(id string) (*Note, bool) {
	idx.mu.RLock()
	defer idx.mu.RUnlock()
	n, ok := idx.notes[id]
	if !ok {
		return nil, false
	}
	return n.Clone().(*Note), true
}

// ListNotes returns clones of all notes sorted by UpdatedAt descending.
func (idx *MemoryIndex) ListNotes() []*Note {
	idx.mu.RLock()
	notes := make([]*Note, 0, len(idx.notes))
	for _, n := range idx.notes {
		notes = append(notes, n.Clone().(*Note))
	}
	idx.mu.RUnlock()
	sort.Slice(notes, func(i, j int) bool {
		if notes[i].UpdatedAt.Equal(notes[j].UpdatedAt) {
			return notes[i].ID < notes[j].ID
		}
		return notes[i].UpdatedAt.After(notes[j].UpdatedAt)
	})
	return notes
}

// GetDayPlan returns a clone of the DayPlan for a date.
func (idx *MemoryIndex) GetDayPlan(date string) (*DayPlan, bool) {
	idx.mu.RLock()
	defer idx.mu.RUnlock()
	p, ok := idx.dayPlans[date]
	if !ok {
		return nil, false
	}
	return p.Clone().(*DayPlan), true
}

// GetBaseline returns baseline info for a file path.
func (idx *MemoryIndex) GetBaseline(absPath string) (FileBaseline, bool) {
	idx.mu.RLock()
	defer idx.mu.RUnlock()
	b, ok := idx.baselines[absPath]
	return b, ok
}

// ListDanglingReferences returns all current dangling references.
func (idx *MemoryIndex) ListDanglingReferences() []DanglingRef {
	idx.mu.RLock()
	defer idx.mu.RUnlock()
	res := make([]DanglingRef, len(idx.danglingRefs))
	copy(res, idx.danglingRefs)
	return res
}

// ListParseErrors returns all isolated parse errors encountered.
func (idx *MemoryIndex) ListParseErrors() []ParseError {
	idx.mu.RLock()
	defer idx.mu.RUnlock()
	res := make([]ParseError, len(idx.parseErrors))
	copy(res, idx.parseErrors)
	return res
}

// FindByTag searches entities containing the tag.
// For Memos, tag matching checks `memo.Tags ∪ parentTask.Tags`.
func (idx *MemoryIndex) FindByTag(tag string) []EntityRef {
	idx.mu.RLock()
	defer idx.mu.RUnlock()

	var results []EntityRef
	targetTag := strings.TrimSpace(tag)

	// Search Tasks
	for id, t := range idx.tasks {
		if hasTag(t.Tags, targetTag) {
			results = append(results, EntityRef{
				Type:  EntityTypeTask,
				ID:    id,
				Title: t.Title,
				Path:  idx.idToFile[id],
			})
		}
	}

	// Search Notes
	for id, n := range idx.notes {
		if hasTag(n.Tags, targetTag) {
			results = append(results, EntityRef{
				Type:  EntityTypeNote,
				ID:    id,
				Title: n.Title,
				Path:  idx.idToFile[id],
			})
		}
	}

	// Search Memos
	for id, m := range idx.memos {
		ownMatch := hasTag(m.Tags, targetTag)
		if ownMatch {
			results = append(results, EntityRef{
				Type: EntityTypeMemo,
				ID:   id,
				Path: idx.idToFile[id],
			})
			continue
		}

		// Inherited tags from parent task
		if m.TaskID != "" {
			if parent, exists := idx.tasks[m.TaskID]; exists {
				if hasTag(parent.Tags, targetTag) {
					results = append(results, EntityRef{
						Type:      EntityTypeMemo,
						ID:        id,
						Path:      idx.idToFile[id],
						Inherited: true,
					})
				}
			}
		}
	}

	return results
}

func hasTag(tags []string, target string) bool {
	for _, t := range tags {
		if strings.EqualFold(strings.TrimSpace(t), target) {
			return true
		}
	}
	return false
}

// ClearPendingMove removes any pending move candidate for an entity ID.
func (idx *MemoryIndex) ClearPendingMove(id string) {
	idx.mu.Lock()
	defer idx.mu.Unlock()
	if idx.pendingMoves != nil {
		delete(idx.pendingMoves, id)
	}
}

// RemoveFile removes an entity associated with a path from the index.
func (idx *MemoryIndex) RemoveFile(absPath string) {
	idx.RemoveFileWithPromotion(absPath)
}

// RemoveFileWithPromotion removes an entity associated with a path from the index.
// If a pendingMove exists for this entity ID at a new path, it is promoted to the index.
// Returns deletedID, and if a pendingMove was promoted, promotedID, promotedPath and promotedType.
// 注释: 锁内执行 os.Stat 进行文件存在性探查持有锁 syscalls，在单用户桌面规模可接受；后续大 vault 场景可移出锁外双检.
func (idx *MemoryIndex) RemoveFileWithPromotion(absPath string) (deletedID, promotedID, promotedPath string, promotedType EntityType) {
	idx.mu.Lock()
	defer idx.mu.Unlock()

	id, ok := idx.fileToID[absPath]
	if ok {
		deletedID = id
		delete(idx.fileToID, absPath)
		// Only delete the entity if idToFile still points to this path (not already migrated)
		if idx.idToFile[id] == absPath {
			delete(idx.idToFile, id)
			delete(idx.tasks, id)
			delete(idx.memos, id)
			delete(idx.notes, id)
			delete(idx.dayPlans, id)
		}
	}
	delete(idx.baselines, absPath)

	// Check if there was a pending move for this entity ID
	if ok && idx.pendingMoves != nil {
		if pm, hasPending := idx.pendingMoves[id]; hasPending {
			delete(idx.pendingMoves, id)
			if _, err := os.Stat(pm.path); err == nil {
				idx.fileToID[pm.path] = id
				idx.idToFile[id] = pm.path
				idx.baselines[pm.path] = pm.baseline

				switch e := pm.entity.(type) {
				case *Task:
					idx.tasks[id] = e.Clone().(*Task)
				case *Memo:
					idx.memos[id] = e.Clone().(*Memo)
				case *Note:
					idx.notes[id] = e.Clone().(*Note)
				case *DayPlan:
					idx.dayPlans[id] = e.Clone().(*DayPlan)
				}

				idx.removeDuplicateParseErrorLocked(id, pm.path)
				promotedID = id
				promotedPath = pm.path
				promotedType = pm.entity.GetType()
			}
		}
	}

	idx.recomputeDanglingRefsLocked()
	return deletedID, promotedID, promotedPath, promotedType
}

func (idx *MemoryIndex) removeDuplicateParseErrorLocked(id, path string) {
	filtered := idx.parseErrors[:0]
	for _, pe := range idx.parseErrors {
		if pe.Path == path && strings.Contains(pe.Reason, fmt.Sprintf("duplicate entity ID collision '%s'", id)) {
			continue
		}
		filtered = append(filtered, pe)
	}
	idx.parseErrors = filtered
}

// PutEntity inserts or updates an entity in the index.
// 注释: 锁内执行 os.Stat 进行文件存在性探查持有锁 syscalls，在单用户桌面规模可接受；后续大 vault 场景可移出锁外双检.
func (idx *MemoryIndex) PutEntity(absPath string, entity Entity, baseline FileBaseline) {
	idx.mu.Lock()
	defer idx.mu.Unlock()

	// If old entity existed at this path, clear its ID mapping
	if oldID, exists := idx.fileToID[absPath]; exists && oldID != entity.GetID() {
		delete(idx.idToFile, oldID)
		delete(idx.tasks, oldID)
		delete(idx.memos, oldID)
		delete(idx.notes, oldID)
		delete(idx.dayPlans, oldID)
	}

	id := entity.GetID()
	if existingPath, exists := idx.idToFile[id]; exists && existingPath != absPath {
		// Check whether existingPath still exists on disk
		if _, err := os.Stat(existingPath); os.IsNotExist(err) {
			// existingPath no longer exists on disk: the entity was moved/renamed to absPath!
			delete(idx.fileToID, existingPath)
			delete(idx.baselines, existingPath)
			idx.removeDuplicateParseErrorLocked(id, absPath)
		} else {
			// existingPath still exists on disk.
			// Could be a duplicate ID collision, OR Create arrived before Remove in a move.
			if idx.pendingMoves == nil {
				idx.pendingMoves = make(map[string]pendingMove)
			}
			idx.pendingMoves[id] = pendingMove{
				path:     absPath,
				entity:   entity,
				baseline: baseline,
			}
			idx.parseErrors = append(idx.parseErrors, ParseError{
				Path:   absPath,
				Reason: fmt.Sprintf("duplicate entity ID collision '%s' (already declared in %s); update rejected", id, existingPath),
				Err:    fmt.Errorf("duplicate entity ID collision: %s", id),
			})
			return
		}
	}

	idx.fileToID[absPath] = id
	idx.idToFile[id] = absPath
	idx.baselines[absPath] = baseline
	if idx.pendingMoves != nil {
		delete(idx.pendingMoves, id)
	}

	switch e := entity.(type) {
	case *Task:
		idx.tasks[id] = e.Clone().(*Task)
	case *Memo:
		idx.memos[id] = e.Clone().(*Memo)
	case *Note:
		idx.notes[id] = e.Clone().(*Note)
	case *DayPlan:
		idx.dayPlans[id] = e.Clone().(*DayPlan)
	}

	idx.recomputeDanglingRefsLocked()
}

func (idx *MemoryIndex) recomputeDanglingRefsLocked() {
	var dangling []DanglingRef

	// 1. Memos referencing non-existent tasks
	for id, m := range idx.memos {
		if m.TaskID != "" {
			if _, exists := idx.tasks[m.TaskID]; !exists {
				dangling = append(dangling, DanglingRef{
					SourceType: EntityTypeMemo,
					SourceID:   id,
					SourcePath: idx.idToFile[id],
					TargetType: EntityTypeTask,
					TargetID:   m.TaskID,
					Reason:     fmt.Sprintf("parent task '%s' not found", m.TaskID),
				})
			}
		}
	}

	// 2. Tasks referencing non-existent notes
	for id, t := range idx.tasks {
		for _, noteID := range t.NoteIDs {
			if _, exists := idx.notes[noteID]; !exists {
				dangling = append(dangling, DanglingRef{
					SourceType: EntityTypeTask,
					SourceID:   id,
					SourcePath: idx.idToFile[id],
					TargetType: EntityTypeNote,
					TargetID:   noteID,
					Reason:     fmt.Sprintf("referenced note '%s' not found", noteID),
				})
			}
		}
	}

	// 3. DayPlans referencing non-existent tasks
	for date, p := range idx.dayPlans {
		for _, taskID := range p.TaskIDs {
			if _, exists := idx.tasks[taskID]; !exists {
				dangling = append(dangling, DanglingRef{
					SourceType: EntityTypeDayPlan,
					SourceID:   date,
					SourcePath: idx.idToFile[date],
					TargetType: EntityTypeTask,
					TargetID:   taskID,
					Reason:     fmt.Sprintf("planned task '%s' not found", taskID),
				})
			}
		}
	}

	idx.danglingRefs = dangling
}

// ScanVault walks a vault directory and rebuilds the memory index from scratch.
// Invalid YAML files are tracked in parseErrors without modifying or deleting them.
func ScanVault(vaultRoot string) (*MemoryIndex, error) {
	absRoot, err := filepath.Abs(vaultRoot)
	if err != nil {
		return nil, fmt.Errorf("failed to get absolute vault root: %w", err)
	}

	idx := NewMemoryIndex()
	var parseErrs []ParseError

	err = filepath.Walk(absRoot, func(path string, info os.FileInfo, err error) error {
		if err != nil {
			return err
		}
		if info.IsDir() {
			// Skip .git or temporary directories
			base := filepath.Base(path)
			if base == ".git" {
				return filepath.SkipDir
			}
			return nil
		}

		// Only process .md files (including .pata/plans/*.md)
		if filepath.Ext(path) != ".md" {
			return nil
		}

		// Ignore temporary swap/atomic files
		if strings.HasPrefix(filepath.Base(path), ".pata_tmp_") {
			return nil
		}

		data, readErr := os.ReadFile(path)
		if readErr != nil {
			parseErrs = append(parseErrs, ParseError{
				Path:   path,
				Reason: "failed to read file",
				Err:    readErr,
			})
			return nil
		}

		entity, parseErr := ParseMarkdown(path, data)
		if parseErr != nil {
			parseErrs = append(parseErrs, ParseError{
				Path:   path,
				Reason: "failed to parse markdown entity",
				Err:    parseErr,
			})
			return nil
		}

		baseline := FileBaseline{
			Path:    path,
			Hash:    ComputeContentHash(data),
			ModTime: info.ModTime(),
		}

		id := entity.GetID()
		if existingPath, exists := idx.idToFile[id]; exists && existingPath != path {
			// M2: Duplicate ID detected across different files.
			// Do not overwrite existing entity; isolate error in parseErrors to align with Invariant 6.
			parseErrs = append(parseErrs, ParseError{
				Path:   path,
				Reason: fmt.Sprintf("duplicate entity ID collision '%s' (already declared in %s); file ignored to prevent silent overwrite", id, existingPath),
				Err:    fmt.Errorf("duplicate entity ID collision: %s", id),
			})
			return nil
		}

		idx.fileToID[path] = id
		idx.idToFile[id] = path
		idx.baselines[path] = baseline

		switch e := entity.(type) {
		case *Task:
			idx.tasks[id] = e
		case *Memo:
			idx.memos[id] = e
		case *Note:
			idx.notes[id] = e
		case *DayPlan:
			idx.dayPlans[id] = e
		}

		return nil
	})

	if err != nil {
		return nil, fmt.Errorf("failed to scan vault: %w", err)
	}

	idx.mu.Lock()
	idx.parseErrors = parseErrs
	idx.recomputeDanglingRefsLocked()
	idx.mu.Unlock()

	return idx, nil
}
