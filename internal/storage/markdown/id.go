package markdown

import (
	"crypto/rand"
	"fmt"
	"regexp"
	"strings"
	"sync"
	"time"
	"unicode"

	"github.com/oklog/ulid/v2"
)

var (
	entropyLock sync.Mutex
	entropyPool = ulid.Monotonic(rand.Reader, 0)
)

// GenerateULID generates a new monotonically increasing ULID string.
//
// Selection rationale for ULID over UUID:
// 1. Monotonic / Time-Sortable: The 48-bit millisecond timestamp prefix ensures
//    IDs sort chronologically by default, which is ideal for file browsing and list ordering.
// 2. Compact & URL-Safe: 26 characters in Crockford's Base32 format (avoids confusing
//    characters like I, L, O, U) vs 36 characters with hyphens in UUID.
// 3. Human Friendly: Shorter and cleaner when viewed in YAML frontmatter or logs.
func GenerateULID() string {
	entropyLock.Lock()
	defer entropyLock.Unlock()
	return ulid.MustNew(ulid.Timestamp(time.Now()), entropyPool).String()
}

// GenerateActivityID generates an activity ID with prefix "a-", e.g. "a-01j...".
func GenerateActivityID() string {
	return fmt.Sprintf("a-%s", strings.ToLower(GenerateULID()))
}

// GenerateEntityID generates a stable ID with an entity type prefix, e.g. "t-01J...", "m-01J...", "n-01J...", "a-01J...".
func GenerateEntityID(entityType EntityType) string {
	u := strings.ToLower(GenerateULID())
	switch entityType {
	case EntityTypeTask:
		return fmt.Sprintf("t-%s", u)
	case EntityTypeNote:
		return fmt.Sprintf("n-%s", u)
	case EntityTypeActivity:
		return fmt.Sprintf("a-%s", u)
	case EntityTypeDayPlan:
		return time.Now().Format("2006-01-02")
	default:
		return u
	}
}

var invalidPathChars = regexp.MustCompile(`[/\\:*?"<>|\x00-\x1f]`)

// SanitizeSlug sanitizes a human-readable title into a clean filename slug.
// It preserves UTF-8 Chinese characters, alphanumeric chars, underscores, and hyphens,
// while stripping path separators and filesystem reserved characters.
func SanitizeSlug(title string) string {
	s := strings.TrimSpace(title)
	if s == "" {
		return "untitled"
	}

	// Remove forbidden filesystem characters
	s = invalidPathChars.ReplaceAllString(s, "-")

	// Collapse multiple spaces or dashes
	var b strings.Builder
	lastWasDash := false
	for _, r := range s {
		if unicode.IsSpace(r) || r == '-' || r == '_' {
			if !lastWasDash && b.Len() > 0 {
				b.WriteRune('-')
				lastWasDash = true
			}
		} else {
			b.WriteRune(r)
			lastWasDash = false
		}
	}

	res := strings.Trim(b.String(), "-. ")
	if res == "" {
		return "untitled"
	}
	return res
}

// FormatEntityFilename returns a standard filename for an entity, containing a readable slug
// where applicable, but keeping IDs as the unique anchor.
func FormatEntityFilename(entity Entity) string {
	switch e := entity.(type) {
	case *Task:
		slug := SanitizeSlug(e.Title)
		return fmt.Sprintf("%s_%s.md", slug, e.ID)
	case *Note:
		slug := SanitizeSlug(e.Title)
		return fmt.Sprintf("%s_%s.md", slug, e.ID)
	case *DayPlan:
		return fmt.Sprintf("%s.md", e.Date)
	default:
		return fmt.Sprintf("%s.md", entity.GetID())
	}
}
