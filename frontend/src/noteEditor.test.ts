import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

import { componentCallbacks } from '../scripts/componentCallbacks.ts';

const callback = componentCallbacks(new URL('./NotesView.tsx', import.meta.url));
const isAudioTranscriptNote = callback('isAudioTranscriptNote');
const getNoteExcerpt = callback('getNoteExcerpt');

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

test('笔记右上角更多菜单包含复制绝对路径与在 Finder 中打开操作', () => {
  const notesSrc = fs.readFileSync(new URL('./NotesView.tsx', import.meta.url), 'utf-8');
  assert.ok(notesSrc.includes('复制绝对路径'), '应包含复制绝对路径菜单项');
  assert.ok(notesSrc.includes('在 Finder 中打开'), '应包含在 Finder 中打开菜单项');
  assert.ok(notesSrc.includes('VaultService.GetNotePath'), '应调用 GetNotePath 获取绝对路径');
  assert.ok(notesSrc.includes('VaultService.RevealNoteInFinder'), '应调用 RevealNoteInFinder 打开文件');
  assert.ok(notesSrc.includes('copyToClipboard'), '应使用 copyToClipboard 复制路径');
  assert.ok(notesSrc.includes("showToast('已复制绝对路径')"), '复制成功应弹出 Toast 提示');
});
