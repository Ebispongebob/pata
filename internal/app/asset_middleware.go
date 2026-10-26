package app

import (
	"net/http"
	"os"
	"path/filepath"
	"strings"
)

// createAssetMiddleware intercepts requests to /files/, /vault-files/, and /vault-audio/
// to serve local vault media/files securely, falling back to next for frontend static assets.
func createAssetMiddleware(vaultService *VaultService) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			path := r.URL.Path
			if strings.HasPrefix(path, "/vault-audio/") {
				relPath := strings.TrimPrefix(path, "/vault-audio/")
				serveVaultAsset(w, r, vaultService, relPath, false)
				return
			}
			if strings.HasPrefix(path, "/vault-files/") {
				relPath := strings.TrimPrefix(path, "/vault-files/")
				relPath = strings.TrimPrefix(relPath, "/")
				if !strings.HasPrefix(relPath, "files/") {
					relPath = "files/" + relPath
				}
				serveVaultAsset(w, r, vaultService, relPath, true)
				return
			}
			if strings.HasPrefix(path, "/files/") {
				relPath := strings.TrimPrefix(path, "/")
				serveVaultAsset(w, r, vaultService, relPath, true)
				return
			}
			next.ServeHTTP(w, r)
		})
	}
}

func serveVaultAsset(w http.ResponseWriter, r *http.Request, vs *VaultService, relPath string, restrictToFilesDir bool) {
	if r.Method != http.MethodGet && r.Method != http.MethodHead {
		http.Error(w, "Method Not Allowed", http.StatusMethodNotAllowed)
		return
	}

	cleanRel := filepath.ToSlash(filepath.Clean(relPath))
	if restrictToFilesDir && !strings.HasPrefix(cleanRel, "files/") {
		http.NotFound(w, r)
		return
	}

	absPath, err := vs.resolveSafeFilePath(cleanRel)
	if err != nil {
		http.NotFound(w, r)
		return
	}

	fi, err := os.Stat(absPath)
	if err != nil || fi.IsDir() {
		http.NotFound(w, r)
		return
	}

	// Disable caching so local disk file edits/replacements are immediately visible
	w.Header().Set("Cache-Control", "no-cache, no-store, must-revalidate")
	w.Header().Set("Pragma", "no-cache")
	w.Header().Set("Expires", "0")

	http.ServeFile(w, r, absPath)
}
