package markdown

import (
	"bytes"
	"fmt"
	"path/filepath"
	"strings"
	"time"

	"gopkg.in/yaml.v3"
)

// ParseError indicates a frontmatter or schema parsing failure.
type ParseError struct {
	Path   string `json:"path"`
	Reason string `json:"reason"`
	Err    error  `json:"err"`
}

func (e *ParseError) Error() string {
	if e.Path != "" {
		return fmt.Sprintf("parse error at %s: %s: %v", e.Path, e.Reason, e.Err)
	}
	return fmt.Sprintf("parse error: %s: %v", e.Reason, e.Err)
}

func (e *ParseError) Unwrap() error {
	return e.Err
}

// SplitFrontmatter splits raw markdown content into YAML frontmatter and body.
// It supports UTF-8 BOM. If no frontmatter delimiter "---" is found at start,
// yamlBytes will be nil, and bodyBytes will be the full content.
func SplitFrontmatter(content []byte) (yamlBytes []byte, bodyBytes []byte, hasFrontmatter bool, err error) {
	// Strip UTF-8 BOM if present
	content = bytes.TrimPrefix(content, []byte("\xef\xbb\xbf"))

	trimmed := bytes.TrimLeft(content, " \t\r\n")
	if !bytes.HasPrefix(trimmed, []byte("---")) {
		return nil, content, false, nil
	}

	// Find starting line end of the first "---"
	firstLineEnd := bytes.IndexByte(content, '\n')
	if firstLineEnd == -1 {
		return nil, nil, true, fmt.Errorf("unclosed frontmatter opening line")
	}

	header := bytes.TrimSpace(content[:firstLineEnd])
	if string(header) != "---" {
		return nil, content, false, nil
	}

	rest := content[firstLineEnd+1:]
	lines := bytes.Split(rest, []byte("\n"))

	var yamlLines [][]byte
	closingFound := false
	bodyStartIdx := 0

	for i, line := range lines {
		trimmedLine := bytes.TrimRight(line, "\r")
		if string(trimmedLine) == "---" {
			closingFound = true
			bodyStartIdx = i + 1
			break
		}
		yamlLines = append(yamlLines, line)
	}

	if !closingFound {
		return nil, nil, true, fmt.Errorf("unclosed frontmatter: missing closing '---'")
	}

	yamlPart := bytes.Join(yamlLines, []byte("\n"))
	var bodyPart []byte
	if bodyStartIdx < len(lines) {
		bodyPart = bytes.Join(lines[bodyStartIdx:], []byte("\n"))
		// If body starts with a newline, trim up to one leading newline to keep clean
		if len(bodyPart) > 0 && bodyPart[0] == '\r' {
			bodyPart = bodyPart[1:]
		}
		if len(bodyPart) > 0 && bodyPart[0] == '\n' {
			bodyPart = bodyPart[1:]
		}
	}

	return yamlPart, bodyPart, true, nil
}

// RawFrontmatter inspects only the type field of the YAML frontmatter.
type RawFrontmatter struct {
	Type EntityType `yaml:"type"`
}

func derivePlainMarkdownTitle(body, filePath string) string {
	lines := strings.Split(body, "\n")
	for _, line := range lines {
		trimmed := strings.TrimSpace(line)
		if strings.HasPrefix(trimmed, "# ") {
			t := strings.TrimSpace(strings.TrimPrefix(trimmed, "# "))
			if t != "" {
				return t
			}
		}
	}
	if filePath != "" {
		base := filepath.Base(filePath)
		ext := filepath.Ext(base)
		return strings.TrimSuffix(base, ext)
	}
	return "untitled"
}

// ParseMarkdown parses markdown bytes into a validated Entity.
// If path is provided, it is attached to ParseError.
func ParseMarkdown(filePath string, content []byte) (Entity, error) {
	yamlBytes, bodyBytes, hasFM, err := SplitFrontmatter(content)
	if err != nil {
		return nil, &ParseError{
			Path:   filePath,
			Reason: "frontmatter delimiter syntax error",
			Err:    err,
		}
	}

	if !hasFM {
		// H2: Ordinary markdown without frontmatter treated as Note.
		// Derive a deterministic placeholder ID from the file path to prevent index collision.
		var placeholderID string
		if filePath != "" {
			placeholderID = fmt.Sprintf("plain-%s", ComputeContentHash([]byte(filepath.Clean(filePath)))[:16])
		} else {
			placeholderID = fmt.Sprintf("plain-%s", ComputeContentHash(content)[:16])
		}
		title := derivePlainMarkdownTitle(string(content), filePath)
		now := time.Now()
		note := &Note{
			Type:      EntityTypeNote,
			ID:        placeholderID,
			Title:     title,
			CreatedAt: now,
			UpdatedAt: now,
			Body:      string(content),
		}
		return note, nil
	}

	var raw RawFrontmatter
	if err := yaml.Unmarshal(yamlBytes, &raw); err != nil {
		return nil, &ParseError{
			Path:   filePath,
			Reason: "invalid YAML in frontmatter",
			Err:    err,
		}
	}

	var entity Entity
	switch raw.Type {
	case EntityTypeTask:
		var task Task
		if err := yaml.Unmarshal(yamlBytes, &task); err != nil {
			return nil, &ParseError{
				Path:   filePath,
				Reason: "failed to decode task frontmatter",
				Err:    err,
			}
		}
		// Gracefully map legacy "doing" status to "todo"
		if task.Status == TaskStatusDoing {
			task.Status = TaskStatusTodo
		}
		// If task is done but completed_at is not set, infer from latest completed event or UpdatedAt
		if task.Status == TaskStatusDone && task.CompletedAt == nil {
			for i := len(task.StatusEvents) - 1; i >= 0; i-- {
				if task.StatusEvents[i].Action == StatusEventActionCompleted {
					t := task.StatusEvents[i].At
					task.CompletedAt = &t
					break
				}
			}
			if task.CompletedAt == nil && !task.UpdatedAt.IsZero() {
				t := task.UpdatedAt
				task.CompletedAt = &t
			}
		}
		task.Body = string(bodyBytes)
		if strings.Contains(task.Body, activityStartTag) {
			acts, err := ParseActivities(task.Body)
			if err != nil {
				return nil, &ParseError{
					Path:   filePath,
					Reason: "failed to parse activities in task body",
					Err:    err,
				}
			}
			task.Activities = acts
		} else if task.Description == "" && strings.TrimSpace(task.Body) != "" {
			// Legacy task with description in body: populate Description for compatibility during read
			task.Description = strings.TrimSpace(task.Body)
			task.Activities = []Activity{}
		} else {
			acts, err := ParseActivities(task.Body)
			if err != nil {
				return nil, &ParseError{
					Path:   filePath,
					Reason: "failed to parse activities in task body",
					Err:    err,
				}
			}
			task.Activities = acts
		}
		entity = &task

	case EntityTypeNote:
		var note Note
		if err := yaml.Unmarshal(yamlBytes, &note); err != nil {
			return nil, &ParseError{
				Path:   filePath,
				Reason: "failed to decode note frontmatter",
				Err:    err,
			}
		}
		note.Body = string(bodyBytes)
		entity = &note

	case EntityTypeDayPlan:
		var plan DayPlan
		if err := yaml.Unmarshal(yamlBytes, &plan); err != nil {
			return nil, &ParseError{
				Path:   filePath,
				Reason: "failed to decode day_plan frontmatter",
				Err:    err,
			}
		}
		plan.Body = string(bodyBytes)
		acts, err := ParseActivities(plan.Body)
		if err != nil {
			return nil, &ParseError{
				Path:   filePath,
				Reason: "failed to parse activities in day_plan body",
				Err:    err,
			}
		}
		plan.Activities = acts
		entity = &plan

	case "":
		return nil, &ParseError{
			Path:   filePath,
			Reason: "missing required 'type' field in frontmatter",
			Err:    fmt.Errorf("empty entity type"),
		}

	default:
		return nil, &ParseError{
			Path:   filePath,
			Reason: fmt.Sprintf("unsupported entity type '%s'", raw.Type),
			Err:    fmt.Errorf("unknown entity type: %s", raw.Type),
		}
	}

	// Validate entity schema
	if err := ValidateEntity(filePath, entity); err != nil {
		return nil, err
	}

	return entity, nil
}

// SerializeMarkdown converts an Entity into frontmatter + markdown body bytes.
// Unknown YAML fields stored in Extra are preserved verbatim.
func SerializeMarkdown(entity Entity) ([]byte, error) {
	if entity == nil {
		return nil, fmt.Errorf("cannot serialize nil entity")
	}

	var buf bytes.Buffer
	buf.WriteString("---\n")

	enc := yaml.NewEncoder(&buf)
	enc.SetIndent(2)

	var err error
	switch e := entity.(type) {
	case *Task:
		if e.Description == "" && !strings.Contains(e.Body, activityStartTag) && strings.TrimSpace(e.Body) != "" {
			e.Description = strings.TrimSpace(e.Body)
		}
		actBody, actErr := FormatActivities(e.Activities)
		if actErr != nil {
			return nil, fmt.Errorf("failed to format task activities: %w", actErr)
		}
		e.Body = actBody
		err = enc.Encode(e)
	case *Note:
		err = enc.Encode(e)
	case *DayPlan:
		actBody, actErr := FormatActivities(e.Activities)
		if actErr != nil {
			return nil, fmt.Errorf("failed to format day_plan activities: %w", actErr)
		}
		e.Body = actBody
		err = enc.Encode(e)
	default:
		err = enc.Encode(entity)
	}

	if err != nil {
		return nil, fmt.Errorf("failed to encode frontmatter: %w", err)
	}
	_ = enc.Close()

	buf.WriteString("---\n")
	body := entity.GetBody()
	if body != "" {
		buf.WriteString("\n")
		buf.WriteString(body)
		if !strings.HasSuffix(body, "\n") {
			buf.WriteString("\n")
		}
	}

	return buf.Bytes(), nil
}
