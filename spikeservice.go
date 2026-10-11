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
	// B-L4 注释: Spike 已知限制: dataDir 使用相对路径 "./spike-data"，在 macOS .app 打包由 Finder
	// 双击启动时，若进程当前工作目录 (cwd) 为只读区域，可能导致落盘报错。正式阶段须使用系统规范路径或 Vault 绝对路径。
	dataDir := "./spike-data"
	// B-L4 注释: MkdirAll 错误在此静默忽略，属 Spike 简化处理，真实写盘失败会在 SaveMarkdown 显式返回详细 error。
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

// VerifyRoundTrip 收紧自动断言：要求逐行 diff == 0 且精确比对表格对齐符号
func (s *SpikeService) VerifyRoundTrip(original string, reloaded string) RoundTripResult {
	res := RoundTripResult{
		OriginalLen: len(original),
		ReloadedLen: len(reloaded),
		Notes:       []string{
			"自动化断言仅覆盖存在性与逐行严格文本比对；深层 Markdown AST 结构等价性为人工实机验证",
		},
	}

	// 1. 代码块检测
	if strings.Contains(reloaded, "```go") && strings.Contains(reloaded, "```typescript") {
		res.HasCodeBlock = true
	}
	// 2. 表格与对齐符号精确检测
	if strings.Contains(reloaded, "|") && strings.Contains(reloaded, ":---") && strings.Contains(reloaded, ":---:") {
		res.HasTable = true
	}
	// 3. 中文文字与标点检测
	hasCJK := false
	for _, r := range reloaded {
		if r >= 0x4e00 && r <= 0x9fff {
			hasCJK = true
			break
		}
	}
	if hasCJK && strings.Contains(reloaded, "“") && strings.Contains(reloaded, "”") {
		res.HasChinese = true
	}
	// 4. 相对链接检测
	if strings.Contains(reloaded, "./tasks/") && strings.Contains(reloaded, "../") {
		res.HasRelativeLinks = true
	}

	normOrig := normalizeMarkdown(original)
	normReload := normalizeMarkdown(reloaded)

	// 计算严格逐行差异
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

	// B-M1 收紧断言：严格要求逐行 diff == 0，不再允许 diffCount <= 5 模糊放行
	if diffCount == 0 && res.HasCodeBlock && res.HasTable && res.HasChinese && res.HasRelativeLinks {
		res.Success = true
		res.DiffSummary = "Exact match: 0 line differences, all structural tokens (codeblocks/table-alignments/CJK/relative-links) verified"
	} else {
		res.Success = false
		res.DiffSummary = fmt.Sprintf("Mismatch: %d line diffs found: %s", diffCount, strings.Join(diffDetails, "; "))
	}

	if !res.HasCodeBlock {
		res.Notes = append(res.Notes, "Warning: Specific language code blocks (```go, ```typescript) not fully detected")
	}
	if !res.HasTable {
		res.Notes = append(res.Notes, "Warning: Table alignment tokens (| :--- | :---:) not fully detected")
	}
	if !res.HasChinese {
		res.Notes = append(res.Notes, "Warning: Chinese CJK or full-width punctuation not detected")
	}
	if !res.HasRelativeLinks {
		res.Notes = append(res.Notes, "Warning: Relative links (./tasks/, ../) not detected")
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
