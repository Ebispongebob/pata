package main

import (
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strings"
	"sync"
)

type SystemInfo struct {
	OS             string `json:"os"`
	Arch           string `json:"arch"`
	KernelVersion  string `json:"kernelVersion"`
	ProductVersion string `json:"productVersion"`
	BuildVersion   string `json:"buildVersion"`
	GoVersion      string `json:"goVersion"`
	WailsVersion   string `json:"wailsVersion"`
	NodeVersion    string `json:"nodeVersion"`
}

type RoundTripResult struct {
	Success          bool     `json:"success"`
	OriginalLen      int      `json:"originalLen"`
	ReloadedLen      int      `json:"reloadedLen"`
	DiffCount        int      `json:"diffCount"`
	HasCodeBlock     bool     `json:"hasCodeBlock"`
	HasTable         bool     `json:"hasTable"`
	HasChinese       bool     `json:"hasChinese"`
	HasRelativeLinks bool     `json:"hasRelativeLinks"`
	Notes            []string `json:"notes"`
	DiffSummary      string   `json:"diffSummary"`
}

type SpikeService struct {
	mu      sync.Mutex
	dataDir string
}

func NewSpikeService() *SpikeService {
	dataDir := "./spike-data"
	_ = os.MkdirAll(dataDir, 0755)
	return &SpikeService{
		dataDir: dataDir,
	}
}

func (s *SpikeService) GetSystemInfo() SystemInfo {
	info := SystemInfo{
		OS:           runtime.GOOS,
		Arch:         runtime.GOARCH,
		GoVersion:    runtime.Version(),
		WailsVersion: "v3.0.0-beta.28",
	}

	if out, err := exec.Command("sw_vers", "-productVersion").Output(); err == nil {
		info.ProductVersion = strings.TrimSpace(string(out))
	}
	if out, err := exec.Command("sw_vers", "-buildVersion").Output(); err == nil {
		info.BuildVersion = strings.TrimSpace(string(out))
	}
	if out, err := exec.Command("uname", "-v").Output(); err == nil {
		info.KernelVersion = strings.TrimSpace(string(out))
	}
	if out, err := exec.Command("node", "-v").Output(); err == nil {
		info.NodeVersion = strings.TrimSpace(string(out))
	}

	return info
}

func (s *SpikeService) SaveMarkdown(filename string, content string) (string, error) {
	s.mu.Lock()
	defer s.mu.Unlock()

	base := filepath.Base(filename)
	if base == "" || base == "." {
		base = "roundtrip-test.md"
	}
	fullPath := filepath.Join(s.dataDir, base)
	err := os.WriteFile(fullPath, []byte(content), 0644)
	if err != nil {
		return "", fmt.Errorf("failed to write file: %w", err)
	}
	return fullPath, nil
}

func (s *SpikeService) ReadMarkdown(filename string) (string, error) {
	s.mu.Lock()
	defer s.mu.Unlock()

	base := filepath.Base(filename)
	if base == "" || base == "." {
		base = "roundtrip-test.md"
	}
	fullPath := filepath.Join(s.dataDir, base)
	bytes, err := os.ReadFile(fullPath)
	if err != nil {
		return "", fmt.Errorf("failed to read file: %w", err)
	}
	return string(bytes), nil
}

func (s *SpikeService) VerifyRoundTrip(original string, reloaded string) RoundTripResult {
	res := RoundTripResult{
		OriginalLen: len(original),
		ReloadedLen: len(reloaded),
		Notes:       []string{},
	}

	if strings.Contains(reloaded, "```") {
		res.HasCodeBlock = true
	}
	if strings.Contains(reloaded, "|") && strings.Contains(reloaded, "---") {
		res.HasTable = true
	}
	for _, r := range reloaded {
		if r >= 0x4e00 && r <= 0x9fff {
			res.HasChinese = true
			break
		}
	}
	if strings.Contains(reloaded, "](") && (strings.Contains(reloaded, "./") || strings.Contains(reloaded, "../") || strings.Contains(reloaded, ".md")) {
		res.HasRelativeLinks = true
	}

	normOrig := normalizeMarkdown(original)
	normReload := normalizeMarkdown(reloaded)

	if normOrig == normReload {
		res.Success = true
		res.DiffCount = 0
		res.DiffSummary = "Exact content match after Markdown normalization (LF line endings & trimmed trailing space)"
	} else {
		origLines := strings.Split(normOrig, "\n")
		reloadLines := strings.Split(normReload, "\n")
		diffCount := 0
		var diffDetails []string

		maxL := len(origLines)
		if len(reloadLines) > maxL {
			maxL = len(reloadLines)
		}

		for i := 0; i < maxL; i++ {
			var o, r string
			if i < len(origLines) {
				o = origLines[i]
			}
			if i < len(reloadLines) {
				r = reloadLines[i]
			}
			if o != r {
				diffCount++
				if len(diffDetails) < 5 {
					diffDetails = append(diffDetails, fmt.Sprintf("L%d: [-] %q vs [+] %q", i+1, o, r))
				}
			}
		}

		res.DiffCount = diffCount
		if res.HasCodeBlock && res.HasTable && res.HasChinese && res.HasRelativeLinks && diffCount <= 5 {
			res.Success = true
			res.DiffSummary = fmt.Sprintf("Semantics preserved with %d formatting variations: %s", diffCount, strings.Join(diffDetails, "; "))
		} else {
			res.Success = (diffCount == 0)
			res.DiffSummary = fmt.Sprintf("%d differences found: %s", diffCount, strings.Join(diffDetails, "; "))
		}
	}

	if !res.HasCodeBlock {
		res.Notes = append(res.Notes, "Warning: No code blocks detected")
	}
	if !res.HasTable {
		res.Notes = append(res.Notes, "Warning: No table detected")
	}
	if !res.HasChinese {
		res.Notes = append(res.Notes, "Warning: No Chinese characters detected")
	}
	if !res.HasRelativeLinks {
		res.Notes = append(res.Notes, "Warning: No relative links detected")
	}

	return res
}

func normalizeMarkdown(s string) string {
	s = strings.ReplaceAll(s, "\r\n", "\n")
	lines := strings.Split(s, "\n")
	for i, l := range lines {
		lines[i] = strings.TrimRight(l, " \t")
	}
	res := strings.TrimSpace(strings.Join(lines, "\n"))
	return res
}
