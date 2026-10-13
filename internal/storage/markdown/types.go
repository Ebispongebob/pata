package markdown

import (
	"time"

	"gopkg.in/yaml.v3"
)

// EntityType represents the type of a Pata entity.
type EntityType string

const (
	EntityTypeTask    EntityType = "task"
	EntityTypeMemo    EntityType = "memo"
	EntityTypeNote    EntityType = "note"
	EntityTypeDayPlan EntityType = "day_plan"
)

// TaskStatus represents the current status of a task.
type TaskStatus string

const (
	TaskStatusTodo  TaskStatus = "todo"
	TaskStatusDoing TaskStatus = "doing"
	TaskStatusDone  TaskStatus = "done"
)

// StatusEventAction represents actions recorded in task status events.
type StatusEventAction string

const (
	StatusEventActionCompleted StatusEventAction = "completed"
	StatusEventActionReopened  StatusEventAction = "reopened"
)

// StatusEvent records completion and reopen events.
type StatusEvent struct {
	Action StatusEventAction `yaml:"action" json:"action"`
	At     time.Time         `yaml:"at" json:"at"`
}

// Entity is the common interface implemented by all Pata Markdown entities.
type Entity interface {
	GetType() EntityType
	GetID() string
	GetBody() string
	SetBody(body string)
	GetExtra() map[string]yaml.Node
	Clone() Entity
}

// Task represents a task item.
type Task struct {
	Type         EntityType           `yaml:"type" json:"type"`
	ID           string               `yaml:"id" json:"id"`
	Title        string               `yaml:"title" json:"title"`
	Status       TaskStatus           `yaml:"status" json:"status"`
	Due          *string              `yaml:"due" json:"due"` // YYYY-MM-DD or nil
	Tags         []string             `yaml:"tags,omitempty" json:"tags,omitempty"`
	NoteIDs      []string             `yaml:"note_ids,omitempty" json:"note_ids,omitempty"`
	CreatedAt    time.Time            `yaml:"created_at" json:"created_at"`
	UpdatedAt    time.Time            `yaml:"updated_at" json:"updated_at"`
	StatusEvents []StatusEvent        `yaml:"status_events,omitempty" json:"status_events,omitempty"`
	Extra        map[string]yaml.Node `yaml:",inline" json:"-"`
	Body         string               `yaml:"-" json:"body"`
}

func (t *Task) GetType() EntityType            { return EntityTypeTask }
func (t *Task) GetID() string                  { return t.ID }
func (t *Task) GetBody() string                { return t.Body }
func (t *Task) SetBody(body string)            { t.Body = body }
func (t *Task) GetExtra() map[string]yaml.Node { return t.Extra }
func (t *Task) Clone() Entity {
	cp := *t
	if t.Due != nil {
		d := *t.Due
		cp.Due = &d
	}
	if t.Tags != nil {
		cp.Tags = append([]string(nil), t.Tags...)
	}
	if t.NoteIDs != nil {
		cp.NoteIDs = append([]string(nil), t.NoteIDs...)
	}
	if t.StatusEvents != nil {
		cp.StatusEvents = append([]StatusEvent(nil), t.StatusEvents...)
	}
	if t.Extra != nil {
		cp.Extra = make(map[string]yaml.Node, len(t.Extra))
		for k, v := range t.Extra {
			cp.Extra[k] = v
		}
	}
	return &cp
}

// Memo represents a short memo or task comment.
type Memo struct {
	Type      EntityType           `yaml:"type" json:"type"`
	ID        string               `yaml:"id" json:"id"`
	TaskID    string               `yaml:"task_id,omitempty" json:"task_id,omitempty"`
	CreatedAt time.Time            `yaml:"created_at" json:"created_at"`
	Tags      []string             `yaml:"tags,omitempty" json:"tags,omitempty"`
	Extra     map[string]yaml.Node `yaml:",inline" json:"-"`
	Body      string               `yaml:"-" json:"body"`
}

func (m *Memo) GetType() EntityType            { return EntityTypeMemo }
func (m *Memo) GetID() string                  { return m.ID }
func (m *Memo) GetBody() string                { return m.Body }
func (m *Memo) SetBody(body string)            { m.Body = body }
func (m *Memo) GetExtra() map[string]yaml.Node { return m.Extra }
func (m *Memo) Clone() Entity {
	cp := *m
	if m.Tags != nil {
		cp.Tags = append([]string(nil), m.Tags...)
	}
	if m.Extra != nil {
		cp.Extra = make(map[string]yaml.Node, len(m.Extra))
		for k, v := range m.Extra {
			cp.Extra[k] = v
		}
	}
	return &cp
}

// Note represents a markdown note.
type Note struct {
	Type      EntityType           `yaml:"type" json:"type"`
	ID        string               `yaml:"id" json:"id"`
	Title     string               `yaml:"title" json:"title"`
	Tags      []string             `yaml:"tags,omitempty" json:"tags,omitempty"`
	CreatedAt time.Time            `yaml:"created_at" json:"created_at"`
	UpdatedAt time.Time            `yaml:"updated_at" json:"updated_at"`
	Extra     map[string]yaml.Node `yaml:",inline" json:"-"`
	Body      string               `yaml:"-" json:"body"`
}

func (n *Note) GetType() EntityType            { return EntityTypeNote }
func (n *Note) GetID() string                  { return n.ID }
func (n *Note) GetBody() string                { return n.Body }
func (n *Note) SetBody(body string)            { n.Body = body }
func (n *Note) GetExtra() map[string]yaml.Node { return n.Extra }
func (n *Note) Clone() Entity {
	cp := *n
	if n.Tags != nil {
		cp.Tags = append([]string(nil), n.Tags...)
	}
	if n.Extra != nil {
		cp.Extra = make(map[string]yaml.Node, len(n.Extra))
		for k, v := range n.Extra {
			cp.Extra[k] = v
		}
	}
	return &cp
}

// DayPlan represents a daily plan stored in .pata/plans/YYYY-MM-DD.md.
type DayPlan struct {
	Type    EntityType           `yaml:"type" json:"type"`
	Date    string               `yaml:"date" json:"date"` // YYYY-MM-DD
	TaskIDs []string             `yaml:"task_ids" json:"task_ids"`
	Extra   map[string]yaml.Node `yaml:",inline" json:"-"`
	Body    string               `yaml:"-" json:"body"`
}

func (d *DayPlan) GetType() EntityType            { return EntityTypeDayPlan }
func (d *DayPlan) GetID() string                  { return d.Date } // DayPlan uses date as ID
func (d *DayPlan) GetBody() string                { return d.Body }
func (d *DayPlan) SetBody(body string)            { d.Body = body }
func (d *DayPlan) GetExtra() map[string]yaml.Node { return d.Extra }
func (d *DayPlan) Clone() Entity {
	cp := *d
	if d.TaskIDs != nil {
		cp.TaskIDs = append([]string(nil), d.TaskIDs...)
	}
	if d.Extra != nil {
		cp.Extra = make(map[string]yaml.Node, len(d.Extra))
		for k, v := range d.Extra {
			cp.Extra[k] = v
		}
	}
	return &cp
}

// FileBaseline records file identity and content baseline for optimistic concurrency.
type FileBaseline struct {
	Path    string    `json:"path"`
	Hash    string    `json:"hash"`
	ModTime time.Time `json:"mod_time"`
}
