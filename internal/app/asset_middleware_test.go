package app

import (
	"bytes"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestAssetMiddleware_ServeFilesAndMedia(t *testing.T) {
	tmpDir, err := os.MkdirTemp("", "pata-asset-middleware-*")
	if err != nil {
		t.Fatal(err)
	}
	defer os.RemoveAll(tmpDir)

	filesDir := filepath.Join(tmpDir, "files")
	if err := os.MkdirAll(filesDir, 0755); err != nil {
		t.Fatal(err)
	}

	tasksDir := filepath.Join(tmpDir, "tasks")
	if err := os.MkdirAll(tasksDir, 0755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(tasksDir, "secret.md"), []byte("sensitive task"), 0644); err != nil {
		t.Fatal(err)
	}

	testPNG := filepath.Join(filesDir, "test.png")
	pngBytes := []byte{0x89, 'P', 'N', 'G', '\r', '\n', 0x1a, '\n', 0x00, 0x01}
	if err := os.WriteFile(testPNG, pngBytes, 0644); err != nil {
		t.Fatal(err)
	}

	testSubDir := filepath.Join(filesDir, "subdir")
	if err := os.MkdirAll(testSubDir, 0755); err != nil {
		t.Fatal(err)
	}
	subPNG := filepath.Join(testSubDir, "nested.png")
	if err := os.WriteFile(subPNG, pngBytes, 0644); err != nil {
		t.Fatal(err)
	}

	chinesePNG := filepath.Join(filesDir, "数据库架构图.png")
	if err := os.WriteFile(chinesePNG, pngBytes, 0644); err != nil {
		t.Fatal(err)
	}

	spacePNG := filepath.Join(filesDir, "architecture diagram.png")
	if err := os.WriteFile(spacePNG, pngBytes, 0644); err != nil {
		t.Fatal(err)
	}

	testAudio := filepath.Join(filesDir, "recording.mp3")
	audioBytes := []byte("fake mp3 data")
	if err := os.WriteFile(testAudio, audioBytes, 0644); err != nil {
		t.Fatal(err)
	}

	svc := NewVaultService()
	if _, err := svc.openVault(tmpDir); err != nil {
		t.Fatalf("failed to open vault: %v", err)
	}
	defer func() {
		if svc.stopWatcher != nil {
			svc.stopWatcher()
		}
	}()

	nextCalled := false
	fallbackHandler := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		nextCalled = true
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write([]byte("fallback next handler"))
	})

	middleware := createAssetMiddleware(svc)(fallbackHandler)

	t.Run("GET /files/test.png serves file", func(t *testing.T) {
		req := httptest.NewRequest(http.MethodGet, "/files/test.png", nil)
		rec := httptest.NewRecorder()
		middleware.ServeHTTP(rec, req)

		if rec.Code != http.StatusOK {
			t.Fatalf("expected 200, got %d", rec.Code)
		}
		if !bytes.Equal(rec.Body.Bytes(), pngBytes) {
			t.Errorf("served body does not match expected bytes")
		}
	})

	t.Run("HEAD /files/test.png returns 200 without body", func(t *testing.T) {
		req := httptest.NewRequest(http.MethodHead, "/files/test.png", nil)
		rec := httptest.NewRecorder()
		middleware.ServeHTTP(rec, req)

		if rec.Code != http.StatusOK {
			t.Fatalf("expected 200, got %d", rec.Code)
		}
		if rec.Body.Len() != 0 {
			t.Errorf("HEAD request should have empty body, got %d bytes", rec.Body.Len())
		}
	})

	t.Run("POST /files/test.png returns 405 Method Not Allowed", func(t *testing.T) {
		req := httptest.NewRequest(http.MethodPost, "/files/test.png", nil)
		rec := httptest.NewRecorder()
		middleware.ServeHTTP(rec, req)

		if rec.Code != http.StatusMethodNotAllowed {
			t.Fatalf("expected 405, got %d", rec.Code)
		}
	})

	t.Run("GET /files/missing.png returns 404", func(t *testing.T) {
		req := httptest.NewRequest(http.MethodGet, "/files/missing.png", nil)
		rec := httptest.NewRecorder()
		middleware.ServeHTTP(rec, req)

		if rec.Code != http.StatusNotFound {
			t.Fatalf("expected 404, got %d", rec.Code)
		}
	})

	t.Run("GET /files/ directory returns 404", func(t *testing.T) {
		req := httptest.NewRequest(http.MethodGet, "/files/", nil)
		rec := httptest.NewRecorder()
		middleware.ServeHTTP(rec, req)

		if rec.Code != http.StatusNotFound {
			t.Fatalf("expected 404 for directory, got %d", rec.Code)
		}
	})

	t.Run("Directory traversal via /files/../tasks/secret.md returns 404", func(t *testing.T) {
		req := httptest.NewRequest(http.MethodGet, "/files/../tasks/secret.md", nil)
		rec := httptest.NewRecorder()
		middleware.ServeHTTP(rec, req)

		// Note: net/http cleans URL paths, but even if relPath reaches handler,
		// restrictToFilesDir enforces files/ prefix.
		if rec.Code != http.StatusNotFound {
			body, _ := io.ReadAll(rec.Body)
			t.Fatalf("expected 404 for traversal, got %d: %s", rec.Code, string(body))
		}
	})

	t.Run("GET /files/subdir/nested.png serves nested file", func(t *testing.T) {
		req := httptest.NewRequest(http.MethodGet, "/files/subdir/nested.png", nil)
		rec := httptest.NewRecorder()
		middleware.ServeHTTP(rec, req)

		if rec.Code != http.StatusOK {
			t.Fatalf("expected 200, got %d", rec.Code)
		}
	})

	t.Run("GET /files/ with Chinese characters serves file", func(t *testing.T) {
		req := httptest.NewRequest(http.MethodGet, "/files/%E6%95%B0%E6%8D%AE%E5%BA%93%E6%9E%B6%E6%9E%84%E5%9B%BE.png", nil)
		rec := httptest.NewRecorder()
		middleware.ServeHTTP(rec, req)

		if rec.Code != http.StatusOK {
			t.Fatalf("expected 200, got %d", rec.Code)
		}
	})

	t.Run("GET /files/ with spaces in filename serves file", func(t *testing.T) {
		req := httptest.NewRequest(http.MethodGet, "/files/architecture%20diagram.png", nil)
		rec := httptest.NewRecorder()
		middleware.ServeHTTP(rec, req)

		if rec.Code != http.StatusOK {
			t.Fatalf("expected 200, got %d", rec.Code)
		}
	})

	t.Run("GET /vault-files/test.png serves file", func(t *testing.T) {
		req := httptest.NewRequest(http.MethodGet, "/vault-files/test.png", nil)
		rec := httptest.NewRecorder()
		middleware.ServeHTTP(rec, req)

		if rec.Code != http.StatusOK {
			t.Fatalf("expected 200, got %d", rec.Code)
		}
	})

	t.Run("GET /vault-files/files/test.png serves file", func(t *testing.T) {
		req := httptest.NewRequest(http.MethodGet, "/vault-files/files/test.png", nil)
		rec := httptest.NewRecorder()
		middleware.ServeHTTP(rec, req)

		if rec.Code != http.StatusOK {
			t.Fatalf("expected 200, got %d", rec.Code)
		}
	})

	t.Run("GET /vault-audio/files/recording.mp3 serves audio", func(t *testing.T) {
		req := httptest.NewRequest(http.MethodGet, "/vault-audio/files/recording.mp3", nil)
		rec := httptest.NewRecorder()
		middleware.ServeHTTP(rec, req)

		if rec.Code != http.StatusOK {
			t.Fatalf("expected 200, got %d", rec.Code)
		}
		if !bytes.Equal(rec.Body.Bytes(), audioBytes) {
			t.Errorf("served audio does not match")
		}
	})

	t.Run("GET /vditor/index.js falls through to next", func(t *testing.T) {
		nextCalled = false
		req := httptest.NewRequest(http.MethodGet, "/vditor/index.js", nil)
		rec := httptest.NewRecorder()
		middleware.ServeHTTP(rec, req)

		if !nextCalled {
			t.Errorf("expected fallback next handler to be called")
		}
		if !strings.Contains(rec.Body.String(), "fallback next handler") {
			t.Errorf("expected fallback response")
		}
	})
}
