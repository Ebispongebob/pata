package main

import (
	"context"
	"fmt"
	"strconv"
	"sync"
	"time"

	"github.com/wailsapp/wails/v3/pkg/application"
	"github.com/wailsapp/wails/v3/pkg/events"
)

type DraftWindowState struct {
	Vault          VaultStatus `json:"vault"`
	InitialDraftID string      `json:"initial_draft_id"`
}

type managedWindow struct {
	window     *application.WebviewWindow
	created    chan struct{}
	role       string
	ready      bool
	allowClose bool
	closing    bool
}

type windowRequest struct {
	windowID uint
	result   chan bool
}

// WindowService 管理原生窗口；编辑内容及版本仍由 VaultService 管理。
type WindowService struct {
	mu           sync.Mutex
	app          *application.App
	vault        *VaultService
	windows      map[string]*managedWindow
	requests     map[string]windowRequest
	sequence     uint64
	initialDraft string
	draftScope   string
	quitting     bool
	quitPending  bool
}

func newWindowService(vault *VaultService) *WindowService {
	return &WindowService{vault: vault, windows: make(map[string]*managedWindow), requests: make(map[string]windowRequest)}
}

func (s *WindowService) ensureWindow(role string) *managedWindow {
	s.mu.Lock()
	if existing := s.windows[role]; existing != nil {
		s.mu.Unlock()
		<-existing.created
		return existing
	}
	w := &managedWindow{role: role, created: make(chan struct{})}
	s.windows[role] = w
	s.mu.Unlock()
	// 创建窗口会同步调用原生主线程，不可持有保存确认也需要的状态锁。
	options := application.WebviewWindowOptions{
		Name: role, Title: "Pata", Width: 1120, Height: 740, MinWidth: 800, MinHeight: 520,
		Mac:              application.MacWindow{Backdrop: application.MacBackdropTranslucent, TitleBar: application.MacTitleBarHiddenInset},
		BackgroundColour: application.NewRGB(250, 250, 248), URL: "/",
	}
	if role == "draft" {
		options.Title = "Draft · Pata"
		options.URL = "/?window=draft"
	}
	window := s.app.Window.NewWithOptions(options)
	s.mu.Lock()
	w.window = window
	s.mu.Unlock()
	w.window.RegisterHook(events.Common.WindowClosing, func(event *application.WindowEvent) {
		s.mu.Lock()
		if w.allowClose || s.quitting {
			s.mu.Unlock()
			return
		}
		event.Cancel()
		if w.closing {
			s.mu.Unlock()
			return
		}
		w.closing = true
		s.mu.Unlock()
		go func() {
			err := s.prepare(w, "close")
			s.mu.Lock()
			w.closing = false
			w.allowClose = err == nil
			s.mu.Unlock()
			if err == nil {
				w.window.Close()
			} else {
				s.resume()
				w.window.Show().Focus()
			}
		}()
	})
	w.window.OnWindowEvent(events.Common.WindowClosing, func(_ *application.WindowEvent) {
		s.mu.Lock()
		if s.windows[role] == w {
			delete(s.windows, role)
		}
		for ticket, request := range s.requests {
			if request.windowID == w.window.ID() {
				request.result <- false
				delete(s.requests, ticket)
			}
		}
		s.mu.Unlock()
	})
	close(w.created)
	return w
}

func (s *WindowService) showMainWindow() {
	w := s.ensureWindow("main")
	w.window.UnMinimise()
	w.window.Show().Focus()
}

func (s *WindowService) ShowMainWindow() { s.showMainWindow() }

// OpenDraftWindow 复用单个独立工作区，并将指定草稿交给该窗口打开。
func (s *WindowService) OpenDraftWindow(vaultPath, id string) error {
	if _, err := s.vault.GetDraft(vaultPath, id); err != nil {
		return err
	}
	s.mu.Lock()
	s.initialDraft = id
	s.draftScope = vaultPath
	s.mu.Unlock()
	w := s.ensureWindow("draft")
	s.mu.Lock()
	ready := w.ready
	s.mu.Unlock()
	if ready {
		s.app.Event.Emit("draft:open-window", id)
	}
	w.window.UnMinimise()
	w.window.Show().Focus()
	return nil
}

func (s *WindowService) GetDraftWindowState() DraftWindowState {
	status := s.vault.GetVaultStatus()
	s.mu.Lock()
	id := s.initialDraft
	if status.Path != s.draftScope {
		id = ""
	}
	s.mu.Unlock()
	return DraftWindowState{Vault: status, InitialDraftID: id}
}

func (s *WindowService) WindowReady(ctx context.Context) error {
	window, ok := ctx.Value(application.WindowKey).(application.Window)
	if !ok {
		return fmt.Errorf("无法识别当前窗口")
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	for _, w := range s.windows {
		if w.window != nil && w.window.ID() == window.ID() {
			w.ready = true
			return nil
		}
	}
	return fmt.Errorf("当前窗口已关闭")
}

// 窗口只有在客户端确认保存成功后才可关闭；超时保留原窗口。
func (s *WindowService) prepare(w *managedWindow, action string) error {
	s.mu.Lock()
	if w.window == nil || !w.ready {
		s.mu.Unlock()
		return nil
	}
	s.sequence++
	ticket := strconv.FormatUint(s.sequence, 10)
	result := make(chan bool, 1)
	s.requests[ticket] = windowRequest{windowID: w.window.ID(), result: result}
	s.mu.Unlock()
	defer func() { s.mu.Lock(); delete(s.requests, ticket); s.mu.Unlock() }()
	s.app.Event.Emit("window:prepare", map[string]string{"role": w.role, "ticket": ticket, "action": action})
	select {
	case allowed := <-result:
		if allowed {
			return nil
		}
		return fmt.Errorf("草稿或当前页面尚未保存，请在编辑窗口处理后重试")
	case <-time.After(30 * time.Second):
		return fmt.Errorf("窗口保存未完成，已保留当前窗口")
	}
}

func (s *WindowService) CompleteRequest(ctx context.Context, ticket string, allowed bool) {
	window, ok := ctx.Value(application.WindowKey).(application.Window)
	if !ok {
		return
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	if request, ok := s.requests[ticket]; ok && request.windowID == window.ID() {
		request.result <- allowed
		delete(s.requests, ticket)
	}
}

func (s *WindowService) PrepareVaultChange() error {
	s.mu.Lock()
	w := s.windows["draft"]
	created := w != nil && w.window != nil
	s.mu.Unlock()
	if !created {
		return nil
	}
	if err := s.prepare(w, "vault-change"); err != nil {
		s.resume()
		w.window.Show().Focus()
		return err
	}
	return nil
}

func (s *WindowService) FinishVaultChange() { s.resume() }

func (s *WindowService) resume() { s.app.Event.Emit("window:resume", nil) }

func (s *WindowService) shouldQuit() bool {
	s.mu.Lock()
	if s.quitting {
		s.mu.Unlock()
		return true
	}
	if s.quitPending {
		s.mu.Unlock()
		return false
	}
	s.quitPending = true
	windows := make([]*managedWindow, 0, len(s.windows))
	for _, role := range []string{"draft", "main"} {
		// 已获准关闭的窗口可能正在等待原生销毁，不再向它发送保存请求。
		if w := s.windows[role]; w != nil && !w.allowClose {
			windows = append(windows, w)
		}
	}
	s.mu.Unlock()
	go func() {
		for _, w := range windows {
			if err := s.prepare(w, "quit"); err != nil {
				s.mu.Lock()
				s.quitPending = false
				s.mu.Unlock()
				s.resume()
				w.window.Show().Focus()
				return
			}
		}
		s.mu.Lock()
		s.quitting = true
		s.mu.Unlock()
		s.app.Quit()
	}()
	return false
}
