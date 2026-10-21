import test from 'node:test';
import assert from 'node:assert/strict';

// Helper reproduction matching NotesView logic
function isAudioTranscriptNote(note?: { audio_transcript?: boolean; audio_file?: string } | null): boolean {
  return Boolean(note && note.audio_transcript && note.audio_file && note.audio_file.trim().length > 0);
}

function getNoteExcerpt(title: string, body?: string): string {
  if (!body) return '';
  const lines = body.split('\n');
  let startIdx = 0;
  if (lines.length > 0) {
    const firstLine = lines[0].trim();
    if (firstLine.startsWith('#')) {
      const headingText = firstLine.replace(/^#+\s*/, '').trim();
      if (headingText.toLowerCase() === title.trim().toLowerCase()) {
        startIdx = 1;
      }
    }
  }
  const remaining = lines.slice(startIdx).join(' ');
  const cleaned = remaining
    .replace(/[#*`>_~\[\]]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  return cleaned;
}

test('isAudioTranscriptNote: correctly identifies transcript notes vs regular notes', () => {
  assert.equal(isAudioTranscriptNote(null), false);
  assert.equal(isAudioTranscriptNote({}), false);
  assert.equal(isAudioTranscriptNote({ audio_transcript: false }), false);
  assert.equal(isAudioTranscriptNote({ audio_transcript: true, audio_file: '' }), false);
  assert.equal(isAudioTranscriptNote({ audio_transcript: true, audio_file: '   ' }), false);
  assert.equal(isAudioTranscriptNote({ audio_transcript: true, audio_file: 'files/audio.m4a' }), true);
});

test('getNoteExcerpt: strips leading duplicate title heading and cleans markdown tokens', () => {
  const body1 = '# 系统架构\n这是核心架构设计的正文，包含**重点**与`代码`。';
  assert.equal(getNoteExcerpt('系统架构', body1), '这是核心架构设计的正文，包含重点与代码。');

  // When heading does not match title, keep it
  const body2 = '# 另一部分\n这是其他内容。';
  assert.equal(getNoteExcerpt('系统架构', body2), '另一部分 这是其他内容。');

  // Empty or whitespace body
  assert.equal(getNoteExcerpt('标题', ''), '');
  assert.equal(getNoteExcerpt('标题', undefined), '');

  // Strip complex markdown tokens
  const body3 = '> 引用文字\n- [ ] 待办项\n~~删除文字~~';
  assert.equal(getNoteExcerpt('测试', body3), '引用文字 - 待办项 删除文字');
});
