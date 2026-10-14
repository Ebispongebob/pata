package markdown

import (
	"os"
	"path/filepath"
	"testing"
	"time"
)

func TestBacklinksDedupAndRoundtrip(t *testing.T) {
	root := t.TempDir()
	write := func(rel, content string) {
		p := filepath.Join(root, rel)
		if err := os.MkdirAll(filepath.Dir(p), 0o755); err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(p, []byte(content), 0o644); err != nil {
			t.Fatal(err)
		}
	}
	fm := func(typ, id, extra string) string {
		return "---\ntype: " + typ + "\nid: " + id + "\n" + extra + "created_at: 2026-01-01T00:00:00+08:00\nupdated_at: 2026-01-01T00:00:00+08:00\n---\n\n"
	}
	// 目标 A，另有同名 A2(同标题)用于验证绑定不靠标题猜
	write("notes/a.md", fm("note", "n-a", "title: Doris 部署\n"))
	write("notes/sub/a.md", fm("note", "n-a2", "title: Doris 部署\n"))
	// Note 来源：空格路径、跨目录、同一来源多次引用只算 1；代码块/图片/URL/自引用不计
	write("notes/b.md", fm("note", "n-b", "title: B\n")+
		"[x](./a.md) [y](./a.md#h)\n```\n[no](./sub/a.md)\n```\n`[no](./sub/a.md)` ![img](./a.md) [u](https://x/a.md)\n")
	write("notes/sub/c d.md", fm("note", "n-c", "title: C\n")+"[up](../a.md)\n[self](./c%20d.md)\n")
	// Task：描述绑定 + 评论 + 旧 note_ids 合并成一条
	write("tasks/t1.md", fm("task", "t-1", "title: T1\nstatus: todo\ndue: null\nnote_ids: [n-a]\nnote_refs:\n  Doris 部署: n-a\n")+"见 [[Doris 部署]] 与 \\[[Doris 部署]]\n")
	write("memos/m1.md", fm("memo", "m-1", "task_id: t-1\nnote_refs:\n  Doris 部署: n-a\n")+"[[Doris 部署]]\n")
	// 绑定到 A2 的任务：不能算到 A；未绑定同名(歧义)的任务：不解析
	write("tasks/t2.md", fm("task", "t-2", "title: T2\nstatus: todo\ndue: null\nnote_refs:\n  Doris 部署: n-a2\n")+"[[Doris 部署]]\n")
	write("tasks/t3.md", fm("task", "t-3", "title: T3\nstatus: todo\ndue: null\n")+"[[Doris 部署]]\n")
	// 父任务已删除的评论：不产生来源
	write("memos/m2.md", fm("memo", "m-2", "task_id: t-gone\nnote_refs:\n  Doris 部署: n-a\n")+"[[Doris 部署]]\n")

	v, err := NewVault(root)
	if err != nil {
		t.Fatal(err)
	}
	got := v.Index.Backlinks("n-a", root)
	want := map[string]bool{"note:n-b": true, "note:n-c": true, "task:t-1": true}
	if len(got) != len(want) {
		t.Fatalf("got %+v", got)
	}
	for _, s := range got {
		if !want[string(s.Type)+":"+s.ID] {
			t.Fatalf("unexpected source %+v", s)
		}
	}
	if g := v.Index.Backlinks("n-a2", root); len(g) != 1 || g[0].ID != "t-2" {
		t.Fatalf("n-a2: %+v", g)
	}

	// 删除目标后：绑定保留且失效；新建同名笔记不接管
	if err := v.DeleteEntity("n-a"); err != nil {
		t.Fatal(err)
	}
	n := &Note{Type: EntityTypeNote, ID: "n-new", Title: "Doris 部署", CreatedAt: time.Now(), UpdatedAt: time.Now()}
	if _, err := v.SaveEntity(n, nil); err != nil {
		t.Fatal(err)
	}
	if g := v.Index.Backlinks("n-new", root); len(g) != 0 {
		t.Fatalf("new note must not inherit: %+v", g)
	}

	// note_refs 序列化往返
	task, _ := v.Index.GetTask("t-1")
	data, err := SerializeMarkdown(task)
	if err != nil {
		t.Fatal(err)
	}
	e, err := ParseMarkdown("", data)
	if err != nil || e.(*Task).NoteRefs["Doris 部署"] != "n-a" {
		t.Fatalf("roundtrip: %v %+v", err, e)
	}
}
