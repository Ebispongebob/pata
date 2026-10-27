import test from 'node:test';
import assert from 'node:assert/strict';

import { componentCallbacks } from '../scripts/componentCallbacks.ts';

const callback = componentCallbacks(new URL('./NotesView.tsx', import.meta.url));
const isAudioTranscriptNote = callback('isAudioTranscriptNote');
const getNoteExcerpt = callback('getNoteExcerpt');
const getDraftExcerpt = callback('getDraftExcerpt');

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

test('getDraftExcerpt: returns up to 2 clean lines without markdown syntax', () => {
  assert.equal(getDraftExcerpt(''), '');
  assert.equal(getDraftExcerpt(undefined), '');
  assert.equal(getDraftExcerpt('   \n\n  '), '');

  // Markdown heading, task item, and links stripped
  const body1 = '# 第一行思考\n- [x] 完成任务项 [链接](http://example.com)\n> 第三行引用';
  assert.equal(
    getDraftExcerpt(body1),
    '第一行思考\n完成任务项 链接'
  );

  // Wiki link and formatting stripped
  const body2 = '这是包含 [[WikiNote|别名]] 和 `code` 与 **加粗** 的草稿\n第二行内容\n第三行内容被截断';
  assert.equal(
    getDraftExcerpt(body2),
    '这是包含 WikiNote 和 code 与 加粗 的草稿\n第二行内容'
  );

  // Blank lines skipped
  const body3 = '\n\n  \n第一行实际内容\n\n\n第二行实际内容\n第三行';
  assert.equal(
    getDraftExcerpt(body3),
    '第一行实际内容\n第二行实际内容'
  );
});
