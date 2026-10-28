package app

import (
	"context"
	"encoding/json"
	"strings"
	"testing"
	"time"

	"github.com/modelcontextprotocol/go-sdk/mcp"
	"pata/internal/storage/markdown"
)

func TestTaskIDFromReference(t *testing.T) {
	for _, tc := range []struct {
		input string
		want  string
	}{
		{"t-01abc", "t-01abc"},
		{"  pata://task/t-01abc  ", "t-01abc"},
		{"t-test-001", "t-test-001"},
	} {
		got, err := taskIDFromReference(tc.input)
		if err != nil || got != tc.want {
			t.Fatalf("taskIDFromReference(%q) = %q, %v; want %q", tc.input, got, err, tc.want)
		}
	}
	for _, input := range []string{
		"", "n-01abc", "pata://note/n-01abc", "pata://task/",
		"pata://task/t-01abc/extra", "pata://task/t-01abc?x=1",
		"pata://task/t-01abc#fragment", "pata://task/t-01abc%20",
	} {
		if _, err := taskIDFromReference(input); err == nil {
			t.Errorf("expected invalid task reference %q to fail", input)
		}
	}
}

func TestMCPTaskURIReadsActivityAndReferencedNote(t *testing.T) {
	v, err := markdown.NewVault(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	service := &VaultService{vault: v}
	note, err := service.CreateNote(CreateNoteInput{Title: "设计方案", Body: "笔记的完整正文"})
	if err != nil {
		t.Fatal(err)
	}
	task, err := service.CreateTask(CreateTaskInput{
		Title: "编辑器调整", Description: "参考 [[设计方案]]",
		NoteRefs: map[string]string{"设计方案": note.ID},
	})
	if err != nil {
		t.Fatal(err)
	}
	_, err = service.CreateActivity(CreateActivityInput{
		TaskID: task.ID, Body: "实现前先阅读 [[设计方案]]",
		NoteRefs: map[string]string{"设计方案": note.ID},
	})
	if err != nil {
		t.Fatal(err)
	}

	rt := &mcpRuntime{active: true, vault: v}
	server := newPataMCPServer(service, rt)
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	st, ct := mcp.NewInMemoryTransports()
	ss, err := server.Connect(ctx, st, nil)
	if err != nil {
		t.Fatal(err)
	}
	defer ss.Close()
	cs, err := mcp.NewClient(&mcp.Implementation{Name: "test", Version: "1"}, nil).Connect(ctx, ct, nil)
	if err != nil {
		t.Fatal(err)
	}
	defer cs.Close()

	uri := pataTaskURIPrefix + task.ID
	templateFound := false
	for template, iterErr := range cs.ResourceTemplates(ctx, nil) {
		if iterErr != nil {
			t.Fatal(iterErr)
		}
		if template.URITemplate == pataTaskURIPrefix+"{id}" {
			templateFound = true
		}
	}
	if !templateFound {
		t.Fatal("Pata task resource template not registered")
	}

	resource, err := cs.ReadResource(ctx, &mcp.ReadResourceParams{URI: uri})
	if err != nil || len(resource.Contents) != 1 {
		t.Fatalf("read task resource failed: %+v, %v", resource, err)
	}
	if resource.Contents[0].MIMEType != "application/json" {
		t.Fatalf("unexpected task resource MIME type: %s", resource.Contents[0].MIMEType)
	}
	var fromResource markdown.Task
	if err := json.Unmarshal([]byte(resource.Contents[0].Text), &fromResource); err != nil {
		t.Fatal(err)
	}
	if fromResource.ID != task.ID || len(fromResource.Activities) != 1 || fromResource.Activities[0].NoteRefs["设计方案"] != note.ID {
		t.Fatalf("resource lost task activity note references: %+v", fromResource)
	}

	callRead := func(kind, id string, out any) {
		t.Helper()
		result, err := cs.CallTool(ctx, &mcp.CallToolParams{
			Name: "pata_read", Arguments: map[string]any{"kind": kind, "id": id},
		})
		if err != nil || result.IsError {
			t.Fatalf("pata_read %q failed: %+v, %v", id, result, err)
		}
		var envelope struct {
			Data json.RawMessage `json:"data"`
		}
		if err := json.Unmarshal([]byte(result.Content[0].(*mcp.TextContent).Text), &envelope); err != nil {
			t.Fatal(err)
		}
		if err := json.Unmarshal(envelope.Data, out); err != nil {
			t.Fatal(err)
		}
	}
	for _, reference := range []string{task.ID, uri} {
		var readTask markdown.Task
		callRead("task", reference, &readTask)
		if readTask.ID != task.ID || len(readTask.Activities) != 1 || readTask.Activities[0].NoteRefs["设计方案"] != note.ID {
			t.Fatalf("pata_read %q lost activity reference: %+v", reference, readTask)
		}
	}
	var readNote markdown.Note
	callRead("note", note.ID, &readNote)
	if readNote.ID != note.ID || !strings.Contains(readNote.Body, "笔记的完整正文") {
		t.Fatalf("pata_read did not return referenced note body: %+v", readNote)
	}

	bad, err := cs.CallTool(ctx, &mcp.CallToolParams{
		Name: "pata_read", Arguments: map[string]any{"kind": "task", "id": "pata://task/" + note.ID},
	})
	if err == nil && !bad.IsError {
		t.Fatal("invalid Task URI unexpectedly succeeded")
	}
	if _, err := cs.ReadResource(ctx, &mcp.ReadResourceParams{URI: pataTaskURIPrefix + "t-missing"}); err == nil {
		t.Fatal("missing task resource unexpectedly succeeded")
	}

	t.Run("stopped runtime rejects resource reads", func(t *testing.T) {
		rt.gate.Lock()
		rt.active = false
		rt.gate.Unlock()
		defer func() {
			rt.gate.Lock()
			rt.active = true
			rt.gate.Unlock()
		}()

		if _, err := cs.ReadResource(ctx, &mcp.ReadResourceParams{URI: uri}); err == nil || !strings.Contains(err.Error(), "MCP 服务已停止") {
			t.Fatalf("expected stopped runtime error, got %v", err)
		}
	})

	t.Run("old session cannot read a task in the new vault", func(t *testing.T) {
		otherVault, err := markdown.NewVault(t.TempDir())
		if err != nil {
			t.Fatal(err)
		}
		otherService := &VaultService{vault: otherVault}
		otherTask, err := otherService.CreateTask(CreateTaskInput{Title: "新资料库的任务"})
		if err != nil {
			t.Fatal(err)
		}
		service.externalMu.Lock()
		service.mu.Lock()
		service.vault = otherVault
		service.mu.Unlock()
		service.externalMu.Unlock()
		defer func() {
			service.externalMu.Lock()
			service.mu.Lock()
			service.vault = v
			service.mu.Unlock()
			service.externalMu.Unlock()
		}()

		otherURI := pataTaskURIPrefix + otherTask.ID
		if _, err := cs.ReadResource(ctx, &mcp.ReadResourceParams{URI: otherURI}); err == nil || !strings.Contains(err.Error(), "资料库已更换") {
			t.Fatalf("expected vault switch error, got %v", err)
		}
	})
}
