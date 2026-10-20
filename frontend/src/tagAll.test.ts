import test from 'node:test';
import assert from 'node:assert/strict';
import type { TagOverviewItem } from './bindings/pata/internal/storage/markdown/models';
import {
  isVirtualAllTag,
  formatTagViewHeader,
  formatTagLoadingText,
  formatTagErrorSubject,
  formatTagEmptyMessage,
} from './tagAll.ts';

test('isVirtualAllTag distinguishes virtual all entrance from literal tag', () => {
  // Virtual "全部" has null, undefined, or empty/whitespace string
  assert.equal(isVirtualAllTag(null), true);
  assert.equal(isVirtualAllTag(undefined), true);
  assert.equal(isVirtualAllTag(''), true);
  assert.equal(isVirtualAllTag('   '), true);

  // Real tag with literal name "全部" or normal names
  assert.equal(isVirtualAllTag('全部'), false);
  assert.equal(isVirtualAllTag('架构设计'), false);
});

test('tagNames only aggregates real tags and excludes virtual entrance', () => {
  const tags: TagOverviewItem[] = [
    { tag: 'Doris', task_count: 1, note_count: 0, activity_count: 1, total: 2 },
    { tag: 'Flink', task_count: 2, note_count: 1, activity_count: 0, total: 3 },
  ];

  const tagNames = tags.map((t) => t.tag);
  assert.deepEqual(tagNames, ['Doris', 'Flink']);
  assert.equal(tagNames.includes('全部'), false);
  assert.equal(tags.length, 2);
});

test('formatTagViewHeader renders correct header title', () => {
  assert.equal(formatTagViewHeader(null), '全部');
  assert.equal(formatTagViewHeader(''), '全部');
  assert.equal(formatTagViewHeader('架构设计'), '架构设计');
  assert.equal(formatTagViewHeader('全部'), '全部');
});

test('formatTagLoadingText renders correct loading status', () => {
  assert.equal(formatTagLoadingText(null), '正在加载全部内容...');
  assert.equal(formatTagLoadingText('架构设计'), '正在加载 #架构设计 关联内容...');
});

test('formatTagErrorSubject renders correct error subject', () => {
  assert.equal(formatTagErrorSubject(null), '全部');
  assert.equal(formatTagErrorSubject('架构设计'), '标签 #架构设计');
});

test('formatTagEmptyMessage renders correct empty state text', () => {
  assert.equal(formatTagEmptyMessage(null), '工作空间暂无任务、笔记或记录');
  assert.equal(formatTagEmptyMessage('   '), '工作空间暂无任务、笔记或记录');
  assert.equal(formatTagEmptyMessage('架构设计'), '未找到包含标签 #架构设计 的任务、笔记或记录');
});
