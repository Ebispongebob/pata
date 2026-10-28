package markdown

import (
	"os"
	"path/filepath"
	"testing"
	"time"
)

func TestStopWatcherWaitsForActiveHandler(t *testing.T) {
	v, err := NewVault(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	if err := v.StopWatcher(); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		if err := v.StopWatcher(); err != nil {
			t.Error(err)
		}
	})

	for _, name := range []string{"first start", "restart"} {
		if !t.Run(name, func(t *testing.T) {
			path := filepath.Join(v.RootPath, "notes", name+".md")
			tmpPath := filepath.Join(t.TempDir(), "note.md")
			body := "# " + name
			if err := os.WriteFile(tmpPath, []byte(body), 0644); err != nil {
				t.Fatal(err)
			}
			if err := v.StartWatcher(); err != nil {
				t.Fatal(err)
			}

			// Hold the index update while the real filesystem event is being handled.
			v.Index.mu.Lock()
			locked := true
			defer func() {
				if locked {
					v.Index.mu.Unlock()
				}
			}()
			if err := os.Rename(tmpPath, path); err != nil {
				t.Fatal(err)
			}
			deadline := time.Now().Add(2 * time.Second)
			for v.MutationMu.TryLock() {
				v.MutationMu.Unlock()
				if time.Now().After(deadline) {
					t.Fatal("watch loop did not start handling the event")
				}
				time.Sleep(time.Millisecond)
			}

			stopped := make(chan error, 1)
			go func() { stopped <- v.StopWatcher() }()
			select {
			case <-v.stopCh:
			case <-time.After(2 * time.Second):
				t.Fatal("stop was not requested")
			}
			select {
			case err := <-stopped:
				t.Fatalf("StopWatcher returned before its handler finished: %v", err)
			case <-time.After(25 * time.Millisecond):
			}

			v.Index.mu.Unlock()
			locked = false
			select {
			case err := <-stopped:
				if err != nil {
					t.Fatal(err)
				}
			case <-time.After(2 * time.Second):
				t.Fatal("StopWatcher did not return after its handler finished")
			}
			baseline, ok := v.Index.GetBaseline(path)
			if !ok || baseline.Hash != ComputeContentHash([]byte(body)) {
				t.Fatal("StopWatcher returned before the index update completed")
			}
			if err := v.StopWatcher(); err != nil {
				t.Fatal(err)
			}
		}) {
			return
		}
	}
}
