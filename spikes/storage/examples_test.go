package storage

import (
	"os"
	"path/filepath"
	"testing"
)

func TestParseExamples(t *testing.T) {
	// Find repo root examples directory
	examplesDir := filepath.Join("..", "..", "docs", "02-foundation", "examples")
	if _, err := os.Stat(examplesDir); os.IsNotExist(err) {
		t.Fatalf("examples dir does not exist at %s", examplesDir)
	}

	count := 0
	err := filepath.Walk(examplesDir, func(path string, info os.FileInfo, err error) error {
		if err != nil {
			return err
		}
		if info.IsDir() || filepath.Ext(path) != ".md" {
			return nil
		}

		data, err := os.ReadFile(path)
		if err != nil {
			t.Fatalf("failed to read %s: %v", path, err)
		}

		entity, err := ParseMarkdown(path, data)
		if err != nil {
			t.Fatalf("failed to parse example %s: %v", path, err)
		}

		// Verify round-trip serialization doesn't fail
		serialized, err := SerializeMarkdown(entity)
		if err != nil {
			t.Fatalf("failed to serialize example %s: %v", path, err)
		}

		// Parse the serialized data again to ensure round-trip fidelity
		roundTripEntity, err := ParseMarkdown(path, serialized)
		if err != nil {
			t.Fatalf("failed to parse round-tripped markdown of %s: %v", path, err)
		}

		if roundTripEntity.GetType() != entity.GetType() {
			t.Fatalf("type mismatch after round-trip: %s vs %s", roundTripEntity.GetType(), entity.GetType())
		}
		if roundTripEntity.GetID() != entity.GetID() {
			t.Fatalf("id mismatch after round-trip: %s vs %s", roundTripEntity.GetID(), entity.GetID())
		}

		count++
		t.Logf("Successfully parsed and verified: %s (type: %s, id: %s)", path, entity.GetType(), entity.GetID())
		return nil
	})

	if err != nil {
		t.Fatalf("Walk failed: %v", err)
	}

	if count < 6 {
		t.Fatalf("expected at least 6 example files, found %d", count)
	}
}
