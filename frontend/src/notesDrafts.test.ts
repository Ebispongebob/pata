import test from 'node:test';
import assert from 'node:assert/strict';
import type { Note } from '../bindings/pata/internal/storage/markdown/models.ts';

// Helper to partition and sort notes according to proposal 016
function partitionAndSortNotes(allNotes: Note[]): { drafts: Note[]; formal: Note[] } {
  const drafts = allNotes
    .filter((n) => Boolean(n.draft))
    .sort((a, b) => {
      const uDiff = new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime();
      if (uDiff !== 0) return uDiff;
      const cDiff = new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
      if (cDiff !== 0) return cDiff;
      return a.id.localeCompare(b.id);
    });

  const formal = allNotes
    .filter((n) => !n.draft)
    .sort((a, b) => {
      const uDiff = new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime();
      if (uDiff !== 0) return uDiff;
      const cDiff = new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
      if (cDiff !== 0) return cDiff;
      return a.id.localeCompare(b.id);
    });

  return { drafts, formal };
}

test('partitionAndSortNotes: groups drafts vs formal notes with independent descending order', () => {
  const notes: Note[] = [
    {
      id: 'note-1',
      title: '正式笔记 1',
      draft: false,
      created_at: '2026-10-26T10:00:00Z',
      updated_at: '2026-10-26T12:00:00Z',
    } as Note,
    {
      id: 'draft-1',
      title: '',
      draft: true,
      body: '草稿正文 1',
      created_at: '2026-10-26T11:00:00Z',
      updated_at: '2026-10-26T13:00:00Z',
    } as Note,
    {
      id: 'note-2',
      title: '正式笔记 2',
      draft: false,
      created_at: '2026-10-26T10:30:00Z',
      updated_at: '2026-10-26T14:00:00Z',
    } as Note,
    {
      id: 'draft-2',
      title: '',
      draft: true,
      body: '草稿正文 2',
      created_at: '2026-10-26T09:00:00Z',
      updated_at: '2026-10-26T15:00:00Z',
    } as Note,
  ];

  const { drafts, formal } = partitionAndSortNotes(notes);

  assert.equal(drafts.length, 2);
  assert.equal(formal.length, 2);

  // Drafts sorted by updated_at desc: draft-2 (15:00) then draft-1 (13:00)
  assert.equal(drafts[0].id, 'draft-2');
  assert.equal(drafts[1].id, 'draft-1');

  // Formal notes sorted by updated_at desc: note-2 (14:00) then note-1 (12:00)
  assert.equal(formal[0].id, 'note-2');
  assert.equal(formal[1].id, 'note-1');
});

test('Search overlay: draft note with empty title formats correctly as draft snippet', () => {
  const draftNote: Note = {
    id: 'draft-abc',
    title: '',
    draft: true,
    body: '## 架构规划\n这是第一条想法\n这是第二条想法',
    created_at: '2026-10-26T10:00:00Z',
    updated_at: '2026-10-26T10:00:00Z',
  } as Note;

  const displayTitle = draftNote.title?.trim() || '草稿';
  assert.equal(displayTitle, '草稿');

  const snippet = draftNote.body
    ?.split('\n')
    .map((l) => l.replace(/^#+\s*/, '').trim())
    .filter(Boolean)
    .slice(0, 2)
    .join(' ') || '';
  assert.equal(snippet, '架构规划 这是第一条想法');
});

test('focusNoteId consumption: waits for notes list to populate before clearing', () => {
  // Simulates the effect logic
  let notesLoaded = false;
  let notes: Note[] = [];
  let focusNoteId: string | null = 'draft-test-123';
  let cleared = false;
  let expandedDrafts = false;

  const runEffect = () => {
    if (!focusNoteId) return;
    if (!notesLoaded && notes.length === 0) return;
    const target = notes.find((n) => n.id === focusNoteId);
    if (target?.draft) {
      expandedDrafts = true;
    }
    cleared = true;
    focusNoteId = null;
  };

  // 1. Initial mount: notes empty, not loaded yet -> must NOT clear focusNoteId
  runEffect();
  assert.equal(cleared, false);
  assert.equal(focusNoteId, 'draft-test-123');
  assert.equal(expandedDrafts, false);

  // 2. Load completes with the target draft
  notes = [{ id: 'draft-test-123', draft: true, title: '', body: '草稿' } as Note];
  notesLoaded = true;
  runEffect();
  assert.equal(cleared, true);
  assert.equal(focusNoteId, null);
  assert.equal(expandedDrafts, true);
});

test('Chinese IME composition guard: prevents Enter from submitting during composition', () => {
  const isEnterPressedDuringComposition = (event: { key: string; isComposing: boolean; keyCode: number }) => {
    if (event.isComposing || event.keyCode === 229) return false;
    return event.key === 'Enter';
  };

  // Enter while composing pinyin (e.g. keyCode 229 or isComposing=true)
  assert.equal(isEnterPressedDuringComposition({ key: 'Enter', isComposing: true, keyCode: 229 }), false);
  assert.equal(isEnterPressedDuringComposition({ key: 'Enter', isComposing: true, keyCode: 13 }), false);
  assert.equal(isEnterPressedDuringComposition({ key: 'Enter', isComposing: false, keyCode: 229 }), false);

  // Real Enter after composition finished
  assert.equal(isEnterPressedDuringComposition({ key: 'Enter', isComposing: false, keyCode: 13 }), true);
});
